// Page "Einstellungen → Sicherheit" (ADR-0055 §8; ADR-0006 sections 1 to 5): the routes of
// app/pb_hooks/security.pb.js. A refusal of the route (this machine, the address of the app, the
// owner of the instance, rate limit, no own instance for the hosts) and a missing route (404 before
// the restart after an update) come as `denied` with their reason, a 400 as `invalid` with its
// problem; the session, the network and an aborted signal are DataErrors. The browser sends Origin
// itself; nothing here names an address.

import type PocketBase from 'pocketbase';
import {
	parseNotice,
	parseSecurity,
	type LevelChoice,
	type SecurityNotice,
	type SecurityOverview
} from '../domain/security';
import { denialOf, type SystemDenial } from '../domain/system';
import { toDataError } from './errors';
import type { RequestOptions } from './options';

const ROUTE = '/api/byl/security';
// Statuses with which the routes refuse, plus 404 without the route (before the restart).
const DENIAL_STATUSES = [403, 404, 409, 429, 502, 503];

export type SecurityAnswer<T> =
	| { kind: 'ok'; value: T }
	| { kind: 'denied'; reason: SystemDenial }
	| { kind: 'invalid'; problem: string; invalid: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function ask<T>(
	signal: AbortSignal | undefined,
	call: () => Promise<unknown>,
	parse: (answer: unknown) => T | null
): Promise<SecurityAnswer<T>> {
	let answer: unknown;
	try {
		answer = await call();
	} catch (error) {
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		const response = isRecord(error) && isRecord(error.response) ? error.response : {};
		if (!signal?.aborted && status === 400) {
			const invalid = Array.isArray(response.invalid)
				? response.invalid.filter((entry): entry is string => typeof entry === 'string')
				: [];
			const problem = typeof response.problem === 'string' ? response.problem : 'empty';
			return { kind: 'invalid', problem, invalid };
		}
		if (!signal?.aborted && DENIAL_STATUSES.includes(status)) {
			return { kind: 'denied', reason: denialOf(status, response.reason) };
		}
		throw toDataError(error, signal);
	}
	const value = parse(answer);
	return value === null ? { kind: 'denied', reason: 'script' } : { kind: 'ok', value };
}

/** Everything the page shows. */
export function fetchSecurity(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<SecurityAnswer<SecurityOverview>> {
	return ask(
		options.signal,
		() => pb.send(ROUTE, { method: 'GET', requestKey: null, signal: options.signal }),
		parseSecurity
	);
}

/** Level of the protection and/or the validity of a sign-in; answers the new overview. */
export function saveSecuritySettings(
	pb: PocketBase,
	settings: { level?: LevelChoice; days?: number },
	options: RequestOptions = {}
): Promise<SecurityAnswer<SecurityOverview>> {
	return ask(
		options.signal,
		() =>
			pb.send(`${ROUTE}/settings`, {
				method: 'POST',
				body: settings,
				requestKey: null,
				signal: options.signal
			}),
		parseSecurity
	);
}

/** The further hosts (an empty list removes them); they apply after a restart. */
export function saveSecurityHosts(
	pb: PocketBase,
	hosts: readonly string[],
	options: RequestOptions = {}
): Promise<SecurityAnswer<SecurityOverview>> {
	return ask(
		options.signal,
		() =>
			pb.send(`${ROUTE}/hosts`, {
				method: 'POST',
				body: { hosts },
				requestKey: null,
				signal: options.signal
			}),
		parseSecurity
	);
}

/** Whether failed sign-ins ask for attention; null for any failure (then no flag). */
export async function fetchSecurityNotice(pb: PocketBase): Promise<SecurityNotice | null> {
	try {
		return parseNotice(await pb.send(`${ROUTE}/notice`, { method: 'GET', requestKey: null }));
	} catch {
		return null;
	}
}
