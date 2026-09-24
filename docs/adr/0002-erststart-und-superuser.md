# ADR-0002: Erststart und Superuser-Anlage über den PocketBase-Installer

- **Status:** Angenommen
- **Datum:** 2026-09-24
- **Entscheidung durch:** Advisor

## Kontext

Eine frische Installation (`app/` ohne `pb_data/`) hat weder einen PocketBase-Superuser noch einen App-Nutzer. Das Repo liegt auf GitHub (inzwischen privat) und kann jederzeit weitergegeben werden, deshalb dürfen Zugangsdaten weder im Repo noch in Start-Skripten stehen. Selbstregistrierung ist laut CLAUDE.md §5 gesperrt.

PocketBase 0.40.4 verhält sich beim `serve` ohne Superuser so (geprüft im Quelltext `apis/installer.go`, Tag `v0.40.4`):

- Es legt einen internen System-Superuser `__pbinstaller@example.com` mit Zufallspasswort an. Dieser zählt nicht als echter Superuser.
- Es erzeugt einen **30 Minuten gültigen** Token und öffnet `http://127.0.0.1:8090/_/#/pbinstall/<token>` im Standardbrowser (`osutils.LaunchURL`). Die URL wird zusätzlich auf der Konsole ausgegeben.
- Das passiert bei **jedem** `serve`, solange kein echter Superuser existiert. Nach Ablauf des Tokens reicht also ein Neustart.
- Der Installer lässt sich mit `pocketbase superuser upsert EMAIL PASS` umgehen.

`start.bat` startet PocketBase über `start-hidden.vbs` ohne sichtbare Konsole. Die Konsolenausgabe mit der Installer-URL sieht der Nutzer deshalb nicht; der Browser-Tab öffnet sich trotzdem. Anschließend öffnet `start.bat` zusätzlich `http://127.0.0.1:8090` (die App).

## Entscheidung

1. **Erststart über den eingebauten Installer.** Beim allerersten Start öffnet PocketBase einmalig die Installer-Seite. Dort legt der Nutzer seinen Superuser an (E-Mail und Passwort frei gewählt).
2. **App-Nutzer im Admin-UI.** Danach legt der Nutzer im Admin-UI (`/_/` → Collections → `users` → New record) seinen normalen App-Nutzer an. Mit diesem meldet er sich in der App an. Superuser und App-Nutzer sind getrennte Konten: Der Superuser verwaltet PocketBase, der App-Nutzer besitzt die Daten (`owner`).
3. **Keine hartkodierten Zugangsdaten** in Repo, Start-Skripten, Migrationen oder Hooks. Es gibt keine Seed-Migration mit Nutzern.
4. **Selbstregistrierung bleibt gesperrt** (`users.createRule = null`, per Migration gesetzt und per Test geprüft). OAuth2 und OTP bleiben deaktiviert.
5. **Hinweise statt Automatik:**
   - `start.bat` gibt beim Erststart einen kurzen Hinweis im Startfenster aus. Erkennungsmerkmal: `pb_data\data.db` fehlt vor dem Start. Wortlaut sinngemäß: „Erster Start: Im Browser öffnet sich der PocketBase-Installer. Superuser anlegen, danach unter Collections > users den App-Nutzer anlegen. Link abgelaufen? stop.bat und start.bat erneut ausführen.“ Das Fenster wartet dann auf eine Taste, damit der Hinweis lesbar bleibt.
   - Die Login-Seite der App zeigt dauerhaft einen dezenten Hinweis „Noch kein Zugang? Nutzer im Admin-UI unter /_/ anlegen“ mit Link.
   - Die README bekommt einen Abschnitt „Erster Start“.
6. **Keine zusätzliche Setup-Route.** Eine Hook-Route, die meldet, ob schon Nutzer existieren, entfällt. Sie wäre eine zusätzliche, öffentlich erreichbare Schnittstelle ohne echten Mehrwert gegenüber den statischen Hinweisen.

## Alternativen

- **Superuser per `superuser upsert` in `start.bat` mit Eingabeaufforderung:** Das Passwort landet in der Kommandozeile bzw. Prozessliste, und die Batch-Eingabe ist fehleranfällig (Sonderzeichen). Der Installer bietet dasselbe mit besserer UX. Verworfen.
- **Seed-Migration mit Standard-Zugangsdaten:** unsicher in einem Repo auf GitHub (auch einem privaten) und bei späterem Tailnet-Zugriff. Verworfen.
- **Eigene Setup-Seite in der SPA, die Superuser und App-Nutzer in einem Schritt anlegt:** bräuchte eine unauthentifizierte Hook-Route mit Schreibrechten, also zusätzliche Angriffsfläche. Verworfen.
- **Installer abschalten (`e.installerFunc = null` im `onServe`-Hook):** Dann bräuchte der Nutzer die CLI. Verworfen.

## Konsequenzen

- Positiv: Keine Zugangsdaten im Repo; die Einrichtung nutzt die gepflegte PocketBase-UI.
- Positiv: Kein Skript muss Passwörter verarbeiten.
- Negativ: Beim Erststart öffnen sich zwei Browser-Tabs (Installer und App). Das ist akzeptabel und wird im Starthinweis erklärt.
- Negativ: Beim Autostart vor der Ersteinrichtung öffnet sich der Installer ungefragt. Das ist beabsichtigt; ohne Superuser ist die App ohnehin nicht nutzbar.
- Die Erkennung „Erststart“ über fehlendes `data.db` ist eine Näherung. Bricht der Nutzer den Installer ab, zeigt der nächste Start keinen Hinweis mehr, der Installer öffnet sich aber erneut. Das reicht aus.
- Für Agenten und Tests gilt unverändert CLAUDE.md §11.2: vor jedem `serve` erst `superuser upsert` in einem Wegwerf-Datenordner, damit sich nie der Installer öffnet.

## Nachtrag (E1, Paket 8, 2026-09-24)

Umsetzung abweichend von Punkt 5 und den Konsequenzen oben: Beim Erststart öffnet sich **nur ein** Tab (die Einrichtung, von PocketBase selbst geöffnet); das Start-Skript öffnet die App dann nicht. Erkannt wird der Erststart bevorzugt am Installer-Link in der Server-Ausgabe, Fallback ist ein fehlendes `pb_data\data.db`. Damit erscheint der Hinweis auch nach einem abgebrochenen Installer wieder. Details im [E1-Plan](../plan/e1.md), Abschnitt 6, Paket 8.

## Nachtrag (E1.1, 2026-09-24): Notfallskript `admin-zuruecksetzen.bat`

**Anlass:** Beim ersten echten Test wurde der Installer-Tab übersehen. Ein vergessenes Admin-Passwort ließ sich nicht zurücksetzen: Ohne Mailserver meldet „Forgotten password“ zwar Erfolg, eine Mail kommt aber nie an. Einen Weg zurück, der keine Daten löscht, gab es nicht.

**Entscheidung:** Zur Entscheidung gehört jetzt das Notfallskript `app\admin-zuruecksetzen.bat`. Es ist eine dünne Hülle um die Aktion `ResetAdmin` in `byl-control.ps1`.

- Das Skript fragt die E-Mail ab und das Passwort zweimal verdeckt (`Read-Host -AsSecureString`). Der Klartext entsteht nur kurz über `SecureStringToBSTR`, die unverwaltete Kopie wird mit `ZeroFreeBSTR` gelöscht.
- Es prüft die Eingabe: gültige E-Mail, beide Passwörter gleich, 10 Zeichen bis 71 Byte (bcrypt-Grenze), keine Anführungszeichen und keine Steuerzeichen.
- Danach ruft es `pocketbase.exe superuser upsert` auf den Ordnern der App auf (`pb_data`, `pb_hooks`, `pb_migrations`, `--automigrate=false`). Der Aufruf läuft über `ProcessStartInfo` mit korrekt gequoteten Argumenten. Die Flags stehen vorn und `--` beendet sie, damit ein Passwort mit führendem `-` nicht als Flag gelesen wird.
- Mit `upsert` wird ein fehlendes Admin-Konto angelegt oder das Passwort eines vorhandenen neu gesetzt. Tickets und App-Konten bleiben unberührt. Existiert noch kein Admin-Konto, entfernt PocketBase dabei das interne Installer-Konto, und ein offener Einrichtungslink wird ungültig.
- Ausgegeben werden nur Erfolg oder Fehler. Die PocketBase-Ausgabe erscheint nur im Fehlerfall, und das Passwort ist darin durch `***` ersetzt. Protokolliert wird nichts.
- Das Skript funktioniert auch bei laufendem Server. Geprüft wurde das mit einem Wegwerf-Ordner (SQLite im WAL-Modus): Ein neues Konto und ein geändertes Passwort gelten sofort. Meldet PocketBase trotzdem eine gesperrte Datenbank, rät das Skript, zuerst `stop.bat` auszuführen.

**Begründung:** Ohne Mailserver ist das der einzige Weg, ein vergessenes Admin-Passwort oder einen verpassten Installer ohne Datenverlust zu beheben. Der Installer bleibt der Standardweg für den Erststart. Die oben verworfene Alternative „Superuser per `superuser upsert` in `start.bat`“ gilt weiterhin für den Startpfad. Das Notfallskript ist ein getrenntes Werkzeug und nimmt die Eingabe in PowerShell entgegen, nicht in Batch. Damit sind die damaligen Einwände behoben: Sonderzeichen werden sauber gequotet, und das Passwort erscheint nicht in der Eingabezeile. Eine neue Netzwerkschnittstelle entsteht nicht. Wer das Skript ausführen kann, hat ohnehin Zugriff auf `app\pb_data`.

**Restrisiko (bewusst akzeptiert):**

- PocketBase nimmt das Passwort nur als Kommandozeilenargument an, nicht über stdin oder eine Datei. Solange `pocketbase.exe superuser upsert` läuft (gemessen rund 0,1–0,2 s), steht das Passwort deshalb in der Prozess-Kommandozeile. Jeder Prozess desselben Benutzers oder eines Administrators kann es in diesem Moment lesen, etwa über `Win32_Process.CommandLine`.
- .NET-Zeichenketten lassen sich nicht überschreiben. Der Klartext bleibt im Speicher des PowerShell-Prozesses, bis dieser endet. Das Skript beendet sich direkt nach der Pause.
- Für einen lokalen Einzelplatzrechner ist das vertretbar. Wer im Benutzerkontext Code ausführen kann, kann auch `pb_data` direkt lesen.

**Konsequenzen und Änderungen gegenüber oben:**

- Die Konsequenz „Kein Skript muss Passwörter verarbeiten“ gilt nicht mehr, sie betrifft nur noch das Notfallskript.
- Punkt 5 der Entscheidung ist geändert:
  - Die Login-Seite verweist Endnutzer nicht mehr auf `/_/`. Ohne Admin-Konto führte das in eine Sackgasse. Sie zeigt jetzt „Kein Zugang oder Passwort vergessen? Wende dich an die Person, die becauseyoulovejira eingerichtet hat.“ Darunter steht ein klar markierter Link „Verwaltung (nur Admin)“.
  - Der Erststart-Hinweis und die README nennen das Notfallskript für den Fall „Link verpasst oder abgelaufen“.
- Mail-basierte Abläufe werden serverseitig abgewiesen, solange kein Mailer eingerichtet ist: `request-password-reset`, `request-verification`, `request-email-change` und `request-otp` bekommen einheitlich 400 mit Verweis auf README und Notfallskript. Login-Warnmails (`authAlert`) sind abgeschaltet. Details im [E1-Plan](../plan/e1.md), Abschnitt „E1.1 Nachbesserung“.
