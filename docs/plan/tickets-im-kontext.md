# Plan „Tickets im Kontext“

- **Stand:** KX-1 umgesetzt (2026-10-02, #233), KX-2 umgesetzt (2026-10-02, #234), KX-3 umgesetzt (2026-10-02, Branch `feat/kx-3-calendar-context`); nur Oberfläche: Build, dann F5, kein Neustart. Offen sind die manuellen Prüfungen (Test-Manifest, Block „Tickets im Kontext“).
- **Grundlage:** Nutzerwunsch „Tickets sollen auch aus ihrem Bezug heraus geöffnet werden können … aus dem Projektbereich heraus und wo es sonst noch auftreten könnte“; Option C mit „Alle Empfehlungen so umsetzen“ (2026-10-02).
- **Entscheidungen:** [ADR-0054](../adr/0054-tickets-im-kontext-oeffnen.md); Nachträge zu [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) (17), [ADR-0034](../adr/0034-unterprojekte.md), [ADR-0037](../adr/0037-papierkorb.md), [ADR-0042](../adr/0042-tickets-und-projekte-aus-listen-waehlen.md) und [ADR-0053](../adr/0053-kalenderansicht.md).
- **Einordnung:** Manifest-Block „Tickets im Kontext“ ab `BYL-E6-1300` (KX-1 `BYL-E6-1300` bis `BYL-E6-1311`, manuell `BYL-E6-1310` und `BYL-E6-1311`; KX-2 `BYL-E6-1320` bis `BYL-E6-1330`, manuell `BYL-E6-1329` und `BYL-E6-1330`; KX-3 `BYL-E6-1340` bis `BYL-E6-1346`, manuell `BYL-E6-1346`). Keine Migration, keine Hooks.

## 1. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| KX-1 | Gastgeber für Projekte, Eingang und Wiederholungen; Routen-Hüllen `…/tickets/[id]` und `…/voll`; Herkunft als `von`, das Ticket ersetzt das offene Panel, × zur Herkunft; `ticketLinks().path` folgt dem Gastgeber; Markierung der Ansichten nur mit eigenen IDs; Projekte ohne `listUrl`; Projektpfad zum Projekt-Panel; Papierkorb mit „Öffnen“ im Flag | umgesetzt |
| KX-2 | Fokus zurück auf den auslösenden Link; Links auf Tickets in Beschreibung und Kommentaren im Kontext; „Änderungen verwerfen?“ inline in Projekt- und Regel-Panel beim Ersetzen; „Gesammelt umwandeln“ schließt sich beim Klick; „Zurück zu …“ in den Einstellungen | umgesetzt |
| KX-3 | Kalender: geplante Termine und Termine des Eingangs neben dem Kalender (falls sauber einbindbar, sonst Folgepunkt); „Ticket ansehen“ der Schnellerfassung im Kontext | umgesetzt (sauber einbindbar, §7) |

## 2. Routen und Gastgeber (KX-1)

| Bereich | Panel | Vollansicht | Gastgeber | Rückweg ohne Herkunft | Rückweg mit `von` |
|---|---|---|---|---|---|
| Projekte | `/projekte/tickets/<id>` | `…/voll` | `PROJECTS_HOST` | `/projekte?<Ansicht>` | `/projekte/<von>?<Ansicht>` |
| Eingang | `/eingang/tickets/<id>` | `…/voll` | `INBOX_HOST` | `/eingang?<Chips>` | `/eingang/<von>?<Chips>` |
| Wiederholungen | `/wiederholungen/tickets/<id>` | `…/voll` | `RECURRENCES_HOST` | `/wiederholungen` | `/wiederholungen/<von>` |

- **Zustand der Ansicht** in der Adresse: Projekte `q`, `sort`, `archiviert`, `darstellung`; Eingang `quelle`, `zustand`, `zielprojekt`, `gruppe`; Wiederholungen keiner. Dahinter `von=<Record-ID>`.
- **Herkunft** (`ticketOriginFrom`): auf `/projekte/<id>` (bzw. Eintrag, Regel) diese ID, auf einem Ticket des Bereichs `von`; sonst keine. Beispiel: im Projekt-Panel von „Haus“ wird ein Ticket zu `/projekte/tickets/<ticket>?q=Haus&von=<haus>`.
- **Layouts:** setzen den Gastgeber (`setTicketHost`), markieren `host.activeIn(page)` (nie eine Ticket-ID) und zeigen die Panel-Spalte nach `host.panelShown(route)`; die Projekte schließen das Panel eines Tickets, das über sein Menü in den Papierkorb geht.

## 3. Stellen (KX-1)

| Stelle | vorher | nachher |
|---|---|---|
| Offene Tickets der Projektliste und des Projekt-Panels (`ProjectTicketList`) | `/tickets/<id>?projekt=<id>` (`listUrl`) | `/projekte/tickets/<id>?<Ansicht>[&von=<projekt>]` |
| Menü „•••“ eines offenen Tickets | „Im Seitenpanel/In Vollansicht öffnen“ mit `?projekt=` | im Bereich über den Gastgeber |
| Duplikat aus dem Menü in Projekten | `links.path` → „Aufgaben“ | `links.href(id, page.url)` → Projekte |
| Eingang: Panel, Tabelle, Chips, Duplikat-Hinweis, Ergebnisse von Datei-Import, Erfassen und „Gesammelt umwandeln“ | `links.path` → `/tickets/<id>` | `links.path` → `/eingang/tickets/<id>?<Chips>[&von=<eintrag>]` |
| Wiederholungen: Tabelle, Menü der Zeile, Regel-Panel, „Neue Regel“ | `links.path` → `/tickets/<id>` | `links.path` → `/wiederholungen/tickets/<id>[?von=<regel>]` |
| Pfad „Haus › Garten“ im Kopf | `/?projekt=<id>` | `/projekte/<id>` |
| Papierkorb „Wiederherstellen“ (Vorschau) | `goto(links.path)` zum Ticket | zurück nach `/papierkorb`, Flag mit „Öffnen“ |
| Papierkorb „Wiederherstellen“ (Zeile) | Flag ohne Aktion | Flag mit „Öffnen“ |
| Bewusst global | „Link kopieren“, „Alle N in Aufgaben öffnen“, „Tickets anzeigen“, App-Name, „Neues Ticket“ | unverändert |

## 4. Tests (KX-1)

| Art | Datei | Inhalt |
|---|---|---|
| Unit | `web/src/lib/ticket-host.test.ts` | Herkunft, Adressen, Rückweg, Routen, Markierung, Panel-Spalte, Link für den Fokus; `ticketLinks()` mit `TicketLinksHarness` |
| Komponente | `web/src/lib/components/area-ticket-route.test.ts` | je Bereich: Panel, Vollansicht, × zur Herkunft bzw. Ansicht, „Zu den …“, Fokus nach der Vollansicht (`AreaTicketRouteHarness`) |
| Route | `web/src/routes/(app)/projekte/projects-layout.test.ts`, `web/src/routes/(app)/wiederholungen/recurrences-layout.test.ts` | Ticket ersetzt das Panel, Markierung der Herkunft, nie Ticket-IDs gezählt, Vollansicht ohne Spalte, Links im Bereich, Papierkorb schließt das Ticket |
| Route | `web/src/routes/(app)/papierkorb/trash-route.test.ts` | „Wiederherstellen“ bleibt, „Öffnen“ im Flag |
| angepasst | `project-ticket-list.test.ts`, `inbox-panel.test.ts`, `ticket-panel.test.ts`, `trash.test.ts`, `help-page.test.ts` | Links im Bereich, Pfad, Flag, Hilfe |

## 5. Manuelle Prüfungen (KX-1)

Öffnen, Ersetzen und Zurück in allen drei Bereichen mit Panel und gemerkter Vollansicht, Deep-Link und F5, schmale Fenster; Papierkorb mit „Öffnen“, Projektpfad, die globalen Ausnahmen (Test-Manifest `BYL-E6-1310`, `BYL-E6-1311`).

## 6. KX-2: Rückweg, Fragen und Links in Texten

| Stelle | vorher | nachher |
|---|---|---|
| Fokus nach × bzw. Esc eines Tickets in einem Bereich | Überschrift des Panels der Herkunft bzw. verloren | der auslösende Link (Panel der Herkunft, sonst Ansicht), ohne Link die Überschrift (`followTicketReturn`, `initialFocus`) |
| Link ersetzt ein Projekt- oder Regel-Panel mit ungespeicherten Eingaben | Eingaben gingen still verloren | inline „Änderungen verwerfen?“ (bzw. „Neues Projekt verwerfen?“, „Neue Regel verwerfen?“) oben im Panel |
| Link auf ein Ticket in Beschreibung, Kommentar, „Kopiert aus …“, Vorschau im Papierkorb | Router nach `/tickets/<id>` („Aufgaben“, Panel) | Klick ohne Zusatztaste: `ticketLinks().href(id, page.url)` im Kontext und gemerkten Modus; gespeichert und für neue Tabs `/tickets/<id>` |
| „Angelegte Tickets“ in „Gesammelt umwandeln“ | Modal blieb offen, Ticket darunter | das Modal schließt sich beim Klick (ohne Zusatztaste) |
| „Zurück zu …“ in den Einstellungen | Wiederholungen und Papierkorb: „Zurück zu Aufgaben“ | „Zurück zu Wiederholungen“, „Zurück zur Regel“, „Zurück zum Papierkorb“; Tickets der Bereiche „Zurück zu KEY“ |

| Art | Datei | Inhalt |
|---|---|---|
| Unit | `web/src/lib/ticket-return.test.ts` (`TicketReturnHarness`) | welche Navigation der Rückweg ist, Link im Panel bzw. in der Ansicht, Fokus in der Ansicht nur bei verlorenem Fokus, das Layout folgt seinen Navigationen |
| Route | `web/src/routes/(app)/projekte/projects-layout.test.ts` | × aus dem Projekt-Panel bzw. aus der Liste: Fokus auf dem Link |
| Komponente | `project-panel.test.ts`, `recurrence-panel.test.ts`, `inbox-panel.test.ts` | Fokus beim Öffnen auf dem Link; Frage inline, „Verwerfen“, „Weiter bearbeiten“, Esc, Zurück im Browser, ohne Frage bei Query, Speichern, × und Löschen |
| Komponente | `markdown-view.test.ts` | Klick auf einen Link zu einem Ticket im Kontext, mit Zusatztaste oder mittlerer Taste und auf anderen Links nicht |
| Komponente | `bulk-convert-dialog.test.ts` | schließt sich beim Öffnen eines Tickets, nicht für einen neuen Tab |
| Unit | `last-view.test.ts` | Texte von „Zurück zu …“ |
| angepasst | `inbox-table.test.ts`, `recurrences-layout.test.ts`, `help-page.test.ts` | `data-ticket-link`, Hilfe |

Manuell: Fokus und Screenreader beim Rückweg; Fragen beim Ersetzen, Links in Texten, „Gesammelt umwandeln“, „Zurück zu …“ (Test-Manifest `BYL-E6-1329`, `BYL-E6-1330`).

## 7. KX-3: Kalender und Schnellerfassung

**Bewertung:** Regel- und Eingangs-Panel lassen sich sauber einbinden. `RecurrencePanel` und `InboxPanel` hängen nur an den Stores des `(app)`-Layouts und an Props; die Teile ihrer Routen liegen jetzt in `RuleRoute` und `InboxItemRoute` (`back`, `section`), die `/wiederholungen/<id>`, `/eingang/<id>` und die neuen Routen des Kalenders teilen. Kein Folgepunkt nötig.

| Stelle | vorher | nachher |
|---|---|---|
| Geplanter Termin im Kalender | `/wiederholungen/<regel>` (Bereich „Wiederholungen“) | `/kalender/wiederholungen/<regel>?<Kalender>` neben dem Kalender, Termine markiert |
| Termin des Eingangs im Kalender | `/eingang/<eintrag>` (Bereich „Eingang“) | `/kalender/eingang/<eintrag>?<Kalender>` neben dem Kalender, Termin markiert |
| Ticket aus Regel bzw. Eintrag neben dem Kalender | (gab es nicht; im Bereich `…?von=<id>`) | `/kalender/tickets/<id>?<Kalender>&von=regel-<regel>` bzw. `von=eintrag-<eintrag>`; × zurück zur Regel bzw. zum Eintrag, Fokus auf dem Link dort |
| × von Regel bzw. Eintrag neben dem Kalender | – | `/kalender?<Kalender>`, Fokus auf den (ersten) Termin |
| „Ticket ansehen“ der Schnellerfassung | `openMode.path` → `/tickets/<id>` („Aufgaben“) | `ticketHrefIn`: in der Ansicht der aktuellen Route mit ihrem Zustand und an Stelle eines offenen Panels; aus Einstellungen und Papierkorb weiter `/tickets/<id>` |
| „Zurück zu …“ in den Einstellungen | `/kalender/…`: „Zurück zum Kalender“ | Regel bzw. Eintrag neben dem Kalender: „Zurück zur Regel“, „Zurück zum Eintrag“ |

- **Herkunft im Kalender:** zwei Arten, deshalb `von=regel-<id>` bzw. `von=eintrag-<id>` (`calendarOriginFrom`, streng: auf `/kalender/wiederholungen/<id>` bzw. `/kalender/eingang/<id>` diese, auf einem Ticket genau ein `von` dieser Form). `CALENDAR_HOST` ist ein `OriginTicketHost` wie die Bereiche; `entryOf(id, url)` findet mit Herkunft den Link im Panel.
- **Kalender-Layout:** `followTicketReturn(CALENDAR_HOST)`; `activeId` nur auf den Routen eines Tickets, `activeRuleId` bzw. `activeItemId` auf denen von Regel bzw. Eintrag; Panel-Spalte für alle drei.

| Art | Datei | Inhalt |
|---|---|---|
| Unit | `web/src/lib/ticket-host.test.ts` | Herkunft im Kalender (beide Arten, strenge Form), Adressen mit Zustand, Rückweg, Link im Panel, `ticketHrefIn` je Route und ohne Ansicht |
| Unit | `web/src/lib/ticket-return.test.ts` | Rückweg zur Regel neben dem Kalender, Fokus im Kalender |
| Komponente | `web/src/lib/components/calendar/calendar-view.test.ts` | Links der Termine neben den Kalender, Markierung, Fokus nach dem Schließen, kein Fokus, wenn ein Ticket folgt |
| Route | `web/src/routes/(app)/kalender/kalender-layout.test.ts` (`CalendarRouteHarness` mit echter Regel- und Eintrags-Route) | Regel und Eintrag neben dem Kalender, Markierung, Titel, Ticket-Link der Regel mit `von=regel-…`, × zum Kalender mit Zustand |
| Unit | `last-view.test.ts` | „Zurück zur Regel“, „Zurück zum Eintrag“ neben dem Kalender |
| angepasst | `help-page.test.ts` | Hilfe Kalender und „Wo öffnet sich ein Ticket?“ |

Manuell: Regel und Eintrag neben dem Kalender, Ticket an ihrer Stelle und zurück mit Fokus, „Ticket ansehen“ in verschiedenen Ansichten (Test-Manifest `BYL-E6-1346`).
