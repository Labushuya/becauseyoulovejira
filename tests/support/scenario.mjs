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
 * @param {'projects' | 'tags' | 'recurrence_rules' | 'tickets'} collection
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
			return { ...base, title: `Regel ${suffix}`, mode: 'calendar' };
		case 'tickets':
			return { ...base, title: `Ticket ${suffix}` };
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
