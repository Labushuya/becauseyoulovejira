# ADR-0010: Seitenaufbau nach dem Vorbild des Task-Boards, im eigenen Stack und mit eigenen Farben

- **Status:** Angenommen, teilweise ersetzt durch [ADR-0025](0025-ui-konsistenz-overlay-system.md) und [ADR-0029](0029-glas-materialien.md) (§3, Glas, Verläufe, Schatten), ergänzt durch [ADR-0027](0027-akzent-themes.md) (siehe Nachträge am Ende)
- **Datum:** 2026-09-25
- **Entscheidung durch:** Nutzer (Layout übernehmen, 2026-09-25), Advisor (Auslegung: eigene Farben, Clean-Room-Regel)

## Kontext

Der Nutzer betreibt privat ein eigenes Task-Board (eine einzelne HTML-Seite mit Python-Server). Dessen Seitenaufbau und Bedienung kennt und mag er. Die E2-Liste von becauseyoulovejira ist dagegen eine schlichte Zeilenliste ohne Kennzahlen, Filter, Sortierung oder Gruppierung.

Die Frage an den Nutzer lautete: „Unsere Farben beibehalten oder das Layout des Task-Boards übernehmen?“ Er hat sich für das Layout entschieden. Der Advisor legt das so aus: Seitenaufbau, Anordnung und Bedienmuster werden vollständig übernommen. Farben, Schriften und Design-Regeln bleiben die eigenen (CLAUDE.md §8, [ADR-0009](0009-fehlerfarbe.md)).

Das Vorbild ist mit Firmenbezügen gebaut: Firmenname in der Kopfzeile, Synchronisation mit Firmenwerkzeugen, interne Adressen. Außerdem nutzt es Glas-Optik, Farbverläufe, Schatten, Signalfarben für Priorität und Überfälligkeit und ein Skript von einem CDN. Nichts davon passt zu diesem Projekt (Repo auf GitHub, offline lauffähig, Petrol als einzige Akzentfarbe).

## Entscheidung

### 1. Übernommener Seitenaufbau

Von oben nach unten, in **einer** Spalte. Das Detail-Panel liegt rechts daneben (siehe unten).

| Bereich | Inhalt | Ab |
|---|---|---|
| **Kopfzeile** | App-Name, Zähler der nicht erledigten Tickets, Bereichs-Umschalter, „Angemeldet als …“, „Abmelden“, Hauptknopf „Neues Ticket“ | E3 |
| **Kennzahlen-Kacheln** | eine Reihe klickbarer Kacheln mit Zahl und Bezeichnung. Ein Klick setzt den passenden Filter, die Kachel „alle“ setzt die Filter zurück. | E3 |
| **Filterleiste** | Chip-Gruppen mit Beschriftung (Status, Priorität, Fällig; ab E4 zusätzlich Quelle bzw. Kanal), dazu Auswahl für Projekt und Tag, Suchfeld und „Zurücksetzen“ | E3 |
| **Abschnittsleiste** | links der Umschalter „Aufgaben \| Projekte“ mit Zähler der sichtbaren Tickets; rechts „Erledigte anzeigen“, das Popover „Gruppieren“, ab E6 das Popover „Spalten“ | E3 (Spalten E6) |
| **Tabelle** | sortierbare Spaltenköpfe, Gruppenköpfe mit Zähler, relative Fälligkeitslabels, Aktionen in der Zeile | E3 |
| **Detail-Panel** | rechts neben der Tabelle, öffnet per Klick auf eine Zeile | seit E2 |
| **Projektansicht** | ersetzt Kennzahlen, Filterleiste und Tabelle: Kacheln je Projekt (Name, Code, Anzahl aktiv, gesamt und ab E4 neu), „Neues Projekt“. Ein Klick auf eine Kachel öffnet die Tickets dieses Projekts. | E3 („neu“ ab E4) |

Bedienmuster, die mit übernommen werden:

- Ein Klick auf eine Kennzahl filtert. Die Zahlen zählen immer alle nicht erledigten Tickets, unabhängig von den gesetzten Filtern.
- Pro Chip-Gruppe ist genau ein Wert gewählt, „Alle“ ist der Ausgangswert.
- Ein Klick auf einen Spaltenkopf sortiert, ein zweiter Klick dreht die Richtung um.
- Gruppenköpfe zeigen Bezeichnung und Anzahl.
- Fälligkeiten stehen relativ da („heute“, „morgen“, „in 3 Tagen“, „seit 2 Tagen überfällig“), weiter entfernte als Datum.
- Die Zeilenaktion „Erledigt“ steht in der Zeile. Das Verhalten ist das der E2-Liste (5 s „Rückgängig“, Wiederöffnen setzt „Offen“).

Später folgen, jeweils in ihrer Etappe ([ADR-0011](0011-roadmap-e3-bis-e7.md)): Quelle bzw. Kanal als Chip-Gruppe, Spalte und Gruppierung (E4), die „Neu“-Markierung (E4), der Papierkorb statt „Gelöscht anzeigen“, das Popover „Spalten“, der Theme-Umschalter in der Kopfzeile, Tastaturkürzel und Hilfe (E6).

**Nicht** übernommen werden Synchronisation, Staging, Import-Einstellungen, Offline-Warteschlange und die geführte Tour mit externer Bibliothek. Sie gehören zu den Firmenwerkzeugen des Vorbilds. Die Hilfe entsteht in E6 neu.

### 2. Abweichungen im Bedienmuster

- **Detail-Panel:** Es bleibt das nicht modale Seitenpanel aus E2: sticky rechts neben der Tabelle, auf schmalen Bildschirmen über der Tabelle, adressierbar per `/tickets/<id>`. Das Vorbild legt ein Overlay über die Seite. Das E2-Panel ist schon zugänglich (Fokusführung, Escape, Zurück im Browser) und hält die Tabelle bedienbar.
- **Zustand in der Adresse:** Filter, Suche, Sortierung und Gruppierung stehen in der URL (CLAUDE.md §7), nicht in `localStorage` wie beim Vorbild. So funktionieren Neuladen, Zurück, Vor und Lesezeichen. Eine dauerhafte Voreinstellung für die Ansicht kommt mit „Spalten“ in E6.
- **Projektansicht:** Ein Klick auf eine Kachel öffnet die Aufgabenansicht mit gesetztem Projektfilter. Es gibt keine zweite, eigene Tabelle. Filter, Sortierung, Gruppierung und Panel funktionieren dort also genauso.

### 3. Farben und Gestaltung

- Alle Farben kommen aus `web/src/lib/styles/tokens.css` (CLAUDE.md §8). Petrol bleibt die einzige Akzentfarbe.
- Rot nur für echte Fehler ([ADR-0009](0009-fehlerfarbe.md)). Die Kachel „Überfällig“, überfällige Fälligkeiten und die Priorität „Dringend“ sind **nicht** rot. Sie unterscheiden sich durch Text, Icon und Schriftgewicht.
- Status-Pillen bleiben „Ton in Ton“ wie in CLAUDE.md §8. Sie dürfen dezent getönt sein („In Arbeit“ petrolfarben, „Wartet“ bernsteinfarben), aber es gibt keine Signalfarben (kein Rot, kein Grün, kein Gelb als Warnung).
- Priorität erscheint als Icon mit Text, ohne eigene Farbe (Hoch und Dringend in Textfarbe, Niedrig und Mittel gedämpft, wie in E2).
- Aktive Chips, gewählte Kacheln und der aktive Umschalter nutzen „Marke Fläche / Text darauf“ bzw. einen Rahmen in der Markenfarbe, jeweils **zusätzlich** zu einem nicht farblichen Merkmal (Häkchen, `aria-pressed`/`aria-checked`, Schriftgewicht).
- Keine Glas-Optik (`backdrop-filter`), keine Farbverläufe, keine Schlagschatten als Gestaltungsmittel. Flächen trennen sich über feine Linien (`--color-line`). Ein Popover darf eine Linie und eine Fläche in `--color-surface` haben.
- Braucht die Umsetzung eine neue Farbe (etwa für eine gewählte Tabellenzeile), entsteht ein neues Token in allen vier Blöcken von `tokens.css`, abgeleitet aus den vorhandenen Tönen, mit Kontrastprüfung im bestehenden `tokens.test.ts`.
- Deutsch überall, auch in `title`, `aria-label` und Meldungen.

### 4. Clean-Room-Regel

- Übernommen werden **nur Konzepte**: Aufbau, Anordnung, Bezeichnungen der Bedienelemente und Bedienabläufe.
- **Kein** Code, kein CSS, kein Markup, keine SVG-Pfade und keine Texte werden kopiert. Alles entsteht neu als Svelte-5-Komponenten nach CLAUDE.md §4 und [ADR-0006](0006-frontend-zustand-und-datenzugriff.md).
- Keine Firmennamen, keine internen Adressen und keine Bezeichnungen aus den Firmenwerkzeugen des Vorbilds in Repo, Commits, Tests oder Oberfläche.
- Die Arbeitsdaten des Task-Boards (Datenbank, JSON-Export, Archive, Git-Historie) werden nicht geöffnet. Als Referenz dient ausschließlich der Aufbau der Oberfläche.
- Icons zeichnen wir selbst als Inline-SVG in `currentColor`, wie in E2 (keine Icon-Bibliothek, T-17 im [E2-Plan](../plan/e2.md)).

### 5. Barrierefreiheit (verbindlich für die neuen Bereiche)

- Chip-Gruppen sind `fieldset` mit `legend` und nativen Radio-Eingaben, die als Chips gestaltet sind. Pfeiltasten und Tab funktionieren damit ohne eigenen Code.
- Kennzahlen-Kacheln sind Knöpfe mit `aria-pressed` und einem Namen aus Zahl und Bezeichnung („3 überfällig, Filter setzen“).
- Die Tabelle ist eine echte `table` mit `caption`, `th scope="col"` und `aria-sort` auf dem sortierten Spaltenkopf. Der Sortierknopf steht als `button` im `th`. Gruppen sind eigene `tbody` mit einem Kopf `th scope="rowgroup"`.
- Popover („Gruppieren“, später „Spalten“) sind Knöpfe mit `aria-expanded` und `aria-controls`, die ein Feld mit Radio-Eingaben öffnen. Escape schließt, der Fokus kehrt auf den Knopf zurück.
- Der Umschalter „Aufgaben | Projekte“ ist eine Navigation mit zwei Links (`aria-current="page"`), weil beide Ansichten eigene Adressen haben.
- Farbe ist nie das einzige Merkmal (WCAG 1.4.1). Der Fokus ist überall sichtbar.

## Alternativen

- **E2-Liste behalten, nur Filter ergänzen:** vom Nutzer verworfen.
- **Layout samt Farben übernehmen:** Das widerspräche CLAUDE.md §8 und ADR-0009 (Signalfarben, Rot für Überfälligkeit und Priorität, Verläufe). Verworfen.
- **Das Vorbild-HTML umbauen und einbetten:** Es brächte Firmenbezüge, Inline-Skripte, `innerHTML`-Rendering und ein externes CDN mit. Das widerspricht der Offline-Regel, der Runes-Regel und der XSS-Linie aus [ADR-0008](0008-markdown-rendering-und-sanitizing.md). Verworfen.
- **Overlay-Panel wie im Vorbild:** Es verdeckt die Tabelle und bricht die E2-Fokusführung. Verworfen (Abschnitt 2).

## Konsequenzen

- E3 baut die Listenansicht zur Tabelle um. Die E2-Komponenten `TicketList` und `TicketRow` werden ersetzt, die Stores und das Verhalten (Häkchen, „Rückgängig“, Fokuswiederherstellung, Realtime) bleiben. Plan: [E3-Plan](../plan/e3.md).
- CLAUDE.md §7 beschreibt den Seitenaufbau ab E3 mit Verweis auf dieses ADR. Die Zeilenbeschreibung aus E2 wird im Doku-Paket von E3 angepasst.
- Neue Farb-Tokens sind möglich, aber nur nach Abschnitt 3.
- Die Clean-Room-Regel gilt für alle weiteren Etappen, in denen das Task-Board als Vorbild dient (etwa Spalten und Hilfe in E6).

## Nachtrag (2026-09-25): teilweise ersetzt durch ADR-0025

[ADR-0025](0025-ui-konsistenz-overlay-system.md) legt ein gemeinsames Overlay-System fest. Der Text oben bleibt unverändert; wo er abweicht, gilt ADR-0025. Das betrifft:

- **§1, Reihenfolge der Leisten:** Die Abschnittsleiste mit dem Umschalter „Aufgaben | Projekte | Eingang“ steht in allen Ansichten direkt unter der Kopfzeile. Darunter folgen Kennzahlen und Filterleiste (Aufgaben), Chips (Eingang) oder nichts (Projekte). Umgesetzt mit Paket UI-8.
- **§1, „Rückgängig“:** Statt 5 s in der Zeile erscheint es 8 s in einem Flag unten links, mit Pause bei Hover und Fokus. Umgesetzt mit UI-5.
- **§1, Projektansicht:** Die Kacheln bleiben. Ein Klick öffnet das Projekt-Panel (`/projekte/<id>`) statt direkt die gefilterte Liste; „Tickets anzeigen“ steht im Panel. Umgesetzt mit UI-8.
- **§2, Detail-Panel:** Es bleibt nicht modal neben der Tabelle, bekommt aber den Aufbau des Task-Boards: 480 px, fester Kopf mit „Vollansicht“ und ×, fester Fuß, Slide-in beim ersten Öffnen. Schmal ist die Liste dahinter `inert`. Umgesetzt mit UI-6.
- **§2, Vollansicht:** neu als XL-Modal unter `/tickets/<id>/voll`. Umgesetzt mit UI-7.
- **§5, Popover:** Sie laufen über einen gemeinsamen Baustein mit JS-Positionierung statt CSS Anchor Positioning. Umgesetzt mit UI-2.

Die Farb- und Gestaltungsregeln aus §3 und die Clean-Room-Regel aus §4 gelten unverändert.

## Nachtrag (2026-09-26): genau eine Akzentfarbe je Theme (ADR-0027)

[ADR-0027](0027-akzent-themes.md) führt wählbare Akzent-Themes ein: Petrol (Standard), Rubin, Purpur, Smaragd und Honig, jedes hell und dunkel. Der Text oben bleibt unverändert. Für §3 gilt ab jetzt:

- Aus „Petrol bleibt die einzige Akzentfarbe“ wird **„genau eine Akzentfarbe je Theme“**. Wo §3 „Petrol“ oder „petrolfarben“ sagt, ist der Akzent des gewählten Themes gemeint. Die Pille „In Arbeit“ trägt etwa den Akzent.
- Alles andere aus §3 gilt in jedem Theme:
  - keine Signalfarben, kein Rot außer für Fehler
  - keine Glas-Optik, keine Verläufe, keine Schatten
  - Pillen „Ton in Ton“
  - Farbe nie als einziges Merkmal
- „Wartet“ bleibt bernsteinfarben, außer im Honig-Theme. Dort würde Bernstein den Akzent treffen, deshalb ist die Pille dort schiefergrau-blau.
- Neue Farb-Tokens entstehen weiter nur nach §3, jetzt in den Modus-Blöcken **und** in allen Theme-Blöcken, jeweils mit Kontrastprüfung in `tokens.test.ts`.
- Seit dem Nachtrag zu ADR-0027 vom 2026-09-27 heißen die Themes Petrol, Rubin, Smaragd und Kupfer (Purpur entfällt, Honig wird Kupfer); die schiefergrau-blaue „Wartet“-Pille gilt jetzt im Kupfer-Theme.

## Nachtrag (2026-09-27): Glas, Verlauf und Schatten nach ADR-0029

[ADR-0029](0029-glas-materialien.md) ersetzt in §3 den Punkt „Keine Glas-Optik (`backdrop-filter`), keine Farbverläufe, keine Schlagschatten als Gestaltungsmittel“:

- Glas nur in der Bedienebene (Kopfzeile, Seitenpanel, Einstellungsnavigation, Popover und Menüs, Modals S bis L, Flags, Anmeldung, Tour); Tabellen, Kacheln, Karten und Texte bleiben undurchsichtig und trennen sich weiter über feine Linien.
- Ein Verlauf nur im Hintergrund, aus der vorhandenen Akzentfläche. Schatten nur neutral über Tokens und immer mit Linie.
- Der Fokusring ist `--color-brand-text` statt `--color-brand`.
- Alle übrigen Punkte von §3 und die Clean-Room-Regel aus §4 gelten weiter; aus dem Task-Board wird auch für das Glas kein CSS übernommen.

## Nachtrag (2026-10-05): Kennzahlen-Kacheln werden Filter-Karten (FI-1)

[ADR-0013](0013-filter-suche-sortierung-gruppierung.md), Nachtrag C, ersetzt in §1 die Zeile „Kennzahlen-Kacheln“ und den Satz „Die Zahlen zählen immer alle nicht erledigten Tickets, unabhängig von den gesetzten Filtern“ sowie in §5 den Namen der Kacheln:

- Die Kacheln heißen „Filter-Karten“ und sind Umschalter. Mehrere gewählte Karten zeigen ihre Vereinigung, und die Filter der Filterleiste schränken sie weiter ein.
- „Nicht erledigt“ heißt „Alle offenen“, gilt als gewählt, solange keine andere Karte gewählt ist, und hebt die übrigen Karten auf, statt alle Filter zurückzusetzen.
- Jede Karte zählt die offenen Tickets, die Filter und Suche passieren, ohne die anderen Karten. Die Kopfzeile zählt weiter alle offenen.
- Der Name einer Karte ist Bezeichnung und Zahl („Überfällig: 4“). Farbe ist weiter nie das einzige Merkmal: Gewählte Karten tragen zusätzlich ein Häkchen im Kästchen und eine fettere Zahl. Die Karte „Überfällig“ ist nicht rot (§3).
