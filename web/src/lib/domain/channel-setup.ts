// Setup assistant of the channels (ADR-0026 section 4, plan EH-5 and §3.7/§3.8). Pure: the steps
// per service (labels of one or two words, texts, fixed https links of the providers, commands
// with their placeholders) and the progress, which comes from facts of the server, never from a
// stored step: the connection, whether the server sees the variable, the keywords and the last
// run. So after a restart (neu-starten.bat) the assistant opens at the right step, also in a new
// tab. Which step was looked at last is only a hint of the session (the component keeps it).
// Stand der Klickwege: 2026-09.

import type { Connection, SecretStatus } from './connections';
import { NO_KEYWORDS_WARNING } from './connections';
import { formatBerlinDateTime } from './format';

/**
 * Kinds of the address `?einrichten=<art>` (the IDs of the catalog). Each opens in the app: the
 * assistant, for Proton (no automatic fetch, three short steps) the guide as a modal M, for
 * WhatsApp Web the assistant of the browser extension (no connection; domain/whatsapp-web.ts).
 * Notion (ADR-0041) has an assistant with a connection, but it only imports lists on request.
 * GitHub (ADR-0050) watches repositories read only; its token is optional. Folders (ADR-0051)
 * watch folders of this machine read only and need no access data.
 */
export const SETUP_KINDS = [
	'kalender',
	'telegram',
	'webde',
	'gmail',
	'notion',
	'github',
	'ordner',
	'proton',
	'whatsapp-web'
] as const;

/** Kinds without a connection and without the steps of this module. */
export const GUIDE_KINDS: readonly SetupKind[] = ['proton', 'whatsapp-web'];
export type SetupKind = (typeof SETUP_KINDS)[number];

/** Name of the variable with the allowed chat IDs a new Telegram connection suggests. */
export const DEFAULT_ALLOWLIST = 'BYL_TELEGRAM_ALLOWED_IDS';

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
	if (kind === 'notion') return { type: 'notion', provider: '' };
	if (kind === 'github') return { type: 'github', provider: '' };
	if (kind === 'ordner') return { type: 'folder', provider: '' };
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
	if (connection.type === 'notion') return 'notion';
	if (connection.type === 'github') return 'github';
	if (connection.type === 'folder') return 'ordner';
	return connection.mailProvider === 'gmail' ? 'gmail' : 'webde';
}

export type SetupStepId =
	| 'pat'
	| 'bot'
	| 'token'
	| 'chat'
	| 'allow'
	| 'two-step'
	| 'password'
	| 'address'
	| 'integration'
	| 'variable'
	| 'connect'
	| 'restart'
	| 'share'
	| 'check'
	| 'keywords'
	| 'first-run'
	| 'target'
	| 'path';

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
	/** Gmail app passwords: the field drops the spaces between the groups and says so. */
	normalize?: 'gmail';
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
			'Die App sieht neue Variablen erst nach einem Neustart. Im Ordner app neu-starten.bat doppelklicken; es erkennt die neue Variable und startet die App neu.',
		actions: [],
		links: [],
		commands: [
			{
				label: 'Diese Datei doppelklicken',
				template: 'app\\neu-starten.bat',
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

/** Placeholders of the command for a mailbox password. */
function passwordCommand(label: string, normalize?: 'gmail'): SetupCommand {
	return {
		label: 'Befehl für die Eingabeaufforderung',
		template: 'setx {{variable}} "{{wert}}"',
		placeholders: {
			variable: { label: 'Variable', secret: false },
			wert: { label, secret: true }
		},
		value: 'wert',
		...(normalize === undefined ? {} : { normalize }),
		copyable: true
	};
}

/** Steps 4 to 6 of a mailbox (Web.de, Gmail): connect, restart, first run (plan §3.7). */
function mailTail(provider: string): readonly SetupStep[] {
	return [
		{
			id: 'connect',
			label: 'Verbinden',
			title: 'Postfach verbinden',
			intro: `Anbieter ${provider}, deine E-Mail-Adresse und der Name der Variablen. Danach legst du die Stichwörter fest, denn nur Mails mit Stichwort kommen in den Eingang.`,
			actions: [],
			links: [],
			commands: [],
			more: [
				'Gesucht wird in Betreff, Absender, den Kopfzeilen (An, Cc, Antwort an, Liste, Organisation) und im ganzen Text. Nur Betreff und Absender stellst du an der Karte im Menü „•••“ unter „Stichwörter und Einstellungen …“ ein.'
			],
			checked: true
		},
		{
			id: 'restart',
			label: 'Neu starten',
			title: 'App neu starten',
			intro:
				'Die App sieht neue Variablen erst nach einem Neustart; dabei startet auch der Mail-Hilfsprozess byl-mail.exe. Im Ordner app neu-starten.bat doppelklicken.',
			actions: [],
			links: [],
			commands: [
				{
					label: 'Diese Datei doppelklicken',
					template: 'app\\neu-starten.bat',
					placeholders: {},
					copyable: false
				}
			],
			more: [
				'Der Start legt beim ersten Mal den Zugang zwischen App und Hilfsprozess an (Variable BYL_INGEST_TOKEN, nichts zu tun) und startet byl-mail.exe, sobald eine eingeschaltete Postfach-Verbindung besteht.',
				'Beim ersten Start von byl-mail.exe können SmartScreen oder ein Virenscanner nachfragen, weil die Datei nicht signiert ist.',
				'Das Protokoll steht in app\\logs\\byl-mail.log, ohne Zugangsdaten und ohne Inhalte der Mails.'
			],
			checked: true
		},
		{
			id: 'first-run',
			label: 'Erster Abruf',
			title: 'Auf den ersten Abruf warten',
			intro:
				'Der Hilfsprozess ruft das Postfach alle 5 Minuten ab, der erste Abruf erscheint hier von selbst; „Jetzt abrufen“ startet ihn sofort. Dabei durchsucht er den gesamten Posteingang (nicht Papierkorb/Spam/Gesendet); die Karte zeigt den Fortschritt.',
			actions: [],
			links: [],
			commands: [],
			more: [
				'In den Eingang kommen alte und neue Mails des Posteingangs, in denen ein Stichwort vorkommt, höchstens 200 neue Einträge pro Abruf. Ergänzte Stichwörter gelten auch für ältere Mails. Mails ohne Stichwort holst du mit „Aus dem Postfach wählen …“ im Menü „•••“ der Karte.',
				'Der Hilfsprozess liest nur: Gelesen-Status, Markierungen und Ordner bleiben, und er verschickt nichts.'
			],
			checked: true
		}
	];
}

const WEBDE_STEPS: readonly SetupStep[] = [
	{
		id: 'allow',
		label: 'Abruf erlauben',
		title: 'Abruf per IMAP erlauben',
		intro: 'Web.de lässt Programme erst nach einem Schalter an dein Postfach.',
		actions: [
			'Bei Web.de anmelden, oben auf deine Initialen und dann „E-Mail-Einstellungen“ klicken.',
			'Unter „E-Mail empfangen“ auf „POP3/IMAP“ klicken.',
			'Den Schalter „POP3- und IMAP-Zugriff erlauben“ einschalten und die Sicherheitsabfrage bestätigen.'
		],
		links: [{ href: 'https://web.de', text: 'web.de' }],
		commands: [],
		more: [
			'Web.de schaltet den Abruf aus, wenn er längere Zeit nicht genutzt wird. Dann meldet die Verbindung „Anmeldung bei Web.de abgelehnt.“; den Schalter wieder einschalten, die App muss nicht neu starten.'
		],
		checked: false
	},
	{
		id: 'password',
		label: 'Passwort',
		title: 'Passwort wählen',
		intro:
			'Mit Zwei-Faktor-Anmeldung braucht die App ein anwendungsspezifisches Passwort, sonst gilt dein normales Web.de-Passwort.',
		actions: [
			'Unter „Account verwalten“ → „Login & Sicherheit“ → „Anwendungsspezifische Passwörter verwalten“ ein neues Passwort erstellen (Name etwa „becauseyoulovejira“).',
			'Das Passwort wird nur einmal angezeigt: gleich im nächsten Schritt als Variable setzen.'
		],
		links: [],
		commands: [],
		more: [
			'Widerrufen: das anwendungsspezifische Passwort unter „Login & Sicherheit“ löschen bzw. den Abruf ausschalten und die Variable entfernen.'
		],
		checked: false
	},
	{
		id: 'variable',
		label: 'Variable setzen',
		title: 'Passwort als Windows-Variable setzen',
		intro:
			'Das Passwort kommt in eine Variable deines Windows-Kontos; die App speichert nur ihren Namen.',
		actions: [],
		links: [],
		commands: [passwordCommand('Passwort')],
		more: ['Der Befehl bleibt im Verlauf dieses Fensters, bis du es schließt.'],
		checked: false
	},
	...mailTail('Web.de')
];

const GMAIL_STEPS: readonly SetupStep[] = [
	{
		id: 'two-step',
		label: 'Zwei Schritte',
		title: 'Bestätigung in zwei Schritten einschalten',
		intro:
			'Gmail erlaubt den Abruf nur mit einem App-Passwort, und das gibt es nur mit der Bestätigung in zwei Schritten.',
		actions: [
			'Im Google-Konto „Sicherheit“ öffnen.',
			'Prüfen, ob die „Bestätigung in zwei Schritten“ eingeschaltet ist; sonst dort einschalten.'
		],
		links: [
			{ href: 'https://myaccount.google.com/security', text: 'myaccount.google.com/security' }
		],
		commands: [],
		more: [
			'Mit „Erweitertem Schutz“ oder nur mit Sicherheitsschlüssel bietet Google keine App-Passwörter an; dann bleibt der Weg über .eml-Dateien (Einstellungen → Datei-Importe).'
		],
		checked: false
	},
	{
		id: 'password',
		label: 'App-Passwort',
		title: 'App-Passwort erstellen',
		intro: 'Das App-Passwort hat 16 Zeichen und wird nur einmal angezeigt.',
		actions: [
			'Die Seite der App-Passwörter öffnen.',
			'Einen Namen wie „becauseyoulovejira“ eingeben und „Erstellen“ klicken.'
		],
		links: [
			{
				href: 'https://myaccount.google.com/apppasswords',
				text: 'myaccount.google.com/apppasswords'
			}
		],
		commands: [],
		more: [
			'Ändert sich dein Google-Passwort, verfallen alle App-Passwörter. Widerrufen: auf derselben Seite das App-Passwort entfernen und die Variable löschen.'
		],
		checked: false
	},
	{
		id: 'variable',
		label: 'Variable setzen',
		title: 'App-Passwort als Windows-Variable setzen',
		intro:
			'Das App-Passwort kommt ohne die Leerzeichen zwischen den Vierergruppen in eine Variable deines Windows-Kontos.',
		actions: [],
		links: [],
		commands: [passwordCommand('App-Passwort', 'gmail')],
		more: [
			'Meldet die Verbindung später „Anmeldung bei Gmail abgelehnt.“, steht in der Variablen das normale Google-Passwort oder ein widerrufenes App-Passwort.'
		],
		checked: false
	},
	...mailTail('Gmail')
];

/** The name of the variable with the allowed chat IDs in the commands of Telegram. */
const ALLOWLIST: SetupPlaceholder = { label: 'Variable der IDs', secret: false };

const TELEGRAM_STEPS: readonly SetupStep[] = [
	{
		id: 'bot',
		label: 'Bot anlegen',
		title: 'Eigenen Bot anlegen',
		intro:
			'Du legst bei BotFather einen eigenen Bot an und schreibst ihm später, was in den Eingang soll.',
		actions: [
			'In Telegram den Chat mit @BotFather öffnen (blauer Haken).',
			'Den Befehl unten senden, einen Namen und einen Benutzernamen wählen, der auf „bot“ endet.',
			'BotFather antwortet mit dem Token (etwa 123456789:AA…); er ist geheim.'
		],
		links: [{ href: 'https://t.me/BotFather', text: 't.me/BotFather' }],
		commands: [
			{ label: 'Befehl an BotFather', template: '/newbot', placeholders: {}, copyable: true }
		],
		more: [
			'Widerrufen: bei BotFather /revoke (neuer Token, dann Variable neu setzen und die App neu starten) oder /deletebot.'
		],
		checked: false
	},
	{
		id: 'token',
		label: 'Token setzen',
		title: 'Token und vorläufige IDs setzen',
		intro:
			'Der Token kommt in eine Variable deines Windows-Kontos. Die erlaubten IDs setzt du vorläufig auf 0, die richtige ID zeigt die App im Schritt „Chat freigeben“.',
		actions: [],
		links: [],
		commands: [
			{
				label: 'Befehl für die Eingabeaufforderung',
				template: 'setx {{variable}} "{{wert}}"',
				placeholders: {
					variable: { label: 'Variable', secret: false },
					wert: { label: 'Bot-Token', secret: true }
				},
				value: 'wert',
				copyable: true
			},
			{
				label: 'Vorläufige erlaubte IDs',
				template: 'setx {{allowlist}} "0"',
				placeholders: { allowlist: ALLOWLIST },
				copyable: true
			}
		],
		more: ['Der Befehl bleibt im Verlauf dieses Fensters, bis du es schließt.'],
		checked: false
	},
	{
		id: 'connect',
		label: 'Verbinden',
		title: 'Verbindung anlegen',
		intro:
			'Gib der Verbindung einen Namen; die Namen der beiden Variablen sind vorbelegt. Die App speichert nur die Namen, nie die Werte.',
		actions: [],
		links: [],
		commands: [],
		more: [],
		checked: true
	},
	{
		id: 'restart',
		label: 'Neu starten',
		title: 'App neu starten',
		intro:
			'Die App sieht neue Variablen erst nach einem Neustart. Im Ordner app neu-starten.bat doppelklicken; es erkennt die neuen Variablen und startet die App neu.',
		actions: [],
		links: [],
		commands: [
			{
				label: 'Diese Datei doppelklicken',
				template: 'app\\neu-starten.bat',
				placeholders: {},
				copyable: false
			}
		],
		more: [
			'Vor dem Neustart kann die App nicht unterscheiden, ob eine Variable fehlt oder nur noch nicht geladen ist.'
		],
		checked: true
	},
	{
		id: 'chat',
		label: 'Chat freigeben',
		title: 'Deinen Chat freigeben',
		intro:
			'Schreibe deinem Bot eine Nachricht, dann „Jetzt abrufen“. Die App liest die ID des Chats aus dem Ergebnis und baut daraus den Befehl.',
		actions: [],
		links: [],
		commands: [],
		more: [
			'Im Chat mit dem Bot ist die ID deine User-ID. Für eine Gruppe den Bot hinzufügen; ihre ID beginnt mit -100. Mehrere IDs trennst du mit Komma.',
			'In Gruppen sieht ein Bot normalerweise nur Befehle und Antworten an ihn. Soll er alles lesen, bei BotFather /setprivacy auf „Disable“ stellen.',
			'Nach dem neuen Wert die App noch einmal neu starten (neu-starten.bat erkennt den geänderten Wert) und erneut „Jetzt abrufen“: Dann meldet die App keinen fremden Chat mehr.'
		],
		checked: true
	},
	{
		id: 'first-run',
		label: 'Test',
		title: 'Stichwörter festlegen und testen',
		intro:
			'In den Eingang kommen nur Nachrichten mit einem Stichwort. Schicke „todo Test“ an den Bot, dann „Jetzt abrufen“.',
		actions: [],
		links: [],
		commands: [],
		more: [
			'Jede gespeicherte Nachricht beantwortet der Bot mit „Im Eingang gespeichert“, eine Nachricht ohne Stichwort mit „Kein Stichwort erkannt – nicht gespeichert“. Beide Antworten schaltest du hier ab oder später an der Karte (unter „Details“ oder im Menü „•••“ unter „Stichwörter und Einstellungen …“).',
			'Telegram hält Nachrichten für den Bot höchstens 24 Stunden bereit; läuft die App länger nicht, gehen sie verloren. Ohne Bestätigung siehst du im Chat nicht, ob eine Nachricht angekommen ist; dann zeigt es nur der Eingang.'
		],
		checked: true
	}
];

/** Placeholder of the allowed IDs in the command of the step "Chat freigeben". */
export const CHAT_COMMAND: SetupCommand = {
	label: 'Befehl mit der erkannten ID',
	template: 'setx {{allowlist}} "{{ids}}"',
	placeholders: { allowlist: ALLOWLIST, ids: { label: 'Chat-IDs', secret: false } },
	value: 'ids',
	copyable: true
};

/**
 * Notion (ADR-0041): an internal integration that may only read, its token as variable, the
 * connection, the restart, the pages shared with it and "Verbindung prüfen". The portal of Notion
 * is in English; the page menu of Notion follows the language of the user. Stand: 2026-09.
 */
const NOTION_STEPS: readonly SetupStep[] = [
	{
		id: 'integration',
		label: 'Integration',
		title: 'Integration in Notion anlegen',
		intro:
			'Eine interne Integration ist ein eigener Leser in deinem Notion. Sie sieht nur Seiten, die du ihr freigibst, und soll nur lesen dürfen.',
		actions: [
			'Das Developer-Portal von Notion öffnen und links unter „Build“ auf „Internal connections“ klicken.',
			'„Create a new connection“ klicken, als Namen „becauseyoulovejira“ eingeben, deinen Arbeitsbereich wählen und anlegen.',
			'Im Tab „Configuration“ unter „Capabilities“ nur „Read content“ eingeschaltet lassen und „Update content“, „Insert content“ und die Kommentar-Fähigkeiten ausschalten. Bei den Benutzerinformationen „No user information“ wählen oder, wenn Personen mit Namen erscheinen sollen, „Read user information without email addresses“. Speichern.',
			'Im selben Tab beim „API token“ auf „Show“ und dann „Copy“ klicken. Das Token beginnt mit ntn_ und ist geheim.'
		],
		links: [
			{ href: 'https://app.notion.com/developers/connections', text: 'app.notion.com/developers' }
		],
		commands: [],
		more: [
			'Anlegen darf nur, wer „Workspace Owner“ ist; in deinem eigenen Arbeitsbereich bist du das. Ältere Anleitungen sprechen von „Integrations“ statt „Connections“.',
			'Die App fragt Notion nur lesend. Ob die Integration mehr darf, kann sie nicht sehen; lass deshalb nur „Read content“ an.',
			'Widerrufen: im Portal bei der Integration im Tab „Configuration“ das Token erneuern oder die Integration löschen, dann die Variable neu setzen bzw. löschen.'
		],
		checked: false
	},
	{
		id: 'variable',
		label: 'Token setzen',
		title: 'Token als Windows-Variable setzen',
		intro:
			'Das Token kommt in eine Variable deines Windows-Kontos; die App speichert nur ihren Namen und schickt das Token nur an Notion.',
		actions: [],
		links: [],
		commands: [
			{
				label: 'Befehl für die Eingabeaufforderung',
				template: 'setx {{variable}} "{{wert}}"',
				placeholders: {
					variable: { label: 'Variable', secret: false },
					wert: { label: 'Token', secret: true }
				},
				value: 'wert',
				copyable: true
			}
		],
		more: ['Der Befehl bleibt im Verlauf dieses Fensters, bis du es schließt.'],
		checked: false
	},
	{
		id: 'connect',
		label: 'Verbinden',
		title: 'Verbindung anlegen',
		intro:
			'Gib der Verbindung einen Namen; der Name der Variablen ist vorbelegt. Die App speichert nur den Namen, nie das Token.',
		actions: [],
		links: [],
		commands: [],
		more: [],
		checked: true
	},
	{
		id: 'restart',
		label: 'Neu starten',
		title: 'App neu starten',
		intro:
			'Die App sieht neue Variablen erst nach einem Neustart. Im Ordner app neu-starten.bat doppelklicken; es erkennt die neue Variable und startet die App neu.',
		actions: [],
		links: [],
		commands: [
			{
				label: 'Diese Datei doppelklicken',
				template: 'app\\neu-starten.bat',
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
		id: 'share',
		label: 'Freigeben',
		title: 'Seiten und Datenbanken freigeben',
		intro:
			'Die Integration sieht nur, was du ihr freigibst. Gib genau die Listen frei, die du übernehmen willst; Unterseiten sind mit freigegeben.',
		actions: [
			'In Notion die Seite oder Datenbank öffnen.',
			'Oben rechts auf „•••“ klicken, dann auf „Verbindungen“ (englisch „Connections“) und „Verbindung hinzufügen“ („+ Add connection“).',
			'„becauseyoulovejira“ suchen, auswählen und den Zugriff bestätigen.'
		],
		links: [
			{
				href: 'https://www.notion.com/de/help/add-and-manage-connections-with-the-api',
				text: 'notion.com: Verbindungen verwalten'
			}
		],
		commands: [],
		more: [
			'Alternativ im Developer-Portal bei der Integration im Tab „Content access“ auf „Edit access“ klicken und die Seiten wählen.',
			'Freigaben nimmst du genauso wieder weg; danach meldet der Import „nicht freigegeben“.'
		],
		checked: false
	},
	{
		id: 'check',
		label: 'Prüfen',
		title: 'Verbindung prüfen',
		intro:
			'„Verbindung prüfen“ fragt Notion mit dem Token nach der Integration und danach, ob sie etwas sieht. Danach übernimmst du Listen an der Karte mit „Listen übernehmen …“.',
		actions: [],
		links: [],
		commands: [],
		more: [
			'Die App ruft Notion nie von selbst ab. Sie liest nur, wenn du Listen übernimmst oder „Erneut abrufen“ wählst, und schreibt nie etwas nach Notion.',
			'Frisch freigegebene Seiten findet die Suche von Notion manchmal erst nach einem Moment.'
		],
		checked: true
	}
];

/**
 * GitHub (ADR-0050 §7): a fine-grained token that only reads, set as variable, a restart, the
 * repositories (they create the connection), the optional target project and "Verbindung prüfen".
 * The token is optional (public repositories), so the restart has no check line of its own; the
 * last step says whether the app sees it. Stand der Klickwege: 2026-10.
 */
const GITHUB_STEPS: readonly SetupStep[] = [
	{
		id: 'pat',
		label: 'Token anlegen',
		title: 'Token auf GitHub anlegen (nur lesend)',
		intro:
			'Ein „Fine-grained personal access token“ erlaubt der App, die gewählten Repositorys zu lesen, und sonst nichts. Öffentliche Repositorys gehen auch ohne Token, dann mit höchstens 60 Anfragen je Stunde.',
		actions: [
			'Auf github.com oben rechts auf dein Profilbild klicken, dann auf „Settings“.',
			'Links ganz unten „Developer settings“ wählen, dann „Personal access tokens“ → „Fine-grained tokens“ und „Generate new token“.',
			'Bei „Token name“ „becauseyoulovejira“ eintragen, bei „Expiration“ eine Frist wählen (etwa 90 Tage) und bei „Resource owner“ dein Konto bzw. die Organisation der Repositorys.',
			'Unter „Repository access“ „Only select repositories“ wählen und die Repositorys auswählen, die die App beobachten soll.',
			'Unter „Permissions“ bei den Rechten für Repositorys („Repository permissions“, in neueren Ansichten „Add permissions“ → „Repositories“) „Contents“ und „Pull requests“ auf „Read-only“ stellen. „Metadata“ steht automatisch auf „Read-only“. Sonst nichts.',
			'„Generate token“ klicken und das Token kopieren; es beginnt mit github_pat_, und GitHub zeigt es nur einmal.'
		],
		links: [
			{
				href: 'https://github.com/settings/personal-access-tokens',
				text: 'github.com: Fine-grained tokens'
			}
		],
		commands: [],
		more: [
			'Ohne Token diesen und die nächsten zwei Schritte überspringen: Die App liest dann nur öffentliche Repositorys.',
			'Organisationen können fine-grained Tokens sperren oder erst nach Freigabe zulassen; dann steht das Token auf „pending“, bis jemand mit Admin-Rechten zustimmt.',
			'Widerrufen: unter „Fine-grained tokens“ beim Token „Revoke“; danach die Variable löschen und die App neu starten.'
		],
		checked: false
	},
	{
		id: 'variable',
		label: 'Token setzen',
		title: 'Token als Windows-Variable setzen',
		intro:
			'Das Token kommt in eine Variable deines Windows-Kontos; die App speichert nur ihren Namen und schickt das Token nur an GitHub.',
		actions: [],
		links: [],
		commands: [
			{
				label: 'Befehl für die Eingabeaufforderung',
				template: 'setx {{variable}} "{{wert}}"',
				placeholders: {
					variable: { label: 'Variable', secret: false },
					wert: { label: 'Token', secret: true }
				},
				value: 'wert',
				copyable: true
			}
		],
		more: ['Der Befehl bleibt im Verlauf dieses Fensters, bis du es schließt.'],
		checked: false
	},
	{
		id: 'restart',
		label: 'Neu starten',
		title: 'App neu starten',
		intro:
			'Die App sieht neue Variablen erst nach einem Neustart. Im Ordner app neu-starten.bat doppelklicken; es erkennt die neue Variable und startet die App neu.',
		actions: [],
		links: [],
		commands: [
			{
				label: 'Diese Datei doppelklicken',
				template: 'app\\neu-starten.bat',
				placeholders: {},
				copyable: false
			}
		],
		more: [
			'Ohne Token überspringst du diesen Schritt.',
			'Ob die App das Token sieht, zeigt der letzte Schritt „Prüfen“.'
		],
		checked: false
	},
	{
		id: 'connect',
		label: 'Repositorys',
		title: 'Repositorys hinzufügen',
		intro:
			'Gib der Verbindung einen Namen und trag das erste Repository ein; weitere fügst du hier oder später an der Karte hinzu. Vorbelegt sind Roadmaps, Changelogs und READMEs.',
		actions: [],
		links: [],
		commands: [],
		more: [
			'Der erste Abruf merkt sich den Stand als Ausgangspunkt. Einträge entstehen erst bei Änderungen; nur offene Pull Requests kommen gleich mit (höchstens 20).',
			'Muster beginnen im Hauptordner des Repositorys: * steht für beliebige Zeichen eines Namens, ** für beliebig viele Ordner (docs/**/roadmap*). Groß- und Kleinschreibung zählen nicht.'
		],
		checked: true
	},
	{
		id: 'check',
		label: 'Prüfen',
		title: 'Verbindung prüfen',
		intro:
			'„Verbindung prüfen“ fragt GitHub, wem das Token gehört, wie viele Anfragen übrig sind und ob jedes Repository erreichbar ist. Danach ruft die App alle 15 Minuten ab, „Jetzt abrufen“ an der Karte sofort.',
		actions: [],
		links: [],
		commands: [],
		more: [
			'Die App schreibt nie etwas nach GitHub: keinen Kommentar, keinen Status, keine Änderung.',
			'Ändert sich eine beobachtete Datei, kommt ein Pull Request oder ein Release, steht ein Eintrag im Eingang; frühere Einträge zeigen, ob sich ihre Quelle seitdem geändert hat.'
		],
		checked: true
	}
];

/**
 * Folders (ADR-0051 §7): no access data, so no variable and no restart. The first step shows where
 * the full path of a folder comes from, the second creates the connection with its first folder
 * (the server checks the path on the disk), the optional target project follows, and the last step
 * runs the first check, which only takes the base. Stand der Klickwege: 2026-10.
 */
const FOLDER_STEPS: readonly SetupStep[] = [
	{
		id: 'path',
		label: 'Pfad kopieren',
		title: 'Pfad des Ordners kopieren',
		intro:
			'Die App braucht den vollständigen Pfad des Ordners, so wie ihn der Rechner kennt, auf dem sie läuft. Am einfachsten kopierst du ihn im Explorer.',
		actions: [
			'Im Explorer den Ordner öffnen, den die App beobachten soll.',
			'Oben in die Adressleiste klicken: Sie zeigt jetzt den vollständigen Pfad, etwa C:\\Daten\\Projekte.',
			'Mit Strg+C kopieren; im nächsten Schritt fügst du ihn mit Strg+V ein.'
		],
		links: [],
		commands: [],
		more: [
			'Eine Freigabe im Netz geht auch, etwa \\\\NAS\\Projekte; ein verbundenes Laufwerk wie Z: nur, solange es verbunden ist.',
			'Läuft die App unter Linux oder in einem Container, gilt der Pfad dort, etwa /home/anna/Projekte; im Container muss der Ordner eingebunden sein.'
		],
		checked: false
	},
	{
		id: 'connect',
		label: 'Ordner',
		title: 'Ordner hinzufügen',
		intro:
			'Gib der Verbindung einen Namen und trag den ersten Ordner mit seinem vollständigen Pfad ein; weitere fügst du hier oder später an der Karte hinzu. Die App liest die Ordner nur: Sie ändert, verschiebt und löscht nichts.',
		actions: [],
		links: [],
		commands: [],
		more: [
			'Den Pfad kopierst du im Explorer aus der Adressleiste, etwa „C:\\Daten\\Projekte“ oder eine Freigabe wie „\\\\NAS\\Projekte“; unter Linux etwa „/home/anna/Projekte“.',
			'Ausgeschlossen sind von Anfang an temporäre Dateien (*.tmp, ~$*), .git, node_modules, Thumbs.db und desktop.ini. Dateitypen schränken auf Endungen ein, etwa pdf, docx.',
			'Verknüpfungen (Symlinks, Junctions) folgt die App nicht, und den Ordner der App selbst beobachtet sie nicht.'
		],
		checked: true
	},
	{
		id: 'first-run',
		label: 'Prüfen',
		title: 'Ordner zum ersten Mal prüfen',
		intro:
			'„Jetzt prüfen“ liest die Ordner ein und merkt sich den Stand als Ausgangspunkt: Dateien, die schon da sind, kommen nicht in den Eingang. Danach prüft die App alle 5 Minuten; neue und geänderte Dateien stehen im Eingang, als Verweis auf die Datei, nicht als Kopie.',
		actions: [],
		links: [],
		commands: [],
		more: [
			'Dateien von vorher holst du an der Karte mit „Vorhandene Dateien übernehmen …“, ausgewählt Datei für Datei.',
			'„Ansehen“ an einem Eintrag öffnet die aktuelle Datei: PDF, Bilder und Text im Browser, alles andere als Download. Ist die Datei nicht mehr da, sagt der Eintrag es.',
			'Gespeichert werden nur Name, Pfad, Größe, Zeit und Typ einer Datei, nie ihr Inhalt.'
		],
		checked: true
	}
];

/**
 * The optional step "Zielprojekt" (ADR-0049, ADR-0026 addendum ZP): right after the connection is
 * created, before its first entries can come, so they get the project already. It never holds the
 * assistant up: done as soon as the connection exists, chosen or not.
 */
export const TARGET_STEP: SetupStep = {
	id: 'target',
	label: 'Zielprojekt',
	title: 'Zielprojekt wählen (optional)',
	intro:
		'Neue Einträge dieser Verbindung bekommen dieses Projekt, und beim Umwandeln ist es vorbelegt. Ohne Zielprojekt bleibt das Projekt beim Umwandeln leer; ändern kannst du es jederzeit an der Karte.',
	actions: [],
	links: [],
	commands: [],
	more: [
		'Es gilt nur für neue Einträge: Was schon im Eingang ist, behält sein Zielprojekt.',
		'Ein archiviertes oder gelöschtes Zielprojekt wird beim Umwandeln nicht vorbelegt; der Hinweis am Projekt sagt es.'
	],
	checked: false
};

/** The steps with "Zielprojekt" right after "Verbinden". */
function withTargetStep(steps: readonly SetupStep[]): readonly SetupStep[] {
	const at = steps.findIndex((step) => step.id === 'connect');
	return at === -1 ? steps : [...steps.slice(0, at + 1), TARGET_STEP, ...steps.slice(at + 1)];
}

const STEPS: Readonly<Partial<Record<SetupKind, readonly SetupStep[]>>> = {
	kalender: withTargetStep(CALENDAR_STEPS),
	telegram: withTargetStep(TELEGRAM_STEPS),
	webde: withTargetStep(WEBDE_STEPS),
	gmail: withTargetStep(GMAIL_STEPS),
	notion: withTargetStep(NOTION_STEPS),
	github: withTargetStep(GITHUB_STEPS),
	ordner: withTargetStep(FOLDER_STEPS)
};

/** Name of the variable a new connection of the kind suggests. */
export function defaultVariable(kind: SetupKind): string {
	if (kind === 'webde') return 'BYL_WEBDE_PASSWORD';
	if (kind === 'gmail') return 'BYL_GMAIL_PASSWORD';
	if (kind === 'telegram') return 'BYL_TELEGRAM_TOKEN';
	if (kind === 'notion') return 'BYL_NOTION_TOKEN';
	if (kind === 'github') return 'BYL_GITHUB_TOKEN';
	// Folders have no access data (ADR-0051 §1).
	if (kind === 'ordner') return '';
	return 'BYL_GOOGLE_CALENDAR_URL';
}

/** Proton Mail (plan §3.7): three short steps without a stepper, in a modal M. */
export const PROTON_STEPS: readonly string[] = [
	'Die Mail in Proton öffnen.',
	'Unter den Absenderangaben auf „Mehr“ (⋮) klicken und „Exportieren“ wählen; die .eml-Datei speichern.',
	'Die Datei in den Eingang ziehen oder dort mit „Datei wählen“ öffnen. Mails mit einem Stichwort für Mail-Dateien sind in der Auswahl schon markiert.'
];

export const PROTON_LINK: SetupLink = { href: 'https://mail.proton.me', text: 'mail.proton.me' };

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
	notion: 'Notion',
	github: 'GitHub',
	ordner: 'Ordner',
	proton: 'Proton Mail',
	'whatsapp-web': 'WhatsApp Web'
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
		| 'label'
		| 'secretEnv'
		| 'allowlistEnv'
		| 'keywords'
		| 'lastRunAt'
		| 'lastOkAt'
		| 'lastError'
		| 'lastHint'
		| 'github'
		| 'folders'
	> | null;
	secretStatus: SecretStatus | null;
}

/** Whether the fact of a checked step holds. */
function checkHolds(kind: SetupKind, id: SetupStepId, facts: SetupFacts): boolean {
	const { connection, secretStatus } = facts;
	if (connection === null) return false;
	switch (id) {
		case 'connect':
			// GitHub and folders read nothing before their first repository or folder (ADR-0050 §7,
			// ADR-0051 §7).
			if (kind === 'github') return (connection.github?.repos.length ?? 0) > 0;
			return kind !== 'ordner' || (connection.folders?.folders.length ?? 0) > 0;
		case 'restart':
			// Telegram needs both variables: the token and the allowed IDs.
			return (
				secretStatus?.secret === true && (kind !== 'telegram' || secretStatus.allowlist === true)
			);
		case 'keywords':
			return connection.keywords.length > 0;
		case 'chat':
			// A run happened and reported no chat that is not allowed.
			return (
				connection.lastRunAt !== null &&
				connection.lastError === '' &&
				chatIdFromHint(connection.lastHint) === null
			);
		case 'first-run':
			// A mailbox has run once when the helper wrote the last run (the hint "Erster Abruf");
			// calendar and bot need a good run, the bot also a keyword.
			if (connection.lastError !== '') return false;
			if (isMailKind(kind)) return connection.lastRunAt !== null;
			if (kind === 'telegram' && connection.keywords.length === 0) return false;
			return connection.lastOkAt !== null;
		case 'check':
			// Notion answered with the token, and the integration sees something (no hint).
			return (
				connection.lastOkAt !== null && connection.lastError === '' && connection.lastHint === ''
			);
		default:
			return false;
	}
}

/**
 * The chat ID in the hint of a run of the bot, e.g. "Nachricht aus einem nicht freigegebenen Chat
 * (Chat-ID 424242)." (plan §3.13): digits only, with an optional minus for groups, at most 20
 * digits; anything else gives null. The ID is no secret; it stands at the connection anyway.
 */
export function chatIdFromHint(hint: string): string | null {
	const match = /Chat-ID (-?\d{1,20})(?!\d)/.exec(hint);
	return match?.[1] ?? null;
}

function isMailKind(kind: SetupKind): boolean {
	return kind === 'webde' || kind === 'gmail';
}

/**
 * Whether step `index` is done. A checked step by its fact; a step the app cannot see (open a page
 * of the provider, set a variable) once the next checked step is done, e.g. "Variable setzen" once
 * the server sees the variable, "Abruf erlauben" once the mailbox is connected.
 */
function satisfied(kind: SetupKind, index: number, facts: SetupFacts): boolean {
	const steps = setupSteps(kind);
	const step = steps[index];
	if (step === undefined) return false;
	// The optional "Zielprojekt" never holds the assistant up (ADR-0049).
	if (step.id === 'target') return facts.connection !== null;
	if (step.checked) return checkHolds(kind, step.id, facts);
	const next = steps.findIndex((entry, at) => at > index && entry.checked);
	const checked = steps[next];
	return checked !== undefined && checkHolds(kind, checked.id, facts);
}

/**
 * Index of the first step that is not done yet, from the facts; the last step when all are done.
 * Without steps (a kind without assistant) 0.
 */
export function setupProgress(kind: SetupKind, facts: SetupFacts): number {
	const steps = setupSteps(kind);
	const open = steps.findIndex((_step, index) => !satisfied(kind, index, facts));
	return open === -1 ? Math.max(steps.length - 1, 0) : open;
}

/** Whether every step is done. */
export function setupComplete(kind: SetupKind, facts: SetupFacts): boolean {
	const steps = setupSteps(kind);
	return steps.length > 0 && steps.every((_step, index) => satisfied(kind, index, facts));
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
		if (satisfied(kind, index, facts)) return 'done';
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
export function stepCheck(kind: SetupKind, id: SetupStepId, facts: SetupFacts): StepCheck | null {
	const { connection, secretStatus } = facts;
	switch (id) {
		case 'connect':
			if (connection === null) return { tone: 'open', text: 'Noch keine Verbindung angelegt.' };
			if (kind === 'github') {
				const repos = connection.github?.repos.length ?? 0;
				return repos === 0
					? {
							tone: 'warning',
							text: `Verbindung „${connection.label}“ angelegt, noch ohne Repository.`
						}
					: {
							tone: 'done',
							text: `Verbindung „${connection.label}“ mit ${repos === 1 ? '1 Repository' : `${repos} Repositorys`} angelegt.`
						};
			}
			if (kind === 'ordner') {
				const folders = connection.folders?.folders.length ?? 0;
				return folders === 0
					? {
							tone: 'warning',
							text: `Verbindung „${connection.label}“ angelegt, noch ohne Ordner.`
						}
					: {
							tone: 'done',
							text: `Verbindung „${connection.label}“ mit ${folders} Ordner${folders === 1 ? '' : 'n'} angelegt.`
						};
			}
			if (isMailKind(kind) && connection.keywords.length === 0) {
				return {
					tone: 'warning',
					text: `Verbindung „${connection.label}“ angelegt. ${NO_KEYWORDS_WARNING}`
				};
			}
			return { tone: 'done', text: `Verbindung „${connection.label}“ angelegt.` };
		case 'restart': {
			// GitHub: the token is optional and the connection comes after this step; without it there
			// is nothing to check yet.
			if (kind === 'github') {
				if (connection === null || secretStatus === null) return null;
				return secretStatus.secret
					? { tone: 'done', text: `Die App sieht ${connection.secretEnv}.` }
					: {
							tone: 'open',
							text: `Die App sieht ${connection.secretEnv} noch nicht; ohne Token liest sie nur öffentliche Repositorys.`
						};
			}
			if (connection === null) return { tone: 'open', text: 'Erst die Verbindung anlegen.' };
			if (secretStatus === null) {
				return {
					tone: 'open',
					text: `Ob die App ${connection.secretEnv} sieht, ließ sich nicht prüfen.`
				};
			}
			if (kind === 'telegram') {
				const seen = [
					secretStatus.secret ? connection.secretEnv : null,
					secretStatus.allowlist === true ? connection.allowlistEnv : null
				].filter((name): name is string => name !== null);
				const missing = [
					secretStatus.secret ? null : connection.secretEnv,
					secretStatus.allowlist === true ? null : connection.allowlistEnv
				].filter((name): name is string => name !== null);
				if (missing.length === 0) {
					return { tone: 'done', text: `Die App sieht ${seen.join(' und ')}.` };
				}
				return { tone: 'open', text: `Die App sieht ${missing.join(' und ')} noch nicht.` };
			}
			return secretStatus.secret
				? { tone: 'done', text: `Die App sieht ${connection.secretEnv}.` }
				: { tone: 'open', text: `Die App sieht ${connection.secretEnv} noch nicht.` };
		}
		case 'chat': {
			if (connection === null) return { tone: 'open', text: 'Erst die Verbindung anlegen.' };
			if (connection.lastError !== '') {
				return { tone: 'error', text: `Letzter Abruf fehlgeschlagen: ${connection.lastError}` };
			}
			const chat = chatIdFromHint(connection.lastHint);
			if (chat !== null) {
				return {
					tone: 'open',
					text: `Nachricht aus einem Chat, der noch nicht freigegeben ist (Chat-ID ${chat}).`
				};
			}
			return connection.lastRunAt === null
				? { tone: 'open', text: 'Noch kein Abruf: erst dem Bot schreiben, dann „Jetzt abrufen“.' }
				: { tone: 'done', text: 'Kein fremder Chat mehr gemeldet.' };
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
			if (kind === 'ordner') {
				if (connection.lastError !== '') {
					return { tone: 'error', text: `Letzte Prüfung fehlgeschlagen: ${connection.lastError}` };
				}
				return connection.lastOkAt === null
					? { tone: 'open', text: 'Noch nicht geprüft.' }
					: {
							tone: 'done',
							text: `Ordner geprüft, zuletzt ${formatBerlinDateTime(connection.lastOkAt)}.`
						};
			}
			if (connection.lastError !== '') {
				return { tone: 'error', text: `Letzter Abruf fehlgeschlagen: ${connection.lastError}` };
			}
			if (kind === 'telegram' && connection.keywords.length === 0) {
				return { tone: 'warning', text: NO_KEYWORDS_WARNING };
			}
			if (isMailKind(kind)) {
				return connection.lastRunAt === null
					? { tone: 'open', text: 'Warte auf den ersten Abruf (spätestens 5 Minuten) …' }
					: {
							tone: 'done',
							text: `Abgerufen, zuletzt ${formatBerlinDateTime(connection.lastRunAt)}.`
						};
			}
			if (connection.lastOkAt !== null) {
				return {
					tone: 'done',
					text: `Abruf erfolgreich, zuletzt ${formatBerlinDateTime(connection.lastOkAt)}.`
				};
			}
			return { tone: 'open', text: 'Noch kein Abruf.' };
		}
		case 'check': {
			if (connection === null) return { tone: 'open', text: 'Erst die Verbindung anlegen.' };
			if (connection.lastError !== '') {
				return { tone: 'error', text: `Letzte Prüfung fehlgeschlagen: ${connection.lastError}` };
			}
			if (connection.lastOkAt === null) return { tone: 'open', text: 'Noch nicht geprüft.' };
			if (connection.lastHint !== '') return { tone: 'warning', text: connection.lastHint };
			return {
				tone: 'done',
				text:
					kind === 'github'
						? `GitHub antwortet und die App liest die eingetragenen Repositorys, zuletzt ${formatBerlinDateTime(connection.lastOkAt)}.`
						: `Notion antwortet und die Integration sieht freigegebene Seiten, zuletzt ${formatBerlinDateTime(connection.lastOkAt)}.`
			};
		}
		default:
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
		if (step === undefined || !step.checked || satisfied(kind, index, facts)) continue;
		const check = stepCheck(kind, step.id, facts);
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
