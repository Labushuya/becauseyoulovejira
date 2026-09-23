# ADR-0002: Erststart und Superuser-Anlage über den PocketBase-Installer

- **Status:** Angenommen
- **Datum:** 2026-09-24
- **Entscheidung durch:** Advisor

## Kontext

Eine frische Installation (`app/` ohne `pb_data/`) hat weder einen PocketBase-Superuser noch einen App-Nutzer. Das Repo ist öffentlich, deshalb dürfen Zugangsdaten weder im Repo noch in Start-Skripten stehen. Selbstregistrierung ist laut CLAUDE.md §5 gesperrt.

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
- **Seed-Migration mit Standard-Zugangsdaten:** unsicher im öffentlichen Repo und bei späterem Tailnet-Zugriff. Verworfen.
- **Eigene Setup-Seite in der SPA, die Superuser und App-Nutzer in einem Schritt anlegt:** bräuchte eine unauthentifizierte Hook-Route mit Schreibrechten, also zusätzliche Angriffsfläche. Verworfen.
- **Installer abschalten (`e.installerFunc = null` im `onServe`-Hook):** Dann bräuchte der Nutzer die CLI. Verworfen.

## Konsequenzen

- Positiv: Keine Zugangsdaten im Repo; die Einrichtung nutzt die gepflegte PocketBase-UI.
- Positiv: Kein Skript muss Passwörter verarbeiten.
- Negativ: Beim Erststart öffnen sich zwei Browser-Tabs (Installer und App). Das ist akzeptabel und wird im Starthinweis erklärt.
- Negativ: Beim Autostart vor der Ersteinrichtung öffnet sich der Installer ungefragt. Das ist beabsichtigt; ohne Superuser ist die App ohnehin nicht nutzbar.
- Die Erkennung „Erststart“ über fehlendes `data.db` ist eine Näherung. Bricht der Nutzer den Installer ab, zeigt der nächste Start keinen Hinweis mehr, der Installer öffnet sich aber erneut. Das reicht aus.
- Für Agenten und Tests gilt unverändert CLAUDE.md §11.2: vor jedem `serve` erst `superuser upsert` in einem Wegwerf-Datenordner, damit sich nie der Installer öffnet.
