# ADR-0055: Sicherheits-Härtung – Schutz vor Rateversuchen, nur die eigenen Adressen, Sicherheits-Header

- **Status:** Angenommen; SH-1 (Server: Rate-Limiter, Host-Allowlist, CORS, Header, Admin-Oberfläche) und SH-2 (Seite „Einstellungen → Sicherheit“, §8) umgesetzt nach [Plan „Sicherheit“](../plan/sicherheit.md); Nachtrag 2026-10-04: Verwalter statt Besitzer ([ADR-0056](0056-konten-und-verwalter.md)); Nachtrag HN-1 (Zugriff im Heimnetz über HTTP, [Plan](../plan/heimnetz.md)); Nachtrag KOB-1 (eine Regel für „dieser Rechner“, Audit, Pfad der Erweiterung nur für den Verwalter, [ADR-0057](0057-kontextabhaengige-oberflaeche.md)); Nachtrag E7-2 (strenges Rate-Limit für das Beitreten zu einem Haushalt, [ADR-0058](0058-haushalt-mitgliedschaft-einladungen-rechte.md))
- **Datum:** 2026-10-03
- **Entscheidung durch:** Nutzer (Freigabe der Härtung am 2026-10-03: „Ja, kannst Du starten. Und was auch immer nötig ist, kann man auch (sofern sinnvoll und auch ganzheitlich) in den Einstellungen verankern?“), Advisor (Befunde, Maßnahmen, Pakete), Executor (Werte der Stufen, Ausnahmen, Einzelheiten)
- **Bezug:** [ADR-0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md) §3 (Voraussetzungen für Mehrgeräte: Rate-Limiter, Superuser nur lokal, `--origins`; Nachtrag), [ADR-0035](0035-start-einstieg-und-offene-tabs.md) §4 (Präsenz und Hinweis; Nachtrag), [ADR-0038](0038-eigener-eingang-und-whatsapp-web.md) §2 (CORS der Erweiterung; Nachtrag), [ADR-0039](0039-betriebsskripte.md) (Start-Argumente, Fingerabdruck; Nachtrag), [ADR-0043](0043-system-seite.md) (Host- und Origin-Prüfung der eigenen Routen; Nachtrag), [ADR-0040](0040-veroeffentlichen-ohne-unterbrechung.md) (`Cache-Control`), [ADR-0051](0051-ordner-kanal-verweise-statt-kopien.md) §6 (Kopfzeilen der Datei-Route)

## Kontext

becauseyoulovejira läuft nur auf `127.0.0.1` (ADR-0001). Bedroht ist die App deshalb vor allem aus dem **Browser des Nutzers**: Jede Webseite, die er besucht, kann Anfragen an `http://127.0.0.1:<Port>` schicken. Lokale Programme desselben Windows-Kontos stehen außerhalb des Bedrohungsmodells; sie könnten `pb_data` direkt lesen (ADR-0035 §4).

Die Inventur vom 2026-10-03 ergab:

- **Kein Rate-Limiter:** Keine Migration setzte `rateLimits`, PocketBase 0.40.4 liefert ihn ausgeschaltet aus. Die Anmeldung von App- und Admin-Konten (`/api/collections/users|_superusers/auth-with-password`) ließ sich beliebig oft versuchen. `superuserIPs` (ADR-0001 §3) war leer.
- **CORS `*`:** PocketBase lief ohne `--origins` (ADR-0035 §4, ADR-0038 §2). Jede Webseite konnte einfache Anfragen schicken **und** die Antworten lesen, etwa die einer Anmeldung mit Formulardaten.
- **DNS-Rebinding:** Eine fremde Seite, deren Name kurz auf `127.0.0.1` zeigt, spricht aus Sicht des Browsers mit ihrer eigenen Origin. Den Namen sieht der Server nur im `Host`. Geprüft haben ihn nur die eigenen Routen von System, Sicherung, Speicher und Ordner (ADR-0043 §3); die Record-API, Realtime, die Anmeldung und die Admin-Oberfläche nicht.
- **Header:** PocketBase setzt `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` und `Cross-Origin-Opener-Policy: same-origin`. Es fehlten eine Referrer-Regel, eine Permissions-Policy und ein Verbot, die App in Frames fremder Seiten zu laden.

Diese Wege müssen weiter funktionieren: die Erweiterung für WhatsApp Web (Service Worker mit `host_permissions`, `Origin: chrome-extension://…`), der eigene Eingang per PowerShell oder curl (ohne `Origin`), das Bookmarklet (öffnet die Seite der App), der Mail-Helfer (`BYL_INGEST_TOKEN`), die Steuerskripte und die Seite „System“, die Landing-Seite per `file://`, die Admin-Oberfläche `/_/`, Realtime per SSE und alle Testinstanzen auf Zufallsports.

## Entscheidung

### 1. Schutz vor Rateversuchen (Rate-Limiter von PocketBase)

Die Migration `1790203500_security_hardening.js` schaltet den eingebauten Rate-Limiter ein, mit den Regeln der Stufe **„Normal“**. PocketBase zählt in festen Zeitfenstern **je Client-Adresse**. Weil die App nur auf diesem Rechner erreichbar ist, teilen sich alle Programme hier eine Zählung (`127.0.0.1`). Daraus folgen die Regeln:

| Regel (`label`) | Wer (`audience`) | Normal | Streng | Wofür |
|---|---|---|---|---|
| `*:auth` | alle | 10 je 60 s | 5 je 300 s | jede Anmeldung (Passwort, OTP, OAuth2), je Collection: App-Konten und Admin-Konten zählen getrennt |
| `*:requestOTP`, `*:requestPasswordReset`, `*:confirmPasswordReset` | alle | 10 je 60 s | 5 je 300 s | Mail-Abläufe, die man erraten könnte (sie sind ohnehin gesperrt, solange es keinen Mailer gibt, CLAUDE.md §5) |
| `/api/byl/ingest/` | ohne Anmeldung | 1000 je 10 s | 1000 je 10 s | Ingest-Routen des Mail-Helfers (`BYL_INGEST_TOKEN`): eine Anfrage je Mail einer Vollsuche, nie im Weg |
| `/api/` | ohne Anmeldung | 300 je 10 s | 100 je 10 s | alles Übrige, was eine Webseite oder ein Programm ohne Konto schicken kann (Gesundheit, Realtime-Verbindung, eigener Eingang, Präsenz) |

- **Begründung der Werte:** 10 Versuche je Minute lassen ein, zwei Tippfehler durch und erlauben doch nur 14 400 Versuche am Tag; „Streng“ (5 je 5 Minuten, höchstens 1 440 am Tag) kostet nach einigen Tippfehlern bis zu fünf Minuten Warten. 300 je 10 s ist der eigene Standard von PocketBase für `/api/`. Die Stufe „Streng“ wählt der Nutzer mit SH-2 auf der Seite „Sicherheit“; ein freies Zahlenfeld gibt es nicht.
- **Was nie zählt:** Anfragen eines angemeldeten Kontos (die Regel für `/api/` gilt nur ohne Anmeldung): Sammelaktionen, Importe, Realtime-Abos und alle Seiten der App bleiben ohne Grenze. Superuser (PocketBase lässt sie immer durch), die Dateien der Oberfläche (keine Regel für `/`), Cron-Jobs (sie laufen im Server, nicht über HTTP). Die Erweiterung und der eigene Eingang behalten zusätzlich ihre eigene Grenze je Schlüssel (ADR-0038).
- **Nur aus dem Zustand von PocketBase:** Die Migration schaltet nur ein, solange der Limiter mit den Regeln von PocketBase 0.40.4 aus ist; Regeln aus der Verwaltung bleiben. Der Rückweg stellt den Ausgangszustand nur her, solange „Normal“ oder „Streng“ eingestellt ist. Dieselben Regeln stehen in `lib/security-rules.js` (`rateLimitRules`, `levelOf`; Gleichstand per Test).
- **Anmeldung gesperrt:** Die Anmeldeseite sagt bei 429 „Zu viele Anmeldeversuche. Zum Schutz vor Rateversuchen ist die Anmeldung kurz gesperrt. Bitte ein paar Minuten warten und dann erneut versuchen.“ (rot wie jede Login-Fehlermeldung, ADR-0009). Sie verrät nichts über das Konto.

### 2. Host-Allowlist gegen DNS-Rebinding

- `app/pb_hooks/security.pb.js` hängt mit `routerUse(new Middleware(…, -1042, 'bylSecurityGuard'))` eine Prüfung vor **jede** Anfrage, vor alle Middlewares von PocketBase außer der www-Weiterleitung: vor CORS (-1041), dem Request-Log, dem Laden des Tokens und dem Rate-Limiter. Eine Anfrage an einen fremden Host liest also nichts und kostet keinen Versuch.
- **Erlaubt** ist der `Host` `127.0.0.1`, `localhost` oder `[::1]` mit genau dem Port aus `--http` (`listenPort` und `isOwnHost` aus `lib/system-rules.js`, dieselbe Regel wie ADR-0043), dazu die Hosts der CORS-Origins des Starts (§3; ohne zusätzliche Hosts sind das dieselben). Groß- und Kleinschreibung zählen nicht; ein anderer Port, ein Punkt am Ende, Namen wie `127.0.0.1.nip.io` und ein `Host` ohne Port nicht.
- **Ablehnung:** 403 mit `{ status, message: "Diese Adresse ist für becauseyoulovejira nicht freigegeben.", reason: "host" }` und eine Zeile „byl-security: Anfrage an fremden Host abgelehnt“ im Log (Host und Pfad gekürzt, ohne Steuerzeichen). Die Prüfungen der eigenen Routen (ADR-0043 §3) bleiben dahinter bestehen.
- Der Port kommt aus den Argumenten des laufenden Servers, also auch bei Testinstanzen auf Zufallsports richtig. Das Steuerskript, der Mail-Helfer, PowerShell und curl schicken `127.0.0.1:<Port>` bzw. `localhost:<Port>`.

### 3. CORS nur für die eigene Oberfläche

- `byl-control.ps1` startet PocketBase mit `--origins=http://127.0.0.1:<Port>,http://localhost:<Port>` (`Get-BylOrigins`, `Get-ServerArgumentString`). Die SPA kommt von derselben Origin und braucht kein CORS; fremde Seiten bekommen keine Freigabe mehr, auch nicht für einen Preflight.
- **Erweiterung für WhatsApp Web:** Ihr Service Worker ruft die App mit `host_permissions` für `127.0.0.1` und `localhost` auf. Für solche Anfragen gelten in Chrome und Edge keine CORS-Beschränkungen (Origin-Allowlist der Erweiterung, kein Preflight), sie braucht also keine Origin in `--origins`. Als enges Sicherheitsnetz, falls ein Browser doch fragt, beantwortet der Guard aus §2 nur auf `/api/byl/inbox/ingest` und nur für `chrome-extension://<32 Buchstaben a–p>` (dieselbe Regel wie `inbox-key-rules.originAllowed`) den Preflight (GET, POST; Authorization, Content-Type; 10 Minuten) und setzt `Access-Control-Allow-Origin` auf diese Origin. `chrome-extension://*` für die ganze API wurde verworfen: Jede installierte Erweiterung bekäme Lesezugriff.
- **Landing-Seite per `file://`:** Sie schickt `Origin: null`. Der Guard antwortet nur auf `POST /api/byl/attention` und `GET /api/byl/attention/{nonce}` mit `Access-Control-Allow-Origin: null`, damit sie wie bisher erkennt, ob ein offener Tab bestätigt hat (ADR-0035 §1). Wer die Routen benutzen darf, entscheiden sie weiter selbst. `/api/health` prüft sie ohne Freigabe im Modus `no-cors` (ADR-0035 §1, unverändert).
- **Zusätzliche Hosts** (Vorbereitung für Mehrgeräte, ADR-0001 §3): `app\byl-config.json` `{ "security": { "hosts": ["rechner.tailnet.ts.net"] } }`, standardmäßig leer. Ein Host ist ein DNS-Name mit mindestens einem Punkt und optionalem Port; IP-Adressen, einzelne Namen wie `localhost` und alles andere fallen weg (höchstens 10; dieselbe Regel in `ConvertTo-BylExtraHost` und `normalizeExtraHost`, Gleichstand per Test). Ungültige Einträge werden ausgelassen, ein Tippfehler kann also nur weniger erlauben. Jeder Host kommt als `https://<Host>` in `--origins`, und der Guard nimmt ihn daraus in seine Liste. Nur HTTPS, weil Mehrgeräte nur über einen HTTPS-Proxy laufen (ADR-0001 §3). Einstellbar auf der Seite „Sicherheit“ (§8) oder mit `byl-control.ps1 security-configure <Namen>`.
- **Neustart:** Der Start-Fingerabdruck (ADR-0039 §5) hat den Teil `hosts`. Eine Änderung der zusätzlichen Hosts heißt „Neustart nötig – andere zusätzliche Adressen eingestellt (byl-config.json)“; ein Zustand von vorher ohne diesen Teil zählt als „keine“.
- **Testinstanzen** starten gleichwertig: Der Harness gibt jeder Instanz `--origins` mit ihren eigenen Adressen (`ownOrigins`), damit alle Tests unter denselben Regeln laufen wie die App.

### 4. Sicherheits-Header

Der Guard setzt vor jeder Antwort:

- `Referrer-Policy: same-origin`: Innerhalb der App bleibt der Referrer, sonst geht keiner hinaus. `no-referrer` wurde verworfen, weil ein Tab aus einem Link der App am Referrer erkennt, dass er kein neuer Start ist (ADR-0035 §6).
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`: Geräte, die die App nie braucht. Zwischenablage und Benachrichtigungen bleiben.
- `Content-Security-Policy: frame-ancestors 'none'` gegen Clickjacking, außer unter `/_/`: Die Admin-Oberfläche setzt ihre eigene, volle CSP (mit `frame-ancestors 'none'`) nur, wenn keine andere gesetzt ist. `frame-ancestors` gewinnt in allen unterstützten Browsern über das `X-Frame-Options: SAMEORIGIN` von PocketBase, das bleibt.
- **Keine volle CSP für die App:** SvelteKit startet mit einem Inline-Skript, `app.html` setzt Theme, Akzent und Transparenz per Inline-Skript vor dem ersten Rendern, die Notfallseite hat einen `onclick`, Tiptap und Svelte setzen Inline-Styles. Eine CSP mit Hashes müsste jede dieser Stellen kennen und bräche bei jeder Änderung still. `frame-ancestors` allein kostet nichts davon.
- **Kein `Cross-Origin-Resource-Policy`:** Die Landing-Seite prüft `/api/health` im Modus `no-cors`; `same-origin` würde diese Antwort sperren.
- Unverändert: `X-Content-Type-Options: nosniff` von PocketBase, `Cache-Control: no-cache` der Oberfläche (ADR-0040) und die Kopfzeilen der Datei-Route (ADR-0051 §6). Deren Sandbox-CSP für Text, Bilder und Downloads nennt jetzt zusätzlich `frame-ancestors 'none'`, weil sie die CSP der Antwort ersetzt.

### 5. Präsenz und Hinweis bleiben ohne Geheimnis

Die Art „control“ der Präsenz- und Hinweis-Routen (ADR-0035 §4: kein `Origin`, kein `Sec-Fetch-*`, nur Loopback) wird **nicht** an ein Geheimnis gebunden:

- Jeder aktuelle Browser schickt `Sec-Fetch-*` an `127.0.0.1` (eine vertrauenswürdige Adresse), auch beim Aufruf über die Adresszeile. „control“ erreichen also nur Programme auf diesem Rechner, und DNS-Rebinding fängt jetzt §2 ab.
- Ein Geheimnis, das nur das Steuerskript kennt, gibt es auf einem Einzelplatz-Rechner nicht: Was das Skript lesen kann (Zustandsdatei, Umgebung, Datei unter `run`), kann jedes Programm desselben Kontos lesen. Diese Programme stehen außerhalb des Bedrohungsmodells (sie könnten `pb_data` lesen).
- Die Wirkung bleibt harmlos: eine Zahl offener Tabs, ein Hinweis im Tab (höchstens einer je 2 s).

### 6. Admin-Oberfläche `/_/`

- Geschützt durch §2 (Host), §1 (eigene Zählung der Admin-Anmeldung) und `superuserIPs` = `127.0.0.1`, `::1` (Migration, nur solange die Liste leer ist; Rückweg leert sie nur, solange sie genau das enthält). Superuser-Anfragen von einer anderen Adresse lehnt PocketBase mit 403 ab. Hinter einem späteren Proxy greift das erst mit dessen Kopfzeilen in `trustedProxy` (ADR-0001 §3).
- `admin-zuruecksetzen.bat` arbeitet ohne HTTP (`superuser upsert`) und ist davon nicht betroffen.

### 7. Tests

- `tests/unit/security-rules.test.mjs`: Stufen, Erkennung der Stufe, Hosts der Origins, zusätzliche Hosts, Header, CORS-Ausnahmen; die Migration gegen eine Attrappe der App mit denselben Regeln.
- `tests/unit/security-control-logic.test.mjs` (Windows): zusätzliche Hosts wie in JavaScript, Origins, `byl-config.json` mit Port, Sicherung und Hosts, Server-Argumente; `control-logic`, `start-logic` und `start-scripts` für Fingerabdruck und Start.
- `tests/integration/security.test.mjs` gegen eigene Instanzen mit eingeschaltetem Limiter: fremder Host 403 auf API, Oberfläche, Admin und Realtime; zusätzliche Hosts aus den Origins; keine CORS-Freigabe für fremde Origins; Landing-Seite und Erweiterung mit Freigabe; Header; zehn falsche Anmeldungen, dann 429 auch mit dem richtigen Passwort, Admin-Konto getrennt; 350 Anfragen der App, 350 des Mail-Helfers, eigener Eingang mit und ohne Erweiterung, Realtime, Seite „System“ und Cron ohne Grenze; die Grenze für Anfragen ohne Konto.
- `tests/integration/migrations-rollback.test.mjs`: Hin- und Rückweg, „Streng“ zurück, Einstellungen der Verwaltung bleiben.
- Der Harness schaltet den Limiter nach jedem Start aus (Superuser, `PATCH /api/settings`), weil die Tests von `127.0.0.1` aus sehr oft anmelden; nur die Tests des Limiters behalten ihn (`rateLimits: true`).

### 8. Seite „Einstellungen → Sicherheit“ (SH-2)

- **Ort und Zugriff:** `/einstellungen/sicherheit` in der Navigation nach „Konto“ ([ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md), Nachtrag), auf jedem Server wie „Speicher“. Die Routen in `security.pb.js` prüfen wie ADR-0043 über `check` (angemeldet, dieser Rechner, Host und `Origin`, nur der Besitzer der Instanz, Rate-Limit je Konto) mit `local` und `anyPlatform`; nur die zusätzlichen Adressen brauchen die eigene Instanz unter Windows (Steuerskript).
  - `GET /api/byl/security`: Stufe (`levelOf`), CORS eingeschränkt, eigene, aktive und eingestellte zusätzliche Hosts, `superuserIPs` mit „nur dieser Rechner“, Gültigkeit der Anmeldung, verschlüsselte Sicherungen im Zielverzeichnis (ADR-0046, ohne Steuerskript), Namen der genutzten `BYL_*`-Variablen mit „gesetzt“ (nie Werte), Zahl und letzte Nutzung der Zugangsschlüssel, Build der Erweiterung, Protokoll der Fehlversuche.
  - `POST /api/byl/security/settings` mit `{ level?, days? }`: schreibt die Regeln der Stufe in die Einstellungen von PocketBase (schaltet den Limiter dabei ein) bzw. `authToken.duration` der Collection `users`; gilt sofort, 400 `invalid` mit `problem` `empty|level|days`.
  - `POST /api/byl/security/hosts` mit `{ hosts }`: jede Adresse muss gültig sein, höchstens 10 (`hostsInput`), sonst 400 `invalid` mit `problem` `format|invalid|too-many` und den abgelehnten Einträgen; dann `byl-control.ps1 security-configure -Json` mit den Hosts auf der Standardeingabe (Whitelist mit dem Merkmal `security`, `/api/byl/system/actions/…` lehnt es ab), das `byl-config.json` schreibt. Gilt nach einem Neustart (Teil `hosts` des Fingerabdrucks, §3); die Seite sagt das und verweist auf „Jetzt neu starten“ der Seite „System“.
  - `GET /api/byl/security/notice`: `{ attention, count, last }` für den Hinweis beim Öffnen.
- **Speicherorte:** Stufe in den Einstellungen von PocketBase (dort wirkt sie; eigene Regeln der Verwaltung heißen „Eigene Einstellung“), Gültigkeit als Option der Collection `users` (eine Einstellung der Anmeldung, kein Schema; bestehende Tokens behalten ihren Ablauf), zusätzliche Adressen in `byl-config.json` (sie gehören zum Start wie der Port, nur das Steuerskript schreibt die Datei). Keine eigenen Felder am Konto: alle drei gelten für die Instanz, nicht für ein Konto.
- **Stufen ohne Zahlenfeld:** „Normal“ und „Streng“ (§1). **Gültigkeit:** 1, 5 (Standard von PocketBase), 14 oder 30 Tage; die offene App verlängert eine Anmeldung, die binnen eines Tages abläuft (ADR-0007), der Wert sagt also, wie lange ein Gerät ohne Öffnen der App angemeldet bleibt. Ein anderer Wert der Verwaltung steht als „Eigene Einstellung“ da.
- **Überblick:** je Punkt ein `Lozenge` (Akzent für aktiv, neutral mit Warnsymbol für etwas, das hilft, gedämpft für „gibt es nicht“; Rot gibt es auf der Seite nicht, kein Punkt ist ein Fehler der App) und „Was bedeutet das?“ als `<details>`.
- **Protokoll fehlgeschlagener Anmeldungen:** `onRecordAuthWithPasswordRequest` für alle Auth-Collections fängt das Scheitern von `e.next()` ab, schreibt eine Zeile nach `login_failures` (Migration `1790203600_login_failures.js`: Bereich App oder Verwaltung, eingegebenes Konto bis 200 Zeichen, ob es das Konto gibt, Herkunft `app`/`web`/`program` nach `Sec-Fetch-Site` und `Origin`, Host, Adresse; **nie das Passwort**; alle API-Regeln `null`) und wirft weiter, die Antwort bleibt die von PocketBase. Vom Rate-Limiter abgewiesene Versuche (429) erreichen den Hook nicht und zählen nicht. Aufbewahrung 30 Tage und höchstens 5 000 Zeilen (bei jedem Eintrag und täglich per Cron `byl-login-failures`). Die Seite zeigt Gruppen (Konto, Bereich, Herkunft, Host) mit Zahl und letzter Zeit.
- **Hinweis beim Öffnen** ([ADR-0035](0035-start-einstieg-und-offene-tabs.md), Nachtrag): ab 10 Fehlversuchen in 24 Stunden das Info-Flag „N fehlgeschlagene Anmeldeversuche in den letzten 24 Stunden.“ mit „Ansehen“ (Protokoll der Seite), je Gerät nur einmal für denselben neuesten Fehlversuch (`localStorage` `byl-security-seen`). Kein Rot: Fehlversuche sind kein Fehler der App.
- **Konto-Hinweise:** Passwort des App-Kontos über „Konto“ (Verwaltung), Admin-Passwort mit `admin-zuruecksetzen.bat`. Hilfe-Abschnitt „Sicherheit“. Der Fehler eines falschen Namens bei `security-configure` kommt aus dem Katalog (`security-hosts`, ADR-0048).

## Alternativen

| Alternative | Bewertung |
|---|---|
| Grenze für alle Anfragen (auch angemeldete), wie der Standard von PocketBase | Alle Programme hier teilen sich eine Adresse: Eine Sammelaktion über ein paar hundert Tickets hätte sich selbst ausgebremst. Verworfen; angemeldete Anfragen sind ohnehin nur das eigene Konto. |
| `excludedIPs` mit `127.0.0.1` | schaltet den Limiter für alles ab, was es hier gibt. Verworfen. |
| Host-Prüfung in jeder Route (wie ADR-0043) | Record-API, Realtime, Anmeldung und Admin-Oberfläche sind Routen von PocketBase; nur eine globale Middleware erreicht sie. |
| Zusätzliche Hosts als eigene Datei im Hook lesen | zweiter Weg neben `--origins`; so hängen CORS und Host-Prüfung an genau einer Angabe des Starts. |
| Volle CSP mit Hashes oder Nonces | siehe §4; bricht leicht und still. Neu bewerten, wenn SvelteKit die Inline-Skripte selbst hasht und die Startskripte ausgelagert sind. |
| Präsenz mit Token des Steuerskripts | siehe §5: schützt nur vor Programmen, die ohnehin alles lesen können. |
| Fehlversuche aus dem Request-Log von PocketBase lesen | Das Log kennt das eingegebene Konto nicht, hat eine andere Aufbewahrung und mischt alle Anfragen. Eine kleine eigene Collection mit fester Aufbewahrung ist klarer. |
| Stufe als freie Zahlen | Zahlenfelder verleiten zu Werten, die die eigene Arbeit ausbremsen (alle Programme teilen sich eine Zählung). Zwei begründete Stufen; wer mehr will, hat die Verwaltung. |

## Konsequenzen

- Positiv: Eine fremde Webseite kann die App weder über DNS-Rebinding erreichen noch Antworten lesen; Raten von Passwörtern ist auf 10 Versuche je Minute begrenzt, die Admin-Oberfläche nur von diesem Rechner erreichbar. Die Voraussetzungen von ADR-0001 §3 sind bis auf die Proxy-Kopfzeilen erfüllt.
- Positiv: Normale Nutzung, Realtime, Mail-Helfer, Erweiterung, eigener Eingang, Bookmarklet, Skripte, Landing-Seite und Admin-Oberfläche funktionieren wie vorher (Tests).
- Negativ: Wer sich mehr als zehnmal in einer Minute vertippt, wartet bis zu einer Minute („Streng“: fünf Minuten). Alle Programme dieses Rechners teilen sich die Zählung.
- Negativ: Ein Aufruf der App über einen anderen Namen (etwa den Rechnernamen) geht nicht mehr; er ging wegen der Bindung an `127.0.0.1` auch vorher nicht.
- Migration, Hooks und `--origins` wirken erst nach einem Neustart der App (`neu-starten.bat`).
- **Nur im Browser prüfbar** (Test-Manifest, manuell): Sperre nach Fehlversuchen in der Anmeldung, eine fremde Seite (auch über DNS-Rebinding) erreicht nichts, Erweiterung, Bookmarklet und eigener Eingang funktionieren, die Seite „Sicherheit“ mit Stufe, Gültigkeit, Adressen, Protokoll und Hinweis.

## Nachtrag (2026-10-04, [ADR-0056](0056-konten-und-verwalter.md), E7-1): Verwalter statt Besitzer, mehrere Konten

- **§8 Zugriff:** „nur der Besitzer der Instanz“ heißt jetzt „nur der Verwalter der App“ (`users.instance_admin`, ADR-0043 Nachtrag). Andere Konten sehen die Seite nicht in der Navigation; der Hinweis beim Öffnen zu Fehlversuchen wird nur für den Verwalter gefragt.
- **Sitzungen:** Ein neues Passwort (selbst geändert oder vom Verwalter zurückgesetzt) und das Deaktivieren eines Kontos beenden alle Sitzungen dieses Kontos sofort (neuer `tokenKey`, auch die Realtime-Verbindung). Ein deaktiviertes Konto meldet sich nicht an; der Versuch zählt im Protokoll als Fehlversuch (das Konto ist „bekannt“).
- **Zugangsdaten:** Verbindungen, die eine `BYL_*`-Variable nennen, und Ordner-Kanäle richtet nur der Verwalter ein; sonst könnte jedes Konto die Zugangsdaten des Windows-Kontos nutzen. Der Überblick „Zugangsdaten“ nennt weiter die Variablen der Verbindungen des angemeldeten Verwalters.
- **Konto-Hinweise (§8):** Das Passwort des App-Kontos ändert jedes Konto selbst unter „Konto“; ein vergessenes setzt der Verwalter unter „Konten“ zurück.

## Nachtrag (2026-10-04, Nutzerentscheidung, HN-1): Zugriff im Heimnetz über HTTP

Nutzerwunsch: „Gern auch so, dass man mit eigener Browser-Instanz per derzeitiger URL IP-Adresse im Netz das BYLJ Dashboard erreichen kann (mein DEV PC hat die 192.168.178.66).“ Anlass ist der Haushalt (E7). Einzelheiten im [Plan „Zugriff im Heimnetz“](../plan/heimnetz.md).

- **Standard aus.** Eingeschaltet (Seite „Sicherheit“ bzw. `byl-control.ps1 lan-configure`, `byl-config.json` `network.lan`) startet die App mit `--http=0.0.0.0:<Port>`, weil PocketBase 0.40.4 nur eine Adresse für `--http` kennt, und mit `http://<Adresse>:<Port>` je gewählter Adresse in `--origins`. Adressen sind private IPv4-Adressen dieses Rechners oder sein Name im Heimnetz (`….fritz.box`, `.local`, `.lan`, `.home.arpa`, `.internal`), höchstens fünf. Der Port bleibt derselbe.
- **§2, Host-Allowlist:** unverändert; der Guard nimmt die Hosts der Origins, also jetzt auch die Adressen des Heimnetzes. Die Seite trennt sie von den zusätzlichen Hosts (§3, nur `https`).
- **§3, zusätzliche Hosts:** unverändert nur über HTTPS. Der Heimnetz-Zugang ist bewusst **unverschlüsselt (HTTP)** und nur für vertrauenswürdige Netze; die Seite, die Hilfe und das README sagen das deutlich. HTTPS folgt mit dem Raspberry Pi (S3, Traefik).
- **§1, Rate-Limiter:** PocketBase zählt je `RealIP()`. Ohne `trustedProxy` ist das die Adresse der Verbindung: Jedes Gerät im Heimnetz hat seine eigene Zählung, der Rechner der App weiter 127.0.0.1.
- **§6, Admin-Oberfläche:** `superuserIPs` prüft `RealIP()`; ein Gerät im Heimnetz bekommt keine Superuser-Anfrage durch, auch mit gefälschter `X-Forwarded-For`. `trustedProxy` bleibt leer.
- **Nur-lokale Routen** (System, Sicherung, Speicher, Sicherheit, Konten, „Ansehen“ beobachteter Dateien, Präsenz und Hinweis) lehnen Geräte im Heimnetz ab: `check` (ADR-0043) verlangt `e.remoteIP()` und `e.realIP()` auf Loopback und keine Proxy-Kopfzeile, Präsenz und Hinweis `e.remoteIP()`. Belegt mit einem simulierten Gerät (Adresse der Verbindung, Test-Hook) und in der CI mit einer echten Verbindung an `0.0.0.0`.
- **Windows-Firewall:** eingehende Regel „becauseyoulovejira (Heimnetz)“ nur für `pocketbase.exe` dieses Ordners, TCP auf dem Port, Profil Privat; angelegt nach einem Klick bzw. J über `Start-Process … -Verb RunAs` (UAC), sonst mit dem `netsh`-Befehl des Fehlerkatalogs. `status` und `doctor` melden Regel und Netzwerkprofil, bei „Öffentlich“ deutlich.
- **Kein QR-Code:** keine neue Abhängigkeit ohne Freigabe (CLAUDE.md §3), ein eigener Kodierer wäre ohne Decoder nicht sinnvoll prüfbar. Die Adresse steht mit „Kopieren“ auf der Seite.
- **Konsequenzen:** Wer den Zugang einschaltet, macht die Anmeldung von jedem Gerät im Heimnetz aus möglich (geschützt durch Konto, Passwort und Rate-Limiter je Gerät). Wechselt die IP-Adresse, antwortet die App unter der alten nicht mehr; dagegen hilft die Reservierung in der FRITZ!Box oder der Name `….fritz.box`. Die Konsequenz „Ein Aufruf der App über einen anderen Namen geht nicht mehr“ oben gilt für alle Namen außer den gewählten Adressen.
- **Mit E7-1:** Die Seiten der Bedienung (Konten, Sicherheit, Sicherung, Speicher, System) bleiben dem Verwalter der App vorbehalten und gehen zusätzlich nur auf diesem Rechner, auch für ihn. Jedes andere Konto meldet sich vom eigenen Gerät an und ändert sein Passwort dort unter „Konto“.

## Nachtrag (2026-10-04, [ADR-0057](0057-kontextabhaengige-oberflaeche.md), KOB-1): Kontext der Oberfläche und Audit der Routen

- **Eine Regel für „dieser Rechner“:** `isLocalRequest` in `lib/system-service.js` (aus `check` herausgelöst) entscheidet für jede Route, die am PC arbeitet, und für `GET /api/byl/context`, die der Oberfläche sagt, ob der Tab von diesem Rechner kommt. Eine Proxy-Kopfzeile macht eine Anfrage nicht lokal; die eigene Adresse des Rechners im Heimnetz zählt als anderes Gerät.
- **Audit:** Jede Route, die am PC etwas auslöst oder verändert (System, Sicherung, Speicher, Sicherheit mit Heimnetz und Firewall, Konten, „Ansehen“), verlangt diesen Rechner und den Verwalter; belegt in `tests/integration/context-route.test.mjs` (ein anderes Konto an diesem Rechner: `owner`, jedes Gerät im Heimnetz: `loopback`). Präsenz und Hinweis bleiben bewusst ohne Konto (§5).
- **Geschlossene Lücke:** `GET /api/byl/whatsapp-web/extension` nannte jedem angemeldeten Konto, auch aus dem Heimnetz, den Pfad des Ordners der Erweiterung auf dem Server. Den Pfad bekommt jetzt nur der Verwalter an diesem Rechner; sonst `folder: ""` (ob gebaut und welche Version, weiter für alle).

## Nachtrag (2026-10-04, [ADR-0058](0058-haushalt-mitgliedschaft-einladungen-rechte.md) §3, E7-2): Beitreten zu einem Haushalt

- **§1, Tabelle:** neue Regel `POST /api/byl/household/join` für alle (`audience` leer, also auch angemeldete Konten) mit den Werten der Stufe „Streng“ der Anmeldung, **5 je 300 s, in beiden Stufen**. Ein Einladungscode wird geraten wie ein Passwort; die Ausnahme von „angemeldete Anfragen nie“ gilt nur für diese eine Route. Die Regel steht nach der des Mail-Helfers und vor `/api/`; als genaue Bezeichnung vergleicht PocketBase sie vor jeder Präfix-Regel.
- **Migration** `1790203810_household_join_limit.js`: ergänzt die Regel nur, solange die Einstellungen genau „Normal“ oder „Streng“ von `1790203500` enthalten (Regeln der Verwaltung bleiben); der Rückweg nimmt sie unter derselben Bedingung heraus. `rateLimitRules()` in `lib/security-rules.js` enthält sie (`JOIN_RULE`); die Seite „Sicherheit“ schreibt sie mit jeder Stufe. Bis zum Neustart nach dem Update erkennt die Seite die alte Liste als „Eigene Einstellung“.
- Jedes Gerät im Heimnetz zählt für sich (Nachtrag HN-1); alle Programme dieses Rechners teilen sich eine Zählung.

## Nachtrag (2026-10-04, Fehlerbericht, `fix/firewall-knopf`): Firewall-Regel per Knopf

Fehlerbericht: Nach „Firewall-Regel anlegen …“ kam keine Abfrage von Windows, die Seite blieb bei „Fehlt“; der Nutzer legte die Regel mit dem angezeigten `netsh`-Befehl selbst an.

- **Ursache:** Der Knopf hatte die Regel angelegt (Ereignis 2097 der Windows-Firewall, Zeile `lan-firewall … outcome=done` in `byl-control.log`). Windows fragte nicht, weil es auf diesem Rechner Administratoren ohne Rückfrage erhöht (`ConsentPromptBehaviorAdmin = 0`). Danach las das Steuerskript die Regel mit `Get-NetFirewallRule`; das antwortet dort ohne Administratorrechte „Zugriff verweigert“, `-ErrorAction SilentlyContinue` verschluckte das, und der Zustand hieß „fehlt“. Die Seite zeigte kurz „Firewall-Regel angelegt“, blieb aber bei „Fehlt“ mit demselben Knopf. Außerdem wartete `Start-Process -Verb RunAs` ohne Grenze, solange eine Abfrage offen war; die 120 s galten erst danach.
- **Lesen ohne Rechte:** über das COM-Objekt `HNetCfg.FwPolicy2` (`Get-BylFirewallSnapshot`, `ConvertFrom-BylFirewallRule`). Jeder Fehler beim Lesen heißt „nicht lesbar“, nie „fehlt“; das gilt auch für `status`, `doctor` und `lan-info`.
- **Ändern:** Das Skript mit Administratorrechten ruft `netsh` aus dem Systemordner wie der Befehl von Hand und entfernt beim Anlegen zuerst alle Regeln des Namens für dieses Programm (auch eine zweite von Hand). Gestartet wird es über ShellExecute mit dem Verb `runas` in einem eigenen Runspace: 120 s gelten ab dem Klick, die Abfrage eingeschlossen, und die Antwort hängt nie. Ohne Sitzung mit Bildschirm (Sitzung 0, Dienst, Aufgabe ohne Anmeldung) versucht es das gar nicht.
- **Nachprüfung:** Nach jeder Änderung liest `Invoke-FirewallChange` die Regel neu. Erfolg gibt es nur, wenn die Regel nach dem Anlegen „vorhanden“ bzw. nach dem Entfernen „fehlt“ ist (`Resolve-BylFirewallOutcome`). Ergebnisse: `done`, `cancelled` (abgelehnt), `timeout`, `unavailable` (Windows kann hier nicht fragen), `failed` (`netsh` meldet einen Fehler), `unconfirmed` (gemeldet, aber nicht so). Jeder Fehlschlag hat einen eigenen Eintrag `lan-firewall-<Ergebnis>` mit dem `netsh`-Befehl; die Einträge ersetzen `lan-firewall-add-failed` und `-remove-failed`. Das gilt gleich für die Seite, den Befehl `lan-firewall` und das J-Angebot. Die Seite zeigt den Zustand nach der Änderung, ohne Eintrag den Befehl mit Anleitung und immer „Zustand neu prüfen“.
- **Tests:** Eine Testkopie antwortet über das Feld `elevation` der Datei `BYL_TEST_NETWORK_FILE`, statt Windows zu fragen; die echte Firewall ändert kein Test.
- **Grenze:** Eine Abfrage aus dem Hintergrund zeigt Windows oft nur als blinkendes Schild-Symbol in der Taskleiste; das sagt die Seite vorher. Ob und wie Windows fragt, bestimmt seine Einstellung der Benutzerkontensteuerung, nicht die App.
