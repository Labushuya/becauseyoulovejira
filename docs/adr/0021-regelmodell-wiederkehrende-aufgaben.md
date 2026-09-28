# ADR-0021: Regelmodell der wiederkehrenden Aufgaben und reine Terminberechnung

- **Status:** Angenommen (2026-09-26: Der Nutzer hat die Empfehlungen zu OF-E5-1 bis OF-E5-5 bestätigt; umgesetzt in E5, siehe Nachtrag am Ende)
- **Datum:** 2026-09-25
- **Entscheidung durch:** Advisor
- **Ergänzt:** CLAUDE.md §6 (wiederkehrende Aufgaben), [ADR-0005](0005-zeitzone-europe-berlin.md) (Zeitzone)

## Kontext

CLAUDE.md §6 legt das Prinzip fest: Eine Regel ist eine Vorlage und erzeugt Tickets (Instanzen). Es gibt zwei Modi:

- `calendar`: eine selbst implementierte RRULE-Teilmenge, also täglich, wöchentlich mit Wochentagen, monatlich am Tag des Monats oder am letzten Tag, jährlich, jeweils mit Intervall.
- `after_completion`: Die nächste Fälligkeit ist das Erledigungsdatum plus das Intervall.

Die Berechnung liegt in `app/pb_hooks/lib/recurrence.js`. Das Modul ist rein, ES5, CommonJS und ohne Abhängigkeiten, und „heute“ ist ein Parameter.

Stand der Daten (Migration `1790200400_create_recurrence_rules.js`, E1):

- Vorhanden sind nur die Grundfelder: `title`, `description`, `project`, `tags`, `priority`, `mode` (`calendar` | `after_completion`), `next_due`, `last_generated_at`, `active`, `owner` und `household`.
- Die Regelparameter sollten laut Migration additiv nachkommen. Das ist bis E4 nicht passiert.
- `recurrence_rules` hat kein Feld `scope`, anders als `projects`, `tags`, `tickets`, `inbox_items` und `connections`.
- `tickets.recurrence` verweist ohne Cascade auf die Regel. Der Ticket-Hook prüft schon, dass die Regel im selben Scope liegt (`ticket-service.js`, `checkRelations`).
- Die API-Regeln für `recurrence_rules` gleichen denen von `tickets` (`1790200900_api_rules.js`). Ohne UI gibt es in der Praxis keine Regeln. Die Migration muss trotzdem mit vorhandenen, unvollständigen Zeilen umgehen.

CLAUDE.md §10 verbietet einen generischen Regel-Editor. Der Nutzer soll Rhythmen wählen, keine RRULE schreiben.

## Entscheidung

### 1. Felder der Regel (additive Migration `1790201500_recurrence_rule_params.js`)

| Feld | Typ | Bedeutung |
|---|---|---|
| `freq` | select `daily` \| `weekly` \| `monthly` \| `yearly`, Pflicht (Hook) | Einheit des Rhythmus. Bei `after_completion` ist es die Einheit des Abstands („3 Tage“, „2 Wochen“, „1 Monat“ nach Erledigung). |
| `interval` | number, ganzzahlig, 1 bis 365, Standard 1 | „alle n Einheiten“ |
| `weekdays` | select mehrfach `MO` … `SU` | Nur bei `calendar` + `weekly`. Der Hook füllt leere Werte mit dem Wochentag von `anchor`. Die Kürzel folgen RFC 5545, das vereinfacht die Übernahme aus `RRULE` ([ADR-0024](0024-serien-aus-kalendern.md)). |
| `month_day` | number, `-1` oder 1 bis 31 | Nur bei `calendar` + `monthly`. `-1` bedeutet „letzter Tag des Monats“. Der Hook füllt leere Werte mit dem Tag von `anchor`. |
| `anchor` | date (Kalenderdatum) | „Beginnt am“. Das ist der Bezugspunkt für Intervalle, bei `yearly` auch für Monat und Tag. Pflicht; der Hook setzt das Berliner „heute“, wenn das Feld fehlt. |
| `lead_days` | number, ganzzahlig, 0 bis 30, Standard 3 | Vorlauf: So viele Tage vor seiner Fälligkeit entsteht das Ticket ([ADR-0022](0022-erzeugung-von-instanzen.md), OF-E5-1) |
| `scope` | text (Hook) | wie bei `tickets`, `u:<owner>` bzw. `h:<household>` |
| `last_hint` | text, max. 500 (Hook) | neutraler Hinweis zum letzten Erzeugungsversuch, etwa „Projekt archiviert, Regel pausiert“; leer, wenn alles gut ging |

Die vorhandenen Felder bleiben, mit dieser Bedeutung:

- `next_due`: Fälligkeit des nächsten noch nicht erzeugten Tickets, siehe [ADR-0022](0022-erzeugung-von-instanzen.md) §1.
- `last_generated_at`: UTC-Zeitpunkt der letzten Erzeugung.
- `active`: Regel läuft bzw. ist pausiert. Neue Regeln sind aktiv, außer der Client sendet ausdrücklich `false`. Den Standard setzt der Request-Hook wie bei `blocks_parent`.

Weitere Festlegungen:

- **Nur der Server schreibt** `next_due`, `last_generated_at`, `scope` und `last_hint`. Werte des Clients überschreibt der Hook (wie `completed_at`).
- **Indizes:** `(scope)` sowie `(active, next_due)`; letzterer ist schon vorhanden.
- **Vorhandene Zeilen:** Die Migration ergänzt die Felder. Zeilen ohne gültige Parameter setzt sie auf `active = false` und schreibt `last_hint = "Regel unvollständig – bitte Rhythmus wählen."`. Der Rückweg entfernt nur die neuen Felder und Indizes; die Grundfelder und ihre Werte bleiben.

### 2. Bedeutung der Parameter

Alle Rechnungen arbeiten auf Kalenderdaten `YYYY-MM-DD`, ohne Uhrzeit und ohne Zeitzone. „Heute“ ist das Berliner Datum aus `berlin-time.js` ([ADR-0005](0005-zeitzone-europe-berlin.md)).

**`calendar`:** Die Vorkommen sind alle Daten ab `anchor` (einschließlich), die den Rhythmus treffen:

- `daily`: `anchor + k · interval` Tage.
- `weekly`: Die Wochen beginnen am Montag (ISO). Es zählen die Wochen, deren Abstand zur Woche von `anchor` ein Vielfaches von `interval` ist, und darin die Tage aus `weekdays`. Werktags ist also `weekly` mit `MO`–`FR`.
- `monthly`: Es zählen die Monate, deren Abstand zum Monat von `anchor` ein Vielfaches von `interval` ist.
  - Der Tag ist `month_day`, und `-1` ist der letzte Tag.
  - **Klemmen:** Hat ein Monat den Tag nicht (etwa den 31. im April), gilt sein letzter Tag. Eine Aufgabe „am 31.“ fällt damit nie aus. RFC 5545 würde den Monat überspringen; für Aufgaben wie „Miete zahlen“ ist das falsch.
- `yearly`: Es zählen die Jahre, deren Abstand zum Jahr von `anchor` ein Vielfaches von `interval` ist, mit Monat und Tag von `anchor`. Der 29.02. wird in Nicht-Schaltjahren zum 28.02.

**`after_completion`:** Nächste Fälligkeit = Berliner Datum von `completed_at` + `interval` Einheiten.

- Bei Monaten und Jahren wird wie oben geklemmt (31.01. + 1 Monat = 28.02. bzw. 29.02.). Ausgangspunkt bleibt dabei immer das Erledigungsdatum, es wird nicht von einem geklemmten Datum weitergerechnet.
- `weekdays` und `month_day` müssen leer sein.
- `anchor` ist die Fälligkeit des ersten Tickets, wenn die Regel ohne vorhandenes Ticket angelegt wird.

### 3. Das reine Modul `app/pb_hooks/lib/recurrence.js`

ES5, CommonJS, ohne `require`. Es rechnet mit `Date.UTC` und `getUTC*`, nie mit lokalen oder Zeitzonen-Funktionen der Laufzeit. Das prüft `hooks-lib-constraints.test.mjs`. Schnittstelle (Daten als `YYYY-MM-DD`):

| Funktion | Ergebnis |
|---|---|
| `normalize(rule)` | Regel mit Standardwerten: `interval` 1, `weekdays` bzw. `month_day` aus `anchor`, `lead_days` 3 |
| `validate(rule)` | Feldfehler `{ feld: code }` mit Codes `validation_recurrence_*` (Rhythmus fehlt, Intervall außerhalb, Wochentage bzw. Monatstag im falschen Modus, ungültiges Datum, Vorlauf außerhalb) |
| `onOrAfter(rule, date)` | erstes Vorkommen ≥ `date` (nur `calendar`) |
| `after(rule, date)` | erstes Vorkommen > `date` (nur `calendar`) |
| `latestOnOrBefore(rule, date)` | letztes Vorkommen ≤ `date` oder `null` (nur `calendar`) |
| `afterCompletion(rule, completedDate)` | `completedDate` + Intervall (nur `after_completion`) |
| `catchUp(rule, pendingDue, today)` | `pendingDue`, wenn danach bis `today` kein weiteres Vorkommen liegt, sonst das jüngste Vorkommen ≤ `today` ([ADR-0022](0022-erzeugung-von-instanzen.md) §3) |
| `createOn(due, leadDays)` | Tag, ab dem das Ticket entsteht: `due - leadDays` |

- **Keine Schleife über Tage:** Die Funktionen springen rechnerisch zur passenden Periode (Tage, Wochen, Monate, Jahre seit `anchor`) und prüfen danach nur wenige Kandidaten. Ein Ausfall von zehn Jahren kostet damit nicht mehr als einer von einem Tag.
- **Spiegel in der SPA:** `web/src/lib/domain/recurrence.ts` hat dieselbe Schnittstelle, für die Vorschau „Nächste Termine“ und die Prüfung im Formular. Den Text des Rhythmus („Jeden Montag und Donnerstag“, „Monatlich am letzten Tag“, „3 Tage nach Erledigung“) erzeugt nur die SPA (`domain/recurrence-text.ts`).
- **Paritätstest** nach dem Muster von `keywords` ([ADR-0020](0020-stichwoerter-pro-kanal.md)):
  - Eine Falltabelle `tests/fixtures/recurrence/cases.json` läuft in beiden Suiten.
  - Dazu kommt `tests/unit/web-recurrence.test.mjs` mit zufälligen Regeln und Daten aus einem festen Seed.
- **Pflichtfälle** (CLAUDE.md §6):
  - Monatsenden: 31. in Monaten mit 30 Tagen und im Februar, `-1`, 30. im Februar.
  - Schaltjahre: 29.02. jährlich, 2100 ohne Schalttag, 2000 mit.
  - Sommerzeit: „heute“ bei 21:59, 22:00, 22:59 und 23:00 UTC an beiden Umstellungstagen, über `berlin-time.js`.
  - Lange Ausfälle: ein, drei und zehn Jahre, jeder Rhythmus.
  - Intervalle > 1 über Jahresgrenzen, Wochen mit mehreren Wochentagen und Intervall 2, `anchor` mitten in der Woche.

## Alternativen

- **RRULE als Text speichern und im Hook auswerten:** Das ist mächtig, aber der Hook müsste beliebige Regeln verstehen und prüfen. Die Oberfläche würde zum generischen Regel-Editor (CLAUDE.md §10). Verworfen. Die Übernahme aus Kalendern bildet auf die Felder ab ([ADR-0024](0024-serien-aus-kalendern.md)).
- **Parameter als ein JSON-Feld:** Das spart Schemaarbeit, aber PocketBase prüft dann keine Typen mehr, und Filter auf Felder gehen nicht. Verworfen.
- **Ohne `anchor`, immer von `next_due` weiterzählen:** Dabei geht die Information verloren, dass ein geklemmter 28.02. eigentlich ein 31. bzw. ein 29.02. war. Die Wochen eines zweiwöchigen Rhythmus würden nach einer Pause verrutschen. Verworfen.
- **Nicht existierende Monatstage überspringen (RFC 5545):** Das passt nicht zu Aufgaben, siehe §2. Verworfen. Übernahmen aus Kalendern mit `BYMONTHDAY` 29 bis 31 nennen das Klemmen sichtbar ([ADR-0024](0024-serien-aus-kalendern.md) §2).
- **n-ter Wochentag im Monat („2. Dienstag“):** Das steht nicht in CLAUDE.md §6 und hängt an OF-E5-3. Bei Bedarf kommt es später als additiver Wert dazu.

## Konsequenzen

- Positiv: Die Regel ist klein, typisiert und vollständig per Unit-Test prüfbar. Hook und SPA rechnen nachweislich gleich, und lange Ausfälle kosten keine Rechenzeit.
- Negativ: Zwei Implementierungen der Datumsrechnung. Der Paritätstest hält sie gleich, wie bei `keywords`.
- Die Migration braucht einen Rückweg-Test mit Daten (vorhandene unvollständige Regel, Ticket mit `recurrence`). Die Hooks müssen auch auf dem Schema vor der Migration laufen ([E4-Plan](../plan/e4.md) §12). Fehlt `freq` in der Collection, lassen sie Regeln unberührt und erzeugen nichts.

## Nachtrag (2026-09-26, Umsetzung E5)

Der Text oben bleibt unverändert. Wo die Umsetzung abweicht, gilt dieser Nachtrag. Einzelheiten stehen im [E5-Plan](../plan/e5.md) §7.

- **Migrationen:** Statt `1790201500_…` heißt die Migration `1790201600_recurrence_rule_params.js`, denn die Nummer 1790201500 ist seit E4 vergeben. Der Teilindex steht in `1790201610_tickets_open_recurrence.js`.
- **`scope`:** Das Feld ist Pflicht und wird wie bei Tickets vom Hook vor der Validierung gesetzt.
- **Leere Zahlen:** PocketBase speichert ein leeres Zahlenfeld als 0. Deshalb liest `normalize` `interval` 0 als 1 und `month_day` 0 als „nicht gesetzt“. `lead_days` 0 bleibt 0 („am Tag selbst“). `validate` prüft ohne Normalisierung und meldet 0 bei `interval` und `month_day` als Fehler.
- **`anchor`:** Gültig sind Jahre von 1900 bis 2999.
- **Fehlercodes:** `validation_recurrence_mode`, `_freq`, `_interval`, `_weekdays`, `_weekdays_mode`, `_month_day`, `_month_day_mode`, `_anchor` und `_lead_days`. Die Texte stehen einmal im Hook und einmal in der SPA, ein Paritätstest hält beide gleich.
- **Schnittstelle:** Zusätzlich gibt es `isValid`, `upcoming(rule, date, count)` für die Vorschau und `weekdayOf`. In der SPA heißen `normalize` und `validate` `normalizeRule` und `validateRule`.
- **Rechenweg:** Beide Module rechnen mit Tagesnummern und springen zur Periode, ohne Schleife über Tage. Neben dem Paritätstest mit 5 000 Zufallsregeln prüft ein Test 400 Zufallsregeln gegen eine tageweise Aufzählung der Definition aus §2.

## Nachtrag 2 (2026-09-28, Plan „Offene Reste“, OR-1 und OR-5)

- **Referenzrechner (OR-1):** Die tageweise Aufzählung der Definition aus §2 liegt jetzt als eigenes Modul nur für Tests in `tests/support/recurrence-reference.mjs` (`onOrAfter`, `after`, `latestOnOrBefore`, `upcoming`, `catchUp`, `afterCompletion`, `createOn`, alle Tag für Tag). `recurrence-reference.test.mjs` prüft beide Module dagegen, besonders wöchentliche Regeln mit mehreren Wochentagen (alle 127 Mengen), und bestätigt die erwarteten Werte der gemeinsamen Falltabelle.
- **Neues Feld (OR-5):** `each_occurrence` (bool, Standard aus) für „Jeden Termin einzeln anlegen“, nur bei `calendar` (sonst `validation_recurrence_each_mode`). Es gehört nicht zum Rhythmus: Umschalten rechnet `next_due` nicht neu, leert aber `last_hint`. Einzelheiten und der neue eindeutige Index in [ADR-0022](0022-erzeugung-von-instanzen.md), Nachtrag 2.
