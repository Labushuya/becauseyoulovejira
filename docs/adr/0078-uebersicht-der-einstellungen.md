# ADR-0078: Übersicht der Einstellungen

- **Status:** Angenommen und umgesetzt (Paket EU-1); Fälle im Test-Manifest BYL-E6-2392 bis BYL-E6-2401, manuelle Prüfungen BYL-E6-2400 und BYL-E6-2401
- **Datum:** 2026-11-05
- **Entscheidung durch:** Nutzer (Entscheidung vom 2026-11-05, „Genau so umsetzen“: das Zahnrad am PC führt auf die neue Übersicht (Variante B), drei PRs nacheinander EU-1, FP-3 und FP-3b, am Handy ein Zurück-Pfeil zur Übersicht statt der Linkzeilen, keine Server- oder Rechte-Änderung), Advisor (Auftrag EU-1 mit Analyse des Ist-Stands), Executor (Sätze der Seiten, Baustein, Umsetzung, Tests)
- **Bezug:** [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) §1 (Einstellungsbereich, Weiterleitung, Nachtrag EU-1), [ADR-0057](0057-kontextabhaengige-oberflaeche.md) (Seiten des Verwalters nach dem Kontext des Tabs), [ADR-0060](0060-einheitliche-eingabeelemente.md) (Gruppen der Navigation), [ADR-0073](0073-smartphone-layout.md) (Handy-Ansicht, Konzept MO-0, Nachtrag MO-7c2 §3 und §6, Nachtrag EU-1), [ADR-0076](0076-offene-einrichtungen-sichtbar.md) §2 (Marke an „Kanäle“)

## Kontext

- Seit EH-1 leitete `/einstellungen` per `redirect(307)` nach „Kanäle“ weiter ([ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) §1). Das Zahnrad der Kopfzeile zeigte direkt auf `/einstellungen/kanaele`, und der erste Schritt „Einstellungen“ der Brotkrumen führte ebenfalls auf „Kanäle“. Eine Seite, die den Bereich als Ganzes zeigt, gab es nicht.
- Das Konzept MO-0 der Handy-Ansicht sah eine Startseite der Einstellungen mit der gruppierten Liste der Seiten vor. MO-7c2 baute sie nicht: „Startseite der Einstellungen … gibt es nicht“ ([ADR-0073](0073-smartphone-layout.md) Nachtrag MO-7c2 §3 und §6), eigener Punkt EU-1.
- Im Handy-Rahmen standen vor jeder Seite der Einstellungen die Linkzeilen aller Gruppen (bis zu 13 Ziele von 44 px), obwohl „Mehr“ dieselben Seiten schon listet. Das widerspricht „weniger pro Bildschirm“ (ADR-0073, Grundsätze).

## Entscheidung

### 1. Übersicht unter `/einstellungen`

- Statt der Weiterleitung (`+page.ts`, entfernt) ist `/einstellungen` eine eigene Seite (`+page.svelte`). Sie zeigt die Seiten in den Gruppen der Navigation (`groupSettingsSections(visibleSettingsSections(platform, adminPages))`), mit derselben Matrix wie die Navigation: „full“ alle Seiten, „pc-only“ die Gruppe „Verwaltung“ mit „nur am PC“ sichtbar an ihrer Überschrift und im Namen jeder Zeile für Screenreader, „hidden“ (jedes andere Konto, Kontext lädt) ohne die Gruppe ([ADR-0057](0057-kontextabhaengige-oberflaeche.md)). Ohne Windows fehlen „Sicherung“ und „System“ wie in der Navigation (`WINDOWS_ONLY`).
- **Je Seite eine Zeile:** ein Link mit dem Namen der Seite und einem Satz, was man dort tut (neues Feld `description` in `SETTINGS_SECTIONS`). Der Link ist nach seinem Namen benannt (`aria-labelledby`) und durch den Satz beschrieben (`aria-describedby`), so bleiben Namen kurz für Screenreader und Sprachsteuerung. „Kanäle“ trägt die Zahl der offenen Einrichtungen wie in der Navigation (KE-1, [ADR-0076](0076-offene-einrichtungen-sichtbar.md) §2). Die Namen der Gruppen sind Überschriften `h3` unter der `h2` „Einstellungen“; die Hilfe steht ohne sichtbare Überschrift nach einer Linie, wie in der Navigation. Eine nur für Screenreader sichtbare `h3` „Hilfe“ (`visually-hidden`) benennt ihre Liste per `aria-labelledby`, so ist jede Liste der Übersicht benannt und die Folge der Überschriften vollständig (Review R-5); in „Mehr“ bleibt die Liste der Hilfe ohne Namen.
- **Die Sätze** beschreiben nur, was die Seite kann, aus ihren Texten und dem README abgeleitet; sie stehen im Code neben der Adresse und werden mit der Seite gepflegt. Ein Test verlangt für jede Seite genau einen eigenen Satz.
- **Layout:** Die Brotkrumen zeigen auf der Übersicht genau einen Schritt „Einstellungen“ (aktuell, kein Link; im Handy-Rahmen keine Brotkrumen, §3), die Überschrift heißt „Einstellungen“, der Titel des Tabs „Einstellungen · becauseyoulovejira“. Die Navigation markiert keine Seite (`current` null). Der Fokus geht beim Wechsel zwischen Übersicht und Seiten auf die Überschrift, aus einer Ansicht nicht, wie zwischen den Seiten. Am PC (ab 64rem) bleibt die Navigation als Spalte links, zwischen 40 und 64rem stehen ihre Zeilen wie bisher über dem Inhalt.

### 2. Zahnrad auf die Übersicht (Variante B)

- Das Zahnrad der Kopfzeile führt auf `/einstellungen`. Das ist eine bewusste Änderung am PC auf Entscheidung des Nutzers vom 2026-11-05: Der Einstieg in den Bereich ist der Bereich, und der Pfad „Einstellungen“ führt auf dieselbe Seite.
- Links, die gezielt „Kanäle“ meinen, bleiben: „Kanäle einrichten“ im Menü „?“, der Schritt „Kanäle“ der Tour, „Kanäle öffnen“ in „Erste Schritte“, „Kanal einrichten“ im leeren Eingang, der Hinweis auf offene Einrichtungen, `channelSetupHref`, die Verweise in Hilfe und „Sicherheit“.

### 3. Handy-Rahmen

- **Übersicht:** Zeilen mindestens `--phone-target` hoch (48 px), der Satz in `--font-size-control`, Namen und Sätze brechen um (`overflow-wrap: anywhere`), eine Spalte `minmax(0, 1fr)`, kein seitliches Scrollen bei 360 px. Die Navigation zeigt dort nur den Rückweg „Zurück zu …“, die Übersicht selbst ist die Liste der Seiten. Die obere Leiste nennt „Einstellungen“ (`isSettingsPath` schloss `/einstellungen` schon ein).
- **Seiten:** Statt der Linkzeilen der Navigation steht nach dem Rückweg „Zurück zu …“ der Pfeil „Einstellungen“, ein Link auf die Übersicht mit dem Namen „Zu den Einstellungen“ (sichtbar Pfeil und „Einstellungen“) und 44 px wie der Rückweg (`.back`). Seiten des Verwalters zeigen weiter nur `AdminPageNotice` (MO-7c2 §3), der Pfeil steht auch dort. Der Rückweg zur letzten Ansicht bleibt zuerst (ADR-0026 §1, geprüft seit MO-6b).
- **Brotkrumen (Review R-1, „weniger pro Bildschirm“):** Im Rahmen stehen sie nur auf einer Unterseite, also „Einstellungen › Hilfe › Eingabeelemente“; dort führt der Pfad eine Ebene weiter als der Pfeil. Auf der Übersicht und auf jeder Seite ohne Unterseite fehlen sie: Die obere Leiste nennt „Einstellungen“, der Pfeil führt zur Übersicht, die Überschrift `h2` nennt die Seite und bleibt Ziel des Fokus. Das Layout entscheidet mit `phone` und `settingsSubpageOf` (`showCrumbs`); außerhalb des Rahmens bleiben die Brotkrumen wie in §1.
- Die Entscheidung trifft das Layout über `mobileLayout.active` (Prop `phone` von `SettingsNav`: „overview“, „page“ oder null), wie bei den Seiten des Verwalters. Zwischen 40 und 64rem, mit „Handy-Ansicht: Aus“ und am PC bleibt die Navigation unverändert.

### 4. Gemeinsamer Baustein `SettingsGroupList`

- `components/SettingsGroupList.svelte` listet die Seiten der Einstellungen für diesen Tab: Er liest Server-System, Kontext und offene Einrichtungen selbst und rendert Bezeichnungen und Listen ohne eigenen Rahmen ins Raster des Aufrufers. „Mehr“ nutzt ihn ohne `overview` (Zeilen wie bisher: Name, „nur am PC“, Zahl; ruhige Bezeichnungen, `onfollow` schließt das Sheet), die Übersicht mit `overview` (Überschriften, Sätze, Linie vor der Hilfe). So zeigen Übersicht und „Mehr“ immer dieselben Seiten mit denselben Marken.
- `SettingsNav` bleibt ein eigener Baustein (Glas-Karte ab 64rem, umbrechende Zeilen darunter) auf denselben Funktionen der Sichtbarkeit.

### 5. Abgrenzung

- Keine Seite „Fehlerprotokoll“ (FP-3), keine Änderung an Server, Hooks, Migrationen, Rechten oder am Postausgang. Nach dem Build genügt F5, kein Neustart.

## Alternativen

- **A: Das Zahnrad bleibt auf „Kanäle“.** Am PC ein Klick weniger zur meistgenutzten Seite, dafür führten Zahnrad und Pfad „Einstellungen“ weiter auf verschiedene Ziele, und die Übersicht wäre nur über den Pfad zu finden. Vom Nutzer verworfen (Variante B).
- **Übersicht nur im Handy-Rahmen, am PC weiter die Weiterleitung:** dieselbe Adresse hätte zwei Bedeutungen. Verworfen.
- **Linkzeilen im Rahmen behalten:** 13 Ziele vor jeder Seite, dieselbe Liste wie unter „Mehr“. Vom Nutzer verworfen.
- **Der Pfeil über den Verlauf (`ViewArrow`):** die Übersicht hat keinen Zustand, den der Verlauf zurückbringen müsste; ein Link genügt und gilt auch nach dem Öffnen per Adresse.
- **Der Satz im Namen des Links:** lange Namen für Screenreader und Sprachsteuerung. Verworfen zugunsten von `aria-describedby`.
- **`SettingsNav` ebenfalls auf `SettingsGroupList`:** andere Darstellung (Glas-Karte, umbrechende Zeilen), kein Gewinn. Nicht umgesetzt.

## Konsequenzen

- Am PC ist „Kanäle“ über das Zahnrad einen Klick weiter; „Kanäle einrichten“ im Menü „?“ bleibt direkt.
- Der Pfad „Einstellungen“ führt auf eine eigene Seite statt auf „Kanäle“.
- Im Rahmen stehen auf einer Seite zwei Rückwege untereinander: „Zurück zu …“ (letzte Ansicht) und „Einstellungen“ (Übersicht); einen Pfad gibt es dort nur auf einer Unterseite (§3).
- Der Smoke-Fall von „Mehr“ prüft die Übersicht über den Pfeil bei 360 und 412 px; kein neuer Fall.

## Grenzen

- Zwischen 40 und 64rem und am PC stehen die Seiten auf der Übersicht zweimal: in der Navigation und in der Liste mit den Sätzen. Bewusst so gelassen, damit die Navigation außerhalb des Rahmens unverändert bleibt.
- Die Sätze stehen im Code; ändert eine Seite ihren Umfang, muss ihr Satz mitgezogen werden.
- Die Sätze sind kontextfrei: Sie gelten für jedes Konto und jedes Gerät gleich. Was eine Seite konkret anbietet, kann von der Rolle (Verwalter der App, Inhaber eines Haushalts) und der Plattform abhängen (etwa der Zugriff im Heimnetz unter „Sicherheit“ nur unter Windows); ein Satz nennt das, was die Seite insgesamt kann, und wird nicht je Kontext umformuliert (Review R-3).
