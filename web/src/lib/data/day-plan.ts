// The day plan (TP-1, ADR-0065; ADR-0006 sections 1 to 5): the routes of app/pb_hooks/day-plans.pb.js
// and the entries of a plan through the Record API with their tickets. Stateless functions with the
// PocketBase instance as a parameter, so the integration tests run them against a disposable
// instance. The plan of the area of the client is asked for with its scope (data/area.ts); without an
// area the server takes the private one. Before the restart after the migration the plan answers
// `missing` (503, or 404 without the route); every other failure is a DataError with the field errors
// of the hook (texts in domain/day-plan.ts).

import type PocketBase from 'pocketbase';
import type { CalendarDate } from '../domain/berlin-date';
import {
	DAY_PLAN_ORIGINS,
	settingsOf,
	type CheckAction,
	type CheckMode,
	type DayPlanOrigin,
	type DayPlanSettings,
	type DayPlanSource,
	type SourceMode,
	type Suggestion
} from '../domain/day-plan';
import { isStatus, type Status } from '../domain/status';
import type { TicketSummary } from '../domain/ticket';
import type { CompletionChoice } from '../domain/subtasks';
import { clientArea } from './area';
import { DataError, toDataError, withDataErrors } from './errors';
import type { RequestOptions } from './options';
import type { RecordChange, Unsubscribe } from './realtime';
import { TICKET_LIST_FIELDS, toTicketSummary, type TicketRecord } from './tickets';

const ROUTE = '/api/byl/dayplan';
const ITEMS = 'day_plan_items';
const PLANS = 'day_plans';

/** The plan of an area and day as the routes name it. */
export interface DayPlanMeta {
	id: string;
	date: CalendarDate;
	scope: string;
	/** Tickets removed from the plan that day; the sources leave them out. */
	dismissed: string[];
}

/** The plan of today of the other area of the account: only how many entries and how many are done. */
export interface OtherAreaPlan {
	scope: string;
	count: number;
	done: number;
}

/** The answer of GET /api/byl/dayplan. */
export interface DayPlanAnswer {
	date: CalendarDate;
	today: CalendarDate;
	tomorrow: CalendarDate;
	scope: string;
	/** Today and tomorrow; days before are read-only. */
	editable: boolean;
	/** Null for a day before without a plan. */
	plan: DayPlanMeta | null;
	/** Suggestions of today as the server computed them (the store computes them live afterwards). */
	suggestions: Suggestion[];
	/** Tickets left over from yesterday ("Übrig von gestern"). */
	leftover: string[];
	settings: DayPlanSettings;
	other: OtherAreaPlan | null;
	/** Tickets of automatic sources this request took in. */
	adopted: number;
}

/** An entry of a plan. `ticket` is its ticket as the Record API expanded it (null when not given). */
export interface DayPlanItem {
	id: string;
	plan: string;
	ticketId: string;
	position: number;
	origin: DayPlanOrigin;
	doneToday: boolean;
	/** UTC timestamp of PocketBase when it was checked, null otherwise. */
	doneAt: string | null;
	/** Who added it ('' for an automatic source) and who checked it ('' when not checked). */
	addedBy: string;
	checkedBy: string;
	created: string;
	updated: string;
	ticket: TicketSummary | null;
}

export type DayPlanResult<T> = { kind: 'ok'; value: T } | { kind: 'missing' };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string')
		: [];
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

function isOrigin(value: unknown): value is DayPlanOrigin {
	return typeof value === 'string' && (DAY_PLAN_ORIGINS as readonly string[]).includes(value);
}

function toMeta(value: unknown): DayPlanMeta | null {
	if (!isRecord(value) || typeof value.id !== 'string' || typeof value.date !== 'string')
		return null;
	return {
		id: value.id,
		date: value.date,
		scope: text(value.scope),
		dismissed: strings(value.dismissed)
	};
}

function toSuggestion(value: unknown): Suggestion | null {
	if (!isRecord(value) || typeof value.id !== 'string') return null;
	const mode = value.mode === 'auto' ? 'auto' : value.mode === 'suggest' ? 'suggest' : null;
	if (mode === null || !isOrigin(value.origin) || value.origin === 'manual') return null;
	return {
		id: value.id,
		mode,
		origin: value.origin as DayPlanSource,
		reasons: strings(value.reasons)
	};
}

/** Reads the answer of the plan strictly; null for anything else. */
export function toDayPlanAnswer(value: unknown): DayPlanAnswer | null {
	if (!isRecord(value) || typeof value.date !== 'string' || typeof value.today !== 'string')
		return null;
	const other = isRecord(value.other)
		? {
				scope: text(value.other.scope),
				count: typeof value.other.count === 'number' ? value.other.count : 0,
				done: typeof value.other.done === 'number' ? value.other.done : 0
			}
		: null;
	return {
		date: value.date,
		today: value.today,
		tomorrow: text(value.tomorrow),
		scope: text(value.scope),
		editable: value.editable === true,
		plan: toMeta(value.plan),
		suggestions: (Array.isArray(value.suggestions) ? value.suggestions : [])
			.map(toSuggestion)
			.filter((entry): entry is Suggestion => entry !== null),
		leftover: strings(value.leftover),
		settings: settingsOf(value.settings),
		other,
		adopted: typeof value.adopted === 'number' ? value.adopted : 0
	};
}

/** An entry as the Record API (with the expanded ticket) or a route (without) returns it. */
interface ItemRecord {
	id: string;
	plan: string;
	ticket: string;
	position?: number;
	origin: string;
	done_today?: boolean;
	done_at?: string;
	added_by?: string;
	checked_by?: string;
	created?: string;
	updated?: string;
	expand?: { ticket?: TicketRecord };
}

/** Maps an entry; throws for a value outside the domain (realtime drops such an event). */
export function toDayPlanItem(record: ItemRecord): DayPlanItem {
	if (!isOrigin(record.origin)) throw new RangeError(`Unknown origin: ${record.origin}`);
	return {
		id: record.id,
		plan: record.plan,
		ticketId: record.ticket,
		position: typeof record.position === 'number' ? record.position : 0,
		origin: record.origin,
		doneToday: record.done_today === true,
		doneAt: record.done_at ? record.done_at : null,
		addedBy: record.added_by ?? '',
		checkedBy: record.checked_by ?? '',
		created: record.created ?? '',
		updated: record.updated ?? '',
		ticket: record.expand?.ticket ? toTicketSummary(record.expand.ticket) : null
	};
}

/** Expand and fields of an entry: its ticket with the fields of the list (data/tickets.ts). */
export const DAY_PLAN_ITEM_EXPAND = 'ticket,ticket.project,ticket.tags,ticket.parent';
export const DAY_PLAN_ITEM_FIELDS = [
	'id',
	'plan',
	'ticket',
	'position',
	'origin',
	'done_today',
	'done_at',
	'added_by',
	'checked_by',
	'created',
	'updated',
	...TICKET_LIST_FIELDS.split(',').map((field) => `expand.ticket.${field}`)
].join(',');

function send(pb: PocketBase, path: string, body: unknown, signal?: AbortSignal) {
	return pb.send(path, {
		method: body === undefined ? 'GET' : 'POST',
		body,
		requestKey: null,
		signal
	});
}

function sendJson(pb: PocketBase, path: string, body: unknown, options: RequestOptions) {
	return withDataErrors(options.signal, () => send(pb, path, body, options.signal));
}

function itemOf(value: unknown): DayPlanItem {
	if (!isRecord(value)) throw new DataError('server');
	try {
		return toDayPlanItem(value as unknown as ItemRecord);
	} catch {
		throw new DataError('server');
	}
}

function metaOf(value: unknown): DayPlanMeta {
	const meta = toMeta(value);
	if (meta === null) throw new DataError('server');
	return meta;
}

/** The scope a request names: the area of the client, the private one of the server without it. */
function scopeOf(pb: PocketBase, scope?: string | null): string {
	return scope ?? clientArea(pb) ?? '';
}

/**
 * The plan of the area and day (today without one); the server creates today and tomorrow lazily and
 * takes the automatic sources in.
 */
export async function fetchDayPlan(
	pb: PocketBase,
	query: { scope?: string | null; date?: CalendarDate | null } = {},
	options: RequestOptions = {}
): Promise<DayPlanResult<DayPlanAnswer>> {
	const params: Record<string, string> = {};
	const scope = scopeOf(pb, query.scope);
	if (scope !== '') params.scope = scope;
	if (query.date) params.date = query.date;
	let answer: unknown;
	try {
		answer = await pb.send(ROUTE, {
			method: 'GET',
			query: params,
			requestKey: null,
			signal: options.signal
		});
	} catch (error) {
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		if (!options.signal?.aborted && (status === 503 || status === 404)) return { kind: 'missing' };
		throw toDataError(error, options.signal);
	}
	const value = toDayPlanAnswer(answer);
	if (value === null) throw new DataError('server');
	return { kind: 'ok', value };
}

/** The entries of a plan in their order, each with its ticket (when visible). */
export function listDayPlanItems(
	pb: PocketBase,
	planId: string,
	{ signal }: RequestOptions = {}
): Promise<DayPlanItem[]> {
	return withDataErrors(signal, async () => {
		const records = await pb.collection(ITEMS).getFullList<ItemRecord>({
			filter: pb.filter('plan = {:plan}', { plan: planId }),
			sort: 'position,created,id',
			expand: DAY_PLAN_ITEM_EXPAND,
			fields: DAY_PLAN_ITEM_FIELDS,
			signal
		});
		return records.map(toDayPlanItem);
	});
}

function changes<R extends { id: string }, T>(
	map: (record: R) => T,
	onChange: (change: RecordChange<T>) => void
): (event: { action: string; record: R }) => void {
	return (event) => {
		if (event.action === 'delete') {
			onChange({ action: 'delete', id: event.record.id });
			return;
		}
		if (event.action !== 'create' && event.action !== 'update') return;
		let record: T;
		try {
			record = map(event.record);
		} catch {
			return;
		}
		onChange({ action: event.action, record });
	};
}

/** The entries of one plan, live for every member of its area (the rule of the plan decides). */
export function subscribeDayPlanItems(
	pb: PocketBase,
	planId: string,
	onChange: (change: RecordChange<DayPlanItem>) => void
): Promise<Unsubscribe> {
	return pb.collection(ITEMS).subscribe<ItemRecord>('*', changes(toDayPlanItem, onChange), {
		filter: pb.filter('plan = {:plan}', { plan: planId }),
		expand: DAY_PLAN_ITEM_EXPAND,
		fields: DAY_PLAN_ITEM_FIELDS
	});
}

/** The plan itself (its `dismissed`), live. */
export function subscribeDayPlan(
	pb: PocketBase,
	planId: string,
	onChange: (change: RecordChange<DayPlanMeta>) => void
): Promise<Unsubscribe> {
	return pb.collection(PLANS).subscribe<{ id: string }>(
		planId,
		changes((record) => metaOf(record), onChange),
		{ fields: 'id,date,scope,dismissed' }
	);
}

/** Answer of putting a ticket into a plan; `already`: it was there. */
export interface AddAnswer {
	item: DayPlanItem;
	plan: DayPlanMeta;
	already: boolean;
}

/**
 * "Zum Tagesplan", "+" of the pool and dragging: the ticket into the plan of `scope` and `date` (its own
 * area and today without them), at `index` or at the end.
 */
export async function addToDayPlan(
	pb: PocketBase,
	input: { ticket: string; scope?: string; date?: CalendarDate; index?: number },
	options: RequestOptions = {}
): Promise<AddAnswer> {
	const answer = await sendJson(pb, `${ROUTE}/items`, input, options);
	if (!isRecord(answer)) throw new DataError('server');
	return { item: itemOf(answer.item), plan: metaOf(answer.plan), already: answer.already === true };
}

/** "Übernehmen": the tickets into the plan of today of `scope`. */
export async function adoptIntoDayPlan(
	pb: PocketBase,
	scope: string,
	tickets: readonly string[],
	options: RequestOptions = {}
): Promise<{ items: DayPlanItem[]; plan: DayPlanMeta }> {
	const answer = await sendJson(
		pb,
		`${ROUTE}/adopt`,
		{ scope: scopeOf(pb, scope) || undefined, tickets },
		options
	);
	if (!isRecord(answer) || !Array.isArray(answer.items)) throw new DataError('server');
	return { items: answer.items.map(itemOf), plan: metaOf(answer.plan) };
}

/** The ticket of a check answer with its status before. */
export interface CheckedTicket {
	id: string;
	key: string;
	status: Status;
	previousStatus: Status;
}

function checkedTicketOf(value: unknown): CheckedTicket {
	if (!isRecord(value) || !isStatus(value.status) || !isStatus(value.previous_status)) {
		throw new DataError('server');
	}
	return {
		id: text(value.id),
		key: text(value.key),
		status: value.status,
		previousStatus: value.previous_status
	};
}

/** The check mark of an entry; `completion` answers the question about open blocking sub-tasks. */
export async function checkDayPlanItem(
	pb: PocketBase,
	id: string,
	mode: CheckMode,
	completion: CompletionChoice | null = null,
	options: RequestOptions = {}
): Promise<{ item: DayPlanItem; ticket: CheckedTicket; action: CheckAction }> {
	const body = completion === null ? { mode } : { mode, completion };
	const answer = await sendJson(
		pb,
		`${ROUTE}/items/${encodeURIComponent(id)}/check`,
		body,
		options
	);
	if (!isRecord(answer) || (answer.action !== 'complete' && answer.action !== 'today')) {
		throw new DataError('server');
	}
	return {
		item: itemOf(answer.item),
		ticket: checkedTicketOf(answer.ticket),
		action: answer.action
	};
}

/** Takes a check mark back: the mark of the day or the completion (with the status before). */
export async function uncheckDayPlanItem(
	pb: PocketBase,
	id: string,
	input: { action?: CheckAction; status?: Status } = {},
	options: RequestOptions = {}
): Promise<{ item: DayPlanItem; ticket: CheckedTicket }> {
	const answer = await sendJson(
		pb,
		`${ROUTE}/items/${encodeURIComponent(id)}/uncheck`,
		input,
		options
	);
	if (!isRecord(answer)) throw new DataError('server');
	return { item: itemOf(answer.item), ticket: checkedTicketOf(answer.ticket) };
}

/** "Auf morgen schieben": the entry leaves today and stands at the end of tomorrow. */
export async function moveDayPlanItemToTomorrow(
	pb: PocketBase,
	id: string,
	options: RequestOptions = {}
): Promise<{ item: DayPlanItem; plan: DayPlanMeta }> {
	const answer = await sendJson(
		pb,
		`${ROUTE}/items/${encodeURIComponent(id)}/tomorrow`,
		{},
		options
	);
	if (!isRecord(answer)) throw new DataError('server');
	return { item: itemOf(answer.item), plan: metaOf(answer.plan) };
}

/** "Entfernen": the entry leaves the plan; the sources leave its ticket out that day. */
export async function removeDayPlanItem(
	pb: PocketBase,
	id: string,
	options: RequestOptions = {}
): Promise<{ plan: DayPlanMeta }> {
	const answer = await sendJson(pb, `${ROUTE}/items/${encodeURIComponent(id)}/remove`, {}, options);
	if (!isRecord(answer)) throw new DataError('server');
	return { plan: metaOf(answer.plan) };
}

/** Puts the entry at `index` of its plan; answers every entry with its position. */
export async function moveDayPlanItem(
	pb: PocketBase,
	id: string,
	index: number,
	options: RequestOptions = {}
): Promise<{ id: string; position: number }[]> {
	const answer = await sendJson(
		pb,
		`${ROUTE}/items/${encodeURIComponent(id)}/move`,
		{ index },
		options
	);
	if (!isRecord(answer) || !Array.isArray(answer.items)) throw new DataError('server');
	return answer.items.filter(isRecord).map((entry) => ({
		id: text(entry.id),
		position: typeof entry.position === 'number' ? entry.position : 0
	}));
}

/** The modes of the sources of an area; missing sources keep their mode. */
export async function saveDayPlanSettings(
	pb: PocketBase,
	scope: string,
	sources: Partial<Record<DayPlanSource, SourceMode>>,
	options: RequestOptions = {}
): Promise<DayPlanSettings> {
	const answer = await sendJson(
		pb,
		`${ROUTE}/settings`,
		{ scope: scopeOf(pb, scope) || undefined, sources },
		options
	);
	if (!isRecord(answer)) throw new DataError('server');
	return settingsOf(answer.settings);
}
