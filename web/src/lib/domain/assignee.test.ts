// "Zuständig" (E7-5, ADR-0068) in the SPA: names, initials and the stable color of an account, the
// filter and the groups, the texts of history and notice, the form of a rule and its preview. The
// parity with the hook is in tests/unit/web-assignee.test.mjs.

import { describe, expect, it } from 'vitest';
import {
	NOBODY,
	assignedNoticeText,
	assigneeColor,
	assigneeGroupLabel,
	assigneeGroupOrder,
	assigneeHistoryText,
	assigneeInitials,
	assigneeName,
	assigneeTitle,
	assignmentBody,
	assignmentProblem,
	formAssignmentOf,
	isAssignedTo,
	matchesAssignee,
	rotationOrder,
	rotationPreviewText,
	type AssigneeContext
} from './assignee';
import { PROJECT_COLORS } from './colors';

const SELF = 'anna00000000001';
const BERT = 'bert00000000002';
const CLARA = 'clar00000000003';
const NAMES: Record<string, string> = { [BERT]: 'Bert Beispiel', [CLARA]: 'Clara Beispiel' };
const CONTEXT: AssigneeContext = {
	selfId: SELF,
	selfName: 'Anna Beispiel',
	names: { nameOf: (id) => NAMES[id] ?? null }
};

describe('names and initials', () => {
	it('names the own account, another member and an unknown account', () => {
		expect(assigneeName(SELF, CONTEXT)).toBe('Anna Beispiel');
		expect(assigneeName(SELF, { ...CONTEXT, selfName: ' ' })).toBe('Du');
		expect(assigneeName(BERT, CONTEXT)).toBe('Bert Beispiel');
		expect(assigneeName('gone00000000009', CONTEXT)).toBe('Anderes Konto');
		expect(assigneeName(BERT, { ...CONTEXT, names: null })).toBe('Anderes Konto');
	});

	it('takes the first letters of the first and the last word', () => {
		expect(assigneeInitials('Anna Beispiel')).toBe('AB');
		expect(assigneeInitials('clara maria beispiel')).toBe('CB');
		expect(assigneeInitials('Bert')).toBe('B');
		expect(assigneeInitials('  ')).toBe('?');
		expect(assigneeTitle('Bert Beispiel')).toBe('Zuständig: Bert Beispiel');
	});
});

describe('assigneeColor', () => {
	it('is a color of the palette and always the same for the same account', () => {
		for (const id of [SELF, BERT, CLARA, 'x', '']) {
			expect(PROJECT_COLORS).toContain(assigneeColor(id));
			expect(assigneeColor(id)).toBe(assigneeColor(`${id}`));
		}
	});

	it('spreads accounts over the palette', () => {
		const ids = Array.from({ length: 60 }, (_, i) => `user${String(i).padStart(11, '0')}`);
		expect(new Set(ids.map(assigneeColor)).size).toBeGreaterThan(PROJECT_COLORS.length / 2);
	});
});

describe('filter, card and groups', () => {
	it('"Mir zugewiesen" is only the own account', () => {
		expect(isAssignedTo({ assignee: SELF }, SELF)).toBe(true);
		expect(isAssignedTo({ assignee: BERT }, SELF)).toBe(false);
		expect(isAssignedTo({ assignee: null }, SELF)).toBe(false);
		expect(isAssignedTo({}, SELF)).toBe(false);
		expect(isAssignedTo({ assignee: SELF }, null)).toBe(false);
	});

	it('"Zuständig" filters by a person or "Niemand"', () => {
		expect(matchesAssignee({ assignee: BERT }, BERT)).toBe(true);
		expect(matchesAssignee({ assignee: SELF }, BERT)).toBe(false);
		expect(matchesAssignee({ assignee: null }, NOBODY)).toBe(true);
		expect(matchesAssignee({}, NOBODY)).toBe(true);
		expect(matchesAssignee({ assignee: BERT }, NOBODY)).toBe(false);
		expect(matchesAssignee({ assignee: BERT }, null)).toBe(true);
	});

	it('orders the groups: the own account, the others by name, "Niemand" last', () => {
		expect(assigneeGroupOrder([CLARA, '', BERT, SELF, CLARA], CONTEXT)).toEqual([
			SELF,
			BERT,
			CLARA,
			''
		]);
		expect(assigneeGroupLabel('', CONTEXT)).toBe('Niemand');
		expect(assigneeGroupLabel(CLARA, CONTEXT)).toBe('Clara Beispiel');
	});
});

describe('texts', () => {
	it('writes the history and the notice', () => {
		expect(assigneeHistoryText(BERT, CONTEXT)).toBe('Zuständig: Bert Beispiel');
		expect(assigneeHistoryText('', CONTEXT)).toBe('Zuständigkeit entfernt');
		expect(assignedNoticeText('Bert Beispiel', 'HAUS-12')).toBe(
			'Bert Beispiel hat dir HAUS-12 zugewiesen.'
		);
		expect(assignedNoticeText('', 'HAUS-12')).toBe('Jemand hat dir HAUS-12 zugewiesen.');
	});

	it('previews the next two occurrences', () => {
		expect(rotationPreviewText(['Bert', 'Anna'], 'rotate')).toBe(
			'Nächstes Vorkommen: Bert, danach: Anna'
		);
		expect(rotationPreviewText(['Bert'], 'rotate')).toBe('Jedes Vorkommen: Bert');
		expect(rotationPreviewText(['Bert', 'Anna'], 'fixed')).toBe('Jedes Vorkommen: Bert');
		expect(rotationPreviewText([], 'rotate')).toBe('');
	});
});

describe('the form of a rule', () => {
	it('shows a rotation from the person of the next occurrence', () => {
		const stored = { mode: 'rotate' as const, assignees: [SELF, BERT, CLARA], next: 2 };
		expect(rotationOrder(stored)).toEqual([CLARA, SELF, BERT]);
		expect(formAssignmentOf(stored)).toEqual({ mode: 'rotate', assignees: [CLARA, SELF, BERT] });
		expect(formAssignmentOf(null)).toEqual({ mode: '', assignees: [] });
		expect(formAssignmentOf({ mode: '', assignees: [BERT], next: 0 })).toEqual({
			mode: '',
			assignees: []
		});
	});

	it('sends nothing for a new rule without a mode and a changed assignment with the pointer 0', () => {
		expect(assignmentBody(undefined, null)).toEqual({});
		expect(assignmentBody({ mode: '', assignees: [] }, null)).toEqual({});
		expect(assignmentBody({ mode: 'fixed', assignees: [BERT, SELF] }, null)).toEqual({
			assignee_mode: 'fixed',
			assignees: [BERT],
			assignee_next: 0
		});
		const stored = { mode: 'fixed' as const, assignees: [BERT], next: 0 };
		expect(assignmentBody({ mode: '', assignees: [] }, stored)).toEqual({
			assignee_mode: '',
			assignees: [],
			assignee_next: 0
		});
	});

	it('checks the people before sending', () => {
		expect(assignmentProblem({ mode: 'fixed', assignees: [] })).toBe(
			'Bitte genau eine Person wählen.'
		);
		expect(assignmentProblem({ mode: 'rotate', assignees: ['', ''] })).toBe(
			'Bitte mindestens eine Person wählen.'
		);
		const many = Array.from({ length: 11 }, (_, i) => `user${String(i).padStart(11, '0')}`);
		expect(assignmentProblem({ mode: 'rotate', assignees: many })).toBe('Höchstens 10 Personen.');
		expect(assignmentProblem({ mode: 'rotate', assignees: [BERT, BERT] })).toBeNull();
	});
});
