// The way back from a ticket to the place it was opened from, with the focus (ADR-0054 §7, KX-2).
// The layout of an area follows its navigations: leaving a ticket of its host for the way back
// (×, Escape, "Verwerfen", the full view, back in the browser) remembers that ticket and its
// address, which names the panel it came from. That panel (project, entry, rule) asks
// `focusTarget()` when it opens and gives the focus to the link of the ticket instead of its
// heading; back in the view the layout gives the focus to the link there, else to the heading of
// the view. Any other navigation forgets the ticket.

import { createContext, tick } from 'svelte';
import { afterNavigate, beforeNavigate } from '$app/navigation';
import { isTicketRoute, type AreaTicketHost } from './ticket-host';

interface Left {
	/** Record ID of the ticket that was left. */
	ticket: string;
	/** Its address: the panel it came from, if any. */
	from: URL;
	/** The way back leads to that panel, not to the view. */
	toPanel: boolean;
}

/** What a navigation knows of its ends (SvelteKit's `NavigationTarget`). */
interface End {
	readonly url: URL;
	readonly route: { readonly id: string | null };
	readonly params: Partial<Record<string, string>> | null;
}

export class TicketReturn {
	readonly #host: AreaTicketHost;
	#left = $state.raw<Left | null>(null);

	constructor(host: AreaTicketHost) {
		this.#host = host;
	}

	/**
	 * Remembers the ticket of `from` if the navigation goes to its way back; any other navigation
	 * forgets it.
	 */
	follow(from: End | null, to: End | null): void {
		const ticket =
			from !== null && isTicketRoute(this.#host, from.route.id) ? from.params?.id : null;
		if (ticket === undefined || ticket === null || from === null || to === null) {
			this.#left = null;
			return;
		}
		// The path of the way back, without its query (the state of the view).
		const back = this.#host.view(from.url).split(/[?#]/, 1)[0];
		const toWayBack = !isTicketRoute(this.#host, to.route.id) && back === to.url.pathname;
		this.#left = toWayBack
			? { ticket, from: from.url, toPanel: this.#host.origin(from.url) !== null }
			: null;
	}

	/** The link of the ticket the user just came back from, for the panel that opens now. */
	focusTarget(): HTMLElement | null {
		const left = this.#left;
		return left === null || !left.toPanel ? null : this.#host.entryOf(left.ticket, left.from);
	}

	/** Back in the view: the focus goes to the link of the ticket there, else to the heading. */
	async returnToView(): Promise<void> {
		const left = this.#left;
		if (left === null || left.toPanel) return;
		await tick();
		const active = document.activeElement;
		if (active !== null && active !== document.body) return;
		const target =
			this.#host.entryOf(left.ticket, left.from) ??
			document.querySelector<HTMLElement>('[data-view-heading]');
		target?.focus();
	}
}

const [getTicketReturn, setTicketReturn, hasTicketReturn] = createContext<TicketReturn>();

/**
 * Follows the navigations of the layout of an area and hands the way back to its pages. Call
 * during the initialisation of the layout.
 */
export function followTicketReturn(host: AreaTicketHost): TicketReturn {
	const state = setTicketReturn(new TicketReturn(host));
	beforeNavigate(({ from, to }) => state.follow(from, to));
	afterNavigate(() => void state.returnToView());
	return state;
}

/** The way back of the area layout, or null outside one (tests of single pages). */
export function findTicketReturn(): TicketReturn | null {
	return hasTicketReturn() ? getTicketReturn() : null;
}
