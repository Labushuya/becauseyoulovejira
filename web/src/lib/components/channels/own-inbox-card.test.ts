// Card "Eigener Eingang (API)" (ADR-0038; plan eigener-eingang-whatsapp-web, EI-1): the keys with
// name, start, creation and last use, "Zugangsschlüssel erzeugen …" with the key shown once,
// "Widerrufen …" through the confirmation, the keywords of the channel "api" and the states before
// the migration and after a failure.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { CreatedInboxKey, InboxKey } from '$lib/domain/inbox-keys';
import { EMPTY_IMPORT_KEYWORDS } from '$lib/domain/keywords';
import { FlagStore } from '$lib/stores/flags.svelte';
import { ImportKeywordsStore, type ImportKeywordsData } from '$lib/stores/import-keywords.svelte';
import { InboxKeysStore, type InboxKeysData } from '$lib/stores/inbox-keys.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import OwnInboxCard from './OwnInboxCard.svelte';

useOverlayStubs();

const TOKEN = `byl_${'Ab12'.repeat(10)}`;

const KEY: InboxKey = {
	id: 'key000000000001',
	name: 'Laptop',
	tokenHint: 'byl_Ab12',
	created: '2026-09-28 08:00:00.000Z',
	lastUsedAt: null
};

function setup(listed: InboxKey[] | null = [KEY]) {
	const data = {
		list: vi.fn<InboxKeysData['list']>(async () => listed),
		create: vi.fn<InboxKeysData['create']>(async (name): Promise<CreatedInboxKey> => ({
			id: 'key000000000002',
			name,
			tokenHint: TOKEN.slice(0, 8),
			created: '2026-09-28 09:00:00.000Z',
			lastUsedAt: null,
			token: TOKEN
		})),
		revoke: vi.fn<InboxKeysData['revoke']>(async () => undefined)
	} satisfies InboxKeysData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const flags = new FlagStore();
	const keywordData = {
		load: vi.fn<ImportKeywordsData['load']>(async () => ({
			...EMPTY_IMPORT_KEYWORDS,
			api: { keywords: ['todo', 'rechnung'], matchBody: false }
		})),
		save: vi.fn<ImportKeywordsData['save']>(async (settings) => settings)
	} satisfies ImportKeywordsData;
	return {
		store: new InboxKeysStore(data, session, flags),
		keywords: new ImportKeywordsStore(keywordData, session, flags),
		data,
		keywordData,
		session,
		flags
	};
}

describe('InboxKeysStore', () => {
	it('loads the keys, knows the state before the migration and logs out on 401', async () => {
		const ready = setup();
		await ready.store.load();
		expect(ready.store.state).toBe('ready');
		expect(ready.store.keys).toEqual([KEY]);
		const before = setup(null);
		await before.store.load();
		expect(before.store.state).toBe('unavailable');
		const lost = setup();
		lost.data.list.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		await lost.store.load();
		expect(lost.session.logout).toHaveBeenCalledOnce();
	});

	it('hands a new key to the caller only and keeps the list without it', async () => {
		const { store } = setup();
		await store.load();
		const result = await store.create('Skript');
		expect(result).toEqual({ key: expect.objectContaining({ name: 'Skript', token: TOKEN }) });
		expect(store.keys[0]).toEqual({
			id: 'key000000000002',
			name: 'Skript',
			tokenHint: 'byl_Ab12',
			created: '2026-09-28 09:00:00.000Z',
			lastUsedAt: null
		});
		expect(JSON.stringify(store.keys)).not.toContain(TOKEN);
	});

	it('reports the text of a refused name and revokes with a flag', async () => {
		const { store, data, flags } = setup();
		await store.load();
		data.create.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					name: {
						code: 'validation_inbox_key_limit',
						message: 'Höchstens 20 Zugangsschlüssel. Widerrufe zuerst einen alten.'
					}
				}
			})
		);
		expect(await store.create('Noch einer')).toEqual({
			error: 'Höchstens 20 Zugangsschlüssel. Widerrufe zuerst einen alten.'
		});
		expect(await store.revoke(KEY)).toBeNull();
		expect(data.revoke).toHaveBeenCalledWith(KEY.id);
		expect(store.keys).toEqual([]);
		expect(flags.flags[0]?.title).toBe('Zugangsschlüssel „Laptop“ widerrufen.');
	});
});

describe('OwnInboxCard', () => {
	it('lists the keys without the key itself, with start, creation and last use', async () => {
		const { store, keywords } = setup([
			KEY,
			{ ...KEY, id: 'key000000000003', name: 'Skript', lastUsedAt: '2026-09-28 10:15:00.000Z' }
		]);
		await store.load();
		await keywords.load();
		render(OwnInboxCard, { props: { store, importKeywords: keywords } });
		const card = screen.getByRole('region', { name: 'Eigener Eingang (API)' });
		const list = within(card).getByRole('list', { name: 'Zugangsschlüssel' });
		const rows = within(list).getAllByRole('listitem');
		expect(rows).toHaveLength(2);
		expect(rows[0]?.textContent).toMatch(
			/Laptop.*byl_Ab12….*angelegt 28\.09\.2026.*noch nie benutzt/s
		);
		expect(rows[1]?.textContent).toMatch(/zuletzt 28\.09\.2026 12:15/);
		expect(
			within(card).getByText(/Stichwörter für „mode: auto“: 2 \(todo, rechnung\)/)
		).toBeTruthy();
		expect(within(card).getByRole('link', { name: 'So geht’s' }).getAttribute('href')).toBe(
			'/einstellungen/hilfe#eigener-eingang'
		);
	});

	it('shows a new key once, with a copy button, and forgets it when the modal closes', async () => {
		const { store, keywords, data } = setup([]);
		await store.load();
		await keywords.load();
		render(OwnInboxCard, { props: { store, importKeywords: keywords } });
		expect(screen.getByRole('heading', { name: 'Noch kein Zugangsschlüssel' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Zugangsschlüssel erzeugen …' }));
		const dialog = screen.getByRole('dialog', { name: 'Zugangsschlüssel erzeugen' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Schlüssel erzeugen' }));
		expect(
			within(dialog).getByText('Bitte einen Namen mit 1 bis 60 Zeichen eingeben.')
		).toBeTruthy();
		expect(data.create).not.toHaveBeenCalled();

		await fireEvent.input(within(dialog).getByLabelText('Name des Schlüssels (Pflichtfeld)'), {
			target: { value: 'WhatsApp Web' }
		});
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Schlüssel erzeugen' }));
		await waitFor(() => expect(within(dialog).getByText(TOKEN)).toBeTruthy());
		expect(
			within(dialog).getByRole('heading', { name: /Zugangsschlüssel „WhatsApp Web“ erzeugt/ })
		).toBeTruthy();
		expect(within(dialog).getByRole('button', { name: 'Zugangsschlüssel kopieren' })).toBeTruthy();
		expect(data.create).toHaveBeenCalledWith('WhatsApp Web');

		const footerClose = within(dialog).getAllByRole('button', { name: 'Schließen' }).at(-1);
		if (footerClose === undefined) throw new Error('No button "Schließen"');
		await fireEvent.click(footerClose);
		await waitFor(() =>
			expect(screen.queryByRole('dialog', { name: 'Zugangsschlüssel erzeugen' })).toBeNull()
		);
		expect(document.body.textContent).not.toContain(TOKEN);
		expect(screen.getByRole('list', { name: 'Zugangsschlüssel' }).textContent).toContain(
			'WhatsApp Web'
		);
	});

	it('revokes a key only after the confirmation', async () => {
		const { store, keywords, data } = setup();
		await store.load();
		await keywords.load();
		render(OwnInboxCard, { props: { store, importKeywords: keywords } });
		await fireEvent.click(screen.getByRole('button', { name: 'Widerrufen …: Laptop' }));
		const dialog = screen.getByRole('dialog', { name: 'Zugangsschlüssel „Laptop“ widerrufen?' });
		expect(document.activeElement?.textContent).toBe('Abbrechen');
		expect(data.revoke).not.toHaveBeenCalled();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Widerrufen' }));
		await waitFor(() => expect(data.revoke).toHaveBeenCalledWith(KEY.id));
		await waitFor(() =>
			expect(screen.queryByRole('list', { name: 'Zugangsschlüssel' })).toBeNull()
		);
	});

	it('edits the keywords of the channel in their own modal', async () => {
		const { store, keywords, keywordData } = setup();
		await store.load();
		await keywords.load();
		render(OwnInboxCard, { props: { store, importKeywords: keywords } });
		await fireEvent.click(
			screen.getByRole('button', { name: 'Stichwörter …: Eigener Eingang (API)' })
		);
		const dialog = screen.getByRole('dialog', { name: 'Stichwörter: Eigener Eingang (API)' });
		expect(within(dialog).getByText(/Gesucht wird in Titel und Text/)).toBeTruthy();
		await fireEvent.click(
			within(dialog).getByRole('button', { name: 'Stichwort „todo“ entfernen' })
		);
		await waitFor(() =>
			expect(keywordData.save).toHaveBeenCalledWith(
				expect.objectContaining({ api: { keywords: ['rechnung'], matchBody: false } })
			)
		);
	});

	it('says what to do before the restart and after a failure', async () => {
		const before = setup(null);
		await before.store.load();
		const { unmount } = render(OwnInboxCard, { props: { store: before.store } });
		expect(screen.getByText('Nach dem nächsten Neustart verfügbar')).toBeTruthy();
		expect(
			screen
				.getByRole('button', { name: 'Zugangsschlüssel erzeugen …' })
				.getAttribute('aria-disabled')
		).toBe('true');
		unmount();

		const failed = setup();
		failed.data.list.mockRejectedValueOnce(new DataError('network'));
		await failed.store.load();
		render(OwnInboxCard, { props: { store: failed.store } });
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
		await waitFor(() =>
			expect(screen.getByRole('list', { name: 'Zugangsschlüssel' })).toBeTruthy()
		);
	});
});
