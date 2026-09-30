// Notion on the page "Kanäle" (ADR-0041, plan notion-import NI-2): the card with the sources taken
// over so far, "Erneut abrufen" and "Verbindung prüfen"; the import dialog with the choice of the
// source, the preview, the selection after ADR-0036 (head checkbox, Shift for a range, blocked
// entries), the options and the result; the assistant with its six steps and "Listen übernehmen …"
// after the check, which closes it before the dialog opens. Fakes instead of PocketBase (the
// routes: tests/integration/notion-import.test.mjs).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { Connection } from '$lib/domain/connections';
import type {
	NotionImportedSource,
	NotionPreview,
	NotionPreviewItem,
	NotionSource
} from '$lib/domain/notion';
import { ConnectionsStore, type ConnectionsData } from '$lib/stores/connections.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import ChannelsViewHarness from '$lib/test/ChannelsViewHarness.svelte';
import {
	EMPTY_PREVIEW,
	fakeNotionData,
	notionStoreOf,
	type FakeNotionData
} from '$lib/test/notion-fake';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

useOverlayStubs();

const ID = 'conn00000000005';
const PAGE_ID = '00000000-0000-4000-8000-0000000000b1';
const DB_ID = '00000000-0000-4000-8000-0000000000b2';

function notionConnection(overrides: Partial<Connection> = {}): Connection {
	return {
		id: ID,
		type: 'notion',
		label: 'Notion',
		enabled: true,
		secretEnv: 'BYL_NOTION_TOKEN',
		allowlistEnv: '',
		lastRunAt: '2026-09-29 10:00:00.000Z',
		lastOkAt: '2026-09-29 10:00:00.000Z',
		lastError: '',
		lastHint: '',
		keywords: [],
		replyNoMatch: true,
		mailProvider: '',
		mailUser: '',
		matchBody: false,
		runningSince: null,
		created: '2026-09-29 09:00:00.000Z',
		updated: '2026-09-29 10:00:00.000Z',
		...overrides
	};
}

function connectionsOf(item: Connection) {
	const data = {
		list: vi.fn<ConnectionsData['list']>(async () => [item]),
		create: vi.fn<ConnectionsData['create']>(),
		setEnabled: vi.fn<ConnectionsData['setEnabled']>(),
		saveSettings: vi.fn<ConnectionsData['saveSettings']>(),
		remove: vi.fn<ConnectionsData['remove']>(),
		secretStatus: vi.fn<ConnectionsData['secretStatus']>(async () => ({
			secret: true,
			allowlist: null
		})),
		run: vi.fn<ConnectionsData['run']>(),
		get: vi.fn<ConnectionsData['get']>(async () => item),
		listMailbox: vi.fn<ConnectionsData['listMailbox']>(),
		importMailbox: vi.fn<ConnectionsData['importMailbox']>(),
		subscribe: vi.fn<ConnectionsData['subscribe']>(async () => async () => undefined),
		helperStatus: vi.fn<ConnectionsData['helperStatus']>(),
		scan: vi.fn<ConnectionsData['scan']>()
	} satisfies ConnectionsData;
	return {
		data,
		store: new ConnectionsStore(data, { ensureValid: () => true, logout: vi.fn() }, new FlagStore())
	};
}

const IMPORTED: NotionImportedSource[] = [
	{
		id: PAGE_ID,
		type: 'page',
		title: 'Wochenplan',
		url: 'https://www.notion.so/Wochenplan-b1',
		count: 3,
		last: '2026-09-29 10:00:00.000Z',
		dateProperty: '',
		copyContent: false
	},
	{
		id: DB_ID,
		type: 'data_source',
		title: 'Aufgaben Haushalt',
		url: 'https://www.notion.so/db',
		count: 5,
		last: '2026-09-28 10:00:00.000Z',
		dateProperty: 'Fällig',
		copyContent: false
	}
];

const SOURCES: NotionSource[] = [
	{
		id: DB_ID,
		type: 'data_source',
		title: 'Aufgaben Haushalt',
		url: 'https://www.notion.so/db',
		edited: null
	},
	{
		id: PAGE_ID,
		type: 'page',
		title: 'Wochenplan',
		url: 'https://www.notion.so/Wochenplan-b1',
		edited: null
	}
];

function point(
	ref: string,
	title: string,
	overrides: Partial<NotionPreviewItem> = {}
): NotionPreviewItem {
	return {
		ref,
		kind: 'todo',
		title,
		sourceDate: null,
		allDay: false,
		excerpt: '',
		section: 'Einkauf',
		done: false,
		url: '',
		state: '',
		message: '',
		...overrides
	};
}

const PAGE_PREVIEW: NotionPreview = {
	...EMPTY_PREVIEW,
	source: {
		id: PAGE_ID,
		type: 'page',
		title: 'Wochenplan',
		url: 'https://www.notion.so/Wochenplan-b1'
	},
	items: [
		point('p1', 'Milch'),
		point('p2', 'Brot', { done: true }),
		point('p3', 'Äpfel', { excerpt: 'Boskop Elstar' }),
		point('p4', 'Eier', { state: 'discarded', message: 'Schon verworfen.' }),
		point('p5', 'Zahnarzt anrufen', {
			section: 'Termine',
			sourceDate: '2026-10-01 22:00:00.000Z',
			allDay: true
		})
	],
	blankPoints: 1
};

async function open(
	item: Connection = notionConnection(),
	configure: (data: FakeNotionData) => void = () => undefined
) {
	const connections = connectionsOf(item);
	const data = fakeNotionData();
	data.imports.mockImplementation(async () => IMPORTED);
	data.sources.mockImplementation(async () => ({
		kind: 'ok',
		value: { sources: SOURCES, truncated: false }
	}));
	data.preview.mockImplementation(async () => ({ kind: 'ok', value: PAGE_PREVIEW }));
	configure(data);
	const flags = new FlagStore();
	const notion = notionStoreOf(data, flags);
	await connections.store.load();
	const onchange = vi.fn();
	render(ChannelsViewHarness, { props: { connections: connections.store, notion, onchange } });
	await vi.waitFor(() => expect(screen.getByRole('article', { name: 'Notion' })).toBeTruthy());
	return {
		connections,
		data,
		flags,
		onchange,
		card: within(screen.getByRole('article', { name: 'Notion' }))
	};
}

afterEach(() => {
	document.body.innerHTML = '';
	sessionStorage.clear();
});

/** The menu "•••" of the Notion card; jsdom shows popovers as hidden. */
function notionMenu(card: ReturnType<typeof within>) {
	const trigger = card.getByRole('button', { name: 'Weitere Aktionen für Notion' });
	const menu = within(document.getElementById(trigger.getAttribute('aria-controls') ?? '')!);
	const items = () =>
		menu.getAllByRole('menuitem', { hidden: true }).map((item) => item.textContent?.trim());
	return { trigger, menu, items };
}

describe('Notion card', () => {
	it('shows the imported sources and offers import, check and "Erneut abrufen", no run and no pause', async () => {
		const { card } = await open();
		expect(card.getByText('Notion · Listen übernehmen, nur lesend')).toBeTruthy();
		expect(card.getByText('Verbunden')).toBeTruthy();
		await vi.waitFor(() =>
			expect(card.getByText(/^8 Einträge aus 2 Quellen übernommen( · |$)/)).toBeTruthy()
		);
		// The card building block (KK-2): one main button, the rest in the menu "•••", the sources
		// in the details.
		const main = card.getByRole('button', { name: 'Listen übernehmen …: Notion' });
		expect(main.hasAttribute('data-card-primary')).toBe(true);
		expect(main.getAttribute('aria-haspopup')).toBe('dialog');
		const { menu, items } = notionMenu(card);
		expect(items()).toEqual(['Verbindung prüfen', 'Einrichtung ansehen', 'Hilfe', 'Löschen …']);
		expect(menu.getByRole('menuitem', { name: 'Hilfe', hidden: true }).getAttribute('href')).toBe(
			'/einstellungen/hilfe#notion'
		);
		await fireEvent.click(card.getByRole('button', { name: 'Details: Notion' }));
		const list = within(card.getByRole('region', { name: 'Bisher übernommen' }));
		expect(list.getByRole('link', { name: /Wochenplan/ }).getAttribute('href')).toBe(
			'https://www.notion.so/Wochenplan-b1'
		);
		expect(list.getByText(/^Seite · 3 Einträge · zuletzt/)).toBeTruthy();
		expect(list.getByRole('button', { name: 'Erneut abrufen: Aufgaben Haushalt' })).toBeTruthy();
		expect(card.queryByRole('button', { name: /Jetzt abrufen/ })).toBeNull();
		expect(items()).not.toContain('Pausieren');
		expect(items().some((item) => item?.startsWith('Stichwörter'))).toBe(false);
		expect(
			card.queryByText('Keine Stichwörter: Diese Verbindung übernimmt nichts automatisch.')
		).toBeNull();
	});

	it('takes only new entries with "Erneut abrufen" and says so in a flag', async () => {
		const { card, data, flags } = await open();
		await fireEvent.click(card.getByRole('button', { name: 'Details: Notion' }));
		await vi.waitFor(() =>
			expect(card.getByRole('button', { name: 'Erneut abrufen: Wochenplan' })).toBeTruthy()
		);
		await fireEvent.click(card.getByRole('button', { name: 'Erneut abrufen: Wochenplan' }));
		await vi.waitFor(() => expect(data.importBatch).toHaveBeenCalledOnce());
		expect(data.preview).toHaveBeenCalledWith(ID, { type: 'page', id: PAGE_ID }, null, {
			signal: undefined
		});
		expect(data.importBatch.mock.calls[0]?.[1]).toMatchObject({
			refs: ['p1', 'p3', 'p5'],
			skipDone: true
		});
		await vi.waitFor(() =>
			expect(flags.flags[0]?.title).toBe(
				'„Wochenplan“: 3 angelegt, 1 schon vorhanden, 1 übersprungen.'
			)
		);
	});

	it('checks the connection and reads it again', async () => {
		const { card, data, connections, flags } = await open();
		const { trigger, menu } = notionMenu(card);
		await fireEvent.click(trigger);
		await fireEvent.click(menu.getByRole('menuitem', { name: 'Verbindung prüfen', hidden: true }));
		await vi.waitFor(() => expect(data.check).toHaveBeenCalledWith(ID));
		await vi.waitFor(() => expect(connections.data.get).toHaveBeenCalledWith(ID));
		expect(flags.flags[0]?.title).toMatch(/^„Notion“: Verbunden mit dem Arbeitsbereich „Beispiel“/);
	});

	it('leads a card without the variable to its setup', async () => {
		const connections = connectionsOf(notionConnection());
		connections.data.secretStatus.mockResolvedValue({ secret: false, allowlist: null });
		await connections.store.load();
		render(ChannelsViewHarness, {
			props: { connections: connections.store, notion: notionStoreOf(), onchange: vi.fn() }
		});
		const card = within(await screen.findByRole('article', { name: 'Notion' }));
		expect(card.getByText('Einrichtung offen')).toBeTruthy();
		expect(card.getByRole('button', { name: 'Einrichtung fortsetzen: Notion' })).toBeTruthy();
		expect(card.queryByRole('button', { name: /Listen übernehmen/ })).toBeNull();
		expect(notionMenu(card).items()).not.toContain('Verbindung prüfen');
	});
});

describe('Notion import dialog', () => {
	async function openDialog(configure: (data: FakeNotionData) => void = () => undefined) {
		const context = await open(notionConnection(), configure);
		await fireEvent.click(
			context.card.getByRole('button', { name: 'Listen übernehmen …: Notion' })
		);
		const dialog = within(
			screen.getByRole('dialog', { name: 'Listen aus Notion übernehmen: Notion' })
		);
		await vi.waitFor(() => expect(dialog.getByRole('group', { name: 'Seiten' })).toBeTruthy());
		return { ...context, dialog };
	}

	it('lists databases and pages, marks what came before, and searches by title', async () => {
		const { dialog, data } = await openDialog();
		const databases = within(dialog.getByRole('group', { name: 'Datenbanken' }));
		expect(databases.getByRole('radio', { name: /^Aufgaben Haushalt/ })).toBeTruthy();
		expect(dialog.getByText('Seite · schon übernommen: 3 Einträge')).toBeTruthy();
		await fireEvent.input(dialog.getByRole('searchbox'), { target: { value: 'woche' } });
		await fireEvent.click(dialog.getByRole('button', { name: 'Suchen' }));
		await vi.waitFor(() =>
			expect(data.sources).toHaveBeenLastCalledWith(ID, 'woche', expect.anything())
		);
	});

	it('previews a page, chooses the open points and takes them into the inbox', async () => {
		const { dialog, data } = await openDialog();
		await fireEvent.click(dialog.getByRole('radio', { name: /^Wochenplan/ }));
		await fireEvent.click(dialog.getByRole('button', { name: 'Weiter' }));
		await vi.waitFor(() =>
			expect(dialog.getByRole('heading', { name: 'Wochenplan' })).toBeTruthy()
		);
		expect(
			dialog.getByText(
				'5 Einträge, davon 1 schon im Eingang, 1 erledigt. 1 leerer Punkt ausgelassen.'
			)
		).toBeTruthy();

		const milk = dialog.getByRole('checkbox', { name: /^Milch/ }) as HTMLInputElement;
		const bread = dialog.getByRole('checkbox', { name: /^Brot/ }) as HTMLInputElement;
		const eggs = dialog.getByRole('checkbox', { name: /^Eier/ }) as HTMLInputElement;
		expect(milk.checked).toBe(true);
		expect(bread.disabled).toBe(true);
		expect(eggs.disabled).toBe(true);
		expect(dialog.getByText('Schon verworfen.')).toBeTruthy();
		expect(dialog.getByText(/02\.10\.2026 · Abschnitt „Termine“/)).toBeTruthy();

		// "Erledigte überspringen" off: the done point can be chosen, but is not chosen by itself.
		await fireEvent.click(dialog.getByRole('checkbox', { name: 'Erledigte überspringen' }));
		expect(bread.disabled).toBe(false);
		expect(bread.checked).toBe(false);

		// The head checkbox clears all, then a click and a Shift+click choose a range.
		const head = dialog.getByRole('checkbox', {
			name: 'Alle wählbaren Einträge auswählen'
		}) as HTMLInputElement;
		expect(head.indeterminate).toBe(true);
		await fireEvent.click(head);
		await fireEvent.click(head);
		expect(dialog.getByText('0 ausgewählt')).toBeTruthy();
		await fireEvent.click(milk);
		const apples = dialog.getByRole('checkbox', { name: /^Äpfel/ });
		await fireEvent.pointerDown(apples.closest('label') as HTMLElement, { shiftKey: true });
		await fireEvent.click(apples);
		expect(dialog.getByText('3 ausgewählt')).toBeTruthy();

		await fireEvent.click(
			dialog.getByRole('button', { name: '3 Einträge in den Eingang übernehmen' })
		);
		await vi.waitFor(() =>
			expect(dialog.getByRole('heading', { name: /In den Eingang übernommen$/ })).toBeTruthy()
		);
		expect(data.importBatch).toHaveBeenCalledWith(ID, {
			source: { type: 'page', id: PAGE_ID },
			refs: ['p1', 'p2', 'p3'],
			skipDone: false,
			copyContent: false,
			dateProperty: null
		});
		expect(dialog.getAllByText('Jetzt im Eingang.')).toHaveLength(3);
		expect(dialog.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
	});

	it('offers page content and the date property for a database', async () => {
		const database: NotionPreview = {
			...EMPTY_PREVIEW,
			source: {
				id: DB_ID,
				type: 'data_source',
				title: 'Aufgaben Haushalt',
				url: 'https://www.notion.so/db'
			},
			dateProperties: ['Fällig', 'Erinnerung'],
			dateProperty: 'Fällig',
			items: [point('r1', 'Fenster putzen', { kind: 'task', section: '' })]
		};
		// Like the server, the preview answers with the date property it was asked for.
		const { dialog, data } = await openDialog((fake) =>
			fake.preview.mockImplementation(async (_id, _source, dateProperty) => ({
				kind: 'ok',
				value: { ...database, dateProperty: dateProperty ?? 'Fällig' }
			}))
		);
		await fireEvent.click(dialog.getByRole('radio', { name: /^Aufgaben Haushalt/ }));
		await fireEvent.click(dialog.getByRole('button', { name: 'Weiter' }));
		await vi.waitFor(() =>
			expect(dialog.getByRole('combobox', { name: 'Datum aus' })).toBeTruthy()
		);
		expect(dialog.getByText(/höchstens 500 Blöcke und 50\.000 Zeichen je Seite/)).toBeTruthy();
		await fireEvent.change(dialog.getByRole('combobox', { name: 'Datum aus' }), {
			target: { value: 'Erinnerung' }
		});
		await vi.waitFor(() =>
			expect(data.preview).toHaveBeenLastCalledWith(
				ID,
				{ type: 'data_source', id: DB_ID },
				'Erinnerung',
				expect.anything()
			)
		);
		await fireEvent.click(
			dialog.getByRole('checkbox', { name: 'Seiteninhalt als Kopie mitnehmen' })
		);
		await fireEvent.click(
			dialog.getByRole('button', { name: '1 Eintrag in den Eingang übernehmen' })
		);
		await vi.waitFor(() => expect(data.importBatch).toHaveBeenCalledOnce());
		expect(data.importBatch.mock.calls[0]?.[1]).toEqual({
			source: { type: 'data_source', id: DB_ID },
			refs: ['r1'],
			skipDone: true,
			copyContent: true,
			dateProperty: 'Erinnerung'
		});
	});

	describe('taking 45 rows over (fix 2026-09-30)', () => {
		const database = (count: number): NotionPreview => ({
			...EMPTY_PREVIEW,
			source: {
				id: DB_ID,
				type: 'data_source',
				title: 'Aufgaben Haushalt',
				url: 'https://www.notion.so/db'
			},
			items: Array.from({ length: count }, (_, index) =>
				point(`r${index + 1}`, `Zeile ${index + 1}`, { kind: 'task', section: '' })
			)
		});

		async function openDatabase(
			count: number,
			configure: (data: FakeNotionData) => void = () => undefined
		) {
			const context = await openDialog((fake) => {
				fake.preview.mockImplementation(async () => ({ kind: 'ok', value: database(count) }));
				configure(fake);
			});
			const { dialog } = context;
			await fireEvent.click(dialog.getByRole('radio', { name: /^Aufgaben Haushalt/ }));
			await fireEvent.click(dialog.getByRole('button', { name: 'Weiter' }));
			const submit = await vi.waitFor(() =>
				dialog.getByRole('button', { name: `${count} Einträge in den Eingang übernehmen` })
			);
			return { ...context, submit };
		}

		/** Every block of the import waits until the test releases it. */
		function holdBlocks(data: FakeNotionData) {
			const waiting: Array<() => void> = [];
			const answer = data.importBatch.getMockImplementation();
			data.importBatch.mockImplementation(async (id, request) => {
				await new Promise<void>((resolve) => waiting.push(resolve));
				return answer!(id, request);
			});
			return async () => {
				await vi.waitFor(() => expect(waiting.length).toBeGreaterThan(0));
				waiting.shift()?.();
			};
		}

		function chosenRows(dialog: ReturnType<typeof within>): number {
			return dialog
				.getAllByRole('checkbox', { name: /^Zeile / })
				.filter((box: HTMLElement) => (box as HTMLInputElement).checked).length;
		}

		function before(first: Element, second: Element): boolean {
			return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
		}

		it('keeps the selection, says what runs and shows the progress above the list', async () => {
			let release: () => Promise<void> = async () => undefined;
			const { dialog, data, submit } = await openDatabase(45, (fake) => {
				release = holdBlocks(fake);
			});
			await fireEvent.click(submit);

			expect(submit.textContent?.trim()).toBe('45 Einträge werden übernommen …');
			expect(submit.getAttribute('aria-disabled')).toBe('true');
			expect(submit.getAttribute('aria-busy')).toBe('true');
			const progress = dialog.getByText('0 von 45 bearbeitet …');
			const list = dialog.getByRole('group', { name: 'Einträge von Aufgaben Haushalt' });
			expect(before(progress, list)).toBe(true);
			expect(chosenRows(dialog)).toBe(45);
			expect(dialog.getByRole('button', { name: 'Nach diesem Block anhalten' })).toBeTruthy();
			expect(dialog.queryByRole('button', { name: 'Andere Quelle' })).toBeNull();
			expect(dialog.queryByRole('button', { name: 'Abbrechen' })).toBeNull();

			await release();
			await vi.waitFor(() => expect(dialog.getByText('10 von 45 bearbeitet …')).toBeTruthy());
			// Only what is in the inbox now leaves the selection.
			expect(dialog.getAllByText('Jetzt im Eingang.')).toHaveLength(10);
			expect(chosenRows(dialog)).toBe(35);
			expect(submit.textContent?.trim()).toBe('45 Einträge werden übernommen …');

			for (let block = 0; block < 4; block++) await release();
			await vi.waitFor(() =>
				expect(dialog.getByRole('heading', { name: /In den Eingang übernommen$/ })).toBeTruthy()
			);
			expect(data.importBatch.mock.calls.map(([, request]) => request.refs.length)).toEqual([
				10, 10, 10, 10, 5
			]);
			const result = dialog.getByText('45 angelegt.');
			expect(before(result, list)).toBe(true);
			expect(dialog.getByRole('link', { name: 'Im Eingang ansehen' }).getAttribute('href')).toBe(
				'/eingang?quelle=notion'
			);
			// Nothing is left to take: no "0 Einträge …" button with a busy pointer, "Schließen" leads.
			expect(dialog.queryByRole('button', { name: /in den Eingang übernehmen$/ })).toBeNull();
			// The footer button, not the × of the head (named "Schließen" as well).
			const close = dialog.getByText('Schließen', { selector: 'button' });
			expect(close.classList.contains('button-primary')).toBe(true);
			expect(document.activeElement).toBe(close);
		});

		it('keeps failed and unsent entries chosen, names the error and takes them on a retry', async () => {
			const { dialog, data, submit } = await openDatabase(45, (fake) => {
				const answer = fake.importBatch.getMockImplementation();
				fake.importBatch
					.mockImplementationOnce(async (id, request) => answer!(id, request))
					.mockImplementationOnce(async () => ({
						kind: 'error',
						message:
							'Notion bremst gerade die Anfragen (429). Bitte in einer Minute erneut versuchen.',
						reason: 'source',
						partial: null
					}));
			});
			await fireEvent.click(submit);
			const alert = await vi.waitFor(() => dialog.getByRole('alert'));
			expect(alert.textContent).toContain('Übernahme unterbrochen');
			expect(alert.textContent).toContain(
				'10 angelegt. Notion bremst gerade die Anfragen (429). Bitte in einer Minute erneut versuchen. 35 Einträge noch nicht übernommen; sie bleiben ausgewählt'
			);
			expect(chosenRows(dialog)).toBe(35);
			const retry = dialog.getByRole('button', { name: '35 Einträge in den Eingang übernehmen' });
			expect(retry.getAttribute('aria-disabled')).toBeNull();

			await fireEvent.click(retry);
			await vi.waitFor(() => expect(dialog.getByText('35 angelegt.')).toBeTruthy());
			expect(data.importBatch.mock.calls.slice(2).flatMap(([, request]) => request.refs)).toEqual(
				Array.from({ length: 35 }, (_, index) => `r${index + 11}`)
			);
		});

		it('lists entries that failed with their reason and keeps them chosen', async () => {
			const { dialog, submit } = await openDatabase(3, (fake) =>
				fake.importBatch.mockImplementation(async (_id, request) => ({
					kind: 'ok',
					value: {
						items: request.refs.map((ref) =>
							ref === 'r2'
								? {
										ref,
										status: 'failed' as const,
										message: 'Der Eintrag ließ sich nicht speichern.'
									}
								: { ref, status: 'created' as const, message: '' }
						),
						counts: { created: 2, duplicates: 0, skipped: 0, failed: 1 },
						pending: []
					}
				}))
			);
			await fireEvent.click(submit);
			const failures = await vi.waitFor(() =>
				dialog.getByRole('heading', { name: 'Nicht übernommen' })
			);
			expect(failures.parentElement?.textContent).toContain(
				'„Zeile 2“: Der Eintrag ließ sich nicht speichern.'
			);
			expect(dialog.getByText(/^2 angelegt, 1 mit Fehler\./)).toBeTruthy();
			expect((dialog.getByRole('checkbox', { name: /^Zeile 2/ }) as HTMLInputElement).checked).toBe(
				true
			);
			expect(
				dialog.getByRole('button', { name: '1 Eintrag in den Eingang übernehmen' })
			).toBeTruthy();
		});

		it('starts one import for two clicks and sends every entry once', async () => {
			let release: () => Promise<void> = async () => undefined;
			const { dialog, data, submit } = await openDatabase(45, (fake) => {
				release = holdBlocks(fake);
			});
			await fireEvent.click(submit);
			await fireEvent.click(submit);
			for (let block = 0; block < 5; block++) await release();
			await vi.waitFor(() => expect(dialog.getByText('45 angelegt.')).toBeTruthy());
			const sent = data.importBatch.mock.calls.flatMap(([, request]) => request.refs);
			expect(sent).toHaveLength(45);
			expect(new Set(sent).size).toBe(45);
		});

		it('stops after the current block on request or with Esc, the rest stays chosen', async () => {
			let release: () => Promise<void> = async () => undefined;
			const { dialog, data, submit } = await openDatabase(45, (fake) => {
				release = holdBlocks(fake);
			});
			await fireEvent.click(submit);
			await fireEvent.click(dialog.getByRole('button', { name: 'Nach diesem Block anhalten' }));
			expect(dialog.getByRole('button', { name: 'Hält nach diesem Block an …' })).toBeTruthy();
			expect(dialog.getByText('0 von 45 bearbeitet … Hält nach diesem Block an.')).toBeTruthy();
			await release();
			await vi.waitFor(() =>
				expect(dialog.getByRole('heading', { name: /Angehalten$/ })).toBeTruthy()
			);
			expect(data.importBatch).toHaveBeenCalledOnce();
			expect(dialog.getByText(/^10 angelegt\. 35 Einträge noch nicht übernommen/)).toBeTruthy();
			expect(chosenRows(dialog)).toBe(35);

			await fireEvent.click(
				dialog.getByRole('button', { name: '35 Einträge in den Eingang übernehmen' })
			);
			await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
			await release();
			await vi.waitFor(() => expect(dialog.getByText(/^10 angelegt\. 25 Einträge/)).toBeTruthy());
			expect(data.importBatch).toHaveBeenCalledTimes(2);
			expect(screen.getByRole('dialog')).toBeTruthy();
		});

		it('names a failed request instead of staying silent and keeps everything chosen', async () => {
			const { dialog, submit } = await openDatabase(45, (fake) =>
				fake.importBatch.mockRejectedValue(new DataError('network'))
			);
			await fireEvent.click(submit);
			const alert = await vi.waitFor(() => dialog.getByRole('alert'));
			expect(alert.textContent).toContain('Server nicht erreichbar');
			expect(alert.textContent).toContain('45 Einträge noch nicht übernommen');
			expect(chosenRows(dialog)).toBe(45);
			expect(
				dialog.getByRole('button', { name: '45 Einträge in den Eingang übernehmen' })
			).toBeTruthy();
		});
	});

	it('names an error of Notion and a source that is not shared', async () => {
		const { dialog } = await openDialog((fake) =>
			fake.preview.mockImplementation(async () => ({
				kind: 'error',
				message: 'Diese Quelle ist nicht freigegeben oder gelöscht (404).',
				reason: 'source'
			}))
		);
		await fireEvent.click(dialog.getByRole('radio', { name: /^Wochenplan/ }));
		await fireEvent.click(dialog.getByRole('button', { name: 'Weiter' }));
		await vi.waitFor(() =>
			expect(
				dialog.getByText('Diese Quelle ist nicht freigegeben oder gelöscht (404).')
			).toBeTruthy()
		);
		expect(dialog.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy();
		await fireEvent.click(dialog.getByRole('button', { name: 'Andere Quelle' }));
		expect(dialog.getByRole('heading', { name: 'Quelle wählen' })).toBeTruthy();
	});
});

describe('Notion assistant', () => {
	async function openSetup(item: Connection) {
		const connections = connectionsOf(item);
		const data = fakeNotionData();
		const notion = notionStoreOf(data);
		await connections.store.load();
		const onchange = vi.fn();
		render(ChannelsViewHarness, {
			props: {
				connections: connections.store,
				notion,
				setup: { kind: 'notion', connectionId: ID },
				onchange
			}
		});
		await tick();
		await tick();
		return {
			data,
			onchange,
			dialog: within(screen.getByRole('dialog', { name: 'Notion einrichten' }))
		};
	}

	it('waits at "Freigeben" until Notion answered and sees a page', async () => {
		const { dialog } = await openSetup(notionConnection({ lastRunAt: null, lastOkAt: null }));
		expect(
			dialog.getByRole('heading', {
				level: 3,
				name: /^Schritt 5 von 6: Seiten und Datenbanken freigeben/
			})
		).toBeTruthy();
		expect(dialog.getByText(/„•••“ klicken, dann auf „Verbindungen“/)).toBeTruthy();
	});

	it('checks in the last step and leads to the import, closing itself first', async () => {
		const { dialog, data, onchange } = await openSetup(
			notionConnection({ lastRunAt: null, lastOkAt: null })
		);
		await fireEvent.click(dialog.getByRole('button', { name: /Prüfen, offen/ }));
		await fireEvent.click(dialog.getByRole('button', { name: 'Verbindung prüfen' }));
		await vi.waitFor(() => expect(data.check).toHaveBeenCalledWith(ID));
		await vi.waitFor(() =>
			expect(dialog.getByRole('heading', { name: /Verbindung steht$/ })).toBeTruthy()
		);
		expect(dialog.getByText(/Verbunden mit dem Arbeitsbereich „Beispiel“/)).toBeTruthy();
		await fireEvent.click(dialog.getByRole('button', { name: 'Listen übernehmen …' }));
		expect(onchange).toHaveBeenLastCalledWith(null);
		await vi.waitFor(() =>
			expect(
				screen.getByRole('dialog', { name: 'Listen aus Notion übernehmen: Notion' })
			).toBeTruthy()
		);
		expect(screen.queryByRole('dialog', { name: 'Notion einrichten' })).toBeNull();
	});
});
