# ADR-0003: Speicherort von `pb_data` und Backup-Strategie

- **Status:** Angenommen; §2, §4 und §6 ersetzt durch [ADR-0046](0046-sicherung-pruefung-wiederherstellen.md) (Nachträge unten)
- **Datum:** 2026-09-24
- **Entscheidung durch:** Advisor

## Kontext

CLAUDE.md §1 und §9 verlangen: Die komplette Installation ist der Ordner `app/`, Sicherung und Umzug erfolgen per Ordnerkopie, und Backups laufen über die eingebaute PocketBase-Funktion. Zu entscheiden sind der Ablageort der Daten, der Backup-Zeitplan und das Vorgehen bei der Wiederherstellung.

Befunde für PocketBase 0.40.4 (Quelltext `core/backup*.go`, `core/settings_model.go`, `tools/cron/cron.go`, Tag `v0.40.4`; Standardwerte per Wegwerf-Migration am 2026-09-24 ausgelesen):

- Die Settings enthalten `backups.cron` (Cron-Ausdruck, leer = aus), `backups.cronMaxKeep` (Standard `3`, nur für automatische Backups) und `backups.s3`. Der Standard ist `{"cron":"","cronMaxKeep":3,…}`, automatische Backups sind also **aus**.
- Automatische Backups laufen als Cron-Job `__pbAutoBackup__` auf `app.Cron()`. Dessen Zeitzone ist standardmäßig **UTC**.
- Ein Backup ist ein ZIP von `pb_data`. `data.db` und `auxiliary.db` werden per `VACUUM INTO` konsistent kopiert, das Backup ist also im laufenden Betrieb sicher. Der Ordner `pb_data/backups` selbst ist ausgenommen.
- **Wiederherstellen über das Admin-UI ist unter Windows nicht unterstützt** (`backup_restore.go`: `"restore is not supported on Windows"`). Die Wiederherstellung muss manuell erfolgen.
- Settings lassen sich in JS-Migrationen per `app.settings()` / `app.save(settings)` setzen.

## Entscheidung

1. **`pb_data` liegt in `app/pb_data`.** `start-hidden.vbs` übergibt den Pfad absolut, abgeleitet vom Skriptverzeichnis (`--dir=<app>\pb_data`). Keine Ablage unter `%APPDATA%` oder anderswo außerhalb von `app/`. `pb_data/` bleibt gitignored.
2. **Automatische Backups per Migration aktiviert:** Eine E1-Migration setzt `backups.cron = "0 */4 * * *"` (alle vier Stunden zur vollen Stunde in UTC, bei laufendem Server) und `backups.cronMaxKeep = 12`. Weil der Rechner nicht durchgehend läuft, reichen zwölf Backups je nach Nutzung von zwei Tagen Dauerbetrieb bis zu mehreren Wochen gelegentlicher Nutzung. Die Rollback-Funktion der Migration setzt die Standardwerte (`""`, `3`) zurück. Der Nutzer kann die Werte später im Admin-UI ändern; die Migration läuft nur einmal und überschreibt sie danach nicht.
3. **Manuelle Backups** jederzeit im Admin-UI (Settings → Backups), zum Beispiel vor Updates.
4. **Wiederherstellung (Windows, manuell) wird in der README dokumentiert und getestet:**
   1. `stop.bat` ausführen.
   2. `app\pb_data` in `app\pb_data.vor-restore-<Datum>` umbenennen.
   3. Neuen Ordner `app\pb_data` anlegen und das Backup-ZIP (aus dem umbenannten `pb_data\backups\`) hinein entpacken.
   4. Den Ordner `backups` aus dem umbenannten Ordner zurück nach `app\pb_data\backups` kopieren, damit ältere Backups erhalten bleiben.
   5. `start.bat` ausführen.
5. **Umzug:** PocketBase stoppen, `app/` komplett kopieren. Backups liegen in `app/pb_data/backups` und wandern mit.
6. **Sicherung außerhalb des Rechners** (externe Platte, Cloud-Ordner) liegt in der Verantwortung des Nutzers. Die README empfiehlt, `app\pb_data\backups` regelmäßig woandershin zu kopieren. S3-Backups werden nicht konfiguriert (CLAUDE.md §10: keine externen Integrationen).
7. **Keine Settings-Verschlüsselung (`--encryptionEnv`):** Die Settings enthalten keine Geheimnisse (kein SMTP, kein S3), und ein Schlüssel in einer Umgebungsvariable würde die Portabilität per Ordnerkopie brechen.

## Alternativen

- **`pb_data` unter `%APPDATA%\becauseyoulovejira`:** Programm und Daten wären getrennt, aber der Umzug per Ordnerkopie wäre nicht mehr vollständig, und die Skripte bräuchten Pfadlogik. Verworfen.
- **Nur manuelle Backups:** hängt von Disziplin ab. Verworfen.
- **Tägliches Backup zu fester Uhrzeit:** Läuft der Rechner zu dieser Uhrzeit nicht, entfällt das Backup. Verworfen zugunsten des Vier-Stunden-Rasters.
- **Eigenes Backup-Skript per `sqlite3 .backup` oder Ordnerkopie:** Die eingebaute Funktion ist konsistent und gepflegt. Verworfen.
- **Wiederherstellungs-Skript (`scripts/restore-backup.ps1`):** wäre bequemer, aber ein Skript, das `pb_data` umbenennt, ist riskant und muss selbst getestet werden. Zunächst nur eine dokumentierte Anleitung; ein Skript nur auf Wunsch (siehe E1-Plan, offene Fragen).

## Konsequenzen

- Positiv: `app/` ist vollständig portabel, Backups entstehen automatisch und sind im laufenden Betrieb konsistent.
- Negativ: Backups liegen standardmäßig auf demselben Datenträger wie die Daten. Das schützt vor Bedienfehlern, nicht vor Hardwaredefekten. Deshalb der README-Hinweis zur externen Kopie.
- Negativ: Wiederherstellen unter Windows geht nur manuell bei gestopptem Server.
- `app/` wächst um bis zu zwölf ZIP-Backups. Bei einer Ticket-Datenbank sind das wenige MB.
- Die Cron-Zeiten gelten in UTC. Für ein Raster „alle vier Stunden“ spielt das keine Rolle. Zeitkritische Cron-Jobs (wiederkehrende Aufgaben, E4) berücksichtigen [ADR-0005](0005-zeitzone-europe-berlin.md).

## Nachtrag (2026-10-01, [ADR-0046](0046-sicherung-pruefung-wiederherstellen.md), BK-1): Die App sichert selbst, mit Generationen und verschlüsselt außer Haus

- **§2 ist ersetzt:** Die App sichert einmal am Tag selbst (Cron `byl-backup`, `lib/backup-service.js`, Name `byl-<Zeitstempel>.zip`) und behält Generationen (7 täglich, 4 wöchentlich, 6 monatlich, änderbar). Die Migration `1790203000_backups_own_schedule.js` schaltet das automatische Backup von PocketBase ab, solange es noch den Zeitplan dieser ADR hat; ihr Rückweg stellt ihn wieder her. Die bisherigen `@auto_pb_backup_*`-Dateien bleiben liegen, bis sie in der Verwaltung gelöscht werden.
- **§6 ist ersetzt:** Eine Kopie außer Haus macht die App selbst, verschlüsselt (age mit Passphrase) in ein frei wählbares Zielverzeichnis, auf Wunsch mit den Werten der `BYL_*`-Variablen (Einstellungen → Sicherung).
- **§4 (Wiederherstellen):** Die Schritte von Hand bleiben gültig, bis das Wiederherstellen per Skript und App kommt (ADR-0046 §7, Paket BK-3); danach ersetzt es sie.
- §1, §3, §5 und §7 gelten weiter. Die Konsequenz „Backups liegen auf demselben Datenträger“ gilt nur noch ohne Zielverzeichnis.

## Nachtrag (2026-10-01, [ADR-0046](0046-sicherung-pruefung-wiederherstellen.md), BK-3): Wiederherstellen per Skript und App

- **§4 ist ersetzt:** Wiederhergestellt wird mit `wiederherstellen.bat` (bzw. `byl-control.ps1 restore`) oder aus der App unter Einstellungen → Sicherung: erst geprüft (ADR-0046 §6), dann mit Sicherheitskopie `pb_data.vor-wiederherstellung-<Zeit>` des bisherigen Ordners, die die App nach sieben Tagen entfernt, und mit Rückweg, wenn die App danach nicht startet (ADR-0046 §7). Die Schritte von Hand in der README bleiben als Rückfall beschrieben; den Weg über die Verwaltung unterstützt PocketBase unter Windows weiter nicht.
