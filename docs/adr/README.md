# Architecture Decision Records

Nicht-triviale Architekturentscheidungen von becauseyoulovejira. Format: MADR light (Kontext, Entscheidung, Alternativen, Konsequenzen). Dateinamen `NNNN-kurztitel.md`, fortlaufend nummeriert. Eine angenommene ADR wird nicht umgeschrieben, sondern durch eine neue ADR ersetzt (Status „Ersetzt durch ADR-NNNN“).

Bereits verbindlich in der [Projekt-CLAUDE.md](../../CLAUDE.md) festgelegt und deshalb ohne eigene ADR: Tech-Stack (PocketBase 0.40.4 mit JS-Hooks und handgeschriebenen Migrationen, SvelteKit 2 / Svelte 5 im SPA-Modus, Vitest), Datenmodell mit Scopes und Nummernkreisen, API-Regeln, Svelte-5-Runes-Regel, Design-System.

| Nr. | Titel | Status | Datum |
|---|---|---|---|
| [0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md) | Betriebsmodell: vorerst lokal und Einzelnutzer, später Mehrgeräte/Mehrnutzer über Tailscale | Angenommen | 2026-09-24 |
| [0002](0002-erststart-und-superuser.md) | Erststart und Superuser-Anlage über den PocketBase-Installer | Angenommen | 2026-09-24 |
| [0003](0003-pb-data-und-backups.md) | Speicherort von `pb_data` und Backup-Strategie | Angenommen | 2026-09-24 |
| [0004](0004-teststrategie-hooks-migrationen.md) | Teststrategie für Hooks und Migrationen | Angenommen | 2026-09-24 |
| [0005](0005-zeitzone-europe-berlin.md) | Zeitzone Europe/Berlin ohne Zeitzonendatenbank der Laufzeit | Angenommen | 2026-09-24 |
