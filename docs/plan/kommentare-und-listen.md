# Plan „Kommentare: Reihenfolge, Anpinnen, Einklappen; Listen der Kanal-Karten einklappbar“

- **Stand:** KO-1 umgesetzt (2026-09-30, #189, Migration `1790202600_tickets_pinned_comment.js`: **Neustart nötig**, `neu-starten.bat`), KO-2 umgesetzt (2026-09-30, Branch `feat/comment-view`, nur Oberfläche: Build, dann F5; Anpinnen erst nach dem Neustart von KO-1). KL folgt.
- **Grundlage:** Spec des Nutzers vom 2026-09-30 (freigegeben): Sortierung der Kommentare, höchstens ein angepinnter Kommentar ganz oben, lange Kommentare ein- und ausklappbar; unter Einstellungen → Kanäle → Karte → Details die Stichwort- und Tag-Listen einklappbar. Klarstellung: Anpinnen nur für Kommentare.
- **Entscheidungen:** [ADR-0044](../adr/0044-kommentare-reihenfolge-anpinnen-einklappen.md) (Kommentare) und ein Nachtrag zu [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md) (Listen der Karten, mit KL). Bezüge: [ADR-0006](../adr/0006-frontend-zustand-und-datenzugriff.md), [ADR-0007](../adr/0007-realtime-und-sitzungspflege.md), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) Nachtrag 16, [ADR-0032](../adr/0032-editor-tiptap-markdown.md), [ADR-0037](../adr/0037-papierkorb.md), [ADR-0042](../adr/0042-tickets-und-projekte-aus-listen-waehlen.md) (Normalisierung des Filters).
- **Einordnung:** Manifest-Block „Kommentare und Listen“ ab `BYL-E6-700`.

## 1. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| KO-1 | Pin auf dem Server: Migration mit Rückweg, Hook (nur Kommentare des Tickets, nie beim Anlegen), Verlauf, Lösen beim Löschen des Kommentars, Papierkorb, Datenschicht der SPA | umgesetzt |
| KO-2 | Oberfläche: Umschalter „Neueste zuerst“/„Älteste zuerst“, Eingabefeld oben, Anpinnen/Lösen mit „Rückgängig“, Etikett „Angepinnt“, Einklappen langer Kommentare, Verlaufstexte, Hilfe, README | umgesetzt |
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

### 3.1 Aufbau des Reiters „Kommentare“ (Panel und Vollansicht gleich)

1. Umschalter „Neueste zuerst“ | „Älteste zuerst“ (`.segmented`, Gruppe „Reihenfolge der Kommentare“, `aria-pressed`), ab zwei Kommentaren; eine immer vorhandene Statusregion sagt die neue Reihenfolge an.
2. „Kommentar hinzufügen …“ bzw. der Editor (`CommentForm`), in beiden Reihenfolgen oben.
3. Die Liste: zuerst der angepinnte Kommentar (Etikett „Angepinnt“, Linie in der Akzentfarbe links, „Lösen“), dann die übrigen in der gewählten Reihenfolge (`arrangeComments`). Ohne Kommentare der leere Zustand.

### 3.2 Bausteine und Zustand

| Teil | Ort | Aufgabe |
|---|---|---|
| Regeln | `domain/comments.ts` | Reihenfolge (`parseCommentOrder`, `serializeCommentOrder`, `arrangeComments`, Ansage), Grenze des Einklappens (`collapseLimit`: über 14 Zeilen auf 12), gemerkte aufgeklappte Kommentare (`parseExpandedComments`, `withExpanded`, höchstens 200), Texte der Flags (`PIN_FLAGS`), Schnittstelle `CommentPinControl` |
| `CommentViewStore` | `stores/comment-view.svelte.ts`, im `(app)`-Layout | Reihenfolge in `localStorage` `byl-comments-order` (nur `oldest`), andere Tabs über `storage`; aufgeklappte Kommentare in `sessionStorage` `byl-comments-expanded` |
| `TicketDetailStore` | `pinnedComment`, `pinning`, `pinError`, `pin`, `unpin` | ein Pin zur Zeit; beim Ersetzen das Info-Flag „Angepinnter Kommentar ersetzt.“ mit „Rückgängig“; „Rückgängig“ liest das Ticket neu und pinnt den vorherigen nur, wenn noch der neue angepinnt ist (sonst Info-Flag, Fehler als Fehler-Flag mit Grund) |
| `TicketActivityStore` | `lastPostedId` | der zuletzt gesendete Kommentar, damit die Liste ihn bei „Älteste zuerst“ zeigt und fokussiert |
| `CommentList` | Umschalter, Formular, Liste | Reihenfolge und Pin aus den Stores; nach dem Senden bei „Älteste zuerst“ Fokus auf den neuen Kommentar (`article` mit `tabindex="-1"`), sonst wie bisher auf „Kommentar hinzufügen …“ |
| `CommentItem` | Aktionen, Etikett, Fehler | „Anpinnen“ an jedem Kommentar (auch fremden), „Lösen“ am angepinnten; während des Speicherns `aria-busy` am gedrückten, `aria-disabled` an den übrigen Knöpfen; Fehler unter dem Kommentar (`aria-describedby`) |
| `CommentBody` | eingeklappter Text | `ResizeObserver` auf dem inneren Text, `max-height` in Pixeln, `.fade-end` aus `base.css`, „Weiterlesen“/„Weniger anzeigen“ mit `aria-expanded` und `aria-controls`; Fokus im verdeckten Teil klappt auf |
| Verlauf | `history-format.ts`, `HistoryList` | „Kommentar angepinnt“, „Angepinnten Kommentar ersetzt“, „Anpinnen gelöst“, mit Autor und Zeit des Kommentars, solange er geladen ist |

- Kein Dialog: Anpinnen, Ersetzen und Lösen öffnen nichts, auch nicht in der Vollansicht (ADR-0025 Nachtrag 16); die Rückmeldung ist das Flag.
- Vor dem Neustart fehlt `Ticket.pinnedComment`: kein „Anpinnen“, Reihenfolge und Einklappen gehen trotzdem.
- `CommentList.svelte` und `TicketActivity.svelte` nutzen nur noch Schrift-Tokens (Liste von `no-own-font-sizes.test.ts` um zwei Dateien und vier Werte kürzer).

### 3.3 Tests

- `domain/comments.test.ts`, `stores/comment-view.test.ts`, `stores/ticket-detail.test.ts` (Pin, Ersetzen, „Rückgängig“ samt geändertem Pin und Fehler), `domain/history-format.test.ts`.
- `components/comments.test.ts` (Reihenfolge, Feld oben, Fokus nach dem Senden, Pin mit Flag und Lösen, Warten und Fehler, vor dem Neustart, Einklappen mit dem Stub des `ResizeObserver`, angepinnt und beim Bearbeiten), `components/ticket-panel.test.ts` (Anpinnen in der Vollansicht ohne Dialog), Hilfe (`help-page.test.ts`), `styles/base-css.test.ts` (die Maske als einziger Verlauf außer dem Hintergrund).
- Manuell BYL-E6-708: Browser, Tastatur und NVDA.

## 4. KL: Listen der Kanal-Karten

Folgt mit KL.
