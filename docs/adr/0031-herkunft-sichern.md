# ADR-0031: Herkunft sichern: Quellen eines Tickets, Löschschutz, große Mails und Seitenkopie

- **Status:** Angenommen und umgesetzt in den Paketen HK-1 bis HK-4 nach [docs/plan/herkunft.md](../plan/herkunft.md) (#106 bis #109); Nachtrag „Folgeauftrag“ (Umhängen, Löschen mit Quellen, Hervorhebung, 25 MB) in den Paketen HK-5 bis HK-8 (#110 bis #113); manuelle Browser-Prüfungen stehen im Test-Manifest
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
  - `converted` → `converted` mit einem anderen Ticket (erst lösen, dann neu verknüpfen); aufgehoben durch den Nachtrag, Abschnitt A
  - `discarded` → `converted`
  - jeder Wechsel von `converted` nach `discarded`
- **Atomar im Hook:** Der Modell-Hook von `inbox_items` läuft in seiner eigenen Transaktion (`inTransaction`). Darin prüft er das Ticket (fehlende und fremde ID ergeben dieselbe Meldung `validation_scope_mismatch`, wie beim Umwandeln), setzt `handled_at` und schreibt den Eintrag in `ticket_history` des Tickets. Scheitert die Historie, bleibt der Eintrag unverändert.
- **Historie:** Feld `source_link`, beim Verknüpfen `new_value`, beim Lösen `old_value`, jeweils als JSON `{"item","channel","title"}`. So bleibt der Eintrag im Verlauf lesbar, auch wenn er später gelöst wird. Urheber ist der angemeldete Nutzer, gemerkt im Request-Hook wie bei Tickets. Das Umwandeln selbst schreibt keinen solchen Eintrag, dafür gibt es „hat das Ticket angelegt“.
- **Mehrere Einträge zugleich:** Die SPA verknüpft nacheinander, jeder Eintrag für sich atomar. Teilfehler bleiben je Eintrag mit Grund stehen, wie beim gesammelten Umwandeln. Ein Batch-API ist abgelehnt ([ADR-0014](0014-datenmodell-eingang.md) §4).
- **Ticket löschen:** unverändert. PocketBase leert `inbox_items.ticket`, die Einträge bleiben `converted` und halten ihr Duplikatmerkmal. Aufgehoben durch den Nachtrag, Abschnitt B.

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

## Nachtrag (2026-09-27): Folgeauftrag

Nutzerentscheidungen vom 2026-09-27 nach HK-4, umgesetzt in den Paketen HK-5 bis HK-8 ([Plan](../plan/herkunft.md) §2 und §3).

### A. Umhängen: „Anderem Ticket zuordnen …“ (HK-5)

- Ein verknüpfter Eintrag wechselt **direkt** von Ticket A zu Ticket B: dasselbe Update über die Record-API wie beim Verknüpfen (`state = converted`, `ticket = B`). Die Regel aus §2 „erst lösen, dann neu verknüpfen“ entfällt.
- `transitionViolation` erlaubt `converted` → `converted` mit einem anderen, nicht leeren Ticket. `linkChange` nennt den Wechsel `move`; bekommt ein umgewandelter Eintrag ohne Ticket (dessen Ticket gelöscht ist) wieder eines, gilt das als `link`.
- **Atomar im Hook:** Der Modell-Hook prüft in seiner Transaktion das Ziel (fehlend oder fremd: `validation_scope_mismatch`) und schreibt nach dem Speichern je einen Verlaufseintrag `source_link` in **beide** Tickets: in A `old_value` mit `moved_to: { ticket, key }`, in B `new_value` mit `moved_from: { ticket, key }` (Key zum Zeitpunkt des Wechsels). Scheitert einer, bleibt der Eintrag bei A. Die Tickets selbst ändern sich nicht (`updated` bleibt).
- Verlauf: „Quelle verschoben nach HAUS-13: Telegram „…““ bzw. „Quelle verschoben von HAUS-12: …“.
- `handled_at` bleibt beim Wechsel unverändert.
- **Hauptquelle bleibt gesperrt.** Die Hauptquelle eines Tickets lässt sich weder lösen noch umhängen (`validation_inbox_primary_source` am Feld `ticket`, Text „Die Hauptquelle bleibt bei dem Ticket, das aus ihr entstanden ist; sie lässt sich weder lösen noch verschieben.“). Gründe:
  - `tickets.source_item` ist die Herkunft des Tickets: Titel, Beschreibung, `tickets.source` und die Karte „Quelle“ stammen aus diesem Eintrag. Hinge er an B, zeigte A eine Herkunft, die nicht mehr stimmt, oder verlöre sie ganz.
  - Umhängen müsste A im selben Schritt ändern (`source_item` leeren oder auf eine andere Quelle setzen). Das wäre ein Server-Update des Tickets samt Verlauf, `updated` und Realtime. Es würde ein Folgeticket einer Serie „berührt“ machen (ADR-0023 §3: unberührt heißt `updated = created`) und so das Wiedereröffnen der Vorinstanz verändern.
  - Eine andere Quelle zur Hauptquelle zu machen, wäre eine Auswahl ohne klare Regel. Den Fall, dass die Hauptquelle „eigentlich zu B gehört“, deckt ein neues Ticket bzw. das Verknüpfen weiterer Quellen ab.
  - Die Oberfläche zeigt den Grund dort, wo die Aktion fehlt: im Panel des Eintrags („Hauptquelle: Das Ticket ist aus diesem Eintrag entstanden. Er bleibt deshalb bei HAUS-12 …“) und in der Quellenliste des Tickets („Bleibt bei diesem Ticket, weil es aus ihr entstanden ist …“).
- **Oberfläche:** „Anderem Ticket zuordnen …“ im Panel des Eintrags (Block „Gehört zu HAUS-12 · Titel“ oben mit „Ticket öffnen“, „Anderem Ticket zuordnen …“, „Lösen“) und je Quelle im Ticket (Symbolknopf). Beide öffnen `MoveSourceDialog` (Modal M mit der Ticketsuche; das aktuelle Ticket wird nicht angeboten). Ein Fehler bleibt im Dialog, der Erfolg geht als Flag „„…“ gehört jetzt zu HAUS-13.“.
- **Ticket am Eintrag (A):** Listen, Panel und das Realtime-Abo von `inbox_items` laden das Ticket mit (`expand=ticket`, nur `id`, `key`, `title`, `source_item`). Die SPA kennt so Key, Titel und ob der Eintrag die Hauptquelle ist (`InboxItemSummary.ticket`), ohne das Ticket einzeln zu laden. Ändert sich der Key des Tickets später (Projektwechsel), zeigt der Eingang bis zum nächsten Laden bzw. Ereignis des Eintrags den alten Key.

### B. Löschen eines Tickets mit Quellen (HK-6)

§2 „Ticket löschen: unverändert“ ist damit aufgehoben. Bisher leerte PocketBase nur `inbox_items.ticket`; die Quellen blieben `converted` ohne Ticket, aus dem Eingang verschwunden und ohne Weg zurück.

- **Nie mitlöschen, nie verwaist lassen.** Beim Löschen eines Tickets werden seine Quellen (Einträge mit `ticket = <id>` und die Hauptquelle) im selben Schritt entweder
  - **„Quellen zurück in den Eingang“** (`inbox`, Standard): `state = new`, `ticket` und `handled_at` leer, oder
  - **„Quellen verwerfen“** (`discard`): `state = discarded` (Tombstone; nach 30 Tagen leert die Bereinigung den Inhalt, der Fingerprint bleibt, und die Vollsuche des Posteingangs importiert dieselbe Mail nicht noch einmal).
  - In beiden Fällen kommt `source_meta.ticket_deleted = { key, at }` dazu. Das Panel des Eintrags zeigt daraus „Ticket HAUS-12 wurde gelöscht; dieser Eintrag war eine Quelle und ist wieder im Eingang.“ bzw. „… wurde dabei verworfen.“ Wird der Eintrag wieder verknüpft oder umgewandelt, entfernt der Hook den Hinweis.
- **Atomar im Hook:** `onRecordDelete` von `tickets` merkt sich vor `e.next()` die IDs der Quellen und setzt sie danach in derselben Transaktion (PocketBase hat `ticket` dann schon geleert, und die Hauptquelle ist keine mehr). Scheitert ein Eintrag, bleibt das Ticket samt Quellen.
- **Wahl serverseitig:** Route `POST /api/byl/tickets/{id}/delete` mit `{ "sources": "inbox" | "discard" }`, nur angemeldet, nur für Tickets, die die Anfrage nach der `deleteRule` löschen darf (sonst 404), eine andere Wahl 400. Sie gibt die Wahl als flüchtigen Schlüssel `@source_handling` am Datensatz an den Hook. **Jeder andere Weg** (Standard-Delete der Record-API, Verwaltung `/_/`, das Entfernen eines unberührten Folgetickets einer Serie) gibt die Quellen in den Eingang zurück.
- **Oberfläche:** Die Bestätigung „HAUS-12 endgültig löschen?“ nennt bei Quellen deren Zahl („Zu diesem Ticket gehören 2 Quellen. Sie werden nicht mitgelöscht.“) und fragt per Radio (Fieldset „Quellen“, unter dem Text, außerhalb der Beschreibung des Dialogs; `ConfirmDialog` hat dafür das Snippet `options`). Vorausgewählt ist „Quellen zurück in den Eingang“. Die Ansage nennt das Ergebnis („HAUS-12 wurde gelöscht. 2 Quellen sind wieder im Eingang.“). Die Zahl kommt aus dem `TicketSourcesStore`; solange er lädt, fragt der Dialog nicht, und der Server nimmt den sicheren Standard.
- **Verwaiste Einträge von vorher:** Die Migration `1790201900_inbox_items_orphans.js` setzt alle `converted`-Einträge ohne Ticket einmalig auf `new` mit `ticket_deleted = { key: '', at, restore }` (der Key des gelöschten Tickets ist nicht mehr bekannt). Sie schreibt per `UPDATE` nur `state`, `handled_at` und `source_meta`, `updated` und Hooks bleiben unberührt. `restore` hält `handled_at` und das rohe `source_meta`, damit die Rückwärts-Migration genau diese Einträge (solange sie noch `new` sind) wiederherstellt; der Rollback-Test belegt das mit Daten, auch für ein `source_meta` von `NULL`.
- `linkChange` kennt den Fall „umgewandelt ohne Ticket bekommt ein Ticket“ weiter als `link`; über die API entsteht er nicht mehr.

### C. Hervorhebung in der Akzentfarbe und Filter (HK-7)

- **Eingang, Zeile:** Einträge mit Ticket (umgewandelt oder verknüpft) tragen die Zeilenmarkierung `inset 3px 0 0 var(--color-brand)` am Zeilenanfang (die einzige erlaubte Markierung nach [ADR-0029](0029-glas-materialien.md); dieselbe wie bei der offenen Zeile, die zusätzlich die Akzentfläche hat) und statt „Ticket ansehen“ den Chip **„→ HAUS-12“**: ein Link aufs Ticket in `--color-brand-soft-text` auf `--color-brand-soft-bg` (Paar der Token-Tests, 4,5 : 1 in allen Themes), Key in Mono, `title` mit Key und Titel, Name „Ticket HAUS-12 öffnen: „…““. Ohne geladenes Ticket bleibt „Ticket ansehen“.
- **Panel des Eintrags:** oben „Gehört zu HAUS-12 · Titel“ (seit HK-5, Abschnitt A) auf `--color-brand-soft-bg` mit Rand in `--color-brand`; die Zeile „Zustand“ sagt „Umgewandelt“ bei der Hauptquelle und sonst „Verknüpft“ (`stateLabel`).
- **Ticket, Quellen:** jede Quelle mit einem linken Rand in `--color-brand` (3 : 1 gegen die Fläche geprüft), „Hauptquelle“ in `--color-brand-text`.
- **Filter „Zustand“:** „Neu“ (Standard, nur offene Einträge), „Verknüpft“ (Zustand `converted`, vorher „Umgewandelt“), „Verworfen“ und „Alle“. URL `zustand=verknuepft` bzw. `alle`; das alte `umgewandelt` öffnet weiter „Verknüpft“. „Alle“ lädt wie die anderen bearbeiteten Ansichten seitenweise vom Server, ohne Zustandsfilter und nach `-created`; neue Einträge bleiben darin, auch wenn sie verworfen oder wiederhergestellt werden, und zählen weiter für den Umschalter.
- Keine neuen Tokens: alle Farben sind Paare, die `tokens.test.ts` in allen vier Themes und beiden Modi prüft.

### D. Originaldateien bis 25 MB (HK-8)

- Die Grenze für Originaldateien steigt von 10 MB auf **25 MB** (Nutzerentscheidung). §4 gilt weiter, nur mit der neuen Grenze: Eine Mail über 25 MB kommt ohne Datei, aus ihren ersten 2 MB.
- **Eine Konstante:** `MAIL_MAX_MB = 25` und `MAIL_MAX_BYTES` in `web/src/lib/domain/inbox-mail.ts`, gemeinsam für die SPA (`.eml`-Drop, `EML_MAX_BYTES`) und den Hilfsprozess (Abruf, Vollsuche, Postfach-Auswahl, Grenzen von imapflow `maxLiteralSize`/`maxResponseSize`, Protokoll „davon 1 über 25 MB ohne Originaldatei“). Der Hinweis im Text heißt „_Originaldatei nicht gespeichert: größer als 25 MB._“.
- **Schema:** Migration `1790202000_inbox_items_original_size.js` setzt `inbox_items.original.maxSize` auf 25 MB (Rückwärts-Migration: 10 MB; Rollback-Test mit Daten). Keine Datei wird angefasst.
- **Ingest-Route:** Body-Limit 27 MB statt 12 MB (Datei plus Entwurf und Multipart-Rahmen). Der Record-API setzt PocketBase das Limit selbst nach der Feldgröße.
- **Texte:** Der Hinweis im Panel nennt die Grenze nicht mehr („Die Mail war zu groß für die Originaldatei (12,4 MB).“), weil ältere Einträge noch an 10 MB gescheitert sind. Die Ablage nennt „.eml; über 25 MB ohne Originaldatei“ statt „höchstens 10 MB“.
- **Übergang:** Hooks und SPA wirken nach F5, das Schema erst nach dem Neustart (`stop.bat`, dann `start.bat`), der auch `byl-mail.exe` 0.9.0 startet. Bis dahin lehnt der Server eine `.eml`-Datei zwischen 10 und 25 MB mit dem Feldfehler der Datei ab, und der alte Hilfsprozess arbeitet mit 10 MB.
- **Kosten:** Größere Dateien vergrößern `pb_data` und jedes Backup (zwölf aufbewahrte). Die README weist darauf hin.

## Nachtrag E (2026-09-28, Papierkorb, ADR-0037): Quellen eines Tickets im Papierkorb

Nachtrag B gilt weiter für das endgültige Löschen. Das normale Löschen verschiebt ein Ticket seit PB-1 in den Papierkorb ([ADR-0037](0037-papierkorb.md) §6):

- **„Quellen zurück in den Eingang“** (Standard jedes Wegs): sofort `new` ohne Ticket wie bisher; `source_meta.ticket_deleted` trägt zusätzlich `ticket`, die ID des Tickets im Papierkorb. Der Verlauf des Tickets bekommt dafür keine Zeile „Quelle gelöst“. Die Hauptquelle wird am Ticket geleert (Schnappschuss), damit sie im Eingang frei ist.
- **„Quellen verwerfen“:** Die Quellen bleiben gebunden (`converted`) am Ticket im Papierkorb; die Regeln von `inbox_items` (`ticket = "" || ticket.deleted_at = ""`) verbergen sie im Eingang, in „Quellen“, im Chip und beim Download. Sie kommen beim Wiederherstellen mit zurück und werden erst beim endgültigen Löschen verworfen, dann sofort als geleerter Tombstone („Das Ticket wurde endgültig gelöscht.“, ohne Originaldatei, Fingerprint bleibt).
- **Wiederherstellen** verknüpft zurückgegebene Quellen nur, solange sie `new` ohne Ticket sind; sonst nennt das Ergebnis sie mit Grund. Der Löschschutz (§3, deleteRule `ticket = ""`, `validation_inbox_item_linked`) gilt unverändert, auch für Quellen im Papierkorb.
- Ein Duplikat, dessen Ticket im Papierkorb liegt, meldet „Schon umgewandelt.“ ohne Key; ein Ticket im Papierkorb ist kein Ziel für Verknüpfen oder Umhängen.
