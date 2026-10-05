// Settings "Hilfe" (plan EH-9, §3.10): jump links to twelve sections, the shortcuts of every context
// from the one source, the short syntax with its tokens, the access data moved here from "Kanäle",
// the own inbox with examples and WhatsApp Web (ADR-0038), Notion (ADR-0041) and GitHub (ADR-0050)
// with the steps of the token, the frequent questions as <details>, the
// operation of the app with the frequent problems of the scripts (ADR-0048), the backups with the
// emergency plan (ADR-0046 §8) and the storage (ADR-0047 §6). No table (description lists).

import { render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import { page } from '$app/state';
import { MEMBER_CONTEXT, PC_CONTEXT, REMOTE_CONTEXT, useContext } from '$lib/test/context';
import {
	EMERGENCY_LOSSES,
	EMERGENCY_MANUAL,
	EMERGENCY_STEPS,
	PASSPHRASE_TEXTS
} from '$lib/domain/backup';
import { SCRIPT_PROBLEMS } from '$lib/domain/script-problems';
import { RESTART_NEEDED } from '$lib/guidance/texts';
import { HELP_SECTIONS, SETTINGS_SECTIONS, helpHref } from '$lib/settings-sections';
import Page from './+page.svelte';

function text(element: Element): string {
	return (element.textContent ?? '').replace(/\s+/g, ' ');
}

// The administrator on the machine of the app under Windows sees the help as before KOB-1; the
// other contexts are below.
beforeEach(async () => {
	await useContext(PC_CONTEXT);
});

describe('help page (EH-9)', () => {
	it('is a page of the settings navigation with an address per section', () => {
		expect(SETTINGS_SECTIONS.map((section) => section.id)).toContain('hilfe');
		expect(SETTINGS_SECTIONS.find((section) => section.id === 'hilfe')?.href).toBe(
			'/einstellungen/hilfe'
		);
		expect(helpHref('kurzsyntax')).toBe('/einstellungen/hilfe#kurzsyntax');
		const { container } = render(Page);
		for (const section of HELP_SECTIONS) {
			expect(container.querySelector(`section#${section.id}`), section.id).not.toBeNull();
		}
	});

	it('jumps to the sections that exist on the page, twenty since the view "Erledigte"', () => {
		const { container } = render(Page);

		const jump = within(screen.getByRole('navigation', { name: 'Auf dieser Seite' }));
		const links = jump.getAllByRole('link');
		expect(links.map((link) => link.textContent?.trim())).toEqual([
			'Tastaturkürzel',
			'Kurzsyntax',
			'Wiederholungen',
			'Kalender',
			'Tagesplan',
			'Erledigte',
			'Kanäle und Zugangsdaten',
			'Eigener Eingang (API)',
			'WhatsApp Web',
			'Notion',
			'GitHub',
			'Ordner',
			'Häufige Fragen',
			'Betrieb',
			'Sicherung & Notfall',
			'Speicher',
			'Sicherheit',
			'Konten und Verwalter',
			'Haushalt',
			'Bereiche Privat und Haushalt'
		]);
		for (const link of links) {
			const id = link.getAttribute('href')?.slice(1) ?? '';
			const section = container.querySelector(`section#${id}`);
			expect(section, id).not.toBeNull();
			// "Kalender" names the group of its keys in "Tastaturkürzel" as well.
			expect(screen.getAllByRole('region', { name: link.textContent?.trim() })).toContain(section);
		}
		expect(container.querySelectorAll('table')).toHaveLength(0);
	});

	it('lists the shortcuts of every context', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Tastaturkürzel' });
		expect(
			within(section)
				.getAllByRole('heading', { level: 4 })
				.map((heading) => heading.textContent?.trim())
		).toEqual(['Überall', 'Liste', 'Kalender', 'Panel', 'Dialoge', 'Editor']);
		expect(text(section)).toMatch(/Schnellerfassung öffnen/);
		expect(text(section)).toMatch(/In die Einträge des Tages wechseln/);
		expect(text(section)).toMatch(/Kommentare“ und „Verlauf/);
		expect(text(section)).toMatch(/Zur Formatierungsleiste/);
	});

	it('explains the short syntax with an example and its tokens', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Kurzsyntax' });
		expect(within(section).getByRole('region', { name: 'Beispiel' }).textContent).toBe(
			'Zahnarzt anrufen @HAUS !hoch #anruf'
		);
		expect(within(section).queryByRole('button', { name: /kopieren/ })).toBeNull();
		const content = text(section);
		for (const token of [
			'@CODE',
			'!niedrig',
			'!mittel',
			'!hoch',
			'!dringend',
			'!1',
			'!4',
			'#tag'
		]) {
			expect(content).toContain(token);
		}
	});

	it('explains setx, the control panel and the restart for the access data', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Kanäle und Zugangsdaten' });
		expect(within(section).getByRole('heading', { level: 4 }).textContent).toBe(
			'Zugangsdaten als Windows-Variable setzen'
		);
		const content = text(section);
		expect(content).toMatch(/setx BYL_TELEGRAM_TOKEN/);
		expect(content).toMatch(/Umgebungsvariablen für dieses Konto bearbeiten/);
		expect(content).toMatch(/neu-starten\.bat im Ordner app doppelklicken/);
		expect(within(section).getByRole('link', { name: 'Kanäle' }).getAttribute('href')).toBe(
			'/einstellungen/kanaele'
		);
	});

	it('describes the channel cards: state, one line, one button, the menu "•••" and details (KK-2)', () => {
		render(Page);
		const content = text(screen.getByRole('region', { name: 'Kanäle und Zugangsdaten' }));
		expect(content).toMatch(
			/„Verbunden“, „Pausiert“,\s*„Fehler“, „Einrichtung offen“ oder „Neustart nötig“/
		);
		expect(content).toMatch(/Zuletzt\s+abgerufen vor 5 Min\. · 3 neu/);
		expect(content).toMatch(/Menü „•••“/);
		expect(content).toMatch(/unter „Details“/);
		// Long keyword lists fold (ADR-0026, addendum KL).
		expect(content).toMatch(
			/zuerst 8 und „\+ N weitere“,\s*ab 21 Stichwörtern mit einem Filterfeld/
		);
		expect(content).toMatch(/steht nicht mehr auf „Einrichtung offen“/);
		expect(content).not.toMatch(/Nicht eingerichtet/);
		// Renaming in the card (ADR-0026, addendum KK-3).
		expect(content).toMatch(/„Umbenennen …“ macht den Namen oben in der Karte zum Textfeld/);
		expect(content).toMatch(/ändert nur den Namen, nie Abruf, Zugangsdaten oder Stichwörter/);
		expect(content).toMatch(
			/Eigener Eingang, WhatsApp Web, Dateien und\s+Bookmarklet haben feste Namen/
		);
	});

	it('explains the target project of a card: where it is set, only new entries, prefill (ADR-0049)', () => {
		render(Page);
		const content = text(screen.getByRole('region', { name: 'Kanäle und Zugangsdaten' }));
		expect(content).toMatch(/Menü „•••“ \(Stichwörter, Zielprojekt,/);
		expect(content).toMatch(
			/Du wählst es unter „Details“ \(oder über „Zielprojekt …“ im\s+Menü „•••“/
		);
		expect(content).toMatch(/eine spätere Änderung gilt also nur für neue Einträge/);
		expect(content).toMatch(/Beim Umwandeln ist es vorbelegt, und du kannst es ändern/);
		expect(content).toMatch(/archiviertes oder gelöschtes\s+Projekt wird nicht vorbelegt/);
		expect(content).toMatch(/Im Eingang filterst und gruppierst du nach Zielprojekt/);
	});

	it('explains the charms: choosing, the rule and its next tickets, where they show (ADR-0062)', () => {
		render(Page);
		const content = text(screen.getByRole('region', { name: 'Häufige Fragen' }));
		expect(content).toMatch(
			/Ein Charm ist ein kleines Symbol vor dem Titel, wie im Outlook-Kalender/
		);
		expect(content).toMatch(/öffnet „Charm wählen“\s+die Auswahl: oben die Suche/);
		expect(content).toMatch(/änderst du ihn,\s+bekommen ihn erst die nächsten Tickets/);
		expect(content).toMatch(/Unteraufgaben bekommen keinen/);
		expect(content).toMatch(/„Kein Charm“ entfernt ihn wieder/);
		// "Duplizieren …" takes charm and kind over (ADR-0045, PL-1).
		expect(content).toMatch(
			/Den Charm und die Art \(Aufgabe oder laufendes Vorhaben\) nimmt das Duplikat immer mit/
		);
	});

	it('explains the filter cards: toggles, their union, "Alle offenen", filters and summary (FI-1)', () => {
		render(Page);
		const content = text(screen.getByRole('region', { name: 'Häufige Fragen' }));
		expect(content).toMatch(
			/sind Schalter: Ein Klick wählt\s+eine Karte, ein zweiter wählt sie wieder ab/
		);
		expect(content).toMatch(/zu mindestens einer gewählten Karte passt, und zwar nur einmal/);
		expect(content).toMatch(/„Alle offenen“ ist gewählt, solange keine andere Karte gewählt ist/);
		expect(content).toMatch(
			/Die Filter der Filterleiste und die Suche schränken die gewählten Karten/
		);
		expect(content).toMatch(/„12 Tickets aus: In Arbeit, Heute fällig,\s+Dringend“/);
		expect(content).toMatch(/Ältere Lesezeichen mit Status,\s+Priorität oder Fälligkeit/);
		// PL-1: pinned tickets in the summary; ER-1: the cards only for open tickets.
		expect(content).toMatch(/„4 \+ 1 angeheftet aus: Dringend“/);
		expect(content).toMatch(/Die Karten gelten nur für offene Tickets; erledigte\s+stehen unter/);
	});

	it('explains pinning: the toggle, the section above every filter, personal pins, releasing (ADR-0064)', () => {
		render(Page);
		const content = text(screen.getByRole('region', { name: 'Häufige Fragen' }));
		expect(content).toMatch(/Mit dem Knopf „Anheften“ \(eine Nadel\) am Ende des Titels/);
		expect(content).toMatch(/ganz oben im Abschnitt „Angeheftet“/);
		expect(content).toMatch(/auch wenn die Filter sie sonst ausblenden würden/);
		expect(content).toMatch(/„\+ 2 angeheftet“/);
		expect(content).toMatch(/Deine Pins siehst nur du, auch im Haushalt/);
		expect(content).toMatch(
			/ist es für alle gelöst;\s+Wiedereröffnen oder Wiederherstellen heftet es nicht neu an/
		);
	});

	it('answers the frequent questions in folded details', () => {
		const { container } = render(Page);
		const section = screen.getByRole('region', { name: 'Häufige Fragen' });
		const questions = [...section.querySelectorAll('details > summary')].map((summary) =>
			summary.textContent?.trim()
		);
		expect(questions).toEqual([
			'Warum kommt meine Mail nicht an?',
			'Was schreibt der Telegram-Bot in den Chat?',
			'Wo sind meine Zugangsdaten gespeichert?',
			`Was bedeutet „${RESTART_NEEDED.title}“?`,
			'Wie widerrufe ich einen Zugang?',
			'Warum sehe ich im Admin-Bereich andere Konten?',
			'Wie ändere ich Spalten und ihre Breite?',
			'Wie wirken die Karten über der Liste?',
			'Wie arbeite ich mit Unteraufgaben?',
			'Wie hole ich ein gelöschtes Ticket zurück?',
			'Warum lässt sich ein Ticket im Papierkorb nicht endgültig löschen?',
			'Wo öffnet sich ein Ticket?',
			'Was steht im Menü „•••“ eines Tickets?',
			'Wie dupliziere ich ein Ticket?',
			'Wie lege ich ein Folge-Ticket an, und wie wird ein Ticket zur Quelle?',
			'Wie gliedere ich ein Projekt in Unterprojekte?',
			'Wie sehe ich die offenen Tickets eines Projekts?',
			'Wie färbe ich Projekte und Tickets?',
			'Wie setze ich einen Charm?',
			'Wie hefte ich ein Ticket an?',
			'Wie formatiere ich Beschreibungen und Kommentare?',
			'Wie ordne ich Kommentare und hebe einen hervor?'
		]);
		// The answers of the Telegram bot and their switches (ADR-0016, addendum of 2026-10-01).
		expect(text(section)).toContain('„Im Eingang gespeichert“');
		expect(text(section)).toContain('„Kein Stichwort erkannt – nicht gespeichert“');
		expect(text(section)).toContain(
			'„Bestätigung senden“ und „Hinweis bei fehlendem Stichwort senden“'
		);
		expect(text(section)).toContain('in Gruppen sehen sie alle Mitglieder');
		// Comments (ADR-0044): order, the pinned comment with "Rückgängig", folding.
		expect(text(section)).toContain('„Neueste zuerst“ (Standard) oder „Älteste zuerst“');
		expect(text(section)).toContain('höchstens einen angepinnten Kommentar');
		expect(text(section)).toContain('„Weiterlesen“');
		expect(section.querySelectorAll('details[open]')).toHaveLength(0);
		// Deleting for good only after the dependencies are decided (ADR-0047).
		expect(text(section)).toContain('und keine Quelle hängt mehr daran');
		expect(text(section)).toContain('die Hauptquelle bleibt bei ihrem Ticket');
		// The menu "•••" of a ticket (plan aktionsmenues): entries, keyboard, copying the link.
		expect(text(section)).toContain('„Link kopieren“, „Duplizieren …“ und „In den Papierkorb …“');
		expect(text(section)).toContain('die Pfeiltasten wählen');
		expect(text(section)).toContain('„Link kopiert“');
		// The menu of a row of the table (AM-2): both ways to open, the row does not open.
		expect(text(section)).toContain('„Im Seitenpanel öffnen“ und „In Vollansicht öffnen“');
		expect(text(section)).toContain('Ein Klick auf „•••“ öffnet die Zeile nicht.');
		// The right click and its keys (AM-3), and how to reach the menu of the browser.
		expect(text(section)).toContain(
			'Ein Rechtsklick auf eine Zeile öffnet dasselbe Menü an der Maus'
		);
		expect(text(section)).toContain('Umschalt+F10 oder die Kontextmenü-Taste');
		expect(text(section)).toContain('mit Strg+Rechtsklick');
		// The menus of the other tables (AM-4).
		expect(text(section)).toContain(
			'Auch Papierkorb, Eingang, die Liste der Projekte und die Wiederholungen haben am Ende jeder Zeile „•••“'
		);
		// The follow-ups (AM-5): sources and copies in the inbox, the main source stays, the tiles.
		expect(text(section)).toContain('„Link der Quelle öffnen“');
		expect(text(section)).toContain('„Anderem Ticket zuordnen …“ und „Lösen“');
		expect(text(section)).toContain('Die Hauptquelle eines Tickets bleibt bei ihm');
		expect(text(section)).toContain('Die Kacheln der Projekte haben „•••“ oben rechts');
		// Duplicating (ADR-0045): the question, the status, sub-tasks, comments, the source, the result.
		expect(text(section)).toContain('„Duplizieren …“ (im Menü „•••“');
		expect(text(section)).toContain('„Erledigt“ gibt es dabei nicht');
		expect(text(section)).toContain('„Kopiert aus HAUS-12“');
		expect(text(section)).toContain('„Kopie der Herkunft übernehmen“');
		expect(text(section)).toContain('„Dupliziert aus …“');
		// Tickets as sources (ADR-0067): follow-ups, the picker without circles, both sections.
		expect(text(section)).toContain('„Folge-Ticket anlegen …“ im Menü „•••“');
		expect(text(section)).toContain('„Quelle hinzufügen“ → „Ticket …“');
		expect(text(section)).toContain('„HAUS-20 stammt bereits (über HAUS-12) von HAUS-3 ab.“');
		expect(text(section)).toContain('im Abschnitt „Folge-Tickets“');
		expect(text(section)).toContain('Tickets einer Wiederholung erben keine Ticket-Quellen');
		// Sub projects (ADR-0034): creating, own code, filter, numbers, archive.
		expect(text(section)).toContain('„Unterprojekt anlegen“');
		expect(text(section)).toContain('GART-3');
		expect(text(section)).toContain('„Unterprojekte einbeziehen“');
		expect(text(section)).toContain('„davon direkt“');
		expect(text(section)).toContain('„Mit Oberprojekt zurückholen“');
		// Colors (ADR-0052): the palette, inheritance, the own color first, never color alone, no red.
		expect(text(section)).toContain('„Wie Oberprojekt“');
		expect(text(section)).toContain('standardmäßig „Wie Projekt“');
		expect(text(section)).toContain('Ihr Name steht beim Zeigen mit der Maus und für Screenreader');
		expect(text(section)).toContain('Rot gibt es nicht, es bleibt für Fehler.');
		// Tickets open where they are clicked (ADR-0054): the areas, the panel they replace, the
		// path, what leads to "Aufgaben" on purpose, and the trash that keeps the user.
		expect(text(section)).toContain('nimmt das Ticket dessen Platz ein');
		expect(text(section)).toContain('führt genau dorthin zurück, sonst zur Ansicht');
		expect(text(section)).toContain('Der Pfad „Haus › Garten“ oben im Ticket öffnet das Projekt.');
		expect(text(section)).toContain('Bewusst nach „Aufgaben“ führen „Link kopieren“');
		expect(text(section)).toContain('bleibst du im Papierkorb, und die Meldung unten links bietet');
		expect(text(section)).toContain('öffnet es hier unter „Projekte“');
		// The way back with the focus, the question of the panels and links in texts (KX-2).
		expect(text(section)).toContain('Der Fokus steht danach wieder auf dem Link');
		expect(text(section)).toContain('fragt es vorher oben im Panel „Änderungen verwerfen?“');
		expect(text(section)).toContain('Links auf Tickets in Beschreibungen und Kommentaren');
		// The calendar and the quick entry (KX-3, ADR-0054 §8).
		expect(text(section)).toContain('nimmt das Ticket dessen Platz ein, auch im Kalender');
		expect(text(section)).toContain(
			'„Ticket ansehen“ nach der Schnellerfassung öffnet das neue Ticket in der Ansicht, in der du gerade bist'
		);
		// Open tickets of a project (ADR-0034, addendum): the disclosure, limit, link, remembered rows.
		expect(text(section)).toContain('der Pfeil vor dem Code eine Zeile auf');
		expect(text(section)).toContain('„Alle 12 in Aufgaben öffnen“');
		expect(text(section)).toContain('„Alle aufklappen“ und „Alle zuklappen“');
		expect(text(section)).toContain('Welche Zeilen offen sind, merkt sich dieser Browser.');
		// Sub-tasks (ADR-0033): adding, the question before completing, nesting, deleting.
		expect(text(section)).toContain('„Unteraufgaben mit erledigen“ oder „Trotzdem erledigen“');
		expect(text(section)).toContain('„HAUS-12 ›“');
		expect(text(section)).toContain('++unterstrichen++');
		expect(text(section)).toContain('- [ ] offen');
		// The editor (RT-3): toolbar, keys, source mode.
		expect(text(section)).toContain('Formatierungsleiste');
		expect(text(section)).toContain('„Markdown“ in der Leiste');
		expect(text(section)).toContain('öffnet ein Menü für Überschriften');
		expect(text(section)).toContain('Aus Word, Google Docs oder einer Webseite');
		expect(text(section)).toContain('direkt in der Ansicht ab');
		expect(text(section)).toContain(RESTART_NEEDED.text);
		expect(
			within(section)
				.getByRole('link', { name: 'Kanäle und Zugangsdaten', hidden: true })
				.getAttribute('href')
		).toBe('#zugangsdaten');
		expect(container.querySelector('#zugangsdaten')).not.toBeNull();
	});

	it('names start, restart, stop, status, port, logs and the administration under "Betrieb"', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Betrieb' });
		const content = text(section);
		// ADR-0039: one file per task, a restart only when needed, the address of this app.
		expect(content).toMatch(
			/start\.bat im Ordner app\. Läuft die App schon, startet es nichts doppelt/
		);
		expect(content).toMatch(
			/neu-starten\.bat im Ordner app\. Es startet nur neu, wenn es nötig ist/
		);
		expect(content).toMatch(
			/stop\.bat beendet geordnet erst den Mail-Hilfsprozess, dann den Server/
		);
		expect(content).toMatch(/status\.bat zeigt, ob die App läuft/);
		// ADR-0043: the same from the dashboard, only on this machine and for the administrator of the
		// app (ADR-0056), no "Beenden".
		const system = within(section).getByRole('link', { name: 'Einstellungen → System' });
		expect(system.getAttribute('href')).toBe('/einstellungen/system');
		expect(content).toMatch(
			/nur im Browser auf dem Rechner der App und nur mit einem Konto, das Verwalter der App ist \(zu Beginn das zuerst angelegte/
		);
		expect(
			within(section).getByRole('link', { name: 'Konten und Verwalter' }).getAttribute('href')
		).toBe('/einstellungen/hilfe#konten');
		expect(content).toMatch(/Beenden geht weiter nur mit stop\.bat/);
		expect(content).toContain(`Diese App läuft unter ${page.url.origin}.`);
		expect(content).toMatch(/byl-control\.ps1 port 8091/);
		expect(content).toMatch(/byl-control\.ps1 doctor/);
		expect(content).not.toMatch(/stop\.bat, dann start\.bat/);
		expect(content).toMatch(/byl-mail\.log/);
		expect(content).toMatch(/byl-control\.log/);
		// ADR-0029 section 8: the glass costs GPU time; the switch helps over a remote desktop.
		expect(content).toMatch(
			/Remote-Desktop, schalte unter Einstellungen → Darstellung den Glas-Effekt aus/
		);
		const admin = within(section).getByRole('link', { name: /Verwaltung/ });
		expect(admin.getAttribute('href')).toBe('/_/');
		expect(admin.getAttribute('rel')).toBe('external');
	});

	it('explains the calendar: views, layers, filters, colors, opening and the keys (ADR-0053)', () => {
		const { container } = render(Page);
		const section = container.querySelector<HTMLElement>('section#kalender')!;
		expect(section.getAttribute('aria-labelledby')).toBe('kalender-title');
		const content = text(section);
		expect(helpHref('kalender')).toBe('/einstellungen/hilfe#kalender');
		expect(within(section).getByRole('link', { name: 'Kalender' }).getAttribute('href')).toBe(
			'/kalender'
		);
		expect(content).toMatch(/als Monat, als Woche oder als Agenda/);
		expect(content).toMatch(/keine Uhrzeiten/);
		expect(content).toMatch(/„überfällig“, nie rot/);
		expect(content).toMatch(/Pausierte Regeln zeigt der Kalender nicht/);
		expect(content).toMatch(/noch nicht umgewandelt/);
		expect(content).toMatch(/„\+N weitere“/);
		expect(content).toMatch(/Seitenpanel oder Vollansicht/);
		expect(content).toMatch(/Punkte statt Titel/);
		expect(content).toMatch(/Bild auf/);
		// Rules and entries next to the calendar (ADR-0054 §8).
		expect(content).toMatch(/öffnet die Regel neben dem Kalender/);
		expect(content).toMatch(/öffnet den Eintrag neben dem Kalender/);
		expect(content).toMatch(/das Schließen führt zurück zur Regel bzw\. zum Eintrag/);
	});

	it('explains the day plan: kinds, check marks, sources, pool, days and the household (ADR-0065)', () => {
		const { container } = render(Page);
		const section = container.querySelector<HTMLElement>('section#tagesplan')!;
		expect(section.getAttribute('aria-labelledby')).toBe('tagesplan-title');
		expect(helpHref('tagesplan')).toBe('/einstellungen/hilfe#tagesplan');
		expect(within(section).getByRole('link', { name: 'Tagesplan' }).getAttribute('href')).toBe(
			'/tagesplan'
		);
		const content = text(section);
		expect(content).toMatch(/Schalter „Laufendes Vorhaben“/);
		expect(content).toMatch(/Die\s+Art allein bestimmt, was der Haken im Plan bedeutet/);
		expect(content).toMatch(/„für heute erledigt“; das\s+Ticket bleibt offen/);
		expect(content).toMatch(/„Nur für heute abhaken“/);
		expect(content).toMatch(/„Vorhaben abschließen …“ mit Rückfrage/);
		expect(content).toMatch(/„Aus“, „Vorschlagen“ oder „Automatisch übernehmen“/);
		// Pins are display only (PL-1): neither a source nor a reason to leave a ticket out.
		expect(content).toMatch(/Anheften ändert an den Vorschlägen nichts/);
		expect(content).toMatch(/angeheftetes Ticket, das heute fällig ist, schlägt der Plan vor wie/);
		expect(content).toMatch(/im Haushalt alle Mitglieder sofort/);
		expect(content).toMatch(/„Zum\s+Tagesplan“ im Menü/);
		expect(content).toMatch(/Vergangene Tage sind nur zu lesen, morgen kannst du schon planen/);
		expect(content).toMatch(/einen gemeinsamen für alle Mitglieder/);
		expect(content).toMatch(/seinen Inhalt zeigt der Plan nicht/);
	});

	it('explains the view "Erledigte": groups, loading more, filters and reopening (ADR-0066)', () => {
		const { container } = render(Page);
		const section = container.querySelector<HTMLElement>('section#erledigte')!;
		expect(section.getAttribute('aria-labelledby')).toBe('erledigte-title');
		expect(helpHref('erledigte')).toBe('/einstellungen/hilfe#erledigte');
		expect(within(section).getByRole('link', { name: 'Erledigte' }).getAttribute('href')).toBe(
			'/erledigt'
		);
		const content = text(section);
		expect(content).toMatch(/„Aufgaben“ zeigt nur offene Arbeit/);
		expect(content).toMatch(/Heute, Gestern, Diese Woche \(ab Montag\), Diesen Monat/);
		expect(content).toMatch(/„Erledigte ansehen →“ in „Aufgaben“/);
		expect(content).toMatch(/Projekt, Tag und Charm/);
		expect(content).toMatch(/„Mehr laden“/);
		expect(content).toMatch(/„Wieder öffnen“/);
		expect(content).toMatch(/„Rückgängig“ in der Meldung erledigt es\s+erneut/);
	});

	it('explains moving a due date: mouse, menu or "m", undo, series and touch (ADR-0053 §12)', () => {
		const { container } = render(Page);
		const section = container.querySelector<HTMLElement>('section#kalender')!;
		const content = text(section);
		expect(
			within(section)
				.getAllByRole('heading', { level: 4 })
				.map((heading) => heading.textContent?.trim())
		).toContain('Fälligkeit verschieben');
		expect(content).toMatch(/ziehst du ein offenes Ticket mit der Maus auf einen anderen Tag/);
		expect(content).toMatch(/„Fälligkeit verschieben …“ oder drückst m/);
		expect(content).toMatch(/„Rückgängig“/);
		expect(content).toMatch(/verschiebt sich nur dieses Ticket, nicht die Serie/);
		expect(content).toMatch(/wird nichts überschrieben/);
		expect(content).toMatch(/Touch-Geräten scrollt das Ziehen die Seite; dort geht es über/);
	});

	// Plan "Wiederholungen verständlich machen", part A: the dates come from the engine
	// (tests/unit/recurrence-examples.test.mjs checks them against the hook).
	it('explains recurrences with the examples the engine computes, without a year', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Wiederholungen' });
		const content = text(section);
		expect(helpHref('wiederholungen')).toBe('/einstellungen/hilfe#wiederholungen');
		expect(
			within(section)
				.getAllByRole('heading', { level: 4 })
				.map((heading) => heading.textContent?.trim())
		).toEqual([
			'Beispiel 1: Fester Rhythmus, jeden Montag, Vorlauf 3',
			'Beispiel 2: Nach Erledigung, alle 2 Wochen, Vorlauf 3',
			'Beispiel 3: „Jeden Termin einzeln anlegen“, täglich, Vorlauf 0',
			'Besondere Kalendertage',
			'Gut zu wissen'
		]);
		for (const term of [
			'Fester Rhythmus',
			'Nach Erledigung',
			'Vorlauf (Tage)',
			'Jeden Termin einzeln anlegen'
		]) {
			expect(within(section).getByText(term, { selector: 'dt' })).toBeTruthy();
		}
		for (const phrase of [
			'Das Ticket für Mo 05.10. erscheint am Fr 02.10.',
			'Erledigt am Mo 05.10.: Das nächste ist Mo 12.10. fällig und erscheint am Fr 09.10.',
			'Zu früh erledigt (Sa 03.10.): Nichts ändert sich',
			'Etwas später erledigt (Mi 07.10.): Auch dann erscheint das nächste wie geplant am Fr 09.10.',
			'Das Ticket für Mo 12.10. erscheint erst jetzt, am Sa 10.10.; fällig bleibt Mo 12.10.',
			'Es entsteht ein Ticket, fällig Mo 26.10. (schon 1 Tag überfällig); 12.10. und 19.10. gelten als übersprungen',
			'Das Ticket für Mo 02.11. erscheint am Fr 30.10.',
			'Mit Vorlauf 0 erscheint das Ticket am Montag selbst (Mo 05.10.)',
			'Erledigt am Mo 05.10.: Das nächste ist Mo 19.10. fällig und erscheint am Fr 16.10.',
			'Früher erledigt (Mi 30.09.): fällig Mi 14.10.',
			'Später erledigt (Do 22.10.): fällig Do 05.11.',
			'Das nächste Ticket erscheint sofort beim Erledigen am Mo 05.10. und ist Mi 07.10. fällig',
			'31.01. → 28.02. → 28.03. → 28.04.',
			'5 Tage nichts erledigt: ohne Schalter 1 offenes Ticket, mit Schalter 5',
			'ohne Schalter entsteht ein neues für heute (Fr 09.10.), 3 Termine gelten als übersprungen; mit Schalter entsteht nichts Neues',
			'„Alle nachholen“ legt 20 sofort und 6 in der nächsten Stunde an, „Nur ab heute“ nur das Ticket von heute (25 Termine übersprungen)',
			'Monatlich am 31.: 31.01., 28.02., 31.03., 30.04., im Schaltjahr 29.02.',
			'in Schaltjahren am 29.02., sonst am 28.02.',
			'Beginn Mi 30.09.: Fr 02.10., Mo 12.10., Fr 16.10., Mo 26.10.'
		]) {
			expect(content, phrase).toContain(phrase);
		}
		expect(content).not.toMatch(/20(2[6-9])/);
		// A date at the end of a sentence carries one full stop, not two.
		expect(content).not.toMatch(/\d\.\./);
		expect(section.querySelectorAll('table')).toHaveLength(0);
		expect(section.querySelectorAll('ol')).toHaveLength(3);
	});

	// Plan WV: what the next tickets get, the offer after a change, and why nothing asks when one
	// appears; since ADR-0022 addendum 9 the status is asked once, when the rule is created.
	it('explains the template of the next tickets and why nothing asks when one appears', () => {
		render(Page);
		const content = text(screen.getByRole('region', { name: 'Wiederholungen' }));
		for (const phrase of [
			'Folgetickets bekommen Titel, Beschreibung, Priorität, Projekt, Tags und den „Status beim Anlegen“ aus der Vorlage der Regel.',
			'Die Vorlage übernimmt beim Einrichten die Werte des Tickets.',
			'Mit welchem Status Folgetickets starten, fragt die App beim Anlegen der Regel („Folgetickets starten mit“: „Offen“, „Wie dieses Ticket“ oder ein anderer Status), ohne Vorauswahl',
			'am Ticket unter „Wiederholt sich“ („Künftige Tickets“, „Bearbeiten“)',
			'Ein Hinweis bietet „Auch für künftige Tickets übernehmen“ an',
			'Status und Fälligkeit gehören immer nur zum einzelnen Ticket.',
			'Eine Rückfrage beim Entstehen eines Tickets gibt es nicht: Folgetickets entstehen im Hintergrund zur festen Zeit',
			'gefragt wird einmal beim Anlegen der Regel'
		]) {
			expect(content, phrase).toContain(phrase);
		}
	});

	// Plan WV-3 (ADR-0022 addendum 10): "Unteraufgaben werden nicht kopiert" is replaced.
	it('explains the sub-tasks of the template, how they are taken over and what reopening does', () => {
		render(Page);
		const content = text(screen.getByRole('region', { name: 'Wiederholungen' }));
		for (const phrase of [
			'Kommentare und Quellen gehen nicht mit.',
			'Unteraufgaben legst du in der Vorlage fest (Liste „Unteraufgaben“, höchstens 20, je mit Titel und Priorität, sortierbar).',
			'Jedes neue Ticket der Serie bekommt sie als neue, offene Unteraufgaben ohne Fälligkeit, auch beim Nachholen und mit „Jeden Termin einzeln anlegen“.',
			'„Unteraufgaben dieses Tickets übernehmen“',
			'„Ergänzen“ oder „Ersetzen“',
			'Nimmt das Wiedereröffnen des zuletzt erledigten Tickets ein unberührtes Folgeticket zurück, gehen seine Unteraufgaben mit',
			'wenn du einem offenen Ticket der Serie eine Unteraufgabe hinzufügst; Entfernen oder Umbenennen einer Unteraufgabe änderst du dagegen direkt in der Vorlage.'
		]) {
			expect(content, phrase).toContain(phrase);
		}
		expect(content).not.toContain('Unteraufgaben, Kommentare und Quellen gehen nicht mit.');
	});

	it('explains the own inbox with examples for PowerShell and curl, the key as placeholder (ADR-0038)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Eigener Eingang (API)' });
		const content = text(section);
		expect(content).toContain('nur auf diesem Rechner erreichbar (127.0.0.1)');
		expect(content).toContain('Anfragen aus Webseiten lehnt die App ab');
		const powershell = within(section).getByRole('region', { name: 'Beispiel für PowerShell' });
		expect(text(powershell)).toContain('Invoke-RestMethod -Method Post');
		expect(text(powershell)).toContain('/api/byl/inbox/ingest');
		expect(text(powershell)).toContain('Bearer Platzhalter: ‹Zugangsschlüssel›');
		const curl = within(section).getByRole('region', {
			name: 'Beispiel für die Eingabeaufforderung'
		});
		expect(text(curl)).toContain('curl -X POST');
		for (const field of ['mode', 'text', 'external_id', 'title', 'channel', 'sent_at']) {
			expect(within(section).getAllByText(field).length, field).toBeGreaterThan(0);
		}
		expect(section.querySelectorAll('table')).toHaveLength(0);
	});

	it('explains WhatsApp Web honestly: unofficial, reads only, open tab, may need an update (ADR-0038)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'WhatsApp Web' });
		const content = text(section);
		for (const phrase of [
			'app\\erweiterung-whatsapp-web',
			'In den Eingang',
			'Automatisch (nur mit Stichwort)',
			'ist aus, bis du ihn einschaltest',
			'inoffiziell und nicht von WhatsApp',
			'sie sendet nie etwas, klickt nichts und ändert keine Nachricht',
			'solange der WhatsApp-Web-Tab offen ist',
			'Seitenstruktur nicht erkannt – Erweiterung braucht ein Update',
			'Telefonnummern nicht'
		]) {
			expect(content, phrase).toContain(phrase);
		}
		expect(
			within(section)
				.getByRole('link', { name: 'Kanäle → WhatsApp Web → Einrichten' })
				.getAttribute('href')
		).toBe('/einstellungen/kanaele?einrichten=whatsapp-web');
	});

	it('explains the Notion import: read only, copies, sharing, options and limits (ADR-0041)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Notion' });
		const content = text(section);
		for (const phrase of [
			'Die App liest nur',
			'schreibt nie etwas nach Notion',
			'ruft nie von selbst ab',
			'nur „Read content“',
			'BYL_NOTION_TOKEN',
			'neu-starten.bat',
			'„Verbindungen“ → „Verbindung hinzufügen“',
			'Seiteninhalt als Kopie mitnehmen',
			'500 Blöcke und 50.000 Zeichen',
			'Erledigte überspringen',
			'holt nur Einträge, die noch nicht im Eingang sind',
			'Workspace Owner',
			// Blocks with progress and result (fix 2026-09-30).
			'Die Übernahme läuft Quelle für Quelle in Blöcken',
			'„Nach diesem Block anhalten“',
			'„Im Eingang ansehen“',
			// Several sources, "Alle erneut abrufen", sub-pages, a further connection (NI-3).
			'eine oder mehrere Quellen',
			'eine Zeile je Quelle',
			'Scheitert eine Quelle (etwa nicht mehr freigegeben), laufen die anderen weiter',
			'„Alle erneut abrufen“ im Menü „•••“ der Karte',
			'„Unterseiten einbeziehen“',
			'höchstens 50 Unterseiten bis zur dritten Ebene',
			'BYL_NOTION_TOKEN_2'
		]) {
			expect(content, phrase).toContain(phrase);
		}
		expect(
			within(section)
				.getByRole('link', { name: 'Kanäle → Notion (Listen übernehmen) → Einrichten' })
				.getAttribute('href')
		).toBe('/einstellungen/kanaele?einrichten=notion');
	});

	it('explains GitHub: read only, the steps of the token, paths, first run and status (ADR-0050)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'GitHub' });
		const content = text(section);
		for (const phrase of [
			'Die App liest nur',
			'schreibt nie etwas nach GitHub',
			'„Settings“ → links ganz unten „Developer settings“ → „Personal access tokens“ → „Fine-grained tokens“ → „Generate new token“',
			'„Only select repositories“',
			'„Contents“ und „Pull requests“ auf „Read-only“',
			'„Metadata“ steht von selbst auf „Read-only“',
			'github_pat_',
			'BYL_GITHUB_TOKEN',
			'neu-starten.bat',
			'60 Anfragen je Stunde',
			'ROADMAP*',
			'docs/**/roadmap*',
			'Der erste Abruf merkt sich nur den Stand',
			'höchstens 20',
			'Stichwörter gibt es bei GitHub nicht',
			'„Seit Import geändert“',
			'„PR gemergt“',
			'Das Ticket ändert sich dadurch nie',
			'5 bis 60 Minuten',
			'ETag'
		]) {
			expect(content, phrase).toContain(phrase);
		}
		expect(
			within(section)
				.getByRole('link', { name: 'Kanäle → GitHub → Einrichten' })
				.getAttribute('href')
		).toBe('/einstellungen/kanaele?einrichten=github');
		expect(section.querySelectorAll('table')).toHaveLength(0);
	});

	it('explains the two ways of the token, the list and "Alle meine Repositorys" (ADR-0050, addendum of 2026-10-02)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'GitHub' });
		const content = text(section);
		for (const phrase of [
			'„Repository access“, zwei gleichwertige Wege: „All repositories“ (einfach: das Token darf alle deine Repositorys nur lesen; welche die App beobachtet, legst du in der App fest) oder „Only select repositories“ (strenger',
			'Der Unterschied ist die Reichweite des Tokens',
			'auch private und künftige',
			'Ändern oder schreiben kann das Token in beiden Fällen nichts',
			'„Add permissions“',
			'mehrere ankreuzen',
			'ohne Token ist das der einzige Weg',
			'„Alle meine Repositorys beobachten“',
			'ohne Forks, archivierte und die von Organisationen, höchstens 50',
			'höchstens stündlich neu, mit ETag',
			'„Ausschließen …“'
		]) {
			expect(content, phrase).toContain(phrase);
		}
		expect(
			within(section)
				.getByRole('link', { name: /^vorbelegten Token-Formular/ })
				.getAttribute('href')
		).toBe(
			'https://github.com/settings/personal-access-tokens/new?name=becauseyoulovejira&expires_in=90&contents=read&pull_requests=read'
		);
	});

	it('explains the folders: read only, references, paths, filters, first run, viewing and limits (ADR-0051)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Ordner' });
		const content = text(section);
		for (const phrase of [
			'Die App liest nur',
			'Verweis',
			'nicht als Kopie',
			'Zugangsdaten braucht es keine',
			'C:\\Daten\\Projekte',
			'\\\\NAS\\Projekte',
			'/home/anna/Projekte',
			'*.tmp',
			'node_modules/**',
			'Verknüpfungen (Symlinks, Junctions) folgt die App nicht',
			'Höchstens 10 Ordner je Verbindung',
			'Der erste Lauf merkt sich nur den Stand',
			'„Vorhandene Dateien übernehmen …“',
			'„Datei geändert: …“',
			'Stichwörter gibt es bei Ordnern nicht',
			'PDF, Bilder und Text im Browser',
			'nur im Browser auf diesem Rechner, nur für dich',
			'„Verschoben“',
			'Das Ticket ändert sich dadurch nie',
			'1 bis 60 Minuten',
			'200 MB',
			'2.000 Dateien',
			'100 neue',
			'nie ihr Inhalt'
		]) {
			expect(content, phrase).toContain(phrase);
		}
		expect(
			within(section)
				.getByRole('link', { name: 'Kanäle → Ordner → Einrichten' })
				.getAttribute('href')
		).toBe('/einstellungen/kanaele?einrichten=ordner');
		expect(section.querySelectorAll('table')).toHaveLength(0);
	});

	it('explains the backups and the emergency plan for a new machine, from the source of the Notfallkarte (ADR-0046)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Sicherung & Notfall' });
		const content = text(section);
		expect(content).toContain(PASSPHRASE_TEXTS.keep);
		expect(content).toContain('app\\wiederherstellen.bat');
		expect(content).toContain('WIEDERHERSTELLEN');
		const steps = within(section)
			.getAllByRole('listitem')
			.map((item) => text(item));
		for (const step of EMERGENCY_STEPS) {
			expect(
				steps.some((item) => item.includes(step.text)),
				step.title
			).toBe(true);
		}
		for (const loss of EMERGENCY_LOSSES) expect(content, loss).toContain(loss);
		for (const command of EMERGENCY_MANUAL) expect(content, command).toContain(command);
		expect(within(section).getByRole('link', { name: 'Notfallkarte' }).getAttribute('href')).toBe(
			'/notfallkarte'
		);
	});

	it('copies and moves the app only after stop.bat', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Betrieb' });
		expect(text(section)).toContain('Kopieren sichert und zieht sie um, aber erst nach stop.bat');
	});

	it('lists the frequent problems of the scripts in the words of their catalog (ADR-0048)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Betrieb' });
		expect(
			within(section).getByRole('heading', { name: 'Probleme mit den Skripten', level: 4 })
		).toBeTruthy();
		const problems = [...section.querySelectorAll('.script-problems details')];
		expect(
			problems.map((details) => text(details.querySelector('summary') as Element).trim())
		).toEqual(SCRIPT_PROBLEMS.map((problem) => problem.question));
		// The port of this app in the text, the free port as placeholder of the command.
		const busy = problems.find(
			(details) =>
				text(details.querySelector('summary') as Element).trim() === 'Der Port ist belegt'
		);
		expect(busy).toBeDefined();
		const port = page.url.port || '8090';
		const content = text(busy as Element);
		expect(content).toContain(`Port ${port} auf 127.0.0.1 ist belegt`);
		expect(content).toContain('byl-control.ps1 port');
		expect(content).toContain('freier Port');
		expect(text(section)).toContain('(J/N)');
	});

	it('explains the page "Speicher", its actions and what it never deletes (ADR-0047)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Speicher' });
		const content = text(section);
		for (const action of [
			'Datenbank verdichten',
			'Liegengebliebenes aufräumen',
			'Verworfene jetzt leeren'
		]) {
			expect(within(section).getByText(action).tagName, action).toBe('STRONG');
		}
		expect(content).toContain('Originaldateien an Quellen löscht die Seite nicht einzeln');
		expect(content).toContain('Die Sicherungen der App bleiben.');
		expect(content).toContain(
			'Quellen, die noch an Tickets im Papierkorb hängen, sind nicht dabei; über sie entscheidest du im Papierkorb.'
		);
		expect(
			within(section).getByRole('link', { name: 'Einstellungen → Speicher' }).getAttribute('href')
		).toBe('/einstellungen/speicher');
		expect(within(section).getByRole('link', { name: 'Papierkorb' }).getAttribute('href')).toBe(
			'/papierkorb'
		);
	});

	it('explains the protection of the app, the protocol and the passwords (ADR-0055)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Sicherheit' });
		const content = text(section);
		for (const point of [
			'Schutz vor Rateversuchen:',
			'Nur die eigenen Adressen:',
			'Verwaltung (/_/):',
			'Fehlgeschlagene Anmeldungen',
			'Zusätzliche Adressen'
		]) {
			expect(within(section).getByText(point).tagName, point).toBe('STRONG');
		}
		expect(content).toContain('Höchstens 10 Anmeldeversuche je Minute');
		expect(content).toContain('etwa über Tailscale');
		expect(content).toContain('admin-zuruecksetzen.bat');
		const pages = within(section).getAllByRole('link', { name: 'Einstellungen → Sicherheit' });
		expect(pages.map((link) => link.getAttribute('href'))).toEqual([
			'/einstellungen/sicherheit',
			'/einstellungen/sicherheit'
		]);
	});

	it('guides through the access in the home network, step by step (plan heimnetz)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Sicherheit' });
		const heading = within(section).getByRole('heading', { level: 4, name: 'Zugriff im Heimnetz' });
		expect(heading.id).toBe('heimnetz');
		const content = text(section);
		expect(within(section).getByText('Unverschlüsselt:').tagName).toBe('STRONG');
		expect(content).toContain('auch Passwörter');
		const guide = section.querySelector('ol');
		expect(guide).not.toBeNull();
		const steps = within(guide as HTMLElement)
			.getAllByRole('listitem')
			.map((step) => text(step));
		expect(steps).toHaveLength(6);
		expect(steps[0]).toContain('Netzwerkprofil „Privat“');
		expect(steps[1]).toContain('„Einstellung speichern“');
		expect(steps[2]).toContain('„Firewall-Regel anlegen …“');
		expect(steps[3]).toContain('neu-starten.bat');
		expect(steps[4]).toContain('„Adresse für andere Geräte“');
		expect(steps[5]).toContain('Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen');
		expect(
			within(guide as HTMLElement)
				.getByRole('link', { name: 'Einstellungen → System' })
				.getAttribute('href')
		).toBe('/einstellungen/system');
		expect(content).toContain(
			'die Seiten der Verwaltung (Konten verwalten, Sicherheit, Sicherung, Speicher und System)'
		);
		expect(content).toContain('nur auf diesem Rechner unter 127.0.0.1, auch für den Verwalter');
		expect(content).toContain('„Firewall-Regel entfernen …“');
	});

	it('names the access in the home network under "Betrieb", off by default (plan heimnetz)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Betrieb' });
		const content = text(section);
		expect(content).toMatch(/Andere Geräte im Heimnetz erreichen die App nur, wenn du es unter/);
		expect(
			within(section).getByRole('link', { name: 'Schritt für Schritt' }).getAttribute('href')
		).toBe('#heimnetz');
		expect(content).toContain('byl-control.ps1 lan-info');
		expect(content).toMatch(
			/start\.bat, die Startseite und die Browser-Erweiterung bleiben auf 127\.0\.0\.1/
		);
	});

	it('explains the household: founding, codes, rights, handing on, removing and leaving (ADR-0058)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Haushalt' });
		const terms = [...section.querySelectorAll('dt')].map((term) => term.textContent?.trim());
		expect(terms).toEqual([
			'Gründen',
			'Einladen und beitreten',
			'Rechte',
			'Inhaber übertragen',
			'Entfernen und austreten',
			'Auflösen'
		]);
		const content = text(section);
		// Dissolving (E7-4, ADR-0061 §5): only the owner, both ways, the name before deleting.
		expect(content).toMatch(/„Alles in meinen privaten Bereich übernehmen“/);
		expect(content).toMatch(
			/„Alles endgültig löschen“ geht erst, wenn du den Namen des Haushalts eintippst/
		);
		expect(content).not.toMatch(/späteren Version/);
		expect(content).toMatch(/Er gilt 7 Tage und für eine Person/);
		expect(content).toMatch(/immer „Code ungültig oder abgelaufen\.“/);
		expect(content).toMatch(/nur Rechte geben oder nehmen, die er selbst hat/);
		expect(content).toMatch(/bleiben die Einträge im Haushalt/);
		expect(content).toMatch(/der Zugriff darauf endet sofort/);
		expect(
			within(section).getByRole('link', { name: 'Einstellungen → Haushalt' }).getAttribute('href')
		).toBe('/einstellungen/haushalt');
		// The page "Konten und Verwalter" points here.
		const accounts = screen.getByRole('region', { name: 'Konten und Verwalter' });
		expect(within(accounts).getByRole('link', { name: 'Haushalt' }).getAttribute('href')).toBe(
			'/einstellungen/hilfe#haushalt'
		);
	});

	it('explains the areas: switch, creating, borders, links, channels and the trash (ADR-0059)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Bereiche Privat und Haushalt' });
		const terms = [...section.querySelectorAll('dt')].map((term) => term.textContent?.trim());
		expect(terms).toEqual([
			'Wechseln',
			'Anlegen',
			'Keine Verweise über Bereichsgrenzen',
			'Links in den anderen Bereich',
			'Kanäle',
			'Papierkorb im Haushalt',
			'Verschieben',
			'Vorschau und Fragen'
		]);
		const content = text(section);
		// Moving between the areas (E7-4, ADR-0061): the entries, who may, what comes along.
		expect(content).toMatch(/„In den Haushalt verschieben …“ bzw\. „Ins Private verschieben …“/);
		expect(content).toMatch(/Kommentare und Verlauf werden dann für alle Mitglieder sichtbar/);
		expect(content).toMatch(/„vorher PRIV-12“/);
		expect(content).toMatch(/Verbindungen bleiben immer privat/);
		expect(content).toMatch(/Ohne Haushalt gibt es keinen Umschalter/);
		expect(content).toMatch(/merkt sich dieses Gerät für dein Konto/);
		expect(content).toMatch(/ein Duplikat bleibt im Bereich des Originals/);
		expect(content).toMatch(/@HAUS/);
		expect(content).toMatch(/„Zum Bereich … gewechselt“/);
		expect(content).toMatch(/„Nur im privaten Bereich“/);
		expect(content).toMatch(/Recht „Endgültig löschen“/);
		// Without a household "Privat" and the "+" (addendum "+" of ADR-0059), with the way there.
		expect(content).toMatch(/Oben steht nur „Privat“ und daneben ein kleines „\+“/);
		expect(
			within(section).getByRole('link', { name: 'Einstellungen → Haushalt' }).getAttribute('href')
		).toBe('/einstellungen/haushalt');
		// The section "Haushalt" points here.
		const household = screen.getByRole('region', { name: 'Haushalt' });
		expect(
			within(household)
				.getByRole('link', { name: 'Bereiche Privat und Haushalt' })
				.getAttribute('href')
		).toBe('#bereiche');
	});

	it('explains accounts, the administrator, the channels per account and a second person (ADR-0056)', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Konten und Verwalter' });
		const terms = [...section.querySelectorAll('dt')].map((term) => term.textContent?.trim());
		expect(terms).toEqual([
			'Verwalter der App',
			'Konto anlegen',
			'Passwort vergessen',
			'Deaktivieren',
			'Haushalt ohne aktiven Inhaber',
			'Was andere sehen',
			'Kanäle für jedes Konto',
			'Zweite Person am selben Rechner'
		]);
		const content = text(section);
		expect(content).toMatch(/Mindestens ein aktives Konto bleibt immer Verwalter/);
		expect(content).toMatch(/zeigt es einmal an, mit „Kopieren“/);
		expect(content).toMatch(/Die E-Mail-Adresse sieht nur der Verwalter/);
		expect(content).toMatch(
			/Google Calendar, Telegram, Postfächer, Notion, GitHub und Ordner richtet nur der Verwalter ein/
		);
		expect(content).toMatch(/Die Anmeldung gilt je Browserprofil/);
		expect(
			within(section)
				.getByRole('link', { name: 'Einstellungen → Konten verwalten' })
				.getAttribute('href')
		).toBe('/einstellungen/konten');
		expect(
			within(section).getByRole('link', { name: 'Einstellungen → Mein Konto' }).getAttribute('href')
		).toBe('/einstellungen/konto');
	});

	it('links quietly to the overview of the form controls at its end (UI-1)', () => {
		const { container } = render(Page);
		const link = screen.getByRole('link', { name: 'Übersicht der Eingabeelemente' });
		expect(link.getAttribute('href')).toBe('/einstellungen/hilfe/elemente');
		// Not a section with a jump link, only a note after the last section.
		expect(link.closest('section')).toBeNull();
		expect(link.closest('p')?.classList.contains('note')).toBe(true);
		expect(container.querySelector('.help')?.lastElementChild).toBe(link.closest('p'));
	});
});

// A command, a script or a file of the folder app (KOB-1): what nobody but the administrator at the
// machine of the app may read on this page.
const COMMANDS =
	/\.bat\b|\.ps1\b|\.vbs\b|\bsetx\b|netsh|reg delete|Invoke-RestMethod|curl -X|powershell -|byl-control/i;

describe('help page in the context of the tab (KOB-1, ADR-0057)', () => {
	it('names no command for another account and says who runs the app', async () => {
		await useContext(MEMBER_CONTEXT);
		const { container } = render(Page);

		expect(text(container)).not.toMatch(COMMANDS);
		// Only the example of the short syntax is code, and nothing can be copied.
		expect(screen.queryByRole('button', { name: /Kopieren/ })).toBeNull();
		const operations = screen.getByRole('region', { name: 'Betrieb' });
		expect(text(operations).trim()).toBe(
			'Betrieb Hinweis: Betrieb und Sicherung übernimmt der Verwalter.'
		);
		const backups = screen.getByRole('region', { name: 'Sicherung & Notfall' });
		expect(text(backups).trim()).toBe(
			'Sicherung & Notfall Hinweis: Betrieb und Sicherung übernimmt der Verwalter.'
		);
		const access = screen.getByRole('region', { name: 'Kanäle und Zugangsdaten' });
		expect(text(access)).toMatch(
			/Zugangsdaten als Windows-Variable setzen Hinweis: Bitte den Verwalter fragen\./
		);
		const inbox = screen.getByRole('region', { name: 'Eigener Eingang (API)' });
		expect(text(inbox)).toMatch(/Bitte den Verwalter fragen\./);
		// Every section stays, with its jump link.
		for (const section of HELP_SECTIONS) {
			expect(container.querySelector(`section#${section.id}`), section.id).not.toBeNull();
		}
	});

	it('shows the administrator on another device the way to the machine of the app instead of commands', async () => {
		await useContext(REMOTE_CONTEXT);
		const { container } = render(Page);

		expect(text(container)).not.toMatch(COMMANDS);
		const operations = screen.getByRole('region', { name: 'Betrieb' });
		expect(text(operations)).toContain(
			'Nur direkt am PC verfügbar, auf dem becauseyoulovejira läuft (dort über http://127.0.0.1:8090 öffnen).'
		);
		const backups = text(screen.getByRole('region', { name: 'Sicherung & Notfall' }));
		// What a backup is and how to set it up stays; restoring and the emergency plan go to the PC.
		expect(backups).toMatch(/Einrichten/);
		expect(backups).toMatch(/Nur direkt am PC verfügbar/);
		expect(backups).not.toMatch(/Neuer Rechner, Schritt für Schritt/);
	});

	it('says "Auf diesem Server nicht verfügbar." instead of the scripts on a server that is not Windows', async () => {
		await useContext({ ...PC_CONTEXT, platform: 'linux', scripts: false });
		render(Page);

		const operations = text(screen.getByRole('region', { name: 'Betrieb' }));
		expect(operations).toContain('Auf diesem Server nicht verfügbar.');
		expect(operations).not.toMatch(/start\.bat/);
		// setx stays for the administrator at the machine of the app (the note of the server's system
		// names the way there).
		expect(text(screen.getByRole('region', { name: 'Kanäle und Zugangsdaten' }))).toMatch(/setx/);
	});

	it('shows no command and no sentence for another account while the context loads', async () => {
		await useContext('pending');
		const { container } = render(Page);

		expect(text(container)).not.toMatch(COMMANDS);
		expect(text(screen.getByRole('region', { name: 'Betrieb' })).trim()).toBe('Betrieb');
	});
});
