// Keywords of the file imports on the page "Kanäle" (E4 plan, package 21; ADR-0020): one list per
// kind of file, the start of the text for mail files, the hint before the migration, failures.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { EMPTY_IMPORT_KEYWORDS, type ImportKeywords } from '$lib/domain/keywords';
import {
	IMPORT_KEYWORDS_UNAVAILABLE_MESSAGE,
	ImportKeywordsStore,
	type ImportKeywordsData
} from '$lib/stores/import-keywords.svelte';
import ImportKeywordsSection from './ImportKeywordsSection.svelte';

function setup(loaded: ImportKeywords | null = EMPTY_IMPORT_KEYWORDS) {
	const data = {
		load: vi.fn<ImportKeywordsData['load']>(async () => loaded),
		save: vi.fn<ImportKeywordsData['save']>(async (settings) => settings)
	} satisfies ImportKeywordsData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	return { store: new ImportKeywordsStore(data, session), data, session };
}

describe('ImportKeywordsStore', () => {
	it('loads the lists, knows the state before the migration and logs out on 401', async () => {
		const ready = setup();
		await ready.store.load();
		expect(ready.store.state).toBe('ready');
		const before = setup(null);
		await before.store.load();
		expect(before.store.state).toBe('unavailable');
		const lost = setup();
		lost.data.load.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		await lost.store.load();
		expect(lost.session.logout).toHaveBeenCalledOnce();
	});

	it('saves one list with the others and reports field errors', async () => {
		const { store, data } = setup({
			...EMPTY_IMPORT_KEYWORDS,
			ics: { keywords: ['termin'], matchBody: false }
		});
		await store.load();
		expect(
			await store.save('eml', { keywords: ['rechnung'], matchBody: true }, 'Gespeichert.')
		).toBeNull();
		expect(data.save).toHaveBeenCalledWith({
			eml: { keywords: ['rechnung'], matchBody: true },
			ics: { keywords: ['termin'], matchBody: false },
			whatsapp: { keywords: [], matchBody: false }
		});
		expect(store.announcement).toBe('Gespeichert.');
		data.save.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					import_keywords: {
						code: 'validation_keywords',
						message: 'Stichwörter: höchstens 50, je 1 bis 100 Zeichen, ohne Zeilenumbruch.'
					}
				}
			})
		);
		expect(await store.save('ics', { keywords: ['x'], matchBody: false }, 'x')).toMatch(
			/höchstens 50/
		);
	});
});

describe('ImportKeywordsSection', () => {
	it('shows one list per kind of file with its warning', async () => {
		const { store } = setup();
		await store.load();
		render(ImportKeywordsSection, { props: { store } });
		expect(screen.getByRole('heading', { name: 'Stichwörter für Datei-Importe' })).toBeTruthy();
		for (const label of ['Mail-Dateien (.eml)', 'Kalenderdateien (.ics)', 'WhatsApp-Export']) {
			expect(screen.getByRole('heading', { name: label })).toBeTruthy();
			expect(
				screen.getByText(`Keine Stichwörter: In der Auswahl für ${label} ist nichts vorausgewählt.`)
			).toBeTruthy();
		}
	});

	it('adds a keyword to one kind and switches the start of the text of mails', async () => {
		const { store, data } = setup();
		await store.load();
		render(ImportKeywordsSection, { props: { store } });
		const [, ics] = screen.getAllByRole('group', { name: 'Stichwörter' });
		const scope = within(ics as HTMLElement);
		await fireEvent.input(scope.getByLabelText('Neues Stichwort'), { target: { value: 'todo' } });
		await fireEvent.click(scope.getByRole('button', { name: 'Hinzufügen' }));
		await vi.waitFor(() =>
			expect(data.save).toHaveBeenLastCalledWith(
				expect.objectContaining({ ics: { keywords: ['todo'], matchBody: false } })
			)
		);
		await vi.waitFor(() =>
			expect(store.announcement).toBe('Kalenderdateien (.ics): Stichwort „todo“ hinzugefügt.')
		);
		await fireEvent.click(
			screen.getByLabelText('Auch die ersten 500 Zeichen des Textes durchsuchen')
		);
		await vi.waitFor(() =>
			expect(data.save).toHaveBeenLastCalledWith(
				expect.objectContaining({ eml: { keywords: [], matchBody: true } })
			)
		);
	});

	it('explains the next start before the migration', async () => {
		const { store } = setup(null);
		await store.load();
		render(ImportKeywordsSection, { props: { store } });
		expect(screen.getByText(IMPORT_KEYWORDS_UNAVAILABLE_MESSAGE)).toBeTruthy();
		expect(screen.queryByRole('group', { name: 'Stichwörter' })).toBeNull();
	});
});
