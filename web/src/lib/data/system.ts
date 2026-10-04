// Page "Einstellungen → System" (ADR-0043; ADR-0006 sections 1 to 5): the routes of
// app/pb_hooks/system.pb.js. Stateless functions with the PocketBase instance as first parameter.
// A refusal of the route (Windows only, this machine, the address of the app, the owner of the
// instance, rate limit, not available, busy, script) and a missing route (404 before the restart
// after an update) come as `denied` with their reason; the session, the network and an aborted
// signal are DataErrors. The browser sends Origin itself; nothing here names an address.

import type PocketBase from 'pocketbase';
import {
	denialOf,
	parseDoctor,
	parseLogs,
	parseOverview,
	type DoctorResult,
	type SystemAction,
	type SystemDenial,
	type SystemLogs,
	type SystemOverview
} from '../domain/system';
import { reportRefusal } from './context';
import { toDataError } from './errors';
import type { RequestOptions } from './options';

const ROUTE = '/api/byl/system';
// Statuses with which the route refuses (403, 404, 409, 429, 502, 503), plus 404 without the route.
const DENIAL_STATUSES = [403, 404, 409, 429, 502, 503];
// One health check waits this long at most; the restart asks again and again.
const HEALTH_TIMEOUT_MS = 2000;

export type SystemAnswer<T> = { kind: 'ok'; value: T } | { kind: 'denied'; reason: SystemDenial };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function ask<T>(
	signal: AbortSignal | undefined,
	call: () => Promise<unknown>,
	parse: (answer: unknown) => T | null
): Promise<SystemAnswer<T>> {
	let answer: unknown;
	try {
		answer = await call();
	} catch (error) {
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		if (!signal?.aborted && DENIAL_STATUSES.includes(status)) {
			const response = isRecord(error) && isRecord(error.response) ? error.response : {};
			reportRefusal(response.reason);
			return { kind: 'denied', reason: denialOf(status, response.reason) };
		}
		throw toDataError(error, signal);
	}
	const value = parse(answer);
	return value === null ? { kind: 'denied', reason: 'script' } : { kind: 'ok', value };
}

/** Status of the app: state, address, mail helper, start fingerprint, autostart, other copies. */
export function fetchSystemStatus(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<SystemAnswer<SystemOverview>> {
	return ask(
		options.signal,
		() => pb.send(ROUTE, { method: 'GET', requestKey: null, signal: options.signal }),
		parseOverview
	);
}

/** "Umgebung prüfen": the checks of doctor. */
export function fetchSystemDoctor(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<SystemAnswer<DoctorResult>> {
	return ask(
		options.signal,
		() => pb.send(`${ROUTE}/doctor`, { method: 'GET', requestKey: null, signal: options.signal }),
		parseDoctor
	);
}

/** "Logs ansehen": the last lines of the logs of server, mail helper and script, without secrets. */
export function fetchSystemLogs(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<SystemAnswer<SystemLogs>> {
	return ask(
		options.signal,
		() => pb.send(`${ROUTE}/logs`, { method: 'GET', requestKey: null, signal: options.signal }),
		parseLogs
	);
}

/**
 * An action of the page. "restart" answers 'restarting' as soon as the detached restart runs; the
 * others answer with the status afterwards.
 */
export function runSystemAction(
	pb: PocketBase,
	action: SystemAction,
	options: RequestOptions = {}
): Promise<SystemAnswer<SystemOverview | 'restarting'>> {
	return ask(
		options.signal,
		() =>
			pb.send(`${ROUTE}/actions/${encodeURIComponent(action)}`, {
				method: 'POST',
				requestKey: null,
				signal: options.signal
			}),
		(answer): SystemOverview | 'restarting' | null => {
			if (action !== 'restart') return parseOverview(answer);
			return isRecord(answer) && answer.restarting === true ? 'restarting' : null;
		}
	);
}

/** Whether the server answers /api/health now (false on any failure, also after two seconds). */
export async function checkServerHealth(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<boolean> {
	const limit = new AbortController();
	const abort = () => limit.abort();
	const timer = setTimeout(abort, HEALTH_TIMEOUT_MS);
	options.signal?.addEventListener('abort', abort, { once: true });
	try {
		await pb.health.check({ requestKey: null, signal: limit.signal });
		return true;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener('abort', abort);
	}
}
