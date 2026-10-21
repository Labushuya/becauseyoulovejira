// The parts of the outbox for "＋" without a connection (OF-4a, ADR-0074 addendum OF-4a): the dialog
// "Gemerkte Änderungen" names a creation with its whole title (C2) and offers "Ohne Projekt anlegen"
// after a refusal at the project (concept §3.7), a discarded creation says that it is looked up; the
// hint names a refused creation by its title, a discarded creation that arrived anyway with a link
// (C4); a card shows "Neu" in the place of the key, with names for screen readers that do not need it.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { OFFLINE_TEXTS, type KeptAction, type TicketCreateAction } from '$lib/domain/offline';
import type { TicketSummary } from '$lib/domain/ticket';
import { ConnectivityStore } from '$lib/offline/connectivity.svelte';
import { OutboxNoWayError, OutboxStore } from '$lib/offline/outbox.svelte';
import { MemoryOutboxStorage } from '$lib/offline/outbox-storage';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TicketCard from '../TicketCard.svelte';
import OfflineNotice from './OfflineNotice.svelte';
import OutboxDialog from './OutboxDialog.svelte';

useOverlayStubs();

const NOW = Date.UTC(2026, 9, 21, 12, 30, 0);
const USER = 'user00000000001';
const ID = 'abcdefghijklmno';
const PROJECT = 'proj00000000001';
const TITLE = 'Zahnarzt anrufen und Termin für Anna ausmachen';

function creation(overrides: Partial<TicketCreateAction> = {}): TicketCreateAction {
	return {
		v: 1,
		op: 'zzzzzzzzzzzzzzzzzzz1',
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'ticket.create',
		target: ID,
		dependsOn: [],
		key: '',
		title: TITLE,
		createdAt: NOW - 27 * 60_000,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0,
		payload: {
			title: TITLE,
			status: 'open',
			priority: 'medium',
			due: null,
			project: PROJECT,
			tags: [],
			household: ''
		},
		expected: {},
		...overrides
	};
}

const REFUSED = creation({
	state: 'refused',
	sent: true,
	outcome: {
		code: 'validation_project_archived',
		message: 'Das Projekt ist archiviert.',
		field: 'project'
	}
});

async function outboxWith(actions: KeptAction[], notices: unknown[] = []) {
	const storage = new MemoryOutboxStorage();
	for (const action of actions) await storage.put(action);
	if (notices.length > 0) await storage.notices(USER, () => notices);
	const connectivity = new ConnectivityStore(async () => false);
	const refuse = async () => {
		throw new OutboxNoWayError();
	};
	const outbox = new OutboxStore({
		storage,
		connectivity,
		send: refuse,
		sendCreate: refuse,
		get: refuse,
		tab: 'a'
	});
	outbox.attach(USER);
	outbox.setSupport({ version: 1, kinds: ['ticket.update', 'ticket.create'] });
	outbox.setFrame(true);
	outbox.connect({
		upsert: vi.fn(),
		flags: { show: vi.fn(() => ''), dismiss: vi.fn() },
		sessionEnded: vi.fn()
	});
	await vi.advanceTimersByTimeAsync(0);
	await connectivity.check();
	await tick();
	return outbox;
}

const ticketHref = (id: string) => `/tickets/${id}` as ResolvedPathname;
const itemHref = (id: string) => `/eingang/${id}` as ResolvedPathname;

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('OutboxDialog with a creation (OF-4a)', () => {
	it('names a waiting creation with its whole title, its state and "Verwerfen"', async () => {
		const outbox = await outboxWith([creation()]);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref, itemHref } });
		const row = screen.getByText(OFFLINE_TEXTS.newTicket).closest('li') as HTMLElement;
		expect(row.textContent).toContain(TITLE);
		expect(row.textContent).toContain('offline um 14:03 · wartet');
		expect(within(row).getByRole('button', { name: 'Verwerfen' })).toBeTruthy();
	});

	it('keeps the whole text of a refused creation to be read and offers "Ohne Projekt anlegen" (C2, §3.7)', async () => {
		const outbox = await outboxWith([REFUSED]);
		const createWithout = vi.spyOn(outbox, 'createWithout').mockResolvedValue();
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref, itemHref } });
		const row = screen.getByText(OFFLINE_TEXTS.newTicket).closest('li') as HTMLElement;
		expect(row.textContent).toContain(TITLE);
		expect(row.textContent).toContain('Das Projekt ist archiviert.');
		// The title is plain text the user can mark (the clipboard is blocked over HTTP).
		const title = within(row).getByText(TITLE);
		expect(getComputedStyle(title).userSelect).not.toBe('none');
		await fireEvent.click(within(row).getByRole('button', { name: OFFLINE_TEXTS.withoutProject }));
		expect(createWithout).toHaveBeenCalledWith(REFUSED.op, 'project');
		expect(
			within(row).getByRole('link', { name: OFFLINE_TEXTS.openTicket }).getAttribute('href')
		).toBe(`/tickets/${ID}`);
	});

	it('says what a change waits for in a sentence: "wartet auf das neue Ticket" (round 2, A10)', async () => {
		const change: KeptAction = {
			v: 1,
			op: 'zzzzzzzzzzzzzzzzzzz2',
			seq: 2,
			user: USER,
			scope: `u:${USER}`,
			kind: 'ticket.update',
			target: ID,
			dependsOn: [REFUSED.op],
			key: '',
			title: TITLE,
			createdAt: NOW - 20 * 60_000,
			state: 'queued',
			attempts: 0,
			nextAttemptAt: 0,
			payload: { status: 'done' },
			expected: { status: 'open' }
		};
		const outbox = await outboxWith([REFUSED, change]);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref, itemHref } });
		const row = screen.getByText('Ticket erledigt').closest('li') as HTMLElement;
		expect(row.textContent).toContain(`wartet auf das neue Ticket „${TITLE}“`);
	});

	it('says that a discarded creation that may have arrived is looked up, without "Verwerfen" (C4)', async () => {
		const outbox = await outboxWith([creation({ sent: true, unanswered: true, discarded: true })]);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref, itemHref } });
		const row = screen.getByText(OFFLINE_TEXTS.newTicket).closest('li') as HTMLElement;
		expect(row.textContent).toContain(OFFLINE_TEXTS.createChecking);
		expect(within(row).queryByRole('button', { name: 'Verwerfen' })).toBeNull();
	});
});

describe('OfflineNotice with a creation (OF-4a)', () => {
	it('names a refused creation by its title', async () => {
		const outbox = await outboxWith([REFUSED]);
		render(OfflineNotice, { props: { outbox, onshow: vi.fn() } });
		expect(screen.getByRole('status').textContent).toContain(
			`1 Änderung konnte nicht übertragen werden. Neues Ticket „${TITLE}“: Das Projekt ist archiviert.`
		);
	});

	it('names a refused creation among others in the middle of the sentence in small letters (round 2, A10)', async () => {
		const other: KeptAction = {
			...REFUSED,
			op: 'zzzzzzzzzzzzzzzzzzz3',
			seq: 3,
			target: 'bcdefghijklmnop',
			payload: { ...REFUSED.payload, title: 'Fenster putzen' },
			title: 'Fenster putzen'
		};
		const outbox = await outboxWith([REFUSED, other]);
		render(OfflineNotice, { props: { outbox, onshow: vi.fn() } });
		expect(screen.getByRole('status').textContent).toContain(
			`2 Änderungen konnten nicht übertragen werden, darunter das neue Ticket „${TITLE}“: Das Projekt ist archiviert.`
		);
	});

	it('names a discarded creation that arrived anyway with a link to it, until "Schließen"', async () => {
		const notice = {
			v: 1,
			id: 'created-zzzzzzzzzzzzzzzzzzz1',
			kind: 'created',
			at: NOW,
			record: 'ticket',
			target: ID,
			key: 'TASK-13',
			title: TITLE
		};
		const outbox = await outboxWith([], [notice]);
		const linkOf = (record: 'ticket' | 'inbox', id: string) =>
			record === 'ticket' ? ticketHref(id) : itemHref(id);
		render(OfflineNotice, { props: { outbox, onshow: vi.fn(), linkOf } });
		const status = screen.getByRole('status');
		expect(status.textContent).toContain(
			`Das verworfene Ticket „${TITLE}“ wurde schon angelegt (TASK-13). Bitte im Ticket prüfen und bei Bedarf löschen.`
		);
		const link = within(status).getByRole('link', { name: OFFLINE_TEXTS.openTicket });
		expect(link.getAttribute('href')).toBe(`/tickets/${ID}`);
		expect(within(status).getByRole('button', { name: OFFLINE_TEXTS.closeNotice })).toBeTruthy();
	});
});

describe('a card of a ticket "＋" created (OF-4a, concept §2.3)', () => {
	it('shows "Neu" in the place of the key and names it by its title for screen readers', async () => {
		const ticket: TicketSummary = {
			id: ID,
			key: '',
			title: TITLE,
			status: 'open',
			priority: 'medium',
			due: null,
			projectId: null,
			tagIds: [],
			project: null,
			tags: [],
			recurring: false,
			source: 'quick',
			completedAt: null,
			created: '2026-10-21 12:03:00.000Z',
			updated: '2026-10-21 12:03:00.000Z'
		};
		const { container } = render(TicketCard, {
			props: {
				ticket,
				project: null,
				tags: [],
				href: ticketHref(ID),
				today: '2026-10-21',
				checked: false,
				pending: false,
				onstatus: vi.fn(),
				ontoggle: vi.fn()
			}
		});
		expect(container.querySelector('.key')?.textContent?.trim()).toBe('Neu');
		expect(screen.getByRole('checkbox', { name: `Neues Ticket „${TITLE}“ erledigt` })).toBeTruthy();
	});
});
