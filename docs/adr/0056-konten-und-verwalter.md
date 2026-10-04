# ADR-0056: Konten und Verwalter (E7-1) – ausdrückliches Recht „Verwalter der App“, Konten in der App anlegen, Passwort und Name selbst ändern, Namen im Haushalt sichtbar, Kanäle mit Zugangsdaten nur für den Verwalter

- **Status:** Angenommen und umgesetzt (E7-1, [Plan E7 „Haushalt“](../plan/e7-haushalt.md)); Nachtrag KOB-1: Navigation und Hinweise nach dem Kontext des Tabs ([ADR-0057](0057-kontextabhaengige-oberflaeche.md))
- **Datum:** 2026-10-04
- **Entscheidung durch:** Nutzer (Start von E7 ohne Mehrgeräte, Haushaltsrollen mit Gründer, ausdrückliches Recht „Verwalter der App“ statt „erstes Konto = Besitzer“, Kanäle mit Zugangsdaten und Ordner nur für den Verwalter, persönliche Einstellungen später; 2026-10-04), Advisor (Inventur, Umfang des Pakets), Executor (Datenmodell, Regeln, Routen, Oberfläche, Einzelheiten)
- **Ersetzt:** die Regel „Besitzer der Instanz = das zuerst angelegte App-Konto“ aus [ADR-0043](0043-system-seite.md) §3 (Nachtrag dort)
- **Bezug:** [ADR-0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md) §4, [ADR-0002](0002-erststart-und-superuser.md) (Konten nur über die Verwaltung; Nachtrag dort), [ADR-0011](0011-roadmap-e3-bis-e7.md) (E7; Nachtrag dort), [ADR-0015](0015-neu-markierung-pro-nutzer.md), [ADR-0018](0018-secrets.md), [ADR-0035](0035-start-einstieg-und-offene-tabs.md) §4, [ADR-0051](0051-ordner-kanal-verweise-statt-kopien.md) §6, [ADR-0055](0055-sicherheits-haertung.md) (Nachtrag dort)

## Kontext

Bis E6 gab es genau eine Person. Wer die App bedienen durfte (Seiten System, Sicherung, Speicher, Sicherheit, „Ansehen“ von Ordner-Dateien), entschied `ownerId` in `lib/system-service.js`: das zuerst angelegte App-Konto. Konten legte nur der Superuser in der Verwaltung `/_/` an (ADR-0002), Passwörter ließen sich in der App nicht ändern, `users` war nur für den eigenen Datensatz lesbar, und Personen hießen in Kommentaren und Verlauf „Du“, „System“ oder „Anderes Konto“.

Der Nutzer startet E7 jetzt, ohne den Mehrgeräte-Ausbau abzuwarten: Eine zweite Person testet zunächst am selben Rechner mit eigenem Browserprofil, ein Zugang im Heimnetz kommt in einem eigenen Paket. Die Inventur zeigte dafür drei Lücken:

- Jedes Konto kann in einer Verbindung den Namen einer beliebigen `BYL_*`-Variablen des Servers nennen (`connection-rules.js` prüft nur das Format) und so die Zugangsdaten des Verwalters nutzen; ebenso beliebige Ordner des Rechners beobachten (`folder-rules.js`).
- Präsenz und Hinweis (ADR-0035 §4) kennen kein Konto: Jedes angemeldete Konto bestätigt jede Nachricht.
- Die Navigation zeigt allen Konten die Seiten des Besitzers, die dann nur „Nur für das erste Konto“ sagen.

## Entscheidung

### 1. Das Recht „Verwalter der App“

- **Feld `users.instance_admin`** (bool, Migration `1790203700_accounts_admin.js`). Es ersetzt „das zuerst angelegte Konto“ an der einzigen Stelle der Prüfung: `check` in `lib/system-service.js` fragt `isInstanceAdmin` aus `lib/account-service.js` (Recht gesetzt und Konto nicht deaktiviert). Der Grund einer Ablehnung heißt weiter `owner` (die SPA und ihre Tests kennen ihn), der Text „Nur für den Verwalter der App.“.
- **Migration:** setzt das Recht für das Konto, das bisher Besitzer war (kleinstes `created`, bei Gleichstand kleinste ID, die Regel von `ownerId`), per SQL, also ohne Hooks und ohne neues `updated`. Ohne Konto setzt sie nichts.
- **Erstes Konto einer neuen Installation:** Gibt es kein aktives Konto mit dem Recht, bekommt es das neue Konto (`onRecordCreate`, jeder Weg: Verwaltung, Seite „Konten“). So bleibt der Erststart nach ADR-0002 unverändert: Wer einrichtet, legt sein Konto zuerst an und ist Verwalter.
- **Wer ändert es:** nur ein Verwalter über die Seite „Konten“ (§3) und der Superuser in der Verwaltung (Notweg, wie `admin-zuruecksetzen.bat`). Über die Record-API ändert kein App-Konto `instance_admin`, `disabled` oder `emailVisibility`, auch nicht am eigenen Datensatz (`validation_account_locked`).
- **Immer ein Verwalter:** Kein Weg nimmt dem letzten aktiven Verwalter das Recht, deaktiviert ihn oder löscht ihn, solange es andere Konten gibt (`onRecordUpdate`/`onRecordDelete`, auch für den Superuser; `validation_account_last_admin`). Die Seite verbietet zusätzlich, sich selbst das Recht zu entziehen oder sich zu deaktivieren.
- **Vor dem Neustart** (neue Hooks, altes Schema) gilt weiter das zuerst angelegte Konto.

### 2. Deaktivieren und Anmelden

- **Feld `users.disabled`** (bool). `onRecordAuthRequest` lehnt die Anmeldung eines deaktivierten Kontos mit 403 „Dieses Konto ist deaktiviert. Bitte wende dich an den Verwalter der App.“ ab. Der Hook läuft erst nach dem richtigen Passwort, verrät also niemandem, der rät, ob es das Konto gibt; der Versuch landet im Protokoll der Fehlversuche (ADR-0055 §8). Die Anmeldeseite zeigt den Text bei 403.
- **Sitzungen enden sofort:** Deaktivieren erneuert den `tokenKey` des Kontos (`refreshTokenKey`), ein neues Passwort tut es in PocketBase selbst (`SetPassword`: „the tokenKey will be auto changed“). Alte Tokens gelten nicht mehr, und PocketBase nimmt dem Konto auch die offene Realtime-Verbindung (`realtimeUpdateClientsAuth` bei anderem `tokenKey`).
- **Eigenes Passwort in einem Tab:** Nach „Passwort ändern“ meldet die SPA sich mit dem neuen Passwort neu an; bekommt ein Tab ein neues Token desselben Kontos, sendet er seine Realtime-Abos einmal mit dem neuen Token (`Auth.#rebindRealtime`), sonst bekäme er keine Ereignisse mehr.

### 3. Seiten „Konten“ und „Konto“

- **„Einstellungen → Konten“** (`/einstellungen/konten`, nach „Konto“), nur für den Verwalter. Routen in `accounts.pb.js` mit `lib/account-service.js` und den reinen Regeln `lib/account-rules.js`; jede prüft wie die Seite „Speicher“ über `check` (angemeldet, dieser Rechner, Host und `Origin`, Verwalter, Rate-Limit je Konto, `local`, `anyPlatform`):
  - `GET /api/byl/accounts`: alle Konten mit Name, E-Mail, Recht, Schalter, `created`, `self`, dazu `passwordMin` (8, das Feld `password` von PocketBase).
  - `POST /api/byl/accounts` `{ email, name }`: neues Konto mit erzeugtem Startpasswort, das die Antwort einmal nennt (`Cache-Control: no-store`). Adresse ohne Groß-/Kleinschreibung eindeutig, Name 1–100 Zeichen ohne Steuerzeichen.
  - `POST /api/byl/accounts/{id}/password`: neues Passwort, einmal angezeigt; die Sitzungen des Kontos enden.
  - `POST /api/byl/accounts/{id}/disabled` `{ disabled }`, `POST /api/byl/accounts/{id}/admin` `{ admin }`.
  - Ablehnungen der Eingabe mit `reason: "invalid"` und `problem` (`email`, `email-taken`, `name`, `name-long`, `format`, `self-disable`, `self-admin`, `self-password`, `missing` 404, `last-admin` 409), vor der Migration 503 `missing`. Änderungen eines Kontos in einer Transaktion, in der auch die Hooks die Verwalter zählen.
  - **Audit:** „byl-accounts: Aktion ausgeführt“ (Aktion, Konto, betroffenes Konto), „… Anfrage abgelehnt“, „… Eingabe abgelehnt“; nie E-Mail-Adressen oder Passwörter.
- **Startpasswörter:** 4 Gruppen zu 4 Zeichen aus 56 Zeichen ohne Verwechslungsgefahr (`abcd-EFGH-2345-wxyz`, etwa 93 Bit), erzeugt mit `$security.randomStringWithAlphabet`. Die Seite zeigt es einmal als Code-Block mit „Kopieren“, bis „Weitergegeben“ es entfernt; es landet nie in einem Flag, der Adresse oder einem Speicher.
- **Oberfläche:** Liste statt Tabelle (wenige Konten), je Konto ein Menü „•••“ mit „Passwort zurücksetzen …“, „Deaktivieren …“ bzw. „Aktivieren“ und „Zum Verwalter machen …“ bzw. „Verwalter-Recht entziehen …“; was Sitzungen beendet oder das Recht ändert, fragt per Bestätigung (kein Rot), „Aktivieren“ läuft sofort. Das eigene Konto hat kein Menü. Darunter das Formular „Konto anlegen“ mit Fehlern am Feld.
- **„Einstellungen → Konto“** für jedes Konto: Anzeigename (Record-API, der Hook prüft und kürzt) und „Passwort ändern“ (bisheriges Passwort, neues zweimal, mindestens 8 Zeichen; PocketBase prüft das alte mit `oldPassword`). Der Hinweis „Konten verwalten“ führt den Verwalter zu „Konten“ und zur Verwaltung, alle anderen zum Verwalter.
- **Kein Löschen** von Konten in der App: `owner` ist an allen fachlichen Datensätzen Pflicht, Kommentare und Verlauf verweisen auf das Konto. Was mit den Daten eines gelöschten Kontos geschehen soll, ist eine Produktentscheidung (Folgepunkt im Plan). Bis dahin deaktiviert der Verwalter; löschen kann nur der Superuser in der Verwaltung, und nie den letzten Verwalter.

### 4. Namen sichtbar, E-Mail-Adressen nicht

- **`users` list/view:** `@request.auth.id != "" && (id = @request.auth.id || @request.auth.instance_admin = true || household_members_via_user.household.household_members_via_household.user ?= @request.auth.id)`: der eigene Datensatz, jeder für den Verwalter, und die Konten, mit denen man einen Haushalt teilt. Schreiben bleibt beim eigenen Datensatz.
- **`household_members` list/view:** `@request.auth.id != "" && household.household_members_via_household.user ?= @request.auth.id`: Mitglieder eines Haushalts sehen einander. Schreiben bleibt `null` (E7-2).
- **E-Mail:** PocketBase liefert die Adresse eines anderen Kontos nur mit `emailVisibility` (oder an den Superuser). Kein App-Konto kann sie setzen (§1), die Seite „Konten“ legt Konten ohne sie an, und die Routen der Seite nennen Adressen nur dem Verwalter. Belegt: keine fremde Adresse in Listen, Einzelabrufen und Expansionen (`expand=author`).
- **Anzeige:** `personLabel(userId, selfId, names)` zeigt den Namen eines sichtbaren Kontos statt „Anderes Konto“ (Kommentare, Verlauf, „angepinnt“, Papierkorb „Von“ und „gelöscht von“); ohne sichtbaren Namen bleibt „Anderes Konto“. Die Namen hält der `PeopleStore` des `(app)`-Layouts (einmal geladen, über Realtime nachgeführt, nur `id` und `name`).

### 5. Kanäle mit Zugangsdaten und Ordner nur für den Verwalter

- Anlegen oder Ändern einer Verbindung, die eine Variable des Servers nennt (`secret_env`, bei Telegram auch `settings.allowed_env`) oder Ordner beobachtet, lehnt der Hook für jedes andere App-Konto ab (`validation_connection_admin_only`, vor und nach der Änderung geprüft, also auch Umbenennen); Löschen bleibt erlaubt, der Superuser frei. Heute nennt jede anlegbare Art eine Variable oder ist ein Ordner: Verbindungen richtet also nur der Verwalter ein. Bestehende Verbindungen gehören dem Verwalter.
- **Matrix für andere Konten:**

  | Kanal | Ohne Verwalter-Recht | Grund |
  |---|---|---|
  | Schnellerfassung, Zwischenablage, Bookmarklet | ja | keine Zugangsdaten, nur der Browser |
  | Datei-Importe (`.eml`, `.ics`, WhatsApp-Export, Proton per Datei) | ja | die Datei bringt der Browser |
  | Eigener Eingang (API) | ja, mit eigenem Zugangsschlüssel | `inbox_keys` je Konto (ADR-0038) |
  | WhatsApp Web | ja, mit eigenem Zugangsschlüssel | die Erweiterung nutzt den Schlüssel des Kontos |
  | Google Calendar | nein | geheime Adresse als `BYL_*`-Variable |
  | Telegram | nein | Token und Erlaubnisliste als `BYL_*`-Variablen |
  | Web.de, Gmail | nein | App-Passwort als `BYL_*`-Variable, Mail-Helfer mit `BYL_INGEST_TOKEN` |
  | Notion | nein | Token als `BYL_*`-Variable; ohne Variable geht Notion nicht |
  | GitHub | nein | nennt immer eine Variable (Token optional, der Name Pflicht) |
  | Ordner | nein | Ordner dieses Rechners |

- **Oberfläche:** Für andere Konten zeigt der Katalog auf „Kanäle“ einen Hinweis mit dieser Matrix und nur die Kacheln „Proton Mail“ (Anleitung per Datei) und „WhatsApp Web“; ein Assistent einer anderen Art in der Adresse bleibt zu. Eigene verschlüsselte Zugangsdaten je Konto kommen später (Folgepunkt).

### 6. Präsenz und Hinweis je Konto

- Eine Nachricht auf `byl/attention` merkt sich, welche Konten Tabs mit dem Abo hatten (`presence-rules.serializeEntry`, gespeichert vor dem Senden). Bestätigen (`…/{nonce}/ack`) darf nur ein solches Konto, für jedes andere ist die Nonce unbekannt (404).
- Die Präsenz-Abfrage des Startskripts zählt weiter alle angemeldeten Tabs dieses Rechners, und die Nachricht geht weiter an alle: Das Skript kennt die Person nicht, die es startet. Folge: Hat die zweite Person einen Tab offen, öffnet `start.bat` keinen neuen Tab; die erste nutzt dann ihr Browserprofil oder die Landing-Seite (Folgepunkt im Plan).

### 7. Navigation und Hinweise

- Die Seiten des Verwalters (Konten, Sicherheit, Sicherung, Speicher, System) fehlen für andere Konten in der Navigation (`visibleSettingsSections(platform, admin)`, `ADMIN_ONLY`), statt „Nur für das erste Konto“ zu zeigen. Wer eine Adresse direkt öffnet, sieht die Ablehnung „Nur für den Verwalter der App“.
- Ob ein Konto Verwalter ist, liest die SPA aus seinem Datensatz (`adminOf`, `auth.isAdmin`). Fehlt das Feld (Server vor dem Neustart), bleiben die Seiten wie bisher sichtbar, und der Server entscheidet.
- Die Hinweise beim Öffnen zu Sicherung und Fehlversuchen fragt das `(app)`-Layout nur für den Verwalter (sonst Ablehnungen im Log bei jedem Öffnen).

## Alternativen

| Alternative | Bewertung |
|---|---|
| Weiter „erstes Konto = Besitzer“, nur in der Oberfläche anders | Kein ausdrückliches Recht, nicht übertragbar; vom Nutzer verworfen. |
| Recht nur durch den Superuser setzbar (ADR-0043 §3, ursprüngliche Idee) | Verwaltung in der App wäre unmöglich; der Superuser bleibt Notweg. |
| Startpasswort von der Person des Verwalters eintippen lassen | Schwache, wiederverwendete Passwörter; erzeugt und einmal gezeigt ist sicherer und gleich bequem. |
| Mail mit Einladung oder Rücksetzlink | Kein Mailer (ADR-0002, Mail-Abläufe gesperrt). |
| E-Mail per `onRecordEnrich` verbergen | Auch die Antwort der Anmeldung läuft durch die Anreicherung, dort fehlt noch das Konto der Anfrage; `emailVisibility` plus Sperre ist der Weg von PocketBase. |
| Kanäle für alle, nur `secret_env` je Konto prüfen | Variablen des Servers gehören dem Windows-Konto des Verwalters, ein Präfix je Konto wäre nur eine Konvention; verschlüsselte Zugangsdaten je Konto sind der richtige Weg (später). |
| Präsenz je Konto zählen | Das Skript kennt die Person nicht; vom Nutzer verworfen („zählt weiter alle lokalen Tabs“). |
| Konten löschen mit Übertrag der Daten | Produktentscheidung; Folgepunkt. |

## Konsequenzen

- Positiv: Ein ausdrückliches, übertragbares Recht; Konten, Passwörter und Namen ohne die Verwaltung; keine Zugangsdaten des Verwalters in fremden Verbindungen; Namen statt „Anderes Konto“, Adressen bleiben privat.
- Positiv: Der Erststart bleibt wie in ADR-0002; vor dem Neustart verhält sich alles wie bisher.
- Negativ: Ein Konto ohne Recht kann heute keine Verbindung anlegen, auch keine eigene (bis zu eigenen Zugangsdaten je Konto).
- Negativ: Der Superuser kann den letzten Verwalter in der Verwaltung nicht entfernen; das ist gewollt.
- Neu: Migration, Hooks und Routen wirken nach einem Neustart (`neu-starten.bat`).
- **Tests:** rein `tests/unit/account-rules.test.mjs` (mit Gleichstand zu `domain/accounts.ts`), `connection-rules.test.mjs`, `presence-rules.test.mjs`; gegen Wegwerf-Instanzen `tests/integration/accounts.test.mjs` (Recht, Routen je Ablehnung, Konten anlegen, zurücksetzen, deaktivieren, Recht, eigenes Passwort und Name, Sichtbarkeit und E-Mail-Schutz, Recht je Route des Verwalters, Kanal-Sperren, Datenschicht), `presence-route.test.mjs`, `rules.test.mjs`, `migrations-rollback.test.mjs`, `hooks-before-migration.test.mjs`; in `web/` Konten-Seite, Konto-Seite, Navigation, Katalog, `PeopleStore`, `personLabel`, Hilfe.
- **Nur im Browser prüfbar** (Test-Manifest, manuell): zweites Konto anlegen und mit eigenem Browserprofil anmelden, Passwort weitergeben und ändern, Deaktivieren beendet die Sitzung im anderen Profil, Namen in Kommentaren und Verlauf, Navigation ohne Verwalter-Seiten, Kanäle-Hinweis.

## Nachtrag (2026-10-04, [ADR-0057](0057-kontextabhaengige-oberflaeche.md), KOB-1): Navigation und Hinweise nach dem Kontext des Tabs

- **§7 Navigation:** Ob die Seiten des Verwalters erscheinen, entscheidet nicht mehr der Datensatz (`auth.isAdmin`), sondern der Kontext des Servers (`GET /api/byl/context`, `adminPages`): mit Daten nur für den Verwalter an diesem Rechner, für ihn auf einem anderen Gerät mit „nur am PC“ und dem Hinweis statt der Seite, für jedes andere Konto nicht; per Adresse „Nur für den Verwalter“. Solange der Kontext lädt oder fehlt, auch vor dem Neustart nach diesem Update, fehlen die Seiten für alle (restriktivste Sicht); die Regel „ein Datensatz ohne das Feld zählt als Verwalter“ gilt für die Navigation nicht mehr.
- **§7 Hinweise beim Öffnen:** Sicherung und Fehlversuche fragt das `(app)`-Layout nur noch für den Verwalter an diesem Rechner; sonst wäre jedes Öffnen am Handy eine Ablehnung `loopback` im Log.
- **§5 Kanäle:** Der Katalog für andere Konten bleibt; in WhatsApp Web steht „Erweiterung laden“ (Ordner des Servers) für sie als „Bitte den Verwalter fragen.“, die Route nennt ihnen den Ordner nicht mehr.
- **Ablehnungscode:** bleibt `owner` (§1); die Oberfläche unterscheidet `loopback`, `owner` und `platform` und lädt nach jeder dieser Ablehnungen den Kontext neu.
