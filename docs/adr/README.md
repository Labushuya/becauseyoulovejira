# Architecture Decision Records

Nicht-triviale Architekturentscheidungen von becauseyoulovejira. Format: MADR light (Kontext, Entscheidung, Alternativen, Konsequenzen). Dateinamen `NNNN-kurztitel.md`, fortlaufend nummeriert. Eine angenommene ADR wird nicht umgeschrieben, sondern durch eine neue ADR ersetzt (Status „Ersetzt durch ADR-NNNN“).

Bereits verbindlich in der [Projekt-CLAUDE.md](../../CLAUDE.md) festgelegt und deshalb ohne eigene ADR: Tech-Stack (PocketBase 0.40.4 mit JS-Hooks und handgeschriebenen Migrationen, SvelteKit 2 / Svelte 5 im SPA-Modus, Vitest), Datenmodell mit Scopes und Nummernkreisen, API-Regeln, Svelte-5-Runes-Regel, Design-System.

| Nr. | Titel | Status | Datum |
|---|---|---|---|
| [0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md) | Betriebsmodell: vorerst lokal und Einzelnutzer, später Mehrgeräte/Mehrnutzer über Tailscale | Angenommen, ergänzt durch 0028 | 2026-09-24 |
| [0002](0002-erststart-und-superuser.md) | Erststart und Superuser-Anlage über den PocketBase-Installer | Angenommen | 2026-09-24 |
| [0003](0003-pb-data-und-backups.md) | Speicherort von `pb_data` und Backup-Strategie | Angenommen | 2026-09-24 |
| [0004](0004-teststrategie-hooks-migrationen.md) | Teststrategie für Hooks und Migrationen | Angenommen | 2026-09-24 |
| [0005](0005-zeitzone-europe-berlin.md) | Zeitzone Europe/Berlin ohne Zeitzonendatenbank der Laufzeit | Angenommen | 2026-09-24 |
| [0006](0006-frontend-zustand-und-datenzugriff.md) | Frontend-Zustand, Datenzugriff und Standard-Sortierung | Angenommen | 2026-09-24 |
| [0007](0007-realtime-und-sitzungspflege.md) | Realtime-Abos und Sitzungspflege im Frontend | Angenommen | 2026-09-24 |
| [0008](0008-markdown-rendering-und-sanitizing.md) | Markdown-Rendering und Sanitizing | Angenommen | 2026-09-24 |
| [0009](0009-fehlerfarbe.md) | Fehlerfarbe als eigenes Design-Token | Angenommen (mit Nachtrag) | 2026-09-24 |
| [0010](0010-layout-nach-task-board.md) | Seitenaufbau nach dem Vorbild des Task-Boards, im eigenen Stack und mit eigenen Farben | Angenommen, teilweise ersetzt durch 0025 und 0029, ergänzt durch 0027 | 2026-09-25 |
| [0011](0011-roadmap-e3-bis-e7.md) | Neue Etappen E3 bis E7 mit vorgezogenen Eingangskanälen | Angenommen | 2026-09-25 |
| [0012](0012-plain-ticketing.md) | Plain Ticketing ohne Ticket-Typen, Epics, Sprints und Story Points | Angenommen | 2026-09-25 |
| [0013](0013-filter-suche-sortierung-gruppierung.md) | Filter, Suche, Sortierung und Gruppierung: was der Client und was der Server rechnet | Angenommen | 2026-09-25 |
| [0014](0014-datenmodell-eingang.md) | Datenmodell des Eingangs (`inbox_items`) mit Rückverweis am Ticket und Duplikaterkennung | Angenommen | 2026-09-25 |
| [0015](0015-neu-markierung-pro-nutzer.md) | „Neu“-Markierung pro Nutzer | Angenommen | 2026-09-25 |
| [0016](0016-kanal-architektur-und-mail.md) | Architektur der Kanäle: HTTP-Kanäle im Hook per Cron, Mail über einen Hilfsprozess | Angenommen | 2026-09-25 |
| [0017](0017-parser-ics-eml.md) | Parser für `.ics` im Hook, für `.eml` im Browser und im Hilfsprozess | Angenommen | 2026-09-25 |
| [0018](0018-secrets.md) | Zugangsdaten der Kanäle als Windows-Umgebungsvariablen | Angenommen | 2026-09-25 |
| [0019](0019-kanal-filter-und-gruppierung.md) | Quelle als Filter, Gruppierung und Merkmal in der Tabelle | Angenommen | 2026-09-25 |
| [0020](0020-stichwoerter-pro-kanal.md) | Stichwörter pro Kanal entscheiden, was automatisch in den Eingang kommt | Angenommen | 2026-09-25 |
| [0021](0021-regelmodell-wiederkehrende-aufgaben.md) | Regelmodell der wiederkehrenden Aufgaben und reine Terminberechnung | Angenommen (mit Nachtrag) | 2026-09-25 |
| [0022](0022-erzeugung-von-instanzen.md) | Erzeugung der Tickets aus Regeln: Zeitpunkt, Cron, Nachholen beim Start, keine Duplikate | Angenommen (mit Nachtrag) | 2026-09-25 |
| [0023](0023-lebenszyklus-von-regeln-und-instanzen.md) | Lebenszyklus von Regeln und Instanzen: Anlegen, Erledigen, Rückgängig, Pausieren, Bearbeiten, Löschen | Angenommen (mit Nachtrag) | 2026-09-25 |
| [0024](0024-serien-aus-kalendern.md) | Serien aus `.ics` und Google Calendar als Vorschlag für eine Regel | Angenommen (mit Nachtrag) | 2026-09-25 |
| [0025](0025-ui-konsistenz-overlay-system.md) | UI-Konsistenz: ein Overlay-System, Theme-Umschalter und angeglichene Projekt-UI | Angenommen, §2 teilweise ersetzt durch 0029 | 2026-09-25 |
| [0026](0026-einstellungsbereich-und-hinweis-bausteine.md) | Einstellungsbereich, Hinweis-Bausteine, Einrichtungsassistent und geführte Tour | Angenommen | 2026-09-26 |
| [0027](0027-akzent-themes.md) | Akzent-Themes (Petrol, Rubin, Smaragd, Kupfer): genau eine Akzentfarbe je Theme | Angenommen (mit Nachträgen), §1 teilweise ersetzt durch 0029 | 2026-09-26 |
| [0028](0028-plattform-strategie.md) | Plattform-Strategie: ein Server je Datenbestand (PC oder Raspberry Pi), Clients als Web-App, Android-APK mit Capacitor, Windows mit Tray-Option | Angenommen (Planung) | 2026-09-27 |
| [0029](0029-glas-materialien.md) | Glas-Materialien im macOS-Stil: Glas nur in der Bedienebene, Verlauf aus der Akzentfläche, neutrale Schatten, Umschaltpunkt „undurchsichtig“ | Angenommen und umgesetzt (G-1 bis G-6, mit Nachträgen) | 2026-09-27 |
| [0030](0030-spalten-breiten-und-kompakte-zeilen.md) | Spaltenbreiten, Ein- und Ausblenden und kompakte Zeilen in Tabellen: berechnete Anpassung statt Container-Queries, Menü „Spalten“, Speichern pro Gerät | Angenommen (Umsetzung SP-1 bis SP-5) | 2026-09-27 |
