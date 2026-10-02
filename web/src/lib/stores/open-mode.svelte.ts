// Remembered way to open a ticket (plan "Bulk, Inline und Ansicht", BI-1; ADR-0036 §1) for the
// (app) layout: "Seitenpanel" or "Vollansicht", set when the user expands the panel to the full
// view or collapses the full view back into the panel, and used by every ticket link inside the
// app (rows of the table, keys, sub-tasks, links from inbox and rules). Below 64rem the panel is an
// overlay and links keep opening it; a choice made there is not stored. Storage that is blocked or
// full never breaks the app, the choice then lasts for this page; other tabs follow through the
// storage event.

import { createContext } from 'svelte';
import { page } from '$app/state';
import type { ResolvedPathname } from '$app/types';
import {
	OPEN_MODE_STORAGE_KEY,
	effectiveOpenMode,
	parseOpenMode,
	serializeOpenMode,
	type OpenMode
} from '$lib/domain/open-mode';
import { PANEL_EMBEDDED_QUERY } from '$lib/overlay/panel-host.svelte';
import { findTicketHost } from '$lib/ticket-host';
import { fullViewHref, fullViewPath, ticketHref, ticketPath } from '$lib/ticket-links';

type ModeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storageOf(win: Window | null): ModeStorage | null {
	try {
		return win?.localStorage ?? null;
	} catch {
		return null;
	}
}

export class TicketOpenModeStore {
	readonly #win: Window | null;
	#mode = $state<OpenMode>('panel');
	/** The panel is embedded (from 64rem); without matchMedia (tests) it counts as embedded. */
	#wide = $state(true);

	constructor(win: Window | null) {
		this.#win = win;
		try {
			this.#mode = parseOpenMode(storageOf(win)?.getItem(OPEN_MODE_STORAGE_KEY));
		} catch {
			this.#mode = 'panel';
		}
		if (win !== null && typeof win.matchMedia === 'function') {
			this.#wide = win.matchMedia(PANEL_EMBEDDED_QUERY).matches;
		}
	}

	/** The stored choice, independent of the window width. */
	get mode(): OpenMode {
		return this.#mode;
	}

	/** Whether the panel is embedded, so the choice applies. */
	get wide(): boolean {
		return this.#wide;
	}

	/** The mode links use now. */
	get effective(): OpenMode {
		return effectiveOpenMode(this.#mode, this.#wide);
	}

	/**
	 * Remembers the choice of the user ("Vollansicht" in the panel, "Im Seitenpanel öffnen" in the
	 * full view). Below 64rem nothing is stored, so the overlay does not overwrite the preference.
	 */
	choose(mode: OpenMode): void {
		if (!this.#wide || mode === this.#mode) return;
		this.#mode = mode;
		try {
			const storage = storageOf(this.#win);
			const value = serializeOpenMode(mode);
			if (value === null) storage?.removeItem(OPEN_MODE_STORAGE_KEY);
			else storage?.setItem(OPEN_MODE_STORAGE_KEY, value);
		} catch {
			// Blocked or full storage: the choice lasts for this page.
		}
	}

	/** Link to a ticket with the list state of `url`, in the remembered mode. */
	href(id: string, url: URL): ResolvedPathname {
		return this.effective === 'full' ? fullViewHref(id, url) : ticketHref(id, url);
	}

	/** Link to a ticket without list state (inbox, rules, results), in the remembered mode. */
	path(id: string): ResolvedPathname {
		return this.effective === 'full' ? fullViewPath(id) : ticketPath(id);
	}

	/** Follows the window width and other tabs; returns the cleanup. */
	connect(): () => void {
		const win = this.#win;
		if (win === null) return () => undefined;
		const cleanups: (() => void)[] = [];
		if (typeof win.matchMedia === 'function') {
			const query = win.matchMedia(PANEL_EMBEDDED_QUERY);
			const update = () => {
				this.#wide = query.matches;
			};
			update();
			query.addEventListener('change', update);
			cleanups.push(() => query.removeEventListener('change', update));
		}
		const onstorage = (event: StorageEvent) => {
			// key null: the other tab cleared the whole storage.
			if (event.key === null) this.#mode = 'panel';
			else if (event.key === OPEN_MODE_STORAGE_KEY) this.#mode = parseOpenMode(event.newValue);
		};
		win.addEventListener('storage', onstorage);
		cleanups.push(() => win.removeEventListener('storage', onstorage));
		return () => {
			for (const cleanup of cleanups) cleanup();
		};
	}
}

const [getTicketOpenMode, setTicketOpenMode, hasTicketOpenMode] =
	createContext<TicketOpenModeStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findTicketOpenMode(): TicketOpenModeStore | null {
	return hasTicketOpenMode() ? getTicketOpenMode() : null;
}

/**
 * Links to tickets for a component: in the remembered mode inside the (app) layout, the panel
 * outside it. Call during component initialisation; the functions read the mode when called, so a
 * template that uses them follows a new choice. Both keep the place of the component (ADR-0054):
 * below the calendar or in an area the panel and the full view open there (`TicketHost`), with the
 * panel they replace. `href` takes the state of `url`; `path` takes the current address, and from
 * a place without a host (the trash) it leads to the list without its state.
 */
export function ticketLinks(): {
	href: (id: string, url: URL) => ResolvedPathname;
	path: (id: string) => ResolvedPathname;
} {
	const store = findTicketOpenMode();
	const host = findTicketHost();
	const mode = (): OpenMode => store?.effective ?? 'panel';
	const href = (id: string, url: URL) =>
		mode() === 'full' ? host.full(id, url) : host.panel(id, url);
	return {
		href,
		path: (id) => host.path?.(id, mode()) ?? href(id, page.url)
	};
}

export { getTicketOpenMode, setTicketOpenMode };
