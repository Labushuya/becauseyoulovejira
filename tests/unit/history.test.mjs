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
	household: ''
};

describe('TRACKED_FIELDS', () => {
	it('matches the whitelist of the E1 plan (OF-12)', () => {
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
			'household'
		]);
		expect(Object.isFrozen(TRACKED_FIELDS)).toBe(true);
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
