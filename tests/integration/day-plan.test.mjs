// The day plan (TP-1, ADR-0065) against an own disposable PocketBase: A and B share a household (A
// founds it, B joins), C is alone. The plan of an area and day comes into being lazily and only once,
// also when several requests arrive at the same time; every source of suggestions in every mode with
// its reason; "Übrig von gestern"; the check mark of a task (the ticket is completed through its own
// hooks: history, series, sub-tasks) and of an ongoing project (only the entry of the day), "Nur für
// heute abhaken", "Vorhaben abschließen" and the way back; "Auf morgen schieben", "Entfernen", the
// order; the shared plan of the household live for A and B and closed to C; no ticket across the
// border of an area; moving a ticket into the other area and the trash take its entries along; the
// settings of the sources, live for the members (PL-1); the kind of a ticket; pins neither a source nor
// a reason to leave a ticket out (PL-1). The day comes from the test clock of
// tests/fixtures/pb_hooks/day-plan-clock.pb.js, so no case depends on the time of the machine.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { scaled } from '../support/timing.mjs';
import {
	addToDayPlan,
	adoptIntoDayPlan,
	checkDayPlanItem,
	fetchDayPlan,
	listDayPlanItems,
	moveDayPlanItem,
	moveDayPlanItemToTomorrow,
	removeDayPlanItem,
	saveDayPlanSettings,
	subscribeDayPlanItems,
	subscribeDayPlanSettings,
	uncheckDayPlanItem
} from '../../web/src/lib/data/day-plan.ts';
import { setClientArea } from '../../web/src/lib/data/area.ts';
import { getTicket, updateTicket } from '../../web/src/lib/data/tickets.ts';

const PLAN = '/api/byl/dayplan';
const HOUSEHOLD = '/api/byl/household';
const EVENT_TIMEOUT_MS = scaled(5_000);

let instance;
let superuser;
let a;
let b;
let c;
let householdId;
const stops = [];

function createClient() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

/** A new app account with random credentials (in memory only), signed in. */
async function createAccount(name = '') {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password, name })).id;
	const client = createClient();
	await client.collection('users').authWithPassword(email, password);
	const send = (path, body, method = 'POST') => client.send(path, { method, body, requestKey: null });
	return {
		id,
		client,
		send,
		scope: `u:${id}`,
		fetch: (query = {}) => client.send(PLAN, { method: 'GET', query, requestKey: null }),
		ticket: (data = {}) => client.collection('tickets').create({ owner: id, title: `Ticket ${uniqueSuffix()}`, ...data }),
		add: (body) => send(`${PLAN}/items`, body),
		check: (itemId, body = {}) => send(`${PLAN}/items/${itemId}/check`, { mode: 'check', ...body }),
		uncheck: (itemId, body = {}) => send(`${PLAN}/items/${itemId}/uncheck`, body)
	};
}

const householdScope = () => `h:${householdId}`;

/** Status, codes per field and the message of a refused call. */
async function refusal(promise) {
	try {
		await promise;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		const data = error.response?.data ?? {};
		return {
			status: error.status,
			codes: Object.fromEntries(Object.entries(data).map(([field, value]) => [field, value.code])),
			message: error.response?.message
		};
	}
	throw new Error('Expected the request to be refused, but it succeeded.');
}

/** The test clock of the routes: 11:00 or 12:00 in Berlin on `date`. */
async function useDay(date) {
	const response = await fetch(`${instance.url}/api/byl-test/dayplan/clock`, {
		method: 'POST',
		headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ now: Date.parse(`${date}T10:00:00.000Z`) })
	});
	expect(response.status).toBe(200);
}

/** Makes a ticket an instance of a rule, as the generation of a series does (test route). */
async function linkToRule(ticketId, ruleId) {
	const response = await fetch(`${instance.url}/api/byl-test/tickets/${ticketId}/link`, {
		method: 'POST',
		headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ rule: ruleId })
	});
	expect(response.status).toBe(200);
}

/** `date` plus `days` calendar days. */
function shift(date, days) {
	const value = new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000);
	return value.toISOString().slice(0, 10);
}

/** A calendar date as PocketBase stores a due date. */
const due = (date) => `${date} 00:00:00.000Z`;

/** Every entry of a plan in its order, read by the superuser. */
async function entriesOf(planId) {
	return superuser
		.collection('day_plan_items')
		.getFullList({ filter: superuser.filter('plan = {:plan}', { plan: planId }), sort: 'position,created,id' });
}

const ticketsOf = (entries) => entries.map((entry) => entry.ticket);
const ticketOf = (id) => superuser.collection('tickets').getOne(id);
const historyOf = (id) =>
	superuser.collection('ticket_history').getFullList({ filter: superuser.filter('ticket = {:id}', { id }), sort: 'created,id' });

/** Realtime events of the entries of one plan, as the app subscribes. */
async function watchPlan(person, planId) {
	const events = [];
	stops.push(
		await person.client.collection('day_plan_items').subscribe(
			'*',
			(event) => events.push({ action: event.action, id: event.record.id, record: event.record }),
			{ filter: person.client.filter('plan = {:plan}', { plan: planId }) }
		)
	);
	return events;
}

async function waitFor(list, test, label) {
	const deadline = Date.now() + EVENT_TIMEOUT_MS;
	for (;;) {
		const found = list.find(test);
		if (found) return found;
		if (Date.now() > deadline) throw new Error(`No realtime event ${label} within ${EVENT_TIMEOUT_MS} ms`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = createClient();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	a = await createAccount('Anna Beispiel');
	b = await createAccount('Bert Beispiel');
	c = await createAccount('Clara Beispiel');
	householdId = (await a.send(HOUSEHOLD, { name: `Haus ${uniqueSuffix()}` })).household.id;
	const { code } = await a.send(`${HOUSEHOLD}/invites`, {});
	await b.send(`${HOUSEHOLD}/join`, { code });
});

afterAll(async () => {
	for (const stop of stops) await stop().catch(() => undefined);
	await instance?.stop();
});

describe('the kind of a ticket', () => {
	it('is a task by default and an ongoing project only when set; the history records a change', async () => {
		const person = await createAccount();
		const task = await person.ticket();
		expect(task.kind).toBe('task');
		const ongoing = await person.ticket({ kind: 'ongoing' });
		expect(ongoing.kind).toBe('ongoing');
		const changed = await person.client.collection('tickets').update(task.id, { kind: 'ongoing' });
		expect(changed.kind).toBe('ongoing');
		const entries = (await historyOf(task.id)).filter((entry) => entry.field === 'kind');
		expect(entries).toMatchObject([{ old_value: 'task', new_value: 'ongoing', user: person.id }]);
		expect((await refusal(person.client.collection('tickets').update(task.id, { kind: 'projekt' }))).codes.kind).toBe(
			'validation_invalid_value'
		);
	});
});

describe('the plan of a day comes into being lazily and once', () => {
	it('creates the plan of today on the first request and answers the same one afterwards', async () => {
		await useDay('2031-01-08');
		const person = await createAccount();
		const first = await person.fetch();
		expect(first).toMatchObject({
			date: '2031-01-08',
			today: '2031-01-08',
			tomorrow: '2031-01-09',
			scope: person.scope,
			editable: true,
			leftover: [],
			other: null,
			adopted: 0
		});
		expect(first.plan).toMatchObject({ date: '2031-01-08', scope: person.scope, dismissed: [] });
		const second = await person.fetch({ date: '2031-01-08', scope: person.scope });
		expect(second.plan.id).toBe(first.plan.id);
		const plans = await superuser
			.collection('day_plans')
			.getFullList({ filter: superuser.filter('scope = {:scope}', { scope: person.scope }) });
		expect(plans).toHaveLength(1);
		expect(plans[0]).toMatchObject({ owner: person.id, household: '', date: '2031-01-08' });
	});

	it('plans tomorrow, reads days before without creating them and refuses later days', async () => {
		await useDay('2031-01-08');
		const person = await createAccount();
		const tomorrow = await person.fetch({ date: '2031-01-09' });
		expect(tomorrow).toMatchObject({ date: '2031-01-09', editable: true, suggestions: [] });
		expect(tomorrow.plan.id).toBeTruthy();
		const before = await person.fetch({ date: '2031-01-07' });
		expect(before).toMatchObject({ date: '2031-01-07', editable: false, plan: null, suggestions: [] });
		const plans = await superuser
			.collection('day_plans')
			.getFullList({ filter: superuser.filter('scope = {:scope}', { scope: person.scope }) });
		expect(plans.map((plan) => plan.date)).toEqual(['2031-01-09']);
		expect((await refusal(person.fetch({ date: '2031-01-10' }))).codes.date).toBe('validation_dayplan_future');
		expect((await refusal(person.fetch({ date: '2031-02-30' }))).codes.date).toBe('validation_dayplan_date');
		expect((await refusal(person.fetch({ date: 'morgen' }))).codes.date).toBe('validation_dayplan_date');
	});

	it('stays one plan with one entry per ticket when A and B open it at the same time', async () => {
		await useDay('2031-01-15');
		const project = await a.ticket({ household: householdId, kind: 'ongoing' });
		const answers = await Promise.all(
			Array.from({ length: 12 }, (_, index) => (index % 2 === 0 ? a : b).fetch({ scope: householdScope() }))
		);
		const ids = new Set(answers.map((answer) => answer.plan.id));
		expect(ids.size).toBe(1);
		expect(answers.reduce((sum, answer) => sum + answer.adopted, 0)).toBe(1);
		const plans = await superuser.collection('day_plans').getFullList({
			filter: superuser.filter('scope = {:scope} && date = {:date}', { scope: householdScope(), date: '2031-01-15' })
		});
		expect(plans).toHaveLength(1);
		expect(plans[0]).toMatchObject({ household: householdId, scope: householdScope() });
		expect(ticketsOf(await entriesOf(plans[0].id))).toEqual([project.id]);
	});

	it('refuses an area that is not the account\'s own', async () => {
		await useDay('2031-01-15');
		expect((await refusal(c.fetch({ scope: householdScope() }))).codes.scope).toBe('validation_dayplan_area');
		expect((await refusal(c.fetch({ scope: a.scope }))).codes.scope).toBe('validation_dayplan_area');
		expect(await refusal(createClient().send(PLAN, { method: 'GET' }))).toMatchObject({ status: 401 });
	});
});

describe('suggestions and their sources', () => {
	const DAY = '2031-02-12';

	/** One ticket per source of a fresh account, as of DAY. */
	async function ticketsOfEverySource() {
		const person = await createAccount();
		await useDay(shift(DAY, -1));
		const leftover = await person.ticket({ title: 'Übrig' });
		const done = await person.ticket({ title: 'Gestern für heute abgehakt', kind: 'ongoing' });
		await person.add({ ticket: leftover.id });
		const checked = (await person.add({ ticket: done.id })).item;
		await person.check(checked.id);
		await useDay(DAY);
		const rule = await person.client.collection('recurrence_rules').create({
			owner: person.id,
			title: `Regel ${uniqueSuffix()}`,
			mode: 'calendar',
			freq: 'daily',
			lead_days: 0,
			initial_status: 'open',
			active: false
		});
		const series = await person.ticket({ title: 'Serie', due: due(DAY) });
		await linkToRule(series.id, rule.id);
		return {
			person,
			tickets: {
				ongoing: await person.ticket({ title: 'Sprachkurs', kind: 'ongoing' }),
				due_today: await person.ticket({ title: 'Heute', due: due(DAY) }),
				overdue: await person.ticket({ title: 'Überfällig', due: due(shift(DAY, -3)) }),
				recurrence: series,
				leftover,
				in_progress: await person.ticket({ title: 'In Arbeit', status: 'in_progress' })
			},
			done,
			later: await person.ticket({ title: 'Später', due: due(shift(DAY, 5)) }),
			finished: await person.ticket({ title: 'Erledigt', status: 'done', due: due(DAY) })
		};
	}

	it('takes the ongoing projects in at once and suggests the rest with a reason, by default', async () => {
		const { person, tickets, done, later, finished } = await ticketsOfEverySource();
		const answer = await person.fetch();
		expect(answer.adopted).toBe(2);
		expect(answer.settings).toEqual({
			ongoing: 'auto',
			due_today: 'suggest',
			overdue: 'suggest',
			recurrence: 'suggest',
			leftover: 'suggest',
			in_progress: 'suggest',
			// "Mir zugewiesen" since E7-5 (ADR-0068 §8); a private ticket has no assignee.
			assigned: 'suggest'
		});
		expect(answer.leftover).toEqual([tickets.leftover.id]);
		const entries = await entriesOf(answer.plan.id);
		expect(entries.map((entry) => [entry.ticket, entry.origin, entry.added_by])).toEqual([
			[done.id, 'ongoing', ''],
			[tickets.ongoing.id, 'ongoing', '']
		]);
		expect(answer.suggestions).toEqual([
			{ id: tickets.recurrence.id, mode: 'suggest', origin: 'recurrence', reasons: ['Wiederholung', 'heute fällig'] },
			{ id: tickets.leftover.id, mode: 'suggest', origin: 'leftover', reasons: ['übrig von gestern'] },
			{ id: tickets.overdue.id, mode: 'suggest', origin: 'overdue', reasons: ['überfällig seit 09.02.'] },
			{ id: tickets.due_today.id, mode: 'suggest', origin: 'due_today', reasons: ['heute fällig'] },
			{ id: tickets.in_progress.id, mode: 'suggest', origin: 'in_progress', reasons: ['in Arbeit'] }
		]);
		const suggested = answer.suggestions.map((suggestion) => suggestion.id);
		expect(suggested).not.toContain(later.id);
		expect(suggested).not.toContain(finished.id);
	});

	// The tickets each source alone matches: the ongoing project checked yesterday is one as well, and the
	// ticket of the series is due today.
	const MATCHES = {
		ongoing: (set) => [set.done, set.tickets.ongoing],
		due_today: (set) => [set.tickets.recurrence, set.tickets.due_today],
		overdue: (set) => [set.tickets.overdue],
		recurrence: (set) => [set.tickets.recurrence],
		leftover: (set) => [set.tickets.leftover],
		in_progress: (set) => [set.tickets.in_progress]
	};

	it.each(Object.keys(MATCHES))('follows the mode of the source %s: off, suggest, auto', async (source) => {
		const set = await ticketsOfEverySource();
		const { person } = set;
		const matching = MATCHES[source](set).map((ticket) => ticket.id);
		const off = Object.fromEntries(Object.keys(MATCHES).map((name) => [name, 'off']));
		await person.send(`${PLAN}/settings`, { sources: off });
		let answer = await person.fetch();
		expect(answer.adopted).toBe(0);
		expect(answer.suggestions).toEqual([]);
		expect(await entriesOf(answer.plan.id)).toEqual([]);

		await person.send(`${PLAN}/settings`, { sources: { [source]: 'suggest' } });
		answer = await person.fetch();
		expect(answer.adopted).toBe(0);
		expect(answer.suggestions.map((suggestion) => [suggestion.id, suggestion.mode, suggestion.origin])).toEqual(
			matching.map((id) => [id, 'suggest', source])
		);
		expect(await entriesOf(answer.plan.id)).toEqual([]);

		await person.send(`${PLAN}/settings`, { sources: { [source]: 'auto' } });
		answer = await person.fetch();
		expect(answer.adopted).toBe(matching.length);
		expect(answer.suggestions).toEqual([]);
		const entries = await entriesOf(answer.plan.id);
		expect(entries.map((entry) => [entry.ticket, entry.origin, entry.added_by, entry.done_today])).toEqual(
			matching.map((id) => [id, source, '', false])
		);
	});

	it('treats a pin as display only: neither a source nor a reason to leave a ticket out (PL-1)', async () => {
		const person = await createAccount();
		await useDay(DAY);
		const pinnedDue = await person.ticket({ title: 'Angeheftet und heute fällig', due: due(DAY) });
		const pinnedOnly = await person.ticket({ title: 'Nur angeheftet' });
		for (const ticket of [pinnedDue, pinnedOnly]) {
			await person.client.collection('ticket_pins').create({ user: person.id, ticket: ticket.id });
		}
		const answer = await person.fetch();
		expect(answer.suggestions).toEqual([
			{ id: pinnedDue.id, mode: 'suggest', origin: 'due_today', reasons: ['heute fällig'] }
		]);
		expect(await entriesOf(answer.plan.id)).toEqual([]);
	});

	it('suggests "Übrig von gestern" only for entries neither checked nor done whose ticket is still open', async () => {
		const person = await createAccount();
		await useDay('2031-02-20');
		const open = await person.ticket({ title: 'Offen geblieben' });
		const checked = await person.ticket({ title: 'Für heute abgehakt' });
		const completed = await person.ticket({ title: 'Erledigt' });
		const reopened = await person.ticket({ title: 'Erledigt und wieder offen' });
		const items = {};
		for (const ticket of [open, checked, completed, reopened]) items[ticket.id] = (await person.add({ ticket: ticket.id })).item;
		await person.check(items[checked.id].id, { mode: 'today' });
		await person.check(items[completed.id].id);
		await person.check(items[reopened.id].id);
		await person.client.collection('tickets').update(reopened.id, { status: 'open' });
		await useDay('2031-02-21');
		const answer = await person.fetch();
		expect(answer.leftover.sort()).toEqual([open.id, reopened.id].sort());
		expect(
			answer.suggestions.filter((suggestion) => suggestion.origin === 'leftover').map((suggestion) => suggestion.id).sort()
		).toEqual([open.id, reopened.id].sort());
		// The day after, the plan of the day before is empty: nothing is left over.
		await useDay('2031-02-23');
		expect((await person.fetch()).leftover).toEqual([]);
	});

	it('adopts chosen suggestions with their source and leaves them out of the suggestions afterwards', async () => {
		const { person, tickets } = await ticketsOfEverySource();
		const plan = (await person.fetch()).plan;
		const adopted = await person.send(`${PLAN}/adopt`, { tickets: [tickets.overdue.id, tickets.in_progress.id] });
		expect(adopted.items.map((item) => [item.ticket, item.origin, item.added_by])).toEqual([
			[tickets.overdue.id, 'overdue', person.id],
			[tickets.in_progress.id, 'in_progress', person.id]
		]);
		const answer = await person.fetch();
		expect(answer.suggestions.map((suggestion) => suggestion.id)).toEqual([
			tickets.recurrence.id,
			tickets.leftover.id,
			tickets.due_today.id
		]);
		// "Alle übernehmen": the rest in one request; a ticket of no source comes in by hand.
		const other = await person.ticket({ title: 'Ohne Quelle' });
		await person.send(`${PLAN}/adopt`, { tickets: [...answer.suggestions.map((suggestion) => suggestion.id), other.id] });
		const entries = await entriesOf(plan.id);
		expect(entries).toHaveLength(8);
		expect(entries.map((entry) => entry.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		expect(entries.at(-1)).toMatchObject({ ticket: other.id, origin: 'manual' });
		expect((await person.fetch()).suggestions).toEqual([]);
		expect((await refusal(person.send(`${PLAN}/adopt`, { tickets: [] }))).codes.tickets).toBe('validation_dayplan_ticket_missing');
	});
});

describe('check marks', () => {
	it('completes a task through its own hooks, and "Rückgängig" opens it again with the status before', async () => {
		await useDay('2031-03-05');
		const person = await createAccount();
		const ticket = await person.ticket({ status: 'in_progress' });
		// A pin of the ticket (ADR-0064) goes with the completion, like in the list.
		await person.client.collection('ticket_pins').create({ user: person.id, ticket: ticket.id });
		const { item } = await person.add({ ticket: ticket.id });
		const checked = await person.check(item.id);
		expect(
			await superuser.collection('ticket_pins').getFullList({ filter: superuser.filter('ticket = {:id}', { id: ticket.id }) })
		).toEqual([]);
		expect(checked).toMatchObject({
			action: 'complete',
			ticket: { id: ticket.id, status: 'done', previous_status: 'in_progress' },
			item: { done_today: false, checked_by: person.id }
		});
		expect(checked.item.done_at).not.toBe('');
		const done = await ticketOf(ticket.id);
		expect(done.status).toBe('done');
		expect(done.completed_at).not.toBe('');
		expect((await historyOf(ticket.id)).filter((entry) => entry.field === 'status')).toMatchObject([
			{ old_value: 'in_progress', new_value: 'done', user: person.id }
		]);

		const undone = await person.uncheck(item.id, { action: 'complete', status: 'in_progress' });
		expect(undone).toMatchObject({ ticket: { status: 'in_progress' }, item: { checked_by: '', done_at: '' } });
		expect((await ticketOf(ticket.id)).completed_at).toBe('');
		expect((await refusal(person.uncheck(item.id, { action: 'complete', status: 'done' }))).codes.status).toBe(
			'validation_dayplan_status'
		);
	});

	it('runs the series: completing an instance makes the next one, taking it back removes it again', async () => {
		await useDay('2031-03-05');
		const person = await createAccount();
		const first = await person.ticket({ title: `Blumen gießen ${uniqueSuffix()}` });
		// "Wiederholen…": the ticket becomes the instance of the new rule.
		const rule = await person.client.collection('recurrence_rules').create({
			owner: person.id,
			title: first.title,
			mode: 'after_completion',
			freq: 'daily',
			interval: 1,
			lead_days: 3,
			initial_status: 'open',
			ticket: first.id
		});
		expect((await ticketOf(first.id)).recurrence).toBe(rule.id);
		const { item } = await person.add({ ticket: first.id });
		await person.check(item.id);
		const openOfRule = () =>
			superuser.collection('tickets').getFullList({
				filter: superuser.filter("recurrence = {:rule} && status != 'done'", { rule: rule.id })
			});
		const deadline = Date.now() + EVENT_TIMEOUT_MS;
		while ((await openOfRule()).length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
		const next = await openOfRule();
		expect(next).toHaveLength(1);
		expect(next[0].id).not.toBe(first.id);
		await person.uncheck(item.id);
		const open = await openOfRule();
		expect(open.map((ticket) => ticket.id)).toEqual([first.id]);
	});

	it('asks like the list before completing a ticket with open blocking sub-tasks', async () => {
		await useDay('2031-03-05');
		const person = await createAccount();
		const parent = await person.ticket({ title: 'Umzug' });
		const child = await person.ticket({ title: 'Kartons', parent: parent.id });
		const { item } = await person.add({ ticket: parent.id });
		const refused = await refusal(person.check(item.id));
		expect(refused.codes.status).toBe('validation_parent_open_children');
		expect((await ticketOf(parent.id)).status).toBe('open');
		expect((await entriesOf(item.plan))[0].checked_by).toBe('');
		await person.check(item.id, { completion: 'complete_children' });
		expect((await ticketOf(parent.id)).status).toBe('done');
		expect((await ticketOf(child.id)).status).toBe('done');
		expect((await refusal(person.check(item.id, { completion: 'alle' }))).codes.completion).toBe('validation_dayplan_mode');
	});

	it('checks an ongoing project for the day only; the ticket stays open and unchanged', async () => {
		await useDay('2031-03-06');
		const person = await createAccount();
		const ticket = await person.ticket({ kind: 'ongoing', title: 'Sprachkurs 200 Stunden' });
		const plan = (await person.fetch()).plan;
		const [item] = await entriesOf(plan.id);
		const checked = await person.check(item.id);
		expect(checked).toMatchObject({ action: 'today', item: { done_today: true, checked_by: person.id } });
		const after = await ticketOf(ticket.id);
		expect(after.status).toBe('open');
		expect(after.updated).toBe(ticket.updated);
		const undone = await person.uncheck(item.id);
		expect(undone.item).toMatchObject({ done_today: false, checked_by: '' });
		expect((await ticketOf(ticket.id)).updated).toBe(ticket.updated);
	});

	it('"Nur für heute abhaken" leaves a task open, "Vorhaben abschließen" completes an ongoing project', async () => {
		await useDay('2031-03-06');
		const person = await createAccount();
		const task = await person.ticket();
		const project = await person.ticket({ kind: 'ongoing' });
		const taskItem = (await person.add({ ticket: task.id })).item;
		const projectItem = (await entriesOf((await person.fetch()).plan.id)).find((item) => item.ticket === project.id);
		expect(await person.check(taskItem.id, { mode: 'today' })).toMatchObject({ action: 'today', item: { done_today: true } });
		expect((await ticketOf(task.id)).status).toBe('open');
		expect(await person.check(projectItem.id, { mode: 'complete' })).toMatchObject({
			action: 'complete',
			ticket: { status: 'done', previous_status: 'open' }
		});
		expect((await ticketOf(project.id)).status).toBe('done');
		expect((await refusal(person.check(taskItem.id, { mode: 'halb' }))).codes.mode).toBe('validation_dayplan_mode');
	});
});

describe('changing the plan', () => {
	it('puts an entry at the end or at a place, keeps one entry per ticket and refuses a done ticket', async () => {
		await useDay('2031-03-10');
		const person = await createAccount();
		const [one, two, three] = [await person.ticket(), await person.ticket(), await person.ticket()];
		const first = await person.add({ ticket: one.id });
		expect(first).toMatchObject({ already: false, item: { origin: 'manual', added_by: person.id, position: 0 } });
		await person.add({ ticket: two.id });
		await person.add({ ticket: three.id, index: 0 });
		expect(ticketsOf(await entriesOf(first.plan.id))).toEqual([three.id, one.id, two.id]);
		expect((await person.add({ ticket: one.id })).already).toBe(true);
		const done = await person.ticket({ status: 'done' });
		expect((await refusal(person.add({ ticket: done.id }))).codes.ticket).toBe('validation_dayplan_ticket_done');
		expect((await refusal(person.add({ ticket: 'abcdefghijklmno' }))).codes.ticket).toBe('validation_dayplan_ticket_missing');
	});

	it('moves an entry up, down and to any place, numbering the plan again', async () => {
		await useDay('2031-03-11');
		const person = await createAccount();
		const tickets = [await person.ticket(), await person.ticket(), await person.ticket()];
		const items = [];
		for (const ticket of tickets) items.push((await person.add({ ticket: ticket.id })).item);
		const answer = await person.send(`${PLAN}/items/${items[2].id}/move`, { index: 0 });
		expect(answer.items.map((item) => [item.id, item.position])).toEqual([
			[items[2].id, 0],
			[items[0].id, 1],
			[items[1].id, 2]
		]);
		await person.send(`${PLAN}/items/${items[2].id}/move`, { index: 99 });
		expect(ticketsOf(await entriesOf(items[0].plan))).toEqual([tickets[0].id, tickets[1].id, tickets[2].id]);
		expect((await refusal(person.send(`${PLAN}/items/${items[0].id}/move`, {}))).codes.index).toBe('validation_dayplan_index');
	});

	it('moves an entry to tomorrow; today the sources leave its ticket out', async () => {
		await useDay('2031-03-12');
		const person = await createAccount();
		const project = await person.ticket({ kind: 'ongoing' });
		const today = await person.fetch();
		const [item] = await entriesOf(today.plan.id);
		const moved = await person.send(`${PLAN}/items/${item.id}/tomorrow`, {});
		expect(moved.plan.date).toBe('2031-03-13');
		expect(moved.item).toMatchObject({ ticket: project.id, origin: 'ongoing', added_by: person.id });
		expect(await entriesOf(today.plan.id)).toEqual([]);
		const again = await person.fetch();
		expect(again.adopted).toBe(0);
		expect(again.plan.dismissed).toEqual([project.id]);
		expect((await refusal(person.send(`${PLAN}/items/${moved.item.id}/tomorrow`, {}))).codes.date).toBe(
			'validation_dayplan_tomorrow'
		);
		// The next day the ticket is in the plan of tomorrow, now today.
		await useDay('2031-03-13');
		const next = await person.fetch();
		expect(ticketsOf(await entriesOf(next.plan.id))).toEqual([project.id]);
		expect(next.adopted).toBe(0);
	});

	it('removes an entry for the day; adding it by hand brings it back', async () => {
		await useDay('2031-03-14');
		const person = await createAccount();
		const project = await person.ticket({ kind: 'ongoing' });
		const plan = (await person.fetch()).plan;
		const [item] = await entriesOf(plan.id);
		const removed = await person.send(`${PLAN}/items/${item.id}/remove`, {});
		expect(removed).toMatchObject({ removed: item.id, plan: { dismissed: [project.id] } });
		expect((await person.fetch()).adopted).toBe(0);
		expect(await entriesOf(plan.id)).toEqual([]);
		const added = await person.add({ ticket: project.id });
		expect(added.plan.dismissed).toEqual([]);
		expect(ticketsOf(await entriesOf(plan.id))).toEqual([project.id]);
	});

	it('keeps days before read-only', async () => {
		await useDay('2031-03-17');
		const person = await createAccount();
		const ticket = await person.ticket();
		const { item } = await person.add({ ticket: ticket.id });
		await useDay('2031-03-18');
		for (const call of [
			() => person.check(item.id),
			() => person.uncheck(item.id),
			() => person.send(`${PLAN}/items/${item.id}/remove`, {}),
			() => person.send(`${PLAN}/items/${item.id}/move`, { index: 0 }),
			() => person.add({ ticket: ticket.id, date: '2031-03-17' })
		]) {
			expect((await refusal(call())).codes.date).toBe('validation_dayplan_readonly');
		}
		const before = await person.fetch({ date: '2031-03-17' });
		expect(before).toMatchObject({ editable: false, plan: { id: item.plan } });
		expect(ticketsOf(await entriesOf(item.plan))).toEqual([ticket.id]);
	});
});

describe('the shared plan of the household', () => {
	it('is one plan for A and B, live for both, with who added and who checked; C has no access', async () => {
		await useDay('2031-04-02');
		const plan = (await a.fetch({ scope: householdScope() })).plan;
		const eventsOfB = await watchPlan(b, plan.id);
		const eventsOfA = await watchPlan(a, plan.id);
		const eventsOfC = [];
		stops.push(
			await c.client.collection('day_plan_items').subscribe('*', (event) => eventsOfC.push(event.action))
		);
		const ticket = await a.ticket({ household: householdId, title: 'Müll rausbringen' });
		const added = await a.add({ ticket: ticket.id, scope: householdScope() });
		const created = await waitFor(eventsOfB, (event) => event.action === 'create' && event.id === added.item.id, 'create for B');
		expect(created.record).toMatchObject({ ticket: ticket.id, added_by: a.id });
		expect((await b.fetch({ scope: householdScope() })).plan.id).toBe(plan.id);

		await b.check(added.item.id);
		const updated = await waitFor(
			eventsOfA,
			(event) => event.action === 'update' && event.id === added.item.id && event.record.checked_by === b.id,
			'update for A'
		);
		expect(updated.record.checked_by).toBe(b.id);
		expect((await ticketOf(ticket.id)).status).toBe('done');

		// C neither reads, nor changes, nor hears it.
		expect(await c.client.collection('day_plans').getFullList()).toEqual([]);
		expect(await c.client.collection('day_plan_items').getFullList()).toEqual([]);
		expect((await refusal(c.check(added.item.id))).status).toBe(404);
		expect((await refusal(c.send(`${PLAN}/items/${added.item.id}/remove`, {}))).status).toBe(404);
		expect((await refusal(c.add({ ticket: ticket.id, scope: householdScope() }))).codes.ticket).toBe(
			'validation_dayplan_ticket_missing'
		);
		await a.uncheck(added.item.id);
		await waitFor(eventsOfB, (event) => event.action === 'update' && event.record.checked_by === '', 'second update for B');
		expect(eventsOfC).toEqual([]);
	});

	it('lets every member change the settings of the household; the private area stays of its account', async () => {
		await b.send(`${PLAN}/settings`, { scope: householdScope(), sources: { in_progress: 'off' } });
		expect((await a.fetch({ scope: householdScope() })).settings.in_progress).toBe('off');
		expect((await a.fetch()).settings.in_progress).toBe('suggest');
		await a.send(`${PLAN}/settings`, { scope: householdScope(), sources: { in_progress: 'suggest' } });
		expect((await b.fetch({ scope: householdScope() })).settings.in_progress).toBe('suggest');
		expect((await refusal(c.send(`${PLAN}/settings`, { scope: householdScope(), sources: { ongoing: 'off' } }))).codes.scope).toBe(
			'validation_dayplan_area'
		);
		expect((await refusal(a.send(`${PLAN}/settings`, { sources: { ongoing: 'immer' } }))).codes.sources).toBe(
			'validation_dayplan_sources'
		);
		expect((await refusal(a.send(`${PLAN}/settings`, { sources: { morgen: 'auto' } }))).codes.sources).toBe(
			'validation_dayplan_sources'
		);
		const stored = await superuser.collection('day_plan_settings').getFullList({
			filter: superuser.filter('scope = {:scope}', { scope: householdScope() })
		});
		expect(stored).toHaveLength(1);
		expect(stored[0].household).toBe(householdId);
	});

	it('brings a change of the settings live to the other members, through the data layer of the SPA (PL-1)', async () => {
		const changesOfB = [];
		const changesOfC = [];
		stops.push(await subscribeDayPlanSettings(b.client, householdScope(), (change) => changesOfB.push(change)));
		stops.push(await subscribeDayPlanSettings(c.client, householdScope(), (change) => changesOfC.push(change)));
		await a.send(`${PLAN}/settings`, { scope: householdScope(), sources: { overdue: 'off' } });
		const change = await waitFor(
			changesOfB,
			(entry) => entry.action === 'update' && entry.record.settings.overdue === 'off',
			'settings for B'
		);
		expect(change.record).toMatchObject({ scope: householdScope(), settings: { overdue: 'off', in_progress: 'suggest' } });
		await a.send(`${PLAN}/settings`, { scope: householdScope(), sources: { overdue: 'suggest' } });
		await waitFor(
			changesOfB,
			(entry) => entry.action === 'update' && entry.record.settings.overdue === 'suggest',
			'second settings for B'
		);
		// C is no member: nothing of the household arrives.
		expect(changesOfC).toEqual([]);
	});

	it('names the plan of today of the other area of the account, never its content', async () => {
		await useDay('2031-04-03');
		const shared = await a.ticket({ household: householdId });
		const sharedDone = await a.ticket({ household: householdId });
		await a.add({ ticket: shared.id });
		const doneItem = (await a.add({ ticket: sharedDone.id })).item;
		await a.check(doneItem.id);
		const own = await a.fetch();
		expect(own.other).toEqual({ scope: householdScope(), count: 2, done: 1 });
		expect((await b.fetch()).other).toEqual({ scope: householdScope(), count: 2, done: 1 });
		expect((await c.fetch()).other).toBeNull();
	});
});

describe('the border of an area', () => {
	it('refuses a ticket of another area in a plan, through the route and for the superuser', async () => {
		await useDay('2031-04-08');
		const own = await a.ticket({ title: 'Privat' });
		expect((await refusal(a.add({ ticket: own.id, scope: householdScope() }))).codes.ticket).toBe('validation_scope_mismatch');
		const shared = await a.ticket({ household: householdId });
		expect((await refusal(a.add({ ticket: shared.id, scope: a.scope }))).codes.ticket).toBe('validation_scope_mismatch');
		const plan = (await a.fetch({ scope: householdScope() })).plan;
		expect(
			(await refusal(superuser.collection('day_plan_items').create({ plan: plan.id, ticket: own.id, origin: 'manual' }))).codes
				.ticket
		).toBe('validation_scope_mismatch');
		expect((await refusal(a.send(`${PLAN}/adopt`, { scope: householdScope(), tickets: [own.id] }))).codes.tickets).toBe(
			'validation_scope_mismatch'
		);
		// Without an area the ticket goes into the plan of its own area ("Zum Tagesplan").
		const added = await a.add({ ticket: shared.id });
		expect(added.plan.scope).toBe(householdScope());
		expect((await a.add({ ticket: own.id })).plan.scope).toBe(a.scope);
	});

	it('takes the entries along when their plan goes, and the plans and settings when their household goes', async () => {
		await useDay('2031-04-08');
		const person = await createAccount();
		const ticket = await person.ticket();
		const { plan } = await person.add({ ticket: ticket.id });
		await superuser.collection('day_plans').delete(plan.id);
		expect(await entriesOf(plan.id)).toEqual([]);
		const fields = Object.fromEntries(
			(await superuser.collections.getFullList())
				.filter((collection) => collection.name.startsWith('day_plan'))
				.flatMap((collection) => collection.fields.map((field) => [`${collection.name}.${field.name}`, field]))
		);
		for (const name of ['day_plans.household', 'day_plan_settings.household', 'day_plan_items.plan', 'day_plan_items.ticket']) {
			expect(fields[name], name).toMatchObject({ type: 'relation', cascadeDelete: true });
		}
		expect(fields['day_plans.owner']).toMatchObject({ type: 'relation', cascadeDelete: false, required: true });
	});

	it('takes the entries of a ticket away when it moves into the other area', async () => {
		await useDay('2031-04-09');
		const ticket = await a.ticket({ title: `Umziehen ${uniqueCode()}` });
		const { item, plan } = await a.add({ ticket: ticket.id });
		const tomorrow = await a.add({ ticket: ticket.id, date: '2031-04-10' });
		const events = await watchPlan(a, plan.id);
		await a.send('/api/byl/area/move', { kind: 'ticket', ids: [ticket.id], to: 'household', project: '' });
		expect((await ticketOf(ticket.id)).scope).toBe(householdScope());
		expect(await entriesOf(plan.id)).toEqual([]);
		expect(await entriesOf(tomorrow.plan.id)).toEqual([]);
		await waitFor(events, (event) => event.action === 'delete' && event.id === item.id, 'delete of the entry');
		// In the household it can be planned again.
		expect((await a.add({ ticket: ticket.id })).plan.scope).toBe(householdScope());
	});

	it('takes the entries of a ticket away when it goes to the trash, and its deletion for good as well', async () => {
		await useDay('2031-04-09');
		const person = await createAccount();
		const parent = await person.ticket({ title: 'Mit Unteraufgabe' });
		const child = await person.ticket({ parent: parent.id });
		const { plan } = await person.add({ ticket: parent.id });
		await person.add({ ticket: child.id });
		await person.send(`/api/byl/tickets/${parent.id}/delete`, { sources: 'inbox' });
		expect(await entriesOf(plan.id)).toEqual([]);
		await person.send(`/api/byl/trash/${parent.id}/restore`, {});
		expect(await entriesOf(plan.id)).toEqual([]);
		// Deleting for good (only a done ticket without bound sources, ADR-0047) takes its entry along.
		const gone = await person.ticket();
		const goneItem = (await person.add({ ticket: gone.id })).item;
		await person.check(goneItem.id);
		await superuser.collection('day_plan_items').getOne(goneItem.id);
		await person.client.collection('tickets').delete(gone.id);
		expect(await entriesOf(plan.id)).toEqual([]);
		await superuser.collection('tickets').delete(gone.id);
		expect(await superuser.collection('tickets').getFullList({ filter: superuser.filter('id = {:id}', { id: gone.id }) })).toEqual(
			[]
		);
	});
});

describe('the data layer of the SPA (web/src/lib/data/day-plan.ts)', () => {
	it('reads the plan of the area of the client with its entries and their tickets, and changes it', async () => {
		await useDay('2031-05-14');
		const person = await createAccount();
		const project = await person.ticket({ title: 'Sprachkurs', kind: 'ongoing' });
		const task = await person.ticket({ title: 'Steuer', due: due('2031-05-14') });
		const other = await person.ticket({ title: 'Fenster' });
		setClientArea(person.client, person.scope);
		const result = await fetchDayPlan(person.client);
		expect(result.kind).toBe('ok');
		const answer = result.value;
		expect(answer).toMatchObject({ date: '2031-05-14', scope: person.scope, editable: true, adopted: 1 });
		expect(answer.suggestions).toEqual([{ id: task.id, mode: 'suggest', origin: 'due_today', reasons: ['heute fällig'] }]);
		const [entry] = await listDayPlanItems(person.client, answer.plan.id);
		expect(entry).toMatchObject({ ticketId: project.id, origin: 'ongoing', addedBy: '', doneToday: false });
		// The ticket comes with the fields of the list, the kind included, and without its description.
		expect(entry.ticket).toMatchObject({ id: project.id, key: project.key, title: 'Sprachkurs', kind: 'ongoing' });
		expect(entry.ticket).not.toHaveProperty('description');

		const events = [];
		const stop = await subscribeDayPlanItems(person.client, answer.plan.id, (change) => events.push(change));
		stops.push(stop);
		const adopted = await adoptIntoDayPlan(person.client, person.scope, [task.id]);
		expect(adopted.items.map((item) => [item.ticketId, item.origin])).toEqual([[task.id, 'due_today']]);
		const added = await addToDayPlan(person.client, { ticket: other.id, index: 0 });
		expect(added).toMatchObject({ already: false, plan: { id: answer.plan.id } });
		await waitFor(events, (change) => change.action === 'create' && change.record.ticketId === other.id, 'create');
		const created = events.find((change) => change.action === 'create' && change.record.ticketId === other.id);
		expect(created.record.ticket).toMatchObject({ id: other.id, title: 'Fenster', kind: 'task' });

		const checked = await checkDayPlanItem(person.client, adopted.items[0].id, 'check');
		expect(checked).toMatchObject({ action: 'complete', ticket: { status: 'done', previousStatus: 'open' } });
		const undone = await uncheckDayPlanItem(person.client, adopted.items[0].id, { action: 'complete', status: 'open' });
		expect(undone.ticket.status).toBe('open');
		const today = await checkDayPlanItem(person.client, entry.id, 'check');
		expect(today).toMatchObject({ action: 'today', item: { doneToday: true } });
		expect(await moveDayPlanItem(person.client, entry.id, 2)).toHaveLength(3);
		const tomorrow = await moveDayPlanItemToTomorrow(person.client, added.item.id);
		expect(tomorrow.plan.date).toBe('2031-05-15');
		const removed = await removeDayPlanItem(person.client, adopted.items[0].id);
		expect(removed.plan.dismissed).toEqual(expect.arrayContaining([other.id, task.id]));
		const settings = await saveDayPlanSettings(person.client, person.scope, { overdue: 'auto' });
		expect(settings.overdue).toBe('auto');

		await updateTicket(person.client, task.id, { kind: 'ongoing' });
		expect((await getTicket(person.client, task.id)).kind).toBe('ongoing');
		await expect(checkDayPlanItem(person.client, entry.id, 'halb')).rejects.toMatchObject({
			kind: 'validation',
			fields: { mode: { code: 'validation_dayplan_mode', message: 'Unbekannte Art des Abhakens.' } }
		});
	});

	it('reads a day before without a plan and refuses a day after tomorrow with the text of the hook', async () => {
		await useDay('2031-05-14');
		const person = await createAccount();
		const before = await fetchDayPlan(person.client, { date: '2031-05-01' });
		expect(before.value).toMatchObject({ editable: false, plan: null, suggestions: [] });
		await expect(fetchDayPlan(person.client, { date: '2031-05-16' })).rejects.toMatchObject({
			fields: { date: { code: 'validation_dayplan_future', message: 'Planen geht für heute und morgen.' } }
		});
	});
});
