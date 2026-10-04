# ADR-0001: Betriebsmodell – vorerst lokal und Einzelnutzer, später Mehrgeräte/Mehrnutzer über Tailscale

- **Status:** Angenommen (mit Nachtrag vom 2026-09-27, ergänzt durch [ADR-0028](0028-plattform-strategie.md); Nachtrag 2026-10-04: Zugriff im Heimnetz über HTTP als Einstellung)
- **Datum:** 2026-09-24
- **Entscheidung durch:** Nutzer (Betriebsmodell), Advisor (technische Voraussetzungen)

## Kontext

becauseyoulovejira wird zunächst ausschließlich vom Nutzer selbst auf einem Windows-10-Rechner genutzt. Später sollen weitere Geräte des Nutzers (Laptop, Smartphone) und weitere Personen (Haushalt) zugreifen, voraussichtlich über ein privates Tailscale-Netz. Diese Erweiterung darf keine Datenmigration erzwingen: Daten, die im Einzelnutzerbetrieb entstehen, müssen unverändert im Mehrnutzerbetrieb weiterverwendbar sein.

Das Datenmodell der [CLAUDE.md §5](../../CLAUDE.md#5-datenmodell) ist bereits darauf ausgelegt: `users`, `households`, `household_members`, Pflichtfeld `owner` und optionales `household` auf allen fachlichen Datensätzen, Scopes `u:<ownerId>` / `h:<householdId>` mit Nummernkreisen je Scope, API-Regeln mit Haushalts-Zweig.

## Entscheidung

1. **Jetzt (MVP, E1–E5):** PocketBase lauscht ausschließlich auf `127.0.0.1:8090`. Es gibt genau einen App-Nutzer in `users`. Selbstregistrierung ist gesperrt (`users.createRule = null`). Anmeldung per E-Mail und Passwort über das PocketBase JS SDK; das Frontend ist immer authentifiziert, auch lokal.
2. **Ab E1 ist alles mehrnutzerfähig gebaut**, auch wenn nur ein Nutzer existiert:
   - Jeder fachliche Datensatz trägt `owner`; `household` bleibt vorerst leer, `scope` ist `u:<ownerId>`.
   - Alle API-Regeln enthalten schon den Haushalts-Zweig und werden per Negativtest mit einem zweiten Nutzer geprüft (siehe [ADR-0004](0004-teststrategie-hooks-migrationen.md)).
   - Alle Felder, die später für Haushalte Eindeutigkeit oder Nummernkreise bestimmen, hängen am Scope (nicht am Owner), damit beim Wechsel keine Werte nachgetragen werden müssen.
   - Das Frontend spricht PocketBase relativ zur eigenen Origin an (`window.location.origin`), nie mit hartkodiertem `127.0.0.1:8090`.
3. **Später (eigene Etappe nach E5, nur nach Freigabe):** Zugriff von anderen Geräten über **`tailscale serve`** als HTTPS-Reverse-Proxy auf `http://127.0.0.1:8090`. PocketBase bleibt an `127.0.0.1` gebunden; erreichbar ist es nur über das Tailnet, nicht über das LAN oder das Internet. Voraussetzungen dieser Etappe:
   - **HTTPS:** Tailscale stellt das Zertifikat für `<rechner>.<tailnet>.ts.net` aus. HTTPS ist Pflicht, weil Tokens übertragen werden und Browser-Funktionen (Benachrichtigungen, Zwischenablage, Service Worker) einen Secure Context verlangen.
   - **Bindung:** unverändert `127.0.0.1:8090`. Keine Bindung an `0.0.0.0` und kein PocketBase-eigenes Let's Encrypt (`serve <domain>`), da dafür Port 80/443 öffentlich erreichbar sein müssten.
   - **Proxy-Header:** In den PocketBase-Settings `trustedProxy.headers = ["X-Forwarded-For"]` setzen, damit Logs und Rate Limiter echte Client-IPs sehen.
   - **Superuser-Schutz:** `pocketbase superuser ips 127.0.0.1` beschränkt das Admin-UI auf den Rechner selbst. Das greift erst in Kombination mit den Proxy-Headern, weil sonst alle Tailnet-Zugriffe als `127.0.0.1` erscheinen.
   - **Rate Limiting:** eingebauten Rate Limiter (`rateLimits.enabled`) aktivieren.
   - **Auth:** weitere Personen werden vom Superuser im Admin-UI angelegt. Selbstregistrierung bleibt gesperrt. MFA für `_superusers` optional.
   - **CORS:** Die SPA wird von derselben Origin ausgeliefert. `--origins` wird auf die Tailnet-Origin eingeschränkt, statt auf dem Standard `*` zu bleiben.
4. **Haushalte (Teilen zwischen Personen):** bleibt laut CLAUDE.md §10 eine eigene Stufe nach ausdrücklicher Freigabe. Technisch ist sie über das bestehende Datenmodell abgedeckt; nötig sind nur UI, Hooks für Mitgliedschaften und die Aktivierung der Schreibregeln auf `households` und `household_members`.

## Warum das Datenmodell schon passt

- Sichtbarkeit wird nie aus „es gibt nur einen Nutzer“ abgeleitet, sondern immer aus `owner` bzw. Haushaltsmitgliedschaft. Ein zweiter Nutzer sieht ohne Codeänderung nichts vom ersten.
- Nummernkreise und Eindeutigkeiten (`tickets(scope, key)`, `projects(scope, code)`) hängen am Scope. Ein privater Scope bleibt beim Hinzukommen weiterer Personen gültig.
- Wird ein Ticket später einem Haushalt zugeordnet, vergibt der Hook einen neuen Key im Ziel-Nummernkreis, und der alte Key bleibt in der Historie. URLs referenzieren Record-IDs, sie bleiben also gültig.
- Mehrgerätebetrieb eines einzelnen Nutzers ändert am Datenmodell nichts. Es kommen nur weitere Sessions desselben Nutzers hinzu, und Realtime-Subscriptions halten die Geräte synchron.

## Alternativen

- **Bindung an `0.0.0.0` im Heimnetz:** unverschlüsselt (HTTP) und für jedes Gerät im LAN erreichbar. Verworfen.
- **PocketBase mit eigener Domain und Let's Encrypt:** braucht öffentlich erreichbare Ports und eine Domain, das wäre Cloud-/Internet-Exposition. Verworfen (CLAUDE.md §10: kein Cloud-Hosting).
- **Ohne Login, solange lokal:** Dann müsste die Auth später nachgerüstet und bestehende Datensätze einem Owner zugeordnet werden, also eine Datenmigration. Verworfen.
- **Tailscale Funnel:** macht den Dienst öffentlich im Internet erreichbar. Verworfen.

## Konsequenzen

- Positiv: Mehrgerätebetrieb erfordert nur Betriebskonfiguration (Tailscale, Settings), keine Schema- oder Datenänderung.
- Positiv: Auth und Regeln werden ab E1 unter realistischen Bedingungen getestet.
- Negativ: Auch im Einzelnutzerbetrieb ist ein Login nötig. Gemildert durch lange Token-Laufzeit und automatisches `authRefresh`.
- Negativ: Die Tailscale-Etappe hängt von einem externen Dienst (Tailscale-Konto) ab. Er ist optional; lokal läuft die App ohne ihn.
- Die Aussage „nur lokal“ in README und CLAUDE.md gilt ausdrücklich **vorerst** und verweist auf diese ADR.

## Nachtrag 2026-09-27: Plattform-Strategie

[ADR-0028](0028-plattform-strategie.md) ergänzt diese ADR, ohne §1 bis §4 aufzuheben:

- Neben dem PC kann ein dauerhaft laufender Raspberry Pi den Server stellen, dort mit PocketBase als Container ohne veröffentlichten Port. Je Datenbestand läuft genau ein Server.
- Neben `tailscale serve` ist HTTPS über Traefik im eigenen Netz ein zweiter Weg. Die Voraussetzungen aus §3 (Proxy-Header, Superuser nur lokal, Rate Limiter, `--origins`) gelten für beide.
- Mehrgeräte für einen Nutzer sind Stufe S2 im [Plattform-Plan](../plan/plattformen.md); die Haushalte (§4) bleiben E7 mit eigener Freigabe.

## Nachtrag 2026-10-03: Härtung schon im lokalen Betrieb ([ADR-0055](0055-sicherheits-haertung.md), SH-1)

Drei Voraussetzungen aus §3 gelten seit SH-1 schon jetzt, weil jede Webseite im Browser des Nutzers Anfragen an `127.0.0.1` schicken kann:

- **Rate Limiting:** Die Migration `1790203500_security_hardening.js` schaltet `rateLimits` ein (Stufe „Normal“: 10 Anmeldungen je Minute und Collection, 300 Anfragen ohne Konto je 10 s, angemeldete Anfragen ohne Grenze).
- **Superuser-Schutz:** `superuserIPs` = `127.0.0.1`, `::1` (dieselbe Migration statt `pocketbase superuser ips`). Hinter einem Proxy (§3) braucht es weiter `trustedProxy.headers`, sonst erscheint jeder Zugriff als `127.0.0.1`.
- **CORS:** `--origins` nennt die eigenen Adressen (`http://127.0.0.1:<Port>`, `http://localhost:<Port>`) und jeden zusätzlichen Host aus `byl-config.json` als `https://<Host>` (ADR-0055 §3). Für die Tailnet-Origin trägt man später dort den Namen ein.
- Dazu prüft ein Guard vor jeder Anfrage den `Host` (ADR-0055 §2): Erreichbar ist die App nur unter ihren eigenen Adressen und den zusätzlichen Hosts.

## Nachtrag 2026-10-04: Zugriff im Heimnetz über HTTP (Nutzerentscheidung, HN-1)

Die unter „Alternativen“ verworfene **Bindung an `0.0.0.0` im Heimnetz** gibt es jetzt als Einstellung, auf ausdrücklichen Wunsch des Nutzers für den Haushalt (E7) und unabhängig von §3 (Tailscale) und S2 ([ADR-0028](0028-plattform-strategie.md), Nachtrag 2026-10-04). Einzelheiten in [ADR-0055](0055-sicherheits-haertung.md) (Nachtrag 2026-10-04) und im [Plan „Zugriff im Heimnetz“](../plan/heimnetz.md).

- **§1 gilt als Standard weiter:** ausgeschaltet bindet die App nur `127.0.0.1`. Eingeschaltet bindet sie `0.0.0.0:<Port>` und antwortet nur unter `127.0.0.1`, `localhost`, `[::1]` und den gewählten Adressen des Heimnetzes (Host-Allowlist), über **HTTP ohne Verschlüsselung**, nur für vertrauenswürdige Netze und deutlich so benannt.
- **§3 bleibt der Weg für HTTPS und für unterwegs:** Proxy-Kopfzeilen (`trustedProxy`) werden für den Heimnetz-Zugang nicht gesetzt; die Prüfungen „nur dieser Rechner“, `superuserIPs` und der Rate-Limiter sehen dadurch die echte Adresse jedes Geräts.
- Mehrere Personen bleiben getrennt über ihre Konten (§2); die Haushalts-UI ist weiter E7.
