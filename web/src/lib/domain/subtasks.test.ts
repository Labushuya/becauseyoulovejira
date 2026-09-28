// Sub-tasks (ADR-0033): order and progress of the section "Unteraufgaben", the path of a sub-task
// and the texts. The texts of the hook codes are compared with the hook in
// tests/unit/web-subtasks.test.mjs.

import { describe, expect, it } from 'vitest';
import {
	compareSubtasks,
	openChildrenMessage,
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
