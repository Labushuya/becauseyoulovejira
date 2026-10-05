# ADR-0030: Spaltenbreiten, Ein- und Ausblenden und kompakte Zeilen in Tabellen

- **Status:** Angenommen und umgesetzt in den Paketen SP-1 bis SP-5 nach [docs/plan/e6-spalten.md](../plan/e6-spalten.md) (#98 bis #101 und der PR von SP-5); manuelle Browser-Prüfungen stehen im Test-Manifest; Nachtrag 2026-09-28 (Spalte „Übergeordnet“ und Schalter der Tabelle, [ADR-0033](0033-unteraufgaben.md)); Nachtrag 2 (Auswahlspalte); Nachtrag 3 2026-09-29 (Breite des Titels); Nachtrag 4 2026-10-01 (Spalte „Aktionen“ mit dem Zeilenmenü); Nachtrag 5 2026-10-01 (Spalten „Aktionen“ der übrigen Tabellen mit dem Zeilenmenü); Nachtrag 6 2026-10-02 (Spalte „Zielprojekt“); Nachtrag 7 2026-10-05 (Spalten mit Keys und mehrstellige Ticketnummern, KN-1)
- **Datum:** 2026-09-27
- **Entscheidung durch:** Nutzer (Wunsch „Spalten ziehen, ein- und ausblenden, kompakte Zeilen wie in Jira“, Reihenfolge „Spalten zuerst“), Advisor (Konzept „Spalten“), Executor (Breiten, Schwellen, Einzelheiten)
- **Präzisiert:** [ADR-0025](0025-ui-konsistenz-overlay-system.md) §11 (Ausblenden per Container-Queries) und [ADR-0010](0010-layout-nach-task-board.md) §1 (Popover „Spalten“ ab E6). „Tabellen scrollen nie seitlich“ und die Reihenfolge beim Ausblenden bleiben.
- **Löst ein:** [ADR-0019](0019-kanal-filter-und-gruppierung.md) §4 („Eine eigene Spalte ‚Quelle‘ kommt erst mit dem Popover ‚Spalten‘ in E6“)

## Kontext

Die vier Tabellen („Aufgaben“, „Eingang“, „Projekte“, „Wiederholungen“) haben ein automatisches Layout. Nur der Titel ist flexibel, alle anderen Spalten sind so breit wie ihr Inhalt. Ihr Rahmen ist ein Container. Je vier Container-Queries mit festen Schwellen blenden Spalten per `display: none` aus (ADR-0025 §11).

Der Nutzer möchte:

- Spaltenbreiten per Ziehen ändern
- Spalten ein- und ausblenden
- niedrigere Zeilen

Heute macht ein Ticket mit vielen Tags seine Zeile beliebig hoch, weil jeder Tag ein `inline-block` ist und die Zelle umbricht. Lange Titel umbrechen ohne Grenze.

Kernproblem: Container-Queries kennen keine Breite, die der Nutzer gezogen hat. Mit festen Schwellen würde die Tabelle entweder breiter als ihr Rahmen und scrollte seitlich, oder der Titel würde auf null gequetscht.

## Entscheidung

### 1. Berechnete Anpassung statt Container-Queries

- Die reine Funktion `fitColumns(breite, spalten, vorlieben)` in `web/src/lib/domain/columns.ts` entscheidet, welche Spalten sichtbar sind und wie breit sie sind. Ein `ResizeObserver` am Rahmen liefert die Breite, das Ergebnis ist ein `$derived`.
- Die Tabelle nutzt `table-layout: fixed` und eine `<colgroup>`. Ausgeblendete Spalten werden nicht gerendert und sind damit auch für Screenreader weg, wie bisher.
- Algorithmus:
  1. Ausgangsmenge sind alle Spalten, die der Nutzer nicht ausgeschaltet hat. Pflichtspalten bleiben immer.
  2. Jede Spalte hat die Breite aus den Vorlieben oder ihren Standard, geklemmt auf Minimum und Maximum der Spalte. Genau eine Spalte je Tabelle ist flexibel (Titel bzw. Name) und nimmt den Rest, mindestens 10rem.
  3. Passt die Summe plus Minimum der flexiblen Spalte nicht in den Rahmen, weichen Spalten in der festen Reihenfolge aus ADR-0025 §11. Die Nutzerbreiten bleiben gespeichert.
  4. Passt es danach immer noch nicht, schrumpfen die Breiten gleichmäßig bis zu ihrem Minimum. Erst dann geht der Titel unter sein Minimum, zuletzt schrumpfen alle Spalten anteilig. Die Summe überschreitet den Rahmen nie.
  5. Das Ergebnis ist `{ visible, autoHidden, widths, flexWidth }`. Die Beschriftung „Weitere Spalten im Panel“ erscheint nur, wenn `autoHidden` nicht leer ist. Selbst ausgeschaltete Spalten lösen sie nicht aus.
- Ohne gemessene Breite (vor dem ersten Layout, in jsdom) weicht keine Spalte.

### 2. Breiten und Schwellen

Breiten sind CSS-Pixel der ganzen Spalte samt Innenabstand (Angaben hier in rem zu 16 px). Ein festes Tabellen-Layout braucht echte Breiten für Key, Status und Aktionen, die das automatische Layout vorher aus dem Titel nahm. Die Schwellen verschieben sich dadurch um höchstens 2,5rem; `columns.test.ts` prüft Reihenfolge und Schwellen.

| Tabelle | Spalten (Standard, Minimum–Maximum; P = Pflicht) | Reihenfolge beim Ausweichen | Schwellen vorher → jetzt |
|---|---|---|---|
| Aufgaben | Key 6 (4–8, P), Prio 4 (3–6), Status 6,5 (4,5–10), Titel ≥ 10 (P), Projekt 8 (4–16), Tags 8 (4–20), Fällig 8 (5–12), Erstellt 6 (5–9), Aktionen 4 (P) | Erstellt, Tags, Projekt, Fällig | 60/52/44/36 → 60,5/54,5/46,5/38,5 |
| Eingang | Auswahl 2,5 (P, nur bei „Neu“), Art 6 (4–10), Titel ≥ 10 (P), Quelle 7 (4–12), Quelldatum 6 (5–9), Eingang 6 (5–9), Aktionen 13 (P) | Eingang, Quelle, Art, Quelldatum | 52/46/40/34 → 50,5/44,5/37,5/31,5 |
| Projekte | Code 6 (4–8, P), Name ≥ 10 (P), aktiv 5 (4–7), gesamt 5,5 (4–8), neu 5 (3,5–7), archiviert 6,5 (5–9) | archiviert, neu, gesamt, aktiv | 40/34/28/22 → 38/31,5/26,5/21 |
| Wiederholungen | Titel ≥ 10 (P), Rhythmus 10 (6–20), Nächstes Ticket 7 (5,5–10), Offenes Ticket 7 (5–10), Projekt 9 (5–16), Zustand 7 (6–9, P), Aktion 3,5 (P) | Projekt, Offenes Ticket, Nächstes Ticket, Rhythmus | 52/44/36/28 → 53,5/44,5/37,5/30,5 |

- In „Aufgaben“ sind auch Prio und Status ausschaltbar (wie in Jira), sie weichen aber nie von selbst.
- Dazu kommt die Spalte „Quelle“, standardmäßig aus. Sie weicht als erste.

### 3. Ziehen, Doppelklick, Tastatur

- **Griff:** am rechten Rand jedes Spaltenkopfs mit änderbarer Breite, 6 px Trefferfläche, `cursor: col-resize`, `touch-action: none`.
  - Er ist `aria-hidden` und nicht fokussierbar, also nur für Maus und Touch (Android-APK, ADR-0028).
  - Die Tastatur nutzt den gleichwertigen Weg im Menü „Spalten“ (§4).
- **Ziehen:**
  - `pointerdown` mit `setPointerCapture` beginnt.
  - `pointermove` ändert die Breite live. Sie ist geklemmt auf Minimum und Maximum und auf das Budget, sodass der Titel sein Minimum behält.
  - `pointerup` speichert.
  - Esc während des Ziehens stellt die alte Breite wieder her und verbraucht Esc (Escape-Kette, ADR-0025 §1).
  - Ein Klick auf den Griff sortiert nicht.
- **Doppelklick:** passt die Breite an den breitesten sichtbaren Inhalt von Kopf und Zellen der Spalte an (`scrollWidth`, die Zellen sind `nowrap`), höchstens bis zum Maximum und zum Budget. Bei Tags zählt die Breite aller Chips einer Zeile.

### 4. Menü „Spalten“

- Knopf „Spalten“ in der Abschnittsleiste neben „Gruppieren“. Er öffnet ein `Popover` der Art `panel` mit Namen (Material thick vom Baustein).
- Inhalt:
  - `fieldset` „Sichtbare Spalten“ mit einer Zeile je optionaler Spalte: Checkbox (gestaltet allein von `base.css`), „schmaler“ und „breiter“ als `.button-icon` mit `aria-label` und `title` (Schritt 1rem) und die Breite als Text („8 rem“)
  - eine gemeinsame `aria-live`-Zeile, die „Projekt: 9 rem“ meldet
  - wegen Platz ausgeblendete Spalten bleiben angehakt und tragen per `aria-describedby` den neutralen Hinweis „wegen Platz ausgeblendet“
  - der Satz, welche Spalten immer sichtbar sind; Pflichtspalten stehen nicht in der Liste
  - „Standard wiederherstellen“ setzt Breiten und Sichtbarkeit dieser Tabelle ohne Rückfrage zurück, mit dem Info-Flag „Spalten zurückgesetzt“. Der Fokus bleibt im Popover.

### 5. Speichern

- Je Tabelle in `localStorage` unter `byl-columns-tickets`, `byl-columns-inbox`, `byl-columns-projects` und `byl-columns-recurrences`, im Format `{ "v": 1, "widths": { "project": 160 }, "hidden": ["created"] }`. Breiten in CSS-Pixeln, geklemmt. Die Standardwerte entfernen den Schlüssel.
- `parseColumnPrefs` ist streng: kaputtes JSON, eine andere Version und falsche Typen zählen als „nicht gesetzt“. Unbekannte Spalten und Pflichtspalten in `hidden` werden übergangen. Fehler des Speichers werden abgefangen, die Wahl gilt dann für die Seite.
- `ColumnPrefsStore` je Tabelle, gehalten von der `ColumnPrefsRegistry` im Kontext des `(app)`-Layouts (ADR-0006, kein Modul-Singleton). Ein `storage`-Listener gleicht andere Tabs ab.
- Nur auf dem Gerät, nicht pro Nutzer bis E7 (wie Theme und Akzent), nicht in der URL: Spalten sind eine Vorliebe des Geräts, kein teilbarer Ansichtszustand.

### 6. Kompakte Zeilen

- **Tags einzeilig:** Die Zelle bricht nicht um. Wie viele Chips passen, berechnet die reine Funktion `fitChips(namen, breite, messen)`. Sie hält Platz für „+N“ frei.
  - `messen` nutzt `measureText` einer `OffscreenCanvas` mit der Schrift der Chips, zwischengespeichert je Name. Ohne Canvas (jsdom) gilt die Schätzung „Zeichen × 0,6em“.
  - „+N“ ist nicht interaktiv. `title` nennt die übrigen Tags, für Screenreader steht die ganze Liste als verborgener Text in der Zelle.
- **Titel höchstens 2 Zeilen** per `line-clamp: 2`, rein optisch. `title` am Link erst ab 60 Zeichen.
- Das gilt ebenso für die Titel in „Eingang“ und „Wiederholungen“.

## Alternativen

- **Container-Queries mit Nutzerbreiten als Obergrenze:** garantiert „nie seitlich scrollen“ nicht, die Schwellen passten nicht mehr zu den Breiten. Verworfen.
- **Breiten in Prozent:** Beim Stauchen durch das Panel schrumpfen erst alle Spalten, Key und Datum werden abgeschnitten, bevor etwas weicht. Verworfen.
- **Fokussierbarer Griff (`role="separator"`, Muster „Window Splitter“):** WAI-ARIA-konform, aber bis zu sieben weitere Tab-Stopps je Tabelle neben den Sortierknöpfen. Das Muster ist für Fensterbereiche gedacht. Verworfen zugunsten des Menüs.
- **„+N“ als Knopf mit Popover:** kostet je Zeile einen Tab-Stopp und kollidiert mit dem Zeilenklick. Zurückgestellt, nachrüstbar.
- **Spalten pro Nutzer in PocketBase:** braucht Migration und API-Regel, bringt vor E7 nichts. Zurückgestellt.

## Konsequenzen

- Das Ausblenden ist erstmals in jsdom testbar (`columns.test.ts` und Komponententests mit gestubbtem `ResizeObserver`). `table-columns.test.ts` prüft statt der Container-Regeln `table-layout: fixed` und dass keine Tabelle mehr eigene Regeln zum Ausblenden hat.
- Etwa 250 Zeilen reiner Code mehr, keine neue Abhängigkeit, keine neuen Tokens.
- Die Einstellungen gelten pro Gerät.
- CLAUDE.md §7 beschreibt ab SP-2 den neuen Unterbau. Bis ein Paket gemergt ist, gilt für seine Tabelle die bisherige Beschreibung.

## Nachtrag (2026-09-28): Spalte „Übergeordnet“ und Schalter der Tabelle (ADR-0033)

Der Text oben bleibt unverändert. Mit den Unteraufgaben ([ADR-0033](0033-unteraufgaben.md) §5, Paket UA-5) gilt zusätzlich:

- **Spalte „Übergeordnet“** in „Aufgaben“ zwischen Titel und Quelle: 7rem (5 bis 10), standardmäßig aus, Rang 0 wie „Quelle“ (beide weichen vor „Erstellt“; bei gleichem Rang zuerst die weiter links). Die gespeicherte Liste `hidden` enthält im Standard `parent` und `source`. Die Schwellen der übrigen Spalten ändern sich nicht, weil die Spalte im Standard aus ist.
- **Spalten, die später dazukommen** (`ColumnSpec.optIn`, bisher nur „Übergeordnet“): Eine vorher gespeicherte Liste `hidden` nennt sie nicht und würde sie sonst einschalten. Sie gelten deshalb nur als eingeblendet, wenn die gespeicherten Vorlieben sie unter `shown` nennen; `serializeColumnPrefs` schreibt `shown` für eingeblendete `optIn`-Spalten. Die Bedeutung von `hidden` für die übrigen Spalten bleibt.
- **Schalter einer Tabelle:** `TableSpec.options` nennt Schalter neben den Spalten, für „Aufgaben“ nur „Unteraufgaben einrücken“ (`nest`, Standard an). Das Menü „Spalten“ zeigt sie in einer eigenen Gruppe „Darstellung“ als Checkbox. Gespeichert wird im selben Schlüssel unter `options`, nur ein Wert, der vom Standard abweicht (`{ "v": 1, …, "options": { "nest": false } }`); `parseColumnPrefs` liest nur bekannte Namen mit einem Wahrheitswert. „Standard wiederherstellen“ setzt die Schalter mit zurück. Die Version bleibt 1, weil ältere Werte ohne `options` gültig bleiben.

## Nachtrag 2 (2026-09-28): Auswahlspalte der Aufgaben (ADR-0036)

Mit den Sammelaktionen ([ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §2, Paket BI-2) hat „Aufgaben“ vorn die Spalte **„Auswahl“** (`select`): fest 2,5rem, Pflicht, nicht ausschaltbar, nicht im Menü „Spalten“, ohne Griff, wie die Auswahl im Eingang. Die Schwellen der Tabelle steigen dadurch um 2,5rem (Erstellt 63, Tags 57, Projekt 49, Fällig 41rem); die Reihenfolge beim Ausweichen und „Tabellen scrollen nie seitlich“ bleiben. Das Menü „Spalten“ nennt sie im Satz der immer sichtbaren Spalten. Gespeicherte Vorlieben ändern sich nicht (Pflichtspalten stehen nie in `hidden`).

## Nachtrag 3 (2026-09-29): Breite des Titels

Nutzerwunsch: „Ich möchte zudem, dass ich auch die Spalte ‚Titel‘ in ihrer Breite verändern kann.“ Bisher war die flexible Spalte (Titel, in „Projekte“ der Name) ohne Griff und nahm immer den Rest. Der Text oben bleibt, soweit hier nichts anderes steht. „Tabellen scrollen nie seitlich“ bleibt.

### Entscheidung

- **Alle fünf Tabellen:** Die flexible Spalte ist änderbar, 10rem bis 60rem (`isResizable` gilt jetzt auch für sie). Sie hat denselben Griff wie die anderen (nur Zeiger, `aria-hidden`, Esc bricht ab) und im Menü „Spalten“ eine Zeile an ihrer Stelle in der Tabelle, ohne Checkbox (sie ist Pflicht), mit „schmaler“, „breiter“ und der Breite; ohne gewählte Breite steht dort „auto“. Das ist derselbe Tastaturweg wie bei den übrigen Spalten (§3 und §4).
- **Gespeichert** wird die Breite wie die anderen unter `widths` (z. B. `{ "title": 320 }`), Version 1 bleibt. Ältere Werte ohne diesen Schlüssel ergeben genau das bisherige Verhalten: der Titel nimmt den Rest. Ältere Stände der App übergehen den Schlüssel, weil sie die Spalte nicht als änderbar kennen. „Standard wiederherstellen“ setzt die Titelbreite mit zurück; ein Doppelklick auf den Griff des Titels vergisst nur sie (der Titel hat keine natürliche Breite, er bricht auf 2 Zeilen um).
- **Wohin der Platz geht** (`fitColumns` Schritt 5, reine Funktion):
  1. Welche Spalten wegen Platz weichen, entscheidet weiter allein das Minimum des Titels (Schritt 3). Eine gewählte Titelbreite blendet nie eine Spalte aus, und die Schwellen bleiben, wie sie sind.
  2. **Mehr Platz als die Titelbreite:** Der Titel bekommt genau seine Breite. Der Rest geht gleichmäßig an die übrigen sichtbaren Spalten, jede im Verhältnis zu ihrem Abstand zum Maximum (Tags mit 20rem bekommen am meisten, feste Spalten wie Auswahl und Aktionen nichts). Die Pixel aus dem Runden gehen einzeln in der Reihenfolge der Tabelle an Spalten mit Luft, damit der Titel pixelgenau stehen bleibt. Sind alle am Maximum, geht der Rest an den Titel zurück.
  3. **Weniger Platz als die Titelbreite** (Fenster schmaler, Panel offen, andere Spalte breiter): Der Titel gibt zuerst nach, wie bisher bis zu seinem Minimum; danach weichen Spalten wie bisher. Unterhalb der gewählten Breite ist das Ergebnis also identisch mit dem ohne Titelbreite.
- **Ziehen und Menü** (`resizeColumn`, `flexibleBounds`):
  - **Titel breiter** als der Rest: Die übrigen sichtbaren Spalten werden gleichmäßig zu ihrem Minimum hin schmaler und behalten diese Breite (sie wird mit gespeichert). Am Minimum aller stoppt der Griff; es verschwindet keine Spalte.
  - **Titel schmaler:** Nur die Titelbreite ändert sich; den Rest verteilt Schritt 5. Der Griff stoppt, wo alle anderen am Maximum wären, und nie unter 10rem.
  - **Andere Spalte, während der Titel eine Breite hat:** Die sichtbaren Spalten behalten die Breite, mit der sie gerade gezeigt werden (sie wird gespeichert), und der Titel gibt oder nimmt die Differenz, wie ohne Titelbreite. So bewegt sich beim Ziehen nur die Grenze zwischen Spalte und Titel, nichts springt. Ohne Titelbreite ändert sich wie bisher nur die gezogene Spalte.
  - Grenzen werden beim Beginn des Ziehens aus den gespeicherten Vorlieben berechnet, die Vorschau beim Ziehen immer aus ihnen neu. Nichts schreibt aus dem Layout zurück: keine Schleife zwischen `ResizeObserver`, `fitColumns` und Speicher.

### Begründung

- **Titel gibt zuerst nach, statt die anderen zu stauchen:** Dann hängt das Ausblenden nicht von der Titelbreite ab, und beim Verkleinern des Fensters verhält sich die Tabelle genau wie bisher, bis der Titel wieder seine Breite hat. Ein Titel, der beim Verkleinern alle anderen Spalten zusammendrückt, würde Key, Status und Datum abschneiden, bevor etwas weicht (das Argument gegen Prozent-Breiten oben).
- **Rest auf alle statt einer Ausgleichsspalte:** Eine einzelne Ausgleichsspalte liefe bei breitem Fenster über ihr Maximum hinaus oder müsste an eine zweite weitergeben; die gleichmäßige Verteilung nach dem Abstand zum Maximum ist das Spiegelbild des Schrumpfens in Schritt 4 und für jede Tabelle gleich.
- **Stauchen beim Breiterziehen wird gespeichert:** Sonst würde jede später gezogene andere Spalte gegen den Titel arbeiten (die Tabelle hätte zwei Spalten, die den Rest beanspruchen) und beim Loslassen springen.

### Alternativen

- **Titelbreite als Mindestbreite** (Rest weiter an den Titel): Schmaler ziehen hätte auf breiten Fenstern keine Wirkung. Verworfen.
- **Leerraum rechts der Tabelle:** Zeilen, Gruppenköpfe und Rahmen endeten vor dem Rand oder bräuchten eine leere Spalte in jeder Zeile. Verworfen.
- **Fokussierbarer Griff:** aus demselben Grund wie in §3 verworfen; die Tastatur nutzt das Menü.

### Konsequenzen

- `ColumnPrefsStore.setWidth` ist durch `setWidths` (mehrere Breiten auf einmal) und `clearWidth` ersetzt; `ColumnFit` führt jede Breitenänderung über `resizeColumn` und hält beim Ziehen die ganze Vorschau (`live`). Das Menü „Spalten“ bekommt den `ColumnFit` statt Store und `autoHidden`.
- Tests: `columns.test.ts` (Verteilung, Grenzen, Fenster, ausgeblendete Spalten, Altdaten), `column-prefs.test.ts`, `ticket-table-columns.test.ts` (Griff) und `columns-popover.test.ts` (Tastatur); Manifest BYL-E6-460 bis BYL-E6-462.

## Nachtrag 4 (2026-10-01): Spalte „Aktionen“ der Aufgaben mit dem Zeilenmenü

Mit dem Zeilenmenü „•••“ ([Plan Aktionsmenüs](../plan/aktionsmenues.md) AM-2, [ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md), Nachtrag) trägt die Spalte „Aktionen“ der Aufgaben drei Bedienelemente: das Häkchen, „Öffnen“ und „•••“. Der Text oben bleibt, soweit hier nichts anderes steht.

- **Breite:** fest **5,5rem** statt 4rem (Pflicht, ohne Griff, nicht im Menü „Spalten“, wie bisher). Darin: Häkchen 1rem, „Öffnen“ 14 px, „•••“ als `.button-icon` in `--control-height-s` (1,5rem, damit die Zeile nicht höher wird als mit der Auswahl), je 0,5rem Abstand und 0,5rem Innenabstand links und rechts statt 0,75rem. Keine neuen Tokens.
- **Schwellen** (Tabelle §2, Nachtrag 2): Sie steigen um 1,5rem auf Erstellt 64,5, Tags 58,5, Projekt 50,5 und Fällig 42,5rem; die Reihenfolge beim Ausweichen und „Tabellen scrollen nie seitlich“ bleiben, die Mindestbreite des Titels (10rem) auch. Bei 800 px Rahmen weicht jetzt zusätzlich „Projekt“ (vorher nur Erstellt und Tags); ab 840 px steht es wieder.
- **Gespeicherte Vorlieben** ändern sich nicht: Pflichtspalten stehen nie in `widths` oder `hidden`. Eine gespeicherte Titelbreite (Nachtrag 3) gilt weiter; ihr Höchstwert beim Ziehen sinkt um die 1,5rem, die die Spalte mehr braucht.
- **Alternative verworfen:** 6rem mit dem bisherigen Innenabstand (0,5rem mehr Platz, der nur leer stünde) und ein Menü statt des Symbols „Öffnen“ (das Symbol bleibt nach Vorgabe; der Titel-Link und der Zeilenklick öffnen ohnehin).
- Tests: `columns.test.ts` (Schwellen, Beispiele bei 840 und 800 px, Grenzen des Titels), `ticket-table-columns.test.ts`, `columns-popover.test.ts`; Manifest BYL-E6-745.

## Nachtrag 5 (2026-10-01): Spalten „Aktionen“ der übrigen Tabellen mit dem Zeilenmenü

Mit den Zeilenmenüs „•••“ in „Papierkorb“, „Eingang“, „Projekte“ und „Wiederholungen“ ([Plan Aktionsmenüs](../plan/aktionsmenues.md) AM-4, [ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md), Nachtrag „Zeilenmenüs der übrigen Tabellen“) endet jede Zeile jeder Tabelle mit diesem Menü. Der Text oben bleibt, soweit hier nichts anderes steht; „Tabellen scrollen nie seitlich“ und die Reihenfolge beim Ausweichen bleiben.

- **Ein Maß für den Knopf:** „•••“ steht in allen Tabellen in `--control-height-s` (1,5rem); die Regel `.button-icon.row-menu` steht jetzt in `base.css` statt in `TicketTableRow`, damit keine Zeile höher wird. Keine neuen Tokens.

| Tabelle | Spalte „Aktionen“ vorher → jetzt | Inhalt | Schwellen beim Ausweichen |
|---|---|---|---|
| Papierkorb | 5 → 5rem (unverändert) | „Wiederherstellen“ (2rem) und „•••“; das Symbol „Endgültig löschen …“ entfällt, Innenabstand 0,5rem | unverändert |
| Eingang | 13 → **15rem** | „Umwandeln“ und „Verwerfen“ (bzw. „Wiederherstellen“, der Chip des Tickets) und „•••“ | +2rem: Eingang 52,5, Quelle 46,5, Art 39,5, Quelldatum 33,5rem |
| Projekte | keine → **3,5rem** (neu, Pflicht, ohne Griff, nicht im Menü „Spalten“, sortiert nicht) | „•••“ | +3,5rem: archiviert 41,5, neu 35, gesamt 30, aktiv 24,5rem |
| Wiederholungen | 3,5 → 3,5rem (unverändert) | „•••“ statt des Symbols „Pausieren“/„Fortsetzen“ | unverändert |

- **Gespeicherte Vorlieben** ändern sich nicht: Pflichtspalten stehen nie in `widths` oder `hidden`. Eine gespeicherte Titel- bzw. Namensbreite gilt weiter; im Eingang und in den Projekten sinkt ihr Höchstwert beim Ziehen um die zusätzliche Breite.
- **Menü „Spalten“:** Der Satz der immer sichtbaren Spalten nennt in den Projekten jetzt „Code, Name und Aktionen“, in den Wiederholungen „Titel, Zustand und Aktionen“.
- **Breite des Eingangs:** „Umwandeln“ und „Verwerfen“ brauchen in Inter bei `--font-size-control` je etwa 5rem samt Innenabstand und Rahmen, dazu „•••“ (1,5rem), zwei Abstände (1rem) und der Innenabstand der Zelle (1,5rem): 14,4rem. 15rem lassen Luft für Rundung und andere Schriftglättung; 14rem hätten auf manchen Systemen „•••“ abgeschnitten.
- **Alternative verworfen:** „Verwerfen“ im Eingang nur noch im Menü, um die Breite zu halten. Umwandeln und Verwerfen sind die zwei Wege beim Sichten des Eingangs; beide bleiben sichtbar. Im Papierkorb und in den Wiederholungen ersetzt „•••“ dagegen ein seltenes Symbol, deshalb bleibt die Breite dort.
- Tests: `columns.test.ts` (Schwellen und Breiten), `inbox-table.test.ts` (Ausweichen bei 640 statt 600 px), `projects-view.test.ts` (Spalten, Ausweichen bei 500 statt 450 px), `table-columns.test.ts` (Menü und Kontextmenü in jeder Tabelle); Manifest BYL-E6-769.

## Nachtrag 6 (2026-10-02): Spalte „Zielprojekt“ im Eingang ([ADR-0049](0049-zielprojekt-je-eingangsweg.md))

Der Eingang bekommt die optionale Spalte **„Zielprojekt“** (`target`) zwischen „Quelle“ und „Quelldatum“: 8rem (4 bis 16), **standardmäßig aus** und als **erste weichend** (Rang 0, wie „Quelle“ und „Übergeordnet“ in „Aufgaben“), als später dazugekommene Spalte `optIn` (eine gespeicherte Liste `hidden` schaltet sie nicht ein; eingeblendet steht sie unter `shown`). So ändern sich Standardansicht und Schwellen nicht; wer sie einblendet, verliert sie zuerst, wenn der Platz knapp wird. Sie zeigt den Pfad mit Code („Haus › Garten (GART)“, „… archiviert“, „gelöscht“), ohne Ziel „–“. Bis der Server das Feld kennt, steht sie nicht im Menü. Wer viele Ziele vergleicht, gruppiert besser nach Zielprojekt (Schalter neben den Chips); deshalb ist die Spalte nicht Teil der Standardansicht.

## Nachtrag 7 (2026-10-05): Spalten mit Keys und mehrstellige Ticketnummern (KN-1)

Nutzerwunsch: Ticketnummern dürfen beliebig viele Stellen bekommen (1000, 10 000, 1 000 000 …), ohne dass irgendwo ein Problem entsteht. Der Zähler `ticket_counters` hat kein Maximum, `formatKey` füllt nicht auf und begrenzt nicht, die Sortierung vergleicht die Nummer als Zahl; das bleibt unverändert. Nur die Anzeige hatte feste Breiten: Die Spalte „Key“ (6rem, höchstens 8rem, JetBrains Mono bei 13 px, `overflow: hidden` mit „…“) schnitt mit dem Punkt „neu“ schon „HAUS-100“ ab, ohne `title`. Der Text oben bleibt, soweit hier nichts anderes steht; „Tabellen scrollen nie seitlich“ und die Reihenfolge beim Ausweichen bleiben.

### Entscheidung

- **Breite eines Keys** (`keyCellWidth` in `columns.ts`): Jedes Zeichen der Monospace-Schrift ist 0,6em (1ch) breit, ein Key braucht also seine Länge in ch bei `--font-size-control`, dazu 1,5rem Innenabstand, in „Aufgaben“ 0,875rem für den Punkt „neu“ (0,5rem und 0,375rem Abstand) und 2 px für Rundung und Schriftglättung. Gerechnet wird mit der tatsächlichen Größe von 1rem der Seite.
- **Standardbreite nach der Liste** (`withKeyDefaults`): Key in „Aufgaben“ (mit Platz für den Punkt, auch wenn gerade kein Ticket neu ist, damit nichts springt), Key im Papierkorb, „Übergeordnet“ und „Offene Tickets“ der Wiederholungen nehmen als Standard die Breite des längsten Keys der gezeigten Liste (angeheftete und offene Tickets, Einträge des Papierkorbs, übergeordnete Tickets der Zeilen, offene Tickets aller Regeln). Nie schmaler als der bisherige Standard (6 bzw. 7rem): Für die heutigen Keys bleiben Spalten und Schwellen gleich. Von selbst nie breiter als 12rem (`KEY_AUTO_MAX`). `ColumnFit` bekommt die angepassten Spalten; die eigene Breite einer Spalte (Menü „Spalten“, Schritt, Doppelklick) kommt seitdem aus diesen Spalten statt aus der festen Spezifikation, sonst nennte das Menü eine andere Breite als die Tabelle zeigt.
- **Bereich:** Key in „Aufgaben“ und im Papierkorb 4 bis 12rem (vorher 8), „Übergeordnet“ 5 bis 12rem (vorher 10). „ABCDEF-1000000“ braucht mit Punkt etwa 9,4rem und passt damit auch bei einem größeren Schriftgrad des Browsers. „Offene Tickets“ bleibt bei 5 bis 16rem.
- **Vorrang des Nutzers:** Eine gezogene oder im Menü gesetzte Breite gilt wie bisher (`columnWidth`), in beide Richtungen. „Standard wiederherstellen“ bringt den Standard aus den Keys zurück. Gespeicherte Vorlieben ändern sich nicht; ein früher bis 8rem gespeicherter Key bleibt gültig.
- **Tooltip bei gekürztem Key:** Schneidet eine schmal gezogene Spalte einen Key ab (`isKeyCut` mit der gezeigten Breite, in „Aufgaben“ samt Punkt), nennt die Zelle ihn ganz im `title`; sonst trägt sie keinen. In „Übergeordnet“ steht dann der Key vor dem Titel des übergeordneten Tickets („ABCDEF-1000000 · Dach decken“), sonst wie bisher nur der Titel. Die Key-Links von „Offene Tickets“ nennen immer „KEY · Titel“ (vorher nur den Titel), weil dort mehrere Keys in einer Zelle stehen und ein einzelner gekürzter Link sonst nicht lesbar wäre.
- **Listen mit Keys außerhalb der Tabellen:**
  - Offene Tickets eines Projekts (vorher fest 5,5rem mit „…“) und die Ansicht „Erledigte“ (ER-1, ebenso): Der Key ist so breit wie der längste gezeigte Key in ch (`--key-chars`, mindestens 5,5rem), alle Listen bzw. Gruppen gleich, damit die Keys bündig stehen; abgeschnitten wird nicht mehr, ein `title` ist deshalb nicht nötig.
  - Woche im Kalender: Der Key steht über dem Titel in der Breite des Tages; ein langer Key bricht in einem schmalen Tag um (`overflow-wrap: anywhere`), statt in den Nachbartag zu laufen.
  - Ohne feste Breite und unverändert: `TicketPicker`, Tagesplan (Liste, Pool, Vorschläge), Quellen und Folge-Tickets, Unteraufgaben, Panel, Verlauf (bricht um), Chip „→ HAUS-12“ im Eingang (15rem, mit `title`), Monat und Agenda des Kalenders.

### Alternativen

- **Standard immer 12rem:** verschenkt in jeder Liste mit kurzen Keys 6rem und verschiebt alle Schwellen. Verworfen.
- **Standard auch schmaler als 6rem:** spart bei „TASK-1“ wenig und ändert die gewohnte Ansicht und die Schwellen je nach Liste. Verworfen.
- **Messen der Zellen per Canvas oder `scrollWidth`:** Bei einer Monospace-Schrift ist die Länge in ch genau; Messen kostete je Zeile Layout-Arbeit. Verworfen; der Doppelklick auf den Griff misst weiter wie in §3.
- **`title` an jedem Key:** wäre ein Tooltip auf jeder Zeile ohne Nutzen. Verworfen; wie beim Titel (§6) nur, wo gekürzt wird.

### Konsequenzen

- Keine Migration, kein Hook; Nummernvergabe und Key-Format unverändert.
- Tests: `columns.test.ts` (Breite, Grenzen, Standard aus den Keys, Vorrang), `column-order.test.ts` (9, 10, 999, 1000, 10000, 1000000), `ticket-table-columns.test.ts`, `ticket-table-row.test.ts`, `trash-view.test.ts`, `recurrences-view.test.ts`, `recurrence-table.test.ts`, `project-ticket-list.test.ts`, `done-view.test.ts`, `calendar-view.test.ts`; gegen eine eigene Wegwerf-Instanz `tests/integration/ticket-keys-large.test.mjs` (Zähler 999, 9999 und 999999, Projektwechsel, Verschieben zwischen Bereichen) und statisch `tests/unit/ticket-key-digits.test.mjs` (keine Key-Regex mit begrenzter Ziffernzahl in Hooks, Migrationen und Web); Manifest BYL-E6-1600 bis BYL-E6-1606.
