// The scenario matrix of the outbox, class "Kommentare" (OF-4b, ADR-0074 addendum OF-4b; its own file
// since round 2, K-6): one to three comments on a ticket the server has or on a ticket "＋" created
// without a connection; the first request kept until the end, lost after the server wrote it, not
// reached, a 5xx, the time limit, or the first attempt with a connection (as is, lost, 5xx); "Verwerfen"
// of a comment or of the creation of its ticket before, while, after or late, with or without
// "Rückgängig"; the connection back with a success, the ticket in the trash, one 503 or the ticket
// hidden; then "Als Eingangseintrag sichern", "Verwerfen" or no decision for every comment that waits
// for one. Checked, by the oracle's own bookkeeping of what the user wrote and did and of every request:
// C1 at most one comment per text; C2 no text gets lost (on the server, kept, or as an entry of the
// inbox); C3 a discarded comment that is there anyway is named by a notice with a link to its ticket,
// and so is a saved one (round 2, K-3: its text is in the inbox as well), and no notice names one that
// is not there; C4 a discarded comment that never left the device never reaches the server, nothing
// discarded is sent again, no comment of a discarded ticket arrives; the order (the ticket before its
// comments, the comments as written); I1 what the user wants arrived or visibly waits for a decision;
// I4 after "Rückgängig" it arrives; no hang. Since round 2 (K-5) C3 leaves a comment out whose ticket
// went out of sight only where no lookup found it before: the oracle notes when the ticket went.
// The oracle is independent of the code it checks: it reads of the outbox only what the dialog, the
// activity and the notices show. Every run starts the real outbox, its worker and the storage of the
// tests against the fake server of $lib/test/outbox-fake.ts, which writes comments as the hooks and the
// rules of `comments` do; the shared helpers are in $lib/test/outbox-matrix.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { CommentCreateAction, InboxCreateAction, KeptAction } from '$lib/domain/offline';
import { A, ALL_OPS, NOW, USER, harness, settle } from '$lib/test/outbox-fake';
import { CHECKS, decides, drain, pick, seeded, times, type Outcome } from '$lib/test/outbox-matrix';

/**
 * How the first request of the first action goes (the creation of the ticket, else the first comment):
 * kept until the end, lost after the server wrote it, not reached, a 5xx before the server wrote it,
 * the time limit after it wrote it, or the first attempt with a connection (as is, lost, 5xx).
 */
type CommentSend =
	| 'offline'
	| 'lost'
	| 'unreached'
	| 'server5xx'
	| 'timeout'
	| 'direct'
	| 'directLost'
	| 'direct5xx';
type CommentWhen = 'before' | 'during' | 'after' | 'late';
type CommentAnswer = 'success' | 'refused' | 'server' | 'hidden';
type CommentChoice = 'save' | 'discard' | 'none';
type CommentDiscard =
	| { what: 'none' }
	| { what: 'comment'; index: number; when: CommentWhen }
	| { what: 'ticket'; when: CommentWhen };

interface CommentScenario {
	/** On a ticket "＋" created without a connection, else on A, which the server has. */
	onCreated: boolean;
	/** How many comments, written one after another. */
	count: number;
	send: CommentSend;
	discard: CommentDiscard;
	undo: boolean;
	/** The connection comes back with a success, the ticket in the trash, one 503, or hidden. */
	answer: CommentAnswer;
	/** What the user does with a comment that waits for a decision at the end. */
	choice: CommentChoice;
}

function isCommentDirect(send: CommentSend): boolean {
	return send === 'direct' || send === 'directLost' || send === 'direct5xx';
}

/** `count` drawn runs of the class "Kommentare", from a source of their own (OF-4b). */
function commentScenarios(count: number, seed: number): CommentScenario[] {
	const random = seeded(seed + 5);
	const sends: readonly CommentSend[] = [
		'offline',
		'lost',
		'unreached',
		'server5xx',
		'timeout',
		'direct',
		'directLost',
		'direct5xx'
	];
	return times(count, (): CommentScenario => {
		const onCreated = random() < 0.5;
		let send = pick(random, sends);
		// A comment on a ticket "＋" created waits for it: nothing goes directly.
		if (onCreated && isCommentDirect(send)) send = 'offline';
		const comments = 1 + Math.floor(random() * 3);
		const kind = pick(random, ['none', 'none', 'comment', 'comment', 'ticket'] as const);
		let when = pick(random, ['before', 'during', 'after', 'late'] as const);
		if (send === 'offline' && (when === 'during' || when === 'after')) when = 'before';
		if (isCommentDirect(send) && (when === 'before' || when === 'during')) when = 'after';
		const index = Math.floor(random() * comments);
		const discard: CommentDiscard =
			kind === 'comment'
				? { what: 'comment', index, when }
				: kind === 'ticket' && onCreated
					? { what: 'ticket', when }
					: { what: 'none' };
		return {
			onCreated,
			count: comments,
			send,
			discard,
			undo: discard.what !== 'none' && random() < 0.35,
			answer: pick(random, ['success', 'success', 'refused', 'server', 'hidden'] as const),
			choice: pick(random, ['save', 'discard', 'none'] as const)
		};
	});
}

function describeComments(scenario: CommentScenario): string {
	const { discard } = scenario;
	const what =
		discard.what === 'none'
			? ''
			: discard.what === 'comment'
				? ` verwerfen:K${discard.index + 1}/${discard.when}`
				: ` verwerfen:Ticket/${discard.when}`;
	return [
		`Kommentare: ${scenario.onCreated ? 'neues Ticket' : 'A'}, ${scenario.count}×, ${scenario.send}`,
		what,
		scenario.undo ? '+undo' : '',
		` ⇒ ${scenario.answer}`,
		scenario.answer === 'refused' || scenario.answer === 'hidden' ? `/${scenario.choice}` : ''
	].join('');
}

/** The oracle reads the kind and the state of an action as the dialog shows them, by itself. */
function isComment(action: KeptAction): action is CommentCreateAction {
	return action.kind === 'comment.create';
}

function isEntry(action: KeptAction): action is InboxCreateAction {
	return action.kind === 'inbox.create';
}

/** A comment the user discarded: which, its identifier and ID, whether it had left, when. */
interface CommentDiscarded {
	index: number;
	op: string;
	target: string;
	left: boolean;
	at: number;
}

/**
 * One run of the class "Kommentare" against the real outbox and the fake server, which writes comments
 * as the hooks and the rules of `comments` do. The oracle keeps what the user wrote and did and every
 * request, and reads of the outbox only what the dialog, the activity and the notices show.
 */
async function runComments(scenario: CommentScenario): Promise<Outcome> {
	vi.setSystemTime(NOW);
	const h = harness({ support: ALL_OPS });
	h.server.strict = true;
	h.server.status.set(A, 'open');
	await settle();
	const outcome: Outcome = { i1: [], i2: [], i3: [], i4: [], hang: [] };
	const c: string[] = [];
	const texts = times(scenario.count, () => '').map((_, index) => `Kommentar ${index + 1}`);

	/** Every request of a creation or a comment (not the lookups): its identifier, in order. */
	const requests: string[] = [];
	/**
	 * Every lookup of a comment by its ID and whether it found it, in order (K-5), and how many came
	 * before its ticket went out of sight (`hidden.add`, null while it did not).
	 */
	const lookups: { target: string; found: boolean }[] = [];
	let hiddenAt: number | null = null;
	const firstMode = new Map<string, CommentSend>();
	let duringRun: (() => Promise<void>) | null = null;
	let finalServer = false;
	/** What the user did, per comment by its index. */
	const userDiscarded = new Set<number>();
	const discards: CommentDiscarded[] = [];
	/** The comments the user saved as an entry of the inbox, by their ID (K-3). */
	const savedTargets: string[] = [];
	let ticketDiscard: { op: string; left: boolean; at: number } | null = null;
	let undone = false;
	let pendingUndo: (() => void) | null = null;

	const create = h.sendCreate.getMockImplementation();
	const comment = h.sendComment.getMockImplementation();
	const read = h.getComment.getMockImplementation();
	if (create === undefined || comment === undefined || read === undefined) {
		throw new Error('No ways.');
	}

	async function watched<T>(op: string, request: () => Promise<T>): Promise<T> {
		requests.push(op);
		if (finalServer && !h.server.applied.has(op)) {
			finalServer = false;
			throw new DataError('server', { status: 503 });
		}
		const mode = firstMode.get(op);
		if (mode !== undefined) firstMode.delete(op);
		if (mode !== undefined && duringRun !== null) {
			const during = duringRun;
			duringRun = null;
			await during();
		}
		if (mode === 'unreached') throw new DataError('network');
		if (mode === 'server5xx') throw new DataError('server', { status: 503 });
		const answer = await request();
		if (mode === 'lost' || mode === 'directLost') throw new DataError('network');
		if (mode === 'timeout') throw new DataError('aborted');
		if (mode === 'direct5xx') throw new DataError('server', { status: 503 });
		return answer;
	}
	h.sendCreate.mockImplementation((action, fields, signal) =>
		watched(fields.opId, () => create(action, fields, signal))
	);
	h.sendComment.mockImplementation((action, fields, signal) =>
		watched(fields.opId, () => comment(action, fields, signal))
	);
	h.getComment.mockImplementation(async (id, signal) => {
		try {
			const found = await read(id, signal);
			lookups.push({ target: id, found: true });
			return found;
		} catch (error) {
			lookups.push({ target: id, found: false });
			throw error;
		}
	});

	async function offline() {
		h.server.health = false;
		await h.connectivity.check();
	}
	async function online() {
		h.server.health = true;
		h.server.reachable = true;
		await h.connectivity.check();
		await settle();
	}
	async function window() {
		await online();
		await offline();
		await settle();
	}
	const indexOf = (body: string) => texts.indexOf(body);
	const commentAction = (index: number) =>
		h.outbox.actions.find((action) => isComment(action) && action.payload.body === texts[index]) ??
		null;

	/** "Verwerfen" as the dialog offers it, and the "Rückgängig" of its flag. */
	async function discardNow(op: string): Promise<boolean> {
		const count = h.flags.show.mock.calls.length;
		await h.outbox.discard(op);
		const flagged = h.flags.show.mock.calls
			.slice(count)
			.map((call) => call[0])
			.find((flag) => flag.action?.label === 'Rückgängig')?.action?.run;
		if (flagged === undefined) outcome.i4.push('„Verwerfen“ ohne „Rückgängig“');
		pendingUndo = flagged ?? null;
		return flagged !== undefined;
	}
	async function undoNow(): Promise<void> {
		const runUndo = pendingUndo;
		pendingUndo = null;
		if (runUndo === null) return;
		runUndo();
		await settle();
		undone = true;
	}
	let creationOp: string | null = null;
	async function discardPlanned(): Promise<void> {
		const { discard } = scenario;
		if (discard.what === 'comment') {
			const action = commentAction(discard.index);
			if (action === null) return;
			const left = requests.includes(action.op);
			if (!(await discardNow(action.op))) return;
			const entry = { index: discard.index, op: action.op, target: action.target, left };
			discards.push({ ...entry, at: requests.length });
			userDiscarded.add(discard.index);
			if (scenario.undo) {
				await undoNow();
				userDiscarded.delete(discard.index);
				discards.pop();
			}
		} else if (discard.what === 'ticket' && creationOp !== null) {
			const op = creationOp;
			if (!h.outbox.actions.some((action) => action.op === op)) return;
			const left = requests.includes(op);
			if (!(await discardNow(op))) return;
			ticketDiscard = { op, left, at: requests.length };
			if (scenario.undo) {
				await undoNow();
				ticketDiscard = null;
			}
		}
	}

	// The comments are written: on a ticket "＋" created without a connection, or on A (the first one
	// directly with a connection in the class "direkt").
	let ticket = { id: A, key: 'HAUS-01', title: 'Ticket 01', scope: `u:${USER}` };
	const direct = isCommentDirect(scenario.send);
	if (direct) await online();
	else await offline();
	if (scenario.onCreated) {
		const created = await h.outbox.createTicket({
			title: 'Neue Aufgabe vom Handy',
			description: '',
			status: 'open',
			priority: 'medium',
			due: null,
			project: null,
			tags: []
		});
		creationOp = h.outbox.actions.find((action) => action.target === created.value.id)?.op ?? null;
		ticket = { id: created.value.id, key: '', title: created.value.title, scope: `u:${USER}` };
	}
	for (const [index, text] of texts.entries()) {
		if (direct && index === 0 && scenario.send !== 'direct') {
			const mode = scenario.send;
			h.sendComment.mockImplementationOnce((action, fields, signal) => {
				firstMode.set(fields.opId, mode);
				return watched(fields.opId, () => comment(action, fields, signal));
			});
		}
		try {
			await h.outbox.createComment(ticket, text);
		} catch (error) {
			c.push(`C2 Kommentar ${index + 1} nicht angenommen: ${String(error)}`);
		}
		await settle();
		if (direct && index === 0) await offline();
	}
	const { discard } = scenario;
	if (discard.what !== 'none' && discard.when === 'before') await discardPlanned();
	const head = creationOp ?? commentAction(0)?.op ?? null;
	if (!direct && scenario.send !== 'offline' && head !== null) {
		firstMode.set(head, scenario.send);
		if (discard.what !== 'none' && discard.when === 'during') duringRun = discardPlanned;
		await window();
		firstMode.delete(head);
		duringRun = null;
	}
	if (discard.what !== 'none' && (discard.when === 'after' || discard.when === 'late')) {
		await discardPlanned();
	}

	// The connection comes back with the answer of the scenario; the ticket goes out of sight now (K-5).
	if (scenario.answer === 'refused' || scenario.answer === 'hidden') {
		h.server.hidden.add(ticket.id);
		hiddenAt = lookups.length;
	} else if (scenario.answer === 'server') finalServer = true;
	await online();
	await drain(h, 6);
	finalServer = false;
	// The user decides about the comments that wait for a decision, as the dialog offers it.
	for (const action of [...h.outbox.actions]) {
		if (!isComment(action) || !decides(action) || action.discarded === true) continue;
		if (scenario.choice === 'save') {
			await h.outbox.saveAsItem(action.op);
			savedTargets.push(action.target);
		} else if (scenario.choice === 'discard') {
			await h.outbox.discard(action.op);
			userDiscarded.add(indexOf(action.payload.body));
		}
	}
	await drain(h, 6);

	// The checks, by the oracle's own bookkeeping.
	const onServer = [...h.server.comments.entries()].filter(([, entry]) =>
		texts.includes(entry.body)
	);
	const actions = h.outbox.actions;
	const there = (text: string) => onServer.some(([, entry]) => entry.body === text);
	for (const text of texts) {
		const copies = onServer.filter(([, entry]) => entry.body === text).length;
		if (copies > 1) c.push(`C1 ${copies}× „${text}“`);
	}
	const ticketGone = (ticketDiscard as { op: string } | null) !== null;
	const saved = (text: string) =>
		[...h.server.records.values()].some((record) => record.body === text) ||
		actions.some((action) => isEntry(action) && action.payload.body === text);
	const kept = (text: string) =>
		actions.some((action) => isComment(action) && action.payload.body === text);
	for (const [index, text] of texts.entries()) {
		if (ticketGone && there(text))
			c.push(`C4 Kommentar ${index + 1} eines verworfenen Tickets angekommen`);
		if (userDiscarded.has(index)) continue;
		if (!there(text) && !kept(text) && !saved(text)) {
			c.push(`C2 Text von Kommentar ${index + 1} verloren`);
		}
	}
	// C4: what never left the device and was discarded never reaches the server; nothing discarded is
	// sent again (a lookup is no request of it).
	for (const entry of discards) {
		if (!entry.left && requests.includes(entry.op)) {
			c.push(`C4 Kommentar ${entry.index + 1} nie gesendet, doch beim Server`);
		}
		if (requests.slice(entry.at).includes(entry.op)) {
			c.push(`C4 Kommentar ${entry.index + 1} verworfen und erneut gesendet`);
		}
	}
	const gone = ticketDiscard as { op: string; left: boolean; at: number } | null;
	if (gone !== null) {
		if (!gone.left && h.server.records.has(ticket.id))
			c.push('C4 Ticket nie gesendet, doch angelegt');
		if (requests.slice(gone.at).includes(gone.op))
			c.push('C4 Ticket verworfen und erneut gesendet');
	}
	// C3: a discarded comment that is there anyway is named with a link to its ticket, and so is a
	// saved one (K-3), in words of their own; no notice names one that is not there. Its ticket out of
	// sight (the trash, or hidden otherwise), the account sees the comment no more, and a lookup cannot
	// tell it from one that never arrived (the limit of OF-4a with `hidden`, ADR-0074): left out, but
	// only where no lookup found it before the ticket went (K-5).
	const outOfSight = (target: string) =>
		hiddenAt !== null &&
		!lookups.slice(0, hiddenAt).some((lookup) => lookup.found && lookup.target === target);
	const named = h.outbox.notices.filter((notice) =>
		notice.text.includes('Der verworfene Kommentar')
	);
	const namedSaved = h.outbox.notices.filter((notice) =>
		notice.text.includes('zusätzlich im Eingang')
	);
	const arrivedAnyway = discards.filter((entry) => h.server.comments.has(entry.target));
	for (const entry of arrivedAnyway) {
		if (outOfSight(entry.target)) continue;
		if (!named.some((notice) => notice.link?.id === ticket.id)) {
			c.push(`C3 Kommentar ${entry.index + 1} verworfen, doch angekommen, ohne Hinweis`);
		}
	}
	if (named.length > 0 && arrivedAnyway.length === 0)
		c.push('C3 falscher Hinweis „ist schon angekommen“');
	const savedThere = savedTargets.filter((target) => h.server.comments.has(target));
	for (const target of savedThere) {
		if (outOfSight(target)) continue;
		if (!namedSaved.some((notice) => notice.link?.id === ticket.id)) {
			c.push('C3 gesichert, doch angekommen, ohne Hinweis');
		}
	}
	if (namedSaved.length > 0 && savedThere.length === 0)
		c.push('C3 falscher Hinweis „zusätzlich im Eingang“');
	// The order: the ticket before its comments, the comments in the order they were written.
	const writes = h.server.writes;
	const ticketAt = writes.indexOf(`ticket:${ticket.id}`);
	const written = onServer.map(([id, entry]) => ({
		index: indexOf(entry.body),
		at: writes.indexOf(`comment:${id}`)
	}));
	for (const entry of written) {
		if (scenario.onCreated && (ticketAt < 0 || entry.at < ticketAt)) {
			c.push(`Reihenfolge: Kommentar ${entry.index + 1} vor seinem Ticket`);
		}
	}
	const byWrite = [...written].sort((a, b) => a.at - b.at).map((entry) => entry.index);
	if (byWrite.some((index, at) => at > 0 && index < (byWrite[at - 1] ?? -1))) {
		c.push(`Reihenfolge der Kommentare: ${byWrite.map((index) => index + 1).join(', ')}`);
	}
	// I1, I4 and no hang: what the user wants arrived unless a decision stands; nothing waits for
	// nothing.
	const blocked = (action: KeptAction, depth = 0): boolean =>
		depth < 5 &&
		action.dependsOn.some((dep) => {
			const other = actions.find((entry) => entry.op === dep);
			return other !== undefined && (decides(other) || blocked(other, depth + 1));
		});
	for (const [index, text] of texts.entries()) {
		if (userDiscarded.has(index) || ticketGone || saved(text) || there(text)) continue;
		const waiting = actions.find((action) => isComment(action) && action.payload.body === text);
		if (waiting === undefined || !(decides(waiting) || blocked(waiting))) {
			outcome.i1.push(`Kommentar ${index + 1} nicht angekommen`);
		}
	}
	// A comment refused although its ticket is there and to be seen went before it (concept §3.3).
	const ticketThere =
		!h.server.hidden.has(ticket.id) && (ticket.id === A || h.server.records.has(ticket.id));
	for (const action of actions) {
		if (!isComment(action) || action.state !== 'refused' || !ticketThere) continue;
		if (action.outcome?.message.startsWith('Das Ticket nimmt den Kommentar nicht an') === true) {
			outcome.i1.push(`Kommentar ${indexOf(action.payload.body) + 1} vor seinem Ticket gesendet`);
		}
	}
	if (undone && scenario.answer === 'success' && discard.what === 'comment') {
		const text = texts[discard.index] ?? '';
		if (!there(text)) outcome.i4.push('nach „Rückgängig“ nicht angekommen');
	}
	for (const action of actions) {
		if (decides(action) || blocked(action)) continue;
		outcome.hang.push(
			`${action.kind} ${action.state}${action.discarded === true ? ' verworfen' : ''}`
		);
	}
	outcome.i3.push(...c);
	h.stop();
	return outcome;
}

/** Runs the class "Kommentare"; prints the numbers with BYL_MATRIX_REPORT=1 and returns the failures. */
async function checkComments(runs: readonly CommentScenario[]): Promise<string[]> {
	const failures: string[] = [];
	const counts = { i1: 0, i2: 0, i3: 0, i4: 0, hang: 0 };
	for (const scenario of runs) {
		const outcome = await runComments(scenario);
		const all: string[] = [];
		for (const name of CHECKS) {
			if (outcome[name].length > 0) counts[name] += 1;
			all.push(...outcome[name].map((entry) => `${name.toUpperCase()} ${entry}`));
		}
		if (all.length > 0) failures.push(`${describeComments(scenario)}: ${all.join('; ')}`);
	}
	if (process.env.BYL_MATRIX_REPORT === '1') {
		const broken = CHECKS.map((name) => `${name.toUpperCase()} ${counts[name]}`).join(', ');
		const distinct = new Set(runs.map(describeComments)).size;
		const lines = [
			`Kommentare: ${runs.length} Abläufe (${distinct} verschieden), verletzt: ${failures.length} (${broken}; C1 bis C4 und Reihenfolge unter I3)`,
			...failures.slice(0, 40)
		];
		process.stdout.write(`${lines.join('\n')}\n`);
	}
	return failures;
}

/**
 * Runs drawn of the class "Kommentare" (fixed seed). The file took 1.1 s on a developer machine (round 2,
 * K-6; before, in one file with the other classes, the matrix took 8 s); every matrix file stays under
 * 10 s.
 */
const COMMENT_RUNS = 1000;
const SEED = Number(process.env.BYL_MATRIX_SEED ?? 20261021);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the scenario matrix of "Verwerfen", class "Kommentare" (OF-4b)', () => {
	// BYL_MATRIX_COMMENT_RUNS and BYL_MATRIX_SEED draw other runs, BYL_MATRIX_REPORT=1 prints the
	// numbers.
	it(
		'keeps C1 to C4, the order, I1, I4 without hanging in the class "Kommentare" (OF-4b)',
		{ timeout: 60_000 },
		async () => {
			const count = Number(process.env.BYL_MATRIX_COMMENT_RUNS ?? COMMENT_RUNS);
			const failures = await checkComments(commentScenarios(count, SEED));
			expect(failures.slice(0, 10)).toEqual([]);
		}
	);
});
