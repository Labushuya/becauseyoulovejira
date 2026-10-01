# Plan „Aktionsmenüs“

- **Stand:** AM-1 umgesetzt (2026-10-01, #194, nur Oberfläche: Build, dann F5; kein Neustart). AM-2 umgesetzt (2026-10-01, #195, nur Oberfläche: Build, dann F5; kein Neustart). AM-3 umgesetzt (2026-10-01, #196, nur Oberfläche: Build, dann F5; kein Neustart). AM-4 umgesetzt (2026-10-01, #197, nur Oberfläche: Build, dann F5; kein Neustart). AM-5 umgesetzt (2026-10-01, Branch `feat/menu-additions`, nur Oberfläche: Build, dann F5; kein Neustart). Offen sind die manuellen Browser-Prüfungen BYL-E6-742, BYL-E6-746, BYL-E6-764, BYL-E6-770 und BYL-E6-783; von den Folgepunkten in §6.6 bleiben nur die zwei bewusst nicht umgesetzten.
- **Grundlage:** Nutzerentscheidung vom 2026-10-01 auf die Frage, ob es in der Tabelle ein Zeilenmenü „•••“ (Öffnen, Duplizieren, Löschen) geben soll oder der Knopf im Ticket reicht: „beides, aber vorrangig für das Ticket selbst“. Vorgaben des Advisors: Reihenfolge AM-1 (Ticket) vor AM-2 (Tabelle), Einträge, Kopf entschlacken wie in Jira, keine Funktion verloren, Tests für Maus und Tastatur, Doku. Für AM-3 und AM-4 die Nutzerentscheidung vom 2026-10-01 zu den Folgepunkten in §4: „Alle Verbesserungen einpflegen“. Für AM-5 die Nutzerentscheidung vom 2026-10-01 zu den Folgepunkten in §6.6: „Mögliche Ergänzungen umsetzen“; die Hauptquelle eines Tickets bleibt dabei unveränderlich ([ADR-0031](../adr/0031-herkunft-sichern.md), Nachtrag A).
- **Entscheidungen:** Nachtrag in [ADR-0045](../adr/0045-ticket-duplizieren.md) (Einstieg über das Menü), Nachträge in [ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) (Kopf von Panel und Vollansicht; Zeilenmenü; Rechtsklick und Sammel-Leiste; Zeilenmenüs der übrigen Tabellen; Ergänzungen in Eingang und Kacheln), Nachträge 4 und 5 in [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md) (Breite der Spalten „Aktionen“), Nachtrag in [ADR-0037](../adr/0037-papierkorb.md) (Zeile des Papierkorbs), Nachtrag G in [ADR-0031](../adr/0031-herkunft-sichern.md) (Quellen im Zeilenmenü des Eingangs). Das Menü selbst folgt [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) §5 (Popover der Art `menu`, „später Aktionsmenüs“), seit AM-3 mit virtuellem Anker.
- **Einordnung:** Manifest-Block „Aktionsmenüs“ ab `BYL-E6-740`, AM-3 und AM-4 ab `BYL-E6-760`, AM-5 ab `BYL-E6-780`. Keine Migration, keine Hooks.

## 1. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| AM-1 | Menü „•••“ im Kopf von Panel und Vollansicht: „Link kopieren“, „Duplizieren …“, „In den Papierkorb …“; der Kopf behält als Symbole nur „Vollansicht“ bzw. „Im Seitenpanel öffnen“ und ×; gemeinsamer Baustein `ActionsMenu` (auch für die Kanal-Karten) | umgesetzt |
| AM-2 | Zeilenmenü „•••“ in der Spalte „Aktionen“ der Tabelle „Aufgaben“ nach „Öffnen“: „Im Seitenpanel öffnen“, „In Vollansicht öffnen“, „Link kopieren“, „Duplizieren …“, „In den Papierkorb …“; Spalte „Aktionen“ 5,5 statt 4rem | umgesetzt |
| AM-3 | Sammel-Leiste „In den Papierkorb …“ statt „Löschen …“; Rechtsklick auf eine Zeile von „Aufgaben“ öffnet das Zeilenmenü am Mauszeiger, Umschalt+F10 und die Kontextmenü-Taste am fokussierten Element; Regeln für das Menü des Browsers | umgesetzt |
| AM-4 | Zeilenmenüs mit Rechtsklick auch in „Papierkorb“, „Eingang“, „Projekte“ und „Wiederholungen“, nur mit vorhandenen Aktionen; Spalten nach ADR-0030 | umgesetzt |
| AM-5 | Folgepunkte aus §6.6: im Zeilenmenü des Eingangs „Link der Quelle öffnen“, „Anderem Ticket zuordnen …“, „Lösen“ (nie die Hauptquelle) und „Seiteninhalt sichern“; Menü „•••“ mit Rechtsklick und Tastatur auf jeder Projektkachel | umgesetzt |

## 2. AM-1: Menü im Ticket

### 2.1 Baustein

- **`ActionsMenu`** (`components/ActionsMenu.svelte`): der Knopf „•••“ (`.button-icon`, drei Punkte als Inline-SVG, `aria-label`, optional `title`) und ein `Popover` der Art `menu` nach ADR-0025 §5 und dem APG-Muster „Menu Button“: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`, das Menü mit Namen; Pfeiltasten mit Umlauf, Pos1 und Ende, Enter und Leertaste führen aus, Esc und Tab schließen, Fokus zurück auf den Knopf. Einträge sind `menuitem` (Knopf oder Link, `tabindex="-1"`), `aria-haspopup="dialog"` bei Einträgen, die einen Dialog öffnen, `aria-disabled` bzw. `aria-busy` für gesperrte bzw. laufende, eine Trennlinie (`role="separator"`) vor einem Eintrag mit `separated`. Ein Eintrag schließt das Menü, bevor er läuft; so liegt der Fokus auf dem Knopf, und ein Dialog gibt ihn beim Schließen dorthin zurück. Der Knopf ist bindbar (`trigger`, neu am `Popover`), für die eingebetteten Fragen der Vollansicht.
- **Kanal-Karten:** `ChannelCard` nutzt denselben Baustein (vorher eine gleichwertige Kopie im Kartenbaustein); `CardAction` erweitert `MenuAction` um `inPlace` für den Hauptknopf. DOM, Namen und Verhalten der Karten bleiben gleich (`channel-card.test.ts`, `channel-cards-inventory.test.ts`).
- **`TicketActions`** (`components/TicketActions.svelte`): die Einträge eines Tickets auf `ActionsMenu`, Knopf „Weitere Aktionen“ (Name und `title`), Menü „Weitere Aktionen für HAUS-12“.

### 2.2 Einträge

| Eintrag | wann | Wirkung |
|---|---|---|
| „Link kopieren“ | immer | `copyTicketLink` (`lib/copy-link.ts`): die Adresse `ticketShareUrl` (absolut, `/tickets/<id>` ohne Zustand der Liste, öffnet das Panel in jedem Tab) über `writeClipboardText`; Flag „Link kopiert“ (Erfolg, „Der Link zu HAUS-12 liegt in der Zwischenablage.“). Verweigert der Browser die Zwischenablage: Fehler-Flag „Link konnte nicht kopiert werden.“ mit dem Link im Text zum Abschreiben (ein echter Fehler der Aktion, ADR-0009). |
| „Duplizieren …“ | nur mit dem `TicketDuplicateStore` des `(app)`-Layouts | Panel: `DuplicateDialog` als Modal M; Vollansicht: derselbe Inhalt eingebettet oben im Inhalt (ADR-0025 Nachtrag 16) |
| „In den Papierkorb …“ (Trennlinie davor) | immer | Panel: `TicketDelete` (`ConfirmDialog` „HAUS-12 in den Papierkorb verschieben?“ mit Quellen-Wahl, danach Flag mit „Rückgängig“); Vollansicht: `TicketDeleteQuestion` eingebettet oben im Inhalt |

- **Text** „In den Papierkorb …“ statt „Löschen …“: So heißt die Aktion seit ADR-0037 in Frage („… in den Papierkorb verschieben?“), Knopf („In den Papierkorb“) und Flag („… in den Papierkorb verschoben.“); der Eintrag sagt jetzt dasselbe. Die Sammel-Leiste behält „Löschen …“ (siehe §4).
- **Vollansicht:** Die Einträge melden dort keinen Dialog (`aria-haspopup` fehlt), weil sie eine Frage im Inhalt aufklappen; „Duplizieren …“ und „In den Papierkorb …“ schließen einander wie bisher. Esc schließt nur die Frage, die Vollansicht bleibt, der Fokus kehrt zu „•••“ zurück (`returnFocus` bzw. `cancelDelete`).
- **Panel:** `TicketPanel` hält, welcher Dialog für welches Ticket gewählt ist (ein Wechsel des Tickets verwirft ihn), und rendert ihn neben dem Menü; das Snippet `duplicate` liefert seit AM-1 den Dialog (mit `close`), nicht mehr den Knopf. `TicketDelete` ist nur noch die Bestätigung (mit `remove` statt des Stores, damit AM-2 sie für Zeilen nutzen kann); `TicketDuplicate` (der Symbolknopf) entfällt.

### 2.3 Kopf entschlackt

| vorher (Panel) | vorher (Vollansicht) | jetzt (beide) |
|---|---|---|
| „Duplizieren …“ (Symbol), „Löschen …“ (Text), „Vollansicht öffnen“, × | „Duplizieren …“ (Symbol, `aria-expanded`), „Löschen …“ (Text, `aria-expanded`), „Im Seitenpanel öffnen“, × | „•••“ „Weitere Aktionen“, „Vollansicht öffnen“ bzw. „Im Seitenpanel öffnen“, × |

- **Begründung:** Wie in Jira stehen im Kopf nur häufige, an ihren Platz gebundene Aktionen als Symbole: der Wechsel zwischen Panel und Vollansicht (gemerkter Modus, ADR-0036 §1) und das Schließen. Duplizieren, Link und Papierkorb sind seltener; im Menü haben sie einen lesbaren Text statt eines Symbols (zwei Blätter), und der schmale Kopf des Panels (480 px) hat Platz für einen langen Pfad. Ein Klick mehr als vorher für Duplizieren und Löschen; dafür ein Ort für alle Aktionen des Tickets, derselbe in der Tabelle (AM-2).
- **„Wiederholen …“ und „Regel bearbeiten …“ bleiben im Abschnitt „Wiederholung“ und kommen nicht zusätzlich ins Menü:** Sie gehören zum Zustand, den der Abschnitt zeigt („Wiederholt sich: …“, Pausieren, Aus der Serie lösen, Vorlage), und in der Vollansicht klappen sie ihr Formular genau dort auf (ADR-0025 Nachtrag 16). Ein zweiter Einstieg im Menü müsste den Abschnitt aus dem Kopf heraus öffnen, im Panel dorthin scrollen und in der Vollansicht die rechte Spalte bedienen, ohne dass ein Weg fehlt; er brächte nur einen zweiten Ort für dieselbe Handlung.
- **Keine Funktion geht verloren:** Jede Aktion des alten Kopfs ist im Menü (Maus und Tastatur), die Fragen und Dialoge sind dieselben (`delete-ticket.test.ts`, `ticket-duplicate.test.ts`, `ticket-panel.test.ts`).

### 2.4 Tests

- `components/ticket-actions.test.ts`: Knopf mit Name, `title`, `aria-haspopup`, `aria-expanded`; Menü mit Namen; Einträge in Reihenfolge mit Trennlinie, `aria-haspopup="dialog"` nur im Panel, ohne Store kein „Duplizieren …“; Tastatur (erster Eintrag, Pfeile mit Umlauf, Pos1, Ende, Esc mit Fokus zurück); ein Eintrag schließt das Menü vor seiner Aktion; „Link kopieren“ mit Flag und die Ablehnung der Zwischenablage.
- `components/delete-ticket.test.ts` (aus dem Menü, Fokus zurück auf „•••“), `components/ticket-panel.test.ts` (Kopf nur mit „•••“, „Vollansicht öffnen“ und ×; „Duplizieren …“ aus dem Menü im Panel mit Fokus zurück; Vollansicht: Kopf mit „•••“, „Im Seitenpanel öffnen“, ×, „In den Papierkorb …“ und „Duplizieren …“ eingebettet, schließen einander, Esc, Fokus zurück), `components/ticket-duplicate.test.ts` (Abfrage ohne den alten Knopf), `components/channels/*` (Karten auf dem gemeinsamen Baustein), Hilfe (`help-page.test.ts`).
- Manuell BYL-E6-742: Browser, Tastatur und NVDA.

## 3. AM-2: Zeilenmenü in der Tabelle

### 3.1 Einstieg und Einträge

- **Ort:** „•••“ am Ende der Spalte „Aktionen“ jeder Zeile von „Aufgaben“, nach dem Häkchen und „Öffnen“ (das Symbol bleibt, nur für die Maus wie bisher). Derselbe Baustein `TicketActions` wie im Kopf, mit `open`; der Knopf heißt „Weitere Aktionen für HAUS-12“ (jede Zeile hat einen, `title` „Weitere Aktionen“), das Menü ebenso. In Gruppen, im Abschnitt „Erledigt“ und bei Unteraufgaben steht er gleich.

| Eintrag | Wirkung |
|---|---|
| „Im Seitenpanel öffnen“ | Link auf `/tickets/<id>` mit dem Zustand der Liste |
| „In Vollansicht öffnen“ | Link auf `/tickets/<id>/voll` mit dem Zustand der Liste |
| „Link kopieren“ (Linie davor) | wie im Ticket (`copyTicketLink`, Flag „Link kopiert“) |
| „Duplizieren …“ | nur mit `TicketDuplicateStore`: `DuplicateDialog` als Modal M, danach öffnet sich das Duplikat im gemerkten Modus |
| „In den Papierkorb …“ (Linie davor) | `TicketDelete` als Bestätigung mit Quellen-Wahl, danach Flag mit „Rückgängig“; ist das Ticket im Panel offen, schließt sich das Panel |

- **Gemerkter Modus:** Die zwei Links öffnen unabhängig vom gemerkten Modus und merken nichts; nur die Knöpfe im Ticket setzen ihn ([ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §1). Begründung: Der Modus ist eine Vorliebe, die der Nutzer im Ticket ausdrücklich wählt; ein Eintrag im Zeilenmenü ist ein einmaliger anderer Weg („diesmal groß“), wie ein Mittelklick. Würde er merken, stellte ein Ausflug in die Vollansicht still alle Zeilen um. Strg-, Umschalt- und Mittelklick öffnen die Links wie jeden Link in einem neuen Tab.
- **Dialoge als Modal:** Die Tabelle ist kein Modal-Kontext (ADR-0025 Nachtrag 16), also öffnen „Duplizieren …“ und „In den Papierkorb …“ dieselben Dialoge wie im Panel; `reportNestedModal` bleibt grün (ein Dialog). Sie stehen in `TicketTable` außerhalb der Tabelle; der Modal gibt den Fokus an „•••“ der Zeile zurück, ist die Zeile weg (in den Papierkorb), an die Zeile an derselben Stelle bzw. die Überschrift der Ansicht.
- **Daten der Dialoge:** Eine Zeile kennt nur die Zusammenfassung ihres Tickets. Der `TicketRowActionsStore` (`stores/ticket-row-actions.svelte.ts`, im `(app)`-Layout) lädt nach der Wahl erst, was die Frage braucht: für „Duplizieren …“ Ticket (Beschreibung, Hauptquelle), Quellen und Zahl der Kommentare, für „In den Papierkorb …“ die Quellen (ihre Zahl). Solange trägt die Zelle „Aktionen“ der Zeile `aria-busy` (Warte-Zeiger nach ADR-0026, Nachtrag KK-1), eine zweite Wahl wartet; ein Fehler beim Laden ist ein Fehler-Flag „HAUS-12 konnte nicht geladen werden.“ mit Grund (404: „Das Ticket gibt es nicht mehr, oder es liegt im Papierkorb.“). Unteraufgaben und übergeordnetes Ticket kommen aus der Liste wie im Panel.
- **DOM je Zeile:** Das Menü jeder Zeile steht mit seinen Einträgen im DOM (ein Knopf, ein Popover, fünf Einträge, zwei Linien). Anders als die Editoren der Zellen (ADR-0036 §6, erst beim Zeigen oder Fokussieren) wird es nicht verzögert gerendert: Seine Größe ist fest und klein, die Editoren dagegen wachsen mit Projekten und Tags.
- **Papierkorb wie im Panel:** Das Verschieben ist eine gemeinsame Funktion `moveTicketToTrash` (`stores/trash-move.ts`), die auch der `TicketDetailStore` nutzt: Route mit Quellen-Wahl, Zeile aus der Liste, Flag mit „Rückgängig“ über den `TrashStore`, ein schon fehlendes Ticket (404) zählt als verschoben.

### 3.2 Zeilenklick, Auswahl, Zellen, Gruppen, Tastatur

- Der Zeilenklick bleibt: Er öffnet das Ticket im gemerkten Modus. „•••“ ist ein Knopf und das Menü ein Popover; beides ignoriert die Zeile schon (`CONTROLS` mit `button` und `[popover]`), also öffnet ein Klick darauf oder auf einen Eintrag nie die Zeile und ändert die Auswahl nicht.
- Die Auswahlspalte, die Zellen zum Bearbeiten und das Häkchen bleiben unverändert; Esc im Menü wird vom Popover verbraucht und hebt die Auswahl nicht auf.
- Tastatur: „•••“ ist ein Tab-Stopp der Zeile nach dem Häkchen (das Symbol „Öffnen“ bleibt `tabindex="-1"`); das Menü bedient sich wie im Ticket (APG „Menu Button“).

### 3.3 Spaltenbreite

- Die Spalte „Aktionen“ der Aufgaben wird 5,5rem statt 4rem breit (Häkchen 1rem, „Öffnen“ 14 px, „•••“ in `--control-height-s`, je 0,5rem Abstand, 0,5rem Innenabstand links und rechts); der Knopf hat die kleine Höhe, damit die Zeile nicht höher wird. Die Schwellen beim Ausweichen steigen um 1,5rem (Erstellt 64,5, Tags 58,5, Projekt 50,5, Fällig 42,5rem); „Tabellen scrollen nie seitlich“ und die Reihenfolge bleiben ([ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md), Nachtrag 4).

### 3.4 Andere Tabellen

- Stand von AM-2 (seit der Nutzerentscheidung zu §4 überholt, siehe AM-4):
- **Papierkorb:** Seine Zeilen haben schon sichtbar „Wiederherstellen“ und „Endgültig löschen …“; ein Menü brächte keinen neuen Weg, nur einen zweiten Ort. Nicht ergänzt.
- **Eingang:** Die Aktionen der Zeile stehen schon als Knöpfe in einer breiten Spalte (13rem); „Umwandeln“, „Verknüpfen“ usw. sind eigene Abläufe des Eingangs, nicht die eines Tickets. Nicht ergänzt.
- **Projekte, Wiederholungen:** keine Aktionen in der Zeile, alles im Panel. Nicht ergänzt; ein Menü dort wäre neuer Umfang.

### 3.5 Rechtsklick

- Stand von AM-2: nicht umgesetzt, weil der `Popover` nur am Knopf platzierte und das Menü des Browsers ersetzt werden müsste. Umgesetzt mit AM-3 (§5).

### 3.6 Tests

- `stores/ticket-row-actions.test.ts`: Laden je Frage, eine Zeile zur Zeit, Fehler-Flags (404, Server), Sitzung, Verschieben mit Quellen-Wahl und „Rückgängig“, 404 als verschoben, nichts ohne Frage.
- `components/ticket-table-row-menu.test.ts`: Knopf nach „Öffnen“ mit Namen je Ticket und als Tab-Stopp, Einträge mit Links samt Zustand der Liste und Linien, ohne Store kein „Duplizieren …“, kein Öffnen und keine Auswahl beim Klick, „Link kopiert“, Papierkorb mit Bestätigung, Quellen und „Rückgängig“ (Zeile weg), Panel des Tickets schließt, „Abbrechen“ mit Fokus zurück, „Duplizieren …“ als einziger Dialog mit Fokus zurück, Warten der Zeile (`aria-busy`), Gruppen.
- Angepasst: `domain/columns.test.ts`, `components/ticket-table-columns.test.ts`, `components/columns-popover.test.ts` (Breite der Spalte „Aktionen“), `components/delete-ticket.test.ts` (gemeinsame Funktion), Hilfe.
- Manuell BYL-E6-746: Browser, Tastatur und NVDA.

## 4. Folgepunkte

Nutzerentscheidung vom 2026-10-01: „Alle Verbesserungen einpflegen“.

- [x] **Sammel-Leiste:** „In den Papierkorb …“ statt „Löschen …“ (AM-3, §5.1).
- [x] **Rechtsklick auf eine Zeile:** öffnet das Zeilenmenü am Zeiger, dazu Umschalt+F10 und die Kontextmenü-Taste (AM-3, §5.2).
- [x] **Andere Tabellen:** Zeilenmenüs in „Papierkorb“, „Eingang“, „Projekte“ und „Wiederholungen“ (AM-4, §6); neue Folgepunkte in §6.6.

## 5. AM-3: Sammel-Leiste und Rechtsklick

Entscheidung und Gründe: [ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md), Nachtrag „Rechtsklick“.

### 5.1 Sammel-Leiste

- Der Knopf heißt „In den Papierkorb …“ wie der Eintrag der Menüs. Die Frage („2 Tickets in den Papierkorb verschieben?“, „In den Papierkorb“, Aufbewahrung, Quellen-Wahl) und das Flag („… in den Papierkorb verschoben.“ mit „Rückgängig“) sagten das schon; geprüft und unverändert. Der Fortschritt hieß „Löschen: 3 von 12 Tickets“ und heißt jetzt „In den Papierkorb verschieben: 3 von 12 Tickets“ (`actionLabel`).

### 5.2 Rechtsklick und Tastatur

| Auslöser | Ort des Menüs | Fokus danach |
|---|---|---|
| Rechtsklick auf eine Zeile (Zelle, Titel, „Öffnen“, Auswahl, Häkchen, „•••“) | obere linke Ecke am Zeiger; rechts zu wenig Platz: links vom Zeiger, unten zu wenig: darüber, sonst ins Fenster geklemmt | erster Eintrag; nach Esc oder einer Wahl zurück an das Element, das ihn vorher hatte, sonst an „•••“ der Zeile |
| Umschalt+F10 oder Kontextmenü-Taste, Fokus in einer Zeile | unter dem fokussierten Element (wie unter einem Knopf, mit Flip und Klemmen); auf „•••“ wie ein Klick darauf | erster Eintrag; danach zurück an das fokussierte Element |
| Klick auf „•••“ nach einem Rechtsklick | wieder unter dem Knopf | wie bisher |

- **Menü des Browsers** bleibt mit Strg (überall), bei Touch, auf markiertem Text unter dem Zeiger, in Popovern (Editoren der Zellen, das offene Menü mit seinen echten Links), in Feldern zum Tippen und auf echten Links außer dem Link der Zeile selbst (`data-row-link`: Titel und „Öffnen“). Gründe im Nachtrag der ADR.
- **Kein Öffnen, keine Auswahl:** Ein Rechtsklick ist kein `click`; die Zeile und die Auswahl reagieren nicht darauf. Kopf der Tabelle, Gruppenköpfe und die Zeile „Weitere laden“ behalten das Menü des Browsers.
- **Unterbau:** `placeAtPoint` (`lib/overlay/position.ts`), `Popover.open(anchor, returnTo)` mit virtuellem Anker (Zeiger als Abstand zum Knopf, damit das Menü beim Scrollen der Zeile folgt, oder ein Element), `ActionsMenu` hört auf `byl-open-menu` an seinem Knopf, `rowMenus` (`lib/overlay/context-menu.ts`) hängt einmal an der Tabelle und findet in der Zeile den Knopf `.row-menu`. Unter macOS und Linux öffnet das Menü erst nach dem Loslassen der Taste, weil das Light-Dismiss sonst gleich wieder schlösse.

### 5.3 Tests

- `overlay/position.test.ts`: Ecke am Zeiger, Flip nach links und oben, beide in der Ecke, Klemmen, Höhe.
- `overlay/context-menu.test.ts`: Zellen, Knöpfe und Checkboxen bekommen das Zeilenmenü, der Link der Zeile auch; andere Links, Felder, Selects, `contenteditable`, Popover, Strg, Touch und Markierung behalten das Browser-Menü; Umschalt+F10 und Kontextmenü-Taste, nicht F10 allein, nicht mit Alt oder Meta.
- `components/ticket-table-row-menu.test.ts` (AM-3): Rechtsklick öffnet am Zeiger (Position), Fokus im Menü, kein Öffnen und keine Auswahl in allen Zellen, Links der Zeile ja und Links im Menü nein, Strg, Touch und Markierung, Feld eines Zellen-Editors und Kopf, Umschalt+F10 unter dem Element mit Fokus zurück, Kontextmenü-Taste in einer Zelle, eine Aktion aus dem Kontextmenü, danach wieder unter „•••“.
- `components/ticket-table-selection.test.ts` und `domain/bulk.test.ts`: „In den Papierkorb …“ statt „Löschen …“, Fortschritt.
- Manuell BYL-E6-764: Browser (auch die Ränder des Fensters), Tastatur und NVDA.

## 6. AM-4: Zeilenmenüs der übrigen Tabellen

Entscheidung und Gründe: [ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md), Nachtrag „Zeilenmenüs der übrigen Tabellen“; Spalten: [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md), Nachtrag 5. Nur Aktionen, die es in der Tabelle oder im Panel der Zeile schon gab; jede Tabelle bekommt „•••“ am Ende der Spalte „Aktionen“ (Knopf „Weitere Aktionen für …“, `row-menu`), den Rechtsklick und Umschalt+F10 aus AM-3 (`{@attach rowMenus}`, `data-row-link` am Titel bzw. Namen).

### 6.1 Papierkorb

| Eintrag | Wirkung |
|---|---|
| „Vorschau öffnen“ | Link auf `/papierkorb/<id>` wie der Titel |
| „Wiederherstellen“ (Linie davor) | wie das Symbol: mit Frage nach Zielprojekt oder Serie inline unter der Zeile, wenn nötig |
| „Endgültig löschen …“ (Linie davor) | dieselbe Bestätigung wie bisher („… endgültig löschen?“, „Das lässt sich nicht rückgängig machen.“) |

- **Zeile:** „Wiederherstellen“ bleibt als Symbol; das Symbol „Endgültig löschen …“ entfällt (selten, destruktiv, neben „Wiederherstellen“ verwechselbar). Während ein Wiederherstellen läuft, warten beide Einträge (`aria-busy` bzw. gesperrt).
- **„Link kopieren“:** nicht aufgenommen; die Vorschau ist nach der Aufbewahrung weg, der dauerhafte Link ist der des Tickets nach dem Wiederherstellen.
- **Browser-Menü:** in der Frage eines Wiederherstellens (Auswahl des Zielprojekts).

### 6.2 Eingang

| Zustand | Einträge |
|---|---|
| neu | „Öffnen“ (Panel), Linie, „Umwandeln …“ (Link auf `/tickets/neu?aus=<id>`), „Mit Ticket verknüpfen …“ (derselbe Dialog wie für gewählte Einträge, mit diesem einen; nur mit dem Layout), „Verwerfen“ (mit „Rückgängig“ im Flag) |
| verworfen | „Öffnen“, Linie, „Wiederherstellen“ |
| verknüpft | „Öffnen“, Linie, „Ticket HAUS-12 öffnen“ (ohne geladenen Key „Ticket öffnen“) |
| jeder mit Originaldatei | dazu nach einer Linie „Originaldatei herunterladen“ (wie im Panel: neues Datei-Token, dann die Datei; ohne Datei ein Fehler-Flag; die Zelle trägt solange `aria-busy`) |

- **Zeile:** „Umwandeln“, „Verwerfen“, „Wiederherstellen“ und der Chip „→ HAUS-12“ bleiben sichtbar, weil das Sichten des Eingangs genau sie braucht; „•••“ kommt dazu. Die Spalte wächst von 13 auf 15rem.
- **„Umwandeln …“** trägt im Menü Auslassungspunkte, weil es ein Formular öffnet, das noch Eingaben braucht; der sichtbare Knopf heißt weiter „Umwandeln“.
- **Browser-Menü:** auf „Umwandeln“, dem Chip, „Ticket ansehen“ und den Links des Hinweises „Mögliches Duplikat“ (echte Links); der Titel zeigt das Zeilenmenü.
- **Ergänzt mit AM-5** (§7.1): „Link der Quelle öffnen“, „Anderem Ticket zuordnen …“, „Lösen“ und „Seiteninhalt sichern“.

### 6.3 Projekte

| Eintrag | wann | Wirkung |
|---|---|---|
| „Öffnen“ | immer | Panel des Projekts, dort wird es bearbeitet (kein eigener Eintrag „Bearbeiten“: dieselbe Stelle) |
| „Tickets anzeigen“ | immer | die Tabelle „Aufgaben“ mit dem Projekt als Filter |
| „Unterprojekt anlegen“ | aktives Oberprojekt, Unterprojekte verfügbar | `/projekte/neu` mit dem Projekt als Oberprojekt |
| „Archivieren“ (Linie davor) | aktiv | sofort, mit aktiven Unterprojekten erst die Frage des Panels („Archiviert auch 1 Unterprojekt: …“) |
| „Aus dem Archiv holen“ bzw. „Mit Oberprojekt zurückholen“ | archiviert (bzw. unter archiviertem Oberprojekt) | wie im Panel, Flag mit Ergebnis |
| „Löschen …“ (Linie davor) | ohne Tickets und Unterprojekte | Bestätigung des Panels („… wird endgültig gelöscht“) |

- **Nur die Liste:** Die Kacheln bekommen kein Menü (keine Tabelle; die ganze Kachel ist ein Link). Überholt durch AM-5 (§7.2): Seitdem hat jede Kachel dasselbe Menü neben ihrem Link.
- **Neue Spalte** „Aktionen“ 3,5rem, Pflicht, sortiert nicht; das Menü „Spalten“ nennt „Code, Name und Aktionen“ als immer sichtbar.
- **Eine Logik:** Archivieren, Zurückholen und Löschen samt Flags stehen in der `ProjectRoute` des Layouts, Regel und Texte der Fragen in `domain/project-tree.ts`; Panel und Menü nutzen dieselben. Eine Ablehnung ohne Frage ist ein Fehler-Flag mit Grund, in einer Frage steht sie dort. Ist das Panel eines gelöschten Projekts offen, schließt es sich.

### 6.4 Wiederholungen

| Eintrag | wann | Wirkung |
|---|---|---|
| „Regel öffnen“ | immer | Panel der Regel |
| „Zum offenen Ticket HAUS-12“ bzw. „Zum ältesten offenen Ticket HAUS-12“ | mit offenem Ticket | Link im gemerkten Öffnungsmodus; alle Keys stehen weiter in der Spalte „Offene Tickets“ |
| „Pausieren“ bzw. „Fortsetzen“ (Linie davor) | immer | wie bisher, Flag „Regel pausiert.“, Ablehnung als Fehler-Flag |
| „Löschen …“ (Linie davor) | immer | Frage des Panels „Regel löschen?“ mit den Tickets, die offen bleiben (`ruleDeleteText`); schließt das Panel der Regel |

- **Zeile:** Das Symbol „Pausieren“/„Fortsetzen“ entfällt (selten, mehrdeutig); die Spalte bleibt 3,5rem.
- **Browser-Menü:** auf den Keys der offenen Tickets (echte Links).

### 6.5 Tests

- Neu: `components/trash-row-menu.test.ts`, `components/inbox-row-menu.test.ts`, `components/project-row-menu.test.ts`, `components/recurrence-row-menu.test.ts`: Knopf und Name, Einträge je Zustand mit Links und Linien, Ausführen, Fragen (Projekte, Regeln, Papierkorb), Fehler als Flag bzw. in der Frage, Panel schließt, Fokus auf die nächste Zeile, Rechtsklick am Zeiger, Umschalt+F10 bzw. Kontextmenü-Taste mit Fokus zurück, Browser-Menü auf anderen Links und in Feldern, keine Auswahl.
- Angepasst: `trash-view.test.ts` (Endgültig löschen aus dem Menü), `inbox-table.test.ts` (Ausweichen bei 640 px), `projects-view.test.ts` (Spalte „Aktionen“, 500 px), `recurrence-table.test.ts` und `recurrences-view.test.ts` (Pausieren aus dem Menü), `domain/columns.test.ts` (Breiten, Schwellen), `domain/project-tree.test.ts` und `domain/recurrence-rule.test.ts` (Texte), `table-columns.test.ts` (jede Tabelle mit Menü und Kontextmenü).
- Manuell BYL-E6-770: Browser, Tastatur und NVDA in allen vier Tabellen.

### 6.6 Folgepunkte (bei AM-4 nicht umgesetzt, weil es sie in der Zeile oder im Panel noch nicht gab bzw. wegen Platz)

Nutzerentscheidung vom 2026-10-01: „Mögliche Ergänzungen umsetzen“ (AM-5, §7).

- [x] **Eingang, verknüpfte Einträge:** „Anderem Ticket zuordnen …“ und „Lösen“ stehen im Panel des Eintrags; im Zeilenmenü fehlten sie (brauchen den Quellen-Store in der Tabelle). Ebenso „Seiteninhalt sichern“ und der Link der Quelle („Link öffnen“ in neuem Tab). Umgesetzt mit AM-5 (§7.1), nie für die Hauptquelle.
- [x] **Projekte, Kacheln:** ein Menü je Kachel bräuchte einen Knopf neben dem Link der ganzen Kachel. Umgesetzt mit AM-5 (§7.2): der Knopf steht neben dem Link in der Ecke der Kachel.
- **Papierkorb:** „Link kopieren“ (bewusst nicht, siehe §6.1; unverändert).
- **Touch:** ein langes Drücken als Kontextmenü (bewusst nicht, ADR-0036 Nachtrag „Rechtsklick“; unverändert).

## 7. AM-5: Ergänzungen in Eingang und Kacheln

Entscheidung und Gründe: [ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md), Nachtrag „Ergänzungen in Eingang und Kacheln“, und [ADR-0031](../adr/0031-herkunft-sichern.md), Nachtrag G. Wieder nur vorhandene Aktionen und Wege: `MoveSourceDialog`, `TicketSourcesStore.release` (`releaseItem`), `InboxStore.savePage` (Route `POST /api/byl/inbox/{id}/page` mit dem SSRF-Schutz aus ADR-0031 §6) und die Projekt-Aktionen von AM-4 (`menuOf` der `ProjectsView` mit der `ProjectRoute`).

### 7.1 Eingang

| Zustand | Einträge (Linien als „—“) |
|---|---|
| neu | „Öffnen“, „Link der Quelle öffnen“¹ — „Umwandeln …“, „Mit Ticket verknüpfen …“, „Verwerfen“ — „Seiteninhalt sichern“² bzw. „Originaldatei herunterladen“³ |
| verworfen | „Öffnen“, „Link der Quelle öffnen“¹ — „Wiederherstellen“ — „Seiteninhalt sichern“² bzw. „Originaldatei herunterladen“³ |
| verknüpft (nicht Hauptquelle) | „Öffnen“, „Link der Quelle öffnen“¹ — „Ticket HAUS-12 öffnen“, „Anderem Ticket zuordnen …“⁴, „Lösen“⁴ — „Seiteninhalt sichern“² bzw. „Originaldatei herunterladen“³ |
| Hauptquelle eines Tickets | „Öffnen“, „Link der Quelle öffnen“¹ — „Ticket HAUS-12 öffnen“ — „Seiteninhalt sichern“² bzw. „Originaldatei herunterladen“³ |
| verknüpft, Ticket nicht geladen | „Öffnen“, „Link der Quelle öffnen“¹ — „Ticket öffnen“ — wie oben |

¹ nur mit einer https-Adresse (`sourceUrl`), als Link in neuem Tab nach den Regeln von `ExternalLink` (ADR-0026 §6): `target="_blank"`, `rel="noopener noreferrer"`, Symbol „außen“ und „(öffnet in neuem Tab)“ im Namen. Eine http-Adresse steht nur im Panel (Zeile „Link“). ² nur bei einem Web-Link, von dem nur die Adresse gespeichert ist (`canSavePage`), in jedem Zustand wie im Panel. ³ nur mit Originaldatei; beides zugleich gibt es nicht, weil eine gesicherte Seite die Originaldatei ist. ⁴ nur für einen verknüpften Eintrag, von dem bekannt ist, dass er nicht die Hauptquelle ist (`canLeaveTicket` mit `isMainSource`), und nur mit dem `TicketSourcesStore` des Layouts.

- **Gemeinsame Regeln** in `domain/sources.ts`: `canSavePage` (Panel und Menü), `isMainSource` (aus dem mitgeladenen Ticket, sonst unbekannt) und `canLeaveTicket` (Abschnitt „Quellen“ im Ticket, Panel des Eintrags und Menü). Vorher stand dieselbe Bedingung dreimal verschieden formuliert in `TicketSources`, `InboxPanel` und als Lücke im Menü.
- **Hauptquelle:** kein „Anderem Ticket zuordnen …“ und kein „Lösen“, auch nicht ausgegraut. Begründung: So halten es `TicketSources` und das Panel des Eintrags (die Knöpfe fehlen, ein Satz sagt, warum); ein Menüeintrag hat keinen Platz für einen Grund (ein gesperrter Eintrag ohne Grund wäre ein Rätsel, `locked` bedeutet im Menü „läuft gerade“). Den Grund nennt das Panel, das „Öffnen“ zeigt. Ist das Ticket des Eintrags nicht geladen, fehlen beide ebenfalls, weil der Hook die Hauptquelle ablehnen würde.
- **Wirkung wie im Panel:** „Anderem Ticket zuordnen …“ öffnet `MoveSourceDialog` (Modal M mit `TicketPicker`, die Tabelle ist kein Modal, also kein Dialog aus einem Dialog), Erfolg als Flag „„…“ gehört jetzt zu TASK-4.“, eine Ablehnung bleibt im Dialog; danach kehrt der Fokus zu „•••“ zurück. „Lösen“ ohne Rückfrage, Flag „„…“ ist wieder im Eingang.“ bzw. Fehler-Flag mit Grund (beides aus dem Store); in der Ansicht „Verknüpft“ verlässt die Zeile die Liste, und der Fokus geht an die Zeile an ihrer Stelle wie nach „Verwerfen“. „Seiteninhalt sichern“ ohne Rückfrage, Flag „Seite von „…“ gesichert.“; eine Ablehnung des Servers wird das Fehler-Flag „Seite von „…“ ließ sich nicht sichern: <Grund>“ (im Panel steht sie im Panel). Während einer dieser Aktionen trägt die Zelle „Aktionen“ `aria-busy`, der laufende Eintrag ebenso, eine zweite Seitenkopie wartet.
- **Rückgängig:** Keine der drei Aktionen hatte bisher ein „Rückgängig“; das bleibt so (Lösen lässt sich mit „Mit Ticket verknüpfen …“ umkehren, Umhängen mit „Anderem Ticket zuordnen …“, eine Seitenkopie gibt es nur einmal).
- **Browser-Menü:** Der Eintrag „Link der Quelle öffnen“ ist ein echter Link im offenen Menü; ein Rechtsklick darauf zeigt das Menü des Browsers (Link kopieren, in neuem Fenster öffnen).

### 7.2 Projektkacheln

- **Ort:** „•••“ („Weitere Aktionen für „Haus““, `.button-icon.row-menu` in `--control-height-s`) oben rechts in jeder Kachel, als Geschwister des Links der Kachel (ein Knopf in einem Link ist kein gültiges HTML); der Link bekommt rechts Platz (2,5rem), damit kein Text unter dem Knopf liegt. Gilt für oberste Projekte, Oberprojekte mit Unterprojekten und Unterprojekte gleich.
- **Einträge:** genau die der Zeile der Liste aus derselben Funktion `menuOf` der `ProjectsView` (AM-4, §6.3), mit denselben Fragen, Flags und dem Fokus danach.
- **Rechtsklick und Tastatur:** `rowMenus` hängt auch an der Liste der Kacheln; eine Kachel trägt `data-menu-row` und zählt damit wie eine Zeile, ihr Link `data-row-link` wie der Titel einer Zeile. Ein Rechtsklick auf die Kachel öffnet ihr Menü am Zeiger, Umschalt+F10 und die Kontextmenü-Taste auf ihrem Link darunter, Esc gibt den Fokus an den Link zurück. Das Menü des Browsers bleibt mit Strg, bei Touch, auf markiertem Text, in Feldern und außerhalb einer Kachel (etwa auf „3 Unterprojekte“). Ein Rechtsklick öffnet nie das Panel.
- **Klick:** Ein Klick auf die Kachel öffnet das Projekt-Panel wie bisher; „•••“ liegt nicht im Link.

### 7.3 Tests

- Neu bzw. erweitert: `domain/sources.test.ts` (`canSavePage`, `isMainSource`, `canLeaveTicket`), `components/inbox-row-menu.test.ts` (Einträge je Zustand mit Linien, auch Hauptquelle, unbekanntes Ticket, Eintrag ohne und mit http-Adresse; ohne Quellen-Store; Link in neuem Tab mit Browser-Menü; Lösen mit Flag und Fokus; Umhängen über den Dialog mit Flag, neuem Chip und Fokus; Seitenkopie mit Warten, Flag und Fehler-Flag), `components/project-row-menu.test.ts` (Kacheln: dieselben Einträge wie die Liste, Ausführen mit Fragen, Rechtsklick am Zeiger, Unterprojekt mit eigenem Menü, Strg und außerhalb der Kacheln, Umschalt+F10 und Kontextmenü-Taste mit Fokus zurück, Klick öffnet weiter), `components/project-tiles.test.ts` (Knopf neben dem Link), Hilfe (`help-page.test.ts`).
- Unverändert grün: `ticket-sources.test.ts` und `inbox-panel.test.ts` (die gemeinsame Regel ändert ihr Verhalten nicht).
- Manuell BYL-E6-783: Browser, Tastatur und NVDA in Eingang und Kacheln.
