// Access data of the channels set from the browser (BW-3, ADR-0075): the BYL_* variables in the
// Windows user environment of the PC (ADR-0018), with their state, "Setzen"/"Ersetzen" and
// "Entfernen" at every field of a channel that names one, and the hint until the next restart.
// Pure: the answers of GET /api/byl/credentials and of the hint, the check of a value before it is
// sent (the same as app/pb_hooks/lib/credential-rules.js, parity test
// tests/unit/web-credentials.test.mjs) and the texts. A value is never part of an answer, a state
// or a text here; only the component of the field holds it while it is typed.

import type { SystemDenial } from './system';

/** One variable of the state: set in the user environment (null while unknown), and who uses it. */
export interface CredentialVariable {
	name: string;
	/** Has a value in the Windows user environment; null when the server could not tell. */
	set: boolean | null;
	/** A name of the system (BYL_INGEST_TOKEN, BYL_TEST_…): never set from here. */
	blocked: boolean;
	/** Names of the connections of the instance that use it (for the question of "Entfernen"). */
	channels: string[];
}

export interface CredentialStatus {
	variables: CredentialVariable[];
	/** A change of access data waits for a restart (the hint, kept by the server). */
	restartNeeded: boolean;
}

/** Problems of a request the server answers with 400, in its words (MESSAGES of the hook). */
export const CREDENTIAL_PROBLEMS = [
	'invalid',
	'name',
	'blocked',
	'unknown',
	'empty',
	'control',
	'long',
	'write'
] as const;
export type CredentialProblem = (typeof CREDENTIAL_PROBLEMS)[number];

/** At most this many characters (UTF-16 code units, as the server counts). */
export const CREDENTIAL_VALUE_MAX = 4096;

/**
 * Texts of the problems, word for word those of the hook (MESSAGES in
 * app/pb_hooks/lib/credential-rules.js, parity test). Each names at most the variable.
 */
export const CREDENTIAL_MESSAGES: Readonly<Record<CredentialProblem, string>> = Object.freeze({
	invalid: 'Die Anfrage ist unvollständig.',
	name: 'Nur BYL_ mit Großbuchstaben, Ziffern und _ (höchstens 64 Zeichen).',
	blocked: 'Diese Variable steuert die App selbst und lässt sich hier nicht setzen.',
	unknown: 'Diese Variable nennt kein Kanal dieser App.',
	empty: 'Bitte einen Wert eingeben. Zum Leeren dient „Entfernen“.',
	control: 'Der Wert enthält Steuerzeichen (etwa einen Zeilenumbruch); bitte ohne sie einfügen.',
	long: `Der Wert ist zu lang (höchstens ${CREDENTIAL_VALUE_MAX} Zeichen).`,
	write: 'Windows hat die Variable nicht gespeichert.'
});

// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Why `value` may not be sent, null if it may: empty (also only white space), control characters,
 * too long. The server checks the same; the field says it before a request.
 */
export function credentialValueProblem(value: string): CredentialProblem | null {
	if (value.trim() === '') return 'empty';
	if (CONTROL.test(value)) return 'control';
	return value.length > CREDENTIAL_VALUE_MAX ? 'long' : null;
}

/** Whether `value` begins or ends with white space: kept as it is, but the field warns (S8). */
export function hasOuterSpace(value: string): boolean {
	return value !== '' && value.trim() !== value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const NAME = /^BYL_[A-Z0-9_]{1,60}$/;

/** The answer of GET /api/byl/credentials, or null for anything that is not exactly that. */
export function parseCredentialStatus(answer: unknown): CredentialStatus | null {
	if (!isRecord(answer) || !Array.isArray(answer.variables)) return null;
	const variables: CredentialVariable[] = [];
	for (const entry of answer.variables) {
		if (!isRecord(entry) || typeof entry.name !== 'string' || !NAME.test(entry.name)) return null;
		const channels = Array.isArray(entry.channels)
			? entry.channels.filter((label): label is string => typeof label === 'string')
			: [];
		variables.push({
			name: entry.name,
			set: typeof entry.set === 'boolean' ? entry.set : null,
			blocked: entry.blocked === true,
			channels
		});
	}
	return { variables, restartNeeded: answer.restartNeeded === true };
}

/** The problem of a 400 answer of set or remove; 'invalid' for one the app does not know. */
export function credentialProblemOf(answer: unknown): CredentialProblem {
	const problem = isRecord(answer) ? answer.problem : undefined;
	return typeof problem === 'string' && (CREDENTIAL_PROBLEMS as readonly string[]).includes(problem)
		? (problem as CredentialProblem)
		: 'invalid';
}

/** "Nur am PC möglich" (V5): the actions on another device and instead of a state it cannot read. */
export const PC_ONLY = 'Nur am PC möglich';

/** The note below the disabled actions on another device, with the address of the app there. */
export function pcOnlyNote(localUrl: string | null): string {
	return localUrl === null
		? `${PC_ONLY}: im Browser auf dem PC, auf dem becauseyoulovejira läuft.`
		: `${PC_ONLY}: im Browser auf dem PC über ${localUrl} öffnen.`;
}

/** Texts of the fields, the questions and the hint. */
export const CREDENTIAL_TEXTS = {
	heading: 'Zugangsdaten',
	set: 'gesetzt',
	missing: 'fehlt',
	unknown: 'unbekannt',
	loading: 'wird geprüft …',
	blocked: 'gehört der App',
	setAction: 'Setzen …',
	replaceAction: 'Ersetzen …',
	removeAction: 'Entfernen …',
	save: 'Speichern',
	saving: 'Wird gespeichert …',
	cancel: 'Abbrechen',
	valueLabel: (name: string) => `Neuer Wert für ${name}`,
	valueHint:
		'Der Wert geht nur an Windows auf dem PC. Die App speichert ihn nicht und zeigt ihn nie wieder an.',
	outerSpace:
		'Der Wert beginnt oder endet mit einem Leerzeichen. Windows speichert ihn genau so; die Kanäle lesen ihn ohne die Leerzeichen am Rand. Meist ist das ein Versehen beim Kopieren.',
	removeTitle: (name: string) => `${name} entfernen?`,
	removeUsedBy: (channels: readonly string[]) =>
		channels.length === 1
			? `Diesen Kanal betrifft das: ${channels[0]}.`
			: `Diese Kanäle betrifft das: ${channels.join(', ')}.`,
	removeUnused: 'Kein Kanal dieser App verwendet die Variable.',
	removeEffect:
		'Windows löscht die Variable aus deinem Konto. Ein Kanal, der sie braucht, ruft nach einem Neustart nichts mehr ab.',
	removeConfirm: 'Entfernen',
	setDone: (name: string) => `${name} ist gesetzt.`,
	removeDone: (name: string) => `${name} ist entfernt.`,
	restartTitle: 'Jetzt neu starten?',
	restartText:
		'Die App sieht geänderte Zugangsdaten erst nach einem Neustart. „Jetzt neu starten“ startet sie geordnet neu, wie auf der Seite „Einstellungen → System“.',
	restartNow: 'Jetzt neu starten',
	restartLater: 'Später',
	restartHint:
		'Startet becauseyoulovejira geordnet neu, wie auf der Seite „System“. Danach wirken die geänderten Zugangsdaten.',
	pendingRestartTitle: 'Neustart nötig',
	pendingRestart: 'Neustart nötig, damit geänderte Zugangsdaten wirken.',
	offline:
		'Verbindung unterbrochen – ob die Änderung angekommen ist, ist unklar. Im Browser wurde nichts gespeichert. Der Zustand wird nach dem Wiederverbinden neu geladen.',
	emergency:
		'Notfall: Geht das hier nicht, setzt du die Variable am PC wie bisher mit setx in der Eingabeaufforderung (Befehl im Einrichtungsassistenten unter „Notfall“; setx kürzt Werte über 1024 Zeichen) und startest die App mit neu-starten.bat im Ordner app neu.',
	setupEmergencySummary: 'Notfall: Variable über Windows setzen'
} as const;

/** What a refusal of the routes means at a field; the texts name no script (the user's rule). */
export const CREDENTIAL_DENIAL_TEXTS: Readonly<Partial<Record<SystemDenial, string>>> = {
	loopback: `${PC_ONLY}: Zugangsdaten setzt du nur im Browser auf dem PC, auf dem becauseyoulovejira läuft.`,
	origin: 'Nur unter der Adresse der App auf dem PC, etwa http://127.0.0.1:8090/.',
	owner: 'Zugangsdaten setzt nur der Verwalter der App.',
	platform:
		'Auf diesem Server nicht verfügbar: Zugangsdaten setzt die App nur auf einem PC mit Windows.',
	// Reading the state and changing a value have their own windows; the text fits both.
	rate: 'Zu viele Anfragen in kurzer Zeit. Warte eine Minute und versuche es dann erneut.',
	unavailable:
		'Dieser Server lässt sich nicht aus der App steuern, etwa eine Test- oder Entwicklungsinstanz.',
	// A restart or another action of the page System (one at a time, ADR-0075 §5).
	busy: 'Gerade läuft ein Neustart oder eine andere Aktion der Seite „System“. Warte, bis sie fertig ist, und versuche es dann erneut.',
	script:
		'Das Steuerskript hat nicht wie erwartet geantwortet. Versuche es erneut; die Seite „Einstellungen → System“ zeigt den Zustand und die Logs.',
	missing: 'Der Server kennt diese Funktion erst nach einem Neustart.',
	forbidden: 'Mit diesem Konto nicht möglich.',
	unknown: 'Diese Aktion gibt es nicht.'
};

/** The text of a refusal at a field. */
export function credentialDenialText(reason: SystemDenial): string {
	return CREDENTIAL_DENIAL_TEXTS[reason] ?? CREDENTIAL_DENIAL_TEXTS.script ?? '';
}
