// Closing rules of the modal building block (ADR-0025 section 3): one pure decision for every
// way to close, so all modals behave alike and the table is tested without a browser.

/**
 * escape: the Escape key (or the cancel event of the browser); blanket: a click on the veil;
 * close-button: the × in the header; cancel: "Abbrechen" or "Schließen" in the footer.
 */
export type CloseTrigger = 'escape' | 'blanket' | 'close-button' | 'cancel';

/**
 * close: close now; ask: show the question "Änderungen verwerfen?" in place of the footer;
 * resume: leave the question and keep editing; ignore: nothing happens.
 */
export type CloseAction = 'close' | 'ask' | 'resume' | 'ignore';

export interface CloseState {
	/** Unsaved input in the modal. */
	dirty: boolean;
	/** An action runs; the modal must stay. */
	busy: boolean;
	/** The question "Änderungen verwerfen?" is shown. */
	asking: boolean;
}

/**
 * What a trigger does in a state. While busy nothing closes. Unsaved input asks first, and a
 * click on the veil is ignored then (protection against a stray click). While the question is
 * shown, Escape, × and "Abbrechen" mean "Weiter bearbeiten".
 */
export function closeAction(trigger: CloseTrigger, state: CloseState): CloseAction {
	if (state.busy) return 'ignore';
	if (state.asking) return trigger === 'blanket' ? 'ignore' : 'resume';
	if (!state.dirty) return 'close';
	return trigger === 'blanket' ? 'ignore' : 'ask';
}
