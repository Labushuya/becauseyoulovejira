// The way back of a page in the phone frame (MO-4, ADR-0073 addendum MO-4): the arrow in the head of
// a panel shown as a page goes back like the back gesture of Android, when the browser's history
// holds the view just before the panel. Then the view comes back from the history with its filters
// in the address and the scroll position SvelteKit keeps for that entry, and the history gets no
// second entry of the list (after which the back gesture would open the ticket again). Without that
// knowledge (the page was opened from outside, reloaded, or reached from another ticket) the arrow
// navigates to the view like the × on the PC. The (app) layout tells the store about every
// navigation; nothing is stored beyond the open page.

import { createContext } from 'svelte';

/** What afterNavigate says about the arrival at the current page. */
export interface Arrival {
	/** The kind of navigation: "enter", "link", "goto", "popstate", "form", … */
	readonly type: string;
	/** The page before, or null at the start of the app. */
	readonly from: URL | null;
	/** Steps through the history, only for "popstate". */
	readonly delta?: number;
}

/** Path and query of an address of the app, the form the views give their way back in. */
export function entryOf(url: URL): string {
	return `${url.pathname}${url.search}`;
}

/**
 * The entry of the history right before the current page, if it is known: a link or a call of
 * `goto` from there added the current entry (every way into a panel does; none of them replaces
 * the entry of its view), or "Vor" came one step from there. Otherwise null: the start of the app, a
 * reload, a step back, several steps or a form.
 */
export function previousEntry(arrival: Arrival): string | null {
	if (arrival.from === null) return null;
	if (arrival.type === 'link' || arrival.type === 'goto') return entryOf(arrival.from);
	if (arrival.type === 'popstate' && arrival.delta === 1) return entryOf(arrival.from);
	return null;
}

/** The entry before the current page as far as the app knows it (MO-4). */
export class WayBack {
	#previous: string | null = null;

	/** Every navigation of the app; afterNavigate of the (app) layout. */
	arrived(arrival: Arrival): void {
		this.#previous = previousEntry(arrival);
	}

	/** Whether the entry before the current page is `href` (path and query of the app). */
	isPrevious(href: string): boolean {
		return this.#previous !== null && this.#previous === href;
	}

	/**
	 * The entry before the current page (path and query), null when the app does not know it. Read
	 * when the arrow is pressed (MO-6): it is set after the page has rendered.
	 */
	get previous(): string | null {
		return this.#previous;
	}
}

/**
 * Whether the arrow of a form page goes back through the history (MO-6): only in the phone frame
 * and only when a link or `goto` of the app led to the page, so the page before is where the form
 * was opened ("Umwandeln" of a card or an entry). Otherwise the form keeps its way of the PC.
 */
export function backThroughHistory(phone: boolean, wayBack: WayBack | null): boolean {
	return phone && wayBack !== null && wayBack.previous !== null;
}

const [getWayBack, setWayBack, hasWayBack] = createContext<WayBack>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findWayBack(): WayBack | null {
	return hasWayBack() ? getWayBack() : null;
}

/**
 * The arrow of a page: back through the history when the entry before is `href`, else a new
 * navigation through `navigate` (the × of the PC).
 */
export function goBack(wayBack: WayBack | null, href: string, navigate: () => void): void {
	if (wayBack?.isPrevious(href) === true) history.back();
	else navigate();
}

export { setWayBack };
