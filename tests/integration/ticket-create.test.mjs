// "Neues Ticket" with everything at once (NT-1, ADR-0069) against an own disposable PocketBase with
// the scenario of the areas (tests/support/scenario.mjs): A and B share a household (A founds it), C is
// alone. The route POST /api/byl/tickets/create creates the ticket with its sub-tasks, sources from
// the inbox, source tickets, the rule of a series, the pin and the entry in the day plan of today in
// one transaction, through the data layer of the SPA (data/ticket-create.ts). Every refusal (area,
// level, member as assignee, unknown charm, a done ticket with pin or plan, sources of another area)
// leaves nothing behind, and so does a failure of the very last write (fault-injection.pb.js). The
// results are those of the ways before: the series with "Serie ab heute beginnen" and "Ursprüngliches
// Datum behalten" (WH-2) equal the two steps ticket, then rule; sub-tasks equal "Unteraufgabe
// hinzufügen". Another member as assignee gets the notice of byl/assigned.

import PocketBase from 'pocketbase';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { FAIL_CREATE, counterValue, createAreaScenario, historyOf, scopeOf, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { scaled } from '../support/timing.mjs';
import { createTicketWithOptions, fetchCreateSupport } from '../../web/src/lib/data/ticket-create.ts';
import { createRule } from '../../web/src/lib/data/recurrence.ts';
import { createTicket } from '../../web/src/lib/data/tickets.ts';
import { berlinToday } from '../../web/src/lib/domain/berlin-date.ts';
import { defaultFormValues, formParams } from '../../web/src/lib/domain/recurrence-rule.ts';
import { templateBody, ticketTemplate } from '../../web/src/lib/domain/series-template.ts';
import { NO_EXTRAS } from '../../web/src/lib/domain/ticket-create.ts';

const TOPIC = 'byl/assigned';
const EVENT_TIMEOUT_MS = scaled(5_000);

/** A Tuesday long in the past (as in recurrence-start.test.mjs). */
const OLD_DUE = '2024-03-12';

let instance;
let superuser;
let a;
let b;
let c;
let householdId;
const stops = [];

const today = () => berlinToday(Date.now());
const dateOf = (value) => (value ? value.slice(0, 10) : '');

beforeAll(async () => {
	instance = await startPocketBase();
	({ superuser, a, b, c, householdId } = await createAreaScenario(instance));
});

afterAll(async () => {
	for (const stop of stops) await stop().catch(() => undefined);
	await instance?.stop();
});

// Every test leaves its rules paused, so the hourly run of the instance makes no tickets meanwhile.
afterEach(async () => {
	const active = await superuser.collection('recurrence_rules').getFullList({ filter: 'active = true' });
	for (const rule of active) await superuser.collection('recurrence_rules').update(rule.id, { active: false });
});

/** A request of the form: the draft of the ticket, its extras and the parameters of a series. */
function request(draft, { extras = {}, recurrence = null, sourceItem = null } = {}) {
	return {
		draft: { description: '', status: 'open', priority: 'medium', due: null, project: null, tags: [], ...draft },
		sourceItem,
		recurrence,
		extras: { ...NO_EXTRAS, ...extras }
	};
}

/** Creates as `person`, in the household with `inHousehold`. */
function create(person, req, inHousehold = false) {
	return createTicketWithOptions(person.client, req, { household: inHousehold ? householdId : '' });
}

/** The refusal of a call: status, field and code of the data layer. */
async function refusal(promise) {
	try {
		await promise;
	} catch (error) {
		const [field, detail] = Object.entries(error.fields ?? {})[0] ?? [];
		return { status: error.status, kind: error.kind, field, code: detail?.code, index: detail?.params?.index };
	}
	throw new Error('Expected a refusal');
}

/** How many records of each kind the instance holds, and the counters of the areas of A. */
async function snapshot() {
	const count = async (collection, filter = '') =>
		(await superuser.collection(collection).getList(1, 1, { filter, fields: 'id' })).totalItems;
	return {
		tickets: await count('tickets'),
		rules: await count('recurrence_rules'),
		pins: await count('ticket_pins'),
		planItems: await count('day_plan_items'),
		links: await count('ticket_sources'),
		history: await count('ticket_history'),
		converted: await count('inbox_items', "state = 'converted'"),
		privateCounter: await counterValue(superuser, `${scopeOf(a.id, '')}:TASK`),
		householdCounter: await counterValue(superuser, `${scopeOf('', householdId)}:TASK`)
	};
}

async function project(person, household = '') {
	return person.client.collection('projects').create({ owner: person.id, household, name: `Projekt ${uniqueSuffix()}`, code: uniqueCode() });
}

async function tag(person, household = '') {
	return person.client.collection('tags').create({ owner: person.id, household, name: `tag-${uniqueSuffix()}` });
}

async function entry(person, household = '', title = `Eintrag ${uniqueSuffix()}`) {
	return person.client.collection('inbox_items').create({ owner: person.id, household, channel: 'manual', kind: 'todo', title });
}

/** The parameters of a weekly series as the form sends them (formParams), with "Folgetickets starten mit". */
function weekly(due, start = 'today') {
	return { ...formParams(defaultFormValues(due, today())), start, initial_status: 'open' };
}

async function until(ready, label) {
	const deadline = Date.now() + EVENT_TIMEOUT_MS;
	while (!(await ready())) {
		if (Date.now() > deadline) throw new Error(`Not reached within ${EVENT_TIMEOUT_MS} ms: ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

describe('what the server knows (GET /api/byl/tickets/create)', () => {
	it('names every option after all migrations', async () => {
		expect(await fetchCreateSupport(a.client)).toEqual({
			recurrence: true,
			pin: true,
			dayPlan: true,
			ticketSources: true,
			kind: true,
			color: true,
			charm: true,
			assignee: true
		});
	});

	it('answers only signed-in app accounts', async () => {
		const anonymous = new PocketBase(instance.url);
		await expect(anonymous.send('/api/byl/tickets/create', { method: 'GET' })).rejects.toMatchObject({ status: 401 });
		await expect(anonymous.send('/api/byl/tickets/create', { method: 'POST', body: { title: 'x' } })).rejects.toMatchObject({ status: 401 });
	});
});

describe('creating with every option at once', () => {
	it('creates ticket, sub-tasks, sources, series, pin and day plan in the household in one step', async () => {
		const house = await project(a, householdId);
		const garden = await tag(a, householdId);
		const item = await entry(b, householdId, 'Mail vom Vermieter');
		const origin = await a.ticket({ household: householdId, title: 'Heizung prüfen' });
		const due = today();

		const { ticket, outcome } = await create(
			a,
			request(
				{
					title: '  Heizung warten  ',
					description: 'Mit **Termin**',
					status: 'in_progress',
					priority: 'high',
					due,
					project: house.id,
					tags: [garden.id],
					color: 'blau',
					charm: 'einkaufen',
					kind: 'ongoing',
					assignee: b.id
				},
				{
					extras: {
						subtasks: [
							{ title: 'Termin machen', priority: 'urgent' },
							{ title: 'Filter kaufen', priority: 'medium' }
						],
						sources: [item.id],
						ticketSources: [origin.id],
						pin: true,
						dayPlan: true
					},
					recurrence: weekly(due)
				}
			),
			true
		);

		// The ticket as the panel reads it.
		expect(ticket).toMatchObject({
			title: 'Heizung warten',
			status: 'in_progress',
			priority: 'high',
			due,
			projectId: house.id,
			tagIds: [garden.id],
			color: 'blau',
			charm: 'einkaufen',
			kind: 'ongoing',
			assignee: b.id,
			scope: scopeOf('', householdId),
			owner: a.id,
			source: 'manual',
			recurring: true,
			recurrenceId: outcome.rule
		});
		expect(ticket.key).toBe(`${house.code}-1`);
		expect(ticket.assignedAt).not.toBeNull();
		expect(outcome).toMatchObject({ id: ticket.id, key: ticket.key, sources: 1, ticketSources: 1, pinned: true, dayPlan: true });

		// Sub-tasks in the order of the form, like "Unteraufgabe hinzufügen": open, project and tags of
		// the ticket, blocking, without due date, assignee or series.
		const children = await superuser.collection('tickets').getFullList({
			filter: superuser.filter('parent = {:id}', { id: ticket.id }),
			sort: 'created,id'
		});
		expect(children.map((child) => [child.title, child.priority, child.status])).toEqual([
			['Termin machen', 'urgent', 'open'],
			['Filter kaufen', 'medium', 'open']
		]);
		for (const child of children) {
			expect(child).toMatchObject({
				project: house.id,
				tags: [garden.id],
				household: householdId,
				owner: a.id,
				blocks_parent: true,
				due: '',
				assignee: '',
				recurrence: '',
				kind: 'task',
				source: 'manual'
			});
		}
		expect(outcome.subtasks.map((child) => child.id)).toEqual(children.map((child) => child.id));

		// The entry of the inbox is a source now, with "Quelle verknüpft" in the history of the ticket.
		expect(await superuser.collection('inbox_items').getOne(item.id)).toMatchObject({ state: 'converted', ticket: ticket.id });
		const history = await historyOf(superuser, ticket.id);
		expect(history.find((row) => row.field === 'created')).toMatchObject({ user: a.id, new_value: ticket.key });
		expect(history.find((row) => row.field === 'source_link')).toMatchObject({ user: a.id });
		expect(history.find((row) => row.field === 'ticket_source')).toMatchObject({ user: a.id });
		expect((await historyOf(superuser, origin.id)).find((row) => row.field === 'follow_up')).toMatchObject({ user: a.id });
		const links = await superuser.collection('ticket_sources').getFullList({ filter: superuser.filter('ticket = {:id}', { id: ticket.id }) });
		expect(links.map((link) => [link.source, link.created_by])).toEqual([[origin.id, a.id]]);

		// The series: the template is the ticket, the ticket its first instance.
		const rule = await superuser.collection('recurrence_rules').getOne(outcome.rule);
		expect(rule).toMatchObject({
			title: 'Heizung warten',
			description: 'Mit **Termin**',
			project: house.id,
			tags: [garden.id],
			priority: 'high',
			color: 'blau',
			charm: 'einkaufen',
			household: householdId,
			owner: a.id,
			freq: 'weekly',
			initial_status: 'open',
			active: true
		});

		// The pin of A and the entry in the plan of today of the household.
		const pins = await superuser.collection('ticket_pins').getFullList({ filter: superuser.filter('ticket = {:id}', { id: ticket.id }) });
		expect(pins.map((pin) => pin.user)).toEqual([a.id]);
		const plan = await superuser.collection('day_plans').getFirstListItem(superuser.filter('scope = {:scope} && date = {:date}', { scope: scopeOf('', householdId), date: today() }));
		const items = await superuser.collection('day_plan_items').getFullList({ filter: superuser.filter('plan = {:plan} && ticket = {:ticket}', { plan: plan.id, ticket: ticket.id }) });
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ origin: 'manual', added_by: a.id, done_today: false });
	});

	it('creates with the title alone, like the form with Enter', async () => {
		const before = await snapshot();
		const { ticket, outcome } = await create(a, request({ title: 'Nur ein Titel' }));
		expect(ticket).toMatchObject({ title: 'Nur ein Titel', status: 'open', priority: 'medium', kind: 'task', scope: scopeOf(a.id, ''), recurring: false });
		expect(outcome).toMatchObject({ subtasks: [], sources: 0, ticketSources: 0, rule: '', pinned: false, dayPlan: false });
		const after = await snapshot();
		expect(after.tickets).toBe(before.tickets + 1);
		expect(after.rules).toBe(before.rules);
		expect(after.privateCounter).toBe(before.privateCounter + 1);
	});

	it('converts an entry of the inbox and links further ones as sources', async () => {
		const main = await entry(a, '', 'Termin beim Zahnarzt');
		const more = await entry(a, '', 'Rückruf der Praxis');
		const { ticket, outcome } = await create(a, request({ title: 'Zahnarzt' }, { sourceItem: main.id, extras: { sources: [more.id, main.id] } }));
		expect(ticket).toMatchObject({ sourceItem: main.id, source: 'manual' });
		// The main source counts once, as main source.
		expect(outcome.sources).toBe(1);
		expect(await superuser.collection('inbox_items').getOne(main.id)).toMatchObject({ state: 'converted', ticket: ticket.id });
		expect(await superuser.collection('inbox_items').getOne(more.id)).toMatchObject({ state: 'converted', ticket: ticket.id });
	});

	it('creates a sub-task under a parent, with "Blockiert das übergeordnete Ticket" off', async () => {
		const parent = await a.ticket({ title: 'Umzug' });
		const { ticket } = await create(a, request({ title: 'Kartons', parent: parent.id, blocksParent: false }));
		expect(ticket).toMatchObject({ parentId: parent.id, blocksParent: false });
	});
});

describe('refusals leave nothing behind', () => {
	/** The refusal of `call`, started after counting, and nothing more on the instance after it. */
	async function refusedWithoutTrace(call) {
		const before = await snapshot();
		const result = await refusal(call());
		expect(await snapshot()).toEqual(before);
		return result;
	}

	it('refuses the household of another account (403)', async () => {
		const result = await refusedWithoutTrace(() => createTicketWithOptions(c.client, request({ title: 'Fremd' }), { household: householdId }));
		expect(result).toMatchObject({ status: 403, kind: 'forbidden' });
	});

	it('refuses references across the border of the area at their field', async () => {
		const privateProject = await project(a);
		const privateTicket = await a.ticket({ title: 'Privat' });
		const privateEntry = await entry(a);
		const extras = { subtasks: [{ title: 'Eins', priority: 'medium' }], pin: true, dayPlan: true };
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'H', project: privateProject.id }, { extras }), true))).toMatchObject({
			status: 400,
			field: 'project',
			code: 'validation_scope_mismatch'
		});
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'H' }, { extras: { ...extras, ticketSources: [privateTicket.id] } }), true))).toMatchObject({
			field: 'ticket_sources',
			code: 'validation_scope_mismatch',
			index: 0
		});
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'H' }, { extras: { ...extras, sources: [privateEntry.id] } }), true))).toMatchObject({
			field: 'sources',
			code: 'validation_scope_mismatch',
			index: 0
		});
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'H', parent: privateTicket.id }), true))).toMatchObject({
			field: 'parent',
			code: 'validation_scope_mismatch'
		});
	});

	it('refuses tickets and entries the account does not see', async () => {
		const foreign = await c.ticket({ title: 'Von Clara' });
		const foreignEntry = await entry(c);
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'X' }, { extras: { ticketSources: [foreign.id] } })))).toMatchObject({
			field: 'ticket_sources',
			code: 'validation_ticket_source_missing'
		});
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'X' }, { extras: { sources: [foreignEntry.id] } })))).toMatchObject({
			field: 'sources',
			code: 'validation_create_source_missing'
		});
	});

	it('refuses a second level: sub-tasks of a sub-task and a sub-task as parent', async () => {
		const parent = await a.ticket({ title: 'Oben' });
		const child = await a.ticket({ title: 'Mitte', parent: parent.id });
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'Unten', parent: child.id })))).toMatchObject({
			field: 'parent',
			code: 'validation_parent_nested'
		});
		expect(
			await refusedWithoutTrace(() => create(a, request({ title: 'Mitte 2', parent: parent.id }, { extras: { subtasks: [{ title: 'Unten', priority: 'low' }] } })))
		).toMatchObject({ field: 'subtasks', code: 'validation_create_subtasks_nested' });
	});

	it('refuses a non-member as assignee and any assignee of a private ticket', async () => {
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'Für Clara', assignee: c.id }), true))).toMatchObject({
			field: 'assignee',
			code: 'validation_assignee_member'
		});
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'Privat für Bert', assignee: b.id })))).toMatchObject({
			field: 'assignee',
			code: 'validation_assignee_private'
		});
	});

	it('refuses an unknown charm, an unknown color and an unknown kind', async () => {
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'C', charm: 'gibtsnicht' })))).toMatchObject({ field: 'charm', code: 'validation_charm_unknown' });
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'C', color: 'pink' })))).toMatchObject({ field: 'color', code: 'validation_create_format' });
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'C', kind: 'projekt' })))).toMatchObject({ field: 'kind', code: 'validation_create_format' });
	});

	it('refuses pin, day plan and series for a done ticket', async () => {
		const done = { title: 'Schon erledigt', status: 'done' };
		expect(await refusedWithoutTrace(() => create(a, request(done, { extras: { pin: true } })))).toMatchObject({ field: 'pin', code: 'validation_pin_done' });
		expect(await refusedWithoutTrace(() => create(a, request(done, { extras: { dayPlan: true } })))).toMatchObject({ field: 'day_plan', code: 'validation_dayplan_ticket_done' });
		expect(await refusedWithoutTrace(() => create(a, request(done, { recurrence: weekly(today()) })))).toMatchObject({ field: 'recurrence', code: 'validation_recurrence_ticket_done' });
	});

	it('refuses a series without "Folgetickets starten mit" and with a broken rhythm at their fields', async () => {
		const { initial_status: _status, ...noStatus } = weekly(today());
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'S' }, { recurrence: noStatus })))).toMatchObject({
			field: 'initial_status',
			code: 'validation_recurrence_initial_status_required'
		});
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'S' }, { recurrence: { ...weekly(today()), interval: 400 } })))).toMatchObject({ field: 'interval' });
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'S' }, { recurrence: { ...weekly(today()), start: 'gestern' } })))).toMatchObject({
			field: 'start',
			code: 'validation_recurrence_start'
		});
	});

	it('refuses broken input of the request before anything is checked against the data', async () => {
		expect(await refusedWithoutTrace(() => create(a, request({ title: '   ' })))).toMatchObject({ field: 'title', code: 'validation_create_title' });
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'T' }, { extras: { subtasks: [{ title: ' ', priority: 'low' }] } })))).toMatchObject({
			field: 'subtasks',
			code: 'validation_create_subtask_title',
			index: 0
		});
		const many = Array.from({ length: 21 }, (_, index) => ({ title: `U${index}`, priority: 'low' }));
		expect(await refusedWithoutTrace(() => create(a, request({ title: 'T' }, { extras: { subtasks: many } })))).toMatchObject({ field: 'subtasks', code: 'validation_create_subtasks_max' });
	});

	it('keeps nothing when the very last write fails', async () => {
		const house = await project(a, householdId);
		const item = await entry(a, householdId);
		const origin = await a.ticket({ household: householdId });
		const before = await snapshot();
		const result = await refusal(
			create(
				a,
				request(
					{ title: FAIL_CREATE, project: house.id, due: today() },
					{
						extras: { subtasks: [{ title: 'Eins', priority: 'medium' }], sources: [item.id], ticketSources: [origin.id], pin: true, dayPlan: true },
						recurrence: weekly(today())
					}
				),
				true
			)
		);
		// The injected failure of the entry in the day plan, after every other write.
		expect(result).toMatchObject({ status: 400 });
		expect(await snapshot()).toEqual(before);
		expect(await counterValue(superuser, `${scopeOf('', householdId)}:${house.id}`)).toBe(0);
		expect(await superuser.collection('inbox_items').getOne(item.id)).toMatchObject({ state: 'new', ticket: '' });
	});
});

describe('household and private area', () => {
	it('puts a private ticket into the private plan and gives it the private counter', async () => {
		const { ticket } = await create(a, request({ title: 'Privat geplant' }, { extras: { dayPlan: true, pin: true } }));
		expect(ticket.scope).toBe(scopeOf(a.id, ''));
		expect(ticket.key).toMatch(/^TASK-\d+$/);
		const plan = await superuser.collection('day_plans').getFirstListItem(superuser.filter('scope = {:scope} && date = {:date}', { scope: scopeOf(a.id, ''), date: today() }));
		const items = await superuser.collection('day_plan_items').getFullList({ filter: superuser.filter('plan = {:plan}', { plan: plan.id }) });
		expect(items.map((item) => item.ticket)).toContain(ticket.id);
	});

	it('lets every member create in the household, and the pin belongs to who created', async () => {
		const { ticket } = await create(b, request({ title: 'Von Bert' }, { extras: { pin: true } }), true);
		expect(ticket.scope).toBe(scopeOf('', householdId));
		const pins = await superuser.collection('ticket_pins').getFullList({ filter: superuser.filter('ticket = {:id}', { id: ticket.id }) });
		expect(pins.map((pin) => pin.user)).toEqual([b.id]);
	});
});

describe('a series with a due date in the past (WH-2)', () => {
	/** The same series in the two steps of before: the ticket, then the rule with it. */
	async function twoSteps(start) {
		const ticket = await createTicket(a.client, { title: `Zwei Schritte ${start}`, description: '', status: 'open', priority: 'medium', due: OLD_DUE, project: null, tags: [] }, { household: '' });
		const rule = await createRule(
			a.client,
			{ ...templateBody(ticketTemplate(ticket, 'open')), ...weekly(OLD_DUE, start) },
			ticket.id,
			{ household: '' }
		);
		return { ticket: await superuser.collection('tickets').getOne(ticket.id), rule: await superuser.collection('recurrence_rules').getOne(rule.id) };
	}

	async function oneStep(start) {
		const { outcome } = await create(a, request({ title: `Ein Schritt ${start}`, due: OLD_DUE }, { recurrence: weekly(OLD_DUE, start) }));
		return { ticket: await superuser.collection('tickets').getOne(outcome.id), rule: await superuser.collection('recurrence_rules').getOne(outcome.rule) };
	}

	const facts = ({ ticket, rule }) => ({
		due: dateOf(ticket.due),
		anchor: dateOf(rule.anchor),
		next_due: dateOf(rule.next_due),
		weekdays: rule.weekdays,
		recurrence: ticket.recurrence === rule.id
	});

	it('begins from today with "Serie ab heute beginnen", like the two steps of before', async () => {
		const one = await oneStep('today');
		const two = await twoSteps('today');
		expect(facts(one)).toEqual(facts(two));
		expect(dateOf(one.ticket.due) >= today()).toBe(true);
		expect(dateOf(one.rule.next_due) > dateOf(one.ticket.due)).toBe(true);
		const moved = (await historyOf(superuser, one.ticket.id)).find((row) => row.field === 'due');
		expect(moved).toMatchObject({ user: a.id });
	});

	it('keeps the old date with "Ursprüngliches Datum behalten", like the two steps of before', async () => {
		const one = await oneStep('keep');
		const two = await twoSteps('keep');
		expect(facts(one)).toEqual(facts(two));
		expect(dateOf(one.ticket.due)).toBe(OLD_DUE);
	});
});

describe('the notice of an assignment (ADR-0068 §4)', () => {
	it('tells B about a ticket A creates for him, with everything at once', async () => {
		const received = [];
		stops.push(await b.client.realtime.subscribe(TOPIC, (data) => received.push(data)));
		const { ticket, outcome } = await create(a, request({ title: 'Für Bert', assignee: b.id }, { extras: { subtasks: [{ title: 'Teil', priority: 'medium' }] } }), true);
		await until(() => received.some((notice) => notice.ticket === ticket.id), 'notice at B');
		expect(received.find((notice) => notice.ticket === ticket.id)).toMatchObject({ key: ticket.key, by: a.id, by_name: 'Anna Beispiel' });
		expect(ticket.assignedAt).not.toBeNull();
		// The sub-tasks have no assignee, so they tell nobody.
		const subtaskIds = outcome.subtasks.map((child) => child.id);
		expect(received.filter((notice) => subtaskIds.includes(notice.ticket))).toEqual([]);
	});

	it('tells nobody about a ticket A creates for herself', async () => {
		const received = [];
		stops.push(await a.client.realtime.subscribe(TOPIC, (data) => received.push(data)));
		const { ticket } = await create(a, request({ title: 'Für mich', assignee: a.id }), true);
		const marker = await b.ticket({ household: householdId, title: 'Marke' });
		await b.client.collection('tickets').update(marker.id, { assignee: a.id });
		await until(() => received.some((notice) => notice.ticket === marker.id), 'notice of the marker');
		expect(received.some((notice) => notice.ticket === ticket.id)).toBe(false);
	});
});
