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
