# ADR-0013: Filter, Suche, Sortierung und Gruppierung: was der Client und was der Server rechnet

- **Status:** Angenommen
- **Datum:** 2026-09-25
- **Entscheidung durch:** Advisor
- **Ergänzt:** [ADR-0006](0006-frontend-zustand-und-datenzugriff.md) (dort §2 „Server-Sortierung wird in E3 je Variante neu bewertet“)

## Kontext

E3 bringt Filter (Status, Priorität, Fälligkeit, Projekt, Tag), Suche, Sortierung per Spaltenkopf und Gruppierung ([ADR-0010](0010-layout-nach-task-board.md), [E3-Plan](../plan/e3.md)). Ausgangslage aus E2:

- Offene Tickets liegen vollständig im `TicketListStore` (eine `SvelteMap`). Die Liste lädt die Beschreibung bewusst nicht (`TICKET_LIST_FIELDS`).
- Erledigte Tickets kommen seitenweise vom Server (50 pro Seite, `-completed_at,-created,-id`), weil ihre Zahl unbegrenzt wächst.
- PocketBase 0.40.4 sortiert nur nach Feldnamen. `priority` sortiert alphabetisch, und ein leeres `due` steht aufsteigend vorn (Befund in ADR-0006).
- Realtime liefert jedes eigene Ticket-Event an die Liste. `upsert` und `reconcile()` entscheiden, wohin ein Datensatz gehört (ADR-0007).
- Filterzustand gehört in die URL (CLAUDE.md §7).

## Entscheidung

### 1. Offene Tickets: alles im Client

- Filter, Sortierung und Gruppierung der offenen Tickets sind reine Funktionen in `web/src/lib/domain/` und werden im Store als `$derived` angewendet: `matchesFilter(ticket, query, today)`, Vergleichsfunktionen je Spalte und `groupTickets(tickets, grouping, today)`.
- Die Map der offenen Tickets bleibt **ungefiltert**. Realtime-Events und der Abgleich nach dem Neuverbinden ändern nur die Map. Welche Zeilen sichtbar sind, ergibt sich daraus neu, ohne eigene Filterlogik in `upsert`.
- Ein Filterwechsel lädt nichts nach. Die Ansicht folgt ohne Wartezeit, und die Kennzahlen-Kacheln zählen aus derselben Map.

Begründung: Die Menge ist schon vollständig geladen (Größenordnung Hunderte). Serverfilter brächten pro Klick eine Anfrage, und Realtime-Events müssten dann gegen den Serverfilter geprüft werden. Die fachliche Sortierung (Priorität nach Rang, leere Fälligkeit immer zuletzt, Standard-Reihenfolge nach „heute“) kann der Server ohnehin nicht.

### 2. Suche: Server liefert IDs

- Die Suche geht auf Titel, Beschreibung und Key: `title ~ {:q} || description ~ {:q} || key ~ {:q}`, immer über `pb.filter()`.
- Für die offenen Tickets holt der Store nur die **IDs** der Treffer (`fields: 'id'`, Filter zusätzlich `status != "done"`) und schneidet sie im Client mit den übrigen Filtern. Die Beschreibung wird so weiterhin nicht in die Liste geladen.
- Die Anfrage startet 250 ms nach dem letzten Tastendruck, ab 2 Zeichen, mit eigenem `AbortController`. Veraltete Antworten werden verworfen.
- Kommt während einer aktiven Suche ein Ticket-Event (create oder update), fragt der Store die ID-Menge erneut ab (entprellt, eine lokale Anfrage). Das ist kein Polling, weil es nur nach Events läuft. Ein `delete` entfernt die ID direkt.
- Grenzen von `~` (SQLite `LIKE`): Groß- und Kleinschreibung werden nur für ASCII-Zeichen gleich behandelt, „Ä“ findet also nicht „ä“. Das wird in der README genannt. Wie PocketBase `%` und `_` in der Eingabe behandelt, prüft Paket 11 des E3-Plans vorab per Harness-Test und hält es dort fest.

### 3. Erledigte Tickets: Filter auf dem Server, feste Reihenfolge

- Der Filter der URL geht als `pb.filter()`-Ausdruck in `listDoneTickets` mit: `doneFilterExpression(query, today)` in `web/src/lib/data/`, gebaut aus derselben `ListQuery` wie `matchesFilter`. Die Suche kommt dort direkt in den Ausdruck.
- Ein **Paritätstest** gegen die Wegwerf-Instanz belegt, dass Ausdruck und `matchesFilter` für eine Matrix von Tickets und Filtern dieselben Datensätze liefern.
- Realtime-Events für erledigte Tickets prüft der Store mit `matchesFilter`. Eine aktive Suche prüft er über die ID-Menge der erledigten Treffer auf den geladenen Seiten. Im Zweifel bringt „Weitere laden“ bzw. der Abgleich den Datensatz.
- Erledigte Tickets bleiben **immer** „zuletzt erledigt zuerst“, auch wenn ein Spaltenkopf sortiert. Das zeigt der Abschnittskopf ausdrücklich an. Sie stehen als eigener Abschnitt „Erledigt“ unter den offenen Tickets und werden nicht gruppiert. Eine fachliche Sortierung über Seitengrenzen hinweg bräuchte ein vom Hook gepflegtes Rangfeld (`priority_rank`), eine Migration und doppelte Daten. Für einen Abschnitt, der vor allem zum Nachschlagen dient, lohnt das nicht (ADR-0006, Alternativen).
- Ist der Statusfilter „Erledigt“ gewählt, zeigt die Tabelle nur diesen Abschnitt, unabhängig vom Schalter „Erledigte anzeigen“. Ist ein anderer Status gewählt, entfällt der Abschnitt, und der Schalter ist mit einem Hinweis gesperrt.

### 4. Zustand in der URL

| Parameter | Werte | Standard (Parameter fehlt) |
|---|---|---|
| `status` | `backlog`, `open`, `in_progress`, `waiting`, `done` | alle nicht erledigten |
| `prio` | `urgent`, `high`, `medium`, `low` | alle |
| `faellig` | `ueberfaellig`, `heute`, `bald` (heute bis heute + 7), `ohne` | alle |
| `projekt` | Record-ID oder `ohne` | alle |
| `tag` | Record-ID | alle |
| `q` | Suchtext (getrimmt, höchstens 200 Zeichen) | keine Suche |
| `sort` | `key`, `prio`, `status`, `titel`, `projekt`, `faellig`, `erstellt`, jeweils optional mit `-` für die Gegenrichtung | Standard-Reihenfolge aus E2 |
| `gruppe` | `status`, `prio`, `projekt`, `faellig` | keine Gruppierung |
| `erledigte` | `1` | aus (seit E2) |

- Ein reines Modul `domain/list-query.ts` liest und schreibt diese Parameter. Ungültige Werte werden ignoriert, als fehlten sie. Eine fremde oder unbekannte Projekt- bzw. Tag-ID ergibt eine leere Trefferliste mit Hinweis und „Filter zurücksetzen“.
- Projekte und Tags stehen per Record-ID in der URL, nicht per Code oder Name (CLAUDE.md §5: URLs referenzieren Record-IDs).
- Chips, Kacheln, Sortierung und Gruppierung erzeugen einen Verlaufseintrag (Zurück funktioniert). Das Tippen im Suchfeld ersetzt den Eintrag (`replaceState`), damit Zurück nicht jeden Buchstaben durchläuft.

### 5. Katalog für Projekte und Tags

- Ein `CatalogStore` im `(app)`-Layout hält alle sichtbaren Projekte (auch archivierte) und Tags, mit eigenem Realtime-Abo auf `projects` und `tags`. Filterleiste, Panel, Projektansicht und Verlauf lesen daraus. Die Nachschlagelisten je geöffnetem Ticket aus E2 (`TicketActivityStore`) entfallen.
- Tabellenzeilen lösen Projekt und Tags über den Katalog auf, `expand` dient nur als Rückfall. So erscheint ein umbenanntes Projekt sofort in allen Zeilen, ohne dass Ticket-Events nötig sind.
- Die Anzahl „gesamt“ je Projekt zählt der Server (`getList(1, 1)` mit `filter` `project = {:id} && status = "done"`, nur `totalItems`) und addiert die offenen Tickets aus dem Store. Geladen wird nur, solange die Projektansicht angezeigt wird, nach Ticket-Events entprellt neu.

## Alternativen

- **Alles auf dem Server (Filter und Sortierung je Anfrage):** Prioritätsrang, „ohne Fälligkeit zuletzt“ und die Standard-Reihenfolge sind mit `sort` nicht ausdrückbar (ADR-0006). Jede Realtime-Änderung müsste gegen den Serverfilter geprüft werden. Verworfen.
- **Beschreibung für die Suche mitladen und im Client suchen:** bis zu 100 000 Zeichen je Ticket in jede Liste und jedes Realtime-Event. Verworfen.
- **Rangfelder (`priority_rank`, `due_sort`) per Hook und Migration**, damit auch erledigte Tickets fachlich sortierbar sind: doppelte Daten, eine Migration und Hook-Code für einen Nachschlage-Abschnitt. Verworfen; neu bewerten, falls der Nutzer die Sortierung erledigter Tickets ausdrücklich braucht.
- **Filterzustand in `localStorage`** wie im Vorbild: widerspricht CLAUDE.md §7, Zurück und Lesezeichen gingen verloren. Verworfen. Eine dauerhafte Voreinstellung für die Ansicht folgt mit „Spalten“ in E6.
- **Filter-Chips mit Mehrfachauswahl:** Das Vorbild wählt einen Wert je Gruppe. Das URL-Schema erlaubt später Listen (`status=open,in_progress`), ohne alte Adressen zu brechen. Vorerst verworfen, siehe offene Produktfrage im E3-Plan.

## Konsequenzen

- Positiv: Filter, Sortierung und Gruppierung der offenen Tickets sind reine, vollständig unit-testbare Funktionen. Realtime braucht für offene Tickets keine Filterlogik.
- Positiv: Adressen mit Filtern lassen sich als Lesezeichen speichern und funktionieren nach Neuladen.
- Negativ: Für erledigte Tickets gibt es zwei Formen desselben Filters (Prädikat und Serverausdruck). Der Paritätstest hält sie gleich.
- Negativ: Erledigte Tickets lassen sich nicht per Spaltenkopf sortieren. Das steht sichtbar im Abschnittskopf.
- Negativ: Die Suche unterscheidet Umlaute nach Groß- und Kleinschreibung (SQLite `LIKE`).

## Nachtrag A (2026-09-28, Plan „Offene Reste“, OR-2): Filter und Gruppe „wiederkehrend“

Nutzerentscheidung vom 2026-09-28. Der Text oben bleibt; dieser Nachtrag ergänzt §3 und §4.

- **Filter „Wiederkehrend“:** Chip-Gruppe nach „Quelle“ mit „Alle“, „Nur wiederkehrende“ und „Nur einmalige“. URL-Parameter `wiederholung` mit den Werten `wiederkehrend` und `einmalig` (Standard: fehlt = alle), in der festen Reihenfolge nach `quelle` und vor `projekt`. Er gehört zu den Filtern, die „Zurücksetzen“ leert, und zum Schlüssel des Abschnitts „Erledigt“.
- **Client und Server:** `matchesFilter` vergleicht `TicketSummary.recurring`; der Serverausdruck der erledigten Tickets bekommt die Bedingungen `({:recurring} != "recurring" || recurrence != "")` und `({:recurring} != "once" || recurrence = "")`. Das Feld `tickets.recurrence` gibt es seit E1, der Ausdruck braucht also keine Weiche für ein älteres Schema. Der Paritätstest (`web-filter-parity.test.mjs`) hat dafür erledigte Instanzen zweier Serien, ein aus der Serie gelöstes Ticket (zählt als einmalig) und einmalige Tickets, allein und mit Priorität, Fälligkeit, Projekt und Suche.
- **Gruppe „Nach Wiederholung“:** `gruppe=wiederholung`, Gruppen „Wiederkehrend“ vor „Einmalig“, leere Gruppen fehlen wie überall.

## Nachtrag B (2026-09-28, Plan „Offene Reste“, OR-3): Gruppieren über zwei Ebenen

Nutzerentscheidung vom 2026-09-28. Der Text oben bleibt; dieser Nachtrag erweitert §1 und §4.

- **Höchstens zwei Ebenen**, etwa Projekt → Status oder Fälligkeit → Priorität. Die zweite Ebene ist optional und nie gleich der ersten. Mehr Ebenen gibt es nicht: Schon zwei Köpfe übereinander kosten in der Tabelle viel Höhe, und eine dritte Einrückung würde die Spalten nach ADR-0030 weiter verschieben.
- **URL:** `untergruppe` mit denselben Werten wie `gruppe`, in der festen Reihenfolge direkt nach `gruppe`. Gelesen und geschrieben wird er nur unter einer ersten Ebene und nur, wenn er von ihr abweicht (`secondLevel`); sonst gilt er als nicht gesetzt. Alte Adressen mit nur `gruppe` bleiben gleich. „Zurücksetzen“ behält beide Ebenen (Ansicht, kein Filter).
- **Rechnen (§1):** `groupTicketLevels` bildet die erste Ebene wie `groupTickets` und teilt jede Gruppe noch einmal nach der zweiten, mit denselben Reihenfolgen und ohne leere Gruppen; die Sortierung gilt in jedem Blatt. Jede Gruppe hat einen Pfad (`status:open`, `project:<id>/status:open`) als Schlüssel für das Zuklappen.
- **Tabelle:** Eine erste Ebene mit zweiter hat einen eigenen `tbody` nur mit ihrem Kopf, jede Gruppe der zweiten Ebene einen eigenen `tbody` (benannt über `aria-labelledby` beider Köpfe, etwa „Haushalt, 3 Tickets Offen, 2 Tickets“). Jeder Gruppenkopf ist ein Disclosure-Knopf mit `aria-expanded`, Bezeichnung und Zahl der offenen Tickets, auch bei einer Ebene. Zugeklappt wird je Tab (`sessionStorage` `byl-groups-collapsed`, höchstens 200 Pfade, standardmäßig offen), wie die Unterprojekte der Projektansicht. Der Abschnitt „Erledigt“ bleibt ungruppiert.
- **Unteraufgaben (ADR-0033 §5):** `arrangeRows` läuft je Blattgruppe. Eingerückt wird nur, wenn übergeordnetes Ticket und Unteraufgabe in derselben Blattgruppe stehen; sonst steht die Unteraufgabe an ihrem Platz mit dem Pfad „HAUS-12 ›“.
- **Spalten (ADR-0030):** Gruppenköpfe beider Ebenen überspannen `fit.visible.length` Spalten; die zweite Ebene ist nur im Kopf eingerückt (2rem), die Spalten und ihre Breiten ändern sich nicht.
