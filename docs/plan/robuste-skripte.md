# Plan Robuste Skripte und Wartung: Fehlerkatalog, Abhängigkeiten, Tests unter Last, Test-Instanzen

- **Stand:** RS-2 (Build und Abhängigkeiten) in Arbeit; RS-3 (Tests unter Last), RS-1 (Fehlerkatalog der Skripte) und RS-4 (System-Seite und Manifest-Pflege) folgen, je ein PR.
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
| RS-3 | Tests robust gegen Last: Logs von PocketBase abwarten statt sofort lesen, Bereitschaft abfragen statt fester Grenzen, zentrale Zeitgrenzen, Parallelität der Prozess-Tests begrenzt; Nebenbefund CRLF im Text eines Eingangseintrags | folgt |
| RS-1 | Fehlerkatalog aller Skripte: einheitliches Format mit Ursache, Schritten und Befehl mit echten Pfaden, Angebot zum Selbstlösen, offenes Fenster bei Fehlern, Hinweis nach Fehlern im Hintergrund, Hilfe-Seite „Betrieb“ als FAQ, neue ADR | folgt |
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

## 4. Entscheidungen und Befunde

| Datum | Paket | Befund bzw. Entscheidung |
|---|---|---|
| 2026-10-01 | RS-2 | Lockfile-Prüfsumme in PowerShell (`scripts\build-functions.ps1`) statt in Node: Nur `build.ps1` und die Builds der Hilfsprogramme installieren; die CI installiert ohnehin frisch. Die reinen Funktionen laufen im Unit-Test gegen Ordner unter Temp, `npm` nie. |
| 2026-10-01 | RS-2 | `allowScripts` nach Name statt nach Version, und Freigabe statt Ablehnung (siehe §3). |
| 2026-10-01 | RS-2 | `npm audit` in `web`: kein Fix ohne SvelteKit 3; nicht ausnutzbar, weil die App keinen Server von SvelteKit hat (siehe §3). |
