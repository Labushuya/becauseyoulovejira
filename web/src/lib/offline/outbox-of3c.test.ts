// The corrections of OF-3c (ADR-0074 addendum OF-3c) on the scaffold of $lib/test/outbox-fake.ts, each
// red against the state of OF-3b (8a32685) unless noted in the log:
// - R3-1: the notices of the outbox stay on the device until the user closes them: after a new start,
//   in every tab, only for the signed-in account, closed in every tab, deleted with "Abmelden und
//   verwerfen";
// - R3-2: only an app without the way of a kind keeps an error without a status as it was; every other
//   error without an answer of the server counts as "may have arrived";
// - R3-5: the words of a notice without a key;
// - R3-6: the deletion after 7 days names no discarded change whose younger take-back stays and is sent.
// Round 2 (after the review of a5b222a), each red against a5b222a unless noted in the log:
// - C-1: a take-back is no decision of the user about a sub-task, unless it sets it done;
// - C-2: the tab that sends never shows the notice for a moment once the change that decides arrived;
// - C-4: one notice per sub-task (its ID), also without a key;
// - C-5: a later completion that takes the sub-task along decides only once it is read done, also at
//   the first attempt;
// - C-6: a notice the storage failed to keep goes as well once the change that decides arrived.
// Round 3 (after the review of 6fc51a5), cover code that was right already, so green against 6fc51a5:
// - C2-2: a later completion that completes the sub-task takes the notice along at its first attempt;
// - C2-3: where reading the sub-task again fails or times out, the notice stands again.
// NA-1 (after the review of round 2 of "Einschalten"), red against 0044e13:
// - F-4: "Abmelden und verwerfen" deletes only the notices of the account it started for.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import {
	KEEP_MS,
	LEASE_MS,
	SEND_TIMEOUT_MS,
	type DueAction,
	type KeptAction
} from '$lib/domain/offline';
import type { Status } from '$lib/domain/status';
import type { Ticket } from '$lib/domain/ticket';
import {
	A,
	ALL_OPS,
	FailingStorage,
	HeldListStorage,
	NOW,
	OTHER,
	SAVED_AT,
	STORAGE_FAILED,
	STORED_OP,
	USER,
	channelPair,
	fakeServer,
	goOffline,
	goOnline,
	harness,
	settle,
	stored,
	ticket,
	type Harness
} from '$lib/test/outbox-fake';
import { MemoryOutboxStorage } from './outbox-storage';

const BACK = 'zzzzzzzzzzzzzzzzzzz3';
const C = 'tick00000000003';
/** The notice of one change of HAUS-01 the deletion after 7 days took. */
const DROPPED_ONE =
	'1 gemerkte Änderung war älter als 7 Tage und wurde gelöscht, ohne sicher übertragen zu sein: HAUS-01. Bitte im Ticket prüfen.';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

async function ready(storage?: MemoryOutboxStorage): Promise<Harness> {
	const h = harness({ support: ALL_OPS, ...(storage !== undefined && { storage }) });
	await settle();
	return h;
}

/**
 * The outbox starts on `storage` while another tab holds the lease: it reads the device at the start,
 * but sends nothing until the lease ran out (`LEASE_MS`).
 */
async function startHeld(storage: MemoryOutboxStorage): Promise<Harness> {
	await storage.lease('tab-other', Date.now(), LEASE_MS);
	return ready(storage);
}

/** The texts of the notices that stay until they are closed. */
function noticesOf(h: Harness): string[] {
	return h.outbox.notices.map((notice) => notice.text);
}

function find(h: Harness, op: string): KeptAction | undefined {
	return h.outbox.actions.find((action) => action.op === op);
}

/** A change kept without a connection that the deletion after 7 days takes while the tab runs. */
async function dropOne(h: Harness): Promise<void> {
	await goOffline(h);
	await h.outbox.changeStatus(ticket(A), { status: 'in_progress' });
	vi.setSystemTime(NOW + KEEP_MS);
	await goOnline(h);
	expect(h.outbox.count).toBe(0);
}

describe('notices that stay on the device until they are closed (R3-1)', () => {
	it('shows the notice of the deletion after 7 days again after a new start, until it is closed', async () => {
		const h = await ready();
		await dropOne(h);
		expect(noticesOf(h)).toEqual([DROPPED_ONE]);
		h.stop();
		// A new start of the app (reload): the deletion happened once, the notice stays.
		const again = await ready(h.storage);
		expect(noticesOf(again)).toEqual([DROPPED_ONE]);
		await again.outbox.closeNotice(again.outbox.notices[0]?.id ?? '');
		expect(noticesOf(again)).toEqual([]);
		again.stop();
		const third = await ready(h.storage);
		expect(noticesOf(third)).toEqual([]);
	});

	it('shows the notice in a tab that did not delete, and "Schließen" in one tab closes it in both', async () => {
		const storage = new MemoryOutboxStorage();
		const shared = fakeServer();
		const [one, two] = channelPair();
		const a = harness({ storage, shared, channel: one, support: ALL_OPS });
		await settle();
		const b = harness({ storage, shared, channel: two, support: ALL_OPS, tab: 'tab-b' });
		await settle();
		await goOffline(a);
		await goOffline(b);
		await a.outbox.changeStatus(ticket(A), { status: 'in_progress' });
		await settle();
		expect(b.outbox.count).toBe(1);
		vi.setSystemTime(NOW + KEEP_MS);
		// Only the first tab has the connection back: it deletes, the second one only reads.
		await goOnline(a);
		expect(a.outbox.count).toBe(0);
		expect(b.outbox.count).toBe(0);
		expect(noticesOf(a)).toEqual([DROPPED_ONE]);
		expect(noticesOf(b)).toEqual([DROPPED_ONE]);
		await b.outbox.closeNotice(b.outbox.notices[0]?.id ?? '');
		await settle();
		expect(noticesOf(b)).toEqual([]);
		expect(noticesOf(a)).toEqual([]);
	});

	it('shows the notice of a sub-task that is not done again after a new start', async () => {
		const h = await ready();
		h.server.blocking.set(A, [C]);
		h.outbox.apply(ticket(C));
		await goOffline(h);
		await h.outbox.changeStatus(ticket(A), {
			status: 'done',
			completion: 'complete_children',
			children: [C]
		});
		// Someone else completes the ticket meanwhile: no step to "done" is left for the sub-task.
		h.server.status.set(A, 'done');
		await goOnline(h);
		const text =
			'Unteraufgabe HAUS-03 ist nicht erledigt, obwohl sie mit HAUS-01 erledigt werden sollte. Bitte im Ticket prüfen.';
		expect(noticesOf(h)).toEqual([text]);
		h.stop();
		const again = await ready(h.storage);
		expect(noticesOf(again)).toEqual([text]);
	});

	it('shows only the notices of the signed-in account and keeps them for its next sign-in', async () => {
		const h = await ready();
		await dropOne(h);
		h.outbox.attach(OTHER);
		await settle();
		expect(noticesOf(h)).toEqual([]);
		h.outbox.attach(USER);
		await settle();
		expect(noticesOf(h)).toEqual([DROPPED_ONE]);
	});

	it('deletes the notices of the account on "Abmelden und verwerfen", not those of another account', async () => {
		const h = await ready();
		await dropOne(h);
		const foreign = {
			v: 1,
			id: 'child-other',
			kind: 'childNotDone',
			at: NOW,
			key: 'HAUS-07',
			parent: 'HAUS-06',
			child: 'tick00000000007',
			after: 1
		};
		await h.storage.notices(OTHER, () => [foreign]);
		await h.outbox.clearUser();
		expect(noticesOf(h)).toEqual([]);
		h.stop();
		const again = await ready(h.storage);
		expect(noticesOf(again)).toEqual([]);
		expect(await h.storage.notices(OTHER)).toEqual([foreign]);
	});

	// NA-1 (F-4 of the review of round 2 of "Einschalten"): "Abmelden und verwerfen" holds the account it
	// started for. Another account that signs in meanwhile (another tab) keeps its notices, on the
	// device and on the screen; those of the account that signed out go.
	it('deletes only the notices of the account that signed out, also when another one signed in meanwhile (NA-1, F-4)', async () => {
		const storage = new HeldListStorage();
		const h = await ready(storage);
		await dropOne(h);
		const foreign = {
			v: 1,
			id: 'child-other',
			kind: 'childNotDone',
			at: NOW,
			key: 'HAUS-07',
			parent: 'HAUS-06',
			child: 'tick00000000007',
			after: 1
		};
		await storage.notices(OTHER, () => [foreign]);
		storage.holding = true;
		const clear = h.outbox.clearUser();
		await settle();
		expect(storage.held).toBe(1);
		storage.holding = false;
		h.outbox.attach(OTHER);
		await settle();
		expect(noticesOf(h)).toHaveLength(1);
		expect(noticesOf(h)[0]).toMatch(/HAUS-07/);

		storage.answer();
		await clear;
		await settle();
		expect(noticesOf(h)).toHaveLength(1);
		expect(noticesOf(h)[0]).toMatch(/HAUS-07/);
		expect(await storage.notices(OTHER)).toEqual([foreign]);
		expect(await storage.notices(USER)).toBeUndefined();
	});

	it('closes a notice only as it was shown: one that changed meanwhile stays with what is new (I5)', async () => {
		const h = await ready();
		await dropOne(h);
		const [shown] = h.outbox.notices;
		// Meanwhile the deletion of another tab names one more change in the same notice.
		await h.storage.notices(USER, (current) =>
			(current as Record<string, unknown>[]).map((notice) => ({
				...notice,
				entries: [...(notice.entries as unknown[]), { op: 'zzzzzzzzzzzzzzzzzzz9', key: 'HAUS-02' }]
			}))
		);
		await h.outbox.closeNotice(shown?.id ?? '');
		expect(noticesOf(h)).toEqual([
			'2 gemerkte Änderungen waren älter als 7 Tage und wurden gelöscht, ohne sicher übertragen zu sein: HAUS-01, HAUS-02. Bitte in den Tickets prüfen.'
		]);
	});
});

describe('the notice about a sub-task that is not done (R3-4, found by the stricter oracle)', () => {
	async function completeThenChangeChild(h: Harness, childFirst: boolean): Promise<void> {
		h.server.blocking.set(A, [C]);
		h.server.status.set(C, 'open');
		h.outbox.apply(ticket(C));
		await goOffline(h);
		const child = () => h.outbox.changeStatus(h.outbox.apply(ticket(C)), { status: 'in_progress' });
		if (childFirst) await child();
		await h.outbox.changeStatus(h.outbox.apply(ticket(A)), {
			status: 'done',
			completion: 'complete_children',
			children: [C]
		});
		if (!childFirst) await child();
		// Someone else completes the ticket meanwhile: no step to "done" is left for the sub-task.
		h.server.status.set(A, 'done');
		await goOnline(h);
	}

	const NOT_DONE =
		'Unteraufgabe HAUS-03 ist nicht erledigt, obwohl sie mit HAUS-01 erledigt werden sollte. Bitte im Ticket prüfen.';

	it('shows no notice while a later change of the user sets the status of the sub-task: that change decides', async () => {
		const h = await ready();
		await completeThenChangeChild(h, false);
		// The later change was based on the completion taking the sub-task along: it shows as a conflict.
		expect(h.outbox.conflicts.map((action) => action.target)).toEqual([C]);
		expect(h.server.status.get(C)).toBe('open');
		expect(noticesOf(h)).toEqual([]);
	});

	it('shows the notice once that later change goes without effect: the user wants the sub-task done again', async () => {
		const h = await ready();
		await completeThenChangeChild(h, false);
		await h.outbox.discard(h.outbox.conflicts[0]?.op ?? '');
		expect(h.outbox.count).toBe(0);
		expect(h.server.status.get(C)).toBe('open');
		expect(noticesOf(h)).toEqual([NOT_DONE]);
	});

	it('takes the notice along once that later change arrives', async () => {
		const h = await ready();
		await completeThenChangeChild(h, false);
		await h.outbox.takeMine(h.outbox.conflicts[0]?.op ?? '');
		await settle();
		expect(h.outbox.count).toBe(0);
		expect(h.server.status.get(C)).toBe('in_progress');
		expect(noticesOf(h)).toEqual([]);
		h.stop();
		const again = await ready(h.storage);
		expect(noticesOf(again)).toEqual([]);
	});

	it('still names it where the change of the sub-task came before the completion', async () => {
		const h = await ready();
		await completeThenChangeChild(h, true);
		expect(h.outbox.count).toBe(0);
		expect(h.server.status.get(C)).toBe('in_progress');
		expect(noticesOf(h)).toEqual([NOT_DONE]);
	});
});

describe('an error without an answer of the server (R3-2)', () => {
	it('keeps "may have arrived" after an exception in the client once the server took the change', async () => {
		const h = await ready();
		await goOffline(h);
		await h.outbox.changeStatus(ticket(A), { status: 'done' });
		const op = h.outbox.actions[0]?.op ?? '';
		// The server takes the change and answers 200; reading the answer fails in the client.
		const base = h.send.getMockImplementation();
		let failed = false;
		h.send.mockImplementation(async (action, fields, signal) => {
			if (base === undefined) throw new Error('no fake server');
			const answer = await base(action, fields, signal);
			if (!failed && fields.opId === op) {
				failed = true;
				throw new TypeError('Die Antwort ließ sich nicht lesen.');
			}
			return answer;
		});
		await goOnline(h);
		expect(h.server.status.get(A)).toBe('done');
		expect(find(h, op)).toMatchObject({ attempts: 1, unanswered: true });
		await goOffline(h);
		await h.outbox.discard(op);
		expect(h.outbox.actions.some((action) => action.undoes === op)).toBe(true);
		await goOnline(h);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(h.server.status.get(A)).toBe('open');
		expect(h.outbox.count).toBe(0);
	});

	it('keeps a change the app has no way for as it was, so "Verwerfen" deletes it', async () => {
		const storage = new MemoryOutboxStorage();
		const due: DueAction = {
			v: 1,
			op: STORED_OP,
			seq: 1,
			user: USER,
			scope: `u:${USER}`,
			kind: 'ticket.update',
			target: A,
			dependsOn: [],
			payload: { due: '2026-10-22' },
			expected: { due: null },
			key: 'HAUS-01',
			title: 'Ticket 01',
			createdAt: NOW - 60_000,
			state: 'queued',
			attempts: 0,
			nextAttemptAt: 0
		};
		await storage.put(due);
		const h = harness({ storage, support: ALL_OPS, withoutDue: true });
		await settle();
		expect(find(h, STORED_OP)).toMatchObject({ state: 'queued', attempts: 1 });
		expect(find(h, STORED_OP)?.unanswered).toBeUndefined();
		await h.outbox.discard(STORED_OP);
		expect(h.outbox.count).toBe(0);
		expect(h.outbox.actions.some((action) => action.undoes === STORED_OP)).toBe(false);
	});
});

describe('the words of a notice without a key (R3-5)', () => {
	it('names a sub-task and a ticket without a key in words', async () => {
		const h = await ready();
		h.server.blocking.set(A, [C]);
		const keyless = (id: string): Ticket => ({
			...ticket(id, h.server.status.get(id) ?? 'open', SAVED_AT),
			key: ''
		});
		h.get.mockImplementation(async (id) => keyless(id));
		h.outbox.apply(keyless(C));
		await goOffline(h);
		await h.outbox.changeStatus(keyless(A), {
			status: 'done',
			completion: 'complete_children',
			children: [C]
		});
		h.server.status.set(A, 'done');
		await goOnline(h);
		expect(noticesOf(h)).toEqual([
			'Eine Unteraufgabe ist nicht erledigt, obwohl sie mit einem Ticket erledigt werden sollte. Bitte im Ticket prüfen.'
		]);
	});

	it('says "Das Verwerfen einer Änderung an …" for a take-back whose change is gone', async () => {
		const storage = new MemoryOutboxStorage();
		const old = NOW - KEEP_MS - 60_000;
		const back = { undoes: 'zzzzzzzzzzzzzzzzzzz8', payload: { status: 'open' as const } };
		await storage.put(stored({ ...back, expected: { status: 'done' }, createdAt: old }));
		await storage.put(
			stored({
				...back,
				op: BACK,
				seq: 2,
				target: 'tick00000000002',
				key: '',
				expected: { status: 'done' },
				createdAt: old
			})
		);
		const h = await startHeld(storage);
		expect(h.outbox.count).toBe(0);
		expect(noticesOf(h)).toEqual([
			'2 gemerkte Änderungen waren älter als 7 Tage und wurden gelöscht, ohne sicher übertragen zu sein: HAUS-01, ein Ticket. Das Verwerfen einer Änderung an HAUS-01 wurde nicht ausgeführt; der Server hat vielleicht noch den verworfenen Wert. Das Verwerfen einer Änderung an einem Ticket wurde nicht ausgeführt; der Server hat vielleicht noch den verworfenen Wert. Bitte in den Tickets prüfen.'
		]);
	});
});

describe('the deletion after 7 days of a discarded change (R3-6)', () => {
	it('names no discarded change whose younger take-back stays and is sent', async () => {
		const storage = new MemoryOutboxStorage();
		await storage.put(
			stored({ discarded: true, sent: true, unanswered: true, createdAt: NOW - KEEP_MS - 60_000 })
		);
		await storage.put(
			stored({
				op: BACK,
				seq: 2,
				dependsOn: [STORED_OP],
				undoes: STORED_OP,
				payload: { status: 'open' },
				expected: { status: 'done' },
				createdAt: NOW - 60_000
			})
		);
		const h = await startHeld(storage);
		expect(h.outbox.actions.map((action) => action.op)).toEqual([BACK]);
		expect(noticesOf(h)).toEqual([]);
		h.server.status.set(A, 'done');
		await vi.advanceTimersByTimeAsync(LEASE_MS);
		expect(h.server.sent).toEqual([BACK]);
		expect(h.server.status.get(A)).toBe('open');
		expect(h.outbox.count).toBe(0);
	});

	it('still names a discarded change that goes together with its take-back', async () => {
		const storage = new MemoryOutboxStorage();
		const old = NOW - KEEP_MS - 60_000;
		await storage.put(stored({ discarded: true, sent: true, unanswered: true, createdAt: old }));
		await storage.put(
			stored({
				op: BACK,
				seq: 2,
				dependsOn: [STORED_OP],
				undoes: STORED_OP,
				payload: { status: 'open' },
				expected: { status: 'done' },
				createdAt: old
			})
		);
		const h = await startHeld(storage);
		expect(h.outbox.count).toBe(0);
		expect(noticesOf(h)).toEqual([
			'2 gemerkte Änderungen waren älter als 7 Tage und wurden gelöscht, ohne sicher übertragen zu sein: HAUS-01. Das Verwerfen von „HAUS-01 erledigt“ wurde nicht ausgeführt; der Server hat vielleicht noch den verworfenen Wert. Bitte im Ticket prüfen.'
		]);
	});
});

describe('the notice about a sub-task after the review (round 2)', () => {
	const NOT_DONE =
		'Unteraufgabe HAUS-03 ist nicht erledigt, obwohl sie mit HAUS-01 erledigt werden sollte. Bitte im Ticket prüfen.';

	/**
	 * A kept completion of A with its sub-task C arrives after someone else completed A: no step to
	 * "done" is left, the notice about C stands.
	 */
	async function noticeStands(h: Harness): Promise<void> {
		h.server.blocking.set(A, [C]);
		h.server.status.set(C, 'open');
		h.outbox.apply(ticket(C));
		await goOffline(h);
		await h.outbox.changeStatus(h.outbox.apply(ticket(A)), {
			status: 'done',
			completion: 'complete_children',
			children: [C]
		});
		h.server.status.set(A, 'done');
		await goOnline(h);
		expect(h.outbox.count).toBe(0);
		expect(noticesOf(h)).toEqual([NOT_DONE]);
	}

	/**
	 * The user sets C in progress; in a short return of the connection its request arrives without an
	 * answer (`reached`) or does not reach the server. Resolves to its identifier.
	 */
	async function unansweredChange(h: Harness, reached: boolean): Promise<string> {
		await goOffline(h);
		await h.outbox.changeStatus(h.outbox.apply(ticket(C)), { status: 'in_progress' });
		const op = h.outbox.actions[0]?.op ?? '';
		expect(noticesOf(h)).toEqual([]);
		if (reached) h.server.lose = 1;
		else h.server.reachable = false;
		h.server.health = true;
		await h.connectivity.check();
		await settle();
		await goOffline(h);
		expect(find(h, op)).toMatchObject({ unanswered: true });
		expect(h.server.status.get(C)).toBe(reached ? 'in_progress' : 'open');
		return op;
	}

	/** The status of C on the server each time a take-back of `op` is sent. */
	function watchTakeBack(h: Harness, op: string): Status[] {
		const seen: Status[] = [];
		const base = h.send.getMockImplementation();
		h.send.mockImplementation(async (action, fields, signal) => {
			if (base === undefined) throw new Error('no fake server');
			if (action.undoes === op) seen.push(h.server.status.get(C) ?? 'open');
			return base(action, fields, signal);
		});
		return seen;
	}

	// The take-back arrives with effect; where the change did not reach the server, it goes first once
	// more with its identifier; where someone else set C back meanwhile, the take-back changes nothing.
	it.each([
		{ reached: true, reset: false, before: 'in_progress' },
		{ reached: false, reset: false, before: 'in_progress' },
		{ reached: true, reset: true, before: 'open' }
	])(
		'shows the notice again at once after "Verwerfen" of a later change of the sub-task without an answer, and keeps it when the take-back arrives (reached: $reached, reset: $reset) (C-1)',
		async ({ reached, reset, before }) => {
			const h = await ready();
			await noticeStands(h);
			const op = await unansweredChange(h, reached);
			if (reset) h.server.status.set(C, 'open');
			const seen = watchTakeBack(h, op);
			await h.outbox.discard(op);
			expect(h.outbox.actions.some((action) => action.undoes === op)).toBe(true);
			// The take-back carries out "Verwerfen": the user wants the sub-task done again.
			expect(noticesOf(h)).toEqual([NOT_DONE]);
			await goOnline(h);
			await vi.advanceTimersByTimeAsync(10_000);
			expect(h.outbox.count).toBe(0);
			expect(seen).toEqual([before]);
			expect(h.server.status.get(C)).toBe('open');
			expect(noticesOf(h)).toEqual([NOT_DONE]);
			h.stop();
			const again = await ready(h.storage);
			expect(noticesOf(again)).toEqual([NOT_DONE]);
		}
	);

	it('shows no notice for a moment in the tab that sends once a later change of the sub-task arrives (C-2)', async () => {
		const [one, two] = channelPair();
		const h = harness({ support: ALL_OPS, channel: one });
		await settle();
		await noticeStands(h);
		await goOffline(h);
		await h.outbox.changeStatus(h.outbox.apply(ticket(C)), { status: 'in_progress' });
		expect(noticesOf(h)).toEqual([]);
		// What this tab shows each time it tells the other tabs about a change of the device.
		const shown: string[][] = [];
		two.listen(() => shown.push(noticesOf(h)));
		await goOnline(h);
		expect(h.server.status.get(C)).toBe('in_progress');
		expect(h.outbox.count).toBe(0);
		expect(shown.length).toBeGreaterThan(0);
		expect(shown.filter((texts) => texts.length > 0)).toEqual([]);
		expect(noticesOf(h)).toEqual([]);
	});

	it('keeps one notice per sub-task without a key, and "Schließen" of one in a tab leaves the other (C-4)', async () => {
		const D = 'tick00000000004';
		const storage = new MemoryOutboxStorage();
		const shared = fakeServer();
		const [one, two] = channelPair();
		const a = harness({ storage, shared, channel: one, support: ALL_OPS });
		await settle();
		const b = harness({ storage, shared, channel: two, support: ALL_OPS, tab: 'tab-b' });
		await settle();
		a.server.blocking.set(A, [C, D]);
		const keyless = (id: string): Ticket => ({
			...ticket(id, a.server.status.get(id) ?? 'open', SAVED_AT),
			key: ''
		});
		a.get.mockImplementation(async (id) => keyless(id));
		a.outbox.apply(keyless(C));
		a.outbox.apply(keyless(D));
		await goOffline(a);
		await goOffline(b);
		await a.outbox.changeStatus(keyless(A), {
			status: 'done',
			completion: 'complete_children',
			children: [C, D]
		});
		a.server.status.set(A, 'done');
		await goOnline(a);
		const text =
			'Eine Unteraufgabe ist nicht erledigt, obwohl sie mit einem Ticket erledigt werden sollte. Bitte im Ticket prüfen.';
		expect(noticesOf(a)).toEqual([text, text]);
		expect(noticesOf(b)).toEqual([text, text]);
		await b.outbox.closeNotice(b.outbox.notices[0]?.id ?? '');
		await settle();
		expect(noticesOf(b)).toEqual([text]);
		expect(noticesOf(a)).toEqual([text]);
		expect(a.outbox.notices[0]?.id).toBe(b.outbox.notices[0]?.id);
	});

	it('keeps the notice when a later completion that takes the sub-task along arrives on a stale state at the first attempt (C-5)', async () => {
		const h = await ready();
		await noticeStands(h);
		// The view still shows A open; the server has it done: the completion makes no step to "done".
		const answer = await h.outbox.changeStatus(ticket(A), {
			status: 'done',
			completion: 'complete_children',
			children: [C]
		});
		expect(answer.status).toBe('done');
		await settle();
		expect(h.outbox.count).toBe(0);
		expect(h.server.status.get(C)).toBe('open');
		expect(noticesOf(h)).toEqual([NOT_DONE]);
		h.stop();
		const again = await ready(h.storage);
		expect(noticesOf(again)).toEqual([NOT_DONE]);
	});

	it('takes the notice along once a later kept completion completed the sub-task, read again, without showing it meanwhile (C-5, C-2)', async () => {
		const [one, two] = channelPair();
		const h = harness({ support: ALL_OPS, channel: one });
		await settle();
		await noticeStands(h);
		// Someone else sets A in progress again; the user completes it with C without a connection.
		h.server.status.set(A, 'in_progress');
		await goOffline(h);
		await h.outbox.changeStatus(ticket(A, 'in_progress'), {
			status: 'done',
			completion: 'complete_children',
			children: [C]
		});
		expect(noticesOf(h)).toEqual([]);
		const shown: string[][] = [];
		two.listen(() => shown.push(noticesOf(h)));
		await goOnline(h);
		expect(h.server.status.get(C)).toBe('done');
		expect(h.outbox.count).toBe(0);
		expect(shown.filter((texts) => texts.length > 0)).toEqual([]);
		expect(noticesOf(h)).toEqual([]);
		h.stop();
		const again = await ready(h.storage);
		expect(noticesOf(again)).toEqual([]);
	});

	it('takes a notice the storage failed to keep along as well once the change that decides arrives (C-6)', async () => {
		const storage = new FailingStorage();
		const h = harness({ storage, support: ALL_OPS });
		await settle();
		storage.noticesFailing = true;
		await noticeStands(h);
		expect(h.flags.show).toHaveBeenCalledWith(
			expect.objectContaining({ tone: 'error', title: STORAGE_FAILED })
		);
		expect(await storage.notices(USER)).toBeUndefined();
		await goOffline(h);
		await h.outbox.changeStatus(h.outbox.apply(ticket(C)), { status: 'in_progress' });
		expect(noticesOf(h)).toEqual([]);
		await goOnline(h);
		expect(h.server.status.get(C)).toBe('in_progress');
		expect(h.outbox.count).toBe(0);
		expect(noticesOf(h)).toEqual([]);
	});

	describe('after the review of round 2 (round 3)', () => {
		/** The completion of A with C as the view shows A after someone else set it in progress again. */
		function completeAgain(h: Harness): Promise<Ticket> {
			h.server.status.set(A, 'in_progress');
			return h.outbox.changeStatus(ticket(A, 'in_progress'), {
				status: 'done',
				completion: 'complete_children',
				children: [C]
			});
		}

		it('takes the notice along at the first attempt once the later completion completed the sub-task, read again (C2-2)', async () => {
			const h = await ready();
			await noticeStands(h);
			h.get.mockClear();
			const answer = await completeAgain(h);
			expect(answer.status).toBe('done');
			await settle();
			expect(h.server.status.get(C)).toBe('done');
			expect(h.get).toHaveBeenCalledWith(C, expect.anything());
			expect(h.outbox.count).toBe(0);
			expect(noticesOf(h)).toEqual([]);
			h.stop();
			const again = await ready(h.storage);
			expect(noticesOf(again)).toEqual([]);
		});

		it.each([
			{ way: 'kept', failure: 'fails' },
			{ way: 'kept', failure: 'times out' },
			{ way: 'first attempt', failure: 'fails' },
			{ way: 'first attempt', failure: 'times out' }
		] as const)(
			'shows the notice again once reading the sub-task again $failure after a later completion took it along ($way) (C2-3)',
			async ({ way, failure }) => {
				const h = await ready();
				await noticeStands(h);
				const base = h.get.getMockImplementation();
				h.get.mockImplementation(async (id, signal) => {
					if (base === undefined) throw new Error('no fake server');
					if (id !== C) return base(id, signal);
					if (failure === 'fails') throw new DataError('network');
					return new Promise<Ticket>(() => undefined);
				});
				if (way === 'kept') await goOffline(h);
				await completeAgain(h);
				if (way === 'kept') {
					expect(noticesOf(h)).toEqual([]);
					await goOnline(h);
				}
				await settle();
				expect(h.server.status.get(C)).toBe('done');
				expect(h.get).toHaveBeenCalledWith(C, expect.anything());
				expect(h.outbox.count).toBe(0);
				if (failure === 'times out') {
					// While the reading waits, the completion decides: the notice stays hidden.
					expect(noticesOf(h)).toEqual([]);
					await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
				}
				// Not read done: the notice stands again and stays on the device until it is closed.
				expect(noticesOf(h)).toEqual([NOT_DONE]);
				h.stop();
				const again = await ready(h.storage);
				expect(noticesOf(again)).toEqual([NOT_DONE]);
			}
		);
	});
});
