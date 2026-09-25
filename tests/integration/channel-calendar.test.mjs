// Google Calendar through the secret iCal address (ADR-0016 section 2, ADR-0020; E4 plan packages
// 15 and 20), against a local fake server on 127.0.0.1 instead of Google. The events of the fake
// feed carry "#byl" in their description, the keyword of the connections here, unless a test
// checks the keywords themselves. An own disposable instance gets the
// invented addresses as BYL_* variables. The secret part of the address may appear nowhere:
// not in responses, not in last_error, not in the server log and not in the console output.

import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { getConnection, runConnection } from '../../web/src/lib/data/connections.ts';

const berlin = loadHookLib('berlin-time.js');
const SECRET = `private-${randomBytes(12).toString('hex')}`;
const TODAY = berlin.berlinToday(Date.now());
const day = (offset) => berlin.addDays(TODAY, offset).replace(/-/g, '');

let feed = '';
let requests = 0;
const pending = new Set();
const fake = createServer((request, response) => {
	requests += 1;
	const path = request.url ?? '';
	if (path === `/${SECRET}/basic.ics`) {
		response.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
		response.end(feed);
	} else if (path === `/${SECRET}/slow.ics`) {
		const timer = setTimeout(() => response.end(feed), 40_000);
		pending.add(timer);
	} else if (path === `/${SECRET}/large.ics`) {
		response.writeHead(200, { 'Content-Type': 'text/calendar' });
		const chunk = Buffer.alloc(1024 * 1024, 0x41);
		for (let i = 0; i < 25; i++) response.write(chunk);
		response.end();
	} else if (path === `/${SECRET}/page.ics`) {
		response.writeHead(200, { 'Content-Type': 'text/html' });
		response.end('<html><body>Anmelden</body></html>');
	} else {
		response.writeHead(404);
		response.end('not found');
	}
});

let instance;
let superuser;
let owner;
let other;

function event(uid, summary, start, extra = []) {
	const description = extra.some((line) => line.startsWith('DESCRIPTION')) ? [] : ['DESCRIPTION:Termin #byl'];
	return ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${summary}`, `DTSTART;VALUE=DATE:${start}`, ...description, ...extra, 'END:VEVENT'];
}

function calendarText(events) {
	return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Beispiel//Fake-Server//DE', ...events.flat(), 'END:VCALENDAR', ''].join('\r\n');
}

const BASE_EVENTS = () => [
	event('cal-today', 'Heute', day(0)),
	event('cal-soon', 'Nächste Woche', day(7)),
	event('cal-edge', 'In 30 Tagen', day(30)),
	event('cal-late', 'In 40 Tagen', day(40)),
	event('cal-past', 'Gestern', day(-1)),
	event('cal-series', 'Chorprobe', day(-60), ['RRULE:FREQ=WEEKLY']),
	event('cal-ended', 'Kurs', day(-60), [`RRULE:FREQ=WEEKLY;UNTIL=${day(-7)}`]),
	event('cal-cancelled', 'Abgesagt', day(2), ['STATUS:CANCELLED'])
];
const IN_WINDOW = ['Heute', 'Nächste Woche', 'In 30 Tagen', 'Chorprobe'];

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

function connection(who, variable, data = {}) {
	return who.pb.collection('connections').create({
		owner: who.id,
		type: 'calendar',
		label: 'Google Kalender',
		enabled: true,
		secret_env: variable,
		settings: { keywords: ['#byl'] },
		...data
	});
}

/** "Jetzt abrufen"; a run of the cron job at the same moment is waited for. */
async function runNow(who, id) {
	for (let attempt = 0; attempt < 40; attempt++) {
		const response = await fetch(`${instance.url}/api/byl/connections/${id}/run`, {
			method: 'POST',
			headers: { Authorization: who.pb.authStore.token }
		});
		const text = await response.text();
		expect(text).not.toContain(SECRET);
		if (!response.ok) return { httpStatus: response.status };
		const result = JSON.parse(text);
		if (result.status !== 'running') return result;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error('The connection stayed locked.');
}

function itemsOf(who) {
	return who.pb.collection('inbox_items').getFullList({ sort: 'source_date,title' });
}

async function logText() {
	return JSON.stringify(await superuser.send('/api/logs', { query: { perPage: 500 } }));
}

beforeAll(async () => {
	await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
	const base = `http://127.0.0.1:${fake.address().port}/${SECRET}`;
	instance = await startPocketBase({
		env: {
			BYL_TEST_CAL: `${base}/basic.ics`,
			BYL_TEST_CAL_404: `${base}/gone.ics`,
			BYL_TEST_CAL_SLOW: `${base}/slow.ics`,
			BYL_TEST_CAL_LARGE: `${base}/large.ics`,
			BYL_TEST_CAL_PAGE: `${base}/page.ics`,
			BYL_TEST_CAL_NOT_HTTP: 'webcal-ohne-schema'
		}
	});
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	owner = await user();
	other = await user();
	feed = calendarText(BASE_EVENTS());
}, 60_000);

afterAll(async () => {
	for (const timer of pending) clearTimeout(timer);
	fake.closeAllConnections();
	await new Promise((resolve) => fake.close(resolve));
	await instance?.stop();
});

describe('Google Calendar: fetch into the inbox', () => {
	let cal;

	it('takes the events of today up to 30 days ahead, once', async () => {
		cal = await connection(owner, 'BYL_TEST_CAL');
		const first = await runNow(owner, cal.id);
		expect(first).toMatchObject({ status: 'ok', created: 4, duplicates: 0, updated: 0, skipped: 1, error: '' });
		const items = await itemsOf(owner);
		expect(items.map((item) => item.title).sort()).toEqual([...IN_WINDOW].sort());
		for (const item of items) {
			expect(item).toMatchObject({
				channel: 'calendar',
				kind: 'event',
				connection: cal.id,
				state: 'new',
				source_meta: { keyword: '#byl' }
			});
		}
		const record = await owner.pb.collection('connections').getOne(cal.id);
		expect(record.last_ok_at).not.toBe('');
		expect(record.running_since).toBe('');

		const second = await runNow(owner, cal.id);
		expect(second).toMatchObject({ status: 'ok', created: 0, duplicates: 4, updated: 0 });
		expect(await itemsOf(owner)).toHaveLength(4);
	});

	it('keeps discarded events away and lets new entries follow a changed event', async () => {
		const [today] = await owner.pb.collection('inbox_items').getFullList({
			filter: owner.pb.filter('source_ref = {:ref}', { ref: 'cal-today' })
		});
		await owner.pb.collection('inbox_items').update(today.id, { state: 'discarded' });
		feed = calendarText([
			...BASE_EVENTS().filter((lines) => !lines.includes('UID:cal-soon') && !lines.includes('UID:cal-today')),
			event('cal-today', 'Heute (geändert)', day(0)),
			event('cal-soon', 'Nächste Woche (verschoben)', day(8), ['LOCATION:Saal 2'])
		]);
		const result = await runNow(owner, cal.id);
		expect(result).toMatchObject({ status: 'ok', created: 0, updated: 1, duplicates: 3 });
		const items = await itemsOf(owner);
		const soon = items.find((item) => item.source_ref === 'cal-soon');
		expect(soon).toMatchObject({ title: 'Nächste Woche (verschoben)', state: 'new', source_meta: { location: 'Saal 2', all_day: true } });
		const discarded = items.find((item) => item.source_ref === 'cal-today');
		expect(discarded).toMatchObject({ title: 'Heute', state: 'discarded' });
		feed = calendarText(BASE_EVENTS());
	});

	it('knows an event from an .ics file when it comes from the feed', async () => {
		const shared = event('cal-shared', 'Aus Datei und Feed', day(3));
		const form = new FormData();
		form.append('file', new Blob([calendarText([shared])]), 'termin.ics');
		const upload = await fetch(`${instance.url}/api/byl/inbox/ics`, {
			method: 'POST',
			body: form,
			headers: { Authorization: owner.pb.authStore.token }
		});
		expect((await upload.json()).created).toBe(1);
		feed = calendarText([...BASE_EVENTS(), shared]);
		const result = await runNow(owner, cal.id);
		expect(result.created).toBe(0);
		const matches = (await itemsOf(owner)).filter((item) => item.source_ref === 'cal-shared');
		expect(matches).toHaveLength(1);
		expect(matches[0].channel).toBe('ics');
		feed = calendarText(BASE_EVENTS());
	});

	it('skips a run while another holds the lock, and takes over a stale lock', async () => {
		const locked = await connection(owner, 'BYL_TEST_CAL');
		await superuser.collection('connections').update(locked.id, {
			running_since: new Date().toISOString().replace('T', ' ')
		});
		const response = await fetch(`${instance.url}/api/byl/connections/${locked.id}/run`, {
			method: 'POST',
			headers: { Authorization: owner.pb.authStore.token }
		});
		expect(await response.json()).toMatchObject({ status: 'running', created: 0 });
		await superuser.collection('connections').update(locked.id, {
			running_since: new Date(Date.now() - 11 * 60 * 1000).toISOString().replace('T', ' ')
		});
		expect(await runNow(owner, locked.id)).toMatchObject({ status: 'ok' });
	});

	it('refuses foreign connections and does nothing for a switched-off one', async () => {
		expect(await runNow(other, cal.id)).toEqual({ httpStatus: 404 });
		const off = await connection(owner, 'BYL_TEST_CAL', { enabled: false });
		const before = requests;
		expect(await runNow(owner, off.id)).toMatchObject({ status: 'disabled' });
		expect(requests).toBe(before);
	});
});

describe('Google Calendar: keywords (ADR-0020)', () => {
	it('takes only events whose title or description matches, and saves nothing else', async () => {
		const who = await user();
		const record = await connection(who, 'BYL_TEST_CAL', { settings: { keywords: ['chorprobe', 'HEUTE'] } });
		const result = await runNow(who, record.id);
		expect(result).toMatchObject({ status: 'ok', created: 2, unmatched: 2, duplicates: 0 });
		const items = await itemsOf(who);
		expect(items.map((item) => [item.title, item.source_meta.keyword]).sort()).toEqual([
			['Chorprobe', 'chorprobe'],
			['Heute', 'HEUTE']
		]);
		// Nothing was stored for the others, not even as discarded.
		const all = await who.pb.collection('inbox_items').getFullList({ filter: who.pb.filter('connection = {:id}', { id: record.id }) });
		expect(all).toHaveLength(2);
	});

	it('takes nothing with an empty list and a new keyword applies to the window at the next run', async () => {
		const who = await user();
		const record = await connection(who, 'BYL_TEST_CAL', { settings: {} });
		expect(await runNow(who, record.id)).toMatchObject({ status: 'ok', created: 0, unmatched: 4 });
		expect(await itemsOf(who)).toEqual([]);
		await who.pb.collection('connections').update(record.id, { settings: { keywords: ['Nächste'] } });
		expect(await runNow(who, record.id)).toMatchObject({ created: 1, unmatched: 3 });
		expect((await itemsOf(who)).map((item) => item.title)).toEqual(['Nächste Woche']);
	});

	it('refuses invalid keyword lists', async () => {
		const who = await user();
		await expect(connection(who, 'BYL_TEST_CAL', { settings: { keywords: [''] } })).rejects.toMatchObject({
			status: 400,
			response: { data: { settings: { code: 'validation_keywords' } } }
		});
	});
});

describe('Google Calendar: data layer of the web app', () => {
	it('runs a connection and reads its new state', async () => {
		const who = await user();
		const record = await connection(who, 'BYL_TEST_CAL');
		const result = await runConnection(who.pb, record.id);
		expect(result).toEqual({
			status: 'ok',
			created: 4,
			duplicates: 0,
			updated: 0,
			skipped: 1,
			failed: 0,
			unmatched: 0,
			error: '',
			missing: []
		});
		const after = await getConnection(who.pb, record.id);
		expect(after.lastOkAt).not.toBeNull();
		expect(after.runningSince).toBeNull();
		await expect(runConnection(other.pb, record.id)).rejects.toMatchObject({ kind: 'not_found' });
	});
});

describe('Google Calendar: errors without the secret address', () => {
	async function failing(variable) {
		const who = await user();
		const record = await connection(who, variable);
		const result = await runNow(who, record.id);
		const stored = await who.pb.collection('connections').getOne(record.id);
		expect(stored.last_error).toBe(result.error);
		expect(stored.last_ok_at).toBe('');
		expect(stored.running_since).toBe('');
		expect(JSON.stringify(stored)).not.toContain(SECRET);
		expect(await itemsOf(who)).toEqual([]);
		return result;
	}

	it('stores HTTP errors, pages that are no calendar and answers over 20 MB cleaned', async () => {
		expect(await failing('BYL_TEST_CAL_404')).toMatchObject({
			status: 'error',
			error: 'Der Kalender antwortet mit HTTP 404. Stimmt die geheime Adresse noch?'
		});
		expect((await failing('BYL_TEST_CAL_PAGE')).error).toBe('Die Antwort ist kein Kalender im iCal-Format.');
		expect((await failing('BYL_TEST_CAL_LARGE')).error).toBe(
			'Die Antwort des Kalenders ist größer als 20 MB und wurde verworfen.'
		);
		expect((await failing('BYL_TEST_CAL_NOT_HTTP')).error).toBe(
			'Die Variable enthält keine http- oder https-Adresse.'
		);
	});

	it('gives up after the timeout and names the host only', async () => {
		const result = await failing('BYL_TEST_CAL_SLOW');
		expect(result.status).toBe('error');
		expect(result.error).toMatch(/deadline exceeded|Timeout/i);
		expect(result.error).not.toContain('slow.ics');
	}, 90_000);
});

describe('Google Calendar: cron job', () => {
	it('fetches every switched-on connection and does nothing without the variable', async () => {
		const who = await user();
		await connection(who, 'BYL_TEST_CAL');
		const unset = await connection(who, 'BYL_TEST_UNSET_CALENDAR');
		for (let run = 0; run < 2; run++) {
			const response = await fetch(`${instance.url}/api/crons/byl-calendar`, {
				method: 'POST',
				headers: { Authorization: superuser.authStore.token }
			});
			expect(response.status).toBe(204);
		}
		await expect.poll(async () => (await itemsOf(who)).length, { timeout: 10_000 }).toBe(4);
		const untouched = await who.pb.collection('connections').getOne(unset.id);
		expect(untouched).toMatchObject({ last_run_at: '', last_error: '' });
		expect(await runNow(who, unset.id)).toMatchObject({ status: 'missing', missing: ['BYL_TEST_UNSET_CALENDAR'] });
		await expect
			.poll(async () => (await logText()).split('BYL_TEST_UNSET_CALENDAR fehlt').length - 1, { timeout: 5_000 })
			.toBe(1);
	});

	it('never writes the secret address to the log or the console', async () => {
		const logs = await logText();
		expect(logs).not.toContain(SECRET);
		expect(logs).toContain('byl-calendar');
		expect(instance.output()).not.toContain(SECRET);
	});
});
