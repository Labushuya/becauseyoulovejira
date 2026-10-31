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
| `original` | file, max. 1 Datei, 10 MB (seit Migration `1790202000` 25 MB), `protected` | Originaldatei (`.eml`, `.ics`-Ausschnitt), nur mit File-Token abrufbar |
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
- Originaldateien vergrößern `pb_data` und die Backups. Grenze 10 MB je Datei (seit dem Nachtrag D zu [ADR-0031](0031-herkunft-sichern.md) 25 MB); größere Mails kommen ohne Original (Hinweis im Eintrag).
- `TICKET_LIST_FIELDS` und das Realtime-Abo der Tickets bekommen `source` ([E3-Plan](../plan/e3.md) §10).

## Nachtrag (2026-09-27): Quellen, Lösen und Löschschutz

[ADR-0031](0031-herkunft-sichern.md) ergänzt §1, §2 und §4:

- Ein Ticket kann mehrere Quellen haben: alle Einträge mit `ticket = <id>`. `converted` gilt weiter für Umwandeln und Verknüpfen; die Hauptquelle folgt aus `tickets.source_item`.
- „Umgewandelt ist endgültig“ gilt nur noch für die Hauptquelle. Ein verknüpfter Eintrag lässt sich lösen (`converted` → `new` ohne Ticket).
- „Einem bestehenden Ticket zuordnen“ ändert das Ticket weiter nicht, schreibt aber einen Verlaufseintrag `source_link`.
- Anders als in §2 lässt sich ein Eintrag mit Ticket oder als Hauptquelle nicht mehr löschen. `tickets.source_item` wird deshalb nicht mehr über das Löschen des Eintrags geleert.

## Nachtrag (2026-10-01): Kein Eintrag lässt sich über die API löschen

**Befund.** Seit dem Nachtrag oben schützte die `deleteRule` (`… && ticket = ""`, Migration `1790201800_inbox_items_delete_guard.js`) nur Quellen. Einen Eintrag ohne Ticket (neu, verworfen, gelöst) konnte sein Besitzer über die Record-API löschen, ein Superuser auch in der Verwaltung `/_/`, die die Regeln umgeht. Mit dem Datensatz verschwand sein Fingerprint und damit die Sperre aus §3 („Verworfen ist ein Tombstone“, [ADR-0037](0037-papierkorb.md) §6 und Alternativen): Dieselbe Mail, derselbe Termin oder dieselbe Nachricht kam beim nächsten Abruf, bei der Vollsuche des Posteingangs oder als Datei wieder. Die Oberfläche bietet nur Verwerfen und Wiederherstellen an; die SPA ruft für `inbox_items` kein Löschen auf (geprüft: `web/src/lib/data` löscht nur Kommentare, Verbindungen, Zugangsschlüssel, Projekte, Regeln, Tags und Tickets), ebenso wenig der Mail-Hilfsprozess und die Erweiterung für WhatsApp Web.

**Entscheidung.**

- **Regel:** Die Migration `1790202800_inbox_items_no_delete.js` setzt `deleteRule = null`. Ein App-Konto bekommt 403 („Only superusers can perform this action.“), ob es den Eintrag gibt oder nicht. Der Rückweg stellt die Regel von `1790201800` wieder her; der Rollback-Test belegt das mit Daten.
- **Hook:** `onRecordDeleteRequest` von `inbox_items` (`refuseDelete` in `lib/inbox-service.js`) lehnt jedes Löschen über die Record-API ab, auch für Superuser über API und Verwaltung und schon vor der Migration (dann erreicht der Besitzer einen freien Eintrag noch über die alte Regel). Er ruft `e.next()` nie auf. Eine Quelle nennt weiter `validation_inbox_item_linked`; jeder andere Eintrag antwortet 400 mit `validation_inbox_item_delete` am Feld `state`: „Eingangseinträge lassen sich nicht löschen, nur verwerfen. So bleibt die Sperre gegen erneutes Eintreffen erhalten.“ Die Verwaltung zeigt diesen Text.
- **Wege des Servers bleiben:** Request-Hooks laufen nur für Anfragen an die Record-API. `$app.delete` bzw. `txApp.delete` in Hooks, Jobs und Migrationen und das Entfernen der ganzen Collection im Rückweg von `1790201200` laufen am Hook vorbei; ein Integrationstest löscht einen Eintrag über eine Test-Route mit `$app.delete` (`tests/fixtures/pb_hooks/inbox-internal-delete.pb.js`). Heute löscht kein Weg des Servers einen Eintrag: Die Bereinigung `byl-inbox-cleanup` und der Papierkorb (endgültiges Löschen, „Papierkorb leeren“, Aufbewahrung, Rückweg seiner Migration) ändern Einträge nur zu Tombstones, die Kanäle legen an. Die Relationen auf `inbox_items` haben kein Cascade-Delete.
- **Realtime:** Ein `delete`-Ereignis eines Eintrags kommt damit nur noch vom Papierkorb, wenn er Quellen mit ihrem Ticket verbirgt („Quellen verwerfen“, [ADR-0037](0037-papierkorb.md) §3); die Tests der Ereignisse nutzen diesen Weg.

**Alternativen.**

- **Nur die Regel:** verworfen, weil die Verwaltung die Regeln umgeht.
- **Löschen in Verwerfen umdeuten** (204 und `discarded`, wie das Löschen eines Tickets in den Papierkorb führt): verworfen. Die App hat keinen Löschweg, der so umgedeutet werden müsste, und in der Verwaltung wäre ein „gelöschter“, aber weiter sichtbarer Datensatz irreführend.
- **Fingerprint beim Löschen in eine eigene Collection retten:** verworfen; mehr Schema für einen Weg, den niemand braucht. Verworfene Einträge werden nach 30 Tagen ohnehin geleert (§3).

**Folgen.** §2 „Wird ein Eintrag gelöscht, leert PocketBase `tickets.source_item`“ gilt nur noch für Wege des Servers. Ein unerwünschter Eintrag wird verworfen; sein Inhalt verschwindet nach 30 Tagen, die Sperre bleibt. Beides wirkt nach dem nächsten Neustart (Hook und Migration).

## Nachtrag (2026-10-02, [ADR-0049](0049-zielprojekt-je-eingangsweg.md)): Zielprojekt eines Eintrags

§1 bekommt ein Feld: **`target_project`** (Relation auf `projects`, höchstens eins, optional, kein Cascade, Index `idx_inbox_items_target_project`, Migration `1790203100_inbox_target_project.js`), das Projekt, das der Eintrag beim Eintreffen von seinem Weg bekam (Verbindung, eigener Eingang, WhatsApp Web, Dateien). Es setzt nur der Hook beim Anlegen, für Clients ist es unveränderlich wie `channel` (`validation_inbox_immutable`); ein mitgesendeter Wert wird überschrieben. Umwandeln belegt das Projekt damit vor, wenn es aktiv ist (§4). Wird das Projekt gelöscht, leert PocketBase das Feld, und der Hook vermerkt `source_meta.target_gone`. Die Bereinigung verworfener Einträge (§3) lässt das Feld stehen. Einzelheiten, Gründe und die Vorbereitung für Repository und Ordner: [ADR-0049](0049-zielprojekt-je-eingangsweg.md).

## Nachtrag (2026-10-02, [ADR-0050](0050-github-kanal-und-beobachtete-quellen.md)): GitHub und der Status beobachteter Quellen

§1 bekommt mit der Migration `1790203200_github_channel.js`:

- den Kanal **`github`** (auch in `tickets.source`) und die Arten **`change`** („Änderung“: eine Fassung einer beobachteten Datei, neu oder gelöscht), **`pull_request`** und **`release`**;
- das Feld **`watch`** (JSON, höchstens 2 000 Byte): der Status einer beobachteten Quelle, etwa „seit Import erneut geändert“ oder „PR gemergt“. Es setzt nur der Server (beim Anlegen über den flüchtigen Schlüssel `@watch`, danach beim Abruf), für Clients ist es unveränderlich (`IMMUTABLE_FIELDS`); ein Ticket ändert sich damit nie ([ADR-0031](0031-herkunft-sichern.md), Nachtrag I).

§3 bekommt die Familie GitHub: `github|` + `source_ref` + `|` + Fassung. `source_ref` ist bei einer Datei `file:<owner/repo klein>:<pfad>` und die Fassung ihr Blob-SHA (bei einer gelöschten `removed-` und der letzte Blob), bei Pull Request und Release die Node-ID von GitHub mit leerer Fassung. So kommt jede Fassung bzw. jeder PR einmal, und ein verworfener bleibt draußen.

## Nachtrag (2026-10-02, [ADR-0051](0051-ordner-kanal-verweise-statt-kopien.md)): Ordner als Verweise

§1 bekommt mit der Migration `1790203300_folder_channel.js` den Kanal **`folder`** (auch in `tickets.source`) und die Art **`file`** (eine Datei eines beobachteten Ordners; ihre Änderungen tragen die Art `change` von GitHub). Ein solcher Eintrag ist ein **Verweis**, keine Kopie: `source_ref` ist der absolute Pfad der Datei (er folgt ihr, wenn sie verschoben oder umbenannt wird), `source_url` und `original` bleiben leer, `source_meta.folder` hält die Angaben der Fassung (ADR-0051 §3, [ADR-0031](0031-herkunft-sichern.md) Nachtrag J). Den Status zeigt `watch` wie bei GitHub, dazu `moved`.

§3 bekommt die Familie Ordner: `folder|` + Schlüssel der Datei (`source_meta.folder.file_key`, der Pfad in der vergleichbaren Form, unter Windows klein; ohne ihn `source_ref`) + `|` + Fassung (`sha256:<hex>` oder `size:<Bytes>:<ms>`). Dieselbe Fassung derselben Datei kommt einmal, auch über einen zweiten Ordner oder eine zweite Verbindung; eine verworfene bleibt draußen.

## Nachtrag (2026-10-04, [ADR-0061](0061-verschieben-zwischen-bereichen-und-aufloesen.md) Nachtrag E7-4b): Fingerabdrücke verschobener Einträge

§3 bekommt eine dritte Quelle für die harte Stufe: Verlässt ein Eintrag seinen Bereich (Verschieben zwischen Privat und Haushalt), behält der Bereich seinen Fingerabdruck in `inbox_moved_fingerprints` (Migration `1790204300`, nur die Hooks lesen und schreiben). Die Eingangswege prüfen nach den Einträgen des Bereichs diese Merker. Ein Treffer ist ein Duplikat ohne Eintrag, mit dem Zustand `moved` und dem Text „In einen anderen Bereich verschoben.“. So kommt dasselbe Objekt nicht wieder, auch nicht nach dem Zurückschieben oder wenn der Eintrag mit seinem Haushalt gelöscht wurde. Der Index `UNIQUE (scope, fingerprint)` von `inbox_items` bleibt unverändert.

## Nachtrag (2026-10-30, EG-1): Mehrere Einträge verwerfen und wiederherstellen

**Kontext.** Verwerfen und Wiederherstellen gingen nur Eintrag für Eintrag; als Sammelaktion gab es nur „Gesammelt umwandeln“ und „Mit Ticket verknüpfen …“. Wer viele unerwünschte Einträge loswerden will, musste jede Zeile einzeln verwerfen.

**Entscheidung.**

- **Wo:** „Verwerfen (n)“ steht in der Ansicht „Neu“ bei den Sammelaktionen (am PC in der Abschnittsleiste, am Handy in der Leiste der Auswahl unten hinter „Aktionen“). „Wiederherstellen (n)“ steht allein in der Ansicht „Verworfen“; ihre Einträge sind dafür jetzt ebenfalls wählbar (Spalte „Auswahl“, „Alle“, am Handy „Auswählen“). „Verknüpft“ und „Alle“ bleiben ohne Auswahl. Ohne Auswahl sind die Knöpfe wie die übrigen gesperrt („Erst Einträge auswählen.“).
- **Wie (§4):** Der Client schickt je Eintrag dasselbe Update von `state` wie beim einzelnen Verwerfen bzw. Wiederherstellen, einen nach dem anderen. Kein Batch-API, keine Änderung am Server; der Hook prüft jeden Zustandswechsel wie bisher. Ein Fehler bricht nichts ab, eine abgelaufene Sitzung beendet den Lauf (Anmeldung). Umgesetzt in `InboxStore.discardMany`, `restoreMany` und `undoDiscardMany`, die Regeln und Wortlaute in `domain/inbox-bulk.ts`.
- **Was:** Verworfen wird nur, was einzeln verworfen werden könnte (Zustand „Neu“), wiederhergestellt nur Verworfenes. Jeder Eintrag wird beim Senden gegen den Stand des Stores geprüft. Was sich seit der Auswahl geändert hat (etwa in einem anderen Tab verknüpft), gerade eine eigene Aktion hat oder noch nicht übertragen ist, wird übersprungen und mit Grund genannt („Nicht mehr neu.“, „Schon verworfen.“, „Schon verknüpft.“, „Schon im Eingang.“, „Verknüpft, nicht verworfen.“, „Nicht mehr verworfen.“, „Wird gerade bearbeitet.“, „Noch nicht übertragen.“). Geänderte Einträge verlassen die Auswahl, ein fehlgeschlagener bleibt gewählt.
- **Rückmeldung wie in Aufgaben und Papierkorb:** Fortschritt („Verwerfen: 1 von 3 Einträgen“) und Ergebnis (Fehler als `.alert-error` „1 Eintrag wurde nicht verworfen:“, Übersprungenes neutral „2 Einträge übersprungen:“, „Ergebnis schließen“) stehen in der `SelectionBar`: am PC über der Tabelle, nur solange ein Lauf geht oder ein Ergebnis steht (die Knöpfe bleiben in der Abschnittsleiste), am Handy in der Leiste unten, nach „Fertig“ allein. Das Flag nennt das Ergebnis („3 Einträge verworfen.“, „2 Einträge verworfen, 1 übersprungen, 1 fehlgeschlagen.“; ging nichts, als Fehler „Keiner der 3 Einträge wurde verworfen.“). Während eines Laufs warten alle Sammelaktionen. Der Fokus bleibt am PC auf dem Knopf, am Handy geht er zurück in die Leiste (wie `BulkActionBar`).
- **Ein „Rückgängig“:** Das Flag nach „Verwerfen (n)“ bietet es so lange wie beim einzelnen Verwerfen (Laufzeit des Flags, 8 s). Es stellt alle Einträge dieses Laufs nacheinander wieder her, auch wenn sie nicht mehr geladen sind; Teilfehler stehen im Ergebnis und im Flag. „Wiederherstellen (n)“ hat wie das einzelne kein „Rückgängig“.
- **Ohne Verbindung:** Wo der Postausgang die fehlende Verbindung erkennt (derselbe Zustand wie bei „Alle Kanäle jetzt abrufen“, OF-3), bleiben beide Knöpfe sichtbar, aber gesperrt: `aria-disabled`, daneben „Nur mit Verbindung“ über `aria-describedby`, ein Tipp oder Enter zeigt das Info-Flag „„Verwerfen (3)“ geht nur mit Verbindung.“. Der Postausgang merkt das Verwerfen nicht.
- **Nicht Teil davon:** Löschen bleibt gesperrt (Nachtrag vom 2026-10-01), es gibt keinen Papierkorb für Einträge, und Regeln für Kanäle oder Absender („künftig nicht mehr abrufen“) gehören bewusst nicht dazu.

**Alternativen.**

- **Sammel-Route im Server:** verworfen wie „Kein Batch-API“ in §4; eine zweite Prüfung desselben Zustandswechsels für einen Gewinn, den die Zahl der Einträge im Eingang nicht braucht.
- **„Löschen (n)“:** verworfen; Löschen bleibt gesperrt, damit die Sperre gegen erneutes Eintreffen bleibt.
- **Auswahl auch in „Alle“ mit beiden Aktionen:** verworfen; die Ansichten „Neu“ und „Verworfen“ zeigen genau die Einträge, für die eine Aktion gilt.

**Folgen.** Nur Oberfläche, Tests und Doku: nach dem Build F5, kein Neustart. Viele Einträge brauchen viele Anfragen, eine nach der anderen; „Gesammelt umwandeln“ und „Mit Ticket verknüpfen …“ blieben ohne Verbindung zunächst bedienbar (seit MO-7c1 gesperrt, siehe unten).

**Runde 2 (nach Durchsicht, 2026-10-30).**

- **Auswahl je Ansicht:** Ein Wechsel des Zustands („Neu“, „Verworfen“, „Verknüpft“, „Alle“) leert die Auswahl und beendet am Handy „Auswählen“. Ein gewählter Eintrag, der den Zustand der Ansicht verlässt (eigene Zeilenaktion wie „Wiederherstellen“, Umwandeln im Panel, Änderung in einem anderen Tab), fällt aus der Auswahl und kommt nicht gewählt zurück. In „Neu“ gilt das auch für einen Eintrag, den der Store nicht mehr kennt (er hält alle neuen), in „Verworfen“ nur für einen, den er in einem anderen Zustand kennt. Ein Wechsel der Quelle oder des Zielprojekts behält die Auswahl wie bisher.
- **„Wiederherstellen (n)“ bei Wechsel von Ansicht oder Quelle:** Ein dadurch nicht mehr geladener Eintrag wird trotzdem gesendet und der Server entscheidet (wie bei „Rückgängig“); nur ein inzwischen gelöschter steht mit „Nicht mehr verworfen.“ im Ergebnis. Vorher stand jeder solche Eintrag fälschlich als „Nicht mehr verworfen.“ da.
- **Das Ergebnis gehört zur Ansicht:** Es steht nur in der Ansicht, in der sein Lauf begann; ein Wechsel des Zustands verwirft es, und ein Lauf, der in einer anderen Ansicht endet, hinterlässt keins. Fortschritt und Ergebnis erscheinen nur in „Neu“ und „Verworfen“ (kein „0 Einträge ausgewählt“ in „Verknüpft“ oder „Alle“). Ohne Ergebnis an der Auswahl verweist das Fehler-Flag nicht auf sie, sondern bietet „Details“ des ersten Fehlers.
- **Alles übersprungen:** kein Erfolgs-Flag, sondern das Info-Flag „Nichts verworfen: 3 übersprungen.“ bzw. „Nichts wiederhergestellt: 1 übersprungen.“.
- **Gesperrt während eines Laufs:** Am PC verweisen „Gesammelt umwandeln (n)“, „Mit Ticket verknüpfen … (n)“ und „Verwerfen (n)“ bzw. „Wiederherstellen (n)“ über `aria-describedby` auf den Fortschritt (die `SelectionBar` nimmt dafür eine `progressId`); Klick oder Enter zeigt das Info-Flag „„Gesammelt umwandeln (3)“ geht erst, wenn „Verwerfen“ fertig ist.“, wie ohne Verbindung.
- **„Details“ (FP-1, [ADR-0071](0071-fehlerdetails-und-sitzungsprotokoll.md)):** Jeder Fehler im Ergebnis trägt die gescheiterte Anfrage mit „Details“, wie bei einer einzelnen Aktion.
- **Ende der Sitzung mitten im Lauf:** Der Lauf endet ohne Ergebnis, ohne Flag und ohne „Rückgängig“ (die Anmeldung folgt). Bis dahin verworfene Einträge stehen in „Verworfen“ und lassen sich dort wiederherstellen.
- **Grenze:** Ein Eintrag, der nach „Verwerfen (n)“ in einem anderen Tab verknüpft wurde, ist in „Neu“ nicht mehr geladen; „Rückgängig“ sendet ihn, der Server lehnt ab, und er steht mit dessen Grund unter den Fehlern statt unter „übersprungen“. Wo der Store ihn kennt (etwa in „Alle“), wird er mit „Verknüpft, nicht verworfen.“ übersprungen.

**MO-7c1 (2026-10-30, Nacharbeit aus der Durchsicht von EG-1 und Teil des Pakets MO-7c1, [ADR-0073](0073-smartphone-layout.md) Nachtrag MO-7c1).** Auf jedem Gerät, nur Oberfläche, Tests und Doku: nach dem Build F5.

- **Alle Sammelaktionen ohne Verbindung gesperrt:** Auch „Gesammelt umwandeln (n)“ und „Mit Ticket verknüpfen … (n)“ bleiben ohne Verbindung sichtbar, aber gesperrt, im selben Muster wie „Verwerfen (n)“: `aria-disabled` (kein `disabled`, Enter erreicht sie), „Nur mit Verbindung“ daneben über `aria-describedby` und als `title`, ein Tipp oder Enter zeigt das Info-Flag „„Gesammelt umwandeln (3)“ geht nur mit Verbindung.“ bzw. „„Mit Ticket verknüpfen … (3)“ geht nur mit Verbindung.“; am PC in der Abschnittsleiste, am Handy hinter „Aktionen“. Vorher öffneten sie ihren Weg und scheiterten erst dort. Während eines Laufs nennen sie weiter den Fortschritt als Grund. Der Postausgang merkt keine davon; die Hilfe „Ohne Verbindung“ nennt alle vier.
- **Teilfehler, deren Ergebnis nicht bei der Auswahl steht (F-1):** Endet ein Lauf mit Fehlern in einer anderen Ansicht, oder läuft „Rückgängig“ in „Alle“ oder „Verknüpft“, wo keine Auswahl steht, zeigt das Flag statt eines Erfolgs ein Fehler-Flag mit dem Ergebnis („1 Eintrag verworfen, 1 fehlgeschlagen.“), dem Grund des ersten Fehlers („„Artikel“: Der Server hat mit einem Fehler geantwortet. …“, bei mehreren „Dazu 1 weiterer Fehler.“) und „Details“ seiner Anfrage; nach „Verwerfen (n)“ bleibt „Rückgängig“ für die verworfenen Einträge darin. Es steht wie jedes Fehler-Flag, bis es geschlossen wird, „Rückgängig“ also auch länger als 8 s. Ohne jeden Erfolg nennt das Fehler-Flag denselben Grund (vorher nur „Details“). Steht das Ergebnis bei der Auswahl, bleibt es beim Erfolgs-Flag, die Gründe stehen im Ergebnis. Ein eigener Ton „Warnung“ der Flags wäre neu (Farbe, Kontrast, Live-Region); der Ton „Fehler“ bringt „Details“ und bleibt stehen.
- **Fokus:** „Ergebnis schließen“ lässt den Fokus in der Leiste oder setzt ihn auf die Überschrift „Eingang“, nie auf die Seite (Q-1 der Durchsicht von MO-7b, `lib/selection-focus.ts`).
- **Grenze (F-2):** Ein Eintrag, den „Wiederherstellen (n)“ oder „Rückgängig“ sendet, obwohl er inzwischen verknüpft ist und sein Ticket gelöscht wurde (Feld `ticket` leer), landet in „Neu“: Der Server erlaubt diesen Wechsel als „Lösen“. Nichts geht verloren; der Eintrag steht wieder zur Wahl. Selten (anderer Tab, gelöschtes Ticket während eines Laufs) und ohne Schaden, deshalb keine eigene Prüfung im Client.
- **Tests:** `inbox-table.test.ts` und `inbox-table-phone.test.ts` (Sperre, Gegenprobe mit Verbindung, Fokus), `inbox-store.test.ts` (F-1 in anderer Ansicht und nach „Rückgängig“ in „Alle“, Gegenprobe). Am Stand `c9ff4e2` rot: alle neuen Fälle außer den Gegenproben. Angepasst (mit Grund): „keeps "Verwerfen (n)" without a connection …“ erwartete „Gesammelt umwandeln (1)“ ohne Verbindung frei, jetzt gesperrt; „keeps no result of a run that ends in another view …“ erwartete das Fehler-Flag ohne Beschreibung, jetzt mit dem Grund. Manifest BYL-E6-2243 und BYL-E6-2244, berichtigt BYL-E6-2228 und BYL-E6-2234.

**NA-1 (2026-10-31, Nacharbeit aus der Durchsicht von MO-7c1, [ADR-0073](0073-smartphone-layout.md) Nachtrag NA-1).** Auf jedem Gerät, nur Oberfläche, Tests und Doku: nach dem Build F5.

- **C3, ein Fehler für Grund und „Details“:** Das Fehler-Flag eines Teilfehlers (F-1 oben) nimmt Grund und „Details“ aus demselben, dem ersten Fehler. Hat er keine Anfrage für „Details“ (eine Ablehnung, die nur eine Eingabe prüft), zeigt das Flag keine, statt der Anfrage eines anderen Eintrags.
- **C5, Fokus:** „Verwerfen (n)“ und „Wiederherstellen (n)“ geben den Fokus wie „Ergebnis schließen“ über `keepFocusAtBar` zurück: nur einen verlorenen, an die Leiste oder an „Eingang“; ein Element, das der Nutzer während des Laufs wählt, behält ihn.
- **Tests:** `inbox-store.test.ts` und `inbox-table-phone.test.ts`, je am Stand `0044e13` rot.
