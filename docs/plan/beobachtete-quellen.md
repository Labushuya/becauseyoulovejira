# Plan „Beobachtete Quellen“: Standardprojekt je Verbindung, GitHub-Kanal, Ordner-Kanal

- **Stand:** Paket 1 „Standardprojekt je Verbindung“ umgesetzt (ZP-1, 2026-10-02, Branch `feat/standardprojekt-je-verbindung`; Migration und Hooks: **Neustart nötig**, `neu-starten.bat`). Paket 2 „GitHub-Kanal“ umgesetzt: GH-1 (Server, Abruf, Status; 2026-10-02, Branch `feat/github-kanal-abruf`; Migration, Hooks und Cron: **Neustart nötig**) und GH-2 (Karte, Repositorys, Assistent, Statusanzeige, Hilfe; 2026-10-02, Branch `feat/github-kanal-oberflaeche`; Hook-Änderung: **Neustart nötig**), dazu GH-3 nach dem Nutzertest (Token für alle Repositorys, Liste des Tokens, „Alle meine Repositorys beobachten“; 2026-10-02, Branch `feat/github-alle-repositorys`; Hooks und Route: **Neustart nötig**, §5.5). Paket 3 „Ordner-Kanal“ umgesetzt: OD-1 (Server, Erkennung, Route zum Ansehen; 2026-10-02, Branch `feat/ordner-kanal-erkennung`; Migration, Hooks und Cron: **Neustart nötig**) und OD-2 (Assistent, Karte mit Ordnern, Dialog, „Vorhandene Dateien übernehmen“, „Ansehen“ in Eingang und Ticket, Hilfe; 2026-10-02, Branch `feat/ordner-kanal-oberflaeche`; Hook-Änderung `CREATABLE_TYPES`: **Neustart nötig**).
- **Grundlage:** Spec „Standardprojekt je Verbindung, GitHub-Kanal, Ordner-Kanal (beobachtete Quellen)“, vom Nutzer am 2026-10-01 freigegeben, mit seinen Antworten: Ordner nur zur Einsicht mit Verweis auf die Datei, GitHub als ein Kanal mit Repositories in der Karte, Statusanzeige an der Quelle nur als Anzeige, Reihenfolge (1) Standardprojekt, (2) GitHub, (3) Ordner.
- **Entscheidungen:** [ADR-0049](../adr/0049-zielprojekt-je-eingangsweg.md) (Paket 1), Nachträge zu [ADR-0014](../adr/0014-datenmodell-eingang.md), [ADR-0016](../adr/0016-kanal-architektur-und-mail.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md) (ZP) und [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md) (Nachtrag 6). Paket 2: [ADR-0050](../adr/0050-github-kanal-und-beobachtete-quellen.md) „GitHub-Kanal und beobachtete Quellen“ (eine ADR mit Abschnitten; das Konzept „beobachtete Quelle“ steht dort in §5 und gilt auch für Paket 3) mit Nachträgen zu 0014, 0016, 0018, 0019, 0020 (Nachtrag 5), 0031 (Nachtrag I) und 0049. Paket 3: [ADR-0051](../adr/0051-ordner-kanal-verweise-statt-kopien.md) „Ordner-Kanal – Verweise statt Kopien“ mit Nachträgen zu 0014, 0016, 0020 (Nachtrag 6), 0026 (OD-2), 0031 (Nachtrag J), 0043, 0049 und 0050.
- **Einordnung:** Manifest-Paket `ZP-1`, Block „Standardprojekt je Verbindung“ mit `BYL-E6-1100` bis `BYL-E6-1110`; Pakete `GH-1` (`BYL-E6-1120` bis `BYL-E6-1130`), `GH-2` (ab `BYL-E6-1131`) und `GH-3` (ab `BYL-E6-1184`), Block „GitHub-Kanal“; Pakete `OD-1` (`BYL-E6-1150` bis `BYL-E6-1162`) und `OD-2` (ab `BYL-E6-1163`), Block „Ordner-Kanal“.

## 1. Grundsatz der Spec

- Alles nur Einsicht und lesend: Die App schreibt nie nach GitHub und nie in Ordner.
- Neue Quellart „beobachtete Quelle“ (Datei im Ordner, Datei bzw. Pfad im Repo, PR), die ihren aktuellen Status nur anzeigt (geändert seit, nicht mehr vorhanden, PR gemergt bzw. geschlossen) und Tickets nie verändert. Bestehende Quellen bleiben eingefrorene Kopien ([ADR-0031](../adr/0031-herkunft-sichern.md)); Ordner-Quellen sind auf Wunsch des Nutzers Verweise statt Kopien (bewusste Ausnahme, eigene ADR).

## 2. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| 1 | Standardprojekt je Verbindung: Zielprojekt an jeder Karte, Einträge merken es sich, Umwandeln belegt vor, Filter und Gruppierung im Eingang | umgesetzt |
| 2 | GitHub-Kanal: ein Kanal mit Token (nur lesend), Repositories in der Karte mit beobachteten Pfaden, Ereignissen und Zielprojekt je Repository, Abruf per Cron mit ETag, Änderungserkennung per Blob-SHA, PRs und Releases, Statusanzeige | umgesetzt (GH-1, GH-2) |
| 3 | Ordner-Kanal: mehrere Ordner je Verbindung mit Filtern und Zielprojekt je Ordner, Polling mit Größe, Zeit und SHA-256, Einträge als Verweis, sichere Route zum Ansehen, Statusanzeige | umgesetzt (OD-1, OD-2) |

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
- **Karte:** Die Details einer GitHub- bzw. Ordner-Karte zeigen je Einheit ihr Zielprojekt; „Zielprojekt …“ im Menü der Karte bleibt das Ziel der Verbindung als Rückfall. GitHub (GH-2) stellt das Ziel eines Repositorys in dessen Dialog ein (leere Wahl „Wie die Verbindung“) und zeigt es in den Details als Text ([ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), Nachtrag GH-2); Paket 3 übernimmt das Muster.

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
- Weitere Änderungen: `connection-rules.js` (`github` in `SETTINGS_KEYS`, `watch` in `SERVER_FIELDS`, `requiresSecret`), `connection-service.js` (Ziel je Repository prüfen), `target-project-service.js` (`assertChoosable`, `projectFacts` exportiert), `inbox-service.js` (`watch`, `@watch`, `draft.target`, Kopie behält den Status), `inbox-fingerprint.js` (Familie GitHub), `secrets.js` (Token von GitHub), `source.js` (Kanal und Arten). `CREATABLE_TYPES` nimmt `github` mit GH-2 auf; bis dahin legte nur der Superuser eine Verbindung an (Tests).

### 5.3 Oberfläche (GH-2)

- **Domain (rein):** `domain/github.ts` (Spiegel von `github-rules.js`: Namen, Muster, Grenzen, Texte der Codes, `githubSettingsOf`/`githubSettingsValue`, Formular `GitHubRepoDraft` mit Pfaden als Text je Zeile und Kästchen für `docs/**/*.md`, `repoDraftErrors`, Details `githubDetailsOf`, Prüfung `githubCheckOf`/`checkSummary`, Texte der Karte), `domain/watch.ts` (Status lesen, `WATCH_LABELS`, `WATCH_LOZENGES` ohne Rot, `watchText`). `connections.ts`: Art `github`, `usesKeywords`, `secretOptional`, Feld `github`, Zustand `limited` mit `hint`; `channel-health.ts` (ohne Token neutraler Hinweis), `channel-card.ts` (`githubInfo`), `channel-setup.ts` (sechs Schritte mit Klickwegen und Prüfungen), `sync-all.ts` (`limited` neutral, zählt mit), `sources.ts` (Hinweis zur Kopie).
- **Daten und Stores:** `data/connections.ts` (`github` aus `settings`, Anlegen mit erstem Repository, `saveGitHubSettings`, `limited`), `data/github.ts` (`getGitHubDetails`, `checkGitHub`), `data/inbox.ts` (Feld `watch`), `data/errors.ts` (Texte der Codes `validation_github_*` und `validation_target_project_*`), `stores/github.svelte.ts` (Details je Verbindung, Prüfung), `ConnectionsStore.saveGitHub`.
- **Karte** `GitHubCard` (`ChannelCard`): Zustand, Infozeile, Hinweis (ohne Token, Rate-Limit, Fehler), Hauptknopf „Jetzt abrufen“ bzw. „Repository hinzufügen …“, Menü „•••“ mit „Repository hinzufügen …“, „Verbindung prüfen“, „Zielprojekt …“, „Pausieren“, „Umbenennen …“, „Einrichtung ansehen“, „Hilfe“, „Löschen …“. Details: Letzter Abruf, Ergebnis, Zugang, Anfragelimit, Intervall (Auswahl, speichert sofort), Zielprojekt der Verbindung und je Repository die Angaben aus `GET …/github` mit „Einstellungen …“ und „Entfernen …“ (Symbolknopf mit Rückfrage).
- **Repository:** `GitHubRepoFields` (Name oder Adresse, Ereignisse, Pfade je Zeile, `docs/**/*.md` als Kästchen, Zielprojekt mit „Wie die Verbindung“) in `GitHubRepoDialog` (Modal M der Karte; nach dem Hinzufügen einmal „Jetzt abrufen“) und in `SetupConnectForm`/`GitHubSetupRepos` (Assistent, inline).
- **Assistent** `?einrichten=github`: Token anlegen → Token setzen → Neu starten (ohne Prüfzeile vor der Verbindung) → Repositorys (legt die Verbindung mit dem ersten Repository an, danach weitere inline) → Zielprojekt (optional) → Verbindung prüfen (Zusammenfassung und je Repository).
- **Statusanzeige:** `InboxPanel` (Zeilen „Repository“, „Datei“, „Status der Quelle“), `TicketSources` (zweites `Lozenge`, Zeit bei Änderung).
- **Katalog** (Kachel „GitHub“), `ChannelIcon` (eigene Zeichnung), „Alle Kanäle jetzt abrufen“, Hilfe „GitHub“ (Abschnitt mit Klickwegen), README.

### 5.4 Tests

- Unit: `tests/unit/github-rules.test.mjs`, `tests/unit/github-readonly.test.mjs` (nur GET, statisch), `secrets.test.mjs`, `inbox-fingerprint.test.mjs`, `connection-rules.test.mjs`, `source.test.mjs` (über `support/schema.mjs`).
- Integration: `tests/integration/github-channel.test.mjs` gegen `tests/support/fake-github.mjs` (Ersterfassung ohne Flut, 304, Änderung mit Kopie und Diff, Status, neue und gelöschte Dateien, neue Muster, PRs mit Ticket unverändert, Releases, Paginierung, Zielprojekt je Repository, Einstellungen, Rate-Limit primär und sekundär, Fehler, ohne Token, „Verbindung prüfen“, Cron über `tests/fixtures/pb_hooks/github-cron.pb.js`, Zeit eines Laufs, nur GET, kein Token), `migrations-rollback.test.mjs`, `web-filter-parity.test.mjs` (Kanal `github`).
- GH-2: `tests/unit/web-github.test.mjs` (Spiegel der Regeln), `tests/unit/web-connections.test.mjs` (Art `github` anlegbar), `tests/integration/web-data-github.test.mjs` (Datenschicht gegen den Fake: Anlegen mit Repository, Einstellungen, Ablehnungen mit Texten, Lauf, Details, Prüfung, Status im Eingang, Rate-Limit); Web: `domain/github.test.ts`, `domain/watch.test.ts`, `channel-setup`, `channel-health`, `channel-card`, `sync-all`, `sources`, `components/channels/github.test.ts` (Karte, Dialog, Entfernen, Intervall, Prüfung, Rate-Limit, Neustart, Assistent), `inbox-panel.test.ts`, `ticket-sources.test.ts`, Katalog und Hilfe. Manuell: echtes Repository mit PAT, CHANGELOG-Änderung, PR-Merge, Status am Ticket (Manifest GH-2).

### 5.5 Nachtrag GH-3 (2026-10-02): alle Repositorys, Liste, „Alle meine Repositorys beobachten“

Nutzerwunsch nach dem Test von GH-2; Entscheidungen und Gründe: [ADR-0050](../adr/0050-github-kanal-und-beobachtete-quellen.md), Nachtrag vom 2026-10-02. Keine Migration; Hooks und Route wirken nach einem Neustart (`neu-starten.bat`), bis dahin zeigt die Karte den Schalter nicht und „Repository hinzufügen …“ nennt den Neustart statt der Liste.

- **Texte:** Assistent (Schritt „Token anlegen“ mit „All repositories“ und „Only select repositories“ als gleichwertigen Wegen, dem Unterschied der Reichweite, „Add permissions“ und dem vorbelegten Formular `GITHUB_TOKEN_TEMPLATE_URL`), Hilfe „GitHub“, README.
- **Server:** `github-rules.js` (`auto`, `exclude` in `settingsViolation`/`settingsOf` mit `validation_github_auto`/`_exclude`; Liste `listEntryOf`, `listOf`, `listDue`, `listRefreshable`, `listRepos`, `listChoices`; Automatik `autoReason`, `autoConfig`, `effectiveRepos`, `autoChanges`, `autoHint`, `autoStateOf`; `stateOf` mit `list` und `auto`; `repoSummary` mit `auto`), `github-service.js` (`fetchList` über `GET /user` und `GET /user/repos`, `run` liest die Liste nach einer Stunde und beobachtet die automatischen, erste PRs eines automatischen Repositorys nicht als Einträge, `summary` mit den beobachteten Repositorys und `auto`, `check` über die beobachteten, `repoList` für die Route), `github.pb.js` (`GET /api/byl/connections/{id}/github/repos`, `refresh=1`), `connection-rules.js` (Schlüssel).
- **Oberfläche:** `domain/github.ts` (Einstellungen mit `auto`/`exclude`, `withRepos`, `withExcluded`, `withoutExcluded`, Liste `githubRepoListOf`, `filterRepoChoices`, `choiceNote`, Formular `addDraftErrors`/`reposFromAddDraft`, Details `auto`, Texte `AUTO_HINT`, `autoText`, `autoChangeText`), `data/github.ts` (`listGitHubRepos`), `stores/github.svelte.ts` (`repoList`, `loadRepoList`), neue Komponente `GitHubRepoPicker` in `GitHubRepoDialog` und `GitHubSetupRepos`, `GitHubCard` (Schalter, automatische Repositorys mit „Anpassen …“ und „Ausschließen …“, „Ausgeschlossen“ mit „Wieder aufnehmen“, Infozeile mit der Zahl der beobachteten), `SetupConnectForm` (Kästchen „Alle meine Repositorys beobachten“, erstes Repository dann freiwillig), `channel-setup.ts` (Schritt „Repositorys“ erledigt auch mit der Option).
- **Tests:** `github-rules.test.mjs`, `web-github.test.mjs`, `github-channel.test.mjs` (Liste über Seiten mit ETag, ohne Token, nur gewährte Repositorys, Automatik ohne Flut, neues/archiviertes/gelöschtes Repository nach einer Stunde, Anpassen und Ausschließen, Codes), `web-data-github.test.mjs`, `domain/github.test.ts`, `channel-setup.test.ts`, `channel-card.test.ts`, `components/channels/github.test.ts`, `help-page.test.ts`; `fake-github.mjs` mit `/user/repos`, `archive`, `removeRepo`, `grantOnly`, Organisationen und Forks. Der statische Test „nur GET“ bleibt grün. Manuell: Liste und Option mit echtem Token (Manifest GH-3).

### 5.6 Folgepunkte

- Issues, fehlgeschlagene Workflows und Dependabot als Ereignisse (ADR-0050 §4: nicht minimal, weitere Rechte und eigene Auswahl nötig).
- Gelöschte Releases erkennen (bräuchte das Lesen aller Seiten je Lauf).
- Umbenannte Repositorys: Einträge behalten den alten Schlüssel; erst ein Eintrag mit dem neuen Namen ersetzt den Eintrag in den Einstellungen.

## 6. Paket 3: Ordner-Kanal

Entscheidungen und Gründe: [ADR-0051](../adr/0051-ordner-kanal-verweise-statt-kopien.md). Zwei Teilpakete, je ein PR: **OD-1** Server, Erkennung, Status und Route zum Ansehen (keine Oberfläche außer der Familie „Ordner“ in Chips und Symbol); **OD-2** Karte mit Ordnern, Dialog eines Ordners, „Vorhandene Dateien übernehmen“, Statusanzeige mit „Ansehen“ in Eingang und Ticket, Hilfe „Ordner“, README.

### 6.1 Datenmodell (Migration `1790203300_folder_channel.js`)

| Feld | Art | Inhalt |
|---|---|---|
| `connections.type` | Wert `folder` | der Kanal |
| `inbox_items.channel`, `tickets.source` | Wert `folder` | Einträge und Tickets aus Ordnern |
| `inbox_items.kind` | Wert `file` | eine Datei eines beobachteten Ordners (Änderungen: `change`) |
| `connections.secret_env` | nicht mehr Pflicht | ein Ordner hat keine Zugangsdaten; der Hook verlangt für jede andere Art weiter einen Namen |
| `connections.watch` | 8 MB statt 1 MB | Stand je Ordner: Dateien mit Größe, Zeit und SHA-256 |
| `connections.settings` (Ordner) | JSON | `interval` (1 bis 60, Standard 5) und `folders` (höchstens 10: `path`, `subfolders`, `types`, `exclude`, `target`, `report_changes`) |

Rückweg: Einträge und Tickets aus Ordnern werden manuelle (`todo` statt `file`), Ordner-Verbindungen fallen weg (ihre Einträge verlieren nur die Verbindung), `secret_env` ist wieder Pflicht, `watch` hält 1 MB (Rollback-Test mit Daten).

### 6.2 Server (OD-1)

- `lib/folder-rules.js` (rein): Pfade je Plattform (`parseFolderPath`, `relativeOf`, `isRelative`, Windows-Namen, Laufwerk, UNC, Gerätepfade), Ausschlussmuster und Typen (`excludeMatcher`, `isWatched`), Einstellungen (`settingsViolation`, `settingsOf`, `addedFolders`, `changedTargets`), Fälligkeit (`isDue`), Grenzen (`LIMITS`, `limitsOf` im Testmodus), Art eines Eintrags im Ordner (`entryKind`: Datei, Ordner, Link, Sonderdatei; `isOffline`), Vergleich (`scanDiff`), Fassungen (`versionOf`), Verschieben (`matchMoves`), Status (`fileWatch`, `movedWatch`), Einträge (`fileDraft`), Stand und Karte (`stateOf`, `stableJson`, `folderSummary`, `runHint`), Antwort der Route (`contentOf`, `contentDisposition`, `fileRefusal`), Hash-Helfer (`HASH_SCRIPT`, `encodedCommand`, `asciiJson`, Auswertung).
- `lib/folder-hash.js`: SHA-256 bis 16 MB im Server (`toString` über `os.Root`), bis 200 MB mit dem Helfer des Systems (Windows PowerShell mit festem Skript bzw. `sha256sum`).
- `lib/folder-service.js`: `run` (Lauf je Verbindung: Ordner listen ohne Links und ohne den Ordner der App, vergleichen, hashen, Verschiebungen über alle Ordner, Einträge, Status, Stand nur bei Änderung), `runDue` (Cron), `summary` (Details der Karte), `existing` und `adopt` („Vorhandene Dateien übernehmen“), `assertNewFolders` (Prüfung neuer Ordner auf der Platte), `itemInfo` und `serveFile` (Ansehen).
- `folders.pb.js`: Cron `byl-folders` (jede Minute, nicht im Testmodus), `GET /api/byl/connections/{id}/folders`, `GET …/folders/existing?folder=<ID>`, `POST …/folders/adopt`, `GET /api/byl/folders/items/{id}` und `GET …/{id}/file`. „Jetzt prüfen“ über die gemeinsame Route `…/run`.
- Weitere Änderungen: `connection-rules.js` (`folder` in `SETTINGS_KEYS`, `SECRETLESS_TYPES`, `secretViolation`, Prüfung der Einstellungen über die Regeln der Ordner), `connection-service.js` (`guardFolders`: Platte und Ziel je Ordner), `channel-runner.js` (Art `folder`), `inbox-fingerprint.js` (Familie), `source.js` (Kanal, Art), `system-rules.js` (Rate-Limit `file`). `CREATABLE_TYPES` nimmt `folder` seit OD-2 auf; davor legte nur der Superuser eine Verbindung an (Tests).

### 6.3 Oberfläche (OD-2)

- **Domain (rein):** `domain/folders.ts` (Spiegel von `folder-rules.js`: Pfade, Muster, Typen, Grenzen, Texte der Codes und der Ablehnungen, Einstellungen, Formular eines Ordners, Details, Vorhandene, Angaben eines Eintrags), `domain/watch.ts` (Zustand `moved`), `domain/sources.ts` (Kopie-Status „Verweis“), `connections.ts` (Art `folder` ohne Variable: `usesSecret`, keine Stichwörter), `channel-card.ts` (`folderInfo`), `channel-setup.ts` (Assistent `ordner`: Pfad kopieren, Ordner, Zielprojekt, Prüfen).
- **Daten und Stores:** `data/folders.ts` (Details, Vorhandene, Übernehmen, Ansehen als Ergebnis statt Ausnahme), `data/connections.ts` (Einstellungen der Ordner, leere Variable), `stores/folders.svelte.ts` (Details je Karte, Übernehmen in Blöcken mit Fortschritt), `stores/folder-view.svelte.ts` („Ansehen“ im Layout der App, neuer Tab ohne Rückverweis bzw. Download), `stores/connections.svelte.ts` (`saveFolders`, kein `secret-status` für Ordner).
- **Karte** `FolderCard` auf `ChannelCard` mit Ordnern in den Details, **Dialog** `FolderDialog` mit `FolderFields` (Modal M), **Assistent** mit `FolderSetupList` (weitere Ordner inline), **Übernehmen** `FolderExistingDialog` (Modal L, Auswahl mit Filter, nichts vorausgewählt), **Statusanzeige** mit „Ansehen“ und „Herunterladen“ in `InboxPanel` und „Aktuelle Datei öffnen“ in `TicketSources`, Kachel „Ordner“ im Katalog, Symbol, Hilfe „Ordner“, README.

### 6.4 Tests

- Unit: `tests/unit/folder-rules.test.mjs`, `tests/unit/folder-readonly.test.mjs` (nur lesend, statisch), `connection-rules.test.mjs`, `inbox-fingerprint.test.mjs`, `system-rules.test.mjs`, `source.test.mjs` (über `support/schema.mjs`).
- Integration: `tests/integration/folder-channel.test.mjs` (Ersterfassung ohne Flut, neue Datei als Verweis mit Angaben, Änderung mit und ohne „Änderungen melden“, Dedup je Pfad und Hash, nur berührt, Rückkehr zu einer früheren Fassung, gelöscht, umbenannt und verschoben mit und ohne Hash, mehrdeutige Kopien, Ticket unverändert, Typen, Unterordner, eigene Ausschlüsse, Hash im Server und per Helfer, Datei über der Hash-Grenze, Grenze der Dateien, neue Einträge je Lauf, unerreichbarer Ordner ohne „gelöscht“, Zielprojekt je Ordner, Prüfung neuer Ordner auf der Platte samt Junction, Kurzname und Ordner der App, keine Variable, Details, Vorhandene übernehmen, Cron, Ordner unverändert, kein Pfad im Log) und `tests/integration/folder-file-route.test.mjs` (Sicherheit der Route), `migrations-rollback.test.mjs`, `web-filter-parity.test.mjs`.
- Kleinere Grenzen nur im Testmodus über `BYL_TEST_FOLDER_LIMITS` (JSON, nie größer als die echten); Ordner nur in Temp-Verzeichnissen der Tests, nie Ordner des Nutzers.
- Oberfläche (OD-2): `tests/unit/web-folders.test.mjs` (Spiegel der Regeln), `web-connections.test.mjs` (keine Variable für Ordner), `web/src/lib/domain/folders.test.ts`, `watch.test.ts`, `sources.test.ts`, `channel-card.test.ts`, `channel-setup.test.ts`; Bausteine `channels/folders.test.ts` (Karte, Dialog, Übernehmen, Assistent), `inbox-panel.test.ts` und `ticket-sources.test.ts` („Ansehen“, neutral bei fehlender Datei), `help-page.test.ts`; Datenschicht `tests/integration/web-data-folders.test.mjs` gegen Ordner in Temp-Verzeichnissen.
- Manuell (OD-2): echten Ordner hinzufügen, Datei ändern, PDF ansehen, Datei löschen bzw. verschieben.

### 6.5 Hinweise und Folgepunkte

- **Pi/Docker-Betrieb** ([ADR-0028](../adr/0028-plattform-strategie.md), zurückgestellt): Der Kanal funktioniert nur, weil Server und Dateien auf demselben Rechner liegen. Im Container müssen die Ordner als Volume eingebunden werden, und in der Karte steht dann der Pfad im Container (etwa `/daten/projekte`). Der Hash-Helfer ist dort `sha256sum` (BusyBox oder coreutils im Image).
- **Netzlaufwerke** sind erlaubt (UNC und verbundene Laufwerke): Ein getrenntes Laufwerk ist ein Fehler des Ordners ohne „gelöscht“ für seine Dateien; ein hängendes Laufwerk hält einen Lauf bis zur Zeitgrenze des Systems auf (ADR-0051, Grenzen).
- Folgepunkte: ein Ordner-Dialog des Systems (der Browser kennt keinen Pfad); Ereignisse des Dateisystems statt Polling (bräuchte einen Hilfsprozess); Ansehen weiterer Typen inline (Office) nur über einen Betrachter ohne Ausführung.
