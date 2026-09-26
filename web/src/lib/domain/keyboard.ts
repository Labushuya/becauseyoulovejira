// Global keys (E4 plan, T-11; E3 plan section 10; plan EH-9 for `?`): `c` and Ctrl+K open the
// quick entry, `?` the modal "Tastaturkürzel", but never
// while the user types or works in something that has its own keys: input fields (the search
// and the tag picker included), a dialog or an open popover. Pure checks on the event and the
// document it happened in; no SvelteKit, no stores.

/** Elements whose keys belong to themselves. */
const OWN_KEYS = [
	'input',
	'textarea',
	'select',
	'[contenteditable]:not([contenteditable="false"])',
	'[role="combobox"]',
	'[role="textbox"]',
	'[role="searchbox"]',
	'[role="listbox"]',
	'[role="menu"]',
	'dialog',
	'[role="dialog"]',
	'[role="alertdialog"]',
	'[popover]'
].join(', ');

function matches(element: Element, selector: string): boolean {
	try {
		return element.matches(selector);
	} catch {
		// Runtimes without the selector (jsdom has no :popover-open) know no open popover.
		return false;
	}
}

/** True while a modal or open dialog or an open popover is shown in the document. */
function overlayOpen(document: Document): boolean {
	if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') !== null) {
		return true;
	}
	return [...document.querySelectorAll('[popover]')].some((element) =>
		matches(element, ':popover-open')
	);
}

/**
 * True if a key event belongs to what the user works in: its target is an input, a text area, a
 * select, an editable element, a combobox, a listbox or menu, or lies inside a dialog or a popover;
 * or a dialog or popover is open anywhere in the document.
 */
export function isTypingTarget(event: Pick<Event, 'target'>): boolean {
	const target = event.target;
	if (typeof Document !== 'undefined' && target instanceof Document) return overlayOpen(target);
	if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
	if (target.closest(OWN_KEYS) !== null) return true;
	if (target instanceof HTMLElement && target.isContentEditable) return true;
	return overlayOpen(target.ownerDocument);
}

/** The key opens the quick entry: `c` alone, or Ctrl+K (Cmd+K on a Mac keyboard). */
export function isQuickCaptureKey(
	event: Pick<
		KeyboardEvent,
		'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing'
	>
): boolean {
	if (event.repeat || event.isComposing) return false;
	const key = event.key.toLowerCase();
	if (key === 'k') return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
	return event.key === 'c' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
}

/**
 * The key opens the modal "Tastaturkürzel" (plan EH-9): the character `?`, whatever the layout
 * needs for it (Shift+ß on a German keyboard, Shift+/ on a US one). Shift is therefore allowed,
 * Ctrl, Alt and Cmd are not (AltGr combinations report Ctrl+Alt on Windows).
 */
export function isHelpKey(
	event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat' | 'isComposing'>
): boolean {
	if (event.repeat || event.isComposing) return false;
	return event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey;
}
