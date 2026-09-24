# ADR-0015: „Neu“-Markierung pro Nutzer

- **Status:** Angenommen
- **Datum:** 2026-09-25
- **Entscheidung durch:** Advisor
- **Ergänzt:** [ADR-0010](0010-layout-nach-task-board.md) („neu“ auf den Projektkacheln), T-17 im [E3-Plan](../plan/e3.md)

## Kontext

ADR-0010 sieht auf den Projektkacheln und am Umschalter „Projekte“ eine Zahl „neu“ vor. T-17 im E3-Plan hat das Datenmodell an E4 übergeben, weil erst Kanäle Tickets erzeugen, die der Nutzer noch nicht angesehen hat.

Wann ist etwas „neu“?

- **Eingangseinträge** sind bis zur Entscheidung ungesichtet. Ihr Zustand `new` ([ADR-0014](0014-datenmodell-eingang.md)) genügt als Merkmal; ein eigenes Lesemodell ist dort unnötig.
- **Tickets** sind neu, wenn der Nutzer sie nicht selbst einzeln angelegt und noch nicht geöffnet hat. In E4 betrifft das gesammelt umgewandelte Tickets (sie wurden nur mit Standardwerten angelegt), ab E7 Tickets anderer Haushaltsmitglieder.
- Die Markierung gilt **pro Nutzer**: Im Haushalt (E7) hat jeder seinen eigenen Lesestand.

## Entscheidung

1. **Collection `ticket_reads`:** `user` (relation `users`, Pflicht, Cascade), `ticket` (relation `tickets`, Pflicht, Cascade), `seen_at` (date). Eindeutiger Index `(user, ticket)`. Regeln: list/view/create/delete nur mit `user = @request.auth.id`, create zusätzlich nur für sichtbare Tickets (Regel wie `tickets` über `ticket.`), update `null`.
2. **Grundlinie am Nutzer:** neues Feld `users.unread_since` (date). Die Migration setzt es für bestehende Nutzer auf den Migrationszeitpunkt; für neue Nutzer gilt ein leerer Wert als `created`. Ein Ticket ist für Nutzer U **neu**, wenn `ticket.created >= U.unread_since`, der Status nicht `done` ist und es keine Zeile `(U, ticket)` gibt. So erscheinen nach der Migration keine Altbestände als neu, ohne dass Lesezeilen für alle vorhandenen Tickets geschrieben werden (keine Datenmigration, [ADR-0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md)).
3. **Als gelesen gilt ein Ticket,** sobald der Nutzer es im Panel öffnet oder selbst einzeln anlegt (Formular, Schnellerfassung, einzelnes Umwandeln). Der Client schreibt dann die Lesezeile (idempotent; ein Konflikt am eindeutigen Index gilt als Erfolg). Gesammelt umgewandelte Tickets bekommen keine Zeile und sind damit neu.
4. **„Alle als gelesen markieren“** setzt `users.unread_since` auf jetzt und löscht die dann überflüssigen eigenen Lesezeilen nicht (sie schaden nicht, sie fallen mit dem Ticket weg).
5. **Anzeige:** Punkt vor dem Key mit unsichtbarem Text „neu“ und `title="Neu"`, Zahl „N neu“ auf der Projektkachel und am Umschalter „Projekte“, Zahl der neuen Eingangseinträge am Umschalter „Eingang“. Farbe nur zusätzlich zum Text ([ADR-0010](0010-layout-nach-task-board.md) §3); keine Signalfarbe.
6. **Laden und Realtime:** Der `TicketListStore` lädt beim Start die eigenen Lesezeilen der offenen Tickets mit `created >= unread_since` (Filter über `ticket.status`/`ticket.created`) und abonniert `ticket_reads/*` (eigene Zeilen per Regel). Die Markierung ist ein `$derived` aus Map und Lesemenge; ein zweiter Tab folgt über das Abo.

## Alternativen

- **Feld `seen_by` (Mehrfachrelation) am Ticket:** Jedes Öffnen wäre ein Ticket-Update mit neuem `updated`, Realtime-Event an alle und Konflikten mit der Update-Reihenfolge ([ADR-0006](0006-frontend-zustand-und-datenzugriff.md) §5). Verworfen.
- **Nur Grundlinie ohne Lesezeilen** („neu seit letztem Besuch“): Ein einzeln geöffnetes Ticket bliebe neu, bis der Nutzer alle als gelesen markiert. Verworfen.
- **Lesestand in `localStorage`:** geht bei anderem Browser oder Gerät verloren (E7). Verworfen.
- **Lesezeilen per Migration für alle Alt-Tickets:** Datenmigration ohne Nutzen, weil die Grundlinie dasselbe leistet. Verworfen.

## Konsequenzen

- Eine neue Collection und ein neues Feld an `users` (additiv). Negativtests: Lesezeilen fremder Nutzer weder sichtbar noch anlegbar, Lesezeile für ein unsichtbares Ticket abgelehnt.
- Öffnen eines neuen Tickets kostet eine lokale Anfrage. Bereits gelesene Tickets verursachen keine.
- Die Zahl „neu“ ist eine reine Funktion (`isNew(ticket, reads, unreadSince)`), unit-testbar mit Grenzfällen (`created` gleich Grundlinie, erledigt, gelöscht).
