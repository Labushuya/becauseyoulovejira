# CLAUDE.md – becauseyoulovejira

Verbindliche Projektregeln. Gilt für jede Änderung in diesem Repo. Bei jeder relevanten Entscheidung aktualisieren.

## 1. Zweck

Privates, lokal laufendes Ticket-Dashboard (Linear-/Jira-artiges Ticket-Handling ohne Prozesslast) für Windows 10, genutzt im Desktop-Browser (Chrome, Firefox, Opera GX). Die komplette Installation ist ein einzelner Ordner (`app/`): Start per Doppelklick, Sicherung und Umzug per Ordnerkopie.

## 2. Repo-Struktur

```
becauseyoulovejira/
  app/                 portabler Laufzeitordner (wird kopiert/gesichert)
    pocketbase.exe     gitignored, via scripts/fetch-pocketbase.ps1 (SHA256-geprüft)
    pb_hooks/          *.pb.js Hooks, lib/*.js reine CommonJS-Module
    pb_migrations/     handgeschriebene JS-Migrationen
    pb_public/         Frontend-Build (gitignored)
    pb_data/           Daten (gitignored, niemals committen)
    start.bat, start-hidden.vbs, autostart-an.bat, autostart-aus.bat
  web/                 SvelteKit-Quellcode, Build nach ../app/pb_public
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
- **Tests:** Vitest; Hook-Integrationstests per Skript gegen eine Wegwerf-Instanz (temporäres `--dir`).
- **Node.js:** nur Dev-Werkzeug (Build/Test), portabel unter `H:\DEV\tools\node`. Für den Betrieb nicht nötig.

### PocketBase-API-Disziplin

Die APIs (Hooks, Migrationen, SDK) haben sich zwischen Versionen stark geändert. Vor jedem Hook-/Migrationscode die Doku der gepinnten Version prüfen (pocketbase.io/docs, JSVM-Referenz pocketbase.io/jsvm) – nicht aus Erinnerung schreiben.
- Hook-Handler müssen `e.next()` aufrufen.
- Create und Update über die Record-API laufen in v0.40.4 **nicht** automatisch in einer Transaktion (nur Delete mit Kaskaden). Hooks, die mehrere Schreibvorgänge atomar brauchen, öffnen sie selbst: `e.app.runInTransaction((txApp) => { e.app = txApp; … e.next(); })` ([E1-Plan](docs/plan/e1.md) §2, OF-1).
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

Alle fachlichen Datensätze tragen `owner` (Pflicht, Relation `users`) und `household` (optional, vorerst leer). Ausnahme: `comments` und `ticket_history` haben kein `owner`/`household`; ihre Sichtbarkeit folgt dem Ticket (OF-5 im [E1-Plan](docs/plan/e1.md)).

| Collection | Wesentliche Felder |
|---|---|
| `users` | Auth-Collection; Selbstregistrierung gesperrt |
| `households` | name |
| `household_members` | user, household, role |
| `projects` | name, code (2–6 Großbuchstaben, eindeutig pro Scope), archived, scope |
| `tags` | name (eindeutig pro Scope, ohne Groß-/Kleinschreibung), scope |
| `tickets` | number, key, title, description (Markdown), status, priority, due (Datum), project?, tags[], completed_at, parent?, blocks_parent (bool, Standard true), recurrence?, scope |
| `comments` | ticket, author, body (Markdown); kein owner, Sichtbarkeit über das Ticket |
| `ticket_history` | ticket, field, old_value, new_value, user, created; kein owner, Sichtbarkeit über das Ticket |
| `dependencies` | blocker → blocked (Stufe 2; Zyklen im Hook verhindert) |
| `recurrence_rules` | Vorlage (title, description, project, tags, priority), mode `calendar` \| `after_completion`, Regelparameter, next_due, last_generated_at, active |
| `ticket_counters` | intern (alle API-Regeln `null`): key, value |

- **Status (Enum):** `backlog`, `open`, `in_progress`, `waiting`, `done`. Interne Kategorie: backlog/open → *offen*, in_progress/waiting → *aktiv*, done → *abgeschlossen*. Zuordnung zentral in `app/pb_hooks/lib/status.js`, gespiegelt in `web/src/lib/domain/status.ts`.
- **Priorität (Enum):** `low`, `medium`, `high`, `urgent`.
- **completed_at:** vom Hook gesetzt bei Wechsel nach `done`, geleert beim Verlassen von `done`.
- **Fälligkeit:** reines Kalenderdatum, gespeichert als `YYYY-MM-DD 00:00:00.000Z`. Maßgebliche Zeitzone für „heute": `Europe/Berlin`, serverseitig berechnet durch das reine Modul `app/pb_hooks/lib/berlin-time.js` (ab E4, EU-Sommerzeitregel), nicht über Zeitzonen-APIs der Laufzeit ([ADR-0005](docs/adr/0005-zeitzone-europe-berlin.md)).
- **Historie:** `onRecordUpdate` vergleicht `e.record.original()` feldweise (Whitelist fachlicher Felder) und schreibt in derselben, vom Hook geöffneten Transaktion wie die Änderung nach `ticket_history`; die Anlage wird ebenfalls protokolliert.
- **Parent (Stufe 2, nur Guard):** maximal eine Ebene, im Hook erzwungen.

### Scopes und Nummernkreise

- Jeder Datensatz gehört genau einem Scope: privat `u:<ownerId>` (household leer) oder Haushalt `h:<householdId>`. Der Hook setzt das Feld `scope` auf `projects`, `tags` und `tickets`.
- Key: `<CODE>-<NR>` mit Projekt, sonst `TASK-<NR>`. Nummernkreise je Scope + Projekt bzw. Scope + TASK (Zählerschlüssel `<scope>:<projectId|TASK>`).
- Vergabe im `onRecordCreate`-Hook innerhalb einer vom Hook geöffneten Transaktion (siehe §3): UPSERT `INSERT … ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value` auf `ticket_counters` (legt fehlende Zähler an, Schreib-Lock sofort, robust gegen gleichzeitige Anlage; OF-1). Eindeutige Indizes `tickets(scope, key)`, `projects(scope, code)` und `tags(scope, name COLLATE NOCASE)` als Sicherheitsnetz.
- Wechsel von Projekt oder Scope ⇒ neuer Key im Ziel-Nummernkreis; alter Key bleibt in der Historie. URLs referenzieren Tickets per Record-ID, nie per Key.

### API-Regeln

Umsetzung in `app/pb_migrations/1790200900_api_rules.js`, Details und Befunde im [E1-Plan](docs/plan/e1.md) (Paket 4, OF-2, OF-3, OF-5). Alle Regeln ungleich `null` greifen nur für angemeldete Nutzer (fachliche Collections prüfen ausdrücklich `@request.auth.id != ""`).

- `projects`, `tags`, `recurrence_rules`, `tickets`:
  - list/view/update/delete: `owner = @request.auth.id || (household != "" && @collection.household_members.household ?= household && @collection.household_members.user ?= @request.auth.id)`
  - create: `@request.body.owner = @request.auth.id` und ein gesetzter `household` nur mit eigener Mitgliedschaft.
  - update zusätzlich: `@request.body.owner:changed = false`, neuer `household` nur mit eigener Mitgliedschaft (eigener Join-Alias `:target`).
- `comments`: Sichtbarkeit wie das Ticket (`ticket.owner`/`ticket.household`); create nur mit `author = @request.auth.id`; update/delete nur durch den Autor, `author` und `ticket` unveränderlich.
- `ticket_history`: list/view wie das Ticket, Schreiben `null` (nur der Hook).
- `dependencies`: list/view wie oben, Schreiben `null` bis Stufe 2.
- `households`: list/view nur für Mitglieder; `household_members`: list/view nur eigene Zeilen; Schreiben jeweils `null` bis zur Haushaltsstufe.
- `users`: list/view/update nur der eigene Datensatz, create/delete `null`. `ticket_counters`: alle Regeln `null`.
- Bedingungen auf denselben `@collection`-Alias gelten für dieselbe Zeile. Join-Semantik und Realtime-Verhalten sind per Negativtests mit mehreren Nutzern und Haushalten belegt (`tests/integration/rules.test.mjs`, `realtime-rules.test.mjs`).

## 6. Wiederkehrende Aufgaben (Kernfunktion)

- Prinzip Vorlage/Instanz: Eine Regel erzeugt Tickets. **Pro Regel maximal eine offene Instanz** (Status ≠ done); Erzeugung ist idempotent.
- `calendar`: selbst implementierte RRULE-Teilmenge – täglich, wöchentlich (mit Wochentagen), monatlich (Tag des Monats oder letzter Tag), jährlich, jeweils mit Intervall.
- `after_completion`: nächste Fälligkeit = Erledigungsdatum + Intervall.
- Auslöser: Erledigen der aktuellen Instanz (Hook), Cron-Hook für Kalenderregeln, Catch-up beim Serverstart. Verpasste Termine ⇒ genau **eine** Instanz mit dem jüngsten fälligen Termin, keine Stapel.
- Berechnung in `app/pb_hooks/lib/recurrence.js`: rein, seiteneffektfrei, CommonJS, ES5, ohne Abhängigkeiten; rechnet nur mit Kalenderdaten, „heute" wird als Parameter übergeben. Vitest-Pflichtfälle: Monatsenden, Schaltjahre, Sommerzeit, lange Ausfallzeiten.

## 7. Frontend & UX

- UI-Sprache Deutsch. Desktop zuerst, auf schmalen Bildschirmen benutzbar.
- „Alle Tickets": dichte Zeilenliste (Key, Titel mit Tags, Status-Pille, Prioritäts-Icon, Projekt, Fälligkeit; Icons für wiederkehrend und blockiert).
- Filter (Status, Projekt, Tag, Priorität, Fälligkeit), Sortierung, Suche (PocketBase-Filter auf Titel und Beschreibung); Filterzustand in der URL.
- Projektansicht mit Projektauswahl; Ticket-Detail als Seitenpanel mit Inline-Bearbeitung, Kommentaren, Historie.
- Schnellerfassung per `c` und `Strg+K`; Kurzsyntax `Titel @CODE !hoch` (`!niedrig|mittel|hoch|dringend` bzw. `!1`–`!4`); unbekannte Tokens bleiben Teil des Titels.
- Realtime: Subscriptions aktualisieren gezielt einzelne Datensätze; kein Polling, kein komplettes Neuladen.
- Bereichs-Umschalter: „Privat" aktiv, „Haushalt" ausgegraut, nicht klickbar, Hinweis „Demnächst" (`aria-disabled`).
- Markdown-Ausgabe wird sanitisiert.

## 8. Design-System

Alle Farben als CSS-Custom-Properties zentral in `web/src/lib/styles/tokens.css`. Hell/Dunkel umschaltbar: Standard Systemeinstellung, manuelle Wahl in localStorage (FOUC-Schutz per Inline-Script in `app.html`). Minimalistisch, feine Linien, wenig Farbe; Petrol ist die einzige Akzentfarbe. Keine Farbwerte außerhalb von `tokens.css`.

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

- Weißer Text auf #07838F ist in beiden Modi zulässig.
- #07838F nie als kleiner Text im Dunkelmodus – dort #4BB8C2.

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
- Backups über die eingebaute PocketBase-Backup-Funktion (Anleitung in der README).
- Nach Kopie von `app/` auf einen anderen Windows-Rechner lauffähig ohne weitere Schritte.

## 10. Scope

- **MVP:** alles oben Beschriebene außer Stufe 2.
- **Stufe 2 (nur auf ausdrückliche Anweisung; Datenmodell bereits vorbereitet):** Sub-Tickets inkl. Fortschritt und Schalter „blockiert Eltern-Ticket", Abhängigkeiten mit Entsperr-Automation, Board-Ansicht, Browser-Benachrichtigungen bei offenem Tab, Anhänge.
- **Haushalts-UI:** eigene spätere Stufe nach ausdrücklicher Freigabe; im MVP nur der ausgegraute Umschalter.
- **Nicht umsetzen:** Epics, Sprints, konfigurierbare Workflows, generischer Regel-Editor, Zeiterfassung, Cloud-Hosting, Offline-Modus, externe Integrationen.
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

## 12. Arbeitsweise

- Etappen: E0 Gerüst · E1 Datenmodell/Hooks/Auth · E2 Liste/Detail/CRUD/Kommentare/Realtime · E3 Projekte/Tags/Filter/Suche · E4 Wiederkehrende Aufgaben · E5 Schnellerfassung/Theme/Feinschliff/Doku.
- Nach jeder Etappe: Zusammenfassung, Testanleitung, Entscheidungen/offene Punkte – dann auf Freigabe warten.
- Ein Commit pro abgeschlossenem Arbeitsschritt, Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`), direkt auf `main`. Push nach jeder Etappe in das öffentliche Repo `Labushuya/becauseyoulovejira`.
- Kein toter oder auskommentierter Code, keine TODOs ohne verlinktes Issue.
- Qualitäts-Gates vor jedem Commit mit Code: `npm run check`, `npm run lint`, `npm test` grün.
- Niemals Secrets, `pb_data/` oder Backups committen (öffentliches Repo).
