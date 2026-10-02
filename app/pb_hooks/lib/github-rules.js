// Pure rules of the GitHub channel (ADR-0050, plan beobachtete-quellen, package 2): the fixed API,
// its limits, the settings of the repositories (watched paths as globs, events, target project),
// the German messages of its errors, the rate limit, which watched files changed, the entries of
// the inbox (a changed file with commits, line counts, a short diff and a copy of the new content,
// a pull request, a release) and the status a watched source shows (ADR-0050 §5: only shown, a
// ticket never changes). GitHub is only read: no function here or in github-client.js writes.
// CommonJS module, ES5 only, no dependencies; the callers pass berlin-time.js as `berlin`
// (Goja runtime and Vitest load the module the same way).
'use strict';

// Official REST API on a fixed host, version 2022-11-28; links of the entries go to github.com.
var API_BASE = 'https://api.github.com';
var WEB_BASE = 'https://github.com';
var API_VERSION = '2022-11-28';
// Tests only: with the mark of the test mode (set by a hook of tests/fixtures/pb_hooks, never part
// of the app folder) this variable names the port of a fake server on 127.0.0.1, and the other one
// may shorten the time of a run in milliseconds.
var TEST_PORT_ENV = 'BYL_TEST_GITHUB_PORT';
var TEST_TIMING_ENV = 'BYL_TEST_GITHUB_TIMING';
var TEST_MODE_KEY = 'byl-test-mode';
var DEFAULT_SECRET_ENV = 'BYL_GITHUB_TOKEN';

// Watched paths a new repository starts with (ADR-0050 §2); `docs/**/*.md` is offered, not set.
var DEFAULT_PATHS = ['ROADMAP*', 'CHANGELOG*', 'README*', 'docs/**/roadmap*'];
var OPTIONAL_PATHS = ['docs/**/*.md'];
// Events of a repository, each on unless switched off.
var EVENTS = ['files', 'pulls', 'releases'];

var LIMITS = Object.freeze({
  // Repositories of one connection and watched patterns of one repository.
  repos: 20,
  paths: 20,
  pathLength: 200,
  // Watched files per repository (in the order of their paths); more are counted, not watched.
  files: 300,
  // Minutes between two runs of the cron: default, least and most.
  intervalDefault: 15,
  intervalMin: 5,
  intervalMax: 60,
  // Results per page and pages per list in one run (pull requests, releases).
  perPage: 100,
  pages: 10,
  // Open pull requests taken over on the first run of a repository (ADR-0050 §4).
  firstPulls: 20,
  // Changed files of one repository and run that get commits and a copy of their content; the
  // others get an entry with the line counts only (and come with their copy in no later run).
  detailedFiles: 20,
  // Commits named in an entry, and read per changed file.
  commits: 10,
  commitPage: 30,
  // Copy of a changed file: like the copy of a page (ADR-0031 §6), at most 2 MB as file and the
  // text in the entry within the 100 000 characters of the body.
  copyBytes: 2 * 1024 * 1024,
  bodyChars: 100000,
  // Text of a pull request or release taken into its entry.
  noteChars: 20000,
  // Short diff of a changed file (ADR-0050 §3): the first lines of the patch.
  diffLines: 40,
  diffChars: 4000,
  // Answers above this size are dropped (like the other channels).
  responseBytes: 20 * 1024 * 1024,
  // Seconds per request and per run (a run starts no request later than this after it began).
  timeoutSeconds: 20,
  runSeconds: 60,
  // Hours after which the data of a repository (default branch) are read again.
  repoInfoHours: 6,
  // Secondary rate limit without Retry-After: wait at least a minute, doubling up to 15 minutes.
  secondaryWaitSeconds: 60,
  secondaryMaxSeconds: 900,
  // Length of source_ref of an entry (schema of inbox_items).
  refLength: 500
});

var MESSAGES = {
  validation_github_settings: 'Unbekannte Einstellung des GitHub-Kanals.',
  validation_github_interval: 'Abruf alle 5 bis 60 Minuten.',
  validation_github_repos_max: 'Höchstens 20 Repositorys je Verbindung.',
  validation_github_repo: 'Repository als „Besitzer/Name“, etwa „octo-org/roadmap“.',
  validation_github_repo_duplicate: 'Dieses Repository ist schon eingetragen.',
  validation_github_paths: 'Pfade als Liste von höchstens 20 Mustern, je bis 200 Zeichen, etwa „CHANGELOG*“ oder „docs/**/*.md“; ohne „/“ am Anfang, ohne „..“, ohne [ ] { } !.',
  validation_github_events: 'Ereignisse nur „files“, „pulls“ und „releases“, je an oder aus.',
  validation_github_target: 'Zielprojekt als ID eines Projekts oder leer.'
};

var OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
var NAME = /^[A-Za-z0-9._-]{1,100}$/;
var RECORD_ID = /^[a-z0-9]{15}$/;
var NODE_ID = /^[A-Za-z0-9_=-]{1,100}$/;
var SHA = /^[0-9a-f]{40}$/;

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function trim(value) {
  return text(value).replace(/^\s+|\s+$/g, '');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

function isArray(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function keysOf(object) {
  var keys = [];
  for (var key in object) {
    if (hasOwn(object, key)) {
      keys.push(key);
    }
  }
  return keys;
}

function failure(code) {
  return { field: 'settings', code: code, message: MESSAGES[code] };
}

/** Whether `value` is "owner/name" of a repository (no address, no ".git"). */
function isRepoName(value) {
  if (typeof value !== 'string') {
    return false;
  }
  var parts = value.split('/');
  return (
    parts.length === 2 &&
    OWNER.test(parts[0]) &&
    NAME.test(parts[1]) &&
    parts[1] !== '.' &&
    parts[1] !== '..' &&
    !/\.git$/i.test(parts[1])
  );
}

/**
 * "owner/name" from what a user types or pastes: the name itself, or an address of the repository
 * on github.com (also without scheme, with ".git", a trailing "/" or a deeper page such as
 * "/tree/main/docs"). '' for anything else.
 */
function parseRepo(input) {
  var value = trim(input);
  var match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/\s?#]+)\/([^\/\s?#]+)(?:[\/?#].*)?$/i.exec(value);
  var candidate = match ? match[1] + '/' + match[2] : value;
  candidate = candidate.replace(/\.git$/i, '');
  return isRepoName(candidate) ? candidate : '';
}

/** Key of a repository in the settings and the state: "owner/name" in lower case (GitHub ignores case). */
function repoKey(name) {
  return text(name).toLowerCase();
}

/** Whether a watched pattern is valid: see MESSAGES.validation_github_paths. */
function isPattern(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > LIMITS.pathLength) {
    return false;
  }
  if (trim(value) !== value || /[\u0000-\u001f\u007f\\\[\]{}!]/.test(value) || value.charAt(0) === '/') {
    return false;
  }
  var segments = value.split('/');
  for (var i = 0; i < segments.length; i++) {
    var segment = segments[i];
    if (segment === '' || segment === '.' || segment === '..') {
      return false;
    }
    if (segment.indexOf('**') !== -1 && segment !== '**') {
      return false;
    }
  }
  return true;
}

/** Violation of a list of patterns: '' or the code. */
function pathsViolation(paths) {
  if (!isArray(paths) || paths.length > LIMITS.paths) {
    return 'validation_github_paths';
  }
  var seen = {};
  for (var i = 0; i < paths.length; i++) {
    if (!isPattern(paths[i])) {
      return 'validation_github_paths';
    }
    var key = paths[i].toLowerCase();
    if (hasOwn(seen, key)) {
      return 'validation_github_paths';
    }
    seen[key] = true;
  }
  return '';
}

function escapeRegExp(value) {
  return value.replace(/[.+^${}()|[\]\\\/]/g, '\\$&');
}

/**
 * Regular expression of a pattern, without regard to case. A pattern starts at the root of the
 * repository: "*" stands for any characters within one name, "?" for one character, and "**" as a
 * whole segment for any number of folders, also none ("docs/**\/roadmap*" matches
 * "docs/roadmap.md" and "docs/plan/2027/roadmap.md"; "**\/README*" matches a README anywhere).
 */
function patternRegExp(pattern) {
  var segments = pattern.split('/');
  var source = '';
  for (var i = 0; i < segments.length; i++) {
    var segment = segments[i];
    var last = i === segments.length - 1;
    if (segment === '**') {
      source += last ? '.*' : '(?:[^/]+/)*';
      continue;
    }
    var part = '';
    for (var c = 0; c < segment.length; c++) {
      var ch = segment.charAt(c);
      if (ch === '*') {
        part += '[^/]*';
      } else if (ch === '?') {
        part += '[^/]';
      } else {
        part += escapeRegExp(ch);
      }
    }
    source += part + (last ? '' : '/');
  }
  return new RegExp('^' + source + '$', 'i');
}

/** Whether a path of the repository matches one of the patterns. */
function matchesAny(path, expressions) {
  for (var i = 0; i < expressions.length; i++) {
    if (expressions[i].test(path)) {
      return true;
    }
  }
  return false;
}

/** Signature of a list of patterns, independent of order and case: a change of it re-reads the base. */
function pathsSignature(paths) {
  var list = [];
  for (var i = 0; i < paths.length; i++) {
    list.push(text(paths[i]).toLowerCase());
  }
  list.sort();
  return list.join('\n');
}

function eventsViolation(events) {
  if (events === undefined) {
    return '';
  }
  if (!isPlainObject(events)) {
    return 'validation_github_events';
  }
  var keys = keysOf(events);
  for (var i = 0; i < keys.length; i++) {
    if (EVENTS.indexOf(keys[i]) === -1 || typeof events[keys[i]] !== 'boolean') {
      return 'validation_github_events';
    }
  }
  return '';
}

/**
 * Violation of `settings` of a GitHub connection (the hook passes the parsed JSON): '' or
 * { field, code, message }. Allowed: `interval` (whole minutes, 5 to 60) and `repos`, a list of at
 * most 20 objects { repo: "owner/name", paths: [pattern], events: { files, pulls, releases },
 * target: project ID or '' }, each repository once.
 */
function settingsViolation(settings) {
  var value = settings === null || settings === undefined || settings === '' ? {} : settings;
  if (!isPlainObject(value)) {
    return failure('validation_github_settings');
  }
  var keys = keysOf(value);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] !== 'interval' && keys[i] !== 'repos') {
      return failure('validation_github_settings');
    }
  }
  if (value.interval !== undefined) {
    var interval = value.interval;
    if (typeof interval !== 'number' || interval % 1 !== 0 || interval < LIMITS.intervalMin || interval > LIMITS.intervalMax) {
      return failure('validation_github_interval');
    }
  }
  if (value.repos === undefined) {
    return '';
  }
  if (!isArray(value.repos)) {
    return failure('validation_github_settings');
  }
  if (value.repos.length > LIMITS.repos) {
    return failure('validation_github_repos_max');
  }
  var seen = {};
  for (var r = 0; r < value.repos.length; r++) {
    var repo = value.repos[r];
    if (!isPlainObject(repo)) {
      return failure('validation_github_settings');
    }
    var repoKeys = keysOf(repo);
    for (var k = 0; k < repoKeys.length; k++) {
      if (['repo', 'paths', 'events', 'target'].indexOf(repoKeys[k]) === -1) {
        return failure('validation_github_settings');
      }
    }
    if (!isRepoName(repo.repo)) {
      return failure('validation_github_repo');
    }
    var key = repoKey(repo.repo);
    if (hasOwn(seen, key)) {
      return failure('validation_github_repo_duplicate');
    }
    seen[key] = true;
    if (repo.paths !== undefined && pathsViolation(repo.paths) !== '') {
      return failure('validation_github_paths');
    }
    if (eventsViolation(repo.events) !== '') {
      return failure('validation_github_events');
    }
    if (repo.target !== undefined && repo.target !== '' && !(typeof repo.target === 'string' && RECORD_ID.test(repo.target))) {
      return failure('validation_github_target');
    }
  }
  return '';
}

/**
 * The settings as the channel reads them: { interval, repos: [{ repo, key, paths, events, target }] }
 * with the defaults for missing values; invalid repositories are left out (the hook refuses them
 * on save, so this only matters for repaired records).
 */
function settingsOf(settings) {
  var value = isPlainObject(settings) ? settings : {};
  var interval = value.interval;
  var result = {
    interval:
      typeof interval === 'number' && interval % 1 === 0 && interval >= LIMITS.intervalMin && interval <= LIMITS.intervalMax
        ? interval
        : LIMITS.intervalDefault,
    repos: []
  };
  var list = isArray(value.repos) ? value.repos : [];
  var seen = {};
  for (var i = 0; i < list.length && result.repos.length < LIMITS.repos; i++) {
    var repo = list[i];
    if (!isPlainObject(repo) || !isRepoName(repo.repo) || hasOwn(seen, repoKey(repo.repo))) {
      continue;
    }
    seen[repoKey(repo.repo)] = true;
    var events = isPlainObject(repo.events) ? repo.events : {};
    result.repos.push({
      repo: repo.repo,
      key: repoKey(repo.repo),
      paths: pathsViolation(repo.paths) === '' ? repo.paths.slice() : DEFAULT_PATHS.slice(),
      events: {
        files: events.files !== false,
        pulls: events.pulls !== false,
        releases: events.releases !== false
      },
      target: typeof repo.target === 'string' && RECORD_ID.test(repo.target) ? repo.target : ''
    });
  }
  return result;
}

/** Repository keys whose target project differs between two values of settings (each read with settingsOf). */
function changedTargets(before, after) {
  var old = {};
  var previous = settingsOf(before).repos;
  for (var i = 0; i < previous.length; i++) {
    old[previous[i].key] = previous[i].target;
  }
  var changed = [];
  var next = settingsOf(after).repos;
  for (var j = 0; j < next.length; j++) {
    var was = hasOwn(old, next[j].key) ? old[next[j].key] : '';
    if (next[j].target !== '' && next[j].target !== was) {
      changed.push(next[j]);
    }
  }
  return changed;
}

function msOf(value) {
  var raw = text(value);
  if (raw === '') {
    return NaN;
  }
  return Date.parse(raw.replace(' ', 'T'));
}

/**
 * Whether the cron runs a connection now: never while a rate limit holds (`limitUntil`, ms or 0),
 * else once `interval` minutes passed since its last run (`lastRunAt` as stored). The cron ticks at
 * full minutes and a run takes a moment, so up to a minute early counts as due; otherwise a run at
 * 10:00:05 would wait until 10:16 instead of 10:15.
 */
function isDue(lastRunAt, interval, now, limitUntil) {
  if (limitUntil > now) {
    return false;
  }
  var last = msOf(lastRunAt);
  if (isNaN(last)) {
    return true;
  }
  return now - last >= (interval - 1) * 60 * 1000;
}

/** The base address of the API: api.github.com, in the test mode 127.0.0.1 on the fake port. */
function apiBase(testMode, portValue) {
  if (testMode === true) {
    var port = parseInt(text(portValue), 10);
    if (port > 0 && port < 65536 && String(port) === trim(portValue)) {
      return 'http://127.0.0.1:' + port;
    }
  }
  return API_BASE;
}

/** Milliseconds of one run: LIMITS.runSeconds; only in the test mode `value` (1 to the default) shortens it. */
function runMsOf(testMode, value) {
  var standard = LIMITS.runSeconds * 1000;
  if (testMode !== true || !/^\d{1,6}$/.test(trim(value))) {
    return standard;
  }
  var ms = parseInt(trim(value), 10);
  return ms >= 1 && ms <= standard ? ms : standard;
}

/** Whole seconds the next request may take until `deadline`: at most LIMITS.timeoutSeconds, 0 below one second. */
function attemptSeconds(deadline, now) {
  var left = Math.floor((deadline - now) / 1000);
  if (!(left >= 1)) {
    return 0;
  }
  return Math.min(left, LIMITS.timeoutSeconds);
}

/** Whether the text of a failed $http.send names its time limit. */
function isTimeoutText(value) {
  return /timeout|deadline exceeded/i.test(text(value));
}

function intOr(value, fallback) {
  var raw = trim(value);
  return /^\d{1,12}$/.test(raw) ? parseInt(raw, 10) : fallback;
}

/**
 * The rate limit of an answer from its headers (`header(name)` gives the value or ''):
 * { limit, remaining, reset (ms, 0 unknown), retryAfter (seconds, -1 without) }; unknown numbers -1.
 */
function rateOf(header) {
  return {
    limit: intOr(header('x-ratelimit-limit'), -1),
    remaining: intOr(header('x-ratelimit-remaining'), -1),
    reset: intOr(header('x-ratelimit-reset'), 0) * 1000,
    retryAfter: intOr(header('retry-after'), -1)
  };
}

/**
 * Whether an answer means a rate limit and until when (ADR-0050 §6, GitHub "Best practices"):
 * - Retry-After: not before that many seconds (secondary limit);
 * - x-ratelimit-remaining 0: not before x-ratelimit-reset (primary limit);
 * - 429, or 403 with "rate limit" in the message: at least a minute, doubling with each repetition
 *   (`backoff` counts the earlier ones) up to 15 minutes (secondary limit).
 * Returns { kind: 'primary' | 'secondary', until } or null (a 403 for missing rights is no limit).
 */
function limitOf(status, rate, message, now, backoff) {
  if (status !== 403 && status !== 429) {
    return null;
  }
  if (rate.retryAfter >= 0) {
    return { kind: 'secondary', until: now + Math.max(rate.retryAfter, 1) * 1000 };
  }
  if (rate.remaining === 0 && rate.reset > now) {
    return { kind: 'primary', until: rate.reset + 1000 };
  }
  if (status === 429 || /rate limit/i.test(text(message))) {
    var seconds = LIMITS.secondaryWaitSeconds * Math.pow(2, Math.max(0, Math.min(backoff || 0, 8)));
    return { kind: 'secondary', until: now + Math.min(seconds, LIMITS.secondaryMaxSeconds) * 1000 };
  }
  return null;
}

/**
 * Whether the app stops before the next request because the primary limit is used up: GitHub said
 * nothing is left and the window has not reset yet. Returns the time to wait for, or 0.
 */
function exhaustedUntil(rate, now) {
  return rate && rate.remaining === 0 && rate.reset > now ? rate.reset + 1000 : 0;
}

/** The address of rel="next" in a Link header, '' without one. */
function nextLink(link) {
  var parts = text(link).split(',');
  for (var i = 0; i < parts.length; i++) {
    var match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(parts[i]);
    if (match) {
      return match[1];
    }
  }
  return '';
}

/** Path and query of a link of the API, only if it points to `base` (no other host is followed). */
function pathOfLink(url, base) {
  var value = text(url);
  if (value.indexOf(base + '/') !== 0) {
    return '';
  }
  var rest = value.slice(base.length);
  return /^\/[^\s]*$/.test(rest) ? rest : '';
}

/** A path for the API with each segment encoded (names of repositories, branches, files). */
function encodePath(value) {
  var segments = text(value).split('/');
  for (var i = 0; i < segments.length; i++) {
    segments[i] = encodeURIComponent(segments[i]);
  }
  return segments.join('/');
}

/** Address on github.com below a repository, e.g. webUrl('Octo/Repo', 'pull/12'). */
function webUrl(repo, rest) {
  return WEB_BASE + '/' + encodePath(repo) + (rest ? '/' + rest : '');
}

/**
 * German message of a failed request and whether it concerns the connection (token, reachability)
 * rather than one repository. `status` 0 means no answer, `code` 'timeout' a time-out; `variable`
 * names the variable of the token. Never contains the token.
 */
function failureOf(status, code, variable) {
  if (status === 0 && code === 'timeout') {
    return {
      message: 'GitHub antwortet gerade zu langsam (Zeitüberschreitung). Der nächste Abruf versucht es erneut.',
      connection: false
    };
  }
  if (status === 0) {
    return { message: 'GitHub ist nicht erreichbar. Besteht eine Internetverbindung?', connection: true };
  }
  if (status === 401) {
    return {
      message:
        'GitHub lehnt den Token ab (401). Stimmt der Wert von ' +
        text(variable) +
        ', oder ist er abgelaufen? Neuen Token setzen, dann neu-starten.bat.',
      connection: true
    };
  }
  if (status === 403) {
    return {
      message:
        'Kein Zugriff auf dieses Repository (403). Der Token braucht für dieses Repository „Contents“, „Metadata“ und „Pull requests“ mit „Read-only“.',
      connection: false
    };
  }
  if (status === 404) {
    return {
      message:
        'Repository nicht gefunden oder kein Zugriff (404). Stimmt der Name? Private Repositorys brauchen einen Token, der sie freigibt.',
      connection: false
    };
  }
  if (status === 409) {
    return { message: 'Das Repository ist leer (409); es gibt noch keinen Stand zum Beobachten.', connection: false };
  }
  if (status === 451) {
    return { message: 'GitHub hat dieses Repository aus rechtlichen Gründen gesperrt (451).', connection: false };
  }
  if (status >= 500) {
    return {
      message: 'GitHub ist gerade nicht verfügbar (HTTP ' + status + '). Der nächste Abruf versucht es erneut.',
      connection: false
    };
  }
  return { message: 'GitHub lehnt die Anfrage ab (HTTP ' + status + ').', connection: false };
}

/**
 * The neutral hint while a rate limit holds (ADR-0050 §6): no error of the user, so not red.
 * `authenticated` tells the limit without token (60 per hour) from the one with a token.
 */
function limitHint(limit, authenticated, berlin) {
  var until = berlinText(new Date(limit.until).toISOString(), berlin);
  if (limit.kind === 'primary') {
    return authenticated
      ? 'GitHub-Anfragelimit erreicht. Nächster Abruf ab ' + until + '.'
      : 'GitHub-Anfragelimit ohne Token erreicht (60 Anfragen je Stunde). Nächster Abruf ab ' + until + '. Mit Token sind es 5 000.';
  }
  return 'GitHub bremst gerade die Anfragen. Nächster Abruf ab ' + until + '.';
}

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

/** "02.10.2026, 14:05" in Berlin time for an instant (ISO or PocketBase format); '' for none. */
function berlinText(value, berlin) {
  var ms = msOf(value);
  if (isNaN(ms)) {
    return '';
  }
  var local = new Date(ms + berlin.berlinOffsetHours(ms) * 3600 * 1000);
  return (
    pad(local.getUTCDate()) +
    '.' +
    pad(local.getUTCMonth() + 1) +
    '.' +
    local.getUTCFullYear() +
    ', ' +
    pad(local.getUTCHours()) +
    ':' +
    pad(local.getUTCMinutes())
  );
}

/** "02.10.2026" in Berlin time; '' for none. */
function berlinDay(value, berlin) {
  return berlinText(value, berlin).slice(0, 10);
}

/** An instant as ISO text, '' for anything that is no time. */
function isoOf(value) {
  var ms = msOf(value);
  return isNaN(ms) ? '' : new Date(ms).toISOString();
}

/** A text of the API inside a line of Markdown: one line, without the signs Markdown would read. */
function inline(value, max) {
  var line = trim(text(value).replace(/\s+/g, ' '));
  if (max && line.length > max) {
    line = line.slice(0, max - 1) + '…';
  }
  return line.replace(/([\\`*_\[\]<>#|~!])/g, '\\$1');
}

/** A link in Markdown; the address comes from webUrl, the text is escaped. */
function link(label, url) {
  return '[' + inline(label) + '](' + url + ')';
}

/** A fence that does not occur in `body` (``` and longer). */
function fenceFor(body) {
  var fence = '```';
  while (body.indexOf(fence) !== -1) {
    fence += '`';
  }
  return fence;
}

/** The first lines of a patch (ADR-0050 §3): { text, truncated }; '' without a patch. */
function diffExcerpt(patch) {
  var lines = text(patch).split('\n');
  var taken = [];
  var chars = 0;
  var truncated = false;
  for (var i = 0; i < lines.length; i++) {
    if (taken.length >= LIMITS.diffLines || chars + lines[i].length + 1 > LIMITS.diffChars) {
      truncated = true;
      break;
    }
    taken.push(lines[i]);
    chars += lines[i].length + 1;
  }
  while (taken.length > 0 && taken[taken.length - 1] === '') {
    taken.pop();
  }
  return { text: taken.join('\n'), truncated: truncated };
}

/** Whether a file name reads as Markdown (its copy then stands as Markdown, else in a code block). */
function isMarkdownName(path) {
  return /\.(?:md|markdown|mdown|mkd|mdx)$/i.test(text(path));
}

/** Whether a text is binary: a NUL character in its first 8 000 characters. */
function looksBinary(value) {
  return text(value).slice(0, 8000).indexOf('\u0000') !== -1;
}

/** Name of the copied file in the inbox: the last segment of the path, safe for a file name. */
function fileNameOf(path) {
  var segments = text(path).split('/');
  var name = segments[segments.length - 1].replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
  return name === '' || name === '.' || name === '..' ? 'datei.txt' : name;
}

/** source_ref of the entries of one watched file: "file:<repository key>:<path>". */
function fileRef(key, path) {
  return 'file:' + key + ':' + path;
}

/**
 * The watched files of a tree: { files: { path: { sha, size } }, count, more, skipped } with the
 * blobs whose path matches a pattern, in the order of their paths, at most LIMITS.files (`more`
 * counts the rest); a path whose reference would not fit source_ref is skipped and counted.
 */
function watchedFiles(entries, paths, key) {
  var expressions = [];
  for (var p = 0; p < paths.length; p++) {
    expressions.push(patternRegExp(paths[p]));
  }
  var matches = [];
  var list = isArray(entries) ? entries : [];
  for (var i = 0; i < list.length; i++) {
    var entry = list[i];
    if (!isPlainObject(entry) || entry.type !== 'blob' || typeof entry.path !== 'string' || !SHA.test(text(entry.sha))) {
      continue;
    }
    if (matchesAny(entry.path, expressions)) {
      matches.push(entry);
    }
  }
  matches.sort(function (a, b) {
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  var files = {};
  var count = 0;
  var skipped = 0;
  for (var m = 0; m < matches.length; m++) {
    if (fileRef(key, matches[m].path).length > LIMITS.refLength) {
      skipped += 1;
      continue;
    }
    if (count >= LIMITS.files) {
      break;
    }
    files[matches[m].path] = { sha: matches[m].sha, size: typeof matches[m].size === 'number' ? matches[m].size : 0 };
    count += 1;
  }
  return { files: files, count: count, more: matches.length - skipped - count, skipped: skipped };
}

/**
 * What changed between the stored and the current watched files: { changed, added, removed,
 * baseline, kept } as sorted lists of paths.
 * - `fresh(path)`: whether a path is watched only since the patterns changed; it becomes part of
 *   the base without an entry (no flood after a new pattern).
 * - `present(path)`: whether a stored path that is no longer watched is still in the tree: true
 *   (only the patterns changed: it leaves the state without an entry), false (the file was
 *   removed), null (unknown, the tree came truncated: it stays in the state as it was).
 */
function fileChanges(before, after, present, fresh) {
  var result = { changed: [], added: [], removed: [], baseline: [], kept: [] };
  var paths = keysOf(after);
  for (var i = 0; i < paths.length; i++) {
    var path = paths[i];
    if (!hasOwn(before, path)) {
      if (fresh(path)) {
        result.baseline.push(path);
      } else {
        result.added.push(path);
      }
    } else if (before[path].sha !== after[path].sha) {
      result.changed.push(path);
    }
  }
  var old = keysOf(before);
  for (var j = 0; j < old.length; j++) {
    if (hasOwn(after, old[j])) {
      continue;
    }
    var there = present(old[j]);
    if (there === false) {
      result.removed.push(old[j]);
    } else if (there === null) {
      result.kept.push(old[j]);
    }
  }
  result.changed.sort();
  result.added.sort();
  result.removed.sort();
  result.baseline.sort();
  result.kept.sort();
  return result;
}

/**
 * Whether the paths of a list of patterns match: a function of the path, for the patterns a
 * repository was watched with before (fileChanges `fresh`).
 */
function matcherOf(paths) {
  var expressions = [];
  var list = isArray(paths) ? paths : [];
  for (var i = 0; i < list.length; i++) {
    if (isPattern(list[i])) {
      expressions.push(patternRegExp(list[i]));
    }
  }
  return function (path) {
    return matchesAny(path, expressions);
  };
}

/** Text of the commits of an entry: one line each, newest first, at most LIMITS.commits. */
function commitLines(repo, commits, more, berlin) {
  var lines = [];
  var list = isArray(commits) ? commits : [];
  for (var i = 0; i < list.length && i < LIMITS.commits; i++) {
    var commit = list[i];
    var sha = text(commit.sha);
    var who = trim(commit.author) === '' ? '' : ' – ' + inline(commit.author, 80);
    var when = berlinText(commit.date, berlin);
    lines.push(
      '  - ' +
        '[`' + sha.slice(0, 7) + '`](' + webUrl(repo, 'commit/' + sha) + ') ' +
        inline(text(commit.message).split('\n')[0], 120) +
        who +
        (when === '' ? '' : ', ' + when)
    );
  }
  var rest = list.length - Math.min(list.length, LIMITS.commits);
  if (rest > 0 || more) {
    lines.push('  - und ' + (more ? 'weitere' : rest === 1 ? '1 weiterer' : rest + ' weitere'));
  }
  return lines;
}

/** Distinct authors of the commits, in their order. */
function authorsOf(commits) {
  var authors = [];
  var list = isArray(commits) ? commits : [];
  for (var i = 0; i < list.length; i++) {
    var name = trim(list[i].author);
    if (name !== '' && authors.indexOf(name) === -1) {
      authors.push(name);
    }
  }
  return authors;
}

var ACTION_WORDS = { changed: 'geändert', added: 'neu', removed: 'gelöscht' };

/**
 * Entry of a changed, new or removed watched file (ADR-0050 §3). `input`:
 * { repo, key, branch, path, action: 'changed' | 'added' | 'removed', sha (new blob, '' when
 *   removed), oldSha, head, headDate, base, stats: { additions, deletions } | null, patch,
 *   commits: [{ sha, message, author, date }], commitsMore, content: { text, truncated } | null,
 *   copy: 'complete' | 'too_large' | 'binary' | 'later' | 'none', size, detectedAt }
 * Returns a draft for inbox-service.ingest plus `fileName` of the copy and `watch`.
 */
function fileDraft(input, berlin) {
  var repo = input.repo;
  var action = input.action;
  var path = input.path;
  var removed = action === 'removed';
  var compareUrl = input.base && input.head ? webUrl(repo, 'compare/' + input.base.slice(0, 12) + '...' + input.head.slice(0, 12)) : '';
  var fileUrl = removed ? webUrl(repo, 'commits/' + encodeURIComponent(input.branch)) : webUrl(repo, 'blob/' + input.head + '/' + encodePath(path));
  var commits = isArray(input.commits) ? input.commits : [];
  var date = commits.length > 0 && isoOf(commits[0].date) !== '' ? isoOf(commits[0].date) : isoOf(input.headDate) || isoOf(input.detectedAt);
  var lines = [];
  lines.push(
    '**' + inline(path) + '** in ' + link(repo, webUrl(repo)) + ' auf `' + inline(input.branch, 100) + '` ' + ACTION_WORDS[action] + '.'
  );
  lines.push('');
  if (input.stats) {
    lines.push('- Zeilen: +' + (input.stats.additions || 0) + ' / −' + (input.stats.deletions || 0));
  }
  var authors = authorsOf(commits);
  if (authors.length > 0) {
    lines.push('- ' + (authors.length === 1 ? 'Autor: ' : 'Autoren: ') + inline(authors.join(', '), 300));
  }
  if (commits.length > 0) {
    lines.push('- Commits' + (input.commitsMore ? '' : ' (' + commits.length + ')') + ':');
    var commitText = commitLines(repo, commits, input.commitsMore, berlin);
    for (var c = 0; c < commitText.length; c++) {
      lines.push(commitText[c]);
    }
  } else if (input.copy === 'later') {
    lines.push('- Commits: zu viele Änderungen auf einmal; siehe Vergleich.');
  }
  if (compareUrl !== '') {
    lines.push('- Vergleich: ' + link(input.base.slice(0, 7) + '…' + input.head.slice(0, 7), compareUrl));
  }
  if (!removed) {
    lines.push('- Datei: ' + link(path + ' in dieser Fassung', fileUrl));
  }
  var excerpt = diffExcerpt(input.patch);
  if (excerpt.text !== '') {
    var fence = fenceFor(excerpt.text);
    lines.push('');
    lines.push('**Diff-Auszug**' + (excerpt.truncated ? ' (gekürzt, vollständig im Vergleich):' : ':'));
    lines.push('');
    lines.push(fence + 'diff');
    lines.push(excerpt.text);
    lines.push(fence);
  }
  var head = lines.join('\n');
  var body = head;
  if (!removed) {
    body += '\n\n---\n\n';
    if (input.copy === 'too_large') {
      body += '_Inhalt nicht kopiert: Die Datei ist größer als 2 MB (' + Math.round((input.size || 0) / 1024) + ' KB). Vollständig auf GitHub._';
    } else if (input.copy === 'binary') {
      body += '_Inhalt nicht als Text kopiert: Die Datei ist keine Textdatei._';
    } else if (input.copy === 'later' || !input.content) {
      body += '_Inhalt nicht kopiert: zu viele Änderungen auf einmal. Vollständig auf GitHub._';
    } else {
      var room = LIMITS.bodyChars - body.length - 200;
      var content = input.content.text;
      var cut = input.content.truncated;
      if (content.length > room) {
        content = content.slice(0, Math.max(room, 0));
        cut = true;
      }
      if (isMarkdownName(path)) {
        body += '**Neuer Inhalt:**\n\n' + content;
      } else {
        var contentFence = fenceFor(content);
        body += '**Neuer Inhalt:**\n\n' + contentFence + '\n' + content + '\n' + contentFence;
      }
      if (cut) {
        body += '\n\n_Inhalt gekürzt. Vollständig auf GitHub und in der Originaldatei._';
      }
    }
  }
  var meta = {
    github: {
      kind: 'file',
      repo: repo,
      path: path,
      action: action,
      version: removed ? 'removed-' + text(input.oldSha) : text(input.sha),
      sha: removed ? '' : text(input.sha),
      head: text(input.head),
      base: text(input.base),
      branch: text(input.branch),
      additions: input.stats ? input.stats.additions || 0 : null,
      deletions: input.stats ? input.stats.deletions || 0 : null,
      commits: commits.length,
      copy: removed ? 'none' : input.copy
    }
  };
  if (compareUrl !== '') {
    meta.github.compare_url = compareUrl;
  }
  return {
    channel: 'github',
    kind: 'change',
    title: path + ' in ' + repo + ' ' + ACTION_WORDS[action],
    body: body,
    source_url: removed ? compareUrl || fileUrl : fileUrl,
    source_ref: fileRef(input.key, path),
    source_date: date,
    meta: meta,
    fileName: fileNameOf(path),
    watch: removed ? null : { kind: 'file', state: 'current' }
  };
}

/** The state of a pull request: 'merged', 'closed' or 'open'. */
function pullState(pull) {
  if (!isPlainObject(pull)) {
    return 'open';
  }
  if (trim(pull.merged_at) !== '') {
    return 'merged';
  }
  return pull.state === 'closed' ? 'closed' : 'open';
}

/** Status of the entry of a pull request (ADR-0050 §5): { kind: 'pull', state, since }. */
function pullWatch(pull) {
  var state = pullState(pull);
  var since = state === 'merged' ? isoOf(pull.merged_at) : state === 'closed' ? isoOf(pull.closed_at) : '';
  return since === '' ? { kind: 'pull', state: state } : { kind: 'pull', state: state, since: since };
}

var PULL_STATE_WORDS = { open: 'offen', merged: 'gemergt', closed: 'geschlossen' };

/** A text of a pull request or release (Markdown of GitHub) within LIMITS.noteChars. */
function noteText(value) {
  var note = text(value).replace(/\r\n?/g, '\n');
  if (note.length <= LIMITS.noteChars) {
    return { text: note, truncated: false };
  }
  return { text: note.slice(0, LIMITS.noteChars), truncated: true };
}

function sourceRefOf(nodeId, fallback) {
  var node = text(nodeId);
  return NODE_ID.test(node) ? node : fallback;
}

/** Entry of a pull request (ADR-0050 §4); `pull` as the list of pull requests gives it. */
function pullDraft(pull, repo, key, berlin) {
  var number = typeof pull.number === 'number' ? pull.number : 0;
  var url = webUrl(repo, 'pull/' + number);
  var login = isPlainObject(pull.user) ? text(pull.user.login) : '';
  var state = pullState(pull);
  var lines = [];
  lines.push(
    '**Pull Request #' + number + '** in ' + link(repo, webUrl(repo)) +
      (login === '' ? '' : ', geöffnet von @' + inline(login, 60)) +
      (berlinText(pull.created_at, berlin) === '' ? '' : ' am ' + berlinText(pull.created_at, berlin)) +
      '.'
  );
  lines.push('');
  var head = isPlainObject(pull.head) ? text(pull.head.ref) : '';
  var baseRef = isPlainObject(pull.base) ? text(pull.base.ref) : '';
  if (head !== '' && baseRef !== '') {
    lines.push('- Zweig: `' + inline(head, 100) + '` → `' + inline(baseRef, 100) + '`');
  }
  if (pull.draft === true) {
    lines.push('- Entwurf: ja');
  }
  var when = state === 'merged' ? berlinText(pull.merged_at, berlin) : state === 'closed' ? berlinText(pull.closed_at, berlin) : '';
  lines.push('- Zustand beim Eintreffen: ' + PULL_STATE_WORDS[state] + (when === '' ? '' : ' am ' + when));
  lines.push('- ' + link('Auf GitHub öffnen', url));
  var note = noteText(pull.body);
  var body = lines.join('\n');
  if (trim(note.text) !== '') {
    body += '\n\n---\n\n' + note.text + (note.truncated ? '\n\n_Beschreibung gekürzt. Vollständig auf GitHub._' : '');
  }
  return {
    channel: 'github',
    kind: 'pull_request',
    title: 'PR #' + number + ' in ' + repo + ': ' + trim(text(pull.title).replace(/\s+/g, ' ')),
    body: body,
    source_url: url,
    source_ref: sourceRefOf(pull.node_id, 'pull:' + key + '#' + number),
    source_date: isoOf(pull.created_at),
    meta: {
      github: {
        kind: 'pull',
        repo: repo,
        number: number,
        version: '',
        author: login,
        draft: pull.draft === true,
        head: head,
        base: baseRef
      }
    },
    watch: pullWatch(pull)
  };
}

/** Entry of a published release (ADR-0050 §4). */
function releaseDraft(release, repo, key, berlin) {
  var tag = text(release.tag_name);
  var url = webUrl(repo, 'releases/tag/' + encodeURIComponent(tag));
  var name = trim(release.name);
  var login = isPlainObject(release.author) ? text(release.author.login) : '';
  var lines = [];
  lines.push(
    '**Release ' + inline(name === '' ? tag : name, 120) + '** in ' + link(repo, webUrl(repo)) +
      (berlinText(release.published_at, berlin) === '' ? '' : ', veröffentlicht am ' + berlinText(release.published_at, berlin)) +
      (login === '' ? '' : ' von @' + inline(login, 60)) +
      '.'
  );
  lines.push('');
  lines.push('- Tag: `' + inline(tag, 100) + '`');
  if (release.prerelease === true) {
    lines.push('- Vorabversion: ja');
  }
  lines.push('- ' + link('Auf GitHub öffnen', url));
  var note = noteText(release.body);
  var body = lines.join('\n');
  if (trim(note.text) !== '') {
    body += '\n\n---\n\n' + note.text + (note.truncated ? '\n\n_Text gekürzt. Vollständig auf GitHub._' : '');
  }
  var title = 'Release ' + tag + ' in ' + repo + (name !== '' && name !== tag ? ': ' + name.replace(/\s+/g, ' ') : '');
  return {
    channel: 'github',
    kind: 'release',
    title: title,
    body: body,
    source_url: url,
    source_ref: sourceRefOf(release.node_id, 'release:' + key + '@' + text(release.id)),
    source_date: isoOf(release.published_at) || isoOf(release.created_at),
    meta: {
      github: {
        kind: 'release',
        repo: repo,
        tag: tag,
        version: '',
        prerelease: release.prerelease === true,
        author: login
      }
    },
    watch: null
  };
}

/**
 * Status of the entry of one version of a watched file (ADR-0050 §5), from the blob of the entry
 * (`itemSha`) and the current blob (`currentSha`, '' when the file is gone): 'current' while it is
 * the current version, 'changed' with the time of the last change since, 'gone' since the file
 * was removed. `previous` is the stored status; `at` the time of this change (ISO).
 */
function fileWatch(itemSha, currentSha, at, previous) {
  if (currentSha === '') {
    var since = previous && previous.state === 'gone' && previous.since ? previous.since : at;
    return { kind: 'file', state: 'gone', since: since };
  }
  if (itemSha === currentSha) {
    return { kind: 'file', state: 'current' };
  }
  return { kind: 'file', state: 'changed', since: at };
}

/** Whether two values of the status are the same (JSON of plain values). */
function sameWatch(a, b) {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}

/** Whether an instant lies after `base` (any instant counts when there is no base). */
function isAfter(value, base) {
  var at = msOf(value);
  var since = msOf(base);
  return !isNaN(at) && (isNaN(since) || at > since);
}

/**
 * Whether an instant lies not before `base`: the lists of GitHub give seconds, so a pull request
 * updated in the second of the stored mark is read once more (harmless: its status only follows,
 * and its entry exists).
 */
function notBefore(value, base) {
  var at = msOf(value);
  var since = msOf(base);
  return !isNaN(at) && (isNaN(since) || at >= since);
}

/** The later of two instants as ISO text ('' when neither is one). */
function later(a, b) {
  var first = msOf(a);
  var second = msOf(b);
  if (isNaN(first)) {
    return isoOf(b);
  }
  if (isNaN(second)) {
    return isoOf(a);
  }
  return first >= second ? isoOf(a) : isoOf(b);
}

/**
 * The state of the channel in connections.watch, read safely: { repos: { key: state }, limit }.
 * Anything broken counts as nothing known yet (the next run reads the base again, without a flood).
 */
function stateOf(value) {
  var parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = value === '' ? null : JSON.parse(value);
    } catch (err) {
      parsed = null;
    }
  }
  var state = { repos: {}, limit: null };
  if (!isPlainObject(parsed)) {
    return state;
  }
  if (isPlainObject(parsed.repos)) {
    var keys = keysOf(parsed.repos);
    for (var i = 0; i < keys.length; i++) {
      if (isPlainObject(parsed.repos[keys[i]])) {
        state.repos[keys[i]] = parsed.repos[keys[i]];
      }
    }
  }
  if (isPlainObject(parsed.limit) && typeof parsed.limit.until === 'number') {
    state.limit = parsed.limit;
  }
  if (isPlainObject(parsed.rate)) {
    state.rate = parsed.rate;
  }
  return state;
}

/** Until when a stored rate limit holds (ms), 0 for none or one that has passed. */
function limitUntil(state, now) {
  return state.limit && state.limit.until > now ? state.limit.until : 0;
}

/**
 * The details of one repository for its card (ADR-0050 §7), from its settings and stored state:
 * { repo, key, url, branch, private, paths, events, target, files, filesMore, truncated,
 *   lastChange, openPulls, openPullsMore, lastRelease, checkedAt, okAt, error }.
 */
function repoSummary(config, state) {
  var stored = isPlainObject(state) ? state : {};
  var files = isPlainObject(stored.files) ? keysOf(stored.files).length : 0;
  return {
    repo: text(stored.name) || config.repo,
    key: config.key,
    url: webUrl(text(stored.name) || config.repo),
    branch: text(stored.branch),
    private: stored.private === true,
    paths: config.paths,
    events: config.events,
    target: config.target,
    files: files,
    filesMore: typeof stored.files_more === 'number' ? stored.files_more : 0,
    truncated: stored.truncated === true,
    lastChange: isPlainObject(stored.last_change) ? stored.last_change : null,
    openPulls: typeof stored.open_pulls === 'number' ? stored.open_pulls : null,
    openPullsMore: stored.open_pulls_more === true,
    lastRelease: isPlainObject(stored.last_release) ? stored.last_release : null,
    checkedAt: text(stored.checked_at),
    okAt: text(stored.ok_at),
    error: text(stored.error)
  };
}

module.exports = {
  API_BASE: API_BASE,
  WEB_BASE: WEB_BASE,
  API_VERSION: API_VERSION,
  TEST_PORT_ENV: TEST_PORT_ENV,
  TEST_TIMING_ENV: TEST_TIMING_ENV,
  TEST_MODE_KEY: TEST_MODE_KEY,
  DEFAULT_SECRET_ENV: DEFAULT_SECRET_ENV,
  DEFAULT_PATHS: DEFAULT_PATHS,
  OPTIONAL_PATHS: OPTIONAL_PATHS,
  EVENTS: EVENTS,
  LIMITS: LIMITS,
  MESSAGES: MESSAGES,
  isRepoName: isRepoName,
  parseRepo: parseRepo,
  repoKey: repoKey,
  isPattern: isPattern,
  pathsViolation: pathsViolation,
  patternRegExp: patternRegExp,
  pathsSignature: pathsSignature,
  settingsViolation: settingsViolation,
  settingsOf: settingsOf,
  changedTargets: changedTargets,
  isDue: isDue,
  apiBase: apiBase,
  runMsOf: runMsOf,
  attemptSeconds: attemptSeconds,
  isTimeoutText: isTimeoutText,
  rateOf: rateOf,
  limitOf: limitOf,
  exhaustedUntil: exhaustedUntil,
  nextLink: nextLink,
  pathOfLink: pathOfLink,
  encodePath: encodePath,
  webUrl: webUrl,
  failureOf: failureOf,
  limitHint: limitHint,
  berlinText: berlinText,
  berlinDay: berlinDay,
  isoOf: isoOf,
  inline: inline,
  diffExcerpt: diffExcerpt,
  isMarkdownName: isMarkdownName,
  looksBinary: looksBinary,
  fileNameOf: fileNameOf,
  fileRef: fileRef,
  watchedFiles: watchedFiles,
  fileChanges: fileChanges,
  matcherOf: matcherOf,
  fileDraft: fileDraft,
  pullState: pullState,
  pullWatch: pullWatch,
  pullDraft: pullDraft,
  releaseDraft: releaseDraft,
  fileWatch: fileWatch,
  sameWatch: sameWatch,
  isAfter: isAfter,
  notBefore: notBefore,
  later: later,
  stateOf: stateOf,
  limitUntil: limitUntil,
  repoSummary: repoSummary
};
