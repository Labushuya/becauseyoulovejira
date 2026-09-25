# ADR-0023: Lebenszyklus von Regeln und Instanzen: Anlegen, Erledigen, Rückgängig, Pausieren, Bearbeiten, Löschen

- **Status:** Vorgeschlagen (wird mit der Antwort auf OF-E5-4 im [E5-Plan](../plan/e5.md) angenommen)
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
