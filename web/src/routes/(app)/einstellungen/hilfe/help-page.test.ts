// Settings "Hilfe" (plan EH-9, §3.10): jump links to five sections, the shortcuts of every context
// from the one source, the short syntax with its tokens, the access data moved here from "Kanäle",
// the frequent questions as <details> and the operation of the app. No table (description lists).

import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
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

	it('jumps to five sections that exist on the page', () => {
		const { container } = render(Page);

		const jump = within(screen.getByRole('navigation', { name: 'Auf dieser Seite' }));
		const links = jump.getAllByRole('link');
		expect(links.map((link) => link.textContent?.trim())).toEqual([
			'Tastaturkürzel',
			'Kurzsyntax',
			'Kanäle und Zugangsdaten',
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
		expect(content).toMatch(/stop\.bat und dann start\.bat/);
		expect(within(section).getByRole('link', { name: 'Kanäle' }).getAttribute('href')).toBe(
			'/einstellungen/kanaele'
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
			'Wo sind meine Zugangsdaten gespeichert?',
			`Was bedeutet „${RESTART_NEEDED.title}“?`,
			'Wie widerrufe ich einen Zugang?',
			'Warum sehe ich im Admin-Bereich andere Konten?',
			'Wie ändere ich Spalten und ihre Breite?',
			'Wie arbeite ich mit Unteraufgaben?',
			'Wie hole ich ein gelöschtes Ticket zurück?',
			'Wie gliedere ich ein Projekt in Unterprojekte?',
			'Wie formatiere ich Beschreibungen und Kommentare?'
		]);
		expect(section.querySelectorAll('details[open]')).toHaveLength(0);
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

	it('names restart, logs and the administration under "Betrieb"', () => {
		render(Page);
		const section = screen.getByRole('region', { name: 'Betrieb' });
		const content = text(section);
		expect(content).toMatch(/stop\.bat, dann start\.bat im Ordner app/);
		expect(content).toMatch(/byl-mail\.log/);
		// ADR-0029 section 8: the glass costs GPU time; the switch helps over a remote desktop.
		expect(content).toMatch(
			/Remote-Desktop, schalte unter Einstellungen → Darstellung den Glas-Effekt aus/
		);
		const admin = within(section).getByRole('link', { name: /Verwaltung/ });
		expect(admin.getAttribute('href')).toBe('/_/');
		expect(admin.getAttribute('rel')).toBe('external');
	});
});
