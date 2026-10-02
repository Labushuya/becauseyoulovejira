# ADR-0043: Seite „Einstellungen → System“ – Betrieb aus dem Dashboard über feste Befehle des Steuerskripts, losgelöster Neustart, nur Besitzer, nur dieser Rechner

- **Status:** Angenommen und umgesetzt (SY-1, [Plan](../plan/system-seite.md)). Manuelle Prüfungen stehen im Test-Manifest (BYL-E6-650 bis BYL-E6-656). Nachtrag BK-1 ([ADR-0046](0046-sicherung-pruefung-wiederherstellen.md): die Seite „Sicherung“ nutzt dieselben Prüfungen). Nachtrag BK-2 (Prüfen einer Sicherung). Nachtrag BK-3 (Wiederherstellen als losgelöster Lauf). Nachtrag RS-1 (Problem im Hintergrund und „Was tun?“, [ADR-0048](0048-fehlerkatalog-der-skripte.md)).
- **Datum:** 2026-09-30
- **Entscheidung durch:** Nutzer (Wunsch „Einpflegen von Triggern von .bat Dateien per Einstellungen? … Ausführung wäre eine unheimliche Erleichterung, da alles aus Dashboard heraus“, Freigabe der Spec „ja, ohne Beenden“, 2026-09-30), Advisor (Umfang, Sicherheitsrahmen, Tests), Executor (Recherche, Festlegung des Besitzers, Umsetzung, Einzelheiten)
- **Ergänzt:** [ADR-0039](0039-betriebsskripte.md) (Nachtrag dort: `mail-restart`, `restart -Detach`, `logs -Json`, Autostart-Ordner der Testkopien), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) §1 (neue Unterseite)
- **Bezug:** [ADR-0035](0035-start-einstieg-und-offene-tabs.md) §4 (Loopback über `e.remoteIP()`), [ADR-0038](0038-eigener-eingang-und-whatsapp-web.md) §2 (Prüfung des `Origin`), [ADR-0040](0040-veroeffentlichen-ohne-unterbrechung.md) §5 (Hinweis auf ungespeicherte Eingaben), [ADR-0028](0028-plattform-strategie.md) (Plattformen zurückgestellt), [ADR-0002](0002-erststart-und-superuser.md) (Admin-Konto und App-Konto), [ADR-0018](0018-secrets.md) (Zugangsdaten), [ADR-0009](0009-fehlerfarbe.md), [ADR-0025](0025-ui-konsistenz-overlay-system.md) §4 (Bestätigung)

## Kontext

- Bedient wird die App bisher nur über die Doppelklick-Dateien im Ordner `app` (`start.bat`, `neu-starten.bat`, `status.bat`, `autostart-an.bat` …), die alle `byl-control.ps1` aufrufen ([ADR-0039](0039-betriebsskripte.md)). Der Nutzer möchte dasselbe aus dem Dashboard erledigen.
- PocketBase kann sich nicht im eigenen Prozess neu starten, und unter Windows lädt es geänderte Hooks nicht selbst ([ADR-0039](0039-betriebsskripte.md) §5). Ein Neustart muss also von einem Prozess ausgehen, der das Ende des Servers überlebt.
- ADR-0039 hat eine HTTP-Route zum Beenden als Angriffsfläche verworfen. Diese Seite bekommt deshalb kein „Beenden“ (Nutzerentscheidung), und jede Route ist eng begrenzt.

## Entscheidung

### 1. Umfang

- Neue Unterseite **Einstellungen → System** (`/einstellungen/system`, in der Navigation zwischen „Konto“ und „Hilfe“), nur für einen Server unter Windows.
- **Zustand** (aus `byl-control.ps1 status -Json`, derselbe Fingerabdruck wie `status.bat`): „Läuft seit …“ (Berliner Zeit), Adresse und eingestellter Port, Stand „Aktuell“ / „Oberfläche neu gebaut: F5 im offenen Tab genügt“ / „Neustart nötig: <Gründe in den Worten von status.bat>“, Mail-Helfer (läuft oder warum nicht), Autostart, andere Kopien der App (nur Hinweis). PID, PID des Mail-Helfers und Ordner nur im zugeklappten Bereich „Technische Angaben“.
- **Aktionen**, nur diese, fest eingebaut:
  - „Jetzt neu starten“: losgelöster Neustart (§2). Ein eigener Knopf „Nur wenn nötig“ entfällt: Die Seite zeigt den Stand; ist ein Neustart nötig, ist der Knopf der Hauptknopf und nennt den Grund, sonst ist er sekundär mit „Zurzeit nicht nötig. Anders als neu-starten.bat startet dieser Knopf immer neu.“ `neu-starten.bat` bleibt für „nur wenn nötig“.
  - „Mail-Helfer neu starten“ (`mail-restart`, neuer Befehl des Skripts).
  - Autostart als Switch „Beim Anmelden an Windows starten“ (`autostart-on`/`autostart-off`).
  - „Umgebung prüfen“ (`doctor -Json`) als Liste mit Stufe je Prüfung.
  - „Logs ansehen“ (`logs -Json -Lines 200`) für Server, Mail-Helfer und Skript, je Datei die letzten 200 Zeilen, ohne Geheimnisse (§4), mit „Aktualisieren“.
- Die `.bat`-Dateien bleiben unverändert; die Seite ergänzt sie nur.

### 2. Technik (recherchiert und verifiziert)

- **Prozessstart aus dem Hook:** `$os.cmd` ist in PocketBase 0.40.4 Go's `exec.Command` (`types.d.ts`: `let cmd: exec.command`, „Command returns the Cmd struct to execute the named program with the given arguments … On Windows … Command combines and quotes Args into a command line string with an algorithm compatible with applications using CommandLineToArgvW“). Es gibt **keine Shell**: Programm und Argumente gehen einzeln an `CreateProcess`. Programm ist immer `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` (absolut, kein Suchen im `PATH`), dann `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File <app>\byl-control.ps1` und die festen Argumente der Whitelist (`lib/system-rules.js`).
- **Ausgabe lesen:** `cmd.stdoutPipe()`, `cmd.start()`, `toString(reader, max)` (PocketBase liest einen `io.Reader` bis zum Ende) und `cmd.wait()`; der Exit-Code kommt aus `cmd.processState.exitCode()`, auch wenn `wait()` für 3, 5 oder 6 wirft. Das geht nur bei Befehlen, die keinen bleibenden Prozess starten (`status`, `doctor`, `logs`): Ein mit Umleitung per `Start-Process` gestarteter Kindprozess erbt die Pipe, und das Lesen endete erst mit ihm ([ADR-0039](0039-betriebsskripte.md), Grenzen). Aktionen laufen deshalb mit `cmd.run()` ohne Ausgabe (Go verbindet `NUL`); ihr Ergebnis liest die Route danach mit `status -Json`.
- **UTF-8:** `-Json` schreibt jetzt über `Write-JsonLine`: umgeleitet als UTF-8 ohne BOM, im Konsolenfenster wie bisher. Vorher kam die Zeile in der Codepage der Konsole und Umlaute der Prüfungen („Oberfläche“) kamen falsch an.
- **Losgelöster Neustart (`restart -Detach`):** Das Skript startet sich selbst mit `restart -NoBrowser -Quiet -WaitForProcess <eigene PID>` per `Start-Process` **ohne Umleitung** und endet sofort. Ohne Umleitung geht `Start-Process` über `ShellExecuteEx`: Die neue Windows PowerShell bekommt eine eigene, verborgene Konsole und erbt keine Handles; Windows beendet einen Prozess nicht mit seinem Elternprozess. Der neue Prozess wartet, bis der Aufrufer beendet ist (höchstens 10 s), und macht dann den normalen `restart`: geordnetes Beenden per `CTRL_BREAK_EVENT` an die Konsole von PocketBase, neuer Start, Zeile in `byl-control.log`.
  - **Warum nicht direkt als Kind von PocketBase:** Ein Kind von `$os.cmd` hängt an der Konsole von PocketBase. Das Signal des Stopps ginge auch an dieses Kind, und der Sender sähe eine geteilte Konsole: kein Signal, nach 15 s hartes Beenden. Deshalb die eigene Konsole, und deshalb wartet der Neustart auf das Ende des kurzen Aufrufers.
  - **Warum nicht `SysProcAttr` mit `DETACHED_PROCESS`/`CREATE_BREAKAWAY_FROM_JOB` in der JSVM:** Die Umwandlung eines JS-Objekts in das Go-Struct ist in Goja nicht zugesichert, und `CREATE_BREAKAWAY_FROM_JOB` scheitert in Jobs ohne Erlaubnis. `Start-Process` ist derselbe Weg, auf dem das Skript täglich PocketBase startet.
- **Beleg (Spike vom 2026-09-30, Wegwerf-Kopie unter `.tmp\`, Zufallsport, Superuser vorher, `BYL_TEST_ISOLATED=1`):** Die Route mit `$os.cmd(… status -Json)` lieferte das JSON des Skripts (Exit-Code 0). Die Neustart-Route antwortete nach 480 ms; die losgelöste PowerShell (PID 23648) lief weiter, nachdem der Server (PID 28876) beendet war, und startete den neuen Server (PID 31748, Elternprozess 23648). `/api/health` fiel nach 2,6 s aus und antwortete nach 6,3 s wieder, der ganze Neustart dauerte 7,9 s, ohne Warnung „hart beendet“; `byl-control.log`: „restart exit=0 pid=31748“. `tests/integration/system-control.test.mjs` wiederholt das bei jedem Lauf: Der alte Server ist nach unter 14 s weg (ein harter Stopp käme erst nach 15 s), ein neuer läuft mit neuer PID, Zustandsdatei und beiden Zeilen im Log.

### 3. Wer darf: der Besitzer der Instanz

- Nur angemeldete App-Konten (`users`); ein Admin-Konto (Superuser) bekommt 403.
- **Besitzer ist das App-Konto, das zuerst angelegt wurde** (kleinstes `created`, bei Gleichstand kleinste ID). Begründung: Nach ADR-0002 legt, wer die App einrichtet, nach dem Installer sein Admin-Konto und dann **sein** App-Konto an; Mitglieder eines Haushalts (E7) legt er später in der Verwaltung an, sie sind also nie das erste Konto. Die Regel braucht keine Migration, kein Feld, das ein Nutzer ändern könnte, und keine Einstellung. Sie gilt, solange es kein ausdrückliches Recht gibt.
- **Grenzen:** Wird das erste Konto gelöscht (nur in der Verwaltung möglich), ist das nächstälteste Besitzer. Mit E7 soll ein ausdrückliches Recht (etwa ein Feld „Admin der Instanz“, das nur das Admin-Konto setzt) die Regel ersetzen; die Prüfung steht an einer Stelle (`ownerId` in `lib/system-service.js`). Ein Admin-Konto kann die App nicht bedienen und damit auch diese Seite nicht.

### 4. Sicherheitsprüfungen

Jede Route prüft in dieser Reihenfolge; die erste Ablehnung antwortet mit `{ status, message, reason }`:

| Prüfung | Ablehnung |
|---|---|
| angemeldetes App-Konto (`$apis.requireAuth('users')`) | 401 bzw. 403 |
| Server unter Windows (dieselbe Regel wie `GET /api/byl/host`) | 404 `platform` |
| dieser Rechner: `e.remoteIP()` **und** `e.realIP()` Loopback, keine Kopfzeile `Forwarded`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Real-IP` | 403 `loopback` |
| Adresse der App: `Host` ist `127.0.0.1`, `localhost` oder `[::1]` mit dem Port aus `--http`; ein POST trägt den `Origin` genau dieser Adresse; `Sec-Fetch-Site`, wenn gesendet, ist `same-origin`; ein GET darf ohne `Origin` kommen | 403 `origin` |
| Besitzer der Instanz (§3) | 403 `owner` |
| Rate-Limit je Konto: 30 Lesezugriffe und 10 Aktionen je Minute (`$app.store()`) | 429 `rate` mit `Retry-After` |
| eigene Instanz: Hooks in `<app>\pb_hooks`, der Server ist `<app>\pocketbase.exe serve --http=127.0.0.1:<Port> --dir=<app>\pb_data` (wie `Select-AppProcess`), `byl-control.ps1` liegt daneben | 503 `unavailable` |
| eine Aktion zur Zeit, kein zweiter Neustart binnen 90 s | 409 `busy` |

- **Whitelist:** Sieben Namen mit festen Argumenten (`status`, `doctor`, `logs`, `restart`, `mail-restart`, `autostart-on`, `autostart-off`). Der Name in `/api/byl/system/actions/{action}` wählt nur einen Eintrag; nichts aus der Anfrage erreicht die Befehlszeile. Ein unbekannter Name (auch `stop`, `reset-admin`, `constructor`) führt nichts aus (404 `unknown`).
- **CSRF und DNS-Rebinding:** Die App sendet ihr Token im Kopf `Authorization`, nie per Cookie; eine fremde Seite kann es nicht mitschicken. Die Prüfung von `Host` und `Origin` kommt trotzdem dazu, sodass auch ein Token, das in eine Seite geraten ist, von dort nichts auslöst. Skripte ohne `Origin` können nur lesen; sie haben die `.bat`-Dateien.
- **Harness und Entwicklung:** Eine Instanz der Tests (Hooks im Temp-Ordner, anderer Datenordner) führt nie einen Befehl aus; sie antwortet 503.
- **Audit:** Das Log von PocketBase (Verwaltung → Logs) bekommt je Aktion „byl-system: Aktion ausgeführt“ (Stufe info: Aktion, ID des Kontos, Exit-Code) und je Ablehnung „byl-system: Anfrage abgelehnt“ (warn: Aktion, Grund, ID des Kontos, Adresse). Keine Werte, keine Tokens, keine E-Mail-Adressen. Das Skript schreibt wie immer seine Zeile in `byl-control.log` (`mail-restart` neu, der Aufrufer des Neustarts mit `detached=<PID>`). Beim Neustart schreibt PocketBase seine gesammelten Einträge beim geordneten Beenden weg (im Test belegt).
- **Logs ohne Geheimnisse:** Das Skript ersetzt die Werte aller `BYL_*`-Variablen des Kontos und seines Prozesses (ab 4 Zeichen, auch URL-kodiert) durch `***` (`Protect-LogText`), kürzt Zeilen auf 2000 Zeichen und liefert je Datei höchstens 200 Zeilen. Die Route nimmt darauf `secrets.redact` (Werte der Variablen, die der Server kennt, Adressen nur mit Schema und Host, Tokens von Telegram und Notion) und maskiert Lokalteile von E-Mail-Adressen, Werte nach `Bearer`, Zugangsschlüssel `byl_…` und Tokens in JWT-Form (Sitzungen, Einrichtungslink).
- **Autostart der Tests:** Eine isolierte Testkopie (`BYL_TEST_ISOLATED=1`) nimmt als Autostart-Ordner nur `BYL_TEST_STARTUP_DIR` und sonst keinen; den Autostart-Ordner des Kontos liest allein `Get-StartupFolder` und nur außerhalb von Testkopien.

### 5. Oberfläche

- `SystemView` mit dem `SystemStore` der Seite (Datenschicht `data/system.ts`, Regeln und Texte `domain/system.ts`), Bausteine nach ADR-0026 (`SectionMessage`, `Lozenge`, `EmptyState`), Bestätigung nach ADR-0025 §4. Rot nur für echte Fehler (Skript scheitert, App antwortet nach dem Neustart nicht, Prüfung „Fehler“).
- **Neustart:** Vorher die Frage „becauseyoulovejira jetzt neu starten?“ mit dem Hinweis, dass die App einige Sekunden nicht erreichbar ist, offene Tabs sich selbst neu verbinden und Eingaben in anderen Tabs vorher zu speichern sind (wie der Hinweis `APP_UPDATED.unsaved` aus ADR-0040). Dieser Tab hat auf der Seite keine Entwürfe (wer ein Ticket mit Eingaben verlässt, wird schon gefragt); ob andere Tabs welche haben, weiß er nicht, deshalb steht der Satz immer da. Danach zeigt die Seite „Neustart läuft …“ („wird geordnet beendet“, dann „startet wieder“), fragt jede Sekunde `/api/health`, bis der Server weg war und wieder antwortet (oder mit neuer Startzeit antwortet), lädt den Stand neu und meldet „becauseyoulovejira wurde neu gestartet.“ als Flag. Nach 90 s ohne Rückkehr steht ein Fehler mit `start.bat` und `byl-control.log`. Das kurze Abfragen betrifft den Server, nicht Daten (CLAUDE.md §7), und endet mit dem Neustart.
- Knöpfe laufender Aktionen tragen `aria-busy`, die anderen `aria-disabled`; sie bleiben fokussierbar.
- Unter Linux und im Container (`GET /api/byl/host`) fehlt der Eintrag in der Navigation, und die Adresse zeigt nur den Hinweis, dass die Seite einen Server unter Windows braucht; der Plattform-Ausbau bleibt zurückgestellt.
- Die Hilfe „Betrieb“ nennt die Seite.

### 6. Tests

- Rein: `tests/unit/system-rules.test.mjs` (Whitelist, Befehlszeile, Prüfungen, Rate-Limit, Antworten, Logs), `tests/unit/system-control-logic.test.mjs` (`Protect-LogText`, Befehlszeile des Neustarts), statisch `tests/unit/start-scripts.test.mjs`.
- Jede Ablehnung einzeln gegen Wegwerf-Instanzen: `tests/integration/system-route.test.mjs`.
- Echte Befehle, losgelöster Neustart und Audit gegen eine Wegwerf-Kopie des Ordners `app` unter `.tmp\` (Zufallsport, Superuser vorher, bereinigte Umgebung, `BYL_TEST_ISOLATED`, eigener Autostart-Ordner, eigener Port des Mail-Helfers): `tests/integration/system-control.test.mjs`.
- Oberfläche: `domain/system.test.ts`, `stores/system-store.test.ts`, `components/system/system-view.test.ts`, `routes/(app)/einstellungen/system/system-page.test.ts`, Navigation und Hilfe.

## Grenzen

- Ein gescheiterter Neustart kann der Seite nichts mehr melden; sie nennt nach 90 s `start.bat` und `byl-control.log`.
- Ein Proxy auf diesem Rechner, der keine Kopfzeilen setzt, sähe aus wie ein lokaler Zugriff. Heute lauscht der Server nur auf `127.0.0.1`; wer später einen Proxy davorsetzt (ADR-0001, Plattform-Stufen S2/S3), muss dessen Kopfzeilen setzen und in PocketBase als vertrauenswürdig eintragen, dann greift `e.realIP()`.
- `$os.cmd` hat keine Zeitgrenze; die Befehle begrenzen sich selbst (Health 2 s, Stopp 15 s je Prozess, Warten auf den Port 10 s).
- Werte einer `BYL_*`-Variablen, die vor dem Start des Servers geändert und danach aus dem Konto entfernt wurden, kennt niemand mehr; alte Log-Zeilen mit ihnen blieben lesbar. Die Programme schreiben keine Werte in ihre Logs (ADR-0018, ADR-0039 §6); das Entfernen ist ein zweites Netz.
- Nur Windows.

## Alternativen

- **Frei übergebene Befehle oder Argumente:** verworfen; nur die Whitelist.
- **„Beenden“ als Aktion:** vom Nutzer ausgeschlossen, und nach ADR-0039 eine Angriffsfläche; `stop.bat` bleibt.
- **Neustart im Prozess von PocketBase** (`$os.exit` und Start durch etwas anderes): Nichts würde neu starten. Verworfen.
- **Kind direkt aus der JSVM mit Erstellungs-Flags:** siehe §2. Verworfen zugunsten von `Start-Process` im Skript.
- **Windows-Dienst oder geplante Aufgabe:** Plattform-Stufe S4, zurückgestellt; eine geplante Aufgabe braucht je nach Richtlinie andere Rechte. Verworfen.
- **Nur mit dem Admin-Konto (Superuser):** Die App meldet nur App-Konten an; das hieße eine zweite Anmeldung in der SPA. Verworfen.
- **Feld `users.instance_admin`:** braucht Migration, API-Regel und Pflege; vor E7 ohne Nutzen. Zurückgestellt auf E7.
- **Eigene Knöpfe „Jetzt neu starten“ und „Nur wenn nötig“:** Die Seite zeigt den Stand ohnehin; zwei Knöpfe mit fast gleicher Wirkung verwirren. Ein Knopf mit Hinweis, `neu-starten.bat` bleibt.

## Konsequenzen

- Positiv: Status, Neustart, Mail-Helfer, Autostart, Prüfung und Logs ohne Dateien im Ordner `app`; die Regeln und die Sicherheitsregel des Stopps aus ADR-0039 bleiben, weil die Seite nur deren Befehle aufruft.
- Negativ: vier Routen, die Prozesse starten; sie sind klein, eng begrenzt und je Ablehnung getestet.
- Neue Hooks wirken erst nach einem Neustart der Instanz (`neu-starten.bat`); bis dahin sagt die Seite „Nach dem nächsten Neustart verfügbar“.

## Nachtrag (2026-10-01, [ADR-0046](0046-sicherung-pruefung-wiederherstellen.md), BK-1): Die Seite „Sicherung“ nutzt dieselben Prüfungen

- Die Routen der Seite „Einstellungen → Sicherung“ (`backup.pb.js`, `lib/backup-service.js`) prüfen in derselben Reihenfolge mit derselben Funktion (`check` aus `lib/system-service.js`, jetzt mit der Art des Rate-Limits und `local` für eine Route ohne Befehl) und loggen ihre Ablehnungen als „byl-backup: Anfrage abgelehnt“. Die eigene Instanz prüft `ownAppDir` (auch für den Cron der Sicherung).
- **Whitelist:** Vier Befehle der Sicherung kamen dazu (`backup-info`, `backup-configure`, `backup-passphrase`, `backup-export`) mit dem Merkmal `backup` und `input` (ein JSON-Objekt auf der Standardeingabe, `run(appDir, name, input)` schreibt es per `stdinPipe`). `/api/byl/system/actions/{action}` führt sie nicht aus (404 `unknown` wie jeder unbekannte Name); die Seite System bleibt bei ihren sieben Befehlen.
- Belegt in `system-rules.test.mjs` (Whitelist, Argumente nur Wörter und Zahlen) und `backup-control.test.mjs` (Ablehnungen und echte Befehle gegen eine Wegwerf-Kopie).

## Nachtrag (2026-10-01, [ADR-0046](0046-sicherung-pruefung-wiederherstellen.md), BK-2): Prüfen aus der Seite „Sicherung“

- **Whitelist:** `backup-verify` kam dazu (Merkmal `backup`, `input`). Die Route `POST /api/byl/backup/verify` prüft wie die übrigen, zählt als Änderung (zehn je Minute: eine Prüfung belegt Platte und Prozessor etwa eine Minute) und läuft nur, wenn weder „Jetzt sichern“ noch der Cron der Sicherung laufen (409 `busy`). Namen nur nach den Mustern ihres Orts, kein Pfad aus der App.
- Belegt in `system-rules.test.mjs` und `backup-control.test.mjs`.

## Nachtrag (2026-10-01, [ADR-0046](0046-sicherung-pruefung-wiederherstellen.md), BK-3): Wiederherstellen als losgelöster Lauf

- **Whitelist:** `backup-restore` (`restore -Detach -Quiet`, Merkmal `backup`, `input`, **ohne gelesene Ausgabe** wie `restart`: Der Befehl startet einen Prozess, der den Server überdauert). `run` gibt seitdem auch einem Befehl ohne Ausgabe seine Eingabe per `stdinPipe`, ohne ihm eine Pipe für die Ausgabe zu geben. Die Antwort des Befehls ist der Zustand in `run\wiederherstellung.json` (`started` oder `failed` mit Grund), den die Route nach seinem Ende liest: 202 mit der Zeit des Zustands, 400 `invalid` mit dem Grund, sonst `script`.
- **Route** `POST /api/byl/backup/restore` mit denselben Prüfungen, dem Wort `WIEDERHERSTELLEN` und der Wahl für die Zugangsdaten; nicht neben „Jetzt sichern“, einer Prüfung oder einer laufenden Wiederherstellung (409 `busy`). `GET /api/byl/backup/restore` (lesend, ohne Steuerskript) nennt den Stand auch während und nach dem Neustart, den die Wiederherstellung auslöst. Wie beim Neustart (§3) überdauert der losgelöste Prozess den Server, der ihn gestartet hat; er beendet ihn geordnet und startet ihn wieder.
- Belegt in `system-rules.test.mjs` und `backup-restore-control.test.mjs`.

## Nachtrag (2026-10-02, [ADR-0048](0048-fehlerkatalog-der-skripte.md), RS-1): Problem im Hintergrund und „Was tun?“

- **Problem im Hintergrund:** Scheitert ein Lauf ohne Fenster (Autostart, der Neustart dieser Seite, eine Wiederherstellung aus der App), merkt sich das Steuerskript den Eintrag des Fehlerkatalogs in `run\hintergrund-problem.json`; `status -Json` liefert ihn als `backgroundProblem`. Die Seite zeigt ihn über dem Zustand als Warnung „Problem beim letzten Lauf ohne Fenster“ mit Lauf und Zeit, Ursache, Schritten, dem Befehl zum Kopieren (Code-Block) und dem Log. Warnung, nicht Fehler (ADR-0009): Wer die Seite sieht, hat eine laufende App. Er verschwindet mit dem nächsten Lauf ohne Fenster, der gelingt, oder mit dem nächsten Lauf im Fenster (`status.bat`, `start.bat` …), der ihn einmal zeigt; die Seite selbst löscht nichts und braucht dafür keinen weiteren Befehl.
- **„Umgebung prüfen“:** Jede Prüfung mit Befund hat „Was tun?“ (aufklappbar) mit demselben Eintrag.
- **Antworten der Route:** `statusView` und `doctorView` reichen die Einträge nur geprüft weiter (`problemView`: Code, Stufe `error` oder `warning`, Texte als Zeichenketten, ohne E-Mail-Adressen und Tokens wie eine Zeile im Log); ein ungültiger Eintrag wird `null`. Keine neue Route und kein neuer Befehl.
- Belegt in `system-rules.test.mjs`, `system.test.ts`, `system-view.test.ts` und `system-control.test.mjs` (gemerkter Fehler einer Wegwerf-Kopie über die echte Route).
