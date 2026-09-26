// Recurrence rules through the data layer of the web app against the disposable instance (E5 plan,
// packages 4 and 5). The TypeScript modules from web/src/lib/data are imported directly.

import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, historyOf, uniqueCode } from '../support/scenario.mjs';
import { addDays, berlinToday } from '../../web/src/lib/domain/berlin-date.ts';
import { formPreview, formValuesOf } from '../../web/src/lib/domain/recurrence-rule.ts';
import { DataError } from '../../web/src/lib/data/errors.ts';
import {
	createRule,
	deleteRule,
	detachTicket,
	listRules,
	setRuleActive,
	updateRule
} from '../../web/src/lib/data/recurrence.ts';
import { getTicket } from '../../web/src/lib/data/tickets.ts';

async function dataErrorOf(promise) {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(DataError);
		return error;
	}
	throw new Error('Expected the call to fail, but it succeeded.');
}

const draft = (overrides = {}) => ({
	title: 'Müll rausbringen',
	description: 'Gelbe Tonne',
	project: null,
	tags: [],
	priority: 'high',
	mode: 'calendar',
	freq: 'weekly',
	interval: 1,
	weekdays: ['MO'],
	month_day: 0,
	anchor: '2031-01-06',
	lead_days: 3,
	...overrides
});

describe('web data layer: recurrence rules', () => {
	let superuser;

	beforeAll(async () => {
		superuser = await superuserClient();
	});

	it('creates, lists, changes, pauses and deletes a rule only its owner sees', async () => {
		const owner = await createOwner(superuser);
		const other = await createOwner(superuser);

		const rule = await createRule(owner.client, draft());
		expect(rule).toMatchObject({
			title: 'Müll rausbringen',
			description: 'Gelbe Tonne',
			projectId: null,
			priority: 'high',
			mode: 'calendar',
			freq: 'weekly',
			interval: 1,
			weekdays: ['MO'],
			monthDay: null,
			anchor: '2031-01-06',
			leadDays: 3,
			nextDue: '2031-01-06',
			active: true,
			lastHint: ''
		});
		expect(await listRules(owner.client)).toEqual([rule]);
		expect(await listRules(other.client)).toEqual([]);

		const monthly = await updateRule(owner.client, rule.id, {
			freq: 'monthly',
			weekdays: [],
			month_day: -1
		});
		expect(monthly).toMatchObject({ freq: 'monthly', weekdays: [], monthDay: -1, nextDue: '2031-01-31' });

		expect((await setRuleActive(owner.client, rule.id, false)).active).toBe(false);
		expect((await dataErrorOf(setRuleActive(other.client, rule.id, true))).kind).toBe('not_found');

		await deleteRule(owner.client, rule.id);
		expect(await listRules(owner.client)).toEqual([]);
	});

	it('makes a ticket the instance of a new rule and releases it again', async () => {
		const owner = await createOwner(superuser);
		const ticket = await owner.ticket({ due: '2031-01-06' });

		const rule = await createRule(owner.client, draft({ title: ticket.title }), ticket.id);
		expect(rule.nextDue).toBe('2031-01-13');
		const linked = await getTicket(owner.client, ticket.id);
		expect(linked).toMatchObject({ recurring: true, recurrenceId: rule.id });

		const released = await detachTicket(owner.client, ticket.id);
		expect(released).toMatchObject({ id: ticket.id, recurring: false, recurrenceId: null });
	});

	it('reports field errors with the codes and texts of the hook', async () => {
		const owner = await createOwner(superuser);
		const error = await dataErrorOf(createRule(owner.client, draft({ weekdays: [], anchor: 'kein Datum' })));
		expect(error.kind).toBe('validation');
		expect(error.fields.anchor).toMatchObject({
			code: 'validation_recurrence_anchor',
			message: 'Bitte ein gültiges Datum für „Beginnt am“ wählen.'
		});

		const done = await owner.ticket({ status: 'done' });
		const refused = await dataErrorOf(createRule(owner.client, draft(), done.id));
		expect(refused.fields.ticket).toMatchObject({
			code: 'validation_recurrence_ticket_done',
			message: 'Ein erledigtes Ticket kann keine Serie beginnen.'
		});
	});
});

describe('web data layer: overview "Wiederholungen" (E5 plan, package 5)', () => {
	let superuser;

	beforeAll(async () => {
		superuser = await superuserClient();
	});

	const instancesOf = (owner, ruleId) =>
		owner.client
			.collection('tickets')
			.getFullList({ filter: owner.client.filter('recurrence = {:id}', { id: ruleId }) });

	it('creates the first ticket of a new rule at once when it is within the lead time', async () => {
		const owner = await createOwner(superuser);
		const today = berlinToday(Date.now());
		const rule = await createRule(
			owner.client,
			draft({ freq: 'daily', weekdays: [], anchor: today, lead_days: 0 })
		);
		const instances = await instancesOf(owner, rule.id);
		expect(instances).toHaveLength(1);
		// The server may already count the next day if the test runs across Berlin midnight.
		expect([today, addDays(today, 1)]).toContain(instances[0].due.slice(0, 10));
		expect(instances[0]).toMatchObject({ title: 'Müll rausbringen', status: 'open' });

		// A rule far ahead creates nothing yet; its next ticket is its first date.
		const later = await createRule(owner.client, draft({ title: 'Später' }));
		expect(later.nextDue).toBe('2031-01-06');
		expect(await instancesOf(owner, later.id)).toEqual([]);
	});

	it('keeps the open ticket when the template changes and recomputes the next ticket for a new rhythm', async () => {
		const owner = await createOwner(superuser);
		const today = berlinToday(Date.now());
		const rule = await createRule(
			owner.client,
			draft({ freq: 'daily', weekdays: [], anchor: today, lead_days: 0 })
		);
		const [instance] = await instancesOf(owner, rule.id);
		// The answer of the create came before the first ticket; the rule has moved on since.
		const [current] = await listRules(owner.client);
		expect(current.nextDue > rule.nextDue).toBe(true);

		const renamed = await updateRule(owner.client, rule.id, { title: 'Neue Vorlage', priority: 'low' });
		expect(renamed).toMatchObject({ title: 'Neue Vorlage', priority: 'low', nextDue: current.nextDue });
		expect(await getTicket(owner.client, instance.id)).toMatchObject({
			title: 'Müll rausbringen',
			priority: 'high'
		});

		const far = await createRule(owner.client, draft());
		const thursday = await updateRule(owner.client, far.id, { weekdays: ['TH'] });
		expect(thursday.nextDue).toBe('2031-01-09');
		// The preview of the panel shows the same first date as the saved next ticket.
		expect(formPreview(formValuesOf(thursday, today), today).dates[0]).toBe(thursday.nextDue);
	});

	it('deletes a rule and leaves its open ticket without the series', async () => {
		const owner = await createOwner(superuser);
		const today = berlinToday(Date.now());
		const rule = await createRule(
			owner.client,
			draft({ freq: 'daily', weekdays: [], anchor: today, lead_days: 0 })
		);
		const [instance] = await instancesOf(owner, rule.id);

		await deleteRule(owner.client, rule.id);
		expect(await listRules(owner.client)).toEqual([]);
		expect(await getTicket(owner.client, instance.id)).toMatchObject({
			id: instance.id,
			recurring: false,
			recurrenceId: null
		});
		const removal = (await historyOf(superuser, instance.id)).find(
			(entry) => entry.field === 'recurrence' && entry.old_value === rule.id
		);
		expect(removal?.new_value).toBe('');
	});

	it('refuses to resume a rule with an archived project at the field until the project changes', async () => {
		const owner = await createOwner(superuser);
		const project = await owner.project(uniqueCode());
		const rule = await createRule(owner.client, draft({ project: project.id }));
		await setRuleActive(owner.client, rule.id, false);
		await owner.client.collection('projects').update(project.id, { archived: true });

		const refused = await dataErrorOf(setRuleActive(owner.client, rule.id, true));
		expect(refused.kind).toBe('validation');
		expect(refused.fields.project.code).toBe('validation_project_archived');

		await updateRule(owner.client, rule.id, { project: null });
		expect((await setRuleActive(owner.client, rule.id, true)).active).toBe(true);
	});
});
