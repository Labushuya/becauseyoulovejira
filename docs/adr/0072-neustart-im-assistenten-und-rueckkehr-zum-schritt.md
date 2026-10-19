# ADR-0072: Neustart im Einrichtungsassistenten und Rückkehr zum selben Schritt

- **Status:** Angenommen und umgesetzt (Paket BW-1); Fälle im Test-Manifest BYL-E6-1889 bis BYL-E6-1906, manuelle Prüfungen BYL-E6-1902 bis BYL-E6-1906
- **Datum:** 2026-10-19
- **Entscheidung durch:** Nutzer (Regel: „Hauptsächlich soll man nur aus dem Browser heraus alles bedienen (… Hinweis zu xyz.bat außerhalb von BYLJ Environment soll immer Notfall sein …)“), Advisor (Auftrag BW-1 mit Akzeptanzkriterien und Abgrenzung zu BW-2, BW-3, KE-1 und FP-2), Executor (Bestandsaufnahme, Speichermodell, Verfall, Bausteine, Tests)
- **Bezug:** [ADR-0043](0043-system-seite.md) (Seite „System“: Route, Prüfungen, losgelöster Neustart, Warten auf `/api/health`), [ADR-0039](0039-betriebsskripte.md) (`neu-starten.bat`, `mail-restart`), [ADR-0057](0057-kontextabhaengige-oberflaeche.md) (Kontext des Tabs: Verwalter, dieser Rechner, Windows), [ADR-0071](0071-fehlerdetails-und-sitzungsprotokoll.md) (Problemeinträge, „Details“, Sitzungsprotokoll), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) §4 (Einrichtungsassistent), [ADR-0025](0025-ui-konsistenz-overlay-system.md) (Bestätigung im Modal als Inline-Frage, Nachtrag 16), [ADR-0018](0018-secrets.md) (Zugangsdaten nur als `BYL_*`-Variablen)

## Kontext

Die Einrichtungsassistenten der Kanäle (`ChannelSetup`) schickten für einen nötigen Neustart aus dem Browser hinaus: „Im Ordner app neu-starten.bat doppelklicken“. Die Seite „Einstellungen → System“ kann die App dagegen seit SY-1 selbst neu starten (ADR-0043). Nach dem Neustart oder einem Neuladen der Seite stand der Assistent wieder beim ersten offenen Schritt nach den Daten des Servers; der Schritt, an dem man war, galt nur, wenn er später lag, und Eingaben eines neuen Assistenten waren verloren.

### Bestandsaufnahme (`web/src`, Stand `0b8085a0`)

| Datei | Anlass | Heutiger Text bzw. Weg |
|---|---|---|
| `components/channels/ChannelSetup.svelte`, Schritt „Neu starten“ (Google Calendar, Telegram, Web.de, Gmail, Notion, GitHub; Texte in `domain/channel-setup.ts`) | neue `BYL_*`-Variable; der Server sieht sie erst nach einem Neustart | Einleitung „Im Ordner app neu-starten.bat doppelklicken …“, Code-Block `app\neu-starten.bat`, Warnung „Hast du setx schon ausgeführt? Dann starte die App neu: neu-starten.bat im Ordner app.“ |
| `ChannelSetup.svelte`, Schritt „Chat freigeben“ (Telegram) | geänderte Variable der erlaubten IDs | „… dann die App neu starten (neu-starten.bat) und erneut „Jetzt abrufen““, „Mehr dazu“ mit `neu-starten.bat` |
| `ChannelSetup.svelte`, Schritt „Erster Abruf“ (Postfächer), „Hilfsprozess prüfen“ | Mail-Helfer läuft nicht | „Der Mail-Hilfsprozess läuft nicht. neu-starten.bat startet ihn …“ |
| `ChannelSetup.svelte`, Schritt „Prüfen“ (Notion), Ergebnis „Zugangsdaten fehlen“ | fehlende Variable | Text des Servers mit „(neu-starten.bat)“, daneben „Zu Schritt N“ |
| `components/channels/WhatsAppWebSetup.svelte` | kein Neustart | Ort der Erweiterung „dort, wo start.bat liegt“, Hinweis auf `scripts\build.ps1` |
| `components/security/SecurityHosts.svelte`, `SecurityLan.svelte` | geänderte Adressen bzw. Heimnetz | „Neustart nötig“ mit Verweis auf „System“ und `neu-starten.bat` (Einstellungsseiten, kein Assistent) |
| `restartNeeded()` in `lib/guidance/texts.ts` (Tagesplan, Projekte, Papierkorb, Dialoge …) | Migration nach einem Update | „neu-starten.bat im Ordner app doppelklicken“ |
| Karten der Kanäle (`domain/connections.ts`, `channel-health.ts`), Texte der Hooks | Mail-Helfer, fehlende Variable, Token abgelehnt | Texte mit `neu-starten.bat` bzw. `start.bat` |

BW-1 ändert die Zeilen 1 bis 4 (die Assistenten mit Neustart-Bedarf). Die Einstellungsseiten, `restartNeeded()`, die Karten und die Texte des Servers sind allgemeine Neustart-Hinweise und gehören zu BW-2; der Assistent für WhatsApp Web verlangt keinen Neustart.

## Entscheidung

### 1. Neustart an Ort und Stelle, mit dem Mechanismus der Seite „System“

- Der Schritt „Neu starten“ jedes Assistenten bietet **„Jetzt neu starten“**, „Chat freigeben“ von Telegram nach der erkannten Chat-ID ebenfalls; der erste Abruf eines Postfachs bietet nach „Hilfsprozess prüfen“ **„Mail-Helfer neu starten“**.
- Dieselbe Route mit denselben Prüfungen wie die Seite „System“: `POST /api/byl/system/actions/restart` bzw. `…/mail-restart` (ADR-0043 §4: angemeldet, Windows, dieser Rechner, Adresse der App, Verwalter, Rate-Limit, eigene Instanz, eine Aktion zur Zeit). Keine neue Route, keine Änderung an `app/pb_hooks`.
- **Extrahiert statt nachgebaut:** Die Warte-Schleife der Seite („Server war weg und antwortet wieder, oder antwortet mit neuer Startzeit“, Abfrage jede Sekunde, Aufgabe nach 90 s) steht jetzt in `stores/restart-follow.ts` (`followRestart`, `RestartData`, Uhr und Zeiten); der `SystemStore` nutzt sie unverändert. Der neue `RestartStore` (`stores/restart.svelte.ts`) liest vor dem Neustart den Status (PID und Startzeit), startet ihn und wartet; ein Lauf zur Zeit, je Seite ein Store (die Seite „Kanäle“ legt ihn mit `systemData(pb)` an).
- **Ort eines Laufs:** Jeder Lauf merkt sich, wo er gestartet wurde (`place`, etwa `setup:telegram:<id>:restart`); nur dort zeigt `RestartAction` Fortschritt und Ergebnis, auch wenn der Assistent zwischendurch geschlossen und wieder geöffnet wurde.
- **Ablauf in der Oberfläche** (`components/system/RestartAction.svelte`): Frage „becauseyoulovejira jetzt neu starten?“ mit den Sätzen der Seite „System“ und „Diese Ansicht bleibt dabei offen und steht danach wieder hier.“ (im Modal als Inline-Frage, kein Dialog aus dem Dialog), dann „Neustart läuft …“ mit Phase („wird vorbereitet“, „wird geordnet beendet“, „startet wieder“) in einer Statuszeile, danach „becauseyoulovejira wurde neu gestartet. Läuft seit …“ im Schritt (kein Flag, wie das Ergebnis eines Abrufs im Assistenten). Danach prüft der Schritt erneut, ob die App die Variablen sieht (`checkStatus`); beim Mail-Helfer prüft er den Hilfsprozess erneut.
- Ablehnungen der Route stehen wie auf der Seite „System“ als Warnung, nur `script` ist ein Fehler. Texte, die dort ein Skript nennen (`script`, `unavailable`, `missing`), haben hier eigene Fassungen ohne Skript (`RESTART_DENIAL_TEXTS`).

### 2. Ohne Recht: wer was wo tun muss

Ob der Tab neu starten darf, entscheidet der Kontext (ADR-0057, `capabilities.scripts`: Verwalter, dieser Rechner, Windows); der Server prüft ohnehin selbst. Statt des Knopfs steht (`restartElsewhere` in `lib/guidance/texts.ts`, nie ein Skript):

- **anderes Gerät** (Verwalter): „Nur direkt am PC verfügbar, auf dem becauseyoulovejira läuft (dort über … öffnen).“ und „Dort startest du die App mit „Jetzt neu starten“ in diesem Schritt neu oder auf der Seite „Einstellungen → System“. Danach siehst du hier, ob es gewirkt hat.“
- **anderes Konto:** „Neu starten darf nur der Verwalter der App, und nur direkt am PC …“ und „Bitte den Verwalter darum. …“
- **Server ohne Windows:** „Auf diesem Server nicht verfügbar.“ und der Verweis auf den Hinweis zur Plattform oben im Assistenten.
- Solange der Kontext lädt, nichts (nichts blitzt auf).

### 3. Der Weg über den Ordner `app` ist der Notfall

Unter jedem „Jetzt neu starten“ bzw. „Mail-Helfer neu starten“ steht eingeklappt **„Notfall: Neustart über den Ordner app“** (`RestartEmergency`, natives `<details>` wie „Mehr dazu“, nur für den Verwalter am PC unter Windows). Darin: „Nur wenn „Jetzt neu starten“ hier nicht geht: Im Ordner app neu-starten.bat doppelklicken …“, der Code-Block `app\neu-starten.bat` des Schritts und „Antwortet die App danach gar nicht mehr, startet start.bat im Ordner app sie wieder …“. Die Einleitungen der Schritte nennen den Knopf, kein Skript; auch die Übersicht „Alle Schritte anzeigen“ klappt die Datei ein. Kommt der Server nach 90 s nicht zurück, verweist der Fehler auf diesen Abschnitt. „Fehlen Zugangsdaten“ von Notion verliert im Assistenten die Klammer mit `neu-starten.bat`, weil „Zu Schritt N“ zum Knopf führt.

### 4. Rückkehr zum selben Schritt

- **Speicher:** nur `sessionStorage` des Tabs (`domain/setup-resume.ts`, rein): bei einer bestehenden Einrichtung unter **`byl-setup:<id>`** (die bestehende Konvention, bisher nur die Nummer des Schritts), vor der Verbindung unter **`byl-setup:neu:<art>`**. Beim Anlegen der Verbindung zieht der Eintrag zur neuen ID um.
- **Form:** `{ "v": 1, "step": n, "savedAt": ms, "restart": true?, "connect": {…}? }`. `restart` steht, sobald aus dem Schritt ein Neustart gestartet wurde; dann öffnet der Assistent **genau diesen Schritt**, auch wenn die Daten des Servers schon weiter sind (nach dem Neustart sieht die App die Variable, und ohne die Marke öffnete er den nächsten Schritt). Sonst gilt wie bisher der spätere von gemerktem Schritt und erstem offenem Schritt nach den Daten.
- **Eingaben:** nur die des Schritts „Verbinden“, solange es keine Verbindung gibt (`SetupConnectInputs`): Bezeichnung, Adresse des Postfachs, Namen der Variablen, bei GitHub „Alle meine Repositorys“ und das erste Repository mit Pfaden, Ereignissen und Ziel, bei Ordnern der erste Ordner mit seinen Einstellungen. Die übrigen Schritte speichern ohnehin sofort (Stichwörter, Zielprojekt, Repositorys und Ordner der Verbindung, Schalter); ein halb getipptes Stichwort oder Repository in einem späteren Schritt wird nicht wiederhergestellt.
- **Verfall: zwei Stunden** nach dem letzten Schreiben (jede Änderung schreibt neu). Begründung: Eine Einrichtung mit Token beim Anbieter, Variable und Neustart dauert Minuten, selten eine Stunde; eine Pause passt hinein. Ein Tab, der bis zum nächsten Tag offen bleibt, beginnt wieder bei den Daten des Servers, statt alte Eingaben und einen alten Schritt zu zeigen. Ein Eintrag aus der Zukunft (mehr als eine Minute) gilt als beschädigt.
- **Beschädigte Einträge** (kein JSON, andere Form, Schritt außerhalb 0 bis 20, ein Text, der wie ein Token aussieht) werden beim Lesen verworfen und gelöscht, ohne Fehler; beim Öffnen eines Assistenten gehen auch verfallene und beschädigte Einträge anderer Assistenten des Tabs. Die Form vor BW-1 (nur die Nummer) gilt einmal als dieser Schritt.
- **Aufräumen:** „Später fortsetzen“ behält den Eintrag (der Assistent steht beim nächsten Öffnen dort); „Fertig“, ×, Esc, Klick daneben und „Listen übernehmen …“ von Notion beenden die Einrichtung und löschen ihn (Abschluss bzw. Abbruch); eine gelöschte Verbindung nimmt ihren Eintrag mit. Ein Neustart und ein Neuladen schließen den Assistenten nicht, der Eintrag bleibt.

### 5. Keine Geheimnisse im Speicher

- Werte von „Wert hier einsetzen“ (`SecretValueField`) bleiben wie bisher nur im Zustand ihrer Komponente; das Speichermodell hat für sie kein Feld.
- Geschrieben werden nur die Felder von `SetupConnectInputs`; jedes Textfeld läuft beim Schreiben und Lesen durch `looksLikeSecret` (JWT, Tokens von GitHub, Notion und Telegram, Zugangsschlüssel `byl_…`, private iCal-Adresse von Google, ein langes Wort aus Buchstaben und Ziffern) und bleibt dann leer; Namen der Variablen nur in ihrer Form `BYL_…`. Unbekannte Felder werden nie geschrieben.
- **Hinweis:** Nach einem Neuladen oder einem Neustart sagt ein Schritt mit „Wert hier einsetzen“ für ein Geheimnis: „Was du unter „Wert hier einsetzen“ eingetragen hattest, ist nicht mehr da: Die App speichert solche Werte nie, auch nicht für einen Neustart oder ein Neuladen der Seite. Füge den Wert bei Bedarf erneut ein.“

### 6. Fehler nach FP-1 in den berührten Dialogen

- Neustart und Mail-Helfer: ein Fehlschlag der Anfrage, eine Ablehnung `script` und eine unlesbare Antwort tragen einen Eintrag mit der Absicht „App neu starten“ bzw. „Mail-Helfer neu starten“. Die Datenschicht der Seite „System“ legt den Eintrag einer Ablehnung neben die Antwort (`denialProblem`), damit die Form der Antworten gleich bleibt (die Integrationstests vergleichen sie). Kommt der Server nicht zurück: „Keine Verbindung zum Server“ mit `GET /api/health` (`unansweredProblem` in `data/errors.ts`); beginnt der Neustart nicht: „Vom Server gemeldeter Fehler“ mit dem Eintrag des Skripts aus `backgroundProblem`, sofern es einen gibt.
- „Erneut prüfen“ (Variablen): Bisher hieß ein Fehlschlag nur „… ließ sich nicht prüfen“; jetzt steht darunter der Fehler mit „Details“ (Absicht „Zugangsdaten des Kanals prüfen“, `statusFailure` im `ConnectionsStore`).
- „Hilfsprozess prüfen“: Fehlschläge mit „Details“ (Absicht „Mail-Helfer prüfen“; der Eintrag einer Ablehnung liegt neben dem Ergebnis, `mailboxProblem`); „Hilfsprozess läuft nicht“ bleibt ein neutraler Hinweis.
- Stichwörter im Assistenten: `KeywordEditor` nimmt neben einem Text auch Text und Eintrag an und zeigt „Details“; die anderen Aufrufer bleiben bei Text.
- **Neue Absichten:** keine. Alle Routen stehen schon im Katalog, der Konsistenztest bleibt unverändert.
- **Noch ohne „Details“** im Assistenten (wie in ADR-0071 §6 für FP-3 vorgesehen): Zielprojekt (`CardTargetProject`), Repositorys (`GitHubSetupRepos`) und Ordner (`FolderSetupList`), weil ihre Stores nur Text zurückgeben und dieselben Rückrufe an den Karten hängen.

## Alternativen

- **Nur ein Nachtrag zu ADR-0043:** Die Route bleibt dieselbe, aber neu sind die Stelle (die Assistenten), das Speichermodell mit Verfall, die Regel zum Notfall-Weg und der Umgang mit Geheimnissen. Verworfen zugunsten einer eigenen ADR; ADR-0043 bekommt einen Nachtrag mit Verweis.
- **Eigene Neustart-Route für die Assistenten:** doppelte Prüfungen und Angriffsfläche. Verworfen.
- **Den Assistenten während des Neustarts sperren:** Der Neustart läuft im Server weiter, auch wenn der Assistent zugeht; der Store der Seite behält das Ergebnis. Verworfen.
- **Immer genau den gemerkten Schritt öffnen:** Dann folgte ein Assistent den Daten des Servers nie mehr, sobald man einmal geklickt hat. Verworfen; genau nur nach einem Neustart aus dem Schritt.
- **`localStorage` oder Server:** länger sichtbar, auch für andere Tabs und Konten desselben Browsers. Verworfen; die Einrichtung gehört zum Tab.
- **Längerer Verfall (24 Stunden) oder keiner:** alte Eingaben und Schritte am nächsten Tag; ohne Verfall nur das Ende des Tabs. Verworfen zugunsten von zwei Stunden.
- **Alle Eingaben aller Schritte speichern:** Die späteren Schritte speichern sofort am Server; ein Entwurf darin wäre selten nötig und vergrößert die Fläche für versehentlich eingefügte Geheimnisse. Verworfen.

## Konsequenzen

- Nur die SPA ändert sich, keine Hooks, keine Migration: nach dem Build genügt F5, kein Neustart.
- Die Assistenten schicken für einen Neustart nicht mehr aus dem Browser hinaus; `neu-starten.bat` und `start.bat` stehen nur noch eingeklappt unter „Notfall“.
- `RestartAction` und `RestartEmergency` sind der Baustein für BW-2 (allgemeine Neustart-Hinweise mit Knopf).

## Grenzen

- Neu starten geht wie auf der Seite „System“ nur unter Windows, am Rechner der App und für den Verwalter; Mitglieder öffnen Assistenten mit Zugangsdaten ohnehin nicht (ADR-0056 §5).
- Der Schritt „Variable setzen“ verlangt weiter `setx` oder die Systemsteuerung am PC; Zugangsdaten aus dem Browser setzen ist BW-3.
- Texte des Servers (Hooks, Mail-Helfer) mit `neu-starten.bat` bleiben, wo der Assistent sie unverändert zeigt, etwa der Hinweis eines abgelehnten Tokens; ihre Prüfung ist BW-2.
- Ein neues Tab desselben Browsers hat seinen eigenen `sessionStorage` und beginnt bei den Daten des Servers.
