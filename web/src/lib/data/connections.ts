// Connections of the channels (ADR-0016 section 2, ADR-0018, ADR-0020; E4 plan packages 10, 20 and 22;
// ADR-0006 sections 1 to 5). Stateless functions with the PocketBase instance as first parameter. The
// hook sets scope and refuses changes of server fields (app/pb_hooks/connections.pb.js).

import type PocketBase from 'pocketbase';
import {
	isConnectionType,
	isMailProvider,
	mailScanOf,
	type Connection,
	type ConnectionDraft,
	type ConnectionName,
	type ConnectionSettingsDraft,
	type MailHelperStatus,
	type RunResult,
	type ScanResult,
	type SecretStatus
} from '../domain/connections';
import {
	EMPTY_GITHUB_SETTINGS,
	githubSettingsOf,
	githubSettingsValue,
	type GitHubSettings
} from '../domain/github';
import { keywordListOf } from '../domain/keywords';
import {
	MAILBOX_IMPORT_BATCH,
	type MailboxImportResult,
	type MailboxMail,
	type MailboxOutcome
} from '../domain/mailbox';
import { DATA_ERROR_MESSAGES, DataError, toDataError, withDataErrors } from './errors';
import { currentUserId, type RequestOptions } from './options';
import type { RecordChange, Unsubscribe } from './realtime';

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
	'scan',
	// Target project of the new entries (ADR-0049); missing before the migration 1790203100.
	'target_project',
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
	/** State of the full scan of a mailbox; missing before the migration 1790201700. */
	scan?: unknown;
	/** Target project (ADR-0049); missing before the migration 1790203100. */
	target_project?: string;
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

function mailSettingsOf(
	settings: unknown
): Pick<Connection, 'mailProvider' | 'mailUser' | 'matchBody'> {
	const value = settingsRecord(settings);
	return {
		mailProvider: isMailProvider(value.provider) ? value.provider : '',
		mailUser: typeof value.user === 'string' ? value.user : '',
		matchBody: value.match_body === true
	};
}

export function toConnection(record: ConnectionRecord): Connection {
	if (!isConnectionType(record.type))
		throw new RangeError(`Unknown connection type: ${record.type}`);
	const mail =
		record.type === 'mail'
			? mailSettingsOf(record.settings)
			: { mailProvider: '' as const, mailUser: '', matchBody: false };
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
		replySaved: settingsRecord(record.settings).reply_saved !== false,
		replyNoMatch: settingsRecord(record.settings).reply_no_match !== false,
		...mail,
		scan: record.type === 'mail' ? mailScanOf(record.scan) : null,
		github: record.type === 'github' ? githubSettingsOf(record.settings) : null,
		runningSince: record.running_since || null,
		targetProjectId: record.target_project || null,
		targetReady: record.target_project !== undefined,
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

/**
 * The settings of a new connection. A mailbox searches headers and the whole text from the start
 * (match_body on by default, user decision of 2026-09-27). GitHub starts with the default interval
 * and the first repository of the assistant, if any (ADR-0050 §2).
 */
function settingsOf(
	draft: Pick<ConnectionDraft, 'type' | 'allowlistEnv' | 'mailProvider' | 'mailUser' | 'githubRepo'>
): Record<string, unknown> {
	if (draft.type === 'telegram') return { allowed_env: draft.allowlistEnv.trim() };
	if (draft.type === 'mail') {
		return { provider: draft.mailProvider, user: draft.mailUser.trim(), match_body: true };
	}
	if (draft.type === 'github') {
		const repo = draft.githubRepo ?? null;
		return githubSettingsValue({
			...EMPTY_GITHUB_SETTINGS,
			repos: repo === null ? [] : [repo]
		});
	}
	return {};
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

/** The whole `settings` of a connection with new keywords and switches. */
function settingsValue(
	connection: Pick<Connection, 'type' | 'allowlistEnv' | 'mailProvider' | 'mailUser' | 'github'>,
	settings: ConnectionSettingsDraft
): Record<string, unknown> {
	const keywords = settings.keywords.map((keyword) => keyword.trim());
	switch (connection.type) {
		case 'telegram':
			// The confirmation is stored only while switched off; without the key it is on (ADR-0016,
			// addendum of 2026-10-01). So saving keywords also works against the hooks of before the
			// switch, which do not know the key, until the next restart of the app.
			return {
				allowed_env: connection.allowlistEnv,
				keywords,
				...(settings.replySaved === false ? { reply_saved: false } : {}),
				reply_no_match: settings.replyNoMatch
			};
		case 'mail':
			return {
				provider: connection.mailProvider,
				user: connection.mailUser,
				keywords,
				match_body: settings.matchBody
			};
		case 'calendar':
			return { keywords };
		case 'notion':
			// No keywords: the user chooses what to import (ADR-0041); the hook refuses any key.
			return {};
		case 'github':
			// No keywords either (ADR-0050): the repositories go along unchanged.
			return githubSettingsValue(connection.github ?? EMPTY_GITHUB_SETTINGS);
	}
}

/**
 * Saves keywords and, for Telegram, the two answers of the bot, for mail whether the whole text
 * is searched. `settings` is written whole, so the name of the allowlist variable and the mailbox
 * go along unchanged.
 */
export function saveConnectionSettings(
	pb: PocketBase,
	connection: Pick<
		Connection,
		'id' | 'type' | 'allowlistEnv' | 'mailProvider' | 'mailUser' | 'github'
	>,
	settings: ConnectionSettingsDraft,
	{ signal }: RequestOptions = {}
): Promise<Connection> {
	return withDataErrors(signal, async () => {
		const value = settingsValue(connection, settings);
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

/**
 * Saves the interval and the repositories of a GitHub connection (ADR-0050 §2), `settings` whole.
 * The hook checks names, patterns, events and the target project of each repository
 * (`validation_github_*`, `validation_target_project_*`).
 */
export function saveGitHubSettings(
	pb: PocketBase,
	id: string,
	settings: GitHubSettings,
	{ signal }: RequestOptions = {}
): Promise<Connection> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection(CONNECTIONS)
			.update<ConnectionRecord>(
				id,
				{ settings: githubSettingsValue(settings) },
				{ fields: CONNECTION_FIELDS, signal }
			);
		return toConnection(record);
	});
}

/**
 * Renames a connection (ADR-0026, addendum KK-3). Sends only the name: the hook refuses a request
 * that changes anything else with it and stores the name without white space at its ends.
 */
export function renameConnection(
	pb: PocketBase,
	id: string,
	label: string,
	{ signal }: RequestOptions = {}
): Promise<Connection> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection(CONNECTIONS)
			.update<ConnectionRecord>(id, { label: label.trim() }, { fields: CONNECTION_FIELDS, signal });
		return toConnection(record);
	});
}

/**
 * Sets the target project of a connection (ADR-0049): its new entries get it, the entries of
 * before keep theirs. Sends only the field; the hook accepts only an active project of the area of
 * the connection (`validation_target_project_*`). `projectId` null takes it away.
 */
export function setConnectionTarget(
	pb: PocketBase,
	id: string,
	projectId: string | null,
	{ signal }: RequestOptions = {}
): Promise<Connection> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection(CONNECTIONS)
			.update<ConnectionRecord>(
				id,
				{ target_project: projectId ?? '' },
				{ fields: CONNECTION_FIELDS, signal }
			);
		return toConnection(record);
	});
}

/** Only ID and name: what the inbox and the sources of a ticket need of a connection (KK-3). */
const NAME_FIELDS = 'id,label';

interface ConnectionNameRecord {
	id: string;
	label: string;
}

function toConnectionName(record: ConnectionNameRecord): ConnectionName {
	return { id: record.id, label: typeof record.label === 'string' ? record.label : '' };
}

/** The names of every visible connection, oldest first. */
export function listConnectionNames(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<ConnectionName[]> {
	return withDataErrors(signal, async () => {
		const records = await pb
			.collection(CONNECTIONS)
			.getFullList<ConnectionNameRecord>({ fields: NAME_FIELDS, sort: 'created,id', signal });
		return records.map(toConnectionName);
	});
}

/** Realtime: the names of every visible connection as they are created, renamed and deleted. */
export function subscribeConnectionNames(
	pb: PocketBase,
	onChange: (change: RecordChange<ConnectionName>) => void
): Promise<Unsubscribe> {
	return pb.collection(CONNECTIONS).subscribe<ConnectionNameRecord>(
		'*',
		(event) => {
			if (event.action === 'delete') {
				onChange({ action: 'delete', id: event.record.id });
				return;
			}
			if (event.action !== 'create' && event.action !== 'update') return;
			onChange({ action: event.action, record: toConnectionName(event.record) });
		},
		{ fields: NAME_FIELDS }
	);
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

const RUN_STATUSES = [
	'ok',
	'error',
	'running',
	'missing',
	'disabled',
	'unsupported',
	'unavailable',
	'limited'
] as const;

const HELPER_STATES = ['running', 'stopped', 'refused', 'outdated'] as const;

/**
 * Whether the mail helper runs (package A, item 4): the hook asks it on 127.0.0.1 without logging
 * in to a mailbox. An unknown answer counts as "stopped".
 */
export function getMailHelperStatus(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<MailHelperStatus> {
	return withDataErrors(signal, async () => {
		const result = await pb.send<Record<string, unknown>>('/api/byl/mail-helper', {
			method: 'GET',
			signal
		});
		return {
			state: HELPER_STATES.find((value) => value === result.state) ?? 'stopped',
			version: typeof result.version === 'string' ? result.version : '',
			message: typeof result.message === 'string' ? result.message : ''
		};
	});
}

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
				: [],
			...(status === 'limited' && typeof result.hint === 'string' ? { hint: result.hint } : {})
		};
	});
}

const SCAN_STATUSES = [
	'started',
	'running',
	'cancelling',
	'cancelled',
	'idle',
	'unavailable',
	'disabled',
	'error'
] as const;

/**
 * "Posteingang neu durchsuchen" ("start") and "Abbrechen" ("cancel") of a mailbox (ADR-0020,
 * addendum 3). The hook passes the request to the mail helper, which scans in the background;
 * the progress arrives with the connection (realtime). An unknown answer counts as an error.
 */
export function scanConnection(
	pb: PocketBase,
	id: string,
	action: 'start' | 'cancel',
	{ signal }: RequestOptions = {}
): Promise<ScanResult> {
	return withDataErrors(signal, async () => {
		const result = await pb.send<Record<string, unknown>>(
			`/api/byl/connections/${encodeURIComponent(id)}/scan`,
			{ method: 'POST', body: { action }, signal }
		);
		return {
			status: SCAN_STATUSES.find((value) => value === result.status) ?? 'error',
			message: typeof result.message === 'string' ? result.message : ''
		};
	});
}

/**
 * Realtime subscription on exactly one connection (plan EH-5 §3.8): the assistant waits for the
 * first run without polling. The topic `connections/<id>` is checked by the server against the
 * viewRule of the collection (the same owner and household rule as list), for every event again;
 * other users get nothing. The runs of the server (cron, ingest route) save the record through
 * the app, so their changes are broadcast. Events that cannot be mapped are dropped.
 */
export function subscribeConnection(
	pb: PocketBase,
	id: string,
	onChange: (change: RecordChange<Connection>) => void
): Promise<Unsubscribe> {
	return pb.collection(CONNECTIONS).subscribe<ConnectionRecord>(
		id,
		(event) => {
			if (event.action === 'delete') {
				onChange({ action: 'delete', id: event.record.id });
				return;
			}
			if (event.action !== 'create' && event.action !== 'update') return;
			let connection: Connection;
			try {
				connection = toConnection(event.record);
			} catch {
				return;
			}
			onChange({ action: event.action, record: connection });
		},
		{ fields: CONNECTION_FIELDS }
	);
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

function textOf(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Runs a call of the mailbox routes: 503 (mail helper not running) and 400/502 (refused by the
 * route, the helper or the mailbox) become an outcome with the message and hint of the server;
 * every other failure is a DataError.
 */
async function mailboxCall<T>(
	signal: AbortSignal | undefined,
	call: () => Promise<T>
): Promise<MailboxOutcome<T>> {
	try {
		return { kind: 'ok', value: await call() };
	} catch (error) {
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		const response = isRecord(error) && isRecord(error.response) ? error.response : {};
		if (!signal?.aborted && [400, 502, 503].includes(status)) {
			return {
				kind: status === 503 ? 'unavailable' : 'failed',
				message: textOf(response.message) || DATA_ERROR_MESSAGES.server,
				hint: textOf(response.hint)
			};
		}
		throw toDataError(error, signal);
	}
}

const INBOX_STATES_OF_MAILBOX = ['new', 'converted', 'discarded'] as const;

function toMailboxMail(raw: Record<string, unknown>): MailboxMail {
	const state = INBOX_STATES_OF_MAILBOX.find((value) => value === raw.state) ?? '';
	return {
		uid: count(raw.uid),
		size: count(raw.size),
		subject: textOf(raw.subject),
		from: textOf(raw.from),
		date: textOf(raw.date) || null,
		keyword: textOf(raw.keyword),
		state,
		stateMessage: textOf(raw.message)
	};
}

/** The last `limit` mails of the inbox of a mail connection, from the mail helper through the hook. */
export function listMailbox(
	pb: PocketBase,
	id: string,
	limit: number,
	{ signal }: RequestOptions = {}
): Promise<MailboxOutcome<MailboxMail[]>> {
	return mailboxCall(signal, async () => {
		const result = await pb.send<Record<string, unknown>>(
			`/api/byl/connections/${encodeURIComponent(id)}/mailbox`,
			{ method: 'GET', query: { limit }, signal }
		);
		const items = Array.isArray(result.items) ? result.items : [];
		return items
			.filter(isRecord)
			.map(toMailboxMail)
			.filter((mail) => mail.uid > 0);
	});
}

const IMPORT_STATUSES = ['created', 'duplicate', 'failed'] as const;

/**
 * Takes the chosen mails into the inbox, in batches of MAILBOX_IMPORT_BATCH; a refusal stops at the
 * batch it happened in, the results so far are lost only for that batch.
 */
export function importFromMailbox(
	pb: PocketBase,
	id: string,
	uids: readonly number[],
	{ signal }: RequestOptions = {}
): Promise<MailboxOutcome<MailboxImportResult[]>> {
	return mailboxCall(signal, async () => {
		const results: MailboxImportResult[] = [];
		for (let start = 0; start < uids.length; start += MAILBOX_IMPORT_BATCH) {
			const batch = uids.slice(start, start + MAILBOX_IMPORT_BATCH);
			const result = await pb.send<Record<string, unknown>>(
				`/api/byl/connections/${encodeURIComponent(id)}/mailbox/import`,
				{ method: 'POST', body: { uids: batch }, signal }
			);
			const items = Array.isArray(result.items) ? result.items.filter(isRecord) : [];
			for (const item of items) {
				results.push({
					uid: count(item.uid),
					status: IMPORT_STATUSES.find((value) => value === item.status) ?? 'failed',
					message: textOf(item.message)
				});
			}
		}
		return results;
	});
}
