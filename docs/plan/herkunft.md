# E6-Plan, Teil Herkunft: Quellen eines Tickets, Löschschutz, große Mails und Seitenkopie

- **Stand:** geplant (2026-09-27)
- **Grundlage:**
  - [ADR-0031](../adr/0031-herkunft-sichern.md) (Datenmodell, Verknüpfen und Lösen, Löschschutz, große Mails, Kopie-Status, Seitenkopie mit SSRF-Schutz und seinen Grenzen)
  - [ADR-0014](../adr/0014-datenmodell-eingang.md), [ADR-0016](../adr/0016-kanal-architektur-und-mail.md), [ADR-0008](../adr/0008-markdown-rendering-und-sanitizing.md), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0029](../adr/0029-glas-materialien.md)
  - [CLAUDE.md](../../CLAUDE.md) §3, §5, §7, §11, §12
- **Einordnung:** Nutzerentscheidung vom 2026-09-27: „Herkunft sichern“ kommt direkt nach „Spalten“ ([Plan Spalten](e6-spalten.md)), vor „Editor Stufe A“. Die Manifest-IDs laufen ab `BYL-E6-160` (Spalten belegt 140 bis 151).

## 1. Querschnittsregeln

- Die Instanz des Nutzers läuft aus demselben Ordner `app/`. Neue Hooks wirken sofort, die Migration erst nach dem Neustart. Jeder Hook arbeitet deshalb auch auf dem Schema davor (`hooks-before-migration.test.mjs`).
- Die Migration hat einen Rollback-Test mit Daten (`migrations-rollback.test.mjs`).
- Keine neue Abhängigkeit, keine neuen Farb- oder Maß-Tokens. Nur die bestehenden Bausteine: Drawer, Modal, Popover, Flag, `guidance/*`. Glas nach ADR-0029.
- Tests nur mit Fake-Servern: Test-IMAP-Server für Mails, lokaler HTTP-Server für Seiten. Keine echten Postfächer oder Webseiten, keine echten Zugangsdaten.
- **Gates je Paket:**
  - eigener Branch und PR
  - `scripts\build.ps1` lokal komplett grün (Exit-Code 0 und „Build complete!“)
  - CI grün, höchstens drei Versuche; ein roter PR hält die folgenden auf
  - Squash-Merge, Test-Manifest nachgezogen, Entscheidungen in §3

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| HK-0 | ADR-0031, dieser Plan, Manifest-Einträge als „geplant“ | – |
| HK-1 | Verknüpfen und Lösen im Hook mit Historie `source_link` (atomar, Prüfmuster wie beim Umwandeln), Löschschutz per Hook und Migration `1790201800_inbox_items_delete_guard.js` mit Rollback-Test | BYL-E6-160, BYL-E6-161 |
| HK-2 | Oberfläche: Abschnitt „Quellen“ im Ticket (Panel und Vollansicht) mit „Quelle hinzufügen …“ und „Lösen“, „Mit Ticket verknüpfen …“ im Eingang (einzeln und für die Auswahl) mit Ticketsuche als Combobox im Modal M, Verlauf, `copyCompleteness` mit Lozenge und SectionMessage | BYL-E6-162, BYL-E6-163 (manuell) |
| HK-3 | Große Mails: Eintrag ohne Originaldatei über automatischen Abruf, Vollsuche, Postfach-Auswahl und `.eml`; `byl-mail.exe` 0.8.0 | BYL-E6-164, BYL-E6-165, BYL-E6-166 (manuell) |
| HK-4 | Seitenkopie für Web-Links: Route mit SSRF-Schutz, Textauszug, HTML als Original; „Seiteninhalt sichern“ im Panel und beim Erfassen per Bookmarklet | BYL-E6-167, BYL-E6-168, BYL-E6-169, BYL-E6-170 (manuell) |

## 3. Entscheidungen

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-27 | HK-0 | ADR-Nummer 0031 (frei nach 0030). Manifest-Block ab `BYL-E6-160`. Paketkürzel `HK` („Herkunft“). |
| 2026-09-27 | HK-0 | **`converted` bleibt für Umwandeln und Verknüpfen** (ADR-0031 §1). Die Hauptquelle folgt aus `tickets.source_item`. |
| 2026-09-27 | HK-0 | **Verknüpfen und Lösen über die Record-API** statt einer eigenen Route: Es ist derselbe Weg wie „Dem Ticket zuordnen“, und Regeln und Realtime von `inbox_items` gelten ohne Nachbau. |
| 2026-09-27 | HK-0 | **Seitenkopie mit `$http.send` im Hook**, wie empfohlen. Die Grenzen (keine DNS-Auflösung, Weiterleitungen nicht prüfbar, Größe erst nach dem Laden) stehen in ADR-0031 §6. Der Hilfsprozess wäre der stärkere Schutz, läuft aber nur mit einer Mail-Verbindung. |
| 2026-09-27 | HK-0 | **„Seiteninhalt sichern“ beim Bookmarklet:** Checkbox in der Vorlage „Web-Link“, standardmäßig an („optional voreingestellt“). Ohne eigenen Speicher der Vorliebe. |

## 4. Status

| Paket | Stand |
|---|---|
| HK-0 | in Arbeit |
| HK-1 | geplant |
| HK-2 | geplant |
| HK-3 | geplant |
| HK-4 | geplant |

## 5. Offene Punkte

- Manuelle Browser-Prüfungen der Pakete HK-2 bis HK-4.
