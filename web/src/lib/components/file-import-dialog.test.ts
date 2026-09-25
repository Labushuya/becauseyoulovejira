// Selection view of dropped mail and calendar files (E4 plan, package 21; ADR-0020): keyword
// matches chosen at first, entries in the inbox already blocked, hints without keywords, saving
// only the chosen entries, Escape without saving.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { InboxDraft } from '$lib/domain/inbox';
import type { FileImportResult, FileSelection, SelectionEntry } from '$lib/stores/mail-import';
import FileImportDialog from './FileImportDialog.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

useOverlayStubs();

const ENTRIES: SelectionEntry[] = [
	{
		key: 'm:1',
		kind: 'mail',
		fileName: 'rechnung.eml',
		title: 'Rechnung September',
		sourceDate: '2026-09-24 08:00:00.000Z',
		allDay: false,
		detail: 'Shop <shop@example.com>',
		keyword: 'rechnung',
		blocked: ''
	},
	{
		key: 'c:2:0',
		kind: 'event',
		fileName: 'kalender.ics',
		title: 'Chorprobe',
		sourceDate: '2026-09-30 22:00:00.000Z',
		allDay: true,
		detail: 'Saal 2 · Serie',
		keyword: '',
		blocked: ''
	},
	{
		key: 'c:2:1',
		kind: 'todo',
		fileName: 'kalender.ics',
		title: 'Todo: Reifen',
		sourceDate: null,
		allDay: false,
		detail: '',
		keyword: 'todo',
		blocked: 'Schon verworfen.'
	}
];

function selection(overrides: Partial<FileSelection> = {}): FileSelection {
	return {
		entries: ENTRIES,
		mails: new Map<string, { draft: InboxDraft; fileName: string }>(),
		calendars: new Map(),
		withoutKeywords: [],
		keywordsAvailable: true,
		...overrides
	};
}

function renderDialog(overrides: Partial<FileSelection> = {}) {
	const results: FileImportResult[] = [
		{ name: 'rechnung.eml', kind: 'created', itemId: 'item00000000001', title: 'Rechnung' }
	];
	const onsave = vi.fn(async (chosen: ReadonlySet<string>) => {
		void chosen;
		return results;
	});
	const onclose = vi.fn();
	render(FileImportDialog, { props: { selection: selection(overrides), onsave, onclose } });
	return {
		onsave,
		onclose,
		results,
		dialog: screen.getByRole('dialog', { name: 'Dateien übernehmen' })
	};
}

const submit = () => screen.getByRole('button', { name: /in den Eingang$/ });

describe('FileImportDialog', () => {
	it('chooses keyword matches at first and blocks what is in the inbox', () => {
		const { dialog } = renderDialog();
		const boxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[];
		expect(boxes.map((box) => [box.checked, box.disabled])).toEqual([
			[true, false],
			[false, false],
			[false, true]
		]);
		expect(screen.getByText(/Treffer deiner Stichwörter sind vorausgewählt/)).toBeTruthy();
		const [mail, event, blocked] = within(dialog).getAllByRole('listitem');
		expect(mail?.textContent).toMatch(
			/Mail · 24\.09\.2026 10:00 · Shop <shop@example\.com> · rechnung\.eml/
		);
		expect(mail?.textContent).toMatch(/Stichwort: rechnung/);
		expect(event?.textContent).toMatch(/Termin · 01\.10\.2026 · Saal 2 · Serie · kalender\.ics/);
		expect(blocked?.textContent).toMatch(/Schon verworfen\./);
		expect(submit().textContent).toContain('1 Eintrag in den Eingang');
	});

	it('saves the chosen entries and closes with the results', async () => {
		const { onsave, onclose, results } = renderDialog();
		await fireEvent.click(screen.getByLabelText(/Chorprobe/));
		expect(screen.getByText('2 ausgewählt')).toBeTruthy();
		await fireEvent.click(submit());
		expect([...(onsave.mock.calls[0]?.[0] ?? [])].sort()).toEqual(['c:2:0', 'm:1']);
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledWith(results));
	});

	it('chooses all open entries, clears the choice and needs one to save', async () => {
		const { onsave } = renderDialog();
		await fireEvent.click(screen.getByRole('button', { name: 'Alle auswählen' }));
		expect(screen.getByText('2 ausgewählt')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Auswahl aufheben' }));
		expect(submit().getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(submit());
		expect(onsave).not.toHaveBeenCalled();
	});

	it('names the kinds without keywords and the state before the migration', () => {
		renderDialog({ withoutKeywords: ['eml', 'ics'] });
		expect(
			screen.getByText(
				/Für Mail-Dateien \(\.eml\) und Kalenderdateien \(\.ics\) sind keine Stichwörter/
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole('link', { name: 'Stichwörter unter „Datei-Importe“ festlegen' })
				.getAttribute('href')
		).toBe('/einstellungen/datei-importe');
	});

	it('explains that keywords come with the next start', () => {
		renderDialog({ keywordsAvailable: false });
		expect(screen.getByText(/nach dem nächsten Start der App/)).toBeTruthy();
	});

	it('closes with Escape without saving', async () => {
		const { onsave, onclose, dialog } = renderDialog();
		await fireEvent(dialog, new Event('cancel', { cancelable: true }));
		expect(onclose).toHaveBeenCalledWith(null);
		expect(onsave).not.toHaveBeenCalled();
	});

	it('is a modal of size L; ×, "Abbrechen" and the veil close without saving', async () => {
		const { onsave, onclose, dialog } = renderDialog();
		await tick();
		expect(dialog.classList.contains('size-l')).toBe(true);
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Alle auswählen' }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		await fireEvent.pointerDown(dialog);
		await fireEvent.click(dialog);
		expect(onclose.mock.calls).toEqual([[null], [null], [null]]);
		expect(onsave).not.toHaveBeenCalled();
	});
});
