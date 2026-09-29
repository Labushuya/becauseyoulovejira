# Plan „Notion-Import“: bestehende Listen nur lesend als Kopien in den Eingang übernehmen

- **Stand:** NI-1 (Server) umgesetzt; NI-2 (Oberfläche, Hilfe, restliche Doku) folgt. Neustart der App nötig (neue Hooks, keine Migration).
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
| NI-2 | Art `notion` anlegbar (Hook und SPA), Datenschicht und Store, Katalog-Kachel, Assistent, Karte mit „Erneut abrufen“, Import-Dialog, „Datum als Fälligkeit“ für Notion-Einträge, Kopie-Status, „Alle Kanäle jetzt abrufen“ ohne Notion, Hilfe „Notion“, README, CLAUDE.md, manuelle Browser-Fälle | ab BYL-E6-529 |

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

## 4. NI-2 (Oberfläche), Vorhaben

- `CREATABLE_TYPES` und `CONNECTION_TYPES` mit `notion` (Paritätstest), `SETTINGS_KEYS.notion` leer.
- Datenschicht `data/notion.ts`, Store für Prüfen, Quellen, Vorschau, Import in Teilen zu höchstens 100 mit Fortschritt, „Erneut abrufen“.
- Katalog-Kachel „Notion (Listen übernehmen)“ mit Etikett „Import“, Assistent `?einrichten=notion` mit den Schritten Integration anlegen, Token setzen, Verbinden, Neu starten, Freigeben, Prüfen.
- Karte der Verbindung: Zustand, zuletzt geprüft, bisher übernommene Quellen mit „Erneut abrufen“, „Listen übernehmen …“, „Verbindung prüfen“, „Einrichtung ansehen“, „Löschen …“; kein „Jetzt abrufen“, kein „Pausieren“.
- Import-Dialog (Modal L): Quellen mit Suche und „Liste aktualisieren“, Vorschau mit Auswahl nach ADR-0036 (Kopf-Checkbox, Umschalt+Klick), Optionen und Grenzen, Fortschritt, Ergebnis angelegt / schon vorhanden / übersprungen / Fehler.
- Eingang: Symbol und Kennzeichnung des Kanals, Kopie-Status für `properties` und `truncated`, „Datum als Fälligkeit“ für Notion-Einträge mit Datum (Nachtrag ADR-0036 §5).
- Hilfe-Abschnitt „Notion“, README, CLAUDE.md; manuelle Fälle: Integration anlegen, Verbindung prüfen, Datenbank importieren, Seite mit To-do-Liste importieren, Erledigte überspringen, Seiteninhalt mitnehmen, Erneut abrufen, Token ungültig, Quelle nicht freigegeben.

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
