// Component tests for the panel of an inbox entry (E4 plan, package 3; ADR-0019 section 5):
// details of the source, sanitised text, actions, download of the protected original, hint on a
// possible duplicate, entry not found, Escape. The store is real with fake data.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { InboxItem } from '$lib/domain/inbox';
import type { TicketSummary } from '$lib/domain/ticket';
import type { ResolvedPathname } from '$app/types';
import { InboxStore, type InboxData } from '$lib/stores/inbox.svelte';
import InboxPanel from './InboxPanel.svelte';

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
		sourceMeta: { from: 'Shop <shop@example.com>', to: 'ich@example.com' },
		original: 'mail_abc.eml',
		state: 'new',
		ticketId: null,
		handledAt: null,
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 08:00:00.000Z',
		...overrides
	};
}

function setup(item: InboxItem | Error = entry(), tickets: TicketSummary[] = []) {
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
		}))
	} satisfies InboxData;
	const store = new InboxStore(data, { ensureValid: () => true, logout: vi.fn() });
	const onclose = vi.fn();
	render(InboxPanel, {
		props: {
			id: ID,
			store,
			openTickets: tickets,
			closeHref: '/eingang?quelle=mail' as ResolvedPathname,
			onclose
		}
	});
	return { store, data, onclose };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('inbox panel', () => {
	it('shows the details of the source and focuses the title', async () => {
		setup();
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
		expect(text('Quelldatum')).toBe('25.09.2026 01:30');
		expect(text('Eingang')).toBe('25.09.2026 10:00');
		const link = details.getByRole('link', { name: 'https://shop.example.com/rechnung' });
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(screen.getByText(/Das Quelldatum wird nicht zur Fälligkeit/)).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Schließen' }).getAttribute('href')).toBe(
			'/eingang?quelle=mail'
		);
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

	it('links a converted entry to its ticket', async () => {
		setup(
			entry({
				state: 'converted',
				ticketId: 'tick00000000001',
				handledAt: '2026-09-25 09:00:00.000Z'
			})
		);
		expect((await screen.findByRole('link', { name: 'Ticket ansehen' })).getAttribute('href')).toBe(
			'/tickets/tick00000000001'
		);
		expect(screen.queryByRole('button', { name: 'Verwerfen' })).toBeNull();
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
		expect(await screen.findByRole('link', { name: 'Ticket ansehen' })).toBeTruthy();
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
