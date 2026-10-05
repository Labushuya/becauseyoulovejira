# ADR-0013: Filter, Suche, Sortierung und Gruppierung: was der Client und was der Server rechnet

- **Status:** Angenommen; §3 seit Nachtrag D (ER-1) für die Ansicht „Erledigte“ ([ADR-0066](0066-ansicht-erledigte.md))
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

## Nachtrag C (2026-10-05, Paket FI-1): Filter-Karten als Umschalter mit Vereinigung

Produktentscheidung vom 2026-10-05 nach einem Fehlerbericht des Nutzers. Der Text oben bleibt; dieser Nachtrag ersetzt die Kennzahlen-Kacheln aus E3 (Plan E3, T-10 und Paket 12; [ADR-0010](0010-layout-nach-task-board.md) §1) und ergänzt §1, §3 und §4.

**Befund vor FI-1.** Die fünf Kacheln schrieben in die Filtergruppen der Filterleiste: „In Arbeit“ `status=in_progress`, „Heute fällig“ `faellig=heute`, „Überfällig“ `faellig=ueberfaellig`, „Dringend“ `prio=urgent`. Die Gruppen sind nach §1 mit UND verknüpft, je Gruppe ein Wert. Daraus folgte:

- „In Arbeit“, „Heute fällig“ und „Dringend“ zusammen zeigten nur Tickets, die alle drei Bedingungen zugleich erfüllen, meist keines.
- „Heute fällig“ und „Überfällig“ teilten sich `faellig` und setzten sich gegenseitig zurück.
- „Nicht erledigt“ war kein Umschalter. Es setzte alle Filter und die Suche zurück und galt als gedrückt, solange gar kein Filter gesetzt war.

**Entscheidung.**

1. **Bedienung:** Fünf gleich bedienbare Umschalter (`aria-pressed`) in der Gruppe „Filter-Karten“: „Alle offenen“, „In Arbeit“, „Heute fällig“, „Überfällig“, „Dringend“. Jede Karte zeigt ein Kästchen, das gewählt ein Häkchen trägt. Dazu kommen Akzentfläche, Rahmen und eine fettere Zahl, kein Rot (ADR-0009). Name „In Arbeit: 3“, die Zeile darunter („Auswählen“, „Abwählen“) hängt per `aria-describedby` daran. Am Handy ist jede Karte mindestens 44 px hoch.
2. **Verknüpfung:** Mehrere gewählte Karten ergeben die Vereinigung (ODER). Jedes Ticket erscheint einmal, und keine Karte setzt eine andere zurück. Die Regeln stehen rein in `web/src/lib/domain/filter-cards.ts` (`matchesCard`, `matchesCards`, `toggleCard`, `countCards`, `cardSummary`). „Heute fällig“ und „Überfällig“ vergleichen wie `dueBucket`, ein erledigtes Ticket ist nie überfällig.
3. **„Alle offenen“** ersetzt „Nicht erledigt“. Es steht für „keine Karte“: gewählt, solange keine andere Karte gewählt ist. Ein Klick darauf hebt die übrigen Karten auf und lässt Filter und Suche stehen.
4. **Filter der Filterleiste** (Status, Priorität, Fällig, Quelle, Wiederkehrend, Projekt, Tag) und die Suche schränken die Vereinigung weiter ein (UND). `matchesFilter` prüft zuerst die Karten, dann die Gruppen wie bisher.
5. **Erledigte Tickets:** Eine Karte für sie gibt es nicht und kommt mit FI-1 auch nicht dazu. „Erledigte anzeigen“ bleibt ein Schalter der Ansicht, „Erledigt“ ein Wert des Statusfilters. Die Karten gelten wie jeder Filter auch für den Abschnitt „Erledigt“. Ein erledigtes Ticket ist nie „In Arbeit“ oder „Überfällig“; mit diesen Karten allein bleibt der Abschnitt leer. Käme später eine Karte für erledigte Tickets, wäre sie ein normales Mitglied der Vereinigung.
6. **Zähler:** Jede Karte zählt die offenen Tickets des aktiven Bereichs, die Filter und Suche passieren, ohne die anderen Karten (`TicketListStore.cardCounts`). Die Zahl der Kopfzeile zählt weiter alle offenen.
7. **Zusammenfassung:** Solange eine Karte gewählt ist, steht über der Tabelle etwa „12 Tickets aus: In Arbeit, Heute fällig, Dringend“. Schränken Filter oder Suche ein, folgt „– weitere Filter aktiv“. Die Zahl ist die neben „Aufgaben“; angeheftete Tickets ([ADR-0064](0064-tickets-anpinnen.md)) stehen unabhängig von den Karten im Abschnitt darüber und zählen dort nicht mit. „Zurücksetzen“ dort wirkt wie „Filter zurücksetzen“: Karten, Filter und Suche fallen weg, der Fokus geht auf „Aufgaben“. Das „Zurücksetzen“ der Filterleiste leert seit FI-1 ebenfalls auch die Karten.
8. **URL (§4):** Neuer Parameter `karte`, einmal je gewählte Karte, mit den Werten `in-arbeit`, `heute`, `ueberfaellig` und `dringend`. Er steht in der festen Reihenfolge vorn, etwa `?karte=heute&karte=dringend&prio=high`. Gelesen werden auch Listen mit Komma; unbekannte, leere und doppelte Werte fallen still weg. Ohne `karte` gilt „Alle offenen“.
9. **Alte Adressen:** Lesezeichen, Verlauf und die gemerkte letzte Ansicht (`sessionStorage` `byl-last-view`) behalten ihre Bedeutung. `status`, `prio` und `faellig` bleiben Filter der Filterleiste und zeigen dieselben Tickets wie vor FI-1, jetzt unter „Alle offenen“. Umgedeutet wird nichts: Aus der Adresse lässt sich nicht erkennen, ob eine Kachel oder ein Chip den Wert gesetzt hat. Eine Umdeutung in Karten würde außerdem den Chip „In Arbeit“ des Statusfilters unwählbar machen. Eine Migration gespeicherter Daten gibt es nicht, der Zustand lebt nur in der Adresse.
10. **Server (§3):** Der Ausdruck der erledigten Tickets bekommt bei gewählten Karten die Klausel `DONE_CARDS_FILTER`. Sie umfasst die Vereinigung als eine Klammer, je Karte geschaltet über einen eigenen Parameter (`{:cardToday} = "1" && due = {:today}` …). Mit UND hängt sie am übrigen Ausdruck. Alle Werte gehen als Parameter über `pb.filter()`. Der Paritätstest prüft alle 16 Kombinationen der Karten, allein und mit Projekt, Tag, Priorität, Fälligkeit, Suche, Quelle und Unterprojekten.
11. **Kalender:** `calendarListQuery` lässt die Karten weg wie „Fällig“ und die Suche, weil der Kalender keine Karten zeigt.

**Alternativen.**

- **Karten weiter als Werte der Filtergruppen, nur mit Mehrfachwahl je Gruppe** (`status=in_progress,open`): Das löst „Heute fällig“ + „Überfällig“, aber nicht „In Arbeit“ + „Dringend“, weil verschiedene Gruppen mit UND verknüpft bleiben. Verworfen.
- **Alte Adressen in Karten umdeuten:** Das ist nicht eindeutig (siehe 9.) und würde Adressen mit zwei solchen Werten von UND auf ODER umstellen. Verworfen.
- **Karten nur für die offenen Tickets, nicht für den Abschnitt „Erledigt“:** Mit „Dringend“ und „Erledigte anzeigen“ stünden dann alle erledigten Tickets darunter, vor FI-1 nur die dringenden. Verworfen.

**Konsequenzen.**

- Positiv: Mehrfachwahl tut, was sie verspricht; die Zahlen auf den Karten sagen vor dem Klick, wie viele Tickets kommen.
- Negativ: Eine Karte kann einem Filter der Filterleiste widersprechen, etwa „In Arbeit“ mit Status „Offen“, und dann ist die Liste leer. Die Zahl 0 auf der Karte, die Zusammenfassung und „Filter zurücksetzen“ machen das sichtbar.
- Negativ: „Alle offenen“ bleibt gewählt, wenn der Statusfilter „Erledigt“ nur erledigte Tickets zeigt; der Name meint „keine Karte“.

## Nachtrag D (2026-10-05, Paket ER-1): Erledigte Tickets in einer eigenen Ansicht

Nutzerentscheidung vom 2026-10-05, ausgeführt in [ADR-0066](0066-ansicht-erledigte.md). Der Text oben bleibt als Geschichte; dieser Nachtrag ersetzt §3 und die Teile von §4 und Nachtrag C, die erledigte Tickets in „Aufgaben“ betreffen.

1. **„Aufgaben“ zeigt nur offene Arbeit.** Der Abschnitt „Erledigt“ und der Schalter „Erledigte anzeigen“ entfallen; der Parameter `erledigte` gehört nicht mehr zur `ListQuery`. An seiner Stelle führt der Link „Erledigte ansehen →“ in die Ansicht `/erledigt` und nimmt `projekt`, `unterprojekte`, `tag` und `q` mit.
2. **Statusfilter:** „Erledigt“ ist kein Wert des Statusfilters von „Aufgaben“ mehr. Der Kalender (ADR-0053) behält ihn, deshalb bleibt `done` ein gültiger Wert der `ListQuery`, die die Filterleiste nur im Kalender anbietet.
3. **Alte Adressen:** Mit `status=done` oder mit `erledigte=1` ohne Status verlangte eine Adresse erledigte Tickets; sie führt seit ER-1 an dieselbe Stelle unter `/erledigt`, mit den Filtern, die beide Ansichten kennen. `erledigte` neben einem anderen Status zeigte nichts Erledigtes und wird nur entfernt. Lesezeichen, Verlauf und die gemerkte letzte Ansicht bleiben so gültig; eine Migration gespeicherter Daten gibt es nicht.
4. **§3 „Erledigte Tickets: Filter auf dem Server“** gilt jetzt für die Ansicht „Erledigte“ mit eigenem Filter (Suche, Projekt mit Unterprojekten, Tag, Charm): `COMPLETED_FILTER` in `data/tickets.ts`, Gegenstück `matchesDoneQuery` in `domain/done-view.ts`, Paritätstest `tests/integration/web-filter-parity.test.mjs`. Die feste Reihenfolge „zuletzt erledigte zuerst“ bleibt; statt Sortierung per Spaltenkopf gliedert die Ansicht nach dem Tag des Abschlusses. `listDoneTickets`, `DONE_FILTER`, `DONE_SOURCE_FILTER` und `DONE_CARDS_FILTER` entfallen.
5. **Nachtrag C §5 und §10:** Die Filter-Karten gelten nur noch für offene Tickets; eine Karte für erledigte Tickets gibt es weiter nicht, denn diese haben ihre eigene Ansicht.
