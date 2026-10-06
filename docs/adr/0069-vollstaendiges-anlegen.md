# ADR-0069: Vollständiges Anlegen – alle Optionen eines Tickets in „Neues Ticket“, in einem Schritt

- **Status:** Angenommen und umgesetzt (Paket NT-1); manuelle Prüfungen im Test-Manifest (BYL-E6-1656 bis BYL-E6-1660)
- **Datum:** 2026-10-06
- **Entscheidung durch:** Nutzer (Grundsatz: „Alles, was man an einem Ticket einstellen kann, lässt sich schon beim Anlegen einstellen.“; Ausnahmen nur, was ein bestehendes Ticket voraussetzt oder Konten noch nicht schreiben dürfen; Hauptfelder oben, „Weitere Optionen“ darunter in der Reihenfolge des Details, gemerkt je Gerät, Zähler „gesetzt“; Titel und Enter bleiben schnell; atomar), Advisor (Akzeptanzkriterien, Server-Route in einer Transaktion mit allen Prüfungen vorher, gemeinsame Bausteine, Paritätstest über eine Registry), Executor (Bestandsaufnahme, Route, Registry, Oberfläche, Tests)
- **Bezug:** [ADR-0033](0033-unteraufgaben.md) (Unteraufgaben), [ADR-0031](0031-herkunft-sichern.md) (Quellen aus dem Eingang), [ADR-0067](0067-tickets-als-quelle.md) (Tickets als Quelle), [ADR-0064](0064-tickets-anpinnen.md) (Anheften), [ADR-0065](0065-tagesplan.md) (Art und Tagesplan), [ADR-0052](0052-farben-fuer-projekte-und-tickets.md) (Farbe), [ADR-0062](0062-charms.md) (Charm), [ADR-0068](0068-zustaendigkeit.md) (Zuständig, Nachtrag PL-2), [ADR-0022](0022-erzeugung-von-instanzen.md) Nachträge 9, 10 und 14 sowie [ADR-0024](0024-serien-aus-kalendern.md) (Serien beim Anlegen, WH-2), [ADR-0045](0045-ticket-duplizieren.md) (Duplizieren als Vorbild der Transaktion einer Route), [ADR-0059](0059-bereiche-privat-und-haushalt.md) (Bereiche), [ADR-0060](0060-einheitliche-eingabeelemente.md) (`Field`, 44 px am Handy), [ADR-0025](0025-ui-konsistenz-overlay-system.md) (Overlays)

## Kontext

Der Dialog „Neues Ticket“ bot Titel, Status, Priorität, Fälligkeit, im Haushalt „Zuständig“, „Wiederholen“, Projekt, Farbe, Charm, Tags und Beschreibung. Vieles, was das Ticket-Detail kann, ging erst nach dem Anlegen: das laufende Vorhaben, das übergeordnete Ticket, Unteraufgaben, Quellen aus dem Eingang und aus Tickets, Anheften und „Zum Tagesplan“. Eine Wiederholung entstand in zwei Anfragen (erst das Ticket, dann die Regel); scheiterte die Regel, blieb ein halbes Ergebnis.

### Bestandsaufnahme (vor NT-1)

| Option (Detail) | im Detail | im Dialog vorher | Bereich | Plan |
|---|---|---|---|---|
| Anheften (Kopf) | ja | nein | beide | ergänzt, „Weitere Optionen“ |
| Zum Tagesplan (Menü „•••“) | ja | nein | beide | ergänzt, „Weitere Optionen“ |
| Titel | ja | ja | beide | Hauptfeld |
| Status | ja | ja | beide | Hauptfeld |
| Priorität | ja | ja | beide | Hauptfeld |
| Zuständig | ja | ja (PL-2) | nur Haushalt | Hauptfeld |
| Fälligkeit (auch „Fälligkeit verschieben …“ im Kalender) | ja | ja | beide | Hauptfeld |
| Projekt | ja | ja | beide | Hauptfeld |
| Farbe | ja | ja | beide | „Weitere Optionen“ |
| Charm | ja | ja | beide | Hauptfeld |
| Art „Laufendes Vorhaben“ | ja | nein | beide | ergänzt, „Weitere Optionen“ |
| Tags | ja | ja | beide | Hauptfeld |
| Übergeordnet mit „Blockiert das übergeordnete Ticket“ | ja | nein | beide | ergänzt, „Weitere Optionen“ |
| Wiederholung (Rhythmus, „Folgetickets starten mit“, Zuständigkeit, Start ab heute) | ja | ja, in zwei Anfragen | beide | „Weitere Optionen“, jetzt atomar |
| Unteraufgaben der Vorlage | ja („Vorlage bearbeiten“) | nein | beide | ergänzt als Schalter unter „Wiederholen“ |
| Beschreibung | ja | ja | beide | Hauptfeld |
| Unteraufgaben | ja | nein | beide | ergänzt, „Weitere Optionen“ |
| Quellen: Einträge aus dem Eingang | ja | nur die Hauptquelle beim Umwandeln | beide | ergänzt, „Weitere Optionen“ |
| Quellen: Tickets | ja | nein | beide | ergänzt, „Weitere Optionen“ |
| Link kopieren, Duplizieren, Folge-Ticket anlegen, Verschieben, Papierkorb | ja | nein | beide | Ausnahme |
| Folge-Tickets, Kommentare (mit Anpinnen), Verlauf, Quelle und Daten, Lesestatus | ja | nein | beide | Ausnahme |
| Abhängigkeiten | nein (Stufe 2) | nein | – | Ausnahme |

„Umwandeln“ im Eingang öffnet denselben Dialog (`/tickets/neu?aus=<id>`), also gilt die Parität dort von selbst. „Gesammelt umwandeln“, die Schnellerfassung, „Unteraufgabe hinzufügen“, „Folge-Ticket anlegen …“ und „Duplizieren …“ bleiben bewusst schlank.

## Entscheidung

### 1. Registry der Optionen

`web/src/lib/domain/ticket-options.ts` (`TICKET_OPTIONS`) nennt jede Option des Details in der Reihenfolge des Seitenpanels (Kopf, Titel, Felder, Abschnitte) mit ihrem Platz in „Neues Ticket“ (`main` oder `more`) oder als Ausnahme mit Begründung (`reason`). Ausnahmen: Seitenpanel/Vollansicht öffnen, Link kopieren, Duplizieren, Folge-Ticket anlegen (Gegenrichtung der Ticket-Quellen), Verschieben in den anderen Bereich, Papierkorb, Quelle und Daten (nur Anzeige), Folge-Tickets, Kommentare samt „Anpinnen“ (der Hook lehnt einen angepinnten Kommentar beim Anlegen ab), Verlauf, Lesestatus (ein einzeln angelegtes Ticket ist gelesen, ADR-0015) und Abhängigkeiten (API-Regeln `null` bis Stufe 2). Detail und Dialog markieren jede Option an ihrem Steuerelement mit `data-ticket-option="<key>"`, die Einträge des Menüs „•••“ stehen mit ihrem Namen in `menu`.

### 2. Aufbau des Dialogs

- **Hauptfelder** wie im Dialog vorher und in seiner Reihenfolge: Titel, Status, Priorität, Fälligkeit, im Haushalt Zuständig, Projekt, Charm, Tags, Beschreibung. Titel tippen und Enter legt an (implizites Absenden des Formulars), Strg+Enter aus jedem Feld.
- **„Weitere Optionen“** darunter: Überschrift als Disclosure-Knopf (`aria-expanded`, `aria-controls`), zugeklappt beim ersten Mal, offen oder zu je Gerät in `localStorage` `byl-new-ticket-more` (nur `1`). Inhalt in der Reihenfolge des Details: Anheften, Zum Tagesplan von heute, Farbe, Laufendes Vorhaben, Übergeordnet (Ticket-Picker, eine Ebene, mit „Blockiert das übergeordnete Ticket“), Wiederholen (eigener Disclosure wie bisher, mit „Unteraufgaben auch jedem künftigen Ticket der Serie geben“), Unteraufgaben (höchstens 20, Titel und Priorität), Quellen (Einträge aus dem Eingang mit Suche, Tickets mit dem Picker). Die Überschrift zählt, was vom neuen Ticket abweicht, „Weitere Optionen (2 gesetzt)“ (`moreOptionsSet`). Ein Fehler eines Feldes darin oder eine übernommene Kalenderserie öffnet den Bereich für dieses Formular, ohne die Wahl des Geräts zu ändern.
- **Gemeinsame Bausteine:** `ColorChoice`, `KindSwitch` (auch in `TicketFields`), `BlocksParentSwitch` (auch in `TicketParentField`), `TicketPicker`, `TemplateSubtaskList` (mit eigenem Hinweis), `InboxEntryChoice` (auch in „Quelle hinzufügen …“), `TicketSourceChoice` und `RecurrenceForm`.
- Ein erledigtes Ticket wird weder angeheftet noch eingeplant (die Schalter sind gesperrt und sagen es). Eine Unteraufgabe hat keine eigenen Unteraufgaben: Mit einem übergeordneten Ticket fehlen die Unteraufgaben und umgekehrt, je mit Hinweis.

### 3. Eine Anfrage, eine Transaktion

`POST /api/byl/tickets/create` (`tickets.pb.js`, Dienst `lib/ticket-create-service.js`, rein `lib/ticket-create-rules.js`, Spiegel `domain/ticket-create.ts` mit Paritätstest der Texte) nimmt die Felder des Tickets in der Form der Collection (`household`, Titel, Beschreibung, Status, Priorität, Fälligkeit, Projekt, Tags, `parent`, `blocks_parent`, Farbe, Charm, `kind`, `assignee`, `source` bzw. `source_item`) und die Extras `subtasks`, `sources`, `ticket_sources`, `recurrence` (nur die Parameter der Regel samt `start`, `backlog`, `initial_status`, `template_subtasks` und Zuständigkeit; die Vorlage ist das angelegte Ticket wie bei „Wiederholen…“), `pin` und `day_plan`. Besitzer ist immer das anfragende Konto, ein Haushalt nur mit Mitgliedschaft (sonst 403).

**Alle Prüfungen vor dem ersten Schreiben**, mit denselben Funktionen wie die Hooks: Form und Grenzen der Anfrage (`parseRequest`), Felder späterer Migrationen und Werte der Select-Felder aus dem Schema, `ticket-service.checkCreate` (aus `prepareCreate` herausgelöst: Bereich, Vorgaben, Fälligkeit, Charm, Projekt, Tags, Elternticket mit einer Ebene und Papierkorb, Zuständigkeit, Umwandeln), keine Unteraufgaben an einer Unteraufgabe, Einträge sichtbar, im Bereich und neu (`inbox-service.linkViolation`), Quell-Tickets sichtbar, lebend und im Bereich, die Regel über den Modell-Hook selbst (`recurrence-service.prepareCreate` auf einem nie gespeicherten Datensatz, nach `applyCreateBody`, dem Teil des Request-Hooks; ein erledigtes Ticket beginnt keine Serie), Pin und Tagesplan nie für ein erledigtes Ticket.

Dann **eine Transaktion der Route** (`e.app.runInTransaction` wie „Duplizieren“): Ticket, Unteraufgaben (Projekt und Tags des Tickets wie „Unteraufgabe hinzufügen“, je eine Millisekunde später, damit die Reihenfolge bleibt), Einträge des Eingangs (`linkToTicket`, wie „Mit Ticket verknüpfen …“), Quell-Tickets (`ticket-source-service.link`), Regel mit dem Ticket als erstem Vorkommen, Pin (`pin-service.pinTicket`) und Eintrag im Tagesplan von heute (`day-plan-service.addToPlan`). Alles läuft über `txApp.save`, also über die Modell-Hooks (Key, Verlauf mit dem Konto, Umwandeln, Kreis-Prüfung, Datum bei „Serie ab heute beginnen“); scheitert ein Schreiben, bleibt nichts zurück (Fehlermarke `__byl_fail_create__` am letzten Schreiben). Realtime und der Hinweis an eine andere zuständige Person (`byl/assigned`) folgen nach dem Commit. Antwort `{ id, key, scope, subtasks, sources, ticket_sources, rule, pinned, day_plan }`; die SPA liest danach Ticket und Regel. Fehler kommen je Feld wie bei der Record-API; die SPA ordnet sie den Feldern des Formulars zu (`createFieldOf`, Zeile einer Liste über `params.index`).

`GET /api/byl/tickets/create` nennt, was der Server kennt (Wiederholungen, Pins, Tagesplan, Ticket-Quellen, Art, Farbe, Charm, Zuständig).

### 4. Bereich

Die Regeln von [ADR-0059](0059-bereiche-privat-und-haushalt.md) bleiben: „Zuständig“ nur im Haushalt (privat lehnt der Hook ab), alles andere in beiden Bereichen; Projekt, Tags, Elternticket, Einträge und Quell-Tickets nur aus dem Bereich des Tickets (`validation_scope_mismatch` am Feld), der Tagesplan der des eigenen Bereichs.

### 5. Vor dem Neustart

Ändert ein Update nur Hooks, kennt der laufende Server die Route bis zum Neustart nicht (404). Dann legt die Seite an wie vorher (Ticket, danach die Regel eines offenen Abschnitts „Wiederholen“), „Weitere Optionen“ bietet nur Farbe und „Wiederholen“ und sagt, wann der Rest kommt. Keine Migration.

### 6. Paritätstest

`web/src/lib/ticket-options-parity.test.ts`: Jede Markierung des Details steht in der Registry und jede Option der Registry im Detail; jeder Eintrag des Menüs „•••“ gehört zu einer Option; jede Zeile von `TicketFields` ist markiert; jedes Teil von Panel und Vollansicht ist markiert oder begründet ohne Option. Gerendert zeigt `TicketFields` eines Haushaltstickets die Felder in der Reihenfolge der Registry, und „Neues Ticket“ mit allem zeigt jede Option an ihrem Platz, „Weitere Optionen“ in der Reihenfolge des Details, und keine Ausnahme. Eine neue Option im Detail ohne Gegenstück im Dialog und ohne Begründung lässt ihn scheitern.

## Alternativen

| Alternative | Bewertung |
|---|---|
| Weiter mehrere Anfragen (Ticket, dann Regel, Pin, Tagesplan, Quellen) | Halbe Tickets bei jedem Fehler dazwischen; abgelehnt durch die Produktvorgabe „atomar“. |
| Alles in den Modell-Hook des Tickets (Body-Felder der Record-API) | Der Hook kennt keine Anfrage mit Listen anderer Collections; Pins, Tagesplan und Quellen hätten keinen sauberen Ort für ihre Prüfungen. Eine Route mit allen Prüfungen vorher folgt dem Muster von „Duplizieren“. |
| Die Vorlage der Regel vom Client senden | Möglich über die Record-API, hier aber nicht nötig: Die Vorlage ist der Schnappschuss des angelegten Tickets, und der Server nimmt sie selbst, so weicht sie nie ab. |
| Alle Optionen ohne zugeklappten Bereich | Das schnelle Anlegen würde unübersichtlich; der Nutzer will die Hauptfelder oben. |
| Paritätstest über Komponenten-Namen statt Registry | Fände eine neue Option nicht, die in einer vorhandenen Komponente dazukommt; die Markierungen samt Stolperdrähten (Zeilen der Felder, Teile des Details) tun es. |

## Konsequenzen

- **Neustart nötig** (`neu-starten.bat`): neue Route und geänderte Hooks; die Oberfläche nach dem Build und F5. Bis dahin legt der Dialog an wie vorher. Keine Migration.
- Neue Module: `app/pb_hooks/lib/ticket-create-service.js`, `lib/ticket-create-rules.js`; `web/src/lib/data/ticket-create.ts`, `domain/ticket-create.ts`, `domain/ticket-options.ts`, `components/KindSwitch.svelte`, `BlocksParentSwitch.svelte`, `InboxEntryChoice.svelte`, `TicketSourceChoice.svelte`.
- Geändert: `tickets.pb.js` (Routen), `lib/ticket-service.js` (`checkCreate`), `lib/recurrence-service.js` (`applyCreateBody`), `lib/assignee-service.js` (`rememberNextSentIn`), `lib/day-plan-service.js` (`addToPlan`), `lib/pin-service.js` (`pinTicket`), `lib/inbox-service.js` (`linkViolation`, `linkToTicket`); `NewTicketForm`, die Seite `/tickets/neu`, `TicketDetailStore` (`createWithOptions`, `loadCreateSupport`), `RecurrenceStore.ruleParams`, `TemplateSubtaskList` (`hint`, `errorRow`), `AddSourcesDialog`, die Teile des Details (Markierungen), Hilfe.
- Die Aussage „erst das Ticket, dann die Regel“ von „Neues Ticket“ mit „Wiederholen“ (Plan OR-4, [ADR-0024](0024-serien-aus-kalendern.md) für eine übernommene Kalenderserie) gilt nur noch vor dem Neustart; danach entstehen beide zusammen oder gar nicht.
- **Konvention** (CLAUDE.md §12): Eine neue Option eines Tickets bekommt einen Eintrag in `TICKET_OPTIONS`, ihre Markierung im Detail und ihr Feld in „Neues Ticket“ (Route und Formular), oder eine begründete Ausnahme.
- Tests: `tests/integration/ticket-create.test.mjs` (eigene Instanz: A und B im Haushalt, C allein), `tests/unit/web-ticket-create.test.mjs`, `web/src/lib/components/new-ticket-more.test.ts`, `new-ticket.test.ts` (angepasst), `stores/ticket-create-store.test.ts`, `ticket-options-parity.test.ts`. Test-Manifest: BYL-E6-1641 bis BYL-E6-1655, manuell BYL-E6-1656 bis BYL-E6-1660.
