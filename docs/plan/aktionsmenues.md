# Plan „Aktionsmenüs“

- **Stand:** AM-1 umgesetzt (2026-10-01, #194, nur Oberfläche: Build, dann F5; kein Neustart). AM-2 umgesetzt (2026-10-01, Branch `feat/table-row-menu`, nur Oberfläche: Build, dann F5; kein Neustart). Offen sind die manuellen Browser-Prüfungen BYL-E6-742 und BYL-E6-746.
- **Grundlage:** Nutzerentscheidung vom 2026-10-01 auf die Frage, ob es in der Tabelle ein Zeilenmenü „•••“ (Öffnen, Duplizieren, Löschen) geben soll oder der Knopf im Ticket reicht: „beides, aber vorrangig für das Ticket selbst“. Vorgaben des Advisors: Reihenfolge AM-1 (Ticket) vor AM-2 (Tabelle), Einträge, Kopf entschlacken wie in Jira, keine Funktion verloren, Tests für Maus und Tastatur, Doku.
- **Entscheidungen:** Nachtrag in [ADR-0045](../adr/0045-ticket-duplizieren.md) (Einstieg über das Menü), Nachtrag in [ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) (Kopf von Panel und Vollansicht; Zeilenmenü), Nachtrag 4 in [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md) (Breite der Spalte „Aktionen“). Das Menü selbst folgt [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) §5 (Popover der Art `menu`, „später Aktionsmenüs“).
- **Einordnung:** Manifest-Block „Aktionsmenüs“ ab `BYL-E6-740`. Keine Migration, keine Hooks.

## 1. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| AM-1 | Menü „•••“ im Kopf von Panel und Vollansicht: „Link kopieren“, „Duplizieren …“, „In den Papierkorb …“; der Kopf behält als Symbole nur „Vollansicht“ bzw. „Im Seitenpanel öffnen“ und ×; gemeinsamer Baustein `ActionsMenu` (auch für die Kanal-Karten) | umgesetzt |
| AM-2 | Zeilenmenü „•••“ in der Spalte „Aktionen“ der Tabelle „Aufgaben“ nach „Öffnen“: „Im Seitenpanel öffnen“, „In Vollansicht öffnen“, „Link kopieren“, „Duplizieren …“, „In den Papierkorb …“; Spalte „Aktionen“ 5,5 statt 4rem | umgesetzt |

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

- **Papierkorb:** Seine Zeilen haben schon sichtbar „Wiederherstellen“ und „Endgültig löschen …“; ein Menü brächte keinen neuen Weg, nur einen zweiten Ort. Nicht ergänzt.
- **Eingang:** Die Aktionen der Zeile stehen schon als Knöpfe in einer breiten Spalte (13rem); „Umwandeln“, „Verknüpfen“ usw. sind eigene Abläufe des Eingangs, nicht die eines Tickets. Nicht ergänzt.
- **Projekte, Wiederholungen:** keine Aktionen in der Zeile, alles im Panel. Nicht ergänzt; ein Menü dort wäre neuer Umfang.

### 3.5 Rechtsklick

- **Nicht umgesetzt.** Ein Kontextmenü an der Zeile müsste das Menü an der Stelle des Zeigers zeigen (der `Popover` platziert nur am Knopf) und das Menü des Browsers ersetzen (Link öffnen, kopieren, untersuchen). Das ist kein kleiner, sauberer Schritt; siehe §4.

### 3.6 Tests

- `stores/ticket-row-actions.test.ts`: Laden je Frage, eine Zeile zur Zeit, Fehler-Flags (404, Server), Sitzung, Verschieben mit Quellen-Wahl und „Rückgängig“, 404 als verschoben, nichts ohne Frage.
- `components/ticket-table-row-menu.test.ts`: Knopf nach „Öffnen“ mit Namen je Ticket und als Tab-Stopp, Einträge mit Links samt Zustand der Liste und Linien, ohne Store kein „Duplizieren …“, kein Öffnen und keine Auswahl beim Klick, „Link kopiert“, Papierkorb mit Bestätigung, Quellen und „Rückgängig“ (Zeile weg), Panel des Tickets schließt, „Abbrechen“ mit Fokus zurück, „Duplizieren …“ als einziger Dialog mit Fokus zurück, Warten der Zeile (`aria-busy`), Gruppen.
- Angepasst: `domain/columns.test.ts`, `components/ticket-table-columns.test.ts`, `components/columns-popover.test.ts` (Breite der Spalte „Aktionen“), `components/delete-ticket.test.ts` (gemeinsame Funktion), Hilfe.
- Manuell BYL-E6-746: Browser, Tastatur und NVDA.

## 4. Offene Punkte

- **Sammel-Leiste:** Sie heißt weiter „Löschen …“ (Frage und Flag sagen schon „in den Papierkorb“). Angleichen an „In den Papierkorb …“ ist ein eigener kleiner Schritt mit den Tests der Leiste; nicht Teil dieses Auftrags.
- **Rechtsklick auf eine Zeile** (§3.5): Folgepunkt, falls gewünscht; braucht eine Platzierung des Popovers am Zeiger.
- **Andere Tabellen** (§3.4): keine Zeilenmenüs, solange es dort keine Aktionen eines Tickets gibt.
