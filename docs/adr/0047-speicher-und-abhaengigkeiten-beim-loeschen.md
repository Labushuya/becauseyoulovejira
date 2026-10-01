# ADR-0047: Speicher und Abhängigkeiten beim Löschen – erst entscheiden, dann endgültig löschen; Speicher einsehen und aufräumen

- **Status:** Angenommen. §1 bis §5 umgesetzt mit SPE-1 (Papierkorb), §6 geplant für SPE-2 (Seite „Einstellungen → Speicher“), nach [docs/plan/speicher.md](../plan/speicher.md); Paketkürzel `SPE`, weil `SP` die Pakete „Spalten“ tragen
- **Datum:** 2026-10-01
- **Entscheidung durch:** Nutzer („Dass man in den Einstellungen den belegten Speicher der App einsehen und ganzheitlich verwalten kann bis hin zur Warnung zu Verknüpfungen, wenn gespeicherte Daten und Einträge gelöscht werden sollen, für Tickets, die noch nicht abgeschlossen sind (oder Untertickets). Geht das ohne Over Engineering?“; zum Papierkorb: „Verweigern von Löschung, erst Abhängigkeiten auflösen (mit Entscheidungs-Auswahlhilfe aller verknüpften Quellen oder alternative Lösung, wenn Verstoß gegen unsere Regeln).“), Advisor (Regel, Wege, Umfang, Pakete), Executor (Recherche, Umsetzung, Einzelheiten)
- **Ändert:** [ADR-0037](0037-papierkorb.md) §2, §6 und §8 (Nachtrag dort): Endgültiges Löschen nimmt nur noch Gruppen ohne Abhängigkeiten; verworfene Quellen werden nicht mehr beim endgültigen Löschen geleert.
- **Bezug:** [ADR-0014](0014-datenmodell-eingang.md) (Tombstone, Fingerprint), [ADR-0031](0031-herkunft-sichern.md) (Hauptquelle unveränderlich, Umhängen), [ADR-0033](0033-unteraufgaben.md) §2 (Erledigen mit offenen Unteraufgaben), [ADR-0035](0035-start-einstieg-und-offene-tabs.md) (Hinweis beim Öffnen), [ADR-0009](0009-fehlerfarbe.md), [ADR-0025](0025-ui-konsistenz-overlay-system.md) (kein Dialog aus einem Dialog), [ADR-0043](0043-system-seite.md) und [ADR-0046](0046-sicherung-pruefung-wiederherstellen.md) (Sicherheitsmodell und Sicherungen, für SPE-2)

## Kontext

- Ein Ticket im Papierkorb ging bisher nach Ablauf der Aufbewahrung (Cron `byl-trash-purge`), mit „Papierkorb leeren“ und mit „Endgültig löschen“ endgültig, egal ob es erledigt war. Mit ihm gingen Unteraufgaben, Kommentare und Verlauf; Quellen, die mit dem Ticket verworfen worden waren („Quellen verwerfen“), wurden sofort zu geleerten Tombstones (Text und Originaldatei weg). Die Tabelle des Papierkorbs zeigte den Status nicht.
- Was die App an Platz belegt (Datenbank, Originaldateien bis 25 MB, Sicherungen, Logs, alte Builds und Programmreste), sah der Nutzer nirgends (SPE-2).

## Entscheidung

### 1. Die Regel (rein in `lib/trash-dependencies.js`, Spiegel `domain/trash-dependencies.ts`)

Eine Gruppe des Papierkorbs (ein Ticket mit den Unteraufgaben, die mit ihm gingen) ist **blockiert**, solange mindestens eines gilt:

- (a) das Ticket selbst ist nicht erledigt (jeder Status außer `done`);
- (b) eine Unteraufgabe der Gruppe ist nicht erledigt;
- (c) an einem Ticket der Gruppe hängt noch eine Quelle (`inbox_items.ticket` = Ticket der Gruppe), Haupt- oder verknüpfte Quelle.

(c) kommt nach ADR-0037 §6 genau bei „Quellen verwerfen“ vor: Diese Quellen bleiben `converted` am Ticket im Papierkorb. Quellen, die mit dem Ticket oder einzeln zurück in den Eingang gingen, verworfene und alte Tombstones hängen an nichts und zählen nicht. Eine Unteraufgabe einer Gruppe hat keine eigenen Abhängigkeiten; ihre Gruppe entscheidet.

### 2. Durchsetzen im Server, in derselben Transaktion

- `purgeGroup` liest die Abhängigkeiten in der Transaktion, in der es löscht, und löscht eine blockierte Gruppe nicht. Das gilt für jeden Weg zum endgültigen Löschen:
  - **„Endgültig löschen“** (`POST /api/byl/trash/{id}/purge`) und das Löschen eines Tickets im Papierkorb durch einen Superuser in der Verwaltung antworten 400 `validation_trash_blocked` (Feld `id`) mit `params` `{ key, ticket, count, tickets, sources, dependencies }`; nichts ändert sich.
  - **„Papierkorb leeren“** löscht die freien Gruppen und lässt die blockierten liegen: `{ purged, blocked: [{ id, key, count }] }`.
  - **Cron `byl-trash-purge`** überspringt abgelaufene blockierte Gruppen, zählt sie (`blocked`) und schreibt „Papierkorb: abgelaufene Tickets blockiert – Entscheidung nötig“ ins Log. Sie bleiben, bis entschieden ist, und gehen dann beim nächsten Lauf.
- Nicht betroffen: der Rückweg der Migration `1790202300` (Semantik vor dem Papierkorb) und das Löschen eines nie bearbeiteten Folgetickets beim Wiedereröffnen (ADR-0023).
- Weil keine Gruppe mit gebundenen Quellen mehr endgültig gelöscht wird, entfällt das sofortige Leeren solcher Quellen beim endgültigen Löschen (`PURGE_KEY`, `purgeContent`). Der Text alter Tombstones (`TRASH_PURGED_BODY`) gilt weiter als bereinigt.

### 3. Entscheidungshilfe (nur regelkonforme Wege)

Die Vorschau `/papierkorb/<id>` zeigt bei einem blockierten Ticket direkt unter den Feldern den Abschnitt „Abhängigkeiten“ (`TrashDependencies`, inline, kein Dialog). Je Abhängigkeit nur die Wege, die unsere Regeln erlauben (`optionsOf`):

| Abhängigkeit | Wege |
|---|---|
| Ticket der Gruppe, nicht erledigt | „Als erledigt markieren“ (das erste Ticket mit offenen Unteraufgaben, die es blockieren, nur als „Mit N Unteraufgaben als erledigt markieren“, ADR-0033 §2), „Wiederherstellen“ (die ganze Gruppe) |
| Unteraufgabe, nicht erledigt | dazu „Lösen und als eigenständiges Ticket wiederherstellen“ |
| verknüpfte Quelle | „Zurück in den Eingang“, „Verwerfen“ (bleibt als Sperre gegen erneutes Eintreffen), „Anderem Ticket zuordnen …“ (der Dialog der Quellen, `MoveSourceDialog`) |
| Hauptquelle | nur „Zurück in den Eingang“ oder „Verwerfen“; die Hilfe sagt kurz, dass die Hauptquelle bei ihrem Ticket bleibt (ADR-0031) |

Sammelwege mit Vorschau („Betrifft 2 Quellen: …“) vor dem Ausführen: „Alle als erledigt markieren“ (Unteraufgaben zuerst), „Alle Quellen zurück in den Eingang“, „Alle Quellen verwerfen“. Nach einer Entscheidung steht der Fokus auf der Überschrift; ist nichts mehr offen, sagt die Hilfe, dass das Ticket jetzt endgültig gelöscht werden kann. „Endgültig löschen …“ der Vorschau bleibt bis dahin gesperrt (`aria-disabled`, mit Grund).

**Server:** `POST /api/byl/trash/{id}/resolve` mit `{ actions: [...] }` (`complete` mit `ticket` und optional `complete_children`, `inbox` und `discard` mit `item`, `move` mit `item` und `target`), höchstens 200, alle in einer Transaktion und vorher rein geprüft (`actionsViolation`: `validation_trash_resolve_empty`, `…_action`, `…_target` für Fremdes, schon Entschiedenes, Doppeltes oder ein Ziel in der Gruppe, `…_primary` für die Hauptquelle). Antwort: die Vorschau danach.

- **Erledigen** setzt Status, `completed_at` und den Verlauf mit dem Nutzer selbst (die Ticket-Hooks überspringen Tickets im Papierkorb); offene blockierende Unteraufgaben ohne `complete_children` lehnt es mit `validation_parent_open_children` ab wie ADR-0033.
- **Zurück in den Eingang / Verwerfen** nutzen den Weg des Löschens (`settleSourcesOfDeletedTicket`: `new` bzw. `discarded` ohne Ticket, `source_meta.ticket_deleted` mit der ID im Papierkorb) und schreiben „Quelle gelöst“ in den Verlauf des Tickets. Die Hauptquelle verlässt vorher `source_item`. Einzeln zurückgegebene Quellen merkt der Schnappschuss unter `sources.returned` (die Hauptquelle zusätzlich als `source_item`); Wiederherstellen verknüpft sie wieder, solange sie frei sind, wie bei „Quellen zurück in den Eingang“.
- **Verwerfen** macht die Quelle zu einem gewöhnlichen verworfenen Eintrag (sichtbar unter „Verworfen“, zurückholbar; die tägliche Bereinigung leert ihn nach 30 Tagen, der Fingerprint bleibt).
- **Umhängen** speichert den Eintrag mit dem neuen Ticket; der Hook des Eingangs prüft das Ziel (lebend, gleicher Bereich, nie die Hauptquelle) und schreibt den Verlauf beider Tickets wie HK-5.
- **Lösen und eigenständig wiederherstellen:** `POST …/{id}/restore` mit `detach_parent: true` für eine Unteraufgabe einer Gruppe (ohne den Schalter weiter `validation_trash_group_member`); `parent` wird leer, mit Verlaufseintrag, das übergeordnete Ticket bleibt im Papierkorb.

### 4. Tabelle und Hinweis

- `TrashTable` hat die Spalte „Status“ (Status-Pille, bei Abhängigkeiten der Lozenge „Blockiert (N)“, weicht als letzte), „Endgültig gelöscht“ sagt bei blockierten „nicht, solange blockiert“, das Menü „•••“ einer blockierten Zeile führt mit „Abhängigkeiten auflösen“ zur Vorschau statt „Endgültig löschen …“. Der Schalter „Nur blockierte (N)“ filtert; der Satz zur Aufbewahrung nennt die Ausnahme. Die Fragen „Papierkorb leeren?“ und „… endgültig löschen?“ (gewählte Zeilen) sagen vorher, was bleibt.
- `GET /api/byl/trash` liefert je Ticket `dependencies` (Anzahl), `GET …/{id}` dazu `dependency_list`.
- **Hinweis beim Öffnen (ADR-0035):** Gibt es Tickets, deren Aufbewahrung abgelaufen ist, die aber blockiert sind, zeigt das `(app)`-Layout beim Anmelden und beim erneuten Öffnen ein Info-Flag „N Tickets im Papierkorb warten auf eine Entscheidung.“ mit „Ansehen“ (`TrashAttention`, wie der Hinweis der Sicherung); sonst nichts.

### 5. Vor dem Neustart

Ohne die neuen Hooks fehlen `dependencies` und `dependency_list`; die SPA liest dann 0 bzw. eine leere Liste, und alle Wege löschen wie vorher. Keine Migration.

### 6. Seite „Einstellungen → Speicher“ (SPE-2, geplant)

Eine Route `GET /api/byl/storage` mit dem Sicherheitsmodell von ADR-0043 rechnet beim Aufruf (ohne Hintergrundjob, ohne Tabelle): Datenbank nach Gruppen, Dateien des Eingangs nach Zugehörigkeit, Sicherungen, Logs, Programmreste, freier Platz. Aktionen mit Vorschau und derselben Regel wie §1. Einzelheiten in [docs/plan/speicher.md](../plan/speicher.md); diese ADR wird mit SPE-2 ergänzt.

## Alternativen

- **Warnen statt verweigern** (Bestätigung „trotzdem löschen“): verworfen, der Nutzer hat sich ausdrücklich für das Verweigern entschieden; eine weitere Bestätigung würde weggeklickt.
- **Blockierte Gruppen beim Ablauf trotzdem löschen** und nur die manuellen Wege prüfen: verworfen, gerade der Cron löscht unbemerkt.
- **Hauptquelle umhängen erlauben, wenn ihr Ticket im Papierkorb liegt:** verworfen, ADR-0031 hält die Hauptquelle unveränderlich (Nutzerentscheidung); die Hilfe bietet die erlaubten Wege und sagt, warum der dritte fehlt.
- **„Verwerfen“ in der Hilfe sofort leeren** (wie bisher beim endgültigen Löschen): verworfen, ein Eintrag soll wie jeder verworfene 30 Tage zurückholbar sein; das vorzeitige Leeren gehört zur Seite „Speicher“ (SPE-2, ausdrücklich und mit Vorschau).
- **Eigene Entscheidungs-Collection oder gespeicherter Zustand „blockiert“:** verworfen, die Regel rechnet aus den Daten, die es schon gibt, und kann nicht veralten.

## Konsequenzen

- Endgültiges Löschen verliert nie unbemerkt offene Arbeit oder Quellen; der Papierkorb kann dafür länger voll bleiben, und der Hinweis erinnert daran.
- Hooks und Tests, die bisher offene Tickets endgültig löschten, erledigen sie vorher oder entscheiden über die Quellen.
- Neustart nötig (Hooks); keine Migration.
