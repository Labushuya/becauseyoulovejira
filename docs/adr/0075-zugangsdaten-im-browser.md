# ADR-0075: Zugangsdaten der Kanäle im Browser setzen

- **Status:** Angenommen und umgesetzt (Paket BW-3); Fälle im Test-Manifest BYL-E6-2297 bis BYL-E6-2319, manuelle Prüfungen BYL-E6-2317 bis BYL-E6-2319
- **Datum:** 2026-10-31
- **Entscheidung durch:** Nutzer (Ziel „Zugangsdaten direkt beim Kanal im Browser setzen, die .bat bleibt Notfall“ und die Entscheidungen 1 bis 5 unten), Advisor (Auftrag BW-3 mit Sicherheitsanforderungen S1 bis S8 und Verhalten V1 bis V7), Executor (Bestandsaufnahme, Liste der gesperrten Namen, Neustart-Mechanik, Umsetzung, Tests)
- **Bezug:** [ADR-0018](0018-secrets.md) (Zugangsdaten nur als `BYL_*`-Benutzervariablen), [ADR-0039](0039-betriebsskripte.md) (Steuerskript, `Sync-BylEnvironment`, Fingerabdruck), [ADR-0043](0043-system-seite.md) (Prüfkette `check`, feste Befehle, losgelöster Neustart), [ADR-0046](0046-sicherung-pruefung-wiederherstellen.md) (Vorbild: Passphrase über die Standardeingabe, `Set-BylAccountVariable`), [ADR-0048](0048-fehlerkatalog-der-skripte.md) (Fehlerkatalog), [ADR-0057](0057-kontextabhaengige-oberflaeche.md) (Kontext des Tabs), [ADR-0071](0071-fehlerdetails-und-sitzungsprotokoll.md) („Details“), [ADR-0072](0072-neustart-im-assistenten-und-rueckkehr-zum-schritt.md) (Neustart an Ort und Stelle, „Notfall“), [ADR-0073](0073-smartphone-layout.md), [ADR-0074](0074-postausgang-fuer-aenderungen-ohne-verbindung.md) (Postausgang)

## Kontext

Bis BW-1 setzte man Zugangsdaten nur außerhalb der App: `setx` in der Eingabeaufforderung oder die Systemsteuerung, danach `neu-starten.bat`. BW-1 brachte „Jetzt neu starten“ in die Assistenten; der Schritt „Variable setzen“ verlangte aber weiter `setx` (ADR-0072, Grenzen). Nach der Nutzerregel „Bedient wird primär im Browser, die .bat bleibt nur Notfall“ (CLAUDE.md §7) gehört das Setzen in die App.

Bestandsaufnahme (Stand `075a8119`):

- Werte liest der Server mit `$os.getenv` aus seiner Prozessumgebung; `byl-control.ps1` reicht beim Start alle `BYL_*`-Variablen frisch aus dem Benutzerbereich weiter (`Sync-BylEnvironment`, ADR-0018 §6). Das einzige Schreiben ins Konto ist `Set-BylAccountVariable` (Wiederherstellen, ADR-0046 §7); eine isolierte Testkopie (`BYL_TEST_ISOLATED=1`) schreibt dort nur in die Datei `BYL_TEST_ACCOUNT_FILE` des Tests.
- Geheime Eingaben kommen vom Browser nur über die Standardeingabe ans Steuerskript (Passphrase, `input: true` der Whitelist).
- `secretNames` (Seite „Sicherheit“) und `knownSecrets` (Bereinigung der Logs) kannten die erlaubten IDs von Telegram (`settings.allowed_env`) nicht.

## Entscheidung

### 1. Welche Namen setzbar sind (Entscheidung 1)

- **Setzbar** sind nur Namen, die Kanäle der eigenen Instanz lesen (`secret_env` jeder Verbindung und bei Telegram `settings.allowed_env`, gleich welches Konto sie besitzt), und die Namen, die die Einrichtung für einen Kanal vorschlägt, bevor seine Verbindung existiert: `BYL_GOOGLE_CALENDAR_URL`, `BYL_TELEGRAM_TOKEN`, `BYL_TELEGRAM_ALLOWED_IDS`, `BYL_WEBDE_PASSWORD`, `BYL_GMAIL_PASSWORD`, `BYL_NOTION_TOKEN`, `BYL_GITHUB_TOKEN`, je auch mit der Endung von `freeVariableName` (`_2` bis `_999`). Die Liste steht in `lib/credential-rules.js` (`SUGGESTED`) und gleicht `domain/connections.ts` (Paritätstest).
- **Immer** gilt das Muster `^BYL_[A-Z0-9_]{1,60}$` (ADR-0018 §1).
- **Gesperrt** sind, auch wenn ein Kanal sie nennt, die Namen des Systems und die Schalter der Tests (§3).
- Der Server setzt das durch (`nameProblem` vor jedem Befehl), das Steuerskript prüft Muster und Sperrliste ein zweites Mal (`Test-BylCredentialName`), die Oberfläche bietet nur die Namen ihrer Kanäle an.

### 2. Entfernen fragt nach (Entscheidung 2)

„Entfernen …“ öffnet die Bestätigung „‹Name› entfernen?“ mit „Diese Kanäle betrifft das: …“ (alle Verbindungen der Instanz, die den Namen lesen, aus der Antwort des Servers) bzw. „Kein Kanal dieser App verwendet die Variable.“ und dem Hinweis, dass ein Kanal ohne die Variable nach dem nächsten Neustart nichts mehr abruft.

### 3. Gesperrte Namen und ihre Herleitung

Abgeleitet aus jedem `BYL_*`-Namen, den `app/` (Hooks, Skripte, `.bat`, Landing-Seite) und die Hilfsprogramme lesen. Ein Test (`tests/unit/credential-rules.test.mjs`) liest den Code und schlägt an, sobald ein neuer Name weder gesperrt noch ein Vorschlag ist.

| Name | Wo im Code | Warum gesperrt |
|---|---|---|
| `BYL_INGEST_TOKEN` | `lib/ingest-rules.js`, `lib/system-service.js`, `Initialize-IngestToken`, `helpers/mail` | Zugang des Mail-Hilfsprozesses; legt das Steuerskript selbst an (ADR-0018 §8) |
| `BYL_HOST_PLATFORM` | `lib/host-platform.js` | System des Servers (ADR-0028) |
| `BYL_MAIL_HELPER_PORT` | `lib/mailbox-rules.js`, `helpers/mail/src/mailbox-limits.ts` | Port des Mail-Hilfsprozesses |
| `BYL_MAIL_INTERVAL_SECONDS` | `helpers/mail/src/config.ts` | Takt des Hilfsprozesses (Tests) |
| `BYL_MAIL_TEST_IMAP_PORT` | `helpers/mail/src/config.ts` | IMAP-Server der Tests statt des Anbieters |
| `BYL_TELEGRAM_API_BASE` | `lib/channel-telegram-run.js` | Adresse der Telegram-API: ein Wert schickte jeden Bot-Token an einen anderen Server |
| `BYL_APP_URL` | `byl-functions.ps1` (`run/app-adresse.js`), `becauseyoulovejira.html` | Adresse der App für die Landing-Seite; ein Name des Systems |
| `BYL_EXIT`, `BYL_CODE`, `BYL_DIR`, `BYL_DIRQ` | `app/*.bat`, `byl-pruefen.bat` | Variablen der `.bat`-Dateien |
| `BYL_TEST_*` (Präfix) | `lib/folder-rules.js`, `lib/github-rules.js`, `lib/notion-rules.js`, `lib/page-copy-service.js`, `byl-control.ps1` (`BYL_TEST_ISOLATED`, `BYL_TEST_ACCOUNT_FILE` …) | Schalter und Nähte der Tests; `Select-BylSecretVariable` und `Set-BylAccountVariable` lassen sie seit ADR-0046 aus |

Nicht gesperrt ist `BYL_SELBSTTEST`: nur ein Schlüssel im Selbsttest von `byl-backup.exe`, keine Variable. Dieselbe Liste steht in `byl-functions.ps1` (`$BylBlockedCredentialNames`, `$BylBlockedCredentialPrefixes`; Paritätstest).

### 4. Nur am PC (Entscheidung 4)

- Lesen des Zustands, Setzen und Entfernen gehen nur über die bestehende Prüfkette `check` aus `lib/system-service.js` in ihrer Reihenfolge: Windows, dieser Rechner (Adresse der Verbindung und `realIP` Loopback, keine Proxy-Kopfzeile), `Host` und `Origin` der App, Verwalter der App, Rate-Limit; dann die Anfrage (§1, §6 S8); zuletzt die eigene Instanz eines Ordners `app`. Nichts davon ist gelockert; Heimnetz, VPN und Proxy sind andere Geräte.
- Setzen und Entfernen zählen in einem eigenen Fenster des Rate-Limits (`credential`, 10 je Minute wie Aktionen), damit einige Änderungen „Jetzt neu starten“ danach nicht sperren.
- Die Oberfläche folgt dem Kontext des Tabs (`capabilities.scripts`, das Muster von `RestartAction`): am Handy und auf jedem anderen Gerät sind „Setzen …“ und „Entfernen …“ deaktiviert (`aria-disabled`), statt des Zustands und darunter steht „Nur am PC möglich“, und der Zustand wird dort nicht einmal erfragt.

### 5. Speicherort und Neustart (Entscheidung 5 und 3)

- Werte stehen weiter nur als Benutzervariablen von Windows (ADR-0018); es gibt keine Collection, keine Datei und keinen Speicher im Browser für sie.
- Nach Setzen oder Entfernen fragt die Stelle „Jetzt neu starten?“ mit „Jetzt neu starten“ und „Später“ (Bestätigung; in einem Modal inline, ADR-0025 Nachtrag 16). „Jetzt neu starten“ ist der Neustart der Seite „System“ (`RestartStore`, `POST /api/byl/system/actions/restart`), Fortschritt und Ergebnis zeigt `RestartAction` an derselben Stelle.
- **Hinweis bis zum Neustart:** Nach jeder gelungenen Änderung legt der Server die Marke `byl.credentials.restart-needed` (Zeit in ms) in `$app.store()` ab, also im Speicher seines Prozesses. `GET /api/byl/credentials/restart-notice` antwortet `{ needed }` dem Verwalter auf jedem Gerät, ohne Loopback, weil er nur Ja oder Nein nennt, nichts ausführt und keinen Namen und keinen Wert verrät; jedes andere Konto bekommt 403 `owner`. Die Seite „Kanäle“ zeigt dann über den Karten „Neustart nötig, damit geänderte Zugangsdaten wirken“ (Warnung, kein Rot) mit „Jetzt neu starten“ am PC bzw. wer wo neu startet auf anderen Geräten; „‹Name› bearbeiten“ zeigt denselben Hinweis. Er übersteht ein Neuladen, steht auf allen Geräten und geht mit dem nächsten Neustart von selbst: Der neue Prozess startet ohne die Marke. Die Seite fragt beim Öffnen, wenn der Tab wieder sichtbar wird und nach einem Neustart von hier.
- Solange ein Neustart läuft (`RESTART_KEY`, 90 s), lehnt der Server Änderungen mit `busy` ab: Der neue Prozess hätte die Umgebung schon gelesen, und die Marke ginge mit dem alten.
- **Beleg, dass der Neustart die Benutzerumgebung neu einliest (V4):** `POST /api/byl/system/actions/restart` → `byl-control.ps1 restart -Detach -Quiet` → `Start-DetachedRestart` → eigener Prozess `restart -WaitForProcess` → `Invoke-Restart` → `Invoke-StopCore` und `Invoke-Start` → `Start-Server` → `Initialize-IngestToken` und `Sync-BylEnvironment` (liest `[Environment]::GetEnvironmentVariables('User')` frisch aus der Registry, setzt neue und entfernt gelöschte `BYL_*` im eigenen Prozess) → `Start-Process pocketbase.exe` erbt diese Umgebung. Der Fingerabdruck des Starts enthält eine verschlüsselte Prüfsumme der Variablen; `status` nennt danach „BYL_*-Variable angelegt, geändert oder entfernt“, bis neu gestartet ist. Getestet in `tests/unit/start-logic.test.mjs` (`Get-BylEnvironmentChange`), `tests/unit/control-logic.test.mjs` (Grund `environment`) und `tests/integration/system-control.test.mjs` (losgelöster Neustart; seit BW-3 auch: der Hinweis ist danach weg).

### 6. Sicherheitsmodell (S1 bis S8)

- **S1 Wert nur im Body, nie zurück:** `POST /api/byl/credentials/set` mit `{ name, value }`; Adresse und Query tragen nur Namen. Keine Antwort, kein Zustand und kein Log nennt Länge, Teil oder Prüfsumme eines Werts; der Zustand ist je Name nur `true`, `false` oder `null`. Die Antwort des Steuerskripts liest der Server nur auf `ok` und `problem` (`scriptAnswer`), den Bericht des Katalogs reicht er nicht weiter.
- **S2 Nur Standardeingabe:** `credential-status`, `credential-set` und `credential-remove` stehen in der Whitelist mit festen Argumenten (`[<befehl>, '-Json']`) und `input: true`; `run` schreibt die Eingabe nur in die Pipe der Standardeingabe. Das Skript liest den Wert nie aus einem Argument (der zweite Parameter `$Value` bleibt ungelesen; ohne Eingabe meldet es `credential-input`).
- **S3 Nirgends geloggt:** Die Hooks loggen Aktion, Name, Konto und Grund, nie den Wert und nie den Body; Fehler beim Lesen des Bodys bleiben im Hook (feste Antwort `invalid`). Das Steuerskript parst die Eingabe mit .NET (`JavaScriptSerializer`), nie mit einem Cmdlet, damit keine Parameterbindung (Modul-Protokollierung von PowerShell) den Wert enthält; ein kaputtes JSON nennt keinen Teil von sich. `byl-control.log` bekommt nur `name=` bzw. `problem=`; ein Fehler beim Schreiben nennt nur den Typ der Ausnahme. Die Standardausgabe enthält nur `{ ok, name }` bzw. das Problem, die Fehlerausgabe liest der Server nicht.
- **S4 Server setzt die Liste durch:** §1 und §3 im Hook, dazu Muster und Sperrliste im Steuerskript.
- **S5 Nur über `check`:** §4. Einzige Ausnahme ist der Hinweis `restart-notice`, der keinen Zugriff auf Zugangsdaten gibt (§5).
- **S6 Nie im Browser gespeichert:** Der Wert lebt nur im Zustand von `CredentialField`, solange er getippt wird, geht als Argument durch `CredentialsStore.set` in den Body der Anfrage und wird nirgends gehalten: kein Store-Feld, kein `localStorage`, kein `sessionStorage`, keine Adresse, kein Eintrag im Sitzungsprotokoll (ADR-0071: nie Body). Die Anfragen gehen nicht durch den Postausgang (ADR-0074): Er nimmt nur seine eigenen Aktionen, und die Datenschicht der Zugangsdaten gibt ihm keine, auch nicht am PC im Handy-Rahmen mit scharfem Postausgang. Ohne Verbindung sagt die Stelle „Keine Verbindung zum Server: Die Zugangsdaten wurden nicht geändert. Die App merkt sich den Wert nicht und schickt ihn auch später nicht …“.
- **S7 Eingabefeld:** `type="password"`, `autocomplete="new-password"`, Attribute gegen Passwort-Manager und Rechtschreibprüfung, nie vorbefüllt, ohne „Anzeigen“; nach jedem Absenden leer, bei Erfolg wie bei Fehler und auch, wenn die Prüfung im Browser schon ablehnt.
- **S8 Wertprüfung:** nicht leer (auch nicht nur Leerzeichen; zum Leeren dient „Entfernen“), keine Steuerzeichen (C0 samt Tab, CR und LF, DEL, C1), höchstens 4096 Zeichen (UTF-16-Einheiten). Nie getrimmt; Leerzeichen am Anfang oder Ende zeigt das Feld als Warnung. Dieselbe Prüfung im Browser (`domain/credentials.ts`), im Hook und im Steuerskript (Paritätstests).

### 7. Routen und Befehle

- `credentials.pb.js` mit `lib/credential-service.js` und den reinen Regeln `lib/credential-rules.js`: `GET /api/byl/credentials?names=…` (Zustand der Namen der Verbindungen und bis zu 20 weiterer erlaubter Namen einer Einrichtung, je mit `channels` und `blocked`, dazu `restartNeeded`; `no-store`), `POST …/set`, `POST …/remove`, `GET …/restart-notice`. 400 mit `problem` (`invalid`, `name`, `blocked`, `unknown`, `empty`, `control`, `long`, `write`) und dem Text, sonst die Ablehnungen der Seite „System“.
- `byl-control.ps1`: `credential-status` (liest den Benutzerbereich über `Get-BylVariableScope`), `credential-set` und `credential-remove` (schreiben nur über `Set-BylAccountVariable`), Fehler über die Einträge `credential-input`, `credential-name`, `credential-blocked`, `credential-value` und `credential-write` des Katalogs. Setzen und Entfernen schreiben eine Zeile in `byl-control.log`.
- Telegram `allowed_env` zählt jetzt überall als Variable des Kanals (V7): `connection-rules.validVariableNames`, `connection-service.variableNamesOf`, genutzt von `knownSecrets` (Logs), `secretNames` (Seite „Sicherheit“) und den Routen hier.

### 8. Oberfläche

- `CredentialField` je Variable: Name, Zustand („gesetzt“, „fehlt“, „gehört der App“, am Handy „Nur am PC möglich“), „Setzen …“ bzw. „Ersetzen …“, „Entfernen …“, das Feld mit Prüfung, die beiden Fragen und der Neustart an Ort und Stelle.
- `CredentialsBlock` „Zugangsdaten“ in den Details der Karten von Kalender, Telegram, Postfächern, Notion und GitHub (im Menü „•••“ „Zugangsdaten …“ wie „Zielprojekt …“) und in „‹Name› bearbeiten“ statt der bloßen Namen; darunter eine Zeile „Notfall“ mit `setx` und `neu-starten.bat`, nur für den Verwalter am PC unter Windows (V6).
- Der Assistent setzt im Schritt „Variable setzen“, „Token setzen“ (mit den erlaubten IDs) und „Chat freigeben“ im Browser, auch den vorgeschlagenen Namen vor der Verbindung; `setx` und die Systemsteuerung stehen dort nur eingeklappt unter „Notfall: Variable über Windows setzen“.
- Keine Regel für den Handy-Rahmen: die gemeinsamen Knöpfe und Bestätigungen passen sich zentral an (MO-1b).

## Alternativen

- **Werte in einer Collection oder Datei:** widerspricht ADR-0018 und Entscheidung 5. Verworfen.
- **Den Hinweis aus dem Fingerabdruck von `status` ableiten:** genau, aber nur am PC lesbar (die Route verlangt Loopback), also nicht auf allen Geräten. Verworfen zugunsten der Marke im Speicher des Servers, die zudem mit dem Neustart von selbst geht.
- **Den Hinweis in `GET /api/byl/context`:** jede Antwort des Kontexts änderte ihre Form für alle Tabs und Tests. Verworfen zugunsten einer eigenen kleinen Route.
- **Jeden Namen erlauben, der nicht gesperrt ist:** ein Tab des Verwalters könnte beliebige `BYL_*`-Variablen anlegen. Verworfen (Entscheidung 1).
- **Den Wert mit `ConvertFrom-Json` lesen wie die Passphrase:** schlichter, aber mit eingeschalteter Modul-Protokollierung stünde der Wert in der Parameterbindung im Ereignisprotokoll. Verworfen für Zugangsdaten.
- **`credential-set` auch im Konsolenfenster mit verdeckter Eingabe:** wäre ein weiterer Notfallweg, aber nicht nötig; im Notfall bleiben `setx` und die Systemsteuerung. Zurückgestellt.

## Konsequenzen

- Neue Hooks (`credentials.pb.js`, zwei Module) und geänderte Module: nach dem Deploy ist ein Neustart nötig.
- Die Seite „Kanäle“ und die Assistenten schicken für Zugangsdaten nicht mehr aus dem Browser hinaus; `setx` und `neu-starten.bat` stehen nur noch unter „Notfall“.
- Jeder neue `BYL_*`-Name im Code muss gesperrt oder als Vorschlag eingetragen werden (Test).

## Grenzen

- Der Zustand kommt aus dem Benutzerbereich; ein Wert nur im Computerbereich zählt als „fehlt“ und lässt sich hier nicht entfernen (er braucht Administratorrechte).
- Server unter Linux oder im Container (Plattform-Ausbau zurückgestellt): Die Routen antworten `platform`, die Felder zeigen „Auf diesem Server nicht verfügbar.“.
- Wer am PC das entsperrte Windows-Konto hat, kann die Variablen ohnehin lesen (ADR-0018, Konsequenzen); BW-3 ändert daran nichts.
