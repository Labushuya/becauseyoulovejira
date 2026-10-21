// Test scaffold of the outbox (OF-2b, extended in OF-3 and OF-3b), shared by
// offline/outbox-corrections.test.ts, offline/outbox-of3.test.ts, offline/outbox-of3b.test.ts and
// offline/outbox-matrix.test.ts: a fake server that takes a change, can lose an answer and answers a
// known identifier like `answerReplay` (the record as it is now, without comparing the content), a
// conflict when the stored value is neither the expected nor the desired one (`conflictsOf`); since
// OF-3 also the due date and the check marks of the day plan (`dayOver`: the day of the plan is over),
// since OF-3b the sub-tasks "Unteraufgaben mit erledigen" takes along, since round 3 exactly as the
// hook does it (`blocking`, ticket-service.js `prepareCompletion`). A storage whose writes finish on
// command, one that fails on command, and the harness of an outbox.
//
// Where it differs from the server on purpose: it knows no rules of the Record API (403 and 404 come
// from the tests), no `updated` of its own and no series; the time of the device is not checked.
//
// Since OF-4a it creates tickets and entries of the inbox as the hooks do (tickets.pb.js, inbox.pb.js,
// lib/client-ops.js `withOp`, `answerReplay`): a known identifier answers with the record of the first
// time (another kind or another ID: `validation_op_reused`; one no longer to be seen:
// `validation_op_applied` with its ID), an ID that is taken is refused at `id` with
// `validation_not_unique`, a refusal of the hook (`refuseCreate`, e.g. an archived project) comes
// before the key, and only a real creation draws a number of the counter (`counter`). With `strict` a
// change or a read of a record the server does not have answers 404. Since OF-4a round 2 (A11) reading
// a ticket needs `reachable` like every other request.

import { expect, vi } from 'vitest';
import type { DayPlanItem } from '$lib/data/day-plan';
import { DataError } from '$lib/data/errors';
import type { CalendarDate } from '$lib/domain/berlin-date';
import type { InboxItem } from '$lib/domain/inbox';
import type {
	ActionOutcome,
	CreateAction,
	KeptAction,
	OfflineOps,
	OutboxAction
} from '$lib/domain/offline';
import type { Status } from '$lib/domain/status';
import type { CompletionChoice } from '$lib/domain/subtasks';
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

/** A record the fake server created for "＋" (OF-4a). */
export interface CreatedRecord {
	collection: 'tickets' | 'inbox_items';
	key: string;
	title: string;
	project: string | null;
	tags: string[];
	household: string;
	/** `source_meta.offline` / the history: the request came from the outbox with a time or not. */
	offline: boolean;
}

/**
 * The server of the outbox as the hook behaves (client-ops.js): it takes a change and notes its
 * identifier; a known identifier answers with the ticket as it is now and changes nothing
 * (`answerReplay`, no comparison of the content); `expected` is a conflict when the stored value
 * is neither the expected nor the desired one (`conflictsOf`). `lose` drops the next answers after
 * the change was written, as a tunnel that breaks on the way back. Since OF-3 the due date and the
 * check marks of the entries of the day plan (`items`) as the routes do it, `dayOver` refuses a new
 * check mark on a day gone by (validation_dayplan_readonly) after the identifier was looked up.
 * Since round 3 a completion treats the sub-tasks like the hook: only the step to "done" looks at the
 * open ones of `blocking`, refuses with validation_parent_open_children without an answer and completes
 * them with "complete_children" (the list of the client does not count).
 */
export function fakeServer() {
	const server = {
		status: new Map<string, Status>(),
		due: new Map<string, CalendarDate | null>(),
		items: new Map<string, { ticket: string; doneToday: boolean }>(),
		/** The sub-tasks of a ticket with "blocks_parent", as the hook finds them (round 3). */
		blocking: new Map<string, string[]>(),
		dayOver: false,
		applied: new Set<string>(),
		/** Every identifier a request carried, in order. */
		sent: [] as string[],
		/** Requests reach the server. */
		reachable: true,
		/** The check of the server (/api/health) answers. */
		health: true,
		lose: 0,
		/** Records "＋" created (OF-4a), by their ID. */
		records: new Map<string, CreatedRecord>(),
		/** The identifiers of creations with the kind and the ID they wrote (`client_ops`). */
		claims: new Map<string, { kind: string; record: string }>(),
		/** Numbers of the counter drawn (`counters.nextValue`); only a real creation draws one. */
		counter: 0,
		/**
		 * The hook refuses a creation of a ticket at this field (an archived project: only one with a
		 * project), before the key; nothing is written.
		 */
		refuseCreate: null as { field: string; code: string } | null,
		/** The hook refuses a creation of an entry of the inbox (an area that is no longer one's own). */
		refuseItem: false,
		/** Records the account no longer sees (the trash): a repetition names only their ID. */
		hidden: new Set<string>(),
		/** Changes and reads of a ticket the server does not have answer 404 (OF-4a). */
		strict: false
	};
	const current = (id: string) => {
		const record = server.records.get(id);
		const shown = ticket(id, server.status.get(id) ?? 'open', SAVED_AT, server.due.get(id) ?? null);
		if (record === undefined) return shown;
		return {
			...shown,
			key: record.key,
			title: record.title,
			projectId: record.project,
			tagIds: [...record.tags],
			source: 'quick' as const
		};
	};
	/** A record the server does not have (or the account does not see) is not found. */
	const missing = (id: string) =>
		(server.strict && !server.records.has(id) && !server.status.has(id)) || server.hidden.has(id);
	const notFound = () => new DataError('not_found', { status: 404 });
	/**
	 * The way of `withOp` before anything is written: a known identifier answers like the first time
	 * (another kind or ID: reused; not to be seen: applied), an ID that is taken is not unique.
	 */
	const claimed = (action: CreateAction, op: string): string | null => {
		const claim = server.claims.get(op);
		if (claim !== undefined) {
			if (claim.kind !== action.kind || claim.record !== action.target) {
				throw refusal('op_id', 'validation_op_reused');
			}
			if (server.hidden.has(claim.record)) {
				throw refusal('op_id', 'validation_op_applied', {
					record: claim.record,
					kind: claim.kind
				});
			}
			return claim.record;
		}
		if (server.records.has(action.target) || server.status.has(action.target)) {
			throw refusal('id', 'validation_not_unique');
		}
		return null;
	};
	/** The answer gets lost after the change was written. */
	const lost = () => {
		if (server.lose > 0) {
			server.lose -= 1;
			throw new DataError('network');
		}
	};
	/**
	 * The sub-tasks a save completes along (ticket-service.js `prepareCompletion`, after the conflict
	 * check): only on the step to "done", only the open blocking ones; with some open, "force" leaves
	 * them, "complete_children" takes them, without an answer the save is refused.
	 */
	const along = (
		id: string,
		was: Status,
		next: Status,
		choice: CompletionChoice | undefined
	): string[] => {
		if (was === 'done' || next !== 'done') return [];
		const open = (server.blocking.get(id) ?? []).filter(
			(child) => (server.status.get(child) ?? 'open') !== 'done'
		);
		if (open.length === 0 || choice === 'force') return [];
		if (choice === 'complete_children') return open;
		throw refusal('status', 'validation_parent_open_children', { count: open.length });
	};
	const send = vi.fn<OutboxDeps['send']>(async (action, fields) => {
		server.sent.push(fields.opId);
		if (!server.reachable) throw new DataError('network');
		if (missing(action.target)) throw notFound();
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
		const children = along(action.target, now, action.payload.status, action.completion);
		server.status.set(action.target, action.payload.status);
		// "Unteraufgaben mit erledigen" completes the sub-tasks in the same save (OF-3b, M3).
		for (const child of children) server.status.set(child, 'done');
		server.applied.add(fields.opId);
		lost();
		return current(action.target);
	});
	const sendDue = vi.fn<NonNullable<OutboxDeps['sendDue']>>(async (action, fields) => {
		server.sent.push(fields.opId);
		if (!server.reachable) throw new DataError('network');
		if (missing(action.target)) throw notFound();
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
		// The route saves the ticket only when it is not done yet; its hooks decide on the sub-tasks.
		const children =
			check && complete ? along(item.ticket, previous, 'done', action.completion) : [];
		for (const child of children) server.status.set(child, 'done');
		if (check && complete) server.status.set(item.ticket, 'done');
		else if (check) item.doneToday = true;
		else if (!complete) item.doneToday = false;
		else if (previous === 'done') server.status.set(item.ticket, reopen);
		server.items.set(action.target, item);
		server.applied.add(fields.opId);
		lost();
		return answer();
	});
	/**
	 * "＋" as a ticket (OF-4a), like tickets.pb.js: the identifier first (`withOp`), then the ID, then
	 * the checks of the hook, the key from the counter, the record and the identifier in one step.
	 */
	const sendCreate = vi.fn<NonNullable<OutboxDeps['sendCreate']>>(async (action, fields) => {
		server.sent.push(fields.opId);
		if (!server.reachable) throw new DataError('network');
		const known = claimed(action, fields.opId);
		if (known !== null) return current(known);
		// The hook refuses a creation at a field it names (an archived project: only with a project).
		const refuse = server.refuseCreate;
		const named = refuse?.field !== 'project' || action.payload.project !== null;
		if (refuse !== null && named) throw refusal(refuse.field, refuse.code);
		server.counter += 1;
		const { payload } = action;
		server.records.set(action.target, {
			collection: 'tickets',
			key: `TASK-${server.counter}`,
			title: payload.title,
			project: payload.project,
			tags: [...payload.tags],
			household: payload.household,
			offline: fields.clientAt !== undefined || fields.offline === true
		});
		server.status.set(action.target, payload.status);
		server.due.set(action.target, payload.due);
		server.claims.set(fields.opId, { kind: 'ticket.create', record: action.target });
		server.applied.add(fields.opId);
		lost();
		return current(action.target);
	});
	/** The entry of the inbox as the server has it (channel "quick", kind "todo"). */
	const itemOf = (id: string): InboxItem => {
		const record = server.records.get(id);
		return {
			id,
			channel: 'quick',
			kind: 'todo',
			title: record?.title ?? '',
			sourceUrl: '',
			sourceRef: '',
			sourceDate: null,
			sourceMeta: {},
			original: '',
			state: 'new',
			ticketId: null,
			ticket: null,
			handledAt: null,
			targetProjectId: null,
			created: SAVED_AT,
			updated: SAVED_AT,
			body: ''
		};
	};
	/** "＋" into the inbox (OF-4a), like inbox.pb.js: no key, no counter. */
	const sendItem = vi.fn<NonNullable<OutboxDeps['sendItem']>>(async (action, fields) => {
		server.sent.push(fields.opId);
		if (!server.reachable) throw new DataError('network');
		const known = claimed(action, fields.opId);
		if (known !== null) return itemOf(known);
		if (server.refuseItem) throw refusal('household', 'validation_household_member');
		server.records.set(action.target, {
			collection: 'inbox_items',
			key: '',
			title: action.payload.title,
			project: action.payload.preset.project,
			tags: [...action.payload.preset.tags],
			household: action.payload.household,
			offline: fields.clientAt !== undefined || fields.offline === true
		});
		server.claims.set(fields.opId, { kind: 'inbox.create', record: action.target });
		server.applied.add(fields.opId);
		lost();
		return itemOf(action.target);
	});
	/** Reading a ticket: one the server does not have (or hides) is not found with `strict`. */
	const read = (id: string): Ticket => {
		if (missing(id) || server.records.get(id)?.collection === 'inbox_items') throw notFound();
		return current(id);
	};
	const readItem = (id: string): InboxItem => {
		if (server.records.get(id)?.collection !== 'inbox_items' || server.hidden.has(id)) {
			throw notFound();
		}
		return itemOf(id);
	};
	return { server, send, sendDue, sendDayPlan, sendCreate, sendItem, read, readItem };
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
	/** An app without the way of the due date (OF-3c, R3-2): kept due dates find none. */
	withoutDue?: boolean;
	/** The area of the client for new records (OF-4a). */
	area?: () => string | null;
}

export function harness(options: HarnessOptions = {}) {
	const storage = options.storage ?? new MemoryOutboxStorage();
	const fake = options.shared ?? fakeServer();
	const { server, send, sendDue, sendDayPlan, sendCreate, sendItem } = fake;
	const connectivity = new ConnectivityStore(async () => server.health);
	// Since OF-4a round 2 (A11) reading a ticket needs `reachable` like every other request: the lookup
	// of a discarded creation without a connection gets no answer.
	const get = vi.fn<OutboxDeps['get']>(async (id) => {
		if (!server.reachable) throw new DataError('network');
		return fake.read(id);
	});
	const getItem = vi.fn<NonNullable<OutboxDeps['getItem']>>(async (id) => {
		if (!server.reachable) throw new DataError('network');
		return fake.readItem(id);
	});
	const outbox = new OutboxStore({
		storage,
		connectivity,
		send,
		...(options.withoutDue !== true && { sendDue }),
		sendDayPlan,
		sendCreate,
		sendItem,
		getItem,
		...(options.area !== undefined && { area: options.area }),
		get,
		tab: options.tab ?? 'tab-a',
		channel: options.channel ?? null,
		random: () => 0.5,
		fill: letters(),
		...(options.account !== undefined && { account: options.account })
	});
	const flags = { show: vi.fn<(input: FlagInput) => string>(() => 'flag'), dismiss: vi.fn() };
	const sink = {
		upsert: vi.fn(),
		flags,
		sessionEnded: vi.fn(),
		childrenOf: vi.fn(() => []),
		upsertItem: vi.fn(),
		markRead: vi.fn()
	};
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
		sendCreate,
		sendItem,
		get,
		getItem,
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

	async swapNoting(
		op: string,
		matches: (current: unknown) => boolean,
		next: KeptAction | null,
		user: string,
		note: (current: unknown) => unknown[] | null
	): Promise<boolean> {
		await this.#turn();
		return super.swapNoting(op, matches, next, user, note);
	}

	open(): void {
		this.holding = false;
		for (const resolve of this.#held.splice(0)) resolve();
	}
}

/**
 * A storage of the device that fails on every write once `failing` is set; `noticesFailing` lets only
 * the writes of the notices on their own fail (OF-3c round 2), the actions are kept.
 */
export class FailingStorage extends MemoryOutboxStorage {
	failing = false;
	noticesFailing = false;

	#check(notices = false): void {
		if (this.failing || (notices && this.noticesFailing)) {
			throw new DOMException('Der Speicher antwortet nicht.', 'UnknownError');
		}
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

	async swapNoting(
		op: string,
		matches: (current: unknown) => boolean,
		next: KeptAction | null,
		user: string,
		note: (current: unknown) => unknown[] | null
	): Promise<boolean> {
		this.#check();
		return super.swapNoting(op, matches, next, user, note);
	}

	async notices(user: string, change?: (current: unknown) => unknown[] | null): Promise<unknown> {
		if (change !== undefined) this.#check(true);
		return super.notices(user, change);
	}

	async remove(ops: readonly string[]): Promise<void> {
		this.#check();
		return super.remove(ops);
	}
}
