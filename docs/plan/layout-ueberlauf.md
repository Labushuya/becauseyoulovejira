# Fehlerbehebung „Layout-Überlauf“: Formular-Controls bleiben in ihrem Container

- **Stand:** umgesetzt (2026-09-28), Branch `fix/form-control-overflow`. Keine Migration, kein Neustart (nur der Build der SPA). Offen ist die manuelle Browser-Prüfung BYL-E6-382.
- **Grundlage:** Fehlerbericht des Nutzers vom 2026-09-28: Das Projekt-Select im Ticket ragt aus dem Panel, sobald ein Unterprojekt gewählt ist („Gesundheit › Christa (CHRS)“). [ADR-0034](../adr/0034-unterprojekte.md) (Beschriftung „Haus › Garten (GART)“), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) (native `select` in Formularen, keine eigenen Dropdowns), [ADR-0029](../adr/0029-glas-materialien.md), [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md), [CLAUDE.md](../../CLAUDE.md) §7 und §8.
- **Einordnung:** Manifest-Block „Layout-Überlauf“ ab `BYL-E6-380`.

## 1. Ursache

Ein `select` ist so breit wie seine längste Option. Als Grid- oder Flex-Element hat es `min-width: auto`, also diese Breite als Mindestbreite. In `TicketFields` steht das Select in `.control` (`display: grid`, eine `auto`-Spur); die Spur wächst auf die Mindestbreite des Selects, und `max-width: 100%` bezieht sich dann auf die schon verbreiterte Spur. Das gleiche gilt für jedes Formular, das ein Select in ein Grid (`.field { display: grid }`) oder eine Flex-Zeile stellt. Solange Projekte kurze Namen hatten, fiel das nicht auf; mit dem Pfad der Unterprojekte ist die längste Option oft breiter als die Spalte.

Gemessen in Chromium (Edge 154, headless) mit einer 300 px breiten Box:

| Aufbau | ohne Regel | mit `min-width: 0` |
|---|---|---|
| `TicketFields` (Grid `7rem minmax(0, 1fr)`, darin `.control` als Grid, Select `width: fit-content; max-width: 100%`) | Select 448 px in einer 170 px breiten Spalte | 170 px |
| `label` als Grid (`.field`), Select `max-width: 100%` | 432 px | 298 px |
| Flex-Zeile „Beschriftung + Select“ | 432 px | 248 px |
| Flex-Zeile mit einem Block-`div` um das Select | 432 px | 432 px (der Block braucht selbst `min-width: 0`; in den Formularen der Inventur nicht gefunden, dort sind die Hüllen Grids) |

`text-overflow: ellipsis` am Select zeigt in Chromium und Firefox „…“ am Ende des geschlossenen Selects.

## 2. Lösung

- **Basisregeln in `base.css`** für alle Formular-Controls: `input, select, textarea { min-width: 0; max-width: 100% }`, `text-overflow: ellipsis` für Selects und Textfelder, `fieldset { min-width: 0 }` (Standard ist `min-content`) und `.search-field` mit `min-width: 0; max-width: 100%`. Komponenten setzen weiter nur Abstände, Rahmen und Breiten; wo eine Mindestbreite nötig ist, als `min(…, 100%)` (Tag umbenennen).
- **Vollständige Beschriftung:** Das Select trägt die ganze Beschriftung des gewählten Werts als `title` (Tooltip): `ProjectSelect` (Panel, Vollansicht, Neues Ticket, Sammelaktion, Gesammelt umwandeln, Regel-Panel, Papierkorb), das Projektfeld der Erfassung, „Oberprojekt“ im Projekt-Panel und „Absender“ beim WhatsApp-Import. Screenreader lesen ohnehin den ganzen Wert der gewählten Option; der Schnitt ist nur optisch.
- **Popover** (`Popover.svelte`): höchstens `100vw - 1rem` breit (passend zu `VIEWPORT_MARGIN`) und `white-space: normal`, weil die Popover der Zellen in einer Tabellenzelle mit `nowrap` stehen; lange Einträge des Projektmenüs brechen um statt aus dem Fenster zu ragen.
- **Kachelraster** (`auto-fill`/`auto-fit`): Mindestbreite als `minmax(min(18rem, 100%), 1fr)`, damit eine Kachel auf schmalen Fenstern nicht breiter als der Bereich wird (Kanäle, Einrichtungswege, Katalog, Projektkacheln, Kennzahlen, Darstellung).
- Keine neuen Tokens, keine neuen Schriftgrößen oder Radien; die Ausnahmelisten bleiben unverändert.

## 3. Beschriftung der Unterprojekte im geschlossenen Select

Geprüft wurde eine kompaktere Darstellung (Oberprojekt gedämpft, Unterprojekt und Code betont). Ein natives `<option>` kennt nur reinen Text; Teile davon zu gestalten ginge nur mit einer eigenen Auswahlliste (ADR-0025 verbietet eigene Dropdowns, Formulare nutzen native Selects) oder mit `appearance: base-select` (bisher nur Chromium, nicht Firefox) – beides ein Bruch mit ADR-0025 bzw. ein Browser-Sonderweg. Den Text im geschlossenen Zustand zu kürzen („Christa (CHRS)“), bräche mit ADR-0034, das in allen Auswahllisten den Pfad verlangt, und nähme den Kontext bei gleichnamigen Unterprojekten. Deshalb bleibt es bei der vollen Beschriftung mit Ellipse und `title`.

## 4. Inventur der Formularstellen

Geprüft bei langen Werten, im eingebetteten Panel ab 64rem (480 px) und schmal (etwa 360 px). „Betroffen“ heißt: lief vor dem Fix über; die Basisregeln beheben alle Fälle ohne eigene Regel in der Komponente.

| Stelle | Komponente | Befund | Maßnahme |
|---|---|---|---|
| Ticket-Panel und Vollansicht (Status, Priorität, Fälligkeit, Projekt, Tags) | `TicketFields`, `ProjectSelect`, `DueInput`, `TagPicker` | betroffen (gemeldeter Fall): Projekt-Select in der `auto`-Spur von `.control` | Basisregeln, `title` |
| Neues Ticket | `NewTicketForm` | betroffen: Projekt-Select in `.field` (Grid) | Basisregeln, `title` |
| Sammelaktion „Projekt …“ | `BulkActionBar` (Modal S) | betroffen: Select in `.field` (Grid) | Basisregeln, `title` |
| „Gesammelt umwandeln“ im Eingang | `BulkConvertDialog` | betroffen: Select in `.field` (Grid) | Basisregeln, `title` |
| Inline-Zellen „Projekt“, „Priorität“, „Status“ | `TicketTableRow`, `EditableCell`, `Popover` | betroffen auf schmalen Fenstern: Menü erbt `nowrap` der Zelle, kein Höchstmaß | Popover mit `max-width` und `white-space: normal` |
| Inline-Zellen „Fälligkeit“, „Tags“ | `DueEditor`, `TagPicker` | nicht betroffen (Grid, Mindestbreite 16rem passt ab 320 px) | – |
| Filterleiste und Filter-Popover | `FilterBar`, `FilterPopover`, `.search-field` | nicht betroffen (Knopf mit Ellipse, Liste höchstens 20rem, Umbruch) | Suchfeld zusätzlich mit `max-width: 100%` |
| Einstellungen → Tags | `TagManager` | Umbenennen-Feld mit `min-width: 10rem` | `min(10rem, 100%)` |
| Einstellungen → Kanäle, Einrichtung | `ChannelsView`, `ConnectionsSection`, `ChannelsIntro`, `ChannelCatalog`, `SetupConnectForm`, `SecretValueField`, `ChannelEditModal` | Kartenraster mit 15 bis 18rem Mindestbreite ragten unter etwa 20rem Breite hinaus; Felder selbst nicht betroffen | `minmax(min(…, 100%), 1fr)` |
| Einstellungen → Datei-Importe, Darstellung, Tickets | `KeywordEditor`, Darstellungs-Kacheln, Radiogruppe | nicht betroffen (Umbruch, Grid) | Kacheln mit `min(12rem, 100%)` |
| Eingang: Erfassen | `CaptureForm` | betroffen: Projekt-Select in `.field` (Grid) | Basisregeln, `title` |
| Eingang: WhatsApp, Postfach-Auswahl, Zwischenablage, Verknüpfen | `WhatsAppImport`, `MailboxPicker`, `ClipboardImport`, `TicketCombobox` | „Absender“ mit langen Namen betroffen; übrige nicht | Basisregeln, `title` am Absender |
| Wiederholungen: Regel-Panel und Formular | `RecurrencePanel`, `RecurrenceForm` | Projekt-Select betroffen; Rhythmus-Felder kurz, nicht betroffen | Basisregeln, `title` |
| Papierkorb: Zielprojekt | `TrashNeedQuestion` | betroffen: Select in `.field` (Grid) in der Warnung | Basisregeln, `title` |
| Projekte: Panel, Liste, Kacheln | `ProjectPanel`, `ProjectsView`, `ProjectTiles` | „Oberprojekt“ mit langen Namen betroffen; Kacheln mit 16rem schmal zu breit | Basisregeln, `title`, `min(16rem, 100%)` |
| Kennzahlen | `KpiTiles` | nicht betroffen (9rem) | einheitlich `min(9rem, 100%)` |
| Editor: Link | `LinkPopover` | nicht betroffen (`width: 100%`) | – |

Nebenbefund ohne Änderung in diesem Fix: `BulkActionBar` und `TrashNeedQuestion` geben `ProjectSelect` eine `hintId` und rendern daneben einen eigenen Hinweis mit derselben ID; `ProjectSelect` rendert seinen Hinweis ebenfalls mit dieser ID (doppelte ID, `aria-describedby` zeigt auf den ersten).

## 5. Regressionsschutz

- `web/src/lib/no-control-overflow.test.ts` (BYL-E6-380): prüft statisch, dass `base.css` die Basisregeln hat und keine Komponente sie zurücknimmt (`min-width` nur `0` oder `min(…, 100%)`, `max-width` nur `100%`, für Controls per Tag oder per Klasse aus ihrem Markup), dass Kachelraster `minmax(min(…, 100%), 1fr)` nutzen und dass Popover begrenzt sind und umbrechen.
- `web/src/lib/components/project-select.test.ts` (BYL-E6-381): `title` mit der ganzen Beschriftung.
- **Warum statisch:** jsdom rechnet kein Layout, ein Test am gerenderten Element sähe keinen Überlauf. Ein Browser-Test bräuchte eine neue Abhängigkeit (Playwright) oder einen Browser im CI, beides gegen den schlanken Aufbau (CLAUDE.md §3, §12). Die Ursache ist rein deklarativ; genau diese Regeln beheben sie (Messung in Abschnitt 1), und der statische Test fängt jede Komponente, die sie zurücknimmt, deterministisch. Die Wirkung im Browser bleibt der manuelle Fall BYL-E6-382.
