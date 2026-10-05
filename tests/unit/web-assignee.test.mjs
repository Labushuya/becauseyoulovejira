// "Zuständig" (E7-5, ADR-0068): the SPA (web/src/lib/domain/assignee.ts) and the hook
// (app/pb_hooks/lib/assignee-rules.js) know the same modes, limit and texts, and name the same person
// for the next occurrences of a rule. The rotations are compared on many generated rules, so a change
// on one side alone fails here.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import * as web from '../../web/src/lib/domain/assignee.ts';

const hook = loadHookLib('assignee-rules.js');

const PEOPLE = ['anna00000000001', 'bert00000000002', 'clar00000000003', 'dora00000000004'];

/** A small deterministic generator (xorshift), so a failure can be repeated. */
function generator(seed) {
	let state = seed;
	return (n) => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return Math.abs(state) % n;
	};
}

/** Rules of every shape: no mode, unknown mode, fixed, rotate, empty values, repetitions, pointers out of range. */
function rules(count, seed) {
	const pick = generator(seed);
	const modes = ['', 'fixed', 'rotate', 'rotate', 'other'];
	const result = [];
	for (let i = 0; i < count; i++) {
		const size = pick(6);
		const assignees = [];
		for (let j = 0; j < size; j++) assignees.push(pick(7) === 0 ? '' : (PEOPLE[pick(4)] ?? ''));
		const pointers = [0, 1, 2, 3, 5, -1, 1.5];
		result.push({
			mode: modes[pick(modes.length)],
			assignees,
			next: pointers[pick(pointers.length)]
		});
	}
	return result;
}

describe('constants of "Zuständig"', () => {
	it('are the same in the SPA and in the hook', () => {
		expect([...web.ASSIGNEE_MODES]).toEqual([...hook.MODES]);
		expect(web.ASSIGNEES_MAX).toBe(hook.ASSIGNEES_MAX);
		expect({ ...web.ASSIGNEE_MESSAGES }).toEqual({ ...hook.MESSAGES });
	});

	it('read a stored mode alike', () => {
		for (const value of ['', 'fixed', 'rotate', 'Fixed', 'other', null, undefined, 3]) {
			expect(web.assigneeModeOf(value), String(value)).toBe(hook.modeOf(value));
		}
	});

	it('name every mode in the dialog of a rule, "Keine" first', () => {
		expect(Object.keys(web.ASSIGNEE_MODE_LABELS)).toEqual(['', ...hook.MODES]);
	});
});

describe('the person of the next occurrences', () => {
	it('is the same in the SPA and in the hook for every generated rule', () => {
		for (const rule of rules(400, 0x2f6b1)) {
			const label = JSON.stringify(rule);
			expect(web.nextAssignee(rule), label).toEqual(hook.nextAssignee(rule));
			expect(web.upcomingAssignees(rule, 3), label).toEqual(hook.upcoming(rule, 3));
		}
	});

	it('follows a rotation with its pointer round and round', () => {
		const rule = { mode: 'rotate', assignees: [PEOPLE[0], PEOPLE[1], PEOPLE[2]], next: 1 };
		expect(web.upcomingAssignees(rule, 4)).toEqual([PEOPLE[1], PEOPLE[2], PEOPLE[0], PEOPLE[1]]);
		expect(hook.upcoming(rule, 4)).toEqual([PEOPLE[1], PEOPLE[2], PEOPLE[0], PEOPLE[1]]);
	});

	it('shows the list in the order of the coming occurrences, which the hook then follows from 0', () => {
		for (const rule of rules(200, 0x51a7)) {
			const order = web.rotationOrder(rule);
			const sent = { mode: web.assigneeModeOf(rule.mode), assignees: order, next: 0 };
			if (sent.mode === 'rotate') {
				expect(hook.upcoming(sent, 3), JSON.stringify(rule)).toEqual(hook.upcoming(rule, 3));
			}
		}
	});

	it('sends an unchanged assignment not at all and a changed one with the pointer 0', () => {
		const stored = { mode: 'rotate', assignees: [PEOPLE[0], PEOPLE[1]], next: 1 };
		const shown = web.formAssignmentOf(stored);
		expect(shown).toEqual({ mode: 'rotate', assignees: [PEOPLE[1], PEOPLE[0]] });
		expect(web.assignmentBody(shown, stored)).toEqual({});
		const body = web.assignmentBody({ ...shown, assignees: [...shown.assignees, PEOPLE[2]] }, stored);
		expect(body).toEqual({
			assignee_mode: 'rotate',
			assignees: [PEOPLE[1], PEOPLE[0], PEOPLE[2]],
			assignee_next: 0
		});
		// The hook takes it so and names the person shown first.
		const checked = hook.ruleCheck({
			household: 'house0000000001',
			mode: body.assignee_mode,
			assignees: body.assignees,
			next: body.assignee_next,
			nextSent: true,
			listChanged: true,
			householdChanged: false,
			members: PEOPLE
		});
		expect(checked.code).toBe('');
		expect(hook.nextAssignee(checked.value).assignee).toBe(PEOPLE[1]);
	});

	it('refuses in the form what the hook refuses with the same text', () => {
		const cases = [
			{ mode: 'fixed', assignees: [] },
			{ mode: 'fixed', assignees: [PEOPLE[0], PEOPLE[1]] },
			{ mode: 'rotate', assignees: [] }
		];
		for (const form of cases) {
			const problem = web.assignmentProblem(form);
			const checked = hook.ruleCheck({
				household: 'house0000000001',
				mode: form.mode,
				assignees: form.assignees,
				next: 0,
				nextSent: false,
				listChanged: true,
				householdChanged: false,
				members: PEOPLE
			});
			// "Fest" with two people (left from "Abwechselnd") sends only the first one, which the hook takes.
			if (form.mode === 'fixed' && form.assignees.length === 2) {
				expect(problem).toBeNull();
				expect(web.assignmentBody(form, null).assignees).toEqual([PEOPLE[0]]);
				continue;
			}
			expect(problem, JSON.stringify(form)).toBe(hook.MESSAGES[checked.code]);
		}
		expect(web.assignmentProblem({ mode: '', assignees: [] })).toBeNull();
		expect(web.assignmentProblem({ mode: 'rotate', assignees: [PEOPLE[0]] })).toBeNull();
	});
});
