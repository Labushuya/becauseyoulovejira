// The parts of the outbox for comments (OF-4b, ADR-0074 addendum OF-4b): the dialog "Gemerkte
// Änderungen" names a comment by its ticket and the beginning of its text, shows the whole text of one
// that waits for a decision, readable and selectable, with "Als Eingangseintrag sichern" (C2), and a
// creation of a ticket names its comments; the hints name a refused comment and a discarded one that
// arrived anyway with a link to its ticket; the comment shows its head "Offline geschrieben um …" and,
// kept, no action that needs the server; the form says that a comment was kept.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import {
	COMMENT_REFUSED_CODE,
	OFFLINE_TEXTS,
	SET_ASIDE_CODE,
	type CommentCreateAction,
	type KeptAction,
	type TicketCreateAction
} from '$lib/domain/offline';
import type { Comment } from '$lib/domain/ticket';
import { ConnectivityStore } from '$lib/offline/connectivity.svelte';
import { OutboxNoWayError, OutboxStore } from '$lib/offline/outbox.svelte';
import { MemoryOutboxStorage } from '$lib/offline/outbox-storage';
import { TicketActivityStore, type CommentOverlay } from '$lib/stores/ticket-activity.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { useProseMirrorStubs } from '$lib/test/prosemirror-stubs';
import CommentList from '../CommentList.svelte';
import OfflineNotice from './OfflineNotice.svelte';
import OutboxDialog from './OutboxDialog.svelte';

useOverlayStubs();
useProseMirrorStubs();

// 2026-10-21 14:30 in Berlin (CEST).
const NOW = Date.UTC(2026, 9, 21, 12, 30, 0);
const USER = 'user00000000001';
const TICKET = 'tick00000000012';
const NEW_TICKET = 'abcdefghijklmno';
const TEXT = 'Bitte bis Freitag den Termin bestätigen.\nDanach Anna Bescheid geben.';
const EXCERPT = 'Bitte bis Freitag den Termin bestätigen…';

function comment(overrides: Partial<CommentCreateAction> = {}): CommentCreateAction {
	return {
		v: 1,
		op: 'zzzzzzzzzzzzzzzzzzz5',
		seq: 5,
		user: USER,
		scope: `u:${USER}`,
		kind: 'comment.create',
		target: 'cccccccccccccc1',
		ticket: TICKET,
		dependsOn: [],
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		createdAt: NOW - 27 * 60_000,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0,
		payload: { body: TEXT },
		expected: {},
		...overrides
	};
}

const REFUSED = comment({
	state: 'refused',
	sent: true,
	outcome: { code: COMMENT_REFUSED_CODE, message: OFFLINE_TEXTS.commentRefused }
});

const CREATION: TicketCreateAction = {
	v: 1,
	op: 'zzzzzzzzzzzzzzzzzzz1',
	seq: 1,
	user: USER,
	scope: `u:${USER}`,
	kind: 'ticket.create',
	target: NEW_TICKET,
	dependsOn: [],
	key: '',
	title: 'Zahnarzt anrufen',
	createdAt: NOW - 30 * 60_000,
	state: 'queued',
	attempts: 0,
	nextAttemptAt: 0,
	payload: {
		title: 'Zahnarzt anrufen',
		status: 'open',
		priority: 'medium',
		due: null,
		project: null,
		tags: [],
		household: ''
	},
	expected: {}
};

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
		sendItem: refuse,
		sendComment: refuse,
		get: refuse,
		tab: 'a'
	});
	outbox.attach(USER);
	outbox.setSupport({
		version: 1,
		kinds: ['ticket.update', 'ticket.create', 'inbox.create', 'comment.create']
	});
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

describe('OutboxDialog with comments (OF-4b)', () => {
	it('names a waiting comment by its ticket and the beginning of its text, with "Verwerfen"', async () => {
		const outbox = await outboxWith([comment()]);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref, itemHref } });
		const row = screen.getByText('Kommentar zu HAUS-12').closest('li') as HTMLElement;
		expect(row.textContent).toContain(`„${EXCERPT}“`);
		expect(row.textContent).toContain('offline um 14:03 · wartet');
		expect(within(row).getByRole('button', { name: 'Verwerfen' })).toBeTruthy();
	});

	it('shows the whole text of a refused comment to be marked, with "Als Eingangseintrag sichern" (C2)', async () => {
		const outbox = await outboxWith([REFUSED]);
		const save = vi.spyOn(outbox, 'saveAsItem').mockResolvedValue();
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref, itemHref } });
		const row = screen.getByText('Kommentar zu HAUS-12').closest('li') as HTMLElement;
		const text = row.querySelector('blockquote') as HTMLElement;
		expect(text.textContent).toBe(TEXT);
		expect(getComputedStyle(text).userSelect).not.toBe('none');
		expect(row.textContent).toContain(OFFLINE_TEXTS.commentRefused);
		await fireEvent.click(within(row).getByRole('button', { name: 'Als Eingangseintrag sichern' }));
		expect(save).toHaveBeenCalledWith(REFUSED.op);
		expect(within(row).getByRole('button', { name: 'Verwerfen' })).toBeTruthy();
		expect(
			within(row).getByRole('link', { name: OFFLINE_TEXTS.openTicket }).getAttribute('href')
		).toBe(`/tickets/${TICKET}`);
	});

	it('names the comments of a new ticket in its row, and a comment set aside without a link', async () => {
		const waiting = comment({ ticket: NEW_TICKET, key: '', title: 'Zahnarzt anrufen' });
		const outbox = await outboxWith([CREATION, { ...waiting, dependsOn: [CREATION.op] }]);
		const { unmount } = render(OutboxDialog, {
			props: { outbox, onclose: vi.fn(), ticketHref, itemHref }
		});
		const row = screen.getByText(OFFLINE_TEXTS.newTicket).closest('li') as HTMLElement;
		expect(row.textContent).toContain(OFFLINE_TEXTS.withComments(1));
		const commentRow = screen
			.getByText('Kommentar zu Neu „Zahnarzt anrufen“')
			.closest('li') as HTMLElement;
		expect(commentRow.textContent).toContain('offline um 14:03 · wartet');
		unmount();

		const aside = comment({
			ticket: NEW_TICKET,
			key: '',
			title: 'Zahnarzt anrufen',
			state: 'refused',
			outcome: { code: SET_ASIDE_CODE, message: OFFLINE_TEXTS.commentSetAside('Zahnarzt anrufen') }
		});
		const later = await outboxWith([aside]);
		render(OutboxDialog, { props: { outbox: later, onclose: vi.fn(), ticketHref, itemHref } });
		const parked = screen
			.getByText('Kommentar zu Neu „Zahnarzt anrufen“')
			.closest('li') as HTMLElement;
		expect(parked.querySelector('blockquote')?.textContent).toBe(TEXT);
		expect(parked.textContent).toContain(OFFLINE_TEXTS.commentSetAside('Zahnarzt anrufen'));
		expect(
			within(parked).getByRole('button', { name: 'Als Eingangseintrag sichern' })
		).toBeTruthy();
		expect(within(parked).queryByRole('link', { name: OFFLINE_TEXTS.openTicket })).toBeNull();
	});

	it('offers "Trotzdem übertragen" and "Als Eingangseintrag sichern" for a comment older than 48 hours', async () => {
		const outbox = await outboxWith([comment({ state: 'expired' })]);
		render(OutboxDialog, { props: { outbox, onclose: vi.fn(), ticketHref, itemHref } });
		const row = screen.getByText('Kommentar zu HAUS-12').closest('li') as HTMLElement;
		expect(row.textContent).toContain(OFFLINE_TEXTS.expiredHint);
		expect(within(row).getByRole('button', { name: OFFLINE_TEXTS.sendAnyway })).toBeTruthy();
		expect(within(row).getByRole('button', { name: 'Als Eingangseintrag sichern' })).toBeTruthy();
	});
});

describe('OfflineNotice with comments (OF-4b)', () => {
	it('names a refused comment by the beginning of its text', async () => {
		const outbox = await outboxWith([REFUSED]);
		render(OfflineNotice, { props: { outbox, onshow: vi.fn() } });
		expect(screen.getByRole('status').textContent).toContain(
			`1 Änderung konnte nicht übertragen werden. Kommentar „${EXCERPT}“: ${OFFLINE_TEXTS.commentRefused}`
		);
	});

	it('names a discarded comment that arrived anyway with a link to its ticket', async () => {
		const notice = {
			v: 1,
			id: 'created-zzzzzzzzzzzzzzzzzzz5',
			kind: 'created',
			at: NOW,
			record: 'comment',
			target: 'cccccccccccccc1',
			ticket: TICKET,
			key: 'HAUS-12',
			title: EXCERPT
		};
		const outbox = await outboxWith([], [notice]);
		const linkOf = (record: 'ticket' | 'inbox', id: string) =>
			record === 'ticket' ? ticketHref(id) : itemHref(id);
		render(OfflineNotice, { props: { outbox, onshow: vi.fn(), linkOf } });
		const status = screen.getByRole('status');
		expect(status.textContent).toContain(
			`Der verworfene Kommentar „${EXCERPT}“ ist schon angekommen (HAUS-12). Bitte im Ticket prüfen und bei Bedarf löschen.`
		);
		const link = within(status).getByRole('link', { name: OFFLINE_TEXTS.openTicket });
		expect(link.getAttribute('href')).toBe(`/tickets/${TICKET}`);
	});
});

describe('a comment of the outbox in the activity (OF-4b, concept §2.3)', () => {
	const KEPT: Comment = {
		id: 'cccccccccccccc1',
		ticket: TICKET,
		author: USER,
		body: 'Gemerkt',
		created: '2026-10-21 12:03:00.000Z',
		updated: '2026-10-21 12:03:00.000Z',
		offline: true,
		deviceAt: '2026-10-21 12:03:00.000Z'
	};
	const ARRIVED: Comment = {
		id: 'cccccccccccccc0',
		ticket: TICKET,
		author: USER,
		body: 'Angekommen',
		created: '2026-10-21 12:20:00.000Z',
		updated: '2026-10-21 12:20:00.000Z',
		offline: true,
		deviceAt: '2026-10-21 11:58:00.000Z'
	};

	async function activity(kept: Comment[]) {
		const overlay: CommentOverlay = {
			keptComments: () => kept,
			isCreatedView: (record) => kept.includes(record as Comment),
			createdTicket: () => null,
			offline: true
		};
		const created = { ...KEPT, id: 'cccccccccccccc2', body: 'Noch einer' };
		const data = {
			listComments: vi.fn(async () => [ARRIVED]),
			createComment: vi.fn(async () => {
				kept.push(created);
				return created;
			}),
			updateComment: vi.fn(),
			deleteComment: vi.fn(),
			listHistory: vi.fn(async () => [])
		};
		const store = new TicketActivityStore(
			data,
			{ ensureValid: () => true, logout: vi.fn() },
			() => USER,
			overlay
		);
		store.open(TICKET);
		render(CommentList, { props: { store, ondeleted: vi.fn() } });
		await vi.waitFor(() => expect(store.commentsState).toBe('ready'));
		await tick();
		return store;
	}

	const article = (body: string) => screen.getByText(body).closest('article') as HTMLElement;

	it('heads a kept comment "Offline geschrieben um … (laut Gerät)" without actions of the server', async () => {
		await activity([KEPT]);
		const kept = article('Gemerkt');
		expect(kept.querySelector('header')?.textContent).toContain(
			'Offline geschrieben um 14:03 (laut Gerät)'
		);
		expect(kept.querySelector('header')?.textContent).not.toContain('übertragen');
		expect(within(kept).queryByRole('button', { name: /Bearbeiten/ })).toBeNull();
		expect(within(kept).queryByRole('button', { name: /Löschen/ })).toBeNull();
	});

	it('heads one that arrived "… · übertragen 14:20", and keeps its actions', async () => {
		await activity([KEPT]);
		const arrived = article('Angekommen');
		expect(arrived.querySelector('header')?.textContent).toContain(
			'Offline geschrieben um 13:58 (laut Gerät) · übertragen 14:20'
		);
		expect(within(arrived).getByRole('button', { name: /Bearbeiten/ })).toBeTruthy();
	});

	it('says in the form that a comment was kept', async () => {
		const store = await activity([KEPT]);
		store.setNewComment('Noch einer');
		await store.post();
		await tick();
		expect(screen.getByText(OFFLINE_TEXTS.keptComment(true)).getAttribute('role')).toBe('status');
		// The view of the outbox is not taken into the comments of the server.
		expect(store.comments.map((entry) => entry.body)).toEqual(['Angekommen', 'Gemerkt']);
	});
});
