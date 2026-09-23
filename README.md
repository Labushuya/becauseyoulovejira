![becauseyoulovejira Banner](docs/assets/banner.svg)

## Zweck

**becauseyoulovejira** ist ein privates, lokal laufendes Ticket-Dashboard für Windows 10 im Desktop-Browser. Es bietet Jira-ähnliches Ticket-Handling – ohne Prozesslast, ohne Cloud, ohne Kosten. Die komplette Installation ist ein einzelner Ordner: Start per Doppelklick, Sicherung per Ordnerkopie.

## Status

**Phase E0** – Gerüst und Grundlagen. Die Anwendung läuft noch nicht; Datenmodell und Architektur werden aufgebaut. Weitere Etappen folgen nach Freigabe.

## Geplanter Tech-Stack

- **Backend:** PocketBase v0.40.4 (Windows-Binary, unverändert; SQLite-Datenhaltung)
- **Frontend:** SvelteKit 2 + Svelte 5 + TypeScript (strikt)
- **Schriften:** Inter (UI) und JetBrains Mono (Ticket-Keys), lokal @fontsource-variable
- **Design-System:** CSS-Custom-Properties, Hell/Dunkel-Modus, Petrol-Akzent (#07838F)
- **Tests:** Vitest für Unit- und Hook-Tests
- **Betrieb:** Portable Windows-Desktop-Lösung; Bindung an 127.0.0.1:8090

Alle Details sind in [CLAUDE.md](CLAUDE.md) festgehalten.

## Quickstart

Folgt. Sobald Etappe E1 abgeschlossen ist, wird eine Anleitung zum lokalen Starten bereitgestellt.

## Lizenz

Siehe [LICENSE](LICENSE) für Lizenzbedingungen.

---

### Rechtlicher Hinweis

Dieses Projekt ist **nicht mit Atlassian verbunden** und wird nicht von Atlassian gepflegt. **Jira** ist eine registrierte Marke von Atlassian Corporation plc. Dieses Projekt ist eine unabhängige Anwendung, die sich von Jira inspirieren lässt, ohne dessen Marke, Logos oder Funktionen nachzubilden.
