# ADR-0027: Akzent-Themes (Petrol, Rubin, Purpur, Smaragd, Honig)

- **Status:** Angenommen
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
