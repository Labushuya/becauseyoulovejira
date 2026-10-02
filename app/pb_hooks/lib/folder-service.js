// The folder channel (ADR-0051, plan beobachtete-quellen, package 3): one run of a connection over
// its folders, the cron that starts the runs that are due, the details of the card, the list and
// the taking over of files that were there before, the checks of a new folder and the route that
// shows the current file of an entry. Everything is read only: the channel lists folders, reads
// file attributes and hashes files; it never writes, moves, renames or deletes anything in them.
//
// One run per folder: list the folder (and its subfolders as configured) without following links
// or junctions, never below the folder of the app; compare size and time with the stored state;
// hash what differs (SHA-256, lib/folder-hash.js); then, over all folders of the connection, find
// moves (same hash, or same size and time without a stored hash), and make entries of new files
// and, with "Änderungen melden", of changed ones. Earlier entries of a file follow it: current,
// changed since, moved (their reference goes along) or gone. The first run of a folder only stores
// the state as base. A folder that cannot be listed keeps its state (no flood of "gone"). Called by
// channel-runner.js, which holds the lock, stores the result and cleans errors. CommonJS module,
// ES5 only, Goja runtime only.
'use strict';

var rules = require(__hooks + '/lib/folder-rules.js');
var hashes = require(__hooks + '/lib/folder-hash.js');
var berlin = require(__hooks + '/lib/berlin-time.js');
var errors = require(__hooks + '/lib/errors.js');
var inbox = require(__hooks + '/lib/inbox-service.js');
var targets = require(__hooks + '/lib/target-project-service.js');

var COLLECTION = 'connections';
var INBOX = 'inbox_items';
var CANONICAL_PREFIX = 'byl.folders.canonical.';
var ROUTE = 'folder-file';
var AREA = 'byl-folders';
// Conditional headers a browser may send; the route always answers with the whole current file.
var CONDITIONAL_HEADERS = ['Range', 'If-Range', 'If-Modified-Since', 'If-Unmodified-Since', 'If-None-Match', 'If-Match'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

function isArray(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function iso(ms) {
  return new Date(ms).toISOString();
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

/** 'windows' or 'posix': the real system of the server (its separator), not a declared one. */
function platform() {
  return rules.platformOf($filepath.join('a', 'b'));
}

function nameKey(name, p) {
  return p === 'windows' ? String(name).toLowerCase() : String(name);
}

// Whether the connections have the field watch (migration 1790203200 has run).
function hasWatchField(record) {
  try {
    return !!record.collection().fields.getByName('watch');
  } catch (err) {
    return false;
  }
}

/** The file attributes of Windows of an entry, 0 elsewhere. */
function attributesOf(info) {
  try {
    var sys = info.sys();
    var value = sys ? Number(sys.fileAttributes) : NaN;
    return isFinite(value) ? value : 0;
  } catch (err) {
    return 0;
  }
}

/**
 * The entries of a folder, never following a link: [{ name, kind, size, mtime, offline }] in the
 * order of their names, or null when the folder cannot be listed. Names the channel cannot address
 * safely (rules.isName) are left out.
 */
function listDir(abs, p) {
  var entries;
  try {
    entries = $os.readDir(abs);
  } catch (err) {
    return null;
  }
  var list = [];
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var name = String(entry.name());
    if (!rules.isName(name, p)) {
      continue;
    }
    var info;
    try {
      info = entry.info();
    } catch (err) {
      // Gone between listing and reading.
      continue;
    }
    var attributes = attributesOf(info);
    var kind = rules.entryKind(Number(entry.type()), attributes);
    list.push({
      name: name,
      kind: kind,
      size: kind === 'file' ? Number(info.size()) : 0,
      mtime: Number(info.modTime().unixMilli()),
      offline: rules.isOffline(attributes)
    });
  }
  return list;
}

/** Size, time, attributes and mode of a path below an open root, without following a link; null when missing. */
function statIn(root, rel) {
  try {
    var info = root.lstat(rel);
    return {
      size: Number(info.size()),
      mtime: Number(info.modTime().unixMilli()),
      attributes: attributesOf(info),
      kind: rules.entryKind(Number(info.mode()), attributesOf(info))
    };
  } catch (err) {
    return null;
  }
}

function sameDirectory(a, b) {
  try {
    var first = $os.stat(a);
    var second = $os.stat(b);
    return first.isDir() && second.isDir() && Number(first.modTime().unixMicro()) === Number(second.modTime().unixMicro());
  } catch (err) {
    return false;
  }
}

/**
 * The path with every name as its folder lists it: long names instead of short ones (Windows), the
 * case of the disk. A name that stays unclear keeps its spelling. Only for the folders of the app
 * itself, whose paths the server gives.
 */
function canonicalPath(path, p) {
  var parsed = rules.parseFolderPath(path, p);
  if (parsed.code) {
    return path;
  }
  var split = rules.splitFolderPath(parsed.path, p);
  var current = rules.rootOf(split, p);
  for (var i = 0; i < split.names.length; i++) {
    var name = split.names[i];
    var entries = listDir(current, p);
    var found = null;
    if (entries !== null) {
      for (var e = 0; e < entries.length; e++) {
        if (nameKey(entries[e].name, p) === nameKey(name, p)) {
          found = entries[e].name;
          break;
        }
      }
      if (found === null) {
        // A short name ("CHRIST~1"): the one folder of the parent that is the same folder.
        var alias = rules.joinPath(current, name, p);
        var matches = [];
        for (var m = 0; m < entries.length; m++) {
          if (entries[m].kind === 'dir' && sameDirectory(alias, rules.joinPath(current, entries[m].name, p))) {
            matches.push(entries[m].name);
          }
        }
        if (matches.length === 1) {
          found = matches[0];
        }
      }
    }
    current = rules.joinPath(current, found === null ? name : found, p);
  }
  return current;
}

/**
 * Keys of the folder of the app (the parent of pb_hooks) and of the data folder: no folder may lie
 * in them, and a walk never enters them (ADR-0051 §2). Cached per process.
 */
function ownDirKeys(app, p) {
  var hooks = String($filepath.clean(__hooks));
  var dirs = [];
  var last = rules.nameOf(hooks);
  if (last.toLowerCase() === 'pb_hooks') {
    dirs.push(hooks.slice(0, hooks.length - last.length - 1));
  }
  dirs.push(String($filepath.clean(app.dataDir())));
  var keys = [];
  var store = app.store();
  for (var i = 0; i < dirs.length; i++) {
    var cacheKey = CANONICAL_PREFIX + dirs[i];
    var key = store.get(cacheKey);
    if (typeof key !== 'string' || key === '') {
      key = rules.pathKey(canonicalPath(dirs[i], p), p);
      store.set(cacheKey, key);
    }
    keys.push(key);
  }
  return keys;
}

function insideOwn(ownKeys, abs, p) {
  var key = rules.pathKey(abs, p);
  var sep = rules.separator(p);
  for (var i = 0; i < ownKeys.length; i++) {
    if (key === ownKeys[i] || key.indexOf(ownKeys[i] + sep) === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Walks a folder (ADR-0051 §4): its files that the configuration watches, by name; folders as
 * configured, never through links, never below the app. Returns { files: { rel: { size, mtime,
 * offline } }, listed: { relDir: { name: true } }, matching, incomplete, tooMany }. Only folders
 * listed completely are in `listed`; a missing file counts as gone only there. Throws when the
 * folder itself cannot be listed.
 */
function walk(ctx, config, matcher) {
  var p = ctx.platform;
  var scan = { files: {}, listed: {}, matching: 0, incomplete: false, tooMany: false };
  var stack = [''];
  var visited = 0;
  while (stack.length > 0) {
    if (Date.now() > ctx.deadline) {
      scan.incomplete = true;
      ctx.notes.late = true;
      break;
    }
    var relDir = stack.pop();
    var entries = listDir(rules.joinPath(config.path, relDir, p), p);
    if (entries === null) {
      if (relDir === '') {
        throw new Error(rules.FOLDER_PROBLEMS.unreachable);
      }
      // A subfolder the app may not read: its files stay as they are.
      continue;
    }
    var names = {};
    var dirs = [];
    var stopped = false;
    for (var i = 0; i < entries.length; i++) {
      visited += 1;
      if (visited > ctx.limits.entries) {
        stopped = true;
        break;
      }
      var entry = entries[i];
      // Exact names: a file or folder renamed only in its case is gone under the old name (and
      // the move finds it under the new one).
      names[entry.name] = true;
      var rel = relDir === '' ? entry.name : relDir + '/' + entry.name;
      if (entry.kind === 'dir') {
        if (config.subfolders && !matcher.dir(rel) && !insideOwn(ctx.ownKeys, rules.joinPath(config.path, rel, p), p)) {
          dirs.push(rel);
        }
        continue;
      }
      if (entry.kind !== 'file' || !rules.isWatched(rel, config, matcher)) {
        continue;
      }
      scan.matching += 1;
      scan.files[rel] = { size: entry.size, mtime: entry.mtime, offline: entry.offline };
    }
    if (stopped) {
      scan.incomplete = true;
      scan.tooMany = true;
      break;
    }
    scan.listed[relDir] = names;
    for (var d = dirs.length - 1; d >= 0; d--) {
      stack.push(dirs[d]);
    }
  }
  return scan;
}

/**
 * Whether a stored file is 'gone' (a complete listing of a folder on its way lacks its exact name),
 * 'present' or 'unknown'.
 */
function presence(scan, rel) {
  var names = rel.split('/');
  var dir = '';
  for (var i = 0; i < names.length; i++) {
    if (!hasOwn(scan.listed, dir)) {
      return 'unknown';
    }
    if (!hasOwn(scan.listed[dir], names[i])) {
      return 'gone';
    }
    dir = dir === '' ? names[i] : dir + '/' + names[i];
  }
  return 'present';
}

function copyFiles(files) {
  var copy = {};
  for (var rel in files) {
    if (hasOwn(files, rel) && isArray(files[rel])) {
      copy[rel] = files[rel].slice();
    }
  }
  return copy;
}

function countOf(files) {
  var count = 0;
  for (var rel in files) {
    if (hasOwn(files, rel)) {
      count += 1;
    }
  }
  return count;
}

/**
 * One folder of a run: the walk, the comparison with its state and the hashes of what differs.
 * Returns { config, state, removed, added, changed, more } (the lists as { folder, rel, size,
 * mtime, sha }); the state holds the files that stay, the connection applies the rest.
 */
function scanFolder(ctx, config, previous) {
  var p = ctx.platform;
  if (insideOwn(ctx.ownKeys, config.path, p)) {
    throw new Error(rules.FOLDER_PROBLEMS.app);
  }
  var matcher = rules.excludeMatcher(config.exclude, p);
  var scan = walk(ctx, config, matcher);
  var result = { config: config, removed: [], added: [], changed: [], more: false, scan: scan };
  var known = previous && isPlainObject(previous.files) ? previous.files : null;
  if (known === null) {
    // First run of the folder: the current files are the base, no entries (ADR-0051 §3).
    var base = {};
    var count = 0;
    for (var rel in scan.files) {
      if (!hasOwn(scan.files, rel)) {
        continue;
      }
      if (count >= ctx.limits.files) {
        result.more = true;
        break;
      }
      base[rel] = [scan.files[rel].size, scan.files[rel].mtime, ''];
      count += 1;
    }
    result.state = {
      files: base,
      base_at: iso(ctx.now),
      matching: scan.matching,
      incomplete: scan.incomplete,
      last_change: null
    };
    return result;
  }
  var diff = rules.scanDiff(known, scan.files);
  var files = copyFiles(known);
  for (var m = 0; m < diff.missing.length; m++) {
    var missing = diff.missing[m];
    if (!rules.isRelative(missing, p) || !rules.isWatched(missing, config, matcher)) {
      // No longer watched (subfolders, types or exclusions changed): it leaves without "gone".
      delete files[missing];
      continue;
    }
    if (presence(scan, missing) === 'gone') {
      var old = known[missing];
      result.removed.push({ folder: config.key, rel: missing, size: old[0], mtime: old[1], sha: text(old[2]) });
    }
  }
  var room = ctx.limits.files - countOf(files) + result.removed.length;
  var candidates = [];
  for (var s = 0; s < diff.suspect.length; s++) {
    candidates.push({ rel: diff.suspect[s], isNew: false });
  }
  for (var a = 0; a < diff.added.length; a++) {
    if (room > 0) {
      candidates.push({ rel: diff.added[a], isNew: true });
      room -= 1;
    } else {
      result.more = true;
    }
  }
  var root = null;
  try {
    root = $os.openRoot(config.path);
  } catch (err) {
    root = null;
  }
  try {
    var plan = [];
    var toHash = [];
    for (var c = 0; c < candidates.length; c++) {
      var seen = scan.files[candidates[c].rel];
      var item = { rel: candidates[c].rel, isNew: candidates[c].isNew, size: seen.size, mtime: seen.mtime, sha: '', hashed: false };
      if (seen.offline || seen.size > ctx.limits.hashBytes || root === null) {
        // Compared by size and time only: above the limit, or a placeholder of a cloud storage
        // that reading would download.
        plan.push(item);
        continue;
      }
      if (ctx.budget.files <= 0 || ctx.budget.bytes < seen.size || Date.now() > ctx.deadline) {
        ctx.notes.deferred += 1;
        continue;
      }
      ctx.budget.files -= 1;
      ctx.budget.bytes -= seen.size;
      item.hashed = true;
      toHash.push({ rel: item.rel, abs: rules.joinPath(config.path, item.rel, p), size: item.size });
      plan.push(item);
    }
    var shas = toHash.length > 0 ? hashes.hashFiles(root, toHash, p, ctx.limits) : {};
    for (var i = 0; i < plan.length; i++) {
      var entry = plan[i];
      if (entry.hashed) {
        var after = statIn(root, entry.rel);
        if (after === null || after.size !== entry.size || after.mtime !== entry.mtime) {
          // Written to right now: the next run sees the finished file.
          ctx.notes.deferred += 1;
          continue;
        }
        // An unreadable file (locked, no permission) is compared by size and time.
        entry.sha = text(shas[entry.rel]);
      }
      var record = { folder: config.key, rel: entry.rel, size: entry.size, mtime: entry.mtime, sha: entry.sha };
      if (entry.isNew) {
        result.added.push(record);
        continue;
      }
      var stored = known[entry.rel];
      if (entry.sha !== '' && text(stored[2]) === entry.sha) {
        // Only touched: the content is the same.
        files[entry.rel] = [entry.size, entry.mtime, entry.sha];
        continue;
      }
      result.changed.push(record);
    }
  } finally {
    if (root !== null) {
      root.close();
    }
  }
  result.state = {
    files: files,
    base_at: text(previous.base_at) || iso(ctx.now),
    matching: scan.matching,
    incomplete: scan.incomplete,
    last_change: isPlainObject(previous.last_change) ? previous.last_change : null
  };
  return result;
}

/** The target project a folder gives its entries (ADR-0049 §3): its own, if it still exists in the area. */
function folderTarget(ctx, config) {
  if (config.target === '') {
    return undefined;
  }
  if (!hasOwn(ctx.targets, config.target)) {
    var facts = targets.projectFacts(ctx.app, config.target);
    ctx.targets[config.target] = facts !== null && facts.scope === ctx.scope;
  }
  // A deleted target (or one of another area) counts as none: the target of the connection applies.
  return ctx.targets[config.target] ? config.target : undefined;
}

/** Saves an entry; counts it as created, duplicate, skipped or failed. Never logs a path. */
function ingest(ctx, config, draft) {
  if (draft.source_ref.length > rules.LIMITS.refLength) {
    ctx.outcome.skipped += 1;
    return null;
  }
  ctx.newLeft -= 1;
  try {
    var saved = inbox.ingest(ctx.app, ctx.owner, {
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
      target: folderTarget(ctx, config)
    });
    if (saved.kind === 'created') {
      ctx.outcome.created += 1;
    } else {
      ctx.outcome.duplicates += 1;
    }
    return saved;
  } catch (err) {
    ctx.outcome.failed += 1;
    ctx.app.logger().warn(AREA + ': Eintrag nicht angelegt', 'connection', ctx.record.id, 'error', String(err && err.message ? err.message : err));
    return null;
  }
}

/** The entries of one file (source_ref) in the area of the connection. */
function entriesOf(ctx, abs) {
  return ctx.app.findRecordsByFilter(INBOX, 'scope = {:scope} && channel = "folder" && source_ref = {:ref}', 'created', 0, 0, {
    scope: ctx.itemScope,
    ref: abs
  });
}

/**
 * Updates the status of the entries of one file: `next(item, meta, previous)` gives the new status
 * or null to keep it; `ref` a new reference (a move) or ''. Only the entry is saved, never its
 * ticket (ADR-0050 §5).
 */
function updateEntries(ctx, abs, ref, next) {
  var items = entriesOf(ctx, abs);
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!inbox.hasField(item, inbox.WATCH_FIELD)) {
      continue;
    }
    var meta = inbox.metaOf(item);
    var folder = isPlainObject(meta.folder) ? meta.folder : {};
    var previous = inbox.watchOf(item);
    var status = next(item, folder, previous);
    var moved = ref !== '' && ref !== item.getString('source_ref');
    if (!moved && (status === null || rules.sameWatch(previous, status))) {
      continue;
    }
    try {
      if (moved) {
        item.set('source_ref', ref);
      }
      if (status !== null) {
        item.set(inbox.WATCH_FIELD, status);
      }
      ctx.app.save(item);
      ctx.outcome.updated += 1;
    } catch (err) {
      ctx.outcome.failed += 1;
    }
  }
}

/** Earlier entries of a file follow it: current or changed since (`version` null: gone). */
function followFile(ctx, abs, version, at) {
  updateEntries(ctx, abs, '', function (item, folder, previous) {
    if (text(folder.version) === '') {
      return null;
    }
    return rules.fileWatch(text(folder.version), version === null ? null : { version: version, at: at }, iso(ctx.now), previous);
  });
}

/** The newest change of a folder for its card: the later of the stored one and `change`. */
function noteChange(state, change) {
  var before = isPlainObject(state.last_change) ? Date.parse(text(state.last_change.at)) : NaN;
  var at = Date.parse(change.at);
  if (isNaN(before) || isNaN(at) || at >= before) {
    state.last_change = change;
  }
}

/**
 * The changes of all folders of a run, after the scans (ADR-0051 §3 to §5): moves, new and
 * changed files as entries, removed files as status of their entries; the state of each folder.
 */
function applyChanges(ctx, results) {
  var p = ctx.platform;
  var byKey = {};
  var removed = [];
  var added = [];
  for (var r = 0; r < results.length; r++) {
    byKey[results[r].config.key] = results[r];
    removed = removed.concat(results[r].removed);
    added = added.concat(results[r].added);
  }
  var now = iso(ctx.now);
  var matched = rules.matchMoves(removed, added);
  for (var m = 0; m < matched.moves.length; m++) {
    var move = matched.moves[m];
    var from = byKey[move.from.folder];
    var to = byKey[move.to.folder];
    delete from.state.files[move.from.rel];
    to.state.files[move.to.rel] = [move.to.size, move.to.mtime, move.to.sha];
    var version = rules.versionOf(move.to);
    var target = rules.joinPath(to.config.path, move.to.rel, p);
    var folderName = to.config.name;
    updateEntries(ctx, rules.joinPath(from.config.path, move.from.rel, p), target, function (item, folder) {
      return text(folder.version) === '' ? null : rules.movedWatch(text(folder.version), version, move.to.rel, folderName, now);
    });
    noteChange(to.state, { path: move.to.rel, action: 'moved', at: now, from: move.from.rel });
  }
  for (var a = 0; a < matched.added.length; a++) {
    var file = matched.added[a];
    var owner = byKey[file.folder];
    if (ctx.newLeft <= 0) {
      // More new files than one run takes: the rest comes with the next run.
      ctx.notes.deferred += 1;
      continue;
    }
    owner.state.files[file.rel] = [file.size, file.mtime, file.sha];
    var abs = rules.joinPath(owner.config.path, file.rel, p);
    var fileVersion = rules.versionOf(file);
    ingest(
      ctx,
      owner.config,
      rules.fileDraft(
        { folder: { path: owner.config.path, name: owner.config.name }, rel: file.rel, abs: abs, size: file.size, mtime: file.mtime, version: fileVersion, action: 'added', detectedAt: now, platform: p },
        berlin
      )
    );
    // A file that comes back (restored): its earlier entries show it again.
    followFile(ctx, abs, fileVersion, iso(file.mtime));
    noteChange(owner.state, { path: file.rel, action: 'added', at: iso(file.mtime) });
  }
  for (var r2 = 0; r2 < results.length; r2++) {
    var result = results[r2];
    for (var c = 0; c < result.changed.length; c++) {
      var changed = result.changed[c];
      if (result.config.reportChanges && ctx.newLeft <= 0) {
        ctx.notes.deferred += 1;
        continue;
      }
      result.state.files[changed.rel] = [changed.size, changed.mtime, changed.sha];
      var changedAbs = rules.joinPath(result.config.path, changed.rel, p);
      var changedVersion = rules.versionOf(changed);
      if (result.config.reportChanges) {
        ingest(
          ctx,
          result.config,
          rules.fileDraft(
            {
              folder: { path: result.config.path, name: result.config.name },
              rel: changed.rel,
              abs: changedAbs,
              size: changed.size,
              mtime: changed.mtime,
              version: changedVersion,
              action: 'changed',
              detectedAt: now,
              platform: p
            },
            berlin
          )
        );
      }
      followFile(ctx, changedAbs, changedVersion, iso(changed.mtime));
      noteChange(result.state, { path: changed.rel, action: 'changed', at: iso(changed.mtime) });
    }
  }
  for (var g = 0; g < matched.removed.length; g++) {
    var gone = matched.removed[g];
    var holder = byKey[gone.folder];
    delete holder.state.files[gone.rel];
    followFile(ctx, rules.joinPath(holder.config.path, gone.rel, p), null, now);
    noteChange(holder.state, { path: gone.rel, action: 'removed', at: now });
  }
  for (var f = 0; f < results.length; f++) {
    // More files than watched: the limit is reached (files left for the next run are no reason).
    var state = results[f].state;
    var count = countOf(state.files);
    state.more = results[f].more || (count >= ctx.limits.files && state.matching > count);
    if (state.more) {
      ctx.notes.more += 1;
    }
  }
}

/**
 * One run of a folder connection (channel-runner.js). Returns { created, duplicates, updated,
 * skipped, failed, unmatched, error, hint, watch }: `updated` counts entries whose status changed,
 * `watch` the new state only when it changed (a run without a change writes nothing). Problems of a
 * folder stand in its details; `error` stays empty (a folder is no access of the connection).
 */
function run(app, record, access, options) {
  var now = Date.now();
  var p = platform();
  var testMode = app.store().get(rules.TEST_MODE_KEY) === true;
  var limits = rules.limitsOf(testMode, $os.getenv(rules.TEST_LIMITS_ENV));
  var settings = rules.settingsOf(jsonOf(record, 'settings'), p);
  var state = hasWatchField(record) ? rules.stateOf(record.getString('watch')) : rules.stateOf(null);
  var outcome = { created: 0, duplicates: 0, updated: 0, skipped: 0, failed: 0, unmatched: 0, error: '' };
  var ctx = {
    app: app,
    record: record,
    platform: p,
    limits: limits,
    now: now,
    deadline: now + limits.runMs,
    owner: record.getString('owner'),
    scope: record.getString('scope'),
    itemScope: 'u:' + record.getString('owner'),
    outcome: outcome,
    targets: {},
    ownKeys: ownDirKeys(app, p),
    budget: { files: limits.hashFiles, bytes: limits.hashBudgetBytes },
    newLeft: limits.newPerRun,
    notes: { late: false, deferred: 0, more: 0 }
  };
  var folders = {};
  var results = [];
  var problems = 0;
  var pending = 0;
  for (var i = 0; i < settings.folders.length; i++) {
    var config = settings.folders[i];
    var previous = isPlainObject(state.folders[config.key]) ? state.folders[config.key] : null;
    if (Date.now() > ctx.deadline) {
      var waiting = previous === null ? {} : JSON.parse(JSON.stringify(previous));
      waiting.pending = true;
      folders[config.key] = waiting;
      pending += 1;
      continue;
    }
    try {
      results.push(scanFolder(ctx, config, previous));
    } catch (err) {
      var kept = previous === null ? {} : JSON.parse(JSON.stringify(previous));
      kept.error = String(err && err.message ? err.message : err);
      delete kept.pending;
      folders[config.key] = kept;
      problems += 1;
    }
  }
  applyChanges(ctx, results);
  for (var r = 0; r < results.length; r++) {
    var folderState = results[r].state;
    if (results[r].scan.incomplete && ctx.notes.late) {
      pending += 1;
    }
    folders[results[r].config.key] = folderState;
  }
  var next = { folders: folders };
  if (!hasWatchField(record) || rules.stableJson(next) !== rules.stableJson(state)) {
    outcome.watch = next;
  }
  outcome.hint = rules.runHint({
    folders: settings.folders.length,
    errors: problems,
    pending: pending,
    deferred: ctx.notes.deferred,
    more: ctx.notes.more,
    limit: limits.files
  });
  return outcome;
}

/**
 * Cron (every minute): runs every switched-on folder connection whose interval has passed, one
 * after the other, through the runner (lock, result). Returns the number of runs. Never throws;
 * before the migration or without connections it does nothing.
 */
function runDue(app, now) {
  var found;
  try {
    found = app.findRecordsByFilter(COLLECTION, 'type = "folder" && enabled = true', 'created', 0, 0);
  } catch (err) {
    return 0;
  }
  var runner = require(__hooks + '/lib/channel-runner.js');
  var p = platform();
  var runs = 0;
  for (var i = 0; i < found.length; i++) {
    var record = found[i];
    try {
      var settings = rules.settingsOf(jsonOf(record, 'settings'), p);
      if (!rules.isDue(record.getString('last_run_at'), settings.interval, now)) {
        continue;
      }
      runner.runConnection(app, record, { now: now });
      runs += 1;
    } catch (err) {
      app.logger().warn(AREA + ': Lauf nicht gestartet', 'connection', record.id);
    }
  }
  return runs;
}

/**
 * The ID of a folder in the routes of the card: the start of a hash of its key, so no path stands
 * in an address (PocketBase logs the address of every request).
 */
function folderId(key) {
  return String($security.sha256('folder|' + key)).slice(0, 16);
}

/** The details of the folders of a connection for its card (ADR-0051 §7), from the stored state. */
function summary(record) {
  var p = platform();
  var settings = rules.settingsOf(jsonOf(record, 'settings'), p);
  var state = hasWatchField(record) ? rules.stateOf(record.getString('watch')) : rules.stateOf(null);
  var folders = [];
  for (var i = 0; i < settings.folders.length; i++) {
    var folder = rules.folderSummary(settings.folders[i], state.folders[settings.folders[i].key]);
    folder.id = folderId(settings.folders[i].key);
    folders.push(folder);
  }
  return { interval: settings.interval, platform: p, limit: rules.LIMITS.files, folders: folders };
}

/** The configuration of the folder with the ID `id` (folderId), or null. */
function configOf(record, id, p) {
  var folders = rules.settingsOf(jsonOf(record, 'settings'), p).folders;
  for (var i = 0; i < folders.length; i++) {
    if (folderId(folders[i].key) === id) {
      return folders[i];
    }
  }
  return null;
}

/**
 * The files of a folder from its state, for "Vorhandene Dateien übernehmen" (ADR-0051 §3): each
 * with path, name, size, time and the state of its newest entry ('' without). null for an unknown
 * folder (`id` as folderId).
 */
function existing(app, record, id) {
  var p = platform();
  var config = configOf(record, id, p);
  if (config === null) {
    return null;
  }
  var stored = hasWatchField(record) ? rules.stateOf(record.getString('watch')).folders[config.key] : null;
  var files = stored && isPlainObject(stored.files) ? stored.files : {};
  var states = {};
  var items = app.findRecordsByFilter(INBOX, 'scope = {:scope} && channel = "folder"', '-created', 0, 0, {
    scope: 'u:' + record.getString('owner')
  });
  for (var i = 0; i < items.length; i++) {
    var rel = rules.relativeOf(config.path, items[i].getString('source_ref'), p);
    if (rel !== null && !hasOwn(states, rel)) {
      states[rel] = items[i].getString('state');
    }
  }
  var list = [];
  var names = [];
  for (var name in files) {
    if (hasOwn(files, name) && isArray(files[name])) {
      names.push(name);
    }
  }
  names.sort();
  for (var n = 0; n < names.length; n++) {
    var entry = files[names[n]];
    list.push({
      path: names[n],
      name: rules.nameOf(names[n]),
      size: Number(entry[0]) || 0,
      modified: iso(Number(entry[1]) || 0),
      state: hasOwn(states, names[n]) ? states[names[n]] : ''
    });
  }
  return { folder: config.path, name: config.name, base: !!(stored && stored.base_at), files: list };
}

/**
 * "Vorhandene Dateien übernehmen" (ADR-0051 §3): entries for chosen files that were there before
 * (at most LIMITS.adoptBatch per request; only files the state holds and the folder still has).
 * Returns { status: 'ok', created, duplicates, skipped, failed } or { status: 'invalid' | 'unknown' |
 * 'unreachable' }. `id` as folderId.
 */
function adopt(app, record, id, paths) {
  var p = platform();
  var testMode = app.store().get(rules.TEST_MODE_KEY) === true;
  var limits = rules.limitsOf(testMode, $os.getenv(rules.TEST_LIMITS_ENV));
  var config = configOf(record, id, p);
  if (config === null) {
    return { status: 'unknown' };
  }
  if (!isArray(paths) || paths.length === 0 || paths.length > limits.adoptBatch) {
    return { status: 'invalid' };
  }
  var stored = hasWatchField(record) ? rules.stateOf(record.getString('watch')).folders[config.key] : null;
  var files = stored && isPlainObject(stored.files) ? stored.files : {};
  var root;
  try {
    root = $os.openRoot(config.path);
  } catch (err) {
    return { status: 'unreachable' };
  }
  var outcome = { created: 0, duplicates: 0, updated: 0, skipped: 0, failed: 0, unmatched: 0 };
  var ctx = {
    app: app,
    record: record,
    owner: record.getString('owner'),
    scope: record.getString('scope'),
    itemScope: 'u:' + record.getString('owner'),
    outcome: outcome,
    targets: {},
    newLeft: paths.length
  };
  var matcher = rules.excludeMatcher(config.exclude, p);
  var now = iso(Date.now());
  try {
    for (var i = 0; i < paths.length; i++) {
      var rel = paths[i];
      if (typeof rel !== 'string' || !rules.isRelative(rel, p) || !hasOwn(files, rel) || !rules.isWatched(rel, config, matcher)) {
        outcome.skipped += 1;
        continue;
      }
      var info = statIn(root, rel);
      if (info === null || info.kind !== 'file') {
        outcome.skipped += 1;
        continue;
      }
      var abs = rules.joinPath(config.path, rel, p);
      var sha = '';
      if (!rules.isOffline(info.attributes) && info.size <= limits.hashBytes) {
        sha = text(hashes.hashFiles(root, [{ rel: rel, abs: abs, size: info.size }], p, limits)[rel]);
        var after = statIn(root, rel);
        if (after === null || after.size !== info.size || after.mtime !== info.mtime) {
          sha = '';
        }
      }
      var version = rules.versionOf({ sha: sha, size: info.size, mtime: info.mtime });
      ingest(
        ctx,
        config,
        rules.fileDraft(
          { folder: { path: config.path, name: config.name }, rel: rel, abs: abs, size: info.size, mtime: info.mtime, version: version, action: 'existing', detectedAt: now, platform: p },
          berlin
        )
      );
    }
  } finally {
    root.close();
  }
  return { status: 'ok', created: outcome.created, duplicates: outcome.duplicates, skipped: outcome.skipped, failed: outcome.failed };
}

/**
 * The problem of a folder path on the disk, '' for none (ADR-0051 §2): every name as its parent
 * lists it (no short name, no alias), every one a real folder (no link, no junction), the folder
 * readable, not the folder of the app or below it.
 */
function folderProblem(path, p, ownKeys) {
  var split = rules.splitFolderPath(path, p);
  var current = rules.rootOf(split, p);
  for (var i = 0; i < split.names.length; i++) {
    var name = split.names[i];
    var entries = listDir(current, p);
    if (entries === null) {
      return i === 0 ? 'validation_folder_missing' : 'validation_folder_unreadable';
    }
    var match = null;
    for (var e = 0; e < entries.length; e++) {
      if (nameKey(entries[e].name, p) === nameKey(name, p)) {
        match = entries[e];
        break;
      }
    }
    if (match === null) {
      try {
        $os.stat(rules.joinPath(current, name, p));
        return 'validation_folder_alias';
      } catch (err) {
        return 'validation_folder_missing';
      }
    }
    if (match.kind === 'link') {
      return 'validation_folder_link';
    }
    if (match.kind !== 'dir') {
      return 'validation_folder_missing';
    }
    current = rules.joinPath(current, match.name, p);
  }
  if (listDir(current, p) === null) {
    return split.names.length === 0 ? 'validation_folder_missing' : 'validation_folder_unreadable';
  }
  return insideOwn(ownKeys, current, p) ? 'validation_folder_app' : '';
}

/**
 * Request hook of a folder connection (connection-service.js): every folder that is new in
 * `after` must exist, be readable, be reached without links and lie outside the app. Throws a
 * field error of `settings`.
 */
function assertNewFolders(app, before, after) {
  var p = platform();
  var added = rules.addedFolders(before, after, p);
  if (added.length === 0) {
    return;
  }
  var ownKeys = ownDirKeys(app, p);
  for (var i = 0; i < added.length; i++) {
    var code = folderProblem(added[i].path, p, ownKeys);
    if (code !== '') {
      // Without the path: PocketBase logs the data of a refused request.
      throw errors.fieldFailure('settings', code, rules.MESSAGES[code]);
    }
  }
}

/** The new target projects of folders in `after`: each must be an active project of the area. */
function changedTargets(before, after) {
  return rules.changedTargets(before, after, platform());
}

/** The rules of the settings for the platform of this server (connection-rules.js). */
function settingsRules() {
  var p = platform();
  return {
    settingsViolation: function (value) {
      return rules.settingsViolation(value, p);
    }
  };
}

// ---------------------------------------------------------------------------------------------
// "Ansehen": the current file of an entry (ADR-0051 §6).

function userOf(e) {
  return e.auth ? String(e.auth.id) : '';
}

/** A refusal of a file request, logged with reason, user and entry, never with a path. */
function refuseFile(e, reason, id) {
  e.app.logger().warn(AREA + ': Datei abgelehnt', 'reason', reason, 'user', userOf(e), 'item', String(id));
  var answer = rules.fileRefusal(reason);
  return e.json(answer.status, answer.body);
}

/**
 * The checks of the page System (ADR-0043): this machine, the address of the app, the owner of the
 * instance, a rate limit of its own; on any server. Returns the answer of a refusal or null.
 */
function guard(e) {
  var system = require(__hooks + '/lib/system-service.js');
  var context = system.check(e, ROUTE, 'GET', { local: true, anyPlatform: true, kind: 'file' });
  return context.refused ? system.refuse(e, ROUTE, context.refused, context.retryAfterSeconds, AREA) : null;
}

/** The entry `id` of the folder channel if the request may see it, else null. */
function itemFor(e, id) {
  var collection;
  try {
    collection = e.app.findCollectionByNameOrId(INBOX);
  } catch (err) {
    return null;
  }
  var found = e.app.findRecordsByFilter(INBOX, 'id = {:id}', '', 1, 0, { id: String(id) });
  if (found.length === 0 || found[0].getString('channel') !== 'folder') {
    return null;
  }
  return e.app.canAccessRecord(found[0], e.requestInfo(), collection.viewRule) ? found[0] : null;
}

/**
 * The file of an entry: { reason } or { config, rel, name, info, root } with the root of its folder
 * open. The path of the entry must lie in a folder of a folder connection of its area (the deepest
 * that holds it), be a valid path below it, be watched by that folder (subfolders, types,
 * exclusions), and every name on the way must be listed by its folder as it is (no short name, no
 * alias), a real folder resp. a regular file (no link, no junction). The file is then opened
 * through the root of the folder (os.Root: nothing leads out of it, also not by a change meanwhile).
 */
function resolveFile(e, item) {
  var p = platform();
  var abs = item.getString('source_ref');
  var connections = e.app.findRecordsByFilter(COLLECTION, 'type = "folder" && scope = {:scope}', 'created', 0, 0, {
    scope: item.getString('scope')
  });
  var best = null;
  var rel = null;
  for (var c = 0; c < connections.length; c++) {
    var folders = rules.settingsOf(jsonOf(connections[c], 'settings'), p).folders;
    for (var f = 0; f < folders.length; f++) {
      var below = rules.relativeOf(folders[f].path, abs, p);
      if (below !== null && (best === null || folders[f].path.length > best.path.length)) {
        best = folders[f];
        rel = below;
      }
    }
  }
  if (best === null) {
    return { reason: 'folder' };
  }
  if (!rules.isRelative(rel, p)) {
    return { reason: 'path' };
  }
  if (!rules.isWatched(rel, best, rules.excludeMatcher(best.exclude, p))) {
    return { reason: 'folder' };
  }
  var names = rel.split('/');
  var walked = '';
  for (var i = 0; i < names.length; i++) {
    var entries = listDir(rules.joinPath(best.path, walked, p), p);
    if (entries === null) {
      return { reason: i === 0 ? 'missing' : 'unreadable' };
    }
    var match = null;
    for (var n = 0; n < entries.length; n++) {
      if (nameKey(entries[n].name, p) === nameKey(names[i], p)) {
        match = entries[n];
        break;
      }
    }
    var next = walked === '' ? names[i] : walked + '/' + names[i];
    if (match === null) {
      try {
        $os.stat(rules.joinPath(best.path, next, p));
        return { reason: 'path' };
      } catch (err) {
        return { reason: 'missing' };
      }
    }
    if (match.kind === 'link') {
      return { reason: 'link' };
    }
    if (match.kind !== (i === names.length - 1 ? 'file' : 'dir')) {
      return { reason: 'missing' };
    }
    walked = walked === '' ? match.name : walked + '/' + match.name;
  }
  var root;
  try {
    root = $os.openRoot(best.path);
  } catch (err) {
    return { reason: 'missing' };
  }
  var info = statIn(root, walked);
  if (info === null || info.kind !== 'file') {
    root.close();
    return { reason: info === null ? 'missing' : 'link' };
  }
  return { config: best, rel: walked, name: rules.nameOf(walked), info: info, root: root };
}

/**
 * GET /api/byl/folders/items/{id}: whether the file of an entry can be shown, with its current
 * size and time and the address of the file route (with a file token of PocketBase, valid for a
 * few minutes). Nothing is read from the file.
 */
function itemInfo(e, id) {
  var refused = guard(e);
  if (refused !== null) {
    return refused;
  }
  var item = itemFor(e, id);
  if (item === null) {
    return refuseFile(e, 'unknown', id);
  }
  var file = resolveFile(e, item);
  if (file.reason) {
    return refuseFile(e, file.reason, id);
  }
  file.root.close();
  var content = rules.contentOf(file.name);
  return e.json(200, {
    status: 'ok',
    name: file.name,
    path: file.rel,
    folder: file.config.name,
    size: file.info.size,
    modified: iso(file.info.mtime),
    inline: content.inline,
    url: '/api/byl/folders/items/' + encodeURIComponent(String(id)) + '/file?token=' + encodeURIComponent(String(e.auth.newFileToken()))
  });
}

/**
 * GET /api/byl/folders/items/{id}/file: the current file of an entry, read only. The browser opens
 * it as a link, so a file token of PocketBase (?token=, from itemInfo) stands for the session.
 * PDF, images and text are shown in the browser, everything else is downloaded (rules.contentOf);
 * `download=1` downloads every file. Always the whole file, never cached.
 */
function serveFile(e, id) {
  if (!e.auth) {
    var token = String(e.request.url.query().get('token') || '');
    if (token !== '') {
      try {
        var record = e.app.findAuthRecordByToken(token, 'file');
        if (record && record.collection().name === 'users') {
          e.auth = record;
        }
      } catch (err) {
        // An expired or foreign token: no session.
      }
    }
  }
  if (!e.auth || e.auth.collection().name !== 'users') {
    return refuseFile(e, 'auth', id);
  }
  var refused = guard(e);
  if (refused !== null) {
    return refused;
  }
  var item = itemFor(e, id);
  if (item === null) {
    return refuseFile(e, 'unknown', id);
  }
  var file = resolveFile(e, item);
  if (file.reason) {
    return refuseFile(e, file.reason, id);
  }
  var content = rules.contentOf(file.name);
  var inline = content.inline && String(e.request.url.query().get('download') || '') !== '1';
  var names = ['Content-Type', 'Content-Disposition', 'X-Content-Type-Options', 'Cache-Control', 'Cross-Origin-Resource-Policy', 'Referrer-Policy', 'Content-Security-Policy'];
  var header = e.response.header();
  header.set('Content-Type', content.type);
  header.set('Content-Disposition', rules.contentDisposition(file.name, inline));
  header.set('X-Content-Type-Options', 'nosniff');
  header.set('Cache-Control', 'no-store');
  header.set('Cross-Origin-Resource-Policy', 'same-origin');
  header.set('Referrer-Policy', 'no-referrer');
  if (content.policy !== '') {
    header.set('Content-Security-Policy', content.policy);
  }
  for (var h = 0; h < CONDITIONAL_HEADERS.length; h++) {
    e.request.header.del(CONDITIONAL_HEADERS[h]);
  }
  try {
    return e.fileFS(file.root.fs(), file.rel);
  } catch (err) {
    // Gone between the checks and opening it.
    for (var n = 0; n < names.length; n++) {
      header.del(names[n]);
    }
    return refuseFile(e, 'missing', id);
  } finally {
    file.root.close();
  }
}

module.exports = {
  run: run,
  runDue: runDue,
  summary: summary,
  existing: existing,
  adopt: adopt,
  assertNewFolders: assertNewFolders,
  changedTargets: changedTargets,
  settingsRules: settingsRules,
  itemInfo: itemInfo,
  serveFile: serveFile
};
