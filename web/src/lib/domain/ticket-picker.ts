// Ticket picker (ADR-0042, plan docs/plan/auswahl-listen.md): the list that opens without typing,
// its search and the rules of the place it is used. Pure. The open tickets come from the list
// store, done ones page by page from the server; this module filters, groups and limits them.
//
// Search: typing narrows over key and title, without case, accents or umlaut dots ("äpfel" finds
// "Äpfel", "strasse" finds "Straße"); several words must all be found. The server cannot compare
// like that (SQLite LIKE folds only ASCII), so done tickets are asked for with a loose pattern
// that finds a superset, and `matchesWords` narrows them exactly here.

import { NO_PROJECT } from './list-query';
import { projectPath } from './project-tree';
import type { ProjectRef, TicketSummary } from './ticket';

/** Entries of the group "Zuletzt angesehen oder bearbeitet" at most. */
export const RECENT_LIMIT = 5;

/** Entries shown at first and added by every "Mehr anzeigen". */
export const PICKER_PAGE = 25;

/** Search words that reach the server at most; further ones only narrow in the client. */
export const PICKER_SERVER_WORDS = 5;

/** Ticket IDs of "Zuletzt angesehen" kept per device at most. */
export const RECENT_TICKETS_MAX = 10;

/** localStorage key of the recently viewed tickets (IDs only, with the user they belong to). */
export const RECENT_TICKETS_STORAGE_KEY = 'byl-recent-tickets';

/** Record IDs of PocketBase. */
const RECORD_ID = /^[a-z0-9]{15}$/;

/**
 * Text as the search compares it: lower case, accents and umlaut dots removed (NFD without
 * combining marks), ß as ss, runs of white space as one blank.
 */
export function normalizeSearch(text: string): string {
	return text
		.normalize('NFD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase()
		.replace(/ß/g, 'ss')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The normalised words of a search text; none for a text of blanks. */
export function searchWords(text: string): string[] {
	const normalized = normalizeSearch(text);
	return normalized === '' ? [] : normalized.split(' ');
}

/** Normalised key and title per ticket object; a changed ticket is a new object. */
const haystacks = new WeakMap<Pick<TicketSummary, 'key' | 'title'>, string>();

function haystackOf(ticket: Pick<TicketSummary, 'key' | 'title'>): string {
	let haystack = haystacks.get(ticket);
	if (haystack === undefined) {
		haystack = normalizeSearch(`${ticket.key} ${ticket.title}`);
		haystacks.set(ticket, haystack);
	}
	return haystack;
}

/** True if every word occurs in key or title (no words: every ticket). */
export function matchesWords(
	ticket: Pick<TicketSummary, 'key' | 'title'>,
	words: readonly string[]
): boolean {
	if (words.length === 0) return true;
	const haystack = haystackOf(ticket);
	return words.every((word) => haystack.includes(word));
}

/** Letters whose accented forms normalise to them: vowels, ç, ñ, ś and š, ý, ź and ž. */
const LOOSE_LETTERS = new Set(['a', 'c', 'e', 'i', 'n', 'o', 'u', 's', 'y', 'z']);

/**
 * LIKE pattern of the server (operator `~`, SQLite LIKE with `\` as escape) for a normalised word:
 * a superset of the tickets whose normalised key or title contains it. Letters with accented
 * forms become `_` (one character, "Ä" as well as "a"), "ss" becomes `%` (it may be "ß"), `\`,
 * `%` and `_` are taken literally. The pattern starts and ends with `%`, so PocketBase uses it
 * unchanged (tests/integration/web-data-ticket-picker.test.mjs).
 */
export function loosePattern(word: string): string {
	let pattern = '';
	for (let index = 0; index < word.length; index += 1) {
		const char = word[index] ?? '';
		if (char === 's' && word[index + 1] === 's') {
			pattern += '%';
			index += 1;
		} else if (LOOSE_LETTERS.has(char)) {
			pattern += '_';
		} else if (char === '\\' || char === '%' || char === '_') {
			pattern += `\\${char}`;
		} else {
			pattern += char;
		}
	}
	return `%${pattern}%`;
}

/** What a rule of the place says about a ticket: hidden, not choosable with a reason, or fine. */
export type PickerVerdict = { hide: true } | { reason: string } | null;

/** A rule of the place the picker is used (parent, link, …). */
export type PickerRule = (ticket: TicketSummary) => PickerVerdict;

/** Reasons of entries that stay visible but cannot be chosen. */
export const PICKER_REASONS = Object.freeze({
	currentParent: 'Ist schon das übergeordnete Ticket.',
	ownSubtask: 'Ist eine Unteraufgabe dieses Tickets.',
	isSubtask: 'Ist selbst eine Unteraufgabe; es gibt nur eine Ebene.',
	otherScope: 'Liegt in einem anderen Bereich.'
});

/** The reason of the ticket an entry of the inbox belongs to already. */
export function alreadyLinkedReason(key: string): string {
	return `Der Eintrag gehört schon zu ${key}.`;
}

/** Hides one ticket (the ticket itself). */
export function hideTicket(id: string): PickerRule {
	return (ticket) => (ticket.id === id ? { hide: true } : null);
}

/** Keeps one ticket visible but not choosable, with a reason. */
export function blockTicket(id: string, reason: string): PickerRule {
	return (ticket) => (ticket.id === id ? { reason } : null);
}

/**
 * Only tickets of the same area (scope, ADR-0033 and ADR-0031): a ticket of another area stays
 * visible with the reason. Without a known scope on either side the rule says nothing.
 */
export function sameScope(scope: string | null | undefined): PickerRule {
	return (ticket) =>
		scope && ticket.scope && ticket.scope !== scope ? { reason: PICKER_REASONS.otherScope } : null;
}

/**
 * Rules of the parent of `ticket` (ADR-0033: one level, no cycle): the ticket itself is hidden;
 * its current parent, its own sub-tasks (a cycle) and every other sub-task (a second level) stay
 * visible with the reason; tickets of another area as well.
 */
export function parentRules(
	ticket: Pick<TicketSummary, 'id' | 'parentId' | 'scope'>
): PickerRule[] {
	return [
		hideTicket(ticket.id),
		(candidate) =>
			ticket.parentId && candidate.id === ticket.parentId
				? { reason: PICKER_REASONS.currentParent }
				: null,
		(candidate) =>
			candidate.parentId === ticket.id ? { reason: PICKER_REASONS.ownSubtask } : null,
		(candidate) => (candidate.parentId ? { reason: PICKER_REASONS.isSubtask } : null),
		sameScope(ticket.scope)
	];
}

/**
 * Rules of the parent of a ticket that does not exist yet ("Neues Ticket", NT-1): every sub-task stays
 * visible with the reason (one level), tickets of another area as well. `scope` is the area the ticket
 * is created in.
 */
export function newTicketParentRules(scope: string | null | undefined): PickerRule[] {
	return [
		(candidate) => (candidate.parentId ? { reason: PICKER_REASONS.isSubtask } : null),
		sameScope(scope)
	];
}

/** The first verdict of the rules that says something, else null. */
export function judge(ticket: TicketSummary, rules: readonly PickerRule[]): PickerVerdict {
	for (const rule of rules) {
		const verdict = rule(ticket);
		if (verdict !== null) return verdict;
	}
	return null;
}

/** One entry of the list; `reason` is set for an entry that cannot be chosen. */
export interface PickerEntry {
	ticket: TicketSummary;
	reason: string | null;
}

/** A group of the list with its heading. */
export interface PickerGroup {
	id: string;
	label: string;
	entries: PickerEntry[];
}

export interface PickerListInput {
	/** Open tickets in the default order of the list (P-2). */
	open: readonly TicketSummary[];
	/** Loaded done tickets in the order of the server (most recently changed first). */
	done: readonly TicketSummary[];
	/** Recently viewed tickets, newest first. */
	recentIds: readonly string[];
	/** Normalised search words (`searchWords`). */
	words: readonly string[];
	/** "Nur offene": done tickets stay out. */
	onlyOpen: boolean;
	/** Project filter: the project IDs taken in (NO_PROJECT for tickets without), null for all. */
	projectIds: ReadonlySet<string> | null;
	/** Project of a ticket as the catalog knows it (with the parent of a sub project). */
	projectOf: (ticket: TicketSummary) => ProjectRef | null;
	/** Projects in tree order: the order of the project groups. */
	projectOrder: readonly Pick<ProjectRef, 'id'>[];
	rules: readonly PickerRule[];
	/** Entries shown at most. */
	limit: number;
}

export interface PickerList {
	groups: PickerGroup[];
	/** Entries shown (at most `limit`). */
	shown: number;
	/** Entries that match among the loaded tickets. */
	total: number;
}

/** Heading of the first group. */
export const RECENT_GROUP_LABEL = 'Zuletzt angesehen oder bearbeitet';
/** Heading of the tickets without project. */
export const NO_PROJECT_GROUP_LABEL = 'Ohne Projekt';
/** Heading of the done tickets. */
export const DONE_GROUP_LABEL = 'Erledigt';

/** Newest change first; the ID breaks ties, so the order is stable. */
function byChange(a: TicketSummary, b: TicketSummary): number {
	if (a.updated !== b.updated) return a.updated < b.updated ? 1 : -1;
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function inProjects(ticket: TicketSummary, projectIds: ReadonlySet<string> | null): boolean {
	if (projectIds === null) return true;
	return projectIds.has(ticket.projectId ?? NO_PROJECT);
}

/**
 * The list of the picker (ADR-0042 section 2): first up to RECENT_LIMIT recently viewed tickets
 * (in the order they were viewed), filled up with the most recently changed ones, then the open
 * tickets grouped by project in tree order ("Haus › Garten"), projects unknown to the catalog by
 * name, then "Ohne Projekt", then the done ones. Hidden tickets are left out, tickets that cannot
 * be chosen keep their place with the reason. At most `limit` entries; empty groups are left out.
 */
export function pickerList(input: PickerListInput): PickerList {
	const { words, projectIds, rules } = input;
	const openIds = new Set(input.open.map((ticket) => ticket.id));
	const pool = input.onlyOpen
		? [...input.open]
		: [...input.open, ...input.done.filter((ticket) => !openIds.has(ticket.id))];
	const reasons = new Map<string, string | null>();
	const matching: TicketSummary[] = [];
	for (const ticket of pool) {
		if (!matchesWords(ticket, words) || !inProjects(ticket, projectIds)) continue;
		const verdict = judge(ticket, rules);
		if (verdict !== null && 'hide' in verdict) continue;
		reasons.set(ticket.id, verdict === null ? null : verdict.reason);
		matching.push(ticket);
	}
	const byId = new Map(matching.map((ticket) => [ticket.id, ticket]));
	const entry = (ticket: TicketSummary): PickerEntry => ({
		ticket,
		reason: reasons.get(ticket.id) ?? null
	});

	const recent: TicketSummary[] = [];
	const taken = new Set<string>();
	const take = (ticket: TicketSummary | undefined) => {
		if (ticket === undefined || taken.has(ticket.id) || recent.length >= RECENT_LIMIT) return;
		recent.push(ticket);
		taken.add(ticket.id);
	};
	for (const id of input.recentIds) take(byId.get(id));
	for (const ticket of [...matching].sort(byChange)) take(ticket);

	const projectGroups = new Map<string, PickerGroup>();
	const noProject: PickerEntry[] = [];
	const done: PickerEntry[] = [];
	for (const ticket of matching) {
		if (taken.has(ticket.id)) continue;
		if (!openIds.has(ticket.id)) {
			done.push(entry(ticket));
			continue;
		}
		const project = input.projectOf(ticket);
		if (project === null) {
			noProject.push(entry(ticket));
			continue;
		}
		let group = projectGroups.get(project.id);
		if (group === undefined) {
			group = { id: `project:${project.id}`, label: projectPath(project), entries: [] };
			projectGroups.set(project.id, group);
		}
		group.entries.push(entry(ticket));
	}
	const known = input.projectOrder.flatMap((project) => {
		const group = projectGroups.get(project.id);
		return group === undefined ? [] : [group];
	});
	const knownIds = new Set(input.projectOrder.map((project) => project.id));
	const unknown = [...projectGroups.entries()]
		.filter(([id]) => !knownIds.has(id))
		.map(([, group]) => group)
		.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

	const groups: PickerGroup[] = [
		{ id: 'recent', label: RECENT_GROUP_LABEL, entries: recent.map(entry) },
		...known,
		...unknown,
		{ id: 'none', label: NO_PROJECT_GROUP_LABEL, entries: noProject },
		{ id: 'done', label: DONE_GROUP_LABEL, entries: done }
	];
	let room = input.limit;
	const shownGroups: PickerGroup[] = [];
	for (const group of groups) {
		if (room <= 0) break;
		const entries = group.entries.slice(0, room);
		if (entries.length === 0) continue;
		shownGroups.push({ ...group, entries });
		room -= entries.length;
	}
	return { groups: shownGroups, shown: input.limit - room, total: matching.length };
}

/**
 * The entry that is active when the list opens or the text changes: the one whose key is the
 * typed text (any case), else the first one that can be chosen, else -1.
 */
export function preferredIndex(entries: readonly PickerEntry[], text: string): number {
	const typed = text.trim().toUpperCase();
	const exact = entries.findIndex(
		(candidate) => candidate.reason === null && candidate.ticket.key === typed
	);
	if (exact >= 0) return exact;
	return entries.findIndex((candidate) => candidate.reason === null);
}

/**
 * What the live region says about the list (ADR-0042 section 3): the number of hits, and how many
 * of them are shown; `more` means the server may have further done tickets.
 */
export function pickerStatus(list: Pick<PickerList, 'shown' | 'total'>, more: boolean): string {
	const { shown, total } = list;
	if (total === 0) {
		return more
			? 'Noch kein Ticket gefunden. „Mehr anzeigen“ lädt weitere erledigte.'
			: 'Kein Ticket gefunden.';
	}
	const count = total === 1 ? '1 Ticket' : `${total} Tickets`;
	if (shown >= total && !more) return `${count}.`;
	return `${shown} von ${more ? 'mehr als ' : ''}${count} angezeigt.`;
}

/**
 * Recently viewed tickets of `userId` from the stored value; anything else (another user, broken
 * JSON, foreign values) gives none. At most RECENT_TICKETS_MAX valid record IDs, each once.
 */
export function parseRecentTickets(
	raw: string | null | undefined,
	userId: string | null
): string[] {
	if (!raw || userId === null) return [];
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return [];
	}
	if (typeof value !== 'object' || value === null) return [];
	const { user, ids } = value as { user?: unknown; ids?: unknown };
	if (user !== userId || !Array.isArray(ids)) return [];
	const valid = ids.filter((id): id is string => typeof id === 'string' && RECORD_ID.test(id));
	return [...new Set(valid)].slice(0, RECENT_TICKETS_MAX);
}

/** The list after viewing `id`: it moves to the front, the oldest ones fall out. */
export function rememberTicket(ids: readonly string[], id: string): string[] {
	if (!RECORD_ID.test(id)) return [...ids];
	return [id, ...ids.filter((known) => known !== id)].slice(0, RECENT_TICKETS_MAX);
}

/** Stored value of the recently viewed tickets of `userId`. */
export function serializeRecentTickets(userId: string, ids: readonly string[]): string {
	return JSON.stringify({ user: userId, ids });
}
