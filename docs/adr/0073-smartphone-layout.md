# ADR-0073: Smartphone-Layout als responsive Variante der SPA hinter dem Vorschau-Schalter „Handy-Ansicht“

- **Status:** Angenommen; umgesetzt sind das Grundgerüst (Paket MO-1a) und Overlays, Bedienziele und Eingabe (Paket MO-1b, Nachtrag unten). Die einzelnen Ansichten folgen in den Paketen MO-2 bis MO-8. Fälle im Test-Manifest BYL-E6-1907 bis BYL-E6-1929 (manuelle Prüfungen BYL-E6-1925 bis BYL-E6-1929) und BYL-E6-1950 bis BYL-E6-1964 (manuelle Prüfungen BYL-E6-1959 bis BYL-E6-1964)
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
