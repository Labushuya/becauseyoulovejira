# Plan „Kalender“

- **Stand:** K-1 umgesetzt (2026-10-02, PR #230), K-2 umgesetzt (2026-10-02, Branch `feat/kalender-verschieben`); beides nur Oberfläche: Build, dann F5, kein Neustart. Offen sind die manuellen Prüfungen beider Pakete (Test-Manifest, Block „Kalender“).
- **Grundlage:** Nutzerwunsch („zusätzliche Kalenderansicht wie in Google Kalender mit verschiedenen Ansichten, man sieht, was wann ansteht; Tickets und Projekte farbig, die dann auch im Kalender so angezeigt werden“), Freigabe der Empfehlungen am 2026-10-02 („Alle Empfehlungen so umsetzen“): nur Datum ohne Uhrzeit, Farben aus dem Paket „Farben“ ([ADR-0052](../adr/0052-farben-fuer-projekte-und-tickets.md), vorher fertig), Verschieben per Ziehen als zweiter Schritt, beide Zusatz-Ebenen (künftige Wiederholungen, Termine im Eingang).
- **Entscheidungen:** [ADR-0053](../adr/0053-kalenderansicht.md).
- **Einordnung:** Manifest-Block „Kalender“ ab `BYL-E6-1250` (K-1 `BYL-E6-1250` bis `BYL-E6-1267`, manuell `BYL-E6-1264` bis `BYL-E6-1267`; K-2 `BYL-E6-1270` bis `BYL-E6-1283`, manuell `BYL-E6-1280` bis `BYL-E6-1283`). Keine Migration, keine Hooks.

## 1. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| K-1 | Hauptansicht „Kalender“ mit Monat, Woche und Agenda, Ebenen (offene und erledigte Tickets, künftige Wiederholungen, Termine im Eingang), Filter von „Aufgaben“, Zustand in URL und Gerät, Tickets im gemerkten Modus neben dem Kalender, Zeilenmenü mit Rechtsklick, APG-Grid, schmale Fenster, Hilfe, README | umgesetzt |
| K-2 | Verschieben per Ziehen (Monat und Woche) und per Tastatur bzw. Menü „Fälligkeit verschieben …“, Speichern mit `expected_updated`, Flag mit „Rückgängig“, Hinweis bei Serientickets, Touch-Entscheidung | umgesetzt |

## 2. K-1: Bausteine

| Teil | Datei |
|---|---|
| Zustand, Zeiträume, ISO-Wochen, Tastatur, Einträge, Filter, „Überfällig“, „+N weitere“ (rein) | `web/src/lib/domain/calendar.ts` |
| Projektion der Regeln (rein, mit `recurrence.ts` und `nextTicketOf`) | `web/src/lib/domain/calendar-plan.ts` |
| Erledigte Tickets je Zeitraum, Realtime | `web/src/lib/stores/calendar.svelte.ts` (`CalendarDoneStore`), `listDoneTicketsDue` in `web/src/lib/data/tickets.ts` |
| Ansicht und Ebenen je Gerät, schmales Fenster | `web/src/lib/stores/calendar-prefs.svelte.ts` (`CalendarPrefsStore`) |
| Ansicht, Raster, Agenda, Eintrag, „+N weitere“, Ebenen | `web/src/lib/components/calendar/` (`CalendarView`, `CalendarGrid`, `CalendarAgenda`, `CalendarEntry`, `CalendarMore`, `CalendarLayers`) |
| Routen | `web/src/routes/(app)/kalender/` (Layout mit `ViewWithPanel`, Panel `tickets/[id]`, Vollansicht `tickets/[id]/voll`) |
| Panel und Vollansicht an zwei Orten | `web/src/lib/ticket-host.ts` (`LIST_HOST`, `CALENDAR_HOST`), `TicketRouteLayout.svelte`, `TicketFullViewRoute.svelte`; die Routen unter `(tickets)` sind Hüllen |
| Umschalter, Filterleiste, Menü, Rückweg, Kürzel, Hilfe | `ViewSwitch` („Kalender“), `FilterBar` (`calendar`), `Popover`/`ActionsMenu`/`TicketActions` (`buttonTabindex`), `TicketPanel` (`listLabel`), `last-view` („Zurück zum Kalender“), `shortcuts.ts` (Gruppe „Kalender“), Hilfe `#kalender` |

## 3. Verhalten (Kurzfassung, Einzelheiten in ADR-0053)

- **Adresse:** `/kalender?ansicht=monat|woche|agenda&datum=JJJJ-MM-TT` plus die Filter von „Aufgaben“ (ohne `faellig` und `q`, die im Kalender nicht wirken). Ohne `ansicht` die gemerkte (`byl-calendar-view`), sonst Monat, unter 40rem Agenda.
- **Monat:** ISO-Wochen mit Nummer, höchstens vier Einträge je Tag, sonst drei und „+N weitere“ (Popover mit allen Einträgen des Tages, die Liste entsteht beim ersten Öffnen). Unter 6rem je Tag Punkte statt Titel.
- **Woche:** sieben Spalten, bis zwölf Einträge je Tag mit Key und Titel.
- **Agenda:** vier Wochen ab dem Tag, nur Tage mit Einträgen; liegt heute im Zeitraum, oben „Überfällig“.
- **Ebenen** (`byl-calendar-layers`, Standard offen, geplant, Eingang): offene Tickets; erledigte (gedämpft, nur dann geladen); künftige Wiederholungen (blass, gestrichelt, „erscheint am …“, Klick öffnet die Regel; keine pausierten; ohne Doppel); Termine im Eingang (neue Einträge mit Datum eines Termins, gedämpft, Klick öffnet den Eintrag).
- **Filter:** wie in „Aufgaben“; geplante Termine als das Ticket, das sie werden; Eingang nur nach Zielprojekt und Quelle, andere Filter blenden ihn aus.
- **Ticket öffnen:** neben dem Kalender im gemerkten Modus; × und Esc zurück in den Kalender mit Fokus auf den Eintrag.
- **Tastatur:** APG-Grid mit Roving-Tabindex; Pfeile, Pos1/Ende (mit Strg Monat), Bild auf/ab, Enter/F2 hinein, Esc heraus; Umschalt+F10 und Kontextmenü-Taste öffnen das Menü eines Tickets.
- **Überfällig:** fett, Uhr, „überfällig“, nie rot (Konvention der Tabelle, ADR-0009).

## 4. Datenwege

| Daten | Quelle | Wann |
|---|---|---|
| offene Tickets | `TicketListStore.open` (live) | immer, `loadOpen()` beim Öffnen des Kalenders |
| erledigte Tickets | `listDoneTicketsDue` über `CalendarDoneStore` (200 je Seite, höchstens 5 Seiten), Realtime auf `tickets` | nur mit Ebene „Erledigte Tickets“ oder Statusfilter „Erledigt“, nur für den Zeitraum |
| Regeln | `RecurrenceStore.rules` (live) | Ebene „Künftige Wiederholungen“; Projektion nur für den Zeitraum |
| Eingang | `InboxStore.newItems` (live) | Ebene „Termine im Eingang“ |

## 5. Tests

| Art | Datei | Inhalt |
|---|---|---|
| Unit | `web/src/lib/domain/calendar.test.ts` | URL, Gerät, ISO-Wochen, Monatsraster (4 bis 6 Wochen), Verschieben des Zeitraums (Monatsende, Schaltjahr), Tastatur, Namen, „+N weitere“, Einträge je Tag, Reihenfolge, Ebenen, Statusfilter, Filter für Tickets, Geplantes und Eingang, Berliner Tag eines Termins, „Überfällig“ |
| Unit | `web/src/lib/domain/calendar-plan.test.ts` | Projektion: Termine ab dem nächsten Ticket, Erscheinen, offenes Ticket hält zurück, keine Doppel (auch verschoben, erledigt), Nachholen, „Jeden Termin einzeln anlegen“, pausiert, wartend, „nach Erledigung“, Vorlage, Grenze je Regel, Texte „erscheint …“, Rechenzeit mit 2 000 Tickets und 50 Regeln |
| Unit | `web/src/lib/stores/calendar-store.test.ts` | erledigte Tickets: nur bei Bedarf, Seiten, Grenze, Abbruch, Fehler, Sitzung, Realtime (auch während des Ladens), Neuverbinden; Gerät: Ansicht, Ebenen, andere Tabs, Breite, gesperrter Speicher |
| Komponente | `web/src/lib/components/calendar/calendar-view.test.ts` | Raster mit Namen, Einträge mit Projekt, Farbe und „überfällig“, Geplantes und Eingang, „+N weitere“, Tastatur (Tage, Wochen, Enden, Zeitraum, hinein und heraus), Ansichten und URL, gemerkte Ansicht, Ebenen mit Laden der erledigten, Filter, Agenda mit „Überfällig“ und leerem Zustand, schmaler Monat, 2 000 Tickets, Menü mit Rechtsklick und Umschalt+F10, Fokus nach dem Panel |
| Komponente | `web/src/lib/components/calendar/calendar-ticket-route.test.ts` | Panel und Vollansicht neben dem Kalender: Adressen, Rückweg, Fokus auf den Eintrag, „Zum Kalender“, Gastgeber |
| Route | `web/src/routes/(app)/kalender/kalender-layout.test.ts` | Kalender ohne und mit Panel, Links in den Kalender, „In den Papierkorb …“ schließt das Panel, Laden der erledigten |
| Integration | `tests/integration/web-data-calendar.test.mjs` | `listDoneTicketsDue`: Zeitraum mit beiden Enden, nach Fälligkeit, nur eigene, nicht im Papierkorb |
| angepasst | `view-switch.test.ts`, `ticket-links.test.ts`, `last-view.test.ts`, `shortcuts.test.ts`, `help-menu.test.ts`, `help-page.test.ts` | „Kalender“ im Umschalter, Adressen, Rückweg, Kürzel, Hilfe |

## 6. Leistung

Messung (Node 24, `plannedOccurrences` und `entriesByDay`, 20 Läufe) mit 2 000 offenen Tickets über das Jahr und 50 Regeln (täglich bzw. zweimal wöchentlich):

| Ansicht | Median | Maximum | Einträge im Zeitraum |
|---|---|---|---|
| Monat | 3,4 ms | 6,7 ms | 1 077 |
| Woche | 0,5 ms | 0,6 ms | 100 |
| Agenda (4 Wochen) | 2,6 ms | 4,8 ms | 1 002 |

Ein Monat mit diesen Daten rendert in jsdom samt Laden der Stores in etwa 100 ms, der Wechsel zur Woche in etwa 35 ms; gerendert werden höchstens 42 Tage × 4 Einträge, die Listen hinter „+N weitere“ erst beim Öffnen. Die Tests prüfen das mit großzügigen Grenzen (`calendar-plan.test.ts`, `calendar-view.test.ts`); wie flüssig es im Browser ist, prüft ein manueller Fall.

## 7. Manuelle Prüfungen (K-1)

Ansichten im Browser, Ebenen, Filter, Tastatur und Screenreader, Farben in allen Themes, schmale Fenster, Panel und Vollansicht neben dem Kalender, Realtime in zwei Tabs, Leistung mit vielen Tickets (Test-Manifest, Block „Kalender“).

## 8. K-2: Fälligkeit verschieben (umgesetzt, Einzelheiten in ADR-0053 §12)

| Teil | Datei |
|---|---|
| Was sich verschiebt, Taste, Schwelle, Texte (rein) | `web/src/lib/domain/calendar.ts` (`isMovable`, `CALENDAR_MOVE_KEY`, `DRAG_THRESHOLD_PX`, `moveInstructions`, `SERIES_MOVE_HINT`) |
| Speichern, Flag, „Rückgängig“, Konflikt | `web/src/lib/stores/ticket-list.svelte.ts` (`moveDue`; `TicketListData.update` mit `expectedUpdated`) |
| Ziehen, Tastatur, Klick auf den Tag, Statuszeile | `web/src/lib/components/calendar/CalendarGrid.svelte` |
| Eintrag (`data-movable`, `draggable="false"`, `aria-keyshortcuts`, beschäftigt), Platz eines Eintrags (`EntryPlace`) | `web/src/lib/components/calendar/CalendarEntry.svelte` |
| Menüeintrag „Fälligkeit verschieben …“ | `web/src/lib/components/TicketActions.svelte` (`onmovedue`) |
| Kürzel, Hilfe | `shortcuts.ts` (`calendar-move`), Hilfe `#kalender` („Fälligkeit verschieben“) |

- **Maus:** offenes Ticket im Monat bzw. in der Woche auf einen anderen Tag des Zeitraums ziehen (ab 5 px, Esc bricht ab, der Klick danach öffnet nichts); der Tag unter dem Zeiger und das Ticket tragen einen gestrichelten Rahmen, die Statuszeile unter dem Raster sagt, was geschieht.
- **Ohne Maus:** „m“ auf dem Ticket oder „Fälligkeit verschieben …“ im Menü; Fokus auf dem Tag des Tickets, die Tasten des Rasters wählen (auch in anderen Zeiträumen), Enter oder ein Klick bzw. Tippen auf einen Tag setzt, Esc oder „Abbrechen“ lassen es. Danach Fokus auf dem Ticket am neuen Tag.
- **Speichern:** `moveDue` mit `expected_updated`; Flag „Fälligkeit von KEY auf TT.MM.JJJJ gesetzt.“ mit „Rückgängig“ (wieder mit `expected_updated`); bei Serientickets zusätzlich „Die Fälligkeit eines Tickets der Serie zu verschieben, verschiebt die Serie nicht.“; ein inzwischen geändertes Ticket bleibt mit einem Fehler-Flag.
- **Nicht verschiebbar:** erledigte Tickets, geplante Termine, Termine des Eingangs; nichts in der Agenda.
- **Touch und Stift ziehen nicht** (Konflikt mit dem Scrollen und dem Kontextmenü, ADR-0053 §12); dort führt das Menü zum selben Ziel.

### Tests (K-2)

| Art | Datei | Inhalt |
|---|---|---|
| Unit | `web/src/lib/domain/calendar.test.ts` | nur offene Tickets verschiebbar (auch überfällige), Texte der Statuszeile |
| Unit | `web/src/lib/stores/ticket-move-due.test.ts` | Speichern mit `expected_updated`, Flag, „Rückgängig“, Serienticket, Konflikt beim Verschieben und beim Zurücksetzen, zweites Verschieben, was nicht gesendet wird, andere Ablehnung |
| Komponente | `web/src/lib/components/calendar/calendar-move.test.ts` | Ziehen mit Rahmen, Statuszeile und „Rückgängig“; Schwelle, Esc, Klick nach dem Ziehen; nicht ziehbar (erledigt, geplant, Eingang, Touch); „m“, Tasten, Enter, Esc, „Abbrechen“, anderer Zeitraum; Menü und Klick auf den Tag; Serienticket; Konflikt; Agenda |
| Komponente | `web/src/lib/components/ticket-actions.test.ts` | „Fälligkeit verschieben …“ nach den Wegen zum Öffnen |
| Integration | `tests/integration/web-data-calendar.test.mjs` | Fälligkeit mit `expected_updated`, Ablehnung einer älteren Grundlage, „Rückgängig“; die Regel eines Serientickets bleibt |
| angepasst | `calendar-view.test.ts`, `shortcuts.test.ts`, `help-page.test.ts` | Menü mit dem neuen Eintrag, Kürzel „m“, Hilfe |

### Manuelle Prüfungen (K-2)

Ziehen mit der Maus im Browser, Tastatur und Screenreader beim Verschieben, Touch (Scrollen, Menü und Tippen), Konflikt mit zwei Tabs und Serienticket (Test-Manifest `BYL-E6-1280` bis `BYL-E6-1283`).
