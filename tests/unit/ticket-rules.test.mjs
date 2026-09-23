import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('ticket-rules.js');

describe('createDefaults', () => {
	it('sets status open and priority medium when empty (OF-11)', () => {
		expect(rules.createDefaults({ status: '', priority: '' })).toEqual({
			status: 'open',
			priority: 'medium'
		});
		expect(rules.createDefaults({})).toEqual({ status: 'open', priority: 'medium' });
		expect(rules.createDefaults({ status: null, priority: undefined })).toEqual({
			status: 'open',
			priority: 'medium'
		});
	});

	it('keeps values sent by the client', () => {
		expect(rules.createDefaults({ status: 'backlog', priority: 'urgent' })).toEqual({});
		expect(rules.createDefaults({ status: 'done', priority: '' })).toEqual({ priority: 'medium' });
	});
});

describe('needsNewKey', () => {
	const before = { key: 'ABC-3', scope: 'u:a', project: 'p1' };

	it('keeps the key when scope and project stay the same', () => {
		expect(rules.needsNewKey(before, { scope: 'u:a', project: 'p1' })).toBe(false);
	});

	it('draws a new key when the project changes, including to and from no project', () => {
		expect(rules.needsNewKey(before, { scope: 'u:a', project: 'p2' })).toBe(true);
		expect(rules.needsNewKey(before, { scope: 'u:a', project: '' })).toBe(true);
		expect(
			rules.needsNewKey({ key: 'TASK-1', scope: 'u:a', project: '' }, { scope: 'u:a', project: 'p1' })
		).toBe(true);
	});

	it('draws a new key when the scope changes', () => {
		expect(rules.needsNewKey(before, { scope: 'h:h1', project: 'p1' })).toBe(true);
	});

	it('draws a key when none is stored yet', () => {
		expect(rules.needsNewKey({ key: '', scope: 'u:a', project: '' }, { scope: 'u:a', project: '' })).toBe(
			true
		);
	});

	it('treats missing and empty project as equal', () => {
		expect(
			rules.needsNewKey({ key: 'TASK-1', scope: 'u:a', project: undefined }, { scope: 'u:a', project: '' })
		).toBe(false);
	});
});

describe('scopeViolations', () => {
	it('returns nothing when every related record is in the scope', () => {
		expect(
			rules.scopeViolations('u:a', [
				{ field: 'project', scope: 'u:a' },
				{ field: 'tags', scope: 'u:a' }
			])
		).toEqual([]);
		expect(rules.scopeViolations('u:a', [])).toEqual([]);
	});

	it('reports each field with a foreign or missing record once (OF-3 c)', () => {
		expect(
			rules.scopeViolations('h:h1', [
				{ field: 'project', scope: 'u:a' },
				{ field: 'tags', scope: 'h:h1' },
				{ field: 'tags', scope: null },
				{ field: 'tags', scope: 'h:h2' },
				{ field: 'recurrence', scope: 'h:h1' }
			])
		).toEqual(['project', 'tags']);
	});
});

describe('completedAtAction', () => {
	it('sets completed_at when a ticket becomes done', () => {
		expect(rules.completedAtAction(true, '', 'done')).toBe('set');
		expect(rules.completedAtAction(false, 'open', 'done')).toBe('set');
		expect(rules.completedAtAction(false, 'waiting', 'done')).toBe('set');
	});

	it('keeps completed_at while the ticket stays done', () => {
		expect(rules.completedAtAction(false, 'done', 'done')).toBe('keep');
	});

	it('clears completed_at for every other status', () => {
		for (const status of ['backlog', 'open', 'in_progress', 'waiting']) {
			expect(rules.completedAtAction(true, '', status)).toBe('clear');
			expect(rules.completedAtAction(false, 'done', status)).toBe('clear');
			expect(rules.completedAtAction(false, 'open', status)).toBe('clear');
		}
	});
});

describe('isCalendarDate', () => {
	it('accepts empty values and midnight UTC in PocketBase format', () => {
		expect(rules.isCalendarDate('')).toBe(true);
		expect(rules.isCalendarDate('2026-10-01 00:00:00.000Z')).toBe(true);
		expect(rules.isCalendarDate('2028-02-29 00:00:00.000Z')).toBe(true);
	});

	it('rejects times of day and other formats', () => {
		expect(rules.isCalendarDate('2026-10-01 12:30:00.000Z')).toBe(false);
		expect(rules.isCalendarDate('2026-10-01 00:00:00.001Z')).toBe(false);
		expect(rules.isCalendarDate('2026-10-01')).toBe(false);
		expect(rules.isCalendarDate('2026-10-01T00:00:00.000Z')).toBe(false);
		expect(rules.isCalendarDate(null)).toBe(false);
	});
});

describe('parentViolation', () => {
	const allowed = {
		id: 'child',
		parent: 'parent',
		parentExists: true,
		parentParent: '',
		hasChildren: false
	};

	it('allows no parent and a top-level parent', () => {
		expect(rules.parentViolation({ ...allowed, parent: '' })).toBe('');
		expect(rules.parentViolation(allowed)).toBe('');
		expect(rules.parentViolation({ ...allowed, id: '' })).toBe('');
	});

	it('rejects the ticket itself as parent', () => {
		expect(rules.parentViolation({ ...allowed, parent: 'child', parentExists: false })).toBe(
			'validation_parent_self'
		);
	});

	it('rejects a parent that is a sub-ticket itself', () => {
		expect(rules.parentViolation({ ...allowed, parentParent: 'grandparent' })).toBe(
			'validation_parent_nested'
		);
	});

	it('rejects a parent for a ticket that has sub-tickets', () => {
		expect(rules.parentViolation({ ...allowed, hasChildren: true })).toBe(
			'validation_parent_has_children'
		);
	});

	it('leaves missing parents to the scope check', () => {
		expect(rules.parentViolation({ ...allowed, parentExists: false })).toBe('');
	});
});
