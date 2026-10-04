# ADR-0048: Fehlerkatalog der Skripte – jedes Problem mit Ursache, Schritten und Befehl zum Kopieren, Selbstlösen auf Nachfrage, kein stummer Fehler im Hintergrund

- **Status:** Angenommen und umgesetzt (RS-1, [Plan Robuste Skripte](../plan/robuste-skripte.md))
- **Datum:** 2026-10-02
- **Entscheidung durch:** Nutzer (Wunsch vom 2026-10-01: „Außerdem müssen alle Skripte so gestaltet sein, dass sie Probleme abfangen und klar mit dem User kommunizieren was zu tun ist (ggf. auch anleiten mit CMDs zum Kopieren und dergleichen).“), Advisor (Format, Katalog, Selbstlösen, Hintergrund, Tests), Executor (Inventur, Texte, Umsetzung, Einzelheiten)
- **Ergänzt:** [ADR-0039](0039-betriebsskripte.md) (Nachtrag RS-1 dort: Exit-Codes unverändert, `-Json` mit `code` und `remedy`), [ADR-0040](0040-veroeffentlichen-ohne-unterbrechung.md) (Nachtrag RS-1: Fehler des Builds aus dem Katalog), [ADR-0043](0043-system-seite.md) (Nachtrag RS-1: Problem im Hintergrund und „Was tun?“ auf der Seite „System“), [ADR-0046](0046-sicherung-pruefung-wiederherstellen.md) (Gründe der Sicherung als Katalogeinträge)
- **Bezug:** [ADR-0035](0035-start-einstieg-und-offene-tabs.md) (Start), [ADR-0018](0018-secrets.md) (keine Werte in Logs), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) (Code-Block, Hilfe)

## Kontext

Die Skripte meldeten Fehler je nach Stelle anders: ein roter Satz, mal mit Befehl, mal ohne, mal englisch (`build.ps1`), oft ohne Ursache. Ein unerwarteter Fehler endete mit „Unerwarteter Fehler: <Meldung von .NET>“ und ohne Hinweis, was man tun oder wem man was schicken soll. Konnte PowerShell das Steuerskript gar nicht ausführen (Richtlinie für Skripte, fehlende Datei), sah der Nutzer nur die englische oder deutsche Meldung von PowerShell. Ein Fehler beim Autostart erschien als Meldungsfenster, das man leicht verpasst; danach wusste nichts mehr davon.

## Entscheidung

### 1. Ein Katalog, ein Format

`app\byl-problems.ps1` ist die einzige Quelle aller Problemtexte der Skripte (112 Einträge): je Eintrag ein Code (`port-busy`, `pocketbase-missing`, …) mit Exit-Code, Stufe (`error` oder `warning`), Problem, Ursache, Schritten, optional einem Befehl zum Kopieren und einem Angebot zum Selbstlösen, dazu die Frage für die Hilfe-Seite. Alle Texte sind Zeichenketten in einfachen Anführungszeichen (keine Auswertung), Platzhalter in geschweiften Klammern. `Format-BylProblem` gibt jeden Eintrag gleich aus:

```
× Problem:   Port 8090 auf 127.0.0.1 ist belegt; becauseyoulovejira startet dort nicht.
             Belegt durch pocketbase.exe (PID 4711): C:\Users\…\andere-kopie\app\pocketbase.exe
  Ursache:   Ein anderes Programm nutzt die Adresse der App, …
  So geht's: 1. Das andere Programm beenden …
             2. Oder becauseyoulovejira auf den freien Port 8091 umstellen (Befehl unten) …
             Befehl zum Kopieren:
               powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\…\app\byl-control.ps1" port 8091
  Details:   C:\Users\…\app\logs\byl-control.log
```

- **Echte Pfade:** `Get-BylProblemValues` setzt den Ordner der App, das Steuerskript, das Log und – nur in einem Checkout – `scripts\build.ps1` und `scripts\fetch-pocketbase.ps1` mit vollem Pfad ein. Ein Befehl, dessen Platzhalter keinen Wert hat, entfällt (nie ein halber Befehl); ein Text zeigt dann „…“. Pfade brechen beim Umbrechen nie (geschützte Leerzeichen), Befehle, Fakten und der Pfad des Logs werden nie umbrochen.
- **Zeichen:** Fehler beginnen mit `×` (U+00D7), Hinweise mit `!`. Das schwere Kreuz U+2716 aus dem Auftrag fehlt in Consolas, Lucida Console und Courier New, den Schriften der Konsole von Windows 10 (geprüft mit `GlyphTypeface`), und erschiene als leeres Kästchen; `×` steht in allen drei und in den Codepages 850 und 1252. Die `.bat`-Dateien und `start-hidden.vbs` bleiben ASCII (cmd und WSH lesen die OEM- bzw. ANSI-Codepage) und nehmen `X` und Umschreibungen (`ConvertTo-BylAscii`).
- **Farbe:** nur die erste Zeile eines Fehlers rot, eines Hinweises gelb; Ursache, Schritte und Befehl in der normalen Farbe, damit sie lesbar bleiben.

### 2. Wer meldet was

- **`byl-control.ps1`:** jeder Fehlerweg ruft `Write-BylProblem -Code … -Values … [-Facts …] [-Fix {…}]` und gibt dessen Exit-Code zurück; tief in Aufrufen wirft er `New-BylProblemError`, der letzte `catch` meldet den Eintrag. Ein anderer Fehler wird `unexpected`: die Meldung, der Weg zum Log und ein Befehl, der dessen letzte 50 Zeilen in die Zwischenablage kopiert (mit dem Hinweis, dass sie an Claude gehen dürfen). Unbekannte Befehle prüft das Skript selbst (`command-unknown`), statt sie PowerShell mit `ValidateSet` zu überlassen. Reine Hinweise ohne Problem (andere Kopie läuft, Port gilt nach dem Neustart) bleiben gelbe Zeilen.
- **Build-Skripte:** `scripts\build-functions.ps1` lädt denselben Katalog; `Write-BylBuildProblem` gibt die Einträge mit den Pfaden des Repositorys aus (ohne Log-Datei: die Ausgabe darüber ist das Detail). Node fehlt, Node in falscher Version, npm fehlt, Lockfile fehlt, `npm ci` oder ein Schritt scheitert, ein Hilfsprogramm baut oder prüft nicht: je ein Eintrag. `fetch-pocketbase.mjs` endet je Ursache mit eigenem Exit-Code (2 Download bzw. Netz, 3 Prüfsumme, 4 Schreiben, 5 Version, 6 System), `fetch-pocketbase.ps1` übersetzt ihn in den Eintrag.
- **`.bat`-Dateien:** jede ruft bei einem Exit-Code ungleich 0 `byl-pruefen.bat` auf. Codes 2 bis 6 und eine 1 nach einer eigenen Meldung kommen vom Skript; ob PowerShell es überhaupt ausführen kann (Richtlinie, fehlende oder beschädigte Datei, `-File` nicht gefunden), zeigt ein Aufruf von `help`. Scheitert er, steht der Eintrag `script-blocked` in ASCII im Fenster, mit dem Befehl zum Entsperren und dem echten Ordner; der Ordner wird nur verzögert erweitert, damit ein `&` oder `^` im Pfad Text bleibt, und `'` wird für PowerShell verdoppelt. Die Fenster bleiben bei Fehlern offen wie bisher; `start` wartet außerdem nach Hinweisen auf eine Taste, sonst schlösse sich das Fenster vor dem Lesen.
- **`start-hidden.vbs`:** dieselbe Prüfung ohne Fenster; scheitert sie, ein Meldungsfenster mit `script-blocked-hidden` (verweist auf `start.bat`, das die Befehle zum Kopieren zeigt).
- **Paritätstests** halten die ASCII-Texte von `byl-pruefen.bat` und `start-hidden.vbs` und die Texte der Hilfe-Seite gleich mit dem Katalog.

### 3. Selbstlösen nur auf Nachfrage und nur mit Mensch davor

Einträge mit `Offer` (Port belegt → auf den freien Port umstellen und starten; App antwortet nicht → neu starten; App läuft nicht → starten; `byl-config.json` beschädigt oder mit ungültigem Port → beiseitelegen bzw. Port 8090 einstellen und den Befehl wiederholen) fragen „Soll ich …? (J/N)“, aber nur, wenn `Test-BylCanAsk` es erlaubt: ein Konsolenfenster mit Ein- und Ausgabe am Bildschirm, ohne `-Hidden`, `-Quiet`, `-Json`, `-NonInteractive` und nicht im Hintergrund (`-WaitForProcess`). Die App ruft das Skript immer mit `-NonInteractive` auf, Tests mit umgeleiteter Ein- und Ausgabe: Dort fragt nichts. Ohne „J“ bleibt alles, wie es ist; der Befehl zum Kopieren steht ohnehin da. Eine beschädigte `byl-config.json` bleibt als `byl-config.json.defekt-<Zeit>` liegen, auch beim Befehl `port`.

### 4. Kein stummer Fehler im Hintergrund

Läufe ohne Fenster (Autostart mit `-Hidden`, Neustart und Wiederherstellung der App-Seiten mit `-WaitForProcess`) schreiben einen Fehler zusätzlich nach `run\hintergrund-problem.json` (Zeit, Befehl, Eintrag mit Text, Fakten ohne Werte der `BYL_*`-Variablen). Wir nutzen die bestehenden Wege, statt neue zu bauen:

- der Autostart zeigt wie bisher ein Meldungsfenster, jetzt mit dem ganzen Eintrag;
- der nächste Lauf von `start`, `stop`, `restart`, `reload` oder `status` im Fenster zeigt den Eintrag einmal („Beim letzten Lauf ohne Fenster …“) und löscht die Datei;
- `status -Json` liefert ihn als `backgroundProblem`, die Seite „System“ zeigt ihn als Warnung über dem Zustand („Problem beim letzten Lauf ohne Fenster“, welcher Lauf und wann, Ursache, Schritte, Befehl mit „Kopieren“, Log). Warnung statt Fehler, weil die App in dem Moment wieder läuft;
- ein erfolgreicher Lauf ohne Fenster löscht ihn.

Eine Benachrichtigung von Windows (Toast) wurde verworfen: Sie braucht eine registrierte App-ID oder einen fremden Absender und verschwindet nach Sekunden. Ein eigener Knopf „Ausblenden“ auf der Seite auch: Er bräuchte einen weiteren Befehl in der Whitelist (ADR-0043), und der Hinweis verschwindet ohnehin mit dem nächsten Start ohne Fehler oder `status.bat`.

### 5. Log und JSON

- `byl-control.log` bekommt bei jedem Problem `problem=<Code>` (auch bei Befehlen, die sonst nicht ins Log schreiben, etwa `status`), bei einem unerwarteten Fehler eine zweite Zeile mit Typ, Stelle im Skript und Meldung, ohne Werte der `BYL_*`-Variablen und ohne E-Mail-Adressen (`Format-ControlErrorLine`).
- Ein Eintrag als JSON (`ConvertTo-BylProblemData`) hat `code`, `level`, `exitCode`, `problem`, `facts`, `cause`, `remedy` (`steps` und `command`, `''` ohne Befehl) und `log`.
- Mit `-Json` antwortet ein Fehler mit einer Zeile `{ ok: false, code, level, exitCode, problem, facts, cause, remedy, log }`. Die Antworten der Sicherung (ADR-0046) behalten ihre Felder (`reason`, `problem` als Kurzgrund, `name`, …) und bekommen den Eintrag als `report`, damit sich nichts überschneidet. `doctor -Json` nennt bei jeder Prüfung mit Befund `code` und `report`, `status -Json` den gemerkten Fehler als `backgroundProblem: { atUtc, run, report }`. Exit-Codes bleiben wie in ADR-0039.
- Der Hook reicht die Einträge nur geprüft weiter (`problemView` in `lib/system-rules.js`: nur Texte, Stufe `error` oder `warning`), Texte und Fakten ohne E-Mail-Adressen und Tokens wie eine Zeile im Log; Befehl und Log sind Pfade dieses Rechners und bleiben, wie sie sind.

### 6. Hilfe und Seite „System“

- Einträge mit `Faq` (23) erscheinen auf der Hilfe-Seite unter „Betrieb → Probleme mit den Skripten“ als häufige Fragen (`web/src/lib/domain/script-problems.ts`, Wort für Wort aus dem Katalog in seiner Reihenfolge; `tests/unit/script-problems.test.mjs` vergleicht beide). Die Befehle dort gelten für ein PowerShell-Fenster im Ordner `app`; der Port dieser App ist eingesetzt, ein Wert nur des Rechners (der freie Port) steht als Platzhalter im Code-Block.
- „Umgebung prüfen“ auf der Seite „System“ zeigt bei jeder Prüfung mit Befund „Was tun?“ (aufklappbar) mit Ursache, Schritten, Befehl und Log aus dem Katalog.

### 7. Regel

CLAUDE.md: Skripte melden Fehler nur über den Katalog, mit Ursache, Schritten und, wo es einen gibt, einem Befehl mit echten Pfaden. Statisch geprüft (`tests/unit/script-problems.test.mjs`): jeder Eintrag vollständig, Exit-Codes nach ADR-0039, jeder Code im Katalog, jeder Eintrag benutzt, kein `Show-Message -Kind`, keine eigene rote Zeile, kein `throw` mit Text in `byl-control.ps1` und den Build-Skripten, kein `exit` ohne Eintrag in den Build-Skripten, keine absoluten Pfade im Katalog, jede `.bat`-Datei ruft `byl-pruefen.bat`.

## Alternativen

- **Texte an Ort und Stelle lassen und nur vereinheitlichen:** verworfen. Die Hilfe-Seite könnte dieselben Texte nicht zeigen, und kein Test fände einen Fehlerweg ohne Abhilfe.
- **Katalog als JSON-Datei:** verworfen. Ein `.ps1` mit Zeichenketten in einfachen Anführungszeichen wird geladen wie `byl-functions.ps1`, ohne eigenen Leser und dessen Fehlerwege; ist er beschädigt, läuft das Skript nicht, und genau das fängt `byl-pruefen.bat` ab.
- **Selbstlösen ohne Rückfrage** (etwa automatisch auf einen freien Port ausweichen): verworfen, ADR-0039 §2 – die App weicht nie selbst aus. Gefragt wird nur ein Mensch im Fenster.
- **U+2716 als Zeichen des Fehlers:** verworfen, siehe §1.

## Konsequenzen

- Neue Fehlerwege brauchen einen Eintrag; der Test lässt keinen Code ohne Eintrag durch. Texte ändern sich an einer Stelle; ein Eintrag mit `Faq` ändert sich in `script-problems.ts` mit (Paritätstest).
- Die Ausgabe ist länger als ein einzelner roter Satz; dafür steht jede Abhilfe da. Die Fenster der `.bat`-Dateien bleiben bei Fehlern wie bisher offen.
- `byl-problems.ps1` und `byl-pruefen.bat` gehören zu den Laufzeitdateien des Ordners `app` (Kopien, Testkopien).
- `-Json` hat mehr Felder; die App liest `backgroundProblem` und die Einträge von `doctor`, sonst ignoriert sie sie.
- Der Hook (`system-rules.js`) wirkt erst nach einem Neustart der App; bis dahin zeigt die Seite „System“ weder den gemerkten Fehler noch „Was tun?“. Die Skripte selbst wirken sofort.

## Nachtrag (2026-10-04, [Plan Test-Härtung](../plan/test-haertung.md), ST-1): harter Stopp mit seinem Grund

- `hard-stop` nannte für jeden harten Stopp „nicht innerhalb von 15 Sekunden reagiert“, auch wenn das Signal gar nicht hinausging. Seit ST-1 ([ADR-0039](0039-betriebsskripte.md), Nachtrag ST-1) gibt es drei Hinweise (Stufe `warning`, Exit 0, ohne Frage für die Hilfe): `hard-stop` (keine Reaktion in der Frist), **`hard-stop-busy`** (eine Aufgabe der App in einem Hilfsprozess lief nach `{seconds}` Sekunden noch; sie läuft zu Ende) und **`hard-stop-shared`** (ein anderes Programm hängt an derselben Konsole, etwa ein von Hand im Terminal gestarteter Server; das Signal wurde deshalb nicht gesendet). Alle drei sagen, dass gespeicherte Änderungen erhalten bleiben, und nennen `logs skript`.
- Gewählt wird nur in `Write-HardStop` über `$HardStopProblemCode` (Grund aus `Resolve-HardStopReason`); `script-problems.test.mjs` findet jeden Code dort.
