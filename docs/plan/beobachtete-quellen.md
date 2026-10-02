# Plan „Beobachtete Quellen“: Standardprojekt je Verbindung, GitHub-Kanal, Ordner-Kanal

- **Stand:** Paket 1 „Standardprojekt je Verbindung“ umgesetzt (ZP-1, 2026-10-02, Branch `feat/standardprojekt-je-verbindung`; Migration und Hooks: **Neustart nötig**, `neu-starten.bat`). Die Pakete 2 (GitHub) und 3 (Ordner) sind noch nicht begonnen.
- **Grundlage:** Spec „Standardprojekt je Verbindung, GitHub-Kanal, Ordner-Kanal (beobachtete Quellen)“, vom Nutzer am 2026-10-01 freigegeben, mit seinen Antworten: Ordner nur zur Einsicht mit Verweis auf die Datei, GitHub als ein Kanal mit Repositories in der Karte, Statusanzeige an der Quelle nur als Anzeige, Reihenfolge (1) Standardprojekt, (2) GitHub, (3) Ordner.
- **Entscheidungen:** [ADR-0049](../adr/0049-zielprojekt-je-eingangsweg.md) (Paket 1), Nachträge zu [ADR-0014](../adr/0014-datenmodell-eingang.md), [ADR-0016](../adr/0016-kanal-architektur-und-mail.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md) (ZP) und [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md) (Nachtrag 6). Für die Pakete 2 und 3 folgen eigene ADRs („Beobachtete Quellen (Verweis und Status, nur Anzeige)“, „GitHub-Kanal“, „Ordner-Kanal“ oder eine ADR mit Abschnitten) samt Nachträgen zu 0016, 0020 und 0031.
- **Einordnung:** Manifest-Paket `ZP-1`, Block „Standardprojekt je Verbindung“ mit `BYL-E6-1100` bis `BYL-E6-1110`.

## 1. Grundsatz der Spec

- Alles nur Einsicht und lesend: Die App schreibt nie nach GitHub und nie in Ordner.
- Neue Quellart „beobachtete Quelle“ (Datei im Ordner, Datei bzw. Pfad im Repo, PR), die ihren aktuellen Status nur anzeigt (geändert seit, nicht mehr vorhanden, PR gemergt bzw. geschlossen) und Tickets nie verändert. Bestehende Quellen bleiben eingefrorene Kopien ([ADR-0031](../adr/0031-herkunft-sichern.md)); Ordner-Quellen sind auf Wunsch des Nutzers Verweise statt Kopien (bewusste Ausnahme, eigene ADR).

## 2. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| 1 | Standardprojekt je Verbindung: Zielprojekt an jeder Karte, Einträge merken es sich, Umwandeln belegt vor, Filter und Gruppierung im Eingang | umgesetzt |
| 2 | GitHub-Kanal: ein Kanal mit Token (nur lesend), Repositories in der Karte mit beobachteten Pfaden, Ereignissen und Zielprojekt je Repository, Abruf per Cron mit ETag, Änderungserkennung per Blob-SHA, PRs und Releases, Statusanzeige | offen |
| 3 | Ordner-Kanal: mehrere Ordner je Verbindung mit Filtern und Zielprojekt je Ordner, Polling mit Größe, Zeit und SHA-256, Einträge als Verweis, sichere Route zum Ansehen, Statusanzeige | offen |

## 3. Paket 1: Standardprojekt je Verbindung

### 3.1 Datenmodell (Migration `1790203100_inbox_target_project.js`)

| Feld | Art | Inhalt |
|---|---|---|
| `inbox_items.target_project` | Relation auf `projects`, höchstens eins, kein Cascade, Index | Projekt, das der Eintrag beim Eintreffen bekam; nur der Server setzt es, für Clients unveränderlich |
| `connections.target_project` | Relation auf `projects`, höchstens eins | Zielprojekt einer Verbindung (Kalender, Telegram, Postfach, Notion) |
| `users.inbox_targets` | JSON, höchstens 2 000 Byte | `{ "api", "whatsapp-web", "files" }` je mit Projekt-ID oder leer: eigener Eingang, WhatsApp Web, Dateien |

Gründe (Relation statt `source_meta`, eigenes Feld statt `settings`, je Nutzer statt je Schlüssel, ein Ziel für alle Dateiarten) in [ADR-0049](../adr/0049-zielprojekt-je-eingangsweg.md) §1 und §2. Rückweg: Index und Felder fallen weg, sonst ändert sich keine Zeile (Rollback-Test mit Daten).

### 3.2 Server

- `lib/target-project-rules.js` (rein): Karten und ihre Kanäle (`CARD_CHANNELS`), Lesen und Prüfen von `inbox_targets`, Reihenfolge der Auflösung (`requestedTarget`: vom Server gegebenes Ziel, Verbindung, Karte), `usableTarget` (gleicher Bereich, archiviert bleibt), `choiceViolation` (aktiv, gleicher Bereich), `withTargetGone`.
- `lib/target-project-service.js`: `applyToNewItem` (aus `inbox-service.prepareCreate`, also für Record-API und `ingest`), `guardConnection` (Request-Hooks der Verbindungen), `guardUserTargets` (Request-Hooks der Nutzer).
- `lib/inbox-service.js`: `target_project` in `IMMUTABLE_FIELDS`; `prepareUpdate` vermerkt `source_meta.target_gone`, wenn PocketBase das Feld beim Löschen des Projekts leert; `copySource` gibt das Ziel des Originals über `@target_project` weiter.
- `lib/connection-rules.js`: `target_project` in `RENAME_KEEPS`; `lib/connection-service.js` liest das Feld mit.

### 3.3 Oberfläche

- **Karten:** Baustein `components/channels/CardTargetProject.svelte` in den Details von `ConnectionCard`, `NotionCard`, `OwnInboxCard`, `WhatsAppWebCard` und `FilesCard`; „Zielprojekt …“ im Menü „•••“ über `ChannelCard.showDetails`. Daten: `setConnectionTarget` (`data/connections.ts`, `ConnectionsStore.setTarget`), `data/inbox-targets.ts` mit `InboxTargetsStore` (`stores/inbox-targets.svelte.ts`), geladen auf der Seite „Kanäle“.
- **Assistenten:** `TARGET_STEP` nach „Verbinden“ (`domain/channel-setup.ts`, `withTargetStep`, nie aufhaltend), bei WhatsApp Web als letzter Schritt (`domain/whatsapp-web.ts`).
- **Umwandeln:** `targetPrefill` (`domain/target-project.ts`) in der Route `tickets/neu` für `NewTicketForm` (Prop `target`, Hinweis am Feld „Projekt“); `bulkTargets` im `BulkConvertDialog` (Checkbox „Zielprojekt des Eintrags verwenden“) und `BulkDefaults.targets` im `BulkConverter`.
- **Eingang:** `InboxQuery.target` und `grouped` (`zielprojekt`, `gruppe=zielprojekt`), Filter im `InboxStore` (`matchesTarget` mit den Unterprojekten des Katalogs, Server-Filter `HandledTarget` in `listHandledItems`), `groupByTarget` und Spalte `target` in `InboxTable`, Zeile im `InboxPanel`. Bereitschaft über `InboxStore.targetsReady` (`withoutTargetField` aus der Datenschicht).

### 3.4 Tests

- Unit: `tests/unit/target-project-rules.test.mjs`, `tests/unit/web-target-project.test.mjs` (Parität), `tests/unit/connection-rules.test.mjs` (Umbenennen).
- Integration: `tests/integration/inbox-target-project.test.mjs` (Ziel je Weg, nur neue Einträge, nur der Server, Prüfungen, Archiv, Löschung, Kopie, Filter mit Unterprojekten und fremdem Nutzer, Datenschicht), `migrations-rollback.test.mjs` (eigener Fall und mitlaufende Fälle), `support/schema.mjs`.
- Web: `domain/target-project.test.ts`, `domain/inbox-query.test.ts`, `domain/channel-setup.test.ts`, `domain/whatsapp-web.test.ts`, `stores/bulk-convert.test.ts`, `components/channels/card-target-project.test.ts`, die Tests der Assistenten, `bulk-convert-dialog.test.ts`, `new-ticket.test.ts`, `inbox-table.test.ts`, `inbox-panel.test.ts`.
- Manuell: BYL-E6-1108 bis BYL-E6-1110 (Karten und Assistent im Browser, Umwandeln und Eingang, Löschen und Archivieren mit echter Instanz nach dem Neustart).

### 3.5 Offene Punkte

- Ein Ziel je Zugangsschlüssel des eigenen Eingangs ist bewusst nicht umgesetzt ([ADR-0049](../adr/0049-zielprojekt-je-eingangsweg.md) §1); kommt der Wunsch, passt es als Einheit unter die Karte wie Repository und Ordner (§4).
- Haushalte (E7): Das Ziel muss im Bereich des Eintrags liegen; die Einträge der Karten ohne Verbindung sind privat. Verbindungen eines Haushalts sind mit E7 neu zu betrachten.

## 4. Pakete 2 und 3: was Paket 1 vorbereitet

- **Ziel je Einheit:** Repository bzw. Ordner bekommen ein eigenes Zielprojekt in ihrer Konfiguration (in den `settings` der Verbindung oder einer eigenen Sammlung, Entscheidung im jeweiligen Paket). Der Kanal löst beim Anlegen „Einheit vor Verbindung“ auf und reicht das Ergebnis über den flüchtigen Schlüssel `@target_project` an `inbox-service.ingest` bzw. den Datensatz weiter (Stufe 1 der Reihenfolge, wie heute die Kopie einer Quelle). Feld, Filter, Gruppierung, Spalte, Vorbelegung und die Regeln für Archiv und Löschung bleiben unverändert; ein Ziel als ID in JSON prüft die Auflösung ohnehin auf Existenz und Bereich.
- **Karte:** Die Details einer GitHub- bzw. Ordner-Karte zeigen je Einheit eine Zeile mit `CardTargetProject` (derselbe Baustein); „Zielprojekt …“ im Menü der Karte bleibt das Ziel der Verbindung als Rückfall.

## 5. Paket 2: GitHub-Kanal (aus der Spec, noch nicht geplant)

- Ein Kanal „GitHub“ mit Konto bzw. Token (Fine-grained PAT nur lesend: Metadata, Contents, Pull requests; öffentliche Repos ohne Token), Variable `BYL_GITHUB_TOKEN` nach [ADR-0018](../adr/0018-secrets.md); Token nie in Logs oder Antworten (`secrets.redact` um `github_pat_…` und `ghp_…` erweitern).
- Repositories in der Karte: Zielprojekt (§4), beobachtete Pfade als Glob-Liste (vorbelegt `ROADMAP*`, `CHANGELOG*`, `README*`, `docs/**/roadmap*`, optional `docs/**/*.md`), Ereignisse (Dateiänderungen auf dem Default-Branch, PRs, Releases; Standard an).
- Abruf per Cron (15 Minuten, einstellbar 5 bis 60) und „Jetzt abrufen“, nur `GET` bzw. GraphQL-Queries, ETag mit `If-None-Match`, Rate-Limit-Kopfzeilen, 403/429 sauber.
- Änderungserkennung per Blob-SHA je Datei, Eintrag „CHANGELOG.md in owner/repo geändert“ mit Commits, Autoren, Datum, Zeilenstatistik, Compare-Link und Kopie des neuen Inhalts (Grenze wie Seitenkopie); Dedup je (Repo, Pfad, Blob-SHA); neue und gelöschte Dateien.
- PRs und Releases je ein Eintrag (Dedup über die Node-ID), Statusanzeige an Quelle und Ticket nur als Anzeige.
- Stichwort-Regel: Auswahl der Pfade und Ereignisse ist der Filter (Nachtrag zu [ADR-0020](../adr/0020-stichwoerter-pro-kanal.md)).
- Tests mit einem Fake-GitHub-Server (wie Fake-Notion), Rate-Limit- und ETag-Fälle, keine echten Tokens.

## 6. Paket 3: Ordner-Kanal (aus der Spec, noch nicht geplant)

- Kanal „Ordner“ mit mehreren Ordnern je Verbindung: absoluter Pfad, Unterordner ja/nein, Dateityp-Filter, Ausschlussmuster (Standard `*.tmp`, `~$*`, `.git/**`, `node_modules/**`, `Thumbs.db`, `desktop.ini`), Zielprojekt (§4), „Änderungen melden“ (Standard an).
- Polling (etwa alle 5 Minuten) mit `$os.readDir`/`stat` oder Gleichwertigem aus der JSVM (zu prüfen), Schnellprüfung über Größe und Zeit, SHA-256 bis etwa 200 MB, Umbenennen per gleichem Hash optional.
- Einträge nur mit Metadaten und Verweis (keine Kopie), Route zum Ansehen der aktuellen Datei nur für den Besitzer (Regel wie die Seite „System“, [ADR-0043](../adr/0043-system-seite.md)) und nur innerhalb der Ordner (Traversal, Symlinks, Junctions, kanonische Pfade), klare Meldung bei fehlender Datei.
- **Hinweis für den Pi/Docker-Betrieb** ([ADR-0028](../adr/0028-plattform-strategie.md), zurückgestellt): Der Kanal funktioniert nur, weil Server und Dateien auf demselben Rechner liegen; im Container müsste der Ordner eingebunden werden. Netzlaufwerke nur nach Prüfung.
- Tests mit Ordner-Fixtures in Temp-Verzeichnissen und Sicherheitstests der Route.
