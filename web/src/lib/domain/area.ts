// Areas "Privat" and "Haushalt" (E7-3, ADR-0059): pure rules of the area switch. An area is the
// scope of the records (`u:<account>` or `h:<household>`, CLAUDE.md §5 "Scopes"); the app shows and
// creates in one area at a time, like a virtual desktop. Which one is remembered per device and
// account; the household of the account decides whether there is a choice at all.

/** A record ID of PocketBase: 15 signs of a-z and 0-9. */
const RECORD_ID = /^[a-z0-9]{15}$/;

/** Names and texts of the switch, the flags and the notes. */
export const AREA_TEXTS = Object.freeze({
	group: 'Bereich',
	private: 'Privat',
	/** Name and tooltip of the "+" beside "Privat" for an account without a household. */
	add: 'Haushalt gründen oder beitreten',
	switched: (name: string) => `Zum Bereich ${name} gewechselt.`,
	lost: 'Du bist jetzt im Bereich Privat.',
	privateOnly: 'Nur im privaten Bereich',
	privateOnlyText:
		'Verbindungen mit Zugangsdaten, Ordnern oder Abrufen des Servers bleiben privat. Wechsle oben zu „Privat“, um sie einzurichten.'
});

/**
 * Texts of `validation_scope_mismatch` per field (ADR-0059 §4), the same as SCOPE_MESSAGES of
 * app/pb_hooks/lib/ticket-rules.js (parity test): a reference across the border of an area reads
 * like a missing record, and the text says both.
 */
export const SCOPE_FIELD_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	project:
		'Das Projekt gehört zu einem anderen Bereich (Privat oder Haushalt) oder wurde gelöscht.',
	tags: 'Ein Tag gehört zu einem anderen Bereich (Privat oder Haushalt) oder wurde gelöscht.',
	parent:
		'Das übergeordnete Ticket gehört zu einem anderen Bereich (Privat oder Haushalt) oder wurde gelöscht.',
	recurrence:
		'Die Wiederholung gehört zu einem anderen Bereich (Privat oder Haushalt) oder wurde gelöscht.',
	blocker: 'Abhängigkeiten gibt es nur zwischen Tickets desselben Bereichs (Privat oder Haushalt).',
	blocked: 'Abhängigkeiten gibt es nur zwischen Tickets desselben Bereichs (Privat oder Haushalt).',
	// A ticket as the source of another one (QT-1, ADR-0067).
	source: 'Tickets als Quelle gibt es nur im selben Bereich (Privat oder Haushalt).'
});

/** The text of `validation_scope_mismatch` for any other field. */
export const SCOPE_MESSAGE =
	'Liegt in einem anderen Bereich (Privat oder Haushalt) oder wurde gelöscht.';

export type AreaKind = 'private' | 'household';

/** The remembered choice of a device and account. */
export type AreaChoice = { kind: 'private' } | { kind: 'household'; household: string };

export const PRIVATE_CHOICE: AreaChoice = Object.freeze({ kind: 'private' });

/** Scope of the private area of an account. */
export function privateScope(userId: string): string {
	return `u:${userId}`;
}

/** Scope of a household. */
export function householdScope(householdId: string): string {
	return `h:${householdId}`;
}

/** Whether `value` is the scope of an area (`u:` or `h:` and a record ID). */
export function isAreaScope(value: unknown): value is string {
	return typeof value === 'string' && /^[uh]:/.test(value) && RECORD_ID.test(value.slice(2));
}

/** The household of a scope, '' for the private area and anything else. */
export function householdOfScope(scope: string | null | undefined): string {
	return isAreaScope(scope) && scope.startsWith('h:') ? scope.slice(2) : '';
}

/** Key of the remembered choice in localStorage: per account, so two accounts of a browser differ. */
export function areaStorageKey(userId: string): string {
	return `byl-area:${userId}`;
}

/** Stored text of a choice: "private" or "household:<id>". */
export function areaChoiceValue(choice: AreaChoice): string {
	return choice.kind === 'private' ? 'private' : `household:${choice.household}`;
}

/** The choice of a stored text; null for nothing or anything else. */
export function parseAreaChoice(raw: string | null | undefined): AreaChoice | null {
	if (raw === 'private') return PRIVATE_CHOICE;
	if (typeof raw !== 'string' || !raw.startsWith('household:')) return null;
	const household = raw.slice('household:'.length);
	return RECORD_ID.test(household) ? { kind: 'household', household } : null;
}

/**
 * The area that applies: the chosen household only while the account is a member of it
 * (`household`, null without one); otherwise "Privat". So losing the household always lands in
 * "Privat", and joining one keeps "Privat" until the switch says otherwise.
 */
export function resolveChoice(choice: AreaChoice | null, household: string | null): AreaChoice {
	return choice?.kind === 'household' && household !== null && choice.household === household
		? choice
		: PRIVATE_CHOICE;
}

/** Scope of a choice for an account. */
export function scopeOfChoice(choice: AreaChoice, userId: string): string {
	return choice.kind === 'private' ? privateScope(userId) : householdScope(choice.household);
}

/**
 * Whether "Endgültig löschen" and "Papierkorb leeren" are offered in the trash of the area (ADR-0059
 * §6): always in "Privat"; in a household only with the right "purge" (`mayPurge` of the
 * membership, null while it is not known). The server refuses anything else with 403.
 */
export function purgeAllowed(active: AreaKind, mayPurge: boolean | null): boolean {
	return active === 'private' || mayPurge === true;
}

/** Kinds of records with an area that a route of the app opens. */
export type AreaRecordKind = 'ticket' | 'project' | 'item' | 'rule' | 'trash';

/** Routes that show one record, by kind (`[id]` is its record ID). */
const RECORD_ROUTES: Readonly<Record<string, AreaRecordKind>> = Object.freeze({
	'/(app)/(tickets)/tickets/[id]': 'ticket',
	'/(app)/(tickets)/tickets/[id]/voll': 'ticket',
	'/(app)/kalender/tickets/[id]': 'ticket',
	'/(app)/kalender/tickets/[id]/voll': 'ticket',
	'/(app)/projekte/tickets/[id]': 'ticket',
	'/(app)/projekte/tickets/[id]/voll': 'ticket',
	'/(app)/eingang/tickets/[id]': 'ticket',
	'/(app)/eingang/tickets/[id]/voll': 'ticket',
	'/(app)/wiederholungen/tickets/[id]': 'ticket',
	'/(app)/wiederholungen/tickets/[id]/voll': 'ticket',
	'/(app)/tagesplan/tickets/[id]': 'ticket',
	'/(app)/tagesplan/tickets/[id]/voll': 'ticket',
	'/(app)/erledigt/tickets/[id]': 'ticket',
	'/(app)/erledigt/tickets/[id]/voll': 'ticket',
	'/(app)/projekte/[id]': 'project',
	'/(app)/eingang/[id]': 'item',
	'/(app)/kalender/eingang/[id]': 'item',
	'/(app)/wiederholungen/[id]': 'rule',
	'/(app)/kalender/wiederholungen/[id]': 'rule',
	'/(app)/papierkorb/[id]': 'trash'
});

/** The record a route shows, or null for a view, a form and the settings. */
export function recordOfRoute(
	routeId: string | null | undefined,
	id: string | null | undefined
): { kind: AreaRecordKind; id: string } | null {
	if (typeof routeId !== 'string' || typeof id !== 'string' || !RECORD_ID.test(id)) return null;
	const kind = Object.hasOwn(RECORD_ROUTES, routeId) ? RECORD_ROUTES[routeId] : undefined;
	return kind === undefined ? null : { kind, id };
}

/** The views of the app a change of the area may lead to. */
export type AreaView =
	'tasks' | 'dayplan' | 'projects' | 'inbox' | 'recurrences' | 'calendar' | 'done' | 'trash';

/** Views of the app by the start of their routes; the settings are not among them (they stay). */
const VIEW_BASES: readonly (readonly [string, AreaView])[] = [
	['/(app)/(tickets)', 'tasks'],
	['/(app)/tagesplan', 'dayplan'],
	['/(app)/projekte', 'projects'],
	['/(app)/eingang', 'inbox'],
	['/(app)/wiederholungen', 'recurrences'],
	['/(app)/kalender', 'calendar'],
	['/(app)/erledigt', 'done'],
	['/(app)/papierkorb', 'trash']
];

/**
 * Parameters of the addresses that name a record of an area: the project and tag filters (with the
 * switch of the sub projects), the target project of the inbox, the origin of a ticket in an area,
 * the parent of a new project and the entry a new ticket is made from. Another area does not know
 * them; every other parameter (status, search, sorting, view, day) stays.
 */
const AREA_PARAMS = ['projekt', 'unterprojekte', 'tag', 'zielprojekt', 'von', 'oberprojekt', 'aus'];

/**
 * Where the tab goes when the area changes by the switch: from a record, a form or a filter of the
 * old area to its view without them, with the other parameters of the view (`search` with "?" or
 * ''), so nothing of the old area stays open. Null when the address can stay (a view without such
 * parameters, the settings).
 */
export function areaSwitchTarget(
	url: URL,
	routeId: string | null | undefined
): { view: AreaView; search: string } | null {
	if (typeof routeId !== 'string') return null;
	const base = VIEW_BASES.find(
		([prefix]) => routeId === prefix || routeId.startsWith(`${prefix}/`)
	);
	if (base === undefined) return null;
	const [viewRoute, view] = base;
	const params = new URLSearchParams(url.search);
	let dropped = false;
	for (const name of AREA_PARAMS) {
		if (params.has(name)) {
			params.delete(name);
			dropped = true;
		}
	}
	if (routeId === viewRoute && !dropped) return null;
	const search = params.toString();
	return { view, search: search === '' ? '' : `?${search}` };
}
