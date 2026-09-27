# ADR-0017: Parser für `.ics` im Hook, für `.eml` im Browser und im Hilfsprozess

- **Status:** Angenommen
- **Datum:** 2026-09-25
- **Entscheidung durch:** Advisor
- **Bezug:** [ADR-0005](0005-zeitzone-europe-berlin.md) (keine Zeitzonen-APIs der Laufzeit), [ADR-0014](0014-datenmodell-eingang.md) (Eingang), [ADR-0016](0016-kanal-architektur-und-mail.md) (Kanäle)

## Kontext

`.ics` (iCalendar, RFC 5545) und `.eml` (Internet Message Format, RFC 5322 mit MIME) sind die Grundlage für Kalender und Mail:

- `.ics` kommt als Datei (Drag & Drop) und als Feed von Google Calendar. Den Feed ruft ein Cron im Hook ab ([ADR-0016](0016-kanal-architektur-und-mail.md) §2); dort muss also ein Parser in der Goja-JSVM laufen (ES5, CommonJS, keine Node-APIs, kein `Intl`, keine Zeitzonendatenbank).
- `.eml` kommt als Datei im Browser und aus dem Postfach über den Node-Hilfsprozess. Die JSVM kann keine Postfächer abrufen und bräuchte den Parser also nur für hochgeladene Dateien.

Was die Formate verlangen:

| | `.ics` | `.eml` |
|---|---|---|
| Struktur | Zeilen mit Faltung (RFC 5545 §3.1), Eigenschaften mit Parametern, `BEGIN`/`END`-Blöcke | Kopfzeilen mit Faltung, verschachtelte Multipart-Teile, Grenzen (Boundary) |
| Kodierung | UTF-8, Text-Escapes (`\n`, `\,`, `\;`) | Base64, Quoted-Printable, RFC-2047-Wörter im Kopf, **beliebige Zeichensätze** (ISO-8859-x, Windows-125x, UTF-8) |
| Zeit | `DATE`, `DATE-TIME` in UTC, „floating“ oder mit `TZID` | `Date`-Kopf mit Offset |

Goja hat kein `TextDecoder`. Zeichensätze außer UTF-8 und Latin-1 müssten dort von Hand dekodiert werden; bei `.eml` ist das der schwierigste und fehleranfälligste Teil. Browser und Node haben `TextDecoder` mit allen gängigen Zeichensätzen.

## Entscheidung

### 1. `.ics`: ein Parser, ES5, im Hook

- Reines Modul `app/pb_hooks/lib/ical.js` (CommonJS, ES5, ohne Abhängigkeiten, wie `recurrence.js`), unter den Regeln von `hooks-lib-constraints.test.mjs`.
- Umfang: Entfalten, Eigenschaften mit Parametern und Text-Escapes, `VEVENT` (→ `kind = event`) und `VTODO` (→ `kind = todo`, `DUE` als Quelldatum). Übernommen werden `UID`, `RECURRENCE-ID`, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `URL`, `DTSTART`, `DTEND`/`DURATION`, `DUE`, `STATUS` (abgesagte Termine werden übersprungen), `RRULE` (roh in `source_meta`, für E5). Alles andere wird ignoriert. `VALARM`, Anhänge und Teilnehmer werden nicht gelesen.
- **Zeit:** `DATE` bleibt Kalenderdatum (ganztägig). `DATE-TIME` mit `Z` ist UTC. `TZID=Europe/Berlin` (und die Windows-Bezeichnung `W. Europe Standard Time`) wird über das neue reine Modul `app/pb_hooks/lib/berlin-time.js` nach UTC umgerechnet ([ADR-0005](0005-zeitzone-europe-berlin.md) §2; entsteht damit in E4, wie in [ADR-0011](0011-roadmap-e3-bis-e7.md) §3 vorgesehen). Andere `TZID` und „floating“ werden als Berliner Ortszeit gelesen und im Eintrag als „Zeitzone angenähert“ vermerkt. Das genügt, weil das Quelldatum nur ein Hinweis ist und nie automatisch zur Fälligkeit wird.
- **Grenzen:** Datei bzw. Feed höchstens 20 MB, höchstens 5 000 Komponenten je Datei, Textfelder auf die Feldgrenzen von `inbox_items` gekürzt. Ungültige Zeilen werden übersprungen und gezählt, nicht als Fehler der ganzen Datei gewertet.
- **Datei-Import:** Die SPA sendet die Datei an die Route `POST /api/byl/inbox/ics` (angemeldeter Nutzer, Multipart). Die Route parst, legt über `inbox-service.js` Einträge an und antwortet mit Zahlen: neu, schon vorhanden, übersprungen. Jeder Eintrag bekommt als `original` den eigenen `VEVENT`/`VTODO`-Ausschnitt (samt `VCALENDAR`-Hülle), nicht die ganze Datei.

### 2. `.eml`: `postal-mime` in SPA und Hilfsprozess, eine gemeinsame Normalisierung

- Parser: **`postal-mime`** (MIT-0, keine Abhängigkeiten, läuft im Browser und in Node; Grenzen `maxNestingDepth`, `maxHeadersSize`). Kein eigener MIME-Parser.
- **Normalisierung** als reines TypeScript-Modul `web/src/lib/domain/inbox-mail.ts`: `mailToDraft(email)` → Entwurf mit `title` (Betreff, sonst „(ohne Betreff)“), `body` (Kopfblock „Von“, „An“, „Datum“, dann Text), `source_ref` (Message-ID), `source_date` (`Date`), `source_meta` (Absender, Empfänger, Anzahl Anhänge). Nur-HTML-Mails wandelt eine eigene, reine Funktion `htmlToText` in Text (Blockelemente zu Zeilen, Links als „Text (URL)“, Entities, alles andere entfernt). Kein `DOMParser`, damit SPA und Hilfsprozess **dasselbe** Ergebnis erzeugen. Der Hilfsprozess bündelt dieses Modul mit esbuild ein.
- Anhänge werden nicht übernommen (Stufe 2); ihre Zahl steht im Eintrag, und das Original ist als Datei am Eintrag abrufbar.
- **Grenzen:** `.eml` höchstens 10 MB (größere: Hinweis, kein Import), Text auf 100 000 Zeichen gekürzt. Seit [ADR-0031](0031-herkunft-sichern.md) §4 kommt eine größere Mail aus ihren ersten 2 MB ohne Originaldatei in den Eingang, statt abgelehnt zu werden.

### 3. WhatsApp-Export und übrige Formate

- WhatsApp-Chat-Export: reines TypeScript-Modul `web/src/lib/domain/whatsapp-export.ts` im Browser (Zeilenformate von Android und iOS in deutscher und englischer Einstellung, mehrzeilige Nachrichten, Systemzeilen). `.zip` liest ein kleines eigenes Modul (zentrales Verzeichnis, nur der Eintrag `_chat.txt` bzw. die eine `.txt`) mit `DecompressionStream('deflate-raw')`, ohne Bibliothek. Zeiten im Export haben keine Zeitzone und gelten als Berliner Ortszeit.
- Telegram- und Notion-Antworten sind JSON; ihre Abbildung auf Entwürfe sind reine ES5-Module im Hook.

## Alternativen

- **`.ics` im Browser parsen:** Der Kalender-Feed läuft im Hook, der Parser müsste dort ohnehin existieren. Zwei Parser würden auseinanderlaufen. Verworfen.
- **Eine Bibliothek für `.ics`** (etwa `ical.js`): moderne Syntax statt ES5, in Goja nicht ohne Umbau lauffähig, groß für den kleinen Ausschnitt, den wir brauchen. Verworfen.
- **`.eml` im Hook parsen:** Zeichensätze ohne `TextDecoder` von Hand, verschachtelte MIME-Teile in ES5; hohes Fehlerrisiko und keine Wiederverwendung im Hilfsprozess. Verworfen.
- **`mailparser` im Hilfsprozess und `postal-mime` in der SPA:** zwei Parser mit leicht unterschiedlichen Ergebnissen für dieselbe Mail. Verworfen zugunsten eines Parsers in beiden Laufzeiten.
- **`DOMParser` für HTML-Mails im Browser:** nicht in Node vorhanden, die Ergebnisse wären je Weg verschieden. Verworfen.
- **Eine ZIP-Bibliothek für WhatsApp:** Für genau eine Textdatei reichen das zentrale Verzeichnis und `DecompressionStream`. Verworfen.

## Konsequenzen

- `berlin-time.js` entsteht in E4 mit den Pflichtfällen aus ADR-0005 §3 und dem Abgleich gegen `web/src/lib/domain/berlin-date.ts`.
- Neue Laufzeitabhängigkeit der SPA: `postal-mime` (ohne eigene Abhängigkeiten, lokal gebündelt; Größe im Paket messen).
- Testdaten: anonymisierte Beispieldateien unter `tests/fixtures/` (`.ics` von Google, Outlook und Apple; `.eml` mit UTF-8, ISO-8859-1, Windows-1252, Quoted-Printable, Base64, Nur-HTML, ohne Message-ID; WhatsApp-Exporte). Keine echten Mails oder Chats im Repo.
