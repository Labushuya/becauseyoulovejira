// List with side panel (ADR-0025 section 6; plan UI-Konsistenz, package UI-6): below 48rem the
// panel lies over the list, which is then inert; the slide-in mark is set only when the panel
// opens next to the list, not when it changes to another entry. jsdom has no layout and no
// matchMedia; a stand-in answers the media query. The look is a browser case (BYL-E6-020).

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ViewHarness from '$lib/test/ViewHarness.svelte';
import source from './ViewWithPanel.svelte?raw';

/** matchMedia stand-in: every query answers `narrow`; `set` changes it and tells the listeners. */
function mediaQuery(narrow: boolean) {
	const listeners = new Set<() => void>();
	let matches = narrow;
	window.matchMedia = ((query: string) => ({
		media: query,
		get matches() {
			return matches;
		},
		addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
		removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener)
	})) as unknown as typeof window.matchMedia;
	return {
		set(next: boolean) {
			matches = next;
			for (const listener of listeners) listener();
		}
	};
}

const nativeMatchMedia = window.matchMedia;

afterEach(() => {
	window.matchMedia = nativeMatchMedia;
});

const listPart = () => screen.getByRole('button', { name: 'Zeile A' }).parentElement as HTMLElement;
const panelPart = () => document.querySelector('.panel') as HTMLElement;

describe('view with panel', () => {
	it('keeps the list reachable next to the panel on a wide screen', async () => {
		mediaQuery(false);
		render(ViewHarness, { props: { panel: 'Ticket A' } });
		await tick();
		expect(listPart().inert).toBe(false);
		expect(screen.getByRole('complementary', { name: 'Ticket A' })).toBeTruthy();
	});

	it('makes the list inert while the panel covers it on a narrow screen', async () => {
		const media = mediaQuery(true);
		const { rerender } = render(ViewHarness, { props: { panel: 'Ticket A' } });
		await tick();
		expect(listPart().inert).toBe(true);

		media.set(false);
		await tick();
		expect(listPart().inert).toBe(false);

		media.set(true);
		await rerender({ panel: null });
		expect(listPart().inert).toBe(false);
	});

	it('marks the slide-in only when the panel opens next to the list', async () => {
		mediaQuery(false);
		const { rerender } = render(ViewHarness, { props: { panel: null } });
		await tick();
		expect(panelPart().hasAttribute('data-entering')).toBe(false);

		await rerender({ panel: 'Ticket A' });
		expect(panelPart().hasAttribute('data-entering')).toBe(true);
		await fireEvent.animationEnd(panelPart());
		expect(panelPart().hasAttribute('data-entering')).toBe(false);

		// Another entry in the open panel: no slide-in.
		await rerender({ panel: 'Ticket B' });
		expect(panelPart().hasAttribute('data-entering')).toBe(false);

		await rerender({ panel: null });
		await rerender({ panel: 'Ticket C' });
		expect(panelPart().hasAttribute('data-entering')).toBe(true);
	});

	it('uses the width token for the panel column', () => {
		expect(source).toMatch(/var\(--drawer-width\)/);
		expect(source).not.toMatch(/32rem/);
	});
});
