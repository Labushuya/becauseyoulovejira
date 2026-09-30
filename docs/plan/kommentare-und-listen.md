# Plan „Kommentare: Reihenfolge, Anpinnen, Einklappen; Listen der Kanal-Karten einklappbar“

- **Stand:** KO-1 umgesetzt (2026-09-30, Branch `feat/comment-pin`, Migration `1790202600_tickets_pinned_comment.js`: **Neustart nötig**, `neu-starten.bat`). KO-2 und KL folgen.
- **Grundlage:** Spec des Nutzers vom 2026-09-30 (freigegeben): Sortierung der Kommentare, höchstens ein angepinnter Kommentar ganz oben, lange Kommentare ein- und ausklappbar; unter Einstellungen → Kanäle → Karte → Details die Stichwort- und Tag-Listen einklappbar. Klarstellung: Anpinnen nur für Kommentare.
- **Entscheidungen:** [ADR-0044](../adr/0044-kommentare-reihenfolge-anpinnen-einklappen.md) (Kommentare) und ein Nachtrag zu [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md) (Listen der Karten, mit KL). Bezüge: [ADR-0006](../adr/0006-frontend-zustand-und-datenzugriff.md), [ADR-0007](../adr/0007-realtime-und-sitzungspflege.md), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) Nachtrag 16, [ADR-0032](../adr/0032-editor-tiptap-markdown.md), [ADR-0037](../adr/0037-papierkorb.md), [ADR-0042](../adr/0042-tickets-und-projekte-aus-listen-waehlen.md) (Normalisierung des Filters).
- **Einordnung:** Manifest-Block „Kommentare und Listen“ ab `BYL-E6-700`.

## 1. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| KO-1 | Pin auf dem Server: Migration mit Rückweg, Hook (nur Kommentare des Tickets, nie beim Anlegen), Verlauf, Lösen beim Löschen des Kommentars, Papierkorb, Datenschicht der SPA | umgesetzt |
| KO-2 | Oberfläche: Umschalter „Neueste zuerst“/„Älteste zuerst“, Eingabefeld oben, Anpinnen/Lösen mit „Rückgängig“, Etikett „Angepinnt“, Einklappen langer Kommentare, Verlaufstexte, Hilfe, README | folgt |
| KL | Baustein für lange Chip-Listen (erste Einträge, „+ N weitere“, Filter ab vielen Einträgen) in den Details der Kanal-Karten; Prüfung weiterer Stellen | folgt |

## 2. KO-1: Pin auf dem Server

### 2.1 Datenmodell und Migration

- `tickets.pinned_comment`: Relation auf `comments`, ein Wert, nicht Pflicht, `cascadeDelete` aus; Index `idx_tickets_pinned_comment` (PocketBase sucht bei jedem gelöschten Kommentar nach Datensätzen, die auf ihn zeigen).
- Additiv: keine Zeile ändert sich, keine Regel ändert sich. Der Rückweg entfernt Index und Feld; nur die Pins gehen verloren, Kommentare und Verlauf bleiben (`migrations-rollback.test.mjs`).

### 2.2 Hooks

| Weg | Verhalten |
|---|---|
| Anlegen eines Tickets (Record-API, Unteraufgabe, Folgeticket einer Serie) | `pinned_comment` muss leer sein, sonst `validation_pinned_comment_create` |
| Ändern (`onRecordUpdate`, in der Transaktion) | neuer Wert: ein Kommentar dieses Tickets (`…_foreign`), kein gelöschter (`…_missing`); leer löst; unveränderter Wert wird nicht geprüft |
| Verlauf | `pinned_comment` in `TRACKED_FIELDS`: angepinnt, ersetzt, gelöst, mit dem Nutzer der Anfrage |
| Löschen eines Kommentars (`comments.pb.js`) | Request-Hook merkt den Nutzer; Modell-Hook löst in einer Transaktion den Pin des Tickets, falls es dieser Kommentar ist, und speichert das Ticket (Verlauf mit dem Nutzer, Realtime); danach löscht PocketBase den Kommentar |
| Papierkorb | Verschieben und Wiederherstellen lassen `pinned_comment` stehen; endgültiges Löschen entfernt Ticket und Kommentare (die Zeile des Tickets geht zuerst, der Kommentar-Hook findet kein Ticket mehr) |
| Vor der Migration | Feld unbekannt: der Server lässt es weg, die Hooks lesen es als leer (`hooks-before-migration.test.mjs`) |

### 2.3 Datenschicht der SPA

- `TICKET_DETAIL_FIELDS` mit `pinned_comment` (auch im Realtime-Abo des Panels); `Ticket.pinnedComment` ist `null` ohne Pin und fehlt, solange der Server das Feld nicht kennt.
- `TicketPatch.pinnedComment` (`null` löst); die Texte der Codes stehen gleich in `domain/comments.ts` und in den Feldtexten von `data/errors.ts` (Paritätstest `tests/unit/web-comments.test.mjs`).

### 2.4 Tests

- Unit: `tests/unit/ticket-rules.test.mjs` (`pinnedCommentViolation`), `tests/unit/history.test.mjs`, `tests/unit/web-comments.test.mjs`, `tests/unit/web-labels.test.mjs`.
- Integration: `tests/integration/ticket-pin.test.mjs` (Anpinnen, Ersetzen, Lösen, fremde und gelöschte Kommentare, Anlegen, Rechte im Haushalt, Löschen des angepinnten Kommentars auch durch den Superuser, Papierkorb mit Wiederherstellen und endgültigem Löschen), `recurrence-generate.test.mjs` (Folgeticket ohne Pin), `web-realtime.test.mjs` (Pin und Lösen in einem zweiten Tab), `migrations-rollback.test.mjs`, `hooks-before-migration.test.mjs`.

## 3. KO-2: Oberfläche der Kommentare

Folgt mit KO-2.

## 4. KL: Listen der Kanal-Karten

Folgt mit KL.
