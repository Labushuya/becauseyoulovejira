# ADR-0046: Sicherung, Prüfung und Wiederherstellen – Generationen, verschlüsseltes Zielverzeichnis (age), Zugangsdaten, Prüfung, Wiederherstellen per Skript und App, Notfallplan

- **Status:** Angenommen. Umgesetzt: BK-1 (Generationen, Zielverzeichnis, Verschlüsselung, Zugangsdaten, Seite „Sicherung“). Geplant nach [docs/plan/sicherung.md](../plan/sicherung.md): BK-2 (Prüfung), BK-3 (Wiederherstellen), BK-4 (Notfallplan).
- **Datum:** 2026-10-01
- **Entscheidung durch:** Nutzer (Entscheidungen vom 2026-10-01: „Lokale Speicherung und Backup (Verzeichnis auswählbar in Einstellungen)“, „Zugangsdaten mitsichern: Ja, bitte (auch Hinweis darauf, dass ENV)“, „Wiederherstellen aus der App: wenn möglich auch das, ja“), Advisor (Stufen, Generationen, Format age, Sicherheitsmodell, Pakete), Executor (Recherche, Container, Umsetzung, Einzelheiten)
- **Ersetzt:** [ADR-0003](0003-pb-data-und-backups.md) §2 (automatische Backups von PocketBase) und §6 (Kopie außer Haus als Sache des Nutzers); ADR-0003 §1, §3, §5 und §7 gelten weiter (Nachtrag dort).
- **Ergänzt:** [ADR-0039](0039-betriebsskripte.md) und [ADR-0043](0043-system-seite.md) (Nachträge dort), [ADR-0018](0018-secrets.md) (die Werte der `BYL_*`-Variablen dürfen verschlüsselt in eine Sicherung)
- **Bezug:** [ADR-0005](0005-zeitzone-europe-berlin.md) (Berliner Kalendertage), [ADR-0009](0009-fehlerfarbe.md), [ADR-0016](0016-kanal-architektur-und-mail.md) §5 (Hilfsprogramm als Node-SEA), [ADR-0025](0025-ui-konsistenz-overlay-system.md), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0035](0035-start-einstieg-und-offene-tabs.md) (Hinweis beim Öffnen)

## Kontext

- **Bisher (ADR-0003):** PocketBase sicherte alle vier Stunden (`0 */4 * * *`, UTC) per `VACUUM INTO` den ganzen Ordner `pb_data` als ZIP nach `app\pb_data\backups` und behielt die letzten 12, also auf derselben Platte und unverschlüsselt. Gesichert wurde nur bei laufendem Server. Wiederherstellen ging nur von Hand (PocketBase unterstützt es unter Windows nicht, `backup_restore.go`), eine Kopie außer Haus war Sache des Nutzers.
- **Geprüft wurde nichts:** Ob eine Sicherung sich öffnen lässt und ob die Originaldateien des Eingangs darin stecken, zeigte erst der Ernstfall.
- **Außerhalb von `pb_data`:** die Zugangsdaten als Windows-Benutzervariablen `BYL_*` (ADR-0018; die Datenbank kennt nur ihre Namen), `byl-config.json`, `run\`, Autostart, installierte Web-App und Browser-Erweiterung, die Programmdateien. Nach einem Totalausfall müsste der Nutzer jede Variable neu beschaffen.
- **Sensibel in einer Sicherung:** persönliche Inhalte und Originaldateien, Passwort-Hashes und der Signierschlüssel der Anmeldungen. Jede Kopie außer Haus muss verschlüsselt sein.

## Entscheidung

### 1. Stufe 1: lokal, mit Generationen

- **Eigener Zeitplan:** Der Cron `byl-backup` (`app/pb_hooks/backup.pb.js`, `lib/backup-service.js`) schaut alle fünf Minuten nach, ob etwas fällig ist, und sichert, wenn die neueste eigene Sicherung einen Tag alt ist (einen Lauf früher, damit die Uhrzeit nicht wandert). Weil auch der erste Lauf nach dem Start so prüft, sichert die App spätestens fünf Minuten nach dem Start, wenn die letzte Sicherung älter als einen Tag ist. Nicht in `onBootstrap`: Eine Sicherung im Start verzögerte `/api/health`, und `start.bat` wartet darauf höchstens 30 s.
- **Sicherung:** `$app.createBackup(new Context(), name)`, also wie bisher konsistent im laufenden Betrieb (`VACUUM INTO`, Ordner `backups` ausgenommen). Name `byl-YYYYMMDD-HHMMSS.zip` (UTC).
- **Generationen (GFS):** Behalten wird die neueste Sicherung jedes der letzten 7 Tage mit Sicherungen, jeder der letzten 4 ISO-Wochen und jedes der letzten 6 Monate; die neueste bleibt immer. Tage, Wochen und Monate nach Berliner Kalender (ADR-0005), gerechnet rein in `lib/backup-rules.js` (`retention`). Einstellbar 1–30, 0–12, 0–24. Gelöscht werden nur Dateien nach dem eigenen Namensmuster; andere ZIP-Dateien in `pb_data\backups` (Sicherungen aus der Verwaltung, die bisherigen automatischen) bleiben und stehen auf der Seite als „Andere Sicherung (bleibt)“.
- **„Jetzt sichern“:** sichert sofort und kopiert ins Zielverzeichnis (§2).
- **Automatisches Backup von PocketBase aus:** Die Migration `1790203000_backups_own_schedule.js` setzt `backups.cron` auf leer, aber nur, solange es noch den Zeitplan von ADR-0003 hat; ein Zeitplan aus der Verwaltung bleibt. Der Rückweg setzt den Zeitplan von ADR-0003 wieder, nur wenn keiner eingestellt ist. Begründung: Zwei Zeitpläne verdoppelten die Sicherungen, und die von PocketBase fielen weder unter die Generationen noch ins Zielverzeichnis.
- **Abstand:** Eine Sicherung am Tag statt alle vier Stunden. Die Generationen rechnen in Tagen, und eine Kopie ins Zielverzeichnis je Sicherung wäre alle vier Stunden auf einer USB-Platte oder einem NAS viel. Vor einer riskanten Änderung gibt es „Jetzt sichern“. Was nach der letzten Sicherung kam, kann verloren gehen; der Notfallplan nennt das (BK-4).
- **Zustand:** in `app\run\sicherung.json` (letzte Sicherung, letzter Fehler, letzte Kopie, letzter Versuch, Problem des Ziels seit), geschrieben nur vom Dienst. Nicht in der Datenbank: Eine wiederhergestellte Sicherung brächte sonst einen alten Zustand mit.
- **Instanzen der Tests** (Marke `byl-test-mode`) sichern nicht von selbst; die Tests rufen den Lauf mit einer gegebenen Uhr auf (`tests/fixtures/pb_hooks/backup-clock.pb.js`).

### 2. Stufe 2: Zielverzeichnis

- **Frei wählbar** (Nutzerentscheidung): ein absoluter Pfad oder eine Freigabe (`\\NAS\Freigabe\Ordner`) – zweites Laufwerk, USB-Platte, NAS oder ein Ordner, den ein Cloud-Dienst synchronisiert. Keine Cloud-Schnittstelle, kein fremder Dienst. Ein Browser gibt einer Seite keinen Pfad aus einem Ordner-Dialog; der Pfad wird eingetippt oder aus der Adresszeile des Explorers eingefügt.
- **Gespeichert** in `app\byl-config.json` unter `backup` (`target`, `daily`, `weekly`, `monthly`, `credentials`): Die Einstellung gehört zur Installation, wandert mit einer Ordnerkopie und kommt mit jeder verschlüsselten Sicherung mit. Geschrieben wird die Datei nur von `byl-control.ps1` (`backup-configure`; `port` lässt den Abschnitt seitdem stehen, `Merge-BylConfigText`).
- **Prüfungen** (`Test-BylBackupTarget`, `Get-TargetCheck`): vollständiger Pfad mit Laufwerk oder Freigabe, keine Teile `.` oder `..`, keine Zeichen, die Windows nicht erlaubt, höchstens 240 Zeichen, nicht im Ordner `app` (ohne Rücksicht auf Groß- und Kleinschreibung: eine Kopie des Ordners nähme die Sicherungen mit, ein Plattendefekt beide), vorhanden, beschreibbar (Probedatei) und mindestens 200 MB mehr frei als die neueste Sicherung braucht (`GetDiskFreeSpaceEx`, auch für Freigaben). Liegt das Ziel auf demselben Laufwerk wie die App, sagt die Seite, dass das nicht gegen einen Plattendefekt hilft.
- **Kopie:** nach jeder neuen Sicherung, verschlüsselt (§3) als `byl-<Zeitstempel>.tar.age`. Ist das Ziel nicht erreichbar (USB-Platte abgezogen), ist das ein Zustand, kein Fehler: Die App versucht es alle 15 Minuten wieder und kopiert die neueste Sicherung, sobald das Ziel wieder da ist. Dieselben Generationen wie lokal (eine getrennte Einstellung wäre optional gewesen; ohne erkennbaren Bedarf weggelassen).
- **Immer verschlüsselt:** Ohne Passphrase entsteht im Ziel nichts (Warnung „Keine Passphrase“).
- Geschrieben wird erst neben die Zieldatei (`.partial-…`, mit `flush`) und am Ende umbenannt: Ein abgebrochener Lauf, ein abgezogener Stick oder ein Cloud-Dienst sehen nie eine halbe Datei unter dem richtigen Namen.

### 3. Verschlüsselung: age mit Passphrase, Hilfsprogramm `byl-backup.exe`

- **Format: [age](https://age-encryption.org/v1)** mit Passphrase (scrypt-Empfänger, Arbeitsfaktor 18, der Standard der Bibliothek; das `age`-Programm nimmt bis 22 an). Im Notfall öffnet das offizielle `age`-Programm eine Sicherung ohne die App (`age --decrypt`).
- **Bibliothek:** [`age-encryption`](https://github.com/FiloSottile/typage) 0.3.1 (typage von Filippo Valsorda, dem Autor von age; BSD-3-Clause; gepflegt, letzte Version 2026-08). Abhängigkeiten `@noble/ciphers`, `@noble/hashes`, `@noble/curves`, `@noble/post-quantum`, `@scure/base` (MIT, Paul Miller, auditiert). Exakt gepinnt in `helpers/backup/package.json`, alles Weitere im Lockfile; Dependabot beobachtet den Ordner. Keine eigene Kryptographie: `src/age.ts` ordnet nur die Fehler der Bibliothek ein.
- **Hilfsprogramm `app\byl-backup.exe`** wie `byl-mail.exe` (ADR-0016 §5): Node-24-Single-Executable-Application, mit esbuild gebündelt, mit postject eingespritzt (`helpers/backup/build.mjs`), von `scripts\build-backup-helper.ps1` ohne Node geprüft (`--version`, `--self-test`) und in den Ordner `app` gelegt (gitignored). Befehle `seal` und `open` (BK-2: `check`); **alle Parameter als ein JSON-Objekt auf der Standardeingabe**, nie auf der Befehlszeile, die andere Programme des Kontos lesen könnten. Die Umgebung des Programms hat keine `BYL_*`-Variable.
- **Inhalt einer Sicherung im Ziel:** ein tar-Archiv (ustar, für Dateien ab 8 GiB mit pax-Kopf) mit `LIESMICH.txt` (Schritte ohne die App), `manifest.json` (Format, Name, Zeitpunkt, Commit, Zählungen, neueste Migration, Namen der Variablen), `byl-config.json` (falls vorhanden), `zugangsdaten.json` (falls mitgesichert, §4) und `pb_data.zip` (die Sicherung von PocketBase, unverändert). **Warum tar:** Es lässt sich in beide Richtungen streamen; so wird eine Sicherung ohne Kopie im Klartext versiegelt und wieder geöffnet. ZIP verlangt zum Lesen Zugriff auf das Verzeichnis am Ende der Datei, also eine entschlüsselte Kopie auf der Platte (mit den Zugangsdaten im Klartext) oder eine Bibliothek mit wahlfreiem Zugriff. Windows 10 und 11 haben `tar.exe` (`C:\Windows\System32\tar.exe`), Linux und macOS ohnehin; 7-Zip öffnet tar auch. Schreiber und Leser (`src/tar.ts`) sind klein, nehmen nur bekannte Dateinamen an und sind gegen das tar des Systems getestet (beide Richtungen).
- **Prüfung beim Öffnen:** `open` entschlüsselt bis zum letzten Block (erst dann hat age jeden Abschnitt geprüft), nimmt nur die bekannten Einträge je einmal an und meldet `passphrase`, `format` (kein age) oder `damaged` (verändert oder abgeschnitten).
- **Belegt mit den offiziellen Testvektoren** von age (`cctv-age` 0.2.0, c2sp.org/CCTV/age, nur in den Tests): Eine Datei der Referenzimplementierung öffnet sich mit ihrer Passphrase, falsche Passphrasen und veränderte Tags werden abgelehnt. Die Probe mit dem `age`-Programm von Hand steht im Test-Manifest.
- **Passphrase:** auf der Seite zweimal einzugeben, mindestens 12 Zeichen, höchstens 1024 Byte, keine Steuerzeichen. Sie geht nur im Körper eines POST an die Route, von dort auf der Standardeingabe an `byl-control.ps1 backup-passphrase`, das sie mit **DPAPI für dieses Windows-Konto** (`CurrentUser`, mit eigener Entropie) verschlüsselt in `%LOCALAPPDATA%\becauseyoulovejira\sicherung-<id>.passphrase` ablegt (`<id>` = die ersten 16 Zeichen von SHA-256 über den Pfad des Ordners `app`): außerhalb von `app` und `pb_data`, je Installation eine, nie im Klartext, nie in einem Log. So laufen die Sicherungen unbeaufsichtigt. Ändern: Neue Sicherungen nutzen die neue Passphrase, ältere bleiben mit ihrer alten lesbar; die Seite sagt das. Auf der Seite steht: „Bewahre die Passphrase in deinem Passwort-Manager auf – ohne sie lässt sich die Sicherung nicht öffnen.“

### 4. Zugangsdaten mitsichern (Nutzerentscheidung)

- In jede verschlüsselte Sicherung kommen die Werte aller `BYL_*`-Variablen des Benutzerkontos (ohne die Schalter der Tests `BYL_TEST_*`), als `zugangsdaten.json` im verschlüsselten Archiv. Gelesen werden sie von `byl-control.ps1` aus dem Konto (`Get-BylVariableScope`), nicht aus `pb_data` und nicht vom Server; sie gehen nur über die Standardeingabe an `byl-backup.exe`. **Nie unverschlüsselt**, nie in die Sicherungen im Ordner `app`, nie in ein Log, nie in eine Antwort (die Seite und das Manifest nennen nur die Namen).
- Schalter „Zugangsdaten mitsichern“ auf der Seite, **Standard an**, mit dem Hinweis, dass die Werte aus den Windows-Umgebungsvariablen stammen und beim Wiederherstellen dorthin zurückgeschrieben werden (BK-3). ADR-0018 §2 („nie in `pb_data`“) gilt weiter; neu ist nur die verschlüsselte Sicherung im Ziel.

### 5. Seite „Einstellungen → Sicherung“, Routen, Hinweise

- **Eigene Seite** `/einstellungen/sicherung` zwischen „Konto“ und „System“, nur für einen Server unter Windows (wie „System“). Begründung: Die Seite „System“ bedient den Betrieb; die Sicherung hat eigene Formulare (Ziel, Passphrase, Generationen, Schalter), eine Liste der Sicherungen und später Prüfen und Wiederherstellen.
- **Inhalt:** Zustand (letzte Sicherung, letzte im Ziel, nächste, Generationen), Warnungen, „Jetzt sichern“, Zielverzeichnis, Zugangsdaten, Passphrase, Aufbewahrung, die Sicherungen hier und im Ziel. Feldfehler am Feld (ADR-0009), Ergebnisse als Flag, kein Dialog.
- **Routen** (`backup.pb.js`): `GET /api/byl/backup`, `POST /api/byl/backup/run`, `POST /api/byl/backup/settings`, `POST /api/byl/backup/passphrase`, `GET /api/byl/backup/notice`. **Sicherheitsmodell wie ADR-0043 §4** (dieselben Prüfungen aus `lib/system-service.js`): angemeldetes App-Konto, Windows, dieser Rechner, Adresse der App mit `Origin` für POST, Besitzer der Instanz, Rate-Limit (30 Lesen, 10 Änderungen je Minute), eigene Instanz des Ordners `app`, ein Lauf zur Zeit (409). Ungültige Eingaben antworten 400 mit `reason: invalid` und einem Code. Audit im Log von PocketBase: „byl-backup: Aktion ausgeführt“ (Aktion, Konto, Ergebnis) und „byl-backup: Anfrage abgelehnt“, nie mit Pfaden, Werten oder der Passphrase.
- **Befehle** des Steuerskripts in der Whitelist von `lib/system-rules.js` (`backup-info`, `backup-configure`, `backup-passphrase`, `backup-export`, Merkmal `backup`), mit festen Argumenten und Parametern nur auf der Standardeingabe; `/api/byl/system/actions/{action}` lehnt sie ab wie unbekannte Namen.
- **Warnungen** (`lib/backup-rules.js` `warnings`): „älter als 36 Stunden“, „Zielverzeichnis länger nicht aktuell“ (die neueste Kopie liegt mehr als 36 Stunden hinter der neuesten Sicherung, oder es gibt keine und die Kopie scheitert seit mehr als 36 Stunden; mit Grund), „Keine Passphrase“ – dezent, ohne Rot; „Sicherung gescheitert“ und „Kopie gescheitert“ (Hilfsprogramm fehlt, nicht beschreibbar, Verschlüsseln scheitert) als echte Fehler in Rot.
- **Hinweis beim Öffnen (ADR-0035):** Nach der Anmeldung und wenn die App erneut geöffnet wird, fragt das `(app)`-Layout `GET /api/byl/backup/notice` (ohne Steuerskript) und zeigt nur bei einer echten Warnung ein Info-Flag „Die Sicherung braucht deine Aufmerksamkeit.“ mit „Ansehen“ (`BackupAttention`); eine fehlende Passphrase allein steht nur auf der Seite.

### 6. Prüfung (BK-2, geplant)

Wöchentlich automatisch und mit „Jetzt prüfen“: ZIP bzw. Entschlüsselung prüfen, in einen Ordner unter Temp entpacken, `data.db` vorhanden, `PRAGMA integrity_check`, eine Wegwerf-PocketBase mit Wegwerf-Superuser auf Zufallsport ohne Hooks starten, Health, Datensätze zählen, jede Datei eines Dateifelds (`original`) in `storage` vorhanden, aufräumen; das Ergebnis im Zustand und auf der Seite.

### 7. Wiederherstellen (BK-3, geplant)

`wiederherstellen.bat` bzw. `byl-control.ps1 restore`: Sicherung wählen (lokal oder Ziel, oder eine Datei), Passphrase per DPAPI oder Eingabe, prüfen wie §6, geordnet beenden, Sicherheitskopie `pb_data.vor-wiederherstellung-<Zeit>`, wiederherstellen, Einstellungen übernehmen, Zugangsdaten nach Rückfrage (nur Namen) zurück in die Benutzervariablen, starten, Health; bei Fehler automatisch zurück. Aus der App als losgelöster Lauf wie `restart -Detach`, mit starker Bestätigung. Auf einer frischen Installation ohne `pb_data`.

### 8. Notfallplan (BK-4, geplant)

Hilfe „Sicherung & Notfall“, README, druckbare „Notfallkarte“ ohne Geheimnisse, Entschlüsseln ohne App mit `age` und `tar`.

## Grenzen

- Eine Sicherung am Tag, und nur, solange die App läuft; was danach kam, kann verloren gehen.
- **Ohne Passphrase ist eine verschlüsselte Sicherung verloren.** Das ist gewollt; deshalb der Hinweis auf den Passwort-Manager.
- DPAPI `CurrentUser` schützt gegen eine Kopie der Datei auf einen anderen Rechner oder in ein anderes Konto, nicht gegen andere Programme desselben Windows-Kontos; dieselbe Grenze haben die `BYL_*`-Variablen selbst (ADR-0018). Wer das Konto bedient, kann die Passphrase lesen lassen.
- Während einer Kopie liegen Passphrase und Zugangsdaten im Speicher von `byl-control.ps1` und `byl-backup.exe`.
- Namen, Größen und Zeitpunkte der Dateien im Ziel sind nicht verschlüsselt.
- Ändert sich der Laufwerksbuchstabe einer USB-Platte, ist das Ziel „nicht erreichbar“, bis der Pfad stimmt.
- Ein Cloud-Ordner synchronisiert erst nach dem Umbenennen; wie schnell, bestimmt der Dienst.
- Zielverzeichnis, Passphrase und Zugangsdaten brauchen das Steuerskript unter Windows; ein Server unter Linux sichert nur lokal (Plattform-Ausbau zurückgestellt, ADR-0028).

## Alternativen

- **ZIP mit AES (WinZip-AES) oder 7-Zip:** im Notfall mit Bordmitteln bzw. 7-Zip zu öffnen, aber ohne gepflegte, kleine Bibliothek für Node (ZIP64 und AES zugleich), oder mit `7z.exe` als weiterer Abhängigkeit des Ordners; die Schlüsselableitung von ZIP-AES (PBKDF2 mit 1000 Runden) ist schwach. Verworfen.
- **OpenPGP (openpgp.js, symmetrisch):** etabliert und mit `gpg` zu öffnen, aber eine große Bibliothek mit vielen Betriebsarten für einen einzigen Zweck. Verworfen zugunsten von age (ein Format, eine Betriebsart, offizielles Werkzeug, Testvektoren).
- **Eigene Verschlüsselung mit .NET in PowerShell** (AES, PBKDF2): eine eigene Konstruktion, vom Auftrag ausgeschlossen. Verworfen.
- **Nur DPAPI:** an Konto und Rechner gebunden; nach einem Totalausfall nicht zu öffnen. Verworfen (DPAPI schützt nur die Passphrase für den unbeaufsichtigten Betrieb).
- **restic, Borg oder Kopia:** gute Werkzeuge, aber ein weiteres Programm mit eigenem Format im Ordner; dedupliziert ein ZIP von `pb_data` kaum. Verworfen.
- **ZIP als Behälter statt tar:** siehe §3 (Lesen nur mit Kopie im Klartext oder Bibliothek). Verworfen.
- **Zielverzeichnis in der Datenbank:** käme mit jeder alten Sicherung zurück und wäre für das Skript eines frischen Ordners nicht lesbar. Verworfen zugunsten von `byl-config.json`.
- **Passphrase in `app\run`:** wanderte mit jeder Kopie des Ordners mit (wertlos, aber unnötig). Verworfen zugunsten von `%LOCALAPPDATA%`.
- **Alle vier Stunden weiter mit PocketBase plus eigene Kopie:** zwei Zeitpläne, zwei Aufbewahrungen. Verworfen (§1).

## Konsequenzen

- Positiv: Sicherungen mit Generationen statt der letzten zwölf, verschlüsselt außer Haus mit einem Werkzeug, das es auch ohne die App gibt; die Zugangsdaten sind nach einem Totalausfall nicht verloren; die Seite zeigt, wann zuletzt gesichert wurde und was fehlt.
- Negativ: ein weiteres Hilfsprogramm (etwa 90 MB, wie `byl-mail.exe`) mit einer Abhängigkeit (`age-encryption`), vier weitere Befehle des Steuerskripts, eine Seite und fünf Routen.
- Neue Hooks und die Migration wirken erst nach einem Neustart (`neu-starten.bat`); bis dahin sichert noch PocketBase alle vier Stunden, und die Seite sagt „Nach dem nächsten Neustart verfügbar“.
