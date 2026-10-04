// A household (ADR-0058, E7-2): the answers of the routes /api/byl/household… read strictly, the
// catalog of rights with who may change what, the invitation codes and the words of the page
// "Einstellungen → Haushalt". The rules and texts are the same as app/pb_hooks/lib/household-rules.js
// (parity test); the server decides, the page only leaves out what it would refuse. Pure: no SDK,
// no SvelteKit.

import { parseRetention, type TrashRetention } from './trash';

/** Rights besides the normal use of the household, in the order of the page. */
export const RIGHTS = ['invite', 'remove', 'delegate', 'rename', 'purge', 'move_out'] as const;
export type HouseholdRight = (typeof RIGHTS)[number];
export type HouseholdRole = 'owner' | 'member';

/** Name of each right on the page. */
export const RIGHT_LABELS: Readonly<Record<HouseholdRight, string>> = {
	invite: 'Einladen',
	remove: 'Mitglieder entfernen',
	delegate: 'Rechte weitergeben',
	rename: 'Umbenennen',
	purge: 'Endgültig löschen',
	move_out: 'Ins Private verschieben'
};

/** What each right allows, as the hint next to it. */
export const RIGHT_HINTS: Readonly<Record<HouseholdRight, string>> = {
	invite: 'Einladungscodes erzeugen und widerrufen.',
	remove: 'Mitglieder aus dem Haushalt entfernen, nie den Inhaber.',
	delegate: 'Eigene Rechte an andere Mitglieder geben und wieder nehmen.',
	rename: 'Den Haushalt umbenennen.',
	purge: 'Tickets im Papierkorb des Haushalts endgültig löschen und seine Aufbewahrung ändern.',
	move_out:
		'Einträge anderer Mitglieder aus dem Haushalt ins Private verschieben (eigene Einträge darf jedes Mitglied).'
};

/** Maximum of the name of a household (lib/household-rules.js NAME_MAX). */
export const NAME_MAX = 100;
/** Signs of an invitation code: no 0, O, 1, I, L (lib/household-rules.js CODE_ALPHABET). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
const CODE_GROUP = 4;
/** Open codes of one household at a time. */
export const OPEN_INVITES_MAX = 10;

/** Texts of the refused requests, the same as PROBLEMS of lib/household-rules.js. */
export const HOUSEHOLD_PROBLEMS: Readonly<Record<string, string>> = {
	name: 'Bitte einen Namen eingeben.',
	'name-long': `Höchstens ${NAME_MAX} Zeichen.`,
	format: 'Die Angabe fehlt oder ist ungültig.',
	code: 'Code ungültig oder abgelaufen.',
	'already-member':
		'Du bist schon Mitglied eines Haushalts. Ein Konto kann vorerst nur in einem Haushalt sein.',
	'no-household': 'Du bist in keinem Haushalt.',
	right: 'Dafür fehlt dir das Recht im Haushalt.',
	'owner-only': 'Das kann nur der Inhaber des Haushalts.',
	'owner-untouchable': 'Beim Inhaber des Haushalts geht das nicht.',
	'self-rights': 'Deine eigenen Rechte kann nur ein anderes Mitglied ändern.',
	'self-remove': 'Um den Haushalt zu verlassen, wähle „Austreten“.',
	'self-transfer': 'Du bist schon Inhaber des Haushalts.',
	'rights-foreign': 'Du kannst nur Rechte vergeben oder entziehen, die du selbst hast.',
	member: 'Dieses Mitglied gibt es im Haushalt nicht mehr.',
	invite: 'Diesen Code gibt es nicht mehr.',
	'invite-closed': 'Dieser Code ist nicht mehr offen.',
	'invites-full': `Höchstens ${OPEN_INVITES_MAX} offene Codes. Widerrufe zuerst einen.`,
	'owner-leave':
		'Als Inhaber kannst du nicht austreten. Übertrage zuerst die Inhaberschaft an ein anderes Mitglied, ' +
		'oder löse den Haushalt auf.',
	retention: 'Bitte 7, 30 oder 90 Tage oder „Nie automatisch“ wählen.'
};

/** Text of a refused request, or a general one for a problem the page does not know. */
export function problemText(problem: string): string {
	return Object.hasOwn(HOUSEHOLD_PROBLEMS, problem)
		? (HOUSEHOLD_PROBLEMS[problem] ?? '')
		: 'Der Server hat die Anfrage abgelehnt.';
}

// eslint-disable-next-line no-control-regex -- the same rule as the hook: no control characters
const CONTROL = /[\u0000-\u001f\u007f]/;

/** '' for a valid name of a household, else the problem ('name' or 'name-long'), like the hook. */
export function nameProblem(value: string): '' | 'name' | 'name-long' {
	const name = value.trim();
	if (name === '' || CONTROL.test(name)) return 'name';
	return name.length > NAME_MAX ? 'name-long' : '';
}

/** A typed code as the server compares it: capitals, without white space and hyphens. */
export function normalizeCode(value: string): string {
	return value.toUpperCase().replace(/[\s\-‐‑‒–—−]/g, '');
}

/** Whether a normalized code has the form of a code. */
export function isCode(code: string): boolean {
	return code.length === CODE_LENGTH && [...code].every((sign) => CODE_ALPHABET.includes(sign));
}

/** A code in groups of four, "ABCD-EFGH"; also while it is typed ("ABCD-E"). */
export function formatCode(value: string): string {
	const signs = normalizeCode(value).slice(0, CODE_LENGTH);
	const groups: string[] = [];
	for (let start = 0; start < signs.length; start += CODE_GROUP) {
		groups.push(signs.slice(start, start + CODE_GROUP));
	}
	return groups.join('-');
}

/**
 * A code grouped while it is typed ("abcde" → "ABCD-E"), with the caret after the same signs as
 * before, so typing or pasting in the middle does not jump to the end.
 */
export function groupCodeInput(value: string, caret: number): { value: string; caret: number } {
	const signsBefore = normalizeCode(value.slice(0, Math.max(0, caret))).length;
	const grouped = formatCode(value);
	let position = 0;
	for (let signs = 0; position < grouped.length && signs < signsBefore; position += 1) {
		if (grouped[position] !== '-') signs += 1;
	}
	return { value: grouped, caret: position };
}

/** The rights of a membership: every one for the owner, the known stored ones for a member. */
export function effectiveRights(
	role: HouseholdRole,
	stored: readonly string[]
): readonly HouseholdRight[] {
	if (role === 'owner') return RIGHTS;
	return RIGHTS.filter((right) => stored.includes(right));
}

/** A membership as the rules see it. */
export interface Membership {
	id: string;
	role: HouseholdRole;
	rights: readonly string[];
}

export function may(member: Membership, right: HouseholdRight): boolean {
	return effectiveRights(member.role, member.rights).includes(right);
}

/** The rights that differ between two lists. */
export function changedRights(
	before: readonly string[],
	after: readonly string[]
): HouseholdRight[] {
	return RIGHTS.filter((right) => before.includes(right) !== after.includes(right));
}

/** The problem of giving `target` the rights `next`, or '' (the rule of the hook). */
export function rightsProblem(
	actor: Membership,
	target: Membership,
	next: readonly string[]
): string {
	if (!may(actor, 'delegate')) return 'right';
	if (actor.id === target.id) return 'self-rights';
	if (target.role === 'owner') return 'owner-untouchable';
	const own = effectiveRights(actor.role, actor.rights);
	const changed = changedRights(effectiveRights(target.role, target.rights), next);
	return changed.every((right) => own.includes(right)) ? '' : 'rights-foreign';
}

/** The problem of removing `target`, or '' (the rule of the hook). */
export function removeProblem(actor: Membership, target: Membership): string {
	if (!may(actor, 'remove')) return 'right';
	if (actor.id === target.id) return 'self-remove';
	return target.role === 'owner' ? 'owner-untouchable' : '';
}

/** The problem of handing the household to `target`, or '' (the rule of the hook). */
export function transferProblem(actor: Membership, target: Membership): string {
	if (actor.role !== 'owner') return 'owner-only';
	return actor.id === target.id ? 'self-transfer' : '';
}

/** The problem of leaving, or '' (the rule of the hook). */
export function leaveProblem(actor: Membership): string {
	return actor.role === 'owner' ? 'owner-leave' : '';
}

/**
 * Whether a membership may delete for good in the trash of its household and set its retention
 * (E7-3, lib/household-rules.js mayPurge): the owner and every member with "purge".
 */
export function mayPurge(member: Membership): boolean {
	return may(member, 'purge');
}

/** The rights `actor` may give or take at another member: his own, with "delegate". */
export function delegableRights(actor: Membership): readonly HouseholdRight[] {
	return may(actor, 'delegate') ? effectiveRights(actor.role, actor.rights) : [];
}

/** What the page offers at a member: only what the server would allow. */
export function memberActions(
	actor: Membership,
	target: Membership
): { rights: boolean; remove: boolean; transfer: boolean } {
	return {
		rights:
			rightsProblem(actor, target, effectiveRights(target.role, target.rights)) === '' &&
			delegableRights(actor).length > 0,
		remove: removeProblem(actor, target) === '',
		transfer: transferProblem(actor, target) === ''
	};
}

export type InviteStatus = 'open' | 'used' | 'revoked' | 'expired';

export const INVITE_STATUS_LABELS: Readonly<Record<InviteStatus, string>> = {
	open: 'Offen',
	used: 'Benutzt',
	revoked: 'Widerrufen',
	expired: 'Abgelaufen'
};

export interface HouseholdMember {
	/** ID of the membership (the routes …/members/{id}/…). */
	id: string;
	user: string;
	name: string;
	role: HouseholdRole;
	/** Every right for the owner. */
	rights: readonly HouseholdRight[];
	self: boolean;
}

export interface HouseholdInvite {
	id: string;
	status: InviteStatus;
	created: string;
	expires: string;
	/** When it was used, revoked or expired; '' while open. */
	ended: string;
	/** Display names of members; '' for an account no longer in the household. */
	createdBy: string;
	usedBy: string;
}

export interface Household {
	id: string;
	name: string;
	created: string;
	/**
	 * Retention of the trash of the household (E7-3, migration 1790204100): 7, 30, 90 days or
	 * "never"; the default of 30 days when the server sends nothing (also before the migration).
	 */
	trashRetention: TrashRetention;
}

/** The household of the signed-in account as GET /api/byl/household answers it. */
export interface HouseholdState {
	household: Household;
	me: { member: string; role: HouseholdRole; rights: readonly HouseholdRight[] };
	members: HouseholdMember[];
	/** The codes, only with the right "invite". */
	invites: HouseholdInvite[] | null;
}

/** A new code: shown once, with the new state. */
export interface InviteGrant {
	code: string;
	invite: string;
	state: HouseholdState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rightsOf(value: unknown): HouseholdRight[] | null {
	if (!Array.isArray(value)) return null;
	const rights: HouseholdRight[] = [];
	for (const entry of value) {
		const right = RIGHTS.find((known) => known === entry);
		if (right === undefined) return null;
		rights.push(right);
	}
	return rights;
}

function roleOf(value: unknown): HouseholdRole | null {
	return value === 'owner' || value === 'member' ? value : null;
}

function textOf(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function parseMember(value: unknown): HouseholdMember | null {
	if (!isRecord(value)) return null;
	const id = textOf(value.id);
	const user = textOf(value.user);
	const name = textOf(value.name);
	const role = roleOf(value.role);
	const rights = rightsOf(value.rights);
	if (
		id === null ||
		id === '' ||
		user === null ||
		name === null ||
		role === null ||
		rights === null
	) {
		return null;
	}
	if (typeof value.self !== 'boolean') return null;
	return { id, user, name, role, rights, self: value.self };
}

const STATUSES: readonly InviteStatus[] = ['open', 'used', 'revoked', 'expired'];

function parseInvite(value: unknown): HouseholdInvite | null {
	if (!isRecord(value)) return null;
	const fields = ['id', 'created', 'expires', 'ended', 'createdBy', 'usedBy'].map((name) =>
		textOf(value[name])
	);
	const status = STATUSES.find((known) => known === value.status);
	if (fields.some((field) => field === null) || status === undefined || fields[0] === '') {
		return null;
	}
	const [id, created, expires, ended, createdBy, usedBy] = fields as string[];
	return {
		id: id ?? '',
		status,
		created: created ?? '',
		expires: expires ?? '',
		ended: ended ?? '',
		createdBy: createdBy ?? '',
		usedBy: usedBy ?? ''
	};
}

/**
 * The answer of GET /api/byl/household and of every change: the state, `null` for "no household",
 * `undefined` for anything else.
 */
export function parseHouseholdAnswer(value: unknown): HouseholdState | null | undefined {
	if (!isRecord(value)) return undefined;
	if (value.household === null) return null;
	const household = value.household;
	const me = value.me;
	if (!isRecord(household) || !isRecord(me) || !Array.isArray(value.members)) return undefined;
	const id = textOf(household.id);
	const name = textOf(household.name);
	const meMember = textOf(me.member);
	const meRole = roleOf(me.role);
	const meRights = rightsOf(me.rights);
	if (id === null || id === '' || name === null || meMember === null || meRole === null) {
		return undefined;
	}
	if (meRights === null) return undefined;
	const members: HouseholdMember[] = [];
	for (const entry of value.members) {
		const member = parseMember(entry);
		if (member === null) return undefined;
		members.push(member);
	}
	let invites: HouseholdInvite[] | null = null;
	if (Array.isArray(value.invites)) {
		invites = [];
		for (const entry of value.invites) {
			const invite = parseInvite(entry);
			if (invite === null) return undefined;
			invites.push(invite);
		}
	} else if (value.invites !== null && value.invites !== undefined) {
		return undefined;
	}
	return {
		household: {
			id,
			name,
			created: textOf(household.created) ?? '',
			trashRetention: parseRetention(household.trash_retention)
		},
		me: { member: meMember, role: meRole, rights: meRights },
		members,
		invites
	};
}

/** The answer of "Code erzeugen", or null. */
export function parseInviteGrant(value: unknown): InviteGrant | null {
	if (!isRecord(value)) return null;
	const code = textOf(value.code);
	const invite = textOf(value.invite);
	const state = parseHouseholdAnswer(value.state);
	if (code === null || !isCode(normalizeCode(code)) || invite === null || !state) return null;
	return { code, invite, state };
}

/** The membership of the signed-in account in `state`, as the rules see it. */
export function meOf(state: HouseholdState): Membership {
	return { id: state.me.member, role: state.me.role, rights: state.me.rights };
}

/** A member as the rules see it. */
export function membershipOf(member: HouseholdMember): Membership {
	return { id: member.id, role: member.role, rights: member.rights };
}

/** Name of a member on the page. */
export function memberLabel(member: Pick<HouseholdMember, 'name'>): string {
	return member.name.trim() === '' ? 'Konto ohne Namen' : member.name;
}

/** Words of the page and of the flags. */
export const HOUSEHOLD_TEXTS = {
	founded: (name: string) => `Haushalt „${name}“ gegründet.`,
	joined: (name: string) => `Du bist dem Haushalt „${name}“ beigetreten.`,
	left: (name: string) => `Du bist aus dem Haushalt „${name}“ ausgetreten.`,
	leftText: 'Deine Einträge im Haushalt bleiben dort.',
	lost: (name: string) => `Du bist nicht mehr Mitglied im Haushalt „${name}“.`,
	changed: 'Deine Mitgliedschaft im Haushalt hat sich geändert.',
	renamed: (name: string) => `Haushalt heißt jetzt „${name}“.`,
	rightsSaved: (label: string) => `Rechte von ${label} gespeichert.`,
	removed: (label: string) => `${label} ist nicht mehr im Haushalt.`,
	transferred: (label: string) => `${label} ist jetzt Inhaber des Haushalts.`,
	revoked: 'Code widerrufen.',
	codeTitle: 'Neuer Einladungscode',
	codeOnce:
		'Der Code wird nur jetzt angezeigt. Er gilt 7 Tage und einmal. Gib ihn auf einem sicheren Weg weiter.',
	leaveQuestion: (name: string) => `Aus dem Haushalt „${name}“ austreten?`,
	leaveText:
		'Deine Einträge im Haushalt bleiben dort, und du verlierst sofort den Zugriff auf alle Einträge des Haushalts.',
	removeQuestion: (label: string) => `${label} aus dem Haushalt entfernen?`,
	removeText: (label: string) =>
		`${label} verliert sofort den Zugriff auf alle Einträge des Haushalts. Was ${label} dort angelegt hat, bleibt im Haushalt.`,
	transferQuestion: (label: string) => `${label} zum Inhaber machen?`,
	transferText:
		'Du wirst Mitglied und behältst alle Rechte. Nur der neue Inhaber kann die Inhaberschaft danach weitergeben.',
	ownerLeave: HOUSEHOLD_PROBLEMS['owner-leave'] ?? '',
	rate: 'Zu viele Versuche. Bitte ein paar Minuten warten und dann erneut versuchen.',
	retentionTitle: 'Papierkorb im Haushalt',
	retentionText:
		'Tickets im Papierkorb des Haushalts werden nach dieser Zeit endgültig gelöscht. Dein privater Papierkorb behält seine eigene Einstellung unter „Tickets“.',
	retentionReadOnly: 'Ändern dürfen der Inhaber und Mitglieder mit dem Recht „Endgültig löschen“.',
	retentionSaved: (label: string) => `Papierkorb im Haushalt: ${label}.`
} as const;
