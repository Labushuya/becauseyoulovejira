# ADR-0025: UI-Konsistenz – ein Overlay-System, Theme-Umschalter und angeglichene Projekt-UI

- **Status:** Angenommen
- **Datum:** 2026-09-25
- **Entscheidung durch:** Nutzer (Fragen 1 bis 4 in Abschnitt 9, 2026-09-25), Advisor (übrige Festlegungen)
- **Ersetzt teilweise:** [ADR-0010](0010-layout-nach-task-board.md) §1 (Reihenfolge der Leisten, 5 s „Rückgängig“ in der Zeile) und §2 (Aufbau des Detail-Panels, Vollansicht)
- **Zieht vor aus E6** ([ADR-0011](0011-roadmap-e3-bis-e7.md) §1): Vollansicht, Theme-Umschalter, Unterbau des Popovers „Spalten“
- **Plan:** [docs/plan/e6-ui.md](../plan/e6-ui.md) (Pakete UI-0 bis UI-9, Inventar, Risiken)

## Kontext

Der Nutzer bemängelt die vielen Mechanismen für Popover, Dialoge, Modals und Panels. Er wünscht sich ein Verhalten wie in Jira, den Aufbau seines Task-Boards, eine angeglichene Projekt-UI und einen Hell-/Dunkel-Umschalter.

Das Inventar (Stand `9e99d4f`, Einzelheiten im [Plan](../plan/e6-ui.md) §1) zählt **sieben** Muster für Überlagerungen und Rückfragen und **drei** für Rückmeldungen, ohne gemeinsamen Baustein:

- acht native `<dialog>` in fünf Breiten (28 bis 44 rem), mit achtmal kopiertem, **hell** tönendem `::backdrop`, ohne ×, ohne Schließen per Klick daneben, mit zwei Verfahren zur Fokus-Rückgabe und nur teilweise gestopptem Escape
- ein `popover` mit CSS Anchor Positioning. Ohne Anchor-Support steht es mitten im Fenster.
- ein eigenes, absolut positioniertes Vorschlagsfeld (`TagPicker`)
- vier Seitenpanels, in denen das ganze Panel scrollt und Kopf und Fuß nicht stehen bleiben
- viermal `window.confirm`, einmal eine Inline-Bestätigung im Dialog, zweimal „Rückgängig“ für 5 s in der Tabellenzeile
- Erfolgsmeldungen nur für Screenreader, Fehlerleisten über den Tabellen, Ergebnisse im Dialog
- ein FOUC-Skript in `app.html` mit dem Schlüssel `td-theme`, das niemand schreibt, mit leerem Zweig und ohne `try/catch`
- den Umschalter „Aufgaben | Projekte | Eingang“, der beim Ansichtswechsel senkrecht springt, und sechs Radien ohne Token

Grenzen: Clean-Room nach [ADR-0010](0010-layout-nach-task-board.md) §4. Aus dem Task-Board und vom Atlassian Design System (ADS) werden nur Muster, Maße und Abläufe übernommen, kein Code, kein CSS, keine Texte, keine Assets. Farben nur aus `tokens.css`, Rot nur für echte Fehler ([ADR-0009](0009-fehlerfarbe.md)).

## Entscheidung

### 1. Grundsätze

1. **Genau sechs Bausteine:** Modal, Bestätigung (Variante des Modals), Popover, Seitenpanel, Vollansicht, Flag. `window.confirm`, eigene Dropdowns, SR-only-Erfolgsmeldungen und das Zeilen-Undo entfallen.
2. **Plattform zuerst:** `<dialog>.showModal()` für Top-Layer, `inert` und Fokusfalle; `popover` für Top-Layer und Light-Dismiss. Keine neue Abhängigkeit, keine UI-Bibliothek.
3. **Verhalten wie Jira, Aufbau wie das Task-Board, Aussehen nach CLAUDE.md §8 und ADR-0010 §3:** Linien statt Schatten, keine Glas-Optik, Petrol als einzige Akzentfarbe. Destruktive Knöpfe bleiben **nicht** rot; das weicht bewusst vom ADS-Stil „danger“ ab.
4. **Ort:** Komponenten in `web/src/lib/components/overlay/`, reine Logik (Positionierung, Schließ-Regeln, Fokus-Helfer) in `web/src/lib/overlay/`, alles in Svelte 5 Runes.
5. **Escape-Kette:** Das innerste Overlay gewinnt: Popover → Bestätigung → Modal → Vollansicht → Feld im Bearbeitungsmodus → Seitenpanel. Wer ein Escape verbraucht, ruft `preventDefault()` und `stopPropagation()` auf; äußere Bausteine ignorieren ein Ereignis mit `defaultPrevented`.

### 2. Tokens

- **Farbe** (alle vier Blöcke von `tokens.css`): `--color-blanket` hell `rgb(23 35 38 / 0.45)` (Textton), dunkel `rgb(0 0 0 / 0.6)`. Der Schleier hinter Modal und Vollansicht dunkelt ab wie in Jira und im Task-Board, statt wie bisher mit `--color-bg` aufzuhellen.
- **Kein Schatten-Token:** Overlays trennen sich über eine 1-px-Linie `--color-line` und die Fläche `--color-surface`.
- **Nicht farbige Tokens** (nur in `:root`, wie die Schriften):

| Token | Wert | Zweck |
|---|---|---|
| `--overlay-width-s` | 25rem (400 px) | Bestätigung, kleine Formulare |
| `--overlay-width-m` | 37.5rem (600 px) | Standarddialoge |
| `--overlay-width-l` | 50rem (800 px) | Auswahlansichten (Dateien, WhatsApp, Postfach) |
| `--overlay-width-xl` | 62.5rem (1000 px) | Vollansicht |
| `--overlay-max-height` | `calc(100dvh - 2rem)` | Höhe der Modals (XL: `92dvh`) |
| `--drawer-width` | 30rem (480 px) | Seitenpanel |
| `--full-view-sidebar` | 21.25rem (340 px) | rechte Spalte der Vollansicht |
| `--radius-control` | 0.375rem | Knöpfe, Felder, Chips, Einträge |
| `--radius-surface` | 0.5rem | Karten, Kacheln, Panels, Dialoge, Popover, Flags |
| `--motion-fast` | 120ms | Popover, Flag |
| `--motion-medium` | 200ms | Modal, Seitenpanel |
| `--motion-ease` | `cubic-bezier(0.2, 0, 0, 1)` | alle Übergänge |

- **`color-scheme`** in allen vier Blöcken (`light` bzw. `dark`), damit Scrollbalken, `<select>`, Datumsfelder, Checkboxen und `<dialog>` dem gewählten Modus folgen.
- **`base.css`:** `prefers-reduced-motion: reduce` schaltet die Animationen der Overlays ab. Scroll-Sperre per CSS: `html { scrollbar-gutter: stable }` und `html:has(dialog:modal) { overflow: hidden }`. Gemeinsame Knopfklassen `.button-secondary`, `.button-subtle` und `.button-icon` (mit Pflicht-`aria-label`) ersetzen die 15 lokalen `.secondary`.

### 3. Modal (`overlay/Modal.svelte`)

- **Größen** `s`, `m`, `l`, `xl` über die Tokens. Breite `min(var(--overlay-width-*), 100vw - 2rem)`, Höhe höchstens `--overlay-max-height`; unter 48rem füllt XL die Fläche.
- **Aufbau:** Kopf (stehend) mit Titel `h2` und rechts optionalen Aktionen und dem Pflicht-× „Schließen“; Inhalt scrollt als einziges Element; Fuß (stehend) rechtsbündig, sekundär links von primär. Beschriftung: „Abbrechen“, solange nichts gespeichert ist, „Schließen“, wenn der Dialog Ergebnisse schon gespeichert hat.
- **Schließen:** × , „Abbrechen“, Esc und Klick aufs Blanket schließen. Bei `dirty` ersetzt eine Verwerfen-Frage den Fuß („Weiter bearbeiten“ mit Fokus, „Verwerfen“); ein Klick aufs Blanket wird dann ignoriert. Bei `busy` ist jeder Weg gesperrt.
- **Blanket-Klick** zählt nur, wenn `pointerdown` **und** `click` direkt auf dem `<dialog>` landen (Markieren und außerhalb Loslassen schließt nicht).
- **Esc** fängt der Dialog selbst auf `keydown` ab; `cancel` ist nur Rückfall, `close` gleicht den Zustand ab. Grund: Chromium lässt `cancel` ohne neue Nutzeraktivierung nicht verhindern (CloseWatcher), ein zweites Esc würde sonst trotz `busy` schließen.
- **Fokus:** beim Öffnen auf `initialFocus` bzw. das erste interaktive Element im Inhalt, nicht auf das ×; beim Schließen zurück zum gemerkten Element, falls es noch im DOM ist. Die Fokus-Rückgabe liegt **einheitlich im Baustein**.
- **Stapel:** höchstens ein Modal; nach ADS kein Dialog aus einem Dialog. Die Vollansicht zählt als Modal.
- **Animation** nur beim Öffnen (Deckkraft, `translateY(0.5rem)` → 0, `--motion-medium`), kein Exit-Übergang.
- **Barrierefreiheit:** natives `<dialog>`, `aria-labelledby` auf den Titel, optional `aria-describedby`, `aria-busy` bei `busy`, Fehler als `.alert-error role="alert"`.

### 4. Bestätigung (`overlay/ConfirmDialog.svelte`)

- Modal der Größe S, Titel als Frage („Ticket BYL-12 löschen?“), Fuß mit „Abbrechen“ und einem **Verb** („Löschen“, „Verwerfen“). Der erste Fokus liegt auf „Abbrechen“.
- Esc, × und Blanket bedeuten „Abbrechen“; bei `busy` „Wird ausgeführt …“ und alle Wege gesperrt. Keine rote Farbe.
- **Navigation mit ungespeicherten Eingaben:** `beforeNavigate` kann nicht auf einen Dialog warten. Der Handler bricht ab (`navigation.cancel()`), öffnet die Bestätigung und führt nach „Verwerfen“ `goto(navigation.to.url)` mit gesetztem Verwerfen-Kennzeichen aus. Zurück und Vor im Browser verhalten sich gleich. Das Schließen des Tabs deckt weiter nur `beforeunload` ab.
- In einem Modal wird keine Bestätigung gestapelt; dort gilt die Inline-Frage aus Abschnitt 3.
- Nach UI-3 steht kein `window.confirm` mehr im Code; ein statischer Test prüft das.

### 5. Popover (`overlay/Popover.svelte`, `overlay/position.ts`)

- **Zwei Arten auf einem Unterbau:** `menu` (`role="menu"`, `menuitem`/`menuitemradio`, eine Auswahl schließt; Theme-Umschalter, später Aktionsmenüs) und `panel` (`role="dialog"` mit Namen, nicht modal, `fieldset` mit Radios bzw. Checkboxen; Gruppieren, Spalten, Filter „Projekt“ und „Tag“).
- **Unterbau:** `popover="auto"` für Top-Layer, Light-Dismiss und „nur eines zugleich“. **Positionierung per JS statt CSS Anchor**, damit Chrome, Opera GX und Firefox gleich aussehen: reine Funktion `place(anchor, size, viewport, placement)` mit 4 px Abstand, Flip nach oben, Klemmen mit 8 px Rand; Aufruf beim Öffnen und bei `resize`/`scroll`, solange offen.
- **Tastatur:** Beim Öffnen geht der Fokus auf den gewählten bzw. ersten Eintrag. `menu`: ↑/↓ mit Umlauf, Home/End, Enter und Leertaste lösen aus und schließen, Tab schließt und geht weiter, Esc schließt mit Fokus auf den Knopf. `panel`: Tab innerhalb, Esc schließt mit Fokus auf den Knopf. Verlässt der Fokus das Popover, schließt es.
- **Barrierefreiheit:** Der Knopf trägt `aria-haspopup`, `aria-expanded` (ausdrücklich über das `toggle`-Ereignis gesetzt) und `aria-controls`; das Panel hat einen Namen. Gewählt ist Häkchen plus Schriftgewicht, nie nur Farbe.
- Der `TagPicker` bleibt eine APG-Combobox, seine Liste wandert in den Top-Layer (`popover="manual"`). Native `<select>` in Formularen bleiben.

### 6. Seitenpanel (`overlay/Drawer.svelte`)

- **Nicht modal** rechts neben der Liste, ohne Blanket (Nutzerentscheidung 1). Die Liste bleibt bedienbar, ein Klick auf eine andere Zeile wechselt den Inhalt.
- **Aufbau wie im Task-Board:** 480 px (`--drawer-width`), fester Kopf (Kontext links; rechts Aktionen, der Link „Vollansicht“ mit `aria-label="Vollansicht öffnen"` und das × „Panel schließen“), scrollender Inhalt mit Titel `h2` als Fokusziel, optional fester Fuß. Slide-in von rechts nur beim ersten Öffnen, nicht beim Wechsel und nicht bei reduzierter Bewegung.
- **Schmal (unter 48rem)** deckt es die Liste ab; die Liste ist dann `inert`.
- **Eine Esc-Regel für alle Panels:** × und Esc führen zur Liste mit der aktuellen Query. Esc wirkt, wenn der Fokus im Panel liegt und kein Feld gerade bearbeitet wird. Bei `dirty` kommt die Bestätigung aus Abschnitt 4.
- **Fokus:** beim Öffnen und Wechseln auf den Titel, beim Schließen auf die Zeile des Eintrags, sonst auf die Überschrift der Ansicht.
- **Präzisiert durch Abschnitt 11** (Paket UI-6b): Breakpoints 64rem und 36rem statt 48rem, eingebettete volle Spalte, Overlay mit Schleier und Tabellen ohne seitliches Scrollen.

### 7. Vollansicht (`overlay/FullView.svelte`, Routen `…/[id]/voll`)

- **XL-Modal mit eigener Adresse** `/tickets/<id>/voll` (Nutzerentscheidung 2): 1000 px breit, 92 vh hoch, über dem Panel; Neuladen und Mittelklick öffnen sie direkt.
- **Aufbau:** Kopf mit Quell-Icon, Key, Titel, Aktionen, ×; Inhalt zweispaltig (links Titel, Beschreibung, Kommentare und Verlauf; rechts 340 px mit Karten „Details“, „Wiederholung“, „Quelle“, „Metadaten“), unter 64rem einspaltig. Kein Fuß „Speichern & Schließen“, weil jedes Feld sofort speichert.
- `TicketPanel` wird in Teile zerlegt, die Panel und Vollansicht nur anders zusammensetzen.
- ×, Esc und Blanket (ohne `dirty`) führen zurück zu `/tickets/<id>`; der Fokus geht auf „Vollansicht“.
- Eine Vollansicht für Eingangseinträge ist optional, für Projekte gibt es keine.

### 8. Flags (`overlay/FlagGroup.svelte`, `stores/flags.svelte.ts`)

- **Unten links**, über dem Inhalt, neuestes oben, höchstens drei sichtbar. Store per Kontext im `(app)`-Layout ([ADR-0006](0006-frontend-zustand-und-datenzugriff.md)); `show({ tone, title, description?, action?, duration? })` und `dismiss(id)`.
- `success` und `info` verschwinden nach **8 s**, `error` bleibt bis zum Schließen. Pause bei Zeiger oder Fokus auf dem Flag, bei verborgenem Tab und bei offenem Modal.
- Höchstens **eine** Aktion (etwa „Rückgängig“) und das × „Benachrichtigung schließen“. Linke 3-px-Linie in `--color-brand` bzw. bei Fehlern `--color-danger`, Icon und Text; kein Schatten.
- **Barrierefreiheit:** `section aria-label="Benachrichtigungen"` im DOM nach `main`, zwei dauerhaft vorhandene Live-Regionen (`role="status"` und `role="alert"`), der Fokus wird nie verschoben.
- **„Rückgängig“** für „Erledigt“ und „Verwerfen“ wandert aus der Zeile ins Flag, 8 s, Pause bei Hover und Fokus (Nutzerentscheidung 3). Die Zeile verschwindet sofort; das Rückgängigmachen bleibt zusätzlich auf anderem Weg möglich (wieder öffnen, wiederherstellen).
- **Inline bleiben** Feld-, Formular- und Ladefehler mit Bezug zu einer Stelle (ADR-0009).

### 9. Entscheidungen des Nutzers (2026-09-25)

| Nr. | Frage | Entscheidung |
|---|---|---|
| 1 | Seitenpanel nicht modal oder als Overlay mit Schleier? | **Nicht modal** neben der Liste, im Aufbau wie im Task-Board: 480 px, fester Kopf und Fuß, Slide-in. |
| 2 | Vollansicht als großes Modal oder als eigene Seite? | **XL-Modal** unter `/tickets/<id>/voll`. |
| 3 | „Rückgängig“ ins Flag mit 8 s oder weiter 5 s in der Zeile? | **Flag unten links, 8 s**, pausiert bei Hover und Fokus. |
| 4 | Projekte als Kacheln oder als Tabelle? | **Kacheln bleiben**, dazu ein **Projekt-Panel** statt des Dialogs im gleichen Stil wie die übrigen Panels. |

### 10. Festlegungen des Advisors

- **Vorgezogen aus E6:** Die Pakete laufen unter E6 (Manifest-IDs `BYL-E6-001` ff.), obwohl E5 noch nicht abgeschlossen ist. „Wiederholen…“ (`RecurrenceDialog`) zieht in UI-4 auf das Modal.
- **Theme nur lokal:** Wahl in `localStorage` unter `byl-theme` (`light`, `dark`; „Wie System“ entfernt den Schlüssel), nicht pro Nutzer bis E7. Einmalige Migration von `td-theme`. Das Boot-Skript in `app.html` prüft den Wert, fängt Fehler des Speichers ab und setzt `data-theme` vor dem ersten Rendern. Die Systemeinstellung braucht keinen `matchMedia`-Listener, weil `tokens.css` ihr per Media Query live folgt; ein `storage`-Listener gleicht andere Tabs ab.
- **Umschalter** in der Kopfzeile zwischen „Kanäle“ und der Sitzung: Symbolknopf (Sonne, Mond, Monitor, eigene Inline-SVG) mit `aria-label="Darstellung: …"`, der ein `menu` mit „Hell“, „Dunkel“, „Wie System“ (`menuitemradio`) öffnet.
- **Nicht rot**, **kein Schatten-Token**, native `<select>` in Formularen bleiben, **keine Projekt-Vollansicht**.
- **Projekt-UI:** Die Abschnittsleiste mit „Aufgaben | Projekte | Eingang“ steht in allen Ansichten direkt unter der Kopfzeile; darunter folgen Kennzahlen und Filterleiste (Aufgaben), Chips (Eingang) oder nichts (Projekte). Projekt-Panel unter `/projekte/neu` und `/projekte/<id>`, Löschen über die Bestätigung mit der Zahl der Tickets, ein Kachelklick öffnet das Panel, „Tickets anzeigen“ steht im Panel. Ein gemeinsamer Wrapper ersetzt die kopierten Layout-Grids.

### 11. Nachtrag (2026-09-25, Paket UI-6b): Seitenpanel eingebettet wie in Jira

Präzisiert Abschnitt 6 und Nutzerentscheidung 1, ohne sie aufzuheben. Anlass: Mit UI-6 wirkte das Panel auf üblichen Fensterbreiten (1093 bis 1280 CSS-px, etwa 1366 px bei 125 % oder 1920 px bei 150 % Skalierung) wie ein Overlay. Die Tabellen hatten eine Mindestbreite (60 bzw. 48rem) und scrollten seitlich; ihre rechten Spalten samt Häkchen verschwanden direkt an der Kante des Panels. **Nutzervorgabe:** Das Panel staucht den Hauptinhalt, statt darüber zu liegen, wie in Jira.

| Fensterbreite | Verhalten |
|---|---|
| ab 64rem (1024 px) | **eingebettet:** volle rechte Spalte `--drawer-width` (480 px) neben der **ganzen** Ansicht (Kennzahlen, Filterleiste, Abschnittsleiste, Tabelle), von der Unterkante der Kopfzeile bis zum unteren Fensterrand, mit einer Linie links statt eines umrandeten Kastens. Die Kopfzeile steht ab 64rem fest oben (`sticky`), ihre Höhe steht in `--app-header-height`. Die Ansicht wird schmaler. |
| 36rem bis 64rem | **Overlay** von rechts, 480 px, mit `--color-blanket` dahinter; Ansicht und Kopfzeile sind `inert`, die Seite scrollt nicht. Ein Klick auf den Schleier schließt wie das × (samt Verwerfen-Frage). |
| unter 36rem (576 px) | Overlay in voller Breite. |

- **Tabellen scrollen nie seitlich:** kein `min-width`, keine Scrollfläche. Ihr Rahmen ist ein Container (`container-type: inline-size`); Container-Queries blenden Spalten in fester Reihenfolge aus. Aufgaben: „Erstellt“, dann „Tags“, dann „Projekt“, zuletzt „Fällig“. Eingang: Eingangs- bzw. Bearbeitungsdatum, dann „Quelle“, dann „Art“, zuletzt „Quelldatum“. Key, Priorität, Status, Titel, Häkchen bzw. Auswahl und Aktionen bleiben immer. Ausgeblendete Spalten sind auch für Screenreader weg; ihre Werte stehen im Panel, und die Beschriftung der Tabelle endet dann mit „Weitere Spalten im Panel“. Die Reihenfolge ist die Vorgabe für „automatisch“ im späteren Popover „Spalten“.
- Esc-Regel, Fokusführung, Slide-in und Vollansicht bleiben wie in den Abschnitten 6 und 7.
- **Alternative verworfen:** Eingebettet schon ab 48rem mit seitlich scrollender Tabelle (Stand UI-6). Zwischen 768 und etwa 1100 px blieben der Liste weniger als 500 px, und die Tabelle wirkte überdeckt.

## Alternativen

- **Seitenpanel als Overlay mit Schleier (Task-Board) oder Drawer (ADS):** verdeckt die Liste, ein Zeilenwechsel braucht zwei Klicks; ADS kündigt den Drawer ab. Vom Nutzer verworfen.
- **Vollansicht als eigene Seite:** verliert den Kontext der Liste. Vom Nutzer verworfen.
- **„Rückgängig“ weiter 5 s in der Zeile:** kürzer als das ADS-Minimum für verschwindende Meldungen und ein weiterer Ort für Rückmeldungen. Vom Nutzer verworfen.
- **Projekte als Tabelle:** vom Nutzer verworfen; die Kacheln bleiben wie in ADR-0010.
- **UI-Bibliothek (etwa Bits UI, Melt UI):** neue Abhängigkeit, eigene Optik, Konflikt mit der Runes- und Token-Regel. Verworfen.
- **CSS Anchor Positioning, `closedby`, Exit-Animationen mit `allow-discrete`:** in den Zielbrowsern uneinheitlich. Verworfen zugunsten der JS-Positionierung und des Einblendens ohne Ausblenden.
- **Theme pro Nutzer in PocketBase:** braucht Migration und API-Regel und bringt vor E7 keinen Nutzen. Zurückgestellt.
- **Rote destruktive Knöpfe wie im ADS:** widerspricht ADR-0009. Verworfen.

## Konsequenzen

- ADR-0010 §1 und §2 gelten nur noch, soweit dieses ADR nichts anderes festlegt; ADR-0010 verweist darauf. CLAUDE.md §7 und §8 beschreiben die Overlay-Regeln, die Tokens und den Theme-Umschalter.
- Zehn Pakete (UI-0 bis UI-9), jedes mit eigenem PR und grünen Gates. Bis ein Paket gemergt ist, gilt für seinen Bereich das bisherige Verhalten; die Doku nennt den Stand je Paket.
- Viele Tests prüfen heute genau Fokus und Escape. Sie laufen als Netz unverändert weiter, bis ihr Aufrufer umzieht; Änderungen an Tests werden im PR begründet.
- Das Undo-Fenster der Stores wächst mit UI-5 von 5 auf 8 s; CLAUDE.md §7 und die E2-/E3-Fälle des Manifests ziehen dann nach.
- jsdom kennt weder Layout noch Top-Layer vollständig. Positionierung und Schließ-Regeln sind deshalb reine, per Unit-Test geprüfte Funktionen, gemeinsame Stubs ersetzen die kopierten `showModal`-Attrappen, und Browserverhalten steht als manueller Fall im Manifest.
