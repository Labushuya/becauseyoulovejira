# ADR-0023: Lebenszyklus von Regeln und Instanzen: Anlegen, Erledigen, Rückgängig, Pausieren, Bearbeiten, Löschen

- **Status:** Angenommen (2026-09-26: Der Nutzer hat die Empfehlungen zu OF-E5-1 bis OF-E5-5 bestätigt; umgesetzt in E5, siehe Nachtrag am Ende)
- **Datum:** 2026-09-25
- **Entscheidung durch:** Advisor
- **Ergänzt:** [ADR-0021](0021-regelmodell-wiederkehrende-aufgaben.md) (Regelmodell), [ADR-0022](0022-erzeugung-von-instanzen.md) (Erzeugung)

## Kontext

Die Invariante „höchstens eine offene Instanz pro Regel“ ([ADR-0022](0022-erzeugung-von-instanzen.md) §1) muss jeden Weg überstehen, den der Nutzer in der Oberfläche gehen kann *(heute nur ohne „Jeden Termin einzeln anlegen“, Nachtrag 2)*:

- Das Häkchen in der Tabelle schreibt den Status sofort, und „Rückgängig“ stellt den vorigen Status innerhalb von 5 s wieder her (`UNDO_WINDOW_MS`, OF-E2-3) *(seit UI-5 8 s im Flag, erster Nachtrag)*. Beim Erledigen entsteht aber schon das Folgeticket.
- `tickets.recurrence` ist bisher ein frei setzbares Feld. Der Hook prüft nur den Scope.
- Relationen ohne Cascade leert PocketBase beim Löschen des Ziels. Die Model-Hooks laufen dabei, die Historie hält die Änderung also fest.
- Tickets können gelöscht werden (mit Sicherheitsabfrage), Projekte archiviert.

## Entscheidung

### 1. Anlegen

- **„Wiederholen…“ an einem Ticket** (Hauptweg, Ticket-Panel): Der Dialog legt eine Regel an, deren Vorlage aus dem Ticket kommt. Das Ticket wird die aktuelle Instanz.
  - Die SPA sendet dafür beim Anlegen der Regel zusätzlich `ticket` im Body. Das ist kein Schemafeld.
  - Der Request-Hook von `recurrence_rules` öffnet die Transaktion über `inTransaction`. Darin prüft er das Ticket (sichtbar, gleicher Scope, nicht `done`, noch in keiner Serie), legt die Regel an und setzt `tickets.recurrence`. Beides geschieht zusammen oder gar nicht.
  - `anchor` ist die Fälligkeit des Tickets bzw. heute.
  - Bei `calendar` wird `next_due = after(rule, ticket.due)`.
  - Hat das Ticket keine Fälligkeit, gilt bei `calendar`: Der Dialog zeigt den ersten Termin `onOrAfter(anchor)`. Erst mit der Bestätigung bekommt das Ticket diese Fälligkeit, still wird nichts gesetzt.
  - Bei `after_completion` bleibt die Fälligkeit des Tickets, wie sie ist, und `next_due` bleibt leer.
- **Neue Regel ohne Ticket** (Übersicht „Wiederholungen“):
  - `calendar`: `next_due = onOrAfter(anchor, heute)`.
  - `after_completion`: `next_due = max(anchor, heute)`.
  - Das erste Ticket erzeugt der Dienst, sobald der Vorlauf erreicht ist. Liegt es schon im Fenster, geschieht das direkt nach dem Anlegen im After-Success-Hook.
- **`tickets.recurrence` setzt nie der Client.** Der Hook lehnt ein Setzen oder Umhängen per Record-API mit `validation_recurrence_managed` ab. Erlaubt ist nur das Leeren (§6). Es setzen nur der Regel-Hook (Anlegen mit `ticket`) und der Erzeugungsdienst.

### 2. Erledigen

Nach [ADR-0022](0022-erzeugung-von-instanzen.md) §4: Bei `after_completion` wird der Folgetermin atomar mit dem Erledigen gespeichert. Das Folgeticket entsteht danach, sobald der Vorlauf erreicht ist, also direkt oder später per Cron.

### 3. Rückgängig bzw. Wiedereröffnen einer Instanz

Verlässt eine Instanz `done` (Häkchen „Rückgängig“ oder Statuswechsel im Panel), prüft der Update-Hook in der Transaktion der Änderung, ob die Regel inzwischen eine andere offene Instanz hat.

- **Folgeticket noch unberührt:**
  - Das Folgeticket gilt als unberührt, wenn diese Bedingungen alle erfüllt sind:
    - Es entstand nach dem `completed_at` der wiedereröffneten Instanz.
    - `updated` ist gleich `created`.
    - Es hat keine Kommentare.
  - Dann löscht der Hook das Folgeticket und stellt `next_due` wieder her: bei `calendar` auf die Fälligkeit des gelöschten Tickets, bei `after_completion` auf leer.
  - Die Regel für gelöschte Instanzen aus §6 greift dabei nicht, denn der Hook setzt `next_due` nach dem Löschen ausdrücklich.
  - Der Fall ist das versehentliche Häkchen, und die Serie steht danach genau wie vorher. *(Nur für die zuletzt erledigte Instanz; eine ältere lehnt der Hook ab, siehe Nachtrag 4.)*
- **Folgeticket schon bearbeitet:** Das Wiedereröffnen wird mit dem Feldfehler `validation_recurrence_open_instance` abgelehnt. Die Meldung lautet: „Von dieser Serie ist schon HAUS-12 offen. Erledige es zuerst oder löse ein Ticket aus der Serie.“ Das ist ein echter, abgelehnter Wunsch, also Fehlerfarbe nach [ADR-0009](0009-fehlerfarbe.md). Die Invariante bleibt hart. *(Seit Nachtrag 4 steht die Ablehnung im Panel als Warnung mit dem Ausweg „Als normales Ticket wieder öffnen (aus der Serie lösen)“, weil sie eine Wahl anbietet; in der Tabelle bleibt sie ein Fehler-Flag mit dieser Aktion.)*
- **Kein Folgeticket vorhanden** (Vorlauf noch nicht erreicht): Das Wiedereröffnen ist erlaubt.
  - Bei `after_completion` wird `next_due` geleert, denn die Instanz ist wieder offen.
  - Bei `calendar` bleibt `next_due`.

### 4. Pausieren und Fortsetzen

- **Pausieren** (`active = false`): Es werden keine Tickets mehr erzeugt. Eine offene Instanz bleibt ein normales offenes Ticket, und `next_due` bleibt zur Anzeige stehen.
- **Fortsetzen** (`active = true`): Die Pause wird **nicht** nachgeholt.
  - `calendar`: `next_due = max(next_due, onOrAfter(rule, heute))`.
  - `after_completion`: `next_due = max(next_due, heute)`, falls gesetzt.
  - Danach gilt der Vorlauf wie immer.

### 5. Bearbeiten

- **Vorlage** (Titel, Beschreibung, Projekt, Tags, Priorität): Die Änderung wirkt nur auf künftige Tickets. Die offene Instanz bleibt, wie sie ist.
- **Rhythmus** (`mode`, `freq`, `interval`, `weekdays`, `month_day`, `anchor`): Der Hook rechnet `next_due` neu.
  - `calendar`: mit offener Instanz `after(rule, max(instanz.due, heute − 1))`, sonst `onOrAfter(rule, heute)`.
  - `after_completion`: mit offener Instanz leer, sonst `max(anchor, heute)`.
- **Vorlauf** (`lead_days`): nichts neu zu rechnen, der Dienst prüft ihn bei jedem Lauf.
- Projekt und Tags der Vorlage prüft der Hook wie bei Tickets: gleicher Scope, kein neu zugewiesenes archiviertes Projekt.

### 6. Instanz löschen oder aus der Serie lösen

- **Löschen der offenen Instanz** (Sicherheitsabfrage wie bisher, mit dem Zusatz „Die Regel läuft weiter.“):
  - `calendar`: `next_due` bleibt, und der gelöschte Termin gilt als übersprungen.
  - `after_completion`: `next_due = afterCompletion(rule, heute)`, als wäre die Instanz heute erledigt worden. So erscheint nicht sofort ein neues Ticket. *(Genauer: nicht im selben Schritt; liegt der neue Termin schon im Vorlauf, entsteht er beim nächsten stündlichen Lauf, siehe Nachtrag 5 und ADR-0022 Nachtrag 7. Seit dem Papierkorb verschiebt Löschen die Instanz dorthin, Nachtrag 3.)*
- **„Aus der Serie lösen“** (Ticket-Panel, leert `tickets.recurrence`): Es gilt dasselbe wie beim Löschen, das Ticket bleibt als normales Ticket.
- Erledigte Instanzen zu löschen oder zu lösen ändert an der Regel nichts.

### 7. Regel löschen (OF-E5-4)

- Die Regel verschwindet. Alle ihre Tickets, auch die offene Instanz, bleiben als normale Tickets. PocketBase leert `tickets.recurrence`, und die Historie zeigt „Wiederholung entfernt“.
- Die Sicherheitsabfrage sagt das ausdrücklich: „Regel löschen? Bestehende Tickets bleiben erhalten.“
- Wer nur eine Pause will, nutzt „Pausieren“.

### 8. Archiviertes Projekt

Ist das Projekt der Vorlage beim Erzeugen archiviert, pausiert der Dienst die Regel mit einem neutralen Hinweis ([ADR-0022](0022-erzeugung-von-instanzen.md) §2). Die Übersicht zeigt ihn an der Regel, nicht rot. Fortsetzen geht erst, wenn das Projekt wieder aktiv ist oder die Vorlage ein anderes bzw. kein Projekt hat. Andernfalls lehnt der Hook das Fortsetzen mit Feldfehler ab.

## Alternativen

- **Wiedereröffnen immer erlauben, auch mit zwei offenen Instanzen:** Das bricht die Invariante und den Teilindex. Verworfen.
- **Beim Wiedereröffnen die alte Instanz still aus der Serie lösen:** Das wäre überraschend und schwer zu entdecken. Verworfen.
- **Beim Löschen der Regel auch die offene Instanz löschen:** Dabei gingen Kommentare und Historie verloren. Das ist eine Produktfrage (OF-E5-4); empfohlen ist das Behalten.
- **`tickets.recurrence` frei setzbar lassen:** Dann könnte ein Ticket in eine Serie mit offener Instanz gehängt werden. Verworfen. Der Weg ist „Wiederholen…“.

## Konsequenzen

- Positiv: Das versehentliche Häkchen bleibt folgenlos. Jeder Weg in der Oberfläche erhält die Invariante, und gelöschte Regeln hinterlassen keine verwaisten Verweise.
- Negativ: Der Update-Hook von `tickets` bekommt einen weiteren Zweig (Wiedereröffnen). Er läuft nur bei `recurrence != ''` und bei einem Wechsel aus `done`.
- Die Hooks lesen `recurrence_rules` nur, wenn die E5-Felder existieren. Vor der Migration verhalten sich Tickets wie in E4.

## Nachtrag (2026-09-26, Umsetzung E5)

Der Text oben bleibt unverändert. Wo die Umsetzung abweicht oder genauer ist, gilt dieser Nachtrag. Einzelheiten stehen im [E5-Plan](../plan/e5.md) §7, Pakete 2 bis 6.

- **§1, „Wiederholen…“:** Für ein fremdes, unbekanntes oder anderswo liegendes Ticket kommt der Code `validation_recurrence_ticket_missing`, für ein erledigtes `_ticket_done`, für eines in einer Serie `_ticket_linked`. Von fünf gleichzeitigen Anfragen für dasselbe Ticket gewinnt genau eine. Ein nicht lesbares `anchor` lehnt der Request-Hook ab, statt still „heute“ zu nehmen. Der Dialog ist ein Modal M nach [ADR-0025](0025-ui-konsistenz-overlay-system.md), kein eigener `<dialog>`.
- **§1, Serie aus dem Kalender:** Die Regel entsteht auf demselben Weg (`ticket` im Body), nach dem Anlegen des Tickets ([ADR-0024](0024-serien-aus-kalendern.md), Nachtrag). Scheitert sie, bleibt das Ticket bestehen, und sein Panel bietet „Wiederholen…“ vorbefüllt an.
- **§3, Rückgängig:** Seit UI-5 steht „Rückgängig“ 8 s in einem Flag unten links, nicht mehr 5 s in der Zeile. „Unberührt“ ist genau umgesetzt: Das Folgeticket entstand nicht vor dem `completed_at` der wiedereröffneten Instanz (dieselbe Millisekunde zählt als danach), `updated = created`, und es gibt keine Kommentare. Gelöscht wird es mit dem Schlüssel `@recurrence_undo`, damit §6 nicht greift. Die Ablehnung trägt `params` `{ key, ticket }`, die Liste nennt den Key.
- **§6, Lösen:** Nur ein Leeren durch den Client (`@recurrence_detach`) löst die Regel aus §6 aus. Das Leeren durch PocketBase beim Löschen der Regel (§7) ändert an `next_due` nichts.
- **§4 und §5:** Pausieren, Fortsetzen und Lösen fragen nicht nach, weil sie umkehrbar sind; sie melden sich als Erfolgs-Flag. Das Regel-Panel der Übersicht sendet den Rhythmus nur, wenn er sich geändert hat. So lässt das Speichern der Vorlage allein „Nächstes Ticket“ unverändert.
- **Offen für E7:** Wechselt eine Regel mit Tickets den Bereich, prüft das noch kein Hook.

## Nachtrag 2 (2026-09-28, Plan „Offene Reste“, OR-5): Rückgängig mit „Jeden Termin einzeln anlegen“

Mit dem Schalter aus [ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 2 darf eine Regel mehrere offene Tickets haben. §3 gilt deshalb in dieser Form (`reopen` in `lib/recurrence-service.js`, Entscheidung rein in `reopenConflicts`):

- **Was dem Wiedereröffnen entgegensteht,** folgt dem eindeutigen Index: ohne Schalter jedes andere offene Ticket der Regel, mit Schalter nur ein offenes Ticket desselben Termins (`occurrence`). Das ist im Normalfall keines.
- **Mit Schalter** lässt sich eine Instanz deshalb frei wiedereröffnen (auch per „Rückgängig“ nach dem Häkchen): Die übrigen offenen Tickets bleiben, nichts wird gelöscht, `next_due` bleibt. Das Erledigen erzeugt mit Schalter kein Folgeticket, das es zurückzunehmen gäbe; Tickets entstehen nur nach der Zeit.
- **Steht genau ein Ticket entgegen,** gilt §3 wie bisher: unberührt (nicht vor dem `completed_at` entstanden, `updated = created`, ohne Kommentare) wird es gelöscht, sonst lehnt der Hook mit `validation_recurrence_open_instance` und dem Key ab. Mit Schalter bleibt `next_due` dabei stehen, weil ein Zurücksetzen Termine erneut erzeugen könnte, deren (erledigte) Tickets es schon gibt. Das betrifft nur Folgetickets von vor dem Einschalten (beide ohne `occurrence`).
- **Stehen mehrere entgegen** (Schalter nach mehreren offenen Tickets wieder aus), lehnt der Hook mit dem Key des jüngsten ab; die Regel „eine offene Instanz“ würde sonst gebrochen. Bis alle erledigt sind, erzeugt die Regel ohne Schalter nichts.
- Belegt in `recurrence-generate.test.mjs` (frei wiedereröffnen mit mehreren offenen Tickets, Folgeticket von vor dem Einschalten unberührt bzw. bearbeitet, Ablehnung nach dem Ausschalten) und `recurrence-rules.test.mjs`.

## Nachtrag 3 (2026-09-28, Papierkorb, ADR-0037): Instanzen im Papierkorb

- **§6 Löschen:** Löschen verschiebt eine Instanz in den Papierkorb und wirkt auf die Regel genau wie bisher (fester Rhythmus überspringt den Termin, „nach Erledigung“ wartet ab heute). Die Instanz verliert `recurrence` und `occurrence`; der Schnappschuss hält beide.
- **Wiederherstellen** prüft in der Transaktion wie §3 mit `reopenConflicts` gegen die lebenden offenen Tickets der Serie (Nachtrag 2: ohne Schalter jede offene Instanz, mit Schalter nur eine desselben Termins). Anders als beim Wiedereröffnen wird dabei nie ein Folgeticket gelöscht: Ein Konflikt ergibt `validation_trash_series_conflict` mit Key, und die Oberfläche bietet „Als normales Ticket wiederherstellen (aus Serie lösen)“ (`detach_series`). Eine erledigte Instanz kehrt ohne Prüfung zurück. `next_due` bleibt in jedem Fall stehen.
- Existiert die Regel nicht mehr (§7), kommt das Ticket als normales Ticket zurück.
- Das Wiedereröffnen einer Instanz entfernt ein unberührtes Folgeticket weiter endgültig, nicht über den Papierkorb (es war nie bearbeitet).

## Nachtrag 4 (2026-09-28, Plan „Wiederholungen verständlich machen“, WK-1): Wiedereröffnen nur beim direkten Vorgänger

Nutzerentscheidung vom 2026-09-28 (Empfehlung 1). §3 und Nachtrag 2 gelten weiter, mit dieser Einschränkung (`reopen` in `lib/recurrence-service.js`, Entscheidung rein in `reopenOutcome`):

- **Direkter Vorgänger** ist die erledigte Instanz der Regel mit dem jüngsten `completed_at`, also die, aus deren Erledigen (oder nach deren Erledigen) das offene Folgeticket entstand. Tickets im Papierkorb und aus der Serie gelöste haben keine Regel mehr und zählen nicht.
- **Nur der direkte Vorgänger** darf ein unberührtes Folgeticket entfernen (§3, „versehentliches Häkchen“). Wird eine **ältere** Instanz wieder geöffnet, lehnt der Hook ab, auch bei unberührtem Folgeticket: Feldfehler `status` mit `validation_recurrence_reopen_older`, Text „Von dieser Serie ist schon HAUS-14 offen, und dieses Ticket ist nicht das zuletzt erledigte. Du kannst es als normales Ticket wieder öffnen (aus der Serie lösen).“, `params` `{ key, ticket }` des offenen Tickets. Vorher hätte der Hook das aktuelle Folgeticket still gelöscht und `next_due` zurückgedreht.
- **Ausweg:** Status und `recurrence: ""` in einer Anfrage öffnen das Ticket als normales Ticket (§6: eine erledigte Instanz zu lösen ändert an der Regel nichts). Die Oberfläche bietet ihn bei beiden Ablehnungen (`_reopen_older` und `_open_instance`) als „Als normales Ticket wieder öffnen (aus der Serie lösen)“ an: inline unter dem Status in Panel und Vollansicht (Warnung ohne Rot, kein Dialog), als Aktion des Fehler-Flags in der Tabelle.
- **Mit „Jeden Termin einzeln anlegen“** unverändert (Nachtrag 2): Jede Instanz gilt als direkt, und im Normalfall steht ohnehin nichts entgegen.
- **Endgültig statt Papierkorb** (Nachtrag 3) bleibt für das unberührte Folgeticket des direkten Vorgängers: Der Server hat es eben erst angelegt, es trägt nichts vom Nutzer, und ein Wiederherstellen würde nur mit der wieder offenen Instanz kollidieren.
- Belegt in `recurrence-generate.test.mjs` (ältere Instanz abgelehnt, Folgeticket und `next_due` bleiben, Ausweg mit `recurrence: ""`, direkter Vorgänger entfernt weiter) und `recurrence-rules.test.mjs`.

## Nachtrag 5 (2026-09-28, Plan „Wiederholungen verständlich machen“, WK-4): „Ein Ersatz entsteht nie sofort“ richtiggestellt

Empfehlung 8. §6 und CLAUDE.md §6 sagten „Ein Ersatz entsteht nie sofort“. Richtig ist: **nicht im selben Schritt.** Löschen (seit Nachtrag 3 in den Papierkorb) und „Aus der Serie lösen“ setzen nur `next_due` und rufen die Erzeugung nicht auf. Liegt der nächste Termin schon im Vorlauf, entsteht sein Ticket beim nächsten stündlichen Lauf (xx:07) oder beim nächsten Start. Beispiel: „nach Erledigung“ alle 2 Tage mit Vorlauf 3; nach dem Löschen ist der neue Termin in 2 Tagen, sein Vorlauf hat schon begonnen, das Ticket kommt mit dem nächsten Lauf. Die Hilfe „Wiederholungen“ erklärt Löschen, Lösen, Wiedereröffnen, Pausieren und Regel löschen so ([ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 7).

## Nachtrag 6 (2026-09-30, Plan „Wiederholungen: Werte von Folgetickets“, WV): Die Vorlage am Ticket

§1 („Vorlage aus dem Ticket“) und §5 („Die Änderung wirkt nur auf künftige Tickets“) bleiben. Der Nutzer hatte erwartet, dass Folgetickets den Stand des Tickets übernehmen; tatsächlich ist die Vorlage ein Schnappschuss beim Einrichten, und bis jetzt ließ sie sich nur im Regel-Panel unter „Wiederholungen“ ansehen und ändern. Neu (Einzelheiten und Befund im [Plan](../plan/wiederholungen-vorlage.md)):

- **§1, Schnappschuss mit Status:** „Wiederholen…“, „Neues Ticket“ mit „Wiederholen“ und die Übernahme einer Kalenderserie übernehmen alle Werte des Tickets wie bisher und dazu seinen Status als „Status beim Anlegen“ ([ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 8); ein erledigtes Ticket beginnt nie eine Serie. „Neue Regel“ ohne Ticket beginnt mit „Offen“. Eine Quelle für alle Wege: `ticketTemplate` und `templateBody` in `domain/series-template.ts`, die `RecurrenceStore.repeat` und `repeatCreated` senden. Der Dialog „Wiederholen…“ nennt vorher, was künftige Tickets bekommen („Künftige Tickets bekommen die Werte dieses Tickets: Priorität Hoch · … · Status beim Anlegen In Arbeit. …“), „Neues Ticket“ sagt es im Abschnitt „Wiederholen“.
- **Die Vorlage am Ticket:** Im Abschnitt „Wiederholt sich“ von Panel und Vollansicht steht „Künftige Tickets: Priorität Hoch · Projekt Haus · Tags Garten · Status beim Anlegen Offen“ mit „Bearbeiten“ (`aria-label` „Vorlage bearbeiten“). Bearbeitet wird **inline** in diesem Abschnitt, weil aus der Vollansicht kein Dialog aufgeht ([ADR-0025](0025-ui-konsistenz-overlay-system.md) §3): dieselben Felder wie im Regel-Panel (`RecurrenceTemplateFields`: Titel, Priorität, Status beim Anlegen, Projekt, Tags, Beschreibung), „Abbrechen“ und „Vorlage speichern“; gesendet werden nur die geänderten Felder (`templateChanges`), der Rhythmus nie, `next_due` bleibt. Esc und „Abbrechen“ verwerfen den Entwurf, der Fokus kehrt zu „Bearbeiten“ zurück. Der Entwurf liegt im `RecurrenceStore` (`templateDraft`), wie die Entwürfe eines Tickets in seinen Stores: Der Wechsel zwischen Panel und Vollansicht desselben Tickets behält ihn, wer das Ticket verlässt, bekommt die bekannte Frage „Änderungen verwerfen?“ (`templateDirty`), ein anderes Ticket beginnt ohne Entwurf.
- **„Auch für künftige Tickets übernehmen“:** Ändert der Nutzer an einem **offenen** Ticket einer Serie Titel, Beschreibung, Priorität, Projekt oder Tags, speichert die Änderung wie bisher ohne Rückfrage nur dieses Ticket. Danach erscheint ein Info-Flag (nicht blockierend, [ADR-0025](0025-ui-konsistenz-overlay-system.md) §8) „Nur dieses Ticket geändert.“ mit „Künftige Tickets von „Müll“ kommen weiter mit der bisherigen Vorlage (Priorität).“ und der Aktion „Auch für künftige Tickets übernehmen“. Sie schreibt genau die geänderten Felder mit ihrem neuen Wert in die Vorlage (`templateOffers`), Tags als die Änderung der Tickets (hinzugefügte und entfernte Tags auf die Tags der Vorlage angewandt), und nur, wo die Vorlage anders ist; das Ergebnis meldet „Vorlage von „Müll“ übernommen.“, eine Ablehnung (etwa ein archiviertes Projekt) ein Fehler-Flag mit Grund. Einheitlich für Panel, Vollansicht (derselbe `TicketDetailStore`) und Zellen der Tabelle (`TicketListStore.changeField`); eine Sammelaktion zeigt nach ihrem Ergebnis ein Flag für alle betroffenen Regeln („Nur diese 3 Tickets geändert.“ … „von 2 Serien“), das ihr „Rückgängig“ zurückzieht. Nie für Status und Fälligkeit (sie gehören zur Instanz, ein Termin und ein Fortschritt), nie für erledigte Tickets, Tickets ohne Serie oder ein Abhaken in der Beschreibung (Fortschritt dieses Tickets). Ein neues Angebot ersetzt ein älteres.
- **Warum ein Flag und keine Frage:** Eine Frage vor dem Speichern hätte jede Änderung eines Serientickets aufgehalten, auch die gewöhnliche („nur diesmal dringend“), und in der Vollansicht wäre sie ein Dialog aus einem Dialog. Das Flag lässt die Änderung sofort gelten und bietet den seltenen zweiten Schritt 8 s lang an (Pause bei Zeiger und Fokus); danach bleibt „Bearbeiten“ am Ticket.
- **Kein neuer Server-Weg:** Beide Schritte laufen über die Record-API (`updateRule`) mit den Prüfungen von §5 (Scope, archiviertes Projekt, Status beim Anlegen); die Rechte folgen der `updateRule` der Collection.
- Belegt in `web-data-recurrence.test.mjs` (alle Anlegewege bis zum Folgeticket, Schnappschuss und Übernahme), `recurrence-summary.test.ts`, `series-template-offer.test.ts`, `recurrence-store.test.ts`, `ticket-panel.test.ts` (Frage beim Verlassen) und `series-template.test.ts`.

## Nachtrag 7 (2026-09-30, WV-2): Status beim Anlegen gefragt

Der erste Punkt von Nachtrag 6 („übernehmen … dazu seinen Status“) gilt für den Status nicht mehr: Seit [ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 9 fragt jedes Anlegen einer Regel mit Nutzer „Folgetickets starten mit“ (Pflicht, ohne Vorauswahl; der Server verlangt die Antwort), statt den Status des Tickets still zu übernehmen. Alle anderen Werte kommen weiter aus dem Ticket; die Vorlage am Ticket und „Auch für künftige Tickets übernehmen“ bleiben unverändert.

## Nachtrag 8 (2026-10-01, WV-3): Unteraufgaben der Vorlage im Lebenszyklus

Seit [ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 10 hat die Vorlage eine Liste „Unteraufgaben“, und jedes Folgeticket bekommt ihre Einträge als neue, offene Unteraufgaben. Für den Lebenszyklus gilt:

- **§3, „unberührt“:** Ein Folgeticket mit Unteraufgaben aus der Vorlage ist unberührt, solange es selbst unberührt ist (wie bisher: nicht vor dem `completed_at` entstanden, `updated = created`, ohne Kommentare) **und** seine Unteraufgaben genau die erzeugten sind: dieselbe Menge wie in der Notiz `recurrence_subtasks` des Folgetickets, jede mit `updated = created` und ohne Kommentare (rein in `subtasksUntouched`, `lib/recurrence-rules.js`). Damit macht jede Änderung des Nutzers an ihnen das Folgeticket „berührt“: Titel, Status (auch das Häkchen), Priorität oder ein anderes Feld geändert, kommentiert, eine einzeln in den Papierkorb verschoben (sie verlässt dabei ihr übergeordnetes Ticket), unter ein anderes Ticket gehängt oder gelöst, endgültig gelöscht, oder eine neue hinzugefügt. Ansehen (Lesezeile „Neu“) ändert nichts. Die Notiz ist nötig, weil eine entfernte Unteraufgabe am Folgeticket keine Spur hinterlässt; ohne Notiz (Folgetickets von vorher) sind „keine erzeugt“, und schon eine von Hand hinzugefügte Unteraufgabe macht es berührt. Das schließt zugleich eine Lücke von vorher: Ein Folgeticket, dem der Nutzer eine Unteraufgabe angehängt hatte, galt als unberührt, und das Wiedereröffnen ließ diese als eigenständiges Ticket zurück.
- **§3, Entfernen:** Nimmt das Wiedereröffnen des direkten Vorgängers (Nachtrag 4) ein unberührtes Folgeticket zurück, löscht der Hook in derselben Transaktion zuerst seine Unteraufgaben und dann das Folgeticket, beide endgültig mit `@recurrence_undo` (Nachtrag 3: es war nie bearbeitet). Ohne das erste würde PocketBase nur `parent` der Unteraufgaben leeren und sie als eigenständige Tickets zurücklassen. Ist es berührt, lehnt der Hook wie bisher mit `validation_recurrence_open_instance` und dem Key ab.
- **§5, Bearbeiten:** Die Liste gehört zur Vorlage: Ändern wirkt nur auf künftige Tickets, die Unteraufgaben des offenen Tickets bleiben, wie sie sind; `next_due` bleibt.
- **Vorlage am Ticket (Nachtrag 6):** Der Editor unter „Künftige Tickets“ (Panel und Vollansicht, inline) und das Regel-Panel zeigen nach der Migration die Liste „Unteraufgaben“ (`TemplateSubtaskList` in `RecurrenceTemplateFields`): je Zeile Titel (Pflicht, sonst „Bitte einen Titel eingeben.“ an der Zeile, vor dem Senden) und Priorität, „Unteraufgabe hinzufügen“, je Zeile die Symbolknöpfe „… nach oben verschieben“, „… nach unten verschieben“ und „… entfernen“ (benannt mit dem Titel, an den Enden gesperrt, aber fokussierbar; der Fokus bleibt bei der verschobenen Zeile, eine höfliche Statusmeldung sagt „„Entkalken“ an Position 2 von 3 verschoben.“), höchstens 20. Kein Ziehen: Knöpfe gehen mit Tastatur und Screenreader gleich. Die Zeile „Künftige Tickets“ nennt „· 3 Unteraufgaben“.
- **„Unteraufgaben dieses Tickets übernehmen“** (nur im Editor am Ticket, nur wenn das Ticket Unteraufgaben hat): füllt die Liste mit allen Unteraufgaben des Tickets (offene und erledigte, Titel und Priorität, in der Reihenfolge ihrer Anlage). Eine leere Liste füllt es sofort. Steht schon etwas darin, fragt es **inline** in der Liste „Die Vorlage hat schon 2 Unteraufgaben. Sollen die 3 Unteraufgaben dieses Tickets dazukommen oder sie ersetzen?“ mit „Ergänzen“ (Fokus, hängt nur Titel an, die die Liste noch nicht hat, ohne Groß-/Kleinschreibung), „Ersetzen“ und „Abbrechen“ (Esc schließt nur die Frage). Begründung: Ersetzen ohne Frage würde Einträge still verlieren, Ergänzen ohne Frage bei einer geänderten Liste doppeln; gefragt wird nur, wenn etwas verloren gehen könnte, und nie in einem Dialog (die Vollansicht ist einer, [ADR-0025](0025-ui-konsistenz-overlay-system.md) Nachtrag 16). Was nicht mehr passt (über 20), nennt die Statusmeldung. Gespeichert wird erst mit „Vorlage speichern“. „Wiederholen…“ übernimmt die Unteraufgaben eines Tickets nicht von selbst (keine stille Übernahme, wie beim Status); der Dialog sagt das, wenn das Ticket welche hat.
- **„Auch für künftige Tickets übernehmen“ (Nachtrag 6) beim Hinzufügen:** Legt der Nutzer an einem **offenen** Ticket einer Serie über „Unteraufgabe hinzufügen“ eine Unteraufgabe an, erscheint dasselbe Info-Flag „Nur dieses Ticket geändert.“ mit „Künftige Tickets von „Kaffeemaschine“ bekommen die Unteraufgabe „Entkalken“ nicht.“ und der Aktion „Auch für künftige Tickets übernehmen“, die sie mit Titel und Priorität an die Liste der Vorlage anhängt (`RecurrenceStore.offerSubtask`, rein `subtaskOffer`). Weitere Unteraufgaben derselben Serie, solange das Flag steht, kommen in dasselbe Angebot („… die Unteraufgaben „A“ und „B“ nicht.“), denn das Feld bleibt für die nächste offen; ein anderes Angebot ersetzt es. Kein Angebot, wenn die Vorlage den Titel schon hat, voll ist, das Ticket erledigt ist oder in keiner Serie, und vor der Migration. **Entfernen oder Umbenennen** einer Unteraufgabe am Ticket bietet nichts an: Das sind Korrekturen an diesem einen Ticket (ein erledigtes oder unnötiges Häkchen dieses Termins), und eine Zuordnung „diese Unteraufgabe ist jener Eintrag der Vorlage“ gibt es nicht verlässlich (Titel lassen sich ändern, Einträge doppeln). Die Vorlage bearbeitet der Nutzer dafür direkt (Editor am Ticket oder Regel-Panel). Andere Wege, die eine Unteraufgabe entstehen lassen („Übergeordnet: Festlegen …“, Duplizieren mit „Unter HAUS-12 einordnen“), bieten ebenfalls nichts an: Sie hängen ein vorhandenes oder kopiertes Ticket an, keine neue Aufgabe der Routine.
- **Duplizieren ([ADR-0045](0045-ticket-duplizieren.md))** bleibt unverändert: Die Serie kommt nie mit; die Unteraufgaben eines Folgetickets kopiert es nur nach Wahl als normale Unteraufgaben.
- Belegt in `recurrence-subtasks.test.mjs` („removes an untouched follow-up together with its sub-tasks; looking at them changes nothing“, „keeps a follow-up whose sub-tasks the user changed, commented, completed, removed, moved out or added to“), `recurrence-rules.test.mjs`, `template-subtask-list.test.ts`, `recurrence-summary.test.ts` (auch in der Vollansicht ohne Dialog aus dem Dialog), `recurrence-panel.test.ts`, `series-template-offer.test.ts`, `recurrence-store.test.ts` und `series-template.test.ts`.
