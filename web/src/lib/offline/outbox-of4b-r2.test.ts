// Round 2 of OF-4b (ADR-0074 addendum OF-4b, "Runde 2 (nach Durchsicht)") on the scaffold of the outbox
// ($lib/test/outbox-fake.ts): an entry of the inbox that keeps the text of a comment keeps it in the
// notice of the deletion after 7 days (K-1); "Als Eingangseintrag sichern" runs once per comment at a
// time (K-2); a comment that may have arrived is looked up instead of deleted once its text is saved,
// and a notice that stays names it where it is there (K-3); a refused earlier comment holds the later
// ones back until it is saved or discarded (K-9); the comments of a ticket "＋" created take the key the
// server gave it once it arrived (K-10).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import {
	AUTO_SEND_MS,
	KEEP_MS,
	OFFLINE_TEXTS,
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
	type Harness
} from '$lib/test/outbox-fake';

/** `letters()` draws one letter per call: the ID of a record first, then the identifier. */
const FIRST_ID = 'aaaaaaaaaaaaaaa';
const FIRST_OP = 'bbbbbbbbbbbbbbbbbbbb';
const MINUTE = 60_000;
const GRACE = 5 * MINUTE;
const TEXT = 'Bitte bis Freitag den Termin bestätigen.\n\nDanach Anna Bescheid geben.';
const EXCERPT = 'Bitte bis Freitag den Termin bestätigen…';
const ENTRY_TITLE =
	'Kommentar zu HAUS-01: Bitte bis Freitag den Termin bestätigen. Danach Anna Bescheid geben.';
const ON_A = { id: A, key: 'HAUS-01', title: 'Ticket 01', scope: `u:${USER}` };

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

async function ready(): Promise<Harness> {
	const h = harness({ support: ALL_OPS });
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

/** The entries of the inbox the server has. */
function entries(h: Harness) {
	return [...h.server.records.values()].filter((record) => record.collection === 'inbox_items');
}

/** The way the fake server writes a comment, to wrap it. */
function commentWay(h: Harness) {
	const way = h.sendComment.getMockImplementation();
	if (way === undefined) throw new Error('No way.');
	return way;
}

/** A comment the server refused: its ticket went into the trash meanwhile. */
async function refused(): Promise<Harness> {
	const h = await ready();
	await goOffline(h);
	await h.outbox.createComment(ON_A, TEXT);
	h.server.hidden.add(A);
	await goOnline(h);
	expect(only(h)).toMatchObject({ kind: 'comment.create', state: 'refused' });
	return h;
}

describe('an entry of the inbox with the text of a comment (K-1)', () => {
	it('keeps the whole text in the notice of the deletion after 7 days', async () => {
		const h = await refused();
		await goOffline(h);
		await h.outbox.saveAsItem(FIRST_OP);
		expect(only(h)).toMatchObject({ kind: 'inbox.create', payload: { body: TEXT } });
		vi.setSystemTime(NOW + KEEP_MS + MINUTE);
		await goOnline(h);
		expect(h.outbox.count).toBe(0);
		expect(entries(h)).toEqual([]);
		expect(h.outbox.notices.map((notice) => notice.text)).toEqual([
			expect.stringContaining(`Text des Eingangseintrags „${ENTRY_TITLE}“: „${TEXT}“`)
		]);
	});
});

describe('"Als Eingangseintrag sichern" once at a time (K-2)', () => {
	it('makes exactly one entry on a double tap with a connection', async () => {
		const h = await refused();
		const first = h.outbox.saveAsItem(FIRST_OP);
		// While it runs, the dialog offers it no more.
		expect(h.outbox.canSaveAsItem(only(h))).toBe(false);
		const second = h.outbox.saveAsItem(FIRST_OP);
		await Promise.all([first, second]);
		await settle();
		expect(h.sendItem).toHaveBeenCalledTimes(1);
		expect(entries(h).map((record) => record.body)).toEqual([TEXT]);
		expect(h.outbox.count).toBe(0);
	});

	it('keeps exactly one entry on a double tap without a connection', async () => {
		const h = await refused();
		await goOffline(h);
		await Promise.all([h.outbox.saveAsItem(FIRST_OP), h.outbox.saveAsItem(FIRST_OP)]);
		expect(h.outbox.actions.filter(isInboxCreate)).toHaveLength(1);
		expect(h.outbox.actions.filter(isCommentCreate)).toEqual([]);
		await goOnline(h);
		expect(entries(h).map((record) => record.body)).toEqual([TEXT]);
		expect(h.outbox.count).toBe(0);
	});

	it('offers it again once an attempt failed', async () => {
		const h = await refused();
		h.server.refuseItem = true;
		await h.outbox.saveAsItem(FIRST_OP);
		expect(h.outbox.canSaveAsItem(only(h))).toBe(true);
		h.server.refuseItem = false;
		await h.outbox.saveAsItem(FIRST_OP);
		await settle();
		expect(entries(h).map((record) => record.body)).toEqual([TEXT]);
		expect(h.outbox.count).toBe(0);
	});
});

// MO-7a (ADR-0074 addendum OF-4b, rest L-1 of the second reading): while "Als Eingangseintrag sichern"
// runs for a comment, "Trotzdem übertragen" and "Verwerfen" of the same comment do nothing; before,
// the comment went to the server as well (its text twice) or was discarded with "Rückgängig" while its
// entry came anyway.
describe('"Trotzdem übertragen" and "Verwerfen" wait while "Als Eingangseintrag sichern" runs (MO-7a, L-1)', () => {
	/** A comment older than 48 hours that never left the device. */
	async function expired(): Promise<Harness> {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createComment(ON_A, TEXT);
		vi.setSystemTime(NOW + AUTO_SEND_MS + MINUTE);
		await goOnline(h);
		expect(only(h)).toMatchObject({ kind: 'comment.create', state: 'expired' });
		return h;
	}

	it('does not send the comment on "Trotzdem übertragen" while its text is saved', async () => {
		const h = await expired();
		const saving = h.outbox.saveAsItem(FIRST_OP);
		expect(h.outbox.savingAsItem(FIRST_OP)).toBe(true);
		await h.outbox.sendAnyway(FIRST_OP);
		await saving;
		await settle();
		expect(entries(h).map((record) => record.body)).toEqual([TEXT]);
		expect(h.sendComment).not.toHaveBeenCalled();
		expect(h.server.comments.size).toBe(0);
		expect(h.outbox.count).toBe(0);
	});

	it('does not discard the comment while its text is saved', async () => {
		const h = await refused();
		const before = h.flags.show.mock.calls.length;
		const saving = h.outbox.saveAsItem(FIRST_OP);
		expect(h.outbox.savingAsItem(FIRST_OP)).toBe(true);
		await h.outbox.discard(FIRST_OP);
		await saving;
		await settle();
		expect(entries(h).map((record) => record.body)).toEqual([TEXT]);
		expect(h.outbox.count).toBe(0);
		// Only the flag of saving: no "verworfen" with "Rückgängig" that would bring the text back.
		expect(h.flags.show.mock.calls.slice(before).map(([flag]) => flag.title)).toEqual([
			OFFLINE_TEXTS.savedAsItem(false, false)
		]);
	});
});

describe('"Als Eingangseintrag sichern" of a comment that may have arrived (K-3)', () => {
	/**
	 * A comment whose request got no answer, 48 hours later: it waits for a decision and may be there
	 * (`reached`: the server wrote it before the answer got lost).
	 */
	async function expiredUnanswered(reached: boolean): Promise<Harness> {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createComment(ON_A, TEXT);
		const way = commentWay(h);
		h.sendComment.mockImplementationOnce(async (action, fields, signal) => {
			if (reached) await way(action, fields, signal);
			throw new DataError('network');
		});
		await goOnline(h);
		await goOffline(h);
		vi.setSystemTime(NOW + AUTO_SEND_MS + MINUTE);
		await goOnline(h);
		expect(only(h)).toMatchObject({ kind: 'comment.create', state: 'expired', unanswered: true });
		return h;
	}

	it('looks it up instead of deleting it: there, a notice that stays says that its text is in the inbox as well', async () => {
		const h = await expiredUnanswered(true);
		await h.outbox.saveAsItem(FIRST_OP);
		await settle();
		expect(entries(h).map((record) => record.body)).toEqual([TEXT]);
		expect(h.getComment).toHaveBeenCalledWith(FIRST_ID, expect.anything());
		expect(h.sendComment).toHaveBeenCalledTimes(1);
		expect(h.server.comments.size).toBe(1);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices).toEqual([
			{
				id: `created-${FIRST_OP}`,
				text: `Der als Eingangseintrag gesicherte Kommentar „${EXCERPT}“ ist schon angekommen (HAUS-01); sein Text liegt jetzt zusätzlich im Eingang. Bitte im Ticket prüfen und bei Bedarf löschen.`,
				link: { record: 'ticket', id: A }
			}
		]);
		expect(h.flags.show).toHaveBeenCalledWith({
			tone: 'success',
			title: OFFLINE_TEXTS.savedAsItem(false, false),
			description: OFFLINE_TEXTS.createCheckHint('comment')
		});
	});

	it('lets it go without a word where the lookup does not find it', async () => {
		const h = await expiredUnanswered(false);
		await h.outbox.saveAsItem(FIRST_OP);
		await settle();
		expect(h.getComment).toHaveBeenCalledTimes(1);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices).toEqual([]);
		expect(entries(h).map((record) => record.body)).toEqual([TEXT]);
		expect(h.server.comments.size).toBe(0);
	});

	it('waits for the lookup without a connection, shows the comment no more and offers nothing else', async () => {
		const h = await expiredUnanswered(true);
		await goOffline(h);
		await h.outbox.saveAsItem(FIRST_OP);
		const comment = h.outbox.actions.find(isCommentCreate);
		expect(comment).toMatchObject({ discarded: true, state: 'queued' });
		expect(h.outbox.keptComments(A)).toEqual([]);
		expect(h.outbox.canSaveAsItem(comment as KeptAction)).toBe(false);
		expect(h.flags.show.mock.calls.at(-1)?.[0]).toEqual({
			tone: 'success',
			title: OFFLINE_TEXTS.savedAsItem(true, true),
			description: OFFLINE_TEXTS.createCheckHint('comment')
		});
		await goOnline(h);
		expect(entries(h).map((record) => record.body)).toEqual([TEXT]);
		expect(h.outbox.notices.map((notice) => notice.link)).toEqual([{ record: 'ticket', id: A }]);
		expect(h.outbox.count).toBe(0);
	});

	it('looks a refused one whose earlier request may still arrive up again until 5 minutes passed', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createComment(ON_A, TEXT);
		// The first request gets no answer and never reached the server.
		h.sendComment.mockRejectedValueOnce(new DataError('network'));
		await goOnline(h);
		// The ticket goes into the trash; the repetition is refused by the rule of its ticket.
		h.server.hidden.add(A);
		await goOffline(h);
		await goOnline(h);
		expect(only(h)).toMatchObject({ state: 'refused', unansweredBefore: true });
		await h.outbox.saveAsItem(FIRST_OP);
		await settle();
		expect(h.getComment).toHaveBeenCalledTimes(1);
		expect(comments(h)).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(GRACE);
		expect(h.getComment).toHaveBeenCalledTimes(2);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.notices).toEqual([]);
		expect(entries(h).map((record) => record.body)).toEqual([TEXT]);
	});
});

describe('a refused earlier comment holds the later ones back (K-9)', () => {
	async function heldBack(): Promise<Harness> {
		const h = await ready();
		await goOffline(h);
		await h.outbox.createComment(ON_A, 'Erster');
		await h.outbox.createComment(ON_A, 'Zweiter');
		// The server refuses the first one by the rule of its ticket (400 without a field).
		h.sendComment.mockRejectedValueOnce(new DataError('server', { status: 400 }));
		await goOnline(h);
		const [first, second] = comments(h);
		expect(first).toMatchObject({ op: FIRST_OP, state: 'refused', payload: { body: 'Erster' } });
		expect(second).toMatchObject({ state: 'queued', dependsOn: [FIRST_OP] });
		expect(h.server.comments.size).toBe(0);
		return h;
	}

	it('lets them go once the earlier one is saved as an entry of the inbox', async () => {
		const h = await heldBack();
		await h.outbox.saveAsItem(FIRST_OP);
		await settle();
		expect([...h.server.comments.values()].map((comment) => comment.body)).toEqual(['Zweiter']);
		expect(entries(h).map((record) => record.body)).toEqual(['Erster']);
		expect(h.outbox.count).toBe(0);
	});

	it('lets them go once the earlier one is discarded', async () => {
		const h = await heldBack();
		await h.outbox.discard(FIRST_OP);
		await settle();
		expect([...h.server.comments.values()].map((comment) => comment.body)).toEqual(['Zweiter']);
		expect(entries(h)).toEqual([]);
		expect(h.outbox.count).toBe(0);
	});
});

describe('the comments of a ticket "＋" created take its key once it arrived (K-10)', () => {
	it('names the key in the dialog and in the title of the entry', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createTicket(draft());
		await h.outbox.createComment(created.value, TEXT);
		expect(comments(h)[0]?.key).toBe('');
		const way = commentWay(h);
		h.sendComment.mockImplementationOnce(async (action, fields, signal) => {
			// The new ticket went into the trash right after it arrived: the comment is refused.
			h.server.hidden.add(created.value.id);
			return way(action, fields, signal);
		});
		await goOnline(h);
		const [comment] = comments(h);
		expect(comment).toMatchObject({ state: 'refused', key: 'TASK-1' });
		expect(OFFLINE_TEXTS.commentOn(comment?.key ?? '', comment?.title ?? '')).toBe(
			'Kommentar zu TASK-1'
		);
		await h.outbox.saveAsItem(comment?.op ?? '');
		await settle();
		expect(entries(h).map((record) => record.title)).toEqual([
			'Kommentar zu TASK-1: Bitte bis Freitag den Termin bestätigen. Danach Anna Bescheid geben.'
		]);
	});

	it('names the key in the notice of the deletion after 7 days', async () => {
		const h = await ready();
		await goOffline(h);
		const created = await h.outbox.createTicket(draft());
		await h.outbox.createComment(created.value, TEXT);
		// The comment meets a 5xx after its ticket arrived and waits; the clock passes 7 days.
		h.sendComment.mockRejectedValueOnce(new DataError('server', { status: 503 }));
		await goOnline(h);
		expect(comments(h)[0]).toMatchObject({ state: 'queued', key: 'TASK-1' });
		await goOffline(h);
		vi.setSystemTime(NOW + KEEP_MS + MINUTE);
		await goOnline(h);
		expect(h.outbox.notices.map((notice) => notice.text)).toEqual([
			expect.stringContaining(`Text des Kommentars zu TASK-1: „${TEXT}“`)
		]);
	});
});
