# E6-Plan, Teil Glas: Materialien im macOS-Stil, verheiratet mit den Akzent-Themes

- **Stand:** umgesetzt (2026-09-27; G-1 bis G-6); offen sind die manuellen Browser-Prüfungen und die Punkte in §6. Reihenfolge G-1, G-3, G-2, G-4, G-5, G-6, je ein PR.
- **Grundlage:**
  - [ADR-0029](../adr/0029-glas-materialien.md) (Ebenen, Tokens, Kontrast, Umschaltpunkt „undurchsichtig“, Schalter, Performance)
  - [ADR-0010](../adr/0010-layout-nach-task-board.md) §3 und §4, [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) §2, [ADR-0027](../adr/0027-akzent-themes.md) §1 (je mit Nachtrag)
  - [CLAUDE.md](../../CLAUDE.md) §7, §8, §11, §12
- **Einordnung:** Nutzerwunsch „UI wie macOS, Glas-Transparenz, mit unseren Themes verheiraten“. Die Manifest-IDs laufen unter E6 ab `BYL-E6-100`. Der Block 100 bis 119 ist für das Glas reserviert; die parallele Mail-Arbeit zählt ab `BYL-E6-120`.

## 1. Entscheidungen des Nutzers (2026-09-27)

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Wie weit reicht das Glas? | **Nur die Bedienebene:** Kopfzeile, Seitenpanel, Einstellungsnavigation, Popover und Menüs, Modals S bis L, Flags, Anmeldung, Tour. Tabellen, Kacheln, Karten und Texte bleiben undurchsichtig. |
| 2 | Transparenz standardmäßig an? | **An**, mit dem Schalter „Transparenz“ unter Einstellungen → Darstellung. Die Systemeinstellung („Transparenz reduzieren“, Windows „Transparenzeffekte“) gewinnt immer. |
| 3 | Schrift | **Inter bleibt**; Größen und Abstände lehnen sich an macOS an, der System-Stack ist nur Fallback. |

Die Themes sind Petrol, Rubin, Smaragd und Kupfer (Nachtrag zu ADR-0027 vom 2026-09-27). Alle Prüfungen laufen über `ACCENT_THEMES`, es gibt kein neues Akzent-Token.

## 2. Querschnittsregeln

- `backdrop-filter` nur in den Dateien der Allowlist von `glass-allowlist.test.ts` und nur als `var(--glass-filter-…)`. Kein Glas im Glas.
- Mindest-Deckkraft 0,82 für jedes Material mit Text; `glass-contrast.test.ts` rechnet alle Themes × vier Modus-Blöcke × Materialien.
- Ein Umschaltpunkt „undurchsichtig“ in `tokens.css`; die Komponenten merken nichts davon.
- Was jsdom nicht kann (Blur, Top-Layer, Media-Query-Emulation, Bildrate), steht als manueller Fall im Test-Manifest. Die Messung nach ADR-0029 §8 macht der Nutzer im Browser, weil der Agent auf dem Entwicklungsrechner keinen Browser startet (CLAUDE.md §11).
- **Gates je Paket:** eigener Branch und PR, `scripts\build.ps1` lokal komplett grün (Exit-Code 0 und „Build complete!“), CI grün, Squash-Merge, Test-Manifest nachgezogen, Entscheidungen in §4.

## 3. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| G-1 | Fundament: ADR-0029 mit Nachträgen, CLAUDE.md §8, Tokens (Materialien, Filter, Trennlinie, Lichtkante, Popover-Schatten, `--radius-overlay`, `--radius-item`), Umschaltpunkt für Systemeinstellung, Kontrast, Forced Colors und fehlendes `backdrop-filter`, Verlauf auf `body::before`, Kopfzeile (regular) und Popover (thick) aus Glas, einheitliche Menüzeilen, Fokusring in `--color-brand-text` | BYL-E6-100 bis BYL-E6-102 |
| G-3 | Schalter „Transparenz“ (`byl-transparency`, Boot-Skript, Store, Switch in `base.css`, Block `data-transparency='off'`) | BYL-E6-103 bis BYL-E6-105 |
| G-2 | Modals, Bestätigung, Seitenpanel, Flags, TagPicker-Liste, Anmeldekarte, Tour; Vollansicht opak; `--shadow-modal` | BYL-E6-106 und BYL-E6-107 |
| G-4 | Knöpfe, `.segmented`, `.search-field`, Radien auf Tokens, `--fill-control*`, `--shadow-control`, Höhen | BYL-E6-108 und BYL-E6-109 |
| G-5 | Switch nach HIG, baut auf den Checkboxen und Radios aus `base.css` auf (#86) | BYL-E6-110 und BYL-E6-111 |
| G-6 | Einstellungs-Sidebar, Typografie, README, Hilfe, manuelle Fälle | BYL-E6-112 und BYL-E6-113 |

## 4. Entscheidungen

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-27 | G-1 | ADR-Nummer 0029 (0028 ist die Plattform-Strategie). |
| 2026-09-27 | G-1 | **Fokusring in `--color-brand-text` statt `--color-brand`:** Die Rechnung zeigt im Dunkelmodus auf Glas (Petrol, Rubin, Smaragd 2,4 bis 2,9 : 1) und auf dem Verlauf (2,7 bis 3,0 : 1) weniger als 3 : 1. `--color-brand-text` erreicht überall 4,5 : 1 und ist schon ein Akzent-Token; die Alternative, die Deckkraft anzuheben, hülfe nicht auf dem Verlauf. Alle lokalen Ringe (acht Stellen neben `base.css`) ziehen mit. |
| 2026-09-27 | G-1 | **Menüzeilen stylt allein `Popover.svelte`** (Art `menu`, über `role="menuitem|menuitemradio|menuitemcheckbox"` und `role="separator"`): Hover und Tastaturfokus in `--color-brand` mit `--color-on-brand`, Höhe mindestens 1.5rem, `--radius-item`. Die lokalen Kopien in `ThemeMenu`, `HelpMenu` und `ChannelCard` entfallen. Der Fokusring bleibt zusätzlich, weil die Füllung im Dunkelmodus gegen Glas nicht sicher 3 : 1 erreicht. |
| 2026-09-27 | G-1 | Die Fallback-Blöcke tragen `!important`, weil die Modus-Blöcke (`:root:not([data-theme='light'])`, `:root[data-theme='dark']`) spezifischer sind als `:root` in einer Media Query. `tokens.test.ts` prüft jeden Block auf Vollständigkeit. |
| 2026-09-27 | G-1 | Tokens entstehen mit dem Paket, das sie zuerst nutzt: `--fill-control*`, `--shadow-control`, `--shadow-modal`, `--radius-pill`, Höhen und Schriftgrößen folgen mit G-2, G-4 und G-6; `--material-thin` entfällt (keine Stelle). |
| 2026-09-27 | G-1 | Der Verlauf liest `var(--backdrop-image, …)`: Die Fallbacks setzen `--backdrop-image: none`, dann bleibt nur `--color-bg`. `body` selbst malt keinen Hintergrund mehr. |
| 2026-09-27 | G-3 | **Switch über die Rolle statt über eine Klasse:** `base.css` gestaltet `input[type='checkbox'][role='switch']`. Eine globale Klasse `.switch` (so die Skizze) träfe die lokalen `label.switch` in `ChannelEditModal` und `ProjectsView`. Der Switch baut auf den Checkbox-Regeln von #86 auf (Rand, Fokus, Hover, `:disabled`, `forced-colors`) und ändert nur Maße, Radius und den Knopf. Aus: Knopf links in `--color-text-muted` (Form und Farbe mit 4,5 : 1 zur Fläche); an: rechts in `--color-on-brand` auf `--color-brand`. Die Spur „aus“ bleibt `--color-surface` mit Rand; `--fill-control` kommt erst mit G-4. `--radius-pill` entsteht hier, weil der Switch es zuerst nutzt. |
| 2026-09-27 | G-3 | **Name und Ort:** Gruppe „Transparenz“ (`fieldset`/`legend` wie „Farbschema“ und „Farbe“) mit dem Switch „Glas-Effekt“ als Zeile (Name links, Switch rechts). Die Beschreibung nennt nur Kopfzeile und Menüs; mit G-2 kommen Seitenpanel und Dialoge dazu (umgesetzt). |
| 2026-09-27 | G-3 | **Systemeinstellung:** `tokens.css` folgt `prefers-reduced-transparency` selbst. Der Store meldet die Media Query nur (`systemReduces`, auch bei späteren Wechseln), damit die Seite den Hinweis zeigt; der Schalter bleibt bedienbar, die Wahl gilt wieder, sobald das System die Transparenz erlaubt. Ohne `matchMedia` gilt „nicht reduziert“. |
| 2026-09-27 | G-3 | **Andere Tabs:** `ThemeMenu` verbindet den Store (es steht auf jeder Seite der App), die Seite „Darstellung“ zusätzlich; so wirkt der Schalter sofort in allen offenen Tabs, nicht nur auf der Einstellungsseite. |
| 2026-09-27 | G-3 | Die parallele Mail-Arbeit zählt ab `BYL-E6-120` (#89); der Glas-Block reicht damit bis `BYL-E6-119`. |
| 2026-09-27 | G-2 | **Modal:** S bis L thick über `.modal:not(.size-xl)`, die Vollansicht (XL) bleibt `--color-surface` mit `--radius-overlay` und `--shadow-modal`. So steht `backdrop-filter` nur als Glas-Token im Code, nie als `none` (Allowlist). Kopf- und Fußlinie auf Glas in `--color-separator`. |
| 2026-09-27 | G-2 | **Seitenpanel:** eingebettet regular (dahinter nur der Seitenhintergrund, das Blur-Modell gilt), als Overlay thick über `:global([data-panel-mode='overlay'])`. Kein Schatten: Linie links und, als Overlay, das Blanket trennen genug; der Test „a line on the left and no shadow“ bleibt damit gültig. |
| 2026-09-27 | G-2 | **Flags, TagPicker-Liste, Tour:** thick mit `--shadow-popover`; der farbige Streifen links an Flags bleibt. **Anmeldekarte:** thick mit `--shadow-modal`, sie schwebt über dem Verlauf. Der Pfeil der Tour bleibt `--color-surface` (Unterschied zur Deckkraft 0,92 kaum sichtbar). |
| 2026-09-27 | G-2 | **Kontrast über dem Blanket:** Modals, Panel-Overlay und Tour liegen auf dem Schleier. `glass-contrast.test.ts` rechnet thick deshalb zusätzlich über jeder Palettenfarbe, abgedunkelt mit `--color-blanket`. |
| 2026-09-27 | G-4 | **Knöpfe:** Primär- und Sekundärknopf mit `--shadow-control`, der Sekundärknopf erhaben auf `--color-surface` mit Linie und Mindesthöhe m; `.button-subtle` und `.button-icon` zeigen beim Hover `--fill-control-hover` statt einer Linie. Die Maße des Primärknopfs (Innenabstand) und von `.button-icon` (2rem, Zielgröße) bleiben, damit sich Formulare und Tabellenzeilen nicht verschieben. |
| 2026-09-27 | G-4 | **`.segmented`:** Spur `--fill-control`, Einträge `--radius-item` in der Spur mit `--radius-control` (konzentrisch), gewählt als Daumen mit Akzentfläche, Rahmen `--color-brand-text` (wie der Fokusring; `--color-brand` hält auf dem Verlauf keine 3 : 1), Gewicht 600 und `--shadow-control`. Nicht gewählte Einträge in `--color-text`, weil gedämpfter Text auf der Spur über dem Verlauf unter 4,5 : 1 fällt (Rechnung in `glass-contrast.test.ts`). Eingesetzt im Bereichsumschalter und im Symbolpaar „Liste \| Kacheln“ (dort ohne `.button-icon`). Die Kachelgruppen unter „Darstellung“ bleiben Kacheln mit Beschreibung; eine Spur passt nicht zu Karten mit drei Zeilen. |
| 2026-09-27 | G-4 | **`.search-field`:** Wrapper statt Klasse am Eingabefeld, weil die Lupe als Inline-SVG im Wrapper steht (kein Data-URI, keine Farbliterale). Füllung `--fill-control` plus Linie (auf deckendem Grund bleibt die Kante sichtbar), im Fokus `--color-surface` und der gemeinsame Fokusring statt nur einer Randfarbe. Das Filter-Popover bekommt dieselbe Lupe. |
| 2026-09-27 | G-4 | **Radien nur als Token:** Rund 70 Literale in 35 Dateien ziehen auf `--radius-control` (0.375rem), `--radius-item` (0.25rem), `--radius-pill` (999px sowie die Zähler mit 0.625rem und der 3px-Balken des Steppers) und `--radius-surface` (0.5rem-Flächen; der Token wächst auf 0.625rem). `no-own-radii.test.ts` verbietet neue Literale. `KeywordEditor`, `ConnectionsSection` und `ImportKeywordsSection` gehören zur parallelen Mail-Arbeit und stehen auf einer Ausnahmeliste, die nur schrumpfen darf. |
| 2026-09-27 | G-5 | **Was schon da ist:** Checkboxen und Radios zeichnet `base.css` seit #86 (inklusive `indeterminate`, `aria-disabled`, `forced-colors`, kein `accent-color` außerhalb, `no-own-controls.test.ts`), den Switch seit G-3. G-5 legt nichts doppelt an und setzt nur die HIG-Regel um. |
| 2026-09-27 | G-5 | **Switch statt Checkbox** für die betonten Einzeleinstellungen der Abschnittsleisten: „Erledigte anzeigen“ (Aufgaben, samt gesperrtem Zustand mit `aria-disabled` und Hinweis) und „Archivierte anzeigen“ (Projekte). Checkboxen bleiben für Listen und Auswahl (Eingang, Postfach-Auswahl, Wochentage, Erledigt-Häkchen der Zeile). Die Normalgröße des Switch bleibt auch in den Leisten; eine Mini-Variante braucht es neben 24px-Zielen nicht. |
| 2026-09-27 | G-5 | **Kanal-Dialog ausgenommen:** Die zwei Schalter in `ChannelEditModal` (Telegram-Antwort, Mail-Textsuche) wären nach HIG ebenfalls Switches. Dialog, Texte und Tests entwickelt gerade die parallele Mail-Arbeit weiter; die Umstellung folgt dort (offener Punkt, kein neues Token nötig: nur `role="switch"`). |
| 2026-09-27 | G-6 | **Einstellungsnavigation:** ab 64rem eine schwebende Karte aus `--material-regular` (dahinter nur der Verlauf; die Spalte bleibt sticky, die Seite scrollt rechts), `--radius-overlay`, Linie `--color-separator`, Lichtkante und `--shadow-popover`. Zeilen als abgerundete Flächen mit Höhe m, gewählt Akzentfläche und Gewicht 600; die Linie links entfällt. Schmal bleibt es eine Linkzeile ohne Glas; die Linie unter der gewählten Seite wird `--color-brand-text` (3 : 1 auf dem Verlauf). |
| 2026-09-27 | G-6 | **Typografie:** `--font-ui` bekommt den System-Stack nur als Rückfall (keine SF-Dateien). Die fünf Schriftgrößen-Tokens nutzen `base.css`, `SettingsNav`, die Einstellungsseite und die Abschnittsleiste. Die übrigen 288 Zahlen in 91 Dateien ziehen nicht auf einmal um: `no-own-font-sizes.test.ts` erlaubt sie nur in diesen Dateien und nur in dieser Zahl (Muster `no-own-notices.test.ts`), jede Änderung darf sie verringern. `h1`, `h2` mit `letter-spacing: -0.01em`. |
| 2026-09-27 | G-6 | **Hilfe → Betrieb:** Zeile „Ruckeln“ mit dem Hinweis, über Remote-Desktop den Glas-Effekt abzuschalten (ADR-0029 §8). `docs/benchmarks.md` entsteht erst mit der ersten Messung (BYL-E6-102), nicht leer auf Vorrat. |

## 5. Status

| Paket | Stand |
|---|---|
| G-1 | gemergt (#88) |
| G-3 | gemergt (#90) |
| G-2 | gemergt (#91) |
| G-4 | gemergt (#93) |
| G-5 | gemergt (#95) |
| G-6 | in Arbeit |

## 6. Offene Punkte

- Manuelle Browser-Prüfungen BYL-E6-102, -105, -107, -109, -111 und -113, darin die Messung nach ADR-0029 §8.
- ~~Schalter im Kanal-Dialog als Switch (mit der Mail-Arbeit).~~ Erledigt mit dem Plan [Spalten](e6-spalten.md), Paket „Switch“ (BYL-E6-151).
- Radien in `ConnectionsSection`, `ImportKeywordsSection` und die Schriftgrößen der Liste in `no-own-font-sizes.test.ts` bei der nächsten Änderung der jeweiligen Datei auf die Tokens. Erledigt mit dem Plan [Spalten](e6-spalten.md): die vier Tabellen, `TagPicker` und `KeywordEditor` (Radien und Schriftgrößen).

## Quellen

- Apple HIG, [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Toggles](https://developer.apple.com/design/human-interface-guidelines/toggles), [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls), [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)
- `prefers-reduced-transparency`: [Chrome ab 118](https://developer.chrome.com/blog/css-prefers-reduced-transparency), [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency)
