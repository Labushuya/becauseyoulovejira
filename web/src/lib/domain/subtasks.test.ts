// Sub-tasks (ADR-0033): order and progress of the section "Unteraufgaben", the path of a sub-task
// and the texts. The texts of the hook codes are compared with the hook in
// tests/unit/web-subtasks.test.mjs.

import { describe, expect, it } from 'vitest';
import {
	COMPLETION_CHOICES,
	COMPLETION_LABELS,
	compareSubtasks,
	completionHint,
	keysText,
	openBlocking,
	openChildrenMessage,
	openChildrenQuestion,
	parentOf,
	progressLabel,
	progressPercent,
	progressText,
	subtaskCountText,
	subtaskProgress
} from './subtasks';

describe('texts of the sub-tasks', () => {
	it('counts one and several sub-tasks', () => {
		expect(subtaskCountText(1)).toBe('1 Unteraufgabe');
		expect(subtaskCountText(3)).toBe('3 Unteraufgaben');
		expect(openChildrenMessage(1)).toBe('1 Unteraufgabe ist noch offen.');
		expect(openChildrenMessage(4)).toBe('4 Unteraufgaben sind noch offen.');
	});
});

describe('order of the sub-tasks', () => {
	const sub = (id: string, status: 'open' | 'done' | 'waiting', created: string) => ({
		id,
		status,
		created
	});

	it('puts open ones first, then sorts by creation and ID', () => {
		const list = [
			sub('d', 'done', '2026-09-01 10:00:00.000Z'),
			sub('c', 'open', '2026-09-03 10:00:00.000Z'),
			sub('b', 'waiting', '2026-09-02 10:00:00.000Z'),
			sub('a', 'open', '2026-09-03 10:00:00.000Z'),
			sub('e', 'done', '2026-08-01 10:00:00.000Z')
		];

		expect([...list].sort(compareSubtasks).map((entry) => entry.id)).toEqual([
			'b',
			'a',
			'c',
			'e',
			'd'
		]);
	});
});

describe('progress of the sub-tasks', () => {
	it('counts the done ones of all', () => {
		const progress = subtaskProgress([
			{ status: 'done' },
			{ status: 'open' },
			{ status: 'done' },
			{ status: 'in_progress' },
			{ status: 'backlog' }
		]);

		expect(progress).toEqual({ done: 2, total: 5 });
		expect(progressText(progress)).toBe('2/5 erledigt');
		expect(progressLabel(progress)).toBe('2 von 5 Unteraufgaben erledigt');
		expect(progressPercent(progress)).toBe(40);
	});

	it('has nothing to show without sub-tasks', () => {
		const progress = subtaskProgress([]);

		expect(progress).toEqual({ done: 0, total: 0 });
		expect(progressPercent(progress)).toBe(0);
		expect(progressLabel({ done: 0, total: 1 })).toBe('0 von 1 Unteraufgabe erledigt');
	});
});

describe('question before completing (ADR-0033 section 2)', () => {
	it('asks with the number of open sub-tasks', () => {
		expect(openChildrenQuestion(1)).toBe('1 Unteraufgabe ist noch offen – trotzdem erledigen?');
		expect(openChildrenQuestion(3)).toBe('3 Unteraufgaben sind noch offen – trotzdem erledigen?');
	});

	it('names up to three keys and counts the rest', () => {
		expect(keysText([])).toBe('');
		expect(keysText(['HAUS-13'])).toBe('HAUS-13');
		expect(keysText(['HAUS-13', 'HAUS-14'])).toBe('HAUS-13 und HAUS-14');
		expect(keysText(['HAUS-13', 'HAUS-14', 'HAUS-15'])).toBe('HAUS-13, HAUS-14 und HAUS-15');
		expect(keysText(['A-1', 'A-2', 'A-3', 'A-4'])).toBe('A-1, A-2, A-3 und 1 weitere');
		expect(keysText(['A-1', 'A-2', 'A-3', 'A-4', 'A-5'], 7)).toBe('A-1, A-2, A-3 und 4 weitere');
	});

	it('says what each answer does', () => {
		expect(COMPLETION_CHOICES).toEqual(['complete_children', 'force']);
		expect(COMPLETION_LABELS).toEqual({
			complete_children: 'Unteraufgaben mit erledigen',
			force: 'Trotzdem erledigen'
		});
		expect(completionHint('complete_children', ['HAUS-13'], 1)).toBe(
			'HAUS-13 wird ebenfalls erledigt.'
		);
		expect(completionHint('complete_children', ['HAUS-13', 'HAUS-14'], 2)).toBe(
			'HAUS-13 und HAUS-14 werden ebenfalls erledigt.'
		);
		expect(completionHint('force', ['HAUS-13'], 1)).toBe('Die Unteraufgabe bleibt offen.');
		expect(completionHint('force', ['HAUS-13', 'HAUS-14'], 2)).toBe(
			'Die Unteraufgaben bleiben offen.'
		);
	});

	it('counts only open sub-tasks that block', () => {
		const list = [
			{ id: 'a', status: 'open' as const, blocksParent: true },
			{ id: 'b', status: 'done' as const, blocksParent: true },
			{ id: 'c', status: 'waiting' as const, blocksParent: false },
			{ id: 'd', status: 'in_progress' as const }
		];

		expect(openBlocking(list).map((entry) => entry.id)).toEqual(['a', 'd']);
	});
});

describe('parentOf', () => {
	const PARENT = { id: 'parent000000001', key: 'HAUS-12', title: 'Umzug' };

	it('is null for a top-level ticket', () => {
		expect(parentOf({ parentId: null }, () => PARENT)).toBeNull();
		expect(parentOf({}, () => PARENT)).toBeNull();
	});

	it('takes the version of the list first, so a new key shows at once', () => {
		const ticket = { parentId: PARENT.id, parentRef: { ...PARENT, key: 'TASK-4' } };

		expect(parentOf(ticket, (id) => (id === PARENT.id ? PARENT : null))).toEqual(PARENT);
		expect(parentOf(ticket, () => null)).toEqual({ ...PARENT, key: 'TASK-4' });
	});

	it('knows only the ID of a parent it cannot resolve', () => {
		expect(parentOf({ parentId: PARENT.id, parentRef: null }, () => null)).toEqual({
			id: PARENT.id,
			key: '…',
			title: ''
		});
	});
});
