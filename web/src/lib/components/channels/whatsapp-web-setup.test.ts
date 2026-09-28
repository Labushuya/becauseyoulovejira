// Card and assistant "WhatsApp Web" (ADR-0038 §4, plan eigener-eingang-whatsapp-web EI-3): the
// card with keywords and the way to the assistant; the assistant with the stepper, the key created
// in step 1 and offered again in step 3, the folder of the build for Edge and Chrome, the check of
// the connection through "zuletzt benutzt" and the keywords of the channel.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type { CreatedInboxKey, InboxKey } from '$lib/domain/inbox-keys';
import { EMPTY_IMPORT_KEYWORDS } from '$lib/domain/keywords';
import { FlagStore } from '$lib/stores/flags.svelte';
import { ImportKeywordsStore, type ImportKeywordsData } from '$lib/stores/import-keywords.svelte';
import { InboxKeysStore, type InboxKeysData } from '$lib/stores/inbox-keys.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import WhatsAppWebCard from './WhatsAppWebCard.svelte';
import WhatsAppWebSetup from './WhatsAppWebSetup.svelte';

useOverlayStubs();

const TOKEN = `byl_${'Wa12'.repeat(10)}`;
const FOLDER = 'C:\\byl\\app\\erweiterung-whatsapp-web';

function stores(keys: InboxKey[] = [], keywords: string[] = []) {
	let listed = keys;
	const data = {
		list: vi.fn<InboxKeysData['list']>(async () => listed),
		create: vi.fn<InboxKeysData['create']>(async (name): Promise<CreatedInboxKey> => ({
			id: 'key000000000009',
			name,
			tokenHint: TOKEN.slice(0, 8),
			created: '2026-09-28 12:00:00.000Z',
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
			'whatsapp-web': { keywords, matchBody: false }
		})),
		save: vi.fn<ImportKeywordsData['save']>(async (settings) => settings)
	} satisfies ImportKeywordsData;
	return {
		inboxKeys: new InboxKeysStore(data, session, flags),
		importKeywords: new ImportKeywordsStore(keywordData, session, flags),
		data,
		keywordData,
		setListed: (next: InboxKey[]) => {
			listed = next;
		}
	};
}

async function openSetup(
	keys: InboxKey[] = [],
	extension = { folder: FOLDER, built: true, version: '0.1.0' }
) {
	const all = stores(keys);
	await all.inboxKeys.load();
	await all.importKeywords.load();
	const onclose = vi.fn();
	render(WhatsAppWebSetup, {
		props: {
			inboxKeys: all.inboxKeys,
			importKeywords: all.importKeywords,
			extension,
			appUrl: 'http://127.0.0.1:8090',
			onclose
		}
	});
	return {
		...all,
		onclose,
		dialog: screen.getByRole('dialog', { name: 'WhatsApp Web einrichten' })
	};
}

function next(dialog: HTMLElement) {
	return fireEvent.click(within(dialog).getByRole('button', { name: 'Weiter' }));
}

describe('WhatsAppWebCard', () => {
	it('says what the extension does, shows its keywords and leads to the assistant', async () => {
		const { importKeywords } = stores([], ['#byl']);
		await importKeywords.load();
		render(WhatsAppWebCard, {
			props: {
				importKeywords,
				setupHref: '/einstellungen/kanaele?einrichten=whatsapp-web' as ResolvedPathname
			}
		});
		const card = screen.getByRole('region', { name: 'WhatsApp Web (Browser-Erweiterung)' });
		expect(card.textContent).toContain('sendet nie etwas in WhatsApp');
		expect(card.textContent).toContain('Stichwörter für „Automatisch“: 1 (#byl)');
		expect(
			within(card).getByRole('link', { name: 'Einrichten: WhatsApp Web' }).getAttribute('href')
		).toBe('/einstellungen/kanaele?einrichten=whatsapp-web');
		expect(within(card).getByRole('link', { name: 'So geht’s' }).getAttribute('href')).toBe(
			'/einstellungen/hilfe#whatsapp-web'
		);
		await fireEvent.click(
			within(card).getByRole('button', { name: 'Stichwörter …: WhatsApp Web' })
		);
		expect(screen.getByRole('dialog', { name: 'Stichwörter: WhatsApp Web' })).toBeTruthy();
	});
});

describe('WhatsAppWebSetup', () => {
	it('walks through key, folder, entering and the check of the connection', async () => {
		const { dialog, data, setListed, inboxKeys } = await openSetup();
		const stepper = within(dialog).getByRole('navigation', { name: 'Schritte der Einrichtung' });
		const stepButtons = () => within(stepper).getAllByRole('button', { name: /^Schritt \d von 5/ });
		expect(stepButtons()).toHaveLength(5);
		expect(
			within(dialog).getByRole('heading', { name: 'Schritt 1 von 5: Schlüssel' })
		).toBeTruthy();

		// 1: a key named "WhatsApp Web", shown with "Kopieren".
		expect(
			(within(dialog).getByLabelText('Name des Schlüssels (Pflichtfeld)') as HTMLInputElement).value
		).toBe('WhatsApp Web');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Schlüssel erzeugen' }));
		await waitFor(() => expect(within(dialog).getByText(TOKEN)).toBeTruthy());
		expect(data.create).toHaveBeenCalledWith('WhatsApp Web');

		// 2: the folder of the build and the ways for Edge and Chrome.
		await next(dialog);
		expect(
			within(dialog).getByRole('heading', { name: 'Schritt 2 von 5: Erweiterung laden' })
		).toBe(document.activeElement);
		expect(
			within(dialog).getByRole('region', { name: 'Ordner der Erweiterung' }).textContent
		).toContain(FOLDER);
		expect(within(dialog).getByText('Version 0.1.0 ist gebaut.')).toBeTruthy();
		expect(within(dialog).getByRole('tabpanel').textContent).toContain('edge://extensions');
		await fireEvent.click(within(dialog).getByRole('tab', { name: 'Google Chrome' }));
		expect(within(dialog).getByRole('tabpanel').textContent).toContain('chrome://extensions');

		// 3: address and the key once more, while the assistant is open.
		await next(dialog);
		expect(within(dialog).getByRole('region', { name: 'App-Adresse' }).textContent).toContain(
			'http://127.0.0.1:8090'
		);
		expect(within(dialog).getByRole('region', { name: 'Zugangsschlüssel' }).textContent).toContain(
			TOKEN
		);

		// 4: no report until the extension used the key.
		await next(dialog);
		expect(within(dialog).getByRole('status').textContent).toContain(
			'Seit dem Öffnen des Assistenten keine Meldung mit dem Schlüssel „WhatsApp Web“.'
		);
		setListed([
			{
				id: 'key000000000009',
				name: 'WhatsApp Web',
				tokenHint: 'byl_Wa12',
				created: '2026-09-28 12:00:00.000Z',
				lastUsedAt: new Date().toISOString().replace('T', ' ')
			}
		]);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Prüfen' }));
		await waitFor(() =>
			expect(within(dialog).getByRole('status').textContent).toContain(
				'Die Erweiterung hat sich mit dem Schlüssel „WhatsApp Web“ gemeldet'
			)
		);
		expect(inboxKeys.keys).toHaveLength(1);
		const steps = stepButtons();
		expect(steps[3]?.getAttribute('aria-current')).toBe('step');
		expect(steps[0]?.getAttribute('data-state')).toBe('done');
	});

	it('edits the keywords of WhatsApp Web and says honestly what the extension is', async () => {
		const { dialog, keywordData, onclose } = await openSetup();
		const stepper = within(dialog).getByRole('navigation', { name: 'Schritte der Einrichtung' });
		await fireEvent.click(
			within(stepper).getByRole('button', { name: /^Schritt 5 von 5: Stichwörter/ })
		);
		expect(
			within(dialog).getByRole('heading', { name: 'Schritt 5 von 5: Stichwörter' })
		).toBeTruthy();
		const content = (dialog.textContent ?? '').replace(/\s+/g, ' ');
		expect(content).toContain('Inoffiziell');
		expect(content).toContain('solange er offen ist');
		const input = within(dialog).getByRole('textbox', { name: /Stichwort/ });
		await fireEvent.input(input, { target: { value: '#byl,' } });
		await waitFor(() =>
			expect(keywordData.save).toHaveBeenCalledWith(
				expect.objectContaining({ 'whatsapp-web': { keywords: ['#byl'], matchBody: false } })
			)
		);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Fertig' }));
		await waitFor(() => expect(onclose).toHaveBeenCalled());
	});

	it('names the folder relative to the app without the route and warns without a build', async () => {
		const first = await openSetup([], null as never);
		await next(first.dialog);
		expect(
			within(first.dialog).getByRole('region', { name: 'Ordner der Erweiterung' }).textContent
		).toContain('app\\erweiterung-whatsapp-web');
		first.onclose();
		document.body.innerHTML = '';
		const second = await openSetup([], { folder: FOLDER, built: false, version: '' });
		await next(second.dialog);
		expect(second.dialog.textContent).toContain('Der Ordner fehlt noch');
	});

	it('opens at loading the extension when a key exists', async () => {
		const { dialog } = await openSetup([
			{
				id: 'key000000000001',
				name: 'Skript',
				tokenHint: 'byl_Ab12',
				created: '2026-09-01 10:00:00.000Z',
				lastUsedAt: null
			}
		]);
		expect(
			within(dialog).getByRole('heading', { name: 'Schritt 2 von 5: Erweiterung laden' })
		).toBeTruthy();
	});
});
