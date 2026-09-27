# E6-Plan, Teil Spalten: Breiten ziehen, ein- und ausblenden, kompakte Zeilen

- **Stand:** in Arbeit (2026-09-27); SP-1 gemergt, SP-2 in Arbeit.
- **Grundlage:**
  - [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md) (berechnete Anpassung, Breiten und Schwellen, Griff, Menü „Spalten“, Speichern, kompakte Zeilen)
  - [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) §5 und §11, [ADR-0010](../adr/0010-layout-nach-task-board.md) §1, [ADR-0019](../adr/0019-kanal-filter-und-gruppierung.md) §4, [ADR-0029](../adr/0029-glas-materialien.md)
  - [CLAUDE.md](../../CLAUDE.md) §7, §8, §11, §12
- **Einordnung:** Nutzerwunsch „Spalten wie in Jira“, empfohlen als erstes Paket vor „Editor Stufe A“ und „Unterprojekte“. Die Manifest-IDs laufen ab `BYL-E6-140` (Glas belegt 100 bis 119, Mail ab 120). Dazu gehören zwei kleine Nutzerwünsche: die Tag-Eingabe im Ticket (Komma, Enter, eingefügte Liste, Rücktaste) und die Schalter im Kanal-Dialog als Switch.

## 1. Querschnittsregeln

- Keine Tabelle scrollt seitlich, bei keiner Kombination aus Fensterbreite, Panel und Nutzerbreiten.
- Keine neue Abhängigkeit, keine neuen Farb- oder Maß-Tokens. Schriftgrößen nur über `--font-size-*`, Radien nur über `--radius-*`. Dateien, die ein Paket ohnehin ändert, ziehen dabei von den Ausnahmelisten von `no-own-font-sizes.test.ts` und `no-own-radii.test.ts` auf die Tokens; die Listen schrumpfen nur.
- Was jsdom nicht kann (Layout, Ziehen im echten Browser, Touch, Zoom, `forced-colors`), steht als manueller Fall im Test-Manifest.
- **Gates je Paket:** eigener Branch und PR, `scripts\build.ps1` lokal komplett grün (Exit-Code 0 und „Build complete!“), CI grün, Squash-Merge, Test-Manifest nachgezogen, Entscheidungen in §3.

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| SP-1 | ADR-0030, `domain/columns.ts` (Spezifikationen der vier Tabellen, `fitColumns`, `parseColumnPrefs`/`serializeColumnPrefs`, `clampWidth`, `fitChips`) mit Unit-Tests, `ColumnPrefsStore` und `ColumnPrefsRegistry` | BYL-E6-140 |
| SP-2 | Aufgaben-Tabelle: `fitColumns` statt Container-Queries, `colgroup`, Griff mit Ziehen, Esc und Doppelklick; `table-columns.test.ts` umgestellt | BYL-E6-141, BYL-E6-142 (manuell) |
| SP-3 | Menü „Spalten“ (Ein- und Ausblenden, schmaler/breiter, Zurücksetzen), Spalte „Quelle“ | BYL-E6-143, BYL-E6-144 (manuell) |
| SP-4 | Kompakte Zeilen: Tags einzeilig mit „+N“, Titel mit höchstens 2 Zeilen | BYL-E6-145, BYL-E6-146 (manuell) |
| SP-5 | Eingang, Projekte, Wiederholungen auf demselben Unterbau; CLAUDE.md §7 und Hilfeseite | BYL-E6-147, BYL-E6-148 (manuell) |
| Tags | Tag-Eingabe im Ticket (Panel, Vollansicht, „Neues Ticket“, Sammelumwandeln) mit gemeinsamer Logik wie im Stichwort-Editor | BYL-E6-149, BYL-E6-150 (manuell) |
| Switch | Die zwei Schalter im Kanal-Dialog als Switch | BYL-E6-151 |

## 3. Entscheidungen

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-27 | SP-1 | ADR-Nummer 0030 (0029 ist das Glas; 0030 bis 0032 waren im Konzept nur Vorschläge). Manifest-Block ab `BYL-E6-140`. |
| 2026-09-27 | SP-1 | **Breiten als CSS-Pixel der ganzen Spalte** (samt Innenabstand), wie `<col>` sie bei `table-layout: fixed` nimmt. Die Spezifikationen schreiben sie in rem zu 16 px. |
| 2026-09-27 | SP-1 | **Schwellen:** Mit dem festen Layout brauchen Key, Status und Aktionen echte Breiten, die das automatische Layout vorher dem Titel abnahm. Mit einem Titel-Minimum von 10rem (statt der 12rem im Konzept) liegen alle Schwellen höchstens 2,5rem neben den alten Container-Queries (Tabelle in ADR-0030 §2); bei 12rem wären es in „Aufgaben“ bis zu 4,5rem gewesen, und neben dem Panel bei 1280 px wäre „Projekt“ verschwunden. `columns.test.ts` prüft je Spalte ±1rem gegen die ADR und ±2,5rem gegen die alten Werte. |
| 2026-09-27 | SP-1 | **Projekte:** „neu“ ist 5rem statt 4,5rem breit (der Kopf „neu“ mit Sortierpfeil braucht es, und die Schwelle bleibt sonst 3rem unter der alten). |
| 2026-09-27 | SP-1 | **Nicht gemessen = nichts weicht:** Vor dem ersten Layout und in jsdom liefert der Rahmen keine Breite. `fitColumns(null, …)` zeigt dann alle eingeschalteten Spalten in ihren Breiten. So bleiben die bisherigen Komponententests gültig; das Ausweichen prüfen Unit-Tests und Tests mit gestubbtem `ResizeObserver`. |
| 2026-09-27 | SP-1 | **Vorlieben pro Eintrag streng:** Eine andere Version, kaputtes JSON oder kein Objekt ergeben die Standardwerte; einzelne unbekannte Spalten, Pflichtspalten in `hidden` und Breiten, die keine positive endliche Zahl sind, werden übergangen, der Rest gilt. Die Standardwerte entfernen den Schlüssel (wie „Petrol“ bei `byl-accent`). |
| 2026-09-27 | SP-1 | **Registry statt Modul-Singleton:** `ColumnPrefsRegistry` im Kontext des `(app)`-Layouts erzeugt je Tabelle einen Store und hört einmal auf `storage`. Ohne Layout (Komponententests) bekommt eine Tabelle einen eigenen Store auf dem `localStorage` des Fensters, ohne Flags und ohne Abgleich. „Standard wiederherstellen“ meldet sich über die `FlagSink` der Registry. |
| 2026-09-27 | SP-2 | **Griff als eigener Baustein** `components/table/ResizableHeader.svelte` (das `th` mit Inhalt und Griff), damit alle vier Tabellen dieselbe Zeiger-Logik nutzen. Der Inhalt steht in `[data-column-label]`, so zählt beim Doppelklick nur er, nicht der Griff. Die Tabelle stylt ihre Köpfe deshalb über `thead :global(th)`. |
| 2026-09-27 | SP-2 | **Ziehen:** Das Budget (Raum des Titels über seinem Minimum) wird beim `pointerdown` festgehalten; so weicht während des Ziehens keine Spalte, und die Breite springt nicht. Esc hört in der Capture-Phase am `window`, verbraucht die Taste (`preventDefault`, `stopPropagation`) und kommt so vor dem Panel. `pointercancel` bricht ab wie Esc. `setPointerCapture` fehlt in jsdom und steht in `try`. |
| 2026-09-27 | SP-2 | **Doppelklick:** Die natürliche Breite misst ein `Range` über den Inhalt jeder Zelle (auch abgeschnittener, `nowrap`-Inhalt zählt) plus Innenabstand; bei Tags die Summe der Chips einer Zeile samt Abstand. Geklemmt auf Maximum und Budget. |
| 2026-09-27 | SP-2 | **`data-col` an jeder Zelle** (vorher nur an den weichenden Spalten), dazu `col[data-column]` in der `colgroup`; so findet der Doppelklick alle Zellen einer Spalte. Zellen schneiden ab, statt überzulaufen (`overflow: hidden`, Ellipse); Status, Fällig und Aktionen bleiben einzeilig. |
| 2026-09-27 | SP-2 | **`forced-colors`:** Die Linie des Griffs ist ein Rand, den das System in seiner Textfarbe zeichnet; dort ist sie immer sichtbar. Keine Systemfarbe im Code (`color-literals.test.ts`). |
| 2026-09-27 | SP-2 | `TicketTable` und `TicketTableRow` ziehen bei der Gelegenheit auf die Schriftgrößen-Tokens (13 Werte, `no-own-font-sizes.test.ts` jetzt 275). |

## 4. Status

| Paket | Stand |
|---|---|
| SP-1 | gemergt (#98) |
| SP-2 | in Arbeit |
| SP-3 | offen |
| SP-4 | offen |
| SP-5 | offen |
| Tags | offen |
| Switch | offen |

## 5. Offene Punkte

- Manuelle Browser-Prüfungen der Pakete (Ziehen in Chrome, Firefox und Opera GX, Touch im Android-Emulator, 1280/1100/900/600 px mit und ohne Panel, Zoom 150 %, `forced-colors`).
