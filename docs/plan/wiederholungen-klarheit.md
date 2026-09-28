# E6-Plan „Wiederholungen verständlich machen“: Erklärung in der App und acht Empfehlungen

- **Stand:** in Arbeit (2026-09-28). WK-1 umgesetzt.
- **Grundlage:**
  - Vom Nutzer freigegebene Spec vom 2026-09-28: Teil A (Erklärung in der App: „So funktioniert’s“ im Formular mit Live-Beispielsatz, Vorschau „erscheint → fällig“, Kurz-Hinweise, Hilfeseite „Wiederholungen“, Beispiele aus der echten Rechenlogik mit Tests) und Teil B (Empfehlungen 1 bis 8).
  - [ADR-0021](../adr/0021-regelmodell-wiederkehrende-aufgaben.md) bis [ADR-0024](../adr/0024-serien-aus-kalendern.md) mit allen Nachträgen, [ADR-0013](../adr/0013-filter-suche-sortierung-gruppierung.md), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0009](../adr/0009-fehlerfarbe.md), [ADR-0029](../adr/0029-glas-materialien.md), [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md), [ADR-0035](../adr/0035-start-einstieg-und-offene-tabs.md), [ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md), [ADR-0037](../adr/0037-papierkorb.md)
  - Pläne [Offene Reste](offene-reste.md) (§5: mehrere offene Tickets einer Regel) und [Papierkorb](papierkorb.md)
  - [CLAUDE.md](../../CLAUDE.md) §5, §6, §7, §8, §11, §12
- **Einordnung:** Paketkürzel `WK`, Manifest-Block ab `BYL-E6-340` (der Papierkorb endet bei 338). Neue Entscheidungen als Nachträge in ADR-0022 und ADR-0023 (keine neue ADR nötig, solange nichts Grundsätzliches dazukommt). Migrationen nur nach `1790202300_tickets_trash.js`, mit Rückweg und Test mit Daten.

## 1. Querschnittsregeln

- Gearbeitet wird in einem eigenen Worktree außerhalb des Live-Ordners: Hooks im Ordner `app/` des Live-Ordners wirken sofort in der Instanz des Nutzers.
- Keine neue Abhängigkeit, keine neuen Farb- oder Maß-Tokens; Schriftgrößen und Radien nur über Tokens, die Ausnahmelisten schrumpfen nur. Rot nur für echte Fehler, Warnungen im Warnton ohne Rot. Kein Dialog aus einem Dialog: Fragen stehen inline als `SectionMessage`.
- **Beispiele sind nie hart kodiert:** Daten in Hilfe und Live-Satz rechnet dieselbe Logik wie Vorschau und Server; Tests gleichen sie mit dem Hook ab.
- **Gates je Paket:** eigener Branch und PR, `scripts\build.ps1` lokal grün, CI grün, Squash-Merge, Branch löschen, im Live-Ordner `git pull` und `build.ps1` grün, Test-Manifest nachgezogen.

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| WK-1 | Empfehlung 1 (Wiedereröffnen nur beim direkten Vorgänger mit Entfernen des Folgetickets, sonst Ablehnung mit „Als normales Ticket wieder öffnen (aus der Serie lösen)“) und Empfehlung 3 (zusammengefasste verpasste Termine als Verlaufseintrag und Hinweis im Ticket) | BYL-E6-340 bis BYL-E6-342 |
| WK-2 | Empfehlung 5 (Schalter mit mehr als 20 verpassten Terminen: „wartet auf Entscheidung“, Migration) und Empfehlung 6 (Schalter aus bei mehreren offenen Tickets) | ab BYL-E6-343 |
| WK-3 | Empfehlungen 2, 4 und 7 sowie die Vorschau „erscheint → fällig“ | folgt |
| WK-4 | Teil A: „So funktioniert’s“ mit Live-Satz, Kurz-Hinweise, Hilfeseite „Wiederholungen“ mit Beispielen aus der Engine und Tests; Empfehlung 8 (Doku) | folgt |

## 3. Entscheidungen

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-28 | WK-1 | **Direkter Vorgänger** ist die Instanz der Regel mit dem jüngsten `completed_at` (erledigt, noch in der Serie; Tickets im Papierkorb oder aus der Serie gelöst haben keine Regel mehr und zählen nicht). Nur für sie entfernt das Wiedereröffnen ein unberührtes Folgeticket wie bisher. Eine ältere Instanz lehnt der Hook mit dem neuen Code `validation_recurrence_reopen_older` und dem Key des offenen Tickets ab, auch wenn das Folgeticket unberührt ist. Reine Entscheidung `reopenOutcome` in `lib/recurrence-rules.js`. Mit „Jeden Termin einzeln anlegen“ ändert sich nichts (dort gilt jede Instanz als direkt; `reopenConflicts` findet im Normalfall ohnehin keinen Konflikt). |
| 2026-09-28 | WK-1 | **Ausweg ohne neuen Server-Weg:** „Als normales Ticket wieder öffnen (aus der Serie lösen)“ sendet Status und `recurrence: ""` in einer Anfrage (`TicketPatch.detachSeries`). Der Hook kennt das schon: Lösen einer erledigten Instanz ändert an der Regel nichts (ADR-0023 §6), und ohne Regel gibt es keinen Konflikt. Er gilt für beide Ablehnungen (älteres Ticket und bearbeitetes Folgeticket). |
| 2026-09-28 | WK-1 | **Oberfläche:** Im Panel und in der Vollansicht steht die Ablehnung inline unter dem Status (`TicketReopenQuestion`, `SectionMessage` Warnung ohne Rot, Titel „Nicht wieder in die Serie“, Fokus auf „Abbrechen“, Esc bricht ab) wie die Frage nach Unteraufgaben; kein Dialog, weil aus der Vollansicht keiner aufgeht. In der Tabelle (Häkchen, „Rückgängig“, Status-Zelle) bleibt es ein Fehler-Flag mit dem Grund, jetzt mit der Aktion „Als normales Ticket wieder öffnen (aus der Serie lösen)“. |
| 2026-09-28 | WK-1 | **Endgültiges Entfernen bleibt:** Das unberührte Folgeticket des direkten Vorgängers wird weiter endgültig entfernt, nicht in den Papierkorb gelegt: Der Server hat es eben erst angelegt, es trägt nichts vom Nutzer, und ein Wiederherstellen würde nur mit der wieder offenen Instanz kollidieren (ADR-0023 Nachtrag 3). Das Versehen „Häkchen zu früh“ bleibt so folgenlos. |
| 2026-09-28 | WK-1 | **Verpasste Termine sichtbar ohne neues Feld:** Fasst die Erzeugung ohne Schalter verpasste Termine zusammen, schreibt der Dienst in derselben Transaktion einen Verlaufseintrag `recurrence_skipped` am neuen Ticket (ohne Nutzer, `old_value` die Regel, `new_value` JSON `{ count, dates, more }` mit höchstens 5 Daten, Zählung bis 1 000). `ticket_history.field` ist freier Text, eine Migration ist nicht nötig. Der Verlauf nennt „2 Termine übersprungen (12.10.2026, 19.10.2026), zusammengefasst in diesem Ticket“ mit „Wiederholung“ als Urheber, die Zeile „Wiederholt sich“ zeigt denselben Hinweis neutral („… ; dieses Ticket steht für sie mit.“) aus dem ohnehin geladenen Verlauf. Das Folgeticket bleibt „unberührt“ (`updated = created`). |

## 4. Status

| Paket | Stand |
|---|---|
| WK-1 | in Arbeit |
| WK-2 | geplant |
| WK-3 | geplant |
| WK-4 | geplant |

## 5. Offene Punkte

- Manuelle Browser-Prüfungen der Pakete (Test-Manifest).
