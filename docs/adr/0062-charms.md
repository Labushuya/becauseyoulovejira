# ADR-0062: Charms – ein Symbol aus einem festen Katalog vor dem Titel von Tickets und Wiederholungen

- **Status:** Angenommen und umgesetzt (Paket CH-1); manuelle Prüfungen im Test-Manifest (BYL-E6-1480 bis BYL-E6-1484)
- **Datum:** 2026-10-04
- **Entscheidung durch:** Nutzer (Wunsch „Charms wie im Outlook-Kalender“: ein Charm je Ticket und je Wiederholungsregel, optional, feste kuratierte Liste von etwa 40 Symbolen in acht Gruppen mit Suche, keine Emojis; Vererbung an neue Tickets, Duplizieren übernimmt, Verschieben behält, Unteraufgaben erben nichts; Anzeige vor dem Titel; nicht im Paket: Vorschläge aus dem Titel, Charms an Projekten, Filter, Syntax der Schnellerfassung), Advisor (Akzeptanzkriterien: Allowlist im Server mit Paritätstest, Textfeld, Dialog, Barrierefreiheit, Tests), Executor (Katalog, Symbolquelle, Dialog, Anzeigeorte, Einzelheiten)
- **Ergänzt:** [ADR-0045](0045-ticket-duplizieren.md) (Charm im Duplikat, Nachtrag dort), [ADR-0022](0022-erzeugung-von-instanzen.md) (Charm der Vorlage, Nachtrag 12 dort), [ADR-0053](0053-kalenderansicht.md) (Charm im Kalender, Nachtrag dort)
- **Bezug:** [ADR-0052](0052-farben-fuer-projekte-und-tickets.md) (Farbe nur als Streifen oder Punkt, Symbole in `currentColor`), [ADR-0059](0059-bereiche-privat-und-haushalt.md) (Bereiche), [ADR-0060](0060-einheitliche-eingabeelemente.md) (Felder und Knöpfe, 44 px am Handy), [ADR-0061](0061-verschieben-zwischen-bereichen-und-aufloesen.md) (Verschieben), [ADR-0025](0025-ui-konsistenz-overlay-system.md) (Popover), [ADR-0009](0009-fehlerfarbe.md)

## Kontext

Der Nutzer möchte Tickets wie Termine im Outlook-Kalender auf einen Blick einordnen: ein kleines Symbol vor dem Titel, etwa ein Flugzeug für Reisen, eine Torte für Geburtstage, eine Hantel fürs Training. Emojis scheiden aus, weil sie auf jedem Gerät anders aussehen. Die App zeichnete ihre Symbole bisher selbst (16er-Raster, je Komponente), es gab keinen Satz, der Torte, Flugzeug oder Hantel enthält.

## Entscheidung

### 1. Katalog

Eine Definition in `web/src/lib/domain/charms.ts` (`CHARMS`): je Charm ein fester Schlüssel (`a–z`, ohne Umlaute, höchstens 40 Zeichen), ein deutscher Name, eine Gruppe, Suchwörter und ein Symbol. 43 Charms in acht Gruppen:

| Gruppe | Charms (Schlüssel) |
|---|---|
| Alltag | Einkaufen (`einkaufen`), Paket (`paket`), Erinnerung (`erinnerung`), Idee (`idee`), Behörde (`behoerde`) |
| Haushalt | Müll (`muell`), Putzen (`putzen`), Wäsche (`waesche`), Reparatur (`reparatur`), Garten (`garten`), Kochen (`kochen`) |
| Gesundheit | Arzt (`arzt`), Medikament (`medikament`), Sport (`sport`), Laufen (`laufen`), Gesundheit (`gesundheit`) |
| Familie | Geburtstag (`geburtstag`), Geschenk (`geschenk`), Kind (`kind`), Haustier (`haustier`), Familie (`familie`) |
| Arbeit | Meeting (`meeting`), Telefon (`telefon`), Dokument (`dokument`), E-Mail (`mail`), Computer (`computer`) |
| Reise | Flugzeug (`flugzeug`), Zug (`zug`), Auto (`auto`), Koffer (`koffer`), Urlaub (`urlaub`) |
| Finanzen | Rechnung (`rechnung`), Geld (`geld`), Karte (`karte`), Sparen (`sparen`) |
| Freizeit | Film (`film`), Musik (`musik`), Buch (`buch`), Essen (`essen`), Kaffee (`kaffee`), Spiel (`spiel`), Feier (`feier`), Fahrrad (`fahrrad`) |

- Ein Schlüssel ändert sich nie; der Name ist nur Anzeige. Ein neuer Charm ist ein neuer Eintrag hier und im Server (§3) und braucht keine Migration.
- **Suche** (`searchCharms`): jedes Wort der Eingabe muss im Namen, einem Suchwort, der Gruppe oder dem Schlüssel stehen, ohne Groß- und Kleinschreibung und mit oder ohne Umlaute („muell“, „müll“ und „mull“ finden „Müll“).

### 2. Symbole

- Die App hatte keine Icon-Bibliothek, und ihre eigenen Zeichnungen decken die Themen nicht ab. Die Symbole kommen deshalb aus **[Lucide](https://lucide.dev), Paket `lucide-static` 1.52.0** (ISC; „trash-2“ und „music“ stammen aus Feather, MIT), **ohne neue npm-Abhängigkeit**: nur die 43 benutzten Zeichnungen als Daten in `web/src/lib/domain/charm-icons.ts` (Kopf `@license lucide-static v1.52.0 - ISC`), der vollständige Lizenztext der Version daneben in `charm-icons.LICENSE.txt`.
- **Ein Raster:** alle Symbole in `viewBox="0 0 24 24"`, ohne Füllung, Strich 2 in `currentColor`, runde Enden (`CHARM_SVG`); die Komponente `CharmIcon` zeichnet sie. Ein neues Symbol wird aus derselben Version kopiert.
- **Farbe:** `currentColor`, also immer die Farbe des Textes um das Symbol (gedämpft bei erledigten Einträgen, Akzentfläche bei der geöffneten Zeile). Ein Charm trägt nie eine eigene Farbe; die Farbe eines Tickets bleibt der Streifen bzw. Punkt aus [ADR-0052](0052-farben-fuer-projekte-und-tickets.md).

### 3. Datenmodell und Server (Migration `1790204400_charms.js`)

- `tickets.charm` und `recurrence_rules.charm`: **Textfeld**, nicht Pflicht, höchstens 40 Zeichen; leer heißt „kein Charm“. Additiv: Altdaten haben keinen, der Rückweg entfernt beide Felder und verliert nur die Charms.
- **Allowlist im Server:** `app/pb_hooks/lib/charms.js` (rein, ES5) kennt nur die Schlüssel (`CHARM_KEYS`). Die Modell-Hooks von Tickets (`checkCharm` in `lib/ticket-service.js`, beim Anlegen und Ändern) und Regeln (`prepareCreate`, `prepareUpdate` in `lib/recurrence-service.js`, auch für Speicherungen des Superusers) lehnen jeden anderen Wert mit **400 `validation_charm_unknown`** am Feld `charm` ab: „Diesen Charm gibt es nicht. Bitte einen aus der Liste wählen.“ Ein unveränderter Wert wird nicht erneut geprüft, damit ein später entfernter Schlüssel keine andere Änderung blockiert.
- **Paritätstest:** `tests/unit/web-charms.test.mjs` hält Schlüssel (samt Reihenfolge) und Texte von Hook und SPA gleich.
- **Verlauf:** `charm` steht in `TRACKED_FIELDS` (Setzen, Ändern, Leeren mit dem Nutzer); der Verlauf liest „Charm: Geburtstag → Flugzeug“, ohne Charm „kein“.
- **Bereiche:** Der Charm hängt nicht vom Bereich ab ([ADR-0059](0059-bereiche-privat-und-haushalt.md)); es gibt einen Katalog für alle.

### 4. Vererbung, Duplizieren, Verschieben

- **Regel → neues Ticket:** `newInstance` setzt den Charm, den die Regel beim Erzeugen hat; ändert man den Charm der Regel, gilt das nur für die künftigen Tickets. Der Charm der Regel ist keine Änderung des Tickets (nur „created“ im Verlauf). Ein Schlüssel, den der Katalog nicht mehr kennt, wird ausgelassen, damit die Serie nie daran scheitert.
- **Unteraufgaben erben nichts:** weder die Unteraufgaben der Vorlage noch eine von Hand angelegte Unteraufgabe bekommen den Charm ihres übergeordneten Tickets.
- **Vorlage aus einem Ticket:** „Wiederholen…“ übernimmt den Charm des Tickets (`ticketTemplate`); die Zeile „Künftige Tickets“ nennt „Charm Müll“; ändert der Nutzer den Charm eines offenen Serientickets, bietet das Flag „Auch für künftige Tickets übernehmen“ ihn wie die Farbe an.
- **Duplizieren** ([ADR-0045](0045-ticket-duplizieren.md)): die Kopie bekommt immer den Charm des Originals, jede kopierte Unteraufgabe ihren eigenen; ohne Schalter in der Abfrage (Wunsch: „Duplizieren übernimmt den Charm“).
- **Verschieben** ([ADR-0061](0061-verschieben-zwischen-bereichen-und-aufloesen.md)): Ticket und Regel behalten ihre ID und damit ihren Charm; das nächste Ticket einer verschobenen Regel entsteht im Ziel mit ihrem Charm. Papierkorb und Wiederherstellen lassen ihn stehen.

### 5. Auswahl (`CharmPicker`)

- **Auslöser:** ein kleiner Knopf (`button-secondary button-small`) mit dem aktuellen Charm und seinem Namen („Geburtstag“, Name „Charm: Geburtstag“) oder neutral „Charm wählen“ mit einem gestrichelten Kreis. Orte: „Neues Ticket“, Ticket-Panel und Vollansicht (Feld „Charm“ nach „Farbe“, speichert sofort), Vorlage einer Regel (Regel-Panel, „Neue Regel“, Vorlage am Ticket). Ein Fehler des Servers steht unter dem Knopf und ist per `aria-describedby` verknüpft (neue Option `buttonDescribedby` des Popovers).
- **Popover** der Art `panel` ([ADR-0025](0025-ui-konsistenz-overlay-system.md) §5) mit dem Namen „Charm wählen“: das Suchfeld der App (`.search-field`, UI-1), darunter „Kein Charm“ und die Gruppen als `listbox` mit `group` je Gruppe (Überschrift als Name) und je Charm einer `option` (Knopf mit Symbol, Name für Screenreader und als Tooltip, `aria-selected` beim aktuellen, dazu Akzentfläche und Rahmen). Unter dem Raster steht der Name des Charms unter Zeiger oder Fokus. Die Suche sagt höflich „3 Charms gefunden.“ bzw. „Kein Charm passt zu „…“.“.
- **Tastatur:** Der Fokus liegt beim Öffnen in der Suche; Pfeil runter führt in das Raster (zum aktuellen Charm bzw. zum ersten Treffer), Enter in der Suche wählt den ersten Treffer. Im Raster ist genau ein Charm ein Tab-Stopp (roving tabindex); die Pfeile links/rechts gehen in Lesereihenfolge, hoch/runter in dieselbe Spalte der Zeile darüber bzw. darunter (`charmMove`, sechs Spalten, jede Gruppe beginnt eine Zeile), Pos1 und Ende an den Anfang bzw. das Ende, Pfeil hoch aus der ersten Zeile zurück in die Suche, ein Buchstabe sucht weiter. Enter und Leertaste wählen, die Wahl schließt das Popover und der Fokus kehrt zum Knopf zurück; Esc schließt ohne Änderung.
- **Handy:** auf `pointer: coarse` ist jeder Charm 44 px groß (Token `--control-height-touch`), Knopf und Suchfeld folgen UI-1; das Popover scrollt in sich.

### 6. Anzeige

`CharmIcon`: das Symbol `aria-hidden`, ein `title` „Charm: Geburtstag“ als Tooltip und, wo der Ort ihn nicht selbst nennt, ein verborgener Text „Charm: Geburtstag“. Überall dieselbe Größe (0,875rem) und derselbe Abstand zum Titel (0,375rem), direkt vor dem Titel.

| Ort | Darstellung |
|---|---|
| Kalender (Monat, Woche, Agenda, Liste eines Tages) | vor dem Titel bei Tickets und bei geplanten Terminen (Charm der Vorlage); der Name steht im Link nach Projekt und Farbe; die Punkte eines schmalen Monats zeigen kein Symbol, der Link nennt ihn |
| Tabelle „Aufgaben“ | in der Titelzelle zwischen dem Symbol der Quelle und dem Link, mit verborgenem Namen |
| Offene Tickets eines Projekts | vor dem Titel, der Name im Link nach der Farbe |
| Ticket-Panel und Vollansicht | vor der Überschrift, nicht in ihr (der Name des Panels bleibt der Titel) |
| Tabelle „Wiederholungen“ | in der Titelzelle vor dem Link |

Eine **Board-Ansicht** hat die App nicht (Stufe 2, CLAUDE.md §10); sie bekommt den Charm, sobald es sie gibt.

### 7. Vor dem Neustart

Bis zum Neustart nach dem Update kennt der Server das Feld nicht: Die Antworten enthalten kein `charm`, die SPA zeigt nichts an und bietet keine Wahl an (Ticket: `Ticket.charm` fehlt; Formulare: `RecurrenceStore.charmsReady` fragt per Filter auf `recurrence_rules.charm`, der vorher mit 400 antwortet). Die Hooks lesen leer und setzen nichts.

## Alternativen

| Alternative | Bewertung |
|---|---|
| Emojis | Je nach Gerät und System anders gezeichnet, teils farbig und nicht in `currentColor`. Vom Nutzer ausgeschlossen. |
| Icon-Bibliothek als npm-Abhängigkeit (`lucide-svelte`) | Eine neue Laufzeit-Abhängigkeit für 43 Zeichnungen, deren Versionen und Exporte der Build mitzieht. Die kopierten Daten mit Lizenzhinweis sind kleiner, fest und offline. |
| Eigene Zeichnungen im 16er-Raster | Viel Aufwand für 43 Motive und uneinheitlich; Lucide hat ein Raster und eine Strichstärke für alle. |
| Select-Feld mit den Schlüsseln (wie die Farben, ADR-0052) | PocketBase prüfte selbst, aber jeder neue Charm bräuchte eine Migration. Der Auftrag verlangt ein Textfeld mit Allowlist im Hook und eine verständliche Meldung `validation_charm_unknown`. |
| Charm des übergeordneten Tickets an Unteraufgaben | Vom Nutzer ausgeschlossen („Unteraufgaben erben nichts“). |
| Schalter „Charm“ in der Abfrage „Duplizieren“ | Der Wunsch sagt „Duplizieren übernimmt den Charm“; ein weiterer Schalter brächte keine Wahl, die jemand braucht. |
| Raster als APG-`grid` | Ein Grid verlangt Zeilen und Zellen und liest sich als Tabelle; eine Listbox mit Gruppen ist für „eins aus vielen wählen“ gedacht, die Pfeiltasten in zwei Richtungen ergänzen sie. |

## Konsequenzen

- **Neustart nötig** (`neu-starten.bat`): Migration `1790204400` und Hooks; die Oberfläche nach dem Build und F5.
- Neue Module: `app/pb_hooks/lib/charms.js`, `web/src/lib/domain/charms.ts`, `charm-icons.ts` mit Lizenztext, `components/CharmIcon.svelte`, `components/CharmPicker.svelte`; `Popover` hat `buttonDescribedby`.
- Datenschicht: `TICKET_LIST_FIELDS` und `RULE_FIELDS` lesen `charm` (Realtime eingeschlossen), `TicketPatch`, `TicketDraft` und `RuleDraft` schreiben ihn, `charmsReady` fragt das Feld ab.
- **Tests:** `tests/integration/charms.test.mjs` (eigene Instanz: Feld, Prüfung, Leeren, Verlauf, Vererbung auch nach Änderung der Regel, Duplizieren, Verschieben, Datenschicht), `migrations-rollback.test.mjs` (Rückweg), `tests/unit/web-charms.test.mjs` und `history.test.mjs`; in `web/` Katalog, Dialog, Anzeige an allen Orten, Formulare, Vorlage und Store. Manifest BYL-E6-1470 bis BYL-E6-1478, manuell BYL-E6-1480 bis BYL-E6-1484.
- CLAUDE.md §5 und §7, README und Hilfe („Wie setze ich einen Charm?“) sind nachgezogen.
