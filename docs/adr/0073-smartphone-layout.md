# ADR-0073: Smartphone-Layout als responsive Variante der SPA hinter dem Vorschau-Schalter „Handy-Ansicht“

- **Status:** Angenommen; umgesetzt ist das Grundgerüst (Paket MO-1a). Die Anpassung der Overlays und der einzelnen Ansichten folgt in den Paketen MO-1b bis MO-8. Fälle im Test-Manifest BYL-E6-1907 bis BYL-E6-1929, manuelle Prüfungen BYL-E6-1925 bis BYL-E6-1929
- **Datum:** 2026-10-20
- **Entscheidung durch:** Nutzer (Ziel „unterwegs am Android-Handy“, die Ansicht dort sei „zu gequetscht und überladen“; Entscheidungen vom 2026-10-20: VPN mit `http`, Installierbarkeit später, untere Leiste „Tagesplan · Aufgaben · ＋ · Eingang · Mehr“, Startansicht Tagesplan nur am Handy, nichts verschwindet ganz, „＋“ legt ein Ticket an, keine Wischgesten, `@playwright/test` als Dev-Abhängigkeit, Auslieferung am Stück hinter einem Vorschau-Schalter), Advisor (Auftrag MO-1a mit Grundsätzen und Abgrenzung zu MO-1b), Executor (Konzept MO-0, Breakpoint, Bedingung, Umsetzung, Tests)
- **Bezug:** [ADR-0025](0025-ui-konsistenz-overlay-system.md) (sechs Overlay-Bausteine), [ADR-0029](0029-glas-materialien.md) (Glas der Bedienebene), [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md) (keine Container Queries), [ADR-0053](0053-kalenderansicht.md) §7 (Agenda unter 40rem), [ADR-0057](0057-kontextabhaengige-oberflaeche.md) (Kontext „nur am PC“), [ADR-0060](0060-einheitliche-eingabeelemente.md) §2 (44 px auf Touch), [ADR-0065](0065-tagesplan.md) (Tagesplan), [ADR-0066](0066-ansicht-erledigte.md) §1 (feste Reihenfolge der Navigation, Nachtrag MO-1a), [ADR-0028](0028-plattform-strategie.md) §3 (HTTPS, Nachtrag MO-1a zum Zugriff über VPN), [Plan Heimnetz](../plan/heimnetz.md) (HN-1)

## Kontext

Der Nutzer öffnet BYLJ unterwegs am Android-Handy über das WireGuard-VPN der FRITZ!Box im Heimnetz unter der Adresse für andere Geräte (Zugriff im Heimnetz, HN-1), etwa `http://192.168.178.66:8090`. Unterwegs braucht er vor allem den Tagesplan, die Aufgabenliste, ein Ticket zum Ansehen oder Abhaken und die Schnellerfassung. Die Oberfläche folgte bisher CLAUDE.md §7 „Desktop zuerst, auf schmalen Bildschirmen benutzbar“; am Handy reicht das nicht.

Befund des Konzepts MO-0 (Stand `0b8085a0`, abgeleitet aus CSS und der Spaltenlogik bei 360 und 412 CSS-px):

- Die Kopfzeile ist unter 64rem nicht `sticky` und bricht in vier bis sechs Zeilen um; darunter stehen die acht Segmente der Navigation in drei bis vier Zeilen mit Zielen von 24 px. In „Aufgaben“ folgen Filter-Karten und Filterleiste: Die Liste beginnt erst nach mehr als einem Bildschirm.
- `fitColumns` lässt in „Aufgaben“ 0 bzw. etwa 50 px für den Titel, im Eingang etwa 30 bzw. 82 px.
- Es gibt keine Safe Areas, kein `interactive-widget` und keinen Umgang mit der Bildschirmtastatur.
- Tragfähig sind: Panel in voller Breite unter 36rem, Vollansicht im Vollbild unter 48rem, Kalender als Agenda unter 40rem, Tagesplan mit 44 px, „Erledigte“ als Liste, 44 px für Felder und Textknöpfe auf Touch, der Kontext „nur am PC“, kein Ziehen als einziger Weg.

## Entscheidung

### 1. Eine Oberfläche, dieselben Komponenten, responsiv

- Keine eigenen Mobil-Routen und keine zweite Komponente für dieselbe Funktion. Wo die Struktur gleich bleibt, ändert nur CSS; wo das Markup wechseln muss (später etwa Tabelle → Karten), verzweigt dieselbe Komponente, mit denselben Stores, Selektoren, Menüs und Links (`ticketLinks()`).
- Neue Bausteine gibt es nur für den Rahmen, den der PC nicht hat: die kompakte obere Leiste (`components/phone/PhoneTopBar.svelte`), die untere Leiste (`PhoneTabBar.svelte`) und „Mehr“ (`PhoneMoreSheet.svelte`). Namen, Links und Symbole der Ansichten teilen sie mit der Navigation des PC (`lib/views.ts`, `ViewIcon.svelte`).

### 2. Ein Breakpoint

- **`PHONE_QUERY` = `(max-width: 39.99rem)`** in `lib/domain/phone-layout.ts`; CSS nutzt dasselbe Literal `@media (max-width: 39.99rem)`, weil Custom Properties in Media Queries nicht gehen. `CALENDAR_NARROW_QUERY` des Kalenders ist seit MO-1a dieselbe Konstante.
- **Begründung:** 40rem sind bei Standardschrift 640 px. Handys hochkant haben 360 bis 412 CSS-px (große bis etwa 480), Foldables zugeklappt ebenso; Tablets hochkant (ab 768 px) und Handys quer bleiben bei der gewohnten Ansicht mit dem Panel als Overlay. Der Wert liegt nahe an der Klasse „compact“ von Material (unter 600 dp) und gleicht dem vorhandenen Umschaltpunkt des Kalenders, so wechseln am Handy beide zusammen. Mit `<meta name="text-scale">` folgt rem der Systemschrift: Mit großer Schrift gilt der Rahmen auch in etwas breiteren Fenstern, gewollt.
- Keine Container Queries (ADR-0030). Die Breiten aller Media Queries sind eine geschlossene Liste (`styles/breakpoints.test.ts`); eine neue braucht eine Entscheidung. Für die Touch-Größen bleibt `(pointer: coarse)` (ADR-0060).

### 3. Vorschau-Schalter und Auslieferung am Stück

- **Schalter „Handy-Ansicht (Vorschau)“** in „Einstellungen → Darstellung“, Gruppe „Handy“, neben Farbschema, Farbe und Transparenz: gerätelokal in `localStorage` unter `byl-mobile-layout`, nur `on` wird gespeichert, **standardmäßig aus**, andere Tabs folgen über `storage`. Erreichbar in der heutigen Handy-Ansicht (Zahnrad → „Darstellung“) und im Rahmen unter „Mehr“. In einem breiten Fenster sagt die Seite, dass dort die gewohnte Ansicht bleibt.
- **Bedingung:** `MobileLayoutStore.active` (`lib/mobile-layout.svelte.ts`) ist `isPhoneLayout(enabled, narrow)`: Schalter an **und** schmal. Ohne `matchMedia` (jsdom) gilt das Fenster als breit, jeder Komponententest bleibt ein Desktop-Test.
- Solange der Schalter an ist, steht `data-mobile-layout="on"` am Wurzelelement. CSS-Regeln des Rahmens stehen nur unter `@media (max-width: 39.99rem)` **und** `:root[data-mobile-layout='on']` (statisch geprüft); JS-Zweige fragen nur `active`. Ein Inline-Skript in `app.html` braucht es nicht: Vor dem Start der SPA zeigt nichts den Rahmen, die Anmeldeseite bleibt unverändert.
- **Auslieferung am Stück:** Alle MO-Pakete kommen hinter denselben Schalter; ausgeschaltet bleibt die heutige Ansicht am Handy unverändert. Sind die Ansichten angepasst, schaltet ein späteres Update die Vorgabe um; das ist eine eigene Entscheidung mit Nachtrag hier.
- **Keine Allowlist der Routen:** Der Rahmen (Leisten, „Mehr“, Start) gilt auf jeder Seite der App, weil die Navigation nicht zwischen zwei Varianten springen darf. Jede Ansicht ändert sich in ihrem Paket hinter derselben Bedingung und zeigt sich bis dahin im Rahmen wie heute.

### 4. Navigation am Handy (Nachtrag zu ADR-0066 §1)

- **Untere Leiste** (`nav` „Hauptnavigation“): **Tagesplan · Aufgaben · ＋ · Eingang · Mehr** (Nutzer). Der Tagesplan steht vorn, weil er unterwegs die erste Frage beantwortet; die feste Folge der übrigen bleibt.
- Die drei Ansichten sind Links mit denselben Adressen und Zuständen wie die Navigation des PC; die aktuelle trägt `aria-current="page"` und eine Fläche hinter dem Symbol samt Gewicht, nie nur Farbe. Der Eingang zeigt seine Zahl „neu“. „Mehr“ ist hervorgehoben, wenn eine Ansicht darunter oder die Einstellungen offen sind, und sagt Screenreadern, welche („Mehr, aktuell: Kalender“).
- **„＋“** öffnet die vorhandene Schnellerfassung: Enter legt ein Ticket an, daneben steht „In den Eingang“. Der Ausbau (Sheet, `enterkeyhint`, Ergebnis) ist MO-5.
- **„Mehr“** ist das Modal als Sheet (`placement="sheet"`), keine neue Overlay-Art; ADR-0025 bleibt bei sechs Bausteinen. Darin: die übrigen Ansichten in fester Folge (Projekte, Wiederholungen, Kalender, Erledigte, Papierkorb) mit ihren Zahlen, „Neues Ticket“, die Einstellungen in den Gruppen ihrer Navigation samt „Darstellung“ und „Hilfe“, die Seiten des Verwalters auf einem anderen Gerät mit „nur am PC“ (ADR-0057), dazu „Angemeldet als …“ und „Abmelden“. Ein Link schließt das Sheet; ×, Esc und der Schleier schließen es, unter Android auch die Zurück-Geste (Close Watcher des `<dialog>`, am Gerät geprüft im manuellen Fall), und der Fokus kehrt zu „Mehr“ zurück.
- **Obere Leiste:** kompakt in einer Zeile, `sticky`, mit dem Namen der Ansicht und dem Bereichs-Umschalter mit 44 px. Kopfzeile und Navigation der Ansichten des PC entfallen im Rahmen; ihr Inhalt steht unter „Mehr“ oder hinter „＋“. Der Name steht nur einmal auf dem Bildschirm: Die Überschrift der Ansicht (`SectionBar`) bleibt für Screenreader und als Ziel des Fokus, ist im Rahmen aber nur unsichtbar da; der Name der App bleibt wie am PC die Überschrift der Seite.
- Jede Ansicht ist in höchstens zwei Tipps erreichbar.

### 5. Startansicht

Im Rahmen öffnet die App den **Tagesplan**, wenn sie an ihrer Startseite geöffnet wird (`isPhoneStart`): nur das blanke `/` ohne Query und Fragment, wenn das Dokument neu geöffnet wurde (`navigate`, nicht `reload` oder `back_forward`) und der Referrer leer oder fremd ist, und nur bei der ersten Navigation des Layouts (Start, nach der Anmeldung). Links mit eigener Adresse, ein Tipp auf „Aufgaben“, das Neuladen von „Aufgaben“ und eine Seite der App, die nach einem Update `/` als neues Dokument lädt, bleiben, wo sie sind. Am PC bleibt „Aufgaben“.

### 6. Tour, Tastatur, Viewport und Safe Areas

- **Tour** im Rahmen aus: Ihre Schritte zeigen auf Kopfzeile und Filterleiste des PC. „Erste Schritte“ bietet sie dort nicht an, das Layout startet keine.
- **Meta-Viewport:** `app.html` bleibt bei `width=device-width, initial-scale=1`. Nur solange der Rahmen gilt, setzt der Store `viewport-fit=cover, interactive-widget=resizes-content` und nimmt beides beim Verlassen zurück (Querformat, Schalter aus, Abmelden). **Wirkung bei ausgeschaltetem Schalter:** keine, der Inhalt ist bytegleich wie bisher (Test). Beide Schlüssel ändern das Verhalten am Handy: `viewport-fit=cover` lässt Chrome für Android die Seite bis unter die Systemleisten zeichnen und meldet erst damit `env(safe-area-inset-*)`; ohne die Abstände des Rahmens rutschte Inhalt darunter. `interactive-widget=resizes-content` verkleinert mit der Bildschirmtastatur den Layout-Viewport, `dvh` und `window.innerHeight`, also auch feste Füße und Popover der heutigen Ansicht. Desktop-Browser ignorieren beide.
- **Safe Areas:** `--safe-top` an der oberen Leiste, `--safe-bottom` an unterer Leiste, Sheet, Flags und Seitenende.
- **Tastatur:** Solange ein Feld den Fokus hat, das die Bildschirmtastatur öffnet (Text, Suche, Zahl, Textbereich, Editor; nicht Häkchen, Optionsfeld, Datum oder Auswahlliste, `opensKeyboard`), weicht die untere Leiste. `enterkeyhint` und Ähnliches folgen in MO-1b und MO-5.
- **Flags** stehen im Rahmen über der unteren Leiste.

### 7. Tokens

Neue Nicht-Farb-Tokens nur in `:root` (`tokens.test.ts`): `--page-inline` (1.5rem, im Rahmen 1rem, der Fensterrand kompakter Layouts in Material), `--top-bar-height` und `--bottom-bar-height` (je 3.5rem), `--phone-target` (3rem, 48 px, mehr als die 44 px von Apple), `--safe-top`, `--safe-bottom` (`env(safe-area-inset-*, 0px)`) und `--sheet-max-height` (lässt oben einen Streifen des Schleiers zum Antippen). Im Rahmen ändert sich nur `--page-inline`. Keine neuen Farben. Beide Leisten tragen Glas `--material-regular` wie die Kopfzeile (Allowlist in `glass-allowlist.test.ts`).

### 8. Grundsätze für alle MO-Pakete

- **Weniger pro Bildschirm:** eine Spalte, eine Hauptaktion je Ansicht, großzügige Abstände.
- **Nichts verschwindet ganz:** Seltener Gebrauchtes rutscht eine Ebene tiefer („Mehr“, ein Aufklapper, ein Sheet) und bleibt erreichbar. Seiten, die nur am PC gehen, stehen mit dem Hinweis „nur am PC“ da.
- **Bedienbarkeit:** Klickflächen mindestens 44 px (Leisten und Sheet 48 px), lesbare Schrift. Nichts wird verkleinert, nur damit es passt.
- **Desktop unverändert:** Ab 40rem und mit ausgeschaltetem Schalter ändert sich nichts; Tests belegen das.
- **Keine Wischgesten** vorerst (Nutzer); jede Aktion hat einen Knopf.
- Die Querschnittsregel steht im Kern (CLAUDE.md §7), die Einzelheiten in den Detaildokumenten unter [docs/regeln/](../regeln/README.md).

### 9. Teststrategie

- **jsdom (Vitest):** Bedingung, Store, Schalter, Startansicht, Inhalt von „Mehr“ samt „nur am PC“, Rahmen statt Kopfzeile, „Desktop unverändert“ (Schalter aus am Handy, Schalter an im breiten Fenster), dazu statische Prüfungen: geschlossene Liste der Breakpoints, Regeln des Rahmens nur hinter Breakpoint und Schalter, Tokens, Glas, Sheet.
- **Playwright** (`@playwright/test`, Freigabe des Nutzers vom 2026-10-20): `tests/mobile/`, `npm run test:mobile`, im installierten Google Chrome (`channel: 'chrome'`, wahlweise Edge über `BECAUSEYOULOVEJIRA_BROWSER_CHANNEL`), **kein Browser-Download**, kein Install-Skript. Der globale Setup startet eine eigene Wegwerf-Instanz über den Harness mit dem Web-Build und einem erfundenen Konto; der Browser bekommt die Umgebung ohne Zugangsdaten; Zeitgrenzen nur aus `tests/support/timing.mjs`. Geprüft wird, was jsdom nicht sieht: kein waagerechtes Scrollen, Größe und Lage der Ziele, das Sheet unten, die Startansicht, „Aufgaben“ bleibt „Aufgaben“, der PC ohne Rahmen. Keine Pixel-Goldens (Schriften und Glas machen sie brüchig). In der CI ein Schritt **nur im Job „Linux build and test“** nach dem Build (`ci-ruleset.test.mjs`); nicht in `npm test` und nicht in `scripts\build.ps1`, um den Arbeitsspeicher des PC zu schonen.
- **Manuell am Handy des Nutzers:** die Fälle im Test-Manifest (Tastatur, Safe Areas, Zurück-Geste, Lesbarkeit mit der Systemschrift).

## Alternativen

- **Eigene Mobil-Oberfläche oder -Routen:** doppeltes Verhalten, doppelte Paritätstests, jede neue Option doppelt. Verworfen.
- **Ohne Schalter direkt ausliefern:** Die Ansichten werden über mehrere Pakete angepasst; dazwischen wäre das Handy halb umgebaut. Verworfen (Nutzer: Auslieferung am Stück).
- **Navigation als Schublade oder als waagerecht scrollende Reiter:** zwei Tipps je Wechsel bzw. halb verdeckte Reiter, kein „＋“. Verworfen.
- **„Mehr“ als Popover-Menü (Aktionsblatt):** Gruppen mit Überschriften, Links mit „nur am PC“ und die Sitzung sind keine Menüeinträge. Das Modal bringt Fokusfalle, Esc, Schleier, Zurück-Geste und den Rückweg des Fokus mit. Verworfen zugunsten der Sheet-Variante des Modals.
- **Viewport-Schlüssel immer setzen:** Sie ändern Safe Areas und Tastatur auch ohne Schalter. Verworfen.
- **Allowlist der Routen:** siehe §3. Verworfen.
- **Breakpoint 36rem oder 48rem:** 36rem nähme große Handys und Foldables nicht mit; 48rem nähme kleine Tablets hochkant dazu und wiche vom Kalender ab. Verworfen.
- **Vitest-Browser-Modus:** prüft einzelne Komponenten, nicht das Zusammenspiel von Kopf, Leiste und Seite. Verworfen.

## Konsequenzen

- Nur die SPA, Tests und die CI ändern sich; keine Hooks, keine Migration: Nach dem Build genügt F5.
- ADR-0066 §1 bekommt einen Nachtrag (untere Leiste am Handy), ADR-0028 einen Nachtrag (Zugriff über VPN mit `http`).
- CLAUDE.md §7 bekommt die Querschnittsregel „Handy-Breite“, §3 und §12 nennen den Smoke-Test.
- Der Linux-Job der CI wird um den Smoke-Test länger (etwa eine Minute); der Windows-Job bleibt unverändert.

## Grenzen

- Ohne HTTPS gibt es keine Installation als App, nur eine Verknüpfung auf dem Startbildschirm, keinen Service Worker über die LAN-Adresse und eine unsichere Zwischenablage (MO-8, eigene ADR).
- Tastatur, Safe Areas, Zurück-Geste und Lesbarkeit lassen sich nur am Gerät prüfen.
- Die Ansichten selbst sind noch nicht angepasst (Tabellen, Filterleiste, Panel, Overlays): MO-1b und folgende. Im Rahmen zeigen sie sich bis dahin wie heute.
