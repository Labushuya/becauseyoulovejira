// State of the inbox view in the URL (E4 plan, T-4; ADR-0019 section 6), with the rules of
// list-query.ts: invalid, empty or repeated values count as not set, parameters this module does
// not know stay untouched and in front when writing, the own ones follow in a fixed order. Pure.
// Since EG-2 (ADR-0014 addendum EG-2) the search `q`: trimmed, at most SEARCH_MAX_LENGTH characters
// like the search of "Aufgaben"; a longer one counts as not set.

import { INBOX_VIEWS, type InboxView } from './inbox';
import { SEARCH_MAX_LENGTH } from './list-query';
import { SOURCE_FAMILIES, SOURCE_FAMILY_VALUES, type SourceFamily } from './source';
import { NO_TARGET } from './target-project';

export interface InboxQuery {
	/** Source family (chip "Quelle"); null: every source. */
	source: SourceFamily | null;
	/** Shown view (chip "Zustand"): the new entries by default (ADR-0031, addendum C). */
	state: InboxView;
	/**
	 * Filter "Zielprojekt" (ADR-0049 §5): a project ID (with its sub projects) or NO_TARGET for the
	 * entries without one; null or absent: every entry.
	 */
	target?: string | null;
	/** Grouped by target project ("Nach Zielprojekt gruppieren", ADR-0049 §5); absent: not grouped. */
	grouped?: boolean;
	/**
	 * Search text of the field "Einträge durchsuchen" (EG-2), trimmed, 1 to SEARCH_MAX_LENGTH
	 * characters; null or absent: no search.
	 */
	search?: string | null;
}

export const DEFAULT_INBOX_QUERY: Readonly<InboxQuery> = Object.freeze({
	source: null,
	state: 'new',
	target: null,
	grouped: false,
	search: null
});

export const INBOX_PARAMS = Object.freeze({
	source: 'quelle',
	state: 'zustand',
	target: 'zielprojekt',
	group: 'gruppe',
	search: 'q'
} as const);

/** URL value of the grouping by target project. */
export const GROUP_BY_TARGET = 'zielprojekt';

/** URL values of the views (ADR-0019 section 6; "verknuepft" and "alle" since HK-7). */
export const STATE_VALUES: Readonly<Record<InboxView, string>> = Object.freeze({
	new: 'neu',
	discarded: 'verworfen',
	converted: 'verknuepft',
	all: 'alle'
});

/** Older URL values that still open their view: "umgewandelt" before HK-7. */
const LEGACY_STATE_VALUES: ReadonlyMap<string, InboxView> = new Map([['umgewandelt', 'converted']]);

const RECORD_ID = /^[a-z0-9]{15}$/;

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

/** A project ID or "ohne"; anything else counts as not set. */
function targetOf(value: string | null | undefined): string | null {
	return typeof value === 'string' && (value === NO_TARGET || RECORD_ID.test(value)) ? value : null;
}

/** The trimmed search text; an empty or too long one counts as not set (as in list-query.ts). */
function searchOf(value: string | null | undefined): string | null {
	const text = value?.trim() ?? '';
	return text === '' || text.length > SEARCH_MAX_LENGTH ? null : text;
}

export function parseInboxQuery(params: URLSearchParams): InboxQuery {
	return {
		source: keyOf(SOURCE_FAMILIES, SOURCE_FAMILY_VALUES, single(params, INBOX_PARAMS.source)),
		state: viewOf(single(params, INBOX_PARAMS.state)),
		target: targetOf(single(params, INBOX_PARAMS.target)),
		grouped: single(params, INBOX_PARAMS.group) === GROUP_BY_TARGET,
		search: searchOf(single(params, INBOX_PARAMS.search))
	};
}

/**
 * Query string of `query` (`?…` or ''); unknown parameters of `base` stay in front, in their
 * order. The default view "neu", no target, no grouping and no search are not written; the search
 * comes last, trimmed.
 */
export function serializeInboxQuery(query: InboxQuery, base?: URLSearchParams): string {
	const params = new URLSearchParams();
	const own = new Set<string>(Object.values(INBOX_PARAMS));
	for (const [name, value] of base ?? []) {
		if (!own.has(name)) params.append(name, value);
	}
	if (query.source !== null) params.append(INBOX_PARAMS.source, SOURCE_FAMILY_VALUES[query.source]);
	if (query.state !== 'new') params.append(INBOX_PARAMS.state, STATE_VALUES[query.state]);
	const target = targetOf(query.target);
	if (target !== null) params.append(INBOX_PARAMS.target, target);
	if (query.grouped === true) params.append(INBOX_PARAMS.group, GROUP_BY_TARGET);
	const text = searchOf(query.search);
	if (text !== null) params.append(INBOX_PARAMS.search, text);
	const search = params.toString();
	return search === '' ? '' : `?${search}`;
}
