// A tap on a card of a list in the phone frame (MO-3 "Aufgaben", MO-6 "Eingang"; ADR-0073): a tap on
// the card outside of its controls is a shortcut for its title link (or, while choosing, for its box
// of the selection), like the click on a row of the table. The controls of the card handle their own
// taps; a modifier key, another mouse button or text selected on the card leave it alone.

/** The controls of a card that handle their own taps. */
const CONTROLS = 'a, button, input, select, textarea, label, [popover]';

/** Whether a click on a card is a tap on the card itself, not on one of its controls. */
export function isCardTap(event: MouseEvent): boolean {
	if (event.defaultPrevented || event.button !== 0) return false;
	if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
	if (event.target instanceof Element && event.target.closest(CONTROLS)) return false;
	// Selecting text on the card does not open it.
	return (window.getSelection()?.toString() ?? '') === '';
}
