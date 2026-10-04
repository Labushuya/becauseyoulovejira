// Catalog "Kanal hinzufügen" (ADR-0026 §3) for the administrator of the app and for every other
// account (ADR-0056 §5): only the administrator sets up channels with access data of this machine or
// folders; another account reads why and keeps the tiles it can use (Proton per file, WhatsApp Web
// with its own key).

import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import ChannelCatalog, { type CatalogEntry } from './ChannelCatalog.svelte';

const hrefOf = (entry: CatalogEntry) =>
	`/einstellungen/kanaele?einrichten=${entry}` as ResolvedPathname;

function tiles(): (string | undefined)[] {
	const catalog = screen.getByRole('region', { name: 'Kanal hinzufügen' });
	return within(catalog)
		.getAllByRole('heading', { level: 4 })
		.map((heading) => heading.textContent?.trim());
}

describe('channel catalog', () => {
	it('offers every service to the administrator, without a hint', () => {
		render(ChannelCatalog, { props: { connections: [], hrefOf, admin: true } });
		expect(tiles()).toEqual([
			'Google Calendar',
			'Telegram-Bot',
			'Web.de',
			'Gmail',
			'GitHub',
			'Ordner',
			'Proton Mail',
			'Notion (Listen übernehmen)',
			'WhatsApp Web'
		]);
		expect(screen.queryByText('Kanäle mit Zugangsdaten richtet der Verwalter ein')).toBeNull();
	});

	it('says to every other account what it can use, with the two tiles left', () => {
		render(ChannelCatalog, { props: { connections: [], hrefOf, admin: false } });
		expect(tiles()).toEqual(['Proton Mail', 'WhatsApp Web']);
		const hint = screen
			.getByText('Kanäle mit Zugangsdaten richtet der Verwalter ein')
			.closest('[data-tone]');
		expect(hint?.getAttribute('data-tone')).toBe('info');
		const text = (hint?.textContent ?? '').replace(/\s+/g, ' ');
		expect(text).toMatch(/Google Calendar, Telegram, Postfächer, Notion, GitHub und Ordner/);
		expect(text).toMatch(
			/den eigenen Eingang mit deinem eigenen Zugangsschlüssel und damit WhatsApp Web/
		);
		expect(
			within(hint as HTMLElement)
				.getByRole('link', { name: 'Was darf welches Konto?' })
				.getAttribute('href')
		).toBe('/einstellungen/hilfe#konten');
	});

	it('offers no connection in the household area, only "Nur im privaten Bereich" (E7-3, ADR-0059 §5)', () => {
		render(ChannelCatalog, { props: { connections: [], hrefOf, admin: true, household: true } });
		const catalog = screen.getByRole('region', { name: 'Kanal hinzufügen' });
		const hint = within(catalog)
			.getByText('Verbindungen gibt es nur im privaten Bereich')
			.closest('[data-tone]');
		expect(hint?.getAttribute('data-tone')).toBe('info');
		expect(
			within(hint as HTMLElement)
				.getByRole('link', { name: 'Mehr zu den Bereichen' })
				.getAttribute('href')
		).toBe('/einstellungen/hilfe#bereiche');
		// Every service and WhatsApp Web stay private; Proton per file works in the household.
		expect(within(catalog).getAllByText('Nur im privaten Bereich')).toHaveLength(8);
		expect(within(catalog).queryAllByRole('link', { name: /^(Weitere )?[Ee]inrichten/ })).toEqual(
			[]
		);
		expect(within(catalog).getByRole('link', { name: 'Anleitung: Proton Mail' })).toBeTruthy();
	});
});
