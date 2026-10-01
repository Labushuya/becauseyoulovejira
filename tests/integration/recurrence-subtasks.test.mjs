// Sub-tasks in the template of a rule (plan "Wiederholungen: Werte von Folgetickets", WV-3;
// ADR-0022 addendum 10, ADR-0023 addendum 8) against an own disposable PocketBase: the hook checks
// the list, every new ticket of a series gets its entries as new, open sub-tasks in the transaction
// of the ticket (also with "Jeden Termin einzeln anlegen" and for a catch-up ticket), and reopening
// the direct predecessor removes an untouched follow-up with its sub-tasks, while any change of
// the user to them keeps it. The clock of a run comes through the test route
// POST /api/byl-test/recurrence/run (tests/fixtures/pb_hooks/recurrence-clock.pb.js).

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { FAIL_TICKET_INSERT, uniqueCode } from '../support/scenario.mjs';
import { berlinToday } from '../../web/src/lib/domain/berlin-date.ts';

let instance;
let superuser;
let owner;

const unique = () => randomBytes(6).toString('hex');
const dateOf = (value) => (value ? value.slice(0, 10) : '');
const today = () => berlinToday(Date.now());

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	const email = `user-${unique()}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	owner = { id: record.id, pb };
}, 60_000);

afterAll(async () => {
	await instance?.stop();
});

// Every test leaves its rules paused, so a later run with another clock does not touch them.
afterEach(async () => {
	const active = await superuser.collection('recurrence_rules').getFullList({ filter: 'active = true' });
	for (const rule of active) await superuser.collection('recurrence_rules').update(rule.id, { active: false });
});

const rules = () => owner.pb.collection('recurrence_rules');
const tickets = () => owner.pb.collection('tickets');
const createRule = (data = {}) =>
	rules().create({
		owner: owner.id,
		title: `Regel ${unique()}`,
		mode: 'calendar',
		freq: 'daily',
		lead_days: 0,
		initial_status: 'open',
		...data
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

async function refusal(promise) {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('expected a refusal');
}

const instancesOf = (ruleId) =>
	superuser
		.collection('tickets')
		.getFullList({ filter: superuser.filter('recurrence = {:rule}', { rule: ruleId }), sort: 'created,id' });
const openOf = async (ruleId) => (await instancesOf(ruleId)).filter((ticket) => ticket.status !== 'done');
const childrenOf = (ticketId) =>
	superuser
		.collection('tickets')
		.getFullList({ filter: superuser.filter('parent = {:id}', { id: ticketId }), sort: 'created,id' });
const ruleOf = (ruleId) => superuser.collection('recurrence_rules').getOne(ruleId);
const historyOf = (ticketId) =>
	superuser
		.collection('ticket_history')
		.getFullList({ filter: superuser.filter('ticket = {:id}', { id: ticketId }), sort: 'created,id' });
const titles = (list) => list.map((ticket) => ticket.title);
const gone = (id) => expect(superuser.collection('tickets').getOne(id)).rejects.toMatchObject({ status: 404 });

describe('the list "Unteraufgaben" of the template (plan WV-3)', () => {
	it('stores the sub-tasks normalized: titles trimmed, "medium" without a priority, nothing else', async () => {
		const rule = await createRule({
			anchor: '2050-01-01',
			template_subtasks: [
				{ title: '  Filter wechseln ', priority: 'high', extra: 'weg' },
				{ title: 'Deckel putzen' }
			]
		});
		expect(rule.template_subtasks).toEqual([
			{ title: 'Filter wechseln', priority: 'high' },
			{ title: 'Deckel putzen', priority: 'medium' }
		]);
		// Without the field the list is empty; null and an empty list mean the same.
		const plain = await createRule({ anchor: '2050-01-01' });
		expect(plain.template_subtasks).toEqual([]);
		expect((await rules().update(rule.id, { template_subtasks: null })).template_subtasks).toEqual([]);
		// Exactly 20, a title of 200 characters (also as code points outside the BMP) are fine.
		const twenty = Array.from({ length: 20 }, (_entry, index) => ({ title: `Schritt ${index + 1}`, priority: 'low' }));
		expect((await rules().update(rule.id, { template_subtasks: twenty })).template_subtasks).toHaveLength(20);
		const long = [{ title: 'x'.repeat(200) }, { title: '🧹'.repeat(200), priority: 'urgent' }];
		expect((await rules().update(rule.id, { template_subtasks: long })).template_subtasks).toEqual([
			{ title: 'x'.repeat(200), priority: 'medium' },
			{ title: '🧹'.repeat(200), priority: 'urgent' }
		]);
	});

	it('refuses more than 20, an entry without a title, a long title and an unknown priority, for every writer', async () => {
		const rule = await createRule({ anchor: '2050-01-01', template_subtasks: [{ title: 'Bleibt' }] });
		const cases = [
			[
				Array.from({ length: 21 }, (_entry, index) => ({ title: `Schritt ${index + 1}` })),
				{ code: 'validation_recurrence_subtasks_max', message: 'Die Vorlage hat höchstens 20 Unteraufgaben.' }
			],
			[
				[{ title: 'Gut' }, { title: '   ', priority: 'low' }],
				{
					code: 'validation_recurrence_subtask_title',
					message: 'Jede Unteraufgabe der Vorlage braucht einen Titel.',
					params: { index: 1 }
				}
			],
			[
				[{ priority: 'low' }],
				{ code: 'validation_recurrence_subtask_title', params: { index: 0 } }
			],
			[
				[{ title: 'x'.repeat(201) }],
				{
					code: 'validation_recurrence_subtask_title_max',
					message: 'Der Titel einer Unteraufgabe hat höchstens 200 Zeichen.',
					params: { index: 0 }
				}
			],
			[
				[{ title: 'Gut', priority: 'sofort' }],
				{
					code: 'validation_recurrence_subtask_priority',
					message: 'Bitte für jede Unteraufgabe eine gültige Priorität wählen.',
					params: { index: 0 }
				}
			],
			[
				{ title: 'Kein Liste' },
				{ code: 'validation_recurrence_subtasks', message: 'Die Unteraufgaben der Vorlage sind ungültig.' }
			],
			[['Nur Text'], { code: 'validation_recurrence_subtasks', params: { index: 0 } }]
		];
		for (const [value, expected] of cases) {
			for (const attempt of [
				() => createRule({ anchor: '2050-01-01', template_subtasks: value }),
				() => rules().update(rule.id, { template_subtasks: value }),
				// The server checks it for a superuser as well (the admin UI is no way around it).
				() => superuser.collection('recurrence_rules').update(rule.id, { template_subtasks: value })
			]) {
				const error = await refusal(attempt());
				expect(error.status, JSON.stringify(value)).toBe(400);
				expect(error.response.data.template_subtasks).toMatchObject(expected);
			}
		}
		expect((await ruleOf(rule.id)).template_subtasks).toEqual([{ title: 'Bleibt', priority: 'medium' }]);
	});
});

describe('generation with the sub-tasks of the template (ADR-0022 addendum 10)', () => {
	it('gives the new ticket the sub-tasks as new, open sub-tasks in its transaction, untouched', async () => {
		const code = uniqueCode();
		const project = await owner.pb.collection('projects').create({ owner: owner.id, name: 'Haus', code });
		const tag = await owner.pb.collection('tags').create({ owner: owner.id, name: `t-${unique()}` });
		const rule = await createRule({
			title: 'Kaffeemaschine pflegen',
			project: project.id,
			tags: [tag.id],
			priority: 'low',
			initial_status: 'waiting',
			freq: 'weekly',
			weekdays: ['MO'],
			anchor: '2050-03-07',
			lead_days: 2,
			template_subtasks: [
				{ title: 'Entkalken', priority: 'high' },
				{ title: 'Filter wechseln', priority: 'medium' },
				{ title: 'Deckel putzen', priority: 'urgent' }
			]
		});
		expect((await run('2050-03-05T12:00:00Z')).tickets).toBe(1);

		const [ticket] = await instancesOf(rule.id);
		expect(ticket).toMatchObject({ key: `${code}-1`, status: 'waiting', priority: 'low' });
		const children = await childrenOf(ticket.id);
		// In the order of the template, each a ticket of its own with the next keys.
		expect(children.map(({ title, priority, key }) => ({ title, priority, key }))).toEqual([
			{ title: 'Entkalken', priority: 'high', key: `${code}-2` },
			{ title: 'Filter wechseln', priority: 'medium', key: `${code}-3` },
			{ title: 'Deckel putzen', priority: 'urgent', key: `${code}-4` }
		]);
		for (const child of children) {
			// Open, without a due date and a series, blocking (the default), project and tags of the ticket.
			expect(child).toMatchObject({
				status: 'open',
				due: '',
				completed_at: '',
				description: '',
				parent: ticket.id,
				blocks_parent: true,
				recurrence: '',
				occurrence: '',
				project: project.id,
				tags: [tag.id],
				owner: owner.id,
				household: ''
			});
			expect(child.updated).toBe(child.created);
			// Made by the rule: the history names "Wiederholung" as their author (no user, the rule).
			expect((await historyOf(child.id)).map(({ field, old_value, new_value, user }) => ({ field, old_value, new_value, user }))).toEqual([
				{ field: 'created', old_value: rule.id, new_value: child.key, user: '' }
			]);
		}
		// The ticket stays untouched; its note names the sub-tasks the generation made.
		expect(ticket.updated).toBe(ticket.created);
		const history = await historyOf(ticket.id);
		expect(history.map(({ field, user }) => ({ field, user }))).toEqual([
			{ field: 'created', user: '' },
			{ field: 'recurrence_subtasks', user: '' }
		]);
		const note = history[1];
		expect(note.old_value).toBe(rule.id);
		expect(JSON.parse(note.new_value)).toEqual({ count: 3, tickets: children.map((child) => child.id) });
	});

	it('changes only the next tickets: the open ticket keeps its sub-tasks', async () => {
		const rule = await createRule({ anchor: '2050-04-01', template_subtasks: [{ title: 'Alt' }] });
		await run('2050-04-01T12:00:00Z');
		const [first] = await openOf(rule.id);
		await rules().update(rule.id, { template_subtasks: [{ title: 'Neu A' }, { title: 'Neu B', priority: 'low' }] });
		expect(titles(await childrenOf(first.id))).toEqual(['Alt']);

		await tickets().update(first.id, { status: 'done', complete_children: true });
		await run('2050-04-02T12:00:00Z');
		const [second] = await openOf(rule.id);
		expect(titles(await childrenOf(second.id))).toEqual(['Neu A', 'Neu B']);
		// An empty list: the next ticket has none and no note.
		await rules().update(rule.id, { template_subtasks: [] });
		await tickets().update(second.id, { status: 'done', complete_children: true });
		await run('2050-04-03T12:00:00Z');
		const [third] = await openOf(rule.id);
		expect(await childrenOf(third.id)).toEqual([]);
		expect((await historyOf(third.id)).map((entry) => entry.field)).toEqual(['created']);
	});

	it('gives every date its sub-tasks with "Jeden Termin einzeln anlegen", still at most 20 tickets per run', async () => {
		// 19 dates before the run and 4 in the lead time: 20 now, 3 in the next run.
		const rule = await createRule({
			anchor: '2050-05-01',
			lead_days: 3,
			each_occurrence: true,
			template_subtasks: [{ title: 'Gießen', priority: 'high' }]
		});
		const first = await run('2050-05-20T12:00:00Z');
		expect(first.tickets).toBe(20);
		let open = await openOf(rule.id);
		expect(open).toHaveLength(20);
		expect((await ruleOf(rule.id)).last_hint).toBe(
			'Viele Termine auf einmal: 20 Tickets angelegt, die übrigen folgen beim nächsten Lauf (stündlich).'
		);
		const second = await run('2050-05-20T12:00:00Z');
		expect(second.tickets).toBe(3);
		open = await openOf(rule.id);
		expect(open.map((ticket) => dateOf(ticket.occurrence)).sort()[22]).toBe('2050-05-23');
		for (const ticket of open) {
			const children = await childrenOf(ticket.id);
			expect(children.map(({ title, priority, status }) => ({ title, priority, status }))).toEqual([
				{ title: 'Gießen', priority: 'high', status: 'open' }
			]);
			// The sub-task belongs to no series and has no date of the series.
			expect(children[0]).toMatchObject({ recurrence: '', occurrence: '' });
		}
	}, 60_000);

	it('gives the one catch-up ticket of missed dates the sub-tasks', async () => {
		const rule = await createRule({ anchor: '2050-06-01', template_subtasks: [{ title: 'Lüften' }] });
		await run('2050-06-01T10:00:00Z');
		const [first] = await openOf(rule.id);
		await tickets().update(first.id, { status: 'done', complete_children: true });

		await run('2050-06-05T10:00:00Z');
		const [caught] = await openOf(rule.id);
		expect(dateOf(caught.due)).toBe('2050-06-05');
		expect(titles(await childrenOf(caught.id))).toEqual(['Lüften']);
		const fields = (await historyOf(caught.id)).map((entry) => entry.field);
		expect(fields.sort()).toEqual(['created', 'recurrence_skipped', 'recurrence_subtasks']);
		expect(caught.updated).toBe(caught.created);
	});

	it('rolls the ticket back with a failing sub-task: no ticket, no number, the rule as before', async () => {
		const counterKey = `u:${owner.id}:TASK`;
		const counter = async () => {
			const found = await superuser
				.collection('ticket_counters')
				.getFullList({ filter: superuser.filter('key = {:key}', { key: counterKey }) });
			return found.length === 0 ? 0 : found[0].value;
		};
		const title = `Atomar ${unique()}`;
		const rule = await createRule({
			title,
			anchor: '2050-07-01',
			template_subtasks: [{ title: 'Kommt zuerst' }, { title: FAIL_TICKET_INSERT }]
		});
		const before = await counter();

		const result = await run('2050-07-01T12:00:00Z');
		expect(result).toMatchObject({ created: 0, failed: 1, tickets: 0 });
		expect(await instancesOf(rule.id)).toEqual([]);
		const strays = await superuser
			.collection('tickets')
			.getFullList({ filter: superuser.filter('title = {:a} || title = {:b}', { a: title, b: 'Kommt zuerst' }) });
		expect(strays).toEqual([]);
		expect(await counter()).toBe(before);
		const stored = await ruleOf(rule.id);
		expect(stored.active).toBe(true);
		expect(dateOf(stored.next_due)).toBe('2050-07-01');
		expect(stored.last_hint).toMatch(/^Ticket nicht erzeugt: /);
	});
});

describe('reopening with sub-tasks from the template (ADR-0023 section 3, addendum 8)', () => {
	/** A rule after completion with its first ticket done and the follow-up made at once. */
	async function followUpWithSubtasks() {
		const rule = await createRule({
			mode: 'after_completion',
			interval: 1,
			lead_days: 3,
			anchor: today(),
			template_subtasks: [{ title: 'Erster Schritt', priority: 'high' }, { title: 'Zweiter Schritt' }]
		});
		const [first] = await instancesOf(rule.id);
		await tickets().update(first.id, { status: 'done', complete_children: true });
		const followUp = (await openOf(rule.id))[0];
		const children = await childrenOf(followUp.id);
		expect(titles(children)).toEqual(['Erster Schritt', 'Zweiter Schritt']);
		return { rule, first, followUp, children };
	}

	it('removes an untouched follow-up together with its sub-tasks; looking at them changes nothing', async () => {
		const { rule, first, followUp, children } = await followUpWithSubtasks();
		// Opening the tickets marks them as read; that is no change of a ticket.
		for (const ticket of [followUp, ...children]) {
			await owner.pb.collection('ticket_reads').create({ user: owner.id, ticket: ticket.id, seen_at: new Date().toISOString() });
		}

		const reopened = await tickets().update(first.id, { status: 'open' });
		expect(reopened.status).toBe('open');
		await gone(followUp.id);
		for (const child of children) await gone(child.id);
		expect((await instancesOf(rule.id)).map((ticket) => ticket.id)).toEqual([first.id]);
		expect((await ruleOf(rule.id)).next_due).toBe('');
	});

	it('keeps a follow-up whose sub-tasks the user changed, commented, completed, removed, moved out or added to', async () => {
		const touches = {
			title: ({ children }) => tickets().update(children[0].id, { title: 'Umbenannt' }),
			done: ({ children }) => tickets().update(children[1].id, { status: 'done' }),
			priority: ({ children }) => tickets().update(children[1].id, { priority: 'urgent' }),
			comment: ({ children }) =>
				owner.pb.collection('comments').create({ ticket: children[0].id, author: owner.id, body: 'Notiz' }),
			trash: ({ children }) => tickets().delete(children[1].id),
			detach: ({ children }) => tickets().update(children[0].id, { parent: '' }),
			added: ({ followUp }) => tickets().create({ owner: owner.id, title: 'Von Hand', parent: followUp.id })
		};
		for (const [name, touch] of Object.entries(touches)) {
			const series = await followUpWithSubtasks();
			await touch(series);
			// The follow-up itself is unchanged; its sub-tasks are not.
			expect((await tickets().getOne(series.followUp.id)).updated, name).toBe(series.followUp.updated);

			const error = await refusal(tickets().update(series.first.id, { status: 'open' }));
			expect(error.status, name).toBe(400);
			expect(error.response.data.status).toMatchObject({
				code: 'validation_recurrence_open_instance',
				params: { key: series.followUp.key, ticket: series.followUp.id }
			});
			expect((await tickets().getOne(series.first.id)).status, name).toBe('done');
			expect((await openOf(series.rule.id)).map((ticket) => ticket.id), name).toEqual([series.followUp.id]);
		}
	}, 60_000);
});

describe('duplicating a ticket of a series with sub-tasks from the template (ADR-0045)', () => {
	it('never takes the series along; the sub-tasks come only as chosen, as normal sub-tasks', async () => {
		const rule = await createRule({ anchor: '2050-08-01', template_subtasks: [{ title: 'Einkaufen' }] });
		await run('2050-08-01T12:00:00Z');
		const [instance] = await openOf(rule.id);

		const copy = await owner.pb.send(`/api/byl/tickets/${instance.id}/duplicate`, {
			method: 'POST',
			body: {
				title: 'Kopie',
				status: 'open',
				source: 'none',
				description: false,
				priority: false,
				tags: false,
				due: false,
				parent: false,
				subtasks: true,
				comments: false
			}
		});
		const duplicate = await superuser.collection('tickets').getOne(copy.id);
		expect(duplicate.recurrence).toBe('');
		expect(titles(await childrenOf(copy.id))).toEqual(['Einkaufen']);
		expect((await openOf(rule.id)).map((ticket) => ticket.id)).toEqual([instance.id]);
		expect(titles(await childrenOf(instance.id))).toEqual(['Einkaufen']);
	});
});
