// The arrow of a panel shown as a page in the phone frame (MO-6 for an entry of the inbox; since MO-7b
// shared by the project, the rule and the preview of the trash, ADR-0073 addenda MO-6 and MO-7b): back
// through the history when the page of a view lies right before it, named after that view, like the
// back gesture of Android, so the list comes back with its state in the address and its place, and
// the history gets no second entry of it; otherwise (opened from outside, reloaded, from a ticket or a
// form) a new navigation to the view of the page, like the × on the PC. The page before is read from
// afterNavigate, because the name must be right before the first tap.

import { afterNavigate, goto } from '$app/navigation';
import type { ResolvedPathname } from '$app/types';
import type { AreaView } from '$lib/domain/area';
import { arrowBack } from '$lib/views';
import { previousEntry, type Arrival } from '$lib/way-back';

export class ViewArrow {
	#previous = $state<string | null>(null);
	readonly #own: () => AreaView;
	readonly #back: () => ResolvedPathname;
	readonly #navigate: (href: ResolvedPathname) => unknown;

	/**
	 * `own`: the view of the page; `back`: where the × of the PC leads (the view with its state);
	 * `navigate`: the navigation of the app.
	 */
	constructor(
		own: () => AreaView,
		back: () => ResolvedPathname,
		navigate: (href: ResolvedPathname) => unknown = (href) => goto(href)
	) {
		this.#own = own;
		this.#back = back;
		this.#navigate = navigate;
	}

	/** Every arrival at the page (afterNavigate). */
	arrived(arrival: Arrival): void {
		this.#previous = previousEntry(arrival);
	}

	/** The name of the arrow, after the view it leads to ("Zu den Projekten", "Zum Tagesplan"). */
	get label(): string {
		return arrowBack(this.#previous, this.#own()).label;
	}

	/** A tap on the arrow. */
	go(): void {
		if (arrowBack(this.#previous, this.#own()).throughHistory) history.back();
		else void this.#navigate(this.#back());
	}
}

/** The arrow of the page of a route; it follows the arrivals at the page. */
export function followViewArrow(own: () => AreaView, back: () => ResolvedPathname): ViewArrow {
	const arrow = new ViewArrow(own, back);
	afterNavigate(({ type, from, delta }) => arrow.arrived({ type, from: from?.url ?? null, delta }));
	return arrow;
}
