# ADR-0007: Realtime-Abos und Sitzungspflege im Frontend

- **Status:** Angenommen (mit Nachtrag 2026-09-28: erneuter Versuch gescheiterter Abos und Hinweis)
- **Datum:** 2026-09-24
- **Entscheidung durch:** Advisor

## Kontext

CLAUDE.md §7 verlangt: Subscriptions aktualisieren gezielt einzelne Datensätze, kein Polling, kein komplettes Neuladen. Der [E1-Plan](../plan/e1.md) §7 nennt drei Risiken: abgelaufene Tokens in lange offenen Tabs (Listenregeln liefern dann leere Listen statt 401), weiterlaufende Abos nach dem Abmelden und veraltete Anfragen ohne Auto-Cancellation.

Befunde (PocketBase 0.40.4 `apis/realtime.go`, JS SDK 0.28.1 `RealtimeService`):

- Der Server merkt sich die Auth eines Realtime-Clients beim Setzen der Abos (`POST /api/realtime`) als Datensatz, nicht als Token. Ein späteres Ablaufen des Tokens prüft er für eine bestehende Verbindung nicht.
- Eine Realtime-Verbindung lebt höchstens 30 Minuten (Idle-Timeout 5 Minuten). Danach verbindet das SDK neu und sendet die Abos mit dem **aktuellen** Token erneut. Ist dieser abgelaufen oder ungültig, gilt der Client als Gast und bekommt still keine Events mehr.
- Ein Wechsel von einem angemeldeten Nutzer zu einem anderen auf derselben Verbindung lehnt der Server mit 403 ab („authorization don't match“). Nur der Wechsel von Gast zu angemeldet ist erlaubt.
- Das SDK sendet die Abos bei einer Änderung im `authStore` nicht von selbst neu. Beim Neuverbinden meldet es `PB_CONNECT`, vorher ruft es `onDisconnect` auf. Events aus der Lücke dazwischen gehen verloren.
- Ändert sich der `tokenKey` des Nutzers (etwa durch ein neues Passwort in der Verwaltung), entfernt der Server die Auth aller Realtime-Clients dieses Nutzers.
- Abonnements unterstützen die Optionen `filter`, `fields` und `expand`. Events werden nach den List- und View-Regeln der Collection gefiltert (in E1 per `realtime-rules.test.mjs` belegt).

## Entscheidung

### 1. Sitzungspflege (`auth.svelte.ts`)

- **Beim App-Start** bleibt es bei `authRefresh` (E1, verlängert die Sitzung).
- **Keep-alive:** Solange das App-Layout angezeigt wird, prüft `auth.keepAlive()` die Sitzung beim Start, alle 30 Minuten, bei `visibilitychange` (Tab wieder sichtbar) und beim Ereignis `online`. Läuft der Token in weniger als 24 Stunden ab (`isTokenExpired(token, 86400)`), ruft es `authRefresh` auf. 401/403 beenden die Sitzung; ein Netzwerk- oder Serverfehler lässt sie bestehen, der nächste Anlass versucht es erneut. Die Token-Laufzeit von 5 Tagen (OF-18) wird so in jedem genutzten Tab verlängert. Timer und Listener räumt das Layout beim Verlassen auf (Rückgabe des `$effect`).
- **Vor jeder Datenanfrage** prüfen die Stores `pb.authStore.isValid`. Ist der Token abgelaufen, wird die Sitzung beendet, und der Guard leitet zu `/login?redirect=<aktuelle Seite>` ([ADR-0006](0006-frontend-zustand-und-datenzugriff.md)).
- **Antwort 401** auf eine Datenanfrage beendet die Sitzung ebenfalls.
- Der Keep-alive läuft nicht während des Renderns. Er ändert keinen `status` auf `checking`, damit die Oberfläche nicht verschwindet; nur ein endgültiges Sitzungsende wirkt sich aus.

### 2. Abos

| Abo | Wann | Optionen |
|---|---|---|
| `tickets` / `*` | solange das App-Layout mit angemeldetem Nutzer angezeigt wird, gehalten vom `TicketListStore` | dieselben `fields`/`expand` wie die Liste (`project`, `tags`) |
| `comments` / `*` | solange ein Detail-Panel offen ist | `filter: pb.filter('ticket = {:id}', { id })`, `expand: 'author'` |
| `ticket_history` / `*` | solange ein Detail-Panel offen ist | `filter: pb.filter('ticket = {:id}', { id })` |

- **Gezielte Updates:** `create` und `update` rufen `store.upsert(record)` auf, `delete` ruft `store.remove(id)` auf. Der Store entscheidet anhand des Status, ob ein Datensatz in die offenen Tickets, in die geladenen erledigten Tickets oder in keine der beiden Listen gehört. Ein Event mit älterem `updated` als der vorhandene Datensatz wird ignoriert. Eigene Schreibvorgänge kommen als Event ein zweites Mal an; das ist wirkungslos, weil `upsert` idempotent ist.
- **Gelöschtes Ticket im offenen Panel:** Das Panel zeigt „Dieses Ticket wurde gelöscht.“ mit einem Link zur Liste, statt still zu verschwinden.
- **Aufräumen:** Jedes Abo gibt seine `UnsubscribeFunc` an den Besitzer zurück. Ein Panelwechsel beendet die Detail-Abos des alten Tickets, bevor die neuen gesetzt werden.
- **Abmelden:** `auth.logout()` ruft zuerst `pb.realtime.unsubscribe()` auf (beendet alle Abos und die Verbindung), danach `authStore.clear()`. Die Stores werden verworfen. So laufen keine Abos ohne Berechtigung weiter, und eine spätere Anmeldung eines anderen Nutzers trifft nicht auf die 403-Sperre der alten Verbindung.
- **Sitzungsende durch den Server** (Token abgelaufen, anderer Tab meldet ab, `tokenKey` geändert): Der `authStore.onChange` im `Auth`-Objekt erkennt den leeren Store und beendet die Abos auf dieselbe Weise.

### 3. Lücken nach dem Neuverbinden

Nach jedem `PB_CONNECT`, das auf eine unterbrochene Verbindung folgt, gleicht der `TicketListStore` einmal ab: Er lädt die offenen Tickets und die bereits geladenen Seiten der erledigten Tickets neu und führt sie mit dem Bestand zusammen (neue einfügen, geänderte ersetzen, fehlende entfernen). Das offene Detail-Panel lädt Ticket, Kommentare und Verlauf neu. Die Oberfläche flackert dabei nicht, Scrollposition und Fokus bleiben erhalten, und laufende Eingaben im Panel werden nicht überschrieben.

Begründung: Die Server-Verbindung endet planmäßig spätestens alle 30 Minuten. Events aus der kurzen Lücke wären sonst still verloren, bis der Nutzer neu lädt. Der Abgleich ist eine einzelne lokale Anfrage je Liste. Er ersetzt kein Polling, weil er nur nach einem Verbindungswechsel läuft.

### 4. Veraltete Anfragen

Alle Ladevorgänge nutzen einen eigenen `AbortController` pro Store und Operation ([ADR-0006](0006-frontend-zustand-und-datenzugriff.md) §4). Das gilt auch für den Abgleich nach dem Neuverbinden: Ein zweites `PB_CONNECT` bricht einen noch laufenden Abgleich ab.

## Alternativen

- **Polling statt Realtime:** widerspricht CLAUDE.md §7. Verworfen.
- **Komplettes Neuladen bei jedem Event:** widerspricht CLAUDE.md §7 und würde bei Eingaben im Panel stören. Verworfen.
- **Kein Abgleich nach dem Neuverbinden:** einfacher, aber Änderungen aus einem zweiten Tab könnten bis zum nächsten Laden fehlen. Verworfen.
- **Token-Erneuerung nur beim App-Start (Stand E1):** Ein Tab, der länger als 5 Tage offen bleibt, verlöre die Sitzung still, und die Listen wären leer. Verworfen.
- **Token-Erneuerung in `pb.beforeSend`:** würde jede Anfrage verzögern und Erneuerung und Anfrage verschränken. Verworfen zugunsten des Keep-alive plus Gültigkeitsprüfung vor Anfragen.
- **Längere Token-Laufzeit per Migration:** mildert das Problem nur und vergrößert das Risiko bei späterem Mehrgerätebetrieb (ADR-0001). Verworfen.

## Konsequenzen

- Positiv: Lange offene Tabs bleiben angemeldet und bekommen weiter Events. Abgemeldete Tabs zeigen keine veralteten oder fremden Daten.
- Positiv: Das Verhalten ist mit Integrationstests gegen den Harness belegbar (Events nach `authRefresh`, keine Events nach `unsubscribe` und Abmelden, Filter auf ein Ticket).
- Negativ: Etwa alle 30 Minuten entsteht je offener Liste ein Abgleich. Lokal ist das vernachlässigbar.
- Negativ: `auth.logout()` bekommt eine Abhängigkeit auf `pb.realtime`. Die bestehenden Unit-Tests für `Auth` werden entsprechend erweitert.

## Nachtrag (2026-09-28, AR-2): Gescheiterte Abos werden erneut versucht

Der Text oben bleibt unverändert. Offener Punkt aus dem [E2-Plan](../plan/e2.md) §8 und der E6-Zeile von [ADR-0011](0011-roadmap-e3-bis-e7.md): Scheiterte ein Abo beim ersten Laden (Server kurz nicht erreichbar), blieb die Seite ohne Live-Aktualisierung, bis sie neu geladen wurde. Das SDK verbindet nur eine bestehende Verbindung selbst neu; scheitert der erste Aufbau, lehnt es das Abo ab.

- **Erneuter Versuch:** `hold` in `web/src/lib/stores/realtime.ts` bekommt statt des Versprechens eine Funktion, die das Abo startet. Scheitert es, versucht `hold` es nach 1, 2, 5 und 10 s und danach alle 30 s erneut, bis es steht oder der Besitzer es beendet. Steht es nach gescheiterten Versuchen, ruft `hold` `recovered` auf; die Stores gleichen dann ab wie nach dem Neuverbinden (§3), weil Ereignisse aus der Lücke fehlen.
- **Listener gescheiterter Versuche:** Das SDK (0.28.1) behält den Listener eines gescheiterten Abos und ruft ihn auf, sobald später eine Verbindung steht. `hold` gibt der Startfunktion deshalb einen `guard`, der nur die Rückrufe des aktuellen Versuchs und nach dem Beenden keine mehr durchlässt. Doppelte Ereignisse oder Ereignisse eines alten Tickets nach einem Panelwechsel kommen so nicht an.
- **Hinweis:** `LiveHealth` zählt die Abos, die gerade fehlen. Solange eines fehlt, zeigt das `(app)`-Layout über dem Inhalt `LiveUpdateNotice`: „Live-Aktualisierung unterbrochen – wird erneut versucht.“ mit „Neu laden“. Das ist eine `SectionMessage` im Ton `warning` (neutral, kein Rot nach [ADR-0009](0009-fehlerfarbe.md) und [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) §2) in einer immer vorhandenen Statusregion; der Fokus wandert nicht. Ein Flag nach [ADR-0025](0025-ui-konsistenz-overlay-system.md) §8 passt nicht, weil `info` nach 8 s verschwindet und der Hinweis bis zur Lösung bleiben muss.
- **Kein Polling:** Versucht wird nur das gescheiterte Abo; eine bestehende Verbindung behandelt weiter das SDK.
