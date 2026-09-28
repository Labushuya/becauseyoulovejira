# ADR-0032: Editor wie Jira: Tiptap mit Markdown als Speicherformat, Brücke über die markdown-it-Instanz der Anzeige

- **Status:** Angenommen. Spike RT-0 abgeschlossen (Weg B, siehe §2, #114); Stufe A umgesetzt: RT-1 (Anzeige, #115) und RT-2 (Abhaken, Schutz vor Überschreiben, #116) nach [docs/plan/editor.md](../plan/editor.md); Stufe B: RT-3 (Editor für die Beschreibung, Nachtrag RT-3 unten, #125) RT-4 („/“-Menü mit eigenem Plugin statt `@tiptap/suggestion`, Link-Popover, #127) und RT-5 (Einfügen aus Word und HTML) umgesetzt, RT-6 folgt
- **Datum:** 2026-09-28
- **Entscheidung durch:** Nutzer (Tiptap als neue Abhängigkeit mit RT-0 als Abbruchpunkt, Markdown bleibt Speicherformat, `++Text++` für Unterstreichen, GFM-Task-Listen, Umfang wie Jira, 2026-09-28), Advisor (Konzept), Executor (Spike, Weg, Einzelheiten)
- **Ergänzt:** [ADR-0008](0008-markdown-rendering-und-sanitizing.md) §1, §2 und §5 (Parser-Erweiterungen, Allowlist, Abhängigkeiten); **ersetzt ab RT-3** ADR-0008 §4 (Bearbeiten nur als `textarea`)
- **Bezug:** [ADR-0006](0006-frontend-zustand-und-datenzugriff.md) §5, [ADR-0025](0025-ui-konsistenz-overlay-system.md), [ADR-0029](0029-glas-materialien.md), [ADR-0031](0031-herkunft-sichern.md) §6 (lange Seitentexte)

## Kontext

Beschreibungen (`tickets.description`, bis 100 000 Zeichen), Kommentare (`comments.body`, bis 20 000) und Vorlagen der Wiederholungen sind Markdown. Die Anzeige ist markdown-it mit `html: false`, `breaks: true` und `linkify`, danach DOMPurify ([ADR-0008](0008-markdown-rendering-und-sanitizing.md)). Bearbeitet wird in einer `textarea` mit „Schreiben | Vorschau“.

Der Nutzer wünscht einen Editor wie in Jira: Toolbar, Tastenkürzel, Checklisten. Er hat Tiptap freigegeben, mit dem Spike RT-0 als Abbruchpunkt, und festgelegt, dass Markdown das Speicherformat bleibt.

Alle Erzeuger (Vorlagen, Mail, `.ics`, WhatsApp, Seitenkopie) schreiben Markdown bzw. Klartext. Seitentexte von Web-Links kommen seit HK-4 ungemaskiert und bis 100 000 Zeichen in die Beschreibung ([Plan Herkunft](../plan/herkunft.md), HK-4). Mails enthalten oft `<b>` und ähnliches als Text. Beides muss der Editor unverändert lassen.

## Entscheidung

### 1. Speicherformat

Markdown bleibt, mit zwei Erweiterungen in der Anzeige:

- **Unterstreichen** `++Text++` über `markdown-it-ins` (MIT, aus der markdown-it-Organisation, ohne Abhängigkeiten). Der Renderer gibt `<u>` statt `<ins>` aus. Es gelten die Regeln für Begrenzer wie bei `**`: `C++ und C++` bleibt Text, `\+\+` ebenso.
- **Task-Listen** nach GFM: `- [ ] offen`, `- [x] erledigt` (auch `*`, `+`, `[X]`), über ein **eigenes** Core-Plugin in `lib/markdown.ts`. Es erzeugt Tokens, kein `html_inline`, und läuft nach der Regel `inline`, vor `text_join`. Damit bleibt `\[ \]` Text.
  - Nur Punkte von **Aufzählungen** werden Aufgaben. In nummerierten Listen bleibt `1. [ ]` Text, denn Tiptap kennt keine nummerierten Aufgabenlisten, und Anzeige und Editor sollen dasselbe zeigen.
  - Ein Punkt, der nur aus `[ ]` besteht, ist eine leere Aufgabe, damit ein leerer Punkt im Editor die Rundreise übersteht.
  - Jede Aufgabe bekommt ihren Index im Dokument (`li[data-task="N"]`) und eine Checkbox mit dem Text des Punkts als Namen.

### 2. Brücke Editor ↔ Markdown (Ergebnis RT-0: Weg B)

Der Editor ist **Tiptap 3** (MIT). Markdown liest und schreibt er **nicht** über `@tiptap/markdown`, sondern über eine eigene Brücke:

- `MarkdownParser` und `MarkdownSerializer` aus `prosemirror-markdown` (MIT) auf dem Tiptap-Schema.
- Der Parser nutzt **dieselbe markdown-it-Instanz wie die Anzeige** (mit `++` und Task-Plugin). Was die Anzeige als Text zeigt, ist im Editor Text.
- Der Serializer ist an die Anzeige angepasst:
  - harter Umbruch als einfacher Zeilenumbruch (`breaks: true`)
  - `++` für Unterstreichen, `~~` für Durchgestrichen
  - Maskieren von `++`, `&` vor Entitäten, `<` vor Autolinks und Zeichen am Zeilenanfang auch nach einem Umbruch
  - Listen behalten Dichte (`tight`), Aufzählungszeichen und Trennzeichen als Attribute ohne Darstellung
- Aufzählungen, deren Punkte alle Aufgaben sind, werden `taskList`. Gemischte Listen und Tabellen sind nicht abbildbar und öffnen im Quelltextmodus (§4).

`@tiptap/markdown` und `marked` werden nicht verwendet.

### 3. Sicherheit (Ergänzung zu ADR-0008 §2)

- Die Allowlist von DOMPurify kommt hinzu:
  - `u`
  - `input` nur als Checkbox mit `type`, `checked`, `disabled` und `aria-label`
  - `data-task` nur an `li` und nur mit Ziffern
- Ein Hook entfernt jedes `input`, das keine deaktivierte Checkbox ist, und jedes `data-task`, das nicht `/^\d{1,4}$/` erfüllt oder nicht an einem `li` steht. `ALLOW_DATA_ATTR` und `ALLOW_ARIA_ATTR` bleiben `false`.
- DOMPurify prüft die Werte von Attributen außerhalb seiner Liste `URI_SAFE_ATTRIBUTES` gegen `ALLOWED_URI_REGEXP`. Deshalb stehen `type`, `aria-label`, `data-task` und `start` in `ADD_URI_SAFE_ATTR`.
  - Dabei fiel ein bestehender Fehler auf: `start` einer nummerierten Liste (`3. drei`) ging bisher verloren. Er wird mit RT-1 behoben.
- markdown-it bleibt bei `html: false`.
- Im Editor bestimmt das Schema, was existiert: kein Bild, kein HTML-Knoten. Eingefügtes HTML liest ProseMirror schemagebunden (im Spike: `<img onerror>`, `onclick` und `<script>` fallen weg).

### 4. Nicht abbildbare Inhalte

`richEditable(markdown)` prüft die Tokens der Anzeige. Tabellen, gemischte Listen und alles, was die Brücke nicht kennt, öffnen den Editor im Quelltextmodus mit Hinweis ([Plan](../plan/editor.md) §3.1). So geht nichts verloren.

### 5. Laden und Offline

- Tiptap, ProseMirror und `prosemirror-markdown` werden lokal von Vite gebündelt und erst beim ersten „Bearbeiten“ per `import()` geladen, wie driver.js. Es gibt kein CDN, keine Tiptap-Cloud und kein Pro-Registry.
- `prosemirror-markdown` verlangt `markdown-it` ^14, die Anzeige nutzt 15. Ein `overrides`-Eintrag in `web/package.json` hält eine einzige markdown-it-Version (die Brücke ruft nur `parse()` der übergebenen Instanz auf).

### 6. Abhaken in der Ansicht und Schutz vor Überschreiben (RT-2)

- Checkboxen der Ansicht lassen sich abhaken. Das schreibt die Beschreibung bzw. den eigenen Kommentar zurück, geändert wird genau `[ ]` ↔ `[x]` in der Zeile der Aufgabe.
- Beschreibungen gehen dabei mit dem Body-Feld `expected_updated` an den Server. Dasselbe gilt fürs Speichern der Beschreibung.
  - Der Ticket-Hook liest das Ticket in seiner Transaktion neu. Weicht `updated` ab, lehnt er mit `validation_description_stale` ab und ändert nichts.
  - Das Feld wird nie gespeichert. Ohne das Feld gilt ein Update wie bisher.
- Die Prüfung vergleicht `updated` und nicht den Text, damit kein Hash über 100 000 Zeichen nötig ist. Dadurch schlägt sie auch an, wenn sich nur ein anderes Feld geändert hat, etwa der Status über das Häkchen der Liste.
  - Die SPA lädt das Ticket dann neu. Ist die Beschreibung gleich geblieben, sendet sie einmal erneut auf dem neuen Stand.
  - Sonst meldet das Abhaken, dass die Beschreibung geändert wurde.
  - Das Speichern fragt **inline** „Überschreiben“ oder „Verwerfen und neu laden“. Eine Bestätigung ginge nicht, weil die Vollansicht ein Modal ist und nach [ADR-0025](0025-ui-konsistenz-overlay-system.md) §3 kein Dialog aus einem Dialog aufgeht; das Panel fragt genauso.
  - Kommt die neuere Beschreibung schon per Realtime an, fragt das Speichern ohne Anfrage.
- Kommentare haben keine solche Prüfung: Nur ihr Autor darf sie ändern (API-Regel), ein Konflikt entsteht höchstens zwischen zwei eigenen Tabs.
- Der Verlauf speichert weiter die ganze Beschreibung alt und neu. Ändert sich nur eine Aufgabe, nennt er „Aufgabe abgehakt: …“ bzw. „Aufgabe wieder offen: …“.

## Spike RT-0 (2026-09-28)

Aufbau: Tiptap 3.31.3 (StarterKit, TaskList, TaskItem) in jsdom, Korpus aus erfundenen Texten:

- Vorlagen „Anruf“, „Einkauf“, „Termin“ und „Web-Link“ (mit Maskierung durch `escapeMarkdown`)
- Mail mit Kopf, `*`-Listen, nummerierter Liste, Signatur, Zitat und HTML als Text
- Termin und WhatsApp mit `*fett*`, `_kursiv_`, `~durch~`
- Hand-Markdown mit allen Konstrukten
- Task-Listen, gemischte Listen, `++`-Fälle und HTML als Text, eine Tabelle
- ein ungemaskierter Seitentext mit 99 000 Zeichen
- die Mail mit CRLF

Geprüft wurde `renderMarkdown(serialize(parse(md)))` ≡ `renderMarkdown(md)` (normalisiertes HTML) und `serialize(parse(serialize(parse(md))))` = `serialize(parse(md))`.

| Prüfung | A: `@tiptap/markdown` (marked) | B: Brücke `prosemirror-markdown` auf markdown-it |
|---|---|---|
| Gleiche Anzeige nach der Rundreise | 3 von 12 Texten | alle abbildbaren Texte; einzige Abweichung ist die Reihenfolge verschachtelter Marken (`<u><strong>` statt `<strong><u>`), optisch gleich |
| HTML im Text bleibt Text | **nein**: `<b>`, `<i>`, `<u>` und `<span>` werden Formatierung; `<script>`, `<img>`, HTML-Tabelle und Kommentar verschwinden samt Text | ja |
| `~durch~` (ein Tilde, WhatsApp) | wird durchgestrichen | bleibt Text wie in der Anzeige |
| `++` | ohne Regeln für Begrenzer: `C++ und C++` wird unterstrichen, `\+\+` nach der Rundreise auch | wie die Anzeige |
| Listen | Dichte geht verloren, eine Fortsetzungszeile im Punkt wird ein eigener Absatz, `1. [ ]` wird maskiert | Dichte, Zeichen und Fortsetzung bleiben |
| Idempotent | nein (Mail, CRLF, HTML-Fälle) | ja, bei allen Texten |
| Byte-gleich | kein Text | kein Text (normalisiert `_` → `*`, Umbrüche, Maskierung); deshalb schreibt der Editor nur nach einer echten Änderung (Plan §3.1) |
| Tabelle, gemischte Liste | Tabelle verschwindet samt Inhalt | nicht abbildbar, Quelltextmodus |
| Seitentext 99 000 Zeichen | 583 ms | 291 bis 326 ms (jsdom) |
| Chunk (esbuild, min + gzip) | 136 KB | **123 KB** (markdown-it liegt schon im Haupt-Bundle) |
| jsdom | Befehle, Tastenkürzel (`Mod-i`, `Mod-u`), Eingaberegeln über `handleTextInput` (`## `, `[ ] `, `**x**`) und `pasteHTML` funktionieren; `ClipboardEvent` fehlt in jsdom und braucht eine Attrappe | gleich |
| `npm audit` | 0 Befunde | 0 Befunde |
| Lizenzen | MIT (Tiptap, ProseMirror, marked) | MIT (Tiptap, ProseMirror, `prosemirror-markdown`, `linkifyjs`, `orderedmap`, `rope-sequence`, `w3c-keyname`) |

**Abbruchkriterium:** Weg A besteht die Parität nicht, und per Konfiguration ließe sie sich nur über eigene Tokenizer für HTML, Tilde, `++`, Maskierung und Listen in marked herstellen, also über einen zweiten Nachbau von markdown-it. Damit greift der im Konzept vorgesehene Rückfall. Weg B besteht die Parität und hält den Editor bei Tiptap. Tiptap als Ganzes bleibt tragfähig; ein Abbruch des Editors ist nicht nötig.

Der Spike-Code liegt nicht im Repo. Die Brücke entsteht mit RT-3 neu in TypeScript unter `web/src/lib/editor/`, der Korpus kommt mit RT-1 nach `web/src/lib/test/markdown-corpus/`.

## Nachtrag RT-3 (2026-09-28): Brücke und Prüfung vor dem Öffnen

- **Prüfung über die Anzeige:** `richEditable` lehnt nicht nur Tabellen, gemischte Listen und unbekannte Tokens ab. Es schickt den Text einmal durch die Brücke und vergleicht die Anzeige vorher und nachher (`lib/editor/parity.ts`: gleiche Blöcke, gleicher Text mit gleichen Marken, Leerraum zwischen Tags und die Reihenfolge verschachtelter Marken zählen nicht). Weicht sie ab, öffnet der Quelltextmodus. So garantiert nicht nur der Korpus, sondern jeder einzelne Text, dass Bearbeiten nichts anders zeigt.
- **Serializer über den Spike hinaus:**
  - mehrere Umbrüche hintereinander als `\` am Zeilenende (eine Leerzeile würde den Absatz beenden); Umbrüche am Blockende fallen weg; in einer Überschrift wird ein Umbruch ein Leerzeichen
  - am Zeilenanfang zusätzlich `+` und `1.` ohne Text, `1)`, `=`, `|` und `:-` maskiert; führende Leerzeichen fallen weg (die Anzeige ignoriert sie, vier davon würden Code)
  - zwei Listen direkt hintereinander bekommen verschiedene Zeichen (`-`/`*`, `.`/`)`), sonst verschmölzen sie; das gilt auch für Aufzählung und Checkliste
- **Schreiben:** Der Editor schreibt Markdown nur bei einer Änderung des Dokuments, bis 20 000 Positionen sofort, darüber nach 250 ms und spätestens beim Verlassen, Speichern oder Strg+Enter.
- **Größe:** Der Chunk hat 124,9 KB gz (396 KB minifiziert). markdown-it liegt nur einmal im Bundle (`overrides` in `web/package.json`, geprüft in `editor-lazy.test.ts` über `package-lock.json`).
- `@tiptap/extension-underline` ist eine direkte Abhängigkeit, weil der Editor ihm die Eingaberegel `++x++` gibt.

## Alternativen

- **Weg A, `@tiptap/markdown`:** offiziell, aber „early release“, mit anderem Parser als die Anzeige. Die Rundreise ändert Inhalte (siehe Spike). Verworfen.
- **HTML speichern:** braucht eine Migration ohne Rückweg. Die Suche trifft Markup, der Verlauf zeigt HTML, alle Erzeuger müssten HTML liefern. Verworfen.
- **Milkdown 7:** Markdown als Quelle (remark), aber im Kern ein Hauptentwickler, eigene UI, Unterstreichen nur mit eigenem Plugin. Verworfen.
- **Lexical:** vor 1.0 mit wiederkehrenden Breaking Changes, Svelte nur über eine Community-Bibliothek, Unterstreichen ohne Standard-Transformer. Verworfen.
- **ProseMirror direkt:** Befehle, Eingaberegeln, Aufgaben und Toolbar wären Eigenbau. ProseMirror bleibt als Unterbau von Tiptap.
- **Quill 2:** kein Markdown (Delta-Format), geringe Aktivität. Verworfen.
- **CodeMirror 6 oder `textarea` mit Toolbar:** verlustfrei, aber kein WYSIWYG, also nicht „wie Jira“. Die `textarea` bleibt als Quelltextmodus.
- **Eigenes Plugin statt `markdown-it-ins`:** Das wären etwa 100 Zeilen, die Regeln für Begrenzer doppeln würden. `markdown-it-ins` kommt aus derselben Organisation wie markdown-it, hat 2 KB und keine Abhängigkeiten. Verworfen.
- **`markdown-it-task-lists`:** seit 2022 ungepflegt, erzeugt `html_inline` am `html: false` vorbei. Verworfen.

## Konsequenzen

- Positiv: Ein Parser für Anzeige und Editor. Was gespeichert wird, zeigt die Anzeige genau so, wie der Editor es zeigte. Kein zweiter Markdown-Dialekt.
- Positiv: Bestandsdaten, Suche, Verlauf und Erzeuger bleiben unverändert. Unterstreichen und Checklisten gehen schon mit Stufe A in der `textarea`.
- Negativ: Die Brücke ist eigener Code (etwa 250 Zeilen) mit Paritätstest als Pflicht-Gate. Ein Update von markdown-it oder Tiptap läuft durch diesen Test.
- Negativ: Das erste Speichern aus dem Editor normalisiert den Text (Maskierung, `*` statt `_`). Das gibt einmal einen größeren Diff im Verlauf. Ein ungeändertes Speichern schreibt nichts.
- Negativ: `++` ist kein Standard. Fremde Programme zeigen die Pluszeichen.
- Negativ: Tabellen und gemischte Listen bleiben bis RT-7 bzw. einer Schema-Erweiterung im Quelltextmodus.
- Etwa 123 KB gz im nachgeladenen Chunk, erst beim ersten „Bearbeiten“.
- `CLAUDE.md` §3 nennt Tiptap als freigegebene Abhängigkeit (Einbau mit RT-3). §7 nennt Unterstreichen, Checklisten und das Abhaken ab Stufe A.
