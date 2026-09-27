// State of the inbox view in the URL (E4 plan, T-4; ADR-0019 section 6), with the rules of
// list-query.ts: invalid, empty or repeated values count as not set, parameters this module does
// not know stay untouched and in front when writing, the own ones follow in a fixed order. Pure.

import { INBOX_VIEWS, type InboxView } from './inbox';
import { SOURCE_FAMILIES, SOURCE_FAMILY_VALUES, type SourceFamily } from './source';

export interface InboxQuery {
	/** Source family (chip "Quelle"); null: every source. */
	source: SourceFamily | null;
	/** Shown view (chip "Zustand"): the new entries by default (ADR-0031, addendum C). */
	state: InboxView;
}

export const DEFAULT_INBOX_QUERY: Readonly<InboxQuery> = Object.freeze({
	source: null,
	state: 'new'
});

export const INBOX_PARAMS = Object.freeze({ source: 'quelle', state: 'zustand' } as const);

/** URL values of the views (ADR-0019 section 6; "verknuepft" and "alle" since HK-7). */
export const STATE_VALUES: Readonly<Record<InboxView, string>> = Object.freeze({
	new: 'neu',
	discarded: 'verworfen',
	converted: 'verknuepft',
	all: 'alle'
});

/** Older URL values that still open their view: "umgewandelt" before HK-7. */
const LEGACY_STATE_VALUES: ReadonlyMap<string, InboxView> = new Map([['umgewandelt', 'converted']]);

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

function viewOf(value: string | null): InboxView {
	if (value === null) return 'new';
	return keyOf(INBOX_VIEWS, STATE_VALUES, value) ?? LEGACY_STATE_VALUES.get(value) ?? 'new';
}

export function parseInboxQuery(params: URLSearchParams): InboxQuery {
	return {
		source: keyOf(SOURCE_FAMILIES, SOURCE_FAMILY_VALUES, single(params, INBOX_PARAMS.source)),
		state: viewOf(single(params, INBOX_PARAMS.state))
	};
}

/**
 * Query string of `query` (`?…` or ''); unknown parameters of `base` stay in front, in their
 * order. The default view "neu" is not written.
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
