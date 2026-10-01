// Page "Einstellungen → Sicherung" (ADR-0046; ADR-0006 sections 1 to 5): the routes of
// app/pb_hooks/backup.pb.js. Stateless functions with the PocketBase instance as first parameter.
// A refusal of the route (like the page System: Windows only, this machine, the address of the app,
// the owner, rate limit, not available, busy, script) and a missing route (404 before the restart
// after an update) come as `denied`; a refused input (400) as `invalid` with its problem; the
// session, the network and an aborted signal are DataErrors. The passphrase only goes in the body
// of one POST and is never kept here.

import type PocketBase from 'pocketbase';
import {
	parseOverview,
	parseRestoreState,
	parseRunResult,
	parseSafetyCopies,
	parseVerifyResult,
	type BackupOverview,
	type BackupSettings,
	type BackupSource,
	type CredentialMode,
	type RestoreState,
	type RunResult,
	type SafetyCopy,
	type VerifyResult
} from '../domain/backup';
import { denialOf, type SystemDenial } from '../domain/system';
import { toDataError } from './errors';
import type { RequestOptions } from './options';

const ROUTE = '/api/byl/backup';
// Statuses with which the route refuses, plus 404 without the route.
const DENIAL_STATUSES = [403, 404, 409, 429, 502, 503];

export type BackupAnswer<T> =
	| { kind: 'ok'; value: T }
	| { kind: 'denied'; reason: SystemDenial }
	| { kind: 'invalid'; problem: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function ask<T>(
	signal: AbortSignal | undefined,
	call: () => Promise<unknown>,
	parse: (answer: unknown) => T | null
): Promise<BackupAnswer<T>> {
	let answer: unknown;
	try {
		answer = await call();
	} catch (error) {
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		const response = isRecord(error) && isRecord(error.response) ? error.response : {};
		if (!signal?.aborted && status === 400 && response.reason === 'invalid') {
			return {
				kind: 'invalid',
				problem: typeof response.problem === 'string' ? response.problem : ''
			};
		}
		if (!signal?.aborted && DENIAL_STATUSES.includes(status)) {
			return { kind: 'denied', reason: denialOf(status, response.reason) };
		}
		throw toDataError(error, signal);
	}
	const value = parse(answer);
	return value === null ? { kind: 'denied', reason: 'script' } : { kind: 'ok', value };
}

/** Settings, passphrase, target, backups, last runs and warnings. */
export function fetchBackupOverview(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<BackupAnswer<BackupOverview>> {
	return ask(
		options.signal,
		() => pb.send(ROUTE, { method: 'GET', requestKey: null, signal: options.signal }),
		parseOverview
	);
}

/** "Jetzt sichern": a backup now and its copy into the target; the state afterwards. */
export function runBackupNow(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<BackupAnswer<{ overview: BackupOverview; result: RunResult }>> {
	return ask(
		options.signal,
		() => pb.send(`${ROUTE}/run`, { method: 'POST', requestKey: null, signal: options.signal }),
		(answer) => {
			const overview = parseOverview(answer);
			const result = parseRunResult(answer);
			return overview === null || result === null ? null : { overview, result };
		}
	);
}

/** Target folder ('' for none), generations and the switch of the access data. */
export function saveBackupSettings(
	pb: PocketBase,
	settings: Omit<BackupSettings, 'target'> & { target: string },
	options: RequestOptions = {}
): Promise<BackupAnswer<BackupOverview>> {
	return ask(
		options.signal,
		() =>
			pb.send(`${ROUTE}/settings`, {
				method: 'POST',
				body: settings,
				requestKey: null,
				signal: options.signal
			}),
		parseOverview
	);
}

/** The passphrase twice; the server keeps it with DPAPI, never in plain text. */
export function saveBackupPassphrase(
	pb: PocketBase,
	passphrase: string,
	confirmation: string,
	options: RequestOptions = {}
): Promise<BackupAnswer<BackupOverview>> {
	return ask(
		options.signal,
		() =>
			pb.send(`${ROUTE}/passphrase`, {
				method: 'POST',
				body: { passphrase, confirmation },
				requestKey: null,
				signal: options.signal
			}),
		parseOverview
	);
}

/**
 * "Prüfen": checks one backup with a throwaway server (ADR-0046 §6); the state afterwards. The
 * passphrase (only for a sealed backup whose stored one does not fit) goes in the body of this
 * POST only.
 */
export function verifyBackup(
	pb: PocketBase,
	backup: { source: BackupSource; name: string; passphrase?: string },
	options: RequestOptions = {}
): Promise<BackupAnswer<{ overview: BackupOverview; result: VerifyResult }>> {
	const body: Record<string, string> = { source: backup.source, name: backup.name };
	if (backup.passphrase !== undefined && backup.passphrase !== '')
		body.passphrase = backup.passphrase;
	return ask(
		options.signal,
		() =>
			pb.send(`${ROUTE}/verify`, {
				method: 'POST',
				body,
				requestKey: null,
				signal: options.signal
			}),
		(answer) => {
			const overview = parseOverview(answer);
			const result = parseVerifyResult(answer);
			return overview === null || result === null ? null : { overview, result };
		}
	);
}

/** The request of "Wiederherstellen" after its confirmation. */
export interface RestoreRequest {
	source: BackupSource;
	name: string;
	credentials: CredentialMode;
	confirm: string;
	passphrase?: string;
}

/**
 * "Wiederherstellen": starts the restore as a process of its own (ADR-0046 §7); answers with the
 * time of its state "started", from which the page follows it through the restart of the app. The
 * passphrase goes in the body of this POST only.
 */
export function startRestore(
	pb: PocketBase,
	request: RestoreRequest,
	options: RequestOptions = {}
): Promise<BackupAnswer<{ since: string }>> {
	return ask(
		options.signal,
		() =>
			pb.send(`${ROUTE}/restore`, {
				method: 'POST',
				body: request,
				requestKey: null,
				signal: options.signal
			}),
		(answer) =>
			isRecord(answer) && answer.restoring === true && typeof answer.since === 'string'
				? { since: answer.since }
				: null
	);
}

/** The last restore (running or ended) and the safety copies. */
export function fetchRestoreState(
	pb: PocketBase,
	options: RequestOptions = {}
): Promise<BackupAnswer<{ restore: RestoreState | null; safety: SafetyCopy[] }>> {
	return ask(
		options.signal,
		() => pb.send(`${ROUTE}/restore`, { method: 'GET', requestKey: null, signal: options.signal }),
		(answer) =>
			isRecord(answer)
				? { restore: parseRestoreState(answer.restore), safety: parseSafetyCopies(answer.safety) }
				: null
	);
}

/** Whether the backups need attention when the app opens (ADR-0035); false on any failure. */
export async function fetchBackupAttention(pb: PocketBase): Promise<boolean> {
	try {
		const answer: unknown = await pb.send(`${ROUTE}/notice`, { method: 'GET', requestKey: null });
		return isRecord(answer) && answer.attention === true;
	} catch {
		return false;
	}
}
