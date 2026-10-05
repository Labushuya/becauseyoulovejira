# ADR-0065: Tagesplan – die Brücke zwischen den Aufgaben des Tages und laufenden Vorhaben

- **Status:** Angenommen und umgesetzt (Paket TP-1); manuelle Prüfungen im Test-Manifest (BYL-E6-1540 bis BYL-E6-1549); Nachtrag PL-1 (Pins reine Anzeige, Art im Duplikat, Einstellungen live); Nachtrag WH-1 (eine Serie höchstens einmal, „überfällig seit <Datum>“)
- **Datum:** 2026-10-05
- **Entscheidung durch:** Nutzer (Zweck: der Tagesplan schlägt vor, der Nutzer stellt ein, übernimmt, greift ein; zwei Pläne getrennt nach Bereich, im Haushalt ein gemeinsamer ohne Sonderrecht; die Art des Tickets als einziger Anker für die Bedeutung des Hakens; die sechs Quellen mit den Modi „aus“, „vorschlagen“, „automatisch übernehmen“ und ihren Standardwerten; Pins sind keine Quelle; Seite mit Vorschlägen, Plan und Pool, Tagesnavigation, „Zum Tagesplan“; die Liste „Für später“), Advisor (Richtschnur für Datenmodell, Routen, Tests und Manifest), Executor (Umsetzung, Rangfolge der Gründe, Vermerk entfernter Tickets, Einzelheiten der Oberfläche)
- **Bezug:** [ADR-0005](0005-zeitzone-europe-berlin.md) (Berliner Tag), [ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) (Erledigen und Wiederöffnen von Serientickets), [ADR-0033](0033-unteraufgaben.md) (Frage nach offenen Unteraufgaben), [ADR-0037](0037-papierkorb.md) (Papierkorb), [ADR-0054](0054-tickets-im-kontext-oeffnen.md) (Tickets im Kontext), [ADR-0057](0057-kontextabhaengige-oberflaeche.md) (für alle Konten auf jedem Gerät), [ADR-0058](0058-haushalt-mitgliedschaft-einladungen-rechte.md) und [ADR-0059](0059-bereiche-privat-und-haushalt.md) (Bereiche, Regeln, keine Verweise über die Grenze), [ADR-0060](0060-einheitliche-eingabeelemente.md) (Felder, Knöpfe, 44 px), [ADR-0061](0061-verschieben-zwischen-bereichen-und-aufloesen.md) (Verschieben), [ADR-0062](0062-charms.md) (Charm im Plan), [ADR-0064](0064-tickets-anpinnen.md) (Pins, Nachtrag dort)
- **Plan:** [docs/plan/tagesplan.md](../plan/tagesplan.md) (Umfang und „Für später“)

## Kontext

Die Tabelle „Aufgaben“ zeigt, was fällig ist, und Filter grenzen es ein. Lang laufende Vorhaben gehen darin unter: ein Sprachkurs über 200 Stunden, ein großes, über Wochen gewachsenes Ticket. Sie werden nie „erledigt“, sollen aber an vielen Tagen ihren Platz bekommen. Der Nutzer will eine Seite, die für den Tag vorschlägt, was ansteht, und die er selbst einstellt, übernimmt und jederzeit anpasst. Im Haushalt planen alle Mitglieder gemeinsam.

## Entscheidung

### 1. Der Anker: die Art eines Tickets

- Neues Feld `tickets.kind`: `task` („Aufgabe“, Standard) oder `ongoing` („Laufendes Vorhaben“). Es wird ausdrücklich gesetzt: im Detail mit dem Schalter „Laufendes Vorhaben“ (Zeile „Art“ nach „Charm“, speichert sofort, mit Hinweis, was der Haken im Plan bedeutet) und im Tagesplan über das Menü eines Eintrags („Als laufendes Vorhaben markieren“ bzw. „Als Aufgabe markieren“). Sichtbar als kleines Abzeichen „Vorhaben“ (Symbol, gedämpfte Linie, Tooltip „Laufendes Vorhaben“) im Detail nach der Überschrift, in der Tabelle „Aufgaben“, in den offenen Tickets eines Projekts, im Plan, in den Vorschlägen und im Pool.
- **Die Art allein bestimmt, was der Haken im Plan bedeutet** (`checkAction`): Bei einer Aufgabe erledigt er das Ticket, bei einem Vorhaben heißt er „für heute erledigt“ und ändert das Ticket nicht. Der Status „In Arbeit“ ist höchstens eine Quelle von Vorschlägen und bestimmt die Bedeutung nie; Pins schon gar nicht (§9).
- Der Modell-Hook gibt jedem neuen Ticket ohne Art `task`, auch Folgetickets einer Serie und Duplikaten. Die Migration macht jedes Ticket von vorher zur Aufgabe (reines SQL, `updated` und Verlauf bleiben). `kind` steht in `TRACKED_FIELDS`; der Verlauf liest „Art: Aufgabe → Laufendes Vorhaben“. PocketBase lehnt andere Werte am Feld ab.

### 2. Zwei Pläne, getrennt nach Bereich

- Ein Plan je Bereich und Tag: im Bereich „Privat“ einer je Konto, im Haushalt **ein gemeinsamer** für alle Mitglieder. Alle Mitglieder wirken gleichberechtigt mit (hinzufügen, entfernen, umsortieren, abhaken, übernehmen, Quellen einstellen); es gibt kein Sonderrecht. Änderungen erscheinen bei allen live. Im Haushalt zeigen Initialen am Eintrag dezent, wer ihn hinzugefügt und wer ihn abgehakt hat; Tooltip und verborgener Text nennen die Namen („Hinzugefügt von Anna Beispiel, abgehakt von Bert Beispiel“), automatisch Übernommenes heißt „Automatisch übernommen (Laufende Vorhaben)“.
- Angezeigt wird der Plan des aktiven Bereichs ([ADR-0059](0059-bereiche-privat-und-haushalt.md)). Ist das Konto in einem Haushalt, steht im Kopf ein Hinweis auf den Plan von heute des anderen Bereichs, nur mit der Zahl seiner Einträge („Im Haushalt: 3 Einträge für heute“ bzw. „Privat: 1 Eintrag für heute“), und ein Knopf zum Wechseln. Inhalte des anderen Bereichs zeigt die Seite nie; der Server nennt nur Zahl und erledigte Zahl.
- Ein Ticket kommt nur in den Plan seines eigenen Bereichs. Die Routen lehnen einen Verweis über die Grenze mit `validation_scope_mismatch` ab, der Modell-Hook der Einträge ebenso, für jeden Schreiber einschließlich des Superusers.

### 3. Datenmodell (Migration `1790204600_day_plans.js`)

| Collection | Felder | Regeln |
|---|---|---|
| `tickets` | neu `kind` (Select `task` \| `ongoing`, nicht Pflicht; der Hook setzt `task`) | wie bisher |
| `day_plans` | `date` (`YYYY-MM-DD`, Muster), `dismissed` (JSON: Tickets, die an dem Tag aus dem Plan genommen wurden), `owner`, `household` (Kaskade), `scope`; eindeutig je (`scope`, `date`) | list/view nach dem Muster der Bereiche (`(owner = auth && household = "") \|\| (household != "" && Mitglied)`), Schreiben `null` |
| `day_plan_items` | `plan` (Kaskade), `ticket` (Kaskade), `position`, `origin` (`manual` \| `due_today` \| `overdue` \| `recurrence` \| `leftover` \| `in_progress` \| `ongoing`), `done_today`, `done_at`, `added_by`, `checked_by`; eindeutig je (`plan`, `ticket`) | list/view nur, wenn der Plan sichtbar ist (dasselbe Muster über `plan.`), Schreiben `null` |
| `day_plan_settings` | `sources` (JSON: Modus je Quelle, fehlende mit Standard), `owner`, `household` (Kaskade), `scope`; eindeutig je `scope` | wie `day_plans` |

- Geschrieben wird nur über die Routen (§4); jeder Schreibweg läuft in einer Transaktion mit allen Prüfungen vor dem ersten Schreiben. Die Hooks setzen `scope` aus `owner` und `household` und prüfen den Bereich des Tickets eines Eintrags.
- Ein Ticket, das endgültig gelöscht wird, nimmt seine Einträge mit (Kaskade), ein Plan seine Einträge, ein Haushalt seine Pläne und Einstellungen (Auflösen, Löschen verwaister Haushalte).
- Additiv bis auf die Art: Der Rückweg entfernt die drei Collections und das Feld; verloren gehen nur Pläne, Einstellungen und Arten.

### 4. Routen (`app/pb_hooks/day-plans.pb.js`, Dienst `lib/day-plan-service.js`, rein `lib/day-plan-rules.js`)

Alle für angemeldete App-Konten auf jedem Gerät (sie tun nichts am Rechner der App, KOB-1). Vor dem Neustart 503 `missing`.

| Route | Wirkung |
|---|---|
| `GET /api/byl/dayplan?scope=&date=` | Plan des Bereichs und Tages (ohne `date` heute). Heute und morgen werden träge angelegt, heute übernimmt die automatischen Quellen; Tage davor sind nur zu lesen und werden nie angelegt; nach morgen 400 `validation_dayplan_future`. Antwort: Plan (mit `dismissed`), `editable`, für heute die übrigen Vorschläge und „Übrig von gestern“, die Einstellungen, der Plan von heute des anderen Bereichs (nur Zahlen), `adopted`. |
| `POST /api/byl/dayplan/items` `{ ticket, scope?, date?, index? }` | „Zum Tagesplan“, „+“ und Ziehen aus dem Pool: in den Plan des Bereichs des Tickets (bzw. von `scope`), am Ende oder an `index`; schon vorhanden `already`; erledigt `validation_dayplan_ticket_done`. |
| `POST /api/byl/dayplan/adopt` `{ scope?, tickets }` | „Übernehmen“: in den Plan von heute, je Ticket mit der Quelle seines Vorschlags (sonst `manual`), höchstens 200. |
| `POST …/items/{id}/check` `{ mode, completion? }` | `check` (der Haken, nach der Art), `today` („Nur für heute abhaken“), `complete` („Vorhaben abschließen …“); `completion` beantwortet die Frage nach offenen Unteraufgaben. |
| `POST …/items/{id}/uncheck` `{ action?, status? }` | Rückgängig bzw. der Haken zurück: die Markierung des Tages oder das Wiederöffnen mit dem Status von vorher. |
| `POST …/items/{id}/tomorrow` | „Auf morgen schieben“, nur aus dem Plan von heute. |
| `POST …/items/{id}/remove` | „Entfernen“. |
| `POST …/items/{id}/move` `{ index }` | Reihenfolge; nummeriert den Plan neu. |
| `POST /api/byl/dayplan/settings` `{ scope?, sources }` | Modi der Quellen eines Bereichs; fehlende Quellen behalten ihren Modus. |

Codes `validation_dayplan_*` mit Texten gleich in Hook und SPA (`domain/day-plan.ts`, Paritätstest). Vergangene Tage antworten auf jede Änderung mit `validation_dayplan_readonly`; ein Plan, den das Konto nicht sieht, ist „nicht gefunden“ (404).

### 5. Vorschläge

- **Quellen und Standardwerte:** Laufende Vorhaben (automatisch übernehmen), Heute fällig (vorschlagen), Überfällig (vorschlagen), Wiederholung von heute (vorschlagen), Übrig von gestern (vorschlagen), In Arbeit (vorschlagen). Jede Quelle lässt sich auf „Aus“, „Vorschlagen“ oder „Automatisch übernehmen“ stellen („Einstellen“ neben „Vorschläge“). Privat stellt das Konto für sich ein, den Haushalt jedes Mitglied für den gemeinsamen Plan.
- **Definitionen** (rein in `matchingSources`, nur offene Tickets des Bereichs, nie im Papierkorb):

  | Quelle | Trifft zu, wenn | Grund |
  |---|---|---|
  | Laufende Vorhaben | Art „Laufendes Vorhaben“ | „laufendes Vorhaben“ |
  | Wiederholung von heute | Ticket einer Serie, heute fällig | „Wiederholung“ |
  | Übrig von gestern | im Plan von gestern, weder erledigt noch für heute abgehakt, Ticket noch offen | „übrig von gestern“ |
  | Überfällig | fällig vor heute | „überfällig seit 3 Tagen“ *(seit Nachtrag WH-1 „überfällig seit 05.10.“)* |
  | Heute fällig | fällig heute | „heute fällig“ |
  | In Arbeit | Status „In Arbeit“ | „in Arbeit“ |

- **„Heute“** ist der Berliner Tag aus `lib/berlin-time.js` bzw. `domain/berlin-date.ts`, dieselbe Funktion und Zone wie „Heute fällig“ der Liste (`dueBucket`), nie eine Zeitzone der Laufzeit.
- **Mehrere Quellen:** Ein Ticket kann mehrere treffen. Es zählt der stärkste Modus seiner Quellen (automatisch vor vorschlagen); seine Herkunft ist die erste Quelle dieses Modus in der Rangfolge Laufende Vorhaben, Wiederholung, Übrig von gestern, Überfällig, Heute fällig, In Arbeit (die genaueste zuerst). Der Vorschlag nennt alle Gründe der Quellen, die nicht aus sind, etwa „Wiederholung · heute fällig“. Sortiert nach Herkunft, Fälligkeit (ohne zuletzt), Priorität, Anlage.
- **Was im Plan steht oder an dem Tag daraus entfernt wurde** (`dismissed`, auch „Auf morgen schieben“), wird nicht mehr vorgeschlagen und nicht automatisch übernommen. Erst ein Hinzufügen von Hand nimmt den Vermerk zurück.
- **Automatisch übernehmen:** Jeder Abruf des Plans von heute legt ihn an, falls er fehlt, und übernimmt die Tickets der automatischen Quellen ohne Rückfrage. Es gibt keinen Cron: Der Plan entsteht träge beim ersten Abruf des Tages. Idempotent und sicher gegen gleichzeitige Abrufe (zwei Mitglieder öffnen zugleich): PocketBase führt jede Transaktion auf einer Verbindung aus, sodass sie nacheinander laufen; die eindeutigen Indizes (`scope`, `date`) und (`plan`, `ticket`) sind das Netz. Wird ein Ticket am Tag zu einem laufenden Vorhaben oder fällig, rechnet die SPA es sofort (gleiche Regeln) und fragt den Plan einmal neu ab; der Server übernimmt es.
- **Gleichstand Hook ↔ Web:** Die SPA rechnet die Vorschläge aus ihren live gehaltenen offenen Tickets (Liste der Ansicht „Aufgaben“), der Server für die automatischen Quellen und die Herkunft beim Übernehmen. Beide nutzen dieselben reinen Regeln (`suggestionsOf`), ein Paritätstest vergleicht sie auf 400 erzeugten Plänen.

### 6. Abhaken je Art

- **Aufgabe:** Der Haken erledigt das Ticket über den vorhandenen Weg: Die Route setzt den Status im Speichern des Tickets (`txApp.save`) mit dem handelnden Konto, also laufen alle Hooks wie in der Liste: `completed_at`, Verlauf, Wiederholung (Folgeticket bzw. nächster Termin nach dem Commit), das Lösen der Pins ([ADR-0064](0064-tickets-anpinnen.md)) und die Frage nach offenen blockierenden Unteraufgaben (`validation_parent_open_children`, die Seite fragt mit dem Dialog der Liste und sendet die Antwort mit). Das Flag „KEY erledigt.“ bietet „Rückgängig“: Es öffnet das Ticket mit dem Status von vorher wieder, wieder über das Speichern des Tickets (Serien entscheiden wie in der Liste, eine Ablehnung steht im Fehler-Flag).
- **Laufendes Vorhaben:** Der Haken heißt „für heute erledigt“ (Name des Kästchens „KEY für heute erledigt“). Vermerkt wird das nur am Eintrag dieses Tages (`done_today`, `done_at`, `checked_by`); das Ticket bleibt offen und unverändert. Abschließen geht nur bewusst über „Vorhaben abschließen …“ mit der Rückfrage „KEY abschließen?“.
- **Die andere Variante im Menü:** bei Aufgaben „Nur für heute abhaken“ (nur der Eintrag), bei Vorhaben „Vorhaben abschließen …“.
- Ein Eintrag zählt als erledigt, wenn er für heute abgehakt oder sein Ticket erledigt ist (`isDone`); der Kopf zeigt „3/7 erledigt“ (für Screenreader „3 von 7 Einträgen erledigt“). Der Haken eines erledigten Eintrags nimmt erst die Markierung des Tages zurück, sonst öffnet er das Ticket wieder.

### 7. Manuell eingreifen

- **Seite** `/tagesplan` (Eintrag „Tagesplan“ in der Abschnittsleiste direkt nach „Aufgaben“): Kopf mit Tag („Heute, Montag, 5. Oktober 2026“), Fortschritt und Hinweis auf den anderen Bereich; der Abschnitt „Vorschläge“ (Überschrift als Disclosure-Knopf, einklappbar) mit Gründen, Auswahl, „Übernehmen (N)“, „Alle übernehmen“ und „Einstellen“; der Plan; der **Pool** mit den offenen Tickets des Bereichs, die nicht im Plan stehen (Suche über Key und Titel mit der Normalisierung des TicketPickers, „+“ je Zeile, Ziehen auf den Plan an eine Stelle). Auf breiten Bildschirmen (ab 60rem) steht der Pool neben dem Plan, schmaler darunter.
- **Tickets öffnen im Tagesplan** ([ADR-0054](0054-tickets-im-kontext-oeffnen.md)): `/tagesplan/tickets/<id>` und `…/voll` mit dem Tag der Adresse (`tag`); × führt zum Plan zurück und gibt den Fokus dem Link.
- **„Zum Tagesplan“** steht im Menü „•••“ jedes Tickets (Detail, Vollansicht, Liste, Kalender, offene Tickets eines Projekts), nicht bei erledigten; es nimmt das Ticket in den Plan von heute seines Bereichs auf, das Flag bietet „Tagesplan öffnen“.
- **Reihenfolge:** Ziehen am Griff (nativ, ohne Bibliothek; eine Linie der Marke zeigt die Stelle), die Knöpfe „KEY nach oben“ und „KEY nach unten“ (der erste bzw. letzte gesperrt) und Alt+Pfeil hoch/runter von jedem Bedienelement des Eintrags; der Fokus bleibt, eine Statusregion sagt „KEY steht jetzt an Stelle 2 von 5.“. Die Liste ordnet sofort um und setzt bei einer Ablehnung zurück.
- **Je Eintrag:** Haken; Menü mit der anderen Variante, „Auf morgen schieben“ (nur heute; der Eintrag kommt ans Ende von morgen), Art umstellen und „Entfernen“ (Flag mit „Rückgängig“, das ihn an seine Stelle zurückbringt).
- **Tage:** Pfeile „Vortag“ und „Folgetag“, „Heute“ auf jedem anderen Tag. Vergangene Tage sind schreibgeschützt (Hinweis, keine Haken, keine Menüs, kein Pool, keine Vorschläge); morgen ist planbar; weiter voraus nicht.
- **Am Handy:** Jedes Ziel 44 px ([ADR-0060](0060-einheitliche-eingabeelemente.md) §2), der Griff entfällt (Ziehen ist für die Maus); „+“ und die Knöpfe sind der Weg.
- **Darstellung:** Charm vor dem Titel ([ADR-0062](0062-charms.md)), Abzeichen „Vorhaben“, Erledigtes gedämpft und durchgestrichen.

### 8. Verschieben, Papierkorb, Löschen

- Ein Ticket, das in den anderen Bereich wechselt ([ADR-0061](0061-verschieben-zwischen-bereichen-und-aufloesen.md)), verliert seine Einträge in den Plänen des alten Bereichs; eines im Papierkorb alle. Das geschieht im Modell-Hook nach dem Speichern, also in der Transaktion der Route, die es schreibt (Verschieben, Auflösen, Papierkorb); die Tabs mit dem Plan bekommen das `delete` nach dem Commit. Wiederherstellen bringt keinen Eintrag zurück.
- Endgültiges Löschen nimmt die Einträge über die Kaskade der Relation mit.

### 9. Warum Pins keine Quelle sind

Pins ([ADR-0064](0064-tickets-anpinnen.md)) sind eine persönliche Anzeige in „Aufgaben“: Sie gehören einem Konto, auch im Haushalt, und ändern sich ohne Folgen. Der Tagesplan dagegen ist im Haushalt gemeinsam, und sein Haken hat Folgen (erledigen). Eine Quelle „Angeheftet“ würde die persönliche Anzeige eines Mitglieds in den gemeinsamen Plan tragen und zwei Begriffe vermischen, die der Nutzer ausdrücklich trennt (Nutzerentscheidung zu TP-1). Laufende Vorhaben bekommen ihren Platz über die Art, nicht über einen Pin; ADR-0064 nimmt seinen Satz über eine spätere Quelle zurück (Nachtrag dort).

### 10. Realtime und Zustand der Seite

`DayPlanStore` (`stores/day-plan.svelte.ts`, je Layout von `/tagesplan`): lädt den Plan des Tages der Adresse im Bereich des Tabs, abonniert die Einträge des Plans (`plan = <id>`, mit dem Ticket ausgeklappt) und den Plan selbst (`dismissed`), folgt den Tickets des Bereichs (Zustand der Tickets im Plan, auch wenn die Liste ein erledigtes nicht mehr führt), lädt nach einem Neuverbinden, einem Wechsel des Bereichs und um Mitternacht (Uhr der Liste) neu. Die Einstellungen kommen mit jedem Abruf (nicht live). `DayPlanEntryStore` im `(app)`-Layout trägt „Zum Tagesplan“.

### 11. Vor dem Neustart

Bis zum Neustart nach dem Update kennt der Server weder die Art noch die Pläne: Die Seite sagt „Der Tagesplan ist nach dem nächsten Neustart verfügbar.“ mit dem Text für den Kontext, der Schalter und das Abzeichen fehlen (`Ticket.kind` undefiniert), und alle Hooks verhalten sich wie vorher (`ready`).

## Alternativen

| Alternative | Bewertung |
|---|---|
| Bedeutung des Hakens aus dem Status („In Arbeit“) oder aus einem Pin ableiten | Mehrdeutig und unbemerkt änderbar; der Nutzer will einen eindeutigen Anker. Die Art wird ausdrücklich gesetzt. |
| Plan per Cron um Mitternacht anlegen | Legt Pläne für Tage an, an denen niemand plant, und läuft auch ohne Tab; träge beim ersten Abruf ist einfacher und genügt, weil die automatischen Quellen erst beim Öffnen gebraucht werden. |
| Automatische Übernahme nur beim Anlegen des Plans | Ein am Tag markiertes Vorhaben käme nicht in den Plan, und ein für morgen schon angelegter Plan bekäme seine automatischen Tickets nie. Jeder Abruf von heute übernimmt, idempotent, und `dismissed` hält Entferntes fern. |
| Vorschläge nur im Server rechnen | Jede Änderung eines Tickets bräuchte einen neuen Abruf; die SPA hat die offenen Tickets live. Beide rechnen mit denselben Regeln, ein Paritätstest hält sie gleich. |
| Einträge über die Record-API schreiben | Anlegen braucht den Plan (träge), eine Position und die Eindeutigkeit; Abhaken ändert Eintrag und Ticket; Verschieben zwei Pläne. Eigene Routen in einer Transaktion sind eindeutiger, die Regeln der Collections bleiben lesend. |
| Einstellungen als Felder je Quelle | Jede neue Quelle (etwa „Mir zugewiesen“ mit E7-5) bräuchte eine Migration; JSON mit reiner Prüfung (`sourcesViolation`) und Standardwerten genügt. |
| Ziehen mit einer Bibliothek | Keine neue Abhängigkeit (Vorgabe); natives Drag & Drop reicht für Maus und Trackpad, am Handy sind „+“ und die Knöpfe der Weg. |

## Konsequenzen

- **Neustart nötig** (`neu-starten.bat`): Migration `1790204600` und neue Hooks und Routen; die Oberfläche nach dem Build und F5.
- Neue Module: `app/pb_hooks/day-plans.pb.js`, `lib/day-plan-service.js`, `lib/day-plan-rules.js`; `web/src/lib/domain/day-plan.ts`, `data/day-plan.ts`, `stores/day-plan.svelte.ts`, `components/KindBadge.svelte`, `components/day-plan/*`, Routen unter `routes/(app)/tagesplan/`. `ticket-service.js` exportiert die Schlüssel der Frage nach Unteraufgaben.
- **Tests:** `tests/integration/day-plan.test.mjs` (eigene Instanz, A und B im Haushalt, C allein, Uhr über `tests/fixtures/pb_hooks/day-plan-clock.pb.js`), `tests/unit/day-plan-rules.test.mjs`, `tests/unit/web-day-plan.test.mjs` (Gleichstand), Rückweg in `migrations-rollback.test.mjs`, `hooks-before-migration.test.mjs`; in `web/` Domain, Store, Seite, Layout, Menü, Panel, Verlauf. Test-Manifest: BYL-E6-1530 bis BYL-E6-1538, manuell BYL-E6-1540 bis BYL-E6-1549.
- **Grenzen:** Duplizieren übernimmt die Art nicht (das Duplikat ist eine Aufgabe); die Einstellungen der Quellen erscheinen in anderen Tabs erst beim nächsten Abruf; „Zeiten und Zeitfenster“, Verfügbarkeit im Haushalt, Rhythmus und Ziel je Vorhaben sowie die Quelle „Mir zugewiesen“ stehen im Plan unter „Für später“. Die ersten beiden Grenzen hebt der Nachtrag PL-1 auf.

## Nachtrag PL-1 (2026-10-05): Pins reine Anzeige, Art im Duplikat, Einstellungen live

Der Text oben bleibt; dieser Nachtrag stellt §9 klar und ändert §1, §10 und die Grenzen.

- **Entscheidung durch:** Nutzer (Produktentscheidung: Pins sind reine Anzeige und weder Quelle noch Ausschlussgrund; Duplizieren übernimmt die Art wie den Charm), Advisor (Einstellungen live nur, wenn mit dem vorhandenen Realtime-Muster billig), Executor (Befund, Umsetzung, Tests).

1. **Pins (§9 klargestellt):** „Keine Quelle“ heißt nicht „ausgeschlossen“. Ein angeheftetes Ticket wird genau dann vorgeschlagen bzw. automatisch übernommen, wenn eine seiner Quellen zutrifft, und steht wie jedes offene Ticket im Pool. Befund: Hook (`day-plan-rules.js`, `day-plan-service.js`) und Web-Spiegel (`domain/day-plan.ts`, `DayPlanStore`) enthielten keinen Bezug auf Pins; die SPA rechnet aus `TicketListStore.open` mit allen offenen Tickets, auch den angehefteten. Der Gleichstand-Test `tests/unit/web-day-plan.test.mjs` bleibt unverändert grün. Neue Tests: `day-plan.test.mjs` („treats a pin as display only …“) und `day-plan-store.test.ts` (echter `TicketListStore` mit `PinStore`). Nachtrag PL-1 in [ADR-0064](0064-tickets-anpinnen.md).
2. **Art im Duplikat (ändert §1):** „Duplizieren …“ ([ADR-0045](0045-ticket-duplizieren.md)) übernimmt die Art wie den Charm: immer, ohne Schalter und ohne Eintrag im Verlauf; jede neue Unteraufgabe die Art ihrer eigenen (`withKind` in `lib/duplicate-service.js`). Den Standard `task` setzt der Modell-Hook nur noch, wo keine Art genannt ist (Folgetickets einer Serie, neue Tickets). Vor der Migration liest der Dienst leer und setzt nichts. Test: `ticket-duplicate.test.mjs` („takes the kind of the original and of each sub-ticket over …“).
3. **Einstellungen live (ändert §10):** Der `DayPlanStore` abonniert zusätzlich `day_plan_settings` des Bereichs des gezeigten Plans (`subscribeDayPlanSettings` in `data/day-plan.ts`, Filter `scope`, mit dem Plan neu abonniert, Rückfall nach einer Störung: Plan neu laden). Ändert ein anderer Tab oder ein anderes Mitglied die Quellen, folgen Einstellungen und Vorschläge sofort; wird dabei eine Quelle auf „Automatisch übernehmen“ gestellt, fragt der Store den Plan wie beim eigenen Speichern einmal neu ab, und der Server übernimmt. Die Leseregeln der Collection (Muster der Bereiche) bestimmen, wer das Ereignis bekommt; Konten außerhalb des Haushalts bekommen nichts. Kein neuer Hook, keine Migration. Tests: `day-plan.test.mjs` („brings a change of the settings live …“, Datenschicht gegen die Wegwerf-Instanz, mit C ohne Ereignis) und `day-plan-store.test.ts` („follows the settings of the area …“).
4. **Neustart:** nötig wegen `lib/duplicate-service.js` (Art im Duplikat); die übrigen Punkte wirken nach dem Build und F5.

## Nachtrag WH-1 (2026-10-05): Eine Serie höchstens einmal, „überfällig seit <Datum>“

Der Text oben bleibt; dieser Nachtrag ändert §5 (Tabelle der Quellen, Vorschläge) und gehört zu [ADR-0022](0022-erzeugung-von-instanzen.md) Nachtrag 13.

- **Entscheidung durch:** Nutzer (Produktentscheidung „nur das aktuelle Vorkommen zählt“: in den Quellen Überfällig, Wiederholung von heute und Übrig von gestern jede Serie höchstens einmal, mit dem Grund „überfällig seit …“; Vorgänger desselben Tickets werden nicht vorgeschlagen), Executor (Befund, Regel für die Serie, Gleichstand).

1. **Ursache des doppelten Vorschlags:** Der Plan schlug das Folgeticket vor, das das Erledigen eines überfälligen Vorkommens heute oder in der Vergangenheit anlegte („Wiederholung · heute fällig“ bzw. „überfällig“), obwohl der Nutzer die Aufgabe gerade erledigt hatte. Behoben in der Erzeugung (ADR-0022 Nachtrag 13): Das Folgeticket fällt jetzt auf den ersten Termin nach dem Erledigungstag, der Plan schlägt von der Serie erst wieder etwas vor, wenn es fällig ist.
2. **Eine Serie höchstens einmal (§5):** `suggestionsOf` (Hook und Spiegel) nimmt je Serie nur das aktuelle Vorkommen, das offene mit der spätesten Fälligkeit (ohne Fälligkeit zählt als früheste, dann die spätere Anlage, dann die größere ID), und schlägt aus der Serie nichts vor, solange eines ihrer Tickets im Plan steht. Das gilt für jede Quelle; ein heute entfernter Vorschlag (`dismissed`) lässt kein älteres nachrücken. Die Serie eines Tickets ist `seriesKeyOf(recurrence, occurrence)`: die Regel, wenn `occurrence` leer ist. Tickets mit „Verpasste Termine nachholen“ (`occurrence` gesetzt) zählen je Termin für sich, denn mit dem Schalter zählt jeder Termin (ADR-0022 Nachtrag 13). Ohne Schalter lässt der Teilindex ohnehin nur ein offenes Ticket je Regel zu; die Regel sichert die Vorschläge zusätzlich ab, auch gegen ältere Daten. Die SPA liest dafür `occurrence` mit den Listenfeldern (`TICKET_LIST_FIELDS`; `TicketSummary.occurrence` nur, wenn gesetzt), `factsOf` gibt `series` weiter.
3. **Grund „überfällig seit 05.10.“ statt „überfällig seit 3 Tagen“:** das Datum der Fälligkeit, im laufenden Jahr ohne Jahreszahl (`overdueSinceText` im Hook `lib/day-plan-rules.js` und in `domain/due-label.ts`). Ein mitgeschleiftes Vorkommen trägt als Fälligkeit seinen ältesten verpassten Termin, der Grund nennt also, seit wann die Serie liegt. Derselbe Text steht in „Aufgaben“ (Spalte „Fällig“, statt „seit N Tagen überfällig“ und „gestern“; Screenreader hören das volle Datum), im Kalender (Gruppe „Überfällig“) und neu im Ticket unter der Fälligkeit (fett mit Uhr, nie rot, beschreibt das Feld per `aria-describedby`; Panel und Vollansicht).
4. **Gleichstand Hook ↔ Web:** `tests/unit/web-day-plan.test.mjs` erzeugt jetzt auch mehrere offene Tickets derselben Serie, vergleicht die Vorschläge auf 400 Plänen, `seriesKeyOf` und den Grund samt `relativeDue` der Liste. Neue Fälle in `day-plan-rules.test.mjs`; `day-plan.test.mjs`, `day-plan-store.test.ts` und `day-plan-view.test.ts` nennen den neuen Grund; `recurrence-current.test.mjs` prüft die Vorschläge vor und nach dem Erledigen gegen die Wegwerf-Instanz.
5. **Keine Migration; Neustart nötig** (Hooks `lib/day-plan-rules.js`, `lib/day-plan-service.js`), die Oberfläche nach dem Build und F5.
