// Comments without a connection (OF-4b, ADR-0074 addendum OF-4b) on the scaffold of the outbox
// ($lib/test/outbox-fake.ts, whose server writes comments as comments.pb.js and the rules of `comments`
// do): a comment under an ID of the client, kept and shown until the server has it, sent once with its
// identifier (C1), behind the creation of its ticket "＋" created and the comment written before it;
// refused with its whole text kept and "Als Eingangseintrag sichern" (C2); "Verwerfen" before, while
// and after it may have left the device (C3, C4); the comments of a discarded creation set aside; the
// deletion after 7 days names a comment with its text.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import {
	COMMENT_REFUSED_CODE,
	KEEP_MS,
	OFFLINE_TEXTS,
	SET_ASIDE_CODE,
	isCommentCreate,
	isInboxCreate,
	type KeptAction
} from '$lib/domain/offline';
import type { TicketDraft } from '$lib/domain/ticket';
import {
	A,
	ALL_OPS,
	NOW,
	USER,
	goOffline,
	goOnline,
	harness,
	settle,
	ticket as ticketOf,
	type Harness
} from '$lib/test/outbox-fake';

/** `letters()` draws one letter per call: the ID of a record first, then the identifier. */
const FIRST_ID = 'aaaaaaaaaaaaaaa';
const FIRST_OP = 'bbbbbbbbbbbbbbbbbbbb';
const SECOND_ID = 'ccccccccccccccc';
const MINUTE = 60_000;
const GRACE = 5 * MINUTE;
const TEXT = 'Bitte bis Freitag den Termin bestätigen.\n\nDanach Anna Bescheid geben.';
const ON_A = { id: A, key: 'HAUS-01', title: 'Ticket 01', scope: `u:${USER}` };

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

async function ready(options: Parameters<typeof harness>[0] = {}): Promise<Harness> {
	const h = harness({ support: ALL_OPS, ...options });
	h.server.strict = true;
	// The ticket A is there on the server.
	h.server.status.set(A, 'open');
	await settle();
	return h;
}

function draft(): TicketDraft {
	return {
		title: 'Zahnarzt anrufen',
		description: '',
		status: 'open',
		priority: 'medium',
		due: null,
		project: null,
		tags: []
	};
}

function comments(h: Harness): KeptAction[] {
	return h.outbox.actions.filter(isCommentCreate);
}

function only(h: Harness): KeptAction {
	expect(h.outbox.actions).toHaveLength(1);
	return h.outbox.actions[0] as KeptAction;
}

describe('a comment with a connection (OF-4b)', () => {
	it('goes at once under an ID of the client with only its identifier, and is never shown as kept', async () => {
		const h = await ready();
		const shownWhileSent: number[] = [];
		const way = h.sendComment.getMockImplementation();
		if (way === undefined) throw new Error('No way.');
		h.sendComment.mockImplementationOnce(async (action, fields, signal) => {
			shownWhileSent.push(h.outbox.keptComments(A).length);
			return way(action, fields, signal);
		});
		const created = await h.outbox.createComment(ON_A, TEXT);
		expect(created.kept).toBe(false);
		expect(created.value).toMatchObject({ id: FIRST_ID, ticket: A, body: TEXT });
		expect(created.value).not.toHaveProperty('offline');
		expect(h.sendComment.mock.calls[0]?.[0]).toMatchObject({ target: FIRST_ID, ticket: A });
		expect(h.sendComment.mock.calls[0]?.[1]).toEqual({ opId: FIRST_OP });
		expect(shownWhileSent).toEqual([0]);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.keptComments(A)).toEqual([]);
	});

	it('never shows its ticket anew: a comment changes nothing the views show of it (found by the smoke test)', async () => {
		const h = await ready();
		// The views showed the ticket before; the outbox remembers it as the state of the server.
		h.outbox.apply({ ...ticketOf(A), updated: '2026-10-20 08:00:00.000Z' });
		await h.outbox.createComment(ON_A, TEXT);
		await goOffline(h);
		await h.outbox.createComment(ON_A, 'Ohne Verbindung');
		await goOnline(h);
		expect(h.server.comments.size).toBe(2);
		expect(h.sink.upsert).not.toHaveBeenCalled();
	});

	it('refuses the first attempt like today when the server refuses it: the text stays in the form', async () => {
		const h = await ready();
		h.server.hidden.add(A);
		await expect(h.outbox.createComment(ON_A, TEXT)).rejects.toBeInstanceOf(DataError);
		expect(h.outbox.count).toBe(0);
		expect(h.server.comments.size).toBe(0);
	});

	it('keeps it after a 5xx at the first attempt and writes it once later under the same ID (C1)', async () => {
		const h = await ready();
		const way = h.sendComment.getMockImplementation();
		if (way === undefined) throw new Error('No way.');
		h.sendComment.mockImplementationOnce(async (action, fields, signal) => {
			await way(action, fields, signal);
			throw new DataError('server', { status: 502 });
		});
		const created = await h.outbox.createComment(ON_A, TEXT);
		expect(created.kept).toBe(true);
		expect(only(h)).toMatchObject({ unanswered: true, attempts: 1 });
		await vi.advanceTimersByTimeAsync(3_000);
		expect(h.sendComment).toHaveBeenCalledTimes(2);
		expect(h.server.comments.size).toBe(1);
		expect(h.outbox.count).toBe(0);
	});
});

describe('a comment without a connection (OF-4b)', () => {
	it('is kept, shown at once with its mark, and written once the connection is back', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createComment(ON_A, TEXT);
		expect(created.kept).toBe(true);
		expect(created.value).toMatchObject({ id: FIRST_ID, ticket: A, body: TEXT, offline: true });
		expect(h.outbox.isCreatedView(created.value)).toBe(true);
		expect(h.outbox.keptComments(A).map((comment) => comment.id)).toEqual([FIRST_ID]);
		expect(h.outbox.markOf(FIRST_ID)).toBe('pending');
		// The ticket itself carries no mark: a comment is no change of it.
		expect(h.outbox.markOf(A)).toBeNull();
		expect(h.sendComment).not.toHaveBeenCalled();
		let shownWhileKept = false;
		h.sink.upsertComment.mockImplementation(() => {
			if (h.outbox.actions.some((action) => action.target === FIRST_ID)) shownWhileKept = true;
		});
		await goOnline(h);
		expect(h.sendComment.mock.calls[0]?.[1]).toEqual({
			opId: FIRST_OP,
			clientAt: new Date(NOW).toISOString()
		});
		expect(h.server.comments.get(FIRST_ID)).toMatchObject({ ticket: A, body: TEXT, offline: true });
		// The comment of the server shows before the action goes: no gap under its ID.
		expect(shownWhileKept).toBe(true);
		expect(h.sink.upsertComment).toHaveBeenCalledWith(
			expect.objectContaining({
				id: FIRST_ID,
				offline: true,
				deviceAt: new Date(NOW).toISOString()
			})
		);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.keptComments(A)).toEqual([]);
		expect(h.flags.show).toHaveBeenCalledWith({ tone: 'success', title: OFFLINE_TEXTS.sent(1) });
	});

	it('writes one comment when the answer got lost or the request timed out and it is sent again (C1)', async () => {
		for (const failure of [new DataError('network'), new DataError('aborted')]) {
			const h = await ready();
			await goOffline(h);
			await h.outbox.createComment(ON_A, TEXT);
			const way = h.sendComment.getMockImplementation();
			if (way === undefined) throw new Error('No way.');
			h.sendComment.mockImplementationOnce(async (action, fields, signal) => {
				await way(action, fields, signal);
				throw failure;
			});
			await goOnline(h);
			expect(only(h)).toMatchObject({ unanswered: true });
			await goOffline(h);
			await goOnline(h);
			expect(h.server.sent.filter((op) => op === FIRST_OP)).toHaveLength(2);
			expect([...h.server.comments.keys()]).toEqual([FIRST_ID]);
			expect(h.outbox.count).toBe(0);
			h.stop();
		}
	});

	it('keeps several comments in the order they were written, also when the first one meets a 5xx', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createComment(ON_A, 'Erster');
		await h.outbox.createComment(ON_A, 'Zweiter');
		const [first, second] = comments(h);
		// The second waits for the first (concept §3.3: the order in which they were written).
		expect(second?.dependsOn).toEqual([first?.op]);
		h.sendComment.mockRejectedValueOnce(new DataError('server', { status: 503 }));
		await goOnline(h);
		expect(h.server.comments.size).toBe(0);
		expect(comments(h)).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(h.server.writes).toEqual([`comment:${FIRST_ID}`, `comment:${SECOND_ID}`]);
		expect([...h.server.comments.values()].map((comment) => comment.body)).toEqual([
			'Erster',
			'Zweiter'
		]);
	});

	it('keeps the order when a comment in the middle that never left the device is discarded (found by the matrix)', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createComment(ON_A, 'Erster');
		await h.outbox.createComment(ON_A, 'Zweiter');
		await h.outbox.createComment(ON_A, 'Dritter');
		const [first, second, third] = comments(h);
		expect(third?.dependsOn).toEqual([first?.op, second?.op]);
		await h.outbox.discard(second?.op ?? '');
		h.sendComment.mockRejectedValueOnce(new DataError('server', { status: 503 }));
		await goOnline(h);
		// The first one waits after its 5xx; the third does not overtake it.
		expect(h.server.comments.size).toBe(0);
		await vi.advanceTimersByTimeAsync(3_000);
		expect([...h.server.comments.values()].map((comment) => comment.body)).toEqual([
			'Erster',
			'Dritter'
		]);
	});

	it('goes the way of today where the server or the app does not take comments', async () => {
		const without = await ready({ support: { version: 1, kinds: ['ticket.update'] } });
		expect(without.outbox.takesComment(A)).toBe(false);
		const app = await ready({ withoutComments: true });
		expect(app.outbox.takesComment(A)).toBe(false);
		const frame = await ready({ frame: false });
		expect(frame.outbox.takesComment(A)).toBe(false);
		expect((await ready()).outbox.takesComment(A)).toBe(true);
	});
});

describe('a comment on a ticket "＋" created (OF-4b, concept §3.3)', () => {
	it('waits for the creation of its ticket: first the ticket, then its comments in their order', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createTicket(draft());
		const ticket = created.value;
		await h.outbox.createComment(ticket, 'Erster');
		await h.outbox.createComment(ticket, 'Zweiter');
		const [creation] = h.outbox.actions;
		const [first, second] = comments(h);
		expect(first?.dependsOn).toEqual([creation?.op]);
		expect(second?.dependsOn).toEqual([creation?.op, first?.op]);
		expect(h.outbox.keptComments(ticket.id)).toHaveLength(2);
		// A change of the status still goes into the creation (comments change no value).
		await h.outbox.changeStatus(h.outbox.createdTicket(ticket.id) ?? ticket, {
			status: 'in_progress'
		});
		expect(h.outbox.actions).toHaveLength(3);
		await goOnline(h);
		const commentIds = comments(h).map((comment) => comment.target);
		expect(commentIds).toEqual([]);
		const ids = [...h.server.comments.keys()];
		expect(h.server.writes).toEqual([`ticket:${ticket.id}`, ...ids.map((id) => `comment:${id}`)]);
		expect([...h.server.comments.values()].map((comment) => comment.body)).toEqual([
			'Erster',
			'Zweiter'
		]);
		expect(h.server.status.get(ticket.id)).toBe('in_progress');
		expect(h.outbox.count).toBe(0);
	});

	it('takes a comment on a ticket "＋" created outside of the frame as well, so it never overtakes it', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createTicket(draft());
		h.outbox.setFrame(false);
		expect(h.outbox.takesComment(created.value.id)).toBe(true);
		expect(h.outbox.takesComment(A)).toBe(false);
	});
});

describe('a refused comment (OF-4b, C2)', () => {
	async function refused(): Promise<Harness> {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createComment(ON_A, TEXT);
		// The ticket went into the trash meanwhile: the create rule of `comments` fails.
		h.server.hidden.add(A);
		await goOnline(h);
		return h;
	}

	it('stays with its whole text and the reason, and waits for a decision', async () => {
		const h = await refused();
		expect(only(h)).toMatchObject({
			kind: 'comment.create',
			state: 'refused',
			payload: { body: TEXT },
			outcome: { code: COMMENT_REFUSED_CODE, message: OFFLINE_TEXTS.commentRefused }
		});
		expect(h.outbox.keptComments(A).map((comment) => comment.body)).toEqual([TEXT]);
		expect(h.outbox.markOf(FIRST_ID)).toBe('decision');
		expect(h.outbox.canSaveAsItem(only(h))).toBe(true);
	});

	it('saves its whole text as an entry of the inbox with a connection, then the comment goes', async () => {
		const h = await refused();
		await h.outbox.saveAsItem(FIRST_OP);
		await settle();
		const entries = [...h.server.records.values()].filter(
			(record) => record.collection === 'inbox_items'
		);
		expect(entries).toEqual([
			expect.objectContaining({
				title:
					'Kommentar zu HAUS-01: Bitte bis Freitag den Termin bestätigen. Danach Anna Bescheid geben.',
				body: TEXT
			})
		]);
		expect(h.outbox.count).toBe(0);
		expect(h.flags.show).toHaveBeenCalledWith({
			tone: 'success',
			title: 'Kommentar als Eingangseintrag gesichert.'
		});
	});

	it('keeps the entry for later without a connection, in format 2, and puts it in once it is back', async () => {
		const h = await refused();
		await goOffline(h);
		await h.outbox.saveAsItem(FIRST_OP);
		const [entry] = h.outbox.actions;
		expect(entry && isInboxCreate(entry) && entry.payload.body).toBe(TEXT);
		expect(entry?.v).toBe(2);
		expect(h.flags.show).toHaveBeenCalledWith({
			tone: 'success',
			title:
				'Kommentar als Eingangseintrag gemerkt. Er kommt in den Eingang, sobald die Verbindung zurück ist.'
		});
		await goOnline(h);
		const entries = [...h.server.records.values()].filter(
			(record) => record.collection === 'inbox_items'
		);
		expect(entries.map((record) => record.body)).toEqual([TEXT]);
		expect(h.outbox.count).toBe(0);
	});

	it('stays when the entry cannot be made, and an error flag says so', async () => {
		const h = await refused();
		h.server.refuseItem = true;
		await h.outbox.saveAsItem(FIRST_OP);
		expect(only(h)).toMatchObject({ kind: 'comment.create', state: 'refused' });
		expect(h.flags.show).toHaveBeenCalledWith(
			expect.objectContaining({ tone: 'error', title: OFFLINE_TEXTS.saveAsItemFailed })
		);
	});
});

describe('"Verwerfen" of a comment (OF-4b, C3 and C4)', () => {
	it('deletes one that never left the device: it never reaches the server, "Rückgängig" brings it back', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createComment(ON_A, TEXT);
		await h.outbox.discard(FIRST_OP);
		expect(h.outbox.count).toBe(0);
		const flag = h.flags.show.mock.calls.at(-1)?.[0];
		expect(flag?.title).toBe('Kommentar „Bitte bis Freitag den Termin bestätigen…“ verworfen.');
		expect(flag?.description).toBeUndefined();
		await goOnline(h);
		expect(h.sendComment).not.toHaveBeenCalled();
		flag?.action?.run();
		await settle();
		expect(h.server.comments.size).toBe(1);
	});

	it('looks one that may have arrived up instead of sending it again, and names it once it is there', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createComment(ON_A, TEXT);
		const way = h.sendComment.getMockImplementation();
		if (way === undefined) throw new Error('No way.');
		h.sendComment.mockImplementationOnce(async (action, fields, signal) => {
			await way(action, fields, signal);
			throw new DataError('network');
		});
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(FIRST_OP);
		expect(h.flags.show.mock.calls.at(-1)?.[0].description).toBe(
			OFFLINE_TEXTS.createCheckHint('comment')
		);
		expect(h.outbox.keptComments(A)).toEqual([]);
		await goOnline(h);
		expect(h.getComment).toHaveBeenCalledWith(FIRST_ID, expect.anything());
		expect(h.sendComment).toHaveBeenCalledTimes(1);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices).toEqual([
			{
				id: `created-${FIRST_OP}`,
				text: 'Der verworfene Kommentar „Bitte bis Freitag den Termin bestätigen…“ ist schon angekommen (HAUS-01). Bitte im Ticket prüfen und bei Bedarf löschen.',
				link: { record: 'ticket', id: A }
			}
		]);
	});

	it('lets one that may have arrived go without a word when it is not there 5 minutes after its last request', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createComment(ON_A, TEXT);
		h.sendComment.mockRejectedValueOnce(new DataError('network'));
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(FIRST_OP);
		await goOnline(h);
		expect(h.outbox.count).toBe(1);
		await vi.advanceTimersByTimeAsync(GRACE);
		expect(h.getComment).toHaveBeenCalledTimes(2);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices).toEqual([]);
		expect(h.sendComment).toHaveBeenCalledTimes(1);
		expect(h.server.comments.size).toBe(0);
	});

	it('does not hold a later comment back once an earlier one that never left the device is discarded', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createComment(ON_A, 'Erster');
		await h.outbox.createComment(ON_A, 'Zweiter');
		await h.outbox.discard(FIRST_OP);
		await goOnline(h);
		expect([...h.server.comments.values()].map((comment) => comment.body)).toEqual(['Zweiter']);
		expect(h.outbox.count).toBe(0);
	});
});

describe('"Verwerfen" of a ticket "＋" created with comments (OF-4b)', () => {
	async function withComment(): Promise<{ h: Harness; ticket: string; creation: string }> {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createTicket(draft());
		await h.outbox.createComment(created.value, TEXT);
		const creation = h.outbox.actions[0]?.op ?? '';
		return { h, ticket: created.value.id, creation };
	}

	it('sets its comments aside with their text instead of deleting them, and the flag says so', async () => {
		const { h, ticket, creation } = await withComment();
		await h.outbox.discard(creation);
		expect(only(h)).toMatchObject({
			kind: 'comment.create',
			state: 'refused',
			payload: { body: TEXT },
			outcome: {
				code: SET_ASIDE_CODE,
				message:
					'Das neue Ticket „Zahnarzt anrufen“ wurde verworfen; der Kommentar wird deshalb nicht übertragen.'
			}
		});
		const flag = h.flags.show.mock.calls.at(-1)?.[0];
		expect(flag?.title).toBe('Neues Ticket „Zahnarzt anrufen“ verworfen.');
		expect(flag?.description).toBe(
			'1 Kommentar dazu wird nicht übertragen; der Text steht unter „Gemerkte Änderungen“ mit „Als Eingangseintrag sichern“.'
		);
		await goOnline(h);
		expect(h.sendCreate).not.toHaveBeenCalled();
		expect(h.sendComment).not.toHaveBeenCalled();
		expect(h.outbox.canSaveAsItem(only(h))).toBe(true);
		expect(h.outbox.createdTicket(ticket)).toBeNull();
	});

	it('brings the ticket and its comments back with "Rückgängig": both arrive in their order', async () => {
		const { h, ticket, creation } = await withComment();
		await h.outbox.discard(creation);
		h.flags.show.mock.calls.at(-1)?.[0].action?.run();
		await settle();
		expect(h.outbox.actions).toHaveLength(2);
		expect(comments(h)[0]).toMatchObject({ state: 'queued', dependsOn: [creation] });
		await goOnline(h);
		const [id] = [...h.server.comments.keys()];
		expect(h.server.writes).toEqual([`ticket:${ticket}`, `comment:${id}`]);
		expect(h.outbox.count).toBe(0);
	});

	it('sets them aside also when the creation may have arrived; they are never sent', async () => {
		const { h, ticket, creation } = await withComment();
		const way = h.sendCreate.getMockImplementation();
		if (way === undefined) throw new Error('No way.');
		h.sendCreate.mockImplementationOnce(async (action, fields, signal) => {
			await way(action, fields, signal);
			throw new DataError('network');
		});
		await goOnline(h);
		await goOffline(h);
		await h.outbox.discard(creation);
		expect(comments(h)[0]).toMatchObject({ state: 'refused', outcome: { code: SET_ASIDE_CODE } });
		await goOnline(h);
		// The lookup finds the ticket: a notice names it, the comment stays set aside with its text.
		expect(h.outbox.notices.map((notice) => notice.link)).toEqual([
			{ record: 'ticket', id: ticket }
		]);
		expect(only(h)).toMatchObject({ kind: 'comment.create', payload: { body: TEXT } });
		expect(h.sendComment).not.toHaveBeenCalled();
	});
});

describe('the deletion after 7 days with comments (OF-4b)', () => {
	it('names a comment with its whole text in the notice that stays', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createComment(ON_A, TEXT);
		vi.setSystemTime(NOW + KEEP_MS + MINUTE);
		await goOnline(h);
		expect(h.outbox.count).toBe(0);
		expect(h.sendComment).not.toHaveBeenCalled();
		expect(h.outbox.notices.map((notice) => notice.text)).toEqual([
			`1 gemerkte Änderung war älter als 7 Tage und wurde gelöscht, ohne sicher übertragen zu sein: der Kommentar zu HAUS-01. Text des Kommentars zu HAUS-01: „${TEXT}“ Bitte im Ticket prüfen.`
		]);
	});

	it('names the comments that went with the creation of their ticket, with their text', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createTicket(draft());
		vi.setSystemTime(NOW + KEEP_MS - MINUTE);
		await h.outbox.createComment(created.value, 'Erster');
		vi.setSystemTime(NOW + KEEP_MS + MINUTE);
		await goOnline(h);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices.map((notice) => notice.text)).toEqual([
			'2 gemerkte Änderungen waren älter als 7 Tage und wurden gelöscht, ohne sicher übertragen zu sein: das neue Ticket „Zahnarzt anrufen“, der Kommentar zu dem neuen Ticket „Zahnarzt anrufen“. Text des Kommentars zu dem neuen Ticket „Zahnarzt anrufen“: „Erster“ Bitte in den Tickets prüfen.'
		]);
	});
});
