// Theme switcher (ADR-0025 section 10, ADR-0027 section 6; plan UI-Konsistenz, package UI-2): name
// of the button with the current mode, a menu with the groups "Modus" (three entries) and "Farbe"
// (five accent themes with swatch), menuitemradio with aria-checked, a choice applies at once and
// is stored, the keyboard reaches every entry, other tabs are followed.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { AccentStore } from '$lib/accent.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { ThemeStore } from '$lib/theme.svelte';
import ThemeMenu from './ThemeMenu.svelte';
import source from './ThemeMenu.svelte?raw';

useOverlayStubs();

afterEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute('data-theme');
	document.documentElement.removeAttribute('data-accent');
});

function show() {
	const store = new ThemeStore(window);
	const accentStore = new AccentStore(window);
	render(ThemeMenu, { props: { store, accentStore } });
	return { store, accentStore };
}

function group(name: 'Modus' | 'Farbe'): HTMLElement {
	// jsdom computes no name inside a popover it hides; the attribute carries it.
	const found = screen
		.getAllByRole('group', { hidden: true })
		.find((element) => element.getAttribute('aria-label') === name);
	if (!found) throw new Error(`no group ${name}`);
	return found;
}

function entries(name: 'Modus' | 'Farbe' = 'Modus') {
	return within(group(name)).getAllByRole('menuitemradio', { hidden: true });
}

async function open(name = 'Darstellung: System') {
	await fireEvent.click(screen.getByRole('button', { name }));
	await tick();
}

describe('theme menu', () => {
	it('names the button after the current mode and opens a menu "Darstellung"', async () => {
		localStorage.setItem('byl-theme', 'dark');
		show();

		const button = screen.getByRole('button', { name: 'Darstellung: Dunkel' });
		expect(button.getAttribute('aria-haspopup')).toBe('menu');
		await open('Darstellung: Dunkel');

		expect(screen.getByRole('menu', { hidden: true }).getAttribute('aria-label')).toBe(
			'Darstellung'
		);
		expect(entries().map((entry) => entry.textContent?.trim())).toEqual([
			'Hell',
			'Dunkel',
			'Wie System'
		]);
		expect(entries().map((entry) => entry.getAttribute('aria-checked'))).toEqual([
			'false',
			'true',
			'false'
		]);
		expect(document.activeElement).toBe(entries()[1]);
	});

	it('switches at once, stores the choice and returns the focus', async () => {
		const { store } = show();
		await open();

		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: 'Hell' }));

		expect(store.preference).toBe('light');
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
		expect(localStorage.getItem('byl-theme')).toBe('light');
		const button = screen.getByRole('button', { name: 'Darstellung: Hell' });
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(button);
	});

	it('goes back to the system setting with "Wie System"', async () => {
		localStorage.setItem('byl-theme', 'dark');
		document.documentElement.setAttribute('data-theme', 'dark');
		show();
		await open('Darstellung: Dunkel');

		await fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
		expect(document.activeElement?.textContent?.trim()).toBe('Wie System');
		await fireEvent.click(document.activeElement as Element);

		expect(localStorage.getItem('byl-theme')).toBeNull();
		expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
		expect(screen.getByRole('button', { name: 'Darstellung: System' })).toBeTruthy();
	});

	it('follows a choice made in another tab', async () => {
		show();

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-theme', newValue: 'dark' }));
		await tick();

		expect(screen.getByRole('button', { name: 'Darstellung: Dunkel' })).toBeTruthy();
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	it('draws its own icons in currentColor, without color or shadow', () => {
		expect(source).toMatch(/stroke: currentColor/);
		expect(source).not.toMatch(/danger|box-shadow|gradient/);
	});
});

describe('theme menu: color (ADR-0027)', () => {
	it('offers the four accent themes in a group "Farbe" after a separator', async () => {
		localStorage.setItem('byl-accent', 'smaragd');
		show();
		await open();

		expect(entries('Farbe').map((entry) => entry.textContent?.trim())).toEqual([
			'Petrol',
			'Rubin',
			'Smaragd',
			'Kupfer'
		]);
		expect(entries('Farbe').map((entry) => entry.getAttribute('aria-checked'))).toEqual([
			'false',
			'false',
			'true',
			'false'
		]);
		expect(screen.getByRole('separator', { hidden: true })).toBeTruthy();
		// The focus starts on the chosen mode; the color entries follow in the same arrow key order.
		expect(document.activeElement?.textContent?.trim()).toBe('Wie System');
		await fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
		expect(document.activeElement?.textContent?.trim()).toBe('Petrol');
		await fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
		expect(document.activeElement?.textContent?.trim()).toBe('Kupfer');
	});

	it('shows each theme with its swatch token, decorative only', async () => {
		show();
		await open();

		for (const entry of entries('Farbe')) {
			const swatch = entry.querySelector<HTMLElement>('.swatch');
			const name = entry.textContent?.trim().toLowerCase();
			expect(swatch?.getAttribute('aria-hidden')).toBe('true');
			expect(swatch?.style.getPropertyValue('--swatch')).toBe(`var(--swatch-${name})`);
		}
	});

	it('switches the color at once, keeps the mode and returns the focus', async () => {
		localStorage.setItem('byl-theme', 'dark');
		const { store, accentStore } = show();
		await open('Darstellung: Dunkel');

		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: 'Rubin' }));

		expect(accentStore.accent).toBe('rubin');
		expect(store.preference).toBe('dark');
		expect(document.documentElement.getAttribute('data-accent')).toBe('rubin');
		expect(localStorage.getItem('byl-accent')).toBe('rubin');
		expect(localStorage.getItem('byl-theme')).toBe('dark');
		const button = screen.getByRole('button', { name: 'Darstellung: Dunkel' });
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(button);
	});

	it('goes back to Petrol and removes the stored color', async () => {
		localStorage.setItem('byl-accent', 'kupfer');
		show();
		await open();

		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: 'Petrol' }));

		expect(localStorage.getItem('byl-accent')).toBeNull();
		expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
	});

	it('follows a color chosen in another tab', async () => {
		show();

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-accent', newValue: 'kupfer' }));
		await tick();
		await open();

		expect(document.documentElement.getAttribute('data-accent')).toBe('kupfer');
		expect(
			screen
				.getByRole('menuitemradio', { hidden: true, name: 'Kupfer' })
				.getAttribute('aria-checked')
		).toBe('true');
	});
});
