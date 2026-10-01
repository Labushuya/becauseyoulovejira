// Backups of the app (ADR-0046): a backup a day through PocketBase (createBackup, byl-<stamp>.zip in
// pb_data/backups), the generations kept (GFS, lib/backup-rules.js), the sealed copy in the target
// folder through byl-control.ps1 backup-export (encrypted with age by byl-backup.exe, with the
// access data of the account), and the routes of the page "Einstellungen → Sicherung" with the
// checks of the page System (lib/system-service.js: Windows, this machine, the address of the app,
// the owner, rate limit, own instance). The state of the last runs lives in run/sicherung.json next
// to pb_data, not in the database: a restored backup must not bring back an old state.
'use strict';

var rules = require(__hooks + '/lib/backup-rules.js');
var system = require(__hooks + '/lib/system-service.js');
var berlin = require(__hooks + '/lib/berlin-time.js');

var AREA = 'byl-backup';
// One run at a time (cron, "Jetzt sichern"); a mark older than this was left by a crash.
var LOCK_KEY = 'byl.backup.running';
var LOCK_MS = 2 * 60 * 60 * 1000;
// Counted for the manifest of a sealed backup (shown again when it is checked or restored).
var COUNTED = ['users', 'projects', 'tags', 'tickets', 'comments', 'inbox_items', 'recurrence_rules', 'connections'];
// Mark of the integration tests (tests/fixtures/pb_hooks/test-mode.pb.js): their instances make no
// backups on their own.
var TEST_MODE_KEY = 'byl-test-mode';

var MESSAGES = {
  invalid: 'Die Eingaben sind ungültig.',
  target: 'Das Zielverzeichnis passt nicht.',
  passphrase: 'Die Passphrase passt nicht.'
};

function paths(app) {
  var appDir = $filepath.dir(app.dataDir());
  return {
    config: $filepath.join(appDir, 'byl-config.json'),
    runDir: $filepath.join(appDir, 'run'),
    status: $filepath.join(appDir, 'run', 'sicherung.json')
  };
}

function readText(path) {
  try {
    return toString($os.readFile(path));
  } catch (err) {
    return '';
  }
}

function readSettings(app) {
  return rules.settingsOf(readText(paths(app).config));
}

function readStatus(app) {
  return rules.parseStatus(readText(paths(app).status));
}

/** Writes run/sicherung.json through a temporary file, so a reader never sees half of it. */
function writeStatus(app, status) {
  var where = paths(app);
  try {
    $os.mkdirAll(where.runDir, 493);
    $os.writeFile(where.status + '.tmp', toBytes(JSON.stringify(status)), 420);
    $os.rename(where.status + '.tmp', where.status);
  } catch (err) {
    app.logger().warn(AREA + ': Zustand nicht gespeichert', 'error', String(err));
  }
}

function dayOf(time) {
  return berlin.berlinToday(time);
}

/** Backups in pb_data/backups: { name, time, bytes, ours } (ours: made by the app, byl-<stamp>.zip). */
function listLocal(app) {
  var result = [];
  var fsys = app.newBackupsFilesystem();
  try {
    var files = fsys.list('');
    for (var i = 0; i < files.length; i++) {
      var name = String(files[i].key);
      if (!/\.zip$/i.test(name) || name.indexOf('/') !== -1) {
        continue;
      }
      var ours = rules.isLocalName(name);
      result.push({
        name: name,
        time: ours ? rules.timeOfName(name) : files[i].modTime.unix() * 1000,
        bytes: Number(files[i].size),
        ours: ours
      });
    }
  } finally {
    fsys.close();
  }
  return result.sort(function (a, b) {
    return b.time - a.time;
  });
}

/** Sealed backups in the target folder ({ name, time, bytes }), or null if it is not reachable. */
function listSealed(target) {
  var entries;
  try {
    entries = $os.readDir(target);
  } catch (err) {
    return null;
  }
  var result = [];
  for (var i = 0; i < entries.length; i++) {
    var name = String(entries[i].name());
    if (entries[i].isDir() || !rules.isSealedName(name)) {
      continue;
    }
    var bytes = 0;
    try {
      bytes = Number(entries[i].info().size());
    } catch (err) {
      bytes = 0;
    }
    result.push({ name: name, time: rules.timeOfName(name), bytes: bytes });
  }
  return result.sort(function (a, b) {
    return b.time - a.time;
  });
}

function withDays(list) {
  var result = [];
  for (var i = 0; i < list.length; i++) {
    result.push({ name: list[i].name, time: list[i].time, day: dayOf(list[i].time) });
  }
  return result;
}

/** Removes the local backups of the app the generations do not keep; never other ZIP files. */
function pruneLocal(app, settings) {
  var mine = listLocal(app).filter(function (entry) {
    return entry.ours;
  });
  var remove = rules.retention(withDays(mine), settings).remove;
  if (remove.length === 0) {
    return;
  }
  var fsys = app.newBackupsFilesystem();
  try {
    for (var i = 0; i < remove.length; i++) {
      try {
        fsys.delete(remove[i]);
      } catch (err) {
        app.logger().warn(AREA + ': Alte Sicherung nicht gelöscht', 'name', remove[i], 'error', String(err));
      }
    }
  } finally {
    fsys.close();
  }
}

/** Removes the sealed backups in the target folder the generations do not keep. */
function pruneTarget(app, target, settings) {
  var sealed = listSealed(target);
  if (sealed === null) {
    return;
  }
  var remove = rules.retention(withDays(sealed), settings).remove;
  for (var i = 0; i < remove.length; i++) {
    try {
      $os.remove($filepath.join(target, remove[i]));
    } catch (err) {
      app.logger().warn(AREA + ': Alte Sicherung im Zielverzeichnis nicht gelöscht', 'name', remove[i], 'error', String(err));
    }
  }
}

/** Counts and the newest migration for the manifest of a sealed backup. */
function manifestOf(app) {
  var counts = {};
  for (var i = 0; i < COUNTED.length; i++) {
    try {
      counts[COUNTED[i]] = app.countRecords(COUNTED[i]);
    } catch (err) {
      counts[COUNTED[i]] = null;
    }
  }
  try {
    counts.originals = app.countRecords('inbox_items', $dbx.exp("original != ''"));
  } catch (err) {
    counts.originals = null;
  }
  var migration = '';
  try {
    var row = new DynamicModel({ file: '' });
    app.db().newQuery('SELECT file FROM _migrations ORDER BY applied DESC, file DESC LIMIT 1').one(row);
    migration = String(row.file);
  } catch (err) {
    migration = '';
  }
  return { counts: counts, migration: migration };
}

/** Marks a run as started; false if another one runs. */
function claim(app, now) {
  var claimed = false;
  app.store().setFunc(LOCK_KEY, function (since) {
    if (typeof since === 'number' && now >= since && now - since < LOCK_MS) {
      return since;
    }
    claimed = true;
    return now;
  });
  return claimed;
}

function release(app) {
  app.store().remove(LOCK_KEY);
}

/** A message for the state file and the log without paths of the machine. */
function shortError(err) {
  return String(err && err.message ? err.message : err)
    .replace(/[A-Za-z]:\\[^\s"']*/g, '…')
    .slice(0, 300);
}

/**
 * One run: a local backup when it is due (or `force`, "Jetzt sichern"), the generations, then the
 * sealed copy in the target folder when it is due (always after a new backup), and its generations.
 * The copy needs the control script of the own instance; other servers only make local backups.
 * Returns { backup: name or '', backupError, export: answer of backup-export or null }.
 */
function runOnce(app, now, force) {
  var settings = readSettings(app);
  var status = readStatus(app);
  var appDir = system.ownAppDir();
  var result = { backup: '', backupError: '', export: null };
  var mine = listLocal(app).filter(function (entry) {
    return entry.ours;
  });
  var newest = rules.newestUntil(mine, now);
  var target = appDir !== '' ? settings.target : null;
  var sealed = target ? listSealed(target) : null;
  var state = {
    newestLocal: newest ? newest.time : null,
    newestLocalName: newest ? newest.name : '',
    targetConfigured: !!target,
    sealedNames: sealed === null ? null : sealed.map(function (entry) {
      return entry.name;
    }),
    lastExportAttempt: status.exportAttempt
  };
  if (force || rules.plan(state, now).backup) {
    var name = rules.backupName(now);
    try {
      app.createBackup(new Context(), name);
      var made = listLocal(app).filter(function (entry) {
        return entry.name === name;
      });
      var bytes = made.length > 0 ? made[0].bytes : 0;
      status.backup = { at: now, name: name, bytes: bytes };
      status.backupError = null;
      result.backup = name;
      state.newestLocal = now;
      state.newestLocalName = name;
      app.logger().info(AREA + ': Sicherung erstellt', 'name', name, 'bytes', bytes);
    } catch (err) {
      status.backupError = { at: now, message: shortError(err) };
      result.backupError = status.backupError.message;
      app.logger().error(AREA + ': Sicherung gescheitert', 'name', name, 'error', status.backupError.message);
    }
    pruneLocal(app, settings);
  }
  var exportName = rules.plan(state, now).export;
  if (exportName !== '') {
    var previous = status.exportProblem;
    status.exportAttempt = now;
    var answer = sealed === null ? { ok: false, reason: 'unreachable', file: '', bytes: 0 } : null;
    if (answer === null) {
      answer = rules.exportView(system.runJson(appDir, 'backup-export', { name: exportName, manifest: manifestOf(app) })) || {
        ok: false,
        reason: 'failed',
        file: '',
        bytes: 0
      };
    }
    result.export = answer;
    if (answer.ok) {
      status.export = { at: now, name: answer.file, bytes: answer.bytes };
      status.exportProblem = null;
      pruneTarget(app, target, settings);
      app.logger().info(AREA + ': Sicherung ins Zielverzeichnis verschlüsselt', 'name', answer.file, 'bytes', answer.bytes);
    } else {
      status.exportProblem = { at: now, reason: answer.reason, since: previous && typeof previous.since === 'number' ? previous.since : now };
      app.logger().warn(AREA + ': Kopie ins Zielverzeichnis nicht möglich', 'name', exportName, 'reason', answer.reason);
    }
  }
  writeStatus(app, status);
  return result;
}

/**
 * Checks the backup `name` of `source` ('local' or 'target') with byl-control.ps1 backup-verify
 * (decrypt, unpack, integrity, files, throwaway server) and keeps the result in the state file.
 * The passphrase of the app (optional) goes only to the control script; without it the stored one
 * is used. Returns the result (rules.verifyView).
 */
function verifyBackup(app, appDir, source, name, passphrase, now) {
  var input = { source: source, name: name };
  if (passphrase) {
    input.passphrase = passphrase;
  }
  var result = rules.verifyView(system.runJson(appDir, 'backup-verify', input)) || {
    ok: false,
    reason: 'failed',
    encrypted: false,
    createdUtc: null,
    variables: [],
    counts: null,
    files: null
  };
  var status = readStatus(app);
  status.verify = { at: now, name: name, source: source, ok: result.ok, reason: result.reason, counts: result.counts, files: result.files };
  writeStatus(app, status);
  if (result.ok) {
    app.logger().info(AREA + ': Sicherung geprüft', 'name', name, 'source', source);
  } else {
    app.logger().warn(AREA + ': Prüfung einer Sicherung gescheitert', 'name', name, 'source', source, 'reason', result.reason);
  }
  return result;
}

/** The weekly check of the cron (rules.planVerify), only for the own instance. */
function verifyDue(app, now) {
  var appDir = system.ownAppDir();
  if (appDir === '') {
    return null;
  }
  var settings = readSettings(app);
  var status = readStatus(app);
  var local = rules.newestUntil(
    listLocal(app).filter(function (entry) {
      return entry.ours;
    }),
    now
  );
  var sealed = settings.target ? listSealed(settings.target) : null;
  var newestSealed = sealed === null ? null : rules.newestUntil(sealed, now);
  var planned = rules.planVerify(
    status.verify ? status.verify.at : null,
    local ? local.name : '',
    newestSealed ? newestSealed.name : '',
    now
  );
  return planned.due ? verifyBackup(app, appDir, planned.source, planned.name, '', now) : null;
}

/** The cron of the backups (every five minutes, backup.pb.js); never throws, never in tests. */
function tick(app, now) {
  if (app.store().get(TEST_MODE_KEY) === true) {
    return null;
  }
  if (!claim(app, now)) {
    return null;
  }
  try {
    var result = runOnce(app, now, false);
    result.verify = verifyDue(app, now);
    return result;
  } catch (err) {
    app.logger().error(AREA + ': Lauf gescheitert', 'error', shortError(err));
    return null;
  } finally {
    release(app);
  }
}

/**
 * The warnings (rules.warnings) for the state now: the newest local backup, the newest copy in
 * the target (from the last export while the target is not reachable), the last runs.
 */
function currentWarnings(app, settings, status, passphrase, now) {
  var mine = listLocal(app).filter(function (entry) {
    return entry.ours;
  });
  var sealed = settings.target ? listSealed(settings.target) : null;
  var newestSealed = null;
  if (sealed !== null && sealed.length > 0) {
    newestSealed = sealed[0].time;
  } else if (sealed === null && status.export && rules.isSealedName(status.export.name)) {
    newestSealed = rules.timeOfName(status.export.name);
  }
  var newest = rules.newestUntil(mine, now);
  return {
    newest: newest,
    sealed: sealed,
    found: rules.warnings({
      now: now,
      newestLocal: newest ? newest.time : null,
      newestSealed: newestSealed,
      target: !!settings.target,
      passphrase: passphrase,
      backupError: status.backupError,
      exportProblem: status.exportProblem,
      verify: status.verify
    })
  };
}

function entryOf(entry) {
  return entry === null ? null : { at: rules.iso(entry.at), name: entry.name === undefined ? null : entry.name, bytes: entry.bytes === undefined ? null : entry.bytes };
}

/**
 * Everything the page shows: settings, passphrase, helper, names of the variables, target, the
 * backups here and in the target, the last runs, the next backup and the warnings. `info` is the
 * answer of backup-info (rules.infoView).
 */
function overview(app, appDir, info, now) {
  var settings = readSettings(app);
  var status = readStatus(app);
  var local = listLocal(app);
  var current = currentWarnings(app, settings, status, info.passphrase, now);
  var sealed = current.sealed;
  var found = current.found;
  var list = function (entries) {
    var result = [];
    for (var i = 0; i < entries.length; i++) {
      var entry = { name: entries[i].name, at: rules.iso(entries[i].time), bytes: entries[i].bytes };
      if (entries[i].ours !== undefined) {
        entry.ours = entries[i].ours;
      }
      result.push(entry);
    }
    return result;
  };
  var warnings = [];
  for (var i = 0; i < found.length; i++) {
    warnings.push({ code: found[i].code, tone: found[i].tone, since: rules.iso(found[i].since), reason: found[i].reason });
  }
  return {
    appDir: appDir,
    settings: settings,
    passphrase: info.passphrase,
    helper: info.helper,
    variables: info.variables,
    target: info.target,
    local: list(local),
    sealed: sealed === null ? [] : list(sealed),
    last: {
      backup: status.backup ? entryOf(status.backup) : null,
      backupError: status.backupError ? { at: rules.iso(status.backupError.at), message: status.backupError.message } : null,
      export: status.export ? entryOf(status.export) : null,
      exportProblem: status.exportProblem
        ? { at: rules.iso(status.exportProblem.at), reason: status.exportProblem.reason, since: rules.iso(status.exportProblem.since) }
        : null,
      verify: status.verify
        ? {
            at: rules.iso(status.verify.at),
            name: status.verify.name,
            source: status.verify.source,
            ok: status.verify.ok === true,
            reason: status.verify.reason || '',
            counts: status.verify.counts,
            files: status.verify.files
          }
        : null
    },
    nextBackupAt: rules.iso(rules.nextBackupAt(current.newest ? current.newest.time : null, now)),
    warnings: warnings
  };
}

/** backup-info of the control script in the shape of the route, or null. */
function info(appDir) {
  return rules.infoView(system.runJson(appDir, 'backup-info'));
}

function audit(e, action, detail) {
  e.app.logger().info(AREA + ': Aktion ausgeführt', 'action', action, 'user', system.userOf(e), 'result', detail);
}

/** 400 with a code the page names in its own words (rules.TARGET_PROBLEMS, passphrase problems). */
function invalid(e, kind, problem) {
  return e.json(400, { status: 400, message: MESSAGES[kind], reason: 'invalid', problem: problem });
}

function answerOverview(e, appDir, extra) {
  var found = info(appDir);
  if (found === null) {
    return system.refuse(e, 'backup-info', 'script', 0, AREA);
  }
  var body = overview(e.app, appDir, found, Date.now());
  if (extra) {
    body.result = extra;
  }
  return e.json(200, body);
}

/** GET /api/byl/backup. */
function read(e) {
  var context = system.check(e, 'backup-info', 'GET');
  if (context.refused) {
    return system.refuse(e, 'backup-info', context.refused, context.retryAfterSeconds, AREA);
  }
  return answerOverview(e, context.appDir);
}

/**
 * GET /api/byl/backup/notice: the warnings for the attention of the app (ADR-0035), without the
 * control script; { attention, warnings }.
 */
function notice(e) {
  var context = system.check(e, 'backup-info', 'GET', { local: true });
  if (context.refused) {
    return system.refuse(e, 'backup-notice', context.refused, context.retryAfterSeconds, AREA);
  }
  // The passphrase is unknown here (no control script); a missing one alone asks for no attention.
  var found = currentWarnings(e.app, readSettings(e.app), readStatus(e.app), 'set', Date.now()).found;
  var codes = [];
  for (var i = 0; i < found.length; i++) {
    codes.push(found[i].code);
  }
  return e.json(200, { attention: rules.needsAttention(found), warnings: codes });
}

/** POST /api/byl/backup/run ("Jetzt sichern"): a backup now and its copy into the target. */
function runNow(e) {
  var context = system.check(e, 'backup-export', 'POST');
  if (context.refused) {
    return system.refuse(e, 'backup-run', context.refused, context.retryAfterSeconds, AREA);
  }
  var now = Date.now();
  if (!claim(e.app, now)) {
    return system.refuse(e, 'backup-run', 'busy', 0, AREA);
  }
  var result;
  try {
    result = runOnce(e.app, now, true);
  } finally {
    release(e.app);
  }
  audit(e, 'backup-run', result.backup !== '' ? 'ok' : 'failed');
  return answerOverview(e, context.appDir, {
    backup: result.backup,
    backupError: result.backupError,
    export: result.export === null ? null : { ok: result.export.ok, reason: result.export.reason, file: result.export.file }
  });
}

/** POST /api/byl/backup/settings: target folder, generations and the switch of the access data. */
function saveSettings(e) {
  var context = system.check(e, 'backup-configure', 'POST');
  if (context.refused) {
    return system.refuse(e, 'backup-configure', context.refused, context.retryAfterSeconds, AREA);
  }
  var input = rules.settingsInput(e.requestInfo().body);
  if (input.problem) {
    return invalid(e, 'invalid', input.problem);
  }
  var answer = rules.configureView(system.runJson(context.appDir, 'backup-configure', input.value));
  if (answer === null) {
    return system.refuse(e, 'backup-configure', 'script', 0, AREA);
  }
  audit(e, 'backup-configure', answer.ok ? 'ok' : answer.problem);
  if (!answer.ok) {
    return invalid(e, 'target', answer.problem);
  }
  return answerOverview(e, context.appDir);
}

/** POST /api/byl/backup/passphrase: the passphrase twice; kept with DPAPI by the control script. */
function savePassphrase(e) {
  var context = system.check(e, 'backup-passphrase', 'POST');
  if (context.refused) {
    return system.refuse(e, 'backup-passphrase', context.refused, context.retryAfterSeconds, AREA);
  }
  var body = e.requestInfo().body;
  var input = rules.passphraseInput(body);
  if (input.problem) {
    return invalid(e, 'passphrase', input.problem);
  }
  var raw = system.runJson(context.appDir, 'backup-passphrase', { passphrase: body.passphrase, confirmation: body.confirmation });
  var ok = raw !== null && raw.ok === true;
  audit(e, 'backup-passphrase', ok ? 'ok' : 'refused');
  if (raw === null) {
    return system.refuse(e, 'backup-passphrase', 'script', 0, AREA);
  }
  if (!ok) {
    return invalid(e, 'passphrase', typeof raw.problem === 'string' ? raw.problem : 'too-short');
  }
  return answerOverview(e, context.appDir);
}

/**
 * POST /api/byl/backup/verify ("Prüfen", "Jetzt prüfen"): { source, name, passphrase? }. The
 * passphrase is only handed on, never kept or logged.
 */
function verify(e) {
  var context = system.check(e, 'backup-verify', 'POST');
  if (context.refused) {
    return system.refuse(e, 'backup-verify', context.refused, context.retryAfterSeconds, AREA);
  }
  var input = rules.verifyInput(e.requestInfo().body);
  if (input.problem) {
    return invalid(e, 'invalid', input.problem);
  }
  var now = Date.now();
  if (!claim(e.app, now)) {
    return system.refuse(e, 'backup-verify', 'busy', 0, AREA);
  }
  var result;
  try {
    result = verifyBackup(e.app, context.appDir, input.value.source, input.value.name, input.value.passphrase || '', now);
  } finally {
    release(e.app);
  }
  audit(e, 'backup-verify', result.ok ? 'ok' : result.reason);
  return answerOverview(e, context.appDir, { verify: result });
}

module.exports = {
  tick: tick,
  runOnce: runOnce,
  verifyDue: verifyDue,
  verify: verify,
  read: read,
  notice: notice,
  runNow: runNow,
  saveSettings: saveSettings,
  savePassphrase: savePassphrase
};
