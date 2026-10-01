# E6-Plan, Teil „Speicher und Abhängigkeiten beim Löschen“

- **Stand:** SPE-1 (Papierkorb: erst entscheiden, dann löschen) umgesetzt; SPE-2 (Seite „Einstellungen → Speicher“) geplant.
- **Grundlage:**
  - Nutzerwunsch (2026-10-01): „Dass man in den Einstellungen den belegten Speicher der App einsehen und ganzheitlich verwalten kann bis hin zur Warnung zu Verknüpfungen, wenn gespeicherte Daten und Einträge gelöscht werden sollen, für Tickets, die noch nicht abgeschlossen sind (oder Untertickets). Geht das ohne Over Engineering?“
  - Nutzerentscheidung zum Papierkorb: „Verweigern von Löschung, erst Abhängigkeiten auflösen (mit Entscheidungs-Auswahlhilfe aller verknüpften Quellen oder alternative Lösung, wenn Verstoß gegen unsere Regeln).“
  - [ADR-0047](../adr/0047-speicher-und-abhaengigkeiten-beim-loeschen.md) (neu), [ADR-0037](../adr/0037-papierkorb.md) (Nachtrag), [ADR-0031](../adr/0031-herkunft-sichern.md), [ADR-0033](../adr/0033-unteraufgaben.md), [ADR-0035](../adr/0035-start-einstieg-und-offene-tabs.md), [ADR-0043](../adr/0043-system-seite.md), [ADR-0046](../adr/0046-sicherung-pruefung-wiederherstellen.md), [Plan Papierkorb](papierkorb.md), [Plan Sicherung](sicherung.md)
- **Einordnung:** Paketkürzel `SPE` (im Auftrag „SP-1“ und „SP-2“; `SP` tragen schon die Pakete von [Spalten](e6-spalten.md)), Manifest ab `BYL-E6-1000` (bis `BYL-E6-1099`), keine Migration.

## 1. Pakete

| Paket | Inhalt | Manifest |
|---|---|---|
| SPE-1 | Regel der Abhängigkeiten (rein, mit Spiegel), Durchsetzen in allen Wegen zum endgültigen Löschen (Route, Leeren, Cron, Verwaltung), Entscheidungshilfe mit Route `resolve` und `detach_parent`, Spalte „Status“ mit „Blockiert (N)“, Filter, Aufbewahrung, Hinweis beim Öffnen, Tests, Nachtrag ADR-0037 | BYL-E6-1000 bis BYL-E6-1008 |
| SPE-2 | Route `GET /api/byl/storage`, Seite „Einstellungen → Speicher“ mit Kategorien, „Größte Einträge“, Aktionen mit Vorschau und derselben Regel, Hilfe „Speicher“, Tests | ab BYL-E6-1010 |

## 2. SPE-1: Papierkorb – erst entscheiden, dann löschen

**Regel** (`app/pb_hooks/lib/trash-dependencies.js`, Spiegel `web/src/lib/domain/trash-dependencies.ts`, Paritätstest `tests/unit/web-trash.test.mjs`): blockiert, solange (a) das Ticket nicht erledigt ist, (b) eine Unteraufgabe der Gruppe nicht erledigt ist oder (c) eine Quelle an einem Ticket der Gruppe hängt. (c) betrifft genau die mit dem Ticket verworfenen Quellen (ADR-0037 §6); zurückgegebene, verworfene und Tombstones zählen nicht.

**Durchsetzen:** `purgeGroup` liest die Abhängigkeiten in der Transaktion des Löschens. „Endgültig löschen“ und die Verwaltung (Superuser) antworten 400 `validation_trash_blocked` mit der Liste, „Papierkorb leeren“ lässt blockierte liegen (`{ purged, blocked }`), der Cron überspringt und zählt sie (Log „… blockiert – Entscheidung nötig“).

**Entscheidungshilfe** (Vorschau, inline): je Abhängigkeit nur die erlaubten Wege (ADR-0047 §3), Sammelwege mit Vorschau. Server `POST /api/byl/trash/{id}/resolve` (eine Transaktion, rein vorgeprüft) und `POST …/{id}/restore` mit `detach_parent`.

**Tabelle:** Spalte „Status“ mit „Blockiert (N)“, „nicht, solange blockiert“, „Abhängigkeiten auflösen“ im Menü, Schalter „Nur blockierte (N)“, Fragen vor dem Leeren und vor dem Löschen der gewählten Zeilen nennen, was bleibt. Hinweis beim Öffnen (`TrashAttention`), wenn abgelaufene Tickets warten.

## 3. SPE-2: Seite „Einstellungen → Speicher“ (geplant)

- **Route `GET /api/byl/storage`:** Zugriff wie ADR-0043 (angemeldet, nur der Besitzer, nur dieser Rechner, Host und `Origin` der App, Rate-Limit; Aktionen mit Audit), rechnet beim Aufruf, ohne Hintergrundjob und ohne neue Tabelle.
  - **Datenbank:** `data.db` gesamt und freie Seiten (`PRAGMA page_count`, `page_size`, `freelist_count`), grob nach Gruppen (Tickets, Verlauf, Eingang, Papierkorb) über `dbstat`, wenn die Laufzeit es kennt (sonst nur gesamt); `auxiliary.db` (Logs, 5 Tage).
  - **Dateien des Eingangs** (einziges Dateifeld `inbox_items.original`, über `$app.newFilesystem().list`): neu, an offenem Ticket, an erledigtem Ticket, verworfen (mit Datum der Leerung), im Papierkorb, Kopien aus „Duplizieren“.
  - **Sicherungen:** lokal (ADR-0046, Generationen) und im Ziel (Anzahl, Summe, älteste, neueste), alte `@auto_pb_backup_*`, Sicherheitskopien `pb_data.vor-wiederherstellung-*`.
  - **Logs** (`app/logs`) und **Programm** (Programmdateien, `*.old-*`, Web-Builds), **freier Platz** aus `doctor`.
- **„Größte Einträge“:** die 20 größten Dateien mit Link und Zugehörigkeit („gehört zu HAUS-12 (offen)“, „Kopie aus …“).
- **Aktionen** mit Vorschau („betrifft N, X MB“) und derselben Regel wie SPE-1: „Datenbank verdichten“ (`vacuum`, `auxVacuum`, mit Hinweis auf die kurze Sperre), „Liegengebliebenes aufräumen“ (Programmreste, abgelaufene Sicherheitskopien, alte `@auto_pb_backup_*` nach Bestätigung), optional „Verworfene jetzt leeren“; Links zu Papierkorb und Sicherung. Kein Löschen einzelner Originaldateien an verknüpften Quellen (unveränderlich).
- **Bewusst nicht:** Dateibrowser, Kontingente, Diagramme, Zählen im Hintergrund.
- **Plattform:** voll nur unter Windows; unter Linux und im Container mit Hinweis, wo Programm- oder `doctor`-Teile fehlen.

## 4. Entscheidungen

| Datum | Paket | Entscheidung |
|---|---|---|
| 2026-10-01 | SPE-1 | **(c) zählt:** Nach ADR-0037 §6 bleiben mit „Quellen verwerfen“ gelöschte Tickets mit ihren Quellen verbunden (`converted`, verborgen). Diese Quellen blockieren; ein Eintrag, der beim Löschen zurück in den Eingang ging, hängt an nichts. Auch Quellen der Unteraufgaben einer Gruppe zählen, weil die Gruppe gemeinsam geht. |
| 2026-10-01 | SPE-1 | **Alle Wege, auch die Verwaltung:** Neben den drei genannten Wegen löscht auch ein Superuser im Admin-UI ein blockiertes Ticket nicht; sonst gäbe es einen stillen Weg vorbei an der Regel. Der Rückweg der Migration bleibt (Semantik vor dem Papierkorb). |
| 2026-10-01 | SPE-1 | **„Papierkorb leeren“ teilweise:** Freie Gruppen gehen, blockierte bleiben und werden genannt, statt das Leeren ganz zu verweigern. Die Frage davor sagt, was bleibt. |
| 2026-10-01 | SPE-1 | **Verwerfen = gewöhnlich verworfen:** Die Hilfe macht eine Quelle zu einem normalen verworfenen Eintrag (zurückholbar, Leeren nach 30 Tagen) statt sie sofort zu leeren; damit entfällt das Leeren beim endgültigen Löschen (`PURGE_KEY`), das keine gebundene Quelle mehr erreichen kann (kein toter Code). |
| 2026-10-01 | SPE-1 | **Erledigen im Papierkorb** schreibt Status, `completed_at` und Verlauf selbst, weil die Ticket-Hooks Tickets im Papierkorb überspringen; die Regel von ADR-0033 §2 gilt über `completionDecision` (ohne `force`, das ließe die Gruppe blockiert). |
| 2026-10-01 | SPE-1 | **Umhängen über die Route des Papierkorbs:** Die Regeln verbergen Quellen eines Tickets im Papierkorb, die Record-API kann sie nicht ändern. Die Route speichert den Eintrag mit dem neuen Ticket; der Hook des Eingangs prüft wie bei HK-5 und schreibt den Verlauf beider Tickets. `MoveSourceDialog` nimmt dafür jeden Store mit `move` (generisch). |
| 2026-10-01 | SPE-1 | **Hilfe in der Vorschau, nicht in der Zeile:** Eine Gruppe kann viele Abhängigkeiten haben; die Zeile zeigt „Blockiert (N)“ und führt in die Vorschau. Der Dialog „Anderem Ticket zuordnen“ öffnet aus dem Seitenpanel wie in den Quellen eines Tickets (kein Dialog aus einem Dialog). |
| 2026-10-01 | SPE-1 | **Hinweis beim Öffnen** nur für abgelaufene blockierte Tickets (der Cron hätte sie gelöscht), über dieselbe Stelle wie der Hinweis der Sicherung; keine eigene Route, die Liste des Papierkorbs genügt. |

## 5. Status

| Paket | Stand |
|---|---|
| SPE-1 | umgesetzt (Neustart nötig, keine Migration) |
| SPE-2 | geplant |

## 6. Offene Punkte

- Manuelle Prüfung SPE-1 (BYL-E6-1007, BYL-E6-1008).
