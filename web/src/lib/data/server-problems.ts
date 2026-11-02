// The error log of the server (FP-2, ADR-0077), read only. Stateless functions with the PocketBase
// instance as first parameter; filters always through pb.filter(). The list and view rules of
// problem_events decide what an account sees (a private entry only its owner, one of a household its
// members, one of the app the administrator), so the SPA asks for no area: the log is no list of the
// area of the tab but of everything the account may see. Writing is not possible through the API.

import type PocketBase from 'pocketbase';
import {
	SERVER_PROBLEMS_PAGE,
	parseServerProblem,
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

/**
 * The ID of the newest entry of a failed run of the connection `connectionId`, or null: the way of
 * "Details" at the last error of a card to its entry.
 */
export function latestChannelProblem(
	pb: PocketBase,
	connectionId: string,
	{ signal }: RequestOptions = {}
): Promise<string | null> {
	return withDataErrors(signal, async () => {
		const page = await pb.collection(EVENTS).getList(1, 1, {
			// The entries of failed runs of this connection, newest first (JSON path of the context).
			filter: pb.filter('source = "channel" && context.connection = {:connection}', {
				connection: connectionId
			}),
			sort: '-last_at',
			fields: 'id',
			skipTotal: true,
			signal
		});
		const first = page.items[0];
		return first !== undefined && typeof first.id === 'string' ? first.id : null;
	});
}
