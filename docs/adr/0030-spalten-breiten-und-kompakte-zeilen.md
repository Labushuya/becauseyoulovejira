# ADR-0030: Spaltenbreiten, Ein- und Ausblenden und kompakte Zeilen in Tabellen

- **Status:** Angenommen und umgesetzt in den Paketen SP-1 bis SP-5 nach [docs/plan/e6-spalten.md](../plan/e6-spalten.md) (#98 bis #101 und der PR von SP-5); manuelle Browser-Prüfungen stehen im Test-Manifest
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
