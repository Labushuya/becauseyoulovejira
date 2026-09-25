# ADR-0024: Serien aus `.ics` und Google Calendar als Vorschlag für eine Regel

- **Status:** Vorgeschlagen (wird mit der Antwort auf OF-E5-5 im [E5-Plan](../plan/e5.md) angenommen)
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
