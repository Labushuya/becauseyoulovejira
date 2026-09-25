// Global keys (E4 plan, T-11 and package 6): `c` and Ctrl+K open the quick entry, but not in input
// fields, the tag picker, the search, dialogs and open popovers.

import { afterEach, describe, expect, it } from 'vitest';
import { isQuickCaptureKey, isTypingTarget } from './keyboard';

function key(overrides: Partial<KeyboardEvent> = {}) {
	return {
		key: 'c',
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		repeat: false,
		isComposing: false,
		...overrides
	};
}

function place(html: string): HTMLElement {
	document.body.innerHTML = html;
	const target = document.querySelector<HTMLElement>('[data-target]');
	if (target === null) throw new Error('no target');
	return target;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('isQuickCaptureKey', () => {
	it('takes c alone and Ctrl+K or Cmd+K', () => {
		expect(isQuickCaptureKey(key())).toBe(true);
		expect(isQuickCaptureKey(key({ key: 'k', ctrlKey: true }))).toBe(true);
		expect(isQuickCaptureKey(key({ key: 'K', ctrlKey: true }))).toBe(true);
		expect(isQuickCaptureKey(key({ key: 'k', metaKey: true }))).toBe(true);
	});

	it('refuses other combinations, repeats and composition', () => {
		expect(isQuickCaptureKey(key({ key: 'C', shiftKey: true }))).toBe(false);
		expect(isQuickCaptureKey(key({ ctrlKey: true }))).toBe(false);
		expect(isQuickCaptureKey(key({ altKey: true }))).toBe(false);
		expect(isQuickCaptureKey(key({ key: 'k' }))).toBe(false);
		expect(isQuickCaptureKey(key({ key: 'k', ctrlKey: true, shiftKey: true }))).toBe(false);
		expect(isQuickCaptureKey(key({ key: 'k', ctrlKey: true, altKey: true }))).toBe(false);
		expect(isQuickCaptureKey(key({ repeat: true }))).toBe(false);
		expect(isQuickCaptureKey(key({ isComposing: true }))).toBe(false);
		expect(isQuickCaptureKey(key({ key: 'x' }))).toBe(false);
	});
});

describe('isTypingTarget', () => {
	it.each([
		['a text input', '<input data-target type="text" />'],
		['the search field', '<input data-target type="search" />'],
		['a checkbox', '<input data-target type="checkbox" />'],
		['a text area', '<textarea data-target></textarea>'],
		['a select', '<select data-target><option>a</option></select>'],
		['the tag picker', '<input data-target role="combobox" aria-expanded="false" />'],
		['an option of the tag picker', '<ul role="listbox"><li data-target role="option">a</li></ul>'],
		['an editable element', '<div data-target contenteditable="true">x</div>'],
		['a button in a dialog', '<dialog open><button data-target>OK</button></dialog>'],
		['a button in a popover', '<div popover="auto"><button data-target>OK</button></div>']
	])('is true for %s', (_name, html) => {
		expect(isTypingTarget({ target: place(html) })).toBe(true);
	});

	it.each([
		['the page', '<main data-target></main>'],
		['a button', '<button data-target>Gruppieren</button>'],
		['a link', '<a data-target href="/x">x</a>'],
		['a closed dialog elsewhere', '<dialog></dialog><button data-target>x</button>'],
		['a switched-off editable element', '<div data-target contenteditable="false">x</div>']
	])('is false for %s', (_name, html) => {
		expect(isTypingTarget({ target: place(html) })).toBe(false);
	});

	it('is true while a dialog is open elsewhere in the document', () => {
		const target = place('<button data-target>x</button><dialog open><p>Frage</p></dialog>');
		expect(isTypingTarget({ target })).toBe(true);
		expect(isTypingTarget({ target: document })).toBe(true);
	});

	it('is true while a popover is open elsewhere in the document', () => {
		const target = place('<button data-target>x</button><div popover="auto" id="p">a</div>');
		const popover = document.getElementById('p') as HTMLElement;
		expect(isTypingTarget({ target })).toBe(false);
		Object.defineProperty(popover, 'matches', {
			value: (selector: string) => selector === ':popover-open'
		});
		expect(isTypingTarget({ target })).toBe(true);
	});

	it('is false for targets that are no element and without overlays', () => {
		expect(isTypingTarget({ target: null })).toBe(false);
		expect(isTypingTarget({ target: window })).toBe(false);
		expect(isTypingTarget({ target: document })).toBe(false);
	});
});
