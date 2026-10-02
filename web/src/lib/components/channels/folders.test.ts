// Folders on the page "Kanäle" (ADR-0051 §7, plan beobachtete-quellen OD-2): the card with its
// folders, the details per folder (files, last change, last check, a problem without red, types and
// exclusions as ChipList), the interval, "Ordner hinzufügen …", "Einstellungen …", removing,
// "Vorhandene Dateien übernehmen …" in blocks, and the assistant that creates the connection with
// its first folder, without a variable. Fakes instead of PocketBase (the routes:
// tests/integration/folder-channel.test.mjs, the data layer: web-data-folders.test.mjs).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { Connection } from '$lib/domain/connections';
import {
	DEFAULT_EXCLUDE,
	FOLDER_MESSAGES,
	type ExistingFiles,
	type FolderConfig,
	type FolderDetails,
	type FolderSummary
} from '$lib/domain/folders';
import type { ProjectRef } from '$lib/domain/ticket';
import { ConnectionsStore, type ConnectionsData } from '$lib/stores/connections.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import ChannelsViewHarness from '$lib/test/ChannelsViewHarness.svelte';
import { EMPTY_FOLDER_DETAILS, fakeFoldersData, foldersStoreOf } from '$lib/test/folders-fake';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

useOverlayStubs();

const ID = 'conn00000000008';
const HAUS: ProjectRef = { id: 'haus00000000001', name: 'Haus', code: 'HAUS', archived: false };
const PATH = 'C:\\Daten\\Projekte';

function folder(path = PATH, overrides: Partial<FolderConfig> = {}): FolderConfig {
	return {
		path,
		subfolders: true,
		types: [],
		exclude: [...DEFAULT_EXCLUDE],
		target: null,
		reportChanges: true,
		...overrides
	};
}

function folderConnection(
	overrides: Partial<Connection> = {},
	folders: FolderConfig[] = [folder()]
): Connection {
	return {
		id: ID,
		type: 'folder',
		label: 'Projekte',
		enabled: true,
		secretEnv: '',
		allowlistEnv: '',
		lastRunAt: '2026-10-02 10:00:00.000Z',
		lastOkAt: '2026-10-02 10:00:00.000Z',
		lastError: '',
		lastHint: '',
		keywords: [],
		replySaved: true,
		replyNoMatch: true,
		mailProvider: '',
		mailUser: '',
		matchBody: false,
		folders: { interval: 5, folders },
		runningSince: null,
		created: '2026-10-02 09:00:00.000Z',
		updated: '2026-10-02 10:00:00.000Z',
		...overrides
	};
}

function summary(overrides: Partial<FolderSummary> = {}): FolderSummary {
	return {
		id: 'a1b2c3d4e5f60718',
		path: PATH,
		key: PATH.toLowerCase(),
		name: 'Projekte',
		subfolders: true,
		types: [],
		exclude: [...DEFAULT_EXCLUDE],
		target: null,
		reportChanges: true,
		files: 12,
		matching: 12,
		more: false,
		incomplete: false,
		pending: false,
		lastChange: {
			path: '2026/Angebot.pdf',
			action: 'added',
			at: '2026-10-02T08:03:00.000Z',
			from: null
		},
		baseAt: '2026-10-02T08:00:00.000Z',
		error: '',
		...overrides
	};
}

const DETAILS: FolderDetails = { ...EMPTY_FOLDER_DETAILS, folders: [summary()] };

function connectionsOf(first: Connection | null, flags = new FlagStore()) {
	let current = first;
	const data = {
		list: vi.fn<ConnectionsData['list']>(async () => (current === null ? [] : [current])),
		create: vi.fn<ConnectionsData['create']>(async (draft) => {
			current = folderConnection(
				{ label: draft.label.trim(), lastRunAt: null, lastOkAt: null },
				draft.folder ? [draft.folder] : []
			);
			return current;
		}),
		setEnabled: vi.fn<ConnectionsData['setEnabled']>(),
		rename: vi.fn<ConnectionsData['rename']>(),
		setTarget: vi.fn<ConnectionsData['setTarget']>(),
		saveSettings: vi.fn<ConnectionsData['saveSettings']>(),
		saveGitHub: vi.fn<ConnectionsData['saveGitHub']>(),
		saveFolders: vi.fn<ConnectionsData['saveFolders']>(async (_id, settings) => {
			current = {
				...(current as Connection),
				folders: settings,
				updated: '2026-10-02 10:30:00.000Z'
			};
			return current;
		}),
		remove: vi.fn<ConnectionsData['remove']>(),
		secretStatus: vi.fn<ConnectionsData['secretStatus']>(async () => ({
			secret: false,
			allowlist: null
		})),
		run: vi.fn<ConnectionsData['run']>(async () => ({
			status: 'ok',
			created: 0,
			duplicates: 0,
			updated: 0,
			skipped: 0,
			failed: 0,
			unmatched: 0,
			error: '',
			missing: []
		})),
		get: vi.fn<ConnectionsData['get']>(async () => ({
			...(current as Connection),
			lastRunAt: '2026-10-02 10:45:00.000Z',
			lastOkAt: '2026-10-02 10:45:00.000Z',
			updated: '2026-10-02 10:45:00.000Z'
		})),
		listMailbox: vi.fn<ConnectionsData['listMailbox']>(),
		importMailbox: vi.fn<ConnectionsData['importMailbox']>(),
		subscribe: vi.fn<ConnectionsData['subscribe']>(async () => async () => undefined),
		helperStatus: vi.fn<ConnectionsData['helperStatus']>(),
		scan: vi.fn<ConnectionsData['scan']>()
	} satisfies ConnectionsData;
	return {
		data,
		flags,
		store: new ConnectionsStore(data, { ensureValid: () => true, logout: vi.fn() }, flags)
	};
}

async function open(item: Connection = folderConnection(), details: FolderDetails = DETAILS) {
	const flags = new FlagStore();
	const connections = connectionsOf(item, flags);
	const data = fakeFoldersData();
	data.details.mockImplementation(async () => details);
	const folders = foldersStoreOf(data, flags);
	await connections.store.load();
	render(ChannelsViewHarness, {
		props: { connections: connections.store, folders, projects: [HAUS], onchange: vi.fn() }
	});
	await vi.waitFor(() => expect(screen.getByRole('article', { name: item.label })).toBeTruthy());
	return {
		connections,
		data,
		flags,
		card: within(screen.getByRole('article', { name: item.label }))
	};
}

/** The menu "•••" of the card; jsdom shows popovers as hidden. */
function cardMenu(card: ReturnType<typeof within>, label = 'Projekte') {
	const trigger = card.getByRole('button', { name: `Weitere Aktionen für ${label}` });
	const menu = within(document.getElementById(trigger.getAttribute('aria-controls') ?? '')!);
	const items = () =>
		menu.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim());
	return { trigger, menu, items };
}

afterEach(() => {
	document.body.innerHTML = '';
	sessionStorage.clear();
});

describe('folder card', () => {
	it('shows the folders with their details and offers "Jetzt prüfen" first, without variables', async () => {
		const { card, connections, data } = await open();
		expect(card.getByText('Ordner · Dateien beobachten, nur lesend')).toBeTruthy();
		expect(card.getByText('Verbunden')).toBeTruthy();
		expect(card.getByText(/^1 Ordner · Zuletzt geprüft/)).toBeTruthy();
		// Folders have no access data: the page never asks for the state of a variable.
		expect(connections.data.secretStatus).not.toHaveBeenCalled();
		const main = card.getByRole('button', { name: 'Jetzt prüfen: Projekte' });
		expect(main.hasAttribute('data-card-primary')).toBe(true);
		const { menu, items } = cardMenu(card);
		expect(items()).toEqual([
			'Ordner hinzufügen …',
			'Zielprojekt …',
			'Umbenennen …',
			'Pausieren',
			'Hilfe',
			'Löschen …'
		]);
		expect(menu.getByRole('menuitem', { name: 'Hilfe', hidden: true }).getAttribute('href')).toBe(
			'/einstellungen/hilfe#ordner'
		);
		expect(items().some((item) => item?.startsWith('Stichwörter'))).toBe(false);
		await vi.waitFor(() => expect(data.details).toHaveBeenCalledWith(ID, expect.anything()));

		await fireEvent.click(card.getByRole('button', { name: 'Details: Projekte' }));
		expect((card.getByLabelText('Prüfen') as HTMLSelectElement).value).toBe('5');
		const folders = within(card.getByRole('region', { name: 'Ordner von „Projekte“' }));
		expect(folders.getByText(PATH)).toBeTruthy();
		await vi.waitFor(() => expect(folders.getByText('12 Dateien')).toBeTruthy());
		expect(folders.getByText('2026/Angebot.pdf neu, 02.10.2026 10:03')).toBeTruthy();
		expect(folders.getByText('02.10.2026 12:00')).toBeTruthy();
		expect(folders.getByText('einbezogen')).toBeTruthy();
		expect(folders.getByText('alle')).toBeTruthy();
		expect(folders.getByText('wie die Verbindung')).toBeTruthy();
		expect(folders.getByText('werden gemeldet')).toBeTruthy();
		const exclude = within(folders.getByRole('list', { name: 'Ausschlüsse von Projekte' }));
		expect(exclude.getAllByRole('listitem').map((chip) => chip.textContent?.trim())).toEqual([
			...DEFAULT_EXCLUDE
		]);
		expect(folders.getByRole('button', { name: 'Einstellungen …: Projekte' })).toBeTruthy();
		expect(
			folders.getByRole('button', { name: 'Vorhandene Dateien übernehmen …: Projekte' })
		).toBeTruthy();
		expect(folders.getByRole('button', { name: 'Projekte entfernen …' }).className).toMatch(
			/button-icon/
		);
	});

	it('says a folder that is not reachable neutrally, never in red, and the limit of files', async () => {
		const problem =
			'Ordner nicht erreichbar: Er fehlt, die App darf ihn nicht lesen, oder das Laufwerk ist getrennt. Die bisherigen Dateien bleiben, bis er wieder erreichbar ist.';
		const { card } = await open(
			folderConnection({
				lastHint: '1 Ordner ist nicht erreichbar; der Grund steht in den Details.'
			}),
			{
				...DETAILS,
				folders: [
					summary({ error: problem, files: 2000, matching: 3120, more: true, pending: true })
				]
			}
		);
		expect(card.getByText('Verbunden')).toBeTruthy();
		await fireEvent.click(card.getByRole('button', { name: 'Details: Projekte' }));
		const folders = within(card.getByRole('region', { name: 'Ordner von „Projekte“' }));
		const message = await vi.waitFor(() => folders.getByText(problem));
		expect(message.closest('[data-tone]')?.getAttribute('data-tone')).toBe('warning');
		expect(folders.getByText('2.000 von 3.120 Dateien (höchstens 2.000 je Ordner)')).toBeTruthy();
		expect(
			folders.getByText('steht aus, der letzte Lauf kam nicht bis zu diesem Ordner')
		).toBeTruthy();
	});

	it('adds the first folder from the main button and checks once for the base', async () => {
		const { card, connections, flags } = await open(folderConnection({}, []), EMPTY_FOLDER_DETAILS);
		expect(card.getByText('Noch kein Ordner')).toBeTruthy();
		await fireEvent.click(card.getByRole('button', { name: 'Ordner hinzufügen …: Projekte' }));
		const dialog = within(screen.getByRole('dialog', { name: 'Ordner zu „Projekte“ hinzufügen' }));
		expect(
			(dialog.getByLabelText('Ausschlüsse, ein Muster je Zeile') as HTMLTextAreaElement).value
		).toBe(DEFAULT_EXCLUDE.join('\n'));
		expect((dialog.getByLabelText('Unterordner einbeziehen') as HTMLInputElement).checked).toBe(
			true
		);
		expect((dialog.getByLabelText('Änderungen melden') as HTMLInputElement).checked).toBe(true);
		await fireEvent.click(dialog.getByRole('button', { name: 'Hinzufügen' }));
		expect(dialog.getByText('Bitte den Pfad des Ordners eingeben.')).toBeTruthy();

		await fireEvent.input(dialog.getByLabelText('Pfad des Ordners (Pflichtfeld)'), {
			target: { value: 'C:\\' }
		});
		await fireEvent.click(dialog.getByRole('button', { name: 'Hinzufügen' }));
		expect(dialog.getByText(FOLDER_MESSAGES.validation_folder_root!)).toBeTruthy();
		expect(connections.data.saveFolders).not.toHaveBeenCalled();

		await fireEvent.input(dialog.getByLabelText('Pfad des Ordners (Pflichtfeld)'), {
			target: { value: 'c:/Daten/Projekte/' }
		});
		await fireEvent.input(dialog.getByLabelText('Dateitypen'), { target: { value: '.pdf, DOCX' } });
		await fireEvent.click(dialog.getByLabelText('Änderungen melden'));
		await fireEvent.change(dialog.getByLabelText('Zielprojekt dieses Ordners'), {
			target: { value: HAUS.id }
		});
		// The server checks the folder on the disk; its refusal stands in the dialog.
		connections.data.saveFolders.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					settings: {
						code: 'validation_folder_missing',
						message: FOLDER_MESSAGES.validation_folder_missing!
					}
				}
			})
		);
		await fireEvent.click(dialog.getByRole('button', { name: 'Hinzufügen' }));
		await vi.waitFor(() =>
			expect(dialog.getByRole('alert').textContent).toContain(
				FOLDER_MESSAGES.validation_folder_missing
			)
		);
		expect(connections.data.run).not.toHaveBeenCalled();

		await fireEvent.click(dialog.getByRole('button', { name: 'Hinzufügen' }));
		await vi.waitFor(() =>
			expect(connections.data.saveFolders).toHaveBeenLastCalledWith(ID, {
				interval: 5,
				folders: [folder(PATH, { types: ['pdf', 'docx'], reportChanges: false, target: HAUS.id })]
			})
		);
		await vi.waitFor(() =>
			expect(screen.queryByRole('dialog', { name: /hinzufügen$/ })).toBeNull()
		);
		await vi.waitFor(() => expect(connections.data.run).toHaveBeenCalledWith(ID));
		expect(flags.flags.map((flag) => flag.title)).toContain(
			'„Projekte“ zu „Projekte“ hinzugefügt.'
		);
	});

	it('changes the settings of a folder with its path fixed, and removes it after a question', async () => {
		const { card, connections } = await open();
		await fireEvent.click(card.getByRole('button', { name: 'Details: Projekte' }));
		await fireEvent.click(card.getByRole('button', { name: 'Einstellungen …: Projekte' }));
		const dialog = within(screen.getByRole('dialog', { name: 'Ordner „Projekte“ einstellen' }));
		expect(dialog.queryByLabelText('Pfad des Ordners (Pflichtfeld)')).toBeNull();
		expect(dialog.getByText(PATH)).toBeTruthy();
		await fireEvent.click(dialog.getByLabelText('Unterordner einbeziehen'));
		await fireEvent.input(dialog.getByLabelText('Ausschlüsse, ein Muster je Zeile'), {
			target: { value: '*.tmp\nArchiv/**' }
		});
		await fireEvent.click(dialog.getByRole('button', { name: 'Speichern' }));
		await vi.waitFor(() =>
			expect(connections.data.saveFolders).toHaveBeenLastCalledWith(ID, {
				interval: 5,
				folders: [folder(PATH, { subfolders: false, exclude: ['*.tmp', 'Archiv/**'] })]
			})
		);
		// Changing is no first check: nothing runs by itself.
		expect(connections.data.run).not.toHaveBeenCalled();

		await fireEvent.click(card.getByRole('button', { name: 'Projekte entfernen …' }));
		const question = within(
			screen.getByRole('dialog', { name: '„Projekte“ nicht mehr beobachten?' })
		);
		expect(question.getByText(/Die Dateien im Ordner bleiben unberührt\./)).toBeTruthy();
		await fireEvent.click(question.getByRole('button', { name: 'Entfernen' }));
		await vi.waitFor(() =>
			expect(connections.data.saveFolders).toHaveBeenLastCalledWith(ID, {
				interval: 5,
				folders: []
			})
		);
	});

	it('saves another interval at once', async () => {
		const { card, connections, flags } = await open();
		await fireEvent.click(card.getByRole('button', { name: 'Details: Projekte' }));
		await fireEvent.change(card.getByLabelText('Prüfen'), { target: { value: '15' } });
		await vi.waitFor(() =>
			expect(connections.data.saveFolders).toHaveBeenCalledWith(ID, {
				interval: 15,
				folders: [folder()]
			})
		);
		expect(flags.flags[0]?.title).toBe('„Projekte“ prüft jetzt alle 15 Minuten.');
	});

	it('names the restart when the server does not know the details yet', async () => {
		const flags = new FlagStore();
		const connections = connectionsOf(folderConnection(), flags);
		const data = fakeFoldersData();
		data.details.mockImplementation(async () => {
			throw new DataError('not_found', { status: 404 });
		});
		await connections.store.load();
		render(ChannelsViewHarness, {
			props: {
				connections: connections.store,
				folders: foldersStoreOf(data, flags),
				onchange: vi.fn()
			}
		});
		const card = within(await screen.findByRole('article', { name: 'Projekte' }));
		await fireEvent.click(card.getByRole('button', { name: 'Details: Projekte' }));
		await vi.waitFor(() =>
			expect(
				card.getByText(/^Die Details der Ordner sind nach dem nächsten Neustart verfügbar/)
			).toBeTruthy()
		);
		// Without details there is no list of files of before to choose from.
		expect(card.queryByRole('button', { name: /Vorhandene Dateien übernehmen/ })).toBeNull();
	});
});

describe('files of before', () => {
	const LIST: ExistingFiles = {
		folder: PATH,
		name: 'Projekte',
		base: true,
		files: [
			{
				path: '2025/Bericht.pdf',
				name: 'Bericht.pdf',
				size: 2048,
				modified: '2025-12-01T09:00:00.000Z',
				state: ''
			},
			{ path: 'Angebot.docx', name: 'Angebot.docx', size: 512, modified: '', state: 'new' },
			...Array.from({ length: 60 }, (_, index) => ({
				path: `Fotos/bild-${String(index).padStart(2, '0')}.jpg`,
				name: `bild-${index}.jpg`,
				size: 1024 * 1024,
				modified: '',
				state: '' as const
			}))
		]
	};

	it('chooses files, takes them over in blocks and announces the sum', async () => {
		const { card, data, flags } = await open();
		data.existing.mockImplementation(async () => LIST);
		data.adopt.mockImplementation(async (_id, _folder, paths) => ({
			created: paths.length,
			duplicates: 0,
			skipped: 0,
			failed: 0
		}));
		await fireEvent.click(card.getByRole('button', { name: 'Details: Projekte' }));
		await fireEvent.click(
			await vi.waitFor(() =>
				card.getByRole('button', { name: 'Vorhandene Dateien übernehmen …: Projekte' })
			)
		);
		const dialog = within(
			screen.getByRole('dialog', { name: 'Vorhandene Dateien aus „Projekte“ übernehmen' })
		);
		await vi.waitFor(() =>
			expect(data.existing).toHaveBeenCalledWith(ID, 'a1b2c3d4e5f60718', expect.anything())
		);
		// Nothing is chosen at first; a file with an entry cannot be chosen.
		const report = await dialog.findByLabelText(/^2025\/Bericht\.pdf/);
		expect((report as HTMLInputElement).checked).toBe(false);
		const offer = dialog.getByLabelText(/^Angebot\.docx/) as HTMLInputElement;
		expect(offer.disabled).toBe(true);
		expect(dialog.getByText('schon im Eingang')).toBeTruthy();
		expect(dialog.getByText(/geändert 01\.12\.2025 10:00 · 2 KB/)).toBeTruthy();

		await fireEvent.input(dialog.getByLabelText('Filtern'), { target: { value: 'fotos' } });
		expect(dialog.queryByLabelText(/^2025\/Bericht\.pdf/)).toBeNull();
		await fireEvent.click(dialog.getByRole('button', { name: 'Alle gefilterten auswählen' }));
		await fireEvent.input(dialog.getByLabelText('Filtern'), { target: { value: '' } });
		await fireEvent.click(dialog.getByLabelText(/^2025\/Bericht\.pdf/));
		expect(dialog.getByText('61 ausgewählt')).toBeTruthy();

		await fireEvent.click(dialog.getByRole('button', { name: '61 Dateien übernehmen' }));
		await vi.waitFor(() => expect(data.adopt).toHaveBeenCalledTimes(2));
		expect(data.adopt.mock.calls[0]?.[2]).toHaveLength(50);
		expect(data.adopt.mock.calls[1]?.[2]).toHaveLength(11);
		expect(data.adopt.mock.calls.flatMap((call) => call[2])).toContain('2025/Bericht.pdf');
		await vi.waitFor(() =>
			expect(screen.queryByRole('dialog', { name: /Vorhandene Dateien/ })).toBeNull()
		);
		expect(flags.flags[0]).toMatchObject({
			tone: 'success',
			title: '„Projekte“: 61 Dateien in den Eingang übernommen.'
		});
	});

	it('keeps the rest chosen when a block fails and says why', async () => {
		const { card, data } = await open();
		data.existing.mockImplementation(async () => LIST);
		data.adopt
			.mockImplementationOnce(async (_id, _folder, paths) => ({
				created: paths.length,
				duplicates: 0,
				skipped: 0,
				failed: 0
			}))
			.mockRejectedValueOnce(new DataError('network'));
		await fireEvent.click(card.getByRole('button', { name: 'Details: Projekte' }));
		await fireEvent.click(
			await vi.waitFor(() =>
				card.getByRole('button', { name: 'Vorhandene Dateien übernehmen …: Projekte' })
			)
		);
		const dialog = within(await screen.findByRole('dialog', { name: /Vorhandene Dateien/ }));
		await dialog.findByLabelText(/^2025\/Bericht\.pdf/);
		await fireEvent.click(dialog.getByRole('button', { name: 'Alle auswählen' }));
		expect(dialog.getByText('61 ausgewählt')).toBeTruthy();
		await fireEvent.click(dialog.getByRole('button', { name: '61 Dateien übernehmen' }));
		await vi.waitFor(() => expect(dialog.getByText('11 ausgewählt')).toBeTruthy());
		expect(screen.getByRole('dialog', { name: /Vorhandene Dateien/ })).toBeTruthy();
		expect(dialog.getAllByRole('alert').length).toBeGreaterThan(0);
	});

	it('asks for the first check before there is a base', async () => {
		const { card, data } = await open();
		data.existing.mockImplementation(async () => ({ ...LIST, base: false, files: [] }));
		await fireEvent.click(card.getByRole('button', { name: 'Details: Projekte' }));
		await fireEvent.click(
			await vi.waitFor(() =>
				card.getByRole('button', { name: 'Vorhandene Dateien übernehmen …: Projekte' })
			)
		);
		const dialog = within(await screen.findByRole('dialog', { name: /Vorhandene Dateien/ }));
		expect(await dialog.findByText(/Erst „Jetzt prüfen“ an der Karte/)).toBeTruthy();
		expect(dialog.queryByRole('button', { name: /übernehmen$/ })).toBeNull();
	});
});

describe('folder assistant', () => {
	it('creates the connection with its first folder and no variable, adds more inline and checks', async () => {
		const flags = new FlagStore();
		const connections = connectionsOf(null, flags);
		await connections.store.load();
		const onchange = vi.fn();
		render(ChannelsViewHarness, {
			props: {
				connections: connections.store,
				setup: { kind: 'ordner', connectionId: null },
				onchange
			}
		});
		const dialog = within(await screen.findByRole('dialog', { name: 'Ordner einrichten' }));
		const heading = () => dialog.getByRole('heading', { level: 3, name: /^Schritt \d von 4/ });
		expect(heading().textContent).toMatch(/Pfad des Ordners kopieren/);
		expect(dialog.getByText(/Oben in die Adressleiste klicken/)).toBeTruthy();
		await fireEvent.click(dialog.getByRole('button', { name: 'Weiter' }));
		expect(heading().textContent).toMatch(/Ordner hinzufügen/);
		expect(dialog.queryByLabelText(/Name der Variablen/)).toBeNull();

		await fireEvent.input(dialog.getByLabelText('Bezeichnung (Pflichtfeld)'), {
			target: { value: 'Projekte' }
		});
		await fireEvent.input(dialog.getByLabelText('Pfad des Ordners (Pflichtfeld)'), {
			target: { value: PATH }
		});
		await fireEvent.click(dialog.getByRole('button', { name: 'Verbindung anlegen' }));
		await vi.waitFor(() =>
			expect(connections.data.create).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'folder', label: 'Projekte', folder: folder() })
			)
		);
		expect(connections.data.secretStatus).not.toHaveBeenCalled();
		await vi.waitFor(() =>
			expect(onchange).toHaveBeenLastCalledWith({ kind: 'ordner', connectionId: ID })
		);

		// The same step lists the folder and takes another one inline (no dialog from a dialog).
		const list = within(await dialog.findByRole('region', { name: 'Beobachtete Ordner' }));
		expect(list.getByText(PATH)).toBeTruthy();
		await fireEvent.input(dialog.getByLabelText('Pfad des Ordners (Pflichtfeld)'), {
			target: { value: 'D:\\Archiv' }
		});
		await fireEvent.click(dialog.getByRole('button', { name: 'Ordner hinzufügen' }));
		await vi.waitFor(() =>
			expect(connections.data.saveFolders).toHaveBeenCalledWith(ID, {
				interval: 5,
				folders: [folder(), folder('D:\\Archiv')]
			})
		);
		await vi.waitFor(() => expect(list.getByText('D:\\Archiv')).toBeTruthy());
		expect(screen.getAllByRole('dialog')).toHaveLength(1);

		await fireEvent.click(dialog.getByRole('button', { name: /Prüfen/ }));
		expect(heading().textContent).toMatch(/Ordner zum ersten Mal prüfen/);
		await fireEvent.click(dialog.getByRole('button', { name: 'Jetzt prüfen' }));
		await vi.waitFor(() => expect(connections.data.run).toHaveBeenCalledWith(ID));
		await vi.waitFor(() => expect(dialog.getByText('Geprüft')).toBeTruthy());
	});
});
