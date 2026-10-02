# ADR-0034: Unterprojekte als Gliederung der Projekte: eine Ebene, eigener Code, Archiv-Kaskade, keine Epics

- **Status:** Angenommen und umgesetzt in den Paketen UP-1 bis UP-6 nach [docs/plan/unterprojekte.md](../plan/unterprojekte.md) (#130 bis #135); manuelle Browser-Prüfungen stehen im Test-Manifest; Nachtrag „Offene Tickets in Projekten“ (2026-10-01, Paket PT-1 nach [docs/plan/projekte-tickets.md](../plan/projekte-tickets.md)); Nachtrag „Farben“ (2026-10-02, [ADR-0052](0052-farben-fuer-projekte-und-tickets.md))
- **Datum:** 2026-09-28
- **Entscheidung durch:** Nutzer (Freigabe der Unterprojekte mit einer Ebene, eigenem Code, Brotkrumen, Filter mit Unterprojekten, aggregierten Zahlen, Archiv-Kaskade und Löschsperre am 2026-09-28), Advisor (Konzept „Unterprojekte“), Executor (Prüfregeln, Spike, Einzelheiten)
- **Präzisiert:** [ADR-0012](0012-plain-ticketing.md) (Nachtrag, der Text bleibt), [ADR-0013](0013-filter-suche-sortierung-gruppierung.md) §3 und §4 (Filter „Projekt“ mit Unterprojekten, Parameter `unterprojekte`)
- **Bezug:** [ADR-0025](0025-ui-konsistenz-overlay-system.md), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) (Hinweis-Bausteine, Brotkrumen), [ADR-0029](0029-glas-materialien.md), [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md) (Tabellenregeln), [ADR-0033](0033-unteraufgaben.md) (Unteraufgaben)

## Kontext

Der Nutzer vermisst Unterprojekte, etwa „Haus“ mit „Garten“, „Keller“ und „Dach“. ADR-0012 nennt Projekte „die einzige Ordnungsebene mit eigenem Nummernkreis“ und verwirft „Epics als Ebene über Projekten“. CLAUDE.md §10 schließt Epics aus.

Ausgangslage:

- `projects` hat `name`, `code` (`^[A-Z]{2,6}$`, eindeutig je Scope, `TASK` reserviert), `archived`, `owner`, `household` und `scope`.
- Der Nummernkreis gilt je `scope:projectId`, der Key ist `<CODE>-<NR>`.
- Der Hook (`lib/catalog-service.js`) sperrt Code- und Scope-Wechsel, sobald Tickets das Projekt nutzen. Ein Projekt mit Tickets lässt sich nur archivieren, nicht löschen.
- Die SPA lädt alle Projekte einmal in den `CatalogStore`, auch archivierte. Ein Baum lässt sich also im Client bilden, ohne neue Abfragen.

## Entscheidung

### 1. Ein Unterprojekt ist ein Projekt

- Dieselbe Collection mit dem optionalen Feld `parent` (Relation auf `projects`, höchstens ein Ziel, ohne Cascade, Index `idx_projects_parent`, Migration `1790202100_projects_parent.js`).
- **Genau eine Ebene:** Projekt → Unterprojekt. Ein Oberprojekt hat kein Oberprojekt, ein Projekt mit Unterprojekten wird kein Unterprojekt. Damit sind Zyklen ausgeschlossen.
- **Eigener Code und eigener Nummernkreis** (`GART-3`), kein geerbtes Präfix. Umhängen oder Lösen eines Unterprojekts ändert keinen Key und keinen Zähler.
- **Derselbe Scope** wie das Oberprojekt.
- Ein Oberprojekt darf eigene Tickets haben (`HAUS-12`).
- Ein Ticket gehört weiterhin genau einem Projekt.

### 2. Prüfung im Hook

Die reine Funktion `projectParentViolation` in `lib/catalog-rules.js` (ES5) entscheidet, `lib/catalog-service.js` liest die Daten in der Transaktion des Hooks:

| Code | Wann |
|---|---|
| `validation_project_parent_self` | Das Projekt soll sein eigenes Oberprojekt sein. |
| `validation_project_parent_missing` | Das Oberprojekt fehlt **oder** liegt in einem anderen Scope. Derselbe Code und derselbe Text, damit sich fremde IDs nicht erraten lassen. |
| `validation_project_parent_nested` | Das gewählte Oberprojekt ist selbst ein Unterprojekt. |
| `validation_project_parent_has_children` | Ein Projekt mit Unterprojekten soll ein Unterprojekt werden. |
| `validation_project_parent_archived` | Ein aktives Projekt soll unter einem archivierten Oberprojekt stehen (Anlegen, Umhängen oder Zurückholen). |
| `validation_project_has_children` | Löschen eines Projekts mit Unterprojekten. |
| `validation_project_scope_children` | Bereichswechsel eines Projekts mit Unterprojekten. |

Die Texte stehen als `PROJECT_PARENT_MESSAGES` im Modul und gleich in der SPA (Paritätstest). API-Regeln ändern sich nicht: Die Sichtbarkeit folgt `owner` und `household`, die Scope-Gleichheit prüft der Hook.

### 3. Archivieren und Löschen

- **Invariante:** Ein archiviertes Oberprojekt hat nur archivierte Unterprojekte.
- **Archivieren** des Oberprojekts archiviert seine aktiven Unterprojekte **in derselben Transaktion** (nach `e.next()` per `txApp.save`, damit ihre eigenen Hooks laufen). Scheitert eines, bleibt alles aktiv. Die SPA fragt vorher mit der Zahl („Archiviert auch 3 Unterprojekte.“).
- **Zurückholen** des Oberprojekts holt die Unterprojekte nicht mit; der Nutzer wählt einzeln. Ein Unterprojekt unter einem archivierten Oberprojekt lässt sich nicht allein zurückholen; die Oberfläche bietet „Mit Oberprojekt zurückholen“.
- **Löschen:** Ein Projekt mit Unterprojekten lässt sich nicht löschen („Erst die Unterprojekte löschen oder einem anderen Projekt zuordnen.“). Die Regel „mit Tickets nicht löschbar“ bleibt. Die Relation wird nie still geleert.
- Eine Regel, deren Vorlage in einem archivierten Unterprojekt liegt, pausiert beim nächsten Erzeugen wie bei jedem archivierten Projekt (ADR-0023); dafür ist kein Zusatzcode nötig.

### 4. Spike (UP-1): Kaskade, verschachtelte Hooks und Realtime unter PocketBase 0.40.4

Geprüft gegen eine Wegwerf-Instanz mit dem Code dieses Pakets:

- `txApp.save(child)` innerhalb von `inTransaction` löst die Record-Hooks des Kindes aus. Sein eigener `onRecordUpdate` öffnet über `inTransaction` keine zweite Transaktion, sondern läuft in der des Oberprojekts und sieht dessen gespeicherten Stand (die Invariante prüft das Oberprojekt als archiviert).
- Scheitert das Speichern eines Kindes (Fehlerinjektion `__byl_fail_project_archive__`), rollt die ganze Anfrage zurück: Oberprojekt und übrige Kinder bleiben aktiv.
- Die Realtime-Ereignisse `update` von Oberprojekt und Kindern kommen nach dem Commit an, beim Besitzer und bei Mitgliedern des Haushalts, nicht bei fremden Nutzern (`realtime-rules.test.mjs`).
- Der Rückfall aus dem Konzept (SQL-Update der Kinder und erneutes `save` nach dem Commit) ist damit **nicht nötig**.

### 5. Vor der Migration

Die laufende Instanz lädt neue Hooks sofort, die Migration aber erst beim nächsten Start. Ohne das Feld verhalten sich die Hooks wie bisher (`record.collection().fields.getByName('parent')`): kein Prüfen, keine Kaskade, keine Löschsperre, und ein mitgeschicktes `parent` wird ignoriert. Die SPA fragt `project.parent` im Filter nur an, wenn das gewählte Projekt laut Katalog Unterprojekte hat; vor dem Neustart kann es keine geben. Das Formular zeigt statt des Feldes „Oberprojekt“ den Neustart-Hinweis (`restartNeeded()`).

### 6. Oberfläche und Filter

- **Liste, Kacheln und Projekt-Panel:** Baum mit Auf- und Zuklappen und Einrückung. Das Panel eines Oberprojekts listet seine Unterprojekte und bietet „Unterprojekt anlegen“, das Panel eines Unterprojekts zeigt die Brotkrumen „Haus › Garten“ und „Oberprojekt ändern“.
- **Projektwahl** im Ticket: natives `select` in Baum-Reihenfolge, Unterprojekte als „Haus › Garten (GART)“. Archivierte Projekte bleiben wie bisher außen vor.
- **Filter „Projekt“** schließt Unterprojekte standardmäßig ein. `unterprojekte=0` in der URL schließt sie aus. Client (`matchesFilter`) und Server (`project = p || project.parent = p`) rechnen gleich; der Paritätstest hat Fälle mit Unterprojekten.
- **Zahlen** von Oberprojekten sind aggregiert (eigene plus alle Unterprojekte, auch archivierte), das Panel nennt „davon direkt“.
- **Gruppieren nach Projekt:** eine Gruppe je konkretem Projekt mit dem Pfad als Titel, in Baum-Reihenfolge (Plan §3).
- **Unteraufgaben** übernehmen das Projekt ihres übergeordneten Tickets 1:1, also auch ein Unterprojekt (Plan §3).
- Die Kurzsyntax `@CODE` gilt für jedes aktive Projekt, also auch für Unterprojekte.

### 7. Grenze zum Epic

| | Epic (Jira) | Unterprojekt (hier) |
|---|---|---|
| Einheit | Arbeitseinheit mit Status, Fortschritt, Zeitraum | reine Gliederung |
| Reichweite | bündelt Tickets quer über Projekte | liegt in genau einem Oberprojekt |
| Lebenszyklus | wird „erledigt“ | kennt nur „archiviert“ |

Unterprojekte haben keinen Status, keinen Fortschritt, keine Laufzeit und keine Bündelung über Projekte hinweg. Was ein Ziel mit Fortschritt beschreibt, bleibt ausgeschlossen, einschließlich Roll-up von Status oder Fortschritt und Zeitplänen. Unteraufgaben (`tickets.parent`, ADR-0033) bleiben davon unberührt.

## Alternativen

- **Geerbtes Präfix (`HAUS-GARTEN-3`):** neues Key-Format in Hook, Spiegel, Sortierung und Kurzsyntax; Umhängen oder Umbenennen des Oberprojekts würde alle Keys der Unterprojekte neu vergeben. Verworfen (Nutzerentscheidung).
- **Beliebige Tiefe:** braucht Traversierung im Hook, ID-Listen im Serverfilter und eine deutlich aufwendigere Oberfläche. Zurückgestellt; das Feld bleibt dafür kompatibel.
- **Tags als Ersatz:** kein Nummernkreis und keine Kachel. Verworfen, weil der Nutzer ausdrücklich Unterprojekte will.
- **Kaskade per SQL ohne Hooks:** die Hooks der Kinder liefen nicht, Realtime bräuchte ein zweites Speichern. Nach dem Spike unnötig.
- **Zurückholen des Oberprojekts holt die Kinder mit:** ein Kind, das vorher schon archiviert war, käme ungewollt zurück. Verworfen.

## Konsequenzen

- Positiv: kein Eingriff in Keys, Zähler, `formatKey`, `compareKeys`, Kurzsyntax und eindeutige Indizes. Die Migration fügt nur ein Feld und einen Index hinzu; ein Rollback verliert nur die Hierarchie.
- Positiv: Archivieren ist atomar und live in allen Tabs.
- Negativ: Der Projektfilter hat zwei Formen mehr (Client-Menge und Serverausdruck); der Paritätstest hält sie gleich.
- Nach dem Update ist ein Neustart der App nötig (stop.bat, dann start.bat), bevor Unterprojekte angelegt werden können.
- CLAUDE.md §5 (`projects.parent?`), §7 und §10 (Präzisierung) sind nachgezogen.

## Nachtrag (2026-10-01): Offene Tickets in Projekten

**Anlass:** Nutzerwunsch (freigegeben): Tickets, die Projekten zugeordnet sind, sollen in der Projekt-Oberfläche sichtbar sein, ohne erst „Tickets anzeigen“ zu klicken. Vorgaben des Advisors, vom Nutzer bestätigt (Einzelheiten im [Plan](../plan/projekte-tickets.md)). Der Text oben bleibt; dieser Nachtrag ergänzt §6.

**Entscheidung:**

- **Projektliste:** Jede Zeile hat vor dem Code den Disclosure-Knopf „Offene Tickets von „Haus““ (`aria-expanded`, `aria-controls`, solange offen). Aufgeklappt folgt eine Zeile über die volle Breite mit den offenen Tickets (nicht erledigt; im Papierkorb erreicht keines den Client) des Projekts. Der Baum bleibt: Ein Oberprojekt zeigt dort nur seine eigenen Tickets („Offene Tickets direkt in „Haus““), jedes Unterprojekt seine eigenen unter seiner Zeile, eingerückt wie sein Name. Die Zahlen des Oberprojekts bleiben die mit den Unterprojekten (§6). Der Knopf zum Zuklappen der Unterprojekte bleibt in der Namenszelle.
- **Liste:** eine echte Liste mit Namen; je Eintrag Key und Titel als ein Link, Status, Priorität und Fälligkeit, nach Fälligkeit (ohne am Ende), dann Priorität. Höchstens 10, danach „Alle N in Aufgaben öffnen“ (der Sprung mit dem Projekt als Filter; beim Oberprojekt mit `unterprojekte=0`, damit „Aufgaben“ dieselben N zeigt). Ein Klick öffnet das Ticket im gemerkten Modus ([ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §1), mit dem Projekt als Zustand der Liste dahinter. Jeder Eintrag hat das Zeilenmenü „•••“ der Tabelle „Aufgaben“ samt Rechtsklick (ADR-0036, Nachträge „Aktionsmenüs“ und „Rechtsklick“; derselbe Baustein und Store, die Fragen als Dialoge des Layouts `/projekte`). Kein Bearbeiten, keine Auswahl, keine Sammelaktionen, keine eigenen Filter: dafür gibt es „Aufgaben“.
- **„Alle aufklappen“ und „Alle zuklappen“** über der Liste. Welche Zeilen offen sind, merkt sich das Gerät (`localStorage` `byl-projects-tickets`, nur IDs, höchstens 500), nicht der Tab wie das Zuklappen der Unterprojekte: Es ist eine Vorliebe wie die Spalten ([ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md) §5).
- **Projekt-Panel:** Abschnitt „Offene Tickets“ mit derselben Liste und Grenze; beim Oberprojekt zuerst seine eigenen, dann je Unterprojekt eingerückt mit Überschrift („Haus › Garten“), ein archiviertes nur mit offenen Tickets.
- **Kacheln:** keine Liste und kein weiterer Zähler. „N aktiv“ ist schon die Zahl der offenen Tickets; ein Link in der Kachel ginge nicht (die Kachel ist ein Link) und kostete einen Tab-Stopp je Kachel; „Tickets anzeigen“ steht im Menü der Kachel, ein Klick öffnet das Panel mit der Liste.
- **Daten:** aus dem `TicketListStore`, der alle offenen Tickets live hält ([ADR-0042](0042-tickets-und-projekte-aus-listen-waehlen.md) §4, Nachtrag); keine Anfrage, Realtime wirkt von selbst. Gruppiert in einem Durchgang und nur berechnet, solange eine Zeile offen ist; gerendert nur offene Zeilen mit höchstens 10 Einträgen.
- **Tabellenregeln ([ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md)):** keine neue Spalte, Breiten und Schwellen unverändert (der Knopf sitzt in der Codezelle, deren linker Innenabstand 0,75rem auf 0,375rem sinkt). Die Liste scrollt nie seitlich: Status, Priorität, Fälligkeit und „•••“ stehen neben Key und Titel und brechen auf schmaler Breite als Block darunter um.
- **Kontextmenü:** `rowMenus` nimmt nur noch den Knopf „•••“ der Zeile selbst, nicht den einer darin geschachtelten Zeile. Sonst öffnete ein Rechtsklick neben den Einträgen das Menü des ersten Eintrags; dort bleibt das Menü des Browsers.

**Alternativen:**

- **Eine Tabelle je Projekt:** bräuchte die Spalten-Mechanik der großen Tabellen (Breiten, Menü „Spalten“), die `table-columns.test.ts` für jede Tabelle verlangt, für eine Unterliste mit fünf Werten. Verworfen zugunsten einer Liste mit festen Plätzen und Umbruch.
- **Der Knopf in der Namenszelle:** Beim Oberprojekt stünden zwei gleiche Pfeile nebeneinander (Tickets und Unterprojekte). Verworfen.
- **Treegrid mit Tickets als Zeilen der Projekttabelle:** eigenes Tastaturmodell und Spalten, die für Projekte gedacht sind (aktiv, gesamt). Verworfen.
- **Beim Oberprojekt alle Tickets samt Unterprojekten:** Die Tickets der Unterprojekte stünden doppelt (unter dem Oberprojekt und unter dem Unterprojekt). Verworfen.
- **Zustand je Tab:** Vorgabe ist das Gerät.

**Konsequenzen:** keine Migration, kein Neustart, nur die Oberfläche (Build, dann F5). Die Fragen „Duplizieren …“ und „In den Papierkorb …“ eines Zeilenmenüs zeigt der gemeinsame Baustein `TicketRowDialogs` (aus `TicketTable` herausgelöst). Tests und Manifest: BYL-E6-960 bis BYL-E6-971. CLAUDE.md §7, README und Hilfe sind nachgezogen.

## Nachtrag (2026-10-02): Farben ([ADR-0052](0052-farben-fuer-projekte-und-tickets.md))

**Anlass:** Farben für Projekte und Tickets (Nutzerentscheidung vom 2026-10-02). §1 bis §7 bleiben; Unterprojekte sind weiter reine Gliederung.

**Entscheidung:**

- **Vererbung:** Ein Unterprojekt ohne eigene Farbe zeigt die Farbe seines Oberprojekts, seine Tickets ebenso (Ticket → Projekt → Oberprojekt → keine, `ticketColorOf`). Eine eigene Farbe des Unterprojekts geht vor. Wegen der einen Ebene (§1) gibt es keine längere Kette.
- **Gespeichert** wird nur die eigene Farbe (`projects.color`, leer = keine); die geerbte rechnet die SPA aus dem Katalog (`resolveParents` trägt die Farbe des Oberprojekts mit), so folgt eine neue Farbe des Oberprojekts sofort allen Unterprojekten und Tickets, ohne dass sich ein Datensatz ändert. Umhängen eines Unterprojekts ändert seine gezeigte Farbe, nie einen Key.
- **Projekt-Panel:** Das Feld „Farbe“ nach „Oberprojekt“ zeigt bei einem Unterprojekt zuerst „Wie Oberprojekt (Blau)“ nach dem im Formular gewählten Oberprojekt, bei einem obersten Projekt „Keine“. Liste und Kacheln zeigen einen Punkt vor dem Namen, beim Unterprojekt mit „vom Oberprojekt „Haus““ im Namen der Farbe.
- **Zahlen, Filter und Archiv** bleiben unberührt; die Farbe ist reine Anzeige.

**Tests:** `domain/colors.test.ts`, `stores/catalog.test.ts`, `components/project-panel.test.ts`, `components/colors.test.ts`.
