// Tickets as sources of other tickets (QT-1, ADR-0067) against an own disposable PocketBase: A and B
// share a household (A founds it), C is alone. "B stammt aus A" is a link (ticket_sources) that only
// the routes write: adding and removing with the history of both tickets, "Folge-Ticket anlegen …"
// with every option in one transaction, the refusal of every circle (self, direct, over several steps,
// two requests at the same time) while diamonds stay allowed, the border of the areas, the rights
// (C sees nothing), moving with "mitnehmen" and "Verknüpfung lösen", duplicating with and without the
// sources, the trash (links stay, the other side says so, deleting for good removes them), tickets of
// a series and realtime. Reads and writes go through the data layer of the SPA
// (data/ticket-origins.ts, subscribeTicketSources of data/realtime.ts). The migration with its way
// back is in migrations-rollback.test.mjs, the routes before it in hooks-before-migration.test.mjs.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { uniqueCode, uniqueSuffix } from '../support/scenario.mjs';
import { scaled } from '../support/timing.mjs';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	addTicketSource,
	createFollowUp,
	getTicketOrigins,
	removeTicketSource
} from '../../web/src/lib/data/ticket-origins.ts';
import { subscribeTicketSources } from '../../web/src/lib/data/realtime.ts';
import { addDays, berlinToday } from '../../web/src/lib/domain/berlin-date.ts';

const rules = loadHookLib('ticket-source-rules.js');

const ROUTE = '/api/byl/household';
const MOVE = '/api/byl/area/move';
const EVENT_TIMEOUT_MS = scaled(5_000);
const CHARM = 'einkaufen';

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
async function createAccount(name) {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const id = (await superuser.collection('users').create({ email, password, passwordConfirm: password, name })).id;
	const client = createClient();
	await client.collection('users').authWithPassword(email, password);
	return {
		id,
		client,
		send: (path, body = {}, method = 'POST') => client.send(path, { method, body, requestKey: null }),
		ticket: (data = {}) => client.collection('tickets').create({ owner: id, title: `Ticket ${uniqueSuffix()}`, ...data })
	};
}

/** The failure of a call as the server sent it: status and the error of the field `field`. */
async function failureOf(promise, field = 'source') {
	try {
		await promise;
	} catch (error) {
		const status = typeof error?.status === 'number' ? error.status : 0;
		const detail = error?.fields?.[field] ?? error?.cause?.response?.data?.[field] ?? error?.response?.data?.[field];
		const data = error?.cause?.response?.data?.[field] ?? error?.response?.data?.[field];
		return { status, code: detail?.code ?? '', message: data?.message ?? detail?.message ?? '', params: data?.params ?? detail?.params };
	}
	throw new Error('Expected a refusal');
}

/** The body of a refused route call (e.g. `{ reason, problem }` of the move). */
async function rejection(promise) {
	try {
		await promise;
	} catch (error) {
		return error.response;
	}
	throw new Error('Expected a refusal');
}

/** Status of a refused call. */
async function statusOf(promise) {
	try {
		await promise;
		return 200;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		return error.status;
	}
}

/** `child` stems from `parent` from now on (as the account `who`). */
const stem = (who, child, parent) => addTicketSource(who.client, child.id, parent.id);

/** Every link of the instance between the given tickets, as the superuser sees them. */
async function linksAmong(ids) {
	const links = await superuser.collection('ticket_sources').getFullList({ sort: 'created,id' });
	return links.filter((link) => ids.includes(link.ticket) || ids.includes(link.source));
}

const historyOf = (ticketId) =>
	superuser.collection('ticket_history').getFullList({ filter: superuser.filter('ticket = {:id}', { id: ticketId }), sort: 'created,id' });

/** The entries of the links in the history of a ticket: field, value and account. */
async function linkHistory(ticketId) {
	return (await historyOf(ticketId))
		.filter((entry) => entry.field === rules.HISTORY_SOURCE || entry.field === rules.HISTORY_FOLLOW_UP)
		.map((entry) => ({
			field: entry.field,
			added: entry.new_value === '' ? null : JSON.parse(entry.new_value),
			removed: entry.old_value === '' ? null : JSON.parse(entry.old_value),
			user: entry.user
		}));
}

async function join(person) {
	const { code } = await a.send(`${ROUTE}/invites`);
	await person.send(`${ROUTE}/join`, { code });
}

/** True when the links of the instance form no circle (lib/ticket-source-rules.js reachable). */
async function hasCircle() {
	const links = await superuser.collection('ticket_sources').getFullList();
	const followUpsOf = (id) => links.filter((link) => link.source === id).map((link) => link.ticket);
	const ids = new Set(links.flatMap((link) => [link.ticket, link.source]));
	return [...ids].some((id) => rules.reachable(followUpsOf, id).includes(id));
}

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = createClient();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	a = await createAccount('Anna Beispiel');
	b = await createAccount('Bert Beispiel');
	c = await createAccount('Clara Beispiel');
	householdId = (await a.send(ROUTE, { name: `Haus ${uniqueSuffix()}` })).household.id;
	await join(b);
});

afterAll(async () => {
	for (const stop of stops) await stop().catch(() => undefined);
	await instance?.stop();
});

describe('adding and removing a source ticket', () => {
	it('links, reads both sides, keeps a second click harmless and removes again, with the history of both', async () => {
		const source = await a.ticket({ title: 'Heizung prüfen' });
		const followUp = await a.ticket({ title: 'Heizung reparieren' });

		const added = await stem(a, followUp, source);
		expect(added.ticketId).toBe(followUp.id);
		expect(added.already).toBe(false);
		expect(added.sources).toEqual([
			expect.objectContaining({ id: source.id, key: source.key, title: 'Heizung prüfen', status: 'open', trashed: false, createdBy: a.id })
		]);
		expect(added.followUps).toEqual([]);
		const seenFromSource = await getTicketOrigins(a.client, source.id);
		expect(seenFromSource.followUps.map((entry) => entry.id)).toEqual([followUp.id]);
		expect(seenFromSource.descendants).toEqual([followUp.id]);
		expect(seenFromSource.sources).toEqual([]);

		// Another tab, a second click: no error, no second link, no second history entry.
		expect((await stem(a, followUp, source)).already).toBe(true);
		expect(await linksAmong([followUp.id])).toHaveLength(1);

		expect(await linkHistory(followUp.id)).toEqual([
			{ field: 'ticket_source', added: { ticket: source.id, key: source.key }, removed: null, user: a.id }
		]);
		expect(await linkHistory(source.id)).toEqual([
			{ field: 'follow_up', added: { ticket: followUp.id, key: followUp.key }, removed: null, user: a.id }
		]);

		const removed = await removeTicketSource(a.client, followUp.id, source.id);
		expect(removed.sources).toEqual([]);
		expect(removed.already).toBe(false);
		expect((await getTicketOrigins(a.client, source.id)).followUps).toEqual([]);
		expect((await removeTicketSource(a.client, followUp.id, source.id)).already).toBe(true);
		expect(await linksAmong([followUp.id])).toEqual([]);
		expect((await linkHistory(followUp.id)).at(-1)).toEqual({
			field: 'ticket_source',
			added: null,
			removed: { ticket: source.id, key: source.key },
			user: a.id
		});
		expect((await linkHistory(source.id)).at(-1)).toEqual({
			field: 'follow_up',
			added: null,
			removed: { ticket: followUp.id, key: followUp.key },
			user: a.id
		});
		// Neither ticket changed itself.
		expect((await superuser.collection('tickets').getOne(source.id)).updated).toBe(source.updated);
	});

	it('takes any ticket as a source, done ones included, and several of them; a ticket has several follow-ups', async () => {
		const done = await a.ticket({ title: 'Erledigt', status: 'done' });
		const open = await a.ticket();
		const first = await a.ticket();
		const second = await a.ticket();
		await stem(a, first, done);
		await stem(a, first, open);
		await stem(a, second, done);
		const origins = await getTicketOrigins(a.client, first.id);
		expect(origins.sources.map((entry) => [entry.id, entry.status])).toEqual([
			[done.id, 'done'],
			[open.id, 'open']
		]);
		expect((await getTicketOrigins(a.client, done.id)).followUps.map((entry) => entry.id)).toEqual([first.id, second.id]);
	});

	it('never lets the record API write a link; only the superuser could, and the hooks check it as well', async () => {
		const one = await a.ticket();
		const two = await a.ticket();
		expect(await statusOf(a.client.collection('ticket_sources').create({ ticket: two.id, source: one.id }))).toBe(403);
		await stem(a, two, one);
		const [link] = await linksAmong([two.id]);
		expect(await statusOf(a.client.collection('ticket_sources').update(link.id, { source: two.id }))).toBe(403);
		expect(await statusOf(a.client.collection('ticket_sources').delete(link.id))).toBe(403);
		// Through the record API A reads the link of two tickets A sees.
		expect((await a.client.collection('ticket_sources').getOne(link.id)).ticket).toBe(two.id);
		// The superuser passes the rules, never the hooks.
		const self = await failureOf(superuser.collection('ticket_sources').create({ ticket: one.id, source: one.id }));
		expect(self).toMatchObject({ status: 400, code: 'validation_ticket_source_self' });
		const back = await failureOf(superuser.collection('ticket_sources').create({ ticket: one.id, source: two.id }));
		expect(back).toMatchObject({ status: 400, code: 'validation_ticket_source_cycle' });
	});

	it('refuses a missing source, one of another account and a body without one', async () => {
		const mine = await a.ticket();
		const foreign = await c.ticket();
		expect(await failureOf(addTicketSource(a.client, mine.id, foreign.id))).toMatchObject({
			status: 400,
			code: 'validation_ticket_source_missing'
		});
		expect(await failureOf(addTicketSource(a.client, mine.id, 'abcdefghijklmno'))).toMatchObject({
			status: 400,
			code: 'validation_ticket_source_missing'
		});
		expect(await failureOf(a.send(`/api/byl/tickets/${mine.id}/ticket-sources`, { source: '' }))).toMatchObject({
			status: 400
		});
		expect(await statusOf(addTicketSource(a.client, foreign.id, mine.id))).toBe(404);
	});
});

describe('circles', () => {
	it('refuses a ticket as its own source', async () => {
		const ticket = await a.ticket();
		const refused = await failureOf(stem(a, ticket, ticket));
		expect(refused).toMatchObject({ status: 400, code: 'validation_ticket_source_self' });
		expect(refused.message).toBe('Ein Ticket kann nicht aus sich selbst stammen.');
		expect(await linksAmong([ticket.id])).toEqual([]);
	});

	it('refuses the direct way back and names the chain', async () => {
		const first = await a.ticket();
		const second = await a.ticket();
		await stem(a, second, first);
		const refused = await failureOf(stem(a, first, second));
		expect(refused).toMatchObject({ status: 400, code: 'validation_ticket_source_cycle' });
		expect(refused.message).toBe(`${second.key} stammt bereits von ${first.key} ab.`);
		expect(refused.params).toEqual({ path: [second.key, first.key] });
		// Nothing of the refused link stays: no link, no history.
		expect(await linksAmong([first.id, second.id])).toHaveLength(1);
		expect((await linkHistory(first.id)).filter((entry) => entry.field === 'ticket_source')).toEqual([]);
	});

	it('refuses a circle over several steps with the tickets in between', async () => {
		const top = await a.ticket();
		const middle = await a.ticket();
		const bottom = await a.ticket();
		await stem(a, middle, top);
		await stem(a, bottom, middle);
		const refused = await failureOf(stem(a, top, bottom));
		expect(refused.code).toBe('validation_ticket_source_cycle');
		expect(refused.message).toBe(`${bottom.key} stammt bereits (über ${middle.key}) von ${top.key} ab.`);
		// The way down stays open for anything new.
		expect((await getTicketOrigins(a.client, top.id)).descendants.sort()).toEqual([middle.id, bottom.id].sort());
	});

	it('allows a diamond without a circle', async () => {
		const [top, left, right, bottom] = await Promise.all([a.ticket(), a.ticket(), a.ticket(), a.ticket()]);
		await stem(a, left, top);
		await stem(a, right, top);
		await stem(a, bottom, left);
		await stem(a, bottom, right);
		const origins = await getTicketOrigins(a.client, bottom.id);
		expect(origins.sources.map((entry) => entry.id)).toEqual([left.id, right.id]);
		expect((await getTicketOrigins(a.client, top.id)).descendants.sort()).toEqual([left.id, right.id, bottom.id].sort());
		expect((await failureOf(stem(a, top, bottom))).message).toMatch(
			new RegExp(`^${bottom.key} stammt bereits \\(über (${left.key}|${right.key})\\) von ${top.key} ab\\.$`)
		);
	});

	it('never lets two requests at the same time close a circle', async () => {
		const pairs = await Promise.all(Array.from({ length: 12 }, () => Promise.all([a.ticket(), a.ticket()])));
		const outcomes = await Promise.all(
			pairs.flatMap(([one, two]) => [
				stem(a, one, two).then(
					() => 'linked',
					(error) => error
				),
				stem(a, two, one).then(
					() => 'linked',
					(error) => error
				)
			])
		);
		for (let i = 0; i < pairs.length; i++) {
			const pair = outcomes.slice(2 * i, 2 * i + 2);
			expect(pair.filter((outcome) => outcome === 'linked'), `pair ${i}`).toHaveLength(1);
			const refused = pair.find((outcome) => outcome !== 'linked');
			expect(refused?.fields?.source?.code, `pair ${i}`).toBe('validation_ticket_source_cycle');
			expect(await linksAmong(pairs[i].map((ticket) => ticket.id)), `pair ${i}`).toHaveLength(1);
		}
		// Three tickets, three links that close a triangle, all at once: at most two of them stay.
		const [x, y, z] = await Promise.all([a.ticket(), a.ticket(), a.ticket()]);
		const triangle = await Promise.allSettled([stem(a, y, x), stem(a, z, y), stem(a, x, z)]);
		expect(triangle.filter((outcome) => outcome.status === 'fulfilled').length).toBe(2);
		expect(await hasCircle()).toBe(false);
	});
});

describe('the border of the areas and the rights', () => {
	it('refuses a source of the other area, also for the superuser', async () => {
		const own = await a.ticket();
		const shared = await a.ticket({ household: householdId });
		const refused = await failureOf(stem(a, shared, own));
		expect(refused).toMatchObject({ status: 400, code: 'validation_scope_mismatch' });
		expect(refused.message).toBe('Tickets als Quelle gibt es nur im selben Bereich (Privat oder Haushalt).');
		expect((await failureOf(superuser.collection('ticket_sources').create({ ticket: shared.id, source: own.id }))).code).toBe(
			'validation_scope_mismatch'
		);
	});

	it('lets both members link and read in the household; C reads and writes nothing of it', async () => {
		const source = await a.ticket({ household: householdId });
		const followUp = await b.ticket({ household: householdId });
		await stem(b, followUp, source);
		expect((await getTicketOrigins(a.client, source.id)).followUps.map((entry) => entry.id)).toEqual([followUp.id]);
		const [link] = await linksAmong([followUp.id]);
		expect((await b.client.collection('ticket_sources').getOne(link.id)).source).toBe(source.id);

		expect(await statusOf(getTicketOrigins(c.client, source.id))).toBe(404);
		expect(await statusOf(addTicketSource(c.client, followUp.id, source.id))).toBe(404);
		expect(await statusOf(removeTicketSource(c.client, followUp.id, source.id))).toBe(404);
		expect(await statusOf(createFollowUp(c.client, source.id, { title: 'Fremd', take: { tags: true, charm: true, description: true } }))).toBe(404);
		expect(await statusOf(c.client.collection('ticket_sources').getOne(link.id))).toBe(404);
		expect(await c.client.collection('ticket_sources').getFullList()).toEqual([]);
		// C links his own tickets, never with theirs.
		const own = await c.ticket();
		expect((await failureOf(addTicketSource(c.client, own.id, source.id))).code).toBe('validation_ticket_source_missing');
	});
});

describe('"Folge-Ticket anlegen …"', () => {
	it('creates the follow-up with project, area, tags, charm and description in one transaction, then the link', async () => {
		const code = uniqueCode();
		const project = await a.client.collection('projects').create({ owner: a.id, household: householdId, name: `Haus ${code}`, code });
		const tag = await a.client.collection('tags').create({ owner: a.id, household: householdId, name: `tag-${uniqueSuffix()}` });
		const source = await a.ticket({
			household: householdId,
			project: project.id,
			tags: [tag.id],
			charm: CHARM,
			description: 'Was zu tun war',
			priority: 'high',
			status: 'done'
		});

		const outcome = await createFollowUp(b.client, source.id, {
			title: rules.followUpTitle(source.title),
			take: { tags: true, charm: true, description: true }
		});
		expect(outcome).toMatchObject({ title: `Folge: ${source.title}`, project: project.id, source: { id: source.id, key: source.key } });
		expect(outcome.key).toMatch(new RegExp(`^${code}-\\d+$`));
		const created = await superuser.collection('tickets').getOne(outcome.id);
		expect(created).toMatchObject({
			owner: b.id,
			household: householdId,
			scope: `h:${householdId}`,
			project: project.id,
			tags: [tag.id],
			charm: CHARM,
			description: 'Was zu tun war',
			status: 'open',
			kind: 'task',
			priority: 'medium',
			parent: '',
			source: 'manual'
		});
		const origins = await getTicketOrigins(a.client, outcome.id);
		expect(origins.sources.map((entry) => [entry.id, entry.createdBy])).toEqual([[source.id, b.id]]);
		// Both entries come from the same transaction (maybe the same millisecond): compared as a set.
		expect((await historyOf(outcome.id)).map((entry) => `${entry.field}:${entry.user}`).sort()).toEqual([
			`created:${b.id}`,
			`ticket_source:${b.id}`
		]);
		expect((await linkHistory(source.id)).at(-1)).toEqual({
			field: 'follow_up',
			added: { ticket: outcome.id, key: outcome.key },
			removed: null,
			user: b.id
		});
	});

	it('leaves tags, charm and description behind when they are not chosen, and an archived project', async () => {
		const code = uniqueCode();
		const project = await a.client.collection('projects').create({ owner: a.id, name: `Alt ${code}`, code });
		const tag = await a.client.collection('tags').create({ owner: a.id, name: `tag-${uniqueSuffix()}` });
		const source = await a.ticket({ project: project.id, tags: [tag.id], charm: CHARM, description: 'Text' });
		await a.client.collection('projects').update(project.id, { archived: true });
		const outcome = await createFollowUp(a.client, source.id, {
			title: 'Ohne alles',
			take: { tags: false, charm: false, description: false }
		});
		expect(outcome.project).toBeNull();
		expect(outcome.key).toMatch(/^TASK-\d+$/);
		expect(await superuser.collection('tickets').getOne(outcome.id)).toMatchObject({
			project: '',
			tags: [],
			charm: '',
			description: '',
			household: '',
			owner: a.id
		});
	});

	it('refuses an empty title, a source in the trash and creates nothing then', async () => {
		const source = await a.ticket();
		const empty = await failureOf(createFollowUp(a.client, source.id, { title: '  ', take: { tags: true, charm: true, description: false } }), 'title');
		expect(empty).toMatchObject({ status: 400, code: 'validation_follow_up_title' });
		await a.send(`/api/byl/tickets/${source.id}/delete`, { sources: 'inbox' });
		expect(await statusOf(createFollowUp(a.client, source.id, { title: 'Folge', take: { tags: true, charm: true, description: false } }))).toBe(404);
		expect(await linksAmong([source.id])).toEqual([]);
	});
});

describe('moving between the areas (ADR-0061)', () => {
	async function chain() {
		const top = await a.ticket({ title: 'Oben' });
		const middle = await a.ticket({ title: 'Mitte' });
		const bottom = await a.ticket({ title: 'Unten' });
		await stem(a, middle, top);
		await stem(a, bottom, middle);
		return { top, middle, bottom };
	}

	it('names the links across the border in the preview and asks for the choice', async () => {
		const { top, middle, bottom } = await chain();
		const preview = await a.send(MOVE, { kind: 'ticket', ids: [middle.id], to: 'household', preview: true });
		expect(preview.conflicts.ticket_sources).toEqual([
			{ ticket: { id: middle.id, key: middle.key, title: 'Mitte' }, other: { id: top.id, key: top.key, title: 'Oben' }, relation: 'source', trashed: false },
			{ ticket: { id: middle.id, key: middle.key, title: 'Mitte' }, other: { id: bottom.id, key: bottom.key, title: 'Unten' }, relation: 'follow_up', trashed: false }
		]);
		expect(preview.needs.ticket_sources).toBe(true);
		expect(preview.counts.ticket_sources).toBe(0);
		const refused = await rejection(a.send(MOVE, { kind: 'ticket', ids: [middle.id], to: 'household' }));
		expect(refused).toMatchObject({ status: 400, reason: 'invalid', problem: 'ticket-sources-choice' });
		expect(await statusOf(a.send(MOVE, { kind: 'ticket', ids: [middle.id], to: 'household', ticket_sources: 'mit' }))).toBe(400);
		expect(await linksAmong([middle.id])).toHaveLength(2);
		expect((await superuser.collection('tickets').getOne(middle.id)).household).toBe('');
	});

	it('"Verknüpfung lösen" moves the ticket alone and releases its links with the history of both sides', async () => {
		const { top, middle, bottom } = await chain();
		const moved = await a.send(MOVE, { kind: 'ticket', ids: [middle.id], to: 'household', ticket_sources: 'release' });
		expect(moved.moved.tickets.map((entry) => entry.id)).toEqual([middle.id]);
		expect(await linksAmong([middle.id])).toEqual([]);
		expect((await superuser.collection('tickets').getOne(top.id)).household).toBe('');
		expect((await linkHistory(middle.id)).filter((entry) => entry.removed !== null).map((entry) => entry.field).sort()).toEqual([
			'follow_up',
			'ticket_source'
		]);
		expect((await linkHistory(top.id)).at(-1)).toMatchObject({ field: 'follow_up', removed: { ticket: middle.id } });
		expect((await linkHistory(bottom.id)).at(-1)).toMatchObject({ field: 'ticket_source', removed: { ticket: middle.id } });
	});

	it('"mitnehmen" takes the whole chain along and keeps its links', async () => {
		const { top, middle, bottom } = await chain();
		const other = await a.ticket({ title: 'Seitlich' });
		await stem(a, other, top);
		const preview = await a.send(MOVE, { kind: 'ticket', ids: [middle.id], to: 'household', preview: true, ticket_sources: 'take' });
		expect(preview.counts.tickets).toBe(4);
		expect(preview.counts.ticket_sources).toBe(3);
		expect(preview.conflicts.ticket_sources).toEqual([]);
		expect(preview.needs.ticket_sources).toBe(false);
		const moved = await a.send(MOVE, { kind: 'ticket', ids: [middle.id], to: 'household', ticket_sources: 'take' });
		expect(moved.moved.tickets.map((entry) => entry.id).sort()).toEqual([top.id, middle.id, bottom.id, other.id].sort());
		expect(await linksAmong([middle.id, other.id])).toHaveLength(3);
		const origins = await getTicketOrigins(b.client, middle.id);
		expect(origins.sources.map((entry) => entry.id)).toEqual([top.id]);
		expect(origins.followUps.map((entry) => entry.id)).toEqual([bottom.id]);
	});

	it('releases a link to a ticket in the trash even with "mitnehmen"', async () => {
		const source = await a.ticket({ status: 'done' });
		const followUp = await a.ticket();
		await stem(a, followUp, source);
		await a.send(`/api/byl/tickets/${source.id}/delete`, { sources: 'inbox' });
		const preview = await a.send(MOVE, { kind: 'ticket', ids: [followUp.id], to: 'household', preview: true });
		expect(preview.conflicts.ticket_sources).toEqual([expect.objectContaining({ relation: 'source', trashed: true })]);
		await a.send(MOVE, { kind: 'ticket', ids: [followUp.id], to: 'household', ticket_sources: 'take' });
		expect(await linksAmong([followUp.id])).toEqual([]);
	});
});

describe('duplicating (ADR-0045)', () => {
	const NOTHING = { description: false, priority: false, tags: false, due: false, parent: false, subtasks: false, comments: false, color: false };
	const duplicate = (who, id, source) =>
		who.send(`/api/byl/tickets/${id}/duplicate`, { title: 'Kopie', status: 'open', source, ...NOTHING });

	it('takes the source tickets over with "Kopie der Herkunft übernehmen", not without', async () => {
		const first = await a.ticket();
		const second = await a.ticket({ status: 'done' });
		const trashed = await a.ticket({ status: 'done' });
		const original = await a.ticket();
		await stem(a, original, first);
		await stem(a, original, second);
		await stem(a, original, trashed);
		await a.send(`/api/byl/tickets/${trashed.id}/delete`, { sources: 'inbox' });

		const copied = await duplicate(a, original.id, 'copy');
		expect(copied.ticket_sources).toBe(2);
		expect(copied.source).toBe('');
		// Both links come from the same transaction (maybe the same millisecond): compared as a set.
		const origins = await getTicketOrigins(a.client, copied.id);
		expect(origins.sources.map((entry) => entry.id).sort()).toEqual([first.id, second.id].sort());
		expect((await linkHistory(copied.id)).map((entry) => entry.added?.ticket).sort()).toEqual([first.id, second.id].sort());
		// The original keeps its own.
		expect((await getTicketOrigins(a.client, original.id)).sources.map((entry) => entry.id)).toEqual([first.id, second.id, trashed.id]);

		const plain = await duplicate(a, original.id, 'none');
		expect(plain.ticket_sources).toBe(0);
		expect((await getTicketOrigins(a.client, plain.id)).sources).toEqual([]);
	});

	it('refuses "Kopie der Herkunft übernehmen" for a ticket without any source', async () => {
		const original = await a.ticket();
		const refused = await failureOf(duplicate(a, original.id, 'copy'));
		expect(refused).toMatchObject({ status: 400, code: 'validation_duplicate_source_missing' });
	});
});

describe('the trash (ADR-0037)', () => {
	it('keeps the links of a ticket in the trash, the other side says so, restoring brings them back, deleting for good removes them', async () => {
		const source = await a.ticket({ status: 'done', household: householdId });
		const followUp = await a.ticket({ household: householdId });
		await stem(a, followUp, source);
		const [link] = await linksAmong([followUp.id]);

		await a.send(`/api/byl/tickets/${source.id}/delete`, { sources: 'inbox' });
		const seen = await getTicketOrigins(b.client, followUp.id);
		expect(seen.sources).toEqual([expect.objectContaining({ id: source.id, key: source.key, trashed: true })]);
		// The record API hides the link while one side lies in the trash.
		expect(await statusOf(b.client.collection('ticket_sources').getOne(link.id))).toBe(404);
		// A ticket in the trash is no new source.
		const other = await a.ticket({ household: householdId });
		expect((await failureOf(stem(a, other, source))).code).toBe('validation_ticket_source_missing');

		await a.send(`/api/byl/trash/${source.id}/restore`, {});
		expect((await getTicketOrigins(b.client, followUp.id)).sources).toEqual([
			expect.objectContaining({ id: source.id, trashed: false })
		]);
		expect((await b.client.collection('ticket_sources').getOne(link.id)).source).toBe(source.id);

		await a.send(`/api/byl/tickets/${source.id}/delete`, { sources: 'inbox' });
		await a.send(`/api/byl/trash/${source.id}/purge`, {});
		expect(await linksAmong([followUp.id])).toEqual([]);
		expect((await getTicketOrigins(b.client, followUp.id)).sources).toEqual([]);
	});

	it('shows a follow-up in the trash at its source the same way', async () => {
		const source = await a.ticket();
		const followUp = await a.ticket();
		await stem(a, followUp, source);
		await a.send(`/api/byl/tickets/${followUp.id}/delete`, { sources: 'inbox' });
		expect((await getTicketOrigins(a.client, source.id)).followUps).toEqual([
			expect.objectContaining({ id: followUp.id, trashed: true })
		]);
		// Its follow-ups still count for circles: the source cannot stem from it.
		const descendants = (await getTicketOrigins(a.client, source.id)).descendants;
		expect(descendants).toEqual([followUp.id]);
	});
});

describe('tickets of a series', () => {
	it('gives the next ticket of a series no source tickets of the one before', async () => {
		const source = await a.ticket();
		const rule = await a.client.collection('recurrence_rules').create({
			owner: a.id,
			title: `Regel ${uniqueSuffix()}`,
			mode: 'after_completion',
			freq: 'daily',
			interval: 1,
			lead_days: 3,
			anchor: berlinToday(Date.now()),
			initial_status: 'open'
		});
		const instances = () =>
			superuser.collection('tickets').getFullList({ filter: superuser.filter('recurrence = {:rule}', { rule: rule.id }), sort: 'created,id' });
		const [first] = await instances();
		await stem(a, first, source);
		await a.client.collection('tickets').update(first.id, { status: 'done' });
		const all = await instances();
		expect(all).toHaveLength(2);
		const next = all.find((ticket) => ticket.id !== first.id);
		expect(next.due.slice(0, 10)).toBe(addDays(berlinToday(Date.now()), 1));
		expect((await getTicketOrigins(a.client, next.id)).sources).toEqual([]);
		expect((await getTicketOrigins(a.client, first.id)).sources.map((entry) => entry.id)).toEqual([source.id]);
		await a.client.collection('recurrence_rules').update(rule.id, { active: false });
	});
});

describe('realtime', () => {
	async function watch(who, ticketId) {
		const changes = [];
		stops.push(await subscribeTicketSources(who.client, ticketId, (change) => changes.push(change)));
		return changes;
	}

	async function waitFor(changes, action, id) {
		const deadline = Date.now() + EVENT_TIMEOUT_MS;
		for (;;) {
			const found = changes.find((change) => change.action === action && (change.id ?? change.record?.id) === id);
			if (found) return found;
			if (Date.now() > deadline) throw new Error(`No realtime change ${action} ${id} within ${EVENT_TIMEOUT_MS} ms`);
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}

	it('tells the partner about a new source and a removed one at both tickets; C hears nothing', async () => {
		const source = await a.ticket({ household: householdId });
		const followUp = await a.ticket({ household: householdId });
		const atFollowUp = await watch(b, followUp.id);
		const atSource = await watch(b, source.id);
		const outsider = await watch(c, followUp.id);

		await stem(a, followUp, source);
		const [link] = await linksAmong([followUp.id]);
		expect((await waitFor(atFollowUp, 'create', link.id)).record).toEqual({ id: link.id, ticket: followUp.id, source: source.id });
		await waitFor(atSource, 'create', link.id);

		await removeTicketSource(a.client, followUp.id, source.id);
		await waitFor(atFollowUp, 'delete', link.id);
		await waitFor(atSource, 'delete', link.id);
		expect(outsider).toEqual([]);
	});

	it('tells the tab of a source about a follow-up created elsewhere', async () => {
		const source = await a.ticket({ household: householdId });
		const atSource = await watch(b, source.id);
		const outcome = await createFollowUp(a.client, source.id, { title: 'Folge live', take: { tags: true, charm: true, description: false } });
		const [link] = await linksAmong([outcome.id]);
		expect((await waitFor(atSource, 'create', link.id)).record.ticket).toBe(outcome.id);
	});
});
