// Setup assistant of the channels (ADR-0026 section 4, plan EH-5 and §3.7/§3.8). Pure: the steps
// per service (labels of one or two words, texts, fixed https links of the providers, commands
// with their placeholders) and the progress, which comes from facts of the server, never from a
// stored step: the connection, whether the server sees the variable, the keywords and the last
// run. So after "stop.bat, dann start.bat" the assistant opens at the right step, also in a new
// tab. Which step was looked at last is only a hint of the session (the component keeps it).
// Stand der Klickwege: 2026-09.

import type { Connection, SecretStatus } from './connections';
import { NO_KEYWORDS_WARNING } from './connections';
import { formatBerlinDateTime } from './format';

/** Kinds of the address `?einrichten=<art>` (the IDs of the catalog). */
export const SETUP_KINDS = ['kalender', 'telegram', 'webde', 'gmail', 'proton'] as const;
export type SetupKind = (typeof SETUP_KINDS)[number];

/** Kinds that already have an assistant; the others keep their folded guide for now. */
export const ASSISTED_KINDS: readonly SetupKind[] = ['kalender'];

export function isSetupKind(value: unknown): value is SetupKind {
	return typeof value === 'string' && (SETUP_KINDS as readonly string[]).includes(value);
}

/** Query parameters of the assistant on the page "Kanäle". */
export const SETUP_PARAMS = Object.freeze({
	kind: 'einrichten',
	connection: 'verbindung'
} as const);

const RECORD_ID = /^[a-z0-9]{15}$/;

/** The assistant in the address: its kind and, once created, its connection. */
export interface SetupTarget {
	kind: SetupKind;
	connectionId: string | null;
}

/** Kind and connection of the address; an unknown kind means no assistant, a bad ID no connection. */
export function setupTargetOf(params: URLSearchParams): SetupTarget | null {
	const kinds = params.getAll(SETUP_PARAMS.kind);
	const kind = kinds.length === 1 ? kinds[0] : null;
	if (!isSetupKind(kind)) return null;
	const ids = params.getAll(SETUP_PARAMS.connection);
	const id = ids.length === 1 ? (ids[0] ?? '') : '';
	return { kind, connectionId: RECORD_ID.test(id) ? id : null };
}

/** Connection type and provider behind a kind of the assistant. */
export function connectionTypeOf(kind: SetupKind): {
	type: Connection['type'];
	provider: 'webde' | 'gmail' | '';
} {
	if (kind === 'kalender') return { type: 'calendar', provider: '' };
	if (kind === 'telegram') return { type: 'telegram', provider: '' };
	if (kind === 'gmail') return { type: 'mail', provider: 'gmail' };
	return { type: 'mail', provider: 'webde' };
}

/** Whether a connection belongs to the kind of the assistant. */
export function matchesSetupKind(
	connection: Pick<Connection, 'type' | 'mailProvider'>,
	kind: SetupKind
): boolean {
	const { type, provider } = connectionTypeOf(kind);
	if (connection.type !== type) return false;
	return type !== 'mail' || connection.mailProvider === provider;
}

/** The kind of the assistant for a connection (the setup of its card). */
export function setupKindOf(connection: Pick<Connection, 'type' | 'mailProvider'>): SetupKind {
	if (connection.type === 'calendar') return 'kalender';
	if (connection.type === 'telegram') return 'telegram';
	return connection.mailProvider === 'gmail' ? 'gmail' : 'webde';
}

export type SetupStepId = 'connect' | 'address' | 'variable' | 'restart' | 'keywords' | 'first-run';

/** A placeholder of a command; secret values are masked in the display. */
export interface SetupPlaceholder {
	label: string;
	secret: boolean;
}

export interface SetupCommand {
	/** Caption of the code block, e.g. "Befehl für die Eingabeaufforderung". */
	label: string;
	/** Command with placeholders as {{name}}; `{{variable}}` is the name of the connection's variable. */
	template: string;
	placeholders: Readonly<Record<string, SetupPlaceholder>>;
	/** The placeholder the field "Wert hier einsetzen" fills, if any. */
	value?: string;
	copyable: boolean;
}

export interface SetupLink {
	href: string;
	/** Visible text; names the domain where that helps. */
	text: string;
}

export interface SetupStep {
	id: SetupStepId;
	/** Label in the stepper: one or two words (ADS progress tracker). */
	label: string;
	/** Heading of the step. */
	title: string;
	/** At most two sentences. */
	intro: string;
	/** Numbered actions in the order of the provider's pages. */
	actions: readonly string[];
	links: readonly SetupLink[];
	commands: readonly SetupCommand[];
	/** Special cases under "Mehr dazu". */
	more: readonly string[];
	/** Whether the step has a check line (the others cannot be seen by the app). */
	checked: boolean;
}

/** The variable in the commands: the name the connection uses. */
export const VARIABLE_PLACEHOLDER = 'variable';

const CALENDAR_STEPS: readonly SetupStep[] = [
	{
		id: 'connect',
		label: 'Verbinden',
		title: 'Verbindung anlegen',
		intro:
			'Gib der Verbindung einen Namen. Die App speichert nur den Namen der Windows-Variablen, nie die Adresse selbst.',
		actions: [],
		links: [],
		commands: [],
		more: [],
		checked: true
	},
	{
		id: 'address',
		label: 'Adresse holen',
		title: 'Geheime iCal-Adresse holen',
		intro:
			'Die App liest deinen Kalender über seine private iCal-Adresse. An Google ändert sie nichts.',
		actions: [
			'Google Calendar im Browser öffnen.',
			'Links unter „Meine Kalender“ beim gewünschten Kalender auf die drei Punkte ⋮ und dann „Einstellungen und Freigabe“ klicken.',
			'Ganz unten unter „Kalender integrieren“ die „Privatadresse im iCal-Format“ mit dem Symbol daneben kopieren.'
		],
		links: [{ href: 'https://calendar.google.com', text: 'calendar.google.com' }],
		commands: [],
		more: [
			'Die Adresse beginnt mit https://calendar.google.com/calendar/ical/ und endet auf /basic.ics.',
			'Wer die Adresse kennt, liest den ganzen Kalender. Gib sie nicht weiter.',
			'Widerrufen: in denselben Einstellungen bei „Privatadresse im iCal-Format“ auf „Zurücksetzen“, dann die neue Adresse als Variable setzen und die App neu starten.'
		],
		checked: false
	},
	{
		id: 'variable',
		label: 'Variable setzen',
		title: 'Adresse als Windows-Variable setzen',
		intro:
			'Die Adresse kommt in eine Variable deines Windows-Kontos; die App liest sie nur beim Start.',
		actions: [],
		links: [],
		commands: [
			{
				label: 'Befehl für die Eingabeaufforderung',
				template: 'setx {{variable}} "{{wert}}"',
				placeholders: {
					variable: { label: 'Variable', secret: false },
					wert: { label: 'iCal-Adresse', secret: true }
				},
				value: 'wert',
				copyable: true
			}
		],
		more: [
			'Die Eingabeaufforderung öffnest du mit der Windows-Taste, „cmd“ und Enter; einfügen mit Rechtsklick.',
			'Der Befehl bleibt im Verlauf dieses Fensters, bis du es schließt.'
		],
		checked: false
	},
	{
		id: 'restart',
		label: 'Neu starten',
		title: 'App neu starten',
		intro:
			'Die App sieht neue Variablen erst nach einem Neustart. Im Ordner app erst stop.bat, dann start.bat per Doppelklick starten.',
		actions: [],
		links: [],
		commands: [
			{
				label: 'Erst diese Datei',
				template: 'app\\stop.bat',
				placeholders: {},
				copyable: false
			},
			{
				label: 'Dann diese Datei',
				template: 'app\\start.bat',
				placeholders: {},
				copyable: false
			}
		],
		more: [
			'Vor dem Neustart kann die App nicht unterscheiden, ob die Variable fehlt oder nur noch nicht geladen ist.'
		],
		checked: true
	},
	{
		id: 'keywords',
		label: 'Stichwörter',
		title: 'Stichwörter festlegen',
		intro:
			'In den Eingang kommen nur Termine, deren Titel oder Beschreibung ein Stichwort enthält. „Vorschläge übernehmen“ ist ein guter Anfang.',
		actions: [],
		links: [],
		commands: [],
		more: [],
		checked: true
	},
	{
		id: 'first-run',
		label: 'Erster Abruf',
		title: 'Ersten Abruf starten',
		intro:
			'„Jetzt abrufen“ holt Termine von heute bis 30 Tage im Voraus. Danach ruft die App alle 15 Minuten ab, solange sie läuft.',
		actions: [],
		links: [],
		commands: [],
		more: [
			'Ein Termin kommt nur einmal in den Eingang, auch wenn du ihn zusätzlich als .ics-Datei hereinziehst.',
			'Ändert sich ein Termin, zieht sein Eintrag nach, solange er noch neu ist. Verworfene Termine kommen nicht wieder.'
		],
		checked: true
	}
];

const STEPS: Readonly<Partial<Record<SetupKind, readonly SetupStep[]>>> = {
	kalender: CALENDAR_STEPS
};

/** Steps of a kind; empty for kinds without an assistant yet. */
export function setupSteps(kind: SetupKind): readonly SetupStep[] {
	return STEPS[kind] ?? [];
}

/** Name of the service in the title "‹Dienst› einrichten". */
export const SETUP_TITLES: Readonly<Record<SetupKind, string>> = Object.freeze({
	kalender: 'Google Calendar',
	telegram: 'Telegram-Bot',
	webde: 'Web.de',
	gmail: 'Gmail',
	proton: 'Proton Mail'
});

/** Steps through the Windows control panel instead of setx (tab "Systemsteuerung"). */
export const CONTROL_PANEL_STEPS: readonly string[] = [
	'Windows-Taste drücken und „Umgebungsvariablen für dieses Konto bearbeiten“ eingeben, dann Enter.',
	'Unter „Benutzervariablen“ auf „Neu …“ klicken.',
	'Als Name den Variablennamen eintragen, als Wert den Wert einfügen, dann zweimal „OK“.'
];

/** What the app knows about a setup; everything comes from the server. */
export interface SetupFacts {
	connection: Pick<
		Connection,
		'label' | 'secretEnv' | 'keywords' | 'lastRunAt' | 'lastOkAt' | 'lastError'
	> | null;
	secretStatus: SecretStatus | null;
}

function satisfied(id: SetupStepId, facts: SetupFacts): boolean {
	const { connection, secretStatus } = facts;
	switch (id) {
		case 'connect':
			return connection !== null;
		case 'address':
		case 'variable':
		case 'restart':
			return connection !== null && secretStatus?.secret === true;
		case 'keywords':
			return connection !== null && connection.keywords.length > 0;
		case 'first-run':
			return connection !== null && connection.lastOkAt !== null && connection.lastError === '';
	}
}

/**
 * Index of the first step that is not done yet, from the facts; the last step when all are done.
 * Without steps (a kind without assistant) 0.
 */
export function setupProgress(kind: SetupKind, facts: SetupFacts): number {
	const steps = setupSteps(kind);
	const open = steps.findIndex((step) => !satisfied(step.id, facts));
	return open === -1 ? Math.max(steps.length - 1, 0) : open;
}

/** Whether every step is done. */
export function setupComplete(kind: SetupKind, facts: SetupFacts): boolean {
	const steps = setupSteps(kind);
	return steps.length > 0 && steps.every((step) => satisfied(step.id, facts));
}

export type StepState = 'current' | 'done' | 'open' | 'warning';

/**
 * State of each step in the stepper: done when its fact holds; a step before the current one whose
 * check is open shows a warning ("Prüfung offen"); a step before the current one without a check
 * counts as done (the app cannot see it); the rest is open. No step is locked.
 */
export function stepStates(kind: SetupKind, facts: SetupFacts, current: number): StepState[] {
	return setupSteps(kind).map((step, index) => {
		if (index === current) return 'current';
		if (satisfied(step.id, facts)) return 'done';
		if (index < current) return step.checked ? 'warning' : 'done';
		return 'open';
	});
}

export type CheckTone = 'done' | 'open' | 'warning' | 'error';

export interface StepCheck {
	tone: CheckTone;
	text: string;
}

/** The check line of a step (plan §3.8); null for steps the app cannot check. */
export function stepCheck(id: SetupStepId, facts: SetupFacts): StepCheck | null {
	const { connection, secretStatus } = facts;
	switch (id) {
		case 'connect':
			return connection === null
				? { tone: 'open', text: 'Noch keine Verbindung angelegt.' }
				: { tone: 'done', text: `Verbindung „${connection.label}“ angelegt.` };
		case 'restart': {
			if (connection === null) return { tone: 'open', text: 'Erst die Verbindung anlegen.' };
			if (secretStatus === null) {
				return {
					tone: 'open',
					text: `Ob die App ${connection.secretEnv} sieht, ließ sich nicht prüfen.`
				};
			}
			return secretStatus.secret
				? { tone: 'done', text: `Die App sieht ${connection.secretEnv}.` }
				: { tone: 'open', text: `Die App sieht ${connection.secretEnv} noch nicht.` };
		}
		case 'keywords': {
			if (connection === null) return { tone: 'open', text: 'Erst die Verbindung anlegen.' };
			const count = connection.keywords.length;
			return count === 0
				? { tone: 'warning', text: NO_KEYWORDS_WARNING }
				: {
						tone: 'done',
						text: `${count === 1 ? '1 Stichwort' : `${count} Stichwörter`}: ${connection.keywords.join(', ')}.`
					};
		}
		case 'first-run': {
			if (connection === null) return { tone: 'open', text: 'Erst die Verbindung anlegen.' };
			if (connection.lastError !== '') {
				return { tone: 'error', text: `Letzter Abruf fehlgeschlagen: ${connection.lastError}` };
			}
			if (connection.lastOkAt !== null) {
				return {
					tone: 'done',
					text: `Abruf erfolgreich, zuletzt ${formatBerlinDateTime(connection.lastOkAt)}.`
				};
			}
			return { tone: 'open', text: 'Noch kein Abruf.' };
		}
		case 'address':
		case 'variable':
			return null;
	}
}

/**
 * The first checked step before `current` whose check is open, for the hint "Schritt 3 ist noch
 * offen: …" at the top of a later step; "Weiter" is never locked.
 */
export function openCheckBefore(
	kind: SetupKind,
	facts: SetupFacts,
	current: number
): { index: number; text: string } | null {
	const steps = setupSteps(kind);
	for (let index = 0; index < Math.min(current, steps.length); index += 1) {
		const step = steps[index];
		if (step === undefined || !step.checked || satisfied(step.id, facts)) continue;
		const check = stepCheck(step.id, facts);
		return { index, text: check?.text ?? step.title };
	}
	return null;
}

/** Key of the step looked at last, per connection (sessionStorage; only the number). */
export function setupStepKey(connectionId: string): string {
	return `byl-setup:${connectionId}`;
}

/** Key of the chosen way to set a variable (localStorage; no secret). */
export const SETX_WAY_KEY = 'byl-setx-way';
export const SETX_WAYS = ['eingabeaufforderung', 'systemsteuerung'] as const;
export type SetxWay = (typeof SETX_WAYS)[number];

export function isSetxWay(value: unknown): value is SetxWay {
	return typeof value === 'string' && (SETX_WAYS as readonly string[]).includes(value);
}
