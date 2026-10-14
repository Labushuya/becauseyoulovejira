// The shared stand-ins for dialog and popover in jsdom (plan UI-Konsistenz, package UI-1): they
// behave like the browser API as far as the overlay building blocks rely on it, and they leave
// the prototypes as they were.

import { afterEach, describe, expect, it } from 'vitest';
import { OPEN_ATTRIBUTE, installOverlayStubs } from './overlay-stubs';

let restore: (() => void) | undefined;

afterEach(() => {
	restore?.();
	restore = undefined;
	document.body.innerHTML = '';
});

function popover(id: string, kind = 'auto'): HTMLElement {
	const element = document.createElement('div');
	element.id = id;
	element.setAttribute('popover', kind);
	document.body.append(element);
	return element;
}

function toggles(element: HTMLElement): string[] {
	const seen: string[] = [];
	element.addEventListener('toggle', (event) => {
		const { oldState, newState } = event as Event & { oldState: string; newState: string };
		seen.push(`${oldState}>${newState}`);
	});
	return seen;
}

describe('overlay stubs', () => {
	it('opens and closes a dialog with a close event', () => {
		restore = installOverlayStubs();
		const dialog = document.createElement('dialog');
		document.body.append(dialog);
		let closed = 0;
		dialog.addEventListener('close', () => closed++);

		dialog.showModal();
		expect(dialog.open).toBe(true);
		dialog.close('ok');
		expect(dialog.open).toBe(false);
		expect(dialog.returnValue).toBe('ok');
		dialog.close();
		expect(closed).toBe(1);
	});

	it('shows, hides and toggles a popover with toggle events and :popover-open', () => {
		restore = installOverlayStubs();
		const element = popover('menu');
		const seen = toggles(element);

		element.showPopover();
		expect(element.matches(':popover-open')).toBe(true);
		element.showPopover();
		expect(element.togglePopover()).toBe(false);
		expect(element.matches(':popover-open')).toBe(false);
		element.hidePopover();

		expect(seen).toEqual(['closed>open', 'open>closed']);
		expect(element.matches('div')).toBe(true);
	});

	// DEP-2: jsdom hides every popover by its default stylesheet and, since 30.1.2, focus() skips
	// hidden elements; focus has to reach the content of an open popover, as in the browser.
	it('shows an open popover and hides a closed one, so focus reaches only the open one', () => {
		restore = installOverlayStubs();
		const element = popover('panel');
		const button = document.createElement('button');
		button.textContent = 'Übernehmen';
		element.append(button);
		const display = () => getComputedStyle(element).display;

		expect(display()).toBe('none');
		element.showPopover();
		expect(display()).toBe('block');
		button.focus();
		expect(document.activeElement).toBe(button);

		element.hidePopover();
		expect(display()).toBe('none');
		element.togglePopover();
		expect(display()).toBe('block');
	});

	it('keeps only one auto popover open, as the browser does', () => {
		restore = installOverlayStubs();
		const first = popover('first');
		const second = popover('second');
		const manual = popover('manual', 'manual');

		manual.showPopover();
		first.showPopover();
		second.showPopover();

		expect(first.matches(':popover-open')).toBe(false);
		expect(second.matches(':popover-open')).toBe(true);
		expect(manual.matches(':popover-open')).toBe(true);
		expect([first, second, manual].map((element) => getComputedStyle(element).display)).toEqual([
			'none',
			'block',
			'block'
		]);
	});

	it('toggles the popover of a button with popovertarget on click', () => {
		restore = installOverlayStubs();
		const element = popover('panel');
		const button = document.createElement('button');
		button.setAttribute('popovertarget', 'panel');
		button.innerHTML = '<span>Öffnen</span>';
		document.body.append(button);

		button.querySelector('span')?.click();
		expect(element.matches(':popover-open')).toBe(true);
		button.click();
		expect(element.matches(':popover-open')).toBe(false);
	});

	it('restores the prototypes of jsdom', () => {
		const before = {
			showModal: HTMLDialogElement.prototype.showModal,
			showPopover: HTMLElement.prototype.showPopover,
			matches: Element.prototype.matches,
			styles: document.head.querySelectorAll('style').length
		};
		const shown = popover('shown');
		const undo = installOverlayStubs();
		shown.showPopover();
		undo();

		expect(HTMLDialogElement.prototype.showModal).toBe(before.showModal);
		expect(HTMLElement.prototype.showPopover).toBe(before.showPopover);
		expect(Element.prototype.matches).toBe(before.matches);
		expect(document.head.querySelectorAll('style')).toHaveLength(before.styles);
		expect(shown.hasAttribute(OPEN_ATTRIBUTE)).toBe(false);
		const element = popover('after');
		const button = document.createElement('button');
		button.setAttribute('popovertarget', 'after');
		document.body.append(button);
		button.click();
		expect(element.matches(':popover-open')).toBe(false);
	});
});
