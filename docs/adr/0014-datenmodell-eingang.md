# ADR-0014: Datenmodell des Eingangs (`inbox_items`) mit Rückverweis am Ticket und Duplikaterkennung

- **Status:** Angenommen
- **Datum:** 2026-09-25
- **Entscheidung durch:** Nutzer (Leitidee Eingang → Ticket, 2026-09-25), Advisor (Datenmodell)
- **Ergänzt:** [ADR-0011](0011-roadmap-e3-bis-e7.md) (Quelle bzw. Kanal als Ticketmerkmal), [ADR-0012](0012-plain-ticketing.md) (keine Ticket-Typen)

## Kontext

Leitidee des Nutzers für E4: Jedes Workload-Objekt (To-do, Aufgabe, Mail, Termin, Nachricht, Projektaufgabe) landet zuerst in einem **Eingang**. Per Klick wird daraus ein einheitliches Ticket. Das Ticket behält einen Rückverweis auf das Original, und Duplikate werden erkannt.

Randbedingungen:

- Alle fachlichen Datensätze tragen `owner`, `household` und `scope` (CLAUDE.md §5). Regeln wie bei `tickets` ([E1-Plan](../plan/e1.md), Paket 4).
- Create und Update über die Record-API laufen nicht in einer Transaktion. Mehrere Schreibvorgänge öffnet der Hook über `inTransaction` (CLAUDE.md §3).
- Kanäle rufen dieselben Objekte wiederholt ab (Kalender-Feed, Postfach, Bot-Updates). Ein verworfenes Objekt darf beim nächsten Abruf nicht wieder erscheinen.
- Dieselbe Mail kann über zwei Wege kommen (`.eml`-Datei und Postfach), derselbe Termin über `.ics`-Datei und Google Calendar.
- Keine Datenmigration bestehender Tickets ([ADR-0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md)). Alles kommt als additive Migration.

## Entscheidung

### 1. Collection `inbox_items`

| Feld | Typ | Inhalt |
|---|---|---|
| `channel` | select, Pflicht | Eingangsweg: `manual` (Formular/Vorlage), `quick` (Schnellerfassung), `clipboard`, `link` (Bookmarklet), `eml` (Mail-Datei), `mail` (Postfach), `ics` (Kalenderdatei), `calendar` (Google Calendar), `whatsapp`, `telegram`, `notion`. Unveränderlich. |
| `kind` | select, Pflicht | Objektart: `todo`, `task`, `project_task`, `mail`, `event`, `message`, `link`. Steuert nur Vorbelegung und Symbol im Eingang. Das ist **kein** Ticket-Typ: Das Ticket kennt die Art nicht ([ADR-0012](0012-plain-ticketing.md)). |
| `title` | text, Pflicht, max. 200 | wie `tickets.title`; zu lange Betreffs werden beim Eingang gekürzt (mit „…“) |
| `body` | text, max. 100 000 | Klartext bzw. Markdown, wird wie jede Nutzereingabe sanitisiert angezeigt ([ADR-0008](0008-markdown-rendering-und-sanitizing.md)) |
| `source_url` | text, max. 2 000 | nur `http:`/`https:` (Hook prüft), etwa Web-Link oder Notion-Seite |
| `source_ref` | text, max. 500 | stabile Kennung beim Absender: Message-ID, `UID` (+ `RECURRENCE-ID`) eines Termins, Telegram `chat_id:message_id`, Notion-Page-ID |
| `source_date` | date | Zeitpunkt beim Absender (Mail-Datum, Terminbeginn, Nachrichtenzeit), UTC. **Wird nie automatisch zur Fälligkeit.** |
| `source_meta` | json, max. 20 000 Byte | kanalabhängige Zusatzangaben ohne eigene Spalte: Absender, Empfänger, Ort, Terminende, ganztägig, `RRULE` (für E5), Chatname |
| `original` | file, max. 1 Datei, 10 MB, `protected` | Originaldatei (`.eml`, `.ics`-Ausschnitt), nur mit File-Token abrufbar |
| `connection` | relation `connections`, optional | konfigurierte Verbindung, über die das Objekt kam (Postfach, Kalender, Bot; [ADR-0016](0016-kanal-architektur-und-mail.md)) |
| `fingerprint` | text, Pflicht (Hook) | Duplikatmerkmal, Abschnitt 3 |
| `state` | select, Pflicht | `new`, `converted`, `discarded` |
| `ticket` | relation `tickets`, optional, kein Cascade | Ticket, zu dem das Objekt wurde oder dem es zugeordnet ist |
| `handled_at` | date | Zeitpunkt von Umwandeln bzw. Verwerfen (Hook) |
| `owner`, `household`, `scope`, `created`, `updated` | wie `tickets` | Scope setzt der Hook |

Indizes: `UNIQUE (scope, fingerprint)`, `(owner, state)`, `(ticket)`.

API-Regeln wie `tickets` (list/view/update/delete: eigener Datensatz oder Haushaltsmitglied; create nur mit `owner = @request.auth.id`). Zusätzlich prüft der Hook beim Update:

- `channel`, `source_ref`, `source_date`, `fingerprint`, `connection`, `original` sind nach der Anlage unveränderlich.
- `state` darf nur `new ↔ discarded` wechseln. `new → converted` ist nur erlaubt, wenn gleichzeitig `ticket` auf ein Ticket im selben Scope zeigt („einem bestehenden Ticket zuordnen“, Abschnitt 4). Ein umgewandelter Eintrag ist endgültig.
- `handled_at` setzt der Hook, nicht der Client.

### 2. Rückverweis am Ticket

Neue Felder an `tickets`:

| Feld | Typ | Inhalt |
|---|---|---|
| `source` | select, optional | Wert von `inbox_items.channel` des Ursprungs. Leer = Ticket vor E4 bzw. direkt angelegt; zählt fachlich als „manuell“ ([ADR-0019](0019-kanal-filter-und-gruppierung.md)). |
| `source_item` | relation `inbox_items`, optional, kein Cascade | der Eingangseintrag, aus dem das Ticket entstand |

- Der Client sendet beim Anlegen nur `source_item`. Der Ticket-Hook prüft in der Transaktion der Anlage: Eintrag existiert, gleicher Scope, Zustand `new`. Dann setzt er `tickets.source` aus `channel` und am Eintrag `state = converted`, `ticket`, `handled_at`. Anlage, Key-Vergabe, Historie und Eintragswechsel sind damit atomar (ein Commit oder keiner). Ist der Eintrag schon umgewandelt oder verworfen: Fehler `validation_inbox_item_handled` („Dieser Eintrag wurde schon bearbeitet.“), kein Ticket.
- Direkt angelegte Tickets (Formular „Neues Ticket“, Schnellerfassung ohne Eingang) bekommen `source` vom Client (`manual`, `quick`), ohne `source_item`. Erlaubt sind dabei nur diese beiden Werte.
- `source` und `source_item` sind nach der Anlage unveränderlich (Hook, `validation_source_immutable`). Sie kommen deshalb nicht in die Historien-Whitelist.
- Wird ein Ticket gelöscht, leert PocketBase `inbox_items.ticket`; der Eintrag bleibt `converted` und hält damit sein Duplikatmerkmal. Wird ein Eintrag gelöscht, leert PocketBase `tickets.source_item`; `source` bleibt.

### 3. Duplikaterkennung in zwei Stufen

**Harte Stufe (Fingerprint, Datenbank):** Der Hook berechnet `fingerprint = sha256(<Schlüssel>)` (`$security.sha256`) aus einem kanalübergreifenden Schlüssel:

| Familie | Schlüssel | Wirkung |
|---|---|---|
| Mail (`eml`, `mail`) | `mail|` + Message-ID (klein, ohne `<>`); ohne Message-ID `mailx|` + Absender + Datum + Betreff | Dieselbe Mail als Datei und aus dem Postfach wird erkannt. |
| Termin (`ics`, `calendar`) | `event|` + `UID` + `|` + `RECURRENCE-ID` (leer für Serie bzw. Einzeltermin) | Gleicher Termin aus Datei und Feed wird erkannt. |
| `telegram` | `telegram|` + Chat-ID + `|` + Message-ID | |
| `whatsapp` | `whatsapp|` + Chatname + `|` + Zeitpunkt + `|` + Absender + `|` + Text (normalisiert) | Der Export hat keine IDs. |
| `link` | `link|` + normalisierte URL (Host klein, ohne Fragment, ohne `utm_*`) | |
| `notion` | `notion|` + Page-ID | |
| `manual`, `quick`, `clipboard` | `manual|` + neue Zufalls-ID | keine harte Sperre: Zweimal „Milch kaufen“ ist erlaubt |

- Die Schlüsselbildung ist ein reines ES5-Modul `app/pb_hooks/lib/inbox-fingerprint.js` (Hash-Funktion als Parameter, damit Vitest es mit `node:crypto` prüft).
- Der eindeutige Index `(scope, fingerprint)` ist das Sicherheitsnetz. Die Eingangswege prüfen vorher und melden ein Duplikat als eigenes Ergebnis („schon im Eingang“, „schon verworfen“, „schon Ticket HAUS-12“), nicht als Fehler. Beim Abruf von Kanälen zählen Duplikate nur mit.
- **Verworfen ist ein Tombstone:** Ein verworfener Eintrag bleibt als Datensatz bestehen und blockiert so jeden erneuten Eingang desselben Objekts. „Wiederherstellen“ setzt ihn auf `new`. Aufbewahrung (Antwort auf OF-E4-6 im [E4-Plan](../plan/e4.md), Paket 24): Ein täglicher Cron-Job (`byl-inbox-cleanup`, `lib/inbox-cleanup.js`) ersetzt bei Einträgen, die länger als 30 volle Berliner Tage verworfen sind, den Text durch einen Platzhalter, löscht die Originaldatei, kürzt den Titel auf 40 Zeichen und behält von `source_meta` nur `keyword`, `all_day` und `recurrence_id`. Fingerprint, Zustand, Kanal, Art, `source_ref`, `source_url`, `source_date`, `connection` und `handled_at` bleiben; der gespeicherte Fingerprint wird nie neu berechnet. So bleibt der Tombstone für alle Kanäle einschließlich `mail` wirksam, auch gegenüber der Postfach-Auswahl.

**Weiche Stufe (Hinweis, Client):** Die Eingangsansicht markiert einen Eintrag als „mögliches Duplikat“, wenn sein normalisierter Titel (getrimmt, klein, Leerraum zusammengefasst) einem offenen Ticket oder einem anderen neuen Eintrag gleicht. Aktionen: „Trotzdem umwandeln“, „Verwerfen“, „Dem Ticket zuordnen“. Die Prüfung läuft gegen die offenen Tickets im `TicketListStore` (reine Funktion, keine Serveranfrage).

### 4. Abläufe

- **Einzeln umwandeln:** Das Panel „Neues Ticket“ öffnet vorbefüllt (Titel, Beschreibung aus `body` mit Kopfzeilen je Kanal, Standardprojekt und -tags). Das Quelldatum steht als Hinweis daneben, mit Knopf „Als Fälligkeit übernehmen“. Speichern legt das Ticket mit `source_item` an (Abschnitt 2).
- **Gesammelt umwandeln:** Auswahl im Eingang, ein Dialog mit Standardwerten (Status, Priorität, Projekt, Tags). Die App legt die Tickets nacheinander an und meldet Teilfehler je Eintrag. Kein Batch-API: Es müsste per Migration eingeschaltet werden und bricht bei einem Fehler alles ab.
- **Verwerfen / Wiederherstellen:** Update `state`.
- **Einem bestehenden Ticket zuordnen:** Update `state = converted` mit `ticket = <id>` (Hook prüft Scope). Das Ticket selbst ändert sich nicht.

## Alternativen

- **Kein Eingang, Kanäle legen direkt Tickets an:** widerspricht der Leitidee. Unerwünschte Objekte müssten als Tickets gelöscht werden, und die Nummernkreise liefen voll. Verworfen.
- **Eingang als Ticket-Status (`status = inbox`):** vermischt Ungesichtetes mit Arbeit, bräuchte Keys für Müll und berührt jeden Filter, jede Kennzahl und die Standard-Reihenfolge. Verworfen.
- **Duplikaterkennung nur per Titelvergleich:** unzuverlässig (gleicher Betreff, andere Mail) und ohne Tombstone kämen verworfene Termine bei jedem Abruf zurück. Verworfen; der Titelvergleich bleibt als weiche Stufe.
- **Fingerprint im Client berechnen:** Kanäle im Server (Kalender, Bot) brauchen ihn ohnehin im Hook; zwei Implementierungen wären eine Fehlerquelle. Verworfen.
- **Ticket-Typ aus `kind` ableiten:** widerspricht [ADR-0012](0012-plain-ticketing.md). Verworfen.
- **Rohinhalt nur als Text statt Datei:** Eine `.eml` mit Anhängen oder fremdem Zeichensatz ließe sich nicht mehr originalgetreu öffnen. Verworfen; die Datei ist `protected` und nur für Berechtigte abrufbar.

## Konsequenzen

- Zwei additive Migrationen (neue Collection; zwei Felder an `tickets`). Bestehende Tickets bleiben unverändert (`source` leer).
- Der Ticket-Hook bekommt einen weiteren Schritt in der vorhandenen Transaktion. Tests: Umwandeln atomar (Fehler im Ticket ⇒ Eintrag bleibt `new`), doppeltes Umwandeln abgelehnt, fremder Scope abgelehnt.
- `inbox_items` braucht Negativtests für die Regeln mit mehreren Nutzern und Haushalten wie `rules.test.mjs`.
- Originaldateien vergrößern `pb_data` und die Backups. Grenze 10 MB je Datei; größere Mails kommen ohne Original (Hinweis im Eintrag).
- `TICKET_LIST_FIELDS` und das Realtime-Abo der Tickets bekommen `source` ([E3-Plan](../plan/e3.md) §10).

## Nachtrag (2026-09-27): Quellen, Lösen und Löschschutz

[ADR-0031](0031-herkunft-sichern.md) ergänzt §1, §2 und §4:

- Ein Ticket kann mehrere Quellen haben: alle Einträge mit `ticket = <id>`. `converted` gilt weiter für Umwandeln und Verknüpfen; die Hauptquelle folgt aus `tickets.source_item`.
- „Umgewandelt ist endgültig“ gilt nur noch für die Hauptquelle. Ein verknüpfter Eintrag lässt sich lösen (`converted` → `new` ohne Ticket).
- „Einem bestehenden Ticket zuordnen“ ändert das Ticket weiter nicht, schreibt aber einen Verlaufseintrag `source_link`.
- Anders als in §2 lässt sich ein Eintrag mit Ticket oder als Hauptquelle nicht mehr löschen. `tickets.source_item` wird deshalb nicht mehr über das Löschen des Eintrags geleert.
