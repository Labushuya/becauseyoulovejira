// Test scaffold of the outbox (OF-2b, extended in OF-3), shared by offline/outbox-corrections.test.ts
// and offline/outbox-of3.test.ts: a fake server that takes a change, can lose an answer and answers a
// known identifier like `answerReplay` (the record as it is now, without comparing the content), a
// conflict when the stored value is neither the expected nor the desired one (`conflictsOf`); since
// OF-3 also the due date and the check marks of the day plan (`dayOver`: the day of the plan is over).
// A storage whose writes finish on command, one that fails on command, and the harness of an outbox.

import { expect, vi } from 'vitest';
import type { DayPlanItem } from '$lib/data/day-plan';
import { DataError } from '$lib/data/errors';
import type { CalendarDate } from '$lib/domain/berlin-date';
import type { ActionOutcome, KeptAction, OfflineOps, OutboxAction } from '$lib/domain/offline';
import type { Status } from '$lib/domain/status';
import type { Ticket } from '$lib/domain/ticket';
import type { FlagInput } from '$lib/stores/flags.svelte';
import { ConnectivityStore } from '$lib/offline/connectivity.svelte';
import {
	OutboxStore,
	type CheckAnswer,
	type OutboxChannel,
	type OutboxDeps
} from '$lib/offline/outbox.svelte';
import { MemoryOutboxStorage } from '$lib/offline/outbox-storage';

// 2026-10-20 14:30 in Berlin (CEST).
export const NOW = Date.UTC(2026, 9, 20, 12, 30, 0);
export const USER = 'user00000000001';
export const OTHER = 'user00000000002';
export const OPS: OfflineOps = { version: 1, kinds: ['ticket.update'] };
/** The capability of a server after OF-1: all six actions (OF-3 needs the day plan). */
export const ALL_OPS: OfflineOps = {
	version: 1,
	kinds: [
		'ticket.create',
		'ticket.update',
		'comment.create',
		'inbox.create',
		'dayplan.check',
		'dayplan.uncheck'
	]
};
export const SAVED_AT = '2026-10-20 12:31:00.000Z';
export const STORED_OP = 'zzzzzzzzzzzzzzzzzzz1';
export const NEXT_OP = 'zzzzzzzzzzzzzzzzzzz2';
export const A = 'tick00000000001';
export const B = 'tick00000000002';
export const STORAGE_FAILED =
	'Gemerkte Änderungen ließen sich auf diesem Gerät nicht lesen oder speichern.';
export const CONFLICT: ActionOutcome = {
	code: 'validation_ticket_conflict',
	message: 'Der Status wurde inzwischen geändert.',
	actual: 'waiting',
	updated: '2026-10-20 12:10:00.000Z'
};

export function ticket(
	id: string,
	status: Status = 'open',
	updated = '2026-10-20 08:00:00.000Z',
	due: CalendarDate | null = null
): Ticket {
	return {
		id,
		key: `HAUS-${id.slice(-2)}`,
		title: `Ticket ${id.slice(-2)}`,
		status,
		priority: 'medium',
		due,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		scope: `u:${USER}`,
		completedAt: status === 'done' ? SAVED_AT : null,
		created: '2026-10-01 08:00:00.000Z',
		updated,
		description: '',
		sourceItem: null
	};
}

/** An entry of the day plan of `ticketId` (OF-3). */
export function entry(id: string, ticketId: string, doneToday = false): DayPlanItem {
	return {
		id,
		plan: 'plan00000000001',
		ticketId,
		position: 0,
		origin: 'manual',
		doneToday,
		doneAt: null,
		addedBy: USER,
		checkedBy: '',
		created: '2026-10-20 08:00:00.000Z',
		updated: '2026-10-20 08:00:00.000Z',
		ticket: null
	};
}

export function stored(overrides: Partial<OutboxAction> = {}): OutboxAction {
	return {
		v: 1,
		op: STORED_OP,
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'ticket.update',
		target: A,
		dependsOn: [],
		payload: { status: 'done' },
		expected: { status: 'open' },
		key: 'HAUS-01',
		title: 'Ticket 01',
		createdAt: NOW - 60_000,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0,
		...overrides
	};
}

/** Distinct identifiers: the n-th one is the n-th letter twenty times. */
export function letters() {
	let call = 0;
	return (bytes: Uint8Array<ArrayBuffer>) => {
		bytes.fill(call++ % 26);
		return bytes;
	};
}

/** A channel between the tabs of one device. */
export function channelPair(): [OutboxChannel, OutboxChannel] {
	const listeners: Array<Set<() => void>> = [new Set(), new Set()];
	const end = (mine: number): OutboxChannel => ({
		post: () => {
			for (const listener of listeners[1 - mine] ?? []) listener();
		},
		listen: (onmessage) => {
			listeners[mine]?.add(onmessage);
			return () => listeners[mine]?.delete(onmessage);
		}
	});
	return [end(0), end(1)];
}

/** A refusal of the server at one or more fields, as the data layer reports it. */
export function refusal(field: string, code: string, params?: Record<string, unknown>): DataError {
	const fields = { [field]: { code, message: '', ...(params && { params }) } };
	return new DataError('validation', { status: 400, fields });
}

/** The due date in the form of the history (`YYYY-MM-DD 00:00:00.000Z`, '' for none). */
function stamp(due: CalendarDate | null): string {
	return due === null ? '' : `${due} 00:00:00.000Z`;
}

/**
 * The server of the outbox as the hook behaves (client-ops.js): it takes a change and notes its
 * identifier; a known identifier answers with the ticket as it is now and changes nothing
 * (`answerReplay`, no comparison of the content); `expected` is a conflict when the stored value
 * is neither the expected nor the desired one (`conflictsOf`). `lose` drops the next answers after
 * the change was written, as a tunnel that breaks on the way back. Since OF-3 the due date and the
 * check marks of the entries of the day plan (`items`) as the routes do it, `dayOver` refuses a new
 * check mark on a day gone by (validation_dayplan_readonly) after the identifier was looked up.
 */
export function fakeServer() {
	const server = {
		status: new Map<string, Status>(),
		due: new Map<string, CalendarDate | null>(),
		items: new Map<string, { ticket: string; doneToday: boolean }>(),
		dayOver: false,
		applied: new Set<string>(),
		/** Every identifier a request carried, in order. */
		sent: [] as string[],
		/** Requests reach the server. */
		reachable: true,
		/** The check of the server (/api/health) answers. */
		health: true,
		lose: 0
	};
	const current = (id: string) =>
		ticket(id, server.status.get(id) ?? 'open', SAVED_AT, server.due.get(id) ?? null);
	/** The answer gets lost after the change was written. */
	const lost = () => {
		if (server.lose > 0) {
			server.lose -= 1;
			throw new DataError('network');
		}
	};
	const send = vi.fn<OutboxDeps['send']>(async (action, fields) => {
		server.sent.push(fields.opId);
		if (!server.reachable) throw new DataError('network');
		const now = server.status.get(action.target) ?? 'open';
		if (server.applied.has(fields.opId)) return current(action.target);
		const expected = fields.expected?.status;
		if (typeof expected === 'string' && now !== expected && now !== action.payload.status) {
			throw refusal('status', 'validation_ticket_conflict', {
				expected,
				actual: now,
				updated: SAVED_AT
			});
		}
		server.status.set(action.target, action.payload.status);
		server.applied.add(fields.opId);
		lost();
		return current(action.target);
	});
	const sendDue = vi.fn<NonNullable<OutboxDeps['sendDue']>>(async (action, fields) => {
		server.sent.push(fields.opId);
		if (!server.reachable) throw new DataError('network');
		if (server.applied.has(fields.opId)) return current(action.target);
		const now = stamp(server.due.get(action.target) ?? null);
		const expected = fields.expected?.due;
		if (typeof expected === 'string' && now !== expected && now !== stamp(action.payload.due)) {
			throw refusal('due', 'validation_ticket_conflict', {
				expected,
				actual: now,
				updated: SAVED_AT
			});
		}
		server.due.set(action.target, action.payload.due);
		server.applied.add(fields.opId);
		lost();
		return current(action.target);
	});
	const sendDayPlan = vi.fn<NonNullable<OutboxDeps['sendDayPlan']>>(async (action, fields) => {
		server.sent.push(fields.opId);
		if (!server.reachable) throw new DataError('network');
		const item = server.items.get(action.target) ?? { ticket: action.ticket, doneToday: false };
		const previous = server.status.get(item.ticket) ?? 'open';
		const answer = (): CheckAnswer => ({
			item: { ...entry(action.target, item.ticket, item.doneToday), updated: SAVED_AT },
			ticket: {
				id: item.ticket,
				key: `HAUS-${item.ticket.slice(-2)}`,
				status: server.status.get(item.ticket) ?? 'open',
				previousStatus: previous
			},
			action: action.payload.action
		});
		if (server.applied.has(fields.opId)) return answer();
		if (server.dayOver) throw refusal('date', 'validation_dayplan_readonly');
		const check = action.kind === 'dayplan.check';
		const complete = action.payload.action === 'complete';
		const reopen = action.payload.status ?? 'open';
		const desired = {
			checked: String(check),
			status: check && complete ? 'done' : !check && complete ? reopen : previous
		};
		const stored = { checked: String(item.doneToday || previous === 'done'), status: previous };
		type Refusal = { code: string; message: string; params: Record<string, string> };
		const errors: Record<string, Refusal> = {};
		for (const field of ['checked', 'status'] as const) {
			const want = fields.expected?.[field];
			if (want === undefined) continue;
			if (stored[field] === String(want) || stored[field] === desired[field]) continue;
			const code =
				field === 'checked' ? 'validation_dayplan_conflict' : 'validation_ticket_conflict';
			const params = { expected: String(want), actual: stored[field], updated: SAVED_AT };
			errors[field] = { code, message: '', params };
		}
		if (Object.keys(errors).length > 0) {
			throw new DataError('validation', { status: 400, fields: errors });
		}
		if (check && complete) server.status.set(item.ticket, 'done');
		else if (check) item.doneToday = true;
		else if (!complete) item.doneToday = false;
		else if (previous === 'done') server.status.set(item.ticket, reopen);
		server.items.set(action.target, item);
		server.applied.add(fields.opId);
		lost();
		return answer();
	});
	return { server, send, sendDue, sendDayPlan };
}

export interface HarnessOptions {
	storage?: MemoryOutboxStorage;
	support?: OfflineOps | null;
	frame?: boolean;
	account?: () => string | null;
	tab?: string | (() => string);
	channel?: OutboxChannel | null | (() => OutboxChannel | null);
	/** The server of another tab of the same device. */
	shared?: ReturnType<typeof fakeServer>;
}

export function harness(options: HarnessOptions = {}) {
	const storage = options.storage ?? new MemoryOutboxStorage();
	const { server, send, sendDue, sendDayPlan } = options.shared ?? fakeServer();
	const connectivity = new ConnectivityStore(async () => server.health);
	const get = vi.fn<OutboxDeps['get']>(async (id) =>
		ticket(id, server.status.get(id) ?? 'open', SAVED_AT, server.due.get(id) ?? null)
	);
	const outbox = new OutboxStore({
		storage,
		connectivity,
		send,
		sendDue,
		sendDayPlan,
		get,
		tab: options.tab ?? 'tab-a',
		channel: options.channel ?? null,
		random: () => 0.5,
		fill: letters(),
		...(options.account !== undefined && { account: options.account })
	});
	const flags = { show: vi.fn<(input: FlagInput) => string>(() => 'flag'), dismiss: vi.fn() };
	const sink = { upsert: vi.fn(), flags, sessionEnded: vi.fn(), childrenOf: vi.fn(() => []) };
	outbox.attach(USER);
	outbox.setSupport(options.support === undefined ? OPS : options.support);
	outbox.setFrame(options.frame ?? true);
	const stop = outbox.connect(sink);
	return {
		outbox,
		storage,
		connectivity,
		server,
		send,
		sendDue,
		sendDayPlan,
		get,
		sink,
		flags,
		stop
	};
}

export type Harness = ReturnType<typeof harness>;

export async function settle() {
	await vi.advanceTimersByTimeAsync(0);
}

export async function goOffline(h: Harness) {
	h.server.health = false;
	await h.connectivity.check();
	expect(h.outbox.offline).toBe(true);
}

export async function goOnline(h: Harness) {
	h.server.health = true;
	h.server.reachable = true;
	await h.connectivity.check();
	await settle();
}

/** A storage of the device whose writes wait until `open`, then run in the order they came. */
export class HeldStorage extends MemoryOutboxStorage {
	holding = false;
	readonly #held: (() => void)[] = [];

	async #turn(): Promise<void> {
		if (this.holding) await new Promise<void>((resolve) => this.#held.push(resolve));
	}

	async put(action: KeptAction): Promise<void> {
		await this.#turn();
		return super.put(action);
	}

	async swap(
		op: string,
		matches: (current: unknown) => boolean,
		next: KeptAction | null
	): Promise<boolean> {
		await this.#turn();
		return super.swap(op, matches, next);
	}

	open(): void {
		this.holding = false;
		for (const resolve of this.#held.splice(0)) resolve();
	}
}

/** A storage of the device that fails on every write once `failing` is set. */
export class FailingStorage extends MemoryOutboxStorage {
	failing = false;

	#check(): void {
		if (this.failing) throw new DOMException('Der Speicher antwortet nicht.', 'UnknownError');
	}

	async put(action: KeptAction): Promise<void> {
		this.#check();
		return super.put(action);
	}

	async swap(
		op: string,
		matches: (current: unknown) => boolean,
		next: KeptAction | null
	): Promise<boolean> {
		this.#check();
		return super.swap(op, matches, next);
	}

	async remove(ops: readonly string[]): Promise<void> {
		this.#check();
		return super.remove(ops);
	}
}
