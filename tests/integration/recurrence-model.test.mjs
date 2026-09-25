// Recurrence rules through the Record API (E5 plan, package 2; ADR-0021 section 1, ADR-0022
// section 1, ADR-0023 sections 1, 4, 5, 7 and 8): server fields, checks with field codes, the
// template, "Wiederholen…" with a ticket (atomic, also in parallel), tickets.recurrence only
// clearable by clients, the partial index and next_due after edits.

import { beforeAll, describe, expect, it } from 'vitest';
import { pocketBaseUrl, rejectionOf, superuserClient } from '../support/api.mjs';
import { FAIL_TICKET_LINK, createOwner, historyOf, uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { addDays, berlinToday } from '../../web/src/lib/domain/berlin-date.ts';
import { after, onOrAfter, weekdayOf } from '../../web/src/lib/domain/recurrence.ts';

let superuser;
let owner;
let stranger;

const dateOf = (value) => (value ? value.slice(0, 10) : '');
const stored = (date) => `${date} 00:00:00.000Z`;
const today = () => berlinToday(Date.now());

beforeAll(async () => {
	superuser = await superuserClient();
	[owner, stranger] = await Promise.all([createOwner(superuser), createOwner(superuser)]);
});

const rules = () => owner.client.collection('recurrence_rules');
const tickets = () => owner.client.collection('tickets');
const createRule = (data = {}) =>
	rules().create({ owner: owner.id, title: `Regel ${uniqueSuffix()}`, mode: 'calendar', freq: 'weekly', ...data });

async function countRules(title) {
	const found = await superuser
		.collection('recurrence_rules')
		.getFullList({ filter: superuser.filter('title = {:title}', { title }) });
	return found.length;
}

describe('rule fields', () => {
	it('sets scope, defaults and next_due and overwrites the server fields', async () => {
		const now = today();
		const rule = await createRule({
			next_due: '2000-01-03',
			last_generated_at: '2000-01-01 10:00:00.000Z',
			scope: 'u:fremd',
			last_hint: 'vom Client'
		});
		expect(rule).toMatchObject({
			scope: `u:${owner.id}`,
			active: true,
			interval: 1,
			lead_days: 3,
			month_day: 0,
			weekdays: [weekdayOf(now)],
			last_generated_at: '',
			last_hint: ''
		});
		expect(dateOf(rule.anchor)).toBe(now);
		expect(dateOf(rule.next_due)).toBe(now);
	});

	it('keeps an explicit pause and a lead time of 0', async () => {
		const rule = await createRule({ active: false, lead_days: 0 });
		expect(rule.active).toBe(false);
		expect(rule.lead_days).toBe(0);
	});

	it('fills the day of the month from the anchor', async () => {
		const rule = await createRule({ freq: 'monthly', anchor: '2030-01-31' });
		expect(rule.month_day).toBe(31);
		expect(rule.weekdays).toEqual([]);
		expect(dateOf(rule.next_due)).toBe('2030-01-31');
		const last = await createRule({ freq: 'monthly', month_day: -1, anchor: '2030-02-01' });
		expect(dateOf(last.next_due)).toBe('2030-02-28');
	});

	it('lets an after-completion rule without ticket start on its anchor, not before today', async () => {
		const later = await createRule({ mode: 'after_completion', freq: 'daily', interval: 3, anchor: '2030-05-01' });
		expect(dateOf(later.next_due)).toBe('2030-05-01');
		const past = await createRule({ mode: 'after_completion', freq: 'daily', interval: 3, anchor: '2020-05-01' });
		expect(dateOf(past.next_due)).toBe(today());
	});

	it.each([
		['no rhythm', { freq: '' }, { freq: 'validation_recurrence_freq' }],
		['interval 400', { interval: 400 }, { interval: 'validation_recurrence_interval' }],
		['weekdays of a monthly rule', { freq: 'monthly', month_day: 5, weekdays: ['MO'] }, { weekdays: 'validation_recurrence_weekdays_mode' }],
		['day of the month 32', { freq: 'monthly', month_day: 32 }, { month_day: 'validation_recurrence_month_day' }],
		['day of the month -2', { freq: 'monthly', month_day: -2 }, { month_day: 'validation_recurrence_month_day' }],
		['day of the month after completion', { mode: 'after_completion', freq: 'monthly', month_day: 5 }, { month_day: 'validation_recurrence_month_day_mode' }],
		['lead time 31', { lead_days: 31 }, { lead_days: 'validation_recurrence_lead_days' }],
		['no date', { anchor: 'kein Datum' }, { anchor: 'validation_recurrence_anchor' }],
		['impossible date', { anchor: '2026-02-30' }, { anchor: 'validation_recurrence_anchor' }],
		// With weekdays: without a valid anchor there is no weekday to take over.
		['date with time', { anchor: '2026-09-24 10:00:00.000Z', weekdays: ['MO'] }, { anchor: 'validation_recurrence_anchor' }]
	])('rejects %s with a field code', async (_, data, codes) => {
		expect(await rejectionOf(createRule(data))).toEqual({ status: 400, codes });
	});

	it('checks project and tags of the template like tickets', async () => {
		const foreign = await stranger.project(uniqueCode());
		expect(await rejectionOf(createRule({ project: foreign.id }))).toEqual({
			status: 400,
			codes: { project: 'validation_scope_mismatch' }
		});
		const foreignTag = await stranger.tag(`t-${uniqueSuffix()}`);
		expect(await rejectionOf(createRule({ tags: [foreignTag.id] }))).toEqual({
			status: 400,
			codes: { tags: 'validation_scope_mismatch' }
		});
		const archived = await owner.project(uniqueCode(), { archived: true });
		expect(await rejectionOf(createRule({ project: archived.id }))).toEqual({
			status: 400,
			codes: { project: 'validation_project_archived' }
		});
		const project = await owner.project(uniqueCode());
		const tag = await owner.tag(`t-${uniqueSuffix()}`);
		const rule = await createRule({ project: project.id, tags: [tag.id], priority: 'high' });
		expect(rule).toMatchObject({ project: project.id, tags: [tag.id], priority: 'high' });
	});
});

describe('"Wiederholen…": a rule with a ticket (ADR-0023 section 1)', () => {
	it('makes the ticket the current instance and plans the next one after its due date', async () => {
		const ticket = await owner.ticket({ due: '2030-01-07' });
		const rule = await createRule({ weekdays: ['MO'], ticket: ticket.id });
		expect(dateOf(rule.anchor)).toBe('2030-01-07');
		expect(dateOf(rule.next_due)).toBe('2030-01-14');
		const linked = await tickets().getOne(ticket.id);
		expect(linked.recurrence).toBe(rule.id);
		expect(dateOf(linked.due)).toBe('2030-01-07');
		const entries = await historyOf(superuser, ticket.id);
		expect(entries.map(({ field, old_value, new_value, user }) => ({ field, old_value, new_value, user }))).toContainEqual({
			field: 'recurrence',
			old_value: '',
			new_value: rule.id,
			user: owner.id
		});
	});

	it('gives a ticket without due date the first occurrence of a calendar rule', async () => {
		const ticket = await owner.ticket();
		const rule = await createRule({ freq: 'daily', interval: 2, ticket: ticket.id });
		const first = onOrAfter({ mode: 'calendar', freq: 'daily', interval: 2, anchor: today() }, today());
		expect(dateOf((await tickets().getOne(ticket.id)).due)).toBe(first);
		expect(dateOf(rule.next_due)).toBe(after({ mode: 'calendar', freq: 'daily', interval: 2, anchor: today() }, first));
	});

	it('leaves the due date of an after-completion instance and plans nothing yet', async () => {
		const ticket = await owner.ticket();
		const rule = await createRule({ mode: 'after_completion', freq: 'weekly', interval: 2, ticket: ticket.id });
		expect(rule.next_due).toBe('');
		const linked = await tickets().getOne(ticket.id);
		expect(linked.due).toBe('');
		expect(linked.recurrence).toBe(rule.id);
	});

	it('rejects a foreign, a done and a linked ticket and creates no rule', async () => {
		const title = `Abgelehnt ${uniqueSuffix()}`;
		const foreign = await stranger.ticket();
		expect(await rejectionOf(createRule({ title, ticket: foreign.id }))).toEqual({
			status: 400,
			codes: { ticket: 'validation_recurrence_ticket_missing' }
		});
		expect(await rejectionOf(createRule({ title, ticket: 'abcdefghijklmno' }))).toEqual({
			status: 400,
			codes: { ticket: 'validation_recurrence_ticket_missing' }
		});
		expect(await rejectionOf(createRule({ title, ticket: 42 }))).toEqual({
			status: 400,
			codes: { ticket: 'validation_recurrence_ticket_missing' }
		});
		const done = await owner.ticket({ status: 'done' });
		expect(await rejectionOf(createRule({ title, ticket: done.id }))).toEqual({
			status: 400,
			codes: { ticket: 'validation_recurrence_ticket_done' }
		});
		const linked = await owner.ticket();
		await createRule({ ticket: linked.id });
		expect(await rejectionOf(createRule({ title, ticket: linked.id }))).toEqual({
			status: 400,
			codes: { ticket: 'validation_recurrence_ticket_linked' }
		});
		expect(await countRules(title)).toBe(0);
	});

	it('writes the rule and the link together or not at all', async () => {
		const title = `Rollback ${uniqueSuffix()}`;
		const ticket = await owner.ticket({ title: FAIL_TICKET_LINK });
		expect((await rejectionOf(createRule({ title, ticket: ticket.id }))).status).toBe(400);
		expect(await countRules(title)).toBe(0);
		expect((await tickets().getOne(ticket.id)).recurrence).toBe('');
	});

	it('lets exactly one of five parallel requests link the same ticket', async () => {
		const title = `Parallel ${uniqueSuffix()}`;
		const ticket = await owner.ticket();
		const results = await Promise.allSettled(Array.from({ length: 5 }, () => createRule({ title, ticket: ticket.id })));
		const created = results.filter((result) => result.status === 'fulfilled');
		expect(created).toHaveLength(1);
		for (const result of results.filter((item) => item.status === 'rejected')) {
			expect(result.reason.status).toBe(400);
			expect(result.reason.response.data.ticket.code).toBe('validation_recurrence_ticket_linked');
		}
		expect(await countRules(title)).toBe(1);
		expect((await tickets().getOne(ticket.id)).recurrence).toBe(created[0].value.id);
	});
});

describe('tickets.recurrence', () => {
	it('is never set by a client, only cleared', async () => {
		const rule = await createRule();
		expect(await rejectionOf(owner.ticket({ recurrence: rule.id }))).toEqual({
			status: 400,
			codes: { recurrence: 'validation_recurrence_managed' }
		});
		const ticket = await owner.ticket();
		expect(await rejectionOf(tickets().update(ticket.id, { recurrence: rule.id }))).toEqual({
			status: 400,
			codes: { recurrence: 'validation_recurrence_managed' }
		});
		const linkedRule = await createRule({ ticket: ticket.id });
		expect(await rejectionOf(tickets().update(ticket.id, { recurrence: rule.id }))).toEqual({
			status: 400,
			codes: { recurrence: 'validation_recurrence_managed' }
		});
		// Unrelated edits keep the link; clearing it is allowed.
		expect((await tickets().update(ticket.id, { title: 'Weiter in der Serie' })).recurrence).toBe(linkedRule.id);
		expect((await tickets().update(ticket.id, { recurrence: '' })).recurrence).toBe('');
	});

	it('has at most one open instance per rule, enforced by the partial index', async () => {
		const first = await owner.ticket();
		const rule = await createRule({ ticket: first.id });
		const second = await owner.ticket();
		const done = await owner.ticket({ status: 'done' });
		const link = (ticket) =>
			fetch(`${pocketBaseUrl()}/api/byl-test/tickets/${ticket.id}/link`, {
				method: 'POST',
				headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
				body: JSON.stringify({ rule: rule.id })
			});
		const refused = await link(second);
		expect(refused.status).toBe(400);
		// PocketBase reports the violated unique index as a field error of `recurrence`.
		expect((await refused.json()).error).toMatch(/recurrence: Value must be unique/);
		expect((await link(done)).status).toBe(200);
		// Once the open instance is done, another ticket may become the open one.
		await tickets().update(first.id, { status: 'done' });
		expect((await link(second)).status).toBe(200);
	});
});

describe('editing a rule (ADR-0023 sections 4, 5 and 8)', () => {
	it('keeps next_due for the template, a pause and client values, and recomputes it for a new rhythm', async () => {
		const now = today();
		// Paused, so that no ticket is generated in between (package 3) and next_due stays computed.
		const rule = await createRule({ weekdays: ['MO'], anchor: '2026-01-05', active: false });
		const monday = onOrAfter({ mode: 'calendar', freq: 'weekly', weekdays: ['MO'], anchor: '2026-01-05' }, now);
		expect(dateOf(rule.next_due)).toBe(monday);

		const renamed = await rules().update(rule.id, { title: 'Neuer Titel', lead_days: 10, next_due: '2001-01-01' });
		expect(dateOf(renamed.next_due)).toBe(monday);
		expect(renamed.lead_days).toBe(10);

		const thursday = await rules().update(rule.id, { weekdays: ['TH'] });
		expect(dateOf(thursday.next_due)).toBe(
			onOrAfter({ mode: 'calendar', freq: 'weekly', weekdays: ['TH'], anchor: '2026-01-05' }, now)
		);

		// A running rule far ahead: pausing keeps its date.
		const ahead = await createRule({ weekdays: ['MO'], anchor: '2031-01-06', lead_days: 0 });
		expect(dateOf(ahead.next_due)).toBe('2031-01-06');
		const paused = await rules().update(ahead.id, { active: false });
		expect(paused.active).toBe(false);
		expect(paused.next_due).toBe(ahead.next_due);
	});

	it('does not catch up a pause when resuming', async () => {
		const now = today();
		const rule = await createRule({ freq: 'daily', active: false });
		// A pause of three weeks: next_due lies in the past.
		await superuser.collection('recurrence_rules').update(rule.id, { next_due: addDays(now, -21) });
		expect(dateOf((await rules().getOne(rule.id)).next_due)).toBe(addDays(now, -21));
		const resumed = await rules().update(rule.id, { active: true });
		expect(dateOf(resumed.next_due)).toBe(now);
	});

	it('recomputes the next ticket after the open instance', async () => {
		const ticket = await owner.ticket({ due: '2030-01-07' });
		const rule = await createRule({ weekdays: ['MO'], ticket: ticket.id });
		const changed = await rules().update(rule.id, { weekdays: ['WE'] });
		expect(dateOf(changed.next_due)).toBe('2030-01-09');
		const completion = await rules().update(rule.id, { mode: 'after_completion', weekdays: [] });
		expect(completion.next_due).toBe('');
	});

	it('refuses to resume a rule whose project is archived until the project changes', async () => {
		const project = await owner.project(uniqueCode());
		const rule = await createRule({ project: project.id, active: false });
		await owner.client.collection('projects').update(project.id, { archived: true });
		expect(await rejectionOf(rules().update(rule.id, { active: true }))).toEqual({
			status: 400,
			codes: { project: 'validation_project_archived' }
		});
		// Other edits of the paused rule still work.
		expect((await rules().update(rule.id, { title: 'Pausiert' })).title).toBe('Pausiert');
		const resumed = await rules().update(rule.id, { active: true, project: '' });
		expect(resumed.active).toBe(true);
	});

	it('clears the hint when a paused rule is resumed', async () => {
		const rule = await createRule({ active: false });
		await superuser.collection('recurrence_rules').update(rule.id, { last_hint: 'Projekt archiviert – Regel pausiert.' });
		const edited = await rules().update(rule.id, { title: 'Noch pausiert' });
		expect(edited.last_hint).toBe('Projekt archiviert – Regel pausiert.');
		expect((await rules().update(rule.id, { active: true })).last_hint).toBe('');
	});
});

describe('deleting a rule (ADR-0023 section 7, OF-E5-4)', () => {
	it('leaves its tickets as normal tickets and records the removed series', async () => {
		const ticket = await owner.ticket();
		const rule = await createRule({ ticket: ticket.id });
		await rules().delete(rule.id);
		const plain = await tickets().getOne(ticket.id);
		expect(plain.recurrence).toBe('');
		const entries = await historyOf(superuser, ticket.id);
		expect(entries.at(-1)).toMatchObject({ field: 'recurrence', old_value: rule.id, new_value: '' });
	});
});

describe('stored dates', () => {
	it('keeps the anchor as a pure calendar date', async () => {
		const rule = await createRule({ anchor: '2030-03-04' });
		expect(rule.anchor).toBe(stored('2030-03-04'));
	});
});
