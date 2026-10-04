# ADR-0026: Einstellungsbereich, Hinweis-Bausteine, Einrichtungsassistent und geführte Tour

- **Status:** Angenommen
- **Datum:** 2026-09-26
- **Entscheidung durch:** Nutzer (Fragen 2 bis 4 in Abschnitt 9, 2026-09-26), Advisor (übrige Festlegungen)
- **Ergänzt:** [ADR-0025](0025-ui-konsistenz-overlay-system.md) (Overlay-System; die Hinweis-Bausteine sind keine Overlays, die Tour ist eine begrenzte Ausnahme, Abschnitt 8)
- **Plan:** [docs/plan/e6-einstellungen.md](../plan/e6-einstellungen.md) (Pakete EH-0 bis EH-13, Ziel-Spezifikation, Risiken)

## Kontext

Der Nutzer bemängelt vier Dinge:

1. Die Seite „Kanäle“ und ihr Link sind schlecht dargestellt.
2. Aus „Kanäle“ kommt man nicht normal zurück.
3. Das Seitenpanel soll wie in Jira eingebettet sein.
4. Die Anleitungen sollen besser dargestellt werden.

Punkt 3 ist mit UI-6b erledigt ([ADR-0025](0025-ui-konsistenz-overlay-system.md) §11).

Befund (Einzelheiten im [Plan](../plan/e6-einstellungen.md) §1):

- **Einstieg:** Er ist ein nackter Textlink „Kanäle“ zwischen umrandeten Knöpfen. Der App-Name ist kein Link. Die Seite hat keinen Umschalter, keinen Rückweg und keinen Brotkrumenpfad.
- **Kanäle:** Die Seite ist eine lange Spalte aus sieben Anleitungslisten mit 29 Schritten, die immer offen sind. Sie stehen unter dem Formular, auf das sie verweisen.
  - Befehle wie `setx` stehen als Inline-Code im Fließtext.
  - Die Anleitungen kennen den Zustand der Verbindung nicht.
- **Verbindungen:** Eine Verbindung ist 350 bis 450 px hoch. Ob sie funktioniert, muss man aus vier Textzeilen ableiten.
- **Hinweise:** Es gibt vier Formen (`.hint`, `.notice`, `.alert-error`, `role="status"`), und 23 Komponenten definieren sie lokal.
  - Drei Hinweise nach einer Migration nennen nur „(start.bat)“. Das ist falsch: Läuft die App, öffnet `start.bat` nur den Browser, und die Migration läuft erst nach „stop.bat, dann start.bat“.
- **Bookmarklet:** Es zeigt den rohen `javascript:`-Code in einer `textarea`, der ziehbare Link wirkt wie ein Chip.

Grenzen:

- Clean-Room nach [ADR-0010](0010-layout-nach-task-board.md) §4
- Rot nur für echte Fehler ([ADR-0009](0009-fehlerfarbe.md))
- Zugangsdaten nur als Windows-Variable ([ADR-0018](0018-secrets.md))
- keine externen CDNs (CLAUDE.md §3)
- das Overlay-System aus [ADR-0025](0025-ui-konsistenz-overlay-system.md)

## Entscheidung

### 1. Einstellungsbereich `/einstellungen/*`

- **Unterseiten:**
  - Kanäle (`/einstellungen/kanaele`, die Adresse bleibt)
  - Datei-Importe
  - Darstellung
  - Konto
  - Hilfe
- `/einstellungen` leitet auf „Kanäle“ weiter. Eine Unterseite erscheint in der Navigation erst mit ihrem Paket, so gibt es keinen toten Link.
- **Aufbau:**
  - Direkt unter der Kopfzeile steht der Umschalter „Aufgaben | Projekte | Eingang“, **ohne** aktiven Eintrag (`ViewSwitch` mit `current = null`).
  - Darunter steht links die Unternavigation (`nav aria-label="Einstellungen"`, Links mit `aria-current="page"`, keine Tabs). Ihr erster Eintrag ist „← Zurück zu ‹Ansicht›“.
  - Rechts stehen der Brotkrumenpfad „Einstellungen › ‹Unterseite›“ und die Überschrift `h2` als Fokusziel.
  - Unter 64rem steht die Navigation als umbrechende Zeile über dem Inhalt.
- **Volle Breite (Nutzervorgabe):**
  - Der Bereich hat dieselbe Seitenbreite und dieselben Ränder wie „Aufgaben“. Er ist nicht nach links gedrückt und hat keine Höchstbreite.
  - Nur Fließtext bekommt eine lesbare Zeilenlänge.
- **Rückweg:** Das `(app)`-Layout merkt sich per `afterNavigate` die letzte Adresse außerhalb von `/einstellungen` und außerhalb von `…/voll`, also Ansicht, Filter, Suche, Gruppierung und offenes Panel.
  - Speicherort: `sessionStorage` `byl-last-view`.
  - Beim Lesen prüft `safeRedirect` den Wert gegen offene Umleitungen. Rückfall ist `/`.
  - Die Beschriftung folgt dem Ziel („Zurück zu Aufgaben“, „… zu Projekte“, „… zum Eingang“, „… zu BYL-12“, „… zum Eintrag“).
- **Kopfzeile:**
  - Ein Zahnrad-Symbolknopf „Einstellungen“ (`.button-icon`, Tooltip) ersetzt den Textlink „Kanäle“. Unter `/einstellungen/*` trägt er `aria-current="page"` und die Marke-Fläche.
  - Der App-Name wird ein Link auf „Aufgaben“; der Zähler steht außerhalb des Links.
  - Mit der Hilfe (EH-9) kommt ein „?“-Menü dazu.

### 2. Hinweis-Bausteine (keine Overlays)

Die Bausteine liegen unter `web/src/lib/components/guidance/`, ihre reine Logik unter `web/src/lib/guidance/`. Sie sind **keine Overlays**; die Regel „genau sechs Overlay-Bausteine“ aus ADR-0025 §1 bleibt unberührt.

- **`SectionMessage`:**
  - Töne `info`, `success`, `warning`, `error`, dazu eine kompakte Variante.
  - Immer mit Icon und einem versteckten Präfix („Hinweis:“, „Erledigt:“, „Achtung:“, „Fehler:“).
  - Mit `live` bekommt er die Rolle `status` bzw. bei Fehlern `alert`; ohne `live` hat er keine Rolle.
  - **Warnung ohne Gelb:** neutrale Fläche und Linie, fetter Titel, eigenes Icon. Farbe ist nie das einzige Merkmal.
  - Rot nur beim Ton `error`, mit denselben Tokens wie `.alert-error`.
- **`EmptyState`:**
  - Größen `wide`, `narrow` und `compact`.
  - Aufbau: Überschrift in Satzschreibung, ein Satz Beschreibung, höchstens **ein** Primärknopf mit Verb.
  - Das Icon ist eine Linien-SVG in `currentColor`.
- **`Lozenge`:**
  - Töne `neutral`, `brand`, `danger` (nur für einen echten Fehler) und `muted`.
  - Nicht interaktiv, Satzschreibung, immer mit Icon.
  - `StatusPill` bleibt eigenständig.
- **`CodeBlock`** (mit „Kopieren“), **`ExternalLink`** (nur `https:`, `rel="noopener noreferrer"`, Hinweis „öffnet in neuem Tab“) und **`Stepper`** nach dem Plan §3.9 und §3.11.
- **Einheitlicher Neustart-Hinweis:** ein Text `RESTART_NEEDED` in `lib/guidance/texts.ts`.
  - Titel „Nach dem nächsten Neustart verfügbar“, Text mit „stop.bat, dann start.bat“ im Ordner `app`.
  - Er ersetzt die fünf verstreuten Wortlaute.
  - Ein statischer Test verbietet „(start.bat)“ ohne „stop.bat“ in Migrationshinweisen.
- Keine neuen Farb- und Maß-Tokens. Die Breite der Unternavigation (15rem) ist ein Layoutmaß der Seite.

### 3. Kanäle als Karten

- Jede Verbindung ist eine Karte (`article`) mit Symbol, Name, Untertitel, Status-Lozenge, höchstens zwei Metazeilen, höchstens einem kompakten Hinweis und den Aktionen.
- **Status aus einer reinen Funktion `channelHealth`**, Reihenfolge der Prüfung:

  | Rang | Bedingung | Lozenge |
  |---|---|---|
  | 1 | Abruf läuft | „Wird abgerufen“ |
  | 2 | ausgeschaltet | „Pausiert“ |
  | 3 | Variable fehlt | „Nicht eingerichtet“ |
  | 4 | letzter Fehler | „Fehler“ (Fehlertokens) |
  | 5 | sonst | „Eingerichtet“ |

  Ist der Status der Variablen unbekannt, entfällt Rang 3.
- **Aktionen:**
  - „Jetzt abrufen“ bzw. „Aus dem Postfach wählen“
  - „Bearbeiten“ öffnet ein Modal M. Dort stehen Stichwörter und Schalter; jede Änderung speichert sofort, deshalb heißt der Fuß „Schließen“.
  - Das Menü „…“ (Popover `menu`) enthält „Pausieren“ bzw. „Fortsetzen“, „Einrichtung ansehen“ und „Löschen …“. Löschen fragt über die vorhandene Bestätigung, nicht aus dem Modal heraus.
- Die Checkbox „Eingeschaltet“ und der je Postfach wiederholte Neustart-Hinweis entfallen.
- Das Dauerformular „Neue Verbindung“ entfällt. Angelegt wird über den Katalog „Kanal hinzufügen“. Bis zum Assistenten (EH-5) öffnet der Katalog das bisherige Formular als Modal M.

### 4. Einrichtungsassistent

- **Rahmen:** ein Modal L mit Stepper, höchstens 6 Schritte je Dienst, Adresse `?einrichten=<art>&verbindung=<id>`.
- **„Weiter“ ist nie gesperrt:** Prüfungen sind Hilfen, keine Schranken. Offene Prüfungen nennt der nächste Schritt.
- **Fortschritt aus Serverdaten:** Die reine Funktion `setupProgress` leitet ihn ab aus Verbindung, Status der Variablen, Stichwörtern, letztem Abruf und letztem Fehler, nicht aus Speicher. Nach „stop.bat, dann start.bat“ geht es deshalb an der richtigen Stelle weiter. `sessionStorage` merkt sich nur die zuletzt angesehene Schrittnummer, nie einen Wert.
- **Live-Prüfungen:**
  - Die Variable ist sichtbar (ja/nein, ADR-0018 §4).
  - Stichwörter sind vorhanden.
  - Das Ergebnis von „Jetzt abrufen“.
  - Bei Postfächern der erste Abruf, per Realtime-Abo auf genau diese Verbindung (kein Polling).
  - „Hilfsprozess prüfen“ läuft nur auf Klick.
- **Nicht prüfbar, und so benannt:**
  - ob `setx` ausgeführt wurde, bevor die App neu gestartet ist
  - ob der Wert vor dem ersten Abruf stimmt
  - ob der IMAP-Schalter beim Anbieter an ist
- Proton (drei kurze Schritte, Weg über `.eml`) bekommt keinen Stepper, sondern ein Modal M mit einer nummerierten Liste.

### 5. Feld „Wert hier einsetzen“ (Nutzerentscheidung 2)

- **Aufbau:**
  - Unter dem Befehl steht zugeklappt `<details>` „Wert hier einsetzen (bleibt in diesem Browserfenster)“.
  - Geheime Werte bekommen ein Passwortfeld mit „Anzeigen“ (`aria-pressed`) und `autocomplete="off"`, `spellcheck="false"`, `autocapitalize="off"` sowie Attribute gegen Passwortmanager.
  - Nicht geheime Werte (Telegram-IDs) bekommen ein offenes Textfeld.
- **Umgang mit dem Wert:**
  - Er lebt nur in einem lokalen `$state` der Komponente: kein Store, kein Web Storage, kein Request, kein `console`, kein Flag.
  - Die Vorschau maskiert ihn. „Kopieren“ kopiert den fertigen Befehl.
  - Nach dem Kopieren und beim Schließen wird er geleert.
- **Hinweis direkt am Feld** (kompakte Warnung): „Windows merkt sich Kopiertes im Zwischenablage-Verlauf (Win+V), falls er eingeschaltet ist. Dort kannst du den Eintrag danach löschen.“
- **Gleichwertiger Weg:** Die Systemsteuerung (Tab „Systemsteuerung“ im Schritt „Variable setzen“) kommt ohne Zwischenablage aus.
- **Tests (EH-5):** Die Datenschicht-Attrappe erhält den Wert nie, Web Storage enthält ihn nach Kopieren und Schließen nicht, das DOM enthält ihn nach dem Schließen nicht, die Anzeige maskiert.

### 6. Code-Block, externe Links und Bookmarklet-Karte

- **`CodeBlock`:**
  - `figure` mit Beschriftung, `pre`/`code` als per Tastatur scrollbare Region.
  - Hervorgehobene Platzhalter in ‹spitzen Klammern›, mit dem versteckten Zusatz „Platzhalter:“.
  - „Kopieren“ zeigt 2 s lang „Kopiert“ und meldet das per `role="status"`. Scheitert die Zwischenablage, markiert er den Code und nennt Strg+C. Kein Flag, damit sich nichts doppelt.
- **Bookmarklet-Karte:**
  - Eine gestaltete Karte mit einem ziehbaren Knopf in Pillenform: Griff-Icon, Text „In den Eingang“, Beschreibung per `aria-describedby`.
  - Ein Klick auf den Knopf wirkt nicht und erklärt, warum.
  - Die `textarea` mit dem rohen Code entfällt. Der Weg ohne Maus steht als `CodeBlock` in `<details>`.
  - Eine eigene kleine Illustration zeigt das Ziehen auf die Lesezeichenleiste:
    - Sie läuft zweimal beim ersten Sichtbarwerden und danach einmal bei Hover oder Fokus des Knopfs.
    - Bei `prefers-reduced-motion: reduce` zeigt sie statt der Bewegung einen statischen Pfeil.

### 7. Hilfe und „Erste Schritte“

- **Hilfe (`/einstellungen/hilfe`):**
  - Inhalt: Tastaturkürzel aus einer Quelle (`lib/domain/shortcuts.ts`), Kurzsyntax, häufige Fragen, Betrieb.
  - Die Taste `?` öffnet das Modal „Tastaturkürzel“. Wie bei `c` gilt das nicht in Feldern, Dialogen und Popovers.
- **„Erste Schritte“ (Nutzerentscheidung 3):**
  - eine Liste im leeren Zustand der Aufgabenansicht
  - ~~Sie erscheint nur ohne Tickets **und** ohne Verbindung. Ihr Zustand wird aus Daten abgeleitet, nicht gespeichert. Sie verschwindet von selbst.~~
  - **Geändert mit EH-12 (Vorgabe zum Paket, 2026-09-26):** Die Liste steht unter dem leeren Zustand „Keine offenen Tickets“ und zeigt Fortschritt („2 von 4 erledigt“) über die Schritte erstes Ticket, Schnellerfassung ausprobiert, Kanal eingerichtet, Projekt angelegt und (ab EH-13) Tour gestartet. Erreichte Schritte und „Ausblenden“ merkt sich der Browser (`localStorage` `byl-first-steps`, nur auf diesem Gerät, keine Daten des Kontos). Sie verschwindet, wenn der Nutzer sie ausblendet oder alle angebotenen Schritte erledigt sind. Einzelheiten im [Plan](../plan/e6-einstellungen.md) §7 (EH-12).

### 8. Geführte Tour mit driver.js (Nutzerentscheidung 3, begründete Ausnahme)

Der Nutzer wünscht zusätzlich eine optionale Tour. Sie kommt mit **driver.js**:

- MIT-Lizenz, ohne Abhängigkeiten, Stand 1.8.0
- **lokal gebündelt** über npm und Vite, **kein CDN**, gepinnt im Lockfile, von Dependabot überwacht
- **intro.js ist ausgeschlossen:** AGPL-3.0, und die üblichen Anleitungen binden es per CDN ein.

Grenzen, damit die Ausnahme klein bleibt:

- **Nur manuell:** Start über „Kurze Einführung“ im „?“-Menü und aus „Erste Schritte“. Nie automatisch, auch nicht beim ersten Login (ADS rät von Touren bei Neuanmeldung ab).
- **Höchstens etwa 5 Schritte.** Die Ziele hängen an stabilen `data-tour`-Attributen, nicht an CSS-Klassen, und ein Test prüft, dass jedes Ziel existiert. Fehlt ein Ziel, entfällt der Schritt.
- **Aussehen:**
  - Eigene Styles mit den Tokens aus `tokens.css`, in hell und dunkel: Fläche, Linie, Text, Marke, Radien, Motion-Tokens.
  - Kein Schatten, Schleier `--color-blanket`.
  - Farben nur aus den Tokens; der statische Test der Farbwerte gilt auch hier.
  - Bei reduzierter Bewegung ohne Animation.
- **Bedienung:**
  - Deutsche Knopftexte („Weiter“, „Zurück“, „Fertig“, Schließen).
  - Esc beendet die Tour, und der Fokus kehrt zum Auslöser zurück.
- **Einordnung:**
  - Die Tour ist eine begrenzte Ausnahme von ADR-0025 §1: „genau sechs Bausteine“, „keine UI-Bibliothek“.
  - Sie ersetzt keinen der sechs Bausteine, und keine andere Stelle darf driver.js nutzen.
  - Sie gehört zu keiner Escape-Kette der übrigen Overlays, weil sie nur allein läuft; beim Start schließt sie offene Popover.
- **Umsetzung:** eigenes, letztes Paket EH-13 nach EH-9 und EH-12.

### 9. Entscheidungen des Nutzers (2026-09-26)

| Nr. | Frage | Entscheidung |
|---|---|---|
| 1 | Panel ab 1024 px eingebettet, darunter Overlay? | **Ja**, umgesetzt mit UI-6b (ADR-0025 §11). |
| 2 | Feld „Wert hier einsetzen“ im Assistenten? | **Ja:** zugeklappt, als Passwortfeld, mit Hinweis auf den Zwischenablage-Verlauf (Win+V); offen für nicht geheime Werte. |
| 3 | Einführungstour? | **„Erste Schritte“-Liste plus optionale geführte Tour mit driver.js:** MIT, lokal gebündelt, kein CDN, mit unseren Tokens für hell und dunkel, nur manuell über das „?“-Menü und aus „Erste Schritte“, höchstens etwa 5 Schritte. intro.js wegen AGPL und CDN ausgeschlossen. |
| 4 | Breite des Einstellungsbereichs | **Volle Breite** wie „Aufgaben“ (gleiche Seitenbreite und Ränder, nicht nach links gedrückt), mit Unternavigation links, Zahnrad in der Kopfzeile, Rückweg mit Zustand, Brotkrumenpfad, Umschalter ohne aktiven Eintrag und App-Name als Link. |

### 10. Restrisiko der Zwischenablage (Abschnitt 5)

Die App speichert weiter nur Namen, nie Werte (ADR-0018 bleibt unverändert). Beim Kopieren eines fertigen Befehls mit Wert bleiben diese Risiken außerhalb der App:

- der Windows-Zwischenablage-Verlauf (Win+V) und die Cloud-Zwischenablage, falls eingeschaltet
- Browsererweiterungen mit Zugriff auf die Seite
- der Befehlsverlauf des offenen `cmd`-Fensters (nicht dauerhaft; das Schließen des Fensters leert ihn)

Der Hinweis am Feld nennt den Verlauf. Die Systemsteuerung ist als gleichwertiger Weg ohne Zwischenablage angeboten. Die Rechtschreibprüfung des Browsers ist abgeschaltet, weil die erweiterte Prüfung von Chrome und Edge Feldinhalte an einen Dienst sendet.

## Alternativen

- **Einstellungen als Modal (Muster des Task-Boards):** zu viel Inhalt, keine eigenen Adressen, kein Rückweg per Browser. Verworfen.
- **Einstellungsbereich schmal und links (Entwurf: Inhalt höchstens 56rem):** Vom Nutzer verworfen zugunsten der vollen Breite wie „Aufgaben“.
- **Tabs statt Unternavigation:** Die Unterseiten haben eigene Adressen, wie der Umschalter nach ADR-0010 §5. Verworfen.
- **Anleitungen weiter als offene Listen auf der Seite:** Das ist die Textwand aus dem Befund, ohne Bezug zum Zustand. Verworfen zugunsten von Karten und Assistent.
- **Nur Platzhalter, Wert selbst einfügen:** sicherer, aber fehleranfälliger. Vom Nutzer zugunsten des optionalen Feldes verworfen; der Platzhalter-Weg bleibt ohne das Feld möglich.
- **Tour selbst auf dem Popover-Baustein, ohne Bibliothek (Empfehlung des Entwurfs):** braucht eigene Hervorhebung, Schleier und Positionierung über mehrere Ziele. Mit driver.js bleibt sie klein und gepflegt. Vom Nutzer zugunsten von driver.js entschieden.
- **intro.js:** AGPL-3.0 und CDN. Ausgeschlossen.
- **Tour automatisch beim ersten Login:** widerspricht ADS und dem Nutzerwunsch („nur manuell“). Verworfen.

## Konsequenzen

- ADR-0025 bekommt einen Verweis: Die Hinweis-Bausteine sind keine Overlays, und die Tour ist die einzige Ausnahme von „keine UI-Bibliothek“.
- CLAUDE.md §3 (Tech-Stack) nennt driver.js erst mit EH-13, wenn die Abhängigkeit wirklich dazukommt. CLAUDE.md §7 und §8 beschreiben Kopfzeile, Einstellungsbereich und Hinweis-Bausteine je Paket.
- 14 Pakete (EH-0 bis EH-13), jedes mit eigenem PR und grünen Gates. Manifest-IDs `BYL-E6-029` bis `BYL-E6-059` (reserviert bis `BYL-E6-064`).
- Die Seite „Kanäle“ wird kürzer. Ihre Adresse bleibt, Lesezeichen und README-Verweise bleiben gültig. Der Link im Datei-Dialog zeigt auf „Datei-Importe“.
- Die Stores behalten ihre Zustände. Nur die Wortlaute der Hinweise nach Migrationen ändern sich (EH-2); betroffene Tests werden im PR begründet angepasst.
- jsdom kennt weder Ziehen noch Animation noch eine echte Zwischenablage. Dafür gibt es reine Funktionen, Attrappen und manuelle Fälle im Manifest.

## Nachtrag (2026-09-28, Plan „Wiederholungen verständlich machen“, WK-4)

- §7: Die Hilfe hat den Abschnitt „Wiederholungen“ nach „Kurzsyntax“ (`HELP_SECTIONS`, `helpHref('wiederholungen')`). Er folgt den Regeln der Seite: keine Tabelle, Begriffe als Beschreibungsliste, die Beispiele als nummerierte Zeitleisten. Seine Daten rechnet die App aus ihrer Erzeugungslogik ([ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 7).
- §2: Kontextuelle Hilfe im Formular „Wiederholen…“ als zugeklappter Bereich „So funktioniert’s“ (`<details>` mit `SectionMessage` info, kompakt); der Link in die Hilfe öffnet einen neuen Tab, damit Eingaben in Dialog und Panel nicht verloren gehen.

## Nachtrag (2026-09-30, Plan „Kanal-Karten“, KK-1): Gesperrt ist nicht beschäftigt

**Anlass:** Nach einem Notion-Import war der Import-Knopf gesperrt ([ADR-0041](0041-notion-listen-uebernehmen.md), Nachtrag vom 2026-09-30). `base.css` gab jedem gesperrten Knopf den Warte-Zeiger (`cursor: progress`); der Nutzer las ihn als „läuft noch“. Der Zeiger vermischte „beschäftigt“ mit „geht gerade nicht“.

**Entscheidung (Advisor):**

- **Gesperrt** (`disabled` oder `aria-disabled="true"`) zeigt `cursor: not-allowed`, in `base.css` für `.button-primary`, `.button-secondary`, `.button-subtle` und `.button-icon`, wie schon für Checkboxen, Radios und die lokal gestalteten Knöpfe (Bereichs-Umschalter, Formular-Knöpfe). Der Standardzeiger wäre die andere Wahl gewesen; er sagt über einem Knopf, der wie ein Knopf aussieht, aber nichts. „Nicht erlaubt“ ist die Windows-Konvention für ein Element, das gerade nicht geht, und warum, steht weiter im Text daneben (`aria-describedby`).
- **Beschäftigt** zeigt `cursor: progress` nur mit `aria-busy="true"`: am Knopf, dessen Aktion läuft („Wird gespeichert …“), oder an seinem Bereich (Dialog mit `busy`, Formular, Frage, Zeile, Leiste der Sammelaktionen). Gesperrte Controls in einem beschäftigten Bereich zeigen ihn ebenfalls, weil sie nur warten; ein Knopf, der im Bereich bedienbar bleibt („Nach diesem Block anhalten“), behält den Zeiger für Klicks. Ist der Lauf zu Ende, verschwinden `aria-busy` und mit ihm der Warte-Zeiger.
- `aria-busy` tragen jetzt auch die laufenden Aktionen, die es noch nicht hatten: Leiste der Sammelaktionen (`SelectionBar`, solange der Fortschritt steht), „Papierkorb leeren …“ während einer Sammelaktion, Speichern in „Neues Ticket“, „Erfassen“, Projekt-Panel, Regel-Panel, Beschreibung, Kommentaren, Umbenennen eines Tags und Stichwörtern, „Übernehmen“ und „Lösen“ beim übergeordneten Ticket, Zeilen und Panel des Eingangs, Quellen eines Tickets, Wiederherstellen im Papierkorb, Rückstand einer Regel, Pausieren einer Regel, „Weitere laden“, Fälligkeit im Panel, Zellen der Tabelle, Dateiauswahl, Anmelden, „Erneut versuchen“ der Sitzung, „Prüfen“ im Assistenten für WhatsApp Web und „Hilfsprozess prüfen“ der Postfächer (vorher ohne Sperre, jetzt „Hilfsprozess wird geprüft …“). Dialoge mit `busy` („Gesammelt umwandeln“, Import aus Datei, Zwischenablage, WhatsApp, Postfach, Notion, Bestätigungen) waren es schon.
- **Test:** `web/src/lib/no-busy-cursor.test.ts` prüft `base.css` und den Stil jeder Komponente statisch: gesperrte Knöpfe zeigen „nicht erlaubt“, der Warte-Zeiger steht nur in Regeln mit `aria-busy`, und keine Regel gibt einem nur gesperrten Control einen anderen Zeiger. jsdom rechnet keinen Zeiger aus; die Sicht im Browser ist ein manueller Fall (BYL-E6-622).

## Nachtrag (2026-09-30, Plan „Kanal-Karten“, KK-2): Ein Baustein für alle Kanal-Karten

**Anlass:** Nutzerwunsch „Darstellungen und Optionen von Kanälen-Cards anpassen ohne funktionale Einbußen in der Anzeige“, Vorschlag des Advisors vom Nutzer freigegeben („Vorschlag passt“). Bis dahin gab es fünf Karten mit eigenem Aufbau: Verbindung (bis zu sechs Metazeilen und vier Knöpfe), Notion (zwei Hauptknöpfe), eigener Eingang (Liste immer offen, keine Lozenge), WhatsApp Web und Dateien (ohne Zustand, Links statt Knöpfe), mit unterschiedlichen Abständen und Schriftgrößen.

**Entscheidung** (ergänzt §3, ersetzt dort „höchstens zwei Metazeilen“ und die Aktionen „Bearbeiten“ und „Aus dem Postfach wählen“ neben dem Hauptknopf):

- **Ein Baustein** `components/channels/ChannelCard.svelte`, die Arten sind nur Konfigurationen: `ConnectionCard` (Google Calendar, Telegram, Web.de, Gmail), `NotionCard`, `OwnInboxCard`, `WhatsAppWebCard`, `FilesCard` (`.eml` auch aus Proton, `.ics`, WhatsApp-Export). Die Bookmarklet-Karte bleibt nach §6 eine gestaltete Karte mit ziehbarem Knopf (kein Knopf im Sinn des Bausteins) und übernimmt nur Rahmen, Kopf und Schriftgrößen.
- **Aufbau:**
  1. **Kopfzeile:** Symbol, Name, Untertitel (Art, bei Postfächern Anbieter und Benutzer) und Zustand als Lozenge. Zustände: „Verbunden“, „Pausiert“, „Fehler“, „Einrichtung offen“, „Neustart nötig“, dazu während einer Anfrage „Wird abgerufen“ bzw. „Wird geprüft“. „Verbunden“ ersetzt „Eingerichtet“, „Einrichtung offen“ ersetzt „Nicht eingerichtet“. Rot nur bei „Fehler“. Neu ist „Neustart nötig“: ein Postfach, dessen Hilfsprozess nicht läuft, einen anderen Zugang hat oder veraltet ist (Reihenfolge in `channelHealth` nach „Fehler“), und der eigene Eingang vor seiner Migration. Die Kacheln des Katalogs behalten „Nicht eingerichtet“, weil sie Arten ohne Verbindung meinen.
  2. **Genau eine Infozeile**, je Art: „Zuletzt abgerufen vor 5 Min. · 3 neu, 1 schon vorhanden“ (Verbindung, während der Vollsuche „Posteingang wird durchsucht: 1.200/4.800“ mit Balken), „8 Einträge aus 2 Quellen übernommen · zuletzt abgerufen …“ (Notion), „2 Schlüssel, zuletzt benutzt …“ (eigener Eingang), die Stichwörter (WhatsApp Web, Dateien). Die Zeit ist relativ („gerade eben“, „vor 5 Min.“, „heute, 10:15“, „gestern, 18:02“, sonst das Datum; Berliner Tage) und folgt einer Uhr der Seite (`minuteClock`, alle 30 s, nur die Anzeige). Darunter höchstens ein Hinweis wie bisher.
  3. **Genau ein Hauptknopf**, abhängig vom Zustand: „Jetzt abrufen“, „Fortsetzen“, „Einrichtung fortsetzen“, während der Vollsuche „Durchsuchen abbrechen“, während eines Abrufs „Wird abgerufen …“ (`aria-busy`); Notion „Listen übernehmen …“, eigener Eingang „Zugangsschlüssel erzeugen …“ (nach einem Ladefehler „Erneut versuchen“), WhatsApp Web „Einrichten“, Dateien „Zum Eingang“. Gleich gestaltet (`.button-secondary`), damit sechs Karten nebeneinander ruhig bleiben.
  4. **Alle weiteren Aktionen im Menü „•••“** (Popover `menu` nach ADR-0025 §5, Tastatur und Namen wie dort): „Aus dem Postfach wählen …“, „Stichwörter und Einstellungen …“ (bisher „Bearbeiten“; öffnet dasselbe Modal) bzw. „Stichwörter …“, „Pausieren“, „Posteingang neu durchsuchen“, „Verbindung prüfen“, „Einrichtung ansehen“, „Hilfe“ (neu, Link in die Hilfe), Trennlinie, „Löschen …“. Was der Hauptknopf gerade anbietet, steht nicht noch einmal im Menü; was er gerade verdrängt („Jetzt abrufen“ während der Vollsuche), steht dort.
  5. **Details aufklappbar** (Disclosure-Knopf „Details“ mit `aria-expanded`, `aria-controls`): die bisherigen Metazeilen (letzter Abruf mit Datum, zuletzt erfolgreich, Ergebnis, Stichwörter, Hilfsprozess, „Automatisch“, Posteingang), neu „Durchsucht“ (Postfach), „Ohne Stichwort“ (Telegram) und „Letzter Fehler“, die bisher übernommenen Listen mit „Erneut abrufen“ (Notion), die Zugangsschlüssel mit „Widerrufen …“ und die Erklärungen. Aktionen, die zu einem Eintrag der Details gehören, stehen an diesem Eintrag.
- **Keine Funktion geht verloren:** Die Inventur aller Aktionen und Anzeigen je Karte und ihre Zuordnung alt → neu stehen im Plan (§3.3) und als Tabelle in `channel-cards-inventory.test.ts`: Jede Karte wird im Zustand der alten Aktion gerendert, und der Test findet sie an ihrem neuen Ort, bedienbar.
- **Gestaltung:** undurchsichtige Karte (ADR-0029), nur Tokens für Schrift, Radius und Farben, Abstände 1rem innen und 0,75rem zwischen den Teilen, beide Raster der Seite `auto-fill` mit `minmax(min(18rem, 100%), 1fr)` und `align-items: start`, damit aufgeklappte Details die Nachbarn nicht strecken. Die Karte ist per Skript fokussierbar (`tabindex="-1"`, Ziel von „Zur Karte“), nie per Tab.
- **Nicht geändert:** Assistenten, Modals und Dialoge (Stichwörter, Postfach-Auswahl, Import, Löschen) und alle Stores; nur ihre Texte, die auf Knöpfe der Karte verweisen, nennen jetzt das Menü „•••“.

**Alternativen:** Alle Aktionen sichtbar lassen und nur Abstände angleichen (verworfen: bis zu vier Knöpfe und sechs Zeilen je Karte, der Wunsch nach Ruhe bliebe unerfüllt); Details als eigene Seite je Kanal (verworfen: ein Klick mehr für Stichwörter und Fehler, keine Nutzerfrage); „Verbunden“ auch für WhatsApp Web (verworfen: die App sieht die Erweiterung im Browser nicht, ADR-0038 §4; die Karte zeigt nur, was die App weiß).

## Nachtrag (2026-09-30, Plan „Kommentare und Listen“, KL): Lange Listen von Stichwörtern einklappbar

**Anlass:** Nutzerwunsch vom 2026-09-30 (Spec freigegeben): „unter Einstellungen > Kanäle > Cards > Details die Tag Auflistung bzw. Buzzword Liste ebenso aus-/einblendbar machen, da schnell unübersichtlich, wenn viele Buzzwords/Tags vorhanden“. Bis dahin nannten die Details nur die Zahl und die ersten drei Stichwörter („12 (todo, rechnung, #byl, +9)“); alle sah man erst im Dialog, dort alle auf einmal (bis zu 50 je Liste).

**Entscheidung** (ergänzt KK-2 Punkt 5; Advisor und Executor):

- **Ein Baustein für lange Chip-Listen:** `components/ChipList.svelte`, Regeln rein in `domain/chip-list.ts`. Die Einträge stehen als Liste (`ul` mit Namen, etwa „Stichwörter von „Gmail““) aus Chips.
  - **Einklappen:** Bis 10 Einträge stehen alle da. Darüber zeigt die Liste zuerst die **ersten 8** und den Knopf **„+ N weitere“** (Disclosure mit `aria-expanded` und `aria-controls` auf die Liste; der Name nennt Art und Liste), aufgeklappt **„Weniger anzeigen“**. So verbirgt der Knopf immer mindestens drei Einträge; „+ 1 weitere“ nähme so viel Platz wie der Eintrag selbst.
  - **Filter:** Ab **mehr als 20** Einträgen steht über der Liste ein Filterfeld (`.search-field` mit Lupe, `input type="search"`, „Stichwörter filtern“). Es vergleicht ohne Groß-/Kleinschreibung, Akzente und Umlautpunkte, ß wie ss, mehrere Wörter müssen alle vorkommen, mit derselben Normalisierung wie der `TicketPicker` (`normalizeSearch`, `searchWords` aus `domain/ticket-picker.ts`, [ADR-0042](0042-tickets-und-projekte-aus-listen-waehlen.md) §2). Beim Filtern stehen alle Treffer ungekürzt da, daneben „N von M“ bzw. „Keine Treffer“; eine Statusregion sagt die Zahl nach einer kurzen Pause an. Esc im Feld leert zuerst den Filter und wird verbraucht (Escape-Kette, [ADR-0025](0025-ui-konsistenz-overlay-system.md) §1).
  - Aufgeklappt und Filter gelten, solange der Baustein steht (Details zugeklappt und wieder auf: gleich). Nur Tokens, kein neuer Farb- oder Maß-Token; die Chips sehen aus wie die des Stichwort-Editors (Akzentfläche, `--radius-pill`).
- **Kanal-Karten:** In den Details stehen die Stichwörter als Chip-Liste statt der Zusammenfassung: Verbindungen (Zeile „Stichwörter“), eigener Eingang („Stichwörter für „mode: auto““), neu auch WhatsApp Web („Stichwörter für „Automatisch““) und Dateien (je Art „Mail (.eml)“, „Kalender (.ics)“, „WhatsApp-Export“), weil beide ihre Stichwörter bisher nur als Zahl zeigten. Ohne Stichwörter steht „keine“. Die Infozeile behält ihre kurze Zusammenfassung (genau eine Zeile, KK-2 Punkt 2). Tags haben die Karten keine; die Liste der Spec meint dieselben Stichwörter.
- **Weitere Stellen, geprüft** (Spec: nur einsetzen, wenn es ohne Funktionsverlust geht):
  - **Stichwort-Editor** (`KeywordEditor`: „Stichwörter und Einstellungen …“, „Stichwörter …“, die Einrichtungsassistenten, Seite „Datei-Importe“): **eingesetzt**, die Chips tragen weiter ihren Knopf „Stichwort „…“ entfernen“. Damit ein neues Stichwort nie verdeckt entsteht, klappt die Liste nach „Hinzufügen“, Komma, Enter, Einfügen und „Vorschläge übernehmen“ auf und leert den Filter. Rücktaste im leeren Feld holt wie bisher das letzte Stichwort ins Feld, auch wenn es eingeklappt war.
  - **Nicht eingesetzt:** der `TagPicker` (Tags eines Tickets: wenige, und die Eingabe arbeitet mit der Rücktaste am sichtbaren Ende der Liste), die Tabelle „Aufgaben“ (hat schon „+N“ nach [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md) §6), die Tag-Verwaltung unter „Einstellungen → Tags“ (eine Tabelle mit Umbenennen und Löschen je Zeile, keine Chips) und die Filter-Popover (Radios mit Suchfeld ab 10 Einträgen).

**Alternativen:** schon ab 9 Einträgen kürzen (verworfen, siehe oben); die ganze Liste in einem Popover (verworfen: ein Overlay mehr, und ein Popover aus einem Dialog wäre für den Editor ein Fremdkörper); nur die Zahl zeigen und für alles den Dialog öffnen (verworfen: genau das bemängelte der Nutzer als unübersichtlich bzw. nicht einsehbar).

## Nachtrag (2026-10-01): Leerzeichen vor „(öffnet in neuem Tab)“

**Befund:** `ExternalLink` (§6) schrieb den verborgenen Zusatz als `<span class="visually-hidden"> (öffnet in neuem Tab)</span>`. Svelte 5 entfernt Leerraum am Anfang des Inhalts eines Elements; der Link hieß damit „myaccount.google.com(öffnet in neuem Tab)“. Die Tests prüften den Namen mit `\s*` und merkten es nicht. Dasselbe galt für „Mehr zur Kurzsyntax“ der Schnellerfassung. Das Menü „•••“ (AM-5, Einträge `external`) umging es mit einem Leerraum zwischen zwei Tags, der nur zufällig stehen blieb.

**Entscheidung:** Ein Baustein `components/guidance/NewTabHint.svelte` schreibt den Zusatz für alle drei Stellen: ein Leerzeichen als eigener Textknoten des Links, als Ausdruck `{' '}` geschrieben (Svelte behält ihn), dann `<span class="visually-hidden">(öffnet in neuem Tab)</span>`. Der Umweg im Menü entfällt. Gründe gegen die Alternativen:

- **Leerzeichen als Ausdruck im verborgenen Span:** Der Text stimmt dann zwar, aber die Berechnung des Namens kürzt Leerraum am Rand eines Kindelements (so `dom-accessibility-api` der Tests; der verborgene Span ist absolut positioniert, also ein eigener Block, in dem ein führendes Leerzeichen auch im Layout wegfällt). Als Textknoten des Links selbst gehört es in jeder Berechnung zum Namen.
- **Abstand per CSS** (`margin`, `padding`): erzeugt kein Zeichen, also weder im Namen noch im kopierten oder vorgelesenen Text ein Leerzeichen.

Sichtbar ist höchstens ein Leerzeichen am Ende des Links; an allen heutigen Stellen steht der Link als Flex- oder Grid-Element oder am Ende seines Absatzes, dort fällt es am Zeilenende weg. Komponententests prüfen den genauen Namen „myaccount.google.com (öffnet in neuem Tab)“, den Textknoten und die Einträge des Menüs.

## Nachtrag (2026-10-01, Plan „Kanal-Karten“, KK-3): Kanäle umbenennen

**Anlass:** Nutzerwunsch: „Es sollte auch möglich sein, Kanäle nachträglich jederzeit umbenennen zu können.“ Bisher legte nur der Schritt „Verbinden“ des Assistenten den Namen einer Verbindung (`connections.label`) fest. Danach ließ er sich nur noch in der Verwaltung von PocketBase ändern.

**Entscheidung** (ergänzt KK-2 Punkte 1 und 4; Advisor und Executor):

- **Wo:** Im Menü „•••“ jeder Karte einer Verbindung (Google Calendar, Telegram, Web.de, Gmail, Notion) steht „Umbenennen …“ vor „Einrichtung ansehen“.
  - Es öffnet keinen Dialog: Der Name in der Kopfzeile wird zum Textfeld (Name „Neuer Name für „Gmail““, Text markiert), daneben „Speichern“ und „Abbrechen“.
  - Enter speichert, Esc bricht ab und wird verbraucht. Danach steht der Fokus wieder auf „•••“.
  - Während des Speicherns ist das Formular `aria-busy`. Die Überschrift der Karte bleibt verborgen im DOM, damit die Karte ihren Namen behält.
  - Baustein: `ChannelCard` mit der Eigenschaft `rename` (`CardRename`: Namen der anderen Verbindungen, `save`). Die Konfiguration ruft `startRename()` der Karte aus ihrem Menü auf.
- **Prüfung:**
  - Der Name darf nach dem Kürzen von Leerraum am Rand nicht leer sein und höchstens 100 Zeichen haben (das Feld `label` hat `max: 100` seit der Migration `1790201400`).
  - Verstöße sind Feldfehler nach ADR-0009 (`aria-invalid`, Text mit Symbol per `aria-describedby`), mit den Texten des Hooks (`CONNECTION_LABEL_MESSAGES`, Paritätstest).
  - Ein Name, den eine andere Verbindung schon trägt (ohne Groß-/Kleinschreibung), ist erlaubt. Ein neutraler Hinweis sagt es, nicht rot: „Eine andere Verbindung heißt auch so. Das ist erlaubt; ein eindeutiger Name hilft beim Wiederfinden.“
  - Ein unveränderter Name schließt das Feld ohne Anfrage. Erfolg meldet das Flag „„Gmail“ heißt jetzt „Gmail Arbeit“.“
- **Server:** siehe [ADR-0016](0016-kanal-architektur-und-mail.md), Nachtrag vom 2026-10-01 „Name einer Verbindung“. Ändert eine Anfrage den Namen, darf sie nichts anderes ändern; Rechte wie beim Bearbeiten.
- **Sofort überall:**
  - Die Seite „Kanäle“ folgt jetzt jeder ihrer Verbindungen per Realtime (bisher nur den Postfächern). Ein Name aus einem anderen Tab erscheint gleich.
  - Eingang (Zeile „Quelle“ im Panel) und Quellen am Ticket nennen bei Einträgen mit Verbindung deren Namen, etwa „Postfach · Gmail Arbeit“ (`withConnectionName`; bei gleichem Wort nur einmal, etwa „Notion“).
  - Dafür lädt der `ConnectionNamesStore` des `(app)`-Layouts ID und Namen der sichtbaren Verbindungen einmal je Sitzung. Er folgt Umbenennen, Anlegen und Löschen per Realtime (nur `id` und `label`) und lädt nach einer Wiederverbindung neu. Die Datenschicht liefert dazu `connectionId` an jedem Eintrag.
  - Nicht betroffen: die Chips und Filter „Quelle“ (Familien nach [ADR-0019](0019-kanal-filter-und-gruppierung.md), keine Namen), die Hilfe und ihre Verweise (feste Abschnitte je Art) und die Einträge selbst (kein kopierter Name, nichts zu migrieren).
- **Nicht umbenennbar:** „Eigener Eingang (API)“, „WhatsApp Web (Browser-Erweiterung)“, „Dateien hereinziehen“ und das Bookmarklet.
  - Sie sind keine Verbindungen, sondern feste Wege der App, je einer, ohne gespeicherten Namen.
  - Ihre Einträge tragen den Namen ihres Kanals („Eigener Eingang (API)“, „WhatsApp Web“, „Mail-Datei“, „Kalenderdatei“, „WhatsApp“), der auch in Chips, Filtern, Hilfe und Assistent steht.
  - Ein eigener Name bräuchte ein neues Feld (Migration) und stünde neben diesen festen Namen. Die Zugangsschlüssel des eigenen Eingangs haben schon je einen Namen.

**Alternativen:**
- Umbenennen im Dialog „Stichwörter und Einstellungen …“ (verworfen: Notion hat diesen Dialog nicht, und der Wunsch zielt auf die Karte).
- Eigene Route `…/rename` (verworfen: Die Record-API mit Update-Regel und Hook reicht, und die Regel „nur der Name“ gilt dann für jeden Weg).
- Doppelte Namen ablehnen (verworfen: zwei Postfächer „Gmail“ sind legitim, ein Hinweis genügt).
- Namen auch in Chips und Filtern (verworfen: Die Filter arbeiten mit Familien; ein Filter je Verbindung wäre eine eigene Entscheidung zu ADR-0019).

## Nachtrag (2026-10-02, [ADR-0049](0049-zielprojekt-je-eingangsweg.md), ZP): Zielprojekt in Karte und Assistent

**Anlass:** Paket 1 der beobachteten Quellen („Standardprojekt je Verbindung“): Jede Karte, die Einträge bringt, bekommt ein optionales Zielprojekt; einzustellen in der Karte (Menü „•••“ und Details) und im Assistenten als optionaler Schritt.

**Entscheidung** (ergänzt KK-2 Punkte 4 und 5 und §4; Advisor und Executor):

- **Details:** Die Zeile „Zielprojekt“ (Baustein `CardTargetProject`) steht in den Details von Google Calendar, Telegram, Postfächern, Notion, eigenem Eingang, WhatsApp Web und Dateien, mit `ProjectSelect` (nur aktive Projekte, ein archiviertes Ziel bleibt als „(archiviert)“ sichtbar). Eine Wahl speichert sofort wie die Felder eines Tickets; Fehler am Feld, Erfolg als Flag. Der Hinweis darunter sagt, wer das Projekt bekommt, dass es nur für neue Einträge gilt, und warum ein archiviertes oder gelöschtes Ziel nichts bewirkt. Vor der Migration nennt die Zeile den Neustart.
- **Menü „•••“:** „Zielprojekt …“ (nach den Stichwörtern) klappt die Details auf und setzt den Fokus auf das Feld (`ChannelCard.showDetails`). Kein Dialog: Die Einstellung lebt an einem Ort, das Menü führt hin, wie „Umbenennen …“ zum Feld im Kopf führt.
- **§4 Assistent, „höchstens 6 Schritte je Dienst“ präzisiert:** höchstens sechs Pflichtschritte und dazu der optionale Schritt „Zielprojekt“ (Titel „Zielprojekt wählen (optional)“). Bei Verbindungen steht er direkt nach „Verbinden“, damit schon die ersten Einträge das Ziel bekommen; er gilt als erledigt, sobald die Verbindung existiert, hält also nie auf, und der Fortschritt aus den Serverdaten springt über ihn. Bei WhatsApp Web ist er der letzte Schritt (Einträge kommen erst nach der Einrichtung der Erweiterung). Der eigene Eingang hat weiter keinen Assistenten. Das Bookmarklet bekommt keine Einstellung: Beim Erfassen wählt der Nutzer das Projekt selbst.

**Alternativen:** Ein Dialog „Zielprojekt“ aus dem Menü (verworfen: zwei Orte für dieselbe Einstellung, und die Details zeigen den Wert ohnehin); der optionale Teil im Schritt „Verbinden“ statt eines eigenen Schritts (verworfen: im Stepper unsichtbar, die Vorgabe verlangt einen Schritt); der Schritt am Ende (verworfen: erste Einträge kämen ohne Ziel).

## Nachtrag (2026-10-02, [ADR-0050](0050-github-kanal-und-beobachtete-quellen.md), GH-2): Karte und Assistent von GitHub

**Anlass:** Paket 2 der beobachteten Quellen: ein Kanal „GitHub“, dessen Repositorys in der Karte verwaltet werden (Spec vom 2026-10-01: „Kanal einmal anlegen und in den Card-Optionen Details zu Repos sehen“).

**Entscheidung** (ergänzt KK-2, KL, KK-3, ZP und §4; Advisor und Executor; Einzelheiten in ADR-0050 §7):

- **Eine Verbindung, viele Einträge in der Karte:** `GitHubCard` konfiguriert `ChannelCard` wie die übrigen Karten (ein Zustand, eine Infozeile, ein Hauptknopf, der Rest im Menü „•••“). Die Repositorys stehen als Liste in den Details; jedes mit seinen Angaben und seinen Aktionen „Einstellungen …“ und „Entfernen …“ am Eintrag (KK-2 Punkt 6). „Entfernen …“ ist ein benannter Symbolknopf mit Rückfrage, damit die Zeile auch schmal passt. Die Pfade eines Repositorys nutzen `ChipList` (KL).
- **Hinzufügen und Ändern im Modal M** von der Seite aus („Repository hinzufügen …“ im Menü oder als Hauptknopf ohne Repository); im Assistenten, selbst ein Modal, stehen Formular und Rückfrage inline (kein Dialog aus dem Dialog, ADR-0025 §3).
- **Intervall in den Details** als Auswahl, die sofort speichert wie das Zielprojekt (ZP); das Zielprojekt eines Repositorys gehört zu dessen Einstellungen (Dialog) und steht in den Details als Text. `ProjectSelect` bekommt dafür eine eigene Beschriftung der leeren Wahl („Wie die Verbindung“).
- **Kein Token ist kein offener Schritt:** Ohne Token liest GitHub öffentliche Repositorys; die Karte bleibt „Verbunden“ mit einem neutralen Hinweis, der Schritt „Neu starten“ des Assistenten hat vor der Verbindung keine Prüfzeile und sagt danach nur, ob die App das Token sieht.
- **§4 Assistent:** sechs Schritte (Token anlegen, Token setzen, Neu starten, Repositorys, Zielprojekt (optional), Prüfen). „Repositorys“ legt die Verbindung mit dem ersten Repository an und gilt erst mit mindestens einem Repository als erledigt.

**Alternativen:** Eine Verbindung je Repository (verworfen: die Spec will einen Kanal, und Token, Intervall und Limit gelten für alle); ein eigener Bereich „Repositorys“ außerhalb der Karte (verworfen: KK-2 hält alles einer Verbindung in ihrer Karte); das Zielprojekt je Repository als sofort speichernde Auswahl in den Details (verworfen: „Kein Projekt“ hieße dort „wie die Verbindung“ und stünde neben der Auswahl der Verbindung; im Dialog ist die Bedeutung eindeutig).

## Nachtrag (2026-10-02, Fehlerbericht zu KK-3): Umbenennen ohne seitlichen Überlauf

**Anlass:** Fehlerbericht des Nutzers nach dem Test des GitHub-Kanals: Beim Umbenennen einer Karte scrollte die Seite seitlich („massiver Overflow-x“, alle Karten mit eigenem Namen). Ursache und Messung: [Plan Layout-Überlauf](../plan/layout-ueberlauf.md) §6. Kurz: Die Karte war ein Grid mit einer impliziten `auto`-Spalte; beim Umbenennen hatte der Kopf aus Symbol, Feld mit Knöpfen und Lozenge 402 px Mindestbreite, die Spalte wuchs mit, und mit ihr jede Zeile der Karte.

**Entscheidung** (ergänzt KK-2 „Gestaltung“ und KK-3 „Wo“; Advisor und Executor):

- **Die Karte wächst nie über ihre Breite:** Karte und Details sind eine Spalte `minmax(0, 1fr)`; was nicht passt, bricht um.
- **Kopf beim Umbenennen:** Das Feld nimmt die Breite der Zeile. „Speichern“ und „Abbrechen“ stehen daneben, auf schmalen Karten darunter, auf sehr schmalen untereinander. Passen Feld und Lozenge nicht nebeneinander, steht die Lozenge unter dem Feld; ohne Umbenennen bleibt der Kopf eine Zeile wie bisher.
- **Regel für alle Komponenten** ([CLAUDE.md](../../CLAUDE.md) §8 „Breite von Formular-Controls“): Eine Flex-Zeile mit Textfeld, Select oder Textarea und Knöpfen bricht um, ebenso eine Gruppe von Textknöpfen darin; statisch geprüft in `no-control-overflow.test.ts`.

**Alternativen:** Umbenennen in einem Dialog (verworfen: KK-3 hat bewusst keinen Dialog, und der Fehler lag nicht im Ort, sondern im Layout); die Lozenge während des Umbenennens ausblenden (verworfen: der Zustand der Karte ginge verloren, und die Knöpfe allein liefen auf schmalen Karten weiter über); eine feste Breite des Feldes (verworfen: genau das verbietet §8, und lange Namen bräuchten sie trotzdem nicht).

## Nachtrag (2026-10-02, [ADR-0051](0051-ordner-kanal-verweise-statt-kopien.md), OD-2): Karte und Assistent der Ordner

**Anlass:** Paket 3 der beobachteten Quellen: ein Kanal „Ordner“, dessen Ordner wie die Repositorys von GitHub in der Karte verwaltet werden.

**Entscheidung** (ergänzt KK-2, KL, KK-3, ZP, GH-2 und §4; Executor; Einzelheiten in ADR-0051 §7 mit Nachtrag OD-2):

- **Dasselbe Muster wie GitHub:** `FolderCard` konfiguriert `ChannelCard`; die Ordner stehen als Liste in den Details mit ihren Angaben (Dateien, letzte Änderung, Prüfung, Unterordner, Typen und Ausschlüsse als `ChipList`, Zielprojekt, „Änderungen melden“) und ihren Aktionen „Einstellungen …“, „Vorhandene Dateien übernehmen …“ und dem benannten Symbolknopf „… entfernen …“ mit Rückfrage. Intervall als sofort speichernde Auswahl; Hinzufügen und Ändern im Modal M, im Assistenten inline.
- **Menü in der Reihenfolge der Spec:** „Ordner hinzufügen …“, „Jetzt prüfen“ (nur wenn nicht Hauptknopf), „Zielprojekt …“, „Umbenennen …“, „Pausieren“, „Hilfe“, „Löschen …“. Kein „Einrichtung ansehen“: Ohne Variable und Neustart gibt es nach dem Anlegen nichts einzurichten, was die Karte nicht selbst kann.
- **Ohne Zugangsdaten nie „Einrichtung offen“:** Die Karte fragt keinen Zustand einer Variablen ab; ein nicht erreichbarer Ordner ist eine Warnung an diesem Ordner, kein Zustand der Karte.
- **§4 Assistent:** vier Schritte (Pfad kopieren, Ordner, Zielprojekt (optional), Prüfen). „Pfad kopieren“ hat keine Prüfung und gilt als erledigt, sobald die Verbindung einen Ordner hat; „Ordner“ legt die Verbindung mit dem ersten Ordner an und gilt erst mit mindestens einem Ordner als erledigt; „Prüfen“ nach einem Lauf ohne Fehler. Der Hinweis auf Linux-Server über den Variablen entfällt (keine Variablen), der Schritt „Pfad kopieren“ nennt Linux und Container selbst.
- **Katalog:** Kachel „Ordner“ mit eigenem Symbol (Ordner mit Auge, keine Marke).

**Alternativen:** Ein Ordner-Auswahldialog des Browsers (verworfen: der Browser verrät keinen absoluten Pfad, und der Server liest, nicht der Browser); eine Verbindung je Ordner (verworfen wie bei GitHub: Intervall und Zielprojekt gelten für alle, Verschieben zwischen Ordnern einer Verbindung wird erkannt).

## Nachtrag (2026-10-03, [ADR-0055](0055-sicherheits-haertung.md), SH-2): Seite „Sicherheit“

- **Navigation:** „Sicherheit“ steht nach „Konto“: Kanäle, Datei-Importe, Tags, Tickets, Darstellung, Konto, Sicherheit, Sicherung, Speicher, System, Hilfe. Auf jedem Server wie „Speicher“ (nicht in `WINDOWS_ONLY`); was das Steuerskript braucht (zusätzliche Adressen), sagt die Seite selbst, wo es fehlt.
- **Bausteine:** Überblick als Liste mit `Lozenge` je Punkt (Rot nie: kein Punkt ist ein Fehler der App) und „Was bedeutet das?“ als `<details>` mit dem Namen des Punkts für Screenreader; Stufe als Radiogruppe wie „Tickets“, Gültigkeit als natives `select`, zusätzliche Adressen als Liste mit Symbolknöpfen „… entfernen“ und einem Formular mit Feldfehler (ADR-0009); Ablehnungen der Routen und ein nötiger Neustart als `SectionMessage`, Erfolge als Flag. Kein Dialog.
- Hilfe-Abschnitt „Sicherheit“ (`helpHref('sicherheit')`).

## Nachtrag (2026-10-04, [ADR-0060](0060-einheitliche-eingabeelemente.md), UI-1): Navigation in Gruppen, Unterseite „Eingabeelemente“

- **§1 Navigation:** Die Seiten stehen in Gruppen mit Überschrift (`SETTINGS_GROUPS`, `groupSettingsSections`): „Eingang und Tickets“ (Kanäle, Datei-Importe, Tags, Tickets), „Persönlich“ (Darstellung, Haushalt, Mein Konto), „Verwaltung“ (Konten verwalten, Sicherheit, Sicherung, Speicher, System) und nach einer Linie ohne Überschrift „Hilfe“. Jede Gruppe ist eine Liste, benannt durch ihre Überschrift. „Konto“ heißt „Mein Konto“, „Konten“ heißt „Konten verwalten“; die Adressen bleiben. „nur am PC“ steht für den Verwalter auf einem anderen Gerät sichtbar an der Überschrift „Verwaltung“ und weiter im Namen jedes Links.
- **Unterseiten:** `SETTINGS_SUBPAGES` mit `parent`; die Navigation markiert die Seite darüber, die Brotkrumen lauten „Einstellungen › Hilfe › Eingabeelemente“. Einzige Unterseite ist die Übersicht der Eingabeelemente.
