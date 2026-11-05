// The error log of the server (FP-2, ADR-0077), read only. Stateless functions with the PocketBase
// instance as first parameter; filters always through pb.filter(). The list and view rules of
// problem_events decide what an account sees (a private entry only its owner, one of a household its
// members, one of the app the administrator), so the SPA asks for no area of the tab: the log is no
// list of the area of the tab but of everything the account may see. The filters of the page
// "Fehlerprotokoll" (FP-3) only narrow that. Writing is not possible through the API.

import type PocketBase from 'pocketbase';
import {
	CHANNEL_PROBLEM_HITS_MAX,
	SERVER_PROBLEMS_PAGE,
	parseChannelProblemHit,
	parseServerProblem,
	serverProblemCursorOf,
	type ChannelProblemHit,
	type ServerProblemPage,
	type ServerProblemQuery,
	type ServerProblemRecord
} from '../domain/server-problems';
import { DataError, withDataErrors } from './errors';
import type { RequestOptions } from './options';

const EVENTS = 'problem_events';

/** Fields of an entry; the fingerprint is hidden anyway. */
export const SERVER_PROBLEM_FIELDS = 'id,source,area,code,message,context,count,first_at,last_at';

function toRecords(items: readonly unknown[]): ServerProblemRecord[] {
	return items
		.map(parseServerProblem)
		.filter((entry): entry is ServerProblemRecord => entry !== null);
}

/** The newest entries the account may see, at most SERVER_PROBLEMS_PAGE. */
export function listServerProblems(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<ServerProblemRecord[]> {
	return withDataErrors(signal, async () => {
		const page = await pb.collection(EVENTS).getList(1, SERVER_PROBLEMS_PAGE, {
			sort: '-last_at,-id',
			fields: SERVER_PROBLEM_FIELDS,
			skipTotal: true,
			signal
		});
		return toRecords(page.items);
	});
}

/**
 * The list of the page "Fehlerprotokoll" (FP-3): source and area when chosen, and after the cursor
 * of the page before only older entries in the order of the sort -last_at,-id (keyset: an earlier
 * last occurrence, or the same one with a smaller ID). An unset value is '' and switches its
 * condition off.
 */
const SERVER_PROBLEM_PAGE_FILTER = [
	'({:source} = "" || source = {:source})',
	'({:area} = "" || area = {:area})',
	'({:lastAt} = "" || last_at < {:lastAt} || (last_at = {:lastAt} && id < {:id}))'
].join(' && ');

/**
 * One page of the page "Fehlerprotokoll" (FP-3), at most SERVER_PROBLEMS_PAGE entries, newest first,
 * with the cursor of the next page. It asks for one entry more than it shows: only when that one is
 * there does a next page follow, so a list of exactly 50 offers no "Mehr laden" that finds nothing.
 * The cursor comes from the last shown entry as the server sent it, also when it could not be read,
 * so the list always moves on.
 */
export function listServerProblemPage(
	pb: PocketBase,
	query: ServerProblemQuery,
	{ signal }: RequestOptions = {}
): Promise<ServerProblemPage> {
	return withDataErrors(signal, async () => {
		const page = await pb.collection(EVENTS).getList(1, SERVER_PROBLEMS_PAGE + 1, {
			filter: pb.filter(SERVER_PROBLEM_PAGE_FILTER, {
				source: query.source ?? '',
				area: query.area ?? '',
				lastAt: query.after?.lastAt ?? '',
				id: query.after?.id ?? ''
			}),
			sort: '-last_at,-id',
			fields: SERVER_PROBLEM_FIELDS,
			skipTotal: true,
			signal
		});
		const shown = page.items.slice(0, SERVER_PROBLEMS_PAGE);
		const more = page.items.length > SERVER_PROBLEMS_PAGE;
		return {
			records: toRecords(shown),
			next: more ? serverProblemCursorOf(shown.at(-1)) : null
		};
	});
}

/** One entry, e.g. the one an address names; "not_found" when it is gone or not visible. */
export function getServerProblem(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<ServerProblemRecord> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection(EVENTS)
			.getOne(id, { fields: SERVER_PROBLEM_FIELDS, signal });
		const entry = parseServerProblem(record);
		if (entry === null) throw new DataError('not_found');
		return entry;
	});
}

/** A time in the form of PocketBase (`YYYY-MM-DD HH:MM:SS.mmmZ`), as the filter compares it. */
function pocketBaseTime(ms: number): string {
	return new Date(ms).toISOString().replace('T', ' ');
}

/** The entries of failed runs of a connection since a time, newest first. */
const CHANNEL_HITS_FILTER = [
	'source = "channel"',
	'context.connection != ""',
	'last_at >= {:since}'
].join(' && ');

/**
 * The entries of failed runs whose last occurrence is not before `since` (ms), newest first, of the
 * connections `connectionIds` (by `context.connection`, the JSON path of the context): one query for
 * the whole page "Kanäle", the way of "Details" at the last error of the cards to their entries
 * (domain matchChannelProblems). At most CHANNEL_PROBLEM_HITS_MAX entries; the same failure counts on
 * one entry, so a few cover every card.
 */
export function channelProblemHits(
	pb: PocketBase,
	connectionIds: readonly string[],
	since: number,
	{ signal }: RequestOptions = {}
): Promise<ChannelProblemHit[]> {
	return withDataErrors(signal, async () => {
		const asked = new Set(connectionIds);
		if (asked.size === 0) return [];
		const page = await pb.collection(EVENTS).getList(1, CHANNEL_PROBLEM_HITS_MAX, {
			filter: pb.filter(CHANNEL_HITS_FILTER, { since: pocketBaseTime(since) }),
			sort: '-last_at,-id',
			fields: 'id,context,last_at',
			skipTotal: true,
			signal
		});
		return page.items
			.map(parseChannelProblemHit)
			.filter((hit): hit is ChannelProblemHit => hit !== null && asked.has(hit.connection));
	});
}
