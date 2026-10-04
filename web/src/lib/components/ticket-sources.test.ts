// Section "Quellen" of a ticket and "Quelle hinzufügen …" (ADR-0031 section 7): rows with channel,
// date, sender or chat or address, main source and copy status; "Ansehen", the original file and
// "Lösen" as named icon buttons; the dialog of new inbox entries. Real store with fake data.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MEMBER_CONTEXT, PC_CONTEXT, REMOTE_CONTEXT, useContext } from '$lib/test/context';
import type { RecordChange } from '$lib/data/realtime';
import type { ConnectionName } from '$lib/domain/connections';
import type { InboxItemSummary } from '$lib/domain/inbox';
import { ConnectionNamesStore } from '$lib/stores/connection-names.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { LiveHealth } from '$lib/stores/live-health.svelte';
import { TicketSourcesStore, type TicketSourcesData } from '$lib/stores/ticket-sources.svelte';
import { alreadyLinkedReason } from '$lib/domain/ticket-picker';
import { FolderViewer, type FileOpener } from '$lib/stores/folder-view.svelte';
import ConnectionNamesHarness from '$lib/test/ConnectionNamesHarness.svelte';
import FolderViewerHarness from '$lib/test/FolderViewerHarness.svelte';
import InModalHarness from '$lib/test/InModalHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { fakePickerSource, pickerTicket } from '$lib/test/ticket-picker-fake';
import TicketSources from './TicketSources.svelte';

useOverlayStubs();

const TICKET = { id: 'ticket000000001', key: 'TASK-4', sourceItem: 'main00000000001' };
/** Open tickets of the picker of "Anderem Ticket zuordnen …" (ADR-0042). */
const PICKER = fakePickerSource({
	open: [
		pickerTicket({ id: TICKET.id, key: 'TASK-4', title: 'Dieses' }),
		pickerTicket({ id: 'ticket000000013', key: 'HAUS-13', title: 'Anderes' })
	]
});

function item(id: string, overrides: Partial<InboxItemSummary> = {}): InboxItemSummary {
	return {
		id,
		channel: 'telegram',
		kind: 'message',
		title: `Nachricht ${id}`,
		sourceUrl: '',
		sourceRef: `42:${id}`,
		sourceDate: null,
		sourceMeta: {},
		original: '',
		state: 'converted',
		ticketId: TICKET.id,
		handledAt: '2026-09-25 09:00:00.000Z',
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 09:00:00.000Z',
		...overrides
	};
}

const MAIN = item('main00000000001', {
	channel: 'eml',
	kind: 'mail',
	title: 'Rechnung März',
	original: 'mail_abc.eml',
	sourceDate: '2026-09-24 08:30:00.000Z',
	sourceMeta: { from: 'Shop <shop@example.com>' },
	handledAt: '2026-09-24 09:00:00.000Z'
});
const CHAT = item('chat00000000001', { sourceMeta: { chat: 'Familie', sender: 'Ben' } });
const LINK = item('link00000000001', {
	channel: 'link',
	kind: 'link',
	title: 'Artikel',
	sourceUrl: 'https://example.com/artikel'
});

async function setup(
	sources: InboxItemSummary[],
	candidates: InboxItemSummary[] = [],
	/** Inside an open modal, as in the full view (ADR-0025 addendum 16). */
	inModal = false
) {
	const data = {
		list: vi.fn<TicketSourcesData['list']>(async () => sources),
		link: vi.fn<TicketSourcesData['link']>(async (id, ticketId) => ({
			...([...candidates, ...sources].find((entry) => entry.id === id) as InboxItemSummary),
			state: 'converted',
			ticketId,
			updated: '2026-09-25 11:00:00.000Z'
		})),
		release: vi.fn<TicketSourcesData['release']>(async (id) => ({
			...(sources.find((entry) => entry.id === id) as InboxItemSummary),
			state: 'new',
			ticketId: null,
			updated: '2026-09-25 11:00:00.000Z'
		})),
		originalUrl: vi.fn<TicketSourcesData['originalUrl']>(async () => 'http://x/mail.eml?token=t')
	} satisfies TicketSourcesData;
	const flags = new FlagStore();
	const store = new TicketSourcesStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
	store.open(TICKET.id, TICKET.sourceItem);
	const props = { ticket: TICKET, store, candidates, picker: PICKER.source };
	if (inModal) render(InModalHarness, { props: { component: TicketSources, props } });
	else render(TicketSources, { props });
	await vi.waitFor(() => expect(store.state).toBe('ready'));
	return { store, data, flags };
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

// The administrator on the machine of the app (KOB-1, ADR-0057): everything as before.
beforeEach(async () => {
	await useContext(PC_CONTEXT);
});

describe('TicketSources', () => {
	it('lists the sources with channel, date, origin, main source and copy status', async () => {
		await setup([CHAT, MAIN, LINK]);
		const section = screen.getByRole('region', { name: 'Quellen' });
		const rows = within(section).getAllByRole('listitem');
		expect(rows).toHaveLength(3);

		const main = rows[0] as HTMLElement;
		expect(main.textContent).toContain('Mail-Datei');
		expect(main.textContent).toContain('24.09.2026 10:30');
		expect(main.textContent).toContain('Hauptquelle');
		expect(main.textContent).toContain('Rechnung März');
		expect(main.textContent).toContain('Shop <shop@example.com>');
		expect(main.textContent).toContain('Vollständig');
		expect(
			within(main).getByRole('link', { name: '„Rechnung März“ ansehen' }).getAttribute('href')
		).toBe('/eingang/main00000000001');
		expect(
			within(main).getByRole('button', { name: 'Originaldatei von „Rechnung März“ herunterladen' })
		).toHaveProperty('title', 'Originaldatei herunterladen');
		expect(within(main).queryByRole('button', { name: /lösen$/ })).toBeNull();
		expect(within(main).queryByRole('button', { name: /anderem Ticket zuordnen/ })).toBeNull();
		expect(main.textContent).toContain('Bleibt bei diesem Ticket, weil es aus ihr entstanden ist');

		const chat = rows[1] as HTMLElement;
		expect(chat.textContent).toContain('Telegram');
		expect(chat.textContent).toContain('Ben');
		expect(chat.textContent).toContain('Nur Text');
		expect(chat.textContent).not.toContain('Hauptquelle');
		expect(within(chat).queryByRole('button', { name: /herunterladen/ })).toBeNull();
		const release = within(chat).getByRole('button', { name: '„Nachricht chat00000000001“ lösen' });
		expect(release.className).toContain('button-icon');
		expect(release.getAttribute('title')).toBe('Lösen (zurück in den Eingang)');

		const link = rows[2] as HTMLElement;
		expect(link.textContent).toContain('https://example.com/artikel');
		expect(link.textContent).toContain('Nur Adresse');
	});

	it('shows the status of a watched source of GitHub next to its copy (ADR-0050 §5)', async () => {
		const pull = item('pull00000000001', {
			channel: 'github',
			kind: 'pull_request',
			title: 'PR #7 in octo-org/roadmap: Roadmap Q4',
			sourceUrl: 'https://github.com/octo-org/roadmap/pull/7',
			watch: { kind: 'pull', state: 'merged', since: '2026-10-02T12:05:00.000Z' }
		});
		const file = item('file00000000001', {
			channel: 'github',
			kind: 'change',
			title: 'CHANGELOG.md in octo-org/roadmap geändert',
			original: 'changelog_abc.md',
			watch: { kind: 'file', state: 'current', since: null }
		});
		await setup([pull, file, CHAT]);
		const rows = within(screen.getByRole('region', { name: 'Quellen' })).getAllByRole('listitem');
		const rowOf = (title: string) => rows.find((row) => row.textContent?.includes(title));
		const pullRow = rowOf('PR #7 in octo-org/roadmap');
		expect(pullRow?.textContent).toContain('GitHub');
		expect(pullRow?.textContent).toContain('PR gemergt');
		expect(pullRow?.textContent).toContain('PR gemergt (am 02.10.2026 14:05)');
		const fileRow = rowOf('CHANGELOG.md in octo-org/roadmap geändert');
		expect(fileRow?.textContent).toContain('Vollständig');
		expect(fileRow?.textContent).toContain('Unverändert');
		// A source nobody watches shows no status; nothing of it is red.
		expect(rowOf('Nachricht chat00000000001')?.textContent).not.toMatch(/Unverändert|PR /);
		expect(document.querySelector('[data-tone="danger"]')).toBeNull();
	});

	it('shows a file of a folder as a reference and opens its current version (ADR-0051 §6)', async () => {
		const file = item('file00000000002', {
			channel: 'folder',
			kind: 'file',
			title: 'Neue Datei: Angebot.pdf',
			sourceRef: 'C:\\Daten\\Projekte\\Angebot.pdf',
			watch: {
				kind: 'file',
				state: 'moved',
				since: '2026-10-02T12:05:00.000Z',
				to: 'Archiv/Angebot.pdf',
				folder: 'Projekte',
				changed: false
			}
		});
		const data = {
			list: vi.fn<TicketSourcesData['list']>(async () => [file]),
			link: vi.fn<TicketSourcesData['link']>(),
			release: vi.fn<TicketSourcesData['release']>(),
			originalUrl: vi.fn<TicketSourcesData['originalUrl']>()
		} satisfies TicketSourcesData;
		const store = new TicketSourcesStore(
			data,
			{ ensureValid: () => true, logout: vi.fn() },
			new FlagStore()
		);
		store.open(TICKET.id, TICKET.sourceItem);
		const open = vi.fn<FileOpener>(() => false);
		const viewer = new FolderViewer(
			{
				view: async () => ({
					kind: 'ok',
					view: {
						name: 'Angebot.pdf',
						path: 'Archiv/Angebot.pdf',
						folder: 'Projekte',
						size: 10,
						modified: '',
						inline: true,
						url: 'http://127.0.0.1:8090/api/byl/folders/items/file00000000002/file?token=t'
					}
				})
			},
			{ ensureValid: () => true, logout: vi.fn() },
			open
		);
		render(FolderViewerHarness, {
			props: {
				viewer,
				component: TicketSources,
				props: { ticket: TICKET, store, candidates: [], picker: PICKER.source }
			}
		});
		const section = within(await screen.findByRole('region', { name: 'Quellen' }));
		const row = await vi.waitFor(() => section.getByRole('listitem'));
		expect(row.textContent).toContain('Ordner');
		expect(row.textContent).toContain('Verweis');
		expect(row.textContent).toContain('Verschoben nach „Archiv/Angebot.pdf“ in „Projekte“');
		expect(within(row).queryByRole('button', { name: /Originaldatei/ })).toBeNull();
		const button = within(row).getByRole('button', {
			name: 'Datei von „Neue Datei: Angebot.pdf“ öffnen'
		});
		expect(button.className).toContain('button-icon');
		await fireEvent.click(button);
		await vi.waitFor(() =>
			expect(open).toHaveBeenCalledWith(expect.stringContaining('?token=t'), true)
		);
		// A blocked tab is said neutrally, with the way out.
		const note = await screen.findByText(/^Der Browser hat den neuen Tab blockiert/);
		expect(note.closest('[data-tone]')?.getAttribute('data-tone')).toBe('info');
	});

	it.each([
		['the administrator on another device', REMOTE_CONTEXT],
		['another account', MEMBER_CONTEXT]
	])('offers no opening of a file of this machine to %s (KOB-1)', async (_who, context) => {
		await useContext(context);
		const file = item('file00000000002', { channel: 'folder', kind: 'file' });
		const store = new TicketSourcesStore(
			{
				list: vi.fn<TicketSourcesData['list']>(async () => [file]),
				link: vi.fn<TicketSourcesData['link']>(),
				release: vi.fn<TicketSourcesData['release']>(),
				originalUrl: vi.fn<TicketSourcesData['originalUrl']>()
			},
			{ ensureValid: () => true, logout: vi.fn() },
			new FlagStore()
		);
		store.open(TICKET.id, TICKET.sourceItem);
		const view = vi.fn(async () => ({ kind: 'refused' as const, reason: 'x', message: '' }));
		const viewer = new FolderViewer({ view }, { ensureValid: () => true, logout: vi.fn() });
		render(FolderViewerHarness, {
			props: {
				viewer,
				component: TicketSources,
				props: { ticket: TICKET, store, candidates: [], picker: PICKER.source }
			}
		});
		const section = within(await screen.findByRole('region', { name: 'Quellen' }));
		const row = await vi.waitFor(() => section.getByRole('listitem'));
		expect(within(row).queryByRole('button', { name: /öffnen/ })).toBeNull();
		expect(view).not.toHaveBeenCalled();
	});

	it('names the connection of a source and follows a rename at once (KK-3)', async () => {
		let emit: (change: RecordChange<ConnectionName>) => void = () => undefined;
		const names = new ConnectionNamesStore(
			{
				list: async () => [{ id: 'conn00000000001', label: 'Familienchat' }],
				subscribe: async (onChange) => {
					emit = onChange;
					return async () => undefined;
				},
				reconnected: async () => async () => undefined
			},
			{ ensureValid: () => true, logout: vi.fn() },
			{ health: new LiveHealth() }
		);
		const stop = names.start();
		const data = {
			list: vi.fn<TicketSourcesData['list']>(async () => [
				{ ...CHAT, connectionId: 'conn00000000001' },
				MAIN
			]),
			link: vi.fn<TicketSourcesData['link']>(),
			release: vi.fn<TicketSourcesData['release']>(),
			originalUrl: vi.fn<TicketSourcesData['originalUrl']>()
		} satisfies TicketSourcesData;
		const store = new TicketSourcesStore(
			data,
			{ ensureValid: () => true, logout: vi.fn() },
			new FlagStore()
		);
		store.open(TICKET.id, TICKET.sourceItem);
		render(ConnectionNamesHarness, {
			props: {
				names,
				component: TicketSources,
				props: { ticket: TICKET, store, candidates: [], picker: PICKER.source }
			}
		});
		const section = await screen.findByRole('region', { name: 'Quellen' });
		await vi.waitFor(() =>
			expect(within(section).getByText('Telegram · Familienchat')).toBeTruthy()
		);
		// A source without a connection names its channel only.
		expect(within(section).getByText('Mail-Datei')).toBeTruthy();
		emit({ action: 'update', record: { id: 'conn00000000001', label: 'Familie Beispiel' } });
		await vi.waitFor(() =>
			expect(within(section).getByText('Telegram · Familie Beispiel')).toBeTruthy()
		);
		stop();
	});

	it('releases a linked source; it leaves the list with a flag', async () => {
		const { data, flags } = await setup([MAIN, CHAT]);
		await fireEvent.click(
			screen.getByRole('button', { name: '„Nachricht chat00000000001“ lösen' })
		);
		expect(data.release).toHaveBeenCalledWith('chat00000000001');
		await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
		expect(flags.flags.at(-1)?.title).toBe('„Nachricht chat00000000001“ ist wieder im Eingang.');
	});

	it('moves a linked source to another ticket (ADR-0031 addendum)', async () => {
		const { data, flags } = await setup([MAIN, CHAT]);
		const move = screen.getByRole('button', {
			name: '„Nachricht chat00000000001“ anderem Ticket zuordnen …'
		});
		expect(move.className).toContain('button-icon');
		expect(move.getAttribute('title')).toBe('Anderem Ticket zuordnen …');
		await fireEvent.click(move);
		const dialog = screen.getByRole('dialog', { name: 'Anderem Ticket zuordnen' });
		const input = within(dialog).getByRole('combobox', {
			name: 'Neues Ticket'
		}) as HTMLInputElement;
		// The list opens without typing (ADR-0042); the current ticket is greyed with the reason.
		await fireEvent.focus(input);
		await vi.waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
		const options = within(dialog).getAllByRole('option', { hidden: true });
		const current = options.find((option) => option.textContent?.includes('Dieses'));
		expect(current?.getAttribute('aria-disabled')).toBe('true');
		expect(current?.textContent).toContain(alreadyLinkedReason('TASK-4'));
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(input.value).toBe('HAUS-13 Anderes');
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Zuordnen' }));
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(data.link).toHaveBeenCalledWith('chat00000000001', 'ticket000000013');
		await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
		expect(flags.flags.at(-1)?.title).toBe('„Nachricht chat00000000001“ gehört jetzt zu HAUS-13.');
	});

	it('downloads the original with a fresh token', async () => {
		const assign = vi.fn();
		vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign });
		const { data } = await setup([MAIN]);
		await fireEvent.click(
			screen.getByRole('button', { name: 'Originaldatei von „Rechnung März“ herunterladen' })
		);
		await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('http://x/mail.eml?token=t'));
		expect(data.originalUrl).toHaveBeenCalledOnce();
	});

	it('names the copy of a source made for a duplicate (ADR-0031 addendum F)', async () => {
		const copy = item('copy00000000001', {
			...MAIN,
			id: 'copy00000000001',
			sourceMeta: {
				...MAIN.sourceMeta,
				copy_of: { item: MAIN.id, ticket: 'ticket000000012', key: 'HAUS-12', at: '' }
			}
		});
		await setup([copy, CHAT]);
		const note = await screen.findByText('Kopie aus HAUS-12');
		expect(within(note.closest('li') as HTMLElement).getByText('Rechnung März')).toBeTruthy();
		expect(screen.getAllByText(/Kopie aus/)).toHaveLength(1);
	});

	it('says there are no sources yet', async () => {
		await setup([]);
		expect(screen.getByRole('heading', { name: 'Noch keine Quellen' })).toBeTruthy();
	});

	it('adds new inbox entries as sources through "Quelle hinzufügen …"', async () => {
		const candidates = [
			item('new00000000001', { state: 'new', ticketId: null, title: 'Anruf Bank' }),
			item('new00000000002', {
				state: 'new',
				ticketId: null,
				title: 'Mail vom Amt',
				channel: 'mail',
				sourceMeta: { from: 'Amt <amt@example.com>' }
			})
		];
		const { data, flags } = await setup([MAIN], candidates);
		await fireEvent.click(screen.getByRole('button', { name: 'Quelle hinzufügen …' }));
		const dialog = screen.getByRole('dialog', { name: 'Quelle hinzufügen' });
		expect(within(dialog).getByText('Gewählte Einträge werden Quellen von TASK-4.')).toBeTruthy();

		// Without a choice the dialog says what is missing.
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Verknüpfen' }));
		expect(within(dialog).getByText('Bitte mindestens einen Eintrag wählen.')).toBeTruthy();
		expect(data.link).not.toHaveBeenCalled();

		// The search narrows by title and sender.
		await fireEvent.input(within(dialog).getByRole('searchbox', { name: 'Einträge durchsuchen' }), {
			target: { value: 'amt@' }
		});
		expect(within(dialog).getAllByRole('checkbox')).toHaveLength(1);
		await fireEvent.click(within(dialog).getByRole('checkbox', { name: /Mail vom Amt/ }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Verknüpfen (1)' }));

		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(data.link).toHaveBeenCalledWith('new00000000002', TICKET.id);
		expect(flags.flags.at(-1)?.title).toBe('1 Eintrag mit TASK-4 verknüpft.');
		await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
	});

	it('says when there is nothing to add', async () => {
		await setup([MAIN]);
		await fireEvent.click(screen.getByRole('button', { name: 'Quelle hinzufügen …' }));
		const dialog = screen.getByRole('dialog', { name: 'Quelle hinzufügen' });
		expect(within(dialog).getByRole('heading', { name: 'Keine neuen Einträge' })).toBeTruthy();
		expect(within(dialog).queryByRole('button', { name: /^Verknüpfen/ })).toBeNull();
	});
});

// In the full view (a modal) no dialog opens (ADR-0025 section 3, addendum 16): both forms unfold
// inline, "Anderem Ticket zuordnen …" below its entry, "Quelle hinzufügen …" below the heading.
describe('TicketSources in the full view', () => {
	const fullView = () => screen.getByRole('dialog', { name: 'Vollansicht' });

	it('moves a source in an area below its entry and then puts the focus on "Quelle hinzufügen …"', async () => {
		const { data } = await setup([MAIN, CHAT], [], true);
		const move = screen.getByRole('button', {
			name: '„Nachricht chat00000000001“ anderem Ticket zuordnen …'
		});
		expect(move.getAttribute('aria-haspopup')).toBeNull();
		move.focus();
		await fireEvent.click(move);
		expect(move.getAttribute('aria-expanded')).toBe('true');
		expect(screen.getAllByRole('dialog')).toEqual([fullView()]);
		const row = move.closest('li') as HTMLElement;
		const area = within(row).getByRole('region', { name: 'Anderem Ticket zuordnen' });
		const input = within(area).getByRole('combobox', { name: 'Neues Ticket' }) as HTMLInputElement;
		await vi.waitFor(() => expect(document.activeElement).toBe(input));

		await fireEvent.focus(input);
		await vi.waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
		await fireEvent.keyDown(input, { key: 'Enter' });
		expect(input.value).toBe('HAUS-13 Anderes');
		await fireEvent.click(within(area).getByRole('button', { name: 'Zuordnen' }));
		await vi.waitFor(() =>
			expect(data.link).toHaveBeenCalledWith('chat00000000001', 'ticket000000013')
		);
		await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole('button', { name: 'Quelle hinzufügen …' })
			)
		);
		expect(screen.getAllByRole('dialog')).toEqual([fullView()]);
	});

	it('adds sources in an area below the heading and folds it with the button again', async () => {
		const candidates = [
			item('new00000000001', { state: 'new', ticketId: null, title: 'Anruf Bank' })
		];
		const { data } = await setup([MAIN], candidates, true);
		const add = screen.getByRole('button', { name: 'Quelle hinzufügen …' });
		await fireEvent.click(add);
		const section = screen.getByRole('region', { name: 'Quellen' });
		const area = within(section).getByRole('region', { name: 'Quelle hinzufügen' });
		expect(screen.getAllByRole('dialog')).toEqual([fullView()]);
		expect(add.getAttribute('aria-expanded')).toBe('true');
		await fireEvent.click(add);
		expect(within(section).queryByRole('region', { name: 'Quelle hinzufügen' })).toBeNull();
		expect(area.isConnected).toBe(false);

		await fireEvent.click(add);
		const again = within(section).getByRole('region', { name: 'Quelle hinzufügen' });
		await fireEvent.click(within(again).getByRole('checkbox', { name: /Anruf Bank/ }));
		await fireEvent.click(within(again).getByRole('button', { name: 'Verknüpfen (1)' }));
		await vi.waitFor(() => expect(data.link).toHaveBeenCalledWith('new00000000001', TICKET.id));
		await vi.waitFor(() =>
			expect(within(section).queryByRole('region', { name: 'Quelle hinzufügen' })).toBeNull()
		);
		await vi.waitFor(() => expect(document.activeElement).toBe(add));
	});
});
