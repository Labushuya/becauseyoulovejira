# ADR-0039: Betriebsskripte – ein Steuerskript, Erkennung laufender Server, Port an einer Stelle, geordnetes Beenden und Neustart nur bei Bedarf

- **Status:** Angenommen und umgesetzt nach [docs/plan/betriebsskripte.md](../plan/betriebsskripte.md): BS-1 (#170, Kern: Befehle `start`, `stop`, `restart`, `port`, Erkennung, Port, geordnetes Beenden), BS-2 (#172, Start-Fingerabdruck, `reload`, `status`, `open`, `logs`, `doctor`) und BS-3 (Doppelklick-Dateien `neu-starten.bat` und `status.bat`, Autostart, Texte, Hilfe). Manuelle Prüfungen stehen im Test-Manifest.
- **Datum:** 2026-09-29
- **Entscheidung durch:** Nutzer (Wunsch: „die einschlägigen Skripte alle anpassen. Soll richtig professionell sein mit bereits laufender Server-Erkennung und Port, sowie intelligentem Reload, Herunterfahren, etc.“, 2026-09-29), Advisor (Ziele, Port ohne stilles Ausweichen, Sicherheitsregel für `stop`, Teilpakete), Executor (Recherche, Umsetzung, Einzelheiten)
- **Ergänzt:** [ADR-0035](0035-start-einstieg-und-offene-tabs.md) §1 und §7 (Nachtrag dort), [ADR-0016](0016-kanal-architektur-und-mail.md) §5 (Start und Stopp des Mail-Hilfsprozesses), [ADR-0018](0018-secrets.md) §6 (Weitergabe der `BYL_*`-Variablen)
- **Bezug:** [ADR-0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md) (nur lokal), [ADR-0002](0002-erststart-und-superuser.md) (Erststart), [ADR-0028](0028-plattform-strategie.md) und [Plan Plattformen](../plan/plattformen.md) (zurückgestellt; hier bleibt alles Windows/PowerShell und verbaut nichts), [ADR-0038](0038-eigener-eingang-und-whatsapp-web.md) (die Browser-Erweiterung erwartet die App-Adresse, Standard `http://127.0.0.1:8090`)

## Kontext

- Die Skripte in `app\` riefen `byl-control.ps1 -Action Start|Stop|…` auf. Es gab keinen Status, keinen Neustart und keine Prüfung vor dem Start; Hinweise in Hooks, Oberfläche und Hilfe sagten überall „`stop.bat`, dann `start.bat`“.
- Die Adresse `127.0.0.1:8090` stand an einem Dutzend Stellen fest im Code (Skripte, Landing-Seite, Mail-Hilfsprozess, Verknüpfung der installierten App).
- `stop.bat` beendete PocketBase hart (`TerminateProcess`). Für SQLite im WAL-Modus ist das wie ein Absturz: Abgeschlossene Änderungen überleben, aber Datenbank und WAL werden nicht sauber geschlossen.
- Die eigene Instanz wurde schon über Programmpfad und Kommandozeile erkannt (E1-Plan Paket 8), aber nur für genau Port 8090.

## Entscheidung

### 1. Ein Steuerskript mit Befehlen

`app\byl-control.ps1 <Befehl> [Optionen]`, aufgerufen mit `-NoProfile -ExecutionPolicy Bypass`. Die Logik steht rein und testbar in `app\byl-functions.ps1` (ASCII, alle Eingaben als Parameter), die deutschen Texte in `byl-control.ps1` (UTF-8 mit BOM).

| Befehl | Wirkung | Doppelklick |
|---|---|---|
| `start` | Startet die App; läuft sie schon, nur Browser bzw. Tab (§4) | `start.bat`, `start-hidden.vbs` (Autostart, `-Hidden`) |
| `stop` | Beendet geordnet: Mail-Hilfsprozess, dann PocketBase (§4) | `stop.bat` |
| `restart` | Beendet und startet neu | – |
| `reload` | Startet nur neu, wenn nötig (§5; BS-2) | `neu-starten.bat` (BS-3) |
| `status` | Zustand, Adresse, Stand (§5; BS-2) | `status.bat` (BS-3) |
| `open` | Öffnet die laufende App (BS-2) | – |
| `logs` | Letzte Zeilen der Logs, `-Follow` (§6; BS-2) | – |
| `doctor` | Prüfungen vor dem Start (§7; BS-2) | – |
| `port [Zahl]` | Zeigt oder setzt den Port (§2) | – |
| `autostart-on`, `autostart-off` | Verknüpfung im Autostart-Ordner | `autostart-an.bat`, `autostart-aus.bat` |
| `reset-admin` | Admin-Konto anlegen oder Passwort setzen | `admin-zuruecksetzen.bat` |
| `help` | Befehle, Optionen, Exit-Codes | – |

Optionen: `-Force` (`start`: eine App, die nicht antwortet, neu starten; `reload`: immer neu starten), `-NoBrowser`, `-Quiet` (nur Fehler und Ergebnis), `-Hidden` (ohne Konsole, Hinweise als Meldungsfenster), ab BS-2 `-Json` (`status`, `doctor`) und `-Follow` (`logs`).

**Exit-Codes** (in `help` und hier dokumentiert; die `.bat`-Dateien lassen das Fenster bei allem außer 0 offen):

| Code | Bedeutung |
|---|---|
| 0 | erledigt (bei `status`: läuft und ist aktuell) |
| 1 | Fehler, die Meldung sagt, was zu tun ist |
| 2 | Einrichtung offen (erster Start) |
| 3 | läuft nicht (`status`, `open`; BS-2) |
| 4 | Port belegt durch ein anderes Programm |
| 5 | App läuft, antwortet aber nicht auf `/api/health` |
| 6 | läuft, aber ein Neustart ist nötig (`status`; BS-2) |

### 2. Port und Adresse an einer Stelle

- **Standard 8090 wie bisher.** Änderbar nur in `app\byl-config.json` (`{ "port": 8091 }`, gitignored), geschrieben von `byl-control.ps1 port <Zahl>`. Erlaubt sind ganze Zahlen von 1024 bis 65535. Eine kaputte Datei oder ein ungültiger Port wird gemeldet (mit dem Befehl zum Reparieren); gestartet wird dann nicht, damit ein Tippfehler die App nie an eine unerwartete Adresse legt.
- **Warum eine Datei im App-Ordner und keine Variable `BYL_PORT`:** Die Einstellung wandert mit einer Ordnerkopie (CLAUDE.md §1), gilt je Installation (eine zweite Kopie oder die Testkopien stören sich nicht), verlangt keinen Eingriff ins Windows-Konto und lässt sich testen. `BYL_*`-Variablen sind für Zugangsdaten da und werden an PocketBase weitergereicht ([ADR-0018](0018-secrets.md)).
- **Kein stilles Ausweichen:** Die Browser-Erweiterung für WhatsApp Web, Lesezeichen, die installierte App und die Anmeldung (je Origin) hängen an der Adresse. Ist der Port belegt, bricht `start` mit Exit 4 ab und nennt Programm, PID und Pfad des Besitzers, den nächsten freien Port (ohne 8099, der für Spikes reserviert ist) und den fertigen Befehl zum Umstellen. Das andere Programm bleibt unberührt. Ist es eine `pocketbase.exe`, sagt die Meldung, dass es vermutlich eine andere Kopie ist.
- **Eine Adresse für alles:** `Set-BylAddress -Port` stellt in `byl-functions.ps1` App-, Health-, Präsenz-, Hinweis- und Mail-Adresse gemeinsam um. Genutzt wird der Port der laufenden Instanz (aus ihrer Kommandozeile), sonst der eingestellte. Gebunden wird weiterhin nur `127.0.0.1` (`--http=127.0.0.1:<Port>`).
- **Landing-Seite:** Eine Seite unter `file://` darf keine anderen Dateien lesen, aber ein klassisches `<script src>` aus ihrem Ordner laden. `byl-control.ps1` schreibt deshalb `app\run\app-adresse.js` (`window.BYL_APP_URL = 'http://127.0.0.1:<Port>/';`) bei `start` (Port der laufenden Instanz), `stop` und `port` (eingestellter Port, solange nichts läuft). `becauseyoulovejira.html` lädt nur diese Datei und nimmt den Wert nur, wenn er genau `http://127.0.0.1:<Zahl>/` ist; sonst 8090.
- **Oberfläche:** Die App, der Kanal-Assistent „WhatsApp Web“ (App-Adresse aus der eigenen Origin) und die Hilfe nehmen die Adresse aus `window.location`; dort steht keine feste Adresse.
- **Mail-Hilfsprozess** (`run --url=http://127.0.0.1:<Port>`) und die Verknüpfung der installierten App (`--app-url`) folgen derselben Adresse.
- Nach einem Wechsel nennt `port`, was der Nutzer anpassen muss: Lesezeichen, installierte App (unter der neuen Adresse neu installieren), App-Adresse in der Erweiterung, und dass die Anmeldung je Adresse gilt.

### 3. Erkennung der eigenen Instanz

- **Eigene Instanz** ist ein Prozess `pocketbase.exe`, dessen **Programmpfad** `app\pocketbase.exe` dieses Ordners ist, mit `serve`, `--http=127.0.0.1:<beliebiger Port>` und `--dir=<dieser Ordner>\pb_data` (`Select-AppProcess`). Eine Kopie in einem anderen Ordner, eine Testinstanz mit anderem Datenordner, ein Server auf `0.0.0.0`, Einmal-Befehle (`superuser`, `migrate`) und Prozesse mit unlesbarer Kommandozeile zählen nie.
- **Eigener Mail-Hilfsprozess** ist `byl-mail.exe` direkt in diesem Ordner mit `run` und `--url` auf eine Adresse der eigenen Instanz (Port der laufenden Instanz, der Zustandsdatei oder der Einstellung). Benennt `scripts\build-mail-helper.ps1` einen laufenden Hilfsprozess in `byl-mail.exe.old-<Zeit>` um, meldet Windows weiter den Pfad vom Start (`byl-mail.exe`); er zählt also weiter als eigener (am Live-Rechner beobachtet, BS-2 korrigiert die Annahme aus BS-1, Windows melde den neuen Namen).
- **Zustandsdatei** `app\run\byl.state.json` (gitignored): `pid`, `port`, `processStartUtc`, `startedUtc`, ab BS-2 der Start-Fingerabdruck und der DPAPI-verschlüsselte Schlüssel seines Umgebungs-Hashes (§5). Keine Geheimnisse im Klartext. Sie gilt nur, wenn PID **und** Prozessstart (auf 2 s) zur laufenden eigenen Instanz passen; sonst (Prozess beendet, PID wiederverwendet) ist sie veraltet und wird entfernt. Maßgeblich bleibt immer der Blick auf die Prozesse; die Datei liefert Startzeit, Port und Fingerabdruck.
- **Gesundheit:** `GET /api/health` mit Timeout, ohne Proxy. Eigener Prozess ohne Antwort ist in den ersten 30 s „startet“, danach „antwortet nicht“.
- **Andere Server:** Wer den Port belegt, wird mit Programmpfad genannt; ab BS-2 nennen `status` und `doctor` auch laufende Kopien in anderen Ordnern (nur Hinweis, nie beendet).

### 4. Start, Stopp und Neustart

- **`start` ist idempotent** (`Resolve-StartAction`): Läuft die eigene Instanz, startet nichts; nur Browser bzw. Tab über die vorhandene Tab-Wiederverwendung ([ADR-0035](0035-start-einstieg-und-offene-tabs.md) §7) und der Mail-Hilfsprozess, falls er fehlt. Startet sie gerade, wartet `start`. Antwortet sie nicht, meldet `start` das (Exit 5) und nennt `restart`; mit `-Force` startet es neu. Belegt ein anderes Programm den Port: §2.
- **Kaltstart:** Ordner `logs` und `run` beschreibbar (sonst Abbruch), Hinweis ohne Web-Build (`pb_public\index.html`), `BYL_*`-Variablen frisch aus dem Benutzerkonto ([ADR-0018](0018-secrets.md) §6), PocketBase ohne Fenster starten, Zustandsdatei und Adresse schreiben, auf `/api/health` warten (höchstens 30 s, Fortschritt je Sekunde), Erststart wie bisher ([ADR-0002](0002-erststart-und-superuser.md)), dann Mail-Hilfsprozess, Ergebniszeile „becauseyoulovejira läuft: <Adresse> (PID …)“ und Browser.
- **`stop`:** erst offenen Tabs „wurde beendet“ schicken (ohne zu warten), dann der eigene Mail-Hilfsprozess, dann PocketBase, danach warten, bis der Port frei ist (höchstens 10 s), Zustandsdatei löschen. Läuft nichts: „läuft nicht“, Exit 0.
- **Geordnet beenden (recherchiert und verifiziert):**
  - PocketBase 0.40.4 fängt in `Execute()` `os.Interrupt` und `SIGTERM` ab (`signal.Notify`) und löst dann `OnTerminate` mit `ClearBootstrap` aus: Die Datenbank wird geschlossen, SQLite überträgt die WAL und löscht `data.db-wal` und `data.db-shm`. `byl-mail.exe` beendet seine Schleife auf `SIGINT`, `SIGTERM` und `SIGBREAK`.
  - Unter Windows erreicht man das bei einem Konsolenprogramm ohne Fenster nur über ein Konsolen-Steuersignal. Go übersetzt `CTRL_C_EVENT` **und** `CTRL_BREAK_EVENT` in `os.Interrupt`. Gesendet wird `CTRL_BREAK_EVENT`: Das Ignorieren von `CTRL_C_EVENT` wird an Kindprozesse vererbt; im Test kam Ctrl+C bei PocketBase nicht an, Ctrl+Break sofort.
  - Weil `GenerateConsoleCtrlEvent` nur an die eigene Konsole senden kann, startet `stop` für jeden Prozess einen kurzen PowerShell-Kindprozess ohne Fenster (`Send-ConsoleBreak`, Quelle `$BylConsoleBreakSource`): Er löst sich von seiner Konsole, hängt sich an die des Ziels, registriert **danach** einen Handler, der das Signal für sich selbst verschluckt (eine neue Konsole setzt die Behandlung zurück; mit dem Handler davor beendete sich der Sender selbst mit `STATUS_CONTROL_C_EXIT`), und sendet nur, wenn an dieser Konsole außer ihm **nur** das Ziel hängt (`GetConsoleProcessList`). Ein von Hand in einem Terminal gestarteter Server teilt seine Konsole mit der Shell; dann wird nichts gesendet und nach der Frist hart beendet.
  - Frist 15 s, danach `Stop-Process -Force` mit Warnung „Nicht rechtzeitig geordnet beendet, daher hart beendet“ und dem Hinweis, dass gespeicherte Änderungen erhalten bleiben.
  - **Verifiziert** im Integrationstest gegen Wegwerf-Kopien: Exit ohne harte Beendigung, danach keine `data.db-wal` mehr.
- **Sicherheitsregel:** `stop` und `restart` beenden ausschließlich Prozesse, deren Programm in diesem App-Ordner liegt (`Select-AppProcess`, `Select-MailHelperProcess`), per Prozess-ID und nach erneuter Prüfung unmittelbar davor (`Stop-SelectedProcess`), nie nach Namen, nie `taskkill /IM`. Der Integrationstest belegt, dass `stop` in einer Kopie den Server einer anderen Kopie nie beendet.
- **`restart`:** `stop` (falls etwas läuft), dann `start`. Offene Tabs verbinden sich selbst neu; `start` wartet dafür bis zu 3 s und öffnet dann keinen zweiten Tab.

### 5. Neustart nur bei Bedarf (BS-2)

- Beim Start speichert `byl-control.ps1` einen **Start-Fingerabdruck** in der Zustandsdatei: `server` (Länge und Änderungszeit von `pocketbase.exe`), `migrations` (SHA-256 über Namen und Inhalt von `pb_migrations\*.js`), `hooks` (dasselbe für `pb_hooks`, rekursiv), `port`, `environment` (HMAC-SHA256 über „Name=Wert“ der weitergereichten `BYL_*`-Variablen, siehe unten), `mailHelper` (Länge und Änderungszeit von `byl-mail.exe`) und `web` (SHA-256 von `pb_public\_app\version.json`, sonst `index.html`).
- **Einordnung:** PocketBase 0.40.4 lädt geänderte Hooks unter Windows **nicht** neu (`--hooksWatch … it has no effect on Windows`, geprüft an `pocketbase.exe serve --help`) und führt Migrationen nur beim Start aus. Eine Änderung an `server`, `migrations`, `hooks`, `port`, `environment` oder `mailHelper` heißt „Neustart nötig“ mit Grund. PocketBase liefert `pb_public` bei jeder Anfrage frisch aus; ein neuer Web-Build heißt nur „neu laden (F5)“. Ohne Fingerabdruck (gestartet mit älteren Skripten) ist der Stand unbekannt und ein Neustart empfohlen.
- `status` zeigt „aktuell“, „nur neu laden (F5) – Oberfläche neu gebaut“ oder „Neustart nötig – …“. `reload` (`neu-starten.bat`) startet nur bei „Neustart nötig“, bei einer App, die nicht antwortet, oder mit `-Force` neu, startet eine gestoppte App und sagt sonst „kein Neustart nötig“.
- **Zugangsdaten ohne gespeicherte Werte:** Auch ein neuer **Wert** einer vorhandenen Variablen braucht einen Neustart (etwa die freigegebenen Chat-IDs von Telegram nach `setx`). Ein Hash nur der Namen sähe das nicht, ein einfacher Hash der Werte ließe sich bei schwachen Passwörtern offline durchprobieren. Deshalb erzeugt jeder Start einen Zufallsschlüssel (32 Byte), bildet damit HMAC-SHA256 über die sortierten Einträge „Name=Wert“ (Wert aus dem Benutzerkonto, sonst aus dem Maschinenkonto, wie `Sync-BylEnvironment`) und legt den Schlüssel **nur mit DPAPI für das Windows-Konto verschlüsselt** in die Zustandsdatei (`environmentKey`). `status` entschlüsselt ihn und vergleicht. Die Werte verlassen nie den Speicher; wer den Schlüssel entschlüsseln kann, kann die Variablen ohnehin lesen. Lässt sich der Schlüssel nicht mehr entschlüsseln (anderes Konto), gilt die Umgebung als geändert.
- **Hinweis in der Oberfläche:** kein neuer Mechanismus. Die Hooks erkennen fehlende Migrationen schon je Funktion und zeigen `RESTART_NEEDED`; dessen Text nennt ab BS-3 `neu-starten.bat`. Ein allgemeiner Datei-Fingerabdruck im Server müsste die eigenen Ordner zur Laufzeit lesen und die Logik in der JSVM doppeln, ohne mehr zu erkennen als `status`.

### 6. Logs (BS-2)

- Ablage `app\logs\` (`*.log` gitignored): `pocketbase.out.log`/`.err.log`, `byl-mail.log`/`.err.log` und neu `byl-control.log`.
- Server- und Hilfsprozess-Logs beginnt jeder Start neu; der vorige Lauf bleibt als `*.1.log`. Während eines Laufs wachsen sie nur langsam (PocketBase schreibt seine Anfragen in die Datenbank, nicht in die Ausgabe; der Hilfsprozess eine Zeile je Abruf). `byl-control.log` bekommt je **ändernden** Befehl (`start`, `stop`, `restart`, `reload`, `port`, Autostart, `reset-admin`) eine Zeile (Zeit, Befehl, Exit-Code, Aktion, PID, Port) und wird ab 1 MB rotiert; `status` und `logs` schreiben nichts. Keine Werte von Variablen, keine Passwörter, keine E-Mail-Adressen, keine Inhalte.
- `logs [server|mail|skript]` zeigt die letzten Zeilen (`-Lines`), `-Follow` folgt genau einem Log bis Strg+C.

### 7. Prüfungen (`doctor`, BS-2)

Dateien (`pocketbase.exe`, `pb_hooks`, `pb_migrations`), Web-Build, Einstellung, Port (frei, eigene Instanz oder fremd mit Pfad), Schreibrechte in `logs`, `run` und `pb_data`, freier Platz (Warnung unter 500 MB, Fehler unter 100 MB), laufende Kopien in anderen Ordnern (nur Hinweis), Autostart. `start` nutzt die wichtigsten davon vor dem Kaltstart.

### 8. Texte (BS-3)

- Alle Hinweise „`stop.bat`, dann `start.bat`“ in Hooks, Oberfläche, Hilfe, Mail-Hilfsprozess, Erweiterung und `build-mail-helper.ps1` werden „`neu-starten.bat`“; der Kanal-Assistent zeigt im Schritt „Neu starten“ nur noch `app\neu-starten.bat`. Das geht, weil `reload` genau die Fälle erkennt, für die diese Hinweise gedacht sind: neue Migration, neue oder geänderte Variable, neuer Mail-Hilfsprozess, Token nach dem Start angelegt. Ohne nötigen Neustart startet `reload` einen fehlenden Mail-Hilfsprozess.
- **Ausnahme:** Der abgelaufene Einrichtungslink des ersten Starts braucht weiter „`stop.bat`, dann `start.bat`“: Die App ist dann „aktuell“, `neu-starten.bat` startete nicht neu, und nur ein neuer Serverlauf erzeugt einen neuen Link.
- Der Hinweis im Tab nach `stop` heißt „becauseyoulovejira wurde beendet.“ ohne „(stop.bat)“, weil ihn auch `restart` und `neu-starten.bat` auslösen; nach dem Neustart verbindet sich der Tab und der Hinweis verschwindet.
- `neu-starten.bat` zeigt Erfolg 5 s (wie `stop.bat`), `status.bat` wartet immer auf eine Taste. `autostart-an.bat` ersetzt eine Verknüpfung, die auf einen anderen Ordner zeigt, und sagt es; `admin-zuruecksetzen.bat` nennt die Verwaltung unter der Adresse der laufenden App.
- Die Hilfe „Betrieb“ erklärt Starten, Neu starten nur bei Bedarf, geordnetes Beenden, `status.bat`, die tatsächliche Adresse dieser App mit dem Befehl zum Umstellen des Ports, Fehlerbilder mit `doctor` und die Logs.

## Grenzen

- **Mitgeschnittene Ausgabe:** `Start-Process` gibt PocketBase alle vererbbaren Handles von PowerShell mit, auch die eines umgeleiteten Stdout. Wer die Ausgabe von `start` oder `restart` über eine Pipe liest, bekommt das Ende erst, wenn der Server endet; die Ausgabe in eine Datei umzuleiten, hilft. Das Zurücksetzen der drei Standard-Handles reicht nicht (PowerShell hält weitere Kopien); ein eigenes `CreateProcess` mit Handle-Liste wäre deutlich mehr Code und ist für Doppelklick und Konsole unnötig.
- Prozesse anderer Benutzer liefern keinen Programmpfad und zählen nie als eigene.
- PocketBase schaltet in seinen Dev-Modus, wenn `pocketbase.exe` unter `%TEMP%` liegt (Heuristik für `go run`); dessen SQL-Log nennt das Installer-Konto und sieht wie ein Erststart aus. Die App liegt nie dort; die Tests legen ihre Kopien deshalb unter `.tmp\` des Repos an.

## Alternativen

- **Variable `BYL_PORT` im Windows-Konto:** gilt für alle Kopien, wandert nicht mit dem Ordner, und die Landing-Seite könnte sie nicht lesen. Verworfen zugunsten von `byl-config.json` (§2).
- **Automatisch auf einen freien Port ausweichen:** Erweiterung, Lesezeichen, installierte App und Anmeldung liefen ins Leere. Verworfen.
- **`taskkill /PID` ohne `/F`:** schickt `WM_CLOSE` an Fenster; ein Konsolenprogramm ohne Fenster lässt sich so nicht beenden. Verworfen.
- **Stopp über eine HTTP-Route:** PocketBase hat keine, und eine eigene Route zum Beenden wäre eine Angriffsfläche. Verworfen.
- **`CTRL_C_EVENT`:** wird durch ein geerbtes Ignorieren verschluckt (§4). Verworfen zugunsten von `CTRL_BREAK_EVENT`.
- **Windows-Dienst, Job Object oder Tray-Programm:** Plattform-Stufe S4, zurückgestellt ([ADR-0028](0028-plattform-strategie.md)). Die Befehle hier lassen sich später von einer Tray-Hülle aufrufen; nichts ist dafür verbaut.

## Konsequenzen

- Positiv: Ein Einstieg mit klaren Befehlen und Exit-Codes; kein Doppelstart; Port an einer Stelle, überall gleich; PocketBase schließt die Datenbank beim Stopp sauber; `stop` kann nie fremde Prozesse treffen, auch keine zweite Kopie der App.
- Negativ: `stop` braucht pro Prozess einen kurzen PowerShell-Kindprozess mit `Add-Type` (etwa 1 s).
- Negativ: Die Landing-Seite lädt eine erzeugte Datei aus `run\`; fehlt sie, gilt 8090.
- Agenten führen die Skripte nur im Worktree gegen Wegwerf-Kopien mit Zufallsport aus, nie gegen `app\` oder Port 8090 (CLAUDE.md §11.3).
