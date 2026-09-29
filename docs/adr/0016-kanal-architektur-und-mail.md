# ADR-0016: Architektur der Kanäle: HTTP-Kanäle im Hook per Cron, Mail über einen Hilfsprozess

- **Status:** Angenommen (2026-09-25). Die HTTP-Kanäle (Abschnitt 2) galten mit der Kanalreihenfolge des Nutzers als freigegeben. Den Mail-Hilfsprozess (Abschnitt 4) hat der Nutzer am 2026-09-25 freigegeben (OF-E4-4), zusammen mit den Antworten auf OF-E4-5 und den Stichwörtern pro Kanal ([ADR-0020](0020-stichwoerter-pro-kanal.md)). Der Umfang der Mails (Abschnitt 5) und die Postfach-Auswahl (Abschnitt 6) folgen daraus. Proton läuft nur über `.eml` (Abschnitt 4).
- **Datum:** 2026-09-25
- **Entscheidung durch:** Nutzer (Kanalreihenfolge, WhatsApp nur als Export, `byl-mail.exe`, Proton nur manuell, Gmail mit App-Passwort, Web.de-IMAP, 2026-09-25), Advisor (Architektur)
- **Ergänzt:** [ADR-0011](0011-roadmap-e3-bis-e7.md) §2 (externe Dienste nur mit eigener ADR und Freigabe)
- **Ergänzt durch:** [ADR-0020](0020-stichwoerter-pro-kanal.md) (Stichwörter pro Kanal: was automatisch in den Eingang kommt)

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
| **Im Hilfsprozess** (IMAP) | Web.de, Gmail | `byl-mail.exe` (Abschnitt 4), schreibt über eine Ingest-Route in den Eingang |

Proton Mail hat keinen automatischen Weg (Abschnitt 4) und kommt nur als `.eml` im Browser.

Was die automatischen Wege (Hook und Hilfsprozess) übernehmen, entscheiden die Stichwörter der Verbindung ([ADR-0020](0020-stichwoerter-pro-kanal.md)).

Alle drei Arten erzeugen Einträge über **denselben** Dienst `app/pb_hooks/lib/inbox-service.js` (Validierung, Kürzen, Fingerprint, Duplikat-Ergebnis). So gelten dieselben Grenzen und dieselbe Duplikaterkennung für jeden Weg ([ADR-0014](0014-datenmodell-eingang.md)).

### 2. HTTP-Kanäle im Hook

- **Konfiguration:** Collection `connections` mit `type` (`calendar`, `telegram`, `notion`, `mail`), `label`, `enabled`, `secret_env` (Name der Umgebungsvariablen, nie ihr Wert; [ADR-0018](0018-secrets.md)), `settings` (json, ohne Geheimnisse: etwa Chat-IDs der Allowlist, Tage im Voraus, IMAP-Host und Benutzer), `cursor` (Telegram-Offset, IMAP-`UIDVALIDITY:UID`), `last_run_at`, `last_ok_at`, `last_error` (bereinigt, ohne Geheimnisse), `running_since`, dazu `owner`/`household`/`scope`. Regeln wie `tickets`; `cursor`, `last_*` und `running_since` schreibt nur der Server (Hook-Guard lehnt Client-Änderungen ab).
- **Cron:** ein Job je Kanalart (`byl-calendar` alle 15 Minuten, `byl-telegram` jede Minute, `byl-notion` alle 15 Minuten), der alle aktiven Verbindungen dieser Art abarbeitet. Eine Laufsperre über `running_since` (mit Ablauf nach 10 Minuten) verhindert überlappende Läufe. Ein Knopf „Jetzt abrufen“ ruft dieselbe Funktion über eine Route auf (nur für den Besitzer).
- **Grenzen:** `timeout` 30 s je Anfrage; Antworten über 20 MB werden verworfen (Fehler an der Verbindung); höchstens 500 neue Einträge je Lauf und Verbindung.
- **Google Calendar:** Abruf der geheimen iCal-Adresse; Parser gemeinsam mit `.ics`. Nur Termine im Fenster gestern bis heute + N Tage (Standard 30) werden zu Einträgen; Serien einmal als Serie (mit `RRULE` in `source_meta` für E5). Kein Sync zurück, keine Aktualisierung bereits umgewandelter Einträge.
- **Telegram:** eigener Bot; `getUpdates` mit `offset = cursor + 1`, `timeout = 0`, `allowed_updates = ["message"]`. Nur Chats aus der Allowlist (`settings.chat_ids`) werden übernommen; andere Chats werden nicht gespeichert, nur ihre Chat-ID erscheint einmalig als Einrichtungshinweis. Nach dem Speichern sendet der Bot eine Bestätigung („Im Eingang: <Titel>“), weil Telegram nicht abgeholte Updates höchstens 24 Stunden bereithält: Fehlt die Bestätigung, weiß der Nutzer, dass die Nachricht nicht angekommen ist. Der Offset rückt erst nach erfolgreichem Speichern vor.
- **Notion (zurückgestellt):** interne Integration mit Leserecht, `data_sources/{id}/query` mit Filter auf `last_edited_time` > Cursor, Polling alle 15 Minuten. Umsetzung erst nach Freigabe.

**Nachtrag (Nutzerentscheidung 2026-09-29, [ADR-0041](0041-notion-listen-uebernehmen.md)): Notion nur als Import auf Anstoß.** Der Absatz „Notion (zurückgestellt)“ und der Job `byl-notion` unter „Cron“ gelten nicht mehr. Notion ist kein laufender Kanal, sondern dient dazu, **bestehende Listen einmal als Kopien** in den Eingang zu übernehmen: nur lesend (interne Integration mit „Read content“, `Notion-Version` 2026-03-11, nur lesende Endpunkte), nur auf Anstoß im Import-Dialog bzw. mit „Erneut abrufen“, ohne Cron, ohne Webhooks, ohne Rückmeldung und ohne Abgleich in zwei Richtungen. Der Weg läuft trotzdem wie die anderen HTTP-Kanäle im Hook (`app/pb_hooks/notion.pb.js`, `$http.send`, Token aus `BYL_NOTION_TOKEN` im Moment der Anfrage, bereinigte Fehler, Einträge über `inbox-service.ingest` mit dem Fingerprint `notion|<ID>`), aber über eigene Routen statt `runConnection`: `POST /api/byl/connections/{id}/run` antwortet für Notion `unsupported`, und „Alle Kanäle jetzt abrufen“ lässt Notion aus. Datenbanken werden seit `2025-09-03` über ihre Datenquellen gelesen (`GET /v1/data_sources/{id}`, `POST /v1/data_sources/{id}/query`), wie hier schon vorgesehen, nur ohne Cursor.

### 3. WhatsApp

Nur der offizielle Chat-Export (`.txt` bzw. `.zip` mit `_chat.txt`) als Datei-Import im Browser, mit Auswahlansicht. Die WhatsApp Cloud API (Webhooks, lokal nicht erreichbar) und inoffizielle Bibliotheken (Sperrrisiko für das Konto) sind abgelehnt. Ein Share Target kommt frühestens mit E7 (PWA, HTTPS über Tailscale).

**Nachtrag (Nutzerentscheidung 2026-09-28, [ADR-0038](0038-eigener-eingang-und-whatsapp-web.md)): WhatsApp Web über eine Browser-Erweiterung.** Neben dem Export gibt es die Erweiterung „becauseyoulovejira für WhatsApp Web“ (Manifest V3, Edge und Chrome, entpackt aus `app/erweiterung-whatsapp-web` geladen). Sie liest nur die Ansicht im offenen WhatsApp-Web-Tab und schickt Text einzelner Nachrichten („In den Eingang“) oder, mit eingeschaltetem Schalter, neue Nachrichten mit Stichwort über den eigenen Eingang mit Zugangsschlüssel an die App (Kanal `whatsapp-web`, Familie „Chat“). Die Ablehnung inoffizieller Protokoll-Bibliotheken (Baileys, whatsapp-web.js als verknüpftes Gerät) bleibt: Die Erweiterung meldet sich nicht bei WhatsApp an, sendet, klickt und ändert nichts, und es gibt keinen Server im Internet. Grenzen: nur bei offenem Tab, automatisch nur im geöffneten Chat, nach Änderungen der Seite von WhatsApp kann sie eine Anpassung brauchen (sie meldet „Seitenstruktur nicht erkannt“).

**Nachtrag (Nutzerentscheidung 2026-09-29): WhatsApp Desktop verworfen, „Teilen mit“ aus der APK geplant.** Eine Anbindung von WhatsApp Desktop unter Windows (Benachrichtigungen mitlesen per `UserNotificationListener` bzw. lokaler Benachrichtigungsdatenbank, UI-Automation der App, Auslesen ihrer verschlüsselten Datenbank) ist verworfen ([ADR-0038](0038-eigener-eingang-und-whatsapp-web.md), Nachtrag vom 2026-09-29). Das Share Target aus dem Absatz oben kommt als verbindliche Anforderung „Teilen mit“ in die Android-APK (S2b, [ADR-0028](0028-plattform-strategie.md), Nachtrag vom 2026-09-29) über den eigenen Eingang; das `share_target` der Web-App bleibt Vorstufe bzw. Alternative. Der Plattform-Ausbau bleibt zurückgestellt.

### 4. Mail: Optionen und Entscheidung

| Option | Portabilität | Sicherheit | Aufwand und Wartung |
|---|---|---|---|
| **(a) Node-Hilfsprozess** mit `imapflow` und `postal-mime`, als SEA-Programm `app/byl-mail.exe`, gestartet und gestoppt von `byl-control.ps1` | Kein installiertes Node nötig; ein zusätzliches `.exe` im Ordner (80–100 MB). Kopie von `app/` bleibt lauffähig (Zugangsdaten müssen auf dem neuen Rechner neu gesetzt werden). | Nur-Lese-Zugriff technisch erzwungen (`EXAMINE`), keine Flag-Änderung, kein Löschen, kein Versand. Zugangsdaten nur aus Umgebungsvariablen. Schreibt nur über eine eng begrenzte Ingest-Route. | Mittel: Build-Skript (esbuild, SEA), Tests mit Vitest wie der Rest. Updates von `imapflow`/`postal-mime` über Dependabot. Unsigniertes `.exe` kann eine SmartScreen- oder Virenscanner-Rückfrage auslösen. |
| **(b) REST-APIs statt IMAP** | ohne Hilfsprozess im Hook möglich | OAuth mit eigenem Google-Cloud-Projekt; Refresh-Token als Geheimnis | Nur für Gmail vorhanden. Web.de und Proton haben keine Mail-API. Für Gmail: eingeschränkte Scopes, 7-Tage-Tokens im Status „Testing“ oder Prüfverfahren von Google. Für eine private App unverhältnismäßig. |
| **(c) nur `.eml` per Drag & Drop** | ideal, nichts Zusätzliches | keine Zugangsdaten | gering; aber jede Mail muss von Hand exportiert werden (Web.de und Gmail im Browser umständlich, Proton über „Export“ bzw. Bridge) |
| (d) PowerShell mit MailKit-DLLs | ohne Node, kleine DLLs | wie (a) | MailKit bringt unter .NET Framework 4.8 mehrere abhängige DLLs mit, die gepinnt und geprüft werden müssen; Tests außerhalb von Vitest; zweiter MIME-Parser neben dem der SPA. Verworfen. |
| (e) Hilfsprozess von PocketBase per `$os.cmd` starten | wie (a) | wie (a) | Wird PocketBase hart beendet (`Stop-Process -Force`), bleibt der Kindprozess unter Windows zurück. `byl-control.ps1` verwaltet Prozesse schon. Verworfen. |

**Entscheidung: (a) mit (c) als immer verfügbarer Grundlage** (vom Nutzer am 2026-09-25 freigegeben, OF-E4-4). `.eml` per Drag & Drop kommt vor der Postfachanbindung und bleibt der Weg ohne Zugangsdaten. (b) wird für Gmail nicht umgesetzt; neu bewerten, falls Google App-Passwörter für private Konten abschafft.

Festlegung pro Anbieter (Antworten des Nutzers auf OF-E4-5):

- **Web.de:** IMAP über (a) ist der einzige automatische Weg. Der Nutzer schaltet „POP3/IMAP-Abruf“ ein; bei 2FA braucht es ein anwendungsspezifisches Passwort. Risiko: automatische Abschaltung bei längerer Nichtnutzung; der Hilfsprozess meldet Anmeldefehler an der Verbindung mit Hinweis auf die Einstellung.
- **Proton:** Der Nutzer hat den Free-Tarif, also keine Bridge und keinen automatischen Abruf. Proton läuft **nur über (c)**: Mail als `.eml` speichern und hereinziehen (Anleitung in der README). Ein Bridge-Anschluss (lokaler IMAP-Server mit gepinntem Zertifikat) wird nicht gebaut; neu bewerten, falls der Tarif wechselt.
- **Gmail:** (a) mit App-Passwort (Bestätigung in zwei Schritten ist beim Nutzer vermutlich aktiv). Die Gmail-API (b) scheitert praktisch an den eingeschränkten Scopes und den 7-Tage-Tokens. Ist ein App-Passwort nicht möglich (Erweiterter Schutz), bleibt (c).

### 5. Der Hilfsprozess im Detail

- **Ablauf:** alle 5 Minuten je Postfach: verbinden (TLS), den Posteingang (`INBOX`) **nur lesend** öffnen, die Mails nach dem Cursor holen, mit `postal-mime` parsen, über die gemeinsame Normalisierung ([ADR-0017](0017-parser-ics-eml.md)) in einen Entwurf umwandeln, mit den Stichwörtern der Verbindung abgleichen ([ADR-0020](0020-stichwoerter-pro-kanal.md)) und nur Treffer an die Ingest-Route senden, abmelden. Duplikate prüft der Server über den Fingerprint (Message-ID); ein erneuter Abruf ist deshalb folgenlos.
- **Umfang (ersetzt OF-E4-2):** Posteingang, ab der Einrichtung, nur Treffer. Der erste Lauf einer Verbindung setzt den Cursor auf `UIDVALIDITY:<höchste UID>` und übernimmt nichts Älteres. Danach rückt der Cursor über jede geprüfte Mail vor, auch ohne Treffer; eine Mail ohne Treffer wird nicht gespeichert. Ändert sich `UIDVALIDITY`, beginnt der Cursor neu bei der höchsten UID (keine Flut alter Mails), und die Verbindung meldet das als Hinweis. Ältere Mails holt nur die Postfach-Auswahl (Abschnitt 6).
- **Kein Schreibzugriff aufs Postfach:** kein `SELECT`, kein `STORE`, kein `EXPUNGE`, kein `APPEND`, kein SMTP. Ein Test prüft am Mock, dass nur lesende Befehle abgesetzt werden.
- **Ingest-Route statt Dienstkonto:** `POST /api/byl/ingest/items` (Feld `origin`: `auto` für den Abruf, dann prüft die Route den Treffer mit `keywords.js` nach und lehnt Nichttreffer ab; `selected` für die Postfach-Auswahl, ohne Stichwortpflicht) und `GET /api/byl/ingest/connections` (nur Verbindungen vom Typ `mail`, ohne Geheimnisse), `POST /api/byl/ingest/connections/{id}/status` (Cursor, letzter Lauf, bereinigter Fehler). Die Route prüft `Authorization: Bearer <Token>` gegen `$os.getenv("BYL_INGEST_TOKEN")` in konstanter Zeit; ist die Variable leer, ist die Route aus (404). Der Token darf nur Einträge für aktive Mail-Verbindungen anlegen, und zwar für deren Besitzer. Ein eigenes Auth-Konto (Collection `service_accounts` mit Regeln) wäre möglich, bräuchte aber eine Kontoanlage, Passwortpflege, Token-Erneuerung und weitere Regeln auf mehreren Collections; der Token ist enger und einfacher.
- **Start und Stopp:** `byl-control.ps1 Start` startet nach PocketBase auch `byl-mail.exe`, wenn die Datei vorhanden ist; `Stop` beendet beide. Ohne Mail-Verbindung wartet der Prozess untätig und fragt alle 5 Minuten die Verbindungen neu ab. Protokoll nach `app/logs/byl-mail.log`, ohne Zugangsdaten und ohne Mailinhalte.
- **Build:** Quellcode unter `helpers/mail/` (TypeScript, strict), gebündelt mit esbuild, als SEA nach `app/byl-mail.exe` (gitignored wie `pocketbase.exe`) über `scripts/build-mail-helper.ps1`. Die CI baut und testet ihn mit.
- **Nachtrag (Umsetzung, 2026-09-25, E4-Plan Pakete 11 und 13):**
  - **Test-IMAP-Server statt Mock:** Statt eines Mocks von `imapflow` prüfen die Tests die echte Bibliothek gegen einen kleinen IMAP-Server nur für Tests (`helpers/mail/test/fake-imap.ts`, nur `127.0.0.1`, ohne TLS). Er protokolliert jeden Befehl (bei `LOGIN` ohne Passwort) und lehnt schreibende Befehle ab. `\Seen` setzt er nur bei `BODY[]` ohne `PEEK` in einem beschreibbar geöffneten Ordner. So belegt er, dass kein `SELECT`, `STORE`, `EXPUNGE`, `APPEND` oder `MOVE` abgesetzt wird und die Flags unverändert bleiben. `refuseLogin` und `loginRefusal` bilden abgelehnte Anmeldungen nach, auch Gmails Antwort auf ein normales Kontopasswort. Der Hilfsprozess erreicht ihn nur über die Testvariable `BYL_MAIL_TEST_IMAP_PORT` (Klartext ausschließlich auf `127.0.0.1`).
  - **Start nur bei Mail-Verbindung:** Abweichend von „Start und Stopp“ oben startet `start.bat` den Hilfsprozess nur, wenn alle vier Bedingungen gelten: `byl-mail.exe` liegt vor, `BYL_INGEST_TOKEN` ist gesetzt (das legt `start.bat` beim ersten Mal an), kein eigener Helfer läuft, und PocketBase meldet über die Ingest-Route mindestens eine eingeschaltete Mail-Verbindung. Ohne Mail-Verbindung läuft also kein untätiger Prozess. Eine später angelegte Verbindung braucht einen Neustart (`stop.bat`, `start.bat`), und die Anleitungen sagen das. Ist die Zahl nicht zu ermitteln (Zeitüberschreitung), startet er trotzdem.
  - **Anbieter:** `webde` (`imap.web.de:993`) und `gmail` (`imap.gmail.com:993`, App-Passwort), jeweils mit TLS und eigenem Hinweis nach abgelehnter Anmeldung.

### 6. Postfach-Auswahl: der Hook fragt den Hilfsprozess über eine lokale HTTP-Schnittstelle

Der Nutzer kann die letzten N Mails des Posteingangs einer Verbindung auflisten (Standard 50, höchstens 200) und einzelne davon übernehmen, auch ohne Stichwort und auch aus der Zeit vor der Einrichtung. Das ist der einzige rückwirkende Weg ([ADR-0020](0020-stichwoerter-pro-kanal.md) §4). Die SPA braucht dafür eine Antwort vom Hilfsprozess, der allein das Postfach erreicht.

| Option | Bewertung |
|---|---|
| **(A) Anfrage-Collection** (`mail_requests`), die der Hilfsprozess abarbeitet | Der Hilfsprozess müsste die Collection alle paar Sekunden abfragen (Last und Verzögerung) oder ein Realtime-Abo mit eigener Anmeldung halten, die er heute nicht hat. Die Liste mit Betreffs und Absendern läge in `pb_data` und damit in jedem Backup. Dazu kommen Migration, Regeln, Negativtests und ein asynchroner Ablauf mit Zuständen in der Oberfläche. |
| **(B) Browser spricht den Hilfsprozess direkt an** (`http://127.0.0.1:<Port>`) | Der Browser bräuchte den Token oder eine eigene Anmeldung am Hilfsprozess, die Seite hätte einen zweiten Ursprung (CORS), und jede andere Webseite im Browser könnte den Port ansprechen. Verworfen. |
| **(C) Der Hook reicht die Anfrage durch** an eine lokale HTTP-Schnittstelle des Hilfsprozesses, nur auf `127.0.0.1`, mit Token | Die SPA spricht wie immer nur PocketBase an (Anmeldung, Sichtbarkeit der Verbindung wie „Jetzt abrufen“). Der Token bleibt zwischen den beiden Prozessen, die ihn ohnehin kennen. Synchron, ohne neues Schema, und nichts von der Liste wird gespeichert. |

**Entscheidung: (C).**

- **Hilfsprozess:** hört auf `127.0.0.1` (nie auf anderen Adressen), Port `8091` oder aus `BYL_MAIL_HELPER_PORT`, nur solange `BYL_INGEST_TOKEN` gesetzt ist. Jede Anfrage braucht `Authorization: Bearer <BYL_INGEST_TOKEN>` (Vergleich in konstanter Zeit), sonst 401. Endpunkte:
  - `POST /mailbox/list` mit `{ connection, limit }`: je Mail UID, Datum, Absender, Betreff, Message-ID, Größe und das greifende Stichwort. Nur Kopfdaten (`ENVELOPE`), der Ordner nur lesend.
  - `POST /mailbox/import` mit `{ connection, uids }` (höchstens 50): holt die Quelltexte, parst sie und sendet sie mit `origin: selected` an die Ingest-Route. Antwort: neu, schon vorhanden, Fehler je UID.

  Die Zugangsdaten der Verbindung holt der Hilfsprozess wie beim Abruf über die Ingest-Route. Die Schnittstelle nimmt keine Zugangsdaten und keine Hostnamen von außen an, nur die ID einer aktiven Mail-Verbindung.
- **Hook:** Routen `GET /api/byl/connections/{id}/mailbox?limit=` und `POST /api/byl/connections/{id}/mailbox/import`. Beide verlangen Anmeldung und Sichtbarkeit der Verbindung (sonst 404), Art `mail`, eingeschaltet. Sie senden mit `$http.send` an den Hilfsprozess (Timeout 60 s). Die Liste ergänzt der Hook je Mail um den Zustand im Eingang über den Fingerprint (neu, verworfen, umgewandelt), damit die Oberfläche „schon im Eingang“ zeigt. Läuft der Hilfsprozess nicht, antwortet die Route mit 503 und „Der Mail-Hilfsprozess läuft nicht (byl-mail.exe fehlt oder ist beendet).“.
- **Oberfläche:** „Aus dem Postfach wählen“ an der Verbindung öffnet eine Auswahlansicht nach dem Muster des WhatsApp-Imports. Treffer sind vorausgewählt, Mails, die schon im Eingang sind, sind gesperrt.
- **Nachtrag (Umsetzung, 2026-09-25, E4-Plan Paket 23):**
  - **Header statt `ENVELOPE`:** Die Liste liest je Mail `BODY.PEEK[HEADER]` und parst den Kopf mit postal-mime und derselben Normalisierung wie der Import (`mailToDraft`). So ergeben Betreff, Absender, Datum und Message-ID dasselbe Duplikatmerkmal wie beim späteren Import. `ENVELOPE` hätte eigene Dekodierungsregeln und bei fehlender Message-ID ein anderes Merkmal.
  - Die „letzten N“ sind die letzten N nach Position im Posteingang (`FETCH n:*`), neueste zuerst.
  - Das Stichwort der Liste sucht nur im Betreff, auch mit `match_body`. Für den Textanfang müsste jede Mail ganz geladen werden. Seit dem Nachtrag zu [ADR-0020](0020-stichwoerter-pro-kanal.md) (2026-09-27) sucht es zusätzlich im Absender aus dem Kopf.
  - Verworfene Einträge bleiben auch nach der Bereinigung nach 30 Tagen gesperrt ([ADR-0014](0014-datenmodell-eingang.md) §3).
- **Nachtrag (Testfeedback Paket A, Punkt 4, 2026-09-27): „Jetzt abrufen“ auch für Postfächer und eine ehrliche Probe.** Der Nutzer wollte nicht bis zu 5 Minuten warten und nicht raten, ob der Hilfsprozess läuft. Dieselbe Schnittstelle (C) bekommt zwei Endpunkte, ebenfalls nur auf `127.0.0.1` mit Token:
  - `POST /poll` mit `{ connection }`: führt sofort den regulären Abruf dieser einen Verbindung aus (derselbe Code und derselbe Cursor wie der 5-Minuten-Lauf, Ergebnis per Status-Route an PocketBase) und antwortet mit den Zahlen (`created`, `duplicates`, `unmatched`, `skipped`, `failed`), `error` bzw. `missing`. Beide Wege teilen eine Sperre (`PollGate`): Der 5-Minuten-Lauf wartet auf einen laufenden manuellen Abruf; ein manueller Abruf wartet nicht, sondern antwortet sofort 409 `running`. Die Verbindung wird erst innerhalb der Sperre gelesen, damit der Cursor eines eben beendeten Laufs gilt.
  - `GET /health`: `{ ok, version, busy }` ohne Anmeldung an einem Postfach.
  - **Hook:** Die bestehende Route `POST /api/byl/connections/{id}/run` leitet Verbindungen der Art `mail` an `/poll` weiter (Timeout 90 s) und antwortet im Format von `runConnection`; neu ist der Zustand `unavailable` (Hilfsprozess läuft nicht, neutraler Hinweis). Eine Zeitüberschreitung ist ein Fehler mit dem Hinweis, dass der Abruf im Hilfsprozess weiterläuft. `GET /api/byl/mail-helper` (angemeldet) fragt `/health` mit 3 s Timeout und liefert `state` `running`, `stopped` oder `refused` (anderer Token) mit Version. Eine eigene Laufsperre über `running_since` braucht es für Postfächer nicht; die Sperre liegt im Hilfsprozess, der allein das Postfach erreicht.
  - **Oberfläche:** jede eingerichtete Karte hat „Jetzt abrufen“, Postfächer zusätzlich „Aus dem Postfach wählen“ und die Zeile „Hilfsprozess“.
- **Nachtrag (Nutzerentscheidung 2026-09-27): der gesamte Posteingang.** Der Umfang aus §5 („ab der Einrichtung, … übernimmt nichts Älteres“) gilt nicht mehr. Der Hilfsprozess durchsucht den gesamten Posteingang, beim ersten Abruf, nach jeder Änderung der Stichwörter oder von `match_body`, nach einer neuen `UIDVALIDITY` und auf Knopfdruck, in Blöcken mit Fortschritt, abbrechbar, mit höchstens 200 neuen Einträgen je Lauf. Er öffnet weiter nur `INBOX` mit `EXAMINE` und setzt zusätzlich nur `UID SEARCH` und `BODY.PEEK[HEADER.FIELDS (…)]` ab; `STORE`, `COPY`, `MOVE` und `EXPUNGE` bleiben ausgeschlossen, der Test-IMAP-Server belegt das. Die Postfach-Auswahl (§6) bleibt der Weg für Mails ohne Stichwort; ihre Vorauswahl prüft mit `match_body` auch Kopfzeilen und Text (über die Suche des Servers). Hilfsprozess-Endpunkt `POST /scan`, Hook-Route `POST /api/byl/connections/{id}/scan`, Feld `connections.scan`, `byl-mail.exe` 0.7.0. Einzelheiten, Suche auf dem Server, Rückfall und Grenzen: [ADR-0020](0020-stichwoerter-pro-kanal.md), Nachtrag 3. In der Eingangsansicht ruft „Alle Kanäle jetzt abrufen“ alle eingeschalteten Verbindungen nacheinander über dieselbe Route ab. `byl-mail.exe` 0.5.0. Ein älterer, noch laufender Hilfsprozess kennt `/poll` und `/health` nicht und antwortet 404 „Nicht gefunden.“; daran erkennt der Hook ihn (`state` `outdated`, „Jetzt abrufen“ mit dem Hinweis auf `stop.bat`, dann `start.bat`), statt „pausiert“ oder „läuft nicht“ zu melden.
- **Nachtrag (2026-09-27): Mails über 10 MB.** Nach [ADR-0031](0031-herkunft-sichern.md) §4 überspringt der Hilfsprozess keine Mail mehr wegen ihrer Größe. Von einer Mail über 10 MB liest er nur die ersten 2 MB (`BODY.PEEK[]<0.2097152>`), sonst nur den Kopf (`BODY.PEEK[HEADER]`), und sendet sie ohne Originaldatei mit `source_meta.original_omitted` und `original_size`. Das gilt für Abruf, Vollsuche und Postfach-Auswahl (dort liest er zuerst die Größe über `RFC822.SIZE`). Es bleibt bei `EXAMINE` und `PEEK`. `byl-mail.exe` 0.8.0.
- **Nachtrag (2026-09-28): Grenze 25 MB.** Nach dem Nachtrag D zu [ADR-0031](0031-herkunft-sichern.md) liegt die Grenze bei 25 MB statt 10 MB (`MAIL_MAX_BYTES`); Mails bis 25 MB kommen samt Datei, die Grenzen von imapflow folgen der Konstante. `byl-mail.exe` 0.9.0.

## Alternativen

Siehe Tabelle in Abschnitt 4. Außerdem verworfen:

- **Eigener PocketBase-Build mit Go-IMAP:** widerspricht CLAUDE.md §3 (unveränderte Binary, kein Go-Build).
- **Webhooks (Telegram, WhatsApp Cloud API):** Der Server lauscht nur auf `127.0.0.1` und ist aus dem Internet nicht erreichbar. Verworfen zugunsten von Polling.
- **IMAP IDLE statt Polling:** schneller, aber eine dauerhaft offene Verbindung je Postfach mit Wiederverbindungslogik. Für Aufgaben aus Mails genügen 5 Minuten. Später möglich, weil `imapflow` IDLE kann.

## Konsequenzen

- ADR-0011 §2 wird für Google Calendar, WhatsApp (Export) und Telegram erfüllt; Notion bleibt zurückgestellt.
- Abschnitt 4 ist angenommen. CLAUDE.md ändert sich mit dem ersten Code des Hilfsprozesses (Paket 11 im E4-Plan), nicht vorher: §3 bekommt „Node.js ist Dev-Werkzeug; zur Laufzeit nur eingebettet im optionalen `byl-mail.exe`“, §2 die Ordner `helpers/mail/` und die Datei `app/byl-mail.exe`, §10 die Kanalliste.
- Der Server stellt erstmals selbst Verbindungen ins Internet her (Kalender, Telegram) bzw. der Hilfsprozess (IMAP). Ohne Internet laufen die Kanäle mit Fehlerstatus an der Verbindung weiter; der Rest der App ist davon unberührt.
- Proton braucht keinen Code im Hilfsprozess; der Weg über `.eml` bekommt eine Anleitung in der README.
- Der Hilfsprozess öffnet einen lokalen Port (nur `127.0.0.1`, mit Token) für die Postfach-Auswahl. Ist der Port belegt, meldet der Hilfsprozess das im Protokoll und die Route mit 503; der Abruf läuft davon unabhängig weiter.
- Neue Abhängigkeiten nur im Hilfsprozess (`imapflow`, `postal-mime`, als Dev-Werkzeug `esbuild`, `postject`) und in der SPA (`postal-mime`).
