# ADR-0012: Plain Ticketing ohne Ticket-Typen, Epics, Sprints und Story Points

- **Status:** Angenommen (mit Nachträgen 2026-09-28: Unteraufgaben freigegeben, [ADR-0033](0033-unteraufgaben.md); Unterprojekte als Gliederung, [ADR-0034](0034-unterprojekte.md))
- **Datum:** 2026-09-25
- **Entscheidung durch:** Nutzer (2026-09-25)

## Kontext

becauseyoulovejira soll wie Jira aussehen und sich wie Jira anfühlen: Keys wie `HAUS-12`, Status-Pillen, Detail-Panel, Kommentare, Verlauf. Die Prozesslast von Jira soll es aber nicht haben (CLAUDE.md §1). CLAUDE.md §10 schließt Epics, Sprints und konfigurierbare Workflows schon aus. Offen war, ob es Ticket-Typen (Aufgabe, Bug, Story …), Story Points oder eine Hierarchie oberhalb der Projekte geben soll. Als Vorbild für den Umgang mit Projekten dient das Task-Board des Nutzers ([ADR-0010](0010-layout-nach-task-board.md)).

## Entscheidung

- **Ein Ticket ist ein Ticket.** Es gibt keine Ticket-Typen, keine Epics, keine Sprints, keine Story Points, keine Schätzungen und keine Zeiterfassung.
- **Projekte sind die einzige Ordnungsebene** mit eigenem Nummernkreis (`<CODE>-<NR>`, CLAUDE.md §5). Wie im Task-Board gibt es:
  - eine eigene Projektansicht mit dem Umschalter „Aufgaben | Projekte“,
  - Projekt-Kacheln mit den Anzahlen „aktiv“ und „gesamt“ und ab E4 „neu“,
  - einen Klick auf eine Kachel, der die Tickets des Projekts öffnet,
  - in der Aufgabenansicht die Auswahl (Filter) und Gruppierung nach Projekt.
- **Tags** sind die freie, projektübergreifende Einordnung (etwa „Einkauf“, „Auto“). Sie ersetzen Labels, Komponenten und Typen.
- **Status** bleiben die fünf festen Werte aus CLAUDE.md §5. Es gibt keinen konfigurierbaren Workflow und keine Übergangsregeln.
- **Priorität** bleibt die einzige Gewichtung (vier feste Stufen).
- Sub-Tickets (`parent`) bleiben Stufe 2 und sind keine Epics: höchstens eine Ebene, ohne eigenen Typ (CLAUDE.md §5, §10).
- Das Datenmodell ändert sich nicht. Es gibt kein Feld `type`, und eine spätere Einführung wäre eine neue Produktentscheidung mit eigener ADR.

## Alternativen

- **Ticket-Typen (Aufgabe, Bug, Idee):** Sie bringen Auswahlaufwand bei jeder Anlage, ohne dass der Typ im privaten Alltag eine Rolle spielt. Tags decken das bei Bedarf ab. Verworfen.
- **Epics als Ebene über Projekten:** Sie doppeln die Projekte und verlangen eine zweite Navigationsebene. Verworfen.
- **Sprints oder Story Points:** Planungsrituale für Teams, ohne Nutzen für eine private Ticketliste. Verworfen (schon CLAUDE.md §10).

## Konsequenzen

- Anlage- und Panel-Formulare bleiben kurz: Titel, Status, Priorität, Fälligkeit, Projekt, Tags, Beschreibung.
- Filter, Sortierung und Gruppierung in E3 kennen nur Status, Priorität, Fälligkeit, Projekt, Tag, Erstellt und ab E4 Quelle bzw. Kanal.
- CLAUDE.md §10 nennt Ticket-Typen und Story Points ausdrücklich unter „Nicht umsetzen“.

## Nachtrag (2026-09-28): Unteraufgaben freigegeben

Der Text oben bleibt unverändert. Der Nutzer hat am 2026-09-28 ausdrücklich angewiesen, die Sub-Tickets jetzt umzusetzen (CLAUDE.md §10, „nur auf ausdrückliche Anweisung“). Sie heißen in der Oberfläche **Unteraufgaben**.

- Die Festlegung „keine Epics, höchstens eine Ebene, ohne eigenen Typ“ bleibt. Eine Unteraufgabe ist ein normales Ticket mit `parent`.
- Umfang, Regeln und die Wirkung von `blocks_parent` stehen in [ADR-0033](0033-unteraufgaben.md), die Pakete im [Plan Unteraufgaben](../plan/unteraufgaben.md).
- Das Datenmodell ändert sich nicht; es gibt weiter kein Feld `type`.
- Die Konsequenz „Anlage- und Panel-Formulare bleiben kurz“ gilt weiter: Das Panel bekommt den Abschnitt „Unteraufgaben“ und die Zeile „Übergeordnet“, aber kein neues Pflichtfeld.

## Nachtrag (2026-09-28): Unterprojekte als Gliederung, keine Epics

Der Text oben bleibt unverändert. Der Nutzer hat am 2026-09-28 Unterprojekte freigegeben. Sie präzisieren „Projekte sind die einzige Ordnungsebene mit eigenem Nummernkreis“ und heben die Ablehnung der Epics nicht auf:

- Ein Unterprojekt **ist ein Projekt** mit dem optionalen Feld `parent`: genau eine Ebene (Projekt → Unterprojekt), im selben Scope, mit **eigenem Code und eigenem Nummernkreis** (`GART-3`). Die Ordnungsebene mit Nummernkreis bleibt also das Projekt.
- **Unterprojekte dienen nur der Gliederung.** Sie haben keinen Status, keinen Fortschritt, keine Laufzeit und keine Bündelung über Projekte hinweg. Sie sind damit **keine Epics**: Ein Epic ist eine Arbeitseinheit, die Tickets quer über Projekte bündelt und „erledigt“ wird; ein Unterprojekt liegt in genau einem Oberprojekt und kennt nur „archiviert“.
- „Epics als Ebene über Projekten“ bleibt verworfen, ebenso jedes Roll-up von Status, Fortschritt oder Zeitplänen. Aggregiert werden nur die Anzahlen der Tickets (aktiv, gesamt, neu), mit dem Hinweis „davon direkt“.
- Einzelheiten stehen in [ADR-0034](0034-unterprojekte.md), die Pakete im [Plan Unterprojekte](../plan/unterprojekte.md).
