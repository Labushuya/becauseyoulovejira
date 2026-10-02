# ADR-0053: Kalenderansicht – Monat, Woche und Agenda mit Tickets, geplanten Wiederholungen und Terminen des Eingangs, nur ganze Tage, Tickets öffnen neben dem Kalender

- **Status:** Angenommen, K-1 (Grundansicht, §1 bis §11) und K-2 (Fälligkeit verschieben, §12) umgesetzt nach [Plan Kalender](../plan/kalender.md); manuelle Prüfungen im Test-Manifest; §6 ergänzt durch [ADR-0054](0054-tickets-im-kontext-oeffnen.md) (Nachträge vom 2026-10-02: Gastgeber auch für Projekte, Eingang und Wiederholungen; Regel und Eintrag neben dem Kalender)
- **Datum:** 2026-10-02
- **Entscheidung durch:** Nutzer (Wunsch „zusätzliche Kalenderansicht wie in Google Kalender mit verschiedenen Ansichten, man sieht, was wann ansteht“; Freigabe der Empfehlungen am 2026-10-02: nur Datum ohne Uhrzeit, Farben aus [ADR-0052](0052-farben-fuer-projekte-und-tickets.md), Verschieben per Ziehen als zweiter Schritt, beide Zusatz-Ebenen), Advisor (Ansichten, Ebenen, Filter, Datenwege, Tastatur, Barrierefreiheit, Kennzeichnung „überfällig“ nach Konvention), Executor (Panel neben dem Kalender, Projektion der Wiederholungen, schmale Fenster, Grenzen und Einzelheiten)
- **Bezug:** [ADR-0005](0005-zeitzone-europe-berlin.md) (Berliner Kalendertage), [ADR-0009](0009-fehlerfarbe.md) (Rot nur für Fehler), [ADR-0013](0013-filter-suche-sortierung-gruppierung.md) und [ADR-0019](0019-kanal-filter-und-gruppierung.md) (Filter in der URL), [ADR-0021](0021-regelmodell-wiederkehrende-aufgaben.md) bis [ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) (Regeln, Erzeugung, Pause), [ADR-0025](0025-ui-konsistenz-overlay-system.md) (Popover, Panel, Vollansicht), [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md) (kein seitliches Scrollen), [ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) (gemerkter Öffnungsmodus, Zeilenmenü, Rechtsklick), [ADR-0049](0049-zielprojekt-je-eingangsweg.md) (Zielprojekt), [ADR-0052](0052-farben-fuer-projekte-und-tickets.md) (Farben)

## Kontext

Die App zeigt Tickets als Liste („Aufgaben“), nach Projekten und als Regeln („Wiederholungen“). Was in den nächsten Wochen ansteht, sieht man nur über die Sortierung nach Fälligkeit. Tickets haben ein Fälligkeitsdatum ohne Uhrzeit (CLAUDE.md §5); Regeln wissen, wann ihr nächstes Ticket entsteht (`nextTicketOf`, [ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 6); der Eingang hat Termine aus Kalendern und Notion mit `source_date`, die noch keine Tickets sind. Der Nutzer wünscht eine Kalenderansicht mit mehreren Ansichten, in der auch die Farben der Projekte erscheinen.

## Entscheidung

### 1. Eine Hauptansicht „Kalender“

- Adresse `/kalender`, im Umschalter der Ansichten nach „Wiederholungen“ („Aufgaben | Projekte | Eingang | Wiederholungen | Kalender“), mit Kalendersymbol; der Link behält Ansicht, Tag und Filter, solange der Kalender gezeigt wird.
- **Nur ganze Tage:** Jeder Eintrag gilt für den ganzen Tag, es gibt kein Zeitraster und keine Tagesansicht. „Heute“ und alle Tage sind Berliner Kalendertage (`berlin-date.ts`, `tickets.today` des Listen-Stores, der um Berliner Mitternacht weiterzählt).
- Drei Ansichten: **Monat** (Raster Montag bis Sonntag in ISO-Wochen mit ihrer Nummer, vier bis sechs Wochen), **Woche** (sieben Spalten mit den Listen der Tage), **Agenda** (vier Wochen ab dem gewählten Tag, nur Tage mit Einträgen, darüber die Gruppe „Überfällig“, §3).
- Über dem Kalender: „Heute“, „Vorheriger/Nächster Monat“ (bzw. Woche, „4 Wochen“), die Überschrift des Zeitraums („Oktober 2026“, „KW 40 · 28.09. – 04.10.2026“, „02.10. – 29.10.2026“, höflich angesagt) und in der Abschnittsleiste die Wahl der Ansicht (`.segmented`, `aria-pressed`), „Ebenen“ und „So funktioniert’s“ (Hilfe `#kalender`).

### 2. Zustand: URL und Gerät

- **URL:** `ansicht=monat|woche|agenda` und `datum=JJJJ-MM-TT` (Jahre 1900 bis 2999, sonst nicht gesetzt; ohne `datum` heute) neben den Parametern der Filter von „Aufgaben“ (`list-query.ts`). Lesen und Schreiben rein in `domain/calendar.ts` (`parseCalendarQuery`, `replaceCalendarQuery`); unbekannte Parameter bleiben stehen, doppelte gelten als nicht gesetzt (wie [ADR-0013](0013-filter-suche-sortierung-gruppierung.md) §4). „Heute“, davor und danach schreiben `datum` mit einem Eintrag im Verlauf, wie die Filter.
- **Gerät** (`CalendarPrefsStore`, `localStorage`, wie Öffnungsmodus und Spalten, nicht je Nutzer): die zuletzt gewählte Ansicht (`byl-calendar-view`) und die gezeigten Ebenen (`byl-calendar-layers`, nur eine Wahl außer dem Standard); andere Tabs folgen über das Ereignis `storage`, ein gesperrter Speicher gilt für die Seite. Die Ansicht der URL geht vor, dann die gemerkte, sonst der Monat (in schmalen Fenstern die Agenda, §7).

### 3. Ansichten im Einzelnen

- **Monat:** Ein Tag zeigt höchstens vier Einträge (`MONTH_DAY_LIMIT`); hat er mehr, drei und „+N weitere“. Dieser Knopf öffnet ein Popover der Art `panel` mit dem vollen Datum als Namen und allen Einträgen des Tages (mit Key, Projekt, Status, Priorität und „•••“). Die Liste darin entsteht erst beim ersten Öffnen. Tage außerhalb des Monats stehen gedämpft; heute trägt `aria-current="date"`, die Akzentfläche und einen Rahmen.
- **Woche:** sieben Spalten, ein Tag zeigt bis zu zwölf Einträge (`WEEK_DAY_LIMIT`, dann „+N weitere“), je mit Key und Titel auf zwei Zeilen.
- **Agenda:** eine Liste ohne Raster; je Tag eine Überschrift mit dem vollen Datum („· heute“), darin die Einträge als Zeilen mit Key, Titel, Projekt, Status und Priorität. Liegt heute im Zeitraum, steht oben die Gruppe **„Überfällig“** mit den offenen Tickets, die vor dem ersten Tag fällig waren, älteste zuerst, je mit „seit 3 Tagen überfällig“. Ohne Einträge sagt ein leerer Zustand „Keine Einträge in diesen vier Wochen“.
- **Reihenfolge eines Tages:** offene Tickets nach Priorität (dann neueste zuerst, wie die Liste), geplante Termine, Termine des Eingangs, erledigte Tickets.

### 4. Ebenen und Filter

| Ebene | Standard | Inhalt | Darstellung | Klick |
|---|---|---|---|---|
| Offene Tickets | an | offene Tickets am Tag ihrer Fälligkeit | normal; überfällige fett mit Uhr und „überfällig“ (§10) | Ticket neben dem Kalender (§6) |
| Erledigte Tickets | aus | erledigte Tickets mit Fälligkeit im Zeitraum | gedämpft, mit Häkchen und „erledigt“ | wie oben |
| Künftige Wiederholungen | an | Termine von Regeln ohne Ticket (§5) | blass, gestrichelt, Wiederholungssymbol, „erscheint am …“ | Panel der Regel, seit KX-3 neben dem Kalender (Nachtrag) |
| Termine im Eingang | an | neue Einträge mit Datum eines Termins (`eventDueDate`: Art `event` oder Notion, Berliner Tag von `source_date`), noch nicht umgewandelt | gedämpft, Eingangssymbol, Kanal | Eintrag im Eingang, seit KX-3 neben dem Kalender (Nachtrag) |

- Die Ebenen wählt das Popover „Ebenen“ (Checkboxen mit je einem Satz, was sie zeigen); die Wahl gilt sofort und bleibt auf dem Gerät.
- **Filter:** dieselbe Filterleiste wie in „Aufgaben“ (`FilterBar` mit `calendar`) mit denselben Parametern, ohne „Fällig“ (der Kalender ist die Achse der Fälligkeit) und ohne Suche (die beantwortet der Server nur für die offenen Tickets der Liste); stehen beide noch in der URL, wirken sie im Kalender nicht (`calendarListQuery`). Tickets prüft `matchesFilter` wie die Liste, mit Unterprojekten. Der Statusfilter entscheidet wie in der Liste über die Tickets: „Erledigt“ zeigt erledigte auch ohne ihre Ebene und keine offenen, ein anderer Status keine erledigten; das Popover sagt es an der Ebene.
- **Geplante Termine** prüft der Filter als das Ticket, das sie werden: Status beim Anlegen, Priorität (leer „Mittel“), Projekt und Tags der Vorlage, keine Quelle („Manuell“, [ADR-0022](0022-erzeugung-von-instanzen.md) §2), wiederkehrend.
- **Termine des Eingangs** haben weder Status noch Priorität, Tags oder Serie: Jeder dieser Filter blendet sie aus. Der Projektfilter prüft ihr **Zielprojekt** ([ADR-0049](0049-zielprojekt-je-eingangsweg.md), mit Unterprojekten, „Ohne Projekt“ = ohne Zielprojekt), der Quellfilter die Familie ihres Kanals.

### 5. Datenwege und Projektion der Wiederholungen

- **Offene Tickets** aus dem `TicketListStore`, der alle offenen live hält (`loadOpen()`, auch wenn die App im Kalender startet); keine eigene Anfrage, kein zweiter Stand.
- **Erledigte Tickets** nur bei Bedarf (Ebene an oder Statusfilter „Erledigt“) und nur für den Zeitraum: `listDoneTicketsDue` (`status = done`, `due` im Zeitraum, nach Fälligkeit, 200 je Seite) über den `CalendarDoneStore` des Kalender-Layouts, Seite für Seite bis höchstens 5 Seiten (1 000 Tickets; darüber ein Hinweis). Ohne Filter beim Server: Der Kalender filtert sie im Client wie die offenen, ein anderer Filter braucht keine Anfrage. Ein anderer Zeitraum bricht eine laufende Anfrage ab. Realtime hält den geladenen Zeitraum aktuell (erledigt, wieder geöffnet, verschoben, im Papierkorb), auch während er lädt; nach dem Neuverbinden lädt er neu.
- **Regeln** aus dem `RecurrenceStore`, **Eingang** aus dem `InboxStore` (alle neuen Einträge, live). Keine Migration, keine Hooks.
- **Projektion** (`domain/calendar-plan.ts`, rein, nur mit `recurrence.ts` und `nextTicketOf`, also mit denselben Regeln wie der Hook): je aktiver Regel der nächste Termin, wie der Server ihn erzeugen wird (ohne „Jeden Termin einzeln anlegen“ nach verpassten Terminen der jüngste davon, `catchUp`), dann die folgenden Termine des Rhythmus (`after`) bis zum Ende des Zeitraums; begonnen wird beim ersten Termin im Zeitraum (`onOrAfter`), höchstens 400 Termine je Regel. Je Termin der Tag des Erscheinens (Fälligkeit minus Vorlauf) und, ohne Schalter, die offenen Tickets, die den nächsten zurückhalten („erscheint am 09.10. (sobald HAUS-12 erledigt ist)“, Worte wie `nextTicketText`).
  - **Pausierte Regeln** zeigt der Kalender nicht: Sie erzeugen nichts, und Fortsetzen holt die Pause nicht nach ([ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) §4); ein markierter Termin würde etwas versprechen, das nicht kommt.
  - Eine Regel, die auf die **Entscheidung über einen Rückstand** wartet, zeigt ihre Termine ab heute: Beide Antworten erzeugen sie.
  - **„Nach Erledigung“** kennt nur den nächsten Termin, und keinen, solange ihr Ticket offen ist (er hängt am Erledigen).
  - **Nicht doppelt:** Ein Termin, an dem schon ein Ticket der Regel steht (offen oder geladen erledigt, auch eines, dessen Fälligkeit dorthin verschoben wurde), entfällt; so steht auch zwischen dem Realtime-Ereignis des neuen Tickets und dem der Regel nichts doppelt.

### 6. Tickets öffnen sich neben dem Kalender

- Ein Klick auf ein Ticket öffnet es im gemerkten Modus ([ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §1), aber **neben dem Kalender**: `/kalender/tickets/<id>` (Seitenpanel wie neben „Aufgaben“, eingebettet ab 64rem) bzw. `/kalender/tickets/<id>/voll` (Vollansicht über dem Kalender), mit dem Zustand des Kalenders in der Adresse. × und Esc führen zurück in den Kalender, der Fokus geht an den Eintrag des Tickets; ein Ticket, das es nicht mehr gibt, führt „Zum Kalender“.
- **Umsetzung ohne Kopie:** Panel und Vollansicht beider Orte sind dieselben Teile (`TicketRouteLayout`, `TicketFullViewRoute`; die Routen unter `(tickets)` und `kalender` sind nur noch Hüllen). Ein **Gastgeber** im Kontext (`TicketHost` in `lib/ticket-host.ts`: Adressen von Ansicht, Panel und Vollansicht, Route-IDs, Text des Rückwegs, Eintrag für den Fokus) bestimmt die Adressen; das Kalender-Layout setzt `CALENDAR_HOST`, ohne Kontext gilt `LIST_HOST`. `ticketLinks().href` folgt dem Gastgeber, so öffnen auch Unteraufgaben, das übergeordnete Ticket und ein Duplikat neben dem Kalender.
- **Menü:** Jedes Ticket hat das Zeilenmenü von „Aufgaben“ (`TicketActions`: „Im Seitenpanel öffnen“, „In Vollansicht öffnen“ mit Adressen des Kalenders, „Link kopieren“, „Duplizieren …“, „In den Papierkorb …“) mit Rechtsklick, Umschalt+F10 und Kontextmenü-Taste (`rowMenus`, ein Eintrag ist eine Menüzeile). In einer Zeile des Monats ist „•••“ verborgen (kein Platz; das Menü öffnet am Zeiger bzw. unter dem Eintrag), in der Woche erscheint es beim Zeigen und mit dem Fokus, in der Agenda und der Liste eines Tages steht es immer. Die Fragen öffnet das Kalender-Layout (`TicketRowDialogs`); wird ein Ticket in den Papierkorb gelegt, dessen Panel offen ist, schließt das Panel. Geplante Termine und Termine des Eingangs haben kein Menü.

### 7. Schmale Fenster

- Unter 40rem Fensterbreite (`CALENDAR_NARROW_QUERY`) beginnt ein Kalender ohne gewählte Ansicht mit der **Agenda**: Ein Monat hat dort etwa 3rem je Tag, ein Titel passt nicht hinein, und die Agenda zeigt Titel, Projekt und Status vollständig. Eine gewählte Ansicht bleibt.
- Ein **Monat** mit weniger als 6rem je Tag (gemessen per `ResizeObserver` am Raster, auch neben dem Panel) zeigt **Punkte statt Titel**: je Eintrag ein Punkt in der Farbe des Tickets (ohne Farbe ein Kreis, gestrichelt für geplante), jeder ein Link mit dem vollen Namen; „+N weitere“ öffnet den Tag als Liste.
- Kein seitliches Scrollen ([ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md)): Die sieben Spalten teilen sich die Breite (`minmax(0, 1fr)`), Titel kürzen mit Auslassung bzw. auf zwei Zeilen, `title` nennt lange.

### 8. Tastatur und Barrierefreiheit

- Monat und Woche sind ein **APG-Grid** (`role="grid"`, benannt durch die Überschrift des Zeitraums): Kopfzeile mit „KW“ und Mo–So (`columnheader`, ausgeschrieben im `title`), je Woche eine Zeile mit der Nummer als `rowheader` („Kalenderwoche 40“), je Tag eine `gridcell` mit dem vollen Datum, „heute“ und der Zahl der Einträge als Namen („Freitag, 2. Oktober 2026, heute, 3 Einträge“).
- **Roving-Tabindex:** genau ein Tag ist ein Tab-Stopp (heute, sonst der Tag des Zeitraums). Pfeiltasten: Tag bzw. Woche; Pos1/Ende: Montag bzw. Sonntag, mit Strg erster bzw. letzter Tag des Monats; Bild auf/ab: derselbe Tag im Monat bzw. in der Woche davor oder danach (APG Date Picker). Liegt der neue Tag außerhalb des Zeitraums, zeigt der Kalender den Zeitraum um ihn (mit `datum` in der URL), und der Fokus folgt. Enter oder F2 führen in die Einträge des Tages, Pfeil hoch/runter durch sie, Esc zurück zum Tag; Tab verlässt das Raster. Die Einträge im Raster sind keine Tab-Stopps.
- **Namen der Einträge:** Key und Titel, dann verborgen „, überfällig“ bzw. „, erledigt“, das Projekt („Projekt Haus › Garten“) und die Farbe („Farbe Blau, vom Projekt „Haus““); geplante beginnen mit „Geplant:“ und nennen das Erscheinen, Termine des Eingangs „Termin im Eingang:“ und den Kanal. Das Ticket im Panel trägt `aria-current="true"` und die Akzentfläche.
- Die Tasten stehen in der einen Quelle der Kürzel (`shortcuts.ts`, Gruppe „Kalender“) und damit in Hilfe und Modal „Tastaturkürzel“.

### 9. Farben

Die Farbe eines Tickets kommt aus `ticketColorOf` (eigene → Projekt → Oberprojekt, [ADR-0052](0052-farben-fuer-projekte-und-tickets.md) §3), die eines geplanten Termins aus der Farbe der Vorlage, sonst aus deren Projekt. Sie steht als Streifen vor dem Titel bzw. als Punkt (§7), nie als Fläche und nie allein: Ihr Name ist Teil des Links. Erledigte behalten die volle Farbe (eine gedämpfte hielte keine 3 : 1). Termine des Eingangs haben keine Farbe.

### 10. Überfällig

Konvention der App (DueLabel der Tabelle, [ADR-0009](0009-fehlerfarbe.md) „Überfällige Tickets zeigen Text und Icon in der Textfarbe“, CLAUDE.md §8 „Nicht rot: Überfälligkeit“): **fett in der Textfarbe, mit Uhr-Symbol und dem Wort „überfällig“**, nie rot. Im Raster stehen überfällige Tickets an ihrem (vergangenen) Fälligkeitstag, in der Agenda zusätzlich oben als Gruppe.

### 11. Leistung

Gerechnet und gerendert wird nur der Zeitraum: Einträge entstehen in einem Durchlauf über die offenen Tickets (`entriesByDay`), geplante Termine nur für den Zeitraum, ein Monat rendert höchstens 42 Tage × 4 Einträge, die Liste hinter „+N weitere“ erst beim Öffnen. Gemessen mit 2 000 offenen Tickets und 50 Regeln: Monat 3 bis 7 ms, Woche unter 1 ms, Agenda 3 bis 5 ms Rechenzeit; Rendern eines Monats in jsdom samt Laden der Stores etwa 100 ms (Plan §6, Tests mit großzügigen Grenzen).

### 12. Fälligkeit verschieben (K-2)

- **Was sich verschiebt:** nur **offene Tickets** im Monat und in der Woche (`isMovable`), überfällige eingeschlossen. Erledigte Tickets behalten den Tag, an dem sie fällig waren; geplante Termine folgen ihrer Regel (geändert wird die Regel); Termine des Eingangs sind noch keine Tickets. Diese Einträge reagieren weder auf Ziehen noch auf „m“ und haben keinen Menüeintrag. Die Agenda hat keine Tage zur Wahl und verschiebt nichts; das Datumsfeld im Panel bleibt der Weg dort.
- **Maus:** Ein offenes Ticket wird auf einen anderen Tag des Zeitraums gezogen (Pointer Events, erst ab 5 px Bewegung, `DRAG_THRESHOLD_PX`; weniger bleibt ein Klick). Der Tag unter dem Zeiger und das Ticket tragen einen gestrichelten Rahmen auf der Akzentfläche (nicht nur Farbe), die Statuszeile unter dem Raster sagt „Fälligkeit von KEY verschieben: Auf einen Tag ziehen und loslassen, Esc bricht ab.“ Loslassen auf einem anderen Tag speichert, auf demselben oder außerhalb der Tage nichts; Esc bricht ab; der Klick nach dem Ziehen öffnet das Ticket nicht. Das native Ziehen dieser Links ist aus (`draggable="false"`), Strg/Umschalt-Klick (neuer Tab) zieht nicht. Aus der Liste eines Tages („+N weitere“, ihr Popover liegt über den Tagen) und über den Zeitraum hinaus wird nicht gezogen; dafür gibt es Tastatur und Menü.
- **Ohne Ziehen (Pflicht, Tastatur, Screenreader, Touch):** „m“ auf einem Ticket im Raster (`CALENDAR_MOVE_KEY`, `aria-keyshortcuts="M"`, Gruppe „Kalender“ der Kürzel) oder **„Fälligkeit verschieben …“** im Menü des Tickets (nach den Wegen zum Öffnen, nur im Raster) beginnen das Verschieben: Der Fokus geht an den Tag des Tickets, die Tasten des Rasters wählen den neuen Tag (auch in anderen Zeiträumen, Bild auf/ab), der gewählte Tag trägt den Rahmen; **Enter** setzt, **Esc** oder „Abbrechen“ in der Statuszeile brechen ab. Ein Klick oder Tippen auf einen Tag setzt ebenfalls, auch nach dem Blättern mit „Nächster Monat“. Danach steht der Fokus auf dem Ticket am neuen Tag (nach Abbruch oder Ablehnung am alten; verbirgt es „+N weitere“, auf dem Tag). Die Statuszeile ist eine höfliche Live-Region und wird einmal zu Beginn angesagt; die Tage nennen beim Fokus ihr volles Datum.
- **Speichern:** `TicketListStore.moveDue` über den bestehenden Speicherweg (Record API wie Panel und Tabelle, `updateTicket` mit `expected_updated` = `updated` des Tickets im Store, [ADR-0032](0032-editor-tiptap-markdown.md) §6). Kein optimistischer Wert, wie beim Bearbeiten in der Tabelle: Das Ticket wandert mit der Antwort, bis dahin ist es beschäftigt (`aria-busy`, gedämpft) und nicht erneut verschiebbar. Gespeichert zeigt ein Flag „Fälligkeit von KEY auf TT.MM.JJJJ gesetzt.“ mit **„Rückgängig“**; das setzt das Datum davor, wieder mit `expected_updated` (= `updated` der Antwort), und meldet „Fälligkeit von KEY wieder auf TT.MM.JJJJ gesetzt.“ Ein zweites Verschieben desselben Tickets schließt das Flag des ersten, dessen „Rückgängig“ abgelehnt würde.
- **Konflikt:** Hat sich das Ticket seitdem geändert (anderer Tab, Regel, Sammelbearbeitung), lehnt der Hook ab (`validation_description_stale`). Das Ticket bleibt, wo es war, ein Fehler-Flag sagt „Fälligkeit von KEY nicht gesetzt: Das Ticket wurde inzwischen geändert.“ (bzw. „nicht zurückgesetzt“), Realtime bringt den neuen Stand. Andere Ablehnungen nennen die Meldung ihres Feldes.
- **Serientickets:** Die Statuszeile sagt vorher „Nur dieses Ticket, die Serie verschiebt sich nicht.“, das Flag danach „Die Fälligkeit eines Tickets der Serie zu verschieben, verschiebt die Serie nicht.“ (der Satz der Hilfe „Wiederholungen“). Der Server lässt die Regel, wie sie ist (Integrationstest); ihr nächster Termin bleibt, wo er war.
- **Touch und Stift ziehen nicht.** Ein Ziehen mit dem Finger braucht `touch-action: none` auf den Einträgen oder ein langes Drücken: Das erste nimmt der Seite das Scrollen dort, wo Einträge stehen (auf einem Telefon ein großer Teil des Monats), das zweite kollidiert mit Kontextmenü und Textauswahl des Browsers. Auf Touch-Geräten führt der Weg über das Menü: in der Woche und in der Liste eines Tages ist „•••“ dort immer sichtbar, im Monat öffnet langes Drücken (Kontextmenü) das Menü, wo der Browser es meldet; dann den Tag antippen.

## Alternativen

- **Tickets im Panel von „Aufgaben“ öffnen** (wie Projekte, Eingang und Wiederholungen): Der Kalender wäre nach jedem Klick weg, × führte in die Liste. Für eine Übersicht „was wann“ verworfen; der Gastgeber im Kontext hält Panel und Vollansicht ohne Kopie an einem Ort.
- **Eine Tagesansicht oder ein Zeitraster:** Tickets haben keine Uhrzeit (Entscheidung 1 des Nutzers). Verworfen.
- **Pausierte Regeln markiert zeigen:** würde Termine zeigen, die so nicht kommen. Verworfen (§5).
- **Erledigte Tickets mit den Filtern beim Server laden:** jede Änderung eines Filters wäre eine Anfrage; der Client filtert ohnehin offene. Verworfen; die Grenze von 1 000 je Zeitraum sagt ein Hinweis.
- **Suche im Kalender:** Die Suche beantwortet der Server als IDs offener Tickets der Liste; eine zweite Mechanik für den Kalender brächte wenig gegenüber Filtern. Zurückgestellt.
- **„•••“ in jeder Zeile des Monats:** nimmt in einer Zelle von 7 bis 10rem dem Titel ein Viertel. Verworfen zugunsten von Rechtsklick, Umschalt+F10 und dem sichtbaren Knopf in Woche, Agenda und Liste des Tages.
- **Monat als Standard auch in schmalen Fenstern:** zeigt dort nur Punkte. Verworfen zugunsten der Agenda; der Monat bleibt wählbar (§7).
- **Eine Bibliothek für Kalender:** neue Abhängigkeit, eigenes Aussehen, Konflikt mit Tokens und Overlays (ADR-0025). Verworfen.
- **HTML5 Drag and Drop** (`draggable`, `dragover`, `drop`) für K-2: kein Touch, keine Tastatur, ein Geisterbild des Browsers, `dataTransfer` mit Eigenheiten je Browser und in jsdom kaum zu prüfen. Verworfen zugunsten von Pointer Events mit Schwelle, Esc und unterdrücktem Klick (§12).
- **Optimistisch verschieben:** Das Ticket spränge sofort und bei einem Konflikt zurück; die Antwort des lokalen Servers kommt ohnehin nach Millisekunden, und die Tabelle zeigt beim Bearbeiten ebenfalls die Antwort ([ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §6). Verworfen.
- **Ziehen mit dem Finger** (langes Drücken oder `touch-action: none`): Konflikt mit dem Scrollen und dem Kontextmenü (§12). Verworfen; der Weg über das Menü funktioniert mit Touch.
- **Beim Ziehen über „Nächster Monat“ weiterblättern:** fehleranfällig und schwer zu treffen; Tastatur und Menü erreichen jeden Tag. Zurückgestellt.

## Konsequenzen

- Keine Migration, keine Hooks, kein Neustart; nach dem Build genügt F5.
- Neue reine Module `domain/calendar.ts` und `domain/calendar-plan.ts`, Stores `CalendarDoneStore` und `CalendarPrefsStore`, Datenzugriff `listDoneTicketsDue`, Komponenten unter `components/calendar/`, Routen unter `routes/(app)/kalender/`, Gastgeber `lib/ticket-host.ts`; die Routen des Tickets unter `(tickets)` sind Hüllen um `TicketRouteLayout` und `TicketFullViewRoute`.
- `Popover`, `ActionsMenu` und `TicketActions` können ihren Knopf aus der Reihenfolge von Tab nehmen (`buttonTabindex`), das Panel nennt seinen Rückweg (`listLabel`).
- Umschalter der Ansichten, Hilfe („Kalender“, Gruppe „Kalender“ der Tastaturkürzel), „Zurück zum Kalender“ in den Einstellungen, README und CLAUDE.md §7 sind nachgezogen.
- K-2: `TicketListData.update` nimmt `expectedUpdated` an, `TicketListStore.moveDue` speichert und zeigt Flag und „Rückgängig“; `TicketActions` kennt „Fälligkeit verschieben …“ (`onmovedue`); `CalendarEntry` beschreibt den Platz eines Eintrags (`EntryPlace`: Aussehen, Tab-Stopp, Verschieben); das Raster trägt Ziehen, Tastatur und Statuszeile; Kürzel „m“. Weiterhin keine Migration und keine Hooks.

## Nachtrag (2026-10-02, [ADR-0054](0054-tickets-im-kontext-oeffnen.md)): Gastgeber auch für Projekte, Eingang und Wiederholungen

Ergänzt §6, ohne ihn aufzuheben. Das Muster des Kalenders gilt jetzt in allen Bereichen mit eigener Ansicht: `PROJECTS_HOST`, `INBOX_HOST` und `RECURRENCES_HOST` stehen neben `LIST_HOST` und `CALENDAR_HOST` in `lib/ticket-host.ts`, ihre Routen (`/projekte/tickets/<id>`, `/eingang/tickets/<id>`, `/wiederholungen/tickets/<id>`, je mit `…/voll`) sind Hüllen um `TicketRouteLayout` und `TicketFullViewRoute`.

- Der Gastgeber eines Bereichs kennt zusätzlich die **Herkunft**: Ein Ticket ersetzt dort das offene Panel (Projekt, Eintrag, Regel), die Adresse nennt es mit `von`, und `view` führt dorthin zurück (ADR-0054 §2). Der Kalender hat kein Panel außer dem des Tickets und keine Herkunft.
- `entryOf(id, url)` nimmt die Adresse des Tickets, damit ein Bereich den Link im Panel der Herkunft findet; der Kalender und die Liste lesen sie nicht. `path` ist optional: nur `LIST_HOST` hat einen eigenen Pfad ohne Zustand; ohne ihn nimmt `ticketLinks().path` die aktuelle Adresse, im Kalender also seinen Zustand.
- Was §6 unter „Alternativen“ für Projekte, Eingang und Wiederholungen beschrieb („Tickets im Panel von „Aufgaben“ öffnen“), gilt nicht mehr.

## Nachtrag (2026-10-02, [ADR-0054](0054-tickets-im-kontext-oeffnen.md) §8, KX-3): Regel und Eintrag neben dem Kalender

Ergänzt §4 (Spalte „Klick“), §6 und den vorigen Nachtrag. Ein geplanter Termin öffnet das Panel seiner Regel und ein Termin des Eingangs seinen Eintrag **neben dem Kalender**, nicht mehr unter „Wiederholungen“ bzw. im Eingang: `/kalender/wiederholungen/<id>` und `/kalender/eingang/<id>`, mit dem Zustand des Kalenders in der Adresse. Die Panels sind dieselben Teile wie dort (`RuleRoute`, `InboxItemRoute`); × führt zum Kalender mit Ansicht, Tag und Filtern.

- Der Kalender markiert die Termine der offenen Regel bzw. den Termin des offenen Eintrags (`aria-current="true"`, Akzentfläche wie beim Ticket, §8) und gibt nach dem Schließen dem ersten Termin der Regel bzw. dem Termin des Eintrags den Fokus, steht keiner mehr da, der Überschrift.
- Der Kalender hat damit eine **Herkunft**, aber zwei Arten davon: Ein Ticket aus dem Panel einer Regel oder eines Eintrags ersetzt es, die Adresse nennt es mit `von=regel-<id>` bzw. `von=eintrag-<id>`, und `CALENDAR_HOST.view` führt dorthin zurück; `entryOf(id, url)` findet dann den Link im Panel. Der Satz des vorigen Nachtrags „Der Kalender hat kein Panel außer dem des Tickets und keine Herkunft“ gilt nicht mehr.
- Das Kalender-Layout folgt seinen Navigationen wie die Bereiche (`followTicketReturn`, ADR-0054 §7).
