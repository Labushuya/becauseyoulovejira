// Settings "Hilfe" (plan EH-9, §3.10): jump links to eight sections, the shortcuts of every context
// from the one source, the short syntax with its tokens, the access data moved here from "Kanäle",
// the own inbox with examples and WhatsApp Web (ADR-0038), the frequent questions as <details> and
// the operation of the app. No table (description lists).

import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { page } from '$app/state';
import { RESTART_NEEDED } from '$lib/guidance/texts';
import { HELP_SECTIONS, SETTINGS_SECTIONS, helpHref } from '$lib/settings-sections';
import Page from './+page.svelte';

function text(element: Element): string {
	return (element.textContent ?? '').replace(/\s+/g, ' ');
}

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

	it('jumps to nine sections that exist on the page', () => {
		const { container } = render(Page);

		const jump = within(screen.getByRole('navigation', { name: 'Auf dieser Seite' }));
		const links = jump.getAllByRole('link');
		expect(links.map((link) => link.textContent?.trim())).toEqual([
			'Tastaturkürzel',
			'Kurzsyntax',
			'Wiederholungen',
			'Kanäle und Zugangsdaten',
			'Eigener Eingang (API)',
			'WhatsApp Web',
			'Notion',
			'Häufige Fragen',
			'Betrieb'
		]);
		for (const link of links) {
			const id = link.getAttribute('href')?.slice(1) ?? '';
			const section = container.querySelector(`section#${id}`);
			expect(section, id).not.toBeNull();
			expect(screen.getByRole('region', { name: link.textContent?.trim() })).toBe(section);
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
		).toEqual(['Überall', 'Liste', 'Panel', 'Dialoge', 'Editor']);
		expect(text(section)).toMatch(/Schnellerfassung öffnen/);
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
	});

	it('answers the frequent questions in folded details', () => {
		const { container } = render(Page);
		const section = screen.getByRole('region', { name: 'Häufige Fragen' });
		const questions = [...section.querySelectorAll('details > summary')].map((summary) =>
			summary.textContent?.trim()
		);
		expect(questions).toEqual([
			'Warum kommt meine Mail nicht an?',
			'Wo sind meine Zugangsdaten gespeichert?',
			`Was bedeutet „${RESTART_NEEDED.title}“?`,
			'Wie widerrufe ich einen Zugang?',
			'Warum sehe ich im Admin-Bereich andere Konten?',
			'Wie ändere ich Spalten und ihre Breite?',
			'Wie arbeite ich mit Unteraufgaben?',
			'Wie hole ich ein gelöschtes Ticket zurück?',
			'Was steht im Menü „•••“ eines Tickets?',
			'Wie dupliziere ich ein Ticket?',
			'Wie gliedere ich ein Projekt in Unterprojekte?',
			'Wie formatiere ich Beschreibungen und Kommentare?',
			'Wie ordne ich Kommentare und hebe einen hervor?'
		]);
		// Comments (ADR-0044): order, the pinned comment with "Rückgängig", folding.
		expect(text(section)).toContain('„Neueste zuerst“ (Standard) oder „Älteste zuerst“');
		expect(text(section)).toContain('höchstens einen angepinnten Kommentar');
		expect(text(section)).toContain('„Weiterlesen“');
		expect(section.querySelectorAll('details[open]')).toHaveLength(0);
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
		// Sub projects (ADR-0034): creating, own code, filter, numbers, archive.
		expect(text(section)).toContain('„Unterprojekt anlegen“');
		expect(text(section)).toContain('GART-3');
		expect(text(section)).toContain('„Unterprojekte einbeziehen“');
		expect(text(section)).toContain('„davon direkt“');
		expect(text(section)).toContain('„Mit Oberprojekt zurückholen“');
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
		// ADR-0043: the same from the dashboard, only on this machine and for the owner, no "Beenden".
		const system = within(section).getByRole('link', { name: 'Einstellungen → System' });
		expect(system.getAttribute('href')).toBe('/einstellungen/system');
		expect(content).toMatch(
			/nur im Browser auf dem Rechner der App und nur mit dem App-Konto, das bei der Einrichtung zuerst angelegt wurde/
		);
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
			'Die Übernahme läuft in Blöcken',
			'„Nach diesem Block anhalten“',
			'„Im Eingang ansehen“'
		]) {
			expect(content, phrase).toContain(phrase);
		}
		expect(
			within(section)
				.getByRole('link', { name: 'Kanäle → Notion (Listen übernehmen) → Einrichten' })
				.getAttribute('href')
		).toBe('/einstellungen/kanaele?einrichten=notion');
	});
});
