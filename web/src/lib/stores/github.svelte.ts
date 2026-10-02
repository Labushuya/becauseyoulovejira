// GitHub channel on the page "Kanäle" (ADR-0050 §7; ADR-0006): the details of each card (access,
// rate limit, per repository the last change, open pull requests, last release, last run) from
// what the runs of the server stored, loaded with the card and after every run; and "Verbindung
// prüfen", which asks GitHub in the server. Only reading: nothing goes to GitHub but questions.
// Results go out as flags (ADR-0025 section 8); a lost session logs out once.

import type PocketBase from 'pocketbase';
import { SvelteMap } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import { checkGitHub, getGitHubDetails } from '$lib/data/github';
import type { RequestOptions } from '$lib/data/options';
import { checkSummary, type GitHubCheck, type GitHubDetails } from '$lib/domain/github';
import { restartNeeded } from '$lib/guidance/texts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface GitHubData {
	details(id: string, options: RequestOptions): Promise<GitHubDetails>;
	check(id: string): Promise<GitHubCheck>;
}

export function githubData(pb: PocketBase): GitHubData {
	return {
		details: (id, options) => getGitHubDetails(pb, id, options),
		check: (id) => checkGitHub(pb, id)
	};
}

/** Shown while the server does not know the routes of GitHub yet (before the restart). */
export const GITHUB_UNAVAILABLE_MESSAGE = restartNeeded('Die Details von GitHub sind');

/** The details of a card: loaded, or why not. */
export type GitHubDetailsState =
	{ kind: 'ready'; details: GitHubDetails } | { kind: 'error'; message: string };

/** Answer of "Verbindung prüfen" in the page: the result, or the failure of the request. */
export type GitHubCheckState =
	{ kind: 'ok'; check: GitHubCheck } | { kind: 'error'; message: string };

export class GitHubStore {
	readonly #data: GitHubData;
	readonly #session: SessionGuard;
	readonly #flags: FlagSink;
	readonly #details = new SvelteMap<string, GitHubDetailsState>();
	readonly #checking = new SvelteMap<string, true>();
	readonly #lastCheck = new SvelteMap<string, GitHubCheckState>();

	constructor(data: GitHubData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	/** The details of a connection, null until loaded. */
	details(id: string): GitHubDetailsState | null {
		return this.#details.get(id) ?? null;
	}

	isChecking(id: string): boolean {
		return this.#checking.has(id);
	}

	/** Answer of the last check of a connection on this page (the assistant shows it). */
	lastCheck(id: string): GitHubCheckState | null {
		return this.#lastCheck.get(id) ?? null;
	}

	/**
	 * Loads the details of a connection; a failure stays as its message (the card says it), loaded
	 * details of before stay until then. Nothing on an aborted request.
	 */
	async loadDetails(id: string, options: RequestOptions = {}): Promise<void> {
		if (!this.#session.ensureValid()) return;
		try {
			this.#details.set(id, { kind: 'ready', details: await this.#data.details(id, options) });
		} catch (error) {
			const failure = toDataError(error, options.signal);
			if (failure.kind === 'aborted') return;
			if (failure.kind === 'session') {
				this.#session.logout();
				return;
			}
			this.#details.set(id, {
				kind: 'error',
				message: failure.kind === 'not_found' ? GITHUB_UNAVAILABLE_MESSAGE : failure.message
			});
		}
	}

	/**
	 * "Verbindung prüfen": asks GitHub in the server for the user of the token, the rate limit and
	 * every repository, then loads the details again. The answer stays for the page; `announce`
	 * sends it as a flag too (the card; the assistant shows it inline). null when the session ended
	 * or a check of the connection runs already.
	 */
	async check(
		id: string,
		label: string,
		{ announce = true } = {}
	): Promise<GitHubCheckState | null> {
		if (this.#checking.has(id) || !this.#session.ensureValid()) return null;
		this.#checking.set(id, true);
		try {
			let state: GitHubCheckState;
			try {
				state = { kind: 'ok', check: await this.#data.check(id) };
			} catch (error) {
				const failure = toDataError(error);
				if (failure.kind === 'session') {
					this.#session.logout();
					return null;
				}
				state = {
					kind: 'error',
					message: failure.kind === 'not_found' ? GITHUB_UNAVAILABLE_MESSAGE : failure.message
				};
			}
			this.#lastCheck.set(id, state);
			if (announce) {
				const summary =
					state.kind === 'ok'
						? checkSummary(state.check)
						: { tone: 'error' as const, text: state.message };
				this.#flags.show({ tone: summary.tone, title: `„${label}“: ${summary.text}` });
			}
			await this.loadDetails(id);
			return state;
		} finally {
			this.#checking.delete(id);
		}
	}

	reset(): void {
		this.#details.clear();
		this.#checking.clear();
		this.#lastCheck.clear();
	}
}
