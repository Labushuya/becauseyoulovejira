# Plan: Tagesplan (TP-1)

Stand: 2026-10-05 · Entscheidung: [ADR-0065](../adr/0065-tagesplan.md) · Test-Manifest: Paket „TP-1“ (BYL-E6-1530 bis BYL-E6-1538, manuell BYL-E6-1540 bis BYL-E6-1549)

## Zweck

Der Tagesplan ist die Brücke zwischen den klar sichtbaren Aufgaben eines Tages und lang laufenden Vorhaben, die sonst im Pool untergehen: ein Sprachkurs über 200 Stunden, ein großes, gewachsenes Ticket. Er **schlägt vor**; der Nutzer stellt die Vorschläge ein, übernimmt sie, greift von Hand ein und passt den Plan jederzeit an.

## Umfang von TP-1 (umgesetzt)

| Bereich | Inhalt |
|---|---|
| A) Zwei Pläne | Privat ein Plan je Konto und Tag; im Haushalt ein gemeinsamer je Haushalt und Tag, alle Mitglieder gleichberechtigt, live, Initialen für „hinzugefügt“ und „abgehakt“. Der Plan des aktiven Bereichs; ein Hinweis nennt nur die Zahl der Einträge im anderen Bereich und bietet den Wechsel. |
| B) Anker „Art“ | `tickets.kind`: „Aufgabe“ (Standard) oder „Laufendes Vorhaben“, gesetzt im Detail (Schalter) und im Menü eines Eintrags, sichtbar als Abzeichen „Vorhaben“. Haken bei einer Aufgabe: das Ticket ist erledigt (Weg der Liste, mit Wiederholung, Verlauf, Pins; „Rückgängig“ öffnet es wieder). Haken bei einem Vorhaben: „für heute erledigt“, das Ticket bleibt offen; Abschließen nur über „Vorhaben abschließen …“ mit Rückfrage. Pins sind keine Quelle. |
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

- Duplizieren übernimmt die Art nicht; das Duplikat ist eine Aufgabe.
- Die Einstellungen der Quellen erscheinen in einem anderen offenen Tab erst beim nächsten Abruf des Plans (Wechsel des Tages oder des Bereichs, Neuverbinden).
