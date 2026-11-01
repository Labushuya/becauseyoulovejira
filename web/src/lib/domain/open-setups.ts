// Open setups (KE-1, ADR-0076): which begun setup of the account still has an open mandatory step.
// The cards (`channelHealth`), the overview "N Einrichtungen offen" on the page "Kanäle", the mark
// at "Kanäle" in the navigation and the quiet hint when the app opens all read it from here, and
// here it comes from the one rule of the assistant (`requiredOpenStep` in channel-setup.ts). Pure:
// the open step per connection, the own inbox and WhatsApp Web, the texts, the list and the
// fingerprint of the state that the hint remembers per device.
//
// Begun means: a connection exists (a setup before its connection shows only at its tile of the
// catalog, in the same tab, through setup-resume.ts), and for the own inbox and WhatsApp Web a key
// exists. Never open: a paused connection, a connection that ran well once and fails now (that is
// "Fehler" of the card), GitHub without its optional token, the target project and the keywords.
// Where the user environment of the PC is known (BW-3), a variable that is set there but not seen
// by the running server "waits for the restart"; where it is not known, the texts say both.

import {
	requiredOpenStep,
	setupComplete,
	setupKindOf,
	setupSteps,
	stepCheck,
	storedState,
	type SetupFacts,
	type SetupKind,
	type SetupStep,
	type SetupStepId,
	type StepCheck,
	type StoredSecrets
} from './channel-setup';
import { secretStatusText, type Connection, type SecretStatus } from './connections';
import type { InboxKey } from './inbox-keys';
import { WHATSAPP_WEB_STEPS } from './whatsapp-web';

/** Why a setup is open. */
export type OpenSetupReason =
	/** The server does not see a variable, and the user environment of the PC has none. */
	| 'secret-missing'
	/** The server does not see a variable that the user environment of the PC has: restart. */
	| 'secret-restart'
	/** The server does not see a variable; whether it is set on the PC is not known here. */
	| 'secret-unknown'
	/** GitHub without a repository (and without "Alle meine Repositorys"). */
	| 'repository'
	/** A folder connection without a folder. */
	| 'folder'
	/** Telegram: no run yet, or a run reported a chat that is not allowed. */
	| 'chat'
	| 'first-run'
	/** The first run failed, and no run went well before. */
	| 'first-run-failed'
	/** Notion or GitHub: "Verbindung prüfen" did not run yet. */
	| 'check'
	| 'check-failed'
	/** Notion answered, but the integration sees no page yet. */
	| 'share'
	/** The own inbox: keys exist, but no program used one. */
	| 'key-unused'
	/** WhatsApp Web: a key exists, but the extension is not built. */
	| 'extension';

/** The open step of an assistant: its place among the steps and its label. */
export interface OpenSetupStep {
	index: number;
	total: number;
	id: string;
	label: string;
}

export interface OpenSetup {
	reason: OpenSetupReason;
	/** The open step of the assistant; null for the own inbox, which has no assistant. */
	step: OpenSetupStep | null;
	/** The step needs the PC (a variable, a token, a restart, the chat, the extension). */
	pcOnly: boolean;
	/** The check line of the assistant at that step (the same words); null for the access data. */
	check: StepCheck | null;
}

/** What `openSetupOf` reads of a connection: the facts of the assistant and whether it runs. */
export type OpenSetupConnection = NonNullable<SetupFacts['connection']> &
	Pick<Connection, 'enabled'>;

export interface OpenSetupFacts {
	connection: OpenSetupConnection;
	/** Environment of the running server; null while unknown (then the variables count as seen). */
	secretStatus: SecretStatus | null;
	/** User environment of the PC; null or absent where the tab cannot read it. */
	stored?: StoredSecrets | null;
}

/** Steps that need the machine of the app (M3 of KE-1): the texts at other devices say so. */
const PC_STEPS: readonly string[] = ['variable', 'token', 'restart', 'chat'];

export function isSecretReason(reason: OpenSetupReason): boolean {
	return reason === 'secret-missing' || reason === 'secret-restart' || reason === 'secret-unknown';
}

/** The checked step whose fact decides step `index`: itself, or the next checked one. */
function decidingStep(steps: readonly SetupStep[], index: number): SetupStepId | null {
	const step = steps[index];
	if (step === undefined) return null;
	if (step.checked) return step.id;
	return steps.find((entry, at) => at > index && entry.checked)?.id ?? null;
}

function reasonOf(kind: SetupKind, index: number, facts: SetupFacts): OpenSetupReason {
	const steps = setupSteps(kind);
	const connection = facts.connection;
	const restart = steps.findIndex((step) => step.id === 'restart');
	const seen =
		connection === null || secretStatusText(connection, facts.secretStatus)?.ok !== false;
	if (kind !== 'github' && restart !== -1 && index <= restart && !seen) {
		const stored = storedState(kind, facts);
		if (stored === 'set') return 'secret-restart';
		return stored === 'missing' ? 'secret-missing' : 'secret-unknown';
	}
	const failed = connection !== null && connection.lastError !== '';
	switch (decidingStep(steps, index)) {
		case 'connect':
			// With a connection "Verbinden" holds for every kind but GitHub and folders.
			return kind === 'github' ? 'repository' : 'folder';
		case 'chat':
			return 'chat';
		case 'check':
			if (failed) return 'check-failed';
			return kind === 'notion' &&
				connection !== null &&
				connection.lastOkAt !== null &&
				connection.lastHint !== ''
				? 'share'
				: 'check';
		default:
			return failed ? 'first-run-failed' : 'first-run';
	}
}

/**
 * The open step of the setup of a connection, or null when it is done or does not count (ADR-0076
 * §1): paused, or it ran well once and fails now. An unknown state of the variables (the request
 * failed) counts as seen, like the card skips its check; the assistant names it in its step.
 */
export function openSetupOf(kind: SetupKind, facts: OpenSetupFacts): OpenSetup | null {
	const { connection } = facts;
	if (!connection.enabled) return null;
	const assumed: SecretStatus | null =
		kind === 'ordner' ? null : { secret: true, allowlist: kind === 'telegram' ? true : null };
	const known: SetupFacts = {
		connection,
		secretStatus: facts.secretStatus ?? assumed,
		stored: facts.stored ?? null
	};
	const index = requiredOpenStep(kind, known);
	const steps = setupSteps(kind);
	const step = steps[index];
	if (index === -1 || step === undefined) return null;
	const reason = reasonOf(kind, index, known);
	const secret = isSecretReason(reason);
	if (!secret && connection.lastError !== '' && connection.lastOkAt !== null) return null;
	const deciding = decidingStep(steps, index);
	return {
		reason,
		step: { index, total: steps.length, id: step.id, label: step.label },
		pcOnly: secret || PC_STEPS.includes(step.id),
		check: secret || deciding === null ? null : stepCheck(kind, deciding, known)
	};
}

/** The own inbox (ADR-0038): open once keys exist and no program has used one of them. */
export function ownInboxOpen(
	keys: readonly Pick<InboxKey, 'lastUsedAt'>[] | null
): OpenSetup | null {
	if (keys === null || keys.length === 0 || keys.some((key) => key.lastUsedAt !== null)) {
		return null;
	}
	return { reason: 'key-unused', step: null, pcOnly: false, check: null };
}

/**
 * WhatsApp Web (ADR-0038 §4): open once a key exists and the extension is not built. The app does
 * not see the extension in the browser, so nothing else counts (null: not known or not open).
 */
export function whatsAppWebOpen(keyCount: number | null, built: boolean | null): OpenSetup | null {
	if (keyCount === null || keyCount === 0 || built !== false) return null;
	const index = WHATSAPP_WEB_STEPS.findIndex((step) => step.id === 'load');
	const step = WHATSAPP_WEB_STEPS[index];
	if (step === undefined) return null;
	return {
		reason: 'extension',
		step: { index, total: WHATSAPP_WEB_STEPS.length, id: step.id, label: step.label },
		pcOnly: true,
		check: null
	};
}

/** Where "Fortsetzen" leads: the assistant of a kind (with its connection), or the card of the own inbox. */
export type OpenSetupTarget = { kind: SetupKind; connectionId: string | null } | 'own-inbox';

export interface OpenSetupEntry {
	/** The connection ID, OWN_INBOX_KEY or WHATSAPP_WEB_KEY. */
	key: string;
	/** The name the card shows. */
	name: string;
	/** The kind of the assistant; null for the own inbox. */
	kind: SetupKind | null;
	open: OpenSetup;
	target: OpenSetupTarget;
}

export const OWN_INBOX_KEY = 'eigener-eingang';
export const WHATSAPP_WEB_KEY = 'whatsapp-web';
/** ID of the card of the own inbox on the page "Kanäle", the target of "Zur Karte". */
export const OWN_INBOX_ANCHOR = 'karte-eigener-eingang';

/** What the list of the open setups is made of; the stores of the page or of the layout fill it. */
export interface OpenSetupsSource {
	/** The own connections of the account, in the order of the page. */
	connections: readonly Connection[];
	/** Environment of the running server per connection; null while unknown. */
	status: (id: string) => SecretStatus | null;
	/** User environment of the PC per connection, where the tab reads it. */
	stored?: (connection: Connection) => StoredSecrets | null;
	/** Keys of the own inbox; null while unknown or before its migration. */
	keys: readonly Pick<InboxKey, 'lastUsedAt'>[] | null;
	/** The extension for WhatsApp Web is built; null while unknown. */
	extensionBuilt: boolean | null;
}

/** Every open setup, in the order of the page: the connections, then the own inbox, then WhatsApp Web. */
export function openSetupsOf(source: OpenSetupsSource): OpenSetupEntry[] {
	const entries: OpenSetupEntry[] = [];
	for (const connection of source.connections) {
		const kind = setupKindOf(connection);
		const open = openSetupOf(kind, {
			connection,
			secretStatus: source.status(connection.id),
			stored: source.stored?.(connection) ?? null
		});
		if (open === null) continue;
		entries.push({
			key: connection.id,
			name: connection.label,
			kind,
			open,
			target: { kind, connectionId: connection.id }
		});
	}
	const own = ownInboxOpen(source.keys);
	if (own !== null) {
		entries.push({
			key: OWN_INBOX_KEY,
			name: OPEN_SETUP_TEXTS.ownInbox,
			kind: null,
			open: own,
			target: 'own-inbox'
		});
	}
	const whatsapp = whatsAppWebOpen(source.keys?.length ?? null, source.extensionBuilt);
	if (whatsapp !== null) {
		entries.push({
			key: WHATSAPP_WEB_KEY,
			name: OPEN_SETUP_TEXTS.whatsappWeb,
			kind: 'whatsapp-web',
			open: whatsapp,
			target: { kind: 'whatsapp-web', connectionId: null }
		});
	}
	return entries;
}

/**
 * Whether a setup of the account is done (ADR-0076 §6, "Erste Schritte"): a connection whose
 * mandatory steps are all done (`setupComplete`, the rule of the assistant; paused counts), or a
 * key of the own inbox that a program used. A connection alone is not enough.
 */
export function anySetupDone(
	source: Pick<OpenSetupsSource, 'connections' | 'status' | 'stored' | 'keys'>
): boolean {
	const connected = source.connections.some((connection) =>
		setupComplete(setupKindOf(connection), {
			connection,
			secretStatus: source.status(connection.id),
			stored: source.stored?.(connection) ?? null
		})
	);
	return connected || (source.keys?.some((key) => key.lastUsedAt !== null) ?? false);
}

/**
 * The state of the open setups as one text (ADR-0076 §3): the account and, per entry, its key and
 * the kind of its open step. Whether a variable is missing or waits for the restart is the same
 * state, so a PC and a phone, which know that differently, count the same. IDs only, no names.
 */
export function openSetupsFingerprint(account: string, entries: readonly OpenSetupEntry[]): string {
	const parts = entries
		.map(
			(entry) => `${entry.key}:${isSecretReason(entry.open.reason) ? 'secret' : entry.open.reason}`
		)
		.sort();
	return `${account}|${parts.join(',')}`;
}

export const OPEN_SETUP_TEXTS = Object.freeze({
	/** Title of the overview, the name of the mark. */
	count: (count: number) => (count === 1 ? '1 Einrichtung offen' : `${count} Einrichtungen offen`),
	/** Title of the hint when the app opens. */
	flagTitle: (count: number) =>
		count === 1 ? '1 Einrichtung ist offen.' : `${count} Einrichtungen sind offen.`,
	look: 'Ansehen',
	resume: 'Fortsetzen',
	toCard: 'Zur Karte',
	atPc: 'am PC fortsetzen',
	intro:
		'Begonnen, aber noch nicht fertig. „Fortsetzen“ öffnet den Assistenten beim offenen Schritt.',
	begun: 'Begonnen',
	ownInbox: 'Eigener Eingang (API)',
	whatsappWeb: 'WhatsApp Web',
	/** GitHub: the token waits for the restart; until then only public repositories. */
	tokenWaits:
		'Wartet auf Neustart: Der Token ist gesetzt; bis zum Neustart liest die App nur öffentliche Repositorys.'
});

/** The variables the running server does not see, e.g. "BYL_TELEGRAM_TOKEN und BYL_TELEGRAM_ALLOWED_IDS". */
function unseenNames(
	connection: Pick<Connection, 'secretEnv' | 'allowlistEnv'>,
	status: SecretStatus | null
): string[] {
	if (status === null) return [connection.secretEnv];
	return [
		status.secret ? null : connection.secretEnv,
		status.allowlist === false ? connection.allowlistEnv : null
	].filter((name): name is string => name !== null && name !== '');
}

/** What is open, in a few words, e.g. "Wartet auf Neustart" or "Erster Abruf steht aus". */
export function openSetupSummary(kind: SetupKind | null, open: OpenSetup): string {
	switch (open.reason) {
		case 'secret-missing':
			return 'Zugangsdaten fehlen';
		case 'secret-restart':
			return 'Wartet auf Neustart';
		case 'secret-unknown':
			return 'Zugangsdaten fehlen oder warten auf Neustart';
		case 'repository':
			return 'Noch kein Repository';
		case 'folder':
			return 'Noch kein Ordner';
		case 'chat':
			return 'Chat noch nicht freigegeben';
		case 'first-run':
			if (kind === 'ordner') return 'Erste Prüfung steht aus';
			return kind === 'webde' || kind === 'gmail'
				? 'Wartet auf den ersten Abruf'
				: 'Erster Abruf steht aus';
		case 'first-run-failed':
			return kind === 'ordner' ? 'Erste Prüfung fehlgeschlagen' : 'Erster Abruf fehlgeschlagen';
		case 'check':
			return 'Noch nicht geprüft';
		case 'check-failed':
			return 'Prüfung fehlgeschlagen';
		case 'share':
			return 'Noch keine Seite freigegeben';
		case 'key-unused':
			return 'Noch kein Programm hat einen Schlüssel benutzt';
		case 'extension':
			return 'Erweiterung fehlt noch';
	}
}

/** The line of an entry of the overview, e.g. "Schritt 5 von 7: Wartet auf Neustart". */
export function openSetupLine(entry: Pick<OpenSetupEntry, 'kind' | 'open'>): string {
	const what = openSetupSummary(entry.kind, entry.open);
	const { step } = entry.open;
	return step === null ? what : `Schritt ${step.index + 1} von ${step.total}: ${what}`;
}

/** Whether the overview of this tab says "am PC fortsetzen" (another device of the administrator). */
export function continuesAtPc(open: OpenSetup, remote: boolean): boolean {
	return remote && open.pcOnly;
}

/**
 * The hint of the card of an open setup (ADR-0076 §2): the access data in the words of M1 (missing
 * as before, waiting for the restart, or both where it is not known), every other step as „Offener
 * Schritt „‹Label›“: …“ with the check line of the assistant.
 */
export function openSetupHint(
	open: OpenSetup,
	connection: Pick<Connection, 'secretEnv' | 'allowlistEnv'>,
	status: SecretStatus | null,
	remote: boolean
): { tone: 'info' | 'warning' | 'error'; text: string } {
	const names = unseenNames(connection, status);
	const listed = names.join(' und ');
	switch (open.reason) {
		case 'secret-missing':
			return {
				tone: 'warning',
				text: secretStatusText(connection, status)?.text ?? `Zugangsdaten fehlen: ${listed}.`
			};
		case 'secret-restart':
			return {
				tone: 'info',
				text:
					names.length > 1
						? `Wartet auf Neustart: ${listed} sind gesetzt, die App sieht sie erst nach einem Neustart.`
						: `Wartet auf Neustart: ${listed} ist gesetzt, die App sieht die Variable erst nach einem Neustart.`
			};
		case 'secret-unknown':
			return {
				tone: 'warning',
				text: remote
					? `Zugangsdaten fehlen oder warten auf Neustart – am PC prüfen (${listed}).`
					: `Zugangsdaten fehlen oder warten auf Neustart: Die App sieht ${listed} noch nicht.`
			};
		default: {
			const label = open.step === null ? '' : ` „${open.step.label}“`;
			const check = open.check;
			const tone =
				check?.tone === 'error' ? 'error' : check?.tone === 'warning' ? 'warning' : 'info';
			return {
				tone,
				text: `Offener Schritt${label}: ${check?.text ?? openSetupSummary(null, open)}`
			};
		}
	}
}

/** The prefix of the hint of an error on an open setup, e.g. „Offener Schritt „Erster Abruf“ – “. */
export function openStepPrefix(open: OpenSetup | null): string {
	return open === null || open.step === null ? '' : `Offener Schritt „${open.step.label}“ – `;
}

/** Up to three names, then the rest as a number: „Kalender, Bot und 2 weitere“. */
export function namesText(names: readonly string[]): string {
	const quoted = names.map((name) => `„${name}“`);
	if (quoted.length <= 3) {
		return quoted.length <= 1
			? (quoted[0] ?? '')
			: `${quoted.slice(0, -1).join(', ')} und ${quoted.at(-1)}`;
	}
	return `${quoted.slice(0, 3).join(', ')} und ${quoted.length - 3} weitere`;
}
