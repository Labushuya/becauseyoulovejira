// Charms of tickets and rules (ADR-0062) against an own disposable PocketBase: the text field
// `charm` takes exactly the keys of the catalog of the SPA and empty, on every way (app account,
// superuser) with `validation_charm_unknown` at the field otherwise; the history records a change
// with the acting user; every new ticket of a rule gets the charm the rule has at that moment, a
// later change of the rule reaches only the next ones, sub-tasks of the template get none;
// "Duplizieren" keeps the charm of the original and of each sub-task; moving a ticket or a rule into
// the household keeps it; the data layer of the SPA reads, writes and clears it. The clock of the
// generation comes through POST /api/byl-test/recurrence/run (tests/fixtures/pb_hooks).

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { uniqueSuffix } from '../support/scenario.mjs';
import { CHARM_KEYS, CHARM_MESSAGES } from '../../web/src/lib/domain/charms.ts';
import { charmsReady, createRule, updateRule } from '../../web/src/lib/data/recurrence.ts';
import { createTicket, getTicket, updateTicket } from '../../web/src/lib/data/tickets.ts';

const UNKNOWN = CHARM_MESSAGES.validation_charm_unknown;

let instance;
let superuser;
let owner;

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	owner = {
		id: record.id,
		pb,
		send: (path, body) => pb.send(path, { method: 'POST', body, requestKey: null }),
		ticket: (data = {}) => pb.collection('tickets').create({ owner: record.id, title: `Ticket ${uniqueSuffix()}`, ...data }),
		rule: (data = {}) =>
			pb.collection('recurrence_rules').create({
				owner: record.id,
				title: `Regel ${uniqueSuffix()}`,
				mode: 'calendar',
				freq: 'daily',
				lead_days: 0,
				initial_status: 'open',
				...data
			})
	};
});

afterAll(async () => {
	await instance?.stop();
});

// Every test leaves its rules paused, so a later run with another clock does not touch them.
afterEach(async () => {
	const active = await superuser.collection('recurrence_rules').getFullList({ filter: 'active = true' });
	for (const rule of active) await superuser.collection('recurrence_rules').update(rule.id, { active: false });
});

/** Status, codes and messages per field of a refused call. */
async function refusal(promise) {
	try {
		await promise;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		const data = error.response?.data ?? {};
		return {
			status: error.status,
			codes: Object.fromEntries(Object.entries(data).map(([field, value]) => [field, value.code])),
			messages: Object.fromEntries(Object.entries(data).map(([field, value]) => [field, value.message]))
		};
	}
	throw new Error('Expected the request to be refused, but it succeeded.');
}

async function run(iso) {
	const response = await fetch(`${instance.url}/api/byl-test/recurrence/run`, {
		method: 'POST',
		headers: { Authorization: superuser.authStore.token, 'Content-Type': 'application/json' },
		body: JSON.stringify({ now: Date.parse(iso) })
	});
	expect(response.status).toBe(200);
	return response.json();
}

const ticketOf = (id) => superuser.collection('tickets').getOne(id);
const instancesOf = (ruleId) =>
	superuser
		.collection('tickets')
		.getFullList({ filter: superuser.filter('recurrence = {:rule}', { rule: ruleId }), sort: 'due,created,id' });
const childrenOf = (ticketId) =>
	superuser.collection('tickets').getFullList({ filter: superuser.filter('parent = {:id}', { id: ticketId }), sort: 'created,id' });
const charmEntries = async (ticketId) =>
	(
		await superuser
			.collection('ticket_history')
			.getFullList({ filter: superuser.filter('ticket = {:id}', { id: ticketId }), sort: 'created,id' })
	)
		.filter((entry) => entry.field === 'charm')
		.map(({ old_value, new_value, user }) => ({ old_value, new_value, user }));

describe('the field charm (ADR-0062)', () => {
	it('is an optional text field at tickets and rules', async () => {
		for (const name of ['tickets', 'recurrence_rules']) {
			const collection = await superuser.collections.getOne(name);
			const field = collection.fields.find((candidate) => candidate.name === 'charm');
			expect(field, name).toMatchObject({ type: 'text', required: false, max: 40 });
		}
	});

	it('takes every key of the catalog and empty at a ticket, refuses anything else with a clear message', async () => {
		for (const charm of CHARM_KEYS) {
			expect((await owner.ticket({ charm })).charm, charm).toBe(charm);
		}
		expect((await owner.ticket()).charm).toBe('');
		for (const charm of ['einhorn', 'Geburtstag', ' geburtstag', '🎂']) {
			expect(await refusal(owner.ticket({ charm })), charm).toEqual({
				status: 400,
				codes: { charm: 'validation_charm_unknown' },
				messages: { charm: UNKNOWN }
			});
		}
		const ticket = await owner.ticket({ charm: 'zug' });
		expect(await refusal(owner.pb.collection('tickets').update(ticket.id, { charm: 'rakete' }))).toMatchObject({
			status: 400,
			codes: { charm: 'validation_charm_unknown' }
		});
		// The superuser goes through the same hook.
		expect(await refusal(superuser.collection('tickets').update(ticket.id, { charm: 'rakete' }))).toMatchObject({
			status: 400,
			codes: { charm: 'validation_charm_unknown' }
		});
		expect((await ticketOf(ticket.id)).charm).toBe('zug');
	});

	it('takes a key and empty at a rule and refuses an unknown one, on create and update', async () => {
		const rule = await owner.rule({ anchor: '2040-01-01', charm: 'muell' });
		expect(rule.charm).toBe('muell');
		expect(await refusal(owner.rule({ anchor: '2040-01-01', charm: 'einhorn' }))).toMatchObject({
			status: 400,
			codes: { charm: 'validation_charm_unknown' }
		});
		expect(
			await refusal(owner.pb.collection('recurrence_rules').update(rule.id, { charm: 'einhorn' }))
		).toMatchObject({ status: 400, codes: { charm: 'validation_charm_unknown' } });
		expect(
			await refusal(superuser.collection('recurrence_rules').update(rule.id, { charm: 'einhorn' }))
		).toMatchObject({ status: 400, codes: { charm: 'validation_charm_unknown' } });
		expect((await owner.pb.collection('recurrence_rules').update(rule.id, { charm: '' })).charm).toBe('');
	});

	it('records setting, changing and clearing in the history with the acting user', async () => {
		const ticket = await owner.ticket();
		await owner.pb.collection('tickets').update(ticket.id, { charm: 'arzt' });
		await owner.pb.collection('tickets').update(ticket.id, { charm: 'medikament' });
		await owner.pb.collection('tickets').update(ticket.id, { charm: '' });
		expect((await ticketOf(ticket.id)).charm).toBe('');
		expect(await charmEntries(ticket.id)).toEqual([
			{ old_value: '', new_value: 'arzt', user: owner.id },
			{ old_value: 'arzt', new_value: 'medikament', user: owner.id },
			{ old_value: 'medikament', new_value: '', user: owner.id }
		]);
	});
});

describe('rules give their charm to new tickets (ADR-0062)', () => {
	it('gives every new ticket the charm the rule has when it is made; a change reaches only the next ones', async () => {
		const rule = await owner.rule({ anchor: '2037-03-01', each_occurrence: true, charm: 'muell' });
		expect((await run('2037-03-01T12:00:00Z')).created).toBe(1);
		await owner.pb.collection('recurrence_rules').update(rule.id, { charm: 'putzen' });
		expect((await run('2037-03-02T12:00:00Z')).created).toBe(1);
		await owner.pb.collection('recurrence_rules').update(rule.id, { charm: '' });
		expect((await run('2037-03-03T12:00:00Z')).created).toBe(1);

		const made = await instancesOf(rule.id);
		expect(made.map((ticket) => [ticket.due.slice(0, 10), ticket.charm])).toEqual([
			['2037-03-01', 'muell'],
			['2037-03-02', 'putzen'],
			['2037-03-03', '']
		]);
		// The charm of the rule is no change of the ticket: only "created" in its history.
		expect(await charmEntries(made[0].id)).toEqual([]);
	});

	it('gives the sub-tasks of the template no charm', async () => {
		const rule = await owner.rule({
			anchor: '2037-05-01',
			charm: 'geburtstag',
			template_subtasks: [{ title: 'Kuchen backen', priority: 'medium' }]
		});
		expect((await run('2037-05-01T12:00:00Z')).created).toBe(1);
		const [ticket] = await instancesOf(rule.id);
		expect(ticket.charm).toBe('geburtstag');
		const children = await childrenOf(ticket.id);
		expect(children.map((child) => [child.title, child.charm])).toEqual([['Kuchen backen', '']]);
	});

	it('leaves a ticket made before the rule changed as it is, and a sub-task added by hand without one', async () => {
		const rule = await owner.rule({ anchor: '2037-07-01', charm: 'auto' });
		await run('2037-07-01T12:00:00Z');
		const [ticket] = await instancesOf(rule.id);
		await owner.pb.collection('recurrence_rules').update(rule.id, { charm: 'zug' });
		expect((await ticketOf(ticket.id)).charm).toBe('auto');
		const child = await owner.ticket({ parent: ticket.id });
		expect(child.charm).toBe('');
	});
});

describe('duplicating and moving keep the charm (ADR-0062)', () => {
	it('"Duplizieren" takes the charm of the original and of each sub-task over', async () => {
		const parent = await owner.ticket({ title: 'Urlaub', charm: 'koffer' });
		await owner.ticket({ title: 'Pässe', parent: parent.id, charm: 'dokument' });
		await owner.ticket({ title: 'Packen', parent: parent.id });
		const copy = await owner.send(`/api/byl/tickets/${parent.id}/duplicate`, {
			title: 'Urlaub 2',
			status: 'open',
			source: 'none',
			subtasks: true
		});
		expect((await ticketOf(copy.id)).charm).toBe('koffer');
		const children = await childrenOf(copy.id);
		expect(children.map((child) => [child.title, child.charm])).toEqual([
			['Pässe', 'dokument'],
			['Packen', '']
		]);
		expect(await charmEntries(copy.id)).toEqual([]);
		// Without a charm the copy has none either.
		const plain = await owner.ticket();
		const plainCopy = await owner.send(`/api/byl/tickets/${plain.id}/duplicate`, {
			title: 'Kopie',
			status: 'open',
			source: 'none'
		});
		expect((await ticketOf(plainCopy.id)).charm).toBe('');
	});

	it('moving a ticket and a rule into the household keeps the charm, and the next ticket gets it there', async () => {
		const household = (await owner.send('/api/byl/household', { name: `Haus ${uniqueSuffix()}` })).household.id;
		const ticket = await owner.ticket({ charm: 'garten' });
		await owner.send('/api/byl/area/move', { kind: 'ticket', ids: [ticket.id], to: 'household' });
		expect(await ticketOf(ticket.id)).toMatchObject({ household, charm: 'garten' });

		const rule = await owner.rule({ anchor: '2038-02-01', charm: 'sport' });
		await owner.send('/api/byl/area/move', { kind: 'rule', ids: [rule.id], to: 'household', project: '' });
		expect(await superuser.collection('recurrence_rules').getOne(rule.id)).toMatchObject({
			household,
			charm: 'sport'
		});
		await run('2038-02-01T12:00:00Z');
		const [made] = await instancesOf(rule.id);
		expect(made).toMatchObject({ household, charm: 'sport' });

		// And back into the private area.
		await owner.send('/api/byl/area/move', { kind: 'ticket', ids: [ticket.id], to: 'private' });
		expect(await ticketOf(ticket.id)).toMatchObject({ household: '', charm: 'garten' });
	});
});

describe('web data layer: charms (ADR-0062)', () => {
	it('reads, writes and clears the charm of a ticket; an unknown key reads as none', async () => {
		const created = await createTicket(owner.pb, {
			title: 'Torte bestellen',
			description: '',
			status: 'open',
			priority: 'medium',
			due: null,
			project: null,
			tags: [],
			charm: 'geburtstag'
		});
		expect(created.charm).toBe('geburtstag');
		expect((await updateTicket(owner.pb, created.id, { charm: 'geschenk' })).charm).toBe('geschenk');
		expect((await updateTicket(owner.pb, created.id, { charm: null })).charm).toBeNull();
		expect((await getTicket(owner.pb, created.id)).charm).toBeNull();
	});

	it('reads and writes the charm of a rule and knows that the server has the field', async () => {
		expect(await charmsReady(owner.pb)).toBe(true);
		const rule = await createRule(owner.pb, {
			title: 'Müll',
			description: '',
			project: null,
			tags: [],
			priority: null,
			mode: 'calendar',
			freq: 'weekly',
			interval: 1,
			weekdays: ['MO'],
			month_day: 0,
			anchor: '2041-01-07',
			lead_days: 0,
			initial_status: 'open',
			charm: 'muell'
		});
		expect(rule.charm).toBe('muell');
		expect((await updateRule(owner.pb, rule.id, { charm: null })).charm).toBeNull();
	});
});
