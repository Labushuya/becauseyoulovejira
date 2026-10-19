# ADR-0070: Auf Unteraufgaben übertragen

- **Status:** Angenommen und umgesetzt (Paket UE-1); Fälle im Test-Manifest BYL-E6-1809 bis BYL-E6-1825, manuelle Prüfungen BYL-E6-1821 bis BYL-E6-1825
- **Datum:** 2026-10-19
- **Entscheidung durch:** Nutzer (Auftrag UE-1 über den Advisor: Aktion im Abschnitt „Unteraufgaben“, Felder mit Vorauswahl und Gedächtnis je Gerät, Ziel „Alle offenen“ oder „Auswählen …“, alles oder nichts, zusammengefasste Benachrichtigung, Vorbereitung auf UE-2), Advisor (Akzeptanzkriterien), Executor (Bestandsaufnahme, Analyse der Hooks, Route, Dialog, Tests)
- **Bezug:** [ADR-0033](0033-unteraufgaben.md) (Unteraufgaben, eine Ebene), [ADR-0068](0068-zustaendigkeit.md) (Zuständigkeit und Hinweis `byl/assigned`), [ADR-0069](0069-vollstaendiges-anlegen.md) (Fähigkeitsabfrage `GET /api/byl/tickets/create`, Nachtrag UT-2), [ADR-0045](0045-ticket-duplizieren.md) (Muster einer Route mit Transaktion), [ADR-0022](0022-erzeugung-von-instanzen.md) und [ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) (Serien), [ADR-0032](0032-editor-tiptap-markdown.md) §6 (bekannter Stand `expected_updated`), [ADR-0025](0025-ui-konsistenz-overlay-system.md) (Modal, eingebetteter Dialog, Flags), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) (SectionMessage), [ADR-0043](0043-system-seite.md) (Neustart über „Einstellungen → System“)

## Kontext

Unteraufgaben bekommen beim Anlegen Projekt, Tags, Art, Zuständigkeit, Status und Fälligkeit ihres Tickets (UT-1, UT-2). Ändert sich das Ticket später, etwa die Fälligkeit oder die Zuständigkeit, musste man jede Unteraufgabe einzeln nachziehen. UE-1 bietet dafür eine Aktion: ausgewählte Felder des Haupttickets per Klick auf seine Unteraufgaben übertragen. UE-2 (nicht Teil dieses Pakets) soll nach einer Änderung am Hauptticket dasselbe als Flag „Übertragen …“ anbieten.

### Bestandsaufnahme

- **Hierarchie:** genau eine Ebene (ADR-0033, `parentViolation` in `lib/ticket-rules.js`). „Alle Ebenen“ sind damit die direkten Unteraufgaben; ein Nachfahre ist ein Ticket mit `parent` = Hauptticket. Eine Unteraufgabe hat keine Unteraufgaben, ihr Abschnitt „Unteraufgaben“ erscheint nicht.
- **Status:** `backlog`, `open`, `in_progress`, `waiting`, `done` (`lib/status.js`). Kein Status verlangt eine weitere Eingabe (es gibt keinen Status wie „Duplikat“ mit Verweis). Regeln greifen nur je nach Lage: Erledigen eines Tickets mit offenen blockierenden Unteraufgaben (`force`/`complete_children`; eine Unteraufgabe hat keine), Wiederöffnen eines Vorkommens einer Serie (kann wegen eines bearbeiteten Folgetickets abgelehnt werden), „Vorhaben abschließen?“ für ein laufendes Vorhaben (eine Rückfrage der Oberfläche, keine Regel des Servers).
- **Offen:** nicht in der Kategorie „abgeschlossen“ (`categoryOf` in `lib/status.js`, `domain/status.ts`), also jeder Status außer „Erledigt“.
- **Projektwechsel:** Für ein einzelnes Ticket vorgesehen; ein neues Projekt gibt einen neuen Key aus dem Zähler des Ziels, der alte bleibt im Verlauf (CLAUDE.md §5 „Scopes und Nummernkreise“, `needsNewKey`). Ein archiviertes Projekt nimmt kein Ticket neu auf (`validation_project_archived`). Der Bereich wechselt dabei nicht.
- **Verlauf:** `ticket_history` hat `ticket`, `field`, `old_value`, `new_value`, `user`; Gründe oder Notizen kennt das Modell nicht.
- **Benachrichtigung:** Eine fremde Zuweisung setzt im Modell-Hook `assigned_at`, merkt sich `{ to, by }` am Datensatz (`@assignee_notice`), löscht in derselben Transaktion die Lesezeile der Person und sendet nach dem Commit im After-Success-Hook `byl/assigned` an deren Tabs. `@assignee_inherited` (UT-1) unterdrückt den Hinweis einer neuen Unteraufgabe, aber auch die Lesezeile gibt es dort noch nicht.

## Entscheidung

### 1. Einstieg und Dialog

„Auf Unteraufgaben übertragen …“ steht im Abschnitt „Unteraufgaben“ (`TicketSubtasks`, Panel und Vollansicht) neben „Unteraufgabe hinzufügen“, als `.button-secondary .button-small` wie die anderen Abschnittsaktionen (etwa „Regel bearbeiten“), nur mit mindestens einer Unteraufgabe und nur im `(app)`-Layout (Store über den Kontext). Wer den Abschnitt sieht, darf das Hauptticket ändern: Die Update-Regel der Tickets ist ihre View-Regel (privat der Besitzer, im Haushalt jedes Mitglied); der Server prüft es für Hauptticket und jedes Ziel erneut.

Der Dialog `SubtaskTransferDialog` ist im Panel ein Modal M, in der Vollansicht eingebettet (`InlineDialog`, ADR-0025 Nachtrag 16). Er nutzt nur vorhandene Bausteine (`Modal`, `InlineDialog`, `SectionMessage`, `Lozenge`, `PcOnly`, die zentralen Checkboxen und Radios aus `base.css`), keine eigenen Stile für Controls; Labels brechen um, damit er ab 340 px benutzbar bleibt. „Felder“ und „Ziel“ sind je ein `fieldset` mit `legend`. Der Fokus geht beim Öffnen auf das erste Feld und beim Schließen zurück auf den Einstieg.

### 2. Felder

Checkboxen, jeweils mit dem Wert des Haupttickets, wie er beim Öffnen war:

- „Gleiche Fälligkeit wie das Hauptticket: 12.10.2026“; ohne Fälligkeit „: keine“, wählbar, nicht vorausgewählt, mit „Die Unteraufgaben verlieren ihre Fälligkeit.“
- „Priorität“, „Status“, im Haushalt „Zuständigkeit“ (Name oder „Niemand“; wie das Feld im Detail nur mit Mitgliedern).
- „Tags hinzufügen“: Die Tags des Haupttickets kommen hinzu, vorhandene bleiben. Ohne Tags am Hauptticket gesperrt mit „Das Hauptticket hat keine Tags.“
- „Projekt“: nie vorausgewählt und nie gemerkt, mit „Die Unteraufgaben erhalten neue Schlüssel.“; ein archiviertes Projekt gesperrt mit „Das Projekt des Haupttickets ist archiviert.“
- Nicht übertragbar: Titel, Beschreibung, Wiederholung, Art.

**Vorauswahl:** Fälligkeit und Priorität. Die zuletzt bestätigte Auswahl merkt sich das Gerät in `localStorage` unter `byl-subtask-transfer-fields` (JSON-Liste der Felder, ohne Projekt); gelesen wird bei jedem Öffnen, ein gesperrter Speicher bricht nichts, die Wahl gilt dann für die Seite. Eine gemerkte Fälligkeit ist bei einem Ticket ohne Fälligkeit nicht vorausgewählt.

### 3. Status

Es gelten dieselben Regeln wie bei einer Einzeländerung, denn jede Unteraufgabe läuft durch die Modell-Hooks (§4). Kein Status verlangt in BYLJ eine weitere Eingabe; deshalb ist die Checkbox „Status“ nie gesperrt. Lehnt ein Hook eine Unteraufgabe ab (etwa das Wiederöffnen eines Vorkommens einer Serie mit bearbeitetem Folgeticket), ändert sich keine, und der Dialog nennt sie. Wird „Erledigt“ übertragen und sind laufende Vorhaben darunter, sagt die Zusammenfassung „Darunter ist ein laufendes Vorhaben; es wird damit abgeschlossen.“; die Bestätigung mit „Übertragen“ ersetzt die Rückfrage „Vorhaben abschließen?“ der Einzeländerung.

### 4. Server und Analyse der Hooks

`POST /api/byl/tickets/{id}/subtasks/transfer` in `tickets.pb.js` (`$apis.requireAuth('users')`, jedes Gerät, denn sie tut nichts am Rechner der App), Dienst `lib/subtask-transfer-service.js`, rein `lib/subtask-transfer-rules.js`, Spiegel `domain/subtask-transfer.ts` mit Paritätstest `tests/unit/web-subtask-transfer.test.mjs`. Host, CORS und Rate-Limit regelt der Guard wie bei jeder Route (ADR-0055); die Anmeldung läuft über die Kopfzeile `Authorization`, nicht über Cookies, eine fremde Seite kann die Anfrage also weder auslösen noch lesen.

Body `{ expected_updated, fields, targets }`:

- `fields`: `due` (`{ mode: 'same' }` oder `{ mode: 'shift', days }` mit 1 bis 3650 Tagen in beide Richtungen), `priority`, `status`, `assignee`, `project` (je `true`), `tags` (`{ add, remove }`, je höchstens 100). Mindestens ein Feld; ein anderes Feld `validation_transfer_field`.
- `targets`: `'open'` (alle offenen Unteraufgaben, der Server entscheidet) oder 1 bis 200 IDs. Mehr als 200 (auch bei `'open'`) `validation_transfer_targets_max`.

Ablauf: Hauptticket sichtbar (sonst 404 mit dem Feld `ticket`) und änderbar (Update-Regel, sonst 403); dann **eine Transaktion der Route** (`e.app.runInTransaction` wie „Duplizieren“): Hauptticket neu lesen; weicht `updated` vom bekannten Stand ab, 409 „Das Hauptticket wurde inzwischen geändert. Bitte erneut öffnen.“; die Werte liest der Server selbst aus dem Hauptticket (Quelle der Wahrheit); Tags gegen das Hauptticket prüfen; Ziele lesen (jedes ein Ticket mit `parent` = Hauptticket, nicht im Papierkorb, sonst `validation_transfer_target` mit `index`), je Ziel die Update-Regel (sonst 403 mit Key); je Ziel die Änderungen rein berechnen (`changesOf`), ein Ziel mit allen Werten schon wird nicht gespeichert und zählt nicht; sonst `txApp.save`. Lehnt ein Hook ab, wirft die Route einen Fehler am Feld `targets` mit dem Code des Hooks, der Meldung „GART-3: Das Projekt ist archiviert.“ und `params` `{ id, key, field }`; die Transaktion rollt alles zurück. Antwort `{ parent: { id, key }, changed, unchanged, tickets: [{ id, key, previous_key }] }`.

**Request- und Modell-Hooks:** `txApp.save` aus einer Route löst nur die Modell-Hooks aus, keine Request-Hooks und keine API-Regeln. Was sonst wo liegt und was daraus folgt:

| Hook | Art | Aufgabe | beim Speichern aus der Route |
|---|---|---|---|
| `guardSourceChange` (`tickets.pb.js`) | Request | `source`, `source_item` unveränderlich | entfällt: die Route ändert sie nie |
| `recurrence-service.guardTicketUpdate` | Request | `occurrence` bleibt, `recurrence` nur leeren (Lösen aus der Serie) | entfällt: die Route schreibt beides nie, der Datensatz kommt aus der Datenbank |
| `trash-service.guardTrashFields` | Request | Felder des Papierkorbs gehören dem Server | entfällt: nie geschrieben; Ziele im Papierkorb lehnt die Route ab |
| `rememberActor` | Request | `@actor` für den Verlauf | ersetzt: die Route setzt `ACTOR_KEY` je Ziel |
| `rememberExpectedUpdated` | Request | Schutz der Beschreibung | ersetzt: 409 für das Hauptticket in der Transaktion; die Ziele liest die Route darin selbst neu |
| `rememberCompletion` | Request | `force`, `complete_children` | entfällt: eine Unteraufgabe hat keine Unteraufgaben |
| `scope-guard.pb.js` | Request | `owner`, `household`, `scope` | entfällt: unverändert; ein Projekt wechselt den Bereich nicht |
| Update-Regel der Collection | Record API | wer ändern darf | ersetzt: `canAccessRecord(…, updateRule)` für Hauptticket und jedes Ziel |
| Feldvalidierung von PocketBase | Modell (`save`) | Werte der Selects, Relationen | läuft |
| `onRecordUpdate` (`tickets.pb.js`) | Modell | Scope, Fälligkeit, Charm, Relationen (archiviertes Projekt), angepinnter Kommentar, Zuständigkeit mit `assigned_at` und Lesezeile, `completed_at`, neuer Key, Erledigen und Wiederöffnen einer Serie, Verlauf, Pins eines erledigten Tickets | läuft in der Transaktion der Route (`inTransaction` nutzt sie mit) |
| `onRecordUpdate` (`day-plans.pb.js`) | Modell | Einträge im Tagesplan bei Bereichswechsel oder Papierkorb | läuft (ändert hier nichts) |
| `onRecordAfterUpdateSuccess` (`tickets.pb.js`) | Modell, nach dem Commit | Folgeticket einer Serie, Hinweis `byl/assigned` | läuft je Ziel nach dem Commit; der Hinweis schweigt (§5) |

Nichts geht verloren: Was die Request-Hooks prüfen, ändert die Route nicht, oder sie übernimmt es selbst. Keine Logik ist dupliziert; Prüfungen, Verlauf, Keys und Serien bleiben in den Modell-Hooks.

### 5. Zusammengefasste Benachrichtigung

Jede Speicherung trägt `@assignee_batch` (`BATCH_KEY` in `lib/assignee-service.js`). Der Modell-Hook verhält sich wie bisher (`assigned_at`, `@assignee_notice`, Lesezeile gelöscht, das Ticket ist für die Person wieder „neu“); nur `notifyAssigned` im After-Success-Hook sendet für einen so markierten Datensatz nichts. Nach dem Commit liest die Route die Hinweise von genau den Datensätzen, die sie gespeichert hat, gruppiert sie je Empfänger und sendet mit `notifyAssignedTogether` einen Hinweis je Person: bei einer Unteraufgabe die gewohnte Nachricht, bei mehreren die Nachricht der ersten mit `count`, `parent`, `parent_key` und `parent_title`. Die SPA zeigt dann „Anna hat dir 3 Unteraufgaben von HAUS-12 zugewiesen.“ mit dem Titel des Haupttickets, „Öffnen“ öffnet das Hauptticket; ein Tab von vorher liest die Nachricht als Zuweisung der ersten Unteraufgabe. Kein globaler Zustand, kein Warten, kein Wettlauf: Die Hinweise hängen an den Datensätzen dieser einen Anfrage. Eigene Zuweisungen und solche des Servers melden sich wie bisher nicht.

### 6. Verlauf

Jede Unteraufgabe bekommt die normalen Einträge je geändertem Feld mit dem handelnden Konto, ein neues Projekt dazu den Eintrag `key`. Gründe oder Notizen kennt `ticket_history` nicht; einen Vermerk „übernommen von <KEY>“ gibt es deshalb nicht. Er bräuchte eine neue Art von Eintrag samt Anzeige im Verlauf und bleibt einer eigenen Entscheidung vorbehalten.

### 7. Ziel und Zusammenfassung

„Alle offenen Unteraufgaben (n)“ ist der Standard und heißt nur offene. „Auswählen …“ zeigt alle Unteraufgaben in der Reihenfolge des Abschnitts (offene zuerst); erledigte sind mit „Erledigt“ gekennzeichnet und nicht vorausgewählt. Die Zeile über den Knöpfen zählt, was sich ändert („Ändert 3 von 4 Unteraufgaben.“), mit derselben Rechnung wie der Server. „Übertragen“ ist gesperrt (`aria-disabled`), solange kein Feld oder kein Ziel gewählt ist. Erfolg: Flag „Auf 3 Unteraufgaben übertragen.“, die Listen folgen per Realtime, die Auswahl wird gemerkt. Fehler: `SectionMessage` (error) im Dialog, es ändert sich nichts.

### 8. Vor dem Neustart

Route und Hooks wirken erst nach einem Neustart, der neue Client sofort. `GET /api/byl/tickets/create` nennt seit UE-1 `subtask_transfer` (`CreateSupport.subtaskTransfer`, Teil von `supportComplete`). Fehlt es, oder antwortet die Route mit 404 ohne das Feld `ticket`, zeigt der Dialog statt Feldern und Fehler den Hinweis „Diese Funktion ist nach einem Neustart verfügbar: Einstellungen → System → „Jetzt neu starten“.“ mit „Zur Seite System“ (nur für den Verwalter an diesem Rechner, sonst der Hinweis von `PcOnly`). Scheitert die Abfrage, steht der Grund mit „Erneut versuchen“ da; „Übertragen“ bleibt bis zur Antwort gesperrt.

### 9. Erweiterungspunkte für UE-2

- **Route:** `fields.due` nimmt schon `{ mode: 'shift', days }` (eine eigene Fälligkeit wandert mit, Unteraufgaben ohne bleiben ohne), `fields.tags` schon `{ add, remove }` (hinzufügen nur Tags des Haupttickets, entfernen nur solche, die es nicht hat). Beides ist getestet; der Dialog von UE-1 sendet nur `same` und `add` mit den Tags des Haupttickets.
- **Domäne:** `TransferFields`, `DueTransfer`, `TagsTransfer` und `changesOf` beschreiben beide Wege; `fieldsOf` ist die Abbildung von UE-1. UE-2 ergänzt eine Abbildung aus der eben gespeicherten Änderung (Abstand der Fälligkeit, hinzugefügte und entfernte Tags).
- **Dialog:** `SubtaskTransferDialog` bekommt Hauptticket, Unteraufgaben, Store und Namen. UE-2 ergänzt Props für eine vorgegebene Auswahl, die Option „Keine“ (dann geht keine Anfrage), die Wahl „gleiches Datum | um denselben Abstand verschieben“ und bei Serien „Auch für künftige Tickets übernehmen“ (eine Änderung der Vorlage über die Wege der Regel, nicht über diese Route).
- **Store:** `transfer(parent, request, chosen)` ist unabhängig vom Einstieg; ein Flag „Übertragen …“ öffnet denselben Dialog.

### 10. „Neues Ticket“

Die Aktion gehört zur Option `subtasks` der Registry (`domain/ticket-options.ts`) und setzt bestehende Unteraufgaben voraus; beim Anlegen übernehmen neue Unteraufgaben Projekt, Tags, Status, Fälligkeit, Art und Zuständigkeit ohnehin vom Ticket (UT-1, UT-2). Kein Gegenstück in „Neues Ticket“, kein neuer Eintrag der Registry.

## Alternativen

- **Jede Unteraufgabe über die Record API einzeln aus dem Client:** keine Transaktion (halbe Ergebnisse), keine zusammengefasste Benachrichtigung, Werte aus dem Client statt vom Server. Verworfen.
- **Werte im Request statt vom Hauptticket:** einfacher für UE-2, aber der Server wäre nicht Quelle der Wahrheit und könnte veraltete Werte schreiben. Verworfen; nur Abstand und Tag-Differenz kommen aus dem Request und werden gegen das Hauptticket geprüft.
- **Hinweise sammeln über einen globalen Puffer im Hook (`$app.store()` mit Zeitfenster):** abhängig von Zeit und Reihenfolge, falsch bei gleichzeitigen Anfragen. Verworfen zugunsten der Markierung je Datensatz.
- **Prüfungen der Modell-Hooks vor dem Schreiben nachbauen:** doppelte Logik. Verworfen; die Route fängt die Ablehnung des Hooks und nennt die Unteraufgabe.
- **„Alle“ inklusive erledigter Unteraufgaben:** würde Erledigtes ungefragt ändern (etwa die Fälligkeit). Verworfen; erledigte nur über „Auswählen …“.

## Konsequenzen

- Hooks ohne Migration: Nach dem Merge ist ein Neustart nötig (Einstellungen → System → „Jetzt neu starten“). Bis dahin zeigt der Dialog den Hinweis.
- Eine Ablehnung eines Hooks bricht die ganze Übertragung ab; der Dialog nennt die Unteraufgabe mit dem Grund.
- Ein Tab, der vor dem Build geöffnet wurde, zeigt eine zusammengefasste Benachrichtigung als Zuweisung der ersten Unteraufgabe, bis er neu lädt.
