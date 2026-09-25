# CLAUDE.md – becauseyoulovejira

Verbindliche Projektregeln. Gilt für jede Änderung in diesem Repo. Bei jeder relevanten Entscheidung aktualisieren.

## 1. Zweck

Privates, lokal laufendes Ticket-Dashboard (Linear-/Jira-artiges Ticket-Handling ohne Prozesslast) für Windows 10, genutzt im Desktop-Browser (Chrome, Firefox, Opera GX). Die komplette Installation ist ein einzelner Ordner (`app/`): Start per Doppelklick, Sicherung und Umzug per Ordnerkopie.

## 2. Repo-Struktur

```
becauseyoulovejira/
  app/                 portabler Laufzeitordner (wird kopiert/gesichert)
    pocketbase.exe     gitignored, via scripts/fetch-pocketbase.ps1 (SHA256-geprüft)
    byl-mail.exe       optionaler Mail-Hilfsprozess, gitignored, via scripts/build-mail-helper.ps1
    pb_hooks/          *.pb.js Hooks, lib/*.js reine CommonJS-Module
    pb_migrations/     handgeschriebene JS-Migrationen
    pb_public/         Frontend-Build (gitignored)
    pb_data/           Daten (gitignored, niemals committen)
    start.bat, start-hidden.vbs, autostart-an.bat, autostart-aus.bat
  web/                 SvelteKit-Quellcode, Build nach ../app/pb_public
  helpers/mail/        Mail-Hilfsprozess (TypeScript strict, eigenes package.json), Build nach ../../app/byl-mail.exe
  scripts/             Build-/Setup-Skripte (PowerShell)
  tests/               Vitest-Tests (u. a. für app/pb_hooks/lib/recurrence.js)
  docs/                README-Assets, ADRs
```

## 3. Tech-Stack (festgelegt – Änderung nur nach Rückfrage beim Nutzer)

- **Backend:** PocketBase **v0.40.4**, Windows-Binary unverändert, kein Go-Build. Datenhaltung SQLite.
  - Serverlogik ausschließlich über JS-Hooks (`app/pb_hooks`, Goja-Runtime, ES5-kompatibel, kein ESM, keine Node-APIs).
  - Schema ausschließlich über handgeschriebene JS-Migrationen (`app/pb_migrations`). Server läuft mit `--automigrate=false`; keine Schemaänderungen über das Admin-Dashboard.
  - Bindung nur an `127.0.0.1:8090` (vorerst; Mehrgeräte geplant, siehe [ADR-0001](docs/adr/0001-betriebsmodell-lokal-mehrgeraete-spaeter.md)).
- **Frontend:** SvelteKit 2 + Svelte 5 + TypeScript (strict), `@sveltejs/adapter-static` im SPA-Modus (`ssr = false`, `prerender = false`, `fallback: 'index.html'`), Build nach `app/pb_public`. PocketBase JS SDK für API und Realtime.
- **Schriften:** Inter (UI) und JetBrains Mono (Ticket-Keys) lokal über `@fontsource-variable/*`. **Keine externen CDNs** – die App muss offline funktionieren.
- **Tests:** Vitest; Hook-Integrationstests per Skript gegen eine Wegwerf-Instanz (temporäres `--dir`). Die Root-Tests liegen unter `tests/unit` und `tests/integration`, die web-Tests unter `web/src/**/*.test.ts`. `npm test` im Root braucht vorher den Web-Build (`app/pb_public`) für den SPA-Fallback-Test; `scripts\build.ps1` hält die Reihenfolge ein (check → lint → build → test) und wird mit `powershell -ExecutionPolicy Bypass -File scripts\build.ps1` aufgerufen.
- **Node.js:** Dev-Werkzeug (Build/Test), Version 24, portabel in einem beliebigen Ordner (`<Node-24-Ordner>`). Dieser Ordner muss im `PATH` liegen; `scripts\build.ps1` prüft das. Zur Laufzeit nur eingebettet im optionalen Mail-Hilfsprozess `app/byl-mail.exe` (Node-24-Single-Executable-Application mit `imapflow` und `postal-mime`, gebündelt mit esbuild, eingespritzt mit postject; [ADR-0016](docs/adr/0016-kanal-architektur-und-mail.md) §4 und §5). Er liest Postfächer nur (IMAP `EXAMINE`, `BODY.PEEK`, keine Flags, kein SMTP) und schreibt nur über die Ingest-Route mit `BYL_INGEST_TOKEN`. Ein installiertes Node ist für den Betrieb nicht nötig.

### PocketBase-API-Disziplin

Die APIs (Hooks, Migrationen, SDK) haben sich zwischen Versionen stark geändert. Vor jedem Hook-/Migrationscode die Doku der gepinnten Version prüfen (pocketbase.io/docs, JSVM-Referenz pocketbase.io/jsvm) – nicht aus Erinnerung schreiben.
- Hook-Handler müssen `e.next()` aufrufen.
- Create und Update über die Record-API laufen in v0.40.4 **nicht** automatisch in einer Transaktion (nur Delete mit Kaskaden). Hooks, die mehrere Schreibvorgänge atomar brauchen, öffnen sie selbst, und zwar verbindlich über den Helfer `inTransaction(e, fn)` aus `app/pb_hooks/lib/transaction.js` (`fn(txApp)` ruft `e.next()` auf). Ein bloßes `e.app = txApp` ohne Zurücksetzen ist fehlerhaft: Nach dem Commit zeigt `e.app` sonst auf die beendete Transaktion, und die After-Success-Hooks sowie der Realtime-Broadcast scheitern still. Der Helfer setzt `e.app` für die Dauer der Transaktion auf `txApp` und stellt es danach (auch im Fehlerfall) wieder her ([E1-Plan](docs/plan/e1.md) §2, OF-1 und Abschnitt 6, Paket 5).
- In Hooks für DB-Zugriffe `e.app` verwenden, nicht `$app` (Deadlock-Gefahr innerhalb von Transaktionen). In `runInTransaction((txApp) => …)` nur `txApp` verwenden.
- Module per `require(`${__hooks}/lib/<name>.js`)` **innerhalb** des Handlers laden (Handler laufen in isolierten Scopes).
- Filter mit Nutzereingaben immer parametrisiert (`{:param}` bzw. `pb.filter()` im SDK), nie per String-Konkatenation.
- Keine Zeitzonen-APIs der Laufzeit für fachliche Berechnungen: `new Timezone(...)` und `new DateTime(x, "Europe/Berlin")` liefern ohne tzdata stillschweigend UTC ([ADR-0005](docs/adr/0005-zeitzone-europe-berlin.md)).

## 4. Svelte-5-Runes-Regel (hart)

- Ausschließlich Runes: `$state`, `$derived`, `$effect`, `$props`, `$bindable`.
- Verboten: `export let`, `$:`-Statements, `svelte/store`-Stores für Komponenten- oder App-Zustand, `on:click`-Direktiven, `<slot>`.
- Stattdessen: Event-Attribute (`onclick`), Snippets (`{#snippet}` / `{@render}`), geteilter Zustand in `.svelte.ts`-Modulen mit Runes.
- `$effect` nur für echte Seiteneffekte (Subscriptions, DOM, localStorage), nicht zur Ableitung von Zustand – dafür `$derived`.

## 5. Datenmodell

Alle fachlichen Datensätze tragen `owner` (Pflicht, Relation `users`) und `household` (optional, vorerst leer). Ausnahme: `comments` und `ticket_history` haben kein `owner`/`household`; ihre Sichtbarkeit folgt dem Ticket (OF-5 im [E1-Plan](docs/plan/e1.md)). `ticket_reads` gehört dem Nutzer über `user`.

| Collection | Wesentliche Felder |
|---|---|
| `users` | Auth-Collection; Selbstregistrierung gesperrt; unread_since (Grundlinie „Neu“), import_keywords (json, Stichwörter der Datei-Importe `eml`, `ics`, `whatsapp`) |
| `households` | name |
| `household_members` | user, household, role |
| `projects` | name, code (2–6 Großbuchstaben, eindeutig pro Scope), archived, scope |
| `tags` | name (eindeutig pro Scope, ohne Groß-/Kleinschreibung), scope |
| `tickets` | number, key, title, description (Markdown), status, priority, due (Datum), project?, tags[], completed_at, parent?, blocks_parent (bool, Standard true), recurrence?, source (Kanal des Ursprungs, leer = manuell), source_item? (Eingangseintrag), scope |
| `comments` | ticket, author, body (Markdown); kein owner, Sichtbarkeit über das Ticket |
| `ticket_history` | ticket, field, old_value, new_value, user, created; kein owner, Sichtbarkeit über das Ticket |
| `dependencies` | blocker → blocked (Stufe 2; Zyklen im Hook verhindert) |
| `recurrence_rules` | Vorlage (title, description, project, tags, priority), mode `calendar` \| `after_completion`, Regelparameter, next_due, last_generated_at, active |
| `ticket_counters` | intern (alle API-Regeln `null`): key, value |
| `inbox_items` | channel, kind, title, body, source_url, source_ref, source_date, source_meta (json), original (Datei, protected), connection?, fingerprint, state `new` \| `converted` \| `discarded`, ticket?, handled_at, scope ([ADR-0014](docs/adr/0014-datenmodell-eingang.md)) |
| `ticket_reads` | user, ticket, seen_at; eindeutig pro (user, ticket) ([ADR-0015](docs/adr/0015-neu-markierung-pro-nutzer.md)) |
| `connections` | type `calendar` \| `telegram` \| `mail` (`notion` vorbereitet), label, enabled, secret_env (nur der Name einer `BYL_*`-Variablen), settings (json: Stichwörter, Anbieter, Benutzer, …), cursor, last_run_at, last_ok_at, last_error, last_hint, running_since, scope ([ADR-0016](docs/adr/0016-kanal-architektur-und-mail.md), [ADR-0018](docs/adr/0018-secrets.md)) |

- **Status (Enum):** `backlog`, `open`, `in_progress`, `waiting`, `done`. Interne Kategorie: backlog/open → *offen*, in_progress/waiting → *aktiv*, done → *abgeschlossen*. Zuordnung zentral in `app/pb_hooks/lib/status.js`, gespiegelt in `web/src/lib/domain/status.ts`.
- **Priorität (Enum):** `low`, `medium`, `high`, `urgent`.
- **completed_at:** vom Hook gesetzt bei Wechsel nach `done`, geleert beim Verlassen von `done`.
- **Fälligkeit:** reines Kalenderdatum, gespeichert als `YYYY-MM-DD 00:00:00.000Z`. Maßgebliche Zeitzone für „heute": `Europe/Berlin`, serverseitig berechnet durch das reine Modul `app/pb_hooks/lib/berlin-time.js` (seit E4, EU-Sommerzeitregel, gespiegelt in `web/src/lib/domain/berlin-date.ts`), nicht über Zeitzonen-APIs der Laufzeit ([ADR-0005](docs/adr/0005-zeitzone-europe-berlin.md)).
- **Historie:** `onRecordUpdate` vergleicht `e.record.original()` feldweise (Whitelist fachlicher Felder) und schreibt in derselben, vom Hook geöffneten Transaktion wie die Änderung nach `ticket_history`; die Anlage wird ebenfalls protokolliert.
- **Parent (Stufe 2, nur Guard):** maximal eine Ebene, im Hook erzwungen.
- **Eingang ([ADR-0014](docs/adr/0014-datenmodell-eingang.md)):** Alle Kanäle legen Einträge über `app/pb_hooks/lib/inbox-service.js` an. Der Hook setzt `scope`, `fingerprint`, `state = new` und `handled_at`.
  - **Duplikate:** Der Fingerprint ist ein SHA-256 über einen kanalübergreifenden Schlüssel (Message-ID, `UID` plus `RECURRENCE-ID`, Telegram-Kennung, normalisierte URL, …). `UNIQUE (scope, fingerprint)` ist das Sicherheitsnetz, und Duplikate werden als Ergebnis gemeldet, nicht als Fehler.
  - **Umwandeln:** Der Client sendet beim Anlegen nur `source_item`. In derselben Transaktion setzt der Ticket-Hook dann `tickets.source` und den Eintrag auf `converted`; umgewandelt ist endgültig.
  - **Verworfen ist ein Tombstone:** Nach 30 vollen Berliner Tagen leert der tägliche Cron-Job `byl-inbox-cleanup` Text, Originaldatei und `source_meta` (bis auf `keyword`, `all_day`, `recurrence_id`) und kürzt den Titel. Fingerprint und Zustand bleiben.
  - **Quelldatum:** `source_date` wird nie automatisch zur Fälligkeit.
- **„Neu“ ([ADR-0015](docs/adr/0015-neu-markierung-pro-nutzer.md)):** Ein Ticket ist für einen Nutzer neu, wenn `created >= users.unread_since` (leer = `created` des Nutzers), der Status nicht `done` ist und es keine Zeile in `ticket_reads` gibt. Öffnen und einzelnes Anlegen markieren gelesen.
- **Kanäle und Stichwörter ([ADR-0016](docs/adr/0016-kanal-architektur-und-mail.md), [ADR-0020](docs/adr/0020-stichwoerter-pro-kanal.md)):** Zugangsdaten stehen nur als `BYL_*`-Variablen im Windows-Konto; `connections.secret_env` nennt den Namen ([ADR-0018](docs/adr/0018-secrets.md)).
  - Automatisch übernommen wird nur, was ein Stichwort der Verbindung trifft. Der Abgleich läuft zweimal rein und gleich (`lib/keywords.js`, `domain/keywords.ts`, Paritätstest).
  - Datei-Importe und die Postfach-Auswahl sind manuell und gehen auch ohne Stichwort.
  - Google Calendar und Telegram laufen per Cron im Hook (`lib/channel-runner.js`). Postfächer (Web.de, Gmail) holt `byl-mail.exe` über die Ingest-Route mit `BYL_INGEST_TOKEN`.

### Scopes und Nummernkreise

- Jeder Datensatz gehört genau einem Scope: privat `u:<ownerId>` (household leer) oder Haushalt `h:<householdId>`. Der Hook setzt das Feld `scope` auf `projects`, `tags`, `tickets`, `inbox_items` und `connections`.
- Key: `<CODE>-<NR>` mit Projekt, sonst `TASK-<NR>`. Nummernkreise je Scope + Projekt bzw. Scope + TASK (Zählerschlüssel `<scope>:<projectId|TASK>`).
- Vergabe im `onRecordCreate`-Hook innerhalb einer vom Hook geöffneten Transaktion (siehe §3): UPSERT `INSERT … ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value` auf `ticket_counters` (legt fehlende Zähler an, Schreib-Lock sofort, robust gegen gleichzeitige Anlage; OF-1). Eindeutige Indizes `tickets(scope, key)`, `projects(scope, code)` und `tags(scope, name COLLATE NOCASE)` als Sicherheitsnetz.
- Wechsel von Projekt oder Scope ⇒ neuer Key im Ziel-Nummernkreis; alter Key bleibt in der Historie. URLs referenzieren Tickets per Record-ID, nie per Key.

### API-Regeln

Umsetzung in `app/pb_migrations/1790200900_api_rules.js`, Details und Befunde im [E1-Plan](docs/plan/e1.md) (Paket 4, OF-2, OF-3, OF-5). Alle Regeln ungleich `null` greifen nur für angemeldete Nutzer (fachliche Collections prüfen ausdrücklich `@request.auth.id != ""`).

- `projects`, `tags`, `recurrence_rules`, `tickets`, `inbox_items`, `connections` (die beiden letzten mit eigenen Migrationen `1790201220_inbox_api_rules.js` und `1790201400_create_connections.js`):
  - list/view/update/delete: `owner = @request.auth.id || (household != "" && @collection.household_members.household ?= household && @collection.household_members.user ?= @request.auth.id)`
  - create: `@request.body.owner = @request.auth.id` und ein gesetzter `household` nur mit eigener Mitgliedschaft.
  - update zusätzlich: `@request.body.owner:changed = false`, neuer `household` nur mit eigener Mitgliedschaft (eigener Join-Alias `:target`).
- `comments`: Sichtbarkeit wie das Ticket (`ticket.owner`/`ticket.household`); create nur mit `author = @request.auth.id`; update/delete nur durch den Autor, `author` und `ticket` unveränderlich.
- `ticket_history`: list/view wie das Ticket, Schreiben `null` (nur der Hook).
- `inbox_items`: Unveränderliche Felder und erlaubte Zustandswechsel (`new` ↔ `discarded`, `new` → `converted` nur mit Ticket im selben Scope) prüft der Hook bei Client-Anfragen. `connections`: `cursor`, `last_*` und `running_since` schreibt nur der Server.
- `ticket_reads`: list/view/create/delete nur mit `user = @request.auth.id`; create zusätzlich nur für sichtbare Tickets; update `null`.
- `users.import_keywords` prüft `app/pb_hooks/users.pb.js` bei Client-Änderungen. Die Ingest-Routen (`/api/byl/ingest/*`) gelten nur mit `Bearer BYL_INGEST_TOKEN` (ohne Variable 404) und legen nur für eingeschaltete Mail-Verbindungen und deren Besitzer an.
- `dependencies`: list/view wie oben, Schreiben `null` bis Stufe 2.
- `households`: list/view nur für Mitglieder; `household_members`: list/view nur eigene Zeilen; Schreiben jeweils `null` bis zur Haushaltsstufe.
- `users`: list/view/update nur der eigene Datensatz, create/delete `null`. `ticket_counters`: alle Regeln `null`.
- Mail-Flows: Solange kein Mailer eingerichtet ist, lehnt `app/pb_hooks/mail-flows.pb.js` (`routerUse`) POST auf `request-password-reset`, `request-verification`, `request-email-change` und `request-otp` jeder Auth-Collection einheitlich mit 400 ab (keine Enumeration). Login-Warnmails (`authAlert`) sind per Migration `1790201100_disable_auth_alerts.js` aus.
- Bedingungen auf denselben `@collection`-Alias gelten für dieselbe Zeile. Join-Semantik und Realtime-Verhalten sind per Negativtests mit mehreren Nutzern und Haushalten belegt (`tests/integration/rules.test.mjs`, `realtime-rules.test.mjs`).

## 6. Wiederkehrende Aufgaben (Kernfunktion)

- Prinzip Vorlage/Instanz: Eine Regel erzeugt Tickets. **Pro Regel maximal eine offene Instanz** (Status ≠ done); Erzeugung ist idempotent.
- `calendar`: selbst implementierte RRULE-Teilmenge – täglich, wöchentlich (mit Wochentagen), monatlich (Tag des Monats oder letzter Tag), jährlich, jeweils mit Intervall.
- `after_completion`: nächste Fälligkeit = Erledigungsdatum + Intervall.
- Auslöser: Erledigen der aktuellen Instanz (Hook), Cron-Hook für Kalenderregeln, Catch-up beim Serverstart. Verpasste Termine ⇒ genau **eine** Instanz mit dem jüngsten fälligen Termin, keine Stapel.
- Berechnung in `app/pb_hooks/lib/recurrence.js`: rein, seiteneffektfrei, CommonJS, ES5, ohne Abhängigkeiten; rechnet nur mit Kalenderdaten, „heute" wird als Parameter übergeben. Vitest-Pflichtfälle: Monatsenden, Schaltjahre, Sommerzeit, lange Ausfallzeiten.

## 7. Frontend & UX

- UI-Sprache Deutsch. Desktop zuerst, auf schmalen Bildschirmen benutzbar.
- Seitenaufbau ab E3 nach dem Vorbild des Task-Boards, mit eigenen Farben und eigenem Code ([ADR-0010](docs/adr/0010-layout-nach-task-board.md)); was Client und Server bei Filter, Suche und Sortierung rechnen: [ADR-0013](docs/adr/0013-filter-suche-sortierung-gruppierung.md).
- Ansicht „Aufgaben“ ([ADR-0010](docs/adr/0010-layout-nach-task-board.md)): Kopfzeile (App-Name mit Zähler der nicht erledigten Tickets, Bereichs-Umschalter, „Neues Ticket“, „Kanäle“, Theme-Umschalter „Darstellung“, Sitzung), Kennzahlen-Kacheln, Filterleiste mit Suche, Abschnittsleiste (Umschalter „Aufgaben | Projekte | Eingang“ mit Zahlen für „neu“, „Erledigte anzeigen“, „Gruppieren“), dann die Tabelle mit sortierbaren Spaltenköpfen und Gruppen (Key mit Punkt für „neu“, Priorität, Status-Pille, Titel mit Symbol der Quelle und Icon für wiederkehrend, Projekt, Tags, Fälligkeit relativ, Erstellt, Aktionen mit Häkchen; Icon für blockiert ab Stufe 2) und rechts das Detail-Panel. Die Projektansicht `/projekte` ersetzt Kennzahlen, Filterleiste und Tabelle durch Projektkacheln und die Tag-Verwaltung.
- Filter (Status, Projekt, Tag, Priorität, Fälligkeit, Quelle), Sortierung, Gruppierung (auch „Nach Quelle“), Suche (PocketBase-Filter auf Titel und Beschreibung); Filterzustand in der URL. Quelle als Familien ([ADR-0019](docs/adr/0019-kanal-filter-und-gruppierung.md)), eine eigene Spalte kommt erst mit E6.
- Projektansicht mit Projektauswahl; Ticket-Detail als Seitenpanel mit Inline-Bearbeitung, Kommentaren, Historie.
- **Overlays und Rückmeldungen ([ADR-0025](docs/adr/0025-ui-konsistenz-overlay-system.md), Umsetzung in Paketen UI-1 bis UI-9 nach [docs/plan/e6-ui.md](docs/plan/e6-ui.md)):**
  - Genau sechs Bausteine unter `web/src/lib/components/overlay/` (Logik in `web/src/lib/overlay/`): Modal, Bestätigung, Popover, Seitenpanel, Vollansicht, Flag. Kein `window.confirm`, keine eigenen Dropdowns, kein eigenes `<dialog>` und kein eigener `::backdrop` in Komponenten, keine UI-Bibliothek.
  - **Modal:** Größen S/M/L/XL (400/600/800/1000 px), fester Kopf mit Titel und ×, scrollender Inhalt, fester Fuß rechtsbündig (sekundär links von primär; „Abbrechen“, solange nichts gespeichert ist, sonst „Schließen“). ×, Esc und Klick aufs Blanket schließen; bei ungespeicherten Eingaben ersetzt eine Verwerfen-Frage den Fuß, bei laufender Aktion ist jeder Weg gesperrt. Fokus beim Öffnen auf das erste Element des Inhalts, beim Schließen zurück zum Auslöser, beides im Baustein. Kein Dialog aus einem Dialog.
  - **Bestätigung:** Modal S, Titel als Frage, Knopf mit Verb, erster Fokus auf „Abbrechen“, nicht rot. Navigation mit ungespeicherten Eingaben fragt über diesen Dialog (`beforeNavigate` bricht ab und navigiert nach „Verwerfen“ erneut).
  - **Popover:** `popover="auto"` mit JS-Positionierung (unter dem Knopf, 4 px Abstand, Flip, Klemmen am Rand), Arten `menu` und `panel`; `aria-haspopup`, `aria-expanded`, `aria-controls`; Esc und Klick daneben schließen, der Fokus kehrt zum Knopf zurück. Native `<select>` bleiben in Formularen.
  - **Seitenpanel:** 480 px, fester Kopf (Kontext, Aktionen, „Vollansicht“, ×) und fester Fuß, Slide-in nur beim ersten Öffnen. Ab 64rem eingebettet wie in Jira: volle rechte Spalte neben der ganzen Ansicht (Kennzahlen, Filter, Abschnittsleiste, Tabelle), von der Kopfzeile (ab 64rem `sticky`, Höhe in `--app-header-height`) bis zum unteren Rand; die Ansicht staucht sich. Zwischen 36 und 64rem Overlay von rechts mit `--color-blanket`, Ansicht und Kopfzeile `inert`, Klick aufs Blanket schließt wie ×; unter 36rem volle Breite. Tabellen scrollen nie seitlich (kein `min-width`): ihr Rahmen ist ein Container (`container-type: inline-size`), Container-Queries blenden Spalten mit `data-col` in fester Reihenfolge aus (Aufgaben: Erstellt, Tags, Projekt, Fällig; Eingang: Eingangsdatum, Quelle, Art, Quelldatum), Häkchen bzw. Auswahl, Titel und Aktionen bleiben. × und Esc führen zur Liste, außer ein Feld ist im Bearbeitungsmodus. Baustein `overlay/Drawer.svelte`, Anordnung neben der Liste `ViewWithPanel.svelte`; kein `.side-panel` mehr. Fehlt beim Schließen eines Modals der Auslöser, geht der Fokus auf die Überschrift der Ansicht (`data-view-heading` der `SectionBar`).
  - **Vollansicht:** XL-Modal mit Adresse `/tickets/<id>/voll`, zweispaltig (links Titel, Beschreibung, Kommentare und Verlauf; rechts 340 px mit Karten), über dem Panel; Schließen führt zurück ins Panel mit Fokus auf „Vollansicht öffnen“. `tickets/[id]/+layout.svelte` lädt das Ticket für Panel und Vollansicht und hält die Verwerfen-Frage (samt `discarding`); Panel und Vollansicht setzen dieselben Teile zusammen (`TicketFields`, `TicketDescription`, `TicketMeta`, `TicketDelete`).
  - **Flags:** unten links, neuestes oben, höchstens drei; Erfolg und Info 8 s mit Pause bei Hover, Fokus, verborgenem Tab und offenem Modal, Fehler bleiben. Höchstens eine Aktion (etwa „Rückgängig“). Der Fokus springt nie. Feld-, Formular- und Ladefehler bleiben inline. Store `stores/flags.svelte.ts` per Kontext im `(app)`-Layout; Stores bekommen ihn als `FlagSink` (ohne ihn `SILENT_FLAGS`), Ansichten ohne eigenen Store als Prop.
  - **„Rückgängig“ (seit UI-5):** Erledigen per Häkchen und Verwerfen im Eingang nehmen die Zeile sofort heraus; das Flag bietet „Rückgängig“ 8 s lang (Undo-Fenster = Laufzeit des Flags, pausiert wie oben). Danach geht es nur noch über den normalen Weg (Status ändern, „Wiederherstellen“). Fehler von Zeilenaktionen erscheinen als Fehler-Flag.
  - **Escape-Kette:** Popover → Bestätigung → Modal → Vollansicht → Feld im Bearbeitungsmodus → Seitenpanel. Wer Esc verbraucht, ruft `preventDefault()` und `stopPropagation()` auf.
  - **Kopfordnung:** Die Abschnittsleiste mit „Aufgaben | Projekte | Eingang“ steht in allen Ansichten direkt unter der Kopfzeile (ab UI-8); Projekte öffnen ein Projekt-Panel `/projekte/<id>` statt eines Dialogs.
  - Bis ein Paket gemergt ist, gilt in seinem Bereich das bisherige Verhalten (etwa die Projekte als Dialog bis UI-8).
- Schnellerfassung per `c` und `Strg+K` (nicht in Eingabefeldern, Dialogen und offenen Popovers); Kurzsyntax `Titel @CODE !hoch #tag` (`!niedrig|mittel|hoch|dringend` bzw. `!1`–`!4`, `!1` = niedrig); unbekannte Tokens bleiben Teil des Titels. Enter legt ein Ticket an, `Alt+Enter` einen Eingangseintrag.
- Eingang `/eingang` mit Panel `/eingang/<id>`, Erfassung nach Vorlagen `/eingang/neu` (auch Ziel des Bookmarklets; gespeichert wird erst nach Klick), Chips „Quelle“ und „Zustand“, „Umwandeln“ über das vorbefüllte Panel `/tickets/neu?aus=<id>`, „Gesammelt umwandeln“, „Verwerfen“ mit „Rückgängig“ (8 s im Flag unten links), „Wiederherstellen“, „Dem Ticket zuordnen“. Dateien (`.eml`, `.ics`, WhatsApp-Export) per Drag & Drop oder „Datei wählen“ öffnen eine Auswahlansicht; Stichwort-Treffer sind vorausgewählt, Vorhandenes ist gesperrt. „Aus Zwischenablage“ bzw. `Strg+V` in der Eingangsansicht öffnet einen Dialog mit „Jede Zeile als eigener Eintrag“.
- Seite „Kanäle“ `/einstellungen/kanaele`: Bookmarklet, Verbindungen (Status der Variablen, letzter Lauf, bereinigter Fehler, Hinweis, „Jetzt abrufen“, bei Postfächern „Aus dem Postfach wählen“), Stichwörter je Verbindung und je Art der Datei-Importe, Einrichtungsanleitungen je Dienst. Hinweise wie „Keine Stichwörter“ oder „Hilfsprozess läuft nicht“ sind neutral, nicht rot.
- Inhalte aus Kanälen sind nicht vertrauenswürdig: Anzeige nur über `Markdown.svelte`, Links nur `http:`/`https:`/`mailto:`, Bilder aus Mails werden nie geladen.
- Realtime: Subscriptions aktualisieren gezielt einzelne Datensätze; kein Polling, kein komplettes Neuladen.
- Bereichs-Umschalter: „Privat" aktiv, „Haushalt" ausgegraut, nicht klickbar, Hinweis „Demnächst" (`aria-disabled`).
- Markdown-Ausgabe wird sanitisiert.

## 8. Design-System

Alle Farben als CSS-Custom-Properties zentral in `web/src/lib/styles/tokens.css`. Minimalistisch, feine Linien, wenig Farbe; Petrol ist die einzige Akzentfarbe. Keine Farbwerte außerhalb von `tokens.css`.

- **Hell/Dunkel ([ADR-0025](docs/adr/0025-ui-konsistenz-overlay-system.md) §10):** Standard ist die Systemeinstellung. Der Umschalter in der Kopfzeile (Menü „Hell“, „Dunkel“, „Wie System“) speichert die Wahl in `localStorage` unter `byl-theme` (`light` oder `dark`; „Wie System“ entfernt den Schlüssel), nur lokal, nicht pro Nutzer bis E7. Das Inline-Skript in `app.html` setzt `data-theme` vor dem ersten Rendern (FOUC-Schutz), prüft den Wert, fängt Fehler des Speichers ab und übernimmt einmalig den alten Schlüssel `td-theme`. Jeder der vier Blöcke von `tokens.css` setzt `color-scheme`, damit native Controls dem Modus folgen.
- **Overlay-Tokens (ADR-0025 §2):** `--color-blanket` (einzige neue Farbe, dunkler Schleier hinter Modals, in allen vier Blöcken). Nicht farbig und nur in `:root`: `--overlay-width-s|m|l|xl` (25/37.5/50/62.5rem), `--overlay-max-height` und `--overlay-max-height-xl`, `--drawer-width` (30rem), `--full-view-sidebar` (21.25rem), `--radius-control` (0.375rem), `--radius-surface` (0.5rem), `--motion-fast` (120ms), `--motion-medium` (200ms), `--motion-ease`. Neue Radien und Maße nur über diese Tokens. Tests der Overlays nutzen die gemeinsamen Stubs aus `web/src/lib/test/overlay-stubs.ts` statt eigener `showModal`-Attrappen.
- **Keine Schatten, kein Schatten-Token, keine Glas-Optik:** Overlays trennen sich über `--color-line` und `--color-surface`. Destruktive Knöpfe sind nicht rot. Animationen nur über die Motion-Tokens; bei `prefers-reduced-motion: reduce` erscheinen Overlays ohne Bewegung.
- **Gemeinsame Knopfklassen** in `base.css`: `.button-primary`, `.button-secondary`, `.button-subtle`, `.button-icon` (immer mit `aria-label`); keine lokalen Kopien in Komponenten.

| Token | Hell | Dunkel |
|---|---|---|
| Hintergrund | #F5F8F8 | #0E1517 |
| Fläche | #FFFFFF | #152023 |
| Linien | #DDE5E6 | #26353A |
| Text | #172326 | #E3ECEE |
| Text gedämpft | #5B6B6F | #8DA1A6 |
| Marke (Buttons, Icons, Fokus, Rahmen) | #07838F | #07838F |
| Marke als kleiner Text | #07838F | #4BB8C2 |
| Marke Fläche / Text darauf | #DDF0F2 / #055C65 | #123A3F / #9FDCE2 |
| Fehler (`--color-danger`) / Fehlerfläche (`--color-danger-soft-bg`) | #A13A40 / #F8E9E9 | #EAA0A0 / #3B1E21 |

- Weißer Text auf #07838F ist in beiden Modi zulässig.
- #07838F nie als kleiner Text im Dunkelmodus – dort #4BB8C2.
- Rot nur für echte Fehler: fehlgeschlagene Anfragen, abgelehnte Eingaben, Feldfehler (`aria-invalid="true"` plus Fehlertext per `aria-describedby`), Login-Fehlermeldung. Nicht rot: Überfälligkeit, hohe oder dringende Priorität, „Endgültig löschen“, Warnhinweise. Fehler tragen immer Icon und Text. Klassen `.alert-error` und `[aria-invalid='true']` in `base.css` ([ADR-0009](docs/adr/0009-fehlerfarbe.md)).

Status-Pillen („Ton in Ton"):

| Status | Darstellung Hell | Darstellung Dunkel |
|---|---|---|
| Backlog | nur Umriss (Linienfarbe), Text gedämpft | dito |
| Offen | Umriss Markenfarbe, Text #07838F | Umriss Markenfarbe, Text #4BB8C2 |
| In Arbeit | Fläche #DDF0F2, Text #055C65 | Fläche #123A3F, Text #9FDCE2 |
| Wartet | Fläche #FBF0DC, Text #7A4E08 | Fläche #3A2C12, Text #F2C77A |
| Erledigt | Häkchen-Icon, Fläche #ECEFF0, Text #4A585E | Häkchen-Icon, Fläche #223036, Text #B3C2C6 |

Erledigte Tickets treten in der Liste optisch zurück. Schriften: Inter für die Oberfläche, JetBrains Mono für Ticket-Keys.

## 9. Betrieb unter Windows

- `start.bat`: startet PocketBase ohne sichtbares Konsolenfenster (kein Doppelstart), wartet auf `/api/health`, öffnet den Standardbrowser auf `http://127.0.0.1:8090`. Alle Pfade relativ (`%~dp0`).
- `autostart-an.bat` / `autostart-aus.bat`: Verknüpfung im Windows-Autostart-Ordner anlegen bzw. entfernen.
- `byl-mail.exe`: `start.bat` startet ihn nach PocketBase, wenn die Datei da ist, `BYL_INGEST_TOKEN` gesetzt ist (legt `start.bat` beim ersten Mal an) und PocketBase eine eingeschaltete Mail-Verbindung meldet; `stop.bat` beendet ihn gezielt (Pfad plus Kommandozeile `run --url=http://127.0.0.1:8090`, wie bei `pocketbase.exe`). Protokoll in `app/logs/byl-mail.log`.
- Backups über die eingebaute PocketBase-Backup-Funktion (Anleitung in der README).
- Nach Kopie von `app/` auf einen anderen Windows-Rechner lauffähig ohne weitere Schritte.

## 10. Scope

- **MVP:** alles oben Beschriebene außer Stufe 2.
- **Stufe 2 (nur auf ausdrückliche Anweisung; Datenmodell bereits vorbereitet):** Sub-Tickets inkl. Fortschritt und Schalter „blockiert Eltern-Ticket", Abhängigkeiten mit Entsperr-Automation, Board-Ansicht, Browser-Benachrichtigungen bei offenem Tab, Anhänge.
- **Haushalts-UI:** Etappe E7 zusammen mit Mehrgeräten, Start nach ausdrücklicher Freigabe; bis dahin nur der ausgegraute Umschalter.
- **Nicht umsetzen:** Epics, Sprints, Story Points, Ticket-Typen ([ADR-0012](docs/adr/0012-plain-ticketing.md)), konfigurierbare Workflows, generischer Regel-Editor, Zeiterfassung, Cloud-Hosting, Offline-Modus.
- **Kanäle:** Lokale Eingangskanäle ohne fremden Dienst (Schnellerfassung, Zwischenablage, Bookmarklet, `.ics`, `.eml`, WhatsApp-Export) ab E4. Externe Dienste nur mit eigener ADR und Freigabe ([ADR-0011](docs/adr/0011-roadmap-e3-bis-e7.md) §2): freigegeben sind Google Calendar, Telegram sowie Web.de und Gmail per `byl-mail.exe` ([ADR-0016](docs/adr/0016-kanal-architektur-und-mail.md)); Notion ist zurückgestellt.
- Keine Features außerhalb des Scopes, keine spekulativen Abstraktionen. Abweichungen vorher begründen und beim Nutzer anfragen.

## 11. Regeln für Agenten und Automatisierung auf dem Entwicklungsrechner

1. **Python-Verbot:** `python`, `python3` oder `py` aufrufen ist untersagt (öffnet auf Windows den Microsoft Store). JSON wird stattdessen mit `node -e` oder PowerShell `ConvertFrom-Json` geparst. Andere Skriptaufgaben nutzen node.js oder PowerShell.

2. **PocketBase-Sicherheit:** PocketBase darf nicht mit `serve` in einem Datenordner ohne Superuser gestartet werden (sonst öffnet sich der Browser mit dem Installer). Tests und Spikes, die einen laufenden Server brauchen, erstellen vorab einen Wegwerf-Superuser in einem Wegwerf-Datenordner:
   ```powershell
   $tempDir = Join-Path $env:TEMP ("td-spike-" + [guid]::NewGuid().ToString('N'))
   $email   = "spike-$([guid]::NewGuid().ToString('N'))@example.com"
   $bytes   = New-Object byte[] 24
   $rng     = [System.Security.Cryptography.RandomNumberGenerator]::Create()
   $rng.GetBytes($bytes); $rng.Dispose()
   $pass    = [Convert]::ToBase64String($bytes)
   $server  = $null
   try {
       New-Item -ItemType Directory -Path $tempDir | Out-Null
       & ./app/pocketbase.exe superuser upsert --dir="$tempDir" $email $pass
       if ($LASTEXITCODE -ne 0) { throw "superuser upsert failed ($LASTEXITCODE)" }
       $server = Start-Process -FilePath ./app/pocketbase.exe -PassThru -NoNewWindow `
           -ArgumentList 'serve', "--dir=$tempDir", '--http=127.0.0.1:8099'
       # Tests gegen http://127.0.0.1:8099 ausführen (Login mit $email / $pass)
   }
   finally {
       if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
       if ($server) { $server.WaitForExit() }
       Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tempDir
   }
   ```
   Zugangsdaten werden zur Laufzeit erzeugt und niemals ins Repo geschrieben.

3. **Keine Autostart-Skripte und Hintergrundprozesse:** Nie `start.bat`, `start-hidden.vbs` oder Autostart-Skripte ausführen; keinen Dev-Server oder Browser-Fenster öffnen. Jeder gestartete PocketBase-Server oder andere Hintergrundprozess wird vor Ende der Aufgabe beendet (try/finally oder afterAll); der Temp-Datenordner wird gelöscht.

4. **Nur eine Claude-Session pro Repo:** Nicht mehrere schreibende Agenten in `main` parallel ausführen. Konflikte abfangen und eskalieren.

5. **Texte nie über die Shell schreiben:** Eine Shell führt Befehle in Backticks bzw. `$(…)` innerhalb von Heredocs und doppelt gequoteten Zeichenketten aus. So hat ein Agent beim Schreiben einer Markdown-Datei versehentlich Beispielbefehle gestartet.
   - Markdown- und Textdateien (Doku, Pläne, ADRs, PR-Texte, Commit-Nachrichten) werden ausschließlich mit den Datei-Werkzeugen (Write/Edit) geschrieben, nie per Shell-Heredoc, `echo`, `printf` oder Umleitung. PR-Texte und Commit-Nachrichten entstehen als Datei im Scratchpad und gehen per `gh pr create --body-file` bzw. `git commit -F` an Git.
   - Beispielbefehle mit `setx`, `stop.bat`, `start.bat` oder anderen Start- und Stopp-Skripten stehen nie in einer Shell-Befehlszeile, auch nicht als Text in Anführungszeichen. Sie gehören nur in Dateien, die mit Write/Edit entstehen.

## 12. Arbeitsweise

- Etappen ([ADR-0011](docs/adr/0011-roadmap-e3-bis-e7.md)): E0 Gerüst · E1 Datenmodell/Hooks/Auth · E2 Liste/Detail/CRUD/Kommentare/Realtime · E3 Übersicht & Ordnung · E4 Eingang & Kanäle · E5 Wiederkehrende Aufgaben · E6 Feinschliff · E7 Haushalt & Mehrgeräte. Pläne je Etappe unter `docs/plan/`.
- Nach jeder Etappe: Zusammenfassung, Testanleitung, Entscheidungen/offene Punkte – dann auf Freigabe warten.
- Privates GitHub-Repo `Labushuya/becauseyoulovejira`. Jede Änderung läuft über einen kurzlebigen Branch (`feat/…`, `fix/…`, `chore/…`) und einen Pull Request in `main`; gemergt wird nur bei grüner CI, per Squash-Merge mit einem Titel nach Conventional Commits. Gepusht wird nur der Branch des PR, nie direkt auf `main`.
- Commits im Branch: ein Commit pro abgeschlossenem Arbeitsschritt, Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `ci:`). Keine Force-Pushes, keine Änderung der Historie.
- Kein toter oder auskommentierter Code, keine TODOs ohne verlinktes Issue.
- Qualitäts-Gates vor jedem Commit mit Code: `npm run check`, `npm run lint`, `npm test` grün; vor jedem PR läuft `scripts\build.ps1` lokal komplett grün. Die PR-Beschreibung folgt `.github/pull_request_template.md` mit ausgefüllter Checkliste.
- Jedes Arbeitspaket aktualisiert `docs/test-manifest.html` (neue bzw. geänderte Testfälle, Status, Stand); der Konsistenztest `tests/unit/test-manifest.test.mjs` muss grün sein.
- Niemals Secrets, `pb_data/` oder Backups committen, auch nicht im privaten Repo.
