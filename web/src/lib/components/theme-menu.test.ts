// Theme switcher (ADR-0025 section 10; plan UI-Konsistenz, package UI-2): name of the button with
// the current mode, menu with three menuitemradio entries and aria-checked, the choice applies at
// once and is stored, the keyboard reaches every entry, other tabs are followed.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { ThemeStore } from '$lib/theme.svelte';
import ThemeMenu from './ThemeMenu.svelte';
import source from './ThemeMenu.svelte?raw';

useOverlayStubs();

afterEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute('data-theme');
});

function show() {
	const store = new ThemeStore(window);
	render(ThemeMenu, { props: { store } });
	return store;
}

function entries() {
	return screen.getAllByRole('menuitemradio', { hidden: true });
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

		// jsdom computes no name for a popover it hides; the attribute carries it.
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
		const store = show();
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

		await fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
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
