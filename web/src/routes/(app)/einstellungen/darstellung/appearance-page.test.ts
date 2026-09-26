// Settings "Darstellung" (plan EH-8, ADR-0027 section 6): three radios for the mode and five for the
// accent color, each in a named group, on the same stores as the menu in the header; a choice
// applies at once, is stored, and both controls agree in both directions and with other tabs.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { getAccentStore } from '$lib/accent.svelte';
import ThemeMenu from '$lib/components/ThemeMenu.svelte';
import { SETTINGS_SECTIONS } from '$lib/settings-sections';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { getThemeStore } from '$lib/theme.svelte';
import Page from './+page.svelte';

useOverlayStubs();

afterEach(() => {
	getThemeStore().choose('system');
	getAccentStore().choose('petrol');
	localStorage.clear();
	document.documentElement.removeAttribute('data-theme');
	document.documentElement.removeAttribute('data-accent');
});

function radios(): HTMLInputElement[] {
	const group = screen.getByRole('group', { name: 'Farbschema' });
	return within(group).getAllByRole('radio') as HTMLInputElement[];
}

function accentRadios(): HTMLInputElement[] {
	const group = screen.getByRole('group', { name: 'Farbe' });
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

describe('appearance page: color (ADR-0027)', () => {
	it('offers the five accent themes as radios with swatch, name and description', () => {
		getAccentStore().choose('purpur');
		render(Page);

		expect(accentRadios().map((radio) => [radio.value, radio.checked])).toEqual([
			['petrol', false],
			['rubin', false],
			['purpur', true],
			['smaragd', false],
			['honig', false]
		]);
		for (const radio of accentRadios()) {
			expect(radio.name).toBe(accentRadios()[0]?.name);
			expect(radio.name).not.toBe(radios()[0]?.name);
			expect(radio.getAttribute('aria-describedby')).toBeTruthy();
			const swatch = radio.closest('label')?.querySelector<HTMLElement>('.swatch');
			expect(swatch?.getAttribute('aria-hidden')).toBe('true');
			expect(swatch?.style.getPropertyValue('--swatch')).toBe(`var(--swatch-${radio.value})`);
		}
		expect(screen.getByRole('radio', { name: 'Smaragd' }).getAttribute('value')).toBe('smaragd');
		expect(screen.getByRole('radio', { name: 'Honig' }).getAttribute('value')).toBe('honig');
	});

	it('applies and stores a color at once and keeps the mode', async () => {
		getThemeStore().choose('dark');
		render(Page);

		await fireEvent.click(screen.getByRole('radio', { name: 'Honig' }));

		expect(document.documentElement.getAttribute('data-accent')).toBe('honig');
		expect(localStorage.getItem('byl-accent')).toBe('honig');
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		expect(radios().find((radio) => radio.checked)?.value).toBe('dark');

		await fireEvent.click(screen.getByRole('radio', { name: 'Petrol' }));

		expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
		expect(localStorage.getItem('byl-accent')).toBeNull();
	});

	it('agrees with the menu in the header in both directions', async () => {
		render(ThemeMenu);
		render(Page);

		await fireEvent.click(screen.getByRole('radio', { name: 'Rubin' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Darstellung: System' }));
		await tick();
		expect(
			screen
				.getByRole('menuitemradio', { hidden: true, name: 'Rubin' })
				.getAttribute('aria-checked')
		).toBe('true');

		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: 'Smaragd' }));
		expect(accentRadios().find((radio) => radio.checked)?.value).toBe('smaragd');
		expect(localStorage.getItem('byl-accent')).toBe('smaragd');
	});

	it('follows a color chosen in another tab', async () => {
		render(Page);
		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-accent', newValue: 'rubin' }));
		await tick();
		expect(accentRadios().find((radio) => radio.checked)?.value).toBe('rubin');
	});
});
