# Plan „Farben für Projekte und Tickets“

- **Stand:** FA-1 umgesetzt (2026-10-02, Branch `feat/farben`). Migration `1790203400_colors.js`: **Neustart nötig** (`neu-starten.bat`), danach F5. Offen sind die manuellen Prüfungen BYL-E6-1215 bis BYL-E6-1217.
- **Grundlage:** Nutzerwunsch („Tickets und Projekte farbig markieren, die dann auch im Kalender so angezeigt werden“), Freigabe der Empfehlungen am 2026-10-02 („Alle Empfehlungen so umsetzen“): Projekte bekommen eine Farbe, ihre Tickets übernehmen sie, Unterprojekte erben die des Oberprojekts; Tickets können optional eine eigene Farbe haben („wie Projekt“ als Standard); feste Palette von etwa 10 bis 12 benannten Farben, die in allen vier Themes in Hell und Dunkel funktioniert; kein Signalrot; Farbe nur als Streifen oder Punkt, nie vollflächig und nie allein.
- **Entscheidungen:** [ADR-0052](../adr/0052-farben-fuer-projekte-und-tickets.md); Nachträge zu [ADR-0027](../adr/0027-akzent-themes.md), [ADR-0034](../adr/0034-unterprojekte.md), [ADR-0022](../adr/0022-erzeugung-von-instanzen.md) (Nachtrag 11), [ADR-0045](../adr/0045-ticket-duplizieren.md) und [ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md).
- **Einordnung:** Manifest-Block „Farben für Projekte und Tickets“ ab `BYL-E6-1200` (1180 bis 1199 nutzt ein paralleles Paket, ab 1250 folgt der Kalender).

## 1. Paket

| Paket | Inhalt | Stand |
|---|---|---|
| FA-1 | Palette als Tokens mit Kontrast- und Fehlerrot-Test, Migration mit Rückweg, Vererbung als gemeinsame Funktion, Verlauf, Vorlage und Duplikat, Datenschicht und Realtime, Farbwahl und Anzeige in Tabelle, Projekten, Ticket, Listen und Sammelaktion, Hilfe, README | umgesetzt |

Ein Paket statt Server und Oberfläche getrennt: Die Oberfläche braucht die Felder, und die Felder ohne Oberfläche wären bis zum zweiten Paket ungenutzt.

## 2. Palette

| Schlüssel | Name | Hell | Dunkel | kleinster Kontrast hell / dunkel | ΔE zum Fehler hell / dunkel |
|---|---|---|---|---|---|
| `violett` | Violett | `#8A569E` | `#B2A1E6` | 4,39 / 5,36 | 21,2 / 20,6 |
| `indigo` | Indigo | `#394085` | `#667FD6` | 7,63 / 3,27 | 30,1 / 31,6 |
| `blau` | Blau | `#1364B2` | `#61A2E5` | 4,91 / 4,59 | 38,3 / 37,2 |
| `himmel` | Himmelblau | `#1B87A4` | `#8DD0E9` | 3,40 / 7,24 | 51,4 / 44,3 |
| `tuerkis` | Türkis | `#2A847D` | `#6ECBC2` | 3,65 / 6,45 | 47,0 / 45,1 |
| `gruen` | Grün | `#3D7740` | `#70AF71` | 4,38 / 4,73 | 48,2 / 45,7 |
| `oliv` | Oliv | `#717D2D` | `#B1BD65` | 3,67 / 6,07 | 38,7 / 36,8 |
| `senf` | Senf | `#9C7A22` | `#E7C263` | 3,28 / 7,22 | 26,7 / 27,6 |
| `braun` | Braun | `#644C27` | `#9C865F` | 6,58 / 3,52 | 20,2 / 21,1 |
| `grau` | Grau | `#646E76` | `#97A2AA` | 4,25 / 4,74 | 29,8 / 26,2 |

- **Kontrast:** kleinster Wert je Farbe über Fläche, Hintergrund, Akzentfläche und Glas (regular und thick über Seite und Verlauf, thick über dem Schleier) aller vier Themes; Anforderung 3 : 1 (WCAG 1.4.11). **Fehlerabstand:** kleinster ΔE2000 zur Fehlerfarbe der vier Themes (Petrol und Smaragd `#A13A40`/`#EAA0A0`, Rubin `#A7472A`/`#E28E78`, Kupfer `#A0334F`/`#E58FAB`); Anforderung 20 wie für die Akzente. Untereinander mindestens 12 (kleinster Wert 12,6).
- **Gesucht** wurde in LCh (CIELAB): Bänder der Helligkeit, die der Kontrast vorgibt (hell L\* unter etwa 56, dunkel über etwa 53), mäßige Sättigung, Farbtöne von Violett bis Braun; Rot, Orange, Rosa und Magenta fallen am Fehlerabstand heraus (im Rubin-Theme ist der Fehler ein gebranntes Orange, im Dunkeln sind alle Fehler rosa).
- Geprüft in `web/src/lib/styles/project-colors.test.ts` (Werte aus `tokens.css`, Rechnung aus `test/color-math.ts`).

## 3. Datenmodell

- `projects.color`, `tickets.color`, `recurrence_rules.color`: Select mit den zehn Schlüsseln, nicht Pflicht; leer = keine bzw. „wie Projekt“. Select statt Text mit Hook (ADR-0052 §2).
- **Effektive Farbe** (`domain/colors.ts`): `ticketColorOf(ticket, projekt)` = eigene → Projekt → Oberprojekt → keine; `projectColorOf(projekt)` = eigene → Oberprojekt; `colorText` nennt Farbe und Herkunft. Der `CatalogStore` hält Projekte mit `color` und das aufgelöste Oberprojekt mit dessen Farbe; `colorsReady` ist falsch, solange der Server das Feld nicht kennt.
- **Hooks:** `color` in `TRACKED_FIELDS` (Verlauf); `newInstance` setzt die Farbe der Vorlage; die Route „Duplizieren“ übernimmt sie mit dem Schalter `color`. Keine Prüfung im Hook nötig.

## 4. Anzeige

| Ort | Wie |
|---|---|
| Aufgaben-Tabelle | Streifen 0,25rem am Anfang der Auswahlzelle (ohne Auswahl: der Key-Zelle), 0,375rem vom Rand, also 3 px neben dem Akzentbalken der geöffneten Zeile; Höhe der Zeile ohne Innenabstand, kompakte Zeilen bleiben gleich hoch; Name als `title` und verborgener Text in der Zelle; „Nach Projekt“: Punkt vor dem Namen der Gruppe (der Name der Gruppe nennt das Projekt) |
| Projektliste, Kacheln | Punkt vor dem Namen, „, Farbe Blau“ verborgen nach Name bzw. Code |
| Projekt-Panel | Farbwahl im Formular |
| Ticket-Panel, Vollansicht | Punkt vor Pfad bzw. Key im Kopf des Panels, vor dem Titel im Kopf der Vollansicht (Snippet `titleLead` des Modals, außerhalb des Namens des Dialogs) |
| Offene Tickets (PT-1) | Punkt vor dem Key, Name nach dem Titel im Link |
| `TicketPicker` | kurzer Balken vor dem Key (nie verwechselbar mit dem Punkt „neu“), Name nach dem Titel in der Option |
| Menü der Zelle „Projekt“ | Punkt vor jedem Projekt (der Text nennt das Projekt) |
| `ProjectSelect` | keine Farbe (natives `select`, ADR-0052 §4); die Farbwahl darunter nennt „Wie Projekt (Blau)“ |

Erledigte Zeilen behalten ihren Streifen in voller Farbe (eine gedämpfte Farbe hielte keine 3 : 1). Im Kontrastmodus von Windows zeigt ein transparenter Rand von 1 px die Form.

## 5. Bedienung

- `ColorChoice`: Radiogruppe mit Etikett „Farbe“, je Option natives Radio, Swatch (dekorativ) und Name; zuerst „Keine“, „Wie Oberprojekt (…)“ bzw. „Wie Projekt (…)“ mit dem geerbten Swatch (ohne: gestrichelter Kreis). Fehler am Feld.
- **Projekt-Panel und „Neues Projekt“:** im Formular nach „Oberprojekt“, gespeichert mit dem Formular (nur bei Änderung), Frage beim Verwerfen; vor dem Neustart der Hinweis `restartNeeded('Farben sind')`.
- **Ticket-Panel und Vollansicht:** in `TicketFields` nach „Projekt“, speichert sofort (`TicketDetailStore.choose('color', …)`), eine Ablehnung am Feld mit dem gespeicherten Wert.
- **„Neues Ticket“:** nach „Projekt“, „Wie Projekt“ vorgewählt und dem gewählten Projekt folgend; nur eine eigene Farbe wird gesendet.
- **Wiederholung:** Vorlage im Regel-Panel und am Ticket; „Wiederholen…“ nimmt die eigene Farbe des Tickets mit; das Flag „Auch für künftige Tickets übernehmen“ kennt die Farbe.
- **Duplizieren:** „Farbe: Blau“ unter „Übernehmen“, angehakt.
- **Sammelaktion „Farbe“:** Menü mit „Wie Projekt“ und den zehn Farben, „Rückgängig“ im Flag. Keine Zelle „Farbe“ (ADR-0036, Nachtrag).

## 6. Vor und nach dem Neustart

Neue Hooks und SPA laufen sofort, die Migration erst nach `neu-starten.bat`. Bis dahin: Antworten ohne `color`, keine Farbwahl (Katalog `colorsReady` falsch, `Ticket.color` fehlt), Projekt-Panel mit Neustart-Hinweis; die Hooks lesen eine leere Farbe und setzen nichts. Danach haben alle Datensätze keine Farbe, bis der Nutzer eine wählt.

## 7. Tests

- Unit: `domain/colors.test.ts` (Palette, strenges Lesen, Vererbung, Texte), `styles/project-colors.test.ts` (Tokens, Kontrast in 4 × 4 Varianten, Fehlerabstand, Unterscheidbarkeit), `glass-contrast.test.ts` und `tokens.test.ts` unverändert grün, `history.test.mjs`, `duplicate-rules.test.mjs`, `history-format.test.ts`, `labels.test.ts`, `series-template.test.ts`, `bulk.test.ts`, `duplicate.test.ts`, `stores/catalog.test.ts`, `stores/catalog-editor.test.ts`, `stores/recurrence-store.test.ts`.
- Hook und Migration: `tests/integration/colors.test.mjs` (Gleichstand der Palette, Validierung, Verlauf, Duplikat, Datenschicht), `migrations-rollback.test.mjs` (Rückweg mit Daten; die älteren Fälle laufen die Migration mit), `recurrence-generate.test.mjs` (Farbe der Vorlage), `web-realtime.test.mjs`, `web-data-tickets.test.mjs`, `tests/support/schema.mjs`.
- Komponenten: `components/colors.test.ts` (`ColorChoice`, `ColorMark`, Liste, Kacheln), `ticket-table-row.test.ts`, `ticket-table.test.ts`, `ticket-table-inline.test.ts`, `ticket-table-selection.test.ts`, `ticket-panel.test.ts` (Panel und Vollansicht), `project-panel.test.ts`, `new-ticket.test.ts`, `recurrence-panel.test.ts`, `ticket-duplicate.test.ts`, `project-ticket-list.test.ts`, `ticket-picker.test.ts`, Hilfe (`help-page.test.ts`).
- Automatisiert: BYL-E6-1200 bis BYL-E6-1214. Manuell: BYL-E6-1215 (Sichtprüfung in allen Themes hell und dunkel, mit und ohne Glas, Kontrastmodus), BYL-E6-1216 (Screenreader), BYL-E6-1217 (Neustart und zwei Tabs).
