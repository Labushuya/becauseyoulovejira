# Plan „Beobachtete Quellen“: Standardprojekt je Verbindung, GitHub-Kanal, Ordner-Kanal

- **Stand:** Paket 1 „Standardprojekt je Verbindung“ umgesetzt (ZP-1, 2026-10-02, Branch `feat/standardprojekt-je-verbindung`; Migration und Hooks: **Neustart nötig**, `neu-starten.bat`). Paket 2 „GitHub-Kanal“: GH-1 (Server, Abruf, Status) umgesetzt (2026-10-02, Branch `feat/github-kanal-abruf`; Migration, Hooks und Cron: **Neustart nötig**), GH-2 (Oberfläche, Assistent) folgt. Paket 3 (Ordner) ist noch nicht begonnen.
- **Grundlage:** Spec „Standardprojekt je Verbindung, GitHub-Kanal, Ordner-Kanal (beobachtete Quellen)“, vom Nutzer am 2026-10-01 freigegeben, mit seinen Antworten: Ordner nur zur Einsicht mit Verweis auf die Datei, GitHub als ein Kanal mit Repositories in der Karte, Statusanzeige an der Quelle nur als Anzeige, Reihenfolge (1) Standardprojekt, (2) GitHub, (3) Ordner.
- **Entscheidungen:** [ADR-0049](../adr/0049-zielprojekt-je-eingangsweg.md) (Paket 1), Nachträge zu [ADR-0014](../adr/0014-datenmodell-eingang.md), [ADR-0016](../adr/0016-kanal-architektur-und-mail.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md) (ZP) und [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md) (Nachtrag 6). Paket 2: [ADR-0050](../adr/0050-github-kanal-und-beobachtete-quellen.md) „GitHub-Kanal und beobachtete Quellen“ (eine ADR mit Abschnitten; das Konzept „beobachtete Quelle“ steht dort in §5 und gilt auch für Paket 3) mit Nachträgen zu 0014, 0016, 0018, 0019, 0020 (Nachtrag 5), 0031 (Nachtrag I) und 0049. Für Paket 3 folgt die ADR „Ordner-Kanal“ (Verweis statt Kopie als bewusste Ausnahme).
- **Einordnung:** Manifest-Paket `ZP-1`, Block „Standardprojekt je Verbindung“ mit `BYL-E6-1100` bis `BYL-E6-1110`; Pakete `GH-1` und `GH-2`, Block „GitHub-Kanal“ ab `BYL-E6-1120`.

## 1. Grundsatz der Spec

- Alles nur Einsicht und lesend: Die App schreibt nie nach GitHub und nie in Ordner.
- Neue Quellart „beobachtete Quelle“ (Datei im Ordner, Datei bzw. Pfad im Repo, PR), die ihren aktuellen Status nur anzeigt (geändert seit, nicht mehr vorhanden, PR gemergt bzw. geschlossen) und Tickets nie verändert. Bestehende Quellen bleiben eingefrorene Kopien ([ADR-0031](../adr/0031-herkunft-sichern.md)); Ordner-Quellen sind auf Wunsch des Nutzers Verweise statt Kopien (bewusste Ausnahme, eigene ADR).

## 2. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| 1 | Standardprojekt je Verbindung: Zielprojekt an jeder Karte, Einträge merken es sich, Umwandeln belegt vor, Filter und Gruppierung im Eingang | umgesetzt |
| 2 | GitHub-Kanal: ein Kanal mit Token (nur lesend), Repositories in der Karte mit beobachteten Pfaden, Ereignissen und Zielprojekt je Repository, Abruf per Cron mit ETag, Änderungserkennung per Blob-SHA, PRs und Releases, Statusanzeige | GH-1 umgesetzt, GH-2 in Arbeit |
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

## 5. Paket 2: GitHub-Kanal

Entscheidungen und Gründe: [ADR-0050](../adr/0050-github-kanal-und-beobachtete-quellen.md). Zwei Teilpakete, je ein PR: **GH-1** Server, Abruf und Status (keine Oberfläche außer der Familie „GitHub“ in Chips und Symbol); **GH-2** Karte, Repositorys in der Karte, Assistent, Statusanzeige in Eingang und Ticket, Hilfe, README.

### 5.1 Datenmodell (Migration `1790203200_github_channel.js`)

| Feld | Art | Inhalt |
|---|---|---|
| `connections.type` | Wert `github` | der Kanal |
| `inbox_items.channel`, `tickets.source` | Wert `github` | Einträge und Tickets aus GitHub |
| `inbox_items.kind` | Werte `change`, `pull_request`, `release` | Fassung einer beobachteten Datei, Pull Request, Release |
| `inbox_items.watch` | JSON, höchstens 2 000 Byte | Status einer beobachteten Quelle (nur der Server, nur Anzeige) |
| `connections.watch` | JSON, `hidden`, höchstens 1 MB | Stand des Kanals je Repository (ETags, Blob-SHA, Marken, Zahlen) und Rate-Limit |
| `connections.settings` (GitHub) | JSON | `interval` (5 bis 60, Standard 15) und `repos` (höchstens 20: `repo`, `paths`, `events`, `target`) |

Rückweg: Einträge und Tickets aus GitHub werden Web-Links (`link`), GitHub-Verbindungen fallen weg (ihre Einträge verlieren nur die Verbindung), die Felder gehen (Rollback-Test mit Daten).

### 5.2 Server (GH-1)

- `lib/github-rules.js` (rein): fester Host und Testmodus, Namen von Repositorys (`parseRepo` liest auch Adressen von github.com), Globs (`patternRegExp`, `watchedFiles`), Einstellungen (`settingsViolation`, `settingsOf`, `changedTargets`), Fälligkeit des Crons (`isDue`), Rate-Limit (`rateOf`, `limitOf`, `exhaustedUntil`, `limitHint`), Folgeseiten (`nextLink`, `pathOfLink`), Fehlertexte (`failureOf`), Änderungen (`fileChanges`, `matcherOf`), Einträge (`fileDraft` mit Diff-Auszug und Kopie, `pullDraft`, `releaseDraft`), Status (`fileWatch`, `pullWatch`), Stand (`stateOf`, `repoSummary`).
- `lib/github-client.js`: nur `GET`, bedingt mit ETag, liest das Rate-Limit jeder Antwort, stoppt bei `remaining: 0`, wirft bei 403/429 als Rate-Limit, Zeitgrenze je Anfrage aus der Frist des Laufs.
- `lib/github-service.js`: `run` (ein Lauf: je Repository Daten, Dateien, PRs, Releases; Stand je Teil nur mit Erfolg; Einträge über `inbox-service.ingest` mit Ziel des Repositorys und erstem Status; Status früherer Einträge über `source_ref`), `runDue` (Cron), `summary` (Details der Karte), `check` („Verbindung prüfen“).
- `github.pb.js`: Cron `byl-github` (jede Minute, nicht im Testmodus), `GET /api/byl/connections/{id}/github`, `POST …/github/check`. „Jetzt abrufen“ über die gemeinsame Route `…/run` (`channel-runner.js`: GitHub ohne Token, Stand `watch`, Zustand `limited`).
- Weitere Änderungen: `connection-rules.js` (`github` in `SETTINGS_KEYS`, `watch` in `SERVER_FIELDS`, `requiresSecret`), `connection-service.js` (Ziel je Repository prüfen), `target-project-service.js` (`assertChoosable`, `projectFacts` exportiert), `inbox-service.js` (`watch`, `@watch`, `draft.target`, Kopie behält den Status), `inbox-fingerprint.js` (Familie GitHub), `secrets.js` (Token von GitHub), `source.js` (Kanal und Arten). `CREATABLE_TYPES` nimmt `github` erst mit GH-2 auf; bis dahin legt nur der Superuser eine Verbindung an (Tests).

### 5.3 Oberfläche (GH-2)

- **Karte** `GitHubCard` (`ChannelCard`): Zustand, Infozeile, Hinweis (ohne Token, Rate-Limit, Fehler einzelner Repositorys), Hauptknopf „Jetzt abrufen“ bzw. „Repository hinzufügen …“, Menü „•••“ mit „Repository hinzufügen …“, „Verbindung prüfen“, „Zielprojekt …“, „Pausieren“, „Umbenennen …“, „Einrichtung ansehen“, „Hilfe“, „Löschen …“. Details: Letzter Abruf, Zugang, Anfragelimit, Abruf-Intervall, Zielprojekt der Verbindung und je Repository die Angaben aus `GET …/github` mit „Einstellungen …“ und „Entfernen …“.
- **Repository-Formular** (`GitHubRepoForm`): Name oder Adresse, beobachtete Pfade (Liste mit Vorbelegung, Option `docs/**/*.md`), Ereignisse, Zielprojekt; in der Karte als Modal M, im Assistenten eingebettet (kein Dialog aus dem Dialog).
- **Assistent** `?einrichten=github`: Token anlegen → Token setzen → Neu starten → Repositorys hinzufügen (legt die Verbindung an) → Zielprojekt (optional) → Verbindung prüfen.
- **Statusanzeige:** `domain/watch.ts` (Texte), Datenschicht liest `watch`; `InboxPanel` (Zeile „Status der Quelle“), `TicketSources` (`Lozenge`).
- **Katalog**, „Alle Kanäle jetzt abrufen“ (Zustand `limited` neutral), Hilfe „GitHub“, README.

### 5.4 Tests

- Unit: `tests/unit/github-rules.test.mjs`, `tests/unit/github-readonly.test.mjs` (nur GET, statisch), `secrets.test.mjs`, `inbox-fingerprint.test.mjs`, `connection-rules.test.mjs`, `source.test.mjs` (über `support/schema.mjs`).
- Integration: `tests/integration/github-channel.test.mjs` gegen `tests/support/fake-github.mjs` (Ersterfassung ohne Flut, 304, Änderung mit Kopie und Diff, Status, neue und gelöschte Dateien, neue Muster, PRs mit Ticket unverändert, Releases, Paginierung, Zielprojekt je Repository, Einstellungen, Rate-Limit primär und sekundär, Fehler, ohne Token, „Verbindung prüfen“, Cron über `tests/fixtures/pb_hooks/github-cron.pb.js`, Zeit eines Laufs, nur GET, kein Token), `migrations-rollback.test.mjs`, `web-filter-parity.test.mjs` (Kanal `github`).
- GH-2: Komponententests der Karte, des Formulars, des Assistenten und der Statusanzeige; manuelle Fälle mit echtem Repository und PAT.

### 5.5 Folgepunkte

- Issues, fehlgeschlagene Workflows und Dependabot als Ereignisse (ADR-0050 §4: nicht minimal, weitere Rechte und eigene Auswahl nötig).
- Gelöschte Releases erkennen (bräuchte das Lesen aller Seiten je Lauf).
- Umbenannte Repositorys: Einträge behalten den alten Schlüssel; erst ein Eintrag mit dem neuen Namen ersetzt den Eintrag in den Einstellungen.

## 6. Paket 3: Ordner-Kanal (aus der Spec, noch nicht geplant)

- Kanal „Ordner“ mit mehreren Ordnern je Verbindung: absoluter Pfad, Unterordner ja/nein, Dateityp-Filter, Ausschlussmuster (Standard `*.tmp`, `~$*`, `.git/**`, `node_modules/**`, `Thumbs.db`, `desktop.ini`), Zielprojekt (§4), „Änderungen melden“ (Standard an).
- Polling (etwa alle 5 Minuten) mit `$os.readDir`/`stat` oder Gleichwertigem aus der JSVM (zu prüfen), Schnellprüfung über Größe und Zeit, SHA-256 bis etwa 200 MB, Umbenennen per gleichem Hash optional.
- Einträge nur mit Metadaten und Verweis (keine Kopie), Route zum Ansehen der aktuellen Datei nur für den Besitzer (Regel wie die Seite „System“, [ADR-0043](../adr/0043-system-seite.md)) und nur innerhalb der Ordner (Traversal, Symlinks, Junctions, kanonische Pfade), klare Meldung bei fehlender Datei.
- **Hinweis für den Pi/Docker-Betrieb** ([ADR-0028](../adr/0028-plattform-strategie.md), zurückgestellt): Der Kanal funktioniert nur, weil Server und Dateien auf demselben Rechner liegen; im Container müsste der Ordner eingebunden werden. Netzlaufwerke nur nach Prüfung.
- Tests mit Ordner-Fixtures in Temp-Verzeichnissen und Sicherheitstests der Route.
