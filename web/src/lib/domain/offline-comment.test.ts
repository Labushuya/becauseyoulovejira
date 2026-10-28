// The rules of comments in the outbox (OF-4b, ADR-0074 addendum OF-4b), pure: their form on the device
// (and format 2 of an entry of the inbox with a text), the plan behind the creation of their ticket and
// the comment before them, the fields of a request, the verdict of a refusal, their words, their place
// in the chains and in the deletion after 7 days, and the head of a comment from the outbox.

import { describe, expect, it } from 'vitest';
import { settleChains } from './offline-chain';
import {
	AUTO_SEND_MS,
	BROKEN_CODE,
	COMMENT_REFUSED_CODE,
	KEEP_MS,
	OFFLINE_TEXTS,
	actionName,
	actionText,
	agedActions,
	alongDropped,
	commentExcerpt,
	keptCommentOf,
	offlineCommentText,
	parseAction,
	planComment,
	planTicketStatus,
	requestFields,
	savedItemTitle,
	ticketOf,
	verdictOf,
	type CommentChange,
	type CommentCreateAction,
	type InboxCreateAction,
	type KeptAction,
	type OutboxAction,
	type PlanContext,
	type TicketCreateAction
} from './offline';
import { createdNotice, droppedEntries, noticeText, parseNotice } from './offline-notices';
import { COMMENT_MAX_LENGTH } from './ticket';

// 2026-10-20 14:30 in Berlin (CEST).
const NOW = Date.UTC(2026, 9, 20, 12, 30, 0);
const USER = 'user00000000001';
const TICKET = 'tick00000000001';
const NEW_TICKET = 'aaaaaaaaaaaaaaa';
const COMMENT = 'ccccccccccccccc';
const TEXT = 'Bitte bis Freitag den Termin bestätigen.\nDanach Anna Bescheid geben.';

function context(overrides: Partial<PlanContext> = {}): PlanContext {
	return { user: USER, op: 'op000000000000000002', seq: 2, now: NOW, offline: true, ...overrides };
}

function comment(overrides: Partial<CommentCreateAction> = {}): CommentCreateAction {
	return {
		v: 1,
		op: 'op000000000000000001',
		seq: 1,
		user: USER,
		scope: `u:${USER}`,
		kind: 'comment.create',
		target: COMMENT,
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

function creation(overrides: Partial<TicketCreateAction> = {}): TicketCreateAction {
	return {
		v: 1,
		op: 'op000000000000000000',
		seq: 0,
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
		expected: {},
		...overrides
	};
}

function change(overrides: Partial<CommentChange> = {}): CommentChange {
	return {
		target: 'ddddddddddddddd',
		ticket: TICKET,
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		scope: `u:${USER}`,
		body: 'Noch einer',
		...overrides
	};
}

describe('a comment on the device (OF-4b)', () => {
	it('is read back as it was kept', () => {
		const kept = comment({ dependsOn: ['op000000000000000000'], sent: true, unanswered: true });
		expect(parseAction(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
	});

	it.each([
		['an ID of another form', { target: 'tmp-1' }],
		['a ticket of another form', { ticket: '' }],
		['an empty text', { payload: { body: '  \n ' } }],
		['a text longer than a comment', { payload: { body: 'x'.repeat(COMMENT_MAX_LENGTH + 1) } }],
		['a take-back', { undoes: 'op000000000000000009' }],
		['format 2', { v: 2 as const }]
	])('is not readable with %s', (_, overrides) => {
		const parsed = parseAction({ ...comment(), ...overrides });
		expect(parsed?.outcome?.code).toBe(BROKEN_CODE);
	});

	it('keeps an entry of the inbox with a text only in format 2, which a build before OF-4b cannot read', () => {
		const entry: InboxCreateAction = {
			...creation(),
			v: 2,
			kind: 'inbox.create',
			payload: {
				title: 'Kommentar zu HAUS-12: …',
				household: '',
				preset: { project: null, tags: [], priority: null },
				body: TEXT
			}
		};
		expect(parseAction(JSON.parse(JSON.stringify(entry)))).toEqual(entry);
		expect(parseAction({ ...entry, v: 1 })?.outcome?.code).toBe(BROKEN_CODE);
		const plain = { ...entry, payload: { ...entry.payload, body: undefined } };
		expect(parseAction(JSON.parse(JSON.stringify(plain)))?.outcome?.code).toBe(BROKEN_CODE);
	});

	it('belongs to its ticket, and the view of the activity names the time of the device', () => {
		const kept = comment();
		expect(ticketOf(kept)).toBe(TICKET);
		expect(keptCommentOf(kept)).toEqual({
			id: COMMENT,
			ticket: TICKET,
			author: USER,
			body: TEXT,
			created: '2026-10-20 12:03:00.000Z',
			updated: '2026-10-20 12:03:00.000Z',
			offline: true,
			deviceAt: '2026-10-20 12:03:00.000Z'
		});
	});
});

describe('the plan of a comment (OF-4b, concept §3.3)', () => {
	it('goes at once with a connection on a ticket of the server, noting its first request', () => {
		const plan = planComment([], change(), context({ offline: false }));
		expect(plan).toMatchObject({
			kind: 'send',
			action: {
				kind: 'comment.create',
				target: 'ddddddddddddddd',
				ticket: TICKET,
				dependsOn: [],
				state: 'sending',
				sent: true,
				lastSentAt: NOW,
				payload: { body: 'Noch einer' }
			}
		});
	});

	it('is kept without a connection', () => {
		expect(planComment([], change(), context()).kind).toBe('queue');
	});

	it('waits for the creation of its ticket "＋" created and for the comment before it', () => {
		const made = creation();
		const first = comment({ ticket: NEW_TICKET, dependsOn: [made.op] });
		const plan = planComment(
			[made, first],
			change({ ticket: NEW_TICKET }),
			context({ offline: false })
		);
		expect(plan).toMatchObject({ kind: 'queue', action: { dependsOn: [made.op, first.op] } });
	});

	it('waits for no comment the user discarded or that is set aside, and none of another ticket', () => {
		const discarded = comment({ discarded: true, sent: true, unanswered: true });
		const other = comment({ op: 'op000000000000000003', seq: 3, ticket: 'tick00000000009' });
		const plan = planComment([discarded, other], change(), context({ offline: false }));
		expect(plan.kind).toBe('send');
	});

	it('leaves a change of the status free to go into the creation it waits for (no value of its own)', () => {
		const made = creation();
		const waiting = comment({ ticket: NEW_TICKET, dependsOn: [made.op] });
		const plan = planTicketStatus(
			[made, waiting],
			{
				target: NEW_TICKET,
				key: '',
				title: 'Zahnarzt anrufen',
				scope: `u:${USER}`,
				base: 'open',
				status: 'done'
			},
			context()
		);
		expect(plan).toMatchObject({
			kind: 'merge',
			action: { op: made.op, payload: { status: 'done' } }
		});
	});
});

describe('the requests and the answers of a comment (OF-4b)', () => {
	it('names only the identifier at the first attempt, then the time of the device, after 48 hours `offline`', () => {
		const kept = comment();
		expect(requestFields(kept, true)).toEqual({ opId: kept.op });
		expect(requestFields(kept, false)).toEqual({
			opId: kept.op,
			clientAt: new Date(kept.createdAt).toISOString()
		});
		expect(requestFields({ ...kept, late: true }, false)).toEqual({ opId: kept.op, offline: true });
	});

	it('takes a refusal without a field as the create rule of its ticket, and names a taken ID', () => {
		const rule = { kind: 'server' as const, status: 400, message: 'x', fields: {} };
		expect(verdictOf(rule, 'comment')).toEqual({
			result: 'refused',
			outcome: { code: COMMENT_REFUSED_CODE, message: OFFLINE_TEXTS.commentRefused }
		});
		// A ticket keeps the words of before.
		expect(verdictOf(rule, 'ticket')).toEqual({
			result: 'refused',
			outcome: { code: 'server', message: 'x' }
		});
		const taken = {
			kind: 'validation' as const,
			status: 400,
			message: 'x',
			fields: { id: { code: 'validation_not_unique', message: '' } }
		};
		expect(verdictOf(taken, 'comment')).toMatchObject({
			result: 'refused',
			outcome: { message: 'Die ID des Kommentars ist auf dem Server schon vergeben.' }
		});
		expect(verdictOf({ ...rule, status: 503 }, 'comment')).toEqual({ result: 'server' });
	});
});

describe('the words of a comment (OF-4b)', () => {
	it('names it by the beginning of its text on one line', () => {
		expect(commentExcerpt(TEXT)).toBe('Bitte bis Freitag den Termin bestätigen…');
		expect(commentExcerpt('Kurz\n und gut')).toBe('Kurz und gut');
		expect(actionText(comment())).toBe('Kommentar „Bitte bis Freitag den Termin bestätigen…“');
		expect(actionName(comment())).toBe('Kommentar „Bitte bis Freitag den Termin bestätigen…“');
	});

	it('titles an entry of the inbox with its ticket and its text, at most 200 characters', () => {
		expect(savedItemTitle(comment())).toBe(
			'Kommentar zu HAUS-12: Bitte bis Freitag den Termin bestätigen. Danach Anna Bescheid geben.'
		);
		expect(savedItemTitle(comment({ key: '', title: 'Zahnarzt anrufen' }))).toMatch(
			/^Kommentar zu dem neuen Ticket „Zahnarzt anrufen“: Bitte/
		);
		const long = savedItemTitle(comment({ payload: { body: 'x'.repeat(500) } }));
		expect(long).toHaveLength(200);
		expect(long.endsWith('…')).toBe(true);
	});

	it('says in its head when it was written offline and when it arrived (concept §2.3)', () => {
		const kept = keptCommentOf(comment());
		expect(offlineCommentText(kept, true, NOW)).toBe('Offline geschrieben um 14:03 (laut Gerät)');
		const arrived = { created: '2026-10-20 12:30:00.000Z', deviceAt: '2026-10-20 12:03:00.000Z' };
		expect(offlineCommentText(arrived, false, NOW)).toBe(
			'Offline geschrieben um 14:03 (laut Gerät) · übertragen 14:30'
		);
		const dayBefore = { ...arrived, deviceAt: '2026-10-19 18:03:00.000Z' };
		expect(offlineCommentText(dayBefore, false, NOW)).toBe(
			'Offline geschrieben am 19.10.2026 um 20:03 (laut Gerät) · übertragen 14:30'
		);
		expect(offlineCommentText({ ...arrived, deviceAt: null }, false, NOW)).toBe(
			'Offline geschrieben · übertragen 14:30'
		);
	});

	it('names the day of a transfer before today, as the time of a comment does (round 2, K-7)', () => {
		const yesterday = {
			created: '2026-10-19 18:30:00.000Z',
			deviceAt: '2026-10-19 18:03:00.000Z'
		};
		// Since MO-7a (L-3) the time of the device of a day before today names its date as well.
		expect(offlineCommentText(yesterday, false, NOW)).toBe(
			'Offline geschrieben am 19.10.2026 um 20:03 (laut Gerät) · übertragen 19.10.2026 20:30'
		);
	});

	// MO-7a (rest L-3 of the second reading of OF-4b): "um 20:03" without a date stood for a time of the
	// device of an earlier day once the transfer was not today either; the head names the date of the
	// time of the device whenever it is not today, or not the day of the transfer.
	it('names the date of the time of the device whenever it is not today (MO-7a, L-3)', () => {
		const days = [
			// Written and sent the day before.
			[
				{ created: '2026-10-19 18:30:00.000Z', deviceAt: '2026-10-19 18:03:00.000Z' },
				'Offline geschrieben am 19.10.2026 um 20:03 (laut Gerät) · übertragen 19.10.2026 20:30'
			],
			// Written two days ago, sent the day before.
			[
				{ created: '2026-10-19 06:30:00.000Z', deviceAt: '2026-10-18 21:50:00.000Z' },
				'Offline geschrieben am 18.10.2026 um 23:50 (laut Gerät) · übertragen 19.10.2026 08:30'
			],
			// Written the day before, sent today.
			[
				{ created: '2026-10-20 06:30:00.000Z', deviceAt: '2026-10-19 21:50:00.000Z' },
				'Offline geschrieben am 19.10.2026 um 23:50 (laut Gerät) · übertragen 08:30'
			],
			// Written and sent today: the time alone.
			[
				{ created: '2026-10-20 12:30:00.000Z', deviceAt: '2026-10-20 12:03:00.000Z' },
				'Offline geschrieben um 14:03 (laut Gerät) · übertragen 14:30'
			]
		] as const;
		for (const [comment, text] of days) {
			expect(offlineCommentText(comment, false, NOW), comment.created).toBe(text);
		}
		// Kept for later: the date when it was written before today.
		const kept = { created: '2026-10-19 18:03:00.000Z', deviceAt: '2026-10-19 18:03:00.000Z' };
		expect(offlineCommentText(kept, true, NOW)).toBe(
			'Offline geschrieben am 19.10.2026 um 20:03 (laut Gerät)'
		);
	});
});

describe('a comment in the chains and with the time (OF-4b)', () => {
	it('is a chain of its own: a take-back of its ticket does not wait for it', () => {
		const kept = comment();
		const done: OutboxAction = {
			v: 1,
			op: 'op000000000000000005',
			seq: 5,
			user: USER,
			scope: `u:${USER}`,
			kind: 'ticket.update',
			target: TICKET,
			dependsOn: [],
			payload: { status: 'done' },
			expected: { status: 'open' },
			key: 'HAUS-12',
			title: 'Müll rausbringen',
			createdAt: NOW,
			state: 'queued',
			attempts: 0,
			nextAttemptAt: 0,
			sent: true,
			unanswered: true,
			discarded: true
		};
		const fresh = () => ({ op: 'op000000000000000009', seq: 9, now: NOW });
		const settled = settleChains([kept, done], { fresh });
		const back = settled.find((action) => action.undoes === done.op);
		expect(back?.dependsOn).toEqual([done.op]);
		expect(settled.find((action) => action.op === kept.op)).toEqual(kept);
	});

	it('waits for a decision after 48 hours like every change, but not once discarded', () => {
		const old = comment({ createdAt: NOW - AUTO_SEND_MS - 1 });
		expect(agedActions([old], NOW)).toEqual({ expire: [old.op], drop: [] });
		const looked = comment({ createdAt: NOW - AUTO_SEND_MS - 1, discarded: true, sent: true });
		expect(agedActions([looked], NOW)).toEqual({ expire: [], drop: [] });
	});

	it('goes with the creation of its ticket after 7 days, and an earlier comment takes no later one along', () => {
		const made = creation({ createdAt: NOW - KEEP_MS - 1 });
		const first = comment({ ticket: NEW_TICKET, dependsOn: [made.op] });
		const second = comment({
			op: 'op000000000000000003',
			seq: 3,
			ticket: NEW_TICKET,
			dependsOn: [made.op, first.op]
		});
		expect([...alongDropped([made, first, second], [made.op]).keys()]).toEqual([
			first.op,
			second.op
		]);
		const lone = comment({ createdAt: NOW - KEEP_MS - 1 });
		const later = comment({ op: 'op000000000000000004', seq: 4, dependsOn: [lone.op] });
		expect(alongDropped([lone, later], [lone.op]).size).toBe(0);
		expect(agedActions([lone, later], NOW)).toEqual({ expire: [], drop: [lone.op] });
	});

	it('keeps its whole text in the notice of the deletion after 7 days (C2)', () => {
		const kept = comment({ createdAt: NOW - KEEP_MS - 1 });
		const entries = droppedEntries([kept], [kept.op], []);
		expect(entries).toEqual([
			{
				op: kept.op,
				key: 'HAUS-12',
				created: { record: 'comment', title: TEXT, ticket: 'HAUS-12' }
			}
		]);
		const notice = { v: 1 as const, id: 'dropped-1', kind: 'dropped' as const, at: NOW, entries };
		expect(noticeText(notice)).toBe(
			`1 gemerkte Änderung war älter als 7 Tage und wurde gelöscht, ohne sicher übertragen zu sein: der Kommentar zu HAUS-12. Text des Kommentars zu HAUS-12: „${TEXT}“ Bitte im Ticket prüfen.`
		);
		// A discarded one by the beginning of its text: the user did not want it.
		const discarded: KeptAction = { ...kept, discarded: true, sent: true };
		const gone = droppedEntries([discarded], [discarded.op], []);
		expect(noticeText({ ...notice, entries: gone })).toBe(
			'1 gemerkte Änderung war älter als 7 Tage und wurde gelöscht, ohne sicher übertragen zu sein: der Kommentar „Bitte bis Freitag den Termin bestätigen…“. Ob der Kommentar „Bitte bis Freitag den Termin bestätigen…“ trotz „Verwerfen“ schon angekommen ist, ließ sich nicht mehr nachsehen. Bitte im Ticket prüfen.'
		);
	});
});

describe('the text of a comment kept elsewhere (OF-4b round 2)', () => {
	const TITLE =
		'Kommentar zu HAUS-12: Bitte bis Freitag den Termin bestätigen. Danach Anna Bescheid geben.';
	const entry: InboxCreateAction = {
		v: 2,
		op: 'op000000000000000007',
		seq: 7,
		user: USER,
		scope: `u:${USER}`,
		kind: 'inbox.create',
		target: 'eeeeeeeeeeeeeee',
		dependsOn: [],
		key: '',
		title: TITLE,
		createdAt: NOW - KEEP_MS - 1,
		state: 'queued',
		attempts: 0,
		nextAttemptAt: 0,
		payload: {
			title: TITLE,
			household: '',
			preset: { project: null, tags: [], priority: null },
			body: TEXT
		},
		expected: {}
	};

	it('keeps the whole text of an entry of the inbox in the notice of the deletion after 7 days (K-1)', () => {
		const entries = droppedEntries([entry], [entry.op], []);
		expect(entries).toEqual([
			{ op: entry.op, key: '', created: { record: 'inbox', title: TITLE, body: TEXT } }
		]);
		const notice = { v: 1 as const, id: 'dropped-7', kind: 'dropped' as const, at: NOW, entries };
		// The device keeps it as it is, a build of this round reads it back.
		expect(parseNotice(JSON.parse(JSON.stringify(notice)))).toEqual(notice);
		expect(noticeText(notice)).toBe(
			`1 gemerkte Änderung war älter als 7 Tage und wurde gelöscht, ohne sicher übertragen zu sein: der neue Eingangseintrag „${TITLE}“. Text des Eingangseintrags „${TITLE}“: „${TEXT}“ Bitte im Ticket prüfen.`
		);
		// An entry discarded by the user keeps only its title.
		const discarded: KeptAction = { ...entry, discarded: true, sent: true };
		expect(droppedEntries([discarded], [discarded.op], [])[0]?.created).toEqual({
			record: 'inbox',
			title: TITLE,
			discarded: true
		});
	});

	it('marks a comment saved after it may have arrived, keeps the mark and names it once it is there (K-3)', () => {
		const saved = comment({
			state: 'queued',
			sent: true,
			unanswered: true,
			discarded: true,
			saved: true
		});
		expect(parseAction(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
		const notice = createdNotice(saved, 'HAUS-12', NOW);
		expect(notice).toMatchObject({ kind: 'created', record: 'comment', saved: true });
		expect(parseNotice(JSON.parse(JSON.stringify(notice)))).toEqual(notice);
		expect(noticeText(notice)).toBe(
			'Der als Eingangseintrag gesicherte Kommentar „Bitte bis Freitag den Termin bestätigen…“ ist schon angekommen (HAUS-12); sein Text liegt jetzt zusätzlich im Eingang. Bitte im Ticket prüfen und bei Bedarf löschen.'
		);
		// The deletion after 7 days says that it was not looked up, without "Verwerfen".
		const old = { ...saved, createdAt: NOW - KEEP_MS - 1 };
		const gone = droppedEntries([old], [old.op], []);
		const dropped = {
			v: 1 as const,
			id: 'dropped-8',
			kind: 'dropped' as const,
			at: NOW,
			entries: gone
		};
		expect(parseNotice(JSON.parse(JSON.stringify(dropped)))).toEqual(dropped);
		expect(noticeText(dropped)).toContain(
			'Ob der als Eingangseintrag gesicherte Kommentar „Bitte bis Freitag den Termin bestätigen…“ schon angekommen ist, ließ sich nicht mehr nachsehen.'
		);
	});
});
