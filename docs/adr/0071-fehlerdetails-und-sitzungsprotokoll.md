# ADR-0071: Fehlerdetails und Sitzungsprotokoll

- **Status:** Angenommen und umgesetzt (Paket FP-1); Fälle im Test-Manifest BYL-E6-1854 bis BYL-E6-1874, manuelle Prüfungen BYL-E6-1871 bis BYL-E6-1874
- **Datum:** 2026-10-19
- **Entscheidung durch:** Nutzer (Wunsch: „In den Kanälen und auch sonst, wo Fehler ausgegeben werden, eine Möglichkeit bieten, diese irgendwo einzusehen, und was die Absicht war, die nicht geklappt hat.“), Advisor (Auftrag FP-1 mit Akzeptanzkriterien, Aufteilung in FP-1 Client, FP-2 Server, FP-3 Seite „Protokoll“), Executor (Bestandsaufnahme, Katalog, Speicher, Bausteine, Tests)
- **Bezug:** [ADR-0006](0006-frontend-zustand-und-datenzugriff.md) §4 (Fehlerarten der Datenschicht, `DataError`), [ADR-0025](0025-ui-konsistenz-overlay-system.md) (Flags, Modal; Nachtrag 16 „Kein Dialog aus einem Dialog“, Nachtrag 18 Flags vor Dialogen), [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) (SectionMessage), [ADR-0060](0060-einheitliche-eingabeelemente.md) (`Field`), [ADR-0040](0040-veroeffentlichen-ohne-unterbrechung.md) (`handleError` der Client-Hooks), [ADR-0048](0048-fehlerkatalog-der-skripte.md) (Fehler der Skripte, nicht Teil dieses Pakets)

## Kontext

Eine fehlgeschlagene Aktion zeigt bisher einen Satz („Der Server hat mit einem Fehler geantwortet.“, „Server nicht erreichbar.“), oft in einem Flag, das wieder verschwindet. Was die App versucht hat, welche Anfrage es war und was der Server geantwortet hat, sieht niemand; nach dem Schließen ist auch der Satz weg. FP-1 gibt jeder solchen Meldung „Details“ und sammelt die Fehler des Tabs in einer Liste. Nur der Client ändert sich; der Server bleibt unverändert (FP-2 baut ein Protokoll auf dem Server, FP-3 eine Seite „Einstellungen → Protokoll“ für beides).

### Bestandsaufnahme

- **Zentraler Fehlerweg:** Jede Anfrage geht über die eine Instanz `pb` (`lib/pocketbase.ts`) und deren `send`; die Datenschicht wandelt jeden Fehler mit `toDataError` (`lib/data/errors.ts`) in einen `DataError` mit Art, Status, Feldern und Ursache (`cause` ist der `ClientResponseError` des SDK). Der `ClientResponseError` des SDK 0.28 kennt `url`, `status`, `response` und `isAbort`, aber nicht die Methode; bei einem Netzwerkfehler ist `url` leer und `status` 0.
- **Anzeige:** Die Stores geben eine Meldung als Text an vier Bausteine: `SectionMessage` (Ton `error`), die Fehlerzeile von `Field`, den Fehler im `ConfirmDialog` und Flags (`FlagStore.show`, `FlagGroup`). Daneben gibt es eigene Texte in einzelnen Komponenten, vor allem Rückrufe der Kanal-Karten, die nur einen Text zurückgeben (`Promise<string | null>`).
- **Absicht:** Kein Fehler wusste bisher, welche Aktion ihn ausgelöst hat. Die Routen der Hooks liegen statisch in `app/pb_hooks/*.pb.js` (103 Aufrufe von `routerAdd`, alle unter `/api/byl/`), die Record-API erreicht die SPA für 16 Collections.
- **Unerwartete Fehler:** `hooks.client.ts` übersetzt Fehler einer Navigation (`handleError`), aber Fehler außerhalb davon (`error`, `unhandledrejection` des Fensters) gingen verloren.

## Entscheidung

### 1. Echte Fehler und Hinweise an einer Eingabe

„Details“ gibt es nur für einen **echten Fehler einer Aktion**: keine Verbindung, eine Antwort mit Fehlerstatus, eine Ablehnung einer Regel der App (etwa „Das Projekt ist archiviert.“, ein Konflikt, eine Ablehnung eines Hooks), eine Antwort, die die App nicht lesen konnte, eine Ausnahme im Browser oder ein Ergebnis, in dem der Server selbst einen Fehlschlag meldet (§3, Kanäle).

Keine Details bekommen:

- **Prüfungen einer Eingabe:** eine Ablehnung, deren Feldcodes alle in `INPUT_VALIDATION_CODES` stehen (`domain/problems.ts`): die Codes der Record-API von PocketBase (Pflichtfeld, Länge, Format, Wert, Datum, Adresse, Eindeutigkeit) und die Formprüfungen der Hooks (Name einer Variablen, Stichwörter, reservierter Code `TASK`, Name einer Verbindung, eines Kontos und eines Schlüssels des eigenen Eingangs, Titel oder Beschreibung leer oder zu lang). Ist auch nur ein anderer Code dabei, ist es ein echter Fehler; auch eine Obergrenze einer Liste (etwa „höchstens 20 Unteraufgaben“) ist eine Regel der App.
- **Prüfungen der App vor dem Senden** („Titel fehlt“, „Der Titel darf nicht leer sein.“): Sie haben keinen Fehler und damit keinen Eintrag.
- **Abgebrochene Anfragen** (`aborted`, `isAbort`) und Texte der App ohne Fehler (etwa „Schon im Eingang.“).

Eine Ablehnung ohne Status (ein `DataError` der Datenschicht mit Feldern, aber ohne Antwort) heißt im Ergebnis „Vom Server abgelehnt“.

### 2. Datenschutz

Ein Eintrag enthält nur: die Absicht, den Zeitpunkt, das Ergebnis (HTTP-Status, Code des Servers, Meldung des Servers), **Methode und Pfad** der Anfrage, den Build der App und nur bei einer unerwarteten Ausnahme Name, Meldung und höchstens zehn Zeilen des Stacks.

- **Nie** darin: ein Body, eine Query, ein Token, ein Header oder der Inhalt eines Feldes. IDs und Keys im Pfad sind erlaubt (`/api/byl/tickets/abc123/duplicate`).
- `noteRequest` (aufgerufen aus `send` von `AppPocketBase` für jeden Fehler) merkt sich nur Methode und Pfad; `requestPathOf` schneidet Herkunft, Query und Hash ab.
- Jeder Text von außen (Meldung des Servers, Meldung und Stack einer Ausnahme, Code) geht durch `sanitizeProblemText`: JWTs, `Bearer`/`Basic`-Werte und `token=`, `key=`, `password=`, `secret=`, `auth=`, `code=` und Ähnliches werden zu „[entfernt]“, jede Query hinter einem Pfad oder einer URL fällt weg (Zeile und Spalte eines Stacks bleiben), höchstens 300 Zeichen. Teile in doppelten Anführungszeichen einer Ausnahme (oft Inhalte) werden zu „"…"“.
- Die Liste liegt nur im `sessionStorage` des Tabs (§4), nie im `localStorage`, nie auf dem Server. „Kopieren“ legt den Bericht nur in die Zwischenablage; senden muss ihn die Person selbst.

### 3. Absicht und Katalog

Jeder Eintrag nennt seine **Absicht** in den Worten der Person („Kanal jetzt abrufen“, „Ticket duplizieren“):

1. **Ausdrücklich:** Eine Aktion kann sie selbst nennen (`withIntent(intent, run)` in `data/errors.ts`); bei verschachtelten Aufrufen gewinnt die äußere, sie ist am nächsten an dem, was die Person getan hat. Das gilt dort, wo eine Route mehrere Aktionen trägt oder eine Aktion mehrere Anfragen braucht (Zeilenmenü der Tabelle, Kanäle, Übertragen auf Unteraufgaben).
2. **Katalog:** Sonst sucht `intentOf(method, path)` im Katalog `INTENT_CATALOG` (`domain/problem-intents.ts`, rein): jede Route unter `/api/byl/` mit `*` für genau ein Segment (`{id}`), die Record-API je Collection (Liste, Datensatz, Anlegen, Ändern, Löschen) und die Routen von PocketBase, die die SPA nutzt (Anmelden, „Sitzung prüfen“, Realtime, Health, Datei-Token). Das genauere Muster (weniger `*`) gewinnt; so heißt `POST /api/byl/system/restart` „App neu starten“ statt „Aktion der Seite System ausführen“.
3. **Rückfall:** „Unbekannte Aktion“.

Der Konsistenztest `tests/unit/web-problem-intents.test.mjs` liest die Routen statisch aus `app/pb_hooks` (wie die Paritätstests) und prüft: jede Route unter `/api/byl/` hat einen Eintrag, jeder Eintrag eine Route (einzelne Aktionen einer Route nur aus deren Allowlist, etwa die Aktionen der Seiten „System“ und „Speicher“), und jede Collection, die die SPA erreicht, hat ihre Einträge, alle aus dem Schema der Migrationen. Stand: 103 Routen, 110 Einträge mit den sieben einzelnen Aktionen, 16 Collections.

### 4. Sitzungsprotokoll: Speicher und Grenzen

`ProblemLog` (`stores/problem-log.svelte.ts`) ist die eine Liste des Tabs.

- **Was hineinkommt:** jeder Eintrag einer angezeigten Meldung mit „Details“ (`ProblemDetails` nimmt ihn beim Anzeigen auf, einmal je ID, auch wenn die Meldung neu gerendert wird) und jeder Fehler, den niemand gefangen hat (`error` und `unhandledrejection` des Fensters als „Unerwarteter Fehler“, ab dem Start über `init` in `hooks.client.ts`, auch auf der Anmeldung). Rauschen bleibt draußen: die Warnung einer ResizeObserver-Schleife, „Script error.“ fremder Skripte ohne Details, Fehler von Browser-Erweiterungen.
- **Speicher:** nur `sessionStorage` unter `byl-session-errors`. Neuladen behält die Liste, das Schließen des Tabs löscht sie, kein anderer Tab sieht sie. Ein gesperrter oder voller Speicher bricht nichts; die Liste gilt dann für die Seite. Fremde oder kaputte Inhalte werden beim Lesen verworfen.
- **Grenzen:** höchstens 100 Einträge (Ring, die ältesten fallen weg). Derselbe Fehler (gleiche Absicht, Ergebnis, Status, Code, Anfrage, Ausnahme) innerhalb von zehn Sekunden nach dem letzten zählt auf seinem Eintrag („3× bis 14:03:20“) und rückt nach oben, damit eine Schleife die Liste nicht flutet.
- **Dialog „Fehler dieser Sitzung“** (`SessionProblemsDialog`, einmal im Root-Layout, Modal M): neueste zuerst, je Eintrag Absicht, Häufigkeit, Zeitpunkt und kurzes Ergebnis, aufklappbare Details mit „Kopieren“; „Alle kopieren“, „Liste leeren“ (danach „Liste geleert.“ und Fokus auf den Leerzustand), Leerzustand „In dieser Sitzung ist kein Fehler aufgetreten.“, „Schließen“.

### 5. „Details“ an der Meldung und dauerhafter Einstieg

- **Bausteine:** `SectionMessage` (nur Ton `error`), `Field`, `ConfirmDialog` und Flags (nur Ton `error`) haben eine Prop bzw. ein Feld `problem`; ohne Eintrag zeigen sie nichts Neues. Die Stores geben den Eintrag mit `problemOf(failure)` bzw. `...problemDetails(failure)` weiter, so behält ein Ergebnis ohne Eintrag seine bisherige Form.
- **Zeile „Details“** (`ProblemDetails`): eingeklappt unter der Meldung, ein Knopf mit `aria-expanded` und `aria-controls`, für Screenreader mit der Absicht („Details: Ticket duplizieren“). Aufgeklappt: Absicht, Zeitpunkt (Berlin), Ergebnis, Fehlercode, Servermeldung, Anfrage (Methode und Pfad), App-Stand („Build …“), Häufigkeit, bei einer Ausnahme „Technische Details“ zum Aufklappen; „Kopieren“ (Bericht als Klartext, die Zeit auch in UTC, ab FP-2 mit Server-ID; Rückmeldung „Kopiert.“, verweigert der Browser die Zwischenablage, steht der Bericht markiert zum Kopieren da) und „Alle Fehler dieser Sitzung (n)“. Ab 340 px benutzbar, lange Pfade brechen um.
- **Kein Dialog aus einem Dialog** (ADR-0025 Nachtrag 16): Außerhalb eines Modals öffnet „Alle Fehler dieser Sitzung (n)“ den Dialog des Root-Layouts; in einem Modal (auch ein Flag vor einem Modal) klappt die Liste an Ort und Stelle als `InlineDialog` auf.
- **Dauerhafter Einstieg:** Abschnitt „Fehler dieser Sitzung“ auf der Seite „Einstellungen → Hilfe“ (`#fehler`, für jedes Konto, auch ohne Verwalterrecht), zwei Sätze und „Fehler dieser Sitzung anzeigen (n)“. Klein und an einer Stelle (`SessionProblemsEntry`), weil FP-3 ihn nach „Einstellungen → Protokoll“ verlegt.

### 6. Inventur der Meldungen

**Mit „Details“:** Ticket (Felder, Titel, Beschreibung mit Aufgaben, Pins, Kommentare, Verlauf, Quellen lösen und verschieben, Löschen in Panel und Vollansicht, Duplizieren, Folge-Ticket, Verschieben in einen anderen Bereich, Übertragen auf Unteraufgaben, Zeilenmenü der Tabelle); Laden und Aktionen der Ansichten Aufgaben, Kalender, Projekte (Panel, Ansicht, Zeilenmenü), Wiederholungen (Dialog, Panel, Ansicht), Papierkorb, Eingang (Tabelle, Panel), Erledigte, Tagesplan; „Neues Ticket“, Erfassen und Schnellerfassung; Kanäle (Karten mit „Jetzt abrufen“, Pausieren, Prüfen, Entfernen, Bearbeiten, Assistent mit Verbinden, erstem Lauf und Antworten, „Alle Kanäle jetzt abrufen“, Prüfung von Notion). Ein Lauf, den der Server mit 200 und `status: 'error'` beantwortet, bekommt einen Eintrag „Vom Server gemeldeter Fehler“ mit dem bereinigten Fehler des Laufs (`reportedProblem`).

**Noch ohne „Details“** (die Fehler stehen dort wie bisher als Text; Folgepakete oder FP-3):

- Rückrufe, die nur einen Text zurückgeben: Umbenennen und Zielprojekt einer Verbindung, Dialoge von GitHub und Ordnern, `KeywordEditor`, `ImportKeywordsSection`, `ChannelKeywordsModal`, `MailboxPicker`, `NotionImportDialog`, `FolderExistingDialog`, `OwnInboxCard` und `InboxKeyCreateForm`. Die Schnittstelle müsste dafür einen Eintrag statt eines Textes tragen; das ändert viele Komponenten und ihre Tests und lohnt sich zusammen mit FP-3.
- Sammelergebnisse mit einer Liste je Zeile (Importe aus Datei, Zwischenablage und WhatsApp, Teilfehler der Sammelbearbeitung): Sie zeigen je Zeile einen Grund, keine einzelne Meldung.
- `AddSourcesDialog`, `LinkTicketDialog`, `RecurrenceSummary`, `TemplateSubtaskList`, Tags (`TagManager`, Seite „Tags“), `papierkorb/[id]`, das Angebot einer Serie nach einer Änderung und der Serien-Teil von „Übertragen …“.
- Anmeldung: Ihre Meldung ist absichtlich neutral (keine Auskunft, ob es ein Konto gibt); unerwartete Fehler der Seite kommen trotzdem in die Liste.
- Verwaltungsseiten (Konten, Haushalt, Sicherheit, System, Sicherung, Speicher): eigene Formen der Meldung, der nächste Schritt ist die Seite „Protokoll“ (FP-3).
- Der Hinweis einer Kanal-Karte auf den letzten Lauf im Hintergrund (`lastError`): kein Fehler dieses Tabs, sondern ein Wert vom Server (FP-2).

Neue Aktionen geben ihre Absicht mit und reichen den Eintrag an ihre Meldung (Regel in CLAUDE.md §12).

### 7. Andockpunkte für FP-2 und FP-3

- **Ein Typ für beide Quellen:** `ProblemEntry` (`domain/problems.ts`) hat `source` (`'client'` für FP-1, `'server'` für das Protokoll des Servers aus FP-2), `serverId` (ID eines Eintrags auf dem Server) und `correlation` (eine gemeinsame Kennung von Anfrage und Eintrag auf dem Server). In FP-1 sind beide `null`; der Bericht nennt die Server-ID, sobald es sie gibt.
- **FP-2** kann eine Kennung je Anfrage einführen (etwa einen Header der Antwort); `noteRequest` und `buildProblem` sind die Stellen, die sie übernehmen.
- **FP-3** zeigt auf „Einstellungen → Protokoll“ die Einträge dieses Tabs (`problemLog.entries`) neben denen des Servers mit denselben Bausteinen (`ProblemFacts`, `CopyReportButton`, `SessionProblemList`) und verlegt den Einstieg aus §5 dorthin.

## Alternativen

- **Meldung und Eintrag über den Text verbinden** (ein Store merkt sich den letzten Fehler je Text): unzuverlässig, etwa wenn offline mehrere Hintergrundanfragen mit demselben Text scheitern. Verworfen; der Eintrag wird ausdrücklich mitgegeben.
- **Eintrag am `DataError` oder am Fehler des SDK speichern:** ändert die Form der Fehler, die die Root-Tests ohne den Client der App laden. Verworfen; Anfrage, Absicht und Eintrag liegen in `WeakMap`s neben den Fehlern.
- **Liste im `localStorage` oder auf dem Server:** länger sichtbar, aber gegen das Ziel „verlässt den Browser nicht“ und für andere Tabs und Konten desselben Browsers lesbar. Verworfen für FP-1; das Protokoll des Servers ist FP-2 mit eigener Entscheidung.
- **Jede Anfrage protokollieren:** würde auch Erfolge und Inhalte sammeln. Verworfen; nur Fehler, nur Methode und Pfad.
- **Body und Query zur Fehlersuche aufnehmen:** hilfreich, aber sie tragen Inhalte und Tokens. Verworfen (§2).

## Konsequenzen

- Nur die SPA ändert sich, keine Hooks und keine Migration: Nach dem Build genügt F5, kein Neustart.
- Eine neue Route unter `/api/byl/` ohne Eintrag im Katalog lässt den Konsistenztest scheitern; eine neue Collection der SPA ebenso.
- Die Liste endet mit dem Tab. Wer einen Fehler melden will, kopiert den Bericht vorher.
