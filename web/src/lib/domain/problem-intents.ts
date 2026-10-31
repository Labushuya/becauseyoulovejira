// Catalog of intents (FP-1, ADR-0071 §3): what a failed request tried, in the words of the user.
// Every message of a failed action names its intent in "Details". An action may name it itself
// (`withIntent` in data/errors.ts); otherwise this catalog finds it from the method and the path of
// the request; without a match it is UNKNOWN_INTENT. Pure: paths come without origin and query.
// Keys are "METHOD path" with `*` for exactly one segment of the path (the `{id}` of a route); a
// more specific one (fewer `*`) wins, e.g. "App neu starten" over "Aktion der Seite System
// ausführen". tests/unit/web-problem-intents.test.mjs reads the routes of app/pb_hooks and checks
// that every /api/byl/... route has an entry here and every entry a route, and that every
// collection the SPA reaches has its entries.

/** Without an explicit intent and without a match of the catalog. */
export const UNKNOWN_INTENT = 'Unbekannte Aktion';

/** Every route of app/pb_hooks under /api/byl/, in the order of the hook files. */
export const BYL_ROUTE_INTENTS: Readonly<Record<string, string>> = Object.freeze({
	// accounts.pb.js (ADR-0056)
	'GET /api/byl/accounts': 'Konten laden',
	'POST /api/byl/accounts': 'Konto anlegen',
	'POST /api/byl/accounts/*/password': 'Neues Passwort vergeben',
	'POST /api/byl/accounts/*/disabled': 'Konto sperren oder entsperren',
	'POST /api/byl/accounts/households/*/owner': 'Neuen Besitzer des Haushalts bestimmen',
	'POST /api/byl/accounts/households/*/delete': 'Verwaisten Haushalt löschen',
	'POST /api/byl/accounts/*/admin': 'Recht „Verwalter der App“ ändern',
	// area.pb.js (ADR-0061)
	'POST /api/byl/area/move': 'In einen anderen Bereich verschieben',
	// backup.pb.js (ADR-0046)
	'GET /api/byl/backup': 'Sicherung laden',
	'GET /api/byl/backup/notice': 'Hinweise der Sicherung laden',
	'POST /api/byl/backup/run': 'Jetzt sichern',
	'POST /api/byl/backup/verify': 'Sicherung prüfen',
	'POST /api/byl/backup/restore': 'Sicherung wiederherstellen',
	'GET /api/byl/backup/restore': 'Stand der Wiederherstellung laden',
	'POST /api/byl/backup/settings': 'Einstellungen der Sicherung speichern',
	'POST /api/byl/backup/passphrase': 'Passphrase der Sicherung speichern',
	// channels.pb.js (ADR-0016)
	'POST /api/byl/connections/*/run': 'Kanal jetzt abrufen',
	// connections.pb.js (ADR-0018, ADR-0016 §6, ADR-0020)
	'GET /api/byl/connections/*/secret-status': 'Zugangsdaten des Kanals prüfen',
	'GET /api/byl/connections/*/mailbox': 'Mails des Postfachs laden',
	'POST /api/byl/connections/*/mailbox/import': 'Mails aus dem Postfach übernehmen',
	'GET /api/byl/mail-helper': 'Mail-Helfer prüfen',
	'POST /api/byl/connections/*/scan': 'Postfach durchsuchen',
	// context.pb.js (ADR-0057)
	'GET /api/byl/context': 'Kontext der App laden',
	// credentials.pb.js (BW-3, ADR-0075)
	'GET /api/byl/credentials': 'Zugangsdaten der Kanäle laden',
	'POST /api/byl/credentials/set': 'Zugangsdaten setzen',
	'POST /api/byl/credentials/remove': 'Zugangsdaten entfernen',
	'GET /api/byl/credentials/restart-notice': 'Hinweis zum Neustart laden',
	// day-plans.pb.js (ADR-0065)
	'GET /api/byl/dayplan': 'Tagesplan laden',
	'POST /api/byl/dayplan/items': 'Zum Tagesplan hinzufügen',
	'POST /api/byl/dayplan/adopt': 'Vorschläge übernehmen',
	'POST /api/byl/dayplan/items/*/check': 'Im Tagesplan abhaken',
	'POST /api/byl/dayplan/items/*/uncheck': 'Haken im Tagesplan zurücknehmen',
	'POST /api/byl/dayplan/items/*/tomorrow': 'Auf morgen schieben',
	'POST /api/byl/dayplan/items/*/remove': 'Aus dem Tagesplan entfernen',
	'POST /api/byl/dayplan/items/*/move': 'Tagesplan sortieren',
	'POST /api/byl/dayplan/order': 'Tagesplan sortieren',
	'POST /api/byl/dayplan/settings': 'Quellen des Tagesplans speichern',
	// extension.pb.js (ADR-0038 §4)
	'GET /api/byl/whatsapp-web/extension': 'Erweiterung für WhatsApp Web prüfen',
	// folders.pb.js (ADR-0051)
	'GET /api/byl/connections/*/folders': 'Ordner des Kanals laden',
	'GET /api/byl/connections/*/folders/existing': 'Vorhandene Dateien laden',
	'POST /api/byl/connections/*/folders/adopt': 'Vorhandene Dateien übernehmen',
	'GET /api/byl/folders/items/*': 'Datei ansehen',
	'GET /api/byl/folders/items/*/file': 'Datei ansehen',
	// github.pb.js (ADR-0050)
	'GET /api/byl/connections/*/github': 'Repositories des Kanals laden',
	'POST /api/byl/connections/*/github/check': 'GitHub-Verbindung prüfen',
	'GET /api/byl/connections/*/github/repos': 'Repositories von GitHub laden',
	// host.pb.js (ADR-0028)
	'GET /api/byl/host': 'Plattform des Servers laden',
	// household.pb.js (ADR-0058, ADR-0061)
	'GET /api/byl/household': 'Haushalt laden',
	'POST /api/byl/household': 'Haushalt gründen',
	'POST /api/byl/household/rename': 'Haushalt umbenennen',
	'POST /api/byl/household/invites': 'Einladungscode erzeugen',
	'POST /api/byl/household/invites/*/revoke': 'Einladungscode zurückziehen',
	'POST /api/byl/household/join': 'Haushalt beitreten',
	'POST /api/byl/household/members/*/rights': 'Rechte eines Mitglieds ändern',
	'POST /api/byl/household/members/*/remove': 'Mitglied entfernen',
	'POST /api/byl/household/members/*/transfer': 'Haushalt übergeben',
	'POST /api/byl/household/leave': 'Haushalt verlassen',
	'POST /api/byl/household/dissolve': 'Haushalt auflösen',
	'POST /api/byl/household/retention': 'Aufbewahrung des Papierkorbs speichern',
	// inbox-keys.pb.js (ADR-0038)
	'POST /api/byl/inbox/keys': 'Zugangsschlüssel erzeugen',
	'GET /api/byl/inbox/ingest': 'Zugangsschlüssel testen',
	'POST /api/byl/inbox/ingest': 'Eintrag in den eigenen Eingang senden',
	// inbox.pb.js (ADR-0017, ADR-0031 §6)
	'POST /api/byl/inbox/ics/preview': 'Kalenderdatei lesen',
	'POST /api/byl/inbox/ics': 'Termine übernehmen',
	'POST /api/byl/inbox/lookup': 'Doppelte Einträge prüfen',
	'POST /api/byl/inbox/*/page': 'Seiteninhalt sichern',
	// ingest.pb.js (ADR-0016 §5, called by the mail helper)
	'GET /api/byl/ingest/connections': 'Mail-Verbindungen für den Helfer laden',
	'POST /api/byl/ingest/items': 'Mail in den Eingang übernehmen',
	'POST /api/byl/ingest/connections/*/status': 'Ergebnis eines Mail-Abrufs melden',
	// notion.pb.js (ADR-0041)
	'POST /api/byl/connections/*/notion/check': 'Notion-Verbindung prüfen',
	'GET /api/byl/connections/*/notion/sources': 'Listen von Notion laden',
	'GET /api/byl/connections/*/notion/imports': 'Übernommene Notion-Listen laden',
	'POST /api/byl/connections/*/notion/preview': 'Vorschau der Notion-Liste laden',
	'POST /api/byl/connections/*/notion/import': 'Aus Notion übernehmen',
	// presence.pb.js (ADR-0035)
	'GET /api/byl/presence': 'Offene Tabs zählen',
	'POST /api/byl/attention': 'Offene Tabs benachrichtigen',
	'GET /api/byl/attention/*': 'Bestätigung eines Tabs abfragen',
	'POST /api/byl/attention/*/ack': 'Hinweis bestätigen',
	// security.pb.js (ADR-0055)
	'GET /api/byl/security': 'Sicherheit laden',
	'POST /api/byl/security/settings': 'Einstellungen der Sicherheit speichern',
	'POST /api/byl/security/hosts': 'Zusätzliche Hosts speichern',
	'GET /api/byl/security/lan': 'Zugriff im Heimnetz laden',
	'POST /api/byl/security/lan': 'Zugriff im Heimnetz speichern',
	'POST /api/byl/security/lan/firewall': 'Firewall-Regel ändern',
	'GET /api/byl/security/notice': 'Hinweise der Sicherheit laden',
	// storage.pb.js (ADR-0047 §6); the actions with their names of the page
	'GET /api/byl/storage': 'Speicher laden',
	'POST /api/byl/storage/actions/*': 'Aktion der Seite Speicher ausführen',
	'POST /api/byl/storage/actions/vacuum': 'Datenbank verdichten',
	'POST /api/byl/storage/actions/leftovers': 'Liegengebliebenes aufräumen',
	'POST /api/byl/storage/actions/discarded': 'Verworfene jetzt leeren',
	// system.pb.js (ADR-0043); the actions of its whitelist
	'GET /api/byl/system': 'Status der App laden',
	'GET /api/byl/system/doctor': 'Umgebung prüfen',
	'GET /api/byl/system/logs': 'Logs laden',
	'POST /api/byl/system/actions/*': 'Aktion der Seite System ausführen',
	'POST /api/byl/system/actions/restart': 'App neu starten',
	'POST /api/byl/system/actions/mail-restart': 'Mail-Helfer neu starten',
	'POST /api/byl/system/actions/autostart-on': 'Autostart einschalten',
	'POST /api/byl/system/actions/autostart-off': 'Autostart ausschalten',
	// ticket-sources.pb.js (ADR-0067)
	'GET /api/byl/tickets/*/ticket-sources': 'Quellen und Folge-Tickets laden',
	'POST /api/byl/tickets/*/ticket-sources': 'Ticket als Quelle hinzufügen',
	'POST /api/byl/tickets/*/ticket-sources/*/remove': 'Quell-Ticket entfernen',
	'POST /api/byl/tickets/*/follow-up': 'Folge-Ticket anlegen',
	// tickets.pb.js (ADR-0031, ADR-0045, ADR-0069, ADR-0070)
	'POST /api/byl/tickets/*/delete': 'Ticket in den Papierkorb legen',
	'POST /api/byl/tickets/create': 'Ticket anlegen',
	'GET /api/byl/tickets/create': 'Optionen für neue Tickets laden',
	'POST /api/byl/tickets/*/duplicate': 'Ticket duplizieren',
	'POST /api/byl/tickets/*/subtasks/transfer': 'Unteraufgaben übertragen',
	'GET /api/byl/tickets/*/duplicate-target': 'Ziel des Duplikats laden',
	// trash.pb.js (ADR-0037, ADR-0047)
	'GET /api/byl/trash': 'Papierkorb laden',
	'GET /api/byl/trash/*': 'Ticket im Papierkorb laden',
	'POST /api/byl/trash/*/restore': 'Aus dem Papierkorb wiederherstellen',
	'POST /api/byl/trash/*/resolve': 'Abhängigkeiten auflösen',
	'POST /api/byl/trash/*/purge': 'Endgültig löschen',
	'POST /api/byl/trash/empty': 'Papierkorb leeren'
});

/** The intents of the record API of one collection (list, view, create, update, delete). */
export interface CollectionIntents {
	readonly list: string;
	readonly view: string;
	readonly create: string;
	readonly update: string;
	readonly delete: string;
}

function crud(one: string, many: string): CollectionIntents {
	return {
		list: `${many} laden`,
		view: `${one} laden`,
		create: `${one} anlegen`,
		update: `${one} speichern`,
		delete: `${one} löschen`
	};
}

/** Every collection the SPA reaches through the record API of PocketBase. */
export const COLLECTION_INTENTS: Readonly<Record<string, CollectionIntents>> = Object.freeze({
	tickets: crud('Ticket', 'Tickets'),
	projects: crud('Projekt', 'Projekte'),
	tags: crud('Tag', 'Tags'),
	comments: crud('Kommentar', 'Kommentare'),
	inbox_items: { ...crud('Eintrag des Eingangs', 'Eingang'), update: 'Eintrag bearbeiten' },
	connections: { ...crud('Kanal', 'Kanäle'), create: 'Kanal verbinden' },
	recurrence_rules: crud('Wiederholung', 'Wiederholungen'),
	users: crud('Konto', 'Konten'),
	ticket_reads: {
		list: 'Lesestatus laden',
		view: 'Lesestatus laden',
		create: 'Als gelesen markieren',
		update: 'Als gelesen markieren',
		delete: 'Als ungelesen markieren'
	},
	ticket_pins: {
		list: 'Angeheftete Tickets laden',
		view: 'Angeheftetes Ticket laden',
		create: 'Ticket anheften',
		update: 'Ticket anheften',
		delete: 'Anheften lösen'
	},
	ticket_history: crud('Verlauf', 'Verlauf'),
	ticket_sources: crud('Quell-Ticket', 'Quell-Tickets'),
	inbox_keys: crud('Zugangsschlüssel', 'Zugangsschlüssel'),
	day_plans: crud('Tagesplan', 'Tagespläne'),
	day_plan_items: crud('Eintrag des Tagesplans', 'Einträge des Tagesplans'),
	day_plan_settings: crud('Einstellungen des Tagesplans', 'Einstellungen des Tagesplans')
});

/** Requests of the SDK outside the record API. */
export const CORE_INTENTS: Readonly<Record<string, string>> = Object.freeze({
	'POST /api/collections/users/auth-with-password': 'Anmelden',
	'POST /api/collections/users/auth-refresh': 'Sitzung prüfen',
	'POST /api/realtime': 'Live-Aktualisierung verbinden',
	'GET /api/health': 'Server prüfen',
	'POST /api/files/token': 'Datei öffnen'
});

/** The keys of the record API of every collection of COLLECTION_INTENTS. */
function collectionEntries(): [string, string][] {
	return Object.entries(COLLECTION_INTENTS).flatMap(([name, intents]) => {
		const records = `/api/collections/${name}/records`;
		return [
			[`GET ${records}`, intents.list],
			[`POST ${records}`, intents.create],
			[`GET ${records}/*`, intents.view],
			[`PATCH ${records}/*`, intents.update],
			[`DELETE ${records}/*`, intents.delete]
		] satisfies [string, string][];
	});
}

/** One entry of the whole catalog. */
export interface IntentRoute {
	readonly method: string;
	/** Path with `*` for one segment. */
	readonly path: string;
	readonly intent: string;
}

function toRoute([key, intent]: [string, string]): IntentRoute {
	const space = key.indexOf(' ');
	return { method: key.slice(0, space), path: key.slice(space + 1), intent };
}

/** The whole catalog: the routes of BYL, the record API and the rest of the SDK. */
export const INTENT_CATALOG: readonly IntentRoute[] = Object.freeze(
	[
		...Object.entries(BYL_ROUTE_INTENTS),
		...collectionEntries(),
		...Object.entries(CORE_INTENTS)
	].map(toRoute)
);

const segments = (path: string): string[] => path.split('/').filter((part) => part !== '');

/** Whether `pattern` (with `*` for one segment) matches `path`, both without query. */
export function matchesIntentPath(pattern: string, path: string): boolean {
	const want = segments(pattern);
	const have = segments(path);
	return (
		want.length === have.length && want.every((part, index) => part === '*' || part === have[index])
	);
}

/** Number of `*` in a pattern: fewer is more specific. */
function wildcards(pattern: string): number {
	return segments(pattern).filter((part) => part === '*').length;
}

/**
 * The intent of the catalog for a request, or null: the most specific pattern of the method that
 * matches the path. `path` is without origin, query and hash (`requestPathOf` of problems.ts).
 */
export function intentOf(method: string | null, path: string): string | null {
	if (method === null) return null;
	const upper = method.toUpperCase();
	let best: IntentRoute | null = null;
	for (const route of INTENT_CATALOG) {
		if (route.method !== upper || !matchesIntentPath(route.path, path)) continue;
		if (best === null || wildcards(route.path) < wildcards(best.path)) best = route;
	}
	return best?.intent ?? null;
}

/** The key of a route of app/pb_hooks in this catalog: `{id}` becomes `*`. */
export function routeKey(method: string, route: string): string {
	return `${method.toUpperCase()} ${route.replace(/\{[^}/]+\}/g, '*')}`;
}
