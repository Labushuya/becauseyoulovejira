// Page test of the settings page "Datei-Importe" (plan EH-7): where the files come from (Proton and
// Gmail as .eml, calendar files, WhatsApp exports; folded) above the three lists of keywords of the
// file imports. The data layer of the keywords and the flags are fakes; the store is real.

import { render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_IMPORT_KEYWORDS } from '$lib/domain/keywords';
import type { ImportKeywordsData } from '$lib/stores/import-keywords.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import Page from './+page.svelte';

const mocks = vi.hoisted(() => ({ data: null as unknown, flags: null as unknown }));

vi.mock('$lib/auth.svelte', () => ({ auth: { ensureValid: () => true, logout: vi.fn() } }));
vi.mock('$lib/stores/import-keywords.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	importKeywordsData: () => mocks.data
}));
vi.mock('$lib/stores/flags.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getFlagStore: () => mocks.flags
}));

beforeEach(() => {
	document.body.innerHTML = '';
	mocks.flags = new FlagStore();
	mocks.data = {
		load: vi.fn<ImportKeywordsData['load']>(async () => EMPTY_IMPORT_KEYWORDS),
		save: vi.fn<ImportKeywordsData['save']>(async (settings) => settings)
	} satisfies ImportKeywordsData;
});

describe('settings page "Datei-Importe"', () => {
	it('explains where the files come from and shows the three lists of keywords', async () => {
		render(Page);
		await vi.waitFor(() =>
			expect(screen.getAllByRole('group', { name: 'Stichwörter' })).toHaveLength(3)
		);
		await tick();

		const ways = screen.getByRole('region', { name: 'Woher die Dateien kommen' });
		expect(
			[...ways.querySelectorAll('summary')].map((summary) => summary.textContent?.trim())
		).toEqual([
			'Mails aus Proton (.eml)',
			'Mails aus Gmail (.eml)',
			'Kalenderdateien (.ics)',
			'WhatsApp-Chats'
		]);
		expect([...ways.querySelectorAll('details')].every((details) => !details.open)).toBe(true);
		expect(
			within(ways)
				.getByRole('link', { name: /mail\.proton\.me/ })
				.getAttribute('href')
		).toBe('https://mail.proton.me');
		expect(ways.textContent).toMatch(/Nachricht herunterladen/);
		expect(within(ways).getByRole('link', { name: 'Eingang' }).getAttribute('href')).toBe(
			'/eingang'
		);
		expect(screen.getByRole('heading', { name: 'Stichwörter für Datei-Importe' })).toBeTruthy();
		expect(document.title).toBe('Datei-Importe · Einstellungen · becauseyoulovejira');
	});
});
