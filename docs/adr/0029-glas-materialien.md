# ADR-0029: Glas-Materialien im macOS-Stil (löst die Glas-, Verlaufs- und Schatten-Regel aus ADR-0010 §3, ADR-0025 §2 und ADR-0027 §1 ab)

- **Status:** Angenommen und umgesetzt in den Paketen G-1 bis G-6 (Reihenfolge G-1, G-3, G-2, G-4, G-5, G-6; #88, #90, #91, #93, #95 und der PR von G-6); manuelle Browser-Prüfungen und die Messung nach §8 stehen im Test-Manifest
- **Datum:** 2026-09-27
- **Entscheidung durch:** Nutzer („UI wie macOS, Glas-Transparenz, mit unseren Themes verheiraten“; Glas nur in der Bedienebene, Transparenz standardmäßig an mit Schalter, die Systemeinstellung gewinnt, Inter bleibt; 2026-09-27), Advisor (Ebenen, Regeln, Pakete), Executor (Werte, Kontrastrechnung, Fokusring)
- **Ersetzt teilweise:** [ADR-0010](0010-layout-nach-task-board.md) §3 (Punkt „Keine Glas-Optik, keine Farbverläufe, keine Schlagschatten“), [ADR-0025](0025-ui-konsistenz-overlay-system.md) §2 („Kein Schatten-Token“), [ADR-0027](0027-akzent-themes.md) §1 (Aufzählung „keine Verläufe, keine Glas-Optik, keine Schatten“). Alle übrigen Regeln dieser ADRs bleiben. Die drei ADRs tragen dazu je einen Nachtrag.

## Kontext

Der Nutzer mag die Glas-Optik seines Task-Boards und die eigenen Akzent-Themes (Petrol, Rubin, Smaragd, Kupfer). ADR-0010 hatte Glas, Verläufe und Schatten ausgeschlossen, weil sie im Vorbild mit Signalfarben, Firmenbezügen und CDN-Code einhergingen. Diese Gründe betreffen nicht das Material selbst.

Die Apple Human Interface Guidelines trennen eine gläserne Bedienebene („a distinct functional layer for controls and navigation elements … that floats above the content layer“) von einer undurchsichtigen Inhaltsebene („Don't use Liquid Glass in the content layer“). Genau das erhält die Lesbarkeit der Tabellen.

## Entscheidung

### 1. Zwei Ebenen

- **Glas nur in der Bedienebene:** Kopfzeile, Seitenpanel, Einstellungsnavigation, Popover und Menüs (auch die Vorschlagsliste des TagPicker), Modals S bis L samt Bestätigung, Flags, Karte der Anmeldung, Tour-Popover.
- **Undurchsichtig bleiben** Tabellen, Kacheln, Karten, Formulare, Texte, die Vollansicht, die Hinweis-Bausteine, Status-Pillen und das Blanket (ein reiner Farbschleier ohne Blur).
- **Kein Glas im Glas:** Controls auf Glas bekommen halbtransparente Füllungen, nie einen eigenen `backdrop-filter`.
- `backdrop-filter` steht nur in einer festen Liste von Dateien und nur als `var(--glass-filter-…)` (`glass-allowlist.test.ts`). Kopfzeile und Seitenpanel haben keine Nachfahren mit `position: fixed` (ein `backdrop-filter` wäre deren Containing Block); Popover und Dialoge liegen im Top-Layer und sind davon nicht betroffen.

### 2. Tokens

Alle Werte stehen in `web/src/lib/styles/tokens.css`. Neue Tokens entstehen mit dem Paket, das sie zuerst nutzt (CLAUDE.md §10: nichts auf Vorrat).

- **Neutral, in allen vier Modus-Blöcken, nicht in den Theme-Blöcken:**
  - `--material-regular` (Deckkraft 0,82) und `--material-thick` (0,92) auf Basis von `--color-surface`
  - `--color-separator` (Trennlinien auf Glas) und `--glass-edge` (1-px-Lichtkante oben innen)
  - Füllungen `--fill-control` und `--fill-control-hover` (ab G-4)
  - Schatten `--shadow-control`, `--shadow-popover` und `--shadow-modal`
- **Nur in `:root`:** `--glass-filter-regular` (`blur(24px) saturate(140%)`), `--glass-filter-thick` (`blur(30px) saturate(140%)`), Radien `--radius-item` und `--radius-overlay` (ab G-4 dazu `--radius-pill` und `--radius-surface` 0.625rem), Höhen der Controls und Schriftgrößen (ab G-4 bzw. G-6).
- **Keine neuen Akzent-Tokens:** Die Liste aus ADR-0027 §2 bleibt unverändert. Glas, Füllungen und Schatten sind in allen Themes gleich; der Verlauf nutzt die vorhandene Akzentfläche. Geprüft am Stand mit vier Themes (Nachtrag zu ADR-0027 vom 2026-09-27).
- Kein `brightness()` im Filter, `saturate()` höchstens 150 %: beides verschiebt die Kontrastrechnung; `saturate()` ist eine feste Farbmatrix und wird im Test nachgerechnet.

### 3. Hintergrund

Zwei radiale Verläufe aus `--color-brand-soft-bg` zu `--color-bg` auf einer fixierten Ebene `body::before` (kein `background-attachment: fixed`, das bei jedem Scrollschritt neu malt). Keine neue Farbe; der Verlauf folgt jedem Theme. Der Verlauf steht nur in `base.css`; die Fallbacks schalten ihn über `--backdrop-image: none` ab.

### 4. Schatten

Erlaubt, aber nur über die drei Schatten-Tokens, nur neutral (nie in der Akzentfarbe) und immer zusammen mit einer 1-px-Linie. Die Markierung `inset 3px 0 0 var(--color-brand)` gewählter Zeilen ist kein Schatten und bleibt als benannte Ausnahme.

### 5. Kontrast auf Glas

- **Mindest-Deckkraft 0,82** für jedes Material mit Text.
- `glass-contrast.test.ts` rechnet für **jedes Theme aus `ACCENT_THEMES` × jeden der vier Modus-Blöcke × jedes Material** den effektiven Hintergrund `α · Material + (1 − α) · saturate(B)` gegen **jede** Farbe der Palette als Hintergrund B:
  - `thick`: B wirkt voll (ein Menü über einem Primärknopf oder einer dunklen Pille).
  - `regular`: B wird zuerst 50 : 50 mit `--color-bg` gemischt (Blur-Modell). `regular` ist deshalb nur dort erlaubt, wo darunter der Verlauf oder die Tabellenflächen scrollen (Kopfzeile, eingebettetes Panel, Einstellungsnavigation).
  - Anforderung: `--color-text`, `--color-text-muted`, `--color-brand-text` und `--color-danger` mindestens 4,5 : 1.
- **Fokusring in `--color-brand-text`:** Die Rechnung zeigt, dass `--color-brand` im Dunkelmodus auf Glas (Petrol, Rubin, Smaragd 2,4 bis 2,9 : 1) und auf dem Verlauf (2,7 bis 3,0 : 1) die 3 : 1 nicht sicher hält. `--color-brand-text` erreicht dort überall mindestens 4,5 : 1 und ist schon ein Akzent-Token. Deshalb ist der Fokusring (`:focus-visible` und alle lokalen Ringe) ab G-1 `2px solid var(--color-brand-text)`; in Rubin, Smaragd und Kupfer hell ist das derselbe Wert wie bisher. Rahmen, die auf Glas oder dem Verlauf einen Zustand mit 3 : 1 tragen, nutzen ebenfalls `--color-brand-text`; `--color-brand` bleibt Füllung (mit `--color-on-brand` darauf) und Markierung auf undurchsichtigen Flächen.
- **Menüzeilen** färben sich bei Hover und Tastaturfokus in `--color-brand` mit `--color-on-brand` (macOS). Der Fokusring bleibt zusätzlich, weil die Füllung im Dunkelmodus gegen Glas nicht sicher 3 : 1 erreicht.
- **Verlauf:** Was bisher auf `--color-bg` geprüft war, prüft der Test zusätzlich auf `--color-brand-soft-bg` (Text 4,5 : 1).

### 6. Fallbacks: ein Umschaltpunkt „undurchsichtig“

Ein einziger Satz von Deklarationen in `tokens.css` setzt die Materialien auf `var(--color-surface)`, die Filter auf `none` und den Verlauf aus. Die Komponenten merken davon nichts. Er greift bei:

| Auslöser | Block |
|---|---|
| Schalter „Transparenz“ aus (ab G-3) | `:root[data-transparency='off']` |
| `prefers-reduced-transparency: reduce` | Media Query; die Systemeinstellung gewinnt immer, ein „Transparenz erzwingen“ gibt es nicht |
| `prefers-contrast: more` | Media Query; zusätzlich Trennlinien in `--color-text-muted` und keine Schatten |
| `forced-colors: active` | Media Query; die Flächen müssen deckend sein, weil der Browser den Alphakanal erhält |
| fehlendes `backdrop-filter` | `@supports not (backdrop-filter: blur(1px))`; halbtransparent ohne Blur wäre zu unruhig |

Die Deklarationen tragen `!important`, weil die Modus-Blöcke mit höherer Spezifität (`:root:not([data-theme='light'])`, `:root[data-theme='dark']`) sonst gewännen. `tokens.test.ts` prüft, dass jeder Block vollständig ist.

### 7. Schalter „Transparenz“ (G-3)

Unter „Einstellungen → Darstellung“, standardmäßig an. `localStorage` `byl-transparency`, gespeichert wird nur `off`. Das Boot-Skript in `app.html` setzt `data-transparency` vor dem ersten Rendern in einem eigenen `try` (Muster `byl-accent`), ein `storage`-Listener gleicht andere Tabs ab.

### 8. Performance

- Keine Vollflächen mit Blur (Blanket, Vollansicht, `body`), höchstens drei Glasebenen gleichzeitig im Normalfall (Kopfzeile, Panel, eine Überlagerung), kein Glas auf vielen kleinen Elementen, kein Glas auf animierter Größe, Blur höchstens 30px.
- Jeder PR, der Glas einführt, nennt die Messung (Chrome DevTools, 200 Tickets, Panel offen, 10 s scrollen; Ziel ≥ 55 fps, keine Frames über 50 ms). Kann der Agent nicht messen (kein Browser auf dem Entwicklungsrechner, CLAUDE.md §11), steht die Messung als manueller Fall im Test-Manifest. Wird das Ziel verfehlt, sinkt zuerst der Blur der Kopfzeile; hilft das nicht, bleibt sie undurchsichtig.
- Hinweis in der Hilfe: „Ruckelt die Oberfläche, etwa über Remote-Desktop, schalte unter Darstellung die Transparenz aus.“

### 9. Steuerelemente im macOS-Stil

Als gemeinsame Klassen in `base.css`, keine lokalen Kopien: Knöpfe mit einheitlichen Höhen, `.segmented`, `.search-field` (G-4), `.switch` (G-3 bzw. G-5). Checkboxen und Radios zeichnet `base.css` bereits einheitlich (`no-own-controls.test.ts`); G-5 baut darauf auf und legt nichts doppelt an.

### 10. Keine Apple-Assets, keine SF-Schriften

Inter bleibt, der System-Stack ist nur Fallback. Die Clean-Room-Regel aus ADR-0010 §4 gilt auch gegenüber Apple: nur Muster, keine Assets.

## Alternativen

- **Glas überall wie im Task-Board** (auch Kacheln und Tabellenrahmen): verworfen wegen der Lesbarkeit der Tabellen, der HIG und der Kosten. Nutzerentscheidung: nur die Bedienebene.
- **Nur die Kopfzeile:** zu wenig macOS, verworfen.
- **`color-mix()` für die Materialien:** verworfen, weil die Werte nicht mehr lesbar in `tokens.css` stünden.
- **Glas standardmäßig aus:** verworfen (Nutzerentscheidung: an, mit Schalter).
- **Fokusring in `--color-brand` behalten und die Deckkraft anheben:** hülfe nur auf Glas, nicht auf dem Verlauf, und machte das Glas fast undurchsichtig. Verworfen zugunsten von `--color-brand-text`.
- **Eigene Akzent-Tokens für Glas:** nicht nötig (§2), verworfen.

## Konsequenzen

- `base-css.test.ts` („keine Schatten, Verläufe, Glas“) und `tokens.test.ts` („kein Schatten-Token“) werden durch positive Regeln ersetzt: Schatten nur als `var(--shadow-*)` oder die benannte `inset`-Markierung, Verläufe nur in `body::before`, `backdrop-filter` nur mit `var(--glass-filter-…)` in der Allowlist.
- Der Fokusring wechselt von `--color-brand` auf `--color-brand-text` (CLAUDE.md §8, Tabelle).
- Ein manueller Fall je Theme × Modus × Transparenz an und aus kommt ins Test-Manifest, dazu die Emulation der Systemeinstellungen und das Windows-Kontrastdesign.
- `backdrop-filter` kostet GPU-Zeit; auf Rechnern ohne Beschleunigung hilft der Schalter.

## Nachtrag (2026-09-27): Umsetzung des Schalters (G-3)

Präzisiert §7 und §9, ohne sie aufzuheben:

- Der Schalter ist der Switch „Glas-Effekt“ in der Gruppe „Transparenz“ unter „Einstellungen → Darstellung“. Der Store heißt `TransparencyStore` (`lib/transparency.svelte.ts`); er meldet zusätzlich die Systemeinstellung, damit die Seite einen Hinweis zeigen kann.
- Der Switch wird in `base.css` über `input[type='checkbox'][role='switch']` gestaltet, nicht über eine Klasse `.switch`: Lokale Klassen dieses Namens sitzen auf Labels und würden sonst mitgestaltet. Er baut auf den gemeinsamen Checkbox-Regeln auf.
- Einzelheiten und Gründe stehen im [Glas-Plan](../plan/e6-glas.md) §4.

## Nachtrag (2026-09-27): Abschluss (G-4 bis G-6)

Präzisiert §2, §9 und §10, ohne sie aufzuheben:

- **Radien und Schriftgrößen:** `border-radius` nur noch als `var(--radius-*)`, `0`, `50%` oder `inherit` (`no-own-radii.test.ts`). Die Schriftgrößen `--font-size-caption|small|control|body|title` nutzen `base.css`, Einstellungsnavigation, Einstellungsseite und Abschnittsleiste. Die übrigen Dateien stehen mit ihren Zahlen auf einer Liste, die nur schrumpfen darf (`no-own-font-sizes.test.ts`).
- **Steuerelemente:** `.segmented` und `.search-field` sind gemeinsame Klassen. Einzeleinstellungen der Leisten sind Switches, Listen und Auswahl bleiben Checkboxen. Die Schalter im Kanal-Dialog folgen mit der Mail-Arbeit.
- **Einstellungsnavigation:** ab 64rem eine schwebende Karte aus `--material-regular`, schmaler eine Linkzeile ohne Glas.
- **Schrift:** Inter bleibt; `--font-ui` nennt `system-ui`, `-apple-system`, `BlinkMacSystemFont`, Segoe UI nur als Rückfall. Überschriften `h1`, `h2` mit `letter-spacing: -0.01em`.
- Die Performance-Messung aus §8 ist ein manueller Fall (BYL-E6-102). `docs/benchmarks.md` entsteht mit der ersten Messung.

## Nachtrag (2026-09-28): Sammel-Aktionsleiste (ADR-0036)

Ergänzt §1 um einen Baustein der Bedienebene: Die Leiste der Sammelaktionen über der Tabelle „Aufgaben“ (`BulkActionBar.svelte`, [ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §3) ist Glas mit `--material-thick`, `--glass-filter-thick`, Linie `--color-separator`, `--radius-overlay` und `--shadow-popover`. Sie steht `sticky` (nicht `fixed`) über der Tabelle, die darunter scrollt; darum thick. Sie ist die zehnte Datei der Allowlist von `glass-allowlist.test.ts`. Die Ergebnisliste darin ist Text auf dem Material, Fehler mit Icon und Text (ADR-0009).

## Nachtrag (2026-09-28): gemeinsame Auswahlleiste (ADR-0037)

Seit dem Papierkorb (PB-2, [ADR-0037](0037-papierkorb.md) §9) haben zwei Tabellen eine Auswahl mit Aktionen. Das Glas der Leiste steht darum im gemeinsamen Baustein `SelectionBar.svelte` (Zahl, Fortschritt, „Auswahl aufheben“, Platz für Ergebnis und Aktionen); `BulkActionBar.svelte` („Aufgaben“) und `TrashView.svelte` („Papierkorb“) setzen nur ihre Knöpfe hinein. In der Allowlist steht `SelectionBar.svelte` an der Stelle von `BulkActionBar.svelte`; die Zahl der Dateien bleibt zehn, Material, Linie, Radius und Schatten bleiben wie oben.
