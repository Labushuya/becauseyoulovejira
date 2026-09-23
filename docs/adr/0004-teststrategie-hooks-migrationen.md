# ADR-0004: Teststrategie für Hooks und Migrationen

- **Status:** Angenommen
- **Datum:** 2026-09-24
- **Entscheidung durch:** Advisor

## Kontext

Die Serverlogik von becauseyoulovejira steckt in PocketBase-JS-Hooks (Goja, ES5, keine Node-APIs) und handgeschriebenen JS-Migrationen. Beides läuft nur innerhalb von `pocketbase.exe` und lässt sich in Node nicht direkt ausführen. CLAUDE.md §3 legt fest: Vitest, Hook-Integrationstests per Skript gegen eine Wegwerf-Instanz mit temporärem `--dir`. CLAUDE.md §11 verlangt zufällige Zugangsdaten, `superuser upsert` vor jedem `serve` (sonst öffnet sich der Installer im Browser), das garantierte Beenden aller Prozesse und das Löschen des Temp-Ordners.

## Entscheidung

Drei Testebenen, alle in Vitest:

1. **Unit-Tests (schnell, ohne PocketBase):** Reine Logik liegt in `app/pb_hooks/lib/*.js` (CommonJS, ES5, ohne Abhängigkeiten, ohne `$app`) und wird in Vitest per `createRequire` geladen, zum Beispiel Status-Kategorien, Scope- und Key-Berechnung, Feld-Diff der Historie und später Wiederholungsregeln. Spiegel-Module im Frontend (`web/src/lib/domain/*.ts`) werden per Test gegen ihr Hook-Pendant abgeglichen.
2. **Migrationstests:** Alle Migrationen laufen gegen einen leeren Wegwerf-Datenordner (`pocketbase migrate up`) und dann komplett zurück (`migrate down <n>`) und wieder hoch. Der Test belegt, dass jede Migration eine funktionierende Rollback-Funktion hat. Das resultierende Schema (Collections, Felder, Indizes, Regeln, Settings) wird über die Superuser-API der Wegwerf-Instanz geprüft.
3. **Hook- und API-Integrationstests:** Eine Wegwerf-PocketBase-Instanz pro Testlauf, gesteuert von einem Vitest-`globalSetup` in Node:
   - Temp-Ordner über `fs.mkdtemp(os.tmpdir()/byl-test-)`.
   - Zufällige Zugangsdaten über `crypto.randomBytes`: Superuser-E-Mail `test-<hex>@example.com`, Passwort 32 Byte base64url. Sie werden per Vitest `provide`/`inject` weitergereicht, nie auf Platte geschrieben und nie geloggt.
   - Reihenfolge (hart): (1) `pocketbase superuser upsert --dir=<tmp>` und Exit-Code prüfen, bei Fehler abbrechen, ohne `serve` zu starten; (2) `pocketbase serve --dir=<tmp> --http=127.0.0.1:<freier Port> --hooksDir=app/pb_hooks --migrationsDir=app/pb_migrations --publicDir=<leerer Temp-Unterordner> --automigrate=false` per `child_process.spawn` mit `windowsHide: true`, ohne `shell`; (3) `/api/health` mit Timeout pollen.
   - Freier Port: vorher per `net.createServer().listen(0, '127.0.0.1')` ermitteln. Nie Port 8090, damit eine laufende Produktivinstanz unberührt bleibt.
   - Isolation: Jede Testdatei legt über die Superuser-API eigene App-Nutzer mit zufälligen E-Mails an. Tests teilen sich die Instanz, aber keine Daten.
   - Teardown (`globalSetup`-Rückgabe und Handler für `exit`/`SIGINT`): Prozess beenden (`taskkill /PID <pid> /T /F` unter Windows) und auf das Ende warten. Danach den Temp-Ordner mit Wiederholungen löschen, weil Windows Dateisperren verzögert freigibt.
   - `pocketbase.exe` fehlt: Die Integrationstests schlagen mit dem Hinweis auf `scripts/fetch-pocketbase.ps1` fehl, statt still übersprungen zu werden.
4. **Pflicht-Testfälle für Sicherheit:** Jede Collection-Regel bekommt einen Positivtest (Owner) und Negativtests mit einem zweiten Nutzer: Zugriff auf fremde Datensätze per list, view, update, delete und Realtime-Subscription, Anlage mit fremdem `owner`, Übernahme per `owner`-Änderung, Anlage bei gesperrter Registrierung. Für die Haushalts-Joins zusätzlich ein Fall, in dem der zweite Nutzer Mitglied eines *anderen* Haushalts ist.
5. **Befehle:** `npm test` führt Unit- und Integrationstests aus (Qualitäts-Gate laut CLAUDE.md §12). `npm run test:unit` läuft zusätzlich allein für schnelle Iteration.

## Alternativen

- **Hooks in Node mit gemocktem `$app` testen:** Die Mocks würden das Verhalten der gepinnten PocketBase-Version (Transaktionen, Regeln, Realtime) nicht abbilden, und die Tests wären trügerisch grün. Verworfen; nur reine `lib`-Module werden in Node getestet.
- **Eigenes PowerShell-Testskript statt Vitest-`globalSetup`:** zwei Testwelten und schlechtere Fehlerberichte. Verworfen. Das PowerShell-Muster aus CLAUDE.md §11.2 bleibt Referenz für manuelle Spikes.
- **Eine Instanz je Testdatei:** saubere Isolation, aber langsamer (Start und Migration je Datei). Verworfen zugunsten nutzergetrennter Daten; bei Bedarf später umstellbar.
- **Tests gegen `app/pb_data`:** gefährdet echte Daten und öffnet ohne Superuser den Installer. Ausgeschlossen.

## Konsequenzen

- Positiv: Tests laufen gegen genau die ausgelieferte Binary und die echten Hook- und Migrationsdateien.
- Positiv: Keine Zugangsdaten auf Platte, kein Browser-Fenster, keine liegengebliebenen Prozesse oder Ordner.
- Negativ: Integrationstests brauchen `pocketbase.exe` und dauern einige Sekunden länger.
- Negativ: Hook-Code außerhalb von `lib/` ist nur über die API testbar. Deshalb gehört Logik in `lib/`, die `*.pb.js`-Dateien bleiben dünn.
- `hooksWatch` hat unter Windows keine Wirkung. Hook-Änderungen erfordern einen Neustart; für Tests ist das unerheblich.
