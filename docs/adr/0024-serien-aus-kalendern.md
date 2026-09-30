# ADR-0024: Serien aus `.ics` und Google Calendar als Vorschlag für eine Regel

- **Status:** Angenommen (2026-09-26: Der Nutzer hat die Empfehlungen zu OF-E5-1 bis OF-E5-5 bestätigt; umgesetzt in E5, siehe Nachtrag am Ende)
- **Datum:** 2026-09-25
- **Entscheidung durch:** Advisor
- **Ergänzt:** [ADR-0014](0014-datenmodell-eingang.md) (Eingang, Umwandeln), [ADR-0017](0017-parser-ics-eml.md) (Parser), [ADR-0021](0021-regelmodell-wiederkehrende-aufgaben.md) (Regelmodell), [ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) §1 (Anlegen mit Ticket)

## Kontext

Termine aus `.ics`-Dateien und aus Google Calendar tragen ihre Serie als Rohtext in `inbox_items.source_meta.rrule`, dazu `all_day`, `end` und `recurrence_id` ([ADR-0017](0017-parser-ics-eml.md), E4 Pakete 14 und 15).

- Eine Serie ist **ein** Eintrag.
- Einzeln geänderte Vorkommen (`RECURRENCE-ID`) sind eigene Einträge ohne `rrule`.
- `EXDATE` und `RDATE` liest der Parser nicht.
- `source_date` ist der Beginn als UTC-Zeitpunkt; bei ganztägigen Terminen ist es Berliner Mitternacht.

Die Hinweise im [E4-Plan](../plan/e4.md) §12 legen fest:

- Vorschläge gibt es nur für Regeln, die sich auf die Teilmenge abbilden lassen. Alles andere bekommt einen neutralen Hinweis statt eines stillen Teilvorschlags.
- P-5 gilt weiter: Das Quelldatum wird nie still zur Fälligkeit, und `next_due` entsteht erst nach Bestätigung.
- Verworfene Einträge verlieren `rrule` nach 30 Tagen (`byl-inbox-cleanup`). Vorschläge gibt es also nur für neue und umgewandelte Einträge.

## Entscheidung

### 1. Wo der Vorschlag erscheint

Der Vorschlag erscheint im Panel „Neues Ticket“, wenn es aus einem Eingangseintrag vorbefüllt ist (`/tickets/neu?aus=<id>`). Voraussetzung: Der Eintrag hat eine `rrule` und keine `recurrence_id`.

- Unter dem Hinweis zum Quelldatum steht ein neutraler Kasten: „Dieser Termin wiederholt sich: jeden Dienstag.“ mit dem Knopf **„Als Wiederholung übernehmen“**.
- Erst der Knopf öffnet den Abschnitt „Wiederholung“ im Panel, mit denselben Feldern wie im Dialog „Wiederholen…“ und vorbefüllt aus dem Vorschlag. Dort lässt er sich ändern oder mit „Entfernen“ wieder schließen.
- Ohne Klick entsteht keine Regel, und weder `due` noch `next_due` werden gesetzt.
- **Anlegen mit Wiederholung** läuft in zwei Schritten:
  1. Das Ticket wird wie bisher angelegt und wandelt den Eintrag in derselben Transaktion um ([ADR-0014](0014-datenmodell-eingang.md) §2).
  2. Danach legt die SPA die Regel mit `ticket = <neues Ticket>` an ([ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) §1).
  - Scheitert Schritt 2, bleibt das Ticket bestehen. Das Panel meldet den Fehler und bietet „Wiederholen…“ vorbefüllt an.
- Bei einem schon umgewandelten Eintrag zeigt das Panel des Eintrags (`/eingang/<id>`) denselben Kasten mit dem Knopf „Wiederholung für TASK-12 anlegen…“. Er öffnet „Wiederholen…“ am Ticket, solange es offen und noch in keiner Serie ist.

### 2. Abbildung der `RRULE` (nur in der SPA)

`web/src/lib/domain/rrule.ts` bietet eine reine Funktion `suggestRule(rrule, startDate)`. `startDate` ist das Berliner Kalenderdatum von `source_date`. Mögliche Ergebnisse:

- `{ kind: 'rule', params, notes }`: Die Serie lässt sich übernehmen, `notes` sind sichtbare Hinweise.
- `{ kind: 'unsupported', reasons }`: Die Serie lässt sich nicht übernehmen.
- `null`: Es gibt keine `rrule`.

| `RRULE` | Ergebnis |
|---|---|
| `FREQ=DAILY` mit `INTERVAL` | `calendar`, `daily`, `interval` |
| `FREQ=WEEKLY` mit `INTERVAL`, `BYDAY` ohne Ordinalzahl (fehlt `BYDAY`: Wochentag des Beginns) | `calendar`, `weekly`, `weekdays` |
| `FREQ=MONTHLY` mit `INTERVAL` und genau einem `BYMONTHDAY` 1 bis 31 oder `-1` (fehlt es: Tag des Beginns) | `calendar`, `monthly`, `month_day`; bei 29 bis 31 der Hinweis „In kürzeren Monaten am letzten Tag.“ ([ADR-0021](0021-regelmodell-wiederkehrende-aufgaben.md) §2) |
| `FREQ=YEARLY` mit `INTERVAL`, ohne `BY…` oder mit `BYMONTH`/`BYMONTHDAY` gleich dem Beginn | `calendar`, `yearly`; am 29.02. der Hinweis „In Nicht-Schaltjahren am 28.02.“ |
| `WKST` | wird ignoriert, außer bei `WEEKLY` mit `INTERVAL > 1` und mehreren Tagen, sofern `WKST` nicht `MO` ist: dann `unsupported`, denn die Wochen würden anders gezählt |
| `UNTIL`, `COUNT` | `unsupported`: Die Serie hat ein Ende, das die Regel nicht kennt (OF-E5-5) |
| `BYSETPOS`, `BYDAY` mit Ordinalzahl (`2MO`, `-1FR`), `BYDAY` bei `DAILY`, `MONTHLY` oder `YEARLY`, mehrere `BYMONTHDAY`, `BYYEARDAY`, `BYWEEKNO`, `BYHOUR`, `BYMINUTE`, `BYSECOND`, `FREQ=HOURLY`, `MINUTELY` oder `SECONDLY`, unbekannte Teile, Syntaxfehler | `unsupported` mit einem Grund in einfacher Sprache |

Weitere Festlegungen:

- `anchor` ist `startDate`; die Uhrzeit fällt weg. `lead_days` erhält den Standard.
- Die Vorlage kommt aus dem Ticketformular, wie es beim Anlegen aussieht.
- **`unsupported`** zeigt einen neutralen Kasten, nicht rot: „Diese Serie lässt sich nicht als Regel übernehmen (Grund). Nach dem Anlegen kannst du am Ticket „Wiederholen…“ wählen.“
- Der Parser ist streng: Ein Teil, den er nicht kennt, ergibt `unsupported`. Er übernimmt nie still einen Teil der Serie.
- **Nur die SPA:** Der Vorschlag entsteht nur im Browser. Der Server prüft die angelegte Regel wie jede andere ([ADR-0021](0021-regelmodell-wiederkehrende-aufgaben.md) §1). Ein Spiegel in `app/pb_hooks/lib/` mit Paritätstest, wie ihn der E4-Plan §12 als Möglichkeit nennt, hätte heute keinen Nutzer im Hook. Er entsteht erst, wenn ein Hook die `RRULE` selbst auswerten muss.
- Die Falltabelle `web/src/lib/domain/rrule.test.ts` enthält erfundene `RRULE`-Zeilen in der Form, wie Google, Outlook und Thunderbird sie schreiben, dazu die `RRULE`-Zeilen der vorhandenen Fixtures unter `tests/fixtures/ics/`.

### 3. Verhältnis zum Kalender-Kanal

- Nach dem Umwandeln bleibt der Eintrag `converted`. Der Feed liefert die Serie weiter mit demselben Fingerprint. Das zählt als Duplikat, und es entsteht nichts Neues ([ADR-0014](0014-datenmodell-eingang.md) §3).
- Ab dann erzeugt die Regel die Tickets.
- Änderungen der Serie im Kalender (andere Wochentage, Ende) ändern die Regel **nicht**. Die Regel gehört dem Nutzer. Eine Synchronisation wäre ein Rückkanal, und den schließt E4 aus.
- Einzeln geänderte Vorkommen kommen weiter als eigene Einträge, sofern ein Stichwort greift. Der weiche Duplikathinweis über den Titel ([ADR-0014](0014-datenmodell-eingang.md) §3) weist auf das Ticket der Serie hin.

## Alternativen

- **Die Regel beim Umwandeln einer Serie automatisch anlegen:** Das widerspricht P-5 und dem Grundsatz, dass Kanalinhalte nicht vertrauenswürdig sind. Verworfen.
- **Nicht abbildbare Serien näherungsweise übernehmen** (etwa `2MO` als „monatlich am Tag des Beginns“): Das wäre ein stiller Teilvorschlag. Er ist nach dem E4-Plan §12 ausgeschlossen. Verworfen.
- **`UNTIL` übernehmen und die Regel am Enddatum pausieren:** Dafür bräuchte die Regel ein weiteres Feld mit eigener Logik. Das hängt an OF-E5-5 und kann additiv nachkommen.
- **Vorschlag schon in der Eingangsliste als eigene Aktion:** Das braucht eine zweite Stelle mit derselben Logik. Der Vorschlag gehört zum Umwandeln. Verworfen.

## Konsequenzen

- Positiv: Kalenderserien werden mit zwei Klicks zu Regeln, ohne dass etwas still passiert. Der Hook bleibt frei von einem zweiten RRULE-Parser.
- Negativ: Serien mit Enddatum, Anzahl oder „n-tem Wochentag“ bekommen nur einen Hinweis. Wie häufig das ist, zeigt der Alltag. OF-E5-3 und OF-E5-5 halten die Erweiterung offen.

## Nachtrag (2026-09-26, Umsetzung E5 Paket 6)

Der Text oben bleibt unverändert. Wo die Umsetzung abweicht oder genauer ist, gilt dieser Nachtrag. Einzelheiten stehen im [E5-Plan](../plan/e5.md) §7, Paket 6.

- **§2, `anchor`:** Liegt der Beginn der Serie vor heute, ist „Beginnt am“ der erste Termin ab heute im selben Takt. Jährlich ist es das nächste Vorkommen mit Monat und Tag des Beginns, am 29.02. also das nächste Schaltjahr. Grund: Ein Ticket ohne Fälligkeit bekommt `onOrAfter(anchor)` ([ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) §1). Mit dem alten Beginn wäre eine seit Jahren laufende Serie als Jahre überfälliges Ticket erschienen. Wochen- und Monatstakt bleiben gleich, weil der neue Beginn selbst ein Termin der Serie ist. Liegt der Beginn heute oder später, gilt der Text oben.
- **§2, Signatur:** `suggestRule(rrule, startDate, today)` bekommt `today` für die Regel oben. Dazu kommen `itemSuggestion(item, today)` (prüft `rrule`, `recurrence_id` und das Quelldatum) und `suggestionFormValues(params)`. Ein Vorschlag trägt den Rhythmus in Worten (`text`), `unsupported` alle Gründe ohne Doppelte.
- **§2, strenger als die Tabelle:** Auch diese Fälle ergeben `unsupported`:
  - `BYMONTHDAY` bei täglich oder wöchentlich.
  - `BYMONTH` außer bei jährlich.
  - `BYMONTHDAY` von -2 bis -31 („vom Monatsende“).
  - `WKST` ungleich MO bei wöchentlich mit Intervall > 1, auch mit nur einem Tag, wenn dieser nicht der Wochentag des Beginns ist.

  Ein `RRULE:`-Präfix und Kleinschreibung sind erlaubt. Ein doppelter Teil oder ein leerer Wert ist ein Syntaxfehler.
- **§1, Oberfläche:** Der Kasten ist eine `SectionMessage` (info). „Als Wiederholung übernehmen“ öffnet den Abschnitt „Wiederholung“ mit dem Fokus auf seiner Überschrift. Statt eines Textknopfs „Entfernen“ schließt ihn der Symbolknopf „Wiederholung entfernen“ (CLAUDE.md §8). Ungültige Werte verhindern das Anlegen, bevor etwas gesendet wird.
- **§1, Fehler im zweiten Schritt:** Der `RecurrenceStore` legt ein Angebot für das Ticket ab (`offerRepeat` mit Grund). Das Ticket-Panel holt es einmal ab (`takeOffer`), zeigt den Grund als Fehler und öffnet „Wiederholen…“ mit denselben Werten.
- **§1, Panel des Eintrags:** „Wiederholung für TASK-12 anlegen…“ ist ein Link aufs Ticket. Er erscheint nur, solange das Ticket offen und in keiner Serie ist. Ein einfacher Klick übergibt die Werte über `offerRepeat`, und das Ticket-Panel öffnet „Wiederholen…“ sofort vorbefüllt. Ein Klick in einen neuen Tab übergibt nichts. Vor der E5-Migration zeigen Formular und Panel keinen Kasten.
- **Server:** Das zweistufige Anlegen erzeugt kein Ticket auf einem neuen Weg, auch nicht, wenn der erste Termin im Vorlauf liegt (`web-data-recurrence.test.mjs`).

## Nachtrag 2 (2026-09-28, Plan „Offene Reste“, OR-4)

Nutzerentscheidung vom 2026-09-28: Jedes neue Ticket kann gleich beim Anlegen wiederholt werden, nicht nur ein Serientermin. Der Text oben und der erste Nachtrag bleiben; für die Oberfläche gilt jetzt:

- „Neues Ticket“ hat nach der Fälligkeit den zugeklappten Abschnitt „Wiederholen“, dessen Überschrift ein Disclosure-Knopf (`aria-expanded`) ist. Er ersetzt die Überschrift „Wiederholung“ und den Symbolknopf „Wiederholung entfernen“: Zuklappen nimmt die Regel heraus, behält aber die Werte im Formular.
- „Als Wiederholung übernehmen“ öffnet denselben Abschnitt mit den vorgeschlagenen Werten, der Fokus steht auf dem Disclosure-Knopf.
- Ohne Vorschlag belegt er sich wie „Wiederholen…“ vor (wöchentlich am Wochentag der Fälligkeit bzw. von heute, Beginn dort, Vorlauf 3); solange niemand etwas ändert, folgen die Vorgaben einer neuen Fälligkeit.
- Der Weg zum Server bleibt der zweistufige aus diesem ADR (erst das Ticket, dann die Regel mit `ticket`), mit demselben Angebot „Wiederholen…“, wenn die Regel scheitert. Vor der E5-Migration fehlt der Abschnitt.

## Nachtrag 3 (2026-09-30, Plan „Wiederholungen: Werte von Folgetickets“, WV)

§2 „Die Vorlage kommt aus dem Ticketformular, wie es beim Anlegen aussieht.“ gilt weiter und jetzt auch für den Status: Die Regel einer übernommenen Serie und die von „Neues Ticket“ mit „Wiederholen“ bekommen im zweiten Schritt die Werte des eben angelegten Tickets, also Titel, Beschreibung, Priorität, Projekt, Tags und seinen Status als „Status beim Anlegen“ ([ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 8, [ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) Nachtrag 6). Der Weg ist derselbe wie bei „Wiederholen…“ (`RecurrenceStore.repeatCreated` → `repeat` mit `ticketTemplate`). Die Prüfung des Nutzerberichts (Plan WV §2) fand hier keinen Fehler bei der Priorität: Sie kam schon immer aus dem Formular; neu ist nur der Status, der bisher für jedes Folgeticket „Offen“ war. Der Abschnitt „Wiederholen“ von „Neues Ticket“ sagt das: „Künftige Tickets bekommen Titel, Beschreibung, Priorität, Status, Projekt und Tags aus diesem Formular. Ändern kannst du das danach am Ticket unter „Wiederholt sich“.“ Belegt in `web-data-recurrence.test.mjs` („a series from a calendar …“, „"Wiederholen…" and "Neues Ticket" …“).
