// URLs of the ticket views (E2 plan, T-4 and T-5). Tickets are addressed by record ID, never by
// key (CLAUDE.md section 5). The list state lives in the query and travels with every link, so
// opening or closing a ticket keeps the switch "Erledigte anzeigen".

import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';

/** Query parameter of the switch "Erledigte anzeigen" (CLAUDE.md section 7). */
export const SHOW_DONE_PARAM = 'erledigte';

export function showDoneFrom(url: URL): boolean {
	return url.searchParams.get(SHOW_DONE_PARAM) === '1';
}

/** Path of the list with the query of `url`. */
export function listHref(url: URL): ResolvedPathname {
	return `${resolve('/')}${url.search}` as ResolvedPathname;
}

/** Path of the detail panel of a ticket with the query of `url`. */
export function ticketHref(id: string, url: URL): ResolvedPathname {
	return `${resolve('/')}tickets/${encodeURIComponent(id)}${url.search}` as ResolvedPathname;
}

/** The current path with the switch "Erledigte anzeigen" set or removed; other parameters stay. */
export function withShowDone(url: URL, show: boolean): ResolvedPathname {
	const params = new URLSearchParams(url.search);
	if (show) params.set(SHOW_DONE_PARAM, '1');
	else params.delete(SHOW_DONE_PARAM);
	const query = params.toString();
	// url.pathname is already resolved (it contains the base path).
	return `${url.pathname}${query ? `?${query}` : ''}${url.hash}` as ResolvedPathname;
}
