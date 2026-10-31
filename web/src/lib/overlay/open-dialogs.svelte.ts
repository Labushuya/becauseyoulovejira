// Whether a modal dialog is open anywhere in the document (round 2 of the package "Einschalten",
// E-1): the question of the first start of the phone view waits for every other dialog and sheet,
// also one the (app) layout does not own. Every modal of the app is a native <dialog> opened with
// showModal (Modal.svelte), so `dialog[open]` finds it, like the global keys do (domain/keyboard.ts);
// an element with role "dialog" and aria-modal counts as well. A dialog that holds an element with
// the attribute `except` is left out (the question itself). The document has no event for it, so a
// MutationObserver follows the attributes and added or removed elements, only while someone watches
// (the question is due); the cleanup stops it. Unwatched, `open` reads the document at once, so the
// first look after the question became due is never a stale one.

/** A modal dialog of the document: a <dialog> open, or an element that says it is one. */
export const OPEN_DIALOG_SELECTOR = 'dialog[open], [role="dialog"][aria-modal="true"]';

/** Whether a modal dialog is open in `document` now, other than one holding `[except]`. */
export function dialogOpen(document: Document, except?: string): boolean {
	return [...document.querySelectorAll(OPEN_DIALOG_SELECTOR)].some(
		(dialog) => except === undefined || dialog.querySelector(`[${except}]`) === null
	);
}

export class OpenDialogs {
	readonly #document: Document;
	readonly #except: string | undefined;
	/** What the observer saw last, while it watches. */
	#seen = $state(false);
	#watching = $state(false);

	/** The dialogs of `document`, leaving out one that holds `[except]`. */
	constructor(document: Document, except?: string) {
		this.#document = document;
		this.#except = except;
	}

	/** A modal dialog is open: as last seen while watched (reactive), else read from the document. */
	get open(): boolean {
		return this.#watching ? this.#seen : dialogOpen(this.#document, this.#except);
	}

	/** Follows opening, closing and removing of the dialogs; returns the cleanup. */
	watch(): () => void {
		const Observer = this.#document.defaultView?.MutationObserver;
		if (Observer === undefined) return () => undefined;
		const update = () => {
			this.#seen = dialogOpen(this.#document, this.#except);
		};
		update();
		const observer = new Observer(update);
		observer.observe(this.#document.documentElement, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ['open', 'role', 'aria-modal']
		});
		this.#watching = true;
		return () => {
			observer.disconnect();
			this.#watching = false;
		};
	}
}
