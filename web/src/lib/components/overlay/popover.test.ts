// Popover building block (ADR-0025 section 5; plan UI-Konsistenz, package UI-2): ARIA of button
// and popover, aria-expanded from the toggle event, focus on opening, the keys of a menu, Escape
// and Tab, leaving with the focus, and the position from place(). jsdom has no popover API; the
// shared stubs stand in (web/src/lib/test/overlay-stubs.ts).

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
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
