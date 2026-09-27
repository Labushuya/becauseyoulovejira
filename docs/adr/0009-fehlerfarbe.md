# ADR-0009: Fehlerfarbe als eigenes Design-Token

- **Status:** Angenommen, ergänzt durch [ADR-0027](0027-akzent-themes.md) (siehe Nachtrag am Ende)
- **Datum:** 2026-09-24
- **Entscheidung durch:** Nutzer (dezentes Rot nur für echte Fehler, 2026-09-24), Advisor (Farbwerte)

## Kontext

CLAUDE.md §8 legt Petrol als einzige Akzentfarbe fest. Alle Farben stehen in `web/src/lib/styles/tokens.css`. Bisher gibt es kein Fehler-Token; die Login-Fehlermeldung nutzt deshalb „Marke Fläche / Text darauf“ mit Warn-Icon (E1, Paket 7). Ab E2 gibt es mehr Fehlerfälle: Speichern fehlgeschlagen, ungültige Felder, Server nicht erreichbar. Wenn diese in Petrol erscheinen, sind sie von normalen Hinweisen kaum zu unterscheiden.

Produktentscheidung des Nutzers: Ein dezentes Rot wird **nur für echte Fehler** eingeführt. Petrol bleibt die einzige Akzentfarbe. Das Token muss zu den bestehenden Tokens passen, im hellen und dunklen Modus, mit Kontrast nach WCAG AA.

## Entscheidung

Zwei neue Tokens, in allen vier Blöcken von `tokens.css` (hell, dunkel per Media Query, erzwungen hell, erzwungen dunkel):

| Token | Hell | Dunkel | Verwendung |
|---|---|---|---|
| `--color-danger` | `#A13A40` | `#EAA0A0` | Fehlertext, Fehler-Icon, Rahmen ungültiger Felder, linke Linie der Fehlermeldung |
| `--color-danger-soft-bg` | `#F8E9E9` | `#3B1E21` | Fläche von Fehlermeldungen |

Gemessene Kontraste (WCAG 2.x, relative Leuchtdichte):

| Paar | Hell | Dunkel | Anforderung |
|---|---|---|---|
| `--color-danger` auf Fläche (`#FFFFFF` / `#152023`) | 6,57 : 1 | 7,95 : 1 | 4,5 : 1 (Text) |
| `--color-danger` auf Hintergrund (`#F5F8F8` / `#0E1517`) | 6,16 : 1 | 8,82 : 1 | 4,5 : 1 |
| `--color-danger` auf `--color-danger-soft-bg` | 5,58 : 1 | 7,20 : 1 | 4,5 : 1 |

Die Töne sind entsättigt (Ziegelrot bzw. gedämpftes Rosé), damit sie neben Petrol und den grau-grünen Neutraltönen ruhig wirken.

**Verwendung (verbindlich):**

- Rot nur für echte Fehler: fehlgeschlagene Anfragen, abgelehnte Eingaben, Validierungsfehler an Feldern (`aria-invalid="true"` plus Fehlertext über `aria-describedby`), die Login-Fehlermeldung.
- **Nicht** rot: überfällige Tickets, hohe oder dringende Priorität, der Knopf „Endgültig löschen“ und Warnhinweise ohne Fehler. Überfällige Tickets zeigen Text und Icon in der Textfarbe, die Sicherheitsabfrage beim Löschen arbeitet mit eindeutigem Text statt mit Farbe.
- Farbe ist nie das einzige Merkmal. Fehler tragen immer ein Icon und einen Text (WCAG 1.4.1).
- CLAUDE.md §8 bekommt die zwei Tokens als Tabellenzeile, samt der Regel „nur für echte Fehler“. Das ist eine vom Nutzer entschiedene Designänderung.

## Alternativen

- **Weiter nur Petrol:** Fehler und Hinweise sähen gleich aus. Vom Nutzer verworfen.
- **Kräftiges Signalrot (etwa `#D32F2F`):** passt nicht zur zurückhaltenden Palette und dominiert neben Petrol. Verworfen.
- **Bernstein aus der Status-Pille „Wartet“:** ist schon mit einem Status belegt, eine Verwechslung wäre möglich. Verworfen.

## Konsequenzen

- Positiv: Fehler sind klar erkennbar, ohne eine zweite Akzentfarbe zu etablieren.
- Die Login-Fehlermeldung wird in E2 auf die neuen Tokens umgestellt.
- Ein Test prüft, dass alle vier Blöcke in `tokens.css` dieselben Token-Namen definieren und dass außerhalb von `tokens.css` keine Farbwerte stehen.

## Nachtrag (2026-09-26): Fehlerfarbe im Rubin-Theme (ADR-0027)

Mit den Akzent-Themes aus [ADR-0027](0027-akzent-themes.md) gibt es neben Petrol einen Rubin-Akzent. Kein Rubin mit brauchbarer Helligkeit erreicht gegen `#A13A40` einen Abstand von ΔE2000 20. Deshalb rückt die Fehlerfarbe **nur im Rubin-Theme** Richtung Ziegelrot:

| Token | Hell | Dunkel |
|---|---|---|
| `--color-danger` | `#A7472A` | `#E28E78` |
| `--color-danger-soft-bg` | `#F9ECE6` | `#3B2119` |

Die Werte oben gelten in allen anderen Themes unverändert. Die Regeln dieses ADR (Rot nur für echte Fehler, immer mit Icon und Text, entsättigte Töne, kein Bernstein) gelten in jedem Theme.

`tokens.test.ts` prüft je Theme und Modus:

- den Kontrast der Fehlerfarbe auf Fläche, Hintergrund und Fehlerfläche (mindestens 4,5 : 1)
- den Abstand zum Akzent (mindestens ΔE 20)
- den Abstand zu „Wartet“ (mindestens ΔE 15)

Die Kontrastwerte oben rechnet jetzt `web/src/lib/test/color-math.test.ts` nach.

## Nachtrag (2026-09-27): Fehlerfarbe im Kupfer-Theme (ADR-0027, Nachtrag)

Das neue Kupfer-Theme (Nachfolger von Honig) liegt wie Rubin zu nah an `#A13A40`. Deshalb rückt die Fehlerfarbe **nur im Kupfer-Theme** Richtung Karmin, entsättigt und mit Icon und Text wie überall:

| Token | Hell | Dunkel |
|---|---|---|
| `--color-danger` | `#A0334F` | `#E58FAB` |
| `--color-danger-soft-bg` | `#F9E8EC` | `#3B1E27` |

In Petrol und Smaragd gelten die Werte oben unverändert, in Rubin die aus dem Nachtrag vom 2026-09-26.
