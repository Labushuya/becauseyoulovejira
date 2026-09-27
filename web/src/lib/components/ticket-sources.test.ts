// Section "Quellen" of a ticket and "Quelle hinzufügen …" (ADR-0031 section 7): rows with channel,
// date, sender or chat or address, main source and copy status; "Ansehen", the original file and
// "Lösen" as named icon buttons; the dialog of new inbox entries. Real store with fake data.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboxItemSummary } from '$lib/domain/inbox';
import { FlagStore } from '$lib/stores/flags.svelte';
import { TicketSourcesStore, type TicketSourcesData } from '$lib/stores/ticket-sources.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TicketSources from './TicketSources.svelte';

useOverlayStubs();

const TICKET = { id: 'ticket000000001', key: 'TASK-4', sourceItem: 'main00000000001' };

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

async function setup(sources: InboxItemSummary[], candidates: InboxItemSummary[] = []) {
	const data = {
		list: vi.fn<TicketSourcesData['list']>(async () => sources),
		link: vi.fn<TicketSourcesData['link']>(async (id, ticketId) => ({
			...(candidates.find((entry) => entry.id === id) as InboxItemSummary),
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
		search: vi.fn<TicketSourcesData['search']>(async () => []),
		originalUrl: vi.fn<TicketSourcesData['originalUrl']>(async () => 'http://x/mail.eml?token=t')
	} satisfies TicketSourcesData;
	const flags = new FlagStore();
	const store = new TicketSourcesStore(data, { ensureValid: () => true, logout: vi.fn() }, flags);
	store.open(TICKET.id, TICKET.sourceItem);
	render(TicketSources, { props: { ticket: TICKET, store, candidates } });
	await vi.waitFor(() => expect(store.state).toBe('ready'));
	return { store, data, flags };
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
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

	it('releases a linked source; it leaves the list with a flag', async () => {
		const { data, flags } = await setup([MAIN, CHAT]);
		await fireEvent.click(
			screen.getByRole('button', { name: '„Nachricht chat00000000001“ lösen' })
		);
		expect(data.release).toHaveBeenCalledWith('chat00000000001');
		await vi.waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
		expect(flags.flags.at(-1)?.title).toBe('„Nachricht chat00000000001“ ist wieder im Eingang.');
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
