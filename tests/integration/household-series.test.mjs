// "Ganze Serie verschieben" (MV-2, ADR-0061 addendum MV-2) against an own disposable PocketBase: A and B
// share a household (A founds it, so A is its owner), C is alone. A rule with its template, its open
// occurrence (with the sub-task of the template) and its done occurrences moves as a whole into the
// household and back, with and without the done ones; the preview counts series, open and done
// occurrences apart; the series stays intact (the open occurrence keeps its rule, completing it in the
// target makes the next one there and never in the past); the bulk action takes mixed tickets with their
// series; the conflicts of E7-4 hold for every record that comes along (project, @CODE, dependencies,
// source tickets); the rights hold for every record of the series; one failing write changes nothing;
// the entries of the day plan of the old area go.
//
// Dates are relative to the Berlin "today" of the machine: completing runs with the real clock like
// the app, the runs of the generation with the clock of the test route POST /api/byl-test/recurrence/run.
// Rules start paused; the superuser sets next_due (a write of the server, nothing is made at once), and
// every test leaves its rules paused again.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { FAIL_AREA_MOVE, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { scaled } from '../support/timing.mjs';
import { addDays, berlinToday } from '../../web/src/lib/domain/berlin-date.ts';

const ROUTE = '/api/byl/household';
const MOVE = '/api/byl/area/move';
const EVENT_TIMEOUT_MS = scaled(5_000);

let instance;
let superuser;
let a;
let b;
let c;
let householdId;

const today = () => berlinToday(Date.now());
const stored = (date) => `${date} 00:00:00.000Z`;
const dateOf = (value) => (value ? value.slice(0, 10) : '');
/** Noon UTC of a Berlin date: the same calendar day in Berlin in summer and in winter. */
const noon = (date) => `${date}T12:00:00Z`;

function createClient() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

/** A new app account with random credentials (in memory only), signed in. */
async function createAccount(name) {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password, name })).id;
	const client = createClient();
	await client.collection('users').authWithPassword(email, password);
	return {
		id,
		client,
		send: (path, body, method = 'POST') => client.send(path, { method, body, requestKey: null }),
		ticket: (data = {}) => client.collection('tickets').create({ owner: id, title: `Ticket ${uniqueSuffix()}`, ...data }),
		project: (data = {}) =>
			client.collection('projects').create({ owner: id, name: `Projekt ${uniqueSuffix()}`, code: uniqueCode(), ...data }),
		tag: (data = {}) => client.collection('tags').create({ owner: id, name: `tag-${uniqueSuffix()}`, ...data })
	};
}

const privateScope = (person) => `u:${person.id}`;
const householdScope = () => `h:${householdId}`;

/** Status, problem, params of a refused call. */
async function rejection(promise) {
	try {
		await promise;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		return { status: error.status, problem: error.response?.problem, params: error.response?.params };
	}
	throw new Error('Expected the request to be rejected, but it succeeded.');
}

async function statusOf(promise) {
	try {
		await promise;
		return 200;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		return error.status;
	}
}

const ticketOf = (id) => superuser.collection('tickets').getOne(id);
const ruleOf = (id) => superuser.collection('recurrence_rules').getOne(id);
const historyOf = (id) =>
	superuser.collection('ticket_history').getFullList({ filter: superuser.filter('ticket = {:id}', { id }), sort: 'created,id' });
const instancesOf = (ruleId) =>
	superuser.collection('tickets').getFullList({ filter: superuser.filter('recurrence = {:r}', { r: ruleId }), sort: 'created,id' });
const counterOf = async (key) =>
	(await superuser.collection('ticket_counters').getFullList({ filter: superuser.filter('key = {:k}', { k: key }) })).map(
		(row) => row.value
	);

async function runRecurrence(iso) {
	const response = await fetch(`${instance.url}/api/byl-test/recurrence/run`, {
		method: 'POST',
		headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ now: Date.parse(iso) })
	});
	expect(response.status).toBe(200);
	return response.json();
}

/** Links a ticket to a rule past the request hooks (test route of recurrence-clock.pb.js). */
async function link(ticketId, ruleId) {
	const response = await fetch(`${instance.url}/api/byl-test/tickets/${ticketId}/link`, {
		method: 'POST',
		headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ rule: ruleId })
	});
	expect(response.status).toBe(200);
}

async function memberOf(person) {
	return a.client.collection('household_members').getFirstListItem(a.client.filter('user = {:u}', { u: person.id }));
}

/**
 * A daily series of `person` in the area `household` ('' = private): the rule with a template (a
 * sub-task, a charm, tags, a project), its open occurrence from two days ago (overdue, made by a run on
 * that day, with the sub-task of the template) and `done` done occurrences (created done, linked).
 */
async function seriesOf(person, { household = '', done = 2, project = '', tags = [], title } = {}) {
	const name = title ?? `Spülmaschine ${uniqueSuffix()}`;
	const rule = await person.client.collection('recurrence_rules').create({
		owner: person.id,
		household,
		title: name,
		mode: 'calendar',
		freq: 'daily',
		anchor: addDays(today(), -30),
		lead_days: 1,
		initial_status: 'open',
		active: false,
		project,
		tags,
		charm: 'putzen',
		template_subtasks: [{ title: 'Filter reinigen', priority: 'medium' }]
	});
	const first = addDays(today(), -2);
	await superuser.collection('recurrence_rules').update(rule.id, { active: true, next_due: stored(first) });
	expect((await runRecurrence(noon(first))).created).toBeGreaterThanOrEqual(1);
	const [open] = (await instancesOf(rule.id)).filter((ticket) => ticket.status !== 'done');
	expect(open).toBeTruthy();
	const [subtask] = await superuser.collection('tickets').getFullList({ filter: superuser.filter('parent = {:p}', { p: open.id }) });
	const doneOnes = [];
	for (let i = 0; i < done; i += 1) {
		const ticket = await person.ticket({ household, title: name, status: 'done', project, tags });
		await link(ticket.id, rule.id);
		doneOnes.push(ticket);
	}
	return { rule: await ruleOf(rule.id), open, subtask, done: doneOnes };
}

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = createClient();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	// A is the first account and so the administrator of the app; it founds the household, B joins.
	a = await createAccount('Anna Beispiel');
	b = await createAccount('Bert Beispiel');
	c = await createAccount('Clara Beispiel');
	householdId = (await a.send(ROUTE, { name: `Haus ${uniqueSuffix()}` })).household.id;
	const { code } = await a.send(`${ROUTE}/invites`, {});
	await b.send(`${ROUTE}/join`, { code });
});

afterAll(async () => {
	await instance?.stop();
});

// Every test leaves its rules paused, so a later run with another clock does not touch them.
afterEach(async () => {
	const active = await superuser.collection('recurrence_rules').getFullList({ filter: 'active = true' });
	for (const rule of active) await superuser.collection('recurrence_rules').update(rule.id, { active: false });
});

describe('a whole series from the private area into the household', () => {
	it('previews series, open and done occurrences apart, then moves rule, template and every occurrence', async () => {
		const tag = await a.tag({ name: `küche-${uniqueSuffix()}` });
		const { rule, open, subtask, done } = await seriesOf(a, { tags: [tag.id] });
		const before = await Promise.all([open, subtask, ...done].map((ticket) => ticketOf(ticket.id)));

		const preview = await a.send(MOVE, {
			kind: 'ticket',
			ids: [open.id],
			to: 'household',
			preview: true,
			series: true,
			series_done: true
		});
		expect(preview).toMatchObject({
			counts: { tickets: 4, subtasks: 1, rules: 1, series: 1, occurrences: { open: 1, done: 2 } },
			series_offer: { rules: 1, open: 1, done: 2 },
			needs: { project: false, dependencies: false, ticket_sources: false }
		});
		expect(preview.conflicts.series).toEqual([]);
		expect(preview.conflicts.rule_tickets).toBe(0);
		expect(preview.conflicts.tags).toEqual({ reused: [], created: [tag.name] });
		// The same offer without the choice: the dialog names the done ones before it is made.
		const alone = await a.send(MOVE, { kind: 'ticket', ids: [open.id], to: 'household', preview: true });
		expect(alone.series_offer).toEqual({ rules: 1, open: 1, done: 2 });
		expect(alone.counts).toMatchObject({ tickets: 2, rules: 0, series: 0, occurrences: { open: 0, done: 0 } });
		expect(alone.conflicts.series).toEqual([{ id: open.id, key: open.key }]);
		expect((await ticketOf(open.id)).scope).toBe(privateScope(a));

		const moved = await a.send(MOVE, { kind: 'ticket', ids: [open.id], to: 'household', series: true, series_done: true });
		expect(moved.moved.rules).toEqual([rule.id]);
		expect(moved.moved.tickets.map((entry) => entry.id).sort()).toEqual([open.id, subtask.id, ...done.map((t) => t.id)].sort());

		// The rule with its template in the household; tags by name there.
		const movedRule = await ruleOf(rule.id);
		const [shared] = await superuser
			.collection('tags')
			.getFullList({ filter: superuser.filter('scope = {:s} && name = {:n}', { s: householdScope(), n: tag.name }) });
		expect(movedRule).toMatchObject({
			scope: householdScope(),
			household: householdId,
			owner: a.id,
			charm: 'putzen',
			template_subtasks: [{ title: 'Filter reinigen', priority: 'medium' }],
			next_due: rule.next_due,
			active: true
		});
		expect(movedRule.tags).toEqual([shared.id]);
		// Every occurrence stays in its series, with a new key in the target and the old one in the history.
		for (const ticket of [open, ...done]) {
			const after = await ticketOf(ticket.id);
			expect(after).toMatchObject({ scope: householdScope(), recurrence: rule.id, tags: [shared.id] });
			const entry = (await historyOf(ticket.id)).find((item) => item.field === 'area_move');
			const previous = before.find((item) => item.id === ticket.id).key;
			expect(entry.old_value).toBe(previous);
			expect(JSON.parse(entry.new_value)).toEqual({ to: 'household', key: after.key });
		}
		expect(await ticketOf(subtask.id)).toMatchObject({ scope: householdScope(), parent: open.id });
		// B sees the rule and the open occurrence; C sees nothing of it.
		expect((await b.client.collection('recurrence_rules').getOne(rule.id)).title).toBe(rule.title);
		expect((await b.client.collection('tickets').getOne(open.id)).recurrence).toBe(rule.id);
		expect(await statusOf(c.client.collection('recurrence_rules').getOne(rule.id))).toBe(404);

		// Back into the private area as a whole: A created all of it.
		await a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'private', series: true, series_done: true });
		expect((await ruleOf(rule.id)).scope).toBe(privateScope(a));
		for (const ticket of [open, subtask, ...done]) {
			expect((await ticketOf(ticket.id)).scope).toBe(privateScope(a));
		}
		expect(await statusOf(b.client.collection('tickets').getOne(open.id))).toBe(404);
	});

	it('leaves the done occurrences behind without their rule when they do not come along', async () => {
		const { rule, open, done } = await seriesOf(a, { done: 3 });
		const preview = await a.send(MOVE, {
			kind: 'rule',
			ids: [rule.id],
			to: 'household',
			preview: true,
			series: true,
			series_done: false
		});
		expect(preview).toMatchObject({
			counts: { tickets: 2, rules: 1, series: 1, occurrences: { open: 1, done: 0 } },
			series_offer: { rules: 1, open: 1, done: 3 }
		});
		expect(preview.conflicts.rule_tickets).toBe(3);
		await a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', series: true, series_done: false });
		expect(await ticketOf(open.id)).toMatchObject({ scope: householdScope(), recurrence: rule.id });
		for (const ticket of done) {
			expect(await ticketOf(ticket.id)).toMatchObject({ scope: privateScope(a), recurrence: '' });
			expect((await historyOf(ticket.id)).some((item) => item.field === 'recurrence' && item.new_value === '')).toBe(true);
		}
	});

	it('keeps the behaviour of E7-4 without the choice: the rule alone, a ticket alone leaves its series', async () => {
		const first = await seriesOf(a, { done: 1 });
		await a.send(MOVE, { kind: 'rule', ids: [first.rule.id], to: 'household' });
		expect((await ruleOf(first.rule.id)).scope).toBe(householdScope());
		expect(await ticketOf(first.open.id)).toMatchObject({ scope: privateScope(a), recurrence: '' });

		const second = await seriesOf(a, { done: 1 });
		await a.send(MOVE, { kind: 'ticket', ids: [second.open.id], to: 'household', series: false });
		expect(await ticketOf(second.open.id)).toMatchObject({ scope: householdScope(), recurrence: '' });
		expect((await ruleOf(second.rule.id)).scope).toBe(privateScope(a));
	});
});

describe('the series after the move (WH-1 in the target)', () => {
	it('makes the next occurrence in the household when the moved one is completed, never in the past', async () => {
		const { rule, open, subtask } = await seriesOf(a, { done: 1 });
		// A has the overdue occurrence in the plan of today of the private area.
		await a.send('/api/byl/dayplan/items', { ticket: open.id });
		const planned = () =>
			superuser.collection('day_plan_items').getFullList({ filter: superuser.filter('ticket = {:t}', { t: open.id }) });
		expect(await planned()).toHaveLength(1);

		await a.send(MOVE, { kind: 'ticket', ids: [open.id], to: 'household', series: true, series_done: true });
		// The entry of the day plan of the old area is gone.
		expect(await planned()).toHaveLength(0);

		// B completes the occurrence in the household with its sub-task of the template.
		await b.client.collection('tickets').update(open.id, { status: 'done', complete_children: true });
		expect((await ticketOf(subtask.id)).status).toBe('done');
		const next = await nextOccurrence(rule.id, open.id);
		expect(next.scope).toBe(householdScope());
		expect(dateOf(next.due) > today()).toBe(true);
		expect(next.key).toMatch(/^TASK-\d+$/);
		// The rule goes on after today; the dates left behind count as skipped at the completed ticket.
		expect(dateOf((await ruleOf(rule.id)).next_due) > today()).toBe(true);
		expect((await historyOf(open.id)).some((item) => item.field === 'recurrence_skipped')).toBe(true);
		// A sees the new occurrence, C does not.
		expect((await a.client.collection('tickets').getOne(next.id)).recurrence).toBe(rule.id);
		expect(await statusOf(c.client.collection('tickets').getOne(next.id))).toBe(404);
	});
});

/** The next occurrence of a rule after `previous` was completed (made after the commit). */
async function nextOccurrence(ruleId, previous) {
	const deadline = Date.now() + EVENT_TIMEOUT_MS;
	for (;;) {
		const found = (await instancesOf(ruleId)).filter((ticket) => ticket.id !== previous && ticket.status !== 'done');
		if (found.length > 0) return found[0];
		if (Date.now() > deadline) throw new Error(`No next occurrence within ${EVENT_TIMEOUT_MS} ms`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

describe('the bulk action with mixed tickets', () => {
	it('takes plain tickets and tickets of series with their whole series along in one step', async () => {
		const plain = await a.ticket();
		const one = await seriesOf(a, { done: 1 });
		const two = await seriesOf(a, { done: 2 });
		const ids = [plain.id, one.open.id, two.done[0].id];
		const preview = await a.send(MOVE, { kind: 'ticket', ids, to: 'household', preview: true, series: true, series_done: true });
		expect(preview).toMatchObject({
			counts: { rules: 2, series: 2, occurrences: { open: 2, done: 3 } },
			series_offer: { rules: 2, open: 2, done: 3 }
		});
		// The plain ticket, two open occurrences with their sub-task each, three done ones.
		expect(preview.counts.tickets).toBe(1 + 2 * 2 + 3);
		await a.send(MOVE, { kind: 'ticket', ids, to: 'household', series: true, series_done: true });
		expect((await ticketOf(plain.id)).scope).toBe(householdScope());
		for (const series of [one, two]) {
			expect((await ruleOf(series.rule.id)).scope).toBe(householdScope());
			for (const ticket of [series.open, ...series.done]) {
				expect(await ticketOf(ticket.id)).toMatchObject({ scope: householdScope(), recurrence: series.rule.id });
			}
		}
	});
});

describe('conflicts of E7-4 for every record of the series', () => {
	it('asks for the project the series leaves behind and gives the rule and every occurrence the chosen one', async () => {
		const own = await a.project();
		const target = await a.project({ household: householdId });
		const { rule, open, done } = await seriesOf(a, { project: own.id, done: 1 });
		const preview = await a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', preview: true, series: true, series_done: true });
		expect(preview.needs.project).toBe(true);
		expect(preview.conflicts.project).toMatchObject({
			projects: [{ id: own.id, code: own.code, name: own.name }],
			tickets: 3,
			rules: 1
		});
		expect(preview.conflicts.project.targets.map((entry) => entry.id)).toContain(target.id);
		expect(
			(await rejection(a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', series: true, series_done: true }))).problem
		).toBe('project-choice');
		await a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', series: true, series_done: true, project: target.id });
		expect((await ruleOf(rule.id)).project).toBe(target.id);
		for (const ticket of [open, ...done]) {
			const after = await ticketOf(ticket.id);
			expect(after.project).toBe(target.id);
			expect(after.key.startsWith(`${target.code}-`)).toBe(true);
		}
	});

	it('asks for a new @CODE when the project of a series moves into a household that has the code', async () => {
		const code = uniqueCode().slice(0, 4);
		await a.project({ household: householdId, code });
		const project = await a.project({ code });
		const { rule, open } = await seriesOf(a, { project: project.id, done: 1 });
		const preview = await a.send(MOVE, { kind: 'project', ids: [project.id], to: 'household', preview: true, series: true, series_done: true });
		expect(preview.needs.codes).toEqual([project.id]);
		expect(preview.counts).toMatchObject({ projects: 1, rules: 1, series: 1, occurrences: { open: 1, done: 1 } });
		expect(
			(await rejection(a.send(MOVE, { kind: 'project', ids: [project.id], to: 'household', series: true, series_done: true })))
				.problem
		).toBe('code');
		await a.send(MOVE, {
			kind: 'project',
			ids: [project.id],
			to: 'household',
			series: true,
			series_done: true,
			codes: { [project.id]: `${code}H` }
		});
		expect(await ruleOf(rule.id)).toMatchObject({ scope: householdScope(), project: project.id });
		expect(await ticketOf(open.id)).toMatchObject({ recurrence: rule.id, project: project.id });
		expect((await ticketOf(open.id)).key.startsWith(`${code}H-`)).toBe(true);
	});

	it('names a dependency of a done occurrence across the border and takes or releases it', async () => {
		const outside = await a.ticket();
		const { rule, done } = await seriesOf(a, { done: 1 });
		const dependency = await superuser.collection('dependencies').create({ blocker: done[0].id, blocked: outside.id, owner: a.id });
		const preview = await a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', preview: true, series: true, series_done: true });
		expect(preview.needs.dependencies).toBe(true);
		expect(preview.conflicts.dependencies.map((entry) => entry.other.id)).toEqual([outside.id]);
		expect(
			(await rejection(a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', series: true, series_done: true }))).problem
		).toBe('dependencies-choice');
		await a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', series: true, series_done: true, dependencies: 'take' });
		expect((await ticketOf(outside.id)).scope).toBe(householdScope());
		expect((await superuser.collection('dependencies').getOne(dependency.id)).household).toBe(householdId);

		const other = await a.ticket();
		const second = await seriesOf(a, { done: 1 });
		const released = await superuser.collection('dependencies').create({ blocker: second.open.id, blocked: other.id, owner: a.id });
		await a.send(MOVE, { kind: 'rule', ids: [second.rule.id], to: 'household', series: true, series_done: true, dependencies: 'release' });
		expect(await statusOf(superuser.collection('dependencies').getOne(released.id))).toBe(404);
		expect((await ticketOf(other.id)).scope).toBe(privateScope(a));
	});

	it('names a follow-up of an occurrence across the border and takes it along', async () => {
		const { rule, open } = await seriesOf(a, { done: 0 });
		const followUp = await a.ticket();
		await a.send(`/api/byl/tickets/${followUp.id}/ticket-sources`, { source: open.id });
		const preview = await a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', preview: true, series: true });
		expect(preview.needs.ticket_sources).toBe(true);
		expect(preview.conflicts.ticket_sources).toMatchObject([
			{ ticket: { id: open.id }, other: { id: followUp.id }, relation: 'follow_up', trashed: false }
		]);
		await a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', series: true, ticket_sources: 'take' });
		expect((await ticketOf(followUp.id)).scope).toBe(householdScope());
		expect(await ticketOf(open.id)).toMatchObject({ scope: householdScope(), recurrence: rule.id });
	});
});

describe('rights for every record of the series (ADR-0061 §4)', () => {
	it('moves a series of the household into the private area only with the right for every record', async () => {
		const { rule, open, done } = await seriesOf(a, { household: householdId, done: 1 });
		// B created none of it and has no "move_out": refused, also in the preview, naming a record.
		const refused = await rejection(b.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'private', series: true, series_done: true }));
		expect([refused.status, refused.problem]).toEqual([403, 'right']);
		expect(typeof refused.params.label).toBe('string');
		expect((await rejection(b.send(MOVE, { kind: 'ticket', ids: [open.id], to: 'private', preview: true, series: true }))).status).toBe(
			403
		);
		expect((await ruleOf(rule.id)).scope).toBe(householdScope());

		// With "move_out" B takes the whole series into the private area of B, who becomes its owner.
		await a.send(`${ROUTE}/members/${(await memberOf(b)).id}/rights`, { rights: ['move_out'] });
		await b.send(MOVE, { kind: 'ticket', ids: [open.id], to: 'private', series: true, series_done: true });
		expect(await ruleOf(rule.id)).toMatchObject({ owner: b.id, household: '', scope: privateScope(b) });
		for (const ticket of [open, ...done]) {
			expect(await ticketOf(ticket.id)).toMatchObject({ owner: b.id, scope: privateScope(b), recurrence: rule.id });
		}
		expect(await statusOf(a.client.collection('recurrence_rules').getOne(rule.id))).toBe(404);
		await a.send(`${ROUTE}/members/${(await memberOf(b)).id}/rights`, { rights: [] });
	});

	it('refuses a series with a record of another member, and moves it without that record', async () => {
		const { rule, open } = await seriesOf(b, { household: householdId, done: 0 });
		// A done occurrence A created: B may take the rule and the open one, not this one.
		const foreign = await a.ticket({ household: householdId, title: rule.title, status: 'done' });
		await link(foreign.id, rule.id);
		const refused = await rejection(b.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'private', series: true, series_done: true }));
		expect([refused.status, refused.problem, refused.params]).toEqual([403, 'right', { label: foreign.key }]);
		await b.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'private', series: true, series_done: false });
		expect(await ticketOf(open.id)).toMatchObject({ scope: privateScope(b), recurrence: rule.id });
		expect(await ticketOf(foreign.id)).toMatchObject({ scope: householdScope(), recurrence: '' });
	});

	it('moves into the household only own private series; others are not found', async () => {
		const { rule } = await seriesOf(a, { done: 1 });
		const foreign = await rejection(b.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', series: true }));
		expect([foreign.status, foreign.problem]).toEqual([404, 'missing']);
		const alone = await rejection(c.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', series: true }));
		expect([alone.status, alone.problem]).toEqual([404, 'no-household']);
		expect(
			(await rejection(a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', series: 'ja' }))).problem
		).toBe('format');
	});
});

describe('one transaction', () => {
	it('changes nothing when a write in the middle of the series fails', async () => {
		const { rule, open, subtask, done } = await seriesOf(a, { done: 2 });
		// The last done occurrence fails to move (fault-injection.pb.js); rule and open one come first.
		await superuser.collection('tickets').update(done[1].id, { title: FAIL_AREA_MOVE });
		const tickets = [open, subtask, ...done];
		const before = await Promise.all(tickets.map((ticket) => ticketOf(ticket.id)));
		const counter = await counterOf(`${householdScope()}:TASK`);
		expect(await statusOf(a.send(MOVE, { kind: 'rule', ids: [rule.id], to: 'household', series: true, series_done: true }))).toBe(400);
		const after = await Promise.all(tickets.map((ticket) => ticketOf(ticket.id)));
		expect(after.map((ticket) => [ticket.scope, ticket.key, ticket.recurrence])).toEqual(
			before.map((ticket) => [ticket.scope, ticket.key, ticket.recurrence])
		);
		expect(await ruleOf(rule.id)).toMatchObject({ scope: privateScope(a), next_due: rule.next_due });
		expect((await historyOf(open.id)).some((item) => item.field === 'area_move')).toBe(false);
		expect(await counterOf(`${householdScope()}:TASK`)).toEqual(counter);
	});
});
