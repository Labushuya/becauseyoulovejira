# E6-Plan, Teil EH: Einstellungen, Kanäle und Anleitungen

- **Stand:** in Arbeit (2026-09-26). EH-0 (dieser Plan und [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md)) ist die Grundlage; die Pakete EH-1 bis EH-13 folgen je mit eigenem PR. Der Stand je Paket steht in §8.
- **Anlass:** Rückmeldung des Nutzers:
  1. Die Seite „Kanäle“ und ihr Link sind schlecht dargestellt.
  2. Aus „Kanäle“ kommt man nicht normal zurück.
  3. Das Seitenpanel soll wie in Jira eingebettet sein und den Inhalt zusammenschieben (erledigt mit UI-6b, [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) §11).
  4. Anleitungen sollen besser dargestellt werden.
- **Grundlage:**
  - [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md) (Einstellungsbereich, Hinweis-Bausteine, Assistent, Tour; Entscheidungen des Nutzers)
  - [ADR-0009](../adr/0009-fehlerfarbe.md) (Rot nur für echte Fehler), [ADR-0010](../adr/0010-layout-nach-task-board.md) (Aufbau, Clean-Room), [ADR-0018](../adr/0018-secrets.md) (Zugangsdaten nur als Windows-Variable), [ADR-0020](../adr/0020-stichwoerter-pro-kanal.md) (Stichwörter), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) (Overlay-System)
  - [e6-ui.md](e6-ui.md) (Querschnittsregeln §2, Entscheidungen zu UI-6b, UI-8 und UI-9)
  - [CLAUDE.md](../../CLAUDE.md) §7, §8, §11 und §12
- **Herkunft:** Die Ziel-Spezifikation (§3) stammt aus dem Entwurf „Einstellungen, Kanäle und Anleitungen“ vom 2026-09-25. Übernommen ist sie mit den Entscheidungen des Nutzers (§6) und den Befunden aus UI-6b bis UI-9 (§4, „Hinweise aus UI-6b, UI-8 und UI-9“).
- **Manifest-IDs:** `BYL-E6-029` bis `BYL-E6-064` (reserviert). Der Entwurf reservierte ab `BYL-E6-027`; UI-6b hat `BYL-E6-027` und `BYL-E6-028` vergeben, deshalb verschiebt sich der Block um 2.
- **Clean-Room:** Aus Task-Board und Atlassian Design System (ADS) kommen nur Muster, Maße und Abläufe. Icons, Texte, Illustrationen und CSS entstehen neu.

## 1. Bestandsaufnahme (Stand vor EH-1)

Befund der Spezifikation vom 2026-09-25 (Repo-Stand `65c226f`). Der Panel-Befund (Spezifikation §1.5) ist mit UI-6b erledigt ([ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) §11) und hier nicht wiederholt.

### 1.1 Einstieg und Navigation

| Befund | Stelle | Wirkung |
|---|---|---|
| Der Einstieg ist ein nackter Textlink „Kanäle“ (`.settings`: 0.875rem, Markenfarbe, unterstrichen) zwischen dem Primärknopf „Neues Ticket“ und dem Symbolknopf „Darstellung“ | `AppHeader.svelte` Z. 64 | Die übrigen Elemente der Kopfzeile sind umrandete Knöpfe bzw. Symbolknöpfe. Der Link fällt stilistisch heraus, hat kein Icon und kein `aria-current`. |
| Der App-Name ist ein `<h1>` ohne Link | `AppHeader.svelte` | Der übliche Weg „Logo → Startseite“ fehlt. |
| Die Seite „Kanäle“ hat keinen Umschalter „Aufgaben \| Projekte \| Eingang“, keinen Zurück-Link und keinen Brotkrumenpfad | `routes/(app)/einstellungen/kanaele/+page.svelte`, `ChannelsView.svelte` | Zurück geht nur über den Browser oder über „Neues Ticket“ (das öffnet ein Panel). Das ist Punkt 2 des Nutzers. |
| Es gibt keine Einstellungsseite, nur die eine Route | `routes/(app)/einstellungen/` enthält nur `kanaele/` | Darstellung, Konto und Hilfe haben keinen Ort. Der Theme-Umschalter lebt nur in der Kopfzeile. |
| Der Hinweis im Datei-Dialog verlinkt „Kanäle“ für die Datei-Stichwörter | `FileImportDialog.svelte` Z. 109 | Der Nutzer landet oben auf einer langen Seite; der Abschnitt liegt weiter unten. |

### 1.2 Aufbau der Seite „Kanäle“

Die Seite ist eine einzige Spalte (`max-width: 48rem`, linksbündig, `h2` „Kanäle“, ohne `SectionBar`). Die Reihenfolge von oben nach unten:

1. Karte „Bookmarklet für Web-Links“:
   - Absatz, Link-Knopf, `<ol>` mit 3 Schritten, grauer Hinweis
   - `textarea` mit dem `javascript:`-Code, „Code kopieren“, Statuszeile
2. Karte „Verbindungen“:
   - zwei erklärende Absätze
   - Liste der Verbindungen, darunter immer das Formular „Neue Verbindung“
3. Karte „Stichwörter für Datei-Importe“ mit drei `KeywordEditor`
4. Karte „Zugangsdaten als Windows-Variable setzen“: `<ol>` mit 3 Punkten, grauer Hinweis
5. Karte „Google Calendar einrichten“: 6 Schritte, Hinweis
6. Karte „Telegram-Bot einrichten“: 6 Schritte, Hinweis
7. Karte „Web.de-Postfach einrichten“: 6 Schritte, Zusatzabsatz, Hinweis
8. Karte „Gmail einrichten“: 5 Schritte, Hinweis

**Probleme:**

- **Textwand:**
  - 7 Anleitungslisten mit zusammen 29 Schritten und 6 grauen Hinweisblöcken (0.8125rem, `--color-text-muted`).
  - Alle Anleitungen sind immer offen, auch für längst eingerichtete oder nie gewollte Dienste.
- **Falsche Reihenfolge:**
  - Die Anleitungen stehen **unter** dem Formular, auf das sie verweisen („Oben unter ‚Verbindungen‘ …“).
  - Der Nutzer springt beim Einrichten zwischen Seitenende und Mitte hin und her.
- **Keine Kopierhilfe:** Befehle wie `setx BYL_TELEGRAM_TOKEN "…"` stehen als Inline-`<code>` im Fließtext. Man muss sie abtippen, und der Platzhalter „…“ ist mehrdeutig (Auslassung oder Teil des Befehls?).
- **Kein Zustandsbezug:** Die Anleitung weiß nicht, ob die Verbindung existiert, ob die Variable gesetzt ist oder ob der erste Abruf lief. Die Serverinfos dazu gibt es; sie stehen nur verstreut an der Verbindung.
- **Proton fehlt:** Proton Mail (Weg über `.eml`-Dateien) steht nur in der README.
- **Uneinheitliche Hinweisformen:** `.hint` (grau), `.notice` (Marke-Fläche), `.alert-error` (rot) und `role="status"`-Absätze. Allein `.hint`/`.notice`/`.empty`/`.muted` sind in **23** Komponenten lokal definiert.
- **Bookmarklet:** Die `textarea` zeigt den rohen `javascript:`-Code, das wirkt technisch und abschreckend. Der ziehbare Link sieht aus wie ein Chip. Einen Hinweis, dass man ihn ziehen soll, gibt es erst nach einem Klick.

### 1.3 Die Verbindung in der Liste (`ConnectionsSection.svelte`)

Eine Verbindung ist ein `li` mit dieser Reihenfolge:

1. Kopf: `h4`, Art, Checkbox „Eingeschaltet“
2. `dl`: Variable, IDs, Anbieter, Benutzer, letzter Abruf, zuletzt erfolgreich
3. Status der Zugangsdaten als grauer Text oder `.notice`
4. letzter Fehler (rot)
5. letzter Hinweis (`.notice`)
6. kompletter `KeywordEditor` mit Feld und zwei Knöpfen
7. Checkbox „Antworten“ bzw. „Textanfang durchsuchen“
8. bei Postfächern ein grauer Hinweis zum Neustart, **in jeder Karte wiederholt**
9. Knöpfe „Aus dem Postfach wählen“ bzw. „Jetzt abrufen“ und „Löschen“

Probleme:

- **Kein Status auf einen Blick:** Ob eine Verbindung funktioniert, muss man aus vier Textzeilen ableiten.
- **Lange Einträge:** Jede Verbindung ist mit dem Editor 350 bis 450 px hoch. Drei Verbindungen füllen den Bildschirm.
- **Wirkung ohne Beschriftung:** Die Checkbox „Eingeschaltet“ schaltet sofort und ohne Hinweis, was „aus“ bedeutet.
- **Geringer Abstand zu „Löschen“:** „Löschen“ steht gleichrangig neben „Jetzt abrufen“. Die Bestätigung gibt es, aber das Gewicht stimmt nicht.
- **„Neue Verbindung“ immer offen:** Das Formular steht immer sichtbar unter der Liste. Die Art wählt man per `<select>`, die Beschriftungen sind lang („Variable mit dem Passwort bzw. App-Passwort des Postfachs (Pflichtfeld)“).
- **Leerer Zustand:** Er lautet „Noch keine Verbindung.“ als grauer Text, ohne Aktion.

### 1.4 Hinweise, leere Zustände und Migrationshinweise in der App

| Art | Stelle | Heute | Befund |
|---|---|---|---|
| Migration „nach dem nächsten Start“ | `CONNECTIONS_UNAVAILABLE_MESSAGE`, `INBOX_UNAVAILABLE_MESSAGE`, `mail-import.ts INBOX_UNAVAILABLE` | „… nach dem nächsten Start der App bereit (start.bat).“ | **Fachlich ungenau:** Läuft die App, öffnet `start.bat` nur den Browser, und die Migration läuft nicht. Richtig ist „stop.bat, dann start.bat“. |
| dasselbe | `IMPORT_KEYWORDS_UNAVAILABLE_MESSAGE`, `RECURRENCE_UNAVAILABLE`, `FileImportDialog` Z. 103 | „… (stop.bat, dann start.bat).“ | Zwei Wortlaute für denselben Sachverhalt, als `.hint`, `.notice` oder `.empty` dargestellt |
| Zugangsdaten fehlen | `secretStatusText` (Domain) | `.notice` in der Karte | Der Text ist gut, aber als Fließtext ohne Icon oder Titel |
| Keine Stichwörter | `NO_KEYWORDS_WARNING`, `KeywordEditor` `.notice` | Marke-Fläche | ist eine Warnung, sieht aber aus wie eine Info |
| Hilfsprozess läuft nicht | `MailboxPicker` `.notice role=status` | Marke-Fläche | passt, aber lokal gebaut |
| Leer: Aufgaben | `TicketTable` Z. 317–326 | „Keine offenen Tickets.“ + Primärknopf; „Keine Tickets für diese Filter.“ + Textknopf | das beste Beispiel, aber ohne Icon und Beschreibung |
| Leer: Eingang | `InboxTable` Z. 298–312 | „Der Eingang ist leer.“ + grauer Satz mit Link | Die Primäraktion fehlt („Erfassen“ oder „Kanal einrichten“). |
| Leer: Projekte | `ProjectsView` Z. 186 | „Noch keine Projekte.“ + Knopf | passt, uneinheitlich gestaltet |
| Leer: Tags, Kommentare, Verlauf, Posteingang | `TagManager`, `CommentList`, `HistoryList`, `MailboxPicker` | grauer Einzeiler | Für Panels reicht eine kompakte Variante. |
| Erststart | `login/+page.svelte` (Hinweis Admin-Konto), README | keine Führung in der App | Nach der ersten Anmeldung zeigt die App eine leere Tabelle ohne Wegweiser zu Kanälen oder Hilfe. |
| Tipps in Formularen | `CaptureForm`, `NewTicketForm`, `QuickCapture`, `CommentForm` | „Tipp: Strg+Enter …“ als `.hint` | kann bleiben, weil es Feldhilfe ist, keine Section Message |

## 2. Referenzen (nur Muster)

### 2.1 Task-Board des Nutzers, Einstellungsdialog (angesehen, nicht kopiert)

- **Einstieg:** Ein Symbolknopf mit Zahnrad in der Kopfzeile, gleichrangig mit den anderen Kopfzeilen-Knöpfen (Geisterstil, Tooltip).
- **Aufbau:** Ein Modal von etwa 580 px mit festem Kopf (Icon, Titel „Einstellungen“, ×) und scrollendem Inhalt.
- **„Erklärblock“:** Zwei Spalten mit je einem Icon in einer getönten Kachel, fettem Titel und zweizeiliger Beschreibung. Er erklärt die zwei Wege (automatisch/regelbasiert vs. manuell/selektiv). → Für uns: ein Kopfblock auf „Kanäle“ zu „Automatisch abrufen“ vs. „Selbst hereinziehen“.
- **Abschnittstitel:** Kleine Versalien mit Linie darunter.
- **Quellenzeilen:**
  - Icon, Name, eine Zeile „Regel“, dazu ein Badge „verfügbar“/„demnächst“
  - Die Stichwörter stehen direkt an der Quelle.
  - Nach dem Speichern erscheint kurz „✓ Gespeichert“ inline.
- **Nicht übernommen:** Modal statt Seite (bei uns zu viel Inhalt), Signalfarben (Grün, Rot), Versalien-Badges.

### 2.2 Jira und Atlassian Design System

| Muster | Kernaussage | Übernahme |
|---|---|---|
| **Einstellungen mit Seitennavigation** (Jira-Projekteinstellungen) | eigene Seiten mit linker Navigation (Details, Features, Access …), oben ein Rückweg zum Projekt; gleiche Anordnung in allen Produkten | Einstellungsbereich mit linker Navigation und „← Zurück zu …“ |
| **Section Message** | Anatomie: Icon und Fläche passend zum Typ, optionaler Titel, Beschreibung, optionale Aktionen als Links. Für Hinweise in einem Bereich, die bleiben, bis die Lage gelöst ist; für destruktive Folgen, nötige Handlungen und Verbindungs- oder Anmeldeprobleme. Abgrenzung: Banner (ganze Seite), Flag (nach einem Ereignis), Inline Message (klein, an einem Element). Nicht nur Farbe, immer ein Lösungsweg, sprechende Linktexte. | Baustein `SectionMessage` mit vier Tönen, Farben nach ADR-0009 |
| **Inline Message** | Icon plus kurzer Text (höchstens 5 Zeilen), optional Titel; Typen Warnung, Fehler, Bestätigung, Info | kompakte Variante `SectionMessage compact` (etwa „Keine Stichwörter“ an der Karte) |
| **Empty State** | Illustration (optional), Überschrift, Beschreibung (optional), Knöpfe; Breiten „wide“ 464 px und „narrow“ 304 px; mindestens eine Handlungsaufforderung, höchstens ein Primärknopf; Verben im Imperativ | Baustein `EmptyState` (wide, narrow, compact) |
| **Progress Tracker** | Fortschrittsbalken; Schritte aktuell, unbesucht, besucht (klickbar zurück), gesperrt; **3 bis 6 Schritte**, Beschriftung 1 bis 2 Wörter; unter 3 Schritten „Weiter“-Knöpfe statt Tracker | Baustein `Stepper`; Proton (3 kurze Schritte) als einfache Liste |
| **Spotlight/Onboarding** | Ziel hervorheben, Text höchstens zwei Zeilen, **3 bis 4 Schritte, besser einer**; auf jedem Schritt „Überspringen“; **nicht bei Neuanmeldung**; Puls-Animation kann stören | Tour nur manuell, höchstens etwa 5 Schritte, ohne Puls (§3.10, EH-13) |
| **Code Block** | vorformatierter Code, optional Zeilennummern und hervorgehobene Zeilen, Kontrast 4.5:1 | Baustein `CodeBlock` mit „Kopieren“ und hervorgehobenem Platzhalter; ohne Zeilennummern (Einzeiler) |
| **Lozenge** | nicht interaktiv, kurzer Text in Satzschreibung, höchstens 200 px, Farbe nie allein; „subtle“ und „bold“ | Baustein `Lozenge`, nur „subtle“, immer mit Icon |

Die Quellen stehen am Ende.

---

## 3. Ziel-Spezifikation

### 3.1 Routen und Informationsarchitektur

| Route | Inhalt | Bemerkung |
|---|---|---|
| `/einstellungen` | Weiterleitung auf `/einstellungen/kanaele` (`+page.ts` mit `redirect(307)`) | SPA, `ssr = false`: Die Weiterleitung läuft im Client. |
| `/einstellungen/kanaele` | Kanäle: Erklärblock, Karten der Verbindungen, Bookmarklet-Karte, Karte „Dateien hereinziehen“, Katalog „Kanal hinzufügen“ | **Adresse bleibt gleich** (README, Lesezeichen, Link im `FileImportDialog`) |
| `/einstellungen/kanaele?einrichten=<art>[&verbindung=<id>]` | öffnet den Einrichtungsassistenten (Modal L) über der Seite | Die Arten sind `kalender`, `telegram`, `webde`, `gmail`, `proton`. Neuladen und Mittelklick funktionieren; das Schließen entfernt den Parameter (`replaceState`). |
| `/einstellungen/datei-importe` | „Stichwörter für Datei-Importe“ (der heutige `ImportKeywordsSection`) plus Anleitung für `.eml`, `.ics`, WhatsApp und Proton | Der Link im `FileImportDialog` zeigt hierher. |
| `/einstellungen/darstellung` | Theme als Radiogruppe „Hell / Dunkel / Wie System“ mit Vorschaukacheln; später Dichte und Spalten-Voreinstellung | nutzt `ThemeStore` (UI-2), das Menü in der Kopfzeile bleibt |
| `/einstellungen/konto` | angemeldet als …, Unterschied Admin- und App-Konto, Link „Verwaltung (nur Admin)“ (`/_/`, `rel="external"`), „Abmelden“ | Nur lesen. „Passwort ändern“ ist ein späterer Kandidat (PocketBase erlaubt das mit `oldPassword`, braucht aber eigene Tests und Regeln). |
| `/einstellungen/hilfe` | Tastaturkürzel, Kurzsyntax, FAQ, Betrieb (Neustart, Logs) | Ziel von „Hilfe“ im „?“-Menü |

„Konto“ steht in der Einzahl, weil es nur das eigene App-Konto zeigt. Im Auftrag stand „Konten“; die Mehrzahl würde Verwaltungsfunktionen versprechen, die es nicht gibt.

### 3.2 Kopfzeile

Neue Reihenfolge rechts: `Schnellerfassung c` · `Neues Ticket` (Primär) · **`?` Hilfe** · **`⚙` Einstellungen** · `Darstellung` · Sitzung.

- **Einstellungen:**
  - Ein `<a class="button-icon header-settings" href="/einstellungen/kanaele" aria-label="Einstellungen">` mit eigenem Zahnrad-SVG in `currentColor` und `title="Einstellungen"`.
  - Unter `/einstellungen/*` trägt er `aria-current="page"` und die Fläche „Marke Fläche / Text darauf“. Das ist zusätzlich zur Farbe ein Merkmal durch die Fläche; der Screenreader liest `aria-current`.
- **Hilfe:**
  - Popover-Menü (Baustein UI-2, `kind="menu"`), Knopf `aria-label="Hilfe"`, eigenes „?“-Icon.
  - Einträge: „Tastaturkürzel“ (öffnet das Modal M, zeigt `?` als Kürzel), „Hilfe öffnen“ (Link auf `/einstellungen/hilfe`), „Kanäle einrichten“ (Link); ab EH-13 zusätzlich „Kurze Einführung“ (startet die Tour).
- **App-Name:** `<h1><a href="/">becauseyoulovejira</a></h1>`, ohne Unterstreichung, mit sichtbarem Fokus. Der Zähler bleibt außerhalb des Links.
- **Taste `?`:**
  - Öffnet das Modal „Tastaturkürzel“, geprüft über `event.key === '?'`; auf deutscher Tastatur ist das Umschalt+ß.
  - Nicht in Eingabefeldern, nicht bei offenem Dialog oder Popover (dieselbe Prüfung wie bei `c`).
  - Der Handler liegt im `(app)`-Layout neben der Schnellerfassung.
- **Schmal:** Die Kopfzeile bricht heute schon um. Die zwei neuen Knöpfe sind je 2rem breit und brauchen keine eigene Regel.

### 3.3 Aufbau des Einstellungsbereichs

```
┌ AppHeader ─────────────────────────────────────────────────────────────────┐
├────────────────────────────────────────────────────────────────────────────┤
│ [Aufgaben | Projekte | Eingang]   (Umschalter, kein Eintrag aktiv)         │
├──────────────────┬─────────────────────────────────────────────────────────┤
│ ← Zurück zu      │ Einstellungen › Kanäle          (Brotkrumenpfad)         │
│   Aufgaben       │ Kanäle                          (h2, Fokusziel)           │
│                  │ Einleitungssatz                                          │
│ EINSTELLUNGEN    │                                                          │
│ ▸ Kanäle         │ [Inhalt der Unterseite, volle Breite wie „Aufgaben“]     │
│   Datei-Importe  │                                                          │
│   Darstellung    │                                                          │
│   Konto          │                                                          │
│   Hilfe          │                                                          │
└──────────────────┴─────────────────────────────────────────────────────────┘
```

- **Datei:** `routes/(app)/einstellungen/+layout.svelte` mit der neuen Komponente `SettingsNav.svelte`.
- **Umschalter:**
  - `ViewSwitch` steht wie in den Ansichten direkt unter der Kopfzeile (ADR-0025 §10, ab UI-8 überall dort).
  - Neue Prop `current?: 'tasks' | 'projects' | 'inbox' | null`; bei `null` gibt es kein `aria-current`, alle Einträge sind gleichrangig.
  - Die Zahlen („neu“) kommen aus den Stores des `(app)`-Layouts per Kontext.
  - Seine Links führen **ohne** Filterzustand in die Ansicht (wie heute von außen).
- **„← Zurück zu ‹Ansicht›“:**
  - Er stellt die **letzte Ansicht mit Zustand** wieder her: Filter, Suche, Gruppierung, offenes Panel (`/tickets/<id>?…`).
  - Datei `lib/stores/last-view.svelte.ts`: `afterNavigate` im `(app)`-Layout merkt sich jede URL außerhalb von `/einstellungen` und außerhalb von `…/voll`.
  - Der Wert steht in `sessionStorage` (Schlüssel `byl-last-view`, übersteht Neuladen und den Neustart der App im selben Tab) und wird beim Lesen mit `safeRedirect` aus `guard.ts` geprüft. Das verhindert einen offenen Redirect über manipulierten Speicher; Rückfall ist `/`.
  - Die Beschriftung folgt der Route: „Zurück zu Aufgaben“, „… zu Projekte“, „… zum Eingang“, bei einem offenen Panel „… zu BYL-12“ bzw. „… zum Eintrag“.
  - Er ist das erste Element der Navigation, `<a>` mit Pfeil-Icon.
- **Unternavigation:**
  - `<nav aria-label="Einstellungen">` mit `<ul>` aus Links; der aktive trägt `aria-current="page"`, Schriftgewicht 600, Marke-Fläche und eine 3-px-Linie links.
  - **Keine Tabs:** Es sind eigene Adressen (wie der Umschalter nach ADR-0010 §5).
  - Abschnittstitel „Einstellungen“ als kleine, gedämpfte Überschrift (`h2` bleibt der Seite vorbehalten, hier `p` mit `aria-hidden`, denn die Navigation hat ihren Namen).
- **Brotkrumenpfad:** `<nav aria-label="Brotkrumenpfad"><ol>` mit „Einstellungen“ (Link auf `/einstellungen`) › „Kanäle“ (`aria-current="page"`, kein Link). Trenner als CSS-Pseudoelement, damit der Screenreader ihn nicht vorliest.
- **Überschrift:** `h2` je Unterseite mit `tabindex="-1"`. Nach einem Wechsel der Unterseite geht der Fokus darauf (wie `SectionBar` heute); der Seitentitel lautet „‹Unterseite› · Einstellungen · becauseyoulovejira“.
- **Breiten:**
  - Ab 64rem steht die Navigation links als Spalte (15rem, sticky, top 1rem).
  - Darunter wird sie eine umbrechende Zeile aus Links über dem Inhalt; der Zurück-Link steht davor.
  - **Volle Breite (Nutzervorgabe, 2026-09-26):** Der Einstellungsbereich nutzt dieselbe Seitenbreite und dieselben Ränder wie „Aufgaben“ (`main` mit `--content-padding`), er ist **nicht** nach links gedrückt und hat keine Höchstbreite. Die Inhaltsspalte füllt den Rest neben der Navigation; nur Fließtext bekommt eine lesbare Zeilenlänge (`max-width` in `ch` am Absatz), Karten und Raster nutzen die volle Breite.
- **Tokens:** `--color-surface`, `--color-line`, `--color-brand-soft-*`, `--radius-surface`, `--radius-control`. Keine neuen Farben.

### 3.4 Unterseite „Kanäle“

Die Reihenfolge ist so gewählt, dass sie sich wie eine Übersicht liest, nicht wie ein Handbuch:

1. **Erklärblock** (Muster aus dem Task-Board, eigene Texte). Zwei Spalten, darunter eine:
   - „**Automatisch abrufen**“: „Google Calendar, Telegram und Postfächer liefern neue Einträge von selbst, solange die App läuft. Es kommt nur, was ein Stichwort trifft.“
   - „**Selbst hereinbringen**“: „Web-Links per Bookmarklet, Mail- und Kalenderdateien oder WhatsApp-Exporte per Drag & Drop. Du wählst aus, was in den Eingang soll.“
2. **Abschnitt „Deine Verbindungen“** (`h3` mit Zahl): ein Raster aus `ChannelCard` (`repeat(auto-fill, minmax(18rem, 1fr))`), rechts oben „Aktualisieren“ (`.button-subtle`).
   - Ohne Verbindung: `EmptyState` (narrow) „Noch kein Kanal verbunden“, Beschreibung „Verbinde einen Kalender, einen Telegram-Bot oder ein Postfach. Die Einrichtung dauert etwa fünf Minuten.“ und den Primärknopf „Kanal hinzufügen“, der zum Katalog springt und ihn fokussiert.
   - Laden: Platzhalterkarten (drei graue Flächen, `aria-hidden`) plus `role="status"` „Verbindungen werden geladen …“.
   - Nicht verfügbar (Migration): `SectionMessage` Info „Nach dem nächsten Neustart verfügbar“ (§3.9).
   - Fehler: `SectionMessage` Fehler mit Aktion „Erneut versuchen“.
3. **Abschnitt „Selbst hereinbringen“:** zwei Karten nebeneinander:
   - `BookmarkletCard` (§3.6)
   - Karte „Dateien hereinziehen“: Icon, Kurztext, Meta-Zeile „Stichwörter: Mail 3 · Kalender 0 · WhatsApp 2“, Aktionen „Stichwörter bearbeiten“ (Link auf `/einstellungen/datei-importe`) und „Zum Eingang“
4. **Abschnitt „Kanal hinzufügen“:** Kacheln des Katalogs. Jede Kachel hat Icon, Name, einen Satz, die Lozenge „Nicht eingerichtet“ (nur wenn es noch keine Verbindung dieser Art gibt) und den Knopf „Einrichten“, der den Assistenten öffnet:
   - Google Calendar: „Termine mit Stichwort alle 15 Minuten“
   - Telegram-Bot: „Nachrichten an deinen Bot, jede Minute“
   - Web.de: „Mails mit Stichwort im Betreff, alle 5 Minuten“
   - Gmail: „Mails mit Stichwort im Betreff, alle 5 Minuten“
   - Proton Mail: „Kein automatischer Abruf im Free-Tarif: Mails als Datei exportieren“, Lozenge „Per Datei“, Knopf „Anleitung“
   - Mehrere Verbindungen einer Art sind erlaubt (zwei Kalender). Die Kachel bleibt deshalb auch nach der ersten Verbindung, dann ohne Lozenge und mit dem Knopf „Weitere einrichten“.
5. **„Zugangsdaten als Windows-Variable“:** Die allgemeine Erklärung zieht als `<details>` „Wie funktionieren die Zugangsdaten?“ unter den Erklärblock (zugeklappt) und in die Hilfe (FAQ). Die dienstbezogenen Anleitungen (Karten 5 bis 8 von heute) ziehen **vollständig** in den Assistenten.

Das Formular „Neue Verbindung“ entfällt als Dauerformular. Anlegen geschieht im Assistenten, Schritt „Verbinden“. Für Kenner gibt es im Assistenten „Alle Schritte anzeigen“ (§3.7), aber keinen zweiten Weg.

### 3.5 Kanal-Karte `ChannelCard.svelte`

```
┌────────────────────────────────────────────────────┐
│ [Icon]  Gmail privat                  [● Fehler]   │
│         Postfach · Gmail · anna@gmail.com          │
│                                                    │
│ Letzter Abruf  heute, 14:05                        │
│ Stichwörter    3  (todo, aufgabe, #byl)            │
│ ⚠ Anmeldung bei Gmail abgelehnt.                   │  ← SectionMessage compact, Ton nach Status
│   App-Passwort nötig (Bestätigung in zwei Schritten)│
│                                                    │
│ [Jetzt abrufen]  [Bearbeiten]              [ … ]   │
└────────────────────────────────────────────────────┘
```

- **Aufbau:**
  - `<article aria-labelledby>` mit `h4` (Bezeichnung) und Untertitel (Art, Anbieter, Benutzer)
  - `Lozenge` oben rechts
  - `dl` mit höchstens zwei Zeilen
  - höchstens **eine** kompakte `SectionMessage` (die wichtigste nach der Tabelle unten)
  - Fuß mit Aktionen
- **Status (reine Funktion `channelHealth(connection, secretStatus, running)` in `lib/domain/channel-health.ts`):**

| Reihenfolge | Bedingung | Lozenge | Icon | Tokens | Hinweis in der Karte | Hauptaktion |
|---|---|---|---|---|---|---|
| 1 | `store.isRunning(id)` | „Wird abgerufen“ | Kreispfeil (statisch, keine Drehung bei reduzierter Bewegung) | Marke-Umriss | – | (gesperrt) |
| 2 | `enabled === false` | „Pausiert“ | Pause | `--color-bg` / `--color-text-muted`, Linie `--color-line` | „Pausiert: Die App ruft nichts ab.“ (Info compact) | „Fortsetzen“ |
| 3 | `secretStatus.secret === false` oder `allowlist === false` | „Nicht eingerichtet“ | gestrichelter Kreis | Umriss `--color-line`, Text gedämpft | Text aus `secretStatusText` (Warnung compact) | „Einrichtung fortsetzen“ |
| 4 | `lastError !== ''` | „Fehler“ | `ErrorIcon` | `--color-danger` / `--color-danger-soft-bg` (echter Fehler nach ADR-0009) | „Letzter Fehler: …“ plus `lastHint` (Fehler compact) | „Jetzt abrufen“ bzw. „Einrichtung prüfen“ |
| 5 | sonst | „Eingerichtet“ | Häkchen | `--color-brand-soft-bg` / `--color-brand-soft-text` | `lastHint`, falls vorhanden (Info compact); ohne Stichwörter `NO_KEYWORDS_WARNING` (Warnung compact) | „Jetzt abrufen“ bzw. „Aus dem Postfach wählen“ |

- **Ohne Stichwörter** bleibt die Lozenge „Eingerichtet“, der Hinweis ist dann eine Warnung. Wo der Status der Variablen unbekannt ist (`null`, Abfrage gescheitert), entscheidet die Tabelle ohne Zeile 3.
- **Meta:**
  - „Letzter Abruf“ mit `formatBerlinDateTime`, sonst „noch nie“. „Zuletzt erfolgreich“ nur, wenn es vom letzten Abruf abweicht.
  - „Stichwörter“ mit Anzahl und den ersten drei Wörtern, Rest als „+2“.
- **Aktionen:**
  - Kalender und Telegram: „Jetzt abrufen“ (sekundär). Das Ergebnis kommt wie heute als Flag.
  - Postfächer: „Aus dem Postfach wählen“ (öffnet den vorhandenen `MailboxPicker`).
  - „Bearbeiten“ öffnet ein **Modal M** „‹Name› bearbeiten“ mit:
    - Stichwörtern (`KeywordEditor`)
    - den Schaltern „Auf Nachrichten ohne Stichwort antworten“ (Telegram) bzw. „Auch die ersten 500 Zeichen durchsuchen“ (Postfach)
    - der Anzeige der Variablennamen (nur lesen) mit Link „Einrichtung erneut ansehen“
  - Jede Änderung speichert sofort (wie heute); der Fuß heißt deshalb „Schließen“ (ADR-0025 §3).
  - Menü „…“ (Popover `menu`, `aria-label="Weitere Aktionen für ‹Name›"`):
    - „Pausieren“ bzw. „Fortsetzen“ (`setEnabled`, Flag „‹Name› pausiert.“)
    - „Einrichtung ansehen“
    - Trennlinie, dann „Löschen …“ (öffnet die vorhandene `ConfirmDialog`, **nicht** aus dem Modal heraus)
- **Pausieren statt Checkbox:**
  - Die Checkbox „Eingeschaltet“ entfällt. Der Zustand ist über die Lozenge sichtbar und über das Menü änderbar.
  - Für Postfächer nennt der Hinweis in der Karte: „Der Hilfsprozess ruft pausierte Postfächer nicht ab.“
- **Wiederholte Hinweise** (Neustart je Postfachkarte) entfallen. Sie stehen einmal im Assistenten und in der Hilfe.

### 3.6 Bookmarklet-Karte `BookmarkletCard.svelte`

- **Kopf:** Icon (Lesezeichen mit Pfeil), Titel „Web-Links per Bookmarklet“, Satz „Bringt die offene Webseite mit einem Klick in den Eingang.“
- **Illustration:** eigene Inline-SVG, etwa 280 × 96 px.
  - Sie zeigt eine stilisierte Browserleiste mit Lesezeichenleiste und darunter den Knopf. Ein Duplikat des Knopfs gleitet in einer Bogenbewegung auf die Leiste und rastet ein.
  - CSS-Keyframes mit `--motion-ease`, 1.8 s, **zweimal** beim ersten Sichtbarwerden (`IntersectionObserver`), danach auf Hover bzw. Fokus des Knopfs einmal.
  - `aria-hidden="true"`. Bei `prefers-reduced-motion: reduce` gibt es statt der Bewegung einen statischen gestrichelten Pfeil (`data-overlay`-Regel greift hier nicht, eigene Media Query).
- **Ziehbarer Knopf:**
  - `<a href={code} draggable="true" class="bookmarklet">`, Pillenform in Marke-Fläche mit Griff-Icon (⋮⋮), Text „In den Eingang“ (der spätere Lesezeichenname), `cursor: grab`
  - `aria-describedby` auf den Satz „Ziehe diesen Knopf auf deine Lesezeichenleiste (Strg+Umschalt+B blendet sie ein).“
  - Ein Klick bleibt wirkungslos und zeigt die kompakte Info „Ziehen statt klicken: Der Knopf gehört auf die Lesezeichenleiste.“
  - `dragstart`/`dragend` blenden eine Linie über der Illustration ein („Loslassen auf der Lesezeichenleiste“).
- **Schritte:** drei kurze nummerierte Punkte (Leiste einblenden, Knopf ziehen, auf einer Webseite anklicken), ohne Stepper; laut ADS lohnt der Tracker erst ab 3 Schritten mit eigenen Ansichten.
- **Ohne Maus:** `<details>` „Ohne Maus einrichten“ mit einem `CodeBlock` (Code, zweizeilig umbrochen, „Kopieren“) und den Schritten „Neues Lesezeichen anlegen (Strg+D, dann ‚Bearbeiten‘), Code als Adresse einfügen“. Die `textarea` entfällt.
- **Grenzen:** kompakte Info „Nur http- und https-Seiten. Dieselbe Seite ein zweites Mal meldet, dass sie schon im Eingang ist.“

### 3.7 Einrichtungsassistent `ChannelSetup.svelte`

**Rahmen:**

- **Modal L** (800 px, ADR-0025 §3) mit dem Titel „‹Dienst› einrichten“.
- Kopf: Titel, ×. Unter dem Kopf steht der `Stepper` fest, nur der Schrittinhalt scrollt.
- Fuß: links „Zurück“ (`.button-secondary`, ab Schritt 2), rechts „Weiter“ (Primär) bzw. im letzten Schritt „Fertig“. Dazu links außen ein Textknopf „Später fortsetzen“, der wie × schließt.
- **Adresse:** `?einrichten=<art>&verbindung=<id>`. Die ID kommt dazu, sobald die Verbindung angelegt ist. So öffnen Neuladen und die Karte („Einrichtung fortsetzen“) genau diese Verbindung.
- **Schließen:** ×, Esc, Blanket und „Später fortsetzen“ schließen jederzeit. Es gibt kein `dirty`, denn gespeichert wird nur beim Anlegen und bei Stichwörtern, sofort. Ein eingetippter Geheimwert wird beim Schließen **absichtlich** verworfen.
- **Fortschritt aus Fakten, nicht aus Speicher:**
  - Beim Öffnen berechnet eine reine Funktion `setupProgress(kind, facts)` in `lib/domain/channel-setup.ts` den ersten nicht erfüllten Schritt aus:
    - `connection` (existiert?)
    - `secretStatus`
    - `keywords.length`
    - `lastRunAt`, `lastOkAt`, `lastError` und `lastHint`
  - So geht es nach `stop.bat`/`start.bat` an der richtigen Stelle weiter, auch in einem neuen Tab.
  - Welchen Schritt der Nutzer zuletzt **angesehen** hat, merkt sich zusätzlich `sessionStorage` (`byl-setup:<id>`, nur die Schrittnummer, nie ein Wert).
- **Schritt-Anatomie:**
  - `h3` „Schritt 2 von 6: Variable setzen“ als Fokusziel mit `tabindex="-1"`; der Fokus geht beim Wechsel darauf.
  - Kurztext mit höchstens 2 Sätzen.
  - Aktion bzw. Code-Block.
  - Prüfzeile (§3.8).
  - `<details>` „Mehr dazu“ für Sonderfälle: Zwei-Faktor-Anmeldung, Gruppen, Widerrufen, Grenzen.
  - `ExternalLink` für Seiten der Anbieter.
- **„Weiter“ ist nie gesperrt:**
  - Prüfungen sind Hilfen, keine Schranken, denn der Assistent kann nicht alles sehen (§3.8).
  - Ist die Prüfung eines Schritts rot bzw. offen, fragt „Weiter“ nicht nach, zeigt aber im nächsten Schritt oben die kompakte Warnung „Schritt 3 ist noch offen: …“ mit dem Link „Zu Schritt 3“.
- **Stepper-Zustände** (ADS Progress Tracker):
  - erledigt: Häkchen, Link zum Schritt
  - aktuell: Marke, fett, `aria-current="step"`
  - offen: gedämpft, klickbar, weil kein Schritt gesperrt ist
  - Warnung (erledigt, Prüfung aber offen): Ausrufezeichen, Text „Prüfung offen“

**Tabs innerhalb eines Schritts** (APG Tabs, manuelle Aktivierung):

- Nur im Schritt „Variable setzen“: „Eingabeaufforderung“ | „Systemsteuerung“.
- Die Wahl wird in `localStorage` `byl-setx-way` gemerkt; das ist kein Geheimnis.

**Schritte je Dienst** (Beschriftung 1 bis 2 Wörter nach ADS):

| Dienst | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| **Google Calendar** | **Verbinden:** Bezeichnung, Variablenname vorbelegt `BYL_GOOGLE_CALENDAR_URL`, „Verbindung anlegen“ | **Adresse holen:** `ExternalLink` calendar.google.com; ⋮ → Einstellungen und Freigabe → Kalender integrieren → Privatadresse im iCal-Format kopieren; Details: Aussehen der Adresse, Warnung „Wer sie kennt, liest den ganzen Kalender“ | **Variable setzen:** `CodeBlock` `setx BYL_GOOGLE_CALENDAR_URL "‹iCal-Adresse›"` | **Neu starten:** `CodeBlock` mit Pfad `app\stop.bat` und `app\start.bat` (nur zum Lesen, Kopieren optional), Prüfung „Variable sichtbar“ | **Stichwörter:** `KeywordEditor` mit „Vorschläge übernehmen“, Prüfung „mindestens 1“ | **Erster Abruf:** „Jetzt abrufen“ im Schritt, Ergebnis mit Zahlen aus `RunResult`, Prüfung „Abruf erfolgreich“ |
| **Telegram** | **Bot anlegen:** `ExternalLink` t.me/BotFather; `/newbot` als `CodeBlock`; Details: Name endet auf „bot“ | **Token setzen:** `setx BYL_TELEGRAM_TOKEN "‹Bot-Token›"` und vorläufig `setx BYL_TELEGRAM_ALLOWED_IDS "0"` (zwei Code-Blöcke) | **Verbinden:** Bezeichnung, beide Variablennamen vorbelegt, anlegen | **Neu starten:** Prüfung „Token sichtbar“ und „IDs sichtbar“ | **Chat freigeben:** „Schreibe deinem Bot eine Nachricht, dann ‚Jetzt abrufen‘.“ Die App liest die Chat-ID aus `lastHint` („… (Chat-ID 424242)“), zeigt sie und erzeugt `setx BYL_TELEGRAM_ALLOWED_IDS "424242"` (keine Geheimnisse, Feld offen, mehrere per Komma). Danach neu starten; Prüfung „kein fremder Chat mehr gemeldet“. Details: Gruppen (`-100…`, `/setprivacy`) | **Stichwörter und Test:** `KeywordEditor`, „Schicke ‚todo Test‘ an den Bot, dann ‚Jetzt abrufen‘“; Prüfung „1 Eintrag angelegt“ bzw. `lastOkAt` |
| **Web.de** | **Abruf erlauben:** `ExternalLink` web.de (Anmeldung); Initialen → E-Mail-Einstellungen → POP3/IMAP → Schalter ein | **Passwort:** Mit Zwei-Faktor gilt ein anwendungsspezifisches Passwort (Details: Weg dorthin), sonst das normale Passwort | **Variable setzen:** `setx BYL_WEBDE_PASSWORD "‹Passwort›"` | **Verbinden:** Anbieter Web.de (fest), E-Mail-Adresse, Variable vorbelegt, anlegen; Stichwörter im selben Schritt | **Neu starten:** startet auch `byl-mail.exe`; Prüfung „Variable sichtbar“; Details: SmartScreen-Nachfrage, Log `app\logs\byl-mail.log` | **Erster Abruf:** „Spätestens in 5 Minuten“; Prüfung „Letzter Abruf gesetzt“ und Hinweis „Erster Abruf“ (live, s. u.); Details: „Aus dem Postfach wählen“ für ältere Mails, Abschaltung durch Web.de |
| **Gmail** | **Zwei Schritte:** `ExternalLink` myaccount.google.com/security, Bestätigung in zwei Schritten einschalten | **App-Passwort:** `ExternalLink` myaccount.google.com/apppasswords; Name „becauseyoulovejira“; wird nur einmal angezeigt | **Variable setzen:** `setx BYL_GMAIL_PASSWORD "‹App-Passwort›"`. Das Eingabefeld entfernt Leerzeichen zwischen den Vierergruppen automatisch und sagt das. | **Verbinden:** Anbieter Gmail, Adresse, Stichwörter | **Neu starten** wie Web.de | **Erster Abruf** wie Web.de; Details: „Anmeldung abgelehnt“, kein App-Passwort bei „Erweitertem Schutz“ → Weg über `.eml` |
| **Proton Mail** | kein Stepper (3 Schritte ohne eigene Ansicht, ADS): Modal M „Proton-Mails übernehmen“ mit nummerierter Liste | `ExternalLink` mail.proton.me; Mail öffnen → „Mehr“ (⋮) → „Exportieren“ | `.eml` in den Eingang ziehen; Primärknopf „Zum Eingang“, Link „Stichwörter für Mail-Dateien“ | – | – | – |

**„Alle Schritte anzeigen“** (Textknopf im Kopf des Inhalts):

- Er schaltet auf eine lesbare Gesamtansicht aller Schritte untereinander um (`aria-pressed`), ohne Prüfungen.
- Das ist für Nutzer, die die Anleitung lesen oder drucken wollen, und ersetzt die heutigen Anleitungskarten 1:1.

### 3.8 Live-Prüfung: was geht, was nicht

| Prüfung | Quelle (vorhanden) | Zeitpunkt | Anzeige |
|---|---|---|---|
| Verbindung angelegt | `ConnectionsStore.create` bzw. `connections` | sofort | ✓ „Verbindung ‚‹Name›‘ angelegt.“ |
| Variable sichtbar (Geheimnis) | `GET /api/byl/connections/{id}/secret-status` → `secret` (nur ja/nein, ADR-0018 §4) | beim Öffnen des Schritts und über „Erneut prüfen“ | ✓ „Die App sieht `BYL_…`.“ / ○ „Die App sieht `BYL_…` noch nicht.“ |
| IDs sichtbar (Telegram) | dieselbe Route → `allowlist` | wie oben | wie oben |
| **Neustart nötig** | **abgeleitet:** Die Variable ist nicht sichtbar, obwohl der Nutzer den Schritt „Variable setzen“ hinter sich hat | beim Schritt „Neu starten“ | Warnung compact: „Hast du `setx` schon ausgeführt? Dann starte die App neu: `stop.bat`, dann `start.bat`. Danach ‚Erneut prüfen‘.“ |
| Stichwörter vorhanden | `connection.keywords.length` | sofort | ✓ bzw. Warnung `NO_KEYWORDS_WARNING` |
| Erster Abruf (Kalender, Telegram) | `POST …/run` → `RunResult` (`ok`, `created`, `unmatched`, `missing`, `error`) | auf „Jetzt abrufen“ im Schritt | ✓ „3 übernommen, 2 ohne Stichwort.“ / Fehlertext bereinigt / `missing` → zurück zu „Neu starten“ |
| Erster Abruf (Postfach) | `lastRunAt`, `lastHint` („Erster Abruf“), `lastError` am Datensatz | **Realtime-Abo auf genau diese Verbindung**, solange der Schritt offen ist (`pb.collection('connections').subscribe(id)`; kein Polling, CLAUDE.md §7), dazu „Erneut prüfen“ | ○ „Warte auf den ersten Abruf (spätestens 5 Minuten) …“ → ✓ |
| Hilfsprozess läuft (Postfach) | `GET …/mailbox?limit=1`: `unavailable` (503) heißt, dass `byl-mail.exe` nicht läuft | **nur** auf „Hilfsprozess prüfen“, weil die Abfrage eine IMAP-Anmeldung auslöst | ✓ / Info „Der Mail-Hilfsprozess läuft nicht. Nach `start.bat` startet er, sobald eine eingeschaltete Postfach-Verbindung besteht.“ |
| Fremder Chat (Telegram) | `lastHint` mit „Chat-ID …“ | nach „Jetzt abrufen“ | Info mit erkannter ID und fertigem Befehl |

**Nicht möglich** (ehrlich benennen, keine Scheinsicherheit):

- Ob `setx` ausgeführt wurde. Der Server sieht Benutzervariablen erst nach dem Neustart über `start.bat`; vorher sind „nicht gesetzt“ und „nicht neu gestartet“ nicht unterscheidbar.
- Ob der Wert richtig ist, bevor der erste Abruf läuft.
- Ob der IMAP-Schalter bei Web.de an ist. Das zeigt erst der Abruf („Anmeldung abgelehnt“ + Hinweis).
- Eine spätere Servererweiterung (etwa „Variable in `HKCU\Environment` vorhanden, aber nicht im Prozess“) wäre möglich, aber nicht Teil dieses Plans. Sie bräuchte eine ADR-0018-Ergänzung, weil sie die Registry liest.

Der Prüfstatus steht in einer Zeile unter dem Schrittinhalt:

- Icon ✓, ○ (offen), ⚠ oder Fehler-Icon, plus Text
- Der Status ist ein `role="status"`, damit Screenreader das Ergebnis hören, ohne dass der Fokus springt.
- „Erneut prüfen“ ist ein `.button-subtle`.

### 3.9 Bausteine für Hinweise und Anleitungen

Ort: `web/src/lib/components/guidance/`, reine Logik in `web/src/lib/guidance/`. Das sind keine Overlays, deshalb nicht unter `overlay/`; die Regel „genau sechs Overlay-Bausteine“ aus ADR-0025 bleibt unberührt.

#### `SectionMessage.svelte`

- **Props:**
  - `tone: 'info' | 'success' | 'warning' | 'error'`
  - `title?: string`
  - `compact?: boolean`
  - `live?: boolean` (für dynamisch erscheinende Meldungen)
  - `headingLevel?: 3 | 4` (nur mit Titel)
  - Snippets `children` und `actions`
- **Aufbau:** Icon links, rechts optional der Titel (fett), der Text und die Aktionen als Links bzw. `.button-subtle` in einer Zeile. `compact` ist ohne Fläche und Titel, Icon 14 px, Text 0.8125rem (entspricht der ADS-„Inline Message“).
- **Töne** (ADR-0009, keine neuen Farben):

| Ton | Icon (eigen) | Fläche | Linie links 3 px | Text | Rolle, wenn `live` |
|---|---|---|---|---|---|
| info | „i“ im Kreis | `--color-brand-soft-bg` | `--color-brand` | `--color-brand-soft-text` | `status` |
| success | Häkchen im Kreis | `--color-brand-soft-bg` | `--color-brand` | `--color-brand-soft-text`, Titel Pflicht („Eingerichtet“) | `status` |
| warning | Dreieck mit „!“ | `--color-surface` | `--color-text-muted` | `--color-text`, Titel fett | `status` |
| error | `ErrorIcon` | `--color-danger-soft-bg` | `--color-danger` | `--color-danger` | `alert` |

- **Warnung ohne Gelb:** ADR-0010 §3 verbietet Gelb als Warnsignal. Die Warnung unterscheidet sich deshalb durch Icon, fetten Titel und neutrale Linie. Das ist ausdrücklich so gewollt: Farbe ist nie das einzige Merkmal.
- **Icon:** hat `aria-hidden`; der Ton steht zusätzlich als versteckter Präfix im Text („Hinweis:“, „Erledigt:“, „Achtung:“, „Fehler:“).
- **Ohne `live`:** keine Rolle; statische Hinweise werden nicht angesagt.
- **Verhältnis zu `.alert-error`:** Die Klasse bleibt für Feld- und Formularfehler, die schon so gebaut sind. Neue Fehler im Inhalt nutzen `SectionMessage tone="error"`. Beide sehen gleich aus, weil sie dieselben Tokens nutzen.

#### `EmptyState.svelte`

- **Props:**
  - `title` (Pflicht)
  - `description?`
  - `size: 'wide' | 'narrow' | 'compact'` (29rem / 19rem nach ADS 464 bzw. 304 px / linksbündig ohne Icon für Panels)
  - `icon?: EmptyIcon` (eigener kleiner Satz: `tickets`, `inbox`, `projects`, `channels`, `search`, `tags`, `comments`)
  - `headingLevel: 2 | 3 | 4`
  - Snippets `primary` und `secondary`
- **Aufbau:** Icon 48 px in `--color-text-muted`, einfarbige Linien-SVG in `currentColor`, keine Illustration mit Flächen. Darunter Überschrift, Beschreibung und Knöpfe, zentriert. Genau **ein** Primärknopf.
- **Regeln:** Überschrift in Satzschreibung ohne Punkt; Beschreibung ein Satz; Aktion als Verb („Ticket anlegen“, „Filter zurücksetzen“, „Kanal einrichten“).

#### `Lozenge.svelte`

- **Props:** `tone: 'neutral' | 'brand' | 'danger' | 'muted'`, `label`, `icon`.
- Nicht interaktiv, höchstens 12.5rem breit, Satzschreibung, Icon Pflicht (Farbe nie allein).
- Tokens: `neutral` → `--color-line`/`--color-text-muted` (Umriss), `brand` → Marke-Fläche, `danger` → Fehlertokens, `muted` → `--color-bg`.
- `StatusPill` bleibt eigenständig (Ticketstatus mit eigenen Tokens).

#### `CodeBlock.svelte` und `lib/guidance/command.ts`

- **Reine Funktionen:**
  - `parseTemplate('setx BYL_X "{{wert}}"')` → Segmente (Text oder Platzhalter)
  - `renderCommand(segments, values)` → `{ display, copy }`; `display` maskiert geheime Werte als `••••••••`, `copy` enthält den echten Wert.
  - `setxValueError(value)` →
    - `"` → „Anführungszeichen gehen mit setx nicht; nutze die Systemsteuerung.“
    - Zeilenumbruch → Fehler
    - mehr als 1024 Zeichen → Fehler (setx kürzt sonst still)
    - `%NAME%`-Muster → Warnung („cmd könnte den Teil als Variable lesen“)
  - `normalizeValue(kind, value)` → Gmail: Leerzeichen entfernen; sonst `trim`.
- **Anzeige:**
  - `<figure>` mit `<figcaption>` (Beschriftung, z. B. „Befehl für die Eingabeaufforderung“)
  - `<pre><code>` in `--font-mono` auf `--color-bg`, Linie `--color-line`, Radius `--radius-control`, horizontal scrollbar (`tabindex="0"`, `role="region"`, `aria-label` = Beschriftung)
  - Platzhalter als `<span class="placeholder">‹iCal-Adresse›</span>`: gestrichelter Rahmen `--color-brand`, Text `--color-brand-soft-text`, in spitzen Klammern ‹ › (typografisch, damit niemand sie für Syntax hält). Für Screenreader ist es ein versteckter Zusatz „Platzhalter:“.
- **Kopieren:**
  - `.button-subtle` „Kopieren“ oben rechts; `aria-label="‹Beschriftung› kopieren"`.
  - Nach Erfolg zeigt der Knopf 2 s lang „Kopiert“ mit Häkchen, dazu ein `role="status"`.
  - Scheitert `navigator.clipboard.writeText`, wird der Code markiert (`Selection`), und die compact-Info sagt „Mit Strg+C kopieren“.
  - Kein Flag, damit keine Dopplung entsteht.
- **Wert einsetzen (optional):**
  - Unter dem Block steht `<details>` „Wert hier einsetzen (bleibt in diesem Browserfenster)“.
  - Darin ein Feld, für Geheimnisse `type="password"` mit Knopf „Anzeigen“ (`aria-pressed`), dazu `autocomplete="off"`, `spellcheck="false"`, `autocapitalize="off"`, `data-1p-ignore`/`data-lpignore="true"` gegen Passwortmanager und `name` ohne Bedeutung.
  - Der Wert lebt nur in einer lokalen `$state` der Komponente: kein Store, kein `bind` nach außen, kein `sessionStorage`, kein Request. Er wird beim Schließen des Schritts oder Modals und nach dem Kopieren geleert (`value = ''`).
  - Die Vorschau zeigt den Befehl mit maskiertem Wert. „Kopieren“ kopiert dann den fertigen Befehl.
  - Hinweis (compact, Warnung) direkt am Feld: „Windows merkt sich Kopiertes im Zwischenablage-Verlauf (Win+V), falls er eingeschaltet ist. Dort kannst du den Eintrag danach löschen.“
  - Nicht geheime Werte (Telegram-IDs) haben ein normales Textfeld, offen.
- **Geheim-Kennzeichen:** Welche Platzhalter geheim sind, steht in den Schrittdaten (`secret: true` für Kalenderadresse, Token, Passwörter).

#### `ExternalLink.svelte`

- `<a href target="_blank" rel="noopener noreferrer">` mit Text plus Icon „nach außen“ (`aria-hidden`) und versteckt „(öffnet in neuem Tab)“.
- Der sichtbare Text nennt die Domain, wo es hilft („myaccount.google.com/apppasswords“).
- Nur `https:`; ein Test prüft die Schrittdaten.

#### `Stepper.svelte`

Siehe §3.11 (Barrierefreiheit). Props: `steps: { id, label, state }[]`, `current`, `onselect(id)`.

#### Umzug der vorhandenen Texte

| Heute | Ziel |
|---|---|
| alle `*_UNAVAILABLE*`-Texte (5 Stellen) | **ein** Text `RESTART_NEEDED` in `lib/guidance/texts.ts`: Titel „Nach dem nächsten Neustart verfügbar“, Text „Die App hat ein Update bekommen, das erst nach einem Neustart wirkt: `stop.bat`, dann `start.bat` im Ordner `app`.“, Parameter für den Bereich („Der Eingang“, „Die Verbindungen“ …); `SectionMessage` info. Behebt den falschen Hinweis „(start.bat)“. |
| `secretStatusText` (fehlt) | `SectionMessage` warning compact in der Karte, Aktion „Einrichtung fortsetzen“ |
| `NO_KEYWORDS_WARNING`, `KeywordEditor .notice` | `SectionMessage` warning compact |
| `lastHint` | info compact; `lastError` error compact |
| `MailboxPicker` Hilfsprozess, Hinweise | `SectionMessage` info (`live`) |
| `FileImportDialog` Stichwörter fehlen | `SectionMessage` info mit Aktion-Link „Stichwörter festlegen“ → `/einstellungen/datei-importe` |
| `DISCARDED_CONTENT_NOTE` (InboxPanel) | `SectionMessage` info compact |
| `RecurrenceSummary` `lastHint`, nicht verfügbar | info compact bzw. `RESTART_NEEDED` |
| Leer: Aufgaben, Filter | `EmptyState` wide „Keine offenen Tickets“ + „Ticket anlegen“ (Primär) + Sekundär „Schnellerfassung (c)“; „Keine Treffer“ mit Icon `search` + „Filter zurücksetzen“ |
| Leer: Eingang | `EmptyState` wide „Der Eingang ist leer“, Beschreibung „Hier landet, was du erfasst oder was deine Kanäle abrufen.“, Primär „Erfassen“, Sekundär „Kanal einrichten“ (Link) |
| Leer: verworfen, umgewandelt, Filter im Eingang | `EmptyState` narrow ohne Primärknopf bzw. „Filter zurücksetzen“ |
| Leer: Projekte, alle archiviert | `EmptyState` wide „Noch keine Projekte“ + „Projekt anlegen“; „Alle Projekte sind archiviert“ + Sekundär „Archivierte anzeigen“ |
| Leer: Tags, Kommentare, Verlauf, Posteingang | `EmptyState compact` |
| Tipps in Formularen („Strg+Enter …“) | bleiben als Feldhilfe `.hint`; einheitlich mit `<kbd>` |

Ein statischer Test `no-own-notices.test.ts` verbietet nach dem Umzug in Komponenten lokale Klassen `.notice` und `.empty` sowie Texte mit „nach dem nächsten Start“ außerhalb von `lib/guidance/texts.ts`.

### 3.10 Hilfe und Einführungstour

**Hilfe** (`/einstellungen/hilfe`):

- **Aufbau:** Abschnitte mit Sprunglinks oben: „Tastaturkürzel“, „Kurzsyntax“, „Kanäle und Zugangsdaten“, „Häufige Fragen“, „Betrieb“.
- **Tastaturkürzel:**
  - Eine Tabelle (`caption`, `th scope`), gruppiert nach „Überall“, „Liste“, „Panel“, „Dialoge“, mit `<kbd>`.
  - **Eine Quelle** `lib/domain/shortcuts.ts` (Taste, Kontext, Wirkung) für Hilfe-Seite und Modal. `aria-keyshortcuts` in der Kopfzeile nutzt dieselben Konstanten.
  - Ein Unit-Test gleicht die Liste mit `isQuickCaptureKey` bzw. dem Handler für `?` ab.
- **Kurzsyntax:** Beispiele als `CodeBlock` ohne Kopieren (`Zahnarzt anrufen @HAUS !hoch #anruf`) mit Tabelle der Tokens aus `quick-syntax.ts`; der Hinweistext in `QuickCapture` verlinkt „Mehr zur Kurzsyntax“.
- **Häufige Fragen:** `<details>` je Frage, etwa:
  - „Warum kommt meine Mail nicht an?“ → Stichwort im Betreff, nach der Einrichtung, Hilfsprozess
  - „Wo sind meine Zugangsdaten gespeichert?“
  - „Was bedeutet ‚Nach dem nächsten Neustart verfügbar‘?“
  - „Wie widerrufe ich einen Zugang?“ (je Dienst)
  - „Warum sehe ich im Admin-Bereich andere Konten?“
- **Modal „Tastaturkürzel“ (M):** öffnet per `?` oder über das Hilfe-Menü, zeigt die Tabelle „Überall“ und „Liste“ und im Fuß den Link „Ganze Hilfe“.

**„Erste Schritte“ und geführte Tour (Nutzerentscheidung 3, 2026-09-26):**

- **„Erste Schritte“ (EH-12):** eine Liste im `EmptyState` der Aufgabenansicht.
  - Sie erscheint nur, solange es **keine Tickets und keine Verbindung** gibt; sie wird aus Daten abgeleitet, nicht gespeichert.
  - Punkte mit Häkchen, wenn erledigt: „Erstes Ticket anlegen (c)“, „Einen Kanal verbinden“, „Tastaturkürzel ansehen (?)“ und „Kurze Einführung starten“.
  - Sie verschwindet von selbst.
- **Geführte Tour (optional, EH-13) mit driver.js:**
  - Bibliothek [driver.js](https://github.com/kamranahmedse/driver.js) (MIT, ohne Abhängigkeiten, Stand 1.8.0), **lokal gebündelt** über npm und Vite, **kein CDN**. intro.js ist ausgeschlossen (AGPL-3.0 und Einbindung per CDN in den üblichen Anleitungen).
  - Gestaltung mit unseren Tokens in hell und dunkel (Fläche, Linie, Text, Marke, Radius, Motion-Tokens), kein Schatten, Schleier `--color-blanket`; die Standard-CSS der Bibliothek wird durch eigene Regeln überschrieben, Farben nur aus `tokens.css`.
  - **Start nur manuell:** über „Kurze Einführung“ im „?“-Menü (EH-9) und aus „Erste Schritte“ (EH-12); nie automatisch, auch nicht beim ersten Login.
  - **Höchstens etwa 5 Schritte** (etwa: Schnellerfassung, „Neues Ticket“, Umschalter „Aufgaben | Projekte | Eingang“, Filterleiste, Einstellungen); jeder Schritt mit „Überspringen“ bzw. Schließen, Esc beendet die Tour, der Fokus kehrt zum Auslöser zurück.
  - Deutsche Texte, eigene Beschriftungen der Knöpfe („Weiter“, „Zurück“, „Fertig“), bei `prefers-reduced-motion: reduce` ohne Animation.
  - Die Tour ist eine **begründete Ausnahme** von ADR-0025 §1 (sechs Overlay-Bausteine, keine UI-Bibliothek); Einzelheiten und Grenzen in [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md) §8.
- **Warum nicht mehr „nicht empfohlen“:** Die Bedenken der Spezifikation (ADS rät von Touren bei Neuanmeldung ab, Pflege bei Layoutänderungen) bleiben gültig und begrenzen die Tour: nur manuell, wenige Schritte, Ziele über stabile `data-tour`-Attribute statt CSS-Klassen, ein Test prüft, dass jedes Ziel existiert.

### 3.11 Barrierefreiheit

- **Einstellungsnavigation:** `nav` mit Namen, Links, `aria-current="page"`; keine Tabs. Brotkrumenpfad als `nav` + `ol`, letzter Eintrag `aria-current="page"`.
- **Stepper** (kein eigenes APG-Muster; üblich ist eine geordnete Liste):
  - `<nav aria-label="Schritte der Einrichtung"><ol>`
  - Jeder Eintrag ist ein `<button type="button">` mit sichtbarer Nummer und Beschriftung und einem versteckten Zustand, z. B. „Schritt 2 von 6: Variable setzen, erledigt“.
  - Der aktuelle Eintrag trägt `aria-current="step"`.
  - Der Fortschrittsbalken ist `aria-hidden`; der Text „Schritt 2 von 6“ steht sichtbar im `h3`.
  - Tab-Reihenfolge: Stepper, dann Inhalt, dann Fuß. Keine Roving-Tabindex-Logik, weil es wenige Einträge sind (höchstens 6).
  - Nach einem Wechsel geht der Fokus auf das `h3` des Schritts.
  - Unter 40rem wird der Stepper zu „Schritt 2 von 6 · Variable setzen“ plus Menüknopf „Alle Schritte“ (Popover `menu` mit `menuitemradio`).
- **Tabs** („Eingabeaufforderung | Systemsteuerung“), nach APG Tabs:
  - `role="tablist"` mit `aria-label`, `role="tab"` mit `aria-selected` und `aria-controls`, `role="tabpanel"` mit `aria-labelledby` und `tabindex="0"`
  - Pfeil links/rechts, Pos1/Ende, **manuelle Aktivierung** (Enter/Leertaste), Roving `tabindex`
  - Wie im vorhandenen Reiter „Kommentare | Verlauf“; den Code als Helfer `lib/guidance/tabs.ts` teilen, wenn er dort schon steckt.
- **Karten:**
  - `article` mit Namen; Aktionen mit eindeutigen Namen („Jetzt abrufen: Gmail privat“ per `aria-label` bzw. versteckten Zusatz)
  - Die Lozenge ist Text und wird mitgelesen. „Wird abgerufen“ ist `aria-busy` am Knopf.
- **Ziehbarer Knopf:** Der Weg ohne Maus ist gleichwertig (`details` mit Code). `aria-describedby` erklärt das Ziehen. Die Animation respektiert reduzierte Bewegung.
- **Code-Block:** Er ist per Tastatur scrollbar (`tabindex="0"`, Region mit Namen). „Kopieren“ meldet sich über `role="status"`. Platzhalter werden für Screenreader angekündigt.
- **Meldungen:** Statische `SectionMessage` ohne Rolle; dynamische mit `live`. Der Fokus springt nie wegen einer Meldung.
- **Kontrast:** Alle Kombinationen nutzen vorhandene, geprüfte Tokenpaare. Der Platzhalterrahmen ist `--color-brand` auf `--color-bg` (Nicht-Text-Kontrast ≥ 3:1, laut `tokens.test.ts` schon abgedeckt, sonst Testfall ergänzen).

### 3.12 Tokens und Gestaltung

- **Keine neuen Farbtokens.** Alle Töne kommen aus vorhandenen Paaren (§3.9, §3.5).
- **Keine neuen Maß-Tokens:**
  - Die Breite der Einstellungsnavigation (15rem) ist ein Layoutmaß der Seite. Eine Höchstbreite des Inhalts gibt es nach der Nutzervorgabe nicht (§3.3).
- **Radien:** `--radius-surface` (Karten, Code-Block-Rahmen außen, SectionMessage), `--radius-control` (Knöpfe, Lozenge 999px ist eine Pille → Ausnahme wie Chips).
- **Bewegung:** Die Bookmarklet-Animation nutzt `--motion-ease`; die Dauer ist lokal, weil es eine Illustration ist, kein Overlay.
- **Clean-Room:** Alle Icons sind eigene Inline-SVG in `currentColor` (Zahnrad, „?“, Kanal-Symbole ohne Markenlogos: Kalenderblatt, Papierflieger, Briefumschlag mit „@“, Schloss-Umschlag für Proton). **Keine Markenlogos** von Google, Telegram, Web.de oder Proton (Marken- und Clean-Room-Grund).

### 3.13 Sicherheit (Assistent und Zugangsdaten)

- ADR-0018 bleibt unverändert: Die App speichert nur Namen, nie Werte.
- **Das Eingabefeld für Werte:**
  - Der Wert verlässt das Browserfenster nur über die Zwischenablage auf ausdrücklichen Klick.
  - Kein Request, kein Store, kein Web Storage, kein `console`-Aufruf, kein Flag mit dem Wert.
  - Der Wert wird nach dem Kopieren und beim Schließen geleert.
  - `spellcheck="false"`, denn die erweiterte Rechtschreibprüfung von Chrome und Edge sendet Feldinhalte an einen Dienst.
  - `autocomplete="off"` und Attribute gegen Passwortmanager.
- **Tests beweisen das (EH-5):**
  - Die Datenschicht-Attrappe erhält den Wert nie.
  - `localStorage` und `sessionStorage` enthalten ihn nach Kopieren und Schließen nicht.
  - Das DOM enthält ihn nach dem Schließen nicht mehr.
  - Die Anzeige maskiert.
- **Restrisiko** (in ADR-0026 benennen):
  - Windows-Zwischenablage-Verlauf und Cloud-Zwischenablage
  - Browsererweiterungen mit Seitenzugriff
  - Der Befehl steht im Verlauf des offenen cmd-Fensters (nicht dauerhaft; das Schließen des Fensters leert ihn).
  - Der Weg über die Systemsteuerung (Tab 2) vermeidet all das und wird als gleichwertige Alternative genannt.
- **Externe Links:** nur `https:`, `rel="noopener noreferrer"`, feste Adressen aus den Schrittdaten, keine Parameter aus Nutzerdaten.
- **Chat-ID aus `lastHint`:** Eine reine Funktion liest sie per Regex (`/Chat-ID (-?\d{1,20})/`); nur Ziffern werden übernommen. Sie ist kein Geheimnis und steht heute schon sichtbar an der Verbindung.
- **Rückweg-URL:** Sie wird mit `safeRedirect` geprüft (§3.3).

## 4. Arbeitspakete

Querschnitt wie in [e6-ui.md](../plan/e6-ui.md) §2:

- Runes-Regel, Schichten nach ADR-0006, Farben nur aus Tokens, Deutsch
- eigener Branch und PR, `scripts\build.ps1` grün, CI grün, Squash-Merge
- Manifest nachziehen, Entscheidungen im Plan
- Tests mit jsdom und den gemeinsamen Stubs; was jsdom nicht kann (Layout, Ziehen, Animation, echte Zwischenablage), als manueller Fall

UI-6 bis UI-9 samt UI-6b sind gemergt; die Fenster „nach UI-6/7“ bzw. „nach UI-8“ des Entwurfs sind damit erfüllt, jedes Paket hängt nur noch von seinen Vorgängern ab.

| Paket | Titel | Abhängig von |
|---|---|---|
| EH-0 | ADR-0026 und Plan (nur Doku) | – |
| EH-1 | Einstellungsbereich, Kopfzeile, Rückweg | EH-0 |
| EH-2 | Bausteine `SectionMessage`, `EmptyState`, `Lozenge`; Neustart-Hinweise vereinheitlicht | EH-0 |
| EH-3 | Kanal-Karten, Bearbeiten-Modal, Katalog | EH-1, EH-2 |
| EH-4 | `CodeBlock`, `ExternalLink`, Bookmarklet-Karte | EH-2 |
| EH-5 | Assistent-Gerüst + Google Calendar | EH-3, EH-4 |
| EH-6 | Assistent Telegram | EH-5 |
| EH-7 | Assistent Web.de, Gmail, Proton; alte Anleitungen entfernt; Seite „Datei-Importe“ fertig | EH-5 |
| EH-8 | Darstellung und Konto | EH-1 |
| EH-9 | Hilfe, „?“-Menü, Modal „Tastaturkürzel“ | EH-1, EH-4 |
| EH-10 | Hinweise app-weit, Teil 1 (Dialoge, Editoren) | EH-2 |
| EH-11 | Hinweise app-weit, Teil 2 (Tabellen, Panels, Aktivität) | EH-2 |
| EH-12 | Leere Zustände Projekte/Tags, „Erste Schritte“ | EH-2, EH-11 |
| EH-13 | Geführte Tour mit driver.js (optional, nur manuell startbar) | EH-9, EH-12 |

Reihenfolge: EH-0 → EH-1 → EH-2 → EH-3 → EH-4 → EH-5 → EH-7 → EH-6 → EH-9 → EH-8 → EH-10 → EH-11 → EH-12 → EH-13.

- Sichtbares kommt ab EH-1: Zahnrad, Navigation und Rückweg lösen die Punkte 1 und 2 des Nutzers sofort.
- EH-7 kommt vor EH-6, weil Postfächer häufiger eingerichtet werden und Telegram zwei Neustarts braucht.
- Die Tour (EH-13) kommt zuletzt: Sie braucht das „?“-Menü (EH-9) und „Erste Schritte“ (EH-12) als Startpunkte, und ihre Ziele stehen erst nach den übrigen Paketen fest.

### Hinweise aus UI-6b, UI-8 und UI-9 für alle EH-Pakete

- **Kopfzeile:** Ab 64rem steht die Kopfzeile fest oben (`sticky`), ihre Höhe steht in `--app-header-height`. Was im Einstellungsbereich `sticky` ist (Unternavigation), steht bei `top: calc(var(--app-header-height, 0px) + 1rem)`, sonst rutscht es unter die Kopfzeile. Die Kopfzeile ist unter einem Panel-Overlay `inert` (`PanelShell`); neue Knöpfe dort (Zahnrad, „?“) erben das.
- **Panels:** Braucht eine Einstellungsseite je ein Panel, dann über `ViewWithPanel` und den `Drawer`-Baustein, nicht über ein eigenes Grid. Der Einstellungsbereich selbst hat kein Panel; die Kanal-Karten öffnen Modals (Bearbeiten, Assistent), keine Panels.
- **Popover:** Auswahl in einem Panel-Popover nach dem Muster von `FilterPopover` (Radios im `fieldset`, Wahl per Zeiger und Enter schließt, Pfeiltasten wenden an, Esc gibt den Fokus an den Knopf). Das Menü „…“ der Karten und das „?“-Menü sind `Popover` der Art `menu`, wie `ThemeMenu`.
- **Tabellen:** Jede Komponente mit `<table>` fällt unter `table-columns.test.ts` (kein `min-width`, Rahmen als Container, Spalten per Container-Query). Die Tabellen der Hilfe (Tastaturkürzel, Kurzsyntax) sind keine Datenlisten mit Panel: EH-9 nimmt sie ausdrücklich in eine Ausnahmeliste des Tests auf oder baut sie als Beschreibungsliste. Nie seitlich scrollen lassen.
- **Breite:** Nach der Nutzervorgabe (§3.3) hat der Einstellungsbereich dieselbe Seitenbreite und dieselben Ränder wie „Aufgaben“ (`main` mit `--content-padding`), keine Höchstbreite.
- **Überlauf im Panel (Fix nach UI-9):** Keine Textknöpfe wie „Entfernen“ in engen Zeilen, sondern `.button-icon` mit `aria-label` und `title`; statisch geprüft (`no-text-remove-buttons.test.ts`).

### EH-0 – ADR-0026 und Plan (nur Doku)

- **Dateien:**
  - `docs/adr/0026-einstellungsbereich-und-hinweis-bausteine.md`
  - `docs/plan/e6-einstellungen.md`
  - Verweise in ADR-0025 (Nachtrag: Hinweis-Bausteine sind keine Overlays; §6 Breakpoints nach Nutzerentscheidung)
  - CLAUDE.md §7 (Kopfzeile, Einstellungen, Hinweise) und §8 (Hinweis-Bausteine, Lozenge)
  - README (Roadmap)
  - Test-Manifest (Block „E6 | Einstellungen und Hilfe“ mit geplanten Fällen)
- **Akzeptanz:** Die Entscheidungen des Nutzers zu den Fragen in §6 sind eingetragen. Die ADR ist „Angenommen“ und benennt das Restrisiko der Zwischenablage (§3.13) und die Ausnahme für driver.js.
- **Manifest:** keine neuen Tests; die geplanten Fälle BYL-E6-029 bis BYL-E6-059 stehen mit Status „geplant“ im Block „E6 | Einstellungen und Hilfe“.

### EH-1 – Einstellungsbereich, Kopfzeile, Rückweg (erstes Sichtbares)

- **Dateien:**
  - neu `routes/(app)/einstellungen/+layout.svelte`, `+page.ts` (Weiterleitung)
  - `kanaele/+page.svelte` (in das Layout; Inhalt unverändert bis EH-3)
  - neu `datei-importe/+page.svelte` (heutiger `ImportKeywordsSection`, aus `ChannelsView` entfernt)
  - neu `components/SettingsNav.svelte`, `components/Breadcrumbs.svelte`
  - neu `lib/stores/last-view.svelte.ts` (+ Test); Anschluss in `routes/(app)/+layout.svelte` (`afterNavigate`)
  - `AppHeader.svelte` (Zahnrad statt „Kanäle“, App-Name als Link)
  - `ViewSwitch.svelte` (`current` darf `null` sein)
  - `FileImportDialog.svelte` (Link auf `/einstellungen/datei-importe`)
  - Doku: README „Kanäle“ → „Einstellungen → Kanäle“, CLAUDE.md §7
- **Akzeptanz:**
  - Das Zahnrad steht in der Kopfzeile im Stil der Symbolknöpfe und trägt unter `/einstellungen/*` `aria-current="page"`.
  - `/einstellungen` leitet auf `/einstellungen/kanaele`.
  - Links steht die Navigation (Kanäle, Datei-Importe; Darstellung, Konto und Hilfe erscheinen erst mit ihren Paketen, **kein toter Link**).
  - „← Zurück zu ‹Ansicht›“ führt zur letzten Ansicht mit Query und offenem Panel. Ohne gemerkten Wert oder mit ungültigem Wert führt er zu „Aufgaben“ (`/`).
  - Der Umschalter steht oben ohne aktiven Eintrag. Der App-Name führt zu `/`.
  - Oben im Inhalt steht der Brotkrumenpfad „Einstellungen › Kanäle“.
  - Der Bereich nutzt die volle Breite wie „Aufgaben“ (gleiche Ränder, keine Höchstbreite, nicht nach links gedrückt).
  - Unter 64rem steht die Navigation als Zeile über dem Inhalt.
- **Tests (jsdom):**
  - `last-view.test.ts`: merkt Ansichten, ignoriert `/einstellungen` und `…/voll`, `safeRedirect` gegen `//evil`, `sessionStorage` nicht verfügbar → Rückfall
  - `settings-layout.test.ts`: Navigation mit Namen, `aria-current`, Beschriftung des Rückwegs je Route, Fokus auf `h2` nach Wechsel
  - `app-header.test.ts` (neu oder in `app-layout.test.ts`): Zahnrad-Name, `aria-current`, App-Name-Link
  - `view-switch.test.ts`: `current = null`
  - `file-import-dialog.test.ts`: neues Linkziel
  - `import-keywords-section.test.ts` bleibt grün.
- **Manifest:**
  - BYL-E6-029 „Einstellungen: Einstieg und Unternavigation“ (komponente)
  - BYL-E6-030 „Rückweg zur letzten Ansicht“ (unit, komponente)
  - BYL-E6-031 „Einstellungen schmal und Kopfzeile“ (manuell)

### EH-2 – Hinweis-Bausteine und einheitlicher Neustart-Hinweis

- **Dateien:**
  - neu `components/guidance/SectionMessage.svelte`, `EmptyState.svelte`, `Lozenge.svelte`, `GuidanceIcon.svelte` (eigener Icon-Satz)
  - neu `lib/guidance/texts.ts` (`RESTART_NEEDED`)
  - die fünf `*_UNAVAILABLE*`-Konstanten (`stores/connections.svelte.ts`, `import-keywords.svelte.ts`, `inbox.svelte.ts`, `recurrence.svelte.ts`, `mail-import.ts`) auf einen Wortlaut
  - erste Nutzung in `ConnectionsSection` (laden, nicht verfügbar, Fehler, „Noch keine Verbindung“ als `EmptyState`) und `ImportKeywordsSection`
- **Akzeptanz:**
  - Vier Töne mit Icon und verstecktem Präfix; `live` setzt `status` bzw. `alert`; ohne `live` keine Rolle.
  - Kein Rot außer beim Ton `error`.
  - Überall steht derselbe Neustart-Text mit „stop.bat, dann start.bat“.
  - `EmptyState` hat höchstens einen Primärknopf.
- **Tests:**
  - `section-message.test.ts` (Rollen, Präfixe, Aktionen, compact)
  - `empty-state.test.ts` (Überschriftenebene, Größen, Snippets)
  - `lozenge.test.ts`
  - `guidance-texts.test.ts`: kein „(start.bat)“ ohne „stop.bat“; die Stores nutzen den Text
  - Anpassung `connections-page`, `import-keywords-section`, `inbox-store`, `recurrence`-Tests (neuer Wortlaut, im PR begründet)
- **Manifest:**
  - BYL-E6-032 „Section Message: Töne und Ansage“ (komponente)
  - BYL-E6-033 „Empty State und Lozenge“ (komponente)
  - BYL-E6-034 „Einheitlicher Neustart-Hinweis“ (unit)

### EH-3 – Kanal-Karten, Bearbeiten und Katalog

- **Dateien:**
  - neu `lib/domain/channel-health.ts` (+ Test), `components/channels/ChannelCard.svelte`, `ChannelEditModal.svelte`, `ChannelCatalog.svelte`, `ChannelsIntro.svelte`, `ChannelIcon.svelte`
  - `ConnectionsSection.svelte` wird zur Liste der Karten, das Formular „Neue Verbindung“ entfällt hier.
  - **Übergang bis EH-5:** Im Katalog öffnet „Einrichten“ das bisherige Formular als Modal M („Verbindung anlegen“), damit das Anlegen nie fehlt.
  - `ChannelsView.svelte`: Reihenfolge nach §3.4; die Anleitungskarten bleiben bis EH-7 **unter** dem Katalog, zugeklappt als `<details>` je Dienst.
- **Akzeptanz:**
  - Jede Verbindung ist eine Karte mit Lozenge nach der Tabelle in §3.5.
  - „Pausieren“/„Fortsetzen“ und „Löschen …“ stehen im Menü „…“. „Bearbeiten“ öffnet das Modal M mit Stichwörtern und Schaltern, Änderungen speichern sofort.
  - Die Checkbox „Eingeschaltet“ entfällt; der wiederholte Neustart-Hinweis je Postfach entfällt.
  - Ohne Verbindung erscheint der leere Zustand mit „Kanal hinzufügen“.
  - Anlegen ist weiter möglich (Übergangs-Modal).
- **Tests:**
  - `channel-health.test.ts` (alle Zeilen und Vorrang, `secretStatus = null`)
  - `channel-card.test.ts` (Lozenge-Text, Meta, Aktionen je Art, Menü per Popover-Stubs, Löschen öffnet Bestätigung)
  - `channel-edit-modal.test.ts` (Stichwort speichern, Schalter, Fuß „Schließen“)
  - `connections-page.test.ts` angepasst (Formular im Modal, Schalter im Menü; im PR begründet)
- **Manifest:**
  - BYL-E6-035 „Kanal-Status als Lozenge“ (unit, komponente)
  - BYL-E6-036 „Kanal-Karte: Aktionen, Pausieren, Löschen“ (komponente)
  - BYL-E6-037 „Karten-Raster und Katalog“ (manuell, Breiten)

### EH-4 – Code-Block, externe Links, Bookmarklet-Karte

- **Dateien:**
  - neu `lib/guidance/command.ts` (+ Test), `components/guidance/CodeBlock.svelte`, `ExternalLink.svelte`
  - neu `components/channels/BookmarkletCard.svelte` samt eigener Illustration
  - `ChannelsView.svelte` (Karte statt Abschnitt)
  - `channels-view.test.ts` → `bookmarklet-card.test.ts`
  - `lib/clipboard.ts`: `writeClipboardText` mit Fehlerergebnis, falls noch nicht vorhanden
- **Akzeptanz:**
  - „Kopieren“ kopiert, meldet „Kopiert“ 2 s lang und per Status; bei Fehlern markiert es den Code und nennt Strg+C.
  - Platzhalter sind sichtbar hervorgehoben.
  - Die Bookmarklet-Karte hat den ziehbaren Knopf mit Beschreibung, eine Animation zweimal beim ersten Sichtbarwerden und keine bei reduzierter Bewegung.
  - Ein Klick auf den Knopf wirkt nicht und erklärt das. Der Weg ohne Maus steht in `<details>`; die `textarea` entfällt.
- **Tests:**
  - `command.test.ts` (Segmente, Maskierung, `setxValueError` für `"`, Umbruch, > 1024, `%X%`, Gmail-Leerzeichen)
  - `code-block.test.ts` (Clipboard-Attrappe Erfolg und Fehler, Status, `aria-label`)
  - `external-link.test.ts` (Ziel, `rel`, versteckter Hinweis, nur https)
  - `bookmarklet-card.test.ts` (die bisherigen vier Fälle, `matchMedia`-Attrappe für reduzierte Bewegung)
- **Manifest:**
  - BYL-E6-038 „Code-Block: Kopieren und Platzhalter“ (unit, komponente)
  - BYL-E6-039 „Bookmarklet-Karte“ (komponente)
  - BYL-E6-040 „Bookmarklet ziehen und Animation“ (manuell: Chrome, Firefox, Opera GX)

### EH-5 – Einrichtungsassistent (Gerüst) + Google Calendar

- **Dateien:**
  - neu `lib/domain/channel-setup.ts` (Schrittdaten, `setupProgress`) + Test
  - neu `components/guidance/Stepper.svelte`, `components/guidance/Tabs.svelte` (oder geteilt mit dem Reiter im Panel)
  - neu `components/channels/ChannelSetup.svelte`, `SetupStep.svelte`, `SetupCheck.svelte`, `SecretValueField.svelte`
  - `stores/connections.svelte.ts`: `watch(id)` als Realtime-Abo auf einen Datensatz, mit Cleanup; `probeHelper(id)`
  - `data/connections.ts`: `subscribeConnection`
  - `kanaele/+page.svelte`: Parameter `einrichten`
  - `ChannelsView.svelte`: „Einrichten“ für den Kalender statt Übergangs-Modal
- **Akzeptanz:**
  - `?einrichten=kalender` öffnet Modal L mit 6 Schritten.
  - Nach Neuladen und nach dem Neustart der App steht der Assistent am ersten offenen Schritt.
  - Die Prüfungen zeigen die Variable (ja/nein), Stichwörter und das Ergebnis von „Jetzt abrufen“.
  - „Weiter“ ist nie gesperrt, offene Prüfungen werden im nächsten Schritt genannt.
  - Tabs „Eingabeaufforderung | Systemsteuerung“.
  - Das Wertfeld erfüllt §3.13.
  - „Alle Schritte anzeigen“ zeigt die Gesamtansicht.
  - Die Anleitungskarte „Google Calendar“ entfällt.
- **Tests:**
  - `channel-setup.test.ts`: `setupProgress` für jede Faktenlage, Schrittzahl ≤ 6, alle externen Links `https:`, jeder geheime Platzhalter mit `secret: true`
  - `stepper.test.ts`: `aria-current="step"`, Namen mit Zustand, Klick wechselt, Fokus auf `h3`
  - `tabs.test.ts`: APG-Tastatur, manuelle Aktivierung
  - `channel-setup-dialog.test.ts`: öffnen per Parameter, Schließen entfernt ihn, Anlegen setzt `verbindung`, Prüfen per Datenschicht-Attrappe, Realtime-Ereignis aktualisiert die Prüfung, Cleanup beim Schließen
  - `secret-value-field.test.ts`: **der Wert erreicht nie die Datenschicht, steht nicht in `localStorage`/`sessionStorage`, ist nach dem Schließen nicht im DOM**; maskierte Anzeige; `spellcheck=false`
- **Manifest:**
  - BYL-E6-041 „Assistent: Fortschritt aus Serverdaten“ (unit)
  - BYL-E6-042 „Stepper und Tabs: Tastatur und ARIA“ (komponente)
  - BYL-E6-043 „Wert einsetzen ohne Speichern und Senden“ (komponente)
  - BYL-E6-044 „Kalender einrichten Ende-zu-Ende mit Neustart“ (manuell)
  - BYL-E6-045 „Assistent mit Screenreader“ (manuell, NVDA)

### EH-6 – Assistent Telegram

- **Dateien:** `channel-setup.ts` (Schrittdaten, `chatIdFromHint`), `ChannelSetup` (Schritt „Chat freigeben“ mit erzeugtem Befehl); die Anleitungskarte „Telegram“ entfällt.
- **Akzeptanz:**
  - 6 Schritte. Nach „Jetzt abrufen“ mit fremdem Chat zeigt der Schritt die erkannte ID und den fertigen `setx`-Befehl; mehrere IDs per Komma.
  - Die Prüfung nach dem zweiten Neustart erkennt „kein fremder Chat mehr“.
- **Tests:**
  - `chatIdFromHint` (positiv, negativ, `-100…`, Müll, zu lang)
  - Schrittfolge mit Attrappe
- **Manifest:**
  - BYL-E6-046 „Telegram: Chat-ID übernehmen“ (unit, komponente)
  - BYL-E6-047 „Telegram einrichten mit zwei Neustarts“ (manuell)

### EH-7 – Assistent Web.de, Gmail, Proton; Seite „Datei-Importe“

- **Dateien:**
  - `channel-setup.ts` (Web.de, Gmail; Proton als Modal M mit Liste)
  - `ChannelSetup` (Realtime-Warten auf den ersten Abruf, „Hilfsprozess prüfen“)
  - `ChannelsView.svelte`: **alle** alten Anleitungskarten und die Karte „Zugangsdaten als Windows-Variable“ entfallen; Letztere wird FAQ bzw. `<details>`.
  - `datei-importe/+page.svelte` (Erklärblock, drei Listen, Proton- und Gmail-`.eml`-Weg)
- **Akzeptanz:**
  - Postfächer in 6 Schritten; Gmail entfernt Leerzeichen und sagt es.
  - Der erste Abruf erscheint ohne Neuladen (Realtime).
  - „Hilfsprozess prüfen“ nur auf Klick.
  - Proton hat eine Anleitung und „Zum Eingang“.
  - Die Seite „Kanäle“ passt ohne Anleitungstext auf etwa zwei Bildschirmhöhen.
- **Tests:** Schrittdaten Web.de/Gmail, Realtime-Update des Schritts, `probeHelper` (`unavailable`/`ok`), Proton-Modal, Datei-Importe-Seite (Überschrift, drei Editoren).
- **Manifest:**
  - BYL-E6-048 „Postfach einrichten: erster Abruf live“ (komponente)
  - BYL-E6-049 „Web.de und Gmail Ende-zu-Ende“ (manuell)
  - BYL-E6-050 „Proton-Anleitung und Datei-Importe“ (komponente)

### EH-8 – Darstellung und Konto

- **Dateien:** `darstellung/+page.svelte` (Radiogruppe mit drei Vorschaukacheln, nutzt `ThemeStore`), `konto/+page.svelte`, `SettingsNav` (zwei Einträge mehr).
- **Akzeptanz:**
  - Die Wahl wirkt sofort und stimmt mit dem Menü in der Kopfzeile überein (beide Richtungen).
  - Die Kontoseite zeigt E-Mail, den Unterschied Admin/App, den Link zur Verwaltung und „Abmelden“; kein Passwortfeld.
- **Tests:**
  - `appearance-page.test.ts` (Radios, Wechsel, Gleichlauf mit `ThemeStore`)
  - `account-page.test.ts` (Texte, `rel="external"`, Abmelden ruft `auth.logout`)
- **Manifest:** BYL-E6-051 „Darstellung und Konto in den Einstellungen“ (komponente).

### EH-9 – Hilfe, „?“-Menü, Modal „Tastaturkürzel“

- **Dateien:**
  - neu `lib/domain/shortcuts.ts` (+ Test), `hilfe/+page.svelte`, `components/help/ShortcutsTable.svelte`, `ShortcutsModal.svelte`, `HelpMenu.svelte`
  - `AppHeader.svelte` („?“)
  - `routes/(app)/+layout.svelte` (Taste `?`)
  - `lib/domain/keyboard.ts` (`isHelpKey`)
  - `QuickCapture.svelte` (Link „Mehr zur Kurzsyntax“)
  - README „Tastatur“ (Verweis auf die Hilfe)
- **Akzeptanz:**
  - `?` öffnet das Modal (nicht in Feldern, Dialogen und Popovers).
  - Das Hilfe-Menü hat drei Einträge („Kurze Einführung“ kommt erst mit EH-13, kein toter Eintrag). Die Hilfeseite hat Sprunglinks, Tabelle, Kurzsyntax und FAQ.
  - Die Tabellen der Hilfe folgen der Regel aus „Hinweise aus UI-6b, UI-8 und UI-9“ (Ausnahme im Test oder Beschreibungsliste).
  - Tastenkürzel stammen aus einer Quelle.
- **Tests:**
  - `shortcuts.test.ts` (Vollständigkeit gegen die Handler)
  - `keyboard.test.ts` (`isHelpKey`, auch Umschalt+ß)
  - `help-menu.test.ts`, `shortcuts-modal.test.ts`, `help-page.test.ts`
  - `app-layout.test.ts` (`?` öffnet, nicht aus Feldern)
- **Manifest:**
  - BYL-E6-052 „Hilfe-Menü und Taste ?“ (komponente)
  - BYL-E6-053 „Hilfeseite: Kürzel, Kurzsyntax, FAQ“ (komponente)

### EH-10 – Hinweise app-weit, Teil 1

- **Dateien:** `FileImportDialog`, `MailboxPicker`, `ClipboardImport`, `BulkConvertDialog`, `WhatsAppImport`, `KeywordEditor`, `RecurrenceSummary`, `RecurrenceForm`; neu `no-own-notices.test.ts` (zunächst mit Ausnahmeliste für die Dateien aus EH-11/EH-12).
- **Akzeptanz:** Alle Hinweise in diesen Dateien nutzen `SectionMessage` bzw. `EmptyState compact`. Keine lokalen `.notice`/`.empty` mehr dort.
- **Tests:** vorhandene Dialogtests grün (Texte gleich, nur Aufbau neu; Änderungen begründet), `no-own-notices.test.ts`.
- **Manifest:** BYL-E6-054 „Hinweise in Dialogen einheitlich“ (komponente, unit).
- **Hinweis:** `RecurrenceSummary` wird von `TicketPanel` und der Vollansicht eingebunden, ist aber eine eigene Datei; UI-6 und UI-7 haben sie nicht verschoben.

### EH-11 – Hinweise app-weit, Teil 2

- **Dateien:** `TicketTable`, `InboxTable`, `InboxPanel`, `CommentList`, `HistoryList`, `TicketActivity` sowie die Teile aus UI-7 (`TicketFields`, `TicketDescription`, `TicketMeta`); Ausnahmeliste in `no-own-notices.test.ts` schrumpft.
- **Akzeptanz:**
  - Leere Zustände nach der Tabelle in §3.9 mit einem Primärknopf.
  - „Der Eingang ist leer“ bietet „Erfassen“ und „Kanal einrichten“.
  - Die Fokusführung von „Filter zurücksetzen“ bleibt (Überschrift der Ansicht).
- **Tests:** `ticket-table`, `inbox-table`, `inbox-panel`, `comments`, `history-list` angepasst (Rolle bzw. Name der Knöpfe gleich; neue Fälle für Sekundäraktion).
- **Manifest:** BYL-E6-055 „Leere Zustände in Listen und Panels“ (komponente).

### EH-12 – Projekte, Tags und „Erste Schritte“

- **Dateien:** `ProjectsView` und `ProjectPanel` (UI-8), `TagManager`, neu `components/FirstSteps.svelte` und `lib/domain/first-steps.ts`.
- **Akzeptanz:**
  - Leere Zustände nach §3.9; `no-own-notices.test.ts` ohne Ausnahmen.
  - Die „Erste Schritte“-Liste (Nutzerentscheidung 3) erscheint nur ohne Tickets **und** ohne Verbindung, leitet ihren Zustand aus Daten ab und verschwindet von selbst. Der Punkt „Kurze Einführung starten“ erscheint erst mit EH-13.
- **Tests:** `projects-view`, `tag-manager` angepasst; `first-steps.test.ts` (Ableitung, Anzeige-Bedingung).
- **Manifest:**
  - BYL-E6-056 „Leere Zustände Projekte und Tags“ (komponente)
  - BYL-E6-057 „Erste Schritte“ (unit, komponente)

### EH-13 – Geführte Tour mit driver.js (optional)

- **Grundlage:** Nutzerentscheidung 3 (§6), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md) §8.
- **Dateien:**
  - `web/package.json`: Abhängigkeit `driver.js` (MIT, gepinnte Minor-Version, `package-lock.json`), lokal gebündelt über Vite, **kein CDN**
  - neu `lib/tour/steps.ts` (Schrittdaten: Ziel per `data-tour`, Titel, Text; höchstens 5 Schritte), `lib/tour/tour.ts` (dünne Hülle um `driver()`: deutsche Knopftexte, `animate` nur ohne reduzierte Bewegung, Fokus-Rückgabe, Esc beendet)
  - neu `lib/styles/tour.css` (Gestaltung mit unseren Tokens, hell und dunkel, kein Schatten; überschreibt die Standard-CSS der Bibliothek)
  - `data-tour`-Attribute an den Zielen (Schnellerfassung, „Neues Ticket“, Umschalter, Filterleiste, Zahnrad)
  - `HelpMenu.svelte` (Eintrag „Kurze Einführung“), `FirstSteps.svelte` (Punkt „Kurze Einführung starten“)
- **Akzeptanz:**
  - Die Tour startet nur über „Kurze Einführung“ im „?“-Menü oder aus „Erste Schritte“, nie automatisch.
  - Höchstens 5 Schritte; jeder hat „Weiter“, „Zurück“ (ab Schritt 2) und Schließen; Esc beendet, der Fokus kehrt zum Auslöser zurück.
  - Farben nur aus `tokens.css` (statischer Test wie `color-literals`), Schleier `--color-blanket`, Radien und Bewegung über die Tokens, bei reduzierter Bewegung keine Animation.
  - Fehlt ein Ziel (etwa unter 64rem ausgeblendet), überspringt die Tour den Schritt, statt ins Leere zu zeigen.
  - Keine Anfrage an fremde Server (statisch: kein `http` in den Tour-Dateien außer im Kommentar).
- **Tests:** `tour-steps.test.ts` (≤ 5 Schritte, jedes Ziel existiert als `data-tour` im Quelltext, Texte deutsch und nicht leer), `tour.test.ts` (Start nur per Aufruf, Optionen: Knopftexte, `animate` folgt `matchMedia`, `onDestroyed` gibt den Fokus zurück; `driver.js` per Attrappe), `help-menu.test.ts` (Eintrag startet die Tour).
- **Manifest:**
  - BYL-E6-058 „Geführte Tour: Start, Schritte, Fokus“ (unit, komponente)
  - BYL-E6-059 „Geführte Tour im Browser, hell und dunkel“ (manuell)

## 5. Risiken

| Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|
| Regressionen in Dateien aus UI-6 bis UI-9 | `TicketTable`, `InboxTable`, Panels, `ProjectsView` und Kopfzeile ändern sich erneut | Bestehende Tests als Netz (e6-ui.md §2), Hinweise aus UI-6b, UI-8 und UI-9 (§4), jede Testanpassung im PR begründet |
| Fremdbibliothek für die Tour (EH-13) | Pflege, Aussehen, Barrierefreiheit, Lizenz | nur driver.js (MIT, ohne Abhängigkeiten), lokal gebündelt, gepinnt, Dependabot; eigene Styles mit Tokens; nur manuell; Ziele per `data-tour` mit Test; ADR-0026 §8 |
| Geheimwert im Browser (Wertfeld) | Zwischenablage-Verlauf, Erweiterungen, Rechtschreibprüfung | nur lokal, geleert, `spellcheck=false`, Hinweis auf Win+V, gleichwertiger Weg per Systemsteuerung, Tests nach §3.13; Nutzerentscheidung 2 |
| Anleitungen veralten (Google, Web.de ändern ihre Oberfläche) | falsche Klickwege | Schrittdaten zentral in `channel-setup.ts` mit „Stand: 2026-09“; die Details verlinken die offiziellen Hilfeseiten; ein Manifestfall „Klickwege prüfen“ je Halbjahr |
| Neustart unterbricht den Assistenten | Nutzer verliert den Faden | Fortschritt aus Serverdaten, Adresse mit `verbindung=<id>`, Karte „Einrichtung fortsetzen“ |
| Prüfungen versprechen zu viel | Nutzer vertraut einem grünen Haken, obwohl der Wert falsch ist | Texte sagen genau, was geprüft ist („Die App sieht die Variable“, nicht „richtig eingerichtet“); erst der erste Abruf gibt „Eingerichtet“ mit Ergebnis |
| jsdom ohne Layout, Ziehen, Animation, echte Zwischenablage | scheinbar grüne Tests | reine Funktionen, Attrappen, manuelle Fälle (BYL-E6-031, 037, 040, 044, 045, 047, 049, 059) |
| Umfang wächst (14 Pakete) | lange Laufzeit | Sichtbares zuerst (EH-1 bis EH-4 lösen die Punkte 1, 2 und 4 zum großen Teil); EH-13 optional |

## 6. Entscheidungen des Nutzers (Produktfragen)

| Nr. | Frage | Entscheidung |
|---|---|---|
| 1 | Panel ab 1024 px eingebettet, darunter als Overlay mit Schleier? | **Ja**, umgesetzt mit UI-6b ([ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md) §11). |
| 2 | Soll der Assistent ein Feld „Wert hier einsetzen“ für Passwörter und die Kalenderadresse anbieten? | **Ja:** zugeklappt, als Passwortfeld, mit dem Hinweis auf den Zwischenablage-Verlauf (Win+V). Für nicht geheime Werte (Telegram-IDs) ein offenes Textfeld. Umsetzung in EH-5 nach §3.9 und §3.13. |
| 3 | Einführungstour? | **„Erste Schritte“-Liste** im leeren Zustand (EH-12) **plus eine optionale geführte Tour mit driver.js** (EH-13): MIT, lokal gebündelt, kein CDN, mit unseren Tokens für hell und dunkel gestaltet, nur manuell startbar über das „?“-Menü und aus „Erste Schritte“, höchstens etwa 5 Schritte. intro.js ist wegen AGPL und CDN ausgeschlossen. |
| 4 | Breite des Einstellungsbereichs (Vorgabe zu EH-1) | **Volle Breite** wie die übrigen Ansichten: gleiche Seitenbreite und gleiche Ränder wie „Aufgaben“, nicht nach links gedrückt; dazu Unternavigation links, Zahnrad-Symbolknopf statt Textlink „Kanäle“, „← Zurück zu …“ mit Ansicht, Filtern und Panel, Brotkrumenpfad, Umschalter ohne aktiven Eintrag, App-Name als Link auf „Aufgaben“. |

## 7. Entscheidungen

Wird je Paket ergänzt.

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-26 | EH-0 | Ablage wie im Entwurf vorgeschlagen: [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md) und dieser Plan. Die Ziel-Spezifikation (§3) ist aus dem Entwurf übernommen und nur dort geändert, wo der Nutzer entschieden hat (Breite §3.3 und §3.12, Tour §3.10). Der Panel-Befund (Entwurf §1.5, §3.14) entfällt hier, weil UI-6b ihn umgesetzt hat. |
| 2026-09-26 | EH-0 | Manifest-IDs ab `BYL-E6-029` (Block um 2 verschoben, weil UI-6b `BYL-E6-027` und `BYL-E6-028` vergeben hat); vergeben bis `BYL-E6-059`, reserviert bis `BYL-E6-064`. Die geplanten Fälle stehen im Manifest-Block „E6 | Einstellungen und Hilfe“ mit Status „geplant“. |
| 2026-09-26 | EH-0 | Die Tour wird ein eigenes, letztes Paket EH-13 nach EH-9 („?“-Menü) und EH-12 („Erste Schritte“), weil beide ihre Startpunkte sind. driver.js ist eine begründete Ausnahme von „keine UI-Bibliothek“ (ADR-0025 §1, §2 Grundsatz 2) und CLAUDE.md §3; die Grenzen stehen in ADR-0026 §8. |
| 2026-09-26 | EH-0 | Die Fenster „nach UI-6/7“ und „nach UI-8“ des Entwurfs entfallen, weil UI-6 bis UI-9 gemergt sind. Neu ist der Abschnitt „Hinweise aus UI-6b, UI-8 und UI-9“ in §4 (`--app-header-height`, `ViewWithPanel`/`Drawer`, `FilterPopover` als Vorlage, Tabellen ohne `min-width`). |
| 2026-09-26 | EH-1 | Aufbau: Das `(app)`-Layout legt einen `LastViewStore` (`stores/last-view.svelte.ts`) in den Kontext und gibt ihm per `afterNavigate` jede Adresse; er behält nur Ansichten (nicht `/einstellungen/*`, `…/voll`, `/login`) mit Query und Hash in `sessionStorage` `byl-last-view`. Beim Lesen prüft `safeRedirect` den Wert und danach noch einmal `isViewPath`, damit ein manipulierter Wert weder auf eine fremde Adresse noch in die Einstellungen selbst führt. Fehler des Speichers (gesperrt, voll) fängt der Store ab; der Wert bleibt dann nur für diese Seite. |
| 2026-09-26 | EH-1 | Beschriftung des Rückwegs nach dem Ziel: „Zurück zu Aufgaben“ (auch `/tickets/neu`), „Zurück zu ‹Key›“ für ein offenes Ticket (Key aus der geladenen Liste, sonst „Zurück zum Ticket“), „Zurück zu Projekte“ (auch mit Projekt-Panel), „Zurück zum Eingang“ (auch `/eingang/neu`), „Zurück zum Eintrag“. |
| 2026-09-26 | EH-1 | Layout `einstellungen/+layout.svelte`: eine Leiste mit dem `ViewSwitch` (`current = null`, Zahlen aus `InboxStore` und `TicketListStore`), darunter ab 64rem ein Grid `15rem minmax(0, 1fr)`; die Navigation steht `sticky` bei `calc(var(--app-header-height, 0px) + 1rem)`. Keine Höchstbreite (Nutzervorgabe), nur Absätze haben 80ch. Überschrift `h2` mit `data-view-heading`, damit der Fokus-Rückfall der Modals sie findet; nach einem Wechsel der Seite **innerhalb** der Einstellungen bekommt sie den Fokus (`afterNavigate`), beim Kommen aus einer Ansicht bleibt es beim Standard von SvelteKit. Die Leiste zeigt nur den Umschalter, ohne Titel davor; der Titel steht als Brotkrumenpfad und `h2` über dem Inhalt (Aufbau wie in der Spezifikation §3.3). |
| 2026-09-26 | EH-1 | Seiten: `SETTINGS_SECTIONS` in `lib/settings-sections.ts` ist die eine Liste für Navigation, Titel und Brotkrumen; „Darstellung“, „Konto“ und „Hilfe“ kommen erst mit EH-8 und EH-9 dazu. `/einstellungen` leitet per `+page.ts` mit 307 weiter. `ChannelsView` hat keine eigene `h2` und keine Höchstbreite (48rem) mehr, die Karte „Stichwörter für Datei-Importe“ zieht auf `/einstellungen/datei-importe` (eigene Seite mit `ImportKeywordsStore`), der Link im Datei-Dialog heißt „Stichwörter unter „Datei-Importe“ festlegen“. |
| 2026-09-26 | EH-1 | Kopfzeile: Das Zahnrad ist ein Link mit `.button-icon`, `aria-label` und `title` „Einstellungen“ und eigener Zahnrad-SVG; unter `/einstellungen/*` trägt es `aria-current="page"` und die Marke-Fläche mit Rahmen in der Markenfarbe. Der App-Name ist ein Link auf `/` im `h1`, ohne Unterstreichung (nur bei Hover); der Zähler bleibt daneben. Brotkrumen: Trenner „›“ als `::before` mit leerem Alternativtext (`content: '›' / ''`), damit Screenreader ihn nicht vorlesen. |
| 2026-09-26 | EH-1 | Bewusst angepasste Tests: `channels-view` (keine `h2` „Kanäle“ mehr in der Komponente, stattdessen die Karte „Bookmarklet für Web-Links“; die Überschrift prüft `settings-layout`), `channels-view` und `connections-page` ohne die Prop `importKeywords`, `file-import-dialog` (neues Linkziel und -text), `app-layout` (Attrappe von `afterNavigate`). Neu: `last-view.test.ts`, `settings-layout.test.ts`, Fälle in `app-layout` (Zahnrad, App-Name, Rückweg) und `view-switch` (`current = null`). Manifest: BYL-E6-029 und BYL-E6-030 bestanden, BYL-E6-031 offen (manuell). |
| 2026-09-26 | EH-2 | Bausteine unter `components/guidance/`: `SectionMessage` (Props `tone`, `title`, `compact`, `live`, `headingLevel`; Snippets `children` und `actions`; `TONE_PREFIX` als versteckter Präfix, bei Titel in der Überschrift, sonst vor dem Text), `EmptyState` (`title`, `description`, `size`, `icon`, `headingLevel`; Snippets `primary` und `secondary`), `Lozenge` (`label`, `icon`, `tone`, optional `id` für `aria-describedby`) und `GuidanceIcon` (eigener Satz aus Linien-SVG: Töne, Status, leere Zustände). Große Icons (48 px) zeichnen mit 0.75 statt 1.5 Strichbreite, damit die Linie fein bleibt. Die Warnung ist neutral: Fläche `--color-surface`, Rahmen `--color-line`, Linie links `--color-text-muted`, Titel 700. |
| 2026-09-26 | EH-2 | Neustart: `RESTART_NEEDED` (Titel und Text) und `restartNeeded(subject)` für einen Satz („Der Eingang ist nach dem nächsten Neustart verfügbar. Die App hat ein Update bekommen …: stop.bat, dann start.bat im Ordner app.“). Die fünf Konstanten der Stores und der Hinweis im Datei-Dialog nutzen ihn; die Oberfläche zeigt in „Kanäle“ und „Datei-Importe“ Titel plus Text als `SectionMessage` (Info, `live`). Die Hinweise „Server nicht erreichbar … (start.bat)“ bleiben, weil sie den Start der App meinen, nicht eine Migration. |
| 2026-09-26 | EH-2 | Erste Nutzung: `ConnectionsSection` (nicht verfügbar, Fehler mit „Erneut versuchen“, leerer Zustand „Noch kein Kanal verbunden“ mit „Kanal hinzufügen“; der Knopf setzt bis EH-3 den Fokus auf „Art“ im Formular „Neue Verbindung“), `ImportKeywordsSection` (nicht verfügbar, Fehler) und „Demnächst“ am Bereichs-Umschalter (Lozenge `muted` mit Uhr statt eigener Pille aus dem Fix nach UI-9). Das Laden bleibt ein Statustext; Platzhalterkarten kommen mit den Karten in EH-3. |
| 2026-09-26 | EH-2 | Bewusst angepasste Tests: `connections-page` und `import-keywords-section` (Hinweis vor der Migration jetzt als Section Message mit Titel statt Einzeiler), `file-import-dialog`, `inbox-table`, `recurrence-summary` und `mail-import` (neuer Wortlaut), `area-switch` (Lozenge statt Klasse `soon`, Text mit `trim()`, weil die Lozenge Icon und Text trägt). Neu: `section-message.test.ts`, `empty-state.test.ts` (samt Lozenge), `lib/guidance/texts.test.ts`, zwei Fälle in `connections-page` (leerer Zustand, Ladefehler). Manifest: BYL-E6-032 bis BYL-E6-034 bestanden. |
| 2026-09-26 | EH-3 | Aufbau der Seite „Kanäle“ nach §3.4: `ChannelsIntro` (zwei Erklärungen als Text, nicht als Abschnitte, weil die Seite darunter Abschnitte gleichen Namens hat; darunter zugeklappt „Zugangsdaten als Windows-Variable setzen“, die bisherige Karte), „Deine Verbindungen“ (`ConnectionsSection` mit Zahl, „Aktualisieren“ als `.button-subtle`, Raster `repeat(auto-fill, minmax(18rem, 1fr))`, drei Platzhalterkarten beim Laden), „Selbst hereinbringen“ (Bookmarklet unverändert bis EH-4, Karte „Dateien hereinziehen“), `ChannelCatalog` und „Anleitungen“ (die vier Dienste plus neu Proton, je ein `<details>` in einer benannten Region, zugeklappt). |
| 2026-09-26 | EH-3 | `channelHealth` (`lib/domain/channel-health.ts`) nach der Tabelle in §3.5. Abweichung: Im Zustand „Eingerichtet“ geht der Hinweis des letzten Laufs der Warnung „Keine Stichwörter“ vor, weil er bei Telegram die Chat-ID für die Freigabe trägt und während der Einrichtung meist noch keine Stichwörter da sind; „Stichwörter: keine“ steht weiter in der Meta-Zeile. „Wird abgerufen“ nutzt den Ton `brand` (Fläche) statt eines Marke-Umrisses, weil die Lozenge keinen eigenen Umriss-Ton hat. |
| 2026-09-26 | EH-3 | `ChannelCard` (article mit dem Namen der `h4`): Hauptaktion nach `channelHealth.action` („Jetzt abrufen“, „Aus dem Postfach wählen“, „Fortsetzen“, „Einrichtung fortsetzen“, während des Abrufs gesperrt mit `aria-busy`), „Bearbeiten“, Menü „…“ auf dem `Popover` (Art `menu`: „Pausieren“/„Fortsetzen“, „Einrichtung ansehen“, `separator`, „Löschen …“). Jede Aktion trägt den Namen der Verbindung als versteckten Zusatz („Jetzt abrufen: Gmail privat“). Fehler einer Aktion stehen als kompakte `SectionMessage` (Fehler, `live`) an der Karte. Die Flags heißen jetzt „‹Name› ist pausiert.“ und „‹Name› läuft wieder.“, das Ergebnis `disabled` von „Jetzt abrufen“ „ist pausiert“. |
| 2026-09-26 | EH-3 | `ChannelEditModal` (Modal M „‹Name› bearbeiten“, Fuß „Schließen“) mit `KeywordEditor`, Schalter, Variablennamen und „Einrichtung erneut ansehen“; das Modal schließt, bevor die Anleitung aufgeht (kein Dialog aus einem Dialog). Die Verbindung wird vor dem Schließen gelesen, weil der `{@const}` danach `null` wäre. `ConnectionCreateDialog` (Modal M „Verbindung anlegen“) ist das bisherige Formular, vorbelegt nach der Kachel (Web.de und Gmail über `withMailProvider`, daher heißt eine neue Web.de-Verbindung „Web.de“ statt „Postfach (IMAP)“); es schließt nach dem Anlegen. Beide stehen in der Größenliste von `no-own-dialogs.test.ts`, deren Import-Regel jetzt auch `../overlay/Modal.svelte` erlaubt. |
| 2026-09-26 | EH-3 | Übergang bis EH-5 bis EH-7: „Einrichtung fortsetzen“, „Einrichtung ansehen“ und „Anleitung“ (Proton) öffnen die zugeklappte Anleitung des Dienstes und setzen den Fokus auf ihre Zusammenfassung; „Einrichten“ im Katalog öffnet „Verbindung anlegen“. Die Karte „Dateien hereinziehen“ zeigt noch keine Zahl der Stichwörter je Art (die Seite lädt sie seit EH-1 nicht mehr), sondern verlinkt „Stichwörter bearbeiten“ und „Zum Eingang“. |
| 2026-09-26 | EH-3 | Bewusst angepasste Tests: `connections-page` (Karten statt Listeneinträgen: Lozenge statt „Zugangsdaten gesetzt.“, Menü statt Checkbox, Anlegen über Katalog und Modal, Stichwörter und Schalter im Modal, pausiertes Postfach mit „Fortsetzen“ statt gesperrtem „Aus dem Postfach wählen“, der wiederholte Neustart-Hinweis entfällt, neue Flag-Texte), `channels-view` (Bookmarklet jetzt `h4` unter „Selbst hereinbringen“), `no-own-dialogs` (Größen der zwei neuen Modals). Neu: `channel-health.test.ts`, `channels/channel-card.test.ts` (Karte, Modal, Katalog), Fälle für Aufbau, Anleitungen, Laden und „Wird abgerufen“. Manifest: BYL-E6-035 und BYL-E6-036 bestanden, BYL-E6-037 offen (manuell). |
| 2026-09-26 | EH-4 | `lib/guidance/command.ts`: Platzhalter als `{{name}}` mit `PlaceholderInfo` (`label`, `secret`); ein Platzhalter ohne Eintrag gilt als geheim, damit nichts aus Versehen sichtbar wird. `renderCommand` gibt `display` (geheim maskiert mit `SECRET_MASK`) und `copy` (echter Wert) zurück; ohne Wert steht in beiden „‹Label›“. `setxValueError` liefert `{ level, message }` (Fehler bei `"`, Umbruch, > 1024 Zeichen; Warnung bei `%NAME%`). `normalizeValue('gmail' | 'other', …)`. Dazu `lib/guidance/links.ts` mit `isHttpsUrl`. |
| 2026-09-26 | EH-4 | `CodeBlock`: `figure` mit `figcaption` (Beschriftung und „Kopieren“ als `.button-subtle` mit `aria-label` „‹Beschriftung› kopieren“), `pre` als benannte Region mit `tabindex="0"` (das `svelte-ignore` für `a11y_no_noninteractive_tabindex` steht bewusst dort), Props `values` (für EH-5) und `wrap` (Bookmarklet). Erfolg: 2 s „Kopiert“ mit Häkchen und eine versteckte `role="status"`; Fehler oder fehlende API: Code markiert (`Selection`) und kompakte Info „… mit Strg+C kopieren“. `lib/clipboard.ts` bekommt `writeClipboardText` (Ergebnis `true`/`false`, der Text wird nie geloggt). `ExternalLink` verlinkt nur `https:`, sonst bleibt der Text ohne Link. |
| 2026-09-26 | EH-4 | `BookmarkletCard` ersetzt den Abschnitt in `ChannelsView` (die `textarea` und „Code kopieren“ entfallen): Kopf mit Symbol und Satz, eigene Inline-SVG (Browserfenster mit Lesezeichenleiste und freiem Platz, Knopf, gleitende Kopie im Bogen), ziehbarer Knopf als Pille mit Griff und `aria-describedby`, Hinweis beim Klick, „Loslassen auf der Lesezeichenleiste“ während des Ziehens, drei Schritte, `<details>` „Ohne Maus einrichten“ mit `CodeBlock` und die Grenzen als kompakte Info. Animation `glide` 1,8 s mit `--motion-ease`: zweimal beim ersten Sichtbarwerden (`IntersectionObserver`, danach getrennt), einmal bei Hover oder Fokus (`{#key}` startet sie neu, `animationend` setzt zurück). Reduzierte Bewegung doppelt: `matchMedia` blendet die Kopie aus und zeigt den gestrichelten Pfeil, und eine eigene CSS-Media-Query tut dasselbe ohne Skript (die `data-overlay`-Regel greift hier nicht, es ist kein Overlay). Ohne `IntersectionObserver` bleibt die Illustration still. |
| 2026-09-26 | EH-4 | Bewusst angepasste Tests: `channels-view.test.ts` heißt jetzt `channels/bookmarklet-card.test.ts` (per `git mv`); die bisherigen vier Fälle prüfen dieselben Zusagen an der Karte (Knopf statt Link-Chip, Code im `CodeBlock` statt in der `textarea`, Name des Kopierknopfs „Code des Bookmarklets kopieren“, Hinweis beim Klick als Info statt Statuszeile). Neu: `command.test.ts`, `guidance/code-block.test.ts` (Code-Block und externer Link), Fälle für Animation, reduzierte Bewegung und Ziehen, `writeClipboardText` in `clipboard.test.ts`. Manifest: BYL-E6-038 und BYL-E6-039 bestanden, BYL-E6-040 offen (manuell); die E4-Fälle zum Bookmarklet verweisen auf die neue Testdatei. |

## 8. Status

| Paket | Stand |
|---|---|
| EH-0 | gemergt (#58) |
| EH-1 | gemergt (#59) |
| EH-2 | gemergt (#60) |
| EH-3 | gemergt (#61) |
| EH-4 | umgesetzt (dieser PR) |
| EH-5 bis EH-13 | geplant |

## Quellen (nur Muster, keine Assets)

- Atlassian Design System:
  - [Section message](https://atlassian.design/components/section-message/usage)
  - [Inline message](https://atlassian.design/components/inline-message/usage)
  - [Empty state](https://atlassian.design/components/empty-state/usage)
  - [Progress tracker](https://atlassian.design/components/progress-tracker/usage)
  - [Onboarding/Spotlight](https://atlassian.design/components/onboarding/usage)
  - [Code block](https://atlassian.design/components/code/code-block/usage)
  - [Lozenge](https://atlassian.design/components/lozenge/usage)
- Jira Cloud:
  - [Project settings sidebar](https://support.atlassian.com/jira-service-management-cloud/docs/get-to-know-the-project-settings-sidebar/)
  - [Navigation](https://developer.atlassian.com/cloud/jira/platform/navigation/)
  - [View content in a side panel](https://support.atlassian.com/jira-software-cloud/docs/view-content-in-a-side-panel/)
- WAI-ARIA Authoring Practices: Tabs (manuelle Aktivierung), Breadcrumb; `aria-current="step"` nach WAI-ARIA 1.2
- Task-Board des Nutzers (`tasks_dashboard.html`): nur Aufbau des Einstellungsdialogs und des Kopfzeilen-Knopfs angesehen; keine Arbeitsdaten geöffnet
