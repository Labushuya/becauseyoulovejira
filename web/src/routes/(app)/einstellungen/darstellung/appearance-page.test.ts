// Settings "Darstellung" (plan EH-8): three radios in a named group, on the same store as the menu in
// the header; a choice applies at once, is stored, and both controls agree in both directions and
// with other tabs.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ThemeMenu from '$lib/components/ThemeMenu.svelte';
import { SETTINGS_SECTIONS } from '$lib/settings-sections';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { getThemeStore } from '$lib/theme.svelte';
import Page from './+page.svelte';

useOverlayStubs();

afterEach(() => {
	getThemeStore().choose('system');
	localStorage.clear();
	document.documentElement.removeAttribute('data-theme');
});

function radios(): HTMLInputElement[] {
	const group = screen.getByRole('group', { name: 'Farbschema' });
	return within(group).getAllByRole('radio') as HTMLInputElement[];
}

describe('appearance page (EH-8)', () => {
	it('is a page of the settings before "Konto" and "Hilfe"', () => {
		expect(SETTINGS_SECTIONS.map((section) => section.id).slice(-3)).toEqual([
			'darstellung',
			'konto',
			'hilfe'
		]);
	});

	it('offers "Hell", "Dunkel" and "Wie System" as radios with the current choice', () => {
		localStorage.setItem('byl-theme', 'dark');
		getThemeStore().choose('dark');
		render(Page);

		expect(screen.getByRole('radio', { name: 'Hell' }).getAttribute('value')).toBe('light');
		expect(screen.getByRole('radio', { name: 'Dunkel' }).getAttribute('value')).toBe('dark');
		expect(screen.getByRole('radio', { name: 'Wie System' }).getAttribute('value')).toBe('system');
		expect(radios().map((radio) => [radio.value, radio.checked])).toEqual([
			['light', false],
			['dark', true],
			['system', false]
		]);
		for (const radio of radios()) {
			expect(radio.getAttribute('aria-describedby')).toBeTruthy();
			expect(radio.name).toBe(radios()[0]?.name);
		}
	});

	it('applies and stores a choice at once', async () => {
		render(Page);
		const light = radios().find((radio) => radio.value === 'light') as HTMLInputElement;

		await fireEvent.click(light);

		expect(light.checked).toBe(true);
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
		expect(localStorage.getItem('byl-theme')).toBe('light');
	});

	it('agrees with the menu in the header in both directions', async () => {
		render(ThemeMenu);
		render(Page);

		await fireEvent.click(radios().find((radio) => radio.value === 'dark') as HTMLInputElement);
		expect(screen.getByRole('button', { name: 'Darstellung: Dunkel' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Darstellung: Dunkel' }));
		await tick();
		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: 'Wie System' }));
		expect(radios().find((radio) => radio.checked)?.value).toBe('system');
		expect(localStorage.getItem('byl-theme')).toBeNull();
	});

	it('follows a choice made in another tab', async () => {
		render(Page);
		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-theme', newValue: 'light' }));
		await tick();
		expect(radios().find((radio) => radio.checked)?.value).toBe('light');
	});
});
