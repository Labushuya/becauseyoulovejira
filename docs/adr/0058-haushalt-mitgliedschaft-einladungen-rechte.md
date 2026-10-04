# ADR-0058: Haushalt – Mitgliedschaft, Einladungen, Rechte (E7-2)

- **Status:** Angenommen und umgesetzt (E7-2, [Plan E7 „Haushalt“](../plan/e7-haushalt.md) §3)
- **Datum:** 2026-10-04
- **Entscheidung durch:** Nutzer (Haushalt als „Shared Space“ mit seiner Frau, Privat und Haushalt isoliert, Beitritt per Code, aktiv austreten, Rechte weitergeben, später erweiterbar; 2026-10-04), Advisor (Akzeptanzkriterien, Rechtekatalog, Nummerierung E7-1 bis E7-7), Executor (Datenmodell, Regeln, Routen, Oberfläche, Einzelheiten)
- **Bezug:** [ADR-0001](0001-betriebsmodell-lokal-mehrgeraete-spaeter.md) §2 und §4, [ADR-0011](0011-roadmap-e3-bis-e7.md) (Nachtrag), [ADR-0037](0037-papierkorb.md) §3 (Nachtrag), [ADR-0055](0055-sicherheits-haertung.md) §1 (Nachtrag), [ADR-0056](0056-konten-und-verwalter.md) §4 (Nachtrag), [ADR-0057](0057-kontextabhaengige-oberflaeche.md) §5 (Nachtrag)

## Kontext

Seit E1 tragen alle fachlichen Datensätze `owner`, `household` und `scope` (`u:<owner>` bzw. `h:<household>`), und die API-Regeln kennen einen Haushalts-Zweig. Haushalte und Mitgliedschaften legte bisher nur der Superuser unter `/_/` an; ihre Schreibregeln waren `null`. Seit E7-1 gibt es mehrere Konten, die Namen im Haushalt sehen, und seit HN-1 den Zugriff im Heimnetz.

Zwei Lücken zeigte die Prüfung der Regeln:

- Der owner-Zweig `owner = @request.auth.id || (Haushalt …)` galt auch für Haushaltsdatensätze. Wer einen Haushalt verließ, behielt alles, was er dort angelegt hatte: Liste, Ansicht, Ändern, Löschen und Realtime, ebenso über das Ticket (Kommentare, Verlauf, Lesestand) und im Papierkorb.
- Es gab keinen Weg, einen Haushalt in der App zu gründen, jemanden aufzunehmen oder Rechte zu vergeben.

## Entscheidung

### 1. Ein Haushalt je Konto, Datenmodell N:M

- Jedes angemeldete Konto kann einen Haushalt mit Namen gründen und wird sein **Inhaber** (`household_members.role = owner`). Vorerst ist jedes Konto in **höchstens einem** Haushalt; das prüfen Gründen und Beitreten in ihrer Transaktion (`already-member`, 409).
- Das Datenmodell bleibt N:M (`household_members` mit `household` und `user`, eindeutig je Paar). Die Routen arbeiten auf dem einen Haushalt des Kontos; mehrere Haushalte je Konto brauchen eine Freigabe und dann eine Kennung des Haushalts in den Routen.
- Ein Haushalt hat genau einen Inhaber: Gründen setzt ihn, „Inhaber übertragen“ tauscht ihn in einer Transaktion.

### 2. Einladungscode

- **Format:** 8 Zeichen aus 31 eindeutigen (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`, ohne 0, O, 1, I, L), etwa 40 Bit, angezeigt als `ABCD-EFGH`. Beim Eingeben zählen Groß- und Kleinschreibung, Leerraum und Bindestriche nicht (`normalizeCode`); die Seite gruppiert beim Tippen.
- **Erzeugt** mit `$security.randomStringWithAlphabet` (Zufall des Systems), **gespeichert nur als SHA-256** des normalisierten Codes in `household_invites.code_hash` (`hidden`, eindeutig). Der Code steht einmal in der Antwort von `POST …/invites` (`Cache-Control: no-store`) und auf der Seite, bis „Weitergegeben“ ihn entfernt; nie in einem Flag, der Adresse, einem Speicher oder einem Log.
- **Gültig** 7 Tage und **einmal** (`used_at`, `used_by`), jederzeit widerrufbar (`revoked_at`); höchstens 10 offene je Haushalt. Die Liste nennt nur Status (offen, benutzt, widerrufen, abgelaufen), Zeiten und Namen von Mitgliedern; beendete Codes stehen 7 Tage in der Liste und gehen nach 30 Tagen mit dem nächsten neuen Code aus der Datenbank.
- `household_invites` hat keinen API-Zugriff (alle Regeln `null`); nur die Routen lesen und schreiben.

### 3. Beitreten

- `POST /api/byl/household/join { code }`: Wer schon in einem Haushalt ist, bekommt zuerst `already-member` (sagt nichts über einen Code). Sonst tritt das Konto dem Haushalt des offenen Codes als Mitglied ohne Sonderrechte bei, und der Code ist verbraucht, in einer Transaktion.
- **Neutrale Antwort:** Unbekannte, abgelaufene, benutzte, widerrufene und falsch geformte Codes bekommen dieselbe Antwort 400 `{ reason: "invalid", problem: "code", message: "Code ungültig oder abgelaufen." }`.
- **Rate-Limit:** Die Route fällt unter die Werte der Stufe „Streng“ (5 Anfragen je 300 s und Adresse), in beiden Stufen und auch für angemeldete Konten, als genaue Regel `POST /api/byl/household/join` des Rate-Limiters von PocketBase (`JOIN_RULE` in `lib/security-rules.js`, Migration `1790203810`). PocketBase vergleicht genaue Regeln vor den Präfixen. Ein Code wird geraten wie ein Passwort; mit 31^8 Codes und höchstens 1 440 Versuchen am Tag je Gerät ist das aussichtslos. Jedes Gerät im Heimnetz zählt für sich (ADR-0055, Nachtrag HN-1).

### 4. Rechte und Delegation

- **Katalog** (`household_members.rights`, Mehrfachauswahl):

  | Recht | Erlaubt | Wirksam |
  |---|---|---|
  | `invite` | Codes erzeugen und widerrufen | jetzt |
  | `remove` | Mitglieder entfernen, nie den Inhaber | jetzt |
  | `delegate` | eigene Rechte an andere Mitglieder geben und nehmen | jetzt |
  | `rename` | Haushalt umbenennen | jetzt |
  | `purge` | endgültig löschen im Haushalt | ab E7-3 (jetzt nur gespeichert und angezeigt) |
  | `move_out` | Haushaltsdaten ins Private verschieben | ab E7-4 (jetzt nur gespeichert und angezeigt) |

- Der **Inhaber** hat alle Rechte durch seine Rolle (gespeichert bleibt eine leere Liste). **Neue Mitglieder** haben keines dieser Sonderrechte und nutzen den Haushalt sonst normal (sehen, anlegen, ändern wie bisher über die API-Regeln).
- **Delegationsregel** (rein `rightsProblem`, gleich in `domain/household.ts`): nur mit `delegate`; nie an sich selbst (`self-rights`); nie am Inhaber (`owner-untouchable`); geändert werden dürfen nur Rechte, die man selbst hat (`rights-foreign`), alle anderen Rechte des Mitglieds bleiben unverändert. Damit gibt es keinen Weg zu mehr Rechten: Niemand kann sich selbst etwas geben, und niemand gibt weiter, was er nicht hat.
- **Inhaber übertragen:** nur der Inhaber, an ein anderes Mitglied. Der alte Inhaber wird Mitglied und behält alle Rechte als ausdrücklich gesetzte Rechte; nur der neue Inhaber kann es zurückgeben.
- **Entfernen:** mit `remove`, nie den Inhaber, nie sich selbst (dafür „Austreten“).
- **Austreten:** jedes Mitglied außer dem Inhaber (`owner-leave`, 409 mit dem Hinweis, erst zu übertragen). **Die Einträge bleiben im Haushalt**, auch die selbst angelegten; der Zugriff endet sofort (§5). Einen Haushalt auflösen kommt mit E7-4.

### 5. Regel-Änderung: owner-Zweig nur privat

- Migration `1790203900_household_access_rules.js` ändert **nur Regeln**, keine Nutzdaten: In jeder Regel von `projects`, `tags`, `recurrence_rules`, `tickets`, `inbox_items`, `connections`, `dependencies`, `comments`, `ticket_history` und `ticket_reads` wird der owner-Zweig ersetzt:

  | vorher | nachher |
  |---|---|
  | `(owner = @request.auth.id \|\| (household != "" && Mitgliedschaft))` | `((owner = @request.auth.id && household = "") \|\| (household != "" && Mitgliedschaft))` |
  | `(ticket.owner = @request.auth.id \|\| (ticket.household != "" && …))` | `((ticket.owner = @request.auth.id && ticket.household = "") \|\| (ticket.household != "" && …))` |

  Die Bedingungen späterer Migrationen (Papierkorb, Löschsperren) bleiben, weil nur der Zweig ersetzt wird; eine Regel aus der Verwaltung ohne diesen Zweig bleibt unberührt. Rückweg: der Zweig wie vorher.
- **Wirkung:** Haushaltsdatensätze sind nur über die **aktuelle Mitgliedschaft** erreichbar. Wer austritt oder entfernt wird, kann sie nicht mehr listen, ansehen, ändern oder löschen, auch selbst erstellte nicht, auch nicht über das Ticket (Kommentare, Verlauf, Lesestand anlegen, Abhängigkeiten), und PocketBase schickt ihm keine Realtime-Ereignisse mehr dazu, weil es die Regel bei jedem Ereignis neu prüft. Private Datensätze bleiben beim Konto.
- **Papierkorb:** `lib/trash-service.js` liest mit derselben Sichtbarkeit (`VISIBLE_RULE`, `visibleRoots`, `viewersOf`), also auch dort nur über die Mitgliedschaft.
- **Lesestand:** Eigene Zeilen in `ticket_reads` (nur IDs und Zeit, kein Inhalt) bleiben für ihr Konto sichtbar; neue gibt es nur für sichtbare Tickets.
- **Offene Tabs:** Nach jeder Änderung geht das Thema `byl/household` (ohne Daten) an die Tabs aller betroffenen Konten, auch des entfernten. Beginnt oder endet die Mitgliedschaft eines Tabs, lädt er neu (die Stores hielten sonst, was sie geladen haben) und nennt danach das Ergebnis als Flag („Du bist nicht mehr Mitglied im Haushalt …“). Gründen lädt nicht neu: Der Haushalt ist leer.

### 6. Schreiben nur über Routen, Lesen nur für Mitglieder

- Alle Schreibvorgänge an `households`, `household_members` und `household_invites` laufen über `household.pb.js` (`lib/household-service.js`, rein `lib/household-rules.js`), je in **einer Transaktion** mit allen Prüfungen vor dem ersten Schreiben. Die Collection-API bleibt für Schreiben gesperrt (`null`).

  | Route | Prüfung |
  |---|---|
  | `GET /api/byl/household` | angemeldet; der eigene Haushalt mit Mitgliedern (Name, Rolle, Rechte, nie E-Mail) und, mit `invite`, den Codes |
  | `POST /api/byl/household` `{ name }` | kein Haushalt; Name 1–100 Zeichen ohne Steuerzeichen |
  | `POST …/rename` `{ name }` | `rename` |
  | `POST …/invites` | `invite`; höchstens 10 offene |
  | `POST …/invites/{id}/revoke` | `invite`; Code des eigenen Haushalts, offen |
  | `POST …/join` `{ code }` | kein Haushalt; offener Code; Rate-Limit §3 |
  | `POST …/members/{id}/rights` `{ rights }` | `delegate`; Delegationsregel §4 |
  | `POST …/members/{id}/remove` | `remove`; nie Inhaber, nie selbst |
  | `POST …/members/{id}/transfer` | nur der Inhaber; nicht an sich selbst |
  | `POST …/leave` | Mitglied, nicht Inhaber |

- Antworten der Änderungen sind der neue Zustand (wie `GET`); Ablehnungen `{ reason: "invalid", problem }` mit 400, 403, 404 oder 409, vor der Migration 503 `missing`. Audit „byl-household: Aktion ausgeführt“ bzw. „… Anfrage abgelehnt“ mit Aktion, Konto und Haushalt, nie ein Code.
- **Lesen:** wie seit E7-1: Mitglieder sehen den eigenen Haushalt und die Mitgliederliste, Nicht-Mitglieder nichts; `household_invites` niemand über die API.
- **Jedes Gerät:** Die Routen tun nichts am Rechner der App und prüfen deshalb weder „dieser Rechner“ noch den Verwalter (ADR-0057). Die Seite „Einstellungen → Haushalt“ steht für jedes Konto in der Navigation, am PC, im zweiten Browserprofil und am Handy im Heimnetz.

### 7. Oberfläche

- `/einstellungen/haushalt` (nach „Konto“): ohne Haushalt „Haushalt gründen“ und „Mit Code beitreten“; mit Haushalt Name (mit `rename` „Umbenennen …“ inline), Mitglieder mit Rolle und Rechten, je Mitglied das Menü „•••“ nur mit erlaubten Aktionen („Rechte bearbeiten …“ als Modal M mit genau den eigenen Rechten als Kästchen, „Zum Inhaber machen …“, „Aus dem Haushalt entfernen …“), „Einladungscodes“ mit `invite` und „Haushalt verlassen“ („Austreten …“, für den Inhaber der Hinweis). Nicht erlaubte Aktionen fehlen, statt gesperrt zu sein. Entfernen, Austreten und Übertragen fragen per Bestätigung (kein Rot). Der Server bleibt maßgeblich; eine Ablehnung steht auf der Seite, und die Seite liest den Haushalt danach neu.
- Der Umschalter „Privat | Haushalt“ bleibt bis E7-3 ausgegraut.

## Alternativen

| Alternative | Bewertung |
|---|---|
| Mitglieder aus der Liste der Konten hinzufügen (Entwurf des Plans) | Braucht Sicht auf alle Konten und Zustimmung der Person; ein Code, den die Person selbst eingibt, ist beides. Vom Nutzer so gewünscht. |
| Code im Klartext speichern | Ein Abzug der Datenbank gäbe offene Codes preis; der Hash genügt zum Prüfen. |
| Langsamer Hash (bcrypt) oder HMAC mit Geheimnis | Codes leben höchstens 7 Tage und sind einmalig; wer die Datenbank liest, liest ohnehin alle Daten. SHA-256 wie bei den Zugangsschlüsseln (ADR-0038). |
| Längere Codes oder Wörter | 8 Zeichen lassen sich am Handy abtippen; zusammen mit dem Rate-Limit reicht die Entropie. |
| Eigene Zählung im Hook statt des Rate-Limiters | Zweiter Mechanismus neben ADR-0055; die Regel von PocketBase zählt je Gerät und vor jeder Logik. |
| owner-Zweig behalten, beim Austritt `owner` umschreiben | Änderte Nutzdaten und den Verlauf; die Regel ist die richtige Stelle, und sie gilt sofort. |
| Entfernungen per Realtime je Datensatz senden (wie der Papierkorb) | Tausende Ereignisse je Austritt und jede Collection einzeln; ein Neuladen des Tabs erreicht alle Stores sicher. |
| Rechte als eigene Collection | Ein Feld je Mitgliedschaft genügt und bleibt mit der Zeile verbunden. |

## Konsequenzen

- Positiv: Ein Haushalt lässt sich in der App gründen, mit einem Code betreten und verlassen; Rechte lassen sich weitergeben, ohne dass jemand mehr bekommt, als der Gebende hat. Austritt und Entfernen nehmen sofort jeden Zugriff, auch auf selbst Angelegtes.
- Negativ: Wer austritt, verliert den Zugriff auf seine Einträge im Haushalt; sie bleiben dort (gewollt). Vor dem Austritt ins Private holen geht erst mit E7-4.
- Negativ (behoben mit dem Nachtrag „Bereich eines Eintrags“ unten): Ein Mitglied konnte über die Record-API das Feld `household` eines Haushaltsdatensatzes leeren (ohne Oberfläche). Verschieben kommt mit E7-4 als eigene Route mit `move_out`.
- Neu: Migrationen `1790203800`, `1790203810`, `1790203900`, Hooks und Routen wirken nach einem Neustart (`neu-starten.bat`). Bis dahin sagt die Seite „Nach dem nächsten Neustart verfügbar“, und die Regeln gelten wie vorher.
- **Tests:** rein `tests/unit/household-rules.test.mjs` (mit Gleichstand zu `domain/household.ts`), `security-rules.test.mjs`; gegen Wegwerf-Instanzen `tests/integration/household.test.mjs`, `household-access.test.mjs`, `household-join-limit.test.mjs`, `migrations-rollback.test.mjs`, `hooks-before-migration.test.mjs`; in `web/` Domain, Store, Seite, Layout, Navigation und Hilfe.
- **Nur im Browser prüfbar** (Test-Manifest, manuell): gründen und Code am PC, Beitritt am Handy im Heimnetz, Recht weitergeben und entziehen, Austritt mit offenem Tab, Inhaber versucht auszutreten.

## Nachtrag (2026-10-04, Sicherheits-Fix nach E7-2): Bereich eines Eintrags

- **Lücke:** Die Update-Regeln der Collections mit Bereich prüften nur `@request.body.owner:changed = false` und dass ein neuer `household` ein eigener Haushalt ist. Jedes Mitglied konnte deshalb per `PATCH /api/collections/<c>/records/<id>` mit `household: ""` einen Haushaltsdatensatz eines anderen aus dem Haushalt ziehen (er wurde privat beim Besitzer; das Mitglied verlor den Zugriff, der Haushalt den Datensatz), ebenso der Besitzer selbst; ein privater Datensatz ließ sich in den eigenen Haushalt schieben. Belegt in allen sechs Collections mit `scope` gegen das Binary 0.40.4. Ein geänderter `scope` kam mit 200 durch, wurde aber vom Modell-Hook aus `owner` und `household` neu berechnet (ohne Wirkung). Bereits geschlossen waren: `owner` ändern (404 über die Regel), Anlegen mit fremdem `owner` und Anlegen in einem Haushalt ohne Mitgliedschaft (400 über die Create-Regel); der `scope` eines neuen Eintrags wird berechnet.
- **Schutz:** `app/pb_hooks/scope-guard.pb.js` (`onRecordUpdateRequest` für `projects`, `tags`, `recurrence_rules`, `tickets`, `inbox_items`, `connections`, `dependencies`; Logik `lib/scope-guard.js`, rein `lib/scope-rules.js`) vergleicht `owner`, `household` und `scope` des Datensatzes, nachdem PocketBase den Body übernommen hat, mit den gespeicherten Werten. Jede Abweichung lehnt er mit 400 ab: `validation_scope_locked` „Der Bereich eines Eintrags kann nicht direkt geändert werden.“ an `household` bzw. `scope`, `validation_scope_owner_locked` „Der Besitzer eines Eintrags kann nicht geändert werden.“ an `owner` (greift nur, wenn die Regel den Besitzer einmal nicht mehr hält). Unveränderte Werte im Body sind erlaubt. Jede Form des Bodys zählt gleich (JSON, `null`, Modifikatoren wie `household-`, multipart), auch in einer Batch-Anfrage. Der Superuser bleibt frei.
- **Warum ein Hook statt einer Regel:** `@request.body.household:changed = false` wirkt in 0.40.4 zuverlässig (geprüft mit `""`, `null`, `household-`, multipart und unveränderten Werten). PocketBase prüft die Update-Regel aber vor `onRecordUpdateRequest` und beantwortet eine verletzte Regel mit 404 ohne Text; ein Mitglied, das den Eintrag sieht, bekäme „nicht gefunden“. Der Hook nennt den Grund am Feld. Keine Migration, keine geänderte Regel.
- **Anlegen:** PocketBase 0.40.4 prüft die Create-Regel vor `onRecordCreateRequest`; ein Hook käme dort nie zu Wort. Die Regeln (`@request.body.owner = @request.auth.id`, `household` leer oder mit Mitgliedschaft) bleiben der Schutz und antworten weiter mit dem allgemeinen 400.
- **Wege des Servers** laufen nicht über Request-Hooks und bleiben frei: Routen des Haushalts, Erzeugen von Wiederholungen und „Wiederholen…“, Eingang → Ticket, Duplizieren, Wiederherstellen aus dem Papierkorb, Sicherung und Wiederherstellung, die spätere Route zum Verschieben (E7-4).
- **Oberfläche:** Die SPA sendet `owner`, `household` und `scope` bei keinem Update (nur `owner` beim Anlegen); nichts zu ändern.
- **Tests:** `tests/integration/household-fields.test.mjs` (eigene Wegwerf-Instanz, A und B in H1, C in H2), `tests/unit/scope-rules.test.mjs`; angepasst: Verschieben in `rules.test.mjs` nur noch als Ablehnung, Modell-Hooks beim Bereichswechsel (`ticket-keys`, `ticket-guards`, `ticket-history`, `project-hierarchy`) über den Superuser.

## Nachtrag E7-3 (2026-10-04, [ADR-0059](0059-bereiche-privat-und-haushalt.md))

- **`purge` wirkt:** Endgültig löschen und „Papierkorb leeren“ im Haushalt nur mit der Rolle Inhaber oder dem Recht `purge` (sonst 403); dasselbe Recht ändert die Aufbewahrung des Papierkorbs im Haushalt (`households.trash_retention`, `POST /api/byl/household/retention`, Migration `1790204100`). `GET /api/byl/household` nennt sie als `household.trash_retention`.
- **§5 „Offene Tabs“ geändert:** Beginnt oder endet die Mitgliedschaft eines Tabs, lädt er nicht mehr neu. Weil jeder Store seit E7-3 nur den Bereich des Tabs zeigt (Filter auf dem Server, auch Realtime), genügt es, Haushalt und Namen neu zu laden; geht der Haushalt des Tabs verloren, wechselt er in den Bereich Privat. Ungespeicherte Eingaben bleiben.
- **§7:** Der Umschalter „Privat | Haushalt“ ist aktiv und erscheint nur für Mitglieder eines Haushalts.
- **Bereich eines Eintrags:** E7-3 nutzt den Schutz aus dem Nachtrag oben (`scope-guard`) für Updates, auch der Verbindungen; neue Verbindungen mit `household` lehnt `connection-rules.areaViolation` ab.

## Nachtrag E7-4 (2026-10-04, [ADR-0060](0060-verschieben-zwischen-bereichen-und-aufloesen.md))

- **`move_out` wirkt:** Einträge anderer Mitglieder holt ins Private nur, wer das Recht hat (der Inhaber durch die Rolle); eigene Einträge darf jedes Mitglied ins Private holen. Verschoben wird nur über `POST /api/byl/area/move`; der Schutz `scope-guard` bleibt, wie er ist.
- **§4 „Austreten“ und §1:** Der Inhaber kann den Haushalt jetzt auflösen (`POST /api/byl/household/dissolve`, alles ins Private übernehmen oder alles löschen); der Text von `owner-leave` nennt das statt „mit einer späteren Version“.
- **Ohne aktiven Inhaber:** Ist der Inhaber deaktiviert oder in der Verwaltung gelöscht, bestimmt der Verwalter der App auf der Seite „Konten“ ein aktives Mitglied als Inhaber (wie Übertragen: der bisherige bleibt Mitglied mit allen Rechten).
- **§5 „Offene Tabs“:** Das Thema `byl/household` trägt beim Auflösen `{ dissolved: true }`; sonst bleibt es ohne Daten.
