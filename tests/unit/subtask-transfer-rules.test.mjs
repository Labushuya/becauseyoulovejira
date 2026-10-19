// "Auf Unteraufgaben übertragen …" (UE-1, ADR-0070): the pure rules of the route
// (app/pb_hooks/lib/subtask-transfer-rules.js). The request names fields and targets, never values;
// the changes per sub-task follow from the parent, and a sub-task that has every value already does
// not change. `shift` and `remove` are the parts of the route for UE-2.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('subtask-transfer-rules.js');
const berlinTime = loadHookLib('berlin-time.js');
const shift = (date, days) => berlinTime.addDays(date, days);

const NONE = { due: null, priority: false, status: false, assignee: false, project: false, tags: null };
const request = (body) => rules.parseRequest({ expected_updated: '2026-10-19 10:00:00.000Z', targets: 'open', ...body });

describe('parseRequest', () => {
	it('reads the fields, the targets and the expected state of the parent', () => {
		expect(
			request({
				fields: { due: { mode: 'same' }, priority: true, status: false, tags: { add: ['tag000000000001'] }, project: true },
				targets: ['child0000000001', 'child0000000002']
			})
		).toEqual({
			options: {
				expected: '2026-10-19 10:00:00.000Z',
				fields: {
					...NONE,
					due: { mode: 'same' },
					priority: true,
					project: true,
					tags: { add: ['tag000000000001'], remove: [] }
				},
				targets: ['child0000000001', 'child0000000002']
			}
		});
		expect(request({ fields: { assignee: true } }).options.targets).toBe('open');
	});

	it('takes a due date moved by 1 to 3650 days either way, and tags to remove (UE-2)', () => {
		expect(request({ fields: { due: { mode: 'shift', days: -7 } } }).options.fields.due).toEqual({ mode: 'shift', days: -7 });
		expect(request({ fields: { due: { mode: 'shift', days: 3650 } } }).options.fields.due.days).toBe(3650);
		expect(request({ fields: { tags: { remove: ['tag000000000002'] } } }).options.fields.tags).toEqual({
			add: [],
			remove: ['tag000000000002']
		});
		for (const due of [{ mode: 'shift', days: 0 }, { mode: 'shift', days: 3651 }, { mode: 'shift', days: 1.5 }, { mode: 'shift' }, { mode: 'later' }, { mode: 'same', days: 2 }, 'same', true]) {
			expect(request({ fields: { due } }), JSON.stringify(due)).toEqual({ field: 'due', code: 'validation_transfer_due' });
		}
	});

	it('refuses tags without any, twice, in both lists or over the limit', () => {
		const many = Array.from({ length: rules.TAGS_MAX + 1 }, (_, index) => `tag${index}`);
		for (const tags of [{}, { add: [] }, { add: ['a', 'a'] }, { add: ['a'], remove: ['a'] }, { add: many }, { add: [''] }, { add: 'a' }, true]) {
			expect(request({ fields: { tags } }), JSON.stringify(tags)).toEqual({ field: 'tags', code: 'validation_transfer_tags' });
		}
	});

	it('needs the expected state, at least one known field and at least one target, at most 200', () => {
		expect(rules.parseRequest({ fields: { priority: true }, targets: 'open' })).toEqual({
			field: 'expected_updated',
			code: 'validation_transfer_expected'
		});
		expect(request({ fields: {} })).toEqual({ field: 'fields', code: 'validation_transfer_fields' });
		expect(request({ fields: { priority: false } })).toEqual({ field: 'fields', code: 'validation_transfer_fields' });
		expect(request({})).toEqual({ field: 'fields', code: 'validation_transfer_fields' });
		// Title, description, series and kind never go to sub-tasks.
		for (const name of ['title', 'description', 'recurrence', 'kind']) {
			expect(request({ fields: { [name]: true } })).toEqual({ field: 'fields', code: 'validation_transfer_field', params: { field: name } });
		}
		expect(request({ fields: { priority: 'yes' } })).toEqual({ field: 'fields', code: 'validation_transfer_field', params: { field: 'priority' } });
		const ids = (count) => Array.from({ length: count }, (_, index) => `child${String(index).padStart(10, '0')}`);
		expect(request({ fields: { priority: true }, targets: ids(rules.TARGETS_MAX) }).options.targets).toHaveLength(200);
		expect(request({ fields: { priority: true }, targets: ids(201) })).toEqual({ field: 'targets', code: 'validation_transfer_targets_max' });
		for (const targets of [[], ['a', 'a'], 'all', undefined, [''], [5]]) {
			expect(request({ fields: { priority: true }, targets }), JSON.stringify(targets)).toEqual({
				field: 'targets',
				code: 'validation_transfer_targets'
			});
		}
	});

	it('names every code it gives with a text', () => {
		for (const code of Object.keys(rules.MESSAGES)) expect(rules.MESSAGES[code].length, code).toBeGreaterThan(10);
		expect(rules.STALE_MESSAGE).toBe('Das Hauptticket wurde inzwischen geändert. Bitte erneut öffnen.');
	});
});

describe('tagsViolation', () => {
	it('adds only tags of the parent and removes only tags it does not have', () => {
		const parentTags = ['a', 'b'];
		expect(rules.tagsViolation(null, parentTags)).toBe('');
		expect(rules.tagsViolation({ add: ['a'], remove: ['c'] }, parentTags)).toBe('');
		expect(rules.tagsViolation({ add: ['c'], remove: [] }, parentTags)).toBe('validation_transfer_tags');
		expect(rules.tagsViolation({ add: [], remove: ['b'] }, parentTags)).toBe('validation_transfer_tags');
	});
});

describe('changesOf', () => {
	const parent = { due: '2026-11-20', priority: 'high', status: 'in_progress', assignee: 'user0000000000a', project: 'proj00000000001', tags: ['a'] };
	const child = { due: '', priority: 'medium', status: 'open', assignee: '', project: '', tags: ['x'] };

	it('gives the chosen fields the values of the parent and keeps the own tags', () => {
		expect(
			rules.changesOf(parent, child, { due: { mode: 'same' }, priority: true, status: true, assignee: true, project: true, tags: { add: ['a'], remove: [] } }, shift)
		).toEqual({ due: '2026-11-20', priority: 'high', status: 'in_progress', assignee: 'user0000000000a', project: 'proj00000000001', tags: ['x', 'a'] });
		expect(rules.changesOf(parent, child, { ...NONE, priority: true }, shift)).toEqual({ priority: 'high' });
	});

	it('takes "no due date" of the parent as well', () => {
		expect(rules.changesOf({ ...parent, due: '' }, { ...child, due: '2026-12-01' }, { ...NONE, due: { mode: 'same' } }, shift)).toEqual({ due: '' });
	});

	it('counts a sub-task that has every chosen value already as unchanged (null)', () => {
		expect(rules.changesOf(parent, { ...child, priority: 'high' }, { ...NONE, priority: true }, shift)).toBeNull();
		expect(rules.changesOf(parent, { ...child, tags: ['a', 'x'] }, { ...NONE, tags: { add: ['a'], remove: [] } }, shift)).toBeNull();
		expect(rules.changesOf(parent, child, { ...NONE, due: { mode: 'shift', days: 3 } }, shift)).toBeNull();
	});

	it('moves an own due date by the days (UE-2) across months and years', () => {
		expect(rules.changesOf(parent, { ...child, due: '2026-12-30' }, { ...NONE, due: { mode: 'shift', days: 3 } }, shift)).toEqual({ due: '2027-01-02' });
		expect(rules.changesOf(parent, { ...child, due: '2026-03-01' }, { ...NONE, due: { mode: 'shift', days: -1 } }, shift)).toEqual({ due: '2026-02-28' });
	});

	it('removes tags and adds others in one go (UE-2)', () => {
		expect(rules.changesOf(parent, { ...child, tags: ['x', 'y'] }, { ...NONE, tags: { add: ['a'], remove: ['y'] } }, shift)).toEqual({ tags: ['x', 'a'] });
		expect(rules.changesOf(parent, { ...child, tags: ['x'] }, { ...NONE, tags: { add: [], remove: ['y'] } }, shift)).toBeNull();
	});
});
