# ADR-0061: Verschieben zwischen Bereichen und Auflösen (E7-4)

- **Status:** Angenommen und umgesetzt (E7-4, [Plan E7 „Haushalt“](../plan/e7-haushalt.md) §3b)
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
- **Grenzen:** Ein Eintrag, der den Bereich seiner Verbindung verlässt, schützt diesen Bereich nicht mehr vor erneutem Eintreffen (Fingerabdrücke gelten je Bereich); eine Vollsuche des Postfachs kann ihn dort neu anlegen. *(Behoben mit dem Nachtrag E7-4b.)* Ein Haushalt, dessen Inhaber gelöscht wurde und der kein Mitglied mehr hat, bleibt ohne Inhaber (Folgepunkt im Plan).
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
