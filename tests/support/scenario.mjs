// Multi-user scenario for the API rule tests (E1 plan, package 4; ADR-0004 section 4):
// users A and B are members of household H1, user C is the only member of household H2.
//
// Since package 5 the hooks set `scope`, `key` and `number` and default `status` and
// `priority`, so the payloads only carry what a client sends.

import { randomBytes } from 'node:crypto';
import { createAppUser, createClient, superuserClient, userClient } from './api.mjs';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function uniqueSuffix() {
	return randomBytes(8).toString('hex');
}

/** Random project code matching ^[A-Z]{2,6}$ (never "TASK", which has four letters). */
export function uniqueCode() {
	return [...randomBytes(6)].map((byte) => LETTERS[byte % LETTERS.length]).join('');
}

/** Scope as the hooks compute it (CLAUDE.md section 5). */
export function scopeOf(ownerId, householdId) {
	return householdId ? `h:${householdId}` : `u:${ownerId}`;
}

/**
 * Minimal valid payload for a domain collection with owner/household.
 * @param {'projects' | 'tags' | 'recurrence_rules' | 'tickets' | 'inbox_items'} collection
 * @param {string} ownerId
 * @param {string} [householdId]
 */
export function ownedPayload(collection, ownerId, householdId = '') {
	const base = { owner: ownerId, household: householdId };
	const suffix = uniqueSuffix();
	switch (collection) {
		case 'projects':
			return { ...base, name: `Projekt ${suffix}`, code: uniqueCode() };
		case 'tags':
			return { ...base, name: `tag-${suffix}` };
		case 'recurrence_rules':
			// Since E5 the hook needs a rhythm (ADR-0021 section 1); "Beginnt am" defaults to today.
			// A user chooses "Status beim Anlegen" when creating (ADR-0022 addendum 9).
			return {
				...base,
				title: `Regel ${suffix}`,
				mode: 'calendar',
				freq: 'daily',
				initial_status: 'open'
			};
		case 'tickets':
			return { ...base, title: `Ticket ${suffix}` };
		case 'inbox_items':
			return { ...base, channel: 'manual', kind: 'todo', title: `Eintrag ${suffix}` };
		default:
			throw new Error(`No payload for ${collection}`);
	}
}

/**
 * Creates users A, B, C, households H1 (A, B) and H2 (C) and authenticated clients.
 * Households and memberships are created by the superuser, because their write rules are null.
 */
export async function createScenario() {
	const superuser = await superuserClient();
	const [userA, userB, userC] = await Promise.all([
		createAppUser(superuser),
		createAppUser(superuser),
		createAppUser(superuser)
	]);
	const [h1, h2] = await Promise.all([
		superuser.collection('households').create({ name: `H1 ${uniqueSuffix()}` }),
		superuser.collection('households').create({ name: `H2 ${uniqueSuffix()}` })
	]);
	const members = await Promise.all([
		superuser
			.collection('household_members')
			.create({ household: h1.id, user: userA.record.id, role: 'owner' }),
		superuser
			.collection('household_members')
			.create({ household: h1.id, user: userB.record.id, role: 'member' }),
		superuser
			.collection('household_members')
			.create({ household: h2.id, user: userC.record.id, role: 'owner' })
	]);
	const [a, b, c] = await Promise.all([userClient(userA), userClient(userB), userClient(userC)]);
	return {
		superuser,
		anonymous: createClient(),
		a,
		b,
		c,
		ids: { a: userA.record.id, b: userB.record.id, c: userC.record.id },
		h1,
		h2,
		members: { aH1: members[0], bH1: members[1], cH2: members[2] }
	};
}

/**
 * The scenario of the areas on an own disposable instance (`startPocketBase` of the harness): A and B
 * share a household through the routes of E7-2 (A founds it and is its owner, B joins with a code), C
 * is alone without one. Every account has a display name (`names`), so realtime notices and history
 * can name it. An account of its own takes the right "Verwalter der App" first (ADR-0056 §2), so A, B
 * and C are normal accounts. Each person: { id, name, client, send(path, body, method), ticket(data) }.
 * @param {{ url: string, email: string, password: string }} instance
 * @param {[string, string, string]} [names]
 */
export async function createAreaScenario(instance, names = ['Anna Beispiel', 'Bert Beispiel', 'Clara Beispiel']) {
	const superuser = createClient(instance.url);
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	await createAppUser(superuser);
	const person = async (name) => {
		const user = await createAppUser(superuser);
		await superuser.collection('users').update(user.record.id, { name });
		const client = await userClient(user, instance.url);
		const id = user.record.id;
		return {
			id,
			name,
			client,
			send: (path, body, method = 'POST') => client.send(path, { method, body, requestKey: null }),
			ticket: (data = {}) => client.collection('tickets').create({ owner: id, title: `Ticket ${uniqueSuffix()}`, ...data })
		};
	};
	const a = await person(names[0]);
	const b = await person(names[1]);
	const c = await person(names[2]);
	const founded = await a.send('/api/byl/household', { name: `Haus ${uniqueSuffix()}` });
	const { code } = await a.send('/api/byl/household/invites', {});
	await b.send('/api/byl/household/join', { code });
	return { superuser, a, b, c, householdId: founded.household.id };
}

/** Marker titles of tests/fixtures/pb_hooks/fault-injection.pb.js (OF-15). */
export const FAIL_TICKET_INSERT = '__byl_fail_ticket_insert__';
export const FAIL_HISTORY = '__byl_fail_history__';
export const FAIL_TICKET_LINK = '__byl_fail_ticket_link__';
export const FAIL_SOURCE_LINK = '__byl_fail_source_link__';
export const FAIL_SOURCE_SETTLE = '__byl_fail_source_settle__';
export const FAIL_CHILD_DONE = '__byl_fail_child_done__';
export const FAIL_PROJECT_ARCHIVE = '__byl_fail_project_archive__';
export const FAIL_DUPLICATE = '__byl_fail_duplicate__';
export const FAIL_AREA_MOVE = '__byl_fail_area_move__';

/**
 * Fresh app user with an own private scope, so every counter of that scope starts empty. With
 * `admin` the superuser gives it the right "Verwalter der App" (ADR-0056), e.g. to set up channels
 * with access data. The user lives on the instance of `superuser` (shared or own).
 * @param {PocketBase} superuser authenticated superuser client
 * @param {{ admin?: boolean }} [options]
 */
export async function createOwner(superuser, { admin = false } = {}) {
	const user = await createAppUser(superuser);
	if (admin) await superuser.collection('users').update(user.record.id, { instance_admin: true });
	const client = await userClient(user, superuser.baseURL);
	const id = user.record.id;
	return {
		id,
		// Random credentials, in memory only (login tests).
		email: user.email,
		password: user.password,
		client,
		ticket: (data = {}) =>
			client.collection('tickets').create({ owner: id, title: `Ticket ${uniqueSuffix()}`, ...data }),
		project: (code, data = {}) =>
			client.collection('projects').create({ owner: id, name: `Projekt ${code}`, code, ...data }),
		tag: (name, data = {}) => client.collection('tags').create({ owner: id, name, ...data })
	};
}

/** Current value of a ticket counter (0 if it does not exist), read by the superuser. */
export async function counterValue(superuser, key) {
	const found = await superuser
		.collection('ticket_counters')
		.getFullList({ filter: superuser.filter('key = {:key}', { key }) });
	return found.length === 0 ? 0 : found[0].value;
}

/** History entries of a ticket in creation order, read by the superuser. */
export async function historyOf(superuser, ticketId) {
	return superuser.collection('ticket_history').getFullList({
		filter: superuser.filter('ticket = {:id}', { id: ticketId }),
		sort: 'created,id'
	});
}
