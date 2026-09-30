# ADR-0033: Unteraufgaben: eine Ebene, Fortschritt, Einrücken in der Tabelle und „blockiert das übergeordnete Ticket“

- **Status:** Angenommen und umgesetzt in den Paketen UA-1 bis UA-5 nach [docs/plan/unteraufgaben.md](../plan/unteraufgaben.md) (#118 bis #122); manuelle Browser-Prüfungen stehen im Test-Manifest
- **Datum:** 2026-09-28
- **Entscheidung durch:** Nutzer (Freigabe der Unteraufgaben am 2026-09-28 als ausdrückliche Anweisung nach CLAUDE.md §10), Advisor (Umfang und Bausteine), Executor (Regeln für Einrücken, Wiederholungen und Erledigen, Einzelheiten)
- **Ergänzt:** [ADR-0012](0012-plain-ticketing.md) und [ADR-0011](0011-roadmap-e3-bis-e7.md) (je ein Nachtrag), [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md) (Spalte „Übergeordnet“, Vorliebe „Unteraufgaben einrücken“), [ADR-0023](0023-lebenszyklus-von-regeln-und-instanzen.md) (Folgetickets)

## Kontext

Sub-Tickets standen bisher unter „Stufe 2, nur auf ausdrückliche Anweisung“ (CLAUDE.md §10, ADR-0011 §1, ADR-0012). Das Datenmodell ist seit E1 vorbereitet:

- `tickets.parent` ist eine Relation auf `tickets` (höchstens ein Ziel, Index `idx_tickets_parent`, ohne Cascade), `blocks_parent` ein bool mit dem Standard `true`, den der Create-Hook setzt. Beide Felder stehen in der Historie.
- `lib/ticket-rules.js` `parentViolation`: kein Selbstbezug, nur eine Ebene (das übergeordnete Ticket hat selbst keins), ein Ticket mit Unteraufgaben bekommt kein übergeordnetes.
- `lib/ticket-service.js`: Das übergeordnete Ticket muss im selben Scope liegen (`checkRelations`, `validation_scope_mismatch`), ein Ticket mit Unteraufgaben wechselt den Bereich nicht (`validation_ticket_has_children`). Wird das übergeordnete Ticket gelöscht, leert PocketBase `parent` der Unteraufgaben; der Verlauf hält es fest.

Es gibt keine Oberfläche, und `blocks_parent` hat keine Wirkung. Der Nutzer hat die Unteraufgaben am 2026-09-28 freigegeben.

## Entscheidung

### 1. Begriffe und Umfang

- **Unteraufgabe** ist ein normales Ticket mit `parent`. Es hat einen eigenen Key aus seinem Nummernkreis, eigenen Status, eigene Fälligkeit, eigenes Projekt und eigene Tags. Es gibt keinen Ticket-Typ (ADR-0012 bleibt).
- Genau eine Ebene. Ein Ticket mit Unteraufgaben heißt in der Oberfläche **übergeordnetes Ticket**.
- Das Datenmodell bleibt, wie es ist. Es gibt **keine Migration**: Die Hooks wirken in der laufenden Instanz sofort, die Oberfläche nach F5.

### 2. Erledigen mit offenen Unteraufgaben (`blocks_parent`)

- Wechselt ein Ticket nach `done` und hat es offene Unteraufgaben mit `blocks_parent = true`, lehnt der Update-Hook in seiner Transaktion ab: Feldfehler `validation_parent_open_children` am Feld `status`, `params` `{ count, keys }` (höchstens fünf Keys).
- Zwei Body-Felder, die nicht gespeichert werden (wie `expected_updated`, ADR-0032 §6):
  - `force: true` erledigt trotzdem; die Unteraufgaben bleiben offen.
  - `complete_children: true` erledigt in **derselben Transaktion** alle offenen blockierenden Unteraufgaben. Jede bekommt `completed_at` und einen Verlaufseintrag mit dem handelnden Nutzer. Gehört eine Unteraufgabe zu einer Serie, gilt ADR-0022 §4 wie beim Häkchen: Der Folgetermin steht mit dem Commit fest, das Folgeticket entsteht danach.
- Die Regel gilt für jedes Update über die Record-API, auch für den Superuser. Nicht blockierende Unteraufgaben (`blocks_parent = false`) zählen nicht und bleiben unberührt.
- Die SPA fragt vor dem Senden, weil sie die Unteraufgaben kennt: „N Unteraufgaben sind noch offen – trotzdem erledigen?“ mit der Wahl „Unteraufgaben mit erledigen“ (vorausgewählt) oder „Trotzdem erledigen“, dazu „Abbrechen“. Lehnt der Server trotzdem ab (etwa weil ein anderer Tab eine Unteraufgabe wieder geöffnet hat), stellt sie dieselbe Frage mit der Zahl des Servers.
- „Rückgängig“ im Flag nach „Unteraufgaben mit erledigen“ stellt das übergeordnete Ticket **und** die mit erledigten Unteraufgaben auf ihren vorigen Status zurück.

### 3. Wiederholungen

**Folgetickets haben keinen Parent.** Der Erzeugungsdienst (`newInstance`, ADR-0022 §2) übernimmt nur die Vorlage der Regel, und die kennt kein übergeordnetes Ticket.

- Eine Unteraufgabe darf eine Serie haben („Wiederholen…“ ist erlaubt). Ihr Folgeticket ist ein eigenständiges Ticket.
- Ein übergeordnetes Ticket darf eine Serie haben. Sein Folgeticket bekommt keine Unteraufgaben.
- Begründung: Das übergeordnete Ticket ist beim Erzeugen oft schon erledigt oder gelöscht. Ein geerbter Parent würde ein erledigtes Ticket still wieder „blockieren“ oder auf ein gelöschtes zeigen, und das Folgeticket müsste bei jedem Rückgängig mitgedacht werden (ADR-0023 §3). Die Serie bleibt so unabhängig von der Hierarchie.

### 4. Oberfläche

- **Abschnitt „Unteraufgaben“** im Panel und in der Vollansicht (bei Tickets ohne eigenes übergeordnetes Ticket): Liste mit Häkchen, Key, Titel (Link) und Status-Pille; offene zuerst, danach nach Anlage. Fortschritt „2/5 erledigt“ als Text und ein dezenter Balken aus vorhandenen Tokens. „Unteraufgabe hinzufügen“ öffnet ein Textfeld im Abschnitt: Enter legt an und lässt das Feld für die nächste offen, Esc bricht ab. Die neue Unteraufgabe erbt Scope, Projekt und Tags, Status „Offen“, Priorität „Mittel“.
- **Im Kind:** Pfad „HAUS-12 › HAUS-15“ mit Link zum übergeordneten Ticket (Kopf des Panels, oberhalb des Titels in der Vollansicht). Die Zeile „Übergeordnet“ in den Feldern zeigt das Ticket mit „Ändern“ und „Lösen“ sowie den Switch „Blockiert das übergeordnete Ticket“.
- **Ein vorhandenes Ticket zur Unteraufgabe machen:** über dieselbe Zeile „Übergeordnet“ („Festlegen …“).
- **Auswahl des übergeordneten Tickets** mit der vorhandenen `TicketCombobox`, **inline** in der Zeile statt im Modal: In der Vollansicht darf kein Dialog aufgehen (ADR-0025 §3), und Panel und Vollansicht sollen gleich bedient werden. Angeboten werden nur zulässige Ziele (nicht das Ticket selbst, keine Unteraufgaben); den Rest prüft der Hook.
- **Löschen** eines übergeordneten Tickets nennt „N Unteraufgaben bleiben erhalten“. In der Vollansicht fragt „Löschen …“ jetzt **inline** statt über eine Bestätigung auf dem XL-Modal (offener Punkt aus dem Plan Editor).

### 5. Tabelle „Aufgaben“

- **Fortschritt:** Ein übergeordnetes Ticket trägt am Titel einen Chip „2/5“ (Name „2 von 5 Unteraufgaben erledigt“).
- **Spalte „Übergeordnet“:** optional, standardmäßig aus, weicht als erste (wie „Quelle“), zeigt den Key des übergeordneten Tickets.
- **„Unteraufgaben einrücken“** im Menü „Spalten“, standardmäßig an, gespeichert pro Gerät in den Spaltenvorlieben der Tabelle (`byl-columns-tickets`, Feld `options`; „Standard wiederherstellen“ setzt es zurück).
- **Regeln für Filter, Suche, Sortierung und Gruppierung:**
  1. Filter und Suche gelten für jedes Ticket einzeln. Eine Unteraufgabe erscheint, wenn sie passt, auch ohne ihr übergeordnetes Ticket, und umgekehrt.
  2. Sortiert wird wie bisher.
  3. Mit „einrücken“ folgt eine Unteraufgabe direkt ihrem übergeordneten Ticket, **wenn beide im selben Abschnitt sichtbar sind** (dieselbe Gruppe bzw. offen oder „Erledigt“). Mehrere Unteraufgaben behalten untereinander die Reihenfolge der Sortierung.
  4. Sonst steht sie an ihrem sortierten Platz, mit dem Pfad-Hinweis „HAUS-12 ›“ vor dem Titel. Das gilt auch, wenn „einrücken“ aus ist.
  5. Einrücken ändert keine Zahl: Zähler, Kennzahlen und Gruppen zählen jedes Ticket einzeln. Es geht nie über eine Gruppe oder einen Abschnitt hinaus.
- Die Regeln aus ADR-0030 bleiben: Die Einrückung liegt in der Titelzelle, die Tabelle scrollt nie seitlich, Pflichtspalten bleiben.

### 6. Kurzsyntax

`^HAUS-12` in der Schnellerfassung ist zurückgestellt (Plan §6): Der Key muss gegen die Tickets aufgelöst werden, und mit `@CODE` wäre offen, welches Projekt gilt.

## Alternativen

- **Mehrere Ebenen:** widerspricht ADR-0012 (keine Epics) und macht Einrücken, Fortschritt und die Sperre rekursiv. Verworfen.
- **Erledigen mit offenen Unteraufgaben immer verbieten (Jira-Workflow):** zu starr für private Listen; `blocks_parent` ist gerade der Schalter pro Unteraufgabe. Verworfen.
- **„Mit erledigen“ als Folge von Einzel-Updates aus der SPA:** nicht atomar, ein halber Erfolg wäre möglich. Verworfen zugunsten der Transaktion im Hook.
- **Folgetickets erben den Parent:** siehe §3. Verworfen.
- **Kinder nur eingerückt, nie einzeln:** Ein Filter, der das übergeordnete Ticket ausblendet, würde passende Unteraufgaben verstecken. Verworfen.
- **Auswahl des übergeordneten Tickets im Modal wie „Anderem Ticket zuordnen …“:** ginge im Panel, aber nicht in der Vollansicht. Verworfen zugunsten derselben Inline-Auswahl an beiden Orten.
- **Die Vorliebe „einrücken“ in der URL:** Sie ist eine Vorliebe des Geräts wie die Spalten, kein teilbarer Ansichtszustand. Verworfen.

## Konsequenzen

- Positiv: Keine Migration und kein Neustart. Die Sperre gilt auch für andere Clients und ist atomar. Einrücken, Filter und Sortierung widersprechen sich nicht.
- Negativ: Die SPA lädt zusätzlich alle Unteraufgaben (auch erledigte) mit den Listenfeldern, damit Fortschritt und Liste ohne weitere Anfragen stimmen. Bei privaten Datenmengen ist das klein.
- CLAUDE.md §5, §7 und §10 sind nachgezogen (Stufe 2 → umgesetzt; Freigabe des Nutzers vom 2026-09-28).

## Nachtrag (2026-09-28, Papierkorb, ADR-0037): Löschen mit Unteraufgaben

- Das Löschen eines übergeordneten Tickets leert `parent` der Unteraufgaben nicht mehr: Sie gehen als **Gruppe** mit in den Papierkorb (auch erledigte), behalten `parent` auf das Ticket im Papierkorb und kommen nur gemeinsam zurück bzw. gehen gemeinsam endgültig.
- Eine **einzeln** gelöschte Unteraufgabe verlässt ihr übergeordnetes Ticket (`parent` leer, im Schnappschuss): Sie zählt nicht mehr im Fortschritt und blockiert das Erledigen nicht (§2). Beim Wiederherstellen kommt sie zurück, wenn das übergeordnete Ticket lebt, im Bereich liegt und selbst keine Unteraufgabe ist, sonst als eigenständiges Ticket (im Ergebnis genannt).
- Ein Ticket im Papierkorb ist kein möglicher übergeordneter Eintrag (`validation_scope_mismatch` wie ein fehlendes).

## Nachtrag (2026-10-01, Duplizieren, ADR-0045): Unteraufgaben beim Duplizieren

- **Übergeordnetes Ticket duplizieren** mit „Unteraufgaben“ (nicht vorausgewählt): Je Unteraufgabe des Originals entsteht eine **neue, offene** Unteraufgabe des Duplikats, auch aus erledigten, in der Reihenfolge ihrer Anlage und in derselben Transaktion. Sie behält ihr eigenes „Blockiert das übergeordnete Ticket“, bekommt Beschreibung, Priorität, Tags und Fälligkeit aus der eigenen Unteraufgabe nach derselben Auswahl wie das Duplikat und das Projekt des Duplikats (wie jede neue Unteraufgabe, §4; [ADR-0034](0034-unterprojekte.md) §6). Keine Serie, kein Pin, keine Kommentare, keine Quellen. Die Unteraufgaben des Originals bleiben unverändert.
- **Unteraufgabe duplizieren:** „Unter HAUS-12 einordnen“ (vorausgewählt) macht die Kopie zu einer weiteren Unteraufgabe desselben übergeordneten Tickets mit dessen „Blockiert …“-Wert; ohne die Wahl ist sie eigenständig. Eine Unteraufgabe hat keine Unteraufgaben, die Frage „Unteraufgaben“ fehlt dort (eine Ebene).
- Der Hook bleibt die letzte Instanz: Ebene, Bereich und Papierkorb prüft `checkRelations` wie bei jeder Anlage.
