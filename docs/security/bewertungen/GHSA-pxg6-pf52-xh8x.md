# Bewertung GHSA-pxg6-pf52-xh8x: `cookie` < 0.7.0

Diese Datei bewertet das Risiko des Dependabot-Hinweises #1. Status und Begründung folgen den Begriffen von VEX ([CISA](https://www.cisa.gov/sites/default/files/2023-01/VEX_Status_Justification_Jun22.pdf), [OpenVEX](https://github.com/openvex/spec/blob/main/OPENVEX-SPEC.md)). Die Bewertung gilt für den Stand unten. Tritt eine Bedingung aus Abschnitt 6 ein, wird sie neu erstellt.

## Kopf

| Feld | Wert |
|---|---|
| Hinweis | [GHSA-pxg6-pf52-xh8x](https://github.com/advisories/GHSA-pxg6-pf52-xh8x), CVE-2024-47764 |
| Titel laut Advisory | „cookie accepts cookie name, path, and domain with out of bounds characters“ |
| Paket | `cookie` (npm), betroffen `< 0.7.0`, behoben in `0.7.0` |
| Vorkommen in BYLJ | `cookie` 0.6.0 in `web/package-lock.json`, transitiv über `@sveltejs/kit` 2.70.3, Scope development |
| Schwere | niedrig („low“) laut Advisory. Ein CVSS-Wert ist nicht hinterlegt (CVSS 3.x und 4.0 ohne Vektor, Score 0). CWE-74 |
| EPSS | 0,00744, Perzentil 0,54 (GitHub, Abruf 2026-10-19) |
| Veröffentlicht | 2024-10-04, zuletzt geändert 2025-04-15 |
| Dependabot | [Hinweis #1](https://github.com/Labushuya/becauseyoulovejira/security/dependabot/1), am 2026-10-19 geschlossen als „Vulnerable code is not actually used“ (`not_used`) |
| Bewertet am | 2026-10-19 |
| Stand | `main` bei `f295ded8`. Ausgelieferter Build in `app/pb_public`: Version `1792418956990`, veröffentlicht am 2026-10-19 |
| Ergebnis | VEX `not_affected`, Begründung `vulnerable_code_not_in_execute_path` |

## 1. Schwachstelle

- **Betroffene Funktion:** `serialize(name, value, options)`. Bis 0.6.0 prüft sie `name`, `options.path` und `options.domain` nur gegen eine weite Zeichenklasse (`fieldContentRegExp`: Tab, alle druckbaren ASCII-Zeichen samt `;` und `=`, dazu U+0080 bis U+00FF).
  - Ein Name mit `;` schreibt deshalb weitere Attribute oder einen anderen Cookie in den Header.
  - Beispiel der Advisory: `serialize("userName=<script>alert('XSS3')</script>; Max-Age=2592000; a", value)` ergibt `userName=<script>alert('XSS3')</script>; Max-Age=2592000; a=test`. Gesetzt wird dann `userName`, der übergebene Wert geht verloren.
  - Pfad und Domain lassen sich auf dieselbe Weise missbrauchen.
- **Behebung:** Version 0.7.0 ([PR #167](https://github.com/jshttp/cookie/pull/167), Commit [`e100428`](https://github.com/jshttp/cookie/commit/e10042845354fea83bd8f34af72475eed1dadf5c)) prüft Name, Wert, Domain und Pfad mit engeren Mustern nach RFC 6265. Geändert sind nur die Prüfungen in `serialize` (`index.js`, dazu `test/serialize.js`). `parse` ist nicht betroffen.
- **Zur Quelle:** Das Feld `vulnerable_functions` der Advisory ist leer. Die betroffene Funktion ergibt sich aus dem Abschnitt „Impact“ und dem Fix-Commit.
- **Voraussetzungen einer Ausnutzung** (alle zugleich):
  1. Code führt `cookie.serialize` aus. In der Regel ist das ein Server, der daraus einen `Set-Cookie`-Header baut. In SvelteKit geschieht das über `event.cookies.set`, `delete` oder `serialize`.
  2. Ein Angreifer bestimmt Name, Pfad oder Domain dieses Cookies ganz oder teilweise, etwa über einen Parameter der Anfrage.
  3. Der Header erreicht einen Browser, für den der zusätzliche Cookie oder das zusätzliche Attribut eine Wirkung hat.
- **Umgehung laut Advisory:** keine fremden oder beliebigen Werte für diese Felder übergeben. Die App setzt sie selbst.

## 2. Vorkommen in BYLJ

- **Lockfile:** `web/package-lock.json` enthält `node_modules/cookie` 0.6.0 (`dev: true`). Nur `@sveltejs/kit` 2.70.3 verlangt `cookie` (`"cookie": "^0.6.0"`).
- **Kette:** `web` (devDependency `@sveltejs/kit` `^2.63.0`) → `@sveltejs/kit` 2.70.3 → `cookie` 0.6.0.
  - `@sveltejs/adapter-static` 3.0.10 führt Kit nur als Peer.
  - `npm ls cookie --all` in `web` zeigt genau diesen Pfad.
- **Andere Lockfiles:** Root, `helpers/mail`, `helpers/backup` und `extensions/whatsapp-web` enthalten `cookie` nicht.
- **Scope:** development, weil Kit eine devDependency ist. Das allein trägt die Bewertung nicht: Eine gebündelte SPA enthält auch Code aus devDependencies, etwa den Client-Teil von Kit. Entscheidend ist der Ausführungspfad (Abschnitt 3).
- **Kein Fix in Kit 2:**
  - 2.70.3 ist die neueste Version von Kit 2 und verlangt `cookie` `^0.6.0`. Kit 3.0.0 und 3.1.0 verlangen `^2.0.1` (`npm view`, 2026-10-19).
  - Ein `overrides` außerhalb des Bereichs, den Kit 2 angibt, wurde verworfen ([Plan Robuste Skripte](../../plan/robuste-skripte.md)).
  - Die Migration auf Kit 3 ist zurückgestellt ([#300](https://github.com/Labushuya/becauseyoulovejira/issues/300)).

## 3. Analyse des Ausführungspfads

### 3.1 Wo SvelteKit `cookie` nutzt

- In Kit 2.70.3 importiert nur `src/runtime/server/cookie.js` Funktionen aus `cookie` (`parse`, `serialize`). Alle übrigen Stellen sind reine Typ-Importe. `cookie.js` wird von `src/runtime/server/respond.js` geladen, dem Request-Handler des Servers.
- `serialize` läuft nur für Cookies, die Server-Code der App erzeugt:
  - über `event.cookies.serialize(…)`;
  - über `add_cookies_to_headers` für Cookies, die vorher mit `event.cookies.set` oder `delete` gesetzt wurden;
  - über `set_internal`, wenn ein serverseitiges `event.fetch` ein `Set-Cookie` weiterreicht (`fetch.js`);
  - in Remote Functions (`src/runtime/app/server/remote/shared.js`).

### 3.2 Architektur der Web-App

- `web/svelte.config.js` nutzt `@sveltejs/adapter-static` mit `fallback: 'index.html'`. Einen Schlüssel `experimental` gibt es nicht, Remote Functions sind also aus.
- `web/src/routes/+layout.ts` setzt `ssr = false` und `prerender = false` für alle Seiten.
- `web/src` enthält keine Datei `+server.*`, `+page.server.*`, `+layout.server.*`, `hooks.server.*` oder `*.remote.*`.
  - Hooks gibt es nur in `hooks.client.ts`.
  - Kein Modul importiert `$app/server` oder `$env/*/private`.
- Die Anmeldung braucht keinen Cookie.
  - Der Client ist `new PocketBase('/')` mit dem `LocalAuthStore` (`web/src/lib/pocketbase.ts`), die Sitzung liegt in `localStorage`.
  - Das Token geht im Kopf `Authorization` mit ([ADR-0043](../../adr/0043-system-seite.md) §4).

### 3.3 Betrieb

- Im Betrieb läuft kein Node- und kein SvelteKit-Server. PocketBase 0.40.4 (Go) liefert `app/pb_public` als statische Dateien aus (`--publicDir`).
- Unbekannte Pfade bekommen `index.html`. Das prüft `tests/integration/spa-fallback.test.mjs`.

### 3.4 Build und Entwicklung

Kits Server-Runtime läuft auch ohne Server im Betrieb, aber nur lokal (Rechner des Entwicklers, CI):

- **`vite build`:**
  - Kit erzeugt das Server-Bundle `web/.svelte-kit/output/server/index.js`. Es ist gitignored, wird nicht ausgeliefert und importiert `parse` und `serialize` aus `cookie`.
  - Mit diesem Bundle rendert Kit einmal die Fallback-Seite (`src/core/postbuild/fallback.js`: `server.respond(new Request(origin + '/[fallback]'))`).
- **`vite dev` und `vite preview`** (`npm --prefix web run dev` bzw. `preview`): Kits Server beantwortet die Anfragen. `web/vite.config.ts` setzt kein `server.host`, Vite bindet dann an `localhost`.
- **Dabei kein Aufruf von `serialize`:**
  - Die App setzt keinen Cookie (3.2).
  - Die Anfrage für den Fallback erzeugt Kit selbst, sie hat keinen Cookie.
  - Mit `ssr = false` läuft keine `load`-Funktion auf dem Server.
  - `add_cookies_to_headers` bekommt damit eine leere Liste.
  - Das ist aus den Quellen von Kit 2.70.3 gelesen, nicht zur Laufzeit gemessen (**Annahme**, durch Code-Lesen gestützt).
  - Selbst ein Aufruf bekäme Name, Pfad und Domain nicht von außen.

### 3.5 Ausgelieferte Dateien

Durchsucht wurden `web/build` und alle 1722 Dateien in `app/pb_public`. Das sind der aktuelle Build und die Dateien früherer Builds, die [ADR-0040](../../adr/0040-veroeffentlichen-ohne-unterbrechung.md) behält.

- **Kits Server-Cookie-Code:** 0 Treffer. Gesucht nach:
  - „You must specify a \`path\` when setting“
  - „Cannot serialize cookies until after the route is determined“
  - „after the response has been generated“
  - „instead of \`event.setHeaders\`“
- **Code, der nur in `cookie` 0.6.0 steht:** 0 Treffer. Gesucht nach „argument str must be a string“, „option encode is invalid“ und „; Partitioned“.
- **`document.cookie`:** 0 Treffer.
- **„argument name is invalid“:** 2 Treffer, die Chunks `_app/immutable/chunks/B-S0w0Vc.js` (aktueller Build) und `DA8DuKle.js` (Builds vom 2026-10-14). Beide stammen aus der Kopie im PocketBase-SDK (3.7).
- **Gegenprobe:** Die Kennung „You must specify a \`path\` …“ steht im Server-Bundle `web/.svelte-kit/output/server/index.js`. Die Suche greift also.

### 3.6 Hilfsprogramme, Erweiterung und Hooks

- Die Lockfiles von `helpers/mail` (`byl-mail.exe`), `helpers/backup` (`byl-backup.exe`) und `extensions/whatsapp-web` enthalten `cookie` nicht. Die beiden Programme sind die einzigen Node-Prozesse im Betrieb.
- Die Hooks in `app/pb_hooks` laufen in der JS-VM von PocketBase. Sie laden nur eigene Module (`require(__hooks + …)`), kein npm-Paket.
- Das Wort „cookie“ steht in keiner Quelldatei, gleich in welcher Schreibweise. Geprüft wurden `web/src`, `app/pb_hooks`, `helpers/*/src`, `extensions/whatsapp-web/src`, `scripts` und die Skripte in `app`.

### 3.7 Kopie im PocketBase-SDK

- **Eigene Kopie im SDK:**
  - `pocketbase` 0.28.1 ist eine Abhängigkeit von `web` und steckt im Build.
  - Es bringt in `src/tools/cookie.ts` eigene Fassungen von `parse` und `serialize` mit, laut Kommentar „mostly based on the node module https://github.com/jshttp/cookie“. Gelesen aus `dist/pocketbase.es.mjs.map`.
  - Die Kopie prüft mit derselben weiten Zeichenklasse wie `cookie` < 0.7.0. Formal ist das dieselbe Schwäche.
  - Die Advisory gilt aber nur für das npm-Paket `cookie`. Dependabot meldet die Kopie nicht.
- **Aufrufer im SDK:** nur zwei Methoden von `BaseAuthStore` (`src/stores/BaseAuthStore.ts`):
  - `loadFromCookie(cookie, key = defaultCookieKey)` ruft `cookieParse` auf.
  - `exportToCookie(options?, key = defaultCookieKey)` ruft `cookieSerialize(key, JSON.stringify(rawData), options)` auf. Vorgaben sind `secure`, `httpOnly`, `sameSite`, `path: "/"` und `expires` aus dem Token. `rawData` enthält Token und Datensatz.
  - `defaultCookieKey` ist die Konstante `"pb_auth"`.
- **Keine Aufrufe in BYLJ:**
  - `web/src` und `app/pb_hooks` ergeben keinen Treffer.
  - Im ausgelieferten Bundle stehen nur die Definitionen, kein `.exportToCookie(` und kein `.loadFromCookie(`.
- **Auch ein Aufruf wäre nicht vom Angreifer steuerbar:**
  - Der Name ist der Parameter `key` mit der festen Vorgabe `"pb_auth"`.
  - Pfad und Domain kommen aus den `options` des aufrufenden Codes: Vorgabe `path: "/"`, keine Domain.
  - Der Wert ist JSON und wird mit `encodeURIComponent` kodiert.
  - Fremde Werte kämen nur hinein, wenn eigener Code sie durchreicht.

## 4. Ergebnis

| VEX-Feld | Wert |
|---|---|
| Produkt | becauseyoulovejira (BYLJ), Stand `f295ded8` |
| Komponente | `pkg:npm/cookie@0.6.0` |
| Status | `not_affected` |
| Begründung | `vulnerable_code_not_in_execute_path` (bei CISA `Vulnerable_code_not_in_execute_path`) |
| Aussage zur Auswirkung | `cookie.serialize` läuft nur in der Server-Runtime von SvelteKit. BYLJ liefert eine statische SPA (adapter-static, `ssr = false`, kein Server-Code) über PocketBase aus. Die Server-Runtime steckt nicht im ausgelieferten Build und läuft im Betrieb nicht. |

- **GitHub:** „Vulnerable code is not actually used“ (`dismissed_reason: not_used`).
- **Warum diese Begründung:**
  - `component_not_present` und `vulnerable_code_not_present` passen nicht: `cookie` steckt im Lockfile, in `node_modules` und im Server-Bundle des Builds.
  - Der Code ist also vorhanden, liegt aber nicht im Ausführungspfad des ausgelieferten Produkts.
  - Für die lokalen Läufe in Build und Dev-Server (3.4) und für die Kopie im SDK (3.7) gilt zusätzlich `vulnerable_code_cannot_be_controlled_by_adversary`.
- **Restrisiko: sehr gering.**
  - Im Betrieb wird der Code weder ausgeliefert noch ausgeführt.
  - Lokal (Build, Dev-Server) wird er geladen. `serialize` wird nach Code-Lesen aber nicht aufgerufen, und die Felder kämen nicht von außen.
  - Die Advisory selbst ist „low“ und hat keinen CVSS-Wert.
  - Es bleibt: Eine spätere Änderung kann eine Annahme kippen, ohne dass es auffällt. Bis zum Wächtertest (Abschnitt 5) fängt das nur die Neubewertung nach Abschnitt 6 ab.
  - Die Kopie im SDK mit derselben Schwäche bleibt im Bundle, ungenutzt.

## 5. Absicherung der Annahmen

| Nr. | Annahme | Beleg am 2026-10-19 | Automatisch geprüft |
|---|---|---|---|
| A1 | Kein Server-Code in `web/src` (`+server.*`, `+page.server.*`, `+layout.server.*`, `hooks.server.*`, `*.remote.*`) | Dateisuche, 0 Treffer | nein |
| A2 | `web/svelte.config.js` nutzt `@sveltejs/adapter-static` | Import in der Datei | nein |
| A3 | Das Root-Layout setzt `ssr = false` | `web/src/routes/+layout.ts` | nein |
| A4 | `web/src` und `app/pb_hooks` rufen weder `exportToCookie` noch `loadFromCookie` auf | Textsuche, 0 Treffer | nein |
| A5 | Kits Server-Cookie-Code steckt nicht in `app/pb_public` | Kennungen aus 3.5, 0 Treffer | nein |
| A6 | `cookie` steht nur in `web/package-lock.json` und nur über Kit | Lockfiles, `npm ls` | nein. Ein Vorkommen in einem anderen Lockfile meldet Dependabot als neuen Hinweis |

- **Wächtertest:** Für A1 bis A4 ist ein Wächtertest unter `tests/unit` vorgesehen, aber noch nicht umgesetzt.
  - Jede neue Testdatei braucht nach Repo-Konvention einen Eintrag im Test-Manifest (`docs/test-manifest.html`). `tests/unit/test-manifest.test.mjs` prüft, dass das Manifest jede Testdatei abdeckt.
  - Der Test kommt deshalb mit einem eigenen Paket.
  - Schlägt er an, meldet er „Annahme der Bewertung GHSA-pxg6-pf52-xh8x verletzt – neu bewerten“ und verweist auf diese Datei.
- Bis dahin gelten A1 bis A6 als am Stand oben geprüft, nicht als dauerhaft gesichert.

**Nachprüfen** (im Repo, nur lesend; `app/pb_public` und `web/.svelte-kit` erst nach einem Build):

```sh
npm --prefix web ls cookie --all
grep -l '"node_modules/cookie"' package-lock.json web/package-lock.json helpers/*/package-lock.json extensions/*/package-lock.json
find web/src \( -name '+server.*' -o -name '+page.server.*' -o -name '+layout.server.*' -o -name 'hooks.server.*' -o -name '*.remote.*' \)
grep -rn "from 'cookie'" web/node_modules/@sveltejs/kit/src
grep -rlF 'Cannot serialize cookies until after the route' app/pb_public web/build web/.svelte-kit/output/server
grep -rlE '\.(exportToCookie|loadFromCookie)\(' web/src app/pb_hooks app/pb_public
```

## 6. Neu bewerten, sobald eines davon eintritt

- SSR, Server-Routen (`+server`, `+page.server`, `+layout.server`), `hooks.server` oder Remote Functions kommen in `web/src` hinzu, oder ein Layout setzt `ssr = true`.
- Der Adapter wechselt (etwa zu `adapter-node`), oder die App läuft hinter einem Server von SvelteKit statt aus `app/pb_public`.
- Eigener Code ruft `exportToCookie` oder `loadFromCookie` auf, oder die Anmeldung wechselt vom Kopf `Authorization` zu Cookies.
- Die Migration auf SvelteKit 3 ([#300](https://github.com/Labushuya/becauseyoulovejira/issues/300)) kommt. Kit 3.1 bringt `cookie` `^2.0.1`, damit ist der Hinweis im Lockfile behoben. Diese Bewertung wird dann als erledigt vermerkt.
- Eine neue Advisory zu `cookie` (auch zu `parse`) oder zur Cookie-Kopie im PocketBase-SDK erscheint.
- Der Dev- oder Preview-Server wird im Netz erreichbar gemacht (`server.host`, `--host`).

## 7. Quellen

- GitHub Advisory Database: [GHSA-pxg6-pf52-xh8x](https://github.com/advisories/GHSA-pxg6-pf52-xh8x) (`gh api advisories/GHSA-pxg6-pf52-xh8x`, Abruf 2026-10-19)
- jshttp/cookie: [Advisory](https://github.com/jshttp/cookie/security/advisories/GHSA-pxg6-pf52-xh8x), [PR #167](https://github.com/jshttp/cookie/pull/167), [Fix-Commit](https://github.com/jshttp/cookie/commit/e10042845354fea83bd8f34af72475eed1dadf5c)
- CISA: [Vulnerability Exploitability eXchange (VEX) – Status Justifications](https://www.cisa.gov/sites/default/files/2023-01/VEX_Status_Justification_Jun22.pdf) (Juni 2022)
- [OpenVEX Specification](https://github.com/openvex/spec/blob/main/OPENVEX-SPEC.md): Status `not_affected`, Begründung `vulnerable_code_not_in_execute_path`
- GitHub REST API: [Dependabot alerts](https://docs.github.com/en/rest/dependabot/alerts) (`dismissed_reason`, `dismissed_comment`)
- Frühere Einordnung im Repo: [Plan E3](../../plan/e3.md) Abschnitt 7 (2026-09-24), [Plan Robuste Skripte](../../plan/robuste-skripte.md), [ADR-0040](../../adr/0040-veroeffentlichen-ohne-unterbrechung.md)
