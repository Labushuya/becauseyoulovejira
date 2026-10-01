# Catalog of the problems of the scripts (ADR-0048, plan robuste-skripte RS-1). Every way a script
# can fail - byl-control.ps1, the .bat files, start-hidden.vbs and the build scripts in scripts\ -
# has one entry here: what went wrong (Problem), the likely cause (Cause), the steps that help
# (Steps) and, where one exists, a command to copy (Command) with the real paths of this folder.
# Format-BylProblem prints every entry alike:
#
#   × Problem:   Port 8090 auf 127.0.0.1 ist belegt; becauseyoulovejira startet dort nicht.
#     Ursache:   ...
#     So geht's: 1. ...
#                2. ...
#                Befehl zum Kopieren:
#                  powershell -NoProfile -ExecutionPolicy Bypass -File "<folder>\app\byl-control.ps1" port 8091
#     Details:   <folder>\app\logs\byl-control.log
#
# Fields of an entry:
#   Exit     exit code of the command (ADR-0039: 1 error, 3 not running, 4 port busy, 5 no answer);
#            0 for a hint the command goes on after
#   Level    'error' (red mark, the command fails) or 'warning' (a hint, yellow)
#   Faq      question of the entry on the help page "Betrieb" of the app; '' = not shown there
#   Problem, Cause, Steps, Command
#   Offer    question before the script solves the problem itself (only in a console window, never
#            with -Quiet, -Json, -Hidden or in a run in the background); '' = no offer
#
# Placeholders in braces are filled by Get-BylProblemReport: {control} (the control script with its
# full path), {app} (the folder app), {appq} (the same for a single-quoted PowerShell string),
# {log}, {tail} (copies the last 50 lines of the log), {build} and {fetch} (scripts of the
# repository, only when the folder app lies in one), and the values of a single call ({port},
# {next}, {file}, {detail}, ...). A command whose placeholder has no value is left out.
#
# Every text is a single-quoted string (no expansion): the help page of the app shows the entries
# with a question (web/src/lib/domain/script-problems.ts) and a test compares them with this file.
# Saved as UTF-8 with BOM and CRLF like byl-control.ps1 (umlauts in Windows PowerShell 5.1).

$BylProblemCatalog = [ordered]@{

    # --- Start, stop and restart (start.bat, stop.bat, neu-starten.bat) -------------------------

    'config-json'              = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'Die Einstellungsdatei byl-config.json ist beschädigt'
        Problem = 'Die Einstellungsdatei byl-config.json ist kein gültiges JSON. becauseyoulovejira startet deshalb nicht, damit die App nie unter einer unerwarteten Adresse läuft.'
        Cause   = 'Die Datei wurde von Hand bearbeitet und enthält einen Tippfehler, oder das Speichern wurde unterbrochen.'
        Steps   = @(
            'Die Datei {file} in einem Editor öffnen und korrigieren; erwartet wird zum Beispiel { "port": 8090 }.'
            'Oder den Port neu setzen (Befehl unten): Die beschädigte Datei bleibt als byl-config.json.defekt-… daneben liegen. Ein Zielverzeichnis der Sicherung trägst du danach unter Einstellungen → Sicherung neu ein.'
        )
        Command = '{control} port 8090'
        Offer   = 'Soll ich die beschädigte Datei beiseitelegen und Port 8090 einstellen? (J/N)'
    }
    'config-port'              = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'In byl-config.json steht ein ungültiger Port'
        Problem = 'In byl-config.json steht kein gültiger Port (erlaubt sind ganze Zahlen von 1024 bis 65535). becauseyoulovejira startet deshalb nicht.'
        Cause   = 'Der Wert von „port“ wurde von Hand geändert und ist keine Zahl oder liegt außerhalb des Bereichs.'
        Steps   = @(
            'Den Port wieder auf den Standard 8090 stellen (Befehl unten) oder statt 8090 einen anderen freien Port nehmen. Die übrigen Einstellungen in der Datei bleiben erhalten.'
        )
        Command = '{control} port 8090'
        Offer   = 'Soll ich Port 8090 einstellen? (J/N)'
    }
    'config-write'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'byl-config.json ließ sich nicht schreiben ({detail}).'
        Cause   = 'Der Ordner app ist schreibgeschützt, die Datei ist gerade gesperrt, oder das Laufwerk ist voll.'
        Steps   = @(
            'Die Prüfung ausführen (Befehl unten) und beheben, was sie als Fehler nennt.'
            'Danach den Befehl erneut ausführen.'
        )
        Command = '{control} doctor'
        Offer   = ''
    }
    'pocketbase-missing'       = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'pocketbase.exe fehlt'
        Problem = 'pocketbase.exe fehlt im Ordner {app}.'
        Cause   = 'Der Ordner app ist unvollständig: Die Datei wurde nicht mitkopiert, ein Virenscanner hat sie entfernt, oder das Projekt kommt frisch aus Git (pocketbase.exe liegt nicht im Repository).'
        Steps   = @(
            'pocketbase.exe aus einer Kopie oder Sicherung des Ordners app zurücklegen.'
            'Im Repository lädt scripts\fetch-pocketbase.ps1 die geprüfte Version (dafür ist Node.js 24 nötig).'
        )
        Command = '{fetch}'
        Offer   = ''
    }
    'app-incomplete'           = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Im Ordner {app} fehlt {name}; der Ordner app ist unvollständig.'
        Cause   = 'Beim Kopieren, Entpacken oder Aktualisieren ist nicht alles mitgekommen.'
        Steps   = @(
            'Den Ordner app erneut aus der Quelle kopieren; pb_data und byl-config.json dabei behalten.'
            'In einem Repository stellt git status die fehlenden Dateien fest, git checkout holt sie zurück.'
        )
        Command = ''
        Offer   = ''
    }
    'folder-not-writable'      = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'Der Ordner der App ist nicht beschreibbar'
        Problem = 'becauseyoulovejira kann im Ordner {folder} nicht schreiben ({detail}).'
        Cause   = 'Der Ordner ist schreibgeschützt, gehört einem anderen Konto, liegt an einem Ort ohne Schreibrecht (etwa im Ordner „Programme“), oder ein Virenscanner sperrt ihn.'
        Steps   = @(
            'Den Ordner app an einen Ort legen, an dem dein Konto schreiben darf, etwa in deinen Benutzerordner.'
            'Oder im Explorer: Rechtsklick auf den Ordner, Eigenschaften, Sicherheit, deinem Konto „Ändern“ erlauben.'
            'Danach mit dem Befehl unten prüfen.'
        )
        Command = '{control} doctor'
        Offer   = ''
    }
    'web-missing'              = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = 'Im Browser steht nur „File not found“'
        Problem = 'Die Oberfläche fehlt (pb_public\index.html). Die App startet trotzdem; im Browser steht dann nur „File not found“, die Verwaltung unter /_/ geht.'
        Cause   = 'Der Ordner app kommt frisch aus dem Repository und wurde noch nicht gebaut, oder der Build ist abgebrochen.'
        Steps   = @(
            'Im Repository scripts\build.ps1 ausführen und danach im Browser neu laden.'
        )
        Command = '{build}'
        Offer   = ''
    }
    'pocketbase-start'         = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'pocketbase.exe ließ sich nicht starten ({detail}).'
        Cause   = 'Ein Virenscanner blockiert die Datei, sie ist beschädigt, oder Windows verweigert den Start (etwa eine Richtlinie für Programme).'
        Steps   = @(
            'Prüfen, ob ein Virenscanner pocketbase.exe in Quarantäne genommen hat, und die Datei freigeben.'
            'pocketbase.exe aus einer Kopie zurücklegen oder im Repository mit scripts\fetch-pocketbase.ps1 neu laden.'
            'Danach start.bat erneut ausführen.'
        )
        Command = '{fetch}'
        Offer   = ''
    }
    'pocketbase-exited'        = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'PocketBase beendet sich gleich beim Start'
        Problem = 'PocketBase wurde beim Start beendet (Exit-Code {code}).'
        Cause   = 'Den Grund nennen meist die letzten Zeilen des Server-Logs: eine Migration scheitert, die Datenbank ist beschädigt, oder ein anderes Programm sperrt eine Datei in pb_data (eine zweite Kopie der App, ein Sicherungsprogramm).'
        Steps   = @(
            'Die Zeilen des Server-Logs lesen (oben bzw. mit dem Befehl unten).'
            'Läuft eine andere Kopie der App mit demselben Ordner pb_data, diese beenden.'
            'Danach start.bat erneut ausführen.'
            'Hilft das nicht: die letzten Zeilen des Server-Logs an Claude schicken.'
        )
        Command = '{control} logs server'
        Offer   = ''
    }
    'health-timeout'           = @{
        Exit    = 5
        Level   = 'error'
        Faq     = 'Die App startet, antwortet aber nicht'
        Problem = 'PocketBase hat nach {seconds} Sekunden nicht auf /api/health geantwortet.'
        Cause   = 'Der Rechner ist stark ausgelastet, ein Virenscanner prüft die Dateien beim ersten Start, oder eine lange Migration läuft noch.'
        Steps   = @(
            'Einen Moment warten und mit status.bat nachsehen.'
            'Antwortet die App weiter nicht: neu-starten.bat ausführen und danach die Logs ansehen (Befehl unten).'
            'Der Server läuft eventuell weiter; stop.bat beendet ihn.'
        )
        Command = '{control} logs server'
        Offer   = ''
    }
    'port-busy'                = @{
        Exit    = 4
        Level   = 'error'
        Faq     = 'Der Port ist belegt'
        Problem = 'Port {port} auf 127.0.0.1 ist belegt; becauseyoulovejira startet dort nicht.'
        Cause   = 'Ein anderes Programm nutzt die Adresse der App, oft eine zweite Kopie von becauseyoulovejira oder ein Entwicklungsserver. Es bleibt unberührt; die App weicht nie von selbst auf einen anderen Port aus.'
        Steps   = @(
            'Das andere Programm beenden (eine andere Kopie der App mit ihrem stop.bat) und start.bat erneut ausführen.'
            'Oder becauseyoulovejira auf den freien Port {next} umstellen (Befehl unten) und start.bat ausführen. Lesezeichen, die installierte App und die Browser-Erweiterung für WhatsApp Web brauchen dann die neue Adresse; anmelden musst du dich dort einmal neu.'
        )
        Command = '{control} port {next}'
        Offer   = 'Soll ich becauseyoulovejira auf Port {next} umstellen und starten? (J/N)'
    }
    'app-unhealthy'            = @{
        Exit    = 5
        Level   = 'error'
        Faq     = 'Die App läuft, antwortet aber nicht'
        Problem = 'becauseyoulovejira läuft (PID {pid}, {url}), antwortet aber nicht auf /api/health.'
        Cause   = 'Der Server hängt, ist überlastet oder wird von einem anderen Programm blockiert.'
        Steps   = @(
            'Neu starten: neu-starten.bat doppelklicken oder den Befehl unten ausführen.'
            'Bleibt es dabei, die Logs ansehen: logs server statt restart im Befehl.'
        )
        Command = '{control} restart'
        Offer   = 'Soll ich becauseyoulovejira jetzt neu starten? (J/N)'
    }
    'start-vanished'           = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die gerade startende Instanz (PID {pid}) hat sich wieder beendet.'
        Cause   = 'Der Server ist beim Start abgestürzt, oder ein anderer Start hat ihn ersetzt.'
        Steps   = @(
            'start.bat erneut ausführen.'
            'Passiert es wieder, die Logs ansehen (Befehl unten).'
        )
        Command = '{control} logs server'
        Offer   = ''
    }
    'not-running'              = @{
        Exit    = 3
        Level   = 'error'
        Faq     = ''
        Problem = 'becauseyoulovejira läuft nicht.'
        Cause   = 'Die App wurde beendet oder noch nicht gestartet.'
        Steps   = @(
            'start.bat doppelklicken oder den Befehl unten ausführen.'
        )
        Command = '{control} start'
        Offer   = 'Soll ich becauseyoulovejira jetzt starten? (J/N)'
    }
    'stop-failed'              = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'Die App lässt sich nicht beenden'
        Problem = 'becauseyoulovejira ließ sich nicht beenden.'
        Cause   = 'Windows verweigert das Beenden, etwa weil der Prozess mit Administratorrechten oder unter einem anderen Konto läuft, oder er hängt.'
        Steps   = @(
            'stop.bat noch einmal ausführen.'
            'Hilft das nicht: im Task-Manager unter „Details“ den Prozess mit der genannten PID beenden oder Windows neu starten.'
            'Danach mit dem Befehl unten prüfen, ob noch etwas läuft.'
        )
        Command = '{control} status'
        Offer   = ''
    }
    'hard-stop'                = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = ''
        Problem = 'Nicht rechtzeitig geordnet beendet, daher hart beendet: {name}.'
        Cause   = 'Der Prozess hat auf das Signal zum Beenden nicht innerhalb von 15 Sekunden reagiert, etwa weil der Rechner ausgelastet war.'
        Steps   = @(
            'Nichts zu tun: Bereits gespeicherte Änderungen bleiben erhalten; SQLite übernimmt sie beim nächsten Start.'
            'Passiert das öfter, die letzte Zeile von byl-control.log ansehen: break= nennt die Codes der Signale.'
        )
        Command = '{control} logs skript'
        Offer   = ''
    }
    'port-still-busy'          = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = ''
        Problem = 'Port {port} ist {seconds} Sekunden nach dem Beenden noch belegt.'
        Cause   = 'Windows gibt den Port mit Verzögerung frei, oder ein anderes Programm hat ihn inzwischen übernommen.'
        Steps   = @(
            'Vor dem nächsten Start den Zustand ansehen (Befehl unten); start.bat nennt ein anderes Programm auf dem Port.'
        )
        Command = '{control} status'
        Offer   = ''
    }
    'detach-failed'            = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Der Neustart im Hintergrund ließ sich nicht starten ({detail}).'
        Cause   = 'Windows PowerShell konnte keinen eigenen Prozess starten (Richtlinie, Virenscanner oder zu wenig Speicher).'
        Steps   = @(
            'neu-starten.bat im Ordner app doppelklicken.'
            'Hilft das nicht: die letzten 50 Zeilen des Logs kopieren (Befehl unten) und an Claude schicken.'
        )
        Command = '{tail}'
        Offer   = ''
    }
    'detach-only'              = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = '-Detach und -WaitForProcess gelten nur für restart und restore.'
        Cause   = 'Der Befehl wurde mit einem Schalter aufgerufen, den er nicht kennt.'
        Steps   = @(
            'Die Hilfe nennt Befehle und Schalter (Befehl unten).'
        )
        Command = '{control} help'
        Offer   = ''
    }

    # --- Notes of a start (the command goes on) ----------------------------------------------------

    'state-write'              = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = ''
        Problem = 'run\byl.state.json ließ sich nicht schreiben ({detail}). status.bat und neu-starten.bat kennen den Startstand dann nicht und empfehlen einen Neustart.'
        Cause   = 'Der Ordner run ist schreibgeschützt oder gerade gesperrt.'
        Steps   = @(
            'Die Prüfung ausführen (Befehl unten) und beheben, was sie als Fehler nennt.'
        )
        Command = '{control} doctor'
        Offer   = ''
    }
    'state-delete'             = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = ''
        Problem = 'run\byl.state.json ließ sich nicht löschen ({detail}).'
        Cause   = 'Ein anderes Programm (Virenscanner, Synchronisierung) hält die Datei gerade offen.'
        Steps   = @(
            'Nichts zu tun: Der nächste Start erkennt eine veraltete Zustandsdatei und ersetzt sie.'
        )
        Command = ''
        Offer   = ''
    }
    'address-write'            = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = ''
        Problem = 'run\app-adresse.js ließ sich nicht schreiben ({detail}); becauseyoulovejira.html nimmt dann Port 8090 an.'
        Cause   = 'Der Ordner run ist schreibgeschützt oder gerade gesperrt.'
        Steps   = @(
            'Läuft die App nicht auf Port 8090, die Adresse direkt im Browser öffnen.'
            'Die Prüfung ausführen (Befehl unten) und beheben, was sie als Fehler nennt.'
        )
        Command = '{control} doctor'
        Offer   = ''
    }
    'dpapi-start'              = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = 'DPAPI ist nicht verfügbar'
        Problem = 'Die Datenverschlüsselung von Windows (DPAPI) ist für dieses Konto nicht verfügbar ({detail}). Die App startet; status.bat erkennt aber nicht, ob sich eine BYL_-Variable geändert hat.'
        Cause   = 'Das Benutzerprofil ist nur vorübergehend geladen, oder eine Richtlinie sperrt DPAPI (selten, etwa bei Domänenkonten).'
        Steps   = @(
            'Nach dem Ändern einer BYL_-Variable immer neu starten (Befehl unten); neu-starten.bat erkennt den Bedarf dann nicht von selbst.'
            'Bei einem Konto einer Firma oder Schule die IT fragen, ob DPAPI gesperrt ist.'
        )
        Command = '{control} restart'
        Offer   = ''
    }
    'ingest-token'             = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = ''
        Problem = 'Der Zugang für byl-mail.exe (BYL_INGEST_TOKEN) ließ sich nicht anlegen ({detail}). Postfächer werden nicht abgerufen.'
        Cause   = 'Windows hat das Schreiben der Benutzervariable verweigert.'
        Steps   = @(
            'start.bat erneut ausführen; der nächste Start versucht es wieder.'
            'Bleibt es dabei: in Windows „Umgebungsvariablen für dieses Konto bearbeiten“ öffnen und prüfen, ob sich Variablen anlegen lassen.'
        )
        Command = ''
        Offer   = ''
    }
    'mail-helper-start'        = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = 'Der Mail-Helfer startet nicht'
        Problem = 'Der Mail-Hilfsprozess byl-mail.exe ließ sich nicht starten ({detail}). Die App läuft, nur Postfächer werden nicht abgerufen.'
        Cause   = 'byl-mail.exe ist gesperrt oder beschädigt, oder ein Virenscanner blockiert die Datei.'
        Steps   = @(
            'Die Fehler des Mail-Helfers ansehen (Befehl unten).'
            'Danach unter Einstellungen → System „Mail-Helfer neu starten“ oder neu-starten.bat.'
        )
        Command = '{control} logs mail'
        Offer   = ''
    }
    'disk-low'                 = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = 'Auf dem Laufwerk ist wenig Platz'
        Problem = 'Auf dem Laufwerk der App sind nur noch {free} MB frei.'
        Cause   = 'Datenbank, Sicherungen und Logs brauchen Platz; unter 100 MB können Speichern und Sichern scheitern.'
        Steps   = @(
            'Platz schaffen: Papierkorb von Windows leeren und die Datenträgerbereinigung ausführen (Befehl unten).'
            'Ältere Sicherungen aus pb_data\backups auf ein anderes Laufwerk verschieben.'
        )
        Command = 'cleanmgr'
        Offer   = ''
    }
    'disk-critical'            = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Auf dem Laufwerk der App sind nur noch {free} MB frei; Speichern und Sichern können scheitern.'
        Cause   = 'Das Laufwerk ist fast voll.'
        Steps   = @(
            'Sofort Platz schaffen: Papierkorb von Windows leeren und die Datenträgerbereinigung ausführen (Befehl unten).'
            'Ältere Sicherungen aus pb_data\backups auf ein anderes Laufwerk verschieben.'
        )
        Command = 'cleanmgr'
        Offer   = ''
    }
    'disk-unknown'             = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = ''
        Problem = 'Der freie Platz auf dem Laufwerk der App ließ sich nicht ermitteln.'
        Cause   = 'Das Laufwerk ist ein Netzlaufwerk ohne diese Angabe, oder es fehlen Rechte.'
        Steps   = @(
            'Im Explorer nachsehen, wie viel Platz auf dem Laufwerk frei ist.'
        )
        Command = ''
        Offer   = ''
    }
    'autostart-other'          = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = ''
        Problem = 'Der Autostart zeigt auf einen anderen Ordner der App.'
        Cause   = 'Der Ordner app wurde verschoben oder kopiert, oder eine andere Kopie hat ihren Autostart eingerichtet.'
        Steps   = @(
            'autostart-an.bat in diesem Ordner ausführen oder den Befehl unten; die Verknüpfung wird ersetzt.'
        )
        Command = '{control} autostart-on'
        Offer   = ''
    }

    # --- Further commands ----------------------------------------------------------------------------

    'command-unknown'          = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Unbekannter Befehl „{name}“.'
        Cause   = 'byl-control.ps1 kennt nur diese Befehle: {commands}.'
        Steps   = @(
            'Den Befehl richtig schreiben; die Hilfe (Befehl unten) zeigt alle mit ihren Schaltern.'
        )
        Command = '{control} help'
        Offer   = ''
    }
    'mail-not-running'         = @{
        Exit    = 3
        Level   = 'error'
        Faq     = ''
        Problem = 'becauseyoulovejira läuft nicht; der Mail-Hilfsprozess braucht die App.'
        Cause   = 'Die App wurde beendet oder noch nicht gestartet.'
        Steps   = @(
            'Die App starten (start.bat oder Befehl unten); der Mail-Hilfsprozess startet mit ihr, wenn ein Postfach eingeschaltet ist.'
        )
        Command = '{control} start'
        Offer   = 'Soll ich becauseyoulovejira jetzt starten? (J/N)'
    }
    'mail-stop-failed'         = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Der Mail-Hilfsprozess byl-mail.exe ließ sich nicht beenden.'
        Cause   = 'Windows verweigert das Beenden, oder der Prozess hängt.'
        Steps   = @(
            'Die ganze App neu starten (Befehl unten); das beendet auch den Mail-Helfer.'
            'Hilft das nicht: im Task-Manager unter „Details“ den Prozess mit der genannten PID beenden.'
        )
        Command = '{control} restart'
        Offer   = ''
    }
    'logs-unknown'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Unbekanntes Log „{name}“.'
        Cause   = 'Der Befehl logs kennt nur server, mail, skript oder alle.'
        Steps   = @(
            'Einen dieser Namen angeben; ohne Namen zeigt der Befehl unten alle Logs.'
        )
        Command = '{control} logs'
        Offer   = ''
    }
    'logs-follow-json'         = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = '-Follow und -Json gehen nicht zusammen.'
        Cause   = '-Follow folgt einem Log im Fenster, -Json liefert einmal das Ergebnis für Programme.'
        Steps   = @(
            'Nur einen der beiden Schalter verwenden.'
        )
        Command = '{control} logs server -Follow'
        Offer   = ''
    }
    'logs-follow-one'          = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = '-Follow folgt genau einem Log.'
        Cause   = 'Ohne Namen meint logs alle Logs.'
        Steps   = @(
            'server, mail oder skript angeben, etwa wie im Befehl unten.'
        )
        Command = '{control} logs server -Follow'
        Offer   = ''
    }
    'log-missing'              = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Das Log {file} gibt es noch nicht.'
        Cause   = 'Server bzw. Mail-Helfer sind in diesem Ordner noch nicht gelaufen.'
        Steps   = @(
            'Die App erst starten (start.bat), dann erneut versuchen.'
        )
        Command = '{control} start'
        Offer   = ''
    }
    'port-invalid'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = '„{value}“ ist kein gültiger Port.'
        Cause   = 'Erlaubt sind ganze Zahlen von 1024 bis 65535.'
        Steps   = @(
            'Eine Zahl in diesem Bereich angeben, etwa 8091 wie im Befehl unten.'
        )
        Command = '{control} port 8091'
        Offer   = ''
    }
    'autostart-test'           = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Der Autostart ist in dieser Testkopie gesperrt.'
        Cause   = 'Eine isolierte Testkopie (BYL_TEST_ISOLATED) hat keinen eigenen Autostart-Ordner (BYL_TEST_STARTUP_DIR).'
        Steps   = @(
            'Nur in Tests: BYL_TEST_STARTUP_DIR auf einen Ordner des Tests setzen.'
        )
        Command = ''
        Offer   = ''
    }
    'autostart-vbs-missing'    = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'start-hidden.vbs fehlt im Ordner {app}.'
        Cause   = 'Der Ordner app ist unvollständig.'
        Steps   = @(
            'start-hidden.vbs aus einer Kopie des Ordners app oder aus dem Repository zurücklegen und autostart-an.bat erneut ausführen.'
        )
        Command = ''
        Offer   = ''
    }
    'autostart-write'          = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'Der Autostart lässt sich nicht einrichten'
        Problem = 'Der Autostart ließ sich nicht einrichten: Die Verknüpfung im Autostart-Ordner konnte nicht gespeichert werden ({detail}).'
        Cause   = 'Der Autostart-Ordner von Windows ist schreibgeschützt oder gesperrt (Richtlinie, Virenscanner, Synchronisierung mit OneDrive).'
        Steps   = @(
            'Den Autostart-Ordner öffnen (Befehl unten) und prüfen, ob du dort eine Datei anlegen kannst.'
            'Danach autostart-an.bat erneut ausführen.'
        )
        Command = 'explorer shell:startup'
        Offer   = ''
    }
    'autostart-remove'         = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Der Autostart ließ sich nicht entfernen ({detail}).'
        Cause   = 'Der Autostart-Ordner ist schreibgeschützt oder die Verknüpfung gerade gesperrt.'
        Steps   = @(
            'Den Autostart-Ordner öffnen (Befehl unten) und becauseyoulovejira.lnk von Hand löschen.'
        )
        Command = 'explorer shell:startup'
        Offer   = ''
    }
    'console-needed'           = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = '{name} braucht ein Konsolenfenster.'
        Cause   = 'Der Befehl fragt nach Eingaben und wurde ohne Fenster gestartet.'
        Steps   = @(
            '{bat} im Ordner app doppelklicken oder den Befehl unten in einem Fenster ausführen.'
        )
        Command = '{control} {command}'
        Offer   = ''
    }

    # --- Admin account (admin-zuruecksetzen.bat) -----------------------------------------------------

    'admin-email'              = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Das ist keine gültige E-Mail-Adresse.'
        Cause   = 'Die Eingabe hat kein @, enthält Leerzeichen oder ist zu lang.'
        Steps   = @(
            'admin-zuruecksetzen.bat erneut ausführen; es wurde nichts geändert.'
        )
        Command = '{control} reset-admin'
        Offer   = ''
    }
    'admin-password-mismatch'  = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die beiden Passwörter stimmen nicht überein.'
        Cause   = 'Bei einer der beiden verdeckten Eingaben hat sich ein Tippfehler eingeschlichen.'
        Steps   = @(
            'admin-zuruecksetzen.bat erneut ausführen; es wurde nichts geändert.'
        )
        Command = '{control} reset-admin'
        Offer   = ''
    }
    'admin-password-short'     = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Das Passwort muss mindestens {min} Zeichen lang sein.'
        Cause   = 'PocketBase verlangt für Admin-Konten diese Länge.'
        Steps   = @(
            'admin-zuruecksetzen.bat erneut ausführen und ein längeres Passwort wählen; es wurde nichts geändert.'
        )
        Command = '{control} reset-admin'
        Offer   = ''
    }
    'admin-password-long'      = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Das Passwort ist zu lang (höchstens {max} Byte; Umlaute und Sonderzeichen zählen mehrfach).'
        Cause   = 'PocketBase nimmt längere Passwörter nicht an.'
        Steps   = @(
            'admin-zuruecksetzen.bat erneut ausführen und ein kürzeres Passwort wählen; es wurde nichts geändert.'
        )
        Command = '{control} reset-admin'
        Offer   = ''
    }
    'admin-password-character' = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Das Passwort darf keine Anführungszeichen (") und keine Steuerzeichen enthalten.'
        Cause   = 'Diese Zeichen kommen nicht sicher über die Befehlszeile bei PocketBase an.'
        Steps   = @(
            'admin-zuruecksetzen.bat erneut ausführen und ein Passwort ohne diese Zeichen wählen; es wurde nichts geändert.'
        )
        Command = '{control} reset-admin'
        Offer   = ''
    }
    'admin-locked'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Das Admin-Konto ließ sich nicht speichern: Die Datenbank ist gerade gesperrt.'
        Cause   = 'Die laufende App schreibt gerade, etwa eine Sicherung.'
        Steps   = @(
            'Einen Moment warten und admin-zuruecksetzen.bat erneut ausführen.'
            'Hilft das nicht: erst stop.bat, dann admin-zuruecksetzen.bat, dann start.bat.'
        )
        Command = '{control} reset-admin'
        Offer   = ''
    }
    'admin-timeout'            = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'PocketBase hat nicht innerhalb von 60 Sekunden geantwortet; das Admin-Konto wurde nicht gespeichert.'
        Cause   = 'Der Rechner ist stark ausgelastet, oder die Datenbank ist gesperrt.'
        Steps   = @(
            'Einen Moment warten und admin-zuruecksetzen.bat erneut ausführen.'
            'Hilft das nicht: erst stop.bat, dann admin-zuruecksetzen.bat, dann start.bat.'
        )
        Command = '{control} reset-admin'
        Offer   = ''
    }
    'admin-failed'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Das Admin-Konto ließ sich nicht speichern; PocketBase meldet einen Fehler (Exit-Code {code}).'
        Cause   = 'Die Meldung von PocketBase steht unter diesem Text (ohne Passwort).'
        Steps   = @(
            'Die Meldung lesen und admin-zuruecksetzen.bat erneut ausführen.'
            'Hilft das nicht: die Meldung an Claude schicken.'
        )
        Command = '{control} reset-admin'
        Offer   = ''
    }

    # --- Input of the app (the pages System and Sicherung) -------------------------------------------

    'input-invalid'            = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die Eingabe auf der Standardeingabe ist {detail}.'
        Cause   = 'Die Befehle der Sicherung bekommen ihre Parameter von der App als ein JSON-Objekt; dieser Aufruf hat etwas anderes geschickt.'
        Steps   = @(
            'In der App die Seite neu laden und es erneut versuchen.'
            'Von Hand: den Befehl ohne Umleitung der Eingabe aufrufen; er fragt dann selbst.'
        )
        Command = ''
        Offer   = ''
    }

    # --- Backup (ADR-0046) ---------------------------------------------------------------------------

    'backup-target-format'     = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Das ist kein vollständiger Pfad.'
        Cause   = 'Gemeint ist ein Laufwerk mit Ordner (etwa einer USB-Platte) oder eine Freigabe wie \\NAS\Freigabe\Sicherung; relative Pfade, Platzhalter und Teile wie .. gehen nicht.'
        Steps   = @(
            'Den Pfad aus der Adresszeile des Explorers kopieren und erneut eintragen.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-target-too-long'   = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Der Pfad des Zielverzeichnisses ist zu lang (höchstens {max} Zeichen).'
        Cause   = 'Mit dem Namen der Sicherungen würde er die Grenze von Windows überschreiten.'
        Steps   = @(
            'Einen kürzeren Ordner wählen, etwa direkt auf dem Laufwerk.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-target-inside-app' = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Das Zielverzeichnis darf nicht im Ordner app liegen.'
        Cause   = 'Eine Kopie des Ordners nähme die Sicherungen mit, und ein Plattendefekt träfe beide.'
        Steps   = @(
            'Einen Ordner auf einem anderen Laufwerk wählen: USB-Platte, NAS oder ein Ordner, den ein Cloud-Dienst synchronisiert.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-target-unreachable' = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'Das Zielverzeichnis der Sicherung ist nicht erreichbar'
        Problem = 'Das Zielverzeichnis der Sicherung ist nicht erreichbar.'
        Cause   = 'Den Ordner gibt es nicht, die USB-Platte ist nicht angeschlossen, das Netzlaufwerk nicht verbunden, oder der Laufwerksbuchstabe hat sich geändert.'
        Steps   = @(
            'Die Platte anschließen bzw. das Netzlaufwerk verbinden und den Pfad im Explorer prüfen.'
            'Die App versucht es alle 15 Minuten wieder; einen neuen Pfad trägst du unter Einstellungen → Sicherung ein.'
        )
        Command = '{control} backup-info'
        Offer   = ''
    }
    'backup-target-not-writable' = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'In das Zielverzeichnis der Sicherung lässt sich nicht schreiben.'
        Cause   = 'Der Ordner ist schreibgeschützt, die Freigabe gewährt deinem Konto kein Schreibrecht, oder das Laufwerk ist voll.'
        Steps   = @(
            'Im Explorer prüfen, ob du dort eine Datei anlegen kannst; bei einem NAS die Rechte deines Kontos prüfen.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-target-space'      = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Im Zielverzeichnis der Sicherung ist zu wenig Platz frei.'
        Cause   = 'Eine Sicherung braucht ihre Größe und 200 MB Reserve.'
        Steps   = @(
            'Ältere Sicherungen im Zielverzeichnis löschen oder ein größeres Laufwerk wählen.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-keep'              = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die Aufbewahrung der Sicherungen ist ungültig.'
        Cause   = 'Erlaubt sind 1 bis 30 tägliche, 0 bis 12 wöchentliche und 0 bis 24 monatliche Sicherungen.'
        Steps   = @(
            'Werte in diesen Bereichen unter Einstellungen → Sicherung eintragen.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-no-target'         = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Es ist kein Zielverzeichnis der Sicherung eingestellt.'
        Cause   = 'Ohne Zielverzeichnis bleiben die Sicherungen nur im Ordner app.'
        Steps   = @(
            'Unter Einstellungen → Sicherung ein Zielverzeichnis auf einem anderen Laufwerk eintragen.'
        )
        Command = ''
        Offer   = ''
    }
    'passphrase-missing'       = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'Es fehlt die Passphrase der Sicherung'
        Problem = 'Es ist keine Passphrase für die Sicherungen festgelegt.'
        Cause   = 'Ohne Passphrase entsteht im Zielverzeichnis keine verschlüsselte Sicherung.'
        Steps   = @(
            'Unter Einstellungen → Sicherung eine Passphrase festlegen oder mit dem Befehl unten.'
            'Bewahre die Passphrase in deinem Passwort-Manager auf; ohne sie lässt sich die Sicherung nicht öffnen.'
        )
        Command = '{control} backup-passphrase'
        Offer   = ''
    }
    'passphrase-unreadable'    = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die gespeicherte Passphrase lässt sich mit diesem Windows-Konto nicht lesen.'
        Cause   = 'Sie wurde unter einem anderen Konto oder auf einem anderen Rechner gespeichert; DPAPI bindet sie an Konto und Rechner.'
        Steps   = @(
            'Die Passphrase neu festlegen (Befehl unten). Ältere Sicherungen öffnen sich weiter mit ihrer bisherigen Passphrase.'
        )
        Command = '{control} backup-passphrase'
        Offer   = ''
    }
    'passphrase-mismatch'      = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die beiden Eingaben der Passphrase stimmen nicht überein.'
        Cause   = 'Bei einer der beiden Eingaben hat sich ein Tippfehler eingeschlichen.'
        Steps   = @(
            'Die Passphrase noch einmal zweimal gleich eingeben; es wurde nichts geändert.'
        )
        Command = '{control} backup-passphrase'
        Offer   = ''
    }
    'passphrase-too-short'     = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die Passphrase muss mindestens {min} Zeichen lang sein.'
        Cause   = 'Kürzere Passphrasen lassen sich zu leicht erraten.'
        Steps   = @(
            'Eine längere Passphrase wählen, etwa vier zufällige Wörter; es wurde nichts geändert.'
        )
        Command = '{control} backup-passphrase'
        Offer   = ''
    }
    'passphrase-too-long'      = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die Passphrase ist zu lang (höchstens {max} Byte).'
        Cause   = 'Umlaute und Sonderzeichen zählen mehrfach.'
        Steps   = @(
            'Eine kürzere Passphrase wählen; es wurde nichts geändert.'
        )
        Command = '{control} backup-passphrase'
        Offer   = ''
    }
    'passphrase-character'     = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die Passphrase darf keine Steuerzeichen enthalten.'
        Cause   = 'Steuerzeichen (etwa ein Tabulator) lassen sich auf einem anderen Rechner nicht sicher wieder eingeben.'
        Steps   = @(
            'Eine Passphrase ohne solche Zeichen wählen; es wurde nichts geändert.'
        )
        Command = '{control} backup-passphrase'
        Offer   = ''
    }
    'passphrase-unavailable'   = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Diese Testkopie hat keinen Ordner für die Passphrase.'
        Cause   = 'Eine isolierte Testkopie (BYL_TEST_ISOLATED) legt die Passphrase nur in BYL_TEST_SECRET_DIR ab.'
        Steps   = @(
            'Nur in Tests: BYL_TEST_SECRET_DIR auf einen Ordner des Tests setzen.'
        )
        Command = ''
        Offer   = ''
    }
    'passphrase-save'          = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'Die Passphrase lässt sich nicht speichern (DPAPI)'
        Problem = 'Die Passphrase ließ sich nicht verschlüsselt speichern ({detail}).'
        Cause   = 'Die Datenverschlüsselung von Windows (DPAPI) ist für dieses Konto nicht verfügbar, oder der Ordner %LOCALAPPDATA%\becauseyoulovejira ist nicht beschreibbar.'
        Steps   = @(
            'Es erneut versuchen (Befehl unten).'
            'Bei einem Konto einer Firma oder Schule die IT fragen, ob DPAPI gesperrt ist.'
        )
        Command = '{control} backup-passphrase'
        Offer   = ''
    }
    'passphrase-save-later'    = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = ''
        Problem = 'Die Passphrase ließ sich für künftige Sicherungen nicht speichern ({detail}); die Wiederherstellung selbst ist erledigt.'
        Cause   = 'Die Datenverschlüsselung von Windows (DPAPI) ist nicht verfügbar, oder der Ordner %LOCALAPPDATA%\becauseyoulovejira ist nicht beschreibbar.'
        Steps   = @(
            'Die Passphrase unter Einstellungen → Sicherung oder mit dem Befehl unten festlegen.'
        )
        Command = '{control} backup-passphrase'
        Offer   = ''
    }
    'backup-name'              = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Unbekannte Sicherung „{name}“.'
        Cause   = 'Der Name passt weder zu den Sicherungen im Ordner app (*.zip) noch zu denen im Zielverzeichnis (byl-….tar.age), oder ein Pfad ist unvollständig.'
        Steps   = @(
            'wiederherstellen.bat zeigt die Sicherungen zur Auswahl; sonst den vollen Pfad der Datei angeben.'
        )
        Command = '{control} backup-info'
        Offer   = ''
    }
    'backup-missing'           = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die Sicherung {name} gibt es nicht (mehr).'
        Cause   = 'Sie wurde gelöscht, verschoben oder von der Aufbewahrung entfernt.'
        Steps   = @(
            'Eine andere Sicherung wählen; wiederherstellen.bat zeigt die vorhandenen.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-helper'            = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'byl-backup.exe fehlt oder antwortet nicht'
        Problem = 'byl-backup.exe fehlt oder antwortet nicht.'
        Cause   = 'Das Hilfsprogramm der Sicherung wurde nicht mitkopiert oder nicht gebaut, oder ein Virenscanner blockiert es.'
        Steps   = @(
            'byl-backup.exe aus einer Kopie des Ordners app zurücklegen oder im Repository mit scripts\build.ps1 bauen.'
        )
        Command = '{build}'
        Offer   = ''
    }
    'backup-seal'              = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die Sicherung ließ sich nicht verschlüsseln.'
        Cause   = 'Das Hilfsprogramm byl-backup.exe meldete einen Fehler beim Schreiben ins Zielverzeichnis.'
        Steps   = @(
            'Das Zielverzeichnis prüfen und unter Einstellungen → Sicherung „Jetzt sichern“ erneut.'
            'Hilft das nicht: die letzten 50 Zeilen des Logs kopieren (Befehl unten) und an Claude schicken.'
        )
        Command = '{tail}'
        Offer   = ''
    }
    'backup-passphrase'        = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'Die Passphrase passt nicht zur Sicherung'
        Problem = 'Die Passphrase passt nicht zu dieser Sicherung.'
        Cause   = 'Die Sicherung stammt von vor einem Wechsel der Passphrase, oder die Eingabe war vertippt.'
        Steps   = @(
            'Die Passphrase eingeben, die beim Erstellen dieser Sicherung galt (Passwort-Manager).'
        )
        Command = ''
        Offer   = ''
    }
    'backup-no-passphrase'     = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Für die verschlüsselte Sicherung fehlt die Passphrase.'
        Cause   = 'Auf diesem Rechner ist keine Passphrase gespeichert, und keine wurde eingegeben.'
        Steps   = @(
            'Die Passphrase der Sicherung eingeben: in der App unter der Sicherung oder in wiederherstellen.bat.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-format'            = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die Datei ist keine Sicherung im Format age.'
        Cause   = 'Gewählt wurde eine andere Datei als eine Sicherung byl-….tar.age.'
        Steps   = @(
            'Eine Datei byl-….tar.age aus dem Zielverzeichnis wählen.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-damaged'           = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'Die Sicherung ist beschädigt'
        Problem = 'Die Sicherung ist beschädigt oder unvollständig.'
        Cause   = 'Die Datei wurde beim Kopieren abgeschnitten (USB-Platte abgezogen, Synchronisierung nicht fertig) oder verändert.'
        Steps   = @(
            'Eine andere, ältere Sicherung prüfen und verwenden.'
            'Liegt sie in einem Ordner eines Cloud-Dienstes: warten, bis die Synchronisierung fertig ist.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-zip'               = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Das ZIP der Sicherung lässt sich nicht entpacken.'
        Cause   = 'Die Datei ist beschädigt.'
        Steps   = @(
            'Eine andere Sicherung wählen.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-no-db'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'In der Sicherung fehlt die Datenbank (data.db).'
        Cause   = 'Die Datei ist keine Sicherung der App oder unvollständig.'
        Steps   = @(
            'Eine andere Sicherung wählen.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-integrity'         = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die Datenbank der Sicherung ist beschädigt (integrity_check).'
        Cause   = 'Die Sicherung entstand aus einer schon beschädigten Datenbank, oder die Datei wurde später verändert.'
        Steps   = @(
            'Eine andere, ältere Sicherung prüfen und verwenden.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-files'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'In der Sicherung fehlen Originaldateien.'
        Cause   = 'Beim Sichern waren Dateien in pb_data\storage nicht lesbar oder schon gelöscht.'
        Steps   = @(
            'Unter Einstellungen → Sicherung „Jetzt sichern“ und die neue Sicherung prüfen.'
        )
        Command = ''
        Offer   = ''
    }
    'backup-start'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Eine Probe-Instanz ließ sich mit der Sicherung nicht starten.'
        Cause   = 'Die Sicherung stammt aus einer neueren Version der App, oder eine Migration scheitert auf den gesicherten Daten.'
        Steps   = @(
            'Die App aktualisieren und die Sicherung erneut prüfen.'
            'Hilft das nicht: die letzten 50 Zeilen des Logs kopieren (Befehl unten) und an Claude schicken.'
        )
        Command = '{tail}'
        Offer   = ''
    }
    'backup-temp-space'        = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Für die Prüfung ist im Temp-Ordner zu wenig Platz frei.'
        Cause   = 'Die Prüfung entpackt die Sicherung unter %TEMP% und braucht etwa das Dreifache ihrer Größe.'
        Steps   = @(
            'Auf dem Systemlaufwerk Platz schaffen (Datenträgerbereinigung, Befehl unten) und erneut prüfen.'
        )
        Command = 'cleanmgr'
        Offer   = ''
    }
    'restore-confirm'          = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Zur Bestätigung fehlt das Wort WIEDERHERSTELLEN; nichts wurde geändert.'
        Cause   = 'Das Wort wurde nicht oder anders eingetippt.'
        Steps   = @(
            'wiederherstellen.bat erneut ausführen und WIEDERHERSTELLEN genau so eintippen.'
        )
        Command = ''
        Offer   = ''
    }
    'restore-credentials'      = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Unbekannte Auswahl für die Zugangsdaten; nichts wurde geändert.'
        Cause   = 'Erlaubt sind nur fehlende, alle oder keine.'
        Steps   = @(
            'Die Wiederherstellung erneut starten und eine dieser Möglichkeiten wählen.'
        )
        Command = ''
        Offer   = ''
    }
    'restore-cancel'           = @{
        Exit    = 1
        Level   = 'warning'
        Faq     = ''
        Problem = 'Abgebrochen; nichts wurde geändert.'
        Cause   = 'Es wurde keine Sicherung gewählt, oder die Rückfrage wurde nicht bestätigt.'
        Steps   = @(
            'Zum Wiederherstellen wiederherstellen.bat erneut ausführen.'
        )
        Command = ''
        Offer   = ''
    }
    'restore-input'            = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Der Auftrag der Wiederherstellung fehlt oder ist unlesbar; nichts wurde geändert.'
        Cause   = 'Der Aufruf aus der App kam unvollständig an.'
        Steps   = @(
            'In der App unter Einstellungen → Sicherung erneut „Wiederherstellen …“ wählen oder wiederherstellen.bat verwenden.'
        )
        Command = ''
        Offer   = ''
    }
    'restore-space'            = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Auf dem Laufwerk der App ist für die entpackte Sicherung zu wenig Platz frei; nichts wurde geändert.'
        Cause   = 'Die Sicherung wird neben pb_data entpackt und braucht dort ihre entpackte Größe und Reserve.'
        Steps   = @(
            'Platz schaffen (Datenträgerbereinigung, Befehl unten) und erneut wiederherstellen.'
        )
        Command = 'cleanmgr'
        Offer   = ''
    }
    'restore-stop'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die App ließ sich für die Wiederherstellung nicht beenden; nichts wurde geändert.'
        Cause   = 'Windows verweigert das Beenden, oder der Prozess hängt.'
        Steps   = @(
            'stop.bat ausführen und danach wiederherstellen.bat erneut.'
        )
        Command = '{control} stop'
        Offer   = ''
    }
    'restore-swap'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Der Datenordner ließ sich nicht austauschen; der bisherige ist wieder an seinem Platz.'
        Cause   = 'Ein anderes Programm (Explorer, Virenscanner, Synchronisierung) hielt eine Datei in pb_data offen.'
        Steps   = @(
            'Fenster des Explorers im Ordner app schließen, kurz warten und wiederherstellen.bat erneut ausführen.'
        )
        Command = ''
        Offer   = ''
    }
    'restore-detach'           = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die Wiederherstellung ließ sich nicht im Hintergrund starten; nichts wurde geändert.'
        Cause   = 'Windows PowerShell konnte keinen eigenen Prozess starten.'
        Steps   = @(
            'wiederherstellen.bat im Ordner app verwenden.'
        )
        Command = '{control} restore'
        Offer   = ''
    }
    'restore-start'            = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'Nach dem Wiederherstellen startet die App nicht'
        Problem = 'Mit der wiederhergestellten Sicherung startete die App nicht; der bisherige Stand ist zurück.'
        Cause   = 'Die Sicherung passt nicht zu dieser Version der App, oder ihr Port ist belegt.'
        Steps   = @(
            'Die Logs ansehen (Befehl unten).'
            'Eine andere Sicherung versuchen oder die App zuerst aktualisieren.'
        )
        Command = '{control} logs server'
        Offer   = ''
    }
    'restore-config'           = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = ''
        Problem = 'byl-config.json aus der Sicherung ließ sich nicht übernehmen ({detail}); es gelten die Standardwerte.'
        Cause   = 'Der Ordner app ist gerade schreibgeschützt oder die Datei gesperrt.'
        Steps   = @(
            'Port und Zielverzeichnis der Sicherung bei Bedarf neu einstellen (Einstellungen → Sicherung, Befehl port).'
        )
        Command = '{control} port'
        Offer   = ''
    }
    'restore-credential'       = @{
        Exit    = 0
        Level   = 'warning'
        Faq     = ''
        Problem = 'Einige Zugangsdaten ließen sich nicht in die Windows-Benutzervariablen zurückschreiben.'
        Cause   = 'Windows hat das Schreiben einer Benutzervariable verweigert.'
        Steps   = @(
            'Die fehlenden Variablen von Hand anlegen (ihre Namen nennt Einstellungen → Sicherung) und danach neu-starten.bat ausführen.'
        )
        Command = ''
        Offer   = ''
    }

    # --- All scripts ---------------------------------------------------------------------------------

    'unexpected'               = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'Ein unerwarteter Fehler'
        Problem = 'Unerwarteter Fehler: {detail}'
        Cause   = 'Ein Fall, den das Skript nicht kennt.'
        Steps   = @(
            'Den Befehl noch einmal ausführen.'
            'Tritt der Fehler wieder auf: die letzten 50 Zeilen des Logs mit dem Befehl unten in die Zwischenablage kopieren und an Claude schicken. Sie enthalten keine Passwörter und keine Werte der BYL_-Variablen.'
        )
        Command = '{tail}'
        Offer   = ''
    }
    'script-blocked'           = @{
        Exit    = 1
        Level   = 'error'
        Faq     = 'Ein Doppelklick auf eine .bat-Datei zeigt nur eine rote Meldung von PowerShell'
        Problem = 'byl-control.ps1 konnte nicht ausgeführt werden.'
        Cause   = 'Eine Richtlinie für PowerShell-Skripte blockiert es, oder Dateien im Ordner app fehlen oder sind beschädigt.'
        Steps   = @(
            'Prüfen, ob byl-control.ps1, byl-functions.ps1 und byl-problems.ps1 im Ordner app liegen.'
            'Stammt der Ordner aus einem Download (ZIP): die Dateien entsperren (Befehl unten).'
            'Die Richtlinie anzeigen: powershell -NoProfile -Command Get-ExecutionPolicy -List. Steht bei MachinePolicy oder UserPolicy etwas anderes als Undefined, legt eine Richtlinie fest, dass Skripte nicht laufen; dann bei ihrem Verwalter um Freigabe bitten.'
        )
        Command = 'powershell -NoProfile -Command "Get-ChildItem -LiteralPath ''{appq}'' | Unblock-File"'
        Offer   = ''
    }
    'script-blocked-hidden'    = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'becauseyoulovejira konnte ohne Fenster nicht starten: byl-control.ps1 ließ sich nicht ausführen.'
        Cause   = 'Eine Richtlinie für PowerShell-Skripte blockiert es, oder Dateien im Ordner app fehlen oder sind beschädigt.'
        Steps   = @(
            'start.bat im Ordner {app} doppelklicken: Das Fenster zeigt, was zu tun ist, mit Befehlen zum Kopieren.'
        )
        Command = ''
        Offer   = ''
    }

    # --- Build scripts in scripts\ (developers) --------------------------------------------------------

    'node-missing'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Node.js wurde nicht gefunden (PATH).'
        Cause   = 'Node.js 24 ist nicht installiert, oder sein Ordner steht nicht im PATH dieses Fensters.'
        Steps   = @(
            'Node.js 24 installieren (nodejs.org) oder den Ordner mit node.exe vorn in den PATH nehmen.'
            'Liegt Node.js schon auf diesem Rechner, nimmt der Befehl unten seinen Ordner für dieses PowerShell-Fenster in den PATH.'
            'Danach den Befehl erneut ausführen.'
        )
        Command = '$env:Path = "{nodeDir};$env:Path"'
        Offer   = ''
    }
    'node-version'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die Version von Node.js ({path}) ließ sich nicht ermitteln.'
        Cause   = 'node.exe ist beschädigt oder kein Node.js.'
        Steps   = @(
            'Node.js 24 neu installieren (nodejs.org) und den Befehl erneut ausführen.'
        )
        Command = ''
        Offer   = ''
    }
    'node-old'                 = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Node.js {version} ({path}) ist zu alt; nötig ist Version {major} oder neuer.'
        Cause   = 'Im PATH steht zuerst eine ältere Installation von Node.js.'
        Steps   = @(
            'Node.js {major} installieren oder den Ordner einer neueren Version vorn in den PATH nehmen.'
            'Liegt eine passende Version schon auf diesem Rechner, nimmt der Befehl unten ihren Ordner für dieses PowerShell-Fenster in den PATH.'
        )
        Command = '$env:Path = "{nodeDir};$env:Path"'
        Offer   = ''
    }
    'npm-missing'              = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'npm wurde nicht gefunden (erwartet neben {path}).'
        Cause   = 'Die Installation von Node.js ist unvollständig.'
        Steps   = @(
            'Node.js 24 neu installieren (nodejs.org); npm gehört dazu.'
        )
        Command = ''
        Offer   = ''
    }
    'lockfile-missing'         = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'In {folder} fehlt package-lock.json.'
        Cause   = 'Die Datei wurde gelöscht oder nicht mit ausgecheckt.'
        Steps   = @(
            'Die Datei mit git zurückholen (Befehl unten) und den Build erneut starten.'
        )
        Command = 'git -C "{folder}" checkout -- package-lock.json'
        Offer   = ''
    }
    'npm-ci'                   = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die Abhängigkeiten in {folder} ließen sich nicht installieren (npm ci, Exit-Code {code}).'
        Cause   = 'Meist fehlt die Verbindung zur npm-Registry, eine Datei in node_modules ist gesperrt (ein laufender Dev-Server, Editor oder Virenscanner), oder package.json und package-lock.json passen nicht zusammen.'
        Steps   = @(
            'Die Meldung von npm oberhalb lesen.'
            'Laufende Dev-Server und Editoren in diesem Ordner schließen und den Build erneut starten (Befehl unten).'
            'Ohne Internetverbindung später erneut versuchen.'
        )
        Command = '{build}'
        Offer   = ''
    }
    'build-step'               = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Der Schritt „{step}“ des Builds ist gescheitert (Exit-Code {code}).'
        Cause   = 'Die Prüfung, der Lint, der Build oder ein Test meldet einen Fehler; die Meldung steht oberhalb.'
        Steps   = @(
            'Die Ausgabe oberhalb lesen und den Fehler beheben.'
            'Den Schritt allein wiederholen (Befehl unten), danach den ganzen Build.'
        )
        Command = '{rerun}'
        Offer   = ''
    }
    'helper-build'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = '{exe} ließ sich nicht bauen ({detail}).'
        Cause   = 'esbuild oder postject meldet einen Fehler (oberhalb), oder Node.js 24 fehlt.'
        Steps   = @(
            'Die Ausgabe oberhalb lesen.'
            'Den Bau des Hilfsprogramms allein wiederholen (Befehl unten).'
        )
        Command = '{rerun}'
        Offer   = ''
    }
    'helper-check'             = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = '{exe} {check} scheiterte ohne Node (Exit-Code {code}).'
        Cause   = 'Das gebaute Programm startet nicht von selbst: Der Bau war unvollständig, oder ein Virenscanner blockiert die neue Datei.'
        Steps   = @(
            'Die Ausgabe des Programms (unter diesem Text) lesen.'
            'Prüfen, ob ein Virenscanner die Datei in helpers\…\dist blockiert, und den Bau wiederholen (Befehl unten).'
        )
        Command = '{rerun}'
        Offer   = ''
    }
    'helper-install'           = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = '{exe} ließ sich nicht in den Ordner app legen ({detail}).'
        Cause   = 'Die alte Datei ist gesperrt und ließ sich nicht umbenennen, oder der Ordner app ist schreibgeschützt.'
        Steps   = @(
            'Die App beenden (stop.bat) und den Bau wiederholen (Befehl unten).'
        )
        Command = '{rerun}'
        Offer   = ''
    }
    'pocketbase-download'      = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'PocketBase ließ sich nicht herunterladen ({detail}).'
        Cause   = 'Keine Internetverbindung, GitHub ist nicht erreichbar, oder ein Proxy blockiert den Download.'
        Steps   = @(
            'Die Verbindung prüfen und den Befehl unten erneut ausführen.'
        )
        Command = '{fetch}'
        Offer   = ''
    }
    'pocketbase-checksum'      = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die heruntergeladene PocketBase hat eine falsche Prüfsumme; sie wurde nicht installiert.'
        Cause   = 'Die Datei wurde unterwegs verändert oder abgeschnitten (Proxy, Virenscanner), oder GitHub liefert eine andere Datei als die gepinnte.'
        Steps   = @(
            'Den Befehl unten erneut ausführen.'
            'Tritt es wieder auf: die Datei nicht von Hand austauschen, sondern an Claude melden.'
        )
        Command = '{fetch}'
        Offer   = ''
    }
    'pocketbase-write'         = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'pocketbase.exe ließ sich nicht schreiben ({detail}).'
        Cause   = 'Die App läuft und hält die Datei offen, oder der Ordner app ist schreibgeschützt.'
        Steps   = @(
            'Die App beenden (stop.bat) und den Befehl unten erneut ausführen.'
        )
        Command = '{fetch}'
        Offer   = ''
    }
    'pocketbase-version'       = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Die installierte pocketbase.exe meldet nicht die erwartete Version ({detail}).'
        Cause   = 'Der Download war unvollständig, oder ein Virenscanner hat die Datei verändert.'
        Steps   = @(
            'Den Befehl unten erneut ausführen.'
        )
        Command = '{fetch}'
        Offer   = ''
    }
    'pocketbase-platform'      = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Für dieses System gibt es keine gepinnte PocketBase ({detail}).'
        Cause   = 'Gepinnt sind nur Windows x64 und Linux (amd64, arm64, armv7).'
        Steps   = @(
            'Auf einem dieser Systeme bauen.'
        )
        Command = ''
        Offer   = ''
    }
    'build-unexpected'         = @{
        Exit    = 1
        Level   = 'error'
        Faq     = ''
        Problem = 'Unerwarteter Fehler im Build: {detail}'
        Cause   = 'Ein Fall, den das Build-Skript nicht kennt.'
        Steps   = @(
            'Den Build erneut starten (Befehl unten).'
            'Tritt der Fehler wieder auf: die Ausgabe ab der ersten roten Zeile an Claude schicken.'
        )
        Command = '{build}'
        Offer   = ''
    }
}

# --- Functions ---------------------------------------------------------------------------------------
# Pure: every input is a parameter, nothing is printed or written. Output, log and the offer to
# solve a problem belong to the caller (Write-BylProblem in byl-control.ps1, Write-BylBuildProblem
# in scripts\build-functions.ps1).

# The mark of an error is the multiplication sign U+00D7. The heavy cross U+2716 is missing in
# Consolas, Lucida Console and Courier New, the fonts of the Windows 10 console (checked with
# System.Windows.Media.GlyphTypeface), and would show as an empty box; U+00D7 is in all three and in
# the code pages 850 and 1252. The .bat files and start-hidden.vbs stay ASCII and use X.
$BylProblemErrorMark = [string][char]0x00D7
$BylProblemWarningMark = '!'
# Lines wrap before this width (a console window has 120 columns); commands, facts and the path of
# the log never wrap, so they can be copied as they are. A value in a text (a path with spaces)
# never breaks either: Expand-BylProblemText joins its words with no-break spaces, which
# Format-BylProblem and ConvertTo-BylProblemData turn back into spaces.
$BylProblemWidth = 100
$BylProblemIndent = 13
$BylProblemPlaceholderPattern = '\{([a-z][A-Za-z0-9]*)\}'
$BylProblemNoBreak = [string][char]0x00A0

function Get-BylProblemPlaceholder {
    # The names of the placeholders {name} in $Text, in order, each once.
    param([AllowNull()][AllowEmptyString()][string]$Text)

    $names = New-Object System.Collections.Generic.List[string]
    foreach ($match in [regex]::Matches([string]$Text, $BylProblemPlaceholderPattern)) {
        if (-not $names.Contains($match.Groups[1].Value)) { $names.Add($match.Groups[1].Value) }
    }
    return $names.ToArray()
}

function Expand-BylProblemText {
    # $Text with every placeholder {name} replaced by $Values[name]; a missing or empty value
    # becomes an ellipsis, so a text never shows a bare placeholder. With -KeepTogether the spaces of
    # a value become no-break spaces (texts that wrap, see $BylProblemNoBreak).
    param([AllowNull()][AllowEmptyString()][string]$Text, [System.Collections.IDictionary]$Values = @{}, [switch]$KeepTogether)

    $source = [string]$Text
    $result = New-Object System.Text.StringBuilder
    $last = 0
    foreach ($match in [regex]::Matches($source, $BylProblemPlaceholderPattern)) {
        [void]$result.Append($source.Substring($last, $match.Index - $last))
        $name = $match.Groups[1].Value
        $value = if ($Values.Contains($name)) { [string]$Values[$name] } else { '' }
        if ($value -eq '') { $value = [string][char]0x2026 }
        if ($KeepTogether) { $value = $value.Replace(' ', $BylProblemNoBreak) }
        [void]$result.Append($value)
        $last = $match.Index + $match.Length
    }
    [void]$result.Append($source.Substring($last))
    return $result.ToString()
}

function Get-BylProblemValues {
    # The placeholders every entry may use, for the folder app $AppDir: {app}, {appq} (for a
    # single-quoted string) and {control}; with the log $Log {log} and {tail} (copies its last 50
    # lines); {root}, {build} and {fetch} when $RepositoryRoot names the repository the folder lies in.
    param(
        [Parameter(Mandatory = $true)][string]$AppDir,
        [AllowNull()][AllowEmptyString()][string]$Log,
        [AllowNull()][AllowEmptyString()][string]$RepositoryRoot
    )

    $values = @{
        app     = $AppDir
        appq    = $AppDir.Replace("'", "''")
        control = 'powershell -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f [System.IO.Path]::Combine($AppDir, 'byl-control.ps1')
    }
    if (-not [string]::IsNullOrEmpty($Log)) {
        $values['log'] = $Log
        $values['tail'] = 'powershell -NoProfile -Command "Get-Content -LiteralPath ''{0}'' -Tail 50 | Set-Clipboard"' -f $Log.Replace("'", "''")
    }
    if (-not [string]::IsNullOrEmpty($RepositoryRoot)) {
        $values['root'] = $RepositoryRoot
        $values['build'] = 'powershell -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f [System.IO.Path]::Combine($RepositoryRoot, 'scripts', 'build.ps1')
        $values['fetch'] = 'powershell -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f [System.IO.Path]::Combine($RepositoryRoot, 'scripts', 'fetch-pocketbase.ps1')
    }
    return $values
}

function Get-BylProblemReport {
    # The entry $Code with its placeholders filled from $Values: Code, Level, Exit, Problem, Facts
    # (extra lines under the problem, e.g. who uses a port), Cause, Steps, Command ('' when one of
    # its placeholders has no value), Offer and Log. An unknown code gives the entry 'unexpected'
    # with the code as detail: a typo never hides a problem.
    param(
        [Parameter(Mandatory = $true)][string]$Code,
        [System.Collections.IDictionary]$Values = @{},
        [AllowNull()][AllowEmptyCollection()][string[]]$Facts = @(),
        [AllowNull()][AllowEmptyString()][string]$Log = ''
    )

    $all = @{}
    foreach ($key in @($Values.Keys)) { $all[[string]$key] = $Values[$key] }
    if (-not $BylProblemCatalog.Contains($Code)) {
        $all['detail'] = "unbekannter Code des Fehlerkatalogs: $Code"
        $Code = 'unexpected'
    }
    $entry = $BylProblemCatalog[$Code]
    $command = ''
    if (-not [string]::IsNullOrEmpty($entry.Command)) {
        $missing = @(Get-BylProblemPlaceholder -Text $entry.Command | Where-Object { [string]::IsNullOrEmpty([string]$all[$_]) })
        if ($missing.Count -eq 0) { $command = Expand-BylProblemText -Text $entry.Command -Values $all }
    }
    return [pscustomobject]@{
        Code    = $Code
        Level   = $entry.Level
        Exit    = [int]$entry.Exit
        Problem = Expand-BylProblemText -Text $entry.Problem -Values $all -KeepTogether
        Facts   = @(@($Facts) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        Cause   = Expand-BylProblemText -Text $entry.Cause -Values $all -KeepTogether
        Steps   = @(foreach ($step in $entry.Steps) { Expand-BylProblemText -Text $step -Values $all -KeepTogether })
        Command = $command
        Offer   = if ([string]::IsNullOrEmpty($entry.Offer)) { '' } else { Expand-BylProblemText -Text $entry.Offer -Values $all }
        Log     = [string]$Log
    }
}

function Split-BylProblemText {
    # $Text in lines of at most $Width characters, broken at spaces; a longer word stays whole.
    param([AllowNull()][AllowEmptyString()][string]$Text, [Parameter(Mandatory = $true)][int]$Width)

    $lines = New-Object System.Collections.Generic.List[string]
    $line = ''
    foreach ($word in ([string]$Text -split ' ')) {
        if ($line -eq '') {
            $line = $word
        }
        elseif ($line.Length + 1 + $word.Length -le $Width) {
            $line += ' ' + $word
        }
        else {
            $lines.Add($line)
            $line = $word
        }
    }
    $lines.Add($line)
    return , $lines.ToArray()
}

function ConvertTo-BylAscii {
    # $Text for the .bat files and start-hidden.vbs: umlauts as ae, oe, ue, ss, typographic quotes,
    # dashes and arrows as ASCII, anything else outside ASCII as ?.
    param([AllowNull()][AllowEmptyString()][string]$Text)

    $result = [string]$Text
    $pairs = @(
        @([char]0x00E4, 'ae'), @([char]0x00F6, 'oe'), @([char]0x00FC, 'ue'), @([char]0x00C4, 'Ae'),
        @([char]0x00D6, 'Oe'), @([char]0x00DC, 'Ue'), @([char]0x00DF, 'ss'), @([char]0x201E, '"'),
        @([char]0x201C, '"'), @([char]0x201D, '"'), @([char]0x201A, "'"), @([char]0x2018, "'"),
        @([char]0x2019, "'"), @([char]0x2013, '-'), @([char]0x2014, '-'), @([char]0x2026, '...'),
        @([char]0x00D7, 'x'), @([char]0x2192, '->')
    )
    foreach ($pair in $pairs) { $result = $result.Replace([string]$pair[0], [string]$pair[1]) }
    return [regex]::Replace($result, '[^\x00-\x7F]', '?')
}

function Format-BylProblem {
    # The lines of a report (Get-BylProblemReport) as the console shows them, see the head of this
    # file; -Ascii for the .bat files and start-hidden.vbs (ConvertTo-BylAscii, the mark X).
    param([Parameter(Mandatory = $true)][object]$Report, [switch]$Ascii)

    $isError = $Report.Level -eq 'error'
    $mark = if (-not $isError) { $BylProblemWarningMark } elseif ($Ascii) { 'X' } else { $BylProblemErrorMark }
    $head = if ($isError) { 'Problem:' } else { 'Hinweis:' }
    $pad = ' ' * $BylProblemIndent
    $lines = New-Object System.Collections.Generic.List[string]
    $add = {
        param([string]$First, [string]$Value, [int]$Hang = 0)
        $parts = Split-BylProblemText -Text $Value -Width ($BylProblemWidth - $BylProblemIndent - $Hang)
        for ($index = 0; $index -lt $parts.Count; $index++) {
            $prefix = if ($index -eq 0) { $First } else { $pad + (' ' * $Hang) }
            $lines.Add($prefix + $parts[$index].Replace($BylProblemNoBreak, ' '))
        }
    }
    & $add ('{0} {1,-11}' -f $mark, $head) $Report.Problem
    foreach ($fact in @($Report.Facts)) { $lines.Add($pad + $fact) }
    if (-not [string]::IsNullOrEmpty($Report.Cause)) { & $add ('  {0,-11}' -f 'Ursache:') $Report.Cause }
    $steps = @($Report.Steps)
    for ($index = 0; $index -lt $steps.Count; $index++) {
        $label = '  {0,-11}' -f $(if ($index -eq 0) { "So geht's:" } else { '' })
        if ($steps.Count -eq 1) { & $add $label $steps[$index] }
        else { & $add ($label + "$($index + 1). ") $steps[$index] 3 }
    }
    if (-not [string]::IsNullOrEmpty($Report.Command)) {
        $lines.Add($pad + 'Befehl zum Kopieren:')
        $lines.Add($pad + '  ' + $Report.Command)
    }
    if (-not [string]::IsNullOrEmpty($Report.Log)) { $lines.Add(('  {0,-11}' -f 'Details:') + $Report.Log) }
    $result = $lines.ToArray()
    if ($Ascii) { $result = @($result | ForEach-Object { ConvertTo-BylAscii -Text $_ }) }
    # One line each into the pipeline: callers collect them with @(...).
    return $result
}

function New-BylProblemError {
    # An exception that carries the entry $Code: thrown where a problem shows deep in a call, it is
    # reported by a caller or the last catch of the script (Get-BylProblemOfError, then
    # Write-BylProblem). Its message is the problem in words, so even an unexpected catch says it.
    param(
        [Parameter(Mandatory = $true)][string]$Code,
        [System.Collections.IDictionary]$Values = @{},
        [AllowEmptyCollection()][string[]]$Facts = @()
    )

    $exception = New-Object System.Exception((Get-BylProblemReport -Code $Code -Values $Values -Facts $Facts).Problem.Replace($BylProblemNoBreak, ' '))
    $exception.Data['BylProblem'] = $Code
    $exception.Data['BylValues'] = $Values
    $exception.Data['BylFacts'] = $Facts
    return $exception
}

function Get-BylProblemOfError {
    # Code, Values and Facts of an error thrown with New-BylProblemError; $null for any other error.
    param([AllowNull()][object]$ErrorRecord)

    if ($null -eq $ErrorRecord) { return $null }
    $exception = if ($ErrorRecord -is [System.Management.Automation.ErrorRecord]) { $ErrorRecord.Exception } else { $ErrorRecord }
    while ($null -ne $exception) {
        if ($exception -is [System.Exception] -and $exception.Data.Contains('BylProblem')) {
            return [pscustomobject]@{ Code = [string]$exception.Data['BylProblem']; Values = $exception.Data['BylValues']; Facts = @($exception.Data['BylFacts']) }
        }
        $exception = $exception.InnerException
    }
    return $null
}

function Test-BylCanAsk {
    # Whether a script may ask "Soll ich das jetzt erledigen? (J/N)": only a person in a console
    # window, never with -Hidden (autostart), -Quiet, -Json, in a run in the background (a detached
    # restart or restore), with -NonInteractive or with redirected input or output.
    param(
        [bool]$Hidden,
        [bool]$Quiet,
        [bool]$Json,
        [bool]$Background,
        [bool]$UserInteractive,
        [bool]$NonInteractive,
        [bool]$InputRedirected,
        [bool]$OutputRedirected
    )

    if ($Hidden -or $Quiet -or $Json -or $Background -or $NonInteractive) { return $false }
    return $UserInteractive -and -not $InputRedirected -and -not $OutputRedirected
}

function Test-BylYes {
    # Whether an answer to an offer means yes (J, Ja, Y, Yes in any case); everything else is no.
    param([AllowNull()][AllowEmptyString()][string]$Answer)

    return ([string]$Answer).Trim() -match '^(j|ja|y|yes)$'
}

function ConvertTo-BylProblemData {
    # A report for the JSON of -Json and of run\hintergrund-problem.json (fields code, level,
    # exitCode, problem, facts, cause, steps, command, log): the app reads the same words.
    param([Parameter(Mandatory = $true)][object]$Report)

    return [ordered]@{
        code     = $Report.Code
        level    = $Report.Level
        exitCode = $Report.Exit
        problem  = ([string]$Report.Problem).Replace($BylProblemNoBreak, ' ')
        facts    = @($Report.Facts)
        cause    = ([string]$Report.Cause).Replace($BylProblemNoBreak, ' ')
        steps    = @(foreach ($step in @($Report.Steps)) { ([string]$step).Replace($BylProblemNoBreak, ' ') })
        command  = $Report.Command
        log      = $Report.Log
    }
}

function ConvertFrom-BylProblemData {
    # A report again from the data of ConvertTo-BylProblemData read from JSON (a saved problem of a
    # run in the background); $null if $Data is no such object.
    param([AllowNull()][object]$Data)

    if ($null -eq $Data -or $Data -isnot [System.Management.Automation.PSCustomObject]) { return $null }
    $field = { param($Name) $property = $Data.PSObject.Properties[$Name]; if ($null -eq $property) { $null } else { $property.Value } }
    $code = [string](& $field 'code')
    $level = [string](& $field 'level')
    $problem = [string](& $field 'problem')
    if ($code -eq '' -or $problem -eq '' -or @('error', 'warning') -notcontains $level) { return $null }
    $exit = & $field 'exitCode'
    return [pscustomobject]@{
        Code    = $code
        Level   = $level
        Exit    = if ($exit -is [int] -or $exit -is [long]) { [int]$exit } else { 1 }
        Problem = $problem
        Facts   = @(@(& $field 'facts') | Where-Object { $_ -is [string] -and $_ -ne '' })
        Cause   = [string](& $field 'cause')
        Steps   = @(@(& $field 'steps') | Where-Object { $_ -is [string] -and $_ -ne '' })
        Command = [string](& $field 'command')
        Offer   = ''
        Log     = [string](& $field 'log')
    }
}
