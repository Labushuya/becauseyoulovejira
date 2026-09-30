# Plan „Ticket duplizieren“

- **Stand:** DU-1 umgesetzt (2026-10-01, #192, nur Hooks: **Neustart nötig**, `neu-starten.bat`), DU-2 umgesetzt (2026-10-01, Branch `feat/duplizieren-ui`, nur Oberfläche: Build, dann F5; der Knopf wirkt erst nach dem Neustart von DU-1). Offen ist die manuelle Browser-Prüfung BYL-E6-729.
- **Grundlage:** Nutzerwunsch vom 2026-10-01 („Ich möchte die Möglichkeit haben, jedes Ticket zu duplizieren – nicht zwangsläufig mit Quelle (manuell abfragen wie Duplikat erstellt werden soll).“) und die Vorgaben des Advisors (Einstieg, Felder der Abfrage, Pflicht-Status, Quelle, Atomarität, Verlauf, Rechte, Papierkorb, Tests, Doku).
- **Entscheidungen:** [ADR-0045](../adr/0045-ticket-duplizieren.md), Nachträge zu [ADR-0031](../adr/0031-herkunft-sichern.md) (F: Kopie der Herkunft) und [ADR-0033](../adr/0033-unteraufgaben.md) (Unteraufgaben beim Duplizieren).
- **Einordnung:** Manifest-Block „Ticket duplizieren“ ab `BYL-E6-720`. Keine Migration.

## 1. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| DU-1 | Server: Route `POST /api/byl/tickets/{id}/duplicate` in einer Transaktion (Duplikat, Unteraufgaben, Kommentare samt Pin, Kopie der Hauptquelle mit abgeleitetem Fingerprint, Verlauf an beiden Tickets), Rechte, Papierkorb; Datenschicht der SPA (`duplicateTicket`, Texte der Codes) | umgesetzt |
| DU-2 | Oberfläche: „Duplizieren …“ im Kopf von Panel und Vollansicht, Abfrage als Modal M bzw. eingebettet, Öffnen im gemerkten Modus mit Flag, Verlauf „Dupliziert aus/nach“, „Kopie aus HAUS-12“ an Quellen, Hilfe, README | umgesetzt |

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

### 3.1 Einstieg

- **Kopf von Panel und Vollansicht:** `TicketDuplicate` als `.button-icon` (zwei Blätter) mit `aria-label` und `title` „Duplizieren …“, vor „Löschen …“. Im Panel kommt er über das Snippet `duplicate` von `TicketPanel` aus dem Layout der Ticket-Route; in der Vollansicht steht er in den Aktionen des Kopfs.
- **Kein Aktionsmenü, keine Zeile der Tabelle:** Das Ticket hat kein Aktionsmenü, seine Aktionen stehen im Kopf. Die Tabelle „Aufgaben“ hat kein Zeilen- oder Kontextmenü (nur Menüs einzelner Zellen); ein neuer Baustein nur dafür wäre mehr als verlangt. Keine Sammelaktion.

### 3.2 Abfrage (`DuplicateDialog`)

| Teil | Verhalten |
|---|---|
| Rahmen | im Panel Modal M „HAUS-12 duplizieren“; in der Vollansicht (`insideModal()`) derselbe Inhalt als `InlineDialog` oben im Inhalt, der Knopf trägt dort `aria-expanded` und klappt ihn auf und zu; Esc schließt nur den Bereich; „Löschen …“ und „Duplizieren …“ schließen einander |
| Titel | „‹Titel› (Kopie)“ (`duplicateTitle`, höchstens 200 Zeichen), erster Fokus |
| Übernehmen | Checkboxen mit dem Wert des Originals: Beschreibung, „Priorität: Hoch“, Projekt (darunter `ProjectSelect` „Projekt des Duplikats“; ein archiviertes Projekt ist nicht wählbar, dann keins mit Hinweis), „Tags: …“, „Fälligkeit: …“; „Unter HAUS-7 einordnen“ nur bei Unteraufgaben; „Unteraufgaben (N)“ nur bei übergeordneten Tickets; „Kommentare (N)“ nur mit Kommentaren, jeweils mit Hinweis |
| Status | `InitialStatusChoice` mit „Status des Duplikats“, eigenem Hinweis und „wie das Original“; ohne Wahl Fehler an der Gruppe mit Fokus, nichts wird gesendet |
| Quelle | nur mit Quellen: „Keine Quelle“ (Standard) oder „Kopie der Herkunft übernehmen“ mit dem, was die Kopie enthält (`copySourceHint`); ohne Hauptquelle gesperrt mit Grund |
| Serie | `SectionMessage` info: „… gehört zu einer Serie. Das Duplikat wird ein normales Ticket ohne Wiederholung.“ |
| Senden | „Duplizieren“ (`aria-busy`, „Wird dupliziert …“); Fehler des Servers an Titel, Status, Projekt oder Quelle, sonst als Meldung |

Regeln rein in `domain/duplicate.ts` (`initialDuplicateForm`, `duplicateFormErrors`, `duplicateRequestOf`, `copySourceHint`, `duplicatedFlag`, `duplicateHistoryText`); die Antworten des Status aus `initialStatusOptions(status, 'das Original')`.

### 3.3 Ergebnis

- `TicketDuplicateStore` (`stores/ticket-duplicate.svelte.ts`, im `(app)`-Layout): sendet, zeigt das Flag „HAUS-12 dupliziert.“ mit „Das Duplikat ist HAUS-13.“ und „HAUS-12 öffnen“; Ablehnungen je Feld, 404 als „Das Ticket gibt es nicht mehr, oder es liegt im Papierkorb.“.
- Danach schließt die Abfrage, und die Route öffnet das Duplikat im gemerkten Modus (`ticketLinks().href`, [ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §1); ungespeicherte Eingaben am Original fragen wie bei jedem Verlassen. Die neuen Tickets kommen per Realtime in die Liste.
- Verlauf: `history-format.ts` nennt `duplicate` als „Dupliziert aus HAUS-12“ bzw. „Dupliziert nach HAUS-13“.
- Quellen: `copiedFrom` (`domain/sources.ts`) liest `source_meta.copy_of`; die Quellen des Tickets zeigen „Kopie aus HAUS-12“, das Panel des Eintrags einen Hinweis mit Link auf das Original.

### 3.4 Tests

- `domain/duplicate.test.ts`, `domain/history-format.test.ts`, `stores/ticket-duplicate.test.ts`.
- `components/ticket-duplicate.test.ts` (Knopf, Modal, Pflicht-Status, Senden, Projekt, Fehler, Unteraufgabe, Quelle, Serie, eingebettet in einem Modal), `components/ticket-panel.test.ts` (Kopf des Panels und Vollansicht mit genau einem Dialog und dem gemerkten Modus), `components/ticket-sources.test.ts`, `components/inbox-panel.test.ts`, Hilfe (`help-page.test.ts`).
- Manuell BYL-E6-729: Browser, Tastatur und NVDA.

## 4. Offene Punkte

- Keine.
