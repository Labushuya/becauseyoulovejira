# E6-Plan, Teil „Papierkorb“ (Offene Reste B): weiches Löschen, Wiederherstellen, Aufbewahrung

- **Stand:** umgesetzt (2026-09-28): PB-1 (#151, Datenmodell, Migration, Hooks, Lesepfade, Aufbewahrung; Neustart nötig), PB-2 (Oberfläche). Offen ist die manuelle Browser-Prüfung (BYL-E6-338).
- **Grundlage:**
  - Auftrag „Papierkorb“ (Offene Reste B, 2026-09-28) mit den Produktentscheidungen des Advisors (unten §1).
  - [ADR-0037](../adr/0037-papierkorb.md) (neu), [ADR-0031](../adr/0031-herkunft-sichern.md) Nachtrag B (Quellen beim Löschen), [ADR-0021](../adr/0021-regelmodell-wiederkehrende-aufgaben.md) bis [ADR-0024](../adr/0024-serien-aus-kalendern.md) mit Nachträgen 2 (Index `(recurrence, occurrence)`, `reopenConflicts`, `next_due` nie zurück), [ADR-0033](../adr/0033-unteraufgaben.md) (eine Ebene), [ADR-0034](../adr/0034-unterprojekte.md) (Zählungen), [ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) (Sammelaktionen, Rückgängig mit `expected_updated`), [ADR-0013](../adr/0013-filter-suche-sortierung-gruppierung.md), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0009](../adr/0009-fehlerfarbe.md), [ADR-0029](../adr/0029-glas-materialien.md)
  - Hinweise aus [Offene Reste](offene-reste.md) §6 und [Bulk, Inline und Ansicht](bulk-inline-ansicht.md) §6
  - [CLAUDE.md](../../CLAUDE.md) §3, §5, §6, §7, §8, §11, §12
- **Einordnung:** Paketkürzel `PB`, Manifest-Block „Papierkorb“ ab `BYL-E6-330`, ADR-0037, Migration `1790202300_tickets_trash.js` (nach `1790202200`).

## 1. Produktentscheidungen (Advisor, 2026-09-28)

1. Papierkorb für Tickets samt Unteraufgaben und ihren Quellen. Das Löschen von Projekten bleibt unverändert (möglicher Folgeschritt, §6).
2. Jeder Löschweg eines Tickets ist weich. Ein übergeordnetes Ticket nimmt seine Unteraufgaben als Gruppe mit; sie kommen gemeinsam zurück bzw. gehen gemeinsam. Eine einzeln gelöschte Unteraufgabe kommt an ihr übergeordnetes Ticket zurück, wenn es lebt, sonst eigenständig (im Ergebnis genannt).
3. Gelöschte Tickets erscheinen und zählen nirgends mehr; Links auf sie zeigen neutral „liegt im Papierkorb“. Absicherung bevorzugt serverseitig, die Papierkorbansicht hat einen eigenen Weg.
4. Wiederholungen: gelöschte Instanzen blockieren den Index nicht; Wiederherstellen prüft wie `reopenConflicts`, verdoppelt nie und bietet „Als normales Ticket wiederherstellen (aus Serie lösen)“; `occurrence` wird gesichert; `next_due` nie zurück.
5. Quellen: Wahl „zurück in den Eingang“ oder „verwerfen“ bleibt; verworfene kommen mit zurück und gehen erst beim endgültigen Löschen; zurückgegebene werden beim Wiederherstellen wieder verknüpft, außer inzwischen anders umgewandelt, verknüpft oder verworfen.
6. Keys bleiben reserviert; fehlt das Projekt oder hat es Bereich oder Code gewechselt, verlangt das Wiederherstellen ein Zielprojekt und vergibt einen neuen Key.
7. „Rückgängig“ nach Einzel- und Sammel-Löschen (= Wiederherstellen mit `expected_updated`); der Löschdialog nennt den Papierkorb statt „nicht rückgängig“.
8. Seite `/papierkorb` mit Navigationseintrag und Anzahl, Tabelle, Aktionen je Zeile und gesammelt, „Papierkorb leeren“, leerer Zustand, Vorschau nur lesend.
9. Aufbewahrung 30 Tage (Standard), einstellbar 7 / 30 / 90 Tage / nie; täglich per `cronAdd`, idempotent, in Transaktionen, mit Log.
10. Rückweg der Migration löscht den Papierkorb endgültig (Semantik vor dem Papierkorb), Index wie vorher.

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| PB-1 | Migration (Felder, Index, Regeln, Einstellung), Hook-Logik Verschieben / Wiederherstellen / endgültig löschen, Routen des Papierkorbs, Cron und Start, Inventur und Absicherung aller Lesepfade, Tests | BYL-E6-330 bis BYL-E6-333 |
| PB-2 | Seite „Papierkorb“ mit Navigation und Anzahl, Löschdialog-Texte, „Rückgängig“ einzeln und gesammelt, Hinweis bei Links auf Tickets im Papierkorb, Einstellung der Aufbewahrung, Tests, Manifest | BYL-E6-334 bis BYL-E6-337, BYL-E6-338 (manuell) |

## 3. Inventur der Lesepfade (PB-1)

Grundsatz: Die API-Regeln verbergen jedes Ticket mit `deleted_at` (Migration `1790202300`). Was über ein Ticket sichtbar ist, trägt die Bedingung `ticket.deleted_at = ""`. Damit kann kein Pfad der SPA ein Ticket im Papierkorb lesen, zählen, erweitern oder abonnieren. Die Hooks lesen am Regelwerk vorbei; für sie leert das Verschieben die Relationen, über die sie lesen (Projekt, eigenes `parent`, Serie, Hauptquelle bei „zurück in den Eingang“), und die übrigen Lookups nach ID prüfen `trashRules.isTrashed`.

### 3.1 API-Regeln (serverseitig, gilt für jeden Client)

| Collection | Regeln mit Papierkorb-Bedingung | Wirkung |
|---|---|---|
| `tickets` | list, view, update, delete: `&& deleted_at = ""` | Listen, Suche, Filter, Gruppen, Zähler, Kennzahlen, Unteraufgaben (`parent = …`), Pfad, Projekt- und Tag-Zählungen, Unterprojekt-Aggregate, `getOne` (404), Realtime-Abos `tickets/*` und `tickets/<id>`, `expand` auf Tickets von anderen Collections |
| `comments` | alle fünf: `&& ticket.deleted_at = ""` | keine Kommentare lesen, schreiben, ändern |
| `ticket_history` | list, view | kein Verlauf |
| `ticket_reads` | list, view, create | keine Lesezeilen („neu“ zählt nichts) |
| `dependencies` | list, view: beide Enden lebendig | vorbereitet für Stufe 2 |
| `inbox_items` | list, view, update: `&& (ticket = "" \|\| ticket.deleted_at = "")` | Quellen, die mit dem Ticket im Papierkorb bleiben („Quellen verwerfen“), sind im Eingang, in „Quellen“, im Chip „→ KEY“, in `expand=ticket`, im Download der Originaldatei (geschützte Datei über die viewRule) und in der Seitenkopie unsichtbar |

### 3.2 Hooks (lesen am Regelwerk vorbei)

| Pfad | Datei | Absicherung |
|---|---|---|
| Offene Unteraufgaben beim Erledigen, `hasChildren`, Parent-Prüfung | `lib/ticket-service.js` | Einzeln gelöschte Unteraufgaben haben kein `parent` mehr; Gruppen hängen nur an einem Ticket im Papierkorb. Ein `parent` im Papierkorb liest sich wie ein fehlendes (`validation_scope_mismatch`). |
| Offene Instanz, `reopenConflicts`, `hasOpenOccurrence`, `openDateOf`, Erzeugung | `lib/recurrence-service.js` | `recurrence` und `occurrence` sind geleert; zusätzlich schließt der eindeutige Index Tickets im Papierkorb aus. |
| „Wiederholen…“ mit Ticket | `lib/recurrence-service.js` | Ticket im Papierkorb wie fehlend (`validation_recurrence_ticket_missing`). |
| Projekt löschen, Code und Bereich sperren | `lib/catalog-service.js` | `project` ist geleert: Tickets im Papierkorb zählen nicht (Wiederherstellen verlangt dann ein Zielprojekt). |
| Tag: Bereich sperren | `lib/catalog-service.js` | Tags bleiben am Ticket im Papierkorb (für das Wiederherstellen); ein Tag, das nur Tickets im Papierkorb tragen, behält seinen Bereich. Bewusst, da Haushalte erst mit E7 kommen. |
| Verknüpfen, Umhängen einer Quelle | `lib/inbox-service.js` `prepareUpdate` | Ziel im Papierkorb wie fehlend (`validation_scope_mismatch`). |
| Hauptquelle (`isPrimarySource`) | `lib/inbox-service.js` | Bei „zurück in den Eingang“ ist `source_item` geleert (im Schnappschuss); bei „verwerfen“ bleibt die Quelle gebunden und verborgen. |
| Duplikat-Meldung, Nachschlagen der Auswahlansichten | `lib/inbox-service.js` `assertNoDuplicate`, `lookup` | Ticket im Papierkorb gilt als keins: „Schon umgewandelt.“ ohne Key. |
| Löschen einer Quelle | `lib/inbox-service.js` `guardDelete`, deleteRule `ticket = ""` | unverändert: gebundene Quellen bleiben unlöschbar. |
| Realtime | `lib/trash-service.js` | PocketBase prüft Regeln mit dem neuen Stand und schickt verborgenen Datensätzen nichts; nach dem Commit gehen deshalb die `delete`-Ereignisse (nur ID) an alle berechtigten Abos von Ticket und verborgenen Quellen, dazu `byl/trash`. |
| Kanäle (Kalender, Telegram, Mail, Ingest, `.ics`), Präsenz und Hinweis (`/api/byl/presence`, `attention`), Start | `lib/channel-*.js`, `lib/ingest-service.js`, `lib/presence-service.js`, `recurrence.pb.js` | lesen keine Tickets (geprüft); Duplikate laufen über `inbox-service` (oben). Der Start holt zusätzlich das Aufräumen des Papierkorbs nach. |
| Bereinigung verworfener Einträge | `lib/inbox-cleanup-service.js` | liest nur `discarded`; Quellen im Papierkorb sind `converted`. Sofort geleerte Tombstones (endgültig gelöscht) erkennt sie als bereinigt. |
| Wiedereröffnen löscht unberührtes Folgeticket | `lib/recurrence-service.js` `reopen` | bleibt hartes Löschen (automatisch erzeugt, nie bearbeitet; kein Papierkorb für ein Ticket, das der Nutzer nie gesehen hat). |

### 3.3 SPA (Datenschicht, alle über die Regeln abgesichert)

| Weg | Datei | Ergebnis |
|---|---|---|
| Listen offen und erledigt, Unteraufgaben, Suche, `searchTickets`, `searchOpenTicketIds`, `getTicket` | `data/tickets.ts` | Regeln der Tickets |
| Erledigte eines Projekts, Tickets mit Tag | `data/projects.ts`, `data/tags.ts` | Regeln der Tickets |
| Quellen eines Tickets, Eingang, `expand=ticket`, Termin-Datum der Hauptquelle, Zahl der Quellen | `data/inbox.ts`, `data/bulk.ts` | Regeln von `inbox_items` (und `expand` der Tickets) |
| Kommentare, Verlauf, Lesezeilen | `data/comments.ts`, `data/history.ts`, `data/reads.ts` | Regeln über das Ticket |
| Regeln und „Offenes Ticket“ der Wiederholungen | `data/recurrence.ts` | Regeln der Tickets |
| Realtime aller Stores | `data/realtime.ts` | Regeln plus `delete`-Ereignisse des Papierkorbs |
| Papierkorb selbst | `/api/byl/trash…` (PB-2: `data/trash.ts`) | eigener, ausdrücklicher Weg mit der Sichtbarkeit ohne Papierkorb-Bedingung |

## 4. Entscheidungen

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-28 | PB-1 | **Weich löschen in derselben Collection** mit `deleted_at`, `deleted_by` und dem Schnappschuss `trash` (json) statt einer eigenen Collection: Kommentare, Verlauf, Lesezeilen und Quellen hängen per Relation am Ticket und gingen beim Umzug verloren; der Key bleibt über `idx_tickets_scope_key` reserviert. Begründung und Alternativen in ADR-0037. |
| 2026-09-28 | PB-1 | **Unsichtbarkeit über die API-Regeln** (Bedingung an Tickets und an allem, was über ein Ticket sichtbar ist) statt Filtern in der SPA: kein Client-Pfad kann vergessen werden, auch `expand`, Zähler, Realtime und geschützte Dateien nicht. Der Papierkorb liest über eigene Routen mit der Sichtbarkeit ohne diese Bedingung. |
| 2026-09-28 | PB-1 | **Relationen beim Verschieben leeren, Schnappschuss behalten:** Projekt, Serie (`recurrence`, `occurrence`), eigenes `parent` und bei „zurück in den Eingang“ `source_item`. Die Hooks lesen fast nur über diese Relationen; so bleiben Zählungen, Sperren, Unteraufgaben und Serien ohne Filter in jeder Abfrage richtig, auch vor dem Neustart. Unteraufgaben einer Gruppe behalten `parent` (auf das Ticket im Papierkorb), damit die Gruppe erkennbar bleibt. Tags bleiben. |
| 2026-09-28 | PB-1 | **Schreiben am Hook vorbei mit Kennzeichen:** Verschieben und Wiederherstellen speichern mit dem flüchtigen Schlüssel `@trash_op`; der Update-Hook ruft dann nur `e.next()` (kein neuer Key, keine Verlaufszeilen je Feld, keine Serienlogik). Den Verlauf schreibt der Dienst selbst (Feld `trash`: `trashed`/`restored`, beim Wiederherstellen dazu echte Änderungen gegenüber dem Schnappschuss wie neuer Key, Projekt, gelöste Serie oder übergeordnetes Ticket). Interne Speicherungen eines Tickets im Papierkorb (PocketBase leert ein gelöschtes Tag) laufen ebenso ohne Logik. |
| 2026-09-28 | PB-1 | **Jeder Löschweg:** Die Route „Ticket löschen mit Quellenbehandlung“ verschiebt und antwortet `{ id, updated, tickets }`. `onRecordDeleteRequest` fängt das Löschen über die Record-API ab (auch Superuser im Admin-UI), verschiebt mit „zurück in den Eingang“ und antwortet selbst 204 statt `e.next()` aufzurufen, weil `e.next()` das harte Löschen von PocketBase ausführen würde. Ein Ticket, das schon im Papierkorb liegt (nur für Superuser sichtbar), löscht derselbe Weg endgültig. Das Wiedereröffnen einer Instanz löscht ein unberührtes Folgeticket weiter hart. |
| 2026-09-28 | PB-1 | **Realtime:** PocketBase prüft bei Updates die Regeln mit dem neuen Stand, ein verborgener Datensatz meldet also nichts. Der Dienst schickt nach dem Commit an jede Sitzung eines berechtigten Kontos (Prüfung mit `canAccessRecord` und der Sichtbarkeit ohne Papierkorb) genau das `delete`-Ereignis, das ein hartes Löschen geschickt hätte, unter dem Namen jedes passenden Abos (mit seinen Optionen), nur mit ID und Collection. Die Stores der SPA behandeln es wie bisher. Dazu das Thema `byl/trash` ohne Daten, damit offene Tabs den Papierkorb neu lesen. |
| 2026-09-28 | PB-1 | **Wiederholungen:** Der eindeutige Index bekommt `AND deleted_at = ''` (Migration), obwohl das Verschieben `recurrence` leert: So bleibt er für jede Zeile richtig, auch wenn eine Zeile im Papierkorb eine Regel trägt (belegt per Test am Index vorbei). Verschieben einer offenen Instanz wirkt wie das bisherige Löschen (`prepareTicketDelete`: fester Rhythmus überspringt den Termin, „nach Erledigung“ wartet ab heute): Der Cron erzeugt die nächste Instanz zum nächsten Termin, nie sofort, genau wie nach dem Hartlöschen. Wiederherstellen prüft in der Transaktion mit `reopenConflicts` gegen lebende offene Tickets der Serie; bei Konflikt `validation_trash_series_conflict` mit Key, mit `detach_series` als normales Ticket. `next_due` wird nie angefasst. Eine gelöschte oder fremde Regel ergibt ein normales Ticket (`rule_missing`). |
| 2026-09-28 | PB-1 | **Quellen:** „zurück in den Eingang“ setzt sie sofort auf `new` mit `ticket_deleted` (jetzt mit `ticket`, der ID im Papierkorb), ohne Verlaufszeile „Quelle gelöst“. „Verwerfen“ lässt sie gebunden (`converted`) am Ticket im Papierkorb, verborgen durch die Regeln; sie kommen beim Wiederherstellen mit zurück. Beim Wiederherstellen werden zurückgegebene Quellen nur verknüpft, solange sie `new` ohne Ticket im selben Bereich sind; sonst stehen sie mit Grund (`converted`, `discarded`, `missing`) im Ergebnis. Die Hauptquelle bekommt `source_item` nur zurück, wenn sie wieder verknüpft wird. |
| 2026-09-28 | PB-1 | **Abweichung „wirklich entfernt“:** Verworfene Quellen werden beim endgültigen Löschen sofort zum Tombstone geleert (Text „Das Ticket wurde endgültig gelöscht.“, Originaldatei und Details weg, Titel gekürzt), statt den Datensatz zu löschen. Der Fingerprint bleibt, sonst käme dieselbe Mail bei der nächsten Vollsuche des Posteingangs oder derselbe Kalendertermin wieder in den Eingang (ADR-0014 §3, ADR-0031 Nachtrag B). Die tägliche Bereinigung erkennt diesen Text als bereinigt. |
| 2026-09-28 | PB-1 | **Keys und Projekte:** Der Key bleibt reserviert (eindeutiger Index über `scope, key`, der Zähler zählt nie zurück). Wiederherstellen behält ihn, wenn es kein Projekt gab oder das Projekt mit demselben Code im selben Bereich noch lebt (auch archiviert). Sonst `validation_trash_project_required` mit Code und Grund (`missing` oder `changed`); mit `project` (aktives Projekt im Bereich oder leer für „Kein Projekt“) vergibt der Dienst neue Keys im Ziel-Nummernkreis für alle betroffenen Tickets der Gruppe, samt Verlauf. Weil geleerte Projekte keine Tickets mehr zählen, lassen sich Code und Löschen eines Projekts ohne lebende Tickets wieder ändern. |
| 2026-09-28 | PB-1 | **Unteraufgaben:** Einzeln gelöscht verlässt eine Unteraufgabe ihr übergeordnetes Ticket (Schnappschuss `parent`), zählt und blockiert nicht mehr. Beim Wiederherstellen kommt sie zurück, wenn das übergeordnete Ticket lebt, im Bereich liegt und selbst keine Unteraufgabe ist; sonst eigenständig mit `parent_detached` und Verlaufseintrag. Unteraufgaben einer Gruppe lassen sich nicht einzeln wiederherstellen (`validation_trash_group_member`). |
| 2026-09-28 | PB-1 | **Aufbewahrung:** `users.trash_retention` (`7`, `30`, `90`, `never`, leer = 30) pro Konto; bei Haushalts-Tickets gilt das Konto des Besitzers. Frist in Berliner Kalendertagen: gelöscht am 1. Oktober mit 30 Tagen geht am 31. Oktober (die Liste zeigt am Löschtag „30“, am Tag der Frist „0“). Cron `byl-trash-purge` täglich 11:45 UTC nach der Bereinigung des Eingangs, dazu beim Start; je Gruppe eine Transaktion, Fehler geloggt, Anzahl im Log, idempotent. |
| 2026-09-28 | PB-1 | **Rückweg der Migration:** Tickets im Papierkorb werden endgültig gelöscht, Unteraufgaben zuerst, über `app.delete` (Kommentare, Verlauf, Lesezeilen gehen mit); ihre verworfenen Quellen werden vorher per `UPDATE` zu Tombstones mit `ticket_deleted` (Semantik vor dem Papierkorb). Das hängt nicht an den Hooks, weil `migrate down` mit und ohne sie laufen kann. Anzahl im Log; Regeln per Entfernen der angehängten Bedingung, Index wie vorher. |
| 2026-09-28 | PB-1 | **Vor dem Neustart** (`trashReady` falsch): Beide Löschwege löschen wie bisher hart und behandeln die Quellen wie in HK-6, die Route antwortet 204, die Routen des Papierkorbs 503 mit dem Neustart-Hinweis, gesendete Felder ignoriert PocketBase. |
| 2026-09-28 | PB-2 | **Navigation:** dezenter Link „Papierkorb“ mit Zahl nach dem Umschalter statt eines fünften Segments (die Arbeitsansichten bleiben unter sich; der Umschalter bricht sonst noch früher um). Die Zahl liest `ViewSwitch` aus dem `TrashStore` des Layouts; ohne ihn (Tests einzelner Komponenten) fehlt sie. |
| 2026-09-28 | PB-2 | **Store:** `TrashStore` im `(app)`-Layout, lädt beim Start und neu bei `byl/trash` und nach dem Neuverbinden (Listen des Papierkorbs sind klein, ein Neuladen ist einfacher als Einzelereignisse). Rückgängig nach einem Einzel-Löschen über `TrashStore.offerUndo` (der `TicketDetailStore` bekommt ihn als `TrashUndo`), nach Sammel-Löschen im `BulkEditStore` (derselbe Eintrag „Rückgängig“ wie nach Feldänderungen, mit `restore` statt `update`). Der Panel-Weg nutzt jetzt immer die Route mit Quellenbehandlung (`inbox` als Standard), damit er die Grundlage für „Rückgängig“ bekommt. |
| 2026-09-28 | PB-2 | **Gemeinsame Leiste:** Das Glas der Sammel-Aktionsleiste zieht in den Baustein `SelectionBar`; `BulkActionBar` und `TrashView` setzen nur ihre Knöpfe hinein (Allowlist: `SelectionBar` statt `BulkActionBar`, ADR-0029 Nachtrag). So nutzt der Papierkorb dieselbe Leiste, wie der Auftrag verlangt, ohne eine elfte Glas-Datei. |
| 2026-09-28 | PB-2 | **Wahl beim Wiederherstellen inline:** `TrashNeedQuestion` unter der Zeile bzw. in der Vorschau (Warnung ohne Rot), kein Dialog (die Vorschau ist ein Panel, und die Wahl gehört zur Zeile). Der Store merkt schon getroffene Wahlen je Ticket, falls nach dem Zielprojekt noch die Serie fragt. |
| 2026-09-28 | PB-2 | **Einstellung unter „Tickets“:** neue Seite „Einstellungen → Tickets“ nach „Tags“ statt unter „Darstellung“, weil die Aufbewahrung am Konto auf dem Server gilt (der Cron braucht sie ohne offenen Tab), „Darstellung“ dagegen nur im Browser. |
| 2026-09-28 | PB-2 | **Hinweis „liegt im Papierkorb“:** `TrashNotice` im Panel bei „nicht gefunden“ und „an anderer Stelle gelöscht“ und im Panel eines Eingangseintrags mit `ticket_deleted.ticket`. Er fragt erst die geladene Liste, dann (für Unteraufgaben einer Gruppe) die Vorschau-Route. Verweise im Verlauf und im Markdown-Text kennen keine Ticket-Links nach Key; dort gibt es nichts umzuleiten. |
| 2026-09-28 | PB-2 | **Texte:** Löschfragen „… in den Papierkorb verschieben?“ mit „In den Papierkorb“ und der Aufbewahrung; „nicht rückgängig“ nur noch beim endgültigen Löschen. `remainingSubtasksText` („bleiben erhalten“) entfällt, weil Unteraufgaben jetzt mitgehen (`subtasksAlongText`). |

## 5. Status

| Paket | Stand |
|---|---|
| PB-1 | gemergt (#151; Migration, Neustart nötig) |
| PB-2 | umgesetzt |

## 6. Offene Punkte und Folgeschritte

- Manuelle Browser-Prüfung (BYL-E6-338).
- Nach einem Wiederherstellen kommen Lesezeilen („neu“) erst mit dem nächsten Laden der Liste zurück; ein zurückgeholtes Ticket kann bis dahin als „neu“ gelten.

- **Projekt-Papierkorb:** Projekte werden weiter sofort gelöscht (nur ohne Tickets und Unterprojekte). Ein Papierkorb für Projekte wäre ein eigener Schritt; Tickets im Papierkorb eines gelöschten Projekts verlangen beim Wiederherstellen schon heute ein Zielprojekt.
- **Plattformen (S0, [ADR-0028](../adr/0028-plattform-strategie.md)):** Die Routen des Papierkorbs sind reine HTTP-JSON-Wege mit der Sitzung; ein nativer Client braucht nur sie und das Thema `byl/trash`.
- **Tags im Papierkorb** halten den Bereich eines Tags fest (§3.2); mit E7 prüfen.
