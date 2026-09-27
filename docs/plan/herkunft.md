# E6-Plan, Teil Herkunft: Quellen eines Tickets, Löschschutz, große Mails und Seitenkopie

- **Stand:** umgesetzt (2026-09-27): HK-0 bis HK-4 (#105 bis #108 und der PR von HK-4). Offen sind die manuellen Browser-Prüfungen.
- **Grundlage:**
  - [ADR-0031](../adr/0031-herkunft-sichern.md) (Datenmodell, Verknüpfen und Lösen, Löschschutz, große Mails, Kopie-Status, Seitenkopie mit SSRF-Schutz und seinen Grenzen)
  - [ADR-0014](../adr/0014-datenmodell-eingang.md), [ADR-0016](../adr/0016-kanal-architektur-und-mail.md), [ADR-0008](../adr/0008-markdown-rendering-und-sanitizing.md), [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0029](../adr/0029-glas-materialien.md)
  - [CLAUDE.md](../../CLAUDE.md) §3, §5, §7, §11, §12
- **Einordnung:** Nutzerentscheidung vom 2026-09-27: „Herkunft sichern“ kommt direkt nach „Spalten“ ([Plan Spalten](e6-spalten.md)), vor „Editor Stufe A“. Die Manifest-IDs laufen ab `BYL-E6-160` (Spalten belegt 140 bis 151).

## 1. Querschnittsregeln

- Die Instanz des Nutzers läuft aus demselben Ordner `app/`. Neue Hooks wirken sofort, die Migration erst nach dem Neustart. Jeder Hook arbeitet deshalb auch auf dem Schema davor (`hooks-before-migration.test.mjs`).
- Die Migration hat einen Rollback-Test mit Daten (`migrations-rollback.test.mjs`).
- Keine neue Abhängigkeit, keine neuen Farb- oder Maß-Tokens. Nur die bestehenden Bausteine: Drawer, Modal, Popover, Flag, `guidance/*`. Glas nach ADR-0029.
- Tests nur mit Fake-Servern: Test-IMAP-Server für Mails, lokaler HTTP-Server für Seiten. Keine echten Postfächer oder Webseiten, keine echten Zugangsdaten.
- **Gates je Paket:**
  - eigener Branch und PR
  - `scripts\build.ps1` lokal komplett grün (Exit-Code 0 und „Build complete!“)
  - CI grün, höchstens drei Versuche; ein roter PR hält die folgenden auf
  - Squash-Merge, Test-Manifest nachgezogen, Entscheidungen in §3

## 2. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| HK-0 | ADR-0031, dieser Plan, Manifest-Einträge als „geplant“ | – |
| HK-1 | Verknüpfen und Lösen im Hook mit Historie `source_link` (atomar, Prüfmuster wie beim Umwandeln), Löschschutz per Hook und Migration `1790201800_inbox_items_delete_guard.js` mit Rollback-Test | BYL-E6-160, BYL-E6-161 |
| HK-2 | Oberfläche: Abschnitt „Quellen“ im Ticket (Panel und Vollansicht) mit „Quelle hinzufügen …“ und „Lösen“, „Mit Ticket verknüpfen …“ im Eingang (einzeln und für die Auswahl) mit Ticketsuche als Combobox im Modal M, Verlauf, `copyCompleteness` mit Lozenge und SectionMessage | BYL-E6-162, BYL-E6-163 (manuell) |
| HK-3 | Große Mails: Eintrag ohne Originaldatei über automatischen Abruf, Vollsuche, Postfach-Auswahl und `.eml`; `byl-mail.exe` 0.8.0 | BYL-E6-164, BYL-E6-165, BYL-E6-166 (manuell) |
| HK-4 | Seitenkopie für Web-Links: Route mit SSRF-Schutz, Textauszug, HTML als Original; „Seiteninhalt sichern“ im Panel und beim Erfassen per Bookmarklet | BYL-E6-167, BYL-E6-168, BYL-E6-169, BYL-E6-170 (manuell) |

## 3. Entscheidungen

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-09-27 | HK-0 | ADR-Nummer 0031 (frei nach 0030). Manifest-Block ab `BYL-E6-160`. Paketkürzel `HK` („Herkunft“). |
| 2026-09-27 | HK-0 | **`converted` bleibt für Umwandeln und Verknüpfen** (ADR-0031 §1). Die Hauptquelle folgt aus `tickets.source_item`. |
| 2026-09-27 | HK-0 | **Verknüpfen und Lösen über die Record-API** statt einer eigenen Route: Es ist derselbe Weg wie „Dem Ticket zuordnen“, und Regeln und Realtime von `inbox_items` gelten ohne Nachbau. |
| 2026-09-27 | HK-0 | **Seitenkopie mit `$http.send` im Hook**, wie empfohlen. Die Grenzen (keine DNS-Auflösung, Weiterleitungen nicht prüfbar, Größe erst nach dem Laden) stehen in ADR-0031 §6. Der Hilfsprozess wäre der stärkere Schutz, läuft aber nur mit einer Mail-Verbindung. |
| 2026-09-27 | HK-0 | **„Seiteninhalt sichern“ beim Bookmarklet:** Checkbox in der Vorlage „Web-Link“, standardmäßig an („optional voreingestellt“). Ohne eigenen Speicher der Vorliebe. |
| 2026-09-27 | HK-1 | **Wo die Prüfungen liegen:** `transitionViolation` (rein, Request-Hook) erlaubt `converted` → `new` nur ohne Ticket. Ob der Eintrag die Hauptquelle ist, prüft `prepareUpdate` im Modell-Hook innerhalb der Transaktion (`validation_inbox_primary_source` am Feld `state`). Der Verlaufseintrag entsteht nach `e.next()` in derselben Transaktion (`recordLinkChange`). |
| 2026-09-27 | HK-1 | **Kein Verlaufseintrag beim Umwandeln:** Speichert der Ticket-Hook den Eintrag als `converted`, sieht `recordLinkChange` in der Transaktion `source_item = <Eintrag>` am neuen Ticket und schreibt nichts; „hat das Ticket angelegt“ genügt. Ebenso nichts, wenn ein Eintrag gelöst wird, dessen Ticket gelöscht ist. |
| 2026-09-27 | HK-1 | **Urheber:** `rememberActor` im Request-Hook von `inbox_items` wie bei Tickets (`@actor`). Speichert der Server selbst (Umwandeln), gibt es keinen Eintrag. |
| 2026-09-27 | HK-1 | **Löschschutz zweifach:** Die `deleteRule` (`… && ticket = ""`) antwortet dem Besitzer mit 404 wie bei jedem nicht sichtbaren Datensatz; der Hook `onRecordDeleteRequest` greift schon vor der Migration und für den Superuser mit 400 `validation_inbox_item_linked` und schützt zusätzlich die Hauptquelle über `tickets.source_item`. Der Test „Eintrag löschen leert `source_item`“ ist zum Test des Löschschutzes geworden. |
| 2026-09-27 | HK-1 | **Fehlerinjektion:** eigene Markierung `__byl_fail_source_link__` im Titel des Eintrags, weil die bestehende Markierung im Ticket-Titel schon beim Anlegen des Tickets greift. |
| 2026-09-27 | HK-1 | Der Verlauf der SPA nennt die Einträge schon jetzt („Quelle verknüpft: Postfach „…““, „Quelle gelöst: …“, `history-format.ts`), damit „Dem Ticket zuordnen“ nach HK-1 sichtbar ist. Der Abschnitt „Quellen“ folgt mit HK-2. |
| 2026-09-27 | HK-2 | **Ein Store für beide Seiten:** `TicketSourcesStore` im `(app)`-Layout lädt die Quellen des offenen Tickets (`listTicketSources`, höchstens 200, ohne Text), folgt den Realtime-Ereignissen von `inbox_items` (ein zweites Abo neben dem `InboxStore`) und verknüpft, löst und sucht. Geänderte Einträge gibt er sofort an den `InboxStore` weiter (`upsert`), vor dem Realtime-Ereignis. Die Ticket-Route öffnet ihn mit `source_item` als Hauptquelle und setzt ihn beim Verlassen zurück. |
| 2026-09-27 | HK-2 | **Ticketsuche** `searchTickets`: `key ~ q || title ~ q || number = n` (n = -1 ohne Zahl), sichtbare Tickets samt erledigten, höchstens 20, nach `-updated`, offene zuerst; der Filter steht als Literal im Aufruf, weil die Strukturprüfung zusammengesetzte Konstanten nur als `[…].join(' && ')` zulässt. |
| 2026-09-27 | HK-2 | **Combobox** `TicketCombobox` nach APG („list autocomplete“): Suche nach 200 ms Pause mit Abbruch der vorigen, Liste im Fluss unter dem Feld im Modal (kein eigenes Popover, kein Glas im Glas, `--color-surface`), Pfeiltasten, Enter, Escape erst für die Liste, dann für den Text (verbraucht), Statuszeile per `aria-live`. |
| 2026-09-27 | HK-2 | **Mehrere Einträge:** `LinkTicketDialog` verknüpft nacheinander (je Eintrag atomar im Hook), schließt ohne Fehler, behält sonst nur die gescheiterten Einträge mit Grund. Ein Flag für alle („2 Einträge mit TASK-4 verknüpft.“, bei Teilfehlern neutral). Die Auswahl der Tabelle verliert die verknüpften Einträge. |
| 2026-09-27 | HK-2 | **Ort des Abschnitts:** im Panel nach Quelle und Daten, in der Vollansicht in der linken Spalte zwischen Beschreibung und Aktivität (die rechte Spalte hat nur Karten mit Feldern). Die Karte „Quelle“ bleibt, sie nennt den Kanal auch nach dem Löschen eines Tickets. |
| 2026-09-27 | HK-2 | **Kopie-Status im Panel des Eintrags** als Zeile „Kopie“ mit Lozenge in den Kopfangaben und, wenn nicht vollständig, einer `SectionMessage` (info, compact) mit dem, was fehlt. „Mit Ticket verknüpfen …“ steht im Fuß neben „Verwerfen“ und „Umwandeln“, nur für neue Einträge. |
| 2026-09-27 | HK-3 | **Ein Entwurf für alle Wege:** `mailToDraft(mail, channel, { omittedSize })` in `domain/inbox-mail.ts` (SPA und Hilfsprozess) setzt `original_omitted` und `original_size`, lässt die Zahl der Anhänge weg (der abgeschnittene Anfang kennt sie nicht) und hält den Hinweis `ORIGINAL_OMITTED_NOTE` am Ende, auch wenn der Text auf 100 000 Zeichen gekürzt wird. |
| 2026-09-27 | HK-3 | **Hilfsprozess:** `InboxSession.partialSource(uid, n)` (`BODY.PEEK[]<0.n>`) und `header(uid)` (`BODY.PEEK[HEADER]`); `largeMailDraft` parst den Anfang, sonst den Kopf. `checkMail` bekommt die Größe aus `listAfter` bzw. `headersOf` und lädt große Mails nie ganz (imapflow begrenzt die Antwort ohnehin auf 10 MB plus Puffer). Die Postfach-Auswahl liest die Größe vorher mit `headersOf([uid])`. `skipped` bleibt in der Antwort von `/poll` (Hook und SPA kennen es), ist aber 0; neu zählt `omitted` die Einträge ohne Datei fürs Protokoll („davon 1 über 10 MB ohne Originaldatei“). |
| 2026-09-27 | HK-3 | **Test-IMAP-Server** beantwortet Teilabrufe `BODY.PEEK[]<start.länge>` mit `BODY[]<start>` (RFC 3501 6.4.5) und merkt sie sich (`partialFetches`), damit Tests belegen, dass nur 2 MB gelesen werden. |
| 2026-09-27 | HK-3 | **Ingest-Route:** nimmt `original_omitted` nur mit dem Wert `too_large` und einer ganzen, nicht negativen `original_size` an, sonst 400; eine Größe ohne Kennzeichen wird verworfen. |
| 2026-09-27 | HK-3 | `byl-mail.exe` 0.8.0. Bis zum Neustart (`stop.bat`, dann `start.bat`) läuft der alte Hilfsprozess weiter und überspringt große Mails; die Route bleibt mit ihm verträglich. |
| 2026-09-27 | HK-4 | **Drei Module:** `lib/url-guard.js` (rein, SSRF-Schutz), `lib/html-text.js` (rein, ES5-Kopie von `htmlToText` samt Seitentitel, Paritätstest über Fälle, die HTML-Mail der Fixtures und 300 zufällige Stücke Markup) und `lib/page-copy.js` (rein: Status und Typ, Zeichensatz aus Header oder `<meta>`, Windows-1252 für Latin-1-Seiten, UTF-8-Kürzung ohne halbe Zeichen, Text und `source_meta`); `lib/page-copy-service.js` ruft ab und speichert. |
| 2026-09-27 | HK-4 | **IP-Literale wie `inet_aton`:** Ein Host, dessen Teile alle Zahlen sind (dezimal, oktal mit führender 0, hex mit `0x`, weniger als vier Teile, eine Zahl), gilt als IPv4-Literal; ein kaputtes (etwa `256.1.1.1`, `08.1.1.1`) ist gesperrt statt als Name durchgelassen. Nicht-ASCII-Namen und `%` im Host sind ungültig, weil Go sie anders lesen könnte (IDNA). |
| 2026-09-27 | HK-4 | **Kürzen statt ablehnen:** Eine Seite über 2 MB wird auf ihre ersten 2 MB gekürzt (`truncated`), statt sie abzulehnen: geladen ist sie ohnehin schon. `206` wird angenommen, falls der Server `Range` beachtet. |
| 2026-09-27 | HK-4 | **Text nicht maskiert:** Der Seitentext kommt wie der Text von HTML-Mails ungemaskiert in `body`; die Anzeige ist sanitisiert (ADR-0008). Maskieren hätte jede Beschreibung nach dem Umwandeln mit Backslashes gefüllt. |
| 2026-09-27 | HK-4 | **Einmal gesichert ist gesichert:** Die Route prüft `original` vor dem Abruf und noch einmal in der Transaktion (zwei Klicks zugleich speichern nur einmal); `fetched_at` steht in PocketBase-Schreibweise, damit die SPA es wie jedes Datum liest. |
| 2026-09-27 | HK-4 | **Fehler der Route** (400 Adresse, 409 schon gesichert, 415 kein HTML, 502 nicht erreichbar, 503 vor dem Eingang) gibt `savePage` der Datenschicht als Ergebnis mit dem Text des Servers zurück, wie die Postfach-Routen; im Panel steht er inline, beim Erfassen in der Meldung des Formulars. Nebenbei kennt `errors.ts` jetzt die Texte von `validation_inbox_primary_source` und `validation_inbox_item_linked`. |

## 4. Status

| Paket | Stand |
|---|---|
| HK-0 | gemergt (#105) |
| HK-1 | gemergt (#106) |
| HK-2 | gemergt (#107) |
| HK-3 | gemergt (#108) |
| HK-4 | in Arbeit |

## 5. Offene Punkte

- Manuelle Browser-Prüfungen der Pakete HK-2 bis HK-4.
