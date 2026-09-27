// Connections on the page "Kanäle" (E4 plan, packages 10, 15, 20 and 23; ADR-0006). Loaded when the page opens and
// after every own action; the state of the variables comes from the server per connection. The
// list has no realtime subscription (the page offers "Aktualisieren" for the result of a
// background run); only the setup assistant watches its one connection while it is open
// (`watch`, plan EH-5 §3.8), so the first run shows without polling. With a mailbox in the list the
// store also asks whether the mail helper runs (package A, item 4), so the card says it honestly.

import type PocketBase from 'pocketbase';
import { SvelteMap } from 'svelte/reactivity';
import {
	createConnection,
	deleteConnection,
	getConnection,
	getMailHelperStatus,
	getSecretStatus,
	importFromMailbox,
	listConnections,
	listMailbox,
	runConnection,
	saveConnectionSettings,
	setConnectionEnabled,
	subscribeConnection
} from '$lib/data/connections';
import type { RecordChange, Unsubscribe } from '$lib/data/realtime';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	runResultText,
	type Connection,
	type ConnectionDraft,
	type ConnectionSettingsDraft,
	type MailHelperStatus,
	type RunResult,
	type SecretStatus
} from '$lib/domain/connections';
import {
	importSummary,
	type MailboxImportResult,
	type MailboxMail,
	type MailboxOutcome
} from '$lib/domain/mailbox';
import { SILENT_FLAGS, type FlagSink, type FlagTone } from './flags.svelte';
import type { LoadState, SessionGuard } from './ticket-list.svelte';
import { restartNeeded } from '$lib/guidance/texts';

/** Shown while the server does not know the connections yet (migration after a restart). */
export const CONNECTIONS_UNAVAILABLE_MESSAGE = restartNeeded('Die Verbindungen sind');

export interface ConnectionsData {
	list(options: RequestOptions): Promise<Connection[]>;
	create(draft: ConnectionDraft): Promise<Connection>;
	setEnabled(id: string, enabled: boolean): Promise<Connection>;
	saveSettings(connection: Connection, settings: ConnectionSettingsDraft): Promise<Connection>;
	remove(id: string): Promise<void>;
	secretStatus(id: string, options: RequestOptions): Promise<SecretStatus>;
	run(id: string): Promise<RunResult>;
	get(id: string): Promise<Connection>;
	listMailbox(
		id: string,
		limit: number,
		options: RequestOptions
	): Promise<MailboxOutcome<MailboxMail[]>>;
	importMailbox(
		id: string,
		uids: readonly number[]
	): Promise<MailboxOutcome<MailboxImportResult[]>>;
	/** Realtime subscription on one connection (setup assistant). */
	subscribe(id: string, onChange: (change: RecordChange<Connection>) => void): Promise<Unsubscribe>;
	/** Whether the mail helper runs (no mailbox login). */
	helperStatus(options: RequestOptions): Promise<MailHelperStatus>;
}

export function connectionsData(pb: PocketBase): ConnectionsData {
	return {
		list: (options) => listConnections(pb, options),
		create: (draft) => createConnection(pb, draft),
		setEnabled: (id, enabled) => setConnectionEnabled(pb, id, enabled),
		saveSettings: (connection, settings) => saveConnectionSettings(pb, connection, settings),
		remove: (id) => deleteConnection(pb, id),
		secretStatus: (id, options) => getSecretStatus(pb, id, options),
		run: (id) => runConnection(pb, id),
		get: (id) => getConnection(pb, id),
		listMailbox: (id, limit, options) => listMailbox(pb, id, limit, options),
		importMailbox: (id, uids) => importFromMailbox(pb, id, uids),
		subscribe: (id, onChange) => subscribeConnection(pb, id, onChange),
		helperStatus: (options) => getMailHelperStatus(pb, options)
	};
}

/**
 * Tone of the flag after "Jetzt abrufen": a failed run is an error, a hint is neutral (also a mail
 * helper that does not run, CLAUDE.md §7).
 */
export function runResultTone(result: RunResult): FlagTone {
	if (result.status === 'ok') return 'success';
	return result.status === 'error' ? 'error' : 'info';
}

export type ConnectionActionResult =
	{ ok: true } | { ok: false; message: string | null; fields: Readonly<Record<string, string>> };

/** Result of "Verbindung anlegen"; the assistant takes the new ID into its address. */
export type ConnectionCreateResult =
	| { ok: true; connection: Connection }
	| { ok: false; message: string | null; fields: Readonly<Record<string, string>> };

export class ConnectionsStore {
	readonly #data: ConnectionsData;
	readonly #session: SessionGuard;
	readonly #items = new SvelteMap<string, Connection>();
	readonly #status = new SvelteMap<string, SecretStatus>();
	/** IDs with a running "Jetzt abrufen". */
	readonly #running = new SvelteMap<string, true>();
	/** Answer of the last "Jetzt abrufen" per connection in this page (the assistant shows it). */
	readonly #lastRun = new SvelteMap<string, RunResult>();
	#controller: AbortController | null = null;
	/** Probe of the mail helper; null while unknown or without a mailbox. */
	#helper = $state<MailHelperStatus | null>(null);

	#state = $state<LoadState>('idle');
	#error = $state<string | null>(null);

	#list = $derived(
		[...this.#items.values()].sort((a, b) =>
			a.created === b.created ? (a.id < b.id ? -1 : 1) : a.created < b.created ? -1 : 1
		)
	);

	readonly #flags: FlagSink;

	constructor(data: ConnectionsData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#flags = flags;
		this.#session = session;
	}

	get connections(): readonly Connection[] {
		return this.#list;
	}

	get state(): LoadState {
		return this.#state;
	}

	get error(): string | null {
		return this.#error;
	}

	status(id: string): SecretStatus | null {
		return this.#status.get(id) ?? null;
	}

	/** Loads the list and the state of the variables; a second call replaces a running one. */
	async load(): Promise<void> {
		this.#controller?.abort();
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		const options = { signal: controller.signal };
		if (this.#state !== 'ready') this.#state = 'loading';
		try {
			const items = await this.#data.list(options);
			this.#items.clear();
			for (const item of items) this.#items.set(item.id, item);
			this.#state = 'ready';
			this.#error = null;
			const probe = items.some((item) => item.type === 'mail')
				? this.#loadHelper(options)
				: Promise.resolve();
			await Promise.all([...items.map((item) => this.#loadStatus(item.id, options)), probe]);
		} catch (error) {
			const failure = toDataError(error, controller.signal);
			if (failure.kind === 'aborted') return;
			if (failure.kind === 'session') {
				this.#session.logout();
				return;
			}
			this.#state = 'error';
			this.#error =
				failure.kind === 'not_found' ? CONNECTIONS_UNAVAILABLE_MESSAGE : failure.message;
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	/** Whether the mail helper runs; null while unknown (the card says "wird geprüft …"). */
	get helper(): MailHelperStatus | null {
		return this.#helper;
	}

	async #loadHelper(options: RequestOptions): Promise<void> {
		try {
			this.#helper = await this.#data.helperStatus(options);
		} catch {
			// Unknown: the card keeps "wird geprüft …" instead of claiming a state.
			this.#helper = null;
		}
	}

	async #loadStatus(id: string, options: RequestOptions): Promise<void> {
		try {
			this.#status.set(id, await this.#data.secretStatus(id, options));
		} catch {
			// Unknown state: the page shows nothing about the variables for this connection.
			this.#status.delete(id);
		}
	}

	async create(draft: ConnectionDraft): Promise<ConnectionCreateResult> {
		let created: Connection | null = null;
		const result = await this.#act(async () => {
			const connection = await this.#data.create(draft);
			created = connection;
			this.#items.set(connection.id, connection);
			this.#notify(`Verbindung „${connection.label}“ angelegt.`);
			await this.#loadStatus(connection.id, {});
		});
		if (!result.ok) return result;
		return created === null
			? { ok: false, message: null, fields: {} }
			: { ok: true, connection: created };
	}

	/** Asks the server again whether it sees the variables ("Erneut prüfen" in the assistant). */
	async checkStatus(id: string): Promise<void> {
		if (!this.#session.ensureValid()) return;
		await this.#loadStatus(id, {});
	}

	/**
	 * Watches one connection through realtime while the assistant is open: changes of the server
	 * (last run, error, hint) replace it in the list, a deletion removes it. The returned function
	 * ends the subscription, also if it is still being set up.
	 */
	watch(id: string): () => void {
		let stopped = false;
		let unsubscribe: Unsubscribe | null = null;
		const end = (stop: Unsubscribe) => void stop().catch(() => undefined);
		this.#data
			.subscribe(id, (change) => {
				if (stopped) return;
				if (change.action === 'delete') {
					this.#items.delete(change.id);
					this.#status.delete(change.id);
					return;
				}
				const known = this.#items.get(change.record.id);
				if (known !== undefined && known.updated > change.record.updated) return;
				this.#items.set(change.record.id, change.record);
			})
			.then((stop) => {
				if (stopped) end(stop);
				else unsubscribe = stop;
			})
			.catch(() => undefined);
		return () => {
			stopped = true;
			if (unsubscribe !== null) end(unsubscribe);
			unsubscribe = null;
		};
	}

	/**
	 * "Hilfsprozess prüfen" of the assistant (plan EH-7 §3.8): asks the mail helper for one mail of
	 * the mailbox. Only on a click, because the helper logs in to the mailbox for it. "unavailable"
	 * means byl-mail.exe does not run; null when the session ended.
	 */
	async probeHelper(id: string): Promise<MailboxOutcome<null> | null> {
		const outcome = await this.listMailbox(id, 1);
		if (outcome === null) return null;
		return outcome.kind === 'ok' ? { kind: 'ok', value: null } : outcome;
	}

	/** Reads one connection again ("Erneut prüfen" while waiting for the first run). */
	async refresh(id: string): Promise<ConnectionActionResult> {
		return this.#act(async () => {
			this.#items.set(id, await this.#data.get(id));
		});
	}

	/** Answer of the last "Jetzt abrufen" of a connection on this page, or null. */
	lastRun(id: string): RunResult | null {
		return this.#lastRun.get(id) ?? null;
	}

	async setEnabled(id: string, enabled: boolean): Promise<ConnectionActionResult> {
		return this.#act(async () => {
			const updated = await this.#data.setEnabled(id, enabled);
			this.#items.set(id, updated);
			this.#notify(`„${updated.label}“ ${enabled ? 'läuft wieder' : 'ist pausiert'}.`);
		});
	}

	/**
	 * Saves keywords and the answer without keyword (ADR-0020). `announcement` is the text of the
	 * flag, e.g. „Stichwort „todo“ hinzugefügt.“
	 */
	async saveSettings(
		id: string,
		settings: ConnectionSettingsDraft,
		announcement: string
	): Promise<ConnectionActionResult> {
		const current = this.#items.get(id);
		if (current === undefined) return { ok: false, message: null, fields: {} };
		return this.#act(async () => {
			const updated = await this.#data.saveSettings(current, settings);
			this.#items.set(id, updated);
			this.#notify(announcement);
		});
	}

	async remove(id: string): Promise<ConnectionActionResult> {
		const label = this.#items.get(id)?.label ?? 'Die Verbindung';
		return this.#act(async () => {
			await this.#data.remove(id);
			this.#items.delete(id);
			this.#status.delete(id);
			this.#notify(`„${label}“ gelöscht.`);
		});
	}

	isRunning(id: string): boolean {
		return this.#running.has(id);
	}

	/**
	 * "Jetzt abrufen" (E4 plan, package 15): runs the connection in the server, then shows its new
	 * state (last run, error, hint). The result goes out as a flag; the assistant shows it in its
	 * check line instead (`announce: false`), so it is not said twice.
	 */
	async runNow(id: string, { announce = true } = {}): Promise<ConnectionActionResult> {
		if (this.#running.has(id)) return { ok: false, message: null, fields: {} };
		const label = this.#items.get(id)?.label ?? 'Verbindung';
		const mail = this.#items.get(id)?.type === 'mail';
		this.#running.set(id, true);
		try {
			return await this.#act(async () => {
				const result = await this.#data.run(id);
				this.#lastRun.set(id, result);
				if (announce) this.#notify(runResultText(label, result), runResultTone(result));
				this.#items.set(id, await this.#data.get(id));
				// The run of a mailbox tells whether the helper answers; the card follows at once.
				if (mail) await this.#loadHelper({});
			});
		} finally {
			this.#running.delete(id);
		}
	}

	/**
	 * The last mails of a mail connection for the mailbox selection (E4 plan, package 23). null when
	 * the session ended (the store logs out) or the request was aborted.
	 */
	async listMailbox(
		id: string,
		limit: number,
		signal?: AbortSignal
	): Promise<MailboxOutcome<MailboxMail[]> | null> {
		return this.#mailbox(signal, () => this.#data.listMailbox(id, limit, { signal }));
	}

	/** Takes the chosen mails into the inbox and announces the result. */
	async importMailbox(
		id: string,
		uids: readonly number[]
	): Promise<MailboxOutcome<MailboxImportResult[]> | null> {
		const label = this.#items.get(id)?.label ?? 'Postfach';
		const outcome = await this.#mailbox(undefined, () => this.#data.importMailbox(id, uids));
		if (outcome?.kind === 'ok') this.#notify(`„${label}“: ${importSummary(outcome.value)}`);
		return outcome;
	}

	async #mailbox<T>(
		signal: AbortSignal | undefined,
		call: () => Promise<MailboxOutcome<T>>
	): Promise<MailboxOutcome<T> | null> {
		if (!this.#session.ensureValid()) return null;
		try {
			return await call();
		} catch (error) {
			const failure = toDataError(error, signal);
			if (failure.kind === 'aborted') return null;
			if (failure.kind === 'session') {
				this.#session.logout();
				return null;
			}
			return { kind: 'failed', message: failure.message, hint: '' };
		}
	}

	/** Takes a connection as the server answered it (e.g. after "Jetzt abrufen"). */
	upsert(connection: Connection): void {
		this.#items.set(connection.id, connection);
	}

	reset(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#items.clear();
		this.#status.clear();
		this.#lastRun.clear();
		this.#helper = null;
		this.#state = 'idle';
		this.#error = null;
	}

	/** Result of an action as a flag (ADR-0025 section 8). */
	#notify(title: string, tone: FlagTone = 'success'): void {
		this.#flags.show({ tone, title });
	}

	async #act(run: () => Promise<void>): Promise<ConnectionActionResult> {
		if (!this.#session.ensureValid()) return { ok: false, message: null, fields: {} };
		try {
			await run();
			return { ok: true };
		} catch (error) {
			const failure = toDataError(error);
			if (failure.kind === 'session') {
				this.#session.logout();
				return { ok: false, message: null, fields: {} };
			}
			const fields: Record<string, string> = {};
			for (const [field, detail] of Object.entries(failure.fields)) fields[field] = detail.message;
			return {
				ok: false,
				message: Object.keys(fields).length > 0 ? null : failure.message,
				fields
			};
		}
	}
}
