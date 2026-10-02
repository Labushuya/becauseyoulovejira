# ADR-0020: Stichwörter pro Kanal entscheiden, was automatisch in den Eingang kommt

- **Status:** Angenommen
- **Datum:** 2026-09-25
- **Entscheidung durch:** Nutzer (Stichwort-Liste je Kanal, manueller Import immer möglich, 2026-09-25), Advisor (Abgleich, Speicherort, Abläufe)
- **Ergänzt:** [ADR-0014](0014-datenmodell-eingang.md) (Eingang, Fingerprint, Tombstone), [ADR-0016](0016-kanal-architektur-und-mail.md) (Kanäle, Mail), [ADR-0017](0017-parser-ics-eml.md) (Parser)
- **Ersetzt:** die offene Frage OF-E4-2 („Welche Mails sollen in den Eingang?“) im [E4-Plan](../plan/e4.md)

## Kontext

Automatische Kanäle holen alles, was die Quelle hergibt: jeden Termin des Kalenders im Fenster, jede Nachricht an den Bot und später jede neue Mail im Posteingang. Der Eingang soll aber nur Arbeit enthalten. Der Nutzer hat entschieden:

1. Jede Kanal-Verbindung (Postfach, Google Calendar, Telegram, später weitere) hat eine **eigene Liste von Stichwörtern**.
2. **Automatisch** landet ein Element nur im Eingang, wenn ein Stichwort greift.
3. **Manueller, selektiver Import** bleibt immer möglich, auch ohne Stichwort: Datei-Drops (`.eml`, `.ics`, WhatsApp-Export) und eine Auswahl aus dem Postfach. Bei Datei-Imports markieren Treffer die Einträge vor.

Randbedingungen:

- Kalender und Telegram laufen im Hook (Goja, ES5, kein `Intl`, keine Zeitzonen- und Locale-Funktionen der Laufzeit; [ADR-0005](0005-zeitzone-europe-berlin.md)). Mail-Dateien und WhatsApp-Exporte liest die SPA, Postfächer der Hilfsprozess (TypeScript, gebündelt). Der Abgleich muss in allen drei Laufzeiten **dasselbe** Ergebnis liefern.
- Verworfene Einträge sind Tombstones ([ADR-0014](0014-datenmodell-eingang.md) §3). Ein Element ohne Treffer ist aber keine Entscheidung des Nutzers und soll keine Spur hinterlassen.

## Entscheidung

### 1. Wo gesucht wird

| Kanal | Durchsuchter Text |
|---|---|
| Mail (Postfach und `.eml`) | Betreff; mit der Einstellung „Auch den Textanfang durchsuchen“ zusätzlich die ersten **500 Zeichen** des Textes (nach `htmlToText` bei Nur-HTML-Mails) |
| Termin (Google Calendar und `.ics`) | Titel (`SUMMARY`) und Beschreibung (`DESCRIPTION`) |
| Telegram | Text der Nachricht bzw. Bildunterschrift |
| WhatsApp-Export | Text der Nachricht |

Absender, Empfänger, Ort und Chatname werden nicht durchsucht. Mehrere Textteile gelten als getrennt: Ein Stichwort über die Grenze von Titel und Beschreibung hinweg greift nicht.

### 2. Abgleich

Ein reiner Algorithmus, zweimal implementiert und per Paritätstest abgeglichen: `web/src/lib/domain/keywords.ts` (SPA, später in den Hilfsprozess gebündelt) und `app/pb_hooks/lib/keywords.js` (CommonJS, ES5, unter `hooks-lib-constraints.test.mjs`).

1. **Normalisieren** von Text und Stichwort:
   - Kleinschreibung mit `toLowerCase()` (keine Locale-Funktion).
   - Umlaute und Akzente über eine **feste Tabelle**, nicht über `String.prototype.normalize` oder `Intl` (ADR-0005: nichts, was die Laufzeit anders liefern könnte). Die Tabelle deckt die zusammengesetzten Zeichen des Latin-1-Bereichs ab und die zerlegte Form (Buchstabe plus U+0308 bzw. andere kombinierende Zeichen U+0300–U+036F).
   - Leerraum (auch Tab, Zeilenumbruch, geschütztes Leerzeichen) wird zu einem Leerzeichen zusammengefasst, Anfang und Ende getrimmt.
2. **Umlaute ignorieren:** Jeder Text wird in **zwei Faltungen** verglichen: `ä → a` (dazu `ö → o`, `ü → u`) und `ä → ae` (`ö → oe`, `ü → ue`); `ß` wird in beiden zu `ss`, Akzente fallen weg (`é → e`). Ein Stichwort greift, wenn es in einer der beiden Faltungen greift. So passt „prüfen“ zu „Prüfen“, „pruefen“ und „prufen“, und „pruefen“ passt zu „prüfen“.
3. **Wortanfang:** Ein Stichwort greift an einer Stelle, wenn der Text dort mit dem Stichwort beginnt und davor der Textanfang oder ein Zeichen steht, das kein Wortzeichen ist. Wortzeichen sind `a–z`, `0–9` und Buchstaben anderer Schriften (Code ab U+00C0 außer `×`, `÷`, allgemeiner Interpunktion und Symbolen U+2000–U+2BFF, U+3000–U+303F, Variantenselektoren und Surrogaten, also Emoji). Nach dem Stichwort gilt keine Grenze. „todo“ greift in „Todo-Liste“ und „todos“, nicht in „Fotodoku“. „#byl“ greift in „(#byl)“, nicht in „x#byl“.
4. **Phrasen:** Ein Stichwort darf aus mehreren Wörtern bestehen („zu erledigen“); der zusammengefasste Leerraum macht Zeilenumbrüche und doppelte Leerzeichen im Text unschädlich.
5. **Ergebnis:** das erste Stichwort der Liste (in der gespeicherten Schreibweise), das greift, sonst keins.

### 3. Liste und Speicherort

- **Regeln für eine Liste:** höchstens 50 Stichwörter, je 1 bis 100 Zeichen nach dem Trimmen, ohne Zeilenumbruch. Doppelte (nach dem Normalisieren) lehnt die Oberfläche ab; der Server prüft Typ, Anzahl und Länge (Feldfehler `validation_keywords`).
- **Verbindungen** (Kalender, Telegram, Mail): in `connections.settings`:
  - `keywords` (Liste),
  - `match_body` (nur Mail: Textanfang durchsuchen, Standard aus),
  - `reply_no_match` (nur Telegram: Antwort bei fehlendem Treffer, Standard an).
  
  Keine Migration nötig, `settings` ist JSON. `connection-rules.js` lässt die neuen Schlüssel je Art zu und prüft sie.
- **Datei-Imports** haben keine Verbindung. Ihre Listen sind App-Einstellungen **pro Nutzer und Kanalart** im neuen JSON-Feld `users.import_keywords` (additive Migration): `{ "eml": { "keywords": [], "match_body": false }, "ics": { "keywords": [] }, "whatsapp": { "keywords": [] } }`. Der Nutzer darf ohnehin nur den eigenen Datensatz ändern; ein Hook prüft das Feld wie die Listen der Verbindungen. Eine eigene Collection wäre für drei Listen je Nutzer mehr Schema (Regeln, Negativtests, Realtime) ohne Nutzen.
- **Vorschlagsliste:** „todo“, „aufgabe“, „erledigen“, „ticket“, „#byl“. Die Oberfläche bietet sie mit „Vorschläge übernehmen“ an, setzt sie aber nie ungefragt.

### 4. Abläufe

- **Automatisch (Kalender, Telegram, Postfach):** Nur Treffer werden gespeichert. Ein Element ohne Treffer wird **nicht gespeichert, auch nicht als verworfen**; es zählt im Ergebnis des Laufs als „ohne Stichwort“.
  - **Mail:** Der Cursor (UID) rückt trotzdem vor.
  - **Telegram:** Der Offset rückt trotzdem vor. Der Bot antwortet „Kein Stichwort erkannt – nicht gespeichert“, abschaltbar über `reply_no_match`. Scheitert die Antwort, wird das wie eine gescheiterte Bestätigung an der Verbindung gemeldet.
  - **Kalender:** Kein Cursor, der Feed ist ein Zustand. Jeder Lauf prüft alle Termine im Fenster (heute bis +30 Tage) mit der aktuellen Liste.
- **Leere Liste:** Es kommt nichts automatisch. Telegram antwortet dann auf jede Nachricht mit dem Hinweis (sofern nicht abgeschaltet). Die Seite „Kanäle“ zeigt an der Verbindung die Warnung „Keine Stichwörter: Diese Verbindung übernimmt nichts automatisch.“ (neutral, keine Fehlerfarbe; [ADR-0009](0009-fehlerfarbe.md)).
- **Nachträglich hinzugefügte Stichwörter** wirken nicht rückwirkend. Mail und Telegram prüfen nur, was nach dem Cursor neu ankommt; bereits übergangene Elemente holt nur die manuelle Postfach-Auswahl ([ADR-0016](0016-kanal-architektur-und-mail.md) §6). Einzige Ausnahme ist der Kalender (Zustand statt Strom): Ein neues Stichwort holt beim nächsten Lauf die passenden Termine, die noch im Fenster liegen.
- **Manueller Import:** Datei-Drops öffnen eine Auswahlansicht (Vorbild: WhatsApp-Import aus Paket 16). Treffer der Liste der Kanalart sind **vorausgewählt**, alles andere lässt sich dazuwählen. Ohne Liste ist nichts vorausgewählt, die Ansicht sagt das. Dasselbe gilt für die Postfach-Auswahl mit der Liste der Verbindung.
- **Dokumentation am Eintrag:** Das Stichwort, das gegriffen hat, steht in `source_meta.keyword` (auch bei manuellen Imports, wenn es einen Treffer gab) und im Panel des Eintrags als „Stichwort“. Ohne Treffer fehlt der Schlüssel.
- **Wer abgleicht:**
  - Kalender und Telegram: der Hook beim Lauf.
  - `.ics`-Auswahl: der Hook in der Vorschau, mit der Liste aus `users.import_keywords` (der Parser liegt im Hook, ADR-0017).
  - `.eml` und WhatsApp: die SPA.
  - Postfach: Der Hilfsprozess sendet nur Treffer, die Ingest-Route prüft sie mit `keywords.js` nach. Die Route ist der eine Weg in den Eingang, also soll sie entscheiden. Manuell ausgewählte Mails kommen ausdrücklich als Auswahl.

## Alternativen

- **Nichts filtern, alles in den Eingang** (bisher Kalender und Telegram): Der Eingang füllt sich mit Terminen und Nachrichten, die keine Arbeit sind. Vom Nutzer abgelehnt.
- **Markierte Mails (Stern/Flagge) statt Stichwörter** (bisherige Empfehlung zu OF-E4-2): ginge nur für Mail, nicht für Kalender und Telegram. Vom Nutzer durch Stichwörter ersetzt.
- **Reguläre Ausdrücke:** mächtiger, aber fehleranfällig für Laien und ein Einfallstor für Laufzeitprobleme in Goja (katastrophales Backtracking). Verworfen.
- **Teilwort-Suche ohne Wortgrenze:** „todo“ träfe „Fotodoku“, „ticket“ träfe „Bahnticket“ nicht, wohl aber jede Zeichenfolge darin. Verworfen zugunsten von Wortanfängen.
- **Nur eine Faltung (`ä → ae`):** „prufen“ ohne Umlaut, wie es manche Tastaturen und Telefone liefern, fände „prüfen“ nicht. Beide Faltungen kosten nur einen zweiten Durchlauf über kurze Texte.
- **`String.prototype.normalize('NFD')` statt Tabelle:** In der SPA vorhanden, in Goja nicht verlässlich zu belegen; zwei verschiedene Wege würden Paritätsfehler bringen. Verworfen.
- **Nicht passende Elemente als verworfen speichern:** würde den Eingang mit Tombstones für jede Nachricht und jeden Termin füllen, Inhalte in `pb_data` und Backups halten und ein später passendes Stichwort blockieren. Vom Nutzer abgelehnt.
- **Listen der Datei-Imports in `localStorage`:** gingen mit anderem Browser oder Gerät verloren (E7), der Hook bräuchte sie für die `.ics`-Vorschau trotzdem. Verworfen.

## Konsequenzen

- Bestehende Verbindungen haben nach dem Update **keine** Stichwörter und übernehmen nichts mehr automatisch, bis der Nutzer eine Liste pflegt. Die Warnung an der Verbindung macht das sichtbar; die Vorschläge sind ein Klick.
- Neue Module `keywords.ts` und `keywords.js` mit Paritätstest über eine gemeinsame Falltabelle (Umlaute beider Faltungen, zerlegte Zeichen, Wortanfang, Phrasen, Emoji, leere Liste).
- `connection-rules.js`, die Kanäle Kalender und Telegram, der Datei-Import (Auswahlansicht für `.eml` und `.ics`) und der WhatsApp-Import ändern sich; eine additive Migration für `users.import_keywords`.
- Das Ergebnis eines Laufs bekommt die Zahl „ohne Stichwort“ (`unmatched`).
- Ein Termin ohne Treffer kann später doch kommen, wenn er so geändert wird, dass ein Stichwort greift, oder wenn ein passendes Stichwort dazukommt, solange er im Fenster liegt. Das ist gewollt: Es gibt keinen Tombstone für Nichttreffer.

## Nachtrag (2026-09-27): Absender bei Mail

**Anlass (Testfeedback Paket A):** Der Nutzer hatte an seiner Web.de-Verbindung das Stichwort „europa-go“ und „Textanfang durchsuchen“ gesetzt. Eine Mail mit „europa-go“ im Text und im Absender kam trotzdem nicht in den Eingang. Die Diagnose lief ohne Nutzerdaten, nur über Code und Tests:

- **(a) Bindestrich und Domain:** trifft nicht zu. „europa-go“ greift in „europa-go“, „Europa-Go“, „europa-go.de“, „www.europa-go.de“ und „info@europa-go.de“, denn `@`, `.` und `<` sind keine Wortzeichen. Belegt in der gemeinsamen Falltabelle.
- **(b) Cursor:** möglich. Der erste Abruf setzt den Cursor auf die höchste UID. Eine Mail, die vor dem ersten Abruf im Posteingang lag, kommt deshalb nie automatisch, auch wenn sie nach dem Anlegen der Verbindung eintraf, aber vor dem ersten Lauf von `byl-mail.exe`. Das ist gewollt (ADR-0016 §5), stand aber nur in einem zugeklappten Absatz des Assistenten.
- **(c) `match_body`:** wirkt wie beschrieben. Durchsucht werden die ersten 500 Zeichen des Textteils, bei reinen HTML-Mails des Textes nach `htmlToText`, nach der Dekodierung durch postal-mime (Quoted-Printable, Zeichensatz). Steht das Stichwort erst nach Zeichen 500, etwa im Fuß eines Newsletters, greift es nicht.
- **(d) Absender:** trifft zu. Der Absender wurde bisher nirgends durchsucht (§1: „Absender … werden nicht durchsucht“).

**Entscheidung:**
- Bei Mail wird zusätzlich der Absender durchsucht, also Name und Adresse, wie sie in `source_meta.from` stehen („Name <adresse>“). Das gilt für den Abruf, die Nachprüfung in der Ingest-Route, die Vorauswahl der Postfach-Auswahl (aus dem Kopf) und für `.eml`-Dateien.
- Gesteuert wird das über die Konstante `MAIL_MATCH_FROM` (Standard an) in `keywords.js` und `keywords.ts`, gleich per Paritätstest. Es gibt bewusst keinen Schalter je Verbindung, denn ein Stichwort im Absender ist fast immer gewollt, und ein Schalter hieße Migration der Einstellungen und mehr Oberfläche. Kommt der Wunsch nach einem Schalter, wird `match_from` in `settings` ergänzt, mit Standard an.
- Der Absender ist ein eigener Textteil. Eine Phrase über Betreff und Absender hinweg greift nicht, wie bisher zwischen Betreff und Text.
- Die Oberfläche sagt deutlicher, was gilt:
  - Unter „Kanäle“ und im Dialog „Bearbeiten“ steht an Postfächern „Automatisch kommen nur neue Mails, die nach dem ersten Abruf dieser Verbindung eintreffen. Ältere Mails holst du über „Aus dem Postfach wählen“.“ Der Assistent sagt dasselbe im Schritt „Erster Abruf“.
  - Der Stichwort-Editor nennt „Groß-/Kleinschreibung egal“ und ein Beispiel mit Adresse.
- `byl-mail.exe` geht auf 0.4.0. Die Ingest-Route ist abwärtsverträglich: Ein älterer Hilfsprozess sendet nur Treffer aus Betreff und Text, die weiter angenommen werden.

## Nachtrag 2 (2026-09-27): Kopfzeilen und ganzer Text bei Mail

**Nutzerentscheidung (2026-09-27):** Bei Mail werden durchsucht: Betreff, Absender (Name und Adresse), die Kopfzeilen To, Cc, Reply-To, Sender, List-Id und Organization und der **vollständige Text**, also Textteil, HTML-Teil als dekodierter Klartext und damit auch der Preheader eines Newsletters. Die Grenze von 500 Zeichen (§1, Nachtrag 1 (c)) entfällt.

**Umsetzung:**
- `match_body` schaltet Kopfzeilen und Text zusammen; Betreff und Absender werden immer durchsucht. Die Beschriftung heißt „Betreff, Absender, Kopfzeilen und Text durchsuchen“ (Konstante `MAIL_MATCH_BODY_LABEL`), an Postfächern und bei Mail-Dateien.
- `keywords.js` und `keywords.ts` bekommen statt `MAIL_BODY_CHARS` (500) zwei Grenzen, gleich per Paritätstest: `MAIL_TEXT_MAX_CHARS` = 100 000 Zeichen je Textteil (so viel, wie `inbox_items.body` fasst) und `MAIL_EXTRA_TEXTS_MAX` = 12 weitere Textteile. `mailTexts(title, body, matchBody, from, extra)` bzw. `mailKeywordTexts(…, extra)` nehmen die weiteren Teile an; jeder bleibt ein eigener Teil, eine Phrase über zwei Teile greift weiter nicht.
- Die weiteren Teile bildet `mailMatchTexts` in `domain/inbox-mail.ts`, für `.eml` (SPA) und Postfach (Hilfsprozess) dieselbe Funktion: To, Cc, Reply-To und Sender als „Name <adresse>“, der HTML-Teil als Text (nur wenn es auch einen Textteil gibt, sonst ist er schon der Text des Entwurfs), dann List-Id und Organization, dekodiert mit `decodeWords` von postal-mime. Gespeichert wird davon nichts Neues.
- **Ingest-Route:** Der Hilfsprozess ab 0.6.0 sendet die Teile als `match_texts` (höchstens 12, je bis 100 000 Zeichen, sonst 400). Die Route prüft damit nach und speichert sie nicht. Ein älterer Hilfsprozess sendet kein `match_texts`; seine Mails werden wie bisher mit Betreff, Absender und Text geprüft.
- **Laufzeit:** `fold` in `keywords.js` sammelt die Zeichen in einem Array statt die Zeichenkette zu verlängern; wiederholtes Anhängen an lange Texte ist in Goja langsam.
- Was sich beim Abruf des Posteingangs ändert (ganzer Posteingang, rückwirkend), steht in Nachtrag 3.

## Nachtrag 3 (2026-09-27): Der gesamte Posteingang, auch rückwirkend

**Nutzerentscheidung (2026-09-27), ersetzt §4 „Nachträglich hinzugefügte Stichwörter wirken nicht rückwirkend“ für Mail und den Umfang in [ADR-0016](0016-kanal-architektur-und-mail.md) §5:**
1. Durchsucht wird der **gesamte Posteingang (`INBOX`)**, nicht nur Mails ab der Einrichtung. Alle Treffer kommen in den Eingang. Papierkorb, Spam, Gesendet, Archiv, Entwürfe und alle anderen Ordner bleiben draußen; der Hilfsprozess öffnet sie nie.
2. Durchsucht werden die Teile aus Nachtrag 2.
3. **Neue Stichwörter wirken rückwirkend:** Nach jeder Änderung der Stichwörter oder von `match_body` wird der Posteingang erneut durchsucht.

**Ablauf (`helpers/mail/src/scan.ts`, `poll.ts`):**
- **Wann:** beim ersten Abruf, nach jeder Änderung der Stichwörter oder von `match_body` (der Hilfsprozess vergleicht eine Signatur aus den Stichwörtern, unabhängig von Reihenfolge und Groß-/Kleinschreibung, und `match_body`), nach einer neuen `UIDVALIDITY` (statt „beginnt bei den neuesten Mails“) und auf Knopfdruck („Posteingang neu durchsuchen“).
- **Umfang:** alle UIDs bis zum Cursor. Der erste Abruf setzt den Cursor wie bisher auf die höchste UID; neuere Mails kommen weiter über den Cursor (höchstens 100 geprüfte Mails je Lauf). Bestehende Verbindungen ohne Scan-Zustand werden nach dem Update einmal ganz durchsucht.
- **Blöcke:** von der neuesten zur ältesten Mail, je `SCAN_BLOCK_SIZE` = 500 Mails. Nach jedem Block meldet der Hilfsprozess den Fortschritt über die Status-Route (`connections.scan`: `done`/`total`, etwa „1.200/4.800“), die Karte folgt per Realtime. Abbrechen wirkt vor der nächsten Mail.
- **Grenze:** höchstens `MAX_CREATED_PER_RUN` = 200 neue Einträge je Lauf (Abruf nach Cursor und Scan zusammen). Dann pausiert der Scan (`state: paused`), der Hinweis lautet „Weitere Treffer – erneut abrufen …“, und erst ein manueller Abruf („Jetzt abrufen“) setzt ihn fort. Der 5-Minuten-Lauf setzt einen pausierten Scan nicht fort, damit sich der Eingang nicht von selbst flutet. Die neuesten Treffer kommen zuerst.
- **Duplikate und verworfene Einträge:** Der Fingerprint (Message-ID) verhindert Duplikate; verworfene Einträge sind Tombstones ([ADR-0014](0014-datenmodell-eingang.md) §3) und kommen nicht wieder, auch nicht nach der Bereinigung nach 30 Tagen. Ein erneuter Scan ist deshalb folgenlos.
- **Zeitbudget:** „Jetzt abrufen“ (`/poll`) gibt dem Scan 45 Sekunden (`POLL_SCAN_BUDGET_MS`), weil der Hook 90 Sekunden wartet; ein längerer Scan läuft danach im Hintergrund weiter. „Posteingang neu durchsuchen“ (`/scan`) antwortet sofort und scannt im Hintergrund.

**Suche auf dem Server und Rückfall:**
- Je Block liest der Hilfsprozess für jede Mail nur die Kopfzeilen, die Stichwörter durchsuchen (`BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO CC REPLY-TO SENDER LIST-ID ORGANIZATION …)]`), und prüft sie **lokal und genau** mit `keywords.ts` (Wortanfang, Umlaute, Groß-/Kleinschreibung). Das braucht keinen Text und keine Hilfe des Servers.
- Mit `match_body` sucht der **Server den Text:** ein `UID SEARCH` je Stichwort über die UIDs des Blocks, im Nur-Lese-Modus (`EXAMINE`), mit `OR` über `SUBJECT`, `FROM`, `TO`, `CC`, `HEADER Reply-To/Sender/List-Id/Organization` und `BODY`, für jede Schreibweise des Stichworts (`searchTerms`: wie getippt, Umlaute als „a“ und als „ae“, ausgeschriebene Umlaute und „ß“ zurück, höchstens 6). imapflow setzt `CHARSET UTF-8`, sobald ein Suchbegriff nicht ASCII ist. `TEXT` wird bewusst nicht verwendet: Es durchsucht auch `Received`, `DKIM` und ähnliche Kopfzeilen, die die Stichwörter nie durchsuchen, und würde nur unnötig Mails laden.
- Geladen werden **nur die Kandidaten** (Kopf-Treffer und Server-Treffer, `BODY.PEEK[]`, bis 10 MB) und dann genau mit dem ganzen Text geprüft; die Ingest-Route prüft noch einmal. Ein Server-Treffer ohne echten Treffer zählt als „ohne Stichwort“.
- **Rückfall:** Lehnt der Server die Suche ab (`NO`/`BAD`, etwa `BADCHARSET`), lädt der Hilfsprozess alle Mails des Blocks (bis 10 MB) und prüft sie lokal. Die Karte sagt dann „Der Anbieter durchsucht Mail-Texte nicht; die App lädt die Mails dafür einzeln (langsamer).“, `scan.fallback` ist gesetzt.
- **Befund zu den Anbietern (Recherche 2026-09-27, ohne echte Postfächer):** Gmail übersetzt IMAP-`SEARCH` in die eigene Suche; `BODY` gilt dort als „best effort“ und findet ganze Wörter, keine beliebigen Teilzeichenketten. Für Web.de gibt es keine öffentliche Aussage zur Suche; die meisten IMAP-Server suchen nach RFC 3501 als Teilzeichenkette ohne Rücksicht auf Groß-/Kleinschreibung. Mit echten Postfächern ließ sich das hier nicht prüfen (keine echten Zugangsdaten); das ist ein manueller Testfall.
- **Grenzen:** Kopfzeilen werden immer genau geprüft. Im Text kann die Suche des Servers einen Treffer übersehen, den `keywords.ts` fände: bei Gmail ein Stichwort nur als Wortanfang eines längeren Wortes („todo“ in „Todos“), bei allen Anbietern eine Phrase über einen Zeilenumbruch, Akzente ohne Umlaut („cafe“ für „café“) und Groß-/Kleinschreibung außerhalb von ASCII, falls der Server sie nicht faltet. Solche Mails holt „Aus dem Postfach wählen“. Mails über 10 MB werden übersprungen und gezählt.

**Speicher und Einstellungen:**
- Neues JSON-Feld `connections.scan` (Migration `1790201700_connections_scan.js`, nur der Server schreibt es, `connection-rules.SERVER_FIELDS`): `signature`, `state` (`running`, `paused`, `done`, `cancelled`, `error`), `uid_validity`, `until`, `below`, `done`, `total`, `created`, `fallback`. Ein Wechsel des Postfachs setzt es zurück.
- **`match_body` ist jetzt standardmäßig an:** Neue Postfächer entstehen mit `match_body: true`. Die Migration schaltet es für bestehende Postfächer ohne `match_body` ein und merkt sich das in `scan.match_body_before = false`; die Status-Route behält diese Marke. Die Down-Migration schaltet genau diese Postfächer wieder aus, solange der Nutzer es nicht selbst geändert hat, und entfernt das Feld. Andere Einstellungen und `updated` bleiben unverändert (Rollback-Test in `migrations-rollback.test.mjs`).
- **Routen:** Hilfsprozess `POST /scan` mit `{ connection, action: "start" | "cancel" }`; Hook `POST /api/byl/connections/{id}/scan` (angemeldet, Verbindung sichtbar, Art `mail`, eingeschaltet). Läuft im Hilfsprozess kein Scan (Neustart, beendet), markiert „Abbrechen“ den gespeicherten Zustand selbst als abgebrochen. Ein älterer Hilfsprozess antwortet auf `/scan` mit 404; die App bittet dann um `stop.bat`, dann `start.bat`.
- **Postfach-Auswahl:** Die Vorauswahl prüft mit `match_body` auch die Kopfzeilen (genau) und den Text über die Suche des Servers, ohne eine Mail zu laden; lehnt der Server die Suche ab, bleibt es bei den Kopfzeilen.
- **Karte:** Die Karte eines Postfachs zeigt die Zeile „Posteingang“ (`mailScanText`): „wird durchsucht: 1.200/4.800“ mit Fortschrittsbalken, „pausiert bei …, bisher N Einträge übernommen“, „durchsucht: 4.800 Mails, N Einträge übernommen“, „abgebrochen bei …“ bzw. „unterbrochen bei …, geht beim nächsten Abruf weiter“. Während der Scan läuft, gibt es „Abbrechen“, im Menü „…“ steht „Posteingang neu durchsuchen“ (nur eingerichtete, eingeschaltete Postfächer). Die Seite „Kanäle“ beobachtet ihre Postfächer per Realtime (`ConnectionsStore.watch`, eine Subscription je Postfach, kein Polling); der Fortschritt erscheint also, sobald der Hilfsprozess ihn meldet. Antworten gehen als Flag hinaus; nur ein echter Fehler ist rot, „Hilfsprozess läuft nicht“ ist neutral.

**Leistung (Abschätzung für 5 000 Mails, 5 Stichwörter):** 10 Blöcke mit je einem Abruf der Kopfzeilen (etwa 0,5 bis 1 KB je Mail, zusammen wenige MB) und 5 `UID SEARCH`; geladen werden nur die Kandidaten. Im Rückfall werden alle Mails bis 10 MB geladen, bei einem typischen Posteingang mehrere hundert MB; deshalb nur blockweise und nur, wenn der Server die Suche ablehnt.

`byl-mail.exe` geht auf 0.7.0.

## Nachtrag 4 (2026-10-01): Bestätigung des Bots abschaltbar

Neben `reply_no_match` (§3) kennt eine Telegram-Verbindung `reply_saved`: ob der Bot einen gespeicherten Eintrag mit „Im Eingang gespeichert“ bestätigt. Beide sind standardmäßig an, ein fehlender Wert gilt als an, und beide stehen als Schalter an Karte, Dialog und Assistent. Einzelheiten und Korrekturen zum Abschnitt „Telegram“: [ADR-0016](0016-kanal-architektur-und-mail.md) §2, Nachtrag mit Korrekturvermerk vom 2026-10-01.

## Nachtrag 5 (2026-10-02, [ADR-0050](0050-github-kanal-und-beobachtete-quellen.md)): GitHub ohne Stichwörter – die Auswahl ist der Filter

Der GitHub-Kanal ist ein automatischer Kanal (§4), hat aber **keine Stichwörter**. Übernommen wird alles, was die Auswahl der Verbindung trifft: die beobachteten Pfade (Globs je Repository) für Dateiänderungen, dazu Pull Requests und Releases, je Repository ein- und ausschaltbar.

- **Begründung:** Die Stichwörter von §1 bis §4 trennen aus einem Strom, den der Nutzer nicht auswählt (jede Mail des Posteingangs, jede Nachricht an den Bot, jeder Termin des Kalenders), die Arbeit vom Rest. Bei GitHub wählt der Nutzer die Quelle selbst und eng: genau diese Repositorys, genau diese Dateien („ROADMAP*“, „CHANGELOG*“ …), genau diese Ereignisse. Ein zusätzliches Stichwort in einem Changelog oder einem PR-Titel würde gerade die Änderungen verbergen, um die es dem Nutzer geht („sehen, was sich in Roadmaps, Changelogs, etc. geändert hat“), und eine weitere Liste pflegen lassen, ohne etwas zu filtern, was die Auswahl nicht schon filtert.
- **Folgen:** `connection-rules.js` lässt für `github` keine `keywords` zu (`validation_github_settings`); ein Lauf zählt nie „ohne Stichwort“ (`unmatched` bleibt 0); die Karte zeigt keine Warnung „Keine Stichwörter“ und keinen Stichwort-Editor. Die Flut, vor der Stichwörter sonst schützen, verhindert hier die Ersterfassung ohne Einträge (ADR-0050 §3 und §4).
