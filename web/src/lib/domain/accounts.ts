// Accounts and the administrator of the app (ADR-0056, E7-1): the answers of the routes of the page
// "Einstellungen → Konten" read strictly, the checks of the forms (the same rules and texts as
// app/pb_hooks/lib/account-rules.js, parity test) and the words of the pages "Konten" and "Konto".
// Pure: no SDK, no SvelteKit.

import type { SystemDenial } from './system';

/** One account of the list (only the administrator gets e-mail addresses of other accounts). */
export interface Account {
	id: string;
	name: string;
	email: string;
	/** Right "Verwalter der App". */
	admin: boolean;
	disabled: boolean;
	/** PocketBase time of creation, e.g. "2026-10-04 08:00:00.000Z". */
	created: string;
	/** The signed-in account itself. */
	self: boolean;
	/** The household this account owns (E7-4, ADR-0060 §6); left out when it owns none. */
	owns?: { id: string; name: string };
}

/** A member of a household without an active owner, by its membership. */
export interface OrphanMember {
	/** ID of the membership (the route names it). */
	id: string;
	user: string;
	name: string;
	disabled: boolean;
}

/**
 * A household whose owner is disabled or gone (E7-4, ADR-0060 §6): the administrator of the app makes
 * an active member its owner.
 */
export interface OrphanHousehold {
	id: string;
	name: string;
	/** The disabled owner, null when the account is gone. */
	owner: { id: string; name: string } | null;
	members: OrphanMember[];
}

export interface AccountList {
	accounts: Account[];
	/** Minimum length of a password of PocketBase. */
	passwordMin: number;
	/** Households without an active owner (since E7-4; empty before the restart). */
	households?: OrphanHousehold[];
}

/** What the routes answer for a new or reset password: the account and the password, once. */
export interface PasswordGrant {
	account: Account;
	password: string;
}

/** Maximum of a display name (lib/account-rules.js NAME_MAX). */
export const NAME_MAX = 100;
/** Minimum of a password in PocketBase 0.40.4 (the password field of users); the list sends it too. */
export const PASSWORD_MIN = 8;
/** Maximum of a password (bcrypt, PocketBase). */
export const PASSWORD_MAX = 71;

/** Texts of the refused inputs of the routes, the same as PROBLEMS of lib/account-rules.js. */
export const ACCOUNT_PROBLEMS: Readonly<Record<string, string>> = {
	email: 'Bitte eine gültige E-Mail-Adresse eingeben.',
	'email-taken': 'Für diese E-Mail-Adresse gibt es schon ein Konto.',
	name: 'Bitte einen Namen eingeben.',
	'name-long': `Höchstens ${NAME_MAX} Zeichen.`,
	format: 'Die Angabe fehlt.',
	'self-disable': 'Dein eigenes Konto kannst du nicht deaktivieren.',
	'self-admin': 'Dein eigenes Verwalter-Recht kann dir nur ein anderer Verwalter entziehen.',
	'self-password': 'Dein eigenes Passwort änderst du unter „Konto“.',
	'last-admin':
		'Mindestens ein aktives Konto muss Verwalter bleiben. Gib zuerst einem anderen Konto das Recht.',
	missing: 'Dieses Konto gibt es nicht.',
	'household-missing': 'Diesen Haushalt gibt es nicht mehr.',
	'owner-active':
		'Der Haushalt hat einen aktiven Inhaber. Den Inhaber wechselt nur er selbst auf der Seite „Haushalt“.',
	member: 'Dieses Mitglied gibt es im Haushalt nicht mehr.',
	'member-disabled': 'Ein deaktiviertes Konto kann nicht Inhaber werden.'
};

/** Validation codes of the Record API for users, the same as MESSAGES of lib/account-rules.js. */
export const ACCOUNT_MESSAGES: Readonly<Record<string, string>> = {
	validation_account_locked: 'Das ändert nur der Verwalter der App unter „Einstellungen → Konten“.',
	validation_account_last_admin: ACCOUNT_PROBLEMS['last-admin'] ?? '',
	validation_account_name: ACCOUNT_PROBLEMS.name ?? '',
	validation_account_name_max: ACCOUNT_PROBLEMS['name-long'] ?? ''
};

/** Text of a refused input, or a general one for a problem the page does not know. */
export function problemText(problem: string): string {
	return Object.hasOwn(ACCOUNT_PROBLEMS, problem)
		? (ACCOUNT_PROBLEMS[problem] ?? '')
		: 'Der Server hat die Eingabe abgelehnt.';
}

// eslint-disable-next-line no-control-regex -- the same rule as the hook: no control characters
const CONTROL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** '' for a valid display name, else the problem ('name' or 'name-long'), like the hook. */
export function nameProblem(value: string): '' | 'name' | 'name-long' {
	const name = value.trim();
	if (name === '' || CONTROL.test(name)) return 'name';
	return name.length > NAME_MAX ? 'name-long' : '';
}

/** '' for an e-mail address the route takes, else 'email', like the hook. */
export function emailProblem(value: string): '' | 'email' {
	const email = value.trim();
	return email.length > 254 || !EMAIL.test(email) ? 'email' : '';
}

/** Field errors of "Passwort ändern" before sending; empty when all is fine. */
export function passwordChangeProblems(
	input: { current: string; next: string; again: string },
	min: number = PASSWORD_MIN
): Partial<Record<'current' | 'next' | 'again', string>> {
	const problems: Partial<Record<'current' | 'next' | 'again', string>> = {};
	if (input.current === '') problems.current = 'Bitte das bisherige Passwort eingeben.';
	if (input.next.length < min) problems.next = `Mindestens ${min} Zeichen.`;
	else if (input.next.length > PASSWORD_MAX) problems.next = `Höchstens ${PASSWORD_MAX} Zeichen.`;
	else if (input.next === input.current) problems.next = 'Das neue Passwort ist das bisherige.';
	if (input.again !== input.next) problems.again = 'Die beiden neuen Passwörter sind verschieden.';
	return problems;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One account of an answer, or null for anything else. */
export function parseAccount(value: unknown): Account | null {
	if (!isRecord(value)) return null;
	const { id, name, email, admin, disabled, created, self } = value;
	if (
		typeof id !== 'string' ||
		id === '' ||
		typeof name !== 'string' ||
		typeof email !== 'string'
	) {
		return null;
	}
	if (typeof admin !== 'boolean' || typeof disabled !== 'boolean' || typeof self !== 'boolean') {
		return null;
	}
	const owns = namedRef(value.owns);
	return {
		id,
		name,
		email,
		admin,
		disabled,
		created: typeof created === 'string' ? created : '',
		self,
		...(owns !== null && { owns })
	};
}

/** `{ id, name }` of an answer, or null. */
function namedRef(value: unknown): { id: string; name: string } | null {
	if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') return null;
	return { id: value.id, name: typeof value.name === 'string' ? value.name : '' };
}

/** A household without an active owner of an answer, or null. */
function parseOrphan(value: unknown): OrphanHousehold | null {
	const household = namedRef(value);
	if (household === null || !isRecord(value) || !Array.isArray(value.members)) return null;
	const members: OrphanMember[] = [];
	for (const entry of value.members) {
		const member = namedRef(entry);
		if (member === null || !isRecord(entry) || typeof entry.user !== 'string') return null;
		members.push({ ...member, user: entry.user, disabled: entry.disabled === true });
	}
	return { ...household, owner: namedRef(value.owner), members };
}

/** The answer of GET /api/byl/accounts (and of a new owner of a household), or null. */
export function parseAccountList(value: unknown): AccountList | null {
	if (!isRecord(value) || !Array.isArray(value.accounts)) return null;
	const accounts: Account[] = [];
	for (const entry of value.accounts) {
		const account = parseAccount(entry);
		if (account === null) return null;
		accounts.push(account);
	}
	const households: OrphanHousehold[] = [];
	for (const entry of Array.isArray(value.households) ? value.households : []) {
		const household = parseOrphan(entry);
		if (household === null) return null;
		households.push(household);
	}
	const min = value.passwordMin;
	return {
		accounts,
		passwordMin: typeof min === 'number' && Number.isInteger(min) && min > 0 ? min : PASSWORD_MIN,
		households
	};
}

/** The answer of a new or reset password, or null. */
export function parsePasswordGrant(value: unknown): PasswordGrant | null {
	if (!isRecord(value) || typeof value.password !== 'string' || value.password === '') return null;
	const account = parseAccount(value.account);
	return account === null ? null : { account, password: value.password };
}

/** The answer of a switch ({ account }), or null. */
export function parseAccountAnswer(value: unknown): Account | null {
	return isRecord(value) ? parseAccount(value.account) : null;
}

/**
 * Whether the signed-in account may use the pages of the administrator (ADR-0056 §7): its record
 * says so. A record without the field comes from a server before the restart after the update;
 * then the server still decides by the account created first, so the pages stay listed and the
 * server answers for them.
 */
export function adminOf(record: unknown): boolean {
	if (!isRecord(record)) return false;
	if (!Object.hasOwn(record, 'instance_admin')) return true;
	return record.instance_admin === true;
}

/** How the list names an account: its name, else its e-mail address. */
export function accountLabel(account: Pick<Account, 'name' | 'email'>): string {
	return account.name.trim() === '' ? account.email : account.name;
}

/** What the page "Konten" says for a refusal of its routes. */
export function denialText(reason: SystemDenial): { title: string; text: string } {
	switch (reason) {
		case 'loopback':
			return {
				title: 'Nur auf dem Rechner der App',
				text: 'Konten verwaltest du nur im Browser auf dem Rechner, auf dem becauseyoulovejira läuft, nicht von einem anderen Gerät und nicht über einen Proxy.'
			};
		case 'origin':
			return {
				title: 'Nur unter der Adresse der App',
				text: 'Öffne die App unter ihrer eigenen Adresse auf diesem Rechner, etwa http://127.0.0.1:8090/, und versuche es dort erneut.'
			};
		case 'owner':
		case 'forbidden':
			return {
				title: 'Nur für den Verwalter der App',
				text: 'Konten legt nur ein Konto mit dem Recht „Verwalter der App“ an. Frag die Person, die becauseyoulovejira eingerichtet hat.'
			};
		case 'rate':
			return {
				title: 'Gerade zu viele Änderungen',
				text: 'Bitte eine Minute warten und dann erneut versuchen.'
			};
		default:
			return {
				title: 'Die Konten ließen sich nicht laden',
				text: 'Der Server hat nicht wie erwartet geantwortet. Bitte die Seite neu laden.'
			};
	}
}

/** Texts of the page "Konten" (questions, flags, the password shown once). */
export const ACCOUNTS_TEXTS = {
	createdTitle: (label: string) => `Konto für ${label} angelegt`,
	resetTitle: (label: string) => `Neues Passwort für ${label}`,
	passwordLabel: (label: string) => `Startpasswort für ${label}`,
	passwordOnce:
		'Das Passwort steht nur jetzt hier. Gib es der Person auf einem sicheren Weg weiter, etwa auf Papier oder im Passwort-Manager; sie ändert es danach unter „Einstellungen → Konto“. Vergessen? Dann „Passwort zurücksetzen …“.',
	resetQuestion: (label: string) => `Passwort von ${label} zurücksetzen?`,
	resetText:
		'Die App erzeugt ein neues Passwort und zeigt es einmal an. Das bisherige gilt nicht mehr, und alle Anmeldungen dieses Kontos enden sofort.',
	disableQuestion: (label: string) => `${label} deaktivieren?`,
	disableText:
		'Das Konto kann sich danach nicht mehr anmelden, und seine Anmeldungen enden sofort. Tickets, Kommentare und Verlauf bleiben. „Aktivieren“ macht das rückgängig.',
	disableOwnerText: (household: string) =>
		`Das Konto ist Inhaber des Haushalts „${household}“. Danach hat der Haushalt keinen aktiven Inhaber mehr; du bestimmst dann hier unter „Haushalte ohne aktiven Inhaber“ ein Mitglied als neuen Inhaber.`,
	ownerOf: (household: string) => `Inhaber von „${household}“`,
	orphansTitle: 'Haushalte ohne aktiven Inhaber',
	orphansText:
		'Der Inhaber dieser Haushalte ist deaktiviert oder gelöscht. Bestimme ein aktives Mitglied als neuen Inhaber; der bisherige bleibt Mitglied mit allen Rechten.',
	orphanOwner: (owner: string | null) =>
		owner === null ? 'Inhaber: gelöscht' : `Inhaber: ${owner} (deaktiviert)`,
	noMembers: 'Keine aktiven Mitglieder. Ohne Mitglied lässt sich kein neuer Inhaber bestimmen.',
	newOwnerLabel: 'Neuer Inhaber',
	newOwnerButton: 'Zum Inhaber machen …',
	newOwnerQuestion: (member: string, household: string) =>
		`${member} zum Inhaber von „${household}“ machen?`,
	newOwnerText:
		'Das Mitglied verwaltet den Haushalt danach mit allen Rechten. Der bisherige Inhaber bleibt Mitglied mit allen Rechten, solange er im Haushalt ist.',
	newOwnerDone: (member: string, household: string) =>
		`${member} ist jetzt Inhaber von „${household}“.`,
	revokeQuestion: (label: string) => `${label} das Verwalter-Recht entziehen?`,
	revokeText:
		'Das Konto sieht danach die Seiten Konten, Sicherheit, Sicherung, Speicher und System nicht mehr und richtet keine Kanäle mit Zugangsdaten mehr ein.',
	grantQuestion: (label: string) => `${label} zum Verwalter machen?`,
	grantText:
		'Das Konto darf danach Konten anlegen und ändern, die Seiten Sicherheit, Sicherung, Speicher und System nutzen und Kanäle mit den Zugangsdaten dieses Rechners einrichten.',
	disabled: (label: string) => `${label} ist deaktiviert.`,
	enabled: (label: string) => `${label} ist wieder aktiv.`,
	granted: (label: string) => `${label} ist jetzt Verwalter der App.`,
	revoked: (label: string) => `${label} ist nicht mehr Verwalter der App.`
} as const;
