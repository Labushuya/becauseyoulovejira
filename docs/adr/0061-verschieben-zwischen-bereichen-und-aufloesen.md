# ADR-0061: Verschieben zwischen Bereichen und Auflösen (E7-4)

- **Status:** Angenommen und umgesetzt (E7-4, [Plan E7 „Haushalt“](../plan/e7-haushalt.md) §3b); Nachtrag E7-5: Zuständigkeit beim Verschieben ([ADR-0068](0068-zustaendigkeit.md)); Nachtrag PL-2: Warnung, wenn Zuständigkeit wegfällt
- **Datum:** 2026-10-04
- **Entscheidung durch:** Nutzer (Freigabe der Etappe E7 und des Pakets E7-4 „Verschieben und Auflösen“), Advisor (Akzeptanzkriterien: Vorschau, Transaktion, Kaskaden, Konflikte, Nummern, Rechte, Realtime, Auflösen, Inhaber ohne Konto, Altbestand), Executor (Route, Kaskaden im Einzelnen, Eingangseinträge, Abhängigkeiten, Realtime, Oberfläche, Altbestand)
- **Bezug:** [ADR-0058](0058-haushalt-mitgliedschaft-einladungen-rechte.md) (Rechte, `move_out`, Nachtrag „Bereich eines Eintrags“), [ADR-0059](0059-bereiche-privat-und-haushalt.md) (Bereiche, keine Verweise über die Grenze), [ADR-0037](0037-papierkorb.md) (Papierkorb, Realtime-Muster `broadcastRemoved`), [ADR-0033](0033-unteraufgaben.md), [ADR-0034](0034-unterprojekte.md), [ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) §6 („Aus der Serie lösen“), [ADR-0049](0049-zielprojekt-je-eingangsweg.md) (Zielprojekt), [ADR-0054](0054-tickets-im-kontext-oeffnen.md), [ADR-0056](0056-konten-und-verwalter.md) (Verwalter, Seite „Konten verwalten“)

## Kontext

Seit E7-3 zeigt jeder Tab genau einen Bereich, „Privat“ oder den Haushalt, und kein Verweis überschreitet die Grenze. `owner`, `household` und `scope` sind über die Record-API unveränderlich (`scope-guard`, Nachtrag zu ADR-0058): Wer einen Eintrag in den anderen Bereich bringen wollte, musste ihn neu anlegen. Das Recht `move_out` war nur gespeichert, ein Inhaber konnte den Haushalt weder verlassen noch auflösen, und ein Haushalt, dessen Inhaber deaktiviert wurde, hatte niemanden mehr, der ihn verwaltet. Verbindungen mit `household` aus der Verwaltung von vor E7-3 lagen in keinem Bereich der Oberfläche.

## Entscheidung

### 1. Eine Route mit Vorschau, eine Transaktion

- `POST /api/byl/area/move` (angemeldetes App-Konto, jedes Gerät, `area.pb.js`, Dienst `lib/area-move-service.js`, rein `lib/area-move-rules.js`) mit `{ kind, ids, to, preview?, project?, dependencies?, codes? }`:
  - `kind` `ticket` | `project` | `rule` | `item`, `ids` 1 bis 200 Datensätze dieser Art (die Sammelaktion schickt mehrere Tickets), `to` `household` (der Haushalt des Kontos) oder `private`.
  - Mit `preview: true` ändert sich nichts. Ohne läuft die Prüfung erneut und dann jedes Schreiben in **einer Transaktion**: alles oder nichts.
- **Antwort** beider Formen: `{ preview, kind, to, scope, from_name, to_name, counts, conflicts, needs }`, nach dem Verschieben zusätzlich `moved` mit den neuen Keys (`{ id, key, previous }`) und Codes.
  - `counts`: `tickets` (davon `subtasks`), `projects`, `rules`, `items`, `comments`, `dependencies`.
  - `conflicts`: `project` (Projekte, die zurückbleiben, mit `targets`, den aktiven Projekten des Ziels), `tags` (`reused`, `created`), `dependencies`, `parents`, `project_parents`, `codes` (mit Vorschlag), `series`, `rule_tickets`, `rules_project`, `items` (`connection`, `target`, `duplicate`), `targets`.
  - `needs`: was die Ausführung als Wahl braucht (`project`, `dependencies`, `codes`).
- **Ablehnungen** `{ reason: "invalid", problem, params }`: `format`, `too-many` (400), `no-household`, `missing` (404), `area` (400, der Eintrag liegt schon im Ziel), `linked` (409), `right` (403, `params.label`), `project-choice`, `project`, `dependencies-choice`, `code` (400, `params.project`). Texte gleich in `domain/area-move.ts` (Paritätstest).

### 2. Kaskaden und Konflikte

| Art | Was mitkommt | Konflikte und ihre Lösung |
|---|---|---|
| Ticket | alle Unteraufgaben, die Quellen (Einträge mit `ticket` = Ticket und die Hauptquelle), Kommentare und Verlauf (ohne eigenen Bereich, sie folgen dem Ticket) | Projekt, das zurückbleibt: Zielprojekt (aktiv, im Ziel) oder „Ohne Projekt“, eine Wahl für alle. Elternticket bleibt zurück: das Ticket wird im Ziel ein Hauptticket. Tags nach Namen (vorhanden übernommen, sonst im Ziel angelegt). Abhängigkeit zu einem Ticket, das zurückbleibt: „mitnehmen“ (das andere Ticket mit Unteraufgaben, wiederholt bis keine mehr hinausführt) oder „Verknüpfung lösen“ (Datensatz gelöscht). Wiederholung bleibt zurück: das Ticket löst sich aus der Serie, ein offenes wie „Aus der Serie lösen“ (ADR-0023 §6). |
| Projekt | Unterprojekte, alle lebenden Tickets dieser Projekte mit ihrer Kaskade | `@CODE` im Ziel vergeben: neuer Code je Projekt (2–6 Großbuchstaben, nicht TASK, nicht doppelt). Oberprojekt bleibt zurück: eigenständiges Projekt. Eine Wiederholung, deren Vorlage das Projekt nennt und die zurückbleibt, verliert das Projekt; Zielprojekte anderer Einträge, Verbindungen und der Karten des eigenen Kontos, die es nennen, werden geleert. |
| Wiederholung | nur die Regel | Projekt der Vorlage bleibt zurück: wie beim Ticket. Bisherige Tickets bleiben, wo sie sind, und verlieren den Bezug zur Regel (offene wie „Aus der Serie lösen“, Verlaufseintrag „Wiederholung entfernt“); künftige Tickets entstehen im Ziel. |
| Eintrag im Eingang | nur der Eintrag, nur ohne Ticket | Mit Ticket: 409 `linked`, er zieht mit seinem Ticket um. Verbindung in einem anderen Bereich als dem Ziel: Verweis geleert (Verbindungen bleiben privat, der Kanal bleibt). Zielprojekt, das zurückbleibt: geleert. Gleicher Fingerabdruck schon im Ziel: der verschobene bekommt einen eigenen (`sha256(moved|…)`), beide bleiben. |

- **Verbindungen** sind nie verschiebbar (Festlegung im Plan §4 und ADR-0059 §5).
- **Kein Verweis bleibt über der Grenze**: Das gilt für alle Relationsfelder. Die Ziele je Repository bzw. Ordner im JSON `settings` von GitHub- und Ordner-Verbindungen bleiben stehen; sie gelten außerhalb ihres Bereichs schon heute als „kein Ziel“ (`usableTarget`). *(Überholt durch den Nachtrag E7-4b: Das Verschieben leert auch sie.)*
- Die Schreibvorgänge tragen den flüchtigen Schlüssel `@area_move` (Tickets, Projekte, Einträge) bzw. `@recurrence_system` (Regeln): Die Modell-Hooks überspringen ihre Prüfungen, die eine Kaskade sonst zerlegen würden (Bereichswechsel mit Unteraufgaben, Projekt mit Tickets), und der Dienst setzt Bereich, Key und Verlauf selbst. Abhängigkeiten laufen durch ihren Hook (`checkDependencyArea`) und bestehen ihn, weil beide Enden schon umgezogen sind.

### 3. Nummern, Verlauf, Realtime

- **Nummern:** Jedes verschobene Ticket bekommt einen neuen Key im Zähler des Ziels (`<scope>:<Projekt|TASK>`), in der Reihenfolge seiner alten Nummer; ein Key, den es im Ziel schon gibt (ein altes Ticket im Papierkorb), wird übersprungen. Die ID bleibt, Links funktionieren weiter und wechseln den Bereich (ADR-0059 §7).
- **Verlauf:** ein Eintrag `area_move` mit dem alten Key als `old_value` und JSON `{ to, key, project?, parent?, series?, dissolved? }`. Die Oberfläche liest „In den Haushalt verschoben (vorher PRIV-12)“, ergänzt um das Projekt vorher und nachher, ein zurückgebliebenes Elternticket und das Lösen aus der Serie.
- **Realtime:** PocketBase meldet eine Änderung, die einen Datensatz verbirgt, niemandem (es prüft mit dem neuen Stand). Vor dem ersten Schreiben merkt sich der Dienst deshalb jedes Abo eines Tabs, das einen der Datensätze sieht (Sichtbarkeit wie `VISIBLE_RULE`, Filter des Abos wie `matchesSubscription` des Papierkorbs); nach dem Commit bekommt jedes, das ihn nicht mehr sieht, das `delete` eines harten Löschens, markiert mit `moved: true`. Wer ihn jetzt sieht (Ziel), bekommt das `update` von PocketBase; die Liste nimmt es auf.
- **Offene Detailansichten:** Ein Panel, dessen Ticket in einen Bereich ging, den das Konto nicht sieht, sagt „Dieses Ticket ist jetzt in einem anderen Bereich.“ statt „gelöscht“. Sieht das Konto es weiter, wechselt der Tab in dessen Bereich (wie ein Link, Flag „Zum Bereich … gewechselt.“), auch der Tab, der verschoben hat, wenn er den Datensatz zeigt.

### 4. Rechte

Der Server prüft für **jeden** Datensatz der Kaskade (Tickets, Projekte, Regeln, Einträge; Tags und Abhängigkeiten folgen ihren Tickets) vor dem ersten Schreiben, schon in der Vorschau:

| Richtung | Wer | Danach |
|---|---|---|
| Privat → Haushalt | nur eigene private Einträge (`owner` = Konto, ohne Haushalt) | `owner` bleibt, `household` = Haushalt des Kontos |
| Haushalt → Privat | der Ersteller (`owner`), Mitglieder mit `move_out`, der Inhaber (alle Rechte durch die Rolle) | `owner` = das verschiebende Konto, `household` leer |

Ein Datensatz ohne Recht lehnt den ganzen Vorgang mit 403 `right` ab und nennt ihn (`params.label`). Einträge eines anderen Kontos oder Bereichs bleiben „nicht gefunden“ (404).

### 5. Haushalt auflösen

- `POST /api/byl/household/dissolve { mode, preview?, name? }` nur durch den Inhaber (sonst 403 `owner-only`). Die Vorschau nennt Haushalt, Mitglieder, was er enthält (Tickets, Papierkorb, Projekte, Wiederholungen, Einträge, Tags, Verbindungen, Kommentare) und für `adopt` die Codes mit Suffix.
- **(a) `adopt`:** Alles des Haushalts, auch der Papierkorb und Verbindungen von vorher, kommt mit denselben Regeln wie beim Verschieben in den privaten Bereich des Inhabers. Kein Konflikt fragt: Tags werden zugeordnet, ein `@CODE`, den der Inhaber schon hat, bekommt ein Suffix (H, dann A–Z ohne H, dann zwei Buchstaben; `suffixedCode`). Tickets im Papierkorb bekommen ihren Key im Zähler des Projekts ihres Schnappschusses (mit dessen neuem Code), so behält ein Wiederherstellen ihn. Verlauf mit `dissolved`.
- **(b) `delete`:** nur mit dem eingetippten Namen des Haushalts (`nameConfirmed`, Leerraum am Rand egal, sonst 400 `dissolve-name`). Alles des Haushalts wird endgültig gelöscht, auch der Papierkorb und Quellen an Tickets; die Sperren des Papierkorbs (ADR-0047) gelten hier bewusst nicht, die Eingabe des Namens ist die Entscheidung.
- **Danach** in derselben Transaktion: Zähler `h:<Haushalt>:%`, Einladungscodes, Mitgliedschaften und der Haushalt selbst gehen. Das Thema `byl/household` mit `{ dissolved: true }` erreicht die Tabs aller früheren Mitglieder; sie wechseln ohne Neuladen in den Bereich Privat und sagen „Der Haushalt „…“ wurde aufgelöst.“. Der Inhaber sieht „Haushalt „…“ aufgelöst.“ mit dem Ergebnis.
- Eine **Regel-Migration** war nicht nötig: Die Sichtbarkeit hängt nur an der Mitgliedschaft, und kein Datensatz nennt den Haushalt danach noch.

### 6. Haushalt ohne aktiven Inhaber

- `GET /api/byl/accounts` nennt je Konto den Haushalt, den es besitzt (`owns`), und die Haushalte ohne aktiven Inhaber (`households`: Inhaber deaktiviert oder in der Verwaltung gelöscht, mit den übrigen Mitgliedern).
- `POST /api/byl/accounts/households/{id}/owner { member }` mit den Prüfungen der Seite „Konten verwalten“ (`check`: dieser Rechner, Adresse der App, Verwalter, Rate-Limit; KOB-1): nur ohne aktiven Inhaber (sonst 409 `owner-active`), nur ein aktives Mitglied (`member` 404, `member-disabled` 400). Der bisherige Inhaber bleibt Mitglied mit allen Rechten, wie beim Übertragen (ADR-0058 §4). Danach `byl/household` an die Mitglieder.
- Die Seite „Konten verwalten“ zeigt „Inhaber von „…““ am Konto, warnt in der Frage „deaktivieren?“ davor und hat den Abschnitt „Haushalte ohne aktiven Inhaber“ mit Auswahl und Bestätigung.

### 7. Altbestand: Verbindungen mit `household`

Migration `1790204200_connections_private.js` (SQL, ohne Hooks, `updated` bleibt): Jede Verbindung mit `household`, deren `owner` aktiv ist, kommt in dessen privaten Bereich; ein Zielprojekt außerhalb dieses Bereichs wird geleert, und Einträge des Haushalts, die sie gebracht hat, bleiben im Haushalt und verlieren den Verweis auf die Verbindung. Eine Verbindung eines deaktivierten Kontos bleibt, wie sie war, und geht beim Auflösen mit dem Haushalt. Der Rückweg ändert nichts (der frühere Haushalt wird nicht gemerkt). Auf echten Daten kommt das vermutlich nie vor; ein Test belegt den Weg.

### 8. Oberfläche

- „In den Haushalt verschieben …“ bzw. „Ins Private verschieben …“ steht im Menü „•••“ eines Tickets (Panel, Vollansicht, Zeile, Kalender, offene Tickets eines Projekts), eines Projekts (Liste, Kacheln, Panel), einer Wiederholung (Zeile, Panel) und eines Eintrags im Eingang ohne Ticket (Zeile, Panel), dazu in der Sammel-Leiste der Tabelle „Aufgaben“. Nur für ein Konto in einem Haushalt und nur mit dem Recht (`moveDirection`, für die Sammelaktion für jedes gewählte Ticket); sonst fehlt der Eintrag.
- Der Dialog (`AreaMoveDialog`, Modal M; in der Vollansicht eingebettet) zeigt den Hinweis „Kommentare und Verlauf werden für alle Mitglieder sichtbar.“ bzw. „Für die anderen Mitglieder verschwindet der Eintrag.“, die Anzahl je Art, die Wahlen der Vorschau (Projekt im Ziel, Abhängigkeiten mit neuer Vorschau bei „Mitnehmen“, neue Codes mit Vorschlag) und was sich sonst ändert; eine Ablehnung steht im Dialog.
- „Haushalt auflösen …“ auf der Seite „Haushalt“ nur für den Inhaber (`HouseholdDissolveDialog`).

## Alternativen

| Alternative | Bewertung |
|---|---|
| Verschieben über die Record-API mit gelockertem `scope-guard` | Jede Kaskade bräuchte viele Anfragen ohne gemeinsame Transaktion; der Schutz von ADR-0058 würde löchrig. |
| Die Modell-Hooks Datensatz für Datensatz laufen lassen | Die Hooks lehnen einen Bereichswechsel mit Unteraufgaben bzw. ein Projekt mit Tickets zu Recht ab; eine Reihenfolge mit Zwischenständen (Unteraufgaben lösen, wieder einhängen) schriebe falschen Verlauf. |
| Tags mit verschieben | Ein Tag hängt meist an vielen Tickets beider Bereiche; nach Namen zuordnen hält jeden Bereich in sich stimmig. |
| Eintrag mit Ticket einzeln verschieben (Ticket lösen) | Die Hauptquelle lässt sich nie lösen (ADR-0031); die Herkunft gehört zum Ticket. |
| Fingerabdruck-Kollision ablehnen | Beim Auflösen gäbe es keine Wahl; ein eigener Fingerabdruck verliert keine Daten, die Sperre gegen doppeltes Eintreffen bleibt beim vorhandenen Eintrag. |
| Abhängigkeiten immer mitnehmen oder immer ablehnen | Der Auftrag verlangt die Wahl; „mitnehmen“ schließt die Menge, weil ein mitgenommenes Ticket weitere Abhängigkeiten haben kann. |
| Ein `delete`-Ereignis je Datensatz auch beim Auflösen | Tausende Ereignisse; der Wechsel nach Privat lädt die Stores ohnehin neu (ADR-0059 §8). |
| Haushalt ohne Inhaber automatisch dem ältesten Mitglied geben | Der Auftrag lässt den Verwalter entscheiden; eine stille Übergabe könnte das falsche Konto treffen. |

## Konsequenzen

- **Neustart nötig** (`neu-starten.bat`): neue Hooks und Routen, Migration `1790204200`; die Oberfläche nach dem Build und F5. Vor dem Neustart antworten die Routen 404 (die Oberfläche sagt „nach dem nächsten Neustart verfügbar“).
- Neue Module: `app/pb_hooks/area.pb.js`, `lib/area-move-rules.js`, `lib/area-move-service.js`; `web/src/lib/domain/area-move.ts`, `data/area-move.ts`, `stores/area-move.svelte.ts`, `lib/area-move-entry.ts`, `components/AreaMoveDialog.svelte`, `components/household/HouseholdDissolveDialog.svelte`. Die Datenschicht liest dafür `owner` von Tickets, Projekten, Regeln und Einträgen.
- **Tests:** `tests/integration/household-move.test.mjs` (eigene Instanz, A und B im Haushalt, C allein), `accounts.test.mjs` (Inhaber durch den Verwalter), `migrations-rollback.test.mjs` (Altbestand), `context-route.test.mjs` und `lan-access.test.mjs` (neue Route des Verwalters), `tests/unit/area-move-rules.test.mjs`; in `web/` Domain, Dialog, Menüeinträge je Recht, Sammelaktion, Auflösen, Seite „Konten verwalten“, Verlauf, Hilfe.
- **Grenzen:** Ein Eintrag, der den Bereich seiner Verbindung verlässt, schützt diesen Bereich nicht mehr vor erneutem Eintreffen (Fingerabdrücke gelten je Bereich); eine Vollsuche des Postfachs kann ihn dort neu anlegen. *(Behoben mit dem Nachtrag E7-4b.)* Ein Haushalt, dessen Inhaber gelöscht wurde und der kein Mitglied mehr hat, bleibt ohne Inhaber (Folgepunkt im Plan). *(Behoben mit dem Nachtrag E7-4c.)*
- **Nur im Browser prüfbar** (Test-Manifest, manuell): Verschieben mit Live-Anzeige bei der Partnerin, `@CODE`-Kollision, Ablehnung ohne `move_out`, Auflösen auf beide Arten mit offenem Tab der Partnerin, Inhaber durch den Verwalter.

## Nachtrag E7-4b (2026-10-04): Keine Dubletten nach dem Verschieben, keine Ziele über die Grenze

- **Entscheidung durch:** Advisor (Auftrag E7-4b: Dubletten nach dem Verschieben, Ziele in Karten-Einstellungen, Sammelauswahl), Executor (Merker je Bereich, Umsetzung).

### A. Dublettenerkennung nach dem Verschieben

**Befund.** Fingerabdrücke sind je Bereich eindeutig (`UNIQUE (scope, fingerprint)`, [ADR-0014](0014-datenmodell-eingang.md) §3). Ein Eintrag, der seinen Bereich verließ (eine Mail aus dem privaten Eingang in den Haushalt), nahm seinen Fingerabdruck mit. Der nächste Abruf seines Kanals, die Vollsuche des Postfachs oder ein Datei-Import legte dasselbe Objekt im alten Bereich neu an. Ebenso nach einem Zurückschieben über einen eigenen Fingerabdruck (`moved|…`) und nach dem Auflösen eines Haushalts mit „löschen“.

**Entscheidung.**

- **Merker je Bereich:** Die neue Collection `inbox_moved_fingerprints` (Migration `1790204300`, alle API-Regeln `null`) hält `scope` (der Bereich, den ein Eintrag verlassen hat), `fingerprint` und `created`. Eindeutig ist das Paar (`scope`, `fingerprint`). Das Verschieben schreibt den Merker in seiner Transaktion, bevor es Bereich und Fingerabdruck des Eintrags ändert (`inbox-service.rememberMovedAway`), einmal je Bereich und Fingerabdruck.
- **Unabhängig vom Eintrag:** Der Merker bleibt, wenn der Eintrag weiterzieht, zurückkommt, einen eigenen Fingerabdruck bekommt oder mit seinem Haushalt gelöscht wird. Nur das Auflösen eines Haushalts entfernt die Merker *dieses* Haushalts (`forgetMovedAway`); sein Bereich existiert danach nicht mehr. Beim Auflösen selbst entstehen keine Merker.
- **Prüfung:** Die Dublettenerkennung jedes Wegs (`ingest` der Kanäle, Hook der Record-API, `lookup` der Auswahlansichten) sucht zuerst einen Eintrag im Bereich, dann einen Merker (`duplicateOf`). Ein Merker ist ein Duplikat ohne Eintrag: Zustand `moved`, Text „In einen anderen Bereich verschoben.“ (`MOVED_STATE`, `duplicateMessage`; gleich in `domain/inbox.ts`, Paritätstest). Die Ingest-Route und der eigene Eingang antworten `{ status: "duplicate", item: "", state: "moved" }`. Mail-Hilfsprozess und Erweiterung zählen das wie jedes Duplikat. Die SPA liest `moved` in Postfach-Auswahl, `.ics`-Vorschau, Notion und beim Anlegen (`DUPLICATE_STATES`): Die Zeile ist gesperrt und nennt den Text.
- **Abschaltbar:** Eine Einstellung „Dublettenerkennung aus“ gibt es nicht. Ohne harte Sperre sind nur die manuellen Wege (`manual`, `quick`, `clipboard` mit Zufallsschlüssel, §3 von ADR-0014) und die Kopie einer Quelle ([ADR-0045](0045-ticket-duplizieren.md)). Ihre Fingerabdrücke trifft kein Kanal, also sperrt auch ihr Merker nichts.
- **Endgültiges Löschen:** Kein Löschweg sieht ein bewusstes Vergessen vor. ADR-0014 (Nachtrag 2026-10-01) und [ADR-0037](0037-papierkorb.md) §6 halten Fingerabdrücke gerade fest, damit dasselbe Objekt nicht wiederkommt. Auch das Auflösen mit „löschen“ (§5 (b)) löscht nur die Daten des Haushalts. Die Merker der Bereiche, aus denen seine Einträge kamen, bleiben.

**Alternativen.**

| Alternative | Bewertung |
|---|---|
| Merker je Verbindung und Fingerabdruck | Verfehlt Wege ohne Verbindung (eigener Eingang, WhatsApp Web, Datei-Importe, `.ics` im Haushalt) und geht verloren, wenn eine Verbindung neu angelegt wird. Je Bereich prüft genau dort, wo die Eindeutigkeit gilt, und braucht keine zweite Regel. |
| Verworfener Platzhalter-Eintrag im alten Bereich | Er stünde unter „Verworfen“, ließe sich wiederherstellen (dann gäbe es doch zwei) und zählte im Speicher und in den Listen mit. |
| Alte Bereiche am Eintrag merken (Feld oder `source_meta`) | Nach dem Auflösen mit „löschen“ wäre der Eintrag weg und mit ihm die Sperre. Der eigene Fingerabdruck einer Kollision träfe den Kanal nicht mehr. |
| Fingerabdrücke über alle Bereiche eindeutig | Bricht §2 von ADR-0061 (Doppel im Ziel bleiben getrennt). Zwei Konten dürfen dieselbe Mail je in ihrem Bereich haben. |

**Folgen.** Ein Eintrag, der vor E7-4b verschoben wurde, hinterließ keinen Merker; die Migration legt keine nachträglich an, weil sich der alte Bereich eines Eintrags nicht sicher bestimmen lässt (in den Haushalt verschoben behält er seinen `owner`, aber auch ein `.ics`-Import liegt dort mit `owner`). E7-4 war bis dahin nur wenige Stunden auf `main`. Einträge eines Haushalts, die die Migration `1790204200` von ihrer Verbindung löste (§7), bekommen keinen Merker; sie sind nicht mehr erkennbar und kamen auf echten Daten vermutlich nie vor.

### B. Zielprojekte in den Einstellungen von GitHub- und Ordner-Kanälen

- **Verschieben:** Wer ein Projekt verschiebt, leert jedes Ziel eines Repositorys bzw. Ordners (`settings.repos[].target`, `settings.folders[].target`, [ADR-0049](0049-zielprojekt-je-eingangsweg.md) §3), das danach in einen anderen Bereich zeigen würde. Beim Auflösen gilt das auch für Verbindungen, die mitziehen und auf zurückbleibende Projekte zeigen. Die reine Regel `clearedUnitTargets` (`lib/area-move-rules.js`) lässt alle anderen Einstellungen unverändert. Ein Ziel, dessen Projekt gelöscht ist, bleibt stehen (die Karte nennt es „gibt es nicht mehr“).
- **Vorschau:** Die Antwort nennt die Anzahl in `conflicts.unit_targets`. Der Dialog sagt „N Zielprojekte von Repositorys oder Ordnern in den Kanälen werden geleert.“
- **Abruf:** Ein Ziel über die Grenze aus der Zeit davor lässt den Lauf nicht scheitern. Es gilt wie ein geleertes (§3 von ADR-0049: das Ziel der Verbindung, sonst ohne Projekt). Neu ist ein Log-Eintrag je Lauf und Ziel: „byl-github: Zielprojekt eines Repositorys liegt in einem anderen Bereich und gilt nicht“ bzw. „byl-folders: … eines Ordners …“, mit Verbindung und Projekt, ohne Pfad.

### C. Sammelauswahl nach dem Verschieben

Geprüft, kein Fehler: Das Layout nimmt die verschobenen Tickets sofort aus der Liste (jetzt `dropMovedTickets` in `stores/area-move.svelte.ts`). Die Tabelle behält nur gezeigte Zeilen in der Auswahl (`keepShown`). Ein Komponententest belegt das: Danach gibt es keine Leiste und kein gewähltes Kästchen, und keine ID bleibt gewählt, auch wenn die Tickets wieder erscheinen.

**Neustart nötig** (`neu-starten.bat`): Hooks und Migration `1790204300`; die Oberfläche nach dem Build und F5.

## Nachtrag E7-4c (2026-10-04): Verwaiste Haushalte löschen

- **Entscheidung durch:** Nutzer (Produktentscheidung: Definition „verwaist“, der Verwalter darf nur löschen, nie übernehmen), Advisor (Auftrag E7-4c: Route, Fehlerfälle, Oberfläche, Tests), Executor (Umsetzung).

**Befund.** Wurde der Inhaber in der Verwaltung gelöscht und hatte der Haushalt kein Mitglied mit Konto mehr, blieb er ohne Inhaber stehen (§6, Folgepunkt im Plan). Die Seite „Konten verwalten“ nannte ihn, konnte aber niemanden wählen. Er kann trotzdem Daten enthalten: Einträge von Konten, die ausgetreten sind, bleiben im Haushalt (ADR-0058 §5).

**Entscheidung.**

- **Verwaist** ist ein Haushalt, wenn keine seiner Mitgliedschaften zu einem existierenden Konto gehört (`isOrphaned` in `lib/account-service.js`). Mitgliedschaften gelöschter Konten gehen mit dem Konto (Kaskade). Ein Haushalt mit nur deaktivierten Konten ist **nicht** verwaist: Der Verwalter kann ein Konto wieder aktivieren oder den Inhaber wechseln (§6).
- **Nur löschen:** Der Verwalter darf einen verwaisten Haushalt löschen, nie in ein Konto übernehmen. Es sind nicht seine Daten.
- **Route:** `POST /api/byl/accounts/households/{id}/delete { preview?, name? }` mit den Prüfungen aller Routen der Seite „Konten verwalten“ (`check`: dieser Rechner, Adresse der App, Verwalter, Rate-Limit; KOB-1). Die Vorschau zählt je Art wie beim Auflösen (`householdCounts`). Gelöscht wird nur mit dem eingetippten Namen (`nameConfirmed`, Leerraum am Rand egal). Antwort `{ preview, household, counts }`, nach dem Löschen mit der neuen Liste in `list`. Ablehnungen: unbekannt 404 `household-missing`, nicht verwaist 409 `household-not-orphaned`, falscher Name 400 `household-name`, ungültiger Body 400 `format`. Audit „byl-accounts: Aktion ausgeführt“ mit `household-delete`.
- **Dieselbe Löschlogik:** `deleteHousehold` in `lib/area-move-service.js` löscht alles des Haushalts wie das Auflösen mit „löschen“ (§5 (b)): Daten samt Papierkorb und Quellen, Zähler, Merker des Haushalts aus `inbox_moved_fingerprints`, Einladungscodes, Mitgliedschaften und den Haushalt. Das Auflösen nutzt dieselbe Funktion. Eine Nachricht `byl/household` braucht es nicht, denn es gibt kein Konto, das sie empfangen könnte.
- **Liste:** `GET /api/byl/accounts` nennt je Haushalt ohne aktiven Inhaber `orphaned`.
- **Oberfläche:** Im Abschnitt „Haushalte ohne aktiven Inhaber“ sagt ein verwaister Haushalt „Kein Mitglied hat mehr ein Konto …“ und hat nur den Knopf „Haushalt löschen …“. Der Dialog `HouseholdDeleteDialog` (Modal M) zeigt die Vorschau und verlangt den Namen im Feld (`Field`, UI-1). Ein Fehler steht am Feld, eine Ablehnung des Servers im Dialog. Danach kommt das Flag „Haushalt „…“ gelöscht.“. Andere Haushalte behalten den Inhaberwechsel.

**Alternativen.**

| Alternative | Bewertung |
|---|---|
| Daten ins Private des Verwalters übernehmen | Produktentscheidung dagegen: Es sind nicht seine Daten. |
| Auch Haushalte mit nur deaktivierten Konten löschbar | Das Konto lässt sich wieder aktivieren und ein Inhaber wählen. Löschen wäre endgültig und unnötig. |
| Verwaiste Haushalte automatisch löschen | Endgültiges Löschen ohne Vorschau und Bestätigung; der Verwalter sähe nie, was verloren geht. |

**Neustart nötig** (`neu-starten.bat`): neue Route und geänderte Hooks; die Oberfläche nach dem Build und F5. Keine Migration.

## Nachtrag QT-1 (2026-10-05, [ADR-0067](0067-tickets-als-quelle.md)): Quell- und Folge-Tickets beim Verschieben

- **Entscheidung durch:** Nutzer (Vorgabe zu QT-1: Ticket-Quellen über die neue Bereichsgrenze erscheinen in der Vorschau als Konflikt mit der Wahl „mitnehmen“ oder „Verknüpfung lösen“, analog zu den Abhängigkeiten), Executor (eigene Wahl, Verlauf).

Ein Ticket kann seit QT-1 aus anderen Tickets stammen (`ticket_sources`). Eine solche Verknüpfung liegt immer innerhalb eines Bereichs (ADR-0067 §4). §2 und §3 bleiben, ergänzt um:

- **Konflikt mit eigener Wahl:** Eine Verknüpfung eines verschobenen Tickets zu einem Quell- oder Folge-Ticket, das zurückbleibt (auch einem im Papierkorb), steht in der Vorschau unter `conflicts.ticket_sources` (je `ticket`, `other`, `relation` `source` oder `follow_up`, `trashed`); `needs.ticket_sources` verlangt die Wahl `ticket_sources: take|release` (Werte wie bei den Abhängigkeiten, ohne Wahl 400 `ticket-sources-choice`, „Bitte wählen, ob die Quell- und Folge-Tickets mitkommen oder die Verknüpfung gelöst wird.“). Eine eigene Wahl statt der der Abhängigkeiten, weil beides etwas anderes bedeutet und Ticket-Quellen viel häufiger sind.
- **„mitnehmen“:** Das andere Ticket kommt mit seinen Unteraufgaben mit, wiederholt, bis keine Verknüpfung mehr hinausführt; zusammen mit „mitnehmen“ der Abhängigkeiten über beide Arten (`takeLinked` in `lib/area-move-service.js`). Ein Ticket im Papierkorb kommt nie mit; seine Verknüpfung wird gelöst.
- **„Verknüpfung lösen“:** Die Verknüpfung geht in der Transaktion des Verschiebens, mit „Quelle entfernt“ und „Folge-Ticket entfernt“ im Verlauf beider Tickets (`unlink` in `lib/ticket-source-service.js`).
- **Zwischen verschobenen Tickets** bleiben Verknüpfungen, wie sie sind; sie haben keinen eigenen Bereich. `counts.ticket_sources` zählt sie („2 Verknüpfungen von Quell- und Folge-Tickets“).
- **Auflösen:** „übernehmen“ nimmt alle Tickets mit, also bleiben alle Verknüpfungen; „löschen“ entfernt sie über die Kaskade der Relation.
- **Oberfläche:** `AreaMoveDialog` hat die Gruppe „Quell- und Folge-Tickets, die zurückbleiben“ mit je einer Zeile („HAUS-12 stammt aus HAUS-3 „Heizung prüfen““) und den Wahlen „Mitnehmen: die verknüpften Tickets kommen mit“ und „Verknüpfung lösen: die Tickets bleiben, der Verlauf beider vermerkt es“; „Mitnehmen“ lädt die Vorschau neu (`chooseTicketSources` im `AreaMoveStore`).
- **Tests:** `ticket-sources.test.mjs` (Vorschau, „lösen“, „mitnehmen“, Papierkorb), `area-move-rules.test.mjs`, `area-move.test.ts` (Domain und Dialog).

## Nachtrag MV-2 (2026-10-05): Serien als Ganzes verschieben

- **Entscheidung durch:** Nutzer (Ziel: Tickets, die im privaten Bereich liegen, aber zum Haushalt gehören, ganzheitlich und vollumfänglich umziehen, einzeln wie in größerer Zahl; Produktvorgaben zu Umfang, Vorauswahl, Vorschau, Rechten und Verhalten danach), Advisor (Auftrag MV-2), Executor (Kaskade, Umsetzung, die Punkte „Offenes Angebot“ und „Mitgenommene Serien“ unten).
- **Befund.** Bis hier ließ sich eine Serie nicht als Ganzes verschieben (§2, Tabelle): Eine verschobene Regel ließ ihre bisherigen Tickets zurück, die sich aus der Serie lösten, und ein verschobenes Ticket einer Serie löste sich selbst. Wer die Spülmaschine in den Haushalt bringen wollte, hatte danach zwei halbe Serien.

**Entscheidung.**

- **Wahl „Ganze Serie verschieben“:** `POST /api/byl/area/move` nimmt `series` und `series_done` (Schalter, ohne Angabe aus; anderes 400 `format`). Mit `series` kommt die Regel jedes verschobenen Tickets einer Serie mit, und jede verschobene Regel bringt ihre offenen Vorkommen (`status != done`, nicht im Papierkorb), mit `series_done` auch die erledigten, jeweils mit ihrer Kaskade (Unteraufgaben, Kommentare, Verlauf, Quellen). Die Regel trägt ihre Vorlage selbst (Unteraufgaben der Vorlage, Charm, Farbe, Status beim Anlegen); die Art hat nur das Ticket. Ohne `series` gilt alles wie in §2.
- **Kaskade bis zur Ruhe (`closeOver`):** Serien und „mitnehmen“ (Abhängigkeiten, Ticket-Quellen) schließen sich gegenseitig ein, bis keines mehr ein Ticket oder eine Regel hinzufügt; nimmt „mitnehmen“ ein Ticket einer anderen Serie mit, kommt mit `series` auch diese Serie. Jeder Schritt sieht nur, was neu ist.
- **Konflikte und Rechte für jeden Datensatz:** Projekt, Tags, `@CODE`, Abhängigkeiten und Ticket-Quellen fragen wie in §2 und im Nachtrag QT-1, für Regel und Vorkommen gemeinsam (eine Wahl des Projekts für alle). Die Rechte von §4 gelten für jeden Datensatz der Serie: Fehlt das Recht für ein erledigtes Vorkommen eines anderen Mitglieds, lehnt der Server mit 403 `right` und dessen Key ab; ohne `series_done` bleibt es zurück und geht.
- **Die Serie bleibt intakt:** Ein Vorkommen, das mit seiner Regel umzieht, behält `recurrence` und `occurrence`; sein Verlauf `area_move` hat kein `series`. `next_due` bleibt, die Regel erzeugt danach im Ziel (sie trägt `owner` und `household` des Ziels), und die Logik von WH-1 (ADR-0022 Nachtrag 13, `nextDueAfterDay`) gilt dort unverändert: Erledigen des mitgenommenen Vorkommens legt das nächste im Ziel an, nie für heute oder einen vergangenen Tag. Nummern wie §3, Einträge im Tagesplan des alten Bereichs gehen wie bisher (Update-Hook der Tickets in `day-plans.pb.js`). Erledigte Vorkommen, die ohne `series_done` zurückbleiben, lösen sich wie bisher aus der Serie (`detachStayingInstances`, Verlauf „Wiederholung entfernt“).
- **Vorschau:** `counts.series` (Regeln, die als ganze Serie umziehen), `counts.occurrences` `{ open, done }` (Vorkommen, die mit ihrer Regel in der Serie bleiben) und `series_offer` `{ rules, open, done }`: was die Wahl für die Datensätze des Plans umfasst, unabhängig von ihr. Daraus nimmt der Dialog die Zahl N von „Bisherige erledigte Vorkommen mitnehmen (N)“ und ob er die Wahl überhaupt zeigt.
- **Offenes Angebot (Executor):** `series_offer` rechnet über alle Tickets und Regeln des Plans, nicht nur über die gewählten. So zeigt auch ein Ticket ohne Serie die Wahl, wenn „mitnehmen“ ein Ticket einer Serie mitbringt, statt sie stillschweigend mitzunehmen.
- **Oberfläche:** `AreaMoveDialog` zeigt unter „Das wird verschoben“ die Gruppe „Wiederholung“ mit „Ganze Serie verschieben“ (Regel, ein Ticket einer Serie) bzw. „Bei wiederkehrenden Tickets die ganze Serie mitnehmen“ (Sammelaktion, und ein Ticket, das selbst kein Vorkommen ist) und darunter „Bisherige erledigte Vorkommen mitnehmen (N)“, beide vorgewählt; die zweite nur mit der ersten und nur mit N > 0. Jede Änderung lädt die Vorschau neu wie die erste (die Wahlen zu verknüpften Tickets werden neu gefragt, ein gewähltes Projekt bleibt, solange die Vorschau es anbietet). Die Vorschau nennt „1 Serie mit Regel und Vorlage“, „1 offenes Vorkommen“, „12 erledigte Vorkommen“ und „Die Serie läuft im Ziel weiter; ihr nächstes Ticket entsteht dort.“. Die Wahl gibt es nur für Regeln und Tickets (`offersSeries`); Projekt und Eintrag fragen nicht und senden nichts (der Server kennt die Wahl für jede Art, ein Projekt nimmt mit ihr die Serien seiner Tickets mit).
- **Mitgenommene Serien bei „mitnehmen“ (Executor):** Die Wahl gilt nach dem Grundsatz „alles oder nichts“ für die ganze Kaskade, nicht je Serie; wer eine einzelne Serie ausnehmen will, wählt ab und verschiebt die Tickets einzeln.

**Alternativen.**

| Alternative | Bewertung |
|---|---|
| Serie immer mitnehmen | Bricht E7-4 und nimmt dem Nutzer die Wahl, nur ein Ticket zu verschieben. |
| Eigene Art `series` neben `ticket` und `rule` | Die Sammelaktion mischt Tickets mit und ohne Serie; ein Schalter auf derselben Kaskade deckt alle Wege ab. |
| Erledigte Vorkommen nie mitnehmen | Der Verlauf der Serie bliebe im alten Bereich, getrennt von der Regel; der Nutzer will „vollumfänglich“. |
| Serien je Regel einzeln wählen | Ein Dialog mit einer Liste je Serie; für den Umzug „in einem Rutsch“ zu viel. Die Vorschau nennt die Zahl, und ohne die Wahl geht es wie bisher. |

**Folgen.** Keine Migration. **Neustart nötig** (`neu-starten.bat`) für die Hooks, die Oberfläche nach dem Build und F5. Vor dem Neustart übergeht der Server die beiden Felder und verschiebt wie in E7-4; seine Vorschau nennt kein `series_offer`, also zeigt der Dialog die Wahl nicht. **Tests:** `household-series.test.mjs` (eigene Instanz: A und B im Haushalt, C allein; ganze Serie in beide Richtungen mit und ohne erledigte Vorkommen, Verhalten ohne Wahl, Erledigen danach im Ziel mit Tagesplan, Sammelaktion mit gemischten Tickets, Projekt, `@CODE`, Abhängigkeiten, Ticket-Quellen, Rechte je Datensatz, eine Transaktion), `area-move-rules.test.mjs`, `area-move.test.ts` (Domain), `area-move.test.ts` und `area-move-bulk.test.ts` (Dialog).

## Nachtrag E7-5 (2026-10-05, [ADR-0068](0068-zustaendigkeit.md)): Zuständigkeit beim Verschieben

- **Haushalt → privat:** Jedes verschobene Ticket (auch Unteraufgaben, Tickets im Papierkorb und die Vorkommen einer mitgenommenen Serie nach MV-2) verliert seine Zuständigkeit in derselben Transaktion, mit „Zuständigkeit entfernt“ im Verlauf durch das verschiebende Konto nach dem Eintrag des Verschiebens; jede verschobene Regel verliert Zuständigkeit und Rotation („Keine“, Zeiger 0). Im Privaten gibt es niemanden, dem ein Ticket gehören könnte.
- **Privat → Haushalt:** Nichts zu tun; private Tickets und Regeln haben keine Zuständigkeit. Wer zuständig ist, legt danach ein Mitglied fest.
- **Auflösen** mit „alles ins Private übernehmen“ verschiebt auf demselben Weg; die Mitgliedschaften enden danach und räumen ohnehin auf ([ADR-0058](0058-haushalt-mitgliedschaft-einladungen-rechte.md) Nachtrag E7-5).
- **Belegt in** `tests/integration/assignees.test.mjs` (Ticket und ganze Serie ins Private).

## Nachtrag PL-2 (2026-10-06, [ADR-0068](0068-zustaendigkeit.md) Nachtrag PL-2): Warnung, wenn Zuständigkeit wegfällt

- **Vorschau:** `counts.assignees_cleared` `{ tickets, rules }` zählt, was ins Private seine Zuständigkeit verliert: Tickets des Plans mit Zuständigkeit (samt Unteraufgaben, Papierkorb und Vorkommen einer ganzen Serie nach MV-2) und Regeln mit „Fest“ oder „Abwechselnd“ (`assigneesCleared` in `lib/area-move-service.js`). In den Haushalt und vor der Migration `1790204900` immer 0. „Haushalt auflösen“ nennt es in der Vorschau von `adopt` ebenso, `delete` nennt 0.
- **Dialoge:** `AreaMoveDialog` (einzeln, Sammelaktion, ganze Serie) zeigt unter „Das wird verschoben“ die Warnung „Bei 3 Tickets und 1 Wiederholung fällt die Zuständigkeit weg.“, `HouseholdDissolveDialog` unter der Wahl bei „übernehmen“; ohne Betroffene keine. Eine geänderte Wahl lädt die Vorschau neu und mit ihr die Zahl.
- **Folgen:** Keine Migration; **Neustart nötig** (`neu-starten.bat`) für die Zähler. Vorher nennt der Server sie nicht, und die Dialoge warnen nicht.
