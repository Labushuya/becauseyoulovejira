# ADR-0068: Zuständigkeit im Haushalt – Feld, Initialen, „Mir zugewiesen“, Hinweis, Rotation der Wiederholungen

- **Status:** Angenommen und umgesetzt (Paket E7-5, [Plan E7 „Haushalt“](../plan/e7-haushalt.md)); manuelle Prüfungen im Test-Manifest (BYL-E7-410 bis BYL-E7-415); Nachtrag PL-2: „Zuständig“ beim Anlegen, Warnung vor dem Verschieben ins Private
- **Datum:** 2026-10-05
- **Entscheidung durch:** Nutzer (Produktvorgaben: „Zuständig“ nur im Haushalt, genau ein aktuelles Mitglied oder niemand, jedes Mitglied darf zuweisen, „Ich übernehme“; Initialen mit stabiler Farbe und vollem Namen; Karte „Mir zugewiesen“, Filter, Gruppieren und Sortieren; Hinweis „Sofia hat dir HAUS-12 zugewiesen.“ und wieder ungelesen, eigene Zuweisungen ohne Hinweis; Zuständigkeit an Wiederholungen „keine / fest / abwechselnd“ mit Vorschau; Tagesplan-Quelle „Mir zugewiesen“; Regeln für Austritt, Verschieben, Duplizieren und Folge-Tickets), Advisor (Akzeptanzkriterien, Tests), Executor (Datenmodell, Zeiger der Rotation, `assigned_at`, Hinweis über ein eigenes Realtime-Thema, Farbe als Ring, Einzelheiten unten)
- **Bezug:** [ADR-0058](0058-haushalt-mitgliedschaft-einladungen-rechte.md) (Mitgliedschaft, Nachtrag E7-5), [ADR-0059](0059-bereiche-privat-und-haushalt.md) (Bereiche), [ADR-0061](0061-verschieben-zwischen-bereichen-und-aufloesen.md) (Verschieben, Nachtrag E7-5), [ADR-0013](0013-filter-suche-sortierung-gruppierung.md) (Filter und Karten, Nachtrag F), [ADR-0015](0015-neu-markierung-pro-nutzer.md) („neu“), [ADR-0022](0022-erzeugung-von-instanzen.md) (Erzeugung, Nachtrag 15), [ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) (Regeln am Ticket), [ADR-0045](0045-ticket-duplizieren.md) (Duplizieren), [ADR-0052](0052-farben-fuer-projekte-und-tickets.md) (Palette), [ADR-0065](0065-tagesplan.md) (Tagesplan, Nachtrag E7-5), [ADR-0066](0066-ansicht-erledigte.md) („Erledigte“), [ADR-0067](0067-tickets-als-quelle.md) (Folge-Tickets), [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md) (Spalten), [ADR-0007](0007-realtime-und-sitzungspflege.md) (Realtime)

## Kontext

Im Haushalt sehen alle Mitglieder dieselben Tickets (E7-3). Wer sich um ein Ticket kümmert, stand bisher höchstens im Titel („Müll – Bert“). Der Nutzer will das als Feld: je Ticket genau eine Person oder niemand, sichtbar in allen Listen, filterbar, mit einem Hinweis an die Person, und für wiederkehrende Aufgaben („Müll rausbringen“) im Wechsel. Im Privaten gibt es niemanden außer dem Konto selbst; dort gibt es das Feld nicht.

## Entscheidung

### 1. Datenmodell und Regeln am Ticket (Migration `1790204900_assignees.js`)

| Collection | Feld | Bedeutung |
|---|---|---|
| `tickets` | `assignee` | Relation `users`, höchstens eins, ohne Kaskade; Index `idx_tickets_assignee` |
| `tickets` | `assigned_at` | Datum; wann ein **anderes** Konto das Ticket der Person gab (nur der Hook schreibt es, §4) |
| `recurrence_rules` | `assignee_mode` | `fixed` („Fest“) oder `rotate` („Abwechselnd“), leer = „Keine“ |
| `recurrence_rules` | `assignees` | Relation `users`, geordnet, höchstens 10 |
| `recurrence_rules` | `assignee_next` | ganze Zahl ≥ 0: Stelle der Person des nächsten Vorkommens (Zeiger der Rotation) |
| `day_plan_items` | `origin` | neuer Wert `assigned` (§8) |

Die Migration ist additiv; der Rückweg nimmt Felder und Index und macht Einträge des Tagesplans mit `assigned` zu `manual`. Die API-Regeln bleiben: Wer ein Ticket ändern darf, darf seine Zuständigkeit ändern; jedes Mitglied ist gleichgestellt, es gibt kein eigenes Recht.

Regeln (`lib/assignee-rules.js`, rein; `lib/assignee-service.js`; für **jeden** Schreiber, auch den Superuser):

- Ein **privates** Ticket hat nie eine Zuständigkeit (`validation_assignee_private`, „Private Tickets haben keine Zuständigkeit.“).
- Eine neue oder geänderte Zuständigkeit, auch beim Wechsel des Haushalts, ist ein **aktuelles Mitglied** des Haushalts des Tickets (`validation_assignee_member`, „Zuständig sein kann nur ein Mitglied des Haushalts.“). Eine unveränderte wird nicht erneut geprüft, damit keine andere Änderung an ihr scheitert; das Ende einer Mitgliedschaft räumt ohnehin auf (§6).
- **Verlauf:** Feld `assignee` in `TRACKED_FIELDS`; die Oberfläche schreibt „Zuständig: Bert Beispiel“ bzw. „Zuständigkeit entfernt“ (`assigneeHistoryText`).
- Oberfläche: Feld „Zuständig“ nach „Priorität“ in Panel und Vollansicht (`AssigneeField`): natives `select` mit „Niemand“ und den Mitgliedern (das eigene Konto zuerst, „(ich)“), sofort gespeichert wie die Priorität, Fehler am Feld; daneben „Ich übernehme“ als ein Klick, solange das Ticket nicht dem eigenen Konto gehört. Nur an Tickets des Haushalts und erst, wenn der Server das Feld kennt.

### 2. Initialen

`AssigneeBadge`: ein rundes Kürzel „AB“ (erster Buchstabe des ersten und des letzten Worts, `initialsOf` des Tagesplans), 1,5 rem, in Kalenderzeilen 1,25 rem. Die Farbe ist ein **Ring** (2 px) aus der Palette der Projekte ([ADR-0052](0052-farben-fuer-projekte-und-tickets.md)), gewählt mit FNV-1a über die Konto-ID (`assigneeColor`), also für ein Konto überall und auf jedem Gerät gleich. Die Buchstaben stehen in `--color-text` auf `--color-surface`; so gilt der Kontrast des Texts (≥ 4,5 : 1) und für den Ring der der Palette (≥ 3 : 1 auf allen Flächen, [ADR-0052](0052-farben-fuer-projekte-und-tickets.md)), in allen Themen. Eine gefüllte Fläche in der Palettenfarbe hätte je Farbe eine eigene Textfarbe gebraucht. Die Farbe ist nie das einzige Zeichen: Tooltip und Text für Screenreader „Zuständig: Anna Beispiel“, die Buchstaben selbst sind `aria-hidden`. Ein Konto ohne bekannten Namen heißt „Anderes Konto“, das eigene ohne Namen „Du“.

Zu sehen in „Aufgaben“ (am Titel, solange die Spalte aus ist), in den offenen Tickets eines Projekts, in „Erledigte“, an den Einträgen des Tagesplans im Haushalt, im Detail neben dem Feld und in der Agenda des Kalenders im Haushalt. Die Monats- und Wochenraster des Kalenders bleiben ohne, weil dort kein Platz ist.

### 3. Filter, Karte, Gruppieren, Sortieren, Spalte

- **Karte „Mir zugewiesen“** (`mine`, Adresse `karte=mir`) nach den fünf Karten von [ADR-0013](0013-filter-suche-sortierung-gruppierung.md) Nachtrag C, **nur im Haushalt** (`HOUSEHOLD_CARDS`), mit derselben Vereinigungslogik: Tickets, deren Zuständigkeit das ansehende Konto ist.
- **Filter „Zuständig“** (`zustaendig=<Konto-ID>` oder `zustaendig=niemand`) in der Filterleiste von „Aufgaben“ und Kalender (Einträge des Eingangs haben keine Zuständigkeit und fallen mit dem Filter heraus) und in „Erledigte“; nur im Haushalt angeboten, eine Adresse mit dem Parameter zeigt ihn auch im Privaten an (er findet dort nichts). „Erledigte“ filtert auf dem Server (`DONE_ASSIGNEE_FILTER`, nur mit gesetztem Filter, damit ein Server vor der Migration weiter antwortet); `matchesDoneQuery` ist das Gegenstück (Paritätstest).
- **Gruppieren** „Nach Zuständigkeit“ (`gruppe=zustaendig`, auch als zweite Ebene): das eigene Konto zuerst, die anderen nach Namen, „Niemand“ zuletzt. **Sortieren** nach „Zuständig“ (`sort=zustaendig`): nach Namen, Tickets ohne Zuständigkeit immer zuletzt.
- **Spalte „Zuständig“** in „Aufgaben“ nach dem Status: im Haushalt im Menü „Spalten“ wählbar, aber aus, bis der Nutzer sie einschaltet (`optIn`, [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md)), damit die Schwellen für schmale Fenster bleiben; eingeschaltet trägt sie die Initialen und ändert die Zuständigkeit an Ort und Stelle (Menü „Niemand“ und Mitglieder). Außerhalb des Haushalts gibt es Spalte und Eintrag im Menü nicht.

### 4. Hinweis und „neu“

- **Fremde Zuweisung:** eine neue Zuständigkeit, die nicht das schreibende Konto ist (`isForeignAssignment`); „Ich übernehme“, „Niemand“ und Zuweisungen des Servers (Erzeugung einer Serie, Superuser) sind keine.
- **Wieder ungelesen:** Bei einer fremden Zuweisung setzt der Hook `assigned_at` auf jetzt und löscht in **derselben Transaktion** die Lesezeile der Person (`ticket_reads`, [ADR-0015](0015-neu-markierung-pro-nutzer.md)). Damit ist das Ticket für sie „neu“, auch wenn es vor ihrer Grundlinie angelegt wurde: `isNew` zählt neben `created ≥ Grundlinie` auch `assignee = ich und assigned_at ≥ Grundlinie`. Die Lesezeilen lädt `listReads` dafür mit einem erweiterten Filter (ein Server vor dem Neustart antwortet 400, dann der alte Filter). Öffnen legt die Lesezeile wieder an. Jede andere Änderung der Zuständigkeit leert `assigned_at`, eine unveränderte behält es.
- **Live-Hinweis:** Nach dem Commit sendet der Hook das Realtime-Thema `byl/assigned` **nur an die Tabs der Person** (`{ ticket, key, title, scope, by, by_name }`); die (app)-Layout-Schicht zeigt es als Info-Flag „Bert Beispiel hat dir HAUS-12 zugewiesen.“ mit dem Titel und „Öffnen“, das das Ticket in der Ansicht des Tabs öffnet (`AssignedNotices`). Ein Thema statt eines Ereignisses der Tickets, weil sonst jeder Tab jedes Mitglieds jede Änderung auf Zuweisungen prüfen müsste und eigene Zuweisungen nicht von fremden unterscheiden könnte. Ein Hinweis, der in eine Lücke der Verbindung fällt, kommt nicht nach; das Ticket ist trotzdem „neu“.

### 5. Wiederholungen: keine, fest, abwechselnd

- **Regel des Haushalts:** „Keine“, „Fest“ (genau eine Person) oder „Abwechselnd“ (geordnete Liste, 1 bis 10 Personen). Private Regeln haben keine (`validation_recurrence_assignee_private`). Geprüft im Modell-Hook für jeden Schreiber (`ruleCheck`): Art, Anzahl, Mitgliedschaft jeder neuen oder verschobenen Person (Fehler mit `params.index`), Zeiger.
- **Zeiger:** `assignee_next` ist die Stelle der Person des nächsten Vorkommens. Jedes **erzeugte** Vorkommen (`newInstance` der Erzeugung, auch „Verpasste Termine nachholen“ mit einem Ticket je Termin und WH-1) nimmt die Person am Zeiger und rückt ihn um eins weiter, reihum; die Erzeugung speichert ihn mit der Regel in ihrer Transaktion. Unteraufgaben der Vorlage bekommen keine Zuständigkeit. Eine Person, die kein Mitglied mehr ist (kann nach §6 nicht vorkommen), ergibt „niemand“ statt eines Fehlers, damit eine Serie nie stehen bleibt.
- **Zurücknehmen:** Öffnet der Nutzer ein Vorkommen wieder, entfernt der Server das unberührte Folgeticket ([ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) §3); hatte es die Person vor dem Zeiger, geht der Zeiger um eins zurück, sodass das nächste Vorkommen wieder an sie geht (`pointerBack`).
- **Ändern:** Eine geänderte Liste oder Art setzt den Zeiger auf 0, außer die Anfrage nennt ihn. Der Dialog zeigt die Liste **ab der Person des nächsten Vorkommens** (`rotationOrder`) und schickt eine geänderte Zuständigkeit in dieser Reihenfolge mit Zeiger 0; eine unveränderte schickt er nicht, der Zeiger bleibt. Was der Dialog zeigt, ist damit, was kommt.
- **Oberfläche:** Abschnitt „Zuständigkeit“ in „Wiederholen…“, „Regel bearbeiten“, im Panel einer Regel, in „Neue Regel“ und im Abschnitt „Wiederholen“ von „Neues Ticket“ (`RecurrenceAssignment`): Optionsfelder „Keine / Fest / Abwechselnd“; bei „Fest“ ein `select`, bei „Abwechselnd“ eine nummerierte Liste mit benannten Knöpfen „nach oben“, „nach unten“, „entfernen“ und „Person hinzufügen“ (Tastatur und Screenreader erreichen jeden Schritt, eine höfliche Statusmeldung sagt, was geschah). Darunter die Vorschau „Nächstes Vorkommen: Bert Beispiel, danach: Anna Beispiel“ (eine Person: „Jedes Vorkommen: …“). Nur im Haushalt und erst nach der Migration (`RecurrenceStore.assigneesReady`).

### 6. Ende einer Mitgliedschaft

Austreten, Entfernen, Auflösen und das Löschen eines verwaisten Haushalts löschen die Mitgliedschaft; `onRecordDelete` von `household_members` räumt in **derselben Transaktion** auf (`releaseMembership`): Die Person verlässt die Zuständigkeit jedes Tickets dieses Haushalts, auch im Papierkorb, je Ticket mit „Zuständigkeit entfernt“ im Verlauf durch das auslösende Konto (wer entfernt bzw. austritt); und jede Regel des Haushalts, wobei der Zeiger auf derselben nächsten Person bleibt und eine leere Rotation „Keine“ wird (`withoutMember`).

### 7. Verschieben, Duplizieren, Folge-Ticket

- **Haushalt → privat** ([ADR-0061](0061-verschieben-zwischen-bereichen-und-aufloesen.md)): Tickets (auch Unteraufgaben, Papierkorb und mitgenommene Serien von MV-2) verlieren die Zuständigkeit mit Verlaufseintrag; Regeln verlieren die Zuständigkeit samt Rotation. **Privat → Haushalt:** keine Zuständigkeit (es gab keine).
- **Duplizieren** ([ADR-0045](0045-ticket-duplizieren.md)): im selben Haushalt behalten Kopie und kopierte Unteraufgaben die Zuständigkeit (die Person ist dort Mitglied), in einen anderen Bereich nicht.
- **Folge-Ticket** ([ADR-0067](0067-tickets-als-quelle.md)): ohne Zuständigkeit.

### 8. Tagesplan

Neue Quelle **„Mir zugewiesen“** (`assigned`, Standard „Vorschlagen“, Rangfolge nach „Heute fällig“, Grund „dir zugewiesen“) im Hook `lib/day-plan-rules.js` und im Spiegel `domain/day-plan.ts`: offene Tickets, deren Zuständigkeit **das ansehende Konto** ist (`viewer` der Vorschläge; der Server nimmt das Konto der Anfrage, auch bei „Automatisch übernehmen“). Im gemeinsamen Plan sieht also jedes Mitglied seine eigenen. Die Einstellung zeigt die Quelle nur im Haushalt, mit dem Hinweis, dass sie für das ansehende Konto gilt. Einträge im gemeinsamen Plan tragen die Initialen ihrer Zuständigkeit.

### 9. Realtime

Zuständigkeit und Rotation sind Felder von Tickets und Regeln; ihre Änderungen erreichen jede Liste, jedes Panel und jeden Plan über die vorhandenen Abonnements des Bereichs. Neu ist nur das Thema `byl/assigned` (§4). Die Namen der Mitglieder kommen aus dem Haushalt (`AssigneeDirectory`), sonst aus den sichtbaren Konten.

## Alternativen

| Alternative | Bewertung |
|---|---|
| Mehrere Zuständige je Ticket | Vom Nutzer ausgeschlossen („genau ein Mitglied oder niemand“); Karte, Hinweis und Rotation bleiben so eindeutig. |
| Rotation ohne gespeicherten Zeiger, aus der Anzahl der Vorkommen berechnet | Bricht bei Papierkorb, „Aus der Serie lösen“, Nachholen und Ändern der Liste; der Zeiger ist ein Feld und in derselben Transaktion wie das Vorkommen geschrieben. |
| Hinweis über das Ereignis `tickets` | Jeder Tab jedes Mitglieds müsste Zuweisungen erkennen und wüsste nicht, wer zugewiesen hat; „eigene ohne Hinweis“ wäre im Client geraten. |
| Nur den Neu-Punkt über die Lesezeile, ohne `assigned_at` | Tickets vor der Grundlinie der Person wären nie „neu“; gerade ältere Aufgaben werden zugewiesen. |
| Gefüllte Kreise in der Palettenfarbe | Je Farbe und Thema eine eigene Textfarbe mit Kontrastprüfung; der Ring nutzt die geprüften Kontraste von Text und Palette. |
| Spalte „Zuständig“ standardmäßig an | Verschiebt die Schwellen der Spaltenbreiten für alle; die Initialen am Titel tragen die Information ohne Platzbedarf. |

## Konsequenzen

- **Migration** `1790204900_assignees.js` (additiv) und **Neustart nötig** (`neu-starten.bat`) für die Hooks; die Oberfläche nach dem Build und F5. Bis zum Neustart kennt der Server die Felder nicht: Feld „Zuständig“ und Rotation erscheinen nicht (das Feld fehlt in der Antwort, die Probe `assigneesReady` schlägt fehl), Karte, Filter und Gruppe finden nichts Zugewiesenes, „Erledigte“ schickt den Filter nur, wenn er gewählt ist, und `listReads` fällt auf den alten Filter zurück.
- **Tests:** `tests/integration/assignees.test.mjs` (eigene Wegwerf-Instanz, A und B im Haushalt, C allein: Validierung inkl. C und privat, jedes Mitglied weist zu, Verlauf, `assigned_at`, Hinweis und Lesezeile, eigene Zuweisung ohne Hinweis, Realtime, Austritt und Entfernen inkl. Papierkorb und Rotationen, Regeln, fest und abwechselnd mit WH-1 und Nachholen, Zurücknehmen, Verschieben ins Private samt Serie, Duplizieren in beide Richtungen, Folge-Ticket, Tagesplan-Gleichstand Hook ↔ Web), `web-filter-parity.test.mjs` (Filter „Zuständig“ in „Erledigte“, Karte und Filter gegen den Server je Mitglied), `migrations-rollback.test.mjs`, `hooks-before-migration.test.mjs`, `assignee-rules.test.mjs` und `web-assignee.test.mjs` (Gleichstand), Vitest für Domain, Stores und Komponenten (`assignee*.test.ts`, `ticket-assignee`, `ticket-table-assignee`, `recurrence-assignment`, `recurrence-panel`, `filter-cards`, `filter-bar`, `group-popover`, `day-plan-view`, `unread`, `assigned-notices`).
- **Test-Manifest:** automatisch BYL-E7-400 bis BYL-E7-409, manuell BYL-E7-410 bis BYL-E7-415 (Partnerin zuweisen mit Hinweis und Neu-Punkt, Karte „Mir zugewiesen“, „Müll rausbringen“ abwechselnd, Tagesplan, Initialen am Handy, Austritt).

## Nachtrag PL-2 (2026-10-06): „Zuständig“ beim Anlegen, Warnung vor dem Verschieben ins Private

- **Entscheidung durch:** Advisor (Auftrag PL-2: Feld beim Anlegen mit „Mir“, Warnung in den Dialogen), Executor (Platz des Felds, „Mir“ gesperrt statt verschwunden, Zählung).
- **Beim Anlegen:** „Neues Ticket“ hat in einem Tab des Haushalts nach Status, Priorität und Fälligkeit das Feld „Zuständig“ (`Field`, UI-1): natives `select` mit „Niemand“ (vorgewählt) und den Mitgliedern, das eigene Konto zuerst mit „(ich)“, daneben „Mir“ (Name für Screenreader „Mir zuweisen“). Ist das eigene Konto gewählt, bleibt „Mir“ stehen und ist gesperrt (`aria-disabled`), damit der Fokus nicht verloren geht. Im Privaten, vor der Migration und ohne bekannte Mitglieder gibt es das Feld nicht. „Niemand“ sendet kein Feld; ein Fehler des Servers steht am Feld. Auch beim Umwandeln aus dem Eingang. Der Dialog legt keine Unteraufgaben an; Unteraufgaben bekommen also nie eine Zuständigkeit aus ihm.
- **Server:** Nichts zu ergänzen. Der Modell-Hook prüft beim Anlegen wie beim Ändern (§1), setzt bei einer fremden Zuständigkeit `assigned_at` und sendet nach dem Commit `byl/assigned` an die Person (§4); eine Lesezeile gibt es für sie noch nicht, das Ticket ist für sie neu. Wer sich selbst einträgt, bekommt keinen Hinweis, `assigned_at` bleibt leer.
- **Warnung vor dem Verschieben:** Die Vorschau von `POST /api/byl/area/move` nennt `counts.assignees_cleared` `{ tickets, rules }`: Tickets des Plans mit Zuständigkeit (auch Unteraufgaben, Papierkorb und Vorkommen einer ganzen Serie) und Regeln mit „Fest“ oder „Abwechselnd“, nur ins Private, sonst 0. Die Vorschau von „Haushalt auflösen“ nennt dasselbe in `counts.assignees_cleared` für `adopt` (für `delete` 0). `AreaMoveDialog` (einzeln, Sammelaktion, ganze Serie) und `HouseholdDissolveDialog` (nur bei „übernehmen“) zeigen dann die Warnung „Bei 3 Tickets und 1 Wiederholung fällt die Zuständigkeit weg.“ (`assigneesClearedText`); ohne Betroffene keine. Jede neue Vorschau (etwa ohne „Ganze Serie verschieben“) zählt neu.
- **Tests:** `assignees.test.mjs` (Anlegen für B mit Hinweis und „neu“, für sich selbst ohne, privat abgelehnt; Zähler beim Verschieben, bei der Serie und beim Auflösen), `new-ticket.test.ts`, `area-move.test.ts` (Domain und Dialog), `area-move-bulk.test.ts`, `household-dissolve.test.ts`, `help-page.test.ts`; Test-Manifest BYL-E7-416 bis BYL-E7-420, davon BYL-E7-420 manuell.
- **Neustart nötig** (`neu-starten.bat`) für die Zähler der Vorschau; das Feld beim Anlegen braucht nur den Build und F5. Ein Server vor dem Neustart nennt keine Zähler, die Dialoge warnen dann nicht.
