# Plan „Tickets im Kontext“

- **Stand:** KX-1 umgesetzt (2026-10-02, Branch `feat/kx-1-ticket-hosts`); nur Oberfläche: Build, dann F5, kein Neustart. KX-2 und KX-3 folgen. Offen sind die manuellen Prüfungen (Test-Manifest, Block „Tickets im Kontext“).
- **Grundlage:** Nutzerwunsch „Tickets sollen auch aus ihrem Bezug heraus geöffnet werden können … aus dem Projektbereich heraus und wo es sonst noch auftreten könnte“; Option C mit „Alle Empfehlungen so umsetzen“ (2026-10-02).
- **Entscheidungen:** [ADR-0054](../adr/0054-tickets-im-kontext-oeffnen.md); Nachträge zu [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) (17), [ADR-0034](../adr/0034-unterprojekte.md), [ADR-0037](../adr/0037-papierkorb.md) und [ADR-0053](../adr/0053-kalenderansicht.md).
- **Einordnung:** Manifest-Block „Tickets im Kontext“ ab `BYL-E6-1300` (KX-1 `BYL-E6-1300` bis `BYL-E6-1311`, manuell `BYL-E6-1310` und `BYL-E6-1311`). Keine Migration, keine Hooks.

## 1. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| KX-1 | Gastgeber für Projekte, Eingang und Wiederholungen; Routen-Hüllen `…/tickets/[id]` und `…/voll`; Herkunft als `von`, das Ticket ersetzt das offene Panel, × zur Herkunft; `ticketLinks().path` folgt dem Gastgeber; Markierung der Ansichten nur mit eigenen IDs; Projekte ohne `listUrl`; Projektpfad zum Projekt-Panel; Papierkorb mit „Öffnen“ im Flag | umgesetzt |
| KX-2 | Fokus zurück auf den auslösenden Link; Links auf Tickets in Beschreibung und Kommentaren im Kontext; „Änderungen verwerfen?“ inline in Projekt- und Regel-Panel beim Ersetzen; „Gesammelt umwandeln“ schließt sich beim Klick; „Zurück zu …“ in den Einstellungen | offen |
| KX-3 | Kalender: geplante Termine und Termine des Eingangs neben dem Kalender (falls sauber einbindbar, sonst Folgepunkt); „Ticket ansehen“ der Schnellerfassung im Kontext | offen |

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
