# E6-Plan, Teil Editor: Unterstreichen, Checklisten und ein Editor wie Jira

- **Stand:** Stufe A umgesetzt (2026-09-28): RT-0 (#114, Weg B), RT-1 (#115), RT-2 (#116). Stufe B freigegeben und begonnen (Auftrag vom 2026-09-28): RT-3 (#125), RT-4 (#127) und RT-5 umgesetzt, RT-6 folgt. Offen sind außerdem die manuellen Browser-Prüfungen.
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
| RT-1 | Anzeige: `++u++` → `<u>` (`markdown-it-ins`), Task-Listen per eigenem Plugin, Sanitizer-Erweiterung mit Hook, Korpus; XSS-Tests; CLAUDE.md §7; Hilfeseite | BYL-E6-200, BYL-E6-201 (manuell) |
| RT-2 | Checklisten in der Ansicht abhakbar: `toggleTask`, `Markdown.svelte` mit `ontoggletask`, Store, Hook `expected_updated` mit `validation_description_stale`, Konfliktfrage beim Speichern der Beschreibung, Kommentare nur für den Autor | BYL-E6-202 bis BYL-E6-204, BYL-E6-205 (manuell) |
| RT-3 | `RichTextEditor` für die Beschreibung (Panel und Vollansicht): Extensions, Brücke, Toolbar, Kürzel, Eingaberegeln, Quelltextmodus, `richEditable`, dynamisches Laden mit Rückfall auf die `textarea`, `prose.css` | BYL-E6-241, BYL-E6-242 (manuell) |
| RT-4 | „/“-Menü und Link-Popover | BYL-E6-243, BYL-E6-244 (manuell) |
| RT-5 | Einfügen aus Word und HTML (`paste.ts` mit Fixtures) | BYL-E6-245, BYL-E6-246 (manuell) |
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
| 2026-09-28 | RT-1 | **Checkbox im HTML immer deaktiviert:** Die Anzeige und der Hook von DOMPurify geben nur `<input type="checkbox" disabled>` aus. Bedienbar macht sie erst `Markdown.svelte` mit `ontoggletask` (RT-2), im DOM und nicht im HTML. So bleiben Vorschau, Eingang und fremde Kommentare ohne Zutun gesperrt. |
| 2026-09-28 | RT-1 | **Name der Checkbox:** der Text der Aufgabe als `aria-label` (Text, Code und Umbrüche des ersten Absatzes, höchstens 200 Zeichen), sonst „Aufgabe N“. Ein `<label>` um den Inhalt ginge nur mit einem weiteren Tag und verschachtelten Links. |
| 2026-09-28 | RT-1 | **Marker nach GFM:** `[ ]`, `[x]` oder `[X]` am Anfang des ersten Absatzes eines Punkts, danach Leerraum oder das Zeilenende. `- [ ]` allein ist eine leere Aufgabe, `- [ ]**x**`, `- \[ \]` und `- [x](url)` sind keine. Die Regel läuft vor `text_join`, damit maskierte Klammern Text bleiben. |
| 2026-09-28 | RT-1 | **`ADD_URI_SAFE_ATTR`:** DOMPurify prüft die Werte nicht URI-sicherer Attribute gegen `ALLOWED_URI_REGEXP`; ohne die Liste verlören `type`, `aria-label`, `data-task` und `start` ihre Werte. Damit ist der alte Fehler behoben, dass `3. drei` bei 1 begann. |
| 2026-09-28 | RT-1 | **Darstellung:** Die Checkbox steht an der Stelle des Aufzählungszeichens (`li[data-task]` ohne Listenzeichen, nur Abstände; das Aussehen kommt aus `base.css`, `no-own-controls.test.ts`). `Markdown.svelte` und die Hilfeseite ziehen dabei auf die Schriftgrößen-Tokens, soweit es welche gibt (7 Werte, `no-own-font-sizes.test.ts` jetzt 235); Überschrift 1 und 3 bis 6 behalten ihre Zahlen, weil es für 1.25rem und 1rem kein Token gibt. |
| 2026-09-28 | RT-1 | **Typen für `markdown-it-ins`:** Das Paket bringt keine mit; eine kleine Deklaration `web/src/markdown-it-ins.d.ts` genügt. Der Korpus steht in `.prettierignore`, damit Prettier die Texte nicht umschreibt. `npm audit`: `markdown-it-ins` ohne Befund; die drei bekannten niedrigen Befunde (`cookie` über `@sveltejs/kit`) bestehen unabhängig davon. |
| 2026-09-28 | RT-2 | **`toggleTask` mit dem Parser der Anzeige:** Die Aufgabe wird über ihren Index gefunden, ihre Zeile über `map` des ersten Absatzes, und in der Zeile nur das Zeichen hinter den Containern (Einrückung, `>`, Listenzeichen). Danach wird neu geparst und geprüft; passt es nicht, ändert sich nichts. Liegt in `lib/markdown.ts` statt in `domain/`, weil `domain/` keine Pakete importieren darf (`purity.test.ts`). |
| 2026-09-28 | RT-2 | **Bedienbar im DOM, nicht im HTML:** `Markdown.svelte` schaltet die Checkboxen nach jedem Rendern mit `ontoggletask` frei (`$effect`), ein `change`-Handler am Container nimmt sie, gesperrt wird wie beim Häkchen der Zeile mit `aria-disabled` statt `disabled`, damit der Fokus bleibt. Ein gesperrter Klick wird zurückgesetzt. `taskHint` beschreibt per `aria-describedby`, warum gesperrt ist. |
| 2026-09-28 | RT-2 | **`updated` statt Text vergleichen, mit einem Wiederholversuch:** Der Hook vergleicht `updated` (kein Hash über 100 000 Zeichen im Body). Weil so auch fremde Felder (Status über das Häkchen der Liste, Tags im selben Panel) die Beschreibung „veralten“ lassen, lädt die SPA nach der Ablehnung neu und sendet einmal erneut, wenn die Beschreibung gleich geblieben ist. Beim Speichern gilt als Basis die Beschreibung beim Beginn der Bearbeitung. |
| 2026-09-28 | RT-2 | **Neu gelesen in der Transaktion:** `checkExpectedUpdated` liest das Ticket im `txApp` statt `record.original()` zu nehmen. Zwei gleichzeitige Anfragen mit derselben Erwartung kommen so nicht beide durch (Integrationstest). |
| 2026-09-28 | RT-2 | **Kein Dialog aus einem Dialog:** Die Konfliktfrage steht als `SectionMessage` (warning, `live`) mit „Überschreiben“ und „Verwerfen und neu laden“ an der Stelle von „Speichern“ und „Abbrechen“, in Panel und Vollansicht gleich. `ConfirmDialog.options` wird nicht gebraucht. Dabei fiel auf, dass „Löschen …“ in der Vollansicht seine Bestätigung schon heute über das XL-Modal legt (offener Punkt). |
| 2026-09-28 | RT-2 | **Meldung beim Abhaken inline statt als Flag:** `TicketDescription` hat keinen Zugriff auf die Flags und ist ein Abschnitt mit festem Platz; „Feld- und Formularfehler bleiben inline“ (CLAUDE.md §7). Die Meldung steht unter der Beschreibung (`role="alert"`) und gilt nur für das Ticket, auf dem sie entstand. |
| 2026-09-28 | RT-2 | **Kommentare ohne `expected_updated`:** Nur der Autor darf einen Kommentar ändern; ein Konflikt entsteht höchstens zwischen zwei eigenen Tabs. Eine Prüfung bräuchte einen neuen Hook für `comments` und wäre mehr als das Paket. |
| 2026-09-28 | RT-2 | **Verlauf:** Ändert eine Beschreibung nur das Zeichen einer Aufgabe, heißt der Eintrag „Aufgabe abgehakt: …“ bzw. „Aufgabe wieder offen: …“ (zeilenbasiert in `history-format.ts`, ohne Parser; Maskierungen der Vorlagen ohne Backslash, höchstens 80 Zeichen). Alt und Neu bleiben aufklappbar. |
| 2026-09-28 | RT-2 | `TicketDescription` und `CommentItem` ziehen auf die Schriftgrößen-Tokens und fallen von der Liste (`no-own-font-sizes.test.ts` jetzt 228). Die Hilfe erklärt das Abhaken. |
| 2026-09-28 | Stufe B | **Manifest-IDs ab `BYL-E6-240`:** 206 bis 219 blieben ungenutzt, die Unteraufgaben belegen 220 bis 229. BYL-E6-240 ist die Verwerfen-Frage der Vollansicht (offener Punkt der Unteraufgaben), RT-3 hat 241 und 242. |
| 2026-09-28 | RT-3 | **Abhängigkeiten:** `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-list`, `@tiptap/extensions`, `@tiptap/extension-underline` (alle 3.31.3, MIT) und `prosemirror-markdown` 1.13.8 (MIT). `overrides` hebt markdown-it von `prosemirror-markdown` auf `$markdown-it`; `package-lock.json` hat danach genau ein markdown-it (`editor-lazy.test.ts`). `npm audit`: nur die drei bekannten niedrigen Befunde über `cookie` (`@sveltejs/kit`), keiner aus dem Editor. |
| 2026-09-28 | RT-3 | **Prüfung vor dem Öffnen über die Anzeige** statt nur über Tokens (ADR-0032, Nachtrag RT-3): `richEditable` vergleicht die Anzeige vor und nach einer Rundreise mit `sameDisplay`. Kostet beim Öffnen zwei Renderings, schützt aber jeden einzelnen Text, nicht nur den Korpus. |
| 2026-09-28 | RT-3 | **Serializer:** mehrere Umbrüche als `\` am Zeilenende, Umbruch in einer Überschrift als Leerzeichen, zusätzliche Maskierung am Zeilenanfang (`+`, `1.`, `1)`, `=`, `|`, `:-`, führende Leerzeichen weg), abwechselnde Zeichen für Listen direkt hintereinander. Eine nackte Adresse, die im Editor Text blieb, verlinkt die Anzeige trotzdem (linkify); das ist die einzige bekannte Abweichung und nur optisch. |
| 2026-09-28 | RT-3 | **Schreiben nur bei Änderung:** `onUpdate` von Tiptap (nur bei geändertem Dokument) schreibt den Entwurf; große Dokumente (über 20 000 Positionen) nach 250 ms, spätestens beim Verlassen des Feldes, bei „Speichern“ (`flush`) und Strg+Enter. Unverändert geöffnet und gespeichert schreibt nichts (Test im Panel). |
| 2026-09-28 | RT-3 | **Quelltextmodus:** „Markdown“ rechts in der Leiste (`aria-pressed`) zeigt den bisherigen `MarkdownEditor` samt „Vorschau“; zurück geht es nur, wenn `richEditable` den Text annimmt, sonst bleibt der Hinweis. Erzwungener Quelltextmodus nennt den Fund („Gefunden: eine Tabelle.“). Scheitert das Laden des Chunks, übernimmt die `textarea` mit dem Hinweis „Der Editor konnte nicht geladen werden …“, „Markdown“ ist dann gesperrt. |
| 2026-09-28 | RT-3 | **Leiste:** WAI-ARIA-Toolbar mit Roving-Tabindex über alle Knöpfe der Leiste (auch die Auslöser der Popover-Menüs), Pfeiltasten, Pos1/Ende, Esc zurück in den Text, Alt+F10 aus dem Text. Textstil (Normaler Text, Überschrift 1 bis 3) und „Weitere Formatierungen“ (Inline-Code, Formatierung entfernen) sind Popover-Menüs. Unter 560 px (Panel) wandern Listen und Blöcke in das Menü „Listen und Blöcke“ (`menuitemcheckbox`). Nach einem Befehl geht der Fokus zurück in den Text. Link kommt mit RT-4. In einem Codeblock sind die Marken `aria-disabled`. |
| 2026-09-28 | RT-3 | **Kürzel schon in `shortcuts.ts`:** Die Leiste braucht Namen, Titel und `aria-keyshortcuts` aus einer Quelle; deshalb hat die Liste schon mit RT-3 den Abschnitt „Editor“ (`ariaKeyShortcuts` bildet die WAI-ARIA-Namen). Die Hilfeseite zeigt ihn automatisch, das Modal „Tastaturkürzel“ zeigt weiter nur „Überall“ und „Liste“. Jeder Eintrag des Editors wird im Test auf dem Editor gedrückt. |
| 2026-09-28 | RT-3 | **Esc im ganzen Editor verbraucht** (Text, Leiste, Quelltextmodus), Menüs verbrauchen ihres vorher selbst. So schließt Esc weder Panel noch Vollansicht, solange ein Feld bearbeitet wird (Escape-Kette). |
| 2026-09-28 | RT-3 | **CSS:** Tiptap injiziert sein CSS nicht (`injectCSS: false`, sonst schwarzer Gap-Cursor ohne Token); die nötigen Regeln stehen in `RichTextEditor.svelte`. Anzeige und Editor teilen `lib/styles/prose.css` (global im Wurzel-Layout); die zwei Überschriftgrößen von `Markdown.svelte` sind dorthin gewandert (`no-own-font-sizes.test.ts`: `prose.css` statt `Markdown.svelte`, Zahl unverändert). Fläche undurchsichtig mit dem Rahmen der `textarea`, Fokusring um Leiste und Text, Leiste ohne Glas. In `forced-colors` tragen gedrückte Knöpfe einen Rahmen. |
| 2026-09-28 | RT-3 | **Größe:** Editor-Chunk 124,9 KB gz (396 KB minifiziert), nur per `import()` aus `RichTextEditor` geladen; `RichTextEditor` und die Leiste liegen im Chunk der Ticket-Ansicht. |
| 2026-09-28 | RT-3 | Die Parität des langen Seitentexts dauert in jsdom Sekunden (DOMPurify, Vergleich) und bekam auf dem CI-Runner 30 s statt 5 s (zweiter CI-Lauf von #125). Im Browser ist das Öffnen eines solchen Texts spürbar, aber einmalig; BYL-E6-242 prüft es. |
| 2026-09-28 | RT-4 | **Eigenes Plugin statt `@tiptap/suggestion`:** Die Version 3.31.3 importiert `@floating-ui/dom` (Peer-Abhängigkeit) für ihre Positionierung; wir positionieren mit `place()` wie jede Liste. `lib/editor/slash.ts` (etwa 100 Zeilen) erkennt „/“ am Zeilenanfang oder nach Leerraum vor dem Cursor, nicht in Code und nicht mitten im Wort, merkt sich ein mit Esc geschlossenes Menü bis zum nächsten „/“ und gibt Tasten an die Komponente. Keine neue Abhängigkeit. |
| 2026-09-28 | RT-4 | **Gemeinsamer Listen-Baustein `SuggestionList`** (wie im Plan bevorzugt): die Liste des `TagPicker` samt Glas, Positionierung und Optionen-Stil, jetzt auch für das „/“-Menü (240 px breit am Cursor). In der Allowlist von `glass-allowlist.test.ts` steht `SuggestionList` statt `TagPicker`; die Tests des TagPicker laufen unverändert. |
| 2026-09-28 | RT-4 | **ARIA des „/“-Menüs:** Das Textfeld behält den Fokus und trägt `aria-autocomplete="list"`, im offenen Zustand `aria-controls` und `aria-activedescendant`; `aria-expanded` entfällt, weil es kein Zustand der Rolle `textbox` ist (Abweichung vom Konzept). Eine höfliche Live-Zeile sagt „N Blöcke, Pfeiltasten wählen, Enter fügt ein.“. Pfeile, Enter und Tab gehören dem Menü, Esc schließt es und wird verbraucht. Findet der Filter nichts, schließt die Liste, Enter wirkt normal. Kein Eintrag „Unteraufgabe“ (Produktentscheidung). |
| 2026-09-28 | RT-4 | **Link als Popover der Leiste:** Knopf „Link“ (Art `panel`, `aria-haspopup="dialog"`, Titel „Link (Strg+K)“), per Strg+K und „/link“ per Code geöffnet (`Popover.open()`); dafür bekam der Baustein `open()`, `onopen`, `returnFocus`, `buttonTitle` und `buttonKeyshortcuts`. Der Name des Popovers ist „Link einfügen“ bzw. „Link bearbeiten“. „Adresse“ prüft `domain/link.ts` (http, https, mailto; `www…` und `name.de/…` werden https, eine Mailadresse mailto; `javascript:`, `data:`, `ftp:` und Leerzeichen werden abgelehnt), der Fehler steht am Feld. „Text“ ersetzt die verlinkten Wörter; ohne Auswahl und Text wird die Adresse selbst der Link. Schließen (auch Esc) bringt den Fokus zurück in den Text. |
| 2026-09-28 | RT-4 | `shortcuts.ts` nennt Strg+K und „/“ im Abschnitt „Editor“; die Hilfe erklärt beides. |
| 2026-09-28 | RT-5 | **Bereinigen vor dem Schema:** `transformPastedHTML` (DOM, rein testbar) entfernt Kommentare samt bedingter Kommentare, `style`, `meta`, `link`, Office-Tags mit Doppelpunkt (`o:p`, `v:shape`), Bilder, Medien, eingebettete Inhalte, Formularfelder und Skripte, wandelt Word-Absätze mit `mso-list` in verschachtelte `ul`/`ol` (das Zeichen `mso-list:Ignore` entscheidet: `1.`, `a)`, `iv.` nummeriert, sonst Aufzählung; Listen mit anderer Kennung bleiben getrennt), macht aus Stil-Formatierung (`font-weight` ab 600, `font-style: italic`, `text-decoration`) Elemente, entfernt den fetten Rahmen von Google Docs (`b` mit `font-weight: normal`), packt `font`, `span`, `form` und `label` aus und lässt nur `href` (http, https, mailto; andere Links werden Text), `title` am Link und `start` stehen. Leere Absätze (Word-Abstände) fallen weg. Tabellen werden vom Schema zu Absätzen. |
| 2026-09-28 | RT-5 | **Keine Anfrage beim Einfügen:** ProseMirror liest HTML in einem Dokument ohne Browsing-Kontext; Bilder fallen zusätzlich schon vorher weg. Fixtures aus Word 365, Google Docs und LibreOffice (erfundene Inhalte, `lib/test/paste-fixtures/`, in `.prettierignore`) prüfen das Ergebnis bis zum Markdown. |
| 2026-09-28 | RT-5 | **Text mit Markdown:** `clipboardTextParser` liest reinen Text über die Brücke, wenn er nach Markdown aussieht (`looksLikeMarkdown`: Überschrift, Liste, Zitat, Zaun, `**`, `~~`, `++`, Backticks, Link); sonst, bei Tabellen und mit Strg+Umschalt+V bleibt er Text. Die Einfüge-Regeln von Tiptap (`enablePasteRules`) sind aus, weil sie auch reinen Text formatieren würden. Die Brücke baut im gemeinsamen Schema; das eingefügte Stück wird per JSON in das Schema des Editors übernommen (jeder Editor hat seine eigene Schema-Instanz, sonst passte nichts). |
| 2026-09-28 | RT-5 | `prosemirror-stubs.ts` bringt eine Attrappe für `ClipboardEvent`; die Tests senden ein `paste`-Ereignis mit eigener Zwischenablage (`text/html`, `text/plain`). |

## 5. Status

| Paket | Stand |
|---|---|
| RT-0 | gemergt (#114) |
| RT-1 | gemergt (#115) |
| RT-2 | gemergt (#116) |
| RT-3 | gemergt (#125) |
| RT-4 | gemergt (#127) |
| RT-5 | umgesetzt (Einfügen) |
| RT-6 | Stufe B, freigegeben, folgt |
| RT-7 | optional, nicht beauftragt |

## 6. Offene Punkte

- Manuelle Browser-Prüfungen der Pakete (BYL-E6-201, BYL-E6-205, BYL-E6-242, BYL-E6-244, BYL-E6-246).
- ~~„Löschen …“ in der Vollansicht legt seine Bestätigung über das XL-Modal (seit HK-6 mit Radios über `ConfirmDialog.options`).~~ Erledigt mit UA-3 ([Plan Unteraufgaben](unteraufgaben.md) §3): Die Vollansicht fragt inline (`TicketDeleteQuestion`).
- **Hinweise für die Unterprojekte:** Der Plan ändert weder Datenmodell noch Filter; Beschreibungen von Unterprojekt-Tickets nutzen dieselbe Anzeige. `expected_updated` gilt für jedes Ticket-Update und stört ein späteres Umhängen in ein Unterprojekt nicht, solange es ohne das Feld gesendet wird.
- **Hinweise für Stufe B** (umgesetzt mit RT-3, bis auf die Attrappe für `ClipboardEvent`, die RT-5 braucht):
  - `prosemirror-markdown` 1.13.8 verlangt `markdown-it` ^14; per `overrides` auf die Version der Anzeige heben, sonst liegen zwei Parser im Bundle.
  - Die Brücke braucht für `bulletList`, `orderedList` und `taskList` Attribute ohne Darstellung (`tight`, Aufzählungszeichen, Trennzeichen). Sonst ändern sich lockere Listen und zwei aufeinanderfolgende Listen verschmelzen.
  - Den harten Umbruch als `\n` schreiben (nicht `\\\n`) und den Text danach wie einen Zeilenanfang maskieren; `=`-Zeilen (Setext) und Tabellen-Trennzeilen am Zeilenanfang zusätzlich maskieren.
  - Tests brauchen eine Attrappe für `ClipboardEvent`.
  - Der `RichTextEditor` schreibt über `store.setDraft` und `store.save` wie heute die `textarea`; `expected_updated` und die Konfliktfrage gelten damit ohne Zusatz. Checkboxen im Editor ändern den Entwurf, nicht die Ansicht.
  - Der Korpus und `toggleTask` sind die Grundlage des Paritätstests; die Indizes von `data-task` müssen mit den `taskItem` der Brücke übereinstimmen (nur Aufzählungen, Dokumentreihenfolge).
