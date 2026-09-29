# Plan Betriebsskripte: ein Steuerskript für Start, Stopp, Neustart, Status und Port

- **Stand:** umgesetzt: BS-1 (#170, Kern, Port, geordnetes Beenden), BS-2 (#172, Fingerabdruck, `reload`, `status`, `open`, `logs`, `doctor`), BS-3 (Doppelklick-Dateien, Texte, Hilfe). Offen sind die manuellen Prüfungen im Test-Manifest (BYL-E6-445 bis BYL-E6-447, BYL-E6-451, BYL-E6-452, BYL-E6-455 bis BYL-E6-459).
- **Grundlage:**
  - [ADR-0039](../adr/0039-betriebsskripte.md) (Entscheidungen, Recherche, Grenzen, Alternativen)
  - [ADR-0035](../adr/0035-start-einstieg-und-offene-tabs.md) §1 und §7 (Landing-Seite, Tab-Wiederverwendung; Nachtrag), [ADR-0016](../adr/0016-kanal-architektur-und-mail.md) §5, [ADR-0018](../adr/0018-secrets.md) §6, [ADR-0038](../adr/0038-eigener-eingang-und-whatsapp-web.md)
  - [ADR-0028](../adr/0028-plattform-strategie.md) und [Plan Plattformen](plattformen.md): zurückgestellt, hier wird nichts davon umgesetzt
  - [CLAUDE.md](../../CLAUDE.md) §1, §3, §9, §11, §12
- **Einordnung:** Nutzerwunsch vom 2026-09-29 („richtig professionell mit bereits laufender Server-Erkennung und Port, sowie intelligentem Reload, Herunterfahren“), Ziele und Teilpakete vom Advisor. Nummern: ADR-0039, Manifest-IDs ab `BYL-E6-440`, Paketkürzel `BS`.

## 1. Querschnittsregeln

- **Ausführen nur gegen Wegwerf-Kopien:** `byl-control.ps1` läuft in Tests (`tests/integration/control-script.test.mjs`) und bei Agenten nur in Kopien der Laufzeitteile unter `.tmp\byl-ctl-*` des Worktrees, je mit Wegwerf-Superuser (vor `serve`, CLAUDE.md §11.2), Zufallsport (nie 8090 oder 8099) und `-NoBrowser`. Nie gegen `app\` eines Klons oder die laufende Instanz des Nutzers. Jeder gestartete Server wird im `afterAll` beendet, die Kopien werden gelöscht. Seit T-1 immer mit bereinigter Umgebung und `BYL_TEST_ISOLATED=1`, damit keine Kopie Zugangsdaten des Kontos sieht ([Plan Test-Härtung](test-haertung.md)).
- Reine Logik in `app\byl-functions.ps1` (ASCII, Eingaben als Parameter), Unit-Tests über `runPowerShellJson`; Texte in `byl-control.ps1` (UTF-8 mit BOM). Neue Windows-Tests stehen in `WINDOWS_ONLY` von `vitest.config.mjs`.
- `.bat`, `.vbs` und `.ps1` mit CRLF (`.gitattributes`), `.bat`/`.vbs`/`byl-functions.ps1` nur ASCII.
- Keine neue Abhängigkeit, keine Secrets in Dateien oder Logs.
- **Gates je Paket:** eigener Branch und PR; `scripts\build.ps1` lokal grün (Exit 0 und „Build complete!“); CI grün (beide Pflicht-Checks); Squash-Merge; Test-Manifest und Doku im selben PR.

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| BS-1 | Befehle `start`, `stop`, `restart`, `port`, `help` mit Exit-Codes; Port in `byl-config.json`, `Set-BylAddress`, `run\app-adresse.js` für die Landing-Seite; Erkennung über Programmpfad und Zustandsdatei `run\byl.state.json`; idempotenter Start mit Fortschritt; geordnetes Beenden per `CTRL_BREAK_EVENT`, danach hart mit Warnung; Wrapper auf die neuen Befehle; ADR-0039, dieser Plan, README, CLAUDE.md, Nachtrag ADR-0035 | BYL-E6-440 bis BYL-E6-444, manuell BYL-E6-445 bis BYL-E6-447 |
| BS-2 | Start-Fingerabdruck in der Zustandsdatei, `reload`, `status` (mit `-Json`, Exit 3 und 6), `open`, `logs` (Rotation, `byl-control.log`, `-Follow`), `doctor` (mit `-Json`), Hinweise vor dem Kaltstart (Platz, andere Kopien); Korrektur der Mail-Helfer-Erkennung aus BS-1 | BYL-E6-448 bis BYL-E6-450, manuell BYL-E6-451 und BYL-E6-452 |
| BS-3 | `neu-starten.bat`, `status.bat`; Autostart ersetzt eine Verknüpfung eines anderen Ordners, `reload` ohne Neustart startet einen fehlenden Mail-Hilfsprozess; alle Neustart-Hinweise in Hooks, Oberfläche, Hilfe, Mail-Hilfsprozess, Erweiterung und `build-mail-helper.ps1` auf `neu-starten.bat` (außer dem abgelaufenen Einrichtungslink); Hinweis „wurde beendet.“ ohne „(stop.bat)“; Hilfe „Betrieb“; README und CLAUDE.md | BYL-E6-453 und BYL-E6-454, manuell BYL-E6-455 bis BYL-E6-459 |

## 3. Entscheidungen und Befunde

| Datum | Paket | Befund bzw. Entscheidung |
|---|---|---|
| 2026-09-29 | BS-1 | Port nur in `app\byl-config.json` statt `BYL_PORT` (wandert mit dem Ordner, je Installation, testbar); kein stilles Ausweichen, Meldung mit nächstem freiem Port und Befehl (ADR-0039 §2). |
| 2026-09-29 | BS-1 | Geordnetes Beenden: PocketBase fängt `os.Interrupt` ab (`Execute()` in 0.40.4) und schließt die Datenbank; `CTRL_C_EVENT` kam im Spike nicht an (geerbtes Ignorieren), `CTRL_BREAK_EVENT` sofort: Exit 0, `data.db-wal` weg. |
| 2026-09-29 | BS-1 | Der Sender muss seinen Handler **nach** `AttachConsole` registrieren; vorher beendete er sich selbst mit `STATUS_CONTROL_C_EXIT`, der Stopp hielt das für „nicht gesendet“ und beendete PocketBase sofort hart. Behoben, im Integrationstest belegt. |
| 2026-09-29 | BS-1 | `Start-Process` vererbt alle vererbbaren Handles; eine mitgeschnittene Ausgabe endet erst mit dem Server. Die Standard-Handles zurückzusetzen hilft nicht; dokumentiert als Grenze (ADR-0039), der Test leitet in eine Datei. |
| 2026-09-29 | BS-1 | Unter `%TEMP%` schaltet PocketBase in den Dev-Modus (SQL-Log mit dem Installer-Konto, falscher Erststart). Testkopien liegen deshalb unter `.tmp\` des Repos. |
| 2026-09-29 | BS-1 | `-is [pscustomobject]` ist in PowerShell für jedes umhüllte Objekt wahr (auch ein JSON-Array); neue Prüfungen nutzen den vollen Typnamen. |
| 2026-09-29 | BS-1, korrigiert in BS-2 | Ein laufender Mail-Hilfsprozess, den `build-mail-helper.ps1` in `byl-mail.exe.old-<Zeit>` umbenannt hat, zählt weiter als eigener. BS-1 erkannte dafür zusätzlich den Namen `.old-*`; am Live-Rechner (nur lesend) zeigte sich, dass Windows den Pfad vom Start meldet (`byl-mail.exe`). BS-2 entfernt die überflüssige Namensregel. |
| 2026-09-29 | BS-2 | Fingerabdruck ohne gespeicherte Werte: Ein Hash nur der Namen hätte einen neuen Wert (Telegram-Chat-IDs nach `setx`) übersehen, und `neu-starten.bat` hätte „kein Neustart nötig“ gesagt. Deshalb HMAC-SHA256 über „Name=Wert“ mit einem Zufallsschlüssel je Start, der nur DPAPI-verschlüsselt (Windows-Konto) in der Zustandsdatei liegt. Große Dateien (`pocketbase.exe`, `byl-mail.exe`) nur mit Länge und Änderungszeit, Migrationen und Hooks mit SHA-256 über Namen und Inhalt. `reload` lässt eine gerade startende Instanz ohne `-Force` in Ruhe. `status` und `logs` schreiben nicht in `byl-control.log`. |
| 2026-09-29 | BS-2 | Ein Integrationsfall mit zwei Neustarts brauchte auf dem Windows-Runner mehr als die 15 s des Integrationsprojekts; die Skriptfälle haben 120 s. Parallel wurde PR #171 (andere Sitzung, Spaltenbreite) gemergt; der Konflikt in der Meta-Zeile des Manifests wurde per Merge von `main` gelöst. |
| 2026-09-29 | BS-3 | Der abgelaufene Einrichtungslink bleibt bei „`stop.bat`, dann `start.bat`“: Die App ist dann aktuell, `neu-starten.bat` startete nicht neu. Alle anderen Neustart-Hinweise nennen `neu-starten.bat`. Der Hinweis im Tab heißt „wurde beendet.“, weil ihn auch ein Neustart auslöst. Manifest-IDs 453 bis 459, weil ab 460 die Spaltenbreite (#171) belegt. |
| 2026-09-29 | T-1 ([Plan Test-Härtung](test-haertung.md)) | Die Testkopien erbten die `BYL_*`-Variablen des Kontos, auch über `Sync-BylEnvironment`, das sie bei jedem Start aus dem Konto nachlädt. Jetzt liest nur `Get-BylVariableScope` das Konto; mit `BYL_TEST_ISOLATED=1` (nur der Test, mit bereinigter Umgebung) nimmt das Skript die eigene Prozessumgebung und schreibt nichts ins Konto (Nachtrag in ADR-0039). Nebenbei: `healthy()` im Test nutzt je Prüfung eine neue Verbindung; `fetch` erwischte nach `restart` einen Keep-alive-Socket des alten Servers (ECONNRESET, 3 von 3 Läufen mit der neuen Prüfung). |
