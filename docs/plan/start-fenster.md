# E6-Plan, Teil Start und Fenster: Einstieg per Datei, kein zweiter Tab, installierbare Web-App

- **Stand:** in Arbeit (2026-09-28): SF-1 (#137, Routen), SF-2 (#138, Landing per Datei), SF-3 (#139, Hinweis im Tab, zweiter Tab), SF-4 (`start.bat` und `stop.bat`) in Umsetzung.
- **Grundlage:**
  - [ADR-0035](../adr/0035-start-einstieg-und-offene-tabs.md) (Entscheidungen, Routen, Sicherheit, Alternativen)
  - [ADR-0002](../adr/0002-erststart-und-superuser.md) §6, [ADR-0007](../adr/0007-realtime-und-sitzungspflege.md), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0028](../adr/0028-plattform-strategie.md) §6
  - [Plan Plattformen](plattformen.md), Stufe S1 (hier zusammengeführt)
  - [CLAUDE.md](../../CLAUDE.md) §3, §5, §7, §9, §10, §11, §12
- **Einordnung:** Nutzerentscheidungen vom 2026-09-28: Die Datei-Seite prüft immer den Server und zählt wie im Task-Board 5 s herunter („Jetzt öffnen“, „Abbrechen“, „App öffnen“ immer da). `start.bat` öffnet keinen zweiten Tab, der vorhandene Tab zeigt ein Flag und blinkt im Titel. Ein doppelter Tab schließt sich nach 5 s selbst („Hier weiterarbeiten“). Windows-Benachrichtigung als Opt-in, standardmäßig aus. Installierbare Web-App mit `focus-existing`, `start.bat` bevorzugt die installierte App. Fail-open. Kein Win32-Fensterfokus. Die Nummern: ADR-0035 (0034 ist belegt), Manifest-IDs ab `BYL-E6-280` (bis 270 belegt), Paketkürzel `SF`.

## 1. Querschnittsregeln

- **Skripte werden nie ausgeführt** (CLAUDE.md §11.3). `byl-control.ps1` und `byl-functions.ps1` werden statisch und über reine PowerShell-Funktionen geprüft (`runPowerShellJson`), die Hooks gegen den Harness mit Wegwerf-Superuser.
- Neue Hook-Routen haben reine ES5-Module unter `lib/` mit Unit-Tests und einen Integrationstest gegen den Harness.
- Hinweise nur über den `FlagSink`, Neustart-Texte über `restartNeeded()`/`RESTART_NEEDED`, Modals nur über die Overlay-Bausteine (kein eigenes `<dialog>`).
- Keine neue Abhängigkeit. Farben nur aus `tokens.css`; das Manifest und `theme-color` gleichen die Tokens per Test.
- Ein Hook-Paket wird nur fertig getestet committet und nie als Experiment im Ordner `app/` liegen gelassen.
- Was jsdom und der Harness nicht können (echter Browser, `file://`, Installation, Fenster, Benachrichtigungen), steht als manueller Fall im Test-Manifest.
- **Gates je Paket:**
  - eigener Branch und PR
  - `scripts\build.ps1` lokal komplett grün (Exit-Code 0 und „Build complete!“)
  - CI grün, höchstens drei Versuche; ein roter PR hält die folgenden auf
  - Squash-Merge, Test-Manifest nachgezogen, Entscheidungen in §3

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| SF-1 | ADR-0035, dieser Plan; Routen `presence` und `attention` (`presence.pb.js`, `lib/presence-service.js`, `lib/presence-rules.js`); Unit- und Integrationstests mit EventSource | BYL-E6-280 |
| SF-2 | Landing `app\becauseyoulovejira.html`, Weiche `file:` in `app.html`, README, CLAUDE.md §9; jsdom-Tests der Weiche und der Landing, statischer Test | BYL-E6-281, BYL-E6-282 (manuell) |
| SF-3 | App-Seite: Abo `byl/attention`, Ack, Flag, Titel-Blinken, Hinweis „beendet“, BroadcastChannel und Modal „Die App ist schon offen“ | BYL-E6-283, BYL-E6-284 (manuell) |
| SF-4 | `byl-control.ps1`: `Resolve-BrowserAction` vor jedem Öffnen (Kaltstart 3 s), `stop.bat` meldet den Stopp; reine Funktionen in `byl-functions.ps1` | BYL-E6-285, BYL-E6-286 (manuell) |
| SF-5 | Installierbare Web-App (S1): Manifest, Icons, Service Worker mit Hinweisseite, `theme-color`, `launchQueue`, `start.bat` bevorzugt die installierte App, README „Als App installieren“ | BYL-E6-287, BYL-E6-288 (manuell) |
| SF-6 | Systembenachrichtigung als Opt-in unter „Einstellungen → Darstellung“ | BYL-E6-289, BYL-E6-290 (manuell) |

## 3. Entscheidungen

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-28 | SF-1 | **Reihenfolge:** Routen vor der Landing-Seite, damit die Landing gleich gegen echte Routen gebaut und getestet wird. S1 aus dem Plan Plattformen wird Paket SF-5. |
| 2026-09-28 | SF-1 | **Grund in der Adresse, kein Body:** `POST /api/byl/attention?reason=…` ist für die Landing-Seite (`file://`) eine einfache CORS-Anfrage ohne Preflight; PowerShell sendet dasselbe. |
| 2026-09-28 | SF-1 | **Nur Loopback:** Presence und Attention verlangen neben den Kopfzeilen `e.remoteIP()` auf Loopback. Hinter einem späteren Proxy (S2/S3) sind sie damit gesperrt; das Ack braucht ohnehin eine Anmeldung. |
| 2026-09-28 | SF-1 | **Nur App-Nutzer zählen:** Gäste mit Abo (jede Seite kann eine SSE-Verbindung öffnen und das Thema abonnieren) und Superuser zählen nicht als Tab und bekommen keine Nachricht. So kann eine fremde Seite `start.bat` nicht vorgaukeln, ein Tab sei offen. |
| 2026-09-28 | SF-1 | **Werte im Store als Text bzw. Zahl:** `$app.store()` teilt Werte zwischen den JS-Laufzeiten des Servers; Objekte würden als Go-Map geteilt. Einträge sind deshalb JSON-Text, Zeiten Zahlen. Die Rate-Grenze setzt der Store atomar (`setFunc`). |
| 2026-09-28 | SF-1 | **Landing gesehen auch bei 429:** Eine Anfrage mit `Origin: null` setzt den Zeitstempel vor der Rate-Grenze, damit `start.bat` die Landing-Seite auch dann sieht, wenn gerade eine andere Nachricht hinausging. |
| 2026-09-28 | SF-2 | **Zustandsmaschine rein im Skript:** `next(state, event)` mit den Phasen `checking`, `down`, `asking`, `countdown`, `cancelled`, `opening`, `elsewhere`, `kept`, `closing`, `closed`, erreichbar über `window.BylLanding`. Der Test führt das Inline-Skript mit falschem Fenster aus; es gibt keine zweite Kopie der Logik. |
| 2026-09-28 | SF-2 | **Keine animierten Punkte:** Statt „Prüfe automatisch …“ mit Animation steht „Zuletzt geprüft: hh:mm:ss“ außerhalb der Live-Region. Die Live-Region ändert sich nur beim Wechsel der Phase, also einmal je Countdown; die Sekunden stehen nur im Knopf („Jetzt öffnen (4 s)“). Damit entfällt auch der Sonderfall für `prefers-reduced-motion`. |
| 2026-09-28 | SF-2 | **Auch das Schließen lässt sich anhalten:** Neben „Jetzt schließen“ und „Trotzdem hier öffnen“ hält „Abbrechen“ den Countdown des Schließens an (WCAG 2.2.1), wie beim Öffnen. |
| 2026-09-28 | SF-2 | **Jede Antwort außer einem Ack heißt „kein Tab“:** 404 (Server vor dem Neustart ohne Route), 429, CORS-Fehler, eine ungültige Nonce oder kein Ack binnen 2 s führen zum Öffnen der App (Fail-open). Über `http:` geladen geht die Seite sofort auf `/`. |
| 2026-09-28 | SF-3 | **Ack ohne Warten:** Der Tab schickt das Ack zuerst ab und zeigt den Hinweis sofort, ohne auf die Antwort zu warten; ein gescheitertes Ack ändert am Hinweis nichts (für `start.bat` gilt dann Fail-open). |
| 2026-09-28 | SF-3 | **Ein Flag statt eines Stapels:** Eine weitere Nachricht ersetzt das Flag „erneut geöffnet“. „Beendet“ bleibt ohne Zeitablauf stehen (`duration: null`), bis das SDK neu verbunden hat (`PB_CONNECT` mit neuer Client-ID) oder eine Nachricht `start` kommt; es ist neutral (Info), weil nichts schiefging. |
| 2026-09-28 | SF-3 | **Kanal im Wurzel-Layout, Hinweis im App-Layout:** `TabPresence` und `TitleBlinker` entstehen im Wurzel-Layout und gehen per Kontext (`getTabContext`, ohne Wurzel `null`) an das `(app)`-Layout. Der zuletzt angemeldete Empfänger von `attention` gewinnt: im App-Layout der `AttentionStore` (Flag und Blinken), sonst (Anmeldung) nur das Blinken. |
| 2026-09-28 | SF-3 | **Ein prüfender Tab antwortet nicht:** Solange ein neuer Tab selbst fragt, antwortet er nicht mit `here`; erst wenn er bleibt (kein anderer Tab oder „Hier weiterarbeiten“). So schließen sich zwei gleichzeitig geöffnete Tabs nicht gegenseitig. |
| 2026-09-28 | SF-3 | **Esc, × und Schleier behalten den Tab:** Das Modal hat keine ungespeicherten Eingaben; jeder Schließweg des Bausteins bedeutet „Hier weiterarbeiten“ und hält den Countdown an (WCAG 2.2.1). Der Tab der installierten App (`display-mode: standalone`) fragt nie, `focus-existing` regelt ihn (SF-5). |
| 2026-09-28 | SF-4 | **Ganze Entscheidung als reine Funktion:** `Resolve-BrowserAction` in `byl-functions.ps1` bekommt die drei Anfragen, Uhr und Warten als Skriptblöcke; `byl-control.ps1` reicht nur die echten Anfragen (`Get-Presence`, `Send-Attention`, `Get-AttentionAcked` über `Invoke-LocalRequest`) hinein. So prüfen die Tests alle Wege samt Frist und Takt mit falscher Uhr, ohne je zu warten; `byl-functions.ps1` bleibt ASCII. |
| 2026-09-28 | SF-4 | **Takt 250 ms, Timeout je Anfrage 1,5 s:** Beim Kaltstart fragt `start.bat` im Takt von 250 ms bis zu 3 s nach Präsenz, danach wartet es im selben Takt bis zu 2 s auf ein Ack. Ohne Kaltstart gibt es genau eine Frage. `Start-Sleep -Milliseconds` ist keine feste Wartezeit im Sinne von `start-scripts.test.mjs`. |
| 2026-09-28 | SF-4 | **Kein benachrichtigter Tab heißt öffnen:** Meldet der Server `notified: 0` (Tab gerade weg) oder 429, öffnet `start.bat` sofort, ohne auf ein Ack zu warten. |
| 2026-09-28 | SF-4 | **Stopp-Meldung nur mit eigener Instanz:** `stop.bat` sendet `stop` nur, wenn es eine eigene PocketBase gefunden hat, vor dem Beenden des Mail-Hilfsprozesses, mit 1 s Timeout, ohne Ack und ohne Ausgabe. Scheitert sie, läuft der Stopp unverändert. |
| 2026-09-28 | SF-4 | **Invoke-LocalRequest im Integrationstest:** Die Funktion läuft einmal gegen die Wegwerf-Instanz (Presence, Attention, Zustand, nicht erreichbarer Port). Das prüft, dass .NET ohne `Origin` und `Sec-Fetch` fragt und die Routen sie als Skript sehen; die Start- und Stopp-Skripte selbst laufen weiterhin nie. |
