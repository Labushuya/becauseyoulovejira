# Plan „Eigener Eingang und WhatsApp Web“: API mit Zugangsschlüssel und Browser-Erweiterung

- **Stand:** EI-1 umgesetzt (2026-09-28, #166; Neustart nötig), EI-2 umgesetzt (Erweiterung, kein Neustart der App). EI-3 folgt.
- **Grundlage:**
  - Auftrag „Eigener Eingang (API mit Zugangsschlüssel)“ und „WhatsApp-Web-Browser-Erweiterung“ (2026-09-28) mit den Produktentscheidungen des Advisors (unten §1); vom Nutzer freigegebene Variante: Erweiterung, die im offenen Tab nur liest.
  - [ADR-0038](../adr/0038-eigener-eingang-und-whatsapp-web.md) (neu), [ADR-0016](../adr/0016-kanal-architektur-und-mail.md) §3 mit Nachtrag, [ADR-0020](../adr/0020-stichwoerter-pro-kanal.md), [ADR-0014](../adr/0014-datenmodell-eingang.md), [ADR-0031](../adr/0031-herkunft-sichern.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md), [ADR-0009](../adr/0009-fehlerfarbe.md), [ADR-0029](../adr/0029-glas-materialien.md), [ADR-0037](../adr/0037-papierkorb.md)
  - [CLAUDE.md](../../CLAUDE.md) §3, §5, §7, §8, §10, §11, §12
- **Einordnung:** Paketkürzel `EI`, Manifest-Block „Eigener Eingang und WhatsApp Web“ ab `BYL-E6-420`, ADR-0038, Migration `1790202400_inbox_keys.js` (nach `1790202300`).

## 1. Produktentscheidungen (Advisor, 2026-09-28)

1. Browser-Erweiterung, die im offenen WhatsApp-Web-Tab **nur liest** und an die lokale App sendet. Keine inoffiziellen Protokoll-Bibliotheken, keine Automatisierung von WhatsApp (nie senden, nie klicken, nie Nachrichten verändern), keine externen Server, keine Telemetrie. Der Chat-Export bleibt.
2. Plattform-Ausbau (Tailscale, Pi, APK, …) und Releases bleiben zurückgestellt; die Erweiterung wird entpackt aus dem Build geladen, kein Store.
3. Eigener Eingang unter `/api/byl/inbox/...`, nur mit `Authorization: Bearer <Schlüssel>`. Schlüssel mit Namen, einmal im Klartext, nur als Hash gespeichert, widerrufbar, „zuletzt benutzt“, nur Eingangseinträge des Besitzers.
4. Payload mit `channel`, `mode` (`manual` | `auto`), `title?`, `text`, `url?`, `sender?`, `chat?`, `sent_at?`, `external_id`; Deduplizierung über den Fingerprint samt Tombstones.
5. `auto` nur mit Stichwort des Kanals, `manual` immer; Antworten angelegt / Duplikat / gefiltert.
6. Rate-Limit je Schlüssel, saubere Fehlercodes, keine Schlüssel oder Inhalte in Logs; CORS nicht global öffnen.
7. Erweiterung: Manifest V3 für Chrome und Edge, minimale Berechtigungen, Adresse nur Loopback, Schalter „Automatisch (nur mit Stichwort)“ standardmäßig aus, optional Chat-Liste, Statusanzeige; manuell je Nachricht „In den Eingang“, automatisch nur neue Nachrichten; nur Text; Selektoren zentral; Tests mit eigenen Fixtures.
8. In der App: Karte „WhatsApp Web (Browser-Erweiterung)“ mit Assistent, Stichwörtern und Hilfe mit ehrlichen Hinweisen.

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| EI-1 | Migration (`inbox_keys`, Kanäle `api` und `whatsapp-web`), Routen und Regeln des Eingangs, Stichwörter der Kanäle, Karte „Eigener Eingang (API)“ mit Schlüsselverwaltung, Hilfe mit Beispielen, Tests, ADR, Plan | BYL-E6-420 bis BYL-E6-424, BYL-E6-425 (manuell) |
| EI-2 | Erweiterung in `extensions/whatsapp-web/` (TypeScript, esbuild), Build-Ordner `app/erweiterung-whatsapp-web/`, Lint und Tests in beiden CI-Jobs, Fixtures | BYL-E6-426 bis BYL-E6-429 |
| EI-3 | Karte und Assistent „WhatsApp Web“, Hilfe, Nachtrag ADR-0016, README, CLAUDE.md, manuelle Browser-Fälle | ab BYL-E6-430 |

## 3. EI-1 im Detail

### 3.1 Server

- `app/pb_migrations/1790202400_inbox_keys.js`: Collection `inbox_keys` (Regeln list/view/delete nur Besitzer, create/update `null`, `token_hash` hidden und eindeutig), Werte `api` und `whatsapp-web` für `inbox_items.channel` und `tickets.source`. Rückweg mit Ersatzkanal und Entfernen der Stichwortlisten (ADR-0038 §1).
- `app/pb_hooks/inbox-keys.pb.js`: `POST /api/byl/inbox/keys` (angemeldet), `GET` und `POST /api/byl/inbox/ingest` (Bearer, Body bis 512 KB).
- `lib/inbox-key-rules.js` (rein, ES5): Form des Schlüssels, Name, erlaubter `Origin`, Payload, ISO-Zeit, Stichwort-Entscheidung, Rate-Limit (60/min), „zuletzt benutzt“ höchstens minütlich, Zahl der Stichwörter.
- `lib/inbox-key-service.js`: Anlegen, Anmelden über den Hash, Rate-Limit in `$app.store()`, Eintrag über `inbox-service.ingest`, 503 vor der Migration.
- `lib/inbox-fingerprint.js`: `<channel>|<external_id>`; `lib/source.js` und `lib/keywords.js` (Arten `api`, `whatsapp-web` in `users.import_keywords`).

### 3.2 Oberfläche

- Karte „Eigener Eingang (API)“ im Bereich „Selbst hereinbringen“ der Seite „Kanäle“ (`OwnInboxCard`): Schlüssel mit Name, Anfang, angelegt, zuletzt benutzt, „Widerrufen …“ (Bestätigung, nicht rot), „Zugangsschlüssel erzeugen …“ (Modal M mit `InboxKeyCreateForm`, Schlüssel einmal mit `CodeBlock` und „Kopieren“), „Stichwörter …“ (Modal M `ChannelKeywordsModal` mit dem Stichwort-Editor), „So geht’s“ zur Hilfe.
- `InboxKeyCreateForm` hält den Schlüssel nur im eigenen Zustand; er landet weder im Store noch im Speicher des Browsers. EI-3 nutzt dieselbe Komponente im Assistenten (kein Dialog aus einem Dialog).
- Hilfe: Abschnitt „Eigener Eingang (API)“ (`helpHref('eigener-eingang')`) mit Beispielen für PowerShell (UTF-8-Body für Windows PowerShell 5.1) und curl, den Feldern und Antworten.
- Kanäle in Liste, Filter und Symbol: `api` in der Familie „Manuell“ (Filter der erledigten Tickets bis vier Kanäle je Familie), `whatsapp-web` in „Chat“; Kopie-Status „Nur Text“.

### 3.3 Tests

- Unit: `inbox-key-rules.test.mjs`, `web-inbox-keys.test.mjs`, Ergänzungen in `inbox-fingerprint`, `keywords`, `web-keywords`, `source`, `web-source`.
- Integration: `inbox-keys.test.mjs` (einmal sichtbar, nur Hash, Besitzer, Regeln, 20er-Grenze, 401/403/400/422/429, Duplikat und Tombstone, Widerruf, Preflight), `migrations-rollback.test.mjs` (Hin und Rückweg), `hooks-before-migration.test.mjs` (503 vor dem Neustart).
- Komponenten: `own-inbox-card.test.ts`, Hilfe-Seite.

## 4. EI-2 im Detail

### 4.1 Aufbau

| Datei | Aufgabe |
|---|---|
| `static/manifest.json` | Manifest V3: `storage`, Hosts `web.whatsapp.com`, `127.0.0.1`, `localhost`; Service Worker, Content-Script mit CSS, Popup und Einstellungsseite (`options.html`) |
| `src/selectors.ts` | alle Selektoren von WhatsApp Web |
| `src/extract.ts`, `src/time.ts` | Nachrichten, Text, Absender, Zeit (`data-pre-plain-text` in de, en-US, en-GB, ISO), Chatname, Zustand der Seite |
| `src/payload.ts` | Payload mit `external_id = wa:<SHA-256 der ID>` |
| `src/auto.ts` | Regeln des Automatik-Modus (eingeschaltet, Chat-Liste, Schwelle = Minute des Einschaltens bzw. der zuletzt gesehenen Nachricht) |
| `src/content-core.ts` | Knopf je Nachricht mit Text, Rückmeldung, Automatik, Meldung des Seitenzustands; `MutationObserver` mit 300 ms Pause |
| `src/api.ts`, `src/background-core.ts` | Service Worker: prüft Absender und Nachricht, liest Adresse und Schlüssel, sendet, bildet Antworten ab |
| `src/settings.ts`, `src/options-core.ts` | Einstellungen: Adresse nur Loopback, Schlüssel, Test, Schalter (aus), Chat-Liste, Status |

### 4.2 Entscheidungen

- **Nur Text:** Nachrichten ohne Textblock (Bilder, Sprach- und Videonachrichten, Sticker) bekommen keinen Knopf und gehen nie automatisch; eine Bildunterschrift gilt als Text. Ein Hinweis „[Medien – nicht übernommen]“ wäre ein Eintrag ohne Inhalt.
- **Neu ist, was ab der Minute des Einschaltens bzw. der zuletzt gesehenen Nachricht des Chats erscheint.** Beim Öffnen eines Chats zeigt WhatsApp Web seine Historie; ältere Nachrichten zählen als gesehen. Dieselbe Minute kann doppelt kommen, die App meldet sie dann als Duplikat. Nachrichten ohne lesbare Zeit gehen nie automatisch.
- **Chatname als Schlüssel des letzten Zeitpunkts** nur als SHA-256; die Chat-Liste steht im Klartext in den Einstellungen der Erweiterung, weil der Nutzer sie dort pflegt.
- **Rückmeldung** im eigenen Element (Knopftext und `role="status"`), keine Meldung außerhalb der Nachricht; Tasten- und Mausereignisse des eigenen Elements erreichen WhatsApp nicht.
- **Keine Minifizierung**, damit der Nutzer den geladenen Code lesen kann; kein Store, kein Paket, kein Update-Mechanismus.

## 5. Grenzen und offene Punkte

- Das Rate-Limit liegt im Speicher und beginnt nach einem Neustart neu; mehr braucht ein Server auf `127.0.0.1` nicht.
- Fehlgeschlagene Anmeldungen werden nicht gebremst: Ein Schlüssel hat rund 238 Bit, Raten ist aussichtslos.
- Die Selektoren sind nach eigenem Wissen über den Aufbau von WhatsApp Web gebaut und nur mit eigenen Nachbauten getestet (kein Aufruf der echten Seite). Ob sie zur aktuellen Seite passen, zeigt erst der manuelle Test; sonst meldet die Erweiterung „Seitenstruktur nicht erkannt“ und `src/selectors.ts` braucht eine Anpassung.
- Automatisch erfasst werden nur Nachrichten des gerade geöffneten Chats und nur bei offenem Tab (WhatsApp Web zeigt nur diesen Chat an).
