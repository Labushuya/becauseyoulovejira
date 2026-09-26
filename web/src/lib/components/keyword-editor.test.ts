// Keyword list (ADR-0020; E4 plan package 20): adding with Enter or the button, field errors,
// removing with the focus on the input field, suggestions, and a failed save.

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
		expect(screen.getByText(/Gesucht wird im Text\. Groß- und Kleinschreibung/)).toBeTruthy();
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
