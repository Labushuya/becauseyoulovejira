# ADR-0076: Offene Einrichtungen sichtbar

- **Status:** Angenommen und umgesetzt (Paket KE-1); Fälle im Test-Manifest BYL-E6-2320 bis BYL-E6-2334, manuelle Prüfungen BYL-E6-2333 und BYL-E6-2334
- **Datum:** 2026-11-01
- **Entscheidung durch:** Nutzer (Entscheidungen E1 bis E4 vom 2026-11-01, „Ja, so“, alles nach Empfehlung), Advisor (Auftrag KE-1 mit den Anforderungen M1 bis M6), Executor (Regel als eine reine Funktion, Fingerabdruck, Texte, Umsetzung, Tests)
- **Bezug:** [ADR-0026](0026-einstellungsbereich-und-hinweis-bausteine.md) §3 und §4 (Karten, Assistent), [ADR-0035](0035-start-einstieg-und-offene-tabs.md) (Hinweise beim Öffnen, Nachtrag WK-2), [ADR-0038](0038-eigener-eingang-und-whatsapp-web.md) (eigener Eingang, WhatsApp Web), [ADR-0049](0049-zielprojekt-je-eingangsweg.md) (Zielprojekt optional), [ADR-0050](0050-github-kanal-und-beobachtete-quellen.md) (Token optional), [ADR-0059](0059-bereiche-privat-und-haushalt.md) §5 (Verbindungen nur privat), [ADR-0072](0072-neustart-im-assistenten-und-rueckkehr-zum-schritt.md) §4 (`sessionStorage`), [ADR-0073](0073-smartphone-layout.md), [ADR-0074](0074-postausgang-fuer-aenderungen-ohne-verbindung.md) (Hinweise des Postausgangs), [ADR-0075](0075-zugangsdaten-im-browser.md) (Zugangsdaten am PC)

## Kontext

Eine begonnene Einrichtung war nur im offenen Assistenten als offen zu erkennen. Die Karte zeigte „Einrichtung offen“ nur bei einer fehlenden Variablen und sonst „Verbunden“, auch ohne ersten Abruf, ohne Repository oder Ordner, mit nicht freigegebenem Chat oder ungeprüftem Notion. Außerhalb der Seite „Kanäle“ war nichts zu sehen, und „Erste Schritte“ hakte „Einen Kanal einrichten“ ab, sobald irgendeine Verbindung existierte. Seit BW-3 kann eine Variable in der Benutzerumgebung von Windows schon gesetzt sein, während der laufende Server sie noch nicht sieht (`secret-status` liest die Umgebung des Prozesses); die Karte sagte dann „Zugangsdaten fehlen“.

## Entscheidung

### 1. Was als offen zählt (E1)

- **Offen ist jeder offene Pflichtschritt des Assistenten:** Zugangsdaten, die der Server nicht sieht, ein fehlendes Repository bzw. ein fehlender Ordner, ein nicht freigegebener Telegram-Chat, ein fehlender oder fehlgeschlagener erster Abruf bzw. die erste Prüfung, Notion ungeprüft oder ohne freigegebene Seite.
- **Nur begonnene Einrichtungen:** eine Verbindung existiert. Eigener Eingang und WhatsApp Web zählen erst mit einem Zugangsschlüssel: der eigene Eingang, solange kein Programm einen Schlüssel benutzt hat; WhatsApp Web, solange die Erweiterung nicht gebaut ist (mehr sieht die App nicht, ADR-0038 §4).
- **Nie offen:** das Zielprojekt (optional, ADR-0049), die Stichwörter (ihre Warnung bleibt ein Hinweis), eine pausierte Verbindung, GitHub ohne Token (ADR-0050 §1; die drei Schritte des Tokens sind mit der Verbindung optional), ein Hinweis des letzten Laufs von GitHub (etwa das Anfragelimit) und ein Fehler nach einem früheren erfolgreichen Lauf: Das bleibt „Fehler“.
- **Ein unbekannter Zustand der Variablen** (die Anfrage scheiterte) zählt als gesehen, wie die Karte ihn schon überspringt.
- **Eine Regel für alle (M2):** `requiredOpenStep` in `domain/channel-setup.ts` ist der erste offene Pflichtschritt. Darauf stützen sich der Assistent (`setupProgress` öffnet dort, `setupComplete` heißt „alle Pflichtschritte erledigt“), die Karten (`channelHealth`) und die Übersicht über `openSetupOf` in `domain/open-setups.ts`. `openSetupOf` fügt nur die Regeln der Anzeige hinzu (pausiert, Fehler nach Erfolg, unbekannter Zustand) und nennt Grund, Schritt und ob er den PC braucht. Folgen: Ohne Stichwörter öffnet der Assistent eines Kalenders beim „Ersten Abruf“ statt bei „Stichwörter“; der Schritt davor zeigt seine Warnung oben („Schritt 6 ist noch offen: …“). Ein Telegram-Bot ohne Stichwort gilt als eingerichtet. `checkHolds('restart')` liest die erlaubten IDs wie `secretStatusText` (nur ein gemeldetes Fehlen zählt).

### 2. Wo es sichtbar ist (E2)

- **Karte:** nie „Verbunden“, solange ein Pflichtschritt offen ist. Neuer Zustand `open` mit der Lozenge „Einrichtung offen“; der Hinweis nennt den Schritt mit der Prüfzeile des Assistenten („Offener Schritt „Erster Abruf“: Noch kein Abruf.“), der Hauptknopf bleibt der der Karte („Jetzt abrufen“, „Repository hinzufügen …“), im Menü heißt „Einrichtung ansehen“ dann „Einrichtung fortsetzen“. Zugangsdaten bleiben `unset` mit „Einrichtung fortsetzen“; ein Fehler eines nie gelungenen ersten Laufs bleibt „Fehler“ und nennt den Schritt vorn. Ein Postfach, dessen Hilfsprozess nicht läuft, bleibt „Neustart nötig“.
- **Übersicht auf „Kanäle“** (`components/channels/OpenSetupsOverview.svelte`): über den Karten eine `SectionMessage` „N Einrichtungen offen“ mit einer Liste, je Eintrag Name, „Schritt n von m: …“ und „Fortsetzen“ als Link im Knopfstil auf `channelSetupHref` (der Assistent öffnet beim offenen Schritt, `data-sveltekit-keepfocus`, `noscroll`, `replacestate` wie die Kacheln); der eigene Eingang hat „Zur Karte“ und setzt den Fokus auf seine Karte. Sie erscheint erst, wenn Liste, Zustand jeder Variablen und Schlüssel geladen sind, und nicht im Haushalt.
- **Marke an „Kanäle“** in `SettingsNav` und im Sheet „Mehr“: die Zahl sichtbar, „(N Einrichtungen offen)“ im Namen des Links. Quelle ist `OpenSetupsStore` des `(app)`-Layouts; die Seite „Kanäle“ übergibt ihm ihr Ergebnis (`adopt`), damit die Marke einer dort erledigten Einrichtung sofort folgt.
- **Ruhiger Hinweis beim Öffnen** (§3).

### 3. Hinweis einmal je Gerät und Stand

- Nach der Anmeldung und bei „erneut geöffnet“ (ADR-0035 §5) ein Info-Flag „N Einrichtungen sind offen.“ mit den Namen (höchstens drei, dann „und N weitere“) und „Ansehen“ (Seite „Kanäle“), nach dem Muster von `TrashAttention` (`stores/open-setups-attention.ts`).
- **Stand:** ein Fingerabdruck `‹Konto›|‹Schlüssel›:‹Art›,…` (sortiert; Schlüssel ist die ID der Verbindung bzw. `eigener-eingang`, `whatsapp-web`; Art der Grund, alle drei Gründe der Zugangsdaten als `secret`). PC und Handy wissen über die Zugangsdaten verschieden viel und kommen so zum selben Stand. Gespeichert in `localStorage` `byl-open-setups-seen`, nur IDs, keine Namen und keine Werte. Ein neuer Stand (eine weitere oder erledigte Einrichtung, ein anderer offener Schritt, ein anderes Konto) zeigt den Hinweis wieder.
- **Kein Hinweis** nach einem Fehler oder einer Ablehnung (auch 403), ohne Verbindung (`outbox.offline` oder `navigator.onLine`), ohne offene Einrichtung und ohne Konto. Er verdrängt nie ein anderes Flag: Stehen schon `MAX_FLAGS` (etwa Hinweise des Postausgangs, ADR-0074), wartet er auf den nächsten Anlass und merkt sich nichts.

### 4. „Wartet auf Neustart“ (M1)

- `SetupFacts.stored` (`StoredSecrets`): der Zustand der Variablen in der Benutzerumgebung, nur bekannt für den Verwalter am PC über den bestehenden `CredentialsStore` (`storedOf`, BW-3). Er ändert keine Offenheit, nur den Schritt und den Text: Gesetzt dort und vom Server nicht gesehen, ist nur „Neu starten“ offen; dort fehlend, ist der Schritt „Variable setzen“ bzw. „Token setzen“ offen.
- **Texte:** gesetzt „Wartet auf Neustart: ‹Name› ist gesetzt, die App sieht die Variable erst nach einem Neustart.“; fehlend der bisherige Text („Zugangsdaten fehlen: Variable … anlegen, …“); unbekannt am PC „Zugangsdaten fehlen oder warten auf Neustart: Die App sieht ‹Name› noch nicht.“, auf einem anderen Gerät „Zugangsdaten fehlen oder warten auf Neustart – am PC prüfen (‹Name›).“ Nie „fehlt“, wenn bekannt ist, dass der Wert gesetzt ist; nie „wartet“, wenn das unbekannt ist. GitHub mit gesetztem, noch nicht geladenem Token: „Wartet auf Neustart: Der Token ist gesetzt; …“ statt „Ohne Token“.
- `restart-notice` wird dafür nicht gefragt: Die Marke sagt nur, dass irgendeine Änderung wartet, nicht welche Variable.
- Im Assistenten hält das Setzen einer Variablen den Schritt fest (`credentials.busy`), damit die Frage „Jetzt neu starten“ / „Später“ nicht unter dem Zeiger springt.

### 5. Begonnen ohne Verbindung (E3)

Eine Einrichtung vor ihrer Verbindung (Eintrag `byl-setup:neu:<art>` des Tabs, ADR-0072 §4) zeigt an ihrer Kachel des Katalogs „Begonnen“ und „Fortsetzen“ (dieselbe Adresse; der Assistent öffnet beim gemerkten Schritt). Nur im selben Tab und bis zwei Stunden; kein neues Speichermodell, kein `localStorage`. Gelesen beim Öffnen der Seite und nach jedem Schließen eines Assistenten (`begunSetups` in `domain/setup-resume.ts`); dabei gehen nur verfallene und beschädigte Einträge, wie beim Öffnen eines Assistenten. Übersicht, Marke und Hinweis zählen solche Einrichtungen nicht.

### 6. „Erste Schritte“ (E4)

„Einen Kanal einrichten“ gilt erst als erledigt, wenn eine Einrichtung abgeschlossen ist: eine Verbindung mit allen Pflichtschritten (`setupComplete`, auch pausiert) oder ein Schlüssel des eigenen Eingangs, den ein Programm benutzt hat (`anySetupDone`). Markiert von `ChannelsView` statt von der Seite.

### 7. Daten und Anlässe (M4)

- Nur Oberfläche: keine Hooks, keine Migration, keine neue Route, kein PowerShell. Nach dem Build F5.
- `OpenSetupsStore` lädt Liste, `secret-status` je Verbindung mit Variable, die Schlüssel des eigenen Eingangs und, nur mit Schlüssel, ob die Erweiterung gebaut ist. Anlässe: Anmeldung und „erneut geöffnet“ (mit Hinweis), Rückkehr in den Tab (nur Marke, höchstens einmal je Minute), Wechsel des Bereichs. Kein Takt, kein Polling.
- Nur die eigenen Verbindungen des Kontos (die Liste folgt dem Bereich; im Haushalt keine, ADR-0059 §5). `credential-service.referenced` (alle Besitzer) wird nicht genutzt. Nie ein Wert, höchstens Namen von Variablen.

### 8. Am Handy (M3)

- Die Übersicht ist eine Spalte Text, die umbricht; „Fortsetzen“ steht daneben oder darunter, ohne waagerechtes Scrollen bei 360 px. Die Links tragen `.button-secondary`, im Rahmen damit 44 px (MO-1b); keine eigene Regel für den Rahmen.
- Braucht der offene Schritt den PC (Variable, Token, Neustart, Chat, Erweiterung), sagt die Zeile auf einem anderen Gerät des Verwalters „– am PC fortsetzen“; „Fortsetzen“ öffnet trotzdem den Assistenten, der dort „Nur am PC möglich“ zeigt.

### 9. Eigener Eingang und WhatsApp Web vor dem ersten Schlüssel

Weil „Einrichtung offen“ jetzt „begonnen und nicht fertig“ heißt, zeigen beide Karten vor dem ersten Schlüssel „Nicht eingerichtet“ (`CARD_STATUS.notSetUp`), wie die Kacheln des Katalogs; mit Schlüssel wie bisher „Einrichtung offen“ bzw. „Verbunden“ (eigener Eingang) oder keine Lozenge (WhatsApp Web mit gebauter Erweiterung).

## Alternativen

- **Eine Sammelroute auf dem Server** für alle offenen Einrichtungen: weniger Anfragen, aber eine neue Route und ein Neustart. Verworfen für KE-1; mit BW-2/FP-2 neu bewerten.
- **Den gemerkten Schritt des Assistenten als Maß:** gälte nur im Tab und wüsste nichts vom Server. Verworfen; der Schritt kommt aus den Fakten.
- **Stichwörter als Pflichtschritt:** widerspräche E1; die Warnung bleibt ein Hinweis.
- **`restart-notice` als Beleg für „Wartet auf Neustart“ am Handy:** die Marke nennt keine Variable. Verworfen; am Handy bleibt der Zustand unbekannt.
- **Der Hinweis bei jedem Öffnen** oder nur einmal je Gerät überhaupt: lästig bzw. blind für neue Einrichtungen. Verworfen zugunsten „einmal je Stand“.
- **Begonnene Einrichtungen ohne Verbindung in `localStorage`:** auch für andere Tabs und später; vom Nutzer nicht gewünscht (E3, ADR-0072).

## Konsequenzen

- Mehr Karten zeigen „Einrichtung offen“, bis der erste Lauf da ist; das ist gewollt.
- Der Assistent eines Kalenders ohne Stichwörter öffnet beim ersten Abruf (§1).
- Je Anmeldung und „erneut geöffnet“ einige Anfragen mehr (Liste, je Verbindung mit Variable eine, Schlüssel, gegebenenfalls die Erweiterung).

## Grenzen

- Am Handy und auf anderen Geräten ist der Zustand in der Benutzerumgebung nie bekannt; der Text sagt beides.
- WhatsApp Web mit gebauter Erweiterung zählt nie als offen, auch wenn die Erweiterung nie geladen wurde (die App sieht sie nicht).
- Eine Einrichtung ohne Verbindung sieht nur der Tab, der sie begonnen hat.
- Ein Hinweis, den ein volles Flag-Fach aufhält, kommt erst beim nächsten Anlass.
- Ein anderer Tab desselben Geräts merkt den Stand über `localStorage` mit; zwei Konten auf einem Gerät haben getrennte Stände, aber nur einen gemerkten (der letzte gewinnt).
