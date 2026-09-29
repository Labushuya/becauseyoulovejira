// Notion blocks and rich text as Markdown of the app (ADR-0041; editor conventions of ADR-0032):
// bold **, italic *, strikethrough ~~, underline ++, code `, links only http(s) and mailto, GFM
// task lists "- [ ]" in bullet lists, nested points indented under their point. Every character
// that Markdown would read as syntax is escaped, so a Notion text shows as it was typed; no HTML
// is ever produced (the display runs markdown-it with html: false and DOMPurify anyway).
// Files hosted by Notion get no address: their links are signed and expire after an hour.
// Pure CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest).
'use strict';

var NOTION_PAGE_BASE = 'https://www.notion.so/';
var HEADING_LEVELS = { heading_1: 1, heading_2: 2, heading_3: 3, heading_4: 4 };
var LIST_TYPES = ['bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle'];
// Blocks without content of their own; their children are rendered in their place.
var CONTAINER_TYPES = ['column_list', 'column', 'synced_block', 'tab'];
// Blocks that carry nothing a copy needs.
var SILENT_TYPES = ['table_of_contents', 'breadcrumb', 'template'];
var MEDIA_LABELS = { image: 'Bild', video: 'Video', audio: 'Audio', file: 'Datei', pdf: 'PDF' };
var ANNOTATION_MARKS = [
  ['code', '`'],
  ['bold', '**'],
  ['italic', '*'],
  ['strikethrough', '~~'],
  ['underline', '++']
];

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

function isArray(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

/** A Notion ID without dashes, as the addresses of notion.so write it; '' for anything else. */
function compactId(id) {
  var value = text(id).toLowerCase().replace(/-/g, '');
  return /^[0-9a-f]{32}$/.test(value) ? value : '';
}

/** Address of a page or database in Notion from its ID; '' for an invalid ID. */
function notionUrl(id) {
  var compact = compactId(id);
  return compact === '' ? '' : NOTION_PAGE_BASE + compact;
}

/** An address a link may keep: http(s) or mailto without white space, else ''. */
function safeHref(value) {
  var href = text(value).replace(/^\s+|\s+$/g, '');
  if (!/^(https?:\/\/|mailto:)[^\s<>]+$/i.test(href) || href.length > 2000) {
    return '';
  }
  return href.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * Text with every character escaped that Markdown would read as inline syntax: emphasis, code,
 * links, autolinks, "~~", "++" and entities. What only counts at the start of a line follows in
 * escapeLineStart.
 */
function escapeInline(value) {
  return text(value)
    .replace(/\\/g, '\\\\')
    .replace(/([`*_[\]<])/g, '\\$1')
    .replace(/~~/g, '\\~\\~')
    .replace(/\+\+/g, '\\+\\+')
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&');
}

/**
 * One line of inline Markdown as the start of a block: leading white space goes (four spaces
 * would make code), and a start that Markdown reads as heading, quote, list marker, rule or
 * setext underline is escaped. "++" of an underline at the start stays as it is.
 */
function escapeLineStart(line) {
  var value = text(line).replace(/^[ \t]+/, '');
  if (/^#{1,6}(\s|$)/.test(value) || /^>/.test(value) || /^[-+](\s|$)/.test(value) || /^(=+|-+)\s*$/.test(value)) {
    return '\\' + value;
  }
  var numbered = /^(\d{1,9})([.)])(\s|$)/.exec(value);
  if (numbered) {
    return numbered[1] + '\\' + value.slice(numbered[1].length);
  }
  return value;
}

/** Inline code with a fence longer than any run of backticks inside. */
function codeSpan(value) {
  var content = text(value).replace(/\n/g, ' ');
  var longest = 0;
  var runs = content.match(/`+/g) || [];
  for (var i = 0; i < runs.length; i++) {
    longest = Math.max(longest, runs[i].length);
  }
  var fence = new Array(longest + 2).join('`');
  var pad = /^`|`$/.test(content) ? ' ' : '';
  return fence + pad + content + pad + fence;
}

/** German date "15.09.2026" from "2026-09-15…", else the value itself. */
function germanDate(value) {
  var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(value));
  return match ? match[3] + '.' + match[2] + '.' + match[1] : text(value);
}

// Plain text of one rich text item; a date mention as German date.
function plainOf(item) {
  if (item.type === 'mention' && isObject(item.mention) && item.mention.type === 'date' && isObject(item.mention.date)) {
    var date = item.mention.date;
    var start = germanDate(date.start);
    return date.end ? start + ' – ' + germanDate(date.end) : start;
  }
  if (item.type === 'equation' && isObject(item.equation)) {
    return text(item.equation.expression);
  }
  return text(item.plain_text);
}

// Link target of one rich text item: its own link, or the Notion address of a mentioned page or
// database.
function hrefOf(item) {
  var own = safeHref(item.href || (isObject(item.text) && isObject(item.text.link) ? item.text.link.url : ''));
  if (own !== '') {
    return own;
  }
  if (item.type === 'mention' && isObject(item.mention)) {
    var mention = item.mention;
    var target = isObject(mention[mention.type]) ? mention[mention.type].id : '';
    if (mention.type === 'page' || mention.type === 'database') {
      return notionUrl(target);
    }
  }
  return '';
}

function annotationKey(item) {
  var notes = isObject(item.annotations) ? item.annotations : {};
  var key = [];
  for (var i = 0; i < ANNOTATION_MARKS.length; i++) {
    key.push(notes[ANNOTATION_MARKS[i][0]] === true ? '1' : '0');
  }
  if (item.type === 'equation') {
    key[0] = '1';
  }
  return key.join('') + '|' + hrefOf(item);
}

// Consecutive items with the same marks and link become one, so "**a****b**" never happens.
function mergeRuns(items) {
  var runs = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!isObject(item)) {
      continue;
    }
    var plain = plainOf(item);
    if (plain === '') {
      continue;
    }
    var key = annotationKey(item);
    var last = runs[runs.length - 1];
    if (last && last.key === key) {
      last.text += plain;
    } else {
      runs.push({ key: key, text: plain, item: item });
    }
  }
  return runs;
}

// One run as Markdown; white space at its ends stays outside of the marks (CommonMark would not
// read "** a **" as bold).
function runMarkdown(run) {
  var match = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text);
  var lead = match[1];
  var core = match[2];
  var trail = match[3];
  if (core === '') {
    return run.text;
  }
  var flags = run.key.split('|')[0];
  var result = flags.charAt(0) === '1' ? codeSpan(core) : escapeInline(core);
  for (var i = 1; i < ANNOTATION_MARKS.length; i++) {
    if (flags.charAt(i) === '1') {
      result = ANNOTATION_MARKS[i][1] + result + ANNOTATION_MARKS[i][1];
    }
  }
  var href = run.key.slice(run.key.indexOf('|') + 1);
  if (href !== '') {
    result = '[' + result + '](' + href + ')';
  }
  return lead + result + trail;
}

/** Rich text of Notion as inline Markdown; line breaks stay as "\n". */
function richTextToMarkdown(items) {
  if (!isArray(items)) {
    return '';
  }
  var runs = mergeRuns(items);
  var parts = [];
  for (var i = 0; i < runs.length; i++) {
    parts.push(runMarkdown(runs[i]));
  }
  return parts.join('');
}

/** Rich text as plain text (titles, excerpts, the search in the preview). */
function plainText(items) {
  if (!isArray(items)) {
    return '';
  }
  var parts = [];
  for (var i = 0; i < items.length; i++) {
    if (isObject(items[i])) {
      parts.push(plainOf(items[i]));
    }
  }
  return parts.join('');
}

function payloadOf(block) {
  return isObject(block) && isObject(block[block.type]) ? block[block.type] : {};
}

function childrenOf(block) {
  return isArray(block.children) ? block.children : [];
}

// Lines of a paragraph-like text: the first escaped as the start of a block, every further line
// too, because breaks: true shows them as lines of their own.
function textLines(markdown) {
  var lines = text(markdown).split('\n');
  var result = [];
  for (var i = 0; i < lines.length; i++) {
    result.push(escapeLineStart(lines[i]));
  }
  return result;
}

function indentLines(lines, indent) {
  var result = [];
  for (var i = 0; i < lines.length; i++) {
    result.push(lines[i] === '' ? '' : indent + lines[i]);
  }
  return result;
}

function repeat(value, count) {
  return new Array(count + 1).join(value);
}

function codeFence(content) {
  var longest = 2;
  var runs = content.match(/`{3,}/g) || [];
  for (var i = 0; i < runs.length; i++) {
    longest = Math.max(longest, runs[i].length);
  }
  return repeat('`', longest + 1);
}

// Caption and address of a media block; files hosted by Notion keep only their name.
function mediaLine(block) {
  var payload = payloadOf(block);
  var label = MEDIA_LABELS[block.type] || 'Datei';
  var caption = plainText(payload.caption) || text(payload.name);
  var title = escapeInline(caption === '' ? label : label + ': ' + caption);
  if (payload.type === 'external' && isObject(payload.external)) {
    var href = safeHref(payload.external.url);
    if (href !== '') {
      return '[' + title + '](' + href + ')';
    }
  }
  return '_' + title + ' (in Notion)_';
}

function linkLine(label, href) {
  var target = safeHref(href);
  return target === '' ? escapeInline(label) : '[' + escapeInline(label) + '](' + target + ')';
}

// One cell of a table: inline Markdown on one line, "|" escaped (also inside code, as GFM wants).
function cellMarkdown(cell) {
  return richTextToMarkdown(cell).replace(/\n/g, ' ').replace(/\|/g, '\\|');
}

function rowLine(cells, width) {
  var parts = [];
  for (var c = 0; c < width; c++) {
    parts.push(cellMarkdown(cells[c]));
  }
  return '| ' + parts.join(' | ') + ' |';
}

// A GFM table; without a header row in Notion the header of the table stays empty.
function tableLines(block) {
  var payload = payloadOf(block);
  var rows = childrenOf(block);
  var width = Math.max(1, Number(payload.table_width) || 0);
  var lines = [];
  var first = 0;
  if (payload.has_column_header === true && rows.length > 0) {
    lines.push(rowLine(payloadOf(rows[0]).cells || [], width));
    first = 1;
  } else {
    lines.push(rowLine([], width));
  }
  lines.push('|' + repeat(' --- |', width));
  for (var r = first; r < rows.length; r++) {
    lines.push(rowLine(isArray(payloadOf(rows[r]).cells) ? payloadOf(rows[r]).cells : [], width));
  }
  return lines;
}

/** Limits of one rendering: blocks and characters; `truncated` once a limit is reached. */
function newBudget(maxBlocks, maxChars) {
  return { maxBlocks: maxBlocks, maxChars: maxChars, blocks: 0, chars: 0, truncated: false };
}

function spend(budget, lines) {
  budget.blocks += 1;
  for (var i = 0; i < lines.length; i++) {
    budget.chars += lines[i].length + 1;
  }
}

function exhausted(budget) {
  if (budget.blocks >= budget.maxBlocks || budget.chars >= budget.maxChars) {
    budget.truncated = true;
    return true;
  }
  return false;
}

// Marker of a list item; `number` is its position in a numbered list.
function listMarker(block, number) {
  if (block.type === 'numbered_list_item') {
    return number + '. ';
  }
  if (block.type === 'to_do') {
    return payloadOf(block).checked === true ? '- [x] ' : '- [ ] ';
  }
  return '- ';
}

// Lines of one list item with its children indented under the text of the point. A checkbox of
// a to-do belongs to the marker, so the children indent like those of a plain point.
function listItemLines(block, number, budget, depth) {
  var marker = listMarker(block, number);
  var indent = repeat(' ', block.type === 'numbered_list_item' ? marker.length : 2);
  var own = textLines(richTextToMarkdown(payloadOf(block).rich_text));
  var lines = [marker + (own[0] || '')];
  for (var i = 1; i < own.length; i++) {
    lines.push(indent + own[i]);
  }
  spend(budget, lines);
  var inner = renderLines(childrenOf(block), budget, depth + 1);
  return lines.concat(indentLines(inner, indent));
}

// Lines of a block that is no list item; [] for blocks without content.
function blockLines(block, budget, depth) {
  var payload = payloadOf(block);
  var type = text(block.type);
  if (HEADING_LEVELS[type]) {
    var heading = richTextToMarkdown(payload.rich_text).replace(/\n/g, ' ');
    var own = [repeat('#', HEADING_LEVELS[type]) + ' ' + heading];
    spend(budget, own);
    return own.concat(childLines(block, budget, depth));
  }
  if (type === 'paragraph') {
    var paragraph = textLines(richTextToMarkdown(payload.rich_text));
    spend(budget, paragraph);
    return (paragraph.length === 1 && paragraph[0] === '' ? [] : paragraph).concat(childLines(block, budget, depth));
  }
  if (type === 'quote' || type === 'callout') {
    var icon = type === 'callout' && isObject(payload.icon) && payload.icon.type === 'emoji' ? text(payload.icon.emoji) + ' ' : '';
    var quoted = textLines(richTextToMarkdown(payload.rich_text));
    quoted[0] = icon + quoted[0];
    spend(budget, quoted);
    var inside = quoted.concat(childLines(block, budget, depth));
    var result = [];
    for (var q = 0; q < inside.length; q++) {
      result.push(inside[q] === '' ? '>' : '> ' + inside[q]);
    }
    return result;
  }
  if (type === 'code') {
    var content = plainText(payload.rich_text);
    var fence = codeFence(content);
    var named = text(payload.language).toLowerCase();
    var language = named === 'plain text' ? '' : named.replace(/[^a-z0-9+#-]/g, '');
    var code = [fence + language].concat(content.split('\n'), [fence]);
    spend(budget, code);
    return code;
  }
  if (type === 'equation') {
    var equation = [codeSpan(payload.expression)];
    spend(budget, equation);
    return equation;
  }
  if (type === 'divider') {
    spend(budget, ['---']);
    return ['---'];
  }
  if (type === 'table') {
    var table = tableLines(block);
    spend(budget, table);
    return table;
  }
  if (MEDIA_LABELS[type]) {
    var media = [mediaLine(block)];
    spend(budget, media);
    return media;
  }
  if (type === 'bookmark' || type === 'embed' || type === 'link_preview') {
    var caption = plainText(payload.caption);
    var link = [linkLine(caption === '' ? text(payload.url) : caption, payload.url)];
    spend(budget, link);
    return link;
  }
  if (type === 'child_page' || type === 'child_database') {
    var child = [linkLine((type === 'child_page' ? 'Unterseite: ' : 'Datenbank: ') + text(payload.title), notionUrl(block.id))];
    spend(budget, child);
    return child;
  }
  if (type === 'link_to_page') {
    var target = payload[payload.type];
    var pageLink = [linkLine('Verweis auf eine Seite', notionUrl(target))];
    spend(budget, pageLink);
    return pageLink;
  }
  if (CONTAINER_TYPES.indexOf(type) !== -1) {
    spend(budget, []);
    return renderLines(childrenOf(block), budget, depth + 1);
  }
  if (SILENT_TYPES.indexOf(type) !== -1) {
    return [];
  }
  var note = ['_Nicht übernommen: Inhalt der Art „' + escapeInline(type === 'unsupported' ? text(payload.block_type) || type : type) + '“._'];
  spend(budget, note);
  return note;
}

// Children of a block that is no list item (toggle headings, paragraphs with children): below
// it, not indented.
function childLines(block, budget, depth) {
  var inner = renderLines(childrenOf(block), budget, depth + 1);
  return inner.length === 0 ? [] : [''].concat(inner);
}

/**
 * Lines of a sequence of blocks: blocks apart by an empty line, list items of one list directly
 * one under the other, two lists in a row of the same kind with different markers apart.
 */
function renderLines(blocks, budget, depth) {
  var lines = [];
  var previousList = '';
  var number = 0;
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    if (!isObject(block)) {
      continue;
    }
    if (exhausted(budget)) {
      break;
    }
    var type = text(block.type);
    var isList = LIST_TYPES.indexOf(type) !== -1;
    var listKind = type === 'numbered_list_item' ? 'numbered' : 'bullet';
    var produced;
    if (isList) {
      if (previousList === listKind) {
        number += 1;
      } else {
        var start = Number(payloadOf(block).list_start_index);
        number = type === 'numbered_list_item' && start > 0 ? start : 1;
      }
      produced = listItemLines(block, number, budget, depth);
    } else {
      produced = blockLines(block, budget, depth);
    }
    if (produced.length === 0) {
      continue;
    }
    if (lines.length > 0 && !(isList && previousList === listKind)) {
      lines.push('');
    }
    lines = lines.concat(produced);
    previousList = isList ? listKind : '';
  }
  return lines;
}

/**
 * Blocks with their fetched children (`children` on each block) as Markdown within the limits.
 * Returns { markdown, blocks, truncated }.
 */
function blocksToMarkdown(blocks, maxBlocks, maxChars) {
  var budget = newBudget(maxBlocks, maxChars);
  var lines = renderLines(isArray(blocks) ? blocks : [], budget, 0);
  var markdown = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  if (markdown.length > maxChars) {
    markdown = markdown.slice(0, maxChars);
    budget.truncated = true;
  }
  return { markdown: markdown, blocks: budget.blocks, truncated: budget.truncated };
}

module.exports = {
  NOTION_PAGE_BASE: NOTION_PAGE_BASE,
  LIST_TYPES: LIST_TYPES,
  compactId: compactId,
  notionUrl: notionUrl,
  safeHref: safeHref,
  escapeInline: escapeInline,
  escapeLineStart: escapeLineStart,
  germanDate: germanDate,
  richTextToMarkdown: richTextToMarkdown,
  plainText: plainText,
  blocksToMarkdown: blocksToMarkdown
};
