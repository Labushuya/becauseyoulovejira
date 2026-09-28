# E6-Plan, Teil „Bulk, Inline und Ansicht“: Öffnungsmodus, Sammelaktionen, Bearbeiten in Zellen

- **Stand:** umgesetzt (2026-09-28): BI-1 (#148, Öffnungsmodus), BI-2 (#149, Auswahl und Sammelaktionen), BI-3 (Bearbeiten in Zellen). Offen sind die manuellen Browser-Prüfungen (BYL-E6-321, -325, -327).
- **Grundlage:**
  - Arbeitspaket „Bulk & Inline & Ansicht“ (2026-09-28): Öffnungsmodus wie Jira, Auswahlspalte mit Sammelaktionen und Rückgängig, Inline-Bearbeitung in Zellen.
  - [ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) (neu), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) (Overlays, Nachtrag 15), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md) (Hinweise), [ADR-0009](../adr/0009-fehlerfarbe.md) (Rot nur für echte Fehler), [ADR-0029](../adr/0029-glas-materialien.md) (Glas nur in der Bedienebene), [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md) (Spalten), [ADR-0031](../adr/0031-herkunft-sichern.md) Nachtrag B (Löschen mit Quellen), [ADR-0033](../adr/0033-unteraufgaben.md) (Unteraufgaben), [ADR-0021](../adr/0021-regelmodell-wiederkehrende-aufgaben.md) bis [ADR-0024](../adr/0024-serien-aus-kalendern.md) (Wiederholungen)
  - [CLAUDE.md](../../CLAUDE.md) §3, §5, §6, §7, §8, §11, §12
- **Einordnung:** Paketkürzel `BI`, Manifest-Block „Bulk, Inline und Ansicht“ ab `BYL-E6-320` (Offene Reste endet bei 309). ADR-0036; ADR-0037 ist für den Papierkorb reserviert. Eine Migration ist nicht geplant; falls doch, folgt sie auf `1790202200`.

## 1. Querschnittsregeln

- Gearbeitet wird in einem eigenen Git-Worktree außerhalb des Live-Ordners (wie in [Offene Reste](offene-reste.md) §1): Hooks im Ordner `app/` des Hauptordners wirken sofort in der Instanz des Nutzers.
- Keine neue Abhängigkeit, keine neuen Farb- oder Maß-Tokens; Schriftgrößen und Radien nur über Tokens, die Ausnahmelisten schrumpfen nur.
- Nur die bestehenden Bausteine (Popover, Drawer, Modal, Bestätigung, Flags, `SectionMessage`, Switch, Checkboxen). Kein Dialog aus einem Dialog. Was jsdom nicht kann, steht als manueller Fall im Test-Manifest.
- **Gates je Paket:** eigener Branch und PR, `scripts\build.ps1` lokal grün (Exit 0, „Build complete!“), CI grün, Squash-Merge, Branch löschen, danach `main` im Live-Ordner ziehen und dort `build.ps1`.

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| BI-1 | Öffnungsmodus „Seitenpanel“/„Vollansicht“ pro Gerät, „Im Seitenpanel öffnen“ in der Vollansicht, Vollansicht ersetzt das Panel, alle Ticket-Links im gemerkten Modus | BYL-E6-320, BYL-E6-321 (manuell) |
| BI-2 | Auswahlspalte, Sammel-Aktionsleiste (Fälligkeit, Priorität, Status, Projekt, Tags, Erledigen, Löschen) mit Fortschritt, Ergebnis und Rückgängig; „Datum des Termins als Fälligkeit“ beim Umwandeln | BYL-E6-322 bis BYL-E6-324, BYL-E6-325 (manuell) |
| BI-3 | Bearbeiten in Zellen (Priorität, Status, Fälligkeit, Projekt, Tags) über kleine Popover | BYL-E6-326, BYL-E6-327 (manuell) |

## 3. Entscheidungen

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-28 | BI-1 | **Speicher:** `localStorage` `byl-ticket-open`, nur `full`; „Seitenpanel“ entfernt den Schlüssel. Streng gelesen, Fehler des Speichers abgefangen, `storage`-Abgleich anderer Tabs. Nicht in der URL und nicht pro Nutzer (ADR-0036 §1, Alternativen). |
| 2026-09-28 | BI-1 | **Wer merkt:** nur „Vollansicht öffnen“ im Panel und „Im Seitenpanel öffnen“ in der Vollansicht, jeweils ohne Strg/Cmd/Umschalt. Neuladen, Zurück und direkte Adressen ändern nichts. |
| 2026-09-28 | BI-1 | **Unter 64rem** gilt das Verhalten von vorher (Panel als Overlay, Vollansicht schließt zurück ins Panel), und nichts wird gespeichert. Die Grenze ist `PANEL_EMBEDDED_QUERY` (dieselbe wie `ViewWithPanel`), der Store folgt ihr per `matchMedia`. |
| 2026-09-28 | BI-1 | **Nie beide:** Die Route entscheidet. `(tickets)/+layout.svelte` gibt `ViewWithPanel` auf `/voll` kein Panel, `tickets/[id]/+layout.svelte` rendert `TicketPanel` dort nicht. `ViewWithPanel` rendert den Inhalt ohne Panel mit `display: contents` statt `display: none`, weil das Modal der Vollansicht sonst nicht erschiene. |
| 2026-09-28 | BI-1 | **Schließen:** × der Vollansicht führt zur Liste (`listHref`) und fokussiert den Titel-Link der Zeile; ohne Zeile regelt `TicketTable` den Fokus wie beim Schließen des Panels. |
| 2026-09-28 | BI-1 | **Ungespeichertes:** Der Wechsel zwischen Panel und Vollansicht desselben Tickets fragt nicht, weil die Entwürfe in den Stores liegen und das Layout beide Routen teilt (`TICKET_ROUTES`); die bestehende Inline-Frage gilt beim Verlassen des Tickets aus der Vollansicht. Eine Frage beim Moduswechsel wäre ohne Verlust und daher nur Reibung. |
| 2026-09-28 | BI-2 | **Architektur:** clientgesteuerte Einzelaufrufe über die Record-API bzw. die Löschroute, höchstens 4 zugleich, statt eines Bulk-Endpunkts. Die Wächter der Einzelpfade hängen an den Request-Hooks (`onRecordUpdateRequest`: Nutzer im Verlauf, `expected_updated`, `force`/`complete_children`, `recurrence`, `source`) und an der `updateRule`; eine Hook-Route mit `$app.save()` liefe an ihnen vorbei. Teil-Erfolg, Fehler je Ticket und Fortschritt ergeben sich so ohne eigene Mechanik (ADR-0036 §3, Alternativen). |
| 2026-09-28 | BI-2 | **Auswahl:** eigene Pflichtspalte `select` (2,5rem) vorn statt eines Kästchens in der Key-Zelle, damit Auswahl und „erledigt“ an getrennten Orten mit getrennten Namen stehen; die ganze Zelle ist das `label`, die Zeile ignoriert Klicks darin. Umschalt wird beim Drücken des Zeigers bzw. der Taste in der Zelle gemerkt (der Klick über das `label` trägt die Taste nicht verlässlich). Kopf-Checkbox über alle gefilterten Tickets, auch in zugeklappten Gruppen; keine Gruppenkopf-Auswahl (ADR-0036 §2). |
| 2026-09-28 | BI-2 | **Leiste:** eigener Baustein `BulkActionBar` auf Glas (thick, `sticky` über der Tabelle, unter der festen Kopfzeile ab 64rem), zehnte Datei der Glas-Allowlist (ADR-0029 Nachtrag). Priorität und Status als Menüs (sofort), der Rest in Modals S/M bzw. `ConfirmDialog`; kein Dialog aus einem Dialog. |
| 2026-09-28 | BI-2 | **Erledigen:** Unteraufgaben zuerst, dann die übrigen; Frage mit der Checkbox „Unteraufgaben mit erledigen“ (an) nur, wenn ein gewähltes Ticket offene blockierende Unteraufgaben hat, die nicht selbst gewählt sind. Ohne sie lehnt der Hook ab, das Ticket steht mit den Keys im Ergebnis. `force` nur einzeln. |
| 2026-09-28 | BI-2 | **Rückgängig:** je Ticket die geänderten Felder mit den Werten von vorher, mit `expected_updated` (der Hook prüft `updated` für jedes Feld, ADR-0032 §6); nach „Erledigen“ Wiedereröffnen mit dem Status von vorher und die mit erledigten Unteraufgaben. Konflikte einer Serie meldet der Hook (`reopenConflicts`). Kein Rückgängig nach „Löschen“ (Papierkorb). |
| 2026-09-28 | BI-2 | **„Datum der Quelle“:** nur Hauptquellen der Art `event` mit `source_date` (Kalendertermine aus `.ics` und Google Calendar), Berliner Datum des Beginns; eine Anfrage `kind = event && ticket.source_item = id` statt einer je Ticket. Mail, Nachricht, Chat und Link liefern kein Termindatum. „Gesammelt umwandeln“ bekommt die Checkbox „Datum des Termins als Fälligkeit“ (aus); einzeln gibt es seit E4 „Als Fälligkeit übernehmen“. |
| 2026-09-28 | BI-2 | **Zahl der Quellen beim Löschen:** eine Anfrage über alle verknüpften Einträge (nur `ticket`), gezählt im Client, weil die statische Regel der Datenschicht nur Filter aus Konstanten erlaubt und eine Liste von IDs keine Konstante ist. |
| 2026-09-28 | BI-2 | `BulkConvertDialog` zieht auf die Schriftgrößen-Tokens und fällt von der Liste (`no-own-font-sizes.test.ts` jetzt 172). |
| 2026-09-28 | BI-3 | **Zellen:** ein Knopf je Zelle (`EditableCell`), der die Zelle füllt und ein Popover öffnet, statt eines Tabellen-Grids mit Roving-Tabindex: dasselbe Popover wie überall (ADR-0025 §5), Tab erreicht jede Zelle, Enter öffnet, Esc schließt mit Fokus zurück. Priorität, Status und Projekt als Menüs (`menuitemradio`), Fälligkeit als Formular (`DueEditor`), Tags mit dem `TagPicker` des Tickets. Die Zeile ignoriert Klicks auf Knöpfe und in `[popover]`. |
| 2026-09-28 | BI-3 | **Speichern:** `TicketListStore.changeField` über die Record-API wie im Panel; „Erledigt“ über `setDone` (Frage zu Unteraufgaben, „Rückgängig“). Keine optimistische Anzeige: Key, Unteraufgaben und Serie entstehen im Hook und ließen sich nicht sauber zurückrollen; der Server antwortet lokal sofort. Ablehnung als Fehler-Flag mit dem Grund des Feldes. |
| 2026-09-28 | BI-3 | **Leistung:** Die Editoren rendern erst, wenn eine Zelle gezeigt oder fokussiert wird (vor dem Öffnen, damit das Popover mit seiner echten Größe platziert wird), sonst trüge jede Zeile alle Menüs im DOM. |
| 2026-09-28 | BI-1 | **Links:** `ticketLinks()` liefert `href(id, url)` (mit Listen-Query) und `path(id)` (ohne, für Eingang, Wiederholungen, Ergebnisse) im gemerkten Modus; ohne Kontext das Panel. In der Vollansicht bleiben Pfad und Unteraufgaben Links auf Vollansichten; nach „Neues Ticket“ bleibt das neue Ticket im Panel, in dem das Formular stand. |

## 4. Status

| Paket | Stand |
|---|---|
| BI-1 | gemergt (#148) |
| BI-2 | gemergt (#149) |
| BI-3 | umgesetzt |

## 5. Offene Punkte

- Manuelle Browser-Prüfungen (BYL-E6-321, BYL-E6-325, BYL-E6-327).
- Auswahl über Gruppenköpfe ist zurückgestellt (ADR-0036, Alternativen); nachrüstbar, falls der Alltag sie braucht.

## 6. Hinweise für den Papierkorb (ADR-0037)

- **Sammel-Löschen** läuft je Ticket über die Route „Ticket löschen mit Quellenbehandlung“; ein Papierkorb muss dort ansetzen (nicht im Store), damit Einzel- und Sammel-Löschen gleich bleiben. Mit ihm kann „Löschen“ ein „Rückgängig“ im Flag bekommen (heute ausdrücklich keins, der Dialog sagt „nicht rückgängig“).
- **Rückgängig nach Projektwechsel** vergibt einen weiteren Key; ein wiederhergestelltes Ticket behält dagegen seinen Key (Nummernkreise, siehe [Offene Reste](offene-reste.md) §6).
- **`expected_updated`** schützt „Rückgängig“ vor dem Überschreiben; ein Wiederherstellen aus dem Papierkorb sollte denselben Maßstab anlegen (nichts still überschreiben).
