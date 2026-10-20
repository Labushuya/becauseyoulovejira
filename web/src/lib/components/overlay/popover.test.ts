// Popover building block (ADR-0025 section 5; plan UI-Konsistenz, package UI-2): ARIA of button
// and popover, aria-expanded from the toggle event, focus on opening, the keys of a menu, Escape
// and Tab, leaving with the focus, and the position from place(). jsdom has no popover API; the
// shared stubs stand in (web/src/lib/test/overlay-stubs.ts).

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHONE_QUERY } from '$lib/domain/phone-layout';
import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
import PopoverHarness from '$lib/test/PopoverHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import source from './Popover.svelte?raw';

useOverlayStubs();

function menuButton() {
	return screen.getByRole('button', { name: 'Auswahl öffnen' });
}

/**
 * The menu. jsdom renders a popover as display: none and then computes no accessible name for it
 * (accname step 2A), so the name is checked on its attribute.
 */
function menu() {
	const element = screen.getByRole('menu', { hidden: true });
	expect(element.getAttribute('aria-label')).toBe('Auswahl');
	return element;
}

function item(name: string) {
	return screen.getByRole('menuitemradio', { hidden: true, name });
}

async function openMenu(onchoose = vi.fn()) {
	render(PopoverHarness, { props: { kind: 'menu', onchoose } });
	await fireEvent.click(menuButton());
	await tick();
	return onchoose;
}

describe('popover: menu', () => {
	it('connects button and menu for assistive technology', () => {
		render(PopoverHarness, { props: { kind: 'menu' } });
		const button = menuButton();

		expect(button.getAttribute('aria-haspopup')).toBe('menu');
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(button.getAttribute('aria-controls')).toBe(menu().id);
		expect(button.getAttribute('popovertarget')).toBe(menu().id);
		expect(menu().getAttribute('popover')).toBe('auto');
	});

	it('sets aria-expanded from the toggle event and moves the focus to the chosen entry', async () => {
		await openMenu();

		expect(menuButton().getAttribute('aria-expanded')).toBe('true');
		expect(document.activeElement).toBe(item('Eintrag B'));
	});

	it('moves with the arrow keys (wrapping), Home and End', async () => {
		await openMenu();

		const steps: [string, string][] = [
			['ArrowDown', 'Eintrag C'],
			['ArrowDown', 'Eintrag A'],
			['ArrowUp', 'Eintrag C'],
			['Home', 'Eintrag A'],
			['End', 'Eintrag C']
		];
		for (const [key, name] of steps) {
			const kept = await fireEvent.keyDown(document.activeElement as Element, { key });
			expect(kept, key).toBe(false);
			expect(document.activeElement, key).toBe(item(name));
		}
	});

	it('chooses, closes and returns the focus to the button', async () => {
		const onchoose = await openMenu();

		await fireEvent.click(item('Eintrag A'));

		expect(onchoose).toHaveBeenCalledExactlyOnceWith('a');
		expect(menuButton().getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(menuButton());
		expect(item('Eintrag A').getAttribute('aria-checked')).toBe('true');
	});

	it('closes with Escape, keeps the Escape to itself and returns the focus', async () => {
		await openMenu();
		const outer = vi.fn();
		document.addEventListener('keydown', outer);

		const kept = await fireEvent.keyDown(item('Eintrag B'), { key: 'Escape' });

		document.removeEventListener('keydown', outer);
		expect(kept).toBe(false);
		expect(outer).not.toHaveBeenCalled();
		expect(menuButton().getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(menuButton());
	});

	it('closes with Tab without taking the focus back', async () => {
		await openMenu();

		const kept = await fireEvent.keyDown(item('Eintrag B'), { key: 'Tab' });

		expect(kept).toBe(true);
		expect(menuButton().getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(item('Eintrag B'));
	});

	it('places itself below the button, right-aligned, 4 px apart', async () => {
		render(PopoverHarness, { props: { kind: 'menu' } });
		vi.spyOn(menuButton(), 'getBoundingClientRect').mockReturnValue({
			x: 300,
			y: 40,
			top: 40,
			left: 300,
			bottom: 72,
			right: 332,
			width: 32,
			height: 32,
			toJSON: () => ({})
		});

		await fireEvent.click(menuButton());

		expect(menu().style.top).toBe('76px');
		expect(menu().style.left).toBe('332px');
		expect(menu().style.visibility).toBe('');
	});
});

describe('popover: panel', () => {
	function panelButton() {
		return screen.getByRole('button', { name: 'Filter' });
	}

	/** The panel, named by the legend of its fieldset (checked on the attribute, see menu()). */
	function panel() {
		const element = screen.getByRole('dialog', { hidden: true });
		const name = document.getElementById(element.getAttribute('aria-labelledby') ?? '');
		expect(name?.textContent).toBe('Filter wählen');
		return element;
	}

	it('is a named, non-modal dialog and focuses the checked radio on opening', async () => {
		render(PopoverHarness, { props: { kind: 'panel' } });
		expect(panelButton().getAttribute('aria-haspopup')).toBe('dialog');
		expect(panel().hasAttribute('aria-modal')).toBe(false);

		await fireEvent.click(panelButton());
		await tick();

		expect(panelButton().getAttribute('aria-expanded')).toBe('true');
		expect(document.activeElement).toBe(
			screen.getByRole('radio', { hidden: true, name: 'Wert B' })
		);
	});

	it('closes when the focus leaves it, but not when it moves inside', async () => {
		render(PopoverHarness, { props: { kind: 'panel' } });
		await fireEvent.click(panelButton());
		await tick();
		const radio = screen.getByRole('radio', { hidden: true, name: 'Wert B' });

		await fireEvent.focusOut(radio, {
			relatedTarget: screen.getByRole('radio', { hidden: true, name: 'Wert C' })
		});
		expect(panelButton().getAttribute('aria-expanded')).toBe('true');

		await fireEvent.focusOut(radio, {
			relatedTarget: screen.getByRole('button', { name: 'Danach' })
		});
		expect(panelButton().getAttribute('aria-expanded')).toBe('false');
	});

	it('closes with Escape and returns the focus to the button', async () => {
		render(PopoverHarness, { props: { kind: 'panel' } });
		await fireEvent.click(panelButton());
		await tick();

		await fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

		expect(panelButton().getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(panelButton());
	});
});

// MO-1b (ADR-0073 addendum): in the phone frame every popover is a sheet at the bottom with a
// visible "Schließen"; without the frame (switch off, or a wide window) it stays at its button.
describe('popover in the phone frame (MO-1b)', () => {
	let stop: (() => void) | null = null;

	/** A window narrower than 40rem (or not), with the switch of this device on or off. */
	function frame(narrow: boolean, enabled: boolean) {
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
		getMobileLayoutStore().choose(false);
		stop?.();
		stop = null;
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	const close = (role: 'menuitem' | 'button') =>
		screen.queryByRole(role, { hidden: true, name: 'Schließen' });

	it('opens a menu as a sheet, not at its button, with "Schließen" as its last entry', async () => {
		frame(true, true);
		await openMenu();

		expect(menu().classList.contains('sheet')).toBe(true);
		expect(menu().hasAttribute('data-sheet')).toBe(true);
		expect(menu().style.top).toBe('');
		expect(menu().style.left).toBe('');
		const entries = screen.getAllByRole('menuitem', { hidden: true });
		expect(entries.at(-1)?.textContent?.trim()).toBe('Schließen');
		// The keys reach it like every entry: End is the last one.
		await fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
		expect(document.activeElement).toBe(close('menuitem'));

		await fireEvent.click(close('menuitem') as HTMLElement);
		expect(menuButton().getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(menuButton());
	});

	it('opens a panel as a sheet with the button "Schließen", which returns the focus', async () => {
		frame(true, true);
		render(PopoverHarness, { props: { kind: 'panel' } });
		const opener = screen.getByRole('button', { name: 'Filter' });
		await fireEvent.click(opener);
		await tick();

		const panel = screen.getByRole('dialog', { hidden: true });
		expect(panel.classList.contains('sheet')).toBe(true);
		// The content keeps its first focus; "Schließen" comes after it.
		expect(document.activeElement).toBe(
			screen.getByRole('radio', { hidden: true, name: 'Wert B' })
		);
		await fireEvent.click(close('button') as HTMLElement);
		expect(opener.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(opener);
	});

	it.each([
		['a phone with the switch off', true, false],
		['a wide window with the switch on', false, true]
	])('stays at its button on %s, without "Schließen"', async (_name, narrow, enabled) => {
		frame(narrow, enabled);
		render(PopoverHarness, { props: { kind: 'menu' } });
		vi.spyOn(menuButton(), 'getBoundingClientRect').mockReturnValue({
			x: 300,
			y: 40,
			top: 40,
			left: 300,
			bottom: 72,
			right: 332,
			width: 32,
			height: 32,
			toJSON: () => ({})
		});
		await fireEvent.click(menuButton());

		expect(menu().classList.contains('sheet')).toBe(false);
		expect(menu().hasAttribute('data-sheet')).toBe(false);
		expect(menu().style.top).toBe('76px');
		expect(close('menuitem')).toBeNull();
		expect(screen.getAllByRole('menuitemradio', { hidden: true })).toHaveLength(3);
	});

	it('draws the sheet at the bottom over the full width, with 44 px rows and the safe area', () => {
		const sheet = /\.popover\.sheet \{([^}]*)\}/.exec(source)?.[1] ?? '';
		expect(sheet).toMatch(/inset:\s*auto 0 0/);
		expect(sheet).toMatch(/width:\s*100%/);
		expect(sheet).toMatch(/max-width:\s*none/);
		expect(sheet).toMatch(/max-height:\s*var\(--sheet-max-height\)/);
		expect(sheet).toMatch(/var\(--safe-bottom\)/);
		expect(sheet).toMatch(/border-radius:\s*var\(--radius-overlay\) var\(--radius-overlay\) 0 0/);
		expect(source).toMatch(/\.popover\.sheet:popover-open \{[^}]*animation-name:\s*sheet-in/);
		const rows = /\.sheet\.menu :global\([^{]*\{([^}]*)\}/.exec(source)?.[1] ?? '';
		expect(rows).toMatch(/min-height:\s*var\(--control-height-touch\)/);
	});
});

describe('popover source', () => {
	it('uses tokens and no error color (ADR-0010 section 3)', () => {
		expect(source).not.toMatch(/danger|gradient|anchor\(/);
		expect(source).toMatch(/data-overlay/);
	});

	it('is thick glass with a line, the light edge and the popover shadow (ADR-0029)', () => {
		const style = /\.popover \{([^}]*)\}/.exec(source)?.[1] ?? '';
		expect(style).toMatch(/background:\s*var\(--material-thick\)/);
		expect(style).toMatch(/backdrop-filter:\s*var\(--glass-filter-thick\)/);
		expect(style).toMatch(/border:\s*1px solid var\(--color-separator\)/);
		expect(style).toMatch(/border-radius:\s*var\(--radius-overlay\)/);
		expect(style).toMatch(/inset 0 1px 0 var\(--glass-edge\),\s*var\(--shadow-popover\)/);
	});

	it('styles every menu row alike: accent fill on hover and keyboard focus, no own ring removal', () => {
		expect(source).toMatch(
			/\.menu :global\(:is\(\[role='menuitem'\], \[role='menuitemradio'\], \[role='menuitemcheckbox'\]\)\)/
		);
		expect(source).toMatch(
			/:hover,\s*:focus-visible[\s\S]*?color:\s*var\(--color-on-brand\);\s*background:\s*var\(--color-brand\)/
		);
		// The focus ring of base.css stays: the fill alone is not 3 : 1 against glass in dark mode.
		expect(source).not.toMatch(/outline:\s*(none|0)/);
		expect(source).toMatch(/\.menu :global\(\[role='separator'\]\)[^}]*var\(--color-separator\)/);
	});
});
