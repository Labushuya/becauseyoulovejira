# ADR-0011: Neue Etappen E3 bis E7 mit vorgezogenen Eingangskanälen

- **Status:** Angenommen (mit Nachtrag 2026-09-28: Unteraufgaben aus Stufe 2 freigegeben, [ADR-0033](0033-unteraufgaben.md))
- **Datum:** 2026-09-25
- **Entscheidung durch:** Nutzer (Etappen, Reihenfolge der Kanäle, Papierkorb, 2026-09-25), Advisor (Zuordnung der übrigen Themen)

## Kontext

Bis E2 galt dieser Etappenplan (CLAUDE.md §12): E3 Projekte, Tags, Filter, Suche · E4 Wiederkehrende Aufgaben · E5 Schnellerfassung, Theme, Feinschliff, Doku · E6 Zugriff von mehreren Geräten über Tailscale ([ADR-0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md)). Haushalte waren eine „spätere Stufe nach Freigabe“.

Nach E2 hat der Nutzer entschieden:

- Das Layout des Task-Boards wird übernommen ([ADR-0010](0010-layout-nach-task-board.md)).
- Tickets sollen früher über Kanäle hereinkommen. Die Kanäle werden deshalb vor die wiederkehrenden Aufgaben gezogen.
- Es gibt einen Papierkorb (weiches Löschen mit Wiederherstellen), aber erst im Feinschliff.

CLAUDE.md §10 schloss bisher „externe Integrationen“ aus. Die neuen Kanäle brauchen eine klare Grenze.

## Entscheidung

### 1. Etappen

| Etappe | Inhalt | Bisher |
|---|---|---|
| **E3 Übersicht & Ordnung** | Seitenaufbau nach ADR-0010 (Kopfzeile, Kennzahlen, Filterleiste, Abschnittsleiste, Tabelle), Projekte mit Projektansicht, Tags, Filter mit Zustand in der URL, Suche, Sortierung per Spaltenkopf, Gruppierung, relative Fälligkeitslabels. Plan: [E3-Plan](../plan/e3.md). | E3 (erweitert) |
| **E4 Eingang & Kanäle** | In dieser Reihenfolge: (1) Schnellerfassung per `c` und `Strg+K` mit Kurzsyntax und Übernahme aus der Zwischenablage, (2) Web-Links per Bookmarklet, (3) `.ics`-Dateien, (4) `.eml`-Dateien per Drag & Drop. Dazu die Quelle bzw. der Kanal als Ticketmerkmal (Filter, Spalte, Gruppierung) und die „Neu“-Markierung pro Nutzer. **In Prüfung:** Google Calendar, WhatsApp, Telegram, Notion. | Schnellerfassung aus E5 |
| **E5 Wiederkehrende Aufgaben** | Regeln nach CLAUDE.md §6, dazu Vorschläge aus der `RRULE` importierter `.ics`-Termine. | E4 |
| **E6 Feinschliff** | Papierkorb (weiches Löschen mit Wiederherstellen), Popover „Spalten“, Vollansicht eines Tickets, Tastaturbedienung und Kürzel, Hilfe. Dazu der Theme-Umschalter und die Punkte „Feinschliff“ aus den Etappenplänen, etwa ein Hinweis bei gescheitertem Realtime-Abo ([E2-Plan](../plan/e2.md) §8). | Theme und Feinschliff aus E5 |
| **E7 Haushalt & Mehrgeräte** | Haushalte mit gemeinsamen Tickets und Zugriff von mehreren Geräten über Tailscale nach ADR-0001. | E6 und die „spätere Stufe“ Haushalt |

- Stufe 2 (Sub-Tickets, Abhängigkeiten, Board, Benachrichtigungen, Anhänge) bleibt unverändert: nur auf ausdrückliche Anweisung (CLAUDE.md §10).
- Bis zum Papierkorb in E6 bleibt das endgültige Löschen mit Sicherheitsabfrage aus E2 (T-12 im E2-Plan).
- Nach jeder Etappe gilt weiter: Zusammenfassung, Testanleitung, Entscheidungen, dann Freigabe abwarten (CLAUDE.md §12). E7 beginnt wie bisher erst nach ausdrücklicher Freigabe.

### 2. Grenze für Kanäle (ersetzt „externe Integrationen“ in CLAUDE.md §10)

- **Im Scope ab E4** sind Kanäle, die ohne fremden Dienst auskommen: Eingaben im Browser (Schnellerfassung, Zwischenablage), ein Bookmarklet, das die eigene App unter `127.0.0.1` öffnet, und Dateien, die der Nutzer selbst hereinzieht (`.ics`, `.eml`). Der Server stellt dafür keine Verbindung ins Internet her.
- **In Prüfung** sind Google Calendar, WhatsApp, Telegram und Notion. Sie werden in einem eigenen Auftrag bewertet (Machbarkeit, Kosten, Datenschutz, Offline-Tauglichkeit, Wartungsaufwand). Umgesetzt wird ein Dienst nur mit eigener ADR und Freigabe des Nutzers. Bis dahin stehen sie in der Roadmap nur als „in Prüfung“.
- Alles, was über Kanäle hereinkommt, ist nicht vertrauenswürdig. Es wird wie Nutzereingaben validiert und als Markdown sanitisiert ([ADR-0008](0008-markdown-rendering-und-sanitizing.md)).

### 3. Alte Etappenverweise

Angenommene ADRs und abgeschlossene Pläne werden nicht umgeschrieben (Regel in [docs/adr/README.md](README.md)). Ältere Verweise gelten nach dieser Zuordnung:

| Verweis in älteren Dokumenten und Code-Kommentaren | Gilt jetzt als |
|---|---|
| „E4“ für wiederkehrende Aufgaben, `berlin-time.js`, Cron und `recurrence_rules` (etwa [ADR-0003](0003-pb-data-und-backups.md), [ADR-0005](0005-zeitzone-europe-berlin.md), E1-Plan, Kommentare in `app/pb_migrations` und `web/src/lib/domain`) | E5. Braucht ein Kanal in E4 schon ein serverseitiges Berliner „heute“, entsteht `berlin-time.js` dort. |
| „E5“ für Schnellerfassung und Kurzsyntax | E4 |
| „E5“ für Theme-Umschalter und Feinschliff | E6 |
| „nach E5“ bzw. „E6“ für Mehrgeräte ([ADR-0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md)) | E7 |
| Haushalte „nach E2–E5“ bzw. „spätere Stufe“ | E7 |

Code-Kommentare mit alten Etappennummern werden angepasst, sobald die Datei ohnehin geändert wird. Dafür gibt es keinen eigenen Commit.

## Alternativen

- **Bisherige Reihenfolge beibehalten (Wiederholungen vor Kanälen):** vom Nutzer verworfen. Kanäle bringen im Alltag früher Nutzen, und die `.ics`-Einbindung liefert die Grundlage für Regelvorschläge in E5.
- **Papierkorb schon in E3:** Der Papierkorb braucht ein Löschkennzeichen, das jede Liste, jeden Filter, jedes Abo und die Nummernkreise berührt. In E3 würde er den Layout-Umbau aufblähen. Vom Nutzer auf E6 gelegt.
- **Externe Dienste direkt in E4:** Sie sind ohne Prüfung von Datenschutz, Schnittstellen und Offline-Verhalten nicht verantwortbar. Verworfen zugunsten „in Prüfung“.

## Konsequenzen

- README (Roadmap, Feature-Tabelle) und CLAUDE.md (§10, §12) folgen dieser Etappenfolge.
- E3 wird größer als bisher geplant (Layout-Umbau). Der E3-Plan zerlegt die Etappe deshalb in kleine, einzeln testbare Pakete.
- Die Quelle bzw. der Kanal eines Tickets ist ein neues Datenmerkmal. Es kommt in E4 als additive Migration, ohne Datenmigration ([ADR-0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md)).
- Die Planung von E4 beginnt erst, wenn die Prüfung der externen Dienste vorliegt. Sie entscheidet nur über deren Status, nicht über die vier lokalen Kanäle.

## Nachtrag (2026-09-28): Unteraufgaben aus Stufe 2 freigegeben

Der Text oben bleibt unverändert. Aus der Stufe 2 („Sub-Tickets, Abhängigkeiten, Board, Benachrichtigungen, Anhänge“, §1) hat der Nutzer am 2026-09-28 die **Sub-Tickets** ausdrücklich freigegeben. Sie werden als „Unteraufgaben“ in E6 umgesetzt, nach „Editor Stufe A“ und vor „Editor Stufe B“ (Reihenfolge aus dem [Plan Editor](../plan/editor.md)).

- Umfang und Regeln: [ADR-0033](0033-unteraufgaben.md); Pakete UA-0 bis UA-5 und Manifest-IDs ab `BYL-E6-220`: [Plan Unteraufgaben](../plan/unteraufgaben.md).
- Abhängigkeiten mit Entsperr-Automation, Board, Benachrichtigungen und Anhänge bleiben Stufe 2 und kommen weiter nur auf ausdrückliche Anweisung.
