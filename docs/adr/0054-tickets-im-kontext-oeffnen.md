# ADR-0054: Tickets im Kontext öffnen – Gastgeber für Projekte, Eingang und Wiederholungen, das Ticket ersetzt das Panel seiner Herkunft

- **Status:** Angenommen; KX-1 (Gastgeber, Routen, Herkunft in der Adresse, Projekte, Projektpfad, Papierkorb), KX-2 (Fokus auf dem auslösenden Link, Links in Beschreibung und Kommentaren, „Änderungen verwerfen?“ in Projekt- und Regel-Panel, „Gesammelt umwandeln“, „Zurück zu …“) und KX-3 (Regel und Eintrag neben dem Kalender, „Ticket ansehen“ der Schnellerfassung) umgesetzt nach [Plan „Tickets im Kontext“](../plan/tickets-im-kontext.md)
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

- **Fokus:** Nach × bzw. Esc (auch nach „Verwerfen“, aus der Vollansicht und mit Zurück im Browser) steht der Fokus wieder auf dem Link, der das Ticket geöffnet hat: im Panel der Herkunft, sonst in der Ansicht, ohne Link auf der Überschrift. Umsetzung: Das Layout eines Bereichs folgt seinen Navigationen (`followTicketReturn`, `beforeNavigate`/`afterNavigate`) und merkt sich das verlassene Ticket, wenn die Navigation sein Rückweg ist; das Panel der Herkunft fragt beim Öffnen (`initialFocus`, beim Eintrag nach dem Laden), die Ansicht bekommt ihn nach der Navigation, nur wenn der Fokus verloren ist.
- **Links auf Tickets in Beschreibung und Kommentaren** (`Markdown.svelte`, auch „Kopiert aus [KEY](/tickets/<id>)“ in Duplikaten und die Vorschau im Papierkorb) öffnen im aktuellen Kontext und im gemerkten Modus: ein Klick ohne Zusatztaste mit der linken Taste wird abgefangen und über `ticketLinks().href(id, page.url)` geführt. Gespeichert bleibt `/tickets/<id>` ([ADR-0042](0042-tickets-und-projekte-aus-listen-waehlen.md) §5); diese Form brauchen Server, Teilen und ein neuer Tab (Strg, Umschalt, Mittelklick).
- **„Änderungen verwerfen?“ beim Ersetzen:** Das Ticket fragt wie bisher (`TicketRouteLayout`, Query-Wechsel ausgenommen). Projekt- und Regel-Panel fragten nur bei × und Esc; ersetzt sie ein Link, fragen sie jetzt **inline** oben im Panel (`TicketLeaveQuestion` mit den Worten ihrer Bestätigung, „Neues Projekt verwerfen?“ bzw. „Neue Regel verwerfen?“ beim Anlegen), nie als Dialog, weil der Link aus einem Dialog kommen kann (ein Duplikat, das sich öffnet). Ohne Frage gehen Query-Wechsel, Speichern (auch die neue Regel, die ihr Panel bekommt), das Schließen nach der eigenen Bestätigung und Löschen; Zurück und Vor im Browser gehen nach „Verwerfen“ weiter.
- **„Gesammelt umwandeln“** (Modal) schließt sich beim Klick auf ein angelegtes Ticket wie die Schnellerfassung, damit Modal und Ticket bzw. Vollansicht nie übereinander liegen ([ADR-0025](0025-ui-konsistenz-overlay-system.md) Nachtrag 16).
- **„Zurück zu …“** in den Einstellungen kennt die neuen Adressen („Zurück zu HAUS-12“ für ein Ticket in jedem Bereich) und sagt bei Wiederholungen und Papierkorb nicht mehr „Zurück zu Aufgaben“, sondern „Zurück zu Wiederholungen“, „Zurück zur Regel“ bzw. „Zurück zum Papierkorb“.
- **Ohne Link:** Steht der auslösende Link nicht mehr da (etwa bei einem inzwischen erledigten Ticket), bekommt die Überschrift der Ansicht bzw. des Panels den Fokus.

### 8. Kalender und Schnellerfassung (KX-3)

Freigegeben war, im Kalender geplante Termine (Regel) und Termine des Eingangs neben dem Kalender zu öffnen, sofern sich Regel- und Eingangs-Panel sauber als Inhalte des Kalenders einbinden lassen, sonst mit Begründung als Folgepunkt; „Ticket ansehen“ der Schnellerfassung öffnet im aktuellen Kontext.

- **Bewertung:** Beide Panels lassen sich sauber einbinden. `RecurrencePanel` und `InboxPanel` hängen nur an den Stores des `(app)`-Layouts und an Props (Rückweg über `onclose`, Ticket-Links über `ticketLinks()`), nicht am Layout ihres Bereichs. Die Teile ihrer Routen liegen deshalb jetzt in `RuleRoute` und `InboxItemRoute` (Props `back` und `section` für den Titel der Seite); `/wiederholungen/<id>` und `/eingang/<id>` nutzen sie wie vorher.
- **Routen:** `/kalender/wiederholungen/[id]` und `/kalender/eingang/[id]` neben dem Kalender, mit dessen Zustand (Ansicht, Tag, Filter) in der Adresse. Ein geplanter Termin öffnet seine Regel dort, ein Termin des Eingangs seinen Eintrag; × führt zum Kalender mit seinem Zustand. Der Kalender markiert die Termine der offenen Regel bzw. den Termin des Eintrags (`aria-current`, wie ein Ticket) und gibt nach dem Schließen dem ersten Termin der Regel bzw. dem Termin des Eintrags den Fokus, sonst der Überschrift. Ein weiterer Termin ersetzt das offene Panel.
- **Ersetzen statt Stapeln wie in den Bereichen:** Ein Ticket aus dem Panel einer Regel oder eines Eintrags im Kalender nimmt dessen Platz ein. Weil der Kalender zwei Arten von Herkunft hat, trägt `von` die Art: `von=regel-<id>` bzw. `von=eintrag-<id>` (`calendarOriginFrom`, streng wie §2; ein Wert ohne Art zählt nicht). `CALENDAR_HOST.view` führt mit Herkunft zur Regel bzw. zum Eintrag, sonst zum Kalender; der Kalender folgt seinen Navigationen wie die Bereiche (`followTicketReturn`), damit der Fokus auf dem Link im Panel der Herkunft landet (§7). Ein Panel, das ein Ticket ersetzt hat, gibt den Fokus nicht an den Kalender zurück, das Ticket nimmt ihn selbst.
- **Schnellerfassung:** „Ticket ansehen“ öffnet das neue Ticket in der Ansicht, in der der Nutzer gerade ist, im gemerkten Modus und an Stelle eines offenen Panels (`ticketHrefIn(id, routeId, url, mode)` in `ticket-host.ts`, aus der Route des `(app)`-Layouts, das selbst keinen Gastgeber im Kontext hat). Wo es keine Ansicht für Tickets gibt (Einstellungen, Papierkorb), führt es wie bisher nach „Aufgaben“ ohne Zustand. „Eintrag ansehen“ bleibt beim Eingang.
- **„Zurück zu …“** nennt die neuen Adressen „Zurück zur Regel“ bzw. „Zurück zum Eintrag“.

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
- KX-2: `lib/ticket-return.svelte.ts` (`TicketReturn`, `followTicketReturn`, `findTicketReturn`); `ProjectPanel`, `RecurrencePanel` und `InboxPanel` nehmen `initialFocus`, die ersten beiden halten Navigationen mit ungespeicherten Eingaben an (`beforeNavigate`); `TicketLeaveQuestion` nimmt `title` und `text`; `Markdown.svelte` fängt Klicks auf Links zu Tickets ab (`ticketIdOfLink` in `domain/link.ts`); `BulkConvertDialog` schließt sich beim Öffnen eines Tickets; `lastViewLabel` kennt die neuen Adressen.
- KX-3: Routen `kalender/wiederholungen/[id]` und `kalender/eingang/[id]`; `RuleRoute` und `InboxItemRoute` als gemeinsame Teile der Routen von Regel und Eintrag; `ticket-links.ts` mit `calendarOriginFrom`, `calendarRuleHref`, `calendarItemHref`, `calendarBackHref`; `ticket-host.ts` mit `OriginTicketHost` (der Kalender und die Bereiche nennen ihre Herkunft), `CALENDAR_RULE_ROUTE`, `CALENDAR_ITEM_ROUTE` und `ticketHrefIn`; `CalendarView` und `CalendarEntry` nehmen `activeRuleId`, `activeItemId`, `ruleHref` und `itemHref`.
- Hilfe („Wo öffnet sich ein Ticket?“, Papierkorb, offene Tickets eines Projekts, Kalender), README und CLAUDE.md §7 sind nachgezogen; Nachträge in ADR-0025, ADR-0034, ADR-0037, ADR-0042 (Links in Texten) und ADR-0053.
