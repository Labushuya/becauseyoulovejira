// Component tests for the switch "Aufgaben | Projekte" (E3 plan, T-3 and package 14; ADR-0010
// section 5): a navigation with two links, aria-current on the current view, the list state
// kept while the list is shown. Page state is mocked.

import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ViewSwitch from './ViewSwitch.svelte';
import source from './ViewSwitch.svelte?raw';

const mocks = vi.hoisted(() => ({ page: { url: new URL('http://localhost:3000/') } }));

vi.mock('$app/state', () => ({ page: mocks.page }));

function show(current: 'tasks' | 'projects', path: string) {
	mocks.page.url = new URL(path, 'http://localhost:3000');
	render(ViewSwitch, { props: { current } });
	return within(screen.getByRole('navigation', { name: 'Ansicht' }));
}

describe('view switch', () => {
	it('is a navigation with two links and marks the list as current', () => {
		const nav = show('tasks', '/tickets/abc123def456ghi?status=open&sort=titel');

		const links = nav.getAllByRole('link');
		expect(links.map((link) => link.textContent?.trim())).toEqual(['Aufgaben', 'Projekte']);
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

	it('marks the current view by weight and a line besides its colour (ADR-0010 section 3)', () => {
		const rule = /a\[aria-current='page'\]\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
		expect(rule).toMatch(/font-weight:\s*600/);
		expect(rule).toMatch(/border-bottom-color:\s*var\(--color-brand\)/);
		expect(source).not.toMatch(/danger/);
	});
});
