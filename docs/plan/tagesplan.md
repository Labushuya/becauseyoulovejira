# Plan: Tagesplan (TP-1)

Stand: 2026-10-13 (TP-5) · Entscheidung: [ADR-0065](../adr/0065-tagesplan.md) · Test-Manifest: Paket „TP-1“ (BYL-E6-1530 bis BYL-E6-1538, manuell BYL-E6-1540 bis BYL-E6-1549)

## Zweck

Der Tagesplan ist die Brücke zwischen den klar sichtbaren Aufgaben eines Tages und lang laufenden Vorhaben, die sonst im Pool untergehen: ein Sprachkurs über 200 Stunden, ein großes, gewachsenes Ticket. Er **schlägt vor**; der Nutzer stellt die Vorschläge ein, übernimmt sie, greift von Hand ein und passt den Plan jederzeit an.

## Umfang von TP-1 (umgesetzt)

| Bereich | Inhalt |
|---|---|
| A) Zwei Pläne | Privat ein Plan je Konto und Tag; im Haushalt ein gemeinsamer je Haushalt und Tag, alle Mitglieder gleichberechtigt, live, Initialen für „hinzugefügt“ und „abgehakt“. Der Plan des aktiven Bereichs; ein Hinweis nennt nur die Zahl der Einträge im anderen Bereich und bietet den Wechsel. |
| B) Anker „Art“ | `tickets.kind`: „Aufgabe“ (Standard) oder „Laufendes Vorhaben“, gesetzt im Detail (Schalter) und im Menü eines Eintrags, sichtbar als Abzeichen „Vorhaben“. Haken bei einer Aufgabe: das Ticket ist erledigt (Weg der Liste, mit Wiederholung, Verlauf, Pins; „Rückgängig“ öffnet es wieder). Haken bei einem Vorhaben: „für heute erledigt“, das Ticket bleibt offen; Abschließen nur über „Vorhaben abschließen …“ mit Rückfrage. Pins sind reine Anzeige, weder Quelle noch Ausschlussgrund (klargestellt in PL-1). |
| C) Vorschläge | Sechs Quellen, je aus, vorschlagen oder automatisch übernehmen: Laufende Vorhaben (automatisch), Heute fällig, Überfällig, Wiederholung von heute, Übrig von gestern, In Arbeit (je vorschlagen). Grund je Vorschlag; „Übernehmen“ und „Alle übernehmen“; Automatisches steht beim ersten Öffnen des Tages im Plan (träge, idempotent, parallel sicher). |
| D) Eingreifen | Seite `/tagesplan` mit Kopf, Vorschlägen, Plan und Pool (Suche, „+“, Ziehen); „Zum Tagesplan“ in jedem Menü eines Tickets; Reihenfolge per Ziehen und Tastatur; je Eintrag abhaken, „Auf morgen schieben“, „Entfernen“, Art umstellen; Pfeile über die Tage, vergangene schreibgeschützt, morgen planbar; Charm und Abzeichen im Plan. |

Wie es gebaut ist (Datenmodell, Routen, Regeln, Realtime) steht in [ADR-0065](../adr/0065-tagesplan.md).

## Für später (nicht umgesetzt, nur festgehalten)

Diese Punkte hat der Nutzer zu TP-1 genannt und ausdrücklich zurückgestellt. Jeder braucht eine eigene Freigabe und ein eigenes Paket.

1. **Zeiten und Zeitfenster.** Einträge bekommen eine Uhrzeit oder ein Fenster („9–11 Uhr“), der Plan wird zu einer Tagesleiste. Offen: ob das Fenster am Eintrag (nur dieser Tag) oder am Ticket (wiederkehrend) hängt, und wie es mit Fälligkeiten zusammenspielt, die heute reine Kalenderdaten sind ([ADR-0005](../adr/0005-zeitzone-europe-berlin.md)).
2. **Verfügbarkeit im Haushalt** wie der Terminplanungs-Assistent in Outlook: wer im Haushalt wann Zeit hat, als Raster über den Tag. Setzt Zeitfenster (1) und eine Zuständigkeit je Eintrag voraus.
3. **Haushaltsaufgaben im privaten Zeitplan sichtbar machen,** ohne die Bereichsgrenzen aufzuweichen ([ADR-0059](../adr/0059-bereiche-privat-und-haushalt.md)): etwa als belegte Zeit ohne Inhalt oder als ausdrücklich geteilter Eintrag. Wird erst mit Zeitfenstern relevant; heute nennt der Hinweis nur die Zahl der Einträge des anderen Bereichs.
4. **Rhythmus je Vorhaben** (etwa Mo/Mi/Fr): Ein laufendes Vorhaben kommt nur an seinen Tagen automatisch in den Plan. Die Rechenregeln der Wochentage gibt es schon für Wiederholungen ([ADR-0021](../adr/0021-regelmodell-wiederkehrende-aufgaben.md)); offen ist, wo der Rhythmus gespeichert wird (am Ticket oder in den Einstellungen der Quelle).
5. **Ziel und Fortschritt je Vorhaben** (etwa 47/200 Stunden): Abhaken für heute könnte eine Menge buchen. Abgrenzung zur Zeiterfassung, die laut CLAUDE.md §10 nicht umgesetzt wird, ist vorher mit dem Nutzer zu klären.
6. **Quelle „Mir zugewiesen“** (kommt mit E7-5 „Zuständigkeit“, [Plan E7](e7-haushalt.md)): Tickets, die einem Mitglied zugewiesen sind, als weitere Quelle mit denselben drei Modi. Die Einstellungen der Quellen sind ein JSON-Feld; eine neue Quelle braucht dort keine Migration, nur die Regel in `day-plan-rules.js` und ihren Spiegel.

## Offene Punkte aus TP-1

Beide erledigt mit PL-1 ([ADR-0065](../adr/0065-tagesplan.md), Nachtrag PL-1):

- ~~Duplizieren übernimmt die Art nicht.~~ Das Duplikat übernimmt die Art seines Originals wie den Charm.
- ~~Die Einstellungen der Quellen erscheinen in einem anderen offenen Tab erst beim nächsten Abruf.~~ Sie erscheinen live in anderen Tabs und bei den anderen Mitgliedern des Haushalts.

## TP-2 (umgesetzt): Unteraufgaben mit ihrem übergeordneten Ticket

Nutzerwunsch vom 2026-10-12: Unteraufgaben standen im Plan ohne Zusammenhang. Seit TP-2 steht in Plan, Pool und Vorschlägen über jeder Unteraufgabe klein ihr übergeordnetes Ticket („HAUS-7 › Wochenputz“, der Key öffnet es); gruppiert wird nicht, die Reihenfolge bleibt frei. Entscheidung in [ADR-0065](../adr/0065-tagesplan.md), Nachtrag TP-2; Test-Manifest: Paket „TP-2“ (BYL-E6-1672 bis BYL-E6-1674, manuell BYL-E6-1675 bis BYL-E6-1679). Die Entscheidung „keine Gruppierung“ hat der Nutzer mit TP-3 aufgehoben.

## TP-3 (umgesetzt): Hauptticket mit Unteraufgaben darunter, Pool-Suche über das Hauptticket

Nutzerwunsch vom 2026-10-12: Unteraufgaben sollen im Tagesplan so stehen wie in „Aufgaben“, das Hauptticket und direkt darunter seine Unteraufgaben in derselben Reihenfolge, und die Pool-Suche soll sie auch über Key und Titel des Haupttickets finden. Damit hebt der Nutzer TP-2 E2 („keine Gruppierung“) auf.

| Bereich | Inhalt |
|---|---|
| Pool | Angeordnet wie „Aufgaben“: Hauptticket, darunter eingerückt mit Ecke seine Unteraufgaben im Pool; steht das Hauptticket nicht im Pool, die Unteraufgabe einzeln mit der Kontextzeile aus TP-2. Die Grenze von 60 Einträgen nimmt ein Hauptticket mit seinen Unteraufgaben ganz oder gar nicht. |
| Vorschläge | Ebenso angeordnet, wenn Hauptticket und Unteraufgabe vorgeschlagen sind; der Haken am Hauptticket wählt keine Unteraufgabe mit; „Übernehmen“ und „Alle übernehmen“ in der gezeigten Reihenfolge. |
| Plan | Nur Anzeige: Die Reihenfolge bleibt die des Nutzers; eine Unteraufgabe direkt unter ihrem Hauptticket oder einer eingerückten Schwester steht eingerückt, sonst mit Kontextzeile. Ziehen, Knöpfe und `Alt`+Pfeil wie bisher (seit TP-4 wandert ein Hauptticket mit seinem Block). |
| Fortschritt | Der Chip „1/4“ der Tabelle an jedem Hauptticket in Plan, Pool und Vorschlägen, mit demselben Baustein und denselben Zahlen. |
| Suche | Jedes Wort in Key oder Titel des Tickets oder seines Haupttickets, verteilt erlaubt; „…“ zählt nicht; ein umbenanntes Hauptticket wirkt sofort. „Aufgaben“ und die Ticket-Auswahl suchen weiter nur im Ticket. |

Entscheidung in [ADR-0065](../adr/0065-tagesplan.md), Nachtrag TP-3, und [ADR-0033](../adr/0033-unteraufgaben.md), Nachtrag TP-3; Test-Manifest: Paket „TP-3“ (BYL-E6-1715 bis BYL-E6-1720, manuell BYL-E6-1721 bis BYL-E6-1725). Nur Oberfläche: nach dem Build F5.

~~**Folgt mit TP-4 (Server):** wie der Server einen neuen Eintrag im Plan einordnet (etwa eine Unteraufgabe direkt unter ihr Hauptticket, das schon im Plan steht) und in welcher Reihenfolge „Automatisch übernehmen“ einfügt.~~ Umgesetzt mit TP-4 (unten).

## TP-4 (umgesetzt): Unteraufgaben landen unter ihrem Hauptticket, das Hauptticket zieht seinen Block mit

Bis TP-4 hängte der Server jeden neuen Eintrag ans Ende, und ein gezogenes Hauptticket ließ seine Unteraufgaben stehen. Jetzt ordnet der Server neue Einträge ein, und das Hauptticket nimmt seine Unteraufgaben mit.

| Bereich | Inhalt |
|---|---|
| Einordnen | Eine Unteraufgabe, deren Hauptticket im Plan steht, kommt in dessen Block (Hauptticket mit den eingerückten Unteraufgaben direkt darunter) an die Stelle, die ihr unter den Geschwistern nach der Reihenfolge von „Aufgaben“ zukommt; ohne Block hinter die letzte Schwester unter dem Hauptticket, sonst direkt hinter das Hauptticket. Ein Hauptticket, dessen Unteraufgaben im Plan stehen, kommt direkt vor die erste davon. Alles andere kommt ans Ende. Nur eingefügt, nichts umsortiert. |
| Geltung | „+“ und „Zum Tagesplan“ (auch in „Neues Ticket“), „Übernehmen“ (nacheinander in der gezeigten Reihenfolge), „Automatisch übernehmen“ und „Auf morgen schieben“. Ein Ablegen an einer Stelle gewinnt immer. |
| Block ziehen | Ein Hauptticket wandert mit seinen eingerückten Unteraufgaben, per Griff, „nach oben“, „nach unten“ und `Alt`+Pfeil; Knöpfe und Tastatur heben es über den ganzen Nachbarn. Eine Unteraufgabe bewegt sich einzeln und darf ihren Block verlassen. Ansage etwa „HAUS-7 mit 2 Unteraufgaben an Stelle 3 von 7 verschoben.“ |
| Server | Neue Route `POST /api/byl/dayplan/order` (mehrere Einträge in einer Transaktion, nicht genannte behalten ihren Platz; seit TP-5 auch für „Als manuelle Reihenfolge übernehmen“). `items`, `adopt` und `tomorrow` antworten mit allen Positionen. Der Plan nennt `supports.order`. |
| Vor dem Neustart | Ohne `supports.order` bewegt sich ein Hauptticket einzeln wie bisher, ohne Fehler; ohne Positionen in den Antworten landen neue Einträge am Ende wie bisher. |

Entscheidung in [ADR-0065](../adr/0065-tagesplan.md), Nachtrag TP-4; Test-Manifest: Paket „TP-4“ (BYL-E6-1726 bis BYL-E6-1731, manuell BYL-E6-1732 bis BYL-E6-1736). Keine Migration; **Neustart nötig** (Hooks), die Oberfläche nach dem Build mit F5.

## TP-5 (umgesetzt): Sortieren wie in „Aufgaben“

Nutzerwunsch: Im Tagesplan einfach nach Priorität, Status, Fälligkeit usw. sortieren können wie in „Aufgaben“; die manuelle Reihenfolge bleibt erhalten und lässt sich weiter anpassen. Sortieren ist eine **Ansicht**, kein Umschreiben: Das verträgt sich mit dem Ziehen und mit dem gemeinsamen Plan im Haushalt.

| Bereich | Inhalt |
|---|---|
| Steuerelement | „Sortierung“ im Kopf des Plans (Menü): „Manuell“ (Standard), „Priorität“, „Status“, „Fälligkeit“, „Titel“, „Projekt“, im Haushalt „Zuständigkeit“. Sortiert daneben „Aufsteigend \| Absteigend“; jedes Kriterium beginnt mit der Richtung des ersten Klicks in „Aufgaben“ (Priorität: dringende zuerst). Am Handy 44 px. |
| Hierarchie | Hauptticket und seine Unteraufgaben im Plan bleiben eine Einheit, sortiert nach dem Hauptticket, die Unteraufgaben eingerückt darunter und untereinander genauso sortiert; eine Unteraufgabe ohne Hauptticket im Plan steht für sich mit Kontextzeile. Gleichstand: die manuelle Reihenfolge; ohne Wert (Fälligkeit, Projekt, Zuständigkeit) zuletzt. Abgehaktes und Erledigtes steht in jeder Sortierung am Ende, untereinander ebenfalls sortiert. |
| Ziehen | Nur in „Manuell“: Sortiert sind Griff, „nach oben“, „nach unten“ und `Alt`+Pfeil weg, der Hinweis sagt „Zum Verschieben auf „Manuell“ umstellen.“; „Manuell“ zeigt die gespeicherte Reihenfolge sofort wieder. Ein Ticket aus dem Pool kommt auch in den sortierten Plan, ohne Stelle. |
| Übernehmen | „Als manuelle Reihenfolge übernehmen“ schreibt die angezeigte Reihenfolge über die Route `order` (ganzer Plan) und stellt auf „Manuell“; „Rückgängig“ holt die Reihenfolge von vorher zurück. Nur in einem änderbaren Plan und mit `supports.order` (nach dem Neustart nach TP-4). Fehler setzen zurück, mit Meldung. |
| Speichern | Je Gerät in `localStorage` `byl-dayplan-sort`, für alle Tage; im Haushalt sieht jede Person ihre eigene Ansicht. |
| Nicht betroffen | Pool und Vorschläge bleiben wie in TP-3. |

Entscheidung in [ADR-0065](../adr/0065-tagesplan.md), Nachtrag TP-5; Test-Manifest: Paket „TP-5“ (BYL-E6-1737 bis BYL-E6-1742, manuell BYL-E6-1743 bis BYL-E6-1747). Nur Oberfläche, kein Hook, keine Migration: nach dem Build F5.
