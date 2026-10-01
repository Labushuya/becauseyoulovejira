// Context menu of the rows of a table (plan aktionsmenues, AM-3; ADR-0036, addendum "Rechtsklick"):
// a right click on a row, Shift+F10 or the context menu key open the same menu as the button "•••"
// of the row (the `.row-menu` in it) instead of the menu of the browser: at the pointer, or below
// the focused element. The browser keeps its menu wherever it offers something the row menu does
// not: in fields to type into and in the editors of cells (popovers), on selected text, on real
// links (except the link that opens the row itself, whose ways the row menu offers), with Ctrl
// held (the way to the browser menu anywhere, e.g. "Untersuchen") and for touch (a long press
// selects text and previews links; "•••" stays the way there). A right click never chooses or
// opens the row: only the menu reacts to it. A tile of a grid (the project tiles, AM-5) is a row
// in this sense: it carries MENU_ROW_ATTRIBUTE, its link the mark of the row link.

import type { Attachment } from 'svelte/attachments';
import type { VirtualAnchor } from './position';

/** The button "•••" of a row; its ActionsMenu answers OPEN_MENU_EVENT. */
export const ROW_MENU = '.row-menu';
/** Marks the link that opens the row itself (title, "Öffnen"); it gets the row menu. */
export const ROW_LINK_ATTRIBUTE = 'data-row-link';
/** Marks an element outside a table that has a row menu, e.g. a tile of a grid. */
export const MENU_ROW_ATTRIBUTE = 'data-menu-row';
/** Asks the ActionsMenu of a button to open at another place; the detail is a MenuRequest. */
export const OPEN_MENU_EVENT = 'byl-open-menu';

export interface MenuRequest {
	/** At the pointer or below an element; null: below the button, as a click on it. */
	anchor: VirtualAnchor | null;
	/** Where the focus goes when the menu closes: the element focused before, else the button. */
	returnTo: HTMLElement | null;
}

/** What decides about a context menu besides its target. */
export interface ContextFacts {
	/** Ctrl held: the browser menu, anywhere. */
	ctrlKey: boolean;
	/** A long press on a touch screen. */
	touch: boolean;
	/** The target lies in selected text. */
	onSelection: boolean;
}

/** Input types that take no text; their browser menu offers nothing to type. */
const NO_TEXT = new Set([
	'button',
	'checkbox',
	'color',
	'file',
	'image',
	'radio',
	'range',
	'reset',
	'submit'
]);

/** A field to type into (its browser menu has paste, spelling and undo) or a select. */
function inField(target: Element): boolean {
	const field = target.closest(
		'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
	);
	if (field === null) return false;
	return !(field instanceof HTMLInputElement) || !NO_TEXT.has(field.type);
}

/** True if a context menu on `target` stays the one of the browser (the rules above). */
export function keepsBrowserMenu(target: Element, facts: ContextFacts): boolean {
	if (facts.ctrlKey || facts.touch || facts.onSelection) return true;
	if (target.closest('[popover]') !== null || inField(target)) return true;
	const link = target.closest('a[href]');
	return link !== null && !link.hasAttribute(ROW_LINK_ATTRIBUTE);
}

/** Shift+F10 or the context menu key (Ctrl is a fact of its own, see keepsBrowserMenu). */
export function isMenuKey(
	event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'metaKey'>
): boolean {
	if (event.altKey || event.metaKey) return false;
	return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

/** Whether `target` lies in text the user selected (partly is enough). */
function onSelectedText(target: Element): boolean {
	const selection = target.ownerDocument.getSelection();
	if (selection === null || selection.isCollapsed || selection.toString().trim() === '') {
		return false;
	}
	return selection.containsNode(target, true);
}

const MENU_ROW = `tr, [${MENU_ROW_ATTRIBUTE}]`;

/**
 * The button "•••" of the row (or tile) around `target`, null outside a row with a menu. Only a
 * button of that row itself counts, not one of a row nested in it: the open tickets below a row of
 * the project list stand in a row of their own, whose entries have their own menus (ADR-0034,
 * addendum "Offene Tickets in Projekten"), and a click beside them keeps the browser menu.
 */
function rowMenuOf(target: Element): HTMLElement | null {
	const row = target.closest(MENU_ROW);
	if (row === null) return null;
	for (const button of row.querySelectorAll<HTMLElement>(ROW_MENU)) {
		if (button.closest(MENU_ROW) === row) return button;
	}
	return null;
}

/** Asks the menu of `trigger` to open; false if no menu answered. */
function requestMenu(trigger: HTMLElement, request: MenuRequest): boolean {
	const event = new CustomEvent<MenuRequest>(OPEN_MENU_EVENT, {
		detail: request,
		cancelable: true
	});
	return !trigger.dispatchEvent(event);
}

/** The focused element, null when nothing is (the body). */
function focusedElement(page: Document): HTMLElement | null {
	const active = page.activeElement;
	return active instanceof HTMLElement && active !== page.body ? active : null;
}

/**
 * The context menus of the rows of a table, attached to the table (`{@attach rowMenus}`), or of the
 * tiles of a grid, attached to the grid: one set of listeners for all of them. A row (or tile)
 * takes part when it holds a `.row-menu`.
 */
export const rowMenus: Attachment<HTMLElement> = (table) => {
	const page = table.ownerDocument;
	/** The kind of the last pointer pressed in the table (Firefox has no pointerType here). */
	let lastPointer = '';

	const onpointerdown = (event: PointerEvent) => {
		lastPointer = event.pointerType;
	};

	const oncontextmenu = (event: MouseEvent) => {
		if (event.defaultPrevented || !(event.target instanceof Element)) return;
		const target = event.target;
		const trigger = rowMenuOf(target);
		if (trigger === null) return;
		const pointer =
			'pointerType' in event && typeof event.pointerType === 'string' && event.pointerType !== ''
				? event.pointerType
				: lastPointer;
		const facts = {
			ctrlKey: event.ctrlKey,
			touch: pointer === 'touch',
			onSelection: onSelectedText(target)
		};
		if (keepsBrowserMenu(target, facts)) return;
		const request: MenuRequest = {
			anchor: { point: { x: event.clientX, y: event.clientY } },
			returnTo: focusedElement(page)
		};
		if ((event.buttons & 2) === 0) {
			if (requestMenu(trigger, request)) event.preventDefault();
			return;
		}
		// The right button is still down (macOS and Linux open the menu on pressing): the light
		// dismiss of popovers on releasing it would close the menu at once, so it opens afterwards.
		event.preventDefault();
		const opener = () => setTimeout(() => requestMenu(trigger, request));
		page.defaultView?.addEventListener('pointerup', opener, { once: true, capture: true });
	};

	const onkeydown = (event: KeyboardEvent) => {
		if (event.defaultPrevented || !isMenuKey(event) || !(event.target instanceof HTMLElement)) {
			return;
		}
		const target = event.target;
		const trigger = rowMenuOf(target);
		if (trigger === null) return;
		const facts = { ctrlKey: event.ctrlKey, touch: false, onSelection: onSelectedText(target) };
		if (keepsBrowserMenu(target, facts)) return;
		const anchor = target === trigger ? null : { element: target };
		if (requestMenu(trigger, { anchor, returnTo: target })) event.preventDefault();
	};

	table.addEventListener('pointerdown', onpointerdown);
	table.addEventListener('contextmenu', oncontextmenu);
	table.addEventListener('keydown', onkeydown);
	return () => {
		table.removeEventListener('pointerdown', onpointerdown);
		table.removeEventListener('contextmenu', oncontextmenu);
		table.removeEventListener('keydown', onkeydown);
	};
};
