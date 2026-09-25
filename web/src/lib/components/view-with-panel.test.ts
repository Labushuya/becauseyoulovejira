// View with side panel (ADR-0025 section 6; plan UI-Konsistenz, packages UI-6 and UI-6b): from
// 64rem the panel is embedded as a column right of the whole view; below it lies over the view
// with the blanket, the view and the header are inert, and a click on the blanket closes like the
// ×. The slide-in mark is set only when the panel opens, not when it changes to another entry.
// jsdom has no layout and no matchMedia; a stand-in answers the media query. The look is a
// browser case (BYL-E6-020, BYL-E6-027).

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PANEL_EMBEDDED_QUERY, PanelShell } from '$lib/overlay/panel-host.svelte';
import ViewHarness from '$lib/test/ViewHarness.svelte';
import drawerSource from './overlay/Drawer.svelte?raw';
import source from './ViewWithPanel.svelte?raw';

/**
 * matchMedia stand-in: every query answers `wide` (the window is at least 64rem wide); `set`
 * changes it and tells the listeners. `queries` records the asked media queries.
 */
function mediaQuery(wide: boolean) {
	const listeners = new Set<() => void>();
	const queries: string[] = [];
	let matches = wide;
	window.matchMedia = ((query: string) => {
		queries.push(query);
		return {
			media: query,
			get matches() {
				return matches;
			},
			addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
			removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener)
		};
	}) as unknown as typeof window.matchMedia;
	return {
		queries,
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
const view = () => document.querySelector('.view') as HTMLElement;
const panelPart = () => document.querySelector('.panel') as HTMLElement;
const blanket = () => document.querySelector<HTMLElement>('.blanket');

describe('view with panel', () => {
	it('asks for the breakpoint of 64rem', async () => {
		const media = mediaQuery(true);
		render(ViewHarness, { props: { panel: 'Ticket A' } });
		await tick();
		expect(PANEL_EMBEDDED_QUERY).toBe('(min-width: 64rem)');
		expect(media.queries).toContain(PANEL_EMBEDDED_QUERY);
	});

	it('embeds the panel next to the reachable view from 64rem, without a blanket', async () => {
		mediaQuery(true);
		const shell = new PanelShell();
		render(ViewHarness, { props: { panel: 'Ticket A', shell } });
		await tick();
		expect(view().dataset.panelMode).toBe('embedded');
		expect(listPart().inert).toBe(false);
		expect(blanket()).toBeNull();
		expect(shell.covering).toBe(false);
		expect(screen.getByRole('complementary', { name: 'Ticket A' })).toBeTruthy();
	});

	it('lays the panel over the inert view and header below 64rem, following the window', async () => {
		const media = mediaQuery(false);
		const shell = new PanelShell();
		const { rerender } = render(ViewHarness, { props: { panel: 'Ticket A', shell } });
		await tick();
		expect(view().dataset.panelMode).toBe('overlay');
		expect(listPart().inert).toBe(true);
		expect(blanket()).not.toBeNull();
		expect(blanket()?.getAttribute('aria-hidden')).toBe('true');
		expect(shell.covering).toBe(true);

		media.set(true);
		await tick();
		expect(view().dataset.panelMode).toBe('embedded');
		expect(listPart().inert).toBe(false);
		expect(blanket()).toBeNull();
		expect(shell.covering).toBe(false);

		media.set(false);
		await tick();
		expect(shell.covering).toBe(true);
		await rerender({ panel: null, shell });
		expect(view().dataset.panelMode).toBeUndefined();
		expect(listPart().inert).toBe(false);
		expect(blanket()).toBeNull();
		expect(shell.covering).toBe(false);
	});

	it('closes like the × on a click on the blanket', async () => {
		mediaQuery(false);
		const onclose = vi.fn();
		render(ViewHarness, { props: { panel: 'Ticket A', onclose } });
		await tick();
		await fireEvent.click(blanket() as HTMLElement);
		expect(onclose).toHaveBeenCalledOnce();
		await fireEvent.click(screen.getByRole('button', { name: 'Panel schließen' }));
		expect(onclose).toHaveBeenCalledTimes(2);
	});

	it('keeps the Escape rule of the panel in the overlay', async () => {
		mediaQuery(false);
		const onclose = vi.fn();
		render(ViewHarness, { props: { panel: 'Ticket A', onclose } });
		await tick();
		expect(
			await fireEvent.keyDown(screen.getByRole('heading', { name: 'Ticket A' }), {
				key: 'Escape'
			})
		).toBe(false);
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('does nothing on the blanket without a registered panel', async () => {
		mediaQuery(false);
		render(ViewHarness, { props: { panel: 'Ticket A' } });
		await tick();
		await fireEvent.click(blanket() as HTMLElement);
		expect(screen.getByRole('complementary', { name: 'Ticket A' })).toBeTruthy();
	});

	it('marks the slide-in only when the panel opens', async () => {
		mediaQuery(true);
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

	it('lays out the breakpoints with the tokens (static check of the styles)', () => {
		const css = source.slice(source.indexOf('<style>'));
		// Embedded from 64rem: a column of the panel width, sticky below the header.
		const embedded = /@media \(min-width: 64rem\) \{([\s\S]*?)\n\t\}\n/.exec(css)?.[1] ?? '';
		expect(embedded).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) var\(--drawer-width\)/);
		expect(embedded).toMatch(/position:\s*sticky/);
		expect(embedded).toMatch(/top:\s*var\(--app-header-height/);
		expect(embedded).toMatch(/height:\s*calc\(100dvh - var\(--app-header-height/);
		// Overlay below: fixed on the right, 480 px at most, with the blanket.
		expect(css).toMatch(
			/\.covering \.panel \{[^}]*position:\s*fixed;[^}]*right:\s*0;[^}]*width:\s*min\(var\(--drawer-width\), 100%\)/
		);
		expect(css).toMatch(/\.blanket \{[^}]*background:\s*var\(--color-blanket\)/);
		// Full width below 36rem.
		expect(css).toMatch(
			/@media \(max-width: 35\.99rem\) \{\s*\.covering \.panel \{\s*width:\s*100%;/
		);
		expect(source).not.toMatch(/32rem|47\.99rem|48rem/);
		// The drawer fills the column and leaves the placing to the view.
		expect(drawerSource).not.toMatch(/@media|position:\s*fixed/);
		expect(drawerSource).toMatch(/height:\s*100%/);
	});
});
