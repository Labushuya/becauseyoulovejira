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
//   notice shows again: the user wants the sub-task done once more.
// - What the device holds is taken as it is: an entry this build cannot read is neither shown nor
//   changed (a newer build may have written it).

import {
	OFFLINE_TEXTS,
	changeOf,
	changeText,
	inOrder,
	intentOf,
	isTakeBack,
	parseChangeRef,
	statusFeature,
	type ChangeRef,
	type KeptAction
} from './offline';

/** One action the deletion after 7 days took. */
export interface DroppedEntry {
	/** The identifier of the deleted action. */
	readonly op: string;
	/** The key of its ticket, '' where it had none. */
	readonly key: string;
	/** A take-back: the change whose "Verwerfen" it carried out, null where that one was gone already. */
	readonly undoes?: ChangeRef | null;
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

export type OfflineNotice = DroppedNotice | ChildNotice;

/** Identifiers and keys on the device are short; anything longer is not one of this build. */
const MAX_TEXT = 200;

function isText(value: unknown, empty = true): value is string {
	return typeof value === 'string' && value.length <= MAX_TEXT && (empty || value !== '');
}

function parseEntry(raw: unknown): DroppedEntry | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const value = raw as Record<string, unknown>;
	if (!isText(value.op, false) || !isText(value.key)) return null;
	if (!('undoes' in value) || value.undoes === undefined) return { op: value.op, key: value.key };
	const undoes = value.undoes === null ? null : parseChangeRef(value.undoes);
	if (undoes === null && value.undoes !== null) return null;
	return { op: value.op, key: value.key, undoes };
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

/** Whether two notices say the same: one entry per action, one notice per sub-task and ticket. */
function sameNotice(a: OfflineNotice, b: OfflineNotice): boolean {
	if (a.id === b.id) return true;
	return (
		a.kind === 'childNotDone' &&
		b.kind === 'childNotDone' &&
		a.key === b.key &&
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
	return gone
		.filter((action) => !carried(action))
		.map((action) => {
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
 * after the completion in their order, kept by them, that sets the status of the sub-task.
 */
export function decidesInstead(notice: OfflineNotice, action: KeptAction): boolean {
	return (
		notice.kind === 'childNotDone' &&
		action.seq > notice.after &&
		action.discarded !== true &&
		intentOf(action).has(statusFeature(notice.child))
	);
}

/** The notices as stored without those the arrived `action` decided instead; null for none. */
export function withoutDecided(current: unknown, action: KeptAction): unknown[] | null {
	const list = listOf(current);
	const kept = list.filter((raw) => {
		const notice = parseNotice(raw);
		return notice === null || !decidesInstead(notice, action);
	});
	return kept.length === list.length ? null : kept;
}

/** The words of a notice, made when it shows. */
export function noticeText(notice: OfflineNotice): string {
	if (notice.kind === 'childNotDone') return OFFLINE_TEXTS.childNotDone(notice.key, notice.parent);
	const keys = [
		...new Set(notice.entries.map((entry) => (entry.key === '' ? 'ein Ticket' : entry.key)))
	];
	const backs = notice.entries.flatMap((entry) => {
		if (entry.undoes === undefined) return [];
		if (entry.undoes === null) return [OFFLINE_TEXTS.droppedDiscardOf(entry.key)];
		return [OFFLINE_TEXTS.droppedDiscard(changeText(entry.undoes))];
	});
	const head = OFFLINE_TEXTS.dropped(notice.entries.length, keys.join(', '));
	return [head, ...new Set(backs), OFFLINE_TEXTS.checkTickets(keys.length)].join(' ');
}
