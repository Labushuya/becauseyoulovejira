// Component tests for the panel of an inbox entry (E4 plan, package 3; ADR-0019 section 5):
// details of the source, sanitised text, actions, download of the protected original, hint on a
// possible duplicate, entry not found, Escape. The store is real with fake data.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { InboxItem } from '$lib/domain/inbox';
import type { TicketSummary } from '$lib/domain/ticket';
import { ConnectionNamesStore } from '$lib/stores/connection-names.svelte';
import { InboxStore, type InboxData } from '$lib/stores/inbox.svelte';
import { LiveHealth } from '$lib/stores/live-health.svelte';
import ConnectionNamesHarness from '$lib/test/ConnectionNamesHarness.svelte';
import FolderViewerHarness from '$lib/test/FolderViewerHarness.svelte';
import type { FileViewOutcome } from '$lib/data/folders';
import { FolderViewer, type FileOpener, type FolderViewData } from '$lib/stores/folder-view.svelte';
import { RecurrenceStore, type RecurrenceData } from '$lib/stores/recurrence.svelte';
import { TicketSourcesStore, type TicketSourcesData } from '$lib/stores/ticket-sources.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { fakePickerSource, pickerTicket } from '$lib/test/ticket-picker-fake';
import TicketHostHarness from '$lib/test/TicketHostHarness.svelte';
import { INBOX_HOST, type TicketHost } from '$lib/ticket-host';
import InboxPanel from './InboxPanel.svelte';

// The address of the panel of the entry; links of the host of the inbox read it (ADR-0054).
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost:3000/eingang/item00000000001?quelle=mail') }
}));

useOverlayStubs();

const ID = 'item00000000001';

function entry(overrides: Partial<InboxItem> = {}): InboxItem {
	return {
		id: ID,
		channel: 'eml',
		kind: 'mail',
		title: 'Rechnung September',
		body: 'Bitte **zahlen**.\n\n<script>alert(1)</script>\n\n[Klick](javascript:alert(1))',
		sourceUrl: 'https://shop.example.com/rechnung',
		sourceRef: '<a@b>',
		sourceDate: '2026-09-24 23:30:00.000Z',
		sourceMeta: { from: 'Shop <shop@example.com>', to: 'ich@example.com', keyword: 'rechnung' },
		original: 'mail_abc.eml',
		state: 'new',
		ticketId: null,
		handledAt: null,
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 08:00:00.000Z',
		...overrides
	};
}

function setup(
	item: InboxItem | Error = entry(),
	tickets: TicketSummary[] = [],
	/** Further props, e.g. the recurrence store of package 6. */
	extra: Record<string, unknown> = {},
	/** Names of the connections as the (app) layout provides them (KK-3). */
	names: ConnectionNamesStore | null = null,
	/** "Ansehen" of files of folders as the (app) layout provides it (ADR-0051 §6). */
	viewer: FolderViewer | null = null,
	/** The host of the inbox layout (ADR-0054); without it the links lead to "Aufgaben". */
	host: TicketHost | null = null
) {
	const data = {
		listNew: vi.fn<InboxData['listNew']>(async () => []),
		listHandled: vi.fn<InboxData['listHandled']>(async (_state, page) => ({
			items: [],
			page,
			hasMore: false
		})),
		get: vi.fn<InboxData['get']>(async () => {
			if (item instanceof Error) throw item;
			return item;
		}),
		create: vi.fn<InboxData['create']>(),
		discard: vi.fn<InboxData['discard']>(async () => ({
			...(item as InboxItem),
			state: 'discarded',
			handledAt: '2026-09-25 09:00:00.000Z',
			updated: '2026-09-25 09:00:00.000Z'
		})),
		restore: vi.fn<InboxData['restore']>(),
		assign: vi.fn<InboxData['assign']>(async (_id, ticketId) => ({
			...(item as InboxItem),
			state: 'converted',
			ticketId,
			handledAt: '2026-09-25 09:00:00.000Z',
			updated: '2026-09-25 09:00:00.000Z'
		})),
		originalUrl: vi.fn<InboxData['originalUrl']>(
			async () => 'http://127.0.0.1:8090/api/files/inbox_items/x/mail_abc.eml?download=1&token=t'
		),
		importCalendar: vi.fn<InboxData['importCalendar']>(async () => ({
			created: 0,
			duplicates: 0,
			skipped: 0,
			failed: 0,
			itemId: ''
		})),
		savePage: vi.fn<InboxData['savePage']>(async () => ({
			kind: 'saved',
			title: 'Rezept',
			size: 1234,
			truncated: false
		}))
	} satisfies InboxData;
	const store = new InboxStore(data, { ensureValid: () => true, logout: vi.fn() });
	const onclose = vi.fn();
	const props = { id: ID, store, openTickets: tickets, onclose, ...extra };
	if (host !== null) {
		render(TicketHostHarness, { props: { host, component: InboxPanel, props } });
	} else if (viewer !== null) {
		render(FolderViewerHarness, { props: { viewer, component: InboxPanel, props } });
	} else if (names === null) render(InboxPanel, { props });
	else render(ConnectionNamesHarness, { props: { names, component: InboxPanel, props } });
	return { store, data, onclose };
}

/** "Ansehen" with a fake route and a fake opener of the browser. */
function folderViewer(outcome: () => Promise<FileViewOutcome>) {
	const data = { view: vi.fn<FolderViewData['view']>(outcome) };
	const open = vi.fn<FileOpener>(() => true);
	return {
		data,
		open,
		viewer: new FolderViewer(data, { ensureValid: () => true, logout: vi.fn() }, open)
	};
}

const FILE_ITEM = {
	channel: 'folder' as const,
	kind: 'file' as const,
	title: 'Neue Datei: Angebot.pdf',
	body: 'Neue Datei im Ordner „Projekte“.',
	sourceUrl: '',
	sourceRef: 'C:\\Daten\\Projekte\\2026\\Angebot.pdf',
	sourceMeta: {
		folder: {
			root: 'C:\\Daten\\Projekte',
			folder: 'Projekte',
			path: '2026/Angebot.pdf',
			name: 'Angebot.pdf',
			size: 2048,
			type: 'pdf'
		}
	},
	original: '',
	watch: { kind: 'file' as const, state: 'current' as const, since: null }
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('inbox panel', () => {
	it('shows the details of the source and focuses the title', async () => {
		const { onclose } = setup();
		const heading = await screen.findByRole('heading', { name: 'Rechnung September' });
		await vi.waitFor(() => expect(document.activeElement).toBe(heading));
		const details = within(screen.getByRole('complementary'));
		const text = (label: string) =>
			details.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent?.trim();
		expect(text('Art')).toBe('Mail');
		expect(text('Quelle')).toBe('Mail-Datei');
		expect(text('Zustand')).toBe('Neu');
		expect(text('Von')).toBe('Shop <shop@example.com>');
		expect(text('An')).toBe('ich@example.com');
		expect(text('Stichwort')).toBe('rechnung');
		expect(text('Quelldatum')).toBe('25.09.2026 01:30');
		expect(text('Eingang')).toBe('25.09.2026 10:00');
		const link = details.getByRole('link', { name: 'https://shop.example.com/rechnung' });
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(screen.getByText(/Das Quelldatum wird nicht zur Fälligkeit/)).toBeTruthy();
		// × of the side panel (UI-6) instead of the link "Schließen".
		expect(screen.queryByRole('link', { name: 'Schließen' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('names the connection of the entry in "Quelle" (KK-3)', async () => {
		const names = new ConnectionNamesStore(
			{
				list: async () => [{ id: 'conn00000000003', label: 'Gmail Arbeit' }],
				subscribe: async () => async () => undefined,
				reconnected: async () => async () => undefined
			},
			{ ensureValid: () => true, logout: vi.fn() },
			{ health: new LiveHealth() }
		);
		await names.load();
		setup(entry({ channel: 'mail', connectionId: 'conn00000000003' }), [], {}, names);
		await screen.findByRole('heading', { name: 'Rechnung September' });
		const details = within(screen.getByRole('complementary'));
		expect(
			details.getByText('Quelle', { selector: 'dt' }).nextElementSibling?.textContent?.trim()
		).toBe('Postfach · Gmail Arbeit');
	});

	it('shows the repository, the file and the status of a watched source of GitHub (ADR-0050 §5)', async () => {
		setup(
			entry({
				channel: 'github',
				kind: 'change',
				title: 'CHANGELOG.md in octo-org/roadmap geändert',
				sourceMeta: { github: { kind: 'file', repo: 'octo-org/roadmap', path: 'CHANGELOG.md' } },
				original: 'changelog_abc.md',
				watch: { kind: 'file', state: 'changed', since: '2026-10-02T12:05:00.000Z' }
			})
		);
		await screen.findByRole('heading', { name: 'CHANGELOG.md in octo-org/roadmap geändert' });
		const details = within(screen.getByRole('complementary'));
		const row = (label: string) => details.getByText(label, { selector: 'dt' }).nextElementSibling;
		expect(row('Quelle')?.textContent?.trim()).toBe('GitHub');
		expect(row('Art')?.textContent?.trim()).toBe('Änderung');
		expect(row('Repository')?.textContent?.trim()).toBe('octo-org/roadmap');
		expect(row('Datei')?.textContent?.trim()).toBe('CHANGELOG.md');
		const status = within(row('Status der Quelle') as HTMLElement);
		expect(status.getByText('Seit Import geändert')).toBeTruthy();
		expect(
			status.getByText('Seit Import erneut geändert (zuletzt am 02.10.2026 14:05)')
		).toBeTruthy();
		// Only shown: no tone of an error.
		expect(row('Status der Quelle')?.querySelector('[data-tone="danger"]')).toBeNull();
	});

	it('shows a file of a folder as a reference and opens its current version (ADR-0051 §6)', async () => {
		const view = {
			name: 'Angebot.pdf',
			path: '2026/Angebot.pdf',
			folder: 'Projekte',
			size: 2048,
			modified: '2026-10-02T08:00:00.000Z',
			inline: true,
			url: 'http://127.0.0.1:8090/api/byl/folders/items/item00000000001/file?token=t'
		};
		const { data, open, viewer } = folderViewer(async () => ({ kind: 'ok', view }));
		setup(entry(FILE_ITEM), [], {}, null, viewer);
		await screen.findByRole('heading', { name: 'Neue Datei: Angebot.pdf' });
		const details = within(screen.getByRole('complementary'));
		const row = (label: string) => details.getByText(label, { selector: 'dt' }).nextElementSibling;
		expect(row('Quelle')?.textContent?.trim()).toBe('Ordner');
		expect(row('Art')?.textContent?.trim()).toBe('Datei');
		expect(row('Ordner')?.textContent?.trim()).toBe('Projekte');
		expect(row('Datei im Ordner')?.textContent?.trim()).toBe('2026/Angebot.pdf');
		expect(row('Kopie')?.textContent?.trim()).toBe('Verweis');
		expect(row('Status der Quelle')?.textContent).toContain('Unverändert');
		expect(screen.getByText(/^Verweis auf die Datei im Ordner, keine Kopie/)).toBeTruthy();
		// No original file to download: the file stays in the folder.
		expect(screen.queryByRole('button', { name: 'Originaldatei herunterladen' })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Ansehen' }));
		await vi.waitFor(() => expect(open).toHaveBeenCalledWith(view.url, true));
		expect(data.view).toHaveBeenCalledWith(ID);
		await fireEvent.click(screen.getByRole('button', { name: 'Herunterladen' }));
		await vi.waitFor(() => expect(open).toHaveBeenLastCalledWith(`${view.url}&download=1`, false));
	});

	it('says neutrally that a file is gone, and a failed request as an error', async () => {
		const { viewer } = folderViewer(async () => ({
			kind: 'refused',
			reason: 'missing',
			message: 'Die Datei ist nicht mehr vorhanden.'
		}));
		setup(entry(FILE_ITEM), [], {}, null, viewer);
		await fireEvent.click(await screen.findByRole('button', { name: 'Ansehen' }));
		const note = await screen.findByText('Die Datei ist nicht mehr vorhanden.');
		expect(note.closest('[data-tone]')?.getAttribute('data-tone')).toBe('info');
		cleanup();

		const failing = folderViewer(async () => {
			throw new DataError('network');
		});
		setup(entry(FILE_ITEM), [], {}, null, failing.viewer);
		await fireEvent.click(await screen.findByRole('button', { name: 'Ansehen' }));
		await vi.waitFor(() => expect(document.querySelector('[data-tone="error"]')).not.toBeNull());
		expect(failing.open).not.toHaveBeenCalled();
	});

	it('offers no "Ansehen" outside the (app) layout', async () => {
		setup(entry(FILE_ITEM));
		await screen.findByRole('heading', { name: 'Neue Datei: Angebot.pdf' });
		expect(screen.queryByRole('button', { name: 'Ansehen' })).toBeNull();
	});

	it('shows no status for an entry without a watched source', async () => {
		setup();
		await screen.findByRole('heading', { name: 'Rechnung September' });
		expect(screen.queryByText('Status der Quelle')).toBeNull();
	});

	it('shows the text as sanitised Markdown', async () => {
		setup();
		const body = await screen.findByRole('region', { name: 'Text' });
		expect(within(body).getByText('zahlen').tagName).toBe('STRONG');
		expect(body.querySelector('script')).toBeNull();
		for (const anchor of body.querySelectorAll('a')) {
			expect(anchor.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
		}
	});

	it('converts, discards and restores', async () => {
		const { data } = setup();
		await screen.findByRole('heading', { name: 'Rechnung September' });
		expect(screen.getByRole('link', { name: 'Umwandeln' }).getAttribute('href')).toBe(
			`/tickets/neu?aus=${ID}`
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
		await vi.waitFor(() => expect(data.discard).toHaveBeenCalledWith(ID));
		expect(await screen.findByRole('button', { name: 'Wiederherstellen' })).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Umwandeln' })).toBeNull();
	});

	it('tells that a discarded entry loses its content after 30 days (E4 plan, package 24)', async () => {
		setup();
		await screen.findByRole('heading', { name: 'Rechnung September' });
		expect(screen.queryByText(/behalten ihren Inhalt 30 Tage/)).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
		const note = await screen.findByText(/Verworfene Einträge behalten ihren Inhalt 30 Tage/);
		expect(note.textContent).toMatch(/Duplikatmerkmal/);
		// Compact info since EH-11, without a role (the focus stays, nothing is announced twice).
		const message = note.closest('[data-tone]');
		expect(message?.getAttribute('data-tone')).toBe('info');
		expect(message?.classList.contains('compact')).toBe(true);
		expect(note.closest('.alert-error')).toBeNull();
	});

	it('downloads the original with a fresh file token', async () => {
		const assign = vi.fn();
		vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, assign });
		const { data } = setup();
		await fireEvent.click(
			await screen.findByRole('button', { name: 'Originaldatei herunterladen' })
		);
		await vi.waitFor(() => expect(assign).toHaveBeenCalledOnce());
		expect(data.originalUrl).toHaveBeenCalledWith(
			expect.objectContaining({ id: ID, original: 'mail_abc.eml' })
		);
		expect(assign.mock.calls[0]?.[0]).toContain('download=1');
	});

	it('offers no download without an original', async () => {
		setup(entry({ original: '' }));
		await screen.findByRole('heading', { name: 'Rechnung September' });
		expect(screen.queryByRole('button', { name: 'Originaldatei herunterladen' })).toBeNull();
	});

	it('shows no keyword row without a keyword (manual import)', async () => {
		setup(entry({ sourceMeta: { from: 'Shop <shop@example.com>' } }));
		await screen.findByRole('heading', { name: 'Rechnung September' });
		expect(screen.queryByText('Stichwort', { selector: 'dt' })).toBeNull();
	});

	it('names the target project of the entry, an archived and a deleted one as such (ADR-0049)', async () => {
		const projects = [
			{ id: 'haus00000000001', name: 'Haus', code: 'HAUS', archived: false },
			{ id: 'alt000000000001', name: 'Alt', code: 'ALT', archived: true }
		];
		const text = () =>
			screen
				.queryByText('Zielprojekt', { selector: 'dt' })
				?.nextElementSibling?.textContent?.trim();
		for (const [overrides, expected] of [
			[{ targetProjectId: 'haus00000000001' }, 'Haus (HAUS)'],
			[{ targetProjectId: 'alt000000000001' }, 'Alt (ALT), archiviert'],
			[{ targetProjectId: null, sourceMeta: { target_gone: true } }, 'gelöscht'],
			[{ targetProjectId: null }, undefined]
		] as const) {
			setup(entry(overrides), [], { projects });
			await screen.findByRole('heading', { name: 'Rechnung September' });
			expect(text(), JSON.stringify(overrides)).toBe(expected);
			cleanup();
		}
	});

	it('links a converted entry to its ticket', async () => {
		setup(
			entry({
				state: 'converted',
				ticketId: 'tick00000000001',
				handledAt: '2026-09-25 09:00:00.000Z'
			})
		);
		expect((await screen.findByRole('link', { name: 'Ticket öffnen' })).getAttribute('href')).toBe(
			'/tickets/tick00000000001'
		);
		expect(screen.getByText('Gehört zu einem Ticket')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
	});

	it('opens the ticket in the inbox instead of the entry, which × of the ticket brings back', async () => {
		const ticket = { id: 'tick00000000001', key: 'HAUS-4', title: 'Rechnung' } as TicketSummary;
		setup(
			entry({ state: 'converted', ticketId: ticket.id, handledAt: '2026-09-25 09:00:00.000Z' }),
			[ticket],
			{},
			null,
			null,
			INBOX_HOST
		);
		const link = await screen.findByRole('link', { name: 'Ticket öffnen' });
		// ADR-0054: the ticket stays in the inbox, with its chips and the entry as the way back.
		expect(link.getAttribute('href')).toBe(`/eingang/tickets/${ticket.id}?quelle=mail&von=${ID}`);
		expect(link.getAttribute('data-ticket-link')).toBe(ticket.id);
	});

	it('gives the focus to the link of the ticket the user came back from once loaded', async () => {
		setup(
			entry({
				state: 'converted',
				ticketId: 'tick00000000001',
				handledAt: '2026-09-25 09:00:00.000Z'
			}),
			[],
			{ initialFocus: () => document.querySelector('[data-ticket-link="tick00000000001"]') }
		);
		const link = await screen.findByRole('link', { name: 'Ticket öffnen' });
		await vi.waitFor(() => expect(document.activeElement).toBe(link));
	});

	it('hints at a possible duplicate and assigns the entry to the ticket', async () => {
		const ticket = {
			id: 'tick00000000001',
			key: 'HAUS-4',
			title: 'rechnung  september',
			status: 'open'
		} as TicketSummary;
		const { data } = setup(entry(), [ticket]);
		const note = await screen.findByRole('note');
		expect(within(note).getByText('Mögliches Duplikat.')).toBeTruthy();
		await fireEvent.click(within(note).getByRole('button', { name: 'Dem Ticket HAUS-4 zuordnen' }));
		await vi.waitFor(() => expect(data.assign).toHaveBeenCalledWith(ID, 'tick00000000001'));
		expect(await screen.findByRole('link', { name: 'Ticket öffnen' })).toBeTruthy();
	});

	it('says when the entry does not exist', async () => {
		setup(new DataError('not_found', { status: 404 }));
		expect(await screen.findByRole('heading', { name: 'Eintrag nicht gefunden' })).toBeTruthy();
	});

	it('closes on Escape', async () => {
		const { onclose } = setup();
		await screen.findByRole('heading', { name: 'Rechnung September' });
		await fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });
		expect(onclose).toHaveBeenCalledOnce();
	});
});

describe('inbox panel: a converted calendar series (E5 plan, package 6)', () => {
	const TICKET = {
		id: 'tick00000000001',
		key: 'TASK-12',
		title: 'Chorprobe',
		status: 'open',
		recurring: false
	} as TicketSummary;

	/** A converted event of Monday, 5 October 2026, 18:30 in Berlin. */
	function series(sourceMeta: Record<string, unknown>): InboxItem {
		return entry({
			channel: 'calendar',
			kind: 'event',
			title: 'Chorprobe',
			sourceUrl: '',
			original: '',
			sourceDate: '2026-10-05 16:30:00.000Z',
			sourceMeta,
			state: 'converted',
			ticketId: TICKET.id,
			handledAt: '2026-09-25 09:00:00.000Z'
		});
	}

	async function rules(state: 'ready' | 'unavailable' = 'ready') {
		const data = {
			listRules: vi.fn(async () => (state === 'ready' ? [] : null)),
			createRule: vi.fn(),
			updateRule: vi.fn(),
			setActive: vi.fn(),
			deleteRule: vi.fn(),
			detachTicket: vi.fn()
		} satisfies RecurrenceData;
		const store = new RecurrenceStore(data, { ensureValid: () => true, logout: vi.fn() });
		await store.load();
		return store;
	}

	it('offers "Wiederholen…" at the open ticket with the suggested values', async () => {
		const recurrence = await rules();
		setup(series({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1' }), [TICKET], {
			recurrence,
			today: '2026-09-25'
		});
		expect(
			await screen.findByText(/Dieser Termin wiederholt sich: monatlich am letzten Tag\./)
		).toBeTruthy();
		const link = screen.getByRole('link', { name: 'Wiederholung für TASK-12 anlegen…' });
		expect(link.getAttribute('href')).toBe('/tickets/tick00000000001');
		// A new tab gets no offer; a plain click hands the values to the ticket panel.
		await fireEvent.click(link, { ctrlKey: true });
		expect(recurrence.takeOffer(TICKET.id)).toBeNull();
		await fireEvent.click(link);
		// No answer to "Folgetickets starten mit" yet: the dialog asks (ADR-0022 addendum 9).
		expect(recurrence.takeOffer(TICKET.id)).toEqual({
			ticketId: TICKET.id,
			values: expect.objectContaining({ freq: 'monthly', lastDay: true, anchor: '2026-10-05' }),
			initialStatus: null,
			message: null
		});
	});

	it('explains neutrally why a series cannot become a rule', async () => {
		setup(series({ rrule: 'FREQ=WEEKLY;COUNT=4' }), [TICKET], {
			recurrence: await rules(),
			today: '2026-09-25'
		});
		const hint = await screen.findByText(/Diese Serie lässt sich nicht als Regel übernehmen/);
		expect(hint.textContent).toContain('die Serie hat ein Ende');
		expect(hint.textContent?.replace(/\s+/g, ' ')).toContain(
			'Am Ticket TASK-12 kannst du „Wiederholen…“ wählen.'
		);
		expect(screen.queryByRole('link', { name: /Wiederholung für/ })).toBeNull();
	});

	it('shows nothing once the ticket is done, in a series, or before the E5 migration', async () => {
		for (const [tickets, state] of [
			[[], 'ready'],
			[[{ ...TICKET, recurring: true }], 'ready'],
			[[TICKET], 'unavailable']
		] as const) {
			setup(series({ rrule: 'FREQ=WEEKLY' }), [...tickets], {
				recurrence: await rules(state),
				today: '2026-09-25'
			});
			await screen.findByRole('heading', { name: 'Chorprobe' });
			expect(screen.queryByText(/wiederholt sich|Diese Serie/)).toBeNull();
			cleanup();
		}
	});

	it('shows nothing for a new entry: there the conversion offers the series', async () => {
		setup(
			{ ...series({ rrule: 'FREQ=WEEKLY' }), state: 'new', ticketId: null, handledAt: null },
			[],
			{
				recurrence: await rules(),
				today: '2026-09-25'
			}
		);
		await screen.findByRole('heading', { name: 'Chorprobe' });
		expect(screen.queryByText(/wiederholt sich/)).toBeNull();
	});
});

describe('inbox panel: copy and linking (ADR-0031)', () => {
	function sources() {
		const data = {
			list: vi.fn<TicketSourcesData['list']>(async () => []),
			link: vi.fn<TicketSourcesData['link']>(async (id, ticketId) => ({
				...entry(),
				id,
				state: 'converted',
				ticketId,
				updated: '2026-09-25 10:00:00.000Z'
			})),
			release: vi.fn<TicketSourcesData['release']>(),
			originalUrl: vi.fn<TicketSourcesData['originalUrl']>(async () => null)
		} satisfies TicketSourcesData;
		return {
			data,
			store: new TicketSourcesStore(data, { ensureValid: () => true, logout: vi.fn() })
		};
	}

	const copyOf = () =>
		within(screen.getByRole('complementary'))
			.getByText('Kopie', { selector: 'dt' })
			.nextElementSibling?.textContent?.trim();

	it('shows a complete copy without a hint', async () => {
		setup();
		await screen.findByRole('heading', { name: 'Rechnung September' });
		expect(copyOf()).toBe('Vollständig');
		expect(screen.queryByText(/^Gespeichert/)).toBeNull();
	});

	it('says what is missing of a chat message, a web link and a mail over the limit', async () => {
		setup(entry({ channel: 'telegram', kind: 'message', original: '', sourceUrl: '' }));
		await screen.findByRole('heading', { name: 'Rechnung September' });
		expect(copyOf()).toBe('Nur Text');
		expect(screen.getByText(/^Gespeichert ist nur der Text\./)).toBeTruthy();
		cleanup();

		setup(entry({ channel: 'link', kind: 'link', original: '' }));
		await screen.findByRole('heading', { name: 'Rechnung September' });
		expect(copyOf()).toBe('Nur Adresse');
		cleanup();

		setup(
			entry({
				channel: 'mail',
				original: '',
				sourceMeta: {
					from: 'x@example.com',
					original_omitted: 'too_large',
					original_size: 31457280
				}
			})
		);
		await screen.findByRole('heading', { name: 'Rechnung September' });
		expect(copyOf()).toBe('Ohne Originaldatei (zu groß)');
		expect(
			screen.getByText(/^Die Mail war zu groß für die Originaldatei \(30,0 MB\)\./)
		).toBeTruthy();
	});

	it('links a new entry to a ticket through "Mit Ticket verknüpfen …"', async () => {
		const linking = sources();
		const { source } = fakePickerSource({
			open: [pickerTicket({ id: 'ticket000000004', key: 'TASK-4', title: 'Zahlungen' })]
		});
		setup(entry(), [], { sources: linking.store, picker: source });
		await screen.findByRole('heading', { name: 'Rechnung September' });
		await fireEvent.click(screen.getByRole('button', { name: 'Mit Ticket verknüpfen …' }));
		const dialog = screen.getByRole('dialog', { name: 'Mit Ticket verknüpfen' });
		const input = within(dialog).getByRole('combobox', { name: 'Ticket' }) as HTMLInputElement;
		// The list is there without typing (ADR-0042).
		await fireEvent.focus(input);
		await vi.waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
		await fireEvent.keyDown(input, { key: 'Enter' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Verknüpfen' }));
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(linking.data.link).toHaveBeenCalledWith(ID, 'ticket000000004');
	});

	it('saves the page of a web link and then shows its text and file (ADR-0031 section 6)', async () => {
		const link = entry({
			channel: 'link',
			kind: 'link',
			title: 'Rezept',
			original: '',
			body: '> Auszug',
			sourceUrl: 'https://example.com/rezept',
			sourceMeta: {}
		});
		const { data } = setup(link);
		await screen.findByRole('heading', { name: 'Rezept' });
		expect(copyOf()).toBe('Nur Adresse');
		data.get.mockResolvedValue({
			...link,
			original: 'seite_abc.html',
			body: '> Auszug\n\n---\n\nApfelkuchen',
			sourceMeta: { page: { fetched_at: '2026-09-27 19:30:00.000Z', truncated: true } },
			updated: '2026-09-27 19:30:00.000Z'
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Seiteninhalt sichern' }));
		await vi.waitFor(() => expect(copyOf()).toBe('Vollständig'));
		expect(data.savePage).toHaveBeenCalledWith(ID);
		expect(screen.getByText('Apfelkuchen')).toBeTruthy();
		const details = within(screen.getByRole('complementary'));
		expect(
			details.getByText('Seite gesichert', { selector: 'dt' }).nextElementSibling?.textContent
		).toBe('27.09.2026 21:30, auf 2 MB gekürzt');
		expect(screen.queryByRole('button', { name: 'Seiteninhalt sichern' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Originaldatei herunterladen' })).toBeTruthy();
	});

	it('names why a page was not saved', async () => {
		const { data } = setup(
			entry({ channel: 'link', kind: 'link', original: '', sourceUrl: 'http://127.0.0.1/' })
		);
		await screen.findByRole('heading', { name: 'Rechnung September' });
		data.savePage.mockResolvedValueOnce({
			kind: 'refused',
			message: 'Lokale, private und interne Adressen werden nicht abgerufen.'
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Seiteninhalt sichern' }));
		expect(
			await screen.findByText('Lokale, private und interne Adressen werden nicht abgerufen.')
		).toBeTruthy();
		expect(copyOf()).toBe('Nur Adresse');
	});

	const linked = (primary: boolean) =>
		entry({
			state: 'converted',
			ticketId: 'ticket000000012',
			ticket: { id: 'ticket000000012', key: 'HAUS-12', title: 'Steuer 2025', primary },
			handledAt: '2026-09-25 09:00:00.000Z'
		});

	it('names the ticket of a linked entry at the top with its actions (ADR-0031 addendum)', async () => {
		const linking = sources();
		setup(linked(false), [], { sources: linking.store });
		const section = await screen.findByRole('region', { name: 'Gehört zu HAUS-12 · Steuer 2025' });
		expect(within(section).getByRole('link', { name: 'Ticket öffnen' }).getAttribute('href')).toBe(
			'/tickets/ticket000000012'
		);
		expect(within(section).getByRole('button', { name: 'Anderem Ticket zuordnen …' })).toBeTruthy();
		expect(within(section).getByRole('button', { name: 'Lösen' })).toBeTruthy();
		expect(within(section).queryByText(/^Hauptquelle/)).toBeNull();
	});

	/** Open tickets of the picker (ADR-0042): the current ticket of the entry and another one. */
	const movePicker = () =>
		fakePickerSource({
			open: [
				pickerTicket({ id: 'ticket000000012', key: 'HAUS-12', title: 'Steuer 2025' }),
				pickerTicket({ id: 'ticket000000004', key: 'TASK-4', title: 'Zahlungen' })
			]
		}).source;

	it('moves a linked entry to another ticket; the current one cannot be chosen', async () => {
		const linking = sources();
		setup(linked(false), [], { sources: linking.store, picker: movePicker() });
		await fireEvent.click(await screen.findByRole('button', { name: 'Anderem Ticket zuordnen …' }));
		const dialog = screen.getByRole('dialog', { name: 'Anderem Ticket zuordnen' });
		expect(within(dialog).getByText(/gehört zu HAUS-12 und wechselt direkt/)).toBeTruthy();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Zuordnen' }));
		expect(within(dialog).getByText('Bitte ein Ticket wählen.')).toBeTruthy();
		const input = within(dialog).getByRole('combobox', {
			name: 'Neues Ticket'
		}) as HTMLInputElement;
		await fireEvent.focus(input);
		await vi.waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
		// Options of the ticket list (the select "Projekt" has options as well).
		const options = [...dialog.querySelectorAll('li[role="option"]')];
		expect(
			options.map((option) => [
				option.textContent?.includes('HAUS-12'),
				option.getAttribute('aria-disabled')
			])
		).toEqual([
			[true, 'true'],
			[false, null]
		]);
		await fireEvent.keyDown(input, { key: 'Enter' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Zuordnen' }));
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(linking.data.link).toHaveBeenCalledWith(ID, 'ticket000000004');
	});

	it('keeps a refused move in the dialog', async () => {
		const linking = sources();
		linking.data.link.mockRejectedValueOnce(
			new DataError('validation', {
				fields: {
					ticket: {
						code: 'validation_scope_mismatch',
						message: 'Verknüpfter Datensatz nicht gefunden oder in einem anderen Bereich.'
					}
				}
			})
		);
		setup(linked(false), [], { sources: linking.store, picker: movePicker() });
		await fireEvent.click(await screen.findByRole('button', { name: 'Anderem Ticket zuordnen …' }));
		const dialog = screen.getByRole('dialog', { name: 'Anderem Ticket zuordnen' });
		const input = within(dialog).getByRole('combobox', {
			name: 'Neues Ticket'
		}) as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'TASK' } });
		await vi.waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('true'));
		await fireEvent.keyDown(input, { key: 'Enter' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Zuordnen' }));
		expect(
			await within(dialog).findByText(
				'Verknüpfter Datensatz nicht gefunden oder in einem anderen Bereich.'
			)
		).toBeTruthy();
	});

	it('releases a linked entry from the panel', async () => {
		const linking = sources();
		linking.data.release.mockImplementation(async (id) => ({
			...entry(),
			id,
			state: 'new',
			ticketId: null,
			ticket: null,
			handledAt: null,
			updated: '2026-09-25 10:00:00.000Z'
		}));
		setup(linked(false), [], { sources: linking.store });
		await fireEvent.click(await screen.findByRole('button', { name: 'Lösen' }));
		await vi.waitFor(() => expect(screen.queryByText(/^Gehört zu/)).toBeNull());
		expect(linking.data.release).toHaveBeenCalledWith(ID);
		expect(screen.getByRole('button', { name: 'Mit Ticket verknüpfen …' })).toBeTruthy();
	});

	it('keeps the main source at its ticket and says why', async () => {
		setup(linked(true), [], { sources: sources().store });
		const section = await screen.findByRole('region', { name: 'Gehört zu HAUS-12 · Steuer 2025' });
		expect(
			within(section).getByText(/^Hauptquelle: Das Ticket ist aus diesem Eintrag/)
		).toBeTruthy();
		expect(within(section).getByRole('link', { name: 'Ticket öffnen' })).toBeTruthy();
		expect(within(section).queryByRole('button')).toBeNull();
	});

	it('says that the ticket of a returned source was deleted (addendum B)', async () => {
		setup(
			entry({
				sourceMeta: { ticket_deleted: { key: 'HAUS-12', at: '2026-09-27 10:00:00.000Z' } }
			})
		);
		expect(
			await screen.findByText(
				'Ticket HAUS-12 wurde gelöscht; dieser Eintrag war eine Quelle und ist wieder im Eingang.'
			)
		).toBeTruthy();
	});

	it('names the ticket a copied source came from, with a link to it (ADR-0031 addendum F)', async () => {
		setup(
			entry({
				sourceMeta: {
					copy_of: { item: 'item00000000009', ticket: 'ticket000000012', key: 'HAUS-12', at: '' }
				}
			})
		);
		const link = await screen.findByRole('link', { name: 'HAUS-12' });
		expect(link.getAttribute('href')).toBe('/tickets/ticket000000012');
		expect(link.closest('p, div')?.textContent?.replace(/\s+/g, ' ')).toContain(
			'Kopie aus HAUS-12: beim Duplizieren als eigener Eintrag angelegt; die Quelle des Originals ist unverändert.'
		);
	});

	it('offers no linking without the store, nor for a handled entry', async () => {
		setup();
		await screen.findByRole('heading', { name: 'Rechnung September' });
		expect(screen.queryByRole('button', { name: 'Mit Ticket verknüpfen …' })).toBeNull();
		cleanup();

		setup(entry({ state: 'discarded', handledAt: '2026-09-25 09:00:00.000Z' }), [], {
			sources: sources().store
		});
		await screen.findByRole('heading', { name: 'Rechnung September' });
		expect(screen.queryByRole('button', { name: 'Mit Ticket verknüpfen …' })).toBeNull();
	});
});
