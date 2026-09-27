# ADR-0031: Herkunft sichern: Quellen eines Tickets, Löschschutz, große Mails und Seitenkopie

- **Status:** Angenommen und umgesetzt in den Paketen HK-1 bis HK-4 nach [docs/plan/herkunft.md](../plan/herkunft.md) (#106 bis #108 und der PR von HK-4); manuelle Browser-Prüfungen stehen im Test-Manifest
- **Datum:** 2026-09-27
- **Entscheidung durch:** Nutzer („Herkunft sichern“ direkt nach „Spalten“, keine Checkbox „Kopie speichern“, Seitenkopie ja, „Quelle prüfen“ nein, Verknüpfen mit beliebigen Tickets, 2026-09-27), Advisor (Empfehlung zur Umsetzung), Executor (Datenmodell, Grenzen, Einzelheiten)
- **Ergänzt:** [ADR-0014](0014-datenmodell-eingang.md) §1, §2 und §4 (Zustände, Rückverweis, „Einem bestehenden Ticket zuordnen“), [ADR-0016](0016-kanal-architektur-und-mail.md) §5 und §6 (Hilfsprozess, Postfach-Auswahl), [ADR-0017](0017-parser-ics-eml.md) (`.eml`)
- **Bezug:** [ADR-0008](0008-markdown-rendering-und-sanitizing.md) (Anzeige), [ADR-0025](0025-ui-konsistenz-overlay-system.md), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0029](0029-glas-materialien.md), [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md)

## Kontext

Ein Eingangseintrag (`inbox_items`) ist eine eingefrorene Kopie seiner Quelle. Wie vollständig sie ist, hängt vom Kanal ab:

| Kanal | Was gespeichert wird |
|---|---|
| Mail (`eml`, `mail`) | die ganze `.eml` samt Anhängen als `original` (höchstens 10 MB), dazu Text und Kopfdaten |
| Termin (`ics`, `calendar`) | ein `.ics`-Ausschnitt als `original` |
| Telegram, WhatsApp | nur Text und Metadaten |
| Web-Link (`link`) | nur Adresse, Titel und bis zu 1.500 Zeichen Auszug |
| manuell, Schnellerfassung, Zwischenablage | der eingegebene Text; er ist selbst das Original |

`tickets.source_item` zeigt ohne Kaskade auf den Eintrag, aus dem das Ticket entstand. Beim Umwandeln wird der Eintrag `converted` und bekommt `inbox_items.ticket`. Umgewandelte Einträge werden nie bereinigt, die Bereinigung nach 30 Tagen trifft nur verworfene ([ADR-0014](0014-datenmodell-eingang.md) §3).

Der Faktencheck vom 2026-09-27 hat fünf Lücken gefunden:

1. **Mails über 10 MB gehen verloren.** Der automatische Abruf überspringt sie still, weil der Cursor trotzdem vorrückt. Die Postfach-Auswahl und der `.eml`-Import lehnen sie ab. In keinem Fall entsteht ein Eintrag.
2. **„Dem Ticket zuordnen“ ist unsichtbar.** Es setzt nur `inbox_items.ticket`; das Ticket zeigt davon nichts.
3. **Ein Ticket hat höchstens eine Herkunft** (`source_item`).
4. **Einträge lassen sich löschen.** Die `deleteRule` erlaubt es jedem Besitzer. Das Ticket verliert dann seine Quelle samt Datei.
5. **Bei Links fehlt der Seiteninhalt.**

Der Nutzer will außerdem Einträge aus Kanälen mit beliebigen Tickets verknüpfen, auch mit manuell angelegten, und zwar vom Eingang und vom Ticket aus.

## Entscheidung

### 1. Datenmodell: keine neue Collection, `converted` bleibt für beides

- Die **Quellen eines Tickets** sind alle `inbox_items` mit `ticket = <id>`. Es gibt keine neue Collection und kein neues Feld am Ticket.
- `tickets.source_item` bleibt die **Hauptquelle**: der Eintrag, aus dem das Ticket entstand. Sie ist wie bisher unveränderlich.
- **Kein neuer Zustand `linked`.** Ein verknüpfter Eintrag ist wie bisher `converted`. Ob er die Hauptquelle ist, folgt aus `tickets.source_item = <Eintrag>`. Gründe:
  - Die Unterscheidung ist ableitbar. Ein zweiter Zustand wäre eine Kopie derselben Information, die auseinanderlaufen kann.
  - Ein neuer Wert im Select-Feld `state` bräuchte eine Migration und für die schon zugeordneten Einträge eine Datenmigration ([ADR-0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md): keine Datenmigration ohne Not). Ohne sie gäbe es zugeordnete Einträge mit beiden Zuständen.
  - Duplikatsperre, Meldung „Schon Ticket HAUS-12.“, Bereinigung, der Chip „Umgewandelt“, die Filter des Servers und die Hooks vor der Migration bleiben unverändert.
  - Die bisher per „Dem Ticket zuordnen“ zugeordneten Einträge erscheinen ohne Weiteres als Quellen ihres Tickets.
- Der Nachteil: Der Chip „Umgewandelt“ im Eingang zeigt auch verknüpfte Einträge. Die Zeile nennt dafür das Ticket.

### 2. Verknüpfen und Lösen

- **Verknüpfen** ist das bestehende Update `state = converted` mit `ticket = <id>` über die Record-API ([ADR-0014](0014-datenmodell-eingang.md) §4, „Einem bestehenden Ticket zuordnen“). „Dem Ticket zuordnen“ beim Duplikathinweis, „Mit Ticket verknüpfen …“ im Eingang und „Quelle hinzufügen …“ im Ticket nutzen denselben Weg.
- **Lösen** ist das Update `state = new` mit leerem `ticket`. Nur ein verknüpfter Eintrag lässt sich lösen, nie die Hauptquelle (`validation_inbox_primary_source`, „Die Hauptquelle eines Tickets lässt sich nicht lösen.“). Der Eintrag steht danach wieder im Eingang, `handled_at` ist leer.
- **Verboten bleibt:**
  - `converted` → `converted` mit einem anderen Ticket (erst lösen, dann neu verknüpfen)
  - `discarded` → `converted`
  - jeder Wechsel von `converted` nach `discarded`
- **Atomar im Hook:** Der Modell-Hook von `inbox_items` läuft in seiner eigenen Transaktion (`inTransaction`). Darin prüft er das Ticket (fehlende und fremde ID ergeben dieselbe Meldung `validation_scope_mismatch`, wie beim Umwandeln), setzt `handled_at` und schreibt den Eintrag in `ticket_history` des Tickets. Scheitert die Historie, bleibt der Eintrag unverändert.
- **Historie:** Feld `source_link`, beim Verknüpfen `new_value`, beim Lösen `old_value`, jeweils als JSON `{"item","channel","title"}`. So bleibt der Eintrag im Verlauf lesbar, auch wenn er später gelöst wird. Urheber ist der angemeldete Nutzer, gemerkt im Request-Hook wie bei Tickets. Das Umwandeln selbst schreibt keinen solchen Eintrag, dafür gibt es „hat das Ticket angelegt“.
- **Mehrere Einträge zugleich:** Die SPA verknüpft nacheinander, jeder Eintrag für sich atomar. Teilfehler bleiben je Eintrag mit Grund stehen, wie beim gesammelten Umwandeln. Ein Batch-API ist abgelehnt ([ADR-0014](0014-datenmodell-eingang.md) §4).
- **Ticket löschen:** unverändert. PocketBase leert `inbox_items.ticket`, die Einträge bleiben `converted` und halten ihr Duplikatmerkmal.

### 3. Löschschutz

- **Migration** `1790201800_inbox_items_delete_guard.js`: `deleteRule` = bisherige Regel `&& ticket = ""`. Ein Eintrag mit Ticket ist über die API nicht löschbar (404 wie jeder nicht sichtbare Datensatz). Die Rückwärts-Migration stellt die alte Regel her.
- **Hook** `onRecordDeleteRequest` für `inbox_items`: Ein Eintrag mit `ticket` oder als `source_item` eines Tickets wird mit 400 `validation_inbox_item_linked` abgelehnt („Dieser Eintrag ist die Quelle eines Tickets und lässt sich nicht löschen.“). Der Hook wirkt sofort, also auch vor dem Neustart und für Superuser über die API.
- Ein umgewandelter Eintrag, dessen Ticket gelöscht wurde, schützt nichts mehr und ist löschbar. Die Oberfläche bietet ohnehin kein Löschen von Einträgen an.

### 4. Große Mails: Eintrag ohne Originaldatei

- Mails über 10 MB (`MAIL_MAX_BYTES`) werden nicht mehr übersprungen oder abgelehnt. Es entsteht ein Eintrag **ohne** `original`, mit Absender, Betreff, Datum und Text, soweit lesbar.
- **Hilfsprozess:** Er lädt nur die ersten 2 MB der Mail (`BODY.PEEK[]<0.2097152>`, `MAIL_PARTIAL_BYTES`) und parst sie mit derselben Funktion wie sonst. Der Text steht in einer Mail vor den Anhängen, der abgeschnittene Rest fehlt. Lässt sich der Anfang nicht parsen, liest er nur den Kopf (`BODY.PEEK[HEADER]`), und der Eintrag hat nur die Kopfdaten.
  - Das gilt für den automatischen Abruf (dort weiter mit Stichwortprüfung über Betreff, Absender und den geladenen Anfang), die Vollsuche und die Postfach-Auswahl.
  - `EXAMINE` und `PEEK` bleiben, der Test-IMAP-Server belegt das.
- **`.eml`-Datei:** Die SPA liest von einer Datei über 10 MB ebenfalls nur die ersten 2 MB (`File.slice`).
- **Kennzeichen:** `source_meta.original_omitted = "too_large"` und `source_meta.original_size` (Bytes). Der Text endet mit dem Hinweis „_Originaldatei nicht gespeichert: größer als 10 MB._“, statt die Anhänge zu zählen. Die Ingest-Route nimmt beide Schlüssel an und prüft ihre Werte.
- `byl-mail.exe` wird 0.8.0. Ein älterer Hilfsprozess überspringt große Mails weiter, bis `stop.bat` und `start.bat` ihn ersetzen.

### 5. Kopie-Status

Die reine Funktion `copyCompleteness(item)` in `web/src/lib/domain/inbox.ts` sagt, was von der Quelle gespeichert ist:

| Wert | Anzeige | Wann |
|---|---|---|
| `complete` | „Vollständig“ | `original` vorhanden, oder manuell, Schnellerfassung, Zwischenablage |
| `text` | „Nur Text“ | Telegram, WhatsApp, Mail oder Termin ohne `original` |
| `address` | „Nur Adresse“ | Web-Link ohne Seitenkopie |
| `too_large` | „Ohne Originaldatei (zu groß)“ | `original_omitted = "too_large"` |

- Anzeige als `Lozenge` im Abschnitt „Quellen“ (`neutral`, bei `complete` `brand`). Im Panel des Eintrags steht bei allem außer `complete` eine `SectionMessage` (info), die sagt, was fehlt. `danger` gibt es hier nicht, denn nichts davon ist ein Fehler ([ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) §2).
- Eine Checkbox „Kopie speichern“ gibt es nicht: Eine Kopie wird immer gespeichert (Nutzerentscheidung).

### 6. Seitenkopie für Web-Links

- **Auslöser:** „Seiteninhalt sichern“ im Panel eines Link-Eintrags ohne Seitenkopie und beim Erfassen per Bookmarklet (Vorlage „Web-Link“, Checkbox standardmäßig an). Einmal gesichert ist gesichert; ein zweiter Abruf wird abgelehnt.
- **Route** `POST /api/byl/inbox/{id}/page`, nur angemeldet und nur für sichtbare Einträge (`canAccessRecord` mit der `viewRule`, sonst 404). Nur Kanal `link` mit `source_url`.
- **Abruf** mit `$http.send`, `GET`, Timeout 10 s, ohne Cookies oder Anmeldedaten, mit `Range: bytes=0-2097151`. Angenommen werden nur Status 200 und 206 mit `text/html` oder `application/xhtml+xml`. Gespeichert werden höchstens die ersten 2 MB; eine größere Seite wird gekürzt (`source_meta.page.truncated`).
- **Speichern:**
  - Der Text der Seite wird mit `lib/html-text.js` extrahiert. Das ist eine ES5-Fassung von `htmlToText` der SPA mit Paritätstest: ohne `script`, `style`, Bilder und eingebettete Objekte, Links als „Text (Adresse)“.
  - Er kommt unter den Auszug in `body`, getrennt durch eine Linie (`---`), insgesamt höchstens 100.000 Zeichen. Wie der Text von HTML-Mails wird er nicht maskiert; die Anzeige ist sanitisiert (unten).
  - Die HTML-Datei liegt als `original` (`seite.html`, `protected`), dazu `source_meta.page` mit Zeitpunkt, Größe und Seitentitel.
- **Anzeige:** Die Anzeige läuft wie jeder Kanaltext über `Markdown.svelte` ([ADR-0008](0008-markdown-rendering-und-sanitizing.md)): keine Skripte, keine Bilder, keine externen Ressourcen. Die HTML-Datei gibt es nur als Download (`download=1`), nie eingebettet.
- **SSRF-Schutz** (`lib/url-guard.js`, rein, mit Unit-Tests):
  - nur `http:` und `https:`, keine Anmeldedaten in der Adresse, nur die Ports 80, 443, 8080 und 8443
  - IP-Literale in jeder Schreibweise werden erkannt und blockiert, wenn sie privat, Loopback, Link-Local, Metadaten, nicht angegeben, Carrier-Grade-NAT, Benchmark, Multicast, Broadcast oder reserviert sind:
    - IPv4 dezimal, oktal und hexadezimal, mit weniger als vier Teilen und als eine Zahl
    - IPv6 samt `::ffff:`-, NAT64- und 6to4-Einbettung
  - Hostnamen ohne Punkt, `localhost`, `*.localhost` und lokale Endungen werden blockiert: `.local`, `.localdomain`, `.internal`, `.intranet`, `.lan`, `.home`, `.corp`, `.home.arpa`, `.test`, `.invalid`, `.example`.
  - Ebenso bekannte Dienste, die jede IP als Namen auflösen: `nip.io`, `sslip.io`, `xip.io`, `localtest.me`, `lvh.me`, `vcap.me`.
- **Grenzen des Schutzes** (JSVM von PocketBase 0.40.4, `plugins/jsvm/binds.go`), ehrlich benannt:
  - **Keine DNS-Auflösung:** Die JSVM kann Namen nicht selbst auflösen. Ein öffentlicher Name, der auf eine private Adresse zeigt (eigene Domain, DNS-Rebinding), wird nicht erkannt.
  - **Weiterleitungen nicht prüfbar:** `$http.send` nutzt Gos `http.DefaultClient`. Er folgt bis zu 10 Weiterleitungen selbst und nennt die Zieladresse nicht. Das Ziel einer Weiterleitung lässt sich deshalb nicht prüfen, und die Zahl ist nicht unter 10 zu begrenzen.
  - **Größe erst nach dem Laden:** `$http.send` hat kein Größenlimit und lädt die ganze Antwort in den Speicher. `Range` hilft nur bei Servern, die es beachten. Die 2 MB gelten für das, was gespeichert wird; den Download begrenzt nur das Timeout.
  - **Bewertung:** Übrig bleibt eine „blinde“ GET-Anfrage an ein Gerät im eigenen Netz, ausgelöst durch eine präparierte öffentliche Seite. Die Antwort sieht nur der Nutzer selbst, in seinem Eingang; ohne Cookies und Anmeldedaten. Dieselbe GET-Anfrage kann die Seite auch über den Browser des Nutzers auslösen. Der Server hört nur auf `127.0.0.1`.
  - Ein vollständiger Schutz (Auflösung vor dem Verbinden, jede Weiterleitung einzeln prüfen, Abbruch beim Streamen) ginge nur außerhalb der JSVM, etwa im Hilfsprozess. Das ist zurückgestellt, weil er nur mit einer Mail-Verbindung läuft.
- **Tests:** Ein lokaler Fake-Server liefert HTML, zu große und falsche Antworten. Damit die Route ihn auf `127.0.0.1` erreicht, gibt es die Testvariable `BYL_TEST_PAGE_PORT`, die genau `127.0.0.1:<Port>` freigibt (wie `BYL_MAIL_TEST_IMAP_PORT`). Ohne sie ist `127.0.0.1` gesperrt. Negativtests prüfen die gesperrten Adressen über die Route.

### 7. Oberfläche (nur bestehende Bausteine)

- **Ticket, Abschnitt „Quellen“** (Panel und Vollansicht, nach den Metadaten):
  - eine Liste der verknüpften Einträge mit Kanal (Symbol und Name), Datum (Quelldatum, sonst Eingang), Absender bzw. Chat bzw. Adresse, „Hauptquelle“ und dem Kopie-Status als `Lozenge`
  - je Zeile „Ansehen“ (Link auf `/eingang/<id>`), „Originaldatei herunterladen“ und „Lösen“ als `.button-icon` mit `aria-label` und `title`; „Lösen“ nicht bei der Hauptquelle, ohne Rückfrage, mit Erfolgs-Flag
  - darunter „Quelle hinzufügen …“: Modal M mit Suchfeld und Checkboxen über die neuen Einträge des Eingangs
  - ohne Quellen `EmptyState compact`
- **Eingang, „Mit Ticket verknüpfen …“:** im Panel eines neuen Eintrags und in der Auswahlleiste für mehrere. Es öffnet ein Modal M mit einer Combobox (APG-Muster, Listbox im Modal, kein eigenes Popover) zur Ticketsuche nach Nummer bzw. Key oder Titel über den Server.
- **Verlauf:** „Quelle verknüpft: Postfach „…““ bzw. „Quelle gelöst: …“ (Name des Kanals und Titel des Eintrags).
- Glas nur über die Bausteine ([ADR-0029](0029-glas-materialien.md)): kein Glas im Glas, die Listbox ist undurchsichtig. Die Liste der Quellen ist keine Tabelle ([ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md) gilt nicht).

## Alternativen

- **Collection `ticket_sources` (n:m):** Ein Eintrag könnte dann mehreren Tickets dienen. Dafür bräuchte es eine neue Collection mit Regeln, Negativtests und Realtime. Außerdem würde der Zustand des Eintrags doppelt geführt (`converted` und Zeilen). Der Nutzer hat „einem Ticket zuordnen“ beschrieben, nicht „mehreren“. Verworfen.
- **Zustand `linked`:** siehe §1. Verworfen.
- **Route für Verknüpfen und Lösen** (`POST /api/byl/tickets/{id}/sources`): Ein Aufruf für mehrere Einträge wäre möglich. Doch es gäbe zwei Wege zum selben Zustandswechsel, weil die Record-API „Dem Ticket zuordnen“ schon kann. Zugriffsregeln und Realtime müssten nachgebaut werden. Verworfen.
- **Große Mails ganz laden und ohne Original speichern:** Eine 40-MB-Mail kostet Speicher und Zeit, nur um die Anhänge wegzuwerfen. imapflow begrenzt die Größe der Antwort ohnehin. Verworfen zugunsten des Anfangs der Mail.
- **Seitenkopie im Browser:** CORS verhindert den Abruf fremder Seiten. Verworfen.
- **Seitenkopie im Hilfsprozess:** Das wäre der bessere SSRF-Schutz (§6, Grenzen). Doch der Prozess läuft nur mit einer Mail-Verbindung und braucht den Ingest-Token. Zurückgestellt.
- **Öffentlicher DNS-over-HTTPS-Dienst zur Auflösung:** Jeder Host ginge an einen fremden Dienst, und die spätere Verbindung löst trotzdem neu auf (Rebinding). Verworfen.
- **Checkbox „Kopie speichern“:** vom Nutzer abgelehnt.
- **„Quelle prüfen“ (erneut abrufen und vergleichen):** vom Nutzer abgelehnt.

## Konsequenzen

- Eine Migration (`deleteRule`) mit Rollback-Test samt Daten. Die Hooks arbeiten auch vor ihr (`hooks-before-migration.test.mjs`); der Löschschutz wirkt dann über den Hook.
- `inbox-rules.transitionViolation` erlaubt `converted` → `new` ohne Ticket; die Prüfung auf die Hauptquelle macht der Dienst in der Transaktion.
- Der bisherige Test „Eintrag löschen leert `source_item`“ wird zum Test des Löschschutzes.
- `byl-mail.exe` 0.8.0; der Test-IMAP-Server lernt Teilabrufe (`BODY.PEEK[]<0.n>`).
- Neue reine Module: `lib/url-guard.js`, `lib/html-text.js` (mit Paritätstest zur SPA), `copyCompleteness` in der SPA.
- Nach dem Update braucht die App einen Neustart (`stop.bat`, dann `start.bat`) für die Migration und den neuen Hilfsprozess. Hooks und Oberfläche wirken sofort.
