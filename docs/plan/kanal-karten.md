# Plan „Kanal-Karten vereinheitlichen“

- **Stand:** KK-1 umgesetzt (2026-09-30, Branch `fix/locked-cursor`), KK-2 umgesetzt (2026-09-30, Branch `feat/channel-cards`). Keine Migration, kein Neustart (nur der Build der SPA, dann F5). Offen sind die manuellen Browser-Prüfungen BYL-E6-622, BYL-E6-627 und BYL-E6-628.
- **Grundlage:** Spec des Nutzers vom 2026-09-30 („Vorschlag passt“): Darstellungen und Optionen der Kanal-Karten anpassen, ohne funktionale Einbußen in der Anzeige. Dazu zwei Befunde des Advisors: der Warte-Zeiger über gesperrten Knöpfen und „Andere Quelle“ im Notion-Import, das nicht links steht.
- **Entscheidungen:** [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), Nachträge vom 2026-09-30 (keine neue ADR). Bezüge: [ADR-0016](../adr/0016-kanal-architektur-und-mail.md) und [ADR-0020](../adr/0020-stichwoerter-pro-kanal.md) (Kanäle, Mail), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) (Menüs, Modal), [ADR-0029](../adr/0029-glas-materialien.md) (Glas), [ADR-0038](../adr/0038-eigener-eingang-und-whatsapp-web.md) (eigener Eingang, WhatsApp Web), [ADR-0041](../adr/0041-notion-listen-uebernehmen.md) (Notion samt Nachtrag), [CLAUDE.md](../../CLAUDE.md) §7 und §8, [Plan Layout-Überlauf](layout-ueberlauf.md).
- **Einordnung:** Manifest-Block „Kanal-Karten“ ab `BYL-E6-620`.

## 1. Pakete

| Paket | Inhalt | Stand |
|---|---|---|
| KK-1 | Mauszeiger „gesperrt“ und „beschäftigt“ app-weit, Fuß der Modals mit Knopf links | umgesetzt |
| KK-2 | Ein Karten-Baustein für alle Kanäle: Kopfzeile, eine Infozeile, ein Hauptknopf, Menü „•••“, aufklappbare Details; Inventur alt → neu mit Test | umgesetzt |

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
| „Weitere laden“ (Eingang, Erledigte), „Mehr anzeigen“ der Ticketauswahl, Fälligkeit im Panel, Zellen der Tabelle | eigener Warte-Zeiger bzw. gesperrt | `aria-busy` |
| Anmelden, „Erneut versuchen“ der Sitzung, „Prüfen“ (WhatsApp Web), Einstellungen → Tickets beim Laden | gesperrt | `aria-busy` |
| „Hilfsprozess prüfen“ im Assistenten der Postfächer | ohne Sperre (ein zweiter Klick prüfte noch einmal) | „Hilfsprozess wird geprüft …“ mit `aria-busy` und `aria-disabled` |
| Gesperrte Knöpfe der Knopfklassen ohne laufende Aktion: Import des Notion-Imports ohne Auswahl, „Weiter“ ohne Quelle, Spalten schmaler/breiter an der Grenze, „Standard wiederherstellen“ ohne Änderung, „Zugangsschlüssel erzeugen …“ vor dem Laden | Warte-Zeiger | „nicht erlaubt“ |

- **Fuß der Modals:** `.buttons` füllt den Fuß (`flex: 1 1 auto`) und hält die Knöpfe rechts; ein Knopf mit `margin-right: auto` nimmt den freien Platz und steht links. Das gilt für alle Dialoge; die Verwerfen-Frage im Fuß behält ihren Text links.

### 2.3 Tests

- `web/src/lib/no-busy-cursor.test.ts` (BYL-E6-620): statisch über `base.css` und jede Komponente, dazu die Leiste der Sammelaktionen in jsdom.
- `web/src/lib/components/overlay/modal.test.ts` (BYL-E6-621): `.buttons` füllt den Fuß.
- Manuell BYL-E6-622: Zeiger und Fuß im Browser (jsdom rechnet weder Zeiger noch Layout).

## 3. KK-2: Ein Baustein für alle Kanal-Karten

Entscheidung im Nachtrag „KK-2“ zu ADR-0026. Hier Aufbau, Konfiguration je Kanal, Inventur und Tests.

### 3.1 Baustein `components/channels/ChannelCard.svelte`

| Teil | Inhalt | Umsetzung |
|---|---|---|
| Kopfzeile | Symbol (`ChannelIcon`), Name (`h4`, Name des `article`), Untertitel, Zustand | `Lozenge` aus `CardStatus`; Zustände in `CARD_STATUS` (`domain/channel-card.ts`), bei Verbindungen aus `channelHealth` |
| Infozeile | genau eine Zeile (`.info-line`), bei laufendem Laden `role="status"` | Texte rein in `domain/channel-card.ts`: `connectionInfo`, `notionInfo`, `inboxKeysInfo`, `relativeTime` |
| Balken | nur während der Vollsuche eines Posteingangs | `progress` unter der Infozeile, `aria-hidden` (die Zeile nennt die Zahlen) |
| Hinweis | höchstens einer (`SectionMessage` compact), dazu der Fehler der letzten Aktion (`live`) | wie bisher |
| Hauptknopf | genau einer (`data-card-primary`), Knopf oder Link, mit dem Namen der Karte für Screenreader | `CardAction`: `busy` setzt `aria-busy` und `aria-disabled`, `locked` nur `aria-disabled`; `inPlace` hält Fokus und Scrollstand für Assistenten in der Adresse |
| Menü „•••“ | alle weiteren Aktionen, Trennlinie vor „Löschen …“ | `Popover` der Art `menu`, Einträge als Knopf oder Link (`role="menuitem"`), Dialoge mit `aria-haspopup="dialog"` |
| Details | aufklappbar unter dem Fuß | Disclosure-Knopf „Details“ (`aria-expanded`, `aria-controls`), der Bereich bleibt im DOM (`hidden`); Zeilen als `dl` im gemeinsamen Stil |
| Anker | `#verbindung-<id>` für „Zur Karte“ | `anchor`, jede Karte `tabindex="-1"` |

Die Uhr der Infozeile (`lib/clock.svelte.ts`, `minuteClock`) tickt alle 30 s, solange die Karte steht; sie holt nichts vom Server.

### 3.2 Konfiguration je Kanal

| Kanal | Zustand | Infozeile | Hauptknopf (nach Zustand) | Menü „•••“ | Details |
|---|---|---|---|---|---|
| Google Calendar, Telegram-Bot | `channelHealth` | „Zuletzt abgerufen … · Ergebnis“ bzw. „Noch nie abgerufen“ | „Wird abgerufen …“ · „Fortsetzen“ · „Einrichtung fortsetzen“ · „Jetzt abrufen“ | „Stichwörter und Einstellungen …“, „Pausieren“, „Einrichtung ansehen“, „Hilfe“, „Löschen …“ | Letzter Abruf (Datum, zuletzt erfolgreich), Ergebnis, Stichwörter, bei Telegram „Ohne Stichwort“, Letzter Fehler |
| Postfach (Web.de, Gmail) | `channelHealth` mit Hilfsprozess („Neustart nötig“) | wie oben, während der Vollsuche „Posteingang wird durchsucht: …“ mit Balken | wie oben, während der Vollsuche „Durchsuchen abbrechen“ | dazu „Aus dem Postfach wählen …“, „Posteingang neu durchsuchen“ und während der Vollsuche „Jetzt abrufen“ | dazu „Durchsucht“, „Automatisch“, „Posteingang“, „Hilfsprozess“ |
| Notion | `channelHealth` (während der Prüfung „Wird geprüft“) | „N Einträge aus M Quellen übernommen · zuletzt abgerufen …“ | „Wird geprüft …“ · „Fortsetzen“ · „Einrichtung fortsetzen“ · „Listen übernehmen …“ | „Verbindung prüfen“, „Einrichtung ansehen“, „Hilfe“, „Löschen …“ | Letzter Abruf, „Bisher übernommen“ je Quelle mit Link zu Notion und „Erneut abrufen“ |
| Eigener Eingang (API) | `inboxKeysStatus`: „Neustart nötig“ vor der Migration, „Fehler“, „Einrichtung offen“ bis ein Programm einen Schlüssel benutzt hat, sonst „Verbunden“ | „N Schlüssel, zuletzt benutzt …“ bzw. „noch nie benutzt“ | „Zugangsschlüssel erzeugen …“ (vor der Migration gesperrt), nach einem Ladefehler „Erneut versuchen“ | „Stichwörter …“, „Hilfe“ | Erklärung, Schlüssel mit Anfang, angelegt, zuletzt benutzt und „Widerrufen …“, „Stichwörter für „mode: auto““ |
| WhatsApp Web | `whatsAppWebStatus`: nur „Neustart nötig“ oder „Einrichtung offen“ (kein Schlüssel, Erweiterung nicht gebaut), sonst keine Lozenge | „Stichwörter für „Automatisch“: …“ | „Einrichten“ (Link auf den Assistenten) | „Stichwörter …“, „Hilfe“ | Erklärung, Stand der Erweiterung |
| Dateien (`.eml` auch aus Proton, `.ics`, WhatsApp-Export) | keine (manuell) | „Stichwörter: Mail 3 · Kalender 0 · WhatsApp 2“ | „Zum Eingang“ (Link) | „Anleitungen und Stichwörter“ (Link auf „Datei-Importe“) | Erklärung |
| Bookmarklet | keine | – | – (ziehbarer Knopf nach ADR-0026 §6) | – | „Ohne Maus einrichten“ wie bisher |

### 3.3 Inventur alt → neu

Vor dem Umbau aufgenommen aus `ChannelCard.svelte` (Verbindung), `NotionCard.svelte`, `OwnInboxCard.svelte`, `WhatsAppWebCard.svelte` und der Dateikarte in `ChannelsView.svelte`. Dieselbe Liste prüft `channel-cards-inventory.test.ts` (BYL-E6-625).

| Karte | Bisher | Jetzt |
|---|---|---|
| Verbindung | Lozenge „Eingerichtet“ / „Nicht eingerichtet“ / „Fehler“ / „Pausiert“ / „Wird abgerufen“ | Lozenge „Verbunden“ / „Einrichtung offen“ / „Fehler“ / „Pausiert“ / „Wird abgerufen“, neu „Neustart nötig“ |
| Verbindung | Untertitel „Art · Anbieter · Benutzer“ | Untertitel, unverändert |
| Verbindung | Zeile „Letzter Abruf“ (Datum, „zuletzt erfolgreich …“) | Infozeile (relativ) und Details (Datum, zuletzt erfolgreich) |
| Verbindung | Zeile „Ergebnis“ | Infozeile und Details |
| Verbindung | Zeile „Stichwörter“ | Details |
| Postfach | Zeilen „Hilfsprozess“, „Automatisch“, „Posteingang“ mit Balken | Details; während der Vollsuche Infozeile mit Balken; Hilfsprozess außer Betrieb zusätzlich als Lozenge „Neustart nötig“ mit Hinweis |
| Verbindung | ein Hinweis (pausiert, Variable fehlt, letzter Fehler, Hinweis des Abrufs, keine Stichwörter) | Hinweis, unverändert; der letzte Fehler zusätzlich in den Details |
| Verbindung | Fehler der letzten Aktion | unverändert |
| Verbindung | Knopf „Jetzt abrufen“ / „Fortsetzen“ / „Einrichtung fortsetzen“ / „Wird abgerufen …“ | Hauptknopf, unverändert |
| Postfach | Knopf „Abbrechen“ (Vollsuche) | Hauptknopf „Durchsuchen abbrechen“, „Jetzt abrufen“ dann im Menü |
| Postfach | Knopf „Aus dem Postfach wählen“ | Menü „Aus dem Postfach wählen …“ |
| Verbindung | Knopf „Bearbeiten“ | Menü „Stichwörter und Einstellungen …“ (dasselbe Modal) |
| Verbindung | Menü „Pausieren“ bzw. „Fortsetzen“ | Menü „Pausieren“; „Fortsetzen“ ist dann der Hauptknopf |
| Verbindung | Menü „Einrichtung ansehen“ | Menü; bei fehlender Variable ist „Einrichtung fortsetzen“ der Hauptknopf |
| Postfach | Menü „Posteingang neu durchsuchen“ | Menü, unverändert |
| Verbindung | Menü „Löschen …“ | Menü, unverändert |
| Verbindung | – | neu: Menü „Hilfe“, Details „Durchsucht“, „Ohne Stichwort“, „Letzter Fehler“ |
| Notion | Zeile „Letzter Abruf“ | Infozeile (relativ) und Details |
| Notion | Zeile „Übernommen“ | Infozeile |
| Notion | Knopf „Listen übernehmen …“ | Hauptknopf |
| Notion | Knopf „Verbindung prüfen“ | Menü |
| Notion | „Wird geprüft …“ / „Wird abgerufen …“ | Hauptknopf (`aria-busy`), Lozenge „Wird geprüft“ bzw. „Wird abgerufen“ |
| Notion | „Fortsetzen“, „Einrichtung fortsetzen“ | Hauptknopf |
| Notion | Menü „Einrichtung ansehen“, „Löschen …“ | Menü |
| Notion | Link „So geht’s“ | Menü „Hilfe“ |
| Notion | „Bisher übernommen“ mit Link zu Notion, Art, Zahl, zuletzt und „Erneut abrufen“ je Quelle, Hinweis dazu | Details |
| Notion | Fehler von „Erneut abrufen“ | Fehler der letzten Aktion der Karte (sichtbar, auch bei zugeklappten Details) |
| Eigener Eingang | Erklärung | Details |
| Eigener Eingang | Liste der Schlüssel mit „Widerrufen …“ | Details |
| Eigener Eingang | leerer Zustand „Noch kein Zugangsschlüssel“ | Infozeile und Satz in den Details |
| Eigener Eingang | „Stichwörter für „mode: auto““ | Details |
| Eigener Eingang | Knopf „Zugangsschlüssel erzeugen …“ | Hauptknopf |
| Eigener Eingang | Knopf „Stichwörter …“ | Menü |
| Eigener Eingang | Link „So geht’s“ | Menü „Hilfe“ |
| Eigener Eingang | Neustart-Hinweis, Ladefehler mit „Erneut versuchen“, „werden geladen …“ | Lozenge „Neustart nötig“ mit Hinweis; Lozenge „Fehler“ mit Hinweis und Hauptknopf „Erneut versuchen“; Infozeile |
| Eigener Eingang | – | neu: Lozenge, Infozeile mit Zahl und letzter Benutzung |
| WhatsApp Web | Erklärung | Details |
| WhatsApp Web | „Stichwörter für „Automatisch““ | Infozeile |
| WhatsApp Web | Link „Einrichten“ | Hauptknopf (Link) |
| WhatsApp Web | Knopf „Stichwörter …“, Link „So geht’s“ | Menü „Stichwörter …“, „Hilfe“ |
| WhatsApp Web | – | neu: Lozenge, wenn die App etwas weiß; Stand der Erweiterung in den Details |
| Dateien | Erklärung | Details |
| Dateien | „Stichwörter: Mail … · Kalender … · WhatsApp …“ | Infozeile |
| Dateien | Link „Zum Eingang“ | Hauptknopf (Link) |
| Dateien | Link „Stichwörter bearbeiten“ | Menü „Anleitungen und Stichwörter“ (dieselbe Seite) |

Texte, die auf Knöpfe der Karte verweisen, nennen jetzt das Menü „•••“ oder „Details“: Hilfe (Kanäle und Zugangsdaten, Notion, häufige Fragen), Assistenten von Web.de, Gmail und Telegram, README.

### 3.4 Tests

- `web/src/lib/domain/channel-card.test.ts` (BYL-E6-623): relative Zeit in Berliner Tagen, Infozeilen, Zustände ohne Verbindung.
- `web/src/lib/domain/channel-health.test.ts` (BYL-E6-624): neue Namen, „Neustart nötig“ mit Rang und Hinweis.
- `web/src/lib/components/channels/channel-cards-inventory.test.ts` (BYL-E6-625): Inventur, je Karte genau eine Kopfzeile, eine Infozeile, ein Hauptknopf.
- `web/src/lib/components/channels/channel-card.test.ts` (BYL-E6-626): Baustein (Menü, Details, beschäftigt und gesperrt, Link) und Karte einer Verbindung samt Uhr; angepasst `connections-page.test.ts`, `notion.test.ts`, `own-inbox-card.test.ts`, `whatsapp-web-setup.test.ts`; die Hilfe (`help-page.test.ts`) beschreibt den Aufbau.
- Manuell BYL-E6-627 und BYL-E6-628: Aussehen, schmale Fenster, Tastatur und NVDA.
- Die Listen `no-own-font-sizes` (163 → 149 Werte, `ChannelCard` und `BookmarkletCard` sind herunter) und `no-own-radii` (`ConnectionsSection` ist herunter) sind geschrumpft.
