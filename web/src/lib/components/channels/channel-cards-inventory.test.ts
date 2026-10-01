// Inventory of the channel cards (ADR-0026, addendum of 2026-09-30; plan kanal-karten KK-2 §3.3):
// every action and every display the cards had before the building block ChannelCard, and where
// it is now: state (lozenge), subtitle, info line, hint, main button, menu "•••" or details. Each
// card renders in the state the old action or display belonged to, and the test finds it in its
// new place, enabled: no function got lost. The table of the plan is this list.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import type {
	Connection,
	MailHelperStatus,
	MailScan,
	RunResult,
	SecretStatus
} from '$lib/domain/connections';
import { MAIL_INBOX_HINT } from '$lib/domain/connections';
import type { InboxKey } from '$lib/domain/inbox-keys';
import { EMPTY_IMPORT_KEYWORDS, type ImportKeywords } from '$lib/domain/keywords';
import type { NotionImportedSource } from '$lib/domain/notion';
import { RESTART_NEEDED } from '$lib/guidance/texts';
import { FlagStore } from '$lib/stores/flags.svelte';
import { ImportKeywordsStore, type ImportKeywordsData } from '$lib/stores/import-keywords.svelte';
import { InboxKeysStore, type InboxKeysData } from '$lib/stores/inbox-keys.svelte';
import { fakeNotionData, notionStoreOf } from '$lib/test/notion-fake';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ConnectionCard from './ConnectionCard.svelte';
import FilesCard from './FilesCard.svelte';
import NotionCard from './NotionCard.svelte';
import OwnInboxCard from './OwnInboxCard.svelte';
import WhatsAppWebCard from './WhatsAppWebCard.svelte';

useOverlayStubs();

afterEach(() => {
	document.body.innerHTML = '';
});

type Place = 'status' | 'subtitle' | 'info' | 'progress' | 'hint' | 'main' | 'menu' | 'details';

interface Entry {
	/** What the card had before KK-2 and where. */
	old: string;
	/** Where it is now. */
	place: Place;
	/** Label, name or text there. */
	now: string | RegExp;
}

interface Case {
	card: string;
	state: string;
	/** Renders the card and returns its article. */
	render: () => Promise<HTMLElement>;
	entries: Entry[];
}

// --- Cards in their states ---------------------------------------------------------------------

const SET: SecretStatus = { secret: true, allowlist: null };
const HELPER: MailHelperStatus = { state: 'running', version: '0.9.0', message: '' };

function connection(overrides: Partial<Connection> = {}): Connection {
	return {
		id: 'conn00000000001',
		type: 'calendar',
		label: 'Kalender',
		enabled: true,
		secretEnv: 'BYL_GOOGLE_CALENDAR_URL',
		allowlistEnv: '',
		lastRunAt: '2026-09-25 08:15:00.000Z',
		lastOkAt: '2026-09-24 08:15:00.000Z',
		lastError: '',
		lastHint: '',
		keywords: ['todo', 'ticket'],
		replySaved: true,
		replyNoMatch: true,
		mailProvider: '',
		mailUser: '',
		matchBody: false,
		runningSince: null,
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 08:00:00.000Z',
		...overrides
	};
}

const MAIL = connection({
	id: 'conn00000000002',
	type: 'mail',
	label: 'Web.de',
	secretEnv: 'BYL_WEBDE_PASSWORD',
	mailProvider: 'webde',
	mailUser: 'anna@web.de',
	matchBody: true,
	scan: { state: 'done', done: 10, total: 10, created: 2, fallback: false }
});

const RUN: RunResult = {
	status: 'ok',
	created: 3,
	duplicates: 1,
	updated: 0,
	skipped: 0,
	failed: 0,
	unmatched: 0,
	error: '',
	missing: []
};

async function connectionCard(
	value: Connection,
	options: {
		secret?: SecretStatus;
		running?: boolean;
		helper?: MailHelperStatus | null;
		lastRun?: RunResult | null;
	} = {}
): Promise<HTMLElement> {
	render(ConnectionCard, {
		props: {
			connection: value,
			secretStatus: options.secret ?? SET,
			running: options.running ?? false,
			helper: options.helper ?? (value.type === 'mail' ? HELPER : null),
			lastRun: options.lastRun ?? null,
			onrun: vi.fn(),
			onpick: vi.fn(),
			onedit: vi.fn(),
			onpause: vi.fn(),
			ondelete: vi.fn(),
			onsetup: vi.fn(),
			onscan: vi.fn(),
			onreplies: vi.fn(),
			// As on the page (ADR-0026, addendum KK-3).
			onrename: vi.fn(async () => null)
		}
	});
	return screen.getByRole('article', { name: value.label });
}

const NOTION = connection({
	id: 'conn00000000003',
	type: 'notion',
	label: 'Notion',
	secretEnv: 'BYL_NOTION_TOKEN',
	keywords: []
});

const IMPORTED: NotionImportedSource[] = [
	{
		id: 'source-1',
		type: 'page',
		title: 'Wochenplan',
		url: 'https://www.notion.so/Wochenplan-b1',
		count: 5,
		last: '2026-09-25 08:15:00.000Z',
		dateProperty: '',
		copyContent: false
	},
	{
		id: 'source-2',
		type: 'data_source',
		title: 'Aufgaben Haushalt',
		url: 'https://www.notion.so/Aufgaben-a1',
		count: 3,
		last: null,
		dateProperty: '',
		copyContent: false
	}
];

async function notionCard(
	value: Connection,
	options: { secret?: SecretStatus; checking?: boolean } = {}
): Promise<HTMLElement> {
	const data = fakeNotionData();
	data.imports.mockImplementation(async () => IMPORTED);
	data.check.mockImplementation(() => new Promise(() => undefined));
	const notion = notionStoreOf(data);
	render(NotionCard, {
		props: {
			connection: value,
			secretStatus: options.secret ?? SET,
			notion,
			onimport: vi.fn(),
			onchanged: vi.fn(),
			onpause: vi.fn(),
			onsetup: vi.fn(),
			ondelete: vi.fn(),
			onrename: vi.fn(async () => null)
		}
	});
	const article = screen.getByRole('article', { name: value.label });
	await vi.waitFor(() => expect(notion.imports(value.id)).not.toBeNull());
	if (options.checking) void notion.check(value.id, value.label);
	await tick();
	return article;
}

const KEYS: InboxKey[] = [
	{
		id: 'key000000000001',
		name: 'Laptop',
		tokenHint: 'byl_Ab12',
		created: '2026-09-28 08:00:00.000Z',
		lastUsedAt: '2026-09-28 10:15:00.000Z'
	},
	{
		id: 'key000000000002',
		name: 'Skript',
		tokenHint: 'byl_Cd34',
		created: '2026-09-28 09:00:00.000Z',
		lastUsedAt: null
	}
];

const session = () => ({ ensureValid: () => true, logout: vi.fn() });

function keysStore(listed: InboxKey[] | null, fail = false): InboxKeysStore {
	const data = {
		list: vi.fn<InboxKeysData['list']>(async () => {
			if (fail) throw new Error('Server nicht erreichbar.');
			return listed;
		}),
		create: vi.fn<InboxKeysData['create']>(),
		revoke: vi.fn<InboxKeysData['revoke']>(async () => undefined)
	} satisfies InboxKeysData;
	return new InboxKeysStore(data, session(), new FlagStore());
}

async function keywordsStore(): Promise<ImportKeywordsStore> {
	const settings: ImportKeywords = {
		...EMPTY_IMPORT_KEYWORDS,
		eml: { keywords: ['todo', 'rechnung', '#byl'], matchBody: false },
		whatsapp: { keywords: ['todo', 'einkauf'], matchBody: false },
		api: { keywords: ['todo', 'rechnung'], matchBody: false },
		'whatsapp-web': { keywords: ['#byl'], matchBody: false }
	};
	const data = {
		load: vi.fn<ImportKeywordsData['load']>(async () => settings),
		save: vi.fn<ImportKeywordsData['save']>(async (next) => next)
	} satisfies ImportKeywordsData;
	const store = new ImportKeywordsStore(data, session(), new FlagStore());
	await store.load();
	return store;
}

async function ownInboxCard(store: InboxKeysStore, load = true): Promise<HTMLElement> {
	if (load) await store.load();
	render(OwnInboxCard, { props: { store, importKeywords: await keywordsStore() } });
	return screen.getByRole('article', { name: 'Eigener Eingang (API)' });
}

async function whatsAppWebCard(): Promise<HTMLElement> {
	render(WhatsAppWebCard, {
		props: {
			importKeywords: await keywordsStore(),
			setupHref: '/einstellungen/kanaele?einrichten=whatsapp-web' as ResolvedPathname
		}
	});
	return screen.getByRole('article', { name: 'WhatsApp Web (Browser-Erweiterung)' });
}

async function filesCard(): Promise<HTMLElement> {
	render(FilesCard, { props: { importKeywords: await keywordsStore() } });
	return screen.getByRole('article', { name: 'Dateien hereinziehen' });
}

const SCANNING: MailScan = {
	state: 'running',
	done: 1200,
	total: 4800,
	created: 7,
	fallback: false
};

// --- The inventory -----------------------------------------------------------------------------

const CASES: Case[] = [
	{
		card: 'Google Calendar',
		state: 'eingerichtet',
		render: () => connectionCard(connection()),
		entries: [
			{ old: 'Lozenge „Eingerichtet“', place: 'status', now: 'Verbunden' },
			{ old: 'Untertitel „Google Calendar“', place: 'subtitle', now: 'Google Calendar' },
			{ old: 'Zeile „Letzter Abruf“', place: 'info', now: /^Zuletzt abgerufen / },
			{ old: 'Zeile „Letzter Abruf“ (Datum)', place: 'details', now: /^25\.09\.2026 10:15/ },
			{ old: '„zuletzt erfolgreich …“', place: 'details', now: /zuletzt erfolgreich 24\.09\.2026/ },
			{ old: 'Zeile „Ergebnis“', place: 'info', now: /· ohne Fehler$/ },
			{ old: 'Zeile „Ergebnis“', place: 'details', now: 'ohne Fehler' },
			// Since ADR-0026 (addendum KL) every keyword as a chip instead of "2 (todo, ticket)".
			{ old: 'Zeile „Stichwörter“', place: 'details', now: 'todo' },
			{ old: 'Zeile „Stichwörter“', place: 'details', now: 'ticket' },
			{ old: 'Knopf „Jetzt abrufen“', place: 'main', now: 'Jetzt abrufen' },
			{ old: 'Knopf „Bearbeiten“', place: 'menu', now: 'Stichwörter und Einstellungen …' },
			{ old: 'Menü „Pausieren“', place: 'menu', now: 'Pausieren' },
			{ old: 'Menü „Einrichtung ansehen“', place: 'menu', now: 'Einrichtung ansehen' },
			{ old: 'Menü „Löschen …“', place: 'menu', now: 'Löschen …' },
			{ old: '(neu) Hilfe „Kanäle und Zugangsdaten“', place: 'menu', now: 'Hilfe' }
		]
	},
	{
		card: 'Google Calendar',
		state: 'Abruf auf dieser Seite',
		render: () => connectionCard(connection(), { lastRun: RUN }),
		entries: [
			{ old: 'Zeile „Ergebnis“ mit Zahlen', place: 'info', now: /· 3 neu, 1 schon vorhanden$/ },
			{ old: 'Zeile „Ergebnis“ mit Zahlen', place: 'details', now: '3 neu, 1 schon vorhanden' }
		]
	},
	{
		card: 'Google Calendar',
		state: 'pausiert',
		render: () => connectionCard(connection({ enabled: false })),
		entries: [
			{ old: 'Lozenge „Pausiert“', place: 'status', now: 'Pausiert' },
			{ old: 'Hinweis „Pausiert: …“', place: 'hint', now: /Pausiert: Die App ruft nichts ab/ },
			{ old: 'Knopf „Fortsetzen“', place: 'main', now: 'Fortsetzen' },
			{ old: 'Menü „Fortsetzen“', place: 'main', now: 'Fortsetzen' },
			{ old: 'Menü „Einrichtung ansehen“', place: 'menu', now: 'Einrichtung ansehen' },
			{ old: 'Knopf „Bearbeiten“', place: 'menu', now: 'Stichwörter und Einstellungen …' },
			{ old: 'Menü „Löschen …“', place: 'menu', now: 'Löschen …' }
		]
	},
	{
		card: 'Google Calendar',
		state: 'Variable fehlt',
		render: () => connectionCard(connection(), { secret: { secret: false, allowlist: null } }),
		entries: [
			{ old: 'Lozenge „Nicht eingerichtet“', place: 'status', now: 'Einrichtung offen' },
			{ old: 'Hinweis „Zugangsdaten fehlen …“', place: 'hint', now: /Zugangsdaten fehlen/ },
			{ old: 'Knopf „Einrichtung fortsetzen“', place: 'main', now: 'Einrichtung fortsetzen' },
			{ old: 'Menü „Einrichtung ansehen“', place: 'main', now: 'Einrichtung fortsetzen' },
			{ old: 'Menü „Pausieren“', place: 'menu', now: 'Pausieren' },
			{ old: 'Menü „Löschen …“', place: 'menu', now: 'Löschen …' }
		]
	},
	{
		card: 'Google Calendar',
		state: 'Fehler',
		render: () => connectionCard(connection({ lastError: 'HTTP 404' })),
		entries: [
			{ old: 'Lozenge „Fehler“', place: 'status', now: 'Fehler' },
			{ old: 'Hinweis „Letzter Fehler: …“', place: 'hint', now: /Letzter Fehler: HTTP 404/ },
			{ old: '(neu) Zeile „Letzter Fehler“', place: 'details', now: 'HTTP 404' },
			{ old: 'Knopf „Jetzt abrufen“', place: 'main', now: 'Jetzt abrufen' }
		]
	},
	{
		card: 'Google Calendar',
		state: 'Abruf läuft',
		render: () => connectionCard(connection(), { running: true }),
		entries: [
			{ old: 'Lozenge „Wird abgerufen“', place: 'status', now: 'Wird abgerufen' },
			{ old: 'Knopf „Wird abgerufen …“ (gesperrt)', place: 'main', now: 'Wird abgerufen …' },
			{ old: 'Knopf „Bearbeiten“', place: 'menu', now: 'Stichwörter und Einstellungen …' }
		]
	},
	{
		card: 'Telegram-Bot',
		state: 'eingerichtet, Chat noch nicht freigegeben',
		render: () =>
			connectionCard(
				connection({
					id: 'conn00000000004',
					type: 'telegram',
					label: 'Bot',
					allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS',
					lastHint: 'Nachricht aus einem nicht freigegebenen Chat (Chat-ID 424242).'
				}),
				{ secret: { secret: true, allowlist: true } }
			),
		entries: [
			{ old: 'Untertitel „Telegram-Bot“', place: 'subtitle', now: 'Telegram-Bot' },
			{ old: 'Hinweis des letzten Abrufs', place: 'hint', now: /Chat-ID 424242/ },
			{ old: 'Knopf „Jetzt abrufen“', place: 'main', now: 'Jetzt abrufen' },
			{
				old: 'Knopf „Bearbeiten“ (Antwort ohne Stichwort)',
				place: 'menu',
				now: 'Stichwörter und Einstellungen …'
			},
			{ old: '(neu) Antwort ohne Stichwort', place: 'details', now: /Kein Stichwort erkannt/ },
			{
				old: '(neu) Schalter der Antworten im Chat (ADR-0016, Nachtrag vom 2026-10-01)',
				place: 'details',
				now: /Bestätigung senden \(„Im Eingang gespeichert“\)/
			}
		]
	},
	{
		card: 'Postfach (Web.de, Gmail)',
		state: 'eingerichtet',
		render: () => connectionCard(MAIL),
		entries: [
			{
				old: 'Untertitel „Postfach · Anbieter · Benutzer“',
				place: 'subtitle',
				now: 'Postfach · Web.de · anna@web.de'
			},
			{ old: 'Zeile „Hilfsprozess“', place: 'details', now: 'läuft (byl-mail 0.9.0)' },
			{ old: 'Zeile „Automatisch“', place: 'details', now: MAIL_INBOX_HINT },
			{
				old: 'Zeile „Posteingang“',
				place: 'details',
				now: 'durchsucht: 10 Mails, 2 Einträge übernommen'
			},
			{
				old: '(neu) Zeile „Durchsucht“',
				place: 'details',
				now: 'Betreff, Absender, Kopfzeilen und Text'
			},
			{ old: 'Knopf „Jetzt abrufen“', place: 'main', now: 'Jetzt abrufen' },
			{ old: 'Knopf „Aus dem Postfach wählen“', place: 'menu', now: 'Aus dem Postfach wählen …' },
			{
				old: 'Menü „Posteingang neu durchsuchen“',
				place: 'menu',
				now: 'Posteingang neu durchsuchen'
			},
			{
				old: 'Knopf „Bearbeiten“ (Suche im Text)',
				place: 'menu',
				now: 'Stichwörter und Einstellungen …'
			},
			{ old: 'Menü „Pausieren“', place: 'menu', now: 'Pausieren' },
			{ old: 'Menü „Einrichtung ansehen“', place: 'menu', now: 'Einrichtung ansehen' },
			{ old: 'Menü „Löschen …“', place: 'menu', now: 'Löschen …' }
		]
	},
	{
		card: 'Postfach (Web.de, Gmail)',
		state: 'Posteingang wird durchsucht',
		render: () => connectionCard({ ...MAIL, scan: SCANNING }),
		entries: [
			{
				old: 'Zeile „Posteingang“',
				place: 'info',
				now: 'Posteingang wird durchsucht: 1.200/4.800'
			},
			{ old: 'Fortschrittsbalken', place: 'progress', now: '1200/4800' },
			{ old: 'Knopf „Abbrechen“ (Durchsuchen)', place: 'main', now: 'Durchsuchen abbrechen' },
			{ old: 'Knopf „Jetzt abrufen“', place: 'menu', now: 'Jetzt abrufen' },
			{ old: 'Knopf „Aus dem Postfach wählen“', place: 'menu', now: 'Aus dem Postfach wählen …' }
		]
	},
	{
		card: 'Postfach (Web.de, Gmail)',
		state: 'Hilfsprozess läuft nicht',
		render: () => connectionCard(MAIL, { helper: { state: 'stopped', version: '', message: '' } }),
		entries: [
			{ old: '(neu) Lozenge „Neustart nötig“', place: 'status', now: 'Neustart nötig' },
			{
				old: 'Zeile „Hilfsprozess: läuft nicht …“',
				place: 'hint',
				now: /^Hilfsprozess läuft nicht/
			},
			{ old: 'Zeile „Hilfsprozess: läuft nicht …“', place: 'details', now: /^läuft nicht\./ },
			{ old: 'Knopf „Jetzt abrufen“', place: 'main', now: 'Jetzt abrufen' },
			{ old: 'Knopf „Aus dem Postfach wählen“', place: 'menu', now: 'Aus dem Postfach wählen …' }
		]
	},
	{
		card: 'Notion',
		state: 'eingerichtet',
		render: () => notionCard(NOTION),
		entries: [
			{ old: 'Lozenge „Eingerichtet“', place: 'status', now: 'Verbunden' },
			{ old: 'Untertitel', place: 'subtitle', now: 'Notion · Listen übernehmen, nur lesend' },
			{ old: 'Zeile „Übernommen“', place: 'info', now: /^8 Einträge aus 2 Quellen übernommen/ },
			{ old: 'Zeile „Letzter Abruf“', place: 'info', now: /zuletzt abgerufen / },
			{ old: 'Zeile „Letzter Abruf“ (Datum)', place: 'details', now: '25.09.2026 10:15' },
			{ old: 'Knopf „Listen übernehmen …“', place: 'main', now: 'Listen übernehmen …' },
			{ old: 'Knopf „Verbindung prüfen“', place: 'menu', now: 'Verbindung prüfen' },
			{ old: 'Menü „Einrichtung ansehen“', place: 'menu', now: 'Einrichtung ansehen' },
			{ old: 'Menü „Löschen …“', place: 'menu', now: 'Löschen …' },
			{ old: 'Link „So geht’s“', place: 'menu', now: 'Hilfe' },
			{ old: '„Bisher übernommen“: Link zu Notion', place: 'details', now: /Wochenplan/ },
			{
				old: '„Bisher übernommen“: Art, Zahl, zuletzt',
				place: 'details',
				now: /Seite · 5 Einträge · zuletzt/
			},
			{ old: '„Erneut abrufen“ je Quelle', place: 'details', now: 'Erneut abrufen: Wochenplan' },
			{
				old: '„Erneut abrufen“ je Quelle',
				place: 'details',
				now: 'Erneut abrufen: Aufgaben Haushalt'
			},
			{
				old: 'Hinweis zu „Erneut abrufen“',
				place: 'details',
				now: /nur Einträge, die noch nicht im Eingang sind/
			}
		]
	},
	{
		card: 'Notion',
		state: 'Verbindung wird geprüft',
		render: () => notionCard(NOTION, { checking: true }),
		entries: [
			{ old: 'Lozenge während der Prüfung', place: 'status', now: 'Wird geprüft' },
			{ old: 'Knopf „Wird geprüft …“ (gesperrt)', place: 'main', now: 'Wird geprüft …' }
		]
	},
	{
		card: 'Notion',
		state: 'pausiert (außerhalb der App)',
		render: () => notionCard({ ...NOTION, enabled: false }),
		entries: [
			{ old: 'Knopf „Fortsetzen“', place: 'main', now: 'Fortsetzen' },
			{ old: 'Menü „Einrichtung ansehen“', place: 'menu', now: 'Einrichtung ansehen' }
		]
	},
	{
		card: 'Notion',
		state: 'Variable fehlt',
		render: () => notionCard(NOTION, { secret: { secret: false, allowlist: null } }),
		entries: [
			{ old: 'Lozenge „Nicht eingerichtet“', place: 'status', now: 'Einrichtung offen' },
			{ old: 'Knopf „Einrichtung fortsetzen“', place: 'main', now: 'Einrichtung fortsetzen' },
			{ old: 'Menü „Löschen …“', place: 'menu', now: 'Löschen …' }
		]
	},
	{
		card: 'Eigener Eingang (API)',
		state: 'Schlüssel vorhanden',
		render: () => ownInboxCard(keysStore(KEYS)),
		entries: [
			{ old: '(neu) Lozenge', place: 'status', now: 'Verbunden' },
			{
				old: 'Untertitel',
				place: 'subtitle',
				now: 'Für eigene Skripte und die Erweiterung für WhatsApp Web'
			},
			{ old: '(neu) Zahl der Schlüssel', place: 'info', now: /^2 Schlüssel, zuletzt benutzt / },
			{ old: 'Erklärung', place: 'details', now: /Ein Schlüssel kann nur das/ },
			{
				old: 'Liste der Schlüssel',
				place: 'details',
				now: /Laptop.*byl_Ab12….*angelegt 28\.09\.2026/s
			},
			{ old: '„Widerrufen …“ je Schlüssel', place: 'details', now: 'Widerrufen …: Laptop' },
			{ old: '„Widerrufen …“ je Schlüssel', place: 'details', now: 'Widerrufen …: Skript' },
			// Since ADR-0026 (addendum KL) every keyword as a chip.
			{
				old: 'Zeile „Stichwörter für „mode: auto““',
				place: 'details',
				now: /^Stichwörter für „mode: auto“\s*todo\s*rechnung$/
			},
			{ old: 'Zeile „Stichwörter für „mode: auto““', place: 'details', now: 'rechnung' },
			{
				old: 'Knopf „Zugangsschlüssel erzeugen …“',
				place: 'main',
				now: 'Zugangsschlüssel erzeugen …'
			},
			{ old: 'Knopf „Stichwörter …“', place: 'menu', now: 'Stichwörter …' },
			{ old: 'Link „So geht’s“', place: 'menu', now: 'Hilfe' }
		]
	},
	{
		card: 'Eigener Eingang (API)',
		state: 'noch kein Schlüssel',
		render: () => ownInboxCard(keysStore([])),
		entries: [
			{
				old: 'Leerer Zustand „Noch kein Zugangsschlüssel“',
				place: 'info',
				now: 'Noch kein Zugangsschlüssel'
			},
			{
				old: 'Leerer Zustand (Satz)',
				place: 'details',
				now: /für jedes Programm, das Einträge bringen soll/
			},
			{
				old: 'Knopf „Zugangsschlüssel erzeugen …“',
				place: 'main',
				now: 'Zugangsschlüssel erzeugen …'
			}
		]
	},
	{
		card: 'Eigener Eingang (API)',
		state: 'vor dem Neustart',
		render: () => ownInboxCard(keysStore(null)),
		entries: [
			{
				old: 'Hinweis „Nach dem nächsten Neustart verfügbar“',
				place: 'info',
				now: RESTART_NEEDED.title
			},
			{
				old: 'Hinweis „Nach dem nächsten Neustart verfügbar“',
				place: 'hint',
				now: RESTART_NEEDED.text
			},
			{ old: '(neu) Lozenge „Neustart nötig“', place: 'status', now: 'Neustart nötig' }
		]
	},
	{
		card: 'Eigener Eingang (API)',
		state: 'Laden gescheitert',
		render: () => ownInboxCard(keysStore(KEYS, true)),
		entries: [
			{ old: 'Fehler mit „Erneut versuchen“', place: 'main', now: 'Erneut versuchen' },
			{
				old: 'Fehler mit „Erneut versuchen“',
				place: 'hint',
				now: /Server nicht erreichbar|nicht erreichbar|Fehler/
			},
			{ old: '(neu) Lozenge „Fehler“', place: 'status', now: 'Fehler' }
		]
	},
	{
		card: 'Eigener Eingang (API)',
		state: 'lädt',
		render: () => ownInboxCard(keysStore(KEYS), false),
		entries: [
			{
				old: '„Zugangsschlüssel werden geladen …“',
				place: 'info',
				now: 'Zugangsschlüssel werden geladen …'
			}
		]
	},
	{
		card: 'WhatsApp Web',
		state: 'ohne Wissen über die Erweiterung',
		render: () => whatsAppWebCard(),
		entries: [
			{ old: 'Untertitel', place: 'subtitle', now: 'Für Edge und Chrome, liest nur' },
			{
				old: 'Zeile „Stichwörter für „Automatisch““',
				place: 'info',
				now: 'Stichwörter für „Automatisch“: 1 (#byl)'
			},
			{ old: 'Erklärung', place: 'details', now: /sendet nie etwas in WhatsApp/ },
			{
				old: '(neu, ADR-0026 Nachtrag KL) Stichwörter in den Details',
				place: 'details',
				now: /^Stichwörter für „Automatisch“\s*#byl$/
			},
			{ old: 'Link „Einrichten“', place: 'main', now: 'Einrichten' },
			{ old: 'Knopf „Stichwörter …“', place: 'menu', now: 'Stichwörter …' },
			{ old: 'Link „So geht’s“', place: 'menu', now: 'Hilfe' }
		]
	},
	{
		card: 'Dateien (.eml auch aus Proton, .ics, WhatsApp-Export)',
		state: 'immer',
		render: () => filesCard(),
		entries: [
			{
				old: 'Zeile „Stichwörter: Mail … · Kalender … · WhatsApp …“',
				place: 'info',
				now: 'Stichwörter: Mail 3 · Kalender 0 · WhatsApp 2'
			},
			{ old: 'Erklärung', place: 'details', now: /Mail-Dateien \(\.eml, auch aus Proton\)/ },
			{
				old: '(neu, ADR-0026 Nachtrag KL) Stichwörter je Art in den Details',
				place: 'details',
				now: /^Mail \(\.eml\)\s*todo\s*rechnung\s*#byl$/
			},
			{
				old: '(neu, ADR-0026 Nachtrag KL) Stichwörter je Art in den Details',
				place: 'details',
				now: /^Kalender \(\.ics\)\s*keine$/
			},
			{
				old: '(neu, ADR-0026 Nachtrag KL) Stichwörter je Art in den Details',
				place: 'details',
				now: /^WhatsApp-Export\s*todo\s*einkauf$/
			},
			{ old: 'Link „Zum Eingang“', place: 'main', now: 'Zum Eingang' },
			{ old: 'Link „Stichwörter bearbeiten“', place: 'menu', now: 'Anleitungen und Stichwörter' }
		]
	}
];

// --- Where an entry is now ---------------------------------------------------------------------

const matches = (text: string, now: string | RegExp) =>
	typeof now === 'string' ? text === now : now.test(text);

const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

/** Visible label of a button or link, without the hidden name of the card. */
function visibleLabel(element: HTMLElement): string {
	const hidden = element.querySelector('.visually-hidden')?.textContent ?? '';
	const text = element.textContent ?? '';
	return clean(text.slice(0, text.length - hidden.length));
}

function menuItems(article: HTMLElement): HTMLElement[] {
	const trigger = within(article).queryByRole('button', { name: /^Weitere Aktionen für / });
	if (trigger === null) return [];
	const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
	return menu === null ? [] : within(menu).queryAllByRole('menuitem', { hidden: true });
}

async function detailsOf(article: HTMLElement): Promise<HTMLElement | null> {
	const toggle = within(article).queryByRole('button', { name: /^Details: / });
	if (toggle === null) return null;
	if (toggle.getAttribute('aria-expanded') !== 'true') await fireEvent.click(toggle);
	return document.getElementById(toggle.getAttribute('aria-controls') ?? '');
}

/** Whether the entry is at its new place; actions must be enabled there. */
async function isAt(article: HTMLElement, entry: Entry): Promise<boolean> {
	const { place, now } = entry;
	switch (place) {
		case 'status':
			return [...article.querySelectorAll('.head [data-tone]')].some((lozenge) =>
				matches(clean(lozenge.textContent), now)
			);
		case 'subtitle':
			return matches(clean(article.querySelector('.kind')?.textContent), now);
		case 'info':
			return matches(clean(article.querySelector('.info-line')?.textContent), now);
		case 'progress': {
			const bar = article.querySelector('progress');
			return (
				bar !== null && matches(`${bar.getAttribute('value')}/${bar.getAttribute('max')}`, now)
			);
		}
		case 'hint':
			return [...article.querySelectorAll(':scope > .section-message .text')].some((text) =>
				matches(clean(text.textContent).replace(/^(Hinweis|Achtung|Fehler|Erledigt):\s*/, ''), now)
			);
		case 'main': {
			const main = article.querySelectorAll<HTMLElement>('[data-card-primary]');
			return main.length === 1 && matches(visibleLabel(main[0] as HTMLElement), now);
		}
		case 'menu':
			return menuItems(article).some(
				(item) =>
					matches(clean(item.textContent), now) && item.getAttribute('aria-disabled') !== 'true'
			);
		case 'details': {
			const details = await detailsOf(article);
			if (details === null || details.hidden) return false;
			const actions = [
				...within(details).queryAllByRole('button'),
				...within(details).queryAllByRole('link')
			];
			const action = actions.some(
				(element) =>
					element.getAttribute('aria-disabled') !== 'true' &&
					matches(clean(element.getAttribute('aria-label') ?? element.textContent), now)
			);
			const texts = [...details.querySelectorAll<HTMLElement>('*')].map((element) =>
				clean(element.textContent)
			);
			return action || texts.some((text) => matches(text, now));
		}
	}
}

describe('inventory of the channel cards (KK-2)', () => {
	it.each(CASES.map((item) => [item.card, item.state, item] as const))(
		'%s (%s): every action and display is still there',
		async (_card, _state, item) => {
			const article = await item.render();
			// One header, one info line, exactly one main button.
			expect(within(article).getAllByRole('heading', { level: 4 })).toHaveLength(1);
			expect(article.querySelectorAll('.info-line')).toHaveLength(1);
			expect(article.querySelectorAll('[data-card-primary]')).toHaveLength(1);
			const missing: string[] = [];
			for (const entry of item.entries) {
				if (!(await isAt(article, entry)))
					missing.push(`${entry.old} → ${entry.place}: ${entry.now}`);
			}
			expect(missing).toEqual([]);
		}
	);

	it('offers "Umbenennen …" on the cards of connections only (KK-3)', async () => {
		const label = (items: HTMLElement[]) => items.map((item) => clean(item.textContent));
		for (const value of [connection(), NOTION]) {
			const article =
				value.type === 'notion' ? await notionCard(value) : await connectionCard(value);
			expect(label(menuItems(article)), value.label).toContain('Umbenennen …');
			document.body.innerHTML = '';
		}
		// Fixed ways of the app without a name of their own (ADR-0026, addendum KK-3).
		for (const render of [() => ownInboxCard(keysStore(KEYS)), whatsAppWebCard, filesCard]) {
			const article = await render();
			expect(label(menuItems(article))).not.toContain('Umbenennen …');
			expect(article.querySelector('form.rename')).toBeNull();
			document.body.innerHTML = '';
		}
	});

	it('covers every kind of card on the page "Kanäle"', () => {
		expect([...new Set(CASES.map((item) => item.card))]).toEqual([
			'Google Calendar',
			'Telegram-Bot',
			'Postfach (Web.de, Gmail)',
			'Notion',
			'Eigener Eingang (API)',
			'WhatsApp Web',
			'Dateien (.eml auch aus Proton, .ics, WhatsApp-Export)'
		]);
	});
});
