# Plan „Wiederholungen: Werte von Folgetickets“ (WV)

- **Stand:** umgesetzt (2026-09-30), ein Paket WV in einem PR. Braucht einen Neustart (`neu-starten.bat`) für die Migration `1790202500_recurrence_initial_status.js`; bis dahin verhält sich alles wie vorher, nur „Status beim Anlegen“ fehlt. Offen sind die manuellen Browser-Prüfungen (BYL-E6-586 bis BYL-E6-588).
- **Grundlage:** Beobachtung des Nutzers (§1), Entscheidungen des Advisors (§3); [ADR-0021](../adr/0021-regelmodell-wiederkehrende-aufgaben.md) bis [ADR-0024](../adr/0024-serien-aus-kalendern.md) mit allen Nachträgen, [ADR-0025](../adr/0025-ui-konsistenz-overlay-system.md), [ADR-0026](../adr/0026-einstellungsbereich-und-hinweis-bausteine.md), [ADR-0009](../adr/0009-fehlerfarbe.md), [ADR-0036](../adr/0036-sammelbearbeitung-inline-und-oeffnungsmodus.md), [ADR-0037](../adr/0037-papierkorb.md), [Plan „Wiederholungen verständlich machen“](wiederholungen-klarheit.md).
- **Einordnung:** Paketkürzel `WV`, Manifest-Block ab `BYL-E6-580`. Entscheidungen als Nachträge: [ADR-0022](../adr/0022-erzeugung-von-instanzen.md) Nachtrag 8 („Status beim Anlegen“, keine Abfrage beim Erzeugen), [ADR-0023](../adr/0023-lebenszyklus-von-regeln-und-instanzen.md) Nachtrag 6 (Vorlage am Ticket, „Auch für künftige Tickets übernehmen“), [ADR-0024](../adr/0024-serien-aus-kalendern.md) Nachtrag 3 (Vorlage aus dem Formular mit Status). Keine neue ADR.

## 1. Beobachtung

„Wiederholungen, die angelegt wurden, erstellen das Folgeticket mit falscher Priorität (offen, statt derzeit ausgewähltem Status oder gar Abfrage an User für manuellen Override von Werten)“

„Offen“ ist ein Status, keine Priorität: Der Bericht beschreibt, dass das Folgeticket als „Offen“ entstand, obwohl am Ticket ein anderer Status gewählt war.

## 2. Befund (Phase 1): kein Fehler in der Übernahme, sondern fester Status und Schnappschuss

Geprüft wurde jeder Weg, auf dem eine Regel entsteht oder ihre Vorlage sich ändert, jeweils bis zum Folgeticket:

| Weg | Woher die Vorlage kommt | Ergebnis vorher |
|---|---|---|
| „Wiederholen…“ am Ticket (Panel, Vollansicht, Angebot aus dem Eingang) | `RecurrenceStore.repeat(ticket)`: Titel, Beschreibung, Projekt, Tags, Priorität des Tickets im Moment des Einrichtens | Priorität richtig, Status nicht übernommen |
| „Neues Ticket“ mit „Wiederholen“ | erst `createTicket` mit den Werten des Formulars, dann `repeatCreated(result.ticket)` → `repeat` mit der Antwort des Servers | Priorität richtig (aus dem Formular), Status nicht übernommen |
| Kalenderserie („Als Wiederholung übernehmen“) | derselbe Zwei-Schritt-Weg wie „Neues Ticket“ ([ADR-0024](../adr/0024-serien-aus-kalendern.md)) | wie „Neues Ticket“ |
| „Neue Regel“ unter `/wiederholungen` | Formular „Vorlage“ im Regel-Panel, Priorität „Mittel“ vorbelegt | Priorität richtig, Status gab es nicht |
| „Vorlage“ im Regel-Panel ändern | `updateRule` mit der ganzen Vorlage | richtig, wirkt auf künftige Tickets (ADR-0023 §5) |
| Sammel- und Inline-Bearbeitung, Panel, Vollansicht | ändern nur das Ticket (`PATCH tickets`), nie die Regel | wie beabsichtigt: nur dieses Ticket |
| Erzeugen (`newInstance` in `lib/recurrence-service.js`) | Titel, Beschreibung, Projekt, Tags, Priorität (leer → „medium“) aus der Regel, **`status = 'open'` fest** | Priorität aus der Vorlage, Status immer „Offen“ |

- Der Hook übernimmt die Priorität unverändert (`ticket.set('priority', rule.getString('priority') || 'medium')`); `createDefaults` des Ticket-Hooks setzt nur leere Werte. Kein Feldname ist vertauscht, kein Weg sendet eine leere Priorität. Das belegten schon `recurrence-generate.test.mjs` (Regel → Instanz mit `high`) und `web-data-recurrence.test.mjs` (Vorlage bleibt, offene Instanz bleibt); neu belegt jetzt `web-data-recurrence.test.mjs` jeden Anlegeweg bis zum Folgeticket („from every way a rule starts to the next ticket (plan WV)“) und `recurrence-store.test.ts` die Entwürfe, die der Store sendet.
- **Ursache der Beobachtung:** (1) Der Status des Folgetickets war fest „Offen“ (ADR-0022 §2.3), ein am Ticket gewählter Status („In Arbeit“, „Backlog“, „Wartet“) ging nie in die Vorlage. (2) Die Vorlage ist ein Schnappschuss beim Einrichten: Wer nach „Wiederholen…“ die Priorität am Ticket änderte, bekam im Folgeticket weiter die alte, und die Vorlage ließ sich nur im Regel-Panel unter „Wiederholungen“ ändern, am Ticket war sie nicht zu sehen. Beides ist Verhalten nach den ADRs, kein Programmfehler; der Test „keeps the template as set up until the change of a ticket is taken over“ hält das Schnappschuss-Verhalten fest.
- Damit war kein Bugfix im engeren Sinn nötig; die Regressionstests sichern die Übernahme aller Werte auf allen Wegen ab, damit ein späterer Umbau (etwa ein weiterer Anlegeweg) sie nicht verliert.

## 3. Entscheidungen

| Datum | Entscheidung |
|---|---|
| 2026-09-30 | **„Status beim Anlegen“ als Feld der Regel mit Migration:** Die Vorlage liegt in einzelnen Feldern von `recurrence_rules`, ein JSON-Feld gibt es nicht; ein Status ohne Migration hätte ein fremdes Feld missbrauchen müssen. Additive Migration `1790202500_recurrence_initial_status.js` (select `backlog`, `open`, `in_progress`, `waiting`), keine Zeilenänderung, leerer Wert = „Offen“, Rückweg entfernt nur das Feld (Rollback-Test mit Daten). `done` ist kein Wert. Vor dem Neustart: Hooks wie bisher, SPA ohne Feld (`initialStatusReady`). |
| 2026-09-30 | **Schnappschuss mit Status:** Eine Regel aus einem Ticket („Wiederholen…“, „Neues Ticket“, Kalenderserie) übernimmt auch dessen Status, denn genau das erwartete der Nutzer („derzeit ausgewählter Status“); „Neue Regel“ beginnt mit „Offen“ (Standard des Advisors). Ein erledigtes Ticket beginnt nie eine Serie (Hook-Regel), sein Status würde „Offen“. Der Dialog „Wiederholen…“ nennt vorher, was künftige Tickets bekommen, „Neues Ticket“ sagt es im Abschnitt. |
| 2026-09-30 | **Vorlage am Ticket, inline:** Zeile „Künftige Tickets: Priorität · Projekt · Tags · Status beim Anlegen“ mit „Bearbeiten“ im Abschnitt „Wiederholt sich“ von Panel und Vollansicht; bearbeitet wird im Abschnitt selbst, kein Dialog aus dem Dialog (ADR-0025 §3). Dieselben Felder wie im Regel-Panel über den neuen Baustein `RecurrenceTemplateFields` (das Regel-Panel nutzt ihn jetzt auch), `StatusSelect` bekam dafür `statuses` und `describedby`. Gesendet werden nur geänderte Felder. Der Entwurf liegt im `RecurrenceStore`, damit der Wechsel Panel ↔ Vollansicht ihn behält und das Verlassen des Tickets fragt. |
| 2026-09-30 | **„Auch für künftige Tickets übernehmen“ als Flag nach dem Speichern:** keine Frage vorher, einheitlich für Panel, Vollansicht und Zellen, bei Sammelaktionen ein Flag für alle betroffenen Regeln nach dem Ergebnis, das „Rückgängig“ zurückzieht. Nur Titel, Beschreibung, Priorität, Projekt, Tags; nie Status, Fälligkeit, Abhaken; nur offene Tickets einer Serie; nur Felder, in denen die Vorlage abweicht. Tags als Änderung (hinzugefügt/entfernt), damit eine Sammelaktion „Tags hinzufügen“ in der Vorlage dieselben Tags hinzufügt statt die ganze Liste eines Tickets zu kopieren. Die reinen Regeln stehen in `domain/series-template.ts`, die Stores bekommen die Regeln als `SeriesChangeSink` (der `RecurrenceStore`, im `(app)`-Layout jetzt vor der Ticket-Liste erzeugt). |
| 2026-09-30 | **Keine Abfrage beim Erzeugen:** Folgetickets entstehen zeitgesteuert im Hintergrund (Cron, Start, nach dem Commit des Erledigens), ohne Anfrage, die warten könnte. Begründet in ADR-0022 Nachtrag 8 und in der Hilfe. |
| 2026-09-30 | **#158 nicht in dieser Migration:** Der Plan „Wiederholungen verständlich machen“ (§5) wollte das Statusfeld für den Rückstand mit der nächsten ohnehin nötigen Migration an `recurrence_rules` einführen. Es hätte Hooks, SPA, den Spiegel der Hilfe-Beispiele und ihre Paritätstests umgebaut und diesen Fehlerbericht mit einem fachfremden Umbau vermischt; es bleibt offen (siehe §5). |

## 4. Umsetzung

- **Hooks:** `lib/recurrence-rules.js` (`INITIAL_STATUSES`, `initialStatusOf`, `initialStatusViolation`, Text `validation_recurrence_initial_status`), `lib/recurrence-service.js` (`initialStatusReady`, `checkInitialStatus` in `prepareCreate` und `prepareUpdate`, `newInstance` mit dem Status der Vorlage).
- **Migration:** `app/pb_migrations/1790202500_recurrence_initial_status.js`.
- **SPA, rein:** `domain/series-template.ts` (Vorlage einer Regel und eines Tickets, Zeile „Künftige Tickets“, Änderungen und Angebote, Texte der Flags, `SeriesChangeSink`), `RecurrenceRule.initialStatus`, Text in `RECURRENCE_MESSAGES`.
- **SPA, Daten und Stores:** `data/recurrence.ts` (`initial_status`, `initialStatusReady`), `RecurrenceStore` (`statusReady`, `repeat` mit `ticketTemplate`, Entwurf der Vorlage, `offerTemplate`, `withdrawTemplateOffer`), `TicketDetailStore` (nach dem Speichern von Titel, Beschreibung, Priorität, Projekt, Tags), `TicketListStore.changeField`, `BulkEditStore` (Feldänderungen, Rückzug bei „Rückgängig“).
- **SPA, Oberfläche:** `RecurrenceTemplateFields.svelte` (neu), `RecurrencePanel.svelte`, `RecurrenceSummary.svelte` (Zeile und Editor, jetzt ganz auf Schriftgrößen-Tokens), `RecurrenceDialog.svelte` (Hinweis), `NewTicketForm.svelte` (Hinweis), `StatusSelect.svelte`, `help/RecurrenceHelp.svelte` („Gut zu wissen“), Routen des Tickets (Katalog an „Wiederholt sich“, Frage beim Verlassen) und der Regeln (Feld nach der Migration, Schriftgrößen-Tokens), `(app)/+layout.svelte` (Reihenfolge der Stores).

## 5. Offene Punkte

- Manuelle Browser-Prüfungen BYL-E6-586 (Vorlage am Ticket), BYL-E6-587 (Flag in Panel, Vollansicht, Zelle, Sammelaktion), BYL-E6-588 (Status beim Anlegen vor und nach dem Neustart).
- **Technische Schuld [#158](https://github.com/Labushuya/becauseyoulovejira/issues/158)** bleibt: Das Statusfeld für „Rückstand wartet“ kam nicht mit dieser Migration (§3). Es braucht eine eigene Migration oder die nächste an `recurrence_rules`.
