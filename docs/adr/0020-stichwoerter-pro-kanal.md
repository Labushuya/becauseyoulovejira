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
