// Access data of the channels on the page "Kanäle" (BW-3, ADR-0075): the state of the BYL_*
// variables in the Windows user environment of the PC, "Setzen"/"Ersetzen" and "Entfernen" at the
// fields of the channels, and the hint "Neustart nötig, damit geänderte Zugangsdaten wirken",
// whose state the server keeps until its next restart (so it stands after a reload and on every
// device). One store per page. A value passes through `set` on its way to the data layer and is
// never kept here: no field, no state, no flag, no web storage, never the outbox (ADR-0074).

import type PocketBase from 'pocketbase';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import {
	fetchCredentialStatus,
	fetchRestartNotice,
	removeCredential,
	setCredential,
	type CredentialAnswer,
	type CredentialChange
} from '$lib/data/credentials';
import { problemOf, toDataError, withIntent } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import type { StoredSecrets } from '$lib/domain/channel-setup';
import type { Connection } from '$lib/domain/connections';
import {
	CREDENTIAL_MESSAGES,
	CREDENTIAL_TEXTS,
	credentialDenialText,
	type CredentialStatus,
	type CredentialVariable
} from '$lib/domain/credentials';
import type { ProblemEntry } from '$lib/domain/problems';
import type { SessionGuard } from './ticket-list.svelte';

export interface CredentialsData {
	status(
		names: readonly string[],
		options: RequestOptions
	): Promise<CredentialAnswer<CredentialStatus>>;
	set(name: string, value: string): Promise<CredentialAnswer<CredentialChange>>;
	remove(name: string): Promise<CredentialAnswer<CredentialChange>>;
	notice(options: RequestOptions): Promise<CredentialAnswer<boolean>>;
}

export function credentialsData(pb: PocketBase): CredentialsData {
	return {
		status: (names, options) => fetchCredentialStatus(pb, names, options),
		set: (name, value) => setCredential(pb, name, value),
		remove: (name) => removeCredential(pb, name),
		notice: (options) => fetchRestartNotice(pb, options)
	};
}

/** idle: not asked; loading; ready; failed: the state could not be read (`failure` says why). */
export type CredentialsState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * The outcome of "Setzen" or "Entfernen": done (the restart question follows), a problem of the
 * value or the name at the field (`field`), or a failure with its text and "Details" (FP-1).
 */
export type CredentialOutcome =
	| { kind: 'done'; change: CredentialChange }
	| { kind: 'field'; message: string }
	| { kind: 'failed'; message: string; problem: ProblemEntry | null; tone: 'warning' | 'error' };

/** Intents of the actions in "Details" (the words of the catalog, problem-intents.ts). */
const INTENTS = { set: 'Zugangsdaten setzen', remove: 'Zugangsdaten entfernen' } as const;

export class CredentialsStore {
	readonly #data: CredentialsData;
	readonly #session: SessionGuard;
	#controller = new AbortController();
	readonly #variables = new SvelteMap<string, CredentialVariable>();
	/** Names a view asked for beyond those of the connections (a setup before its connection). */
	readonly #extra = new SvelteSet<string>();
	#state = $state<CredentialsState>('idle');
	#failure = $state.raw<{ message: string; problem: ProblemEntry | null } | null>(null);
	#restartNeeded = $state(false);
	#busy = $state<string | null>(null);
	/** A change got no answer (the connection broke): whether it arrived is unknown. */
	#unanswered = false;

	constructor(data: CredentialsData, session: SessionGuard) {
		this.#data = data;
		this.#session = session;
	}

	get state(): CredentialsState {
		return this.#state;
	}

	/** Why the state could not be read, with "Details"; null otherwise. */
	get failure(): { message: string; problem: ProblemEntry | null } | null {
		return this.#failure;
	}

	/** The hint "Neustart nötig, damit geänderte Zugangsdaten wirken" stands. */
	get restartNeeded(): boolean {
		return this.#restartNeeded;
	}

	/** The variable being set or removed now, null while none. */
	get busy(): string | null {
		return this.#busy;
	}

	/** The state of `name`, null before it is known. */
	variable(name: string): CredentialVariable | null {
		return this.#variables.get(name) ?? null;
	}

	/**
	 * The variables of a connection in the user environment of the PC (KE-1, ADR-0076 §4), for the
	 * question whether a variable the server does not see waits for the restart; null until read.
	 */
	storedOf(
		connection: Pick<Connection, 'type' | 'secretEnv' | 'allowlistEnv'>
	): StoredSecrets | null {
		if (this.#state !== 'ready') return null;
		const known = (name: string) => {
			const variable = this.#variables.get(name);
			return variable === undefined || variable.blocked ? null : variable.set;
		};
		const secret = known(connection.secretEnv);
		const allowlist = connection.type === 'telegram' ? known(connection.allowlistEnv) : null;
		return secret === null && allowlist === null ? null : { secret, allowlist };
	}

	/**
	 * Reads the state of the variables of the connections, plus `names` (the suggestion of a setup).
	 * Only for the administrator on the PC; the view asks only there.
	 */
	async load(names: readonly string[] = []): Promise<void> {
		for (const name of names) this.#extra.add(name);
		if (!this.#session.ensureValid()) return;
		const signal = this.#controller.signal;
		if (this.#state !== 'ready') this.#state = 'loading';
		try {
			const answer = await this.#data.status([...this.#extra].sort(), { signal });
			if (signal.aborted) return;
			if (answer.kind === 'ok') {
				for (const variable of answer.value.variables) this.#variables.set(variable.name, variable);
				this.#restartNeeded = answer.value.restartNeeded;
				this.#failure = null;
				this.#state = 'ready';
				this.#unanswered = false;
				return;
			}
			const message =
				answer.kind === 'denied'
					? credentialDenialText(answer.reason)
					: CREDENTIAL_MESSAGES[answer.problem];
			this.#failure = { message, problem: answer.kind === 'denied' ? answer.problem : null };
			this.#state = 'failed';
		} catch (error) {
			this.#fail(error, signal);
		}
	}

	/** Asks the server whether the hint stands (also on another device, which cannot read the state). */
	async refreshNotice(): Promise<void> {
		if (!this.#session.ensureValid()) return;
		const signal = this.#controller.signal;
		try {
			const answer = await this.#data.notice({ signal });
			if (!signal.aborted && answer.kind === 'ok') this.#restartNeeded = answer.value;
		} catch (error) {
			const failure = toDataError(error, signal);
			if (failure.kind === 'session') this.#session.logout();
			// Without an answer the hint stays as it was; the next visit asks again.
		}
	}

	/**
	 * After a change that got no answer, once the page sees the connection again (the browser is
	 * online, the tab is back): reads the state, with the hint, from the server; nothing otherwise.
	 */
	async recover(): Promise<void> {
		if (this.#unanswered) await this.load();
	}

	/** "Setzen" / "Ersetzen": hands `value` on once and keeps nothing of it. */
	set(name: string, value: string): Promise<CredentialOutcome | null> {
		return this.#change(name, 'set', () => this.#data.set(name, value));
	}

	/** "Entfernen". */
	remove(name: string): Promise<CredentialOutcome | null> {
		return this.#change(name, 'remove', () => this.#data.remove(name));
	}

	async #change(
		name: string,
		intent: keyof typeof INTENTS,
		run: () => Promise<CredentialAnswer<CredentialChange>>
	): Promise<CredentialOutcome | null> {
		if (this.#busy !== null || !this.#session.ensureValid()) return null;
		const signal = this.#controller.signal;
		this.#busy = name;
		try {
			const answer = await withIntent(INTENTS[intent], run);
			if (signal.aborted) return null;
			if (answer.kind === 'invalid') {
				return { kind: 'field', message: answer.message ?? CREDENTIAL_MESSAGES[answer.problem] };
			}
			if (answer.kind === 'denied') {
				return {
					kind: 'failed',
					message: credentialDenialText(answer.reason),
					problem: answer.problem,
					tone: answer.reason === 'script' ? 'error' : 'warning'
				};
			}
			const known = this.#variables.get(name);
			this.#variables.set(name, {
				name,
				set: answer.value.set,
				blocked: false,
				channels: known?.channels ?? []
			});
			if (answer.value.restartNeeded) this.#restartNeeded = true;
			return { kind: 'done', change: answer.value };
		} catch (error) {
			const failure = toDataError(error, signal);
			if (failure.kind === 'aborted') return null;
			if (failure.kind === 'session') {
				this.#session.logout();
				return null;
			}
			if (failure.kind === 'network') this.#unanswered = true;
			const message = failure.kind === 'network' ? CREDENTIAL_TEXTS.offline : failure.message;
			return { kind: 'failed', message, problem: problemOf(failure), tone: 'error' };
		} finally {
			if (!signal.aborted) this.#busy = null;
		}
	}

	#fail(error: unknown, signal: AbortSignal): void {
		const failure = toDataError(error, signal);
		if (failure.kind === 'aborted') return;
		if (failure.kind === 'session') {
			this.#session.logout();
			return;
		}
		this.#failure = { message: failure.message, problem: problemOf(failure) };
		this.#state = 'failed';
	}

	/** Ends every request and forgets the state (the page goes or changes its area). */
	reset(): void {
		this.#controller.abort();
		this.#controller = new AbortController();
		this.#variables.clear();
		this.#extra.clear();
		this.#state = 'idle';
		this.#failure = null;
		this.#restartNeeded = false;
		this.#busy = null;
		this.#unanswered = false;
	}
}
