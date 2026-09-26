// Keyword list (ADR-0020; E4 plan package 20): adding with Enter or the button, field errors,
// removing with the focus on the input field, suggestions, and a failed save. Since package A:
// comma, pasted lists and Backspace in the empty field, with a live region.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import KeywordEditor from './KeywordEditor.svelte';

function renderEditor(keywords: string[] = [], result: string | null = null) {
	const onsave = vi.fn(async (next: string[], announcement: string) => {
		void next;
		void announcement;
		return result;
	});
	const view = render(KeywordEditor, {
		props: {
			keywords,
			name: 'Bot',
			description: 'Gesucht wird im Text.',
			emptyText: 'Keine Stichwörter.',
			onsave
		}
	});
	return { onsave, view };
}

describe('KeywordEditor', () => {
	it('shows the warning without keywords and the list with them', () => {
		renderEditor();
		// A compact warning (EH-10): tone "warning" with the hidden prefix, not a local notice.
		const warning = screen.getByText('Keine Stichwörter.').closest('[data-tone]');
		expect(warning?.getAttribute('data-tone')).toBe('warning');
		expect(warning?.classList.contains('compact')).toBe(true);
		expect(warning?.textContent).toMatch(/Achtung:/);
		expect(warning?.getAttribute('role')).toBeNull();
		expect(screen.getByRole('group', { name: 'Stichwörter' })).toBeTruthy();
		expect(
			screen.getByText(/Gesucht wird im Text\. Groß-\/Kleinschreibung egal, Umlaute auch\./)
		).toBeTruthy();
	});

	it('adds a keyword with Enter and trims it', async () => {
		const { onsave } = renderEditor(['todo']);
		const input = screen.getByLabelText('Neues Stichwort') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '  zu erledigen ' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(onsave).toHaveBeenCalledWith(
			['todo', 'zu erledigen'],
			'Stichwort „zu erledigen“ hinzugefügt.'
		);
		await vi.waitFor(() => expect(input.value).toBe(''));
	});

	it('refuses a duplicate with a field error and does not save', async () => {
		const { onsave } = renderEditor(['Prüfen']);
		const input = screen.getByLabelText('Neues Stichwort');
		await fireEvent.input(input, { target: { value: 'PRÜFEN' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
		expect(onsave).not.toHaveBeenCalled();
		expect(input.getAttribute('aria-invalid')).toBe('true');
		const error = document.getElementById(
			input.getAttribute('aria-describedby')?.split(' ')[0] ?? ''
		);
		expect(error?.textContent).toMatch(/Das Stichwort „Prüfen“ gibt es schon\./);
		expect(document.activeElement).toBe(input);
	});

	it('removes a keyword and moves the focus to the input field', async () => {
		const { onsave } = renderEditor(['todo', '#byl']);
		await fireEvent.click(screen.getByRole('button', { name: 'Stichwort „todo“ entfernen' }));
		expect(onsave).toHaveBeenCalledWith(['#byl'], 'Stichwort „todo“ entfernt.');
		expect(document.activeElement).toBe(screen.getByLabelText('Neues Stichwort'));
	});

	it('takes over the missing suggestions only', async () => {
		const { onsave } = renderEditor(['TODO']);
		await fireEvent.click(screen.getByRole('button', { name: 'Vorschläge übernehmen' }));
		expect(onsave).toHaveBeenCalledWith(
			['TODO', 'aufgabe', 'erledigen', 'ticket', '#byl'],
			'4 Vorschläge übernommen.'
		);
	});

	it('offers no suggestions when all are there', async () => {
		const { onsave } = renderEditor(['todo', 'aufgabe', 'erledigen', 'ticket', '#byl']);
		const button = screen.getByRole('button', { name: 'Vorschläge übernehmen' });
		expect(button.getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(button);
		expect(onsave).not.toHaveBeenCalled();
	});

	it('shows a failed save as an error and keeps the input', async () => {
		renderEditor([], 'Stichwörter: höchstens 50, je 1 bis 100 Zeichen, ohne Zeilenumbruch.');
		const input = screen.getByLabelText('Neues Stichwort') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'todo' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/höchstens 50/);
		expect(input.value).toBe('todo');
	});
});

/**
 * The editor with a parent that keeps the list: every successful save renders the new list, like
 * the stores of the pages do. `fail` makes every save answer with an error.
 */
function renderWithParent(start: string[], fail: string | null = null) {
	let list = [...start];
	const onsave = vi.fn(async (next: string[], announcement: string) => {
		void announcement;
		if (fail !== null) return fail;
		list = next;
		await view.rerender({ keywords: list });
		return null;
	});
	const view = render(KeywordEditor, {
		props: {
			keywords: list,
			name: 'Web.de',
			description: 'Gesucht wird im Betreff.',
			emptyText: 'Keine Stichwörter.',
			onsave
		}
	});
	const input = screen.getByLabelText('Neues Stichwort') as HTMLInputElement;
	const live = () => document.querySelector('[aria-live="polite"]')?.textContent ?? '';
	return { onsave, input, live, list: () => list };
}

/** Types `value` into the field with the caret at its end (or at `caret`). */
async function type(input: HTMLInputElement, value: string, caret = value.length) {
	await fireEvent.input(input, { target: { value } });
	input.setSelectionRange(caret, caret);
}

describe('KeywordEditor input: comma, paste, Backspace (package A)', () => {
	it('takes the text as keyword on a comma and empties the field', async () => {
		const { onsave, input, live, list } = renderWithParent(['todo']);
		await type(input, 'Europa-Go');
		const allowed = await fireEvent.keyDown(input, { key: ',' });
		expect(allowed).toBe(false);
		await vi.waitFor(() => expect(list()).toEqual(['todo', 'Europa-Go']));
		expect(onsave).toHaveBeenCalledWith(
			['todo', 'Europa-Go'],
			'Stichwort „Europa-Go“ hinzugefügt.'
		);
		await vi.waitFor(() => expect(input.value).toBe(''));
		await vi.waitFor(() => expect(live()).toBe('„Europa-Go“ übernommen.'));
		expect(screen.getByRole('list', { name: 'Stichwörter von „Web.de“' }).textContent).toMatch(
			/Europa-Go/
		);
	});

	it('keeps the text after the caret when the comma comes in the middle', async () => {
		const { onsave, input } = renderWithParent([]);
		await type(input, 'rechnung ticket', 8);
		await fireEvent.keyDown(input, { key: ',' });
		await vi.waitFor(() => expect(onsave).toHaveBeenCalledWith(['rechnung'], expect.any(String)));
		await vi.waitFor(() => expect(input.value).toBe(' ticket'));
	});

	it('does nothing on a comma in an empty field and never writes the comma', async () => {
		const { onsave, input } = renderWithParent(['todo']);
		expect(await fireEvent.keyDown(input, { key: ',' })).toBe(false);
		expect(onsave).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(input.value).toBe(''));
	});

	it('splits text with commas that got into the field and takes the rest on Enter', async () => {
		const { onsave, input, live, list } = renderWithParent([]);
		// Dropped or autocorrected text reaches the field without a comma key.
		await fireEvent.input(input, { target: { value: 'a, b ,, c' } });
		await vi.waitFor(() =>
			expect(onsave).toHaveBeenCalledWith(['a', 'b'], '2 Stichwörter hinzugefügt.')
		);
		await vi.waitFor(() => expect(input.value).toBe(' c'));
		await vi.waitFor(() => expect(live()).toBe('2 Stichwörter übernommen.'));
		await fireEvent.keyDown(input, { key: 'Enter' });
		await vi.waitFor(() => expect(list()).toEqual(['a', 'b', 'c']));
		await vi.waitFor(() => expect(input.value).toBe(''));
	});

	it('takes a pasted comma-separated list at once, its last part too', async () => {
		const { onsave, input } = renderWithParent([]);
		const allowed = await fireEvent.paste(input, {
			clipboardData: { getData: () => 'rechnung, todo\nticket' }
		});
		expect(allowed).toBe(false);
		await vi.waitFor(() =>
			expect(onsave).toHaveBeenCalledWith(
				['rechnung', 'todo', 'ticket'],
				'3 Stichwörter hinzugefügt.'
			)
		);
		await vi.waitFor(() => expect(input.value).toBe(''));
	});

	it('keeps refused parts of a pasted list in the field with the reason', async () => {
		const { onsave, input, live } = renderWithParent(['todo']);
		await fireEvent.paste(input, { clipboardData: { getData: () => 'TODO, neu' } });
		await vi.waitFor(() =>
			expect(onsave).toHaveBeenCalledWith(['todo', 'neu'], expect.any(String))
		);
		await vi.waitFor(() => expect(input.value).toBe('TODO'));
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(screen.getByText('Das Stichwort „todo“ gibt es schon.')).toBeTruthy();
		await vi.waitFor(() => expect(live()).toBe('„neu“ übernommen. 1 nicht übernommen.'));
	});

	it('keeps a pasted list in the field when saving fails', async () => {
		const { input } = renderWithParent([], 'Speichern fehlgeschlagen.');
		await fireEvent.paste(input, { clipboardData: { getData: () => 'rechnung, todo' } });
		expect(await screen.findByRole('alert')).toBeTruthy();
		expect(input.value).toBe('rechnung, todo');
	});

	it('keeps what was typed while the keyword was saved', async () => {
		let finish: (value: string | null) => void = () => undefined;
		const onsave = vi.fn(
			(next: string[], announcement: string) =>
				new Promise<string | null>((resolve) => {
					void next;
					void announcement;
					finish = resolve;
				})
		);
		render(KeywordEditor, {
			props: { keywords: [], name: 'Bot', description: 'x', emptyText: 'Keine.', onsave }
		});
		const input = screen.getByLabelText('Neues Stichwort') as HTMLInputElement;
		await type(input, 'todo');
		await fireEvent.keyDown(input, { key: ',' });
		await type(input, 'todore');
		finish(null);
		await vi.waitFor(() => expect(input.value).toBe('re'));
	});

	it('pastes text without a comma as usual', async () => {
		const { onsave, input } = renderWithParent([]);
		expect(await fireEvent.paste(input, { clipboardData: { getData: () => 'todo' } })).toBe(true);
		expect(onsave).not.toHaveBeenCalled();
	});

	it('treats a comma that came without a key like a typed one', async () => {
		const { onsave, input } = renderWithParent([]);
		await fireEvent.input(input, { target: { value: 'eins,zwei' } });
		await vi.waitFor(() => expect(onsave).toHaveBeenCalledWith(['eins'], expect.any(String)));
		await vi.waitFor(() => expect(input.value).toBe('zwei'));
	});

	it('brings the last keyword back into the empty field on Backspace, without losing a character', async () => {
		const { onsave, input, live, list } = renderWithParent(['todo', 'europa-go']);
		input.focus();
		expect(await fireEvent.keyDown(input, { key: 'Backspace' })).toBe(false);
		await vi.waitFor(() => expect(list()).toEqual(['todo']));
		expect(onsave).toHaveBeenCalledWith(
			['todo'],
			'Stichwort „europa-go“ zum Bearbeiten ins Feld geholt.'
		);
		expect(input.value).toBe('europa-go');
		expect(input.selectionStart).toBe('europa-go'.length);
		await vi.waitFor(() => expect(live()).toBe('„europa-go“ zum Bearbeiten im Feld.'));
		// Now the field has text: Backspace deletes characters as usual, nothing else happens.
		expect(await fireEvent.keyDown(input, { key: 'Backspace' })).toBe(true);
		expect(onsave).toHaveBeenCalledOnce();
	});

	it('takes nothing back on a held Backspace or without keywords', async () => {
		const held = renderWithParent(['todo']);
		expect(await fireEvent.keyDown(held.input, { key: 'Backspace', repeat: true })).toBe(false);
		expect(held.onsave).not.toHaveBeenCalled();
		expect(held.input.value).toBe('');
	});

	it('lets Backspace work normally in an empty field without keywords', async () => {
		const { onsave, input } = renderWithParent([]);
		expect(await fireEvent.keyDown(input, { key: 'Backspace' })).toBe(true);
		expect(onsave).not.toHaveBeenCalled();
	});

	it('empties the field again when taking back fails, so the keyword is not doubled', async () => {
		const { input } = renderWithParent(['todo'], 'Speichern fehlgeschlagen.');
		await fireEvent.keyDown(input, { key: 'Backspace' });
		expect(await screen.findByRole('alert')).toBeTruthy();
		await vi.waitFor(() => expect(input.value).toBe(''));
	});

	it('explains the keys next to the field and has a polite live region', () => {
		const { input } = renderWithParent([]);
		const described = (input.getAttribute('aria-describedby') ?? '')
			.split(' ')
			.map((id) => document.getElementById(id)?.textContent ?? '')
			.join(' ');
		expect(described).toMatch(/Komma oder Enter übernimmt das Stichwort/);
		expect(described).toMatch(/Rücktaste im\s+leeren Feld holt das letzte Stichwort/);
		const live = document.querySelector('[aria-live="polite"]');
		expect(live?.classList.contains('visually-hidden')).toBe(true);
	});
});

describe('one keyword editor for every list (package A)', () => {
	const SRC = resolve(import.meta.dirname, '..', '..');
	const read = (path: string) => readFileSync(resolve(SRC, path), 'utf8');

	it.each([
		'lib/components/channels/ChannelEditModal.svelte',
		'lib/components/channels/ChannelSetup.svelte',
		'lib/components/ImportKeywordsSection.svelte'
	])('%s uses KeywordEditor', (path) => {
		expect(read(path)).toMatch(/<KeywordEditor\b/);
		expect(read(path)).not.toMatch(/Neues Stichwort/);
	});
});
