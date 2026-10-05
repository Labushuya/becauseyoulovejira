// Component tests for the switch "Aufgaben | Projekte | Eingang | Wiederholungen | Kalender" (E3
// plan, T-3 and package 14; E5 plan, package 5; ADR-0010 section 5; ADR-0053): a navigation with
// one link per view, aria-current on the current view, the list state kept while the list is
// shown, the state of the calendar while the calendar is shown. Page state is mocked.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ViewSwitch from './ViewSwitch.svelte';
import source from './ViewSwitch.svelte?raw';

const base = readFileSync(join(import.meta.dirname, '..', 'styles', 'base.css'), 'utf8');

const mocks = vi.hoisted(() => ({ page: { url: new URL('http://localhost:3000/') } }));

vi.mock('$app/state', () => ({ page: mocks.page }));

function show(
	current: 'tasks' | 'dayplan' | 'projects' | 'inbox' | 'recurrences' | 'calendar' | 'trash',
	path: string,
	inboxCount: number | null = null
) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	render(ViewSwitch, { props: { current, inboxCount } });
	return within(screen.getByRole('navigation', { name: 'Ansicht' }));
}

describe('view switch', () => {
	it('is a navigation with six views and the trash, and marks the list as current', () => {
		const nav = show('tasks', '/tickets/abc123def456ghi?status=open&sort=titel');

		const links = nav.getAllByRole('link');
		expect(links.map((link) => link.textContent?.trim())).toEqual([
			'Aufgaben',
			'Tagesplan',
			'Projekte',
			'Eingang',
			'Wiederholungen',
			'Kalender',
			'Papierkorb'
		]);
		const tasks = nav.getByRole('link', { name: 'Aufgaben' });
		expect(tasks.getAttribute('aria-current')).toBe('page');
		expect(tasks.getAttribute('href')).toBe('/?status=open&sort=titel');
		const projects = nav.getByRole('link', { name: 'Projekte' });
		expect(projects.hasAttribute('aria-current')).toBe(false);
		expect(projects.getAttribute('href')).toBe('/projekte');
	});

	it('marks no view as current in the settings and leads to the plain views (EH-1)', () => {
		mocks.page.url = new URL('/einstellungen/kanaele?x=1', 'http://localhost:3000');
		render(ViewSwitch, { props: { current: null, inboxCount: 2, projectsNewCount: 1 } });
		const nav = within(screen.getByRole('navigation', { name: 'Ansicht' }));

		const links = nav.getAllByRole('link');
		expect(links.map((link) => link.hasAttribute('aria-current'))).toEqual([
			false,
			false,
			false,
			false,
			false,
			false,
			false
		]);
		expect(links.map((link) => link.getAttribute('href'))).toEqual([
			'/',
			'/tagesplan',
			'/projekte',
			'/eingang',
			'/wiederholungen',
			'/kalender',
			'/papierkorb'
		]);
		expect(nav.getByRole('link', { name: 'Eingang (2 neu)' })).toBeTruthy();
	});

	it('stands the day plan right after the list and keeps its day while it is shown (ADR-0065)', () => {
		const nav = show('dayplan', '/tagesplan/tickets/abc123def456ghi?tag=2031-05-13');

		const plan = nav.getByRole('link', { name: 'Tagesplan' });
		expect(plan.getAttribute('aria-current')).toBe('page');
		expect(plan.getAttribute('href')).toBe('/tagesplan?tag=2031-05-13');
		expect(nav.getByRole('link', { name: 'Aufgaben' }).hasAttribute('aria-current')).toBe(false);
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

	// Since G-4 the switch is the segmented control of base.css (ADR-0029 section 9): the current
	// view is the raised thumb with weight and a frame besides its colour (ADR-0010 section 3).
	it('shows the trash as a quiet link after the segments, with its number (ADR-0037)', () => {
		const nav = show('trash', '/papierkorb/abc123def456ghi');
		const trash = nav.getByRole('link', { name: 'Papierkorb' });
		expect(trash.getAttribute('aria-current')).toBe('page');
		expect(trash.getAttribute('href')).toBe('/papierkorb');
		expect(trash.closest('.segmented')).toBeNull();
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
	});
});
