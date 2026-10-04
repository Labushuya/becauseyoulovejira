// Keywords of the file imports on the page "Kanäle" (E4 plan, package 21; ADR-0020): one list per
// kind of file, the start of the text for mail files, the hint before the migration, failures.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PC_CONTEXT, useContext } from '$lib/test/context';
import { DataError } from '$lib/data/errors';
import { EMPTY_IMPORT_KEYWORDS, type ImportKeywords } from '$lib/domain/keywords';
import {
	IMPORT_KEYWORDS_UNAVAILABLE_MESSAGE,
	ImportKeywordsStore,
	type ImportKeywordsData
} from '$lib/stores/import-keywords.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import ImportKeywordsSection from './ImportKeywordsSection.svelte';

function setup(loaded: ImportKeywords | null = EMPTY_IMPORT_KEYWORDS) {
	const data = {
		load: vi.fn<ImportKeywordsData['load']>(async () => loaded),
		save: vi.fn<ImportKeywordsData['save']>(async (settings) => settings)
	} satisfies ImportKeywordsData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const flags = new FlagStore();
	return { store: new ImportKeywordsStore(data, session, flags), data, session, flags };
}

/** Title of the newest flag (ADR-0025 section 8), `undefined` without one. */
const latestFlag = (flags: FlagStore) => flags.flags[0]?.title;

// The administrator on the machine of the app (KX-1, ADR-0057): everything as before.
beforeEach(async () => {
	await useContext(PC_CONTEXT);
});

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
		const { store, data, flags } = setup({
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
			whatsapp: { keywords: [], matchBody: false },
			api: { keywords: [], matchBody: false },
			'whatsapp-web': { keywords: [], matchBody: false }
		});
		expect(latestFlag(flags)).toBe('Gespeichert.');
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
		const { store, data, flags } = setup();
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
			expect(latestFlag(flags)).toBe('Kalenderdateien (.ics): Stichwort „todo“ hinzugefügt.')
		);
		await fireEvent.click(
			screen.getByLabelText('Betreff, Absender, Kopfzeilen und Text durchsuchen')
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
		// Since EH-2 a section message with the one restart text.
		const status = screen.getByRole('status');
		expect(status.textContent).toMatch(/Nach dem nächsten Neustart verfügbar/);
		// The section message follows the context of the tab (the administrator at the PC here); the
		// sentence of the store is worded when the module loads and names no script (KX-1).
		expect(status.textContent).toMatch(/neu-starten\.bat im Ordner app/);
		expect(IMPORT_KEYWORDS_UNAVAILABLE_MESSAGE).toMatch(/erst nach einem Neustart wirkt\.$/);
		expect(screen.queryByRole('group', { name: 'Stichwörter' })).toBeNull();
	});
});
