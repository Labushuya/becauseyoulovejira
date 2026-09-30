# Plan System-Seite: Betrieb aus dem Dashboard

- **Stand:** umgesetzt: SY-1 (Seite „Einstellungen → System“, Routen, Befehle des Steuerskripts, Tests, Doku). Offen sind die manuellen Prüfungen im Test-Manifest (BYL-E6-650 bis BYL-E6-656).
- **Grundlage:**
  - [ADR-0043](../adr/0043-system-seite.md) (Entscheidungen, Recherche, Sicherheitsmodell, Grenzen, Alternativen)
  - [ADR-0039](../adr/0039-betriebsskripte.md) mit Nachtrag SY-1 (neue Befehle und Schalter des Steuerskripts), [Plan Betriebsskripte](betriebsskripte.md), [Plan Test-Härtung](test-haertung.md)
  - [ADR-0040](../adr/0040-veroeffentlichen-ohne-unterbrechung.md) (Hinweis auf ungespeicherte Eingaben), [ADR-0035](../adr/0035-start-einstieg-und-offene-tabs.md) §4, [ADR-0038](../adr/0038-eigener-eingang-und-whatsapp-web.md) §2, [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md), [ADR-0009](../adr/0009-fehlerfarbe.md)
  - [CLAUDE.md](../../CLAUDE.md) §5, §7, §9, §11, §12
- **Einordnung:** Nutzerwunsch vom 2026-09-30 („Einpflegen von Triggern von .bat Dateien per Einstellungen? … da alles aus Dashboard heraus“), Spec des Advisors vom Nutzer freigegeben („ja, ohne Beenden“). Nummern: ADR-0043, Manifest-IDs ab `BYL-E6-640`, Paketkürzel `SY`.

## 1. Querschnittsregeln

- **Nur feste Befehle:** Die Routen kennen sieben Namen mit festen Argumenten (`lib/system-rules.js`); nichts aus einer Anfrage erreicht die Befehlszeile, es gibt keine Shell. Kein „Beenden“.
- **Nur Wegwerf-Kopien in Tests:** Das Steuerskript läuft in Tests nur gegen Kopien der Laufzeitteile unter `.tmp\byl-*` des Worktrees, mit Superuser vorher, Zufallsport (nie 8090, 8091 oder 8099), bereinigter Umgebung (`tests/support/clean-env.mjs`) und `BYL_TEST_ISOLATED=1`; der Autostart geht in einen Ordner des Tests (`BYL_TEST_STARTUP_DIR`), der Mail-Helfer auf einen Zufallsport (`BYL_MAIL_HELPER_PORT`). Nie gegen `app\` eines Klons, nie gegen Port 8090.
- **Gates:** Branch `feat/system-page`, PR, `scripts\build.ps1` lokal grün, beide Pflicht-Checks, Squash-Merge; Test-Manifest und Doku im selben PR.

## 2. Paket

| Paket | Inhalt | Manifest |
|---|---|---|
| SY-1 | Steuerskript: `mail-restart`, `restart -Detach` mit `-WaitForProcess`, `logs -Json` ohne Werte der Variablen (`Protect-LogText`), JSON als UTF-8 (`Write-JsonLine`), Autostart-Ordner der Testkopien (`Get-StartupFolder`). Hooks: `system.pb.js` mit `lib/system-service.js` und den reinen Regeln `lib/system-rules.js` (Whitelist, Windows, dieser Rechner, Host und Origin, Besitzer, Rate-Limit, eigene Instanz, eine Aktion zur Zeit, Audit, Logs bereinigen). SPA: `data/system.ts`, `domain/system.ts`, `stores/system.svelte.ts`, `components/system/*`, Seite `/einstellungen/system`, Navigation nur für Windows, Hilfe „Betrieb“. ADR-0043, Nachtrag ADR-0039, dieser Plan, README, CLAUDE.md | BYL-E6-640 bis BYL-E6-648, manuell BYL-E6-650 bis BYL-E6-656 |

## 3. Entscheidungen und Befunde

| Datum | Paket | Befund bzw. Entscheidung |
|---|---|---|
| 2026-09-30 | SY-1 | `$os.cmd` ist Go's `exec.Command` (`types.d.ts` von 0.40.4). Ausgabe lesen: `stdoutPipe()`, `start()`, `toString(reader, max)`, `wait()`; der Exit-Code steht nach `wait()` in `processState.exitCode()`, auch wenn `wait()` für 3, 5 oder 6 wirft. Im Spike lieferte eine Route das JSON von `status -Json`. |
| 2026-09-30 | SY-1 | Losgelöster Neustart im Spike (Wegwerf-Kopie): Aufrufer nach 480 ms zurück, die losgelöste PowerShell überlebte das Ende des Servers und startete den neuen (Elternprozess = sie), `/api/health` 2,6 s bis 6,3 s weg, Neustart 7,9 s, geordnet (keine Warnung „hart beendet“). Ein direktes Kind von `$os.cmd` hinge an der Konsole von PocketBase und bekäme das Konsolensignal mit; deshalb `Start-Process` ohne Umleitung (eigene Konsole) und `-WaitForProcess`. |
| 2026-09-30 | SY-1 | Befehle, die Prozesse starten (`restart`, `mail-restart`), lesen keine Ausgabe: Ein mit Umleitung gestarteter `byl-mail.exe` erbte die Pipe, und das Lesen endete erst mit ihm (ADR-0039, Grenzen). Die Route liest danach `status -Json`. |
| 2026-09-30 | SY-1 | `-Json` kam in der Codepage der Konsole; Umlaute der Prüfungen kamen falsch an. `Write-JsonLine` schreibt umgeleitet UTF-8 ohne BOM. |
| 2026-09-30 | SY-1 | PowerShell unterscheidet bei Variablen keine Groß- und Kleinschreibung: ein lokales `$lines` überschrieb den Parameter `$Lines` (zweite Datei: „System.Object[] kann nicht in Int32 konvertiert werden“). Lokal heißt die Variable jetzt `$tail`. |
| 2026-09-30 | SY-1 | Besitzer der Instanz ist das zuerst angelegte App-Konto (ADR-0043 §3): ohne Migration und ohne Feld, das ein Nutzer ändern könnte; E7 kann es durch ein ausdrückliches Recht ersetzen. |
| 2026-09-30 | SY-1 | Ein Knopf „Jetzt neu starten“ statt zwei („jetzt“ und „nur wenn nötig“): Die Seite zeigt den Stand, der Knopf ist bei nötigem Neustart der Hauptknopf und nennt den Grund; `neu-starten.bat` bleibt für „nur wenn nötig“. |
| 2026-09-30 | SY-1 | Ohne eigenen Port hätte der Mail-Helfer einer Testkopie den Port 8091 des Helfers des Nutzers belegt oder dort geantwortet. Der Test setzt `BYL_MAIL_HELPER_PORT` auf einen Zufallsport; sein Postfach nennt eine nicht gesetzte Variable, der Helfer verbindet sich also mit keinem Mailserver. |
| 2026-09-30 | SY-1 | Die Autostart-Verknüpfung des Nutzers darf kein Test ändern: isolierte Kopien nehmen nur `BYL_TEST_STARTUP_DIR`; der Test vergleicht die Verknüpfung im Autostart-Ordner des Kontos vorher und nachher (nur lesend). |
| 2026-09-30 | SY-1 | Die statische Prüfung `no-own-notices.test.ts` sieht jedes `.notice` in Komponenten als lokale Hinweis-Klasse; die Felder der Seite heißen deshalb `message`. |
