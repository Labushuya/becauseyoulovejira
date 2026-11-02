// The address of an entry of the error log of the server (FP-2, ADR-0077): the current page with
// `?fehler=<id>`, so "Details" at the last error of a channel card opens the dialog of the errors at
// that entry wherever it stands, and a copied address opens it again. The root layout reads the
// parameter (serverProblemIdOf) and takes it out when the dialog closes. The page "Kanäle" provides
// how a card finds the entry of its connection (provideChannelProblems); without it a card asks
// nothing and shows no link.

import { getContext, setContext } from 'svelte';
import type { ResolvedPathname } from '$app/types';
import { SERVER_PROBLEM_PARAM } from '$lib/domain/server-problems';

/** The ID of the newest entry of a failed run of a connection, or null. */
export type ChannelProblemFinder = (
	connection: string,
	signal: AbortSignal
) => Promise<string | null>;

const FINDER = Symbol('byl-channel-problems');

/** The page of the cards: how "Details" at the last error finds its entry (call during init). */
export function provideChannelProblems(find: ChannelProblemFinder): void {
	setContext(FINDER, find);
}

/** The finder of the page, or null outside of it (call during init). */
export function channelProblems(): ChannelProblemFinder | null {
	return getContext<ChannelProblemFinder | undefined>(FINDER) ?? null;
}

/** The address `url` with the entry `id` in `?fehler=` (other parameters and the hash stay). */
export function withServerProblem(url: URL, id: string): ResolvedPathname {
	const params = new URLSearchParams(url.searchParams);
	params.set(SERVER_PROBLEM_PARAM, id);
	return `${url.pathname}?${params.toString()}${url.hash}` as ResolvedPathname;
}

/** The address `url` without `?fehler=`; every other parameter and the hash stay. */
export function withoutServerProblem(url: URL): ResolvedPathname {
	const params = new URLSearchParams(url.searchParams);
	params.delete(SERVER_PROBLEM_PARAM);
	const query = params.toString();
	return `${url.pathname}${query === '' ? '' : `?${query}`}${url.hash}` as ResolvedPathname;
}
