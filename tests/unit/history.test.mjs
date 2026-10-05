import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const { TRACKED_FIELDS, diff, serialize } = loadHookLib('history.js');

const BASE = {
	title: 'Steuer',
	description: '',
	status: 'open',
	priority: 'medium',
	due: '2026-10-01 00:00:00.000Z',
	project: 'proj1',
	tags: ['b', 'a'],
	parent: '',
	blocks_parent: true,
	recurrence: '',
	key: 'ABC-1',
	household: '',
	pinned_comment: '',
	color: '',
	charm: '',
	kind: 'task'
};

describe('TRACKED_FIELDS', () => {
	it('matches the whitelist of the E1 plan (OF-12) plus the pinned comment (ADR-0044) and the color (ADR-0052), since ADR-0062 the charm, since ADR-0065 the kind, since ADR-0068 the assignee', () => {
		expect([...TRACKED_FIELDS]).toEqual([
			'title',
			'description',
			'status',
			'priority',
			'due',
			'project',
			'tags',
			'parent',
			'blocks_parent',
			'recurrence',
			'key',
			'household',
			'pinned_comment',
			'color',
			'charm',
			'kind',
			'assignee'
		]);
		expect(Object.isFrozen(TRACKED_FIELDS)).toBe(true);
	});

	it('records a new and a removed assignee with the account IDs (ADR-0068)', () => {
		expect(diff(BASE, { ...BASE, assignee: 'anna00000000001' })).toEqual([
			{ field: 'assignee', old_value: '', new_value: 'anna00000000001' }
		]);
		expect(diff({ ...BASE, assignee: 'anna00000000001' }, BASE)).toEqual([
			{ field: 'assignee', old_value: 'anna00000000001', new_value: '' }
		]);
	});

	it('records a change of the kind of a ticket both ways (ADR-0065)', () => {
		expect(diff(BASE, { ...BASE, kind: 'ongoing' })).toEqual([{ field: 'kind', old_value: 'task', new_value: 'ongoing' }]);
		expect(diff({ ...BASE, kind: 'ongoing' }, BASE)).toEqual([{ field: 'kind', old_value: 'ongoing', new_value: 'task' }]);
	});

	it('records setting, changing and clearing the charm of a ticket (ADR-0062)', () => {
		expect(diff(BASE, { ...BASE, charm: 'geburtstag' })).toEqual([
			{ field: 'charm', old_value: '', new_value: 'geburtstag' }
		]);
		expect(diff({ ...BASE, charm: 'geburtstag' }, { ...BASE, charm: 'flugzeug' })).toEqual([
			{ field: 'charm', old_value: 'geburtstag', new_value: 'flugzeug' }
		]);
		expect(diff({ ...BASE, charm: 'flugzeug' }, BASE)).toEqual([
			{ field: 'charm', old_value: 'flugzeug', new_value: '' }
		]);
	});

	it('records setting, changing and clearing the own color of a ticket (ADR-0052)', () => {
		expect(diff(BASE, { ...BASE, color: 'blau' })).toEqual([
			{ field: 'color', old_value: '', new_value: 'blau' }
		]);
		expect(diff({ ...BASE, color: 'blau' }, { ...BASE, color: 'gruen' })).toEqual([
			{ field: 'color', old_value: 'blau', new_value: 'gruen' }
		]);
		expect(diff({ ...BASE, color: 'gruen' }, BASE)).toEqual([
			{ field: 'color', old_value: 'gruen', new_value: '' }
		]);
	});

	it('records pinning, replacing and releasing a comment (ADR-0044)', () => {
		expect(diff(BASE, { ...BASE, pinned_comment: 'c1' })).toEqual([
			{ field: 'pinned_comment', old_value: '', new_value: 'c1' }
		]);
		expect(diff({ ...BASE, pinned_comment: 'c1' }, { ...BASE, pinned_comment: 'c2' })).toEqual([
			{ field: 'pinned_comment', old_value: 'c1', new_value: 'c2' }
		]);
		expect(diff({ ...BASE, pinned_comment: 'c2' }, BASE)).toEqual([
			{ field: 'pinned_comment', old_value: 'c2', new_value: '' }
		]);
	});
});

describe('diff', () => {
	it('returns no entries for unchanged values', () => {
		expect(diff(BASE, { ...BASE })).toEqual([]);
	});

	it('returns one entry per changed field in whitelist order', () => {
		const changed = { ...BASE, status: 'done', title: 'Steuererklärung', key: 'TASK-3' };
		expect(diff(BASE, changed)).toEqual([
			{ field: 'title', old_value: 'Steuer', new_value: 'Steuererklärung' },
			{ field: 'status', old_value: 'open', new_value: 'done' },
			{ field: 'key', old_value: 'ABC-1', new_value: 'TASK-3' }
		]);
	});

	it('ignores fields outside the whitelist', () => {
		const changed = {
			...BASE,
			completed_at: '2026-09-24 10:00:00.000Z',
			number: 7,
			scope: 'h:x',
			owner: 'other',
			updated: 'now'
		};
		expect(diff(BASE, changed)).toEqual([]);
	});

	it('treats tags independent of order and stores them as sorted JSON', () => {
		expect(diff(BASE, { ...BASE, tags: ['a', 'b'] })).toEqual([]);
		expect(diff(BASE, { ...BASE, tags: ['c', 'a', 'b'] })).toEqual([
			{ field: 'tags', old_value: '["a","b"]', new_value: '["a","b","c"]' }
		]);
	});

	it('treats empty, null and missing values alike', () => {
		const empty = { title: '', tags: [], project: '', due: '' };
		const nulls = { title: null, tags: null, project: null, due: undefined };
		expect(diff(empty, nulls)).toEqual([]);
		expect(diff({}, nulls)).toEqual([]);
		expect(diff(null, undefined)).toEqual([]);
		expect(diff({}, { tags: '' })).toEqual([]);
	});

	it('records setting and clearing values', () => {
		expect(diff({ ...BASE, parent: null }, { ...BASE, parent: 't1' })).toEqual([
			{ field: 'parent', old_value: '', new_value: 't1' }
		]);
		expect(diff(BASE, { ...BASE, tags: [] })).toEqual([
			{ field: 'tags', old_value: '["a","b"]', new_value: '' }
		]);
	});

	it('serializes booleans and numbers as strings', () => {
		expect(diff(BASE, { ...BASE, blocks_parent: false })).toEqual([
			{ field: 'blocks_parent', old_value: 'true', new_value: 'false' }
		]);
		expect(serialize('title', 5)).toBe('5');
	});

	it('does not modify the input arrays', () => {
		const tags = ['z', 'a'];
		diff({ tags }, { tags: ['a'] });
		expect(tags).toEqual(['z', 'a']);
	});

	it('wraps a single tag string as one-element list', () => {
		expect(serialize('tags', 'a')).toBe('["a"]');
		expect(diff({ tags: 'a' }, { tags: ['a'] })).toEqual([]);
	});

	it('rejects unsupported value types instead of logging them', () => {
		expect(() => diff({}, { due: new Date(0) })).toThrow(TypeError);
		expect(() => diff({}, { title: { value: 'x' } })).toThrow(TypeError);
		expect(() => diff({}, { tags: [1] })).toThrow(TypeError);
		expect(() => diff({}, { tags: { a: 1 } })).toThrow(TypeError);
	});
});
