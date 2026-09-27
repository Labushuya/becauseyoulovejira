# E6-Plan, Teil Editor: Unterstreichen, Checklisten und ein Editor wie Jira

- **Stand:** RT-0 abgeschlossen (2026-09-28, Weg B). Stufe A (RT-1, RT-2) in Arbeit, Stufe B (RT-3 bis RT-6) offen.
- **Grundlage:**
  - [ADR-0032](../adr/0032-editor-tiptap-markdown.md) (Tiptap, Markdown als Speicherformat, Brücke über die markdown-it-Instanz der Anzeige, Spike RT-0)
  - [ADR-0008](../adr/0008-markdown-rendering-und-sanitizing.md), [ADR-0006](../adr/0006-frontend-zustand-und-datenzugriff.md) §5, [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0029](../adr/0029-glas-materialien.md), [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md), [ADR-0031](../adr/0031-herkunft-sichern.md)
  - [CLAUDE.md](../../CLAUDE.md) §3, §7, §8, §11, §12
- **Einordnung:** Nutzerentscheidungen vom 2026-09-28: Tiptap ist freigegeben, mit RT-0 als Abbruchpunkt. Markdown bleibt das Speicherformat, mit `++Text++` und GFM-Task-Listen. Der Umfang soll wie in Jira sein. Die Reihenfolge ist Spalten → Herkunft → Editor Stufe A → Unterprojekte → Editor Stufe B. Die Manifest-IDs laufen ab `BYL-E6-200` (Herkunft belegt 160 bis 190).
- **Stufen:**
  - **Stufe A** = RT-1 und RT-2: Unterstreichen und Checklisten in Anzeige und Speicherformat, abhakbar in der Ansicht, Schutz vor stillem Überschreiben. Das braucht noch keine Editor-Bibliothek; getippt wird in der `textarea`.
  - **Stufe B** = RT-3 bis RT-6: der Editor selbst mit Toolbar, Kürzeln, „/“-Menü, Einfügen aus Word, Kommentaren und Formularen.
  - RT-7 (Tabellen) ist optional.

## 1. Querschnittsregeln

- Keine Migration. Stufe A ändert nur die Anzeige, einen Hook und die SPA. Hooks wirken in der laufenden Instanz des Nutzers sofort; ein Hook-Paket wird deshalb nur fertig getestet committet und nie als Experiment im Arbeitsordner liegen gelassen.
- Keine neuen Farb- oder Maß-Tokens.
  - Schriftgrößen nur über `--font-size-*`, Radien nur über `--radius-*`.
  - Dateien, die ein Paket ohnehin ändert, ziehen von den Ausnahmelisten von `no-own-font-sizes.test.ts` und `no-own-radii.test.ts` auf die Tokens; die Listen schrumpfen nur.
- Neue Abhängigkeiten nur wie in ADR-0032: `markdown-it-ins` (RT-1), Tiptap, ProseMirror und `prosemirror-markdown` (RT-3). Jede mit MIT-Lizenz, lokal gebündelt, `npm audit` im PR.
- Die Rundreise Editor ↔ Markdown hat einen Paritätstest mit dem Korpus `web/src/lib/test/markdown-corpus/*.md` (erfundene Daten). Er ist ab RT-3 Pflicht-Gate.
- Was jsdom nicht kann (Layout, IME, echtes Einfügen aus Word, NVDA), steht als manueller Fall im Test-Manifest.
- **Gates je Paket:**
  - eigener Branch und PR
  - `scripts\build.ps1` lokal komplett grün (Exit-Code 0 und „Build complete!“)
  - CI grün, höchstens drei Versuche; ein roter PR hält die folgenden auf
  - Squash-Merge, Test-Manifest nachgezogen, Entscheidungen in §4

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| RT-0 | Spike: Tiptap gegen den Korpus (Parität, HTML als Text, `breaks`, Normalisierung), jsdom, Größe des Chunks; Entscheidung zwischen `@tiptap/markdown` und der Brücke über `prosemirror-markdown`; ADR-0032, dieser Plan, Manifest-Einträge als „geplant“ | – |
| RT-1 | Anzeige: `++u++` → `<u>` (`markdown-it-ins`), Task-Listen per eigenem Plugin, Sanitizer-Erweiterung mit Hook, Korpus; XSS-Tests; CLAUDE.md §3 und §7; Hilfeseite | BYL-E6-200, BYL-E6-201 (manuell) |
| RT-2 | Checklisten in der Ansicht abhakbar: `toggleTask`, `Markdown.svelte` mit `ontoggletask`, Store, Hook `expected_updated` mit `validation_description_stale`, Konfliktfrage beim Speichern der Beschreibung, Kommentare nur für den Autor | BYL-E6-202 bis BYL-E6-204, BYL-E6-205 (manuell) |
| RT-3 | `RichTextEditor` für die Beschreibung (Panel und Vollansicht): Extensions, Brücke, Toolbar, Kürzel, Eingaberegeln, Quelltextmodus, `richEditable`, dynamisches Laden mit Rückfall auf die `textarea`, `prose.css` | ab BYL-E6-206 |
| RT-4 | „/“-Menü und Link-Popover | |
| RT-5 | Einfügen aus Word und HTML (`paste.ts` mit Fixtures) | |
| RT-6 | Kommentare (kompakt), `NewTicketForm`, `RecurrencePanel`; Kürzel in `shortcuts.ts`, Hilfeseite, README | |
| RT-7 (optional) | Tabellen bearbeiten (`@tiptap/extension-table`, MIT) statt Quelltextmodus | |

## 3. Konzept (Kurzfassung für Stufe B)

### 3.1 Speicherformat und Brücke

Siehe ADR-0032 §1 und §2. Der Serializer normalisiert beim ersten Speichern aus dem Editor. Deshalb setzt der Editor den Entwurf nur bei einer echten Änderung (`update`-Ereignis); ein ungeändertes Speichern schreibt nichts, wie heute.

**Nicht abbildbar** (`richEditable`, Quelltextmodus mit `SectionMessage` info „Diese Beschreibung enthält Elemente, die nur als Markdown bearbeitet werden können.“):

- Tabellen
- gemischte Listen aus Aufgaben und normalen Punkten; eine Leerzeile zwischen zwei Aufzählungen mit demselben Zeichen macht nach CommonMark **eine** lockere Liste
- alles, wofür die Brücke kein Token kennt

### 3.2 Funktionsumfang

- **Toolbar**:
  - `role="toolbar"`, `aria-label="Formatierung"`, Roving-Tabindex, Pfeiltasten; **Alt+F10** springt aus dem Text in die Toolbar, Esc zurück.
  - Inhalt:
    - Textstil-Menü (Normal, Überschrift 1 bis 3; `Popover` `menu` mit `menuitemradio`)
    - Fett, Kursiv, Unterstrichen, Durchgestrichen, je mit `aria-pressed`
    - „Mehr“ mit Inline-Code und „Formatierung entfernen“
    - Aufzählung, Nummerierte Liste, Checkliste
    - Link, Zitat, Codeblock, Trennlinie
    - rechts „Markdown“ (Quelltextmodus, `aria-pressed`)
  - Im 480-px-Panel landen die hinteren Gruppen in einem „…“-Menü. Knöpfe sind `.button-icon` mit `aria-label` und `title` samt Kürzel.
- **Tastenkürzel** (eine Quelle `domain/shortcuts.ts`, Abschnitt „Editor“, damit Hilfeseite, Modal und `aria-keyshortcuts` gleich bleiben):

  | Kürzel | Funktion |
  |---|---|
  | Strg+B / I / U | fett, kursiv, unterstrichen |
  | Strg+Shift+S | durchgestrichen |
  | Strg+E | Inline-Code |
  | Strg+Alt+1 bis 3 | Überschriften |
  | Strg+Shift+7 / 8 / 9 | nummeriert / Aufzählung / Checkliste |
  | Strg+Shift+B | Zitat (Chrome belegt die Kombination; im Editor mit `preventDefault` prüfen, Ersatz `> `) |
  | Strg+Alt+C | Codeblock |
  | Strg+K | Link-Dialog (global greift Strg+K im Editor nicht, `isTypingTarget`) |
  | Tab / Shift+Tab | Einrücken in Listen; außerhalb von Listen verlässt Tab den Editor (keine Tastaturfalle) |
  | Strg+Enter | Speichern bzw. Senden |
  | Strg+Shift+V | als reinen Text einfügen |

- **Eingaberegeln:** `# `, `## `, `### `, `- `/`* `, `1. `, `[ ] `/`[x] `, `> `, ```` ``` ````, `---`, `**x**`, `*x*`, `~~x~~`, `` `x` ``, `++x++`.
- **„/“-Menü** (`@tiptap/suggestion`, MIT):
  - Einträge: Überschrift 1 bis 3, Aufzählung, Nummerierte Liste, Checkliste, Zitat, Codeblock, Trennlinie, Link. Die Eingabe filtert.
  - Die Liste ist ein `popover="manual"` im Top-Layer, positioniert per `place()` an `view.coordsAtPos` wie die Vorschlagsliste des `TagPicker`, bevorzugt als gemeinsamer Listen-Baustein. Material thick.
  - ARIA: `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`. Enter wählt; Esc schließt und verbraucht Esc (Escape-Kette).
- **Link-Dialog:** `Popover` `panel` mit „Adresse“ und „Text“, nur http, https und mailto, Fehler inline, „Link entfernen“ als `.button-icon`. Link-Extension mit `openOnClick: false`, `autolink`, `isAllowedUri`.
- **Einfügen aus Word und HTML:** `transformPastedHTML` rein und getestet (Conditional Comments, `<o:p>`, `<style>`, `<meta>`, `mso-*`, Klassen weg; Word-Listen mit `mso-list` → `ul`/`ol`; Fixtures aus Word 365, Google Docs, LibreOffice). Den Rest verwirft das Schema. `text/plain` mit Markdown wird als Markdown eingefügt.
- **Kommentare:** derselbe Editor, kompakt (ohne Textstil-Menü), Strg+Enter sendet, Grenze 20 000. `NewTicketForm` und `RecurrencePanel` nutzen den Editor; `InboxPanel` bleibt `textarea` (Rohtext aus Kanälen).
- **Quelltextmodus:** der bisherige `MarkdownEditor` als Umschalter „Markdown“, auch Rückfall, wenn das Laden des Chunks scheitert.

### 3.3 Theming und Offline

- Die Bearbeitungsfläche ist undurchsichtig (`--color-surface`, Rand wie die `textarea`, `--radius-control`); Formulare bleiben nach ADR-0029 ohne Glas, die Toolbar ohne `backdrop-filter`. Glas nur für Popover über die vorhandenen Bausteine.
- Farben nur über Tokens:
  - Platzhalter `--color-text-muted`
  - Code wie in `Markdown.svelte`
  - Links `--color-brand-text`
  - aktive Knöpfe `--color-brand-soft-bg` / `--color-brand-soft-text`
  - Fokusring `2px solid var(--color-brand-text)`
- Anzeige und Editor teilen `lib/styles/prose.css`, damit „Bearbeiten“ nicht springt.
- Checkboxen stylt allein `base.css`.
- `forced-colors`: Zustände der Toolbar zusätzlich über Rahmen.
- `prefers-reduced-motion`: keine Animation der Popover.
- Offline: eigener Chunk per `import()`, kein CDN.
- Android/Gboard ist ein manueller Prüffall (IME, Composition).

### 3.4 Architektur

| Ort | Inhalt |
|---|---|
| `web/src/lib/markdown.ts` | markdown-it plus `markdown-it-ins` plus Task-Plugin; DOMPurify mit Hook; `toggleTask` (RT-1, RT-2) |
| `web/src/lib/editor/` | `create-editor.ts` (Extensions, Kürzel, Link-Protokolle), `markdown-bridge.ts` (Brücke nach ADR-0032 §2), `paste.ts`, `rich-editable.ts`, `slash-items.ts` (RT-3 bis RT-5); nur per `import()` geladen, statisch geprüft |
| `web/src/lib/components/RichTextEditor.svelte` | Editor in `$effect` erzeugt, im Cleanup `destroy()`; Zustand der Toolbar per `onTransaction` in `$state`; Props wie `MarkdownEditor`; `role="textbox"`, `aria-multiline`, `aria-labelledby` |
| `EditorToolbar.svelte`, `SlashMenu.svelte`, `LinkPopover.svelte` | UI auf den vorhandenen Overlay-Bausteinen |
| `TicketDetailStore` | `toggleTask`, `expected_updated`, Konfliktfrage (RT-2) |
| `app/pb_hooks/lib/ticket-service.js` | Prüfung `expected_updated` (RT-2) |

### 3.5 Akzeptanzkriterien (Stufe B)

1. Formatieren per Toolbar, Kürzel, Markdown-Kürzel und „/“: fett, kursiv, unterstrichen, durchgestrichen, Überschrift 1 bis 3, Aufzählung, nummeriert, Checkliste, Zitat, Inline-Code, Codeblock, Link, Trennlinie.
2. Gespeichert wird Markdown. Ein unverändertes Öffnen und Speichern ändert den Text nicht (Byte für Byte). Nach einem Speichern zeigt die Anzeige genau das, was der Editor zeigte.
3. Nicht abbildbare Inhalte öffnen im Quelltextmodus mit Hinweis, ohne Datenverlust.
4. Einfügen aus Word erhält Absätze, Überschriften, fett, kursiv, unterstrichen, Listen und Links und verwirft Farben, Schriften und Bilder. Kein Einfügen erzeugt ein Skript, einen Event-Handler oder eine externe Anfrage.
5. Toolbar, „/“-Menü und Link-Dialog sind vollständig per Tastatur bedienbar (Alt+F10, Pfeiltasten, Esc-Kette), ohne Tastaturfalle, mit korrekten Rollen und Zuständen.
6. Hell/dunkel und alle Akzente ohne neue Tokens. Keine externe Anfrage. Der Editor-Chunk wird erst beim ersten Bearbeiten geladen.
7. Kommentare nutzen denselben Editor. Strg+Enter sendet.

### 3.6 Tests (mit den Grenzen von jsdom)

- **jsdom kann nicht:** Layout (`getClientRects`, `getBoundingClientRect` von `Range`, `elementFromPoint`), also keine Position des „/“-Menüs; kein verlässliches `fireEvent.input`; keine IME. `ClipboardEvent` fehlt.
- **Umgang:**
  - Attrappen in `lib/test/prosemirror-stubs.ts`.
  - Tippen über `view.someProp('handleTextInput', …)`, damit Eingaberegeln greifen (im Spike belegt).
  - Kürzel als `KeyboardEvent` auf `view.dom`.
  - Einfügen über `view.pasteHTML(html, event)` bzw. `view.pasteText`.
- **Parität (Kern-Gate):**
  - Für jede Korpusdatei, die `richEditable` annimmt, gilt `renderMarkdown(serialize(parse(md)))` ≡ `renderMarkdown(md)`. Normalisiert werden Leerraum zwischen Tags und die Reihenfolge direkt verschachtelter Marken.
  - Die Rundreise ist idempotent. Wörtliches HTML bleibt Text.
  - Nicht abbildbare Dateien lehnt `richEditable` ab.
- **Statisch:** Der `{@html}`-Test bleibt (nur `Markdown.svelte`); `glass-allowlist.test.ts`; `no-own-controls.test.ts`; `lib/editor/**` nur per `import()`.
- **Manuell:** Tippen und IME in Chrome, Firefox und Opera GX; Android/Gboard; Einfügen aus echtem Word; NVDA mit Toolbar und „/“-Menü; Strg+Shift+B in Chrome.

## 4. Entscheidungen

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-28 | RT-0 | **Weg B statt `@tiptap/markdown`:** Der offizielle Markdown-Teil liest HTML im Text als HTML (`<b>` wird fett, `<script>` samt Text entfernt), streicht `~x~` durch, kennt bei `++` keine Regeln für Begrenzer und keine Maskierung, verliert die Dichte von Listen und ist nicht idempotent. Die Brücke über `prosemirror-markdown` auf der markdown-it-Instanz der Anzeige besteht die Parität für alle abbildbaren Texte des Korpus und ist mit 123 KB gz kleiner (ADR-0032, Spike). |
| 2026-09-28 | RT-0 | **Keine nummerierten Aufgaben:** `1. [ ]` bleibt Text in Anzeige und Editor, weil Tiptap nur Aufgaben in Aufzählungen kennt. Eine Anzeige, die mehr kann als der Editor, würde beim Bearbeiten Checkboxen verlieren. |
| 2026-09-28 | RT-0 | **Gemischte Listen sind nicht abbildbar** (Quelltextmodus). Eine Liste aus Aufgaben und normalen Punkten gibt es im Tiptap-Schema nicht; sie in zwei Listen zu teilen, änderte die Anzeige. Eine Erweiterung (`bulletList` mit `taskItem`) ist eine Option für RT-3. |
| 2026-09-28 | RT-0 | **Spike-Code bleibt draußen:** Die Brücke entsteht mit RT-3 in TypeScript mit Tests; der Korpus kommt mit RT-1 und seinem ersten Test ins Repo. Im Repo gäbe es sonst Code ohne Nutzer. |
| 2026-09-28 | RT-0 | **Stufe A laut Konzept:** RT-1 (Anzeige) und RT-2 (Abhaken mit Schutz vor Überschreiben). Toolbar und Formate im Editor gehören zu RT-3 und damit zu Stufe B. |

## 5. Status

| Paket | Stand |
|---|---|
| RT-0 | abgeschlossen (dieser PR) |
| RT-1 | offen |
| RT-2 | offen |
| RT-3 bis RT-7 | Stufe B, nach Freigabe |

## 6. Offene Punkte

- Manuelle Browser-Prüfungen der Pakete.
- **Hinweise für Stufe B:**
  - `prosemirror-markdown` 1.13.8 verlangt `markdown-it` ^14; per `overrides` auf die Version der Anzeige heben, sonst liegen zwei Parser im Bundle.
  - Die Brücke braucht für `bulletList`, `orderedList` und `taskList` Attribute ohne Darstellung (`tight`, Aufzählungszeichen, Trennzeichen). Sonst ändern sich lockere Listen und zwei aufeinanderfolgende Listen verschmelzen.
  - Den harten Umbruch als `\n` schreiben (nicht `\\\n`) und den Text danach wie einen Zeilenanfang maskieren; `=`-Zeilen (Setext) und Tabellen-Trennzeilen am Zeilenanfang zusätzlich maskieren.
  - Tests brauchen eine Attrappe für `ClipboardEvent`.
