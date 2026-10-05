import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { SCOPE_FIELD_MESSAGES, SCOPE_MESSAGE } from '../../web/src/lib/domain/area.ts';

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

	it('names the area in the text of every field, the same in the web app (E7-3, ADR-0059 §4)', () => {
		for (const field of ['project', 'tags', 'parent', 'recurrence', 'blocker', 'blocked', 'source']) {
			expect(rules.scopeMessage(field), field).toMatch(/Bereich/);
			expect(SCOPE_FIELD_MESSAGES[field], field).toBe(rules.scopeMessage(field));
		}
		expect(rules.scopeMessage('unbekannt')).toBe(rules.SCOPE_MESSAGE);
		expect(SCOPE_MESSAGE).toBe(rules.SCOPE_MESSAGE);
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

describe('archivedProjectViolation (E3 plan, T-11)', () => {
	const ARCHIVED = 'validation_project_archived';

	it.each([
		['create in an archived project', { project: 'p1', previousProject: '', archived: true }, ARCHIVED],
		['move into an archived project', { project: 'p2', previousProject: 'p1', archived: true }, ARCHIVED],
		['move from no project into an archived one', { project: 'p2', previousProject: '', archived: true }, ARCHIVED],
		['stay in the archived project', { project: 'p1', previousProject: 'p1', archived: true }, ''],
		['leave the archived project', { project: '', previousProject: 'p1', archived: false }, ''],
		['create in an active project', { project: 'p1', previousProject: '', archived: false }, ''],
		['move into an active project', { project: 'p2', previousProject: 'p1', archived: false }, ''],
		['create without project', { project: '', previousProject: '', archived: false }, '']
	])('%s', (_name, input, expected) => {
		expect(rules.archivedProjectViolation(input)).toBe(expected);
	});
});

describe('completionDecision (ADR-0033 section 2)', () => {
	const blocked = { wasDone: false, isDone: true, openBlocking: 2, force: false, completeChildren: false };

	it.each([
		['refuses a completion with open blocking sub-tickets', blocked, 'refuse'],
		['completes anyway with force', { ...blocked, force: true }, 'force'],
		['completes the sub-tickets with complete_children', { ...blocked, completeChildren: true }, 'complete_children'],
		['prefers complete_children over force', { ...blocked, force: true, completeChildren: true }, 'complete_children'],
		['has nothing to do without blocking sub-tickets', { ...blocked, openBlocking: 0 }, 'none'],
		['has nothing to do when the ticket stays open', { ...blocked, isDone: false }, 'none'],
		['has nothing to do when the ticket was done already', { ...blocked, wasDone: true }, 'none'],
		['ignores the flags without blocking sub-tickets', { ...blocked, openBlocking: 0, force: true }, 'none']
	])('%s', (_name, input, expected) => {
		expect(rules.completionDecision(input)).toBe(expected);
	});
});

describe('isTrueFlag', () => {
	it('takes JSON true and the text "true" only', () => {
		expect(rules.isTrueFlag(true)).toBe(true);
		expect(rules.isTrueFlag('true')).toBe(true);
		for (const value of [false, 'false', 1, '1', 'yes', '', null, undefined, {}]) {
			expect(rules.isTrueFlag(value), String(value)).toBe(false);
		}
	});
});

describe('pinnedCommentViolation (ADR-0044 section 2)', () => {
	const pin = { isCreate: false, pinned: 'c1', previous: '', commentTicket: 't1', ticketId: 't1' };

	it.each([
		['pins a comment of the ticket', pin, ''],
		['replaces the pinned comment with another of the ticket', { ...pin, previous: 'c0' }, ''],
		['releases the pin', { ...pin, pinned: '', previous: 'c1', commentTicket: null }, ''],
		['lets an unchanged pin pass, even if its comment is gone', { ...pin, previous: 'c1', commentTicket: null }, ''],
		['refuses a comment of another ticket', { ...pin, commentTicket: 't2' }, 'validation_pinned_comment_foreign'],
		['refuses a comment that does not exist', { ...pin, commentTicket: null }, 'validation_pinned_comment_missing'],
		['refuses a pin on create', { ...pin, isCreate: true, ticketId: '' }, 'validation_pinned_comment_create'],
		['lets a create without a pin pass', { ...pin, isCreate: true, pinned: '', ticketId: '' }, '']
	])('%s', (_name, input, expected) => {
		expect(rules.pinnedCommentViolation(input)).toBe(expected);
	});

	it('has a German text for every code', () => {
		for (const code of [
			'validation_pinned_comment_create',
			'validation_pinned_comment_missing',
			'validation_pinned_comment_foreign'
		]) {
			expect(rules.PIN_MESSAGES[code], code).toMatch(/\S/);
		}
		expect(Object.isFrozen(rules.PIN_MESSAGES)).toBe(true);
	});
});
