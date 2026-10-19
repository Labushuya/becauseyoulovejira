// "Neues Ticket" with everything at once in the detail store (NT-1, ADR-0069): one request for the
// ticket and its options, the ticket of the panel afterwards, refusals at the fields of the form with
// the row of a list, and what the server knows (asked again until it answers).

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { CreatedTicket } from '$lib/data/ticket-create';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { NO_EXTRAS, type CreateRequest, type CreateSupport } from '$lib/domain/ticket-create';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from './ticket-detail.svelte';

const SESSION = { ensureValid: () => true, logout: vi.fn() };

const TICKET: Ticket = {
	id: 'ticket000000001',
	key: 'TASK-1',
	title: 'Heizung warten',
	description: '',
	sourceItem: null,
	status: 'open',
	priority: 'medium',
	due: null,
	projectId: null,
	tagIds: [],
	project: null,
	tags: [],
	recurring: true,
	recurrenceId: 'rule00000000001',
	source: 'manual',
	completedAt: null,
	created: '2026-10-06 10:00:00.000Z',
	updated: '2026-10-06 10:00:00.000Z'
};

const REQUEST: CreateRequest = {
	draft: {
		title: '  Heizung warten ',
		description: '',
		status: 'open',
		priority: 'medium',
		due: null,
		project: null,
		tags: []
	},
	sourceItem: null,
	recurrence: { freq: 'weekly' },
	extras: { ...NO_EXTRAS }
};

function setup(data: Partial<TicketDetailData> = {}) {
	const list = {
		find: () => null,
		upsert: vi.fn((summary: TicketSummary) => summary),
		completed: vi.fn(),
		remove: vi.fn(),
		announce: vi.fn()
	} satisfies TicketListSync;
	const store = new TicketDetailStore(
		{ get: vi.fn(), update: vi.fn(), create: vi.fn(), delete: vi.fn(), ...data },
		SESSION,
		list
	);
	return { store, list };
}

describe('createWithOptions', () => {
	it('sends one request with the trimmed title and shows the new ticket in the panel', async () => {
		const rule = { id: 'rule00000000001' } as RecurrenceRule;
		const createWithOptions = vi.fn(async (): Promise<CreatedTicket> => ({
			ticket: TICKET,
			rule,
			outcome: {
				id: TICKET.id,
				key: TICKET.key,
				scope: 'u:owner0000000001',
				subtasks: [],
				sources: 0,
				ticketSources: 0,
				rule: rule.id,
				pinned: false,
				dayPlan: false
			}
		}));
		const { store, list } = setup({ createWithOptions });
		const result = await store.createWithOptions(REQUEST);
		expect(createWithOptions).toHaveBeenCalledWith({
			...REQUEST,
			draft: { ...REQUEST.draft, title: 'Heizung warten' }
		});
		expect(result).toEqual({ ok: true, ticket: TICKET, rule });
		expect(list.upsert).toHaveBeenCalledWith(TICKET);
		expect(store.state).toBe('ready');
		expect(store.ticket?.id).toBe(TICKET.id);
	});

	it('puts every refusal at the field of the form, with the row of a list', async () => {
		const createWithOptions = vi.fn(async () => {
			throw new DataError('validation', {
				status: 400,
				fields: {
					ticket_sources: {
						code: 'validation_scope_mismatch',
						message: 'Anderer Bereich.',
						params: { index: 1 }
					},
					month_day: { code: 'validation_recurrence_month_day', message: 'Tag 1 bis 31.' },
					day_plan: { code: 'validation_dayplan_ticket_done', message: 'Erledigt.' }
				}
			});
		});
		const { store } = setup({ createWithOptions });
		expect(await store.createWithOptions(REQUEST)).toEqual({
			ok: false,
			message: null,
			fields: {
				ticketSources: 'Anderer Bereich.',
				monthDay: 'Tag 1 bis 31.',
				dayPlan: 'Erledigt.'
			},
			index: { ticketSources: 1 }
		});
	});

	it('names a refusal without a field of the form (the entry of the inbox) as the message', async () => {
		const createWithOptions = vi.fn(async () => {
			throw new DataError('validation', {
				status: 400,
				fields: {
					source_item: { code: 'validation_inbox_item_handled', message: 'Schon bearbeitet.' }
				}
			});
		});
		const { store } = setup({ createWithOptions });
		expect(await store.createWithOptions(REQUEST)).toEqual({
			ok: false,
			message: 'Schon bearbeitet.',
			fields: {}
		});
	});

	it('sends nothing without a title', async () => {
		const createWithOptions = vi.fn();
		const { store } = setup({ createWithOptions });
		const result = await store.createWithOptions({
			...REQUEST,
			draft: { ...REQUEST.draft, title: '  ' }
		});
		expect(result).toMatchObject({
			ok: false,
			fields: { title: 'Der Titel darf nicht leer sein.' }
		});
		expect(createWithOptions).not.toHaveBeenCalled();
	});
});

describe('loadCreateSupport', () => {
	const SUPPORT: CreateSupport = {
		recurrence: true,
		pin: true,
		dayPlan: true,
		ticketSources: true,
		kind: true,
		color: true,
		charm: true,
		assignee: true,
		subtaskStatus: true,
		duplicateSubtaskStatus: true,
		subtaskTransfer: true
	};

	it('keeps a known answer for the session and asks again while the route is missing', async () => {
		const createSupport = vi
			.fn<() => Promise<CreateSupport | null>>()
			.mockResolvedValueOnce(null)
			.mockResolvedValue(SUPPORT);
		const { store } = setup({ createSupport });
		expect(store.createSupport).toBeUndefined();
		await store.loadCreateSupport();
		expect(store.createSupport).toBeNull();
		expect(store.createSupportProblem).toBeNull();
		await store.loadCreateSupport();
		expect(store.createSupport).toEqual(SUPPORT);
		await store.loadCreateSupport();
		expect(createSupport).toHaveBeenCalledTimes(2);
	});

	it('asks again on the next opening while an answer lacks an option of the hooks (UT-2)', async () => {
		const before = { ...SUPPORT, subtaskStatus: false, duplicateSubtaskStatus: false };
		const afterUt1 = { ...SUPPORT, duplicateSubtaskStatus: false };
		const createSupport = vi
			.fn<() => Promise<CreateSupport | null>>()
			.mockResolvedValueOnce(before)
			.mockResolvedValueOnce(afterUt1)
			.mockResolvedValue(SUPPORT);
		const { store } = setup({ createSupport });
		await store.loadCreateSupport();
		expect(store.createSupport).toEqual(before);
		// The restart happened meanwhile: the next opening finds the options without a reload.
		await store.loadCreateSupport();
		expect(store.createSupport?.subtaskStatus).toBe(true);
		await store.loadCreateSupport();
		expect(store.createSupport).toEqual(SUPPORT);
		await store.loadCreateSupport();
		expect(createSupport).toHaveBeenCalledTimes(3);
	});

	it('knows a failure as unknown, not as a server without the route, and asks again (UT-2)', async () => {
		const createSupport = vi
			.fn<() => Promise<CreateSupport | null>>()
			.mockRejectedValueOnce(new DataError('network'))
			.mockResolvedValue(SUPPORT);
		const { store } = setup({ createSupport });
		await store.loadCreateSupport();
		expect(store.createSupport).toBeUndefined();
		expect(store.createSupportProblem).toContain('Server nicht erreichbar.');
		expect(store.createSupportLoading).toBe(false);
		// "Erneut versuchen" or the next opening.
		await store.loadCreateSupport();
		expect(store.createSupport).toEqual(SUPPORT);
		expect(store.createSupportProblem).toBeNull();
	});

	it('keeps an earlier answer when asking again fails, and says why', async () => {
		const before = { ...SUPPORT, duplicateSubtaskStatus: false };
		const createSupport = vi
			.fn<() => Promise<CreateSupport | null>>()
			.mockResolvedValueOnce(before)
			.mockRejectedValueOnce(new DataError('server'));
		const { store } = setup({ createSupport });
		await store.loadCreateSupport();
		await store.loadCreateSupport();
		expect(store.createSupport).toEqual(before);
		expect(store.createSupportProblem).toBe(
			'Der Server hat mit einem Fehler geantwortet. Bitte später erneut versuchen.'
		);
	});

	it('asks once while a question runs, and shows that it runs', async () => {
		let answer: (value: CreateSupport) => void = () => undefined;
		const createSupport = vi.fn(
			() => new Promise<CreateSupport | null>((resolve) => (answer = resolve))
		);
		const { store } = setup({ createSupport });
		const first = store.loadCreateSupport();
		expect(store.createSupportLoading).toBe(true);
		await store.loadCreateSupport();
		answer(SUPPORT);
		await first;
		expect(createSupport).toHaveBeenCalledOnce();
		expect(store.createSupportLoading).toBe(false);
	});

	it('ends the session on a lost session without a problem to show', async () => {
		const logout = vi.fn();
		const store = new TicketDetailStore(
			{
				get: vi.fn(),
				update: vi.fn(),
				create: vi.fn(),
				delete: vi.fn(),
				createSupport: vi.fn(async () => Promise.reject(new DataError('session')))
			},
			{ ensureValid: () => true, logout },
			setup().list
		);
		await store.loadCreateSupport();
		expect(logout).toHaveBeenCalledOnce();
		expect(store.createSupportProblem).toBeNull();
	});

	it('knows no support without the data access (tests of single parts)', async () => {
		const { store } = setup();
		await store.loadCreateSupport();
		expect(store.createSupport).toBeNull();
		expect(store.createSupportProblem).toBeNull();
	});
});
