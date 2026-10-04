# ADR-0060: Einheitliche Eingabeelemente – ein zentraler Stil für Felder, Auswahl und Knöpfe; Einstellungen in Gruppen

- **Status:** Angenommen und umgesetzt (UI-1)
- **Datum:** 2026-10-04
- **Entscheidung durch:** Nutzer (Ziel: Alle Eingabe- und Auswahlelemente sehen im ganzen Projekt gleich aus, etwa die Felder unter „Konto → Anzeigename“, die nur rudimentär am Stil der App teilnahmen; „Konto“ und „Konten“ liegen in den Einstellungen nicht mehr getrennt), Advisor (Umfang, Regeln für Mobil und Rückfall-Test), Executor (Bestandsaufnahme, Werte, Einzelheiten)
- **Bezug:** [ADR-0009](0009-fehlerfarbe.md) (Fehlerfarbe, kein Rot für Löschen), [ADR-0025](0025-ui-konsistenz-overlay-system.md) §2 (gemeinsame Knöpfe), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) §1 (Einstellungsbereich, Nachtrag dort), [ADR-0029](0029-glas-materialien.md) §9 (Controls im macOS-Stil), [ADR-0056](0056-konten-und-verwalter.md) §3 (Seiten der Konten, Nachtrag dort), [ADR-0057](0057-kontextabhaengige-oberflaeche.md) (Matrix der Verwalter-Seiten)
- **Paket:** UI-1 „Einheitliche Eingabeelemente“. Die Kennung ist neu vergeben: Die Pakete UI-0 bis UI-9 des Overlay-Systems ([Plan](../plan/e6-ui.md)) stehen im Test-Manifest gesammelt unter der ID „UI“; die Paket-ID „UI-1“ war dort frei.

## Kontext

`base.css` zeichnete Kästchen, Optionsfelder und Schalter (seit Paket A und G-3), die Knöpfe `.button-*` und das Suchfeld zentral, aber keine Textfelder, Auswahllisten und Textbereiche. Die Bestandsaufnahme über `web/src/**/*.svelte` (ohne Test-Hüllen) fand 77 solcher Felder:

| Element | Fundstellen | eigener Stil der Komponente | ohne Stil in der eigenen Datei |
|---|---|---|---|
| `input` text | 32 | 23 | 9 |
| `input` password | 7 | 1 | 6 |
| `input` email | 2 | 1 | 1 |
| `input` number | 5 | 3 | 2 |
| `input` date | 8 | 5 | 3 |
| `input` time | 1 | 1 | 0 |
| `input` url | 1 | 1 | 0 |
| `input` mit Typ aus einer Variablen (Passwort/Text) | 2 | 2 | 0 |
| `select` | 14 | 9 | 5 |
| `textarea` | 5 | 5 | 0 |
| **Summe** | **77** | **51** | **26** |

Dazu 8 Suchfelder (`.search-field`), 52 Kästchen, 24 Optionsfelder (eines davon unsichtbar im `ChipGroup`), 16 Schalter und ein verborgenes Dateifeld (`DropZone`), die schon zentral bzw. bewusst unsichtbar waren. `input` vom Typ `datetime-local`, `range` und `color` nutzt die App nicht.

- Die 51 Felder mit eigenem Stil wichen voneinander ab: Linie in `--color-text-muted` oder `--color-line`, Innenabstand 0,25 bis 0,625rem, Schrift geerbt oder 0,8125 bis 0,875rem, eigene Zustände „gesperrt“ und „nur lesen“ in zwei Komponenten, sonst keine.
- Die 26 Felder ohne eigenen Stil zeigten das Feld des Browsers, darunter alle Felder der Seiten „Konto“, „Haushalt“, „Konten“, „Sicherung“ und „Sicherheit“ und die Kopie im Dialog „Duplizieren“; Auswahllisten und Textbereiche erbten nicht einmal die Schrift der App. `ProjectSelect`, `StatusSelect`, `PrioritySelect`, `DueInput` und `DueEditor` bekamen ihr Aussehen je nach Ort per `:global(…)` vom Elternteil oder gar nicht.
- Knöpfe: neben den gemeinsamen Varianten (`.button-primary` 77×, `.button-secondary` 127×, `.button-subtle` 73×, `.button-icon` 32×) bauten 15 Komponenten kleine umrandete Knöpfe selbst nach (`.small`, `.small-primary`, `.retry`, `.text-button`, `.reset`, `.pick`, `.more`, `.send`, `.edit`), mit eigenen Zuständen.
- Einstellungen: 13 Seiten in einer Liste; „Konto“ (eigenes Konto) und „Konten“ (alle Konten, nur Verwalter) standen getrennt durch „Haushalt“ und waren leicht zu verwechseln.

## Entscheidung

### 1. Felder bekommen ihr Aussehen nur aus `base.css`

- **Welche:** `input` jedes Typs außer `checkbox`, `radio`, `hidden`, `file`, `range`, `color` und den Knopf-Typen, dazu `select` und `textarea`. Der Selektor steht in `:where(…)` und hat damit die Spezifität 0: Komponenten geben einem Feld weiter Platz und Breite (`width`, `flex`, `grid`), das Suchfeld behält sein eigenes Aussehen, und kein `!important` ist nötig.
- **Normal:** Fläche `--color-surface`, Linie 1px `--color-text-muted` (3 : 1 gegen Fläche und Seite, WCAG 1.4.11), Radius `--radius-control`, Mindesthöhe `--control-height-m` (wie Sekundärknopf, Segment und Suchfeld), Innenabstand 0,25rem 0,5rem, Schrift der App in `--font-size-body`, Text `--color-text`. Textbereiche mit 0,375rem, Zeilenhöhe 1,5 und `resize: vertical`.
- **Zustände:** Zeigen mit der Maus färbt die Linie in `--color-brand` (wie bei Kästchen und Optionsfeldern), nie bei gesperrten, schreibgeschützten oder ungültigen Feldern. Der Fokus ist der Ring von `:focus-visible` (2px `--color-brand-text`, ADR-0029 §5). Gesperrt (`disabled`, `aria-disabled`): gedämpfter Text auf `--color-bg`, Linie `--color-line`, Zeiger „nicht erlaubt“; in einem beschäftigten Bereich gewinnt der Warte-Zeiger nach ADR-0026 (Nachtrag 2026-09-30). Nur lesen (`readonly`): lesbarer Text auf `--color-bg` mit leiser Linie, damit es sich von „gesperrt“ unterscheidet. Ungültig: die rote Linie von `[aria-invalid='true']` und der Fehlertext per `aria-describedby` (ADR-0009, unverändert). Platzhalter in `--color-text-muted` mit voller Deckkraft.
- **Autofill:** Chrome, Edge und Safari malen ausgefüllte Felder mit `!important` gelb bzw. blau, Firefox mit einem Filter. Ein Schatten nach innen in `--color-surface` (`inset 0 0 0 100vmax`) deckt das ab, `-webkit-text-fill-color` und `caret-color` halten die Textfarbe, `filter: none` gilt für Firefox. Das ist kein Schatten im Sinne von ADR-0029 §4; die zwei Prüfungen dazu (`base-css.test.ts`, `glass-allowlist.test.ts`) nennen ihn als einzige Ausnahme.
- **Auswahllisten** behalten den Pfeil des Systems; er und Datums- und Zeitfelder folgen `color-scheme` der vier Modus-Blöcke. Ein eigener Pfeil bräuchte ein Bild mit Farbwert außerhalb von `tokens.css`.
- **Alle Themes:** Nur Tokens, keine Farbwerte; hell, dunkel und jede Akzentfarbe gelten damit von selbst.

### 2. Touch-Bildschirme

In `@media (pointer: coarse)` haben Felder die Schriftgröße `--font-size-field-touch` (1rem, 16px: darunter zoomt iOS beim Fokus in die Seite) und Felder, Knöpfe mit Text und Labels von Kästchen und Optionsfeldern die Mindesthöhe `--control-height-touch` (2,75rem, 44px nach Apple HIG). Beide Tokens sind neu und stehen nur in `:root` (Liste `NON_COLOR_TOKENS` in `tokens.test.ts`); mit den vorhandenen Größen ließ sich keins der beiden Maße ausdrücken. Symbolknöpfe behalten ihre Größe, weil die Spalten der Tabellen mit ihr rechnen (ADR-0030). Horizontaler Überlauf bleibt durch die Regeln des Fixes „Layout-Überlauf“ ausgeschlossen (`no-control-overflow.test.ts`, unverändert).

### 3. `Field` für Label, Hilfe und Fehler

`components/form/Field.svelte` legt ein Feld einheitlich an: Label über dem Feld (Schrift `--font-size-control`, Gewicht 500, gedämpft, wie bisher in den Dialogen), darunter erst der Fehler mit Symbol, dann die Hilfe in `--font-size-small`, Abstand 0,25rem, Breite höchstens 32rem; `width="auto"` lässt Datum, Zahl und Code in ihrer eigenen Breite. Das Feld verknüpft alles: `for`/`id` (erzeugt oder vorgegeben), `aria-describedby` mit Fehler vor Hilfe und weiteren IDs, `aria-invalid` nur mit Fehler. Das Control bleibt ein natives Element des Aufrufers im Snippet `control`, das die Attribute verteilt (`<input {...field} bind:value />`); Binden, Fokus und Ereignisse bleiben, wo sie waren. Hilfe kann Text oder ein Snippet mit Links sein.

- **Regel für den Aufbau:** Textfelder, Auswahllisten und Textbereiche haben ihr Label darüber. Neben dem Control steht der Name nur bei Schaltern (Name links, Schalter rechts, ADR-0029 G-5) und bei Kästchen und Optionsfeldern (Kasten links, Name rechts).
- **Keine eigenen Bausteine** `TextInput`, `Select`, `Checkbox`, `Switch`: Ihr Aussehen kommt schon zentral aus `base.css`, und eine Hülle um jedes native Element hätte Binden, `bind:this`, Ereignisse und `aria-*` in über 80 Dateien umgeleitet, ohne am Aussehen etwas zu ändern.
- `Field` nutzen die Seiten „Mein Konto“, „Haushalt“ (gründen, beitreten, umbenennen), „Konten verwalten“ (Konto anlegen), „Sicherung“ (Zielverzeichnis, Passphrase), „Sicherheit“ (zusätzliche Adressen), „Verbinden“ des Assistenten der Kanäle und der Zugangsschlüssel des eigenen Eingangs. Größere Formulare (Neues Ticket, Erfassen, Wiederholung, Assistenten der Ordner und Repositorys) behalten ihren Aufbau mit denselben Maßen; sie sind auf den nächsten Änderungen umzustellen.

### 4. Varianten

- `.input-mono` (Felder und Textbereiche) für Codes, Schlüssel und Pfade: Projekt-Code, Einladungscode, Wert der Zugangsdaten, Muster der Ordner und Repositorys. Nur die Schrift ändert sich.
- `.button-small` für enge Stellen: dieselben Varianten in `--control-height-s` mit `--font-size-control`.
- Eine Variante „Gefahr“ gibt es nicht: Destruktive Knöpfe sind nach ADR-0009 nicht rot.

### 5. Knöpfe angleichen

Die nachgebauten kleinen Knöpfe sind jetzt `button-secondary button-small` (bzw. `button-primary button-small` für „Speichern“, „Übernehmen“, „Kommentieren“), „Datei wählen“ und „Weitere laden“ `button-secondary`, „Titel bearbeiten“ `button-icon` mit `aria-label`. Eigene Zustände (`opacity: 0.6`, Zeiger) entfallen; gesperrt und beschäftigt zeichnet `base.css`. Spezialisierte Bedienelemente bleiben eigene Bausteine, weil sie keine Knöpfe im Sinn der Varianten sind: Chips, Segmente, Kacheln, Sortierköpfe, Stepper, Werkzeugleiste des Editors, Menüzeilen, Bereichs-Umschalter, Disclosure-Überschriften und der Öffner „Kommentar hinzufügen …“, der wie das leere Feld aussieht, das er öffnet.

### 6. Rückfall-Test

`web/src/lib/no-own-form-styles.test.ts` prüft statisch jede `.svelte`- und `.css`-Datei unter `web/src` außer `base.css`, `tokens.css` und `Field.svelte`:

- Keine Regel, die ein `input`, `select` oder `textarea` erreicht (über das Element, auch in `:global(…)`, `:is(…)`/`:where(…)`, oder über eine Klasse, die die Komponente einem solchen Element gibt), setzt ein Merkmal des Aussehens: Innenabstand, Hintergrund, Linie und Radius, Umriss, Schatten, Farbe, Schrift, Zeilenhöhe, Laufweite, Höhe, `appearance`, `accent-color`, Zeiger, Deckkraft oder Filter. Erlaubt bleiben Breite, Flex, Grid, Ränder, Position, `text-transform` und `text-align`.
- Kein `style=` und keine `style:`-Direktive an einem solchen Element.
- Ausnahmen stehen mit Begründung in der Liste des Tests, die nur schrumpfen darf (eine Ausnahme, die nicht mehr gebraucht wird, lässt ihn scheitern): die unsichtbaren Radios der Chips (`ChipGroup`), das Titelfeld an der Stelle der Überschrift (`EditableTitle`, Größe und Gewicht der Überschrift) und das Select im Filter-Chip „Projekt“ des `TicketPicker` (rahmenlos im Chip, auf Touch-Bildschirmen 16px).
- Dazu prüft er die zentralen Regeln in `base.css` (Werte, Zustände, Platzhalter, Autofill, Touch, Varianten) und `tokens.css`.

### 7. Übersichtsseite

`/einstellungen/hilfe/elemente` („Eingabeelemente“, Unterseite der Hilfe mit Brotkrumen „Einstellungen › Hilfe › Eingabeelemente“) zeigt jede Art von Feld, Auswahlliste, Textbereich, Kästchen, Optionsfeld, Schalter und Knopf in ihren Zuständen, damit der Stil an einer Stelle in jedem Modus und jeder Farbe geprüft werden kann. Die Hilfe verlinkt sie leise am Ende. Die Seite speichert und sendet nichts.

### 8. Einstellungen in Gruppen

| Gruppe | Seiten | Begründung |
|---|---|---|
| Eingang und Tickets | Kanäle, Datei-Importe, Tags, Tickets | Was die App hereinholt und wie Tickets geführt werden; Kanäle bleiben die erste Seite (`/einstellungen` leitet weiter dorthin). |
| Persönlich | Darstellung, Haushalt, Mein Konto | Was zur Person gehört: Aussehen auf diesem Gerät, die eigene Mitgliedschaft im Haushalt, das eigene Konto. |
| Verwaltung | Konten verwalten, Sicherheit, Sicherung, Speicher, System | Genau die Seiten des Verwalters (`ADMIN_ONLY`, ADR-0056 §7). |
| (ohne Überschrift, nach einer Linie) | Hilfe | Gilt für alles. |

- **„Mein Konto“ und „Konten verwalten“:** Die Seiten heißen jetzt so; „Mein Konto“ schließt „Persönlich“ ab, „Konten verwalten“ beginnt „Verwaltung“, sie stehen also direkt untereinander. Titel, Überschrift, Brotkrumen, Hilfe, die Hinweise auf beiden Seiten und der Verweis auf der Seite „Sicherheit“ nennen die neuen Namen.
- **Matrix von KOB-1 unverändert:** Am PC sieht der Verwalter alle Gruppen. Auf einem anderen Gerät steht „nur am PC“ einmal sichtbar an der Überschrift „Verwaltung“; jeder Link behält die Marke in seinem Namen für Screenreader („Konten verwalten nur am PC“). Für jedes andere Konto und solange der Kontext lädt, fehlt die Gruppe samt Überschrift. Per Adresse geöffnete Seiten zeigen weiter den Hinweis von ADR-0057.
- **Aufbau:** Jede Gruppe ist eine Liste, benannt durch ihre Überschrift (`aria-labelledby`). Ab 64rem stehen die Gruppen in der Glas-Karte untereinander (ADR-0029 G-6), schmaler je Gruppe eine umbrechende Linkzeile unter der Überschrift.
- **Adressen unverändert:** `/einstellungen/konto` und `/einstellungen/konten` bleiben, keine Weiterleitungen nötig.

## Grenzen

- Nicht im Umfang: die Browser-Erweiterung für WhatsApp Web (eigenes Paket, eigene Styles), `offline.html` und `error.html` (Systemfarben ohne Tokens, bewusst ohne App-Styles) und die Verwaltung von PocketBase.
- Zwei Fehlertexte nennen weiter „Konto“ bzw. „Einstellungen → Konten“ (`self-password`, `validation_account_locked`): Sie stehen wortgleich im Hook `app/pb_hooks/lib/account-rules.js` (Paritätstest), und eine Änderung dort bräuchte einen Neustart. Folgepunkt bei der nächsten Änderung der Hooks der Konten.
- Hover, Fokus, Autofill und die Größen auf Touch-Bildschirmen kann jsdom nicht rechnen; sie sind manuelle Fälle des Test-Manifests.

## Folgen

- Neue Formulare nutzen `Field` und native Elemente ohne eigenes Aussehen; der Rückfall-Test fängt Abweichungen.
- `CLAUDE.md` §8 nennt die Regel; die Zahl der alten Schriftgrößen in `no-own-font-sizes.test.ts` sinkt von 138 auf 130.
