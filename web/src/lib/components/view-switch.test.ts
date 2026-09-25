// Component tests for the switch "Aufgaben | Projekte" (E3 plan, T-3 and package 14; ADR-0010
// section 5): a navigation with two links, aria-current on the current view, the list state
// kept while the list is shown. Page state is mocked.

import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ViewSwitch from './ViewSwitch.svelte';
import source from './ViewSwitch.svelte?raw';

const mocks = vi.hoisted(() => ({ page: { url: new URL('http://localhost:3000/') } }));

vi.mock('$app/state', () => ({ page: mocks.page }));

function show(
	current: 'tasks' | 'projects' | 'inbox',
	path: string,
	inboxCount: number | null = null
) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	render(ViewSwitch, { props: { current, inboxCount } });
	return within(screen.getByRole('navigation', { name: 'Ansicht' }));
}

describe('view switch', () => {
	it('is a navigation with three links and marks the list as current', () => {
		const nav = show('tasks', '/tickets/abc123def456ghi?status=open&sort=titel');

		const links = nav.getAllByRole('link');
		expect(links.map((link) => link.textContent?.trim())).toEqual([
			'Aufgaben',
			'Projekte',
			'Eingang'
		]);
		const tasks = nav.getByRole('link', { name: 'Aufgaben' });
		expect(tasks.getAttribute('aria-current')).toBe('page');
		expect(tasks.getAttribute('href')).toBe('/?status=open&sort=titel');
		const projects = nav.getByRole('link', { name: 'Projekte' });
		expect(projects.hasAttribute('aria-current')).toBe(false);
		expect(projects.getAttribute('href')).toBe('/projekte');
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

	it('marks the current view by weight and a line besides its colour (ADR-0010 section 3)', () => {
		const rule = /a\[aria-current='page'\]\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
		expect(rule).toMatch(/font-weight:\s*600/);
		expect(rule).toMatch(/border-bottom-color:\s*var\(--color-brand\)/);
		expect(source).not.toMatch(/danger/);
	});
});
