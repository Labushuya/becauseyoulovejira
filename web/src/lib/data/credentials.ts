// Access data of the channels (BW-3, ADR-0075; ADR-0006 sections 1 to 5): the routes of
// app/pb_hooks/credentials.pb.js. Stateless functions with the PocketBase instance as first
// parameter. A value goes only into the body of the POST of "Setzen" (never into the address, a
// store or a log of the app) and never comes back. Refusals of the checks of the page System come
// as `denied` with their reason, problems of a name or value (400) as `invalid` with the words of
// the server; the session, the network and an aborted signal are DataErrors. These requests never
// go into the outbox of the app (ADR-0074): it takes only the actions it knows, and this module
// gives it none. The browser sends Origin itself; nothing here names an address.

import type PocketBase from 'pocketbase';
import {
	credentialProblemOf,
	parseCredentialStatus,
	type CredentialProblem,
	type CredentialStatus
} from '../domain/credentials';
import type { ProblemEntry } from '../domain/problems';
import { denialOf, type SystemDenial } from '../domain/system';
import { reportRefusal } from './context';
import { DataError, noteRequest, problemOf, toDataError } from './errors';
import type { RequestOptions } from './options';

const ROUTE = '/api/byl/credentials';
// Statuses with which the routes refuse like the page System (403, 404, 409, 429, 502, 503).
const DENIAL_STATUSES = [403, 404, 409, 429, 502, 503];

export type CredentialAnswer<T> =
	| { kind: 'ok'; value: T }
	| { kind: 'denied'; reason: SystemDenial; problem: ProblemEntry | null }
	| { kind: 'invalid'; problem: CredentialProblem; message: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function ask<T>(
	signal: AbortSignal | undefined,
	request: { method: 'GET' | 'POST'; path: string },
	call: () => Promise<unknown>,
	parse: (answer: unknown) => T | null
): Promise<CredentialAnswer<T>> {
	let answer: unknown;
	try {
		answer = await call();
	} catch (error) {
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		const response = isRecord(error) && isRecord(error.response) ? error.response : {};
		if (!signal?.aborted && status === 400) {
			return {
				kind: 'invalid',
				problem: credentialProblemOf(response),
				message: typeof response.message === 'string' ? response.message : null
			};
		}
		if (!signal?.aborted && DENIAL_STATUSES.includes(status)) {
			reportRefusal(response.reason);
			const reason = denialOf(status, response.reason);
			return { kind: 'denied', reason, problem: reason === 'script' ? problemOf(error) : null };
		}
		throw toDataError(error, signal);
	}
	const value = parse(answer);
	if (value !== null) return { kind: 'ok', value };
	// The server answered, but not in the form of the route: "Unerwartete Antwort des Servers".
	const unreadable = new DataError('server');
	noteRequest(unreadable, request.method, request.path);
	return { kind: 'denied', reason: 'script', problem: problemOf(unreadable) };
}

/**
 * The state of the variables of the connections, plus `names` a setup suggests before its
 * connection exists (only names, never values).
 */
export function fetchCredentialStatus(
	pb: PocketBase,
	names: readonly string[] = [],
	options: RequestOptions = {}
): Promise<CredentialAnswer<CredentialStatus>> {
	return ask(
		options.signal,
		{ method: 'GET', path: ROUTE },
		() =>
			pb.send(ROUTE, {
				method: 'GET',
				requestKey: null,
				signal: options.signal,
				...(names.length > 0 && { query: { names: names.join(',') } })
			}),
		parseCredentialStatus
	);
}

/** What "Setzen" and "Entfernen" answer: the variable and whether a restart is needed now. */
export interface CredentialChange {
	name: string;
	set: boolean;
	restartNeeded: boolean;
}

function parseChange(answer: unknown): CredentialChange | null {
	if (!isRecord(answer) || typeof answer.name !== 'string' || typeof answer.set !== 'boolean') {
		return null;
	}
	return { name: answer.name, set: answer.set, restartNeeded: answer.restartNeeded === true };
}

/** "Setzen" / "Ersetzen": `value` goes only into this one body and is not kept. */
export function setCredential(
	pb: PocketBase,
	name: string,
	value: string,
	options: RequestOptions = {}
): Promise<CredentialAnswer<CredentialChange>> {
	const path = `${ROUTE}/set`;
	return ask(
		options.signal,
		{ method: 'POST', path },
		() =>
			pb.send(path, {
				method: 'POST',
				requestKey: null,
				signal: options.signal,
				body: { name, value }
			}),
		parseChange
	);
}

/** "Entfernen". */
export function removeCredential(
	pb: PocketBase,
	name: string,
	options: RequestOptions = {}
): Promise<CredentialAnswer<CredentialChange>> {
	const path = `${ROUTE}/remove`;
	return ask(
		options.signal,
		{ method: 'POST', path },
		() =>
			pb.send(path, { method: 'POST', requestKey: null, signal: options.signal, body: { name } }),
		parseChange
	);
}

/** Whether a change of access data waits for a restart; for the administrator on every device. */
export function fetchRestartNotice(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<CredentialAnswer<boolean>> {
	const path = `${ROUTE}/restart-notice`;
	return ask(
		options.signal,
		{ method: 'GET', path },
		() => pb.send(path, { method: 'GET', requestKey: null, signal: options.signal }),
		(answer) => (isRecord(answer) && typeof answer.needed === 'boolean' ? answer.needed : null)
	);
}
