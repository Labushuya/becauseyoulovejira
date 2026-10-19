// "Auf Unteraufgaben übertragen …" (UE-1, ADR-0070): the request of the dialog. Stateless function with
// the PocketBase instance as first parameter; the root integration tests run it against the disposable
// instance. The route changes the sub-tasks in one transaction, or nothing; the lists follow by
// realtime like after any change.

import type PocketBase from 'pocketbase';
import {
	toTransferOutcome,
	transferRequestBody,
	type TransferOutcome,
	type TransferRequest
} from '../domain/subtask-transfer';
import { DataError, toDataError } from './errors';
import type { RequestOptions } from './options';

const routeOf = (parentId: string) =>
	`/api/byl/tickets/${encodeURIComponent(parentId)}/subtasks/transfer`;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/**
 * A 404 without the field `ticket`: the server does not know the route yet (before its restart).
 * The route itself answers a missing parent with 404 and that field.
 */
function routeMissing(error: unknown): boolean {
	if (!isRecord(error) || error.status !== 404) return false;
	const response = isRecord(error.response) ? error.response : {};
	const data = isRecord(response.data) ? response.data : {};
	return !Object.hasOwn(data, 'ticket');
}

/**
 * Gives sub-tasks of `parentId` the chosen fields of it. Resolves to the answer, or to null while the
 * server does not know the route (404, before its restart): then nothing was sent anywhere. A refusal
 * comes as a `DataError` (per field for 400, `not_found` for a parent that is gone, status 409 when it
 * changed meanwhile); then nothing was changed.
 */
export async function transferToSubtasks(
	pb: PocketBase,
	parentId: string,
	request: TransferRequest,
	{ signal }: RequestOptions = {}
): Promise<TransferOutcome | null> {
	let answer: unknown;
	try {
		answer = await pb.send(routeOf(parentId), {
			method: 'POST',
			body: transferRequestBody(request),
			requestKey: null,
			signal
		});
	} catch (error) {
		if (!signal?.aborted && routeMissing(error)) return null;
		throw toDataError(error, signal);
	}
	const outcome = toTransferOutcome(answer);
	if (outcome === null) throw new DataError('server');
	return outcome;
}
