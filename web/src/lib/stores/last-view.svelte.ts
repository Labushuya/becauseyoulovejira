// Last view outside the settings (ADR-0026 section 1, plan EH-1): the (app) layout remembers
// every address it shows, except the settings and the full view, so "Zurück zu …" in the settings
// leads back to the view with its filters, search, grouping and open panel. The value lives in
// sessionStorage (survives reloading and a restart of the app in the same tab) and is checked
// with safeRedirect when read, so a manipulated value cannot lead to another origin.

import { createContext } from 'svelte';
import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import { safeRedirect } from '$lib/guard';
import { isSettingsPath } from '$lib/settings-sections';

/** Key in sessionStorage. */
export const LAST_VIEW_KEY = 'byl-last-view';

/** Storage the store needs; sessionStorage in the app, a fake in tests. */
export type LastViewStorage = Pick<Storage, 'getItem' | 'setItem'>;

const LOGIN = resolve('/login');

/** Path of an internal address without query and hash ("/tickets/x?y=1" → "/tickets/x"). */
function pathOf(href: string): string {
	return href.split(/[?#]/, 1)[0] ?? '';
}

/** Whether the address is a view to go back to: not the settings, the full view or the login. */
export function isViewPath(pathname: string): boolean {
	if (isSettingsPath(pathname)) return false;
	if (pathname === LOGIN) return false;
	return !/\/voll\/?$/.test(pathname);
}

/**
 * Label of the way back for a checked address: the view, or the open panel ("Zurück zu BYL-12",
 * "Zurück zum Eintrag"). `ticketKey` finds the key of a ticket in the list, if it is loaded.
 */
export function lastViewLabel(
	href: string,
	ticketKey: (id: string) => string | null = () => null
): string {
	const pathname = pathOf(href);
	const tickets = `${resolve('/')}tickets`;
	const projects = resolve('/projekte');
	const inbox = resolve('/eingang');
	const calendar = resolve('/kalender');
	// A ticket next to the list or next to the calendar (ADR-0053 §6).
	const ticket = new RegExp(`^(?:${tickets}|${calendar}/tickets)/([^/]+)/?$`).exec(pathname)?.[1];
	if (ticket !== undefined && ticket !== 'neu') {
		const key = ticketKey(decodeURIComponent(ticket));
		return key ? `Zurück zu ${key}` : 'Zurück zum Ticket';
	}
	if (pathname === calendar || pathname.startsWith(`${calendar}/`)) return 'Zurück zum Kalender';
	if (pathname === projects || pathname.startsWith(`${projects}/`)) return 'Zurück zu Projekte';
	const entry = new RegExp(`^${inbox}/([^/]+)/?$`).exec(pathname)?.[1];
	if (entry !== undefined && entry !== 'neu') return 'Zurück zum Eintrag';
	if (pathname === inbox || pathname.startsWith(`${inbox}/`)) return 'Zurück zum Eingang';
	return 'Zurück zu Aufgaben';
}

/** The remembered view; reading and writing never throws (storage off or full). */
export class LastViewStore {
	#stored = $state<string | null>(null);
	readonly #storage: () => LastViewStorage | null;
	readonly #origin: () => string;

	constructor(storage: () => LastViewStorage | null, origin: () => string) {
		this.#storage = storage;
		this.#origin = origin;
		try {
			this.#stored = storage()?.getItem(LAST_VIEW_KEY) ?? null;
		} catch {
			this.#stored = null;
		}
	}

	/** Remembers `url` if it is a view; the settings and the full view leave the value as it is. */
	remember(url: URL): void {
		if (!isViewPath(url.pathname)) return;
		const path = url.pathname + url.search + url.hash;
		this.#stored = path;
		try {
			this.#storage()?.setItem(LAST_VIEW_KEY, path);
		} catch {
			// The value stays in memory for this page; after reloading the way back leads to "/".
		}
	}

	/** Checked address of the last view; "/" without a value or for an invalid one. */
	get href(): ResolvedPathname {
		const href = safeRedirect(this.#stored, this.#origin());
		return isViewPath(pathOf(href)) ? href : resolve('/');
	}
}

/** sessionStorage of the window, or null where it is not available. */
export function sessionStore(): LastViewStorage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

const [getLastViewStore, setLastViewStore] = createContext<LastViewStore>();

export { getLastViewStore, setLastViewStore };
