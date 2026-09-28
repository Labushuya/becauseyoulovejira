# Plan Betriebsskripte: ein Steuerskript für Start, Stopp, Neustart, Status und Port

- **Stand:** BS-1 umgesetzt (Kern, Port, geordnetes Beenden); BS-2 und BS-3 folgen. Offen sind die manuellen Prüfungen im Test-Manifest.
- **Grundlage:**
  - [ADR-0039](../adr/0039-betriebsskripte.md) (Entscheidungen, Recherche, Grenzen, Alternativen)
  - [ADR-0035](../adr/0035-start-einstieg-und-offene-tabs.md) §1 und §7 (Landing-Seite, Tab-Wiederverwendung; Nachtrag), [ADR-0016](../adr/0016-kanal-architektur-und-mail.md) §5, [ADR-0018](../adr/0018-secrets.md) §6, [ADR-0038](../adr/0038-eigener-eingang-und-whatsapp-web.md)
  - [ADR-0028](../adr/0028-plattform-strategie.md) und [Plan Plattformen](plattformen.md): zurückgestellt, hier wird nichts davon umgesetzt
  - [CLAUDE.md](../../CLAUDE.md) §1, §3, §9, §11, §12
- **Einordnung:** Nutzerwunsch vom 2026-09-29 („richtig professionell mit bereits laufender Server-Erkennung und Port, sowie intelligentem Reload, Herunterfahren“), Ziele und Teilpakete vom Advisor. Nummern: ADR-0039, Manifest-IDs ab `BYL-E6-440`, Paketkürzel `BS`.

## 1. Querschnittsregeln

- **Ausführen nur gegen Wegwerf-Kopien:** `byl-control.ps1` läuft in Tests (`tests/integration/control-script.test.mjs`) und bei Agenten nur in Kopien der Laufzeitteile unter `.tmp\byl-ctl-*` des Worktrees, je mit Wegwerf-Superuser (vor `serve`, CLAUDE.md §11.2), Zufallsport (nie 8090 oder 8099) und `-NoBrowser`. Nie gegen `app\` eines Klons oder die laufende Instanz des Nutzers. Jeder gestartete Server wird im `afterAll` beendet, die Kopien werden gelöscht.
- Reine Logik in `app\byl-functions.ps1` (ASCII, Eingaben als Parameter), Unit-Tests über `runPowerShellJson`; Texte in `byl-control.ps1` (UTF-8 mit BOM). Neue Windows-Tests stehen in `WINDOWS_ONLY` von `vitest.config.mjs`.
- `.bat`, `.vbs` und `.ps1` mit CRLF (`.gitattributes`), `.bat`/`.vbs`/`byl-functions.ps1` nur ASCII.
- Keine neue Abhängigkeit, keine Secrets in Dateien oder Logs.
- **Gates je Paket:** eigener Branch und PR; `scripts\build.ps1` lokal grün (Exit 0 und „Build complete!“); CI grün (beide Pflicht-Checks); Squash-Merge; Test-Manifest und Doku im selben PR.

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| BS-1 | Befehle `start`, `stop`, `restart`, `port`, `help` mit Exit-Codes; Port in `byl-config.json`, `Set-BylAddress`, `run\app-adresse.js` für die Landing-Seite; Erkennung über Programmpfad und Zustandsdatei `run\byl.state.json`; idempotenter Start mit Fortschritt; geordnetes Beenden per `CTRL_BREAK_EVENT`, danach hart mit Warnung; Mail-Hilfsprozess auch als `byl-mail.exe.old-*`; Wrapper auf die neuen Befehle; ADR-0039, dieser Plan, README, CLAUDE.md, Nachtrag ADR-0035 | BYL-E6-440 bis BYL-E6-444, manuell BYL-E6-445 bis BYL-E6-447 |
| BS-2 | Start-Fingerabdruck in der Zustandsdatei, `reload`, `status` (mit `-Json`, Exit 3 und 6), `open`, `logs` (Rotation, `byl-control.log`, `-Follow`), `doctor` (mit `-Json`), Prüfungen vor dem Kaltstart | ab BYL-E6-448 |
| BS-3 | `neu-starten.bat`, `status.bat`; Autostart und Admin-Reset mit derselben Logik; alle Neustart-Hinweise in Hooks, Oberfläche, Hilfe, Mail-Hilfsprozess und Erweiterung auf `neu-starten.bat`; Hilfe „Betrieb“; README und CLAUDE.md fertig | danach |

## 3. Entscheidungen und Befunde

| Datum | Paket | Befund bzw. Entscheidung |
|---|---|---|
| 2026-09-29 | BS-1 | Port nur in `app\byl-config.json` statt `BYL_PORT` (wandert mit dem Ordner, je Installation, testbar); kein stilles Ausweichen, Meldung mit nächstem freiem Port und Befehl (ADR-0039 §2). |
| 2026-09-29 | BS-1 | Geordnetes Beenden: PocketBase fängt `os.Interrupt` ab (`Execute()` in 0.40.4) und schließt die Datenbank; `CTRL_C_EVENT` kam im Spike nicht an (geerbtes Ignorieren), `CTRL_BREAK_EVENT` sofort: Exit 0, `data.db-wal` weg. |
| 2026-09-29 | BS-1 | Der Sender muss seinen Handler **nach** `AttachConsole` registrieren; vorher beendete er sich selbst mit `STATUS_CONTROL_C_EXIT`, der Stopp hielt das für „nicht gesendet“ und beendete PocketBase sofort hart. Behoben, im Integrationstest belegt. |
| 2026-09-29 | BS-1 | `Start-Process` vererbt alle vererbbaren Handles; eine mitgeschnittene Ausgabe endet erst mit dem Server. Die Standard-Handles zurückzusetzen hilft nicht; dokumentiert als Grenze (ADR-0039), der Test leitet in eine Datei. |
| 2026-09-29 | BS-1 | Unter `%TEMP%` schaltet PocketBase in den Dev-Modus (SQL-Log mit dem Installer-Konto, falscher Erststart). Testkopien liegen deshalb unter `.tmp\` des Repos. |
| 2026-09-29 | BS-1 | `-is [pscustomobject]` ist in PowerShell für jedes umhüllte Objekt wahr (auch ein JSON-Array); neue Prüfungen nutzen den vollen Typnamen. |
| 2026-09-29 | BS-1 | Ein laufender Mail-Hilfsprozess, den `build-mail-helper.ps1` in `byl-mail.exe.old-<Zeit>` umbenannt hat, zählt weiter als eigener (sonst bliebe er nach einem Update beim Stopp stehen). |
