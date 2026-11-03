// The address of an entry of the error log of the server (FP-2, ADR-0077): the current page with
// `?fehler=<id>`, so "Details" at the last error of a channel card opens the dialog of the errors at
// that entry wherever it stands, and a copied address opens it again. The root layout reads the
// parameter (serverProblemIdOf) and takes it out when the dialog closes. The page "Kanäle" provides
// how its cards find the entries of their connections (provideChannelProblems, one query for all
// cards); without it a card asks nothing and shows no link.

import { getContext, setContext } from 'svelte';
import type { ResolvedPathname } from '$app/types';
import { SERVER_PROBLEM_PARAM, type ChannelProblemCard } from '$lib/domain/server-problems';

/** How a card finds the entry behind its last error (ChannelProblemsStore of the page). */
export interface ChannelProblemLookup {
	/** The card shows the last error `card`; the returned function ends it. */
	watch(card: ChannelProblemCard): () => void;
	/** The ID of the entry behind the last error of the card, or null. */
	idOf(card: Pick<ChannelProblemCard, 'connection' | 'lastError'>): string | null;
}

const LOOKUP = Symbol('byl-channel-problems');

/** The page of the cards: how "Details" at the last error finds its entry (call during init). */
export function provideChannelProblems(lookup: ChannelProblemLookup): void {
	setContext(LOOKUP, lookup);
}

/** The lookup of the page, or null outside of it (call during init). */
export function channelProblems(): ChannelProblemLookup | null {
	return getContext<ChannelProblemLookup | undefined>(LOOKUP) ?? null;
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
