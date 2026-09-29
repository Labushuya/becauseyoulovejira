# Plan: Veröffentlichen ohne Unterbrechung

- **Stand:** umgesetzt (Paket DP-1, ein PR). Offen sind die manuellen Prüfungen BYL-E6-484 und BYL-E6-485 im Test-Manifest.
- **Grundlage:** [ADR-0040](../adr/0040-veroeffentlichen-ohne-unterbrechung.md) (Befund mit Belegen, Entscheidungen, Alternativen); [ADR-0039](../adr/0039-betriebsskripte.md) (Steuerskript, Fingerabdruck, Neustart für Hooks); [ADR-0035](../adr/0035-start-einstieg-und-offene-tabs.md) §8 (Service Worker); [CLAUDE.md](../../CLAUDE.md) §7, §9, §11.
- **Einordnung:** Fehlerbericht des Nutzers vom 2026-09-29 („500 Internal Error“ nach Links oder Weiterleitungen, Seite lädt scheinbar neu). Nummern: ADR-0040, Manifest-IDs ab `BYL-E6-480`, Paketkürzel `DP`.

## 1. Befund (Kurzfassung)

Belegt mit Wegwerf-Instanz und Edge headless, Einzelheiten und Zahlen in ADR-0040 „Kontext“:

| Ursache | Wirkung beim Nutzer | Belegt durch |
|---|---|---|
| adapter-static leert `app/pb_public` und schreibt `index.html` zuletzt (Lücke 2,3 bis 4,5 s je Build) | JSON „File not found.“ oder leere Seite bei jedem Laden in der Lücke | 30 von 30 Tabs in der Lücke, 8 von 40 kurz davor leer |
| Alte Module sind nach jedem Build weg, PocketBase antwortet mit `index.html` | Link lädt die Seite neu (SvelteKit sieht die neue Version) | Klick im offenen Tab nach dem Build |
| Klick in der Lücke, `_app/version.json` fehlt | Fehlerseite „Fehlercode 500“ bis zum Neuladen | Klick im offenen Tab, als die alten Module gelöscht waren |
| Wurzel-Layout lädt beim ersten Aufbau nicht (Lücke, Cache) | nackte Seite „500 Internal Error“ (Standard-`error.html` von SvelteKit) | Codepfad `load_root_error_page`, nachgestellt mit fehlenden Wurzel-Modulen |
| Kein `Cache-Control`, Browser nimmt altes `index.html` aus dem Cache | alte Version startet nach einem Build erneut, nächster Link lädt wieder | „(disk cache)“ nach Build, Adresse eingetippt und Zurück |

Widerlegt: Laufzeitfehler in jüngeren Änderungen (keine `load`-Funktion außer der Weiterleitung von `/einstellungen`), Präsenz- und Tab-Logik, Landing-Seite als Ursache, Neustart von PocketBase bei geänderten Hooks (unter Windows kein automatischer Neustart).

## 2. Paket DP-1

| Teil | Inhalt | Manifest |
|---|---|---|
| Veröffentlichen | adapter-static nach `web/build`; `scripts/publish-web.mjs` im Root-`npm run build` (Reihenfolge, Umbenennen, Sperren unter Windows, `_app/builds.json`, 10 Builds, Übernahme des vorhandenen Stands, Aufräumen) | BYL-E6-480 |
| Server | Hook `static-cache.pb.js` mit `lib/static-cache.js` (`Cache-Control: no-cache` außer `/api/` und `/_/`); Integrationstest mit Last während fünf Veröffentlichungen | BYL-E6-481 |
| Fehlerseiten | `hooks.client.ts`, `lib/app-update.ts`, `+error.svelte` (einmal neu laden mit Schleifenschutz, „Neu laden“, „Zur Übersicht“, Tokens), `src/error.html` deutsch | BYL-E6-482 |
| Hinweis | `kit.version.pollInterval` 60 s, `AppUpdateNotice` im `(app)`-Layout, nächster Link als neues Dokument (`onNavigate`, nicht bei Eingaben, Sammelaktion oder „Rückgängig“) | BYL-E6-483 |
| Browser | offener Tab und Build im Live-Ordner; Fehlerseiten im Worktree | BYL-E6-484, BYL-E6-485 (manuell) |
| Doku | ADR-0040, dieser Plan, CLAUDE.md §2, §3, §7, §9, §11.6, README, Kommentare in `build.ps1` und `ci.yml` | – |

## 3. Nachweis nach der Umsetzung (Wegwerf-Instanz, Edge headless)

- Build und Veröffentlichen, während eine Schleife alle 20 ms eine Seite lud: 665 bzw. 680 Anfragen, alle 200, `index.html` fehlte nie.
- Offener Tab mit dem alten Build: Klicks auf „Projekte“ und „Wiederholungen“ nach dem Build ohne Neuladen und ohne Fehler; der Hinweis erschien nach 32 s (Abfrage je Minute), der nächste Link lud die neue Version als neues Dokument, danach war der Hinweis weg.
- Mit getipptem Tag-Namen im Ticket: Hinweis mit dem Satz zu ungespeicherten Eingaben; der Link öffnete „Änderungen verwerfen?“, der Text blieb, kein Neuladen.
- Fehlendes Modul ohne neue Version: einmal neu geladen, dann die deutsche Fehlerseite mit „Neu laden“; nach dem Zurücklegen lud „Neu laden“ die Ansicht.
- Fehlende Wurzel-Module beim ersten Aufbau: deutsche Notfallseite „becauseyoulovejira konnte nicht geladen werden“, „Neu laden“ funktioniert.

## 4. Betrieb

- Nach dem Merge im Live-Ordner `git pull --ff-only` und `scripts\build.ps1`: offene Tabs laufen weiter und zeigen den Hinweis. Der neue Hook wirkt erst nach einem Neustart der App mit `neu-starten.bat` (`status.bat` meldet bis dahin „Neustart nötig“, geänderte `pb_hooks`).
- Der erste Build mit dem neuen Verfahren übernimmt den vorhandenen Stand von `pb_public` als vorigen Build.

## 5. Entscheidungen und Befunde

| Datum | Befund bzw. Entscheidung |
|---|---|
| 2026-09-29 | Ursache belegt (ADR-0040 „Kontext“); Hypothesen (d) und (e) widerlegt. |
| 2026-09-29 | Austausch Datei für Datei statt Ordnertausch; `index.html` zuletzt; 10 Builds behalten. |
| 2026-09-29 | Beim Umbenennen von `index.html` kann eine Anfrage im selben Augenblick unter Windows einen 404 bekommen (rund 0,1 ms je Umbenennung, gemessen); keine Wiederholung im Hook (ADR-0040, Alternativen). |
| 2026-09-29 | Kein automatisches Neuladen der Notfallseite (keine Skripte dort, `handleError` ohne Nebenwirkung wegen Preloads); die Fehlerseite der App lädt einmal von selbst neu. |
