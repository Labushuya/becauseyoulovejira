<div align="center">

![becauseyoulovejira](docs/assets/banner.svg)

<p>&nbsp;</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-07838F?style=flat-square)](LICENSE)
[![PocketBase](https://img.shields.io/badge/PocketBase-0.40.4-07838F?style=flat-square&logo=python&logoColor=white)](https://pocketbase.io)
[![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?style=flat-square&logo=svelte&logoColor=white)](https://svelte.dev)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-2-FF3E00?style=flat-square&logo=svelte&logoColor=white)](https://kit.svelte.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Windows](https://img.shields.io/badge/Windows-10-0078D4?style=flat-square&logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![Status](https://img.shields.io/badge/Status-E1%20abgeschlossen-07838F?style=flat-square)](#roadmap)

</div>

---

## Was ist becauseyoulovejira?

Ein privates, lokal laufendes Ticket-Dashboard für Windows 10 – Ticket-Handling im Stil von Linear oder Jira, ohne deren Prozesslast. Bedient wird es im Desktop-Browser (Chrome, Firefox, Opera GX).

- **Lokal:** Keine Cloud. Der Server lauscht ausschließlich auf `127.0.0.1`.
- **Portabel:** Die komplette Installation ist der Ordner `app/` – Start per Doppelklick, Sicherung und Umzug per Ordnerkopie.
- **Ohne Internet lauffähig:** Keine externen CDNs, Schriften werden lokal ausgeliefert.

---

## Geplante Features

| Feature | Status |
|---|---|
| 📝 Tickets mit Status (Backlog, Offen, In Arbeit, Wartet, Erledigt) | 🚧 E1–E2 |
| 🏷️ Projekte, Tags, Filter, Suche | 🚧 E3 |
| 💬 Kommentare, Ticket-Historie | 🚧 E2 |
| 🔄 Realtime-Updates (Subscriptions) | 🚧 E2 |
| 📅 Wiederkehrende Aufgaben (Kalender- und Nach-Completion-Regeln) | 🚧 E4 |
| ⌨️ Schnellerfassung (Taste `c`, Strg+K; Kurzsyntax `Titel @CODE !Priorität`) | 🚧 E5 |
| 🎨 Hell-/Dunkel-Theme (Systemeinstellung, manueller Umschalter) | 🚧 E5 |
| 🌐 Zugriff von mehreren Geräten über Tailscale (HTTPS, Server bleibt auf `127.0.0.1`) – [ADR-0001](docs/adr/0001-betriebsmodell-lokal-mehrgeraete-spaeter.md) | 🗓️ E6 |

### Später (nach Freigabe)

- 👥 Haushalte / gemeinsame Dashboards
- 🎯 Sub-Tickets und Fortschrittsanzeige
- 🔗 Abhängigkeiten mit Entsperr-Automation
- 📊 Board-Ansicht (Kanban)
- 🔔 Browser-Benachrichtigungen
- 📎 Anhänge (Bilder, Dateien)

---

## Tech Stack

| Komponente | Technologie | Warum |
|---|---|---|
| **Backend** | [PocketBase 0.40.4](https://pocketbase.io) (Windows Binary) | Alles-in-Eins: SQLite, Admin-UI, Hooks/JS, Realtime |
| **Frontend** | [SvelteKit 2](https://kit.svelte.dev) + [Svelte 5](https://svelte.dev) + [TypeScript](https://www.typescriptlang.org) | Geringster JS-Footprint, SPA-Modus, native Reaktivität (Runes) |
| **Runtime** | [Node.js](https://nodejs.org) (nur Dev) | Build-Werkzeug, nicht für Betrieb erforderlich |
| **Tests** | [Vitest](https://vitest.dev), [Testing Library](https://testing-library.com/docs/svelte-testing-library/intro) + jsdom | Hooks-Integration, JS-Geschäftslogik, Svelte-Komponenten |
| **Styling** | CSS-Custom-Properties, Schriften Inter und JetBrains Mono lokal über `@fontsource-variable` | Läuft ohne Internetverbindung, keine externen CDNs; minimalistisch |
| **Datenbank** | [SQLite](https://www.sqlite.org) (PocketBase intern) | Einzeldatei, keine Separate Datenbank nötig |

---

## Repo-Struktur

```
becauseyoulovejira/
  app/                    Portabler Laufzeitordner (wird kopiert/gesichert)
    pocketbase.exe        Binary (gitignored, via scripts/fetch-pocketbase.ps1)
    pb_hooks/             *.pb.js Hooks
    pb_migrations/        Handgeschriebene JS-Migrationen
    pb_public/            Frontend-Build (gitignored)
    pb_data/              Daten und Backups (gitignored, niemals committen)
    logs/                 Server-Ausgabe des letzten Starts (gitignored)
    start.bat             Starten (öffnet den Browser)
    start-hidden.vbs      Starten ohne Fenster (Ziel der Autostart-Verknüpfung)
    stop.bat              Beenden (nur die eigene Instanz)
    autostart-an.bat      Autostart einrichten
    autostart-aus.bat     Autostart entfernen
    byl-control.ps1       Logik hinter den Skripten (byl-functions.ps1: testbare Funktionen)
  web/                    SvelteKit-Quellcode (Build → ../app/pb_public), Tests unter src/**/*.test.ts
  scripts/                Build-/Setup-Skripte (PowerShell)
  tests/                  Vitest-Tests (Hooks, Regeln, Login- und SPA-Integration)
  docs/                   README-Assets, Architektur-Dokumente
```

---

## Entwicklung

**Voraussetzungen:** Windows 10, Node.js ≥ 24, PowerShell 5.1+

```powershell
# 1. PocketBase laden (gepinnte Version, SHA256-geprüft)
.\scripts\fetch-pocketbase.ps1

# 2. Abhängigkeiten installieren, prüfen, testen und Frontend bauen
.\scripts\build.ps1

# 3. Starten
.\app\start.bat
```

`build.ps1` erwartet `node` (≥ 24) und `npm` im `PATH` und bricht sonst mit einem Hinweis ab. Blockiert die Execution Policy die Skripte, lassen sie sich so aufrufen:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

Einzelne Qualitäts-Gates:

```powershell
npm run check   # svelte-check / TypeScript
npm run lint    # ESLint + Prettier
npm run build   # Frontend-Build nach app/pb_public
npm test        # Vitest: Unit- und Integrationstests, danach die web-Tests
```

### Tests

| Ort | Inhalt |
|---|---|
| `tests/unit/` | reine Logik ohne PocketBase: Hook-Module aus `app/pb_hooks/lib`, Start-/Stopp-Logik (`app/byl-functions.ps1` mit gefälschten Prozessen, Sockets und Log-Texten) und statische Prüfungen der Start-Skripte |
| `tests/integration/` | gegen Wegwerf-PocketBase-Instanzen: Migrationen, API-Regeln, Hooks, Login, SPA-Fallback, Backup-Wiederherstellung |
| `web/src/**/*.test.ts` | Frontend: Unit- und Komponententests (jsdom) |

```powershell
npm run test:unit          # nur reine Logik, ohne PocketBase
npm run test:integration   # gegen eine Wegwerf-PocketBase-Instanz
npm run test:web           # Frontend: Unit- und Komponententests (jsdom)
```

`npm test` im Root führt erst die Root-Tests (Unit und Integration) und danach die web-Tests aus. **Vorher muss der Frontend-Build existieren** (`npm run build` nach `app/pb_public`), sonst schlägt der SPA-Fallback-Test mit einem Hinweis fehl. `scripts\build.ps1` hält die Reihenfolge ein (check → lint → build → test). Die Integrationstests brauchen außerdem `app/pocketbase.exe` (siehe Schritt 1). Die Start-Skripte selbst werden von den Tests nie ausgeführt; die Tests der Start-Logik rufen nur die Funktionen in Windows PowerShell auf (`-NoProfile -ExecutionPolicy Bypass`).

Pro Lauf startet ein Vitest-`globalSetup` eine eigene PocketBase-Instanz in einem frischen Temp-Ordner (`%TEMP%\byl-test-*`), mit zufälligem Superuser und auf einem freien Port (nie 8090). Danach beendet es die Instanz und löscht den Ordner, auch bei fehlschlagenden Tests oder Strg+C. Eine laufende Produktivinstanz und `app/pb_data` bleiben unberührt. Der SPA-Fallback-Test startet nach demselben Muster eine zweite Instanz mit dem Frontend-Build als `publicDir`. Details: [ADR-0004](docs/adr/0004-teststrategie-hooks-migrationen.md).

Für den Vite-Dev-Server (`npm --prefix web run dev`) leitet `web/vite.config.ts` die Pfade `/api` und `/_/` an die laufende Instanz auf `127.0.0.1:8090` weiter; im Betrieb liefert PocketBase die App selbst aus (gleiche Origin).

---

## Betrieb

### Erster Start

Beim allerersten Start gibt es noch kein Konto. Zugangsdaten stehen bewusst nirgends im Repo ([ADR-0002](docs/adr/0002-erststart-und-superuser.md)); du legst zwei Konten an: ein **Admin-Konto** (PocketBase-Superuser, verwaltet den Server) und ein **App-Konto** (damit meldest du dich in der App an, ihm gehören die Tickets).

1. `app\start.bat` doppelklicken. Das Fenster meldet „Erster Start: …“ und wartet auf eine Taste. Es öffnet sich **nur ein** Browser-Tab: die PocketBase-Einrichtung (`http://127.0.0.1:8090/_/#/pbinstall/…`), nicht die App.
2. Dort das Admin-Konto anlegen (E-Mail und Passwort frei wählbar). Der Einrichtungslink ist **30 Minuten** gültig. Ist er abgelaufen oder hat sich kein Browser geöffnet: `app\stop.bat`, dann `app\start.bat` – jeder Start ohne Admin-Konto erzeugt einen neuen Link (er steht auch in `app\logs\pocketbase.err.log` bzw. `pocketbase.out.log`).
3. Nach der Einrichtung bist du im Admin-Bereich (`http://127.0.0.1:8090/_/`). Unter **Collections → users → New record** das App-Konto anlegen: E-Mail, Passwort und Passwort-Bestätigung, dann speichern. Selbstregistrierung ist gesperrt; neue Konten entstehen nur hier.
4. `http://127.0.0.1:8090/` öffnen (oder `app\start.bat` erneut ausführen; die laufende App wird erkannt und nur der Browser geöffnet).
5. Mit dem App-Konto anmelden. Das Admin-Konto funktioniert in der App nicht (getrennte Konten).

Ab jetzt öffnet `start.bat` direkt die App.

### Starten und Beenden

| Skript | Verhalten |
|---|---|
| `app\start.bat` | Startet PocketBase ohne sichtbares Fenster mit den Daten in `app\pb_data`, wartet, bis `/api/health` antwortet (höchstens 30 s), und öffnet dann genau einmal `http://127.0.0.1:8090/`. Läuft die App schon, öffnet es nur den Browser. Ist Port 8090 von einem anderen Programm belegt, bricht es mit einer Meldung ab. Beim Erststart siehe oben. Fehler und Hinweise bleiben im Fenster stehen, bis eine Taste gedrückt wird; Details stehen in `app\logs\`. |
| `app\stop.bat` | Beendet nur die eigene Instanz (`pocketbase.exe` aus diesem Ordner, gestartet mit `serve` auf `127.0.0.1:8090` und `app\pb_data`); andere PocketBase-Prozesse, etwa Testinstanzen, bleiben unberührt. |
| `app\autostart-an.bat` / `app\autostart-aus.bat` | Legt die Verknüpfung `becauseyoulovejira.lnk` im Windows-Autostart-Ordner an bzw. entfernt sie. Sie startet `start-hidden.vbs`: Die App startet bei der Anmeldung still im Hintergrund, **ohne** Browser. Hinweise (Erststart) und Fehler erscheinen dann als Meldungsfenster. Nach dem Verschieben von `app\` einfach `autostart-an.bat` erneut ausführen. |

Die Skripte sind dünne Hüllen um `app\byl-control.ps1` und rufen es mit `powershell -NoProfile -ExecutionPolicy Bypass` auf; eine gesperrte Skriptausführung stört also nicht.

`stop.bat` beendet den Server hart (wie ein Absturz). Für die Daten ist das unkritisch: SQLite (WAL-Modus) behält jede abgeschlossene Änderung, eine gerade laufende wird beim nächsten Start zurückgerollt. Nur während eines laufenden Backups solltest du nicht stoppen, sonst bleibt ein unvollständiges ZIP zurück.

**Bindung:** `127.0.0.1:8090` (nur lokal, nicht im Netz erreichbar – vorerst; Mehrgerätezugriff über Tailscale ist geplant, siehe [ADR-0001](docs/adr/0001-betriebsmodell-lokal-mehrgeraete-spaeter.md))

### Backup und Wiederherstellung

Details und Begründung: [ADR-0003](docs/adr/0003-pb-data-und-backups.md).

- **Automatisch:** Alle 4 Stunden zur vollen Stunde (Cron in **UTC**, `0 */4 * * *`), solange der Server läuft. Die letzten **12** automatischen Backups werden aufbewahrt, als ZIP in `app\pb_data\backups\`. Ein Backup ist im laufenden Betrieb konsistent.
- **Manuell:** Im Admin-Bereich `http://127.0.0.1:8090/_/` unter **Settings → Backups → Initialize new backup**, etwa vor Updates. Dort lassen sich Backups auch herunterladen.
- **Wichtig:** Die Backups liegen auf derselben Platte wie die Daten. Kopiere `app\pb_data\backups\` regelmäßig zusätzlich an einen anderen Ort (externe Platte, Cloud-Ordner).
- **Umzug:** `stop.bat`, dann den ganzen Ordner `app\` kopieren; die Backups wandern mit.

**Wiederherstellen (nur manuell):** Die Wiederherstellung über das Admin-UI unterstützt PocketBase unter Windows nicht. Manuelle Schritte, PowerShell im Ordner `app` (Datum und Backup-Namen anpassen):

```powershell
# 1. Server beenden
.\stop.bat

# 2. Aktuelle Daten beiseitelegen (nichts wird gelöscht)
Rename-Item -LiteralPath .\pb_data -NewName pb_data.vor-restore-2026-09-24

# 3. Backup-ZIP in ein neues pb_data entpacken
Expand-Archive -LiteralPath .\pb_data.vor-restore-2026-09-24\backups\<backup>.zip -DestinationPath .\pb_data

# 4. Ältere Backups wieder mitnehmen
Copy-Item -LiteralPath .\pb_data.vor-restore-2026-09-24\backups -Destination .\pb_data -Recurse

# 5. Wieder starten
.\start.bat
```

Danach anmelden und die Daten prüfen; es gelten die Konten und Passwörter zum Zeitpunkt des Backups. Erst wenn alles stimmt, `pb_data.vor-restore-…` löschen. Schritt 3 ist durch den Integrationstest `tests/integration/backup-restore.test.mjs` belegt (Backup per API, `Expand-Archive` in einen neuen Datenordner, Start, Ticket, Key und Login vorhanden).

---

## Roadmap (Etappen)

- [x] **E0:** Gerüst (Repo, PocketBase, SvelteKit, dieser README)
- [x] **E1:** Datenmodell, Authentifizierung, Hooks, Start-/Stopp-Skripte
- [ ] **E2:** Listen-View, Detail-View, CRUD, Kommentare, Realtime
- [ ] **E3:** Projekte, Tags, Filter, Suche, Sortierung
- [ ] **E4:** Wiederkehrende Aufgaben (Kalender-Regeln, RRULE-Subset)
- [ ] **E5:** Schnellerfassung, Theme-Umschalter, Feinschliff, Doku
- [ ] **E6:** Zugriff von mehreren Geräten über Tailscale (`tailscale serve` mit HTTPS, Proxy-Header, Superuser nur lokal) – ohne Datenmigration, siehe [ADR-0001](docs/adr/0001-betriebsmodell-lokal-mehrgeraete-spaeter.md)

Nach jeder Etappe: Zusammenfassung, Testanleitung, Entscheidungen. Architekturentscheidungen stehen in [docs/adr/](docs/adr/README.md), der Umsetzungsplan für E1 in [docs/plan/e1.md](docs/plan/e1.md).

---

## Lizenz

[MIT](LICENSE) © 2026 [Labushuya](https://github.com/Labushuya)

---

<div align="center">

*Privat · Lokal · Portabel*

</div>
