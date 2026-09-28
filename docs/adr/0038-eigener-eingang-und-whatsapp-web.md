# ADR-0038: Eigener Eingang mit Zugangsschlüssel und Browser-Erweiterung für WhatsApp Web

- **Status:** Angenommen. EI-1 (Eingang mit Zugangsschlüssel, Einstellungen, Hilfe) umgesetzt; EI-2 (Erweiterung) und EI-3 (Kanal-Karte, Assistent, Hilfe WhatsApp Web) folgen nach [docs/plan/eigener-eingang-whatsapp-web.md](../plan/eigener-eingang-whatsapp-web.md). Manuelle Browser-Prüfungen stehen im Test-Manifest.
- **Datum:** 2026-09-28
- **Entscheidung durch:** Nutzer (Variante „Browser-Erweiterung, die im offenen WhatsApp-Web-Tab nur liest“, 2026-09-28), Advisor (Produktentscheidungen: Umfang, Regeln, Sicherheitsrahmen, Teilpakete), Executor (Architektur und Einzelheiten)
- **Ergänzt:** [ADR-0016](0016-kanal-architektur-und-mail.md) §3 (WhatsApp; Nachtrag dort), [ADR-0020](0020-stichwoerter-pro-kanal.md) (Stichwörter je Kanal), [ADR-0014](0014-datenmodell-eingang.md) §3 (Duplikate)
- **Bezug:** [ADR-0011](0011-roadmap-e3-bis-e7.md) §2 (externe Kanäle nur mit ADR und Freigabe), [ADR-0018](0018-secrets.md) (Zugangsdaten), [ADR-0019](0019-kanal-filter-und-gruppierung.md) (Familien), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) (Karten, Assistent), [ADR-0028](0028-plattform-strategie.md) (Plattformen zurückgestellt), [ADR-0031](0031-herkunft-sichern.md) (Tombstones)

## Kontext

- Der Nutzer liest WhatsApp im Browser (WhatsApp Web) und will Nachrichten ohne Export und Import in den Eingang bringen. Bisher geht das nur über den offiziellen Chat-Export ([ADR-0016](0016-kanal-architektur-und-mail.md) §3) oder über Telegram.
- WhatsApp bietet für private Konten keine Schnittstelle, die lokal ohne Server im Internet funktioniert. Die Cloud API braucht ein Business-Konto und Webhooks; inoffizielle Protokoll-Bibliotheken verstoßen gegen die Nutzungsbedingungen.
- Ein allgemeiner Eingang für eigene Skripte (Kurzbefehle, Automationen auf dem Rechner) fehlte ebenfalls; die bestehende Ingest-Route gehört dem Mail-Hilfsprozess und ist an eine Umgebungsvariable und Mail-Verbindungen gebunden.

## Entscheidung

### 1. Eigener Eingang (API) mit Zugangsschlüssel

- **Routen** (`app/pb_hooks/inbox-keys.pb.js`, Logik in `lib/inbox-key-service.js`, reine Regeln in `lib/inbox-key-rules.js`):
  - `POST /api/byl/inbox/keys` (angemeldet, `users`): legt einen Schlüssel mit Namen an und antwortet **einmal** mit dem Schlüssel im Klartext.
  - `POST /api/byl/inbox/ingest`: ein Eintrag für den Eingang des Besitzers des Schlüssels, Anmeldung nur über `Authorization: Bearer <Schlüssel>`.
  - `GET /api/byl/inbox/ingest`: „Verbindung testen“; antwortet mit dem Namen des Schlüssels und der Zahl der Stichwörter je Kanal.
  - Liste und Widerruf laufen über die Record-API der Collection `inbox_keys` (Widerrufen = Löschen).
- **Schlüssel:** `byl_` und 40 Zeichen aus `A–Z a–z 0–9` (`$security.randomStringWithAlphabet`, rund 238 Bit). Gespeichert wird nur der SHA-256 (`token_hash`, eindeutiger Index) und der Anfang `token_hint` (`byl_` plus 4 Zeichen) zum Wiedererkennen. Ein Schlüssel ohne diese Form wird ohne Datenbankzugriff abgelehnt; die Suche geht über den Hash, deshalb gibt es keinen Zeichenvergleich, der über die Zeit etwas verrät. Höchstens 20 Schlüssel je Nutzer, Name 1 bis 60 Zeichen.
- **Collection `inbox_keys`** (Migration `1790202400_inbox_keys.js`): `name`, `token_hash` (Feld `hidden`: PocketBase liefert es nie aus, auch nicht dem Besitzer, und lässt keinen Filter darauf zu), `token_hint`, `last_used_at`, `owner` (Kaskade beim Löschen des Nutzers), `created`, `updated`. Regeln: list, view und delete nur `owner = @request.auth.id`; create und update `null` (nur die Route legt an, niemand ändert). Kein `household`: Ein Schlüssel gehört einer Person und legt nur private Einträge an.
- **Umfang eines Schlüssels:** Er legt ausschließlich Eingangseinträge seines Besitzers im privaten Bereich an, über denselben Weg wie jeder Kanal (`inbox-service.ingest`: Scope, Fingerprint, Zustand `new`). Er kann nichts lesen (die Antwort nennt nur ID und Zustand des Eintrags), nichts ändern, nichts löschen und meldet sich nirgends an.
- **Payload** (JSON, höchstens 512 KB): `channel` (`api` Standard, `whatsapp-web`), `mode` (`manual` | `auto`, Pflicht), `text` (Pflicht, reiner Text bis 100.000 Zeichen), `external_id` (Pflicht, bis 200 Zeichen, ohne Zeilenumbruch), `title` (bis 1.000, sonst die erste Zeile des Textes; gekürzt auf 200 wie überall), `url` (nur http und https, bis 2.000), `sender`, `chat` (je bis 200, als `source_meta.sender`/`chat`), `sent_at` (ISO 8601 mit Zeitzone, wird `source_date`, nie Fälligkeit). Unbekannte Felder werden ignoriert, Steuerzeichen in einzeiligen Feldern abgelehnt. Art des Eintrags: `todo` bei `api`, `message` bei `whatsapp-web`.
- **Antworten:** `201 created`, `200 duplicate` (mit Zustand des vorhandenen Eintrags), `422 filtered` (kein Stichwort bei `auto`, nichts gespeichert; wie `unmatched` der Mail-Ingest-Route), `400 invalid` mit deutschem Grund, `401` (fehlender, falscher oder widerrufener Schlüssel, ohne weitere Angabe), `403` (Anfrage aus einer Webseite), `429` mit `Retry-After`, `503` vor der Migration.
- **Duplikate und Tombstones:** Der Fingerprint ist `<channel>|<external_id>` ([ADR-0014](0014-datenmodell-eingang.md) §3, `lib/inbox-fingerprint.js`). Ein verworfener Eintrag bleibt als Tombstone mit Fingerprint stehen (auch nach der Bereinigung nach 30 Tagen), also kommt dieselbe `external_id` nie zurück. Derselbe Wert in einem anderen Kanal ist ein anderer Eintrag.
- **Stichwörter:** Wie bei jedem Kanal nimmt `auto` nur an, was ein Stichwort des Kanals trifft; `manual` kommt immer an, ein treffendes Stichwort steht dann trotzdem in `source_meta.keyword`. Gesucht wird in Titel und Text, mit derselben Logik (`lib/keywords.js`, ohne Groß- und Kleinschreibung und Umlaute, Wortanfang). Die Listen stehen in `users.import_keywords` unter `api` und `whatsapp-web` (neben den Datei-Importen; kein neues Feld), geprüft vom bestehenden Hook; gepflegt mit demselben Stichwort-Editor in einem Modal an der jeweiligen Karte.
- **Kanäle:** `inbox_items.channel` und `tickets.source` bekommen `api` und `whatsapp-web`. Familie ([ADR-0019](0019-kanal-filter-und-gruppierung.md)): `api` gehört zu „Manuell“ (eigene Eingaben), `whatsapp-web` zu „Chat“. Der Filter der erledigten Tickets nimmt dafür bis zu vier Kanäle je Familie. Der Kopie-Status ist „Nur Text“.
- **Rate-Limit:** 60 Anfragen je Schlüssel und Minute (festes Fenster in `$app.store()`, weg nach einem Neustart); `last_used_at` wird höchstens einmal je Minute geschrieben.
- **Rückweg der Migration:** Einträge und Tickets der neuen Kanäle behalten ihren Inhalt und bekommen den nächsten alten Kanal (`whatsapp-web` → `whatsapp`, `api` → `manual`), die Stichwortlisten der neuen Kanäle verlassen `users.import_keywords` (der alte Hook würde sie ablehnen), die Schlüssel verschwinden. Zahlen gehen ins Log.

### 2. CORS und Browser-Anfragen

- PocketBase läuft wie bisher ohne `--origins` (Standard `*`, [ADR-0035](0035-start-einstieg-und-offene-tabs.md) §4); es wird **nichts geöffnet**. Die Erweiterung ruft die API aus ihrem Service Worker auf; mit `host_permissions` für die App-Adresse gelten dort keine CORS-Beschränkungen (Manifest V3). Die Preflight-Anfrage beantwortet PocketBase ohnehin mit den angefragten Kopfzeilen (Integrationstest).
- Zusätzlich lehnt die Route jede Anfrage mit einem `Origin` ab, der weder fehlt (Skripte, curl, PowerShell) noch `chrome-extension://<32 Buchstaben a–p>` ist: Webseiten (auch `null` aus `file://`) bekommen 403. So kann ein in eine Seite geratener Schlüssel nicht aus dem Browser des Nutzers heraus benutzt werden, und DNS-Rebinding bringt nichts. Das ist bewusst enger als der Rest der App und braucht keine Einstellung.
- Die Adresse bleibt `127.0.0.1:8090`; der Server lauscht nur dort ([CLAUDE.md](../../CLAUDE.md) §3).

### 3. Browser-Erweiterung „becauseyoulovejira für WhatsApp Web“ (EI-2)

- **Grundsatz:** Die Erweiterung **liest nur** die Ansicht, die der Nutzer in seinem offenen WhatsApp-Web-Tab ohnehin sieht, und schickt Text an die lokale App. Sie sendet nie etwas in WhatsApp, klickt nie, verändert keine Nachricht und fügt dem DOM nur ihren eigenen Knopf hinzu. Keine inoffiziellen Protokoll-Bibliotheken, keine Automatisierung, kein externer Server, keine Telemetrie. Kein Store, kein Release: Sie wird aus dem Build-Ordner „entpackt“ geladen.
- **Manifest V3** für Chrome und Edge, Berechtigungen `storage`, Host `https://web.whatsapp.com/*` und die App-Adresse (Standard `http://127.0.0.1:8090`). Einstellbar sind nur Loopback-Adressen (`127.0.0.1`, `localhost`, `[::1]`); andere Hosts lehnt die Erweiterung ab, solange die Plattformen zurückgestellt sind ([ADR-0028](0028-plattform-strategie.md)).
- **Zugangsschlüssel** liegt in `chrome.storage.local` der Erweiterung und wird nur vom Service Worker benutzt; das Content-Script sieht ihn nie.
- **Manuell:** je Nachricht mit Text ein dezenter, per Tastatur erreichbarer Knopf „In den Eingang“ (`mode: manual`) mit Rückmeldung angelegt / schon im Eingang / Fehler.
- **Automatisch** (Schalter, standardmäßig aus, optional nur für genannte Chats): Nur Nachrichten, die nach dem Einschalten bzw. nach der zuletzt gesehenen Nachricht des Chats erscheinen, gehen mit `mode: auto` an die App; die Historie beim Laden nie. Der Server filtert per Stichwort. Grenze: WhatsApp Web zeigt nur den geöffneten Chat an, also erfasst die Erweiterung nur dessen Nachrichten, und nur solange der Tab offen ist.
- **Extraktion:** alle Selektoren in einem Modul, bevorzugt stabile Attribute (`data-id`, `data-pre-plain-text`, Rollen) statt CSS-Klassen. `external_id` ist ein SHA-256 über die Nachrichten-ID von WhatsApp (sie enthält Telefonnummern, die so nicht in der App landen). Nur Text; reine Medien und Sprachnachrichten bekommen keinen Knopf und werden nicht übernommen (ohne Text gäbe es nichts, woraus ein Ticket entstünde; Bildunterschriften zählen als Text). Erkennt die Erweiterung die Seitenstruktur nicht, meldet sie „Seitenstruktur nicht erkannt – Erweiterung braucht ein Update“ und tut nichts.
- **Tests** nur mit selbst gebauten, anonymisierten HTML-Fixtures; nie mit web.whatsapp.com, echten Konten, Nachrichten oder Nummern.

### 4. In der App (EI-3)

- Karte „WhatsApp Web (Browser-Erweiterung)“ unter **Einstellungen → Kanäle** mit Einrichtungsassistent (Stepper nach [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) §4): Schlüssel erzeugen → Erweiterung laden (Edge und Chrome, Pfad zum Build-Ordner) → Schlüssel eintragen → Verbindung testen; Stichwörter wie bei anderen Kanälen; Hilfe mit den ehrlichen Grenzen (inoffiziell, liest nur die eigene Ansicht, nur bei offenem Tab, kann nach WhatsApp-Updates eine Anpassung brauchen).

## Sicherheitsmodell

- **Geheimnis:** nur der Schlüssel; die App hält ihn nie im Klartext (SHA-256, Feld `hidden`), zeigt ihn genau einmal und schreibt ihn in kein Log. PocketBase protokolliert Anfragen ohne Kopfzeilen und Body; eigene Log-Zeilen des Eingangs nennen nie Schlüssel oder Inhalte.
- **Scope:** ein Schlüssel = „Einträge in den privaten Eingang eines Nutzers legen“; kein Lesen, kein Ändern, keine Anmeldung, kein Haushalt. Widerruf wirkt sofort (Löschen des Datensatzes).
- **Erreichbarkeit:** nur Loopback (Server auf `127.0.0.1`), Webseiten per `Origin` ausgeschlossen, 60 Anfragen je Minute und Schlüssel, Body höchstens 512 KB.
- **Erweiterung:** minimale Berechtigungen, Schlüssel nur im Service Worker, Adresse nur Loopback, keine Verbindung außer zur App.

## Datenschutz

- Übernommen wird nur, was der Nutzer ausdrücklich wählt („In den Eingang“) oder was bei eingeschaltetem Automatik-Schalter ein eigenes Stichwort trifft; alles andere verlässt den Browser nicht.
- Gespeichert werden Text, Absendername, Chatname, Zeitpunkt und ein Hash der Nachrichten-ID; keine Telefonnummern (soweit WhatsApp sie nicht selbst als Namen zeigt), keine Medien.
- Alles bleibt auf dem Rechner des Nutzers; es gibt keinen Dienst im Internet und keine Telemetrie.

## Alternativen

| Alternative | Bewertung |
|---|---|
| **Baileys / whatsapp-web.js als „verknüpftes Gerät“** | Inoffizielles Protokoll gegen die Nutzungsbedingungen von WhatsApp, reales Sperrrisiko für das private Konto; die Sitzung ist ein Vollzugriff (lesen und senden in allen Chats), der dauerhaft auf dem Rechner läge. Verworfen. |
| **Benachrichtigungen über Tasker/Android weiterleiten** | Braucht Android-Automatisierung und einen Weg vom Telefon zum Rechner (Netzwerk, Plattformen zurückgestellt); Benachrichtigungen sind gekürzt und gruppiert. Verworfen. |
| **Verschlüsseltes WhatsApp-Backup entschlüsseln** | Braucht den Schlüssel des Backups (Root oder Ende-zu-Ende-Passwort), Formate ändern sich, nur als Stapel und nicht zeitnah. Verworfen. |
| **Nachrichten an Telegram weiterleiten** | Bestehender Weg (Telegram-Bot, [ADR-0016](0016-kanal-architektur-und-mail.md) §2) ohne neue Technik, aber mit Handarbeit je Nachricht. Bleibt als Weg bestehen. |
| **Chat-Export** | Bleibt; gut für Stapel, aber manuell und nicht zeitnah. |
| **CORS global öffnen und aus dem Content-Script senden** | Würde jeder Webseite Anfragen an die App erlauben und den Schlüssel in den Kontext der Seite bringen. Verworfen zugunsten des Service Workers mit `host_permissions`. |
| **Den Token der Mail-Ingest-Route (`BYL_INGEST_TOKEN`) wiederverwenden** | Ein Token für alles, an Mail-Verbindungen gebunden, nur per Umgebungsvariable und Neustart zu ändern, nicht widerrufbar je Programm. Verworfen. |

## Konsequenzen

- Neue Collection, zwei neue Kanalwerte, eine Migration mit Rückweg; nach dem Update ist ein Neustart nötig (stop.bat, dann start.bat).
- Die Erweiterung hängt an der Seitenstruktur von WhatsApp Web; nach Updates von WhatsApp kann sie eine Anpassung der Selektoren brauchen. Sie meldet das selbst.
- CLAUDE.md §5 (Datenmodell, API-Regeln), §10 (Kanäle) und die README führen den Eingang und die Erweiterung.
