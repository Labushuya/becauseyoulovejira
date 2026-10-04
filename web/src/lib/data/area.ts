// The area of a PocketBase client (E7-3, ADR-0059 §2): "Privat" (`u:<account>`) or a household
// (`h:<household>`). The area store of the (app) layout sets it before the stores load; every list,
// count, search, choice and realtime subscription of a collection with a scope then asks the server
// only for that area, and everything the app creates lands in it. Without an area (tests of the data
// layer, a client that is not the one of the app) every function works as before E7-3: the API rules
// alone decide what is visible, and new records are private.
//
// The area belongs to the client like its session (`pb.authStore`), so the stateless functions of the
// data layer keep their signatures; the filter goes to the server as a parameter of pb.filter().
// When the area changes, every subscription made through `followArea` subscribes again with the new
// filter, and `onAreaChange` tells the stores to load again (data/realtime.ts `onReconnect`).

import type PocketBase from 'pocketbase';
import { householdOfScope, isAreaScope, type AreaRecordKind } from '../domain/area';
import { toDataError, withDataErrors } from './errors';
import type { RequestOptions } from './options';

type Unsubscribe = () => Promise<void>;

/** Collections of the records a route opens; the trash has its own route. */
const RECORD_COLLECTIONS: Readonly<Record<Exclude<AreaRecordKind, 'trash'>, string>> = {
	ticket: 'tickets',
	project: 'projects',
	item: 'inbox_items',
	rule: 'recurrence_rules'
};

const areas = new WeakMap<PocketBase, string>();
const listeners = new WeakMap<PocketBase, Set<() => void>>();

/** Name of the filter parameter of the area; no filter of the data layer uses it otherwise. */
const AREA_PARAM = 'bylArea';

/**
 * Waits before subscribing again after a failed attempt, as `hold` of stores/realtime.ts does
 * (ADR-0007 addendum): 1, 2, 5 and 10 s, then every 30 s.
 */
const RESUBSCRIBE_DELAYS_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000];
const RESUBSCRIBE_MAX_MS = 30_000;

/**
 * Sets the area of the client (`u:<id>` or `h:<id>`), or removes it with null. A change reaches the
 * listeners of `onAreaChange` after the current task, so whoever sets it loads first.
 */
export function setClientArea(pb: PocketBase, scope: string | null): void {
	if (scope !== null && !isAreaScope(scope)) throw new RangeError(`Not an area: ${scope}`);
	const before = areas.get(pb) ?? null;
	if (scope === null) areas.delete(pb);
	else areas.set(pb, scope);
	if (before === scope) return;
	const current = listeners.get(pb);
	if (current === undefined || current.size === 0) return;
	queueMicrotask(() => {
		for (const listener of [...current]) listener();
	});
}

/** The area of the client, null without one. */
export function clientArea(pb: PocketBase): string | null {
	return areas.get(pb) ?? null;
}

/** The household of the area of the client for new records: '' for "Privat" and without an area. */
export function clientHousehold(pb: PocketBase): string {
	const scope = clientArea(pb);
	return scope === null ? '' : householdOfScope(scope);
}

/**
 * The area of a record a route opens (E7-3, ADR-0059 §7), whatever area the client shows: its scope,
 * or null when the account does not see it (not found, no access, in the trash for the other kinds).
 * Only the scope is read; the view rules decide as for every other read.
 */
export function recordScope(
	pb: PocketBase,
	kind: AreaRecordKind,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<string | null> {
	return withDataErrors(signal, async () => {
		try {
			const record: Record<string, unknown> =
				kind === 'trash'
					? await pb.send(`/api/byl/trash/${encodeURIComponent(id)}`, { method: 'GET', signal })
					: await pb
							.collection(RECORD_COLLECTIONS[kind])
							.getOne(id, { fields: 'id,scope', signal });
			return isAreaScope(record.scope) ? record.scope : null;
		} catch (error) {
			const failure = toDataError(error, signal);
			if (failure.kind === 'not_found' || failure.kind === 'forbidden') return null;
			throw error;
		}
	});
}

/** Calls `listener` after every change of the area of the client; returns the way to stop. */
export function onAreaChange(pb: PocketBase, listener: () => void): () => void {
	let current = listeners.get(pb);
	if (current === undefined) {
		current = new Set();
		listeners.set(pb, current);
	}
	current.add(listener);
	const set = current;
	return () => {
		set.delete(listener);
	};
}

/**
 * The filter `expression` with `params`, narrowed to the area of the client (`scope = …`); without an
 * area exactly the filter of before. `expression` may be '' for "every record of the area".
 */
export function areaFilter(
	pb: PocketBase,
	expression: string,
	params: Record<string, unknown> = {}
): string {
	const scope = clientArea(pb);
	if (scope === null) return expression === '' ? '' : pb.filter(expression, params);
	const narrowed =
		expression === '' ? `scope = {:${AREA_PARAM}}` : `(${expression}) && scope = {:${AREA_PARAM}}`;
	return pb.filter(narrowed, { ...params, [AREA_PARAM]: scope });
}

/**
 * Request options with the filter of `areaFilter`, or none for an empty one: a list of the whole
 * collection, and a realtime subscription, so the server sends no event of another area. Without an
 * area and without an expression nothing changes against before.
 */
export function areaOptions(
	pb: PocketBase,
	expression = '',
	params: Record<string, unknown> = {}
): { filter?: string } {
	const filter = areaFilter(pb, expression, params);
	return filter === '' ? {} : { filter };
}

/**
 * A realtime subscription that follows the area of the client: `subscribe` makes it with the filter
 * of the current area, and after every change of the area it ends the old one and makes it again
 * (a failed attempt is tried again like `hold` does). The returned stop ends both. The first attempt
 * fails like `subscribe`, so `hold` keeps trying it as before.
 */
export async function followArea(
	pb: PocketBase,
	subscribe: () => Promise<Unsubscribe>
): Promise<Unsubscribe> {
	let current: Unsubscribe | null = await subscribe();
	let stopped = false;
	let generation = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const attempt = (mine: number, failures: number): void => {
		subscribe().then(
			(next) => {
				if (stopped || mine !== generation) {
					void next().catch(() => undefined);
					return;
				}
				current = next;
			},
			() => {
				if (stopped || mine !== generation) return;
				const delay = RESUBSCRIBE_DELAYS_MS[failures] ?? RESUBSCRIBE_MAX_MS;
				timer = setTimeout(() => attempt(mine, failures + 1), delay);
			}
		);
	};
	const stopListening = onAreaChange(pb, () => {
		if (stopped) return;
		generation += 1;
		clearTimeout(timer);
		const old = current;
		current = null;
		void old?.().catch(() => undefined);
		attempt(generation, 0);
	});
	return async () => {
		stopped = true;
		stopListening();
		clearTimeout(timer);
		const last = current;
		current = null;
		await last?.();
	};
}
