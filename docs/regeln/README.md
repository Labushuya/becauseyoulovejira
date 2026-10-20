# Projektregeln: Detaildokumente

**Wann lesen:** Wenn ein Verweis auf einen früheren Abschnitt, Eintrag oder eine Zeile der CLAUDE.md aufgelöst werden muss oder ein neues Detaildokument dazukommt.

Die Projektregeln bestehen aus dem Kern [CLAUDE.md](../../CLAUDE.md) und den Detaildokumenten in diesem Ordner. Der Kern enthält, was jede Arbeit im Repo wissen muss, und den Index mit dem Satz „Wann lesen“ je Dokument; die Detaildokumente enthalten die Fachregeln eines Themas und gelten genauso verbindlich. Aufgeteilt wurde die bis dahin rund 345 000 Zeichen lange CLAUDE.md mit DOC-1: Jeder Eintrag steht wortgleich an genau einer Stelle, umgerechnet wurden nur Pfade von Links und Verweise auf Abschnittsnummern, die sich durch das Verschieben änderten. Neue Detaildokumente bekommen eine Zeile im Index des Kerns und in der Übersicht unten (`tests/unit/claude-md-structure.test.mjs` prüft das).

## Übersicht

Geschnitten ist nach Themen, so wie Arbeitspakete entstehen: Was zu einem Thema in den alten Abschnitten §5 (Datenmodell, API-Regeln), §6, §7 (Frontend & UX), §8 und §9 verteilt war, steht jetzt in einem Dokument, darin in der alten Reihenfolge der Schichten (Datenmodell, API-Regeln, Oberfläche, Betrieb).

| Dokument | Inhalt |
|---|---|
| [datenmodell.md](datenmodell.md) | Collections und Felder, Status und Priorität, Fälligkeit, Historie, Scopes und Nummernkreise, Bereiche in der Datenschicht, allgemeine API-Regeln |
| [sicherheit.md](sicherheit.md) | Sicherheitsregeln für Routen, Postausgang, Mail-Flows |
| [tickets.md](tickets.md) | Angepinnter Kommentar und Kommentare, Duplizieren, Unterprojekte, Farben, Charms, angeheftete Tickets, „Neu“, vollständiges Anlegen |
| [unteraufgaben.md](unteraufgaben.md) | Parent und Unteraufgaben, Übertragen auf Unteraufgaben |
| [papierkorb.md](papierkorb.md) | Papierkorb in Datenmodell, API-Regeln und Oberfläche |
| [serien.md](serien.md) | Wiederkehrende Aufgaben und die Oberfläche „Wiederholungen“ |
| [tagesplan.md](tagesplan.md) | Tagesplan |
| [eingang-und-quellen.md](eingang-und-quellen.md) | Eingang, Quellen eines Tickets, Tickets als Quelle und Folge-Tickets |
| [kanaele.md](kanaele.md) | Kanäle und Stichwörter, Ingest-Routen, Zugangsschlüssel, Seite „Kanäle“ |
| [haushalt.md](haushalt.md) | Haushalt, Konten und Verwalter, Verschieben und Auflösen, Bereichs-Umschalter, Zuständigkeit |
| [ansichten.md](ansichten.md) | Aufgaben, Filter, Projektansicht, Erledigte, Aktionsmenüs, Schnellerfassung, Kalender, Tickets im Kontext |
| [ui-bausteine.md](ui-bausteine.md) | Overlays und Rückmeldungen, Hinweis-Bausteine, Markdown und Editor |
| [design-system.md](design-system.md) | Themes, Tokens, Materialien, Formularelemente, Knopfklassen, Farbwerte, Status-Pillen |
| [einstellungen-system.md](einstellungen-system.md) | Einstellungsbereich, Hilfe, Tour, Server-System, Seite „System“, Speicher |
| [sicherung.md](sicherung.md) | Sicherung, Prüfung und Wiederherstellen |
| [betrieb.md](betrieb.md) | Steuerskript, Start und Stopp, Landing-Seite, installierbare Web-App, Präsenz, Hilfsprogramme, Web-Build im laufenden Betrieb |

Im Kern geblieben sind §1 bis §4 (Zweck, Repo-Struktur, Tech-Stack mit PocketBase-API-Disziplin, Runes-Regel), §10 bis §12 (Scope, Regeln für Agenten, Arbeitsweise) und aus §7 bis §9 die Regeln, die für jede Oberfläche bzw. jedes Skript gelten. Die Nummern §1 bis §12 sind gleich geblieben; §5 und §6 sind im Kern nur noch Verweise.

## Alte Abschnitte → neuer Ort

Stand der CLAUDE.md vor DOC-1: Commit `65b7d2b4`. Die Zeilen beziehen sich auf diese Fassung (`git show 65b7d2b4:CLAUDE.md`). „Alter Ort“ nennt Abschnitt, Unterabschnitt und bei eingerückten Einträgen den übergeordneten Eintrag; „Inhalt“ die fett gesetzten Anfänge der Einträge bzw. ihre ersten Wörter.

| Alter Ort | Zeilen | Inhalt | Neuer Ort |
|---|---|---|---|
| Kopf | 1–3 | Überschrift „CLAUDE.md – becauseyoulovejira“; Verbindliche Projektregeln. Gilt für jede … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §1 Zweck | 5–7 | Überschrift „1. Zweck“; Privates, lokal laufendes Ticket-Dashboard … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §2 Repo-Struktur | 9–33 | Überschrift „2. Repo-Struktur“; Codeblock | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §3 Tech-Stack (festgelegt – Änderung nur nach Rückfrage beim Nutzer) | 35–37 | Überschrift „3. Tech-Stack (festgelegt – Änderung nur nach Rückfrage beim Nutzer)“; Backend | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §3 Tech-Stack (festgelegt – Änderung nur nach Rückfrage beim Nutzer) / Backend | 38–40 | Serverlogik ausschließlich über JS-Hooks …; Schema ausschließlich über handgeschriebene …; Bindung an `127.0.0.1` (Mehrgeräte über HTTPS … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §3 Tech-Stack (festgelegt – Änderung nur nach Rückfrage beim Nutzer) | 41–49 | Frontend; Schriften; Lizenzhinweise; Geführte Tour; Editor; Browser-Erweiterung für WhatsApp Web; Tests; Sicherung; Node.js | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §3 Tech-Stack (festgelegt – Änderung nur nach Rückfrage beim Nutzer) / PocketBase-API-Disziplin | 51–61 | Überschrift „PocketBase-API-Disziplin“; Die APIs (Hooks, Migrationen, SDK) haben sich …; Hook-Handler müssen `e.next()` aufrufen.; Create und Update über die Record-API laufen in …; In Hooks für DB-Zugriffe `e.app` verwenden, …; Module per …; Filter mit Nutzereingaben immer parametrisiert …; Keine Zeitzonen-APIs der Laufzeit für fachliche …; Kein `onServe`; Autodate-Felder: PocketBase liest die Uhr für … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §4 Svelte-5-Runes-Regel (hart) | 63–68 | Überschrift „4. Svelte-5-Runes-Regel (hart)“; Ausschließlich Runes: `$state`, `$derived`, …; Verboten: `export let`, `$:`-Statements, …; Stattdessen: Event-Attribute (`onclick`), …; `$effect` nur für echte Seiteneffekte … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §5 Datenmodell | 70 | Überschrift „5. Datenmodell“ | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §5 Datenmodell | 72–103 | Alle fachlichen Datensätze tragen `owner` …; Tabelle; Status; Priorität; completed_at; Fälligkeit; Historie | [datenmodell.md](datenmodell.md) – Datenmodell |
| §5 Datenmodell | 104 | Angepinnter Kommentar | [tickets.md](tickets.md) – Datenmodell |
| §5 Datenmodell | 105 | Parent | [unteraufgaben.md](unteraufgaben.md) – Datenmodell |
| §5 Datenmodell | 106 | Papierkorb | [papierkorb.md](papierkorb.md) – Datenmodell |
| §5 Datenmodell | 107–111 | Duplizieren; Unterprojekte; Farben; Charms; Angeheftete Tickets | [tickets.md](tickets.md) – Datenmodell |
| §5 Datenmodell | 112 | Tagesplan | [tagesplan.md](tagesplan.md) – Datenmodell |
| §5 Datenmodell | 113 | Tickets als Quelle | [eingang-und-quellen.md](eingang-und-quellen.md) – Datenmodell |
| §5 Datenmodell | 114 | Zuständigkeit | [haushalt.md](haushalt.md) – Datenmodell |
| §5 Datenmodell | 115 | Vollständiges Anlegen | [tickets.md](tickets.md) – Datenmodell |
| §5 Datenmodell | 116 | Auf Unteraufgaben übertragen | [unteraufgaben.md](unteraufgaben.md) – Datenmodell |
| §5 Datenmodell | 117 | Eingang | [eingang-und-quellen.md](eingang-und-quellen.md) – Datenmodell |
| §5 Datenmodell / Eingang | 118–125 | Duplikate; Umwandeln; Quellen; Ticket löschen; Seitenkopie; Verworfen ist ein Tombstone; Kopie der Herkunft; Quelldatum | [eingang-und-quellen.md](eingang-und-quellen.md) – Datenmodell |
| §5 Datenmodell | 126 | „Neu“ | [tickets.md](tickets.md) – Datenmodell |
| §5 Datenmodell | 127 | Kanäle und Stichwörter | [kanaele.md](kanaele.md) – Datenmodell |
| §5 Datenmodell / Kanäle und Stichwörter | 128–137 | Automatisch übernommen wird nur, was ein …; Postfächer: Durchsucht wird der …; Originaldateien bis 25 MB; Datei-Importe und die Postfach-Auswahl sind …; Eigener Eingang; Google Calendar und Telegram laufen per Cron im …; Antworten des Telegram-Bots; Notion; GitHub; Ordner | [kanaele.md](kanaele.md) – Datenmodell |
| §5 Datenmodell / Scopes und Nummernkreise | 139 | Überschrift „Scopes und Nummernkreise“ | [datenmodell.md](datenmodell.md) – Überschrift „Scopes und Nummernkreise“ |
| §5 Datenmodell / Scopes und Nummernkreise | 141–145 | Jeder Datensatz gehört genau einem Scope: …; Key: `<CODE>-<NR>` mit Projekt, sonst …; Vergabe im `onRecordCreate`-Hook innerhalb …; Wechsel von Projekt oder Scope ⇒ neuer Key im …; Bereiche in der Oberfläche | [datenmodell.md](datenmodell.md) – Scopes und Nummernkreise |
| §5 Datenmodell / API-Regeln | 147 | Überschrift „API-Regeln“ | Überschrift „API-Regeln“ in den Detaildokumenten (allgemeine Regeln in [datenmodell.md](datenmodell.md)) |
| §5 Datenmodell / API-Regeln | 149–151 | Umsetzung in …; `projects`, `tags`, `recurrence_rules`, … | [datenmodell.md](datenmodell.md) – API-Regeln |
| §5 Datenmodell / API-Regeln / `projects`, `tags`, `recurrence_rules`, … | 152–154 | list/view/update/delete: …; create: …; update zusätzlich: … | [datenmodell.md](datenmodell.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 155 | Papierkorb | [papierkorb.md](papierkorb.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 156–157 | `comments`: Sichtbarkeit wie das Ticket …; `ticket_history`: list/view wie das Ticket, … | [datenmodell.md](datenmodell.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 158 | `recurrence_rules`: Den Rest prüft … | [serien.md](serien.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 159 | `inbox_items`: Unveränderliche Felder und … | [eingang-und-quellen.md](eingang-und-quellen.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 160 | `ticket_reads`: list/view/create/delete nur mit … | [datenmodell.md](datenmodell.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 161 | `ticket_pins` (seit PIN-1, ADR-0064): list/view … | [tickets.md](tickets.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 162 | `day_plans`, `day_plan_settings` (seit TP-1, … | [tagesplan.md](tagesplan.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 163 | `ticket_sources` (seit QT-1, ADR-0067): … | [eingang-und-quellen.md](eingang-und-quellen.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 164–165 | `users.import_keywords` und seit ZP-1 …; `inbox_keys` (seit EI-1, ADR-0038): … | [kanaele.md](kanaele.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 166 | Präsenz und Hinweis | [betrieb.md](betrieb.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 167–168 | Server-System; Betrieb aus dem Dashboard | [einstellungen-system.md](einstellungen-system.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 169 | Sicherung | [sicherung.md](sicherung.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 170 | Speicher | [einstellungen-system.md](einstellungen-system.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 171 | `dependencies`: list/view wie oben, Schreiben … | [datenmodell.md](datenmodell.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 172–174 | `households`: list/view nur für Mitglieder; …; Haushalt verwalten; Verschieben und Auflösen | [haushalt.md](haushalt.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 175 | `users`: list/view der eigene Datensatz, jeder … | [datenmodell.md](datenmodell.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 176 | Konten und Verwalter | [haushalt.md](haushalt.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 177 | Kanäle mit Zugangsdaten nur für den Verwalter | [kanaele.md](kanaele.md) – API-Regeln |
| §5 Datenmodell / API-Regeln | 178 | Mail-Flows: Solange kein Mailer eingerichtet … | [sicherheit.md](sicherheit.md) – Mail-Flows |
| §5 Datenmodell / API-Regeln | 179 | Bedingungen auf denselben `@collection`-Alias … | [datenmodell.md](datenmodell.md) – API-Regeln |
| §5 Datenmodell / Sicherheitsregeln für Routen | 181 | Überschrift „Sicherheitsregeln für Routen“ | [sicherheit.md](sicherheit.md) – Überschrift „Sicherheitsregeln für Routen“ |
| §5 Datenmodell / Sicherheitsregeln für Routen | 183–194 | ADR-0055, Plan, seit SH-1 (Migration …; Guard vor jeder Anfrage; CORS; Rate-Limit; Header; Admin-Oberfläche; Nur-lokale Routen prüfen die echte Client-IP; Zugriff im Heimnetz; Tests; Seite „Sicherheit“; Kontext der Oberfläche | [sicherheit.md](sicherheit.md) – Sicherheitsregeln für Routen |
| §6 Wiederkehrende Aufgaben (Kernfunktion) | 196 | Überschrift „6. Wiederkehrende Aufgaben (Kernfunktion)“ | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §6 Wiederkehrende Aufgaben (Kernfunktion) | 198–206 | Prinzip Vorlage/Instanz: Eine Regel erzeugt …; Nur das aktuelle Vorkommen zählt; Serie mit vergangener Fälligkeit beginnt ab heute; Vorschau ab der gewählten Fälligkeit; `calendar`: selbst implementierte …; `after_completion`: nächste Fälligkeit = …; Auslöser: Erledigen der aktuellen Instanz …; Berechnung in `app/pb_hooks/lib/recurrence.js`: …; Umsetzung seit E5 (ADR-0021 bis ADR-0024, … | [serien.md](serien.md) – Wiederkehrende Aufgaben (Kernfunktion) |
| §6 Wiederkehrende Aufgaben (Kernfunktion) / Umsetzung seit E5 (ADR-0021 bis ADR-0024, … | 207–216 | Rechnen; Erzeugen; Vorlauf; Rückgängig; Pausieren und Fortsetzen; Vorlage; Unteraufgaben der Vorlage; Löschen und Lösen; Vorschläge aus Kalenderserien; Vor der Migration | [serien.md](serien.md) – Wiederkehrende Aufgaben (Kernfunktion) |
| §7 Frontend & UX | 218–221 | Überschrift „7. Frontend & UX“; UI-Sprache Deutsch. Desktop zuerst, auf …; Seitenaufbau ab E3 nach dem Vorbild des … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §7 Frontend & UX | 222–225 | Filter-Karten; Ansicht „Aufgaben“ (ADR-0010): Kopfzeile …; Filter (Status, in „Aufgaben“ seit ER-1 ohne …; Projektansicht mit Projektauswahl; … | [ansichten.md](ansichten.md) – Oberfläche |
| §7 Frontend & UX | 226–228 | Farben; Kommentare; Angeheftet | [tickets.md](tickets.md) – Oberfläche |
| §7 Frontend & UX | 229 | Tagesplan | [tagesplan.md](tagesplan.md) – Oberfläche |
| §7 Frontend & UX | 230 | Zuständigkeit | [haushalt.md](haushalt.md) – Oberfläche |
| §7 Frontend & UX | 231 | „Neues Ticket“ vollständig | [tickets.md](tickets.md) – Oberfläche |
| §7 Frontend & UX | 232–233 | Auf Unteraufgaben übertragen; „Übertragen …“ nach einer Änderung | [unteraufgaben.md](unteraufgaben.md) – Oberfläche |
| §7 Frontend & UX | 234 | Erledigte | [ansichten.md](ansichten.md) – Oberfläche |
| §7 Frontend & UX | 235–236 | Quellen eines Tickets; Tickets als Quelle und Folge-Tickets | [eingang-und-quellen.md](eingang-und-quellen.md) – Oberfläche |
| §7 Frontend & UX | 237 | Duplizieren | [tickets.md](tickets.md) – Oberfläche |
| §7 Frontend & UX | 238 | Aktionsmenüs | [ansichten.md](ansichten.md) – Oberfläche |
| §7 Frontend & UX | 239 | Overlays und Rückmeldungen | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §7 Frontend & UX / Overlays und Rückmeldungen | 240 | Genau sechs Bausteine unter … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §7 Frontend & UX / Overlays und Rückmeldungen | 241–252 | Modal; Bestätigung; Popover; Tickets und Projekte aus Listen; Tag-Eingabe; Seitenpanel; Vollansicht; Flags; Erneut geöffnet und zweiter Tab; „Rückgängig“; Auswahl und Sammelaktionen; Bearbeiten in Zellen | [ui-bausteine.md](ui-bausteine.md) – Overlays und Rückmeldungen |
| §7 Frontend & UX / Overlays und Rückmeldungen | 253 | Papierkorb | [papierkorb.md](papierkorb.md) – Oberfläche |
| §7 Frontend & UX / Overlays und Rückmeldungen | 254–256 | Escape-Kette; Kopfordnung; Die Pakete UI-0 bis UI-9 (samt UI-6b) sind … | [ui-bausteine.md](ui-bausteine.md) – Overlays und Rückmeldungen |
| §7 Frontend & UX | 257 | Schnellerfassung per `c` und `Strg+K` (nicht in … | [ansichten.md](ansichten.md) – Oberfläche |
| §7 Frontend & UX | 258 | Eingang `/eingang` mit Panel `/eingang/<id>`, … | [eingang-und-quellen.md](eingang-und-quellen.md) – Oberfläche |
| §7 Frontend & UX | 259–260 | Kalender; Tickets im Kontext | [ansichten.md](ansichten.md) – Oberfläche |
| §7 Frontend & UX | 261 | Wiederholungen | [serien.md](serien.md) – Oberfläche |
| §7 Frontend & UX / Wiederholungen | 262–269 | „Wiederholen…“; Übersicht `/wiederholungen`; Erklärung; Rückstand und Hinweise; Zustand; Vorlage am Ticket; Wiederholen beim Anlegen; Kalenderserien | [serien.md](serien.md) – Oberfläche |
| §7 Frontend & UX | 270 | Seite „Kanäle“ `/einstellungen/kanaele` (seit … | [kanaele.md](kanaele.md) – Oberfläche |
| §7 Frontend & UX | 271 | Einstellungen, Hinweise und Anleitungen | [einstellungen-system.md](einstellungen-system.md) – Oberfläche |
| §7 Frontend & UX / Einstellungen, Hinweise und Anleitungen | 272 | Einstellungsbereich `/einstellungen/*` über die … | [einstellungen-system.md](einstellungen-system.md) – Oberfläche |
| §7 Frontend & UX / Einstellungen, Hinweise und Anleitungen | 273 | Hinweise über die Bausteine unter … | [ui-bausteine.md](ui-bausteine.md) – Hinweise |
| §7 Frontend & UX / Einstellungen, Hinweise und Anleitungen | 274 | Kanäle als Karten mit Status-Lozenge, … | [kanaele.md](kanaele.md) – Oberfläche |
| §7 Frontend & UX / Einstellungen, Hinweise und Anleitungen | 275–276 | „Erste Schritte“ (seit EH-12, …; Bis ein Paket gemergt ist, gilt für seinen … | [einstellungen-system.md](einstellungen-system.md) – Oberfläche |
| §7 Frontend & UX | 277–278 | Inhalte aus Kanälen sind nicht …; Realtime: Subscriptions aktualisieren gezielt … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §7 Frontend & UX | 279 | Neue Version im offenen Tab | [betrieb.md](betrieb.md) – Oberfläche |
| §7 Frontend & UX | 280–282 | Bereichs-Umschalter; Seite „Einstellungen → Haushalt“; Verschieben zwischen den Bereichen | [haushalt.md](haushalt.md) – Oberfläche |
| §7 Frontend & UX | 283 | Markdown-Ausgabe wird sanitisiert (ADR-0008). … | [ui-bausteine.md](ui-bausteine.md) – Markdown und Editor |
| §7 Frontend & UX / Markdown-Ausgabe wird sanitisiert (ADR-0008). … | 284–286 | Abhaken in der Ansicht; Editor; Kein stilles Überschreiben der Beschreibung | [ui-bausteine.md](ui-bausteine.md) – Markdown und Editor |
| §8 Design-System | 288–290 | Überschrift „8. Design-System“; Alle Farben als CSS-Custom-Properties zentral … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §8 Design-System | 292 | Akzent-Themes | [design-system.md](design-system.md) – Themes, Tokens und Bausteine |
| §8 Design-System / Akzent-Themes | 293–297 | Die vier Modus-Blöcke tragen alle Tokens mit …; Jedes weitere Theme hat vier Blöcke mit …; Neutrale Flächen, Linien, Text und der Schleier …; Eine neue akzentabhängige Farbe braucht ein …; `tokens.test.ts` prüft für 4 Themes × 4 … | [design-system.md](design-system.md) – Themes, Tokens und Bausteine |
| §8 Design-System / `tokens.test.ts` prüft für 4 Themes × 4 … | 298–300 | Vollständigkeit der Tokens; WCAG AA: Text 4,5 : 1, Fokusring und …; Abstände (ΔE2000): Akzent zu Fehler ≥ 20, … | [design-system.md](design-system.md) – Themes, Tokens und Bausteine |
| §8 Design-System | 301–304 | Palette für Projekte und Tickets; Hell/Dunkel; Farbwahl | [design-system.md](design-system.md) – Themes, Tokens und Bausteine |
| §8 Design-System / Farbwahl | 305–309 | Das Menü „Darstellung“ hat nach einem Trenner …; Beide nutzen `ACCENT_THEMES`, `ACCENT_LABELS` …; Gespeichert wird in `localStorage` unter …; Das Inline-Skript in `app.html` setzt …; Die Farbfelder kommen aus `--swatch-<theme>` in … | [design-system.md](design-system.md) – Themes, Tokens und Bausteine |
| §8 Design-System | 310–311 | Overlay-Tokens; Materialien und Tiefe | [design-system.md](design-system.md) – Themes, Tokens und Bausteine |
| §8 Design-System / Materialien und Tiefe | 312–323 | Glas nur in der Bedienebene (Kopfzeile, …; Tabellen, Kacheln, Karten, Texte, Formulare, …; Mindest-Deckkraft 0,82, geprüft in …; Schatten nur über `--shadow-*` (neutral, nur in …; Der Hintergrund ist ein Verlauf aus …; Ein Umschaltpunkt in `tokens.css` macht alles …; Schalter „Transparenz“; Switch; Menüzeilen (Popover der Art `menu`) stylt …; Materialien je Baustein; Typografie; Destruktive Knöpfe sind nicht rot. Animationen … | [design-system.md](design-system.md) – Themes, Tokens und Bausteine |
| §8 Design-System | 324–329 | Fokusring; Checkboxen und Radios; Formularelemente nur über den zentralen Stil; Breite von Formular-Controls; Gemeinsame Knopfklassen; Hinweis-Bausteine | [design-system.md](design-system.md) – Themes, Tokens und Bausteine |
| §8 Design-System | 331–355 | Tabelle; Die Tabelle nennt die Werte mit Petrol. Die …; Weißer Text auf #07838F ist in beiden Modi …; Die Marke nie als kleiner Text, dafür gibt es …; Kupfer: hell tiefes Kupferbraun für Text und …; Rubin: Im Rubin-Theme ist die Fehlerfarbe …; Kupfer: Kupfer liegt nahe am Fehlerrot, deshalb … | [design-system.md](design-system.md) – Farbwerte |
| §8 Design-System | 356 | Rot nur für echte Fehler: fehlgeschlagene … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §8 Design-System | 358–366 | Status-Pillen („Ton in Ton"):; Tabelle | [design-system.md](design-system.md) – Status-Pillen |
| §8 Design-System | 368 | Erledigte Tickets treten in der Liste optisch … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §9 Betrieb unter Windows | 370 | Überschrift „9. Betrieb unter Windows“ | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §9 Betrieb unter Windows | 372 | Steuerskript | [betrieb.md](betrieb.md) – Betrieb unter Windows |
| §9 Betrieb unter Windows | 373 | Skript-Fehler nur über den Katalog | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §9 Betrieb unter Windows | 374–377 | `start.bat`: startet PocketBase ohne sichtbares …; `becauseyoulovejira.html` (seit SF-2, ADR-0035 …; Installierbare Web-App; `autostart-an.bat` / `autostart-aus.bat`: … | [betrieb.md](betrieb.md) – Betrieb unter Windows |
| §9 Betrieb unter Windows | 378 | Seite „Einstellungen → System“ | [einstellungen-system.md](einstellungen-system.md) – Betrieb |
| §9 Betrieb unter Windows | 379–381 | `byl-mail.exe`: `start.bat` startet ihn nach …; Altdateien der Hilfsprogramme; Neuer Web-Build im laufenden Betrieb | [betrieb.md](betrieb.md) – Betrieb unter Windows |
| §9 Betrieb unter Windows | 382 | Sicherung | [sicherung.md](sicherung.md) – Betrieb |
| §9 Betrieb unter Windows | 383 | Nach Kopie von `app/` auf einen anderen … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §10 Scope | 385–395 | Überschrift „10. Scope“; MVP; Unteraufgaben; Stufe 2; Haushalts-UI; Plattform-Ausbau und Releases; Unterprojekte; Nicht umsetzen; Kanäle; Keine Features außerhalb des Scopes, keine … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §11 Regeln für Agenten und Automatisierung auf dem Entwicklungsrechner | 397–401 | Überschrift „11. Regeln für Agenten und Automatisierung auf dem Entwicklungsrechner“; Python-Verbot; PocketBase-Sicherheit | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §11 Regeln für Agenten und Automatisierung auf dem Entwicklungsrechner / PocketBase-Sicherheit | 402–424 | Codeblock; Zugangsdaten werden zur Laufzeit erzeugt und … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §11 Regeln für Agenten und Automatisierung auf dem Entwicklungsrechner | 426–430 | Keine Autostart-Skripte und Hintergrundprozesse; Nur eine Claude-Session pro Repo; Texte nie über die Shell schreiben | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §11 Regeln für Agenten und Automatisierung auf dem Entwicklungsrechner / Texte nie über die Shell schreiben | 431–432 | Markdown- und Textdateien (Doku, Pläne, ADRs, …; Beispielbefehle mit `setx`, `stop.bat`, … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §11 Regeln für Agenten und Automatisierung auf dem Entwicklungsrechner | 434 | Bauen, während die App des Nutzers läuft | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §11 Regeln für Agenten und Automatisierung auf dem Entwicklungsrechner / Bauen, während die App des Nutzers läuft | 435–436 | Gemergte Pakete sofort live; `scripts\build.ps1 -SkipTests` | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §12 Arbeitsweise | 438–446 | Überschrift „12. Arbeitsweise“; Etappen (ADR-0011): E0 Gerüst · E1 …; Nach jeder Etappe: Zusammenfassung, …; Öffentliches GitHub-Repo …; Branch-Schutz; CI; Commits im Branch: ein Commit pro …; Branches nach dem Merge löschen | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §12 Arbeitsweise / Branches nach dem Merge löschen | 447–448 | Ohne Rückfrage erlaubt; Weiterhin nur mit Bestätigung des Nutzers | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §12 Arbeitsweise | 449–453 | Kein toter oder auskommentierter Code, keine …; Neue Ticket-Optionen immer auch in „Neues Ticket“; Fehler mit „Details“; Stabile Tests (Plan Test-Härtung): auf den …; Qualitäts-Gates | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §12 Arbeitsweise / Qualitäts-Gates | 454–456 | Kleine Pakete und reine Oberflächen-Änderungen; Größere Pakete; Nach dem Merge geht der Stand sofort live … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
| §12 Arbeitsweise | 457–459 | Jedes Arbeitspaket aktualisiert …; Manuelle Prüfungen; Niemals Secrets, `pb_data/`, Backups, echte … | [CLAUDE.md](../../CLAUDE.md) (Kern) |
