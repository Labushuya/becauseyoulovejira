// "Neues Ticket" with everything at once (NT-1, ADR-0069): the pure rules of the route
// (app/pb_hooks/lib/ticket-create-rules.js) and the SPA (web/src/lib/domain/ticket-create.ts) name the
// same limits and texts, and the body the SPA sends reads on the server as the same request.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	CREATE_MESSAGES,
	CREATE_SOURCES_MAX,
	CREATE_SUBTASKS_MAX,
	CREATE_TICKET_SOURCES_MAX,
	NO_EXTRAS,
	createFieldOf,
	createRequestBody,
	moreOptionsLabel,
	moreOptionsSet,
	toCreateOutcome,
	toCreateSupport
} from '../../web/src/lib/domain/ticket-create.ts';
import { fromDueInput } from '../../web/src/lib/domain/ticket.ts';

const rules = loadHookLib('ticket-create-rules.js');

const DRAFT = {
	title: 'Heizung warten',
	description: '',
	status: 'open',
	priority: 'medium',
	due: null,
	project: null,
	tags: []
};

const body = (request, household = '') => createRequestBody(request, household, (due) => fromDueInput(due ?? ''));

describe('limits and texts of the route', () => {
	it('are the same in the SPA and in ticket-create-rules.js', () => {
		expect({ ...CREATE_MESSAGES }).toEqual({ ...rules.MESSAGES });
		expect(CREATE_SUBTASKS_MAX).toBe(rules.SUBTASKS_MAX);
		expect(CREATE_TICKET_SOURCES_MAX).toBe(rules.TICKET_SOURCES_MAX);
		expect(CREATE_SOURCES_MAX).toBe(rules.SOURCES_MAX);
	});
});

describe('parseRequest', () => {
	it('reads the body of the form with only a title as a plain new ticket', () => {
		const parsed = rules.parseRequest(body({ draft: DRAFT, sourceItem: null, recurrence: null, extras: NO_EXTRAS }));
		expect(parsed.options).toEqual({
			ticket: {
				household: '',
				title: 'Heizung warten',
				description: '',
				status: 'open',
				priority: 'medium',
				due: '',
				project: '',
				parent: '',
				color: '',
				charm: '',
				kind: '',
				assignee: '',
				source: 'manual',
				source_item: '',
				tags: [],
				blocks_parent: true
			},
			subtasks: [],
			ticketSources: [],
			sources: [],
			rule: null,
			pin: false,
			dayPlan: false
		});
	});

	it('reads every option the form sends as the same request', () => {
		const sent = body(
			{
				draft: {
					...DRAFT,
					due: '2026-10-12',
					project: 'proj00000000001',
					tags: ['tag000000000001'],
					parent: 'tick00000000001',
					blocksParent: false,
					color: 'blau',
					charm: 'einkaufen',
					kind: 'ongoing',
					assignee: 'user00000000002'
				},
				sourceItem: 'item00000000001',
				recurrence: { mode: 'calendar', freq: 'weekly', weekdays: ['MO'], start: 'today', initial_status: 'open', next_due: '2020-01-01' },
				extras: {
					subtasks: [{ title: ' Filter ', priority: 'high' }],
					ticketSources: ['tick00000000002', 'tick00000000002'],
					sources: ['item00000000002', 'item00000000001'],
					pin: true,
					dayPlan: true
				}
			},
			'house0000000001'
		);
		const { options } = rules.parseRequest(sent);
		expect(options.ticket).toMatchObject({
			household: 'house0000000001',
			due: '2026-10-12 00:00:00.000Z',
			parent: 'tick00000000001',
			blocks_parent: false,
			color: 'blau',
			charm: 'einkaufen',
			kind: 'ongoing',
			assignee: 'user00000000002',
			source: '',
			source_item: 'item00000000001'
		});
		expect(options.subtasks).toEqual([{ title: 'Filter', priority: 'high' }]);
		expect(options.ticketSources).toEqual(['tick00000000002']);
		// The main source is no extra source.
		expect(options.sources).toEqual(['item00000000002']);
		// Only the parameters of a rule count; next_due belongs to the server, start is no schema field.
		expect(options.rule).toEqual({
			fields: { mode: 'calendar', freq: 'weekly', weekdays: ['MO'], initial_status: 'open' },
			body: { mode: 'calendar', freq: 'weekly', weekdays: ['MO'], initial_status: 'open', start: 'today' }
		});
		expect(options.pin).toBe(true);
		expect(options.dayPlan).toBe(true);
	});

	it.each([
		[{ title: '   ' }, { field: 'title', code: 'validation_create_title' }],
		[{ title: 'x'.repeat(201) }, { field: 'title', code: 'validation_create_title_max' }],
		[{ title: 'T', description: 'd'.repeat(100001) }, { field: 'description', code: 'validation_create_description_max' }],
		[{ title: 'T', project: 7 }, { field: 'project', code: 'validation_create_format' }],
		[{ title: 'T', tags: 'tag' }, { field: 'tags', code: 'validation_create_format' }],
		[{ title: 'T', blocks_parent: 'nein' }, { field: 'blocks_parent', code: 'validation_create_format' }],
		[{ title: 'T', subtasks: {} }, { field: 'subtasks', code: 'validation_create_subtasks' }],
		[{ title: 'T', subtasks: [{ title: '' }] }, { field: 'subtasks', code: 'validation_create_subtask_title', index: 0 }],
		[{ title: 'T', subtasks: [{ title: 'a' }, { title: 'b', priority: 'sofort' }] }, { field: 'subtasks', code: 'validation_create_subtask_priority', index: 1 }],
		[{ title: 'T', subtasks: [{ title: 'y'.repeat(201) }] }, { field: 'subtasks', code: 'validation_create_subtask_title_max', index: 0 }],
		[{ title: 'T', subtasks: Array.from({ length: 21 }, () => ({ title: 'u' })) }, { field: 'subtasks', code: 'validation_create_subtasks_max' }],
		[{ title: 'T', ticket_sources: [''] }, { field: 'ticket_sources', code: 'validation_create_ticket_sources', index: 0 }],
		[{ title: 'T', ticket_sources: Array.from({ length: 21 }, (_, i) => `t${i}`) }, { field: 'ticket_sources', code: 'validation_create_ticket_sources_max' }],
		[{ title: 'T', sources: [3] }, { field: 'sources', code: 'validation_create_sources', index: 0 }],
		[{ title: 'T', sources: Array.from({ length: 51 }, (_, i) => `i${i}`) }, { field: 'sources', code: 'validation_create_sources_max' }],
		[{ title: 'T', recurrence: 'weekly' }, { field: 'recurrence', code: 'validation_create_recurrence' }],
		[{ title: 'T', pin: 'ja' }, { field: 'pin', code: 'validation_create_format' }],
		[{ title: 'T', day_plan: 1 }, { field: 'day_plan', code: 'validation_create_format' }]
	])('refuses %j', (input, expected) => {
		expect(rules.parseRequest(input)).toEqual(expected);
	});

	it('counts the characters of a title as PocketBase does', () => {
		expect(rules.parseRequest({ title: '😀'.repeat(200) }).options.ticket.title).toBe('😀'.repeat(200));
	});

	it('knows a sub-task that is to get sub-tasks of its own', () => {
		expect(rules.nestedSubtasks('tick00000000001', [{ title: 'x' }])).toBe(true);
		expect(rules.nestedSubtasks('', [{ title: 'x' }])).toBe(false);
		expect(rules.nestedSubtasks('tick00000000001', [])).toBe(false);
	});
});

describe('answers of the route', () => {
	it('reads the answer of POST and refuses anything else', () => {
		const answer = {
			id: 't1',
			key: 'HAUS-1',
			scope: 'h:house0000000001',
			subtasks: [{ id: 's1', key: 'HAUS-2' }],
			sources: 1,
			ticket_sources: 2,
			rule: 'r1',
			pinned: true,
			day_plan: false
		};
		expect(toCreateOutcome(answer)).toEqual({
			id: 't1',
			key: 'HAUS-1',
			scope: 'h:house0000000001',
			subtasks: [{ id: 's1', key: 'HAUS-2' }],
			sources: 1,
			ticketSources: 2,
			rule: 'r1',
			pinned: true,
			dayPlan: false
		});
		for (const broken of [null, [], { ...answer, id: 1 }, { ...answer, subtasks: [{}] }, { ...answer, subtasks: null }]) {
			expect(toCreateOutcome(broken)).toBeNull();
		}
	});

	it('reads the answer of GET', () => {
		expect(toCreateSupport({ recurrence: true, pin: true, day_plan: false, ticket_sources: true, kind: true, color: true, charm: false, assignee: true })).toEqual({
			recurrence: true,
			pin: true,
			dayPlan: false,
			ticketSources: true,
			kind: true,
			color: true,
			charm: false,
			assignee: true
		});
		expect(toCreateSupport('ok')).toBeNull();
	});
});

describe('field errors and "Weitere Optionen"', () => {
	it('puts every field of the request and of the rule at a field of the form', () => {
		for (const name of rules.TEXT_FIELDS.filter((field) => !['household', 'source', 'source_item'].includes(field))) {
			expect(createFieldOf(name), name).not.toBeNull();
		}
		for (const name of [...rules.RULE_FIELDS.filter((field) => field !== 'active'), ...rules.RULE_BODY_FIELDS]) {
			expect(createFieldOf(name), name).not.toBeNull();
		}
		expect(createFieldOf('month_day')).toBe('monthDay');
		expect(createFieldOf('ticket_sources')).toBe('ticketSources');
		expect(createFieldOf('day_plan')).toBe('dayPlan');
		// Without a field the error is the message of the form.
		expect(createFieldOf('source_item')).toBeNull();
		expect(createFieldOf('household')).toBeNull();
	});

	it('counts what differs from a new ticket and names it in the heading', () => {
		const none = { pin: false, dayPlan: false, color: null, ongoing: false, parent: false, recurrence: false, subtasks: 0, sources: 0, ticketSources: 0 };
		expect(moreOptionsSet(none)).toBe(0);
		expect(moreOptionsLabel(0)).toBe('Weitere Optionen');
		expect(moreOptionsSet({ ...none, pin: true, subtasks: 3, sources: 1, ticketSources: 2 })).toBe(3);
		expect(moreOptionsLabel(2)).toBe('Weitere Optionen (2 gesetzt)');
	});
});
