# ADR-0073: Smartphone-Layout als responsive Variante der SPA hinter dem Vorschau-Schalter „Handy-Ansicht“

- **Status:** Angenommen; umgesetzt sind das Grundgerüst (Paket MO-1a), Overlays, Bedienziele und Eingabe (Paket MO-1b, Nachtrag unten), der Tagesplan (Paket MO-2, Nachtrag unten), die Aufgaben (Paket MO-3, Nachtrag unten), das Ticket-Detail (Paket MO-4, Nachtrag unten), die Schnellerfassung (Paket MO-5, Nachtrag unten) und der Eingang (Paket MO-6, Nachtrag unten), dazu ein Feinschliff nach den Fragen aus MO-2 bis MO-6 (Paket MO-6b, Nachtrag unten), die Rückfrage in „Neues Ticket“ (Paket MO-6c, Nachtrag unten) und ein Querschnitt mit abgesicherten Formularen, gedämpften Menüpunkten, `autocapitalize`, der Hilfe „Ohne Verbindung“ und einem kleineren Smoke-Test (Paket MO-7a, Nachtrag unten). Die übrigen Ansichten folgen in den Paketen MO-7b, MO-7c und MO-8. Fälle im Test-Manifest BYL-E6-1907 bis BYL-E6-1929 (manuelle Prüfungen BYL-E6-1925 bis BYL-E6-1929), BYL-E6-1950 bis BYL-E6-1964 (manuelle Prüfungen BYL-E6-1959 bis BYL-E6-1964), BYL-E6-1965 bis BYL-E6-1976 (manuelle Prüfungen BYL-E6-1972 bis BYL-E6-1976), BYL-E6-1977 bis BYL-E6-1994 (manuelle Prüfungen BYL-E6-1990 bis BYL-E6-1994), BYL-E6-1995 bis BYL-E6-2008 (manuelle Prüfungen BYL-E6-2003 bis BYL-E6-2008), BYL-E6-2009 bis BYL-E6-2021 (manuelle Prüfungen BYL-E6-2018 bis BYL-E6-2021), BYL-E6-2022 bis BYL-E6-2040 (manuelle Prüfungen BYL-E6-2036 bis BYL-E6-2040), BYL-E6-2060 bis BYL-E6-2071 (manuelle Prüfungen BYL-E6-2067 bis BYL-E6-2071), BYL-E6-2085 bis BYL-E6-2089 (manuelle Prüfungen BYL-E6-2088 und BYL-E6-2089) und BYL-E6-2196 bis BYL-E6-2205 (manuelle Prüfung BYL-E6-2205)
- **Datum:** 2026-10-20
- **Entscheidung durch:** Nutzer (Ziel „unterwegs am Android-Handy“, die Ansicht dort sei „zu gequetscht und überladen“; Entscheidungen vom 2026-10-20: VPN mit `http`, Installierbarkeit später, untere Leiste „Tagesplan · Aufgaben · ＋ · Eingang · Mehr“, Startansicht Tagesplan nur am Handy, nichts verschwindet ganz, „＋“ öffnet vorerst die vorhandene Schnellerfassung (Umbau in MO-5), keine Wischgesten, `@playwright/test` als Dev-Abhängigkeit, Auslieferung am Stück hinter einem Vorschau-Schalter), Advisor (Auftrag MO-1a mit Grundsätzen und Abgrenzung zu MO-1b), Executor (Konzept MO-0, Breakpoint, Bedingung, Umsetzung, Tests)
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
- **Playwright** (`@playwright/test`, Freigabe des Nutzers vom 2026-10-20): `tests/mobile/`, `npm run test:mobile`, im installierten Google Chrome (`channel: 'chrome'`, wahlweise Edge über `BECAUSEYOULOVEJIRA_BROWSER_CHANNEL`), **kein Browser-Download**, kein Install-Skript. Der globale Setup startet eine eigene Wegwerf-Instanz über den Harness mit dem Web-Build und einem erfundenen Konto; der Browser bekommt die Umgebung ohne Zugangsdaten; Zeitgrenzen nur aus `tests/support/timing.mjs`. Geprüft wird, was jsdom nicht sieht: kein waagerechtes Scrollen, Größe und Lage der Ziele, das Sheet unten, die Startansicht, „Aufgaben“ bleibt „Aufgaben“, der PC ohne Rahmen. Keine Pixel-Goldens (Schriften und Glas machen sie brüchig). In der CI ein Schritt **nur im Job „Linux build and test“** nach dem Build; nicht in `npm test` und nicht in `scripts\build.ps1`, um den Arbeitsspeicher des PC zu schonen. Beides prüft `ci-ruleset.test.mjs` statisch, mit einer Gegenprobe aus abgewandelten Fassungen der echten `ci.yml` (Schritt fehlt, anderer Befehl, vor dem Build, im Windows-Job, Browser-Download).
- **Zugänglicher Name aus `aria-label`, wo Text angehängt wird:** Browser setzen um jeden blockartigen Teil eines Namens Leerzeichen (Flex-Kinder und `.visually-hidden` sind blockartig). „Mehr, aktuell: Kalender“ steht deshalb als `aria-label` an „Mehr“; jsdom sieht das nicht, der Smoke-Test schon.
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

## Nachtrag (2026-10-20, MO-1b): Overlays, Bedienziele und Eingabe

Gilt wie das Grundgerüst nur, solange der Rahmen gilt (Schalter „Handy-Ansicht (Vorschau)“ an und unter 40rem, `MobileLayoutStore.active`); am PC und mit ausgeschaltetem Schalter ändert sich nichts, Tests belegen das. Nur Oberfläche, Tests und Doku, keine Hooks und keine Migration: nach dem Build F5. Entscheidung durch den Advisor (Auftrag MO-1b mit Umfang und Abgrenzung zu MO-2 ff.) und den Executor (Umsetzung, Zuordnung Sheet oder Seite, Tests).

### 1. Overlays: im Baustein entschieden, Sheet oder Seite

Die Entscheidung fällt in den Bausteinen, nicht an den Aufrufstellen: `Modal` fragt `modalPlacement(size, placement, active)` (`lib/domain/phone-layout.ts`), `Popover` fragt `active`. Es bleibt bei den sechs Bausteinen von ADR-0025; Sheet und Seite sind Platzierungen, keine neue Art. Regeln, Fokus beim Öffnen, Fokusfalle (`<dialog>`), Rückgabe des Fokus, Esc, Schleier, Verwerfen-Frage, „kein Dialog aus einem Dialog“ und Flags bleiben die der Bausteine.

| Baustein | Im Rahmen | Begründung |
|---|---|---|
| Modal S (Bestätigungen über `ConfirmDialog`, „Die App ist schon offen“, Fälligkeit und Projekt der Sammelaktionen) | Sheet | Fragen und kurze Formulare unten in Reichweite des Daumens, × und Knöpfe des Fußes ab 44 px. Das Konzept MO-0 (2.6) ließ S mittig wie einen Dialog von Android; der Auftrag verlangt jedes Overlay als Sheet oder Seite, so stehen die Knöpfe an derselben Stelle wie in jedem anderen Sheet. |
| Modal M (Schnellerfassung, Duplizieren, Folge-Ticket, Quellen, Verknüpfen, Wiederholen, Tags, Dialoge der Kanäle und des Haushalts, „Tastaturkürzel“, „Mehr“) | Sheet | höchstens `--sheet-max-height`, oben bleibt ein Streifen des Schleiers zum Antippen; langer Inhalt scrollt zwischen festem Kopf und Fuß. |
| Modal L (Einrichten der Kanäle, Datei-Import, WhatsApp, Notion, Postfach-Auswahl, vorhandene Dateien eines Ordners) | Seite | groß und voller Felder: der ganze Bildschirm (`100dvh`), ohne Schleier und Ecken, `--safe-top` und `--safe-bottom` innen, × in `--phone-target`. |
| Modal XL (Vollansicht) | Seite | war unter 48rem schon Vollbild; dazu die Safe Areas und das × in `--phone-target`. Links öffnen am Handy ohnehin das Panel. |
| Popover `menu` (alle Menüs „•••“ samt Kontextmenü, Status und Priorität in Zellen und Sammelaktionen, Menüs des Editors) | Sheet | unten über die volle Breite, Zeilen ab 44 px, am Ende der Eintrag „Schließen“ (`menuitem`, die Pfeiltasten erreichen ihn). Rechtsklick und Umschalt+F10 öffnen dasselbe Sheet; langes Drücken auf Touch behält das Menü des Browsers (unverändert). |
| Popover `panel` (Filter, „Gruppieren“, „Spalten“, „Ebenen“, Fälligkeit und Tags in Zellen, Charm, Link im Editor, „+N weitere“ des Kalenders, Einstellungen und Sortierung des Tagesplans, Schritte der Anleitungen) | Sheet | wie die Menüs; der Inhalt scrollt allein, am Ende der Knopf „Schließen“. Ohne Schleier: Ein Tipp daneben schließt weiter (Light Dismiss), und die Flags oben bleiben antippbar. |
| Vorschlagsliste `SuggestionList` (Tag-Eingabe, `TicketPicker`, „/“-Menü des Editors) | unverändert am Feld | Beim Tippen bleibt die Bildschirmtastatur offen, ein Sheet läge unter ihr oder verdeckte das Feld. Mit `interactive-widget=resizes-content` sieht `place()` den Platz über der Tastatur und klappt die Liste nach oben. Optionen ab 44 px. Wie im Konzept (2.6). |
| Seitenpanel (Drawer) | Seite, wie bisher volle Breite unter 36rem | dazu lässt `ViewWithPanel`, das das Panel platziert, `--safe-top` und `--safe-bottom` frei (der Drawer bleibt ohne Media Query), und die Knöpfe des Kopfs haben 44 px (§2). Kopf mit Zurück-Pfeil statt × und ohne „Vollansicht öffnen“ (Konzept MO-1) folgen mit dem Ticket-Detail in MO-4. |
| Native Auswahllisten und Datumsfelder | unverändert | Das Handy zeigt seine eigene Auswahl; die Felder haben 44 px (§2). |
| Flags | über der unteren Leiste; oben, solange ein Sheet oder eine Seite offen ist | §5 |

Jedes Sheet und jede Seite hat damit einen sichtbaren Knopf zum Schließen: das × des Modals (48 px) bzw. „Schließen“ der Popover (44 px). Die Zurück-Geste von Android schließt Modals über den Close Watcher (manueller Fall). Bedienung nur per Hover, Tastatur oder Ziehen gab es in den Overlays nicht; Rechtsklick hat „•••“, Ziehen hat Knöpfe (Tagesplan, Kalender, Spalten, Dateien). Offen bleibt die Auswahl eines Bereichs mit Umschalt+Klick (Produktfrage 4 des Konzepts, MO-3).

### 2. Bedienziele ab 44 px

- Ein Block in `base.css` unter `@media (max-width: 39.99rem)` und `:root[data-mobile-layout='on']`, unabhängig vom Zeiger: `.button-primary`, `.button-secondary` und `.button-subtle` (auch mit `.button-small`) mindestens 44 px hoch, `.button-icon` 44 × 44 px (auch „•••“ der Zeilen, × der Panels und Flags), Segmente, Labels von Häkchen und Optionsfeldern (auch Chips) und Felder wie auf Touch-Bildschirmen mit 16 px Schrift (ADR-0060 §2). Der Block steht vor dem Block für Touch, der in `base.css` zuletzt bleibt.
- **Nicht in Zellen von Tabellen** (`:not(:is(td, th) *)`): Ihre Spalten rechnen mit den Größen des PC (ADR-0030), größere Knöpfe würden in der Zelle abgeschnitten. Die Ansichten zeigen am Handy Karten statt Tabellen (MO-3, MO-6, MO-7).
- In den Bausteinen: Menüzeilen im Sheet, Optionen der Vorschlagsliste, × von Sheet und Seite (`--phone-target`).
- Eigene Knöpfe der Ansichten (etwa „Gruppieren“, „Spalten“, die Chips der Filterleiste) und die Werkzeuge des Editors behalten ihre Größe bis zu ihren Paketen (MO-3, MO-4); die Leiste des Editors bricht nicht um, mit 44 px liefe sie über.

### 3. Eingabe

- **`enterkeyhint`** ist ein reines Attribut und steht auch am PC im DOM: jedes Suchfeld `search` (statisch geprüft), die Schnellerfassung und der Titel im Panel `done` (Enter legt an bzw. speichert), die Anmeldung `next` (E-Mail) und `done` (Passwort). Wo Enter etwas anderes tut (Tag-Eingabe, `TicketPicker`, mehrzeilige Felder), bleibt die Taste des Systems. `autocapitalize` und das eigene Sheet der Schnellerfassung folgen in MO-5.
- **Viewport:** `interactive-widget=resizes-content` setzt der Store seit MO-1a zusammen mit `viewport-fit=cover`, nur solange der Rahmen gilt, und nimmt beides beim Verlassen zurück (§6, Tests BYL-E6-1908 und Smoke). MO-1b ändert daran nichts.
- **Bildschirmtastatur:** Sheets stehen unten im Top Layer mit einer Höhe aus `dvh`, Seiten haben `100dvh`. Mit `resizes-content` schrumpft der Viewport mit der Tastatur, Fuß und Absende-Knopf bleiben darüber. Prüfbar nur am Gerät (manueller Fall).

### 4. Warnung vor dem Verlassen

- Das Konzept (2.5) empfahl statt einer Warnung `overscroll-behavior-y: none`, also kein Ziehen zum Aktualisieren. Der Auftrag verlangt die Warnung; Ziehen zum Aktualisieren bleibt, weil es am Handy der Weg zum Neuladen ist und die Startansicht damit rechnet (§5).
- Nur im Rahmen hängt das `(app)`-Layout einen `beforeunload`-Listener an; er ruft `preventDefault()`, wenn `warnsBeforeLeaving(active, hasUnsavedInput())` gilt, und der Browser fragt mit seinem eigenen Text (Neuladen, Ziehen zum Aktualisieren, Schließen des Tabs, Link aus der App). Ohne Rahmen gibt es den Listener nicht, am PC ändert sich nichts.
- Was ungespeichert ist, melden die Stellen selbst über `registerUnsavedInput` (`lib/unsaved-input.ts`, reine Funktionen, gelesen erst beim Verlassen): jedes offene Modal mit `dirty` (Schnellerfassung und die Formulare der Dialoge), das Ticket mit denselben Bedingungen wie seine Frage beim Navigieren (Felder, Beschreibung, Tag-Eingabe, Kommentar, Vorlage), „Neues Ticket“, „Erfassen“ im Eingang, Projekt- und Regel-Panel. Navigationen in der App fragen weiter mit ihren eigenen Fragen.

### 5. Hinweise (Flags)

- Im Rahmen über der unteren Leiste und ihrer Safe Area (seit MO-1a).
- Solange ein Sheet oder eine Seite offen ist, oben unter der Statusleiste (`top: calc(0.5rem + var(--safe-top))`), damit sie weder Fuß noch Knöpfe verdecken: im Modal, in dem sie seit FL-1 stehen (Klasse `in-modal`), und neben einem Popover als Sheet (`:has([data-sheet]:popover-open)`).
- Ihre Knöpfe („Rückgängig“, „Übertragen …“, ×) haben über den Block in `base.css` 44 px.

### 6. Tests

- Vitest: `modalPlacement` und `warnsBeforeLeaving`; Modal (S und M als Sheet, L und XL als Seite, mittig ohne Rahmen, Wechsel im offenen Zustand, ungespeicherte Eingabe), Popover (Menü und Panel als Sheet mit „Schließen“ und Rückgabe des Fokus, am PC unverändert), Flags (Marke im Modal, Regeln), Layout (Warnung nur im Rahmen und nur mit Eingabe), statisch die 44 px in `base.css`, Panel und Vorschlagsliste, `enterkeyhint`.
- Smoke bei 360 × 800 mit Schalter: Schnellerfassung, Menü „•••“, die Frage „… in den Papierkorb verschieben?“ und die Auswahl „Gruppieren“ stehen unten über die volle Breite, „Schließen“ ab 44 px, kein waagerechtes Scrollen; ein Flag steht über der Leiste und vor einem offenen Sheet oben, nichts verdeckt es, „Rückgängig“ und × ab 44 px. Gegenprobe mit Schalter aus: Dialog mittig, Auswahl am Knopf, ohne „Schließen“.

### 7. Korrektur zu §9 und zu den Konsequenzen

- Der Smoke-Test dauert nicht „etwa eine Minute“: Mit MO-1a lief er in etwa 20 s, mit den zwei Fällen von MO-1b liegen die sechs Tests lokal bei etwa 9 s Testzeit.
- Er ist ein Schritt im Job „Linux build and test“. Dieser Job ist seit AR-3 ein Pflicht-Check des Rulesets „main“ (CLAUDE.md §12), ein roter Smoke-Test blockiert also jeden Merge: Der Smoke-Test ist damit faktisch Pflicht. Das Konzept MO-0 sah ihn zunächst als freiwilligen Check vor; ein eigener Job oder eine Ausnahme wäre eine neue Entscheidung.

## Nachtrag (2026-10-20, MO-2): Tagesplan

Gilt wie alles hier nur im Rahmen (`MobileLayoutStore.active`); am PC und mit ausgeschaltetem Schalter bleibt der Tagesplan, wie er ist, Tests belegen das. Nur Oberfläche, Tests und Doku, keine Hooks und keine Migration: nach dem Build F5. Entscheidung durch den Advisor (Auftrag MO-2 mit Umfang und Abgrenzung zu MO-3 ff.), den Nutzer („alles nach Empfehlung“ für die Fragen des Konzepts; „kein totales Verschwinden, sondern eher ausblenden, was weniger gebraucht wird“) und den Executor (Wahl zwischen den Varianten, die das Konzept offenlässt, Umsetzung, Tests). Umfang laut Konzept MO-0 §6: Zeile „Haken · Titel · •••“, Reihenfolge über „•••“ oder einen Modus, Vorschläge eingeklappt nach dem Plan, Pool als Abschnitt bzw. Sheet „Hinzufügen …“, Sortierung als Blatt, kompakter Kopf.

### 1. Zeile „Haken · Titel · •••“

- Ein Eintrag ist im Rahmen ein Raster aus drei Spalten: der Haken in einem Ziel von 44 × 44 px (ein `label` um das Kästchen, `.check-target`; ein Tipp irgendwo darin hakt ab, der Name bleibt der des Kästchens), der Titel im Rest der Zeile und „•••“ (44 px aus `base.css`). Ränder und Abstände sind knapp; bei 360 px nimmt der Titel etwa zwei Drittel der Zeile ein (Smoke: mindestens 60 %, auch eingerückt und bei 412 px).
- Nichts verschwindet: Charm, Key, „Vorhaben“, Zuständigkeit, „2/5“ und die Kontextzeile einer Unteraufgabe bleiben im Titelblock und brechen um; die Initialen im Haushalt stehen unter dem Titel statt daneben.
- Das `label` gibt es nur im Rahmen. Ohne Schalter würde es auf Touch-Bildschirmen über die Regel für Labels von Häkchen in `base.css` 44 px hoch, und die Zeile wüchse; deshalb verzweigt das Markup an dieser Stelle nach `active`.
- Kein Griff im Rahmen: Ziehen ist am Handy kein Weg (auf Touch-Bildschirmen war er schon ausgeblendet). Aus demselben Grund sind die Tickets des Pools im Rahmen nicht `draggable`; langes Drücken bleibt das des Browsers (Konzept 3.3).

### 2. Reihenfolge über „•••“

- Das Konzept nennt zwei Wege: „Nach oben/unten“ in „•••“ oder ein Modus „Reihenfolge ändern“ mit sichtbaren Pfeilen. Gewählt ist „•••“: kein neuer Modus und kein neuer Zustand, dasselbe Menü wie jede andere Aktion des Eintrags, dieselben Schritte wie die Knöpfe (`moveUp`/`moveDown`, ein Hauptticket mit seinem Block, TP-4), dieselbe Sperre an den Enden (`aria-disabled`) und dieselbe Ansage in der Statusregion („KEY steht jetzt an Stelle 2 von 5.“). Der Fokus bleibt auf „•••“ des verschobenen Eintrags. `Alt`+Pfeil bleibt für eine Tastatur.
- Die Einträge stehen nach den Aktionen des Eintrags und vor „Entfernen“, mit einer Linie davor; sortiert (TP-5) gibt es sie nicht, wie die Knöpfe.
- **Offen:** Mehrere Stellen kosten je zwei Tipps. Zeigt sich das am Gerät als lästig, wäre der Modus „Reihenfolge ändern“ die Erweiterung (Rückmeldung des Nutzers nach den manuellen Fällen).

### 3. Vorschläge und Pool nach dem Plan, eingeklappt

- Im Rahmen kommt zuerst der Plan. Die Vorschläge folgen ihm, eingeklappt mit ihrer Zahl (Konzept); der Pool folgt ihnen als Abschnitt „Hinzufügen …“, ebenso eingeklappt, mit derselben Suche und „+“. Das Markup ändert die Reihenfolge, nicht `order` in CSS, damit Lese- und Fokusreihenfolge dem Bild folgen. Auf- oder zugeklappt bleibt, solange die Ansicht steht; beim nächsten Öffnen ist beides wieder zu.
- Das Konzept lässt für den Pool Abschnitt oder Sheet offen. Gewählt ist der Abschnitt: Seine Tickets sind Links, die das Ticket öffnen, und Flags nach „+“ bleiben über der Leiste sichtbar; ein Sheet müsste sich dafür schließen. Eingeklappt ist er eine Ebene tiefer (Grundsatz §8), nicht verschwunden. Sein Hinweis nennt im Rahmen nur „+“, nicht das Ziehen; ebenso der leere Plan („Vorschläge übernehmen oder unter „Hinzufügen …“ mit „+“ aufnehmen.“).

### 4. Sortierung, Kopf, vergangene Tage

- „Sortierung“ steht seit MO-1b als Sheet; ihr Knopf hat im Rahmen 44 px, Richtung und „Als manuelle Reihenfolge übernehmen“ haben sie aus `base.css`.
- Der Kopf ist ein Block: der Tag über die volle Breite zwischen seinen Pfeilen (zentriert, er bricht um, statt etwas hinauszuschieben), darunter Fortschritt und Hinweis auf den anderen Bereich. Pfeile, „Heute“ und der Wechsel des Bereichs haben 44 px aus `base.css`; die Überschrift der Ansicht steht in der oberen Leiste (MO-1a). Die Abschnittsleiste hält im Rahmen nur noch die unsichtbare Überschrift (Ziel des Fokus) und nimmt im Tagesplan keinen Platz mehr ein (`position: absolute`); der Kopf beginnt direkt unter der oberen Leiste.
- Aufgeklappt trägt das Chevron der Vorschläge die Klasse `open`, die auf Touch-Bildschirmen auch die Regel für den Knopf „Öffnen“ trifft und es auf 44 px aufbläht. Im Rahmen behält es seine Größe; ohne Schalter bleibt die Ansicht unverändert (Grundsatz „Desktop unverändert“), der Fehler dort ist ein eigener Punkt.
- Vergangene Tage bleiben nur lesend: Kästchen gesperrt, kein „•••“, kein Pool, keine Vorschläge.

### 5. Tests

- Vitest (`components/day-plan/day-plan-phone.test.ts`): Zeile, Abhaken über das Ziel, Verschieben über „•••“ samt Sperre, Ansage und Fokus, `Alt`+Pfeil, sortiert ohne Verschieben, Reihenfolge und Einklappen von Vorschlägen und „Hinzufügen …“, Hinweise ohne Ziehen, vergangene Tage; Gegenprobe am PC mit Schalter an und am Handy mit Schalter aus; statisch die Regeln im Block des Rahmens. Die bestehenden Tests des Tagesplans laufen unverändert als Tests des PC.
- Smoke bei 360 × 800 und 412 × 915: Ziele, Anteil des Titels, Menü als Sheet mit „Nach unten“, Ansage und Fokus, Abhaken mit einem Tipp neben dem Kästchen, Vorschläge und „Hinzufügen …“ unter dem Plan, „Sortierung“ als Sheet, „+“, kein seitliches Scrollen; am PC Pfeile, Griff, Vorschläge vor dem Plan und der Pool daneben.

## Nachtrag (2026-10-20, MO-3): Aufgaben

Gilt wie alles hier nur im Rahmen (`MobileLayoutStore.active`); am PC und mit ausgeschaltetem Schalter bleibt „Aufgaben“ die Tabelle von heute, Tests belegen das. Nur Oberfläche, Tests und Doku, keine Hooks und keine Migration: nach dem Build F5. Entscheidung durch den Advisor (Auftrag MO-3 mit Umfang und Abgrenzung zu MO-4 ff.), den Nutzer („alles nach Empfehlung“ für die Fragen des Konzepts, ergänzt um „nichts verschwindet ganz … Sammelaktionen über „Auswählen““) und den Executor (Varianten, die das Konzept offenlässt, Umsetzung, Tests). Umfang laut Konzept MO-0 §6: Karten statt Tabelle unter 40rem, Filter-Sheet mit Filter-Karten, Chip-Gruppen, Projekt, Tag, Zuständig, Gruppieren und Sortierung, Suche oben, „Angeheftet“, Gruppen und eingerückte Unteraufgaben bleiben, Status-Pille als `StatusMenu`, Sammelaktionen nach Produktfrage 4.

### 1. Karten statt Tabelle

- Dieselbe `TicketTable` verzweigt nach `active`: im Rahmen eine Liste von Karten (`ol` je Abschnitt), sonst die Tabelle. Die Karte `TicketCard` ist das Gegenstück der Zeile (`TicketTableRow`) mit demselben Store, denselben Abschnitten (`pinned`, `groups`, `visible`), derselben Anordnung der Unteraufgaben (`arrangeRows`), denselben Links (`ticketLinks()`), demselben Menü (`TicketActions`), demselben Pin (`TicketPinToggle`) und denselben Rückfragen (Unteraufgaben, „Vorhaben abschließen?“). Keine zweite Ansicht, keine eigene Route. Eine Zeile der Tabelle per CSS zur Karte umzubauen, ist verworfen (Konzept 4.2: Tabellen-Semantik, `fitColumns`, Sortieren an den Köpfen).
- **Erste Zeile:** der Haken in einem Ziel von 44 × 44 px (`label` `.check-target` wie im Tagesplan, ein Tipp irgendwo darin hakt ab, der Name bleibt „KEY erledigt“), der Titel bis zu drei Zeilen (`line-clamp`, ab 60 Zeichen mit `title`; davor Pfad bzw. Ecke einer Unteraufgabe, Symbol der Quelle, Charm), Pin und „•••“ (je 44 px aus `base.css`). **Zweite Zeile**, gedämpft und umbrechend: Key mit Punkt „neu“, die Status-Pille als `StatusMenu` (Ziel 44 px), Priorität, Fälligkeit relativ, Projekt mit seinem Farbpunkt, Initialen im Haushalt, „2/5“, „wiederkehrend“, „Vorhaben“ und die Zahl der Tags („2 Tags“; die Namen im `title` und für Screenreader). Die Farbe des Tickets ist wie in der Zeile ein Streifen am Anfang.
- **Wohin die Spalten gehen** (nichts verschwindet, Grundsatz §8): Auswahl → „Auswählen“ (§4); Key, Priorität, Status, Zuständig, Projekt, Fällig → zweite Zeile; Übergeordnet → Pfad vor dem Titel bzw. Einrückung; Quelle → Symbol vor dem Titel, ihr Name im Ticket; Tags → Zahl, die Tags selbst im Ticket; Erstellt → im Ticket (Meta), sortieren nach „Erstellt“ im Sheet; „Öffnen“ → Tipp auf die Karte; Bearbeiten in Zellen → Status über die Pille, die übrigen Felder im Ticket.
- Ein Tipp auf die Karte außerhalb ihrer Knöpfe öffnet das Ticket wie der Klick auf die Zeile; der Titel bleibt der Link für Tastatur und Screenreader. Mit der Maus öffnet ein Rechtsklick auf die Karte das Menü (`data-menu-row`), langes Drücken auf Touch bleibt das des Browsers.
- **Menü „Spalten“:** Ohne Spalten gibt es nichts zu zeigen, zu verbreitern oder zu schmälern; diese Wahl gilt nur für die Tabelle am PC. Der einzige Schalter des Menüs, der auch Karten betrifft („Unteraufgaben einrücken“, `NEST_SUBTASKS`, gemerkt je Gerät), steht im Sheet unter „Darstellung“.

### 2. Werkzeugzeile und Filter-Sheet

- **Zeile der Ansicht statt Kopf der Liste:** Das Konzept setzt Suche und „Filter (n)“ in die obere Leiste. Dort stehen seit MO-1a Name der Ansicht und Bereichs-Umschalter; für ein Suchfeld blieben bei 360 px mit Umschalter keine 80 px. Gewählt ist deshalb eine Zeile direkt unter der oberen Leiste: die Abschnittsleiste zeigt im Rahmen statt ihrer Knöpfe die Knöpfe des Rahmens (§3), hier die Suche (dieselbe wie am PC, `FilterBar` `part="search"`), „Filter“ mit der Zahl gesetzter Filter (`activeFilterCount`: Karten und Filter, ohne Suche, Sortierung und Gruppierung; Name „Filter, 2 aktiv“, gesetzt mit Akzentfläche) und „•••“ der Liste mit „Auswählen“, „Alle als gelesen markieren“ (nur mit neuen Tickets) und „Erledigte ansehen“ (mit den Filtern beider Ansichten). Sie scrollt mit; über ihr bleibt die obere Leiste stehen. Die erste Karte beginnt bei 360 × 780 weit über 400 px (Smoke).
- **Filter-Sheet** (`FilterSheet`, das Modal M, im Rahmen ein Sheet): zuerst die Filter-Karten, dann die Chip-Gruppen und „Projekt“, „Tag“, „Zuständig“ (`FilterBar` `part="filters"`, dieselben Teile wie die Leiste des PC aus dem Layout), dann „Gruppieren“ mit beiden Ebenen (`GroupPopover` `inline`, ohne eigenes Popover), „Sortieren nach“ (`SortChoice`, siehe unten) und „Darstellung“. Jede Wahl wirkt sofort wie am PC (eine Navigation, der Zustand steht in der URL, Zurück und Vor wie heute), die Liste dahinter folgt, das Sheet bleibt offen. Im Fuß „Zurücksetzen“ (Karten, Filter und Suche, wie die Leiste; gesperrt ohne Filter) und „N Tickets anzeigen“, das schließt; der Fokus geht an „Filter“ zurück. `FilterSummary` bleibt über der Liste.
- **Sortierung:** Karten haben keine Spaltenköpfe. „Sortieren nach“ ist eine Chip-Gruppe mit „Standard“ und den sortierbaren Spalten, nach der Wahl folgt „Reihenfolge“ mit den Worten der Spalte („Dringend zuerst“ | „Niedrig zuerst“). Eine neue Spalte beginnt in ihrer natürlichen Richtung wie der erste Klick auf einen Kopf, dieselbe behält ihre Richtung (`chooseSortKey`); jede Wahl ist ein Eintrag im Verlauf wie der Klick auf einen Kopf. Sortiert nennt eine Zeile über den Karten die Reihenfolge („Sortiert nach Titel, A bis Z“), unsortiert steht „Standard-Reihenfolge“ nur für Screenreader.
- **Zwei Tipps:** „Filter“ öffnet das Sheet, der zweite Tipp setzt eine Karte, einen Chip, eine Gruppierung oder eine Sortierung. „Projekt“, „Tag“ und „Zuständig“ öffnen mit dem zweiten Tipp ihre Auswahl als Sheet über dem Sheet (MO-1b); erst der dritte wählt, wie am PC.

### 3. Abschnittsleiste zentral

- Im Tagesplan nahm die leere Abschnittsleiste seit MO-2 per eigener Regel keinen Platz ein. Seit MO-3 entscheidet `SectionBar` selbst, was sie im Rahmen zeigt: Mit dem Snippet `phone` zeigt sie nur diese Knöpfe in einer Zeile (die Zahl dann nur für Screenreader); ohne eigene Knöpfe und ohne Zahl (`bare`, der Tagesplan) nimmt sie keinen Platz ein; jede andere Ansicht zeigt ihre Leiste bis zu ihrem Paket wie bisher. Der Tagesplan verhält sich unverändert, seine eigene Regel ist entfallen.

### 4. Auswählen und Bereich per Tippen (Produktfrage 4)

- Die Sammelaktionen bleiben, eine Ebene tiefer (Nutzer: „Sammelaktionen über „Auswählen““): „Auswählen“ im Menü der Liste zeigt auf jeder Karte statt des Hakens das Kästchen „KEY auswählen“ (44 px), ein Tipp auf die Karte wählt sie, und darüber steht die Gruppe „Auswahl“ mit „Alle“ (wie die Kopf-Checkbox: alle gefilterten, mit Zwischenzustand), „Bereich“ und „Fertig“ (verlässt den Modus und hebt die Auswahl auf). Die Leiste der Sammelaktionen erscheint wie am PC ab einem gewählten Ticket; im Rahmen haftet sie unter der oberen Leiste (`SelectionBar`, betrifft auch den Papierkorb nur im Rahmen).
- **Bereich per Tippen:** Umschalt+Klick hat am Handy keine Taste. „Bereich“ (`aria-pressed`) macht den nächsten Tipp zu einem solchen Klick: Er wählt alle Karten vom zuletzt gewählten bis zum getippten (`clickRow` mit `range`, `domain/selection.ts`), danach ist „Bereich“ wieder aus; gesperrt, solange noch nichts gewählt ist. Das Konzept beantwortet den Weg nicht; gewählt ist der zurückhaltendste, der ohne neue Geste und ohne Änderung am PC auskommt (offene Frage an den Nutzer im Bericht von MO-3).

### 5. Leistung

- Die Tabelle ist nicht virtualisiert und rendert alle sichtbaren Zeilen; die Karten tun dasselbe, ohne Paginierung. Sie haben weniger Elemente als die Zeilen (Test mit 30 Tickets): nur die Status-Pille ist ein Editor, `fitColumns`, der `ResizeObserver` des Rahmens und das Messen der Tags laufen im Rahmen nicht. Ab etwa 300 offenen Tickets am Gerät messen (Konzept 2.7), eine Grenze wie „Weitere anzeigen“ erst danach.

### 6. Tests

- Vitest (`components/ticket-table-phone.test.ts`, `filter-bar-phone.test.ts`, `section-bar.test.ts`, `domain/phone-tasks.test.ts`): Karte, zweite Zeile, Tipp öffnet, Haken mit einem Tipp, Status über die Pille, Gruppen, „Angeheftet“, eingerückte Unteraufgaben, Werkzeugzeile, Menü der Liste, Filter-Sheet mit Sortierung, Darstellung und „Zurücksetzen“, „Auswählen“ mit „Alle“, „Bereich“ und „Fertig“, weniger Elemente als die Tabelle, die Teile der Filterleiste und „Gruppieren“ eingebettet, die Abschnittsleiste im Rahmen; Gegenprobe am PC mit Schalter und am Handy ohne Schalter; statisch die Regeln im Block des Rahmens und die Liste der Dateien in `breakpoints.test.ts`. Die bestehenden Tests der Tabelle laufen unverändert als Tests des PC.
- Smoke bei 360 × 780, 360 × 800 und 412 × 915: Karten statt Tabelle, die erste über 400 px, Haken, „•••“ und Pille ab 44 px, Titel bis drei Zeilen, „Filter“ als Sheet, Sortieren mit Eintrag im Verlauf (Zurück und Vor), Abhaken mit einem Tipp und „Rückgängig“, „Auswählen“ mit „Bereich“ und der Leiste der Sammelaktionen, kein seitliches Scrollen; am PC Tabelle, Filterleiste, „Gruppieren“, „Spalten“, keine Karten. Der Fall „Auswahl als Sheet“ aus MO-1b prüft seither das Filter-Sheet mit „Gruppieren“ und darin „Projekt“ als Sheet über dem Sheet, weil „Gruppieren“ im Rahmen keinen eigenen Knopf mehr hat.

## Nachtrag (2026-10-20, MO-4): Ticket-Detail

Gilt wie alles hier nur im Rahmen (`MobileLayoutStore.active`); am PC und mit ausgeschaltetem Schalter bleiben Seitenpanel, Felder und Editor, wie sie sind, Tests belegen das. Nur Oberfläche, Tests und Doku, keine Hooks und keine Migration: nach dem Build F5. Entscheidung durch den Advisor (Auftrag MO-4 mit Umfang, Pflichten und Abgrenzung zu MO-5 ff.), den Nutzer („alles nach Empfehlung“ für die Fragen des Konzepts; „kein totales Verschwinden, sondern eher ausblenden, was weniger gebraucht wird“) und den Executor (Varianten, die das Konzept offenlässt, Umsetzung, Tests). Umfang laut Konzept MO-0 §6: Drawer-Seite mit einspaltigen Feldern (`TicketFields`), Editor-Leiste 44 px und umbrechend, Kommentar-Eingabe über der Tastatur, feste Aktionsleiste unten (Erledigt, Status), „Neues Ticket“ als Vollbild mit festem Fuß, `TicketPicker` und Tag-Eingabe mit Tastatur geprüft, Panels von Eingang, Projekt und Regel in derselben Seitenform; dazu aus MO-1b der Zurück-Pfeil im Kopf, „Vollansicht“ am Handy und die Leiste des Editors, aus MO-3 das Kartenmenü und die Felder des Tickets.

### 1. Jedes Seitenpanel ist eine Seite

- Der Baustein entscheidet selbst, die Aufrufer setzen nichts: Der `Drawer` fragt `active`. Im Rahmen beginnt sein Kopf mit einem Pfeil zurück (`.button-icon`, 44 px aus `base.css`, Name aus `backLabel`, ohne Angabe „Zurück“), danach Kontext und Aktionen; × und „Vollansicht öffnen“ gibt es dort nicht. Der Pfeil ruft `onback`, ohne es den Weg des ×; Esc und der Schleier schließen wie bisher. So bekommen alle Panels dieselbe Seitenform (Konzept): Ticket, Eintrag des Eingangs, Projekt, Regel, „Neues Ticket“ mit seinem festen Fuß, „Erfassen“, Vorschau im Papierkorb. Ihre Inhalte passen MO-6 und MO-7 an.
- `ViewWithPanel` legt die Seite auch zwischen 36 und 40rem über die volle Breite (vorher 480 px mit einem Streifen Schleier); der Drawer hat im Rahmen keine Linie am Rand und die Ränder der Seite (`--page-inline`). Platziert wird weiter nur in `ViewWithPanel`; der Drawer hat seither einen Block des Rahmens, der nichts platziert (Test angepasst).
- Der Pfeil eines Tickets heißt wie der Rückweg seines Gastgebers: „Zur Liste“, „Zum Tagesplan“, „Zum Eingang“, „Zu den Projekten“, „Zum Kalender“, „Zu den Erledigten“, „Zu den Wiederholungen“ (`backLabel`, schon die Beschriftung des Links in „Ticket nicht gefunden“).

### 2. Rückweg über den Verlauf

- Das Konzept gibt dem Pfeil „die gleiche Funktion wie das ×“. Das × navigiert zur Ansicht (`goto(back)`): ein neuer Eintrag der Liste, SvelteKit scrollt nach oben, und die Zurück-Geste öffnete danach das Ticket wieder. Der Auftrag verlangt dagegen, dass Pfeil und Zurück-Geste zur Liste mit erhaltenem Zustand führen. Gewählt: Liegt die Ansicht im Verlauf direkt vor dem Ticket, geht der Pfeil wie die Zurück-Geste mit `history.back()` zurück. Filter und Sortierung stehen in der Adresse, die Scroll-Position stellt SvelteKit für diesen Eintrag wieder her, und es entsteht kein zweiter Eintrag der Liste. Sonst (Ticket von außen geöffnet, neu geladen, aus einem anderen Ticket oder einer Unteraufgabe) navigiert der Pfeil wie das ×; der Zustand der Adresse bleibt, die Seite beginnt oben.
- Das `(app)`-Layout merkt sich nach jeder Navigation die Seite davor, wenn sie bekannt ist (`lib/way-back.ts`: nach einem Link oder `goto` und einen Schritt „Vor“; nicht beim Start, nach Neuladen, Zurück, mehreren Schritten oder einem Formular); `goBack` vergleicht Pfad und Query mit dem Rückweg. Annahme: Jeder Weg aus einer Ansicht in ihr Ticket legt einen Eintrag an (Links, `goto` ohne `replaceState`); keiner ersetzt bisher den Eintrag der Ansicht.
- Ungespeichertes fragt wie bei der Zurück-Geste: `beforeNavigate` hält auch `history.back()` an, „Verwerfen“ geht den Schritt erneut. Für Neuladen und Schließen des Tabs gilt weiter `registerUnsavedInput` (MO-1b).
- Keine Sackgasse zwischen Panel und Vollansicht: Die Vollansicht ist im Rahmen nicht verlinkt (§3); per Adresse geöffnet ist sie eine Seite, deren × unter 64rem zurück auf die Seite des Tickets führt.

### 3. Vollansicht am Handy nicht verlinkt

- Die Vollansicht zeigt dieselben Teile wie das Panel, unter 64rem in einer Spalte, und schließt unter 64rem zurück ins Panel; am Handy wäre sie nur ein Umweg (Konzept 2.6 und 3.2: „am Handy nicht verlinkt“, „keine Vollansicht-Option“). Im Rahmen fehlen deshalb „Vollansicht öffnen“ im Kopf und „In Vollansicht öffnen“ im Menü „•••“ der Karten und Zeilen (`TicketActions`); „Im Seitenpanel öffnen“ bleibt. Nichts verschwindet: Jeder Teil steht auf der Seite, und die Adresse `…/voll` funktioniert weiter.

### 4. Felder untereinander, feste Leiste unten

- Das Konzept lässt offen, ob die Felder gestapelt stehen (Label über dem Wert) oder mit einer Label-Spalte von 6rem. Gewählt ist gestapelt: Jedes Bedienelement bekommt die ganze Breite der Seite (die Farben in zwei Spalten statt elf Zeilen, Tags, die Auswahl des übergeordneten Tickets), die Auswahlen bleiben so breit wie ihr Inhalt.
- Die feste Leiste im Fuß der Seite hält „Erledigt“ und den Status. „Erledigt“ ist das Kästchen der Liste (`DoneToggle`, Name „KEY erledigt“) in einem Ziel von 44 px mit dem sichtbaren Wort; ein Tipp setzt „Erledigt“ über denselben Weg wie die Auswahl des Status (Rückfrage „Vorhaben abschließen?“, offene Unteraufgaben), ein zweiter öffnet wieder („Offen“). Die Fragen des Status stehen in der Leiste über den beiden, damit sie dort erscheinen, wo getippt wurde.
- Der Status steht im Rahmen nur in der Leiste, nicht zusätzlich in den Feldern: zwei Bedienelemente für dasselbe Feld wären doppelt, die Leiste ist immer sichtbar. `TicketFields` hat dafür die Teile `part` „fields“ (Seite) und „bar“ (Leiste); das Bedienelement des Status ist ein Snippet mit seiner einen Markierung `data-ticket-option="status"`, also keine neue Option, und der Paritätstest bleibt unverändert grün. Am PC und in der Vollansicht bleibt `part` „all“.
- Die Leiste bleibt beim Tippen stehen, anders als die untere Leiste der App: Sie hält den Weg zu „Erledigt“ mit einem Tipp; die Knöpfe zum Speichern stehen über ihr (§5).

### 5. Editor, Kommentare und Bildschirmtastatur

- Die Werkzeugleiste des Editors hat im Rahmen Werkzeuge, „Textstil“ und „Markdown“ mit 44 px und bricht um (ihre spezifischere Regel von 28 px wird im Rahmen überschrieben); unter 560 px bleiben Listen und Blöcke im Menü „Listen und Blöcke“.
- „Speichern“ und „Abbrechen“ der Beschreibung, „Kommentieren“ und „Speichern“ eines bearbeiteten Kommentars haften im Rahmen unten im scrollenden Inhalt (`position: sticky`): Ist der Text länger als der Platz, bleiben sie über der Leiste sichtbar, und mit `interactive-widget=resizes-content` (seit MO-1a) steht beides über der Tastatur. Reiter „Kommentare“/„Verlauf“, „Kommentar hinzufügen …“ und „Schreiben“/„Vorschau“ des Quelltextmodus haben 44 px.
- `TicketPicker` und Tag-Eingabe: Ihre Vorschlagsliste bleibt am Feld (MO-1b), Optionen ab 44 px; die Chips der Tags sind 44 px hoch mit einem × von 44 × 44 px. Mit Tastatur prüft das der manuelle Fall.

### 6. Ziele und Überlauf

- 44 px im Rahmen, unabhängig vom Zeiger: Haken der Unteraufgaben (ein `label` `.check-target` wie in den Karten, nur im Rahmen, weil es sonst auf Touch-Bildschirmen die Zeile vergrößerte), ihr Titel und Status, die Schritte des Pfads im Kopf (`Breadcrumbs`), der Key des übergeordneten Tickets, die Charms der Auswahl. Eine Aufgabe in der Beschreibung oder einem Kommentar hat ein unsichtbares Feld von 44 × 44 px um ihr Kästchen (`::after`), die Punkte stehen so weit auseinander, dass sich die Felder nicht berühren; das Kästchen behält seine Größe im Text.
- Ausgenommen sind Links im Fließtext (Beschreibung, Kommentare, Hinweise), wie in WCAG 2.5.8 („inline“).
- Kein seitliches Scrollen: Titel und lange Wörter brechen um, Codeblöcke und Tabellen scrollen in ihrem eigenen Kasten (`prose.css`, unverändert), Bilder zeigt die Anzeige von Markdown nicht.

### 7. Tests

- Vitest: `way-back.test.ts` (Seite davor, `goBack`), `components/ticket-detail-phone.test.ts` (Drawer als Seite, Ticket mit Pfeil, Feldern, Leiste und Frage, Kartenmenü, Gegenprobe am PC mit Schalter und am Handy ohne Schalter, statisch die Regeln des Rahmens). Angepasst: die Liste der Dateien mit Regeln des Rahmens in `breakpoints.test.ts` und in `view-with-panel.test.ts` die Prüfung, dass der Drawer nichts platziert (er hat jetzt einen Block des Rahmens ohne Position und Breite). Die übrigen Tests von Panel, Vollansicht, Feldern und Editor laufen unverändert als Tests des PC.
- Smoke bei 360 × 800 und 412 × 915: das Ticket als Seite, Pfeil statt × und „Vollansicht“, jedes Ziel ab 44 px, kein seitliches Scrollen von Seite und Inhalt (ein Wort als Titel, langer Link, Code, Tabelle), Felder untereinander, Leiste unten mit der Frage zur offenen Unteraufgabe, Aufgabe im Text per Tipp neben dem Kästchen, „Speichern“ und „Kommentieren“ sichtbar über der Leiste, Werkzeugleiste in zwei Reihen, Vorschläge der Tags am Feld, Pfeil und Zurück-Geste zur Liste mit Sortierung und Scroll-Position, „Vor“ öffnet das Ticket wieder, Kartenmenü ohne „In Vollansicht öffnen“; am PC das Panel wie bisher. Der Fall von MO-1b prüft seither den Pfeil „Zum Tagesplan“ statt des ×. Zwölf Tests, lokal etwa 17 s.

## Nachtrag (2026-10-20, MO-5): Schnellerfassung

Gilt wie alles hier nur im Rahmen (`MobileLayoutStore.active`); am PC und mit ausgeschaltetem Schalter bleibt die Schnellerfassung, wie sie ist, Tests belegen das. Nur Oberfläche, Tests und Doku, keine Hooks und keine Migration: nach dem Build F5. Entscheidung durch den Advisor (Auftrag MO-5 mit Umfang, Pflichten und Abgrenzung zu MO-6 ff.), den Nutzer („＋“: Ticket als Hauptknopf, daneben „In den Eingang“; „alles nach Empfehlung“ für die Fragen des Konzepts) und den Executor (Varianten, die das Konzept offenlässt, Umsetzung, Tests). Umfang laut Konzept MO-0 §6: Sheet über „＋“, `enterkeyhint` und `autocapitalize`, Hinweise ohne Tastenkürzel am Handy, zwei Knöpfe und „Projekt“, Ergebnis mit „Ansehen“, optional „Alle Felder …“ mit übernommenem Titel und `shortcuts` im Manifest; dazu aus MO-1b `autocapitalize` und das eigene Sheet, aus MO-4 der Rückweg nach „Ticket ansehen“.

### 1. Dieselbe Schnellerfassung als Sheet

- Keine zweite Komponente: `QuickCapture` verzweigt nach `active`. Kurzsyntax (`parseQuickEntry`, `withProjectToken`), Speichern (`saveQuickEntry` im `(app)`-Layout) und die Rückmeldung bleiben dieselben. Das Modal M steht seit MO-1b im Rahmen als Sheet (`modalPlacement`); daran ändert MO-5 nichts.
- **Ein Tipp bis zum Tippen:** „＋“ öffnet das Sheet, der Fokus liegt sofort in der Zeile (`initialFocus`), die Bildschirmtastatur geht auf, die untere Leiste weicht ihr (MO-1a). Anlegen heißt: „＋“, tippen, Enter der Tastatur oder „Ticket anlegen“, also zwei Tipps um das Tippen herum.
- **Zeile:** `enterkeyhint="done"` (seit MO-1b, auch am PC) und im Rahmen `autocapitalize="sentences"`. Anders als `enterkeyhint` steht `autocapitalize` nur im Rahmen: Es ändert am Handy ohne Schalter die Großschreibung der Tastatur, und dort bleibt alles, wie es war. Titel und Kommentare an anderen Stellen bekommen es mit ihren Paketen (seit MO-7a, Nachtrag unten §3).

### 2. Zwei Knöpfe nebeneinander, das × schließt

- Der Fuß hält im Rahmen nur „In den Eingang“ und „Ticket anlegen“ (primär, rechts) nebeneinander in gleicher Breite, je mindestens 44 px hoch (`base.css`); untereinander stehen sie nur, wenn ihre Wörter nicht nebeneinander passen (große Systemschrift). „Abbrechen“ bzw. „Schließen“ des Fußes entfällt dort: Das × im Kopf (48 px) schließt sichtbar, Esc, Schleier und die Zurück-Geste von Android ebenso, mit derselben Frage bei getipptem Text. So bleibt der Fuß über der Tastatur eine Zeile hoch (Konzept 3.2: „zwei Knöpfe“). Von der Regel des Modals („Abbrechen“, solange nichts gespeichert ist, sonst „Schließen“) weicht nur dieses Sheet ab.
- **Die Tastatur bleibt offen:** Ein Druck auf einen der beiden Knöpfe nimmt der Zeile den Fokus nicht (`mousedown` mit `preventDefault`, nur im Rahmen), der Klick läuft wie bisher. Sonst schlösse sich die Tastatur beim Tipp auf den Knopf und ginge nach dem Speichern wieder auf. Am PC nimmt der Knopf den Fokus wie bisher.
- „In den Eingang“ braucht kein Alt; `Alt+Enter` bleibt für eine Tastatur.

### 3. Hinweise ohne Tasten, Hilfe eingeklappt

- Im Rahmen nennt der Hinweis keine Tasten („Enter legt …, Alt+Enter …“ entfällt). Die Hilfe zur Kurzsyntax (Beispiel, Prioritäten, „Mehr zur Kurzsyntax“ im neuen Tab) steht eingeklappt unter „Hilfe zur Kurzsyntax“ (`details`, Kopf 44 px), eine Ebene tiefer statt verschwunden; sie beschreibt die Zeile weiter (`aria-describedby`).
- „Erste Schritte“ bietet die Schnellerfassung im Rahmen mit „Öffnen“ ohne `c` an, wie der leere Zustand von „Aufgaben“ seit MO-3. Die Hilfe-Seite mit ihren Tasten folgt mit MO-7.

### 4. Rückmeldung und nächste Zeile

- Nach dem Speichern bleibt das Sheet offen (Konzept). Ergebnis („Ticket HAUS-12 angelegt.“ mit „Ticket ansehen“ bzw. „„…“ liegt im Eingang.“ mit „Eintrag ansehen“) und Fehler stehen im Rahmen direkt unter der Zeile und ihrer Vorschau, also über der Tastatur, in denselben Live-Regionen; der Link hat 44 px. Am PC bleiben sie nach dem Hinweis. Die Zeile ist danach leer und behält den Fokus für die nächste.

### 5. „Ticket ansehen“ ohne Schleife

- Geprüft, nicht geändert: Der Link öffnet das Ticket in der Ansicht der aktuellen Route (`ticketHrefIn`, ADR-0054 §8) und schließt das Sheet. Das Sheet ist ein `<dialog>` ohne eigenen Eintrag im Verlauf, nur das Ticket kommt hinzu. Der Pfeil der Seite geht mit `history.back()` zur Ansicht zurück, weil sie direkt davor liegt (MO-4); das Sheet geht nicht wieder auf, sein Zustand steht nicht im Verlauf. Die Zurück-Geste tut dasselbe, „Vor“ öffnet das Ticket wieder.
- Ungespeicherter Text bleibt geschützt wie seit MO-1b (`registerUnsavedInput` des Modals): × und Zurück-Geste fragen „Änderungen verwerfen?“, beim Neuladen fragt der Browser.

### 6. Nicht umgesetzt

- „Alle Felder …“ mit übernommenem Titel und `shortcuts` im Manifest sind im Konzept optional. „Alle Felder …“ bräuchte einen neuen Query-Parameter von `/tickets/neu`, sonst ginge der getippte Text verloren; „Neues Ticket“ steht unter „Mehr“. `shortcuts` wirken nur in einer installierten App (MO-8) und gälten auch am PC. Beides bleibt eine Frage an den Nutzer (Bericht von MO-5).

### 7. Tests

- Vitest (`components/quick-capture-phone.test.ts`): Sheet mit Fokus, `autocapitalize` und `enterkeyhint`, zwei Knöpfe ohne „Abbrechen“, das × schließt, Hinweis ohne Tasten, Hilfe eingeklappt, Ergebnis und Fehler unter der Zeile, „In den Eingang“ ohne Alt, der Fokus bleibt beim Druck auf die Knöpfe, ungespeicherter Text; „Erste Schritte“ ohne `c`; Gegenprobe am PC mit Schalter und am Handy ohne Schalter; statisch die Regeln im Block des Rahmens. Angepasst: die Liste der Dateien mit Regeln des Rahmens in `breakpoints.test.ts` und im Smoke-Fall von MO-1b die Knöpfe des Fußes (ohne „Abbrechen“). Die übrigen Tests der Schnellerfassung laufen unverändert als Tests des PC.
- Smoke bei 360 × 800 und 412 × 915: ein Tipp auf „＋“, Fokus in der Zeile, untere Leiste weg, zwei Knöpfe nebeneinander, keine Tasten im Hinweis, jedes Ziel ab 44 px, kein seitliches Scrollen; mit einem Fenster von 360 × 500 (so verkleinert `interactive-widget=resizes-content` den Viewport bei offener Tastatur) bleiben Zeile, Knöpfe und Ergebnis sichtbar und unverdeckt; Enter, „In den Eingang“ und „Ticket anlegen“ legen an und lassen den Fokus in der leeren Zeile; „Ticket ansehen“ legt genau einen Eintrag im Verlauf an, der Pfeil führt ohne Sheet zum Tagesplan zurück, „Vor“ und Zurück wie erwartet. Am PC steht die Schnellerfassung mittig mit „Abbrechen“ und den Tasten im Hinweis. Die echte Tastatur und die Zurück-Geste prüfen die manuellen Fälle.

## Nachtrag (2026-10-20, MO-6): Eingang

Gilt wie alles hier nur im Rahmen (`MobileLayoutStore.active`); am PC und mit ausgeschaltetem Schalter bleiben Eingang, Eintrag, „Erfassen“ und Umwandeln, wie sie sind, Tests belegen das. Nur Oberfläche, Tests und Doku, keine Hooks und keine Migration: nach dem Build F5. Entscheidung durch den Advisor (Auftrag MO-6 mit Umfang, Pflichten und Abgrenzung zu MO-7 und OF-2), den Nutzer („alles nach Empfehlung“ für die Fragen des Konzepts; „nichts verschwindet ganz … Sammelaktionen über „Auswählen““) und den Executor (Varianten, die das Konzept offenlässt, Umsetzung, Tests). Umfang laut Konzept MO-0 §6: Karten mit „Umwandeln“, „Verwerfen“ und „•••“, Chips Quelle, Zustand und Zielprojekt im Filter-Sheet, Eintrags-Panel als Seite, `/eingang/neu` handytauglich, „Aus Zwischenablage“ über HTTP mit Einfügen als Rückfall geprüft, „Gesammelt umwandeln“ nach Produktfrage 4; dazu aus MO-4 die Inhalte des Eintrags, aus MO-5 der Rückweg nach „Eintrag ansehen“ und `autocapitalize`/`enterkeyhint` in „Erfassen“.

### 1. Karten statt Tabelle

- Dieselbe `InboxTable` verzweigt nach `active` wie `TicketTable` in MO-3: im Rahmen eine Liste von Karten (`ol` je Gruppe), sonst die Tabelle. Die Karte ist ein Snippet neben dem der Zeile, mit demselben Store, denselben Gruppen nach Zielprojekt, demselben Menü „•••“, denselben Links und demselben „Verwerfen“ samt Fokus auf die nächste Karte. Keine zweite Komponente, keine eigene Route.
- **Inhalt** (Konzept 3.2): der Titel bis zu drei Zeilen (der Link auf den Eintrag, lange Wörter brechen um), der Hinweis auf ein mögliches Duplikat mit „Dem Ticket … zuordnen“, darunter gedämpft Art, Quelle mit ihrer Verbindung (`withConnectionName` wie im Panel), das Datum, nach dem die Liste ordnet („Eingang …“, „Verworfen …“, „Verknüpft …“), das Quelldatum und das Zielprojekt, je mit ihrem Namen; dann „Umwandeln“ und „Verwerfen“ (44 px), bei verworfenen „Wiederherstellen“, bei verknüpften der Chip „→ HAUS-12“; „•••“ am Ende. Ein Tipp auf die Karte außerhalb ihrer Knöpfe öffnet den Eintrag (`isCardTap` in `lib/card-tap.ts`, seit MO-6 gemeinsam mit `TicketCard`).
- **Wohin die Spalten gehen** (nichts verschwindet): Auswahl → „Auswählen“ (§3); Art, Quelle, Zielprojekt, Quelldatum, Eingang → zweite Zeile; Aktionen → Knöpfe und „•••“. „Spalten“ entfällt im Rahmen (ohne Spalten funktionslos), die Zahl der Einträge steht nur für Screenreader da.
- Über den Karten nennt eine Zeile Zustand und Gruppierung, solange sie nicht „Neu“ ohne Gruppierung sind („Eingang · verworfen, zuletzt verworfene zuerst“); sonst steht sie nur für Screenreader da (wie die Sortierung in MO-3).

### 2. Zeile der Ansicht und Filter-Sheet

- Die Abschnittsleiste zeigt mit dem Snippet `phone` (MO-3) „Erfassen“, „Filter“ mit der Zahl der gesetzten Filter (`FilterButton`, seit MO-6 gemeinsam mit „Aufgaben“) und „•••“ der Liste mit „Auswählen“ (nur bei neuen Einträgen), „Aus Zwischenablage“ und „Alle Kanäle jetzt abrufen“; dessen Status („„Web.de“ wird abgerufen (2 von 3) …“) steht in einer höflichen Live-Region unter der Zeile, das Ergebnis wie bisher im Flag.
- **Filter-Sheet:** derselbe `FilterSheet` wie in MO-3, ohne „Gruppieren“ und „Sortieren nach“ der Tickets (`ticketOrder`) und mit „N Einträge anzeigen“ (`noun`). Darin stehen die Chips „Quelle“ und „Zustand“, „Zielprojekt“ (seine Auswahl als Sheet über dem Sheet, MO-1b) und „Nach Zielprojekt gruppieren“, dieselben Teile wie über der Tabelle des PC. Jede Wahl ist eine Navigation wie am PC (Zustand in der URL, Zurück und Vor); „Zurücksetzen“ leert Quelle und Zielprojekt, Zustand und Gruppierung bleiben (wie „Filter zurücksetzen“).
- „Filter (n)“ zählt Quelle und Zielprojekt, nicht den Zustand: Er ist die Sicht der Liste, „Zurücksetzen“ leert ihn nicht, und die Zeile über den Karten nennt ihn.
- Die Dateien (`DropZone`) stehen im Rahmen nach der Liste, eine Ebene tiefer; ihr Hinweis nennt dort „Datei wählen“ statt „hierher ziehen“.

### 3. Auswählen (Produktfrage 4)

- „Auswählen“ zeigt auf jeder neuen Karte das Kästchen „Eintrag „…“ auswählen“ in einem Ziel von 44 px, ein Tipp auf die Karte wählt; darüber steht die Gruppe „Auswahl“ mit „Alle“, „Fertig“ (verlässt den Modus und hebt die Auswahl auf) und den Sammelaktionen „Gesammelt umwandeln (n)“ und „Mit Ticket verknüpfen … (n)“, dieselben Knöpfe und Dialoge wie am PC. Kein „Bereich“: Der Eingang kennt am PC kein Umschalt+Klick.

### 4. Der Eintrag als Seite

- Seit MO-4 eine Seite mit Pfeil. Seit MO-6 hält der Kopf „•••“ mit dem, was seltener gebraucht wird („Mit Ticket verknüpfen …“, „In den Haushalt verschieben …“, „Ansehen“ und „Herunterladen“ einer Datei aus einem Ordner, „Originaldatei herunterladen“); der Fuß hält nur „Verwerfen“ und „Umwandeln“ nebeneinander bzw. „Wiederherstellen“. Ein verknüpfter Eintrag hat seine Knöpfe im Block „Gehört zu …“ und keinen Fuß (Konzept: „Kopf und Fuß wie beim Ticket-Panel“). Die Adresse der Quelle und die Tickets eines möglichen Duplikats sind Ziele von 44 px; Titel, Absender, Adressen und Links brechen um, Code scrollt im eigenen Kasten (`prose.css`, unverändert).
- **Rückweg:** Der Pfeil geht über den Verlauf zurück, wenn direkt davor die Seite einer Ansicht liegt (`arrowBack` und `viewOfEntry` in `lib/views.ts`): die Liste des Eingangs mit ihren Chips („Zum Eingang“) oder die Ansicht, in der „＋“ den Eintrag erfasst hat („Eintrag ansehen“, etwa „Zum Tagesplan“), wie die Zurück-Geste, ohne zweiten Eintrag und ohne Schleife. Sonst (von außen, neu geladen, aus einem Ticket, aus „Erfassen“ oder „Neues Ticket“) navigiert er zur Ansicht der Route wie das × („Zum Eingang“, neben dem Kalender „Zum Kalender“). Der Name folgt dem Ziel (`VIEW_BACK_LABELS`, die Namen der Rückwege der Tickets, dazu „Zum Papierkorb“). Die Seite davor liest die Route aus `afterNavigate` (`previousEntry`), weil der Name schon vor dem ersten Tipp stimmen muss; `WayBack` des Layouts wird erst danach gesetzt.
- **Begründung:** MO-4 vergleicht die Seite davor genau mit dem Rückweg (Pfad und Query). „Eintrag ansehen“ der Schnellerfassung öffnet `/eingang/<id>` aus jeder Ansicht; der Weg zur Liste des Eingangs wäre dort ein neuer Eintrag im Verlauf, und die Zurück-Geste führte danach zurück zum Eintrag. Einen Eintrag neben sich zeigt außer dem Eingang nur der Kalender (mit eigener Route); eine Route je Ansicht wäre eine Mobil-Route (§1). Der Rückweg zur Ansicht davor ist der zurückhaltendste Weg ohne neue Route.

### 5. Umwandeln und „Erfassen“

- „Umwandeln“ öffnet wie bisher `/tickets/neu?aus=<id>`, im Rahmen als Seite (MO-4). Abbrechen (der Pfeil „Zurück“ oder „Abbrechen“, mit der Frage bei Geändertem) geht im Rahmen über den Verlauf dorthin zurück, wo „Umwandeln“ getippt wurde (Karte oder Eintrag), wenn ein Link der App die Seite geöffnet hat (`backThroughHistory` in `lib/way-back.ts`); sonst und am PC wie bisher zum Eintrag. So entsteht keine Schleife aus Formular und Eintrag.
- **„Erfassen“** (`/eingang/neu`): Felder mit Fließtext (`SENTENCE_FIELDS`: Was, Wen, Anlass, Artikel, Laden, Ort, Auszug) beginnen Sätze groß (`autocapitalize="sentences"`); einzeilige Felder zeigen auf der Taste der Tastatur „next“, solange danach ein Pflichtfeld kommt, sonst „done“ (`enterKeyOf` in `domain/templates.ts`; Enter speichert das Formular wie am PC). Beides nur im Rahmen: Anders als die Schnellerfassung hat das Formular mehrere Felder, und Chrome für Android wählt dort ohne Angabe selbst „Weiter“; ein festes `enterkeyhint` änderte das am Handy ohne Schalter. Der Hinweis „Strg+Enter …, Alt+Enter …“ entfällt im Rahmen. Ein Druck auf „Ticket anlegen“ bzw. „In den Eingang“ lässt den Fokus im Feld (`MobileLayoutStore.keepFocus`, das Muster `keepLine` aus MO-5, seither gemeinsam), die Tastatur bleibt für das nächste Objekt offen. Der Pfeil heißt „Zum Eingang“ und geht über den Verlauf zurück, wenn die Liste davor liegt (`goBack`, MO-4); vom Bookmarklet aus navigiert er wie bisher.
- Ungespeicherte Eingaben bleiben über `registerUnsavedInput` geschützt (unverändert seit MO-1b: „Erfassen“, „Neues Ticket“, die Dialoge).

### 6. „Aus Zwischenablage“ über HTTP

- Über die Adresse im Heimnetz (`http://`) gibt es keinen sicheren Kontext: Chrome lässt die Seite die Zwischenablage nicht lesen, und am Handy gibt es kein Strg+V. Im Rahmen öffnet „Aus Zwischenablage“ deshalb bei jedem Fehlschlag den Dialog ohne Text mit dem Hinweis „Die Zwischenablage ließ sich nicht lesen. Lange ins Feld drücken und „Einfügen“ wählen.“ (`clipboardFallback` in `lib/clipboard.ts`); das leere Feld zeigt keinen Fehler. Am PC bleibt der Hinweis auf Strg+V.

### 7. Hinweise (Flags)

- „Verwerfen“ zeigt wie bisher „Rückgängig“ im Flag (8 s), im Rahmen über der unteren Leiste (MO-1a); der Smoke-Test prüft Lage und Ziel.

### 8. Tests

- Vitest: `components/inbox-table-phone.test.ts` (Karten, Tipp, „Verwerfen“ mit Fokus und Flag, verknüpft und verworfen, Zeile über den Karten, Zeile der Ansicht, Menü der Liste, Filter-Sheet, „Zurücksetzen“, Gruppen, „Auswählen“, Dateien nach der Liste, Gegenproben, statisch die Regeln), `components/inbox-entry-phone.test.ts` (Eintrag als Seite mit „•••“ und Fuß, „Erfassen“ mit Tastatur, Fokus und Pfeil, der Dialog der Zwischenablage, die Dateien, Gegenproben), `views.test.ts` (`viewOfEntry`, `VIEW_BACK_LABELS`, `arrowBack`), ergänzt `way-back.test.ts`, `clipboard.test.ts`, `domain/templates.test.ts` und `mobile-layout.test.ts`. Angepasst: die Liste der Dateien mit Regeln des Rahmens in `breakpoints.test.ts` (neu `FilterButton`, `InboxPanel`, `InboxTable`). Die bestehenden Tests des Eingangs laufen unverändert als Tests des PC.
- Smoke bei 360 × 800 und 412 × 915: Karten mit Zielen ab 44 px ohne seitliches Scrollen (Betreff aus einem langen Wort, langer Absender, langer Link, Code), das Filter-Sheet, der Eintrag als Seite mit Pfeil und Zurück-Geste zur Liste ohne zweiten Eintrag, „Verwerfen“ mit „Rückgängig“ über der Leiste, „Umwandeln“ als Seite und zurück, „Erfassen“ mit `autocapitalize`/`enterkeyhint` und Pfeil zurück, „Aus Zwischenablage“ mit dem Feld zum Einfügen, „Eintrag ansehen“ von „＋“ zurück zum Tagesplan; am PC Tabelle, Chips, Sammelaktionen und Panel mit ×. Die echte Tastatur, die Zurück-Geste und die Zwischenablage über `http://` prüfen die manuellen Fälle.

### 9. Grenzen

- Nach dem Umwandeln zeigt die App das neue Ticket wie am PC neben „Aufgaben“ (`replaceState`, NT-1); sein Pfeil führt zur Liste „Aufgaben“, nicht zurück in den Eingang.
- Kommt man über Zurück aus einem Ticket, das den Eintrag ersetzt hat, kennt die App die Seite vor dem Eintrag nicht mehr: dessen Pfeil navigiert dann zum Eingang (wie bei Unteraufgaben seit MO-4).
- Ein Eintrag aus „Eintrag ansehen“ in den Einstellungen führt mit dem Pfeil zum Eingang, nicht zurück in die Einstellungen (sie sind keine Ansicht); die Zurück-Geste führt dorthin.

## Nachtrag (2026-10-20, MO-6b): Feinschliff Handy

Nur Oberfläche, Tests und Doku, keine Hooks und keine Migration: nach dem Build F5. Entscheidung durch den Nutzer („alles nach Empfehlung“ für die Fragen aus MO-2 bis MO-6 vom 2026-10-20: Frage 2 ja, Frage 3 nein, Frage 4 ja, Frage 12 ja, auch am PC), den Advisor (Auftrag MO-6b mit Umfang und Abgrenzung, dazu zwei Kleinpunkte aus MO-2 und EH-1) und den Executor (Umsetzung, Tests). Das kurze Datum (§1) und die offenen Abschnitte (§2) gelten nur im Rahmen (`MobileLayoutStore.active`). Die Rückfrage in „Erfassen“ (§3) und der Rückweg der Einstellungen (§5) gelten nach der Entscheidung des Nutzers auf jedem Gerät; der Chevron (§4) betrifft gerade die Touch-Bildschirme ohne Rahmen. Sonst bleibt der PC unverändert, Tests belegen das.

### 1. Kurzes Datum im Kopf des Tagesplans (Frage 4)

- Im Rahmen nennt der Kopf den Tag kurz: „Heute, Di., 20. Okt.“, „Morgen, Mi., 21. Okt.“, „Gestern, Mo., 19. Okt.“, jeder andere Tag „Do., 15. Okt.“ (`shortDayTitle` in `domain/day-plan.ts`, neben `dayTitle`). Die Abkürzungen sind die üblichen deutschen mit Punkt (wie die Kurzformen von CLDR: „März“, „Mai“, „Juni“ und „Juli“ ungekürzt, „Sept.“); das Jahr steht nur, wenn es nicht das von heute ist („Morgen, Fr., 1. Jan. 2027“). Gemessen in Chrome mit Inter: Das längste übliche Kurzdatum („Gestern, Mo., 19. Okt.“) braucht etwa 133 px und passt bei 360 px auch neben „Heute“ (etwa 167 px frei) zwischen die Pfeile; das volle Datum brauchte bis zu etwa 240 px und brach dort um.
- Screenreader hören weiter das volle Datum: Das kurze steht mit `aria-hidden`, das volle als `.visually-hidden` daneben, nach dem Muster des Fortschritts im selben Kopf („3/7 erledigt“). Name der Überschrift und Ansage ihrer Live-Region beim Wechsel des Tags sind damit das volle Datum. Am PC und ohne Schalter bleibt der Kopf, wie er war.

### 2. Leerer Plan: Vorschläge und „Hinzufügen …“ offen (Fragen 2 und 3)

- Lädt im Rahmen ein Tag, dessen Plan keinen Eintrag hat (beim Öffnen, ein anderer Tag, der andere Bereich, nach einem Fehler erneut), stehen die Vorschläge (nur heute) und „Hinzufügen …“ aufgeklappt da: Der Plan zeigt dann nur „Noch nichts geplant“, die Wege, ihn zu füllen, sind ohne weiteren Tipp da.
- Entschieden wird nur beim Laden: `DayPlanView` folgt allein dem Übergang des Stores nach `ready`. Ein erster Eintrag, ein Ereignis des Servers oder das erneute Laden desselben Tags nach einer Unterbrechung klappen nichts zu; zu klappt nur der Nutzer. Ein Plan mit Einträgen startet wie seit MO-2 eingeklappt bzw. behält, was in der Ansicht schon offen ist. Auf oder zu wird nicht je Gerät gemerkt (Frage 3).
- Am PC und ohne Schalter bleibt alles, wie es war: die Vorschläge offen, solange der Nutzer sie nicht zuklappt (auch nach dem Laden eines Tags), der Pool daneben bzw. darunter.

### 3. „Erfassen“ fragt vor dem Verlassen in der App, auch am PC (Frage 12)

- **Befund:** „Neues Ticket“ (`NewTicketForm`) und „Erfassen“ (`CaptureForm`) fragen auf ihren eigenen Wegen hinaus gleich: „Abbrechen“ bzw. „Schließen“, das × und Esc, im Rahmen der Pfeil (der `Drawer` ruft ohne `onback` dessen `onclose`), bei Eingaben „Neues Ticket verwerfen?“ bzw. „Erfassung verwerfen?“ mit „Die Eingaben gehen verloren.“, „Weiter bearbeiten“ und „Verwerfen“ (seit UI-3). Navigationen der App (Links, Leisten, „Mehr“, Zurück-Geste, Browser-Zurück) hält keines der beiden Formulare an; das tun nur das Ticket (`TicketRouteLayout`), das Projekt- und das Regel-Panel mit `beforeNavigate` (ADR-0025 §4, „Bestätigung“ in [ui-bausteine.md](../regeln/ui-bausteine.md)). Die Frage „wie beim Ticket“ ist deshalb diese: dasselbe Anhalten, dieselbe Frage des Formulars.
- **Umsetzung:** `CaptureForm` hält Navigationen nach dem Muster dieser drei an. `beforeNavigate` bricht eine Navigation zu einer Seite der App mit anderem Pfad ab, solange `dirty` gilt (SvelteKit stellt für Zurück und Vor die Stelle im Verlauf wieder her), und öffnet die vorhandene Frage „Erfassung verwerfen?“ mit unverändertem Wortlaut und unveränderten Knöpfen; „Weiter bearbeiten“ behält die Eingaben, „Verwerfen“ setzt die Navigation fort (`history.go(delta)` bzw. `goto`). Keine zweite Frage, kein neuer Baustein. Durch gehen: eine andere Vorlage (nur die Query, das Formular bleibt), das Verlassen der App (Neuladen, Tab schließen: im Rahmen die Frage des Browsers seit MO-1b), die Anmeldeseite, eine laufende Speicherung und jede Navigation ohne Eingabe, also auch nach dem Speichern („In den Eingang“, „Ticket anlegen“ leeren das Formular). Nach „Verwerfen“ über „Schließen“ läuft das Schließen ohne zweite Frage.
- Auf jedem Gerät: Am PC ging getippter Text bisher bei einem Link der Navigation ohne Frage verloren; das ist die Entscheidung des Nutzers zu Frage 12.
- **Grenzen:** „Neues Ticket“ hält Navigationen weiterhin nicht an; das gehört nicht zu MO-6b und steht im Bericht (behoben mit MO-6c, Nachtrag unten). Die Schnellerfassung braucht das Anhalten nicht: Sie gehört zum `(app)`-Layout und bleibt bei einer Navigation samt Text offen, × und Zurück-Geste fragen über das Modal (MO-1b, MO-5).

### 4. Chevron der Vorschläge auf Touch-Bildschirmen (Kleinpunkt seit TP-1)

- **Ursache:** Der Link „Öffnen“ jeder Vorschlagszeile trug die Klasse `open`, ebenso der aufgeklappte Chevron. Die Regel für Touch-Bildschirme (`@media (pointer: coarse)`: 44 × 44 px für „Öffnen“) traf so auch den Chevron, der ohne Rahmen auf 44 × 44 px wuchs (MO-2 §4: im Rahmen zurückgesetzt, außerhalb offen).
- **Behoben an der Ursache:** Der Link heißt `open-ticket`, die Touch-Regel nennt nur ihn. Der Chevron behält seine Klasse `open` für die Drehung (wie im Pool). Die Regel des Rahmens, die den Chevron dort zurücksetzte, hat damit nichts mehr zu tun und entfällt; im Rahmen bleibt alles, wie es war.

### 5. Rückweg der Einstellungen nach dem Tagesplan (Kleinpunkt seit EH-1)

- `lastViewLabel` (`stores/last-view.svelte.ts`) kannte den Tagesplan nicht: Nach dem Tagesplan stand in den Einstellungen „Zurück zu Aufgaben“, der Link führte aber zum Tagesplan, auch am PC. Seit MO-6b heißt er „Zurück zum Tagesplan“ (der Name der Ansicht aus `VIEW_LABELS` in `lib/views.ts`), ein Ticket neben dem Tagesplan (`/tagesplan/tickets/<id>`) wie in den anderen Ansichten „Zurück zu KEY“ bzw. „Zurück zum Ticket“. Ziel des Links und gemerkte Ansicht bleiben, wie sie waren.

### 6. Tests

- Vitest: `domain/day-plan.test.ts` (kurzes Datum mit Jahreswechsel), `components/day-plan/day-plan-phone.test.ts` (Kopf mit kurzem und vollem Datum; leerer Plan offen, ein erster Eintrag klappt nichts zu, ein leerer Tag öffnet auch nach dem Zuklappen wieder, ein Plan mit Einträgen startet eingeklappt; der Chevron trifft keine Touch-Regel, auch ohne Rahmen; Gegenprobe am PC mit Schalter und am Handy ohne Schalter), `components/capture-form.test.ts` (Frage vor Link, Leiste und Zurück mit „Weiter bearbeiten“ und „Verwerfen“; ohne Eingabe, andere Vorlage, Verlassen der App, Anmeldeseite und nach dem Speichern keine Frage; „Schließen“ fragt einmal; dasselbe am PC mit Schalter, am Handy ohne Schalter und im Rahmen), `stores/last-view.test.ts` und `routes/(app)/einstellungen/settings-layout.test.ts` (Rückweg zum Tagesplan am PC, am PC mit Schalter, am Handy ohne Schalter und im Rahmen).
- Angepasst: in `day-plan-phone.test.ts` die statische Prüfung des Chevrons (statt der Regel `.open` für Touch und der Regel `.chevron` im Rahmen nun die Regel `.open-ticket` und kein `.chevron` im Block des Rahmens) und in `capture-form.test.ts` die Attrappe von `$app/navigation` um `beforeNavigate`. Die übrigen Tests von Tagesplan, „Erfassen“ und Einstellungen laufen unverändert.
- Keine neuen Smoke-Fälle; der bestehende Smoke-Test läuft unverändert. Das Datum am Gerät, der leere Plan, die Rückfrage mit Zurück-Geste und Leiste und der Chevron ohne Handy-Ansicht prüfen die manuellen Fälle, am PC ein eigener Fall.

## Nachtrag (2026-10-21, MO-6c): Rückfrage in „Neues Ticket“

Nur Oberfläche, Tests und Doku, keine Hooks und keine Migration: nach dem Build F5. Entscheidung durch den Nutzer (2026-10-20: dasselbe Muster wie in „Erfassen“, auch am PC), den Advisor (Auftrag MO-6c mit Umfang und Abgrenzung: ohne Schnellerfassung, Ticket-Panel, OF-3 und MO-7) und den Executor (Umsetzung, Tests). Gilt wie die Rückfrage in „Erfassen“ (MO-6b §3) auf jedem Gerät, nicht nur im Rahmen.

### 1. Befund

- Seit MO-6b §3 bekannt: „Neues Ticket“ (`NewTicketForm`, Route `/tickets/neu`, auch `/tickets/neu?aus=<id>` aus „Umwandeln“) fragte nur auf seinen eigenen Wegen hinaus, bei „Abbrechen“, ×, Esc und im Rahmen beim Pfeil (`cancel()` öffnet über `confirmingDiscard` die Frage „Neues Ticket verwerfen?“). Zurück-Geste, Browser-Zurück, Links, die Leisten und „Mehr“ gingen ohne Frage, der getippte Text war weg.
- **Wo „Neues Ticket“ aufgeht:** nur über diese eine Route mit dieser einen Komponente. Am PC ist es ein Seitenpanel neben „Aufgaben“ (ab 64rem eingebettet, darunter ein Overlay mit Schleier; ein Modal von „Neues Ticket“ gibt es nicht), am Handy ohne Schalter ebenso, im Rahmen eine Seite mit Pfeil (MO-4). Einstiege sind „Neues Ticket“ im Kopf des PC und unter „Mehr“, „Ticket anlegen“ der leeren Liste, von „Erste Schritte“ und auf der Seite „Tags“ und „Umwandeln“ einer Zeile, einer Karte oder eines Eintrags (`?aus=`). Das Anhalten in der Komponente greift deshalb an jeder dieser Stellen; eine Stelle ohne das Muster gibt es nicht.

### 2. Umsetzung

- `NewTicketForm` hält Navigationen nach dem Muster von „Erfassen“ an: `beforeNavigate` bricht eine Navigation zu einer Seite der App ab, solange `dirty` gilt (die vorhandene Ableitung, dieselbe, die `registerUnsavedInput` meldet), und öffnet die vorhandene Frage „Neues Ticket verwerfen?“ mit unverändertem Wortlaut („Die Eingaben gehen verloren.“) und unveränderten Knöpfen „Weiter bearbeiten“ und „Verwerfen“. „Weiter bearbeiten“ behält die Eingaben, „Verwerfen“ setzt die Navigation fort (`history.go(delta)` bzw. `goto`). Keine zweite Frage, kein neuer Baustein und keine gemeinsame Hilfsfunktion: `CaptureForm` bleibt unverändert.
- **Durch gehen** jede Navigation ohne Eingabe, das Verlassen der App (Neuladen, Tab schließen: im Rahmen die Frage des Browsers seit MO-1b), die Anmeldeseite, fremde Seiten, eine laufende Anfrage und das Anlegen selbst: Nach einem erfolgreichen „Anlegen“ (Knopf, Enter im Titel, Strg+Enter) bleibt die Anfrage gesperrt (`pending`), während die Seite mit `replaceState` zum neuen Ticket wechselt. Nach „Verwerfen“ über „Abbrechen“, ×, Pfeil oder Esc läuft das Schließen ohne zweite Frage.
- **Gleiche Seite:** Wie in „Erfassen“ fragt eine Navigation mit gleichem Pfad nicht, weil das Formular bleibt (ein Filter der Liste neben dem Panel, „Neues Ticket“ noch einmal). Anders als dort zählt bei „Neues Ticket“ auch der umzuwandelnde Eintrag (`?aus=`, `convertFrom`): Ändert er sich, zeigt die Seite ein anderes Formular, und der Text wäre ohne Frage weg (etwa „Ticket anlegen“ von „Erste Schritte“ neben einer Umwandlung am PC). Diese Navigation fragt deshalb.
- **„Umwandeln“ abbrechen im Rahmen:** Das Abbrechen geht seit MO-6 über `backThroughHistory` mit `history.back()` zurück. „Verwerfen“ merkt die Eingabe als verworfen, bevor die Seite zurückgeht; der Schritt zurück fragt deshalb nicht noch einmal und bildet keine Schleife aus Frage und Schritt. Die Zurück-Geste selbst fragt und geht nach „Verwerfen“ genau den gemerkten Schritt (`history.go(-1)`), ohne zusätzliches `history.back()`. Am PC geht das Abbrechen wie bisher mit `goto` zum Eintrag.
- Auf jedem Gerät: Am PC ging getippter Text bisher bei einem Link der Navigation, einem anderen Ticket der Liste oder Browser-Zurück ohne Frage verloren; das ist die Entscheidung des Nutzers.

### 3. Tests

- Vitest (`components/new-ticket.test.ts`, Block „leaving with typed input (MO-6c)“), jeder Fall mit `it.each` am PC mit Schalter, am Handy ohne Schalter und im Rahmen: Frage vor Link, Leiste, „Mehr“ und Ansichten-Leiste mit Wortlaut, erstem Fokus, „Weiter bearbeiten“ und „Verwerfen“; Frage vor Browser-Zurück und Zurück-Geste mit `history.go(-1)`; ohne Eingabe, mit anderer Query, beim Verlassen der App, zur Anmeldeseite und zu einer fremden Seite keine Frage; während der Anfrage und nach „Anlegen“ bzw. Strg+Enter keine Frage; Pfeil bzw. ×, Esc und „Abbrechen“ fragen einmal, danach geht das Schließen durch; „Umwandeln“ abbrechen mit einer Frage, im Rahmen genau ein `history.back()`, sonst zum Eintrag, ohne Schleife; die Zurück-Geste aus einer Umwandlung; ein anderer Eintrag in `?aus=` fragt, ein Filter nicht.
- Angepasst: die Attrappe von `$app/navigation` um `beforeNavigate` in `new-ticket.test.ts` (sammelt die Wächter wie in `capture-form.test.ts`), `new-ticket-more.test.ts` und `ticket-options-parity.test.ts` (dort `vi.fn()`); in `new-ticket.test.ts` dazu eine Attrappe von `findWayBack` (`$lib/way-back`, sonst `null` wie außerhalb des Layouts), damit die Umwandlung im Rahmen über den Verlauf zurückgehen kann. Die übrigen Tests von „Neues Ticket“ und „Erfassen“ laufen unverändert.
- Keine neuen Smoke-Fälle; der bestehende Smoke-Test läuft unverändert (er bricht „Umwandeln“ ohne Eingabe mit dem Pfeil ab, ohne Frage). Die Zurück-Geste am Gerät und die Wege am PC prüfen die manuellen Fälle.

## Nachtrag (2026-10-21, MO-7a): Querschnitt

Nur Oberfläche, Tests und Doku, keine Hooks und keine Migration: nach dem Build F5. Entscheidung durch den Advisor (Auftrag MO-7a: die gesammelten Absicherungen aus der Nachprüfung von MO-6c, der gedämpfte Stil gesperrter Menüpunkte aus OF-3, `autocapitalize` an Titeln und Kommentaren, die Reste aus OF-3c und OF-4b, die Hilfe „Ohne Verbindung“ und das Zusammenlegen des Smoke-Tests; Kalender, Erledigte, Projekte, Wiederholungen, Papierkorb, Einstellungen, Login und Fehlerseiten folgen in MO-7b und MO-7c) und den Executor (Umsetzung, Tests). Jeder Punkt hat einen Test, der am Stand `6c8d30f` rot war (Ausnahmen genannt).

### 1. „Neues Ticket“ und „Erfassen“ abgesichert

Nach dem Muster von `TicketRouteLayout`, auf jedem Gerät:

- `registerUnsavedInput(() => !discarding && dirty)`: Nach „Verwerfen“ meldet das Formular keine ungespeicherte Eingabe mehr. Lädt ein neuer Build die Seite bei der Navigation von „Verwerfen“ neu, fragte der Browser vorher ein zweites Mal.
- `discarding` gilt nur, bis die Navigation von „Verwerfen“ zu Ende ist (`try`/`finally` um `await goto`). Bleibt das Formular danach stehen (etwa eine Navigation, die es behält), fragt der nächste Weg hinaus wieder; vorher ging jede weitere Navigation ohne Frage durch. Für einen Schritt durch den Verlauf (`history.go`) und das Abbrechen über `oncancel` bleibt `discarding` wie bisher.
- `submit` bzw. `save` mit `try`/`finally` für `pending`: Wirft das Anlegen oder Speichern eine Ausnahme (auch das Sichern der Seite eines Web-Links), ist das Formular wieder bedienbar, und die Frage vor dem Verlassen geht wieder; die Ausnahme geht weiter an das Fehlerprotokoll der Sitzung (ADR-0071). Nach einem erfolgreichen „Anlegen“ bleibt „Neues Ticket“ wie seit MO-6c gesperrt, bis die Seite zum neuen Ticket wechselt.
- **Fokus nach „Weiter bearbeiten“:** Hielt die Frage eine Navigation an, gibt das Modal den Fokus an den angetippten Link oder Knopf außerhalb des Formulars zurück. Danach geht er zurück ins Formular, in das Feld, das ihn zuletzt hatte (sonst Titel bzw. erstes Feld). Nach „Weiter bearbeiten“ der Frage von „Abbrechen“ bzw. „Schließen“ bleibt er auf diesem Knopf.

### 2. Gesperrte Menüpunkte gedämpft, auf jedem Gerät

- Ein Eintrag mit `aria-disabled` (`menuitem`, `menuitemradio`, `menuitemcheckbox`) in einem Popover der Art `menu` (`ActionsMenu`, Kontextmenüs, Menüs der Zellen und des Editors) steht in `--color-text-muted`, ohne Akzentfläche bei Hover und Tastaturfokus, mit dem Zeiger „nicht erlaubt“ (außer er ist beschäftigt, `aria-busy`). Die Regel steht in `Popover.svelte` außerhalb jeder Media Query: Sie gilt bewusst am PC und am Handy, ohne Schalter. Vorher hatten gesperrte Einträge keine eigene Farbe (ADR-0074 Nachtrag OF-3 §7).
- **Kontrast:** WCAG 1.4.3 nimmt deaktivierte Bedienelemente aus. Der Name eines gesperrten Eintrags nennt oft den Grund („Alle Kanäle jetzt abrufen (nur mit Verbindung)“), deshalb bleibt er lesbar: `--color-text-muted` erreicht auf dickem Glas mindestens 4,5 : 1 (`glass-contrast.test.ts`), statt einer Deckkraft von 0,5. Die Pfeiltasten erreichen ihn weiter (APG), der Fokusring von `base.css` zeigt, wo der Fokus steht.

### 3. `autocapitalize` an Titeln und Kommentaren

- Im Rahmen beginnen Sätze groß (`autocapitalize="sentences"`): der Titel von „Neues Ticket“, die Titel der Unteraufgaben in „Neues Ticket“ und in Vorlagen (`TemplateSubtaskList`), der Titel des Tickets beim Bearbeiten (`EditableTitle`, Panel und Vollansicht), „Titel der Unteraufgabe“ in „Unteraufgabe hinzufügen“, die Titel von „Ticket duplizieren“ und „Folge-Ticket anlegen“, der neue Kommentar und ein Kommentar beim Bearbeiten (`RichTextEditor` setzt das Attribut am Editor und am Markdown-Feld). Die Zeile von „＋“ (MO-5) und die Felder von „Erfassen“ (MO-6) hatten es schon.
- Wie in MO-5 nur im Rahmen (`MobileLayoutStore.active`): Am Handy ohne Schalter bleibt die Tastatur, wie sie war; am PC wirkt das Attribut nicht. Die Vorlage einer Regel (`RecurrenceTemplateFields`) folgt mit den Wiederholungen in MO-7b.

### 4. Smoke-Test zusammengelegt

- Das Konzept MO-0 §5 sieht höchstens 15 Fälle vor; seit OF-3c waren es 19. Jetzt sind es 13: Fälle mit demselben Fenster und demselben Start teilen eine Anmeldung. Zusammen stehen der Start im Tagesplan und „Mehr“; die heutige Ansicht ohne Schalter und die Overlays ohne Schalter (erst 390 × 844, dann 360 × 800, dann wieder 390 × 844 für den Schalter); am PC der Start, die Tabelle, die Schnellerfassung und das Seitenpanel in einem Fall, Tagesplan und Eingang in einem zweiten. Jede Prüfung der früheren Fälle steht darin; eine Prüfung, die zwei Fälle gleich nach der Anmeldung machten, steht einmal.
- Neue Prüfungen in bestehenden Fällen: die Farbe eines gesperrten Eintrags im Menü des Tagesplans (§2) und das `tabindex` der Hinweisregion (ADR-0074 Ergänzung MO-7a). Der Fall des Tickets als Seite wartet nach „Kommentieren“, bis „Kommentar hinzufügen …“ den Fokus hat, bevor er das Feld „Tags“ benutzt: Mit dem Postausgang endet `post()` einen Augenblick nach dem Erscheinen des Kommentars, und das Formular holt den Fokus erst dann zurück; tippte der Test schneller, schloss sich die Liste der Vorschläge. Einzeln war der Fall dadurch auch am Stand `6c8d30f` rot (1 von 2 Läufen).
- Lokal gemessen (je zwei Läufe nacheinander, Zeit von Playwright): vorher 19 Fälle mit 31,2 s und 28,2 s, nachher 13 Fälle mit 24,8 s und 24,7 s. Neue Pakete fügen weiter nur Fälle hinzu, wenn sie dafür andere zusammenlegen.

### 5. Tests

- Vitest: `new-ticket.test.ts` und `capture-form.test.ts` (Block „safeguards of leaving (MO-7a)“), `overlay/popover.test.ts` (Regel des gesperrten Eintrags), `autocapitalize-phone.test.ts` (neu, je im Rahmen, am Handy ohne Schalter und am PC). Am Stand `6c8d30f` rot: alle außer den Absicherungen „keeps the focus on „Abbrechen“ bzw. „Schließen“ …“ und den Gegenproben ohne Rahmen.
- Angepasst (mit Grund): In den Fällen „asks on %s before a link …“ (`new-ticket.test.ts`) und „asks before a link or the bar leaves …“ (`capture-form.test.ts`) prüft die Attrappe von `goto` die neu gestartete Navigation jetzt dort, wo SvelteKit `beforeNavigate` aufruft, nämlich in `goto`; seit §1 gilt `discarding` nach dem Ende von `goto` nicht mehr. Die Erwartung, dass diese Navigation durchgeht, bleibt.
- Smoke: §4. Hilfe, Fokus und die Reste aus OF-4b: ADR-0074 Ergänzung MO-7a.
- Manuell: BYL-E6-2205 (Rückfrage und Fokus in „Neues Ticket“, gedämpfter Menüpunkt, Hilfe „Ohne Verbindung“).
