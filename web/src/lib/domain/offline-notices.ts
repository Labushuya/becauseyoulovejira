// The notices of the outbox that stay until the user closes them (OF-3b round 3; since OF-3c on the
// device, ADR-0074 addendum OF-3c). Pure: the store passes what the device holds and writes what comes
// back in one transaction of the storage.
//
// - Two kinds: what the deletion after 7 days took (`dropped`, one entry per deleted action, written in
//   the transaction that deletes it), and a sub-task a completion should have taken along that is not
//   done (`childNotDone`).
// - Kept are the kind, the keys of the tickets, the value of a change whose "Verwerfen" was not carried
//   out, the time and an identifier; never a title. The words come with the display (`noticeText`).
// - The same notice twice shows once: one entry per action, one notice per sub-task and ticket.
// - A later change of the user that sets the status of the sub-task decides instead (R3-4): while it
//   is kept, the notice does not show (that change shows, waiting or with its decision); once it
//   arrived, the notice goes in the same transaction. Should it go without effect ("Verwerfen"), the
//   notice shows again: the user wants the sub-task done once more. Since round 2 a take-back decides
//   nothing unless it sets the sub-task done (C-1), and a later completion that takes the sub-task
//   along settles the notice only once the sub-task is read done (C-5).
// - What the device holds is taken as it is: an entry this build cannot read is neither shown nor
//   changed (a newer build may have written it).
// - Since OF-4a a creation "＋" the deletion after 7 days took keeps its title in the notice (C2: no
//   text gets lost), and a discarded creation that arrived anyway names its record with a link
//   (`created`, C4). These two are the only notices with a title. Since round 2 a creation the server
//   answers as arrived but the account no longer sees (`created` with `hidden`, A7) names its record
//   the same way, and a change the deletion after 7 days took with its creation keeps the title of
//   that creation (`along`, A8).
// - Since OF-4b a comment the deletion after 7 days took keeps its whole text in the notice (C2), also
//   one that went with the creation of its ticket; a discarded comment that arrived anyway names it with
//   a link to its ticket (`created` with `ticket`). A build before OF-4b cannot read these notices.
// - Since round 2 of OF-4b an entry of the inbox that keeps the text of a comment keeps that whole text
//   in the notice of the deletion after 7 days (`body`, K-1), and a comment saved as an entry after it
//   may have arrived is named in words of its own (`saved`, K-3): found, its text is there twice.

import {
	OFFLINE_TEXTS,
	alongDropped,
	changeOf,
	changeText,
	commentExcerpt,
	commentTicketName,
	createdInSentence,
	createdRecordOf,
	inOrder,
	intentOf,
	isCommentCreate,
	isCreateAction,
	isInboxCreate,
	isTakeBack,
	parseChangeRef,
	statusFeature,
	ticketOf,
	type ChangeRef,
	type CreateAction,
	type CreatedKind,
	type KeptAction
} from './offline';
import { INBOX_BODY_MAX_LENGTH } from './inbox';
import { COMMENT_MAX_LENGTH, TITLE_MAX_LENGTH } from './ticket';

/**
 * A creation "＋" (OF-4a) or a comment (OF-4b): what it was, its title (of a comment its whole text,
 * the beginning of it once discarded), whether the user had discarded it, and the ticket of a comment
 * in the words after "zu".
 */
export interface CreatedRef {
	readonly record: CreatedKind;
	readonly title: string;
	/** Discarded, but it may have arrived and was never looked up (C3: named, never silent). */
	readonly discarded?: true;
	/** The ticket of a comment: its key, or "dem neuen Ticket „Titel“" (OF-4b). */
	readonly ticket?: string;
	/** The whole text of an entry of the inbox that keeps a comment, not discarded (round 2, K-1). */
	readonly body?: string;
	/** A comment saved as an entry after it may have arrived, so discarded (round 2, K-3). */
	readonly saved?: true;
}

/** The creation of an action as a notice keeps it. */
function createdRefOf(action: CreateAction): CreatedRef {
	const discarded = action.discarded === true;
	const record = createdRecordOf(action) ?? 'ticket';
	if (isCommentCreate(action)) {
		// The whole text stays readable until the notice is closed (C2), not of a discarded one.
		const body = action.payload.body;
		return {
			record,
			title: discarded ? commentExcerpt(body) : body,
			...(discarded && { discarded: true as const }),
			ticket: commentTicketName(action),
			...(discarded && action.saved === true && { saved: true as const })
		};
	}
	// The text of a comment an entry keeps stays readable as well (round 2, K-1), not of a discarded one.
	const body = isInboxCreate(action) && !discarded ? action.payload.body : undefined;
	return {
		record,
		title: action.payload.title,
		...(discarded && { discarded: true as const }),
		...(body !== undefined && { body })
	};
}

/** One action the deletion after 7 days took. */
export interface DroppedEntry {
	/** The identifier of the deleted action. */
	readonly op: string;
	/** The key of its ticket, '' where it had none. */
	readonly key: string;
	/** A take-back: the change whose "Verwerfen" it carried out, null where that one was gone already. */
	readonly undoes?: ChangeRef | null;
	/** A creation "＋" (OF-4a): its title stays readable until the notice is closed. */
	readonly created?: CreatedRef;
	/** A change that went with the creation it waited for (OF-4a round 2, A8): that creation. */
	readonly along?: CreatedRef;
}

/** What the deletion after 7 days took in one run (round 3, R2-2). */
export interface DroppedNotice {
	readonly v: 1;
	readonly id: string;
	readonly kind: 'dropped';
	/** When it was deleted, ms of the device. */
	readonly at: number;
	readonly entries: readonly DroppedEntry[];
}

/** A sub-task a completion should have taken along that is not done once it arrived (round 3, R2-1). */
export interface ChildNotice {
	readonly v: 1;
	readonly id: string;
	readonly kind: 'childNotDone';
	readonly at: number;
	/** The key of the sub-task, '' where it has none. */
	readonly key: string;
	/** The key of the completed ticket, '' where it has none. */
	readonly parent: string;
	/** The ID of the sub-task. */
	readonly child: string;
	/** The number of the order of the completion: a later change of the sub-task decides instead. */
	readonly after: number;
}

/**
 * A creation "＋" the user discarded that arrived anyway (OF-4a, C4): it is neither sent again nor
 * deleted on the server; the notice names it with a link until the user closes it.
 */
export interface CreatedNotice {
	readonly v: 1;
	readonly id: string;
	readonly kind: 'created';
	readonly at: number;
	readonly record: CreatedKind;
	/** Its ID (the one of the client). */
	readonly target: string;
	/** The ticket of a comment (OF-4b): the notice leads there. */
	readonly ticket?: string;
	/** The key the server gave a ticket (of a comment: of its ticket), '' for an entry or where unknown. */
	readonly key: string;
	/** Its title; of a comment the beginning of its text (OF-4b). */
	readonly title: string;
	/**
	 * Not discarded: the server answered a repetition as arrived, but the account no longer sees the
	 * record (`validation_op_applied`, OF-4a round 2, A7).
	 */
	readonly hidden?: true;
	/** A comment saved as an entry after it may have arrived: its text is there twice (round 2, K-3). */
	readonly saved?: true;
}

export type OfflineNotice = DroppedNotice | ChildNotice | CreatedNotice;

/** Identifiers and keys on the device are short; anything longer is not one of this build. */
const MAX_TEXT = 200;

function isText(value: unknown, empty = true): value is string {
	return typeof value === 'string' && value.length <= MAX_TEXT && (empty || value !== '');
}

/**
 * A title of a creation (OF-4a): not empty, at most as long as the server takes one; the text of a
 * comment (OF-4b) at most as long as a comment.
 */
function isTitle(value: unknown, record: CreatedKind = 'ticket'): value is string {
	const max = record === 'comment' ? COMMENT_MAX_LENGTH : TITLE_MAX_LENGTH;
	return typeof value === 'string' && value !== '' && value.length <= max;
}

function isRecordKind(value: unknown): value is CreatedKind {
	return value === 'ticket' || value === 'inbox' || value === 'comment';
}

/** The ticket of a comment in words: its key or "dem neuen Ticket „Titel“" (OF-4b). */
function isTicketWords(value: unknown): value is string {
	return typeof value === 'string' && value !== '' && value.length <= TITLE_MAX_LENGTH + 40;
}

/** The creation of a dropped entry, null where it is none of this build, undefined without one. */
function createdOf(value: unknown): CreatedRef | null | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'object' || value === null) return null;
	const { record, title, discarded, ticket, body, saved } = value as Record<string, unknown>;
	if (!isRecordKind(record) || !isTitle(title, record)) return null;
	if (discarded !== undefined && discarded !== true) return null;
	// A comment names its ticket (OF-4b); nothing else does.
	if ((record === 'comment') !== isTicketWords(ticket)) return null;
	// The text an entry keeps (round 2, K-1), and a comment saved after it may have arrived (K-3).
	const text = typeof body === 'string' && body !== '' && body.length <= INBOX_BODY_MAX_LENGTH;
	if (body !== undefined && (record !== 'inbox' || discarded === true || !text)) return null;
	if (saved !== undefined && (saved !== true || record !== 'comment' || discarded !== true)) {
		return null;
	}
	return {
		record,
		title,
		...(discarded === true && { discarded: true as const }),
		...(record === 'comment' && { ticket: ticket as string }),
		...(typeof body === 'string' && { body }),
		...(saved === true && { saved: true as const })
	};
}

function parseEntry(raw: unknown): DroppedEntry | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const value = raw as Record<string, unknown>;
	if (!isText(value.op, false) || !isText(value.key)) return null;
	const created = createdOf(value.created);
	const along = createdOf(value.along);
	if (created === null || along === null) return null;
	const head = {
		op: value.op,
		key: value.key,
		...(created !== undefined && { created }),
		...(along !== undefined && { along })
	};
	if (!('undoes' in value) || value.undoes === undefined) return head;
	const undoes = value.undoes === null ? null : parseChangeRef(value.undoes);
	if (undoes === null && value.undoes !== null) return null;
	return { ...head, undoes };
}

/** A notice as the device keeps it, null for anything this build cannot read. */
export function parseNotice(raw: unknown): OfflineNotice | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const value = raw as Record<string, unknown>;
	if (value.v !== 1 || !isText(value.id, false)) return null;
	if (typeof value.at !== 'number' || !Number.isFinite(value.at)) return null;
	const head = { v: 1 as const, id: value.id, at: value.at };
	if (value.kind === 'childNotDone') {
		const { key, parent, child, after } = value;
		if (!isText(key) || !isText(parent) || !isText(child, false)) return null;
		if (typeof after !== 'number' || !Number.isFinite(after)) return null;
		return { ...head, kind: 'childNotDone', key, parent, child, after };
	}
	if (value.kind === 'created') {
		const { record, target, ticket, key, title, hidden, saved } = value;
		if (!isRecordKind(record) || !isText(target, false) || !isText(key) || !isTitle(title)) {
			return null;
		}
		if (hidden !== undefined && hidden !== true) return null;
		// A comment leads to its ticket (OF-4b); nothing else names one.
		if ((record === 'comment') !== isText(ticket, false)) return null;
		// Only a comment is saved as an entry (round 2, K-3).
		if (saved !== undefined && (saved !== true || record !== 'comment')) return null;
		const notice = {
			...head,
			kind: 'created' as const,
			record,
			target,
			...(record === 'comment' && { ticket: ticket as string }),
			key,
			title,
			...(saved === true && { saved: true as const })
		};
		return hidden === true ? { ...notice, hidden: true as const } : notice;
	}
	if (value.kind !== 'dropped' || !Array.isArray(value.entries) || value.entries.length === 0) {
		return null;
	}
	const entries = value.entries.map(parseEntry);
	if (entries.some((entry) => entry === null)) return null;
	return { ...head, kind: 'dropped', entries: entries as DroppedEntry[] };
}

/** The entries the device keeps for an account, as they are. */
function listOf(current: unknown): unknown[] {
	return Array.isArray(current) ? current : [];
}

/** The notices of an account this build can read, oldest first. */
export function parseNotices(current: unknown): OfflineNotice[] {
	const notices = listOf(current).flatMap((raw) => {
		const notice = parseNotice(raw);
		return notice === null ? [] : [notice];
	});
	return notices.sort((a, b) => a.at - b.at);
}

/**
 * Whether two notices say the same: one entry per action, one notice per sub-task (its ID, round 2,
 * C-4: two sub-tasks without a key are two) and ticket.
 */
function sameNotice(a: OfflineNotice, b: OfflineNotice): boolean {
	if (a.id === b.id) return true;
	return (
		a.kind === 'childNotDone' &&
		b.kind === 'childNotDone' &&
		a.child === b.child &&
		a.parent === b.parent
	);
}

/** The notices as stored with `notices` added, null when the device has each already. */
export function withNotices(current: unknown, notices: readonly OfflineNotice[]): unknown[] | null {
	const list = listOf(current);
	const known = parseNotices(list);
	const added: OfflineNotice[] = [];
	for (const notice of notices) {
		if ([...known, ...added].some((other) => sameNotice(other, notice))) continue;
		added.push(notice);
	}
	return added.length === 0 ? null : [...list, ...added];
}

/**
 * The notices as stored with `entry` in the notice `id` of the deletion after 7 days, made at `at`
 * where the device has none yet (a deletion writes one entry per action).
 */
export function withDropped(
	current: unknown,
	head: { id: string; at: number },
	entry: DroppedEntry
): unknown[] {
	const list = listOf(current);
	const index = list.findIndex((raw) => parseNotice(raw)?.id === head.id);
	const found = index < 0 ? null : parseNotice(list[index]);
	if (found === null || found.kind !== 'dropped') {
		const notice: DroppedNotice = {
			v: 1,
			id: head.id,
			kind: 'dropped',
			at: head.at,
			entries: [entry]
		};
		return [...list, notice];
	}
	if (found.entries.some((known) => known.op === entry.op)) return list;
	const next: DroppedNotice = { ...found, entries: [...found.entries, entry] };
	return list.map((raw, at) => (at === index ? next : raw));
}

/**
 * The notices as stored without `shown`, but only while the device still holds it as it was shown
 * (compare-and-swap, I5); null otherwise: it changed meanwhile, the user sees it anew.
 */
export function withoutNotice(current: unknown, shown: OfflineNotice): unknown[] | null {
	const list = listOf(current);
	const index = list.findIndex((raw) => parseNotice(raw)?.id === shown.id);
	if (index < 0) return null;
	// Both read the same way, so the order of their keys does not matter.
	if (JSON.stringify(parseNotice(list[index])) !== JSON.stringify(parseNotice(shown))) return null;
	return list.filter((_, at) => at !== index);
}

/**
 * What the deletion after 7 days takes of `before` (the actions of `drop`), with `after` the actions
 * once it went. Every action that goes counts (none surely arrived with an answer), a take-back names
 * the change whose "Verwerfen" it carried out. Not a discarded change whose take-back stays and is
 * sent (OF-3c, R3-6): the take-back carries what the user wants, nothing is lost.
 */
export function droppedEntries(
	before: readonly KeptAction[],
	drop: readonly string[],
	after: readonly KeptAction[]
): DroppedEntry[] {
	const gone = inOrder(before.filter((action) => drop.includes(action.op)));
	const carried = (action: KeptAction) =>
		action.discarded === true && after.some((other) => other.undoes === action.op);
	// The changes that went with their creation name it (OF-4a round 2, A8); a comment, also one that
	// went with the creation of its ticket, keeps its own text (OF-4b, C2).
	const along = alongDropped(before, drop);
	return gone
		.filter((action) => !carried(action))
		.map((action) => {
			if (isCreateAction(action)) {
				return { op: action.op, key: action.key, created: createdRefOf(action) };
			}
			const creation = along.get(action.op);
			if (creation !== undefined) {
				const { record, title } = createdRefOf(creation);
				return { op: action.op, key: action.key, along: { record, title } };
			}
			if (!isTakeBack(action)) return { op: action.op, key: action.key };
			const original = before.find((other) => other.op === action.undoes);
			return {
				op: action.op,
				key: action.key,
				undoes: original === undefined ? null : changeOf(original)
			};
		});
}

/** The notice about a sub-task of `completion` that is not done once it arrived (round 3, R2-1). */
export function childNotice(
	completion: Pick<KeptAction, 'op' | 'seq' | 'key'>,
	child: { id: string; key: string },
	at: number
): ChildNotice {
	return {
		v: 1,
		id: `child-${completion.op}-${child.id}`,
		kind: 'childNotDone',
		at,
		key: child.key,
		parent: completion.key,
		child: child.id,
		after: completion.seq
	};
}

/**
 * Whether `action` decides about the sub-task of a notice instead (OF-3c, R3-4): a change of the user
 * after the completion in their order, kept by them, that sets the status of the sub-task. A take-back
 * only carries out "Verwerfen" and decides nothing, unless it sets the sub-task done (round 2, C-1).
 */
export function decidesInstead(notice: OfflineNotice, action: KeptAction): boolean {
	if (notice.kind !== 'childNotDone' || action.seq <= notice.after) return false;
	if (action.discarded === true) return false;
	const wish = intentOf(action).get(statusFeature(notice.child));
	if (wish === undefined) return false;
	return !isTakeBack(action) || wish === 'done';
}

/**
 * Whether the arrived `action` settled a notice it decides instead: a change of the sub-task itself,
 * whose answer says what it is; a completion that takes it along only where the sub-task is read done
 * afterwards (`done`, round 2, C-5): on a stale state it makes no step to "done" and completes nothing.
 */
export function settledBy(
	notice: OfflineNotice,
	action: KeptAction,
	done: readonly string[] = []
): boolean {
	if (notice.kind !== 'childNotDone' || !decidesInstead(notice, action)) return false;
	return ticketOf(action) === notice.child || done.includes(notice.child);
}

/** The notices as stored without those the arrived `action` settled (`settledBy`); null for none. */
export function withoutDecided(
	current: unknown,
	action: KeptAction,
	done: readonly string[] = []
): unknown[] | null {
	const list = listOf(current);
	const kept = list.filter((raw) => {
		const notice = parseNotice(raw);
		return notice === null || !settledBy(notice, action, done);
	});
	return kept.length === list.length ? null : kept;
}

/**
 * The name of a dropped action in the sentence: its key, "ein Ticket", or the creation with its title
 * (OF-4a; "das neue Ticket „…“" since round 2, A10); a comment by its ticket ("der Kommentar zu
 * HAUS-12", OF-4b), a discarded one by the beginning of its text.
 */
function entryName(entry: DroppedEntry): string {
	const created = entry.created;
	if (created?.record === 'comment' && created.discarded !== true) {
		return `der ${OFFLINE_TEXTS.comment} zu ${created.ticket ?? 'einem Ticket'}`;
	}
	if (created !== undefined) return createdInSentence(created.record, created.title);
	return entry.key === '' ? 'ein Ticket' : entry.key;
}

/**
 * The notice about a creation the user discarded that arrived anyway (OF-4a, C4): one per action, with
 * the key of a ticket where the answer names it. `hidden`: one not discarded that the server answered
 * as arrived, but the account no longer sees (round 2, A7). A comment (OF-4b) is named by the
 * beginning of its text and leads to its ticket; one saved as an entry says so (round 2, K-3).
 */
export function createdNotice(
	action: CreateAction,
	key: string,
	at: number,
	hidden = false
): CreatedNotice {
	const comment = isCommentCreate(action);
	return {
		v: 1,
		id: `created-${action.op}`,
		kind: 'created',
		at,
		record: createdRecordOf(action) ?? 'ticket',
		target: action.target,
		...(comment && { ticket: action.ticket }),
		key,
		title: comment ? commentExcerpt(action.payload.body) : action.payload.title,
		...(hidden && { hidden: true as const }),
		...(comment && action.saved === true && { saved: true as const })
	};
}

/**
 * The words of a notice, made when it shows. The changes the deletion after 7 days took with their
 * creation count apart from it, in a sentence per creation (OF-4a round 2, A8).
 */
export function noticeText(notice: OfflineNotice): string {
	if (notice.kind === 'childNotDone') return OFFLINE_TEXTS.childNotDone(notice.key, notice.parent);
	if (notice.kind === 'created') {
		if (notice.hidden === true) return OFFLINE_TEXTS.createdHidden(notice.record, notice.title);
		if (notice.saved === true) return OFFLINE_TEXTS.savedAnyway(notice.title, notice.key);
		return OFFLINE_TEXTS.createdAnyway(notice.record, notice.title, notice.key);
	}
	const alongs = notice.entries.filter((entry) => entry.along !== undefined);
	const own =
		alongs.length === notice.entries.length
			? notice.entries
			: notice.entries.filter((entry) => entry.along === undefined);
	const keys = [...new Set(own.map(entryName))];
	const backs = own.flatMap((entry) => {
		if (entry.created?.saved === true) return [OFFLINE_TEXTS.droppedSaved(entry.created.title)];
		if (entry.created?.discarded === true) {
			return [OFFLINE_TEXTS.droppedCreated(entry.created.record, entry.created.title)];
		}
		if (entry.undoes === undefined) return [];
		if (entry.undoes === null) return [OFFLINE_TEXTS.droppedDiscardOf(entry.key)];
		return [OFFLINE_TEXTS.droppedDiscard(changeText(entry.undoes))];
	});
	const counts = new Map<string, number>();
	if (own !== notice.entries) {
		for (const entry of alongs) {
			const title = entry.along?.title ?? '';
			counts.set(title, (counts.get(title) ?? 0) + 1);
		}
	}
	const along = [...counts].map(([title, count]) => OFFLINE_TEXTS.droppedAlong(count, title));
	// The whole text of a comment stays readable until the notice is closed (OF-4b, C2), and so does the
	// one of an entry that keeps a comment (round 2, K-1).
	const texts = own.flatMap(({ created }) => {
		if (created?.record === 'comment' && created.discarded !== true) {
			return [OFFLINE_TEXTS.droppedComment(created.ticket ?? 'einem Ticket', created.title)];
		}
		if (created?.body !== undefined) {
			return [OFFLINE_TEXTS.droppedItemText(created.title, created.body)];
		}
		return [];
	});
	const head = OFFLINE_TEXTS.dropped(own.length, keys.join(', '));
	return [
		head,
		...along,
		...texts,
		...new Set(backs),
		OFFLINE_TEXTS.checkTickets(keys.length)
	].join(' ');
}
