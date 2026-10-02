# ADR-0054: Tickets im Kontext öffnen – Gastgeber für Projekte, Eingang und Wiederholungen, das Ticket ersetzt das Panel seiner Herkunft

- **Status:** Angenommen; KX-1 (Gastgeber, Routen, Herkunft in der Adresse, Projekte, Projektpfad, Papierkorb) umgesetzt nach [Plan „Tickets im Kontext“](../plan/tickets-im-kontext.md); KX-2 (Fokus auf dem auslösenden Link, Links in Beschreibung und Kommentaren, „Änderungen verwerfen?“ in Projekt- und Regel-Panel, „Gesammelt umwandeln“, „Zurück zu …“) und KX-3 (Kalender, Schnellerfassung) folgen
- **Datum:** 2026-10-02
- **Entscheidung durch:** Nutzer (Wunsch „Tickets sollen auch aus ihrem Bezug heraus geöffnet werden können … aus dem Projektbereich heraus und wo es sonst noch auftreten könnte“; Option C mit Freigabe „Alle Empfehlungen so umsetzen“), Advisor (Muster, Ersetzen statt Stapeln, Rückweg, globale Ausnahmen, Pakete), Executor (Format der Herkunft, Markierung der Ansichten, Einzelheiten)
- **Bezug:** [ADR-0025](0025-ui-konsistenz-overlay-system.md) (Seitenpanel, Vollansicht, kein Dialog aus einem Dialog; Nachtrag 17), [ADR-0034](0034-unterprojekte.md) (offene Tickets in Projekten; Nachtrag), [ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §1 (gemerkter Öffnungsmodus), [ADR-0037](0037-papierkorb.md) §9 (Papierkorb; Nachtrag), [ADR-0042](0042-tickets-und-projekte-aus-listen-waehlen.md) §5 (Links auf Tickets in Texten), [ADR-0053](0053-kalenderansicht.md) §6 (Gastgeber des Kalenders; Nachtrag)

## Kontext

Seit dem Kalender ([ADR-0053](0053-kalenderansicht.md) §6) öffnen Tickets dort neben der Ansicht: Ein Gastgeber im Kontext (`TicketHost`) nennt die Adressen von Panel und Vollansicht und den Rückweg, und `TicketRouteLayout` und `TicketFullViewRoute` sind dieselben Teile wie neben „Aufgaben“. Überall sonst führte ein Ticket-Link nach „Aufgaben“: die offenen Tickets der Projekte mit `?projekt=` als Zustand der Liste, die Links in Eingang und Wiederholungen über `ticketLinks().path` ohne Zustand, „Wiederherstellen“ im Papierkorb. Wer in einem Projekt, einem Eintrag oder einer Regel arbeitet, verlor dabei seinen Ort und kam mit × in die Liste.

Die Ansichten haben genau eine Panel-Spalte (`ViewWithPanel`, 30rem, ab 64rem eingebettet, darunter Overlay), und `PanelHost` merkt sich eine Schließ-Funktion. Die Stores des Tickets (Details, Kommentare, Quellen) liegen einmal im `(app)`-Layout; es gibt also nur eine Route eines Tickets zugleich.

## Entscheidung

### 1. Tickets öffnen im aktuellen Bereich

- Ein Ticket öffnet dort, wo es angeklickt wird: in „Aufgaben“, im Kalender, unter „Projekte“, im Eingang und unter „Wiederholungen“, jeweils im gemerkten Modus (Seitenpanel oder Vollansicht, [ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §1).
- **Bewusst global** (nach „Aufgaben“ bzw. ohne Ort) bleiben: „Link kopieren“ (absolut `/tickets/<id>`, für jeden Tab und zum Teilen), „Alle N in Aufgaben öffnen“ und „Tickets anzeigen“ (der Sprung in die gefilterte Liste ist ihr Zweck), der Name der App und „Neues Ticket“. Wo es keine eigene Ansicht gibt (Papierkorb, Einstellungen), führen Links nach „Aufgaben“.

### 2. Gastgeber der Bereiche, Herkunft in der Adresse

- **Routen** (Hüllen um `TicketRouteLayout` und `TicketFullViewRoute` wie im Kalender): `/projekte/tickets/[id]` (+ `/voll`), `/eingang/tickets/[id]` (+ `/voll`), `/wiederholungen/tickets/[id]` (+ `/voll`). Der feste Pfadteil `tickets` gewinnt gegen `[id]` der Bereiche; ein Record-ID hat 15 Zeichen, `tickets` nie.
- **Gastgeber** `PROJECTS_HOST`, `INBOX_HOST`, `RECURRENCES_HOST` in `lib/ticket-host.ts`, gesetzt von den Layouts der Bereiche. Sie nennen Adressen, Rückweg, den Text „Zu den Projekten“, „Zum Eingang“ bzw. „Zu den Wiederholungen“ (wenn das Ticket weg ist) und den Link für den Fokus.
- **Zustand der Ansicht:** Die Adressen tragen den Zustand der Ansicht des Bereichs: bei Projekten Suche, Sortierung, „Archivierte anzeigen“ und Darstellung (`q`, `sort`, `archiviert`, `darstellung`), im Eingang die Chips (`quelle`, `zustand`, `zielprojekt`, `gruppe`), bei Wiederholungen nichts. `q` bleibt hier die Suche der Projekte und ist nie die Suche der Tickets.
- **Ersetzen statt Stapeln:** Ist im Bereich ein Panel offen (Projekt-Panel, Eintrag, Regel-Panel), nimmt das Ticket die eine Panel-Spalte ein und ersetzt es. Die Adresse nennt dieses Panel als **Herkunft** im Parameter `von` mit der Record-ID des Projekts, Eintrags oder der Regel: `/projekte/tickets/<ticket>?q=Haus&von=<projekt>`. Gelesen wird streng (`ticketOriginFrom`): auf dem Panel eines Bereichs (`/projekte/<id>`) gilt dessen ID, auf einem Ticket des Bereichs der Parameter `von`; „neu“, „Erfassen“, die Ansicht, ein doppelter oder ein Wert ohne die Form einer Record-ID zählen nicht.
- **Rückweg:** × und Esc des Tickets führen genau zur Herkunft (`host.view`: Projekt-Panel, Eintrag bzw. Regel mit dem Zustand der Ansicht), ohne Herkunft (Deep-Link, Link aus der Ansicht ohne offenes Panel) zur Ansicht. Ein weiteres Ticket aus dem Ticket (Unteraufgabe, Übergeordnet, Duplikat) behält die Herkunft.
- **Vollansicht bleibt im Kontext** wie im Kalender: `…/tickets/<id>/voll` über der Ansicht des Bereichs, ohne Panel-Spalte (sie ersetzt das Panel, ADR-0036 §1); Schließen führt zur Herkunft bzw. zur Ansicht.
- **`ticketLinks().path` folgt dem Gastgeber:** Ein Link ohne den Zustand einer Ansicht nimmt in einem Bereich die aktuelle Adresse (damit Zustand und Herkunft); so ändern sich die rund 15 Stellen in Eingang und Wiederholungen an einer Stelle. Nur der Gastgeber „Aufgaben“ (ohne Kontext, etwa im Papierkorb) behält den Pfad ohne Zustand (`LIST_HOST.path`).

### 3. Was die Ansichten markieren

- Die Effekte der Ansichten (Markierung `aria-current`, Fokus nach dem Schließen eines Panels, gezählte Projekte von `ProjectStatsStore.track`) bekommen nur IDs ihres Bereichs, **nie die ID eines Tickets**: `host.activeIn(page)` liefert das Projekt, den Eintrag oder die Regel des Panels und, solange ein Ticket es ersetzt, die Herkunft; ohne Herkunft nichts. So bleibt die Zeile, aus der das Ticket kam, markiert, und der Wechsel Panel → Ticket → Panel löst keinen Fokus-Effekt der Ansicht aus.
- `host.panelShown(routeId)`: Die Panel-Spalte steht für die Panels und das Ticket, nicht für die Ansicht allein und nicht für die Vollansicht.
- Links, die ein Ticket in einem Bereich öffnen, tragen `data-ticket-link="<id>"`; `ViewWithPanel` nennt seine Teile `data-view-part="list"` und `"panel"`. `host.entryOf(id, url)` findet den Link im Panel der Herkunft, sonst in der Ansicht.

### 4. Projekte

- Die offenen Tickets der Projekte (Zeilen der Liste und Abschnitt „Offene Tickets“ im Projekt-Panel, [ADR-0034](0034-unterprojekte.md), Nachtrag) öffnen unter „Projekte“, nicht mehr in „Aufgaben“ mit `?projekt=`; ihr Menü „•••“ („Im Seitenpanel öffnen“, „In Vollansicht öffnen“) ebenso, und „Duplizieren …“ öffnet das Duplikat dort. „In den Papierkorb …“ aus dem Menü eines Eintrags schließt das Panel dieses Tickets (zurück zur Herkunft), wie im Kalender.
- „Alle N in Aufgaben öffnen“ und „Tickets anzeigen“ führen weiter nach „Aufgaben“ (§1).

### 5. Projektpfad im Kopf des Tickets

„Haus › Garten“ im Kopf von Panel und Vollansicht öffnet das **Projekt-Panel** (`/projekte/<id>`), nicht mehr „Aufgaben“ mit dem Projekt als Filter.

### 6. Papierkorb

„Wiederherstellen“ (in der Vorschau und in der Zeile) lässt den Nutzer im Papierkorb: Die Vorschau schließt sich, und das Flag „KEY wiederhergestellt.“ bietet die Aktion **„Öffnen“**, die das Ticket in „Aufgaben“ im gemerkten Modus öffnet (`TrashStore.restore` mit `open`). Vorher führte die Vorschau zum Ticket.

### 7. Rückweg mit Fokus, Links in Texten, Fragen beim Ersetzen (KX-2)

- **Fokus:** Nach × bzw. Esc (auch nach „Verwerfen“ und aus der Vollansicht) steht der Fokus wieder auf dem Link, der das Ticket geöffnet hat: im Panel der Herkunft, sonst in der Ansicht.
- **Links auf Tickets in Beschreibung und Kommentaren** (`Markdown.svelte`, auch „Kopiert aus [KEY](/tickets/<id>)“ in Duplikaten und die Vorschau im Papierkorb) öffnen im aktuellen Kontext und im gemerkten Modus: ein Klick ohne Zusatztaste mit der linken Taste wird abgefangen und über `ticketLinks().href(id, page.url)` geführt. Gespeichert bleibt `/tickets/<id>` ([ADR-0042](0042-tickets-und-projekte-aus-listen-waehlen.md) §5); diese Form brauchen Server, Teilen und ein neuer Tab (Strg, Umschalt, Mittelklick).
- **„Änderungen verwerfen?“ beim Ersetzen:** Das Ticket fragt wie bisher (`TicketRouteLayout`, Query-Wechsel ausgenommen). Projekt- und Regel-Panel fragten nur bei × und Esc; ersetzt sie ein Link, fragen sie künftig **inline** im Panel (kein Dialog aus einem Dialog).
- **„Gesammelt umwandeln“** (Modal) schließt sich beim Klick auf ein angelegtes Ticket wie die Schnellerfassung, damit Modal und Ticket bzw. Vollansicht nie übereinander liegen ([ADR-0025](0025-ui-konsistenz-overlay-system.md) Nachtrag 16).
- **„Zurück zu …“** in den Einstellungen kennt die neuen Adressen und sagt bei Wiederholungen und Papierkorb nicht mehr „Zurück zu Aufgaben“.

### 8. Kalender und Schnellerfassung (KX-3, zweiter Schritt)

Freigegeben ist, im Kalender geplante Termine (Regel) und Termine des Eingangs neben dem Kalender zu öffnen, sofern sich Regel- und Eingangs-Panel sauber als Inhalte des Kalenders einbinden lassen, sonst mit Begründung als Folgepunkt; „Ticket ansehen“ der Schnellerfassung öffnet im aktuellen Kontext. Bewertung und Umsetzung mit KX-3.

## Alternativen

- **Stapeln** (Ticket als zweites Panel neben dem Projekt-Panel oder darüber): `ViewWithPanel` hat eine Panel-Spalte, `PanelHost` eine Schließ-Funktion, und die Stores des Tickets gibt es einmal; zwei Panels nähmen der Ansicht unter 94rem den Platz. Vom Nutzer zugunsten von „Ersetzen“ verworfen.
- **Herkunft ohne Adresse** (im Speicher des Tabs gemerkt): Neuladen, Zurück und Vor wüssten den Rückweg nicht mehr, und ein Link in einem neuen Tab sähe anders aus. Verworfen; die Adresse ist der Zustand wie bei Filtern und Kalender.
- **Herkunft als Pfad** (`/projekte/<id>/tickets/<ticket>`): doppelte Routen je Herkunft und eine geschachtelte Panel-Logik. Verworfen zugunsten eines Parameters.
- **Ticket-Links in gespeicherten Texten umschreiben** (auf die Adresse des Bereichs): Gespeichertes hinge vom Ort des Schreibens ab, und der Server prüft genau `/tickets/<id>`. Verworfen; abgefangen wird nur der Klick.
- **„Wiederherstellen“ führt weiter zum Ticket:** Wer mehrere Tickets zurückholt, müsste jedes Mal zurück in den Papierkorb. Verworfen zugunsten des Flags mit „Öffnen“.

## Konsequenzen

- Keine Migration, keine Hooks, kein Neustart; nach dem Build genügt F5.
- Neue Routen unter `projekte/tickets`, `eingang/tickets` und `wiederholungen/tickets`; `ticket-host.ts` mit drei Gastgebern der Bereiche (`AreaTicketHost`: `origin`, `activeIn`, `panelShown`), `ticket-links.ts` mit `ORIGIN_PARAM`, `ticketOriginFrom`, `areaTicketHref`, `areaBackHref` und `projectPanelPath`; `ticketLinks().path` liest die aktuelle Adresse.
- `ProjectTicketList` hat keinen `listUrl` mehr; `TrashStore.restore` nimmt `open`; `TrashView` hat `onopen`; `ViewWithPanel` nennt seine Teile.
- Hilfe („Wo öffnet sich ein Ticket?“, Papierkorb, offene Tickets eines Projekts), README und CLAUDE.md §7 sind nachgezogen; Nachträge in ADR-0025, ADR-0034, ADR-0037 und ADR-0053.
