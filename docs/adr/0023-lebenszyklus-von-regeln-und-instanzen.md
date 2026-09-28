# ADR-0023: Lebenszyklus von Regeln und Instanzen: Anlegen, Erledigen, Rückgängig, Pausieren, Bearbeiten, Löschen

- **Status:** Angenommen (2026-09-26: Der Nutzer hat die Empfehlungen zu OF-E5-1 bis OF-E5-5 bestätigt; umgesetzt in E5, siehe Nachtrag am Ende)
- **Datum:** 2026-09-25
- **Entscheidung durch:** Advisor
- **Ergänzt:** [ADR-0021](0021-regelmodell-wiederkehrende-aufgaben.md) (Regelmodell), [ADR-0022](0022-erzeugung-von-instanzen.md) (Erzeugung)

## Kontext

Die Invariante „höchstens eine offene Instanz pro Regel“ ([ADR-0022](0022-erzeugung-von-instanzen.md) §1) muss jeden Weg überstehen, den der Nutzer in der Oberfläche gehen kann:

- Das Häkchen in der Tabelle schreibt den Status sofort, und „Rückgängig“ stellt den vorigen Status innerhalb von 5 s wieder her (`UNDO_WINDOW_MS`, OF-E2-3). Beim Erledigen entsteht aber schon das Folgeticket.
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
  - Der Fall ist das versehentliche Häkchen, und die Serie steht danach genau wie vorher.
- **Folgeticket schon bearbeitet:** Das Wiedereröffnen wird mit dem Feldfehler `validation_recurrence_open_instance` abgelehnt. Die Meldung lautet: „Von dieser Serie ist schon HAUS-12 offen. Erledige es zuerst oder löse ein Ticket aus der Serie.“ Das ist ein echter, abgelehnter Wunsch, also Fehlerfarbe nach [ADR-0009](0009-fehlerfarbe.md). Die Invariante bleibt hart.
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
  - `after_completion`: `next_due = afterCompletion(rule, heute)`, als wäre die Instanz heute erledigt worden. So erscheint nicht sofort ein neues Ticket.
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
