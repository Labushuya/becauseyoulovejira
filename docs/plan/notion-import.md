# Plan „Notion-Import“: bestehende Listen nur lesend als Kopien in den Eingang übernehmen

- **Stand:** NI-1 (Server) und NI-2 (Oberfläche, Hilfe, restliche Doku) umgesetzt; die manuellen Browser-Prüfungen BYL-E6-539 bis BYL-E6-547 sind offen. Neustart der App nötig (neue und geänderte Hooks, keine Migration).
- **Grundlage:**
  - Nutzerentscheidung vom 2026-09-29: „Da wir bislang nur mit Kopien gearbeitet haben, sollten wir das auch hier beibehalten: Variante 1 soll es sein. Notion nur nutzen, um andere bestehende Listen auf deren Inhalt hin zu übernehmen.“ Dazu die fachlichen Vorgaben des Advisors (unten §1).
  - [ADR-0041](../adr/0041-notion-listen-uebernehmen.md) (neu), [ADR-0016](../adr/0016-kanal-architektur-und-mail.md) §2 mit Nachtrag, [ADR-0014](../adr/0014-datenmodell-eingang.md), [ADR-0018](../adr/0018-secrets.md), [ADR-0020](../adr/0020-stichwoerter-pro-kanal.md) §4, [ADR-0031](../adr/0031-herkunft-sichern.md), [ADR-0032](../adr/0032-editor-tiptap-markdown.md), [ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md)
  - Ersetzt die Skizze in [E4-Plan](e4.md) Paket 18 (Nachtrag dort).
- **Einordnung:** Paketkürzel `NI`, Manifest-Block „Notion-Import“ ab `BYL-E6-520` (die Blöcke beginnen bei runden Nummern; 506 bis 519 bleiben frei), ADR-0041, **keine Migration**: `notion` steht seit E4 in `inbox_items.channel`, `tickets.source` und `connections.type`.

## 1. Vorgaben (Advisor, 2026-09-29)

1. Notion wird nur gelesen: nie schreiben, nichts zurückmelden, kein Abgleich in zwei Richtungen. Einträge sind Kopien mit Link zur Notion-Seite.
2. Kein Hintergrund-Abruf (kein Cron), keine Webhooks. Import auf Anstoß, dazu „Erneut abrufen“ je übernommener Quelle, das nur Neues holt.
3. Zugang über eine interne Integration mit „Read content“, einzelne Seiten und Datenbanken freigegeben; Token als `BYL_*`-Variable (Vorschlag `BYL_NOTION_TOKEN`) mit Anleitung, Neustart-Hinweis und Sync über `byl-control.ps1`, nur im Server, nie in Logs, Antworten oder Fehlern.
4. Offizielle REST-API auf festem Host, aktuelle `Notion-Version` und Datenquellen, Paginierung, Rate-Limit mit `Retry-After`, verständliche Fehler (401, 403, 404, 429 …). Überschreibbare Basis-Adresse nur im Testmodus und nur auf Loopback; Tests gegen einen lokalen Fake-Server.
5. Datenbanken: jede Zeile ein Eintrag, Titel, erste bzw. gewählte Datums-Eigenschaft als `source_date`, weitere Eigenschaften als lesbarer Text. Seiten mit Listen: To-do-, Aufzählungs- und nummerierte Punkte, verschachtelte als Text des Elternpunkts oder begründet anders. Option „Erledigte überspringen“ (Standard an).
6. Oberfläche unter Einstellungen → Kanäle: Karte „Notion (Listen übernehmen)“, Assistent (Integration anlegen → Token und Neustart → freigeben → „Verbindung prüfen“), Import-Dialog mit Quellen, Vorschau mit Auswahl (Muster von ADR-0036), Optionen „Erledigte überspringen“ und „Seiteninhalt als Kopie mitnehmen“ (Standard aus, Grenzen sichtbar), Fortschritt und Ergebnis; Ziel immer der Eingang, Umwandeln mit den bestehenden Funktionen.
7. Eingangseinträge mit Kanal `notion`, Symbol, Link; Deduplizierung über die Notion-ID samt Tombstones; Kopie nach ADR-0031 und Markdown nach ADR-0032; manueller Import ohne Stichwort-Regel.

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| NI-1 | Notion-Client (nur lesend, Paginierung, Drosselung, Wiederholung, Fehler), reine Regeln und Markdown-Umsetzung, Routen für Prüfen, Quellen, bisher übernommene Quellen, Vorschau und Import, Testmodus nur über einen Test-Hook, Fake-Server und Tests, ADR-0041, Nachtrag ADR-0016, dieser Plan, CLAUDE.md | BYL-E6-520 bis BYL-E6-528 |
| NI-2 | Art `notion` anlegbar (Hook und SPA), Datenschicht und Store, Katalog-Kachel, Assistent, Karte mit „Erneut abrufen“, Import-Dialog, „Datum als Fälligkeit“ für Notion-Einträge, Kopie-Status, „Alle Kanäle jetzt abrufen“ ohne Notion, Chip „Notion“, Hilfe „Notion“, Nachträge ADR-0019 und ADR-0036, README, CLAUDE.md, manuelle Browser-Fälle | BYL-E6-529 bis BYL-E6-538, manuell BYL-E6-539 bis BYL-E6-547 |

## 3. NI-1 im Detail

### 3.1 Server

- `app/pb_hooks/notion.pb.js`: fünf Routen unter `/api/byl/connections/{id}/notion/…` (`check`, `sources`, `imports`, `preview`, `import`), nur angemeldet und nur für sichtbare Notion-Verbindungen.
- `lib/notion-client.js` (Goja): die sechs lesenden Endpunkte als einzige Funktionen, `Notion-Version: 2026-03-11`, 350 ms Abstand über eine Marke im Store, Wiederholung nach 429/529 (`Retry-After`, bis 30 s) und 5xx, 30 s Zeitlimit, 20 MB, Antworten aus dem Text geparst, Blockbäume mit Grenzen.
- `lib/notion-rules.js` (rein, ES5): API und Testmodus, IDs, Fehlertexte, Wiederholung, Drosselung, Quellen der Suche, Datumswerte (Berlin, ganztägig, Offset), Eigenschaften als Text, Regel „Erledigt“, Zeilen und Listenpunkte als Einträge, Text, Kopie-Status, `source_meta`, Anfragen der Routen.
- `lib/notion-markdown.js` (rein, ES5): Rich Text und Blöcke als Markdown des Projekts, Maskierung, Grenzen.
- `lib/notion-service.js` (Goja): Routenlogik, Zustand an der Verbindung, Import über `inbox-service.ingest` mit Originaldatei `notion.json`, bisher übernommene Quellen per SQL aus `source_meta.notion`.
- `lib/secrets.js`: `ntn_…`- und `secret_…`-Tokens werden in Fehlertexten ersetzt.
- Nicht geändert: `connection-rules.js` (Notion wird erst mit NI-2 für Nutzer anlegbar; bis dahin legt in den Tests der Superuser an), `channel-runner.js` (`runConnection` antwortet für Notion `unsupported`).

### 3.2 Testmodus

- `tests/fixtures/pb_hooks/test-mode.pb.js` setzt beim Start die Marke `byl-test-mode` im Store. Nur mit ihr nimmt der Client `BYL_TEST_NOTION_PORT` (nur `127.0.0.1`) statt `api.notion.com`.
- `tests/support/pocketbase-harness.mjs` setzt `BYL_TEST_NOTION_PORT` für jede Wegwerf-Instanz auf Port 9 (geschlossen), wie `BYL_TELEGRAM_API_BASE`.

### 3.3 Tests

- Unit: `notion-rules.test.mjs`, `notion-markdown.test.mjs` (Rückprüfung mit dem Parser der Anzeige), `secrets.test.mjs`.
- Integration: `notion-import.test.mjs` gegen `tests/support/fake-notion.mjs` mit dem erfundenen Arbeitsbereich `tests/fixtures/notion/workspace.mjs` (Seitengröße 3, damit jede Liste paginiert): Prüfen, Quellen, Vorschau, Import, Duplikate, Tombstone, Seiteninhalt, Originaldatei, Zusammenfassung, 401/404/429, nur lesende Anfragen, Token nirgends. `harness.test.mjs` sieht die neue Variable des Harness.

## 4. NI-2 im Detail (Oberfläche)

### 4.1 Hook und Datenschicht

- `app/pb_hooks/lib/connection-rules.js`: `notion` in `CREATABLE_TYPES`, `SETTINGS_KEYS.notion` leer. Ein Nutzer legt die Verbindung mit Name und Variable an; Stichwörter und Einstellungen gibt es nicht. `web/src/lib/domain/connections.ts` spiegelt die Arten (Paritätstest `web-connections.test.mjs`), Vorschlag `BYL_NOTION_TOKEN`, und `fetchesAutomatically(type)` sagt, welche Arten von selbst abrufen (alle außer Notion).
- `web/src/lib/data/notion.ts`: `checkNotion`, `listNotionSources`, `listNotionImports`, `previewNotion`, `importNotion` auf die Routen aus NI-1. Fehler von Notion (200 mit `status: "error"`) und Ablehnungen (400, 503) kommen als Ergebnis mit Meldung und Grund, alles andere als `DataError`.
- `web/src/lib/domain/notion.ts` (rein): Typen, wählbare und vorgewählte Einträge, Teile (`importBatchSize`: 100, mit Seiteninhalt 10), Texte für Ergebnis, „Erneut abrufen“, Grenzen, Kürzung, Prüfung, Herkunft („Wochenplan (Seite), Abschnitt …“) und Kopie-Status.
- `web/src/lib/stores/notion.svelte.ts` (`NotionStore`, auf der Seite „Kanäle“): Prüfen mit Ansage, bisher übernommene Quellen je Verbindung, Quellen und Vorschau für den Dialog, Import in Teilen mit Fortschritt (hält beim ersten Fehler von Notion an), „Erneut abrufen“.

### 4.2 Oberfläche

- **Katalog:** Kachel „Notion (Listen übernehmen)“ mit dem Etikett „Import“, „Einrichten“ führt zu `?einrichten=notion`.
- **Assistent** (`channel-setup.ts`, `ChannelSetup.svelte`): Integration anlegen (Link zum Developer-Portal, nur „Read content“, was auszuschalten ist), Token setzen (`setx` mit verdecktem Wert), Verbinden, Neu starten (`neu-starten.bat`), Freigeben („•••“ → „Verbindungen“ → „Verbindung hinzufügen“), Prüfen. Der Fortschritt folgt den Fakten des Servers (ADR-0026 §4): „Freigeben“ gilt erst, wenn „Verbindung prüfen“ Erfolg hatte und kein Hinweis „sieht noch keine Seite“ besteht. Nach bestandener Prüfung führt „Listen übernehmen …“ in den Import-Dialog; der Assistent schließt sich vorher.
- **Karte** (`NotionCard.svelte` statt der allgemeinen Kanal-Karte): Zustand, letzter Abruf, Zahl der übernommenen Einträge, Liste „Bisher übernommen“ mit „Erneut abrufen“ je Quelle, „Listen übernehmen …“, „Verbindung prüfen“, im Menü „Einrichtung ansehen“ und „Löschen …“. Kein „Jetzt abrufen“, kein „Pausieren“, keine Stichwörter und keine Warnung wegen fehlender Stichwörter (`channel-health.ts`). „Alle Kanäle jetzt abrufen“ lässt Notion aus (`sync-all.svelte.ts`).
- **Import-Dialog** (`NotionImportDialog.svelte`, Modal L, ein Dialog mit zwei Schritten): Quelle wählen (Gruppen „Datenbanken“ und „Seiten“ als Radios, Suche nach Titel, „Liste aktualisieren“, schon übernommene Quellen markiert), dann Vorschau mit Optionen („Erledigte überspringen“ an; bei Datenbanken „Seiteninhalt als Kopie mitnehmen“ aus mit den Grenzen im Hinweis und „Datum aus“ mit „Kein Datum“), Einträgen mit Abschnitt, Datum, Kurztext und Zustand, Auswahl nach ADR-0036 §2 (`domain/selection.ts`: Kopf-Checkbox mit „teilweise“, Umschalt+Klick, nur Wählbares), „N Einträge in den Eingang übernehmen“ mit Fortschritt und danach „In den Eingang übernommen“ mit den Zahlen und dem Ergebnis je Eintrag. „Andere Quelle“ führt zurück.
- **Eingang:** Symbol und Chip „Notion“ (Nachtrag ADR-0019), im Panel „Aus“ (Seite bzw. Datenbank und Abschnitt), Kopie-Status „Nur Text“ für `properties` und `truncated` mit Hinweis, „Datum“ in den Kopfangaben des Ticket-Entwurfs.
- **„Datum als Fälligkeit“** (Nachtrag ADR-0036 §5): `eventDueDate` nimmt Notion-Einträge mit Datum, „Gesammelt umwandeln“ zeigt die Checkbox auch für sie, `listSourceEventDates` fragt `(kind = event || channel = notion)` ab.
- **Hilfe:** Abschnitt „Notion“ (neunter Abschnitt) mit Weg zum Assistenten, Freigabe, Optionen, „Erneut abrufen“ und Grenzen.

### 4.3 Tests

- Unit: `web/src/lib/domain/notion.test.ts`, `web/src/lib/stores/notion.test.ts`, Ergänzungen in `channel-setup.test.ts`, `channel-health.test.ts`, `sources.test.ts`, `inbox.test.ts`, `inbox-query.test.ts`, `sync-all.test.ts`, `bulk-convert.test.ts`, `tests/unit/connection-rules.test.mjs`.
- Komponenten: `web/src/lib/components/channels/notion.test.ts` (Karte, Dialog, Assistent), Ergänzungen in `channel-card.test.ts`, `bulk-convert-dialog.test.ts`, `ticket-table-selection.test.ts`, `filter-bar.test.ts`, `help-page.test.ts`.
- Integration: `tests/integration/web-data-notion.test.mjs` (Datenschicht gegen PocketBase und den Fake-Server), Ergänzungen in `connections.test.mjs` und `web-data-bulk.test.mjs`.
- Manuell (offen): Integration anlegen, Verbindung prüfen, Datenbank importieren, Seite mit To-do-Liste importieren, Erledigte überspringen, Seiteninhalt mitnehmen, Erneut abrufen, Token ungültig, Quelle nicht freigegeben (BYL-E6-539 bis BYL-E6-547).

## 5. Entscheidungen im Paket

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-29 | NI-1 | `Notion-Version` 2026-03-11 (aktuell laut Doku); Datenbanken über ihre Datenquellen (`GET /v1/data_sources/{id}`, `POST …/query`), Suche mit `data_source` und `page`. |
| 2026-09-29 | NI-1 | Keine Migration: Der Kanalwert besteht seit E4; die Liste der übernommenen Quellen folgt per SQL aus `source_meta.notion` der Einträge (kein neues Feld, kann nicht abweichen). |
| 2026-09-29 | NI-1 | Verschachtelte Punkte werden Text des Elternpunkts; Umschalter, Spalten, Hinweise und einklappbare Überschriften werden nach Listen durchsucht und benennen den Abschnitt, Unterseiten sind eigene Quellen. |
| 2026-09-29 | NI-1 | Datum eines Listenpunkts aus der ersten Datumserwähnung; ohne Offset in fremder Zeitzone nur der Tag. |
| 2026-09-29 | NI-1 | „Erledigt“ über die Status-Gruppe „Complete“, sonst ein passend benanntes oder das einzige Kontrollkästchen, sonst eine Auswahl „Status“. |
| 2026-09-29 | NI-1 | Markdown über die Blöcke statt `GET /v1/pages/{id}/markdown` (Notion-eigenes Format). Signierte Datei-Adressen werden nicht gespeichert. |
| 2026-09-29 | NI-1 | Testmodus nur über einen Hook der Tests (Marke im Store) plus Port auf `127.0.0.1`, nicht allein über eine Variable. |
| 2026-09-29 | NI-1 | Der Import liest die Quelle selbst neu und nimmt vom Browser nur IDs (keine Inhalte); je Anfrage höchstens 100 Einträge. |
| 2026-09-29 | NI-1 | Personen mit Namen nur mit der Fähigkeit „Benutzerinformationen ohne E-Mail-Adressen“; ohne sie die Zahl der Personen. |
| 2026-09-29 | NI-2 | Eigene Karte `NotionCard` statt der allgemeinen Kanal-Karte: Notion ruft nichts von selbst ab, die Aktionen sind andere (Import, Prüfen, „Erneut abrufen“ je Quelle). `fetchesAutomatically` hält Notion aus der Stichwort-Warnung und aus „Alle Kanäle jetzt abrufen“. |
| 2026-09-29 | NI-2 | Quellen und Einträge im Dialog als Listen mit Radios bzw. Checkboxen statt als Tabelle: Titel, Abschnitt, Datum und Kurztext untereinander lesen sich besser als Spalten; die Auswahl-Logik der Tabellen (`domain/selection.ts`) gilt unverändert. Umschalt wird beim `pointerdown` des Labels bzw. `keydown` der Checkbox gemerkt, weil `change` die Taste nicht kennt. |
| 2026-09-29 | NI-2 | Kein Dialog aus einem Dialog: „Listen übernehmen …“ im Assistenten schließt den Assistenten und öffnet dann den Import-Dialog; nach dem Schließen des Dialogs wird die Verbindung neu gelesen. |
| 2026-09-29 | NI-2 | Mit Seiteninhalt höchstens 10 Einträge je Import-Anfrage (sonst 100): Jede Zeile kann dann bis zu 40 Anfragen an Notion brauchen; kleinere Teile halten jede Anfrage kurz und den Fortschritt sichtbar. |
| 2026-09-29 | NI-2 | „Erneut abrufen“ im Store statt im Server: Vorschau der Quelle, dann Import genau der Einträge, die noch nicht im Eingang sind, mit „Erledigte überspringen“ und den Optionen des letzten Imports; ohne Neues keine Import-Anfrage. So braucht es keine weitere Route. |
| 2026-09-29 | NI-2 | Das Datum eines Notion-Eintrags zählt wie das eines Termins (`eventDueDate`, `listSourceEventDates`), nie automatisch (Nachtrag ADR-0036 §5). |
