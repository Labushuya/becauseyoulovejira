# E6-Plan, Teil Start und Fenster: Einstieg per Datei, kein zweiter Tab, installierbare Web-App

- **Stand:** in Arbeit (2026-09-28): SF-1 (Routen) in Umsetzung.
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
