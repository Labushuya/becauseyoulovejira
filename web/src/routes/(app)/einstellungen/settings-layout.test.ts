// Component tests of the settings area (ADR-0026 section 1, plan EH-1): the switch without a
// current view, the navigation with the way back, breadcrumbs, the heading as focus target after a
// change of the page, the forward from /einstellungen and the full width. Page state, navigation
// and the stores of the (app) layout are fakes; the way back is the real store. The pages of the
// administrator follow the context of the tab (KOB-1, ADR-0057), set like an answer of the server.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LAST_VIEW_KEY, LastViewStore } from '$lib/stores/last-view.svelte';
import { MEMBER_CONTEXT, PC_CONTEXT, REMOTE_CONTEXT, useContext } from '$lib/test/context';
import Layout from './+layout.svelte';
import { load } from './+page';

type Navigation = { from: { url: URL } | null; to: { url: URL } | null };

const mocks = vi.hoisted(() => ({
	page: { url: new URL('http://127.0.0.1:8090/einstellungen/kanaele') },
	afterNavigate: [] as ((navigation: Navigation) => void)[],
	stored: {} as Record<string, string>,
	lastView: null as unknown,
	// Operating system of the server (host store of the (app) layout); null: no store.
	platform: null as string | null
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$app/navigation', () => ({
	afterNavigate: (callback: (navigation: Navigation) => void) => {
		mocks.afterNavigate.push(callback);
	}
}));
vi.mock('$lib/stores/ticket-list.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketListStore: () => ({
		newInProjects: 2,
		find: (id: string) => (id === 'abc123def456ghi' ? { key: 'BYL-12' } : null)
	})
}));
vi.mock('$lib/stores/inbox.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getInboxStore: () => ({ newCount: 3 })
}));
vi.mock('$lib/stores/last-view.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getLastViewStore: () => mocks.lastView
}));
vi.mock('$lib/stores/host.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	findHostStore: () => (mocks.platform === null ? null : { platform: mocks.platform })
}));

const CONTENT = 'Inhalt der Unterseite';

async function renderSettings(path: string, remembered: string | null = null) {
	mocks.page.url = new URL(path, 'http://127.0.0.1:8090');
	mocks.stored = remembered === null ? {} : { [LAST_VIEW_KEY]: remembered };
	mocks.lastView = new LastViewStore(
		() => ({
			getItem: (key) => mocks.stored[key] ?? null,
			setItem: (key, value) => void (mocks.stored[key] = value)
		}),
		() => 'http://127.0.0.1:8090'
	);
	const children = createRawSnippet(() => ({ render: () => `<p>${CONTENT}</p>` }));
	const result = render(Layout, { props: { children } });
	await tick();
	return result;
}

beforeEach(async () => {
	mocks.afterNavigate.length = 0;
	mocks.platform = null;
	document.body.innerHTML = '';
	// The administrator on the machine of the app: every page with its content.
	await useContext(PC_CONTEXT);
});

describe('settings layout', () => {
	it('shows the switch without a current view, with the numbers of the app', async () => {
		await renderSettings('/einstellungen/kanaele');

		const views = within(screen.getByRole('navigation', { name: 'Ansicht' }));
		for (const link of views.getAllByRole('link')) {
			expect(link.hasAttribute('aria-current')).toBe(false);
		}
		expect(views.getByRole('link', { name: 'Aufgaben' }).getAttribute('href')).toBe('/');
		expect(views.getByRole('link', { name: 'Eingang (3 neu)' }).getAttribute('href')).toBe(
			'/eingang'
		);
		expect(views.getByRole('link', { name: 'Projekte (2 neu)' })).toBeTruthy();
	});

	it('offers the pages in a named navigation and marks the current one', async () => {
		await renderSettings('/einstellungen/datei-importe');

		const nav = within(screen.getByRole('navigation', { name: 'Einstellungen' }));
		const pages = nav.getAllByRole('listitem').map((item) => within(item).getByRole('link'));
		expect(pages.map((link) => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
			['Kanäle', '/einstellungen/kanaele'],
			['Datei-Importe', '/einstellungen/datei-importe'],
			['Tags', '/einstellungen/tags'],
			['Tickets', '/einstellungen/tickets'],
			['Darstellung', '/einstellungen/darstellung'],
			['Haushalt', '/einstellungen/haushalt'],
			['Mein Konto', '/einstellungen/konto'],
			['Konten verwalten', '/einstellungen/konten'],
			['Sicherheit', '/einstellungen/sicherheit'],
			['Sicherung', '/einstellungen/sicherung'],
			['Speicher', '/einstellungen/speicher'],
			['System', '/einstellungen/system'],
			['Hilfe', '/einstellungen/hilfe']
		]);
		expect(pages[0]?.hasAttribute('aria-current')).toBe(false);
		expect(pages[1]?.getAttribute('aria-current')).toBe('page');
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Datei-Importe');
		expect(screen.getByText(CONTENT)).toBeTruthy();
	});

	it.each([
		['every other account (ADR-0056 §7)', MEMBER_CONTEXT],
		['a tab whose context is not known yet (KOB-1)', 'pending' as const]
	])('leaves out the pages of the administrator for %s', async (_who, context) => {
		await useContext(context);
		mocks.platform = 'windows';
		await renderSettings('/einstellungen/konto');

		const nav = within(screen.getByRole('navigation', { name: 'Einstellungen' }));
		const pages = nav.getAllByRole('listitem').map((item) => within(item).getByRole('link'));
		expect(pages.map((link) => link.textContent?.trim())).toEqual([
			'Kanäle',
			'Datei-Importe',
			'Tags',
			'Tickets',
			'Darstellung',
			// The household is a page of every account on every device (ADR-0058).
			'Haushalt',
			'Mein Konto',
			'Hilfe'
		]);
		expect(nav.queryByRole('link', { name: /Konten verwalten/ })).toBeNull();
		expect(nav.queryByRole('link', { name: /Sicherheit/ })).toBeNull();
		// The group "Verwaltung" is not there at all, not even its heading (UI-1).
		expect(nav.queryByRole('list', { name: /Verwaltung/ })).toBeNull();
		expect(nav.queryByText('Verwaltung')).toBeNull();
	});

	it('marks the pages of the administrator "nur am PC" on another device (KOB-1)', async () => {
		await useContext(REMOTE_CONTEXT);
		mocks.platform = 'windows';
		await renderSettings('/einstellungen/konto');

		const nav = within(screen.getByRole('navigation', { name: 'Einstellungen' }));
		const pages = nav.getAllByRole('listitem').map((item) => within(item).getByRole('link'));
		expect(pages.map((link) => link.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Kanäle',
			'Datei-Importe',
			'Tags',
			'Tickets',
			'Darstellung',
			'Haushalt',
			'Mein Konto',
			'Konten verwalten nur am PC',
			'Sicherheit nur am PC',
			'Sicherung nur am PC',
			'Speicher nur am PC',
			'System nur am PC',
			'Hilfe'
		]);
		// The mark stands once, visibly, at the heading of the group (UI-1); each link keeps it in
		// its name for screen readers.
		const admin = nav.getByRole('list', { name: 'Verwaltung nur am PC' });
		expect(within(admin).getByRole('link', { name: 'Konten verwalten nur am PC' })).toBeTruthy();
		for (const mark of within(admin).getAllByText('nur am PC')) {
			expect(mark.classList.contains('visually-hidden')).toBe(true);
		}
		expect(nav.getByRole('list', { name: 'Persönlich' })).toBeTruthy();
	});

	it('shows the way to the machine of the app instead of a page of the administrator on another device (KOB-1)', async () => {
		await useContext(REMOTE_CONTEXT);
		await renderSettings('/einstellungen/system');

		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('System');
		expect(screen.getByText('Nur direkt am PC')).toBeTruthy();
		expect(
			screen.getByText(
				'Nur direkt am PC verfügbar, auf dem becauseyoulovejira läuft (dort über http://127.0.0.1:8090 öffnen).'
			)
		).toBeTruthy();
		// The page itself never mounts, so it asks the server nothing.
		expect(screen.queryByText(CONTENT)).toBeNull();
		expect(document.body.textContent).not.toMatch(/\.bat|\.ps1/);
	});

	it('says "Nur für den Verwalter" for a page of the administrator opened by another account (KOB-1)', async () => {
		await useContext(MEMBER_CONTEXT);
		await renderSettings('/einstellungen/konten');

		expect(screen.getByText('Nur für den Verwalter')).toBeTruthy();
		expect(
			screen.getByText('Diese Seite gehört zur Verwaltung der App. Bitte den Verwalter fragen.')
		).toBeTruthy();
		expect(screen.queryByText(CONTENT)).toBeNull();
		expect(document.querySelector('.section-message.error')).toBeNull();
	});

	it('shows nothing of a page of the administrator while the context loads, then the page (KOB-1)', async () => {
		await useContext('pending');
		await renderSettings('/einstellungen/speicher');

		expect(screen.getByRole('status').textContent).toBe('Wird geladen …');
		expect(screen.queryByText(CONTENT)).toBeNull();

		await useContext(PC_CONTEXT);
		await tick();
		expect(screen.getByText(CONTENT)).toBeTruthy();
	});

	it('names the restart for a page of the administrator before the server knows the context (KOB-1)', async () => {
		await useContext('outdated');
		await renderSettings('/einstellungen/sicherheit');

		expect(screen.getByText('Nach dem nächsten Neustart verfügbar')).toBeTruthy();
		expect(screen.queryByText(CONTENT)).toBeNull();
		expect(document.body.textContent).not.toMatch(/\.bat/);
	});

	it.each([
		['windows', true],
		['linux', false],
		['container', false]
	])(
		'lists "Sicherung" and "System" for a server on %s: %s (ADR-0043, ADR-0046)',
		async (platform, listed) => {
			mocks.platform = platform;
			await renderSettings('/einstellungen/konto');

			const nav = within(screen.getByRole('navigation', { name: 'Einstellungen' }));
			expect(nav.queryByRole('link', { name: 'System' }) !== null).toBe(listed);
			expect(nav.queryByRole('link', { name: 'Sicherung' }) !== null).toBe(listed);
			// "Speicher" on every server, with what it can measure there (ADR-0047 §6); "Sicherheit"
			// as well (ADR-0055 §8).
			expect(nav.getByRole('link', { name: 'Speicher' })).toBeTruthy();
			expect(nav.getByRole('link', { name: 'Sicherheit' })).toBeTruthy();
			expect(nav.getByRole('link', { name: 'Hilfe' })).toBeTruthy();
		}
	);

	it('shows the breadcrumbs with the current page last', async () => {
		await renderSettings('/einstellungen/kanaele');

		const crumbs = within(screen.getByRole('navigation', { name: 'Brotkrumenpfad' }));
		expect(crumbs.getAllByRole('listitem').map((item) => item.textContent?.trim())).toEqual([
			'Einstellungen',
			'Kanäle'
		]);
		expect(crumbs.getByRole('link', { name: 'Einstellungen' }).getAttribute('href')).toBe(
			'/einstellungen'
		);
		expect(crumbs.getByText('Kanäle').getAttribute('aria-current')).toBe('page');
		expect(crumbs.queryByRole('link', { name: 'Kanäle' })).toBeNull();
	});

	it.each([
		[null, 'Zurück zu Aufgaben', '/'],
		['/?status=open&sort=titel', 'Zurück zu Aufgaben', '/?status=open&sort=titel'],
		[
			'/tickets/abc123def456ghi?status=open',
			'Zurück zu BYL-12',
			'/tickets/abc123def456ghi?status=open'
		],
		['/eingang?quelle=mail', 'Zurück zum Eingang', '/eingang?quelle=mail'],
		['/projekte?archiviert=1', 'Zurück zu Projekte', '/projekte?archiviert=1'],
		['//evil.example/', 'Zurück zu Aufgaben', '/']
	])('leads back to the last view %s', async (remembered, label, href) => {
		await renderSettings('/einstellungen/kanaele', remembered);

		const nav = within(screen.getByRole('navigation', { name: 'Einstellungen' }));
		const back = nav.getByRole('link', { name: label });
		expect(back.getAttribute('href')).toBe(href);
		// The way back is the first element of the navigation.
		expect(nav.getAllByRole('link')[0]).toBe(back);
	});

	it('moves the focus to the heading after a change of the page, not when coming from a view', async () => {
		await renderSettings('/einstellungen/datei-importe');
		const heading = screen.getByRole('heading', { level: 2 });
		expect(heading.getAttribute('tabindex')).toBe('-1');
		expect(heading.hasAttribute('data-view-heading')).toBe(true);
		const url = (path: string) => ({ url: new URL(path, 'http://127.0.0.1:8090') });

		for (const callback of mocks.afterNavigate) {
			callback({ from: url('/?status=open'), to: url('/einstellungen/datei-importe') });
		}
		expect(document.activeElement).not.toBe(heading);

		for (const callback of mocks.afterNavigate) {
			callback({ from: url('/einstellungen/kanaele'), to: url('/einstellungen/datei-importe') });
		}
		expect(document.activeElement).toBe(heading);
	});

	it('forwards /einstellungen to the page "Kanäle"', () => {
		expect(() => load()).toThrow(
			expect.objectContaining({ status: 307, location: '/einstellungen/kanaele' })
		);
	});

	it('uses the full width like the views: no maximum width, not pushed to the left', () => {
		const source = readFileSync(join(import.meta.dirname, '+layout.svelte'), 'utf8');
		const style = /<style>([\s\S]*)<\/style>/.exec(source)?.[1] ?? '';
		const rules = style.replace(/\.page :global\(p\)\s*\{[^}]*\}/, '');
		expect(rules).not.toMatch(/max-width/);
		expect(rules).not.toMatch(/margin(-right)?:\s*[^;]*auto/);
		expect(rules).toMatch(/grid-template-columns:\s*15rem minmax\(0, 1fr\)/);
		expect(rules).toMatch(/top:\s*calc\(var\(--app-header-height, 0px\) \+ 1rem\)/);
	});
});

// The groups of the navigation (UI-1, ADR-0060) in every context of the matrix of KOB-1
// (ADR-0057): the administrator at the machine of the app, the administrator on another device,
// every other account and a tab whose context is still loading.
describe('groups of the settings navigation (UI-1)', () => {
	/** Each list of the navigation: its name (the heading of the group) and its links. */
	function groups(): [string, string[]][] {
		const nav = screen.getByRole('navigation', { name: 'Einstellungen' });
		return within(nav)
			.getAllByRole('list')
			.map((list) => [
				(list.getAttribute('aria-labelledby') ?? '')
					.split(' ')
					.filter(Boolean)
					.map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim())
					.join(' '),
				within(list)
					.getAllByRole('link')
					.map((link) => link.textContent?.replace(/\s+/g, ' ').trim() ?? '')
			]);
	}

	const WORK: [string, string[]] = [
		'Eingang und Tickets',
		['Kanäle', 'Datei-Importe', 'Tags', 'Tickets']
	];
	const PERSONAL: [string, string[]] = ['Persönlich', ['Darstellung', 'Haushalt', 'Mein Konto']];
	const HELP: [string, string[]] = ['', ['Hilfe']];

	it('shows the administrator at the machine of the app every group with its pages', async () => {
		mocks.platform = 'windows';
		await renderSettings('/einstellungen/konten');

		expect(groups()).toEqual([
			WORK,
			PERSONAL,
			['Verwaltung', ['Konten verwalten', 'Sicherheit', 'Sicherung', 'Speicher', 'System']],
			HELP
		]);
		// "Mein Konto" and "Konten verwalten" stand next to each other, apart by name.
		const nav = within(screen.getByRole('navigation', { name: 'Einstellungen' }));
		const links = nav.getAllByRole('link').map((link) => link.textContent?.trim());
		expect(links.indexOf('Konten verwalten') - links.indexOf('Mein Konto')).toBe(1);
		expect(nav.getByRole('link', { name: 'Konten verwalten' }).getAttribute('aria-current')).toBe(
			'page'
		);
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Konten verwalten');
	});

	it('marks the group "Verwaltung" "nur am PC" for the administrator on another device', async () => {
		await useContext(REMOTE_CONTEXT);
		mocks.platform = 'windows';
		await renderSettings('/einstellungen/konto');

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
		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Mein Konto');
	});

	it('leaves the group "Verwaltung" out for every other account', async () => {
		await useContext(MEMBER_CONTEXT);
		mocks.platform = 'windows';
		await renderSettings('/einstellungen/haushalt');

		expect(groups()).toEqual([WORK, PERSONAL, HELP]);
	});

	it('leaves the group out while the context loads and shows it once it is known', async () => {
		await useContext('pending');
		mocks.platform = 'windows';
		await renderSettings('/einstellungen/darstellung');
		expect(groups()).toEqual([WORK, PERSONAL, HELP]);

		await useContext(PC_CONTEXT);
		await tick();
		expect(groups().map(([name]) => name)).toEqual([
			'Eingang und Tickets',
			'Persönlich',
			'Verwaltung',
			''
		]);
	});

	it('lists only the pages a Linux server has in "Verwaltung"', async () => {
		mocks.platform = 'linux';
		await renderSettings('/einstellungen/konto');

		expect(groups()[2]).toEqual(['Verwaltung', ['Konten verwalten', 'Sicherheit', 'Speicher']]);
	});

	it('puts the overview of the form controls below "Hilfe" in heading, crumbs and navigation', async () => {
		await renderSettings('/einstellungen/hilfe/elemente');

		expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Eingabeelemente');
		const crumbs = within(screen.getByRole('navigation', { name: 'Brotkrumenpfad' }));
		expect(crumbs.getAllByRole('listitem').map((item) => item.textContent?.trim())).toEqual([
			'Einstellungen',
			'Hilfe',
			'Eingabeelemente'
		]);
		expect(crumbs.getByRole('link', { name: 'Hilfe' }).getAttribute('href')).toBe(
			'/einstellungen/hilfe'
		);
		const nav = within(screen.getByRole('navigation', { name: 'Einstellungen' }));
		expect(nav.getByRole('link', { name: 'Hilfe' }).getAttribute('aria-current')).toBe('page');
		expect(screen.getByText(CONTENT)).toBeTruthy();
	});
});
