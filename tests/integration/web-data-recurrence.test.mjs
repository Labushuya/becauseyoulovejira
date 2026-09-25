// Recurrence rules through the data layer of the web app against the disposable instance (E5 plan,
// package 4). The TypeScript modules from web/src/lib/data are imported directly.

import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner } from '../support/scenario.mjs';
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
