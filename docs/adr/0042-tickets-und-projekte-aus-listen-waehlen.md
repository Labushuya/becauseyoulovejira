# ADR-0042: Tickets und Projekte immer aus einer Liste wählen: ein Auswahl-Baustein für Tickets, Listen für Projekte

- **Status:** Angenommen; §1, §2 und §4 umgesetzt in Paket AL-1 nach [docs/plan/auswahl-listen.md](../plan/auswahl-listen.md), §3 und §5 folgen in AL-2; manuelle Browser-Prüfungen stehen im Test-Manifest
- **Datum:** 2026-09-30
- **Entscheidung durch:** Nutzer (Beobachtung „Selektion von Projekten oder Tickets per reiner manueller Eingabe grauenhaft (was, wenn ich die Ticket-Nummer nicht weiß?) – Einfache Auflistung für User“), Advisor (Anforderungen an den Baustein), Executor (Datenweg, Einzelheiten)
- **Präzisiert:** [ADR-0025](0025-ui-konsistenz-overlay-system.md) §5 (eine weitere Combobox auf `SuggestionList`), [ADR-0031](0031-herkunft-sichern.md) §7 (Ticketsuche beim Verknüpfen), [ADR-0033](0033-unteraufgaben.md) §4 (Auswahl des übergeordneten Tickets), [ADR-0008](0008-markdown-rendering-und-sanitizing.md) (App-Links auf Tickets, AL-2)
- **Bezug:** [ADR-0006](0006-frontend-zustand-und-datenzugriff.md) (Zustand, alle offenen Tickets im Client), [ADR-0007](0007-realtime-und-sitzungspflege.md), [ADR-0009](0009-fehlerfarbe.md), [ADR-0013](0013-filter-suche-sortierung-gruppierung.md), [ADR-0015](0015-neu-markierung-pro-nutzer.md), [ADR-0029](0029-glas-materialien.md), [ADR-0034](0034-unterprojekte.md), [ADR-0037](0037-papierkorb.md)

## Kontext

Drei Stellen verlangten ein Ticket per Eintippen: das übergeordnete Ticket, „Mit Ticket verknüpfen …“ und „Anderem Ticket zuordnen …“. Ihre gemeinsame `TicketCombobox` zeigte ein leeres Feld; eine Liste erschien erst nach Nummer, Key oder Titel, als Treffer einer Serversuche (`searchTickets`, 20 Treffer, nur ASCII ohne Groß-/Kleinschreibung). Wer die Nummer nicht wusste, musste raten. Im Editor ließ sich ein Ticket nur über seine volle Adresse verlinken, in der Schnellerfassung ein Projekt nur über `@CODE`. Alle übrigen Projektwahlen sind schon Listen (`ProjectSelect`, natives `select`, Menüs, Filter-Popover); die Inventur steht im [Plan](../plan/auswahl-listen.md) §1.

## Entscheidung

### 1. Regel

Tickets und Projekte sind überall aus einer sichtbaren Liste wählbar. Tippen bleibt als Filter, ist aber nie Pflicht. Kurzschreibweisen (`@CODE`) bleiben, wenn es daneben einen Auswahlweg gibt. CLAUDE.md §7 nennt die Regel.

### 2. Ein Baustein für Tickets: `TicketPicker`

- **Muster:** WAI-ARIA-APG „combobox with listbox popup“ (`role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`), die Liste in Gruppen (`role="group"` mit Überschrift). Sie liegt als `popover="manual"` im Top-Layer auf dem vorhandenen `SuggestionList` (ADR-0025 §5; Glas wie die übrigen Listen, keine neue Datei der Glas-Allowlist) und öffnet sich unter Feld und Filterchips; deshalb geht sie in Modals, im Seitenpanel, in der Vollansicht und im Link-Popover des Editors. Kein Dialog aus einem Dialog.
- **Ohne Tippen:** Fokus oder Klick öffnet die Liste. Zuerst bis zu 5 Tickets „Zuletzt angesehen oder bearbeitet“, dann die offenen Tickets nach Projekt in Baum-Reihenfolge („Haus › Garten“), dann „Ohne Projekt“, ohne „Nur offene“ zuletzt „Erledigt“. Je Eintrag Key, Titel, Status-Pille, Fälligkeit und der Punkt „neu“ (ADR-0015).
- **Filtern:** über Key und Titel, ohne Groß-/Kleinschreibung, Akzente und Umlautpunkte (NFD ohne Zeichen der Kategorie Mark, ß als ss), mehrere Wörter UND. Chips „Nur offene“ (Standard an) und „Projekt“ (mit Unterprojekten).
- **Menge:** 25 Einträge, dann „Mehr anzeigen“ als letzte Option (Enter oder Klick).
- **Tastatur und Screenreader:** Pfeile, Pos1/Ende, Enter, Esc (erst die Liste, dann der Text, dann das Umfeld), Tab schließt. Die Zahl der Treffer steht sichtbar neben den Chips und nach 0,5 s Pause in einer höflichen Live-Region; ein gesperrter Eintrag sagt beim Enter seinen Grund.
- **Regeln des Ortes** als reine Funktionen (`domain/ticket-picker.ts`): ausblenden (das Ticket selbst) oder sichtbar mit `aria-disabled` und Grund („Nicht wählbar: …“, gedämpft, nicht rot): aktuelles übergeordnetes Ticket, eigene Unteraufgaben (Zyklus), Unteraufgaben (nur eine Ebene, ADR-0033), anderer Bereich (`scope` an Tickets und Einträgen), das Ticket, zu dem ein Eintrag schon gehört. Der Hook bleibt die letzte Instanz. Tickets im Papierkorb erreichen die SPA nie (API-Regeln, ADR-0037 §3).

### 3. Projekte

Wo ein Projekt nur eingetippt werden konnte (Schnellerfassung), steht `ProjectSelect` (Baum-Reihenfolge, Pfad, `title` nach dem [Plan Layout-Überlauf](../plan/layout-ueberlauf.md)); die Wahl schreibt `@CODE` in die Zeile, damit die Zeile die eine Quelle bleibt. Vorhandene Listen bleiben unverändert.

### 4. Datenweg

- **Offene Tickets im Client:** Der `TicketListStore` hält seit E2 alle offenen Tickets samt Unteraufgaben, per Realtime aktuell (ADR-0006, ADR-0007). Der Picker filtert sie im Client (`loadOpen()`, falls noch nicht geladen); normalisierte Texte je Ticket-Objekt einmal (`WeakMap`). Das ist schneller als jede Anfrage, bleibt live und kennt den Stand der übrigen Ansicht. Bei einigen tausend offenen Tickets kostet das Filtern Millisekunden; gerendert werden höchstens so viele Einträge, wie „Mehr anzeigen“ freigegeben hat.
- **Erledigte Tickets vom Server:** Sie wachsen unbegrenzt und sind nicht vollständig geladen. `listDoneTicketChoices` holt sie seitenweise (20, zuletzt geändert zuerst), nur ohne „Nur offene“. Weil SQLite `LIKE` nur ASCII faltet, geht jedes Wort (höchstens 5) als lockeres Muster an den Server: Buchstaben mit Akzentformen als `_`, „ss“ als `%`, `%`, `_` und `\` wörtlich. Das Muster findet eine Obermenge; der Client prüft genau nach. Ein Projekt nimmt seine Unterprojekte wie die Liste über `project.parent` mit (nur wenn der Katalog welche kennt).
- **Zuletzt angesehen:** bis zu 10 Ticket-IDs je Gerät und Nutzer in `localStorage` (`byl-recent-tickets`, Wert `{ user, ids }`), gesetzt beim Öffnen im Panel oder in der Vollansicht; aufgefüllt mit den zuletzt geänderten Tickets (`updated`). Keine Titel, keine Inhalte im Speicher.

### 5. Ticket-Links im Editor (AL-2)

„Link“ im Editor bietet neben „Adresse“ die Auswahl „Ticket“ mit demselben Baustein. Der Link heißt `/tickets/<id>`: unabhängig von Port und Adresse der App, und er öffnet in der App statt in einem neuen Tab (ein neuer Tab zeigte „Die App ist schon offen“). Erlaubt ist genau diese Form (15 Zeichen `[a-z0-9]`) zusätzlich zu http, https und mailto, in der Anzeige (DOMPurify), im Editor und in `checkLink`; Links ohne Schema sonst weiterhin nicht.

## Alternativen

- **Serversuche wie bisher, nur mit leerem Text eine Liste:** Die offenen Tickets liegen schon im Client; eine Anfrage je Tastendruck wäre langsamer, nicht live und bliebe ASCII-gebunden. Verworfen.
- **Normalisierte Suchspalte am Ticket** (Hook schreibt `search_text` ohne Akzente): exakt auf dem Server, aber Migration, Neustart und eine zweite Kopie jedes Titels. Für die erledigten Tickets eines privaten Dashboards genügt das lockere Muster. Zurückgestellt, falls die Menge erledigter Tickets die Seiten spürbar macht.
- **Eigenes Popover mit Chips in der Liste** (Combobox mit Dialog-Popup): Die Chips wären ohne eigenes Tastaturmodell nicht erreichbar, und eine neue Glas-Datei wäre nötig. Verworfen zugunsten der Chips im Fluss unter dem Feld.
- **Natives `select` für Tickets:** keine Gruppenüberschriften mit Status und Fälligkeit, kein Filtern, bei vielen Tickets unbenutzbar. Verworfen.
- **„Zuletzt angesehen“ auf dem Server** (`ticket_reads.seen_at`): Die Zeile entsteht nur für neue Tickets einmal (ADR-0015) und sagt nichts über spätere Besuche; eine neue Collection wäre für eine Vorliebe des Geräts zu schwer. Verworfen.
- **Absolute Ticket-Links** (`http://127.0.0.1:8090/tickets/<id>`): hängen am Port (ADR-0039 §2) und öffnen als externer Link einen zweiten Tab. Verworfen.

## Konsequenzen

- Positiv: Keine Stelle verlangt mehr eine Nummer. Ein Baustein, eine Regelsammlung, derselbe Tastaturweg überall; keine Migration, kein Neustart.
- Die Liste zeigt erledigte Tickets erst ohne „Nur offene“ (vorher fand die Suche sie gleich mit).
- `TicketCombobox`, `searchTickets` und `TicketSourcesStore.search` entfallen.
- Tickets und Einträge tragen in der SPA ihren Bereich (`scope`), für die Regel „gleicher Bereich“ mit Haushalten (E7).
- CLAUDE.md §7 (Regel „Tickets und Projekte immer per Liste wählbar“, Baustein) und die Beschreibungen von Quellen und Übergeordnet sind nachgezogen.
