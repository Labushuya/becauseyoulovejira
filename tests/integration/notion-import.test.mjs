// Import of existing Notion lists (ADR-0041, plan notion-import NI-1) against a fake of the Notion
// API on 127.0.0.1 (tests/support/fake-notion.mjs, invented workspace in
// tests/fixtures/notion/workspace.mjs). The disposable instance runs in the test mode of the
// harness, so the client talks to the fake instead of api.notion.com. Checked: "Verbindung
// prüfen", the list of shared sources, previews of a database and of a page with lists (with
// "Unterseiten einbeziehen" also of its sub-pages), the import with "Erledigte überspringen" and
// "Seiteninhalt als Kopie mitnehmen", duplicates and tombstones, the summary for "Erneut abrufen",
// errors (token, not shared, 429) and that the app only reads and never shows the token.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeNotion, FAKE_NOTION_VERSION } from '../support/fake-notion.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { DATA_SOURCE_ID, DATABASE_ID, HIDDEN_PAGE_ID, PAGE_ID, TOKEN, id, workspace } from '../fixtures/notion/workspace.mjs';

const WRONG_TOKEN = 'ntn_' + 'Falschertoken0Beispiel0Nurfuertests012345';
const ROW = (number) => id(4, number);
const BLOCK = (number) => id(3, number);
// Reading requests of the app; everything else would be a write.
const READS = [
	/^GET \/v1\/users\/me$/,
	/^POST \/v1\/search$/,
	/^GET \/v1\/data_sources\/[0-9a-f-]{36}$/,
	/^POST \/v1\/data_sources\/[0-9a-f-]{36}\/query$/,
	/^GET \/v1\/pages\/[0-9a-f-]{36}$/,
	/^GET \/v1\/blocks\/[0-9a-f-]{36}\/children$/
];

let fake;
let shared;
let instance;
let superuser;
let owner;
let other;
let responses = '';

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

async function user() {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	return { id: record.id, pb };
}

/** A Notion connection of `who`; created by the superuser until the SPA offers the kind (NI-2). */
function connection(who, variable = 'BYL_NOTION_TOKEN', data = {}) {
	return superuser.collection('connections').create({
		owner: who.id,
		type: 'notion',
		label: 'Notion',
		enabled: true,
		secret_env: variable,
		settings: {},
		...data
	});
}

async function call(who, method, path, body) {
	const response = await fetch(`${instance.url}/api/byl/connections/${path}`, {
		method,
		headers: { Authorization: who.pb.authStore.token, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const text = await response.text();
	responses += text;
	return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

const check = (who, conn) => call(who, 'POST', `${conn.id}/notion/check`);
const sources = (who, conn, query = '') => call(who, 'GET', `${conn.id}/notion/sources${query === '' ? '' : `?q=${encodeURIComponent(query)}`}`);
const imports = (who, conn) => call(who, 'GET', `${conn.id}/notion/imports`);
const preview = (who, conn, body) => call(who, 'POST', `${conn.id}/notion/preview`, body);
const importItems = (who, conn, body) => call(who, 'POST', `${conn.id}/notion/import`, body);

const dataSource = { type: 'data_source', id: DATA_SOURCE_ID };
const page = { type: 'page', id: PAGE_ID };

function itemsOf(who) {
	return who.pb.collection('inbox_items').getFullList({ sort: 'created,id', filter: who.pb.filter('channel = {:channel}', { channel: 'notion' }) });
}

beforeAll(async () => {
	const invented = workspace();
	shared = invented.shared;
	fake = await startFakeNotion(invented);
	instance = await startPocketBase({
		env: {
			BYL_TEST_NOTION_PORT: String(fake.port),
			BYL_NOTION_TOKEN: TOKEN,
			BYL_NOTION_WRONG: WRONG_TOKEN
		}
	});
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	owner = await user();
	other = await user();
}, 60_000);

afterAll(async () => {
	await fake?.close();
	await instance?.stop();
});

beforeEach(() => fake.clear());

describe('Notion: Verbindung prüfen and sources', () => {
	it('checks the token, names the workspace and notes the success at the connection', async () => {
		const conn = await connection(owner);
		const result = await check(owner, conn);
		expect(result).toEqual({
			status: 200,
			body: { status: 'ok', workspace: 'Beispiel-Arbeitsbereich', bot: 'becauseyoulovejira', shared: true }
		});
		const record = await owner.pb.collection('connections').getOne(conn.id);
		expect(record).toMatchObject({ last_error: '', last_hint: '' });
		expect(record.last_ok_at).not.toBe('');
		expect(fake.requests.every((request) => request.version === FAKE_NOTION_VERSION)).toBe(true);
	});

	it('reports a refused token with the name of its variable and stores it as the error', async () => {
		const conn = await connection(owner, 'BYL_NOTION_WRONG');
		const result = await check(owner, conn);
		expect(result.status).toBe(200);
		expect(result.body).toMatchObject({ status: 'error', reason: 'connection' });
		expect(result.body.message).toContain('(401)');
		expect(result.body.message).toContain('BYL_NOTION_WRONG');
		const record = await owner.pb.collection('connections').getOne(conn.id);
		expect(record.last_error).toBe(result.body.message);
		// A later success clears it.
		await superuser.collection('connections').update(conn.id, { secret_env: 'BYL_NOTION_TOKEN' });
		expect((await check(owner, conn)).body.status).toBe('ok');
		expect((await owner.pb.collection('connections').getOne(conn.id)).last_error).toBe('');
	});

	it('says when the integration sees nothing yet', async () => {
		const conn = await connection(owner);
		const saved = [...shared];
		shared.clear();
		try {
			expect((await check(owner, conn)).body).toMatchObject({ status: 'ok', shared: false });
			expect((await owner.pb.collection('connections').getOne(conn.id)).last_hint).toContain('noch keine Seite');
			expect((await sources(owner, conn)).body.sources).toEqual([]);
		} finally {
			for (const entry of saved) shared.add(entry);
		}
		expect((await check(owner, conn)).body.shared).toBe(true);
		expect((await owner.pb.collection('connections').getOne(conn.id)).last_hint).toBe('');
	}, 30_000);

	it('names a missing variable and asks nothing', async () => {
		const conn = await connection(owner, 'BYL_NOTION_NICHT_GESETZT');
		const result = await check(owner, conn);
		expect(result.body).toMatchObject({ status: 'missing', missing: ['BYL_NOTION_NICHT_GESETZT'] });
		expect(fake.requests).toHaveLength(0);
	});

	it('lists shared data sources and pages, without rows and without what is not shared', async () => {
		const conn = await connection(owner);
		const result = await sources(owner, conn);
		expect(result.body.status).toBe('ok');
		expect(result.body.sources).toEqual([
			{
				id: DATA_SOURCE_ID,
				type: 'data_source',
				title: 'Aufgaben Haushalt',
				url: `https://www.notion.so/${DATABASE_ID.replace(/-/g, '')}`,
				edited: '2026-09-03T06:00:00.000Z'
			},
			{
				id: PAGE_ID,
				type: 'page',
				title: 'Wochenplan',
				url: `https://www.notion.so/Wochenplan-${PAGE_ID.replace(/-/g, '')}`,
				edited: '2026-09-02T07:00:00.000Z'
			}
		]);
		expect(result.body).toMatchObject({ truncated: false, counts: { data_sources: 1, pages: 1 } });
		const narrowed = await sources(owner, conn, 'woche');
		expect(narrowed.body.sources.map((source) => source.title)).toEqual(['Wochenplan']);
		expect(fake.requests.filter((request) => request.path === '/v1/search').at(-1).body.query).toBe('woche');
	}, 30_000);

	it('keeps the connection of another user and other kinds to themselves', async () => {
		const conn = await connection(owner);
		expect((await check(other, conn)).status).toBe(404);
		expect((await preview(other, conn, { source: page })).status).toBe(404);
		const calendar = await other.pb.collection('connections').create({
			owner: other.id,
			type: 'calendar',
			label: 'Kalender',
			enabled: true,
			secret_env: 'BYL_NOTION_TOKEN',
			settings: {}
		});
		expect((await sources(other, calendar)).status).toBe(404);
		expect(fake.requests).toHaveLength(0);
	});
});

describe('Notion: preview', () => {
	it('shows the rows of a database with title, date, excerpt, done and their state', async () => {
		const conn = await connection(owner);
		const result = await preview(owner, conn, { source: dataSource });
		expect(result.status).toBe(200);
		const body = result.body;
		expect(body).toMatchObject({
			status: 'ok',
			source: { id: DATA_SOURCE_ID, type: 'data_source', title: 'Aufgaben Haushalt' },
			date_properties: ['Fällig', 'Erinnerung'],
			date_property: 'Fällig',
			truncated: false,
			limits: { max_rows: 1000, import_batch: 100, content_blocks: 500, content_chars: 50000 }
		});
		expect(body.items.map((item) => [item.title, item.source_date, item.all_day, item.done])).toEqual([
			['Fenster putzen', '2026-10-04 22:00:00.000Z', true, false],
			['Steuererklärung abgeben', '2026-10-31 13:30:00.000Z', false, false],
			['Keller aufräumen', '', false, true],
			['Ohne Datum', '', false, false],
			['Geschenk für Sam', '2026-12-19 23:00:00.000Z', true, false]
		]);
		expect(body.items[0]).toMatchObject({
			ref: ROW(1),
			kind: 'task',
			state: '',
			message: '',
			excerpt: 'Status: Nicht begonnen · Fällig: 05.10.2026 · Tags: Haus · Zuständig: Anna Beispiel · Notiz: Auch innen · Link: https://example.com/fenster · Wichtig: ja'
		});
		// Five rows with a page size of three: the query was paginated.
		expect(fake.requests.filter((request) => request.path.endsWith('/query'))).toHaveLength(2);
	}, 30_000);

	it('takes another date property or none on request and refuses an unknown one', async () => {
		const conn = await connection(owner);
		const other = await preview(owner, conn, { source: dataSource, date_property: 'Erinnerung' });
		expect(other.body.date_property).toBe('Erinnerung');
		expect(other.body.items[1].source_date).toBe('2026-10-19 22:00:00.000Z');
		const none = await preview(owner, conn, { source: dataSource, date_property: '' });
		expect(none.body.items.every((item) => item.source_date === '')).toBe(true);
		const unknown = await preview(owner, conn, { source: dataSource, date_property: 'Gibt es nicht' });
		expect(unknown.status).toBe(400);
	}, 30_000);

	it('shows the points of the lists of a page with their sections, nested points as text', async () => {
		const conn = await connection(owner);
		const result = await preview(owner, conn, { source: page });
		expect(result.body).toMatchObject({ status: 'ok', source: { id: PAGE_ID, type: 'page', title: 'Wochenplan' }, empty: 1 });
		expect(result.body.items.map((item) => [item.title, item.section, item.done, item.source_date])).toEqual([
			['Milch', 'Einkauf', false, ''],
			['Brot', 'Einkauf', true, ''],
			['Äpfel', 'Einkauf', false, ''],
			['Zahnarzt anrufen 02.10.2026', 'Termine', false, '2026-10-01 22:00:00.000Z'],
			['Erstens', 'Termine', false, ''],
			['Formular hier ausfüllen', 'Termine', false, ''],
			['Garage streichen', 'Später', false, '']
		]);
		expect(result.body.items[2]).toMatchObject({ ref: BLOCK(4), kind: 'todo', excerpt: 'Boskop Elstar' });
		expect(result.body.items[0].url).toBe(`https://www.notion.so/Wochenplan-${PAGE_ID.replace(/-/g, '')}#${BLOCK(2).replace(/-/g, '')}`);
		// Without "Unterseiten einbeziehen" the sub-page is a source of its own and not read.
		expect(fake.requests.some((request) => request.path.includes(BLOCK(11)))).toBe(false);
		expect(result.body).toMatchObject({ subpages: 0, subpages_hidden: 0 });
	}, 30_000);

	it('reads the sub-pages of a page on request, down the levels, and counts those it does not see', async () => {
		const conn = await connection(owner);
		const result = await preview(owner, conn, { source: page, subpages: true });
		expect(result.body).toMatchObject({ status: 'ok', truncated: false, subpages: 2, subpages_hidden: 1 });
		expect(result.body.limits).toMatchObject({ subpages: 50, subpage_depth: 3 });
		// The points of the page first, then those of its sub-pages under their path.
		expect(result.body.items.map((item) => [item.title, item.section])).toEqual([
			['Milch', 'Einkauf'],
			['Brot', 'Einkauf'],
			['Äpfel', 'Einkauf'],
			['Zahnarzt anrufen 02.10.2026', 'Termine'],
			['Erstens', 'Termine'],
			['Formular hier ausfüllen', 'Termine'],
			['Garage streichen', 'Später'],
			['Fliesen aussuchen', 'Unterseite'],
			['Silikon erneuern', 'Unterseite › Tiefer › Bad']
		]);
		const tiles = result.body.items[7];
		expect(tiles).toMatchObject({ ref: BLOCK(40), kind: 'todo' });
		expect(tiles.url).toBe(`https://www.notion.so/${BLOCK(11).replace(/-/g, '')}#${BLOCK(40).replace(/-/g, '')}`);
		// Each sub-page once, the hidden one asked once and left out.
		const asked = fake.requests.filter((request) => request.path.startsWith('/v1/blocks/')).map((request) => request.path);
		expect(asked.filter((path) => path.includes(BLOCK(11)))).toHaveLength(1);
		expect(asked.filter((path) => path.includes(BLOCK(41)))).toHaveLength(1);
		expect(asked.filter((path) => path.includes(BLOCK(42)))).toHaveLength(1);
		// The option counts for pages only.
		const rows = await preview(owner, conn, { source: dataSource, subpages: true });
		expect(rows.body).toMatchObject({ status: 'ok', subpages: 0, subpages_hidden: 0 });
		expect((await owner.pb.collection('connections').getOne(conn.id)).last_error).toBe('');
	}, 30_000);

	it('reports a page that is not shared as a problem of the source, not of the connection', async () => {
		const conn = await connection(owner);
		const result = await preview(owner, conn, { source: { type: 'page', id: HIDDEN_PAGE_ID } });
		expect(result.body).toMatchObject({ status: 'error', reason: 'source' });
		expect(result.body.message).toContain('(404)');
		expect((await owner.pb.collection('connections').getOne(conn.id)).last_error).toBe('');
	});

	it('refuses a request without a valid source', async () => {
		const conn = await connection(owner);
		expect((await preview(owner, conn, { source: { type: 'page', id: '../users/me' } })).status).toBe(400);
		expect((await preview(owner, conn, { source: { type: 'database', id: PAGE_ID } })).status).toBe(400);
		expect((await preview(owner, conn, {})).status).toBe(400);
		expect(fake.requests).toHaveLength(0);
	});

	it('waits after 429 as long as Retry-After says and then goes on', async () => {
		const conn = await connection(owner);
		fake.inject({ method: 'POST', path: /\/query$/, status: 429, code: 'rate_limited', headers: { 'Retry-After': '1' } });
		const started = Date.now();
		const result = await preview(owner, conn, { source: dataSource });
		expect(result.body.status).toBe('ok');
		expect(result.body.items).toHaveLength(5);
		expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
		expect(fake.requests.filter((request) => request.path.endsWith('/query'))).toHaveLength(3);
	}, 30_000);

	it('gives up after repeated 429 with a German message and keeps the connection state', async () => {
		const conn = await connection(owner);
		fake.inject({ method: 'GET', path: /^\/v1\/pages\//, status: 429, code: 'rate_limited', headers: { 'Retry-After': '120' } });
		const result = await preview(owner, conn, { source: page });
		expect(result.body).toMatchObject({ status: 'error', reason: 'source' });
		expect(result.body.message).toContain('(429)');
		expect((await owner.pb.collection('connections').getOne(conn.id)).last_error).toBe('');
	});
});

describe('Notion: import into the inbox', () => {
	let who;
	let conn;

	beforeAll(async () => {
		who = await user();
		conn = await connection(who);
	});

	it('takes chosen rows as tasks with properties, date and link, and skips done ones', async () => {
		const result = await importItems(who, conn, { source: dataSource, refs: [ROW(1), ROW(2), ROW(3), ROW(4)], skip_done: true });
		expect(result.body).toMatchObject({ status: 'ok', counts: { created: 3, duplicates: 0, skipped: 1, failed: 0 } });
		expect(result.body.items.find((item) => item.ref === ROW(3))).toMatchObject({ status: 'skipped', message: 'Erledigt, übersprungen.' });
		const items = await itemsOf(who);
		expect(items.map((item) => item.title)).toEqual(['Fenster putzen', 'Steuererklärung abgeben', 'Ohne Datum']);
		const [first] = items;
		expect(first).toMatchObject({
			channel: 'notion',
			kind: 'task',
			state: 'new',
			connection: conn.id,
			source_ref: ROW(1),
			source_date: '2026-10-04 22:00:00.000Z',
			source_url: expect.stringMatching(/^https:\/\/www\.notion\.so\/Fenster-putzen-/),
			source_meta: {
				all_day: true,
				notion: {
					source_id: DATA_SOURCE_ID,
					source_type: 'data_source',
					source_title: 'Aufgaben Haushalt',
					object: 'page',
					date_property: 'Fällig',
					copy: false,
					content: 'properties'
				}
			}
		});
		expect(first.original).toMatch(/^notion_\w+\.json$/);
		const full = await who.pb.collection('inbox_items').getOne(first.id);
		expect(full.body).toBe(
			[
				'- **Status:** Nicht begonnen',
				'- **Fällig:** 05.10.2026',
				'- **Tags:** Haus',
				'- **Zuständig:** Anna Beispiel',
				'- **Notiz:** Auch **innen**',
				'- **Link:** [https://example.com/fenster](https://example.com/fenster)',
				'- **Wichtig:** ja'
			].join('\n')
		);
	}, 30_000);

	it('takes only new entries again ("Erneut abrufen") and a done one when asked', async () => {
		const again = await importItems(who, conn, { source: dataSource, refs: [ROW(1), ROW(2), ROW(3), ROW(4), ROW(5)], skip_done: false });
		expect(again.body.counts).toEqual({ created: 2, duplicates: 3, skipped: 0, failed: 0 });
		expect(again.body.items.find((item) => item.ref === ROW(1))).toMatchObject({ status: 'duplicate', message: 'Schon im Eingang.', state: 'new' });
		const shown = await preview(who, conn, { source: dataSource });
		expect(shown.body.items.every((item) => item.state === 'new')).toBe(true);
	}, 30_000);

	it('copies the page content of a row as Markdown after the properties', async () => {
		const copier = await user();
		const own = await connection(copier);
		const result = await importItems(copier, own, { source: dataSource, refs: [ROW(5)], copy_content: true });
		expect(result.body.counts.created).toBe(1);
		const [item] = await itemsOf(copier);
		const full = await copier.pb.collection('inbox_items').getOne(item.id);
		expect(full.body).toBe(
			[
				'- **Status:** Nicht begonnen\n- **Fällig:** 20.12.2026 – 24.12.2026\n- **Wichtig:** nein',
				'---',
				'### Ideen',
				'- [ ] Buch\n- [x] Kino',
				'Budget **30 €**'
			].join('\n\n')
		);
		expect(full.source_meta.notion).toMatchObject({ copy: true, content: 'complete' });
		const original = await fetch(copier.pb.files.getURL(full, full.original, { token: await copier.pb.files.getToken() }));
		const json = await original.json();
		expect(json).toMatchObject({ notion_version: '2026-03-11', source: { id: DATA_SOURCE_ID }, page: { id: ROW(5) } });
		expect(json.content.map((block) => block.type)).toEqual(['heading_3', 'to_do', 'to_do', 'paragraph']);
	}, 30_000);

	it('takes points of a page as to-dos with their nested points and keeps discarded ones away', async () => {
		const result = await importItems(who, conn, { source: page, refs: [BLOCK(2), BLOCK(3), BLOCK(4), BLOCK(8)], skip_done: true });
		expect(result.body.counts).toEqual({ created: 3, duplicates: 0, skipped: 1, failed: 0 });
		const items = (await itemsOf(who)).filter((item) => item.source_meta.notion.source_type === 'page');
		const apples = items.find((item) => item.source_ref === BLOCK(4));
		expect(apples).toMatchObject({ kind: 'todo', title: 'Äpfel', source_meta: { notion: { object: 'block', block_type: 'to_do', section: 'Einkauf', content: 'complete' } } });
		expect((await who.pb.collection('inbox_items').getOne(apples.id)).body).toBe('- Boskop\n- Elstar');
		const form = items.find((item) => item.source_ref === BLOCK(8));
		expect((await who.pb.collection('inbox_items').getOne(form.id)).body).toBe('Formular [hier](https://example.com/formular) ausfüllen');

		const milk = items.find((item) => item.source_ref === BLOCK(2));
		await who.pb.collection('inbox_items').update(milk.id, { state: 'discarded' });
		const shown = await preview(who, conn, { source: page });
		expect(shown.body.items.find((item) => item.ref === BLOCK(2))).toMatchObject({ state: 'discarded', message: 'Schon verworfen.' });
		const again = await importItems(who, conn, { source: page, refs: [BLOCK(2)] });
		expect(again.body.items[0]).toMatchObject({ status: 'duplicate', message: 'Schon verworfen.', state: 'discarded' });
	}, 30_000);

	it('takes points of sub-pages into the source of the page only on request and remembers that', async () => {
		const reader = await user();
		const own = await connection(reader);
		const without = await importItems(reader, own, { source: page, refs: [BLOCK(40)] });
		expect(without.body.items[0]).toMatchObject({ status: 'failed', message: 'Nicht mehr in der Quelle (in Notion gelöscht oder verschoben).' });
		const result = await importItems(reader, own, { source: page, refs: [BLOCK(40), BLOCK(44)], subpages: true });
		expect(result.body.counts).toEqual({ created: 2, duplicates: 0, skipped: 0, failed: 0 });
		const items = await itemsOf(reader);
		expect(items.map((item) => [item.title, item.kind, item.source_meta.notion.section])).toEqual([
			['Fliesen aussuchen', 'todo', 'Unterseite'],
			['Silikon erneuern', 'todo', 'Unterseite › Tiefer › Bad']
		]);
		expect(items[1]).toMatchObject({
			source_url: `https://www.notion.so/${BLOCK(41).replace(/-/g, '')}#${BLOCK(44).replace(/-/g, '')}`,
			source_meta: { notion: { source_id: PAGE_ID, source_type: 'page', subpages: true } }
		});
		// "Erneut abrufen" takes the option of the last import.
		const listed = await imports(reader, own);
		expect(listed.body.imports.map((entry) => [entry.id, entry.type, entry.count, entry.subpages])).toEqual([[PAGE_ID, 'page', 2, true]]);
	}, 30_000);

	it('names entries that are gone from the source and refuses too many or no refs', async () => {
		const gone = await importItems(who, conn, { source: page, refs: [id(3, 999)] });
		expect(gone.body.items[0]).toMatchObject({ status: 'failed', message: 'Nicht mehr in der Quelle (in Notion gelöscht oder verschoben).' });
		expect((await importItems(who, conn, { source: page, refs: [] })).status).toBe(400);
		const many = Array.from({ length: 101 }, (_, index) => id(3, 1000 + index));
		expect((await importItems(who, conn, { source: page, refs: many })).status).toBe(400);
	}, 30_000);

	it('sums up the imported sources for "Erneut abrufen" without asking Notion', async () => {
		fake.clear();
		const result = await imports(who, conn);
		expect(result.body.status).toBe('ok');
		expect(result.body.imports.map((entry) => [entry.type, entry.title, entry.count, entry.date_property, entry.copy_content, entry.subpages])).toEqual([
			['page', 'Wochenplan', 3, '', false, false],
			['data_source', 'Aufgaben Haushalt', 5, 'Fällig', false, false]
		]);
		expect(result.body.imports[1]).toMatchObject({ id: DATA_SOURCE_ID, url: `https://www.notion.so/${DATABASE_ID.replace(/-/g, '')}` });
		expect(fake.requests).toHaveLength(0);
		expect((await imports(other, conn)).status).toBe(404);
	});
});

describe('Notion: only reading, never the token', () => {
	it('sent only reading requests to Notion', async () => {
		const conn = await connection(owner);
		await check(owner, conn);
		await sources(owner, conn);
		await preview(owner, conn, { source: page });
		await importItems(owner, conn, { source: dataSource, refs: [ROW(5)], copy_content: true });
		expect(fake.requests.length).toBeGreaterThan(5);
		for (const request of fake.requests) {
			expect(READS.some((pattern) => pattern.test(`${request.method} ${request.path}`)), `${request.method} ${request.path}`).toBe(true);
		}
	}, 60_000);

	it('shows the token in no answer, stored error or log', async () => {
		const logs = JSON.stringify(await superuser.send('/api/logs', { query: { perPage: 500 } }));
		const records = JSON.stringify(await superuser.collection('connections').getFullList());
		for (const text of [responses, logs, records, instance.output()]) {
			expect(text).not.toContain(TOKEN);
			expect(text).not.toContain(WRONG_TOKEN);
		}
	});
});
