# E6-Plan, Teil „Sicherheit“

- **Stand:** SH-1 (Server-Härtung, #237) und SH-2 (Seite „Einstellungen → Sicherheit“) umgesetzt. Offen sind die manuellen Prüfungen.
- **Grundlage:**
  - Nutzerwunsch und Freigabe (2026-10-03): „Ja, kannst Du starten. Und was auch immer nötig ist, kann man auch (sofern sinnvoll und auch ganzheitlich) in den Einstellungen verankern?“
  - Inventur des Advisors (Stand `main` vom 2026-10-03): kein Rate-Limiter, CORS `*`, DNS-Rebinding auf allen Routen von PocketBase, Präsenz-Routen ohne Geheimnis, Admin-Oberfläche ohne Adressbeschränkung.
  - [ADR-0055](../adr/0055-sicherheits-haertung.md) (neu), Nachträge zu [ADR-0001](../adr/0001-betriebsmodell-lokal-mehrgeraete-spaeter.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0035](../adr/0035-start-einstieg-und-offene-tabs.md), [ADR-0038](../adr/0038-eigener-eingang-und-whatsapp-web.md), [ADR-0039](../adr/0039-betriebsskripte.md) und [ADR-0043](../adr/0043-system-seite.md)
- **Einordnung:** Paketkürzel `SH`, Manifest ab `BYL-E6-1360`. Migrationen `1790203500_security_hardening.js` (SH-1) und `1790203600_login_failures.js` (SH-2).

## 1. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| SH-1 | Rate-Limiter per Migration (Stufen „Normal“ und „Streng“, Rückweg), `superuserIPs` nur Loopback, Guard vor jeder Anfrage (Host-Allowlist, Header, CORS-Ausnahmen für Erweiterung und Landing-Seite), `--origins` beim Start mit zusätzlichen Hosts aus `byl-config.json`, Teil `hosts` des Fingerabdrucks, Text der Anmeldeseite bei 429, Harness gleichwertig, Tests, ADR-0055 mit Nachträgen | BYL-E6-1360 bis BYL-E6-1372 |
| SH-2 | Seite „Einstellungen → Sicherheit“: Statusübersicht, Stufe des Schutzes, zusätzliche Adressen (Steuerskript `security-configure`), Gültigkeit der Anmeldung, Anmeldeprotokoll (Migration `1790203600`) mit Hinweis beim Öffnen, Konto-Hinweise, Hilfe „Sicherheit“, Nachtrag ADR-0026 | BYL-E6-1380 bis BYL-E6-1393 |

## 2. SH-1: Härtung des Servers

### 2.1 Schutz vor Rateversuchen

- Migration `1790203500_security_hardening.js`: `rateLimits` mit den Regeln der Stufe „Normal“ einschalten, nur aus dem Zustand von PocketBase (aus, Standardregeln); `superuserIPs` = `127.0.0.1`, `::1`, nur wenn leer. Rückweg nur, solange „Normal“ oder „Streng“ bzw. genau diese Adressen eingestellt sind.
- Regeln und Werte in `lib/security-rules.js` (`rateLimitRules`, `levelOf`), Tabelle und Begründung in ADR-0055 §1. Grundsatz: PocketBase zählt je Adresse, alles hier ist `127.0.0.1`; deshalb nur Anmeldungen (je Collection) und Anfragen ohne Konto, eine eigene hohe Grenze für die Ingest-Routen des Mail-Helfers, angemeldete Anfragen nie.
- Anmeldeseite: 429 mit eigenem Text (rot wie jede Anmeldefehlermeldung, ohne Bezug auf das Konto).

### 2.2 Host-Allowlist, Header und CORS-Ausnahmen

- `security.pb.js`: `routerUse(new Middleware(…, -1042, 'bylSecurityGuard'))`, Logik in `lib/security-service.js`. Vor CORS, Request-Log, Token und Rate-Limiter.
- Host: `127.0.0.1`, `localhost`, `[::1]` mit dem Port aus `--http`, dazu die Hosts der Origins des Starts; sonst 403 `{ reason: "host" }` und eine Log-Zeile.
- Header: `Referrer-Policy: same-origin`, `Permissions-Policy` ohne Kamera, Mikrofon, Ort, Zahlung, USB, `Content-Security-Policy: frame-ancestors 'none'` (nicht unter `/_/`). Keine volle CSP, kein `Cross-Origin-Resource-Policy` (Begründung ADR-0055 §4). Die Sandbox-CSP der Datei-Route nennt `frame-ancestors 'none'` mit.
- CORS-Ausnahmen: Preflight und `Access-Control-Allow-Origin` für die Erweiterung nur auf `/api/byl/inbox/ingest`; `Access-Control-Allow-Origin: null` für die Landing-Seite nur auf den Hinweis-Routen.

### 2.3 Start mit `--origins`

- `byl-functions.ps1`: `ConvertTo-BylExtraHost`, `ConvertFrom-BylSecurityConfig`, `Get-BylOrigins`; `Get-ServerArgumentString -Hosts`, `Merge-BylConfigText -Hosts`, `Get-BylFingerprint -Hosts` (Teil `hosts`, Grund „andere zusätzliche Adressen eingestellt“).
- `byl-control.ps1`: `Get-Config` mit `Hosts`, `Start-Server -Hosts`, Vergleich in `status`.
- Harness: `--origins` mit den eigenen Adressen (`ownOrigins`), Option `extraOrigins`; der Limiter wird nach jedem Start ausgeschaltet, außer mit `rateLimits: true`.

### 2.4 Bewusst nicht

- Präsenz und Hinweis bekommen kein Geheimnis (ADR-0055 §5).
- Keine volle Content-Security-Policy für die App, kein `X-Frame-Options: DENY` (die Middleware von PocketBase setzt `SAMEORIGIN` danach; `frame-ancestors` gewinnt).
- `trustedProxy` bleibt leer, bis es einen Proxy gibt (ADR-0001 §3).

## 3. SH-2: Seite „Einstellungen → Sicherheit“

- **Ort:** `/einstellungen/sicherheit`, in der Navigation nach „Konto“ (Reihenfolge Kanäle, Datei-Importe, Tags, Tickets, Darstellung, Konto, Sicherheit, Sicherung, Speicher, System, Hilfe), auf jedem Server; was das Steuerskript braucht (zusätzliche Adressen), nur bei der eigenen Instanz unter Windows.
- **Zugriff:** Prüfungen von ADR-0043 über `check` aus `lib/system-service.js` mit `local` und `anyPlatform` (angemeldet, dieser Rechner, Host und `Origin`, Besitzer, Rate-Limit).
- **Statusübersicht** mit `Lozenge` je Punkt (Rot nur bei einem echten Problem) und „Was bedeutet das?“: Schutz vor Rateversuchen, nur eigene Oberfläche (CORS), Host-Schutz, Admin-Oberfläche, Sicherungen verschlüsselt (ADR-0046), Zugangsdaten in Umgebungsvariablen, Zugangsschlüssel des eigenen Eingangs (Zahl, zuletzt benutzt, Link), Browser-Erweiterung.
- **Einstellbar:** Stufe „Normal“/„Streng“ (PocketBase-Einstellungen, sofort), zusätzliche Adressen (`byl-config.json` über das Steuerskript, Neustart mit „Jetzt neu starten“), Gültigkeit der Anmeldung (`authToken.duration` der Collection `users`, Auswahl, sofort für neue Anmeldungen).
- **Anmeldeprotokoll:** fehlgeschlagene Anmeldungen (Hook auf `onRecordAuthWithPasswordRequest`, ohne Passwort), 30 Tage, Hinweis beim Öffnen bei Häufungen (ADR-0035).
- **Konto-Hinweise:** „Konto“ und `admin-zuruecksetzen.bat`; Hilfe-Abschnitt „Sicherheit“.
- **Umgesetzt:** Server in `security.pb.js` und `lib/security-service.js` (rein `lib/security-rules.js`), Befehl `security-configure` mit Katalogeintrag `security-hosts`, Migration `1790203600_login_failures.js`; Oberfläche `components/security/SecurityView.svelte` und `SecurityHosts.svelte`, `stores/security.svelte.ts`, `stores/security-attention.ts`, `data/security.ts`, `domain/security.ts`; Tests `security-page.test.mjs`, `system-control.test.mjs` (Adressen über das Steuerskript, „Neustart nötig“ mit `hosts`), `web-security.test.mjs` (Gleichstand), `security-rules.test.mjs`, Rollback, und in `web/` Domain, Ansicht, Hinweis, Navigation und Hilfe. Einzelheiten in ADR-0055 §8.

## 4. Neustart

Migrationen, Hooks und `--origins` wirken erst nach einem Neustart der App (`neu-starten.bat`); bis dahin bleibt alles wie vorher, und die Seite „Sicherheit“ sagt, dass sie erst nach dem Neustart verfügbar ist. `status.bat` und die Seite „System“ nennen „Neustart nötig“ (neue Migration, geänderte Server-Logik).
