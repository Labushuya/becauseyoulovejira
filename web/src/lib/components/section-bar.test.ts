// Component tests for the section bar (E3 plan, T-3 and package 5): heading as focus target,
// number with its text for screen readers, controls through snippets.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import SectionBar from './SectionBar.svelte';

describe('section bar', () => {
	it('shows the heading with the number and its spoken text', () => {
		render(SectionBar, {
			props: { title: 'Aufgaben', headingId: 'h1', count: 12, countLabel: '12 Tickets' }
		});

		const heading = screen.getByRole('heading', { level: 2, name: 'Aufgaben' });
		expect(heading.id).toBe('h1');
		expect(heading.getAttribute('tabindex')).toBe('-1');
		const spoken = screen.getByText('12 Tickets');
		expect(spoken.className).toContain('visually-hidden');
		expect(spoken.parentElement?.querySelector('[aria-hidden="true"]')?.textContent).toBe('12');
	});

	it('shows no number without one', () => {
		const { container } = render(SectionBar, { props: { title: 'Aufgaben', headingId: 'h1' } });

		expect(container.querySelector('.count')).toBeNull();
	});

	it('renders the controls of the view at the start and at the end', () => {
		const start = createRawSnippet(() => ({ render: () => '<a href="/projekte">Projekte</a>' }));
		const end = createRawSnippet(() => ({
			render: () => '<label><input type="checkbox" role="switch" /> Erledigte anzeigen</label>'
		}));
		const { container } = render(SectionBar, {
			props: { title: 'Aufgaben', headingId: 'h1', start, end }
		});

		expect(container.querySelector('.start')?.contains(screen.getByRole('link'))).toBe(true);
		expect(
			container
				.querySelector('.end')
				?.contains(screen.getByRole('switch', { name: 'Erledigte anzeigen' }))
		).toBe(true);
	});
});

// MO-1a (ADR-0073): the top bar of the phone frame names the view; its heading stays for screen
// readers and the focus, but only once on the screen.
describe('section bar in the phone frame (MO-1a)', () => {
	afterEach(() => {
		getMobileLayoutStore().choose(false);
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	it('keeps the heading for screen readers and the focus, hidden on the screen', async () => {
		vi.stubGlobal('matchMedia', (media: string) => ({
			matches: media === PHONE_QUERY,
			media,
			addEventListener: () => undefined,
			removeEventListener: () => undefined
		}));
		const stop = getMobileLayoutStore().connect();
		// Package "Einschalten": from "Aus", since "Automatisch" is the default now.
		getMobileLayoutStore().choose(false);
		render(SectionBar, { props: { title: 'Aufgaben', headingId: 'h1', count: 12 } });
		const heading = screen.getByRole('heading', { level: 2, name: 'Aufgaben' });
		expect(heading.classList.contains('visually-hidden')).toBe(false);

		getMobileLayoutStore().choose(true);
		await vi.waitFor(() => expect(heading.classList.contains('visually-hidden')).toBe(true));
		expect(heading.getAttribute('tabindex')).toBe('-1');
		expect(heading.hasAttribute('data-view-heading')).toBe(true);
		stop();
	});
});

// MO-3 (ADR-0073 addendum MO-3): the bar decides in one place what it shows in the frame.
describe('section bar in the phone frame: controls of the frame and no room (MO-3)', () => {
	let stop: (() => void) | null = null;

	function useWindow(narrow: boolean, enabled: boolean) {
		vi.stubGlobal('matchMedia', (media: string) => ({
			matches: media === PHONE_QUERY ? narrow : false,
			media,
			addEventListener: () => undefined,
			removeEventListener: () => undefined
		}));
		stop = getMobileLayoutStore().connect();
		getMobileLayoutStore().choose(enabled);
	}

	afterEach(() => {
		stop?.();
		stop = null;
		getMobileLayoutStore().choose(false);
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	const end = createRawSnippet(() => ({
		render: () => '<button type="button">Gruppieren</button>'
	}));
	const phone = createRawSnippet(() => ({
		render: () => '<button type="button">Filter</button>'
	}));

	it('shows only the controls of the frame in one row, the number for screen readers only', () => {
		useWindow(true, true);
		const { container } = render(SectionBar, {
			props: { title: 'Aufgaben', headingId: 'h1', count: 12, countLabel: '12 Tickets', end, phone }
		});

		const bar = container.querySelector('.section-bar') as HTMLElement;
		expect(bar.classList.contains('tools')).toBe(true);
		expect(bar.classList.contains('bare')).toBe(false);
		expect(
			bar.querySelector('.phone-tools')?.contains(screen.getByRole('button', { name: 'Filter' }))
		).toBe(true);
		expect(screen.queryByRole('button', { name: 'Gruppieren' })).toBeNull();
		expect(bar.querySelector('.count')?.classList.contains('visually-hidden')).toBe(true);
		expect(screen.getByText('12 Tickets').className).toContain('visually-hidden');
	});

	it('takes no room without controls and without a number, and keeps a bar with them as before', () => {
		useWindow(true, true);
		const bare = render(SectionBar, { props: { title: 'Tagesplan', headingId: 'h1' } });
		expect(bare.container.querySelector('.section-bar')?.classList.contains('bare')).toBe(true);

		const counted = render(SectionBar, {
			props: { title: 'Erledigte', headingId: 'h2', count: 3, countLabel: '3 Tickets' }
		});
		const bar = counted.container.querySelector('.section-bar') as HTMLElement;
		expect(bar.classList.contains('bare')).toBe(false);
		expect(bar.classList.contains('tools')).toBe(false);
		expect(bar.querySelector('.count')?.classList.contains('visually-hidden')).toBe(false);

		const withEnd = render(SectionBar, { props: { title: 'Kalender', headingId: 'h3', end } });
		expect(withEnd.container.querySelector('.section-bar')?.classList.contains('bare')).toBe(false);
		expect(within(withEnd.container).getByRole('button', { name: 'Gruppieren' })).toBeTruthy();
	});

	it.each([
		['a PC with the switch on', false, true],
		['a phone with the switch off', true, false]
	])(
		'stays as before on %s: the controls of the PC, no row of the frame',
		(_name, narrow, enabled) => {
			useWindow(narrow, enabled);
			const { container } = render(SectionBar, {
				props: {
					title: 'Aufgaben',
					headingId: 'h1',
					count: 12,
					countLabel: '12 Tickets',
					end,
					phone
				}
			});

			const bar = container.querySelector('.section-bar') as HTMLElement;
			expect(bar.classList.contains('tools')).toBe(false);
			expect(bar.classList.contains('bare')).toBe(false);
			expect(screen.getByRole('button', { name: 'Gruppieren' })).toBeTruthy();
			expect(screen.queryByRole('button', { name: 'Filter' })).toBeNull();
			expect(
				screen
					.getByRole('heading', { level: 2, name: 'Aufgaben' })
					.classList.contains('visually-hidden')
			).toBe(false);
			expect(bar.querySelector('.count')?.classList.contains('visually-hidden')).toBe(false);
		}
	);

	it('keeps the rules of the frame below the breakpoint and behind the switch', () => {
		const source = readFileSync(join(import.meta.dirname, 'SectionBar.svelte'), 'utf8');
		const block = source.slice(source.indexOf('@media (max-width: 39.99rem) {'));
		expect(block).toMatch(
			/:global\(:root\[data-mobile-layout='on'\]\) \.section-bar\.bare \{\s*position: absolute;/
		);
		expect(block).toMatch(
			/:global\(:root\[data-mobile-layout='on'\]\) \.section-bar\.tools > \.start \{\s*display: contents;/
		);
	});
});
