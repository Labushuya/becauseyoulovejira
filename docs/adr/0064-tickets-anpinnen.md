# ADR-0064: Tickets anpinnen – persönliche Pins und der Abschnitt „Angeheftet“

- **Status:** Angenommen und umgesetzt (Paket PIN-1); manuelle Prüfungen im Test-Manifest (BYL-E6-1520 bis BYL-E6-1524)
- **Datum:** 2026-10-05
- **Entscheidung durch:** Nutzer (Tickets anheften, damit sie immer oben stehen, etwa ein großes, lange gewachsenes Ticket, an dem gerade gearbeitet wird; persönlich je Konto, auch im Haushalt; Abschnitt „Angeheftet“ ganz oben, unabhängig von Filter-Karten und Detail-Filtern, nur im aktiven Bereich, einklappbar je Gerät, keine Doppelung; Reihenfolge nach dem Anheften, älteste oben; Umschalter in Zeile und Detail; Erledigen und Papierkorb lösen für alle; kein Umsortieren), Advisor (Akzeptanzkriterien: eigene Collection mit Regeln wie die Tickets, Hooks, Realtime, Tests, Wiederverwendung für einen späteren Tagesplan), Executor (Datenmodell, Einzelheiten der Oberfläche)
- **Bezug:** [ADR-0015](0015-neu-markierung-pro-nutzer.md) (Zeilen je Nutzer und Ticket, `ticket_reads`), [ADR-0037](0037-papierkorb.md) (Papierkorb), [ADR-0058](0058-haushalt-mitgliedschaft-einladungen-rechte.md) §5 (Haushaltsdaten nur über die Mitgliedschaft), [ADR-0059](0059-bereiche-privat-und-haushalt.md) (Bereiche), [ADR-0060](0060-einheitliche-eingabeelemente.md) (Knöpfe, 44 px am Handy), [ADR-0061](0061-verschieben-zwischen-bereichen-und-aufloesen.md) (Verschieben), [ADR-0062](0062-charms.md) (Symbole aus Lucide), [ADR-0044](0044-kommentare-reihenfolge-anpinnen-einklappen.md) (angepinnter Kommentar, ein anderes Ding), [ADR-0013](0013-filter-suche-sortierung-gruppierung.md) (Filter im Client)

## Kontext

Die Tabelle „Aufgaben“ ordnet nach Fälligkeit, Priorität und Filtern. Ein Ticket, an dem man über Wochen arbeitet, rutscht dabei nach unten oder verschwindet hinter einem Filter. Der Nutzer will es anheften: Es soll immer oben stehen, nur für ihn, und von selbst gehen, wenn es erledigt ist. Ein späteres Paket „Tagesplan“ soll die Pins als Vorschläge nutzen.

Den „angepinnten Kommentar“ eines Tickets gibt es schon ([ADR-0044](0044-kommentare-reihenfolge-anpinnen-einklappen.md)); er gehört dem Ticket, nicht dem Konto, und bleibt unverändert. In der Oberfläche heißt das Neue deshalb „anheften“ und „Angeheftet“.

## Entscheidung

### 1. Datenmodell (Migration `1790204500_ticket_pins.js`)

Neue Collection **`ticket_pins`**: `user` (Relation `users`, Pflicht, Kaskade), `ticket` (Relation `tickets`, Pflicht, Kaskade), `created` (Autodate, Zeitpunkt des Anheftens). Eindeutig je (user, ticket) (`idx_ticket_pins_user_ticket`), Index auf `ticket`. Ein Pin hat kein `owner`, `household` oder `scope`: Er gehört dem Konto über `user` (wie `ticket_reads`), seine Sichtbarkeit folgt dem Ticket. Dasselbe Ticket kann von mehreren Mitgliedern angeheftet sein, jedes Konto hat seine eigene Zeile.

| Regel | Wert |
|---|---|
| list, view | angemeldet, `user = @request.auth.id`, das Ticket sichtbar (Zweig der Tickets seit 1790203900: Besitzer eines privaten oder Mitglied des Haushalts) und nicht im Papierkorb (`ticket.deleted_at = ""`) |
| create | angemeldet, `@request.body.user = @request.auth.id`, dasselbe für das Ticket |
| update | `null` (ein Pin ändert sich nie) |
| delete | angemeldet, `user = @request.auth.id` |

Damit sieht niemand die Pins eines anderen, und wer einen Haushalt verlässt, liest seine Pins auf dessen Tickets sofort nicht mehr. Die Migration ist additiv (Rückweg: die Collection geht mit ihren Zeilen); `storage-rules` zählt die Tabelle zur Gruppe „Tickets“.

### 2. Server

- **Kein Pin auf einem erledigten Ticket:** `pins.pb.js` lehnt das Anlegen für jeden Schreiber mit `validation_pin_done` am Feld `ticket` ab („Erledigte Tickets lassen sich nicht anheften.“, rein `lib/pin-rules.js`, gleich in `domain/pins.ts`, Paritätstest).
- **Erledigen löst für alle:** Der Update-Hook von `tickets` löscht in seiner Transaktion jeden Pin eines Tickets, das `done` wird (`pin-rules.releasesPins`), auch die von „Unteraufgaben mit erledigen“ über deren eigenes Speichern. Wiedereröffnen heftet nicht neu an.
- **Papierkorb löst für alle:** `trash-service.trashOne` löscht die Pins jedes Tickets der Gruppe, bevor es verborgen wird (so sehen die Regeln das `delete` noch). Wiederherstellen heftet nicht neu an.
- **Austritt:** Ein Modell-Hook auf `household_members` (Löschen) entfernt in derselben Transaktion die Pins des Kontos auf den Tickets dieses Haushalts: Austreten, Entfernen, Auflösen und das Löschen eines verwaisten Haushalts. Beim Auflösen mit „übernehmen“ sind die Tickets dann schon privat beim Inhaber, seine Pins bleiben.
- **Verschieben:** Nach dem Verschieben (ADR-0061) bleibt ein Pin, solange sein Konto das Ticket weiter sieht (`pin-rules.seesTicket`: Besitzer eines privaten, Mitglied des Haushalts); die übrigen Pins der verschobenen Tickets gehen in derselben Transaktion (`pin-service.releaseUnseen`).
- Jeder dieser Wege löscht über `txApp.delete`, also bekommen die Tabs des Kontos das `delete` per Realtime nach dem Commit. Vor der Migration fehlt die Collection, und kein Hook tut etwas (`pinsReady`).

### 3. Oberfläche

- **Datenschicht** `data/pins.ts`: `listPins` (eigene Pins, `created,id`), `pinTicket` (ein vorhandener Pin zählt als Erfolg, Antwort `null`), `unpinTicket` (ein fehlender zählt als Erfolg); `subscribePins` in `data/realtime.ts`.
- **`PinStore`** (`stores/pins.svelte.ts`) im `(app)`-Layout vor der Liste: lädt die Pins des Kontos einmal je Sitzung, folgt per Realtime (andere Tabs, vom Server gelöste Pins) und lädt nach einer Wiederverbindung neu. `toggle` heftet an oder löst, ohne optimistische Anzeige; eine Ablehnung ist ein Fehler-Flag mit Grund. Solange die Liste scheitert (vor dem Neustart), ist der Store nicht `available`, und keine Ansicht bietet Anheften an.
- **Bereich:** Die Pins kommen aus allen Bereichen (sie tragen keinen Inhalt außer der Ticket-ID). Gezeigt werden nur die, deren Ticket der `TicketListStore` des Tabs kennt, also die offenen Tickets des aktiven Bereichs. So bleibt ein Pin nach dem Verschieben eines Tickets in den anderen Bereich ohne neue Abfrage richtig.
- **Abschnitt „Angeheftet“** (`TicketTable`): das erste `tbody` der Tabelle, vor Gruppen und Liste, mit einem Kopf wie eine Gruppe (Disclosure-Knopf mit `aria-expanded`, Pin-Symbol, Zahl). Er zeigt `TicketListStore.pinned`: die offenen angehefteten Tickets des Bereichs in der Reihenfolge des Anheftens (älteste oben, gleiche Zeit nach ID), unabhängig von Filter-Karten, Detail-Filtern, Suche, Sortierung und Gruppierung, auch beim Statusfilter „Erledigt“. Zugeklappt wird je Gerät (`localStorage` `byl-pinned-folded`, nur `1`). Sie stehen nicht noch einmal darunter (`visible` und `groups` ohne sie); die Zahl der Abschnittsleiste nennt die übrigen und „+ N angeheftet“. Steht unter dem Abschnitt nichts mehr, sagt die Tabelle „Keine weiteren Tickets für diese Filter.“ mit „Filter zurücksetzen“ bzw. „Keine weiteren offenen Tickets.“ statt eines leeren Zustands darüber. Die Kopf-Checkbox wählt wie bisher alle Tickets, die die Filter durchlassen, also auch angeheftete, die passen; ein angeheftetes, das die Filter ausblenden, wählt nur seine eigene Checkbox.
- **Offene Tickets eines Projekts** (`ProjectTicketList`, Liste und Projekt-Panel): zuerst die angehefteten des Projekts als eigene Liste „Angeheftet in „Haus““ (sichtbares Etikett „Angeheftet“), außerhalb der Grenze von zehn, dann die übrigen; „Alle N in Aufgaben öffnen“ zählt alle.
- **Umschalter** `TicketPinToggle`: ein `.button-icon` mit gleichbleibendem Namen „HAUS-12 anheften“ und `aria-pressed` (APG „Button“), Tooltip „Anheften“ bzw. „Lösen“, Pin-Symbol, angeheftet ausgefüllt in `--color-brand-text`. In den Zeilen am Ende der Titelzelle bzw. vor „•••“ der offenen Tickets eines Projekts, also weg vom Charm vor dem Titel ([ADR-0062](0062-charms.md)); dort in `--control-height-s`, damit die Zeile ihre Höhe behält. Wo ein Zeiger schweben kann (`hover: hover`), erscheint er beim Zeigen auf die Zeile und mit dem Fokus (er bleibt in der Tab-Reihenfolge), angeheftet immer; auf Touch-Bildschirmen immer und 44 px (`--control-height-touch`). Im Kopf von Panel und Vollansicht steht er immer vor „•••“. Während der Anfrage `aria-busy` und gesperrt. Ein erledigtes Ticket bietet kein Anheften an. Nach dem Klick steht die Zeile im anderen Abschnitt, und der Fokus folgt ihr auf ihren Umschalter.
- **Symbol:** „pin“ aus Lucide 1.52.0 (ISC) ohne Abhängigkeit in `domain/pin-icon.ts`, im Raster der Charms; die Lizenzdatei `charm-icons.LICENSE.txt` nennt beide Dateien.

### 4. Wiederverwendung für einen Tagesplan

- Abfrage ohne Store: `listPins(pb)` aus `data/pins.ts`.
- Im `(app)`-Layout: `findPinStore()` gibt den `PinStore`; `ticketIds` ist die Reihenfolge des Anheftens, `isPinned(id)` die Frage je Ticket.
- Tickets dazu: `pinnedTickets(ids, find)` aus `domain/pins.ts` mit `TicketListStore.find` bzw. direkt `TicketListStore.pinned` (offene Tickets des Bereichs).

## Alternativen

| Alternative | Bewertung |
|---|---|
| Feld am Ticket (`pinned`, Mehrfach-Relation auf Konten) | Jede Änderung wäre ein Update des Tickets mit Verlauf, Realtime an alle Mitglieder und `updated`; persönliche Pins würden für alle sichtbar. Verworfen. |
| Pins in `localStorage` | Nicht in allen Tabs und Geräten des Kontos, kein Lösen beim Erledigen durch ein anderes Mitglied. Verworfen. |
| Pins je Bereich filtern (Abfrage über `ticket.scope`) | Ein verschobenes Ticket nähme seinen Pin nicht in die Liste des anderen Bereichs mit, Realtime meldet die Änderung am Ticket nicht am Pin. Die Liste des Bereichs filtert ohnehin. |
| Abschnitt als eigene Tabelle über der Tabelle | Andere Spalten und Breiten als die Liste darunter, doppelte Spaltenköpfe. Ein `tbody` in derselben Tabelle nutzt dieselben Zeilen, Zellen, Menüs und die Auswahl. |
| Angeheftete Tickets zusätzlich in der Liste lassen | Der Nutzer will keine Doppelung. |
| Umsortieren per Ziehen | Nicht Teil des Pakets (Nutzer). |
| Pin auch auf erledigten Tickets | Erledigen löst ohnehin; ein Pin auf einem erledigten Ticket stünde in keinem Abschnitt. Der Server lehnt ihn ab. |

## Konsequenzen

- **Neustart nötig** (`neu-starten.bat`): Migration `1790204500` und Hooks; die Oberfläche nach dem Build und F5. Bis dahin fehlen Knopf und Abschnitt, alles andere läuft wie vorher.
- Neue Module: `app/pb_hooks/pins.pb.js`, `lib/pin-service.js`, `lib/pin-rules.js`; `web/src/lib/data/pins.ts`, `domain/pins.ts`, `domain/pin-icon.ts`, `stores/pins.svelte.ts`, `components/TicketPinToggle.svelte`, `components/PinIcon.svelte`.
- Geändert: `tickets.pb.js` (Erledigen), `lib/trash-service.js` (Papierkorb), `lib/area-move-service.js` (Verschieben), `lib/storage-rules.js`; `TicketListStore` (`pins`, `pinned`, `pinnedInFilter`, `visible` ohne Pins), `TicketTable`, `TicketTableRow` (Snippet `pin`), `ProjectTicketList`, `TicketPanel`, `TicketFullViewRoute`, `(app)`-Layout, Hilfe.
- Tests: `tests/integration/pinned-tickets.test.mjs` (eigene Instanz: A und B im Haushalt, C allein; nur eigene Pins, keine fremden oder unsichtbaren Tickets, erledigt und Papierkorb mit Realtime, Austritt, Entfernen, Verschieben, mehrere Tabs), `migrations-rollback.test.mjs`, `tests/unit/pin-rules.test.mjs`; in `web/` Abschnitt, Umschalter, Projektliste, Panel, Store und Domain. Test-Manifest: BYL-E6-1510 bis BYL-E6-1517, manuell BYL-E6-1520 bis BYL-E6-1524.
