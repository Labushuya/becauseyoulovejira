# Fehlerbehebung „Layout-Überlauf“: Formular-Controls bleiben in ihrem Container

- **Stand:** umgesetzt (2026-09-28), Branch `fix/form-control-overflow`. Keine Migration, kein Neustart (nur der Build der SPA). Offen ist die manuelle Browser-Prüfung BYL-E6-382. Nachtrag §6 (2026-10-02, Branch `fix/karten-umbenennen-ueberlauf`): Überlauf beim Umbenennen in den Kanal-Karten, offen sind BYL-E6-1182 und BYL-E6-1183.
- **Grundlage:** Fehlerbericht des Nutzers vom 2026-09-28: Das Projekt-Select im Ticket ragt aus dem Panel, sobald ein Unterprojekt gewählt ist („Gesundheit › Christa (CHRS)“). [ADR-0034](../adr/0034-unterprojekte.md) (Beschriftung „Haus › Garten (GART)“), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) (native `select` in Formularen, keine eigenen Dropdowns), [ADR-0029](../adr/0029-glas-materialien.md), [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md), [CLAUDE.md](../../CLAUDE.md) §7 und §8.
- **Einordnung:** Manifest-Block „Layout-Überlauf“ ab `BYL-E6-380`.

## 1. Ursache

Ein `select` ist so breit wie seine längste Option. Als Grid- oder Flex-Element hat es `min-width: auto`, also diese Breite als Mindestbreite. In `TicketFields` steht das Select in `.control` (`display: grid`, eine `auto`-Spur); die Spur wächst auf die Mindestbreite des Selects, und `max-width: 100%` bezieht sich dann auf die schon verbreiterte Spur. Das gleiche gilt für jedes Formular, das ein Select in ein Grid (`.field { display: grid }`) oder eine Flex-Zeile stellt. Solange Projekte kurze Namen hatten, fiel das nicht auf; mit dem Pfad der Unterprojekte ist die längste Option oft breiter als die Spalte.

Gemessen in Chromium (Edge 154, headless) mit einer 300 px breiten Box:

| Aufbau | ohne Regel | mit `min-width: 0` |
|---|---|---|
| `TicketFields` (Grid `7rem minmax(0, 1fr)`, darin `.control` als Grid, Select `width: fit-content; max-width: 100%`) | Select 448 px in einer 170 px breiten Spalte | 170 px |
| `label` als Grid (`.field`), Select `max-width: 100%` | 432 px | 298 px |
| Flex-Zeile „Beschriftung + Select“ | 432 px | 248 px |
| Flex-Zeile mit einem Block-`div` um das Select | 432 px | 432 px (der Block braucht selbst `min-width: 0`; in den Formularen der Inventur nicht gefunden, dort sind die Hüllen Grids) |

`text-overflow: ellipsis` am Select zeigt in Chromium und Firefox „…“ am Ende des geschlossenen Selects.

## 2. Lösung

- **Basisregeln in `base.css`** für alle Formular-Controls: `input, select, textarea { min-width: 0; max-width: 100% }`, `text-overflow: ellipsis` für Selects und Textfelder, `fieldset { min-width: 0 }` (Standard ist `min-content`) und `.search-field` mit `min-width: 0; max-width: 100%`. Komponenten setzen weiter nur Abstände, Rahmen und Breiten; wo eine Mindestbreite nötig ist, als `min(…, 100%)` (Tag umbenennen).
- **Vollständige Beschriftung:** Das Select trägt die ganze Beschriftung des gewählten Werts als `title` (Tooltip): `ProjectSelect` (Panel, Vollansicht, Neues Ticket, Sammelaktion, Gesammelt umwandeln, Regel-Panel, Papierkorb), das Projektfeld der Erfassung, „Oberprojekt“ im Projekt-Panel und „Absender“ beim WhatsApp-Import. Screenreader lesen ohnehin den ganzen Wert der gewählten Option; der Schnitt ist nur optisch.
- **Popover** (`Popover.svelte`): höchstens `100vw - 1rem` breit (passend zu `VIEWPORT_MARGIN`) und `white-space: normal`, weil die Popover der Zellen in einer Tabellenzelle mit `nowrap` stehen; lange Einträge des Projektmenüs brechen um statt aus dem Fenster zu ragen.
- **Kachelraster** (`auto-fill`/`auto-fit`): Mindestbreite als `minmax(min(18rem, 100%), 1fr)`, damit eine Kachel auf schmalen Fenstern nicht breiter als der Bereich wird (Kanäle, Einrichtungswege, Katalog, Projektkacheln, Kennzahlen, Darstellung).
- Keine neuen Tokens, keine neuen Schriftgrößen oder Radien; die Ausnahmelisten bleiben unverändert.

## 3. Beschriftung der Unterprojekte im geschlossenen Select

Geprüft wurde eine kompaktere Darstellung (Oberprojekt gedämpft, Unterprojekt und Code betont). Ein natives `<option>` kennt nur reinen Text; Teile davon zu gestalten ginge nur mit einer eigenen Auswahlliste (ADR-0025 verbietet eigene Dropdowns, Formulare nutzen native Selects) oder mit `appearance: base-select` (bisher nur Chromium, nicht Firefox) – beides ein Bruch mit ADR-0025 bzw. ein Browser-Sonderweg. Den Text im geschlossenen Zustand zu kürzen („Christa (CHRS)“), bräche mit ADR-0034, das in allen Auswahllisten den Pfad verlangt, und nähme den Kontext bei gleichnamigen Unterprojekten. Deshalb bleibt es bei der vollen Beschriftung mit Ellipse und `title`.

## 4. Inventur der Formularstellen

Geprüft bei langen Werten, im eingebetteten Panel ab 64rem (480 px) und schmal (etwa 360 px). „Betroffen“ heißt: lief vor dem Fix über; die Basisregeln beheben alle Fälle ohne eigene Regel in der Komponente.

| Stelle | Komponente | Befund | Maßnahme |
|---|---|---|---|
| Ticket-Panel und Vollansicht (Status, Priorität, Fälligkeit, Projekt, Tags) | `TicketFields`, `ProjectSelect`, `DueInput`, `TagPicker` | betroffen (gemeldeter Fall): Projekt-Select in der `auto`-Spur von `.control` | Basisregeln, `title` |
| Neues Ticket | `NewTicketForm` | betroffen: Projekt-Select in `.field` (Grid) | Basisregeln, `title` |
| Sammelaktion „Projekt …“ | `BulkActionBar` (Modal S) | betroffen: Select in `.field` (Grid) | Basisregeln, `title` |
| „Gesammelt umwandeln“ im Eingang | `BulkConvertDialog` | betroffen: Select in `.field` (Grid) | Basisregeln, `title` |
| Inline-Zellen „Projekt“, „Priorität“, „Status“ | `TicketTableRow`, `EditableCell`, `Popover` | betroffen auf schmalen Fenstern: Menü erbt `nowrap` der Zelle, kein Höchstmaß | Popover mit `max-width` und `white-space: normal` |
| Inline-Zellen „Fälligkeit“, „Tags“ | `DueEditor`, `TagPicker` | nicht betroffen (Grid, Mindestbreite 16rem passt ab 320 px) | – |
| Filterleiste und Filter-Popover | `FilterBar`, `FilterPopover`, `.search-field` | nicht betroffen (Knopf mit Ellipse, Liste höchstens 20rem, Umbruch) | Suchfeld zusätzlich mit `max-width: 100%` |
| Einstellungen → Tags | `TagManager` | Umbenennen-Feld mit `min-width: 10rem` | `min(10rem, 100%)` |
| Einstellungen → Kanäle, Einrichtung | `ChannelsView`, `ConnectionsSection`, `ChannelsIntro`, `ChannelCatalog`, `SetupConnectForm`, `SecretValueField`, `ChannelEditModal` | Kartenraster mit 15 bis 18rem Mindestbreite ragten unter etwa 20rem Breite hinaus; Felder selbst nicht betroffen | `minmax(min(…, 100%), 1fr)` |
| Einstellungen → Datei-Importe, Darstellung, Tickets | `KeywordEditor`, Darstellungs-Kacheln, Radiogruppe | nicht betroffen (Umbruch, Grid) | Kacheln mit `min(12rem, 100%)` |
| Eingang: Erfassen | `CaptureForm` | betroffen: Projekt-Select in `.field` (Grid) | Basisregeln, `title` |
| Eingang: WhatsApp, Postfach-Auswahl, Zwischenablage, Verknüpfen | `WhatsAppImport`, `MailboxPicker`, `ClipboardImport`, `TicketCombobox` | „Absender“ mit langen Namen betroffen; übrige nicht | Basisregeln, `title` am Absender |
| Wiederholungen: Regel-Panel und Formular | `RecurrencePanel`, `RecurrenceForm` | Projekt-Select betroffen; Rhythmus-Felder kurz, nicht betroffen | Basisregeln, `title` |
| Papierkorb: Zielprojekt | `TrashNeedQuestion` | betroffen: Select in `.field` (Grid) in der Warnung | Basisregeln, `title` |
| Projekte: Panel, Liste, Kacheln | `ProjectPanel`, `ProjectsView`, `ProjectTiles` | „Oberprojekt“ mit langen Namen betroffen; Kacheln mit 16rem schmal zu breit | Basisregeln, `title`, `min(16rem, 100%)` |
| Kennzahlen | `KpiTiles` | nicht betroffen (9rem) | einheitlich `min(9rem, 100%)` |
| Editor: Link | `LinkPopover` | nicht betroffen (`width: 100%`) | – |

Nebenbefund ohne Änderung in diesem Fix: `BulkActionBar` und `TrashNeedQuestion` geben `ProjectSelect` eine `hintId` und rendern daneben einen eigenen Hinweis mit derselben ID; `ProjectSelect` rendert seinen Hinweis ebenfalls mit dieser ID (doppelte ID, `aria-describedby` zeigt auf den ersten).

## 5. Regressionsschutz

- `web/src/lib/no-control-overflow.test.ts` (BYL-E6-380): prüft statisch, dass `base.css` die Basisregeln hat und keine Komponente sie zurücknimmt (`min-width` nur `0` oder `min(…, 100%)`, `max-width` nur `100%`, für Controls per Tag oder per Klasse aus ihrem Markup), dass Kachelraster `minmax(min(…, 100%), 1fr)` nutzen und dass Popover begrenzt sind und umbrechen.
- `web/src/lib/components/project-select.test.ts` (BYL-E6-381): `title` mit der ganzen Beschriftung.
- **Warum statisch:** jsdom rechnet kein Layout, ein Test am gerenderten Element sähe keinen Überlauf. Ein Browser-Test bräuchte eine neue Abhängigkeit (Playwright) oder einen Browser im CI, beides gegen den schlanken Aufbau (CLAUDE.md §3, §12). Die Ursache ist rein deklarativ; genau diese Regeln beheben sie (Messung in Abschnitt 1), und der statische Test fängt jede Komponente, die sie zurücknimmt, deterministisch. Die Wirkung im Browser bleibt der manuelle Fall BYL-E6-382.

## 6. Nachtrag (2026-10-02): Überlauf beim Umbenennen in den Kanal-Karten

**Fehlerbericht des Nutzers** nach dem Test des GitHub-Kanals: „Zeigt einen massiven Overflow-x, wenn ich den Namen bearbeiten will (vom Kanal; gilt wohl für alle Cards).“ Betroffen ist „Umbenennen …“ (KK-3, [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md) Nachtrag KK-3) in allen Karten mit eigenem Namen: `ConnectionCard` (Google Calendar, Telegram, Postfächer), `NotionCard`, `GitHubCard`; alle stehen auf `ChannelCard`.

### 6.1 Ursache

Gemessen mit Edge 154 headless (Wegwerf-Profil) gegen eine Wegwerf-Instanz mit dem Build des Branches, je Karte „Umbenennen …“ geöffnet:

| Fenster | Karte (Inhalt) | Kopf beim Umbenennen | Seite |
|---|---|---|---|
| 360 px | 297 px (263 px) | 402 px: Symbol 36, Feld und Knöpfe 210, Lozenge „Einrichtung offen“ 132, Abstände 24 | `scrollWidth` 443 statt 345: seitliches Scrollen |
| 1280 px | 307 px (273 px) | 402 px (GitHub mit „Verbunden“: 367 px) | in der rechten Spalte 1353 statt 1265 |

Der Name spielte keine Rolle (auch „Telegram kurz“ lief über), denn ein Textfeld wächst nicht mit seinem Wert. Die Kette:

1. `.channel-card` ist ein Grid ohne `grid-template-columns`; seine eine, implizite Spalte ist `auto`, und Grid-Elemente haben `min-width: auto`. Die Spalte wird also so breit wie das breiteste Mindestmaß einer Zeile, nicht wie die Karte.
2. Der Kopf (`.head`) war eine Flex-Zeile ohne Umbruch aus Symbol, Namen und Lozenge. Ohne Umbenennen ist sein Mindestmaß klein, weil der Name mit `overflow-wrap: anywhere` an jeder Stelle umbricht.
3. Beim Umbenennen steht statt des Namens das Formular: Feld und die Gruppe „Speichern“ + „Abbrechen“ (`.rename-actions`, `inline-flex` ohne Umbruch, 210 px). Die Gruppe ist das Mindestmaß des Formulars, also der Namen; zusammen mit Symbol und Lozenge 402 px.
4. Die Spalte der Karte wächst auf 402 px, alle Zeilen (Infozeile, Hinweis, Fuß) werden so breit, die Karte ragt aus ihrem Raster und die Seite scrollt seitlich ([ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md): kein seitliches Scrollen).

Kein `size` und keine feste Breite am Feld; die Basisregeln aus §2 (`min-width: 0`) wirkten am Feld, aber nicht an den Knöpfen und nicht an der Spalte der Karte.

### 6.2 Lösung (nur `ChannelCard`, keine neuen Tokens)

- **Eine Spalte, die nicht wächst:** `.channel-card` und `.details` mit `grid-template-columns: minmax(0, 1fr)`. Kein Inhalt einer Karte kann ihre Spalte mehr verbreitern (Schutz auch für Infozeile, Hinweise und Details).
- **Der Kopf bricht um:** `.head` mit `flex-wrap: wrap`. Ohne Umbenennen bleibt er wie bisher eine Zeile (der Name hat `flex-basis: 0` und `min-width: 0`); beim Umbenennen trägt der Kopf die Klasse `renaming`, der Namensbereich startet mit `12rem`, und wenn Feld und Lozenge nicht nebeneinander passen, steht die Lozenge darunter.
- **Feld zuerst, Knöpfe brechen um:** Das Feld nimmt die Breite der Zeile (`flex: 1 1 10rem`, `min-width: 0` aus `base.css`); „Speichern“ und „Abbrechen“ folgen daneben, auf schmalen Karten darunter (`.rename` mit Umbruch) und auf sehr schmalen untereinander (`.rename-actions` jetzt `flex` mit `flex-wrap: wrap`).

Nachmessung mit demselben Aufbau: kein Element ragt über seine Karte, `scrollWidth` gleich `clientWidth` bei 360 und 1280 px, für Kalender und Telegram (`ConnectionCard`), Notion und GitHub, mit „Telegram kurz“ und mit 100 Zeichen ohne Leerzeichen; bei 360 px steht das Feld über die volle Breite, die Knöpfe darunter, die Lozenge darunter.

### 6.3 Inventur der übrigen Editoren in Karten und Details

Geprüft mit demselben Aufbau bei 360 und 1280 px, mit langen Werten (Projekt mit 97 Zeichen, Repository `octo-org/` plus 100 Zeichen, Pfad mit 150 Zeichen, Stichwort mit 120 Zeichen). „Befund“ heißt: Element ragt über Karte bzw. Dialog oder die Seite scrollt seitlich.

| Stelle | Komponente | Befund | Maßnahme |
|---|---|---|---|
| Umbenennen im Kopf | `ChannelCard` (`ConnectionCard`, `NotionCard`, `GitHubCard`) | betroffen (gemeldeter Fall) | §6.2 |
| Zielprojekt in den Details | `CardTargetProject` (`ProjectSelect`) | nicht betroffen (Grid `7rem minmax(0, 1fr)`, Select mit `width: 100%`) | Spalte der Details wie §6.2 |
| Abruf (Intervall) in den Details | `GitHubCard` | nicht betroffen | – |
| Repositorys in den Details (Link, Pfade, Knöpfe) | `GitHubCard`, `ChipList` | nicht betroffen (`overflow-wrap: anywhere`, Zeile der Knöpfe bricht um) | – |
| Antworten im Chat | `TelegramReplySwitches` | nicht betroffen (Schalter, keine Textfelder) | – |
| Repository hinzufügen und einstellen | `GitHubRepoDialog`, `GitHubRepoFields` (Modal M) | nicht betroffen (Grid, Felder mit `width: 100%`) | – |
| Repositorys im Assistenten | `GitHubSetupRepos`, `ChannelSetup` (Modal L, alle sechs Schritte) | nicht betroffen | – |
| Stichwort-Editor | `KeywordEditor` in „Stichwörter und Einstellungen …“ und „Stichwörter …“ | nicht betroffen (Zeile bricht um) | – |
| Wert hier einsetzen | `SecretValueField` | nicht betroffen (Zeile bricht um) | – |
| Tag umbenennen (Einstellungen → Tags) | `TagManager` | nicht betroffen (seit §2) | – |

Nur der Codeblock des Befehls im Assistenten scrollt in sich seitlich (wie vorgesehen, `CodeBlock`); die Seite nicht.

### 6.4 Regressionsschutz

- **Statisch** (`web/src/lib/no-control-overflow.test.ts`, BYL-E6-1180): Jede Flex-Zeile einer Komponente, die ein Textfeld, Select oder eine Textarea zusammen mit Knöpfen hält, muss umbrechen (`flex-wrap: wrap` bzw. `flex-flow … wrap`), ebenso eine Gruppe von mindestens zwei Textknöpfen in einer solchen Zeile; Symbolknöpfe (je 2rem) dürfen beisammen bleiben. Der Test liest dazu das Markup jeder Komponente als Baum (Svelte-Ausdrücke übersprungen). Dazu prüft er, dass Karte und Details von `ChannelCard` eine Spalte `minmax(0, 1fr)` haben und Kopf, Formular und Knopfgruppe umbrechen. Mit dem Stand vor diesem Fix schlägt er fehl (`.head` und `.rename-actions`, Spalte der Karte).
- **Komponente** (`channel-card.test.ts`, BYL-E6-1181): Umbenennen eines Namens mit 100 Zeichen markiert den Kopf (`renaming`), das Feld steht vor der Gruppe der Knöpfe, ohne `size`, die Überschrift bleibt für Screenreader, Esc stellt den Kopf zurück.
- **Warum nicht im Browser automatisiert:** wie §5. jsdom rechnet kein Layout (alle Breiten 0), und die Komponententests laden kein CSS der Komponenten; ein Browser-Test bräuchte Playwright oder einen Browser im CI. Die Messung oben bleibt die Grundlage, die Wirkung prüfen die manuellen Fälle BYL-E6-1182 (schmal) und BYL-E6-1183 (lange Namen, Details).
