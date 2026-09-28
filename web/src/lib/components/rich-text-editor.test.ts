// The editor (ADR-0032, plan editor RT-3) in jsdom: it loads, names itself, writes Markdown only
// after a change, formats through toolbar, keys and input rules, switches to the source mode and
// back, opens texts it cannot hold in the source mode with a hint, keeps Escape and follows the
// toolbar pattern (Alt+F10, roving tabindex, arrows, Escape). Typing goes through handleTextInput
// (prosemirror-stubs.ts), since jsdom has no real input events.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { SHORTCUTS } from '$lib/domain/shortcuts';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { typeText, useProseMirrorStubs } from '$lib/test/prosemirror-stubs';
import { resize, useResizeObserverStub } from '$lib/test/resize-observer-stub';
import RichTextEditorHarness from '$lib/test/RichTextEditorHarness.svelte';

useOverlayStubs();
useProseMirrorStubs();
useResizeObserverStub();

/** The editable element once the editor has loaded. */
async function content(): Promise<HTMLElement> {
	return screen.findByRole('textbox', { name: 'Beschreibung' }, { timeout: 5000 });
}

function editorOf(element: HTMLElement): Editor {
	const editor = (element as HTMLElement & { editor?: Editor }).editor;
	if (editor === undefined) throw new Error('No Tiptap editor on the element');
	return editor;
}

async function setup(initial = '', options: { compact?: boolean; onsubmit?: () => void } = {}) {
	const view = render(RichTextEditorHarness, { props: { initial, ...options } });
	const element = await content();
	const editor = editorOf(element);
	return { ...view, element, editor, value: () => view.component.current() };
}

/** Presses a key combination on the editable element, as the browser sends it. */
async function press(
	element: HTMLElement,
	key: string,
	modifiers: Partial<KeyboardEventInit> = {}
) {
	await fireEvent.keyDown(element, { key, ...modifiers });
	await tick();
}

describe('RichTextEditor', () => {
	it('loads the editor with name, toolbar and the text as document', async () => {
		const { element, editor } = await setup('Belege **sammeln**');
		expect(element.getAttribute('aria-multiline')).toBe('true');
		expect(element.getAttribute('contenteditable')).toBe('true');
		expect(element.classList.contains('prose')).toBe(true);
		expect(editor.getHTML()).toBe('<p>Belege <strong>sammeln</strong></p>');
		const toolbar = screen.getByRole('toolbar', { name: 'Formatierung' });
		expect(toolbar.getAttribute('aria-controls')).toBe(element.id);
		for (const name of ['Fett', 'Kursiv', 'Unterstrichen', 'Durchgestrichen']) {
			expect(within(toolbar).getByRole('button', { name }).getAttribute('aria-pressed')).toBe(
				'false'
			);
		}
		expect(within(toolbar).getByRole('button', { name: 'Fett' }).title).toBe('Fett (Strg+B)');
		expect(
			within(toolbar).getByRole('button', { name: 'Fett' }).getAttribute('aria-keyshortcuts')
		).toBe('Control+B');
	});

	it('writes nothing while the text is only opened, even if it would be written differently', async () => {
		const initial = '_kursiv_ und * Stern\n\n* a\n* b';
		const { value, element } = await setup(initial);
		element.focus();
		await fireEvent.blur(element);
		expect(value()).toBe(initial);
	});

	it('formats with the toolbar and shows the state with aria-pressed', async () => {
		const { editor, value } = await setup('Text');
		editor.commands.selectAll();
		await fireEvent.click(screen.getByRole('button', { name: 'Fett' }));
		expect(value()).toBe('**Text**');
		expect(screen.getByRole('button', { name: 'Fett' }).getAttribute('aria-pressed')).toBe('true');

		await fireEvent.click(screen.getByRole('button', { name: 'Unterstrichen' }));
		expect(value()).toBe('**++Text++**');

		await fireEvent.click(screen.getByRole('button', { name: 'Checkliste' }));
		expect(value()).toBe('- [ ] **++Text++**');
		expect(screen.getByRole('button', { name: 'Checkliste' }).getAttribute('aria-pressed')).toBe(
			'true'
		);
	});

	it('chooses the text style in the menu', async () => {
		const { editor, value } = await setup('Titel');
		editor.commands.selectAll();
		const trigger = screen.getByRole('button', { name: 'Textstil: Normaler Text' });
		await fireEvent.click(trigger);
		await fireEvent.click(
			screen.getByRole('menuitemradio', { hidden: true, name: 'Überschrift 2' })
		);
		expect(value()).toBe('## Titel');
		expect(screen.getByRole('button', { name: 'Textstil: Überschrift 2' })).toBeTruthy();
	});

	it('removes the formatting and sets inline code in the menu "Weitere Formatierungen"', async () => {
		const { editor, value } = await setup('**fett** und *kursiv*');
		editor.commands.selectAll();
		await fireEvent.click(screen.getByRole('button', { name: 'Weitere Formatierungen' }));
		await fireEvent.click(
			screen.getByRole('menuitem', { hidden: true, name: 'Formatierung entfernen' })
		);
		expect(value()).toBe('fett und kursiv');

		editor.commands.selectAll();
		await fireEvent.click(screen.getByRole('button', { name: 'Weitere Formatierungen' }));
		await fireEvent.click(
			screen.getByRole('menuitemcheckbox', { hidden: true, name: 'Inline-Code' })
		);
		expect(value()).toBe('`fett und kursiv`');
	});

	it.each([
		['editor-bold', '**Text**'],
		['editor-italic', '*Text*'],
		['editor-underline', '++Text++'],
		['editor-strike', '~~Text~~'],
		['editor-code', '`Text`'],
		['editor-heading-1', '# Text'],
		['editor-heading-2', '## Text'],
		['editor-heading-3', '### Text'],
		['editor-bullet-list', '- Text'],
		['editor-ordered-list', '1. Text'],
		['editor-task-list', '- [ ] Text'],
		['editor-quote', '> Text'],
		['editor-code-block', '```\nText\n```']
	])('takes the shortcut %s from the list of shortcuts', async (id, markdown) => {
		const shortcut = SHORTCUTS.find((entry) => entry.id === id);
		const combination = shortcut?.keys[0] ?? [];
		const key = combination.at(-1) ?? '';
		const { element, editor, value } = await setup('Text');
		editor.commands.selectAll();
		await press(element, /^\d$/.test(key) || key.length > 1 ? key : key.toLowerCase(), {
			ctrlKey: combination.includes('Strg'),
			shiftKey: combination.includes('Umschalt'),
			altKey: combination.includes('Alt'),
			code: /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`
		});
		expect(value()).toBe(markdown);
	});

	it.each([
		['## Titel', '## Titel'],
		['- Punkt', '- Punkt'],
		['* Punkt', '- Punkt'],
		['1. Eins', '1. Eins'],
		['[ ] Aufgabe', '- [ ] Aufgabe'],
		['[x] Erledigt', '- [x] Erledigt'],
		['> Zitat', '> Zitat'],
		['**fett** ', '**fett**'],
		['*kursiv* ', '*kursiv*'],
		['~~weg~~ ', '~~weg~~'],
		['`code` ', '`code`'],
		['++unter++ ', '++unter++']
	])('turns "%s" into formatting while typing', async (typed, markdown) => {
		const { editor, value } = await setup('');
		editor.commands.focus('end');
		typeText(editor.view, typed);
		expect(value().trim()).toBe(markdown);
	});

	it('turns "---" and "```" into a divider and a code block while typing', async () => {
		const { editor, value } = await setup('');
		editor.commands.focus('end');
		typeText(editor.view, '---');
		expect(value()).toContain('---');
		expect(editor.getHTML()).toContain('<hr>');

		editor.commands.setContent('<p></p>');
		editor.commands.focus('end');
		typeText(editor.view, '``` ');
		expect(editor.isActive('codeBlock')).toBe(true);
	});

	it('ticks a task in the document, which changes the draft', async () => {
		const { element, value } = await setup('- [ ] Brot');
		const box = within(element).getByRole<HTMLInputElement>('checkbox', { name: 'Brot' });
		await fireEvent.click(box);
		expect(value()).toBe('- [x] Brot');
	});

	it('switches to the source mode and back', async () => {
		const { value } = await setup('**fett**');
		const toggle = screen.getByRole('button', { name: 'Markdown' });
		expect(toggle.getAttribute('aria-pressed')).toBe('false');
		await fireEvent.click(toggle);

		const textarea = await screen.findByLabelText<HTMLTextAreaElement>('Beschreibung (Markdown)');
		expect(textarea.value).toBe('**fett**');
		expect(document.activeElement).toBe(textarea);
		expect(screen.getByRole('button', { name: 'Markdown' }).getAttribute('aria-pressed')).toBe(
			'true'
		);
		expect(screen.queryByRole('button', { name: 'Fett' })).toBeNull();
		await fireEvent.input(textarea, { target: { value: '# Neu' } });
		expect(value()).toBe('# Neu');

		await fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));
		const element = await content();
		expect(editorOf(element).getHTML()).toBe('<h1>Neu</h1>');
		await vi.waitFor(() => expect(document.activeElement).toBe(element));
		expect(value()).toBe('# Neu');
	});

	it.each([
		['a table', '| a | b |\n|---|---|\n| 1 | 2 |', 'Gefunden: eine Tabelle.'],
		[
			'a mixed list',
			'- [ ] Aufgabe\n- Punkt',
			'Gefunden: eine Liste aus Aufgaben und normalen Punkten.'
		]
	])('opens a text with %s in the source mode with a hint', async (_name, initial, detail) => {
		render(RichTextEditorHarness, { props: { initial } });
		const textarea = await screen.findByLabelText<HTMLTextAreaElement>(
			'Beschreibung (Markdown)',
			{},
			{ timeout: 5000 }
		);
		expect(textarea.value).toBe(initial);
		const hint = screen.getByText(/nur als Markdown bearbeitet werden können/);
		expect(hint.textContent).toContain(detail);
		expect(textarea.getAttribute('aria-describedby')).toContain(hint.id);

		// Back to the editor fails as long as the text holds it; the hint stays.
		await fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));
		expect(screen.getByLabelText('Beschreibung (Markdown)')).toBe(textarea);
		expect(screen.getByText(/nur als Markdown bearbeitet werden können/)).toBeTruthy();
	});

	it('replaces the document when the value changes from outside', async () => {
		const { component, editor } = await setup('alt');
		component.setValue('**neu**');
		await tick();
		expect(editor.getHTML()).toBe('<p><strong>neu</strong></p>');
	});

	it('consumes Escape, so panel and full view stay open', async () => {
		const { element } = await setup('Text');
		const outside = vi.fn();
		document.addEventListener('keydown', outside);
		const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		element.dispatchEvent(event);
		document.removeEventListener('keydown', outside);
		expect(event.defaultPrevented).toBe(true);
		expect(outside).not.toHaveBeenCalled();
	});

	it('sends with Ctrl+Enter and inserts no line break then', async () => {
		const onsubmit = vi.fn();
		const { element, value, editor } = await setup('Text', { onsubmit });
		editor.commands.focus('end');
		typeText(editor.view, ' mehr');
		await press(element, 'Enter', { ctrlKey: true });
		expect(onsubmit).toHaveBeenCalledOnce();
		expect(value()).toBe('Text mehr');
	});

	it('goes to the toolbar with Alt+F10, moves with the arrows and back with Escape', async () => {
		const { element } = await setup('Text');
		element.focus();
		await press(element, 'F10', { altKey: true });
		const toolbar = screen.getByRole('toolbar', { name: 'Formatierung' });
		const style = within(toolbar).getByRole('button', { name: 'Textstil: Normaler Text' });
		await vi.waitFor(() => expect(document.activeElement).toBe(style));
		const stops = [...toolbar.querySelectorAll<HTMLElement>('.tool')].filter(
			(item) => item.closest('[popover]') === null && item.tabIndex === 0
		);
		expect(stops).toEqual([style]);

		await fireEvent.keyDown(style, { key: 'ArrowRight' });
		const bold = within(toolbar).getByRole('button', { name: 'Fett' });
		expect(document.activeElement).toBe(bold);
		expect(bold.tabIndex).toBe(0);
		expect(style.tabIndex).toBe(-1);
		await fireEvent.keyDown(bold, { key: 'End' });
		expect(document.activeElement).toBe(within(toolbar).getByRole('button', { name: 'Markdown' }));
		await fireEvent.keyDown(document.activeElement!, { key: 'Home' });
		expect(document.activeElement).toBe(style);

		await fireEvent.keyDown(style, { key: 'Escape' });
		await vi.waitFor(() => expect(document.activeElement).toBe(element));
	});

	it('puts lists and blocks into the menu "Listen und Blöcke" where the toolbar is narrow', async () => {
		const { editor, value } = await setup('Text');
		const toolbar = screen.getByRole('toolbar', { name: 'Formatierung' });
		resize(toolbar, 420);
		await tick();
		expect(within(toolbar).queryByRole('button', { name: 'Aufzählung' })).toBeNull();
		editor.commands.selectAll();
		await fireEvent.click(within(toolbar).getByRole('button', { name: 'Listen und Blöcke' }));
		await fireEvent.click(
			screen.getByRole('menuitemcheckbox', { hidden: true, name: 'Aufzählung' })
		);
		expect(value()).toBe('- Text');

		resize(toolbar, 800);
		await tick();
		expect(within(toolbar).getByRole('button', { name: 'Aufzählung' })).toBeTruthy();
	});

	it('leaves out the text style in the compact editor', async () => {
		await setup('', { compact: true });
		expect(screen.queryByRole('button', { name: /^Textstil/ })).toBeNull();
		expect(screen.getByRole('button', { name: 'Fett' })).toBeTruthy();
	});

	it('shows the placeholder in an empty document and the counter near the limit', async () => {
		const { element } = await setup('');
		expect(element.querySelector('p')?.getAttribute('data-placeholder')).toBe(
			'Beschreibung eingeben …'
		);
		render(RichTextEditorHarness, { props: { initial: 'x'.repeat(950), maxlength: 1000 } });
		expect(await screen.findByText('950 von 1.000 Zeichen')).toBeTruthy();
	});
});
