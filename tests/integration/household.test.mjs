// Managing a household (ADR-0058, E7-2) against the shared disposable instance: founding with the
// owner and one household per account, the life of an invitation code (valid, expired through a
// stored time in the past, used, revoked, unknown) with one neutral answer, the rights (delegating
// only own ones, never at the owner or oneself, no way to more rights), removing, handing on,
// leaving, what non-members and the Record API see, the topic byl/household for open tabs, the
// routes from a device in the home network and no code in the log. Each test founds its own
// households with fresh accounts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, pocketBaseUrl, superuserClient } from '../support/api.mjs';
import { writtenLogs } from '../support/logs.mjs';
import { createOwner, uniqueSuffix } from '../support/scenario.mjs';
import {
	createHouseholdInvite,
	foundHousehold,
	joinHousehold,
	leaveHousehold
} from '../../web/src/lib/data/household.ts';

const ROUTE = '/api/byl/household';
const RIGHTS = ['invite', 'remove', 'delegate', 'rename', 'purge', 'move_out'];
// A device in the home network for the fixture remote-address.pb.js of the harness.
const REMOTE = 'X-Byl-Test-Remote-Address';

let superuser;

beforeAll(async () => {
	superuser = await superuserClient();
});

/** The answer of a route: status and body, also for refusals. */
async function call(person, path, body, method = 'POST') {
	try {
		const answer = await person.client.send(path, { method, body, requestKey: null });
		return { status: 200, body: answer };
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		return { status: error.status, body: error.response };
	}
}

/** A PocketBase time `hours` before now. */
const hoursAgo = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString().replace('T', ' ');

const stateOf = async (person) => (await call(person, ROUTE, undefined, 'GET')).body;
const found = (person, name = `Haus ${uniqueSuffix()}`) => call(person, ROUTE, { name });
const invite = (person) => call(person, `${ROUTE}/invites`, {});
const join = (person, code) => call(person, `${ROUTE}/join`, { code });
const setRights = (person, memberId, rights) => call(person, `${ROUTE}/members/${memberId}/rights`, { rights });
const remove = (person, memberId) => call(person, `${ROUTE}/members/${memberId}/remove`, {});
const transfer = (person, memberId) => call(person, `${ROUTE}/members/${memberId}/transfer`, {});
const leave = (person) => call(person, `${ROUTE}/leave`, {});

/** The membership row of `person`, read by the superuser (with the stored rights). */
async function membershipRow(person) {
	const rows = await superuser
		.collection('household_members')
		.getFullList({ filter: superuser.filter('user = {:user}', { user: person.id }) });
	return rows[0] ?? null;
}

/** A household of a new owner with `count` further members who joined with codes. */
async function household(count = 1) {
	const owner = await createOwner(superuser);
	expect((await found(owner)).status).toBe(200);
	const members = [];
	for (let i = 0; i < count; i++) {
		const person = await createOwner(superuser);
		const { body } = await invite(owner);
		expect((await join(person, body.code)).status).toBe(200);
		members.push(person);
	}
	const memberId = async (person) => (await membershipRow(person)).id;
	return { owner, members, memberId, id: (await stateOf(owner)).household.id };
}

describe('founding a household', () => {
	it('makes the account its owner with every right and keeps it in one household', async () => {
		const person = await createOwner(superuser);
		expect(await stateOf(person)).toEqual({ household: null });
		const answer = await found(person, '  Haus Beispiel  ');
		expect(answer.status).toBe(200);
		expect(answer.body.household.name).toBe('Haus Beispiel');
		expect(answer.body.me).toMatchObject({ role: 'owner', rights: RIGHTS });
		expect(answer.body.members).toEqual([
			{ id: answer.body.me.member, user: person.id, name: '', role: 'owner', rights: RIGHTS, self: true }
		]);
		expect(answer.body.invites).toEqual([]);
		expect((await membershipRow(person)).rights).toEqual([]);

		const second = await found(person);
		expect(second.status).toBe(409);
		expect(second.body).toMatchObject({ reason: 'invalid', problem: 'already-member' });
		const households = await superuser
			.collection('household_members')
			.getFullList({ filter: superuser.filter('user = {:user}', { user: person.id }) });
		expect(households).toHaveLength(1);
	});

	it('checks the name and refuses accounts that are not signed in', async () => {
		const person = await createOwner(superuser);
		expect((await found(person, '   ')).body.problem).toBe('name');
		expect((await found(person, 'x'.repeat(101))).body.problem).toBe('name-long');
		expect(await stateOf(person)).toEqual({ household: null });
		const anonymous = { client: createClient() };
		expect((await call(anonymous, ROUTE, undefined, 'GET')).status).toBe(401);
		expect((await call(anonymous, ROUTE, { name: 'Haus' })).status).toBe(401);
		expect((await call({ client: superuser }, ROUTE, undefined, 'GET')).status).toBe(403);
	});

	it('works through the data layer of the page', async () => {
		const person = await createOwner(superuser);
		const founded = await foundHousehold(person.client, 'Haus Daten');
		expect(founded.kind).toBe('ok');
		const grant = await createHouseholdInvite(person.client);
		expect(grant.kind).toBe('ok');
		const partner = await createOwner(superuser);
		const refused = await joinHousehold(partner.client, 'ZZZZ-ZZZZ');
		expect(refused).toEqual({ kind: 'invalid', problem: 'code' });
		const joined = await joinHousehold(partner.client, grant.kind === 'ok' ? grant.value.code.toLowerCase() : '');
		expect(joined.kind === 'ok' && joined.value?.household.name).toBe('Haus Daten');
		expect(await leaveHousehold(partner.client)).toEqual({ kind: 'ok', value: null });
	});
});

describe('invitation codes', () => {
	it('lets one account join once with the code in any case and with or without hyphen', async () => {
		const { owner } = await household(0);
		const created = await invite(owner);
		expect(created.status).toBe(200);
		expect(created.body.code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
		expect(created.body.state.invites).toEqual([
			expect.objectContaining({ id: created.body.invite, status: 'open', usedBy: '', ended: '' })
		]);
		// Neither the code nor a hash of it is part of the state.
		expect(JSON.stringify(created.body.state)).not.toMatch(/[0-9a-f]{64}|[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}/);

		const partner = await createOwner(superuser);
		const joined = await join(partner, ` ${created.body.code.replace('-', '').toLowerCase()} `);
		expect(joined.status).toBe(200);
		expect(joined.body.me).toEqual({ member: (await membershipRow(partner)).id, role: 'member', rights: [] });
		expect(joined.body.invites).toBeNull();
		expect(joined.body.members.map((member) => member.role)).toEqual(['owner', 'member']);
		const listed = (await stateOf(owner)).invites.find((entry) => entry.id === created.body.invite);
		expect(listed).toMatchObject({ status: 'used' });
		expect(listed.ended).not.toBe('');
	});

	it('answers an unknown, expired, used and revoked code the same, neutral way', async () => {
		const { owner } = await household(0);
		const used = (await invite(owner)).body;
		expect((await join(await createOwner(superuser), used.code)).status).toBe(200);
		const expired = (await invite(owner)).body;
		// Time in the past instead of waiting 7 days: the superuser moves the end of the code to an
		// hour ago (still listed, not yet removed).
		await superuser.collection('household_invites').update(expired.invite, { expires_at: hoursAgo(1) });
		const revoked = (await invite(owner)).body;
		expect((await call(owner, `${ROUTE}/invites/${revoked.invite}/revoke`, {})).status).toBe(200);
		const open = (await invite(owner)).body;

		const answers = [];
		for (const code of [used.code, expired.code, revoked.code, 'ZZZZ-ZZZZ', 'kaputt', '']) {
			const stranger = await createOwner(superuser);
			answers.push(await join(stranger, code));
			expect(await stateOf(stranger)).toEqual({ household: null });
		}
		for (const answer of answers) {
			expect(answer).toEqual({
				status: 400,
				body: { status: 400, message: 'Code ungültig oder abgelaufen.', reason: 'invalid', problem: 'code' }
			});
		}
		const statuses = Object.fromEntries((await stateOf(owner)).invites.map((entry) => [entry.id, entry.status]));
		expect(statuses).toMatchObject({ [used.invite]: 'used', [expired.invite]: 'expired', [revoked.invite]: 'revoked', [open.invite]: 'open' });
		// A revoked code cannot be revoked again; an open one still works.
		expect((await call(owner, `${ROUTE}/invites/${revoked.invite}/revoke`, {})).body.problem).toBe('invite-closed');
		expect((await join(await createOwner(superuser), open.code)).status).toBe(200);
	});

	it('tells a member of a household first and leaves the code open', async () => {
		const { owner } = await household(0);
		const code = (await invite(owner)).body;
		const other = await createOwner(superuser);
		await found(other);
		const answer = await join(other, code.code);
		expect(answer.status).toBe(409);
		expect(answer.body.problem).toBe('already-member');
		expect((await join(other, 'ZZZZ-ZZZZ')).body.problem).toBe('already-member');
		expect((await stateOf(owner)).invites.find((entry) => entry.id === code.invite).status).toBe('open');
	});

	it('needs the right "invite" and allows at most 10 open codes', async () => {
		const { owner, members, memberId } = await household(1);
		const [member] = members;
		expect((await invite(member)).body.problem).toBe('right');
		const first = (await invite(owner)).body;
		expect((await call(member, `${ROUTE}/invites/${first.invite}/revoke`, {})).body.problem).toBe('right');
		expect((await stateOf(member)).invites).toBeNull();

		await setRights(owner, await memberId(member), ['invite']);
		expect((await invite(member)).status).toBe(200);
		// The code the member joined with is listed as used, next to the two open ones.
		const listed = (await stateOf(member)).invites;
		expect(listed.map((entry) => entry.status).sort()).toEqual(['open', 'open', 'used']);
		for (let i = 2; i < 10; i++) expect((await invite(owner)).status).toBe(200);
		const full = await invite(owner);
		expect(full.status).toBe(409);
		expect(full.body.problem).toBe('invites-full');
		expect((await call(owner, `${ROUTE}/invites/abcdefghijklmno/revoke`, {})).body.problem).toBe('invite');
	});

	it('removes codes that ended more than 30 days ago with the next new code', async () => {
		const { owner, id } = await household(0);
		const old = (await invite(owner)).body;
		await superuser.collection('household_invites').update(old.invite, { expires_at: hoursAgo(31 * 24) });
		const recent = (await invite(owner)).body;
		await (await call(owner, `${ROUTE}/invites/${recent.invite}/revoke`, {}));
		await invite(owner);
		const rows = await superuser
			.collection('household_invites')
			.getFullList({ filter: superuser.filter('household = {:id}', { id }) });
		expect(rows.map((row) => row.id)).not.toContain(old.invite);
		expect(rows.map((row) => row.id)).toContain(recent.invite);
	});

	it('never writes a code to the log, neither created nor typed', async () => {
		const { owner } = await household(0);
		const { code } = (await invite(owner)).body;
		const wrong = 'ABCD-EFGH';
		await join(await createOwner(superuser), wrong);
		await join(await createOwner(superuser), code);
		const text = JSON.stringify(await writtenLogs(superuser));
		for (const value of [code, code.replace('-', ''), wrong.replace('-', '')]) {
			expect(text).not.toContain(value);
		}
		expect(text).toContain('byl-household: Anfrage abgelehnt');
	});
});

describe('rights', () => {
	it('lets a member with "delegate" give and take only own rights, never at the owner or oneself', async () => {
		const { owner, members, memberId } = await household(2);
		const [delegate, other] = members;
		const delegateId = await memberId(delegate);
		const otherId = await memberId(other);
		const ownerId = (await membershipRow(owner)).id;

		expect((await setRights(owner, delegateId, ['delegate', 'invite'])).status).toBe(200);
		expect((await setRights(owner, otherId, ['rename'])).status).toBe(200);

		// Own rights to another member and back; the foreign right "rename" stays untouched.
		const given = await setRights(delegate, otherId, ['invite', 'rename']);
		expect(given.status).toBe(200);
		expect(given.body.members.find((member) => member.id === otherId).rights).toEqual(['invite', 'rename']);
		expect((await membershipRow(other)).rights).toEqual(['invite', 'rename']);
		expect((await setRights(delegate, otherId, ['rename'])).status).toBe(200);

		// No foreign right, given or taken; never at oneself or the owner.
		expect((await setRights(delegate, otherId, ['rename', 'remove'])).body).toMatchObject({ status: 403, problem: 'rights-foreign' });
		expect((await setRights(delegate, otherId, [])).body).toMatchObject({ status: 403, problem: 'rights-foreign' });
		expect((await setRights(delegate, delegateId, ['delegate', 'invite', 'remove'])).body.problem).toBe('self-rights');
		expect((await setRights(delegate, ownerId, [])).body.problem).toBe('owner-untouchable');
		expect((await setRights(owner, ownerId, [])).body.problem).toBe('self-rights');
		// Without "delegate" nothing changes.
		expect((await setRights(other, delegateId, [])).body.problem).toBe('right');
		expect((await setRights(owner, otherId, ['admin'])).body.problem).toBe('format');
		expect((await membershipRow(other)).rights).toEqual(['rename']);
		expect((await membershipRow(delegate)).rights).toEqual(['invite', 'delegate']);
	});

	it('lets a member with "rename" rename the household, nobody else', async () => {
		const { owner, members, memberId } = await household(1);
		const [member] = members;
		expect((await call(member, `${ROUTE}/rename`, { name: 'Neu' })).body.problem).toBe('right');
		await setRights(owner, await memberId(member), ['rename']);
		const renamed = await call(member, `${ROUTE}/rename`, { name: ' Neuer Name ' });
		expect(renamed.status).toBe(200);
		expect(renamed.body.household.name).toBe('Neuer Name');
		expect((await stateOf(owner)).household.name).toBe('Neuer Name');
	});
});

describe('members', () => {
	it('removes a member with "remove", never the owner or oneself', async () => {
		const { owner, members, memberId } = await household(2);
		const [remover, other] = members;
		const otherId = await memberId(other);
		expect((await remove(remover, otherId)).body.problem).toBe('right');
		await setRights(owner, await memberId(remover), ['remove']);
		expect((await remove(remover, (await membershipRow(owner)).id)).body.problem).toBe('owner-untouchable');
		expect((await remove(remover, await memberId(remover))).body.problem).toBe('self-remove');
		const removed = await remove(remover, otherId);
		expect(removed.status).toBe(200);
		expect(removed.body.members.map((member) => member.id)).not.toContain(otherId);
		expect(await stateOf(other)).toEqual({ household: null });
		expect((await remove(remover, otherId)).body.problem).toBe('member');
	});

	it('hands the household on: only the owner, who stays a member with every right set', async () => {
		const { owner, members, memberId } = await household(1);
		const [partner] = members;
		const partnerId = await memberId(partner);
		const ownerId = (await membershipRow(owner)).id;
		expect((await transfer(partner, ownerId)).body.problem).toBe('owner-only');
		expect((await transfer(owner, ownerId)).body.problem).toBe('self-transfer');
		const handed = await transfer(owner, partnerId);
		expect(handed.status).toBe(200);
		expect(handed.body.me).toEqual({ member: ownerId, role: 'member', rights: RIGHTS });
		expect(await membershipRow(owner)).toMatchObject({ role: 'member', rights: RIGHTS });
		expect(await membershipRow(partner)).toMatchObject({ role: 'owner' });
		expect((await stateOf(partner)).me.role).toBe('owner');
		// The former owner may still do everything but take the household back.
		expect((await transfer(owner, partnerId)).body.problem).toBe('owner-only');
		expect((await setRights(owner, partnerId, [])).body.problem).toBe('owner-untouchable');
	});

	it('lets every member but the owner leave; the owner hands on first', async () => {
		const { owner, members } = await household(1);
		const [member] = members;
		const refused = await leave(owner);
		expect(refused.status).toBe(409);
		expect(refused.body.problem).toBe('owner-leave');
		expect(refused.body.message).toContain('Übertrage zuerst die Inhaberschaft');
		expect((await leave(member)).body).toEqual({ household: null });
		expect(await membershipRow(member)).toBeNull();
		expect((await stateOf(owner)).members).toHaveLength(1);
		expect((await leave(member)).body.problem).toBe('no-household');
	});
});

describe('who sees and writes what', () => {
	it('shows a household and its members only to its members, the codes to nobody', async () => {
		const { owner, members, id } = await household(1);
		const stranger = await createOwner(superuser);
		const names = await superuser.collection('users').update(owner.id, { name: 'Chris Beispiel' });
		expect(names.name).toBe('Chris Beispiel');
		const seen = (await stateOf(members[0])).members.find((member) => member.user === owner.id);
		expect(seen).toMatchObject({ name: 'Chris Beispiel', role: 'owner', self: false });
		expect(JSON.stringify(await stateOf(members[0]))).not.toContain('@example.com');

		expect(await stranger.client.collection('households').getFullList()).toEqual([]);
		expect(await stranger.client.collection('household_members').getFullList()).toEqual([]);
		for (const person of [owner, members[0], stranger]) {
			expect((await call(person, '/api/collections/household_invites/records', undefined, 'GET')).status).toBe(403);
		}
		expect((await owner.client.collection('households').getFullList()).map((row) => row.id)).toEqual([id]);
	});

	it('keeps writing through the Record API locked', async () => {
		const { owner, id } = await household(0);
		const ownerRow = await membershipRow(owner);
		const stranger = await createOwner(superuser);
		const attempts = [
			() => owner.client.collection('households').update(id, { name: 'x' }),
			() => owner.client.collection('households').delete(id),
			() => stranger.client.collection('households').create({ name: 'x' }),
			() => stranger.client.collection('household_members').create({ household: id, user: stranger.id, role: 'member' }),
			() => owner.client.collection('household_members').update(ownerRow.id, { rights: ['invite'] }),
			() => owner.client.collection('household_members').delete(ownerRow.id),
			() => owner.client.collection('household_invites').create({ household: id, code_hash: 'a'.repeat(64), expires_at: '2030-01-01 00:00:00.000Z' })
		];
		for (const attempt of attempts) {
			expect(await attempt().then(() => 200, (error) => error.status)).toBe(403);
		}
	});

	it('tells the open tabs of every concerned account, also of the removed one', async () => {
		const { owner, members, memberId } = await household(2);
		const [kept, gone] = members;
		const hints = { owner: 0, kept: 0, gone: 0 };
		const stops = [
			await owner.client.realtime.subscribe('byl/household', () => (hints.owner += 1)),
			await kept.client.realtime.subscribe('byl/household', () => (hints.kept += 1)),
			await gone.client.realtime.subscribe('byl/household', () => (hints.gone += 1))
		];
		const stranger = await createOwner(superuser);
		let strangerHints = 0;
		stops.push(await stranger.client.realtime.subscribe('byl/household', () => (strangerHints += 1)));
		try {
			expect((await remove(owner, await memberId(gone))).status).toBe(200);
			for (let attempt = 0; attempt < 50 && Object.values(hints).some((count) => count === 0); attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			expect(hints.owner).toBeGreaterThan(0);
			expect(hints.kept).toBeGreaterThan(0);
			expect(hints.gone).toBeGreaterThan(0);
			expect(strangerHints).toBe(0);
		} finally {
			for (const stop of stops) await stop();
		}
	});

	it('works from a device in the home network like on this machine', async () => {
		const owner = await createOwner(superuser);
		const remote = (path, body) =>
			fetch(`${pocketBaseUrl()}${path}`, {
				method: body === undefined ? 'GET' : 'POST',
				headers: {
					Authorization: owner.client.authStore.token,
					'Content-Type': 'application/json',
					[REMOTE]: '192.168.178.40'
				},
				body: body === undefined ? undefined : JSON.stringify(body)
			});
		const founded = await remote(ROUTE, { name: 'Haus im Heimnetz' });
		expect(founded.status).toBe(201);
		expect((await remote(ROUTE)).status).toBe(200);
		const created = await remote(`${ROUTE}/invites`, {});
		expect(created.status).toBe(201);
		expect(created.headers.get('cache-control')).toBe('no-store');
		const partner = await createOwner(superuser);
		const joined = await fetch(`${pocketBaseUrl()}${ROUTE}/join`, {
			method: 'POST',
			headers: { Authorization: partner.client.authStore.token, 'Content-Type': 'application/json', [REMOTE]: '192.168.178.41' },
			body: JSON.stringify({ code: (await created.json()).code })
		});
		expect(joined.status).toBe(200);
		expect((await joined.json()).household.name).toBe('Haus im Heimnetz');
	});
});

afterAll(async () => {
	await superuser?.realtime.unsubscribe();
});
