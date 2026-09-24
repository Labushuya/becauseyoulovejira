# ADR-0016: Architektur der Kanäle: HTTP-Kanäle im Hook per Cron, Mail über einen Hilfsprozess

- **Status:** Vorgeschlagen. Die HTTP-Kanäle (Abschnitt 2) gelten mit der vom Nutzer festgelegten Kanalreihenfolge als freigegeben. Der Mail-Hilfsprozess (Abschnitt 4) ändert CLAUDE.md §3 („Node nur Dev-Werkzeug“) und wird erst nach Antwort auf OF-E4-4 und OF-E4-5 im [E4-Plan](../plan/e4.md) angenommen.
- **Datum:** 2026-09-25
- **Entscheidung durch:** Nutzer (Kanalreihenfolge, WhatsApp nur als Export, 2026-09-25), Advisor (Architektur)
- **Ergänzt:** [ADR-0011](0011-roadmap-e3-bis-e7.md) §2 (externe Dienste nur mit eigener ADR und Freigabe)

## Kontext

Verbindliche Kanalreihenfolge des Nutzers: (1) manuelle Objekte nach Schema samt Schnellerfassung und Zwischenablage, (2) Web.de Mail, (3) Proton Mail, (4) Gmail, (5) Google Calendar, (6) WhatsApp, (7) Telegram, (8) Notion (zurückgestellt). Dazu Bookmarklet, `.ics` und `.eml` per Drag & Drop.

Die App ist ein portabler Ordner mit einer unveränderten `pocketbase.exe`; Serverlogik läuft ausschließlich als JS-Hook in der Goja-JSVM (CLAUDE.md §3). Node.js ist bisher nur Entwicklungswerkzeug.

### Befunde zur JSVM (PocketBase 0.40.4, Stand 2026-09-25)

Quellen: `plugins/jsvm/binds.go` im Tag `v0.40.4`, Doku „Sending HTTP requests“ und „Jobs scheduling“ (Version 0.40.4), JSVM-Referenz `$os.cmd`.

| Fähigkeit | Befund |
|---|---|
| TCP/TLS-Sockets | **keine.** Es gibt keine Bindung für `net.Dial`, TLS oder IMAP. IMAP, POP3 und SMTP-Empfang sind in Hooks nicht möglich. |
| HTTP | `$http.send({ url, method, body, headers, timeout })`, Standard-Timeout 120 s, blockiert und liefert den ganzen Body (`body` als Bytes, `json`, `headers`, `statusCode`). Kein Streaming, keine Server-Sent Events. |
| Cron | `cronAdd(id, expr, handler)`, 5-Feld-Ausdrücke (kleinstes Intervall 1 Minute), jeder Job in eigener Goroutine; Zeitangaben in UTC ([ADR-0005](0005-zeitzone-europe-berlin.md)). |
| Umgebung | `$os.getenv(name)` |
| Prozesse | `$os.cmd(name, …args)` (Go `exec.Command`) kann externe Programme starten. |
| Hash | `$security.sha256` u. a. |

### Befunde zu den Mail-Anbietern (offizielle Hilfeseiten, Stand 2026-09-25)

| Anbieter | Zugang | Voraussetzungen und Grenzen |
|---|---|---|
| **Web.de** | nur IMAP (`imap.web.de:993`, SSL); keine öffentliche Mail-API | „POP3/IMAP-Abruf“ muss in den E-Mail-Einstellungen eingeschaltet werden (standardmäßig aus, mit Sicherheitsabfrage). Mit Zwei-Faktor-Authentifizierung braucht der Zugang ein **anwendungsspezifisches Passwort** (Account verwalten → Login & Sicherheit). Wird der Zugang längere Zeit nicht genutzt, schaltet Web.de ihn automatisch wieder aus. |
| **Proton Mail** | nur über **Proton Mail Bridge**: lokaler IMAP-Server auf `127.0.0.1` (Standard IMAP 1143, SMTP 1025, STARTTLS oder SSL); keine öffentliche Mail-API | Bridge gibt es **nur mit bezahltem Tarif** (Mail Plus, Unlimited, Duo, Family, Visionary, Business). Eigenes Bridge-Passwort, das den Rechner nicht verlässt. Selbstsigniertes Zertifikat, in den Bridge-Einstellungen exportierbar. Bridge ist eine Desktop-App, die laufen muss („Open on startup“). |
| **Gmail** | IMAP (`imap.gmail.com:993`) oder Gmail-API (REST, OAuth 2.0) | IMAP ist seit Januar 2025 immer eingeschaltet. Für private Konten geht IMAP mit **App-Passwort**; das setzt Bestätigung in zwei Schritten voraus und fehlt bei „Erweitertem Schutz“ sowie bei 2-Schritt nur mit Sicherheitsschlüssel. Google rät von App-Passwörtern ab. **Gmail-API:** `gmail.readonly` und `gmail.metadata` sind *eingeschränkte* Scopes. Ein OAuth-Client im Status „Testing“ mit externem Nutzertyp bekommt Refresh-Tokens, die **nach 7 Tagen ablaufen**. Für „In Produktion“ verlangt Google die Prüfung der App, bei eingeschränkten Scopes mit Sicherheitsbewertung; ungeprüfte Apps zeigen einen Warnbildschirm und sind auf 100 Nutzer begrenzt. |

### Befunde zur Hilfsprozess-Laufzeit

- `imapflow` (MIT, Node ≥ 20): `mailboxOpen`/`getMailboxLock` mit `readOnly: true` nutzt `EXAMINE`; im Nur-Lese-Modus darf der Server keine Flags setzen, auch nicht `\Seen`. Suche nach `seen`, `flagged`, `since`, `uid`, `keyword`. IDLE wird unterstützt.
- `postal-mime` (MIT-0, keine Abhängigkeiten) parst MIME im Browser **und** in Node, mit Grenzen für Verschachtelung und Kopfgröße.
- Node 24 kann eine **Single Executable Application** (SEA) bauen: ein `.exe` mit eingebettetem Node und einem gebündelten CommonJS-Skript (Stabilität 1.1 „Active development“, unter Windows im CI getestet). Das `.exe` ist etwa so groß wie `node.exe` (Größenordnung 80–100 MB).

## Entscheidung

### 1. Drei Arten von Eingangswegen

| Art | Kanäle | Wo läuft der Code |
|---|---|---|
| **Im Browser** | Formular/Vorlage, Schnellerfassung, Zwischenablage, Bookmarklet, `.eml`-Datei, WhatsApp-Export | SPA; legt `inbox_items` über die Record-API an. `.ics`-Dateien gehen als Upload an eine Hook-Route, weil ihr Parser im Hook liegt ([ADR-0017](0017-parser-ics-eml.md)). |
| **Im Hook per Cron** (HTTP-Dienste) | Google Calendar (geheime iCal-Adresse), Telegram (Bot, `getUpdates`), Notion (zurückgestellt) | `app/pb_hooks/channels.pb.js` mit `cronAdd` und `$http.send`, Logik in reinen Modulen unter `lib/` |
| **Im Hilfsprozess** (IMAP) | Web.de, Proton (Bridge), Gmail | `byl-mail.exe` (Abschnitt 4), schreibt über eine Ingest-Route in den Eingang |

Alle drei Arten erzeugen Einträge über **denselben** Dienst `app/pb_hooks/lib/inbox-service.js` (Validierung, Kürzen, Fingerprint, Duplikat-Ergebnis). So gelten dieselben Grenzen und dieselbe Duplikaterkennung für jeden Weg ([ADR-0014](0014-datenmodell-eingang.md)).

### 2. HTTP-Kanäle im Hook

- **Konfiguration:** Collection `connections` mit `type` (`calendar`, `telegram`, `notion`, `mail`), `label`, `enabled`, `secret_env` (Name der Umgebungsvariablen, nie ihr Wert; [ADR-0018](0018-secrets.md)), `settings` (json, ohne Geheimnisse: etwa Chat-IDs der Allowlist, Tage im Voraus, IMAP-Host und Benutzer), `cursor` (Telegram-Offset, IMAP-`UIDVALIDITY:UID`), `last_run_at`, `last_ok_at`, `last_error` (bereinigt, ohne Geheimnisse), `running_since`, dazu `owner`/`household`/`scope`. Regeln wie `tickets`; `cursor`, `last_*` und `running_since` schreibt nur der Server (Hook-Guard lehnt Client-Änderungen ab).
- **Cron:** ein Job je Kanalart (`byl-calendar` alle 15 Minuten, `byl-telegram` jede Minute, `byl-notion` alle 15 Minuten), der alle aktiven Verbindungen dieser Art abarbeitet. Eine Laufsperre über `running_since` (mit Ablauf nach 10 Minuten) verhindert überlappende Läufe. Ein Knopf „Jetzt abrufen“ ruft dieselbe Funktion über eine Route auf (nur für den Besitzer).
- **Grenzen:** `timeout` 30 s je Anfrage; Antworten über 20 MB werden verworfen (Fehler an der Verbindung); höchstens 500 neue Einträge je Lauf und Verbindung.
- **Google Calendar:** Abruf der geheimen iCal-Adresse; Parser gemeinsam mit `.ics`. Nur Termine im Fenster gestern bis heute + N Tage (Standard 30) werden zu Einträgen; Serien einmal als Serie (mit `RRULE` in `source_meta` für E5). Kein Sync zurück, keine Aktualisierung bereits umgewandelter Einträge.
- **Telegram:** eigener Bot; `getUpdates` mit `offset = cursor + 1`, `timeout = 0`, `allowed_updates = ["message"]`. Nur Chats aus der Allowlist (`settings.chat_ids`) werden übernommen; andere Chats werden nicht gespeichert, nur ihre Chat-ID erscheint einmalig als Einrichtungshinweis. Nach dem Speichern sendet der Bot eine Bestätigung („Im Eingang: <Titel>“), weil Telegram nicht abgeholte Updates höchstens 24 Stunden bereithält: Fehlt die Bestätigung, weiß der Nutzer, dass die Nachricht nicht angekommen ist. Der Offset rückt erst nach erfolgreichem Speichern vor.
- **Notion (zurückgestellt):** interne Integration mit Leserecht, `data_sources/{id}/query` mit Filter auf `last_edited_time` > Cursor, Polling alle 15 Minuten. Umsetzung erst nach Freigabe.

### 3. WhatsApp

Nur der offizielle Chat-Export (`.txt` bzw. `.zip` mit `_chat.txt`) als Datei-Import im Browser, mit Auswahlansicht. Die WhatsApp Cloud API (Webhooks, lokal nicht erreichbar) und inoffizielle Bibliotheken (Sperrrisiko für das Konto) sind abgelehnt. Ein Share Target kommt frühestens mit E7 (PWA, HTTPS über Tailscale).

### 4. Mail: Optionen und Empfehlung

| Option | Portabilität | Sicherheit | Aufwand und Wartung |
|---|---|---|---|
| **(a) Node-Hilfsprozess** mit `imapflow` und `postal-mime`, als SEA-Programm `app/byl-mail.exe`, gestartet und gestoppt von `byl-control.ps1` | Kein installiertes Node nötig; ein zusätzliches `.exe` im Ordner (80–100 MB). Kopie von `app/` bleibt lauffähig (Zugangsdaten müssen auf dem neuen Rechner neu gesetzt werden). | Nur-Lese-Zugriff technisch erzwungen (`EXAMINE`), keine Flag-Änderung, kein Löschen, kein Versand. Zugangsdaten nur aus Umgebungsvariablen. Schreibt nur über eine eng begrenzte Ingest-Route. | Mittel: Build-Skript (esbuild, SEA), Tests mit Vitest wie der Rest. Updates von `imapflow`/`postal-mime` über Dependabot. Unsigniertes `.exe` kann eine SmartScreen- oder Virenscanner-Rückfrage auslösen. |
| **(b) REST-APIs statt IMAP** | ohne Hilfsprozess im Hook möglich | OAuth mit eigenem Google-Cloud-Projekt; Refresh-Token als Geheimnis | Nur für Gmail vorhanden. Web.de und Proton haben keine Mail-API. Für Gmail: eingeschränkte Scopes, 7-Tage-Tokens im Status „Testing“ oder Prüfverfahren von Google. Für eine private App unverhältnismäßig. |
| **(c) nur `.eml` per Drag & Drop** | ideal, nichts Zusätzliches | keine Zugangsdaten | gering; aber jede Mail muss von Hand exportiert werden (Web.de und Gmail im Browser umständlich, Proton über „Export“ bzw. Bridge) |
| (d) PowerShell mit MailKit-DLLs | ohne Node, kleine DLLs | wie (a) | MailKit bringt unter .NET Framework 4.8 mehrere abhängige DLLs mit, die gepinnt und geprüft werden müssen; Tests außerhalb von Vitest; zweiter MIME-Parser neben dem der SPA. Verworfen. |
| (e) Hilfsprozess von PocketBase per `$os.cmd` starten | wie (a) | wie (a) | Wird PocketBase hart beendet (`Stop-Process -Force`), bleibt der Kindprozess unter Windows zurück. `byl-control.ps1` verwaltet Prozesse schon. Verworfen. |

**Empfehlung: (a) mit (c) als immer verfügbarer Grundlage.** `.eml` per Drag & Drop kommt vor der Postfachanbindung und bleibt der Weg ohne Zugangsdaten. (b) wird für Gmail nicht umgesetzt; neu bewerten, falls Google App-Passwörter für private Konten abschafft.

Einschätzung pro Anbieter:

- **Web.de:** IMAP über (a) ist der einzige automatische Weg. Voraussetzungen: „POP3/IMAP-Abruf“ einschalten, bei 2FA ein anwendungsspezifisches Passwort. Risiko: automatische Abschaltung bei längerer Nichtnutzung; der Hilfsprozess meldet Anmeldefehler an der Verbindung mit Hinweis auf die Einstellung.
- **Proton:** (a) gegen Bridge auf `127.0.0.1`, nur mit bezahltem Tarif und laufender Bridge. Der Hilfsprozess vertraut ausschließlich dem aus Bridge exportierten Zertifikat (Pfad in `settings`, Fingerprint-Vergleich), nicht beliebigen selbstsignierten. Ohne bezahlten Tarif bleibt nur (c).
- **Gmail:** (a) mit App-Passwort (setzt Bestätigung in zwei Schritten voraus). Die Gmail-API (b) scheitert praktisch an den eingeschränkten Scopes und den 7-Tage-Tokens. Ist ein App-Passwort nicht möglich (Erweiterter Schutz), bleibt (c).

### 5. Der Hilfsprozess im Detail

- **Ablauf:** alle 5 Minuten je Postfach: verbinden (TLS; bei Bridge STARTTLS mit gepinntem Zertifikat), Ordner **nur lesend** öffnen, suchen nach dem vom Nutzer gewählten Umfang (OF-E4-2; Vorschlag: markierte Mails im Posteingang seit dem Einrichtungsdatum), Quelltext der Treffer holen, mit `postal-mime` parsen, über die gemeinsame Normalisierung ([ADR-0017](0017-parser-ics-eml.md)) in einen Entwurf umwandeln und an die Ingest-Route senden, abmelden. Duplikate prüft der Server über den Fingerprint (Message-ID); ein erneuter Abruf ist deshalb folgenlos.
- **Kein Schreibzugriff aufs Postfach:** kein `SELECT`, kein `STORE`, kein `EXPUNGE`, kein `APPEND`, kein SMTP. Ein Test prüft am Mock, dass nur lesende Befehle abgesetzt werden.
- **Ingest-Route statt Dienstkonto:** `POST /api/byl/ingest/items` und `GET /api/byl/ingest/connections` (nur Verbindungen vom Typ `mail`, ohne Geheimnisse), `POST /api/byl/ingest/connections/{id}/status` (Cursor, letzter Lauf, bereinigter Fehler). Die Route prüft `Authorization: Bearer <Token>` gegen `$os.getenv("BYL_INGEST_TOKEN")` in konstanter Zeit; ist die Variable leer, ist die Route aus (404). Der Token darf nur Einträge für aktive Mail-Verbindungen anlegen, und zwar für deren Besitzer. Ein eigenes Auth-Konto (Collection `service_accounts` mit Regeln) wäre möglich, bräuchte aber eine Kontoanlage, Passwortpflege, Token-Erneuerung und weitere Regeln auf mehreren Collections; der Token ist enger und einfacher.
- **Start und Stopp:** `byl-control.ps1 Start` startet nach PocketBase auch `byl-mail.exe`, wenn die Datei vorhanden ist; `Stop` beendet beide. Ohne Mail-Verbindung wartet der Prozess untätig und fragt alle 5 Minuten die Verbindungen neu ab. Protokoll nach `app/logs/byl-mail.log`, ohne Zugangsdaten und ohne Mailinhalte.
- **Build:** Quellcode unter `helpers/mail/` (TypeScript, strict), gebündelt mit esbuild, als SEA nach `app/byl-mail.exe` (gitignored wie `pocketbase.exe`) über `scripts/build-mail-helper.ps1`. Die CI baut und testet ihn mit.

## Alternativen

Siehe Tabelle in Abschnitt 4. Außerdem verworfen:

- **Eigener PocketBase-Build mit Go-IMAP:** widerspricht CLAUDE.md §3 (unveränderte Binary, kein Go-Build).
- **Webhooks (Telegram, WhatsApp Cloud API):** Der Server lauscht nur auf `127.0.0.1` und ist aus dem Internet nicht erreichbar. Verworfen zugunsten von Polling.
- **IMAP IDLE statt Polling:** schneller, aber eine dauerhaft offene Verbindung je Postfach mit Wiederverbindungslogik. Für Aufgaben aus Mails genügen 5 Minuten. Später möglich, weil `imapflow` IDLE kann.

## Konsequenzen

- ADR-0011 §2 wird für Google Calendar, WhatsApp (Export) und Telegram erfüllt; Notion bleibt zurückgestellt.
- Nach Annahme von Abschnitt 4: CLAUDE.md §3 bekommt „Node.js ist Dev-Werkzeug; zur Laufzeit nur eingebettet im optionalen `byl-mail.exe`“, §2 die Ordner `helpers/mail/` und die Datei `app/byl-mail.exe`, §10 die Kanalliste.
- Der Server stellt erstmals selbst Verbindungen ins Internet her (Kalender, Telegram) bzw. der Hilfsprozess (IMAP). Ohne Internet laufen die Kanäle mit Fehlerstatus an der Verbindung weiter; der Rest der App ist davon unberührt.
- Neue Abhängigkeiten nur im Hilfsprozess (`imapflow`, `postal-mime`, als Dev-Werkzeug `esbuild`, `postject`) und in der SPA (`postal-mime`).
