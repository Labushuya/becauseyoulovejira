// Pure rules of a household (ADR-0058, E7-2; app/pb_hooks/lib/household-rules.js) and their mirror
// in the web app (web/src/lib/domain/household.ts): the catalog of rights, delegating only own
// rights, the owner untouchable, removing, handing on and leaving, the invitation codes (alphabet,
// normalizing, groups, status, how long they are listed and kept), names and the same texts on
// both sides.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import * as domain from '../../web/src/lib/domain/household.ts';

const rules = loadHookLib('household-rules.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-04T12:00:00.000Z');
const date = (ms) => new Date(ms).toISOString().replace('T', ' ');

const owner = { id: 'm-owner', role: 'owner', rights: [] };
const delegate = { id: 'm-delegate', role: 'member', rights: ['delegate', 'invite'] };
const plain = { id: 'm-plain', role: 'member', rights: [] };
const strong = { id: 'm-strong', role: 'member', rights: ['remove', 'rename', 'purge'] };

describe('rights', () => {
	it('has the catalog of the page in its order, the same on both sides', () => {
		expect(rules.RIGHTS).toEqual(['invite', 'remove', 'delegate', 'rename', 'purge', 'move_out']);
		expect([...domain.RIGHTS]).toEqual(rules.RIGHTS);
		for (const right of rules.RIGHTS) {
			expect(domain.RIGHT_LABELS[right]).toBeTruthy();
			expect(domain.RIGHT_HINTS[right]).toBeTruthy();
		}
	});

	it('gives the owner every right by the role and a member only the known stored ones, in order', () => {
		expect(rules.effectiveRights('owner', [])).toEqual(rules.RIGHTS);
		expect(rules.effectiveRights('member', ['rename', 'invite', 'invite', 'admin'])).toEqual(['invite', 'rename']);
		expect(rules.effectiveRights('member', null)).toEqual([]);
		expect([...domain.effectiveRights('owner', [])]).toEqual(rules.RIGHTS);
		expect([...domain.effectiveRights('member', ['rename', 'invite', 'admin'])]).toEqual(['invite', 'rename']);
		expect(rules.may(owner, 'move_out')).toBe(true);
		expect(rules.may(plain, 'invite')).toBe(false);
	});

	it('reads the body of the rights strictly', () => {
		expect(rules.rightsInput({ rights: ['rename', 'invite', 'rename'] })).toEqual({ rights: ['invite', 'rename'] });
		expect(rules.rightsInput({ rights: [] })).toEqual({ rights: [] });
		for (const body of [{}, { rights: 'invite' }, { rights: ['admin'] }, { rights: [1] }, null, { rights: Array(13).fill('invite') }]) {
			expect(rules.rightsInput(body), JSON.stringify(body)).toEqual({ problem: 'format' });
		}
	});

	it.each([
		['the owner gives any right', owner, plain, ['invite', 'move_out'], ''],
		['the owner takes any right', owner, strong, [], ''],
		['a delegate gives own rights', delegate, plain, ['invite', 'delegate'], ''],
		['a delegate takes own rights', delegate, { ...plain, rights: ['invite'] }, [], ''],
		['a delegate leaves foreign rights alone', delegate, strong, ['remove', 'rename', 'purge', 'invite'], ''],
		['a delegate gives no foreign right', delegate, plain, ['remove'], 'rights-foreign'],
		['a delegate takes no foreign right', delegate, strong, ['remove'], 'rights-foreign'],
		['nobody without "delegate"', strong, plain, ['remove'], 'right'],
		['never at oneself, not even the owner', owner, owner, [], 'self-rights'],
		['never at oneself as a delegate', delegate, delegate, ['delegate', 'invite', 'remove'], 'self-rights'],
		['never at the owner', delegate, owner, [], 'owner-untouchable']
	])('changes rights: %s', (_case, actor, target, next, problem) => {
		expect(rules.rightsProblem(actor, target, next)).toBe(problem);
		expect(domain.rightsProblem(actor, target, next)).toBe(problem);
	});

	it.each([
		['the owner removes a member', owner, plain, ''],
		['a member with "remove" removes a member with more rights', strong, delegate, ''],
		['not without "remove"', delegate, plain, 'right'],
		['never oneself', strong, strong, 'self-remove'],
		['never the owner', strong, owner, 'owner-untouchable']
	])('removes: %s', (_case, actor, target, problem) => {
		expect(rules.removeProblem(actor, target)).toBe(problem);
		expect(domain.removeProblem(actor, target)).toBe(problem);
	});

	it('lets only the owner hand the household on, to another member; every member but him leaves', () => {
		for (const [actor, target, problem] of [
			[owner, plain, ''],
			[owner, owner, 'self-transfer'],
			[{ ...delegate, rights: rules.RIGHTS }, plain, 'owner-only']
		]) {
			expect(rules.transferProblem(actor, target)).toBe(problem);
			expect(domain.transferProblem(actor, target)).toBe(problem);
		}
		expect(rules.leaveProblem(owner)).toBe('owner-leave');
		expect(rules.leaveProblem(strong)).toBe('');
		expect(domain.leaveProblem(owner)).toBe('owner-leave');
		expect(domain.leaveProblem(strong)).toBe('');
	});

	it('offers at a member only what the server allows', () => {
		expect(domain.memberActions(owner, plain)).toEqual({ rights: true, remove: true, transfer: true });
		expect(domain.memberActions(delegate, plain)).toEqual({ rights: true, remove: false, transfer: false });
		expect(domain.memberActions(delegate, owner)).toEqual({ rights: false, remove: false, transfer: false });
		expect(domain.memberActions(plain, delegate)).toEqual({ rights: false, remove: false, transfer: false });
		expect(domain.memberActions(owner, owner)).toEqual({ rights: false, remove: false, transfer: false });
		expect([...domain.delegableRights(delegate)]).toEqual(['invite', 'delegate']);
		expect([...domain.delegableRights(strong)]).toEqual([]);
	});
});

describe('invitation codes', () => {
	it('use 31 signs without look-alikes, 8 of them, the same on both sides', () => {
		expect(rules.CODE_ALPHABET).toHaveLength(31);
		for (const sign of ['0', 'O', '1', 'I', 'L']) expect(rules.CODE_ALPHABET).not.toContain(sign);
		expect(new Set(rules.CODE_ALPHABET).size).toBe(31);
		expect(domain.CODE_ALPHABET).toBe(rules.CODE_ALPHABET);
		expect(domain.CODE_LENGTH).toBe(rules.CODE_LENGTH);
		expect(rules.CODE_LENGTH).toBe(8);
	});

	it('ignore case, white space and hyphens when typed, and show in two groups', () => {
		for (const typed of ['abcd-efgh', 'ABCDEFGH', ' abcd efgh ', 'Abcd–Efgh', 'ab-cd-ef-gh']) {
			expect(rules.normalizeCode(typed), typed).toBe('ABCDEFGH');
			expect(domain.normalizeCode(typed), typed).toBe('ABCDEFGH');
		}
		expect(rules.formatCode('ABCDEFGH')).toBe('ABCD-EFGH');
		expect(domain.formatCode('abcdefgh')).toBe('ABCD-EFGH');
		expect(domain.formatCode('abcde')).toBe('ABCD-E');
		expect(domain.formatCode('abcdefghjk')).toBe('ABCD-EFGH');
		expect(rules.codeInput({ code: 'abcd-efgh' })).toEqual({ code: 'ABCDEFGH' });
	});

	it('answer every bad form with the one neutral problem', () => {
		for (const code of ['', 'ABCDEFG', 'ABCDEFGHJ', 'ABCDEFG0', 'ABCDEFGO', 'ABCDEFGI', 'ABCDEFGL', 'ABCDEFG1', 'ÄBCDEFGH']) {
			expect(rules.codeInput({ code }), code).toEqual({ problem: 'code' });
			expect(domain.isCode(domain.normalizeCode(code)), code).toBe(false);
		}
		expect(rules.codeInput({})).toEqual({ problem: 'code' });
		expect(rules.codeInput(null)).toEqual({ problem: 'code' });
		expect(rules.codeInput({ code: 12345678 })).toEqual({ problem: 'code' });
		expect(rules.problemBody('code')).toEqual({
			status: 400,
			body: { status: 400, message: 'Code ungültig oder abgelaufen.', reason: 'invalid', problem: 'code' }
		});
	});

	it('are open until used, revoked or expired', () => {
		const open = { expires_at: date(NOW + DAY), used_at: '', revoked_at: '' };
		expect(rules.inviteStatus(open, NOW)).toBe('open');
		expect(rules.inviteStatus({ ...open, used_at: date(NOW - DAY) }, NOW)).toBe('used');
		expect(rules.inviteStatus({ ...open, revoked_at: date(NOW - DAY) }, NOW)).toBe('revoked');
		expect(rules.inviteStatus({ ...open, expires_at: date(NOW) }, NOW)).toBe('expired');
		expect(rules.inviteStatus({ ...open, expires_at: '' }, NOW)).toBe('expired');
		expect(rules.INVITE_VALID_MS).toBe(7 * DAY);
	});

	it('stay listed for 7 days after they ended and in the database for 30', () => {
		const ended = (days) => ({ expires_at: date(NOW + DAY), used_at: date(NOW - days * DAY), revoked_at: '' });
		expect(rules.isListed({ expires_at: date(NOW + DAY), used_at: '', revoked_at: '' }, NOW)).toBe(true);
		expect(rules.isListed(ended(6), NOW)).toBe(true);
		expect(rules.isListed(ended(8), NOW)).toBe(false);
		expect(rules.isStale(ended(29), NOW)).toBe(false);
		expect(rules.isStale(ended(31), NOW)).toBe(true);
		expect(rules.isStale({ expires_at: date(NOW - 31 * DAY), used_at: '', revoked_at: '' }, NOW)).toBe(true);
		expect(rules.isStale({ expires_at: date(NOW + DAY), used_at: '', revoked_at: '' }, NOW)).toBe(false);
	});

	it('show only status, times and names of members, never a code or hash', () => {
		const view = rules.inviteView(
			{ id: 'i1', created: date(NOW), created_by: 'u1', expires_at: date(NOW + DAY), used_at: date(NOW), used_by: 'u2', revoked_at: '', code_hash: 'x' },
			NOW,
			{ u1: 'Chris' }
		);
		expect(view).toEqual({ id: 'i1', status: 'used', created: date(NOW), expires: date(NOW + DAY), ended: date(NOW), createdBy: 'Chris', usedBy: '' });
		expect(JSON.stringify(view)).not.toContain('hash');
	});
});

describe('names, answers and texts', () => {
	it('checks the name of a household like the display name of an account', () => {
		expect(rules.nameInput({ name: '  Haus Beispiel ' })).toEqual({ name: 'Haus Beispiel' });
		expect(rules.nameInput({ name: '   ' })).toEqual({ problem: 'name' });
		expect(rules.nameInput({ name: 'a\u0007b' })).toEqual({ problem: 'name' });
		expect(rules.nameInput({ name: 'x'.repeat(101) })).toEqual({ problem: 'name-long' });
		expect(rules.nameInput({})).toEqual({ problem: 'name' });
		for (const value of ['', ' Haus ', 'x'.repeat(100), 'x'.repeat(101), 'a\nb']) {
			expect(domain.nameProblem(value), value).toBe(rules.nameProblem(value));
		}
	});

	it('answers each problem with its status', () => {
		const statusOf = (problem) => rules.problemBody(problem).status;
		expect(statusOf('already-member')).toBe(409);
		expect(statusOf('owner-leave')).toBe(409);
		expect(statusOf('invites-full')).toBe(409);
		expect(statusOf('no-household')).toBe(404);
		expect(statusOf('member')).toBe(404);
		expect(statusOf('right')).toBe(403);
		expect(statusOf('rights-foreign')).toBe(403);
		expect(statusOf('owner-untouchable')).toBe(403);
		expect(statusOf('self-rights')).toBe(400);
		expect(rules.problemBody('unbekannt').body.problem).toBe('format');
	});

	it('says the same as the page', () => {
		expect(domain.HOUSEHOLD_PROBLEMS).toEqual(rules.PROBLEMS);
		expect(domain.OPEN_INVITES_MAX).toBe(rules.OPEN_INVITES_MAX);
		expect(domain.NAME_MAX).toBe(rules.NAME_MAX);
		expect(domain.problemText('code')).toBe('Code ungültig oder abgelaufen.');
		expect(domain.problemText('neu')).toBe('Der Server hat die Anfrage abgelehnt.');
	});

	it('lists a member with every right of the owner and marks the own row', () => {
		expect(rules.memberView({ id: 'm1', user: 'u1', name: 'Chris', role: 'owner', rights: [] }, 'm1')).toEqual({
			id: 'm1',
			user: 'u1',
			name: 'Chris',
			role: 'owner',
			rights: rules.RIGHTS,
			self: true
		});
		expect(rules.memberView({ id: 'm2', user: 'u2', name: '', role: 'member', rights: ['rename'] }, 'm1')).toMatchObject({
			role: 'member',
			rights: ['rename'],
			self: false
		});
	});
});
