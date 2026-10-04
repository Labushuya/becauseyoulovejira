# E7-Plan „Haushalt“

- **Stand:** E7-1 „Konten und Verwalter“ umgesetzt ([ADR-0056](../adr/0056-konten-und-verwalter.md)). E7-2 „Haushalt verwalten“ umgesetzt ([ADR-0058](../adr/0058-haushalt-mitgliedschaft-einladungen-rechte.md)). E7-3 „Bereiche Privat und Haushalt“ umgesetzt ([ADR-0059](../adr/0059-bereiche-privat-und-haushalt.md)). E7-4 bis E7-7 sind Entwurf und beginnen je mit eigener Freigabe. Offen sind die manuellen Prüfungen von E7-1 bis E7-3.
- **Grundlage:**
  - Nutzerentscheidungen vom 2026-10-04: E7 startet jetzt, entkoppelt vom Mehrgeräte-Ausbau (Plattform-Stufen S2/S3, [ADR-0028](../adr/0028-plattform-strategie.md)). Die zweite Person testet zunächst am selben Rechner mit eigenem Browserprofil; ein Zugang im Heimnetz kommt parallel in einem eigenen Paket. Haushaltsrollen: Der Gründer verwaltet und kann Rechte delegieren (E7-2). Ein ausdrückliches Recht „Verwalter der App“ ersetzt „erstes Konto = Besitzer“. Kanäle mit Zugangsdaten (`BYL_*`) und Ordner richtet vorerst nur der Verwalter ein; eigene verschlüsselte Zugangsdaten je Konto kommen später (E7-7). Persönliche Einstellungen je Konto kommen als späteres Zusatzpaket (E7-6).
  - Auftrag zu E7-2 (2026-10-04): Der Nutzer und seine Frau teilen sich einen Haushalt als „Shared Space“. Privat und Haushalt sind isolierte Arbeitsbereiche, umschaltbar wie virtuelle Desktops (E7-3). Man tritt per Code bei und tritt aktiv wieder aus. Rechte lassen sich an Mitglieder weitergeben. Später soll das erweiterbar bleiben (Datenmodell N:M). Mit diesem Auftrag gilt die Nummerierung E7-1 bis E7-7 unten; die frühere Fassung dieses Plans zählte E7-1 bis E7-5 (Zuordnung unter der Tabelle in §1).
  - Inventur des Advisors (Stand `main` vom 2026-10-04, nach SH-2): `ownerId` in `lib/system-service.js`, Seiten nur für den Besitzer, Konten nur über `/_/`, `users` und `household_members` nur eigene Zeilen lesbar, `personLabel` ohne Namen, Präsenz ohne Konto, Kanäle mit beliebigen Variablen und Ordnern.
  - Bisherige Planung: [ADR-0001](../adr/0001-betriebsmodell-lokal-mehrgeraete-spaeter.md) §4, [ADR-0011](../adr/0011-roadmap-e3-bis-e7.md) §1 (beide mit Nachtrag zum Start von E7), [ADR-0015](../adr/0015-neu-markierung-pro-nutzer.md) (Lesestand je Nutzer).
- **Einordnung:** Paketkürzel `E7-1` bis `E7-7`, Manifest ab `BYL-E7-001`. Migration von E7-1: `1790203700_accounts_admin.js`; von E7-2: `1790203800_household_invites.js` (Rechte, Einladungen, Rate-Limit des Beitritts) und `1790203900_household_access_rules.js` (nur Regeln: owner-Zweig nur privat); von E7-3: `1790204100_household_trash_retention.js` (Aufbewahrung des Papierkorbs je Haushalt).

## 1. Pakete

| Paket | Inhalt | Stand | Manifest |
|---|---|---|---|
| E7-1 | Konten und Verwalter: Recht `users.instance_admin` statt „erstes Konto“, Schalter `users.disabled`, Seite „Konten“ (anlegen mit Startpasswort, zurücksetzen, deaktivieren, Recht geben und nehmen), „Konto“ mit Passwort und Anzeigename, Namen im Haushalt sichtbar (E-Mail nie), Präsenz und Hinweis je Konto, Kanäle mit Zugangsdaten und Ordner nur für den Verwalter, Navigation ohne Verwalter-Seiten für andere | umgesetzt | BYL-E7-001 bis BYL-E7-024 |
| E7-2 | Haushalt verwalten: gründen (Gründer mit Rolle `owner`), höchstens ein Haushalt je Konto, Beitritt per Einladungscode (statt, wie im Entwurf, Mitglieder aus den Konten hinzuzufügen), Rechte je Mitglied und Delegieren nur eigener Rechte, Inhaber übertragen, Mitglieder entfernen, aktiv austreten, Schreibzugriffe auf `households` und `household_members` (Collection-API bleibt `null`) nur über eigene Routen, Zugriffsentzug sofort und vollständig (owner-Zweig der Regeln nur noch privat), Seite „Einstellungen → Haushalt“ auf jedem Gerät | umgesetzt | ab BYL-E7-100 |
| E7-3 | Umschalter „Privat \| Haushalt“ für die ganze Oberfläche (nur für Mitglieder, je Gerät und Konto gemerkt, Wechsel ohne Neuladen): Scope-Filter in Listen und Abos (auf dem Server), Anlegen im gewählten Bereich, keine Verweise über Bereichsgrenzen, Verbindungen nur privat, endgültiges Löschen im Haushalt nur mit dem Recht `purge`, Aufbewahrung des Papierkorbs je Haushalt, `@CODE` je Bereich, Deep-Links wechseln den Bereich, Wechsel der Mitgliedschaft ohne Neuladen; „Neu“ je Person und Namen im Verlauf gab es schon (ADR-0015, E7-1) | umgesetzt | BYL-E7-200 bis BYL-E7-215, manuell BYL-E7-220 bis BYL-E7-228 |
| E7-4 | Verschieben zwischen Privat und Haushalt mit Kaskade und Vorschau (ins Private nur mit dem Recht `move_out`), Haushalt auflösen; Verbindungen mit Server-Zugriff bleiben privat (Festlegung in §4) | Entwurf | ab BYL-E7-300 |
| E7-5 | Zuständigkeit: `assignee`, „Mir zugewiesen“, Wiederholungen mit fester oder abwechselnder Zuständigkeit | Entwurf | ab BYL-E7-400 |
| E7-6 | Persönliche Einstellungen je Konto: Farbschema, Akzent, Glas, Spalten, Öffnungsmodus und ähnliches am Konto statt nur im Browser | Entwurf | ab BYL-E7-500 |
| E7-7 | Verschlüsselte Zugangsdaten je Konto statt `BYL_*` für Konten ohne Verwalter-Recht; danach Verbindungen eines Haushalts (wer darf umbenennen, pausieren, Stichwörter ändern) | Entwurf | ab BYL-E7-600 |

Zuordnung zur früheren Fassung: altes E7-2 → E7-2 (Hinzufügen aus den Konten ersetzt durch Einladungscodes, der Umschalter wandert nach E7-3); altes E7-3 „Gemeinsame Daten im Haushalt“ → E7-3 (Anlegen, „Neu“ je Person, Namen im Verlauf) und E7-4 (Verschieben); altes E7-4 „Kanäle im Haushalt und eigene Zugangsdaten je Konto“ → E7-7 (dazu die Festlegung zu Verbindungen für E7-4 in §4); altes E7-5 „Persönliche Einstellungen je Konto“ → E7-6. Neu sind „Haushalt auflösen“ in E7-4 und E7-5 „Zuständigkeit“.

Parallel, nicht Teil von E7: „Zugriff im Heimnetz“ (Netzwerkbindung, Host-Liste, Firewall; eigenes Paket, Plattform-Plan; umgesetzt als HN-1, [Plan](heimnetz.md)).

## 2. E7-1: Konten und Verwalter (umgesetzt)

### 2.1 Datenmodell und Regeln

- Migration `1790203700_accounts_admin.js`: `users.instance_admin` und `users.disabled` (bool); das bisher als Besitzer geltende Konto bekommt das Recht (kleinstes `created`, dann kleinste ID; per SQL, ohne Hooks, `updated` bleibt). Rückweg: Felder weg, Regeln wie vorher. Rollback-Test in `migrations-rollback.test.mjs`.
- Leseregeln: `users` eigener Datensatz, jeder für den Verwalter, Konten aus gemeinsamen Haushalten (`household_members_via_user.household.household_members_via_household.user ?= @request.auth.id`); `household_members` die Zeilen der eigenen Haushalte. Schreiben unverändert.
- Hooks (`users.pb.js`, `lib/account-service.js`, rein `lib/account-rules.js`): erstes Konto wird Verwalter, immer ein aktiver Verwalter (auch gegen den Superuser), Deaktivieren erneuert den `tokenKey`, deaktivierte Konten melden sich nicht an (403 nach dem richtigen Passwort), kein App-Konto ändert `instance_admin`, `disabled`, `emailVisibility`, Anzeigename geprüft und gekürzt.

### 2.2 Routen und Seiten

- `accounts.pb.js`: `GET/POST /api/byl/accounts`, `POST …/{id}/password`, `…/{id}/disabled`, `…/{id}/admin`; Prüfungen wie die Seite „Speicher“ (ADR-0043 §4, `local`, `anyPlatform`), Audit ohne Adressen und Passwörter.
- Alle Prüfungen „erstes Konto“ laufen über `check` → `isInstanceAdmin`: System, Sicherung, Speicher, Sicherheit, „Ansehen“ von Ordner-Dateien, Konten; dazu die Kanal-Sperre in `connection-service.js`. Belegt je Route in `accounts.test.mjs` („the right on every route of an administrator“) und in den bestehenden Tests der Routen.
- SPA: `/einstellungen/konten` (`AccountsView`, `AccountCreateForm`, `AccountsStore`, `data/accounts.ts`, `domain/accounts.ts`), `/einstellungen/konto` (`OwnAccountView`, `OwnAccountStore`), `PeopleStore` und `personLabel` mit Namen, `auth.isAdmin`/`auth.name`, Navigation mit `ADMIN_ONLY`, Katalog der Kanäle mit Hinweis, Anmeldeseite mit „deaktiviert“, Hilfe „Konten und Verwalter“.

### 2.3 Kanal-Matrix

Siehe [ADR-0056](../adr/0056-konten-und-verwalter.md) §5: Ohne Verwalter-Recht gehen Schnellerfassung, Zwischenablage, Bookmarklet, Datei-Importe (auch Proton per Datei), eigener Eingang und WhatsApp Web (je mit eigenem Zugangsschlüssel). Google Calendar, Telegram, Postfächer, Notion, GitHub und Ordner richtet nur der Verwalter ein.

### 2.4 Bewusst nicht in E7-1

- Konten löschen (siehe Folgepunkte).
- Haushalte anlegen oder bearbeiten in der App (E7-2); zum Testen der Namen legt der Superuser einen Haushalt in der Verwaltung an.
- Persönliche Einstellungen je Konto (E7-6).

## 3. E7-2: Haushalt verwalten (umgesetzt)

Einzelheiten und Begründungen in [ADR-0058](../adr/0058-haushalt-mitgliedschaft-einladungen-rechte.md).

### 3.1 Datenmodell, Regeln und Migrationen

- `1790203800_household_invites.js`: `household_members.rights` (Mehrfachauswahl `invite`, `remove`, `delegate`, `rename`, `purge`, `move_out`), neue Collection `household_invites` (Haushalt, SHA-256 des normalisierten Codes `hidden` und eindeutig, erzeugt von, gültig bis, benutzt am und von, widerrufen am; alle API-Regeln `null`) und die Regel `POST /api/byl/household/join` des Rate-Limiters mit den strengen Werten (5 je 300 s) in beiden Stufen.
- `1790203900_household_access_rules.js`: nur Regeln. Der owner-Zweig gilt nur noch für private Datensätze (`owner = @request.auth.id && household = ""`), Haushaltsdatensätze sind nur über die aktuelle Mitgliedschaft erreichbar; gleich für die Sichtbarkeit über das Ticket (`ticket.owner`). Die Routen des Papierkorbs (`lib/trash-service.js`) ziehen mit.
- `households` und `household_members`: Lesen wie seit E7-1 (Mitglieder sehen den eigenen Haushalt und die Mitgliederliste), Schreiben über die Collection-API bleibt `null`.

### 3.2 Routen und Seite

- `household.pb.js` mit `lib/household-service.js` und den reinen Regeln `lib/household-rules.js`: `GET /api/byl/household`, `POST /api/byl/household` (gründen), `…/rename`, `…/invites`, `…/invites/{id}/revoke`, `…/join` (strenges Rate-Limit), `…/members/{id}/rights`, `…/members/{id}/remove`, `…/members/{id}/transfer`, `…/leave`. Jede Änderung in einer Transaktion, danach das Thema `byl/household` an die Tabs der betroffenen Konten.
- SPA: `/einstellungen/haushalt` für alle Konten und auf jedem Gerät (`HouseholdView`, `HouseholdStore` im `(app)`-Layout, `data/household.ts`, `domain/household.ts`); verliert oder gewinnt ein Tab die Mitgliedschaft, lädt er neu und nennt das Ergebnis danach als Flag. Hilfe „Haushalt“.

## 3a. E7-3: Bereiche Privat und Haushalt (umgesetzt)

Einzelheiten und Begründungen in [ADR-0059](../adr/0059-bereiche-privat-und-haushalt.md).

- **Umschalter und Bereich:** `AreaSwitch` in der Kopfzeile nur für Mitglieder; `AreaStore` (`stores/area.svelte.ts`) im `(app)`-Layout vor allen Stores, gemerkt in `localStorage` `byl-area:<Konto-ID>`, folgt dem `HouseholdStore` (verlorener Haushalt: Privat). `data/area.ts` hält den Bereich des Clients: `areaFilter` für jede Liste, `areaOptions` für Abos, `followArea` für neue Abos nach einem Wechsel, `onReconnect` meldet ihn den Stores. `rescope()` in Katalog, Liste, Regeln, Eingang und Papierkorb. Ein Wechsel schließt Datensätze, Formulare und ID-Filter des alten Bereichs (`areaSwitchTarget`).
- **Server:** Filter der Abos auch im `delete` des Papierkorbs; Abhängigkeiten nur innerhalb eines Bereichs (`dependencies.pb.js`); Verbindungen nie im Haushalt (`validation_connection_private_only`); Einträge erben den Bereich ihrer Verbindung, `.ics` und Lookup mit geprüftem `household`; Texte von `validation_scope_mismatch` je Feld; Papierkorb mit `scope` und `purge`; `households.trash_retention` mit `POST /api/byl/household/retention`.
- **Seiten:** Papierkorb ohne „Endgültig löschen“ und „Leeren“ ohne `purge` (`TrashArea`), Aufbewahrung des Haushalts auf der Seite „Haushalt“ (`RetentionChoice`), „Tickets“ mit der eigenen Aufbewahrung, „Kanäle“ im Haushalt mit „Nur im privaten Bereich“, Hilfe-Abschnitt `#bereiche`.
- **Wechsel der Mitgliedschaft** ohne Neuladen (Folgepunkt aus E7-2 erledigt).

## 4. Festlegungen für die nächsten Pakete

- **E7-3 (umgesetzt, siehe §3a):** Der Umschalter nutzt den `HouseholdStore` des `(app)`-Layouts. `purge` ist mit dem Papierkorb im Haushalt wirksam; die Aufbewahrung richtet sich nach dem Haushalt statt nach dem Konto des Besitzers.
- **E7-4, Verbindungen:** Verbindungen mit Server-Zugriff (Kanäle mit `BYL_*`-Variablen oder Ordner-Kanäle) bleiben immer privat beim Verwalter und dürfen nicht in einen Haushalt verschoben werden. In den Haushalt gelangen nur ihre Tickets.
- **E7-4, Verschieben ins Private:** Heute kann jedes Mitglied über die Record-API `household` eines Haushaltsdatensatzes leeren (keine Oberfläche dafür); E7-4 bindet das an `move_out` und verschiebt mit Kaskade.
- **E7-4, Haushalt auflösen:** Bis dahin kann der Inhaber nicht austreten, nur die Inhaberschaft übertragen.

## 5. Folgepunkte

- **Konten löschen:** `owner` ist an allen fachlichen Datensätzen Pflicht, Kommentare und Verlauf verweisen auf das Konto. Vor einem Löschen in der App muss entschieden werden, ob Daten an ein anderes Konto übergehen, mitgelöscht oder anonymisiert werden (Produktentscheidung). Bis dahin: deaktivieren.
- **Eigene Zugangsdaten je Konto** (E7-7): verschlüsselt am Konto statt als Variable des Windows-Kontos; erst dann können Konten ohne Verwalter-Recht Kalender, Telegram, Postfächer, Notion oder GitHub nutzen.
- **Verbindungen im Haushalt** (E7-7, mit der Festlegung für E7-4 in §4): Heute ändert nur der Verwalter Verbindungen mit Zugangsdaten, auch ihren Namen. Für gemeinsame Verbindungen klären, was Mitglieder ändern dürfen.
- **Präsenz und `start.bat`:** Das Skript kennt die Person nicht; ein offener Tab der zweiten Person verhindert, dass `start.bat` einen Tab öffnet. Mit dem Heimnetz-Zugang neu bewerten (etwa Landing-Seite je Browserprofil).
- **Seite „Konten“ nur auf diesem Rechner:** Wie alle Seiten des Verwalters (ADR-0043 §4). Mit dem Heimnetz-Zugang entscheiden, ob der Verwalter auch von anderen Geräten Konten verwaltet. Seit KOB-1 ([ADR-0057](../adr/0057-kontextabhaengige-oberflaeche.md)) sagt die Oberfläche das am anderen Gerät ausdrücklich („nur am PC“) und fragt die Route dort nicht; die zweite Person sieht keine Seite des Verwalters und keinen Befehl.
- **Persönliche Einstellungen je Konto** (E7-6).
- **Mehrere Haushalte je Konto:** Das Datenmodell ist N:M; die Routen von E7-2 arbeiten auf dem einen Haushalt des Kontos und bekommen erst mit einer Freigabe eine Kennung des Haushalts. Der Umschalter von E7-3 kennt ebenfalls genau einen Haushalt.
- **Ungelesen-Punkt am Umschalter** (aus E7-3): Die Zählung „neu“ entsteht im Client aus den Tickets des aktiven Bereichs; ein Punkt für Ungelesenes im anderen Bereich bräuchte eine eigene Abfrage und Ereignisse des anderen Bereichs. Offen.
- **Verschieben und Abhängigkeiten** (für E7-4): Ein Ticket mit Abhängigkeiten in einen anderen Bereich zu verschieben würde eine Abhängigkeit über die Grenze erzeugen; das Verschieben muss sie mitnehmen oder ablehnen.

## 6. Neustart

- Migration, Hooks und Routen von E7-1 wirken erst nach einem Neustart der App (`neu-starten.bat`). Bis dahin gilt das zuerst angelegte Konto wie bisher als Verwalter, die Seite „Konten“ sagt „Nach dem nächsten Neustart verfügbar“, und alle Seiten bleiben in der Navigation.
- E7-2 ebenso: Bis zum Neustart sagt die Seite „Haushalt“ „Nach dem nächsten Neustart verfügbar“, und die Regeln gelten wie vorher (der Besitzer sieht auch seine Haushaltsdatensätze).
- E7-3: Hooks und Routen (Recht `purge`, Bereich im Papierkorb, Verbindungen nur privat, Abhängigkeiten, Texte) wirken nach dem Neustart, die Oberfläche nach dem Build und F5. Bis die Migration `1790204100` gelaufen ist, zeigt die Seite „Haushalt“ die Aufbewahrung von 30 Tagen, Ändern antwortet 503, und die Bereinigung nimmt für Haushaltstickets die Aufbewahrung des Besitzers.
