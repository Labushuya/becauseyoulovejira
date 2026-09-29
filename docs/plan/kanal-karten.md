# Plan „Kanal-Karten vereinheitlichen“

- **Stand:** KK-1 umgesetzt (2026-09-30, Branch `fix/locked-cursor`), KK-2 geplant. Keine Migration, kein Neustart (nur der Build der SPA, dann F5).
- **Grundlage:** Spec des Nutzers vom 2026-09-30 („Vorschlag passt“): Darstellungen und Optionen der Kanal-Karten anpassen, ohne funktionale Einbußen in der Anzeige. Dazu zwei Befunde des Advisors: der Warte-Zeiger über gesperrten Knöpfen und „Andere Quelle“ im Notion-Import, das nicht links steht.
- **Entscheidungen:** [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), Nachträge vom 2026-09-30 (keine neue ADR). Bezüge: [ADR-0016](../adr/0016-kanal-architektur-und-mail.md) und [ADR-0020](../adr/0020-stichwoerter-pro-kanal.md) (Kanäle, Mail), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) (Menüs, Modal), [ADR-0029](../adr/0029-glas-materialien.md) (Glas), [ADR-0038](../adr/0038-eigener-eingang-und-whatsapp-web.md) (eigener Eingang, WhatsApp Web), [ADR-0041](../adr/0041-notion-listen-uebernehmen.md) (Notion samt Nachtrag), [CLAUDE.md](../../CLAUDE.md) §7 und §8, [Plan Layout-Überlauf](layout-ueberlauf.md).
- **Einordnung:** Manifest-Block „Kanal-Karten“ ab `BYL-E6-620`.

## 1. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| KK-1 | Mauszeiger „gesperrt“ und „beschäftigt“ app-weit, Fuß der Modals mit Knopf links | umgesetzt |
| KK-2 | Ein Karten-Baustein für alle Kanäle: Kopfzeile, eine Infozeile, ein Hauptknopf, Menü „•••“, aufklappbare Details; Inventur alt → neu mit Test | geplant |

## 2. KK-1: Mauszeiger und Fuß der Modals

### 2.1 Befund

- `base.css` gab jedem gesperrten Knopf der Knopfklassen (`disabled`, `aria-disabled="true"`) `cursor: progress`, dazu sieben Komponenten ihren eigenen Knöpfen (Kommentar, Zeilen des Eingangs, „Weitere laden“ zweimal, Serie im Ticket, Tag umbenennen, Tag entfernen) und die Zellen der Tabelle. Nach einem Notion-Import zeigte der gesperrte Import-Knopf so „beschäftigt“, obwohl nichts mehr lief.
- Umgekehrt trugen viele laufende Aktionen kein `aria-busy`; sie waren nur gesperrt.
- „Andere Quelle“ im Notion-Import und „Später fortsetzen“ in den Assistenten (Kanäle, WhatsApp Web, Proton) haben `margin-right: auto`, standen aber rechts neben den anderen Knöpfen: Die Gruppe `.buttons` im Fuß von `Modal.svelte` war nur so breit wie ihr Inhalt, der Abstand hatte keinen Platz.

### 2.2 Umsetzung

- **Regel** (ADR-0026, Nachtrag vom 2026-09-30): gesperrt `cursor: not-allowed`; `cursor: progress` nur mit `aria-busy="true"` am Knopf oder an seinem Bereich, gesperrte Controls in einem beschäftigten Bereich ebenfalls. In `base.css` nach den Regeln der gesperrten Knöpfe (gleiche Spezifität, spätere Regel gewinnt), für Checkboxen und Radios mit eigener Regel. Komponenten mit eigenen Knopfklassen setzen „nicht erlaubt“ und ihre Regel für den beschäftigten Zustand selbst, weil ihre Regeln spezifischer sind.
- **Inventur der laufenden Aktionen:**

| Stelle | Vorher | Jetzt |
|---|---|---|
| Dialoge mit `busy` (Bestätigung, Gesammelt umwandeln, Datei, Zwischenablage, WhatsApp, Postfach, Notion, Quelle hinzufügen, Verknüpfen, Zuordnen, Wiederholen, Schnellerfassung) | `aria-busy` am Dialog | unverändert, gesperrte Knöpfe darin zeigen den Warte-Zeiger |
| Leiste der Sammelaktionen (`SelectionBar`) | Fortschritt ersetzt die Knöpfe, ohne `aria-busy` | `aria-busy`, solange der Fortschritt steht |
| „Papierkorb leeren …“ während einer Sammelaktion | gesperrt | `aria-busy` |
| „Alle Kanäle jetzt abrufen“, „Jetzt abrufen“ der Karte und des Assistenten, „Verbindung prüfen“ (Notion), „Erneut abrufen“, Erledigt-Häkchen, Dateiauswahl, Switch „Blockiert das übergeordnete Ticket“, Zeilen des Papierkorbs, Fragen beim Erledigen, Löschen und Wiedereröffnen im Ticket, Formulare der Einrichtung | `aria-busy` | unverändert |
| Neues Ticket, Erfassen, Projekt-Panel, Regel-Panel | Knopf gesperrt | Knopf und Formular `aria-busy` (Projekt-Panel auch der Bereich „Archiv“, Regel-Panel „Pausieren“) |
| Beschreibung (Speichern, Überschreiben), Kommentar (Senden, Speichern), übergeordnetes Ticket (Übernehmen, Lösen), Tag umbenennen, Stichwörter | gesperrt | laufender Knopf bzw. Formular oder Fieldset `aria-busy` |
| Eingang: Zeile (Verwerfen, Wiederherstellen, Zuordnen), Panel (Verwerfen, Verknüpfen, Wiederherstellen, Zuordnen, Lösen) | gesperrt | `aria-busy` am Knopf bzw. an der Gruppe |
| Quellen eines Tickets | gesperrt | Eintrag der Liste `aria-busy` |
| Papierkorb: Vorschau, Frage nach Projekt oder Serie | gesperrt | `aria-busy` |
| Rückstand einer Regel, Pausieren in Übersicht und Ticket | gesperrt | `aria-busy` am Knopf bzw. an der Gruppe |
| „Weitere laden“ (Eingang, Erledigte), Fälligkeit im Panel, Zellen der Tabelle | eigener Warte-Zeiger bzw. gesperrt | `aria-busy` |
| Anmelden, „Erneut versuchen“ der Sitzung, „Prüfen“ (WhatsApp Web), Einstellungen → Tickets beim Laden | gesperrt | `aria-busy` |
| „Hilfsprozess prüfen“ im Assistenten der Postfächer | ohne Sperre (ein zweiter Klick prüfte noch einmal) | „Hilfsprozess wird geprüft …“ mit `aria-busy` und `aria-disabled` |
| Gesperrte Knöpfe der Knopfklassen ohne laufende Aktion: Import des Notion-Imports ohne Auswahl, „Weiter“ ohne Quelle, Spalten schmaler/breiter an der Grenze, „Standard wiederherstellen“ ohne Änderung, „Zugangsschlüssel erzeugen …“ vor dem Laden | Warte-Zeiger | „nicht erlaubt“ |

- **Fuß der Modals:** `.buttons` füllt den Fuß (`flex: 1 1 auto`) und hält die Knöpfe rechts; ein Knopf mit `margin-right: auto` nimmt den freien Platz und steht links. Das gilt für alle Dialoge; die Verwerfen-Frage im Fuß behält ihren Text links.

### 2.3 Tests

- `web/src/lib/no-busy-cursor.test.ts` (BYL-E6-620): statisch über `base.css` und jede Komponente, dazu die Leiste der Sammelaktionen in jsdom.
- `web/src/lib/components/overlay/modal.test.ts` (BYL-E6-621): `.buttons` füllt den Fuß.
- Manuell BYL-E6-622: Zeiger und Fuß im Browser (jsdom rechnet weder Zeiger noch Layout).

## 3. KK-2: Ein Baustein für alle Kanal-Karten

Nach der Spec: Kopfzeile mit Symbol, Name und Status-Lozenge (verbunden, pausiert, Fehler, Einrichtung offen, Neustart nötig; Rot nur bei echtem Fehler), genau eine Infozeile, genau ein Hauptknopf je nach Zustand, alle weiteren Aktionen im Menü „•••“ (Popover `menu` nach ADR-0025), Details aufklappbar. Vorher eine Inventur aller Aktionen und Anzeigen je Karte, danach die Zuordnung alt → neu; ein Test sichert, dass jede Aktion erreichbar bleibt. Einzelheiten folgen mit dem Paket.
