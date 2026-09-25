# ADR-0022: Erzeugung der Tickets aus Regeln: Zeitpunkt, Cron, Nachholen beim Start, keine Duplikate

- **Status:** Vorgeschlagen (wird mit den Antworten auf OF-E5-1 und OF-E5-2 im [E5-Plan](../plan/e5.md) angenommen)
- **Datum:** 2026-09-25
- **Entscheidung durch:** Advisor
- **Ergänzt:** CLAUDE.md §6, [ADR-0005](0005-zeitzone-europe-berlin.md) (Zeitzone, Cron in UTC), [ADR-0021](0021-regelmodell-wiederkehrende-aufgaben.md) (Regelmodell)

## Kontext

CLAUDE.md §6 legt fest:

- Pro Regel gibt es höchstens eine offene Instanz (Status ≠ `done`), und die Erzeugung ist idempotent.
- Auslöser sind das Erledigen der aktuellen Instanz (Hook), ein Cron-Hook für Kalenderregeln und das Nachholen beim Serverstart.
- Verpasste Termine ergeben genau **eine** Instanz mit dem jüngsten fälligen Termin, keine Stapel.

Randbedingungen:

- Die App läuft auf einem Windows-PC, der oft aus ist. Cron-Ausdrücke gelten in UTC, und die JSVM kennt keine Berliner Zeitzone ([ADR-0005](0005-zeitzone-europe-berlin.md)).
- Create und Update über die Record-API laufen in PocketBase 0.40.4 nicht in einer Transaktion. Mehrere Schreibvorgänge öffnet der Hook über `inTransaction` (CLAUDE.md §3). Ein Ticket, das über `txApp.save()` entsteht, durchläuft die Model-Hooks von `tickets`: Key, Scope, Historie und `completed_at`.
- Der Cron-Job `byl-inbox-cleanup` läuft nur um 11:30 UTC. Ist die App dann aus, bleibt die Bereinigung liegen ([E4-Plan](../plan/e4.md) §9 und §12).
- Die Instanz des Nutzers läuft aus demselben Ordner `app/`. Neue Hooks wirken sofort, neue Migrationen erst nach einem Neustart. Jeder Hook muss also auch auf dem alten Schema laufen.

## Entscheidung

### 1. Zustand der Regel

- `next_due` ist die Fälligkeit des **nächsten noch nicht erzeugten** Tickets.
  - Bei `calendar` ist das Feld bei einer aktiven Regel immer gesetzt. Das zeigt die Oberfläche als „Nächstes Ticket am …“.
  - Bei `after_completion` ist es leer, solange eine offene Instanz existiert, denn der Termin hängt vom Erledigen ab.
- **Offene Instanz:** ein Ticket mit `recurrence = <Regel>` und `status != done`.
- **Invariante:** Pro Regel gibt es höchstens eine offene Instanz.
  - Der Erzeugungsdienst prüft das in seiner Transaktion.
  - Als Sicherheitsnetz dient ein eindeutiger Teilindex `CREATE UNIQUE INDEX idx_tickets_open_recurrence ON tickets (recurrence) WHERE recurrence != '' AND status != 'done'` (Migration `1790201510_tickets_open_recurrence.js`).
  - Nimmt PocketBase den Teilindex nicht an, bleibt die Prüfung im Dienst allein. Paket 2 klärt das per Migrationstest und hält das Ergebnis im Plan fest.

### 2. Der Erzeugungsdienst `app/pb_hooks/lib/recurrence-service.js`

`materialize(app, ruleId, today)` läuft in **einer** eigenen Transaktion und tut der Reihe nach:

1. Regel neu lesen. Nichts tun, wenn eine dieser Bedingungen gilt:
   - Die Regel ist inaktiv.
   - `next_due` ist leer.
   - Es gibt schon eine offene Instanz.
   - Es gilt `today < next_due - lead_days`.
2. Fälligkeit bestimmen:
   - `calendar`: `due = catchUp(rule, next_due, today)` (§3).
   - `after_completion`: `due = next_due`.
3. Ticket anlegen:
   - Aus der Vorlage kommen `title`, `description`, `project`, `tags` und `priority`; ohne Priorität gilt `medium`.
   - Dazu `status = open`, `due`, `recurrence` sowie `owner` und `household` der Regel.
   - `source` bleibt leer, das Ticket zählt in der Quellen-Familie als „Manuell“ ([ADR-0019](0019-kanal-filter-und-gruppierung.md)). Das Merkmal „wiederkehrend“ ist das eigene Symbol in der Titelzelle.
   - Key, Scope, Historie und „Neu“-Markierung entstehen wie bei jedem Ticket.
4. Regel fortschreiben:
   - `next_due` = bei `calendar` `after(rule, due)`, bei `after_completion` leer.
   - `last_generated_at` = jetzt.
   - `last_hint` leeren.
5. Kann das Ticket nicht entstehen, gilt je nach Grund:
   - **Projekt archiviert:** Der Dienst pausiert die Regel (`active = false`) und setzt `last_hint = "Projekt archiviert – Regel pausiert."`.
   - **Anderer Fehler:** Der Dienst schreibt einen bereinigten Hinweis und ins Log. Die Regel bleibt aktiv, und der nächste Lauf versucht es erneut.
   - In beiden Fällen gilt: Der Dienst wirft nie über seine Transaktion hinaus.

`runDue(app, nowMs)` bestimmt `today = berlinToday(nowMs)`. Dann lädt es alle Regeln mit `active = true && next_due != "" && next_due <= {:limit}`, parametrisiert mit `limit = today + 30` (größter Vorlauf). Jede Regel läuft über `materialize`, jeweils einzeln abgesichert: Ein Fehler bei einer Regel hält die anderen nicht auf.

### 3. Verpasste Vorkommen (OF-E5-2)

Liegen zwischen `next_due` und heute weitere Vorkommen, entsteht **ein** Ticket mit dem **jüngsten** Vorkommen ≤ heute (CLAUDE.md §6).

- Beispiel „jeden Montag“, zuletzt erzeugt für Montag, den 07.09., und der PC war bis Mittwoch, den 23.09., aus: Es entsteht ein Ticket für Montag, den 21.09. (überfällig), und `next_due` wird Montag, der 28.09.
- Dasselbe gilt beim Erledigen: Wird die Instanz vom 07.09. erst am 23.09. erledigt, folgt das Ticket vom 21.09.
- Bei `after_completion` gibt es keine verpassten Vorkommen, denn der nächste Termin hängt am Erledigen.

### 4. Auslöser

| Auslöser | Wo | Was |
|---|---|---|
| Erledigen | `tickets.pb.js`: `onRecordUpdate` (in der Transaktion der Änderung) und `onRecordAfterUpdateSuccess` | Wechselt eine Instanz nach `done`, setzt der Update-Hook in derselben Transaktion bei `after_completion` `next_due = afterCompletion(rule, berlinDate(completed_at))`. Nach dem Commit ruft der After-Success-Hook `materialize` für die Regel auf. Das Erledigen scheitert nie an der Erzeugung: Schlägt sie fehl, holt der nächste Cron-Lauf sie nach. |
| Cron | `recurrence.pb.js`: `cronAdd('byl-recurrence', '7 * * * *', …)` | stündlich in UTC `runDue($app, Date.now())`. Stündlich statt täglich, weil ein Berliner Tageswechsel je nach Sommerzeit auf 22:00 oder 23:00 UTC fällt ([ADR-0005](0005-zeitzone-europe-berlin.md) §5). Ein Ticket mit Vorlauf 0 erscheint so spätestens gut eine Stunde nach Berliner Mitternacht. |
| Start | `recurrence.pb.js`: Handler nach `e.next()` im ersten Start-Hook, in dem das migrierte Schema sichtbar ist (`onBootstrap` oder `onServe`; Paket 3 prüft die Reihenfolge von Migrationen und Hooks in 0.40.4 per Integrationstest) | `runDue` und `inbox-cleanup-service.run` nacheinander, jeweils in `try/catch` mit Log. Der Handler wirft nie, damit ein Fehler den Serverstart nicht verhindert. So läuft auch die Bereinigung verworfener Einträge nach, wenn die App um 11:30 UTC aus war. |
| „Jetzt erzeugen“ | keiner | Nicht vorgesehen. Die Übersicht zeigt „Nächstes Ticket am …“, und das reicht. |

Vor der Migration von E5 tun alle drei nichts: Fehlt `freq` in `recurrence_rules`, beenden sich Dienst und Hooks sofort.

### 5. Keine Duplikate

- **Prüfen und Anlegen in einer Schreibtransaktion:** PocketBase serialisiert Schreibtransaktionen auf SQLite. Laufen Cron, Start und Erledigen gleichzeitig, sieht der zweite Lauf die Instanz des ersten und tut nichts.
- **Wiederholte Läufe** (zweimal Start, Cron direkt nach dem Start, zwei Cron-Läufe) erzeugen nichts Neues. Die Integrationstests rufen dafür `POST /api/crons/byl-recurrence` mehrfach und parallel auf.
- **Der Teilindex (§1) ist das Sicherheitsnetz:** Ein Verstoß bricht nur die eine Transaktion ab. Er wird als „schon vorhanden“ gewertet, nicht als Fehler.

### 6. Zeitzone

„Heute“ kommt immer aus `berlin-time.js` (`berlinToday`). Das Erledigungsdatum ist das Berliner Datum von `completed_at`: Wer am 01.03. um 00:30 Berliner Zeit erledigt, erledigt am 01.03., auch wenn UTC noch der 28.02. ist. Tests prüfen das an beiden Umstellungstagen.

## Alternativen

- **Nächstes Ticket erst am Fälligkeitstag bzw. sofort nach dem Erledigen, ohne Vorlauf:** Das ist einfacher, aber entweder sieht man die Aufgabe nicht kommen, oder eine Jahresaufgabe steht ein Jahr lang in „offen“ und im Zähler. Der Vorlauf pro Regel deckt beides ab (OF-E5-1). Mit Vorlauf 0 bzw. einem Vorlauf größer als das Intervall ergibt er genau diese beiden Varianten.
- **Erzeugung in derselben Transaktion wie das Erledigen:** Das wäre atomar, aber ein Fehler bei der Erzeugung (etwa ein archiviertes Projekt) würde das Erledigen verhindern. Verworfen. Der Folgetermin wird atomar mit dem Erledigen gespeichert, das Ticket danach, und der Cron holt es notfalls nach.
- **Stapel verpasster Tickets:** Das widerspricht CLAUDE.md §6. Verworfen.
- **Verpasste überspringen (nur der nächste künftige Termin):** Das ist die Alternative zu §3 und hängt an OF-E5-2.
- **Nachholen nur per Cron:** Ist der PC morgens kurz an und um xx:07 schon wieder aus, fehlt das Ticket. Das Nachholen beim Start kostet wenig. Verworfen.
- **Eigener Zähler oder Sperrtabelle gegen Duplikate:** Nicht nötig, das leisten die Schreibtransaktion und der Teilindex.

## Konsequenzen

- Positiv: Tickets erscheinen verlässlich, auch nach langem Ausfall, und nie doppelt. Das Erledigen bleibt schnell und kann nicht an der Erzeugung scheitern. Die Bereinigung des Eingangs läuft endlich auch nach, wenn die App mittags aus war.
- Negativ: Zwischen dem Erledigen und dem Folgeticket liegt ein zweiter Commit. Scheitert er, kommt das Ticket erst mit dem nächsten Cron-Lauf, spätestens nach einer Stunde.
- Die Integrationstests brauchen ein steuerbares „jetzt“. Der Dienst nimmt `nowMs` als Parameter. Die Tests nutzen zwei Wege:
  - Sie rufen ihn über eine reine Test-Route in einer Hook-Datei unter `tests/fixtures/pb_hooks/` auf. Der Harness kopiert sie nur in die Wegwerf-Instanz, wie `fault-injection.pb.js`, und nie in `app/`.
  - Oder sie datieren `next_due` bzw. `completed_at` in `data.db` der Wegwerf-Instanz zurück, wie bei `byl-inbox-cleanup` (BYL-E4-040).
