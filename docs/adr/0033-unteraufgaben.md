# ADR-0033: Unteraufgaben: eine Ebene, Fortschritt, Einrücken in der Tabelle und „blockiert das übergeordnete Ticket“

- **Status:** Angenommen und umgesetzt in den Paketen UA-1 bis UA-5 nach [docs/plan/unteraufgaben.md](../plan/unteraufgaben.md) (#118 bis #122); manuelle Browser-Prüfungen stehen im Test-Manifest; Nachtrag UT-1: Status beim Anlegen, Statusmenü, Vererbung und Serienbezug; Nachtrag TP-3: Anordnung wie §5 auch im Tagesplan, Ecke und Chip als Bausteine; Nachtrag QB-1: Frage aus §2 und Auswahl aus §4 in voller Breite
- **Datum:** 2026-09-28
- **Entscheidung durch:** Nutzer (Freigabe der Unteraufgaben am 2026-09-28 als ausdrückliche Anweisung nach CLAUDE.md §10), Advisor (Umfang und Bausteine), Executor (Regeln für Einrücken, Wiederholungen und Erledigen, Einzelheiten)
- **Ergänzt:** [ADR-0012](0012-plain-ticketing.md) und [ADR-0011](0011-roadmap-e3-bis-e7.md) (je ein Nachtrag), [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md) (Spalte „Übergeordnet“, Vorliebe „Unteraufgaben einrücken“), [ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) (Folgetickets)

## Kontext

Sub-Tickets standen bisher unter „Stufe 2, nur auf ausdrückliche Anweisung“ (CLAUDE.md §10, ADR-0011 §1, ADR-0012). Das Datenmodell ist seit E1 vorbereitet:

- `tickets.parent` ist eine Relation auf `tickets` (höchstens ein Ziel, Index `idx_tickets_parent`, ohne Cascade), `blocks_parent` ein bool mit dem Standard `true`, den der Create-Hook setzt. Beide Felder stehen in der Historie.
- `lib/ticket-rules.js` `parentViolation`: kein Selbstbezug, nur eine Ebene (das übergeordnete Ticket hat selbst keins), ein Ticket mit Unteraufgaben bekommt kein übergeordnetes.
- `lib/ticket-service.js`: Das übergeordnete Ticket muss im selben Scope liegen (`checkRelations`, `validation_scope_mismatch`), ein Ticket mit Unteraufgaben wechselt den Bereich nicht (`validation_ticket_has_children`). Wird das übergeordnete Ticket gelöscht, leert PocketBase `parent` der Unteraufgaben; der Verlauf hält es fest.

Es gibt keine Oberfläche, und `blocks_parent` hat keine Wirkung. Der Nutzer hat die Unteraufgaben am 2026-09-28 freigegeben.

## Entscheidung

### 1. Begriffe und Umfang

- **Unteraufgabe** ist ein normales Ticket mit `parent`. Es hat einen eigenen Key aus seinem Nummernkreis, eigenen Status, eigene Fälligkeit, eigenes Projekt und eigene Tags. Es gibt keinen Ticket-Typ (ADR-0012 bleibt).
- Genau eine Ebene. Ein Ticket mit Unteraufgaben heißt in der Oberfläche **übergeordnetes Ticket**.
- Das Datenmodell bleibt, wie es ist. Es gibt **keine Migration**: Die Hooks wirken in der laufenden Instanz sofort, die Oberfläche nach F5.

### 2. Erledigen mit offenen Unteraufgaben (`blocks_parent`)

- Wechselt ein Ticket nach `done` und hat es offene Unteraufgaben mit `blocks_parent = true`, lehnt der Update-Hook in seiner Transaktion ab: Feldfehler `validation_parent_open_children` am Feld `status`, `params` `{ count, keys }` (höchstens fünf Keys).
- Zwei Body-Felder, die nicht gespeichert werden (wie `expected_updated`, ADR-0032 §6):
  - `force: true` erledigt trotzdem; die Unteraufgaben bleiben offen.
  - `complete_children: true` erledigt in **derselben Transaktion** alle offenen blockierenden Unteraufgaben. Jede bekommt `completed_at` und einen Verlaufseintrag mit dem handelnden Nutzer. Gehört eine Unteraufgabe zu einer Serie, gilt ADR-0022 §4 wie beim Häkchen: Der Folgetermin steht mit dem Commit fest, das Folgeticket entsteht danach.
- Die Regel gilt für jedes Update über die Record-API, auch für den Superuser. Nicht blockierende Unteraufgaben (`blocks_parent = false`) zählen nicht und bleiben unberührt.
- Die SPA fragt vor dem Senden, weil sie die Unteraufgaben kennt: „N Unteraufgaben sind noch offen – trotzdem erledigen?“ mit der Wahl „Unteraufgaben mit erledigen“ (vorausgewählt) oder „Trotzdem erledigen“, dazu „Abbrechen“. Lehnt der Server trotzdem ab (etwa weil ein anderer Tab eine Unteraufgabe wieder geöffnet hat), stellt sie dieselbe Frage mit der Zahl des Servers.
- „Rückgängig“ im Flag nach „Unteraufgaben mit erledigen“ stellt das übergeordnete Ticket **und** die mit erledigten Unteraufgaben auf ihren vorigen Status zurück.

### 3. Wiederholungen

**Folgetickets haben keinen Parent.** Der Erzeugungsdienst (`newInstance`, ADR-0022 §2) übernimmt nur die Vorlage der Regel, und die kennt kein übergeordnetes Ticket.

- Eine Unteraufgabe darf eine Serie haben („Wiederholen…“ ist erlaubt). Ihr Folgeticket ist ein eigenständiges Ticket.
- Ein übergeordnetes Ticket darf eine Serie haben. Sein Folgeticket bekommt keine Unteraufgaben.
- Begründung: Das übergeordnete Ticket ist beim Erzeugen oft schon erledigt oder gelöscht. Ein geerbter Parent würde ein erledigtes Ticket still wieder „blockieren“ oder auf ein gelöschtes zeigen, und das Folgeticket müsste bei jedem Rückgängig mitgedacht werden (ADR-0023 §3). Die Serie bleibt so unabhängig von der Hierarchie.

### 4. Oberfläche

- **Abschnitt „Unteraufgaben“** im Panel und in der Vollansicht (bei Tickets ohne eigenes übergeordnetes Ticket): Liste mit Häkchen, Key, Titel (Link) und Status-Pille; offene zuerst, danach nach Anlage. Fortschritt „2/5 erledigt“ als Text und ein dezenter Balken aus vorhandenen Tokens. „Unteraufgabe hinzufügen“ öffnet ein Textfeld im Abschnitt: Enter legt an und lässt das Feld für die nächste offen, Esc bricht ab. Die neue Unteraufgabe erbt Scope, Projekt und Tags, Status „Offen“, Priorität „Mittel“.
- **Im Kind:** Pfad „HAUS-12 › HAUS-15“ mit Link zum übergeordneten Ticket (Kopf des Panels, oberhalb des Titels in der Vollansicht). Die Zeile „Übergeordnet“ in den Feldern zeigt das Ticket mit „Ändern“ und „Lösen“ sowie den Switch „Blockiert das übergeordnete Ticket“.
- **Ein vorhandenes Ticket zur Unteraufgabe machen:** über dieselbe Zeile „Übergeordnet“ („Festlegen …“).
- **Auswahl des übergeordneten Tickets** mit der vorhandenen `TicketCombobox`, **inline** in der Zeile statt im Modal: In der Vollansicht darf kein Dialog aufgehen (ADR-0025 §3), und Panel und Vollansicht sollen gleich bedient werden. Angeboten werden nur zulässige Ziele (nicht das Ticket selbst, keine Unteraufgaben); den Rest prüft der Hook.
- **Löschen** eines übergeordneten Tickets nennt „N Unteraufgaben bleiben erhalten“. In der Vollansicht fragt „Löschen …“ jetzt **inline** statt über eine Bestätigung auf dem XL-Modal (offener Punkt aus dem Plan Editor).

### 5. Tabelle „Aufgaben“

- **Fortschritt:** Ein übergeordnetes Ticket trägt am Titel einen Chip „2/5“ (Name „2 von 5 Unteraufgaben erledigt“).
- **Spalte „Übergeordnet“:** optional, standardmäßig aus, weicht als erste (wie „Quelle“), zeigt den Key des übergeordneten Tickets.
- **„Unteraufgaben einrücken“** im Menü „Spalten“, standardmäßig an, gespeichert pro Gerät in den Spaltenvorlieben der Tabelle (`byl-columns-tickets`, Feld `options`; „Standard wiederherstellen“ setzt es zurück).
- **Regeln für Filter, Suche, Sortierung und Gruppierung:**
  1. Filter und Suche gelten für jedes Ticket einzeln. Eine Unteraufgabe erscheint, wenn sie passt, auch ohne ihr übergeordnetes Ticket, und umgekehrt.
  2. Sortiert wird wie bisher.
  3. Mit „einrücken“ folgt eine Unteraufgabe direkt ihrem übergeordneten Ticket, **wenn beide im selben Abschnitt sichtbar sind** (dieselbe Gruppe bzw. offen oder „Erledigt“). Mehrere Unteraufgaben behalten untereinander die Reihenfolge der Sortierung.
  4. Sonst steht sie an ihrem sortierten Platz, mit dem Pfad-Hinweis „HAUS-12 ›“ vor dem Titel. Das gilt auch, wenn „einrücken“ aus ist.
  5. Einrücken ändert keine Zahl: Zähler, Kennzahlen und Gruppen zählen jedes Ticket einzeln. Es geht nie über eine Gruppe oder einen Abschnitt hinaus.
- Die Regeln aus ADR-0030 bleiben: Die Einrückung liegt in der Titelzelle, die Tabelle scrollt nie seitlich, Pflichtspalten bleiben.

### 6. Kurzsyntax

`^HAUS-12` in der Schnellerfassung ist zurückgestellt (Plan §6): Der Key muss gegen die Tickets aufgelöst werden, und mit `@CODE` wäre offen, welches Projekt gilt.

## Alternativen

- **Mehrere Ebenen:** widerspricht ADR-0012 (keine Epics) und macht Einrücken, Fortschritt und die Sperre rekursiv. Verworfen.
- **Erledigen mit offenen Unteraufgaben immer verbieten (Jira-Workflow):** zu starr für private Listen; `blocks_parent` ist gerade der Schalter pro Unteraufgabe. Verworfen.
- **„Mit erledigen“ als Folge von Einzel-Updates aus der SPA:** nicht atomar, ein halber Erfolg wäre möglich. Verworfen zugunsten der Transaktion im Hook.
- **Folgetickets erben den Parent:** siehe §3. Verworfen.
- **Kinder nur eingerückt, nie einzeln:** Ein Filter, der das übergeordnete Ticket ausblendet, würde passende Unteraufgaben verstecken. Verworfen.
- **Auswahl des übergeordneten Tickets im Modal wie „Anderem Ticket zuordnen …“:** ginge im Panel, aber nicht in der Vollansicht. Verworfen zugunsten derselben Inline-Auswahl an beiden Orten.
- **Die Vorliebe „einrücken“ in der URL:** Sie ist eine Vorliebe des Geräts wie die Spalten, kein teilbarer Ansichtszustand. Verworfen.

## Konsequenzen

- Positiv: Keine Migration und kein Neustart. Die Sperre gilt auch für andere Clients und ist atomar. Einrücken, Filter und Sortierung widersprechen sich nicht.
- Negativ: Die SPA lädt zusätzlich alle Unteraufgaben (auch erledigte) mit den Listenfeldern, damit Fortschritt und Liste ohne weitere Anfragen stimmen. Bei privaten Datenmengen ist das klein.
- CLAUDE.md §5, §7 und §10 sind nachgezogen (Stufe 2 → umgesetzt; Freigabe des Nutzers vom 2026-09-28).

## Nachtrag (2026-09-28, Papierkorb, ADR-0037): Löschen mit Unteraufgaben

- Das Löschen eines übergeordneten Tickets leert `parent` der Unteraufgaben nicht mehr: Sie gehen als **Gruppe** mit in den Papierkorb (auch erledigte), behalten `parent` auf das Ticket im Papierkorb und kommen nur gemeinsam zurück bzw. gehen gemeinsam endgültig.
- Eine **einzeln** gelöschte Unteraufgabe verlässt ihr übergeordnetes Ticket (`parent` leer, im Schnappschuss): Sie zählt nicht mehr im Fortschritt und blockiert das Erledigen nicht (§2). Beim Wiederherstellen kommt sie zurück, wenn das übergeordnete Ticket lebt, im Bereich liegt und selbst keine Unteraufgabe ist, sonst als eigenständiges Ticket (im Ergebnis genannt).
- Ein Ticket im Papierkorb ist kein möglicher übergeordneter Eintrag (`validation_scope_mismatch` wie ein fehlendes).

## Nachtrag (2026-10-01, Duplizieren, ADR-0045): Unteraufgaben beim Duplizieren

- **Übergeordnetes Ticket duplizieren** mit „Unteraufgaben“ (nicht vorausgewählt): Je Unteraufgabe des Originals entsteht eine **neue, offene** Unteraufgabe des Duplikats, auch aus erledigten, in der Reihenfolge ihrer Anlage und in derselben Transaktion. Sie behält ihr eigenes „Blockiert das übergeordnete Ticket“, bekommt Beschreibung, Priorität, Tags und Fälligkeit aus der eigenen Unteraufgabe nach derselben Auswahl wie das Duplikat und das Projekt des Duplikats (wie jede neue Unteraufgabe, §4; [ADR-0034](0034-unterprojekte.md) §6). Keine Serie, kein Pin, keine Kommentare, keine Quellen. Die Unteraufgaben des Originals bleiben unverändert.
- **Unteraufgabe duplizieren:** „Unter HAUS-12 einordnen“ (vorausgewählt) macht die Kopie zu einer weiteren Unteraufgabe desselben übergeordneten Tickets mit dessen „Blockiert …“-Wert; ohne die Wahl ist sie eigenständig. Eine Unteraufgabe hat keine Unteraufgaben, die Frage „Unteraufgaben“ fehlt dort (eine Ebene).
- Der Hook bleibt die letzte Instanz: Ebene, Bereich und Papierkorb prüft `checkRelations` wie bei jeder Anlage.

## Nachtrag (2026-10-01, Plan „Wiederholungen: Werte von Folgetickets“, WV-3): Unteraufgaben aus der Vorlage einer Serie

Nutzerentscheidung vom 2026-10-01. §3 gilt weiter für den Parent (Folgetickets haben keinen) und für Unteraufgaben mit eigener Serie; der Satz „Ein übergeordnetes Ticket darf eine Serie haben. Sein Folgeticket bekommt keine Unteraufgaben.“ gilt in dieser Form:

- **Folgetickets bekommen die Unteraufgaben der Vorlage**, nicht die des Vorgängers: Die Vorlage einer Regel hat eine Liste „Unteraufgaben“ (höchstens 20, je Titel und Priorität, `recurrence_rules.template_subtasks`), und jedes neue Folgeticket bekommt ihre Einträge in derselben Transaktion als **neue, offene** Unteraufgaben: ohne Fälligkeit, ohne Serie, `blocks_parent` `true` (der Standard aus §2), Projekt, Tags und Bereich des Folgetickets wie „Unteraufgabe hinzufügen“ (§4). Einzelheiten in [ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 10.
- **Warum aus der Vorlage und nicht vom Vorgänger:** Die Begründung von §3 bleibt richtig. Der Vorgänger ist beim Erzeugen oft erledigt, gelöscht oder mit geänderten Unteraufgaben; ein Kopieren von dort würde den Stand eines einzelnen Termins weitertragen. Die Vorlage ist der festgelegte Plan der Serie, sichtbar und änderbar, wie Titel und Priorität. „Unteraufgaben dieses Tickets übernehmen“ macht die Unteraufgaben eines Tickets auf Wunsch zur Vorlage.
- **Rückgängig:** Ein unberührtes Folgeticket geht beim Wiedereröffnen seines direkten Vorgängers samt seinen erzeugten Unteraufgaben; jede Änderung des Nutzers an ihnen hält es ([ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) Nachtrag 8).
- **Erledigen** eines Folgetickets mit offenen Unteraufgaben aus der Vorlage fragt wie jedes übergeordnete Ticket (§2: „Unteraufgaben mit erledigen“ oder „Trotzdem erledigen“).

## Nachtrag (2026-10-12, Tagesplan, TP-2): der Pfad als Baustein, im Tagesplan mit Titel

- Der Pfad-Hinweis aus §5 Regel 4 („HAUS-12 ›“ mit dem Titel als Tooltip, für Screenreader „Unteraufgabe von HAUS-12:“) ist jetzt die Komponente `SubtaskPath`. Die Tabelle „Aufgaben“ sieht und klingt wie vorher; eine eingerückte Unteraufgabe behält nur den verborgenen Text, die Ecke zeichnet weiter die Zeile.
- Der Tagesplan nutzt denselben Baustein mit dem Titel des übergeordneten Tickets als Kontextzeile über der Unteraufgabe („HAUS-12 › Umzug“, Key als Link, „Unteraufgabe von HAUS-12 Umzug:“), ohne Unteraufgaben unter ihrem Ticket zu gruppieren. Einzelheiten in [ADR-0065](0065-tagesplan.md), Nachtrag TP-2.

## Nachtrag UT-1 (2026-10-12): Status beim Anlegen, Statusmenü, Vererbung und Serienbezug

Nutzerentscheidungen vom 2026-10-12 (U1 bis U5). Die Sätze „Status „Offen“, Priorität „Mittel““ aus §4 und „neue, offene Unteraufgaben: ohne Fälligkeit“ aus dem Nachtrag WV-3 gelten in dieser Form; der Rest bleibt.

- **Status beim Anlegen (U1):** Jede neue Unteraufgabe bekommt einen wählbaren Status aus `TEMPLATE_STATUSES` („Erledigt“ ist nie wählbar). Voreinstellung ist der Status des übergeordneten Tickets, bei einem erledigten „Offen“ (`subtaskStatusOf`, gleich in `lib/recurrence-rules.js` und `domain/series-template.ts`). Das gilt im Formular „Unteraufgabe hinzufügen“ des Details, je Zeile in „Neues Ticket“ (vorbelegt mit dem gewählten Status des neuen Tickets; [ADR-0069](0069-vollstaendiges-anlegen.md) Nachtrag UT-1) und je Zeile der Vorlage einer Serie (vorbelegt mit ihrem „Status beim Anlegen“; [ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 16). Eine Zeile ohne eigene Wahl folgt der Voreinstellung; wer sie wieder auf die Voreinstellung stellt, folgt ihr wieder. Duplizieren bleibt, wie es ist (Nachtrag DU-1: neue, offene Unteraufgaben).
- **Status im übergeordneten Ticket (U2):** Im Abschnitt „Unteraufgaben“ ersetzt das Statusmenü der Tabelle „Aufgaben“ die reine Status-Pille. Es ist dafür als Baustein herausgelöst: `components/table/StatusMenu.svelte` (die Zelle `EditableCell` mit der Pille als Knopf, Name „Status von HAUS-13: Offen, ändern“, Menü mit allen Status) und `MenuChoice.svelte` (eine Wahl mit Haken und Gewicht, auch für Priorität, Zuständigkeit und Projekt der Tabelle). Die Tabelle nutzt dieselben Bausteine und bleibt in Aussehen, Namen und Verhalten gleich. Gespeichert wird über `TicketListStore.changeField`; „Erledigt“ läuft über `setDone` mit der Frage nach offenen Unteraufgaben und „Rückgängig“ (stellt den vorigen Status her). Dieselbe Wahl wie der aktuelle Status speichert in der Liste nichts. Das Häkchen bleibt zusätzlich. Im Panel (480 px) steht das Menü als letzte Spalte der Zeile, der Titel kürzt; auf Touch-Bildschirmen ist der Knopf 44 px hoch.
- **Formular „Unteraufgabe hinzufügen“:** Titel, darunter „Status“ (natives `select`) und „Fälligkeit“ (Datumsfeld, vorbelegt mit der Fälligkeit des Tickets, änderbar und löschbar, „vorher fragen“), ein Hinweis, was vom Ticket kommt, und die Knöpfe „Anlegen“ und „Schließen“ (mit zwei Feldern, die das Absenden mit Enter sonst sperren würden, braucht das Formular einen Knopf zum Absenden). Enter legt an und lässt das Formular mit den gewählten Werten für die nächste offen, Esc aus jedem Feld schließt es und wird verbraucht.
- **Vererbung (U3):** Art (`kind`) und Zuständigkeit erbt jede neue Unteraufgabe auf jedem Weg vom übergeordneten Ticket bzw. Folgeticket; die Fälligkeit bei automatisch erzeugten (Vorlage, „Neues Ticket“) ohne Frage, beim Hinzufügen im Detail vorbelegt im Formular. Ohne Fälligkeit des Tickets bleibt sie leer. Die Ausnahme „Unteraufgaben bekommen keine Zuständigkeit“ entfällt ([ADR-0068](0068-zustaendigkeit.md) Nachtrag UT-1). Die Datenschicht sendet dafür `kind` beim Anlegen (nur „Laufendes Vorhaben“; eine Aufgabe macht der Hook daraus).
- **Serienbezug (U4):** Gehört das übergeordnete Ticket zu einer Serie, nennt der Abschnitt „Wiederholung“ der Unteraufgabe in Panel und Vollansicht „Teil von HAUS-7 · wiederholt sich jeden Montag“ (`parentSeriesText`; ohne bekannte Regel nur „wiederholt sich“). Die Serie kommt aus der Liste, sonst aus dem `expand` des übergeordneten Tickets, das dafür `recurrence` mitbringt (`ParentRef.recurrenceId`; auch ein erledigtes übergeordnetes Ticket außerhalb der Liste). Dazu steht „aus der Vorlage – wird mit jedem Termin neu angelegt“, wenn der Verlaufseintrag „created“ der Unteraufgabe die Regel der Serie als Urheber nennt (ohne Nutzer, wie die Erzeugung ihn schreibt) und die Vorlage noch einen Eintrag ihres Titels hat, oder „nur für diesen Termin“, wenn eine Person sie angelegt hat und die Vorlage keinen solchen Eintrag hat (`subtaskSeriesOrigin`). In jedem anderen Fall (geänderte Vorlage, eine Unteraufgabe aus „Neues Ticket“, die zugleich in die Vorlage ging, unbekannter Verlauf oder unbekannte Regel) entfällt der Zusatz. Keine Migration; die Notiz `recurrence_subtasks` am Hauptticket wird dafür nicht gebraucht, weil der Verlauf der geöffneten Unteraufgabe ohnehin geladen ist.
- **„Wiederholen…“ (U5):** bleibt an Unteraufgaben sichtbar und funktioniert wie bisher (§3).
- **Vor dem Neustart:** Formular und Statusmenü im Detail laufen über die Record-API und gehen sofort; Art und Zuständigkeit sendet die SPA selbst. Status je Zeile in „Neues Ticket“ und in der Vorlage bietet die SPA erst an, wenn `GET /api/byl/tickets/create` `subtask_status` nennt; vorher erzeugen die alten Hooks offene Unteraufgaben ohne Fälligkeit, Art und Zuständigkeit (die Hinweise sagen das). **Neustart nötig** (`neu-starten.bat`).
- **Belegt in** `ticket-subtasks.test.ts`, `ticket-list.test.ts`, `ticket-table-inline.test.ts` (Tabelle unverändert), `recurrence-summary.test.ts`, `ticket-panel.test.ts`, `domain/subtasks.test.ts`, `web-data-tickets.test.mjs`; Test-Manifest BYL-E6-1689 bis BYL-E6-1703.

## Nachtrag TP-3 (2026-10-12, Tagesplan): Anordnung wie §5 auch im Tagesplan, Ecke und Chip als Bausteine

Nutzerwunsch vom 2026-10-12. §5 gilt unverändert für die Tabelle „Aufgaben“; der Nachtrag TP-2 („ohne Unteraufgaben unter ihrem Ticket zu gruppieren“) gilt für den Tagesplan in dieser Form:

- **Anordnung als allgemeine Regel:** §5 Regel 3 und 4 rechnet jetzt `arrangeBy(entries, ticketOf, nest, find)` für beliebige Einträge mit einem Ticket (`ArrangedRow` mit `entry`, `nested`, `parent`); `arrangeRows` ist der Fall der Tabelle, mit gleichem Ergebnis. Der Tagesplan ordnet damit Pool und Vorschläge: Hauptticket, darunter eingerückt seine Unteraufgaben derselben Liste, Geschwister in der Reihenfolge der Liste bzw. der Rangfolge der Vorschläge; ohne Hauptticket in der Liste bleibt die Unteraufgabe an ihrem Platz mit ihrem Pfad. Die Grenze des Pools schneidet keinen solchen Block (`limitBlocks`).
- **Plan eines Tages:** Dort bestimmt der Nutzer die Reihenfolge; angeordnet wird nicht. Eingerückt wird nur, was schon richtig steht: eine Unteraufgabe direkt unter ihrem Hauptticket oder unter einer eingerückten Unteraufgabe desselben Haupttickets (`nestedInOrder`).
- **Bausteine:** Die Ecke einer eingerückten Unteraufgabe (`SubtaskNestIcon`) und der Chip „2/5“ (`SubtaskProgressChip`, Name „2 von 5 Unteraufgaben erledigt“) sind aus `TicketTableRow` herausgelöst; die Tabelle sieht und klingt wie vorher, der Tagesplan nutzt dieselben Bausteine mit denselben Zahlen (`progressOf` der Liste). Eingerückt hören Screenreader wie in der Tabelle „Unteraufgabe von HAUS-7:“.
- **Suche:** Filter und Suche der Tabelle bleiben bei §5 Regel 1 (jedes Ticket einzeln, ohne Hauptticket). Nur der Pool des Tagesplans sucht zusätzlich über Key und Titel des Haupttickets.
- Einzelheiten in [ADR-0065](0065-tagesplan.md), Nachtrag TP-3; Test-Manifest Paket „TP-3“.

## Nachtrag QB-1 (2026-10-18, Fehlerbericht): Frage aus §2 und Auswahl aus §4 in voller Breite

Fehlerbericht des Nutzers vom 2026-10-18: In der rechten Spalte der Vollansicht stand die Frage „N Unteraufgaben sind noch offen – trotzdem erledigen?“ schmal in der Wertspalte des Status und brach mitten im Wort um. §2 und §4 gelten unverändert in Texten und Verhalten; nur der Platz ändert sich:

- **Frage aus §2 (Status „Erledigt“ im Detail):** steht „inline unter dem Status“ jetzt in einer eigenen Zeile des Feldrasters direkt nach dem Status, über beide Spalten, in Panel und Vollansicht gleich. Dasselbe gilt für „Vorhaben abschließen?“ in der Vollansicht ([ADR-0065](0065-tagesplan.md), Nachtrag VH-1) und für „Nicht wieder in die Serie“ ([ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md), Nachtrag 4). Fokus auf „Abbrechen“, Esc, Rückgabe des Fokus an den Status und die Tab-Reihenfolge bleiben.
- **Auswahl aus §4 („Übergeordnet“, „Festlegen …“ bzw. „Ändern“):** Beim Wählen stehen die Beschriftung darüber, `TicketPicker` und „Übernehmen“ | „Abbrechen“ darunter über beide Spalten; angezeigt bleibt die Zeile zweispaltig.
- Einzelheiten in [ADR-0025](0025-ui-konsistenz-overlay-system.md), Nachtrag 19; Test-Manifest Paket „QB-1“.
