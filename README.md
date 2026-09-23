<div align="center">

![becauseyoulovejira](docs/assets/banner.svg)

<p>&nbsp;</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-07838F?style=flat-square)](LICENSE)
[![PocketBase](https://img.shields.io/badge/PocketBase-0.40.4-07838F?style=flat-square&logo=python&logoColor=white)](https://pocketbase.io)
[![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?style=flat-square&logo=svelte&logoColor=white)](https://svelte.dev)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-2-FF3E00?style=flat-square&logo=svelte&logoColor=white)](https://kit.svelte.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Windows](https://img.shields.io/badge/Windows-10-0078D4?style=flat-square&logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![Status](https://img.shields.io/badge/Status-E0%20Scaffolding-5B6B6F?style=flat-square)](#roadmap)

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
| **Tests** | [Vitest](https://vitest.dev) | Hooks-Integration, JS-Geschäftslogik |
| **Styling** | CSS-Custom-Properties + System-Font-Stack | Läuft ohne Internetverbindung, keine externen CDNs; minimalistisch |
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
    pb_data/              Daten (gitignored, niemals committen)
    start.bat             Starter
    autostart-an.bat      Autostart einrichten
    autostart-aus.bat     Autostart entfernen
  web/                    SvelteKit-Quellcode (Build → ../app/pb_public)
  scripts/                Build-/Setup-Skripte (PowerShell)
  tests/                  Vitest-Tests (Hooks, Recurrence-Logik)
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

Einzelne Qualitäts-Gates:

```powershell
npm run check   # svelte-check / TypeScript
npm run lint    # ESLint + Prettier
npm test        # Vitest
npm run build   # Frontend-Build nach app/pb_public
```

---

## Betrieb

### Windows Start/Stop

```powershell
# Starten (Browser öffnet sich automatisch)
.\app\start.bat

# Stoppen
.\app\stop.bat

# Autostart ein/aus
.\app\autostart-an.bat
.\app\autostart-aus.bat
```

**Bindung:** `127.0.0.1:8090` (nur lokal, nicht im Netz erreichbar – vorerst; Mehrgerätezugriff über Tailscale ist geplant, siehe [ADR-0001](docs/adr/0001-betriebsmodell-lokal-mehrgeraete-spaeter.md))

### Backup

**Empfohlene Methode:** PocketBase bietet eine eingebaute Backup-Funktion über das Admin-Dashboard unter `http://127.0.0.1:8090/_/` → Settings → Backups. Verwende diese zum Sichern und zum Umzug auf einen anderen Rechner.

**Alternative (Ordner kopieren):** `app/`-Ordner mit Windows-Explorer kopieren. **Wichtig:** Stoppe PocketBase zuerst mit `.\app\stop.bat`, da SQLite-Dateien während des Betriebs inkonsistent sein können.

---

## Roadmap (Etappen)

- [ ] **E0:** Gerüst (Repo, PocketBase, SvelteKit, dieser README)
- [ ] **E1:** Datenmodell, Authentifizierung, Hooks
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
