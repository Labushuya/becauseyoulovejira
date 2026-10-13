// Stand-ins for the day plan (TP-1, ADR-0065) in store and component tests: tickets of the list store,
// entries, the answer of the plan and a fake server whose routes change the entries like the hooks.

import { SvelteMap } from 'svelte/reactivity';
import { vi } from 'vitest';
import type { DayPlanAnswer, DayPlanItem, DayPlanMeta } from '$lib/data/day-plan';
import { DataError } from '$lib/data/errors';
import { DEFAULT_SOURCES, type CheckMode, type DayPlanOrigin } from '$lib/domain/day-plan';
import type { Status } from '$lib/domain/status';
import { subtaskProgress } from '$lib/domain/subtasks';
import type { TicketSummary } from '$lib/domain/ticket';
import type { DayPlanData } from '$lib/stores/day-plan.svelte';
import type { FlagInput, FlagSink } from '$lib/stores/flags.svelte';

export const TODAY = '2031-05-14';
export const SCOPE = 'u:user00000000001';
export const SELF = 'user00000000001';
export const PLAN: DayPlanMeta = Object.freeze({
	id: 'plan00000000001',
	date: TODAY,
	scope: SCOPE,
	dismissed: []
});
const T0 = '2031-05-01 08:00:00.000Z';

/** A ticket of the list; the key ends with the last two characters of its ID. */
export function planTicket(id: string, overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id,
		key: `TASK-${id.slice(-2)}`,
		title: `Ticket ${id.slice(-2)}`,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		kind: 'task',
		completedAt: null,
		created: T0,
		updated: T0,
		...overrides
	};
}

/** An entry of the plan PLAN, added by hand by SELF. */
export function planItem(
	id: string,
	ticketId: string,
	position: number,
	overrides: Partial<DayPlanItem> = {}
): DayPlanItem {
	return {
		id,
		plan: PLAN.id,
		ticketId,
		position,
		origin: 'manual',
		doneToday: false,
		doneAt: null,
		addedBy: SELF,
		checkedBy: '',
		created: T0,
		updated: T0,
		ticket: null,
		...overrides
	};
}

/** The answer of the plan of today. */
export function planAnswer(overrides: Partial<DayPlanAnswer> = {}): DayPlanAnswer {
	return {
		date: TODAY,
		today: TODAY,
		tomorrow: '2031-05-15',
		scope: SCOPE,
		editable: true,
		plan: PLAN,
		suggestions: [],
		leftover: [],
		settings: DEFAULT_SOURCES,
		other: null,
		adopted: 0,
		// A server before its restart after TP-4 unless a test names it.
		supportsOrder: false,
		...overrides
	};
}

/** The tickets of the list store: the open ones of the area, live. */
export function fakeTickets(initial: TicketSummary[]) {
	const map = new SvelteMap(initial.map((entry) => [entry.id, entry]));
	return {
		map,
		get open() {
			return [...map.values()].filter((entry) => entry.status !== 'done');
		},
		today: TODAY,
		newInProjects: 0,
		find: (id: string) => map.get(id) ?? null,
		upsert: vi.fn((entry: TicketSummary) => void map.set(entry.id, entry)),
		/** Like the list store: every sub-task of the map, open and done ones (TP-3). */
		progressOf: (parentId: string) =>
			subtaskProgress([...map.values()].filter((entry) => entry.parentId === parentId)),
		loadOpen: vi.fn()
	};
}

export type FakeTickets = ReturnType<typeof fakeTickets>;

/** Flags that the test reads back. */
export function fakeFlags() {
	const shown: FlagInput[] = [];
	const flags: FlagSink = {
		show: vi.fn((input: FlagInput) => {
			shown.push(input);
			return String(shown.length);
		}),
		dismiss: vi.fn()
	};
	return { flags, shown, last: () => shown.at(-1) };
}

export function fakeSession() {
	return { ensureValid: vi.fn(() => true), logout: vi.fn() };
}

/**
 * A fake server: a plan with its entries; every route changes them like the hooks. `ongoing` names
 * the tickets that are ongoing projects, whose check mark is only for the day. A plan that names
 * `supportsOrder` is a server after TP-4: add and adopt answer every position, a new entry without a
 * place goes where `place` says (the end without it), and `order` works like the hook; otherwise a
 * server before its restart (no positions, new entries at the end, no route of the order).
 */
export function fakeDayPlanData(
	items: DayPlanItem[] = [],
	first: DayPlanAnswer = planAnswer(),
	ongoing: string[] = [],
	place: (ticketId: string, entries: readonly DayPlanItem[]) => number = (_, list) => list.length
) {
	let entries = items.map((entry) => ({ ...entry }));
	let clock = 1;
	let created = 0;
	const stamp = () => `2031-05-14 10:00:${String((clock += 1)).padStart(2, '0')}.000Z`;
	const placed = first.supportsOrder;
	const positions = () =>
		placed ? entries.map((entry) => ({ id: entry.id, position: entry.position })) : null;
	/** Puts a new entry at `index` (the end for none) and numbers the plan again. */
	const insert = (made: DayPlanItem, index: number | undefined) => {
		const at = Math.min(Math.max(index ?? entries.length, 0), entries.length);
		entries.splice(at, 0, made);
		entries = entries.map((entry, position) => ({ ...entry, position }));
		return { ...(entries[at] as DayPlanItem) };
	};
	const checked = (ticketId: string, status: Status, previous: Status) => ({
		id: ticketId,
		key: `TASK-${ticketId.slice(-2)}`,
		status,
		previousStatus: previous
	});
	const find = (id: string) => entries.find((candidate) => candidate.id === id) as DayPlanItem;
	return {
		fetch: vi.fn(async () => ({ kind: 'ok' as const, value: first })),
		listItems: vi.fn(async () => entries.map((entry) => ({ ...entry }))),
		add: vi.fn(async (input: { ticket: string; index?: number }) => {
			const made = planItem(
				`made0000000${String((created += 1)).padStart(4, '0')}`,
				input.ticket,
				entries.length,
				{
					updated: stamp()
				}
			);
			const item = insert(
				made,
				input.index ?? (placed ? place(input.ticket, entries) : entries.length)
			);
			return { item, plan: PLAN, already: false, positions: positions() };
		}),
		adopt: vi.fn(async (_scope: string, tickets: readonly string[]) => {
			const made = tickets.map((id) => {
				const item = planItem(
					`adopt00000${String((created += 1)).padStart(5, '0')}`,
					id,
					entries.length,
					{
						origin: 'due_today' as DayPlanOrigin,
						updated: stamp()
					}
				);
				return insert(item, placed ? place(id, entries) : entries.length).id;
			});
			return {
				items: made.map((id) => ({ ...find(id) })),
				plan: PLAN,
				positions: positions()
			};
		}),
		check: vi.fn(async (id: string, mode: CheckMode) => {
			const entry = find(id);
			const today = mode === 'today' || (mode === 'check' && ongoing.includes(entry.ticketId));
			Object.assign(entry, {
				doneToday: today || entry.doneToday,
				checkedBy: SELF,
				updated: stamp()
			});
			return {
				item: { ...entry },
				ticket: checked(entry.ticketId, today ? 'open' : 'done', 'in_progress'),
				action: today ? ('today' as const) : ('complete' as const)
			};
		}),
		uncheck: vi.fn(async (id: string) => {
			const entry = find(id);
			Object.assign(entry, { doneToday: false, checkedBy: '', updated: stamp() });
			return { item: { ...entry }, ticket: checked(entry.ticketId, 'open', 'done') };
		}),
		tomorrow: vi.fn(async (id: string) => {
			const entry = find(id);
			entries = entries.filter((candidate) => candidate.id !== id);
			return {
				item: { ...entry, plan: 'plan00000000002' },
				plan: { ...PLAN, id: 'plan00000000002' }
			};
		}),
		remove: vi.fn(async (id: string) => {
			const entry = find(id);
			entries = entries.filter((candidate) => candidate.id !== id);
			return { plan: { ...PLAN, dismissed: [entry.ticketId] } };
		}),
		move: vi.fn(async (id: string, index: number) => {
			const ids = entries.map((entry) => entry.id).filter((candidate) => candidate !== id);
			ids.splice(index, 0, id);
			entries = ids.map((candidate, position) => ({ ...find(candidate), position }));
			return entries.map((entry) => ({ id: entry.id, position: entry.position }));
		}),
		/** Like the hook (TP-4): the named entries take their places in this order, the rest stay. */
		order: vi.fn(async (planId: string, ids: readonly string[]) => {
			if (!placed) throw new DataError('server');
			const current = entries.map((entry) => entry.id);
			if (planId !== PLAN.id || ids.some((id) => !current.includes(id))) {
				const message = 'Die Reihenfolge passt nicht zu den Einträgen dieses Plans.';
				throw new DataError('validation', {
					status: 400,
					fields: { ids: { code: 'validation_dayplan_order', message } }
				});
			}
			let next = 0;
			const order = current.map((id) => (ids.includes(id) ? (ids[next++] as string) : id));
			entries = order.map((candidate, position) => ({ ...find(candidate), position }));
			return entries.map((entry) => ({ id: entry.id, position: entry.position }));
		}),
		saveSettings: vi.fn(async (_scope: string, sources: object) => ({
			...DEFAULT_SOURCES,
			...sources
		})),
		setKind: vi.fn(async (ticketId: string, kind: 'task' | 'ongoing') =>
			planTicket(ticketId, { kind, updated: stamp() })
		)
	} satisfies DayPlanData;
}

export type FakeDayPlanData = ReturnType<typeof fakeDayPlanData>;
