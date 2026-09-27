# ADR-0019: Quelle als Filter, Gruppierung und Merkmal in der Tabelle

- **Status:** Angenommen; §4 eingelöst durch [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md), siehe Nachtrag
- **Datum:** 2026-09-25
- **Entscheidung durch:** Advisor
- **Ergänzt:** [ADR-0010](0010-layout-nach-task-board.md) (Quelle als Chip-Gruppe, Spalte, Gruppierung ab E4), [ADR-0013](0013-filter-suche-sortierung-gruppierung.md) (Client und Server bei Filtern)

## Kontext

Mit E4 trägt jedes neue Ticket seine Quelle (`tickets.source`, [ADR-0014](0014-datenmodell-eingang.md)). ADR-0010 sieht dafür eine Chip-Gruppe in der Filterleiste, eine Spalte und eine Gruppierung vor. Die Hinweise im [E3-Plan](../plan/e3.md) §10 nennen die Stellen im Code: `FILTER_KEYS`, `parseListQuery`/`serializeListQuery`, `matchesFilter`, `DONE_FILTER` (Serverausdruck für erledigte Tickets) mit Paritätstest, `GROUPINGS`, `GROUPING_LABELS`, `groupTickets`, `TICKET_LIST_FIELDS` und das Realtime-Abo.

Es gibt elf Eingangswege (`channel`). Elf Chips wären zu viel, und für den Alltag zählt die Art der Quelle, nicht der technische Weg (eine Mail ist eine Mail, ob als Datei oder aus dem Postfach).

## Entscheidung

### 1. Quellfamilien

| URL-Wert `quelle` | Bezeichnung | `tickets.source` |
|---|---|---|
| `manuell` | Manuell | leer (vor E4 oder direkt angelegt), `manual`, `quick`, `clipboard` |
| `link` | Web-Link | `link` |
| `mail` | Mail | `eml`, `mail` |
| `kalender` | Kalender | `ics`, `calendar` |
| `chat` | Chat | `whatsapp`, `telegram` |
| `notion` | Notion | `notion` (erst, wenn der Kanal umgesetzt ist) |

Die Zuordnung steht einmal im reinen Modul `web/src/lib/domain/source.ts` (`sourceFamily(source)`, Bezeichnungen, Symbole) und gespiegelt in `app/pb_hooks/lib/source.js` für die Werteliste; ein Test gleicht beide ab (Muster wie `web-labels.test.mjs`).

### 2. Filter

- Neue Chip-Gruppe „Quelle“ in der Filterleiste nach „Fällig“, ein Wert je Gruppe wie bisher ([E3-Plan](../plan/e3.md), OF-E3-3). Parameter `quelle` in `ListQuery`, feste Reihenfolge beim Schreiben nach `faellig`.
- Offene Tickets: `matchesFilter` prüft `sourceFamily(ticket.source)`.
- Erledigte Tickets: `doneFilterExpression` erzeugt je Familie einen `pb.filter()`-Ausdruck über die `source`-Werte; für `manuell` einschließlich `source = ""`. Der Paritätstest `web-filter-parity.test.mjs` bekommt Tickets aller Quellen und alle Familien dazu.
- „Zurücksetzen“ leert auch `quelle`. Keine Kennzahlen-Kachel für Quellen.

### 3. Gruppierung

„Nach Quelle“ als fünfte Gruppierung (`gruppe=quelle`), Gruppen in der Reihenfolge der Tabelle oben, leere Gruppen entfallen. Innerhalb der Gruppe gilt die aktuelle Sortierung (T-7 im E3-Plan).

### 4. Merkmal in der Tabelle: Symbol statt eigener Spalte

- Die Titelzelle zeigt vor dem Titel ein kleines Symbol der Quellfamilie (nicht bei „Manuell“), mit `title` und unsichtbarem Text („aus Mail“), wie das Symbol „wiederkehrend“.
- Eine eigene Spalte „Quelle“ kommt erst mit dem Popover „Spalten“ in E6. Die Tabelle hat schon neun Spalten und scrollt neben dem Panel waagerecht (T-4 im E3-Plan); eine zehnte feste Spalte, die bei den meisten Tickets „Manuell“ zeigt, brächte wenig. Das weicht von der Aufzählung in ADR-0010 bewusst ab.
- Sortieren nach Quelle gibt es nicht; die Gruppierung deckt den Bedarf.

### 5. Panel

Das Detail-Panel zeigt unter den Eigenschaften „Quelle: Mail (Web.de)“ mit dem Link „Original ansehen“ auf den Eingangseintrag (`/eingang/<id>`). Der Eintrag zeigt Kopfangaben, Text und, falls vorhanden, „Originaldatei herunterladen“ (geschützte Datei über einen File-Token).

### 6. Eingangsansicht

Der Eingang nutzt dieselben Familien als Chip-Gruppe (Parameter `quelle`) und dazu „Zustand“ (`neu` als Standard, `verworfen`, `umgewandelt`), mit derselben Mechanik aus `list-query.ts`. Einträge sind im Client vollständig geladen, solange es nur die neuen sind; Verworfene und Umgewandelte kommen seitenweise vom Server (Muster der erledigten Tickets, ADR-0013 §3).

## Alternativen

- **Ein Chip je Eingangsweg:** elf Chips, und Mail aus Datei und Postfach wären getrennt. Verworfen.
- **Feste Spalte „Quelle“ schon in E4:** siehe Abschnitt 4. Verworfen bis E6.
- **Familie als eigenes Feld am Ticket speichern:** doppelte Daten; die Zuordnung ist eine reine Funktion. Verworfen.
- **Filter über `source_item.channel` statt über `tickets.source`:** Die offenen Tickets müssten den Eintrag per `expand` laden, und Tickets ohne Eintrag (gelöscht) verlören ihre Quelle. Verworfen.

## Konsequenzen

- `TICKET_LIST_FIELDS` und das Realtime-Abo der Tickets bekommen `source`.
- Alte Adressen ohne `quelle` gelten unverändert. Ein unbekannter Wert wird ignoriert (ADR-0013 §4).
- Die Filterleiste wird eine Chip-Gruppe breiter; auf schmalen Bildschirmen bricht sie wie bisher um.

## Nachtrag (2026-09-27): Spalte „Quelle“ nach ADR-0030

Die in §4 angekündigte Spalte gibt es seit Paket SP-3 ([ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md)). Sie zeigt den Namen der Quellfamilie („Manuell“, „Mail“, „Kalender“ …), ist standardmäßig aus und wird im Menü „Spalten“ eingeschaltet. Wird der Platz knapp, weicht sie als erste. Das Symbol am Titel bleibt.
