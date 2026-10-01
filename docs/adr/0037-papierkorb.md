# ADR-0037: Papierkorb für Tickets: weiches Löschen, Unsichtbarkeit über die API-Regeln, Wiederherstellen und Aufbewahrung

- **Status:** Angenommen und umgesetzt: §1 bis §8 serverseitig in PB-1 (#151), die Oberfläche (§9) in PB-2, nach [docs/plan/papierkorb.md](../plan/papierkorb.md); manuelle Browser-Prüfungen stehen im Test-Manifest; §9 (Aktionen der Zeile) geändert durch den Nachtrag „Aktionsmenüs“ (2026-10-01); §2, §4, §6, §8 und §9 geändert durch [ADR-0047](0047-speicher-und-abhaengigkeiten-beim-loeschen.md) (Nachtrag „Erst entscheiden, dann endgültig löschen“, SPE-1)
- **Datum:** 2026-09-28
- **Entscheidung durch:** Nutzer (Auftrag „Offene Reste“, Teil B: Papierkorb), Advisor (Produktentscheidungen: Umfang, Gruppen, Quellen, Keys, Rückgängig, Aufbewahrung 7/30/90/nie, Rückweg), Executor (Architektur und Einzelheiten)
- **Ändert:** [ADR-0031](0031-herkunft-sichern.md) Nachtrag B (Quellen beim Löschen), [ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) §6 und [ADR-0022](0022-erzeugung-von-instanzen.md) §5 (Index), [ADR-0033](0033-unteraufgaben.md) (Löschen mit Unteraufgaben), [ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §4 (Rückgängig nach „Löschen“); jeweils mit Nachtrag
- **Bezug:** [ADR-0005](0005-zeitzone-europe-berlin.md) (Berliner Tage), [ADR-0007](0007-realtime-und-sitzungspflege.md) (Realtime), [ADR-0014](0014-datenmodell-eingang.md) (Fingerprint, Tombstone), [ADR-0032](0032-editor-tiptap-markdown.md) §6 (`expected_updated`), [ADR-0034](0034-unterprojekte.md) (Zählungen), [ADR-0025](0025-ui-konsistenz-overlay-system.md), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0009](0009-fehlerfarbe.md) (Oberfläche, PB-2)

## Kontext

- Löschen war endgültig: PocketBase entfernte das Ticket samt Kommentaren, Verlauf und Lesezeilen, leerte `parent` der Unteraufgaben und die Quellen gingen zurück in den Eingang oder wurden verworfen (HK-6). Der Dialog sagte „nicht rückgängig“; Sammel-Löschen (BI-2) bot ausdrücklich kein „Rückgängig“.
- Ein Ticket ist mit vielem verbunden: Key im Nummernkreis, Projekt, Unteraufgaben, Serie (eindeutiger Teilindex über `(recurrence, occurrence)` für offene Instanzen), Quellen mit Hauptquelle, Kommentare, Verlauf, Lesezeilen, Realtime-Abos in mehreren Stores.
- Die SPA liest Tickets auf vielen Wegen (Listen, Suche, Filter, Zähler, `expand`, Unteraufgaben, Wiederholungen, Eingang, Realtime). Ein Filter in jedem dieser Wege wäre leicht zu vergessen.

## Entscheidung

### 1. Datenmodell: weich löschen in derselben Collection

- `tickets.deleted_at` (Datum), `tickets.deleted_by` (Relation `users`) und `tickets.trash` (json, Schnappschuss), Index `idx_tickets_deleted_at`; `users.trash_retention` (`7`, `30`, `90`, `never`, leer = 30 Tage). Migration `1790202300_tickets_trash.js`. Nur der Server schreibt die Ticket-Felder; ein Client, der sie setzt oder ändert, bekommt `validation_trash_managed`.
- Beim Verschieben leert der Dienst die Relationen, über die das Ticket sonst zählen oder stören würde, und hält ihre Werte im Schnappschuss: `project` (mit dem Code), eigenes `parent`, `recurrence` und `occurrence`, und bei „Quellen zurück in den Eingang“ `source_item`, dazu die Quellen und ihre Behandlung. Tags, Titel, Beschreibung, Status, Fälligkeit, Key und Nummer bleiben.
- Unteraufgaben eines gelöschten übergeordneten Tickets bilden seine **Gruppe**: Sie kommen mit in den Papierkorb und behalten `parent` auf das Ticket im Papierkorb. Die Liste des Papierkorbs zeigt nur Tickets ohne `parent` (Gruppenanfang); eine einzeln gelöschte Unteraufgabe ist ihr eigener Gruppenanfang.

### 2. Jeder Löschweg ist weich

- Die Route `POST /api/byl/tickets/{id}/delete` (`{ sources: "inbox" | "discard" }`) verschiebt Ticket und Gruppe in einer Transaktion und antwortet `{ id, updated, tickets }`; `updated` ist die Grundlage für „Rückgängig“.
- `onRecordDeleteRequest` fängt jedes Löschen über die Record-API ab (auch den Superuser im Admin-UI), verschiebt mit „zurück in den Eingang“ und antwortet selbst 204. Er ruft `e.next()` bewusst nicht auf: Das wäre das harte Löschen von PocketBase. Ein Ticket, das schon im Papierkorb liegt (sieht nur der Superuser), löscht derselbe Weg endgültig.
- Hart löschen nur noch: „Endgültig löschen“, „Papierkorb leeren“, die Aufbewahrung, der Rückweg der Migration und das Wiedereröffnen einer Instanz, das ein nie bearbeitetes Folgeticket entfernt (ADR-0023 §3).
- Schreibvorgänge des Papierkorbs tragen den flüchtigen Schlüssel `@trash_op`: Der Update-Hook ruft nur `e.next()` (kein neuer Key, keine Serienlogik, keine Verlaufszeile je Feld). Den Verlauf schreibt der Dienst: Feld `trash` mit `trashed` bzw. `restored`, beim Wiederherstellen dazu echte Änderungen gegenüber dem Schnappschuss (Key, Projekt, Serie, übergeordnetes Ticket).

### 3. Unsichtbarkeit über die API-Regeln

- Die Regeln verbergen den Papierkorb: `tickets` list, view, update, delete mit `deleted_at = ""`; `comments`, `ticket_history`, `ticket_reads` (list, view, create) und `dependencies` über `ticket.deleted_at = ""` bzw. beide Enden; `inbox_items` list, view, update mit `(ticket = "" || ticket.deleted_at = "")`. Damit sind Listen, Suche, Filter, Gruppen, Kennzahlen, Zähler, Unteraufgaben und Fortschritt, Unterprojekt-Aggregate, `expand` (etwa `expand=ticket` im Eingang), die Wiederholungen, geschützte Originaldateien und alle Realtime-Abos ohne Code in der SPA abgesichert.
- Die Hooks lesen am Regelwerk vorbei. Weil das Verschieben die Relationen leert, zählen Projekt-Sperren, offene Unteraufgaben, Serien und Hauptquellen Tickets im Papierkorb nicht mehr. Lookups nach ID (Ziel einer Verknüpfung, `parent`, „Wiederholen…“ mit Ticket, Duplikat-Meldung) behandeln ein Ticket im Papierkorb wie ein fehlendes. Die Inventur aller Pfade steht im Plan §3.
- **Realtime:** PocketBase prüft bei einem Update die Regeln mit dem neuen Stand, ein verborgener Datensatz meldet also nichts. Nach dem Commit schickt der Dienst jedem berechtigten angemeldeten Konto (`canAccessRecord` mit der Sichtbarkeit ohne Papierkorb) unter dem Namen jedes passenden Abos genau das `delete`-Ereignis, das ein hartes Löschen geschickt hätte (nur ID und Collection), für die Tickets der Gruppe und die verborgenen Quellen. Dazu das Thema `byl/trash` ohne Daten für offene Tabs der Besitzer. Wiederherstellen ist ein normales Update und kommt wie gewohnt an.
- **Eigener Weg des Papierkorbs:** `GET /api/byl/trash` (Gruppenanfänge mit Key, Titel, Projekt aus dem Schnappschuss, gelöscht am, von, Zahl der Unteraufgaben, Resttage, und die eigene Aufbewahrung), `GET /api/byl/trash/{id}` (Vorschau nur lesend, auch für Unteraufgaben mit Verweis auf ihre Gruppe), `POST …/{id}/restore`, `POST …/{id}/purge`, `POST /api/byl/trash/empty`. Alle prüfen die Sichtbarkeit ohne Papierkorb-Bedingung (fremd = 404) und antworten vor der Migration 503 mit dem Neustart-Hinweis.

### 4. Wiederherstellen: Gruppen und Unteraufgaben

- Wiederherstellen gilt immer einer ganzen Gruppe, in einer Transaktion; alle Prüfungen laufen vor dem ersten Schreiben. Eine Unteraufgabe einer Gruppe allein wird abgelehnt (`validation_trash_group_member`).
- Eine einzeln gelöschte Unteraufgabe kommt an ihr übergeordnetes Ticket zurück, wenn es lebt, im selben Bereich liegt und selbst keine Unteraufgabe ist; sonst eigenständig mit `parent_detached` im Ergebnis und einer Verlaufszeile.
- Mit `expected_updated` (so ruft „Rückgängig“ auf) lehnt der Dienst ab, wenn das Ticket inzwischen geändert wurde (`validation_trash_stale`); nichts wird still überschrieben. Ein schon wiederhergestelltes Ticket liegt nicht mehr im Papierkorb (404).

### 5. Keys und Projekte

- Der Key bleibt während der Papierkorbzeit reserviert (eindeutiger Index `(scope, key)`, der Zähler zählt nie zurück) und beim Wiederherstellen erhalten, wenn es kein Projekt gab oder das Projekt mit demselben Code im selben Bereich noch existiert (auch archiviert).
- Sonst meldet der Dienst `validation_trash_project_required` mit dem alten Code und dem Grund (`missing` oder `changed`). Mit `project` (aktives Projekt im Bereich, leer für „Kein Projekt“; archivierte und fremde `validation_trash_project_invalid`) vergibt er neue Keys im Ziel-Nummernkreis wie beim Projektwechsel, samt Verlauf.
- Weil Tickets im Papierkorb kein Projekt mehr tragen, sperren sie weder Code noch Löschen eines Projekts ohne lebende Tickets. Das Löschen von Projekten selbst bleibt unverändert.

### 6. Quellen

- Die Wahl im Löschdialog bleibt. **„Zurück in den Eingang“:** sofort `new` ohne Ticket, `source_meta.ticket_deleted = { key, at, ticket }` (neu: die ID im Papierkorb), ohne Verlaufszeile „Quelle gelöst“. **„Verwerfen“:** Die Quellen bleiben gebunden (`converted`) am Ticket im Papierkorb, durch die Regeln verborgen, und kommen beim Wiederherstellen mit zurück.
- Wiederherstellen verknüpft zurückgegebene Quellen nur, solange sie `new` ohne Ticket im selben Bereich sind (die Hauptquelle bekommt dann wieder `source_item`, `ticket_deleted` entfällt); inzwischen umgewandelte, verknüpfte oder verworfene werden übersprungen und im Ergebnis mit Grund genannt.
- **Endgültiges Löschen** macht verworfene Quellen sofort zum Tombstone: `discarded`, Text „Das Ticket wurde endgültig gelöscht.“, Originaldatei und Details entfernt, Titel gekürzt, Fingerprint bleibt. Die tägliche Bereinigung des Eingangs erkennt ihn als bereinigt.

### 7. Wiederholungen

- Der eindeutige Teilindex heißt jetzt `UNIQUE (recurrence, occurrence) WHERE recurrence != '' AND status != 'done' AND deleted_at = ''`. Das Verschieben leert `recurrence` zusätzlich; die Bedingung hält den Index für jede Zeile richtig.
- Verschieben einer offenen Instanz wirkt wie das bisherige Löschen (§6 von ADR-0023): fester Rhythmus überspringt den Termin, „nach Erledigung“ wartet ab heute. Der Cron erzeugt die nächste Instanz zum nächsten Termin, nie sofort, genau wie nach dem Hartlöschen; der Papierkorb ändert daran nichts.
- Wiederherstellen prüft in der Transaktion mit `reopenConflicts` gegen lebende offene Tickets der Serie (ohne „Jeden Termin einzeln“ jede offene Instanz, mit Schalter nur eine desselben Termins, `occurrence` aus dem Schnappschuss). Bei Konflikt `validation_trash_series_conflict` mit Key und ID des offenen Tickets; mit `detach_series` kommt das Ticket als normales Ticket zurück (`series_detached`). `next_due` wird nie angefasst. Eine gelöschte oder fremde Regel ergibt ein normales Ticket (`rule_missing`).

### 8. Aufbewahrung

- Standard 30 Tage, pro Konto 7, 30, 90 Tage oder „nie“ (`users.trash_retention`); für Haushalts-Tickets gilt das Konto des Besitzers. Die Frist zählt Berliner Kalendertage ab dem Tag des Löschens (gelöscht am 1. Oktober, 30 Tage: endgültig am 31. Oktober).
- Cron `byl-trash-purge` täglich 11:45 UTC (nach `byl-inbox-cleanup`), dazu beim Start; je Gruppe eine eigene Transaktion, Unteraufgaben zuerst, Fehler geloggt, Anzahl im Log, idempotent.
- Rückweg der Migration: Tickets im Papierkorb werden endgültig gelöscht (Semantik vor dem Papierkorb; ihre verworfenen Quellen werden Tombstones mit `ticket_deleted`), die Anzahl steht im Log, Regeln und Index wie vorher. Das hängt nicht an den Hooks.

### 9. Oberfläche (PB-2)

- **Navigation:** Nach dem Umschalter „Aufgaben | Projekte | Eingang | Wiederholungen“ steht der dezente Link „Papierkorb“ mit der Zahl der Tickets darin, kein fünftes Segment: Der Papierkorb ist keine Arbeitsansicht und soll nicht mit ihnen konkurrieren.
- **Seite `/papierkorb`** (`TrashView`, `TrashTable`, Store `TrashStore` im `(app)`-Layout): Aufbewahrung mit „Aufbewahrung ändern“, „Papierkorb leeren …“, Tabelle mit Auswahl, Key, Titel (Link auf die Vorschau, „mit N Unteraufgaben“), Projekt aus dem Schnappschuss („gelöscht oder geändert“), Gelöscht am, Von, „Endgültig gelöscht in N Tagen / heute / nie“ und den Aktionen „Wiederherstellen“ und „Endgültig löschen …“. Auswahl wie ADR-0036 §2 (`domain/selection.ts`), gewählte Zeilen bekommen die gemeinsame Glas-Leiste `SelectionBar` (ADR-0029, Nachtrag) mit denselben zwei Aktionen, je Ticket eine Anfrage, höchstens vier zugleich. Leer: `EmptyState`. Vor dem Neustart der Neustart-Hinweis.
- **Endgültig löschen und Leeren** fragen per `ConfirmDialog` und sagen „Das lässt sich nicht rückgängig machen.“; der Knopf ist wie jede destruktive Bestätigung des Projekts nicht rot (ADR-0009, CLAUDE.md §8).
- **Wahl beim Wiederherstellen** inline (kein Dialog, auch aus der Vorschau): Zielprojekt oder „Als normales Ticket wiederherstellen (aus Serie lösen)“; getroffene Wahlen gehen mit, falls danach die nächste nötig ist.
- **Vorschau `/papierkorb/<id>`:** nur lesend (Felder, Beschreibung als sanitisiertes Markdown ohne Abhaken, Unteraufgaben, Quellen, gelöscht am und von); „Wiederherstellen“ führt zum Ticket. Eine Unteraufgabe einer Gruppe hat keine Aktionen, nur den Weg zu ihrem übergeordneten Ticket.
- **Löschdialoge** (Panel, Vollansicht inline, Sammel-Leiste): „… in den Papierkorb verschieben?“ mit „In den Papierkorb“, Aufbewahrung und mitgehenden Unteraufgaben statt „nicht rückgängig“; danach ein Flag „… in den Papierkorb verschoben.“ mit „Rückgängig“ (Wiederherstellen mit `expected_updated`).
- **Links auf Tickets im Papierkorb** (Panel eines nicht sichtbaren oder anderswo gelöschten Tickets, Hinweis eines Eintrags im Eingang) zeigen neutral „Dieses Ticket liegt im Papierkorb“ mit „Im Papierkorb ansehen“ (`TrashNotice`).
- **Einstellung:** neue Seite „Einstellungen → Tickets“ mit der Radiogruppe „Papierkorb“ (7, 30, 90 Tage, „Nie automatisch“). Nicht unter „Darstellung“: Die Aufbewahrung gilt am Konto auf dem Server, „Darstellung“ nur in diesem Browser.

## Alternativen

- **Eigene Collection `trashed_tickets`** (Ticket beim Löschen umziehen): verworfen. Kommentare, Verlauf, Lesezeilen und Quellen hängen per Relation am Ticket und gingen beim Umzug verloren oder müssten mit umziehen; der Key wäre im Nummernkreis nicht mehr durch den eindeutigen Index reserviert.
- **Filter in der SPA statt in den Regeln:** verworfen. Über 20 Lesepfade (Listen, Suche, Zähler, `expand`, Realtime, Dateien) müssten jeden Filter selbst tragen; ein vergessener Pfad zeigte gelöschte Tickets.
- **Relationen am Ticket im Papierkorb behalten** und jede Hook-Abfrage um `deleted_at = ''` ergänzen: verworfen. Jede künftige Abfrage müsste daran denken; Projekt-Löschen und Tag-Löschen würden Tickets im Papierkorb über ihre Hooks ändern (neuer Key). Das Leeren mit Schnappschuss macht die bestehenden Abfragen ohne Änderung richtig und funktioniert auch vor dem Neustart.
- **Verworfene Quellen beim Verschieben sofort verwerfen** (wie bisher): verworfen, weil die Bereinigung sie nach 30 Tagen leert und ein Wiederherstellen nach 90 Tagen leere Quellen zurückbrächte; so bleiben sie bis zum endgültigen Löschen vollständig.
- **Verworfene Quellen beim endgültigen Löschen als Datensatz löschen:** verworfen (Abweichung vom Wortlaut „wirklich entfernt“): Ohne Fingerprint käme dieselbe Mail bei der nächsten Vollsuche des Posteingangs oder derselbe Kalendertermin wieder in den Eingang. Text, Originaldatei und Details werden sofort entfernt.
- **Aufbewahrung im Browser (`localStorage`):** verworfen, der Cron läuft ohne offenen Tab und braucht den Wert auf dem Server.

## Konsequenzen

- Löschen ist für jeden Weg umkehrbar, bis die Aufbewahrung abläuft; „nicht rückgängig“ gilt nur noch für „Endgültig löschen“ und „Papierkorb leeren“.
- Neue Lesepfade der SPA sind ohne Zutun abgesichert. Neue Hook-Abfragen über andere Felder als die geleerten Relationen müssen `trashRules.isTrashed` bzw. `deleted_at = ''` beachten (Plan §3.2).
- Tickets im Papierkorb halten ihren Key und ihre Tags fest (ein Tag, das nur sie tragen, wechselt den Bereich nicht; relevant erst mit Haushalten, E7).
- Neustart nötig (Migration); bis dahin löschen alle Wege wie vorher endgültig.

## Nachtrag (2026-10-01, Plan „Aktionsmenüs“, AM-3 und AM-4)

- **Zeile der Tabelle (ändert §9):** „Endgültig löschen …“ steht seit AM-4 im Menü „•••“ der Zeile, nach „Vorschau öffnen“ und „Wiederherstellen“ und einer Linie, nicht mehr als eigenes Symbol; „Wiederherstellen“ bleibt sichtbar. Ein Rechtsklick auf die Zeile oder Umschalt+F10 öffnen dasselbe Menü. Die Frage „… endgültig löschen?“, die Leiste der gewählten Zeilen und die Vorschau bleiben unverändert. Gründe: [ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md), Nachtrag „Zeilenmenüs der übrigen Tabellen“.
- **Sammel-Leiste der Aufgaben:** Der Knopf „Löschen …“ heißt seit AM-3 „In den Papierkorb …“ wie die Frage und das Flag (§9 „Löschdialoge“).

## Nachtrag (2026-10-01): Quellen bleiben Tombstones, auch gegen die API

§6 und die Alternative „Verworfene Quellen beim endgültigen Löschen als Datensatz löschen“ halten den Fingerprint verworfener Quellen fest, damit dasselbe Objekt nicht wiederkommt. Über die Record-API und die Verwaltung ließ sich ein freier Eintrag trotzdem löschen. Seit dem Nachtrag vom 2026-10-01 zu [ADR-0014](0014-datenmodell-eingang.md) lehnen `deleteRule = null` (Migration `1790202800`) und `onRecordDeleteRequest` von `inbox_items` jedes Löschen über die API ab, auch für Superuser. Der Papierkorb ist nicht betroffen: Er ändert Einträge nur (zurück in den Eingang, verborgen, Tombstone) und läuft über die Wege des Servers, nie über die Record-API von `inbox_items`. Seine `delete`-Ereignisse für verborgene Quellen (§3 „Realtime“) bleiben; ein hartes Löschen eines Eintrags über die API gibt es nicht mehr.

## Nachtrag (2026-10-01, [ADR-0047](0047-speicher-und-abhaengigkeiten-beim-loeschen.md), SPE-1): Erst entscheiden, dann endgültig löschen

Nutzerentscheidung: „Verweigern von Löschung, erst Abhängigkeiten auflösen (mit Entscheidungs-Auswahlhilfe aller verknüpften Quellen oder alternative Lösung, wenn Verstoß gegen unsere Regeln).“

- **Ändert §2 und §8:** Jeder Weg zum endgültigen Löschen („Endgültig löschen“, „Papierkorb leeren“, der Cron `byl-trash-purge`, das Löschen eines Tickets im Papierkorb durch einen Superuser) nimmt nur noch Gruppen ohne Abhängigkeiten: kein Ticket der Gruppe offen, keine Quelle mehr an einem Ticket der Gruppe. Die manuellen Wege lehnen mit `validation_trash_blocked` und der Liste ab, „Papierkorb leeren“ lässt blockierte liegen und nennt sie, der Cron überspringt und zählt sie. Geprüft wird in der Transaktion des Löschens.
- **Ändert §6:** Weil Quellen, die mit dem Ticket verworfen wurden, das endgültige Löschen blockieren, werden sie nicht mehr beim endgültigen Löschen geleert. Die Entscheidungshilfe gibt sie zurück in den Eingang, verwirft sie (gewöhnlicher verworfener Eintrag, die Bereinigung leert ihn nach 30 Tagen) oder hängt eine verknüpfte Quelle an ein anderes Ticket; die Hauptquelle nie.
- **Ändert §4:** Eine Unteraufgabe einer Gruppe lässt sich mit `detach_parent` allein als eigenständiges Ticket wiederherstellen („Lösen und als eigenständiges Ticket wiederherstellen“).
- **Ändert §9:** Spalte „Status“ mit „Blockiert (N)“, Filter „Nur blockierte“, „nicht, solange blockiert“ statt der Resttage, „Abhängigkeiten auflösen“ statt „Endgültig löschen …“ im Menü einer blockierten Zeile, Abschnitt „Abhängigkeiten“ in der Vorschau, Hinweis beim Öffnen, wenn abgelaufene Tickets auf eine Entscheidung warten.
- Einzelheiten, Routen und Alternativen in ADR-0047.
