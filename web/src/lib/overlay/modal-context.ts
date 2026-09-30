// No dialog from a dialog (ADR-0025 section 3 and its addendum 16): every modal (Modal.svelte,
// and with it the confirmation and the full view) marks the components below it. A component that
// would open a dialog asks `insideModal()` and shows its form or question inline instead. A modal
// that opens below another one anyway is a mistake of the code: `reportNestedModal` throws in the
// tests (vitest runs with mode "test"), so every component test that reaches such a place fails,
// and only logs in the app, where the dialog still opens rather than leaving the user stuck.

import { createContext } from 'svelte';

/** What a modal tells the components below it. */
export interface ModalContext {
	/** Title of the modal, for the report of a nested one. */
	readonly title: string;
}

const [getModalContext, setModalContext, hasModalContext] = createContext<ModalContext>();

/** Marks the components below the calling modal. Call during the initialisation of the modal. */
export function provideModalContext(context: ModalContext): void {
	setModalContext(context);
}

/** The modal the calling component renders in, or null. Call during component initialisation. */
export function enclosingModal(): ModalContext | null {
	return hasModalContext() ? getModalContext() : null;
}

/**
 * Whether the calling component renders inside a modal (the full view included): it must not
 * open a dialog of its own but show its form or question inline. Call during initialisation.
 */
export function insideModal(): boolean {
	return hasModalContext();
}

/** A modal that opened inside another modal (ADR-0025 section 3). */
export class NestedModalError extends Error {
	override name = 'NestedModalError';
}

/** Throw (tests) or log (app); the default follows the mode of Vite. */
export function nestedModalIsStrict(): boolean {
	return import.meta.env.MODE === 'test';
}

/** What the app writes to the console of the browser: no titles, so no content of tickets. */
export const NESTED_MODAL_LOG =
	'Kein Dialog aus einem Dialog (ADR-0025 §3): ein Modal öffnet in einem anderen.';

/**
 * Reports a modal `inner` that opens inside the modal `outer`: throws NestedModalError with both
 * titles when `strict` (tests), otherwise writes NESTED_MODAL_LOG to the console of the browser.
 */
export function reportNestedModal(
	inner: string,
	outer: string,
	strict: boolean = nestedModalIsStrict()
): void {
	if (strict) {
		throw new NestedModalError(
			`Kein Dialog aus einem Dialog (ADR-0025 §3): „${inner}“ öffnet in „${outer}“.`
		);
	}
	// eslint-disable-next-line no-console -- the one report of a code mistake; a fixed text without tokens, session or content
	console.error(NESTED_MODAL_LOG);
}
