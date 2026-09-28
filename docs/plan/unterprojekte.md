# E6-Plan, Teil Unterprojekte: eine Ebene, eigener Code, Baum in Liste und Kacheln, Filter mit Unterprojekten

- **Stand:** in Umsetzung (2026-09-28): UP-1 (Datenmodell, Hook, Spike).
- **Grundlage:**
  - [ADR-0034](../adr/0034-unterprojekte.md) (Datenmodell, Prüfregeln, Archiv-Kaskade, Spike, Oberfläche, Grenze zum Epic)
  - [ADR-0012](../adr/0012-plain-ticketing.md) mit dem Nachtrag „Unterprojekte als Gliederung, keine Epics“
  - [ADR-0013](../adr/0013-filter-suche-sortierung-gruppierung.md) (Client und Server rechnen den Filter gleich), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0029](../adr/0029-glas-materialien.md), [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md), [ADR-0033](../adr/0033-unteraufgaben.md)
  - [CLAUDE.md](../../CLAUDE.md) §3, §5, §7, §8, §10, §11, §12
- **Einordnung:** Nutzerentscheidungen vom 2026-09-28: genau eine Ebene, eigener Code und Nummernkreis, Brotkrumen „Haus › Garten“, Filter mit Unterprojekten als Standard (`unterprojekte=0` schließt sie aus), aggregierte Zahlen mit „davon direkt“, Archivieren mit Kaskade in einer Transaktion, Löschsperre für Projekte mit Unterprojekten. Das Konzept schlug ADR-0031 und die Migration `1790201700` vor; beide Nummern sind inzwischen belegt. Die Manifest-IDs laufen ab `BYL-E6-260`.

## 1. Querschnittsregeln

- **Eine Migration, nur additiv:** `1790202100_projects_parent.js` fügt `projects.parent` und `idx_projects_parent` hinzu. Das Down entfernt beides und verliert nur die Hierarchie. Rollback-Test mit Bestandsdaten und `hooks-before-migration.test.mjs` sind Pflicht.
- **Neustart nötig:** Die Hooks wirken in der laufenden Instanz sofort, die Migration erst nach dem nächsten Start. Bis dahin verhalten sich Hooks und SPA wie vorher (ADR-0034 §5). Ein Hook-Paket wird nur fertig getestet committet und nie als Experiment im Ordner `app/` liegen gelassen; der Spike lief in einem Arbeitsbaum im Scratchpad.
- Keine neue Abhängigkeit, keine neuen Farb- oder Maß-Tokens. Schriftgrößen nur über `--font-size-*`, Radien nur über `--radius-*`; Dateien, die ein Paket ohnehin ändert, ziehen von den Ausnahmelisten auf die Tokens.
- Nur die bestehenden Bausteine: Drawer, `ConfirmDialog`, Flags, `SectionMessage`, `Breadcrumbs`, `ColumnFit`, natives `select`. Kein `treegrid`.
- Was jsdom nicht kann (Layout, Einrückung im echten Browser, NVDA, zwei Tabs), steht als manueller Fall im Test-Manifest.
- **Gates je Paket:**
  - eigener Branch und PR
  - `scripts\build.ps1` lokal komplett grün (Exit-Code 0 und „Build complete!“)
  - CI grün, höchstens drei Versuche; ein roter PR hält die folgenden auf
  - Squash-Merge, Test-Manifest nachgezogen, Entscheidungen in §3

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| UP-1 | ADR-0034, dieser Plan, Nachtrag ADR-0012, CLAUDE.md §5 und §10; Migration mit Rollback; `lib/catalog-rules.js`, Prüfungen im Hook, Archiv-Kaskade, Löschsperre; Spike (Kaskade, verschachtelte Hooks, Realtime); Hook-, Migrations-, Realtime- und Regeltests | BYL-E6-260, BYL-E6-261 |
| UP-2 | `domain/project-tree.ts` (Baum, Pfad, Reihenfolge, Unterprojekte, Auswahl), `Project.parentId`, Katalog, `data/projects.ts` (Anlegen und Ändern mit `parent`); Texte der Codes mit Paritätstest | BYL-E6-262 |
| UP-3 | Projektliste und Kacheln als Baum: Auf- und Zuklappen (`sessionStorage`), Einrückung, Suche mit Kontext, Tabellenregeln aus ADR-0030 | BYL-E6-263, BYL-E6-264 (manuell) |
| UP-4 | Projekt-Panel: Feld „Oberprojekt“, Abschnitt „Unterprojekte“ mit „Unterprojekt anlegen“, Brotkrumen, Rückfrage beim Archivieren mit Anzahl, „Mit Oberprojekt zurückholen“, Löschsperre | BYL-E6-265, BYL-E6-266 (manuell) |
| UP-5 | Projektwahl als Baum („Haus › Garten (GART)“), Filter mit Unterprojekten (URL, Client, Server, Parität), Projektspalte, Sortierung, Gruppierung, Brotkrumen im Ticket, `@CODE` und Unteraufgaben | BYL-E6-267, BYL-E6-268 (manuell) |
| UP-6 | Aggregierte Zahlen mit „davon direkt“, Hilfeseite, README, Abschluss des Plans | BYL-E6-269, BYL-E6-270 (manuell) |

## 3. Entscheidungen

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-28 | UP-1 | **Nummern neu vergeben:** ADR-0034 (0031 bis 0033 sind belegt), Migration `1790202100_projects_parent.js` (nach `1790202000`), Manifest ab `BYL-E6-260` (240 bis 248 belegt der Editor). Paketkürzel `UP`. |
| 2026-09-28 | UP-1 | **Spike bestanden, kein Rückfall nötig:** Die Kaskade speichert jedes aktive Unterprojekt nach `e.next()` des Oberprojekts per `txApp.save`. Dessen `onRecordUpdate` läuft verschachtelt in derselben Transaktion (sein `inTransaction` öffnet keine zweite) und sieht das Oberprojekt schon archiviert; scheitert ein Kind (Fehlerinjektion `__byl_fail_project_archive__`), bleibt alles aktiv. Die `update`-Ereignisse von Oberprojekt und Kindern kommen nach dem Commit bei Besitzer und Haushalt an, nicht bei Fremden. Das SQL-Update mit zweitem `save` aus dem Konzept entfällt (ADR-0034 §4). |
| 2026-09-28 | UP-1 | **Invariante statt Sonderfälle:** `projectParentViolation` prüft neben Selbstbezug, Existenz im Scope und der einen Ebene nur „aktives Projekt unter archiviertem Oberprojekt“. Das deckt Anlegen, Umhängen und Zurückholen eines Kindes ab; ein archiviertes Projekt darf unter ein archiviertes Oberprojekt. |
| 2026-09-28 | UP-1 | **Fremd wie fehlend:** Das Oberprojekt wird mit `id` und dem Scope des Projekts gesucht. Ein Projekt eines anderen Scopes gibt denselben Code und Text wie eine unbekannte ID. Weil der Hook vor der Feldprüfung von PocketBase läuft, meldet auch eine nie vergebene ID `validation_project_parent_missing`. |
| 2026-09-28 | UP-1 | **Scope:** Ein Projekt mit Unterprojekten wechselt den Bereich nicht (`validation_project_scope_children`); ein Unterprojekt, das den Bereich wechseln will, verliert sein Oberprojekt aus dem Scope und bekommt `validation_project_parent_missing`. Eine Kaskade des Bereichs ist für E7 denkbar, nicht jetzt. |
| 2026-09-28 | UP-1 | **Vor der Migration** prüft der Hook das Feld über `record.collection().fields.getByName('parent')`. Ohne Feld: keine Prüfung, keine Kaskade, keine Löschsperre, ein gesendetes `parent` fällt weg. Ein Filter auf `project.parent` beantwortet PocketBase vor der Migration mit 400; die SPA darf ihn deshalb nur senden, wenn das gewählte Projekt Unterprojekte hat (`hooks-before-migration.test.mjs`). |
| 2026-09-28 | UP-1 | **Texte im reinen Modul:** `PROJECT_PARENT_MESSAGES` in `lib/catalog-rules.js` mit dem Wortlaut der Oberfläche („Oberprojekt“, „Unterprojekt“); die SPA bekommt dieselben Texte mit UP-2 (Paritätstest). |
| 2026-09-28 | UP-1 | **Unteraufgaben übernehmen das Projekt 1:1**, also auch ein Unterprojekt, und nicht das Oberprojekt: Eine Unteraufgabe gehört fachlich zu demselben Teil der Arbeit wie ihr übergeordnetes Ticket („Garten“), und der Key `GART-…` zeigt das. Hochrechnen würde die Unteraufgabe beim Filtern auf „Garten“ verstecken. Das ist das heutige Verhalten von `addSubtask`; UP-5 hält es mit einem Test fest. |
| 2026-09-28 | UP-1 | **Gruppieren nach Projekt bleibt flach:** eine Gruppe je konkretem Projekt mit dem Pfad als Titel („Haus › Garten“), in Baum-Reihenfolge (Oberprojekt, dann seine Unterprojekte). Verworfen: eine Gruppe je Oberprojekt mit Unterprojekten darin. Die Tabelle kennt nur eine Gruppenebene; verschachtelte Gruppen bräuchten zweite Köpfe, eigene Zähler und Auf- und Zuklappen in der Tabelle. Flach mit Pfad zeigt, wohin jedes Ticket gehört (Key und Gruppe passen zusammen), zählt je Projekt, und die Baum-Reihenfolge hält die Unterprojekte trotzdem beim Oberprojekt. Wer alles unter „Haus“ sehen will, filtert nach „Haus“ (mit Unterprojekten). |

## 4. Status

| Paket | Stand |
|---|---|
| UP-1 | in Arbeit |
| UP-2 | geplant |
| UP-3 | geplant |
| UP-4 | geplant |
| UP-5 | geplant |
| UP-6 | geplant |

## 5. Offene Punkte

- Manuelle Browser-Prüfungen der Pakete.
- Nach dem Merge von UP-1 braucht die App einen Neustart (stop.bat, dann start.bat), damit die Migration läuft.
