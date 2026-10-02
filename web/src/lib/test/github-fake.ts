// Fake data layer of the GitHub channel (ADR-0050) for component tests: every call answers from a
// fixed value unless a test replaces it. `githubStoreOf` builds the store with a session that stays
// valid, so tests of the page "Kanäle" that do not look at GitHub get an inert store.

import { vi } from 'vitest';
import type {
	GitHubAutoDetails,
	GitHubCheck,
	GitHubDetails,
	GitHubRepoList
} from '$lib/domain/github';
import { FlagStore } from '$lib/stores/flags.svelte';
import { GitHubStore, type GitHubData } from '$lib/stores/github.svelte';

/** "Alle meine Repositorys" switched off, on a server that knows it. */
export const AUTO_OFF: GitHubAutoDetails = {
	enabled: false,
	login: '',
	at: null,
	count: 0,
	more: 0,
	added: [],
	removed: [],
	changedAt: null,
	error: '',
	excluded: []
};

export const EMPTY_DETAILS: GitHubDetails = {
	authenticated: true,
	interval: 15,
	repos: [],
	limit: null,
	rate: null,
	auto: AUTO_OFF
};

/** A list of the token without repositories. */
export const EMPTY_LIST: GitHubRepoList = {
	status: 'ok',
	message: '',
	login: 'octo',
	at: '2026-10-02T10:00:00.000Z',
	more: false,
	repos: []
};

export const OK_CHECK: GitHubCheck = {
	status: 'ok',
	authenticated: true,
	login: 'octo',
	rate: { limit: 5000, remaining: 4990, reset: '2026-10-02T12:00:00.000Z' },
	repos: [],
	message: ''
};

/** A data layer with spies; a test changes single calls with mockImplementation and the like. */
export function fakeGitHubData() {
	return {
		details: vi.fn<GitHubData['details']>(async () => EMPTY_DETAILS),
		check: vi.fn<GitHubData['check']>(async () => OK_CHECK),
		repos: vi.fn<GitHubData['repos']>(async () => EMPTY_LIST)
	} satisfies GitHubData;
}

/** The fake data layer as `fakeGitHubData` returns it. */
export type FakeGitHubData = ReturnType<typeof fakeGitHubData>;

/** The store on a fake data layer (inert by default), with a valid session. */
export function githubStoreOf(
	data: GitHubData = fakeGitHubData(),
	flags: FlagStore = new FlagStore()
): GitHubStore {
	return new GitHubStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
}
