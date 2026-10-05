# ADR-0066: Ansicht „Erledigte“ und feste Reihenfolge der Kopfnavigation

- **Status:** Angenommen und umgesetzt (Paket ER-1); manuelle Prüfungen im Test-Manifest (BYL-E6-1570 bis BYL-E6-1576)
- **Datum:** 2026-10-05
- **Entscheidung durch:** Nutzer (Reihenfolge der Navigation mit „Papierkorb“ am Ende; eigene Ansicht mit den Gruppen „Heute“, „Gestern“, „Diese Woche“, „Diesen Monat“ und je Monat; Nachladen beim Scrollen und mit „Mehr laden“; Suche und Filter nach Projekt, Tag und Charm mit Anzahl; Aktionen über das normale Zeilenmenü mit „Wieder öffnen“ und „Rückgängig“; Realtime; „Aufgaben“ nur noch offene Arbeit mit dem Link „Erledigte ansehen →“, ohne Status „Erledigt“, mit Weiterleitung alter Adressen; Abschlussdatum), Advisor (Richtschnur für Store, Tests und Manifest), Executor (Umsetzung, Filterausdruck, Nachladen, Weiterleitung, Einzelheiten der Oberfläche)
- **Bezug:** [ADR-0005](0005-zeitzone-europe-berlin.md) (Berliner Tag), [ADR-0006](0006-frontend-zustand-und-datenzugriff.md) §3 (erledigte Tickets seitenweise), [ADR-0010](0010-layout-nach-task-board.md) (Abschnittsleiste), [ADR-0013](0013-filter-suche-sortierung-gruppierung.md) (Nachtrag E; Nachtrag D von PL-1), [ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) (Wiederöffnen von Instanzen), [ADR-0034](0034-unterprojekte.md) (Unterprojekte im Filter), [ADR-0037](0037-papierkorb.md) §9 (Link „Papierkorb“, hier ersetzt), [ADR-0045](0045-ticket-duplizieren.md) (Duplizieren), [ADR-0053](0053-kalenderansicht.md) (der Kalender behält den Status „Erledigt“), [ADR-0054](0054-tickets-im-kontext-oeffnen.md) (Tickets im Kontext), [ADR-0057](0057-kontextabhaengige-oberflaeche.md) (KOB-1), [ADR-0059](0059-bereiche-privat-und-haushalt.md) (Bereiche), [ADR-0060](0060-einheitliche-eingabeelemente.md) (Felder, 44 px), [ADR-0062](0062-charms.md) (Charm), [ADR-0065](0065-tagesplan.md) (Abzeichen „Vorhaben“)

## Kontext

„Aufgaben“ mischte offene und erledigte Arbeit. Der Schalter „Erledigte anzeigen“ (`?erledigte=1`) hängte unter die offenen Tickets einen Abschnitt „Erledigt“ mit 50 Tickets je Seite und „Weitere laden“; der Statusfilter „Erledigt“ zeigte nur diesen Abschnitt, ein anderer Status blendete ihn aus, die Filter-Karten galten auch dort (ADR-0013 §3 und Nachtrag C). Zum Nachschlagen taugte das wenig: keine Gliederung nach Zeit, kein Filter nach Charm, keine Gesamtzahl, als Aktion nur das Häkchen. Die Navigation der Ansichten war mit jedem Paket gewachsen; der Papierkorb stand als leiser Link hinter den Segmenten (ADR-0037 §9).

## Entscheidung

### 1. Kopfnavigation

- **Reihenfolge (Nutzer):** Aufgaben, Tagesplan, Projekte, Eingang, Wiederholungen, Kalender, Erledigte, Papierkorb. Alle acht sind Segmente derselben Spur (`.segmented` aus `base.css`). „Papierkorb“ ist seit ER-1 ein Segment wie die anderen, mit seiner Zahl in gedämpfter Form; das ersetzt den leisen Link von ADR-0037 §9. Die Route `/papierkorb` bleibt.
- **Am Handy** gibt es keine eingeklappte Variante: Die Segmente brechen in derselben Reihenfolge um.
- **Kontext (KOB-1):** Kein Eintrag hängt vom Gerät, vom Konto oder vom Server ab. Dieselbe Reihenfolge gilt, solange der Kontext lädt, für den Verwalter an diesem Rechner, für andere Konten, andere Geräte und Server unter Linux.
- Jede Ansicht behält als aktuelle ihren Zustand („Erledigte“ ihre Filter), sonst führt der Link auf die schlichte Ansicht; in den Einstellungen ist keine aktuell.

### 2. Die Ansicht „Erledigte“ (`/erledigt`)

- **Inhalt:** die erledigten Tickets des aktiven Bereichs (ADR-0059: `areaFilter`, das Abo folgt dem Bereich, ein Wechsel lädt neu), zuletzt erledigte zuerst (`-completed_at,-created,-id`).
- **Gruppen** nach dem Berliner Tag von `completed_at` (ADR-0005, `berlinDateOf`): „Heute“; „Gestern“; „Diese Woche“ ab Montag, ohne heute und gestern; „Diesen Monat“ vor dieser Woche; danach je Monat, etwa „September 2026“. „Gestern“ gewinnt über die Woche, an einem Montag ist es also der Sonntag davor. Eine Woche, die im Vormonat begann, behält ihre Tage; der Rest des Vormonats ist dessen Monatsgruppe. Ein Tag nach heute (nur bei falscher Uhr) zählt als „Heute“. Die Gruppen folgen der Uhr der Liste über Mitternacht. Die Regeln stehen rein in `domain/done-view.ts` (`doneGroupKey`, `groupDone`). Da die Seiten nach `completed_at` sortiert sind, ist jede Gruppe zusammenhängend.
- **Eintrag:** Key und Titel als ein Link, der das Ticket neben der Ansicht öffnet (`DONE_HOST`, `/erledigt/tickets/<id>` bzw. `…/voll` im gemerkten Modus, ADR-0054); davor Farbe und Charm (ADR-0062), danach das Abzeichen „Vorhaben“ (ADR-0065), der Projektpfad und die Zeit (heute und gestern die Uhrzeit, sonst das Datum; für Screenreader „Erledigt: TT.MM.JJJJ HH:MM“) und das Menü „•••“. Jede Gruppe ist ein `section` mit `h3` und Zahl, darin eine Liste. Kein Häkchen, keine Auswahl, keine Bearbeitung in der Zeile: Zum Ändern öffnet man das Ticket.

### 3. Laden, Anzahl und Filter

- **Seiten:** `listCompletedTickets` lädt 50 je Seite; `totalItems` ist die Anzahl neben der Überschrift. „Mehr laden“ (Knopf für Tastatur und Screenreader, daneben „N von M angezeigt“) und ein `IntersectionObserver` auf einer Marke unter der Liste (200 px Vorlauf) laden die nächste Seite, eine zur Zeit; der Beobachter beginnt nach jeder Seite neu, so lädt eine kurze Seite die nächste ebenfalls. Nach der letzten Seite verschwindet der Knopf, und der Fokus geht auf den ersten neuen Eintrag. Eine Live-Region nennt die Zahl nach einem Filterwechsel und „N weitere geladen“.
- **Filter in der Adresse:** `q`, `projekt` (mit `unterprojekte=0`) und `tag` mit Namen und Regeln von „Aufgaben“, dazu `charm` (nur Schlüssel des Katalogs). Die Filterleiste `DoneFilterBar` hat die Suche, die Popover „Projekt“ (mit „Unterprojekte einbeziehen“), „Tag“ und „Charm“ (nach Gruppen des Katalogs) und „Zurücksetzen“. Die Suche gilt nach der Pause wie in „Aufgaben“ (250 ms) und ersetzt beim Tippen den Eintrag im Verlauf.
- **Server und Client:** Der Ausdruck `COMPLETED_FILTER` ist eine Konstante, alle Werte gehen als Parameter an `pb.filter()`; Unterprojekte kommen über `DONE_FAMILY_FILTER` nur hinzu, wenn der Katalog welche kennt. Der Client prüft Projekt, Tag und Charm mit `matchesDoneQuery`; die Suche (Titel, Beschreibung, Key) entscheidet der Server, weil die Liste die Beschreibung nicht lädt. Ein Paritätstest gegen eine Wegwerf-Instanz hält beide gleich, dazu ein Test der Bereiche.

### 4. Aktionen und Realtime

- **Menü „•••“:** dieselbe Komponente `TicketActions` wie jede Ticketzeile („Im Seitenpanel öffnen“, „In Vollansicht öffnen“, „Link kopieren“, „Duplizieren …“ nach ADR-0045, das Verschieben zwischen den Bereichen, „In den Papierkorb …“), dazu „Wieder öffnen“ nur für erledigte Tickets (`onreopen`, an der Stelle von „Zum Tagesplan“, das es für erledigte nicht gibt). „Folge-Ticket anlegen …“ (QT-1, [ADR-0067](0067-tickets-als-quelle.md)) steht wie in den anderen Zeilen nach „Duplizieren …“, mit dem Store des `(app)`-Layouts (`followUps`). Rechtsklick und Umschalt+F10 über `rowMenus`; die Fragen von „Duplizieren …“, „Folge-Ticket anlegen …“ und „In den Papierkorb …“ sind die Dialoge der Zeilen (`TicketRowDialogs`).
- **„Wieder öffnen“** sendet sofort `REOPEN_STATUS`. Der Eintrag verlässt die Liste, das Ticket kommt sofort in die Liste der offenen, und das Flag „KEY wieder offen.“ bietet „Rückgängig“, das es erneut erledigt. Weil der Server `completed_at` setzt und Werte des Clients nie übernimmt (CLAUDE.md §5), steht es danach mit dem Zeitpunkt des „Rückgängig“ unter „Heute“; das ist bewusst so, statt eine Ausnahme in den Hook zu bauen. Lehnt die Serie ab (ADR-0023 Nachtrag 4), nennt das Fehler-Flag den Grund und bietet „Als normales Ticket wieder öffnen (aus der Serie lösen)“.
- **Realtime:** ein eigenes Abo auf `tickets` des Bereichs, solange die Ansicht offen ist. Frisch erledigte Tickets erscheinen oben und zählen mit; wieder geöffnete, gelöschte, in den Papierkorb gelegte und verschobene verschwinden sofort; was die Filter nicht durchlassen, bleibt draußen. Ein erledigtes Ticket jenseits der geladenen Seiten (älter als die letzte geladene Zeile) wartet auf „Mehr laden“; ob es mitzählt, weiß nur der Server, also fragt der Store die Anzahl nach einer Pause einmal nach (`countCompletedTickets`). Mit einer Suche fragt er für das eine Ticket den Server (`completedTicketMatches`, derselbe Ausdruck mit `{:id}`). Nach einer Wiederverbindung gleicht er die geladenen Seiten ohne Ladezustand ab.
- **Store:** `DoneListStore` (`stores/done-list.svelte.ts`) lebt mit dem Layout der Ansicht. Verlässt man sie, bleiben die Flags von „Wieder öffnen“ stehen, damit „Rückgängig“ auch aus einer anderen Ansicht wirkt.

### 5. „Aufgaben“ zeigt nur offene Arbeit

- Der Schalter „Erledigte anzeigen“ und der Abschnitt „Erledigt“ entfallen. Der `TicketListStore` kennt erledigte Tickets nur noch als Unteraufgaben (ADR-0033) und während „Rückgängig“ nach dem Häkchen. An der Stelle des Schalters steht der Link „Erledigte ansehen →“ (der Pfeil ist `aria-hidden`, 44 px am Handy). Er nimmt Projekt, Unterprojekte, Tag und Suche mit; Karten, Status, Priorität, Fälligkeit, Quelle, Wiederkehrend, Sortierung und Gruppe kennt „Erledigte“ nicht.
- Der Statusfilter von „Aufgaben“ hat kein „Erledigt“ mehr. Der Kalender behält es (ADR-0053, Ebene „Erledigte Tickets“).
- **Alte Adressen** (`(tickets)/+layout.ts` mit `legacyDoneHref`, Regeln in `legacyDoneTarget`): `?erledigte=1` ohne Status und `status=done` führen von `/`, `/tickets/<id>` und `/tickets/<id>/voll` an dieselbe Stelle unter `/erledigt`, mit den übertragbaren Filtern; die Weiterleitung läuft im Client vor dem Laden der Liste. `/tickets/neu` bleibt und verliert nur die alten Parameter. `erledigte` neben einem anderen Status (das zeigte nichts Erledigtes) wird nur entfernt. Das gilt auch für die gemerkte letzte Ansicht (`byl-last-view`).
- Die Filter-Karten bleiben für die offenen Tickets; die Klausel `DONE_CARDS_FILTER`, die Quelle im Ausdruck der erledigten Tickets und `listDoneTickets` entfallen (ADR-0013 Nachtrag E). Das parallele Paket PL-1 kam vor ER-1 auf `main` und sperrte die Karten beim Statusfilter „Erledigt“ (ADR-0013 Nachtrag D §2 bis §4). Diesen Statusfilter hat „Aufgaben“ nicht mehr, darum entfernt ER-1 die Sperre (`cardsLocked`, `appliedCards`, `CARDS_LOCKED_HINT`) samt Tests und Manifest-Fall; die angehefteten Tickets in der Zusammenfassung (Nachtrag D §1) bleiben.

### 6. Abschlussdatum

`tickets.completed_at` gibt es seit E1 (Migration `1790200500_create_tickets.js`). Der Modell-Hook setzt es bei jedem Wechsel nach `done`, auch beim Anlegen als erledigt, behält es, solange das Ticket erledigt bleibt, und leert es beim Verlassen (`completedAtAction` in `lib/ticket-rules.js`); Verschieben, Papierkorb und Wiederherstellen behalten es, „Als erledigt markieren“ im Papierkorb setzt es selbst. Kein Weg schreibt den Status an den Hooks vorbei. Darum gibt es **keine Migration und keinen Nachtrag des Bestands**, und der Rückweg-Test bleibt unverändert. Fehlt der Zeitpunkt trotzdem, gruppiert der Client nach `updated`.

## Alternativen

- **Den Abschnitt in „Aufgaben“ behalten und nur gliedern:** mischt offene und erledigte Arbeit; Statusfilter, Karten und Schalter widersprechen sich weiter. Verworfen (Nutzer).
- **Den Abschnitt des `TicketListStore` weiterverwenden:** hinge an der Query von „Aufgaben“ (Status, Karten, Fälligkeit), kennt weder Charm noch Gesamtzahl. Ein eigener Store ist kleiner und klarer.
- **Gruppen auf dem Server:** Berliner Tage ohne Zeitzonendaten der Laufzeit (ADR-0005) und Gruppen über Seitengrenzen sprechen dagegen; die Seiten kommen schon nach `completed_at` sortiert.
- **Nur „Mehr laden“ oder nur endloses Scrollen:** Der Nutzer wollte beides; der Knopf ist der Weg für Tastatur und Screenreader.
- **„Rückgängig“ mit dem alten Abschlusszeitpunkt:** bräuchte eine Ausnahme im Hook, die `completed_at` vom Client übernimmt. Verworfen; der neue Zeitpunkt ist sichtbar und ehrlich.
- **Weiterleitung in einem `$effect` des Layouts:** liefe nach dem ersten Rendern mit falschem Zustand; `load` mit `redirect` leitet vorher um.

## Konsequenzen

- Positiv: „Aufgaben“ ist nur noch offene Arbeit; Erledigtes ist nach Zeit gegliedert, durchsuchbar, filterbar und gezählt; die Aktionen sind die jeder Ticketzeile.
- Positiv: Kein Hook, keine Migration; die Ansicht wirkt nach dem Build ohne Neustart.
- Negativ: Ein zweites Realtime-Abo auf `tickets`, solange die Ansicht offen ist.
- Negativ: „Rückgängig“ von „Wieder öffnen“ setzt einen neuen Abschlusszeitpunkt.
- Negativ: Wird ein Ticket jenseits der geladenen Seiten anderswo wieder geöffnet, stimmt die Anzahl bis zum nächsten Laden um eins nicht; der Fall ist selten, weil Wiederöffnen fast immer frisch Erledigtes betrifft.
