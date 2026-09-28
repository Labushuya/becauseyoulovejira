# ADR-0022: Erzeugung der Tickets aus Regeln: Zeitpunkt, Cron, Nachholen beim Start, keine Duplikate

- **Status:** Angenommen (2026-09-26: Der Nutzer hat die Empfehlungen zu OF-E5-1 bis OF-E5-5 bestätigt; umgesetzt in E5, siehe Nachtrag am Ende)
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

## Nachtrag (2026-09-26, Umsetzung E5)

Der Text oben bleibt unverändert. Wo die Umsetzung abweicht, gilt dieser Nachtrag. Einzelheiten stehen im [E5-Plan](../plan/e5.md) §7, Pakete 2 und 3.

- **§1, Teilindex:** PocketBase 0.40.4 nimmt ihn an (`collection.addIndex(name, unique, columns, where)`), die Migration heißt `1790201610_tickets_open_recurrence.js`. Vorher löst sie mehrere offene Tickets derselben Regel auf; nur das jüngste bleibt in der Serie. Ein Verstoß über die Record-API kommt als Feldfehler „recurrence: Value must be unique.“ und zählt im Dienst als „schon vorhanden“.
- **§4, Start:** Die JSVM von 0.40.4 kennt **kein `onServe`**. Ein Aufruf wirft beim Laden der Hook-Datei. `pocketbase serve` führt ausstehende Migrationen erst nach `onBootstrap` aus. Das Nachholen läuft deshalb nach `e.next()` von `onBootstrap`, nur beim Befehl `serve` (`$os.args`) und in `try/catch`. Beim ersten Start nach einem Update mit neuen Migrationen sieht es noch das alte Schema und tut nichts. Spätestens nach gut einer Stunde holt der Cron nach. Belegt in `recurrence-startup.test.mjs`.
- **§2, verschachtelte Transaktion:** Der Ticket-Hook öffnet in `materialize` erneut `inTransaction`, und PocketBase führt sie auf der äußeren aus. Key, Historie und Ticket landen im selben Commit. Scheitert ein Teil, bleiben Nummer und `next_due` unverbraucht (Fehlerinjektion in `recurrence-generate.test.mjs`).
- **§2, Zeitstempel:** PocketBase liest die Uhr je Autodate-Feld einzeln, deshalb wichen `created` und `updated` gelegentlich um 1 ms ab. Der Dienst schreibt beide Felder mit einem gemeinsamen Zeitstempel (`newInstance`, `record.setRaw`), sonst würde ADR-0023 §3 ein frisches Folgeticket für bearbeitet halten. Das zweistufige Anlegen aus einer Kalenderserie ([ADR-0024](0024-serien-aus-kalendern.md)) erzeugt kein Ticket auf einem neuen Weg und braucht das nicht (`web-data-recurrence.test.mjs`).
- **Historie:** Der Eintrag „created“ eines erzeugten Tickets hat keinen Nutzer und die Regel als `old_value`. Daran erkennt die SPA „Wiederholung“ als Urheber.
- **Neue oder fortgesetzte Regeln** erzeugen nach dem Commit sofort, wenn ihr Termin schon im Vorlauf liegt. Das gilt nicht für Schreibvorgänge des Servers oder eines Superusers.

## Nachtrag 2 (2026-09-28, Plan „Offene Reste“, OR-5): „Jeden Termin einzeln anlegen“

Nutzerentscheidung vom 2026-09-28, eine bewusste Änderung der Regel „höchstens eine offene Instanz je Regel“ (§1, §3). Der Text oben und der erste Nachtrag bleiben; sie gelten weiter für jede Regel, die den Schalter nicht trägt.

- **Schalter pro Regel:** `recurrence_rules.each_occurrence` (bool, Standard aus). Aus: alles wie oben, höchstens ein offenes Ticket, verpasste Termine zum jüngsten zusammengefasst. An: jeder Termin bekommt ein eigenes Ticket, auch wenn frühere noch offen sind. Nur bei festem Rhythmus; „nach Erledigung“ kennt nur einen nächsten Termin, der Hook lehnt den Schalter dort mit `validation_recurrence_each_mode` ab.
- **Erzeugen (§2, §3):** `generationEach` (rein, `lib/recurrence-rules.js`) liefert ab `next_due` jeden Termin, dessen Vorlauf erreicht ist, ältester zuerst; offene Instanzen spielen keine Rolle. `next_due` rückt in derselben Transaktion hinter den letzten, so entsteht kein Termin zweimal. Die Schleife läuft über Termine der Serie, nicht über Tage.
- **Obergrenze pro Lauf:** `EACH_MAX_PER_RUN = 20` Tickets je Regel und Lauf. Nach einem langen Ausfall kommen die Termine in Stapeln zu 20, der nächste Lauf (stündlich) setzt fort; solange noch welche warten, steht an der Regel der neutrale Hinweis „Viele Termine auf einmal: 20 Tickets angelegt, die übrigen folgen beim nächsten Lauf (stündlich).“, der nächste vollständige Lauf leert ihn. `runDue` zählt neben den Regeln (`created`) die Tickets (`tickets`).
- **Datum der Serie am Ticket:** `tickets.occurrence` (Datum) trägt den Termin, für den der Dienst das Ticket erzeugt hat, nur mit dem Schalter; jedes andere Ticket hat es leer. Nur der Server schreibt es: Werte eines Clients verwirft der Request-Hook still, „Aus der Serie lösen“ leert es mit.
- **Eindeutiger Index (§1, §5):** Migration `1790202200_recurrence_each_occurrence.js` ersetzt `idx_tickets_open_recurrence` durch `CREATE UNIQUE INDEX idx_tickets_open_occurrence ON tickets (recurrence, occurrence) WHERE recurrence != '' AND status != 'done'`. Ohne Schalter haben alle Instanzen ein leeres `occurrence`, der Index lässt also weiter nur eine offene je Regel zu; mit Schalter eine offene je Termin. Die Prüfung im Dienst bleibt: ohne Schalter „keine offene Instanz“ in der Transaktion wie bisher, mit Schalter „für diesen Termin gibt es kein offenes Ticket“ (sonst wird er übersprungen). Ein Verstoß zählt weiter als „schon vorhanden“ (`isOpenInstanceConflict` kennt beide Felder).
- **Warum ein eigenes Feld statt `(recurrence, due)`:** Der Auftrag schlug einen Index über `(recurrence, due)` vor. Die Fälligkeit darf der Nutzer aber ändern: Wer das Ticket vom Montag auf den Mittwoch schiebt, an dem schon eines offen ist, bekäme eine unverständliche Ablehnung, und zwei offene Tickets ohne Fälligkeit wären unmöglich. Ohne Schalter wäre die Regel „eine offene je Regel“ außerdem nur noch im Dienst gesichert. Weitere geprüfte Wege: den alten Index nur für Regeln ohne Schalter behalten (ein Teilindex kann keine andere Tabelle fragen, das bräuchte eine an jedem Ticket gepflegte Kopie des Schalters, die beim Umschalten alle Tickets ändert), gar kein Index (nur noch der Dienst, kein Sicherheitsnetz), ein Index über einen Ausdruck (braucht dieselbe Kopie). `occurrence` ist unveränderlich, gehört nur dem Server und hält beide Modi mit einem Index hart.
- **Rhythmus ändern (ADR-0023 §5):** Mit Schalter rechnet `next_due` ab dem spätesten Termin der offenen Tickets (`occurrence`), nicht ab einer von Hand verschobenen Fälligkeit, damit kein Termin mit Ticket zurückkommt.
- **Rückweg der Migration:** Der alte Index erlaubt eine offene Instanz je Regel. Hat eine Regel bis dahin mehrere, bleibt das jüngste offene Ticket (nach `created`, dann `id`) in der Serie, die älteren offenen werden normale Tickets (nur die Spalte `recurrence`, wie 1790201610; `updated` und Verlauf bleiben), die Zahl steht im Log. Danach entfallen Index, beide Felder, und der alte Index kommt zurück. Belegt mit Daten in `migrations-rollback.test.mjs`.
- **Vor der Migration** (Instanz noch ohne Neustart): Die Hooks prüfen `eachReady` (beide Felder da) und verhalten sich wie vorher; ein gesendetes `each_occurrence` ignoriert PocketBase. Die SPA fragt das über einen Filter auf `each_occurrence` ab (400 vor der Migration) und zeigt den Schalter erst danach (`hooks-before-migration.test.mjs`).
- **Zeitstempel:** Auch mehrere Tickets eines Laufs bekommen je einen gemeinsamen Wert in `created` und `updated` (`newInstance`, Nachtrag oben).

## Nachtrag 3 (2026-09-28, Papierkorb, ADR-0037): Index ohne Tickets im Papierkorb

- Migration `1790202300_tickets_trash.js` ergänzt den Teilindex um den Papierkorb: `UNIQUE (recurrence, occurrence) WHERE recurrence != '' AND status != 'done' AND deleted_at = ''`. Das Verschieben leert `recurrence` und `occurrence` ohnehin (Schnappschuss im Ticket); die Bedingung hält den Index für jede Zeile richtig, auch wenn eine Zeile im Papierkorb eine Regel trägt.
- Die Erzeugung braucht keine Änderung: Eine Instanz im Papierkorb hat keine Regel mehr, zählt also für „offene Instanz“ und „Termin hat ein Ticket“ nicht. Wie nach dem Hartlöschen entsteht die nächste Instanz zum nächsten Termin (ADR-0023 §6), nie sofort.
- Der Rückweg stellt den Index von Nachtrag 2 wieder her.
