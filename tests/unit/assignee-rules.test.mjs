// Pure rules of "Zuständig" (E7-5, ADR-0068): who may be the assignee of a ticket, which assignment
// counts as one by someone else, and the assignment of the tickets of a rule (none, "fest",
// "abwechselnd" with its pointer), also when a membership ends or a follow-up is taken back.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('assignee-rules.js');

const A = 'anna00000000001';
const B = 'bert00000000002';
const C = 'clara0000000003';

describe('the assignee of a ticket', () => {
	it('is none, or a current member of the household; a private ticket never has one', () => {
		expect(rules.ticketViolation({ household: '', assignee: '', changed: true, isMember: false })).toBe('');
		expect(rules.ticketViolation({ household: '', assignee: A, changed: true, isMember: true })).toBe(
			'validation_assignee_private'
		);
		// Also unchanged: a ticket that left the household keeps no assignee.
		expect(rules.ticketViolation({ household: '', assignee: A, changed: false, isMember: true })).toBe(
			'validation_assignee_private'
		);
		expect(rules.ticketViolation({ household: 'h1', assignee: A, changed: true, isMember: true })).toBe('');
		expect(rules.ticketViolation({ household: 'h1', assignee: C, changed: true, isMember: false })).toBe(
			'validation_assignee_member'
		);
		// An unchanged assignee is not checked again.
		expect(rules.ticketViolation({ household: 'h1', assignee: C, changed: false, isMember: false })).toBe('');
	});

	it('counts an assignment by someone else, never an own one or one of the server', () => {
		expect(rules.isForeignAssignment({ assignee: A, previous: '', actor: B })).toBe(true);
		expect(rules.isForeignAssignment({ assignee: A, previous: B, actor: B })).toBe(true);
		expect(rules.isForeignAssignment({ assignee: A, previous: '', actor: A })).toBe(false);
		expect(rules.isForeignAssignment({ assignee: A, previous: A, actor: B })).toBe(false);
		expect(rules.isForeignAssignment({ assignee: '', previous: A, actor: B })).toBe(false);
		expect(rules.isForeignAssignment({ assignee: A, previous: '', actor: '' })).toBe(false);
	});

	it('sets the time of an assignment by someone else, keeps it while it stays and clears it otherwise', () => {
		expect(rules.assignedAtAction({ assignee: A, previous: '', actor: B })).toBe('set');
		expect(rules.assignedAtAction({ assignee: A, previous: A, actor: B })).toBe('keep');
		expect(rules.assignedAtAction({ assignee: A, previous: B, actor: A })).toBe('clear');
		expect(rules.assignedAtAction({ assignee: '', previous: A, actor: B })).toBe('clear');
		expect(rules.assignedAtAction({ assignee: A, previous: '', actor: '' })).toBe('clear');
	});
});

describe('the assignment of a rule', () => {
	const base = { household: 'h1', next: 0, nextSent: false, listChanged: true, householdChanged: false, members: [A, B] };

	it('has no people without a mode and none at all in the private area', () => {
		expect(rules.ruleCheck({ ...base, mode: '', assignees: [A] })).toEqual({
			code: '',
			value: { mode: '', assignees: [], next: 0 }
		});
		expect(rules.ruleCheck({ ...base, household: '', mode: '', assignees: [] }).code).toBe('');
		expect(rules.ruleCheck({ ...base, household: '', mode: 'fixed', assignees: [A] }).code).toBe(
			'validation_recurrence_assignee_private'
		);
		expect(rules.ruleCheck({ ...base, household: '', mode: '', assignees: [A] }).code).toBe(
			'validation_recurrence_assignee_private'
		);
	});

	it('needs exactly one person for "fest" and at least one for "abwechselnd", all of them members', () => {
		expect(rules.ruleCheck({ ...base, mode: 'fixed', assignees: [A] })).toEqual({
			code: '',
			value: { mode: 'fixed', assignees: [A], next: 0 }
		});
		expect(rules.ruleCheck({ ...base, mode: 'fixed', assignees: [A, B] }).code).toBe('validation_recurrence_assignee_fixed');
		expect(rules.ruleCheck({ ...base, mode: 'fixed', assignees: [] }).code).toBe('validation_recurrence_assignee_fixed');
		expect(rules.ruleCheck({ ...base, mode: 'rotate', assignees: [] }).code).toBe('validation_recurrence_assignee_rotate');
		expect(rules.ruleCheck({ ...base, mode: 'rotate', assignees: [A, C] })).toEqual({
			code: 'validation_recurrence_assignee_member',
			index: 1
		});
		expect(rules.ruleCheck({ ...base, mode: 'weekly', assignees: [A] }).code).toBe('validation_recurrence_assignee_mode');
		const eleven = Array.from({ length: 11 }, (_, i) => `user${String(i).padStart(11, '0')}`);
		expect(rules.ruleCheck({ ...base, mode: 'rotate', assignees: eleven, members: eleven }).code).toBe(
			'validation_recurrence_assignees_max'
		);
		// A list that did not change is not checked against the members again.
		expect(rules.ruleCheck({ ...base, listChanged: false, mode: 'rotate', assignees: [A, C], next: 1 }).code).toBe('');
	});

	it('keeps the pointer inside the list: named by the client, 0 after a change, else as stored', () => {
		expect(rules.ruleCheck({ ...base, mode: 'rotate', assignees: [A, B], next: 1, nextSent: true }).value.next).toBe(1);
		expect(rules.ruleCheck({ ...base, mode: 'rotate', assignees: [A, B], next: 2, nextSent: true }).code).toBe(
			'validation_recurrence_assignee_next'
		);
		expect(rules.ruleCheck({ ...base, mode: 'rotate', assignees: [A, B], next: -1, nextSent: true }).code).toBe(
			'validation_recurrence_assignee_next'
		);
		expect(rules.ruleCheck({ ...base, mode: 'rotate', assignees: [A, B], next: 1 }).value.next).toBe(0);
		expect(rules.ruleCheck({ ...base, listChanged: false, mode: 'rotate', assignees: [A, B], next: 1 }).value.next).toBe(1);
		expect(rules.ruleCheck({ ...base, listChanged: false, mode: 'rotate', assignees: [A, B], next: 5 }).value.next).toBe(0);
		expect(rules.ruleCheck({ ...base, mode: 'fixed', assignees: [A], next: 3, nextSent: true }).value.next).toBe(0);
	});

	it('gives every new occurrence its person: "fest" always the same, "abwechselnd" round and round', () => {
		expect(rules.nextAssignee({ mode: '', assignees: [], next: 0 })).toEqual({ assignee: '', next: 0 });
		expect(rules.nextAssignee({ mode: 'fixed', assignees: [B], next: 0 })).toEqual({ assignee: B, next: 0 });
		let state = { mode: 'rotate', assignees: [A, B], next: 0 };
		const people = [];
		for (let i = 0; i < 5; i++) {
			const step = rules.nextAssignee(state);
			people.push(step.assignee);
			state = { ...state, next: step.next };
		}
		expect(people).toEqual([A, B, A, B, A]);
		expect(rules.nextAssignee({ mode: 'rotate', assignees: [A, B], next: 7 })).toEqual({ assignee: A, next: 1 });
		expect(rules.upcoming({ mode: 'rotate', assignees: [A, B, C], next: 1 }, 2)).toEqual([B, C]);
		expect(rules.upcoming({ mode: 'fixed', assignees: [C], next: 0 }, 2)).toEqual([C, C]);
		expect(rules.upcoming({ mode: '', assignees: [], next: 0 }, 2)).toEqual([]);
	});

	it('takes a person out when the membership ends and keeps the next person; an empty list is none', () => {
		const rotation = { mode: 'rotate', assignees: [A, B, C], next: 1 };
		expect(rules.withoutMember(rotation, A)).toEqual({ changed: true, value: { mode: 'rotate', assignees: [B, C], next: 0 } });
		expect(rules.withoutMember(rotation, B)).toEqual({ changed: true, value: { mode: 'rotate', assignees: [A, C], next: 1 } });
		expect(rules.withoutMember(rotation, C)).toEqual({ changed: true, value: { mode: 'rotate', assignees: [A, B], next: 1 } });
		expect(rules.withoutMember({ mode: 'rotate', assignees: [A, B, C], next: 2 }, C).value).toEqual({
			mode: 'rotate',
			assignees: [A, B],
			next: 0
		});
		expect(rules.withoutMember({ mode: 'rotate', assignees: [A], next: 0 }, A)).toEqual({
			changed: true,
			value: { mode: '', assignees: [], next: 0 }
		});
		expect(rules.withoutMember({ mode: 'fixed', assignees: [B], next: 0 }, B).value.mode).toBe('');
		expect(rules.withoutMember(rotation, 'nobody000000000').changed).toBe(false);
	});

	it('goes back one step when the follow-up of the person before the pointer is taken back', () => {
		expect(rules.pointerBack({ mode: 'rotate', assignees: [A, B], next: 0 }, B)).toBe(1);
		expect(rules.pointerBack({ mode: 'rotate', assignees: [A, B], next: 1 }, A)).toBe(0);
		expect(rules.pointerBack({ mode: 'rotate', assignees: [A, B], next: 1 }, B)).toBe(1);
		expect(rules.pointerBack({ mode: 'rotate', assignees: [A, B], next: 1 }, '')).toBe(1);
		expect(rules.pointerBack({ mode: 'fixed', assignees: [A], next: 0 }, A)).toBe(0);
	});
});
