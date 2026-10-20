# ADR-0074: Postausgang für Änderungen ohne Verbindung

- **Status:** Angenommen. Der Server-Teil ist umgesetzt (Paket OF-1, Migration `1790205000_client_ops.js`); Fälle im Test-Manifest BYL-E6-1930 bis BYL-E6-1949, manuelle Prüfungen BYL-E6-1948 und BYL-E6-1949. Der Client-Kern mit Abhaken und Status ist umgesetzt (Paket OF-2, Nachtrag unten); Fälle BYL-E6-2041 bis BYL-E6-2059, manuelle Prüfungen BYL-E6-2055 bis BYL-E6-2059. Tagesplan und Fälligkeit folgen in OF-3, ＋ und Kommentare in OF-4, die Stufe 2 in OF-5.
- **Datum:** 2026-10-20
- **Entscheidung durch:**
  - Nutzer: Wunsch „Reißt das VPN ab, sollen Änderungen trotzdem möglich sein und später automatisch eingespielt werden.“ Am 2026-10-20 hat er alle Produktfragen des Konzepts nach Empfehlung entschieden: CLAUDE.md §10 eng gelockert; nach 48 Stunden „Trotzdem übertragen“ oder „Verwerfen“, nach 7 Tagen gelöscht; Tagesplan ohne Ausnahme für vergangene Tage; Abmelden und Kontowechsel im Client; Stufe 2 später.
  - Advisor: Vorgaben (Aktionen statt Daten, normale Wege, Kennung je Aktion, ehrliche Historie, Konfliktdialog, Verfall, Umfang der Stufe 1) und Auftrag OF-1.
  - Executor: Konzept OF-0 (Bestandsaufnahme, Technik, Paketschnitt), Umsetzung und Tests von OF-1.
- **Bezug:** CLAUDE.md §10, [ADR-0028](0028-plattform-strategie.md) §1 (Nachtrag OF-1), [ADR-0035](0035-start-einstieg-und-offene-tabs.md) §8 (Nachtrag OF-1), [ADR-0040](0040-veroeffentlichen-ohne-unterbrechung.md) (Nachtrag OF-1), [ADR-0007](0007-realtime-und-sitzungspflege.md), [ADR-0032](0032-editor-tiptap-markdown.md) §6 (`expected_updated`), [ADR-0033](0033-unteraufgaben.md) §2, [ADR-0065](0065-tagesplan.md), [ADR-0069](0069-vollstaendiges-anlegen.md) (Fähigkeitsabfrage), [ADR-0070](0070-auf-unteraufgaben-uebertragen.md) §6, [ADR-0071](0071-fehlerdetails-und-sitzungsprotokoll.md), [ADR-0073](0073-smartphone-layout.md), [Plan Heimnetz](../plan/heimnetz.md)

## Kontext

BYLJ läuft am Handy über WireGuard und `http://<LAN-Adresse>:8090`, ohne sicheren Kontext und ohne Service Worker (ADR-0028, Nachtrag MO-1a). Reißt der Tunnel ab, scheitern Anfragen oder hängen ohne Zeitgrenze. Die App zeigt das je Aktion als „Server nicht erreichbar“, den Abriss einer bestehenden Realtime-Verbindung gar nicht. Ein Offline-Modus war ausgeschlossen (CLAUDE.md §10, ADR-0028 §1), weil Datenkopien veralten und zwei Wahrheiten entstünden.

Befund des Konzepts OF-0 (Stand `c582e1f9`):

- Die Aktionen der Stufe 1 laufen über die Record-API von `tickets`, `comments` und `inbox_items` und über die Routen `…/dayplan/items/{id}/check` und `…/uncheck`. Die Stores bekommen ihren Datenzugriff als Schnittstelle.
- `expected_updated` (ADR-0032 §6) vergleicht nur `updated` und meldet sich am Feld `description`.
- Manuelle Eingangseinträge, Kommentare und Tickets der Schnellerfassung haben keinen Schutz gegen doppeltes Anlegen. Eine abgebrochene Antwort heißt nicht, dass der Server nichts geschrieben hat.
- Ohne sicheren Kontext fehlen Service Worker, Background Sync, Web Locks, `crypto.randomUUID`, `crypto.subtle` und `navigator.storage.persist()`. IndexedDB, localStorage und BroadcastChannel gehen.

## Entscheidung

### 1. Postausgang statt Offline-Modus

- Die App merkt bei fehlender Verbindung einzelne **Aktionen** der Stufe 1 in IndexedDB, nie Kopien von Daten: Ticket abhaken bzw. Status, Haken im Tagesplan und dessen Zurücknehmen, Fälligkeit, „＋“ als Ticket oder Eingangseintrag, Kommentar (auch auf einem offline angelegten Ticket).
- Sie spielt sie später über **dieselben Wege** ein: Datenschicht, Record-API bzw. Route, Request- und Modell-Hooks, mit dem aktuellen Token desselben Kontos. Rechte, Bereiche und Prüfungen gelten zum Zeitpunkt des Abgleichs. Eine neue Route gibt es nicht.
- Es gibt keinen Kaltstart ohne Netz und keinen Abgleich im Hintergrund. Übertragen wird, solange die App offen ist.

### 2. Kennung je Aktion und Hauptbuch `client_ops`

- Jede Aktion trägt von Anfang an eine Kennung im Body-Feld `op_id`: 16 bis 64 Zeichen aus `A–Z`, `a–z`, `0–9`, `_` und `-`. Die SPA zieht 20 Zeichen a–z0–9 aus `crypto.getRandomValues`. Eine Kennung anderer Form lehnt der Server ab (`validation_op_invalid`).
- **`client_ops`** (Migration `1790205000_client_ops.js`): `user` (Kaskade), `op`, `kind` (die sechs Aktionen `ticket.create`, `ticket.update`, `comment.create`, `inbox.create`, `dayplan.check`, `dayplan.uncheck`), `record` (die ID des geschriebenen Datensatzes), `result` (nur die Routen des Tagesplans: `action` und `previous_status` ihrer Antwort) und `created`. Eindeutig je (`user`, `op`), alle API-Regeln `null`.
  - Abweichung vom Auftrag: `result` steht nicht in der Feldliste des Auftrags. Es ist nötig, weil sich Aktion und Status vorher einer Antwort des Tagesplans später nicht mehr ablesen lassen.
- **Belegt in derselben Transaktion wie die Änderung:**
  - Der Request-Hook merkt sich die Kennung als flüchtigen Schlüssel am Datensatz (`lib/client-ops.js`, reine Regeln `lib/client-ops-rules.js`).
  - Der Modell-Hook sucht sie in seiner Transaktion vor dem ersten Schreiben und trägt sie nach dem Schreiben ein. Bei Tickets ist das vor dem Zähler, bei Kommentaren öffnet er nur dafür eine Transaktion.
  - Die Routen des Tagesplans tun dasselbe in ihrer Transaktion.
  - Scheitert die Änderung, bleibt auch die Kennung frei.
- **Dieselbe Kennung desselben Kontos ein zweites Mal** schreibt nichts und antwortet wie beim ersten Mal:
  - Die Record-API antwortet mit dem Datensatz des ersten Mals im aktuellen Stand, mit `expand` und `fields` der Anfrage (`$apis.enrichRecord`, `e.json`).
  - Der Tagesplan antwortet mit Eintrag und Ticket im aktuellen Stand und mit Aktion und Status vorher des ersten Mals.
  - Sieht das Konto den Datensatz nicht mehr (Papierkorb, gelöscht), kommt 400 `validation_op_applied` mit `params` `{ record, kind }`.
  - Dieselbe Kennung für eine andere Aktion (andere Art oder anderer Datensatz) lehnt der Server mit `validation_op_reused` ab.
- **Gleichzeitiger Doppelversand:** PocketBase führt jede Transaktion auf seiner einen Schreibverbindung aus.
  - Die zweite Anfrage findet die Kennung der ersten in ihrer Transaktion, schreibt nichts und rollt zurück.
  - Ihr Request-Hook fängt das ab und antwortet wie oben.
  - Der eindeutige Index (`user`, `op`) ist das Sicherheitsnetz.
- **Je Konto:** Der Index gilt je Konto, `user` kommt aus dem Token. Ein anderes Konto mit derselben Kennung schreibt seine eigene Aktion und merkt nichts von der fremden.
- **Aufbewahrung:** 30 Tage nach `created`. Der Cron `byl-client-ops-cleanup` (täglich 11:50 UTC, nach dem Eingang und dem Papierkorb) löscht ältere Einträge. Der Client gibt eine Aktion nach 7 Tagen auf, der Server vergisst also nie eine, die noch kommen kann.
- **Vor der Migration** (neue Hooks, alte Instanz) tun die Hooks nichts davon. `op_id`, `offline`, `client_at` und `expected` werden ignoriert, alles verhält sich wie bisher.

### 3. Bedingte Änderung je Feld

- **Tickets:** Das Body-Feld `expected` nennt je geändertem Feld den Wert, auf dem die Aktion beruht, in der Form des Verlaufs (`history.serialize`; Tags als Menge). Erlaubt sind die Felder aus `TRACKED_FIELDS` (`lib/history.js`), sonst `validation_expected_invalid`.
  - Der Modell-Hook liest das Ticket **in der Transaktion neu**.
  - Ein Feld ist ein Konflikt, wenn sein gespeicherter Wert weder der erwartete noch der gewünschte ist (`conflictsOf`). Dann kommt 400 mit `validation_ticket_conflict` **an genau diesem Feld**, mit Text je Feld und `params` `{ expected, actual, updated }`. Nichts wird geschrieben, keine Kennung belegt.
  - Eine fremde Änderung an einem anderen Feld ist kein Konflikt. Derselbe Wunsch zweimal (beide erledigt) gilt als angekommen.
  - „Meine Änderung übernehmen“ sendet dieselbe Kennung mit dem neuen Stand als Erwartung.
- **Tagesplan:** `check` und `uncheck` nehmen `expected` mit `checked` (Bool, „erledigt in diesem Plan“) und `status`. Verglichen wird mit dem, was die Aktion will: Haken einer Aufgabe → `done`, Zurücknehmen → der gewählte Status, „nur für heute“ → keine Änderung des Status. Code am Feld `status` `validation_ticket_conflict`, am Feld `checked` `validation_dayplan_conflict`.
- **`expected_updated` bleibt** unverändert für Beschreibung und Kalender (ADR-0032 §6), auch neben `expected`.
- **Bewusst nicht erkannt:** ein Feld, das jemand geändert und wieder zurückgesetzt hat (ABA). Das ist selten und steht vollständig im Verlauf. Mit `updated` wäre es nur um den Preis vieler falscher Konflikte zu haben.

### 4. Gerätezeit und ehrliche Historie

- **Body-Felder:** `client_at` (ISO-Zeit des Geräts, mit `Z` oder Versatz) und `offline: true` (eine Aktion aus dem Postausgang ohne Zeit, „Trotzdem übertragen“ nach 48 Stunden). Beide werden nie selbst gespeichert. Jedes von beiden kennzeichnet die Aktion als offline.
- **Grenzen:** Die Zeit wird nur übernommen, wenn sie höchstens 5 Minuten nach und höchstens 48 Stunden vor der Serverzeit liegt (beide Grenzen eingeschlossen). Sonst wird sie verworfen, und die Aktion gilt trotzdem als offline.
  - 5 Minuten: Ein Android-Handy mit Netzzeit weicht um Sekunden ab. 5 Minuten lassen eine von Hand gestellte Uhr zu, nehmen aber keine Zeit aus der Zukunft an. Eine Aktion kann nicht nach ihrem Eintreffen geschehen sein.
  - 48 Stunden: So lange überträgt der Client selbst (Nutzerentscheidung 2).
- **Gespeichert:**
  - `ticket_history.offline` und `.device_at` an jedem Eintrag der Speicherung, auch für `created`, die mit erledigten Unteraufgaben und die Speicherungen aus dem Tagesplan.
  - `comments.offline` und `.device_at`. Der Request-Hook setzt beide immer selbst, beim Bearbeiten bleiben sie. Kein App-Konto schreibt sie direkt.
  - Eingangseinträge: `source_meta.offline = { device_at }`, nur vom Server. Ein Schlüssel `offline` aus dem Body fällt weg.
- **Maßgeblich bleibt die Serverzeit:** `created`, `completed_at` und `done_at` sind die Zeit des Abgleichs. Die Gerätezeit ordnet nichts und ändert keine Regel. Die Oberfläche zeigt sie immer als „offline um 14:03 (laut Gerät), abgeglichen um 14:30“ neben der Serverzeit. Das ist die eigene Entscheidung, die ADR-0070 §6 für eine neue Art von Angabe im Verlauf verlangt.

### 5. IDs vom Client

- **Befund für PocketBase 0.40.4** (Integrationstest `tests/integration/client-ops.test.mjs`): Die Record-API nimmt beim Anlegen ein `id` im Body an, auch von App-Konten, für `tickets`, `comments` und `inbox_items`.
  - Eine falsche Form lehnt sie am Feld `id` ab (`validation_min_text_constraint`, `validation_invalid_format`).
  - Eine schon vergebene ID lehnt sie ebenfalls am Feld ab (`validation_not_unique`), ohne eine Nummer des Zählers zu verbrauchen. Das Konzept hatte hier einen allgemeinen Fehler ohne Feldcode vermutet.
  - Die Antwort ist für ein fremdes Konto dieselbe. Sie sagt nur, dass die ID vergeben ist, nicht wem.
- **Gewählter Weg:** die endgültige ID schon im Client (Konzept 3.4). Ticket, Kommentar und Eingangseintrag bekommen beim Merken eine ID nach PocketBase-Art (15 Zeichen a–z0–9, etwa 77 Bit) und senden sie als `id`.
  - Der Kommentar auf einem offline angelegten Ticket verweist von Anfang an darauf. Eine Zuordnung vorläufig → endgültig entfällt.
  - Den Key (HAUS-13) vergibt erst der Server.
  - Vor dem Doppel schützt die Kennung, nicht die ID: Dieselbe Kennung mit derselben ID antwortet wie beim ersten Mal.

### 6. Fehlercodes

Katalog in `MESSAGES` von `lib/client-ops-rules.js`. Die SPA spiegelt ihn in OF-2 in `domain/offline.ts`, mit Paritätstest.

| Code | Feld | Bedeutung |
|---|---|---|
| `validation_op_invalid` | `op_id` | Die Kennung hat die falsche Form. |
| `validation_op_reused` | `op_id` | Das Konto hat die Kennung schon für eine andere Aktion verwendet. |
| `validation_op_applied` | `op_id` | Die Aktion kam schon an, ihr Datensatz ist aber nicht mehr sichtbar (`params` `{ record, kind }`). |
| `validation_expected_invalid` | `expected` | kein Objekt, ein unbekanntes Feld oder ein Wert falscher Art |
| `validation_ticket_conflict` | das Feld | Der Wert wurde inzwischen fremd geändert (`params` `{ expected, actual, updated }`). |
| `validation_dayplan_conflict` | `checked` | Der Haken wurde inzwischen fremd geändert. |

Alle sind echte Fehler einer Aktion im Sinne von ADR-0071 §1, keine Prüfungen einer Eingabe.

### 7. Fähigkeit `offline_ops`

- `GET /api/byl/tickets/create` (ADR-0069) nennt `offline_ops: { version: 1, kinds: [die sechs Aktionen] }`, sobald `client_ops` existiert, sonst `null`.
- Ein Server vor dem Neustart nach OF-1 kennt das Feld nicht. Fehlt es oder ist es `null`, merkt die SPA nichts und verhält sich wie heute.
- Version 1 sagt zu: `op_id`, `offline`, `client_at` und `expected` für die sechs Aktionen, die Antworten auf ein zweites Mal und die Codes aus §6.

### 8. Tagesplan über Mitternacht

- Der Server bleibt bei „vergangene Tage nur lesend“ (`validation_dayplan_readonly`) und macht keine Ausnahme (Nutzerentscheidung 3).
- Ein Haken, der vor Mitternacht ankam, antwortet auf ein zweites Mal auch danach wie beim ersten Mal. Die Kennung wird vor der Prüfung des Tages gesucht, nach der Sichtbarkeit des Eintrags.
- Einen neuen Haken für gestern lehnt der Server ab. Der Client erledigt dann in OF-3 das Ticket über den normalen Weg.

### 9. Client (OF-2 bis OF-4)

- **Verbindungsmonitor:** über `AppPocketBase.send`, eine Prüfung von `/api/health` und Realtime. Zeitgrenze 12 Sekunden je Schreibanfrage.
- **Postausgang:** in IndexedDB, mit Reihenfolge, Abhängigkeiten und Zusammenfassen. Die vorläufige Anzeige liegt als Überlagerung über dem Stand des Servers.
- **Mehrere Tabs:** Ein Tab mit Leihe sendet, BroadcastChannel hält die anderen gleich.
- **Verfall:** Bis 48 Stunden überträgt der Client selbst, mit Gerätezeit. Danach fragt er je Änderung „Trotzdem übertragen“ (ohne Gerätezeit, mit `offline: true`) oder „Verwerfen“. Nach 7 Tagen löscht er sie (Nutzerentscheidung 2).
- **Abmelden und Konten:** „Abmelden“ löscht nach Rückfrage. Ein Sitzungsende behält. Meldet sich ein anderes Konto an, werden die Aktionen gelöscht. Eingespielt wird nur mit dem Konto der Aktion (Nutzerentscheidung 4).
- **Ohne Verbindung:** Vor dem Neuladen fragt die App. Die Module der Offline-Ansichten lädt sie vor. Fehlerseite und neue Version laden offline nicht neu.

### 10. CLAUDE.md §10

Der Ausschluss „Offline-Modus“ lautet jetzt: „Kein Offline-Modus mit Datenkopie oder Kaltstart. Erlaubt ist ein Postausgang, der bei fehlender Verbindung einzelne Aktionen merkt und später über die normalen Wege einspielt (ADR-0074).“

## Alternativen

- **Daten offline vorhalten (Kopie in IndexedDB, Sync):** zwei Wahrheiten, Konflikte über alle Felder, widerspricht ADR-0028 §1. Verworfen.
- **Anfragen auf der Ebene von `send` merken:** keine Absicht, keine alten Werte, keine Anzeige, erfasst auch Ungeeignetes. Verworfen; `send` dient nur der Erkennung.
- **Eigene Route zum Einspielen:** atomar, baut aber Regeln und Request-Hooks nach. Verworfen zugunsten der normalen Wege.
- **Kennung als Feld am Datensatz:** taugt nur für Anlagen. Verworfen.
- **Nur die ID vom Client als Schutz vor Doppeln:** schützt keine Änderungen und keine Haken. Verworfen; die ID ergänzt die Kennung.
- **Antwort `validation_op_applied` auf jedes zweite Mal (Konzept 4.1):** Der Client müsste den Datensatz neu lesen und könnte nicht unterscheiden, ob er noch sichtbar ist. Verworfen; der Server antwortet wie beim ersten Mal und nutzt den Code nur, wenn der Datensatz nicht mehr sichtbar ist.
- **Konflikt über `updated`:** Jede fremde Änderung irgendeines Feldes wäre ein Konflikt. Verworfen für Offline-Aktionen.
- **Feldvergleich nur im Client:** Wettlauf zwischen Lesen und Schreiben, keine Erkennung am Server. Verworfen.
- **Gestern nachträglich abhaken:** Ausnahme von „vergangene Tage nur lesend“, hinge an der Uhr des Geräts. Verworfen (Nutzerentscheidung 3).
- **Service Worker mit App-Shell jetzt:** braucht HTTPS (MO-8).

## Konsequenzen

- OF-1 ändert Hooks und Migrationen: Ein Neustart ist nötig. Vorher meldet der Server die Fähigkeit nicht, und die App merkt nichts.
- OF-2 bis OF-4 sind nur SPA, nach dem Build genügt F5.
- Ohne die neuen Body-Felder verhalten sich alle Wege wie bisher. Kommentare antworten zusätzlich mit `offline` und `device_at`, Einträge des Verlaufs ebenso.
- Die Stores zeigen bei den Aktionen der Stufe 1 erstmals einen vorläufigen Stand. Das weicht von „keine optimistische Anzeige“ in Zellen und Kalender ab (OF-2).
- Auf dem Gerät liegen bis zu 48 Stunden (höchstens 7 Tage) unübertragener Änderungen unverschlüsselt. Die Bewertung steht in [sicherheit.md](../regeln/sicherheit.md).

## Grenzen

- Ohne HTTPS: kein Neuladen und kein Kaltstart offline, kein Abgleich bei geschlossenem Tab, Speicher räumbar.
- Konflikte, bei denen ein Feld geändert und zurückgesetzt wurde, erkennt die Prüfung je Feld nicht. Der Verlauf zeigt sie.
- Die Zeit des Geräts ist eine Angabe des Geräts, keine geprüfte Tatsache. Ein manipulierter Client kann innerhalb von 48 Stunden zurückdatieren.
- Ein „Vorhaben nur für heute“ hat keinen Eintrag im Verlauf. Seine Gerätezeit wird deshalb nirgends gespeichert.

## Nachtrag (2026-10-20, OF-2): Client-Kern mit Abhaken und Status

Nur Oberfläche, Tests und Doku, keine Hooks und keine Migration: nach dem Build F5. Wirksam erst nach dem Neustart aus OF-1, denn erst dann meldet der Server `offline_ops`. Entscheidung durch den Advisor (Auftrag OF-2 mit Abgrenzung zu OF-3 ff., Pflichtkriterium „ohne `offline_ops` wie heute“, die vorsichtigere Variante, wo das Konzept offenlässt), den Nutzer („alles nach Empfehlung“ für die Produktfragen des Konzepts) und den Executor (Umsetzung, Varianten, Tests). Umfang laut Konzept OF-0 §8: Verbindungsmonitor, Postausgang in IndexedDB mit Speicher für Tests, Abarbeiter mit Leihe, Backoff und Zeitgrenze, Abmelden und Sitzungsende, Kontowechsel, Verfall, `OfflineNotice`, Symbol mit Zahl, Dialog „Gemerkte Änderungen“ mit Konflikt und Ablehnung, „offline … laut Gerät“ im Verlauf, Frage vor dem Neuladen, `beforeunload`, Vorladen der Module, Fehlerseite und neue Version offline ohne Neuladen; erste Aktionen: Häkchen in „Aufgaben“ und Status in Zelle, Panel und Vollansicht.

### 1. Wann der Postausgang arbeitet (Schalter)

- **Neue Änderungen** nimmt er nur, wenn alles zusammenkommt: Der Server meldet `offline_ops` mit `ticket.update`, der Handy-Rahmen gilt (Schalter „Handy-Ansicht (Vorschau)“ an und unter 40rem, `MobileLayoutStore.active`, [ADR-0073](0073-smartphone-layout.md) §3), ein Konto ist angemeldet und IndexedDB ließ sich lesen. Sonst geht jede Änderung den Weg von heute, ohne Kennung, Zeitgrenze oder Hinweis.
- **Begründung:** Das Konzept sagt nicht, ob der Postausgang hinter einem Schalter läuft; es verlangt nur „Desktop unverändert, solange online“. Der Auftrag verlangt dann die vorsichtigere Variante. Gewählt ist der Schalter, den es schon gibt: Er ist je Gerät, standardmäßig aus, und der Nutzer hat entschieden, dass MO und OF am Stück hinter ihm ausgeliefert und mit einem Update eingeschaltet werden („je Gerät bewusst einschalten“, Statusdatei). Ein zweiter Schalter hätte eine weitere Einstellung ohne eigenen Zweck bedeutet. Am PC und ab 40rem ändert sich nichts, auch nicht mit Schalter. Das Einschalten für alle ist ein späteres eigenes Paket.
- **Gemerkte Änderungen** überträgt und zeigt die App auch, wenn der Rahmen nicht mehr gilt (das Handy quer, der Schalter aus), damit nichts hängen bleibt. Die Datenbank öffnet sie dann nur, wenn es sie schon gibt (`indexedDB.databases()`), und legt keine an.
- **Fähigkeit:** Das `(app)`-Layout fragt nach der Anmeldung einmal `GET /api/byl/tickets/create` (dieselbe Frage wie „Neues Ticket“, `offlineOps` in `toCreateSupport`), erneut, wenn der Tab wieder sichtbar wird und die Fähigkeit fehlte (ein Neustart des Servers inzwischen). Das ist die einzige neue Anfrage ohne `offline_ops`, auch am PC; sie ist nötig, damit der Verlauf beim Partner „offline … laut Gerät“ zeigen kann. Erst mit der Fähigkeit fragt der Verlauf `offline` und `device_at` ab (`historyFields`, `data/history-marks.ts`); vorher genau die Felder von bisher.

### 2. Gleicher Weg mit Verbindung, nur mit der Kennung

- Jede Änderung bekommt beim ersten Versuch ihre Kennung (Konzept §3.6), wird **vorher** in IndexedDB gemerkt (ein geschlossener Tab verliert nichts) und geht sofort hinaus, mit einer Zeitgrenze von 12 s. Der erste Versuch sendet **nur `op_id`**, kein `expected` und keine Gerätezeit: Eine Änderung mit Verbindung soll dasselbe Ergebnis und dieselben Meldungen haben wie bisher (mit `expected` lehnte der Server eine fremde Änderung dazwischen als Konflikt ab, heute überschreibt sie). Erst jeder spätere Versuch aus dem Postausgang sendet `client_at` und `expected`, nach „Trotzdem übertragen“ `offline: true` statt der Zeit.
- **Antwortet der Server**, gilt die Antwort wie heute: Erfolg, oder der Fehler geht an den Store und zeigt seine Meldung. **Antwortet er nicht** (Status 0, Zeitgrenze), bleibt die Änderung gemerkt, der Monitor prüft den Server, und der Store bekommt eine vorläufige Antwort. Kam die erste Anfrage doch an, macht die Kennung das zweite Mal harmlos (§2 oben).
- Ohne Verbindung (der Monitor weiß es) geht eine Änderung gar nicht erst hinaus. Liegt für dasselbe Ticket schon eine wartende Änderung vor, wird zusammengefasst (Konzept §3.3: `expected` der ersten, Wunsch der letzten; zurück zum Wert vorher löscht sie, so löscht „Rückgängig“ eines gemerkten Erledigens nur die gemerkte Änderung). Hinter einer laufenden oder auf eine Entscheidung wartenden steht eine neue mit `dependsOn` und dem Wunsch der vorigen als `expected`.

### 3. Speicher und Konto

- IndexedDB `byl-offline` Version 1 (`IdbOutboxStorage`, eigene kleine Hülle, keine Abhängigkeit; `MemoryOutboxStorage` für die Tests): Speicher `actions` (Schlüssel `op`, Indizes `byUserSeq` und `byTarget`) mit dem Format von Konzept §3.2, beschränkt auf `ticket.update` mit dem Status (dazu Key und Titel für Liste und Dialog statt `label`, die Antwort auf offene Unteraufgaben und deren IDs), `meta` mit `seq` und der Leihe. Gelesen wird jeder Eintrag geprüft (`parseAction`): einer ohne gültige Kennung oder Konto wird gelöscht, einer anderer Form als abgelehnt gezeigt und nie gesendet. Höchstens 200 Aktionen bzw. etwa 1 MB. Keine Kopie von Tickets, Listen, Tagesplan oder Eingang, kein Start ohne Verbindung.
- **Konto:** Jede Aktion trägt das Konto, das sie gemerkt hat; der Store liest nur dessen Aktionen. Meldet sich ein anderes Konto an, löscht er die Aktionen der anderen Konten beim Lesen (Entscheidung 4). „Abmelden“ (Kopfzeile und „Mehr“, über `setSignOut` des Layouts) fragt bei gemerkten Änderungen „Abmelden und 3 gemerkte Änderungen verwerfen?“ (`ConfirmDialog`, nicht rot, „Mehr“ schließt vorher) und löscht sie. Ein Sitzungsende (abgelaufenes Token, 401, Abmelden in einem anderen Tab) läuft über `auth.logout()` ohne diese Frage und behält sie; die Anmeldeseite nennt nur ihre Zahl („3 gemerkte Änderungen warten. Melde dich mit demselben Konto an, dann werden sie übertragen. Mit einem anderen Konto werden sie verworfen.“). `auth.logout()` blieb unverändert, die Trennung liegt beim Knopf.
- **Verfall:** Bis 48 Stunden sendet die App selbst; danach wartet die Änderung auf „Trotzdem übertragen“ oder „Verwerfen“, nach 7 Tagen löscht sie der nächste Start (Entscheidung 2).

### 4. Abarbeiten, Wiederholen, mehrere Tabs

- Ein `OutboxRunner` sendet eine Aktion nach der anderen in der Reihenfolge des Geräts, nur mit Leihe (8 s, alle 3 s verlängert, `meta.lease` in einer Transaktion als Vergleich mit Tausch); ein Tab ohne Leihe schaut nach deren Ablauf wieder. Eine Aktion „sending“ ohne Antwort nach 15 s gilt als verwaist und wieder als wartend. `BroadcastChannel` `byl-outbox` sagt den anderen Tabs nur „neu lesen“, ohne Werte; ohne Kanal liest ein Tab beim Sichtbarwerden neu. Die Tab-Kennung steht in `sessionStorage` `byl-outbox-tab`. Der erste Versuch direkt nach der Änderung braucht keine Leihe (er ist der Weg von heute); die Kennung macht ein doppeltes Senden harmlos.
- Auslöser: zurück online, neue Aktion, „Erneut versuchen“, Ablauf eines Backoffs; das Sichtbarwerden, der Fokus, `online` und eine neue Realtime-Verbindung lassen den Monitor prüfen bzw. melden eine Antwort.
- **Antworten** wie Konzept §3.7 (`verdictOf`): Erfolg löscht und zeigt die Antwort in Liste und Ticket; `validation_op_applied` gilt als angekommen, das Ticket wird neu gelesen; `validation_ticket_conflict` wartet als Konflikt; `validation_parent_open_children` fragt im Dialog „Unteraufgaben mit erledigen“ oder „Trotzdem erledigen“; andere Ablehnungen, 403 und 404 werden nie wiederholt; 401 behält die Aktion und beendet die Sitzung; 5xx geht in den Backoff (2, 5, 10, 30, 60 s ±20 %, nach fünf Fehlern „Übertragen gescheitert“ mit „Details“ und „Erneut versuchen“); keine Antwort schaltet den Monitor auf offline. Gesendet wird mit `withIntent('Gemerkte Änderung übertragen: HAUS-12 erledigt', …)`; ein Eintrag „Fehler dieser Sitzung“ entsteht nur für Konflikte, Ablehnungen und Fehler des Servers, nie, solange nur das Netz fehlt.
- **Monitor** (`ConnectivityStore`): ein Beobachter in `AppPocketBase.send` (`observeRequests`, nur solange der Postausgang arbeitet), `pb.realtime.onDisconnect` als Anlass, die Events `online`, `offline`, `focus` und `visibilitychange`. Geprüft wird `GET /api/health` außerhalb des SDK mit dem Token der Sitzung und 5 s; erst eine gescheiterte Prüfung heißt offline, danach nach 2, 5, 10, 30 s und alle 60 s. Arbeitet der Postausgang nicht, prüft er nichts und bleibt „online“.

### 5. Anzeige

- Die Stores halten den Stand des Servers und legen die wartenden Aktionen beim Hereinnehmen darüber (`TicketOverlay`: `upsert`, Laden, Abgleich der Liste, Laden und Ereignisse des Tickets); ein Abgleich entfernt ein Ticket nicht, das eine wartende Änderung offen hält. Das ist die Abweichung von „keine optimistische Anzeige“, die §9 oben ankündigt. Eine vorläufige Änderung bietet weder „Übertragen …“ noch das Angebot der Serie an; die kommen erst mit der Antwort des Servers.
- Marke `PendingMark` an Karte, Zeile, Kopf des Tickets und Unteraufgaben: Wolke mit Pfeil („cloud-upload“ aus Lucide), `title` „Noch nicht übertragen“ bzw. „Entscheidung nötig“, verborgener Text, keine eigene Farbe (`--color-text-muted`; `--color-text-subtle` aus dem Konzept gibt es in `tokens.css` nicht). Das Flag nach dem Abhaken sagt zusätzlich „Wird übertragen, sobald die Verbindung zurück ist.“ und behält „Rückgängig“.
- `OfflineNotice` über der Seite (statt `LiveUpdateNotice`, solange die Verbindung fehlt; nur, solange der Postausgang arbeitet oder etwas gemerkt ist), `OutboxButton` „Offline · 3“ in der oberen Leiste (Platz aus MO-1b), `OutboxDialog` „Gemerkte Änderungen“ (Modal M, im Rahmen ein Sheet). Der Konflikt nennt die eigene Änderung mit der Zeit des Geräts und den Stand des Servers; wer geändert hat, liest der Dialog aus dem Verlauf (`listHistory`), beim eigenen Konto heißt es „Der Status steht auf …“. „Verwerfen“ zeigt ein Flag mit „Rückgängig“. Texte der fehlenden Verbindung nennen nur „Abhaken und Status“, weil OF-2 nur diese merkt (das Konzept nennt alle Aktionen der Stufe 1).
- Verlauf: „offline um 14:03 (laut Gerät), abgeglichen um 14:30“, an einem anderen Tag mit Datum, ohne angenommene Zeit „offline geändert, abgeglichen um 14:30“ (Wortlaut „abgeglichen“ wie §4 oben; das Konzept §2.3 schreibt „übertragen“), bei jedem Konto und auf jedem Gerät.
- Ohne Verbindung sagt eine Anfrage, die nicht gemerkt wird, „Keine Verbindung. Das geht nur mit Verbindung, nichts wurde gemerkt.“ (`provideMissingConnection` in `data/errors.ts`); ein volles Gerät „Zu viele gemerkte Änderungen. Bitte erst wieder mit Verbindung weiterarbeiten.“.

### 6. Neuladen, Module, Fehlerseite, neue Version

- „Neu laden“ von `LiveUpdateNotice`, `AppUpdateNotice` und der Fehlerseite fragt ohne Verbindung mit gemerkten Änderungen „Ohne Verbindung neu laden?“ (`ConfirmDialog`, erster Fokus „Abbrechen“). Neuladen, Ziehen zum Aktualisieren und Schließen des Tabs fragen im Rahmen über `registerUnsavedInput` den Browser, solange die Verbindung fehlt und etwas gemerkt ist; außerhalb des Rahmens gibt es den Listener weiter nicht.
- Sobald der Postausgang arbeitet und der Server antwortet, lädt die App die Module von „Aufgaben“, Tagesplan, Eingang und dem Ticket in ihnen vor (`preloadCode`). Die Fehlerseite lädt ein fehlendes Modul ohne Verbindung nicht neu, sondern sagt „Diese Ansicht ist ohne Verbindung noch nicht geladen. Gemerkte Änderungen bleiben erhalten.“ mit „Zurück“. Eine neue Version lädt ohne Verbindung nicht beim nächsten Link.

### 7. Nicht umgesetzt oder später

- Tagesplan und Fälligkeit (OF-3), ＋ und Kommentare samt „Als Eingangseintrag sichern“ (OF-4).
- Der Abschnitt „Ohne Verbindung“ der Hilfe kommt wie die übrigen Hilfetexte der Handy-Ansicht mit dem Einschalten bzw. MO-7; solange der Postausgang nur hinter dem Vorschau-Schalter wirkt, bleibt die Hilfe des PC unverändert.
- Kein Server-Teil: OF-2 brauchte nichts an `app/pb_hooks` oder `app/pb_migrations`.

### 8. Tests

- Vitest: `domain/offline.test.ts` (Regeln), `offline/outbox.test.ts` (Ablauf, Wiederholung, jede Antwort, Zeit, Konto, zwei Tabs), `offline/connectivity.test.ts`, `offline/outbox-storage.test.ts`, `offline/offline-data.test.ts` und `data/outbox-fields.test.ts` (ohne Fähigkeit wie heute), `offline/offline-stores.test.ts` (Stores mit Postausgang), `components/offline/offline-components.test.ts`, `domain/history-offline.test.ts`, ein Fall in `history-list.test.ts`, `routes/error-page-offline.test.ts`, `routes/login/login-outbox.test.ts`; Parität mit dem Hook in `tests/unit/web-offline.test.mjs`. Die bestehenden Tests laufen unverändert; nur `licenses.test.ts` prüft zusätzlich `offline-icons.ts`.
- Smoke (`tests/mobile/phone-frame.spec.mjs`, zwei Fälle mit `context.setOffline`): Abhaken ohne Verbindung mit Marke, Flag und Symbol, Übertragen nach der Rückkehr mit `offline` und `device_at` am Server; Konflikt mit einem anderen Gerät im Dialog und „Meine Änderung übernehmen“. IndexedDB, `databases()` und die Events des Browsers prüft nur dieser Test, jsdom hat sie nicht.

### 9. Grenzen

- Ob Chrome für Android bei `beforeunload` eine Frage zeigt, ist nur am Gerät zu sehen (manueller Fall).
- Ein Abbruch des VPN lässt Anfragen oft hängen statt scheitern; die App merkt die Änderung dann nach 12 s.
- Gemerkte Änderungen sieht nur das Gerät, das sie gemerkt hat.
