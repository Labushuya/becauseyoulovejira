// Connections of the channels (ADR-0016 section 2, ADR-0018, ADR-0020; E4 plan packages 10 and 20;
// ADR-0006 sections 1 to 5). Stateless functions with the PocketBase instance as first parameter. The
// hook sets scope and refuses changes of server fields (app/pb_hooks/connections.pb.js).

import type PocketBase from 'pocketbase';
import {
	isConnectionType,
	type Connection,
	type ConnectionDraft,
	type ConnectionSettingsDraft,
	type RunResult,
	type SecretStatus
} from '../domain/connections';
import { keywordListOf } from '../domain/keywords';
import { DataError, withDataErrors } from './errors';
import { currentUserId, type RequestOptions } from './options';

const CONNECTIONS = 'connections';

export const CONNECTION_FIELDS = [
	'id',
	'type',
	'label',
	'enabled',
	'secret_env',
	'settings',
	'last_run_at',
	'last_ok_at',
	'last_error',
	'last_hint',
	'running_since',
	'created',
	'updated'
].join(',');

export interface ConnectionRecord {
	id: string;
	type: string;
	label: string;
	enabled: boolean;
	secret_env: string;
	settings: unknown;
	last_run_at: string;
	last_ok_at: string;
	last_error: string;
	last_hint: string;
	running_since: string;
	created: string;
	updated: string;
}

function settingsRecord(settings: unknown): Record<string, unknown> {
	return typeof settings === 'object' && settings !== null && !Array.isArray(settings)
		? (settings as Record<string, unknown>)
		: {};
}

function allowlistOf(settings: unknown): string {
	const value = settingsRecord(settings).allowed_env;
	return typeof value === 'string' ? value : '';
}

export function toConnection(record: ConnectionRecord): Connection {
	if (!isConnectionType(record.type))
		throw new RangeError(`Unknown connection type: ${record.type}`);
	return {
		id: record.id,
		type: record.type,
		label: record.label,
		enabled: record.enabled === true,
		secretEnv: record.secret_env,
		allowlistEnv: record.type === 'telegram' ? allowlistOf(record.settings) : '',
		lastRunAt: record.last_run_at || null,
		lastOkAt: record.last_ok_at || null,
		lastError: record.last_error ?? '',
		lastHint: record.last_hint ?? '',
		keywords: keywordListOf(settingsRecord(record.settings).keywords),
		replyNoMatch: settingsRecord(record.settings).reply_no_match !== false,
		runningSince: record.running_since || null,
		created: record.created,
		updated: record.updated
	};
}

/** Own connections of the kinds this version knows, oldest first. */
export function listConnections(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<Connection[]> {
	return withDataErrors(signal, async () => {
		const records = await pb.collection(CONNECTIONS).getFullList<ConnectionRecord>({
			sort: 'created,id',
			fields: CONNECTION_FIELDS,
			signal
		});
		return records.filter((record) => isConnectionType(record.type)).map(toConnection);
	});
}

function settingsOf(draft: Pick<ConnectionDraft, 'type' | 'allowlistEnv'>): Record<string, string> {
	return draft.type === 'telegram' ? { allowed_env: draft.allowlistEnv.trim() } : {};
}

/** Creates a switched-on private connection of the signed-in user. */
export function createConnection(
	pb: PocketBase,
	draft: ConnectionDraft,
	{ signal }: RequestOptions = {}
): Promise<Connection> {
	return withDataErrors(signal, async () => {
		const owner = currentUserId(pb.authStore.record);
		if (owner === null) throw new DataError('session');
		const record = await pb.collection(CONNECTIONS).create<ConnectionRecord>(
			{
				owner,
				type: draft.type,
				label: draft.label.trim(),
				enabled: true,
				secret_env: draft.secretEnv.trim(),
				settings: settingsOf(draft)
			},
			{ fields: CONNECTION_FIELDS, signal }
		);
		return toConnection(record);
	});
}

/**
 * Saves keywords and, for Telegram, the answer without keyword. `settings` is written whole, so
 * the name of the allowlist variable goes along unchanged.
 */
export function saveConnectionSettings(
	pb: PocketBase,
	connection: Pick<Connection, 'id' | 'type' | 'allowlistEnv'>,
	settings: ConnectionSettingsDraft,
	{ signal }: RequestOptions = {}
): Promise<Connection> {
	return withDataErrors(signal, async () => {
		const keywords = settings.keywords.map((keyword) => keyword.trim());
		const value =
			connection.type === 'telegram'
				? { allowed_env: connection.allowlistEnv, keywords, reply_no_match: settings.replyNoMatch }
				: { keywords };
		const record = await pb
			.collection(CONNECTIONS)
			.update<ConnectionRecord>(
				connection.id,
				{ settings: value },
				{ fields: CONNECTION_FIELDS, signal }
			);
		return toConnection(record);
	});
}

/** Switches a connection on or off. */
export function setConnectionEnabled(
	pb: PocketBase,
	id: string,
	enabled: boolean,
	{ signal }: RequestOptions = {}
): Promise<Connection> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection(CONNECTIONS)
			.update<ConnectionRecord>(id, { enabled }, { fields: CONNECTION_FIELDS, signal });
		return toConnection(record);
	});
}

/** Deletes a connection; its inbox entries stay (without the reference). */
export function deleteConnection(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<void> {
	return withDataErrors(signal, async () => {
		await pb.collection(CONNECTIONS).delete(id, { signal });
	});
}

/** Whether the variables of a connection are set in the server, yes or no only. */
export function getSecretStatus(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<SecretStatus> {
	return withDataErrors(signal, async () => {
		const result = await pb.send<Record<string, unknown>>(
			`/api/byl/connections/${encodeURIComponent(id)}/secret-status`,
			{ method: 'GET', signal }
		);
		return {
			secret: result.secret === true,
			allowlist: typeof result.allowlist === 'boolean' ? result.allowlist : null
		};
	});
}

const RUN_STATUSES = ['ok', 'error', 'running', 'missing', 'disabled', 'unsupported'] as const;

function count(value: unknown): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** "Jetzt abrufen": runs the connection once in the server and answers with its result. */
export function runConnection(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<RunResult> {
	return withDataErrors(signal, async () => {
		const result = await pb.send<Record<string, unknown>>(
			`/api/byl/connections/${encodeURIComponent(id)}/run`,
			{ method: 'POST', signal }
		);
		const status = RUN_STATUSES.find((value) => value === result.status) ?? 'error';
		return {
			status,
			created: count(result.created),
			duplicates: count(result.duplicates),
			updated: count(result.updated),
			skipped: count(result.skipped),
			failed: count(result.failed),
			unmatched: count(result.unmatched),
			error: typeof result.error === 'string' ? result.error : '',
			missing: Array.isArray(result.missing)
				? result.missing.filter((name): name is string => typeof name === 'string')
				: []
		};
	});
}

/** One connection with the fields of the list (after a run). */
export function getConnection(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<Connection> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection(CONNECTIONS)
			.getOne<ConnectionRecord>(id, { fields: CONNECTION_FIELDS, signal });
		return toConnection(record);
	});
}
