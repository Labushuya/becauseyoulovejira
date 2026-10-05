// WH-2 "Wiederholung mit vergangener Fälligkeit: ab heute beginnen" (ADR-0022 addendum 14) against an
// own disposable PocketBase: the way of the user. Entries imported from Notion whose due date lies long
// in the past (fake of the Notion API, tests/support/fake-notion.mjs) are converted into tickets with
// that date as due date ("Als Fälligkeit übernehmen"), and a series is created from each ticket with
// the values of "Wiederholen…" as the SPA sends them: once with "Serie ab heute beginnen" (`start`
// 'today', chosen in advance), once with "Ursprüngliches Datum behalten" ('keep'). Then the ticket is
// done. Expected: the next ticket is never due in the past, and the series has exactly one open
// occurrence.
//
// Dates are relative to the Berlin "today" of the machine; completing runs with the real clock like
// the app, the run that makes the next ticket once its lead time is reached with the clock of the test
// route POST /api/byl-test/recurrence/run (as in recurrence-current.test.mjs).

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startFakeNotion } from '../support/fake-notion.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { DATA_SOURCE_ID, TOKEN, id, workspace } from '../fixtures/notion/workspace.mjs';
import { createRule } from '../../web/src/lib/data/recurrence.ts';
import { createTicket } from '../../web/src/lib/data/tickets.ts';
import { berlinToday } from '../../web/src/lib/domain/berlin-date.ts';
import { berlinDateOf } from '../../web/src/lib/domain/format.ts';
import { after, createOn, onOrAfter } from '../../web/src/lib/domain/recurrence.ts';
import { defaultFormValues, formParams } from '../../web/src/lib/domain/recurrence-rule.ts';
import { ticketTemplate, templateBody } from '../../web/src/lib/domain/series-template.ts';

/** The date of the Notion rows: long in the past, a Tuesday. */
const OLD_DUE = '2024-03-12';
const ROW = (number) => id(4, number);

let fake;
let instance;
let superuser;
let owner;
let items;

const dateOf = (value) => (value ? value.slice(0, 10) : '');
const today = () => berlinToday(Date.now());
/** Noon UTC of a Berlin date: the same calendar day in Berlin in summer and in winter. */
const noon = (date) => `${date}T12:00:00Z`;

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

beforeAll(async () => {
	// Two rows of the invented workspace get the old date; the rest stays as it is.
	const invented = workspace();
	const rows = invented.rows[DATA_SOURCE_ID];
	for (const number of [1, 5]) {
		rows.find((row) => row.id === ROW(number)).properties['Fällig'] = {
			id: 'due',
			type: 'date',
			date: { start: OLD_DUE, end: null, time_zone: null }
		};
	}
	fake = await startFakeNotion(invented);
	instance = await startPocketBase({
		env: { BYL_TEST_NOTION_PORT: String(fake.port), BYL_NOTION_TOKEN: TOKEN }
	});
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);

	// The administrator of the app sets up the Notion channel (ADR-0056 §5).
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser
		.collection('users')
		.create({ email, password, passwordConfirm: password, instance_admin: true });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	owner = { id: record.id, pb };
	const connection = await superuser.collection('connections').create({
		owner: owner.id,
		type: 'notion',
		label: 'Notion',
		enabled: true,
		secret_env: 'BYL_NOTION_TOKEN',
		settings: {}
	});

	// "Übernehmen" in the inbox: both rows as entries with their old date.
	const response = await fetch(`${instance.url}/api/byl/connections/${connection.id}/notion/import`, {
		method: 'POST',
		headers: { Authorization: owner.pb.authStore.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ source: { type: 'data_source', id: DATA_SOURCE_ID }, refs: [ROW(1), ROW(5)], skip_done: true })
	});
	expect(response.status).toBe(200);
	expect((await response.json()).counts).toMatchObject({ created: 2, failed: 0 });
	items = await owner.pb
		.collection('inbox_items')
		.getFullList({ sort: 'created,id', filter: owner.pb.filter('channel = {:channel}', { channel: 'notion' }) });
	expect(items.map((item) => [item.title, berlinDateOf(item.source_date)])).toEqual([
		['Fenster putzen', OLD_DUE],
		['Geschenk für Sam', OLD_DUE]
	]);
});

afterAll(async () => {
	await fake?.close();
	await instance?.stop();
});

// Every test leaves its rules paused, so a later run with another clock does not touch them.
afterEach(async () => {
	const active = await superuser.collection('recurrence_rules').getFullList({ filter: 'active = true' });
	for (const rule of active) await superuser.collection('recurrence_rules').update(rule.id, { active: false });
});

async function run(iso) {
	const response = await fetch(`${instance.url}/api/byl-test/recurrence/run`, {
		method: 'POST',
		headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ now: Date.parse(iso) })
	});
	expect(response.status).toBe(200);
	return response.json();
}

const openOf = (ruleId) =>
	superuser.collection('tickets').getFullList({
		filter: superuser.filter("recurrence = {:rule} && status != 'done'", { rule: ruleId }),
		sort: 'created,id'
	});
const historyOf = (ticketId) =>
	superuser
		.collection('ticket_history')
		.getFullList({ filter: superuser.filter('ticket = {:id}', { id: ticketId }), sort: 'created,id' });

/**
 * Converts the entry into a ticket with its date as due date, the way "Als Fälligkeit übernehmen"
 * and "Anlegen" of "Neues Ticket" do (data layer of the SPA).
 */
async function convert(item) {
	const ticket = await createTicket(
		owner.pb,
		{
			title: item.title,
			description: '',
			status: 'open',
			priority: 'medium',
			due: berlinDateOf(item.source_date),
			project: null,
			tags: []
		},
		{ origin: { sourceItem: item.id } }
	);
	expect(ticket.due).toBe(OLD_DUE);
	const converted = await owner.pb.collection('inbox_items').getOne(item.id);
	expect(converted).toMatchObject({ state: 'converted', ticket: ticket.id });
	return ticket;
}

/** "Wiederholen…" with its defaults (weekly on the weekday of the due date), as the store sends it. */
async function repeat(ticket, start) {
	const values = defaultFormValues(ticket.due, today());
	const draft = { ...templateBody(ticketTemplate(ticket, 'open')), ...formParams(values), start };
	const rule = await createRule(owner.pb, draft, ticket.id);
	return { rule, rhythm: formParams(values) };
}

/**
 * Done today; the next ticket is due on `expected`. It appears at once when its lead time has begun
 * (after the commit of the completion), otherwise with the run on the day it appears. Returns the
 * open occurrences of the series then.
 */
async function completeAndNext(ticket, ruleId, rhythm, expected) {
	await owner.pb.collection('tickets').update(ticket.id, { status: 'done' });
	const appears = createOn(expected, rhythm.lead_days);
	if (appears > today()) {
		expect(await openOf(ruleId)).toEqual([]);
		await run(noon(appears));
	}
	return openOf(ruleId);
}

describe('a ticket from Notion overdue since long ago becomes a series (WH-2)', () => {
	it('"Serie ab heute beginnen": the ticket moves to the first date from today, the next one follows it', async () => {
		const ticket = await convert(items[0]);
		const { rule, rhythm } = await repeat(ticket, 'today');
		const first = onOrAfter(rhythm, today());
		expect(first >= today()).toBe(true);

		// The ticket has the first regular date from today on; the series goes on after it.
		const [current] = await openOf(rule.id);
		expect(current.id).toBe(ticket.id);
		expect(dateOf(current.due)).toBe(first);
		expect(rule.nextDue).toBe(after(rhythm, first));
		// The history says it as a normal change of the due date by the user.
		const changes = (await historyOf(ticket.id)).filter((entry) => entry.field === 'due');
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ user: owner.id });
		expect(dateOf(changes[0].old_value)).toBe(OLD_DUE);
		expect(dateOf(changes[0].new_value)).toBe(first);
		expect(await openOf(rule.id)).toHaveLength(1);

		// Done today, on its date or before it: the next one is the date after the first.
		const expected = after(rhythm, first);
		const open = await completeAndNext(ticket, rule.id, rhythm, expected);
		expect(open).toHaveLength(1);
		expect(dateOf(open[0].due)).toBe(expected);
		expect(dateOf(open[0].due) > today()).toBe(true);
	});

	it('"Ursprüngliches Datum behalten": overdue since its date, done today the next one lies after today', async () => {
		const ticket = await convert(items[1]);
		const { rule, rhythm } = await repeat(ticket, 'keep');

		// The ticket keeps its date: one open occurrence, "überfällig seit 12.03.2024".
		const open = await openOf(rule.id);
		expect(open.map((entry) => [entry.id, dateOf(entry.due)])).toEqual([[ticket.id, OLD_DUE]]);
		expect((await historyOf(ticket.id)).filter((entry) => entry.field === 'due')).toEqual([]);

		// Done today (WH-1): the next one is the first date after today, the dates since 2024 are
		// skipped and noted at the completed ticket.
		const expected = after(rhythm, today());
		const next = await completeAndNext(ticket, rule.id, rhythm, expected);
		expect(next).toHaveLength(1);
		expect(dateOf(next[0].due)).toBe(expected);
		expect(dateOf(next[0].due) > today()).toBe(true);
		const skipped = (await historyOf(ticket.id)).filter((entry) => entry.field === 'recurrence_skipped');
		expect(skipped).toHaveLength(1);
		const note = JSON.parse(skipped[0].new_value);
		expect(note.dates[0]).toBe(after(rhythm, OLD_DUE));
		expect(note.count).toBeGreaterThan(100);
	});

	it('refuses another value for `start` and creates nothing', async () => {
		const ticket = await createTicket(owner.pb, {
			title: `Alt ${randomBytes(4).toString('hex')}`,
			description: '',
			status: 'open',
			priority: 'medium',
			due: OLD_DUE,
			project: null,
			tags: []
		});
		const values = defaultFormValues(ticket.due, today());
		const draft = { ...templateBody(ticketTemplate(ticket, 'open')), ...formParams(values), start: 'gestern' };
		await expect(createRule(owner.pb, draft, ticket.id)).rejects.toMatchObject({
			fields: {
				start: {
					code: 'validation_recurrence_start',
					message: 'Bitte „Serie ab heute beginnen“ oder „Ursprüngliches Datum behalten“ wählen.'
				}
			}
		});
		expect((await owner.pb.collection('tickets').getOne(ticket.id)).recurrence).toBe('');
		expect(await superuser.collection('recurrence_rules').getFullList({ filter: superuser.filter('title = {:title}', { title: ticket.title }) })).toEqual([]);
	});
});
