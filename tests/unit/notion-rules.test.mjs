// Pure rules of the Notion import (ADR-0041): app/pb_hooks/lib/notion-rules.js with
// notion-markdown.js and berlin-time.js passed in, as the service does. Checked: the fixed API and
// its test mode, messages and repetitions of failures, the sources of the search, dates, property
// values, "Erledigte überspringen", rows and points of lists as entries, source_meta and the
// request bodies of the routes.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('notion-rules.js');
const md = loadHookLib('notion-markdown.js');
const berlin = loadHookLib('berlin-time.js');

const PLAIN = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' };
const rt = (content, annotations = {}, link = null) => ({
	type: 'text',
	text: { content, link: link === null ? null : { url: link } },
	annotations: { ...PLAIN, ...annotations },
	plain_text: content,
	href: link
});
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let counter = 100;
const block = (type, payload = {}, children) => {
	counter += 1;
	return { object: 'block', id: ID(counter), type, [type]: payload, has_children: children !== undefined, ...(children === undefined ? {} : { children }) };
};

describe('API and test mode', () => {
	it('talks to api.notion.com with version 2026-03-11', () => {
		expect(rules.API_BASE).toBe('https://api.notion.com');
		expect(rules.API_VERSION).toBe('2026-03-11');
		expect(rules.DEFAULT_SECRET_ENV).toBe('BYL_NOTION_TOKEN');
	});

	it('takes the fake port only in the test mode and only on 127.0.0.1', () => {
		expect(rules.apiBase(true, '4567')).toBe('http://127.0.0.1:4567');
		expect(rules.apiBase(false, '4567')).toBe(rules.API_BASE);
		expect(rules.apiBase(undefined, '4567')).toBe(rules.API_BASE);
		for (const value of ['', '0', '65536', '08080', '4567x', 'evil.example:80', '-1']) {
			expect(rules.apiBase(true, value), value).toBe(rules.API_BASE);
		}
	});

	it('leaves the mark of the test mode to a hook of the tests', () => {
		const fixture = readFileSync(new URL('../fixtures/pb_hooks/test-mode.pb.js', import.meta.url), 'utf8');
		expect(fixture).toContain(`set('${rules.TEST_MODE_KEY}', true)`);
		const appDir = new URL('../../app/pb_hooks/', import.meta.url);
		const files = [
			...readdirSync(appDir).filter((name) => name.endsWith('.js')).map((name) => new URL(name, appDir)),
			...readdirSync(new URL('lib/', appDir)).map((name) => new URL(join('lib', name), appDir))
		];
		for (const file of files) {
			const source = readFileSync(file, 'utf8');
			expect(source.includes(`set('${rules.TEST_MODE_KEY}'`), file.pathname).toBe(false);
			expect(source.includes('.set(rules.TEST_MODE_KEY'), file.pathname).toBe(false);
		}
		const harness = readFileSync(new URL('../support/pocketbase-harness.mjs', import.meta.url), 'utf8');
		expect(harness).toContain(`${rules.TEST_PORT_ENV}: '9'`);
	});
});

describe('IDs', () => {
	it('accepts 32 hex digits with or without dashes, nothing else', () => {
		expect(rules.normalizeId('0000000A00004000800000000000000B')).toBe('0000000a-0000-4000-8000-00000000000b');
		expect(rules.normalizeId('0000000a-0000-4000-8000-00000000000b')).toBe('0000000a-0000-4000-8000-00000000000b');
		for (const value of ['', 'abc', '../users/me', `${'a'.repeat(31)}g`, 'a'.repeat(33), null, 42]) {
			expect(rules.normalizeId(value)).toBe('');
		}
	});
});

describe('failures', () => {
	it('explains every status in German without the token', () => {
		const token = rules.failureOf(401, 'unauthorized', 'connection', 'BYL_NOTION_TOKEN');
		expect(token).toEqual({
			message: 'Notion lehnt den Token ab (401). Stimmt der Wert von BYL_NOTION_TOKEN? Neuen Token setzen, dann neu-starten.bat.',
			connection: true
		});
		expect(rules.failureOf(0, '', 'connection', 'X')).toMatchObject({ connection: true, message: expect.stringContaining('nicht erreichbar') });
		expect(rules.failureOf(403, 'restricted_resource', 'connection', 'X')).toMatchObject({ connection: true, message: expect.stringContaining('Read content') });
		expect(rules.failureOf(403, 'restricted_resource', 'source', 'X')).toMatchObject({ connection: false });
		expect(rules.failureOf(404, 'object_not_found', 'source', 'X')).toMatchObject({ connection: false, message: expect.stringContaining('„•••“ → „Verbindungen“') });
		expect(rules.failureOf(404, 'object_not_found', 'connection', 'X').connection).toBe(true);
		expect(rules.failureOf(429, 'rate_limited', 'source', 'X')).toMatchObject({ connection: false, message: expect.stringContaining('(429)') });
		expect(rules.failureOf(503, 'service_unavailable', 'source', 'X')).toMatchObject({ connection: false, message: expect.stringContaining('HTTP 503') });
		expect(rules.failureOf(400, 'validation_error', 'source', 'X').message).toBe('Notion lehnt die Anfrage ab (HTTP 400, validation_error).');
		expect(rules.failureOf(409, '<script>', 'source', 'X').message).toBe('Notion lehnt die Anfrage ab (HTTP 409, script).');
	});

	it('repeats after 429 as Retry-After says, after server errors twice, else never', () => {
		expect(rules.retryDelayMs(429, '2', 0)).toBe(2000);
		expect(rules.retryDelayMs(429, '', 1)).toBe(2000);
		expect(rules.retryDelayMs(529, 'soon', 2)).toBe(4000);
		expect(rules.retryDelayMs(429, '31', 0)).toBe(-1);
		expect(rules.retryDelayMs(429, '1', 3)).toBe(-1);
		expect(rules.retryDelayMs(503, '', 0)).toBe(1000);
		expect(rules.retryDelayMs(500, '', 1)).toBe(2000);
		expect(rules.retryDelayMs(502, '', 2)).toBe(-1);
		for (const status of [0, 400, 401, 403, 404, 409]) expect(rules.retryDelayMs(status, '1', 0)).toBe(-1);
	});

	it('keeps about 3 requests per second', () => {
		expect(rules.throttleWaitMs(null, 1000)).toBe(0);
		expect(rules.throttleWaitMs(1000, 1100)).toBe(250);
		expect(rules.throttleWaitMs(1000, 1400)).toBe(0);
		expect(rules.throttleWaitMs(5000, 1000)).toBe(350);
	});

	it('calls a time-out slow, not unreachable, and no problem of the connection (fix 2026-09-30)', () => {
		const slow = rules.failureOf(0, 'timeout', 'source', 'X');
		expect(slow).toEqual({
			message: 'Notion antwortet gerade zu langsam (Zeitüberschreitung). Bitte in einer Minute erneut versuchen.',
			connection: false
		});
		expect(rules.failureOf(0, 'timeout', 'connection', 'X').connection).toBe(false);
		expect(rules.failureOf(0, '', 'source', 'X').message).toContain('nicht erreichbar');
		for (const text of [
			'Get "http://127.0.0.1:9/v1/users/me": context deadline exceeded (Client.Timeout exceeded while awaiting headers)',
			'net/http: request canceled (Client.Timeout exceeded)',
			'i/o timeout'
		]) {
			expect(rules.isTimeoutText(text), text).toBe(true);
		}
		expect(rules.isTimeoutText('dial tcp 127.0.0.1:9: connectex: No connection could be made')).toBe(false);
		expect(rules.isTimeoutText(undefined)).toBe(false);
	});
});

describe('time limits of a request (fix 2026-09-30)', () => {
	it('ends every request far below the 5 minutes of PocketBase and the browser', () => {
		expect(rules.LIMITS).toMatchObject({ timeoutSeconds: 30, routeSeconds: 90, importSeconds: 30, importBatch: 100 });
		expect(rules.LIMITS.importSeconds).toBeLessThan(rules.LIMITS.routeSeconds);
		// The browser waits 150 s (web/src/lib/domain/notion.ts): more than a request may take.
		expect(rules.LIMITS.routeSeconds + rules.LIMITS.timeoutSeconds).toBeLessThanOrEqual(150);
	});

	it('takes the defaults, shorter ones only in the test mode', () => {
		const defaults = { routeMs: 90_000, importMs: 30_000 };
		expect(rules.timingOf(false, '100,2000')).toEqual(defaults);
		expect(rules.timingOf(undefined, '100,2000')).toEqual(defaults);
		expect(rules.timingOf(true, '')).toEqual(defaults);
		expect(rules.timingOf(true, '100,2000')).toEqual({ routeMs: 2000, importMs: 100 });
		expect(rules.timingOf(true, ' 1,1 ')).toEqual({ routeMs: 1, importMs: 1 });
		for (const value of ['0,2000', '100,0', '30001,2000', '100,90001', '100', 'a,b', '100;2000', '-1,2000']) {
			expect(rules.timingOf(true, value), value).toEqual(defaults);
		}
		expect(rules.TEST_TIMING_ENV).toBe('BYL_TEST_NOTION_TIMING');
	});

	it('gives each request to Notion only the time left, and none below one second', () => {
		expect(rules.attemptSeconds(100_000, 0)).toBe(30);
		expect(rules.attemptSeconds(100_000, 80_000)).toBe(20);
		expect(rules.attemptSeconds(100_000, 98_500)).toBe(1);
		expect(rules.attemptSeconds(100_000, 99_001)).toBe(0);
		expect(rules.attemptSeconds(100_000, 120_000)).toBe(0);
		expect(rules.attemptSeconds(Number.NaN, 0)).toBe(0);
	});
});

describe('sources of the search', () => {
	it('takes data sources and pages, not rows and not what is in the trash', () => {
		const dataSource = {
			object: 'data_source',
			id: ID(1).replace(/-/g, ''),
			title: [rt('Aufgaben')],
			parent: { type: 'database_id', database_id: ID(2) },
			last_edited_time: 't'
		};
		expect(rules.sourceOf(dataSource, md)).toEqual({ id: ID(1), type: 'data_source', title: 'Aufgaben', url: `https://www.notion.so/${ID(2).replace(/-/g, '')}`, edited: 't' });
		const page = { object: 'page', id: ID(3), parent: { type: 'page_id', page_id: ID(4) }, url: 'https://www.notion.so/Plan-x', properties: { title: { type: 'title', title: [rt(' Plan \n A ')] } } };
		expect(rules.sourceOf(page, md)).toMatchObject({ id: ID(3), type: 'page', title: 'Plan A', url: 'https://www.notion.so/Plan-x' });
		expect(rules.sourceOf({ ...page, url: 'javascript:alert(1)' }, md).url).toBe(`https://www.notion.so/${ID(3).replace(/-/g, '')}`);
		expect(rules.sourceOf({ ...page, properties: {} }, md).title).toBe('Ohne Titel');
		expect(rules.sourceOf({ ...page, parent: { type: 'data_source_id', data_source_id: ID(1) } }, md)).toBeNull();
		expect(rules.sourceOf({ ...page, parent: { type: 'database_id', database_id: ID(2) } }, md)).toBeNull();
		expect(rules.sourceOf({ ...page, in_trash: true }, md)).toBeNull();
		expect(rules.sourceOf({ ...dataSource, archived: true }, md)).toBeNull();
		expect(rules.sourceOf({ ...page, id: 'kaputt' }, md)).toBeNull();
		expect(rules.sourceOf({ object: 'user', id: ID(5) }, md)).toBeNull();
	});
});

describe('dates', () => {
	it('reads a date without time as all-day from Berlin midnight', () => {
		expect(rules.dateOf({ start: '2026-07-01' }, berlin)).toEqual({ sourceDate: '2026-06-30 22:00:00.000Z', allDay: true, text: '01.07.2026' });
		expect(rules.dateOf({ start: '2026-01-15' }, berlin)).toEqual({ sourceDate: '2026-01-14 23:00:00.000Z', allDay: true, text: '15.01.2026' });
	});

	it('reads a date-time with offset as its instant and shows it in Berlin time', () => {
		expect(rules.dateOf({ start: '2026-10-31T14:30:00.000+01:00' }, berlin)).toEqual({ sourceDate: '2026-10-31 13:30:00.000Z', allDay: false, text: '31.10.2026, 14:30' });
		expect(rules.dateOf({ start: '2026-07-01T10:00:00Z' }, berlin)).toMatchObject({ sourceDate: '2026-07-01 10:00:00.000Z', text: '01.07.2026, 12:00' });
		expect(rules.dateOf({ start: '2026-07-01T10:00:00.123456-0430' }, berlin).sourceDate).toBe('2026-07-01 14:30:00.000Z');
	});

	it('reads a date-time without offset as Berlin time, or as its day in another zone', () => {
		expect(rules.dateOf({ start: '2026-07-01T09:15', time_zone: 'Europe/Berlin' }, berlin)).toMatchObject({ sourceDate: '2026-07-01 07:15:00.000Z', allDay: false });
		expect(rules.dateOf({ start: '2026-07-01T09:15:00' }, berlin)).toMatchObject({ sourceDate: '2026-07-01 07:15:00.000Z' });
		expect(rules.dateOf({ start: '2026-07-01T09:15:00', time_zone: 'America/New_York' }, berlin)).toEqual({ sourceDate: '2026-06-30 22:00:00.000Z', allDay: true, text: '01.07.2026' });
	});

	it('names a range and refuses what is no date', () => {
		expect(rules.dateOf({ start: '2026-12-20', end: '2026-12-24' }, berlin).text).toBe('20.12.2026 – 24.12.2026');
		for (const value of [null, {}, { start: '' }, { start: '2026-02-30' }, { start: 'morgen' }, { start: '2026-07-01T25:00:00Z' }]) {
			expect(rules.dateOf(value, berlin)).toBeNull();
		}
	});
});

describe('property values', () => {
	const value = (property) => rules.propertyValue(property, berlin, md);

	it('writes every kind a copy needs', () => {
		expect(value({ type: 'rich_text', rich_text: [rt('mit '), rt('Fett', { bold: true })] })).toEqual({ plain: 'mit Fett', markdown: 'mit **Fett**' });
		expect(value({ type: 'number', number: 1.5 })).toEqual({ plain: '1,5', markdown: '1,5' });
		expect(value({ type: 'select', select: { name: 'Hoch' } }).plain).toBe('Hoch');
		expect(value({ type: 'status', status: { name: 'In Arbeit' } }).plain).toBe('In Arbeit');
		expect(value({ type: 'multi_select', multi_select: [{ name: 'a' }, { name: 'b_c' }] })).toEqual({ plain: 'a, b_c', markdown: 'a, b\\_c' });
		expect(value({ type: 'date', date: { start: '2026-10-05' } }).plain).toBe('05.10.2026');
		expect(value({ type: 'people', people: [{ object: 'user', id: ID(1), name: 'Anna Beispiel' }] }).plain).toBe('Anna Beispiel');
		expect(value({ type: 'people', people: [{ object: 'user', id: ID(1) }, { object: 'user', id: ID(2) }] }).plain).toBe('2 Personen');
		expect(value({ type: 'checkbox', checkbox: true }).plain).toBe('ja');
		expect(value({ type: 'checkbox', checkbox: false }).plain).toBe('nein');
		expect(value({ type: 'url', url: 'https://example.com/a' }).markdown).toBe('[https://example.com/a](https://example.com/a)');
		expect(value({ type: 'url', url: 'javascript:alert(1)' }).markdown).toBe('javascript:alert(1)');
		expect(value({ type: 'email', email: 'anna@example.com' }).markdown).toBe('[anna@example.com](mailto:anna@example.com)');
		expect(value({ type: 'phone_number', phone_number: '+49 30 1234' }).plain).toBe('+49 30 1234');
		expect(value({ type: 'formula', formula: { type: 'boolean', boolean: false } }).plain).toBe('nein');
		expect(value({ type: 'formula', formula: { type: 'date', date: { start: '2026-01-02' } } }).plain).toBe('02.01.2026');
		expect(value({ type: 'relation', relation: [{ id: ID(1) }] }).plain).toBe('1 verknüpfte Seite');
		expect(value({ type: 'rollup', rollup: { type: 'number', number: 3 } }).plain).toBe('3');
		expect(value({ type: 'files', files: [{ name: 'plan.pdf' }] }).plain).toBe('plan.pdf');
		expect(value({ type: 'unique_id', unique_id: { prefix: 'HAUS', number: 7 } }).plain).toBe('HAUS-7');
	});

	it('leaves out empty values and kinds without meaning for a copy', () => {
		for (const property of [
			{ type: 'rich_text', rich_text: [] },
			{ type: 'number', number: null },
			{ type: 'select', select: null },
			{ type: 'multi_select', multi_select: [] },
			{ type: 'date', date: null },
			{ type: 'people', people: [] },
			{ type: 'url', url: null },
			{ type: 'relation', relation: [] },
			{ type: 'rollup', rollup: { type: 'array', array: [] } },
			{ type: 'created_time', created_time: 't' },
			{ type: 'last_edited_by', last_edited_by: {} },
			{ type: 'button', button: {} },
			null
		]) {
			expect(value(property)).toBeNull();
		}
	});
});

describe('done and dates of a schema', () => {
	const status = {
		type: 'status',
		status: {
			options: [{ id: 'a', name: 'Offen' }, { id: 'b', name: 'Fertig gestellt' }],
			groups: [
				{ name: 'To-do', option_ids: ['a'] },
				{ name: 'In progress', option_ids: [] },
				{ name: 'Complete', option_ids: ['b'] }
			]
		}
	};

	it('prefers a status by the group "Complete"', () => {
		const rule = rules.doneRuleOf({ Name: { type: 'title' }, Erledigt: { type: 'checkbox' }, Zustand: status });
		expect(rule).toEqual({ type: 'status', name: 'Zustand', ids: ['b'] });
		expect(rules.isRowDone({ properties: { Zustand: { status: { id: 'b', name: 'Fertig gestellt' } } } }, rule)).toBe(true);
		expect(rules.isRowDone({ properties: { Zustand: { status: { id: 'a', name: 'Offen' } } } }, rule)).toBe(false);
		expect(rules.isRowDone({ properties: { Zustand: { status: null } } }, rule)).toBe(false);
	});

	it('uses the last group or the names when the groups are unknown', () => {
		const renamed = { type: 'status', status: { groups: [{ name: 'A', option_ids: ['x'] }, { name: 'Z', option_ids: ['z'] }] } };
		expect(rules.doneRuleOf({ S: renamed })).toEqual({ type: 'status', name: 'S', ids: ['z'] });
		const bare = rules.doneRuleOf({ S: { type: 'status', status: {} } });
		expect(rules.isRowDone({ properties: { S: { status: { id: 'q', name: 'Done' } } } }, bare)).toBe(true);
		expect(rules.isRowDone({ properties: { S: { status: { id: 'q', name: 'Offen' } } } }, bare)).toBe(false);
	});

	it('takes a checkbox named like done, else the only checkbox, else a select named like a status', () => {
		expect(rules.doneRuleOf({ Wichtig: { type: 'checkbox' }, 'Done?': { type: 'checkbox' } })).toEqual({ type: 'checkbox', name: 'Done?' });
		expect(rules.doneRuleOf({ Haken: { type: 'checkbox' } })).toEqual({ type: 'checkbox', name: 'Haken' });
		expect(rules.doneRuleOf({ A: { type: 'checkbox' }, B: { type: 'checkbox' } })).toBeNull();
		const select = rules.doneRuleOf({ Status: { type: 'select' } });
		expect(select).toEqual({ type: 'select', name: 'Status' });
		expect(rules.isRowDone({ properties: { Status: { select: { name: ' Erledigt ' } } } }, select)).toBe(true);
		expect(rules.isRowDone({ properties: { Haken: { checkbox: true } } }, { type: 'checkbox', name: 'Haken' })).toBe(true);
		expect(rules.isRowDone({ properties: {} }, null)).toBe(false);
	});

	it('chooses the first date property, another one or none', () => {
		const schema = { Name: { type: 'title' }, Start: { type: 'date' }, Ende: { type: 'date' }, Zahl: { type: 'number' } };
		expect(rules.dateProperties(schema)).toEqual(['Start', 'Ende']);
		expect(rules.chooseDateProperty(schema, null)).toEqual({ name: 'Start' });
		expect(rules.chooseDateProperty(schema, 'Ende')).toEqual({ name: 'Ende' });
		expect(rules.chooseDateProperty(schema, '')).toEqual({ name: '' });
		expect(rules.chooseDateProperty(schema, 'Zahl')).toEqual({ invalid: true });
		expect(rules.chooseDateProperty({}, null)).toEqual({ name: '' });
	});
});

describe('rows and points as entries', () => {
	const schema = { Name: { type: 'title' }, Status: { type: 'select' }, 'Fällig': { type: 'date' }, Notiz: { type: 'rich_text' } };

	it('makes a row a task with its properties as Markdown list', () => {
		const page = {
			object: 'page',
			id: ID(10),
			url: 'https://www.notion.so/Zeile-1',
			properties: {
				Notiz: { type: 'rich_text', rich_text: [rt('*wichtig*')] },
				Name: { type: 'title', title: [rt('Rasen mähen')] },
				Status: { type: 'select', select: { name: 'Erledigt' } },
				'Fällig': { type: 'date', date: { start: '2026-05-04' } },
				Extra: { type: 'number', number: 2 }
			}
		};
		const entry = rules.rowEntry(page, { schema, dateProperty: 'Fällig', doneRule: rules.doneRuleOf(schema) }, berlin, md);
		expect(entry).toMatchObject({
			ref: ID(10),
			kind: 'task',
			title: 'Rasen mähen',
			url: 'https://www.notion.so/Zeile-1',
			date: { sourceDate: '2026-05-03 22:00:00.000Z', allDay: true },
			done: true,
			excerpt: 'Status: Erledigt · Fällig: 04.05.2026 · Notiz: *wichtig* · Extra: 2',
			summary: ['- **Status:** Erledigt', '- **Fällig:** 04.05.2026', '- **Notiz:** \\*wichtig\\*', '- **Extra:** 2']
		});
		const untitled = rules.rowEntry({ ...page, properties: {} }, { schema, dateProperty: '', doneRule: null }, berlin, md);
		expect(untitled).toMatchObject({ title: 'Ohne Titel', date: null, done: false, excerpt: '', summary: [] });
		const long = rules.rowEntry(
			{ ...page, properties: { Notiz: { type: 'rich_text', rich_text: [rt('x'.repeat(300))] } } },
			{ schema, dateProperty: '', doneRule: null },
			berlin,
			md
		);
		expect(long.excerpt).toHaveLength(160);
		expect(long.excerpt.endsWith('…')).toBe(true);
	});

	it('makes the points of lists entries with sections, nested content and dates', () => {
		const date = { type: 'mention', mention: { type: 'date', date: { start: '2026-03-02' } }, annotations: PLAIN, plain_text: '2026-03-02', href: null };
		const blocks = [
			block('heading_1', { rich_text: [rt('Haus')] }),
			block('to_do', { rich_text: [rt('Dach')], checked: true }, [block('bulleted_list_item', { rich_text: [rt('Ziegel')] }, [block('numbered_list_item', { rich_text: [rt('rot')] })])]),
			block('bulleted_list_item', { rich_text: [rt('Termin '), date] }),
			block('callout', { rich_text: [rt('Kasten')] }, [block('numbered_list_item', { rich_text: [rt('im Kasten')] })]),
			block('toggle', { rich_text: [rt('Garten')] }, [block('to_do', { rich_text: [rt('Hecke')], checked: false })]),
			block('heading_2', { rich_text: [rt('Einklappbar')], is_toggleable: true }, [block('to_do', { rich_text: [rt('darin')] })]),
			block('child_page', { title: 'Unterseite' }, [block('to_do', { rich_text: [rt('nie')] })]),
			block('to_do', { rich_text: [rt('  ')] }),
			block('to_do', { rich_text: [rt('Mit '), rt('Link', {}, 'https://example.com/')] }),
			block('to_do', { rich_text: [rt('Zeile 1\nZeile 2')] }),
			block('to_do', { rich_text: [rt('y'.repeat(250))] })
		];
		const result = rules.pointEntries(blocks, { url: 'https://www.notion.so/Seite-1' }, berlin, md);
		expect(result.empty).toBe(1);
		expect(result.entries.map((entry) => [entry.title.slice(0, 20), entry.section, entry.done, entry.blockType])).toEqual([
			['Dach', 'Haus', true, 'to_do'],
			['Termin 02.03.2026', 'Haus', false, 'bulleted_list_item'],
			['im Kasten', 'Haus', false, 'numbered_list_item'],
			['Hecke', 'Garten', false, 'to_do'],
			['darin', 'Einklappbar', false, 'to_do'],
			['Mit Link', 'Einklappbar', false, 'to_do'],
			['Zeile 1 Zeile 2', 'Einklappbar', false, 'to_do'],
			['yyyyyyyyyyyyyyyyyyyy', 'Einklappbar', false, 'to_do']
		]);
		const [roof, term, , , , link, lines, long] = result.entries;
		expect(roof).toMatchObject({ kind: 'todo', body: '- Ziegel\n  1. rot', excerpt: 'Ziegel rot', truncated: false });
		expect(roof.url).toBe(`https://www.notion.so/Seite-1#${roof.ref.replace(/-/g, '')}`);
		expect(term.date).toEqual({ sourceDate: '2026-03-01 23:00:00.000Z', allDay: true, text: '02.03.2026' });
		expect(link.body).toBe('Mit [Link](https://example.com/)');
		expect(lines.body).toBe('Zeile 1\nZeile 2');
		expect(long.body).toBe('y'.repeat(250));
		expect(rules.pointEntries(null, { url: '' }, berlin, md)).toEqual({ entries: [], empty: 0 });
	});

	it('reads below a point everything, outside only what may hold lists', () => {
		expect(rules.descendForPoints({ type: 'to_do' }, false)).toBe(true);
		expect(rules.descendForPoints({ type: 'toggle' }, false)).toBe(true);
		expect(rules.descendForPoints({ type: 'table' }, false)).toBe(false);
		expect(rules.descendForPoints({ type: 'table' }, true)).toBe(true);
		expect(rules.descendForPoints({ type: 'child_page' }, true)).toBe(false);
		expect(rules.descendForContent({ type: 'child_database' })).toBe(false);
		expect(rules.descendForContent({ type: 'column_list' })).toBe(true);
		expect(rules.isPoint({ type: 'numbered_list_item' })).toBe(true);
		expect(rules.isPoint({ type: 'toggle' })).toBe(false);
	});
});

describe('text, copy state and source_meta of an entry', () => {
	const source = { id: ID(1), type: 'data_source', title: 'Aufgaben', url: 'https://www.notion.so/db' };
	const row = { kind: 'task', summary: ['- **A:** 1'], date: { allDay: true }, blockType: '', section: '' };
	const point = { kind: 'todo', body: '- innen', date: null, blockType: 'to_do', section: 'Einkauf', truncated: false };

	it('puts the page content of a row after a rule, with a note when it was cut', () => {
		expect(rules.bodyOf(row, null)).toBe('- **A:** 1');
		expect(rules.bodyOf(row, { markdown: 'Inhalt', truncated: false })).toBe('- **A:** 1\n\n---\n\nInhalt');
		expect(rules.bodyOf(row, { markdown: '', truncated: false })).toBe('- **A:** 1\n\n---\n\n_Die Seite hat keinen Inhalt._');
		expect(rules.bodyOf({ ...row, summary: [] }, { markdown: 'X', truncated: true })).toBe(`X\n\n${rules.TRUNCATED_NOTE}`);
		expect(rules.TRUNCATED_NOTE).toBe('_Seiteninhalt gekürzt: höchstens 500 Blöcke und 50.000 Zeichen je Seite. Vollständig in Notion._');
		expect(rules.bodyOf(point, null)).toBe('- innen');
	});

	it('says what the copy holds', () => {
		expect(rules.contentState(row, null)).toBe('properties');
		expect(rules.contentState(row, { truncated: false })).toBe('complete');
		expect(rules.contentState(row, { truncated: true })).toBe('truncated');
		expect(rules.contentState(point, null)).toBe('complete');
		expect(rules.contentState({ ...point, truncated: true }, null)).toBe('truncated');
	});

	it('keeps the source, the options and all_day in source_meta', () => {
		expect(rules.metaOf(row, source, { copyContent: true, dateProperty: 'Fällig' }, { truncated: false })).toEqual({
			notion: {
				source_id: ID(1),
				source_type: 'data_source',
				source_title: 'Aufgaben',
				source_url: 'https://www.notion.so/db',
				object: 'page',
				copy: true,
				content: 'complete',
				date_property: 'Fällig'
			},
			all_day: true
		});
		expect(rules.metaOf(point, { ...source, type: 'page' }, { copyContent: false, dateProperty: '' }, null)).toEqual({
			notion: {
				source_id: ID(1),
				source_type: 'page',
				source_title: 'Aufgaben',
				source_url: 'https://www.notion.so/db',
				object: 'block',
				copy: false,
				content: 'complete',
				block_type: 'to_do',
				section: 'Einkauf'
			}
		});
	});

	it('counts bytes like UTF-8', () => {
		for (const value of ['', 'abc', 'Äpfel', '€ und 💡', 'x'.repeat(1000)]) {
			expect(rules.utf8Length(value), value).toBe(Buffer.byteLength(value, 'utf8'));
		}
	});
});

describe('request bodies of the routes', () => {
	it('checks source, date property, options and refs', () => {
		expect(rules.parseRequest({ source: { type: 'page', id: ID(1).replace(/-/g, '') } }, false)).toEqual({
			ok: true,
			value: { source: { type: 'page', id: ID(1) }, dateProperty: null, skipDone: true, copyContent: false, refs: [] }
		});
		const full = rules.parseRequest(
			{ source: { type: 'data_source', id: ID(1) }, date_property: '', skip_done: false, copy_content: true, refs: [ID(2), ID(2), ID(3)] },
			true
		);
		expect(full.value).toMatchObject({ dateProperty: '', skipDone: false, copyContent: true, refs: [ID(2), ID(3)] });
		expect(rules.parseRequest({ source: { type: 'page', id: ID(1) }, copy_content: true }, false).value.copyContent).toBe(false);
		for (const body of [null, {}, { source: { type: 'database', id: ID(1) } }, { source: { type: 'page', id: 'x' } }, { source: { type: 'page', id: ID(1) }, date_property: 5 }]) {
			expect(rules.parseRequest(body, false).ok, JSON.stringify(body)).toBe(false);
		}
		const source = { type: 'page', id: ID(1) };
		expect(rules.parseRequest({ source }, true).ok).toBe(false);
		expect(rules.parseRequest({ source, refs: ['kaputt'] }, true).ok).toBe(false);
		expect(rules.parseRequest({ source, refs: Array.from({ length: 101 }, (_, index) => ID(index + 1)) }, true)).toEqual({
			ok: false,
			message: 'Bitte 1 bis 100 Einträge je Anfrage wählen.'
		});
	});
});
