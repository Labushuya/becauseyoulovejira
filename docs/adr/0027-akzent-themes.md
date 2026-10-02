# ADR-0027: Akzent-Themes (Petrol, Rubin, Smaragd, Kupfer; ursprünglich mit Purpur und Honig)

- **Status:** Angenommen; geändert durch den Nachtrag vom 2026-09-27 (Purpur entfällt, Honig wird Kupfer, Rubin und Smaragd dunkler). Die Abschnitte 1 bis 6 beschreiben den Stand vom 2026-09-26; wo der Nachtrag abweicht, gilt er. §1 („keine Verläufe, keine Glas-Optik, keine Schatten“) ist durch [ADR-0029](0029-glas-materialien.md) teilweise ersetzt (zweiter Nachtrag vom 2026-09-27). Nachtrag vom 2026-10-02: Palette für Projekte und Tickets neben dem Akzent ([ADR-0052](0052-farben-fuer-projekte-und-tickets.md)).
- **Datum:** 2026-09-26
- **Entscheidung durch:** Nutzer (vier weitere Akzentfarben, Petrol bleibt Standard, 2026-09-26), Advisor (Regel „genau eine Akzentfarbe je Theme“, Anpassung von CLAUDE.md §8 und Nachtrag zu ADR-0010), Executor (Farbwerte, Lösung der Rubin-/Fehlerfarben-Frage)
- **Ergänzt:** [ADR-0009](0009-fehlerfarbe.md) (Fehlerfarbe, siehe dort den Nachtrag), [ADR-0010](0010-layout-nach-task-board.md) §3 (siehe dort den Nachtrag), [ADR-0025](0025-ui-konsistenz-overlay-system.md) §10 (Hell/Dunkel bleibt unabhängig)

## Kontext

Bisher gilt „Petrol ist die einzige Akzentfarbe“ (CLAUDE.md §8, ADR-0010 §3, ADR-0025 §1). Der Nutzer wünscht zusätzlich vier wählbare Akzentfarben, jede im hellen und im dunklen Modus:

1. **Rubin:** ein schönes Rubinrot.
2. **Purpur:** ein dunkles Purpur.
3. **Smaragd:** ein kräftiges Grün, das sich sichtbar vom Blaugrün des Petrol abhebt.
4. **Honig:** ein Honig-Gold-Gelb.

Petrol bleibt Standard. Der Modus (Hell, Dunkel, Wie System) bleibt davon unabhängig. Es gibt also 5 × 2 Farbsätze.

Dabei gibt es drei Schwierigkeiten:

- Gelb auf Weiß erreicht kein WCAG AA.
- Ein Rubin liegt nahe am Fehlerrot aus ADR-0009.
- Die Pille „Wartet“ ist bernsteinfarben und träfe im Honig-Theme den Akzent.

## Entscheidung

### 1. Regel

Aus „Petrol ist die einzige Akzentfarbe“ wird **„genau eine Akzentfarbe je Theme“**. Innerhalb eines Themes gelten alle bisherigen Regeln unverändert:

- keine zweite Akzentfarbe, keine Signalfarben
- keine Verläufe, keine Glas-Optik, keine Schatten
- Rot nur für echte Fehler, Fehler immer mit Icon und Text
- Farbe nie als einziges Merkmal

Neutrale Flächen, Linien und Text sind in allen Themes gleich, ebenso der Schleier `--color-blanket`.

### 2. Tokens

`web/src/lib/styles/tokens.css` bleibt die einzige Stelle mit Farbwerten.

- Die vier Modus-Blöcke (hell, dunkel per Media Query, erzwungen hell, erzwungen dunkel) tragen weiter alle Farb-Tokens, mit Petrol als Akzent.
- Jedes weitere Theme hat dieselben vier Blöcke mit dem Attribut `data-accent` am Wurzelelement:
  - `:root[data-accent='x']`
  - `:root[data-accent='x']:not([data-theme='light'])` in der Media Query
  - `:root[data-accent='x'][data-theme='light']`
  - `:root[data-accent='x'][data-theme='dark']`

  Diese Selektoren haben je ein Attribut mehr als die Modus-Blöcke. Sie gewinnen also in jedem Modus, unabhängig von der Reihenfolge.
- Die **Akzent-Tokens** setzt jedes Theme vollständig, und nur diese:
  - `--color-brand`: Knöpfe, Icons, Fokusring, Rahmen gewählter Chips und Kacheln, Linie links an gewählten Zeilen, „Weiter“ in der Tour
  - `--color-brand-text`: Links und Akzent als Text
  - `--color-brand-soft-bg`: gewählte Zeile, gedrückte Kachel, aktiver Chip, Auswahl im Menü
  - `--color-brand-soft-text`: Text darauf
  - `--color-on-brand`: Text auf dem Akzent
  - `--status-open-text` und `--status-open-border` (Pille „Offen“)
  - `--status-in-progress-bg` und `--status-in-progress-text` (Pille „In Arbeit“)
  - `--color-danger` und `--color-danger-soft-bg`, damit ein Theme Fehler vom Akzent absetzen kann (Rubin)
  - `--status-waiting-bg`, `--status-waiting-text` und `--status-waiting-border`, damit „Wartet“ vom Akzent unterscheidbar bleibt (Honig)
- Eigene Tokens für Hover und „Aktiv“ gibt es nicht und kommen auch nicht dazu. Hover arbeitet mit Rahmen in `--color-brand` oder mit neutralen Flächen, gewählte Zustände mit `--color-brand-soft-bg`. Einen eigenen Auswahl-Hintergrund für markierten Text (`::selection`) setzt die App nicht, dort gilt die Farbe des Browsers.

### 3. Farbwerte

| Theme | Modus | Akzent `--color-brand` | Text auf Akzent | Akzent als Text | Fläche / Text darauf |
|---|---|---|---|---|---|
| Petrol | hell | `#07838F` | `#FFFFFF` | `#0A737B` | `#DDF0F2` / `#055C65` |
| Petrol | dunkel | `#07838F` | `#FFFFFF` | `#4BB8C2` | `#123A3F` / `#9FDCE2` |
| Rubin | hell | `#A0174F` | `#FFFFFF` | `#A0174F` | `#FBE7EF` / `#7A1040` |
| Rubin | dunkel | `#CA2B70` | `#FFFFFF` | `#F17EB4` | `#3D1628` / `#F8BFD8` |
| Purpur | hell | `#6A2C91` | `#FFFFFF` | `#6A2C91` | `#F1E8F7` / `#4E1F6E` |
| Purpur | dunkel | `#9155BE` | `#FFFFFF` | `#C9A2EC` | `#2C1E3D` / `#DCC4F2` |
| Smaragd | hell | `#13854A` | `#FFFFFF` | `#11783E` | `#DDF3E5` / `#0B5A31` |
| Smaragd | dunkel | `#15874A` | `#FFFFFF` | `#4CC585` | `#133A25` / `#A3E3BF` |
| Honig | hell | `#8A5A00` | `#FFFFFF` | `#8A5A00` | `#FBE9B5` / `#5E3E00` |
| Honig | dunkel | `#E0A93A` | `#1A1405` | `#F0C35A` | `#3A2E12` / `#F5D98F` |

- **Petrol, hell:** Als Text wird Petrol um eine Stufe dunkler, `#0A737B` statt `#07838F`. `#07838F` erreicht auf dem Hintergrund `#F5F8F8` nur 4,23 : 1 und auf der Akzentfläche nur 3,83 : 1. Links und die Pille „Offen“ nutzen das Token, der Knopf bleibt `#07838F`.
- **Honig, hell:** Text, Links und Knöpfe sind ein tiefes Bernsteinbraun (`#8A5A00`). Gold erscheint nur als Fläche unter dunklem Text (`#FBE9B5` mit `#5E3E00`). Im dunklen Modus ist der Akzent ein warmes Gold, der Text auf dem Akzent ist dunkel.
- **Smaragd:** HSL-Farbton etwa 148°, Petrol etwa 185°. Der Abstand beträgt ΔE2000 25,0 (hell) und 25,4 (dunkel), als Text 23,4 bzw. 23,5.
- **Rubin und Fehlerfarbe:** siehe Abschnitt 4.
- **„Wartet“ im Honig-Theme:** Die Pille wird schiefergrau-blau statt bernsteinfarben: hell `#E8ECF4` mit `#3C4A66`, dunkel `#232D40` mit `#B9C6DF`. In allen anderen Themes bleibt sie wie in CLAUDE.md §8.
- **Weitere Pillen:** Keine andere Pille kollidiert mit einem Akzent. „Erledigt“ ist grau, nicht grün, und bleibt deshalb auch im Smaragd-Theme eindeutig. „Backlog“ ist ein neutraler Umriss.

### 4. Rubin und Fehlerfarbe

Ein Rubin mit brauchbarer Helligkeit erreicht gegen das Fehlerrot `#A13A40` höchstens etwa ΔE2000 18 und bleibt damit verwechselbar. Das zeigt eine Rastersuche über Farbton 325–355°, Sättigung 50–95 % und Helligkeit 15–50 %. Ab ΔE 20 bleiben nur fast schwarze Weinrottöne oder ein greller Fuchsia übrig, beides kein Rubin.

Deshalb gilt:

- **Der Rubin wird karminrot mit leichtem Magentastich:** hell `#A0174F` (HSL etwa 335°), dunkel `#CA2B70`, als Text `#F17EB4`.
- **Nur im Rubin-Theme** rückt die Fehlerfarbe Richtung Ziegelrot:
  - hell: `--color-danger` `#A7472A`, `--color-danger-soft-bg` `#F9ECE6`
  - dunkel: `--color-danger` `#E28E78`, `--color-danger-soft-bg` `#3B2119`

  Die Töne bleiben entsättigt wie in ADR-0009. Sie sind kein Signalrot und kein Bernstein, der Abstand zu „Wartet“ beträgt ΔE 17,8 (hell) bzw. 24,4 (dunkel).
- **Gemessene Abstände im Rubin-Theme (ΔE2000):**
  - hell: Akzent zu Fehler 22,4, Akzent als Text zu Fehler 22,4, Text auf der Akzentfläche zu Fehler 25,6
  - dunkel: 28,8, 22,4 und 21,8
- In allen anderen Themes gelten die Fehlerfarben aus ADR-0009 unverändert. Die kleinsten Abstände zum Fehler liegen dort bei 21,1 (Purpur dunkel, Text auf der Akzentfläche).
- Fehler tragen in jedem Theme weiterhin Icon und Text (`.alert-error` mit Linie links, `aria-invalid` mit Fehlertext). Die Farbe ist nie das einzige Merkmal.

### 5. Kontrast (WCAG AA)

`tokens.test.ts` prüft alle 5 Themes × 4 Varianten (hell, dunkel, erzwungen hell, erzwungen dunkel).

Text (mindestens 4,5 : 1):

- Text und gedämpfter Text auf Fläche, Hintergrund und Akzentfläche
- Akzent als Text auf Fläche, Hintergrund und Akzentfläche
- Text auf der Akzentfläche
- Text auf dem Akzent
- Fehler auf Fläche, Hintergrund und Fehlerfläche
- die Texte der fünf Status-Pillen auf ihrer Fläche

UI-Elemente (mindestens 3 : 1):

- Akzent (Fokusring, Rahmen, Icons) gegen Fläche und Hintergrund
- Rahmen der Pille „Offen“ gegen die Fläche

Kleinste Werte je Theme:

| Theme | Modus | Text auf Akzent | Akzent als Text auf Fläche / Hintergrund / Akzentfläche | Text auf Akzentfläche | Akzent gegen Fläche / Hintergrund |
|---|---|---|---|---|---|
| Petrol | hell | 4,51 | 5,60 / 5,24 / 4,75 | 6,54 | 4,51 / 4,23 |
| Petrol | dunkel | 4,51 | 7,08 / 7,85 / 5,25 | 8,11 | 3,68 / 4,09 |
| Rubin | hell | 7,69 | 7,69 / 7,20 / 6,51 | 9,00 | 7,69 / 7,20 |
| Rubin | dunkel | 5,13 | 6,64 / 7,36 / 6,24 | 10,00 | 3,24 / 3,59 |
| Purpur | hell | 8,82 | 8,82 / 8,26 / 7,40 | 10,10 | 8,82 / 8,26 |
| Purpur | dunkel | 4,94 | 7,81 / 8,66 / 7,25 | 9,72 | 3,36 / 3,73 |
| Smaragd | hell | 4,69 | 5,56 / 5,20 / 4,77 | 7,15 | 4,69 / 4,39 |
| Smaragd | dunkel | 4,57 | 7,63 / 8,46 / 5,80 | 8,61 | 3,64 / 4,04 |
| Honig | hell | 5,93 | 5,93 / 5,55 / 4,92 | 8,05 | 5,93 / 5,55 |
| Honig | dunkel | 8,64 | 10,02 / 11,12 / 8,01 | 9,63 | 7,84 / 8,70 |

Der Test prüft außerdem diese Abstände (ΔE2000):

- Akzent, Akzent als Text und Text auf der Akzentfläche jedes Themes zu seiner Fehlerfarbe: mindestens 20
- Fehler zu „Wartet“: mindestens 15
- „Wartet“ zu „In Arbeit“: Text mindestens 20, Fläche mindestens 10
- Smaragd zu Petrol: mindestens 20, dazu der Farbton (Smaragd 140–160°, Petrol 180–190°)
- je zwei Themes untereinander: mindestens 20

Die Rechnung steht in `web/src/lib/test/color-math.ts` und ist gegen die Referenzpaare von Sharma, Wu und Dalal (2005) getestet.

### 6. Auswahl und Speicherung

- **Wahl:** Unter „Einstellungen → Darstellung“ gibt es eine Radiogruppe „Farbe“ mit Vorschaukacheln (Farbfeld und Name). Im Kopfzeilen-Menü „Darstellung“ gibt es einen zweiten Abschnitt „Farbe“ (`menuitemradio`). Beide lesen aus derselben Liste und demselben Store.
- **Speicherung:** Die Wahl steht nur lokal in `localStorage` unter `byl-accent`, wie `byl-theme` (ADR-0025 §10) und nicht pro Nutzer bis E7.
  - Gespeichert werden nur `rubin`, `purpur`, `smaragd` und `honig`.
  - „Petrol“ entfernt den Schlüssel und das Attribut.
  - Ein `storage`-Listener gleicht andere Tabs ab.
- **FOUC-Schutz:** Das Inline-Skript in `app.html` setzt `data-accent` vor dem ersten Rendern. Es prüft den Wert gegen dieselbe Allowlist und fängt Fehler des Speichers ab.

## Alternativen

- **Weiter nur Petrol:** Das widerspricht dem Nutzerwunsch. Verworfen.
- **Rubin rein über den Farbton vom Fehler trennen, ohne das Fehler-Token anzufassen:** Das erreicht ΔE 20 nur mit Fuchsia oder fast Schwarz (Abschnitt 4). Verworfen.
- **Kräftiges Signalrot als Fehlerfarbe im Rubin-Theme:** Das widerspricht ADR-0009 (zurückhaltende Palette). Verworfen.
- **Gold als Knopffarbe im hellen Honig-Modus mit dunklem Text:** Das wäre technisch AA-fähig. Aber goldene Fokusringe und Rahmen erreichen auf Weiß keine 3 : 1, und Links in Gold sind nicht lesbar. Verworfen.
- **Eigene Hover-, Aktiv- und Auswahl-Tokens:** Die App nutzt sie nicht (Abschnitt 2). Neue Tokens auf Vorrat widersprechen CLAUDE.md §10. Verworfen.
- **Akzentfarben per `color-mix()` oder aus Variablen ableiten:** Das würde die Kontrastprüfung im Test verschleiern, und die Werte stünden nicht mehr lesbar in `tokens.css`. Verworfen.

## Konsequenzen

- `tokens.css` wächst um 16 Blöcke mit je 14 Tokens. `tokens.test.ts` hält die Blöcke vollständig und gleich, und der Kontrast wird je Theme geprüft.
- Eine neue Akzentfarbe braucht vier Blöcke, einen Eintrag in der Allowlist von Store und Boot-Skript und besteht die Tests unverändert. Eine neue akzentabhängige Farbe braucht ein Token in allen Themes.
- CLAUDE.md §8 formuliert die Regel neu und führt die Tabelle der Themes. ADR-0009 und ADR-0010 bekommen je einen Nachtrag.
- Die Sichtprüfung aller Themes in beiden Modi steht im Test-Manifest als manueller Fall.

## Nachtrag (2026-09-26): Umsetzung der Auswahl

Umgesetzt im zweiten PR nach den Tokens.

- **Store:** `web/src/lib/accent.svelte.ts` enthält `ACCENT_THEMES`, `STORED_ACCENTS`, `ACCENT_LABELS`, `ACCENT_DESCRIPTIONS` und `AccentStore`, nach dem Muster von `theme.svelte.ts`. `tokens.test.ts` liest die Themes aus diesem Modul, so können Store und `tokens.css` nicht auseinanderlaufen.
- **Farbfelder:** Die Vorschau zeigt jedes Theme in seiner eigenen Farbe, unabhängig vom gewählten Theme. Dafür tragen die vier Modus-Blöcke fünf Tokens `--swatch-petrol` bis `--swatch-honig`, jeweils mit dem Akzent des Themes in diesem Modus. Der Test prüft die Gleichheit mit `--color-brand`. So bleiben alle Farbwerte in `tokens.css`. Die Felder sind dekorativ (`aria-hidden`), der Name steht als Text daneben.
- **Menü:** Der Knopf heißt weiter nach dem Modus („Darstellung: …“). Die Farbe steht im Menü an Häkchen und Schriftgewicht.
- **Boot-Skript:** Die Farbe steht in einem eigenen `try`. Scheitert die Übernahme von `td-theme`, kommt die Farbe trotzdem an.

## Nachtrag (2026-09-27): Purpur entfällt, Honig wird Kupfer, Rubin und Smaragd dunkler

Testfeedback des Nutzers (Paket A, Punkt 5). Entscheidung durch den Nutzer (Themes und Richtung der Farben), Executor (Farbwerte und Fehlerfarbe im Kupfer-Theme).

### Änderungen

- **Purpur** wird gestrichen. Ein gespeichertes `purpur` gilt als Petrol: `app.html` entfernt den Schlüssel vor dem ersten Rendern, `parseAccent` liest es als Petrol.
- **Rubin** behält seinen Farbton (etwa 337° statt 335°, also eine Spur Richtung Dunkelrot) und wird dunkler und edler. Im dunklen Modus lässt die Pflicht „Akzent gegen die Fläche mindestens 3 : 1“ nur wenig Spielraum; dort ist Rubin etwas dunkler und röter als zuvor.
- **Honig** wird **Kupfer**, ein edles Kupfer-Macchiato-Braun: hell ein tiefes Kupferbraun für Text und Knöpfe auf milchiger Macchiato-Fläche, dunkel ein warmes Kupfer auf Espresso mit dunklem Text darauf. Ein gespeichertes `honig` wird vor dem ersten Rendern zu `kupfer` umgeschrieben und sofort als Kupfer angezeigt, auch wenn der Speicher das Umschreiben ablehnt. Die Liste steht als `LEGACY_ACCENTS` in `accent.svelte.ts`; `theme-boot.test.ts` gleicht sie mit dem Boot-Skript ab.
- **Smaragd** wird deutlich dunkler, ein tiefes Smaragd- bis Flaschengrün (Farbton etwa 150°).
- **Fehlerfarbe im Kupfer-Theme:** Kupfer (Farbton etwa 22°) liegt so nah am Fehlerrot `#A13A40`, dass nur fast schwarze Brauntöne ΔE 20 erreichen (Rastersuche Farbton 18–30°, Sättigung 40–70 %, Helligkeit 22–34 %). Wie bei Rubin (Abschnitt 4) rückt deshalb nur in diesem Theme der Fehler weg vom Akzent, hier Richtung Karmin: hell `#A0334F` auf `#F9E8EC`, dunkel `#E58FAB` auf `#3B1E27`. Entsättigt wie in ADR-0009, mit Icon und Text wie überall. „Wartet“ bleibt im Kupfer-Theme schiefergrau-blau wie zuvor bei Honig.

### Farbwerte

| Theme | Modus | Akzent | Text auf Akzent | Akzent als Text | Fläche / Text darauf | Fehler / Fehlerfläche |
|---|---|---|---|---|---|---|
| Rubin | hell | `#86133F` | `#FFFFFF` | `#86133F` | `#F9E5EC` / `#640E2F` | `#A7472A` / `#F9ECE6` |
| Rubin | dunkel | `#C62A66` | `#FFFFFF` | `#ED7EB3` | `#3A1524` / `#F8BFD8` | `#E28E78` / `#3B2119` |
| Smaragd | hell | `#0A5C34` | `#FFFFFF` | `#0A5C34` | `#DCECE2` / `#063F23` | wie Petrol |
| Smaragd | dunkel | `#167A47` | `#FFFFFF` | `#62C286` | `#10301E` / `#A6DCBD` | wie Petrol |
| Kupfer | hell | `#8A4A24` | `#FFFFFF` | `#8A4A24` | `#F3E7DC` / `#5E3016` | `#A0334F` / `#F9E8EC` |
| Kupfer | dunkel | `#D38B5D` | `#1C120C` | `#E6A57B` | `#35251B` / `#F0CDB4` | `#E58FAB` / `#3B1E27` |

### Messwerte (WCAG-Kontrast und ΔE2000, geprüft in `tokens.test.ts`)

| Theme | Modus | Text auf Akzent | Akzent als Text auf Fläche / Hintergrund / Akzentfläche | Text auf Akzentfläche | Akzent gegen Fläche / Hintergrund | ΔE Akzent / als Text / Text auf Fläche zum Fehler |
|---|---|---|---|---|---|---|
| Rubin | hell | 9,64 | 9,64 / 9,03 / 8,01 | 10,60 | 9,64 / 9,03 | 22,8 / 22,8 / 25,8 |
| Rubin | dunkel | 5,35 | 6,52 / 7,24 / 6,27 | 10,24 | 3,11 / 3,45 | 28,4 / 22,3 / 21,8 |
| Smaragd | hell | 8,10 | 8,10 / 7,58 / 6,61 | 9,83 | 8,10 / 7,58 | 55,2 / 55,2 / 51,8 |
| Smaragd | dunkel | 5,37 | 7,59 / 8,42 / 6,55 | 9,29 | 3,10 / 3,43 | 56,4 / 51,4 / 44,3 |
| Kupfer | hell | 6,81 | 6,81 / 6,37 / 5,60 | 9,04 | 6,81 / 6,37 | 22,2 / 22,2 / 23,0 |
| Kupfer | dunkel | 6,68 | 7,95 / 8,81 / 7,01 | 9,85 | 6,04 / 6,69 | 26,2 / 25,3 / 25,5 |

Weitere Abstände (ΔE2000): Smaragd zu Petrol 25,9 (hell) und 23,9 (dunkel), als Text 21,5 und 23,1; Rubin zu Kupfer 25,5 und 34,5; alle anderen Paare über 40. Fehler zu „Wartet“: Rubin 17,8 / 24,4, Kupfer 30,6 / 27,4.

### Konsequenzen

- `tokens.css` hat drei statt vier Theme-Gruppen, die Farbfelder heißen `--swatch-petrol`, `--swatch-rubin`, `--swatch-smaragd` und `--swatch-kupfer`. `tokens.test.ts` prüft 4 Themes × 4 Varianten und zusätzlich, dass Rubin und Smaragd dunkler sind als zuvor, der Farbton von Rubin (330–345°) und Kupfer (15–30°) stimmt, Macchiato hell und Espresso dunkel ist und kein Purpur- oder Honig-Block übrig bleibt.
- ADR-0009 (Fehlerfarbe) und ADR-0010 (§3, „Wartet“) bekommen je einen Hinweis.

## Nachtrag (2026-09-27): Glas-Materialien nach ADR-0029

[ADR-0029](0029-glas-materialien.md) ersetzt in §1 die Aufzählung „keine Verläufe, keine Glas-Optik, keine Schatten“. Die übrigen Regeln von §1 und die Liste der Akzent-Tokens aus §2 bleiben **unverändert**:

- Materialien, Füllungen, Trennlinien und Schatten sind neutral und in allen Themes gleich; sie stehen nur in den vier Modus-Blöcken. Der Hintergrund-Verlauf nutzt die vorhandene Akzentfläche `--color-brand-soft-bg`. Es braucht **kein neues Akzent-Token**; geprüft für die vier Themes dieses Stands.
- `glass-contrast.test.ts` rechnet alle Themes aus `ACCENT_THEMES` × vier Modus-Blöcke × zwei Materialien gegen jede Farbe der Palette als Hintergrund; alle Texte erreichen 4,5 : 1.
- Der Fokusring wechselt auf `--color-brand-text`, weil `--color-brand` im Dunkelmodus auf Glas und auf dem Verlauf die 3 : 1 nicht sicher hält (Petrol, Rubin, Smaragd).

## Nachtrag (2026-10-02): Palette für Projekte und Tickets ([ADR-0052](0052-farben-fuer-projekte-und-tickets.md))

Mit den Farben für Projekte und Tickets gibt es neben dem einen Akzent eine **Palette von zehn Kategorie-Farben**. Sie ist kein zweiter Akzent: Sie gehört den Daten des Nutzers (welches Projekt, welches Ticket), nie der Bedienung, und erscheint nur als Streifen oder Punkt, nie als Fläche, Knopf, Rahmen eines Zustands oder Text. Die Regel „genau eine Akzentfarbe je Theme“ aus §1 bleibt damit unverändert; Rot bleibt den Fehlern (ADR-0009).

- **Tokens:** `--project-color-<schlüssel>` (`violett`, `indigo`, `blau`, `himmel`, `tuerkis`, `gruen`, `oliv`, `senf`, `braun`, `grau`) nur in den vier Modus-Blöcken, wie die neutralen Tokens; die Theme-Blöcke setzen weiter genau die Akzent-Tokens aus §2 (`tokens.test.ts` unverändert). Im Dunkeln sind die Töne heller.
- **Geprüft für alle Themes aus `ACCENT_THEMES` × vier Varianten** in `project-colors.test.ts`: jede Farbe mindestens 3 : 1 (WCAG 1.4.11) auf Fläche, Hintergrund, Akzentfläche des Themes und Glas (regular und thick über Seite und Verlauf, thick über dem Schleier); Abstand ΔE2000 ≥ 20 zur Fehlerfarbe des Themes wie die Akzente (§5); je zwei Farben ≥ 12 voneinander. `glass-contrast.test.ts` nimmt die zehn Farben als weitere Hintergründe unter Glas; alle Texte halten 4,5 : 1.
- **Abgrenzung zum Akzent:** Türkis ähnelt im Petrol-Theme dem Akzent. Deshalb sitzt der Streifen einer Zeile 3 px neben dem Akzentbalken der geöffneten Zeile statt an seiner Stelle, und der Kurzbalken in Auswahllisten ist ein Balken, kein Punkt wie „neu“.
- Die Werte und die kleinsten Messwerte stehen in ADR-0052 §1.
