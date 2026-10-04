# ADR-0059: Bereiche Privat und Haushalt in der Oberfläche (E7-3)

- **Status:** Angenommen und umgesetzt (E7-3, [Plan E7 „Haushalt“](../plan/e7-haushalt.md) §4)
- **Datum:** 2026-10-04
- **Entscheidung durch:** Nutzer (Privat und Haushalt als isolierte Arbeitsbereiche, umschaltbar wie virtuelle Desktops; Auftrag zu E7-2 vom 2026-10-04), Advisor (Akzeptanzkriterien E7-3: Umschalter, Isolation, Anlegen, Verweise, Deep-Links, `@CODE`, Papierkorb, Wechsel der Mitgliedschaft), Executor (Umsetzung, Kanaltypen je Bereich, Einzelheiten)
- **Bezug:** [ADR-0058](0058-haushalt-mitgliedschaft-einladungen-rechte.md) (Haushalt, Rechte, Regeln), [ADR-0037](0037-papierkorb.md) (Papierkorb), [ADR-0045](0045-ticket-duplizieren.md) (Duplizieren), [ADR-0049](0049-zielprojekt-je-eingangsweg.md) (Zielprojekt), [ADR-0054](0054-tickets-im-kontext-oeffnen.md) (Tickets im Kontext), [ADR-0056](0056-konten-und-verwalter.md) §5 (Kanäle mit Zugangsdaten), [ADR-0007](0007-realtime-und-sitzungspflege.md) (Realtime)

## Kontext

Seit E1 tragen alle fachlichen Datensätze `owner`, `household` und `scope` (`u:<Konto>` bzw. `h:<Haushalt>`), und die Hooks prüfen Projekt, Tags, Wiederholung und übergeordnetes Ticket im selben Scope. Seit E7-2 erreicht ein Konto Haushaltsdatensätze nur über die aktuelle Mitgliedschaft. Die Oberfläche zeigte aber alles Sichtbare gemischt, legte alles privat an, und der Umschalter „Privat | Haushalt“ war ein ausgegrauter Platzhalter. Ein Wechsel der Mitgliedschaft lud die ganze Seite neu.

## Entscheidung

### 1. Umschalter

- „Privat | Name des Haushalts“ steht in der Kopfzeile (`AreaSwitch`, Gruppe „Bereich“ mit zwei Knöpfen und `aria-pressed`), **nur für ein Konto in einem Haushalt**. Ohne Haushalt gibt es keine Wahl, keinen Umschalter (auch nicht den früheren Platzhalter „Demnächst“), und jede Anfrage liefert dasselbe wie vorher.
- Der aktive Bereich ist doppelt markiert: im Umschalter mit Fläche und Linie der Marke, Gewicht und Symbol (Person bzw. Haus), und im Haushalt zusätzlich mit einer Linie der Marke am oberen Fensterrand, die auch bei weggescrolltem Kopf sichtbar bleibt.
- Gemerkt wird die Wahl je Gerät und Konto in `localStorage` (`byl-area:<Konto-ID>`, Werte `private` oder `household:<ID>`). Beim Öffnen gilt sie sofort; sobald der `HouseholdStore` die Mitgliedschaft kennt, weicht ein nicht (mehr) gültiger Haushalt dem Bereich Privat (`resolveChoice`).
- Wechseln lädt keine Seite neu. Ein offenes Ticket, Projekt, ein Eintrag, eine Regel, ein Formular „neu“ oder ein Filter mit IDs des alten Bereichs (`projekt`, `unterprojekte`, `tag`, `zielprojekt`, `von`, `oberprojekt`, `aus`) schließt sich: Die Adresse geht zur Ansicht des Bereichs mit ihren übrigen Parametern (`areaSwitchTarget`). Ungespeicherter Text fragt dabei wie bei jeder Navigation („Änderungen verwerfen?“); mit „Weiter bearbeiten“ bleibt er stehen und lässt sich speichern.
- **Nachtrag „+“ (2026-10-04, Nutzerentscheidung):** Ohne Haushalt steht an der Stelle des Umschalters `[ Privat ] [ + ]` wie bei virtuellen Desktops: „Privat“ als aktueller Bereich (Gruppe „Bereich“, `aria-current`, kein Knopf) und daneben ein kleines „+“ (`.button-icon`, `aria-label` und Tooltip „Haushalt gründen oder beitreten“, am Handy 44 px) zu Einstellungen → Haushalt. Es gilt für jedes Konto auf jedem Gerät, ohne Verwalter-Einschränkung und ohne Knopf zum Ausblenden. Das „+“ erscheint erst, wenn der `HouseholdStore` geantwortet hat (`AreaStore.known`), also nie kurz bei einem Mitglied und nicht, solange der Haushalt nicht laden konnte; lädt ein gemerkter Haushalt noch, bleibt die Stelle leer wie bisher. Gründen oder Beitreten ersetzt es durch den Umschalter, Austreten, Entfernen oder Auflösen bringt es zurück, jeweils ohne Neuladen. Mit Haushalt bleibt der Umschalter unverändert. Tests: BYL-E7-229 bis BYL-E7-231.

### 2. Isolation

- **Ein Bereich je Client:** `data/area.ts` hält den Bereich des PocketBase-Clients der App (`setClientArea`, gesetzt vom `AreaStore` vor jedem anderen Store). Jede Liste, Zählung, Suche und Auswahl einer Collection mit Scope fragt nur ihn ab (`areaFilter`: Filter `… && scope = {:bylArea}` über `pb.filter()`, statisch geprüft in `data-layer.test.ts`): offene, erledigte, gesuchte und im Picker gewählte Tickets, Unteraufgaben, Fälligkeiten des Kalenders, Projekte, Tags, Regeln, neue und bearbeitete Einträge des Eingangs, Verbindungen und ihre Namen, Ereignisquellen der Sammelaktion. Ohne Bereich (Tests der Datenschicht, fremde Clients) gilt der Filter von vorher.
- **Realtime auf dem Server gefiltert:** Abos ganzer Collections tragen denselben Filter in ihren Optionen; PocketBase prüft ihn bei jedem Ereignis zusätzlich zur Regel. Die selbst gesendeten `delete`-Ereignisse des Papierkorbs (`broadcastRemoved`) werten den Filter des Abos ebenso aus (`subscriptionFilter`, `matchesSubscription`). Ändert sich der Bereich, abonnieren die Funktionen der Datenschicht neu (`followArea`, mit Wiederholung wie `hold`), und `onReconnect` meldet den Wechsel wie eine Wiederverbindung, sodass auch Stores einzelner Seiten (Kalender, Projektzahlen, Kanäle, Namen) neu laden.
- **Stores:** `CatalogStore`, `TicketListStore`, `RecurrenceStore`, `InboxStore` und `TrashStore` haben `rescope()`: Sie leeren den alten Bereich sofort und laden den neuen mit derselben Abfrage. Der Papierkorb fragt seine Routen mit `scope`; „Einstellungen → Tickets“ zeigt weiter die eigene Aufbewahrung (`ownRetention`).
- Datensätze einzelner Tickets (Panel, Kommentare, Verlauf, Quellen) laden über ihre ID und bleiben, bis man sie schließt.

### 3. Anlegen

- Was die Oberfläche anlegt, landet im aktiven Bereich (`clientHousehold`): Ticket, Schnellerfassung, Projekt, Tag, Wiederholung, Eintrag im Eingang, Datei-Importe (`.ics` mit dem Formularfeld `household`, Mails und WhatsApp-Exporte über die Record-API). Ein privater Datensatz sendet wie vorher kein `household`.
- Was zu einem Datensatz gehört, folgt ihm statt dem Umschalter: eine Unteraufgabe dem übergeordneten Ticket, „Wiederholen…“ dem Ticket, Kommentare und Verlauf dem Ticket, Tickets einer Wiederholung der Regel (`newInstance`), ein Duplikat dem Original (ADR-0045).
- **Eingang:** Einträge erben den Bereich ihrer Verbindung (`inbox-service` `draftHousehold`) bzw. den Haushalt, den eine Route geprüft hat (`requestHousehold`, sonst 400). Der eigene Eingang (API, WhatsApp Web) legt weiter privat an.

### 4. Keine Verweise über Bereichsgrenzen

Der Server ist maßgeblich und lehnt ab, mit `validation_scope_mismatch` und einem Text je Feld, der den Bereich nennt (`ticket-rules.SCOPE_MESSAGES`, gleich in `domain/area.ts`):

| Verweis | Wo |
|---|---|
| Projekt, Tags, übergeordnetes Ticket (Anlegen und Ändern) | `ticket-service.checkRelations` (seit E1, Texte neu) |
| Projekt und Tags der Vorlage einer Regel | `recurrence-service` über `checkRelations` |
| Ticket einer Regel („Wiederholen…“) | `validation_recurrence_ticket_missing` |
| Ticket aus einer Wiederholung | `newInstance` nimmt Besitzer und Haushalt der Regel |
| Abhängigkeit (`blocker`, `blocked`) | neu: `dependencies.pb.js`, `checkDependencyArea`, für jeden Schreiber |
| Oberprojekt | `catalog-service` (`validation_project_parent_missing`) |
| Quelle eines Tickets, Verknüpfen und Umhängen | `inbox-service` (seit E4) |
| Zielprojekt einer Verbindung, eines Repositorys, eines Ordners | `target-project-service` (ADR-0049) |
| Projekt eines Duplikats | über die Ticket-Hooks; das Duplikat bleibt im Bereich des Originals |

Verschieben zwischen Bereichen und Auflösen kommen mit E7-4; die Unveränderlichkeit von `owner`, `household` und `scope` über die Record-API regelt `lib/scope-guard.js` (eigener Fix), E7-3 baut sie nicht doppelt.

### 5. `@CODE` und Kanaltypen je Bereich

- **`@CODE`** ist seit der ersten Migration je Scope eindeutig (Index `idx_projects_scope_code` auf `projects(scope, code)`); Privat und Haushalt dürfen dasselbe Kürzel haben. Aufgelöst wird es gegen die Projekte des Katalogs, also des aktiven Bereichs. Eine Migration des Index war nicht nötig.
- **Kanaltypen** (Festlegung E7-3; Grundlage Plan §4 „Verbindungen mit Server-Zugriff bleiben privat“):

  | Kanal | Im Haushalt | Begründung |
  |---|---|---|
  | Google Calendar, Telegram, Web.de, Gmail, Notion | nein | lesen eine `BYL_*`-Variable des Servers |
  | Ordner | nein | lesen Ordner des Rechners der App |
  | GitHub | nein | nennt immer eine `BYL_*`-Variable und ruft im Server nach Zeitplan ab (Netz und Rate-Limit des Servers) |
  | Eigener Eingang (API), WhatsApp Web | nein | der Zugangsschlüssel gehört dem Konto, die Route legt privat an |
  | Schnellerfassung, Zwischenablage, Bookmarklet (Erfassen) | ja | nur der Browser, Record-API |
  | Datei-Importe (`.eml`, `.ics`, WhatsApp-Export, Proton per Datei) | ja | der Browser liest die Datei; `.ics` über die Route mit geprüftem `household` |

  Der Server lehnt jede neue Verbindung mit `household` für App-Konten ab (`validation_connection_private_only`, `connection-rules.areaViolation`). Im Haushalt zeigt „Kanäle“ keine Karten der Verbindungen, der Katalog nennt jede Verbindung und WhatsApp Web mit „Nur im privaten Bereich“, und Assistenten außer Proton öffnen sich nicht. Das Zielprojekt der Dateien bleibt ein privates Projekt (ADR-0049 §7) und steht im Haushalt nicht in der Karte. Eine Verbindung mit `household` von vorher (nur über `/_/` oder die Record-API möglich) läuft weiter und bleibt für Mitglieder änderbar (Tests mit dem Superuser), die Oberfläche zeigt sie aber in keinem Bereich; gemeinsame Verbindungen klärt E7-7.

### 6. Papierkorb und Aufbewahrung im Haushalt

- **Sehen und Wiederherstellen** dürfen alle Mitglieder (Regeln von ADR-0058). **Endgültig löschen** und **„Papierkorb leeren“** im Haushalt nur der Inhaber und Mitglieder mit `purge` (`household-rules.mayPurge`); sonst 403 („Endgültig löschen im Haushalt dürfen nur der Inhaber und Mitglieder mit dem Recht „Endgültig löschen“.“). „Leeren“ ohne Bereich lässt Haushalte ohne Recht stehen. Die Oberfläche blendet die Knöpfe aus (Kopf, Auswahlleiste, Menü der Zeile, Vorschau; `TrashArea`).
- **Routen:** `GET /api/byl/trash?scope=…` und `POST …/empty { scope }` arbeiten auf einem Bereich des Kontos (sonst 400), die Liste nennt `scope`, `retention` des Bereichs, `own_retention` und `can_purge`; jeder Eintrag nennt seinen `scope`.
- **Aufbewahrung je Haushalt:** `households.trash_retention` (`7` | `30` | `90` | `never`, leer = 30 Tage wie bisher, Migration `1790204100`). Ändern über `POST /api/byl/household/retention { retention }` (Inhaber oder `purge`, sonst 403 `right`; ungültig 400 `retention`; vor der Migration 503). Die Seite „Haushalt“ zeigt sie als Radiogruppe bzw. ohne Recht als Text. Die tägliche Bereinigung und die Resttage nehmen für Haushaltstickets die Aufbewahrung des Haushalts, für private die des Besitzers (`retentionOf` je Bereich); vor der Migration wie bisher die des Besitzers.

### 7. Deep-Links

- Öffnet eine Adresse ein Ticket, Projekt, einen Eintrag, eine Regel oder eine Vorschau des Papierkorbs aus dem anderen Bereich des Kontos (URL, Hinweis, Kalender, „im Kontext öffnen“), wechselt der Bereich ohne Navigation, und das Flag sagt „Zum Bereich <Name> gewechselt.“ (`followRecordArea` nach jeder Navigation, `recordOfRoute`, `recordScope` liest nur `scope`). Gefragt wird nur, wenn der Store des Bereichs den Datensatz nicht kennt; ist der Haushalt noch nicht geladen, folgt der Wechsel, sobald er es ist.
- Was das Konto nicht sieht, bleibt „nicht gefunden“ (404) wie bisher; der Bereich bleibt.

### 8. Wechsel der Mitgliedschaft

- Kein Neuladen der Seite mehr (Folgepunkt aus E7-2): Beitreten, Austreten und Entfernen laden den Haushalt (wie bisher) und die Namen der Konten neu und zeigen den Hinweis als Flag. Weil jeder Store nur einen Bereich zeigt, bleibt beim Beitreten alles im Bereich Privat; geht der Haushalt des Tabs verloren, wechselt er nach Privat („Du bist jetzt im Bereich Privat.“), schließt einen Datensatz des verlorenen Haushalts und lässt ungespeicherten Text stehen (dieselbe Frage wie beim Wechseln).

## Alternativen

| Alternative | Bewertung |
|---|---|
| Listen im Client nach `scope` filtern | Daten und Realtime-Ereignisse des anderen Bereichs kämen weiter in den Tab; der Auftrag verlangt Filter auf dem Server. |
| Bereich als Parameter jeder Funktion der Datenschicht | Dutzende Signaturen und Aufrufer; der Bereich gehört wie die Sitzung zum Client. Tests der Datenschicht ohne Bereich bleiben unverändert. |
| Alle Stores bei einem Wechsel neu erzeugen (`{#key}` um das Layout) | Wirft offene Panels samt ungespeichertem Text weg und verliert den Fokus des Umschalters. |
| Bereich in der Adresse | Links würden je Bereich verschieden; ein Deep-Link in den anderen Bereich wäre ein Widerspruch. Gerät und Konto merken die Wahl, der Datensatz bestimmt sie bei Links. |
| Umschalter ohne Haushalt weiter ausgegraut zeigen | Der Auftrag verlangt ihn nur für Mitglieder; ohne Haushalt gibt es nichts zu wählen. |
| Verbindungen ohne Variable (GitHub ohne Token) im Haushalt erlauben | GitHub nennt immer einen Variablennamen, und jeder Kanal läuft im Server; eine Regel „Verbindungen sind privat“ ist klarer. Gemeinsame Verbindungen kommen mit E7-7. |
| Ungelesen-Punkt am Umschalter | Die Zählung „neu“ entsteht im Client aus den geladenen Tickets des Bereichs; für den anderen Bereich bräuchte es eine eigene Abfrage und ein eigenes Abo (Ereignisse des anderen Bereichs). Offen gelassen. |

## Konsequenzen

- Migration `1790204100_household_trash_retention.js` (additiv, Rollback-Test): **Neustart nötig** (`neu-starten.bat`). Bis dahin gilt die Aufbewahrung des Besitzers, die Seite „Haushalt“ zeigt 30 Tage und das Ändern antwortet 503; alles andere (Filter, Rechte `purge`, Kanäle, Verweise, Abhängigkeiten) wirkt mit den Hooks sofort nach dem Neustart, die Oberfläche nach F5.
- Neue Module: `web/src/lib/data/area.ts`, `domain/area.ts`, `stores/area.svelte.ts`, `trash-area.svelte.ts`, `components/RetentionChoice.svelte`; Hook-Datei `app/pb_hooks/dependencies.pb.js`.
- Tests: `tests/integration/household-areas.test.mjs` (eigene Instanz: Realtime-Filter, Verweise, Kanäle, Wiederholung und Eingang im Bereich, `@CODE`, `purge`, Aufbewahrung mit der Uhr des Papierkorbs), `migrations-rollback.test.mjs`, `hooks-before-migration.test.mjs`, Regeltests (`household-rules`, `connection-rules`, `ticket-rules` mit Gleichstand der Texte); in `web/` Datenschicht, Domain, `AreaStore`, Umschalter, Layout (Wechsel der Mitgliedschaft ohne Neuladen, Deep-Links, Regression ohne Haushalt), `rescope()` der Stores (Tickets, Katalog, Regeln, Eingang, Papierkorb). Test-Manifest: BYL-E7-200 bis BYL-E7-215, manuell BYL-E7-220 bis BYL-E7-228.
- Nur im Browser prüfbar (Test-Manifest, manuell): Umschalten am PC, zweites Gerät, Live-Ereignisse zwischen zwei Konten, Deep-Link, Papierkorb mit und ohne `purge`, Aufbewahrung je Haushalt.
