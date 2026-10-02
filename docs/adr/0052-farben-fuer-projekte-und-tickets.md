# ADR-0052: Farben für Projekte und Tickets – feste Palette ohne Rot, Vererbung Ticket → Projekt → Oberprojekt, Farbe nur als Streifen oder Punkt mit Namen

- **Status:** Angenommen und umgesetzt (Paket FA-1 nach [Plan Farben](../plan/farben.md)); manuelle Sichtprüfungen in allen Themes und mit Screenreader stehen im Test-Manifest
- **Datum:** 2026-10-02
- **Entscheidung durch:** Nutzer (Wunsch „Tickets und Projekte farbig markieren, die dann auch im Kalender so angezeigt werden“; Freigabe der Empfehlungen am 2026-10-02: Projektfarbe mit Vererbung an Tickets und Unterprojekte, optionale eigene Farbe des Tickets, feste Palette statt Farbwähler, kein Signalrot, nur Streifen oder Punkt, nie allein über Farbe), Advisor (Datenmodell, Palette als Design-Tokens mit Kontrast- und Fehlerrot-Test, Orte der Anzeige und Bedienung, Vorlage und Duplikat, Verlauf, gemeinsame Funktion für den Kalender), Executor (Farbwerte, Select-Feld statt Text mit Hook, Gestaltung von Streifen und Punkt, Sammelaktion, Einzelheiten)
- **Ergänzt:** [ADR-0027](0027-akzent-themes.md) (Palette neben dem einen Akzent, Nachtrag dort), [ADR-0034](0034-unterprojekte.md) (Unterprojekte erben die Farbe, Nachtrag dort), [ADR-0022](0022-erzeugung-von-instanzen.md) (Farbe der Vorlage, Nachtrag 11 dort), [ADR-0045](0045-ticket-duplizieren.md) (Farbe im Duplikat, Nachtrag dort), [ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) (Sammelaktion „Farbe“, Nachtrag dort)
- **Bezug:** [ADR-0009](0009-fehlerfarbe.md) (Rot nur für echte Fehler), [ADR-0025](0025-ui-konsistenz-overlay-system.md) (Kopf der Vollansicht), [ADR-0029](0029-glas-materialien.md) (Kontrast auf Glas), [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md) (keine neue Spalte), [ADR-0042](0042-tickets-und-projekte-aus-listen-waehlen.md) (Auswahllisten)

## Kontext

Der Nutzer möchte Projekte und Tickets farbig markieren; ein späterer Kalender (eigenes Paket) soll die Farbe zeigen. Die App hat genau eine Akzentfarbe je Theme (ADR-0027), Rot nur für echte Fehler (ADR-0009), und die Themes Rubin und Kupfer verschieben das Fehlerrot Richtung Ziegel bzw. Karmin. Eine Farbe darf deshalb weder wie ein zweiter Akzent noch wie ein Fehler wirken, muss auf allen Flächen der vier Themes in Hell und Dunkel sichtbar bleiben und darf nie die einzige Information sein (WCAG 1.4.1).

## Entscheidung

### 1. Palette

Zehn benannte Farben in der Reihenfolge der Auswahl, rund um den Farbkreis ohne den roten Bereich, dann das neutrale Grau:

| Schlüssel | Name | Hell | Dunkel |
|---|---|---|---|
| `violett` | Violett | `#8A569E` | `#B2A1E6` |
| `indigo` | Indigo | `#394085` | `#667FD6` |
| `blau` | Blau | `#1364B2` | `#61A2E5` |
| `himmel` | Himmelblau | `#1B87A4` | `#8DD0E9` |
| `tuerkis` | Türkis | `#2A847D` | `#6ECBC2` |
| `gruen` | Grün | `#3D7740` | `#70AF71` |
| `oliv` | Oliv | `#717D2D` | `#B1BD65` |
| `senf` | Senf | `#9C7A22` | `#E7C263` |
| `braun` | Braun | `#644C27` | `#9C865F` |
| `grau` | Grau | `#646E76` | `#97A2AA` |

- **Kein Rot, Orange, Rosa oder Magenta:** Dort liegen das Fehlerrot von Petrol und Smaragd, das Ziegelrot von Rubin und das Karmin von Kupfer, im Dunkeln deren helle Rosétöne. Jede Farbe hält in jedem Theme und Modus einen Abstand ΔE2000 ≥ 20 zum Fehler-Token, wie die Akzente (ADR-0027 §5). Kleinste Abstände: Braun 20,2 (hell), Violett 20,6 (dunkel).
- **Gleich in allen Themes, im Dunkeln heller:** Die Tokens `--project-color-<schlüssel>` stehen nur in den vier Modus-Blöcken von `tokens.css`, nie in den Theme-Blöcken. Die neutralen Flächen sind in allen Themes gleich; nur die Akzentfläche (gewählte Zeile, Verlauf) und der Fehler unterscheiden sich, und die Tests rechnen jedes Theme einzeln.
- **Kontrast (WCAG 1.4.11, Streifen und Punkt sind Grafik):** mindestens 3 : 1 auf Fläche, Hintergrund, Akzentfläche jedes Themes und Glas (Kopf des Seitenpanels, Popover und Menüs, Modals über dem Schleier). Kleinster Wert über alle acht Varianten: hell Senf 3,28 und Himmelblau 3,40, dunkel Indigo 3,27 und Braun 3,52; die meisten liegen über 4. Ein Rahmen ist deshalb nicht nötig; ein transparenter Rand von 1 px macht die Form im Kontrastmodus von Windows (`forced-colors`) sichtbar.
- **Untereinander unterscheidbar:** je zwei Farben ΔE2000 ≥ 12 im selben Modus (kleinster Wert 12,6, Blau und Indigo dunkel).
- **Begründung der Werte:** Im hellen Modus verlangt 3 : 1 auf der hellen Akzentfläche (`#DDF0F2` u. a.) eine Helligkeit L\* unter etwa 56, im dunklen auf der dunklen Akzentfläche (`#123A3F` u. a.) über etwa 53. Innerhalb dieser Bänder sind Farbton und Sättigung so gewählt, dass die Farben ruhig bleiben (Chroma etwa 25 bis 50) und sich voneinander sowie vom Fehler absetzen. Gelb heißt „Senf“, weil es im hellen Modus ein dunkles Ocker sein muss.

### 2. Datenmodell (Migration `1790203400_colors.js`)

- `projects.color`, `tickets.color` und `recurrence_rules.color`: je ein **Select-Feld** mit den zehn Schlüsseln, nicht Pflicht, höchstens ein Wert. Leer heißt beim Projekt „keine Farbe“, beim Ticket und in der Vorlage „wie Projekt“.
- **Select statt Text mit Hook-Prüfung:** PocketBase prüft den Wert auf jedem Weg (Record-API, Verwaltung des Superusers, Speichern der Hooks, Duplizieren), ohne eigenen Hook-Code und ohne zweite Liste im Server. Eine neue Farbe ist eine bewusste Entscheidung und braucht ohnehin eine Migration, Tokens und Tests. Abgelehnte Werte antworten 400 mit `validation_invalid_value` am Feld `color`.
- **Gleichstand der Liste:** `PROJECT_COLORS` in `web/src/lib/domain/colors.ts` ist die Quelle der SPA; `tests/integration/colors.test.mjs` vergleicht sie mit den Werten der drei Felder der laufenden Instanz, `tests/support/schema.mjs` hält sie wörtlich fest.
- Additiv: Altdaten haben keine Farbe; der Rückweg entfernt die drei Felder und verliert nur die Farben (Rollback-Test).
- Vor dem Neustart nach dem Update fehlt das Feld in den Antworten; die SPA bietet dann keine Farbwahl an (`CatalogStore.colorsReady`, `Ticket.color` fehlt) und zeigt im Projekt-Panel den Neustart-Hinweis.

### 3. Vererbung und gemeinsame Funktion

- **Effektive Farbe eines Tickets:** eigene Farbe → Farbe des Projekts → Farbe des Oberprojekts → keine (`ticketColorOf(ticket, projekt)` in `domain/colors.ts`); ein Projekt zeigt seine eigene, sonst die seines Oberprojekts (`projectColorOf`). Der Katalog löst das Oberprojekt samt Farbe auf (`resolveParents`). Der Kalender nutzt dieselbe Funktion.
- **Name immer dabei:** `colorText` liefert „Farbe Blau“, „Farbe Blau, vom Projekt „Haus““ bzw. „…, vom Oberprojekt „Haus““ für `title` und Screenreader.
- Unteraufgaben erben nicht die Farbe ihres übergeordneten Tickets, sondern folgen derselben Kette über ihr Projekt (das sie 1:1 vom übergeordneten Ticket haben).

### 4. Anzeige: nur Streifen oder Punkt

Baustein `ColorMark` (Punkt 0,625rem bzw. Streifen 0,25rem, nie eine Fläche); er nennt die Farbe als `title` und, wo der Ort sie nicht selbst nennt, als verborgenen Text.

| Ort | Darstellung |
|---|---|
| Aufgaben-Tabelle | Streifen am Anfang der ersten Zelle (Auswahlspalte), 3 px neben dem Akzentbalken der geöffneten Zeile, so hoch wie die Zeile ohne Innenabstand; kompakte Zeilen bleiben gleich hoch; Unteraufgaben zeigen ihre effektive Farbe; „Nach Projekt“ gruppiert: Punkt vor dem Namen der Gruppe |
| Projektliste und Kacheln | Punkt vor dem Namen, der Name der Farbe für Screenreader nach Name bzw. Code |
| Projekt-Panel | die Farbwahl selbst (gewählter Swatch) |
| Ticket-Panel und Vollansicht | Punkt im Kopf vor Pfad bzw. Key (Panel) bzw. vor dem Titel des Modals, außerhalb des Namens des Dialogs |
| Offene Tickets unter Projekten (PT-1) | Punkt vor dem Key jedes Eintrags |
| `TicketPicker` | kurzer Balken vor dem Key (ein Balken, damit er nie wie der Punkt „neu“ aussieht) |
| Menü der Zelle „Projekt“ | Punkt vor jedem Projekt |
| `ProjectSelect` (natives `select`) | keine Farbe: Optionen eines nativen `select` lassen sich nicht zuverlässig mit einem Punkt gestalten, eine gefärbte Option wäre eine Fläche. Direkt unter dem Projekt steht in den Formularen die Wahl „Farbe“ mit „Wie Projekt (Blau)“, die das gewählte Projekt sofort nennt. |

### 5. Bedienung

- **Farbwahl `ColorChoice`:** Radiogruppe (`role="radiogroup"` mit dem sichtbaren Etikett „Farbe“) aus nativen Radios, wie `base.css` sie zeichnet (Fokusring, Pfeiltasten des Browsers), je mit dekorativem Swatch und sichtbarem Namen; zuerst „Keine“ (oberstes Projekt), „Wie Oberprojekt (Blau)“ (Unterprojekt) bzw. „Wie Projekt (Blau)“ (Ticket, Vorlage), deren Swatch die geerbte Farbe zeigt (gestrichelter Kreis ohne). Fehler des Servers am Feld, per `aria-describedby`.
- **Orte:** Projekt-Panel und „Neues Projekt“ (im Formular, mit „Speichern“, Frage beim Verwerfen), Ticket-Panel und Vollansicht (speichert sofort wie das Projekt), „Neues Ticket“, Vorlage einer Wiederholung (Regel-Panel und Bearbeiten am Ticket).
- **Sammelaktion „Farbe“** in der Leiste der Auswahl, als Menü wie „Priorität“ (`menu` mit „Wie Projekt“ und den zehn Farben), sofort ausgeführt, mit „Rückgängig“ (Nachtrag zu ADR-0036). Sie passt ohne neuen Baustein in die Muster von ADR-0036 §3.
- **Keine Zelle „Farbe“** in der Tabelle: eine weitere Spalte verschöbe Breiten und Schwellen von ADR-0030, und der Streifen ist schon da; die Farbe einzelner Tickets ändert man im Ticket oder per Auswahl.

### 6. Vorlage, Duplikat, Verlauf, Realtime

- **Wiederholung:** Die Vorlage hat eine Farbe; jedes neue Ticket der Serie bekommt sie als eigene (`newInstance`), ohne Farbe „wie Projekt“. „Wiederholen…“ übernimmt die eigene Farbe des Tickets; „Auch für künftige Tickets übernehmen“ bietet sie wie Titel oder Priorität an; die Zeile „Künftige Tickets“ nennt „Farbe Blau“. Unteraufgaben der Vorlage bekommen keine eigene Farbe.
- **Duplizieren:** Schalter `color` der Route (Standard an, „Farbe: Blau“ bzw. „Farbe: wie Projekt“ unter „Übernehmen“); Unteraufgaben jeweils mit ihrer eigenen.
- **Verlauf:** `color` steht in `TRACKED_FIELDS`; der Verlauf nennt „Farbe: wie Projekt → Blau“. Projekte haben keinen Verlauf, die Farbe eines Projekts ist keine Änderung seiner Tickets.
- **Realtime:** Projekte, Tickets und Regeln kommen mit ihrer Farbe über die bestehenden Abos (`PROJECT_FIELDS`, `TICKET_LIST_FIELDS` samt `expand.project.color`, `RULE_FIELDS`); eine neue Projektfarbe erreicht über den Katalog alle Zeilen, Unterprojekte und Kalender sofort.

## Alternativen

- **Freier Farbwähler:** beliebige Farben ließen sich weder auf Kontrast in acht Varianten noch auf Abstand zum Fehlerrot prüfen und sähen in Hell und Dunkel nicht gleichwertig aus. Vom Nutzer verworfen (Empfehlung „feste Palette“).
- **Farbe als Hintergrund der Zeile oder Kachel:** konkurriert mit der Akzentfläche gewählter Zeilen und dem einen Akzent je Theme (ADR-0027 §1), und Text darauf bräuchte je Farbe eigene Textfarben. Verworfen.
- **Text-Feld mit Prüfung im Hook:** flexibler, aber eine zweite Liste im Server, eigener Prüfcode und kein Schutz für Wege ohne Hook. Verworfen zugunsten des Select-Felds (§2).
- **Palette je Theme:** würde Projekte beim Wechsel des Themes anders aussehen lassen; die neutralen Flächen sind ohnehin gleich. Verworfen; die Tests prüfen trotzdem jedes Theme.
- **Rahmen um Punkt und Streifen statt dunklerer bzw. hellerer Töne:** möglich, aber unruhiger; die Palette erreicht 3 : 1 ohne Rahmen.
- **Streifen ganz am Rand der Zeile:** fiele mit dem Akzentbalken der geöffneten Zeile zusammen (eine Türkis-Zeile sähe im Petrol-Theme „geöffnet“ aus). Verworfen zugunsten des Abstands von 3 px.
- **Farbe des übergeordneten Tickets für Unteraufgaben:** zweite Vererbungskette neben dem Projekt; nicht verlangt. Zurückgestellt.

## Konsequenzen

- Neue Migration mit Rückweg; **Neustart nötig** (`neu-starten.bat`), bis dahin keine Farbwahl. Die Oberfläche nach F5.
- `tokens.css` bekommt zehn Tokens je Modus-Block; `project-colors.test.ts` prüft Vollständigkeit, Kontrast, Abstand zum Fehler und untereinander, `glass-contrast.test.ts` rechnet die neuen Farben als Hintergründe unter Glas mit. Die Ausnahmelisten `no-own-font-sizes` und `no-own-radii` bleiben, wie sie sind; keine Hex-Werte außerhalb von `tokens.css`.
- Der Baustein Modal hat das optionale Snippet `titleLead` (Kopf der Vollansicht).
- CLAUDE.md §5, §7 und §8, README und Hilfe („Wie färbe ich Projekte und Tickets?“) sind nachgezogen.
