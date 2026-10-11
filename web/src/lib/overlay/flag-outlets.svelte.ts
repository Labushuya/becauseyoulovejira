// Where the flags render (ADR-0025 section 8, addendum 18, package FL-1). A modal <dialog>
// (showModal) puts everything outside of it into the inert background, the flags of the app layout
// included. So while a modal is open, the flags render inside the topmost open modal, as a direct
// child of its <dialog> and outside of its frame, where they stay visible and clickable. This
// stack mirrors the top layer: a modal enters when it opens (showModal) and leaves when it closes,
// the last one is on top. Exactly one output shows the flags of a store at a time: the topmost
// open modal with them, otherwise the app layout. The flags and their clocks live in the store, so
// moving between the outputs loses nothing and restarts no time.

import { untrack } from 'svelte';

/** An output of the flags: the app layout (null) or an open modal (its token). */
export type FlagHost = symbol | null;

interface Entry {
	readonly token: symbol;
	readonly store: object;
}

export class FlagOutlets {
	#stack = $state.raw<readonly Entry[]>([]);

	/** A modal with the flags of `store` opened (showModal) or came to the top again. */
	enter(token: symbol, store: object): void {
		const others = untrack(() => this.#stack.filter((entry) => entry.token !== token));
		this.#stack = [...others, { token, store }];
	}

	/** The modal closed or went away; without the flags it had, nothing happens. */
	leave(token: symbol): void {
		const stack = untrack(() => this.#stack);
		if (!stack.some((entry) => entry.token === token)) return;
		this.#stack = stack.filter((entry) => entry.token !== token);
	}

	/** Where the flags of `store` render: the topmost open modal with them, or null (the layout). */
	hostOf(store: object): FlagHost {
		return this.#stack.findLast((entry) => entry.store === store)?.token ?? null;
	}
}

/** The one stack of the page, as there is one top layer per document. */
export const flagOutlets = new FlagOutlets();
