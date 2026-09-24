# ADR-0018: Zugangsdaten der Kanäle als Windows-Umgebungsvariablen

- **Status:** Angenommen
- **Datum:** 2026-09-25
- **Entscheidung durch:** Nutzer (Umgebungsvariablen, Kanal-Recherche 2026-09-24), Advisor (Regeln im Detail)
- **Bezug:** [ADR-0016](0016-kanal-architektur-und-mail.md) (Kanäle), CLAUDE.md §12 („Niemals Secrets … committen“)

## Kontext

Kanäle brauchen Geheimnisse:

| Kanal | Geheimnis | Reichweite bei Verlust |
|---|---|---|
| Google Calendar | geheime iCal-Adresse | Lesezugriff auf den Kalender; in Google über „Zurücksetzen“ widerrufbar |
| Telegram | Bot-Token | Steuerung des Bots (nicht des eigenen Kontos); über @BotFather widerrufbar |
| Web.de | anwendungsspezifisches Passwort | voller IMAP/SMTP-Zugang zum Postfach; einzeln widerrufbar |
| Proton | Bridge-Passwort | nur über die lokale Bridge nutzbar |
| Gmail | App-Passwort | voller IMAP/SMTP-Zugang; einzeln widerrufbar |
| Notion (zurückgestellt) | Token der internen Integration | nur die freigegebenen Seiten, Rechte je Integration |
| Hilfsprozess | Ingest-Token (`BYL_INGEST_TOKEN`) | Einträge für aktive Mail-Verbindungen anlegen |

`app/` wird kopiert und gesichert (CLAUDE.md §1); `pb_data` steckt in jedem Backup. Geheimnisse in der Datenbank oder im Ordner würden also in jeder Kopie und jedem Backup mitreisen.

## Entscheidung

1. **Speicherort:** Geheimnisse liegen ausschließlich als **Benutzer-Umgebungsvariablen** von Windows (Systemsteuerung „Umgebungsvariablen für dieses Konto bearbeiten“ oder `setx`). Namen: `BYL_` plus Großbuchstaben, Ziffern und `_`, höchstens 64 Zeichen (Muster `^BYL_[A-Z0-9_]{1,60}$`).
2. **Nie** im Repo, in `app/`, in `pb_data` (auch nicht verschlüsselt), in Logs, in Fehlermeldungen, in API-Antworten oder in Realtime-Events. `connections.secret_env` speichert nur den **Namen** der Variablen.
3. **Lesen:** Hooks mit `$os.getenv(name)` erst im Moment des Abrufs, der Hilfsprozess mit `process.env`. Der Name wird vorher gegen das Muster geprüft, damit eine Verbindung keine beliebigen Variablen (etwa `PATH`) auslesen kann.
4. **Anzeige:** Die Oberfläche zeigt je Verbindung nur „Zugangsdaten gesetzt“ oder „Zugangsdaten fehlen: Variable `BYL_…` anlegen, dann die App neu starten“. Eine Route liefert dafür nur ein Ja/Nein, nie den Wert.
5. **Bereinigung:** Fehlertexte aus `$http.send` und aus dem Hilfsprozess werden vor dem Speichern in `connections.last_error` und vor dem Protokollieren bereinigt: Der Wert jedes Geheimnisses der Verbindung wird ersetzt (`***`), URLs werden auf Schema und Host gekürzt (die iCal-Adresse und die Telegram-URL `…/bot<Token>/…` enthalten das Geheimnis im Pfad). Ein Test prüft das mit Beispielfehlern.
6. **Neu einlesen:** Ein Prozess sieht Umgebungsvariablen nur vom Start. `byl-control.ps1 Start` liest deshalb alle `BYL_*`-Variablen frisch aus dem Benutzerbereich (`[Environment]::GetEnvironmentVariable(…, 'User')`) und gibt sie an PocketBase und den Hilfsprozess weiter. Eine geänderte Variable wirkt nach `stop.bat` und `start.bat`, ohne Ab- und Anmelden.
7. **Kleinste Rechte:** Geheimnisse, die nur Lesen können, werden bevorzugt (iCal-Adresse, Notion-Integration nur mit Leserecht). Wo das Geheimnis mehr erlaubt (App-Passwörter), erzwingt der Code nur lesenden Zugriff ([ADR-0016](0016-kanal-architektur-und-mail.md) §5). Die README nennt für jedes Geheimnis den Widerrufsweg.
8. **Ingest-Token:** `byl-control.ps1` legt ihn beim ersten Start mit vorhandenem `byl-mail.exe` an (24 Zufallsbytes, Base64), wenn er fehlt, und speichert ihn als Benutzervariable. Es gibt ihn nie aus.

## Alternativen

- **Verschlüsselt in der Datenbank** (`$security.encrypt` mit Schlüssel aus einer Umgebungsvariablen): Der Schlüssel läge trotzdem in der Umgebung, Backups trügen Chiffretext, und es entstünde Code für Schlüsselwechsel. Verworfen.
- **Datei `.env` in `app/`:** reist mit jeder Ordnerkopie und jedem manuellen Backup mit. Verworfen.
- **Windows-Anmeldeinformationsverwaltung (DPAPI):** sicherer gegen andere Programme desselben Nutzers, aber aus der JSVM nicht erreichbar. Neu bewerten, falls der Hilfsprozess weitere Geheimnisse bekommt.
- **Eingabe im Admin-Bereich von PocketBase:** landet in `pb_data`. Verworfen.

## Konsequenzen

- Nach dem Umzug von `app/` auf einen anderen Rechner fehlen die Zugangsdaten; die Oberfläche sagt das je Verbindung. Das ist gewollt.
- Jeder andere Prozess desselben Windows-Nutzers kann die Variablen lesen. Das Risiko ist bewusst in Kauf genommen (lokaler Einzelnutzer-Rechner, ADR-0001); die Widerrufswege stehen in der README.
- Tests setzen Variablen nur für die Wegwerf-Instanz (Prozessumgebung des Test-Servers), nie im Benutzerbereich.
