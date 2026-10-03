# ADR-0035: Start, Einstieg per Datei und Wiederverwenden offener Tabs, mit installierbarer Web-App

- **Status:** Angenommen und umgesetzt in den Paketen SF-1 bis SF-6 nach [docs/plan/start-fenster.md](../plan/start-fenster.md) (#137 bis #142); manuelle Browser-Prüfungen stehen im Test-Manifest
- **Datum:** 2026-09-28
- **Entscheidung durch:** Nutzer (Datei-Aufruf mit Serverprüfung und Countdown, kein zweiter Tab durch `start.bat`, Selbstschließen doppelter Tabs mit „Hier weiterarbeiten“, Windows-Benachrichtigung als Opt-in, installierbare Web-App mit `focus-existing`, Fail-open, kein Win32-Fensterfokus; 2026-09-28), Advisor (Konzept „Start, Landing per `file://` und Wiederverwenden des Browser-Tabs“), Executor (Routen, Sicherheitsregeln, Einzelheiten)
- **Ergänzt:** [ADR-0002](0002-erststart-und-superuser.md) §6 (neue Routen, aber keine Setup-Route), [ADR-0007](0007-realtime-und-sitzungspflege.md) (eigenes Realtime-Thema `byl/attention`)
- **Führt zusammen:** Stufe S1 „Installierte Web-App“ aus [ADR-0028](0028-plattform-strategie.md) §6 und [docs/plan/plattformen.md](../plan/plattformen.md)
- **Bezug:** [ADR-0025](0025-ui-konsistenz-overlay-system.md) (Modal, Flags), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) (Einstellungen, Hinweise)

## Kontext

- `start.bat` öffnet heute **immer** einen Tab, auch wenn die App schon in einem Tab offen ist. Der häufige Weg des Nutzers „`stop.bat`, dann `start.bat`, dann F5“ hinterlässt so jedes Mal einen weiteren Tab, obwohl sich der alte Tab über das Realtime-SDK von selbst neu verbindet.
- Ein Doppelklick auf `app\pb_public\index.html` zeigt eine **leere Seite**: Unter `file://` findet der Browser die Module unter `/_app/` nicht.
- Eine Webseite darf keinen **anderen** Tab nach vorn holen. `window.focus()` wirkt nur mit Nutzeraktivierung. Echten Fokus gibt es nur für eine **installierte** Web-App über `launch_handler` bzw. über das Betriebssystem.
- ADR-0028 plant die installierte Web-App (Stufe S1) ohnehin. Beides wird hier zusammen entschieden.

## Entscheidung

### 1. Einstieg per Datei

- **`app\becauseyoulovejira.html`** (versioniert, ohne Build) ist der offizielle Einstieg per Doppelklick neben `start.bat`. Der Name hat keine Umlaute und keine Leerzeichen, damit `file://`-Adressen, ZIPs und Verknüpfungen sauber bleiben.
- Die Seite ist in sich geschlossen: kein externes Skript, keine externe Schrift, nur Systemfarben (`Canvas`, `CanvasText`, `LinkText`, …), keine Hex-Werte.
- Sie prüft sofort und dann jede Sekunde (verborgen alle 5 s) `http://127.0.0.1:8090/api/health` (Timeout 1,5 s; scheitert CORS, zählt eine Antwort im Modus `no-cors` als erreichbar).
  - Ist der Server beim **ersten** Versuch da, fragt sie nach offenen Tabs (§4) und leitet ohne offenen Tab **sofort** weiter.
  - Kommt der Server **später** hoch, meldet sie sich sofort beim Server (`start.bat` sieht so „die Landing-Seite übernimmt“) und zählt **5 s** herunter, mit „Jetzt öffnen“ und „Abbrechen“ (WCAG 2.2.1).
  - Bestätigt ein offener Tab, sagt sie „schon offen“ und schließt sich nach 5 s (`window.close()`; scheitert das: „Du kannst diesen Tab jetzt schließen.“), mit „Trotzdem hier öffnen“ und „Abbrechen“.
  - Der Link „App öffnen“ (`http://127.0.0.1:8090/`) ist **immer** da, auch ohne JavaScript.
- **Weiche in `app.html`:** Die erste Anweisung des Inline-Skripts leitet `file:` per `location.replace` relativ auf `../becauseyoulovejira.html` um. Theme, Akzent und Transparenz entfallen dann. Unter `http:` ändert sich nichts.

### 2. Fail-open und Serverfrage vor jedem neuen Tab

- `start.bat` und die Landing-Seite öffnen einen Tab erst nach einer Frage an den Server.
- **Bei jeder Unklarheit** (keine Antwort, 403, 404, 429, kaputtes JSON, kein Ack in der Frist) öffnet `start.bat` den Tab wie bisher. Lieber ein zweiter Tab als keiner.

### 3. Präsenz über Realtime mit Ping und Ack

- Die App-Tabs abonnieren im `(app)`-Layout das Thema **`byl/attention`** auf derselben SSE-Verbindung wie die übrigen Stores (ADR-0007), ohne Optionen.
- Der Server zählt die Clients mit diesem Abo und einer Anmeldung aus `users` (`$app.subscriptionsBroker().clients()`, `hasSubscription`, `get("auth")`). Gäste und Superuser zählen nicht.
- Statt eines Heartbeats schickt der Server eine Nachricht mit Nonce, und ein wacher Tab bestätigt sie (**Ack**). Ein eingefrorener Hintergrund-Tab ist zwar verbunden, bestätigt aber nicht. Dann gilt Fail-open, und §6 fängt den zweiten Tab ab.
- Kein Polling durch die Tabs (CLAUDE.md §7): Sie hören nur auf die ohnehin offene Verbindung. Gefragt wird nur beim Start (`start.bat` höchstens rund 3 s plus 2 s auf ein Ack) und von der Landing-Seite (nur unter `file://`).

### 4. Routen und Zugriffsregeln

`app/pb_hooks/presence.pb.js`, Logik in `lib/presence-service.js`, reine Regeln in `lib/presence-rules.js`.

| Route | Wer darf | Antwort |
|---|---|---|
| `GET /api/byl/presence` | nur **Skripte**: kein `Origin`, kein `Sec-Fetch-Site`, kein `Sec-Fetch-Mode`; sonst 403 | `{ "tabs": n, "landingAgoMs": number \| null }` |
| `POST /api/byl/attention?reason=start\|datei\|stop` | Skripte **oder** `Origin: null` (`file://`); sonst 403 | `{ "nonce": "…", "notified": n }`; höchstens eine Nachricht je 2 s, sonst 429; unbekannter Grund 400 |
| `GET /api/byl/attention/{nonce}` | wie oben | `{ "acked": bool }`; unbekannt oder abgelaufen 404 |
| `POST /api/byl/attention/{nonce}/ack` | angemeldete App-Nutzer (`$apis.requireAuth('users')`) | 204; unbekannt 404 |

- Alle Routen außer dem Ack verlangen zusätzlich eine Verbindung von **diesem Rechner** (`e.remoteIP()` ist Loopback). Das gilt auch, wenn der Server später hinter einem Proxy läuft (ADR-0028 S2/S3): Dort antworten sie mit 403.
- **Zustand nur im Speicher** (`$app.store()`, Schlüssel mit `byl.`): je Nonce `{ createdAt, acked }` als Text, dazu „Landing gesehen“ und „letzte Nachricht“. Jeder Aufruf löscht Einträge über 60 s. Nach einem Neustart ist alles leer, das ist gewollt. Nonce: `$security.randomString(24)`.
- Die Nachricht enthält nur `{ nonce, reason }`.
- Eine Anfrage mit `Origin: null` setzt den Zeitstempel „Landing gesehen“, auch wenn die Nachricht selbst mit 429 abgelehnt wird. `start.bat` öffnet keinen Tab, wenn sich eine Landing-Seite vor weniger als 10 s gemeldet hat.
- Die Anfragen der Landing-Seite sind „einfache“ CORS-Anfragen (POST ohne Body, der Grund steht in der Adresse): kein Preflight. PocketBase läuft ohne `--origins` und antwortet mit `Access-Control-Allow-Origin`.

**Sicherheit:**

- Die Bindung bleibt `127.0.0.1` (CLAUDE.md §3).
- Die Präsenz verrät nur eine Zahl und ist für jeden Browser gesperrt (jeder aktuelle Browser sendet die `Sec-Fetch`-Kopfzeilen, auch beim Aufruf über die Adresszeile). Fremde Seiten können sie also nicht als Fingerabdruck nutzen. Lokale Prozesse sind nicht im Bedrohungsmodell; sie könnten `pb_data` lesen.
- `Origin: null` senden auch Frames fremder Seiten mit `sandbox`. Der schlimmste Missbrauch ist ein harmloses Flag im App-Tab oder das Unterdrücken **eines** Browser-Starts innerhalb von 10 s. Dagegen stehen die Rate-Grenze und Chromes „Local Network Access“, der öffentliche Seiten vor Zugriffen auf Loopback fragt.
- **Keine CSRF-Wirkung:** Die Routen ohne Anmeldung schreiben keine Collection und keine Einstellung, nur den flüchtigen Zustand oben. Das Ack verlangt den Token im `Authorization`-Header; ein Cookie gibt es nicht.
- Keine Daten, keine Tokens, keine Konten in Antworten und Nachrichten. **Keine Setup-Route im Sinne von ADR-0002 §6:** Nichts verrät, ob es Konten gibt.

### 5. App-Seite

- Beim Empfang schickt der Tab **zuerst** das Ack und zeigt dann den Hinweis. Bei `reason = stop` gibt es kein Ack (`stop.bat` wartet nicht).
- **`start` bzw. `datei`:** Info-Flag über den `FlagSink` „Du hast becauseyoulovejira erneut geöffnet. Die App ist hier schon offen.“ (8 s, pausiert bei verborgenem Tab wie jedes Flag). Solange der Tab verborgen ist, höchstens 30 s lang, wechselt der Titel jede Sekunde zwischen dem normalen Titel und „● Hier ist becauseyoulovejira“. Beim Sichtbarwerden und beim Verlassen stellt er sich wieder her.
- **`stop`:** neutrales Info-Flag „becauseyoulovejira wurde beendet (stop.bat). Zum Weiterarbeiten start.bat ausführen.“, das stehen bleibt, bis die Verbindung zurück ist oder es geschlossen wird. Kein Fehler-Flag, denn es ist kein Fehler.
- **Systembenachrichtigung als Opt-in** (Nutzerentscheidung, standardmäßig aus): Schalter unter „Einstellungen → Darstellung“. Die Erlaubnis wird erst beim Einschalten erfragt. Nur bei `start`/`datei` und nur bei verborgenem Tab erscheint „becauseyoulovejira ist schon offen“ mit `tag: 'byl-attention'`; ein Klick ist eine Nutzeraktivierung und holt den Tab mit `window.focus()` nach vorn. CLAUDE.md §10 („Browser-Benachrichtigungen bei offenem Tab“, Stufe 2) ist damit nur für diesen einen Hinweis freigegeben.

### 6. BroadcastChannel als Sicherheitsnetz

- Jeder Tab lauscht auf dem Kanal `byl-tabs` (Wurzel-Layout, also auch auf `/login`). Auf `hello` antwortet er `here`, auf `attention` reagiert er wie in §5, ohne Server.
- Ein neuer Tab prüft nur, wenn `shouldCheckForDuplicate` wahr ist: Referrer leer oder mit fremder Origin **und** Navigation vom Typ `navigate` (kein Neuladen, kein Zurück) **und** keine Sitzungsmarke `byl-tab-keep` **und** kein Fenster der installierten App (`display-mode: standalone`). Ein Tab aus einem App-Link per Mittelklick hat einen Referrer mit gleicher Origin und bleibt unberührt.
- Kommt binnen 300 ms `here`, schickt der neue Tab `attention` an den alten und zeigt ein **Modal S** (ADR-0025) „Die App ist schon offen“: Er schließt sich nach 5 s, „Hier weiterarbeiten“ (erster Fokus, setzt `byl-tab-keep` für die Sitzung) und Esc halten an, „Tab schließen“ schließt sofort.
- Das fängt ab, was an §3 vorbeigeht: getippte Adresse, Lesezeichen, ein gedrosselter Hintergrund-Tab ohne Ack. Es wirkt nur im selben Browser und Profil.

### 7. `start.bat` und `stop.bat`

- `byl-control.ps1` ruft vor jedem Öffnen `Resolve-BrowserAction` auf, im Zweig „läuft schon“ und nach `Wait-ServerReady`. Erststart und `-Hidden` bleiben unverändert.
  - Präsenz fragen; eine Landing-Seite in den letzten 10 s: **nichts öffnen**; offene Tabs: Nachricht `start` senden und bis zu 2 s auf ein Ack warten (Ack: nichts öffnen, sonst öffnen).
  - **Kaltstart** (Server gerade gestartet): Die Tabs verbinden sich nach „`stop.bat`, dann `start.bat`“ von selbst neu (SDK-Abstände 0,2 bis 2 s). Deshalb wartet `start.bat` bis zu **3 s** auf Präsenz, bevor es einen Tab öffnet. Die volle Wartezeit fällt nur an, wenn wirklich kein Tab offen ist.
  - Alle Anfragen ohne Proxy, ohne `Origin`, mit Timeout; jeder Fehler führt zu „öffnen“, nie zu einem Fehler-Exit.
- `stop.bat` schickt vor dem Beenden die Nachricht `stop`, ohne zu warten; scheitert sie, wird trotzdem gestoppt.

### 8. Installierbare Web-App (Stufe S1 aus ADR-0028)

- `web/static/manifest.json`: `id`, `start_url` und `scope` `/`, `display: standalone`, Name `becauseyoulovejira`, Icons 192, 512 und 512 `maskable` als PNG (einmalig aus `favicon.svg` erzeugt, Skript und Prüfung im Repo), `launch_handler: { "client_mode": ["focus-existing", "auto"] }`. `.json` statt `.webmanifest`: PocketBase bestimmt den Typ über Go (`mime.TypeByExtension`). `.json` steht in dessen fester Tabelle, `.webmanifest` hängt unter Windows von der Registry ab. Der Harness-Test prüft den Typ.
- Farben: `theme_color` und `background_color` gleichen den Tokens (Test gegen `tokens.css`). Hell und dunkel über zwei `<meta name="theme-color">` mit `media`; eine feste Wahl in der App gleicht die Titelleiste zur Laufzeit aus den berechneten Tokens an. Das ist die einzige Stelle mit Farbwerten außerhalb von `tokens.css` neben `favicon.svg`.
- **Service Worker minimal** (SvelteKit `src/service-worker.ts`, Version aus dem Build): Er speichert **nur** eine Seite „becauseyoulovejira läuft nicht“ vorab. Er fängt nur Navigationen der eigenen Origin außerhalb von `/api/` und `/_/` ab und zeigt diese Seite nur, wenn das Netz scheitert. Keine App-Daten, keine Module, kein Offline-Modus (CLAUDE.md §10): Es gibt nie veraltete Daten.
- **`launchQueue`:** Öffnet die installierte App eine andere Adresse der App (etwa das Bookmarklet), navigiert das vorhandene Fenster dorthin; ungespeicherte Eingaben fragen über den vorhandenen `beforeNavigate`-Weg.
- **`start.bat` bevorzugt die installierte App:** Findet es im Startmenü eine Verknüpfung `becauseyoulovejira` auf `chrome_proxy.exe` bzw. `msedge_proxy.exe` mit `--app-id`, startet es diese. Der Browser wendet `focus-existing` an und holt das vorhandene Fenster nach vorn. Ohne Treffer oder bei einem Fehler gilt §7.
- README „Als App installieren“ (Chrome, Edge).

### 9. Kein Win32-Fensterfokus

`AppActivate` bzw. `SetForegroundWindow` per P/Invoke sind verworfen (Nutzerentscheidung): Der Fenstertitel nennt nur den aktiven Tab, `Add-Type` mit C# ist langsam und ein typisches Muster für Virenscanner, die Foreground-Lock-Regeln erlauben oft nur ein Blinken, und den Tab wählt es ohnehin nicht.

## Alternativen

- **Heartbeat der Tabs per POST alle n Sekunden:** wäre Polling, und schlafende Tabs würden trotzdem melden. Verworfen.
- **Präsenz ohne Sperre für Browser:** wäre ein Fingerabdruck für fremde Seiten. Verworfen.
- **Einmal-Token wie im Vorbild Task-Board** (die Landing-Seite verbraucht ein Flag „Browser öffnen“): ersetzt durch den Zeitstempel „Landing gesehen“, gleiche Idee ohne Einmal-Zustand.
- **`localStorage`-Events statt BroadcastChannel:** unnötig, alle unterstützten Browser haben den Kanal.
- **`manifest.webmanifest`:** Der Typ hinge unter Windows von der Registry ab. Verworfen zugunsten von `manifest.json`.
- **Offline-Caching der App im Service Worker:** zeigt veraltete Daten und widerspricht CLAUDE.md §10. Verworfen.

## Konsequenzen

- Positiv: Kein zweiter Tab nach „`stop.bat`, dann `start.bat`“, solange der alte Tab wach ist; sonst schließt sich der zweite Tab selbst. Der Doppelklick auf eine HTML-Datei führt nicht mehr ins Leere. Mit installierter App holt `start.bat` das vorhandene Fenster wirklich nach vorn.
- Negativ: Vier neue Routen und ein Realtime-Thema. Sie sind klein, zustandsarm und per Test abgesichert.
- Negativ: Beim Kaltstart ohne offenen Tab öffnet sich der Browser bis zu 3 s später als bisher.
- **Nur im Browser prüfbar** (Test-Manifest, manuell): Landing in Chrome, Edge und Firefox; die Abfrage „Local Network Access“ unter `file://`; ein Hintergrund-Tab nach 10 Minuten; „`stop.bat`, dann `start.bat`“ mit offenem Tab; zwei Browser gleichzeitig; Installation, `focus-existing` und das Starten über die Verknüpfung; Benachrichtigung und ihr Klick.

## Nachtrag (2026-09-28, Plan „Wiederholungen verständlich machen“, WK-2): Hinweise beim Start und beim erneuten Öffnen

- §5 bekommt einen Anschluss für weitere Hinweise: `AttentionDeps.opened` läuft nach dem Flag „Du hast becauseyoulovejira erneut geöffnet.“ (bei `start` und `datei`, auch über den BroadcastChannel aus §6, nie bei `stop`).
- Einziger Nutzer ist bisher der Hinweis auf Wiederholungen, die auf eine Entscheidung über einen großen Rückstand warten ([ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 5): das Info-Flag „1 Wiederholung wartet auf deine Entscheidung.“ mit „Ansehen“ (Regel-Panel, bei mehreren die Übersicht). Es erscheint außerdem einmal, sobald das `(app)`-Layout die Regeln geladen hat (Start der App bzw. des Tabs); ein neueres ersetzt das ältere. Ohne wartende Regel erscheint nichts.

## Nachtrag (2026-09-29, [ADR-0039](0039-betriebsskripte.md), BS-1): Adresse der Landing-Seite und Befehle des Steuerskripts

- **§1:** Die Adresse ist nicht mehr fest `http://127.0.0.1:8090/`, sondern die der App (Port in `app\byl-config.json`, Standard 8090). `becauseyoulovejira.html` lädt dafür genau ein Skript, `run/app-adresse.js` aus ihrem Ordner, das `byl-control.ps1` bei `start`, `stop` und `port` schreibt. Sie nimmt den Wert nur, wenn er genau `http://127.0.0.1:<Zahl>/` ist, sonst 8090; fehlt die Datei, bleibt es bei 8090. Sonst lädt die Seite weiterhin nichts, auch nichts von außen. Der Link „App öffnen“ zeigt auf dieselbe Adresse.
- **§7:** `start.bat` und `stop.bat` rufen `byl-control.ps1 start` bzw. `stop` auf. Die Frage nach offenen Tabs, die Nachricht `stop` und der Kaltstart mit bis zu 3 s Wartezeit gelten unverändert, auch für `restart` und (ab BS-3) `neu-starten.bat`; `-NoBrowser` lässt die Frage aus. Beendet wird seit ADR-0039 geordnet (Konsolensignal, danach erst hart).
- **§5 (seit BS-3):** Das Flag zu `stop` heißt „becauseyoulovejira wurde beendet.“ mit „Zum Weiterarbeiten start.bat ausführen. Nach einem Neustart verbindet sich dieser Tab von selbst.“, weil auch `restart` und `neu-starten.bat` die Nachricht `stop` senden.

## Nachtrag (2026-10-03, [ADR-0055](0055-sicherheits-haertung.md), SH-1): CORS nur noch für die Landing-Seite, Präsenz ohne Geheimnis

- **§4, letzter Punkt der Routen:** PocketBase läuft jetzt mit `--origins` für die eigenen Adressen und antwortet `Origin: null` nicht mehr. Der Guard aller Anfragen (`security.pb.js`) setzt `Access-Control-Allow-Origin: null` nur auf `POST /api/byl/attention` und `GET /api/byl/attention/{nonce}`, damit die Landing-Seite Nonce und Bestätigung weiter liest. Der Rest gilt unverändert: Wer die Routen benutzen darf, entscheiden sie selbst; `/api/health` prüft die Seite ohne Freigabe im Modus `no-cors` (§1).
- **§4, Sicherheit:** DNS-Rebinding fängt jetzt der Guard ab (fremder `Host` 403). Die Art „control“ bleibt bewusst ohne Geheimnis: Browser schicken an `127.0.0.1` immer `Sec-Fetch-*`, und ein Geheimnis, das nur das Steuerskript kennt, gibt es auf einem Einzelplatz-Rechner nicht (ADR-0055 §5).
- **§6:** Die Antworten tragen `Referrer-Policy: same-origin`, nicht `no-referrer`: Der Referrer gleicher Origin, an dem ein Tab aus einem Link der App erkennt, dass er kein neuer Start ist, bleibt erhalten.
- Belegt in `tests/integration/security.test.mjs` (Landing-Seite mit `Origin: null` auf den Hinweis-Routen mit Freigabe, auf der Präsenz ohne).
