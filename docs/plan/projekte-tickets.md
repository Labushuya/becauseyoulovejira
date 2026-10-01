# Plan „Offene Tickets in Projekten“

- **Stand:** PT-1 umgesetzt (2026-10-01, Branch `feat/project-open-tickets`, nur Oberfläche: Build, dann F5; kein Neustart, keine Migration). Offen sind die manuellen Browser-Prüfungen BYL-E6-970 und BYL-E6-971.
- **Grundlage:** Nutzerwunsch (freigegeben): Tickets, die Projekten zugeordnet sind, sollen in der Projekt-Oberfläche sichtbar sein, ohne erst „Tickets anzeigen“ zu klicken. Vorgaben des Advisors, vom Nutzer bestätigt: aufklappbare Zeilen der Projektliste mit den offenen Tickets, Unterprojekte nach dem Baum, höchstens 10 je Projekt mit „Alle N in Aufgaben öffnen“, Öffnen im gemerkten Modus, Zeilenmenü falls ohne Mehraufwand, Abschnitt im Projekt-Panel, „Alle aufklappen“ und „Alle zuklappen“ je Gerät gemerkt, keine Liste in den Kacheln, Daten aus dem `TicketListStore`, keine Bearbeitung, keine Sammelaktionen, keine eigenen Filter.
- **Entscheidungen:** [ADR-0034](../adr/0034-unterprojekte.md), Nachtrag „Offene Tickets in Projekten“; Datenweg wie [ADR-0042](../adr/0042-tickets-und-projekte-aus-listen-waehlen.md) §4 (Nachtrag); Zeilenmenü nach [ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) (Nachträge „Aktionsmenüs“ und „Rechtsklick“), Spalten unverändert nach [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md).
- **Einordnung:** Manifest-Block „Offene Tickets in Projekten“ ab `BYL-E6-960` (vorgesehen war `BYL-E6-920`; die Sicherung belegt seit BK-3 `BYL-E6-920` bis `BYL-E6-930` und auf ihrem Branch `BYL-E6-940` ff.).

## 1. Paket

| Paket | Inhalt | Stand |
|---|---|---|
| PT-1 | Aufklappbare Zeilen der Projektliste mit den offenen Tickets (Unterprojekte unter ihrer Zeile), „Alle aufklappen“ und „Alle zuklappen“, gemerkt je Gerät; Abschnitt „Offene Tickets“ im Projekt-Panel; Zeilenmenü und Rechtsklick der Einträge; Hilfe, README | umgesetzt |

## 2. Projektliste

### 2.1 Aufklappen

- **Knopf:** vor dem Code jeder Zeile, `.button-icon` mit Pfeil, Name „Offene Tickets von „Haus““ (fest, der Zustand steht in `aria-expanded`), `title` „Offene Tickets anzeigen“ bzw. „… ausblenden“, `aria-controls` auf die Zelle der Liste, solange sie offen ist. Der Knopf „Unterprojekte von Haus“ bleibt in der Namenszelle; zwei gleiche Pfeile direkt nebeneinander wären verwechselbar.
- **Darunter:** eine Zeile über die volle Breite (`colspan`) mit dunklerer Fläche (`--color-bg`), die Liste eingerückt unter den Namen (Breite der Spalte „Code“), bei einem Unterprojekt um 1,75rem mehr wie sein Name. So folgen auf „Haus“ seine eigenen Tickets, dann „Garten“ mit seinen.
- **Oberprojekt:** zeigt nur seine eigenen Tickets („Offene Tickets direkt in „Haus““), weil die Unterprojekte ihre eigenen unter ihrer Zeile zeigen; seine Zahlen bleiben die mit den Unterprojekten (ADR-0034 §6). Der Link „Alle N …“ nimmt dann `unterprojekte=0`, damit „Aufgaben“ dieselben N zeigt.
- **Fokus:** bleibt auf dem Knopf (APG „Disclosure“); die Liste folgt in der Lesereihenfolge nach der Zeile, Tab führt hinein.
- **Gerendert** wird nur eine offene Zeile; eine geschlossene hat keine Liste im DOM.

### 2.2 „Alle aufklappen“ und „Alle zuklappen“

- Über der Liste (nur in der Darstellung „Liste“) die Gruppe „Offene Tickets“ mit zwei `.button-subtle`. „Alle aufklappen“ öffnet alle Projekte der Liste, auch zugeklappte Unterprojekte (sie zeigen ihre Tickets, sobald sie aufgeklappt sind); „Alle zuklappen“ schließt alle Zeilen. Ist nichts zu tun, trägt der Knopf `aria-disabled` (der Fokus bleibt, nichts geschieht).
- **Gemerkt** je Gerät in `localStorage` `byl-projects-tickets` (JSON-Liste der Projekt-IDs in der Reihenfolge des Öffnens, höchstens 500, die zuerst geöffneten fallen weg; nur gültige IDs; leer entfernt den Schlüssel), andere Tabs gleichen über das `storage`-Ereignis ab. Ein gesperrter oder voller Speicher bricht nichts, die Wahl gilt dann für die Seite (`ProjectTicketsDisclosure` in `stores/project-tickets.svelte.ts`, rein `readOpenProjectTickets`/`writeOpenProjectTickets` in `domain/project-tickets.ts`). Anders als das Zuklappen der Unterprojekte (je Tab, `sessionStorage`) ist das eine Vorliebe des Geräts wie die Spalten.

### 2.3 Liste

| Teil | Darstellung |
|---|---|
| Key und Titel | ein Link (`data-row-link`), Key in Mono gedämpft, Titel höchstens 2 Zeilen (`title` ab 60 Zeichen) |
| Status | `StatusPill`, für Screenreader mit „Status:“ davor |
| Priorität | `PriorityIcon` („Priorität: Hoch“ verborgen, als `title`) |
| Fälligkeit | `DueLabel` (relativ, nie rot), mit „Fällig:“ davor, ohne Datum „keine Fälligkeit“ |
| Aktionen | „•••“ wie in „Aufgaben“ (siehe §4) |

- **Reihenfolge:** Fälligkeit (ohne am Ende), dann Priorität (dringend zuerst), dann Key (Nummer numerisch), dann ID (`compareProjectTickets`).
- **Grenze:** höchstens 10 (`PROJECT_TICKETS_LIMIT`), danach „Alle N in Aufgaben öffnen“ auf `/?projekt=<id>` (bzw. mit `unterprojekte=0`). Bei höchstens 10 gibt es den Link nicht; „Tickets anzeigen“ steht weiter im Menü der Zeile und im Panel.
- **Leer:** `EmptyState compact` „Keine offenen Tickets“ (Oberprojekt: „… direkt in „Haus““); laden: „Offene Tickets werden geladen …“ (`role="status"`); Ladefehler: „Die offenen Tickets ließen sich nicht laden.“ als `.alert-error` (die Ansicht nennt den Grund mit „Erneut versuchen“ oben).
- **Kein seitliches Scrollen** (ADR-0030): Ein Eintrag ist eine Flex-Zeile mit Umbruch. Key und Titel stehen zuerst (Grundbreite 14rem), Status, Priorität, Fälligkeit und „•••“ als Block mit festen Plätzen daneben, auf schmaler Breite (etwa im Panel) rechtsbündig darunter. Keine Container-Queries, keine neue Tabelle, keine Spalte der Projektliste ändert sich.
- **Bewusst nicht:** Bearbeiten in Zellen, Häkchen, Auswahl, Sammelaktionen, Filter oder Sortierung in der Liste; dafür gibt es „Aufgaben“.

### 2.4 Öffnen

- Ein Klick auf Key oder Titel öffnet das Ticket im gemerkten Modus (`ticketLinks().href`, ADR-0036 §1; unter 64rem das Panel). Der Link trägt die Liste des Projekts als Zustand (`?projekt=<id>`), so steht beim Schließen in „Aufgaben“ das Projekt als Filter; die Suche der Projektansicht (`q`) geht nicht mit, weil `q` dort die Suche der Tickets wäre.
- Damit verlässt der Klick die Projektansicht wie die Links der Wiederholungen; Zurück im Browser führt zurück, die offenen Zeilen bleiben gemerkt.

## 3. Projekt-Panel

- Abschnitt „Offene Tickets“ (`h3`, `tabindex="-1"`) nach dem Formular, vor „Unterprojekte“ und „Archiv“, mit derselben Liste und derselben Grenze (`ProjectOpenTickets`, über das Snippet `openTickets` von `ProjectPanel`).
- **Oberprojekt mit Unterprojekten:** zuerst „Haus“ (`h4`, die eigenen Tickets, „direkt in“), dann je Unterprojekt „Haus › Garten GART“ (`h4`) mit seinen Tickets, eingerückt um 1,75rem; ein archiviertes Unterprojekt nur, solange es offene Tickets hat, mit „(archiviert)“.
- **Unterprojekt und Projekt ohne Unterprojekte:** nur die eigene Liste.

## 4. Zeilenmenü und Rechtsklick

- **Wiederverwendet ohne neuen Baustein:** jeder Eintrag endet mit `TicketActions` (AM-2) mit „Im Seitenpanel öffnen“, „In Vollansicht öffnen“ (beide mit dem Projekt als Zustand, sie merken nichts), „Link kopieren“, „Duplizieren …“ (mit `TicketDuplicateStore`) und „In den Papierkorb …“, über den `TicketRowActionsStore` des `(app)`-Layouts. Die Fragen öffnet das Layout `/projekte` genau einmal für Liste und Panel als Dialog (`TicketRowDialogs`, dafür aus `TicketTable` herausgelöst und dort ebenso benutzt). Die Projektansicht ist kein Modal und das Panel ein nicht modaler Drawer, also kein Dialog aus einem Dialog.
- **Rechtsklick, Umschalt+F10, Kontextmenü-Taste:** Ein Eintrag ist eine Menüzeile (`data-menu-row`), sein Link der Link der Zeile; `rowMenus` hängt schon an der Projektliste, im Panel an `ProjectOpenTickets`. Nebenbei korrigiert: `rowMenuOf` nimmt nur den Knopf „•••“ der Zeile selbst, nicht den einer darin geschachtelten Zeile; sonst öffnete ein Rechtsklick neben den Einträgen (in der Zeile der Liste) das Menü des ersten Eintrags. Dort bleibt jetzt das Menü des Browsers.
- **Fokus, wenn ein Eintrag geht:** Verlässt der fokussierte Eintrag die Liste (erledigt, in den Papierkorb, anderes Projekt, auch per Realtime), geht der Fokus an den Eintrag an seiner Stelle, sonst an den letzten, bei leerer Liste an den Knopf der Zeile bzw. die Überschrift „Offene Tickets“ im Panel.

## 5. Kacheln

- Keine Liste und kein zusätzlicher Zähler „N offen“: „N aktiv“ auf jeder Kachel ist bereits die Zahl der offenen Tickets (nicht erledigt, ADR-0034 §6, beim Oberprojekt mit den Unterprojekten). Ein Link darin ginge nicht (die ganze Kachel ist ein Link, ein Link im Link ist ungültig) und kostete je Kachel einen Tab-Stopp; „Tickets anzeigen“ steht im Menü der Kachel, und ein Klick auf die Kachel öffnet das Panel mit der Liste.

## 6. Daten und Last

- **Quelle:** `TicketListStore.open`, alle offenen Tickets samt Unteraufgaben, live per Realtime und nach dem Neuverbinden abgeglichen (ADR-0006, ADR-0007), derselbe Weg wie der `TicketPicker` (ADR-0042 §4). Keine Anfrage der Projektansicht; Tickets im Papierkorb erreichen den Client nie (ADR-0037 §3), erledigte verlassen `open` mit ihrem Ereignis. Unteraufgaben zählen wie in „aktiv“ mit.
- **Last:** Die Liste gruppiert alle offenen Tickets in einem Durchgang (`openTicketsByProject`, O(n) plus Sortieren je Projekt) in einem `$derived`, das nur gelesen wird, solange eine Zeile offen ist; das Panel filtert nur sein Projekt (`openTicketsOf`). Gerendert werden je offener Zeile höchstens 10 Einträge, jeder mit seinem Menü (wie eine Zeile in „Aufgaben“). Geprüft mit 5000 offenen Tickets in 50 Projekten (Unit); „Alle aufklappen“ bei vielen Projekten rendert höchstens 10 je Projekt.

## 7. Tests

- Unit: `domain/project-tickets.test.ts` (Reihenfolge, nur offene des Projekts, Gruppen, Grenze, 5000 Tickets, Texte, Speicher), `stores/project-tickets.test.ts` (gemerkt, alle auf und zu, andere Tabs, gesperrter Speicher), `overlay/context-menu.test.ts` (nur das Menü der eigenen Zeile).
- Komponente: `components/project-ticket-list.test.ts` (Liste, Grenze und Link, Oberprojekt, Öffnen im gemerkten Modus mit Projekt, leer, laden, Fehler, Menü und Rechtsklick, Warten, Fokus), `components/projects-view-tickets.test.ts` (Aufklappen mit Fokus, Unterprojekte, Link mit `unterprojekte=0`, Realtime, erledigt und Papierkorb, alle auf und zu, gemerkt, Kacheln, Rechtsklick neben den Einträgen), `routes/(app)/projekte/projects-layout.test.ts` (Panel, Gruppen der Unterprojekte, Frage als einziger Dialog des Layouts), Hilfe (`help-page.test.ts`); unverändert grün die Tests der Zeilenmenüs von „Aufgaben“ nach dem Herauslösen von `TicketRowDialogs`.
- Automatisiert: BYL-E6-960 bis BYL-E6-969. Manuell: BYL-E6-970 (Browser, Breiten, Tastatur, NVDA), BYL-E6-971 (zwei Tabs, live).
