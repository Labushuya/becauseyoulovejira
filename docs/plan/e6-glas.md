# E6-Plan, Teil Glas: Materialien im macOS-Stil, verheiratet mit den Akzent-Themes

- **Stand:** in Umsetzung (2026-09-27; G-1 gemergt). Reihenfolge G-1, G-3, G-2, G-4, G-5, G-6, je ein PR.
- **Grundlage:**
  - [ADR-0029](../adr/0029-glas-materialien.md) (Ebenen, Tokens, Kontrast, Umschaltpunkt „undurchsichtig“, Schalter, Performance)
  - [ADR-0010](../adr/0010-layout-nach-task-board.md) §3 und §4, [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) §2, [ADR-0027](../adr/0027-akzent-themes.md) §1 (je mit Nachtrag)
  - [CLAUDE.md](../../CLAUDE.md) §7, §8, §11, §12
- **Einordnung:** Nutzerwunsch „UI wie macOS, Glas-Transparenz, mit unseren Themes verheiraten“. Die Manifest-IDs laufen unter E6 ab `BYL-E6-100`. Der Block ab 100 ist für das Glas reserviert, damit parallele Arbeit (Mail-Suche) die IDs ab `BYL-E6-092` ohne Kollision nutzen kann.

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
| G-2 | Modals, Bestätigung, Seitenpanel, Flags, TagPicker-Liste, Anmeldekarte, Tour; Vollansicht opak | folgt |
| G-4 | Knöpfe, `.segmented`, `.search-field`, Radien auf Tokens | folgt |
| G-5 | Switch nach HIG, baut auf den Checkboxen und Radios aus `base.css` auf (#86) | folgt |
| G-6 | Einstellungs-Sidebar, Typografie, README, manuelle Fälle | folgt |

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
| 2026-09-27 | G-3 | **Name und Ort:** Gruppe „Transparenz“ (`fieldset`/`legend` wie „Farbschema“ und „Farbe“) mit dem Switch „Glas-Effekt“ als Zeile (Name links, Switch rechts). Die Beschreibung nennt nur Kopfzeile und Menüs; mit G-2 kommen die Dialoge dazu. |
| 2026-09-27 | G-3 | **Systemeinstellung:** `tokens.css` folgt `prefers-reduced-transparency` selbst. Der Store meldet die Media Query nur (`systemReduces`, auch bei späteren Wechseln), damit die Seite den Hinweis zeigt; der Schalter bleibt bedienbar, die Wahl gilt wieder, sobald das System die Transparenz erlaubt. Ohne `matchMedia` gilt „nicht reduziert“. |
| 2026-09-27 | G-3 | **Andere Tabs:** `ThemeMenu` verbindet den Store (es steht auf jeder Seite der App), die Seite „Darstellung“ zusätzlich; so wirkt der Schalter sofort in allen offenen Tabs, nicht nur auf der Einstellungsseite. |

## 5. Status

| Paket | Stand |
|---|---|
| G-1 | gemergt (#88) |
| G-3 | in Arbeit |
| G-2 | offen |
| G-4 | offen |
| G-5 | offen |
| G-6 | offen |

## Quellen

- Apple HIG, [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Toggles](https://developer.apple.com/design/human-interface-guidelines/toggles), [Segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls), [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)
- `prefers-reduced-transparency`: [Chrome ab 118](https://developer.chrome.com/blog/css-prefers-reduced-transparency), [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency)
