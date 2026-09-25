// .ics files into the inbox (ADR-0017 section 1, E4 plan packages 14 and 21): the preview
// POST /api/byl/inbox/ics/preview lists the components with keyword and state, the import
// POST /api/byl/inbox/ics creates one private item per chosen VEVENT/VTODO through
// inbox-service.js and answers with counts. POST /api/byl/inbox/lookup tells whether drafts of
// the mail selection are in the inbox already.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { pocketBaseUrl, superuserClient } from '../support/api.mjs';
import { createOwner } from '../support/scenario.mjs';

const ROUTE = '/api/byl/inbox/ics';

let superuser;
let owner;
let other;

const fixture = (name) => readFileSync(new URL(`../fixtures/ics/${name}`, import.meta.url));

/**
 * Uploads `content` as multipart field "file" to `route`, with "select" if given; returns status
 * and JSON body.
 */
async function send(route, who, content, select, name = 'kalender.ics') {
	const form = new FormData();
	form.append('file', new Blob([content], { type: 'text/calendar' }), name);
	if (select !== undefined) form.append('select', JSON.stringify(select));
	const headers = who ? { Authorization: who.client.authStore.token } : {};
	const response = await fetch(`${pocketBaseUrl()}${route}`, { method: 'POST', body: form, headers });
	return { status: response.status, body: await response.json() };
}

const preview = (who, content) => send(`${ROUTE}/preview`, who, content);

/** Imports every component of the file: preview first, then all its indices. */
async function upload(who, content, name) {
	const listed = await preview(who, content);
	if (listed.status !== 200) return listed;
	return send(ROUTE, who, content, listed.body.items.map((item) => item.index), name);
}

function itemsOf(who, ref) {
	return who.client.collection('inbox_items').getFullList({
		filter: who.client.filter('source_ref = {:ref}', { ref }),
		sort: 'source_date'
	});
}

beforeAll(async () => {
	superuser = await superuserClient();
	owner = await createOwner(superuser);
	other = await createOwner(superuser);
});

describe('POST /api/byl/inbox/ics', () => {
	it('creates one item per event and skips the cancelled one', async () => {
		const result = await upload(owner, fixture('google.ics'));
		expect(result).toEqual({
			status: 200,
			body: { created: 5, duplicates: 0, skipped: 1, failed: 0, item: '' }
		});
		const [spring] = await itemsOf(owner, 'fixture-spring@example.com');
		expect(spring).toMatchObject({
			channel: 'ics',
			kind: 'event',
			state: 'new',
			owner: owner.id,
			scope: `u:${owner.id}`,
			title: 'Zahnarzt nach der Umstellung',
			source_date: '2026-03-29 08:00:00.000Z',
			source_meta: { end: '2026-03-29 09:00:00.000Z', location: 'Praxis Dr. Beispiel, Hauptstraße 1' }
		});
		expect(spring.body).toContain('Grüße aus Köln');
		expect(spring.original).toMatch(/\.ics$/);

		const series = await itemsOf(owner, 'fixture-series@example.com');
		expect(series.map((item) => item.source_meta.recurrence_id ?? '')).toEqual(['', '20260921T163000Z']);
		expect(series[0].source_meta.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
		expect(await itemsOf(owner, 'fixture-cancelled@example.com')).toEqual([]);
	});

	it('keeps the component as protected original file', async () => {
		const [utc] = await itemsOf(owner, 'fixture-utc@example.com');
		const url = `${pocketBaseUrl()}/api/files/inbox_items/${utc.id}/${utc.original}`;
		expect((await fetch(url)).status).toBe(404);
		const token = await owner.client.files.getToken();
		const text = await (await fetch(`${url}?token=${token}`)).text();
		expect(text).toContain('UID:fixture-utc@example.com');
		expect(text).not.toContain('fixture-spring');
		expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
	});

	it('counts the same file again as already there, also discarded items', async () => {
		const [autumn] = await itemsOf(owner, 'fixture-autumn@example.com');
		await owner.client.collection('inbox_items').update(autumn.id, { state: 'discarded' });
		const again = await upload(owner, fixture('google.ics'));
		expect(again.body).toMatchObject({ created: 0, duplicates: 5, skipped: 1, failed: 0 });
		const [still] = await itemsOf(owner, 'fixture-autumn@example.com');
		expect(still.state).toBe('discarded');
	});

	it('names the only new item and allows the same events for another user', async () => {
		const result = await upload(other, fixture('apple.ics'));
		expect(result.body).toMatchObject({ created: 2, duplicates: 0 });
		const single = await upload(
			owner,
			'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:single-todo\r\nSUMMARY:Einzeln\r\nEND:VTODO\r\nEND:VCALENDAR\r\n'
		);
		const [todo] = await itemsOf(owner, 'single-todo');
		expect(single.body).toMatchObject({ created: 1, item: todo.id });
		expect(todo.kind).toBe('todo');
		const mine = await upload(owner, fixture('apple.ics'));
		expect(mine.body).toMatchObject({ created: 2, duplicates: 0 });
	});

	it('reads the edge cases: BOM, LF only, no UID, cut-off component', async () => {
		const result = await upload(owner, fixture('edge-cases.ics'));
		expect(result.body).toMatchObject({ created: 5, skipped: 1, failed: 0 });
		const again = await upload(owner, fixture('edge-cases.ics'));
		expect(again.body).toMatchObject({ created: 0, duplicates: 5 });
	});

	it('rejects guests, a missing file and files over 20 MB', async () => {
		expect((await upload(null, fixture('apple.ics'))).status).toBe(401);

		const empty = await fetch(`${pocketBaseUrl()}${ROUTE}`, {
			method: 'POST',
			body: new FormData(),
			headers: { Authorization: owner.client.authStore.token }
		});
		expect(empty.status).toBe(400);

		const large = await upload(owner, new Uint8Array(20 * 1024 * 1024 + 1).fill(0x41));
		expect(large.status).toBe(400);
		expect(large.body.message).toBe('Größer als 20 MB, deshalb nicht übernommen.');
	});
});

describe('selection of an .ics file (E4 plan, package 21)', () => {
	const CALENDAR = [
		'BEGIN:VCALENDAR',
		'BEGIN:VEVENT',
		'UID:sel-todo',
		'SUMMARY:Todo: Steuer',
		'DTSTART;VALUE=DATE:20261001',
		'END:VEVENT',
		'BEGIN:VEVENT',
		'UID:sel-kino',
		'SUMMARY:Kino',
		'DESCRIPTION:Karten #BYL besorgen',
		'LOCATION:Filmpalast',
		'DTSTART:20261002T180000Z',
		'END:VEVENT',
		'BEGIN:VEVENT',
		'UID:sel-plain',
		'SUMMARY:Geburtstag',
		'DTSTART;VALUE=DATE:20261003',
		'RRULE:FREQ=YEARLY',
		'END:VEVENT',
		'END:VCALENDAR',
		''
	].join('\r\n');

	it('lists the components with the keyword of the user and saves nothing', async () => {
		const who = await createOwner(superuser);
		await who.client.collection('users').update(who.id, {
			import_keywords: { ics: { keywords: ['todo', '#byl'] }, eml: { keywords: ['rechnung'] } }
		});
		const listed = await preview(who, CALENDAR);
		expect(listed.status).toBe(200);
		expect(listed.body.skipped).toBe(0);
		const base = { kind: 'event', state: '', message: '' };
		expect(listed.body.items).toEqual([
			{ ...base, index: 0, title: 'Todo: Steuer', source_date: '2026-09-30 22:00:00.000Z', all_day: true, series: false, location: '', keyword: 'todo' },
			{ ...base, index: 1, title: 'Kino', source_date: '2026-10-02 18:00:00.000Z', all_day: false, series: false, location: 'Filmpalast', keyword: '#byl' },
			{ ...base, index: 2, title: 'Geburtstag', source_date: '2026-10-02 22:00:00.000Z', all_day: true, series: true, location: '', keyword: '' }
		]);
		expect(await who.client.collection('inbox_items').getFullList()).toEqual([]);
	});

	it('imports only the chosen components with their keyword and marks them in the next preview', async () => {
		const who = await createOwner(superuser);
		await who.client.collection('users').update(who.id, { import_keywords: { ics: { keywords: ['#byl'] } } });
		const result = await send(ROUTE, who, CALENDAR, [1, 2]);
		expect(result).toEqual({ status: 200, body: { created: 2, duplicates: 0, skipped: 0, failed: 0, item: '' } });
		const items = await who.client.collection('inbox_items').getFullList({ sort: 'source_ref' });
		expect(items.map((item) => [item.source_ref, item.source_meta.keyword ?? null])).toEqual([
			['sel-kino', '#byl'],
			['sel-plain', null]
		]);
		await who.client.collection('inbox_items').update(items[1].id, { state: 'discarded' });
		const listed = await preview(who, CALENDAR);
		expect(listed.body.items.map((item) => [item.state, item.message])).toEqual([
			['', ''],
			['new', 'Schon im Eingang.'],
			['discarded', 'Schon verworfen.']
		]);
	});

	it('refuses keyword lists of another shape on the user (users.pb.js)', async () => {
		const who = await createOwner(superuser);
		for (const value of ['todo', { mail: { keywords: [] } }, { ics: { keywords: [''] } }, { eml: { keywords: [], match_body: 'ja' } }]) {
			await expect(who.client.collection('users').update(who.id, { import_keywords: value })).rejects.toMatchObject({
				status: 400,
				response: { data: { import_keywords: { code: 'validation_keywords' } } }
			});
		}
		const saved = await who.client.collection('users').update(who.id, { import_keywords: { eml: { keywords: ['a'], match_body: true } } });
		expect(saved.import_keywords).toEqual({ eml: { keywords: ['a'], match_body: true } });
	});

	it('refuses a missing, empty or invalid selection', async () => {
		const who = await createOwner(superuser);
		for (const select of [undefined, [], [3], [0, 0], [-1], ['x'], [1.5]]) {
			const result = await send(ROUTE, who, CALENDAR, select);
			expect(result.status, JSON.stringify(select)).toBe(400);
			expect(result.body.message).toMatch(/Keine gültige Auswahl/);
		}
		expect(await who.client.collection('inbox_items').getFullList()).toEqual([]);
		expect((await preview(null, CALENDAR)).status).toBe(401);
	});
});

describe('POST /api/byl/inbox/lookup (E4 plan, package 21)', () => {
	async function lookup(who, items) {
		const headers = { 'Content-Type': 'application/json' };
		if (who) headers.Authorization = who.client.authStore.token;
		const response = await fetch(`${pocketBaseUrl()}/api/byl/inbox/lookup`, {
			method: 'POST',
			body: JSON.stringify({ items }),
			headers
		});
		return { status: response.status, body: await response.json() };
	}

	const mail = (ref) => ({ channel: 'eml', kind: 'mail', title: 'x', source_ref: ref, source_meta: {} });

	it('tells whether mails are in the own inbox already, without saving', async () => {
		const who = await createOwner(superuser);
		await who.client.collection('inbox_items').create({
			owner: who.id,
			channel: 'eml',
			kind: 'mail',
			title: 'Rechnung',
			source_ref: '<Lookup-1@Example.com>'
		});
		const result = await lookup(who, [mail('lookup-1@example.com'), mail('<lookup-2@example.com>')]);
		expect(result).toEqual({
			status: 200,
			body: { items: [{ state: 'new', message: 'Schon im Eingang.' }, { state: '', message: '' }] }
		});
		const stranger = await createOwner(superuser);
		expect((await lookup(stranger, [mail('lookup-1@example.com')])).body.items).toEqual([{ state: '', message: '' }]);
		expect(await who.client.collection('inbox_items').getFullList()).toHaveLength(1);
	});

	it('refuses guests and more than 200 drafts', async () => {
		const who = await createOwner(superuser);
		expect((await lookup(null, [])).status).toBe(401);
		expect((await lookup(who, Array.from({ length: 201 }, () => ({})))).status).toBe(400);
		expect((await lookup(who, 'x')).status).toBe(400);
	});
});
