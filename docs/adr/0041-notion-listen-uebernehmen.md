# ADR-0041: Notion: bestehende Listen nur lesend als Kopien in den Eingang übernehmen

- **Status:** Angenommen und umgesetzt in zwei Paketen nach [docs/plan/notion-import.md](../plan/notion-import.md): NI-1 (Server, Routen, Tests gegen einen Fake der Notion-API) und NI-2 (Karte, Assistent, Import-Dialog, „Erneut abrufen“, Hilfe). Test-Manifest BYL-E6-520 bis BYL-E6-538; die manuellen Browser-Prüfungen BYL-E6-539 bis BYL-E6-547 sind offen. Ergänzt durch den [Nachtrag vom 2026-09-30](#nachtrag-2026-09-30-rückmeldung-und-laufzeiten-beim-import) (Rückmeldung und Laufzeiten beim Import, BYL-E6-560 bis BYL-E6-565, manuell BYL-E6-566 offen) und den [Nachtrag vom 2026-10-01](#nachtrag-2026-10-01-mehrere-quellen-alle-erneut-abrufen-unterseiten-und-mehrere-verbindungen) (mehrere Quellen, „Alle erneut abrufen“, Unterseiten, mehrere Verbindungen; NI-3, BYL-E6-860 bis BYL-E6-865, manuell BYL-E6-866 bis BYL-E6-868 offen).
- **Datum:** 2026-09-29
- **Entscheidung durch:** Nutzer („Da wir bislang nur mit Kopien gearbeitet haben, sollten wir das auch hier beibehalten: Variante 1 soll es sein. Notion nur nutzen, um andere bestehende Listen auf deren Inhalt hin zu übernehmen.“, 2026-09-29), Advisor (fachliche Vorgaben: Zugang, Quellen, Ablauf, Eingang, Doku), Executor (API-Version, Abfrageweg, Grenzen, Einzelheiten)
- **Ersetzt:** [ADR-0016](0016-kanal-architektur-und-mail.md) §2, Absatz „Notion (zurückgestellt)“ (Abruf per Cron alle 15 Minuten mit Cursor), siehe Nachtrag dort
- **Ergänzt:** [ADR-0014](0014-datenmodell-eingang.md) (Kanal `notion`, Fingerprint `notion|<ID>` seit E4), [ADR-0018](0018-secrets.md) (Token als `BYL_*`-Variable), [ADR-0020](0020-stichwoerter-pro-kanal.md) §4 (manuelle Übernahme ohne Stichwort), [ADR-0031](0031-herkunft-sichern.md) (Kopie, Originaldatei, Tombstone), [ADR-0032](0032-editor-tiptap-markdown.md) §1 (Markdown des Projekts), [ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §2 und §5 (Auswahl, „Datum als Fälligkeit“)
- **Bezug:** [ADR-0011](0011-roadmap-e3-bis-e7.md) §2 (externe Dienste nur mit ADR und Freigabe), [ADR-0019](0019-kanal-filter-und-gruppierung.md) (Familie „Notion“), [ADR-0025](0025-ui-konsistenz-overlay-system.md), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) §3 und §4 (Karten, Assistent), [ADR-0009](0009-fehlerfarbe.md)

## Kontext

Notion stand seit E4 als letzter Kanal auf der Liste des Nutzers und war zurückgestellt. Der alte Entwurf ([ADR-0016](0016-kanal-architektur-und-mail.md) §2, [E4-Plan](../plan/e4.md) Paket 18) sah einen laufenden Abruf per Cron vor. Der Nutzer will Notion nicht als laufenden Kanal, sondern um **bestehende Listen einmal zu übernehmen**, und wie überall nur als **Kopie**.

### Befunde zur Notion-API (offizielle Doku, Stand 2026-09-29)

| Thema | Befund | Quelle |
|---|---|---|
| Version | Aktuell ist `Notion-Version: 2026-03-11`; der Header ist Pflicht. Brüche gegenüber `2025-09-03`: `archived` heißt überall `in_trash`, Append Block Children nimmt `position` statt `after`, der Block `transcription` heißt `meeting_notes`. | [Versioning](https://developers.notion.com/reference/versioning), [Changes by version](https://developers.notion.com/reference/changes-by-version), [Upgrade 2026-03-11](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11) |
| Datenbanken | Seit `2025-09-03` ist eine Datenbank ein Behälter für eine oder mehrere **Datenquellen** (data sources). Schema und Zeilen gehören zur Datenquelle: `GET /v1/data_sources/{id}` (Eigenschaften, Titel, `parent.database_id`), Zeilen mit `POST /v1/data_sources/{id}/query` (`page_size` bis 100, `start_cursor`, `sorts`, höchstens 10 000 Ergebnisse je Abfrage). Der alte Weg `POST /v1/databases/{id}/query` gilt nicht mehr. | [Upgrade 2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03), [Query a data source](https://developers.notion.com/reference/query-a-data-source), [Data source](https://developers.notion.com/reference/data-source) |
| Suche | `POST /v1/search` mit `filter: { property: "object", value: "page" \| "data_source" }` (vorher `database`), `query` für den Titel, `sort` nach `last_edited_time`, Paginierung wie oben. Die Suche liefert auch die Zeilen von Datenbanken als Seiten, ist nicht sofort aktuell und garantiert nur direkt freigegebene Objekte; Notion empfiehlt dafür einen Knopf zum erneuten Suchen. | [Search](https://developers.notion.com/reference/post-search), [Search optimizations and limitations](https://developers.notion.com/reference/search-optimizations-and-limitations) |
| Seiten und Blöcke | `GET /v1/pages/{id}` (Eigenschaften, `url`, `in_trash`), `GET /v1/blocks/{id}/children` (nur die erste Ebene; Kinder über `has_children` einzeln nachladen). Listenpunkte: `to_do` (mit `checked`), `bulleted_list_item`, `numbered_list_item` (mit `list_start_index`). Nicht unterstützte Blöcke kommen als `unsupported`. | [Retrieve block children](https://developers.notion.com/reference/get-block-children), [Block](https://developers.notion.com/reference/block), [Page](https://developers.notion.com/reference/page) |
| Status | Eine Status-Eigenschaft hat immer die drei Gruppen „To-do“, „In progress“ und „Complete“ mit den IDs ihrer Optionen. | [Property object](https://developers.notion.com/reference/property-object) |
| Grenzen | Im Mittel 3 Anfragen je Sekunde je Integration (180 je Minute); 429 `rate_limited` mit `Retry-After` in Sekunden, danach Pause; 529 ebenso. | [Request limits](https://developers.notion.com/reference/request-limits), [Status codes](https://developers.notion.com/reference/status-codes) |
| Fehler | 400 (u. a. `validation_error`, `missing_version`), 401 `unauthorized` (Token ungültig), 403 `restricted_resource` (Fähigkeit fehlt), 404 `object_not_found` (gibt es nicht **oder nicht freigegeben**), 409, 429, 5xx. | [Status codes](https://developers.notion.com/reference/status-codes) |
| Zugang | Eine **interne Integration** (in der Doku von 2026 „internal connection“) legt ein Workspace Owner im Developer-Portal an (`https://app.notion.com/developers/connections` → „Internal connections“ → „Create a new connection“); das API-Token (`ntn_…`) steht im Tab „Configuration“. Sie ist ein eigener Bot und sieht **nur**, was ihr freigegeben wird (Tab „Content access“ → „Edit access“ oder in der Seite „•••“ → „Connections“ → „+ Add connection“), vererbt auf Unterseiten. Fähigkeiten: „Read content“, „Update content“, „Insert content“, Kommentare, Benutzerinformationen (keine, ohne E-Mail, mit E-Mail). Ohne Benutzerinformationen tragen Personen keinen Namen. Ob eine Integration Schreibrechte hat, lässt sich über die API nicht abfragen. | [Internal connections](https://developers.notion.com/guides/get-started/internal-connections), [Capabilities](https://developers.notion.com/reference/capabilities), [Handling API keys](https://developers.notion.com/guides/get-started/handling-api-keys) |
| Alternativen | Persönliche Zugriffstoken (PAT) handeln als der Nutzer mit allen seinen Rechten und laufen ab. `GET /v1/pages/{id}/markdown` liefert „Enhanced Markdown“ mit XML-artigen Tags, Farben und Tabs. | [Personal access tokens](https://developers.notion.com/guides/get-started/personal-access-tokens), [Enhanced markdown](https://developers.notion.com/guides/data-apis/enhanced-markdown) |

## Entscheidung

### 1. Nur lesen, nur Kopien, nur auf Anstoß

- Notion wird **nur gelesen**. Die App schreibt nie nach Notion, meldet nichts zurück und gleicht nichts in zwei Richtungen ab.
- Jeder übernommene Punkt ist eine **Kopie** im Eingang mit Link zurück zur Notion-Seite bzw. zum Block. Änderungen in Notion wirken nicht auf die Kopie, Änderungen in der App nicht auf Notion.
- Übernommen wird **nur auf Anstoß** des Nutzers: im Import-Dialog oder mit „Erneut abrufen“ an einer schon übernommenen Quelle. Es gibt keinen Cron-Job, keinen Abruf beim Start und keine Webhooks.
- Ziel ist immer der **Eingang**. Tickets entstehen nur über die bestehenden Wege dort (Umwandeln, „Gesammelt umwandeln“, Verknüpfen).

### 2. Zugang

- Der Nutzer legt eine **interne Integration** an, gibt ihr die Fähigkeit **„Read content“** und schaltet „Update content“, „Insert content“ und die Kommentar-Fähigkeiten aus. Für Personen mit Namen darf sie zusätzlich „Benutzerinformationen ohne E-Mail-Adressen lesen“; ohne das nennt der Import nur die Zahl der Personen. Er gibt ihr gezielt einzelne Seiten oder Datenbanken frei.
- Das Token liegt wie alle Zugangsdaten nur als **Benutzervariable** von Windows vor, Vorschlag `BYL_NOTION_TOKEN` ([ADR-0018](0018-secrets.md)); die Verbindung (`connections.type = notion`, seit E4 in der Werteliste) speichert nur ihren Namen in `secret_env`, `settings` bleibt leer. Die App sieht eine neue Variable nach `neu-starten.bat` (ADR-0039).
- Das Token verlässt den Server nie: Alle Anfragen an Notion laufen aus den Hooks (`$http.send`), nie aus dem Browser.

### 3. API

- Fester Host `https://api.notion.com`, `Notion-Version: 2026-03-11`, `Authorization: Bearer <Token>`.
- **Nur lesende Endpunkte**, in `app/pb_hooks/lib/notion-client.js` als einzige Funktionen vorhanden: `GET /v1/users/me`, `POST /v1/search`, `GET /v1/data_sources/{id}`, `POST /v1/data_sources/{id}/query`, `GET /v1/pages/{id}`, `GET /v1/blocks/{id}/children`. Suche und Abfrage sind POST, ändern aber nichts. Ein Endpunkt, der schreibt, existiert im Code nicht.
- **Paginierung** vollständig mit `page_size` 100 und `start_cursor`, bis zu den Grenzen in §6. Zeilen in der Reihenfolge ihrer Anlage (`sorts` nach `created_time`), damit Vorschau und Import dieselbe Reihenfolge sehen; Quellen zuletzt bearbeitet zuerst.
- **Drosselung:** höchstens etwa 3 Anfragen je Sekunde (350 ms Abstand über eine Marke im Store der App, für alle Anfragen des Servers).
- **Wiederholung:** 429 und 529 nach `Retry-After` (ganze Sekunden, sonst 1, 2, 4 s), höchstens dreimal und nur bis 30 s Wartezeit; 500, 502, 503, 504 zweimal nach 1 und 2 s; alles andere nicht. Zeitlimit 30 s je Anfrage, Antworten über 20 MB werden verworfen. Seit dem Nachtrag vom 2026-09-30 gilt dazu eine Frist je Anfrage der App (90 s), in der alle Versuche und Wartezeiten liegen müssen.
- **Fehler** als deutscher Text ohne Token (`notion-rules.failureOf`): 401 „Notion lehnt den Token ab (401). Stimmt der Wert von BYL_NOTION_TOKEN? …“, 403 „… Read content …“, 404 „nicht freigegeben oder gelöscht (404) … „•••“ → „Verbindungen“ …“, 429 „bremst gerade …“, 5xx „gerade nicht verfügbar“, keine Antwort „nicht erreichbar“. Ob ein Fehler die **Verbindung** betrifft (Token, Rechte) oder nur eine **Quelle** (404/403 einer Seite, 429, 5xx), steht in der Antwort (`reason`).
- **Test:** Nur mit der Marke des Testmodus, die allein ein Hook der Tests setzt (`tests/fixtures/pb_hooks/test-mode.pb.js`, nie Teil des App-Ordners), nimmt der Client statt `api.notion.com` den Port aus `BYL_TEST_NOTION_PORT` auf `127.0.0.1`. Der Harness setzt ihn für jede Wegwerf-Instanz auf einen geschlossenen Port; keine Testinstanz erreicht Notion. Eine gleichnamige Variable im Konto des Nutzers ändert nichts.

### 4. Quellen und was daraus wird

- **Quellen** sind die freigegebenen **Datenquellen** (Datenbanken) und **Seiten** aus der Suche; Zeilen von Datenbanken, Objekte im Papierkorb und alles Nichtfreigegebene nicht. Ein Suchbegriff (`?q=`) grenzt nach Titel ein, weil die Suche Zeilen mitliefert und bei großen Arbeitsbereichen die Seiten sonst hinter den Grenzen verschwinden können.
- **Datenbank:** Jede Zeile wird ein Eintrag der Art `task` („Aufgabe“).
  - Titel aus der Titel-Eigenschaft („Ohne Titel“, wenn leer).
  - Die **erste Datums-Eigenschaft** des Schemas, oder die im Dialog gewählte, oder keine, wird `source_date`: ein Datum ohne Uhrzeit ganztägig ab Berliner Mitternacht mit `source_meta.all_day`; mit Uhrzeit und Offset der Zeitpunkt; ohne Offset Berliner Zeit bzw. in einer anderen Zeitzone nur der Tag (keine Zeitzonendaten in der JSVM, CLAUDE.md §3).
  - Die übrigen Eigenschaften stehen als Markdown-Liste im Text (`- **Status:** In Arbeit`): Text, Zahl, Auswahl, Mehrfachauswahl, Status, Datum (auch Zeiträume), Personen (Namen oder Zahl), Kontrollkästchen (ja/nein), URL und E-Mail als Link, Telefon, Formel, Anzahl der Relationen, Rollup (Zahl, Datum), Dateinamen, eindeutige ID. Erstellt/Bearbeitet von und am, Schaltflächen, Verifizierung und Ort entfallen.
- **Seite mit Listen:** Jeder Punkt einer To-do-, Aufzählungs- oder nummerierten Liste wird ein Eintrag der Art `todo` („To-do“), auch in Umschaltern, Spalten, Hinweisen, Zitaten, synchronisierten Blöcken und einklappbaren Überschriften.
  - **Verschachtelte Punkte** und anderer Inhalt unter einem Punkt werden **Text des Elternpunkts** (Markdown, eingerückt), keine eigenen Einträge. Begründung: In Notion sind sie meist Teilschritte oder Details; als eigene Einträge verlören sie ihren Zusammenhang, und Unteraufgaben ([ADR-0033](0033-unteraufgaben.md)) entstehen erst beim Umwandeln durch den Nutzer.
  - Der Titel ist der Text des Punkts als Klartext; Formatierung, Links, Zeilenumbrüche und Texte über 200 Zeichen stehen zusätzlich vollständig im Text.
  - Die erste **Datumserwähnung** im Punkt („@15. Oktober“) wird `source_date`.
  - Die Überschrift bzw. der Umschalter darüber ist der **Abschnitt** (`source_meta.notion.section`, in der Vorschau sichtbar).
  - Leere Punkte fallen weg (gezählt), Unterseiten und eingebettete Datenbanken sind eigene Quellen und werden nicht gelesen.
- **„Erledigte überspringen“** (Standard an): abgehakte To-dos; bei Datenbanken eine Status-Eigenschaft in der Gruppe „Complete“ (ersatzweise die letzte Gruppe bzw. Namen wie „Erledigt“, „Done“), sonst ein Kontrollkästchen mit einem Namen wie „Erledigt“/„Done“ oder das einzige Kontrollkästchen, sonst eine Auswahl namens „Status“ mit einem solchen Wert. Ohne passende Eigenschaft gilt keine Zeile als erledigt.

### 5. Einträge im Eingang

- Kanal `notion` (Familie „Notion“, [ADR-0019](0019-kanal-filter-und-gruppierung.md)), `connection` = die Verbindung, `source_url` = Link zur Notion-Seite (Zeile) bzw. zur Seite mit Anker des Blocks (Punkt), `source_ref` = die Notion-ID (Seite oder Block) in kanonischer Form.
- **Duplikate:** Der Fingerprint `notion|<ID>` besteht seit E4 ([ADR-0014](0014-datenmodell-eingang.md) §3). Derselbe Punkt kommt nur einmal, ein verworfener bleibt als Tombstone draußen, auch nach der Bereinigung ([ADR-0031](0031-herkunft-sichern.md)). Vorschau und Import nennen „Schon im Eingang.“, „Schon verworfen.“ bzw. „Schon Ticket HAUS-12.“.
- **Kopie** nach [ADR-0031](0031-herkunft-sichern.md): Text als Markdown des Projekts ([ADR-0032](0032-editor-tiptap-markdown.md): `**`, `*`, `~~`, `++`, `` ` ``, GFM-Aufgaben `- [ ]`/`- [x]` nur in Aufzählungen, Tabellen als GFM; Links nur http(s) und mailto; jedes Zeichen maskiert, das Markdown sonst läse). Originaldatei `notion.json` mit dem, was Notion für den Eintrag lieferte (Seite bzw. Block samt Kindern, bei kopiertem Seiteninhalt die Blöcke), höchstens 25 MB; darüber ohne Datei mit `source_meta.original_omitted = "too_large"` und `original_size`.
- **Kopie-Status** in `source_meta.notion.content`: `complete` (Punkt mit seinem Inhalt, Zeile mit ganzem Seiteninhalt), `properties` (Zeile ohne Seiteninhalt), `truncated` (an einer Grenze gekürzt). Die Oberfläche zeigt `properties` und `truncated` als „Nur Text“ mit einem Hinweis, was fehlt.
- `source_meta.notion` hält außerdem Quelle (`source_id`, `source_type`, `source_title`, `source_url`), Objekt (`page`/`block`, `block_type`), `date_property` und `copy` (Seiteninhalt mitgenommen). Das ist die Grundlage für „Erneut abrufen“ (§7).
- Ein manueller Import zählt als `manual`: Die Stichwörter gelten nicht, weil der Nutzer bewusst auswählt ([ADR-0020](0020-stichwoerter-pro-kanal.md) §4).

### 6. Seiteninhalt als Kopie und Grenzen

- Option „Seiteninhalt als Kopie mitnehmen“ (Standard aus), nur für Datenbanken: Der Inhalt der Zeilenseite kommt als Markdown nach einer Linie (`---`) unter die Eigenschaften.
- Grenzen je Seite: 500 Blöcke, 50 000 Zeichen, 40 Anfragen, Tiefe 8. Darüber endet der Text mit „_Seiteninhalt gekürzt: … Vollständig in Notion._“. Dateien, Bilder und PDFs aus Notion stehen nur mit Namen im Text: Ihre Adressen sind signiert und laufen nach einer Stunde ab. Externe Medien und Lesezeichen bleiben Links.
- Grenzen je Quelle: 1 000 Zeilen einer Datenbank; beim Lesen einer Seite 100 Anfragen, 5 000 Blöcke, Tiefe 8; in der Quellenliste je 500 Datenquellen und Seiten (die Suche liest dafür bis zu 1 000 Seiten, weil Zeilen mitkommen); 100 Einträge je Import-Anfrage (die Oberfläche teilt größere Auswahlen auf und zeigt den Fortschritt; mit Seiteninhalt schickt sie höchstens 10 je Anfrage, weil jede Zeile dann bis zu 40 Anfragen an Notion braucht; kleinere Blöcke seit dem Nachtrag vom 2026-09-30). Eine gekürzte Quelle sagt das in der Vorschau.

### 7. Routen, Zustand der Verbindung und „Erneut abrufen“

- `app/pb_hooks/notion.pb.js`, Logik in `lib/notion-service.js`, reine Regeln in `lib/notion-rules.js` und `lib/notion-markdown.js`. Alle Routen nur angemeldet (`users`) und nur für eine sichtbare Notion-Verbindung (viewRule, sonst 404):
  - `POST /api/byl/connections/{id}/notion/check` („Verbindung prüfen“): Bot und Arbeitsbereich, ob etwas freigegeben ist.
  - `GET …/notion/sources?q=`: freigegebene Datenquellen und Seiten.
  - `GET …/notion/imports`: bisher übernommene Quellen, aus dem Eingang, ohne Anfrage an Notion.
  - `POST …/notion/preview` mit `{ source: { type, id }, date_property? }`: Einträge mit Titel, Datum, Kurztext, Abschnitt, Erledigt und Zustand im Eingang; speichert nichts.
  - `POST …/notion/import` mit `{ source, refs, skip_done, copy_content, date_property? }`: je Eintrag angelegt, schon vorhanden, übersprungen oder Fehler. Der Server liest die Quelle dafür selbst neu und nimmt vom Browser nur IDs, keine Inhalte.
- Fehlende Variable (`missing`) und pausierte Verbindung (`disabled`) antworten 200 mit ihrem Zustand, ein Fehler von Notion 200 mit `status: "error"`, Meldung und `reason`; ungültige Eingaben 400.
- **Zustand an der Verbindung:** `last_run_at` bei jeder Anfrage an Notion, `last_ok_at` und leeres `last_error` nach Erfolg. `last_error` bekommt nur einen Fehler der Verbindung (Token, Rechte); „Verbindung prüfen“ speichert jeden Fehler. `last_hint` sagt „Die Integration sieht noch keine Seite …“, solange nichts freigegeben ist. So zeigen Karte und Assistent den Zustand aus Fakten des Servers (ADR-0026 §4).
- **„Erneut abrufen“** holt die Vorschau der Quelle und übernimmt nur Einträge, die noch nicht im Eingang sind, mit „Erledigte überspringen“ und den Optionen des letzten Imports (Datums-Eigenschaft, Seiteninhalt). Welche Quellen schon übernommen wurden, **folgt aus dem Eingang** (`source_meta.notion` der Einträge dieser Verbindung, gruppiert per SQL): keine neue Spalte, keine Migration, und die Liste kann nicht von den Einträgen abweichen (wie [ADR-0031](0031-herkunft-sichern.md) §1). Eine Quelle, deren Einträge alle vor mehr als 30 Tagen verworfen wurden, verschwindet aus der Liste (die Tombstones haben keine Details mehr); ihre Punkte bleiben trotzdem gesperrt.

### 8. „Datum als Fälligkeit“

Das Datum eines Notion-Eintrags ist ein Datum der Liste (Fälligkeit, Termin), kein Sende- oder Empfangszeitpunkt. Deshalb gilt es wie das eines Termins: „Gesammelt umwandeln“ mit „Datum des Termins als Fälligkeit“ und „Datum der Quelle übernehmen“ nehmen es, „Als Fälligkeit übernehmen“ im Formular ohnehin ([ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §5, Nachtrag dort mit NI-2). Nie automatisch (P-5).

### 9. Oberfläche (NI-2)

- Einstellungen → Kanäle: Katalog-Kachel „Notion (Listen übernehmen)“ und der **Assistent** (Stepper, [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) §4): Integration anlegen (nur „Read content“) → Token als Variable → Verbindung anlegen → Neustart → Seiten freigeben → „Verbindung prüfen“. Die Karte der Verbindung zeigt Zustand, zuletzt geprüft, die bisher übernommenen Quellen mit „Erneut abrufen“ und „Listen übernehmen …“.
- **Import-Dialog:** Quelle wählen (Suche, „Liste aktualisieren“), Vorschau mit Auswahl nach [ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §2 (Kopf-Checkbox, Umschalt+Klick), Optionen, „In den Eingang übernehmen“ mit Fortschritt und Ergebnis. Kein Dialog aus einem Dialog.
- Hilfe-Abschnitt „Notion“, Symbol und Kennzeichnung des Kanals wie bei den anderen.
- Umgesetzt mit NI-2, Einzelheiten im [Plan](../plan/notion-import.md) §4: eigene Karte (`NotionCard`) statt der allgemeinen Kanal-Karte, weil Notion nichts von selbst abruft (kein „Jetzt abrufen“, kein „Pausieren“, keine Stichwörter, keine Warnung wegen fehlender Stichwörter); „Alle Kanäle jetzt abrufen“ lässt Notion aus; Quellen und Einträge als Listen mit Checkboxen statt als Tabelle; der Assistent schließt sich, bevor der Import-Dialog aufgeht.

### 10. Sicherheitsmodell

- **Kleinste Rechte:** nur „Read content“ und nur freigegebene Seiten. Der Code der App kennt keinen schreibenden Endpunkt; ein Test prüft am Fake-Server, dass nur die sechs lesenden Anfragen ankommen. Ob die Integration mehr darf, kann die App nicht sehen; der Assistent sagt deshalb ausdrücklich, was ausgeschaltet sein soll.
- **Token:** nur als Benutzervariable, gelesen im Moment der Anfrage, nur im Header an den festen Host. Nie in Antworten, Realtime, `last_error`, Logs oder Originaldateien. Fehlertexte sind feste deutsche Texte mit Status und Code von Notion; `secrets.redact` ersetzt zusätzlich den Wert und jedes `ntn_…`/`secret_…`-Muster. Tests belegen das für Antworten, gespeicherte Verbindungen, `/api/logs` und die Konsole.
- **Kein SSRF:** Die Adresse ist fest. IDs aus Anfragen gehen erst nach der Prüfung auf 32 Hex-Ziffern in einen Pfad, Cursor nur URL-kodiert. Der Umweg auf `127.0.0.1` besteht nur im Testmodus.
- **Zugriff:** Nur wer die Verbindung sehen darf, kann sie nutzen; Einträge gehören dem Besitzer der Verbindung. Der Browser schickt nur IDs; Inhalte liest der Server selbst.
- **Inhalte sind nicht vertrauenswürdig:** Der Markdown enthält kein HTML (maskiert), Links nur http(s) und mailto, die Anzeige läuft wie bei jedem Kanal über `Markdown.svelte` mit DOMPurify ([ADR-0008](0008-markdown-rendering-und-sanitizing.md)). Signierte Datei-Adressen von Notion werden nicht gespeichert.
- **Logs** nennen Verbindung und Fehler, nie Inhalte.

## Alternativen

- **Laufender Abruf per Cron** (der alte Entwurf, Polling alle 15 Minuten mit Cursor auf `last_edited_time`): Der Nutzer will bestehende Listen übernehmen, nicht laufend abgleichen. Er bräuchte Stichwörter, damit nicht jede Änderung in den Eingang läuft, verursacht Last ohne Nutzen und würde bearbeitete Kopien nachziehen wollen. Verworfen.
- **Zwei-Wege-Abgleich** (Status und Erledigt zurück nach Notion): braucht „Update content“, Konfliktregeln und eine dauerhafte Zuordnung; widerspricht der Nutzerentscheidung „nur Kopien“. Verworfen.
- **Webhooks:** Der Server hört nur auf `127.0.0.1` und ist aus dem Internet nicht erreichbar ([ADR-0016](0016-kanal-architektur-und-mail.md), Alternativen); ein Tunnel wäre ein neuer Dienst. Verworfen.
- **Rückmeldung** („in becauseyoulovejira übernommen“ als Kommentar, Eigenschaft oder Haken): braucht Schreib- oder Kommentarrechte und ändert die Quelle. Verworfen.
- **Persönliches Zugriffstoken (PAT):** sieht alles, was der Nutzer sieht, statt nur Freigegebenes, und läuft ab. Verworfen zugunsten der internen Integration.
- **Markdown-Endpunkt von Notion** (`GET /v1/pages/{id}/markdown`): Notion-eigenes Markdown mit XML-artigen Tags, Farbattributen und Tabs, das die Anzeige nicht kennt und der Editor nicht bearbeiten könnte; die Umsetzung wäre ein zweiter Parser. Verworfen zugunsten der Blöcke und einer eigenen, getesteten Umsetzung.
- **Import im Browser:** Das Token läge im Browser, und CORS verhindert Aufrufe der API. Verworfen.
- **Liste der übernommenen Quellen als neues Feld** (Migration an `connections`): Sie folgt aus den Einträgen; ein zweites Feld könnte davon abweichen. Verworfen.
- **Migration für den Kanalwert `notion`:** unnötig, `inbox_items.channel`, `tickets.source` und `connections.type` kennen ihn seit E4 (Migrationen `1790201200`, `1790201210`, `1790201400`, erhalten in `1790202400`); ein Rückweg, der den Wert entfernt, würde E4 zurückdrehen.

## Konsequenzen

- Keine Migration. Neue Hooks wirken nach einem Neustart der App (`neu-starten.bat`), die Oberfläche nach F5.
- Die App stellt eine weitere Verbindung ins Internet her, nur auf Anstoß. Ohne Internet meldet der Import „nicht erreichbar“; der Rest der App ist unberührt.
- Grenzen, die der Nutzer sieht: höchstens 1 000 Zeilen je Datenbank und 500 Blöcke bzw. 50 000 Zeichen Seiteninhalt je Zeile; die Suche findet frisch freigegebene Seiten manchmal erst nach einem Moment („Liste aktualisieren“); Personen ohne Benutzerinformationen nur als Zahl; Zeitangaben in fremden Zeitzonen ohne Offset nur als Tag; eine interne Integration kann nur ein Workspace Owner anlegen.
- Änderungen in Notion nach dem Import erreichen die Kopie nicht; „Erneut abrufen“ holt nur Punkte, die neu sind (neue IDs).
- Neue reine Module mit Unit-Tests (`notion-rules.js`, `notion-markdown.js`, gegen den Parser der Anzeige geprüft), ein Fake der Notion-API für die Integrationstests (`tests/support/fake-notion.mjs`) und ein Hook nur für Tests (`tests/fixtures/pb_hooks/test-mode.pb.js`).

## Nachtrag (2026-09-30): Rückmeldung und Laufzeiten beim Import

**Beobachtung des Nutzers:** Er übernahm 45 Einträge einer Datenbank. Danach war die Auswahl leer, der Knopf hieß „0 Einträge in den Eingang übernehmen“, und nur der Mauszeiger über dem Knopf zeigte „beschäftigt“. Fortschritt, Ergebnis oder Fehler sah er nicht, und er wusste nicht, ob der Import noch lief.

**Befund**, nachgestellt mit einer Wegwerf-Instanz, dem Fake der Notion-API, einem Komponententest und Edge headless:

1. **Der Import lief durch.** 45 Zeilen ohne Seiteninhalt gingen als eine einzige Anfrage (Teile zu 100): 2 Anfragen an Notion, 45 Einträge, 0,85 s gegen den Fake. Der Fortschritt „0 von 45 übernommen …“ und das Ergebnis „45 angelegt“ standen unter der Liste im scrollenden Inhalt des Modals: 4.111 px Inhalt bei 563 px sichtbarer Höhe, also außer Sicht.
2. **Der Knopf zeigte das Falsche.** Nach dem Ergebnis sind alle 45 Einträge „Jetzt im Eingang.“ und nicht mehr wählbar. Die Auswahl wird leer, der Knopf zeigt „0 Einträge …“ mit `aria-disabled`, und `base.css` gibt solchen Knöpfen `cursor: progress`. Dieser Zeiger war das einzige sichtbare Zeichen, und er sagte „beschäftigt“, obwohl nichts mehr lief.
3. **Weitere Ursachen:**
   - Antwortete Notion nicht binnen 30 s, hieß das „Notion ist nicht erreichbar. Besteht eine Internetverbindung?“ und landete als Fehler der Verbindung in `last_error`.
   - Eine Anfrage hatte keine Obergrenze. Eine einzelne Anfrage an Notion konnte bis 210 s dauern (vier Versuche zu 30 s, dazu dreimal bis 30 s `Retry-After`). Ein Teil mit Seiteninhalt konnte bis 400 Anfragen brauchen. PocketBase 0.40.4 (`WriteTimeout` 5 min) und Firefox (300 s) geben vorher auf, und der Browser meldete dann „Server nicht erreichbar“, obwohl Einträge angelegt waren.
   - Der Store verschluckte eine abgebrochene Anfrage (weder Ergebnis noch Meldung).
   - Einträge, die eine Fehlerantwort noch angelegt hatte, fehlten im Ergebnis.

**Entscheidung:**

- **Blöcke statt einer Anfrage:** Ohne Seiteninhalt schickt die Oberfläche 10 Einträge je 100 Einträge der Quelle (mindestens 10, höchstens 100), mit Seiteninhalt 5 (`importBatchSize`).
  - Jede Anfrage liest die Quelle neu (1 Anfrage an Notion plus 1 je 100 Zeilen, 350 ms Abstand). So bleibt es bei etwa einer Anfrage an Notion je 10 Einträge.
  - 45 Zeilen laufen in 5 Blöcken zu je gut einer halben Sekunde, 1.000 Zeilen in 10 Blöcken zu 100.
  - Mit Seiteninhalt braucht jede Zeile mindestens eine weitere Anfrage, bis zu 40.
- **Laufzeiten aufeinander abgestimmt:**
  - Kein Versuch an Notion beginnt später als 90 s nach dem Eingang der Anfrage der App (`LIMITS.routeSeconds`). Das Zeitlimit jedes Versuchs (höchstens 30 s) schrumpft auf den Rest. Würde eine Wartezeit nach `Retry-After` darüber hinausgehen, gilt gleich der Fehler (etwa 429).
  - Ein Import nimmt nach 30 s (`LIMITS.importSeconds`) keinen neuen Eintrag mehr an und gibt den Rest als `pending` zurück; die Oberfläche schickt ihn als nächsten Block.
  - Das gilt nur nach mindestens einem Ergebnis. Läuft die Zeit vorher ab, ist es ein Fehler. So kommt jede Anfrage voran, und die Schleife kann nicht kreisen.
  - Der Browser wartet 150 s (`NOTION_REQUEST_TIMEOUT_MS`) und meldet dann eine Zeitüberschreitung.
  - Reihenfolge: 30 s je Versuch < 90 s je Anfrage < 150 s im Browser < 300 s bei PocketBase und Firefox. Keine Einzelanfrage läuft in ein fremdes Zeitlimit.
- **Zeitüberschreitung als eigener Fehler:** „Notion antwortet gerade zu langsam (Zeitüberschreitung). Bitte in einer Minute erneut versuchen.“ Sie betrifft die Quelle, nicht die Verbindung (kein `last_error`).
- **Dialog:**
  - Der Knopf heißt während des Laufs „45 Einträge werden übernommen …“ (`aria-disabled`, `aria-busy`).
  - Über den Optionen steht der Fortschritt „20 von 45 bearbeitet …“ mit Balken (`role="status"`). Er wird beim Start in den sichtbaren Bereich gerollt, ebenso später das Ergebnis.
  - Statt „Abbrechen“ und „Andere Quelle“ steht „Nach diesem Block anhalten“; Esc wirkt genauso. Abbrechen geht nur zwischen Blöcken, weil der Server eine laufende Anfrage zu Ende führt.
  - Ein Eintrag verlässt die Auswahl erst mit seinem eigenen Ergebnis und nur, wenn er jetzt im Eingang ist (angelegt, schon vorhanden, übersprungen). Fehlgeschlagene und nicht mehr gesendete Einträge bleiben gewählt.
  - Danach steht an derselben Stelle das Ergebnis: „In den Eingang übernommen“, „Angehalten“ oder „Übernahme unterbrochen“ (rot nur bei einem Fehler, [ADR-0009](0009-fehlerfarbe.md)). Es nennt die Zahlen, den Rest und den Grund, bietet „Im Eingang ansehen“ (`/eingang?quelle=notion`) und listet Einträge mit Fehler unter „Nicht übernommen“.
  - Ist nichts mehr zu wählen, verschwindet der Import-Knopf. „Schließen“ wird zum Hauptknopf und bekommt den Fokus.
  - Ein Doppelklick startet nichts zweimal: Dialog und Store lassen je Verbindung nur einen Lauf zu.
- **Kein Fehler bleibt still:** Jeder Fehler eines Laufs ist sein Ergebnis, ob von Notion, aus dem Netz, eine Zeitüberschreitung oder ein Abbruch. Ausgenommen ist nur die abgelaufene Sitzung, die wie überall abmeldet. Was eine Fehlerantwort schon angelegt hat (`items`), zählt mit. Die Garantie „schon vorhanden“ (Fingerprint `notion|<ID>`) macht jeden neuen Versuch sicher.
- **Umsetzung:** Die Schleife steht ohne Svelte in `web/src/lib/stores/notion-run.ts` (relative Importe). So prüfen die Integrationstests dieselbe Schleife gegen PocketBase und den Fake-Server. Nur im Testmodus verkürzt `BYL_TEST_NOTION_TIMING` („importMs,routeMs“) die Grenzen, und der Fake kann langsam antworten (`slow`).
- **Nicht geändert:** `cursor: progress` für gesperrte Knöpfe gilt weiter in der ganzen App. Im Import-Dialog erscheint nach dem Lauf kein gesperrter Import-Knopf mehr. *Überholt durch [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md), Nachtrag vom 2026-09-30 (KK-1): Gesperrt zeigt „nicht erlaubt“, den Warte-Zeiger gibt es nur mit `aria-busy`.*

**Konsequenzen:** 45 Zeilen brauchen mit Blöcken etwa 3,5 s statt 0,85 s gegen den Fake, weil jede Anfrage die Quelle neu liest. Dafür ist der Fortschritt echt. Die Hooks wirken erst nach `neu-starten.bat`. Test-Manifest BYL-E6-560 bis BYL-E6-565, die manuelle Prüfung BYL-E6-566 ist offen.

## Nachtrag (2026-10-01): Mehrere Quellen, „Alle erneut abrufen“, Unterseiten und mehrere Verbindungen

**Nutzerwunsch:** „Es macht Sinn, mehrere Quellen als Bezug mit reinzunehmen.“ Vorgaben des Advisors: im Dialog mehrere Quellen zugleich wählen, die Vorschau nach Quelle gruppieren, ein Durchgang mit gemeinsamem Fortschritt und Ergebnis je Quelle, „Alle erneut abrufen“ an der Karte. Dazu prüfen, ob Unterseiten erfasst werden und ob mehrere Notion-Verbindungen nebeneinander gehen. Die Pflichten aus §1 bleiben: nur lesen, nur Kopien, kein Abruf im Hintergrund, Duplikate über `notion|<ID>`. Plan: [notion-import.md](../plan/notion-import.md) §7 (NI-3).

### 1. Mehrere Quellen in einem Durchgang

- **Quellen wählen:** Checkboxen statt Radios, gruppiert nach „Datenbanken“ und „Seiten“. Die Auswahl folgt `domain/selection.ts` ([ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) §2): Umschalt+Klick über die angezeigte Reihenfolge, Kopf-Checkbox „Alle angezeigten Quellen auswählen“ mit Zustand „teilweise“, darunter „3 Quellen ausgewählt“. Die Wahl bleibt über eine neue Suche hinweg bestehen; die Kopf-Checkbox wirkt nur auf die angezeigten Quellen. „Weiter“ führt zur Vorschau.
- **Vorschau:** Überschrift „Vorschau: Wochenplan“ bzw. „Vorschau: 3 Quellen“, darunter je Quelle eine Gruppe.
  - Jede Gruppe hat eine Überschrift mit Titel, Art und „In Notion öffnen“ und lässt sich ein- und ausklappen (Disclosure mit `aria-expanded`).
  - Jede Gruppe hat die Checkbox „Alle aus „Wochenplan“ auswählen“ (mit `indeterminate`) und ihren eigenen Zustand: lädt, Fehler mit „Erneut versuchen“, leer, gekürzt.
  - Die Vorschauen laden nacheinander, eine Anfrage je Quelle mit ihren Grenzen.
  - Steht ein Eintrag schon in einer Gruppe weiter oben (etwa eine Unterseite, die auch selbst gewählt ist), ist er gesperrt: „Steht schon unter „Wochenplan“.“
  - Die Kopf-Checkbox „Alle wählbaren Einträge auswählen“ und Umschalt+Klick gelten über alle Gruppen.
  - „Andere Quellen“ führt zurück zur Wahl der Quellen.
- **Optionen:** „Erledigte überspringen“ gilt für alle gewählten Quellen. „Seiteninhalt als Kopie mitnehmen“ gilt für alle gewählten Datenbanken und erscheint nur, wenn eine gewählt ist. „Unterseiten einbeziehen“ gilt für alle gewählten Seiten (§3). Nur „Datum aus“ steht je Datenbank in ihrer Gruppe, weil jede Datenbank eigene Datums-Eigenschaften hat. Begründung: Ein Schalter je Quelle für etwas, das man fast immer für alle gleich will, vervielfacht die Bedienelemente; nur die Datums-Eigenschaft hängt vom Schema ab.
- **Durchgang:** Die Quellen laufen nacheinander, jede in ihren Blöcken (`importBatchSize` je Quelle, Nachtrag vom 2026-09-30).
  - Der Fortschritt zählt über alle Quellen („20 von 45 bearbeitet …“).
  - „Nach diesem Block anhalten“ und Esc halten nach dem laufenden Block an; danach beginnt keine weitere Quelle.
  - Ein Fehler, der nur eine Quelle betrifft (`reason: "source"`: nicht freigegeben, 429, 5xx, zu langsam), beendet nur diese Quelle, und die nächste läuft weiter. Ein Fehler der Verbindung (Token, Rechte) oder eine ausgefallene Anfrage beendet den Durchgang.
  - Danach steht das Ergebnis über allem: die Zahlen, „Eine Quelle mit Fehler; der Grund steht bei der Quelle.“ und der Rest. Darunter folgt „Ergebnis je Quelle“ mit einer Zeile je Quelle, etwa „Wochenplan: 3 angelegt, 1 schon vorhanden.“ oder mit Grund. Rot nur bei einem Fehler ([ADR-0009](0009-fehlerfarbe.md)).
  - Ein Eintrag verlässt die Auswahl weiter nur mit eigenem Erfolg.
- **Umsetzung:** keine neue Route; Vorschau und Import bleiben je Quelle. Die Schleife über die Quellen steht ohne Svelte in `stores/notion-run.ts` (`runSources`), damit die Integrationstests sie gegen PocketBase und den Fake prüfen. Jede Anfrage hält ihre Grenzen (90 s je Anfrage, 30 s für neue Einträge, 150 s im Browser). Der Abstand von 350 ms gilt für alle Anfragen des Servers an Notion.

### 2. „Alle erneut abrufen“

- Steht im Menü „•••“ der Karte, sobald eine Quelle übernommen ist und die Verbindung bereit ist. Holt aus allen bisher übernommenen Quellen nacheinander nur neue Einträge, wie „Erneut abrufen“ je Quelle: mit „Erledigte überspringen“ und den Optionen des letzten Imports der Quelle (Datums-Eigenschaft, Seiteninhalt, Unterseiten). Eine Quelle ohne Neues schickt keine Import-Anfrage.
- **Während des Laufs:**
  - Lozenge „Wird abgerufen“.
  - Die Infozeile sagt „Erneut abrufen: Quelle 2 von 5 („Wochenplan“) …“ (`role="status"`), darunter ein Balken mit den fertigen Quellen.
  - Der Hauptknopf heißt „Nach diesem Block anhalten“; danach beginnt keine weitere Quelle.
- **Danach:** Ein Flag fasst zusammen, etwa „3 Quellen erneut abgerufen: 5 angelegt, 2 schon vorhanden; 1 Quelle mit Fehler.“ (rot nur, wenn nichts kam und eine Quelle scheiterte). In „Bisher übernommen“ steht unter jeder Quelle „Erneut abgerufen: …“ mit dem Ergebnis bzw. dem Grund (Fehler rot mit Symbol); das gilt auch für „Erneut abrufen“ einer einzelnen Quelle und bleibt bis zum Neuladen der Seite.
- Ein Fehler einer Quelle beendet nur diese, ein Fehler der Verbindung den Lauf. Nur auf Klick, nie im Hintergrund. Je Verbindung läuft nur ein Import oder Abruf zugleich.
- **Umsetzung:** `refetchSources` in `stores/notion-run.ts`; auch „Erneut abrufen“ einer Quelle läuft darüber.

### 3. Unterseiten (Befund und Umsetzung)

**Befund:** Eine Unterseite einer freigegebenen Seite sieht die Integration (die Freigabe vererbt sich), übernommen wurde sie aber nicht.
- Beim Lesen einer Seite stieg die App nicht in `child_page` ab (§4: „Unterseiten … sind eigene Quellen und werden nicht gelesen“).
- In der Quellenliste erscheint eine Unterseite nur, wenn die Suche sie liefert. Notion garantiert das nur für direkt freigegebene Seiten ([Search optimizations and limitations](https://developers.notion.com/reference/search-optimizations-and-limitations): „Any pages or databases that are directly shared with a connection are guaranteed to be returned.“).
- Der Satz „Unterseiten sind mit freigegeben“ in der Hilfe stimmte also für den Zugriff, nicht für den Import.

**Entscheidung:** Schalter „Unterseiten einbeziehen“ (Standard aus) für Seiten. Mit ihm liest die App nach der Seite ihre Unterseiten (Blöcke `child_page`, auch in Umschaltern und Spalten) und deren Unterseiten, Ebene für Ebene, und übernimmt deren Listenpunkte wie die der Seite (reine Regeln `childPagesOf`, `collectSubpages`).
- **Grenzen:** höchstens 50 Unterseiten (`LIMITS.subpages`, sichtbare und nicht sichtbare zusammen) bis zur dritten Ebene (`LIMITS.subpageDepth`). Dazu teilen sich Seite und Unterseiten die Grenzen beim Lesen einer Seite (100 Anfragen, 5 000 Blöcke). Darüber ist die Vorschau gekürzt und sagt das.
- **Nur Sichtbares:** Antwortet Notion für eine Unterseite mit 404 oder 403 (eigene Freigaben in Notion), bleibt sie weg und wird gezählt: „2 Unterseiten gelesen, 1 Unterseite nicht sichtbar.“ steht in der Gruppe. Andere Fehler gelten wie bisher für die Quelle.
- **Zuordnung:** Die Einträge gehören zur gewählten Seite (`source_meta.notion.source_id`). Ihr Abschnitt ist der Pfad „Unterseite“ bzw. „Unterseite › Kind › Überschrift“, der Link führt auf die Unterseite mit Anker des Blocks. `source_meta.notion.subpages = true` merkt die Option für „Erneut abrufen“ (`GET …/notion/imports` liefert `subpages`). Eingebettete Datenbanken bleiben eigene Quellen.
- **Routen:** `preview` und `import` nehmen `subpages: true` (nur bei Seiten wirksam); die Vorschau antwortet zusätzlich `subpages` und `subpages_hidden`, die Grenzen `subpages` und `subpage_depth`.
- **Zeitfenster:** Mit Unterseiten kann das Lesen einer Quelle bis zur Frist von 90 s dauern. Damit danach nicht nur ein Eintrag je Anfrage übernommen wird, zählen die 30 s für neue Einträge (`LIMITS.importSeconds`) jetzt ab dem Ende des Lesens statt ab dem Eingang der Anfrage. Anfragen an Notion enden weiter spätestens nach 90 s. Eine Anfrage der App dauert damit höchstens etwa 120 s und bleibt unter den 150 s des Browsers und den 300 s von PocketBase und Firefox.

### 4. Mehrere Notion-Verbindungen (Befund und Umsetzung)

**Befund:** Mehrere Verbindungen der Art `notion` gingen schon.
- Jede hat ihre eigene Variable (`secret_env`), Karte, „Bisher übernommen“ (per SQL je Verbindung) und ihren eigenen Lauf; der Katalog bietet „Weitere einrichten“.
- Duplikate erkennt der Fingerprint `notion|<ID>` über alle Verbindungen eines Bereichs: Zwei Integrationen desselben Arbeitsbereichs liefern dieselben IDs.
- Der Abstand von 350 ms gilt für alle Anfragen des Servers zusammen, also strenger als nötig (Notion begrenzt je Integration).
- **Lücke:** Der Assistent schlug für jede neue Verbindung `BYL_NOTION_TOKEN` vor, auch im Befehl `setx` vor dem Anlegen. Wer ihm für einen zweiten Arbeitsbereich folgte, überschrieb das Token der ersten Verbindung.

**Entscheidung:** Der Vorschlag nimmt einen Namen, den noch keine Verbindung nutzt (`BYL_NOTION_TOKEN_2`, `_3` …; `freeVariableName` in `domain/connections.ts`), im Befehl `setx` und im Formular „Verbindung anlegen“. Das gilt für alle Arten mit Assistent, weil dieselbe Lücke einen zweiten Kalender, Bot oder ein zweites Postfach traf. Mehrere Arbeitsbereiche bedeuten je eine interne Integration und eine Verbindung mit eigener Variable.

### Konsequenzen

- Keine Migration, keine neue Route. Geänderte Hooks (`notion-rules.js`, `notion-client.js`, `notion-service.js`) wirken nach `neu-starten.bat`, die Oberfläche nach F5. Vor dem Neustart ignoriert der alte Server `subpages`; die Vorschau zeigt dann keine Unterseiten.
- „Alle erneut abrufen“ braucht je Quelle eine Vorschau und, falls es Neues gibt, Import-Anfragen. Bei vielen Quellen dauert das entsprechend; der Balken zeigt, wo es steht.
- Test-Manifest BYL-E6-860 bis BYL-E6-868; die manuellen Prüfungen BYL-E6-866 bis BYL-E6-868 sind offen.
