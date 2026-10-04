// Card and assistant "WhatsApp Web" (ADR-0038 §4, plan eigener-eingang-whatsapp-web EI-3): the
// card with keywords and the way to the assistant; the assistant with the stepper, the key created
// in step 1 and offered again in step 3, the folder of the build for Edge and Chrome, the check of
// the connection through "zuletzt benutzt" and the keywords of the channel.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEMBER_CONTEXT, PC_CONTEXT, useContext } from '$lib/test/context';
import type { ResolvedPathname } from '$app/types';
import type { CreatedInboxKey, InboxKey } from '$lib/domain/inbox-keys';
import { EMPTY_IMPORT_KEYWORDS } from '$lib/domain/keywords';
import { EMPTY_TARGETS } from '$lib/domain/target-project';
import type { ProjectRef } from '$lib/domain/ticket';
import { FlagStore } from '$lib/stores/flags.svelte';
import { ImportKeywordsStore, type ImportKeywordsData } from '$lib/stores/import-keywords.svelte';
import { InboxKeysStore, type InboxKeysData } from '$lib/stores/inbox-keys.svelte';
import { InboxTargetsStore, type InboxTargetsData } from '$lib/stores/inbox-targets.svelte';
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

/** A project of the catalog for the step "Zielprojekt" (ADR-0049). */
const HAUS: ProjectRef = { id: 'haus00000000001', name: 'Haus', code: 'HAUS', archived: false };

async function openSetup(
	keys: InboxKey[] = [],
	extension = { folder: FOLDER, built: true, version: '0.1.0' }
) {
	const all = stores(keys);
	await all.inboxKeys.load();
	await all.importKeywords.load();
	const targetData = {
		load: vi.fn<InboxTargetsData['load']>(async () => EMPTY_TARGETS),
		save: vi.fn<InboxTargetsData['save']>(async (targets) => targets)
	} satisfies InboxTargetsData;
	const inboxTargets = new InboxTargetsStore(
		targetData,
		{ ensureValid: () => true, logout: vi.fn() },
		new FlagStore()
	);
	await inboxTargets.load();
	const onclose = vi.fn();
	render(WhatsAppWebSetup, {
		props: {
			inboxKeys: all.inboxKeys,
			importKeywords: all.importKeywords,
			inboxTargets,
			projects: [HAUS],
			extension,
			appUrl: 'http://127.0.0.1:8090',
			onclose
		}
	});
	return {
		...all,
		targetData,
		onclose,
		dialog: screen.getByRole('dialog', { name: 'WhatsApp Web einrichten' })
	};
}

function next(dialog: HTMLElement) {
	return fireEvent.click(within(dialog).getByRole('button', { name: 'Weiter' }));
}

// The administrator on the machine of the app (KOB-1, ADR-0057): everything as before.
beforeEach(async () => {
	await useContext(PC_CONTEXT);
});

describe('WhatsAppWebCard', () => {
	const NAME = 'WhatsApp Web (Browser-Erweiterung)';

	it('says what the extension does, shows its keywords and leads to the assistant', async () => {
		const { importKeywords } = stores([], ['#byl']);
		await importKeywords.load();
		render(WhatsAppWebCard, {
			props: {
				importKeywords,
				setupHref: '/einstellungen/kanaele?einrichten=whatsapp-web' as ResolvedPathname
			}
		});
		const card = screen.getByRole('article', { name: NAME });
		// The card building block (KK-2): the keywords in the info line, the rest in the details.
		expect(within(card).getByText('Stichwörter für „Automatisch“: 1 (#byl)')).toBeTruthy();
		await fireEvent.click(within(card).getByRole('button', { name: `Details: ${NAME}` }));
		expect(within(card).getByText(/sendet nie etwas in WhatsApp/)).toBeTruthy();
		const setup = within(card).getByRole('link', { name: `Einrichten: ${NAME}` });
		expect(setup.getAttribute('href')).toBe('/einstellungen/kanaele?einrichten=whatsapp-web');
		expect(setup.hasAttribute('data-sveltekit-replacestate')).toBe(true);
		const trigger = within(card).getByRole('button', { name: `Weitere Aktionen für ${NAME}` });
		const menu = within(document.getElementById(trigger.getAttribute('aria-controls') ?? '')!);
		expect(menu.getByRole('menuitem', { name: 'Hilfe', hidden: true }).getAttribute('href')).toBe(
			'/einstellungen/hilfe#whatsapp-web'
		);
		await fireEvent.click(trigger);
		await fireEvent.click(menu.getByRole('menuitem', { name: 'Stichwörter …', hidden: true }));
		expect(screen.getByRole('dialog', { name: 'Stichwörter: WhatsApp Web' })).toBeTruthy();
	});

	it('says only what the app knows about the extension, never "Verbunden" (ADR-0038 §4)', async () => {
		const setupHref = '/einstellungen/kanaele?einrichten=whatsapp-web' as ResolvedPathname;
		const without = stores([]);
		await without.inboxKeys.load();
		const first = render(WhatsAppWebCard, {
			props: {
				inboxKeys: without.inboxKeys,
				extension: { folder: FOLDER, built: true, version: '0.1.0' },
				setupHref
			}
		});
		// No key yet: the extension cannot bring anything.
		expect(screen.getByText('Einrichtung offen')).toBeTruthy();
		first.unmount();

		const withKey = stores([
			{
				id: 'key000000000001',
				name: 'WhatsApp Web',
				tokenHint: 'byl_Wa12',
				created: '2026-09-28 08:00:00.000Z',
				lastUsedAt: null
			}
		]);
		await withKey.inboxKeys.load();
		const second = render(WhatsAppWebCard, {
			props: {
				inboxKeys: withKey.inboxKeys,
				extension: { folder: FOLDER, built: false, version: '' },
				setupHref
			}
		});
		expect(screen.getByText('Einrichtung offen')).toBeTruthy();
		expect(screen.getByText(/Er entsteht beim Bauen der App/)).toBeTruthy();
		second.unmount();

		render(WhatsAppWebCard, {
			props: {
				inboxKeys: withKey.inboxKeys,
				extension: { folder: FOLDER, built: true, version: '0.1.0' },
				setupHref
			}
		});
		const card = screen.getByRole('article', { name: NAME });
		expect(card.querySelector('[data-tone]')).toBeNull();
		expect(within(card).queryByText('Verbunden')).toBeNull();
		await fireEvent.click(within(card).getByRole('button', { name: `Details: ${NAME}` }));
		expect(within(card).getByText('gebaut, Version 0.1.0')).toBeTruthy();
	});
});

describe('WhatsAppWebSetup', () => {
	it('walks through key, folder, entering and the check of the connection', async () => {
		const { dialog, data, setListed, inboxKeys } = await openSetup();
		const stepper = within(dialog).getByRole('navigation', { name: 'Schritte der Einrichtung' });
		const stepButtons = () => within(stepper).getAllByRole('button', { name: /^Schritt \d von 6/ });
		expect(stepButtons()).toHaveLength(6);
		expect(
			within(dialog).getByRole('heading', { name: 'Schritt 1 von 6: Schlüssel' })
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
			within(dialog).getByRole('heading', { name: 'Schritt 2 von 6: Erweiterung laden' })
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
		const { dialog, keywordData, targetData, onclose } = await openSetup();
		const stepper = within(dialog).getByRole('navigation', { name: 'Schritte der Einrichtung' });
		await fireEvent.click(
			within(stepper).getByRole('button', { name: /^Schritt 5 von 6: Stichwörter/ })
		);
		expect(
			within(dialog).getByRole('heading', { name: 'Schritt 5 von 6: Stichwörter' })
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

		// Optional last step (ADR-0049): the target project of the new entries, saved at once.
		await next(dialog);
		expect(
			within(dialog).getByRole('heading', { name: 'Schritt 6 von 6: Zielprojekt' })
		).toBeTruthy();
		const select = within(dialog).getByRole('combobox', { name: 'Zielprojekt von „WhatsApp Web“' });
		await fireEvent.change(select, { target: { value: HAUS.id } });
		await waitFor(() =>
			expect(targetData.save).toHaveBeenCalledWith({ api: '', 'whatsapp-web': HAUS.id, files: '' })
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
			within(dialog).getByRole('heading', { name: 'Schritt 2 von 6: Erweiterung laden' })
		).toBeTruthy();
	});

	it('leaves loading the extension from the folder of the app to the administrator (KOB-1)', async () => {
		await useContext(MEMBER_CONTEXT);
		// The server names no folder to another account (ADR-0057).
		const { dialog } = await openSetup(
			[
				{
					id: 'key000000000001',
					name: 'Skript',
					tokenHint: 'byl_Ab12',
					created: '2026-09-01 10:00:00.000Z',
					lastUsedAt: null
				}
			],
			{ folder: '', built: true, version: '0.1.0' }
		);
		expect(
			within(dialog).getByRole('heading', { name: 'Schritt 2 von 6: Erweiterung laden' })
		).toBeTruthy();
		expect(within(dialog).getByText('Bitte den Verwalter fragen.')).toBeTruthy();
		expect(within(dialog).queryByRole('region', { name: 'Ordner der Erweiterung' })).toBeNull();
		expect(dialog.textContent).not.toMatch(/\.bat\b|\.ps1\b|erweiterung-whatsapp-web/);
	});
});
