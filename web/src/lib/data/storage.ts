// Page "Einstellungen → Speicher" (ADR-0047 §6 to §9; ADR-0006 sections 1 to 5): the routes of
// app/pb_hooks/storage.pb.js. A refusal of the route (this machine, the address of the app, the
// administrator of the app, rate limit, busy) and a missing route (404 before the restart after an
// update) come as `denied` with their reason, a refused choice (400 with `reason: 'invalid'`) as
// `invalid` with the words of the server; the session, the network, an aborted signal and every other
// error answer (also a 400 without `reason: 'invalid'`, e.g. a failure of the hook, FP-3b) are
// DataErrors. A refusal and an answer of another form keep the entry behind "Details" beside the
// answer (`denialProblem`, FP-3b). The browser sends Origin itself; nothing here names an address.

import type PocketBase from 'pocketbase';
import {
	parseOverview,
	type LeftoverGroup,
	type StorageAction,
	type StorageOverview
} from '../domain/storage';
import { denialOf, type SystemDenial } from '../domain/system';
import { reportRefusal } from './context';
import { keepAnswerProblem, problemOf, toDataError, unreadableProblem } from './errors';
import type { RequestOptions } from './options';

const ROUTE = '/api/byl/storage';
// Statuses with which the route refuses, plus 404 without the route (before the restart).
const DENIAL_STATUSES = [403, 404, 409, 429, 502, 503];

export type StorageAnswer<T> =
	| { kind: 'ok'; value: T }
	| { kind: 'denied'; reason: SystemDenial }
	| { kind: 'invalid'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function ask<T>(
	signal: AbortSignal | undefined,
	request: { method: 'GET' | 'POST'; path: string },
	call: () => Promise<unknown>,
	parse: (answer: unknown) => T | null
): Promise<StorageAnswer<T>> {
	let answer: unknown;
	try {
		answer = await call();
	} catch (error) {
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		const response = isRecord(error) && isRecord(error.response) ? error.response : {};
		if (!signal?.aborted && status === 400 && response.reason === 'invalid') {
			return {
				kind: 'invalid',
				message: typeof response.message === 'string' ? response.message : ''
			};
		}
		if (!signal?.aborted && DENIAL_STATUSES.includes(status)) {
			reportRefusal(response.reason);
			return keepAnswerProblem<StorageAnswer<T>>(
				{ kind: 'denied', reason: denialOf(status, response.reason) },
				problemOf(error)
			);
		}
		throw toDataError(error, signal);
	}
	const value = parse(answer);
	if (value !== null) return { kind: 'ok', value };
	return keepAnswerProblem<StorageAnswer<T>>(
		{ kind: 'denied', reason: 'script' },
		unreadableProblem(request.method, request.path)
	);
}

/** What the app takes, measured now. */
export function fetchStorage(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<StorageAnswer<StorageOverview>> {
	return ask(
		options.signal,
		{ method: 'GET', path: ROUTE },
		() => pb.send(ROUTE, { method: 'GET', requestKey: null, signal: options.signal }),
		parseOverview
	);
}

/**
 * An action of the page: "vacuum", "leftovers" (with the chosen groups) or "discarded". Answers
 * the result of the server as it is; the page measures again afterwards.
 */
export function runStorageAction(
	pb: PocketBase,
	action: StorageAction,
	groups: readonly LeftoverGroup[] = [],
	options: RequestOptions = {}
): Promise<StorageAnswer<Record<string, unknown>>> {
	const path = `${ROUTE}/actions/${encodeURIComponent(action)}`;
	return ask(
		options.signal,
		{ method: 'POST', path },
		() =>
			pb.send(path, {
				method: 'POST',
				body: action === 'leftovers' ? { groups } : {},
				requestKey: null,
				signal: options.signal
			}),
		(answer) => (isRecord(answer) && isRecord(answer.result) ? answer.result : null)
	);
}
