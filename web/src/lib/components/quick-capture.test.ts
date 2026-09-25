// Component tests of the quick entry and the clipboard dialog (E4 plan, package 6; OF-E4-3): preview
// of the short syntax, Enter creates a ticket, Alt+Enter puts the line into the inbox, result with
// link, empty title, archived project hint, Escape; the clipboard dialog with one entry or one per
// line, the limit of 100 lines and failures per entry.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { InboxDraft } from '$lib/domain/inbox';
import type { QuickEntry } from '$lib/domain/quick-syntax';
import type { CaptureTarget } from '$lib/domain/templates';
import type { ProjectRef, TagRef } from '$lib/domain/ticket';
import type { CaptureSaveResult, DraftsOutcome } from '$lib/stores/capture';
import ClipboardImport from './ClipboardImport.svelte';
import QuickCapture from './QuickCapture.svelte';

const nativeDialog = {
	showModal: HTMLDialogElement.prototype.showModal,
	close: HTMLDialogElement.prototype.close
};

beforeAll(() => {
	if (typeof nativeDialog.showModal !== 'function') {
		HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
			this.open = true;
		};
	}
	if (typeof nativeDialog.close !== 'function') {
		HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
			this.open = false;
		};
	}
});

afterAll(() => {
	HTMLDialogElement.prototype.showModal = nativeDialog.showModal;
	HTMLDialogElement.prototype.close = nativeDialog.close;
});

const HOUSE: ProjectRef = {
	id: 'proj00000000001',
	name: 'Haushalt',
	code: 'HAUS',
	archived: false
};
const OLD: ProjectRef = { id: 'proj00000000003', name: 'Altbau', code: 'ALT', archived: true };
const CALL: TagRef = { id: 'tag000000000001', name: 'Anruf' };

function renderQuick() {
	const onsave = vi.fn(
		async (_entry: QuickEntry, target: CaptureTarget): Promise<CaptureSaveResult> =>
			target === 'ticket'
				? { ok: true, target, id: 'tick00000000001', message: 'Ticket HAUS-2 angelegt.' }
				: { ok: true, target, id: 'item00000000001', message: '„Idee“ liegt im Eingang.' }
	);
	const onclose = vi.fn();
	const resultHref = (target: CaptureTarget, id: string) =>
		`/${target === 'ticket' ? 'tickets' : 'eingang'}/${id}` as ResolvedPathname;
	render(QuickCapture, {
		props: { projects: [HOUSE, OLD], tags: [CALL], onsave, onclose, resultHref }
	});
	const input = screen.getByLabelText<HTMLInputElement>('Titel mit Kurzsyntax');
	return { onsave, onclose, input };
}

describe('quick capture', () => {
	it('opens as modal dialog with the focus in the field', async () => {
		const { input } = renderQuick();
		await tick();
		const dialog = screen.getByRole('dialog', { name: 'Schnellerfassung' }) as HTMLDialogElement;
		expect(dialog.open).toBe(true);
		expect(document.activeElement).toBe(input);
		expect(input.getAttribute('aria-describedby')).toMatch(/preview/);
	});

	it('previews what the short syntax recognised', async () => {
		const { input } = renderQuick();
		await fireEvent.input(input, { target: { value: 'Zahnarzt @haus !hoch #anruf #Praxis' } });
		const preview = document.getElementById(
			input.getAttribute('aria-describedby')?.split(' ')[0] ?? ''
		);
		expect(preview?.getAttribute('aria-live')).toBe('polite');
		expect([...(preview?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
			'Projekt: Haushalt (HAUS)',
			'Priorität: Hoch',
			'Tags: Anruf, Praxis (neu)'
		]);
	});

	it('names an archived project instead of failing', async () => {
		const { input } = renderQuick();
		await fireEvent.input(input, { target: { value: 'Dach @ALT' } });
		expect(screen.getByText('Das Projekt ALT ist archiviert und wird nicht gesetzt.')).toBeTruthy();
	});

	it('creates a ticket with Enter, announces it with a link and empties the field', async () => {
		const { onsave, input } = renderQuick();
		await fireEvent.input(input, { target: { value: 'Milch @HAUS' } });
		await fireEvent.keyDown(input, { key: 'Enter' });

		expect(onsave).toHaveBeenCalledOnce();
		expect(onsave.mock.calls[0]?.[0]).toMatchObject({ title: 'Milch', project: HOUSE });
		expect(onsave.mock.calls[0]?.[1]).toBe('ticket');
		const link = await screen.findByRole('link', { name: 'Ticket ansehen' });
		expect(link.getAttribute('href')).toBe('/tickets/tick00000000001');
		expect(link.closest('[aria-live="polite"]')?.textContent).toMatch(/Ticket HAUS-2 angelegt\./);
		expect(input.value).toBe('');
		expect(document.activeElement).toBe(input);
	});

	it('puts the line into the inbox with Alt+Enter and with the button', async () => {
		const { onsave, input } = renderQuick();
		await fireEvent.input(input, { target: { value: 'Idee' } });
		await fireEvent.keyDown(input, { key: 'Enter', altKey: true });
		expect(onsave.mock.calls[0]?.[1]).toBe('inbox');
		expect(
			(await screen.findByRole('link', { name: 'Eintrag ansehen' })).getAttribute('href')
		).toBe('/eingang/item00000000001');

		await fireEvent.input(input, { target: { value: 'Noch eine' } });
		await fireEvent.click(screen.getByRole('button', { name: 'In den Eingang' }));
		expect(onsave.mock.calls[1]?.[1]).toBe('inbox');
	});

	it('refuses an empty title and shows failures of the save', async () => {
		const { onsave, input } = renderQuick();
		await fireEvent.input(input, { target: { value: '@HAUS !1' } });
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(onsave).not.toHaveBeenCalled();
		const empty = screen.getByText('Der Titel darf nicht leer sein.');
		expect(empty.closest('.alert-error')?.querySelector('svg')).not.toBeNull();

		onsave.mockResolvedValueOnce({ ok: false, message: 'Server nicht erreichbar.', fields: {} });
		await fireEvent.input(input, { target: { value: 'A' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Ticket anlegen' }));
		expect(await screen.findByText('Server nicht erreichbar.')).toBeTruthy();
		expect(input.value).toBe('A');
	});

	it('closes with Escape and with "Schließen"', async () => {
		const { onclose } = renderQuick();
		const dialog = screen.getByRole('dialog', { name: 'Schnellerfassung' });
		await fireEvent(dialog, new Event('cancel', { cancelable: true }));
		expect(onclose).toHaveBeenCalledOnce();
		await fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
		expect(onclose).toHaveBeenCalledTimes(2);
	});
});

describe('clipboard import', () => {
	const created: DraftsOutcome = { created: 2, duplicates: 0, failures: [] };

	function renderImport(text: string) {
		const onsave = vi.fn<(drafts: InboxDraft[]) => Promise<DraftsOutcome>>(async () => created);
		const onclose = vi.fn();
		render(ClipboardImport, { props: { text, onsave, onclose } });
		return { onsave, onclose };
	}

	it('shows the text and makes one entry with the first line as title', async () => {
		const { onsave, onclose } = renderImport('Brief an Amt\nAktenzeichen 12');
		const area = screen.getByLabelText<HTMLTextAreaElement>('Text');
		expect(area.value).toBe('Brief an Amt\nAktenzeichen 12');
		expect(screen.getByText('Wird ein Eintrag: „Brief an Amt“')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'In den Eingang' }));
		expect(onsave).toHaveBeenCalledWith([
			{ channel: 'clipboard', kind: 'todo', title: 'Brief an Amt', body: 'Aktenzeichen 12' }
		]);
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledWith(created));
	});

	it('makes one entry per line on request', async () => {
		const { onsave } = renderImport('Milch\nBrot');
		await fireEvent.click(screen.getByLabelText('Jede Zeile als eigener Eintrag (2 Zeilen)'));
		expect(screen.getByText('Werden 2 Einträge.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'In den Eingang' }));
		expect(onsave.mock.calls[0]?.[0].map((draft) => draft.title)).toEqual(['Milch', 'Brot']);
	});

	it('refuses more than 100 lines as single entries', async () => {
		const text = Array.from({ length: 101 }, (_, index) => `Zeile ${index}`).join('\n');
		const { onsave } = renderImport(text);
		await fireEvent.click(screen.getByLabelText(/Jede Zeile als eigener Eintrag/));
		const error = screen.getByText('Höchstens 100 Zeilen auf einmal.');
		expect(error.closest('.field-error')).not.toBeNull();
		expect(screen.getByLabelText('Text').getAttribute('aria-invalid')).toBe('true');
		const button = screen.getByRole('button', { name: 'In den Eingang' });
		expect(button.getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(button);
		expect(onsave).not.toHaveBeenCalled();
	});

	it('keeps the dialog open with the failures of single entries', async () => {
		const { onsave, onclose } = renderImport('a\nb');
		onsave.mockResolvedValueOnce({
			created: 1,
			duplicates: 0,
			failures: [{ title: 'b', message: 'Server nicht erreichbar.' }]
		});
		await fireEvent.click(screen.getByLabelText(/Jede Zeile/));
		await fireEvent.click(screen.getByRole('button', { name: 'In den Eingang' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/1 Eintrag im Eingang, 1 fehlgeschlagen\./);
		expect(alert.textContent).toMatch(/„b“: Server nicht erreichbar\./);
		expect(onclose).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
		expect(onclose).toHaveBeenCalledWith(expect.objectContaining({ created: 1 }));
	});
});
