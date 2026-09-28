# Plan: Plattformen (Windows, Raspberry Pi, Android, Browser, später iOS und macOS)

- **Stand:** geplant (2026-09-27). Nur Doku; umgesetzt wird Stufe für Stufe, jede als eigener PR bzw. eigene PR-Folge.
- **Grundlage:**
  - [ADR-0028](../adr/0028-plattform-strategie.md) (Entscheidungen, Alternativen, Flutter-Abweichung)
  - [ADR-0001](../adr/0001-betriebsmodell-lokal-mehrgeraete-spaeter.md) (Mehrgeräte, HTTPS, Proxy-Header, Admin-UI nur lokal), [ADR-0002](../adr/0002-erststart-und-superuser.md) (Erststart), [ADR-0003](../adr/0003-pb-data-und-backups.md) (Backups), [ADR-0016](../adr/0016-kanal-architektur-und-mail.md) (Hilfsprozess), [ADR-0018](../adr/0018-secrets.md) (Secrets)
  - [CLAUDE.md](../../CLAUDE.md) §1, §3, §9, §10, §12
- **Einordnung:** Die Stufen laufen neben E6 und vor bzw. mit E7. Mehrgeräte für einen Nutzer (S2) brauchen die Haushalts-UI nicht; die Haushalts-UI bleibt E7 mit eigener Freigabe. Manifest-IDs bekommen die Stufen erst mit ihrem ersten PR.

## 1. Entscheidungen des Nutzers (2026-09-27)

| Nr. | Frage | Entscheidung |
|---|---|---|
| P-1 | Wo läuft der Server? | Der PC wie bisher, dazu der vorhandene Raspberry Pi (Raspberry Pi OS, Docker, Traefik, Pi-hole) als dauerhaft laufender Server. PocketBase als Container, HTTPS über Traefik bzw. Tailscale. |
| P-2 | Android: Web-App oder APK? | Web-App ist in Ordnung, eine echte APK ist aber gewünscht: Build per GitHub Actions, SemVer, Download im GitHub Release, In-App-Updater, manuelles Überschreiben möglich, Sideload, kein Store. |
| P-3 | Verbreitung | Vorerst privat. Jeder soll die App lokal mit eigenen Daten nutzen können. Keine sensiblen Daten und Credentials im Repo. |
| P-4 | Erinnerungen und Push | Vorerst übersprungen, aber eingeplant (S6). |
| P-5 | Windows | Installierte Web-App **und** eine Option mit Tray-Symbol bzw. Installer. |

## 2. Stufen gegenüber der Bewertung

Die Bewertung vom 2026-09-27 hatte S0 bis S5 mit S2b und S4 als Optionen. Nach den Entscheidungen gilt:

| Stufe | Bewertung | Jetzt |
|---|---|---|
| S0 Grundlagen | 2–3 T | bleibt, dazu SemVer und Releases (Voraussetzung für Image, Windows-Paket und APK): 3–4 T |
| S1 Web-App | 2–3 T | bleibt, zuerst für Windows und Browser |
| S2 Mehrgeräte und Android-Web-App | 5–8 T | nach S3; zweiter HTTPS-Weg über Traefik; ohne Benachrichtigungen (die gehen nach S6): 4–6 T |
| S2b Capacitor-APK | 3–5 T, nur als Rückfallebene | **fest eingeplant**, dazu Updater und Release-Ablage: 5–7 T |
| S3 Linux-Server | 4–6 T, systemd | **vorgezogen**, als Container auf dem Pi: 4–6 T; systemd nur als dokumentierter Weg |
| S4 Tauri-Installer | 7–10 T, optional | **fest eingeplant** als Option neben der Web-App, mit portablem Ordner: 7–10 T |
| S5 iOS und macOS | 1–6 T | unverändert „später“ |
| S6 Erinnerungen | nicht vorhanden | neu, zurückgestellt |

**Reihenfolge:** S0 → S1 → S3 → S2 → S2b → S4; S6 und S5 später. Summe S0 bis S4: etwa 26–37 Tage.

## 3. Stufen im Einzelnen

### S0: Grundlagen

- **Plattform-Hinweis vom Server:** Der Start setzt `BYL_HOST_PLATFORM` (`windows`, `linux`, `container`); eine Info-Route liefert den Wert an angemeldete Nutzer. `guidance/command.ts`, `guidance/texts.ts`, die Kanal-Assistenten und der Hinweis in `lib/mail-flows.js` wählen die Anleitung danach (`setx` und `stop.bat`/`start.bat` gegenüber Umgebungsdatei und `docker compose restart`). Standard bleibt Windows.
- **Binary-Namen und Pfade:** eine Funktion je `process.platform` (`pocketbase` bzw. `pocketbase.exe`, `byl-mail` bzw. `byl-mail.exe`) in `tests/support/pocketbase-harness.mjs` und den Build-Skripten; `path.join` statt fester Trenner; `.gitattributes` (`*.sh` LF, `*.bat` CRLF).
- **Fetch und Build in Node:** `scripts/fetch-pocketbase.mjs` mit Tabelle Plattform → Datei → SHA256 (Windows, `linux_amd64`, `linux_arm64`, `linux_armv7`). `build.ps1` bleibt als Windows-Hülle.
- **CI:** zusätzlicher Job auf `ubuntu-latest` (check, lint, web- und Root-Tests, Integrationstests mit dem Linux-Binary). Windows-spezifische Tests laufen nur unter `win32`. Der Pflicht-Check bleibt vorerst der Windows-Job; wird der neue Job Pflicht, zieht derselbe PR das Ruleset mit.
- **SemVer und Releases:** `release-please` (Conventional Commits → Version, CHANGELOG, Tag `vMAJOR.MINOR.PATCH`, GitHub Release). Start bei `0.1.0`. Ein Release-Workflow hängt an das Release das Windows-Paket (`app/` ohne `pb_data`, `pb_public` gebaut, `pocketbase.exe` und `byl-mail.exe` mit Prüfsummen). `GITHUB_TOKEN` mit den engsten nötigen Rechten.
- **Tests:** Plattform-Hinweis (Route, Texte je Plattform), Binary-Namen, Release-Inhalt ohne `pb_data` und ohne Secrets.

### S1: Installierte Web-App (Windows und Browser)

> **Erledigt, zusammengeführt** (2026-09-28) mit dem Paket „Start und Fenster“: umgesetzt als Paket SF-5 nach [ADR-0035](../adr/0035-start-einstieg-und-offene-tabs.md) §8 und [docs/plan/start-fenster.md](start-fenster.md) (`manifest.json`, Icons aus `favicon.svg`, Service Worker von SvelteKit mit Hinweisseite `offline.html`, `launch_handler` `focus-existing`, `start.bat` startet bevorzugt die installierte App). Der Prüfpunkt zum MIME-Typ ist beantwortet (§4). Abweichungen und manuelle Prüfungen stehen dort.

- `web/static/manifest.json` (MIME-Typ von PocketBase im Test prüfen; `.webmanifest` nur, wenn korrekt ausgeliefert): `id`, `start_url` und `scope` `/`, `display: standalone`, Farben aus dem Design-System, Icons 192, 512 und 512 maskable aus dem vorhandenen Logo, `launch_handler` mit `focus-existing`.
- `sw.js` minimal: kein Caching von `/api/` und `/_/`, keine Offline-Daten; bei Navigation ohne Server eine vorab gecachte Seite „Server nicht erreichbar“. Versionskennung aus dem Build.
- README „Als App installieren“ (Chrome, Edge; Firefox-Web-Apps unter Windows mit Einschränkungen). Hinweis: `http://127.0.0.1:8090` und eine HTTPS-Adresse sind verschiedene Origins mit getrennter Anmeldung und Darstellung.
- **Tests:** Manifest-Felder, SW reicht `/api/` und `/_/` durch, SPA-Fallback liefert Manifest und SW mit richtigem Typ.

### S3: Server auf dem Raspberry Pi (Container)

- **Zuerst prüfen:** 64- oder 32-Bit-System (`uname -m`), Docker-Version, vorhandenes Traefik-Netz und dessen Zertifikatsweg. Davon hängen Image-Architektur und Compose-Beispiel ab.
- **Image:** `Dockerfile` im Repo; Basis schlank (Debian slim, nicht Alpine, weil die Node-SEA dort nicht offiziell getestet ist). Inhalt: PocketBase-Linux-Binary (SHA256-geprüft), `pb_hooks`, `pb_migrations`, `pb_public`. Nicht-Root-Nutzer, `pb_data` als Volume, `HEALTHCHECK` auf `/api/health`, `--automigrate=false` wie heute.
- **Build:** GitHub Actions baut das Image nativ auf einem ARM-Runner (bzw. per Buildx für `arm/v7`) und legt es in der GitHub Container Registry ab, Tags gleich der Release-Version. Wer lieber lokal baut, nutzt dasselbe `Dockerfile`.
- **Compose-Beispiel** (`deploy/pi/compose.example.yml`, nur Platzhalter): Dienst `pocketbase` ohne veröffentlichten Port im Traefik-Netz, Labels für Router, TLS und eine IP-Allowlist für `/_/`; optional Dienst `byl-mail`. Secrets per `env_file` außerhalb des Repos (Rechte 600), nie im Compose-File.
- **`byl-mail` für Linux:** Node-SEA nativ auf dem passenden Runner gebaut (`linux-arm64`; für `armv7` erst prüfen, ob Node 24 dafür offizielle Builds hat). Ausgabename ohne `.exe`.
- **Erster Start im Container:** Superuser per `pocketbase superuser upsert` über `docker compose exec` (ADR-0002), README-Abschnitt „Server auf dem Raspberry Pi“.
- **Umzug:** Backup-ZIP vom PC in das Volume entpacken, Secrets neu setzen (ADR-0018 bekommt dazu einen Nachtrag: Quelle im Container ist die Umgebungsdatei).
- **Doku:** CLAUDE.md §3 (Bindung im Container), §9 (Betrieb auch auf Linux) und README.
- **Tests:** Integrationstests mit dem Linux-Binary im Ubuntu-Job; Smoke-Test des Images (Start, `/api/health`, SPA-Fallback, Migrationen) im CI; statischer Test, dass Compose- und Traefik-Beispiele keine echten Hosts, Tokens oder Pfade enthalten.

### S2: Mehrgeräte (ein Nutzer, mehrere Geräte)

- HTTPS über Traefik auf dem Pi (Name über Pi-hole, Zertifikat per DNS-01 oder eigene CA) bzw. `tailscale serve` für den Zugriff von unterwegs.
- PocketBase-Settings nach ADR-0001 §3: `trustedProxy.headers`, Rate Limiter, `--origins`, Admin-UI nur aus dem eigenen Netz. Spike: Kommt bei `tailscale serve` `X-Forwarded-For` an?
- Teilen-Ziel der Web-App auf Android: `share_target` mit GET für Text und Links auf `/eingang/neu`, POST für Dateien über den Service Worker in die vorhandenen Datei-Importe. Spike: Erzeugt Chrome für die private Adresse ein WebAPK? Scheitert er, deckt S2b das Teilen ab.
- **Tests:** Negativtests für Origins und Admin-UI hinter dem Proxy, Share-Target-Parser, SW-Übergabe der Dateien.

### S2b: Android-APK mit Capacitor

- **Hülle:** Capacitor-Projekt unter `mobile/android/` mit eigener, lokaler Startseite: Eingabe der Server-Adresse (nur `https:`), Prüfung von `/api/health`, danach Wechsel auf die SPA des Servers. Adresse ändern über ein Menü der Hülle. Kein Code der SPA wird kopiert.
- **Teilen-Menü:** Intent-Filter für Text und Dateien (`.eml`, `.ics`, WhatsApp-Export), Übergabe an `/eingang/neu` bzw. an die Datei-Importe. Spike: Stehen Plugins auf einer vom Server geladenen Seite zur Verfügung (Capacitor-Bridge und `allowNavigation`)? Sonst übergibt die lokale Startseite die Inhalte.
- **Build und Release:** Workflow auf `ubuntu-latest` mit JDK und Android-SDK; `versionName` aus der Release-Version, `versionCode` monoton (aus der Version abgeleitet). Signieren mit dem Keystore aus GitHub-Actions-Secrets; die APK und ihre SHA-256 hängen am GitHub Release. Pre-Releases für Tests.
- **In-App-Updater:** prüft beim Start und auf Knopfdruck `releases/latest` des Repos, vergleicht SemVer, zeigt die Änderungen, lädt nach Bestätigung, prüft die Prüfsumme und übergibt an den Paket-Installer (`REQUEST_INSTALL_PACKAGES`). Neutrale Hinweise bei Fehlern, kein Zwang.
- **Manuell:** README-Abschnitt „APK installieren und aktualisieren“ (Download aus dem Release, Installation aus unbekannten Quellen erlauben, Überschreiben).
- **Vor dem ersten Release prüfen:** Stand der Android-Entwickler-Verifizierung (global ab 2027) und ob dafür das kostenlose Konto mit eingeschränkter Verteilung nötig ist.
- **Freigabe vorab** (CLAUDE.md global §12): Anlage des Keystores.
- **Tests:** SemVer-Vergleich und Update-Entscheidung als reine Funktionen, Adressprüfung, Build der APK im CI; manuell: Installation, Update über den Updater, Überschreiben per Hand, Teilen aus WhatsApp.

### S4: Windows mit Tray-Symbol und Installer (Option)

- **Tauri-2-Hülle** `byl-tray.exe` im portablen Ordner `app/`: startet und stoppt `pocketbase.exe` und `byl-mail.exe` als Sidecars (Windows Job Object, damit keine Prozesse zurückbleiben), zeigt den Status im Tray („läuft“, „gestoppt“, „Fehler“), Menü „Öffnen“, „Neu starten“, „Beenden“, Autostart und Einzelinstanz über die offiziellen Plugins. Das Fenster lädt `http://127.0.0.1:8090`, die SPA bleibt unverändert.
- **Installer:** NSIS pro Nutzer ohne Admin-Rechte; legt den vollständigen Ordner (Daten darin) in ein wählbares Verzeichnis. Sicherung per Ordnerkopie bleibt.
- **Updater:** signierte Pakete über GitHub Releases; der Signaturschlüssel des Updaters nur als Secret.
- `start.bat`, `stop.bat` und Autostart bleiben der Standardweg; die Tray-Hülle ersetzt `byl-control.ps1` nur für die, die sie nutzen.
- **Tests:** Rust-Tests für den Lebenszyklus der Sidecars, CI-Build des Installers, manuelle Prüfung von Tray, Autostart, Update und Ordnerkopie.

### S6: Erinnerungen (zurückgestellt)

- Auswahl vor dem Start: Telegram-Bot (schnell, alle Geräte), Web Push über den Hilfsprozess (VAPID mit ES256, Payload-Verschlüsselung) oder Benachrichtigungen der APK. Erst nach Freigabe; CLAUDE.md §10 nennt bisher nur „Browser-Benachrichtigungen bei offenem Tab“ als Stufe 2.

### S5: iOS und macOS (später)

- iOS als Web-App-Client (Home-Bildschirm, Safe-Area, `apple-touch-icon`), kein Teilen-Ziel. macOS als Client per Browser; macOS-Server (launchd, SEA nur arm64, Ad-hoc-Signatur) nur bei Bedarf. Kein App Store.

## 4. Offene Prüfpunkte (Spikes, keine Nutzerentscheidung)

| Stufe | Frage |
|---|---|
| S1 | ~~Welchen MIME-Typ liefert PocketBase 0.40.4 für `.webmanifest`?~~ Beantwortet (SF-5, 2026-09-28): `text/plain; charset=utf-8` auf dem Entwicklungsrechner (Go liest unbekannte Endungen unter Windows aus der Registry, sonst Sniffing); `.json` kommt immer als `application/json`, `.js` als `text/javascript`. Deshalb `manifest.json` (`tests/integration/web-app.test.mjs`). |
| S3 | Läuft der Pi mit 64 oder 32 Bit? Gibt es für Node 24 auf `armv7` offizielle Builds für die SEA? |
| S3 | Wie stellt das vorhandene Traefik Zertifikate aus (DNS-01, eigene CA)? |
| S2 | Setzt `tailscale serve` `X-Forwarded-For`? |
| S2 | Erzeugt Chrome für Android ein WebAPK mit Teilen-Ziel für eine private Adresse? |
| S2b | Sind Capacitor-Plugins auf der vom Server geladenen SPA erreichbar? |

## 5. Entscheidungen im Verlauf

| Datum | Stufe | Entscheidung |
|---|---|---|
| 2026-09-27 | – | Nutzerentscheidungen P-1 bis P-5; ADR-0028 angenommen. Reihenfolge S0 → S1 → S3 → S2 → S2b → S4, S6 und S5 später. |
| 2026-09-27 | S3 | Container statt systemd auf dem Pi, weil dort schon Docker und Traefik laufen; systemd bleibt als Weg für Linux-Rechner ohne Docker dokumentiert. |
| 2026-09-27 | S2b | Die APK hat keine feste Server-Adresse, sondern eine lokale Startseite zur Eingabe (P-3: jeder mit eigenem Server). |
| 2026-09-27 | S4 | Tray-Hülle und Installer behalten den portablen Ordner mit den Daten darin (CLAUDE.md §1). |
| 2026-09-27 | S0 | `release-please` für SemVer, CHANGELOG und Tags; Start bei `0.1.0`. |
| 2026-09-28 | S1 | Mit dem Paket „Start und Fenster“ zusammengeführt (Nutzerentscheidung: installierbare Web-App mit `focus-existing`, `start.bat` bevorzugt die installierte App); Umsetzung als SF-5 nach [ADR-0035](../adr/0035-start-einstieg-und-offene-tabs.md) vor S0. |
