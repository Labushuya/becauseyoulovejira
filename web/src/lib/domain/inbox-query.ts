// State of the inbox view in the URL (E4 plan, T-4; ADR-0019 section 6), with the rules of
// list-query.ts: invalid, empty or repeated values count as not set, parameters this module does
// not know stay untouched and in front when writing, the own ones follow in a fixed order. Pure.

import { isInboxState, type InboxState } from './inbox';
import { SOURCE_FAMILIES, SOURCE_FAMILY_VALUES, type SourceFamily } from './source';

export interface InboxQuery {
	/** Source family (chip "Quelle"); null: every source. */
	source: SourceFamily | null;
	/** Shown state (chip "Zustand"); new by default. */
	state: InboxState;
}

export const DEFAULT_INBOX_QUERY: Readonly<InboxQuery> = Object.freeze({
	source: null,
	state: 'new'
});

export const INBOX_PARAMS = Object.freeze({ source: 'quelle', state: 'zustand' } as const);

/** URL values of the states (ADR-0019 section 6). */
export const STATE_VALUES: Readonly<Record<InboxState, string>> = Object.freeze({
	new: 'neu',
	discarded: 'verworfen',
	converted: 'umgewandelt'
});

/** The only value of a parameter, null if it is missing, empty or repeated. */
function single(params: URLSearchParams, name: string): string | null {
	const values = params.getAll(name);
	return values.length === 1 && values[0] !== '' ? (values[0] ?? null) : null;
}

function keyOf<K extends string>(
	keys: readonly K[],
	values: Readonly<Record<K, string>>,
	value: string | null
): K | null {
	if (value === null) return null;
	return keys.find((key) => values[key] === value) ?? null;
}

export function parseInboxQuery(params: URLSearchParams): InboxQuery {
	const states = Object.keys(STATE_VALUES).filter(isInboxState);
	return {
		source: keyOf(SOURCE_FAMILIES, SOURCE_FAMILY_VALUES, single(params, INBOX_PARAMS.source)),
		state: keyOf(states, STATE_VALUES, single(params, INBOX_PARAMS.state)) ?? 'new'
	};
}

/**
 * Query string of `query` (`?…` or ''); unknown parameters of `base` stay in front, in their
 * order. The default state "neu" is not written.
 */
export function serializeInboxQuery(query: InboxQuery, base?: URLSearchParams): string {
	const params = new URLSearchParams();
	const own = new Set<string>(Object.values(INBOX_PARAMS));
	for (const [name, value] of base ?? []) {
		if (!own.has(name)) params.append(name, value);
	}
	if (query.source !== null) params.append(INBOX_PARAMS.source, SOURCE_FAMILY_VALUES[query.source]);
	if (query.state !== 'new') params.append(INBOX_PARAMS.state, STATE_VALUES[query.state]);
	const search = params.toString();
	return search === '' ? '' : `?${search}`;
}
