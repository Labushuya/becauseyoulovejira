# E6-Plan, Teil UI-Konsistenz: Overlay-System, Theme-Umschalter, Projekt-UI

- **Stand:** in Arbeit (2026-09-25). Die Produktfragen 1 bis 4 hat der Nutzer entschieden ([ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) §9).
- **Grundlage:**
  - [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) (Bausteine, Tokens, Theme, Projekt-UI, Entscheidungen)
  - [ADR-0009](../adr/0009-fehlerfarbe.md) (Rot nur für Fehler), [ADR-0010](../adr/0010-layout-nach-task-board.md) (Seitenaufbau, Clean-Room), [ADR-0011](../adr/0011-roadmap-e3-bis-e7.md) (E6 Feinschliff)
  - [CLAUDE.md](../../CLAUDE.md) §4, §7, §8, §11, §12
- **Einordnung:** vorgezogene E6-Themen (Vollansicht, Theme-Umschalter, Popover-Unterbau für „Spalten“), während E5 noch läuft. Die Manifest-IDs laufen unter E6 (`BYL-E6-001` ff.). Weitere E6-Themen (Papierkorb, Spalten, Tastatur, Hilfe) bekommen einen eigenen Plan.

## 1. Inventar (Ist-Zustand vor UI-1, Repo-Stand `9e99d4f`)

| Mechanismus | Anzahl | Stellen |
|---|---|---|
| Natives `<dialog>` mit `showModal()` | 8 (+1 aus E5) | `ConfirmDialog`, `ProjectDialog`, `QuickCapture`, `ClipboardImport`, `FileImportDialog`, `WhatsAppImport`, `MailboxPicker`, `BulkConvertDialog`; seit E5 Paket 4 `RecurrenceDialog` |
| Natives `popover="auto"` | 1 | `GroupPopover` (CSS Anchor, sonst mittig im Fenster) |
| Eigenes Vorschlagsfeld | 1 | `TagPicker` (absolut, `z-index: 5`, im scrollenden Panel abschneidbar) |
| Seitenpanel `.side-panel` | 4 + 2 | `TicketPanel`, `InboxPanel`, `NewTicketForm`, `CaptureForm`, zwei Stellen in `tickets/neu/+page.svelte` |
| `window.confirm` | 4 | `CommentItem`, `CaptureForm`, `NewTicketForm`, `tickets/[id]/+page.svelte` (`beforeNavigate`) |
| Bestätigung als zweiter Zustand im Dialog | 1 | `ProjectDialog` |
| „Rückgängig“ in der Zeile, 5 s | 2 | `TicketTableRow`, `InboxTable` |
| Fehlerleiste über der Tabelle | 2 | `TicketTable`, `InboxTable` |
| Erfolgsmeldung nur für Screenreader | 6 | `ProjectsView`, `TicketTable`, `InboxTable`, `ConnectionsSection`, `ImportKeywordsSection`, `MailboxPicker` |
| Native `<select>` | 9 | Filterleiste (Projekt, Tag) und Formulare |
| Theme-Umschalter | 0 | nur ein halbfertiges FOUC-Skript mit `td-theme` |

Gemeinsam ist den Dialogen: ein achtmal kopierter, hell tönender `::backdrop`, kein ×, kein Schließen per Klick daneben, keine Scroll-Sperre, keine Animation und ein lokaler `.secondary`-Stil (in insgesamt 15 Komponenten). Abweichungen: fünf Breiten (28 bis 44 rem), Kopf und Fuß scrollen in fünf Dialogen mit, zwei Verfahren der Fokus-Rückgabe, nur drei Dialoge stoppen Escape, „Abbrechen“ und „Schließen“ ohne Regel, ungespeicherte Eingaben gehen in Dialogen ohne Frage verloren.

Seitenpanels: Das ganze Panel scrollt, Kopf und Fuß bleiben nicht stehen. Escape schließt je Panel anders (`TicketPanel` nicht aus Feldern, `InboxPanel` immer, die Formulare mit `window.confirm`). Schmal deckt das Panel die Liste ab, die aber in der Tab-Reihenfolge bleibt.

Projekt-UI: Der Umschalter „Aufgaben | Projekte | Eingang“ steht in „Aufgaben“ unter Kennzahlen und Filtern, sonst ganz oben, und springt beim Wechsel. Projekte öffnen ein Modal statt eines Panels, löschen per Inline-Zustand im Modal, Radien weichen ab (sechs Werte im Code).

## 2. Querschnittsregeln für alle Pakete

- Es gelten die Regeln der Etappenpläne (Runes-Regel, Schichten nach ADR-0006, Farben nur aus `tokens.css`, deutsche Texte, Barrierefreiheit).
- **Clean-Room** ([ADR-0010](../adr/0010-layout-nach-task-board.md) §4): nur Maße und Abläufe aus Task-Board und ADS; eigene Icons, eigene Texte.
- **Bestehende Tests als Netz:** Ein Baustein kommt zuerst mit eigenen Tests; bestehende Tests laufen unverändert weiter, bis ihr Aufrufer umzieht. Jede Änderung an einem bestehenden Test wird im PR begründet.
- **Fokus, Esc und Barrierefreiheit** werden per jsdom getestet; was jsdom nicht kann (Layout, Top-Layer, `:modal`, Animation), steht als manueller Fall im Manifest.
- **Gemeinsame Stubs** aus `web/src/lib/test/overlay-stubs.ts` statt kopierter `showModal`-Attrappen; die vorhandenen Tests ziehen je Paket um.
- **Gates je Paket:** eigener Branch und PR, `scripts\build.ps1` lokal komplett grün (Exit-Code 0 und „Build complete!“), CI grün, Squash-Merge, Test-Manifest nachgezogen, Entscheidungen in §6.

## 3. Arbeitspakete

Reihenfolge nach sichtbarer Wirkung: Theme und Popover zuerst, dann Bestätigungen (weg mit `window.confirm`), dann Dialoge, Flags, Panels, Vollansicht und Projekte.

### UI-0 – ADR-0025 und dieser Plan (nur Doku)

- **Dateien:** `docs/adr/0025-ui-konsistenz-overlay-system.md`, dieser Plan, Verweis in ADR-0010, CLAUDE.md §7 und §8, README (Roadmap), Test-Manifest.
- **Akzeptanz:** Die Entscheidungen des Nutzers zu den Fragen 1 bis 4 sind eingetragen, die ADR ist „Angenommen“, das Manifest hat den Block „E6 | UI-Konsistenz“ mit den geplanten Fällen.
- **Manifest:** keine neuen Tests.

### UI-1 – Fundament: Tokens, Basisklassen, Test-Helfer

- **Dateien:** `tokens.css` (`--color-blanket`, nicht farbige Tokens, `color-scheme`), `tokens.test.ts`, `base.css` (Scroll-Sperre, `scrollbar-gutter`, Reduced-Motion-Regel, `.button-secondary`, `.button-subtle`, `.button-icon`), `web/src/lib/test/overlay-stubs.ts` (`showModal`, `close`, `showPopover`, `hidePopover`, `togglePopover`, `:popover-open`, `toggle`-Ereignis).
- **Akzeptanz:** Alle vier Token-Blöcke sind gleichnamig, keine Farbwerte außerhalb von `tokens.css`. Die neuen Klassen werden noch nicht genutzt; sichtbar ist nur `color-scheme`, durch das native Controls dem Dunkelmodus folgen.
- **Tests:** `tokens.test.ts` (neue Tokens, `color-scheme`), `color-literals.test.ts` unverändert grün, Test der Stubs.
- **Manifest:** BYL-E6-001 „Overlay-Tokens in allen Blöcken“ (unit), BYL-E6-002 „Native Controls folgen dem Modus“ (manuell).

### UI-2 – Popover-Baustein und Theme-Umschalter (erstes Sichtbares)

- **Dateien:** `overlay/Popover.svelte`, `lib/overlay/position.ts`, `GroupPopover.svelte` (auf den Baustein), `lib/theme.svelte.ts`, `components/ThemeMenu.svelte`, `AppHeader.svelte`, `app.html` (neues Boot-Skript mit Migration).
- **Akzeptanz:** „Gruppieren“ steht in allen Zielbrowsern rechtsbündig unter dem Knopf und klappt am unteren Rand nach oben. Esc und Klick außerhalb schließen, der Fokus kehrt zurück. Das Theme-Menü schaltet sofort um, die Wahl übersteht ein Neuladen ohne Aufblitzen und gilt in allen Tabs; „Wie System“ folgt der OS-Einstellung live. `td-theme` wird übernommen und gelöscht.
- **Tests:** `position.test.ts`, `popover.test.ts`, `group-popover.test.ts` (bestehende Fälle grün), `theme.test.ts`, `theme-boot.test.ts`, `theme-menu.test.ts`.
- **Manifest:** BYL-E6-003 „Popover-Positionierung“ (unit), BYL-E6-004 „Popover-Tastatur und Schließen“ (komponente), BYL-E6-005 „Theme-Umschalter“ (komponente), BYL-E6-006 „FOUC-Schutz und Migration td-theme“ (unit), BYL-E6-007 „Kein Aufblitzen beim Neuladen, Popover in Firefox“ (manuell).

### UI-3 – Modal, Bestätigung, Ende von `window.confirm`

- **Dateien:** `overlay/Modal.svelte`, `lib/overlay/close-rules.ts`, `overlay/ConfirmDialog.svelte` (ersetzt `components/ConfirmDialog.svelte`), Anpassungen in `TicketPanel`, `TagManager`, `ConnectionsSection`, `CommentItem`, `NewTicketForm`, `CaptureForm`, `tickets/[id]/+page.svelte`.
- **Akzeptanz:** Kein `window.confirm` mehr, statisch geprüft. Bestätigungen haben ×, Blanket und Animation; Esc bzw. Blanket bedeuten „Abbrechen“. Die Navigation mit ungespeichertem Text fragt über den Dialog und führt nach „Verwerfen“ zum Ziel, Zurück im Browser ebenso. Die Seite scrollt hinter dem Dialog nicht.
- **Tests:** `close-rules.test.ts`, `modal.test.ts`, `confirm-dialog.test.ts`, `no-window-confirm.test.ts`; Anpassung von `delete-ticket`, `comments`, `new-ticket`, `capture-form`, `tag-manager`, `connections-page` und `ticket-panel` (Frage über den Dialog statt `window.confirm`).
- **Manifest:** BYL-E6-008 „Modal: Schließen-Regeln“ (unit), BYL-E6-009 „Modal: Fokus, Esc, Blanket“ (komponente), BYL-E6-010 „Bestätigung statt window.confirm“ (komponente, unit), BYL-E6-011 „Verwerfen-Frage bei Navigation und Zurück“ (komponente, manuell), BYL-E6-012 „Scroll-Sperre und Animation, reduzierte Bewegung“ (manuell).

### UI-4 – Übrige Dialoge auf den Modal-Baustein

- **Dateien:** `QuickCapture` (M, `dirty` bei Text), `ClipboardImport` (M), `BulkConvertDialog` (M, `busy`; Esc = „Anhalten“ bleibt eigene Regel), `FileImportDialog`, `WhatsAppImport`, `MailboxPicker` (L), `ProjectDialog` (M, Übergang bis UI-8), `RecurrenceDialog` (M), `eingang/+layout.svelte`.
- **Akzeptanz:** drei Größen statt fünf Breiten; Kopf und Fuß stehen, der Inhalt scrollt; jeder Dialog hat ×; die Regel „Abbrechen“/„Schließen“ gilt überall; die Schnellerfassung fragt vor dem Verwerfen getippten Texts; kein `::backdrop` und kein lokales `.secondary` mehr in Komponenten (statischer Test).
- **Manifest:** BYL-E6-013 „Alle Dialoge über den Modal-Baustein“ (komponente, unit), BYL-E6-014 „Schnellerfassung fragt vor Verwerfen“ (komponente).

### UI-5 – Flags

- **Dateien:** `overlay/FlagGroup.svelte`, `stores/flags.svelte.ts`, `(app)/+layout.svelte`; Umstellung in `ProjectsView`, `TicketTable`, `TicketTableRow`, `InboxTable`, `eingang/+layout.svelte`, `ConnectionsSection`, `ImportKeywordsSection`; Undo-Fenster 8 s in `ticket-list.svelte.ts` und `inbox.svelte.ts`.
- **Akzeptanz:** Erfolgsmeldungen sichtbar unten links und angesagt; Fehler von Zeilenaktionen als Fehler-Flag; „Rückgängig“ im Flag mit Pause bei Hover, Fokus, verborgenem Tab und offenem Modal; höchstens drei Flags; der Fokus springt nie.
- **Manifest:** BYL-E6-015 „Flag-Store“ (unit), BYL-E6-016 „Flags: Anzeige und Ansage“ (komponente), BYL-E6-017 „Rückgängig im Flag“ (komponente), BYL-E6-018 „Flags mit Screenreader“ (manuell).

### UI-6 – Seitenpanel-Baustein

- **Dateien:** `overlay/Drawer.svelte`, `components/ViewWithPanel.svelte` (ersetzt die zwei 32rem-Grids und `.side-panel`), `TicketPanel` (zerlegt in `TicketFields`, `TicketDescription`, `TicketMeta`), `InboxPanel`, `NewTicketForm`, `CaptureForm`, `tickets/neu/+page.svelte`.
- **Akzeptanz:** gleicher Kopf in allen Panels, Kopf und Fuß stehen, 480 px, Slide-in nur beim ersten Öffnen und nicht bei reduzierter Bewegung, eine Esc-Regel, schmal ist die Liste `inert`, die Fokusführung zur Zeile bleibt. „Vollansicht“ erscheint erst mit UI-7 (kein toter Knopf).
- **Manifest:** BYL-E6-019 „Seitenpanel: Aufbau und Esc-Regel“ (komponente), BYL-E6-020 „Seitenpanel schmal: Liste nicht erreichbar“ (komponente, manuell).

### UI-7 – Vollansicht

- **Dateien:** `overlay/FullView.svelte`, `tickets/[id]/+layout.svelte` (Lade- und Navigationslogik), `tickets/[id]/+page.svelte` (leer), `tickets/[id]/voll/+page.svelte`, `ticket-links.ts` (`fullViewHref`), optional `eingang/[id]/voll`.
- **Akzeptanz:** „Vollansicht“ öffnet das XL-Modal (1000 px, 92 vh) mit zwei Spalten, unter 64rem einspaltig; Neuladen und Mittelklick öffnen es direkt; ×, Esc und Blanket führen zurück ins Panel mit Fokus auf „Vollansicht“; alle Felder bearbeiten wie im Panel; der Browser-Tab zeigt den Key.
- **Manifest:** BYL-E6-021 „Vollansicht öffnen und schließen“ (komponente), BYL-E6-022 „Vollansicht per Adresse“ (komponente, manuell).

### UI-8 – Projekt-UI

- **Dateien:** `ProjectsView`, `ProjectTiles`, `KpiTiles` (Radius), neu `ProjectPanel.svelte`, Routen `projekte/+layout.svelte`, `projekte/neu/+page.svelte`, `projekte/[id]/+page.svelte`, Position der `SectionBar`; `ProjectDialog.svelte` entfällt.
- **Akzeptanz:** Der Umschalter steht in allen drei Ansichten an derselben Stelle; ein Kachelklick öffnet das Projekt-Panel, „Neues Projekt“ `/projekte/neu`; Löschen über die Bestätigung mit Ticketzahl, Rückmeldungen über Flags; Radien und Abstände wie in den Tabellenansichten.
- **Manifest:** BYL-E6-023 „Projekt-Panel“ (komponente), BYL-E6-024 „Gleiche Kopfordnung in allen Ansichten“ (komponente, manuell).

### UI-9 – Filterauswahl und Tag-Picker im Popover-System

- **Dateien:** `FilterBar.svelte` (Projekt und Tag als `panel` mit Radios, Suchfeld ab 10 Einträgen), `TagPicker.svelte` (Liste im Top-Layer über `position.ts`).
- **Akzeptanz:** ein Wert je Gruppe, URL-Zustand wie heute, die Tag-Liste wird im Panel nicht mehr abgeschnitten, das Combobox-Verhalten bleibt.
- **Manifest:** BYL-E6-025 „Filterauswahl als Popover“ (komponente), BYL-E6-026 „Tag-Liste im Top-Layer“ (komponente, manuell).

Danach in E6: Popover „Spalten“ als `panel` mit Checkboxen auf demselben Baustein.

## 4. Risiken

| Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|
| Regressionen bei Fokus und Esc | Tastaturnutzer verlieren den Fokus, Esc schließt zu viel | Bausteine einzeln einführen, bestehende Tests als Netz, feste Escape-Kette (ADR-0025 §1), manuelle Fälle in Chrome, Firefox und Opera GX |
| Chromium-CloseWatcher | Zweites Esc schließt trotz `busy` bzw. `dirty` | Escape auf `keydown` abfangen, `close` zum Abgleich, Test „zweimal Esc bei busy“ |
| E5 ändert `TicketPanel` parallel | Konflikte mit UI-6 | E5-Pakete vor UI-6 mergen; `RecurrenceDialog` zieht in UI-4 um; `/wiederholungen/<id>` entsteht nach UI-6 oder zieht dort mit um |
| `beforeNavigate` mit asynchronem Dialog | Doppelte Navigation, verlorener Verlaufseintrag | Abbrechen, fragen, `goto(to.url)` mit Verwerfen-Kennzeichen; Tests für Link, „Neues Ticket“ und Zurück; manuelle Prüfung |
| Doku widerspricht dem Code | Verwirrung | UI-0 passt ADR-0010 und CLAUDE.md vorab an und nennt den Stand je Paket |
| Undo 5 s → 8 s | Store-Tests und CLAUDE.md §7 ändern sich | erst in UI-5, Fokuslogik nach verschwundener Zeile ist vorhanden |
| jsdom ohne Layout und Top-Layer | Scheinbar grüne Tests | reine Funktionen, gemeinsame Stubs, manuelle Fälle |
| Scroll-Sperre per `:has()` und `scrollbar-gutter` | Scrollbar-Spur immer reserviert | akzeptiert: kein Springen beim Öffnen |
| Clean-Room | versehentliche Übernahme | nur Maße und Abläufe, eigene Icons und Texte |

## 5. Offene Punkte

- Eine Vollansicht für Eingangseinträge (`/eingang/<id>/voll`) ist optional in UI-7.
- Die Migration von `td-theme` im Boot-Skript kann nach E7 entfallen.
- „Breite merken“ für das Seitenpanel ist eine mögliche spätere Ergänzung.

## 6. Entscheidungen

Wird je Paket ergänzt.

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-25 | UI-0 | Entscheidungen des Nutzers: (1) Seitenpanel nicht modal neben der Liste, Aufbau wie im Task-Board (480 px, fester Kopf und Fuß, Slide-in); (2) Vollansicht als XL-Modal unter `/tickets/<id>/voll`; (3) „Rückgängig“ als Flag unten links, 8 s, Pause bei Hover und Fokus; (4) Projekt-Kacheln bleiben, dazu ein Projekt-Panel statt des Dialogs im gleichen Stil. |
| 2026-09-25 | UI-0 | Festlegungen des Advisors: Pakete unter E6 (vorgezogen), Theme nur lokal unter `byl-theme` bis E7, nichts Destruktives in Rot, kein Schatten-Token, native `<select>` in Formularen bleiben, keine Projekt-Vollansicht. |
| 2026-09-25 | UI-0 | ADR-0010 wird nach der Regel in `docs/adr/README.md` nicht umgeschrieben. Es bekommt den Status „Teilweise ersetzt durch ADR-0025“ und einen Verweis am Ende; der Originaltext bleibt. |
| 2026-09-25 | UI-1 | Die XL-Höhe ist ein eigenes Token `--overlay-max-height-xl` (`92dvh`) neben `--overlay-max-height` (`calc(100dvh - 2rem)`), damit keine Komponente einen Wert selbst schreibt. `tokens.test.ts` führt die nicht farbigen Tokens (samt Schriften) als erlaubte Liste mit Werten: nur in `:root`, nie in einem Theme-Block, kein Name mit „shadow“. `color-scheme` steht als normale Eigenschaft in jedem der vier Blöcke. |
| 2026-09-25 | UI-1 | Reduzierte Bewegung: Overlays tragen das Attribut `data-overlay`. Eine Regel in `base.css` setzt dafür (samt `::backdrop` und Kindern) `animation` und `transition` mit `!important` auf `none`, weil die Animationen als gescopte Regeln der Komponenten eine höhere Spezifität haben. Die Scroll-Sperre `html:has(dialog:modal)` wirkt sofort auch für die vorhandenen nativen Dialoge; das ist gewollt. |
| 2026-09-25 | UI-1 | Knopfklassen: `.button-secondary` (Umriss `--color-line`), `.button-subtle` (ohne Rahmen, gedämpft) und `.button-icon` (2rem quadratisch) teilen Schrift, Radius `--radius-control` und den Zustand `aria-disabled="true"`. Die lokalen `.secondary` ziehen mit ihren Komponenten in UI-3 und UI-4 um. |
| 2026-09-25 | UI-1 | Stubs in `web/src/lib/test/overlay-stubs.ts`: `installOverlayStubs()` ersetzt nur, was jsdom fehlt, und gibt eine Funktion zum Wiederherstellen zurück; `useOverlayStubs()` registriert das per `beforeAll`/`afterAll`. Popover: `toggle` mit `oldState`/`newState` als einfaches `Event` (jsdom kennt kein `ToggleEvent`), `:popover-open` über ein gepatchtes `Element.prototype.matches`, nur ein Auto-Popover zugleich, ein Klick auf `button[popovertarget]` schaltet um. `close()` feuert `close` synchron wie die bisherigen Attrappen. Die vorhandenen Tests ziehen je Paket um. |
| 2026-09-25 | UI-2 | `Popover.svelte` rendert Knopf und Popover selbst (Props `kind`, `label` bzw. `labelledby`, `placement`, `buttonClass`, `buttonLabel`, Snippets `button` und `children({ close })`, optional `initialFocus`). So hält der Baustein `aria-expanded`, `aria-controls`, `popovertarget` und die Fokus-Rückgabe an einer Stelle. Aufrufer gestalten ihren Knopf über `buttonClass` und `:global()` in einem eigenen Wrapper. |
| 2026-09-25 | UI-2 | Der Fokus geht beim Öffnen immer ins Popover (gewählter bzw. erster Eintrag), auch nach einem Zeigerklick, wie beim APG-Menübutton. Die Position wird beim `toggle` berechnet; vorher setzt `beforetoggle` das Popover unsichtbar, damit es nie an der Standardstelle des Browsers aufblitzt. `resize` und `scroll` (capture, passiv) werden nur gehört, solange es offen ist. Ein Klick daneben gibt den Fokus nicht zurück (er geht dorthin, wohin geklickt wurde); Esc und eine Wahl geben ihn an den Knopf. |
| 2026-09-25 | UI-2 | jsdom stellt ein Popover als `display: none` dar und berechnet dafür keinen zugänglichen Namen (accname Schritt 2A). Die Tests prüfen den Namen von Menü und Panel deshalb am Attribut (`aria-label` bzw. Legende über `aria-labelledby`), Einträge und Optionen weiter über Rolle und Namen. |
| 2026-09-25 | UI-2 | Theme: `lib/theme.svelte.ts` mit `parsePreference`, `readPreference`, `writePreference`, `applyPreference` und `ThemeStore` (`choose`, `connect` für das `storage`-Ereignis, auch `key === null` nach `localStorage.clear()`); die App nutzt eine geteilte Instanz (`getThemeStore`), Tests eine eigene. Knopfname „Darstellung: System|Hell|Dunkel“, Menüeinträge „Hell“, „Dunkel“, „Wie System“. Das Boot-Skript steht jetzt **vor** `%sveltekit.head%` (bisher danach), als IIFE in ES5 mit `try/catch`; der leere `else`-Zweig und die Prüfung per `matchMedia` entfallen. |
| 2026-09-25 | UI-2 | „Gruppieren“: rechtsbündig (`bottom-end`) auf dem Baustein, Trennlinie nach „Keine“. Der gewählte Eintrag bleibt am Radio und am Schriftgewicht erkennbar; ein zusätzliches Häkchen wäre bei sichtbaren Radios doppelt. Das Theme-Menü hat keine Radios und zeigt deshalb Häkchen plus Schriftgewicht. |
| 2026-09-25 | UI-2 | CI: Der erste Lauf von #47 scheiterte an `recurrence-generate.test.mjs` („removes an untouched follow-up when the instance is reopened (after completion)“, E5 Paket 3), ohne Bezug zu UI-2; der zweite Lauf war grün. Das Folgeticket galt dort einmal als bearbeitet, vermutlich eine Zeitgrenze (`updated = created` bzw. `completed_at` in derselben Millisekunde). Offener Punkt für E5. |
| 2026-09-25 | UI-3 | `Modal.svelte`: Props `open`, `size`, `title`, `describedBy`, `busy`, `dirty`, `initialFocus`, `discardQuestion`/`discardText`, `onclose(reason)`, Snippets `children`, `footer({ close })` und `headerActions`. Der Inhalt wird nur gerendert, solange der Dialog offen ist; so gibt es keine doppelten Namen („Schließen“, „Abbrechen“) mit Knöpfen der Seite. Der Fokus geht an `initialFocus`, sonst an das erste Element des Inhalts, dann des Fußes, dann an das ×; beim Schließen und beim Entfernen im offenen Zustand zurück an das gemerkte Element, wenn es noch im DOM ist (nicht an `body`). Ist es weg, bleibt der Fokus beim Browser; eine Überschrift der Ansicht als Rückfall kommt mit den Panels in UI-6. |
| 2026-09-25 | UI-3 | Esc wird auf `keydown` verbraucht (`preventDefault`, `stopPropagation`); ein Esc, das ein inneres Element schon verbraucht hat (`defaultPrevented`), bleibt dort. `cancel` ist Rückfall mit denselben Regeln; schließt der Browser trotz `busy` bzw. `dirty`, zeigt `close` den Dialog wieder (bzw. stellt die Frage). Kopf und Fuß stehen über ein Flex-Layout mit scrollendem Inhalt. Kein Exit-Übergang. Die Verwerfen-Frage im Fuß nennt „Verwerfen“ als Primärknopf und gibt nach „Weiter bearbeiten“ den Fokus an das vorher fokussierte Feld zurück. |
| 2026-09-25 | UI-3 | `ConfirmDialog` zieht nach `components/overlay/` und bekommt `cancelLabel` (Standard „Abbrechen“); die API sonst wie bisher, so ändern sich in `TicketPanel`, `TagManager` und `ConnectionsSection` nur die Importe. Die Aufrufer behalten ihre eigene Fokus-Rückgabe vorerst (sie zielt auf dasselbe Element); sie entfällt mit dem Umzug der Panels. |
| 2026-09-25 | UI-3 | Rückfragen statt `window.confirm`: „Kommentar löschen?“ („Der Kommentar von … vom … wird endgültig gelöscht.“, Verb „Löschen“; ein Fehler steht weiter am Kommentar, der Dialog schließt), „Neues Ticket verwerfen?“ und „Erfassung verwerfen?“ („Die Eingaben gehen verloren.“, „Weiter bearbeiten“/„Verwerfen“; die Bestätigung liegt außerhalb des `aside`, und Tastenkürzel des Formulars ruhen, solange sie offen ist). Die Texte der bisherigen Fragen bleiben, geteilt in Titel und Beschreibung. |
| 2026-09-25 | UI-3 | Navigation mit ungespeichertem Text (`tickets/[id]/+page.svelte`): `beforeNavigate` ruft `navigation.cancel()` auf, merkt Ziel und bei `popstate` das `delta` und öffnet „Änderungen verwerfen?“. „Verwerfen“ setzt `discarding` und führt `goto(appHref(url))` aus bzw. bei Zurück/Vor `history.go(delta)`, damit der Verlauf stimmt (SvelteKit hat die Position beim Abbrechen zurückgesetzt). `discarding` wird beim Wechsel auf ein anderes Ticket derselben Route zurückgesetzt. Neuer Helfer `appHref(url)` in `ticket-links.ts`, weil `svelte/no-navigation-without-resolve` ein `goto` auf ein URL-Objekt ablehnt. |
| 2026-09-25 | UI-3 | Bewusst angepasste Tests: `delete-ticket.test.ts` erwartet, dass Esc im Dialog verbraucht wird (`keyDown` liefert `false`, vorher `true`), weil nur so Chromium bei `busy` nicht schließt; `comments`, `new-ticket`, `capture-form` und `ticket-panel` bedienen den Dialog statt `window.confirm` zu fälschen; `delete-ticket`, `tag-manager` und `connections-page` nutzen die gemeinsamen Stubs. |
| 2026-09-25 | vor UI-4 | Der CI-Ausreißer aus #47 ist behoben (eigener PR vor UI-4, Einzelheiten im [E5-Plan](e5.md) §7, „3 (Nachtrag)“): PocketBase setzt `created` und `updated` mit je eigener Uhrzeit, die sich um 1 ms unterscheiden können; der Erzeugungsdienst schreibt jetzt einen Zeitstempel in beide. Die Testdatei lief 20-mal hintereinander grün. |
| 2026-09-25 | UI-4 | Größen: M für Schnellerfassung, Zwischenablage, „Gesammelt umwandeln“, „Wiederholen…“ und Projekt, L für Datei-, WhatsApp- und Postfach-Auswahl. Die Dialoge bleiben „solange eingehängt, so lange offen“ (`<Modal open …>`), die Besitzer ändern sich nicht. Formulare stehen im Inhalt, der Absendeknopf im stehenden Fuß hängt über das `form`-Attribut daran (Enter sendet weiter ab). Die Listen der Auswahlansichten haben keine eigene Scrollfläche mehr; es scrollt nur der Inhalt des Modals. |
| 2026-09-25 | UI-4 | Regel „Abbrechen“/„Schließen“ je Dialog: Schnellerfassung „Schließen“ ab dem ersten gespeicherten Ticket bzw. Eintrag; Zwischenablage und WhatsApp nach Teilfehlern (Einträge sind gespeichert); Postfach nach der ersten Übernahme; Sammelumwandlung nach dem Lauf; Datei-Auswahl, Projekt und „Wiederholen…“ immer „Abbrechen“. Das × heißt überall „Schließen“; wo auch der Fuß so heißt, gibt es zwei Knöpfe mit gleichem Namen und gleicher Wirkung (Tests greifen auf den zweiten zu). |
| 2026-09-25 | UI-4 | `Modal.svelte` bekommt `onbusyescape`: Esc während `busy` ruft die eigene Regel des Besitzers statt nichts zu tun. Nur „Gesammelt umwandeln“ nutzt sie („Nach diesem Eintrag anhalten“); ×, Blanket und Schließen bleiben während des Laufs gesperrt, auch beim zweiten Esc. Der Projekt-Dialog braucht keine Erweiterung: `onclose(reason)` meldet den Weg, und Esc aus der Löschfrage führt zurück ins Formular, während × schließt. |
| 2026-09-25 | UI-4 | `dirty` nur in der Schnellerfassung (Text ohne Leerzeichen), mit „Der getippte Text geht verloren.“; der Link „Ticket ansehen“ schließt weiter ohne Frage (nach dem Speichern ist das Feld leer). Zwischenablage, Auswahlansichten, Projekt und „Wiederholen…“ bekommen bewusst kein `dirty`: Ihr Inhalt stammt aus einer Quelle bzw. ist mit einem Klick wieder da, und das Projekt zieht mit UI-8 in ein Panel. |
| 2026-09-25 | UI-4 | Fokus-Rückgabe nur noch im Baustein: Die Dialoge merken sich kein `activeElement` mehr, `eingang/+layout.svelte` fokussiert „Gesammelt umwandeln“ nicht mehr selbst, `BULK_BUTTON_ID` entfällt. `ProjectsView` (Rückfall auf die Überschrift, wenn die Kachel fehlt) und `RecurrenceSummary` (nach „Wiederholen…“ auf „Regel bearbeiten“, weil der Auslöser verschwindet) behalten ihre Rückfälle bis UI-6 bzw. UI-8. |
| 2026-09-25 | UI-4 | Knopfklassen: Alle 15 lokalen `.secondary` (auch in `CaptureForm`, `NewTicketForm`, `InboxPanel`, `ChannelsView`, `ConnectionsSection`, `ImportKeywordsSection`, `KeywordEditor`) sind `.button-secondary`. `base.css` kennt dafür zusätzlich `:disabled` und für `.button-primary` den Zustand `aria-disabled`; Primärknöpfe im Fuß eines Modals haben die Größe der sekundären (Regel im Baustein statt `.small` bzw. `.confirm-button`). Der statische Test `no-own-dialogs.test.ts` prüft: kein `<dialog>`, `showModal` oder `::backdrop` außerhalb von `Modal.svelte`, die Größe jedes Dialogs, kein lokales `.secondary`, `aria-label` an jedem `.button-icon`. |
| 2026-09-25 | UI-4 | Bewusst angepasste Tests: `quick-capture` (Zwischenablage nach Teilfehlern: der Fußknopf „Schließen“ ist der zweite dieses Namens; „closes with Escape and with ‚Schließen‘“ heißt jetzt „closes with Escape, × and ‚Abbrechen‘ while nothing is typed“, weil der Fuß vor dem ersten Speichern „Abbrechen“ heißt) und `bulk-convert-dialog` (dasselbe für „Schließen“ nach dem Lauf). Alle Dialogtests und `app-layout` nutzen die gemeinsamen Stubs. |

## 7. Status

| Paket | Stand |
|---|---|
| UI-0 | gemergt (#45) |
| UI-1 | gemergt (#46) |
| UI-2 | gemergt (#47) |
| UI-3 | gemergt (#48) |
| UI-4 | in Arbeit |
| UI-5 bis UI-9 | geplant |

## Quellen (nur Verhalten und Maße)

- Atlassian Design System: [Modal dialog](https://atlassian.design/components/modal-dialog/usage), [Popup](https://atlassian.design/components/popup/usage), [Dropdown menu](https://atlassian.design/components/dropdown-menu/usage), [Drawer](https://atlassian.design/components/drawer/usage), [Blanket](https://atlassian.design/components/blanket/usage), [Flag](https://atlassian.design/components/flag/usage)
- [Forge UI Kit Modal (Größen)](https://developer.atlassian.com/platform/forge/ui-kit/components/modal/)
- [Jira Cloud: View content in a side panel](https://support.atlassian.com/jira-software-cloud/docs/view-content-in-a-side-panel/)
