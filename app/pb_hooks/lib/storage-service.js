// Storage of the app (ADR-0047 §6 to §9, page "Einstellungen → Speicher", SPE-2): what the data
// folder, the backups, the logs and the program files take, measured when the page asks (no job in
// the background, no table), and three actions: compact the databases, clear what was left behind,
// empty discarded entries early. CommonJS module, ES5 only, Goja runtime only; the pure rules are
// in lib/storage-rules.js. The routes use the checks of the page System (lib/system-service.js:
// this machine, the address of the app, the owner of the instance, rate limit) on every platform;
// what needs the own instance of a folder app under Windows (program files, leftovers, safety
// copies, logs, free space from byl-control.ps1 doctor) is left out elsewhere, with a reason.
'use strict';

var rules = require(__hooks + '/lib/storage-rules.js');
var system = require(__hooks + '/lib/system-service.js');
var berlin = require(__hooks + '/lib/berlin-time.js');
var backupRules = require(__hooks + '/lib/backup-rules.js');
var cleanup = require(__hooks + '/lib/inbox-cleanup.js');
var trashService = require(__hooks + '/lib/trash-service.js');

var AREA = 'byl-storage';
var INBOX = 'inbox_items';
// One action at a time; a mark older than this was left by a crash.
var RUNNING_KEY = 'byl.storage.running';
var RUNNING_MS = 10 * 60 * 1000;
// Entries a walk through a folder (safety copies, pb_public) reads at most; beyond it the size is
// a lower bound ("mindestens").
var WALK_MAX = 20000;
// Program files of the folder app.
var PROGRAMS = ['pocketbase.exe', 'byl-mail.exe', 'byl-backup.exe'];

function sizeOf(path) {
  try {
    return Number($os.stat(path).size());
  } catch (err) {
    return null;
  }
}

function entriesOf(dir) {
  try {
    return $os.readDir(dir);
  } catch (err) {
    return null;
  }
}

/** Bytes below `dir` ({ bytes, complete }); stops after WALK_MAX entries. */
function walk(dir) {
  var total = 0;
  var complete = true;
  var left = WALK_MAX;
  var stack = [dir];
  while (stack.length > 0) {
    var current = stack.pop();
    var entries = entriesOf(current);
    if (entries === null) {
      complete = false;
      continue;
    }
    for (var i = 0; i < entries.length; i++) {
      if (left <= 0) {
        return { bytes: total, complete: false };
      }
      left -= 1;
      if (entries[i].isDir()) {
        stack.push($filepath.join(current, String(entries[i].name())));
        continue;
      }
      try {
        total += Number(entries[i].info().size());
      } catch (err) {
        complete = false;
      }
    }
  }
  return { bytes: total, complete: complete };
}

function modTimeOf(entry) {
  try {
    return Number(entry.info().modTime().unixMilli());
  } catch (err) {
    return null;
  }
}

/** One number of a PRAGMA as table-valued function, or null. */
function pragma(db, name) {
  try {
    var row = new DynamicModel({ value: 0 });
    db.newQuery('SELECT ' + name + ' AS value FROM pragma_' + name + '()').one(row);
    return Number(row.value);
  } catch (err) {
    return null;
  }
}

/** Size and free pages of a database: { bytes, free_bytes } (null parts when unknown). */
function databaseSize(db, file) {
  var pageSize = pragma(db, 'page_size');
  var pages = pragma(db, 'page_count');
  var free = pragma(db, 'freelist_count');
  var fileBytes = sizeOf(file);
  return {
    bytes: fileBytes !== null ? fileBytes : pageSize !== null && pages !== null ? pageSize * pages : null,
    wal_bytes: sizeOf(file + '-wal'),
    free_bytes: pageSize !== null && free !== null ? pageSize * free : null
  };
}

/** Bytes per group of data.db through dbstat, or null where the runtime lacks it. */
function databaseGroups(app) {
  try {
    var options = arrayOf(new DynamicModel({ value: '' }));
    app.db().newQuery('SELECT compile_options AS value FROM pragma_compile_options()').all(options);
    var names = [];
    for (var i = 0; i < options.length; i++) {
      names.push(String(options[i].value));
    }
    if (!rules.hasDbstat(names)) {
      return null;
    }
    var rows = arrayOf(new DynamicModel({ tbl: '', bytes: 0 }));
    app
      .db()
      .newQuery(
        'SELECT COALESCE(m.tbl_name, s.name) AS tbl, SUM(s.pgsize) AS bytes FROM dbstat AS s ' +
          'LEFT JOIN sqlite_master AS m ON m.name = s.name GROUP BY COALESCE(m.tbl_name, s.name)'
      )
      .all(rows);
    var list = [];
    for (var r = 0; r < rows.length; r++) {
      list.push({ table: String(rows[r].tbl), bytes: Number(rows[r].bytes) });
    }
    return rules.databaseGroups(list);
  } catch (err) {
    return null;
  }
}

/** Tickets in the trash with an estimate of their text, and how many are blocked (ADR-0047). */
function trashShare(app) {
  if (!trashService.trashReady(app)) {
    return null;
  }
  try {
    var row = new DynamicModel({ count: 0, bytes: 0 });
    app
      .db()
      .newQuery(
        "SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(t.title) + LENGTH(t.description) + LENGTH(COALESCE(t.trash, ''))), 0) + " +
          "(SELECT COALESCE(SUM(LENGTH(c.body)), 0) FROM comments AS c WHERE c.ticket IN (SELECT id FROM tickets WHERE deleted_at != '')) + " +
          "(SELECT COALESCE(SUM(LENGTH(h.old_value) + LENGTH(h.new_value)), 0) FROM ticket_history AS h WHERE h.ticket IN (SELECT id FROM tickets WHERE deleted_at != '')) AS bytes " +
          "FROM tickets AS t WHERE t.deleted_at != ''"
      )
      .one(row);
    return { tickets: Number(row.count), bytes: Number(row.bytes), blocked: trashService.blockedCount(app) };
  } catch (err) {
    return null;
  }
}

/** Bytes of the stored files per record of inbox_items, and the rest of the storage. */
function storedFiles(app) {
  var inboxId = '';
  try {
    inboxId = app.findCollectionByNameOrId(INBOX).id;
  } catch (err) {
    inboxId = '';
  }
  var byRecord = {};
  var rest = { count: 0, bytes: 0 };
  var fsys = app.newFilesystem();
  try {
    var files = fsys.list('');
    for (var i = 0; i < files.length; i++) {
      if (files[i].isDir) {
        continue;
      }
      var parts = rules.fileKeyParts(files[i].key);
      var bytes = Number(files[i].size);
      if (parts !== null && parts.collection === inboxId) {
        byRecord[parts.record] = (byRecord[parts.record] || 0) + bytes;
      } else {
        rest.count += 1;
        rest.bytes += bytes;
      }
    }
  } finally {
    fsys.close();
  }
  return { byRecord: byRecord, rest: rest };
}

function metaOf(raw) {
  try {
    var value = JSON.parse(String(raw || ''));
    return value && typeof value === 'object' ? value : {};
  } catch (err) {
    return {};
  }
}

/** The entries of the inbox with an original file, with their ticket. */
function filedEntries(app) {
  var trashed = trashService.trashReady(app) ? 'COALESCE(t.deleted_at, \'\')' : "''";
  var rows = arrayOf(
    new DynamicModel({ id: '', state: '', title: '', channel: '', handled: '', meta: '', ticket: '', tkey: '', tstatus: '', tdeleted: '' })
  );
  app
    .db()
    .newQuery(
      'SELECT i.id AS id, i.state AS state, i.title AS title, i.channel AS channel, i.handled_at AS handled, ' +
        "COALESCE(i.source_meta, '') AS meta, COALESCE(t.id, '') AS ticket, COALESCE(t.key, '') AS tkey, " +
        "COALESCE(t.status, '') AS tstatus, " +
        trashed +
        " AS tdeleted FROM inbox_items AS i LEFT JOIN tickets AS t ON t.id = i.ticket WHERE i.original != ''"
    )
    .all(rows);
  return rows;
}

function emptyCategories() {
  var categories = {};
  for (var i = 0; i < rules.FILE_CATEGORIES.length; i++) {
    categories[rules.FILE_CATEGORIES[i]] = { count: 0, bytes: 0 };
  }
  return categories;
}

/** Files of the inbox by where they belong, the copies of "Duplizieren", and the largest ones. */
function inboxFiles(app, nowMs) {
  var stored = storedFiles(app);
  var categories = emptyCategories();
  var copies = { count: 0, bytes: 0 };
  var entries = [];
  var nextEmpty = null;
  var rows = [];
  try {
    rows = filedEntries(app);
  } catch (err) {
    rows = [];
  }
  var today = berlin.berlinToday(nowMs);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var id = String(row.id);
    var bytes = stored.byRecord[id] || 0;
    delete stored.byRecord[id];
    var ticket = String(row.ticket) === '' ? null : { status: String(row.tstatus), trashed: String(row.tdeleted) !== '' };
    var category = rules.fileCategory({ state: String(row.state), ticket: ticket });
    categories[category].count += 1;
    categories[category].bytes += bytes;
    var meta = metaOf(row.meta);
    var copyOf = meta.copy_of && typeof meta.copy_of === 'object' ? String(meta.copy_of.key || '') : '';
    if (meta.copy_of) {
      copies.count += 1;
      copies.bytes += bytes;
    }
    if (category === 'discarded') {
      var day = rules.emptyDay(String(row.handled), cleanup.DISCARDED_RETENTION_DAYS, berlin);
      if (day !== null && (nextEmpty === null || day < nextEmpty)) {
        nextEmpty = day < today ? today : day;
      }
    }
    entries.push({
      item: id,
      title: String(row.title),
      channel: String(row.channel),
      bytes: bytes,
      category: category,
      ticket: ticket === null ? null : { id: String(row.ticket), key: String(row.tkey), status: ticket.status, trashed: ticket.trashed },
      copy_of: copyOf
    });
  }
  // Files of entries that have no original (any more) count with the rest.
  for (var orphan in stored.byRecord) {
    if (Object.prototype.hasOwnProperty.call(stored.byRecord, orphan)) {
      stored.rest.count += 1;
      stored.rest.bytes += stored.byRecord[orphan];
    }
  }
  categories.other.count += stored.rest.count;
  categories.other.bytes += stored.rest.bytes;
  var total = { count: 0, bytes: 0 };
  for (var name in categories) {
    if (Object.prototype.hasOwnProperty.call(categories, name)) {
      total.count += categories[name].count;
      total.bytes += categories[name].bytes;
    }
  }
  categories.discarded.next_empty = nextEmpty;
  return { total: total, categories: categories, copies: copies, largest: rules.largest(entries, rules.LARGEST_MAX) };
}

/** Backups in pb_data/backups: those of the app, the automatic ones of PocketBase, others. */
function localBackups(app) {
  var groups = { app: [], pocketbase: [], other: [] };
  var fsys = app.newBackupsFilesystem();
  try {
    var files = fsys.list('');
    for (var i = 0; i < files.length; i++) {
      var name = String(files[i].key);
      if (files[i].isDir || name.indexOf('/') !== -1) {
        continue;
      }
      var entry = { name: name, bytes: Number(files[i].size), time: files[i].modTime.unix() * 1000 };
      if (backupRules.isLocalName(name)) {
        entry.time = backupRules.timeOfName(name);
        groups.app.push(entry);
      } else if (rules.isAutoBackup(name)) {
        groups.pocketbase.push(entry);
      } else {
        groups.other.push(entry);
      }
    }
  } finally {
    fsys.close();
  }
  return groups;
}

/** Sealed backups in the target folder: a summary, null without a target, 'unreachable' if gone. */
function targetBackups(app) {
  var backup = require(__hooks + '/lib/backup-service.js');
  var settings = backup.readSettings(app);
  if (!settings.target) {
    return null;
  }
  var sealed = backup.listSealed(settings.target);
  return sealed === null ? 'unreachable' : rules.summarize(sealed);
}

/** Safety copies next to pb_data: those of the app (ADR-0046) and of the manual restore (ADR-0003). */
function safetyCopies(appDir, nowMs) {
  var entries = entriesOf(appDir) || [];
  var copies = [];
  for (var i = 0; i < entries.length; i++) {
    var name = String(entries[i].name());
    if (!entries[i].isDir()) {
      continue;
    }
    var time = backupRules.safetyTime(name);
    var manual = time === null && rules.isOldRestoreCopy(name);
    if (time === null && !manual) {
      continue;
    }
    var size = walk($filepath.join(appDir, name));
    var stamp = time !== null ? time : modTimeOf(entries[i]);
    copies.push({
      name: name,
      bytes: size.bytes,
      complete: size.complete,
      time: stamp,
      expired: time !== null ? backupRules.safetyExpired(name, nowMs) : stamp !== null && nowMs - stamp >= backupRules.SAFETY_KEEP_MS
    });
  }
  return copies;
}

/** Files of a folder directly in it (no walk): { count, bytes } or null if it is not there. */
function folderFiles(dir) {
  var entries = entriesOf(dir);
  if (entries === null) {
    return null;
  }
  var result = { count: 0, bytes: 0 };
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].isDir()) {
      continue;
    }
    result.count += 1;
    try {
      result.bytes += Number(entries[i].info().size());
    } catch (err) {
      result.bytes += 0;
    }
  }
  return result;
}

/** Program files, their leftovers and the web builds of the folder app. */
function programs(appDir) {
  var files = { count: 0, bytes: 0 };
  for (var i = 0; i < PROGRAMS.length; i++) {
    var size = sizeOf($filepath.join(appDir, PROGRAMS[i]));
    if (size !== null) {
      files.count += 1;
      files.bytes += size;
    }
  }
  var leftovers = { count: 0, bytes: 0, names: [] };
  var entries = entriesOf(appDir) || [];
  for (var e = 0; e < entries.length; e++) {
    var name = String(entries[e].name());
    if (!entries[e].isDir() && rules.isOldProgram(name)) {
      leftovers.count += 1;
      leftovers.names.push(name);
      leftovers.bytes += sizeOf($filepath.join(appDir, name)) || 0;
    }
  }
  var web = walk($filepath.join(appDir, 'pb_public'));
  var builds = null;
  try {
    var history = JSON.parse(toString($os.readFile($filepath.join(appDir, 'pb_public', '_app', 'builds.json'))));
    builds = history && history.builds instanceof Array ? history.builds.length : null;
  } catch (err) {
    builds = null;
  }
  return { files: files, leftovers: leftovers, web: { bytes: web.bytes, complete: web.complete, builds: builds } };
}

/** The check "disk" of byl-control.ps1 doctor -Json: { level, text } or null. */
function diskOf(appDir) {
  var raw = system.runJson(appDir, 'doctor');
  var checks = raw && raw.checks instanceof Array ? raw.checks : [];
  for (var i = 0; i < checks.length; i++) {
    if (checks[i] && checks[i].name === 'disk' && typeof checks[i].text === 'string') {
      return { level: String(checks[i].level), text: String(checks[i].text) };
    }
  }
  return null;
}

/** The whole overview of GET /api/byl/storage. */
function overview(app, appDir, nowMs) {
  var dataDir = app.dataDir();
  var local = localBackups(app);
  var safety = appDir !== '' ? safetyCopies(appDir, nowMs) : null;
  var expired = [];
  if (safety !== null) {
    for (var i = 0; i < safety.length; i++) {
      if (safety[i].expired) {
        expired.push(safety[i]);
      }
    }
  }
  var program = appDir !== '' ? programs(appDir) : null;
  var database = databaseSize(app.db(), $filepath.join(dataDir, 'data.db'));
  database.groups = databaseGroups(app);
  database.trash = trashShare(app);
  return {
    measured_at: new Date(nowMs).toISOString(),
    own_instance: appDir !== '',
    database: database,
    logs_database: databaseSize(app.auxDB(), $filepath.join(dataDir, 'auxiliary.db')),
    files: inboxFiles(app, nowMs),
    backups: {
      local: rules.summarize(local.app),
      pocketbase: rules.summarize(local.pocketbase),
      other: rules.summarize(local.other),
      target: targetBackups(app),
      safety: safety === null ? null : rules.summarize(safety)
    },
    logs: appDir !== '' ? folderFiles($filepath.join(appDir, 'logs')) : null,
    program: program,
    disk: appDir !== '' ? diskOf(appDir) : null,
    actions: {
      leftovers: {
        programs: program === null ? null : { count: program.leftovers.count, bytes: program.leftovers.bytes },
        safety: safety === null ? null : rules.summarize(expired),
        pocketbase: rules.summarize(local.pocketbase)
      },
      discarded: discardedCandidates(app).summary
    }
  };
}

// --- Actions ---------------------------------------------------------------------------------

/**
 * Discarded entries whose content the daily cleanup would empty later (lib/inbox-cleanup.js):
 * state discarded, no ticket (by the rule of ADR-0047 they hang on nothing) and not cleaned yet.
 * Returns { records, summary: { count, bytes } } with the bytes of their stored files.
 */
function discardedCandidates(app) {
  var inboxRules = require(__hooks + '/lib/inbox-rules.js');
  var inbox = require(__hooks + '/lib/inbox-service.js');
  var records = [];
  var summary = { count: 0, bytes: 0 };
  var found;
  try {
    found = app.findRecordsByFilter(INBOX, "state = 'discarded' && ticket = ''", 'id', 0, 0);
  } catch (err) {
    return { records: records, summary: summary };
  }
  var stored = null;
  for (var i = 0; i < found.length; i++) {
    var record = found[i];
    var values = cleanup.purgedValues(
      { title: record.getString('title'), body: record.getString('body'), meta: inbox.metaOf(record), original: record.getString('original') },
      inboxRules
    );
    if (values === null) {
      continue;
    }
    if (stored === null) {
      stored = storedFiles(app).byRecord;
    }
    records.push(record);
    summary.count += 1;
    summary.bytes += stored[record.id] || 0;
  }
  return { records: records, summary: summary };
}

/** "Datenbank verdichten": VACUUM of data.db and auxiliary.db, the sizes before and after. */
function vacuum(app) {
  var dataDir = app.dataDir();
  var before = {
    data: databaseSize(app.db(), $filepath.join(dataDir, 'data.db')),
    logs: databaseSize(app.auxDB(), $filepath.join(dataDir, 'auxiliary.db'))
  };
  app.vacuum();
  app.auxVacuum();
  var after = {
    data: databaseSize(app.db(), $filepath.join(dataDir, 'data.db')),
    logs: databaseSize(app.auxDB(), $filepath.join(dataDir, 'auxiliary.db'))
  };
  return { before: before, after: after };
}

function removeFile(path) {
  try {
    $os.remove(path);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * "Liegengebliebenes aufräumen" for the chosen groups: program leftovers (a running helper keeps
 * its file locked until neu-starten.bat; it is skipped), safety copies past their time, and the
 * automatic backups of PocketBase. Returns { removed: { group: { count, bytes } }, skipped: [...] }.
 */
function leftovers(app, appDir, groups, nowMs) {
  var result = { removed: {}, skipped: [] };
  for (var g = 0; g < groups.length; g++) {
    result.removed[groups[g]] = { count: 0, bytes: 0 };
  }
  if (groups.indexOf('programs') !== -1) {
    if (appDir === '') {
      result.skipped.push({ group: 'programs', name: '', reason: 'unavailable' });
    } else {
      var listed = programs(appDir).leftovers.names;
      for (var p = 0; p < listed.length; p++) {
        var path = $filepath.join(appDir, listed[p]);
        var bytes = sizeOf(path) || 0;
        if (removeFile(path)) {
          result.removed.programs.count += 1;
          result.removed.programs.bytes += bytes;
        } else {
          result.skipped.push({ group: 'programs', name: listed[p], reason: 'in_use' });
        }
      }
    }
  }
  if (groups.indexOf('safety') !== -1) {
    if (appDir === '') {
      result.skipped.push({ group: 'safety', name: '', reason: 'unavailable' });
    } else {
      var copies = safetyCopies(appDir, nowMs);
      for (var s = 0; s < copies.length; s++) {
        if (!copies[s].expired) {
          continue;
        }
        try {
          $os.removeAll($filepath.join(appDir, copies[s].name));
          result.removed.safety.count += 1;
          result.removed.safety.bytes += copies[s].bytes;
        } catch (err) {
          result.skipped.push({ group: 'safety', name: copies[s].name, reason: 'in_use' });
        }
      }
    }
  }
  if (groups.indexOf('pocketbase') !== -1) {
    var automatic = localBackups(app).pocketbase;
    var fsys = app.newBackupsFilesystem();
    try {
      for (var b = 0; b < automatic.length; b++) {
        try {
          fsys.delete(automatic[b].name);
          result.removed.pocketbase.count += 1;
          result.removed.pocketbase.bytes += automatic[b].bytes;
        } catch (err) {
          result.skipped.push({ group: 'pocketbase', name: automatic[b].name, reason: 'in_use' });
        }
      }
    } finally {
      fsys.close();
    }
  }
  return result;
}

/** "Verworfene jetzt leeren": the content of the candidates, like the daily cleanup does it. */
function emptyDiscarded(app) {
  var cleanupService = require(__hooks + '/lib/inbox-cleanup-service.js');
  var candidates = discardedCandidates(app);
  var result = { count: 0, bytes: 0, failed: 0 };
  var stored = storedFiles(app).byRecord;
  for (var i = 0; i < candidates.records.length; i++) {
    var record = candidates.records[i];
    try {
      if (cleanupService.clean(app, record)) {
        result.count += 1;
        result.bytes += stored[record.id] || 0;
      }
    } catch (err) {
      result.failed += 1;
    }
  }
  return result;
}

/** Marks an action as running; false if another one runs. */
function claim(store, nowMs) {
  var claimed = false;
  store.setFunc(RUNNING_KEY, function (since) {
    if (typeof since === 'number' && nowMs - since < RUNNING_MS && nowMs >= since) {
      return since;
    }
    claimed = true;
    return nowMs;
  });
  return claimed;
}

/** GET /api/byl/storage. */
function read(e) {
  var context = system.check(e, 'storage', 'GET', { kind: 'read', local: true, anyPlatform: true });
  if (context.refused) {
    return system.refuse(e, 'storage', context.refused, context.retryAfterSeconds, AREA);
  }
  return e.json(200, overview(e.app, system.ownAppDir(), Date.now()));
}

/** POST /api/byl/storage/actions/{action}: vacuum, leftovers ({ groups }), discarded. */
function act(e, name) {
  if (!rules.isAction(name)) {
    return system.refuse(e, name, 'unknown', 0, AREA);
  }
  var context = system.check(e, name, 'POST', { kind: 'change', local: true, anyPlatform: true });
  if (context.refused) {
    return system.refuse(e, name, context.refused, context.retryAfterSeconds, AREA);
  }
  var body = e.requestInfo().body || {};
  if (name === 'leftovers') {
    var violation = rules.leftoverGroupsViolation(body.groups);
    if (violation !== '') {
      return e.json(400, { status: 400, reason: 'invalid', message: rules.MESSAGES[violation] });
    }
  }
  var store = e.app.store();
  var now = Date.now();
  if (!claim(store, now)) {
    return system.refuse(e, name, 'busy', 0, AREA);
  }
  var result;
  try {
    if (name === 'vacuum') {
      result = vacuum(e.app);
    } else if (name === 'leftovers') {
      result = leftovers(e.app, system.ownAppDir(), body.groups.map(String), now);
    } else {
      result = emptyDiscarded(e.app);
    }
  } finally {
    store.remove(RUNNING_KEY);
  }
  e.app.logger().info(AREA + ': Aktion ausgeführt', 'action', name, 'user', system.userOf(e));
  return e.json(200, { action: name, result: result });
}

module.exports = {
  read: read,
  act: act,
  overview: overview
};
