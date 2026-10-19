// "Auf Unteraufgaben übertragen …" (UE-1, ADR-0070): the route (app/pb_hooks/lib/subtask-transfer-rules.js)
// and the SPA (web/src/lib/domain/subtask-transfer.ts) name the same fields, limits and texts, the body
// the SPA sends reads on the server as the same request, and both count the same sub-tasks as changing.
// Since UE-2 also the body after a change (web/src/lib/domain/subtask-transfer-change.ts).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	COPIED_FIELDS,
	NO_TRANSFER_FIELDS,
	TRANSFER_FIELDS,
	TRANSFER_MESSAGES,
	TRANSFER_SHIFT_DAYS_MAX,
	TRANSFER_STALE_MESSAGE,
	TRANSFER_TAGS_MAX,
	TRANSFER_TARGETS_MAX,
	changesOf,
	transferRequestBody
} from '../../web/src/lib/domain/subtask-transfer.ts';
import { changeFieldsOf, startParentChange } from '../../web/src/lib/domain/subtask-transfer-change.ts';

const rules = loadHookLib('subtask-transfer-rules.js');
const berlinTime = loadHookLib('berlin-time.js');
const shift = (date, days) => berlinTime.addDays(date, days);

/** The values of the server: '' for no due date. */
const serverValues = (values) => ({ ...values, due: values.due ?? '' });
const serverChanges = (changes) => (changes === null ? null : { ...changes, ...('due' in changes && { due: changes.due ?? '' }) });

describe('fields, limits and texts', () => {
	it('are the same in the SPA and in subtask-transfer-rules.js', () => {
		expect([...TRANSFER_FIELDS]).toEqual([...rules.FIELDS]);
		expect([...COPIED_FIELDS]).toEqual([...rules.COPIED_FIELDS]);
		expect({ ...TRANSFER_MESSAGES }).toEqual({ ...rules.MESSAGES });
		expect(TRANSFER_STALE_MESSAGE).toBe(rules.STALE_MESSAGE);
		expect(TRANSFER_TARGETS_MAX).toBe(rules.TARGETS_MAX);
		expect(TRANSFER_TAGS_MAX).toBe(rules.TAGS_MAX);
		expect(TRANSFER_SHIFT_DAYS_MAX).toBe(rules.SHIFT_DAYS_MAX);
	});
});

describe('the body of the SPA', () => {
	it('reads on the server as the request of the dialog', () => {
		const fields = { ...NO_TRANSFER_FIELDS, due: { mode: 'same' }, status: true, tags: { add: ['tag000000000001'], remove: [] } };
		const body = transferRequestBody({ expectedUpdated: '2026-10-19 10:00:00.000Z', fields, targets: ['child0000000001'] });
		expect(rules.parseRequest(body)).toEqual({
			options: { expected: '2026-10-19 10:00:00.000Z', fields, targets: ['child0000000001'] }
		});
		const open = transferRequestBody({ expectedUpdated: 'x', fields: { ...NO_TRANSFER_FIELDS, project: true, assignee: true }, targets: 'open' });
		expect(open).toEqual({ expected_updated: 'x', fields: { assignee: true, project: true }, targets: 'open' });
		expect(rules.parseRequest(open).options.fields).toEqual({ ...NO_TRANSFER_FIELDS, project: true, assignee: true });
	});

	it('also for the parts of UE-2: a moved due date and tags to remove', () => {
		const fields = { ...NO_TRANSFER_FIELDS, due: { mode: 'shift', days: -3 }, tags: { add: [], remove: ['tag000000000002'] } };
		const body = transferRequestBody({ expectedUpdated: 'x', fields, targets: 'open' });
		expect(rules.parseRequest(body).options.fields).toEqual(fields);
	});

	it('after a change (UE-2): the distance and the tags of the change pass the checks against the parent', () => {
		const ticket = (overrides) => ({
			id: 'parent000000001', key: 'HAUS-12', title: 'Müll', status: 'open', priority: 'medium', due: '2026-10-12',
			projectId: null, tagIds: ['tag000000000002'], project: null, tags: [], recurring: false, source: null,
			completedAt: null, created: 'x', updated: 'x', ...overrides
		});
		const before = ticket();
		const after = ticket({ due: '2026-10-09', priority: 'high', tagIds: ['tag000000000001'] });
		const change = startParentChange({ before, after });
		const fields = changeFieldsOf(new Set(['due', 'priority', 'tags']), after, change, 'shift');
		expect(fields).toEqual({ ...NO_TRANSFER_FIELDS, due: { mode: 'shift', days: -3 }, priority: true, tags: { add: ['tag000000000001'], remove: ['tag000000000002'] } });
		const parsed = rules.parseRequest(transferRequestBody({ expectedUpdated: 'x', fields, targets: 'open' }));
		expect(parsed.options.fields).toEqual(fields);
		expect(rules.tagsViolation(parsed.options.fields.tags, after.tagIds)).toBe('');
		// Against the parent before the change both lists would be refused.
		expect(rules.tagsViolation(parsed.options.fields.tags, before.tagIds)).toBe('validation_transfer_tags');
	});
});

describe('the changes of a sub-task', () => {
	const parent = { due: '2026-11-20', priority: 'high', status: 'done', assignee: 'user0000000000a', project: 'proj00000000001', tags: ['a', 'b'] };
	const children = [
		{ due: null, priority: 'medium', status: 'open', assignee: '', project: '', tags: [] },
		{ due: '2026-11-20', priority: 'high', status: 'done', assignee: 'user0000000000a', project: 'proj00000000001', tags: ['b', 'a'] },
		{ due: '2026-12-31', priority: 'urgent', status: 'waiting', assignee: 'user0000000000b', project: 'proj00000000002', tags: ['c', 'a'] }
	];
	const choices = [
		{ ...NO_TRANSFER_FIELDS, due: { mode: 'same' } },
		{ ...NO_TRANSFER_FIELDS, due: { mode: 'shift', days: 1 } },
		{ ...NO_TRANSFER_FIELDS, due: { mode: 'shift', days: -45 } },
		{ ...NO_TRANSFER_FIELDS, priority: true, status: true },
		{ ...NO_TRANSFER_FIELDS, assignee: true, project: true },
		{ ...NO_TRANSFER_FIELDS, tags: { add: ['a', 'b'], remove: [] } },
		{ ...NO_TRANSFER_FIELDS, tags: { add: ['a'], remove: ['c'] } },
		{ due: { mode: 'same' }, priority: true, status: true, assignee: true, project: true, tags: { add: ['b'], remove: ['c'] } }
	];

	it('are the same in the SPA and on the server', () => {
		for (const [index, fields] of choices.entries()) {
			for (const child of children) {
				const client = changesOf({ ...parent, due: parent.due }, child, fields);
				const server = rules.changesOf(serverValues(parent), serverValues(child), fields, shift);
				expect(serverChanges(client), `choice ${index}, ${JSON.stringify(child)}`).toEqual(server);
			}
		}
	});

	it('take "no due date" of the parent as such', () => {
		const none = { ...parent, due: null };
		expect(changesOf(none, children[2], choices[0])).toEqual({ due: null });
		expect(rules.changesOf(serverValues(none), serverValues(children[2]), choices[0], shift)).toEqual({ due: '' });
	});
});
