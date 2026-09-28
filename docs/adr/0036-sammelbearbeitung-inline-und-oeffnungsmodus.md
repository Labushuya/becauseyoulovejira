# ADR-0036: Gemerkter Öffnungsmodus, Sammelbearbeitung mit Rückgängig und Inline-Bearbeitung in der Tabelle

- **Status:** Angenommen; §1 umgesetzt in BI-1. §2 bis §6 folgen mit BI-2 und BI-3 nach [docs/plan/bulk-inline-ansicht.md](../plan/bulk-inline-ansicht.md) und werden dann hier ergänzt.
- **Datum:** 2026-09-28
- **Entscheidung durch:** Nutzer (Arbeitspaket „Bulk & Inline & Ansicht“: Öffnungsmodus wie in Jira, Auswahlspalte mit Sammelaktionen und Rückgängig, Inline-Bearbeitung in Zellen), Advisor (Umfang, Reihenfolge, Anforderungen an die Architektur), Executor (Einzelheiten, Wahl der Architektur)
- **Präzisiert:** [ADR-0025](0025-ui-konsistenz-overlay-system.md) §7 (Vollansicht „über dem Panel“, Schließen „zurück ins Panel“), siehe dort Nachtrag 15
- **Bezug:** [ADR-0006](0006-frontend-zustand-und-datenzugriff.md) (Zustand im `(app)`-Layout), [ADR-0030](0030-spalten-breiten-und-kompakte-zeilen.md) (Vorlieben pro Gerät)

## Kontext

- Ein Ticket öffnet heute immer im Seitenpanel. „Vollansicht“ im Kopf des Panels legt ein XL-Modal **über** das Panel, das darunter gemountet bleibt; × der Vollansicht führt zurück ins Panel. Jira merkt sich dagegen, wie der Nutzer ein Ticket zuletzt geöffnet hat, und öffnet das nächste genauso.
- Wer die Vollansicht bevorzugt, braucht heute zwei Klicks je Ticket, und das Panel blitzt dabei kurz auf.
- Sammelaktionen und die Bearbeitung in Zellen (BI-2, BI-3) kommen danach und werden in diesem ADR ergänzt.

## Entscheidung

### 1. Öffnungsmodus: Seitenpanel oder Vollansicht, gemerkt pro Gerät (BI-1)

- **Zwei Modi:** „Seitenpanel“ (Standard) und „Vollansicht“. Gemerkt in `localStorage` unter `byl-ticket-open`; gespeichert wird nur `full`, „Seitenpanel“ entfernt den Schlüssel (wie `byl-transparency`). Andere Werte, ein gesperrter oder voller Speicher zählen als „Seitenpanel“, ohne Fehler. Ein `storage`-Listener gleicht andere Tabs ab. Nur auf dem Gerät, nicht pro Nutzer bis E7 und nicht in der URL, wie die Spalten (ADR-0030 §5).
- **Gesetzt wird er nur durch eine ausdrückliche Wahl:** „Vollansicht öffnen“ im Kopf des Panels setzt „Vollansicht“, der neue Knopf **„Im Seitenpanel öffnen“** im Kopf der Vollansicht setzt „Seitenpanel“. Mit Strg, Cmd oder Umschalt (neuer Tab oder neues Fenster) wird nichts gemerkt. Ein direkter Aufruf der Adresse, Neuladen oder Zurück ändern nichts.
- **Der Knopf** steht an derselben Stelle wie „Vollansicht öffnen“ im Panel (vor dem ×, nach „Löschen …“), als `.button-icon`-Link mit dem gespiegelten Symbol der zwei Pfeile, `aria-label` und `title` „Im Seitenpanel öffnen“. Er ist ein Link auf `/tickets/<id>`, also auch per Mittelklick nutzbar.
- **Wo der Modus gilt:** in jedem Ticket-Link der App, außer in der Vollansicht selbst (dort bleiben Pfad und Unteraufgaben Links auf Vollansichten): Zeilen der Tabelle (Titel-Link und Zeilenklick), Pfad und „Unteraufgaben“ im Panel, „Übergeordnet“, der Chip „→ HAUS-12“ und „Ticket ansehen“ im Eingang, „Ticket öffnen“ im Panel eines Eintrags, Links der Wiederholungen, Ergebnisse von Schnellerfassung, Datei-Import und Sammelumwandeln. Nach „Neues Ticket“ bleibt das neue Ticket im Panel, weil das Formular dort stand.
- **Nie beide zugleich:** Die Vollansicht **ersetzt** das Panel. Auf `/tickets/<id>/voll` ist das Panel nicht gemountet, die Ansicht hat keine Panel-Spalte (`ViewWithPanel` mit `withPanel` falsch), und die Liste steht in voller Breite hinter dem Modal. Weil Panel und Vollansicht allein aus der Route folgen, zeigt auch Zurück und Vor nie beide. Ist „Vollansicht“ gemerkt, verlinkt die Zeile direkt auf `/voll`; das Panel mountet dabei nie und blitzt nicht auf.
- **Schließen der Vollansicht** (×, Esc, Schleier) führt zur **Liste ohne Panel** mit derselben Query; der Fokus geht auf den Titel-Link der Zeile des Tickets (sonst regelt `TicketTable` ihn wie beim Schließen des Panels).
- **Unter 64rem** (das Panel liegt als Overlay über der Liste) bleibt das bisherige Verhalten: Links öffnen das Panel, „Vollansicht“ legt das Modal über die Liste, Schließen führt zurück ins Panel mit Fokus auf „Vollansicht öffnen“. Eine Wahl dort wird **nicht** gespeichert, damit ein schmales Fenster die Vorliebe des breiten nicht überschreibt; wird das Fenster breit, gilt die gemerkte Wahl wieder (`matchMedia`, dieselbe Grenze wie `PANEL_EMBEDDED_QUERY`).
- **Ungespeicherte Änderungen:** Entwürfe liegen in den Stores (`TicketDetailStore`, `TicketActivityStore`), nicht in den Komponenten. Der Wechsel zwischen Panel und Vollansicht **desselben** Tickets verliert deshalb nichts und fragt nicht (wie bisher). Erst wer das Ticket verlässt, bekommt die bestehende Frage „Änderungen verwerfen?“, aus der Vollansicht inline (`TicketLeaveQuestion`), sonst als Bestätigung.
- **Umsetzung:** reine Regeln in `web/src/lib/domain/open-mode.ts` (`parseOpenMode`, `serializeOpenMode`, `effectiveOpenMode`), `TicketOpenModeStore` in `web/src/lib/stores/open-mode.svelte.ts` im Kontext des `(app)`-Layouts; Komponenten holen die Links über `ticketLinks()` (ohne Kontext, etwa in Tests einzelner Komponenten, gilt das Panel). `ViewWithPanel` rendert den Inhalt der Route ohne Panel mit `display: contents`, weil ein Modal unter einem Vorfahren mit `display: none` nicht erscheint.

## Alternativen

- **Modus in der URL** (`?ansicht=voll`): Jede Adresse trüge ihn, Links aus anderen Ansichten müssten ihn kennen, und eine geteilte Adresse würde die Vorliebe eines anderen Geräts aufzwingen. Verworfen, wie bei den Spalten.
- **Modus pro Nutzer in PocketBase:** braucht Migration und API-Regel und bringt vor E7 nichts. Zurückgestellt.
- **Vollansicht weiter über dem gemounteten Panel:** Zwei Instanzen derselben Teile (Beschreibung, Felder) liefen gleichzeitig, das Panel blitzt beim direkten Öffnen auf, und die Liste bliebe gestaucht hinter dem Modal. Verworfen.
- **Jeder Wechsel merkt den Modus, auch per Neuladen oder Zurück:** Ein Zurück aus der Vollansicht würde die Wahl still umstellen. Verworfen; nur die zwei Knöpfe merken.
- **Unter 64rem die Wahl ebenfalls speichern:** Auf einem schmalen Fenster gibt es kein eingebettetes Panel, das man „wählen“ könnte; die Vorliebe des breiten Fensters ginge verloren. Verworfen.

## Konsequenzen

- Positiv: Wer die Vollansicht bevorzugt, öffnet Tickets mit einem Klick, ohne Aufblitzen; die Liste bleibt dahinter in voller Breite. Keine Migration, kein Neustart.
- Negativ: Die Vollansicht ist nicht mehr „über dem Panel“; ADR-0025 §7 und CLAUDE.md §7 sind nachgezogen (Nachtrag 15 in ADR-0025).
- Die Tests einzelner Komponenten laufen ohne Kontext weiter mit dem Panel; die Route des Tickets und die Tabelle haben eigene Fälle mit einem Store (BYL-E6-320).
