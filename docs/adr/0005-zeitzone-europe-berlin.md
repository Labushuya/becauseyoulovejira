# ADR-0005: Zeitzone Europe/Berlin ohne Zeitzonendatenbank der Laufzeit

- **Status:** Angenommen
- **Datum:** 2026-09-24
- **Entscheidung durch:** Advisor

## Kontext

CLAUDE.md §5 legt fest: Fälligkeiten sind reine Kalenderdaten (`YYYY-MM-DD 00:00:00.000Z`), maßgeblich für „heute“ ist `Europe/Berlin`. Relevant wird das für Überfälligkeit, Wiederholungsregeln und Cron (E4).

Befund (Wegwerf-Migration mit `pocketbase migrate up`, PocketBase 0.40.4, Windows 10, 2026-09-24):

| Ausdruck in der JSVM | Ergebnis |
|---|---|
| `String(new Timezone("Europe/Berlin"))` | `UTC` |
| `new DateTime("2026-07-01 12:00:00", "Europe/Berlin").string()` | `2026-07-01 12:00:00.000Z` (erwartet wäre `10:00:00.000Z`) |
| `new Date(2026, 6, 1).getTimezoneOffset()` | `-120` (Windows-Systemzeitzone des Rechners) |
| `typeof Intl` | `undefined` |

Ursache: Die offizielle Windows-Binary bettet keine Zeitzonendatenbank ein (kein `time/tzdata`, kein Treffer für `Europe/Berlin` in der Binary). Ohne Go-Installation bzw. `ZONEINFO` schlägt `time.LoadLocation` fehl, und die JSVM fällt **stillschweigend auf UTC** zurück (`plugins/jsvm/binds.go`). Das JS-`Date` nutzt die Systemzeitzone von Windows, und die hängt vom Rechner ab statt fest von Europe/Berlin.

## Entscheidung

1. Serverseitig werden **keine** Zeitzonen-APIs der Laufzeit (`Timezone`, `DateTime` mit Zonenname, lokale `Date`-Methoden) für fachliche Berechnungen genutzt.
2. Ein reines Modul `app/pb_hooks/lib/berlin-time.js` (CommonJS, ES5) rechnet einen UTC-Zeitpunkt in das Berliner Kalenderdatum um. Es implementiert die EU-Sommerzeitregel (MESZ vom letzten Sonntag im März, 01:00 UTC, bis zum letzten Sonntag im Oktober, 01:00 UTC; sonst MEZ = UTC+1).
3. Vitest-Pflichtfälle: beide Umstellungszeitpunkte jeweils ±1 Minute, Jahreswechsel, Schaltjahr, Tagesgrenze 22:00/23:00 UTC.
4. Im Frontend ist `Intl.DateTimeFormat` mit `timeZone: 'Europe/Berlin'` verfügbar und wird dort genutzt. Ein Test gleicht Frontend- und Hook-Berechnung über eine Stichprobe von Zeitpunkten ab.
5. Cron-Ausdrücke (`cronAdd`, Backup-Cron) gelten in UTC. Kalenderbasierte Jobs in E4 laufen deshalb stündlich und entscheiden per `berlin-time.js`, ob für das Berliner „heute“ etwas fällig ist, statt auf eine Berliner Uhrzeit im Cron-Ausdruck zu setzen.
6. Das Modul entsteht in E4 (erster fachlicher Nutzer). E1 braucht kein „heute“: `completed_at` ist ein UTC-Zeitstempel, und die Validierung von `due` prüft nur das Format.

## Alternativen

- **`ZONEINFO` auf eine mitgelieferte `zoneinfo.zip` setzen:** Die Datei müsste in `app/` liegen und aktuell gehalten werden, und die Umgebungsvariable müsste zuverlässig von allen Startwegen (start.bat, Autostart, Tests) gesetzt werden. Fällt sie weg, rechnet PocketBase wieder unbemerkt in UTC. Verworfen, weil der Fehler still bliebe.
- **Windows-Systemzeitzone über `Date` verwenden:** falsch, sobald der Rechner anders eingestellt ist (Reisen, Server in anderer Zone). Verworfen.
- **Eigene PocketBase-Build mit `time/tzdata`:** widerspricht CLAUDE.md §3 (unveränderte Binary, kein Go-Build). Verworfen.

## Konsequenzen

- Positiv: deterministisch, unabhängig von Rechner und Umgebungsvariablen, vollständig unit-testbar.
- Negativ: Die Sommerzeitregel ist fest kodiert. Ändert die EU die Regel (Abschaffung der Zeitumstellung), muss das Modul angepasst werden. Das Risiko ist gering und durch Tests leicht nachvollziehbar.
- Hinweis für Hook-Autoren: `new DateTime(x, "Europe/Berlin")` und `new Timezone(...)` sind in diesem Projekt tabu. Das wird im E1-Plan und bei E4 in der CLAUDE.md festgehalten.
