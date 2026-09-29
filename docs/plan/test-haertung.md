# Plan: Test-Härtung

- **Stand:** T-1 umgesetzt (Testkopien und Test-Server ohne Zugangsdaten). T-2 (instabile Tests) folgt in einem eigenen PR.
- **Grundlage:** [ADR-0018](../adr/0018-secrets.md) (Zugangsdaten als `BYL_*`-Variablen, Nachtrag), [ADR-0039](../adr/0039-betriebsskripte.md) (Steuerskript, Nachtrag „Testkopien ohne Zugangsdaten“), [ADR-0004](../adr/0004-teststrategie-hooks-migrationen.md) (Wegwerf-Instanzen); [CLAUDE.md](../../CLAUDE.md) §3, §11, §12.
- **Einordnung:** Auftrag vom 2026-09-29. Manifest-IDs ab `BYL-E6-500`, Paketkürzel `T`.

## 1. T-1: Kindprozesse der Tests ohne Zugangsdaten

**Befund:** Die Shell des Entwicklers (und ein CI-Runner) trägt die `BYL_*`-Variablen des Windows-Kontos. Der Harness nahm sie nur dem `serve` von PocketBase; `superuser upsert`, `migrate`, die Aufrufe von Windows PowerShell mit `byl-functions.ps1`, `Expand-Archive`, `byl-mail.exe`, Node und die Wegwerf-Kopien des Steuerskripts erbten sie. Die Kopien bekamen sie zusätzlich über `Sync-BylEnvironment`, das bei jedem Start aus dem Konto liest; eine Kopie mit `byl-mail.exe` hätte `BYL_INGEST_TOKEN` im Konto angelegt.

| Teil | Umsetzung |
|---|---|
| Zentraler Helfer | `tests/support/clean-env.mjs`: `cleanEnv` (eigene Umgebung ohne `BYL_*` in jeder Schreibweise und ohne `GH_TOKEN`, `GITHUB_TOKEN`, `NODE_AUTH_TOKEN`, `NPM_TOKEN`, dazu nur die ausdrücklichen Testwerte; einen geerbten Wert als „Testwert“ weiterzureichen, wirft), `spawnClean`, `spawnSyncClean` (Option `env` = nur Testwerte, `baseEnv` = andere Grundlage, etwa ohne Node), `visibleNames` (Test-Route, nur Namen). Weitere Zugangsdaten hat das Projekt nicht: alle heißen `BYL_*` (ADR-0018 §1). |
| Spawn-Stellen | Harness (`serve`, `superuser upsert`, `migrate`, `taskkill`), `runPowerShellJson`, `control-script.test.mjs` (Steuerskript, `superuser upsert`, Node), `backup-restore.test.mjs` (`Expand-Archive`), `mail-helper-process.test.mjs` (`byl-mail.exe` ohne Node), `admin-reset-logic.test.mjs` (Node), `publish-web.test.mjs` (PowerShell als Sperre). |
| Steuerskript | `Get-BylVariableScope` ist die einzige Stelle, die das Konto liest; mit `BYL_TEST_ISOLATED=1` gilt die eigene Prozessumgebung, und `Initialize-IngestToken` schreibt nichts (ADR-0039, Nachtrag). Nur der Test setzt die Variable. |
| Beleg | Test-Route `GET /api/byl-test/environment` (`tests/fixtures/pb_hooks/environment-probe.pb.js`, nur Superuser, nur Namen). Ein Server des Harness sieht eine im Testprozess gesetzte Prüfvariable und die `BYL_*` der Shell nicht, nur seine Testwerte; ein Node-Kind ebenso (Echo seiner Umgebung). Der Server einer Kopie sieht keinen `BYL_*`-Namen des Kontos oder des Testprozesses, nur `BYL_TEST_ISOLATED` und den Marker des Tests. Eine Kopie mit Platzhalter-`byl-mail.exe` startet keinen Hilfsprozess, hat keinen `BYL_INGEST_TOKEN`, und die Namen im Konto bleiben gleich. Lokal am 2026-09-29 mit drei `BYL_*` im Konto und zwei in der Shell. |
| Schutz vor Rückfall | Statisch: Außer `clean-env.mjs` nennt keine Code-Datei unter `tests/` und keine Testdatei von web, Mail-Hilfsprozess und Erweiterung `child_process` oder `process.binding` (`tests/unit/clean-env.test.mjs`); in `byl-control.ps1` greift nur `Get-BylVariableScope` lesend und `Initialize-IngestToken` nach dem Wächter auf Benutzer- oder Maschinenbereich zu, `byl-functions.ps1` nie (`tests/unit/start-scripts.test.mjs`). |

**Nebenbefund:** `healthy()` in `control-script.test.mjs` nutzte `fetch`. Nach `restart` nahm der Pool einen Keep-alive-Socket des alten Servers (`spawnSync` blockiert die Ereignisschleife während des ganzen Befehls, das Schließen des Sockets kam erst danach an): ECONNRESET, obwohl der neue Server antwortete, mit der neuen Prüfung 3 von 3 Läufen. Jetzt öffnet jede Prüfung eine neue Verbindung (`node:http`, `agent: false`).

| Datum | Paket | Befund bzw. Entscheidung |
|---|---|---|
| 2026-09-29 | T-1 | Umgebungsvariable statt Parameter von `byl-control.ps1`: Sie gehört zur Umgebung des Tests, erscheint nicht in `help` und bleibt mit der bereinigten Umgebung beisammen. Ein Prüfwert im Benutzerbereich hätte den Pfad über das Konto auch in der CI belegt, hätte aber auf dem Entwicklungsrechner ins Konto des Nutzers geschrieben; belegt wird er stattdessen über die Positivprobe (ohne Isolation entfernte `Sync-BylEnvironment` die Testwerte) und lokal über die echten Namen im Konto. |
