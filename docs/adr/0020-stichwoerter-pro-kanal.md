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
