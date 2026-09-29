# Tickets und Projekte aus einer Liste wählen

- **Stand:** umgesetzt: AL-1 (#180: Baustein `TicketPicker`, Übergeordnet, Verknüpfen und Umhängen im Eingang) und AL-2 (Ticket-Link im Editor, Projekt in der Schnellerfassung). Keine Migration, kein Neustart (nur der Build der SPA). Offen sind die manuellen Browser-Prüfungen `BYL-E6-610` bis `BYL-E6-614`.
- **Grundlage:** Nutzer-Beobachtung vom 2026-09-30: „Selektion von Projekten oder Tickets per reiner manueller Eingabe grauenhaft (was, wenn ich die Ticket-Nummer nicht weiß?) – Einfache Auflistung für User“. Entscheidung in [ADR-0042](../adr/0042-tickets-und-projekte-aus-listen-waehlen.md); Bezug: [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) (Popover, Combobox), [ADR-0033](../adr/0033-unteraufgaben.md) (eine Ebene), [ADR-0034](../adr/0034-unterprojekte.md) (Pfad „Haus › Garten“), [ADR-0037](../adr/0037-papierkorb.md) (Papierkorb), [ADR-0009](../adr/0009-fehlerfarbe.md), [Plan Layout-Überlauf](layout-ueberlauf.md).
- **Einordnung:** Manifest-Block „Auswahl-Listen“ ab `BYL-E6-600`.

## 1. Inventur

Gesucht waren alle Stellen, an denen ein Ticket oder ein Projekt nur durch Eintippen (Nummer, Key, Code, Titel, Adresse) bestimmt werden konnte. Geprüft wurden alle Komponenten unter `web/src/lib/components`, die Routen und die Kurzsyntax.

| Stelle | Komponente | Vorher | Nachher |
|---|---|---|---|
| Übergeordnetes Ticket festlegen oder ändern (Panel und Vollansicht) | `TicketParentField` | `TicketCombobox`: leeres Feld, eine Liste erst nach Tippen von Nummer, Key oder Titel (Serversuche) | `TicketPicker`: Liste beim Fokus; das Ticket selbst ausgeblendet, das aktuelle übergeordnete Ticket, eigene Unteraufgaben (Zyklus), jede Unteraufgabe (zweite Ebene) und Tickets eines anderen Bereichs ausgegraut mit Grund (AL-1) |
| Unteraufgabe lösen | `TicketParentField` („Lösen“) | Knopf, kein Eintippen | unverändert |
| Eingang: „Mit Ticket verknüpfen …“ (Panel eines Eintrags und Auswahlleiste) | `LinkTicketDialog` | `TicketCombobox` wie oben | `TicketPicker` im Modal; Tickets eines anderen Bereichs als die Einträge ausgegraut (AL-1) |
| „Anderem Ticket zuordnen …“ (Quellen im Ticket und Panel eines Eintrags) | `MoveSourceDialog` | `TicketCombobox`, das aktuelle Ticket still ausgefiltert | `TicketPicker`; das aktuelle Ticket ausgegraut mit „Der Eintrag gehört schon zu HAUS-12.“, andere Bereiche ebenso (AL-1) |
| Editor: Link auf ein Ticket (Beschreibung, Kommentare, Neues Ticket, Regel-Vorlage) | `LinkPopover` | nur „Adresse“ zum Eintippen oder Einfügen; die Adresse eines Tickets kennt niemand auswendig | zusätzlich „Ticket“ mit `TicketPicker` (auch erledigte ohne „Nur offene“); der Link heißt `/tickets/<id>` und öffnet in der App (AL-2) |
| Schnellerfassung: Projekt | `QuickCapture` | nur Kurzsyntax `@CODE` | zusätzlich „Projekt“ als `ProjectSelect`; die Wahl schreibt `@CODE` in die Zeile, ein getipptes `@CODE` stellt die Auswahl (AL-2) |
| Eingang: Projekt beim Erfassen | `CaptureForm` | natives `select` („Projekt wählen“, Baum-Reihenfolge, Pfad) | unverändert (gleichwertige Liste) |
| Ticket: Projekt (Panel, Vollansicht, Neues Ticket) | `TicketFields`, `NewTicketForm`, `ProjectSelect` | `ProjectSelect` | unverändert |
| Sammelaktion „Projekt …“ | `BulkActionBar`, `ProjectSelect` | `ProjectSelect` | unverändert |
| „Gesammelt umwandeln“ | `BulkConvertDialog`, `ProjectSelect` | `ProjectSelect` | unverändert |
| Papierkorb: Zielprojekt | `TrashNeedQuestion`, `ProjectSelect` | `ProjectSelect` | unverändert |
| Wiederholungen: Projekt der Vorlage | `RecurrencePanel`, `ProjectSelect` | `ProjectSelect` | unverändert |
| Projekt-Panel: Oberprojekt | `ProjectPanel` | natives `select` mit „Keins“ und den aktiven obersten Projekten (nur sie kommen in Frage, ADR-0034) | unverändert |
| Zelle „Projekt“ der Tabelle | `TicketTableRow`, `EditableCell` | Menü mit „Kein Projekt“ und den aktiven Projekten in Baum-Reihenfolge | unverändert |
| Filter „Projekt“ | `FilterBar`, `FilterPopover` | Popover mit Radios, Suchfeld ab 10 Einträgen, Pfad | unverändert |
| Filter nach Ticket, Suche der Tabelle | `FilterBar` | Suche über Titel, Beschreibung und Key; kein Filter „Ticket“ | unverändert (Suche, keine Auswahl) |
| Projekte: Suche | `ProjectsView` | filtert die sichtbare Liste nach Name oder Code | unverändert (Filter einer Liste) |
| Quelle hinzufügen | `AddSourcesDialog` | wählt Einträge (keine Tickets) per Checkbox aus einer Liste mit Suche | unverändert |
| Abhängigkeiten zwischen Tickets | – | keine Oberfläche (Stufe 2, `dependencies` ohne Schreibrecht) | nicht zutreffend; der Baustein kennt die Regel „kein Zyklus“ schon |
| Kurzsyntax `^HAUS-12` (Unteraufgabe) | – | zurückgestellt (ADR-0033 §6) | nicht zutreffend |

`TicketCombobox` und die Serversuche `searchTickets` (samt `TicketSourcesStore.search`) sind entfallen; kein Aufrufer ist übrig.

## 2. Baustein `TicketPicker`

- Combobox nach dem Muster „combobox with listbox popup“ der WAI-ARIA APG; die Liste liegt als `popover="manual"` im Top-Layer (`SuggestionList`, ADR-0025 §5), unter Feld und Filterchips, mit dickem Glas wie die übrigen Listen (keine neue Datei in der Glas-Allowlist). Der Fokus bleibt im Feld (`aria-activedescendant`).
- **Öffnen ohne Tippen:** beim Fokus oder Klick. Zuerst bis zu 5 Tickets „Zuletzt angesehen oder bearbeitet“ (angesehen in der Reihenfolge des Ansehens, aufgefüllt nach `updated`), dann die offenen Tickets gruppiert nach Projekt in Baum-Reihenfolge („Haus › Garten“), unbekannte Projekte nach Namen, dann „Ohne Projekt“, ohne „Nur offene“ zuletzt „Erledigt“. Je Eintrag Key, Titel, Status-Pille, Fälligkeit (`DueLabel`), der Punkt „neu“ und ein Häkchen für das gewählte Ticket.
- **Tippen filtert** über Key und Titel ohne Groß-/Kleinschreibung, Akzente und Umlautpunkte („äpfel“ findet „Äpfel“, „strasse“ findet „Straße“); mehrere Wörter UND. Ist der Text ein Key, ist dieser Eintrag aktiv.
- **Filterchips:** „Nur offene“ (Knopf mit `aria-pressed`, Standard an), „Projekt“ (natives `select` mit „Alle“, allen Projekten im Pfad, archivierte markiert, „Ohne Projekt“; ein Projekt nimmt seine Unterprojekte mit; `title` mit der ganzen Beschriftung).
- **Begrenzt:** 25 Einträge, die letzte Option „Mehr anzeigen“ holt 25 weitere bzw. die nächste Seite erledigter Tickets. Die Zahl steht neben den Chips („25 von 48 Tickets angezeigt.“) und nach einer Pause von 0,5 s in einer höflichen Live-Region.
- **Tastatur:** Pfeile mit Umlauf, Pos1/Ende in der Liste (im Text erst, nachdem die Pfeile in die Liste geführt haben), Enter wählt (bei „Mehr anzeigen“: mehr; bei einem gesperrten Eintrag: sagt den Grund), Esc schließt die Liste, dann leert es das Feld, erst dann gehört es dem Umfeld; Tab schließt.
- **Regeln des Ortes** (`domain/ticket-picker.ts`): ausblenden (`hideTicket`, das Ticket selbst) oder sichtbar, aber nicht wählbar mit Grund (`aria-disabled`, gedämpft, „Nicht wählbar: …“): `parentRules` (aktuelles übergeordnetes Ticket, eigene Unteraufgabe = Zyklus, Unteraufgabe = zweite Ebene, anderer Bereich), `blockTicket` (schon verknüpft), `sameScope`. Tickets im Papierkorb kommen gar nicht an (API-Regeln, ADR-0037 §3).

## 3. Datenweg

- **Offene Tickets:** aus dem `TicketListStore`, der seit E2 alle offenen Tickets samt Unteraufgaben lädt und per Realtime aktuell hält (ADR-0006, ADR-0007). Der Picker ruft nur `loadOpen()` (bzw. nach einem Fehler `reload()`), wenn die Liste noch nicht geladen ist, und filtert im Client. Die normalisierten Texte werden je Ticket-Objekt einmal gerechnet (`WeakMap`).
- **Erledigte Tickets:** seitenweise vom Server (`listDoneTicketChoices`, 20 je Seite, `-updated`), nur ohne „Nur offene“. SQLite `LIKE` faltet nur ASCII; deshalb geht jedes Wort (höchstens 5) als lockeres Muster (`loosePattern`: Buchstaben mit Akzentformen als `_`, „ss“ als `%`, `%`/`_`/`\` wörtlich) an den Server, und der Client prüft die Antwort genau nach. Der Projektfilter nutzt dieselbe Klausel für Unterprojekte wie die Liste (`project.parent`, nur wenn der Katalog Unterprojekte kennt).
- **Zuletzt angesehen:** `RecentTicketsStore` hält bis zu 10 Ticket-IDs je Gerät und Nutzer in `localStorage` (`byl-recent-tickets`, nur IDs mit der Nutzer-ID), gemerkt beim Öffnen im Panel oder in der Vollansicht.
- **Große Datenmengen:** Offene Tickets sind ohnehin vollständig im Speicher; Filtern von einigen tausend Einträgen kostet Millisekunden, gerendert werden höchstens 25 (bzw. so viele, wie „Mehr anzeigen“ zugelassen hat). Erledigte wachsen unbegrenzt und bleiben deshalb auf dem Server, seitenweise und vorgefiltert.

## 4. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| AL-1 | Domäne, Datenschicht, Store, `TicketPicker`, Übergeordnet, Verknüpfen und Umhängen im Eingang, Bereich an Tickets und Einträgen, Inventur, ADR-0042, CLAUDE.md §7 | `BYL-E6-600` bis `BYL-E6-605`, manuell `BYL-E6-610` bis `BYL-E6-612` |
| AL-2 | Ticket-Link im Editor (`LinkPopover`, App-Links `/tickets/<id>` in Anzeige und Editor), Projekt in der Schnellerfassung | `BYL-E6-606` bis `BYL-E6-608`, manuell `BYL-E6-613` und `BYL-E6-614` |

## 5. Tests

- Unit: `domain/ticket-picker.test.ts` (Normalisierung, Umlaute, UND, lockeres Muster samt Obermengen-Eigenschaft, Regeln, Liste, Grenze, aktiver Eintrag, Status, gemerkte Tickets), `stores/ticket-picker.test.ts` (Quelle und gemerkte Tickets).
- Komponente: `components/ticket-picker.test.ts` (Liste ohne Tippen, Gruppen, Tastatur, Screenreader-Attribute und Live-Region, gesperrte Einträge, „Mehr anzeigen“, Chips, erledigte vom Server) und die angepassten Tests der Fundstellen.
- AL-2: `domain/link.test.ts` (Ticket-Links angenommen, andere relative Formen abgelehnt), `markdown.test.ts` (Ticket-Link ohne `target`, andere relative Links ohne `href`), `domain/quick-syntax.test.ts` (`withProjectToken`), `components/editor-menus.test.ts` (Link auf ein Ticket im echten Editor, Markdown `[HAUS-12 Dach prüfen](/tickets/…)`), `components/quick-capture.test.ts` („Projekt“ und `@CODE`).
- Integration: `tests/integration/web-data-ticket-picker.test.mjs` gegen PocketBase (Umlaute, ß, Akzente über das lockere Muster, UND, Projekt mit und ohne Unterprojekte, „Ohne Projekt“, Seiten, `%` wörtlich, fremde Nutzer und Papierkorb nie, Bereich in der SPA).
- Manuell: Bedienung im Browser (Top-Layer, Glas, Fokus, Screenreader), siehe Manifest.
