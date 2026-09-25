// Stand-ins for the dialog and popover APIs that jsdom lacks (ADR-0025; plan UI-Konsistenz,
// package UI-1). One place instead of the showModal copies in the component tests. Only what the
// overlay building blocks use: showModal/close with the close event, showPopover/hidePopover/
// togglePopover with the toggle event, the selector :popover-open and the popovertarget button.
// Browser behaviour beyond that (top layer, inert, light dismiss, layout) stays on the browser
// checklist of the test manifest.

import { afterAll, beforeAll } from 'vitest';

type ToggleState = 'open' | 'closed';

/** The toggle event of a popover, with the fields of ToggleEvent (jsdom has no ToggleEvent). */
function toggleEvent(oldState: ToggleState, newState: ToggleState): Event {
	const event = new Event('toggle');
	Object.defineProperties(event, {
		oldState: { value: oldState },
		newState: { value: newState }
	});
	return event;
}

/** Popovers the stand-in shows; :popover-open matches exactly these. */
const openPopovers = new WeakSet<Element>();

function showPopover(this: HTMLElement) {
	if (openPopovers.has(this)) return;
	if (this.getAttribute('popover') === 'auto') {
		// Only one auto popover at a time, as in the browser.
		for (const other of this.ownerDocument.querySelectorAll<HTMLElement>('[popover="auto"]')) {
			if (other !== this && openPopovers.has(other)) hidePopover.call(other);
		}
	}
	openPopovers.add(this);
	this.dispatchEvent(toggleEvent('closed', 'open'));
}

function hidePopover(this: HTMLElement) {
	if (!openPopovers.has(this)) return;
	openPopovers.delete(this);
	this.dispatchEvent(toggleEvent('open', 'closed'));
}

function togglePopover(this: HTMLElement, force?: boolean): boolean {
	const open = force ?? !openPopovers.has(this);
	if (open) showPopover.call(this);
	else hidePopover.call(this);
	return open;
}

/** A click on a button with popovertarget toggles its popover, as the browser does. */
function onDocumentClick(event: MouseEvent) {
	const target = event.target;
	if (!(target instanceof Element)) return;
	const invoker = target.closest('button[popovertarget]');
	if (invoker === null || (invoker as HTMLButtonElement).disabled) return;
	const popover = invoker.ownerDocument.getElementById(invoker.getAttribute('popovertarget') ?? '');
	if (popover !== null && popover.hasAttribute('popover')) togglePopover.call(popover);
}

/**
 * Installs the stand-ins on the prototypes of the current jsdom window. Methods the runtime
 * already has stay untouched. Returns a function that restores the previous state.
 */
export function installOverlayStubs(): () => void {
	const dialog = HTMLDialogElement.prototype;
	const element = HTMLElement.prototype;
	const saved = {
		showModal: dialog.showModal,
		close: dialog.close,
		showPopover: element.showPopover,
		hidePopover: element.hidePopover,
		togglePopover: element.togglePopover,
		matches: Element.prototype.matches
	};

	if (typeof saved.showModal !== 'function') {
		dialog.showModal = function (this: HTMLDialogElement) {
			this.open = true;
		};
	}
	if (typeof saved.close !== 'function') {
		dialog.close = function (this: HTMLDialogElement, returnValue?: string) {
			if (!this.open) return;
			if (returnValue !== undefined) this.returnValue = returnValue;
			this.open = false;
			this.dispatchEvent(new Event('close'));
		};
	}
	const popoverApi = typeof saved.showPopover !== 'function';
	if (popoverApi) {
		element.showPopover = showPopover;
		element.hidePopover = hidePopover;
		element.togglePopover = togglePopover;
		const matches = function (this: Element, selectors: string): boolean {
			if (selectors.trim() === ':popover-open') return openPopovers.has(this);
			return saved.matches.call(this, selectors);
		};
		Element.prototype.matches = matches as typeof Element.prototype.matches;
		document.addEventListener('click', onDocumentClick);
	}

	return () => {
		dialog.showModal = saved.showModal;
		dialog.close = saved.close;
		if (popoverApi) {
			element.showPopover = saved.showPopover;
			element.hidePopover = saved.hidePopover;
			element.togglePopover = saved.togglePopover;
			Element.prototype.matches = saved.matches;
			document.removeEventListener('click', onDocumentClick);
		}
	};
}

/** Installs the stand-ins for all tests of the calling file (beforeAll/afterAll). */
export function useOverlayStubs(): void {
	let restore: (() => void) | undefined;
	beforeAll(() => {
		restore = installOverlayStubs();
	});
	afterAll(() => restore?.());
}
