# E6-Plan, Teil „Zugriff im Heimnetz“

- **Stand:** HN-1 umgesetzt (2026-10-04). Offen sind die manuellen Prüfungen.
- **Grundlage:**
  - Nutzerwunsch (2026-10-04, wörtlich): „Gern auch so, dass man mit eigener Browser-Instanz per derzeitiger URL IP-Adresse im Netz das BYLJ Dashboard erreichen kann (mein DEV PC hat die 192.168.178.66).“ Anlass ist der Haushalt (E7): Die zweite Person öffnet die App von ihrem eigenen Gerät im Heimnetz.
  - **Nutzerentscheidung 2026-10-04:** Zugang im Heimnetz über HTTP auf der LAN-Adresse des PCs, unabhängig von S2 (Mehrgeräte über HTTPS) und Tailscale. Die Zurückstellung von S2 bis S6 ([ADR-0028](../adr/0028-plattform-strategie.md), [Plan Plattformen](plattformen.md)) bleibt sonst bestehen; HTTPS über Traefik kommt mit dem Umzug auf den Raspberry Pi (S3).
  - Nachträge zu [ADR-0055](../adr/0055-sicherheits-haertung.md), [ADR-0001](../adr/0001-betriebsmodell-lokal-mehrgeraete-spaeter.md), [ADR-0028](../adr/0028-plattform-strategie.md), [ADR-0039](../adr/0039-betriebsskripte.md), [ADR-0043](../adr/0043-system-seite.md) und [ADR-0035](../adr/0035-start-einstieg-und-offene-tabs.md).
- **Einordnung:** Paketkürzel `HN`, Manifest ab `BYL-E6-1400`. Keine Migration; Hooks und Steuerskript wirken nach einem Neustart.

## 1. Ziel und Grenzen

- Andere Geräte im Heimnetz öffnen die App unter einer Adresse dieses Rechners mit demselben Port, etwa `http://192.168.178.66:8090`, und melden sich mit ihrem eigenen App-Konto an.
- **Standard: aus.** Eingeschaltet wird auf der Seite „Einstellungen → Sicherheit“ (nur der Verwalter der App nach [ADR-0056](../adr/0056-konten-und-verwalter.md), nur auf diesem Rechner) oder mit `byl-control.ps1 lan-configure`.
- **Bewusst unverschlüsselt (HTTP):** Passwörter und Inhalte gehen unverschlüsselt durchs WLAN. Deshalb nur im eigenen, vertrauenswürdigen Heimnetz, deutlich gesagt auf der Seite, in der Hilfe und im README. HTTPS ist nicht Ziel dieses Pakets.
- `start.bat`, die Landing-Seite, die Browser-Erweiterung, der Mail-Hilfsprozess und alle Skripte bleiben auf `127.0.0.1`.

## 2. Entscheidungen

### 2.1 Bindung an `0.0.0.0`

- PocketBase 0.40.4 nimmt für `--http` genau eine Adresse und startet genau einen Listener (`apis/serve.go`: `ServeConfig.HttpAddr`, `net.Listen("tcp", addr)`; ein zweiter Server nur für die HTTP-Weiterleitung neben `--https`). 127.0.0.1 **und** die LAN-Adresse gleichzeitig geht also nicht.
- Eingeschaltet startet die App deshalb mit `--http=0.0.0.0:<Port>`. Go lauscht damit auf beiden Stacks; 127.0.0.1 bleibt erreichbar. Was die App beantwortet, entscheidet weiter die Host-Allowlist (ADR-0055 §2): nur `127.0.0.1`, `localhost`, `[::1]` und die Hosts der Origins des Starts.
- **Verworfen:** nur die LAN-Adresse binden (dann fehlte 127.0.0.1 für `start.bat`, Landing-Seite, Erweiterung und Mail-Helfer); ein zweiter Prozess als Weiterleitung von der LAN-Adresse auf 127.0.0.1 (jede Anfrage käme dann von 127.0.0.1, die Prüfungen „nur dieser Rechner“ und der Rate-Limiter wären ausgehebelt, `trustedProxy` hieße Kopfzeilen vertrauen).
- Die eigene Instanz bleibt die eigene: `Select-AppProcess`, `Get-HttpPort`, `Resolve-PortState` und `isOwnInstance` nehmen `0.0.0.0:<Port>` des Programms dieses Ordners mit `pb_data` an (ADR-0039 §3, ADR-0043 §4, je Nachtrag).

### 2.2 Host-Allowlist und Origins

- `Get-BylOrigins` nimmt nach den eigenen Adressen `http://<Adresse>:<Port>` jeder Adresse des Heimnetzes auf, danach die zusätzlichen Hosts über HTTPS (ADR-0055 §3, unverändert). Der Guard liest seine Liste weiter nur aus `--origins`; eine Änderung am Guard war nicht nötig.
- Die Seite trennt beides: `activeExtraHosts` nimmt nur die `https`-Origins, `activeLanHosts` (`lib/lan-rules.js`) die `http`-Origins außer diesem Rechner.

### 2.3 Adressen

- Eine Adresse ist eine **private IPv4-Adresse** (10/8, 172.16/12, 192.168/16) in der Form, die ein Browser im `Host` schickt (keine führenden Nullen), oder ein **Name des Rechners im Heimnetz** mit `.fritz.box`, `.local`, `.lan`, `.home.arpa` oder `.internal`, ohne Port; höchstens fünf. Dieselbe Regel in `byl-functions.ps1` (`ConvertTo-BylLanAddress`), `lib/lan-rules.js` und `domain/lan.ts` (Paritätstests).
- **Erkannt** werden die privaten IPv4-Adressen in Benutzung (`Get-NetIPAddress`, `AddressState` Preferred) mit Adapter und Netzwerkprofil (`Get-NetConnectionProfile`), private Netzwerke zuerst, und der Name `<Rechner>.<Suffix>`, wenn der DNS-Suffix des Adapters lokal ist (`Get-DnsClient`; eine FRITZ!Box vergibt `fritz.box`).
- **Warum der Name:** Er bleibt gültig, wenn die FRITZ!Box die IP-Adresse wechselt. `.local` wird nicht vorgeschlagen (mDNS lösen Android und Chrome nicht verlässlich auf), lässt sich aber von Hand eintragen.

### 2.4 Einstellung und Befehle

- `byl-config.json`: `{ "network": { "lan": { "enabled": true, "addresses": ["192.168.178.66"] } } }`. Nur ein echtes `true` schaltet ein, ungültige Einträge fallen weg (ein Tippfehler erlaubt nur weniger). Ausschalten behält die Adressen. Nur das Steuerskript schreibt die Datei.
- Neue Befehle: `lan-info` (Zustand, Adressen dieses Rechners, Netzwerkprofil, Firewall-Regel, Befehle von Hand), `lan-configure [on|off|Adressen]` und `lan-firewall add|remove`, für die Seite mit `-Json` und den Parametern auf der Standardeingabe (Whitelist in `lib/system-rules.js` mit dem Merkmal `security`, `/api/byl/system/actions/…` lehnt sie ab).
- Fingerabdruck: neuer Teil `lan` (die Adressen, mit denen der Start lauscht). Grund „Zugriff im Heimnetz geändert (byl-config.json)“; ein Zustand von vorher ohne den Teil zählt wie „aus“.
- Routen in `security.pb.js` mit `check` (angemeldet, dieser Rechner, Adresse der App, Verwalter der App, Rate-Limit, eigene Instanz unter Windows): `GET /api/byl/security/lan`, `POST /api/byl/security/lan` (`{ enabled, addresses }`, 400 `invalid` mit `problem` `format|invalid|too-many|required`) und `POST /api/byl/security/lan/firewall` (`{ action }`, Antwort `{ result: { ok, action, outcome, report }, lan }`). Der Überblick `GET /api/byl/security` nennt ohne Steuerskript `lan: { active, hosts, editable }`.

### 2.5 Windows-Firewall

- Eine eingehende Regel „becauseyoulovejira (Heimnetz)“: nur `pocketbase.exe` dieses Ordners, nur TCP auf dem Port, nur Profil **Privat**.
- **Anlegen und Entfernen** nur nach einem Klick auf der Seite (mit einer Frage, die die Rückfrage von Windows nennt) bzw. einem J im Konsolenfenster oder dem ausdrücklichen Befehl `lan-firewall`: `Start-Process … -Verb RunAs` startet Windows PowerShell mit Administratorrechten (Benutzerkontensteuerung). Das Skript entsteht rein in `Get-BylFirewallScript` (nur Regelname, der in Anführungszeichen gesetzte Pfad und der Port; als `-EncodedCommand`), entfernt zuerst eine ältere Regel desselben Programms (etwa eines alten Ports) und legt dann die eine an. `-Verb RunAs` steht genau einmal im Steuerskript (statisch geprüft).
- **Ohne Erhöhung:** Der Fehlerkatalog (`lan-firewall-missing`, `-mismatch`, `-add-failed`, `-remove-failed`, `-leftover`, ADR-0048) nennt den `netsh advfirewall`-Befehl mit den echten Pfaden für eine Eingabeaufforderung als Administrator; die Seite zeigt ihn ebenso zum Kopieren.
- **Lesen ohne Rechte:** `Get-NetFirewallRule` mit dem Anzeigenamen und den Filtern; eine eingeschaltete Sperrregel für das Programm (meist nach „Abbrechen“ in der Windows-Sicherheitswarnung) wird genannt, denn sie gewinnt gegen jede Erlaubnis.
- `status`, `doctor`, `start` (im Konsolenfenster) und `lan-info` melden, ob die Regel passt; `start`, `lan-configure` und `lan-info` bieten im Konsolenfenster an, sie anzulegen bzw. nach dem Ausschalten zu entfernen (ADR-0048: nur dort, nie mit `-Json`, `-Quiet` oder `-Hidden`).
- **Tests ändern die Firewall nie:** Eine Testkopie (`BYL_TEST_ISOLATED=1`) fragt nie nach Rechten; `lan-firewall` schreibt die Anfrage in `BYL_TEST_FIREWALL_FILE` des Tests und verweigert ohne die Datei (`lan-firewall-test`). Netzwerk und Firewall einer Testkopie kommen aus `BYL_TEST_NETWORK_FILE`.

### 2.6 Netzwerkprofil

- Die Regel gilt nur in privaten Netzwerken. Ist das Netzwerk einer gewählten Adresse „Öffentlich“ (oder „Domäne“), warnen `status` (gelb), `doctor` (Eintrag `lan-profile` mit Klickweg und `Set-NetConnectionProfile`) und die Seite deutlich. Das Skript stuft das Netzwerk nicht selbst um: Ob ein Netz vertrauenswürdig ist, entscheidet der Mensch.
- Eine gewählte Adresse, die gerade kein Adapter hat, heißt `lan-address-missing` (wahrscheinlich hat die FRITZ!Box eine andere vergeben).

### 2.7 Sicherheit

- **Nur von diesem Rechner** bleiben System, Sicherung, Speicher, Sicherheit (auch Heimnetz und Firewall), seit E7-1 Konten ([ADR-0056](../adr/0056-konten-und-verwalter.md); auch für den Verwalter der App), „Ansehen“ beobachteter Dateien, Präsenz und Hinweis (Art „control“ und Landing-Seite) und die Admin-Oberfläche. Die Prüfungen nehmen die echte Adresse der Verbindung: `check` in `lib/system-service.js` verlangt `e.remoteIP()` **und** `e.realIP()` auf Loopback und keine Proxy-Kopfzeile, Präsenz und Hinweis `e.remoteIP()`. PocketBase 0.40.4: `RemoteIP()` liest `Request.RemoteAddr`, `RealIP()` liest Kopfzeilen nur aus `settings.trustedProxy.headers` (leer, ADR-0055 §6) und fällt sonst auf `RemoteIP()` zurück; `superuserIPs` prüft `RealIP()`. Eine gefälschte `X-Forwarded-For: 127.0.0.1` hilft einem Gerät im Heimnetz also nicht (Tests).
- **Rate-Limiter:** PocketBase zählt je `RealIP()`. Bisher war alles 127.0.0.1; jetzt zählt jedes Gerät im Heimnetz für sich, der Rechner der App weiter als 127.0.0.1.
- **Tabs anderer Geräte:** `onRealtimeConnectRequest` merkt sich an jeder Realtime-Verbindung, ob sie von diesem Rechner kommt (`byl.local`). `GET /api/byl/presence` zählt und `POST /api/byl/attention` benachrichtigt nur solche Tabs. Sonst hätte ein offener Tab auf dem Handy `start.bat` daran gehindert, die App auf dem Rechner zu öffnen, und den Hinweis „erneut geöffnet“ bekommen.
- **Anmeldung** normaler Konten geht aus dem Heimnetz wie vorher; Selbstregistrierung bleibt gesperrt.

### 2.8 Anzeige

- Seite „Sicherheit“: Abschnitt „Zugriff im Heimnetz“ mit Warnung „Unverschlüsselt im Heimnetz“, „Adresse für andere Geräte“ als Code-Block mit „Kopieren“ (solange der Server darunter antwortet), Schalter und Adressen, „Neustart nötig“ mit Link auf „System“, Firewall-Regel mit „Firewall-Regel anlegen …“ bzw. „entfernen …“ und den Befehlen von Hand, Warnungen zu Netzwerkprofil, Adresse und Sperrregel, „Feste Adresse in der FRITZ!Box reservieren“. Im Überblick der Punkt „Zugriff im Heimnetz“ (Aus bzw. „An (unverschlüsselt)“).
- Seite „System“: Zeile „Im Heimnetz“ mit der Adresse. `status.bat`: Zeilen „Heimnetz“, „Firewall“ und „Netzwerk“.
- **Kein QR-Code:** Ohne neue Abhängigkeit hieße das ein eigener QR-Kodierer (Reed-Solomon, Masken, Versionen), der nur mit einem Decoder als weiterer Abhängigkeit sinnvoll prüfbar wäre; eine kleine Bibliothek wäre eine Änderung des Tech-Stacks (CLAUDE.md §3) und braucht eine Freigabe. Die Adresse ist kurz und mit „Kopieren“ teilbar. Offener Punkt für eine spätere Entscheidung.

### 2.9 Grenzen

- HTTP ist kein sicherer Kontext: Auf dem anderen Gerät lässt sich die App nicht installieren, und das Kopieren in die Zwischenablage kann scheitern (der Code-Block markiert den Text dann für Strg+C).
- Beim ersten Start auf `0.0.0.0` kann Windows die Sicherheitswarnung für `pocketbase.exe` zeigen; dort nur „Private Netzwerke“ anhaken. „Abbrechen“ legt eine Sperrregel an (siehe 2.5).
- Wechselt die IP-Adresse, antwortet die App unter der alten nicht mehr (Host-Allowlist); dagegen hilft die Reservierung in der FRITZ!Box oder der Name `…fritz.box`.

## 3. Tests

- Unit: `lan-control-logic.test.mjs` (Windows: Adressen, `byl-config.json`, Start-Argumente und Origins, Fingerabdruck, eigene Instanz auf 0.0.0.0, Erkennung, Netzwerkprofil, Zustand und Skript der Firewall, Befehl von Hand), `lan-rules.test.mjs`, `web-lan.test.mjs` (Gleichstand), `start-scripts.test.mjs` (eine Stelle mit UAC, Wächter für Testkopien, nichts ändert das Netzwerkprofil), `script-problems.test.mjs`, `system-rules.test.mjs`, `start-logic.test.mjs`, `control-logic.test.mjs`; in `web/` `domain/lan.test.ts`, `security-lan.test.ts`, `security-view.test.ts`, `domain/security.test.ts`, `system-view.test.ts`, `domain/system.test.ts`.
- Integration: `lan-access.test.mjs` simuliert ein Gerät im Heimnetz über die Adresse der Verbindung (Test-Hook `tests/fixtures/pb_hooks/remote-address.pb.js`, nur in Instanzen des Harness): Host erlaubt bzw. abgewiesen, nur-lokale Routen und Verwaltung abgelehnt (auch mit gefälschten Proxy-Kopfzeilen), Anmeldung, Rate-Limit je Gerät, Präsenz und Hinweis nur für Tabs dieses Rechners. Dieselben Fälle mit einer echten Verbindung an `0.0.0.0` über eine private Adresse des Rechners laufen **nur in der CI**: Auf einem Entwicklungsrechner zeigte Windows für `0.0.0.0` seine Firewall-Warnung, und ein „Abbrechen“ dort änderte die Firewall. `lan-control.test.mjs` (Windows) fährt `lan-info`, `lan-configure`, `lan-firewall`, `status` und `doctor` gegen eine Wegwerf-Kopie mit Netzwerk und Firewall aus Dateien des Tests; in der CI startet die Kopie zusätzlich auf `0.0.0.0`.
- Manuell (Test-Manifest): Zugriff vom Handy bzw. zweiten Rechner, Firewall-Regel per UAC, Warnung bei „Öffentlich“, nur-lokale Seiten vom anderen Gerät, Ausschalten entfernt die Regel, `start.bat`/Landing-Seite/Erweiterung unverändert, feste Adresse in der FRITZ!Box.

## 4. Schritt für Schritt (Nutzer)

1. Netzwerk des PCs in Windows als „Privat“ einstufen (nur im eigenen Heimnetz).
2. Einstellungen → Sicherheit → Zugriff im Heimnetz einschalten, Adresse wählen, „Einstellung speichern“.
3. „Firewall-Regel anlegen …“ und die Frage von Windows bestätigen.
4. Einstellungen → System → „Jetzt neu starten“ (oder `neu-starten.bat`); bei der Windows-Sicherheitswarnung nur „Private Netzwerke“.
5. Auf dem Handy die „Adresse für andere Geräte“ öffnen und mit dem eigenen Konto anmelden.
6. In der FRITZ!Box die Adresse des PCs fest reservieren.

## 5. Neustart

Hooks und Steuerskript wirken erst nach einem Neustart der App (`neu-starten.bat`). Ein- und Ausschalten des Zugriffs braucht jedes Mal einen Neustart (Teil `lan` des Fingerabdrucks); `status.bat` und die Seite „System“ sagen es.

## 6. Offene Punkte

- QR-Code fürs Handy (2.8): nur mit Freigabe einer kleinen Bibliothek.
- HTTPS im Heimnetz kommt mit S3 (Raspberry Pi, Traefik); dann wird dieser Zugang ersetzt oder auf HTTPS umgestellt.
