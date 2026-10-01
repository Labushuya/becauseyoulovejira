# ADR-0036: Gemerkter Öffnungsmodus, Sammelbearbeitung mit Rückgängig und Inline-Bearbeitung in der Tabelle

- **Status:** Angenommen und umgesetzt: §1 in BI-1 (#148), §2 bis §5 in BI-2 (#149), §6 in BI-3, nach [docs/plan/bulk-inline-ansicht.md](../plan/bulk-inline-ansicht.md); manuelle Browser-Prüfungen stehen im Test-Manifest; §5 gilt seit [ADR-0041](0041-notion-listen-uebernehmen.md) auch für Notion-Einträge (Nachtrag); Nachtrag „Aktionsmenüs“ (2026-10-01): Menü „•••“ im Kopf von Panel und Vollansicht und in den Zeilen der Tabelle; Nachtrag „Rechtsklick“ (2026-10-01, AM-3): Rechtsklick und Umschalt+F10 öffnen das Zeilenmenü, die Sammel-Leiste sagt „In den Papierkorb …“
- **Datum:** 2026-09-28
- **Entscheidung durch:** Nutzer (Arbeitspaket „Bulk & Inline & Ansicht“: Öffnungsmodus wie in Jira, Auswahlspalte mit Sammelaktionen und Rückgängig, Inline-Bearbeitung in Zellen), Advisor (Umfang, Reihenfolge, Anforderungen an die Architektur), Executor (Einzelheiten, Wahl der Architektur)
- **Präzisiert:** [ADR-0025](0025-ui-konsistenz-overlay-system.md) §7 (Vollansicht „über dem Panel“, Schließen „zurück ins Panel“), siehe dort Nachtrag 15; [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md) (Auswahlspalte der Aufgaben, Nachtrag 2); [ADR-0029](0029-glas-materialien.md) §1 (Sammel-Aktionsleiste auf Glas)
- **Bezug:** [ADR-0006](0006-frontend-zustand-und-datenzugriff.md) (Zustand im `(app)`-Layout), [ADR-0009](0009-fehlerfarbe.md) (Rot nur für echte Fehler), [ADR-0014](0014-datenmodell-eingang.md) (`source_date`), [ADR-0022](0022-erzeugung-von-instanzen.md) und [ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) (Folgetickets, Wiedereröffnen), [ADR-0031](0031-herkunft-sichern.md) Nachtrag B (Löschen mit Quellen), [ADR-0032](0032-editor-tiptap-markdown.md) §6 (`expected_updated`), [ADR-0033](0033-unteraufgaben.md) §2 (Sperre durch Unteraufgaben)

## Kontext

- Ein Ticket öffnet heute immer im Seitenpanel. „Vollansicht“ im Kopf des Panels legt ein XL-Modal **über** das Panel, das darunter gemountet bleibt; × der Vollansicht führt zurück ins Panel. Jira merkt sich dagegen, wie der Nutzer ein Ticket zuletzt geöffnet hat, und öffnet das nächste genauso.
- Wer die Vollansicht bevorzugt, braucht heute zwei Klicks je Ticket, und das Panel blitzt dabei kurz auf.
- Sammelaktionen und die Bearbeitung in Zellen (BI-2, BI-3) kommen danach und werden in diesem ADR ergänzt.

## Entscheidung

### 1. Öffnungsmodus: Seitenpanel oder Vollansicht, gemerkt pro Gerät (BI-1)

- **Zwei Modi:** „Seitenpanel“ (Standard) und „Vollansicht“. Gemerkt in `localStorage` unter `byl-ticket-open`; gespeichert wird nur `full`, „Seitenpanel“ entfernt den Schlüssel (wie `byl-transparency`). Andere Werte, ein gesperrter oder voller Speicher zählen als „Seitenpanel“, ohne Fehler. Ein `storage`-Listener gleicht andere Tabs ab. Nur auf dem Gerät, nicht pro Nutzer bis E7 und nicht in der URL, wie die Spalten (ADR-0030 §5).
- **Gesetzt wird er nur durch eine ausdrückliche Wahl:** „Vollansicht öffnen“ im Kopf des Panels setzt „Vollansicht“, der neue Knopf **„Im Seitenpanel öffnen“** im Kopf der Vollansicht setzt „Seitenpanel“. Mit Strg, Cmd oder Umschalt (neuer Tab oder neues Fenster) wird nichts gemerkt. Ein direkter Aufruf der Adresse, Neuladen oder Zurück ändern nichts.
- **Der Knopf** steht an derselben Stelle wie „Vollansicht öffnen“ im Panel (vor dem ×, nach „Löschen …“), als `.button-icon`-Link mit dem gespiegelten Symbol der zwei Pfeile, `aria-label` und `title` „Im Seitenpanel öffnen“. Er ist ein Link auf `/tickets/<id>`, also auch per Mittelklick nutzbar.
- **Wo der Modus gilt:** in jedem Ticket-Link der App, außer in der Vollansicht selbst (dort bleiben Pfad und Unteraufgaben Links auf Vollansichten): Zeilen der Tabelle (Titel-Link und Zeilenklick), Pfad und „Unteraufgaben“ im Panel, „Übergeordnet“, der Chip „→ HAUS-12“ und „Ticket ansehen“ im Eingang, „Ticket öffnen“ im Panel eines Eintrags, Links der Wiederholungen, Ergebnisse von Schnellerfassung, Datei-Import und Sammelumwandeln. Nach „Neues Ticket“ bleibt das neue Ticket im Panel, weil das Formular dort stand.
- **Nie beide zugleich:** Die Vollansicht **ersetzt** das Panel. Auf `/tickets/<id>/voll` ist das Panel nicht gemountet, die Ansicht hat keine Panel-Spalte (`ViewWithPanel` mit `withPanel` falsch), und die Liste steht in voller Breite hinter dem Modal. Weil Panel und Vollansicht allein aus der Route folgen, zeigt auch Zurück und Vor nie beide. Ist „Vollansicht“ gemerkt, verlinkt die Zeile direkt auf `/voll`; das Panel mountet dabei nie und blitzt nicht auf.
- **Schließen der Vollansicht** (×, Esc, Schleier) führt zur **Liste ohne Panel** mit derselben Query; der Fokus geht auf den Titel-Link der Zeile des Tickets (sonst regelt `TicketTable` ihn wie beim Schließen des Panels).
- **Unter 64rem** (das Panel liegt als Overlay über der Liste) bleibt das bisherige Verhalten: Links öffnen das Panel, „Vollansicht“ legt das Modal über die Liste, Schließen führt zurück ins Panel mit Fokus auf „Vollansicht öffnen“. Eine Wahl dort wird **nicht** gespeichert, damit ein schmales Fenster die Vorliebe des breiten nicht überschreibt; wird das Fenster breit, gilt die gemerkte Wahl wieder (`matchMedia`, dieselbe Grenze wie `PANEL_EMBEDDED_QUERY`).
- **Ungespeicherte Änderungen:** Entwürfe liegen in den Stores (`TicketDetailStore`, `TicketActivityStore`), nicht in den Komponenten. Der Wechsel zwischen Panel und Vollansicht **desselben** Tickets verliert deshalb nichts und fragt nicht (wie bisher). Erst wer das Ticket verlässt, bekommt die bestehende Frage „Änderungen verwerfen?“, aus der Vollansicht inline (`TicketLeaveQuestion`), sonst als Bestätigung.
- **Umsetzung:** reine Regeln in `web/src/lib/domain/open-mode.ts` (`parseOpenMode`, `serializeOpenMode`, `effectiveOpenMode`), `TicketOpenModeStore` in `web/src/lib/stores/open-mode.svelte.ts` im Kontext des `(app)`-Layouts; Komponenten holen die Links über `ticketLinks()` (ohne Kontext, etwa in Tests einzelner Komponenten, gilt das Panel). `ViewWithPanel` rendert den Inhalt der Route ohne Panel mit `display: contents`, weil ein Modal unter einem Vorfahren mit `display: none` nicht erscheint.

### 2. Auswahl in der Tabelle „Aufgaben“ (BI-2)

- **Eigene Spalte** `select` („Auswahl“, fest 2,5rem, Pflicht, nicht im Menü „Spalten“, ganz vorn) mit einer Checkbox je Zeile, Name „HAUS-12 auswählen“. Sie ist vom Häkchen „HAUS-12 erledigt“ in der Spalte „Aktionen“ am Zeilenende getrennt: anderer Ort, anderer Name. Die ganze Zelle ist das `label`: Ein Klick irgendwo in die Zelle wählt, öffnet nie das Ticket (die Zeile ignoriert Klicks in `[data-col="select"]`). Eine gewählte Zeile trägt die Akzentfläche wie die geöffnete.
- **Umschalt+Klick** wählt bzw. hebt einen Bereich auf, vom Anker (letzter Klick ohne Umschalt) bis zur Zeile, in der Reihenfolge auf dem Bildschirm (offen, dann „Erledigt“, Gruppen wie gezeigt). Ein zweiter Umschalt+Klick behält den Anfang und verschiebt nur das Ende. Umschalt wird beim Drücken des Zeigers bzw. der Taste in der Zelle gemerkt, weil der Klick auf das `label` die Taste nicht verlässlich an die Checkbox weitergibt.
- **Kopf-Checkbox** „Alle angezeigten Tickets auswählen“: wählt alle Tickets, die die Filter bestehen (offen und, wenn angezeigt, erledigt, auch in zugeklappten Gruppen), oder hebt sie auf, wenn alle gewählt sind; `indeterminate`, wenn nur einige gewählt sind. Eine Auswahl über Gruppenköpfe gibt es nicht (siehe Alternativen).
- **Filterwechsel:** Gewählt bleiben nur Tickets, die weiter angezeigt werden; wer herausfällt, ist auch nach dem Zurücksetzen des Filters nicht mehr gewählt. Dasselbe gilt für Tickets, die durch eine Aktion die Liste verlassen (gelöscht, erledigt ohne „Erledigte anzeigen“).
- **Esc** irgendwo in der Tabelle oder der Leiste hebt die Auswahl auf (verbraucht, nicht in Textfeldern; Popover und Dialoge verbrauchen ihr Esc vorher). Dazu „Auswahl aufheben“ (×) in der Leiste. Die Auswahl lebt nur in der Tabelle, nicht in der URL und nicht im Speicher.
- **Spalten:** Die Schwellen der Aufgaben-Tabelle steigen um die 2,5rem der Auswahl (ADR-0030 Nachtrag 2); die Reihenfolge beim Ausweichen bleibt.

### 3. Sammelaktionen: clientgesteuerte Einzelaufrufe (BI-2)

- **Entscheidung:** Jede Sammelaktion schickt **je Ticket eine Anfrage über denselben Weg wie die Einzeländerung** (Record-API `PATCH tickets/{id}` bzw. die Route „Ticket löschen mit Quellenbehandlung“), höchstens `BULK_CONCURRENCY` = 4 gleichzeitig (`BulkEditStore` in `stores/bulk-edit.svelte.ts`, Regeln rein in `domain/bulk.ts`). Es gibt **keinen** eigenen Bulk-Endpunkt.
- **Begründung:**
  - Die Regeln hängen an den Request-Hooks von `tickets` (`onRecordUpdateRequest`): handelnder Nutzer für den Verlauf, `expected_updated`, `force`/`complete_children`, Schutz von `recurrence` und `source`, dazu die `updateRule` der API. Eine Hook-Route mit `$app.save()` durchliefe nur die Model-Hooks; sie müsste Rechte, Verlauf und diese Wächter nachbauen und würde sie über kurz oder lang umgehen. Genau das schließt die Anforderung aus.
  - Fehler pro Ticket und Teil-Erfolg ergeben sich von selbst: Jede Anfrage hat ihre eigene Transaktion und Antwort. Eine Route, die alles in einer Transaktion ausführt, müsste bei einem Fehler entweder alles zurückrollen (kein Teil-Erfolg) oder eigene Teiltransaktionen bauen.
  - Fortschritt ist im Client ohne Streaming oder Polling möglich (Zähler je fertiger Anfrage). Die App läuft lokal (127.0.0.1); 4 parallele Anfragen halten SQLite und die UI ruhig, auch bei einigen hundert Tickets.
  - Realtime-Ereignisse, Keys, Folgetickets und Quellen kommen genau wie bei Einzeländerungen; es gibt keinen zweiten Codepfad zu testen.
- **Kosten:** Nicht atomar über Tickets (gewollt: Teil-Erfolg), n Anfragen statt einer. Bricht die Sitzung ab, hört die Aktion nach den laufenden Anfragen auf (Abmelden einmal, kein Ergebnis).
- **Aktionen** (Leiste „N Tickets ausgewählt“, Glas nach ADR-0029, `sticky` über der Tabelle):
  - „Fälligkeit …“ (Modal S): Datum setzen, verschieben um N Tage oder Wochen (auch negativ, ganze Zahl ungleich 0 bis ±3650; ohne Fälligkeit übersprungen), leeren, „Datum der Quelle übernehmen“ (§5).
  - „Priorität“ und „Status“ als Menüs (Popover `menu`), sofort ausgeführt; „Status: Erledigt“ läuft wie „Erledigen“.
  - „Projekt …“ (Modal S, `ProjectSelect`): wie der Einzel-Projektwechsel, jedes Ticket bekommt vom Hook einen neuen Key im Ziel-Nummernkreis, der alte steht im Verlauf.
  - „Tags …“ (Modal M): hinzufügen mit der Tag-Eingabe des Tickets (`TagPicker`, neue Namen werden neue Tags) oder entfernen per Checkbox aus den Tags der gewählten Tickets; jedes Ticket behält seine übrigen Tags in ihrer Reihenfolge.
  - „Erledigen“: gewählte Unteraufgaben zuerst, dann die übrigen. Hat ein gewähltes Ticket offene blockierende Unteraufgaben, die nicht selbst gewählt sind, fragt ein `ConfirmDialog` mit der Checkbox „Unteraufgaben mit erledigen“ (an). Mit ihr sendet der Store `complete_children` (atomar im Hook, ADR-0033 §2), ohne sie nichts, und der Hook lehnt ab; das Ticket steht dann mit „2 Unteraufgaben sind noch offen (HAUS-3, HAUS-4).“ im Ergebnis. „Trotzdem erledigen“ (`force`) gibt es nur einzeln, damit eine Sammelaktion nie still offene Unteraufgaben zurücklässt. Das Folgeticket einer Serie legt der Server an wie beim Häkchen (ADR-0022 §4).
  - „Löschen …“: `ConfirmDialog` „N Tickets endgültig löschen?“ mit „Das lässt sich nicht rückgängig machen.“, der Zahl der Quellen (eine Anfrage über alle verknüpften Einträge) und, wenn es welche gibt, derselben Wahl wie beim Einzellöschen (`SourceHandlingChoice`, „Quellen zurück in den Eingang“ vorausgewählt). Solange die Zahl lädt, nimmt der Server den sicheren Standard.
- **Unverändert** zählen Tickets, die den Wert schon haben (keine Anfrage). **Ergebnis:** ein Flag „3 Tickets geändert, 1 unverändert, 2 übersprungen, 1 fehlgeschlagen.“; bei Problemen dazu unter der Leiste die Liste je Ticket mit Key und Grund: abgelehnte oder gescheiterte Anfragen als Fehler (`.alert-error`, `role="alert"`), übersprungene neutral (`SectionMessage` info). Nur wenn gar nichts geändert wurde und Anfragen scheiterten, ist das Flag ein Fehler. Während eine Aktion läuft, ersetzt ein Fortschrittsbalken („Priorität ändern: 3 von 12 Tickets“, `role="status"`) die Knöpfe.

### 4. Rückgängig (BI-2)

- Nach jeder Feldänderung und nach „Erledigen“ bietet das Erfolgs-Flag „Rückgängig“ für seine Laufzeit (8 s, pausiert wie jedes Flag, ADR-0025 §8). Eine neue Sammelaktion ersetzt das Angebot, „Löschen“ bietet keins.
- „Rückgängig“ schreibt je geändertem Ticket genau die geänderten Felder mit ihren Werten von vorher zurück, über denselben Weg und mit `expected_updated` = `updated` nach der Änderung. Wurde ein Ticket inzwischen anders geändert, lehnt der Hook ab (`validation_description_stale`, ADR-0032 §6) und das Ticket steht mit „Wurde inzwischen geändert, nicht zurückgesetzt.“ im Ergebnis: nichts wird still überschrieben.
- Nach „Erledigen“ ist Rückgängig das Wiedereröffnen mit dem Status von vorher, dann die mit erledigten Unteraufgaben (wie das Flag des Häkchens, ADR-0033 §2). Steht ein bearbeitetes Folgeticket einer Serie entgegen, lehnt der Hook nach `reopenConflicts` ab (ADR-0023 §3 und Nachtrag 2); der Grund des Hooks steht beim Ticket im Ergebnis.
- Ein zurückgesetzter Projektwechsel gibt dem Ticket einen **weiteren neuen** Key im alten Projekt, nicht den alten Key: Zähler zählen nie zurück (CLAUDE.md §5).

### 5. „Datum der Quelle übernehmen“ und „Datum des Termins als Fälligkeit“ (BI-2)

- **Welche Quellen ein Datum liefern:** nur Einträge der Art `event`, also Kalendertermine aus `.ics`-Dateien und Google Calendar, mit gesetztem `source_date`. Ihr Datum ist ein Termin, das Datum von Mail, Nachricht, Chat oder Link dagegen der Zeitpunkt des Sendens oder Empfangens und keine Fälligkeit (ADR-0014: „Wird nie automatisch zur Fälligkeit“). Maßgeblich ist das Berliner Kalenderdatum des Beginns, auch bei ganztägigen Terminen (sie beginnen um Mitternacht in Berlin).
- **Sammelaktion:** Es zählt nur die **Hauptquelle** (`source_item`, aus ihr entstand das Ticket), nicht später verknüpfte Quellen. `listSourceEventDates` holt in einer Anfrage alle Termine, die Hauptquelle ihres Tickets sind (`kind = event && ticket.source_item = id`); Tickets ohne solche Quelle werden mit „Die Hauptquelle ist kein Termin mit Datum.“ übersprungen.
- **Umwandeln:** „Gesammelt umwandeln“ hat bei gewählten Terminen die Checkbox „Datum des Termins als Fälligkeit“ (aus, mit der Zahl der betroffenen Termine); andere Einträge bleiben ohne Fälligkeit (`eventDueDate` in `domain/inbox.ts`). Einzeln gibt es das seit E4 als „Als Fälligkeit übernehmen“ neben dem Quelldatum in „Neues Ticket“. Beides nur auf Wunsch, P-5 bleibt.

### 6. Bearbeiten in Zellen (BI-3)

- **Welche Zellen:** Priorität, Status, Projekt, Tags und Fälligkeit der Tabelle „Aufgaben“. Ihr Wert ist ein Knopf, der die Zelle füllt (`EditableCell` in `components/table/`), und öffnet ein kleines Popover nach ADR-0025 §5: Priorität, Status und Projekt als Menü (`menuitemradio`, der aktuelle Wert mit Haken und Gewicht; Projekt mit „Kein Projekt“ und den aktiven Projekten in Baum-Reihenfolge, „Haus › Garten (GART)“), die Fälligkeit als Formular mit dem Datumsfeld, „Übernehmen“ und „Leeren“, die Tags mit der Tag-Eingabe des Tickets (`TagPicker`: Komma, Enter, Rücktaste, neue Namen werden Tags; jede Änderung speichert sofort wie im Panel).
- **Klick und Tastatur:** Ein Klick in eine dieser Zellen öffnet den Editor, nie das Ticket; auch Klicks im Popover erreichen die Zeile nicht (die Zeile ignoriert `[popover]`). Außerhalb dieser Zellen öffnet der Zeilenklick das Ticket im gemerkten Modus (§1), das Symbol „Öffnen“ bleibt. Tab erreicht jede Zelle, Enter oder Leertaste öffnet, in Menüs wählen Pfeiltasten und Enter übernimmt, im Formular übernimmt Enter, Esc schließt ohne zu speichern; der Fokus kehrt jedes Mal zur Zelle zurück (Popover). Name des Knopfs: „Priorität von HAUS-12: Hoch, ändern“.
- **Hinweis beim Zeigen:** eine dezente Füllung (`--fill-control-hover`) und ein kleiner Stift, der bei Zeiger, Tastaturfokus und offenem Editor erscheint. Keine neuen Tokens.
- **Gleiche Regeln wie im Ticket:** Gespeichert wird über `TicketListStore.changeField` mit derselben Record-API wie im Panel; der Hook vergibt bei einem anderen Projekt den neuen Key, schreibt den Verlauf und legt Folgetickets an. „Erledigt“ läuft über den Weg des Häkchens (`setDone`): mit offenen blockierenden Unteraufgaben erst die bekannte Frage (ADR-0033 §2), danach das Flag mit „Rückgängig“.
- **Keine optimistische Anzeige:** Die Zelle zeigt den Wert erst mit der Antwort des Servers. Key, Erledigen und das Folgeticket einer Serie entstehen im Hook; ein vorher gezeigter Wert ließe sich nicht in jedem Fall sauber zurückrollen (Key, Unteraufgaben, Serie). Der Server läuft lokal, die Antwort kommt sofort; währenddessen ist die Zeile gesperrt (`aria-busy`-ähnlicher Zustand am Knopf, das Häkchen ist gesperrt).
- **Fehler:** Eine Ablehnung erscheint als Fehler-Flag „HAUS-12 konnte nicht geändert werden. <Grund>“, die Zelle behält ihren Wert. Ein falsches Datum bleibt am Feld im Popover.
- **Kosten:** bis zu fünf weitere Tab-Stopps je Zeile. Die Editoren rendern erst, wenn eine Zelle gezeigt oder fokussiert wird, damit große Listen nicht jedes Menü im DOM tragen.

## Alternativen

- **Modus in der URL** (`?ansicht=voll`): Jede Adresse trüge ihn, Links aus anderen Ansichten müssten ihn kennen, und eine geteilte Adresse würde die Vorliebe eines anderen Geräts aufzwingen. Verworfen, wie bei den Spalten.
- **Modus pro Nutzer in PocketBase:** braucht Migration und API-Regel und bringt vor E7 nichts. Zurückgestellt.
- **Vollansicht weiter über dem gemounteten Panel:** Zwei Instanzen derselben Teile (Beschreibung, Felder) liefen gleichzeitig, das Panel blitzt beim direkten Öffnen auf, und die Liste bliebe gestaucht hinter dem Modal. Verworfen.
- **Jeder Wechsel merkt den Modus, auch per Neuladen oder Zurück:** Ein Zurück aus der Vollansicht würde die Wahl still umstellen. Verworfen; nur die zwei Knöpfe merken.
- **Unter 64rem die Wahl ebenfalls speichern:** Auf einem schmalen Fenster gibt es kein eingebettetes Panel, das man „wählen“ könnte; die Vorliebe des breiten Fensters ginge verloren. Verworfen.
- **Eigener Bulk-Endpunkt** (`POST /api/byl/tickets/bulk` in einer Hook-Route, alle Änderungen in einer Transaktion): eine Anfrage und atomar, aber die Route umginge die Request-Hooks und die API-Regeln (§3) oder müsste sie nachbauen; Teil-Erfolg und Fortschritt bräuchten eigene Mechanik, und es gäbe einen zweiten Weg für dieselbe Änderung. Verworfen.
- **PocketBase-Batch-API** (`/api/batch`): müsste per Einstellung eingeschaltet werden, bricht beim ersten Fehler alles ab (kein Teil-Erfolg) und meldet keinen Fortschritt (dieselbe Abwägung wie beim Sammelumwandeln, ADR-0014 §4). Verworfen.
- **Rückgängig ohne Prüfung auf zwischenzeitliche Änderungen:** Würde eine Änderung aus einem anderen Tab still überschreiben. Verworfen zugunsten von `expected_updated`.
- **Rückgängig auch für „Löschen“:** geht ohne Papierkorb nicht (Kommentare, Verlauf und Keys sind weg). Kommt mit dem Papierkorb (ADR-0037, reserviert).
- **Optimistische Anzeige in Zellen:** Der neue Wert stünde sofort da, müsste aber bei einer Ablehnung zurückgerollt werden; bei Projekt (Key), Status (Unteraufgaben, Serie) ist das nicht sauber möglich, und eine halbe Lösung nur für Priorität und Fälligkeit wäre uneinheitlich. Verworfen (§6).
- **Bearbeiten per Doppelklick oder eigenem Bearbeiten-Modus der Tabelle (Grid-Muster mit Pfeiltasten):** näher an Tabellenkalkulationen, aber ein eigenes Tastaturmodell (`role="grid"`, Roving-Tabindex) für die ganze Tabelle und ein zweiter Klick. Verworfen zugunsten eines Knopfs je Zelle mit dem bekannten Popover.
- **Auswahl über Gruppenköpfe:** ein zusätzlicher Tab-Stopp je Gruppe neben dem Aufklapp-Knopf und eine unklare Bedeutung bei zwei Ebenen und zugeklappten Gruppen. Zurückgestellt; die Kopf-Checkbox und Umschalt+Klick decken den Bedarf.
- **„Datum der Quelle“ auch aus Mails und Nachrichten:** Deren Datum ist das Senden, keine Frist; eine Fälligkeit daraus wäre fast immer falsch (P-5). Verworfen.

## Konsequenzen

- Positiv: Wer die Vollansicht bevorzugt, öffnet Tickets mit einem Klick, ohne Aufblitzen; die Liste bleibt dahinter in voller Breite. Keine Migration, kein Neustart.
- Negativ: Die Vollansicht ist nicht mehr „über dem Panel“; ADR-0025 §7 und CLAUDE.md §7 sind nachgezogen (Nachtrag 15 in ADR-0025).
- Die Tests einzelner Komponenten laufen ohne Kontext weiter mit dem Panel; die Route des Tickets und die Tabelle haben eigene Fälle mit einem Store (BYL-E6-320).
- Sammelaktionen brauchen keine Änderung an Hooks und keine Migration; jede Regel der Einzeländerung gilt, belegt gegen PocketBase in `tests/integration/web-data-bulk.test.mjs`. Die Glas-Allowlist hat eine zehnte Datei (`BulkActionBar.svelte`).
- Hinweise für den Papierkorb: siehe [Plan](../plan/bulk-inline-ansicht.md) §6.

## Nachtrag (2026-09-28, Papierkorb, ADR-0037)

- „Löschen“ je Ticket über die Route „Ticket löschen mit Quellenbehandlung“ verschiebt seit PB-1 in den Papierkorb; die Antwort `{ id, updated, tickets }` trägt die Grundlage für „Rückgängig“. §4 „‚Löschen‘ bietet keins“ entfällt mit PB-2: „Rückgängig“ ist das Wiederherstellen je Ticket mit `expected_updated` (derselbe Maßstab wie nach Feldänderungen), Konflikte stehen je Ticket im Ergebnis („Wurde inzwischen wiederhergestellt oder geändert.“).
- Übergeordnete Tickets gehen zuerst: Ihre gewählten Unteraufgaben gehen als Gruppe mit (ein Eintrag zum Rückgängigmachen), eine danach schon verschobene Unteraufgabe (404) zählt als verschoben.
- Die Frage heißt „N Tickets in den Papierkorb verschieben?“ mit „In den Papierkorb“ und nennt die Aufbewahrung; „nicht rückgängig“ steht nur noch beim endgültigen Löschen im Papierkorb.
- Das Glas der Leiste (§3) steht seit PB-2 im gemeinsamen Baustein `SelectionBar`, den auch der Papierkorb nutzt (ADR-0029, Nachtrag).

## Nachtrag (2026-09-29, Notion, ADR-0041)

§5 gilt seit Paket NI-2 auch für Einträge aus Notion ([ADR-0041](0041-notion-listen-uebernehmen.md) §8): Ihr `source_date` stammt aus einer Datumseigenschaft der Liste, die der Nutzer dort selbst gesetzt hat, und ist damit wie ein Termin eine Fälligkeit auf Wunsch, kein Zeitpunkt des Sendens.

- **Umwandeln:** `eventDueDate` in `domain/inbox.ts` nimmt neben `kind = event` auch `channel = notion` mit gesetztem `source_date`. „Gesammelt umwandeln“ zeigt die Checkbox „Datum des Termins als Fälligkeit“ auch bei gewählten Notion-Einträgen mit Datum; der Hinweis nennt dann „Einträge mit Datum aus Terminen oder aus Notion“. Die Checkbox bleibt aus, bis der Nutzer sie setzt (P-5).
- **Sammelaktion „Datum der Quelle übernehmen“:** `listSourceEventDates` fragt `(kind = event || channel = notion)` ab; der Grund beim Überspringen heißt „Die Hauptquelle ist kein Termin und kein Notion-Eintrag mit Datum.“. Maßgeblich bleibt das Berliner Kalenderdatum, belegt in `tests/integration/web-data-bulk.test.mjs`.
- Mail, Nachricht, Chat und Link bleiben ausgenommen.

## Nachtrag (2026-10-01, Plan „Aktionsmenüs“): Menü „•••“ im Kopf des Tickets und in den Zeilen

Nutzerentscheidung vom 2026-10-01: Aktionsmenüs „•••“, „beides, aber vorrangig für das Ticket selbst“ ([Plan](../plan/aktionsmenues.md)).

**AM-1, Kopf von Panel und Vollansicht** (präzisiert §1 „Der Knopf“; der Öffnungsmodus bleibt unverändert):

- Im Kopf stehen als Symbole nur noch die häufigen, an ihren Platz gebundenen Aktionen: „Vollansicht öffnen“ im Panel bzw. „Im Seitenpanel öffnen“ in der Vollansicht, jeweils direkt vor dem ×, und davor das Menü „•••“ („Weitere Aktionen“) mit „Link kopieren“, „Duplizieren …“ ([ADR-0045](0045-ticket-duplizieren.md), Nachtrag) und „In den Papierkorb …“ ([ADR-0037](0037-papierkorb.md), bisher der Textknopf „Löschen …“). „Im Seitenpanel öffnen“ steht also „nach ‚•••‘“ statt „nach ‚Löschen …‘“.
- Nur die zwei Knöpfe des Kopfs merken den Modus, wie bisher. Die Einträge des Menüs ändern ihn nicht.
- „Link kopieren“ kopiert die Adresse `/tickets/<id>` ohne den Zustand der Liste (absolut); sie öffnet das Panel. Ein direkter Aufruf ändert den gemerkten Modus nicht (§1).

**AM-2, Zeilenmenü der Tabelle „Aufgaben“** (ergänzt §1 „Wo der Modus gilt“ und §6 „Klick und Tastatur“):

- Jede Zeile endet in der Spalte „Aktionen“ nach dem Häkchen und „Öffnen“ mit „•••“ („Weitere Aktionen für HAUS-12“): „Im Seitenpanel öffnen“, „In Vollansicht öffnen“, Linie, „Link kopieren“, „Duplizieren …“ und nach einer Linie „In den Papierkorb …“. Das Symbol „Öffnen“ bleibt.
- **Öffnungsmodus:** Die zwei Links öffnen das Ticket so, wie sie heißen, unabhängig vom gemerkten Modus, und merken nichts. Gesetzt wird der Modus weiter nur von „Vollansicht öffnen“ und „Im Seitenpanel öffnen“ im Ticket (§1): Dort wählt der Nutzer seine Vorliebe, im Zeilenmenü einmalig einen anderen Weg, wie mit einem Mittelklick. Zeilenklick, Titel-Link und „Öffnen“ folgen weiter dem gemerkten Modus.
- **Klick:** „•••“ und sein Menü öffnen die Zeile nie (die Zeile ignoriert Knöpfe und `[popover]` wie bei den Zellen, §6) und ändern die Auswahl nicht (§2); Esc im Menü schließt nur das Menü. „•••“ ist ein Tab-Stopp der Zeile.
- **Dialoge:** Die Tabelle ist kein Modal; „Duplizieren …“ und „In den Papierkorb …“ öffnen dieselben Dialoge wie im Panel. Sie laden vorher, was ihre Frage braucht (Beschreibung, Quellen, Zahl der Kommentare bzw. der Quellen); solange trägt die Zelle `aria-busy`. Verschoben wird wie im Panel mit „Rückgängig“; ist das Ticket im Panel offen, schließt sich das Panel.
- Einzelheiten, Gründe für die anderen Tabellen und den nicht umgesetzten Rechtsklick: [Plan](../plan/aktionsmenues.md) §3; die Breite der Spalte: [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md), Nachtrag 4.

## Nachtrag (2026-10-01, Plan „Aktionsmenüs“, AM-3): Rechtsklick und Tastatur öffnen das Zeilenmenü; Sammel-Leiste „In den Papierkorb …“

**Anlass:** Nutzerentscheidung vom 2026-10-01, „Alle Verbesserungen einpflegen“: die Folgepunkte des [Plans](../plan/aktionsmenues.md) §4 (Sammel-Leiste, Rechtsklick, Zeilenmenüs der übrigen Tabellen). Dieser Nachtrag gilt den ersten beiden; er ergänzt den Nachtrag „Aktionsmenüs“ (AM-2) und hebt dort nur „kein Rechtsklick“ auf.

**Entscheidung:**

- **Rechtsklick auf eine Zeile** der Tabelle „Aufgaben“ öffnet dasselbe Menü wie „•••“ (derselbe Baustein, dieselben Einträge und Fragen), aber **am Mauszeiger**: die obere linke Ecke am Zeiger, ohne Abstand. Fehlt rechts der Platz und ist links mehr, klappt es nach links, unten entsprechend nach oben; was dann noch nicht passt, wird mit 8 px Rand ins Fenster geklemmt (`placeAtPoint` in `lib/overlay/position.ts`). Beim Scrollen folgt es seiner Zeile, weil der Zeiger als Abstand zum Knopf „•••“ gemerkt wird.
- **Tastatur:** Umschalt+F10 und die Kontextmenü-Taste öffnen das Menü der Zeile, in der der Fokus steht (Titel, Zellen, Auswahl, Häkchen, „•••“), unter dem fokussierten Element; der erste Eintrag bekommt den Fokus, die Tastatur des Menüs bleibt (ADR-0025 §5). Esc und jede Wahl geben den Fokus an das Element zurück, das ihn vorher hatte; nach einem Rechtsklick ohne fokussiertes Element an „•••“ der Zeile, wie bisher.
- **Das Menü des Browsers bleibt** (in dieser Reihenfolge geprüft, rein in `keepsBrowserMenu` in `lib/overlay/context-menu.ts`):
  1. **mit gedrückter Strg-Taste**, überall in der Zeile. Begründung: ein Weg zum Menü des Browsers, ohne die Zeile zu verlassen (Untersuchen, Link in neuem Tab, Kopieren). Strg ändert einen Rechtsklick unter Windows in keinem der Zielbrowser; Umschalt dagegen erzwingt in Firefox ohnehin das Browser-Menü und wäre nicht in allen Browsern gleich, Alt öffnet beim Loslassen die Menüleiste.
  2. **bei Touch** (langes Drücken). Begründung: Langes Drücken markiert Text, zeigt die Vorschau eines Links und beginnt Ziehen; ein eigenes Menü dort konkurriert mit Scrollen und Markieren. Erzwungen wird nichts, „•••“ bleibt der Weg.
  3. **auf markiertem Text**, wenn der Rechtsklick in der Markierung liegt (Kopieren); eine Markierung anderswo hält das Menü der Zeile nicht auf.
  4. **in Popovern und Eingabefeldern**: in den Editoren der Zellen (ihre Felder, Menüs und Links), im offenen Menü selbst (seine Einträge „Im Seitenpanel öffnen“ und „In Vollansicht öffnen“ sind echte Links) und in Feldern zum Tippen (`input` außer Checkbox, Radio und Knöpfen, `textarea`, `select`, `contenteditable`).
  5. **auf echten Links**, außer dem Link der Zeile selbst (`data-row-link`: Titel und „Öffnen“). Deren Ziele bietet das Menü an („Im Seitenpanel öffnen“, „In Vollansicht öffnen“, „Link kopieren“), und der Titel ist der größte Teil der Zeile; ein Rechtsklick dort zeigt deshalb das Menü der Zeile. Mittelklick und Strg+Klick öffnen ihn weiter in einem neuen Tab, Strg+Rechtsklick zeigt das Menü des Browsers.
- **Kein Öffnen, keine Auswahl:** Ein Rechtsklick ist kein `click`; die Zeile reagiert nur auf die linke Taste (§6), die Auswahl nur auf ihre Checkbox (§2). Ein Klick daneben schließt das Menü, wie jedes Popover. Kopfzeilen, Gruppenköpfe und Zeilen ohne „•••“ behalten das Menü des Browsers.
- **macOS und Linux:** Dort kommt das Ereignis `contextmenu` schon beim Drücken, und das Light-Dismiss der Popover beim Loslassen würde das Menü sofort wieder schließen. Ist die rechte Taste noch gedrückt, öffnet das Menü deshalb nach dem Loslassen. Unter Windows kommt das Ereignis erst nach dem Loslassen.
- **Unterbau** (präzisiert [ADR-0025](0025-ui-konsistenz-overlay-system.md) §5, ohne es aufzuheben): Ein Popover lässt sich per Code an einem virtuellen Anker öffnen (`open(anchor, returnTo)`: Zeiger oder Element, dazu das Element, das den Fokus zurückbekommt); ein Klick auf seinen Knopf öffnet es wieder darunter. Die Tabelle hängt einen Satz Listener an (`{@attach rowMenus}`), sucht in der Zeile den Knopf `.row-menu` und bittet sein `ActionsMenu` mit dem Ereignis `byl-open-menu`, sich zu öffnen. So bleibt es ein Menü pro Zeile, kein zweiter Baustein.
- **Sammel-Leiste:** „Löschen …“ heißt jetzt **„In den Papierkorb …“**, wie der Eintrag des Menüs, die Frage („N Tickets in den Papierkorb verschieben?“), ihr Knopf („In den Papierkorb“) und das Flag. Der Fortschritt sagt „In den Papierkorb verschieben: 3 von 12 Tickets“. §3 ändert sich damit nur im Wortlaut.

**Alternativen:**

- **Browser-Menü mit Umschalt statt Strg:** in Firefox ohnehin so, in Chrome und Opera GX nicht; das Verhalten wäre je Browser verschieden. Verworfen.
- **Langes Drücken als Kontextmenü auf Touch:** Konflikte mit Markieren, Link-Vorschau und Scrollen. Verworfen.
- **Browser-Menü auch auf dem Titel:** Auf dem größten Teil der Zeile träfe der Rechtsklick nicht das Menü der Zeile. Verworfen; die Ziele des Links stehen im Menü.
- **Umschalt+F10 öffnet das Menü an „•••“:** Der Blick spränge ans Zeilenende, weg vom Fokus. Verworfen zugunsten des fokussierten Elements.
- **Ein eigener Baustein für Kontextmenüs:** zwei Menüs für dieselben Einträge, zwei Tastaturmodelle. Verworfen; der Popover hat einen virtuellen Anker bekommen.

**Tests:** `overlay/position.test.ts` (`placeAtPoint`), `overlay/context-menu.test.ts` (Regeln und Tasten), `components/ticket-table-row-menu.test.ts` (Rechtsklick, Umschalt+F10, Kontextmenü-Taste, Browser-Menü, kein Öffnen und keine Auswahl, Fokus), `components/ticket-table-selection.test.ts` und `domain/bulk.test.ts` (Sammel-Leiste); Manifest BYL-E6-760 bis BYL-E6-764.
