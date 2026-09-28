# E6-Plan, Teil Offene Reste A: „wiederkehrend“ filtern und gruppieren, Wiederholen beim Anlegen, jeden Termin einzeln, zwei Ebenen, mehrere Wochentage

- **Stand:** in Arbeit (2026-09-28).
- **Grundlage:**
  - Nutzerentscheidungen vom 2026-09-28 (Auftrag „Offene Reste“, Teil A); der Papierkorb ist ein eigener Auftrag danach.
  - [ADR-0013](../adr/0013-filter-suche-sortierung-gruppierung.md) (Filter, Gruppen, Paritätstest), [ADR-0021](../adr/0021-regelmodell-wiederkehrende-aufgaben.md) bis [ADR-0024](../adr/0024-serien-aus-kalendern.md) (Wiederholungen), [ADR-0030](../adr/0030-spalten-breiten-und-kompakte-zeilen.md) (Spalten), [ADR-0033](../adr/0033-unteraufgaben.md) (eingerückte Unteraufgaben), [ADR-0034](../adr/0034-unterprojekte.md) (Projektpfad in Gruppen), [ADR-0035](../adr/0035-start-einstieg-und-offene-tabs.md)
  - Hinweise aus den Plänen [E5](e5.md) §10 („Spalten und Filter“, „Papierkorb“), [Unteraufgaben](unteraufgaben.md) §7 (Gruppen trennen Unteraufgaben), [Spalten](e6-spalten.md), [Start und Fenster](start-fenster.md)
  - [CLAUDE.md](../../CLAUDE.md) §3, §5, §6, §7, §11, §12
- **Einordnung:** Paketkürzel `OR` („Offene Reste“), Manifest-Block ab `BYL-E6-300` (Start und Fenster endet bei 290). Die nächste freie ADR-Nummer wäre 0036; dieser Teil braucht keine neue ADR, sondern Nachträge in ADR-0013, ADR-0022 und ADR-0023.

## 1. Querschnittsregeln

- **Hooks nur fertig und getestet:** Die Instanz des Nutzers läuft aus `app/` im Hauptordner des Repos und lädt Hooks sofort. Gearbeitet wird deshalb in einem eigenen Git-Worktree außerhalb des Live-Ordners; im Live-Ordner landet ein Hook erst mit `git pull` auf `main` nach dem Merge.
- Migrationen wirken erst nach dem nächsten Start (stop.bat, dann start.bat). Jeder Hook läuft auch auf dem Schema davor (`hooks-before-migration.test.mjs`), und die SPA zeigt vorher `restartNeeded()`.
- Keine neue Abhängigkeit, keine neuen Farb- oder Maß-Tokens. Schriftgrößen nur über `--font-size-*`, Radien nur über `--radius-*`; berührte Dateien ziehen von den Ausnahmelisten auf die Tokens, die Listen schrumpfen nur.
- Nur die bestehenden Bausteine (Popover, Drawer, Modal, Flags, `SectionMessage`, Switch, Chips). Was jsdom nicht kann, steht als manueller Fall im Test-Manifest.
- **Gates je Paket:** eigener Branch und PR, `scripts\build.ps1` lokal komplett grün (Exit-Code 0 und „Build complete!“), CI grün (höchstens drei Versuche; ein roter PR hält die folgenden auf), Squash-Merge mit `--delete-branch`, danach `main` ziehen und `build.ps1` auf `main`, Test-Manifest nachgezogen, Entscheidungen in §3.

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| OR-1 | Tests für mehrere Wochentage: Fälle in `cases.json` (Mo/Mi/Fr, Monats- und Jahreswechsel, Sommerzeit, Anker mitten in der Woche, Vorlauf 0 und größer, „nach Erledigung“, Intervall 2 mit drei Tagen), unabhängiger Referenzrechner nur im Test, Integrationstest mit offener Instanz, Komponententest der Vorschau | BYL-E6-300 |
| OR-2 | Filter „Wiederkehrend: alle / nur wiederkehrende / nur einmalige“ (URL), Gruppe „Nach Wiederholung“, Server-Filter `recurrence != ""` mit Paritätstest | BYL-E6-301, BYL-E6-302 (manuell) |
| OR-3 | Gruppieren über zwei Ebenen: Popover mit erster und zweiter Ebene, verschachtelte aufklappbare Gruppenköpfe mit Zählern, Aufklappzustand pro Sitzung, Einrückung nur in derselben Blattgruppe; Nachtrag ADR-0013 | BYL-E6-303, BYL-E6-304 (manuell) |
| OR-4 | „Neues Ticket“ mit einklappbarem Abschnitt „Wiederholen“ (Formular und Vorschau), Ticket und Regel im Zwei-Schritt-Weg, bei gescheiterter Regel das Angebot „Wiederholen…“ | BYL-E6-305, BYL-E6-306 (manuell) |
| OR-5 | „Jeden Termin einzeln anlegen“ pro Regel (Switch, standardmäßig aus): Migration mit neuem eindeutigen Index, Erzeugung je Termin mit Obergrenze pro Lauf, Rückgängig nach ADR-0023 in beiden Modi, Integrationstests in beiden Modi; Nachträge ADR-0022 und ADR-0023, CLAUDE.md §6 | BYL-E6-307 bis BYL-E6-309 (manuell) |

## 3. Entscheidungen

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-28 | OR-1 | **Eigener Worktree** (`git worktree`) für alle Pakete: Hooks im Ordner `app/` des Hauptordners wirken sofort in der Instanz des Nutzers, auch unfertige. Der Worktree hat eigene Abhängigkeiten und ein eigenes `pocketbase.exe` (über `scripts/fetch-pocketbase.ps1`, SHA256-geprüft). |
| 2026-09-28 | OR-1 | **Referenzrechner** `tests/support/recurrence-reference.mjs`: kennt die Module nicht, fragt die Definition aus ADR-0021 §2 für jeden einzelnen Tag und läuft ohne Sprung (`onOrAfter`, `after`, `latestOnOrBefore`, `upcoming`, `catchUp`, `afterCompletion`, `createOn`). Die tageweise Prüfung aus `recurrence.test.mjs` zieht dorthin um. `recurrence-reference.test.mjs` prüft beide Module (Hook und SPA) dagegen: alle 127 Mengen von Wochentagen mit Intervall 1 bis 3 und Anker an jedem Wochentag an Monats-, Jahres- und Zeitumstellungen, Vorlauf 0 bis 30 und 1 500 Zufallsregeln; außerdem bestätigt er jede erwartete Zahl der gemeinsamen Falltabelle. |
| 2026-09-28 | OR-1 | **Falltabelle:** 33 neue Fälle, die meisten mit Mo/Mi/Fr, dazu Vorlauf 0, 1, 3 und 5, „nach Erledigung“ über die Zeitumstellungen, ein doppelter Wochentag und die Normalisierung der Reihenfolge. Sommerzeit betrifft reine Kalenderdaten nicht; die Fälle belegen, dass Wochen über die Umstellungssonntage richtig zählen. Das Berliner „heute“ an den Umstellungstagen prüft weiter `recurrence.test.mjs` über `berlin-time.js`. |
| 2026-09-28 | OR-1 | **Integrationstest** in `recurrence-generate.test.mjs` mit der Test-Uhr: Eine Regel Mo/Mi/Fr erzeugt mit offener Instanz nichts, danach nur den jüngsten verpassten Termin; mit Vorlauf 2 erscheint der nächste Tag erst nach dem Erledigen. Der zweite Modus („jeden Termin einzeln“) folgt mit OR-5 im selben Block. |
| 2026-09-28 | OR-1 | **Vorschau im Komponententest** über `RecurrenceFormHarness` (bindet die Werte wie Dialog und Panels), weil `RecurrenceForm` keine eigenen Werte hält. |

## 4. Status

| Paket | Stand |
|---|---|
| OR-1 | in Arbeit |
| OR-2 | geplant |
| OR-3 | geplant |
| OR-4 | geplant |
| OR-5 | geplant |

## 5. Offene Punkte

- Manuelle Browser-Prüfungen der Pakete (siehe Test-Manifest).
