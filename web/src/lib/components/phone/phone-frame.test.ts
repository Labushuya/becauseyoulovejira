// Component tests of the phone frame (MO-1a, ADR-0073): the bottom bar "Tagesplan · Aufgaben · ＋ ·
// Eingang · Mehr" (decision of the user, addendum to ADR-0066 §1) with the addresses of the
// navigation of the PC, the sheet "Mehr" with every other view, "Neues Ticket", the settings with
// the marks "nur am PC" and the session, the compact top bar, and the rules of the targets. The
// width and the switch are the business of the layout (app-layout.test.ts); here the parts alone.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '$lib/domain/context';
import { appContext, type ContextSession } from '$lib/stores/context.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import ViewSwitch from '../ViewSwitch.svelte';
import PhoneTabBar from './PhoneTabBar.svelte';
import tabBarSource from './PhoneTabBar.svelte?raw';
import PhoneTopBar from './PhoneTopBar.svelte';
import topBarSource from './PhoneTopBar.svelte?raw';
import sheetSource from './PhoneMoreSheet.svelte?raw';
import { TOKENS_SOURCE as tokens } from '$lib/test/tokens-css';

const mocks = vi.hoisted(() => ({
	page: {
		url: new URL('http://localhost:3000/'),
		route: { id: '/(app)/(tickets)' as string | null }
	},
	goto: vi.fn(async () => undefined),
	auth: { email: 'anna@example.com', logout: vi.fn() }
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/auth.svelte', () => ({ auth: mocks.auth }));

useOverlayStubs();

const ADMIN: AppContext = {
	admin: true,
	local: true,
	platform: 'windows',
	scripts: true,
	localUrl: 'http://127.0.0.1:8090'
};

const session: ContextSession = {
	token: 'token',
	record: { id: 'user00000000001' },
	onChange: () => () => undefined
};

let stopContext: (() => void) | null = null;

async function withContext(context: AppContext) {
	stopContext = appContext.start(async () => ({ kind: 'ready', context }), session);
	await vi.waitFor(() => expect(appContext.state.kind).toBe('ready'));
}

afterEach(() => {
	stopContext?.();
	stopContext = null;
	mocks.goto.mockClear();
	mocks.auth.logout.mockClear();
	document.body.innerHTML = '';
});

function at(path: string, routeId: string | null) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	mocks.page.route.id = routeId;
}

function showBar(
	props: { inboxCount?: number | null; covered?: boolean; projectsNewCount?: number } = {}
) {
	const onquick = vi.fn();
	render(PhoneTabBar, { props: { onquick, ...props } });
	const nav = screen.getByRole('navigation', { name: 'Hauptnavigation' });
	return { nav, onquick };
}

/** The names of the entries of the bar, in their order. */
function entries(nav: HTMLElement): string[] {
	return [...nav.querySelectorAll<HTMLElement>('.item')].map(
		(item) => item.textContent?.replace(/\s+/g, ' ').trim() ?? ''
	);
}

async function openMore(nav: HTMLElement) {
	await fireEvent.click(within(nav).getByRole('button', { name: /^Mehr/ }));
	await tick();
	return screen.getByRole('dialog', { name: 'Mehr' });
}

describe('phone frame: bottom bar', () => {
	it('has the five entries of the user in their order: Tagesplan, Aufgaben, ＋, Eingang, Mehr', () => {
		at('/tagesplan', '/(app)/tagesplan');
		const { nav } = showBar();
		expect(entries(nav)).toEqual(['Tagesplan', 'Aufgaben', 'Erfassen', 'Eingang', 'Mehr']);
		expect(within(nav).getByRole('link', { name: 'Tagesplan' }).getAttribute('href')).toBe(
			'/tagesplan'
		);
		expect(within(nav).getByRole('link', { name: 'Aufgaben' }).getAttribute('href')).toBe('/');
		expect(within(nav).getByRole('link', { name: 'Eingang' }).getAttribute('href')).toBe(
			'/eingang'
		);
		const add = within(nav).getByRole('button', { name: 'Erfassen' });
		expect(add.getAttribute('aria-haspopup')).toBe('dialog');
		expect(within(nav).getByRole('button', { name: 'Mehr' }).getAttribute('aria-haspopup')).toBe(
			'dialog'
		);
	});

	it.each([
		['/tagesplan?tag=2031-05-13', '/(app)/tagesplan', 'Tagesplan'],
		['/tickets/abc123def456ghi?prio=high', '/(app)/(tickets)/tickets/[id]', 'Aufgaben'],
		['/eingang/abc123def456ghi?quelle=mail', '/(app)/eingang/[id]', 'Eingang']
	])('marks the view of %s as current and only it', (path, routeId, name) => {
		at(path, routeId);
		const { nav } = showBar();
		const marked = within(nav)
			.getAllByRole('link')
			.filter((link) => link.getAttribute('aria-current') === 'page');
		expect(marked.map((link) => link.textContent?.trim())).toEqual([name]);
		expect(nav.querySelector('.current')).toBeNull();
	});

	it.each([
		['/kalender?ansicht=woche', '/(app)/kalender', 'Kalender'],
		['/projekte/abc123def456ghi', '/(app)/projekte/[id]', 'Projekte'],
		['/papierkorb', '/(app)/papierkorb', 'Papierkorb'],
		['/einstellungen/darstellung', '/(app)/einstellungen/darstellung', 'Einstellungen']
	])('marks "Mehr" for %s and says what it stands for', (path, routeId, label) => {
		at(path, routeId);
		const { nav } = showBar();
		const more = within(nav).getByRole('button', { name: `Mehr, aktuell: ${label}` });
		expect(more.classList.contains('current')).toBe(true);
		expect(nav.querySelector('[aria-current]')).toBeNull();
		// The name comes from aria-label, so no browser adds a space around a block-level part of
		// it (jsdom has no layout and would not show that); visible stays "Mehr" at its start.
		expect(more.getAttribute('aria-label')).toBe(`Mehr, aktuell: ${label}`);
		expect(more.textContent?.trim()).toBe('Mehr');
	});

	it('names "Mehr" by its visible label alone while a view of the bar is shown', () => {
		at('/tagesplan', '/(app)/tagesplan');
		const { nav } = showBar();
		const more = within(nav).getByRole('button', { name: 'Mehr' });
		expect(more.hasAttribute('aria-label')).toBe(false);
	});

	it('leads to the same addresses as the navigation of the PC, with the state of the view shown', () => {
		for (const [path, routeId, current] of [
			['/tagesplan?tag=2031-05-13', '/(app)/tagesplan', 'dayplan'],
			['/?status=open&sort=titel', '/(app)/(tickets)', 'tasks'],
			['/eingang?quelle=mail&zustand=verworfen', '/(app)/eingang', 'inbox'],
			['/kalender?prio=high', '/(app)/kalender', 'calendar']
		] as const) {
			at(path, routeId);
			const { nav } = showBar();
			render(ViewSwitch, { props: { current } });
			const pc = screen.getByRole('navigation', { name: 'Ansicht' });
			for (const name of ['Tagesplan', 'Aufgaben', 'Eingang']) {
				expect(
					within(nav).getByRole('link', { name }).getAttribute('href'),
					`${path} ${name}`
				).toBe(within(pc).getByRole('link', { name }).getAttribute('href'));
			}
			document.body.innerHTML = '';
		}
	});

	it('opens the quick entry with "＋"', async () => {
		at('/', '/(app)/(tickets)');
		const { nav, onquick } = showBar();
		await fireEvent.click(within(nav).getByRole('button', { name: 'Erfassen' }));
		expect(onquick).toHaveBeenCalledOnce();
	});

	it('shows the number of new inbox entries as text, none while loading or without', () => {
		at('/', '/(app)/(tickets)');
		showBar({ inboxCount: 3 });
		expect(screen.getByRole('link', { name: 'Eingang (3 neu)' })).toBeTruthy();
		document.body.innerHTML = '';
		showBar({ inboxCount: 0 });
		expect(screen.getByRole('link', { name: 'Eingang' })).toBeTruthy();
		document.body.innerHTML = '';
		showBar({ inboxCount: null });
		expect(screen.getByRole('link', { name: 'Eingang' })).toBeTruthy();
	});

	it('gives way while a text field has the focus, not for a check box', async () => {
		at('/', '/(app)/(tickets)');
		const { nav } = showBar();
		const field = document.createElement('input');
		field.type = 'search';
		const box = document.createElement('input');
		box.type = 'checkbox';
		document.body.append(field, box);

		field.focus();
		await tick();
		expect(nav.hidden).toBe(true);
		box.focus();
		await tick();
		expect(nav.hidden).toBe(false);
		field.focus();
		await tick();
		field.blur();
		await tick();
		expect(nav.hidden).toBe(false);
	});

	it('is inert while a side panel covers the view', () => {
		at('/', '/(app)/(tickets)');
		const { nav } = showBar({ covered: true });
		expect(nav.inert).toBe(true);
	});

	it('stands every target as high as the bar, at least 48 px, with the safe area below it', () => {
		expect(tokens).toMatch(/--bottom-bar-height: 3\.5rem;/);
		expect(tokens).toMatch(/--phone-target: 3rem;/);
		expect(tabBarSource).toMatch(/\.items \{[^}]*height: var\(--bottom-bar-height\)/);
		expect(tabBarSource).toMatch(/\.item \{[^}]*min-height: var\(--phone-target\)/);
		expect(tabBarSource).toMatch(/\.tab-bar \{[^}]*padding-bottom: var\(--safe-bottom\)/);
		expect(tabBarSource).toMatch(/grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
		// The sheet is a sibling of the glass, never inside it.
		expect(tabBarSource.indexOf('<PhoneMoreSheet')).toBeGreaterThan(tabBarSource.indexOf('</nav>'));
	});
});

describe('phone frame: "Mehr"', () => {
	it('is the modal as a sheet with every other view in the fixed order', async () => {
		at('/tagesplan', '/(app)/tagesplan');
		const { nav } = showBar({ projectsNewCount: 2 });
		const sheet = await openMore(nav);

		expect(sheet.classList.contains('sheet')).toBe(true);
		const views = within(sheet).getByRole('navigation', { name: 'Ansichten' });
		expect(
			within(views)
				.getAllByRole('link')
				.map((link) => link.textContent?.replace(/\s+/g, ' ').trim())
		).toEqual(['Projekte 2(2 neu)', 'Wiederholungen', 'Kalender', 'Erledigte', 'Papierkorb']);
		expect(within(views).getByRole('link', { name: 'Projekte (2 neu)' }).getAttribute('href')).toBe(
			'/projekte'
		);
		expect(within(views).getByRole('link', { name: 'Kalender' }).getAttribute('href')).toBe(
			'/kalender'
		);
		expect(within(sheet).getByRole('link', { name: 'Neues Ticket' }).getAttribute('href')).toBe(
			'/tickets/neu'
		);
		expect(within(sheet).getByText(/^Angemeldet als/).textContent).toBe(
			'Angemeldet als anna@example.com'
		);
		expect(within(sheet).getByRole('button', { name: 'Abmelden' })).toBeTruthy();
	});

	it('keeps the state of a view under "Mehr" while it is shown and marks it', async () => {
		at('/kalender?ansicht=woche&prio=high', '/(app)/kalender');
		const { nav } = showBar();
		const sheet = await openMore(nav);
		const calendar = within(sheet).getByRole('link', { name: 'Kalender' });
		expect(calendar.getAttribute('aria-current')).toBe('page');
		expect(calendar.getAttribute('href')).toBe('/kalender?ansicht=woche&prio=high');
	});

	it('lists the settings in their groups for the administrator at the PC, "Hilfe" and "Darstellung" among them', async () => {
		await withContext(ADMIN);
		at('/einstellungen/darstellung', '/(app)/einstellungen/darstellung');
		const { nav } = showBar();
		const sheet = await openMore(nav);
		const settings = within(sheet).getByRole('navigation', { name: 'Einstellungen' });

		expect(
			within(settings)
				.getAllByRole('list')
				.map((list) => list.getAttribute('aria-labelledby'))
				.map((id) => (id === null ? null : document.getElementById(id)?.textContent?.trim()))
		).toEqual(['Eingang und Tickets', 'Persönlich', 'Verwaltung', null]);
		expect(
			within(settings)
				.getAllByRole('link')
				.map((link) => link.textContent?.trim())
		).toEqual([
			'Kanäle',
			'Datei-Importe',
			'Tags',
			'Tickets',
			'Darstellung',
			'Haushalt',
			'Mein Konto',
			'Konten verwalten',
			'Sicherheit',
			'Sicherung',
			'Speicher',
			'System',
			'Hilfe'
		]);
		expect(
			within(settings).getByRole('link', { name: 'Darstellung' }).getAttribute('aria-current')
		).toBe('page');
		expect(within(sheet).queryByText('nur am PC')).toBeNull();
	});

	it('marks the pages of the administrator "nur am PC" on another device, and keeps them reachable', async () => {
		await withContext({ ...ADMIN, local: false, scripts: false });
		at('/tagesplan', '/(app)/tagesplan');
		const { nav } = showBar();
		const sheet = await openMore(nav);
		const settings = within(sheet).getByRole('navigation', { name: 'Einstellungen' });

		const heading = within(settings).getByText(/^Verwaltung/);
		expect(heading.textContent?.replace(/\s+/g, ' ').trim()).toBe('Verwaltung nur am PC');
		for (const name of ['Konten verwalten', 'Sicherheit', 'Sicherung', 'Speicher', 'System']) {
			const link = within(settings).getByRole('link', { name: `${name} nur am PC` });
			expect(link.getAttribute('href'), name).toMatch(/^\/einstellungen\//);
		}
		expect(within(settings).getByRole('link', { name: 'Darstellung' })).toBeTruthy();
	});

	it('closes with a link and with ×, the focus back at "Mehr"', async () => {
		at('/tagesplan', '/(app)/tagesplan');
		const { nav } = showBar();
		const more = within(nav).getByRole('button', { name: 'Mehr' });
		more.focus();
		let sheet = await openMore(nav);
		// jsdom does not navigate; in the app SvelteKit follows the link.
		const stay = (event: Event) => event.preventDefault();
		document.addEventListener('click', stay, { capture: true, once: true });
		await fireEvent.click(within(sheet).getByRole('link', { name: 'Erledigte' }));
		await tick();
		expect(screen.queryByRole('dialog', { name: 'Mehr' })).toBeNull();

		more.focus();
		sheet = await openMore(nav);
		await fireEvent.click(within(sheet).getByRole('button', { name: 'Schließen' }));
		await tick();
		expect(screen.queryByRole('dialog', { name: 'Mehr' })).toBeNull();
		expect(document.activeElement).toBe(more);
	});

	it('signs out like the header of the PC: to the login page with the current page', async () => {
		at('/tagesplan?tag=2031-05-13', '/(app)/tagesplan');
		const { nav } = showBar();
		const sheet = await openMore(nav);
		await fireEvent.click(within(sheet).getByRole('button', { name: 'Abmelden' }));
		await tick();
		expect(mocks.auth.logout).toHaveBeenCalledOnce();
		expect(mocks.goto).toHaveBeenCalledWith('/login?redirect=%2Ftagesplan%3Ftag%3D2031-05-13', {
			replaceState: true
		});
	});

	it('gives every row the target of the frame and the × as well', () => {
		expect(sheetSource).toMatch(/ul a \{[^}]*min-height: var\(--phone-target\)/);
		expect(sheetSource).toMatch(/placement="sheet"/);
	});
});

describe('phone frame: no tour', () => {
	// The steps of the tour point at the header and the filter bar of the PC: "Erste Schritte" does
	// not offer it in the frame, and the layout starts none (app-layout.test.ts).
	it('leaves "Kurze Einführung" out of "Erste Schritte" in the frame', () => {
		const tickets = readFileSync(
			join(import.meta.dirname, '..', '..', '..', 'routes', '(app)', '(tickets)', '+layout.svelte'),
			'utf8'
		);
		expect(tickets).toMatch(/onstarttour=\{mobileLayout\.active \? undefined : startTour\}/);
		const layout = readFileSync(
			join(import.meta.dirname, '..', '..', '..', 'routes', '(app)', '+layout.svelte'),
			'utf8'
		);
		expect(layout).toMatch(/if \(touring \|\| mobileLayout\.active\) return;/);
	});
});

describe('phone frame: top bar', () => {
	it.each([
		['/tagesplan', '/(app)/tagesplan', 'Tagesplan'],
		['/', '/(app)/(tickets)', 'Aufgaben'],
		['/tickets/abc123def456ghi', '/(app)/(tickets)/tickets/[id]', 'Aufgaben'],
		['/kalender/tickets/abc123def456ghi', '/(app)/kalender/tickets/[id]', 'Kalender'],
		['/erledigt', '/(app)/erledigt', 'Erledigte'],
		['/einstellungen/hilfe', '/(app)/einstellungen/hilfe', 'Einstellungen']
	])('names the view of %s once, %s', (path, routeId, title) => {
		at(path, routeId);
		render(PhoneTopBar);
		const bar = screen.getByRole('banner');
		expect(bar.querySelector('.title')?.textContent).toBe(title);
		// The name of the app stays the heading of the page, as on the PC, for screen readers.
		const heading = within(bar).getByRole('heading', { level: 1 });
		expect(heading.textContent).toBe('becauseyoulovejira');
		expect(heading.classList.contains('visually-hidden')).toBe(true);
	});

	it('is inert while a side panel covers the view and stays at the top with the safe area', () => {
		at('/', '/(app)/(tickets)');
		render(PhoneTopBar, { props: { covered: true } });
		expect(screen.getByRole('banner', { hidden: true }).inert).toBe(true);
		expect(topBarSource).toMatch(/position: sticky;\s*top: 0;/);
		expect(topBarSource).toMatch(/padding: var\(--safe-top\) var\(--page-inline\) 0;/);
		expect(topBarSource).toMatch(/<AreaSwitch phone \/>/);
	});
});
