// WH-1 "Wiederholungen: nur das aktuelle Vorkommen zählt" (ADR-0022 addendum 13, ADR-0023 addendum 9,
// ADR-0065 addendum WH-1) against an own disposable PocketBase. Without "Verpasste Termine
// nachholen" a series has at most one open occurrence; left lying, it is carried along and says
// "überfällig seit <its date>"; only its completion makes the next one, for the first regular date
// after the Berlin day of the completion, never one in the past; the dates passed meanwhile count as
// skipped (history entry recurrence_skipped at the completed ticket). The day plan proposes a series
// at most once. With the switch every date keeps its own ticket, and every one counts.
//
// The dates are relative to the Berlin "today" of the machine: completing, reopening, releasing and
// deleting run with the real clock like the app (as in recurrence-generate.test.mjs), the runs of the
// generation with the clock of the test route POST /api/byl-test/recurrence/run. Rules start paused,
// and the superuser sets next_due into the past (a write of the server: nothing is made at once).

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { addDays, berlinToday } from '../../web/src/lib/domain/berlin-date.ts';
import { after, weekdayOf } from '../../web/src/lib/domain/recurrence.ts';
import { shortDate } from '../../web/src/lib/domain/recurrence-text.ts';

let instance;
let superuser;
let owner;

const unique = () => randomBytes(6).toString('hex');
const dateOf = (value) => (value ? value.slice(0, 10) : '');
const stored = (date) => `${date} 00:00:00.000Z`;
const today = () => berlinToday(Date.now());
/** Noon UTC of a Berlin date: the same calendar day in Berlin in summer and in winter. */
const noon = (date) => `${date}T12:00:00Z`;

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
});

afterAll(async () => {
	await instance?.stop();
});

// Every test leaves its rules paused, so a later run with another clock does not touch them.
afterEach(async () => {
	const active = await superuser.collection('recurrence_rules').getFullList({ filter: 'active = true' });
	for (const rule of active) await superuser.collection('recurrence_rules').update(rule.id, { active: false });
});

const tickets = () => owner.pb.collection('tickets');

async function run(iso) {
	const response = await fetch(`${instance.url}/api/byl-test/recurrence/run`, {
		method: 'POST',
		headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ now: Date.parse(iso) })
	});
	expect(response.status).toBe(200);
	return response.json();
}

const instancesOf = (ruleId) =>
	superuser
		.collection('tickets')
		.getFullList({ filter: superuser.filter('recurrence = {:rule}', { rule: ruleId }), sort: 'created,id' });
const openOf = async (ruleId) => (await instancesOf(ruleId)).filter((ticket) => ticket.status !== 'done');
const ruleOf = (ruleId) => superuser.collection('recurrence_rules').getOne(ruleId);
const historyOf = (ticketId) =>
	superuser
		.collection('ticket_history')
		.getFullList({ filter: superuser.filter('ticket = {:id}', { id: ticketId }), sort: 'created,id' });
const skippedOf = async (ticketId) =>
	(await historyOf(ticketId))
		.filter((entry) => entry.field === 'recurrence_skipped')
		.map((entry) => ({ rule: entry.old_value, user: entry.user, skipped: JSON.parse(entry.new_value) }));
const suggestionsOf = async () =>
	(await owner.pb.send('/api/byl/dayplan', { method: 'GET', requestKey: null })).suggestions;

/**
 * A rule of the owner with its first occurrence on `first` (a date before today): made paused, then
 * next_due set by the superuser and the occurrence made by a run on that day. Returns the rule, its
 * parameters (for the expected dates) and the occurrence.
 */
async function overdueSeries(params, first, extra = {}) {
	const rule = await owner.pb.collection('recurrence_rules').create({
		owner: owner.id,
		title: `Spülmaschine ${unique()}`,
		mode: 'calendar',
		anchor: addDays(first, -60),
		initial_status: 'open',
		active: false,
		...params,
		...extra
	});
	await superuser.collection('recurrence_rules').update(rule.id, { active: true, next_due: stored(first) });
	expect((await run(noon(first))).created).toBe(1);
	const [occurrence] = await openOf(rule.id);
	expect(dateOf(occurrence.due)).toBe(first);
	const rhythm = { mode: params.mode ?? 'calendar', interval: 1, anchor: addDays(first, -60), ...params };
	return { rule, rhythm, occurrence };
}

describe('fixed rhythm without "Verpasste Termine nachholen" (target model 1 to 3)', () => {
	it('daily: left for days it stays the only one, overdue since its date; done today, the next is due tomorrow', async () => {
		const day = today();
		const first = addDays(day, -10);
		const { rule, occurrence } = await overdueSeries({ freq: 'daily', lead_days: 1 }, first);

		// The runs of the days after make nothing: the one occurrence is carried along.
		for (const offset of [-9, -5, -1, 0]) expect((await run(noon(addDays(day, offset)))).created).toBe(0);
		expect((await openOf(rule.id)).map((ticket) => ticket.id)).toEqual([occurrence.id]);
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe(addDays(first, 1));

		// The day plan proposes it once, overdue since its date.
		const before = (await suggestionsOf()).filter((suggestion) => suggestion.id === occurrence.id);
		expect(before).toHaveLength(1);
		expect(before[0].reasons).toContain(`überfällig seit ${shortDate(first, day)}`);

		// Done today: the next occurrence is due tomorrow (lead time 1: it is there at once).
		await tickets().update(occurrence.id, { status: 'done' });
		const open = await openOf(rule.id);
		expect(open).toHaveLength(1);
		expect(dateOf(open[0].due)).toBe(addDays(day, 1));
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe(addDays(day, 2));
		// The dates passed while it was open count as skipped, noted at the completed ticket without a
		// user ("Wiederholung"); the next ticket names none.
		expect(await skippedOf(occurrence.id)).toEqual([
			{
				rule: rule.id,
				user: '',
				skipped: { count: 9, dates: [1, 2, 3, 4, 5].map((offset) => addDays(first, offset)), more: false }
			}
		]);
		expect(await skippedOf(open[0].id)).toEqual([]);
		// Nothing of the series is proposed today any more.
		const ids = (await instancesOf(rule.id)).map((ticket) => ticket.id);
		expect((await suggestionsOf()).filter((suggestion) => ids.includes(suggestion.id))).toEqual([]);
	});

	it('weekly: done two days after its weekday, the next is the coming weekday, never one in the past', async () => {
		const day = today();
		const first = addDays(day, -9);
		const params = { freq: 'weekly', weekdays: [weekdayOf(first)], lead_days: 7 };
		const { rule, rhythm, occurrence } = await overdueSeries(params, first);
		const coming = after(rhythm, day);
		expect(coming).toBe(addDays(day, 5));

		await tickets().update(occurrence.id, { status: 'done' });
		const open = await openOf(rule.id);
		expect(open.map((ticket) => dateOf(ticket.due))).toEqual([coming]);
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe(addDays(coming, 7));
		// The weekday two days ago passed while the ticket was open.
		expect((await skippedOf(occurrence.id)).map((note) => note.skipped)).toEqual([
			{ count: 1, dates: [addDays(day, -2)], more: false }
		]);
	});

	it('done on the day of a regular date: the next is the date after it, and that day is not skipped', async () => {
		const day = today();
		const first = addDays(day, -7);
		const params = { freq: 'weekly', weekdays: [weekdayOf(day)], lead_days: 7 };
		const { rule, occurrence } = await overdueSeries(params, first);

		await tickets().update(occurrence.id, { status: 'done' });
		expect((await openOf(rule.id)).map((ticket) => dateOf(ticket.due))).toEqual([addDays(day, 7)]);
		expect(await skippedOf(occurrence.id)).toEqual([]);
	});

	it('done early: the next stays the date after its own', async () => {
		const day = today();
		const rule = await owner.pb.collection('recurrence_rules').create({
			owner: owner.id,
			title: `Früh ${unique()}`,
			mode: 'calendar',
			freq: 'daily',
			anchor: addDays(day, -30),
			lead_days: 3,
			initial_status: 'open',
			active: false
		});
		await superuser.collection('recurrence_rules').update(rule.id, { active: true, next_due: stored(addDays(day, 2)) });
		expect((await run(noon(day))).created).toBe(1);
		const [occurrence] = await openOf(rule.id);
		expect(dateOf(occurrence.due)).toBe(addDays(day, 2));

		await tickets().update(occurrence.id, { status: 'done' });
		expect((await openOf(rule.id)).map((ticket) => dateOf(ticket.due))).toEqual([addDays(day, 3)]);
		expect(await skippedOf(occurrence.id)).toEqual([]);
	});
});

describe('"Verpasste Termine nachholen" (each_occurrence, target model 4: unchanged)', () => {
	it('keeps one ticket per date; every one counts and is proposed; completing one makes nothing new', async () => {
		const day = today();
		const rule = await owner.pb.collection('recurrence_rules').create({
			owner: owner.id,
			title: `Miete ${unique()}`,
			mode: 'calendar',
			freq: 'daily',
			anchor: addDays(day, -30),
			lead_days: 0,
			each_occurrence: true,
			initial_status: 'open',
			active: false
		});
		await superuser.collection('recurrence_rules').update(rule.id, { active: true, next_due: stored(addDays(day, -3)) });
		expect((await run(noon(day))).tickets).toBe(4);
		const open = await openOf(rule.id);
		expect(open.map((ticket) => dateOf(ticket.due))).toEqual([-3, -2, -1, 0].map((offset) => addDays(day, offset)));

		const proposed = (await suggestionsOf()).filter((suggestion) => open.some((ticket) => ticket.id === suggestion.id));
		expect(proposed).toHaveLength(4);

		await tickets().update(open[0].id, { status: 'done' });
		expect((await openOf(rule.id)).map((ticket) => ticket.id)).toEqual(open.slice(1).map((ticket) => ticket.id));
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe(addDays(day, 1));
		expect(await skippedOf(open[0].id)).toEqual([]);
	});
});

describe('"Nach Erledigung" (unchanged)', () => {
	it('counts from the day of the completion', async () => {
		const day = today();
		const rule = await owner.pb.collection('recurrence_rules').create({
			owner: owner.id,
			title: `Filter ${unique()}`,
			mode: 'after_completion',
			freq: 'daily',
			interval: 2,
			anchor: addDays(day, -30),
			lead_days: 0,
			initial_status: 'open',
			active: false
		});
		await superuser.collection('recurrence_rules').update(rule.id, { active: true, next_due: stored(addDays(day, -5)) });
		expect((await run(noon(addDays(day, -5)))).created).toBe(1);
		const [occurrence] = await openOf(rule.id);

		await tickets().update(occurrence.id, { status: 'done' });
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe(addDays(day, 2));
		expect(await openOf(rule.id)).toEqual([]);
		expect(await skippedOf(occurrence.id)).toEqual([]);
	});
});

describe('edge cases', () => {
	it('sub-tasks of the template: the next ticket gets them; reopening takes it back with them (ADR-0023)', async () => {
		const day = today();
		const first = addDays(day, -4);
		const { rule, occurrence } = await overdueSeries({ freq: 'daily', lead_days: 1 }, first, {
			template_subtasks: [{ title: 'Ausräumen', priority: 'medium' }]
		});
		const children = () =>
			superuser.collection('tickets').getFullList({ filter: superuser.filter('parent = {:id}', { id: occurrence.id }) });
		expect(await children()).toHaveLength(1);

		await tickets().update(occurrence.id, { status: 'done', complete_children: true });
		const [next] = await openOf(rule.id);
		expect(dateOf(next.due)).toBe(addDays(day, 1));
		const nextChildren = await superuser
			.collection('tickets')
			.getFullList({ filter: superuser.filter('parent = {:id}', { id: next.id }) });
		expect(nextChildren.map((child) => child.title)).toEqual(['Ausräumen']);

		// "Rückgängig": the untouched follow-up goes with its sub-task; next_due is its date again.
		await tickets().update(occurrence.id, { status: 'open' });
		expect((await openOf(rule.id)).map((ticket) => ticket.id)).toEqual([occurrence.id]);
		expect((await instancesOf(rule.id)).map((ticket) => ticket.id)).toEqual([occurrence.id]);
		for (const child of nextChildren) {
			await expect(superuser.collection('tickets').getOne(child.id)).rejects.toMatchObject({ status: 404 });
		}
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe(addDays(day, 1));

		// Done again the same day: the same next date, the dates in between noted once.
		await tickets().update(occurrence.id, { status: 'done', complete_children: true });
		expect((await openOf(rule.id)).map((ticket) => dateOf(ticket.due))).toEqual([addDays(day, 1)]);
		expect((await skippedOf(occurrence.id)).map((note) => note.skipped.count)).toEqual([3]);
	});

	it('"Aus der Serie lösen" of an overdue occurrence: the next ticket comes for the date after today', async () => {
		const day = today();
		const first = addDays(day, -6);
		const { rule, occurrence } = await overdueSeries({ freq: 'daily', lead_days: 0 }, first);

		const released = await tickets().update(occurrence.id, { recurrence: '' });
		expect(released.recurrence).toBe('');
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe(addDays(day, 1));
		expect((await run(noon(day))).created).toBe(0);
		expect((await run(noon(addDays(day, 1)))).created).toBe(1);
		expect((await openOf(rule.id)).map((ticket) => dateOf(ticket.due))).toEqual([addDays(day, 1)]);
	});

	it('trash and restore: deleting an overdue occurrence skips to the date after today; it comes back as the open one', async () => {
		const day = today();
		const first = addDays(day, -9);
		const params = { freq: 'weekly', weekdays: [weekdayOf(first)], lead_days: 0 };
		const { rule, rhythm, occurrence } = await overdueSeries(params, first);

		await owner.pb.send(`/api/byl/tickets/${occurrence.id}/delete`, { method: 'POST', body: { sources: 'inbox' } });
		const coming = after(rhythm, day);
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe(coming);
		// The weekday two days ago is not made after the delete.
		expect((await run(noon(day))).created).toBe(0);
		expect(await openOf(rule.id)).toEqual([]);

		// Restored before the next one exists, it is the one open occurrence again; next_due stays.
		await owner.pb.send(`/api/byl/trash/${occurrence.id}/restore`, { method: 'POST', body: {} });
		const open = await openOf(rule.id);
		expect(open.map((ticket) => [ticket.id, dateOf(ticket.due)])).toEqual([[occurrence.id, first]]);
		expect(dateOf((await ruleOf(rule.id)).next_due)).toBe(coming);
	});
});
