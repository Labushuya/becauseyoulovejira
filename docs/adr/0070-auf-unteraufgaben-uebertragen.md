# ADR-0070: Auf Unteraufgaben übertragen

- **Status:** Angenommen und umgesetzt (Paket UE-1); Fälle im Test-Manifest BYL-E6-1809 bis BYL-E6-1825, manuelle Prüfungen BYL-E6-1821 bis BYL-E6-1825; Nachtrag UE-2 (2026-10-19): „Übertragen …“ nach einer Änderung am Hauptticket, Fälle BYL-E6-1826 bis BYL-E6-1839, manuelle Prüfungen BYL-E6-1837 bis BYL-E6-1839
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

## Nachtrag UE-2 (2026-10-19): „Übertragen …“ nach einer Änderung am Hauptticket

**Entscheidung durch:** Nutzer (Auftrag UE-2 über den Advisor: Flag mit genau einer Aktion, ein Flag je Hauptticket mit gesammelten Feldern, Modus „nach Änderung“ desselben Dialogs, Verschieben um den Abstand, Tags als Änderung, Serien-Checkbox statt Serien-Angebot), Executor (Bestandsaufnahme der Wege und Rückfragen, Entscheidungen unten). **Keine Änderung am Server**, keine Migration: Die Route aus §4 kann `shift` und `remove` schon (§9). Nur die SPA ändert sich; nach dem Build genügt F5.

### 1. Flag

Ändert die Person in diesem Tab an **einem** Ticket mit mindestens einer **offenen** Unteraufgabe ein Feld des Dialogs (Fälligkeit, Priorität, Status, Zuständigkeit, Tags, Projekt), erscheint das Info-Flag „Fälligkeit und Priorität von HAUS-12 geändert. Auch für die Unteraufgaben?“ mit genau einer Aktion **„Übertragen …“** (dazu wie jedes Flag ×). Es läuft nicht ab (`duration: null`, wie das Serien-Angebot seit FL-1) und steht bei offenem Dialog wie jedes Flag im obersten Dialog (ADR-0025 Nachtrag 18).

- **Ein Flag je Hauptticket** (`TransferOfferStore`, `stores/subtask-transfer-offer.svelte.ts`): Weitere Änderungen desselben Tickets sammeln sich (`nextParentChange`, rein in `domain/subtask-transfer-change.ts`). Alter Wert ist der Stand vor der **ersten** Änderung (`before`), neuer der der letzten (`after`). Ändert sich der Text, ersetzt ein neues Flag das alte (eines bleibt); sonst bleibt es stehen. Gezählt werden nur Felder, die die Person selbst geändert hat (`touched`): Ein Feld, das eine andere Person dazwischen geändert hat, steht zwar im neuen Stand, aber nicht im Flag.
- **Zurückgenommen:** Ein Feld, das wieder seinen alten Wert hat, fällt heraus (`pendingFields`); ohne Feld verschwindet das Flag. Das gilt auch für „Rückgängig“ eines „erledigt“-Flags und einer verschobenen Fälligkeit im Kalender: Sie aktualisieren ein stehendes Flag, beginnen aber nie eines (`undo`).
- **Auslöser** sind nur die Meldungen der Ticket-Stores über `TicketChangeSink.changed`; dorthin melden ausschließlich Änderungen der Person in diesem Tab an einem Ticket. Realtime (andere Personen, andere Tabs, Server, Regeln, Erzeugung einer Serie) läuft über `upsert` und meldet nichts; der Dialog selbst ändert nur Unteraufgaben über die Route, die per Realtime ankommen; Sammelaktionen behalten den bisherigen Weg (`BulkEditStore` mit dem `RecurrenceStore`) und melden nichts. Belegt in `subtask-transfer-offer.test.ts` („what the ticket stores report“) und `subtask-transfer-after-change.test.ts`.

### 2. Einstiegsstellen (Inventur)

| Weg | Feld | erfasst | Grund |
|---|---|---|---|
| Seitenpanel und Vollansicht (`TicketFields`, `TicketDetailStore`: `#save`, `#saveTags`, `confirmCompletion`, `reopenDetached`) | Status, Priorität, Fälligkeit, Zuständigkeit, Projekt, Tags | ja | zentrale Stelle für beide Ansichten |
| Tabelle „Aufgaben“ (`TicketListStore.changeField`, `setDone`, `confirmCompletion`, `undo`, `reopenDetached`) | Zellen, Häkchen, „Erledigt“ mit Rückfrage, „Rückgängig“ | ja | derselbe Store, an derselben Stelle wie das Serien-Angebot |
| Kalender, Ziehen eines Eintrags (`TicketListStore.moveDue`, „Rückgängig“) | Fälligkeit | ja | derselbe Store; das Flag „Fälligkeit … gesetzt.“ mit „Rückgängig“ bleibt daneben (Ergebnis, kein Angebot) |
| Sammelaktionen (`BulkEditStore`) | alle | nein | per Auftrag: Mehrfachbearbeitung mehrerer Tickets löst nichts aus; das Serien-Angebot bleibt dort unverändert |
| Tagesplan (`DayPlanStore`: Haken, Frage zu offenen Unteraufgaben) | Status | nein | eigener Store und eigener Datenweg, nicht die zentrale Stelle; der Haken heißt bei einem Vorhaben „für heute erledigt“ |
| „Erledigte“ (`DoneListStore`: „Wieder öffnen“, „Rückgängig“) | Status | nein | eigener Store; nur das Wiederöffnen erledigter Tickets |
| Statusmenü und Häkchen im Abschnitt „Unteraufgaben“ | Status einer Unteraufgabe | entfällt | eine Unteraufgabe hat keine Unteraufgaben (ADR-0033) |
| Board-Ziehen | – | entfällt | gibt es nicht (Stufe 2) |
| „Neues Ticket“, Duplizieren, Verschieben in einen anderen Bereich, Papierkorb | – | entfällt | Anlegen bzw. keine Änderung eines Feldes des Dialogs an einem bestehenden Hauptticket |

### 3. Bestehende Rückfragen zum Status

- **„N Unteraufgaben sind noch offen – trotzdem erledigen?“** (ADR-0033 §2; `TicketCompletionQuestion` in Panel und Vollansicht, `CompletionDialog` in der Tabelle): greift, wenn der Status auf „Erledigt“ geht und mindestens eine offene **blockierende** Unteraufgabe da ist (`openBlocking`, auch nach einer Ablehnung `open_children` des Hooks). „Unteraufgaben mit erledigen“ erledigt sie im selben Schritt, „Trotzdem erledigen“ lässt sie bewusst offen. Beide Antworten haben die Unteraufgaben für diese Statusänderung behandelt: Die Antwort meldet `answered: ['status']`, und der Status fällt aus dem Flag, auch ein vorher gesammelter. Offene **nicht blockierende** Unteraufgaben fragt niemand; dort steht „Status“ im Flag, und „Übertragen …“ erledigt sie auf Wunsch.
- **„Vorhaben abschließen?“** (VH-1; `OngoingFinishAsk` in `TicketFields`): greift beim Erledigen eines offenen laufenden Vorhabens und betrifft das Ticket selbst (Tagesplan), nicht seine Unteraufgaben. Danach läuft das Speichern wie sonst (gegebenenfalls mit der Frage oben); „Status“ bleibt im Flag. Sind unter den Unteraufgaben Vorhaben, sagt der Dialog das wie in §3 („Darunter ist ein laufendes Vorhaben; es wird damit abgeschlossen.“).
- **Abgelehntes Wiedereröffnen** (ADR-0023 Nachtrag 4; `TicketReopenQuestion` mit „Als normales Ticket wieder öffnen (aus der Serie lösen)“): betrifft die Serie, nicht die Unteraufgaben; die Statusänderung meldet sich normal, „Status“ steht im Flag.
- **`TicketParentField`** („Übergeordnet“, QB-1 nur Anordnung in voller Breite) stellt keine Frage zum Status.

### 4. Flag oder Serien-Angebot

`offerChoice`: Das Flag erscheint, wenn mindestens ein Feld des Dialogs abweicht, das Ticket mindestens eine offene Unteraufgabe hat und der Server die Route nicht nachweislich fehlt (`SubtaskTransferStore.support` ist nicht `missing`). Dann steht **nur** das Flag; „Auch für künftige Tickets übernehmen“ ist eine Checkbox im Dialog (§6). Sonst geht die Änderung unverändert an das bisherige Serien-Angebot (`RecurrenceStore.offerTemplate([{ before, after }])`): ohne offene Unteraufgabe, mit nur anderen Feldern (Titel, Beschreibung, Farbe, Charm), für eine Unteraufgabe selbst, vor dem Neustart.

- **Gemischte Änderung** (etwa Titel und Priorität): **ein** Flag, „Übertragen …“. Die Checkbox im Dialog trägt das ganze Serien-Angebot dieser Änderung, also auch den Titel (`templateOffers` über den gesammelten Stand vor und nach). Begründung: Zwei Flags zum selben Ticket hätten konkurriert, und die Checkbox ist genau das Serien-Angebot; das Flag sagt in seiner Beschreibung, dass der Dialog es anbietet („Im Dialog lässt sich die Änderung auch für künftige Tickets von „Müll“ übernehmen.“).
- **Ein stehendes Serien-Angebot desselben Tickets** (etwa nach einer Titeländerung) gibt einer folgenden Änderung eines Feldes des Dialogs Platz: Es wird zurückgezogen (`withdrawTemplateOffer`, gemerkt mit `isTemplateOffer`), seine Änderung zählt im Flag mit (alter Wert von dort), die Checkbox übernimmt auch sie. Umgekehrt geht, wenn im Flag kein Feld mehr abweicht, das Übrige der gesammelten Änderung (etwa der Titel) an das Serien-Angebot.
- Das Angebot „Unteraufgabe hinzufügen“ einer Serie (WV-3, `offerSubtask`) bleibt eigenständig: Es betrifft die Liste der Vorlage, kein Feld des Dialogs, und konkurriert nicht mit dem Flag.

### 5. Dialog im Modus „nach Änderung“

Derselbe `SubtaskTransferDialog` mit der Prop `afterChange` (`{ change, series, tagNames }`) und `applySeries`; ohne sie ist er unverändert der von UE-1.

- **Vorauswahl:** genau die geänderten Felder, die er ungesperrt anbietet (`changeInitialFields`), auch das Projekt. Die gemerkte Auswahl des Geräts gilt hier nicht und wird hier nicht überschrieben (`transfer(…, remember = false)`).
- **Fälligkeit:** Hat die Änderung eine alte und eine neue Fälligkeit mit Abstand (`dueShiftOf`, neue minus alte in Kalendertagen, 1 bis 3650), steht unter „Fälligkeit: 15.10.2026“ die Gruppe „Fälligkeit der Unteraufgaben“ mit „Gleiches Datum wie das Hauptticket“ (Standard) und „Um denselben Abstand verschieben (+3 Tage)“ mit „Unteraufgaben ohne Fälligkeit bleiben ohne.“; gesperrt, solange die Fälligkeit nicht angehakt ist. Sonst die Checkbox aus UE-1 („Gleiche Fälligkeit …“, ohne Fälligkeit mit „Die Unteraufgaben verlieren ihre Fälligkeit.“).
- **Verschieben ohne eigene Fälligkeit:** Die Route verschiebt nur eine vorhandene Fälligkeit (`changesOf` in `lib/subtask-transfer-rules.js`: `child.due === '' ? '' : shift(…)`); eine Unteraufgabe ohne bleibt ohne und zählt nicht als geändert, wenn sonst nichts wechselt. Die Zeile über den Knöpfen sagt es („Ändert 2 von 3 Unteraufgaben. 1 Unteraufgabe ohne Fälligkeit bleibt ohne.“).
- **Tags:** als Änderung, nicht alle Tags des Haupttickets: „Tags: Garten hinzufügen, Müll entfernen“ mit „Andere Tags der Unteraufgaben bleiben.“, gesendet als `{ add, remove }` (`tagChangeOf`), gemessen am Hauptticket beim Öffnen, weil die Route nur Tags hinzufügt, die es hat, und nur solche entfernt, die es nicht hat. Ohne Tag-Änderung die Checkbox aus UE-1.
- **Priorität, Status, Zuständigkeit, Projekt:** der neue Wert des Haupttickets wie in UE-1 (der Server liest ihn).
- **Ziel:** „Alle offenen Unteraufgaben (n)“ (Standard), „Keine“ oder „Auswählen …“. **„Keine“ nur mit der Serien-Checkbox:** Ohne sie hieße „Keine“ dasselbe wie „Abbrechen“; ein zweiter Weg ohne Wirkung wäre verwirrend. Mit „Keine“ sind die Felder gesperrt, die Zeile sagt „Die Unteraufgaben bleiben, wie sie sind.“, der Knopf heißt **„Für künftige Tickets übernehmen“** und ist ohne Haken bei der Serie gesperrt.
- **Serien-Checkbox „Auch für künftige Tickets übernehmen“:** erscheint genau dann, wenn das bisherige Serien-Angebot für diese Änderung erschienen wäre (`TransferOfferStore.seriesOffer` = `templateOffers` beim Öffnen), nicht angehakt, mit „Die Vorlage von „Müll“ bekommt Priorität und Tags; dieses Ticket und seine Unteraufgaben ändert das nicht.“. Sie schreibt genau, was die Aktion des Serien-Angebots schreibt, über denselben Weg (`RecurrenceStore.applyTemplateOffers`, gemeinsam mit der Aktion des Flags in `#writeOffers`: `updateRule` der Record-API, Erfolgs-Flag „Vorlage von „Müll“ übernommen.“); eine Ablehnung kommt hier an den Dialog statt als Fehler-Flag.
- **Zwei Operationen, Reihenfolge und Fehler:** erst die Unteraufgaben (Route), dann die Vorlage (Record-API); keine neue Route, kein Kombinieren auf dem Server. Klappen beide, schließt der Dialog. Schlägt eine fehl, nachdem die andere geklappt hat, bleibt er offen: Die gelungene steht als `SectionMessage` (success), die fehlgeschlagene als `SectionMessage` (error, `role="alert"`) mit **„Erneut versuchen“**, das nur diesen Teil wiederholt; die Auswahl ist dann gesperrt (gesendet ist gesendet), der Knopf unten heißt „Schließen“. Schlägt der einzige oder beide Teile fehl, bleibt der Dialog wie in UE-1 bearbeitbar mit der Meldung. Nichts schließt still.
- **409:** wie UE-1 („Das Hauptticket wurde inzwischen geändert. Bitte erneut öffnen.“), ohne „Erneut versuchen“, weil derselbe Stand wieder abgelehnt würde (`TransferResult.stale`).
- **Vor dem Neustart:** Weiß der Server die Route nicht (`missing` aus `GET /api/byl/tickets/create` oder 404 ohne `ticket`), steht statt der Felder der Hinweis aus §8; die Serien-Checkbox bleibt, sie braucht die Route nicht. Ist `missing` schon bekannt, erscheint statt des Flags gleich das bisherige Serien-Angebot (§4), sodass nichts ins Leere führt.

### 6. Öffnen des Dialogs aus dem Flag

Kein bestehendes Flag öffnet einen Dialog; Aktionen wie „Öffnen“ navigieren. „Übertragen …“ öffnet deshalb den Dialog im Abschnitt „Unteraufgaben“ des Haupttickets: Ist es im Panel oder in der Vollansicht zu sehen (`TicketDetailStore.id`), sofort, sonst öffnet es das Ticket zuerst (`ticketHrefIn` mit dem gemerkten Öffnungsmodus, wie „Öffnen“ der Zuweisung). Die Anfrage (`requestFor`, `take`) nimmt genau der Abschnitt dieses Tickets einmal; die nächste Navigation, die nicht der Weg dorthin ist, verwirft sie (`navigated` aus `afterNavigate`), etwa wenn „Änderungen verwerfen?“ den Weg abbricht. Im Panel ist der Dialog ein Modal M; steht dort gerade ein anderer Dialog davor (das Flag stand in ihm), wartet er, bis jener zu ist (kein Dialog über einem Dialog, ADR-0025 §3). In der Vollansicht steht er eingebettet. Der Fokus geht vorher auf „Auf Unteraufgaben übertragen …“, damit er beim Schließen dorthin zurückkehrt.

### 7. Künftige Vorkommen einer Serie und ihre Unteraufgaben

Ein neues Vorkommen entsteht aus der Vorlage der Regel (`newInstance` in `lib/recurrence-service.js`: Titel, Beschreibung, Projekt, Tags, Priorität, „Status beim Anlegen“, Farbe, Charm; die Zuständigkeit nach der Art der Regel, Fälligkeit aus dem Rhythmus). Seine Unteraufgaben entstehen aus `template_subtasks` (`newSubtasks`): Titel und Priorität des Eintrags, Status des Eintrags oder des neuen Tickets, und vom neuen Ticket („Vererbung“, UT-1) Projekt, Tags, Fälligkeit, Art und Zuständigkeit. Für das Zusammenspiel heißt das: Die Serien-Checkbox schreibt Projekt und Tags (und andere Felder der Vorlage) in die Vorlage; über die Vererbung erreichen Projekt und Tags auch die Unteraufgaben künftiger Vorkommen. Die Priorität erreicht nur das künftige Hauptticket, die Unteraufgaben behalten die Priorität ihres Eintrags. Fälligkeit, Status und Zuständigkeit gehören nie in die Vorlage (Nachtrag 6 von ADR-0023, ADR-0068 §5); künftige Unteraufgaben bekommen die Fälligkeit ihres Vorkommens. Nichts darüber hinaus wurde erweitert. Belegt in `recurrence-subtasks.test.mjs` („moves the sub-tasks by the distance …“).

### 8. Alternativen

- **Neue Route für Unteraufgaben und Vorlage zusammen:** wäre atomar, aber eine neue Server-Route für zwei bestehende Operationen; der Auftrag schließt sie aus. Stattdessen zwei Anfragen mit klarer Teilfehler-Anzeige.
- **Den Dialog als Modal im Layout öffnen, wo immer das Flag steht:** über der Vollansicht oder einem anderen Dialog ein Dialog über einem Dialog (ADR-0025 §3). Verworfen zugunsten des Abschnitts des Tickets.
- **Jede Komponente einzeln anbinden:** doppelte Logik; die Ticket-Stores sind die zentrale Stelle, an der schon das Serien-Angebot hängt.
- **Den Status ganz aus dem Flag lassen:** Bei nicht blockierenden Unteraufgaben fragt niemand; gerade dort hilft „Status: Erledigt“.

### 9. Konsequenzen

- Keine Änderung an Hooks oder Migrationen: nach dem Build F5. Steht der Neustart nach UE-1 noch aus, zeigt der Dialog bis dahin den Hinweis, und die Serien-Checkbox funktioniert trotzdem.
- `TicketDetailStore` und `TicketListStore` melden Änderungen an einen `TicketChangeSink` (`changes`, Standard `seriesChanges(series)` mit dem bisherigen Verhalten); das `(app)`-Layout gibt ihnen den `TransferOfferStore`.
- Belegt in `subtask-transfer-change.test.ts`, `subtask-transfer-offer.test.ts`, `subtask-transfer-after-change.test.ts`, `subtask-transfer.test.ts` (Store), `tests/unit/web-subtask-transfer.test.mjs` (Body nach Änderung gegen die Regeln der Route) und `tests/integration/recurrence-subtasks.test.mjs`.
