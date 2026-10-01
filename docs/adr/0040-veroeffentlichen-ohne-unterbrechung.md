# ADR-0040: Veröffentlichen ohne Unterbrechung – Build im Staging-Ordner, Austausch ohne Lücke, alte Module bleiben, Hinweis auf die neue Version

- **Status:** Angenommen und umgesetzt (Fehlerbehebung, [Plan](../plan/deploy-ohne-unterbrechung.md)). Nachtrag RS-2 (Build und Abhängigkeiten, [Plan Robuste Skripte](../plan/robuste-skripte.md)).
- **Datum:** 2026-09-29
- **Entscheidung durch:** Advisor (Arbeitshypothese, Maßnahmen), Executor (Nachweis im Browser, Umsetzung, Einzelheiten)
- **Bezug:** [ADR-0007](0007-realtime-und-sitzungspflege.md) (`LiveUpdateNotice` als Vorbild), [ADR-0009](0009-fehlerfarbe.md) (kein Rot für Hinweise), [ADR-0025](0025-ui-konsistenz-overlay-system.md) (Bestätigung „Änderungen verwerfen?“), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) §2 (`SectionMessage`), [ADR-0035](0035-start-einstieg-und-offene-tabs.md) §1 und §8 (Landing-Seite, installierte App, Service Worker), [ADR-0039](0039-betriebsskripte.md) (Fingerabdruck liest `_app/version.json`; Hooks wirken erst nach einem Neustart)

## Kontext

Beobachtung des Nutzers (2026-09-29): Seit einigen Stunden zeigte das Dashboard manchmal nach dem Klick auf einen Link oder nach einer Weiterleitung eine nackte Seite **„500 Internal Error“**, die nach dem Neuladen verschwand; manche Links luden die Seite scheinbar neu, beim zweiten Mal ging alles „live“. In diesen Stunden hatten Agenten nach jedem Merge im Live-Ordner `git pull` und `scripts\build.ps1` ausgeführt, während die App offen war.

Nachweis mit einer Wegwerf-Instanz und Edge headless (CDP, Wegwerf-Profil), Build des damaligen `main`:

1. **Lücke beim Schreiben:** adapter-static leert `app/pb_public` und schreibt es neu, `index.html` zuletzt. Nach etwa 16 bis 19 s Vite-Build fehlte `index.html` je Build 2,3 bis 4,5 s, `_app/version.json` gut 2 s. In dieser Zeit bekam jede Seitenanfrage die JSON-Antwort von PocketBase `{"data":{},"message":"File not found.","status":404}` (30 von 30 Tabs); Tabs, die kurz vor der Lücke luden, blieben leer (8 von 40).
2. **Offene Tabs verlieren ihre Module:** Die Dateien unter `_app/immutable` tragen den Inhalt im Namen. Auch ohne Änderung am Quelltext bekamen je Build rund 50 von 190 Dateien neue Namen (die Build-Version steckt im Code). PocketBase beantwortet eine fehlende Datei per Index-Fallback mit `index.html` (200, `text/html`), der Browser verweigert sie als Modul. SvelteKit prüft dann `_app/version.json`, sieht die neue Version und lädt das Ziel als neues Dokument: genau das „lädt neu, beim zweiten Mal live“ (reproduziert).
3. **Klick während der Lücke:** Die alten Module fehlten schon, `_app/version.json` noch; SvelteKit fand keine neue Version und zeigte die Fehlerseite der App „Etwas ist schiefgelaufen · Fehlercode 500“, die bis zum Neuladen stehen blieb (reproduziert).
4. **Die nackte Seite „500 Internal Error“** ist die Standard-`error.html` von SvelteKit (englisch, Status und „Internal Error“). Der Client setzt sie ein, wenn nicht einmal Wurzel-Layout oder Fehlerseite der App laden (`load_root_error_page`). Im SPA-Modus wird nie hydriert (`hydrated` bleibt falsch), deshalb endet jeder erste Seitenaufbau mit fehlendem Wurzel-Modul dort, etwa ein Neuladen oder eine Weiterleitung (Landing-Seite, installierte App, Neuladen nach Punkt 2) in der Lücke oder mit einem veralteten `index.html` aus dem Cache. Der Pfad ist mit fehlenden Wurzel-Modulen nachgestellt; der englische Standard lag als eigene Datei im Build.
5. **Veraltetes `index.html` aus dem Cache:** PocketBase sendet für `pb_public` nur `Last-Modified`, kein `Cache-Control`. Browser nehmen dann eine Datei ein Zehntel ihres Alters lang ohne Nachfrage aus dem Cache. Nach einem Build lieferte eine eingetippte Adresse bzw. Zurück das alte `index.html` aus dem Datenträger-Cache (reproduziert, „(disk cache)“), die alte Version lief wieder an, und der nächste Link lud erneut.
6. **Widerlegt:** (d) Keine jüngere Änderung (Realtime-Wiederholung, Papierkorb, eigener Eingang, `GET /api/byl/host`, Titelbreite) kann eine Fehlerseite von SvelteKit auslösen: Die einzige `load`-Funktion ist die Weiterleitung von `/einstellungen`; Fehler in Stores und Komponenten erzeugen keine Fehlerseite. (e) Präsenz, zweiter Tab und Landing-Seite verursachen keinen Fehler; Landing-Seite, `start.bat` und installierte App öffnen die App als neues Dokument und treffen dabei die Lücke oder den Cache wie jedes Neuladen. PocketBase startet unter Windows bei geänderten Hooks nicht selbst neu (ADR-0039), ein Neustart während des Builds war also nicht beteiligt.

## Entscheidung

### 1. Build in einen Staging-Ordner, dann veröffentlichen

adapter-static schreibt nach `web/build` (gitignored). `scripts/publish-web.mjs` (Node, plattformneutral, Teil des Root-`npm run build`, damit auch `scripts\build.ps1` und beide CI-Jobs es nutzen) bringt den Build nach `app/pb_public`, während PocketBase ausliefert:

1. neue Dateien unter `_app/immutable` (noch verweist nichts auf sie),
2. die Dateien mit festem Namen (Icons, Manifest, `offline.html`, `service-worker.js`), unveränderte werden übersprungen,
3. `_app/version.json`, 4. `index.html` als letzte Datei.

Jede Datei entsteht als Kopie im selben Ordner (`.byl-publish-*.tmp`) und wird über das Ziel umbenannt; eine Anfrage sieht die alte oder die neue Datei, nie eine fehlende oder halb geschriebene. `Last-Modified` ist die Zeit des Veröffentlichens (Windows behält beim Kopieren die Zeit des Builds, dann könnte ein Browser, der für ein fehlendes Modul einmal `index.html` bekam, später „304“ statt des Moduls bekommen). Ein Build ohne `index.html` oder `_app/version.json` wird abgelehnt, das Ziel bleibt unverändert.

### 2. Dateien alter Builds bleiben

`_app/builds.json` führt je Build Version, Zeitpunkt und die Dateien unter `_app/immutable`, neueste zuerst. Die Dateien der letzten **10 Builds** bleiben, ältere werden nach dem Austausch gelöscht; eine Datei, die ein behaltener Build nutzt, nie. Beim ersten Lauf (oder bei unlesbarer Liste) gelten die vorhandenen Dateien als der bisher laufende Build, so ist schon der erste Build mit diesem Verfahren für offene Tabs sicher. Ein Build hat etwa 2,5 MB, geändert sind je Build meist 50 bis 60 Dateien; `pb_public` wächst dadurch um wenige MB. Zehn Builds reichen: Ein offener Tab erkennt die neue Version nach spätestens einer Minute (§5) und wechselt beim nächsten Link; die alten Dateien überbrücken nur diese Zeit bzw. die Zeit mit offenem Entwurf.

### 3. Gesperrte Dateien unter Windows

Solange PocketBase `index.html` zum Ausliefern geöffnet hat, scheitert das Umbenennen darüber (`EPERM`, gemessen; der Unit-Test stellt das mit einer Sperre ohne Löschfreigabe nach); das Skript versucht es etwa 3 s lang erneut (25 ms bis 1,6 s), kopiert danach an Ort und Stelle (PocketBase erlaubt Schreiben) und bricht sonst mit einer klaren Meldung ab. Weil das Aufräumen erst nach dem Austausch läuft, bleibt der vorige Build dann vollständig. Eine gesperrte alte Datei bleibt bis zum nächsten Build liegen. Gemessen mit 400 Umbenennungen unter Dauerlast (vier parallele Anfragen): 74 Wiederholungen des Schreibers; umgekehrt bekamen 207 von 37.128 Anfragen einen 404, weil PocketBase `index.html` im selben Augenblick nicht öffnen konnte (Freigabekonflikt, rund 0,1 ms je Umbenennung). Ein Veröffentlichen benennt drei bis vier Dateien um; für einen einzelnen Nutzer ist das vernachlässigbar, eine Lücke über mehrere Anfragen gibt es nicht mehr (Integrationstest).

### 4. `Cache-Control: no-cache` für den Web-Build

Der Hook `app/pb_hooks/static-cache.pb.js` (Regel rein in `lib/static-cache.js`) setzt für GET und HEAD außerhalb von `/api/` und `/_/` `Cache-Control: no-cache`. Der Browser behält seine Kopie, fragt aber jedes Mal nach (Antwort 304, solange sich nichts geändert hat). So startet nach einem Build kein altes `index.html` mehr aus dem Cache, und die Antwort `index.html` für ein fehlendes Modul bleibt nicht im Cache hängen. Wie jeder Hook wirkt er erst nach einem Neustart der Instanz (`neu-starten.bat`, ADR-0039); bis dahin schützen §1, §2, §5 und §6.

### 5. Neue Version erkennen und dezent anbieten

- `kit.version.pollInterval` 60 s: SvelteKit fragt `_app/version.json` jede Minute ab (eine 27-Byte-Datei auf `127.0.0.1`; das Verbot von Polling in §7 von CLAUDE.md gilt Daten, nicht der Build-Version). Der Name der Version bleibt der Standard von SvelteKit, die Build-Zeit.
- `AppUpdateNotice` im `(app)`-Layout wie `LiveUpdateNotice`: immer vorhandene Statusregion, `SectionMessage` Ton **info** (keine Warnung, kein Rot: die laufende Version funktioniert weiter), „Eine neue Version von becauseyoulovejira ist da.“ mit „Neu laden“. Solange ungespeicherte Eingaben im Ticket stehen (`hasUnsavedInput`, Kommentare), folgt „Speichere zuerst deine Eingaben, beim Neuladen gehen sie verloren.“.
- **Nächste Navigation als neues Dokument:** In `onNavigate` (läuft erst, nachdem alle `beforeNavigate` die Navigation durchgelassen haben, also nach „Änderungen verwerfen?“) wird ein Klick auf einen Link nach einem Update zum Laden seines Ziels als neues Dokument. Nicht bei `goto` (Tour, Weiterleitungen, Speichern), Zurück und Vor, und nicht, solange Eingaben, eine laufende Sammelaktion oder ein angebotenes „Rückgängig“ verloren gingen; dann bleibt es bei der Navigation in der App mit den alten Modulen (§2). Ein Neuladen ohne Nachfrage würde Entwürfe still verwerfen: Das Schließen des Tabs ist von der Verwerfen-Frage ausdrücklich nicht erfasst (Kommentar in `tickets/[id]/+layout.svelte`).

### 6. Modul-Ladefehler abfangen, Fehlerseiten verständlich

- `src/hooks.client.ts`: `handleError` macht aus jedem Fehler eine deutsche Meldung ohne technische Einzelheiten und markiert Module, die nicht geladen werden konnten (`kind: 'module-load'`, erkannt an den Meldungen von Chromium, Firefox, Safari und dem CSS-Preload von Vite). Der Hook hat keine Nebenwirkung, weil SvelteKit ihn auch für gescheiterte Preloads beim Überfahren eines Links aufruft, und schreibt nichts in die Konsole (ESLint `no-console`).
- `+error.svelte`: Bei `module-load` lädt die Seite die Adresse einmal als neues Dokument („Neue Version wird geladen …“). Schleifenschutz über sessionStorage `byl-reload-attempt` (Adresse und Zeit): innerhalb von 60 s nicht noch einmal für dieselbe Adresse, ohne sessionStorage nie von selbst. Sonst „Etwas ist schiefgelaufen“ mit Grund, „Neu laden“ und „Zur Übersicht“ (als neues Dokument, `data-sveltekit-reload`). Schriftgrößen auf die Tokens umgestellt (Liste von `no-own-font-sizes` geschrumpft).
- `src/error.html` ersetzt die englische Standardseite: deutsch, Systemfarben wie `offline.html`, Meldung und Fehlercode, „Neu laden“ als Knopf mit `onclick` und „Zur Übersicht“. SvelteKit setzt die Seite per `DOMParser` in das offene Dokument; Skripte darin laufen nicht, Attribute schon. Ein automatisches Neuladen gibt es hier nicht (siehe Alternativen).

### 7. Regel für Agenten

Im Live-Ordner wird nur über `scripts\build.ps1` bzw. das Root-`npm run build` gebaut, nie `vite build` direkt nach `app/pb_public`, nie `pb_public` leeren oder Dateien unter `_app/immutable` von Hand löschen (CLAUDE.md §11.6). Änderungen an `pb_hooks` und `pb_migrations` brauchen weiter einen Neustart durch den Nutzer.

## Alternativen

- **Ordner tauschen** (`pb_public` umbenennen, Staging an seine Stelle): Zwischen den zwei Umbenennungen fehlt der Ordner; ein Ordner lässt sich unter Windows nicht umbenennen, solange PocketBase eine Datei darin offen hat; `--publicDir` ist beim Start fest. Verworfen.
- **Verzeichnis-Verknüpfung (Junction), die umgehängt wird:** Eine Ordnerkopie von `app\` für Sicherung und Umzug kopiert dann die Verknüpfung statt der Dateien (CLAUDE.md §1). Verworfen.
- **Nur Versionserkennung, adapter-static schreibt weiter direkt:** Lücke und kaputte offene Tabs blieben. Verworfen.
- **Module im Service Worker zwischenspeichern:** widerspricht „kein Offline-Modus“ (CLAUDE.md §10) und ADR-0035 §8 (der Service Worker speichert nur `offline.html`). Verworfen.
- **`immutable` für `_app/immutable`:** PocketBase beantwortet ein fehlendes Modul mit `index.html`; der Browser behielte dann HTML unter der Adresse des Moduls ein Jahr lang, auch wenn dieselbe Datei später wieder veröffentlicht wird. `no-cache` für alles ist einfacher, das Nachfragen auf `127.0.0.1` kostet fast nichts. Verworfen.
- **Wiederholung im Hook, wenn `index.html` im Augenblick des Umbenennens nicht zu öffnen ist:** mehr Code im Pfad jeder Anfrage für rund 0,1 ms je Veröffentlichen. Zurückgestellt.
- **Automatisches Neuladen der Notfallseite:** Skripte laufen dort nicht; `handleError` darf nicht navigieren (Preloads); ein `meta refresh` hätte keinen Schleifenschutz. Verworfen; die Fehlerseite der App lädt von selbst neu, die Notfallseite bietet den Knopf.

## Konsequenzen

- `npm --prefix web run build` schreibt nur noch nach `web/build`; `app/pb_public` entsteht über das Root-`npm run build` (`scripts\build.ps1`, beide CI-Jobs), `npm test` braucht es wie bisher.
- Der Fingerabdruck des Steuerskripts (ADR-0039) liest weiter `_app/version.json` und `index.html`; ein neuer Build heißt dort weiter „nur neu laden (F5)“, der neue Hook einmal „Neustart nötig“.
- `app/pb_public` enthält zusätzlich `_app/builds.json` und die Dateien älterer Builds; Sicherung per Ordnerkopie bleibt möglich.
- Offene Punkte: die manuellen Prüfungen BYL-E6-484 und BYL-E6-485 im Test-Manifest.

## Nachtrag (2026-10-01, [Plan Robuste Skripte](../plan/robuste-skripte.md), RS-2): Build und Abhängigkeiten

- **Befund:** `scripts\build.ps1` und die Builds der Hilfsprogramme riefen `npm ci` nur, wenn `node_modules` fehlte. Nach einem Update einer Abhängigkeit oder einem Merge von `main` baute und testete der Build mit den Versionen des alten Lockfiles; im Live-Ordner veröffentlichte er so ein Frontend aus alten Paketen.
- **Entscheidung:** Nach jedem erfolgreichen `npm ci` liegt der SHA-256 des `package-lock.json` in `node_modules\.byl-lockfile.sha256` (`scripts\build-functions.ps1`). Jeder Build prüft alle Ordner mit eigenem Lockfile (Root, `web`, `helpers/mail`, `helpers/backup`, `extensions/whatsapp-web`) und ruft `npm ci`, wenn `node_modules` fehlt, die Prüfsumme fehlt oder abweicht; die Ausgabe nennt den Grund je Ordner. `npm ci` löscht `node_modules` zuerst, ein gescheitertes Installieren hinterlässt keine Prüfsumme. `build-mail-helper.ps1` und `build-backup-helper.ps1` nutzen dieselbe Funktion. Der Austausch ohne Lücke (§1) bleibt unverändert: Erst nach den Abhängigkeiten folgen check, lint und `npm run build`.
- **Install-Skripte:** Das einzige Install-Skript aller Abhängigkeiten ist das `postinstall` von esbuild (in `helpers/mail`, `helpers/backup`, `extensions/whatsapp-web`). Es ist dort per `"allowScripts": { "esbuild": true }` freigegeben (npm 11: heute ein Hinweis, künftig eine Sperre für nicht freigegebene Skripte), nach Name, weil der Code von esbuild bei jedem Build ohnehin läuft und eine Freigabe je Version mit jedem Update verloren ginge.
- **`npm audit`:** Die drei Meldungen in `web` (niedrig, `cookie` < 0.7.0 über SvelteKit 2) lassen sich nur mit SvelteKit 3 beheben (Major); die SPA hat keinen Server von SvelteKit und setzt keine Cookies, sie sind also nicht ausnutzbar. Begründung im Plan.
- Belegt in `tests/unit/build-dependencies.test.mjs` (Zustände aus Prüfsumme und Ordnern in Windows PowerShell, Reihenfolge im Build, Prüfsumme erst nach erfolgreichem `npm ci`, Freigabe nur für esbuild).
