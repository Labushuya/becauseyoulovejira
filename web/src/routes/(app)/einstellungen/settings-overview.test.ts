// Component tests of the overview of the settings (EU-1, ADR-0078): the pages in the groups of the
// navigation, each row named by its page and described by its sentence, the marks of the navigation
// (open setups at "Kanäle", "nur am PC" for the pages of the administrator on another device) and
// the pages a server has, in every context of the matrix of KOB-1 (ADR-0057). The host store and
// the store of the open setups are fakes; the context is set like an answer of the server.

import { render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_SECTIONS } from '$lib/settings-sections';
import { MEMBER_CONTEXT, PC_CONTEXT, REMOTE_CONTEXT, useContext } from '$lib/test/context';
import groupListSource from '$lib/components/SettingsGroupList.svelte?raw';
import Overview from './+page.svelte';
import overviewSource from './+page.svelte?raw';

const mocks = vi.hoisted(() => ({
	// Operating system of the server (host store of the (app) layout); null: no store.
	platform: null as string | null,
	// Open setups of the account (store of the (app) layout); null: no store.
	openSetups: null as number | null
}));

vi.mock('$lib/stores/host.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	findHostStore: () => (mocks.platform === null ? null : { platform: mocks.platform })
}));
vi.mock('$lib/stores/open-setups.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	findOpenSetupsStore: () => (mocks.openSetups === null ? null : { count: mocks.openSetups })
}));

async function renderOverview() {
	const result = render(Overview);
	await tick();
	return result;
}

/** Each list of the overview: the text of its heading ('' for the help) and the names of its rows. */
function groups(): [string, string[]][] {
	return screen.getAllByRole('list').map((list) => [
		(list.getAttribute('aria-labelledby') ?? '')
			.split(' ')
			.filter(Boolean)
			.map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim())
			.join(' '),
		within(list)
			.getAllByRole('link')
			.map((link) => {
				const name = link.getAttribute('aria-labelledby') ?? '';
				return document.getElementById(name)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
			})
	]);
}

const WORK: [string, string[]] = [
	'Eingang und Tickets',
	['Kanäle', 'Datei-Importe', 'Tags', 'Tickets']
];
const PERSONAL: [string, string[]] = ['Persönlich', ['Darstellung', 'Haushalt', 'Mein Konto']];
const HELP: [string, string[]] = ['', ['Hilfe']];

beforeEach(async () => {
	mocks.platform = 'windows';
	mocks.openSetups = null;
	document.body.innerHTML = '';
	await useContext(PC_CONTEXT);
});

describe('overview of the settings (EU-1)', () => {
	it('lists every page in its group for the administrator at the machine of the app', async () => {
		await renderOverview();

		expect(groups()).toEqual([
			WORK,
			PERSONAL,
			['Verwaltung', ['Konten verwalten', 'Sicherheit', 'Sicherung', 'Speicher', 'System']],
			HELP
		]);
		// The names of the groups are headings below the heading of the page.
		expect(
			screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent?.trim())
		).toEqual(['Eingang und Tickets', 'Persönlich', 'Verwaltung']);
		expect(screen.queryByText('nur am PC')).toBeNull();
	});

	it('names each row by its page, leads there and describes it by its sentence', async () => {
		await renderOverview();

		for (const section of SETTINGS_SECTIONS) {
			const link = screen.getByRole('link', {
				name: section.label,
				description: section.description
			});
			expect(link.getAttribute('href')).toBe(section.href);
			expect(within(link).getByText(section.description)).toBeTruthy();
		}
	});

	it('marks no page as current: the overview is no page of the navigation', async () => {
		await renderOverview();

		for (const link of screen.getAllByRole('link')) {
			expect(link.hasAttribute('aria-current')).toBe(false);
		}
	});

	it('marks the group "Verwaltung" "nur am PC" for the administrator on another device (KOB-1)', async () => {
		await useContext(REMOTE_CONTEXT);
		await renderOverview();

		expect(groups()).toEqual([
			WORK,
			PERSONAL,
			[
				'Verwaltung nur am PC',
				[
					'Konten verwalten nur am PC',
					'Sicherheit nur am PC',
					'Sicherung nur am PC',
					'Speicher nur am PC',
					'System nur am PC'
				]
			],
			HELP
		]);
		// Visible once at the heading of the group; each row keeps it in its name for screen readers.
		const admin = screen.getByRole('list', { name: 'Verwaltung nur am PC' });
		for (const mark of within(admin).getAllByText('nur am PC')) {
			expect(mark.classList.contains('visually-hidden')).toBe(true);
		}
		// The pages stay reachable; they show the way to the machine of the app.
		expect(
			within(admin).getByRole('link', { name: 'Sicherheit nur am PC' }).getAttribute('href')
		).toBe('/einstellungen/sicherheit');
	});

	it.each([
		['every other account (ADR-0056 §7)', MEMBER_CONTEXT],
		['a tab whose context is not known yet (KOB-1)', 'pending' as const]
	])('leaves the group "Verwaltung" out for %s', async (_who, context) => {
		await useContext(context);
		await renderOverview();

		expect(groups()).toEqual([WORK, PERSONAL, HELP]);
		expect(screen.queryByText('Verwaltung')).toBeNull();
		expect(screen.queryByRole('link', { name: /Konten verwalten/ })).toBeNull();
	});

	it('shows the group once the context is known', async () => {
		await useContext('pending');
		await renderOverview();
		expect(groups().map(([name]) => name)).toEqual(['Eingang und Tickets', 'Persönlich', '']);

		await useContext(PC_CONTEXT);
		await tick();
		expect(groups().map(([name]) => name)).toEqual([
			'Eingang und Tickets',
			'Persönlich',
			'Verwaltung',
			''
		]);
	});

	it.each([
		['linux', ['Konten verwalten', 'Sicherheit', 'Speicher']],
		['container', ['Konten verwalten', 'Sicherheit', 'Speicher']],
		['windows', ['Konten verwalten', 'Sicherheit', 'Sicherung', 'Speicher', 'System']]
	])('lists only the pages a server on %s has (ADR-0043, ADR-0046)', async (platform, pages) => {
		mocks.platform = platform;
		await renderOverview();

		expect(groups()[2]).toEqual(['Verwaltung', pages]);
	});

	it('counts the open setups at "Kanäle" like the navigation (KE-1, ADR-0076)', async () => {
		mocks.openSetups = 2;
		await renderOverview();

		const link = screen.getByRole('link', { name: 'Kanäle (2 Einrichtungen offen)' });
		expect(link.getAttribute('href')).toBe('/einstellungen/kanaele');
		expect(link.querySelector('.count [aria-hidden="true"]')?.textContent).toBe('2');
		// Only "Kanäle" carries it.
		expect(document.querySelectorAll('.count')).toHaveLength(1);
	});

	it.each([
		['nothing is open', 0],
		['the state is not known', null]
	])('shows no number while %s', async (_case, count) => {
		mocks.openSetups = count;
		await renderOverview();

		expect(screen.getByRole('link', { name: 'Kanäle' })).toBeTruthy();
		expect(document.querySelector('.count')).toBeNull();
	});

	it('keeps the rows targets of the phone frame that wrap long texts instead of scrolling sideways', () => {
		// Rows at least as high as the target of the phone frame (48 px), text in readable sizes.
		expect(groupListSource).toMatch(/\n\ta \{[^}]*min-height: var\(--phone-target\)/);
		expect(groupListSource).toMatch(/\.description \{[^}]*font-size: var\(--font-size-control\)/);
		// Names and sentences wrap; the overview is one column that never gets wider than the page.
		expect(groupListSource).toMatch(/\.name,\s*\.description \{[^}]*overflow-wrap: anywhere/);
		expect(overviewSource).toMatch(/grid-template-columns: minmax\(0, 1fr\)/);
		expect(overviewSource).toMatch(/<title>Einstellungen · becauseyoulovejira<\/title>/);
	});
});
