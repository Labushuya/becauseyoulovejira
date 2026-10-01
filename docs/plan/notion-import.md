# Plan „Notion-Import“: bestehende Listen nur lesend als Kopien in den Eingang übernehmen

- **Stand:** NI-1 (Server) und NI-2 (Oberfläche, Hilfe, restliche Doku) umgesetzt; die manuellen Browser-Prüfungen BYL-E6-539 bis BYL-E6-547 sind offen. Neustart der App nötig (neue und geänderte Hooks, keine Migration). Fehlerbehebung vom 2026-09-30 (§6): Import in Blöcken mit sichtbarem Fortschritt und Ergebnis, abgestimmte Zeitgrenzen (BYL-E6-560 bis BYL-E6-565, manuell BYL-E6-566 offen); wieder mit Neustart. NI-3 vom 2026-10-01 (§7): mehrere Quellen in einem Durchgang, „Alle erneut abrufen“, „Unterseiten einbeziehen“ und ein freier Variablenname für weitere Verbindungen (BYL-E6-860 bis BYL-E6-865, manuell BYL-E6-866 bis BYL-E6-868 offen); wieder mit Neustart.
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
| NI-3 | Nutzerwunsch vom 2026-10-01: mehrere Quellen im Dialog, Vorschau nach Quelle gruppiert, ein Durchgang mit Ergebnis je Quelle, „Alle erneut abrufen“ an der Karte, „Unterseiten einbeziehen“, freier Variablenname im Assistenten; Nachtrag ADR-0041, Hilfe, README, CLAUDE.md (§7) | BYL-E6-860 bis BYL-E6-865, manuell BYL-E6-866 bis BYL-E6-868 |

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
- `web/src/lib/domain/notion.ts` (rein): Typen, wählbare und vorgewählte Einträge, Teile (`importBatchSize`: 100, mit Seiteninhalt 10; seit §6 Blöcke von 10 je 100 Einträgen der Quelle, mit Seiteninhalt 5), Texte für Ergebnis, „Erneut abrufen“, Grenzen, Kürzung, Prüfung, Herkunft („Wochenplan (Seite), Abschnitt …“) und Kopie-Status.
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
| 2026-09-30 | Fix | Import in Blöcken von 10 je 100 Einträgen der Quelle (mit Seiteninhalt 5) statt bis 100 je Anfrage: echter Fortschritt bei etwa einer Anfrage an Notion je 10 Einträge, weil jede Anfrage die Quelle neu liest. |
| 2026-09-30 | Fix | Zeitgrenzen: 30 s je Versuch an Notion, 90 s je Anfrage der App (Frist für Versuche und Wartezeiten), neue Einträge nur 30 s lang, der Rest als `pending` zurück; 150 s im Browser; alles unter den 5 Minuten von PocketBase und Firefox. |
| 2026-09-30 | Fix | Abbrechen als „Nach diesem Block anhalten“ (auch Esc), weil der Server eine laufende Anfrage zu Ende führt; ein Eintrag verlässt die Auswahl nur mit seinem eigenen Erfolg. |
| 2026-09-30 | Fix | Die Schleife steht ohne Svelte in `stores/notion-run.ts`, damit die Integrationstests sie gegen PocketBase prüfen; Kurz-Grenzen für Tests nur im Testmodus über `BYL_TEST_NOTION_TIMING`. |
| 2026-10-01 | NI-3 | Mehrere Quellen ohne neue Route: Vorschau und Import bleiben je Quelle, die Schleife über die Quellen (`runSources`) und „Alle erneut abrufen“ (`refetchSources`) stehen in `stores/notion-run.ts`. Ein Fehler nur einer Quelle (`reason: "source"`) beendet nur diese, einer der Verbindung den Durchgang. |
| 2026-10-01 | NI-3 | Optionen global statt je Quelle („Erledigte überspringen“, „Seiteninhalt als Kopie mitnehmen“, „Unterseiten einbeziehen“); nur „Datum aus“ je Datenbank, weil es vom Schema abhängt. Ein Eintrag, den eine Gruppe weiter oben schon zeigt, ist in den späteren gesperrt („Steht schon unter …“). |
| 2026-10-01 | NI-3 | „Unterseiten einbeziehen“ nur auf Wunsch (Standard aus): höchstens 50 Unterseiten bis zur dritten Ebene im gemeinsamen Budget der Seite (100 Anfragen, 5 000 Blöcke); 404/403 einer Unterseite heißt „nicht sichtbar“ und wird gezählt. Die Option steht in `source_meta.notion.subpages`, damit „Erneut abrufen“ sie übernimmt. Die 30 s für neue Einträge zählen ab dem Ende des Lesens. |
| 2026-10-01 | NI-3 | Mehrere Notion-Verbindungen gingen schon; der Assistent schlägt jetzt für jede Art einen Variablennamen vor, den noch keine Verbindung nutzt (`freeVariableName`), damit `setx` kein Token überschreibt. |
| 2026-10-01 | NI-3 | „Alle erneut abrufen“ im Menü „•••“ (Infozeile mit Quelle und Balken, Hauptknopf „Nach diesem Block anhalten“); das Ergebnis je Quelle steht bis zum Neuladen in „Bisher übernommen“, die Summe als Flag. |

## 6. Fehlerbehebung vom 2026-09-30: Rückmeldung und Laufzeiten beim Import

Nutzerbericht: Nach „45 Einträge in den Eingang übernehmen“ war die Auswahl leer, der Knopf hieß „0 Einträge …“, nur der Mauszeiger zeigte „beschäftigt“; weder Fortschritt noch Ergebnis noch Fehler. Befund und Entscheidung im [Nachtrag von ADR-0041](../adr/0041-notion-listen-uebernehmen.md#nachtrag-2026-09-30-rückmeldung-und-laufzeiten-beim-import): Der Import lief in einer Anfrage in unter einer Sekunde durch, Fortschritt und Ergebnis standen außer Sicht unter der Liste, und der gesperrte Knopf zeigte `cursor: progress`.

- **Server** (`notion-rules.js`, `notion-client.js`, `notion-service.js`): `LIMITS.routeSeconds` (90) und `importSeconds` (30), `timingOf`, `attemptSeconds`, `isTimeoutText`; der Client rechnet eine Frist ab seiner Erzeugung, gibt jedem Versuch nur den Rest und meldet Zeitüberschreitungen mit dem Code `timeout` („zu langsam“, kein Fehler der Verbindung); der Import gibt `pending` zurück, Fehlerantworten nennen `reason` und behalten `items`.
- **SPA:** `data/notion.ts` wartet 150 s und liefert `pending` bzw. bei Fehlern `partial`; `stores/notion-run.ts` sendet die Blöcke, stellt Zurückgegebenes vorn an, hält auf Wunsch nach einem Block an und bricht bei einer Antwort ohne Ergebnis ab; `NotionStore.runImport` lässt einen Lauf je Verbindung zu und macht aus jedem Fehler außer der Sitzung eine Meldung; `NotionImportDialog` zeigt Knopftext, Fortschritt und Ergebnis über den Optionen, „Nach diesem Block anhalten“, „Im Eingang ansehen“ und „Nicht übernommen“.
- **Tests:** `tests/unit/notion-rules.test.mjs` (Zeitgrenzen), `tests/integration/notion-import-blocks.test.mjs` (45 Zeilen in Blöcken, langsamer Fake, 429, `pending`, Zeitüberschreitung, Dedup), `web/src/lib/stores/notion-run.test.ts`, `notion.test.ts` (Store), `domain/notion.test.ts`, `components/channels/notion.test.ts` („taking 45 rows over“); der Fake kann langsam antworten (`slow`), das Fixture hat `manyRows`.
- **Manuell offen:** BYL-E6-566 „45 Einträge übernehmen: Fortschritt und Ergebnis sichtbar“.

## 7. NI-3 vom 2026-10-01: mehrere Quellen, „Alle erneut abrufen“, Unterseiten

Nutzerwunsch: „Es macht Sinn, mehrere Quellen als Bezug mit reinzunehmen.“ Befunde und Entscheidungen im [Nachtrag von ADR-0041](../adr/0041-notion-listen-uebernehmen.md#nachtrag-2026-10-01-mehrere-quellen-alle-erneut-abrufen-unterseiten-und-mehrere-verbindungen); keine Migration, keine neue Route.

- **Server** (`notion-rules.js`, `notion-client.js`, `notion-service.js`): `childPagesOf`, `collectSubpages` (Breite zuerst, `LIMITS.subpages` 50, `subpageDepth` 3, nicht sichtbare gezählt), `sectionOf` mit dem Pfad der Unterseite, `subpages` in `parseRequest` (nur Seiten) und `source_meta.notion.subpages`; `client.tree` teilt ein Budget über mehrere Bäume; die Vorschau nennt `subpages` und `subpages_hidden`, `imports` die Option; das Zeitfenster für neue Einträge beginnt nach dem Lesen der Quelle (`client.importMs`).
- **SPA:** `data/notion.ts` (`previewNotion` mit `{ source, dateProperty, subpages }`), `stores/notion-run.ts` (`runSources`, `refetchSources`), `NotionStore` (`runImports`, `refetchAll`, `stopRefetch`, `refetchProgress`, `refetchResult`), `NotionImportDialog` (Checkboxen, Gruppen, Ergebnis je Quelle, „Unterseiten einbeziehen“), `NotionCard` („Alle erneut abrufen“, Fortschritt, Ergebnis je Quelle), `freeVariableName` in `domain/connections.ts` für `ChannelSetup` und `SetupConnectForm`.
- **Tests:** `tests/unit/notion-rules.test.mjs` (Unterseiten), `tests/unit/web-connections.test.mjs` (freier Name), `tests/integration/notion-import.test.mjs` (Vorschau und Import mit Unterseiten), `web-data-notion.test.mjs`, `notion-import-blocks.test.mjs` (mehrere Quellen und „Alle erneut abrufen“ gegen PocketBase), `stores/notion-run.test.ts`, `stores/notion.test.ts`, `domain/notion.test.ts`, `components/channels/notion.test.ts`. Das Fixture hat unter „Unterseite“ eine weitere Ebene und eine nicht sichtbare Unterseite.
- **Manuell offen:** BYL-E6-866 (mehrere Quellen im Browser), BYL-E6-867 („Alle erneut abrufen“), BYL-E6-868 (Unterseiten und zweite Verbindung mit eigenem Arbeitsbereich).
