# E0 Spike: PocketBase Integration und Start-Mechanismus

**Status:** Abgeschlossen (verifiziert gegen PocketBase v0.40.4)
**Datum:** 2026-09-23

## Zusammenfassung

Diese Spike validierte die technische Basis für das E0-Gerüst: wie PocketBase 0.40.4 als Windows-Binary portabel gestartet wird, wie die Hook-Verwaltung und Migrationen funktionieren, und welche Flags für den lokalen, SPA-Mode erforderlich sind.

## PocketBase-Startflags

Die folgenden Flags werden in `app/start.bat` verwendet:

```powershell
pocketbase.exe serve `
  --http=127.0.0.1:8090 `
  --dir=pb_data `
  --hooksDir=pb_hooks `
  --migrationsDir=pb_migrations `
  --publicDir=pb_public `
  --automigrate=false
```

### Bedeutung der Flags

| Flag | Zweck | Grund |
|---|---|---|
| `--http=127.0.0.1:8090` | Bindung nur lokal (nicht im Netz erreichbar) | Sicherheit, kein externer Zugriff |
| `--dir=pb_data` | Datenbank- und Config-Verzeichnis relativ zur Binary | Portabilität, alles im `app/`-Ordner |
| `--hooksDir=pb_hooks` | Pfad zu JavaScript-Hooks | Hooks werden zur Laufzeit geladen |
| `--migrationsDir=pb_migrations` | Pfad zu JS-Migrationen | Schema-Version aus Git, nicht aus Dashboard |
| `--publicDir=pb_public` | Frontend-Build (SPA-Output) | Wird von PocketBase direkt ausgeliefert |
| `--automigrate=false` | Migrations nur aus Dateien, nicht automatisch | Verhindert Drift durch Admin-UI-Änderungen |

### SPA-Fallback
**Status:** Verifiziert gegen PocketBase v0.40.4

Das Flag `--indexFallback` (Boolean, default `true`) konfiguriert den Fallback für 404-Anfragen zur SPA-Indexdatei. Mit der Einstellung werden 404-Anfragen auf fehlende statische Pfade automatisch auf `index.html` weitergeleitet, was für SPA-Routing entscheidend ist (z. B. `/tasks` wird nicht als 404 behandelt, sondern an die SPA übergeben).

**Umsetzung:** Flag wird in `start-hidden.vbs` via `--indexFallback` (boolean, ohne Wertangabe) gesetzt. Da der Default bereits `true` ist, ist die explizite Angabe optional, aber empfohlen zur Klarheit.

## Hooks und Migrationen

### Hooks (PocketBase JS)

- **Sprache:** JavaScript (CommonJS, keine Abhängigkeiten vom Node.js-Umfeld)
- **Ort:** `app/pb_hooks/*.pb.js` und `app/pb_hooks/lib/*.js`
- **Laden:** Automatisch von PocketBase geladen, wenn Server startet
- **Struktur:** `onBootstrap()` für Initalisierung (top-level, muss `e.next()` aufrufen), `routerAdd()` für Custom-Routen

Hooks sind **reiner JavaScript** – keine npm-Dependencies. Sie laufen auf der PocketBase-Go-Engine (Goja-VM).

**Verifiziert:**
- `onBootstrap((e) => { e.next(); ... })` ist in JSVM v0.40.4 verfügbar und muss top-level registriert sein; nach `e.next()` können DB-Abfragen per `e.app` durchgeführt werden (zuverlässig für Recurrence-Catch-up beim Boot).
- `require()` unter Windows funktioniert mit Template-Literal-Syntax: `require(\`${__hooks}/lib/<name>.js\`)` laden Module innerhalb des Handlers (Handler laufen in isolierten Scopes, daher `require()` immer innerhalb des Handlers, nicht top-level).

### Migrationen (PocketBase JS)

- **Ort:** `app/pb_migrations/*.js`
- **Format:** `collections = [...]` + `migrate()` / `rollback()`
- **Automatisch:** Nein – `--automigrate=false` erzwingt, dass NUR die Dateien in diesem Ordner das Schema definieren
- **Grund:** Verhindert, dass Änderungen im Admin-Dashboard (Collections erstellen, Felder hinzufügen) das Repo-Schema überschreiben

## Tech-Stack (E0 gepinnt)

| Komponente | Version | Hinweis |
|---|---|---|
| PocketBase | 0.40.4 | Windows amd64 Binary, SHA256-geprüft in `fetch-pocketbase.ps1` |
| Node.js | ≥ 24 | Portabel in `H:\DEV\tools\node`, nicht im Repo |
| Svelte | 5.57 | Runes, aktuell |
| SvelteKit | 2.70.x | Nicht 3.0 (noch RC), `adapter-static` 3.0.x |
| Vite | 8 | Build-Tool |
| Vitest | 5 | Unit-Tests für Hooks |
| TypeScript | aktuell / stable | Abhängig von `svelte-check`-Unterstützung |
| Fonts | @fontsource-variable/inter + JetBrains Mono (lokal) | Keine externen CDNs |

## Offene Punkte für E0-Gates

1. **SPA-Fallback:** ✓ Verifiziert – `--indexFallback` Boolean-Flag existiert, default `true`
2. **TypeScript-Version:** Prüfe `svelte-check` gegen aktuelste TypeScript, fallback auf stable, wenn nötig
3. **Windows require():** ✓ Verifiziert – Template-Literal-Syntax `require(\`${__hooks}/...\`)` funktioniert auf Windows
4. **Boot-Hook e.next():** ✓ Verifiziert – `onBootstrap()` mit `e.next()` top-level registrierbar, DB-Zugriff per `e.app` möglich

## Startmechanismus (unsichtbar)

Der Startmechanismus unter Windows funktioniert folgendermaßen:

1. `app/start.bat` prüft, ob Port 8090 bereits belegt ist (via `netstat` oder `tasklist`)
2. Falls nicht, startet es PocketBase über `wscript app/start-hidden.vbs` (Konsole versteckt)
3. Script wartet, bis `/api/health` antwortet (mit Timeout)
4. Danach öffnet `start "" http://127.0.0.1:8090` den Standard-Browser

Grund: Kein Konsolenfenster, das über das App-Fenster schwebt.

## Architektur im Überblick

```
H:\DEV\github\task-dashboard\
  app/                       Portabler Laufzeit-Ordner (kopierbar, sicherbar)
    pocketbase.exe           Binary (gitignored, fetched)
    pb_data/                 SQLite + pb_config.json (gitignored)
    pb_hooks/
      *.pb.js                Hooks (geladen von PocketBase)
      lib/
        recurrence.js        Shared-Logik für wiederkehrende Aufgaben
    pb_migrations/
      001_initial.js         Schema-Definition
    pb_public/               SvelteKit-Build (gitignored)
    start.bat, stop.bat      Start/Stop-Skripte
    start-hidden.vbs         Startet ohne Konsole
    autostart-an.bat         Autostart-Eintrag erstellen
    autostart-aus.bat        Autostart-Eintrag löschen
  
  web/                       SvelteKit-Quellcode
    src/
      app.html               HTML-Shell
      app.css                Globale Styles (Design-Tokens)
      routes/
        +layout.svelte       Wrapper
        (app)/               Authentifizierte Routes
          +page.svelte       Dashboard
    static/
      fonts/                 Inter, JetBrains Mono (local)
    svelte.config.js
  
  scripts/                   PowerShell-Skripte
    fetch-pocketbase.ps1     Download + SHA256-Verifikation
    build.ps1                npm install, check, lint, test, build
  
  tests/                     Vitest
    recurrence/              Tests für Wiederholungslogik
  
  docs/
    adr/                     Architecture Decision Records (später)
    spikes/                  Spike-Berichte (z. B. diese Datei)
```

## Zusammenfassung für E1

E1 wird auf dieser Basis aufbauen:
- Datenmodell (Collections: User, Project, Task, Comment) in Migrationen definieren
- API-Regeln (Security, Validation) in Rules
- Initial-Hooks für Timestamps, Ticket-Nummern-Generierung, History-Tracking
- Frontend-Sekeltt für Task-Liste und Detail-Panel
- Authentifizierung (Local-Auth oder OAuth)

Die Start-Infrastruktur ist bereit und wird nicht mehr geändert.
