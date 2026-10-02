# Plan Robuste Skripte und Wartung: Fehlerkatalog, Abhängigkeiten, Tests unter Last, Test-Instanzen

- **Stand:** umgesetzt: RS-2 (#216, Build und Abhängigkeiten), RS-3 (#219, Tests unter Last), RS-1 (Fehlerkatalog der Skripte, [ADR-0048](../adr/0048-fehlerkatalog-der-skripte.md)). RS-4 (System-Seite und Manifest-Pflege) folgt als eigener PR.
- **Grundlage:**
  - [ADR-0039](../adr/0039-betriebsskripte.md) (Steuerskript, Exit-Codes), [ADR-0040](../adr/0040-veroeffentlichen-ohne-unterbrechung.md) (Build, Nachtrag „Build und Abhängigkeiten“), [ADR-0043](../adr/0043-system-seite.md) (Seite „System“, andere Kopien), [ADR-0046](../adr/0046-sicherung-pruefung-wiederherstellen.md) (Sicherung), [ADR-0035](../adr/0035-start-einstieg-und-offene-tabs.md) (Start, Hinweise beim Öffnen)
  - [Plan Betriebsskripte](betriebsskripte.md), [Plan Sicherung](sicherung.md), [Plan Test-Härtung](test-haertung.md)
  - [CLAUDE.md](../../CLAUDE.md) §3, §9, §11, §12
- **Einordnung:** Nutzerwunsch vom 2026-10-01: „Außerdem müssen alle Skripte so gestaltet sein, dass sie Probleme abfangen und klar mit dem User kommunizieren was zu tun ist (ggf. auch anleiten mit CMDs zum Kopieren und dergleichen).“ Dazu Wartungspunkte des Advisors (Lockfiles, Warnung von npm zu esbuild, `npm audit`, Tests unter Last, Test-Instanzen auf der Seite „System“, Manifest). Manifest-IDs ab `BYL-E6-975` bis höchstens `BYL-E6-999`, Paketkürzel `RS`.

## 1. Querschnittsregeln

- **Skripte nur gegen Wegwerf-Kopien:** `byl-control.ps1` läuft in Tests und bei Agenten nur in Kopien der Laufzeitteile unter `.tmp\byl-*` des Worktrees (Superuser vorher, Zufallsport, bereinigte Umgebung, `BYL_TEST_ISOLATED=1`), nie gegen `app\` eines Klons oder Port 8090 (CLAUDE.md §11.3). Build-Skripte laufen nur im Worktree.
- **Dateien:** `.bat`, `.vbs` und `byl-functions.ps1` ASCII, `byl-control.ps1` UTF-8 mit BOM, alle Skripte mit CRLF (`.gitattributes`).
- **Gates je Paket:** eigener Branch und PR, `scripts\build.ps1` lokal grün, beide Pflicht-Checks, Squash-Merge; Test-Manifest und Doku im selben PR.

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| RS-2 | `build.ps1` installiert neu, wenn sich ein Lockfile geändert hat (Prüfsumme je Ordner in `node_modules`), die Hilfsprogramm-Builds ebenso; Install-Skript von esbuild über `allowScripts` freigegeben; `npm audit` und Dependabot geprüft. Nachtrag ADR-0040 | BYL-E6-975 bis BYL-E6-977 |
| RS-3 | Tests robust gegen Last: Logs von PocketBase erst nach dem Schreiben lesen (`tests/support/logs.mjs`), zentrale, gemessene und skalierbare Zeitgrenzen (`tests/support/timing.mjs`), die Dateien mit Prozessen zuletzt und höchstens zu viert, Bereitschaft abfragen statt fester Pause; Nebenbefund CRLF im Text eines Eingangseintrags | BYL-E6-978 bis BYL-E6-982 |
| RS-1 | Fehlerkatalog aller Skripte (`app\byl-problems.ps1`, 112 Einträge): einheitliches Format mit Ursache, Schritten und Befehl mit echten Pfaden, Angebot zum Selbstlösen, offenes Fenster bei Fehlern (`byl-pruefen.bat`), Fehler im Hintergrund gemerkt und gezeigt (nächster Lauf, Seite „System“), `-Json` mit `code` und `remedy`, Hilfe „Betrieb“ als FAQ. [ADR-0048](../adr/0048-fehlerkatalog-der-skripte.md), Nachträge ADR-0039, ADR-0040, ADR-0043 | BYL-E6-983 bis BYL-E6-992 |
| RS-4 | Seite „System“ und `status`: Test-Instanzen aus Entwicklung und Tests eingeklappt; Test-Manifest: Paket für den Prüfmodus (#204), Text von BYL-X-004, `meta.commit`. Nachtrag ADR-0043 | folgt |

## 3. RS-2: Build und Abhängigkeiten

### Lockfiles

- **Befund:** `scripts\build.ps1` (und die Builds der Hilfsprogramme) riefen `npm ci` nur, wenn `node_modules` fehlte. Nach einem Update einer Abhängigkeit (Dependabot, Merge von `main`) prüfte, baute und testete der Build also mit den Versionen des alten Lockfiles; im Live-Ordner baute er so ein Frontend aus alten Paketen.
- **Umsetzung:** `scripts\build-functions.ps1` merkt sich nach jedem erfolgreichen `npm ci` den SHA-256 des `package-lock.json` in `node_modules\.byl-lockfile.sha256`. Jeder Build vergleicht für alle fünf Ordner mit eigenem Lockfile (Root, `web`, `helpers/mail`, `helpers/backup`, `extensions/whatsapp-web`) und ruft `npm ci`, wenn `node_modules` fehlt, die Prüfsumme fehlt (älterer Build oder von Hand installiert) oder abweicht; sonst „up to date“. `npm ci` löscht `node_modules` zuerst, ein gescheitertes Installieren hinterlässt also nie eine Prüfsumme. `build-mail-helper.ps1` und `build-backup-helper.ps1` nutzen dieselbe Funktion, auch wenn sie allein laufen.
- **Folge:** Der erste Build nach diesem Paket installiert alle fünf Ordner einmal neu (keine Prüfsumme vorhanden).

### Install-Skripte (npm 11, `allowScripts`)

- **Befund:** npm 11.19 meldete bei `npm ci` in `helpers/mail`, `helpers/backup` und `extensions/whatsapp-web` „1 package has install scripts not yet covered by allowScripts: esbuild@0.28.2 (postinstall: node install.js)“. `npm approve-scripts --allow-scripts-pending` (nur lesend) fand in allen fünf Ordnern nur dieses eine; Root und `web` haben keine Abhängigkeit mit Install-Skript.
- **Stand von npm (Doku und Quelltext von 11.19):** Das Feld `allowScripts` im `package.json` des Projekts ist heute nur ein Hinweis; nicht geprüfte Skripte laufen noch, nur ausdrücklich abgelehnte (`false`) werden übersprungen. Eine künftige Version blockiert nicht geprüfte Skripte. Erlaubt sind Name allein oder exakte Versionen, keine Bereiche.
- **Entscheidung:** `"allowScripts": { "esbuild": true }` in den drei Ordnern, nach Name. Das Skript von esbuild prüft und verknüpft nur das Programm aus dem plattformspezifischen Paket (`@esbuild/win32-x64` bzw. `linux-x64`); der Code von esbuild läuft bei jedem Build ohnehin, die Freigabe des Install-Skripts erweitert das Vertrauen also nicht. Eine Freigabe je Version (Vorgabe von `npm approve-scripts`) ginge mit jedem Update von esbuild durch Dependabot verloren, und mit dem künftigen Blockieren liefe das Skript dann still nicht mehr. Ablehnen (`false`) hätte heute das Verhalten geändert. Ein Test hält fest: Wo esbuild Abhängigkeit ist, steht genau diese Freigabe, sonst keine.

### `npm audit` und Dependabot

- **Befund:** `npm audit` in `web` meldet drei Schwachstellen mit niedriger Schwere, alle dieselbe: `cookie` < 0.7.0 ([GHSA-pxg6-pf52-xh8x](https://github.com/advisories/GHSA-pxg6-pf52-xh8x), Name, Pfad und Domain eines Cookies mit Zeichen außerhalb der erlaubten Bereiche), über `@sveltejs/kit` 2.70.3 (hängt von `cookie` `^0.6.0` ab) und `@sveltejs/adapter-static`. Die offene Dependabot-Warnung #1 auf `main` (low, `web/package-lock.json`) ist dieselbe.
- **Kein Fix innerhalb von SemVer:** 2.70.3 ist die neueste Version von SvelteKit 2, alle hängen von `cookie` `^0.6.0` ab; `npm audit fix` schlägt nur `--force` mit SvelteKit 3.0.0 vor (Major, Breaking Change, Freigabe nötig). Ein `overrides` auf `cookie` 0.7 läge außerhalb des Bereichs, den SvelteKit 2 angibt, und wurde verworfen.
- **Ausnutzbarkeit im Projekt: keine.** `cookie` gehört zur Server-Laufzeit von SvelteKit (`cookies.set` in Server-Hooks und Endpunkten). Die App ist eine statische SPA (`adapter-static`, `ssr = false`), ausgeliefert von PocketBase; im Build steckt kein Server von SvelteKit (es gibt nur `hooks.client.ts`, keine Server-Hooks oder Endpunkte), und Cookies setzt die App nicht (das Token geht im Kopf `Authorization`, ADR-0043 §4). Nur der Dev-Server nutzt den Code, und auch der übergibt keine Eingaben als Namen, Pfad oder Domain eines Cookies. Erledigt sich mit SvelteKit 3; bis dahin bleibt die Warnung offen und wird hier geführt.

## 4. RS-3: Tests unter Last

### Logs von PocketBase erst nach dem Schreiben lesen

- **Befund:** `backup-control.test.mjs` › „writes audit entries and log lines without values“ las `/api/logs` sofort. PocketBase 0.40.4 schreibt sein Log gebündelt, 3 s nach dem letzten neuen Eintrag (`initLogger`); unter Last fehlten die Einträge der Fälle direkt davor. Die Suche nach `/api/logs` fand dasselbe Muster an zehn weiteren Stellen: Die Prüfungen „kein Wert im Log“ (`channel-telegram`, `channel-calendar`, `connections`, `ingest-route`, `mail-ingest`, `mailbox-route`, `notion-import`) und „der Cron schreibt nichts“ (`hooks-before-migration`, zweimal) lasen sofort und nur die ersten 500 Einträge (ohne `sort` die ältesten), sahen also die Einträge ihrer eigenen Fälle meist gar nicht; `system-control` wartete nur auf den Eintrag des Neustarts, `inbox-cleanup` las nur die erste Seite.
- **Umsetzung:** `tests/support/logs.mjs`: `writtenLogs` schickt eine Anfrage mit eigener Marke an `/api/health` (PocketBase protokolliert jede Anfrage mit ihrer Adresse), wartet, bis sie geschrieben ist (dann ist alles davor geschrieben), und liest alle Seiten; `allLogEntries` liest alle Seiten mit Filter. Die Audit-Tests fragen ab, bis alle erwarteten Einträge da sind, und prüfen dann wie bisher. Keine Erwartung gelockert. Statisch geprüft: kein Test liest `/api/logs` mehr nur mit `perPage` (`tests/unit/test-timing.test.mjs`).
- **Fund dabei:** Mit dem Abwarten fand die Prüfung „byl-calendar schreibt nichts“ den Eintrag der Anfrage `POST /api/crons/byl-calendar`, die den Lauf auslöst: Vorher hatte sie nie einen Eintrag ihres eigenen Falls gesehen. Sie prüft jetzt die Einträge des Servers (ohne `type: request`).

### Zeitüberschreitungen unter Last

- **Befund:** Lokal liefen Zeitgrenzen in `beforeAll` ab (`spa-fallback`, `web-app`, `control-script`, `mail-helper-process`, `web-publish`, `backup-restore` u. a.), wenn mehrere Agenten gleichzeitig bauten; die CI blieb grün.
- **Messung** (Entwicklungsrechner, 16 logische Prozessoren, `startPocketBase` des Harness = `superuser upsert` mit allen 34 Migrationen, dann `serve` bis `/api/health`; künstliche Last aus Worker-Threads mit Dauerschleife):

| Lage | Dauer je Start |
|---|---|
| allein | 0,9 bis 1,0 s |
| 12 Starts gleichzeitig, sonst ruhig | 1,5 bis 2,3 s |
| 4 gleichzeitig, 16 Threads Last | 9 bis 45 s, davon zwei über die 20 s von `/api/health` |
| 12 gleichzeitig, 16 Threads Last | 25 bis 167 s, acht über die 20 s |
| 4 gleichzeitig, nur Plattenlast (8 MB alle 50 ms) | 0,9 bis 1,0 s |

- **Ursache:** Konkurrenz um den Prozessor, nicht die Platte. Ein Build oder Testlauf daneben (Vite, svelte-check, Vitest mit eigenen Servern) macht jeden Start von PocketBase, PowerShell und den Hilfsprogrammen um ein Vielfaches langsamer. Dazu kamen die festen Grenzen (20 s für `/api/health` im Harness, 30 s je Hook im Projekt, 60 bis 120 s in einzelnen Dateien) und die eigene Parallelität: Vitest startete lokal bis zu 15 Dateien mit eigenen Servern gleichzeitig, neben den Unit-Tests mit ihren PowerShell-Aufrufen.
- **Umsetzung:**
  - `tests/support/timing.mjs` hält jede Grenze der Dateien mit Prozessen an einer Stelle, begründet mit der Messung: `/api/health` im Harness 90 s (war 20 s), je Test 60 s (war 15 s), je Hook 180 s (war 30 s), Schreiben des Logs 30 s. `BECAUSEYOULOVEJIRA_TEST_TIME_SCALE` (1 bis 10, kein `BYL_*`-Name, denn die sind Zugangsdaten) vervielfacht alle für einen Rechner, auf dem gerade mehr läuft.
  - Die Dateien mit Prozessen laufen als eigene, letzte Gruppe (`sequence.groupOrder` 2) mit höchstens vier gleichzeitig (`processWorkers`: Prozessoren minus eins, höchstens vier; der Windows-Runner mit vier Prozessoren behält seine drei). Vitest verlangt für Projekte derselben Gruppe dieselbe Zahl Worker, deshalb laufen `unit` und `helper` vorher für sich.
  - Keine Datei mit Prozessen setzt mehr eine feste Zahl, nur `scaled(…)` oder die Vorgaben des Projekts (statisch geprüft). Die feste Pause von 300 ms vor dem ersten Veröffentlichen in `web-publish` wartet jetzt auf die erste Antwort der Last.
  - Bewusst fest bleiben Grenzen des Produkts: die 15 s des geordneten Beendens (`system-control` prüft, dass der Server vor 14 s weg ist, sonst wäre er hart beendet), die 60 s von `Invoke-AdminUpsert` und die 2 s der Prüfung des Einrichtungslinks.
- **Kosten:** Lokal dauert die Gruppe ohne Last 3 bis 3,5 min statt 2,4 min (vier statt fünfzehn Dateien zugleich). Im Windows-Job ändert sich die Zahl der Worker nicht.
- **Beleg (Wiederholungen unter künstlicher Last, 2026-10-02, je `npx vitest run --project integration-processes`, 36 Dateien, 408 Fälle):**

| Konfiguration | Last | Ergebnis |
|---|---|---|
| vorher | 8 Threads | mindestens 13 Dateien rot, jede mit „Hook timed out“ (60 s bzw. 90 s, `host-route` 30 s) |
| vorher | 16 Threads | mindestens 19 Dateien rot, „Hook timed out“ und „did not report healthy within 20000 ms“ |
| nachher | 8 Threads | dreimal alles grün (177 s, 248 s, 180 s) |
| nachher | 16 Threads | 8 von 408 Fällen rot nach 15 min: zwei an der Grenze von 60 s je Test, `recurrence-startup` als ganze Datei, die übrigen an Grenzen des Produkts und an Abfragen in den Fällen (Cron-Lauf, 14 s des Beendens, Prüfung des Installers); 28 Dateien grün |
| nachher, `BECAUSEYOULOVEJIRA_TEST_TIME_SCALE=3` | 16 Threads | 3 von 419 Fällen rot nach 12 min (inzwischen mit den Fällen von SPE-1): zwei in `system-control` rund um den Neustart (die 14 s des geordneten Beendens sind eine Grenze des Produkts) und die Abfrage auf den Lauf des Cron-Jobs in `channel-calendar`; 34 von 36 Dateien grün, kein Hook |

### Nebenbefund: CRLF im Text eines Eingangseintrags

- **Befund:** Ein Eingangseintrag mit Originaldatei (Mail-Datei, Postfach-Auswahl) wird als Formular hochgeladen; Browser und Node schicken die Textfelder eines `multipart/form-data` nach HTML-Standard mit CRLF. Der Text kam deshalb mit CRLF zurück, derselbe Eintrag über JSON (Hilfsprozess, eigener Eingang) mit LF.
- **Bewertung: ein Fehler.** Die Anzeige (markdown-it) verträgt beides, Duplikate hängen nicht am Text (Fingerprint aus Message-ID usw.). Aber ein Ticket aus dem Eintrag (`ticketPrefill`) mischte die LF der Kopfzeilen mit den CRLF des Textes, das Bearbeiten im Editor schreibt LF zurück (der Verlauf sähe eine Änderung jeder Zeile), und die Grenze von 100 000 Zeichen zählte jedes CR mit: ein langer Text wurde früher abgeschnitten.
- **Umsetzung:** an einer Stelle, im Hook: `normalizeBody` in `lib/inbox-rules.js` macht aus CRLF und CR ein LF, bevor gekürzt wird (alle Kanäle legen über `inbox-service.js` an). Regressionstests: Unit (`inbox-rules.test.mjs`) und Integration gegen die Wegwerf-Instanz (`web-data-inbox.test.mjs`: Eintrag mit und ohne Datei gleich, ohne CR). Bestehende Einträge bleiben, wie sie sind (keine Migration: sie werden richtig angezeigt). Wirkt nach einem Neustart der App.

## 5. RS-1: Fehlerkatalog der Skripte

Entscheidung und Format in [ADR-0048](../adr/0048-fehlerkatalog-der-skripte.md). Hier die Inventur: jeder Fehlerweg mit seinem Eintrag (Code), nach Skript. Mit `*` auch in der Hilfe „Betrieb“, mit `J/N` mit Angebot zum Selbstlösen im Fenster, mit `(H)` ein Hinweis (der Befehl geht weiter).

| Skript bzw. Befehl | Fehlerwege und Einträge |
|---|---|
| alle `.bat`-Dateien, `start-hidden.vbs` | PowerShell kann `byl-control.ps1` nicht ausführen (Richtlinie, gesperrter Download, fehlende oder beschädigte Datei): `script-blocked`*, ohne Fenster `script-blocked-hidden` |
| `byl-control.ps1`, alle Befehle | `byl-config.json` kein JSON (`config-json`*, J/N) oder ungültiger Port (`config-port`*, J/N), nicht schreibbar (`config-write`); unbekannter Befehl (`command-unknown`); `-Detach` bzw. `-WaitForProcess` bei einem anderen Befehl (`detach-only`); Befehl braucht ein Fenster (`console-needed`); Eingabe der App kein gültiges JSON (`input-invalid`); jeder andere Fehler `unexpected`* (Log und Befehl für dessen letzte 50 Zeilen) |
| `start.bat`, `start`, Autostart | `pocketbase.exe` fehlt (`pocketbase-missing`*), Ordner unvollständig (`app-incomplete`), Ordner nicht beschreibbar (`folder-not-writable`*), Oberfläche fehlt (`web-missing`*, H), PocketBase startet nicht oder beendet sich sofort (`pocketbase-start`, `pocketbase-exited`*), keine Antwort auf `/api/health` in der Frist (`health-timeout`*), Port belegt (`port-busy`*, J/N), läuft, antwortet aber nicht (`app-unhealthy`*, J/N), startende Instanz verschwindet (`start-vanished`); Hinweise: Zustand oder Adresse nicht schreibbar (`state-write`, `state-delete`, `address-write`), DPAPI nicht verfügbar (`dpapi-start`*), Zugang des Mail-Hilfsprozesses (`ingest-token`), Mail-Hilfsprozess startet nicht (`mail-helper-start`*), wenig, sehr wenig oder unbekannter Platz (`disk-low`*, `disk-critical`, `disk-unknown`), Autostart zeigt auf einen anderen Ordner (`autostart-other`) |
| `stop.bat`, `neu-starten.bat`, `restart`, `reload`, `open` | App läuft nicht (`not-running`, J/N), lässt sich nicht beenden (`stop-failed`*), hart beendet (`hard-stop`, H), Port danach noch belegt (`port-still-busy`), Neustart im Hintergrund startet nicht (`detach-failed`) |
| `mail-restart` | App läuft nicht (`mail-not-running`, J/N), Mail-Hilfsprozess endet nicht (`mail-stop-failed`) |
| `logs` | unbekanntes Log (`logs-unknown`), `-Follow` mit `-Json` oder mehreren Logs (`logs-follow-json`, `logs-follow-one`), Log gibt es noch nicht (`log-missing`) |
| `port` | ungültige Zahl (`port-invalid`) |
| `autostart-an.bat`, `autostart-aus.bat` | Testkopie ohne Testordner (`autostart-test`), `start-hidden.vbs` fehlt (`autostart-vbs-missing`), Startup-Ordner nicht schreibbar (`autostart-write`*), Verknüpfung nicht entfernbar (`autostart-remove`) |
| `admin-zuruecksetzen.bat` | E-Mail ungültig, Passwörter verschieden, zu kurz, zu lang, unerlaubtes Zeichen (`admin-email`, `admin-password-*`), Datenbank gesperrt, Zeitüberschreitung, PocketBase lehnt ab (`admin-locked`, `admin-timeout`, `admin-failed`) |
| Sicherung (`backup-*`, Seite „Sicherung“) | Zielverzeichnis ungültig, zu lang, im Ordner `app`, nicht erreichbar*, nicht beschreibbar, zu wenig Platz (`backup-target-*`), Aufbewahrung ungültig (`backup-keep`), kein Ziel (`backup-no-target`); Passphrase fehlt*, unlesbar, verschieden, zu kurz, zu lang, unerlaubtes Zeichen, DPAPI nicht verfügbar, nicht speicherbar* (`passphrase-*`, nach einer Wiederherstellung `passphrase-save-later`, H); Name ungültig oder Sicherung fehlt (`backup-name`, `backup-missing`), `byl-backup.exe` fehlt oder antwortet nicht (`backup-helper`*), Versiegeln scheitert (`backup-seal`) |
| `backup-verify`, `wiederherstellen.bat`, `restore` | Passphrase falsch (`backup-passphrase`*) oder fehlt (`backup-no-passphrase`), kein bekanntes Format, beschädigt (`backup-format`, `backup-damaged`*), ZIP, Datenbank, Integrität, Dateien (`backup-zip`, `backup-no-db`, `backup-integrity`, `backup-files`), Wegwerf-Server startet nicht (`backup-start`), Platz in Temp (`backup-temp-space`); Rückfrage ohne Wort, Wahl der Zugangsdaten, abgebrochen (`restore-confirm`, `restore-credentials`, `restore-cancel`), Auftrag ungültig (`restore-input`), Platz (`restore-space`), App endet nicht (`restore-stop`), Tausch scheitert (`restore-swap`), losgelöster Lauf startet nicht (`restore-detach`), App startet danach nicht, Rückweg (`restore-start`*); Einstellungen bzw. Zugangsdaten nicht übernommen (`restore-config`, `restore-credential`, beide H) |
| `scripts\build.ps1`, `build-mail-helper.ps1`, `build-backup-helper.ps1` | Node fehlt (`node-missing`, mit gefundenem Node-Ordner), falsche oder zu alte Version (`node-version`, `node-old`), npm fehlt (`npm-missing`), Lockfile fehlt (`lockfile-missing`), `npm ci` scheitert (`npm-ci`), check, lint, build oder test scheitert (`build-step`, mit Befehl zum Wiederholen), Hilfsprogramm baut, prüft oder installiert nicht (`helper-build`, `helper-check`, `helper-install`), sonst `build-unexpected` |
| `scripts\fetch-pocketbase.ps1` | Netz oder Download (`pocketbase-download`), Prüfsumme (`pocketbase-checksum`), Schreiben (`pocketbase-write`), Version (`pocketbase-version`), System (`pocketbase-platform`) |

**Beispiel aus `byl-pruefen.bat`** (Ordner mit `&` und `'` im Namen, Ausgabe des Integrationstests, gekürzt):

```
X Problem:   byl-control.ps1 konnte nicht ausgefuehrt werden.
             Ordner: C:\…\Pruefung & Co's\app\
  Ursache:   Eine Richtlinie fuer PowerShell-Skripte blockiert es, oder Dateien im Ordner app fehlen
             oder sind beschaedigt.
  So geht's: 1. Pruefen, ob byl-control.ps1, byl-functions.ps1 und byl-problems.ps1 im Ordner app
                liegen.
             2. Stammt der Ordner aus einem Download (ZIP): die Dateien entsperren (Befehl unten).
             …
             Befehl zum Kopieren:
               powershell -NoProfile -Command "Get-ChildItem -LiteralPath 'C:\…\Pruefung & Co''s\app\' | Unblock-File"
```

**Beispiel aus `build.ps1`** (Node nicht im `PATH`):

```
× Problem:   Node.js wurde nicht gefunden (PATH).
  Ursache:   Node.js 24 ist nicht installiert, oder sein Ordner steht nicht im PATH dieses Fensters.
  So geht's: 1. Node.js 24 installieren (nodejs.org) oder den Ordner mit node.exe vorn in den PATH
                nehmen.
             2. Liegt Node.js schon auf diesem Rechner, nimmt der Befehl unten seinen Ordner für
                dieses PowerShell-Fenster in den PATH.
             3. Danach das Skript in diesem Fenster erneut starten.
             Befehl zum Kopieren:
               $env:Path = "C:\…\tools\node;$env:Path"
```

- **Fund bei der Umsetzung:** `byl-pruefen.bat` setzte den Ordner zuerst direkt in `echo` ein; ein `&` im Pfad (etwa „Max & Anna“) hätte cmd den Rest als Befehl ausführen lassen. Der Ordner wird jetzt nur verzögert erweitert (`!BYL_DIR!`), `'` für PowerShell verdoppelt; der Integrationstest läuft in einem Ordner mit `&` und `'`.
- **Tests:** statisch, Unit (Windows PowerShell) und Integration gegen Wegwerf-Kopien unter `.tmp` auf Zufallsports (BYL-E6-983 bis BYL-E6-989), drei manuelle Fälle (BYL-E6-990 bis BYL-E6-992).

## 6. Entscheidungen und Befunde

| Datum | Paket | Befund bzw. Entscheidung |
|---|---|---|
| 2026-10-01 | RS-2 | Lockfile-Prüfsumme in PowerShell (`scripts\build-functions.ps1`) statt in Node: Nur `build.ps1` und die Builds der Hilfsprogramme installieren; die CI installiert ohnehin frisch. Die reinen Funktionen laufen im Unit-Test gegen Ordner unter Temp, `npm` nie. |
| 2026-10-01 | RS-2 | `allowScripts` nach Name statt nach Version, und Freigabe statt Ablehnung (siehe §3). |
| 2026-10-01 | RS-2 | `npm audit` in `web`: kein Fix ohne SvelteKit 3; nicht ausnutzbar, weil die App keinen Server von SvelteKit hat (siehe §3). |
| 2026-10-02 | RS-3 | Längere, aber begründete und skalierbare Grenzen statt fester; dazu weniger eigene Parallelität. Eine Wiederholung fehlgeschlagener Fälle (`retry`) wurde verworfen: Sie sendete schreibende Anfragen doppelt und verdeckte echte Stillstände. Ein höheres Limit für die gemeinsame Instanz auch nicht: Die Gruppe läuft allein (T-4), ihr Limit von 15 s fängt Stillstände ab. |
| 2026-10-02 | RS-3 | Die Marke von `writtenLogs` ist eine Anfrage an `/api/health` mit eigenem Parameter: Sie braucht keine Rechte, ändert nichts, und PocketBase protokolliert sie wie jede Anfrage (gemessen: geschrieben nach gut 3 s, mit 404- und anderen Anfragen davor). Weil das Log der Reihe nach geschrieben wird, ist mit ihr alles davor geschrieben. Ein Lauf eines Cron-Jobs im Hintergrund kann theoretisch später schreiben; die Marke kommt nach seiner Anfrage und mindestens 3 s Bündeln, das reicht für die Jobs, die hier nichts tun. |
| 2026-10-02 | RS-3 | Höchstens vier Dateien mit Prozessen zugleich: Bei zwölf zugleich wurde jeder Start unter Last ein Mehrfaches langsamer (Messung §4), bei vier blieb der Lauf ohne Last bei gut drei Minuten. Der Windows-Runner hat vier Prozessoren und hatte schon vorher drei Worker. |
| 2026-10-02 | RS-1 | Katalog als `.ps1` mit Zeichenketten in einfachen Anführungszeichen, nicht als JSON: geladen wie `byl-functions.ps1`, ohne eigenen Leser; ist er beschädigt, fängt `byl-pruefen.bat` das ab. |
| 2026-10-02 | RS-1 | Fehlerzeichen `×` (U+00D7) statt U+2716: Das schwere Kreuz fehlt in den Schriften der Konsole von Windows 10 (Consolas, Lucida Console, Courier New, geprüft mit `GlyphTypeface`); `.bat` und `.vbs` bleiben ASCII mit `X`. |
| 2026-10-02 | RS-1 | `-Json`: ein Fehler antwortet flach mit `code` und `remedy` (Schritte und Befehl) neben Problem, Ursache und Log; die Antworten der Sicherung tragen denselben Eintrag als `report`, weil ihr Feld `problem` seit ADR-0046 einen Kurzgrund nennt. |
| 2026-10-02 | RS-1 | Die Seite „System“ zeigt einen Fehler im Hintergrund als Warnung ohne eigenen Knopf zum Ausblenden: Er verschwindet mit dem nächsten Lauf ohne Fenster, der gelingt, oder dem nächsten Lauf im Fenster; ein Knopf bräuchte einen weiteren Befehl in der Whitelist. |
| 2026-10-02 | RS-3 | Ziel ist ein grüner Lauf neben einem zweiten Build (8 Threads, belegt dreimal). Bei voller Last daneben (16 Threads auf 16 Prozessoren) hilft der Faktor `BECAUSEYOULOVEJIRA_TEST_TIME_SCALE=3`; was dann noch scheitert, sind Grenzen des Produkts (14 s des Beendens) und einzelne Abfragen in Fällen. Diese bleiben bewusst so: Eine Grenze des Produkts im Test zu lockern hieße, ein langsames Beenden nicht mehr zu bemerken. Wer so parallel arbeitet, startet die Tests mit dem Faktor oder nacheinander. |
