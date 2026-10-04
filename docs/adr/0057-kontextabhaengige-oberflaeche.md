# ADR-0057: Kontextabhängige Oberfläche – der Server sagt, wer von wo fragt; die Oberfläche zeigt Befehle, Skripte und die Seiten des Verwalters nur dort, wo sie funktionieren

- **Status:** Angenommen und umgesetzt (KOB-1)
- **Datum:** 2026-10-04
- **Entscheidung durch:** Nutzer (Ziel: Die zweite Person nutzt die App mit eigenem Konto am Handy über `http://192.168.178.66:8090` oder im zweiten Browserprofil am Server-PC und sieht nirgends Skript-Funktionen, `.bat`-Anleitungen oder kopierbare Befehle; auch der Verwalter sieht am Handy keine Aktionen, die dort nicht funktionieren), Advisor (Matrix, Sicherheitsanforderung, Umfang), Executor (Audit, Route, Store, Einzelheiten)
- **Bezug:** [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) (Hinweis-Bausteine), [ADR-0028](0028-plattform-strategie.md) (System des Servers), [ADR-0038](0038-eigener-eingang-und-whatsapp-web.md) §4 (Ordner der Erweiterung), [ADR-0043](0043-system-seite.md) §3 (Prüfungen `check`), [ADR-0048](0048-fehlerkatalog-der-skripte.md) (Befehle zum Kopieren), [ADR-0055](0055-sicherheits-haertung.md) (Nachtrag dort), [ADR-0056](0056-konten-und-verwalter.md) (Nachtrag dort)
- **Paket:** KOB-1 „Kontextabhängige Oberfläche“. Der Auftrag nannte es KX-1; diese Kennung gehört im Test-Manifest schon zu „Tickets im Kontext“ ([ADR-0054](0054-tickets-im-kontext-oeffnen.md)), und Paket-IDs sind dort eindeutig.

## Kontext

Seit E7-1 gibt es mehrere Konten und das Recht „Verwalter der App“, seit HN-1 den Zugriff aus dem Heimnetz. Die Routen, die etwas am Server-PC tun, prüfen das richtig (`check` in `lib/system-service.js`: Windows, dieser Rechner, Adresse der App, Verwalter). Die Oberfläche wusste aber nur, ob das Konto Verwalter ist (`auth.isAdmin` aus dem Datensatz), nicht, von wo es fragt. Folgen:

- Der Verwalter am Handy sah die Seiten System, Sicherung, Speicher, Sicherheit und Konten mit Ablehnungen „Nur auf dem Rechner der App“, dazu `setx`-Anleitungen, `neu-starten.bat`, „Ansehen“ von Dateien und den Link auf die Verwaltung `/_/`, die dort alle nicht gehen.
- Ein anderes Konto sah in Hilfe, Assistenten, Karten und Fehlermeldungen `.bat`-Dateien, PowerShell- und `setx`-Befehle, Befehle zum Kopieren aus dem Fehlerkatalog und Pfade des Servers (Ordner der Browser-Erweiterung).

## Entscheidung

### 1. Der Server ist maßgeblich

Jede Route entscheidet weiter selbst (`check`, Ablehnungen `platform` 404, `loopback` 403, `owner` 403 für fehlendes Verwalter-Recht; der Name `owner` bleibt nach ADR-0056 §1). Die Oberfläche lässt nur weg, was eine Route ablehnen würde, und fragt solche Routen dann gar nicht erst. Kommt trotzdem eine Ablehnung `loopback`, `owner` oder `platform`, zeigt die Seite ihren freundlichen Hinweis wie bisher und lädt den Kontext neu (`reportRefusal` in `lib/data/context.ts`).

### 2. Route `GET /api/byl/context`

`app/pb_hooks/context.pb.js`, Logik `context` in `lib/system-service.js`, reine Antwort `contextView` in `lib/context-rules.js`. Nur angemeldete App-Konten (`$apis.requireAuth('users')`, sonst 401), `Cache-Control: no-store`, kein Log, keine Änderung.

```json
{ "admin": true, "local": false, "platform": "windows", "scripts": false, "localUrl": "http://127.0.0.1:8090" }
```

- `admin`: aktiver Verwalter (`isInstanceAdmin`, dieselbe Prüfung wie `check`).
- `local`: dieselbe Funktion wie der Guard jeder Route, die am PC arbeitet (`isLocalRequest`, aus `check` herausgelöst): `e.remoteIP()` und `e.realIP()` auf Loopback und keine Proxy-Kopfzeile. Nie `X-Forwarded-For`, nie der `Host`; `trustedProxy` bleibt leer. Die eigene Adresse des Server-PCs im Heimnetz (etwa `192.168.178.66`) zählt bewusst als **anderes Gerät**, genau wie im Guard: Wer am PC über diese Adresse öffnet, bekommt die Sicht des Handys.
- `platform`: die Werte der Route `/api/byl/host` (`windows`, `linux`, `container`), keine eigene Erkennung.
- `scripts` = `admin && local && platform === "windows"`.
- `localUrl`: die Adresse der App an ihrem PC mit dem Port aus `--http`, **nur für den Verwalter**; jedes andere Konto bekommt `null`, also keine Adresse und keinen Pfad des Servers.

### 3. Store und Domain in der Oberfläche

- `lib/domain/context.ts` (rein): `parseContext`, `capabilitiesOf(state)` mit `mode` (`pc`, `remote`, `member`, `pending`, `outdated`), `adminPages` (`full`, `pc-only`, `hidden`), `pc`, `scripts`, `platform`, `localUrl`; `contextNote(capabilities, need)` für Befehle (`need` `pc`: nur am PC, etwa `setx`, Explorer, Shell-Beispiele, Ordner der Erweiterung; `script`: dazu die Skripte des Ordners `app` unter Windows) und `withoutCommands(text)` für Texte des Servers.
- `lib/stores/context.svelte.ts`: ein Store je Tab (`appContext`, wie die Sitzung). Das `(app)`-Layout und die Notfallkarte starten ihn mit `fetchContext` und dem Auth-Store des SDK. Er lädt nach der Anmeldung und nach jedem Refresh der Sitzung, beginnt für ein anderes Konto von vorn, geht beim Abmelden und beim Verlassen des Layouts in die restriktivste Sicht zurück und behält bei einem gescheiterten Abruf, was er hatte.
- **Solange der Kontext lädt oder fehlt, gilt die restriktivste Sicht:** keine Seite des Verwalters in der Navigation, kein Befehl, kein „Ansehen“; Seiten des Verwalters per Adresse zeigen nur „Wird geladen …“. So blitzt nichts auf. Kennt der Server die Route noch nicht (404 vor dem Neustart nach einem Update), heißt der Zustand `outdated`: wie oben, aber mit „Nach dem nächsten Neustart verfügbar.“.
- Texte außerhalb von Komponenten (Fehler „Server nicht erreichbar“, Hinweis nach einem Update, „becauseyoulovejira wurde beendet.“) lesen dieselben Fähigkeiten über `currentCapabilities()` aus `lib/data/context.ts`; in einer Vorlage folgen sie dem Store.

### 4. Matrix

| Kontext | Seiten des Verwalters | Befehle, `.bat`, Skripte | „Ansehen“ von Dateien |
|---|---|---|---|
| Verwalter am PC, Windows | wie bisher | wie bisher | wie bisher |
| Verwalter auf einem anderen Gerät | in der Navigation mit „nur am PC“; die Seite zeigt statt Daten und Aktionen „Nur direkt am PC verfügbar, auf dem becauseyoulovejira läuft (dort über http://127.0.0.1:<Port> öffnen).“ und fragt den Server nicht | überall derselbe Hinweis; kein Link auf `/_/` | ausgeblendet |
| Anderes Konto (am PC oder im Heimnetz) | nicht in der Navigation; per Adresse „Nur für den Verwalter“ | nirgends, auch nicht in Hilfe, Assistenten, Karten und Fehlermeldungen; stattdessen „Bitte den Verwalter fragen.“; Hilfe „Betrieb“ und „Sicherung & Notfall“ nur „Betrieb und Sicherung übernimmt der Verwalter.“ | ausgeblendet |
| Verwalter am PC, Server nicht Windows | wie bisher (System und Sicherung fehlen wie vorher) | Skripte: „Auf diesem Server nicht verfügbar.“; `setx`-Anleitungen mit dem bestehenden Hinweis zum System des Servers (keine eigene Linux-Anleitung) | wie bisher |

- **Bausteine:** `PcOnly` (`components/guidance/`, Inhalt oder derselbe Hinweis; `inline`, `quiet`, eigener Text für andere Konten) und `AdminPageNotice` (statt einer Seite des Verwalters, im Layout der Einstellungen und auf der Notfallkarte; die Seite selbst wird nie gerendert). Texte in `CONTEXT_TEXTS` und `pcOnlyText` (`lib/guidance/texts.ts`).
- **Stellen:** Navigation und Layout der Einstellungen, Notfallkarte, Hinweise beim Öffnen (Sicherung, Fehlversuche: nur `adminPages === 'full'`), Hilfe (Zugangsdaten, Beispiele des eigenen Eingangs, Notion, GitHub, Ordner, häufige Fragen, Betrieb, Sicherung & Notfall, Sicherheit), Einrichtungsassistenten (Schritte „Variable“/„Token“ und „Neustart“, Chat-ID-Befehl, Texte des Servers), WhatsApp Web („Erweiterung laden“), Kanal-Karten (Hinweis, Hilfsprozess, letzter Fehler über `textForContext`), Konto (Admin-Konto, `/_/`), Darstellung (`start.bat`), Hinweis zum System des Servers, „Ansehen“ in Eingang und Quellen, Fehler „Server nicht erreichbar“ (Daten, Anmeldung, Sitzungsprüfung), Hinweis nach einem Update, Flag „beendet“.
- **Sätze, die beim Laden eines Moduls entstehen** (`restartNeeded(…)` als Konstante der Stores, etwa „Der Eingang ist nach dem nächsten Neustart verfügbar. …“), kennen den Kontext noch nicht und nennen deshalb nie ein Skript, auch nicht dem Verwalter am PC. Die Hinweise mit Titel („Nach dem nächsten Neustart verfügbar“) folgen dem Kontext und nennen ihm `neu-starten.bat` wie bisher.

### 5. Ergebnis des Audits der Routen

Geprüft wurde jede `/api/byl/*`-Route, die am Server-PC etwas auslöst, verändert oder Daten des Verwalters liefert. Anforderung: Was am PC auslöst oder verändert, verlangt **dieser Rechner und Verwalter**, denn die zweite Person im zweiten Browserprofil kommt über Loopback, ist aber keine Verwalterin.

| Routen | Dieser Rechner | Verwalter | Plattform | Ergebnis |
|---|---|---|---|---|
| System: `GET /api/byl/system`, `…/doctor`, `…/logs`, `POST …/actions/{action}` | ja (`check`) | ja (`owner`) | Windows | unverändert |
| Sicherung: `GET /api/byl/backup`, `…/notice`, `…/restore`, `POST …/run`, `…/verify`, `…/restore`, `…/settings`, `…/passphrase` | ja | ja | Windows | unverändert |
| Speicher: `GET /api/byl/storage`, `POST …/actions/{action}` | ja | ja | jede | unverändert |
| Sicherheit: `GET /api/byl/security`, `…/notice`, `POST …/settings` | ja | ja | jede | unverändert |
| Sicherheit: `POST /api/byl/security/hosts`, `GET`/`POST …/lan`, `POST …/lan/firewall` | ja | ja | Windows | unverändert |
| Konten: `GET`/`POST /api/byl/accounts`, `POST …/{id}/password`, `…/disabled`, `…/admin` | ja | ja | jede | unverändert |
| „Ansehen“: `GET /api/byl/folders/items/{id}`, `…/file` | ja | ja | jede | unverändert |
| `GET /api/byl/whatsapp-web/extension` (Pfad des Ordners der Erweiterung) | nein | nein | jede | **Lücke geschlossen:** der Pfad nur noch für den Verwalter an diesem Rechner, sonst `""` |
| Präsenz und Hinweis: `GET /api/byl/presence`, `POST /api/byl/attention`, `GET …/{nonce}` | ja (`e.remoteIP()`) | nein, bewusst | jede | unverändert: Schnittstelle für Skripte und Startseite ohne Konto (ADR-0055 §5), lösen nur einen Hinweis in Tabs aus |
| `POST /api/byl/attention/{nonce}/ack` | nein | nur ein Konto, dessen Tabs die Nachricht bekamen | jede | unverändert |
| Kanäle mit `BYL_*` oder Ordnern: `…/connections/{id}/run`, `…/secret-status`, `…/mailbox`, `…/mailbox/import`, `…/scan`, `/api/byl/mail-helper`, `…/folders`, `…/folders/existing`, `…/folders/adopt`, `…/github`, `…/github/check`, `…/github/repos`, `…/notion/*` | nein | über den Besitz: nur der Verwalter legt solche Verbindungen an oder ändert sie (ADR-0056 §5); ausführen darf, wer die Verbindung sieht | jede | unverändert, bewusst: Sie bedienen nicht den PC, sondern tun auf Knopfdruck, was Cron bzw. Mail-Helfer ohnehin tun; „nur dieser Rechner“ nähme dem Verwalter „Jetzt abrufen“ am Handy. Wer in einem Haushalt was darf, entscheidet E7-4. |

Belegt mit `tests/integration/context-route.test.mjs`: jede Route der Tabelle bis „Ansehen“ lehnt ein anderes Konto an diesem Rechner mit `owner` ab und jedes Gerät im Heimnetz, auch den Verwalter, mit `loopback` (Routen nur für Windows auf anderen Servern zuerst mit `platform`); der Verwalter an diesem Rechner kommt durch beide Prüfungen.

## Alternativen

| Alternative | Bewertung |
|---|---|
| `local` aus `location.hostname` der Oberfläche | Fälschbar und falsch: die zweite Person im zweiten Profil am PC hat dieselbe Adresse wie der Verwalter. Nur der Server kennt die Verbindung. |
| `X-Forwarded-For` oder `Host` für „lokal“ | Fälschbar; widerspricht ADR-0055 (Nachtrag HN-1). |
| Eigene LAN-Adresse des PCs als lokal zählen | Wäre eine zweite Regel neben dem Guard; die Route sagte „lokal“, die Seiten lehnten trotzdem ab. Bewusst eine Quelle der Wahrheit. |
| Kontext im `localStorage` merken, um beim Start schneller zu sein | Ein gemerkter Wert ist kein geladener; im geteilten Profil oder nach einem Wechsel des Rechts falsch. Die restriktivste Sicht bis zur Antwort kostet nur einen Augenblick. |
| Rohe Ablehnung der Route anzeigen | Rote Fehler für etwas, das kein Fehler ist; die Seiten fragen gar nicht erst. |
| Ablehnungscode `owner` in `admin` umbenennen | Bruch für SPA und Tests (ADR-0056 §1); die Codes sind auch so unterscheidbar. |
| Kanal-Routen ebenfalls nur an diesem Rechner | Nähme dem Verwalter das Abrufen seiner Kanäle am Handy, ohne Gewinn an Sicherheit (der Cron ruft ohnehin ab). |

## Konsequenzen

- Positiv: Die zweite Person sieht nirgends Befehle, Skripte, Pfade des Servers oder Seiten des Verwalters; der Verwalter am Handy keine Aktion, die dort nicht geht, und weiß, wo sie geht. Am PC bleibt alles wie bisher.
- Positiv: Keine Anfrage mehr, die absehbar 403 liefert (Seiten, Notfallkarte, Hinweise beim Öffnen, „Ansehen“).
- Negativ: Vor dem Neustart nach diesem Update kennt der Server die Route nicht: Bis dahin fehlen auch dem Verwalter die Seiten des Verwalters in der Navigation (per Adresse „Nach dem nächsten Neustart verfügbar“), und Befehle stehen nicht da. Neu starten mit `neu-starten.bat`.
- Negativ: Die einsätzigen Neustart-Hinweise der Stores nennen dem Verwalter kein Skript mehr (§4).
- Neu: Hooks (`context.pb.js`, Änderungen in `system-service.js` und `extension.pb.js`) wirken nach einem Neustart; keine Migration.
- **Tests:** `tests/unit/context-rules.test.mjs`, `tests/integration/context-route.test.mjs` (Kontext an diesem Rechner und im Heimnetz, mit und ohne Verwalter, gefälschte Proxy-Kopfzeilen, 401, Linux, Audit aller Routen, Pfad der Erweiterung); in `web/` `domain/context.test.ts`, `stores/context-store.test.ts`, `components/guidance/pc-only.test.ts` und die Tests von Layout der Einstellungen, `(app)`-Layout, Hilfe, Konto, Notfallkarte, Kanal-Karten, Telegram- und WhatsApp-Assistent, Eingang und Quellen, Fehlern und Texten.
- **Nur im Browser prüfbar** (Test-Manifest, manuell): Verwalter am PC, Verwalter am Handy, zweites Konto im zweiten Browserprofil am PC und am Handy, Hilfe in diesen Kontexten, Aufruf einer Adresse des Verwalters als zweites Konto.
