# E7-Plan „Haushalt“

- **Stand:** E7-1 „Konten und Verwalter“ umgesetzt ([ADR-0056](../adr/0056-konten-und-verwalter.md)). E7-2 bis E7-5 sind Entwurf und beginnen je mit eigener Freigabe. Offen sind die manuellen Prüfungen von E7-1.
- **Grundlage:**
  - Nutzerentscheidungen vom 2026-10-04: E7 startet jetzt, entkoppelt vom Mehrgeräte-Ausbau (Plattform-Stufen S2/S3, [ADR-0028](../adr/0028-plattform-strategie.md)). Die zweite Person testet zunächst am selben Rechner mit eigenem Browserprofil; ein Zugang im Heimnetz kommt parallel in einem eigenen Paket. Haushaltsrollen: Der Gründer verwaltet und kann Rechte delegieren (E7-2). Ein ausdrückliches Recht „Verwalter der App“ ersetzt „erstes Konto = Besitzer“. Kanäle mit Zugangsdaten (`BYL_*`) und Ordner richtet vorerst nur der Verwalter ein; eigene verschlüsselte Zugangsdaten je Konto kommen später. Persönliche Einstellungen je Konto kommen als späteres Zusatzpaket.
  - Inventur des Advisors (Stand `main` vom 2026-10-04, nach SH-2): `ownerId` in `lib/system-service.js`, Seiten nur für den Besitzer, Konten nur über `/_/`, `users` und `household_members` nur eigene Zeilen lesbar, `personLabel` ohne Namen, Präsenz ohne Konto, Kanäle mit beliebigen Variablen und Ordnern.
  - Bisherige Planung: [ADR-0001](../adr/0001-betriebsmodell-lokal-mehrgeraete-spaeter.md) §4, [ADR-0011](../adr/0011-roadmap-e3-bis-e7.md) §1 (beide mit Nachtrag zum Start von E7), [ADR-0015](../adr/0015-neu-markierung-pro-nutzer.md) (Lesestand je Nutzer).
- **Einordnung:** Paketkürzel `E7-1` bis `E7-5`, Manifest ab `BYL-E7-001`. Migration von E7-1: `1790203700_accounts_admin.js`.

## 1. Pakete

| Paket | Inhalt | Stand | Manifest |
|---|---|---|---|
| E7-1 | Konten und Verwalter: Recht `users.instance_admin` statt „erstes Konto“, Schalter `users.disabled`, Seite „Konten“ (anlegen mit Startpasswort, zurücksetzen, deaktivieren, Recht geben und nehmen), „Konto“ mit Passwort und Anzeigename, Namen im Haushalt sichtbar (E-Mail nie), Präsenz und Hinweis je Konto, Kanäle mit Zugangsdaten und Ordner nur für den Verwalter, Navigation ohne Verwalter-Seiten für andere | umgesetzt | BYL-E7-001 bis BYL-E7-024 |
| E7-2 | Haushalte anlegen und Mitglieder verwalten: Gründer (Rolle `owner`), Rechte delegieren, Mitglieder aus den Konten hinzufügen und entfernen, Schreibregeln von `households` und `household_members` (heute `null`), Haushalt verlassen, der Bereichs-Umschalter wird aktiv | Entwurf | ab BYL-E7-100 |
| E7-3 | Gemeinsame Daten im Haushalt: Tickets, Projekte, Tags und Regeln im Bereich `h:<id>` anlegen und verschieben (Datenmodell und Regeln stehen seit E1), „Neu“ je Person (ADR-0015), Namen im Verlauf | Entwurf | ab BYL-E7-200 |
| E7-4 | Kanäle im Haushalt und eigene Zugangsdaten je Konto: verschlüsselte Zugangsdaten statt `BYL_*` für Konten ohne Verwalter-Recht, Verbindungen eines Haushalts (wer darf umbenennen, pausieren, Stichwörter ändern) | Entwurf | ab BYL-E7-300 |
| E7-5 | Persönliche Einstellungen je Konto: Farbschema, Akzent, Glas, Spalten, Öffnungsmodus und ähnliches am Konto statt nur im Browser | Entwurf | ab BYL-E7-400 |

Parallel, nicht Teil von E7: „Zugriff im Heimnetz“ (Netzwerkbindung, Host-Liste, Firewall; eigenes Paket, Plattform-Plan).

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
- Persönliche Einstellungen je Konto (E7-5).

## 3. Folgepunkte

- **Konten löschen:** `owner` ist an allen fachlichen Datensätzen Pflicht, Kommentare und Verlauf verweisen auf das Konto. Vor einem Löschen in der App muss entschieden werden, ob Daten an ein anderes Konto übergehen, mitgelöscht oder anonymisiert werden (Produktentscheidung). Bis dahin: deaktivieren.
- **Eigene Zugangsdaten je Konto** (E7-4): verschlüsselt am Konto statt als Variable des Windows-Kontos; erst dann können Konten ohne Verwalter-Recht Kalender, Telegram, Postfächer, Notion oder GitHub nutzen.
- **Verbindungen im Haushalt** (E7-4): Heute ändert nur der Verwalter Verbindungen mit Zugangsdaten, auch ihren Namen. Für gemeinsame Verbindungen klären, was Mitglieder ändern dürfen.
- **Präsenz und `start.bat`:** Das Skript kennt die Person nicht; ein offener Tab der zweiten Person verhindert, dass `start.bat` einen Tab öffnet. Mit dem Heimnetz-Zugang neu bewerten (etwa Landing-Seite je Browserprofil).
- **Seite „Konten“ nur auf diesem Rechner:** Wie alle Seiten des Verwalters (ADR-0043 §4). Mit dem Heimnetz-Zugang entscheiden, ob der Verwalter auch von anderen Geräten Konten verwaltet. Seit KOB-1 ([ADR-0057](../adr/0057-kontextabhaengige-oberflaeche.md)) sagt die Oberfläche das am anderen Gerät ausdrücklich („nur am PC“) und fragt die Route dort nicht; die zweite Person sieht keine Seite des Verwalters und keinen Befehl.
- **Persönliche Einstellungen je Konto** (E7-5).

## 4. Neustart

Migration, Hooks und Routen von E7-1 wirken erst nach einem Neustart der App (`neu-starten.bat`). Bis dahin gilt das zuerst angelegte Konto wie bisher als Verwalter, die Seite „Konten“ sagt „Nach dem nächsten Neustart verfügbar“, und alle Seiten bleiben in der Navigation.
