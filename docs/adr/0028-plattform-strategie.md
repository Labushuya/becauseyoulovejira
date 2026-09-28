# ADR-0028: Plattform-Strategie – ein Server je Datenbestand (PC oder Raspberry Pi), Clients als Web-App, Android-APK mit Capacitor, Windows mit Tray-Option

- **Status:** Angenommen (nur Planung; umgesetzt wird stufenweise nach [docs/plan/plattformen.md](../plan/plattformen.md)); weiterer Ausbau zurückgestellt auf Nutzerentscheidung (2026-09-28), siehe Nachtrag unten
- **Datum:** 2026-09-27
- **Entscheidung durch:** Nutzer (Server-Orte, echte APK mit Updater als Sideload, Verbreitung, Push zurückgestellt, Windows mit Web-App und Tray-Option; 2026-09-27), Advisor (Architektur, Stufen, Abweichung vom Flutter-Grundsatz)
- **Ergänzt:** [ADR-0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md) (Mehrgeräte: zweiter Weg über Traefik neben Tailscale), [ADR-0018](0018-secrets.md) (Quelle der `BYL_*`-Variablen im Container; Nachtrag folgt mit Stufe S3)

## Kontext

Die Frage des Nutzers lautete: „Lässt sich das ganze Projekt so bauen, dass es auf jedem Betriebssystem nutzbar ist?“ Seine Reihenfolge: Windows, Android, Browser, Linux, später iOS und macOS.

Befund aus dem Repo (Stand `eb996e8`):

- **Plattformneutral** sind PocketBase 0.40.4 (fertige Binaries für Windows, Linux `amd64`/`arm64`/`armv7` und macOS, keines für Android und iOS), die Hooks und Migrationen (ES5 in der JSVM, OS-Bezug nur über `$os.getenv` und `$os.args`), die SPA (spricht die eigene Origin an, ADR-0001) und die Daten (SQLite und Backup-ZIPs sind zwischen Systemen portabel).
- **Nur Windows** sind die Betriebsschicht (`start.bat`, `byl-control.ps1`, Autostart, Ablage der Secrets per `setx`), die Build-Skripte (PowerShell 5.1, `pocketbase.exe` fest verdrahtet), neun Test-Dateien und die CI (ein Job auf `windows-latest`).
- **Texte:** Etwa 50 Stellen der Oberfläche nennen Windows-Befehle (`setx`, `start.bat`, `stop.bat`). Sie beschreiben das Betriebssystem des **Servers**, nicht das des Geräts, auf dem die Seite gerade offen ist.
- Es gibt noch **keine Versionierung**: `package.json` steht auf `0.0.1`, es gibt weder Tags noch GitHub Releases.

PocketBase hat keine Replikation mit mehreren Schreibern. Zwei Server mit denselben Daten würden Nummernkreise (`ticket_counters`) doppelt vergeben und Kanäle (Telegram, Mail) doppelt abholen.

## Entscheidung

### 1. Ein Server je Datenbestand, alle anderen Geräte sind Clients

- Ein Datenbestand hat **genau einen** laufenden Server. Alle Geräte, die ihn nutzen, sind Clients über den Browser bzw. die installierte Web-App. Realtime (ADR-0007) hält sie aktuell, ein Sync ist nicht nötig.
- **Kein Server je Gerät, kein Sync, kein Offline-Modus** (CLAUDE.md §10). Ein lokaler Server auf Android (gomobile, `jniLibs`, Termux) ist abgelehnt.

### 2. Server-Orte (Nutzerentscheidung 1)

- **Windows-PC wie bisher:** portabler Ordner `app/`, Start per `start.bat` bzw. Autostart (CLAUDE.md §1, §9). Er bleibt Referenzplattform für Entwicklung und Tests.
- **Raspberry Pi als dauerhaft laufender Server:** Der vorhandene Pi (Raspberry Pi OS, Docker, Traefik, Pi-hole) bekommt PocketBase **als Container**.
  - Eigenes Image aus dem Repo: das gepinnte PocketBase-Linux-Binary (SHA256 aus `checksums.txt`), `pb_hooks`, `pb_migrations` und der SPA-Build in `pb_public`. `pb_data` liegt in einem Volume, nie im Image.
  - Die Architektur des Images folgt dem Pi (`linux/arm64`, bei einem 32-Bit-System `linux/arm/v7`). Welche es ist, prüft Stufe S3 als Erstes.
  - Im Container lauscht PocketBase auf dem Container-Netz. Es wird **kein Port auf dem Host veröffentlicht**; erreichbar ist es nur über Traefik bzw. Tailscale. Das entspricht der Regel „nur `127.0.0.1`“ aus CLAUDE.md §3 und ADR-0001 für den Container-Betrieb; CLAUDE.md §3 wird mit Stufe S3 entsprechend ergänzt.
  - `byl-mail` läuft als zweiter Container bzw. zweiter Prozess im selben Compose-Projekt, sofern ein Postfach eingerichtet ist (Linux-Build der Node-SEA, nativ auf einem Linux-Runner gebaut).
  - Cron-Jobs, Telegram und Mail laufen damit rund um die Uhr, auch wenn der PC aus ist.
- **Zwei getrennte Datenbestände:** PC und Pi sind zwei eigenständige Installationen. Welche die „echten“ Daten hält, entscheidet der Nutzer beim Umzug. Empfehlung: der Pi, sobald das Handy regelmäßig zugreift; der PC greift dann als Client zu. Umzug per Backup-ZIP, die Secrets werden auf dem Ziel neu gesetzt (ADR-0018: gewollt).

### 3. HTTPS und Zugriff von anderen Geräten

- **Pflicht ist HTTPS** (Tokens, Service Worker, Android-WebView lässt Klartext standardmäßig nicht zu).
- **Weg A, Traefik auf dem Pi:** Ein Router mit TLS-Zertifikat für einen Namen im eigenen Netz. Der Name wird über Pi-hole lokal aufgelöst. Zertifikat per ACME **DNS-01** (keine offenen Ports) oder aus einer eigenen CA, deren Stammzertifikat auf den Geräten installiert wird. Kein Port-Forwarding am Router, keine öffentliche Erreichbarkeit.
- **Weg B, Tailscale:** `tailscale serve` auf dem PC wie in ADR-0001 §3 oder Tailscale auf dem Pi; Zertifikat für `<gerät>.<tailnet>.ts.net`. Nötig für den Zugriff von unterwegs. Gerätenamen ohne persönliche Bezüge, weil sie im öffentlichen Certificate-Transparency-Log stehen.
- **Für beide Wege gilt ADR-0001 §3 weiter:** `trustedProxy.headers = ["X-Forwarded-For"]`, eingebauter Rate Limiter, `--origins` auf die tatsächlichen Origins, Admin-UI `/_/` nur aus dem eigenen Netz bzw. nur lokal (bei Traefik zusätzlich per IP-Allowlist-Middleware). Traefik setzt `X-Forwarded-For` zuverlässig; bei `tailscale serve` prüft ein Spike, ob der Header ankommt, bevor das Admin-UI darüber erreichbar ist.

### 4. Android: Web-App und echte APK (Nutzerentscheidung 2)

- **Web-App zuerst:** Die installierbare Web-App (Manifest, minimaler Service Worker, siehe §6) läuft auch auf Android über HTTPS.
- **Echte APK mit Capacitor** als eigene Stufe, nicht nur als Rückfallebene:
  - Die APK ist eine dünne Hülle um **dieselbe SPA**. Sie enthält eine kleine lokale Startseite, auf der man beim ersten Start die Adresse des eigenen Servers einträgt; die Hülle prüft `/api/health` und öffnet dann die SPA vom Server. Eine feste Server-Adresse im APK gibt es nicht, weil jeder seinen eigenen Server hat (Nutzerentscheidung 3).
  - Einsatzzweck: Teilen-Menü von Android (Text und Dateien, unabhängig vom WebAPK), später Benachrichtigungen (§7).
  - **Build per GitHub Actions** auf einem Linux-Runner (JDK, Android-SDK), **versioniert nach SemVer**: `versionName` ist die App-Version, `versionCode` steigt monoton. Die signierte APK liegt als **Download im GitHub Release** des Tags `vMAJOR.MINOR.PATCH`, dazu ihre SHA-256-Prüfsumme.
  - **Signatur:** ein eigener Upload-Keystore, ausschließlich als GitHub-Actions-Secret (CLAUDE.md global §8). Derselbe Schlüssel für alle Versionen, sonst lässt Android kein Überschreiben zu. Eine verschlüsselte Sicherung des Keystores außerhalb von GitHub ist Aufgabe des Nutzers. Neu erzeugen oder rotieren nur mit Bestätigung (CLAUDE.md global §12).
  - **In-App-Updater:** Die Hülle fragt beim Start und auf Knopfdruck die GitHub-Releases-API nach der neuesten Version, vergleicht SemVer, zeigt die Änderungen und lädt die APK nur nach Bestätigung herunter. Sie prüft die Prüfsumme und übergibt die Datei an den Paket-Installer von Android (Berechtigung `REQUEST_INSTALL_PACKAGES`, Bestätigung durch den Nutzer bleibt). Pre-Releases nur, wenn man sie eingeschaltet hat. Ohne Netz oder bei Fehlern gibt es einen neutralen Hinweis, nie einen Zwang.
  - **Manuell überschreiben** geht immer: APK aus dem Release laden und installieren; Android behält die Daten der Hülle (Server-Adresse), solange der Schlüssel gleich ist.
  - **Sideload, kein Store.** Die Entwickler-Verifizierung von Android (global ab 2027) wird rechtzeitig vor dem ersten Release geprüft: kostenloses Konto mit eingeschränkter Verteilung bzw. Installation per ADB.
- **TWA** scheidet aus (Digital Asset Links brauchen eine öffentlich erreichbare Adresse).

### 5. Abweichung vom globalen Flutter-Grundsatz

Die globale CLAUDE.md schreibt Flutter für Client-Plattformen vor; eine Stack-Festlegung der Projekt-CLAUDE.md hat Vorrang (SvelteKit mit PocketBase, §3). Für die APK gilt deshalb Capacitor statt Flutter:

- Flutter wäre eine **zweite, vollständige Oberfläche** neben der SPA (Liste, Detail, Filter, Eingang, Kanäle, Wiederholungen, Einstellungen, Tour), und die Domänenlogik, die heute in TypeScript mit Paritätstests zu den Hooks gespiegelt ist, müsste ein drittes Mal in Dart entstehen. Die vorhandenen Web-Tests würden nicht wiederverwendet.
- Flutter Web ist für die dichte Tabellen- und Formular-Oberfläche kein Ersatz für die SPA.
- Sinnvoll wäre Flutter nur für eine Offline-first-App mit eigener Datenbank und Sync. Die ist abgelehnt (§1).
- Capacitor nutzt dieselbe SPA; die Hülle ist klein (einige MB) und bringt Teilen-Menü, Updater und später Benachrichtigungen mit.

### 6. Windows: installierte Web-App und Tray-Option (Nutzerentscheidung 5)

- **Installierte Web-App:** Manifest, Icons, `launch_handler` mit `focus-existing` und ein minimaler Service Worker. Er cacht **nichts** unter `/api/` und `/_/` und zeigt ohne Server nur eine Hinweisseite. Chrome und Edge installieren von `http://127.0.0.1:8090` (sicherer Kontext).
- **Option mit Tray-Symbol und Installer:** Tauri 2 als Hülle (WebView2, Sidecars `pocketbase.exe` und `byl-mail.exe`, Plugins für Tray, Autostart, Einzelinstanz und Updater, NSIS-Installer pro Nutzer ohne Admin-Rechte). Electron (eigenes Chromium, ca. 100 MB) und Neutralinojs (unreife Prozessverwaltung) sind abgelehnt.
  - **Der portable Ordner bleibt:** Die Tray-Hülle liegt als weitere Datei in `app/` und arbeitet mit dem Ordner, wie er ist. Der Installer legt denselben Ordner (mit `pb_data` darin) in ein wählbares Verzeichnis, Standard pro Nutzer. Sicherung und Umzug per Ordnerkopie bleiben gültig (CLAUDE.md §1). Die Tray-Variante ist optional; `start.bat` und Autostart bleiben.
  - Unsigniert mit SmartScreen-Hinweis; eine kostenpflichtige Signatur oder der Microsoft Store nur nach Rückfrage.

### 7. Erinnerungen und Push (Nutzerentscheidung 4): zurückgestellt, eingeplant

- Nicht Teil der jetzigen Stufen. Eingeplant als eigene Stufe S6 mit drei Wegen zur Auswahl: Nachricht über den vorhandenen Telegram-Bot, Web Push über den Node-Hilfsprozess (VAPID mit ES256 kann die JSVM nicht) oder Benachrichtigungen der Capacitor-Hülle.
- Bis dahin wird nichts auf Vorrat gebaut. Die Stufen S3 und S2b halten die Wege nur offen: Der Hilfsprozess bleibt erweiterbar, die APK-Hülle bekommt ihre Benachrichtigungs-Plugins erst mit S6.

### 8. Verbreitung (Nutzerentscheidung 3)

- Vorerst privat, kein Store. Jeder soll die App aber mit **eigenen Daten** nutzen können: Die Releases enthalten nur Programmteile (portabler Windows-Ordner ohne `pb_data`, Container-Image bzw. Compose-Beispiel, APK). Jede Installation legt beim ersten Start ihr eigenes Konto an (ADR-0002).
- **Keine sensiblen Daten und keine Credentials im Repo**, auch nicht in Beispielen: Compose- und Traefik-Beispiele nutzen Platzhalter (`example.com`, `<tailnet>`), Secrets kommen aus Umgebungsvariablen bzw. einer Datei mit Rechten 600 außerhalb des Repos, Keystore und Tokens nur als GitHub-Actions-Secrets.

### 9. Versionierung und Releases

- Die Stufen S3, S2b und S4 brauchen Releases. S0 führt deshalb SemVer mit Conventional Commits und `release-please` ein (CLAUDE.md global §5): Tag `vMAJOR.MINOR.PATCH`, CHANGELOG im Keep-a-Changelog-Format, GitHub Release als Ablage für Windows-Paket, Image-Tag und APK. Die Version steht an einer Stelle (Root-`package.json`); `web/`, APK und Image übernehmen sie.
- Der Mail-Hilfsprozess behält seine eigene Version (`helpers/mail/package.json`), weil die Kanal-Karten sie anzeigen und vergleichen.

### 10. Stufen und Reihenfolge

Die Stufen aus der Bewertung werden an die Entscheidungen angepasst. Details, Aufwand und Prüfpunkte stehen in [docs/plan/plattformen.md](../plan/plattformen.md).

| Reihenfolge | Stufe | Inhalt |
|---|---|---|
| 1 | S0 Grundlagen | Plattform-Hinweis vom Server für Anleitungstexte, Binary-Namen je Plattform, `.gitattributes`, `fetch-pocketbase.mjs`, Ubuntu-CI-Job, SemVer und Releases |
| 2 | S1 Web-App | Manifest, Icons, minimaler Service Worker, „Als App installieren“ für Windows und Browser |
| 3 | S3 Server auf dem Pi | Container-Image (arm64 bzw. armv7), Compose-Beispiel mit Traefik, Secrets im Container, `byl-mail` für Linux, Umzug per Backup |
| 4 | S2 Mehrgeräte | HTTPS über Traefik oder Tailscale, Origins, Proxy-Header, Admin-UI nur lokal, Rate Limiter; Teilen-Ziel der Web-App auf Android |
| 5 | S2b Android-APK | Capacitor-Hülle mit Server-Adresse, Teilen-Menü, Build in GitHub Actions, Release mit APK, In-App-Updater |
| 6 | S4 Windows-Tray | Tauri-Hülle im portablen Ordner, Tray, Autostart, Einzelinstanz, NSIS-Installer, Updater |
| später | S6 Erinnerungen | Weg nach §7, erst nach Freigabe |
| später | S5 iOS und macOS | iOS als Web-App-Client, macOS als Client; macOS-Server nur bei Bedarf |

S3 rückt vor S2, weil der dauerhaft laufende Server die Voraussetzung für den Zugriff vom Handy ist. Mehrgeräte für **einen** Nutzer gehören zu S2; die Haushalts-UI bleibt E7 und braucht weiter eine eigene Freigabe (CLAUDE.md §10).

## Alternativen

- **Ein Server je Gerät mit Sync:** Wochen bis Monate Aufwand, hohes Risiko für Datenverlust, doppelte Nummernkreise und doppelte Kanal-Abrufe. Verworfen.
- **Nur PC als Server:** Handy-Zugriff und Cron-Jobs nur bei laufendem PC. Verworfen zugunsten des vorhandenen Pi.
- **PocketBase direkt auf dem Pi-Host (systemd) statt Container:** möglich, passt aber nicht zum vorhandenen Betrieb mit Docker und Traefik. Bleibt als Weg für Linux-Rechner ohne Docker in S3 dokumentiert, wird aber nicht zuerst gebaut.
- **Nur Web-App auf Android:** vom Nutzer als nicht ausreichend bewertet (echte APK gewünscht).
- **Flutter-App:** siehe §5. Verworfen.
- **TWA:** siehe §4. Verworfen.
- **Play Store:** 12 Tester über 14 Tage für neue private Konten, unverhältnismäßig für eine private App. Verworfen.
- **Installer ohne portablen Ordner:** widerspricht CLAUDE.md §1. Verworfen; der Installer legt den Ordner ab (§6).

## Konsequenzen

- Positiv: Alle Plattformen nutzen dieselbe SPA und dieselben Tests. Der Pi macht die App dauerhaft erreichbar, ohne Cloud.
- Positiv: Keine Datenmigration; Umzug zwischen PC und Pi ist ein Backup-ZIP.
- Negativ: Neue Werkzeuge im Repo und in der CI: Docker (Image-Build für ARM), JDK und Android-SDK, später Rust für Tauri. Jede Stufe hält sie in eigenen Jobs, der Pflicht-Check auf Windows bleibt unverändert, bis ein Ruleset-Wechsel ausdrücklich im selben PR erfolgt (CLAUDE.md §12).
- Negativ: Der APK-Keystore ist ein dauerhaftes Geheimnis. Geht er verloren, lässt sich die APK nicht mehr überschreiben, nur deinstallieren und neu installieren.
- Negativ: Die Anleitungen in der Oberfläche müssen das Server-System kennen (S0), sonst sehen Pi-Nutzer Windows-Befehle.
- CLAUDE.md §1, §3 und §9 („Windows 10“, „nur `127.0.0.1`“) werden mit den umsetzenden Stufen angepasst, nicht vorab.

## Nachtrag (2026-09-28, Stufe S0): Grundlagen umgesetzt, SemVer zurückgestellt

Umgesetzt in drei Paketen nach [docs/plan/plattformen.md](../plan/plattformen.md) §3 „S0“:

- **S0-1, Skripte und CI:** `scripts/platform.mjs` (Binary-Namen je System) und `scripts/fetch-pocketbase.mjs` mit gepinnter SHA256 je Archiv (`windows_amd64`, `linux_amd64`, `linux_arm64`, `linux_armv7`) im Repo, ZIP-Lesen mit `node:zlib`; `fetch-pocketbase.ps1` ruft es auf. Harness und Mail-Hilfsprozess ohne Windows-Annahmen, Tests der Windows-Betriebsschicht nur unter Windows. Zweiter CI-Job „Linux build and test“ auf `ubuntu-latest`; der Pflicht-Check bleibt der Windows-Job (Empfehlung zum Ruleset im Plan).
- **S0-2, Server-System:** `GET /api/byl/host` für angemeldete Nutzer liefert `windows`, `linux` oder `container`. Abweichend von §10 setzt der Start keine Variable: Der Hook erkennt Windows und Linux am Namen der laufenden Datei, `BYL_HOST_PLATFORM` übersteuert (das Image von S3 setzt `container`). So bleiben `start.bat` und `byl-control.ps1` unverändert.
- **S0-3, Anleitungen:** Die Oberfläche bleibt bei den Windows-Anleitungen und zeigt auf einem anderen Server-System darüber einen Hinweis (Kanäle, Einrichtungsassistent, Hilfe „Kanäle und Zugangsdaten“ und „Betrieb“): wohin die `BYL_`-Variablen gehören und wie der Server neu startet. Vollständige Anleitungen je System (Befehle für die Umgebungsdatei, Texte der Hooks wie „stop.bat, dann start.bat“) folgen mit S3, wenn Dienst, Umgebungsdatei und Compose-Beispiel feststehen; vorher würden sie Pfade und Befehle raten. Korrektur zu §10 bzw. zum Plan: Für neue Werte der Umgebungsdatei reicht `docker compose restart` nicht, der Container muss neu erstellt werden (`docker compose up -d`).
- **SemVer und Releases** (§9) sind zurückgestellt: `release-please` öffnet Release-PRs mit dem `GITHUB_TOKEN`, die keinen Workflow auslösen; der Pflicht-Check käme nie, und das Ruleset ohne Ausnahmen ließe sie nicht zu. Der Weg (Token bzw. GitHub-App als Secret oder manueller Tag per `workflow_dispatch`) braucht eine Nutzerentscheidung und folgt als eigenes Paket vor S3.

## Nachtrag (2026-09-28): Weiterer Ausbau zurückgestellt

**Zurückgestellt auf Nutzerentscheidung (2026-09-28) – nicht ohne ausdrückliche Freigabe beginnen.**

- Der Nutzer hat den gesamten weiteren Plattform-Ausbau zurückgestellt: S3 (Raspberry Pi mit Docker und Traefik), S2 (Mehrgeräte, Tailscale), S2b (Android-APK mit Capacitor), S4 (Tray und Installer), S5 (iOS und macOS) und S6 (Push und Erinnerungen).
- Ebenso SemVer und die Release-Automatisierung aus §9 (release-please mit eigenem Token bzw. GitHub-App); `package.json` bleibt auf `0.0.1`, es gibt keine Tags und keine GitHub Releases.
- Der Nutzer entscheidet selbst, wann die aktuelle Version dafür bereit ist. Bis dahin wird nichts davon umgesetzt, auch keine Spikes. Die Entscheidungen oben bleiben als Planung gültig.
- Umgesetzt bleiben S1 (installierbare Web-App, [ADR-0035](0035-start-einstieg-und-offene-tabs.md) §8) und S0 ohne SemVer (plattformneutrale Skripte, Linux-CI, Server-System für die Anleitungen).
