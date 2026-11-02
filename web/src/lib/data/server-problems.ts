// The error log of the server (FP-2, ADR-0077), read only. Stateless functions with the PocketBase
// instance as first parameter; filters always through pb.filter(). The list and view rules of
// problem_events decide what an account sees (a private entry only its owner, one of a household its
// members, one of the app the administrator), so the SPA asks for no area: the log is no list of the
// area of the tab but of everything the account may see. Writing is not possible through the API.

import type PocketBase from 'pocketbase';
import {
	CHANNEL_PROBLEM_HITS_MAX,
	SERVER_PROBLEMS_PAGE,
	parseChannelProblemHit,
	parseServerProblem,
	type ChannelProblemHit,
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
