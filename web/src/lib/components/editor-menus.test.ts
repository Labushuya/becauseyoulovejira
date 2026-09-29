// The "/" menu and the link popover of the editor (plan editor RT-4) in jsdom: "/" at the start of
// a line or after a blank opens the list in the top layer (SuggestionList), the text after it
// filters, arrows move the active option (aria-activedescendant on the textbox), Enter inserts,
// Escape closes and is consumed. Ctrl+K and the button "Link" open a popover (no dialog) with
// "Adresse" and "Text"; only http, https and mailto pass, errors stand at the field.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { TicketPickerSource } from '$lib/stores/ticket-picker.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { typeText, useProseMirrorStubs } from '$lib/test/prosemirror-stubs';
import RichTextEditorHarness from '$lib/test/RichTextEditorHarness.svelte';
import { fakePickerSource, pickerTicket } from '$lib/test/ticket-picker-fake';

useOverlayStubs();
useProseMirrorStubs();

async function setup(initial = '', picker?: TicketPickerSource) {
	const view = render(RichTextEditorHarness, { props: { initial, picker } });
	const element = await screen.findByRole('textbox', { name: 'Beschreibung' }, { timeout: 5000 });
	const editor = (element as HTMLElement & { editor: Editor }).editor;
	editor.commands.focus('end');
	return { ...view, element, editor, value: () => view.component.current() };
}

/** The list of the "/" menu (hidden for testing-library like every popover in jsdom). */
const menu = () => document.querySelector<HTMLElement>('[role="listbox"][aria-label="Blöcke"]');
const options = () =>
	within(menu()!)
		.queryAllByRole('option', { hidden: true })
		.map((option) => option.textContent?.trim());

describe('the "/" menu', () => {
	it('opens with "/" at the start of a line and points the textbox at the active option', async () => {
		const { element, editor } = await setup('');
		typeText(editor.view, '/');
		await tick();

		expect(menu()?.hidden).toBe(false);
		expect(menu()?.matches(':popover-open')).toBe(true);
		expect(options()).toHaveLength(10);
		expect(element.getAttribute('aria-autocomplete')).toBe('list');
		expect(element.getAttribute('aria-controls')).toBe(menu()?.id);
		const active = document.getElementById(element.getAttribute('aria-activedescendant') ?? '');
		expect(active?.textContent?.trim()).toBe('Überschrift 1');
		expect(active?.getAttribute('aria-selected')).toBe('true');
		expect(screen.getByText(/10 Blöcke, Pfeiltasten wählen/)).toBeTruthy();
	});

	it('filters by the text after "/" and inserts with Enter', async () => {
		const { element, editor, value } = await setup('');
		typeText(editor.view, '/zit');
		await tick();
		expect(options()).toEqual(['Zitat']);

		await fireEvent.keyDown(element, { key: 'Enter' });
		await tick();
		typeText(editor.view, 'Gesagt');
		expect(value()).toBe('> Gesagt');
		expect(menu()?.hidden).toBe(true);
		expect(element.getAttribute('aria-activedescendant')).toBeNull();
	});

	it('moves with the arrows and inserts the chosen block', async () => {
		const { element, editor, value } = await setup('');
		typeText(editor.view, '/über');
		await tick();
		await fireEvent.keyDown(element, { key: 'ArrowDown' });
		await fireEvent.keyDown(element, { key: 'ArrowDown' });
		await fireEvent.keyDown(element, { key: 'ArrowUp' });
		await tick();
		const active = document.getElementById(element.getAttribute('aria-activedescendant') ?? '');
		expect(active?.textContent?.trim()).toBe('Überschrift 2');

		await fireEvent.keyDown(element, { key: 'Tab' });
		typeText(editor.view, 'Titel');
		expect(value()).toBe('## Titel');
	});

	it('inserts with a click on an option', async () => {
		const { editor, value } = await setup('');
		typeText(editor.view, '/check');
		await tick();
		const option = within(menu()!).getByRole('option', { hidden: true, name: 'Checkliste' });
		await fireEvent.mouseDown(option);
		await fireEvent.click(option);
		typeText(editor.view, 'Brot');
		expect(value()).toBe('- [ ] Brot');
	});

	it('closes with Escape, which is consumed, and stays closed while typing on', async () => {
		const { element, editor, value } = await setup('');
		typeText(editor.view, '/zi');
		await tick();
		const outside = vi.fn();
		document.addEventListener('keydown', outside);
		await fireEvent.keyDown(element, { key: 'Escape' });
		document.removeEventListener('keydown', outside);
		await tick();

		expect(outside).not.toHaveBeenCalled();
		expect(menu()?.hidden).toBe(true);
		typeText(editor.view, 't');
		await tick();
		expect(menu()?.hidden).toBe(true);
		expect(value()).toBe('/zit');
	});

	it('does not open inside a word, after "/" in a word or in code', async () => {
		const { editor } = await setup('');
		typeText(editor.view, 'und/oder');
		await tick();
		expect(menu()?.hidden).toBe(true);

		typeText(editor.view, ' /');
		await tick();
		expect(menu()?.hidden).toBe(false);

		editor.commands.setContent('<pre><code>x</code></pre>');
		editor.commands.focus('end');
		typeText(editor.view, ' /');
		await tick();
		expect(menu()?.hidden).toBe(true);
	});

	it('closes when nothing matches, so Enter works as usual', async () => {
		const { element, editor } = await setup('');
		typeText(editor.view, '/xyz');
		await tick();
		expect(menu()?.hidden).toBe(true);
		expect(element.getAttribute('aria-controls')).toBeNull();
	});
});

describe('the link popover', () => {
	/**
	 * The popover of the link (a non-modal dialog). jsdom counts popovers as hidden, and hidden
	 * elements have no accessible name, so it is found by its label.
	 */
	function popover(): HTMLElement {
		const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label^="Link "]');
		if (dialog === null || !dialog.matches(':popover-open')) throw new Error('No link popover');
		return dialog;
	}

	it('opens with Ctrl+K on the selection and sets a link on it', async () => {
		const { element, editor, value } = await setup('Anleitung lesen');
		editor.commands.setTextSelection({ from: 1, to: 10 });
		await fireEvent.keyDown(element, { key: 'k', ctrlKey: true });
		await tick();

		const dialog = popover();
		expect(dialog.getAttribute('aria-label')).toBe('Link einfügen');
		const href = within(dialog).getByLabelText<HTMLInputElement>('Adresse');
		const text = within(dialog).getByLabelText<HTMLInputElement>('Text');
		await vi.waitFor(() => expect(document.activeElement).toBe(href));
		expect(text.value).toBe('Anleitung');
		expect(
			within(dialog).queryByRole('button', { hidden: true, name: 'Link entfernen' })
		).toBeNull();

		await fireEvent.input(href, { target: { value: 'example.com/hilfe' } });
		await fireEvent.submit(href.form!);
		await tick();

		expect(value()).toBe('[Anleitung](https://example.com/hilfe) lesen');
		expect(document.activeElement).toBe(element);
	});

	it('refuses addresses other than http, https and mailto at the field', async () => {
		const { element, editor, value } = await setup('Text');
		editor.commands.selectAll();
		await fireEvent.keyDown(element, { key: 'k', ctrlKey: true });
		const dialog = popover();
		const href = within(dialog).getByLabelText<HTMLInputElement>('Adresse');
		await fireEvent.input(href, { target: { value: 'javascript:alert(1)' } });
		await fireEvent.submit(href.form!);

		expect(href.getAttribute('aria-invalid')).toBe('true');
		const error = document.getElementById(href.getAttribute('aria-describedby') ?? '');
		expect(error?.textContent).toContain('Nur Adressen mit http://, https:// oder mailto:');
		expect(value()).toBe('Text');
	});

	it('edits and removes an existing link', async () => {
		const { element, editor, value } = await setup('[Hilfe](https://example.com/a) hier');
		editor.commands.setTextSelection(3);
		await fireEvent.keyDown(element, { key: 'k', ctrlKey: true });
		const dialog = popover();
		expect(within(dialog).getByText('Link bearbeiten')).toBeTruthy();
		expect(within(dialog).getByLabelText<HTMLInputElement>('Adresse').value).toBe(
			'https://example.com/a'
		);
		expect(within(dialog).getByLabelText<HTMLInputElement>('Text').value).toBe('Hilfe');

		await fireEvent.click(
			within(dialog).getByRole('button', { hidden: true, name: 'Link entfernen' })
		);
		expect(value()).toBe('Hilfe hier');
	});

	it('inserts the address as linked text without a selection', async () => {
		const { element, value } = await setup('');
		await fireEvent.keyDown(element, { key: 'k', ctrlKey: true });
		const href = within(popover()).getByLabelText<HTMLInputElement>('Adresse');
		await fireEvent.input(href, { target: { value: 'https://example.com' } });
		await fireEvent.submit(href.form!);
		expect(value()).toBe('<https://example.com>');
	});

	it('is the button "Link" of the toolbar with its shortcut, and "/link" opens it too', async () => {
		const { element, editor } = await setup('');
		const button = screen.getByRole('button', { name: 'Link' });
		expect(button.title).toBe('Link (Strg+K)');
		expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+K');
		expect(button.getAttribute('aria-haspopup')).toBe('dialog');

		typeText(editor.view, '/link');
		await tick();
		await fireEvent.keyDown(element, { key: 'Enter' });
		await tick();
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(editor.getText()).toBe('');
	});

	it('closes with Escape and puts the focus back into the text', async () => {
		const { element } = await setup('Text');
		await fireEvent.keyDown(element, { key: 'k', ctrlKey: true });
		const href = within(popover()).getByLabelText<HTMLInputElement>('Adresse');
		await fireEvent.keyDown(href, { key: 'Escape' });
		await tick();
		expect(screen.getByRole('button', { name: 'Link' }).getAttribute('aria-expanded')).toBe(
			'false'
		);
		expect(document.activeElement).toBe(element);
	});

	it('offers no ticket without the tickets of the app', async () => {
		const { element } = await setup('Text');
		await fireEvent.keyDown(element, { key: 'k', ctrlKey: true });
		expect(within(popover()).queryByLabelText('Oder ein Ticket')).toBeNull();
	});
});

describe('link to a ticket (ADR-0042)', () => {
	const ROOF = pickerTicket({ id: 'abc123def456ghi', key: 'HAUS-12', title: 'Dach prüfen' });

	function popover(): HTMLElement {
		const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label^="Link "]');
		if (dialog === null || !dialog.matches(':popover-open')) throw new Error('No link popover');
		return dialog;
	}

	async function chooseRoof(dialog: HTMLElement) {
		const picker = within(dialog).getByLabelText<HTMLInputElement>('Oder ein Ticket');
		// The list opens without typing.
		await fireEvent.focus(picker);
		expect(picker.getAttribute('aria-expanded')).toBe('true');
		const option = [...document.querySelectorAll<HTMLElement>('li[role="option"]')].find(
			(entry) => entry.querySelector('.key')?.textContent === 'HAUS-12'
		);
		await fireEvent.click(option as HTMLElement);
		return picker;
	}

	it('links a ticket chosen from the list with key and title as text', async () => {
		const { element, value } = await setup('', fakePickerSource({ open: [ROOF] }).source);
		await fireEvent.keyDown(element, { key: 'k', ctrlKey: true });
		const dialog = popover();
		await chooseRoof(dialog);
		const href = within(dialog).getByLabelText<HTMLInputElement>('Adresse');
		expect(href.value).toBe('/tickets/abc123def456ghi');
		expect(within(dialog).getByLabelText<HTMLInputElement>('Text').value).toBe(
			'HAUS-12 Dach prüfen'
		);
		await fireEvent.submit(href.form!);
		await tick();
		expect(value()).toBe('[HAUS-12 Dach prüfen](/tickets/abc123def456ghi)');
	});

	it('keeps the selected words as text and Escape closes only the list first', async () => {
		const { element, editor, value } = await setup(
			'Siehe Dach heute',
			fakePickerSource({ open: [ROOF] }).source
		);
		editor.commands.setTextSelection({ from: 7, to: 11 });
		await fireEvent.keyDown(element, { key: 'k', ctrlKey: true });
		const dialog = popover();
		const picker = within(dialog).getByLabelText<HTMLInputElement>('Oder ein Ticket');
		await fireEvent.focus(picker);
		await fireEvent.keyDown(picker, { key: 'Escape' });
		expect(picker.getAttribute('aria-expanded')).toBe('false');
		expect(dialog.matches(':popover-open')).toBe(true);
		await chooseRoof(dialog);
		expect(within(dialog).getByLabelText<HTMLInputElement>('Text').value).toBe('Dach');
		await fireEvent.submit(within(dialog).getByLabelText<HTMLInputElement>('Adresse').form!);
		await tick();
		expect(value()).toBe('Siehe [Dach](/tickets/abc123def456ghi) heute');
	});
});
