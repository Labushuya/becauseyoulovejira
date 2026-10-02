// GitHub channel on the page "Kanäle" (ADR-0050 §7; ADR-0006): the details of each card (access,
// rate limit, per repository the last change, open pull requests, last release, last run) from
// what the runs of the server stored, loaded with the card and after every run; and "Verbindung
// prüfen", which asks GitHub in the server. Since the addendum of 2026-10-02 also the list of the
// repositories of the token for "Repository hinzufügen …". Only reading: nothing goes to GitHub but
// questions. Results go out as flags (ADR-0025 section 8); a lost session logs out once.

import type PocketBase from 'pocketbase';
import { SvelteMap } from 'svelte/reactivity';
import { toDataError } from '$lib/data/errors';
import { checkGitHub, getGitHubDetails, listGitHubRepos } from '$lib/data/github';
import type { RequestOptions } from '$lib/data/options';
import {
	checkSummary,
	type GitHubCheck,
	type GitHubDetails,
	type GitHubRepoList
} from '$lib/domain/github';
import { restartNeeded } from '$lib/guidance/texts';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';
import type { SessionGuard } from './ticket-list.svelte';

export interface GitHubData {
	details(id: string, options: RequestOptions): Promise<GitHubDetails>;
	check(id: string): Promise<GitHubCheck>;
	repos(id: string, options: RequestOptions & { refresh?: boolean }): Promise<GitHubRepoList>;
}

export function githubData(pb: PocketBase): GitHubData {
	return {
		details: (id, options) => getGitHubDetails(pb, id, options),
		check: (id) => checkGitHub(pb, id),
		repos: (id, options) => listGitHubRepos(pb, id, options)
	};
}

/** Shown while the server does not know the routes of GitHub yet (before the restart). */
export const GITHUB_UNAVAILABLE_MESSAGE = restartNeeded('Die Details von GitHub sind');

/** Shown while the server does not know the list of the token yet (before the restart). */
export const GITHUB_LIST_UNAVAILABLE_MESSAGE = restartNeeded('Die Liste deiner Repositorys ist');

/** The list of the repositories of the token: loading, loaded, or why not. */
export type GitHubRepoListState =
	| { kind: 'loading' }
	| { kind: 'ready'; list: GitHubRepoList }
	/** `restart`: the server does not know the route yet; no error of the request. */
	| { kind: 'error'; message: string; restart: boolean };

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
	readonly #lists = new SvelteMap<string, GitHubRepoListState>();

	constructor(data: GitHubData, session: SessionGuard, flags: FlagSink = SILENT_FLAGS) {
		this.#data = data;
		this.#session = session;
		this.#flags = flags;
	}

	/** The details of a connection, null until loaded. */
	details(id: string): GitHubDetailsState | null {
		return this.#details.get(id) ?? null;
	}

	/** The list of the repositories of the token of a connection, null before the first load. */
	repoList(id: string): GitHubRepoListState | null {
		return this.#lists.get(id) ?? null;
	}

	/**
	 * Loads the list of the repositories of the token (the server reads GitHub at most hourly;
	 * `refresh` asks it to read again). A list of before stays visible while it loads again; a
	 * failure of the request stays as its message, the route unknown before the restart says so.
	 * Nothing on an aborted request.
	 */
	async loadRepoList(
		id: string,
		{ refresh = false, signal }: RequestOptions & { refresh?: boolean } = {}
	): Promise<void> {
		if (!this.#session.ensureValid()) return;
		if (this.#lists.get(id)?.kind !== 'ready') this.#lists.set(id, { kind: 'loading' });
		try {
			this.#lists.set(id, {
				kind: 'ready',
				list: await this.#data.repos(id, { refresh, signal })
			});
		} catch (error) {
			const failure = toDataError(error, signal);
			if (failure.kind === 'aborted') return;
			if (failure.kind === 'session') {
				this.#session.logout();
				return;
			}
			const restart = failure.kind === 'not_found';
			this.#lists.set(id, {
				kind: 'error',
				message: restart ? GITHUB_LIST_UNAVAILABLE_MESSAGE : failure.message,
				restart
			});
		}
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
		this.#lists.clear();
	}
}
