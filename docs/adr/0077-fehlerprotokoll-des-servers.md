# ADR-0077: Fehlerprotokoll des Servers

- **Status:** Angenommen und umgesetzt (Paket FP-2); Fälle im Test-Manifest BYL-E6-2370 bis BYL-E6-2391, manuelle Prüfungen BYL-E6-2383 und BYL-E6-2384
- **Datum:** 2026-11-02
- **Entscheidung durch:** Nutzer (Statusdatei: „Aufbewahrung 30 Tage bzw. 5000 Einträge; Haushaltsfehler sehen die Mitglieder, Instanzfehler nur der Verwalter“; Entscheidung 1: Fehler aus dem privaten Bereich sieht nur der Besitzer, auch kein Verwalter; Entscheidung 2: „Details“ am letzten Hintergrundfehler der Kanal-Karten und die Server-ID in der Problemmeldung), Advisor (Auftrag FP-2 mit den technischen Vorgaben; Korrekturrunde nach der Durchsicht: kein eigener Wrapper, Variante C der Fehler mit 400), Executor (Bestandsaufnahme, Regeln, Grenzen, Umsetzung, Tests)
- **Bezug:** [ADR-0071](0071-fehlerdetails-und-sitzungsprotokoll.md) §2 (Datenschutz der Einträge), §6 (`lastError` der Karten) und §7 (Andockpunkte `source`, `serverId`), [ADR-0055](0055-sicherheits-haertung.md) §8 (`login_failures` als Vorbild für Speicher und Aufbewahrung), [ADR-0018](0018-secrets.md) §5 (bereinigte Fehler der Kanäle), [ADR-0056](0056-konten-und-verwalter.md) (Verwalter der App), [ADR-0058](0058-haushalt-mitgliedschaft-einladungen-rechte.md) §5 und [ADR-0059](0059-bereiche-privat-und-haushalt.md) (Bereiche und Mitgliedschaft), [ADR-0074](0074-postausgang-fuer-aenderungen-ohne-verbindung.md) (Postausgang)

## Kontext

Auf dem Server gab es kein Protokoll von Fehlern. Unerwartete Fehler und gescheiterte Läufe landeten nur im Log von PocketBase (46 Aufrufe von `logger().warn/error` in 19 Dateien), der letzte Fehler eines Kanals stand als Text an seiner Karte (`connections.last_error`), ohne „Details“ und ohne Verlauf. FP-1 (ADR-0071) gab den Meldungen im Browser „Details“ und eine Liste des Tabs und ließ dafür Andockpunkte (`source`, `serverId`). FP-2 hält auf dem Server fest, was unerwartet scheiterte, zusammengefasst, zeitlich begrenzt und streng datenschutzfreundlich, und macht es im Browser sichtbar. Die Seite „Einstellungen → Protokoll“ ist FP-3.

## Entscheidung

### 1. Collection `problem_events`

Migration `1790205100_problem_events.js`, additiv, legt nur die leere Collection an:

| Feld | Inhalt |
|---|---|
| `source` | `request` (unerwarteter Fehler einer Anfrage, §2), `channel` (gescheiterter Lauf eines Kanals), `job` (andere Aufgabe im Hintergrund) |
| `area` | `private`, `household`, `system` (§5) |
| `owner` | nur im Bereich `private`, Relation `users` mit Kaskade |
| `household` | nur im Bereich `household`, Relation `households` mit Kaskade |
| `code` | Code des Fehlers, etwa `http_500`, `channel_error`, `recurrence_failed`, höchstens 60 Zeichen |
| `message` | bereinigte Meldung (§4), höchstens 300 Zeichen |
| `context` | JSON nur mit den Schlüsseln `connection`, `channel`, `rule`, `job`, `method`, `route` (ohne Query), `status` (500 bis 599, 400 nur zum Code `http_400_unexpected`), je in fester Form; höchstens 2000 Bytes |
| `fingerprint` | SHA-256 dessen, was den Fehler gleich macht (§3); `hidden`, eindeutig |
| `count`, `first_at`, `last_at` | Häufigkeit, erstes und letztes Auftreten |

Indizes: eindeutig auf `fingerprint`, einfach auf `last_at`. Create, Update und Delete sind `null`: Über die Record-API schreibt kein Konto, nur Superuser. Geschrieben wird ausschließlich in `app/pb_hooks/lib/problem-service.js`; die Regeln (Bereinigung, Fingerabdruck, Bereiche, Grenzen, welche Fehler einer Anfrage zählen) stehen rein in `lib/problem-rules.js`.

**Regel für jede weitere Arbeit:** Neue Fehlerwege des Servers schreiben nur über `lib/problem-service.js` (`record`, `recordChannel`, `recordRule`, `recordJob`, `onRequestError`), nie selbst in `problem_events`; ein privater Eintrag ist nur für seinen Besitzer sichtbar, auch nicht für den Verwalter der App (§5).

### 2. Was erfasst wird

- **Anfragen:** Der bestehende globale Wrapper jeder Anfrage (`static-cache.pb.js`, `routerUse` mit Priorität 0, also nach Wächter, CORS und dem Token der Sitzung) ruft in seinem `catch` `onRequestError(e, err)` aus `lib/problem-service.js` und wirft den Fehler danach unverändert weiter; einen eigenen Wrapper gibt es nicht (Konsequenzen). Welche Fehler zählen, entscheidet `requestFailureOf` in `lib/problem-rules.js` nach dem, was PocketBase 0.40.4 antwortet (`ToApiError`):
  - **5xx:** ein `ApiError` mit 500 bis 599 (Code `http_<status>`), außer den absichtlichen 502 (ein anderer Dienst oder das Steuerskript antwortete schlecht) und 503 („nach dem nächsten Neustart“).
  - **Fehler der App mit 400** (Variante C der Durchsicht, Code `http_400_unexpected`, im Kontext `status` 400): Fast alle unerwarteten Fehler der Hooks beantwortet PocketBase mit 400 („Something went wrong while processing your request.“), nicht mit 5xx; die erwarteten Fehler der App (Validierung, Rechte, Nicht-gefunden) werfen dagegen durchweg die `ApiError`-Familie (216 Stellen). Erfasst wird darum ein geworfener Wert ohne Status eines `ApiError`: `Error`, `TypeError`, `RangeError` und Laufzeitfehler der Hooks, `failure()` der Clients, Fehler von Go aus `save()` oder der Datenbank („database is locked“). Dazu ein `ApiError` 400 der Record-API, deren Speichern scheiterte („Failed to create record.“, „Failed to update record.“) ohne Feldfehler und ohne `ApiError` dahinter, etwa ein `Error` eines Model-Hooks; ihre Prüfung der Create-Regel nutzt dieselbe Meldung mit „create rule …“ dahinter und zählt nicht. Die Unterscheidung ist per Fixture belegt (`tests/fixtures/pb_hooks/problem-events-probe.pb.js`).
  - **Ausnahmen** (ohne Eintrag): jeder andere `ApiError` (4xx, also auch die Ablehnungen der Record-API wie „Failed to authenticate.“ oder ein Filter, die absichtlichen 502 und 503), eine Validierung (ein Fehler von Go, aus dem PocketBase Feldfehler macht, `validation.Errors`), „no rows“ oder eine fehlende Datei (404), eine abgebrochene Anfrage (`context canceled`), ein zu großer oder unlesbarer Body (`jsontext: …`, Formulare, 413). Ein Fehler von JavaScript zählt immer: Nur Go nennt diese Fehler des Clients.
  - Status und Body der Antwort bleiben die von PocketBase, nur der Header `X-Byl-Problem` (§6) kommt dazu. Kein Eintrag für eine Antwort, die eine Route selbst schreibt (`e.json(5xx, …)`). Ein Go-Panic beantwortet die äußere Middleware von PocketBase, sie bleibt ohne Eintrag.
- **Kanäle:** Dort, wo heute der letzte Fehler der Karte gesetzt wird: der Lauf eines Kanals im Server (`lib/channel-runner.js`, Kalender, Telegram, GitHub, Ordner; im Cron wie mit „Jetzt abrufen“), „Verbindung prüfen“ von GitHub (`check` in `lib/github-service.js`, wenn es einen Fehler der Verbindung an die Karte schreibt) und der Status, den der Mail-Hilfsprozess meldet (`lib/ingest-service.js`). Kontext: ID und Art der Verbindung; Bereich und Besitzer folgen der Verbindung. Der Eintrag entsteht immer nach dem Schreiben der Karte.
- **Aufgaben im Hintergrund:** eine Wiederholung, deren Ticket nicht entstand (`recordFailure` in `lib/recurrence-service.js`, Bereich der Regel), und der Abbruch ganzer Läufe: Cron der Wiederholungen, des Papierkorbs, des Postausgangs und der fehlgeschlagenen Anmeldungen sowie die drei Teile des Nachholens beim Start (Bereich der App).
- **Nicht erfasst (Restpunkte):** Fehler einzelner Tickets des Papierkorbs und einzelner Einträge der Bereinigung des Eingangs, Fehler der Sicherung (sie haben ihre eigene Anzeige auf der Seite „Sicherung“), Fehler des Mail-Hilfsprozesses außerhalb seines Status, Fehler im Browser (Meldung an den Server sehen die Notizen nicht vor; FP-3).

### 3. Gleiche Fehler und Grenzen

- **Fingerabdruck:** Quelle, Bereich, Besitzer, Haushalt, Code, die normalisierte Meldung (Zeiten, Daten, IDs von PocketBase, UUIDs, Hex-Werte und Zahlen neutralisiert) und die Schlüssel des Kontexts (Verbindung, Art, Regel, Aufgabe, Methode, Route mit `*` für IDs und Zahlen, Status). Ein gleicher Fehler legt keinen neuen Datensatz an: Ein `INSERT … ON CONFLICT(fingerprint) DO UPDATE` zählt `count` hoch, schiebt `last_at` vor und nimmt die neueste Meldung und den neuesten Kontext, in einer Anweisung, auch bei gleichzeitigen Fehlern. Ein Kanal, der jede Minute scheitert, bleibt eine Zeile statt 1440 am Tag.
- **Aufbewahrung 30 Tage nach dem letzten Auftreten**, wie die fehlgeschlagenen Anmeldungen und der Postausgang: lang genug, um einen Fehler nach einem Wochenende oder Urlaub zu finden und zu melden, kurz genug, dass alte Meldungen nicht liegen bleiben.
- **Höchstens 5000 Einträge**, bei mehr gehen die ältesten nach `last_at`: wie bei den Anmeldungen. Mit 300 Zeichen je Meldung sind das höchstens einige MB. Weil gleiche Fehler eine Zeile sind, brauchen 5000 Zeilen 5000 verschiedene Fehler; eine Flut verschiedener Meldungen verdrängt alte Einträge, nie neue.
- **Kürzung:** Meldung 300 Zeichen (wie `PROBLEM_TEXT_MAX` der SPA), Code 60, Route 200, Kontext 2000 Bytes.
- **Aufräumen:** bei jedem neuen Datensatz und täglich um 11:55 UTC per Cron `byl-problem-events-cleanup`, wenn die App meist läuft; idempotent, vor der Migration ohne Wirkung.

### 4. Datenschutz

Ein Eintrag hält nie einen Body, einen Header, ein Cookie, ein Token, ein Passwort, Zugangsdaten oder den Inhalt einer Nachricht oder Mail. Jede Meldung geht durch `cleanMessage` (Test mit typischen Mustern in `tests/unit/problem-rules.test.mjs`), die Kanäle vorher durch `secrets.redact` mit den Werten ihrer Variablen:

- nur die erste Zeile (kein Stack), ohne „GoError: “;
- JWTs, `Bearer`/`Basic`/`Token`-Werte, `Authorization:`, `X-Api-Key:` und `Cookie:`/`Set-Cookie:` werden zu „[entfernt]“;
- Zuweisungen `name=wert` mit Namen wie `token`, `secret`, `password`/`passwort`, `passphrase`, `pass`, `pwd`, `api_key`/`apikey`, `access_key`, `auth`, `key`, `code`, `sig`, `session`, `credentials` (auch in längeren Namen wie `bot_token`), dieselben in JSON (`"password": …`) und `token: …`, `passwort: …`;
- die Query hinter einer URL oder einem Pfad bis zum nächsten Leerraum, der Benutzer einer URL;
- E-Mail-Adressen werden zu „[E-Mail]“;
- Tokens von Telegram, Notion, GitHub, Schlüssel des eigenen Eingangs (`byl_…`), jede Folge von 40 und mehr Zeichen aus Buchstaben, Ziffern, `_`, `+` und `-` und jede solche Folge von 32 und mehr Zeichen mit Buchstaben und Ziffern gemischt (Hex- und Base64-Schlüssel; IDs von PocketBase mit 15 Zeichen und Wörter ohne Ziffer bleiben);
- Pfade dieses Rechners (Laufwerk, UNC, `/home`, `/Users`, `/tmp` …) bis auf den Dateinamen, damit kein Name eines Windows-Kontos hineinkommt;
- Teile in Anführungszeichen („"…"“, „„…““, einfache `'…'` nur nach Anfang, Leerraum oder öffnendem Zeichen, damit der Apostroph in „geht's“ bleibt, Guillemets und die tiefen einfachen Anführungszeichen), denn sie halten oft Inhalte (Titel, eine Zeile eines Kalenders, den Namen einer Verbindung);
- Leerraum zusammengefasst, höchstens 300 Zeichen.

Der Kontext hält nur die Schlüssel aus §1 mit Werten fester Form; die Route nur den Pfad ohne Query (IDs im Pfad sind erlaubt, wie in ADR-0071 §2), unter `/api/files/<collection>/<record>/` statt des Dateinamens `*`, auch prozentkodiert. Es gibt keine Kennung je Anfrage: `correlation` bleibt `null`.

### 5. Wer was sieht

List- und View-Regel:

```
@request.auth.id != "" && ((area = "private" && owner = @request.auth.id) ||
  (area = "household" && household != "" && @collection.household_members.household ?= household &&
   @collection.household_members.user ?= @request.auth.id) ||
  (area = "system" && @request.auth.instance_admin = true))
```

- **Privat:** nur der Besitzer, auch nicht der Verwalter der App (Entscheidung 1; wie ADR-0059: private Daten sieht kein anderes Konto, und Fehlertexte nennen Namen, Postfächer und Repositorys).
- **Haushalt:** die aktuellen Mitglieder, nach demselben Rechtemodell wie jeder Datensatz eines Haushalts (ADR-0058 §5: wer austritt, verliert den Zugriff).
- **App:** nur der Verwalter der App (`instance_admin`, ADR-0056), wie die Seiten „System“, „Sicherung“ und „Sicherheit“. Die Liste ist ein reines Lesen ohne Skript, darum auf jedem Gerät des Verwalters, nicht nur am PC.
- **Welcher Bereich:** Ein Fehler einer Anfrage eines angemeldeten Kontos ist privat für dieses Konto; der Server kann nicht sicher sagen, welchen Bereich die Anfrage berührte, und so sieht kein anderes Konto, was dieses Konto tat. Ohne Konto (Zugriff im Heimnetz vor der Anmeldung), als Superuser oder vom Mail-Hilfsprozess gehört er der App. Kanäle und Wiederholungen folgen ihrem Datensatz (Haushalt, sonst privat); ganze Läufe gehören der App.

Beide Bedingungen auf `@collection.household_members` ohne Alias greifen auf dieselbe Zeile der Mitgliedschaft (wie bei allen Collections mit Haushalt seit `1790200900_api_rules.js`). Der Integrationstest `tests/integration/problem-events.test.mjs` belegt: Ein anderes Konto sieht einen privaten Eintrag nicht, auch nicht als Verwalter, auch nicht als Verwalter im selben Haushalt; den Eintrag eines Haushalts sehen seine Mitglieder, nicht die Mitglieder eines anderen Haushalts, auch nicht der Verwalter als Mitglied eines anderen Haushalts, und ein ausgetretenes Mitglied bekommt 404; Filter (auch mit `@collection`, das PocketBase Konten mit 403 ablehnt) erweitern nichts, `fingerprint` lässt sich weder filtern noch sortieren (400); den der App sieht nur der Verwalter; Schreiben über die Record-API lehnt PocketBase für jedes Konto mit 403 ab.

### 6. Wie die Server-ID zum Client kommt

- **Antwort mit unerwartetem Fehler (§2):** Header `X-Byl-Problem: <ID des Eintrags>`, bei einem 5xx wie bei einer 400 mit `http_400_unexpected`; der Body bleibt der von PocketBase (`status`, `message`, `data`). Die SPA liest ihn in `afterSend` ihres Clients (`lib/pocketbase.ts`) und merkt nur die ID neben dem Body (`noteServerProblem`, nur bei 5xx und 400 und nur in der Form einer ID; bei 400 setzt der Server ihn nur für einen Fehler der App, nie für eine Ablehnung); `problemOf` gibt sie dem Eintrag als `serverId`. Die PocketBase-Fehlerantwort wird nicht selbst geschrieben, sonst fehlte der Fehler im Log von PocketBase.
- **„Jetzt abrufen“:** Die Antwort eines gescheiterten Laufs (200 mit `status: "error"`) nennt ihren Eintrag im Feld `problem`, nur wenn es einen gibt; der Eintrag „Vom Server gemeldeter Fehler“ der SPA übernimmt ihn.
- **Details und Bericht:** Die Fakten nennen zuletzt „Server-ID“; damit enthält der Bericht unter „Kopieren“ sie genau einmal.

### 7. Ansicht im Browser

- **Dialog der Fehler erweitert** statt einer zweiten Ansicht: über der Liste ein Schalter (`.segmented`, 44 px am Handy über die Regeln von `base.css`) „Diese Sitzung (n)“ und „Server“; der Titel nennt die gezeigte Liste („Fehler dieser Sitzung“ bzw. „Fehlerprotokoll des Servers“). Die Liste des Servers nutzt dieselben Bausteine (`ProblemFacts`, `CopyReportButton`) und zeigt je Eintrag Absicht, letztes Auftreten, Ergebnis und „3×“, aufgeklappt zusätzlich „Zuletzt“, „Bereich“ und „Server-ID“ statt „App-Stand“. Sie lädt die neuesten 50 über die Record-API, beim Öffnen und mit „Erneut laden“; kein Polling, nichts im Speicher des Browsers.
- **Adresse eines Eintrags:** `?fehler=<id>` auf jeder Seite; das Root-Layout öffnet den Dialog damit, sobald die Sitzung bekannt ist, lädt den Eintrag zuerst (auch einen älteren), klappt ihn auf, markiert ihn als „Verlinkter Eintrag“ und setzt den Fokus darauf; beim Schließen geht der Parameter aus der Adresse. Ein verschwundener oder nicht sichtbarer Eintrag sagt das, die Liste bleibt.
- **„Details“ an der Kanal-Karte:** In den Details der Karten mit Lauf im Hintergrund (Kalender, Telegram, Postfach, GitHub, Ordner) steht hinter „Letzter Fehler“ ein Link „Details“ auf den Eintrag dieses Fehlers, nur auf der Seite „Kanäle“ (Kontext der Seite) und nur, wenn es einen gibt.
  - **Eine Abfrage für alle Karten:** Jede Karte mit `lastError` meldet ihn dem `ChannelProblemsStore` der Seite (`stores/server-problems.svelte.ts`); der fragt nach einer Sekunde Ruhe einmal für alle (`channelProblemHits`: `source = "channel"` mit Verbindung, `last_at` ab dem frühesten Lauf, neueste zuerst, höchstens 200 Einträge; der Filter ist eine Konstante wie überall in der Datenschicht) und ordnet die Einträge per `context.connection` den Karten zu. Weil der gleiche Fehler auf einem Eintrag zählt, reichen wenige Einträge für alle Karten. Neu gefragt wird nur, wenn ein Fehler neu ist (Verbindung und Text), nie für einen neuen Lauf mit demselben Fehler: Der Server zählt ihn auf demselben Eintrag. Die Sekunde fasst Laden und Aktualisierungen über Realtime zusammen, und der Eintrag eines Laufs steht dann schon (er entsteht kurz nach der Karte). Eine gescheiterte Abfrage zeigt keinen Link und fragt mit der nächsten Änderung erneut.
  - **Nur der gezeigte Fehler:** Der Link erscheint nur, wenn der neueste Eintrag der Verbindung nicht älter ist als der letzte Lauf der Karte (`matchChannelProblems`, Toleranz 1 s): Der Server schreibt den Eintrag Millisekunden nach `last_run_at`, die Sekunde fängt nur eine Korrektur seiner Uhr dazwischen ab. So zeigt „Details“ nach einem gescheiterten Lauf ohne Eintrag (etwa vor FP-2 oder wenn das Protokoll scheiterte) nie auf einen älteren, anderen Fehler.
- **Ohne Verbindung:** Hinweis „Ohne Verbindung zum Server lässt sich das Fehlerprotokoll nicht laden.“ mit „Erneut laden“; nichts bricht, nichts kommt in den Postausgang (IndexedDB `byl-offline` unverändert). Ohne Sitzung zeigt der Dialog nur die Liste des Tabs.
- **Hilfe:** ein eigener Abschnitt „Fehlerprotokoll des Servers“ (`#fehlerprotokoll`) nach „Fehler dieser Sitzung“: was festgehalten wird, wer was sieht, wie lange, was nie hineinkommt, und „Fehlerprotokoll des Servers anzeigen“.

### 8. Robustheit

`record` und `onRequestError` werfen nie: Ein Fehler des Protokolls geht nur ins Log von PocketBase (bereinigt), nie ins Protokoll, und stört weder Anfrage noch Lauf. Geschrieben wird mit reinem SQL, also ohne Hooks der Datensätze und ohne Realtime, damit nichts rekursiv protokolliert. Die Aufrufer schützen auch das Laden des Moduls mit `try/catch`, ebenso der Wrapper jeder Anfrage. Er ändert nichts außer dem Header und lässt den Fehler unverändert weiter. Vor der Migration schreibt nichts; die Hooks laufen auch auf dem alten Schema (Test „before the migration“).

## Alternativen

- **Alle API-Regeln `null` und eine eigene Lese-Route `GET /api/byl/problems`** (Vorschlag der Notizen, wie `login_failures`): verworfen nach Auftrag; die Regeln der Record-API setzen die Sichtbarkeit durch, wie bei jeder anderen Collection mit Bereich, und sind per Negativtest belegt.
- **Eine Kennung je Anfrage in jeder Antwort** (`X-Byl-Request`): mehr Rauschen ohne Nutzen, solange nur Fehler einen Eintrag haben. Verworfen; der Header kommt nur an eine Antwort mit Eintrag.
- **Die ID im Fehler-JSON:** Die Fehlerantwort schreibt PocketBase aus dem `ApiError` (`data` nur mit Feldfehlern); selbst schreiben hieße, den Fehler im Log von PocketBase zu verlieren. Verworfen.
- **Nur 5xx erfassen** (Variante B, die erste Fassung): Kein Hook wirft 500, 501 oder 504; die Quelle `request` bliebe für Fehler der App leer, gerade Bugs und Fehler der Datenbank hätten keine Server-ID. Verworfen.
- **Jeden Fehler mit 400 erfassen** (Variante A): träfe auch Validierungen aus `save()`, abgebrochene Anfragen, kaputte Bodies und die Ablehnungen der Record-API (Create-Regel, Filter, Anmeldung). Verworfen zugunsten der Ausnahmen von §2.
- **Jeden `ApiError` 400 ohne Feldfehler mit einem Fehler dahinter erfassen:** „Kein ApiError und keine Validierung dahinter“ lässt sich zuverlässig erkennen, trennt aber nicht Erwartetes von Unerwartetem: PocketBase verpackt so auch die Prüfung der Create-Regel, Fehler eines Filters, eine falsche Anmeldung und einen unlesbaren Body. Darum nur das gescheiterte Speichern der Record-API (§2).
- **Ein eigener globaler Wrapper je Anfrage** (die erste Fassung, `problem-events.pb.js`): hielt je Anfrage und je offenem Tab einen Runtime des JSVM-Pools mehr (Konsequenzen). Verworfen; der bestehende Wrapper fängt mit.
- **Ein Feld `last_problem` an `connections`:** der Link der Karte ohne Abfrage, aber eine Änderung des Schemas einer bestehenden Collection; die Migration legt nur die neue an. Verworfen; die Seite fragt die Einträge ihrer Karten in einer Abfrage (§7).
- **Private Fehler gar nicht speichern oder auch dem Verwalter zeigen:** Nutzerentscheidung 1, nur der Besitzer.
- **Fehler des Browsers an den Server melden:** sehen die Notizen nicht vor; die Liste des Tabs bleibt im Tab (ADR-0071 §2).

## Konsequenzen

- Neue Migration und neue Hooks: Nach dem Deploy braucht die Instanz einen Neustart, die Tabs ein F5. Vor dem Neustart antwortet alles wie bisher.
- **Kein zusätzlicher Runtime je Anfrage:** Jeder globale JS-Wrapper um `e.next()` hält einen Runtime des JSVM-Pools für die ganze restliche Kette, auch für statische Dateien und für jede offene Realtime-Verbindung (SSE) über die Lebensdauer des Tabs; ist der Pool (Standard 15) voll, baut jede weitere Ausführung eines Hooks einen Einmal-Runtime. Die erste Fassung mit eigenem Wrapper erschöpfte ihn in Produktion schon bei 3 offenen Tabs statt bei 4. Die Erfassung sitzt darum im bestehenden Wrapper von `static-cache.pb.js` und kostet keinen Runtime. Gemessen mit der Testinstanz (ein Wrapper der Fixture mehr): `/api/health` bleibt bis 2 offene SSE so schnell wie ohne, erst ab 3 kommen Einmal-Runtimes dazu, wie es die Rechnung für den Stand vor FP-2 ergibt (mit eigenem Wrapper gemessen schon ab 2).
- **Regel:** Keine weiteren globalen JS-Wrapper mit `e.next()` (`routerUse` um die Kette). Neue Querschnittslogik jeder Anfrage kommt in den bestehenden Wrapper von `static-cache.pb.js`, ihre Logik als Funktion in `lib/`.
- Neue Fehlerwege des Servers protokollieren über `lib/problem-service.js` (`recordChannel`, `recordRule`, `recordJob`, `onRequestError`), nie selbst in `problem_events`; ein privater Eintrag bleibt nur für seinen Besitzer sichtbar.
- **Restpunkte:** Go-Panics erfassen; „Failed to delete record.“ und Batch der Record-API (verpacken auch erwartete Fehler, etwa eine Relation); Schlüssel in Base64 mit `/` (der Bereiniger trennt dort, damit Pfade bleiben); Fehler von Notion an der Karte (ohne Eintrag und ohne „Details“); Fehler einzelner Tickets des Papierkorbs, der Bereinigung des Eingangs und der Sicherung; die Seite „Einstellungen → Protokoll“ mit beiden Listen, Filtern und mehr als 50 Einträgen (FP-3).
