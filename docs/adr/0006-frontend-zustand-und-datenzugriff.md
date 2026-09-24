# ADR-0006: Frontend-Zustand, Datenzugriff und Standard-Sortierung

- **Status:** Angenommen
- **Datum:** 2026-09-24
- **Entscheidung durch:** Advisor (Produktvorgaben zur Reihenfolge: Nutzer, 2026-09-24)

## Kontext

Mit E2 lädt, zeigt und ändert die SPA erstmals fachliche Daten: Ticketliste, Detail-Seitenpanel, Kommentare, Verlauf und Realtime-Aktualisierungen. Vorgaben:

- CLAUDE.md §4: nur Runes, geteilter Zustand in `.svelte.ts`-Modulen, kein `svelte/store`. `$effect` nur für echte Seiteneffekte.
- CLAUDE.md §7: Realtime aktualisiert gezielt einzelne Datensätze, kein Polling und kein komplettes Neuladen. Filterzustand steht in der URL.
- [E1-Plan](../plan/e1.md) §6/§7: Die Auto-Cancellation des SDK ist global aus; veraltete Anfragen werden per `AbortController` verworfen. Listenregeln liefern für einen abgemeldeten Client leere Listen statt 401.
- Die Datenzugriffe sollen gegen die Wegwerf-Instanz des Harness testbar sein ([ADR-0004](0004-teststrategie-hooks-migrationen.md)).
- Produktentscheidung zur Startansicht: nur nicht erledigte Tickets, Schalter „Erledigte anzeigen“. Standard-Reihenfolge bis E3: zuerst überfällige und bald fällige, dann nach Priorität (urgent > high > medium > low), dann die neuesten; Tickets ohne Fälligkeit nach den fälligen.

**Befund zur Sortierung (PocketBase 0.40.4, `tools/search/sort.go`):** Der Parameter `sort` akzeptiert nur Feldnamen mit `+`/`-` sowie `@random` und `@rowid`. Ausdrücke mit Parametern lehnt `BuildExpr` ab (`invalid sort field`), `CASE` oder Funktionen gibt es nicht. Deshalb gilt:

- `priority` ist ein Select-Feld und wird als Text sortiert, also `high < low < medium < urgent`. Die gewünschte Rangfolge ist so nicht erreichbar.
- Ein leeres `due` ist in 0.40.4 der leere String `''` und steht bei aufsteigender Sortierung vorn. „Ohne Fälligkeit zuletzt“ geht nur mit zwei getrennten Anfragen.
- „Bald fällig“ hängt vom heutigen Datum in Europe/Berlin ab ([ADR-0005](0005-zeitzone-europe-berlin.md)). Ein gespeichertes Sortierfeld würde jeden Tag veralten.

## Entscheidung

### 1. Schichten

| Schicht | Ort | Inhalt |
|---|---|---|
| Domäne (rein) | `web/src/lib/domain/*.ts` | Typen `Ticket`, `Comment`, `HistoryEntry`; Umrechnung von `due` (`YYYY-MM-DD` ↔ `YYYY-MM-DD 00:00:00.000Z`); `berlinToday(now)` über `Intl.DateTimeFormat` mit `timeZone: 'Europe/Berlin'`; Vergleichsfunktion der Standard-Sortierung; deutsche Bezeichnungen für Status, Priorität und Historienfelder. Keine Imports aus `$app`, kein SDK. |
| Datenzugriff | `web/src/lib/data/*.ts` | Dünne, zustandslose Funktionen, die als ersten Parameter eine PocketBase-Instanz erhalten, z. B. `listOpenTickets(pb, { signal })` oder `updateTicket(pb, id, patch, { signal })`. Sie kapseln Collection-Namen, `fields`/`expand`, Filter (immer über `pb.filter()`), Sortierung und die Umwandlung in Domänentypen. Keine Imports aus `$lib` oder `$app`, damit Root-Integrationstests sie direkt gegen den Harness ausführen können. |
| Zustand | `web/src/lib/stores/*.svelte.ts` | Klassen mit privaten `$state`-Feldern und Gettern, wie `Auth` aus E1: `TicketListStore` (offene Tickets, geladene Seiten erledigter Tickets, Lade- und Fehlerzustand, `today`) und `TicketDetailStore` (ein Ticket mit Kommentaren und Verlauf). Methoden `load`, `upsert`, `remove` und `reset` sind idempotent, sodass eigene Antworten und Realtime-Events über denselben Weg laufen. |
| Oberfläche | `web/src/routes/(app)/…`, `web/src/lib/components/…` | Komponenten lesen aus den Stores und rufen deren Methoden auf. Keine direkten SDK-Aufrufe in Komponenten. |

- Die Stores werden pro App-Layout-Instanz erzeugt und über typisierte Kontext-Schlüssel (`setContext`/`getContext`) bereitgestellt, nicht als Modul-Singletons. Beim Abmelden und in Tests entsteht so ein sauberer, leerer Zustand, und Daten eines früheren Nutzers bleiben nicht im Speicher.
- Datensätze liegen im Store in einer `SvelteMap` (aus `svelte/reactivity`, Runes-basiert und kein `svelte/store`) mit der Record-ID als Schlüssel. Die sortierte Liste ist ein `$derived`.
- Keine zusätzliche Bibliothek für Caching oder Querys (etwa TanStack Query). Der Umfang (eine Liste, ein Detail) rechtfertigt keine weitere Abhängigkeit.

### 2. Standard-Sortierung clientseitig

Die Reihenfolge berechnet eine reine Funktion `compareTickets(a, b, today)` in `web/src/lib/domain/ordering.ts`:

1. **Gruppe „dringlich“:** Tickets mit `due` ≤ heute + `SOON_DAYS` (überfällige eingeschlossen), aufsteigend nach `due`, bei gleichem Datum nach Priorität (urgent zuerst), dann neueste zuerst (`created` absteigend).
2. **Gruppe „übrige“:** nach Priorität (urgent zuerst). Bei gleicher Priorität stehen Tickets mit Fälligkeit (aufsteigend) vor Tickets ohne Fälligkeit, dann neueste zuerst.
3. Letzter Gleichstand: `id`, damit die Reihenfolge stabil und deterministisch bleibt.

`today` ist das Berliner Kalenderdatum als `YYYY-MM-DD`. Der Listen-Store hält es als `$state` und aktualisiert es nach der nächsten Berliner Mitternacht, damit ein lange offener Tab die Gruppen richtig umsortiert. `SOON_DAYS` ist eine benannte Konstante (Vorschlag 7 Tage, siehe offene Frage im [E2-Plan](../plan/e2.md)).

**Begründung:**

- Die Rangfolge der Priorität und „ohne Fälligkeit zuletzt“ lassen sich mit `sort` nicht ausdrücken (Befund oben).
- „Bald fällig“ ist zeitabhängig. Ein vom Hook gepflegtes Sortierfeld müsste täglich per Cron neu berechnet werden und bräuchte Serverlogik für Berlin-Zeit, die erst in E4 entsteht.
- Die offenen Tickets einer Person sind überschaubar (Größenordnung Hunderte). Sie werden vollständig geladen (`getFullList`, Batches zu 500, `skipTotal`), damit clientseitig über die ganze Menge sortiert werden kann.
- Realtime-Updates fügen einzelne Datensätze in die Map ein, und das `$derived` sortiert neu. Die Positionierung braucht keinen Serverzugriff.
- E3 bringt eine Sortierauswahl. Die Vergleichsfunktion ist dann eine von mehreren; Server-Sortierung wird dort je Variante neu bewertet.

### 3. Erledigte Tickets: seitenweise vom Server

Ist „Erledigte anzeigen“ aktiv, lädt der Store erledigte Tickets seitenweise (50 pro Seite, Filter `status = "done"`, `sort = -completed_at,-created`). Diese Reihenfolge kann der Server liefern. Sie erscheinen in einem eigenen Abschnitt unter den offenen Tickets, mit „Weitere laden“. Erledigte Tickets wachsen über Jahre unbegrenzt; ein vollständiges Laden wäre dort nicht vertretbar. Der Schalter steht in der URL (`?erledigte=1`, CLAUDE.md §7).

### 4. Veraltete Anfragen und Fehler

- Jede Ladeoperation eines Stores hat einen eigenen `AbortController`. Ein neuer Aufruf (Schalter umgelegt, anderes Ticket geöffnet, Store zurückgesetzt) bricht den alten ab. Abgebrochene Anfragen (`isAbort`) sind kein Fehler und werden nicht angezeigt.
- `web/src/lib/data/errors.ts` bildet Fehler auf Arten ab: `network` (Status 0, ohne Abbruch), `not_found` (404), `forbidden` (403), `validation` (400 mit Feldfehlern aus `response.data`), `session` (401) und `server` (sonst). Die Erkennung prüft die Struktur (`status`, `response`) statt `instanceof ClientResponseError`, weil Root-Tests und `web` je eine eigene Kopie des SDK laden.
- Vor jeder Anfrage prüft der Store `pb.authStore.isValid` (über `auth`). Ein abgelaufener Token beendet die Sitzung, und der Guard leitet zum Login mit Rücksprungziel. Sonst würden die Listenregeln leere Listen liefern ([E1-Plan](../plan/e1.md) §7). Die Sitzungspflege selbst regelt [ADR-0007](0007-realtime-und-sitzungspflege.md).

### 5. Schreibvorgänge

- Änderungen senden nur die geänderten Felder (`PATCH`-Semantik von `update`). Die Antwort des Servers (mit neuem `key`, `completed_at` und `updated`) ersetzt den Datensatz im Store; es gibt keine optimistische Anzeige ohne Serverbestätigung. Lokal antwortet der Server in wenigen Millisekunden, der Nutzen wäre also gering, und das Zurückrollen würde komplizierter.
- Ausnahme Häkchen: Die Checkbox zeigt den neuen Zustand sofort, ist bis zur Antwort gesperrt und springt bei einem Fehler mit Meldung zurück.
- Ein Datensatz im Store wird nur ersetzt, wenn das eingehende `updated` nicht älter ist als das vorhandene. So überschreibt ein verspätetes Realtime-Event keine neuere Antwort.

## Alternativen

- **Server-Sortierung über ein zusätzliches Feld** (z. B. `priority_rank` als Zahl und `due_sort` mit `9999-12-31` für leere Werte, beide vom Hook gepflegt): würde Rangfolge und Leerwerte lösen, aber nicht „bald fällig“, weil das von heute abhängt. Außerdem kostet es eine Migration, doppelte Daten und Hook-Code. Verworfen für E2; wird in E3 für seitenweise sortierte Varianten erneut geprüft.
- **Mehrere Server-Anfragen pro Gruppe** (überfällig, bald fällig, übrige mit Fälligkeit, ohne Fälligkeit): löst die Prioritätsrangfolge trotzdem nicht. Verworfen.
- **Modul-Singletons für Stores** (wie `auth`): einfacher, aber Zustand überlebt einen Nutzerwechsel, und Tests müssten ihn manuell zurücksetzen. Verworfen; `auth` bleibt als einziges Singleton, weil es die Sitzung selbst verwaltet.
- **SvelteKit-`load`-Funktionen:** Im SPA-Modus ohne SSR bringen sie wenig. Realtime und Abbruch müssten dann zwischen `load` und Komponenten aufgeteilt werden. Verworfen; Laden erfolgt in den Stores.
- **Klassische Paginierung auch für offene Tickets:** Dann wäre die clientseitige Sortierung nur seitenweise korrekt. Verworfen.

## Konsequenzen

- Positiv: Die Sortierlogik ist rein, vollständig unit-testbar und unabhängig vom Schema.
- Positiv: Die Datenzugriffe werden gegen die echte Binary mit echten Regeln getestet (Root-Integrationstests importieren `web/src/lib/data/*.ts`).
- Positiv: Ein Nutzerwechsel hinterlässt keine Daten im Speicher.
- Negativ: Bei sehr vielen offenen Tickets (mehrere Tausend) wird das vollständige Laden spürbar. Das ist für eine private Ticketliste unwahrscheinlich; bei Bedarf wird in E3 neu bewertet.
- Negativ: Die Reihenfolge weicht von jeder einfachen Server-Sortierung ab. Seiten, die in E3 serverseitig sortieren, brauchen eine eigene, klar benannte Sortierauswahl.
