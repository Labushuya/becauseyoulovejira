# ADR-0067: Tickets als Quelle – Folge-Tickets, Kreis-Regel, Bereich, Verschieben, Duplizieren und Papierkorb

- **Status:** Angenommen und umgesetzt (Paket QT-1); manuelle Prüfungen im Test-Manifest (BYL-E6-1590 bis BYL-E6-1595)
- **Datum:** 2026-10-05
- **Entscheidung durch:** Nutzer (Produktvorgaben: andere Tickets als Quelle, „B stammt aus A“ als Herkunft, getrennt von Abhängigkeit und Unteraufgabe; beide Abschnitte mit Sprung zum anderen Ticket; jedes Ticket als Quelle, offen oder erledigt, mehrere je Ticket; „Folge-Ticket anlegen …“ und „Quelle hinzufügen → Ticket“; Kreise jeder Länge abgelehnt mit dem Pfad, auch bei gleichzeitigen Anfragen; Rauten erlaubt; bestehende Regeln für Bereich, Verschieben, Duplizieren, Papierkorb, Wiederholungen und Verlauf; ein Baum der Herkunftskette später), Advisor (Akzeptanzkriterien, Datenmodell als Richtschnur, Tests), Executor (Routen, Algorithmus, Transaktion, Oberfläche)
- **Bezug:** [ADR-0014](0014-datenmodell-eingang.md) und [ADR-0031](0031-herkunft-sichern.md) (Quellen eines Tickets aus dem Eingang, Nachtrag K), [ADR-0033](0033-unteraufgaben.md) (Unteraufgaben), [ADR-0037](0037-papierkorb.md) (Papierkorb), [ADR-0042](0042-tickets-und-projekte-aus-listen-waehlen.md) (Ticket-Picker), [ADR-0045](0045-ticket-duplizieren.md) (Duplizieren, Nachtrag QT-1), [ADR-0058](0058-haushalt-mitgliedschaft-einladungen-rechte.md) und [ADR-0059](0059-bereiche-privat-und-haushalt.md) (Bereiche, keine Verweise über die Grenze), [ADR-0061](0061-verschieben-zwischen-bereichen-und-aufloesen.md) (Verschieben, Nachtrag QT-1), [ADR-0022](0022-erzeugung-von-instanzen.md) (Erzeugung der Tickets einer Serie), [ADR-0025](0025-ui-konsistenz-overlay-system.md) (Overlays, kein Dialog aus einem Dialog), [ADR-0060](0060-einheitliche-eingabeelemente.md) (`Field`, 44 px am Handy), [ADR-0007](0007-realtime-und-sitzungspflege.md) (Realtime)

## Kontext

Bisher hatte ein Ticket nur Einträge aus dem Eingang als Quelle (Mail, Notion, Dateien …; `inbox_items.ticket`, [ADR-0031](0031-herkunft-sichern.md)). Aus einem Ticket entsteht aber oft ein weiteres: Nach „Heizung prüfen“ (erledigt) kommt „Heizung reparieren“. Diese Herkunft ging bisher nur als Text in der Beschreibung. Der Nutzer will sie als Beziehung zwischen Tickets: „B stammt aus A“.

Die App kennt schon zwei Beziehungen zwischen Tickets, die etwas anderes bedeuten:

| Beziehung | Bedeutung | Folge |
|---|---|---|
| Unteraufgabe (`tickets.parent`, [ADR-0033](0033-unteraufgaben.md)) | B ist ein Teil von A | eine Ebene, gleiches Projekt, blockiert das Erledigen von A |
| Abhängigkeit (`dependencies`, Stufe 2) | B wartet auf A („blockiert“) | Entsperr-Automation erst mit Stufe 2 |
| **Herkunft (neu)** | B stammt aus A | nichts wird blockiert; A kann erledigt sein, B ist eigenständige Arbeit |

## Entscheidung

### 1. Datenmodell (Migration `1790204800_ticket_sources.js`)

Neue Collection **`ticket_sources`**: `ticket` (das Folge-Ticket) und `source` (das Quell-Ticket), beide Relation auf `tickets`, Pflicht, mit Kaskade; `created_by` (Relation `users`, das Konto, das verknüpft hat; leer für Server und Superuser) und `created` (Autodate). Eindeutig je Paar (`idx_ticket_sources_ticket_source`), Index auf `source`. Kein `owner`, `household` oder `scope`: Eine Verknüpfung gehört zu ihren Tickets, und beide liegen immer im selben Bereich (§4).

| Regel | Wert |
|---|---|
| list, view | angemeldet, **beide** Tickets sichtbar (Zweig der Tickets seit 1790203900, je Ticket mit eigenem Alias der Mitgliedschaften `:ticket_member` und `:source_member`) und keines im Papierkorb |
| create, update, delete | `null` |

Geschrieben wird nur über die Routen (§3), damit Kreis-Prüfung, Bereich und Verlauf in einer Transaktion laufen. Die Migration ist additiv; der Rückweg nimmt die Collection mit ihren Verknüpfungen. `storage-rules` zählt die Tabelle zur Gruppe „Tickets“.

### 2. Kreis-Regel

- **Regel:** Keine Verknüpfung darf einen Kreis schließen: kein Selbstbezug (A stammt aus A), kein direkter Rückweg (A → B → A) und keiner über mehrere Stufen (A → B → C → A). Rauten ohne Kreis sind erlaubt (B und C stammen aus A, D aus B und aus C).
- **Algorithmus** (rein, `lib/ticket-source-rules.js` `cyclePath`): Eine neue Verknüpfung „T stammt aus S“ schließt genau dann einen Kreis, wenn S schon (über beliebig viele Stufen) aus T stammt. Eine Breitensuche von S entlang der Quellen jedes Tickets sucht T; jedes Ticket wird einmal besucht, die erste gefundene Kette ist die kürzeste. Ergebnis ist die Kette `[S, …, T]` oder `null`. `reachable` liefert für die Oberfläche alle Nachfahren eines Tickets (alles, was aus ihm stammt); genau diese würden als Quelle einen Kreis schließen (Unit-Test über alle Paare eines Graphen).
- **Meldung:** 400 mit `validation_ticket_source_cycle` am Feld `source`, `params.path` mit den Keys der Kette und dem Text `cycleMessage`: „HAUS-20 stammt bereits von HAUS-3 ab.“ bzw. „HAUS-20 stammt bereits (über HAUS-12) von HAUS-3 ab.“, mehrere Zwischenstufen als „HAUS-12, HAUS-15 und HAUS-17“. Die Oberfläche bildet denselben Text aus `params.path` (`domain/ticket-origins.ts`, Paritätstest). Der Selbstbezug hat `validation_ticket_source_self` („Ein Ticket kann nicht aus sich selbst stammen.“).
- **Transaktion:** Die Prüfung steht im Modell-Hook von `ticket_sources` (für jeden Schreiber, auch den Superuser) und läuft **nach** dem Einfügen in derselben Transaktion (`inTransaction`): Findet sie einen Kreis, rollt der Wurf die Verknüpfung zurück. Die Routen speichern über `txApp.save` in ihrer Transaktion, der Hook nutzt dieselbe.
- **Gleichzeitige Anfragen:** PocketBase führt jede Transaktion auf seiner einen Verbindung zum Schreiben aus. Zwei Anfragen, die zusammen einen Kreis schlössen (A aus B und B aus A), laufen also nacheinander; die zweite sieht die Verknüpfung der ersten und wird abgelehnt. Belegt mit zwölf Paaren gleichzeitig in beide Richtungen (je genau eine Verknüpfung) und einem Dreieck aus drei gleichzeitigen Anfragen (höchstens zwei, nie ein Kreis).
- **Papierkorb zählt mit:** Verknüpfungen zu Tickets im Papierkorb gehen in die Suche ein, denn Wiederherstellen bringt sie zurück (§7).
- **Die Oberfläche filtert vorab** (§9); maßgeblich ist der Server.

### 3. Routen (`ticket-sources.pb.js`, `lib/ticket-source-service.js`)

Alle nur für App-Konten (`requireAuth('users')`) auf jedem Gerät; vor der Migration 503 `{ reason: 'missing' }`.

| Route | Zweck |
|---|---|
| `GET /api/byl/tickets/{id}/ticket-sources` | `{ ticket, sources, follow_ups, descendants }`: Quell-Tickets und direkte Folge-Tickets (je `link`, `id`, `key`, `title`, `status`, `trashed`, `created`, `created_by`, auch im Papierkorb), dazu alle Nachfahren |
| `POST /api/byl/tickets/{id}/ticket-sources` `{ source }` | „Quelle hinzufügen → Ticket“; eine vorhandene Verknüpfung ist kein Fehler (`already`) |
| `POST /api/byl/tickets/{id}/ticket-sources/{source}/remove` | Quelle entfernen (auch eine im Papierkorb); eine fehlende ist kein Fehler |
| `POST /api/byl/tickets/{id}/follow-up` `{ title, tags, charm, description }` | „Folge-Ticket anlegen …“ |

- **Sichtbarkeit:** Das Ticket `{id}` und die neue Quelle müssen für das Konto sichtbar sein (View-Regel der Tickets, also nie im Papierkorb); sonst 404 bzw. `validation_ticket_source_missing` am Feld `source`. Wer ein Ticket sieht, darf seine Quellen ändern: In einem Bereich dürfen alle Mitglieder dieselben Tickets ändern.
- **„Folge-Ticket anlegen …“:** jedes sichtbare Ticket, offen oder erledigt; im Haushalt nur für Mitglieder (sonst 403). In **einer Transaktion** entstehen das neue Ticket über die Hooks der Tickets (Key, Verlauf „hat das Ticket angelegt“ mit dem Konto) und seine Verknüpfung mit dem Verlauf beider Seiten. Das neue Ticket: Titel aus der Anfrage (1–200 Zeichen, sonst `validation_follow_up_title`), Status „Offen“, Art „Aufgabe“, Bereich und Projekt der Quelle (ein archiviertes Projekt nicht, dann ohne Projekt), Tags, Charm und Beschreibung nur mit dem jeweiligen Schalter, sonst nichts (Priorität Standard, keine Fälligkeit, keine Farbe, kein übergeordnetes Ticket, keine Serie). Antwort `{ id, key, title, project, source: { id, key } }`.

### 4. Bereich

Ticket-Quellen nur im selben Bereich ([ADR-0059](0059-bereiche-privat-und-haushalt.md) §4): Der Modell-Hook lehnt eine Verknüpfung über die Grenze für jeden Schreiber mit `validation_scope_mismatch` am Feld `source` ab („Tickets als Quelle gibt es nur im selben Bereich (Privat oder Haushalt).“, `ticket-rules.SCOPE_MESSAGES.source`, gleich in `domain/area.ts`). Ein Ticket im Papierkorb ist nie neue Quelle oder neues Folge-Ticket (`validation_ticket_source_missing`).

### 5. Verschieben ([ADR-0061](0061-verschieben-zwischen-bereichen-und-aufloesen.md), Nachtrag QT-1)

Verknüpfungen zwischen verschobenen Tickets bleiben, wie sie sind (sie haben keinen eigenen Bereich). Eine Verknüpfung zu einem Ticket, das zurückbleibt, ist ein **Konflikt wie eine Abhängigkeit**, mit eigener Wahl `ticket_sources`: „mitnehmen“ (das andere Ticket kommt mit seinen Unteraufgaben mit, wiederholt, bis keine Verknüpfung mehr hinausführt; zusammen mit „mitnehmen“ der Abhängigkeiten schließt sich die Menge über beide) oder „Verknüpfung lösen“. Gelöst wird mit dem Verlauf beider Tickets („Quelle entfernt“, „Folge-Ticket entfernt“); auch mit „mitnehmen“ geht eine Verknüpfung zu einem Ticket im Papierkorb, das nie mitkommt. Die Vorschau nennt `conflicts.ticket_sources` (je `ticket`, `other`, `relation` `source`/`follow_up`, `trashed`), `counts.ticket_sources` (Verknüpfungen zwischen verschobenen Tickets) und `needs.ticket_sources`; ohne Wahl antwortet die Route 400 `ticket-sources-choice`. Auflösen mit „übernehmen“ nimmt alle Tickets mit, also bleiben alle Verknüpfungen; „löschen“ entfernt sie über die Kaskade.

### 6. Duplizieren ([ADR-0045](0045-ticket-duplizieren.md), Nachtrag QT-1)

Die vorhandene Wahl „Kopie der Herkunft übernehmen“ (`source: copy`) umfasst auch Ticket-Quellen: Das Duplikat stammt aus jedem **lebenden** Quell-Ticket des Originals (eines im Papierkorb nicht), in der Transaktion des Duplizierens mit Verlauf. Ohne Hauptquelle, aber mit Ticket-Quellen ist die Wahl möglich; ohne beides bleibt `validation_duplicate_source_missing`. Folge-Tickets des Originals werden nie übernommen. Die Antwort nennt `ticket_sources` (Anzahl).

### 7. Papierkorb ([ADR-0037](0037-papierkorb.md))

Verknüpfungen bleiben, wenn eines ihrer Tickets in den Papierkorb kommt, damit Wiederherstellen sie zurückbringt. Die Record-API verbirgt sie solange (Regel `deleted_at = ""` an beiden Enden); die Route liest sie weiter, und die Gegenseite zeigt das Ticket mit „(im Papierkorb)“ ohne Link. Endgültiges Löschen entfernt sie über die Kaskade der Relation, ohne Eintrag im Verlauf der Gegenseite. Ticket-Quellen blockieren das endgültige Löschen nicht ([ADR-0047](0047-speicher-und-abhaengigkeiten-beim-loeschen.md)).

### 8. Verlauf, Wiederholungen, Realtime

- **Verlauf:** im Folge-Ticket das Feld `ticket_source` („Quelle hinzugefügt: KEY“ als neuer, „Quelle entfernt: KEY“ als alter Wert), im Quell-Ticket `follow_up` („Folge-Ticket: KEY“ bzw. „Folge-Ticket entfernt: KEY“), Wert je JSON `{ ticket, key }` mit dem Key im Moment der Änderung, mit dem Konto. Die Tickets selbst ändern sich nicht (`updated` bleibt).
- **Wiederholungen:** Tickets einer Serie erben keine Ticket-Quellen; `newInstance` legt keine Verknüpfung an (Test über „nach Erledigung“).
- **Realtime:** Der `TicketOriginsStore` hält die Herkunft des offenen Tickets und abonniert nur, solange ein Ticket offen ist: `ticket_sources` mit dem Filter `ticket = X || source = X` (die Regeln liefern nur Verknüpfungen zweier sichtbarer Tickets), die Tickets des Bereichs (eine Änderung eines verknüpften Tickets: Titel, Status, Papierkorb) und die Verbindung; jedes Ereignis lädt die Route still neu.
- **Unberührt:** Tagesplan, Pins und Filter kennen Ticket-Quellen nicht.

### 9. Oberfläche

- **Abschnitt „Quellen“** (`TicketSources`, Panel und Vollansicht): nach den Einträgen des Eingangs die Quell-Tickets mit „Ticket“, Zeitpunkt der Verknüpfung, Key als Link (gemerkter Öffnungsmodus, im aktuellen Bereich), Titel, Status-Pille und dem Symbolknopf „KEY als Quelle entfernen“; im Papierkorb „(im Papierkorb)“ ohne Link. „Quelle hinzufügen“ ist ein Menü (`ActionsMenu` mit Text) mit „Eintrag aus dem Eingang …“ und „Ticket …“; vor der Migration bleibt der Knopf „Quelle hinzufügen …“ wie bisher.
- **„Ticket …“** (`AddTicketSourceDialog`, Modal M, in der Vollansicht eingebettet): der `TicketPicker` mit „Nur offene“ aus (Quellen sind oft erledigt; neue Prop `openOnly`), ohne das Ticket selbst, seine Quellen und jeden Nachfahren (`sourcePickerRules`); Tickets eines anderen Bereichs ausgegraut mit Grund. Ein Kreis, den der Server doch findet (anderer Tab), steht mit dem Pfad am Feld.
- **Abschnitt „Folge-Tickets“** (`TicketFollowUps`) nach „Quellen“: die direkten Folge-Tickets mit Key als Link, Titel und Status, im Papierkorb ohne Link. Er erscheint nur, wenn es Folge-Tickets gibt; angelegt wird über das Menü.
- **„Folge-Ticket anlegen …“** im Menü „•••“ nach „Duplizieren …“: im Kopf von Panel und Vollansicht und in jeder Zeile (Tabelle „Aufgaben“, offene Tickets eines Projekts, Kalender; dasselbe Zeilenmenü nutzt die Ansicht „Erledigte“ von ER-1), auch für erledigte Tickets. `FollowUpDialog` (Modal M, in der Vollansicht eingebettet): Titel „Folge: ‹Titel›“ in `Field`, „Übernehmen“ mit Tags (an), Charm (an) und Beschreibung (aus), ein Hinweis auf Projekt, Bereich und Art; danach öffnet sich das neue Ticket im gemerkten Modus, das Flag nennt den Key und führt zurück zur Quelle.
- **Duplizieren** nennt bei „Kopie der Herkunft übernehmen“ die Quell-Tickets („Das Duplikat stammt wie das Original aus HAUS-3 und HAUS-5.“), **Verschieben** fragt unter „Quell- und Folge-Tickets, die zurückbleiben“ nach „Mitnehmen“ oder „Verknüpfung lösen“.
- Hilfe: Frage „Wie lege ich ein Folge-Ticket an, und wie wird ein Ticket zur Quelle?“.

### 10. Für später: die Herkunftskette als Baum

Nicht umgesetzt (Vorgabe des Nutzers): eine Ansicht der mehrstufigen Herkunft als Baum (Vorfahren und Nachfahren über alle Stufen). Die Route liefert die Nachfahren schon als Liste; ein Baum braucht dazu die Vorfahren und eine eigene Darstellung (Baum-Widget mit Tastatur nach APG „Tree View“). Das ist ein eigenes Paket.

## Alternativen

| Alternative | Bewertung |
|---|---|
| Mehrfach-Relation am Ticket (`tickets.source_tickets`) | Jede Verknüpfung wäre ein Update des Tickets (Verlauf, `updated`, Realtime an alle, „unberührt“ einer Serie); Regeln für beide Seiten, Eindeutigkeit, Kreis-Prüfung und der Papierkorb ließen sich schlecht an ein Feld hängen. Eine eigene Collection hält beides getrennt. |
| Die Abhängigkeiten (`dependencies`) wiederverwenden | Andere Bedeutung („blockiert“) mit späterer Entsperr-Automation; die Herkunft blockiert nie. |
| Ticket-Quellen als Einträge des Eingangs | Ein Eintrag gehört genau einem Ticket ([ADR-0031](0031-herkunft-sichern.md)), ein Quell-Ticket vielen; Kanal, Kopie und Tombstone passen nicht. |
| Schreiben über die Record-API mit Regeln | Die Kreis-Prüfung braucht eine Transaktion und Lesen über viele Zeilen; der Verlauf beider Tickets käme nicht atomar dazu. Eigene Routen wie beim Tagesplan. |
| Kreis-Prüfung vor dem Einfügen | Ohne Einfügen sähe eine gleichzeitige Anfrage den Zustand vor der ersten; nach dem Einfügen in derselben Transaktion und mit der einen Schreibverbindung von PocketBase ist die Reihenfolge eindeutig. |
| Rekursive Abfrage in SQL (CTE) | Ginge in SQLite, liefert aber die Kette für die Meldung nicht so einfach und wäre nicht als reine Funktion testbar. Die Breitensuche fragt je Ticket einmal; Ketten sind kurz. |
| Kreis-Prüfung nur in der Oberfläche | Zwei Tabs oder Mitglieder könnten gleichzeitig einen Kreis schließen; der Server ist maßgeblich. |
| Abschnitt „Folge-Tickets“ immer zeigen | Bei den meisten Tickets leer; „Folge-Ticket anlegen …“ steht im Menü. |
| Verknüpfungen beim Papierkorb lösen | Wiederherstellen brächte sie nicht zurück (Vorgabe des Nutzers). |

## Konsequenzen

- **Neustart nötig** (`neu-starten.bat`): Migration `1790204800`, neue Hooks und Routen, geänderte Dienste (Verschieben, Duplizieren); die Oberfläche nach dem Build und F5. Bis dahin antworten die Routen 503, „Quelle hinzufügen …“ bleibt wie bisher, „Folge-Ticket anlegen …“ nennt den Neustart.
- **Neue Module:** `app/pb_hooks/ticket-sources.pb.js`, `lib/ticket-source-rules.js`, `lib/ticket-source-service.js`; `web/src/lib/domain/ticket-origins.ts`, `data/ticket-origins.ts`, `stores/ticket-origins.svelte.ts`, `stores/ticket-follow-up.svelte.ts`, `components/AddTicketSourceDialog.svelte`, `FollowUpDialog.svelte`, `TicketFollowUps.svelte`.
- **Geändert:** `lib/area-move-service.js` und `-rules.js`, `lib/duplicate-service.js`, `lib/ticket-rules.js`, `lib/storage-rules.js`; in der Oberfläche `TicketSources`, `TicketActions`, `TicketPanel`, `TicketRouteLayout`, `TicketFullViewRoute`, `TicketRowDialogs`, `TicketTable`, `ProjectTicketList`, `CalendarEntry`, `ActionsMenu` (`buttonText`), `TicketPicker` (`openOnly`), `DuplicateDialog`, `AreaMoveDialog` mit Store und Domain, `TicketRowActionsStore`, `history-format`, `data/errors.ts`, `data/realtime.ts`, `(app)`-Layout, Hilfe.
- **Tests:** `tests/unit/ticket-source-rules.test.mjs`, `tests/unit/web-ticket-origins.test.mjs`, `tests/integration/ticket-sources.test.mjs` (eigene Instanz: A und B im Haushalt, C allein), `migrations-rollback.test.mjs`, `hooks-before-migration.test.mjs`; in `web/` Komponenten, Store, Domain, Menüs, Verschieben, Duplizieren, Hilfe. Test-Manifest: BYL-E6-1580 bis BYL-E6-1588, manuell BYL-E6-1590 bis BYL-E6-1595.
