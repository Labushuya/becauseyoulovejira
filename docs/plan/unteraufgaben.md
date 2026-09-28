# E6-Plan, Teil Unteraufgaben: Liste, Fortschritt, Einrücken und „blockiert das übergeordnete Ticket“

- **Stand:** in Arbeit (2026-09-28): UA-0 (#117) und UA-1 (Sperre beim Erledigen im Hook) umgesetzt, UA-2 bis UA-5 geplant.
- **Grundlage:**
  - [ADR-0033](../adr/0033-unteraufgaben.md) (Umfang, Sperre beim Erledigen, Wiederholungen, Oberfläche, Tabelle)
  - [ADR-0012](../adr/0012-plain-ticketing.md) und [ADR-0011](../adr/0011-roadmap-e3-bis-e7.md) mit den Nachträgen vom 2026-09-28
  - [ADR-0021](../adr/0021-regelmodell-wiederkehrende-aufgaben.md) bis [ADR-0023](../adr/0023-lebenszyklus-von-regeln-und-instanzen.md) (Wiederholungen), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) (Overlays, kein Dialog aus einem Dialog), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md) (Hinweis-Bausteine), [ADR-0029](../adr/0029-glas-materialien.md) (Glas, Switch), [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md) (Spalten), [ADR-0031](../adr/0031-herkunft-sichern.md) (Löschen mit Quellen), [ADR-0032](../adr/0032-editor-tiptap-markdown.md) (`expected_updated`)
  - [CLAUDE.md](../../CLAUDE.md) §3, §5, §7, §8, §11, §12
- **Einordnung:** Nutzerentscheidung vom 2026-09-28: Unteraufgaben sind als ausdrückliche Anweisung freigegeben (CLAUDE.md §10). Reihenfolge nach dem [Plan Editor](editor.md): Spalten → Herkunft → Editor Stufe A → **Unteraufgaben** → Editor Stufe B. Die Manifest-IDs laufen ab `BYL-E6-220` (Editor belegt 200 bis 205, Stufe B beginnt bei 206).

## 1. Querschnittsregeln

- **Keine Migration.** `tickets.parent` und `blocks_parent` gibt es seit E1 (Migration `1790200500_create_tickets.js`). Hooks wirken in der laufenden Instanz des Nutzers sofort; ein Hook-Paket wird deshalb nur fertig getestet committet und nie als Experiment im Ordner `app/` liegen gelassen.
- Keine neue Abhängigkeit, keine neuen Farb- oder Maß-Tokens. Schriftgrößen nur über `--font-size-*`, Radien nur über `--radius-*`. Dateien, die ein Paket ohnehin ändert, ziehen von den Ausnahmelisten von `no-own-font-sizes.test.ts` und `no-own-radii.test.ts` auf die Tokens; die Listen schrumpfen nur.
- Nur die bestehenden Bausteine: Drawer, Modal, `ConfirmDialog` mit `options`, Flags, `SectionMessage`, Switch (`role="switch"`), `TicketCombobox`, `ColumnPrefs`, `Breadcrumbs`. Glas nach ADR-0029. **Kein Dialog aus einem Dialog:** Was in der Vollansicht fragt, fragt inline.
- Was jsdom nicht kann (Layout, Einrückung im echten Browser, NVDA), steht als manueller Fall im Test-Manifest.
- **Gates je Paket:**
  - eigener Branch und PR
  - `scripts\build.ps1` lokal komplett grün (Exit-Code 0 und „Build complete!“)
  - CI grün, höchstens drei Versuche; ein roter PR hält die folgenden auf
  - Squash-Merge, Test-Manifest nachgezogen, Entscheidungen in §3

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| UA-0 | ADR-0033, dieser Plan, Nachträge in ADR-0011 und ADR-0012, Manifest-Einträge als „geplant“ | – |
| UA-1 | Hook: Erledigen mit offenen blockierenden Unteraufgaben nur mit `force` bzw. `complete_children` (atomar, mit Verlauf); Tests zu Scope, Wiederholungen (Folgetickets ohne Parent) und Löschen | BYL-E6-220, BYL-E6-221 |
| UA-2 | Datenschicht und Liste (`parent`, `blocks_parent`, übergeordnetes Ticket per `expand`, alle Unteraufgaben im `TicketListStore`); Abschnitt „Unteraufgaben“ in Panel und Vollansicht (Liste, Fortschritt, Häkchen, Hinzufügen inline, live); Pfad im Kind | BYL-E6-222, BYL-E6-223 (manuell) |
| UA-3 | Im Kind: Zeile „Übergeordnet“ mit Festlegen, Ändern (inline mit `TicketCombobox`) und Lösen, Switch „Blockiert das übergeordnete Ticket“; Löschabfrage „N Unteraufgaben bleiben erhalten“; Löschen in der Vollansicht inline | BYL-E6-224, BYL-E6-225 (manuell) |
| UA-4 | Frage beim Erledigen (Häkchen: Bestätigung mit Radios; Status in Panel und Vollansicht: inline), Antwort des Servers, „Rückgängig“ samt mit erledigten Unteraufgaben | BYL-E6-226, BYL-E6-227 (manuell) |
| UA-5 | Tabelle: Chip „2/5“, Spalte „Übergeordnet“, „Unteraufgaben einrücken“ im Menü „Spalten“ mit den Regeln aus ADR-0033 §5; Hilfeseite, README; Abschluss des Plans | BYL-E6-228, BYL-E6-229 (manuell) |

## 3. Entscheidungen

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-28 | UA-0 | ADR-Nummer 0033 (frei nach 0032). Paketkürzel `UA` („Unteraufgaben“), Manifest-Block ab `BYL-E6-220`. |
| 2026-09-28 | UA-0 | **Sperre beim Erledigen im Hook**, nicht nur in der SPA: Ohne `force` bzw. `complete_children` lehnt der Update-Hook den Wechsel nach `done` mit `validation_parent_open_children` ab, wenn offene Unteraufgaben mit `blocks_parent = true` bestehen. „Mit erledigen“ läuft in derselben Transaktion (ADR-0033 §2). |
| 2026-09-28 | UA-0 | **„Mit erledigen“ nur für blockierende Unteraufgaben:** Gezählt und mit erledigt werden dieselben Tickets. Nicht blockierende sind ausdrücklich unabhängig. |
| 2026-09-28 | UA-0 | **Folgetickets haben keinen Parent** (ADR-0033 §3); das ist das heutige Verhalten von `newInstance` und wird per Test festgehalten. |
| 2026-09-28 | UA-0 | **Scope:** Die Regel „Kind im Scope des Parents“ besteht schon (`checkRelations` mit `validation_scope_mismatch`, `validation_ticket_has_children` beim Bereichswechsel) und hat Integrationstests (`ticket-guards.test.mjs`). Nichts zu ergänzen. |
| 2026-09-28 | UA-0 | **Einrücken:** Unteraufgaben folgen ihrem übergeordneten Ticket nur, wenn beide im selben Abschnitt sichtbar sind; sonst stehen sie einzeln mit Pfad-Hinweis. Filter, Suche und Zahlen gelten je Ticket (ADR-0033 §5). |
| 2026-09-28 | UA-0 | **Auswahl des übergeordneten Tickets inline** in Panel und Vollansicht statt im Modal (ADR-0025 §3). |
| 2026-09-28 | UA-0 | **Kurzsyntax `^HAUS-12` zurückgestellt** (§6): Der Key müsste gegen die Tickets aufgelöst werden, und mit `@CODE` wäre offen, welches Projekt gilt. |
| 2026-09-28 | UA-1 | **Ablauf im Update-Hook:** `rememberCompletion` (Request-Hook) merkt sich `force` und `complete_children` als flüchtige Schlüssel (`@force_done`, `@complete_children`, wie `expected_updated`). In der Transaktion prüft `prepareCompletion` nach `prepareUpdate` und vor der Wiederholung; nach `e.next()` und dem Verlauf des Tickets erledigt `completeChildren` die Unteraufgaben per `txApp.save`, sodass deren eigene Hooks laufen (`completed_at`, Verlauf mit dem Urheber aus `@actor`, Folgetermin einer Serie). |
| 2026-09-28 | UA-1 | **Werte der Felder:** `true` oder der Text `"true"` (`isTrueFlag`), alles andere zählt als nicht gesendet. Sendet ein Client beide, gilt `complete_children` (die stärkere Bitte). Die Ablehnung trägt `params` `{ count, keys }` mit höchstens fünf Keys, damit die SPA ohne weitere Anfrage fragen kann. |
| 2026-09-28 | UA-1 | **Texte im reinen Modul:** Die Meldungen der Codes (`validation_parent_*`, `validation_ticket_has_children`, `validation_parent_open_children`) liegen jetzt als `SUBTASK_MESSAGES` in `lib/ticket-rules.js`, mit dem Wortlaut der Oberfläche („übergeordnetes Ticket“, „Unteraufgabe“ statt „Eltern-Ticket“, „Unter-Ticket“), und gleich in `domain/subtasks.ts` (Paritätstest `web-subtasks.test.mjs`). `data/errors.ts` nennt bei `validation_parent_open_children` die Zahl („3 Unteraufgaben sind noch offen.“). |
| 2026-09-28 | UA-1 | **Fehlerinjektion** `__byl_fail_child_done__` (Titel einer Unteraufgabe): Ihr Erledigen scheitert, und der Test belegt, dass übergeordnetes Ticket und übrige Unteraufgaben offen bleiben. |

## 4. Status

| Paket | Stand |
|---|---|
| UA-0 | gemergt (#117) |
| UA-1 | PR offen |
| UA-2 bis UA-5 | geplant |

## 5. Offene Punkte

- Manuelle Browser-Prüfungen der Pakete.
- **CLAUDE.md** nennt Sub-Tickets noch unter Stufe 2 (§5 „Parent (Stufe 2, nur Guard)“, §7 „Icon für blockiert ab Stufe 2“, §10). Die Anpassung ist als Vorschlag für den Nutzer vorbereitet und kommt nach seiner Freigabe.

## 6. Zurückgestellt

- **Kurzsyntax `^KEY` in der Schnellerfassung:** `parseQuickEntry` müsste Keys gegen die offenen Tickets auflösen (wie `@CODE` gegen den Katalog), nur Tickets ohne eigenes übergeordnetes Ticket annehmen und festlegen, dass ohne `@CODE` das Projekt des übergeordneten Tickets gilt. Das passt in ein eigenes kleines Paket.
