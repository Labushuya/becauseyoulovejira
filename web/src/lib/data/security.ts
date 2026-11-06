// Page "Einstellungen → Sicherheit" (ADR-0055 §8; ADR-0006 sections 1 to 5): the routes of
// app/pb_hooks/security.pb.js. A refusal of the route (this machine, the address of the app, the
// administrator of the app, rate limit, no own instance for the hosts) and a missing route (404 before
// the restart after an update) come as `denied` with their reason, a 400 with `reason: 'invalid'` as
// `invalid` with its problem; the session, the network, an aborted signal and every other error
// answer (also a 400 without `reason: 'invalid'`, e.g. a failure of the hook, FP-3b) are DataErrors.
// A refusal and an answer of another form keep the entry behind "Details" beside the answer
// (`denialProblem`, FP-3b). The browser sends Origin itself; nothing here names an address.

import type PocketBase from 'pocketbase';
import {
	parseFirewallAnswer,
	parseLanInfo,
	type FirewallAction,
	type FirewallResult,
	type LanInfo
} from '../domain/lan';
import {
	parseNotice,
	parseSecurity,
	type LevelChoice,
	type SecurityNotice,
	type SecurityOverview
} from '../domain/security';
import { denialOf, type SystemDenial } from '../domain/system';
import { reportRefusal } from './context';
import { keepAnswerProblem, problemOf, toDataError, unreadableProblem } from './errors';
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
	pb: PocketBase,
	method: 'GET' | 'POST',
	path: string,
	options: { body?: unknown; signal?: AbortSignal },
	parse: (answer: unknown) => T | null
): Promise<SecurityAnswer<T>> {
	const signal = options.signal;
	let answer: unknown;
	try {
		answer = await pb.send(path, {
			method,
			...(options.body !== undefined && { body: options.body }),
			requestKey: null,
			signal
		});
	} catch (error) {
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		const response = isRecord(error) && isRecord(error.response) ? error.response : {};
		if (!signal?.aborted && status === 400 && response.reason === 'invalid') {
			const invalid = Array.isArray(response.invalid)
				? response.invalid.filter((entry): entry is string => typeof entry === 'string')
				: [];
			const problem = typeof response.problem === 'string' ? response.problem : 'empty';
			return { kind: 'invalid', problem, invalid };
		}
		if (!signal?.aborted && DENIAL_STATUSES.includes(status)) {
			reportRefusal(response.reason);
			return keepAnswerProblem<SecurityAnswer<T>>(
				{ kind: 'denied', reason: denialOf(status, response.reason) },
				problemOf(error)
			);
		}
		throw toDataError(error, signal);
	}
	const value = parse(answer);
	if (value !== null) return { kind: 'ok', value };
	return keepAnswerProblem<SecurityAnswer<T>>(
		{ kind: 'denied', reason: 'script' },
		unreadableProblem(method, path)
	);
}

/** Everything the page shows. */
export function fetchSecurity(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<SecurityAnswer<SecurityOverview>> {
	return ask(pb, 'GET', ROUTE, { signal: options.signal }, parseSecurity);
}

/** Level of the protection and/or the validity of a sign-in; answers the new overview. */
export function saveSecuritySettings(
	pb: PocketBase,
	settings: { level?: LevelChoice; days?: number },
	options: RequestOptions = {}
): Promise<SecurityAnswer<SecurityOverview>> {
	return ask(
		pb,
		'POST',
		`${ROUTE}/settings`,
		{ body: settings, signal: options.signal },
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
		pb,
		'POST',
		`${ROUTE}/hosts`,
		{ body: { hosts }, signal: options.signal },
		parseSecurity
	);
}

/** The access in the home network (plan heimnetz): setting, addresses, network and firewall rule. */
export function fetchSecurityLan(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<SecurityAnswer<LanInfo>> {
	return ask(pb, 'GET', `${ROUTE}/lan`, { signal: options.signal }, parseLanInfo);
}

/** Switches the access in the home network on or off with its addresses; applies after a restart. */
export function saveSecurityLan(
	pb: PocketBase,
	setting: { enabled: boolean; addresses: readonly string[] },
	options: RequestOptions = {}
): Promise<SecurityAnswer<LanInfo>> {
	return ask(
		pb,
		'POST',
		`${ROUTE}/lan`,
		{
			body: { enabled: setting.enabled, addresses: setting.addresses },
			signal: options.signal
		},
		parseLanInfo
	);
}

/**
 * Creates or removes the firewall rule of the home network. Windows asks for administrator rights
 * on the machine of the app first; the request waits for that answer.
 */
export function changeSecurityFirewall(
	pb: PocketBase,
	action: FirewallAction,
	options: RequestOptions = {}
): Promise<SecurityAnswer<{ result: FirewallResult; lan: LanInfo | null }>> {
	return ask(
		pb,
		'POST',
		`${ROUTE}/lan/firewall`,
		{ body: { action }, signal: options.signal },
		parseFirewallAnswer
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
