// .ics files into the inbox (ADR-0017 section 1, E4 plan package 14): the route
// POST /api/byl/inbox/ics parses the upload in the hook, creates one private item per
// VEVENT/VTODO through inbox-service.js and answers with counts.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { pocketBaseUrl, superuserClient } from '../support/api.mjs';
import { createOwner } from '../support/scenario.mjs';

const ROUTE = '/api/byl/inbox/ics';

let superuser;
let owner;
let other;

const fixture = (name) => readFileSync(new URL(`../fixtures/ics/${name}`, import.meta.url));

/** Uploads `content` as multipart field "file"; returns status and JSON body. */
async function upload(who, content, name = 'kalender.ics') {
	const form = new FormData();
	form.append('file', new Blob([content], { type: 'text/calendar' }), name);
	const headers = who ? { Authorization: who.client.authStore.token } : {};
	const response = await fetch(`${pocketBaseUrl()}${ROUTE}`, { method: 'POST', body: form, headers });
	return { status: response.status, body: await response.json() };
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
			body: { tooLarge: false, created: 5, duplicates: 0, skipped: 1, failed: 0, item: '' }
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
