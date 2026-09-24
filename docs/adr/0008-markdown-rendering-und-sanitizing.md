# ADR-0008: Markdown-Rendering und Sanitizing

- **Status:** Angenommen
- **Datum:** 2026-09-24
- **Entscheidung durch:** Advisor

## Kontext

`tickets.description` und `comments.body` sind Markdown (CLAUDE.md §5, OF-10: Feldtyp `text`, kein HTML-Editor). CLAUDE.md §7 verlangt, dass die Markdown-Ausgabe sanitisiert wird. Die Lint-Regel `svelte/no-at-html-tags` verbietet `{@html}` (E1, Paket 7). Die App läuft offline, ohne CDN (CLAUDE.md §3). Später können über Haushalte und Mehrgerätebetrieb ([ADR-0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md)) auch Inhalte anderer Personen angezeigt werden. Das Rendering muss deshalb auch gegen fremde, böswillige Eingaben sicher sein, nicht nur gegen eigene.

## Entscheidung

1. **Parser: `markdown-it`** (derzeit 15.x) mit `html: false` (rohes HTML wird als Text ausgegeben), `linkify: true`, `typographer: false` und `breaks: true` (ein Zeilenumbruch im Text bleibt ein Umbruch, wie man es aus Ticketsystemen erwartet). Die eingebaute `validateLink` lässt `javascript:`, `vbscript:` und `file:` nicht zu; die Standardeinstellung bleibt.
2. **Sanitizer: `DOMPurify`** (derzeit 3.x) auf der HTML-Ausgabe, als zweite, unabhängige Schutzschicht. Erlaubt ist nur, was Markdown erzeugt: Absätze, Überschriften, Hervorhebungen, Listen, Zitate, Code, Tabellen, Trennlinie, Links. Nicht erlaubt: `img` (Bilder würden externe Anfragen auslösen und die Offline-Regel verletzen; Anhänge sind Stufe 2), `style`, `iframe`, `form`, Event-Attribute. Links: nur `http:`, `https:` und `mailto:`. Ein DOMPurify-Hook setzt `rel="noopener noreferrer"` und `target="_blank"` an externen Links.
3. **Genau eine Stelle mit `{@html}`:** die Komponente `web/src/lib/components/Markdown.svelte`. Sie rendert ausschließlich das Ergebnis von `renderMarkdown(text)` aus `web/src/lib/markdown.ts` (Parser und Sanitizer in einer Funktion). Die Lint-Regel wird nur in dieser Zeile mit einem begründenden Kommentar ausgesetzt (`eslint-disable-next-line svelte/no-at-html-tags`). Ein statischer Test stellt sicher, dass `{@html}` sonst nirgends vorkommt.
4. **Bearbeiten:** Beschreibung und Kommentare werden als Klartext in einer `textarea` bearbeitet, mit Umschalter „Schreiben“ / „Vorschau“. Die Vorschau nutzt dieselbe Komponente.
5. **Abhängigkeiten:** `markdown-it`, `dompurify` (bringt eigene Typen mit) und `@types/markdown-it` (devDependency), als Caret-Range mit Lockfile. Beide Bibliotheken werden gebündelt und lokal ausgeliefert.

## Alternativen

- **`marked` + DOMPurify:** kleiner, gibt rohes HTML aber standardmäßig durch. Die Sicherheit hinge allein am Sanitizer. Verworfen zugunsten zweier unabhängiger Schichten.
- **Nur `markdown-it` mit `html: false`, ohne Sanitizer:** in der Praxis sicher, aber jede künftige Erweiterung (Plugins, Linkify-Varianten) könnte das ändern, ohne dass es auffällt. Verworfen.
- **Kein Rendering, nur Klartext:** sicher, widerspricht aber dem Markdown-Feld aus CLAUDE.md §5. Verworfen.
- **Eigener Mini-Parser:** hoher Aufwand bei gleichzeitig höherem Risiko. Verworfen.
- **Svelte-Komponenten-Renderer (Markdown-AST → Svelte-Elemente, ganz ohne `{@html}`):** kein `{@html}`, aber eine weitere Abhängigkeit oder eigener Code für jeden Knotentyp. Für den geringen Umfang nicht verhältnismäßig. Verworfen.

## Konsequenzen

- Positiv: Zwei unabhängige Schutzschichten, eine einzige geprüfte Render-Stelle.
- Positiv: Keine externen Ressourcen, weil Bilder nicht zugelassen sind.
- Negativ: Etwa 120 KB zusätzliches JavaScript (unkomprimiert). Für eine lokal ausgelieferte App ist das unerheblich.
- Negativ: Eingefügte Bild-Markdowns erscheinen nicht als Bild. Das bleibt so, bis Anhänge (Stufe 2) freigegeben sind.
- Tests: XSS-Fälle (`<script>`, `<img onerror>`, `javascript:`-Links, `data:`-URLs, HTML-Entities, verschachtelte Links, SVG) als Unit-Tests in jsdom.
