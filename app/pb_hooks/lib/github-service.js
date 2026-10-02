// The GitHub channel (ADR-0050, plan beobachtete-quellen, package 2): one run of a connection over
// its repositories, the cron that starts the runs that are due, "Verbindung prüfen" and the
// details of the repositories for the card. Everything is read only: the client knows GET only.
//
// Per repository and run (each part on its own; a part that fails keeps its stored state, so the
// next run repeats it, and the entries it made already come back as duplicates):
// - files: the head of the default branch (conditional request); when it moved, the tree of the
//   new head, the watched files (globs) and their blobs. The first run stores the state as base
//   without entries. A changed, new or removed file becomes an entry with commits, line counts, a
//   short diff and a copy of the new content; earlier entries of the file show "changed since" or
//   "gone" (status only, ADR-0050 §5).
// - pull requests: the list by last update (conditional); new ones become entries, known ones
//   update their status (open, merged, closed). The first run takes the open ones (at most 20).
// - releases: the list (conditional); new published releases become entries. The first run only
//   notes the newest.
// The run stops at a rate limit (it holds until GitHub allows again; the cron skips the connection
// until then), at an error of the connection (token, no internet) and when its time is up; the
// rest comes with the next run. Called by channel-runner.js, which holds the lock, stores the
// result and cleans errors. CommonJS module, ES5 only, Goja runtime only.
'use strict';

var rules = require(__hooks + '/lib/github-rules.js');
var client = require(__hooks + '/lib/github-client.js');
var berlin = require(__hooks + '/lib/berlin-time.js');
var secrets = require(__hooks + '/lib/secrets.js');
var connectionRules = require(__hooks + '/lib/connection-rules.js');
var inbox = require(__hooks + '/lib/inbox-service.js');
var targets = require(__hooks + '/lib/target-project-service.js');

var COLLECTION = 'connections';
var INBOX = 'inbox_items';
var SHA = /^[0-9a-f]{40}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

function isArray(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function jsonOf(record, field) {
  var raw = record.getString(field);
  if (raw === '' || raw === 'null') {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function iso(ms) {
  return new Date(ms).toISOString();
}

// Whether the connections have the field watch (migration 1790203200 has run).
function hasWatchField(record) {
  try {
    return !!record.collection().fields.getByName('watch');
  } catch (err) {
    return false;
  }
}

/** Kinds of failures that end the run (rate limit, time, connection) instead of one repository. */
function fatalKind(err, variable) {
  if (!client.isFailure(err)) {
    return '';
  }
  if (err.githubKind === 'limit') {
    return 'limit';
  }
  if (err.githubKind === 'deadline') {
    return 'deadline';
  }
  if (err.githubKind === 'timeout') {
    return '';
  }
  var failure = rules.failureOf(err.githubStatus, err.githubKind, variable);
  return failure.connection ? 'connection' : '';
}

/** German text of a failure; other errors (bugs, the database) as their message. */
function messageOf(err, variable) {
  if (client.isFailure(err)) {
    if (err.githubKind === 'invalid' || err.githubKind === 'too_large') {
      return 'GitHub antwortet mit einer Antwort, die die App nicht lesen kann (' + err.githubKind + ').';
    }
    return rules.failureOf(err.githubStatus, err.githubKind === 'timeout' ? 'timeout' : '', variable).message;
  }
  return String(err && err.message ? err.message : err);
}

/** The target project a repository gives its entries (ADR-0049 §3): its own, if it still exists. */
function repoTarget(ctx, config) {
  if (config.target === '') {
    return undefined;
  }
  if (!Object.prototype.hasOwnProperty.call(ctx.targets, config.target)) {
    var facts = targets.projectFacts(ctx.app, config.target);
    ctx.targets[config.target] = facts !== null && facts.scope === ctx.scope;
  }
  // A deleted target (or one of another area) counts as none: the target of the connection applies.
  return ctx.targets[config.target] ? config.target : undefined;
}

/** Saves an entry; counts it as created, duplicate or failed. Returns the outcome of ingest or null. */
function ingest(ctx, config, draft, file) {
  var payload = {
    channel: draft.channel,
    kind: draft.kind,
    title: draft.title,
    body: draft.body,
    source_url: draft.source_url,
    source_ref: draft.source_ref,
    source_date: draft.source_date,
    meta: draft.meta,
    connection: ctx.record.id,
    watch: draft.watch,
    target: repoTarget(ctx, config)
  };
  if (file) {
    payload.originalFile = file;
  }
  if (ctx.outcome.created >= ctx.maxNew) {
    ctx.outcome.skipped += 1;
    return null;
  }
  try {
    var saved = inbox.ingest(ctx.app, ctx.owner, payload);
    if (saved.kind === 'created') {
      ctx.outcome.created += 1;
    } else {
      ctx.outcome.duplicates += 1;
    }
    return saved;
  } catch (err) {
    ctx.outcome.failed += 1;
    ctx.app.logger().warn('byl-github: Eintrag nicht angelegt', 'connection', ctx.record.id, 'error', secrets.redact(String(err), [ctx.token]));
    return null;
  }
}

/**
 * Updates the status of the entries of one source (source_ref) in the area of the connection:
 * `next(item, previous)` gives the new status or null to keep it. Only a changed status is saved;
 * the ticket of an entry never changes (ADR-0050 §5). Returns the number of entries found.
 */
function updateWatches(ctx, ref, next) {
  var items = ctx.app.findRecordsByFilter(
    INBOX,
    'scope = {:scope} && channel = "github" && source_ref = {:ref}',
    'created',
    0,
    0,
    { scope: ctx.itemScope, ref: ref }
  );
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!inbox.hasField(item, inbox.WATCH_FIELD)) {
      continue;
    }
    var previous = inbox.watchOf(item);
    var status = next(item, previous);
    if (status === null || rules.sameWatch(previous, status)) {
      continue;
    }
    try {
      item.set(inbox.WATCH_FIELD, status);
      ctx.app.save(item);
      ctx.outcome.updated += 1;
    } catch (err) {
      ctx.outcome.failed += 1;
    }
  }
  return items.length;
}

/** Path of the API below a repository. */
function repoPath(name, rest) {
  return '/repos/' + rules.encodePath(name) + (rest ? rest : '');
}

/** The data of the repository (default branch), read again after some hours or when missing. */
function ensureInfo(ctx, config, state) {
  var age = Date.parse(text(state.info_at));
  if (text(state.branch) !== '' && !isNaN(age) && ctx.now - age < rules.LIMITS.repoInfoHours * 3600 * 1000) {
    return;
  }
  var answer = ctx.gh.get(repoPath(config.repo), { etag: text(state.branch) === '' ? '' : text(state.etag_repo) });
  if (answer.status === 200) {
    var json = answer.json;
    state.name = rules.isRepoName(json.full_name) ? json.full_name : config.repo;
    state.branch = typeof json.default_branch === 'string' && json.default_branch !== '' ? json.default_branch : 'main';
    state.private = json.private === true;
    state.archived = json.archived === true;
    state.etag_repo = answer.etag;
  }
  state.info_at = iso(ctx.now);
}

/** Every page of a list (rel="next"), at most LIMITS.pages: { items, more }. */
function listAll(ctx, path) {
  var items = [];
  var answer = ctx.gh.get(path);
  for (var pages = 1; ; pages++) {
    var list = isArray(answer.json) ? answer.json : [];
    for (var i = 0; i < list.length; i++) {
      items.push(list[i]);
    }
    if (answer.next === '') {
      return { items: items, more: false };
    }
    if (pages >= rules.LIMITS.pages) {
      return { items: items, more: true };
    }
    answer = ctx.gh.get(answer.next);
  }
}

// Every repository the token may read: own ones, ones it works on and the ones of its
// organizations (GET /user/repos; a fine-grained token gives only what it was granted).
var LIST_PATH = '/user/repos?affiliation=owner,collaborator,organization_member&sort=full_name&per_page=';

/**
 * Reads the list of the repositories the token may read (ADR-0050, addendum of 2026-10-02): the
 * account of the token (GET /user, for "own") and every page of GET /user/repos, at most
 * LIMITS.listPages. Each request is conditional with the ETag of the list of before, so an
 * unchanged list costs no request of the rate limit. Returns the list as stored in
 * connections.watch (rules.listOf); failures go up like every request of a run.
 */
function fetchList(gh, previous, now) {
  var before = previous || { login: '', etag_user: '', pages: [] };
  var user = gh.get('/user', { etag: before.login === '' ? '' : before.etag_user });
  var login = user.status === 304 ? before.login : isPlainObject(user.json) ? text(user.json.login) : '';
  var pages = [];
  var more = false;
  var path = LIST_PATH + rules.LIMITS.perPage;
  for (var i = 0; i < rules.LIMITS.listPages; i++) {
    var old = isPlainObject(before.pages[i]) ? before.pages[i] : null;
    var answer = gh.get(path, { etag: old === null ? '' : old.etag });
    var page;
    if (answer.status === 304 && old !== null) {
      page = old;
    } else {
      var repos = [];
      var items = isArray(answer.json) ? answer.json : [];
      for (var r = 0; r < items.length; r++) {
        var entry = rules.listEntryOf(items[r]);
        if (entry !== null) {
          repos.push(entry);
        }
      }
      page = { etag: answer.etag, next: answer.next, repos: repos };
    }
    pages.push(page);
    if (page.next === '') {
      break;
    }
    if (i === rules.LIMITS.listPages - 1) {
      more = true;
      break;
    }
    path = page.next;
  }
  return rules.listOf({ at: iso(now), login: login, etag_user: user.etag || before.etag_user, pages: pages, more: more });
}

/** Commits that changed `path` since the stored head, newest first (without the stored head). */
function commitsOf(ctx, name, path, head, since, base) {
  var query =
    '?sha=' + encodeURIComponent(head) +
    '&path=' + encodeURIComponent(path) +
    (since === '' ? '' : '&since=' + encodeURIComponent(since)) +
    '&per_page=' + rules.LIMITS.commitPage;
  var answer = ctx.gh.get(repoPath(name, '/commits' + query));
  var list = isArray(answer.json) ? answer.json : [];
  var commits = [];
  for (var i = 0; i < list.length; i++) {
    var entry = list[i];
    if (!isPlainObject(entry) || !SHA.test(text(entry.sha)) || entry.sha === base) {
      continue;
    }
    var commit = isPlainObject(entry.commit) ? entry.commit : {};
    var author = isPlainObject(commit.author) ? commit.author : {};
    var login = isPlainObject(entry.author) ? text(entry.author.login) : '';
    commits.push({
      sha: entry.sha,
      message: text(commit.message),
      author: text(author.name) || login,
      date: text(author.date)
    });
  }
  return { commits: commits, more: answer.next !== '' };
}

/** The new content of a file (raw blob): { bytes, text, copy } with copy 'complete' or 'binary'. */
function blobOf(ctx, name, sha) {
  var answer = ctx.gh.get(repoPath(name, '/git/blobs/' + sha), { raw: true });
  var content = toString(answer.body);
  if (rules.looksBinary(content)) {
    return { bytes: answer.body, text: null, copy: 'binary' };
  }
  var truncated = content.length > rules.LIMITS.bodyChars;
  return {
    bytes: answer.body,
    text: { text: truncated ? content.slice(0, rules.LIMITS.bodyChars) : content, truncated: truncated },
    copy: 'complete'
  };
}

/** The files of a compare (old head ... new head) by name; null when GitHub cannot compare them. */
function compareFiles(ctx, name, base, head) {
  var answer;
  try {
    answer = ctx.gh.get(repoPath(name, '/compare/' + base + '...' + head));
  } catch (err) {
    // The old head can be gone (force push): the entries come without line counts.
    if (client.isFailure(err) && err.githubKind === 'http' && (err.githubStatus === 404 || err.githubStatus === 422)) {
      return null;
    }
    throw err;
  }
  var files = {};
  var list = isPlainObject(answer.json) && isArray(answer.json.files) ? answer.json.files : [];
  for (var i = 0; i < list.length; i++) {
    var file = list[i];
    if (isPlainObject(file) && typeof file.filename === 'string') {
      files[file.filename] = file;
    }
  }
  return files;
}

/** The time of a change of `path`: its newest commit, else the date of the head, else now. */
function changeTime(commits, headDate, now) {
  if (commits.length > 0 && rules.isoOf(commits[0].date) !== '') {
    return rules.isoOf(commits[0].date);
  }
  return rules.isoOf(headDate) || iso(now);
}

/** The watched files of one repository (ADR-0050 §3). */
function processFiles(ctx, config, state) {
  var name = text(state.name) || config.repo;
  var signature = rules.pathsSignature(config.paths);
  var hasBase = isPlainObject(state.files) && SHA.test(text(state.head));
  var branch = ctx.gh.get(repoPath(name, '/branches/' + encodeURIComponent(state.branch)), {
    etag: hasBase ? text(state.etag_branch) : ''
  });
  var head = text(state.head);
  var headDate = text(state.head_date);
  if (branch.status === 200) {
    var commit = isPlainObject(branch.json.commit) ? branch.json.commit : {};
    var detail = isPlainObject(commit.commit) ? commit.commit : {};
    head = text(commit.sha);
    headDate =
      (isPlainObject(detail.committer) && text(detail.committer.date)) ||
      (isPlainObject(detail.author) && text(detail.author.date)) ||
      '';
    if (!SHA.test(head)) {
      throw new Error('GitHub nennt keinen Stand des Branches ' + state.branch + '.');
    }
  }
  if (hasBase && head === state.head && signature === state.paths_sig) {
    state.etag_branch = branch.status === 200 ? branch.etag : state.etag_branch;
    return;
  }
  var tree = ctx.gh.get(repoPath(name, '/git/trees/' + head + '?recursive=1'));
  var entries = isPlainObject(tree.json) && isArray(tree.json.tree) ? tree.json.tree : [];
  var truncated = isPlainObject(tree.json) && tree.json.truncated === true;
  var watched = rules.watchedFiles(entries, config.paths, config.key);
  var commitState = function () {
    state.head = head;
    state.head_date = headDate;
    state.paths_sig = signature;
    state.paths = config.paths.slice();
    state.files_more = watched.more;
    state.truncated = truncated;
    state.etag_branch = branch.status === 200 ? branch.etag : state.etag_branch;
  };
  if (!hasBase) {
    // First run (or files switched on again): the current state is the base, no entries.
    state.files = watched.files;
    commitState();
    return;
  }
  var inTree = {};
  for (var t = 0; t < entries.length; t++) {
    if (isPlainObject(entries[t]) && entries[t].type === 'blob') {
      inTree[entries[t].path] = true;
    }
  }
  var watchedBefore = rules.matcherOf(isArray(state.paths) ? state.paths : config.paths);
  var changes = rules.fileChanges(
    state.files,
    watched.files,
    function (path) {
      return inTree[path] === true ? true : truncated ? null : false;
    },
    function (path) {
      return !watchedBefore(path);
    }
  );
  var touched = changes.changed.concat(changes.added);
  var all = touched.concat(changes.removed);
  var files = watched.files;
  for (var k = 0; k < changes.kept.length; k++) {
    files[changes.kept[k]] = state.files[changes.kept[k]];
  }
  if (all.length > 0) {
    var compared = head === state.head ? null : compareFiles(ctx, name, state.head, head);
    var detailed = 0;
    var newest = null;
    for (var i = 0; i < all.length; i++) {
      var path = all[i];
      var removed = i >= touched.length;
      var action = removed ? 'removed' : changes.added.indexOf(path) !== -1 ? 'added' : 'changed';
      var stats = compared && compared[path] ? { additions: compared[path].additions || 0, deletions: compared[path].deletions || 0 } : null;
      var patch = compared && compared[path] && typeof compared[path].patch === 'string' ? compared[path].patch : '';
      var commits = { commits: [], more: false };
      var copy = removed ? 'none' : 'later';
      var blob = null;
      var size = removed ? 0 : files[path].size;
      if (!removed && detailed < rules.LIMITS.detailedFiles) {
        detailed += 1;
        commits = commitsOf(ctx, name, path, head, text(state.head_date), text(state.head));
        if (size > rules.LIMITS.copyBytes) {
          copy = 'too_large';
        } else {
          blob = blobOf(ctx, name, files[path].sha);
          copy = blob.copy;
        }
      } else if (removed && detailed < rules.LIMITS.detailedFiles) {
        detailed += 1;
        commits = commitsOf(ctx, name, path, head, text(state.head_date), text(state.head));
      }
      var at = changeTime(commits.commits, headDate, ctx.now);
      var draft = rules.fileDraft(
        {
          repo: name,
          key: config.key,
          branch: state.branch,
          path: path,
          action: action,
          sha: removed ? '' : files[path].sha,
          oldSha: state.files[path] ? state.files[path].sha : '',
          head: head,
          headDate: headDate,
          base: text(state.head),
          stats: stats,
          patch: patch,
          commits: commits.commits,
          commitsMore: commits.more,
          content: blob && blob.text ? blob.text : null,
          copy: copy,
          size: size,
          detectedAt: iso(ctx.now)
        },
        berlin
      );
      var file = blob ? $filesystem.fileFromBytes(blob.bytes, draft.fileName) : null;
      ingest(ctx, config, draft, file);
      var current = removed ? '' : files[path].sha;
      updateWatches(ctx, draft.source_ref, function (item, previous) {
        var meta = inbox.metaOf(item);
        var github = isPlainObject(meta.github) ? meta.github : {};
        if (github.kind !== 'file' || github.action === 'removed') {
          return null;
        }
        return rules.fileWatch(text(github.sha), current, at, previous);
      });
      if (newest === null || rules.later(at, newest.at) === rules.isoOf(at)) {
        newest = { path: path, action: action, at: at, url: draft.source_url };
      }
    }
    state.last_change = newest;
  }
  state.files = files;
  commitState();
}

/**
 * A pull request seen in a list: its entries follow its state (status only); without an entry it
 * becomes one if `take` (opened after the base, or open on the first run).
 */
function takePull(ctx, config, name, pull, take) {
  var draft = rules.pullDraft(pull, name, config.key, berlin);
  var known = updateWatches(ctx, draft.source_ref, function () {
    return rules.pullWatch(pull);
  });
  if (known === 0 && take) {
    ingest(ctx, config, draft, null);
  }
}

/** Pull requests of one repository (ADR-0050 §4). */
function processPulls(ctx, config, state) {
  var name = text(state.name) || config.repo;
  var list = repoPath(name, '/pulls?state=all&sort=updated&direction=desc&per_page=' + rules.LIMITS.perPage);
  var open = repoPath(name, '/pulls?state=open&sort=created&direction=desc&per_page=' + rules.LIMITS.perPage);
  var pulls = isPlainObject(state.pulls) ? state.pulls : null;
  if (pulls === null) {
    // First run: the newest update is the mark; the open pull requests come in (at most 20, the
    // newest), the closed ones of before never (no old load). A repository of "Alle meine
    // Repositorys" takes no entry on its first run: the user did not choose it on its own, and
    // switching the option on must not pour the open pull requests of dozens of repositories into
    // the inbox (ADR-0050, addendum of 2026-10-02); known entries still follow their state.
    var first = ctx.gh.get(list);
    var firstList = isArray(first.json) ? first.json : [];
    var mark = '';
    for (var f = 0; f < firstList.length; f++) {
      mark = rules.later(mark, firstList[f] && firstList[f].updated_at);
    }
    var current = listAll(ctx, open);
    for (var o = 0; o < current.items.length && o < rules.LIMITS.firstPulls; o++) {
      if (isPlainObject(current.items[o])) {
        takePull(ctx, config, name, current.items[o], config.auto !== true);
      }
    }
    state.pulls = { etag: first.etag, since: mark || iso(ctx.now), base_at: mark || iso(ctx.now) };
    state.open_pulls = current.items.length;
    state.open_pulls_more = current.more;
    return;
  }
  var answer = ctx.gh.get(list, { etag: text(pulls.etag) });
  if (answer.status === 304) {
    return;
  }
  var seen = [];
  var since = text(pulls.since);
  var page = answer;
  for (var pages = 1; ; pages++) {
    var items = isArray(page.json) ? page.json : [];
    var older = false;
    for (var i = 0; i < items.length; i++) {
      if (!isPlainObject(items[i])) {
        continue;
      }
      if (!rules.notBefore(items[i].updated_at, pulls.since)) {
        older = true;
        break;
      }
      seen.push(items[i]);
      since = rules.later(since, items[i].updated_at);
    }
    if (older || page.next === '' || pages >= rules.LIMITS.pages) {
      break;
    }
    page = ctx.gh.get(page.next);
  }
  for (var s = seen.length - 1; s >= 0; s--) {
    takePull(ctx, config, name, seen[s], rules.isAfter(seen[s].created_at, pulls.base_at));
  }
  var counted = listAll(ctx, open);
  state.open_pulls = counted.items.length;
  state.open_pulls_more = counted.more;
  state.pulls = { etag: answer.etag, since: since || pulls.since, base_at: pulls.base_at };
}

/** A release the channel looks at: published, no draft. */
function isPublished(release) {
  return isPlainObject(release) && release.draft !== true && rules.isoOf(release.published_at) !== '';
}

function releaseSummary(release, name) {
  return {
    tag: text(release.tag_name),
    name: text(release.name),
    at: rules.isoOf(release.published_at),
    url: rules.webUrl(name, 'releases/tag/' + encodeURIComponent(text(release.tag_name))),
    prerelease: release.prerelease === true
  };
}

/** Releases of one repository (ADR-0050 §4). */
function processReleases(ctx, config, state) {
  var name = text(state.name) || config.repo;
  var path = repoPath(name, '/releases?per_page=' + rules.LIMITS.perPage);
  var releases = isPlainObject(state.releases) ? state.releases : null;
  if (releases === null) {
    // First run: only the newest published release is noted, no entries.
    var first = ctx.gh.get(path);
    var newest = null;
    var list = isArray(first.json) ? first.json : [];
    for (var f = 0; f < list.length; f++) {
      if (isPublished(list[f]) && (newest === null || rules.isAfter(list[f].published_at, newest.published_at))) {
        newest = list[f];
      }
    }
    state.releases = { etag: first.etag, since: newest ? rules.isoOf(newest.published_at) : iso(ctx.now) };
    state.last_release = newest ? releaseSummary(newest, name) : null;
    return;
  }
  var answer = ctx.gh.get(path, { etag: text(releases.etag) });
  if (answer.status === 304) {
    return;
  }
  var fresh = [];
  var since = text(releases.since);
  var page = answer;
  var latest = null;
  for (var pages = 1; ; pages++) {
    var items = isArray(page.json) ? page.json : [];
    var older = false;
    for (var i = 0; i < items.length; i++) {
      var release = items[i];
      if (!isPublished(release)) {
        continue;
      }
      if (latest === null || rules.isAfter(release.published_at, latest.published_at)) {
        latest = release;
      }
      if (rules.isAfter(release.published_at, releases.since)) {
        fresh.push(release);
        since = rules.later(since, release.published_at);
      } else {
        older = true;
      }
    }
    if (older || page.next === '' || pages >= rules.LIMITS.pages) {
      break;
    }
    page = ctx.gh.get(page.next);
  }
  for (var r = fresh.length - 1; r >= 0; r--) {
    ingest(ctx, config, rules.releaseDraft(fresh[r], name, config.key, berlin), null);
  }
  if (latest !== null) {
    state.last_release = releaseSummary(latest, name);
  }
  state.releases = { etag: answer.etag, since: since };
}

/**
 * One repository: its data, then files, pull requests and releases, each as switched on. A part
 * that is switched off forgets its state (switched on again, it starts with a new base). An error
 * of one part leaves the others running; failures that end the run go up. Returns the messages of
 * the parts that failed.
 */
function processRepo(ctx, config, state) {
  ensureInfo(ctx, config, state);
  var problems = [];
  var parts = [
    ['files', processFiles, ['files', 'head', 'head_date', 'paths_sig', 'paths', 'files_more', 'truncated', 'etag_branch', 'last_change']],
    ['pulls', processPulls, ['pulls', 'open_pulls', 'open_pulls_more']],
    ['releases', processReleases, ['releases', 'last_release']]
  ];
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (!config.events[part[0]]) {
      for (var f = 0; f < part[2].length; f++) {
        delete state[part[2][f]];
      }
      continue;
    }
    var copy = JSON.parse(JSON.stringify(state));
    try {
      part[1](ctx, config, copy);
    } catch (err) {
      if (fatalKind(err, ctx.variable) !== '') {
        throw err;
      }
      if (part[0] === 'files' && client.isFailure(err) && err.githubKind === 'http' && err.githubStatus === 404) {
        // The default branch was renamed or deleted: read the repository again next time.
        state.info_at = '';
      }
      problems.push(messageOf(err, ctx.variable));
      continue;
    }
    for (var key in copy) {
      if (Object.prototype.hasOwnProperty.call(copy, key)) {
        state[key] = copy[key];
      }
    }
    for (var d = 0; d < part[2].length; d++) {
      if (!Object.prototype.hasOwnProperty.call(copy, part[2][d])) {
        delete state[part[2][d]];
      }
    }
  }
  return problems;
}

function hintOf(stop, errors, pending, configured, authenticated, limit, auto) {
  if (configured === 0) {
    // With "Alle meine Repositorys" the hint of the automatic set says why there is none.
    return auto ? '' : 'Noch kein Repository eingetragen.';
  }
  if (stop === 'limit' && limit) {
    return rules.limitHint(limit, authenticated, berlin);
  }
  if (stop === 'deadline' || pending > 0) {
    return 'Nicht alle Repositorys geschafft; der Rest folgt beim nächsten Abruf.';
  }
  if (errors > 0) {
    return (errors === 1 ? '1 Repository' : errors + ' Repositorys') + ' mit Fehler; der Grund steht in den Details.';
  }
  return '';
}

/**
 * One run of a GitHub connection (channel-runner.js): `access.secret` is the token or ''. Returns
 * { created, duplicates, updated, skipped, failed, unmatched, error, hint, watch, limited }:
 * `updated` counts entries whose status changed, `error` only a failure of the connection (token,
 * reachability), `limited` the end of a rate limit (ms) when one holds. `options.now` is the time
 * of the cron that started the run (its clock decides whether a rate limit still holds).
 */
function run(app, record, access, options) {
  var now = Date.now();
  var gate = options && typeof options.now === 'number' ? options.now : now;
  var token = access.secret || '';
  var settings = rules.settingsOf(jsonOf(record, 'settings'));
  var state = rules.stateOf(record.getString('watch'));
  var variable = record.getString('secret_env');
  var outcome = { created: 0, duplicates: 0, updated: 0, skipped: 0, failed: 0, unmatched: 0, error: '' };
  var held = rules.limitUntil(state, gate);
  if (held > 0) {
    outcome.limited = held;
    outcome.hint = rules.limitHint(state.limit, token !== '', berlin);
    return outcome;
  }
  var testMode = app.store().get(rules.TEST_MODE_KEY) === true;
  var deadline = now + rules.runMsOf(testMode, $os.getenv(rules.TEST_TIMING_ENV));
  var backoff = state.limit && typeof state.limit.backoff === 'number' ? state.limit.backoff : 0;
  var ctx = {
    app: app,
    record: record,
    owner: record.getString('owner'),
    scope: record.getString('scope'),
    itemScope: 'u:' + record.getString('owner'),
    variable: variable,
    token: token,
    gh: client.create(app, token, deadline, backoff),
    outcome: outcome,
    now: now,
    targets: {},
    maxNew: require(__hooks + '/lib/channel-runner.js').MAX_NEW_PER_RUN
  };
  var stop = '';
  var limit = null;
  var errors = 0;
  var pending = 0;
  // "Alle meine Repositorys" (addendum of 2026-10-02): the list of the token is read again once it
  // is an hour old (conditional, so an unchanged list costs nothing); a failure that ends the run
  // ends it here, any other keeps the list of before and is said in the hint.
  var useList = settings.auto && token !== '';
  var autoError = '';
  if (useList && rules.listDue(state.list, gate)) {
    try {
      state.list = fetchList(ctx.gh, state.list, now);
    } catch (err) {
      var listKind = fatalKind(err, variable);
      if (listKind === 'limit') {
        stop = 'limit';
        limit = { until: err.until, kind: err.limitKind, backoff: err.limitKind === 'secondary' ? backoff + 1 : 0 };
      } else if (listKind === 'deadline') {
        stop = 'deadline';
      } else if (listKind === 'connection') {
        stop = 'connection';
        outcome.error = messageOf(err, variable);
      } else {
        autoError = 'Die Liste deiner Repositorys ließ sich nicht lesen: ' + messageOf(err, variable);
      }
    }
  }
  var effective = rules.effectiveRepos(settings, useList ? state.list : null);
  var repos = {};
  for (var c = 0; c < effective.repos.length; c++) {
    var known = state.repos[effective.repos[c].key];
    repos[effective.repos[c].key] = isPlainObject(known) ? known : {};
  }
  state.repos = repos;
  for (var i = 0; i < effective.repos.length; i++) {
    var config = effective.repos[i];
    var repoState = state.repos[config.key];
    if (stop !== '') {
      pending += 1;
      continue;
    }
    try {
      var problems = processRepo(ctx, config, repoState);
      repoState.error = problems.join(' ');
      if (problems.length === 0) {
        repoState.ok_at = iso(Date.now());
      } else {
        errors += 1;
      }
    } catch (err) {
      var kind = fatalKind(err, variable);
      if (kind === 'limit') {
        stop = 'limit';
        limit = {
          until: err.until,
          kind: err.limitKind,
          backoff: err.limitKind === 'secondary' ? backoff + 1 : 0
        };
        pending += 1;
        continue;
      }
      if (kind === 'deadline') {
        stop = 'deadline';
        pending += 1;
        continue;
      }
      repoState.error = messageOf(err, variable);
      if (kind === 'connection') {
        stop = 'connection';
        outcome.error = repoState.error;
      } else {
        errors += 1;
      }
    }
    repoState.checked_at = iso(Date.now());
  }
  var autoNote = settings.auto && token === '' ? rules.AUTO_NO_TOKEN : '';
  if (!settings.auto) {
    state.auto = null;
  } else if (useList && state.list !== null) {
    // The automatic set and what changed since the last run (switched on just now: everything new).
    var first = state.auto === null;
    var changes = rules.autoChanges(first ? [] : state.auto.names, effective.auto, settings, state.list);
    var changed = first || changes.added.length > 0 || changes.removed.length > 0;
    state.auto = {
      names: effective.auto,
      at: changed ? iso(now) : state.auto.at,
      added: changed ? changes.added : state.auto.added,
      removed: changed ? changes.removed : state.auto.removed,
      error: autoError
    };
    autoNote = changed ? rules.autoHint(changes, first) : '';
  }
  if (autoError !== '') {
    autoNote = autoNote === '' ? autoError : autoNote + ' ' + autoError;
  }
  state.limit = limit;
  state.rate = ctx.gh.rate();
  state.authenticated = token !== '';
  outcome.watch = state;
  var hint = stop === 'connection' ? '' : hintOf(stop, errors, pending, effective.repos.length, token !== '', limit, settings.auto);
  outcome.hint = stop === 'connection' || autoNote === '' ? hint : hint === '' ? autoNote : hint + ' ' + autoNote;
  if (limit !== null) {
    outcome.limited = limit.until;
  }
  return outcome;
}

/**
 * Cron (every minute): runs every switched-on GitHub connection whose interval has passed and no
 * rate limit holds, one after the other, through the runner (lock, result, cleaned errors). Returns
 * the number of runs. Never throws; before the migration or without connections it does nothing.
 */
function runDue(app, now) {
  var found;
  try {
    found = app.findRecordsByFilter(COLLECTION, 'type = "github" && enabled = true', 'created', 0, 0);
  } catch (err) {
    return 0;
  }
  var runner = require(__hooks + '/lib/channel-runner.js');
  var runs = 0;
  for (var i = 0; i < found.length; i++) {
    var record = found[i];
    try {
      var settings = rules.settingsOf(jsonOf(record, 'settings'));
      var state = rules.stateOf(record.getString('watch'));
      if (!rules.isDue(record.getString('last_run_at'), settings.interval, now, rules.limitUntil(state, now))) {
        continue;
      }
      runner.runConnection(app, record, { now: now });
      runs += 1;
    } catch (err) {
      app.logger().warn('byl-github: ' + secrets.redact(String(err), []));
    }
  }
  return runs;
}

/** The token of a connection ('' without one), read at the moment of the request (ADR-0018). */
function tokenOf(record) {
  return secrets.read(record.getString('secret_env'), function (name) {
    return $os.getenv(name);
  });
}

/** The repositories a connection watches now: entered ones and, with a token, the automatic ones. */
function watchedOf(settings, state, token) {
  return rules.effectiveRepos(settings, settings.auto && token !== '' ? state.list : null);
}

/**
 * The details of the repositories of a connection for its card (ADR-0050 §7), from its settings and
 * the stored state, without a request to GitHub: { authenticated, interval, repos, limit, rate,
 * auto }. `repos` are the watched ones (entered, then automatic); `auto` says how "Alle meine
 * Repositorys" stands (addendum of 2026-10-02): { enabled, login, at, count, more, added, removed,
 * changedAt, error, excluded }. Its presence tells the card that the hooks know the option.
 */
function summary(record) {
  var settings = rules.settingsOf(jsonOf(record, 'settings'));
  var state = hasWatchField(record) ? rules.stateOf(record.getString('watch')) : rules.stateOf(null);
  var token = tokenOf(record);
  var effective = watchedOf(settings, state, token);
  var repos = [];
  for (var i = 0; i < effective.repos.length; i++) {
    repos.push(rules.repoSummary(effective.repos[i], state.repos[effective.repos[i].key]));
  }
  var now = Date.now();
  var until = rules.limitUntil(state, now);
  var auto = state.auto;
  return {
    authenticated: token !== '',
    interval: settings.interval,
    repos: repos,
    limit: until > 0 ? { until: iso(until), kind: state.limit.kind } : null,
    rate: isPlainObject(state.rate) && state.rate.limit > 0 ? state.rate : null,
    auto: {
      enabled: settings.auto,
      login: state.list === null ? '' : state.list.login,
      at: state.list === null ? '' : state.list.at,
      count: effective.auto.length,
      more: effective.more,
      added: auto === null ? [] : auto.added,
      removed: auto === null ? [] : auto.removed,
      changedAt: auto === null ? '' : auto.at,
      error: auto === null ? '' : auto.error,
      excluded: settings.exclude
    }
  };
}

/**
 * "Verbindung prüfen" (ADR-0050 §7): who the token belongs to, the rate limit (GET /rate_limit does
 * not count) and per repository whether it is reachable. Stores the result at the connection like a
 * run: last_ok_at and an empty error after success, the error of the connection otherwise.
 * Returns { status: 'ok' | 'error' | 'limited', authenticated, login, rate, repos, message }.
 */
function check(app, record) {
  var token = tokenOf(record);
  var variable = record.getString('secret_env');
  var state = hasWatchField(record) ? rules.stateOf(record.getString('watch')) : rules.stateOf(null);
  // The watched repositories: the entered ones and those of "Alle meine Repositorys".
  var watched = watchedOf(rules.settingsOf(jsonOf(record, 'settings')), state, token).repos;
  var testMode = app.store().get(rules.TEST_MODE_KEY) === true;
  var gh = client.create(app, token, Date.now() + rules.runMsOf(testMode, $os.getenv(rules.TEST_TIMING_ENV)), 0);
  var result = { status: 'ok', authenticated: token !== '', login: '', rate: null, repos: [], message: '' };
  var connectionError = '';
  try {
    if (token !== '') {
      var me = gh.get('/user');
      result.login = isPlainObject(me.json) ? text(me.json.login) : '';
    }
    var limits = gh.get('/rate_limit');
    var core = isPlainObject(limits.json) && isPlainObject(limits.json.resources) ? limits.json.resources.core : null;
    if (isPlainObject(core)) {
      result.rate = {
        limit: typeof core.limit === 'number' ? core.limit : -1,
        remaining: typeof core.remaining === 'number' ? core.remaining : -1,
        reset: typeof core.reset === 'number' ? iso(core.reset * 1000) : ''
      };
    }
    for (var i = 0; i < watched.length; i++) {
      var config = watched[i];
      try {
        var info = gh.get(repoPath(config.repo));
        result.repos.push({
          repo: config.repo,
          ok: true,
          name: isPlainObject(info.json) && rules.isRepoName(info.json.full_name) ? info.json.full_name : config.repo,
          private: isPlainObject(info.json) && info.json.private === true,
          message: ''
        });
      } catch (err) {
        if (fatalKind(err, variable) !== '') {
          throw err;
        }
        result.repos.push({ repo: config.repo, ok: false, name: config.repo, private: false, message: messageOf(err, variable) });
      }
    }
  } catch (err) {
    var kind = fatalKind(err, variable);
    if (kind === 'limit') {
      result.status = 'limited';
      result.message = rules.limitHint({ until: err.until, kind: err.limitKind }, token !== '', berlin);
    } else {
      result.status = 'error';
      result.message = messageOf(err, variable);
      if (kind === 'connection') {
        connectionError = result.message;
      }
    }
  }
  result.message = secrets.redact(result.message, [token]);
  try {
    var fresh = app.findRecordById(COLLECTION, record.id);
    var stamp = berlin.toPocketBaseDate(Date.now());
    fresh.set('last_run_at', stamp);
    fresh.set('last_error', secrets.redact(connectionError, [token]));
    if (result.status === 'ok') {
      fresh.set('last_ok_at', stamp);
    }
    app.save(fresh);
  } catch (err) {
    app.logger().warn('byl-github: Prüfung nicht gespeichert', 'connection', record.id, 'error', secrets.redact(String(err), [token]));
  }
  return result;
}

// Stores a list read by the route below in connections.watch, on the record as it is now (a run
// that holds the lock writes its own state at its end; its list is at most an hour older).
function saveList(app, id, list) {
  try {
    var fresh = app.findRecordById(COLLECTION, id);
    var state = rules.stateOf(fresh.getString('watch'));
    state.list = list;
    fresh.set('watch', state);
    app.save(fresh);
  } catch (err) {
    app.logger().warn('byl-github: Liste der Repositorys nicht gespeichert', 'connection', id, 'error', secrets.redact(String(err), []));
  }
}

/**
 * The repositories the token may read, for "Repository hinzufügen …" (ADR-0050, addendum of
 * 2026-10-02): from the stored list while it is younger than an hour, else read again
 * (conditional, then stored); `options.refresh` reads again at most once a minute. Without a token
 * GitHub names no list. Returns { status: 'ok' | 'no_token' | 'limited' | 'error', message, login,
 * at, more, repos: [{ repo, private, archived, fork, org, own, state }] }; a failure keeps the list
 * of before. Never shows the token.
 */
function repoList(app, record, options) {
  var token = tokenOf(record);
  var result = { status: 'ok', message: '', login: '', at: '', more: false, repos: [] };
  if (token === '') {
    result.status = 'no_token';
    result.message = rules.LIST_NO_TOKEN;
    return result;
  }
  var variable = record.getString('secret_env');
  var settings = rules.settingsOf(jsonOf(record, 'settings'));
  var state = hasWatchField(record) ? rules.stateOf(record.getString('watch')) : rules.stateOf(null);
  var list = state.list;
  var now = Date.now();
  var refresh = options && options.refresh === true && rules.listRefreshable(list, now);
  if (rules.listDue(list, now) || refresh) {
    var held = rules.limitUntil(state, now);
    if (held > 0) {
      result.status = 'limited';
      result.message = rules.limitHint(state.limit, true, berlin);
    } else {
      var testMode = app.store().get(rules.TEST_MODE_KEY) === true;
      var gh = client.create(app, token, now + rules.runMsOf(testMode, $os.getenv(rules.TEST_TIMING_ENV)), 0);
      try {
        list = fetchList(gh, list, now);
        saveList(app, record.id, list);
      } catch (err) {
        if (fatalKind(err, variable) === 'limit') {
          result.status = 'limited';
          result.message = rules.limitHint({ until: err.until, kind: err.limitKind }, true, berlin);
        } else {
          result.status = 'error';
          result.message = messageOf(err, variable);
        }
      }
    }
  }
  if (list !== null) {
    result.login = list.login;
    result.at = list.at;
    result.more = list.more;
    result.repos = rules.listChoices(list, settings);
  }
  result.message = secrets.redact(result.message, [token]);
  return result;
}

module.exports = {
  run: run,
  runDue: runDue,
  summary: summary,
  check: check,
  repoList: repoList,
  requiresSecret: connectionRules.requiresSecret
};
