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
