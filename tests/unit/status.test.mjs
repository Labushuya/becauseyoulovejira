import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import * as frontend from '../../web/src/lib/domain/status.ts';

const hook = loadHookLib('status.js');

const EXPECTED_CATEGORY = {
	backlog: 'open',
	open: 'open',
	in_progress: 'active',
	waiting: 'active',
	done: 'closed'
};

describe('status.js (hook)', () => {
	it('lists exactly the statuses of CLAUDE.md in order', () => {
		expect([...hook.STATUSES]).toEqual(['backlog', 'open', 'in_progress', 'waiting', 'done']);
	});

	it('lists exactly the priorities of CLAUDE.md in order', () => {
		expect([...hook.PRIORITIES]).toEqual(['low', 'medium', 'high', 'urgent']);
	});

	it.each(Object.entries(EXPECTED_CATEGORY))('maps %s to category %s', (status, category) => {
		expect(hook.categoryOf(status)).toBe(category);
		expect(hook.STATUS_CATEGORY[status]).toBe(category);
	});

	it('returns null for unknown statuses', () => {
		for (const value of ['', 'DONE', 'closed', 'toString', null, undefined, 1]) {
			expect(hook.categoryOf(value)).toBeNull();
			expect(hook.isStatus(value)).toBe(false);
		}
	});

	it('validates priorities', () => {
		for (const priority of hook.PRIORITIES) expect(hook.isPriority(priority)).toBe(true);
		for (const value of ['', 'Low', 'critical', null, undefined]) {
			expect(hook.isPriority(value)).toBe(false);
		}
	});

	it('treats only done as done', () => {
		expect(hook.STATUSES.filter((status) => hook.isDone(status))).toEqual(['done']);
		expect(hook.isDone(undefined)).toBe(false);
	});

	it('covers every category and freezes all lists', () => {
		expect(new Set(Object.values(hook.STATUS_CATEGORY))).toEqual(new Set(hook.CATEGORIES));
		expect(Object.isFrozen(hook.STATUSES)).toBe(true);
		expect(Object.isFrozen(hook.PRIORITIES)).toBe(true);
		expect(Object.isFrozen(hook.CATEGORIES)).toBe(true);
		expect(Object.isFrozen(hook.STATUS_CATEGORY)).toBe(true);
	});
});

describe('status.ts (frontend mirror)', () => {
	it('has identical statuses, priorities and categories', () => {
		expect([...frontend.STATUSES]).toEqual([...hook.STATUSES]);
		expect([...frontend.PRIORITIES]).toEqual([...hook.PRIORITIES]);
		expect([...frontend.CATEGORIES]).toEqual([...hook.CATEGORIES]);
		expect({ ...frontend.STATUS_CATEGORY }).toEqual({ ...hook.STATUS_CATEGORY });
	});

	it('behaves identically for known and unknown values', () => {
		const samples = [...hook.STATUSES, ...hook.PRIORITIES, '', 'DONE', 'toString', null, undefined];
		for (const value of samples) {
			expect(frontend.categoryOf(value)).toBe(hook.categoryOf(value));
			expect(frontend.isStatus(value)).toBe(hook.isStatus(value));
			expect(frontend.isPriority(value)).toBe(hook.isPriority(value));
			expect(frontend.isDone(value)).toBe(hook.isDone(value));
		}
	});
});
