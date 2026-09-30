# ADR-0044: Kommentare: Reihenfolge wählbar, ein angepinnter Kommentar je Ticket (`tickets.pinned_comment`), lange Kommentare eingeklappt

- **Status:** Angenommen; KO-1 (Datenmodell und Hooks des Pins, §2) umgesetzt, KO-2 (Oberfläche: §1, §2 „Oberfläche“, §3) folgt nach [docs/plan/kommentare-und-listen.md](../plan/kommentare-und-listen.md)
- **Datum:** 2026-09-30
- **Entscheidung durch:** Nutzer (Wunsch und Spec vom 2026-09-30: Sortierung, höchstens ein angepinnter Kommentar ganz oben, Einklappen langer Kommentare; Anpinnen nur für Kommentare, nicht für Tickets), Advisor (Relation am Ticket, Eingabefeld oben wie in Jira, Grenze etwa 12 Zeilen), Executor (Einzelheiten)
- **Bezug:** [ADR-0006](0006-frontend-zustand-und-datenzugriff.md) (Stores, Sortierung im Client), [ADR-0007](0007-realtime-und-sitzungspflege.md) (Realtime), [ADR-0009](0009-fehlerfarbe.md) (kein Rot), [ADR-0025](0025-ui-konsistenz-overlay-system.md) (Flags §8, kein Dialog aus einem Dialog, Nachtrag 16), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) (Nachtrag KK-1: `aria-busy`), [ADR-0032](0032-editor-tiptap-markdown.md) (Markdown und Editor der Kommentare), [ADR-0037](0037-papierkorb.md) (Papierkorb)

## Kontext

- Kommentare standen seit E2 fest „älteste oben“, das Feld „Kommentar hinzufügen …“ darunter ([E2-Plan](../plan/e2.md), T-11). Bei vielen Kommentaren lag der neueste ganz unten, und das Feld wanderte mit.
- Lange Kommentare (eingefügte Mails, Protokolle, Listen) schoben alles darunter aus dem Blick. Die wichtigste Information eines Tickets stand irgendwo in der Mitte.
- Nutzerwunsch (wörtlich): „Sortierung für Ticket-Kommentare implementieren und der Möglichkeit, gewisse [Kommentare] anzupinnen (diese stehen dann immer ganz oben, max. 1) – Außerdem müssen Ticket Kommentare ab einer gewissen Höhe/Textlänge ein-/ausklappbar / weiterlesend gemacht werden.“ Klarstellung: Anpinnen gilt nur für Kommentare.
- Grenzen: Kommentare sehen und ändern nach den API-Regeln (Sichtbarkeit wie das Ticket, Ändern nur der Autor, CLAUDE.md §5); die Vollansicht ist ein Modal und öffnet keinen Dialog ([ADR-0025](0025-ui-konsistenz-overlay-system.md) Nachtrag 16); Rot nur für echte Fehler.

## Entscheidung

### 1. Reihenfolge

- Über den Kommentaren steht der Umschalter **„Neueste zuerst“ | „Älteste zuerst“** als Segment (`.segmented`, zwei Knöpfe mit `aria-pressed` in einer Gruppe „Reihenfolge der Kommentare“). Standard ist „Neueste zuerst“. Eine Änderung sagt eine höfliche Live-Region an („Neueste Kommentare zuerst.“).
- Gemerkt **pro Gerät** in `localStorage` unter `byl-comments-order`; gespeichert wird nur `oldest`, der Standard entfernt den Schlüssel (wie `byl-ticket-open`). Andere Tabs folgen über das `storage`-Ereignis. Ein Store im `(app)`-Layout (`CommentViewStore`) gilt für Seitenpanel und Vollansicht.
- Sortiert wird im Client ([ADR-0006](0006-frontend-zustand-und-datenzugriff.md) §2): Die Kommentare eines Tickets sind vollständig geladen, Realtime fügt einzelne ein, und die Anordnung ist eine reine Funktion (`arrangeComments` in `domain/comments.ts`). Gleiche Zeitstempel behalten die Reihenfolge des Servers (`created,@rowid`), bei „Neueste zuerst“ umgekehrt. Neue und geänderte Kommentare stehen so sofort an der richtigen Stelle.
- **Das Eingabefeld steht in beiden Reihenfolgen oben**, direkt unter dem Umschalter (Advisor-Empfehlung, wie in Jira): eine feste Stelle, die nicht mit der Zahl der Kommentare wandert und beim Umschalten nicht springt. Nach dem Absenden steht der neue Kommentar
  - bei „Neueste zuerst“ direkt unter dem Feld; der Fokus geht wie bisher auf „Kommentar hinzufügen …“,
  - bei „Älteste zuerst“ am Ende der Liste; die Liste rollt ihn in den sichtbaren Bereich, und der Fokus geht auf ihn (Screenreader: „Kommentar von Du vom …“), damit er nicht außer Sicht entsteht.

### 2. Einen Kommentar anpinnen (höchstens einer je Ticket)

- **Datenmodell:** `tickets.pinned_comment`, eine optionale Relation auf `comments` (ein Wert, `cascadeDelete` aus), mit Index; Migration `1790202600_tickets_pinned_comment.js`. Ein Feld mit einem Wert erzwingt „höchstens einer“ im Datenmodell; einen anderen Kommentar anpinnen ersetzt den bisherigen in einem Schreibvorgang.
- **Rechte:** Anpinnen ist eine Änderung des Tickets und folgt dessen Update-Regel: Wer das Ticket ändern darf, darf jeden seiner Kommentare anpinnen und lösen, auch den eines anderen Mitglieds des Haushalts. Die Regel der Kommentare (ändern nur der Autor) gilt dafür nicht.
- **Hook** (`lib/ticket-service.js`, rein `pinnedCommentViolation` in `lib/ticket-rules.js`, in der Transaktion des Updates): nur ein Kommentar **dieses** Tickets (`validation_pinned_comment_foreign`), kein gelöschter (`validation_pinned_comment_missing`), beim Anlegen nie (`validation_pinned_comment_create`). Damit nehmen weder Unteraufgaben noch Folgetickets einer Serie einen Pin mit. Ein unveränderter Pin wird nicht geprüft, andere Änderungen des Tickets scheitern also nie an ihm. Die Texte stehen gleich in `domain/comments.ts` (Paritätstest).
- **Verlauf:** `pinned_comment` gehört zu den verfolgten Feldern (`lib/history.js`): angepinnt (leer → ID), gelöst (ID → leer), ersetzt (ID → ID), jeweils mit dem Nutzer. Die Oberfläche nennt „Kommentar angepinnt“, „Anpinnen gelöst“ bzw. „Angepinnten Kommentar ersetzt“ und, solange der Kommentar noch da ist, von wem und wann er ist.
- **Löschen des angepinnten Kommentars** hebt das Anpinnen auf: `comments.pb.js` löst den Pin vor dem Löschen in derselben Transaktion, mit dem Nutzer des Löschens (Verlauf „Anpinnen gelöst“), und alle Tabs bekommen das Ticket per Realtime. PocketBase würde die Relation danach selbst leeren, aber ohne jemanden zu nennen; der Hook kommt dem zuvor. Löscht der Superuser in der Verwaltung, nennt der Verlauf niemanden („System“).
- **Papierkorb** ([ADR-0037](0037-papierkorb.md)): Der Papierkorb leert nur Relationen, über die ein Ticket zählen oder stören würde (§1); der angepinnte Kommentar hängt am Ticket selbst und ist mit ihm verborgen. `pinned_comment` bleibt deshalb am Ticket im Papierkorb, das Ticket ist sein eigener Schnappschuss, und kommt beim Wiederherstellen unverändert zurück (kein Verlaufseintrag). Endgültiges Löschen entfernt Ticket, Kommentare und Pin; PocketBase löscht die Zeile des Tickets vor seinen Kommentaren, der Hook findet dann kein Ticket mehr.
- **Oberfläche:** Jeder Kommentar hat „Anpinnen“ in seinen Aktionen, auch ein fremder; eigene zusätzlich „Bearbeiten“ und „Löschen“. Der angepinnte steht **immer ganz oben**, unabhängig von der Reihenfolge, mit dem Etikett „Angepinnt“ (`Lozenge` brand mit Pin-Symbol, nicht rot) und dem Knopf „Lösen“; in der Liste erscheint er nur dort.
  - Ist schon ein anderer angepinnt, ersetzt „Anpinnen“ ihn ohne Rückfrage; danach steht das Info-Flag **„Angepinnter Kommentar ersetzt.“** mit **„Rückgängig“** (8 s, [ADR-0025](0025-ui-konsistenz-overlay-system.md) §8). „Rückgängig“ pinnt den vorherigen wieder an, aber nur, wenn noch der neue angepinnt ist; sonst sagt ein Info-Flag, dass sich der Pin inzwischen geändert hat. Nichts wird still überschrieben. Eine Rückfrage wäre in der Vollansicht ein Dialog im Dialog und bringt gegenüber „Rückgängig“ nichts.
  - Während des Speicherns trägt der gedrückte Knopf `aria-busy`, die übrigen Pin-Knöpfe `aria-disabled` ([ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md), Nachtrag KK-1). Ein Fehler steht am Kommentar.
- **Vor der Migration** (Instanz noch ohne Neustart) kennt der Server das Feld nicht: Er lässt es beim Speichern weg und liefert es nicht aus, die Hooks lesen es als leer, und die SPA bietet kein Anpinnen an (`Ticket.pinnedComment` fehlt).

### 3. Lange Kommentare einklappen

- **Gemessen an der gerenderten Höhe**, nicht an der Zeichenzahl, damit Bilder, Listen, Code und Überschriften zählen: Ein Kommentar, dessen Text höher ist als **14 Zeilen** seiner Schrift, wird auf **12 Zeilen** gekürzt; bis 14 Zeilen bleibt er ganz, weil der Knopf selbst eine Zeile braucht (`COMMENT_COLLAPSE_LINES`, `COMMENT_COLLAPSE_SLACK_LINES`, rein `collapseLimit` in `domain/comments.ts`). Die Zeilenhöhe liest die Komponente aus dem berechneten Stil der Anzeige.
- Gekürzt blendet der Text am Ende weich aus (`mask-image` mit einem Verlauf, keine eigene Farbe), darunter steht **„Weiterlesen“** bzw. **„Weniger anzeigen“** (`.button-subtle`, `aria-expanded`, `aria-controls`, mit Tastatur bedienbar; der Name nennt den Kommentar). Der ganze Text bleibt im DOM, Screenreader lesen ihn vollständig.
- Gilt auch für den angepinnten Kommentar. **Beim Bearbeiten** zeigt der Editor immer den vollen Text.
- **Aufgeklappt bleibt ein Kommentar für die Sitzung** (dieser Tab): `sessionStorage` `byl-comments-expanded`, höchstens 200 IDs (die ältesten gehen zuerst).
- **Keine Sprünge, keine Schleifen:** Ein `ResizeObserver` beobachtet den inneren Text, dessen Höhe nicht vom Kürzen abhängt; das Kürzen ändert nur den äußeren Rahmen. Der erste Befund kommt nach dem Layout und vor dem ersten Zeichnen, lange Kommentare erscheinen also gleich gekürzt; wächst der Inhalt später (Bild, Breite des Panels), entscheidet dieselbe Regel neu. Ohne `ResizeObserver` (jsdom) bleibt alles offen.

## Alternativen

- **`pinned` als Feld am Kommentar mit eindeutigem Teilindex `(ticket) WHERE pinned`:** Die Regel der Kommentare erlaubt Ändern nur dem Autor; Anpinnen fremder Kommentare bräuchte eine eigene Route, und Ersetzen wären zwei Schreibvorgänge. Verworfen zugunsten der Relation am Ticket (Advisor-Empfehlung).
- **Pin nur im Browser (`localStorage`):** nicht serverseitig begrenzt, nicht in anderen Tabs und Geräten, kein Verlauf. Verworfen.
- **Pin in den Schnappschuss des Papierkorbs verschieben und am Ticket leeren:** Nichts zählt oder stört über den Pin; Leeren und Zurücksetzen wären Code ohne Nutzen. Verworfen.
- **Rückfrage vor dem Ersetzen:** siehe §2, verworfen zugunsten von „Rückgängig“.
- **Eingabefeld bei „Älteste zuerst“ unten (wie ein Chat):** zwei Stellen für dasselbe Feld, es springt beim Umschalten und wandert mit jedem Kommentar. Verworfen.
- **Sortierung auf dem Server:** Die Kommentare eines Tickets sind ohnehin vollständig geladen; ein neues Laden je Umschalten wäre langsamer und brächte nichts. Verworfen.
- **Einklappen nach Zeichenzahl oder mit CSS `line-clamp`:** Die Zeichenzahl kennt keine Bilder, Listen und Codeblöcke; `line-clamp` gilt nur für Text in einem Block, nicht für Listen, Überschriften und Code. Verworfen.

## Konsequenzen

- **Neustart nötig** (Migration `1790202600`): bis dahin kein Anpinnen; Reihenfolge und Einklappen wirken nach dem Neuladen der Oberfläche sofort.
- Ein Pin ändert `updated` des Tickets. Eine gleichzeitig gespeicherte Beschreibung mit `expected_updated` sendet der `TicketDetailStore` deshalb einmal erneut ([ADR-0032](0032-editor-tiptap-markdown.md) §6), wie bei jeder anderen Änderung.
- CLAUDE.md §5 (Datenmodell, API-Regeln) und §7 (Kommentare) sowie README und Hilfe beschreiben Reihenfolge, Pin und Einklappen.
