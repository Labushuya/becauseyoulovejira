// Component tests for the navigation of the views (E3 plan, T-3 and package 14; E5 plan, package 5;
// ADR-0010 section 5; ADR-0053; since ER-1 the order of ADR-0066 §1): a navigation with one link
// per view in the fixed order Aufgaben, Tagesplan, Projekte, Eingang, Wiederholungen, Kalender,
// Erledigte, Papierkorb, the same in every context of the tab (KOB-1, ADR-0057), aria-current on
// the current view, the state of a view kept while it is shown. Page state is mocked; the number
// of the trash is a case of trash-view.test.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '$lib/domain/context';
import { appContext, type ContextSession } from '$lib/stores/context.svelte';
import ViewSwitch from './ViewSwitch.svelte';
import source from './ViewSwitch.svelte?raw';

const base = readFileSync(join(import.meta.dirname, '..', 'styles', 'base.css'), 'utf8');

const mocks = vi.hoisted(() => ({ page: { url: new URL('http://localhost:3000/') } }));

vi.mock('$app/state', () => ({ page: mocks.page }));

type View =
	'tasks' | 'dayplan' | 'projects' | 'inbox' | 'recurrences' | 'calendar' | 'done' | 'trash';

/** The order of ER-1 (decision of the user, ADR-0066 §1), with the view each link belongs to. */
const ORDER: readonly (readonly [View, string, string])[] = [
	['tasks', 'Aufgaben', '/'],
	['dayplan', 'Tagesplan', '/tagesplan'],
	['projects', 'Projekte', '/projekte'],
	['inbox', 'Eingang', '/eingang'],
	['recurrences', 'Wiederholungen', '/wiederholungen'],
	['calendar', 'Kalender', '/kalender'],
	['done', 'Erledigte', '/erledigt'],
	['trash', 'Papierkorb', '/papierkorb']
];
const NAMES = ORDER.map(([, name]) => name);

function show(current: View | null, path: string, inboxCount: number | null = null) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	render(ViewSwitch, { props: { current, inboxCount } });
	return within(screen.getByRole('navigation', { name: 'Ansicht' }));
}

function names(nav: ReturnType<typeof show>): string[] {
	return nav
		.getAllByRole('link')
		.map((link) => link.textContent?.replace(/\s+/g, ' ').trim() ?? '');
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('view switch', () => {
	it('is a navigation with the eight views in the order of ER-1, the list current', () => {
		const nav = show('tasks', '/tickets/abc123def456ghi?status=open&sort=titel');

		expect(names(nav)).toEqual(NAMES);
		const tasks = nav.getByRole('link', { name: 'Aufgaben' });
		expect(tasks.getAttribute('aria-current')).toBe('page');
		expect(tasks.getAttribute('href')).toBe('/?status=open&sort=titel');
		const projects = nav.getByRole('link', { name: 'Projekte' });
		expect(projects.hasAttribute('aria-current')).toBe(false);
		expect(projects.getAttribute('href')).toBe('/projekte');
		// Every view is a segment of the same track, "Papierkorb" included (ADR-0066 §1).
		const track = tasks.parentElement;
		expect(track?.classList.contains('segmented')).toBe(true);
		for (const link of nav.getAllByRole('link')) expect(link.parentElement).toBe(track);
	});

	it.each(ORDER)('keeps the order in the view %s and marks only %s', (current, name, path) => {
		const nav = show(current, path);

		expect(names(nav)).toEqual(NAMES);
		const marked = nav.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'));
		expect(marked.map((link) => link.textContent?.trim())).toEqual([name]);
	});

	it('marks no view as current in the settings and leads to the plain views (EH-1)', () => {
		mocks.page.url = new URL('/einstellungen/kanaele?x=1', 'http://localhost:3000');
		render(ViewSwitch, { props: { current: null, inboxCount: 2, projectsNewCount: 1 } });
		const nav = within(screen.getByRole('navigation', { name: 'Ansicht' }));

		const links = nav.getAllByRole('link');
		expect(links.map((link) => link.hasAttribute('aria-current'))).toEqual(NAMES.map(() => false));
		expect(links.map((link) => link.getAttribute('href'))).toEqual(ORDER.map(([, , href]) => href));
		expect(nav.getByRole('link', { name: 'Eingang (2 neu)' })).toBeTruthy();
	});

	it('stands the day plan right after the list and keeps its day while it is shown (ADR-0065)', () => {
		const nav = show('dayplan', '/tagesplan/tickets/abc123def456ghi?tag=2031-05-13');

		const plan = nav.getByRole('link', { name: 'Tagesplan' });
		expect(plan.getAttribute('aria-current')).toBe('page');
		expect(plan.getAttribute('href')).toBe('/tagesplan?tag=2031-05-13');
		expect(nav.getByRole('link', { name: 'Aufgaben' }).hasAttribute('aria-current')).toBe(false);
	});

	it('keeps the filters of "Erledigte" while it is shown, else leads to the plain view (ADR-0066)', () => {
		const nav = show(
			'done',
			'/erledigt/tickets/abc123def456ghi?projekt=proj00000000001&q=Miete&prio=high'
		);
		const done = nav.getByRole('link', { name: 'Erledigte' });
		expect(done.getAttribute('aria-current')).toBe('page');
		expect(done.getAttribute('href')).toBe('/erledigt?projekt=proj00000000001&q=Miete');
		document.body.innerHTML = '';

		const other = show('tasks', '/?projekt=proj00000000001');
		expect(other.getByRole('link', { name: 'Erledigte' }).getAttribute('href')).toBe('/erledigt');
	});

	it('marks the project view as current and leads to the plain list', () => {
		const nav = show('projects', '/projekte?archiviert=1');

		expect(nav.getByRole('link', { name: 'Projekte' }).getAttribute('aria-current')).toBe('page');
		const tasks = nav.getByRole('link', { name: 'Aufgaben' });
		expect(tasks.hasAttribute('aria-current')).toBe(false);
		expect(tasks.getAttribute('href')).toBe('/');
	});

	it('leads to the inbox and shows the number of new entries as text (E4 plan, package 3)', () => {
		const nav = show('tasks', '/?status=open', 3);
		const inbox = nav.getByRole('link', { name: 'Eingang (3 neu)' });
		expect(inbox.getAttribute('href')).toBe('/eingang');
		expect(inbox.hasAttribute('aria-current')).toBe(false);
	});

	it('shows no number without new entries or while loading', () => {
		show('projects', '/projekte', 0);
		expect(screen.getByRole('link', { name: 'Eingang' })).toBeTruthy();
	});

	it('marks the inbox as current and keeps its chips', () => {
		const nav = show('inbox', '/eingang/abc123def456ghi?quelle=mail&zustand=verworfen&x=1', 1);
		const inbox = nav.getByRole('link', { name: 'Eingang (1 neu)' });
		expect(inbox.getAttribute('aria-current')).toBe('page');
		expect(inbox.getAttribute('href')).toBe('/eingang?quelle=mail&zustand=verworfen');
		expect(nav.getByRole('link', { name: 'Aufgaben' }).getAttribute('href')).toBe('/');
	});

	it('shows the number of new tickets in projects at "Projekte" (E4 plan, package 4)', () => {
		mocks.page.url = new URL('/', 'http://localhost:3000');
		render(ViewSwitch, { props: { current: 'tasks', projectsNewCount: 2 } });
		expect(screen.getByRole('link', { name: 'Projekte (2 neu)' }).getAttribute('href')).toBe(
			'/projekte'
		);
	});

	it('marks the calendar as current and keeps its view, day and filters (ADR-0053)', () => {
		const nav = show('calendar', '/kalender/tickets/abc123def456ghi?prio=high&ansicht=woche');

		const calendar = nav.getByRole('link', { name: 'Kalender' });
		expect(calendar.getAttribute('aria-current')).toBe('page');
		expect(calendar.getAttribute('href')).toBe('/kalender?prio=high&ansicht=woche');
		expect(nav.getByRole('link', { name: 'Aufgaben' }).getAttribute('href')).toBe('/');
		document.body.innerHTML = '';
		const other = show('tasks', '/?prio=high');
		expect(other.getByRole('link', { name: 'Kalender' }).getAttribute('href')).toBe('/kalender');
	});

	it('marks the overview "Wiederholungen" as current (E5 plan, package 5)', () => {
		const nav = show('recurrences', '/wiederholungen/rule00000000001', 2);

		const recurrences = nav.getByRole('link', { name: 'Wiederholungen' });
		expect(recurrences.getAttribute('aria-current')).toBe('page');
		expect(recurrences.getAttribute('href')).toBe('/wiederholungen');
		expect(nav.getByRole('link', { name: 'Aufgaben' }).getAttribute('href')).toBe('/');
		const inbox = nav.getByRole('link', { name: 'Eingang (2 neu)' });
		expect(inbox.getAttribute('href')).toBe('/eingang');
		// The tour target of the inbox stays where it was (plan EH-13).
		expect(inbox.dataset.tour).toBe('inbox');
	});

	it('shows "Papierkorb" last as a segment of the track (ADR-0037 §9, ADR-0066 §1)', () => {
		const nav = show('trash', '/papierkorb/abc123def456ghi');
		const trash = nav.getByRole('link', { name: 'Papierkorb' });
		expect(trash.getAttribute('aria-current')).toBe('page');
		expect(trash.getAttribute('href')).toBe('/papierkorb');
		expect(trash.closest('.segmented')).not.toBeNull();
		expect(nav.getAllByRole('link').at(-1)).toBe(trash);
		expect(nav.getByRole('link', { name: 'Aufgaben' }).hasAttribute('aria-current')).toBe(false);
	});

	it('marks the current view by weight and a frame besides its colour (segmented control)', () => {
		expect(source).toMatch(
			/<nav class="view-switch" aria-label="Ansicht">\s*<div class="segmented">/
		);
		const rule =
			/\.segmented > :is\(\[aria-current='page'\], \[aria-pressed='true'\]\) \{([^}]*)\}/.exec(
				base
			)?.[1] ?? '';
		expect(rule).toMatch(/font-weight:\s*600/);
		expect(rule).toMatch(/border-color:\s*var\(--color-brand-text\)/);
		expect(rule).toMatch(/background:\s*var\(--color-brand-soft-bg\)/);
		expect(source).not.toMatch(/danger/);
		// No local copy of the entries: only counts and icons are styled here.
		expect(source).not.toMatch(/\n\ta \{|aria-current='page'\]/);
		// One track for all views, no folded variant and no entry that depends on the context.
		expect(source.match(/class="segmented"/g)).toHaveLength(1);
		expect(source).not.toMatch(/appContext|capabilities|PcOnly/);
	});
});

describe('view switch in every context of the tab (KOB-1, ADR-0057)', () => {
	const ADMIN: AppContext = {
		admin: true,
		local: true,
		platform: 'windows',
		scripts: true,
		localUrl: 'http://127.0.0.1:8090'
	};
	const MEMBER: AppContext = { ...ADMIN, admin: false, scripts: false, localUrl: null };
	const REMOTE: AppContext = { ...ADMIN, local: false, scripts: false };
	const LINUX: AppContext = { ...ADMIN, platform: 'linux', scripts: false };

	const session: ContextSession = {
		token: 'token',
		record: { id: 'user00000000001' },
		onChange: () => () => undefined
	};

	let stop: (() => void) | null = null;

	afterEach(() => {
		stop?.();
		stop = null;
	});

	it.each<[string, AppContext | null]>([
		['while the context loads (the most restrictive view)', null],
		['the administrator at this computer', ADMIN],
		['another account at this computer', MEMBER],
		['the administrator on another device', REMOTE],
		['the administrator of a server under Linux', LINUX]
	])('keeps the same eight views for %s', async (_name, context) => {
		if (context !== null) {
			stop = appContext.start(async () => ({ kind: 'ready', context }), session);
			await vi.waitFor(() => expect(appContext.state.kind).toBe('ready'));
		}
		for (const current of ['tasks', 'done', 'trash', null] as const) {
			document.body.innerHTML = '';
			expect(names(show(current, '/'))).toEqual(NAMES);
		}
	});
});
