// Pure rules of the accounts and the administrator of the app (ADR-0056, E7-1;
// app/pb_hooks/lib/account-rules.js) and their mirror in the web app (web/src/lib/domain/accounts.ts):
// active administrators, the last one, the own account, locked fields, input of the page "Konten",
// start passwords, the answers and the same texts on both sides.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	ACCOUNT_MESSAGES,
	ACCOUNT_PROBLEMS,
	NAME_MAX,
	PASSWORD_MIN,
	adminOf,
	emailProblem,
	nameProblem,
	parseAccountList,
	parsePasswordGrant,
	passwordChangeProblems
} from '../../web/src/lib/domain/accounts.ts';

const rules = loadHookLib('account-rules.js');

describe('administrators', () => {
	it('counts an account with the right that is not disabled', () => {
		expect(rules.isActiveAdmin(true, false)).toBe(true);
		expect(rules.isActiveAdmin(true, true)).toBe(false);
		expect(rules.isActiveAdmin(false, false)).toBe(false);
		expect(rules.isActiveAdmin('true', false)).toBe(false);
	});

	it.each([
		[{ admin: true, disabled: false }, { admin: false, disabled: false }, 0, true],
		[{ admin: true, disabled: false }, { admin: true, disabled: true }, 0, true],
		[{ admin: true, disabled: false }, { admin: false, disabled: false }, 1, false],
		[{ admin: true, disabled: true }, { admin: false, disabled: true }, 0, false],
		[{ admin: false, disabled: false }, { admin: false, disabled: true }, 0, false],
		[{ admin: true, disabled: false }, { admin: true, disabled: false }, 0, false]
	])('takes the last administrator away: %j to %j with %i others is %s', (before, after, others, expected) => {
		expect(rules.takesLastAdmin(before, after, others)).toBe(expected);
	});

	it('refuses the own account only where it locks out', () => {
		expect(rules.selfProblem('disable', true, true)).toBe('self-disable');
		expect(rules.selfProblem('disable', true, false)).toBe('');
		expect(rules.selfProblem('admin', true, false)).toBe('self-admin');
		expect(rules.selfProblem('admin', true, true)).toBe('');
		expect(rules.selfProblem('password', true, true)).toBe('self-password');
		expect(rules.selfProblem('password', false, true)).toBe('');
		expect(rules.selfProblem('disable', false, true)).toBe('');
	});

	it('names the first locked field a client changes', () => {
		const flags = { instance_admin: false, disabled: false, emailVisibility: false };
		expect(rules.lockedChange(flags, { ...flags })).toBe('');
		expect(rules.lockedChange(flags, { ...flags, instance_admin: true })).toBe('instance_admin');
		expect(rules.lockedChange(flags, { ...flags, disabled: true })).toBe('disabled');
		expect(rules.lockedChange(flags, { ...flags, emailVisibility: true })).toBe('emailVisibility');
		expect(rules.LOCKED_FIELDS).toEqual(['instance_admin', 'disabled', 'emailVisibility']);
	});
});

describe('input of the page "Konten"', () => {
	it('takes an address and a name, both trimmed', () => {
		expect(rules.createInput({ email: '  anna@example.com ', name: ' Anna Beispiel ' })).toEqual({
			email: 'anna@example.com',
			name: 'Anna Beispiel'
		});
	});

	it.each([
		[{ email: 'anna@example', name: 'Anna' }, 'email'],
		[{ email: 'anna example@example.com', name: 'Anna' }, 'email'],
		[{ email: `${'a'.repeat(250)}@example.com`, name: 'Anna' }, 'email'],
		[{ email: 'anna@example.com', name: '' }, 'name'],
		[{ email: 'anna@example.com', name: 'An\u0007na' }, 'name'],
		[{ email: 'anna@example.com', name: 'x'.repeat(101) }, 'name-long'],
		[{ email: 'anna@example.com' }, 'name'],
		[null, 'email'],
		['text', 'email']
	])('refuses %j with %s', (body, problem) => {
		expect(rules.createInput(body)).toEqual({ problem });
	});

	it('reads a switch only as true or false', () => {
		expect(rules.switchInput({ disabled: true }, 'disabled')).toEqual({ value: true });
		expect(rules.switchInput({ admin: false }, 'admin')).toEqual({ value: false });
		for (const body of [{}, { disabled: 'true' }, { disabled: 1 }, null]) {
			expect(rules.switchInput(body, 'disabled')).toEqual({ problem: 'format' });
		}
	});

	it('answers a refused input with 400, an unknown account with 404 and the last administrator with 409', () => {
		expect(rules.problemBody('email')).toEqual({
			status: 400,
			body: { status: 400, message: rules.PROBLEMS.email, reason: 'invalid', problem: 'email' }
		});
		expect(rules.problemBody('missing').status).toBe(404);
		expect(rules.problemBody('last-admin').status).toBe(409);
		expect(rules.problemBody('anders').body.problem).toBe('format');
	});
});

describe('start passwords', () => {
	it('come in four groups of four from an alphabet without look-alikes', () => {
		expect(rules.PASSWORD_RAW_LENGTH).toBe(16);
		expect(rules.formatPassword('abcdEFGH2345wxyz')).toBe('abcd-EFGH-2345-wxyz');
		for (const sign of '01lIoO') expect(rules.PASSWORD_ALPHABET).not.toContain(sign);
		expect(new Set(rules.PASSWORD_ALPHABET).size).toBe(rules.PASSWORD_ALPHABET.length);
		expect(rules.PASSWORD_ALPHABET.length).toBe(56);
	});
});

describe('one line of the list', () => {
	it('keeps only the known fields and marks the own account', () => {
		const view = rules.accountView(
			{ id: 'u1', name: 'Anna', email: 'anna@example.com', admin: true, disabled: false, created: '2026-10-04 08:00:00.000Z', password: 'x' },
			'u1'
		);
		expect(view).toEqual({
			id: 'u1',
			name: 'Anna',
			email: 'anna@example.com',
			admin: true,
			disabled: false,
			created: '2026-10-04 08:00:00.000Z',
			self: true
		});
		expect(rules.accountView({ id: 'u2' }, 'u1')).toMatchObject({ self: false, admin: false, name: '' });
	});
});

describe('the web app (web/src/lib/domain/accounts.ts)', () => {
	it('has the same texts and limits as the hook', () => {
		expect(ACCOUNT_PROBLEMS).toEqual(rules.PROBLEMS);
		expect(ACCOUNT_MESSAGES).toEqual(rules.MESSAGES);
		expect(NAME_MAX).toBe(rules.NAME_MAX);
		expect(PASSWORD_MIN).toBe(8);
	});

	it.each(['', '  ', 'Anna', ' Anna ', 'x'.repeat(100), 'x'.repeat(101), 'A\u0000'])('checks the name %j like the hook', (name) => {
		expect(nameProblem(name)).toBe(rules.nameProblem(name));
	});

	it.each(['anna@example.com', ' anna@example.com ', 'anna@', 'a b@example.com', `${'a'.repeat(250)}@example.com`])(
		'checks the address %j like the hook',
		(email) => {
			expect(emailProblem(email)).toBe(rules.emailProblem(email));
		}
	);

	it('checks a new password before sending', () => {
		expect(passwordChangeProblems({ current: 'alt-passwort', next: 'neues-passwort', again: 'neues-passwort' })).toEqual({});
		expect(passwordChangeProblems({ current: '', next: 'kurz', again: 'anders' })).toEqual({
			current: 'Bitte das bisherige Passwort eingeben.',
			next: 'Mindestens 8 Zeichen.',
			again: 'Die beiden neuen Passwörter sind verschieden.'
		});
		expect(passwordChangeProblems({ current: 'gleich-gleich', next: 'gleich-gleich', again: 'gleich-gleich' }).next).toBe(
			'Das neue Passwort ist das bisherige.'
		);
		expect(passwordChangeProblems({ current: 'a', next: 'x'.repeat(72), again: 'x'.repeat(72) }).next).toBe('Höchstens 71 Zeichen.');
		expect(passwordChangeProblems({ current: 'a', next: 'zehnzeichen', again: 'zehnzeichen' }, 12).next).toBe('Mindestens 12 Zeichen.');
	});

	it('reads the answers strictly', () => {
		const account = { id: 'u1', name: 'Anna', email: 'a@example.com', admin: false, disabled: true, created: 'x', self: false };
		expect(parseAccountList({ accounts: [account], passwordMin: 10 })).toEqual({ accounts: [account], passwordMin: 10 });
		expect(parseAccountList({ accounts: [account] })?.passwordMin).toBe(8);
		expect(parseAccountList({ accounts: [{ ...account, admin: 'nein' }] })).toBeNull();
		expect(parseAccountList({})).toBeNull();
		expect(parsePasswordGrant({ account, password: 'abcd-efgh-ijkm-npqr' })).toEqual({ account, password: 'abcd-efgh-ijkm-npqr' });
		expect(parsePasswordGrant({ account, password: '' })).toBeNull();
	});

	it('takes the right from the record, and the pages stay listed before the restart', () => {
		expect(adminOf({ id: 'u1', instance_admin: true })).toBe(true);
		expect(adminOf({ id: 'u1', instance_admin: false })).toBe(false);
		expect(adminOf({ id: 'u1' })).toBe(true);
		expect(adminOf(null)).toBe(false);
	});
});
