// Rules of the context menu of a row (plan aktionsmenues, AM-3): where the browser keeps its own
// menu (Ctrl, touch, selected text, fields, cell editors, real links) and where the row menu
// takes over (cells, buttons, check boxes, the link of the row itself); which keys open it.

import { afterEach, describe, expect, it } from 'vitest';
import { isMenuKey, keepsBrowserMenu, ROW_LINK_ATTRIBUTE } from './context-menu';

const NONE = { ctrlKey: false, touch: false, onSelection: false };

function row(html: string): HTMLElement {
	document.body.innerHTML = `<table><tbody><tr>${html}</tr></tbody></table>`;
	return document.querySelector('tr') as HTMLElement;
}

function at(selector: string): Element {
	return document.querySelector(selector) as Element;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('keepsBrowserMenu', () => {
	it('takes cells, buttons and check boxes for the row menu', () => {
		row(
			'<td class="key">TASK-1</td><td><button type="button" class="cell">Hoch</button></td>' +
				'<td><label><input type="checkbox" class="box" /></label></td>' +
				'<td><span class="icon"><svg><path /></svg></span></td>'
		);
		for (const selector of ['.key', '.cell', '.box', '.icon path']) {
			expect(keepsBrowserMenu(at(selector), NONE), selector).toBe(false);
		}
	});

	it('takes the link that opens the row itself, but leaves other links to the browser', () => {
		row(
			`<th><a href="/tickets/1" class="title" ${ROW_LINK_ATTRIBUTE}><span class="word">Fenster</span></a></th>` +
				'<td><a href="/tickets/2" class="other">TASK-2</a></td>'
		);
		expect(keepsBrowserMenu(at('.title'), NONE)).toBe(false);
		expect(keepsBrowserMenu(at('.word'), NONE)).toBe(false);
		expect(keepsBrowserMenu(at('.other'), NONE)).toBe(true);
	});

	it('leaves fields to type into and selects to the browser', () => {
		row(
			'<td><input type="text" class="text" /><input class="plain" /><input type="search" class="search" />' +
				'<textarea class="area"></textarea><select class="choice"><option>A</option></select>' +
				'<div contenteditable="true" class="editor"><p class="paragraph">Text</p></div>' +
				'<div contenteditable="false" class="fixed">fest</div></td>'
		);
		for (const selector of ['.text', '.plain', '.search', '.area', '.choice', '.paragraph']) {
			expect(keepsBrowserMenu(at(selector), NONE), selector).toBe(true);
		}
		expect(keepsBrowserMenu(at('.fixed'), NONE)).toBe(false);
	});

	it('leaves everything inside a popover to the browser (cell editors, the menu itself)', () => {
		row(
			'<td><div popover="auto"><button type="button" class="entry">Hoch</button>' +
				'<a href="/tickets/1" class="link" data-row-link>Öffnen</a></div></td>'
		);
		expect(keepsBrowserMenu(at('.entry'), NONE)).toBe(true);
		expect(keepsBrowserMenu(at('.link'), NONE)).toBe(true);
	});

	it.each([
		['Ctrl', { ...NONE, ctrlKey: true }],
		['touch', { ...NONE, touch: true }],
		['selected text', { ...NONE, onSelection: true }]
	])('leaves %s to the browser everywhere in the row', (_name, facts) => {
		row('<td class="key">TASK-1</td>');
		expect(keepsBrowserMenu(at('.key'), facts)).toBe(true);
	});
});

describe('isMenuKey', () => {
	const key = (init: Partial<KeyboardEvent>) =>
		isMenuKey({ key: '', shiftKey: false, altKey: false, metaKey: false, ...init });

	it('opens with Shift+F10 and the context menu key', () => {
		expect(key({ key: 'F10', shiftKey: true })).toBe(true);
		expect(key({ key: 'ContextMenu' })).toBe(true);
	});

	it('ignores F10 alone, other keys and Alt or Meta', () => {
		expect(key({ key: 'F10' })).toBe(false);
		expect(key({ key: 'Enter', shiftKey: true })).toBe(false);
		expect(key({ key: 'F10', shiftKey: true, altKey: true })).toBe(false);
		expect(key({ key: 'ContextMenu', metaKey: true })).toBe(false);
	});
});
