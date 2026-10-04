// A household in the SPA (ADR-0058, E7-2): the answers of the routes read strictly, the code grouped
// while typed with the caret in place, labels of members. The rules of rights and codes are compared
// with the hook in tests/unit/household-rules.test.mjs.

import { describe, expect, it } from 'vitest';
import {
	groupCodeInput,
	memberLabel,
	parseHouseholdAnswer,
	parseInviteGrant,
	type HouseholdState
} from './household';

const STATE = {
	household: { id: 'house000000001', name: 'Haus Beispiel', created: '2026-10-04 08:00:00.000Z' },
	me: {
		member: 'member00000001',
		role: 'owner',
		rights: ['invite', 'remove', 'delegate', 'rename', 'purge', 'move_out']
	},
	members: [
		{
			id: 'member00000001',
			user: 'user0000000001',
			name: 'Chris',
			role: 'owner',
			rights: ['invite'],
			self: true
		}
	],
	invites: [
		{
			id: 'invite00000001',
			status: 'open',
			created: '2026-10-04 08:00:00.000Z',
			expires: '2026-10-11 08:00:00.000Z',
			ended: '',
			createdBy: 'Chris',
			usedBy: ''
		}
	]
};

describe('answers of the routes', () => {
	it('reads the state, "no household" and nothing else', () => {
		const state = parseHouseholdAnswer(STATE) as HouseholdState;
		expect(state.household.name).toBe('Haus Beispiel');
		expect(state.me.role).toBe('owner');
		expect(state.invites?.[0]?.status).toBe('open');
		expect(parseHouseholdAnswer({ household: null })).toBeNull();
		expect(parseHouseholdAnswer({ ...STATE, invites: null })?.invites).toBeNull();
		for (const broken of [
			null,
			'x',
			{ ...STATE, me: { ...STATE.me, role: 'admin' } },
			{ ...STATE, members: [{ ...STATE.members[0], rights: ['alles'] }] },
			{ ...STATE, invites: [{ ...STATE.invites[0], status: 'kaputt' }] },
			{ ...STATE, invites: 'keine' },
			{ ...STATE, household: { id: '', name: 'x' } }
		]) {
			expect(parseHouseholdAnswer(broken), JSON.stringify(broken)).toBeUndefined();
		}
	});

	it('reads a new code only with the form of a code', () => {
		expect(
			parseInviteGrant({ code: 'ABCD-EFGH', invite: 'invite00000001', state: STATE })?.code
		).toBe('ABCD-EFGH');
		expect(parseInviteGrant({ code: 'ABCD-EFG0', invite: 'i', state: STATE })).toBeNull();
		expect(
			parseInviteGrant({ code: 'ABCD-EFGH', invite: 'i', state: { household: null } })
		).toBeNull();
	});
});

describe('typing a code', () => {
	it.each([
		['abcd', 4, 'ABCD', 4],
		['abcde', 5, 'ABCD-E', 6],
		['ABCD-EFGHJK', 11, 'ABCD-EFGH', 9],
		// A sign typed in the middle keeps the caret after it.
		['ABXCD-EFG', 3, 'ABXC-DEFG', 3],
		['ABCD-EFGH', 5, 'ABCD-EFGH', 4],
		[' ab cd-ef gh ', 13, 'ABCD-EFGH', 9],
		['', 0, '', 0]
	])('groups %j (caret %i) as %j (caret %i)', (value, caret, grouped, after) => {
		expect(groupCodeInput(value, caret)).toEqual({ value: grouped, caret: after });
	});
});

describe('names', () => {
	it('names a member without a name "Konto ohne Namen"', () => {
		expect(memberLabel({ name: 'Anna' })).toBe('Anna');
		expect(memberLabel({ name: '  ' })).toBe('Konto ohne Namen');
	});
});
