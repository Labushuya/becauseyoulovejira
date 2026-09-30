# Plan „Ticket duplizieren“

- **Stand:** DU-1 umgesetzt (2026-10-01, Branch `feat/duplizieren-server`, nur Hooks: **Neustart nötig**, `neu-starten.bat`), DU-2 geplant.
- **Grundlage:** Nutzerwunsch vom 2026-10-01 („Ich möchte die Möglichkeit haben, jedes Ticket zu duplizieren – nicht zwangsläufig mit Quelle (manuell abfragen wie Duplikat erstellt werden soll).“) und die Vorgaben des Advisors (Einstieg, Felder der Abfrage, Pflicht-Status, Quelle, Atomarität, Verlauf, Rechte, Papierkorb, Tests, Doku).
- **Entscheidungen:** [ADR-0045](../adr/0045-ticket-duplizieren.md), Nachträge zu [ADR-0031](../adr/0031-herkunft-sichern.md) (F: Kopie der Herkunft) und [ADR-0033](../adr/0033-unteraufgaben.md) (Unteraufgaben beim Duplizieren).
- **Einordnung:** Manifest-Block „Ticket duplizieren“ ab `BYL-E6-720`. Keine Migration.

## 1. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| DU-1 | Server: Route `POST /api/byl/tickets/{id}/duplicate` in einer Transaktion (Duplikat, Unteraufgaben, Kommentare samt Pin, Kopie der Hauptquelle mit abgeleitetem Fingerprint, Verlauf an beiden Tickets), Rechte, Papierkorb; Datenschicht der SPA (`duplicateTicket`, Texte der Codes) | umgesetzt |
| DU-2 | Oberfläche: „Duplizieren …“ im Kopf von Panel und Vollansicht, Abfrage als Modal M bzw. eingebettet, Öffnen im gemerkten Modus mit Flag, Verlauf „Dupliziert aus/nach“, „Kopie aus HAUS-12“ an Quellen, Hilfe, README | geplant |

## 2. DU-1: Server

### 2.1 Route und Ablauf

`POST /api/byl/tickets/{id}/duplicate` (`$apis.requireAuth('users')`), Body als JSON:

| Feld | Bedeutung |
|---|---|
| `title` | Pflicht, getrimmt, 1 bis 200 Zeichen (`validation_duplicate_title`) |
| `status` | Pflicht ohne Standard: `backlog`, `open`, `in_progress`, `waiting` (`validation_duplicate_status_required`, sonst `validation_duplicate_status`) |
| `project` | Projekt des Duplikats, `''` für keins; Bereich und Archiv prüft der Ticket-Hook |
| `source` | `none` (Standard) oder `copy` (`validation_duplicate_source`) |
| `description`, `priority`, `tags`, `due` | übernehmen (auch für neue Unteraufgaben, je aus der eigenen) |
| `parent` | Unteraufgabe bleibt beim selben übergeordneten Ticket |
| `subtasks` | neue, offene Unteraufgaben aus denen des Originals |
| `comments` | Kopien der Kommentare, Pin auf die Kopie des angepinnten |

Ablauf (`lib/duplicate-service.js`, rein `lib/duplicate-rules.js`):

1. Original lesen; nicht sichtbar nach der View-Regel oder im Papierkorb: 404.
2. Anfrage prüfen (`parseRequest`), Recht im Bereich (Besitzer ist der Nutzer; Haushalt nur mit Mitgliedschaft, sonst 403), bei `copy` Hauptquelle vorhanden (`validation_duplicate_source_missing`) und Originaldatei im Speicher (`validation_duplicate_source_file`).
3. `e.app.runInTransaction`: Original erneut lesen; Quellkopie (`inbox.copySource`, `new`, `@copy_of`), Duplikat (`txApp.save`, Ticket-Hooks: Scope, Key, Prüfungen, Umwandeln der Kopie, „hat das Ticket angelegt“), Unteraufgaben, Kommentare (`setRaw` für `created`/`updated`, Hinweis in der ersten Zeile), Pin der Kopie (Update über die Ticket-Hooks), Verlauf `duplicate` an Duplikat (`from`) und Original (`to`).
4. Antwort `{ id, key, title, original: { id, key }, subtasks: [{ id, key }], comments, source }`.

### 2.2 Quellkopie

- `lib/inbox-service.js` `copySource`: neue Zeile mit Kanal, Art, Titel, Text, Adresse, Referenz, Quelldatum, `source_meta` plus `copy_of`, ohne `connection`; Originaldatei per `newFilesystem().getReuploadableFile(key, true)` (die Datei bleibt im Speicher von PocketBase, das Dateisystem wird nach dem Speichern geschlossen).
- `prepareRecord` setzt für Einträge mit `@copy_of` den Fingerprint `sha256(copyFingerprintKey(<Fingerprint des Originals>, <Zufall>))`.

### 2.3 Datenschicht der SPA

- `web/src/lib/domain/duplicate.ts`: `DuplicateRequest`, `DuplicateOutcome`, `DUPLICATE_MESSAGES` (gleich dem Hook), `duplicateRequestBody`, `toDuplicateOutcome`.
- `web/src/lib/data/tickets.ts` `duplicateTicket`; `data/errors.ts` kennt die Texte der Codes.

### 2.4 Tests

- Unit: `tests/unit/duplicate-rules.test.mjs`, `tests/unit/inbox-fingerprint.test.mjs` (Kopie), `tests/unit/web-duplicate.test.mjs` (Parität, Body, Antwort).
- Integration: `tests/integration/ticket-duplicate.test.mjs` (jede Option, neuer Key, Verlauf, Realtime, Unteraufgaben, Kommentare samt Pin, Quellkopie mit Datei und Unabhängigkeit der Duplikatsuche auch als Tombstones, Atomarität mit der Fehlermarke `__byl_fail_duplicate__` am letzten Schreiben, Rechte, Papierkorb, Datenschicht), `hooks-before-migration.test.mjs` (vor den Migrationen des Papierkorbs und des Pins).

## 3. DU-2: Oberfläche

Wird mit DU-2 ausgeführt: Knopf, Abfrage, Store, Verlauf, Quellen, Hilfe, README.

## 4. Offene Punkte

- Keine.
