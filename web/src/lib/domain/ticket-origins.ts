// Tickets as sources of other tickets (QT-1, ADR-0067): "B stammt aus A". What the SPA reads from the
// routes /api/byl/tickets/{id}/ticket-sources and …/follow-up, the rules of the ticket picker of
// "Quelle hinzufügen → Ticket", the question of "Folge-Ticket anlegen …" and the history entries.
// Pure. The texts of the codes, the chain of a refused circle and the title of a follow-up are the
// same as in app/pb_hooks/lib/ticket-source-rules.js (tests/unit/web-ticket-origins.test.mjs).

import { isStatus, type Status } from './status';
import type { TicketSummary } from './ticket';
import { hideTicket, sameScope, type PickerRule } from './ticket-picker';

/** Texts of the codes of the routes, the same as the hook's. */
export const TICKET_SOURCE_MESSAGES = Object.freeze({
	validation_ticket_source_self: 'Ein Ticket kann nicht aus sich selbst stammen.',
	validation_ticket_source_cycle: 'Diese Verknüpfung würde einen Kreis schließen.',
	validation_ticket_source_missing:
		'Das Ticket gibt es nicht (mehr), es liegt im Papierkorb oder ist für dich nicht sichtbar.',
	validation_ticket_source_format: 'Bitte ein Ticket als Quelle wählen.',
	validation_follow_up_title: 'Bitte einen Titel mit höchstens 200 Zeichen angeben.'
});

/** Longest title of a ticket (tickets.title). */
export const FOLLOW_UP_TITLE_MAX = 200;
/** What the title of a follow-up starts with. */
export const FOLLOW_UP_PREFIX = 'Folge: ';

/** History field of the follow-up ("Quelle hinzugefügt: KEY", "Quelle entfernt: KEY"). */
export const HISTORY_SOURCE = 'ticket_source';
/** History field of the source ("Folge-Ticket: KEY", "Folge-Ticket entfernt: KEY"). */
export const HISTORY_FOLLOW_UP = 'follow_up';

/** One ticket of the sections "Quellen" and "Folge-Tickets". */
export interface TicketOrigin {
	/** ID of the link. */
	link: string;
	/** The other ticket. */
	id: string;
	key: string;
	title: string;
	status: Status;
	/** The other ticket lies in the trash: "(im Papierkorb)", without a link to it. */
	trashed: boolean;
	/** When it was linked. */
	created: string;
	/** Who linked, '' for the server. */
	createdBy: string;
}

/** The answer of GET /api/byl/tickets/{id}/ticket-sources (and of adding and removing). */
export interface TicketOrigins {
	ticketId: string;
	/** The tickets this one stems from, oldest link first. */
	sources: TicketOrigin[];
	/** The tickets that stem directly from this one. */
	followUps: TicketOrigin[];
	/** Every ticket that stems from this one over any number of steps: none may become its source. */
	descendants: string[];
	/** Adding or removing found the link as asked already (another tab, a second click). */
	already: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function toOrigin(value: unknown): TicketOrigin | null {
	if (!isRecord(value)) return null;
	const { link, id, status } = value;
	if (typeof link !== 'string' || typeof id !== 'string' || id === '' || !isStatus(status)) {
		return null;
	}
	return {
		link,
		id,
		key: text(value.key),
		title: text(value.title),
		status,
		trashed: value.trashed === true,
		created: text(value.created),
		createdBy: text(value.created_by)
	};
}

function originsOf(value: unknown): TicketOrigin[] | null {
	if (!Array.isArray(value)) return null;
	const list: TicketOrigin[] = [];
	for (const entry of value as unknown[]) {
		const origin = toOrigin(entry);
		if (origin === null) return null;
		list.push(origin);
	}
	return list;
}

/** The answer of the routes, or null when it is not one. */
export function toTicketOrigins(value: unknown): TicketOrigins | null {
	if (!isRecord(value) || typeof value.ticket !== 'string') return null;
	const sources = originsOf(value.sources);
	const followUps = originsOf(value.follow_ups);
	const descendants = Array.isArray(value.descendants)
		? (value.descendants as unknown[]).filter((id): id is string => typeof id === 'string')
		: null;
	if (sources === null || followUps === null || descendants === null) return null;
	return {
		ticketId: value.ticket,
		sources,
		followUps,
		descendants,
		already: value.already === true
	};
}

/** "HAUS-12", "HAUS-12 und HAUS-15", "HAUS-12, HAUS-15 und HAUS-17". */
export function keyList(keys: readonly string[]): string {
	if (keys.length <= 1) return keys.join('');
	return `${keys.slice(0, -1).join(', ')} und ${keys[keys.length - 1] ?? ''}`;
}

/**
 * Text of a refused circle with its chain of keys, like the hook: "HAUS-20 stammt bereits (über
 * HAUS-12) von HAUS-3 ab."; a chain of one is the ticket itself.
 */
export function cycleMessage(keys: readonly string[]): string {
	if (keys.length < 2) return TICKET_SOURCE_MESSAGES.validation_ticket_source_self;
	const middle = keys.slice(1, -1);
	const over = middle.length > 0 ? `(über ${keyList(middle)}) ` : '';
	return `${keys[0] ?? ''} stammt bereits ${over}von ${keys[keys.length - 1] ?? ''} ab.`;
}

/** The chain of a refusal `validation_ticket_source_cycle` (`params.path`), or null. */
export function cyclePathOf(
	params: Readonly<Record<string, unknown>> | undefined
): string[] | null {
	const path = params?.path;
	if (!Array.isArray(path) || !path.every((key) => typeof key === 'string')) return null;
	return path as string[];
}

/**
 * Rules of the ticket picker of "Quelle hinzufügen → Ticket": not offered are the ticket itself, its
 * sources and every ticket that stems from it (it would close a circle, ADR-0067 §3); tickets of
 * another area stay visible with the reason. The server checks again.
 */
export function sourcePickerRules(
	ticket: Pick<TicketSummary, 'id' | 'scope'>,
	origins: Pick<TicketOrigins, 'sources' | 'descendants'> | null
): PickerRule[] {
	const hidden = new Set([
		...(origins?.sources.map((source) => source.id) ?? []),
		...(origins?.descendants ?? [])
	]);
	return [
		hideTicket(ticket.id),
		(candidate) => (hidden.has(candidate.id) ? { hide: true } : null),
		sameScope(ticket.scope)
	];
}

/**
 * Rules of the ticket picker of the sources of a ticket that does not exist yet ("Neues Ticket",
 * NT-1): the tickets chosen already are hidden, tickets of another area stay visible with the reason.
 * A new ticket has no follow-ups, so no choice closes a circle.
 */
export function newTicketSourceRules(
	scope: string | null | undefined,
	chosen: readonly string[]
): PickerRule[] {
	const hidden = new Set(chosen);
	return [(candidate) => (hidden.has(candidate.id) ? { hide: true } : null), sameScope(scope)];
}

/**
 * The title "Folge-Ticket anlegen …" starts with: "Folge: ‹Titel›", cut with "…" before it passes
 * FOLLOW_UP_TITLE_MAX.
 */
export function followUpTitle(title: string): string {
	const base = title.trim();
	if (FOLLOW_UP_PREFIX.length + base.length <= FOLLOW_UP_TITLE_MAX) {
		return `${FOLLOW_UP_PREFIX}${base}`;
	}
	const room = FOLLOW_UP_TITLE_MAX - FOLLOW_UP_PREFIX.length - 1;
	return `${FOLLOW_UP_PREFIX}${base.slice(0, room).trimEnd()}…`;
}

/** What a follow-up takes over from its source (ADR-0067 §4). */
export interface FollowUpTake {
	tags: boolean;
	charm: boolean;
	description: boolean;
}

/** The question starts with tags and charm, without the description. */
export const DEFAULT_FOLLOW_UP_TAKE: Readonly<FollowUpTake> = Object.freeze({
	tags: true,
	charm: true,
	description: false
});

export interface FollowUpRequest {
	title: string;
	take: FollowUpTake;
}

/** Request body of "Folge-Ticket anlegen …". */
export function followUpRequestBody(request: FollowUpRequest): Record<string, string | boolean> {
	return {
		title: request.title.trim(),
		tags: request.take.tags,
		charm: request.take.charm,
		description: request.take.description
	};
}

/** Error of the title before sending: 1 to 200 characters. */
export function followUpTitleError(title: string): string | null {
	const trimmed = title.trim();
	return trimmed === '' || trimmed.length > FOLLOW_UP_TITLE_MAX
		? TICKET_SOURCE_MESSAGES.validation_follow_up_title
		: null;
}

/** The answer of "Folge-Ticket anlegen …". */
export interface FollowUpOutcome {
	id: string;
	key: string;
	title: string;
	/** The project of the follow-up, null without one. */
	project: string | null;
	source: { id: string; key: string };
}

/** The answer of the route, or null when it is not one. */
export function toFollowUpOutcome(value: unknown): FollowUpOutcome | null {
	if (!isRecord(value) || !isRecord(value.source)) return null;
	const { id, key, title, project } = value;
	const source = value.source;
	if (typeof id !== 'string' || id === '' || typeof key !== 'string') return null;
	if (typeof source.id !== 'string' || typeof source.key !== 'string') return null;
	return {
		id,
		key,
		title: text(title),
		project: typeof project === 'string' && project !== '' ? project : null,
		source: { id: source.id, key: source.key }
	};
}

/** The flag after "Folge-Ticket anlegen …": the new key and the way back to the source. */
export function followUpFlag(
	sourceKey: string,
	followUpKey: string
): { title: string; description: string; action: string } {
	return {
		title: `Folge-Ticket ${followUpKey} angelegt.`,
		description: `Es stammt aus ${sourceKey}.`,
		action: `${sourceKey} öffnen`
	};
}

function keyOf(value: string): string {
	try {
		const parsed: unknown = JSON.parse(value);
		if (isRecord(parsed) && typeof parsed.key === 'string') return parsed.key;
	} catch {
		// Not readable: the entry is named without the other ticket.
	}
	return '';
}

/**
 * Text of a history entry of a link (ADR-0067 §6): in the follow-up "Quelle hinzugefügt: HAUS-3" or
 * "Quelle entfernt: HAUS-3", in the source "Folge-Ticket: HAUS-20" or "Folge-Ticket entfernt: HAUS-20".
 */
export function originHistoryText(field: string, oldValue: string, newValue: string): string {
	const added = newValue !== '';
	const key = keyOf(added ? newValue : oldValue);
	let verb: string;
	if (field === HISTORY_SOURCE) verb = added ? 'Quelle hinzugefügt' : 'Quelle entfernt';
	else verb = added ? 'Folge-Ticket' : 'Folge-Ticket entfernt';
	return key === '' ? verb : `${verb}: ${key}`;
}

/** The ticket of a follow-up flag or a link: "(im Papierkorb)" after its key when it lies there. */
export function originLabel(origin: Pick<TicketOrigin, 'key' | 'trashed'>): string {
	return origin.trashed ? `${origin.key} (im Papierkorb)` : origin.key;
}
