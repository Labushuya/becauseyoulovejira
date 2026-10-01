// Rules of the context menu of a row (plan aktionsmenues, AM-3): where the browser keeps its own
// menu (Ctrl, touch, selected text, fields, cell editors, real links) and where the row menu
// takes over (cells, buttons, check boxes, the link of the row itself); which keys open it.

import { afterEach, describe, expect, it } from 'vitest';
import {
	isMenuKey,
	keepsBrowserMenu,
	OPEN_MENU_EVENT,
	ROW_LINK_ATTRIBUTE,
	rowMenus
} from './context-menu';

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

describe('rowMenus', () => {
	// The open tickets below a row of the project list (ADR-0034, addendum "Offene Tickets in
	// Projekten") stand in a row of their own, whose entries are menu rows with their own "•••".
	it('opens only the menu of the row itself, never one of a row nested in it', () => {
		document.body.innerHTML =
			'<table><tbody>' +
			'<tr><td class="code">HAUS</td><td><button class="row-menu" data-menu="project">•••</button></td></tr>' +
			'<tr><td class="well"><p class="beside">Offene Tickets</p><ul>' +
			`<li data-menu-row><a href="/tickets/1" class="entry" ${ROW_LINK_ATTRIBUTE}>HAUS-1</a>` +
			'<button class="row-menu" data-menu="entry">•••</button></li>' +
			'</ul></td></tr>' +
			'</tbody></table>';
		const table = document.querySelector('table') as HTMLElement;
		const cleanup = rowMenus(table);
		const asked: string[] = [];
		for (const button of document.querySelectorAll<HTMLElement>('.row-menu')) {
			button.addEventListener(OPEN_MENU_EVENT, (event) => {
				asked.push(button.dataset.menu ?? '');
				event.preventDefault();
			});
		}
		const rightClick = (selector: string) => {
			const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
			at(selector).dispatchEvent(event);
			return event.defaultPrevented;
		};

		expect(rightClick('.entry')).toBe(true);
		expect(rightClick('.code')).toBe(true);
		expect(asked).toEqual(['entry', 'project']);
		// Beside the entries, in the row that holds them: the menu of the browser.
		expect(rightClick('.beside')).toBe(false);
		expect(rightClick('.well')).toBe(false);
		expect(asked).toEqual(['entry', 'project']);
		cleanup?.();
	});
});
