// Component tests for the section bar (E3 plan, T-3 and package 5): heading as focus target,
// number with its text for screen readers, controls through snippets.

import { render, screen } from '@testing-library/svelte';
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
