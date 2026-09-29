// Import of existing Notion lists into the inbox (ADR-0041): only reading, only copies, only on
// request. "Verbindung prüfen", the list of shared sources, a preview of the entries of one source
// and the import of chosen entries, plus the summary of the sources imported so far (from the
// inbox, without asking Notion). Every entry goes through inbox-service.ingest: the duplicate key
// is the ID of the Notion page or block, so an entry comes only once, also after it was
// discarded (tombstone, ADR-0031). The token is read from the variable of the connection at the
// moment of the request and never leaves this module but in the header to Notion; messages and
// logs are cleaned with secrets.redact. A manual import needs no keyword (ADR-0020 §4).
// CommonJS module, ES5 only, Goja runtime only.
'use strict';

var rules = require(__hooks + '/lib/notion-rules.js');
var markdown = require(__hooks + '/lib/notion-markdown.js');
var notion = require(__hooks + '/lib/notion-client.js');
var secrets = require(__hooks + '/lib/secrets.js');
var berlin = require(__hooks + '/lib/berlin-time.js');
var connections = require(__hooks + '/lib/connection-service.js');
var inbox = require(__hooks + '/lib/inbox-service.js');
var inboxRules = require(__hooks + '/lib/inbox-rules.js');

var ORIGINAL_NAME = 'notion.json';
var NOT_FOUND = 'Verbindung nicht gefunden.';
var NOT_SHARED_HINT =
  'Die Integration sieht noch keine Seite. In Notion eine Seite oder Datenbank freigeben: „•••“ → „Verbindungen“ → Integration hinzufügen.';
var GONE = 'Nicht mehr in der Quelle (in Notion gelöscht oder verschoben).';
var DONE_SKIPPED = 'Erledigt, übersprungen.';

function answer(status, body) {
  return { status: status, body: body };
}

function label(record) {
  return '"' + record.getString('label') + '" (' + record.id + ')';
}

/**
 * The visible Notion connection of the request with its token, or { answer } for a missing,
 * foreign or other connection (404), a paused one and missing access data (both 200 with their
 * state). Before the migration of the connections visibleConnection throws 503.
 */
function prepare(e, withToken) {
  var record = connections.visibleConnection(e, e.request.pathValue('id'));
  if (!record || record.getString('type') !== 'notion') {
    return { answer: answer(404, { message: NOT_FOUND }) };
  }
  if (!withToken) {
    return { record: record };
  }
  if (!record.getBool('enabled')) {
    return { answer: answer(200, { status: 'disabled', message: '„' + record.getString('label') + '“ ist pausiert.' }) };
  }
  var variable = record.getString('secret_env');
  var token = secrets.read(variable, function (name) {
    return $os.getenv(name);
  });
  if (token === '') {
    return {
      answer: answer(200, {
        status: 'missing',
        missing: [variable],
        message: 'Zugangsdaten fehlen: Variable ' + variable + ' anlegen, dann die App neu starten (neu-starten.bat).'
      })
    };
  }
  return { record: record, token: token, variable: variable };
}

/**
 * Notes the outcome of a request to Notion at the connection: the time of the run, and a success
 * (with its hint, if given) or an error. `outcome.store` is false for a failure that concerns only
 * one source or is passing (429, server error): it leaves the state of the connection alone.
 */
function note(app, record, outcome) {
  try {
    var current = app.findRecordById('connections', record.id);
    var stamp = berlin.toPocketBaseDate(Date.now());
    current.set('last_run_at', stamp);
    if (outcome.ok) {
      current.set('last_ok_at', stamp);
      current.set('last_error', '');
      if (outcome.hint !== undefined) {
        current.set('last_hint', outcome.hint);
      }
    } else if (outcome.store) {
      current.set('last_error', outcome.message);
    }
    app.save(current);
  } catch (err) {
    app.logger().warn('byl-notion: Verbindung ' + label(record) + ': Zustand nicht gespeichert: ' + secrets.redact(String(err), []));
  }
}

/**
 * A thrown failure as answer: the German message, whether it concerns the connection, stored at
 * the connection when it does (or always with `storeAlways`) and logged without the token.
 */
function failed(e, context, err, where, storeAlways) {
  if (!notion.isFailure(err)) {
    throw err;
  }
  var result = rules.failureOf(err.notionStatus, err.notionCode, where, context.variable);
  var message = secrets.redact(result.message, [context.token]);
  note(e.app, context.record, { ok: false, store: result.connection || storeAlways === true, message: message });
  e.app.logger().warn('byl-notion: Verbindung ' + label(context.record) + ': ' + message);
  return answer(200, { status: 'error', message: message, reason: result.connection ? 'connection' : 'source' });
}

function trimmed(value) {
  return String(value === undefined || value === null ? '' : value).replace(/^\s+|\s+$/g, '');
}

/** POST …/notion/check: "Verbindung prüfen" with the bot user and whether anything is shared. */
function check(e) {
  var context = prepare(e, true);
  if (context.answer) {
    return context.answer;
  }
  var client = notion.create(e.app, context.token);
  var me;
  var shared;
  try {
    me = client.me();
    shared = client.seesAnything();
  } catch (err) {
    return failed(e, context, err, 'connection', true);
  }
  var bot = me.bot && typeof me.bot === 'object' ? me.bot : {};
  note(e.app, context.record, { ok: true, hint: shared ? '' : NOT_SHARED_HINT });
  return answer(200, {
    status: 'ok',
    workspace: trimmed(bot.workspace_name).slice(0, 200),
    bot: trimmed(me.name).slice(0, 200),
    shared: shared
  });
}

/** GET …/notion/sources?q=: shared data sources and pages (no rows), last edited first. */
function sources(e) {
  var context = prepare(e, true);
  if (context.answer) {
    return context.answer;
  }
  var query = trimmed(e.request.url.query().get('q')).slice(0, 100);
  var client = notion.create(e.app, context.token);
  var found;
  var pages;
  try {
    found = client.search('data_source', query, rules.LIMITS.maxSources);
    pages = client.search('page', query, rules.LIMITS.maxRows);
  } catch (err) {
    return failed(e, context, err, 'connection', false);
  }
  var list = [];
  var dataSources = 0;
  var pageCount = 0;
  var all = found.results.concat(pages.results);
  for (var i = 0; i < all.length; i++) {
    var source = rules.sourceOf(all[i], markdown);
    if (source === null) {
      continue;
    }
    if (source.type === 'page') {
      if (pageCount >= rules.LIMITS.maxSources) {
        continue;
      }
      pageCount += 1;
    } else {
      dataSources += 1;
    }
    list.push(source);
  }
  note(e.app, context.record, { ok: true, hint: list.length === 0 && query === '' ? NOT_SHARED_HINT : '' });
  return answer(200, {
    status: 'ok',
    sources: list,
    truncated: found.truncated || pages.truncated || pageCount >= rules.LIMITS.maxSources,
    query: query,
    counts: { data_sources: dataSources, pages: pageCount }
  });
}

/**
 * GET …/notion/imports: the sources taken from this connection so far, from the inbox: title,
 * kind, address, number of entries, last import and the options of the last one (date property,
 * page content), newest first. Entries discarded long ago (tombstones without details) count no
 * more.
 */
function imports(e) {
  var context = prepare(e, false);
  if (context.answer) {
    return context.answer;
  }
  var rows = arrayOf(
    new DynamicModel({
      source_id: '',
      source_type: '',
      source_title: '',
      source_url: '',
      date_property: '',
      copy: 0,
      count: 0,
      last_created: ''
    })
  );
  e.app
    .db()
    .newQuery(
      "SELECT json_extract(source_meta, '$.notion.source_id') AS source_id, " +
        "IFNULL(json_extract(source_meta, '$.notion.source_type'), '') AS source_type, " +
        "IFNULL(json_extract(source_meta, '$.notion.source_title'), '') AS source_title, " +
        "IFNULL(json_extract(source_meta, '$.notion.source_url'), '') AS source_url, " +
        "IFNULL(json_extract(source_meta, '$.notion.date_property'), '') AS date_property, " +
        "IFNULL(json_extract(source_meta, '$.notion.copy'), 0) AS copy, " +
        'COUNT(*) AS count, MAX(created) AS last_created ' +
        "FROM inbox_items WHERE channel = 'notion' AND connection = {:connection} AND json_valid(source_meta) " +
        "AND json_type(source_meta, '$.notion.source_id') = 'text' " +
        'GROUP BY source_id ORDER BY last_created DESC LIMIT 100'
    )
    .bind({ connection: context.record.id })
    .all(rows);
  var list = [];
  for (var i = 0; i < rows.length; i++) {
    var id = rules.normalizeId(rows[i].source_id);
    if (id === '' || !rules.isSourceType(rows[i].source_type)) {
      continue;
    }
    list.push({
      id: id,
      type: rows[i].source_type,
      title: rows[i].source_title || rules.UNTITLED,
      url: rows[i].source_url,
      count: rows[i].count,
      last: rows[i].last_created,
      date_property: rows[i].date_property,
      copy_content: Number(rows[i].copy) === 1
    });
  }
  return answer(200, { status: 'ok', imports: list });
}

/**
 * The entries of one source: a data source with its schema, the chosen date property and its
 * rows, or a page with the points of its lists. Throws failures of the client; returns
 * { invalid: message } for a date property that is no date property of the data source.
 */
function fetchSource(client, request) {
  var limits = rules.LIMITS;
  if (request.source.type === 'data_source') {
    var dataSource = client.dataSource(request.source.id);
    var schema = dataSource.properties && typeof dataSource.properties === 'object' ? dataSource.properties : {};
    var chosen = rules.chooseDateProperty(schema, request.dateProperty);
    if (chosen.invalid) {
      return { invalid: 'Diese Datums-Eigenschaft gibt es in der Datenbank nicht.' };
    }
    var parent = dataSource.parent && typeof dataSource.parent === 'object' ? dataSource.parent : {};
    var database = rules.normalizeId(parent.database_id);
    var source = {
      id: request.source.id,
      type: 'data_source',
      title: markdown.plainText(dataSource.title).replace(/\s+/g, ' ').replace(/^ | $/g, '') || rules.UNTITLED,
      url: markdown.notionUrl(database === '' ? request.source.id : database)
    };
    var rows = client.rows(request.source.id, limits.maxRows);
    var context = { schema: schema, dateProperty: chosen.name, doneRule: rules.doneRuleOf(schema) };
    var entries = [];
    for (var i = 0; i < rows.results.length; i++) {
      var row = rows.results[i];
      if (row && row.object === 'page' && row.in_trash !== true && rules.normalizeId(row.id) !== '') {
        entries.push(rules.rowEntry(row, context, berlin, markdown));
      }
    }
    return {
      source: source,
      entries: entries,
      truncated: rows.truncated,
      empty: 0,
      dateProperties: rules.dateProperties(schema),
      dateProperty: chosen.name
    };
  }
  var page = client.page(request.source.id);
  var pageSource = {
    id: request.source.id,
    type: 'page',
    title: rules.pageTitle(page, markdown) || rules.UNTITLED,
    url: rules.pageUrl(page, markdown)
  };
  var tree = client.tree(request.source.id, rules.descendForPoints, {
    requests: limits.treeRequests,
    blocks: limits.treeBlocks,
    depth: limits.treeDepth
  });
  var points = rules.pointEntries(tree.blocks, { url: pageSource.url }, berlin, markdown);
  return {
    source: pageSource,
    entries: points.entries,
    truncated: tree.truncated,
    empty: points.empty,
    dateProperties: [],
    dateProperty: ''
  };
}

// The fields of an entry the duplicate check needs (channel and Notion ID).
function stubOf(entry) {
  return { channel: 'notion', kind: entry.kind, title: entry.title, source_ref: entry.ref, meta: {} };
}

function limitsOf() {
  var limits = rules.LIMITS;
  return {
    max_rows: limits.maxRows,
    import_batch: limits.importBatch,
    content_blocks: limits.contentBlocks,
    content_chars: limits.contentChars,
    tree_blocks: limits.treeBlocks
  };
}

/** POST …/notion/preview: the entries of one source with their state in the inbox. */
function preview(e) {
  var context = prepare(e, true);
  if (context.answer) {
    return context.answer;
  }
  var parsed = rules.parseRequest(e.requestInfo().body, false);
  if (!parsed.ok) {
    return answer(400, { message: parsed.message });
  }
  var client = notion.create(e.app, context.token);
  var fetched;
  try {
    fetched = fetchSource(client, parsed.value);
  } catch (err) {
    return failed(e, context, err, 'source', false);
  }
  if (fetched.invalid) {
    return answer(400, { message: fetched.invalid });
  }
  note(e.app, context.record, { ok: true, hint: '' });
  var owner = context.record.getString('owner');
  var items = [];
  for (var i = 0; i < fetched.entries.length; i++) {
    var entry = fetched.entries[i];
    var existing = inbox.lookup(e.app, owner, stubOf(entry));
    items.push({
      ref: entry.ref,
      kind: entry.kind,
      title: entry.title.slice(0, 300),
      source_date: entry.date === null ? '' : entry.date.sourceDate,
      all_day: entry.date !== null && entry.date.allDay,
      excerpt: entry.excerpt,
      section: entry.section || '',
      done: entry.done,
      url: entry.url,
      state: existing ? existing.state : '',
      message: existing ? existing.message : ''
    });
  }
  return answer(200, {
    status: 'ok',
    source: fetched.source,
    date_properties: fetched.dateProperties,
    date_property: fetched.dateProperty,
    items: items,
    truncated: fetched.truncated,
    empty: fetched.empty,
    limits: limitsOf()
  });
}

// The original file of an entry: what Notion delivered for it, as JSON.
function originalOf(entry, source, contentBlocks) {
  var copy = {
    notion_version: rules.API_VERSION,
    fetched_at: new Date().toISOString(),
    source: source
  };
  copy[entry.kind === 'task' ? 'page' : 'block'] = entry.raw;
  if (contentBlocks !== null) {
    copy.content = contentBlocks;
  }
  return JSON.stringify(copy);
}

// The page content of a row as Markdown within the limits: { markdown, truncated, blocks, tree }.
function contentOf(client, entry) {
  var limits = rules.LIMITS;
  var tree = client.tree(entry.ref, function (block) {
    return rules.descendForContent(block);
  }, { requests: limits.contentRequests, blocks: limits.contentBlocks, depth: limits.treeDepth });
  var rendered = markdown.blocksToMarkdown(tree.blocks, limits.contentBlocks, limits.contentChars);
  return { markdown: rendered.markdown, truncated: rendered.truncated || tree.truncated, tree: tree.blocks };
}

// The draft of an entry for inbox-service.ingest, with its original file or the note that it
// was larger than the limit (ADR-0031 §4).
function draftOf(entry, fetched, options, content, connectionId) {
  var meta = rules.metaOf(entry, fetched.source, options, content);
  var original = originalOf(entry, fetched.source, content === null ? null : content.tree);
  var size = rules.utf8Length(original);
  var draft = {
    channel: 'notion',
    kind: entry.kind,
    title: entry.title,
    body: rules.bodyOf(entry, content),
    source_url: entry.url,
    source_ref: entry.ref,
    source_date: entry.date === null ? '' : entry.date.sourceDate,
    meta: meta,
    connection: connectionId
  };
  if (size > rules.LIMITS.originalBytes) {
    meta.original_omitted = 'too_large';
    meta.original_size = size;
  } else {
    draft.original = original;
    draft.originalName = ORIGINAL_NAME;
  }
  return draft;
}

function validationMessage(err) {
  var data = err && err.data && typeof err.data === 'object' ? err.data : null;
  if (data) {
    for (var field in data) {
      if (Object.prototype.hasOwnProperty.call(data, field) && data[field] && data[field].message) {
        return String(data[field].message);
      }
    }
  }
  return 'Der Eintrag ließ sich nicht speichern.';
}

/**
 * POST …/notion/import: takes the chosen entries of one source into the inbox (at most
 * LIMITS.importBatch per request). Per entry: created, duplicate (with the state of the existing
 * entry), skipped (done with "Erledigte überspringen") or failed. A failure of the connection on
 * the way stops the rest and answers the results so far with status "error".
 */
function importEntries(e) {
  var context = prepare(e, true);
  if (context.answer) {
    return context.answer;
  }
  var parsed = rules.parseRequest(e.requestInfo().body, true);
  if (!parsed.ok) {
    return answer(400, { message: parsed.message });
  }
  var request = parsed.value;
  var client = notion.create(e.app, context.token);
  var fetched;
  try {
    fetched = fetchSource(client, request);
  } catch (err) {
    return failed(e, context, err, 'source', false);
  }
  if (fetched.invalid) {
    return answer(400, { message: fetched.invalid });
  }
  var byRef = {};
  for (var i = 0; i < fetched.entries.length; i++) {
    byRef[fetched.entries[i].ref] = fetched.entries[i];
  }
  var owner = context.record.getString('owner');
  var options = { copyContent: request.copyContent, dateProperty: fetched.dateProperty };
  var results = [];
  var counts = { created: 0, duplicates: 0, skipped: 0, failed: 0 };
  for (var r = 0; r < request.refs.length; r++) {
    var ref = request.refs[r];
    var entry = Object.prototype.hasOwnProperty.call(byRef, ref) ? byRef[ref] : null;
    if (entry === null) {
      counts.failed += 1;
      results.push({ ref: ref, status: 'failed', message: GONE });
      continue;
    }
    if (request.skipDone && entry.done) {
      counts.skipped += 1;
      results.push({ ref: ref, status: 'skipped', message: DONE_SKIPPED });
      continue;
    }
    var existing = inbox.lookup(e.app, owner, stubOf(entry));
    if (existing) {
      counts.duplicates += 1;
      results.push({ ref: ref, status: 'duplicate', message: existing.message, state: existing.state });
      continue;
    }
    var content = null;
    if (request.copyContent && entry.kind === 'task') {
      try {
        content = contentOf(client, entry);
      } catch (err) {
        var outcome = failed(e, context, err, 'source', false);
        if (outcome.body.reason === 'connection') {
          return answer(200, { status: 'error', message: outcome.body.message, items: results, counts: counts });
        }
        counts.failed += 1;
        results.push({ ref: ref, status: 'failed', message: outcome.body.message });
        continue;
      }
    }
    var saved;
    try {
      saved = inbox.ingest(e.app, owner, draftOf(entry, fetched, options, content, context.record.id));
    } catch (err) {
      counts.failed += 1;
      results.push({ ref: ref, status: 'failed', message: validationMessage(err) });
      continue;
    }
    if (saved.kind === 'created') {
      counts.created += 1;
      results.push({ ref: ref, status: 'created', message: '', item: saved.item.id });
    } else {
      // Taken by another request since the check above.
      var state = saved.item.getString('state');
      counts.duplicates += 1;
      results.push({ ref: ref, status: 'duplicate', message: inboxRules.duplicateMessage(state, ''), state: state });
    }
  }
  note(e.app, context.record, { ok: true, hint: '' });
  return answer(200, { status: 'ok', source: fetched.source, items: results, counts: counts });
}

module.exports = {
  NOT_SHARED_HINT: NOT_SHARED_HINT,
  check: check,
  sources: sources,
  imports: imports,
  preview: preview,
  importEntries: importEntries
};
