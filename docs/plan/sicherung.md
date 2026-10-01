# Plan Sicherung: Generationen, Zielverzeichnis, Prüfung, Wiederherstellen, Notfallplan

- **Stand:** umgesetzt: BK-1 (Generationen, Zielverzeichnis, Verschlüsselung mit age, Zugangsdaten, Seite „Sicherung“), BK-2 (Prüfung). Offen: BK-3 (Wiederherstellen), BK-4 (Notfallplan) und die manuellen Prüfungen im Test-Manifest.
- **Grundlage:**
  - [ADR-0046](../adr/0046-sicherung-pruefung-wiederherstellen.md) (Entscheidungen, Format, Sicherheitsmodell, Grenzen, Alternativen)
  - [ADR-0003](../adr/0003-pb-data-und-backups.md) (Nachtrag), [ADR-0018](../adr/0018-secrets.md), [ADR-0039](../adr/0039-betriebsskripte.md) und [ADR-0043](../adr/0043-system-seite.md) mit Nachträgen, [Plan System-Seite](system-seite.md), [Plan Test-Härtung](test-haertung.md)
  - [CLAUDE.md](../../CLAUDE.md) §5, §7, §9, §11, §12
- **Einordnung:** Nutzerentscheidungen vom 2026-10-01 („Lokale Speicherung und Backup (Verzeichnis auswählbar in Einstellungen)“, „Zugangsdaten mitsichern: Ja, bitte (auch Hinweis darauf, dass ENV)“, „Wiederherstellen aus der App: wenn möglich auch das, ja“). Nummern: ADR-0046, Manifest-IDs ab `BYL-E6-880`, Paketkürzel `BK`.

## 1. Querschnittsregeln

- **Nur Wegwerf-Kopien in Tests:** Das Steuerskript läuft nur gegen Kopien unter `.tmp\byl-*` des Worktrees, mit Superuser vorher, Zufallsport, bereinigter Umgebung (`tests/support/clean-env.mjs`) und `BYL_TEST_ISOLATED=1`. Die Kopie liest als „Zugangsdaten des Kontos“ nur erfundene Werte ihrer Prozessumgebung, legt ihre Passphrase nur in `BYL_TEST_SECRET_DIR` ab (nie unter `%LOCALAPPDATA%`) und sichert in ein Zielverzeichnis des Tests.
- **Geheimnisse:** Passphrase und Werte der `BYL_*`-Variablen gehen nur über die Standardeingabe (Route → Steuerskript → `byl-backup.exe`), nie über Befehlszeilen, Logs, Antworten oder Dateien im Klartext.
- **Gates:** je Paket ein Branch `feat/backup-…`, PR, `scripts\build.ps1` lokal grün, beide Pflicht-Checks, Squash-Merge; Test-Manifest und Doku im selben PR.

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| BK-1 | Hilfsprogramm `helpers/backup` (`byl-backup.exe`: age mit Passphrase über `age-encryption` 0.3.1, tar-Behälter, `seal`/`open`, Build-Kette wie `byl-mail.exe`), Migration `1790203000_backups_own_schedule.js` (Backup von PocketBase aus), Cron und Dienst (`backup.pb.js`, `lib/backup-service.js`, rein `lib/backup-rules.js`: Namen, GFS, Fälligkeit, Warnungen), Befehle `backup-info`, `backup-configure`, `backup-passphrase`, `backup-export` des Steuerskripts (DPAPI, Prüfung des Ziels, Zugangsdaten aus dem Konto), Routen mit dem Sicherheitsmodell von ADR-0043, Seite „Einstellungen → Sicherung“, Hinweis beim Öffnen, Doku | ab BYL-E6-880 |
| BK-2 | Prüfung: `byl-backup.exe check` (`PRAGMA integrity_check`, Zählungen, Dateien der Dateifelder in `storage`), `byl-control.ps1 backup-verify` (entschlüsseln, entpacken, Wegwerf-PocketBase ohne Hooks mit Wegwerf-Superuser auf Zufallsport, Health, Zählungen), wöchentlich im Cron, „Jetzt prüfen“ und „Prüfen“ je Sicherung (Passphrase einer älteren Sicherung unter ihr), Route `POST /api/byl/backup/verify`, Ergebnis auf der Seite, `backup-restore.test.mjs` mit Originaldateien | ab BYL-E6-900 |
| BK-3 | Wiederherstellen: `byl-control.ps1 restore` und `wiederherstellen.bat` (Auswahl, Passphrase, Prüfung, Sicherheitskopie, Rückfall), Zugangsdaten zurückschreiben (Isolation der Tests), losgelöster Lauf aus der App mit starker Bestätigung, frische Installation | folgt |
| BK-4 | Notfallplan: Hilfe „Sicherung & Notfall“, README, Notfallkarte, Hinweis `stop.bat` in „Sichern und umziehen“ | folgt |

## 3. Entscheidungen und Befunde

| Datum | Paket | Befund bzw. Entscheidung |
|---|---|---|
| 2026-10-01 | BK-1 | `$os.cmd(...).stdinPipe()` mit `write(toBytes(json))` und `close()` gibt einem Kindprozess Daten auf der Standardeingabe (Spike gegen eine Wegwerf-Instanz). Windows PowerShell liest `[Console]::In` in der Codepage der Konsole; das Steuerskript liest deshalb die Bytes und decodiert UTF-8 selbst (`Read-InputJson`), sonst kämen Umlaute einer Passphrase verändert an. |
| 2026-10-01 | BK-1 | `$app.createBackup(new Context(), name)` ist synchron (etwa 1 s für eine kleine Datenbank) und legt neben jeder Sicherung eine Datei `.attrs` an; gelistet und gelöscht wird deshalb über `$app.newBackupsFilesystem()` (`list`, `delete`), nicht über das Dateisystem. |
| 2026-10-01 | BK-1 | age mit `age-encryption` 0.3.1 in Node 24: 50 MB in etwa 1 s verschlüsselt und entschlüsselt, als Stream über `ReadableStream`; eine falsche Passphrase scheitert sofort („no identity matched“), ein veränderter Block erst beim Lesen. `open` liest deshalb immer bis zum Ende. |
| 2026-10-01 | BK-1 | Behälter tar statt ZIP: streamt in beide Richtungen, also keine Kopie im Klartext; geprüft gegen `tar.exe` von Windows (bsdtar) und GNU tar in beiden Richtungen. |
| 2026-10-01 | BK-1 | Kein Ordner-Dialog: Browser geben einer Seite keinen Pfad aus `showDirectoryPicker()` (nur einen Handle ohne Pfad). Der Pfad wird eingetippt oder eingefügt; das Steuerskript prüft ihn. |
| 2026-10-01 | BK-1 | Freier Platz auch für Freigaben über `GetDiskFreeSpaceEx` (`DriveInfo` kennt keine UNC-Pfade). |
| 2026-10-01 | BK-1 | Eine Sicherung am Tag statt alle vier Stunden (Generationen in Tagen, Kopie je Sicherung ins Ziel); „Jetzt sichern“ für vorher. Die bisherigen automatischen Sicherungen bleiben liegen und werden nicht gelöscht. |
| 2026-10-01 | BK-1 | Die Seite prüft ihre Formulare selbst (`novalidate`): Fehler stehen am Feld (ADR-0009), nicht in Blasen des Browsers. |
| 2026-10-01 | BK-2 | `PRAGMA integrity_check` und die Dateien der Dateifelder prüft `byl-backup.exe check` mit `node:sqlite` (SQLite 3.53 in Node 24, ohne weitere Abhängigkeit); Windows PowerShell hat kein SQLite, und PocketBase selbst prüft die Integrität beim Start nicht. |
| 2026-10-01 | BK-2 | Die Wegwerf-PocketBase startet ohne Hooks (leerer Ordner), aber mit den Migrationen der App: Eine ältere Sicherung kommt in der Kopie auf den Stand, und nichts läuft mit den Zugangsdaten eines Kanals. Ihr Superuser entsteht vorher über `Get-AdminUpsertArgument`, die einzige Stelle, die einen Superuser-Befehl baut. |
| 2026-10-01 | BK-2 | Die Routen erlauben zehn Änderungen je Minute; der Integrationstest der Sicherung braucht mehr und wartet bei 429 die Zeit aus `Retry-After` ab (`appChange`), statt die Grenze für Tests zu lockern. |
