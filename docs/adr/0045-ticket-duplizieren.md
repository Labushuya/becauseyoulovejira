# ADR-0045: Ticket duplizieren: Abfrage im Dialog, eine Route in einer Transaktion, Kopie der Herkunft als eigener Eingangseintrag

- **Status:** Angenommen und umgesetzt: Server und Datenschicht in DU-1 (#192), Oberfläche in DU-2 (#193) nach [docs/plan/duplizieren.md](../plan/duplizieren.md); die manuelle Browser-Prüfung steht im Test-Manifest. §1 (Einstieg) geändert durch den Nachtrag „Aktionsmenüs“ (2026-10-01); Nachtrag 2026-10-02: Farbe im Duplikat ([ADR-0052](0052-farben-fuer-projekte-und-tickets.md)); Nachtrag 2026-10-04: Charm im Duplikat ([ADR-0062](0062-charms.md))
- **Datum:** 2026-10-01
- **Entscheidung durch:** Nutzer (Wunsch vom 2026-10-01, wörtlich: „Ich möchte die Möglichkeit haben, jedes Ticket zu duplizieren – nicht zwangsläufig mit Quelle (manuell abfragen wie Duplikat erstellt werden soll).“), Advisor (Einstieg, Felder der Abfrage und ihre Vorbelegung, Pflicht-Status, Quelle mit Fallback, Atomarität, Verlauf, Rechte, Papierkorb), Executor (Machbarkeit der Kopie, Serverweg, Kommentare, Einzelheiten)
- **Ergänzt:** [ADR-0031](0031-herkunft-sichern.md) (Nachtrag F: Kopie der Herkunft), [ADR-0033](0033-unteraufgaben.md) (Nachtrag: Unteraufgaben beim Duplizieren)
- **Bezug:** [ADR-0014](0014-datenmodell-eingang.md) (Fingerprint, Tombstone), [ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 9 (Pflichtauswahl des Status), [ADR-0025](0025-ui-konsistenz-overlay-system.md) Nachtrag 16 (kein Dialog aus einem Dialog), [ADR-0034](0034-unterprojekte.md), [ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §1 (Öffnungsmodus), [ADR-0037](0037-papierkorb.md), [ADR-0042](0042-tickets-und-projekte-aus-listen-waehlen.md) (Projekt aus einer Liste), [ADR-0044](0044-kommentare-reihenfolge-anpinnen-einklappen.md) (angepinnter Kommentar), [ADR-0009](0009-fehlerfarbe.md), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md)

## Kontext

- Die Hauptquelle eines Tickets (`tickets.source_item`) ist unveränderlich, und ein Eingangseintrag gehört höchstens einem Ticket (`inbox_items.ticket`, [ADR-0031](0031-herkunft-sichern.md) §1 und Nachtrag A). Der Nutzer will diese Regeln behalten. Wer eine Aufgabe aus derselben Mail zweimal braucht, soll das Ticket stattdessen duplizieren.
- „Nicht zwangsläufig mit Quelle“: Die App fragt, wie das Duplikat entstehen soll.
- Bisher gab es keinen Weg, ein Ticket zu kopieren. Ein Ticket hängt an vielem: Key im Nummernkreis, Projekt, Tags, Unteraufgaben, Serie, Quellen mit Hauptquelle, Kommentare samt angepinntem Kommentar, Verlauf.

## Entscheidung

### 1. Einstieg

- **„Duplizieren …“** steht im Kopf des Seitenpanels und der Vollansicht, direkt vor „Löschen …“. Ein Aktionsmenü des Tickets gibt es nicht; die Aktionen des Tickets stehen in diesem Kopf. Weil das Panel nur 480 px breit ist und der Kopf schon Pfad, „Löschen …“, „Vollansicht öffnen“ und × trägt, ist der Knopf ein `.button-icon` (zwei überlappende Blätter) mit `aria-label` und `title` „Duplizieren …“ (CLAUDE.md §8: enge Zeilen).
- **Tabelle:** Die Tabelle „Aufgaben“ hat kein Zeilen- oder Kontextmenü, nur Menüs einzelner Zellen (Priorität, Status, Projekt). Ein Zeilenmenü nur für diese Aktion wäre ein neuer Baustein; der Einstieg bleibt deshalb am Ticket. Keine Sammelaktion.

### 2. Abfrage „Wie soll das Duplikat entstehen?“

Im Seitenpanel ein Modal M, in der Vollansicht dasselbe Formular als eingebetteter Bereich oben im Inhalt (`InlineDialog`, automatisch über `insideModal()`, [ADR-0025](0025-ui-konsistenz-overlay-system.md) Nachtrag 16). Der Wächter `reportNestedModal` bleibt grün.

| Feld | Verhalten |
|---|---|
| **Titel** | vorbelegt mit „‹Titel› (Kopie)“, bearbeitbar, höchstens 200 Zeichen; ein langer Titel wird vor dem Zusatz mit „…“ gekürzt. Einen üblichen Zusatz gab es im Projekt nicht; „(Kopie)“ ist der deutsche Standard der Desktop-Programme. |
| **Übernehmen** | Checkboxen mit dem Wert des Originals daneben („Priorität: Hoch“, „Tags: keine“): Beschreibung ✓, Priorität ✓, Projekt ✓ (darunter `ProjectSelect`, vorbelegt mit dem Projekt des Originals; ein archiviertes Projekt ist nicht wählbar, dann „Kein Projekt“ mit Hinweis), Tags ✓, Fälligkeit ✓; nur bei Unteraufgaben „Unter HAUS-12 einordnen“ ✓; nur bei übergeordneten Tickets „Unteraufgaben“ ☐; nur mit Kommentaren „Kommentare“ ☐. Auch leere Werte stehen da, weil dieselbe Auswahl für die Unteraufgaben gilt (§3). |
| **Status des Duplikats** | Pflichtauswahl ohne Vorauswahl wie „Folgetickets starten mit“ ([ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 9, derselbe Baustein): „Offen“ bzw. „Offen (wie das Original)“, „Wie das Original: In Arbeit“, darunter die übrigen nicht erledigten Status. „Erledigt“ gibt es nicht. |
| **Quelle** | nur, wenn das Original Quellen hat: „Keine Quelle“ (Standard) oder „Kopie der Herkunft übernehmen“ (§4). Ohne Hauptquelle ist die zweite Wahl gesperrt und nennt den Grund. |
| **Serie** | Die Wiederholung wird nie mitkopiert. Gehört das Original zu einer Serie, sagt ein Hinweis (`SectionMessage` info): „… Das Duplikat wird ein normales Ticket ohne Wiederholung.“ |

- **Übergeordnetes Ticket** ist eine Ergänzung zur Liste des Advisors: Ohne die Frage hätte die App still entschieden, ob die Kopie einer Unteraufgabe beim selben übergeordneten Ticket bleibt. Vorbelegt ist „ja“ (wie in Jira); dann gilt auch „Blockiert das übergeordnete Ticket“ des Originals.
- „Abbrechen“ und Esc verwerfen ohne Rückfrage, wie in „Wiederholen…“. Ohne Status sendet der Dialog nichts, die Gruppe trägt den Fehler und den Fokus. Fehler des Servers stehen am Feld (Titel, Status, Projekt, Quelle), alles andere als Meldung im Dialog.

### 3. Was das Duplikat bekommt

- **Immer:** neuer Key im Nummernkreis des Zielprojekts bzw. `TASK`, Besitzer ist der handelnde Nutzer, Bereich wie das Original, `source` „manual“ (ohne Quellkopie), keine Serie, kein angepinnter Kommentar beim Anlegen (der Hook erlaubt keinen, [ADR-0044](0044-kommentare-reihenfolge-anpinnen-einklappen.md) §2), `completed_at` leer.
- **Unteraufgaben** (nur bei übergeordneten Tickets): je Unteraufgabe des Originals eine neue, offene Unteraufgabe des Duplikats, auch aus erledigten, in der Reihenfolge ihrer Anlage. Sie bekommen dieselbe Auswahl an Feldern (Beschreibung, Priorität, Tags, Fälligkeit jeweils aus der eigenen Unteraufgabe), ihr eigenes „Blockiert das übergeordnete Ticket“ und das Projekt des Duplikats (wie jede neue Unteraufgabe, [ADR-0033](0033-unteraufgaben.md) §4, [ADR-0034](0034-unterprojekte.md) §6). Eine Ebene bleibt gewahrt: Nur ein Ticket ohne übergeordnetes Ticket hat Unteraufgaben.
- **Kommentare:** Kopien mit dem Hinweis `_Kopiert aus [HAUS-12](/tickets/<id>)._` in der ersten Zeile (Link auf das Original, [ADR-0042](0042-tickets-und-projekte-aus-listen-waehlen.md) §5).
  - **Autor** bleibt der Autor des Originals: Es ist sein Text, der Hinweis sagt, dass es eine Kopie ist, und das Recht zu ändern und zu löschen bleibt bei ihm wie beim Original. Der handelnde Nutzer als Autor würde sich fremde Worte zuschreiben.
  - **Zeitpunkt** (`created`, `updated`) bleibt der des Originals (per `setRaw`): Die Reihenfolge bleibt, „bearbeitet“ stimmt weiter, und die Liste nennt, wann der Text geschrieben wurde.
  - **Angepinnt:** Die Kopie des angepinnten Kommentars wird am Duplikat angepinnt, in derselben Transaktion über die Hooks des Tickets (Verlauf „Kommentar angepinnt“ mit dem Nutzer). Der Pin markiert das Wichtigste; ohne ihn ginge diese Information beim Kopieren verloren.
  - Ein Text an der Grenze des Feldes (20 000 Zeichen) bekommt den Hinweis ohne Link und wird nur, wenn auch das nicht passt, am Ende mit „…“ gekürzt; das Kopieren scheitert nie an der Grenze.

### 4. Quelle: „Kopie der Herkunft übernehmen“ (Variante b)

Machbar und umgesetzt; der Fallback (b′, nur ein Verweis in der Beschreibung) ist nicht nötig. Einzelheiten im Nachtrag F von [ADR-0031](0031-herkunft-sichern.md):

- Ein **neuer, eigener Eingangseintrag** wird die Hauptquelle des Duplikats: Kanal, Art, Titel, Text, Adresse, Referenz, Quelldatum, alle Details (`source_meta`) und die Originaldatei bzw. Seitenkopie ([ADR-0031](0031-herkunft-sichern.md) §6). Die Datei wird im Speicher von PocketBase kopiert (`getReuploadableFile`), nicht in den Arbeitsspeicher gelesen.
- Gekennzeichnet mit `source_meta.copy_of = { item, ticket, key, at }`; Panel des Eintrags und Quellen des Tickets zeigen „Kopie aus HAUS-12“.
- **Eigener, abgeleiteter Fingerprint:** SHA-256 über `copy|<Fingerprint des Originals>|<Zufall>`. Er gleicht nie dem Schlüssel eines Kanals, also blockiert die Kopie keinen späteren Import desselben Objekts und beantwortet ihn nicht: Der trifft weiter den Eintrag des Originals, auch als Tombstone. Jede Kopie ist ein eigener Eintrag, zwei Duplikate haben zwei Kopien.
- **Keine Verbindung** (`connection` leer): Die Kopie kam nicht über eine Verbindung herein; Zählungen je Verbindung (etwa die übernommenen Notion-Quellen) bleiben so, wie sie waren.
- Die Kopie entsteht als `new` und wird vom Ticket-Hook beim Anlegen des Duplikats umgewandelt, wie jede Hauptquelle ([ADR-0014](0014-datenmodell-eingang.md) §2). Löschen, Papierkorb, Verwerfen und Bereinigung behandeln sie wie jede Quelle.

### 5. Serverweg und Atomarität

- **Route** `POST /api/byl/tickets/{id}/duplicate` (nur angemeldete App-Konten) mit `title`, `status`, `project`, `source` (`none` | `copy`) und den Schaltern `description`, `priority`, `tags`, `due`, `parent`, `subtasks`, `comments`. Antwort `{ id, key, title, original: { id, key }, subtasks: [{ id, key }], comments, source }`.
- **Eine Transaktion der Route** (`e.app.runInTransaction`, wie die Routen des Papierkorbs): Quellkopie, Duplikat, Unteraufgaben, Kommentare, Pin und beide Verlaufseinträge gemeinsam oder gar nicht. Jeder Datensatz wird mit `txApp.save` gespeichert, also laufen die Modell-Hooks von `tickets`, `comments` und `inbox_items` darin (ihr eigenes `inTransaction` nutzt dieselbe Transaktion) und vergeben Scope, Key, Prüfungen, die Umwandlung der Quellkopie und „hat das Ticket angelegt“ wie bei jedem neuen Ticket. Der Helfer `inTransaction(e, fn)` passt nicht: Er gilt für Modell-Hooks, deren `fn` `e.next()` aufruft; eine Route hat kein `e.next()`, und `e.app` muss nicht getauscht werden.
- **Alle Prüfungen vor dem ersten Schreiben:** Sichtbarkeit, Anfrage (rein in `lib/duplicate-rules.js`), Recht im Bereich, Hauptquelle und ihre Datei. Realtime-Ereignisse der neuen Datensätze gehen nach dem Commit hinaus, wie bei Speichern über die Record-API.
- **Rechte:** Wer das Original sehen darf (View-Regel, fremd = 404) und im Bereich Tickets anlegen darf. Das Duplikat gehört dem handelnden Nutzer; ein Ticket eines Haushalts nur für Mitglieder, sonst 403 (ein Besitzer, der den Haushalt verlassen hat, sieht sein Ticket noch, darf dort aber nicht anlegen).
- **Papierkorb:** Ein Ticket im Papierkorb ist nicht sichtbar und wird nicht dupliziert (404, auch vor der Migration des Papierkorbs).
- **Ohne Migration:** Nur Hooks; sie wirken nach dem Neustart. Vor den Migrationen des Papierkorbs und des Pins arbeitet die Route ohne diese Felder.

### 6. Verlauf und Ergebnis

- Feld `duplicate` im Verlauf beider Tickets, Wert als JSON `{ direction, ticket, key }`: am Duplikat „Dupliziert aus HAUS-12“, am Original „Dupliziert nach HAUS-13“, jeweils mit dem Nutzer. Das Original selbst ändert sich nicht (`updated` bleibt, ein Folgeticket einer Serie bleibt „unberührt“).
- Danach öffnet sich das Duplikat im gemerkten Öffnungsmodus ([ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §1), und das Flag „HAUS-12 dupliziert.“ mit „Das Duplikat ist HAUS-13.“ bietet „HAUS-12 öffnen“ (zurück zum Original). Ungespeicherte Eingaben am Original fragen wie bei jedem Verlassen.

## Alternativen

- **Nacheinander über die Record-API aus der SPA** (Ticket, dann Unteraufgaben, Kommentare, Quelle): nicht atomar, ein halbes Duplikat wäre möglich; fremde Kommentare könnte der Nutzer nicht mit ihrem Autor anlegen, und eine Quellkopie mit Datei ginge durch den Browser. Verworfen.
- **Body-Feld `duplicate_of` beim Anlegen über die Record-API**, ausgewertet im Ticket-Hook: Der Anlege-Hook würde Kommentare, Unteraufgaben und Eingangseinträge schreiben, die mit dem Anlegen eines Tickets sonst nichts zu tun haben, und jede Prüfung des Anlegens müsste den Sonderfall kennen. Verworfen zugunsten einer eigenen Route.
- **(b′) Nur ein Verweis auf die Herkunft des Originals** in der Beschreibung: bleibt ohne eigene Quelle, Datei und Kopie-Status. Nicht nötig, weil (b) sauber geht.
- **Dieselbe Quelle an beiden Tickets** (n:m): widerspricht [ADR-0031](0031-herkunft-sichern.md) §1 und dem Wunsch des Nutzers, die Regeln zu behalten. Verworfen.
- **Fingerprint der Kopie gleich dem des Originals:** unmöglich (`UNIQUE (scope, fingerprint)`) und würde die Duplikatsuche doppeln. **Fingerprint wie ein manueller Eintrag** (nur Zufall): ginge, verliert aber den Bezug; die Ableitung zeigt, woher die Kopie stammt, ohne je einen Kanal zu treffen.
- **Kommentare mit dem handelnden Nutzer als Autor und der Zeit des Kopierens:** schreibt fremde Texte dem Nutzer zu, und alle Kopien trügen fast dieselbe Zeit. Verworfen, siehe §3.
- **„Duplizieren …“ in einem neuen Menü „•••“ im Kopf:** würde „Löschen …“ verlegen und einen Klick mehr kosten. Ein Symbolknopf passt in den Kopf. Verworfen.

## Konsequenzen

- Neue Module `lib/duplicate-rules.js` (rein) und `lib/duplicate-service.js`, die Route in `tickets.pb.js`, `copyFingerprintKey` in `lib/inbox-fingerprint.js` und `copySource` in `lib/inbox-service.js`. Keine Migration; **Neustart nötig** für die Hooks (`neu-starten.bat`), die Oberfläche nach F5.
- Texte der Codes gleich in `web/src/lib/domain/duplicate.ts` (Paritätstest).
- CLAUDE.md §5 und §7, README und Hilfe beschreiben das Duplizieren.

## Nachtrag (2026-10-01, Plan „Aktionsmenüs“, AM-1 und AM-2): Einstieg über das Menü „•••“

**Anlass:** Nutzerentscheidung vom 2026-10-01: ein Aktionsmenü „•••“, „beides, aber vorrangig für das Ticket selbst“ ([Plan](../plan/aktionsmenues.md)). Damit entfällt der Grund, aus dem §1 und die Alternative „‚Duplizieren …‘ in einem neuen Menü ‚•••‘ im Kopf“ das Menü verworfen hatten: Es ist jetzt der Ort aller Aktionen eines Tickets, nicht ein Menü nur für diese eine.

**Entscheidung** (ersetzt in §1 den ersten Punkt; §2 bis §6 bleiben):

- **„Duplizieren …“** steht im Menü „•••“ („Weitere Aktionen“) im Kopf von Panel und Vollansicht, zwischen „Link kopieren“ und „In den Papierkorb …“, nur mit dem `TicketDuplicateStore` des `(app)`-Layouts. Der Symbolknopf mit den zwei Blättern (`TicketDuplicate`) entfällt; als Symbole bleiben im Kopf nur „Vollansicht“ bzw. „Im Seitenpanel öffnen“ und ×.
- **Abfrage unverändert:** im Panel das Modal M, in der Vollansicht derselbe Inhalt eingebettet oben im Inhalt (`InlineDialog`, ADR-0025 Nachtrag 16); „Duplizieren …“ und „In den Papierkorb …“ schließen einander. Der Fokus liegt nach der Wahl im Menü auf „•••“, also kehrt er nach „Abbrechen“ und Esc dorthin zurück. Der Eintrag meldet im Panel `aria-haspopup="dialog"`, in der Vollansicht nichts, weil er dort keinen Dialog öffnet.
- **Tabelle (seit AM-2, ersetzt den zweiten Punkt von §1):** „Duplizieren …“ steht auch im Menü „•••“ jeder Zeile der Tabelle „Aufgaben“. Die Tabelle ist kein Modal, also ist die Abfrage dort das Modal M des Panels. Weil eine Zeile nur die Zusammenfassung ihres Tickets kennt, lädt der `TicketRowActionsStore` vorher Ticket, Quellen und Zahl der Kommentare (Fehler als Flag); danach gilt §2 bis §6 unverändert. Weiter keine Sammelaktion.
- **Tests:** `ticket-actions.test.ts` (Menü), `ticket-panel.test.ts` (Panel und Vollansicht), `ticket-duplicate.test.ts` (Abfrage), `ticket-table-row-menu.test.ts` und `ticket-row-actions.test.ts` (Zeile); Manifest BYL-E6-740 bis BYL-E6-746.

## Nachtrag (2026-10-02, [ADR-0052](0052-farben-fuer-projekte-und-tickets.md)): Farbe im Duplikat

Mit den Farben für Projekte und Tickets ist die eigene Farbe ein Feld des Tickets wie die Priorität. §2 bis §6 bleiben, ergänzt um:

- **Abfrage:** Unter „Übernehmen“ steht nach der Fälligkeit „Farbe: Blau“ bzw. „Farbe: wie Projekt“, angehakt (`DEFAULT_TAKE.color`), sobald der Server das Feld kennt; wie bei den anderen Feldern auch ohne eigene Farbe, weil dieselbe Wahl für die Unteraufgaben gilt.
- **Route:** Schalter `color` (`parseRequest`, `takenValues`); das Duplikat und seine neuen Unteraufgaben bekommen jeweils ihre eigene Farbe. Ohne Schalter oder ohne eigene Farbe zeigt die Kopie die Farbe ihres Projekts. Ein Client ohne den Schalter (älterer Stand im offenen Tab) übernimmt keine Farbe.
- **Vor der Migration** liest der Dienst eine leere Farbe und setzt nichts.
- **Tests:** `duplicate-rules.test.mjs`, `colors.test.mjs` (Route mit Unteraufgaben), `ticket-duplicate.test.ts`, `duplicate.test.ts`.

## Nachtrag (2026-10-04, [ADR-0062](0062-charms.md), CH-1): Charm im Duplikat

Mit den Charms hat ein Ticket ein Symbol vor dem Titel. §2 bis §6 bleiben, ergänzt um:

- **Immer übernommen:** Das Duplikat bekommt den Charm des Originals, jede neue Unteraufgabe den Charm ihrer eigenen Unteraufgabe (`withCharm` in `lib/duplicate-service.js`), ohne Schalter in der Abfrage (Wunsch des Nutzers: „Duplizieren übernimmt den Charm“) und ohne Eintrag im Verlauf. Ohne Charm bleibt das Feld leer.
- Ein Schlüssel, den der Katalog nicht mehr kennt, wird ausgelassen; vor der Migration liest der Dienst leer und setzt nichts.
- **Tests:** `charms.test.mjs` („"Duplizieren" takes the charm of the original and of each sub-task over“).
