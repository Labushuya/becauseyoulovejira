# ADR-0049: Zielprojekt je Eingangsweg – Einträge merken sich beim Eintreffen das Projekt ihrer Verbindung bzw. Karte, Umwandeln belegt es vor (Paket 1 „Standardprojekt je Verbindung“ der beobachteten Quellen)

- **Status:** Angenommen und umgesetzt (Paket 1 nach [Plan Beobachtete Quellen](../plan/beobachtete-quellen.md)); die Pakete 2 (GitHub) und 3 (Ordner) folgen mit eigenen Entscheidungen
- **Datum:** 2026-10-02
- **Entscheidung durch:** Nutzer (Spec „Standardprojekt je Verbindung, GitHub-Kanal, Ordner-Kanal (beobachtete Quellen)“, freigegeben am 2026-10-01, Reihenfolge Standardprojekt → GitHub → Ordner), Advisor (Auftrag Paket 1: Zielprojekt an jeder Verbindung und Sonderkarte, Speicherort begründen, Vorbelegung beim Umwandeln, Archiv und Löschung, Filter und Gruppierung, Einstellung in Karte und Assistent), Executor (Datenmodell, Auflösung, Oberfläche, Einzelheiten)
- **Ergänzt:** [ADR-0014](0014-datenmodell-eingang.md) (Feld `inbox_items.target_project`, Nachtrag dort), [ADR-0016](0016-kanal-architektur-und-mail.md) (Feld `connections.target_project`, Nachtrag dort), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) (Einstellung in der Karte, optionaler Schritt des Assistenten, Nachtrag ZP dort), [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md) (Spalte „Zielprojekt“ im Eingang, Nachtrag 6 dort)
- **Bezug:** [ADR-0020](0020-stichwoerter-pro-kanal.md) (Einstellungen der Karten ohne Verbindung je Nutzer), [ADR-0034](0034-unterprojekte.md) (Unterprojekte im Filter), [ADR-0036](0036-sammelbearbeitung-inline-und-oeffnungsmodus.md) (Gesammelt umwandeln), [ADR-0038](0038-eigener-eingang-und-whatsapp-web.md) (eigener Eingang, Schlüssel), [ADR-0041](0041-notion-listen-uebernehmen.md) (Notion-Importe), [ADR-0042](0042-tickets-und-projekte-aus-listen-waehlen.md) (`ProjectSelect`), [ADR-0045](0045-ticket-duplizieren.md) (Kopie der Herkunft)

## Kontext

Einträge aus einer Verbindung gehören oft immer zum selben Projekt: Mails eines Arbeitspostfachs zu „Arbeit“, Termine eines Familienkalenders zu „Haus“. Bisher musste der Nutzer das Projekt bei jedem Umwandeln wählen. Die freigegebene Spec verlangt als erstes von drei Paketen ein optionales Zielprojekt je Verbindung; GitHub (Paket 2) und Ordner (Paket 3) brauchen es zusätzlich je Repository bzw. je Ordner.

Ausgangslage:

- Verbindungen sind Datensätze in `connections` (Kalender, Telegram, Postfächer, Notion). Der eigene Eingang, WhatsApp Web und die Datei-Importe haben keinen Datensatz; ihre Stichwörter stehen je Nutzer in `users.import_keywords` ([ADR-0020](0020-stichwoerter-pro-kanal.md) §3, [ADR-0038](0038-eigener-eingang-und-whatsapp-web.md) §1).
- Jeder Weg in den Eingang speichert über den Modell-Hook von `inbox_items` (`inbox-service.prepareCreate`): die Record-API der SPA (Dateien, Erfassen) ebenso wie `inbox-service.ingest` der Kanäle im Server.
- Neue und verknüpfte bzw. verworfene Einträge lädt die SPA unterschiedlich: neue vollständig (Filter im Client), die übrigen seitenweise vom Server (Filter auf dem Server, [ADR-0019](0019-kanal-filter-und-gruppierung.md) §6).
- Ein Ticket nimmt kein archiviertes Projekt an (`validation_project_archived`).

## Entscheidung

### 1. Wo das Zielprojekt eingestellt wird

| Karte | Speicherort | Gilt für |
|---|---|---|
| Google Calendar, Telegram, Postfächer, Notion | `connections.target_project` (Relation auf `projects`, höchstens eins) | neue Einträge dieser Verbindung |
| Eigener Eingang (API) | `users.inbox_targets.api` | neue Einträge des Kanals `api`, für jeden Zugangsschlüssel |
| WhatsApp Web | `users.inbox_targets["whatsapp-web"]` | neue Einträge des Kanals `whatsapp-web` |
| Dateien hereinziehen | `users.inbox_targets.files` | neue Einträge aus `.eml`, `.ics` und WhatsApp-Export |

`users.inbox_targets` ist ein JSON-Feld (`{ "api": "<id>", "whatsapp-web": "<id>", "files": "<id>" }`, je leer für keins). Begründung:

- **Verbindungen tragen ihr Zielprojekt selbst**, als eigenes Feld statt in `settings`: `settings` prüft der Hook je Art mit einer festen Liste von Schlüsseln (Notion hat keine), die Dialoge „Stichwörter und Einstellungen …“ schreiben `settings` als Ganzes, und der Mail-Hilfsprozess liest es. Ein eigenes Feld bleibt von all dem unberührt, PocketBase prüft die Relation und leert sie, wenn das Projekt gelöscht wird.
- **Karten ohne Verbindung je Nutzer, wie ihre Stichwörter.** Beim eigenen Eingang wäre „je Zugangsschlüssel“ denkbar (Skript A nach „Arbeit“, Skript B nach „Haus“). Dagegen spricht: Schlüssel sind nach dem Anlegen unveränderlich (create und update `null`, nur die Route legt an, [ADR-0038](0038-eigener-eingang-und-whatsapp-web.md) §1), ein Schlüssel dient zugleich dem Kanal `whatsapp-web` (dieselbe Erweiterung, dieselbe Route), und die Stichwörter des eigenen Eingangs gelten heute schon je Nutzer und Kanal. Ein Wert je Karte ist eine Einstellung, die das Menü „•••“ und der Assistent eindeutig nennen können. Ein Ziel je Schlüssel lässt sich später als Einheit unter der Karte ergänzen, genau wie ein Repository oder ein Ordner (§3).
- **Dateien: ein Ziel für alle drei Arten.** Die Karte ist eine Karte, und Datei-Importe sind ohnehin interaktiv: Wer eine Datei hereinzieht, sieht die Auswahl und kann beim Umwandeln umentscheiden. Drei Werte hätten drei Auswahlfelder in einer Karte bedeutet, ohne erkennbaren Gewinn.
- **Keine Einstellung** haben Erfassen, Schnellerfassung, Zwischenablage und Bookmarklet: Dort wählt der Nutzer das Projekt im Moment der Eingabe selbst (Vorbelegung `source_meta.preset`, E4-Plan T-5).

### 2. Was der Eintrag sich merkt

- **Feld `inbox_items.target_project`** (Relation auf `projects`, höchstens eins, kein Cascade, Index `idx_inbox_items_target_project`). Begründung gegen `source_meta`: Der Filter muss für die seitenweise geladenen Ansichten auf dem Server laufen und Unterprojekte einschließen (`target_project = p || target_project.parent = p`, wie der Projektfilter der erledigten Tickets); das geht nur mit einer Relation, mit Index. `source_meta` kann zudem der Client beim Anlegen schreiben, und PocketBase würde eine ID darin beim Löschen des Projekts nicht leeren.
- **Nur der Server setzt es**, beim Anlegen in `prepareCreate` (`lib/target-project-service.js`, Regeln rein in `lib/target-project-rules.js`), also für jeden Weg gleich. Reihenfolge, der erste Treffer gilt:
  1. ein Ziel, das der Server schon aufgelöst hat (flüchtiger Schlüssel `@target_project`, den ein Client nicht senden kann): heute die Kopie einer Quelle beim Duplizieren, die das Ziel ihres Originals behält ([ADR-0045](0045-ticket-duplizieren.md) §4);
  2. mit Verbindung deren Ziel, auch wenn es leer ist (kein Rückfall auf eine Karte);
  3. sonst das Ziel der Karte des Kanals aus `users.inbox_targets`.
  Das Projekt muss im Bereich des Eintrags existieren, sonst bleibt das Feld leer. Ein **archiviertes** Projekt bleibt gesetzt: Der Eintrag merkt sich, was sein Weg sagte; beim Umwandeln wird es nicht vorbelegt (§4).
- **Unveränderlich für Clients** (`IMMUTABLE_FIELDS`, `validation_inbox_immutable`); ein mitgesendeter Wert beim Anlegen wird überschrieben. Eine spätere Änderung an Verbindung oder Karte wirkt deshalb **nur auf neue Einträge**.
- **Gelöschtes Projekt:** PocketBase leert die Relation in Einträgen und Verbindungen in der Transaktion des Löschens (Feld nicht Pflicht). Weil sonst kein Weg das Feld leert, schreibt der Update-Hook des Eintrags dabei `source_meta.target_gone = true`; Umwandeln und Panel sagen so „gelöscht“. In `users.inbox_targets` bleibt eine ID ohne Projekt stehen; die Karte nennt sie „gibt es nicht mehr“, neue Einträge kommen ohne Ziel.
- **Altdaten:** Einträge und Verbindungen von vorher haben kein Ziel und verhalten sich wie bisher. Die Bereinigung verworfener Einträge nach 30 Tagen lässt das Feld stehen (wie `connection`).

### 3. Vorbereitung für Repository und Ordner (Pakete 2 und 3)

Das Modell trennt **Einstellen** (am Weg) und **Merken** (am Eintrag). Für GitHub und Ordner kommt eine Ebene unter der Verbindung dazu (Repository bzw. Ordner mit eigenem Ziel); der Kanal löst beim Anlegen „Einheit vor Verbindung“ selbst auf und reicht das Ergebnis über denselben Schlüssel `@target_project` weiter, den heute die Kopie einer Quelle nutzt (Stufe 1 der Reihenfolge). Feld, Index, Filter, Gruppierung, Spalte, Vorbelegung beim Umwandeln und die Regeln für Archiv und Löschung bleiben unverändert. Ob das Ziel einer Einheit in den `settings` der Verbindung oder in einer eigenen Sammlung liegt, entscheiden diese Pakete; liegt es als ID in JSON, prüft die Auflösung ohnehin, ob das Projekt im Bereich existiert.

### 4. Umwandeln

- **Einzeln** („Neues Ticket“ aus dem Eingang): ein aktives Zielprojekt ist vorbelegt, darunter „Vorbelegt mit dem Zielprojekt „Haus (HAUS)“ des Eingangswegs; du kannst es ändern.“ Ein archiviertes oder gelöschtes wird nicht vorbelegt; der Hinweis am Feld sagt warum. Eine Vorbelegung, die der Nutzer beim Erfassen selbst gewählt hat (`preset`), gewinnt; beide kommen heute nie zusammen vor.
- **Gesammelt:** Haben gewählte Einträge ein aktives Zielprojekt, steht über „Projekt“ die Checkbox „Zielprojekt des Eintrags verwenden“ (an). Dann bekommt jeder Eintrag sein eigenes Ziel, die übrigen das Projekt des Dialogs; der Hinweis nennt die Zahlen und die Einträge mit archiviertem oder gelöschtem Ziel. Aus, gilt das Projekt des Dialogs für alle.
- Das gilt für jeden Eintrag, also auch für Ergebnisse eines Notion-Imports und für die Kopie einer Quelle, die nach dem Löschen ihres Duplikats wieder im Eingang liegt.

### 5. Eingang

- **Filter „Zielprojekt“** neben den Chips (Popover wie „Projekt“ und „Tag“ in „Aufgaben“): „Ohne Zielprojekt“, die aktiven Projekte in Baum-Reihenfolge, archivierte unter „Archiviert“. Ein Projekt schließt seine Unterprojekte ein ([ADR-0034](0034-unterprojekte.md) §6). Adresse `zielprojekt=<id>|ohne`. Neue Einträge filtert der Client (`matchesTarget`), die übrigen Ansichten der Server mit demselben Ausdruck (Paritätstest).
- **„Nach Zielprojekt gruppieren“** als Switch daneben (Adresse `gruppe=zielprojekt`): je Projekt eine Gruppe von Zeilen mit dem Pfad als Überschrift (`th scope="rowgroup"`) und der Zahl, in Baum-Reihenfolge, archivierte danach, „Ohne Zielprojekt“ zuletzt. Keine Untergruppen, kein Zuklappen: Der Eingang ist eine Liste zum Sichten.
- **Spalte „Zielprojekt“** im Menü „Spalten“, standardmäßig aus und als erste weichend; so ändern sich Schwellen und Standardansicht nicht ([ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md), Nachtrag 6).
- **Panel** eines Eintrags: Zeile „Zielprojekt“ („Haus › Garten (GART)“, „… archiviert“, „gelöscht“).
- Vor der Migration fehlen Filter, Schalter und Spalte; ein Eintrag ohne das Feld genügt als Zeichen (`withoutTargetField`).

### 6. Karten und Assistenten

- **In den Details** jeder Karte, die Einträge bringt, steht die Zeile „Zielprojekt“ mit `ProjectSelect` (nur aktive Projekte; ein archiviertes Ziel bleibt als „(archiviert)“ sichtbar), die sofort speichert wie die Felder eines Tickets. Der Hinweis darunter sagt, wer das Projekt bekommt und dass es nur für neue Einträge gilt, bzw. warum ein archiviertes oder gelöschtes nichts bewirkt. Eine Ablehnung steht als Feldfehler am Feld ([ADR-0009](0009-fehlerfarbe.md)), Erfolg als Flag „Neue Einträge von „Gmail“ bekommen jetzt das Zielprojekt „Haus (HAUS)“.“.
- **Im Menü „•••“** führt „Zielprojekt …“ dorthin: Die Karte klappt ihre Details auf und setzt den Fokus auf das Feld (`ChannelCard.showDetails`). Kein Dialog.
- **Assistenten:** Bei Verbindungen kommt direkt nach „Verbinden“ der optionale Schritt „Zielprojekt wählen (optional)“, bevor erste Einträge eintreffen können. Er hält nie auf (erledigt, sobald die Verbindung existiert), der Fortschritt aus den Serverdaten springt über ihn. Bei WhatsApp Web ist er der letzte Schritt, weil Einträge erst nach der Einrichtung der Erweiterung kommen. Der eigene Eingang hat keinen Assistenten; seine Karte genügt.
- Vor der Migration nennt die Zeile den Neustart (`restartNeeded`), und das Menü bietet den Eintrag nicht an.

### 7. Rechte und Prüfungen

- Keine Änderung an API-Regeln. Ein Nutzer kann als neues Ziel einer Verbindung nur ein aktives Projekt im Bereich der Verbindung setzen (`validation_target_project_missing`, gleicher Code für fremde und fehlende IDs; `validation_target_project_archived`); ein unverändertes archiviertes Ziel wird beim Speichern anderer Felder nicht erneut geprüft. Umbenennen ändert das Ziel nicht (`validation_connection_rename_only`). Der Superuser bleibt frei.
- `users.inbox_targets`: Form (`validation_inbox_targets`), jedes geänderte Ziel ein aktives Projekt im privaten Bereich des Nutzers, denn die Einträge dieser Karten sind privat.

## Alternativen

- **Ziel in `source_meta`:** kein Filter mit Unterprojekten auf dem Server, kein Index, vom Client beim Anlegen schreibbar, beim Löschen des Projekts nicht geleert. Verworfen.
- **Ziel in `connections.settings`:** siehe §1 (Prüfung je Art, ganzes Schreiben durch die Dialoge, Mail-Hilfsprozess). Verworfen.
- **Je Zugangsschlüssel bzw. je Dateiart:** siehe §1. Zurückgestellt bzw. verworfen; ein Ziel je Schlüssel passt später als Einheit unter die Karte (§3).
- **Änderung rückwirkend auf vorhandene Einträge:** widerspricht der Spec („nur neue“) und würde Einträge ändern, die der Nutzer schon gesichtet hat. Verworfen.
- **Archivierte Ziele vorbelegen:** Der Ticket-Hook lehnt archivierte Projekte ab. Verworfen; der Hinweis sagt es.
- **Ziel beim Anlegen weglassen, wenn das Projekt archiviert ist:** Der Eintrag verlöre die Information, und der Filter fände ihn nicht. Verworfen.
- **Optionaler Schritt am Ende des Assistenten:** Erste Einträge kämen vorher ohne Ziel (Kalender beim ersten Abruf). Verworfen, außer bei WhatsApp Web.
- **Eigene ADR „Beobachtete Quellen“ mit allen drei Paketen jetzt:** Paket 1 gilt für alle bestehenden Kanäle und hängt nicht am Konzept „Verweis mit Status“; dessen Entscheidungen (Status nur anzeigen, Verweis statt Kopie bei Ordnern, GitHub-Token) fallen mit den Paketen 2 und 3 und bekommen dort ihre eigenen ADRs, die auf diese verweisen. Diese ADR beschreibt nur, was umgesetzt ist, und legt in §3 fest, wie die Pakete darauf aufsetzen.

## Konsequenzen

- Migration `1790203100_inbox_target_project.js` (additiv, mit Rückweg; Rollback-Test mit Daten): **Neustart nötig** (`neu-starten.bat`). Bis dahin verhalten sich Hooks wie vorher, und die Oberfläche blendet alles aus.
- Neue Module `lib/target-project-rules.js` (rein, Unit-Tests) und `lib/target-project-service.js`; Spiegel `web/src/lib/domain/target-project.ts` mit Paritätstest (`tests/unit/web-target-project.test.mjs`).
- Die Assistenten der Verbindungen haben sieben Schritte (sechs Pflicht, ein optionaler); [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) §4 bekommt dafür den Nachtrag ZP.
- Tests: `tests/integration/inbox-target-project.test.mjs` (Zuweisung je Weg, nur neue, unveränderlich, Prüfungen, Archiv, Löschung, Kopie, Filter, Datenschicht), `migrations-rollback.test.mjs`, Komponententests von Karten, Assistenten, Umwandeln, Eingang und Panel. Manifest ab BYL-E6-1100.
- CLAUDE.md §5 und §7, README und Hilfe („Kanäle und Zugangsdaten“) nennen das Zielprojekt.

## Nachtrag (2026-10-02, [ADR-0050](0050-github-kanal-und-beobachtete-quellen.md)): Zielprojekt je Repository

§3 ist für GitHub umgesetzt, ohne dass sich an Feld, Filter, Gruppierung, Spalte, Vorbelegung oder den Regeln für Archiv und Löschung etwas ändert:

- **Speicherort:** in `connections.settings.repos[].target` (ID oder leer), neben Pfaden und Ereignissen des Repositorys. Begründung: Ein Repository ist eine Einstellung seiner Verbindung (ADR-0050 §2); eine eigene Sammlung mit Relation brächte Regeln, Negativtests und Realtime für höchstens 20 Zeilen, und die Auflösung prüft eine ID in JSON ohnehin auf Existenz und Bereich (§3).
- **Prüfung beim Speichern** (`connection-service.guardRepoTargets`, nur für App-Konten): Ein Ziel, das für sein Repository neu ist, muss ein aktives Projekt im Bereich der Verbindung sein (`validation_target_project_missing`, `validation_target_project_archived` am Feld `settings`); ein unverändertes, inzwischen archiviertes bleibt gültig, wie beim Ziel der Verbindung (§7).
- **Auflösung: Einheit vor Verbindung.** Der Kanal gibt das Ziel des Repositorys über `@target_project` (Stufe 1) weiter, solange das Projekt im Bereich der Verbindung existiert; ohne eigenes Ziel und bei einem gelöschten Ziel gibt er nichts weiter, und Stufe 2 nimmt das Ziel der Verbindung. Ein gelöschtes Projekt bleibt als ID in den Einstellungen stehen (PocketBase leert JSON nicht); die Karte nennt es „gibt es nicht mehr“.
- **Paket 3 (Ordner)** übernimmt dasselbe Muster je Ordner.

## Nachtrag (2026-10-02, [ADR-0051](0051-ordner-kanal-verweise-statt-kopien.md)): Zielprojekt je Ordner

§3 ist für den Ordner-Kanal umgesetzt, ebenfalls ohne Änderung an Feld, Filter, Gruppierung, Spalte, Vorbelegung oder den Regeln für Archiv und Löschung:

- **Speicherort:** `connections.settings.folders[].target` (ID oder leer), neben Pfad, Unterordnern, Typen, Ausschlüssen und „Änderungen melden“ des Ordners; Begründung wie beim Repository (ADR-0051 §2).
- **Prüfung beim Speichern** (`connection-service.guardFolders`, nur für App-Konten): Ein Ziel, das für seinen Ordner neu ist, muss ein aktives Projekt im Bereich der Verbindung sein (`validation_target_project_missing`, `validation_target_project_archived`); ein unverändertes, inzwischen archiviertes bleibt gültig.
- **Auflösung: Ordner vor Verbindung** über `@target_project`, solange das Projekt im Bereich existiert; sonst gilt das Ziel der Verbindung. Auch Einträge aus „Vorhandene Dateien übernehmen“ bekommen das Ziel ihres Ordners.

## Nachtrag (2026-10-04, [ADR-0061](0061-verschieben-zwischen-bereichen-und-aufloesen.md) Nachtrag E7-4b): Ziele je Repository und Ordner beim Verschieben

- **Verschieben:** Wer ein Projekt in den anderen Bereich verschiebt, leert jedes Ziel eines Repositorys bzw. Ordners, das danach über die Grenze zeigen würde. Das gilt wie für das Ziel einer Verbindung und eines Eintrags. Die Vorschau nennt die Anzahl. Ein Ziel eines gelöschten Projekts bleibt als ID stehen.
- **Abruf:** Ein Ziel in einem anderen Bereich aus der Zeit davor gilt weiter wie ein gelöschtes, der Lauf geht weiter. Neu steht dazu je Lauf und Ziel ein Eintrag im Log von PocketBase, mit Verbindung und Projekt, ohne Pfad.
