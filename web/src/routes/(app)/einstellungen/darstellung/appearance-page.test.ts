// Settings "Darstellung" (plan EH-8, ADR-0027 section 6, ADR-0029 section 7): three radios for the
// mode and four for the accent color, each in a named group, and the switch "Glas-Effekt" in the
// group "Transparenz", on the same stores as the menu in the header; a choice applies at once, is
// stored, and both controls agree in both directions and with other tabs. Since SF-6 the switch
// "Windows-Benachrichtigung" of the group "Hinweise" (ADR-0035 section 5).

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAccentStore } from '$lib/accent.svelte';
import { getNotifyStore } from '$lib/attention-notify.svelte';
import ThemeMenu from '$lib/components/ThemeMenu.svelte';
import { SETTINGS_SECTIONS } from '$lib/settings-sections';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { getThemeStore } from '$lib/theme.svelte';
import { getTransparencyStore, REDUCED_TRANSPARENCY_QUERY } from '$lib/transparency.svelte';
import Page from './+page.svelte';

useOverlayStubs();

afterEach(() => {
	getThemeStore().choose('system');
	getAccentStore().choose('petrol');
	getTransparencyStore().choose('on');
	getTransparencyStore().systemReduces = false;
	vi.unstubAllGlobals();
	localStorage.clear();
	document.documentElement.removeAttribute('data-theme');
	document.documentElement.removeAttribute('data-accent');
	document.documentElement.removeAttribute('data-transparency');
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
	it('is a page of the settings before "Konto", "Sicherung" (ADR-0046), "System" (ADR-0043) and "Hilfe"', () => {
		expect(SETTINGS_SECTIONS.map((section) => section.id).slice(-5)).toEqual([
			'darstellung',
			'konto',
			'sicherung',
			'system',
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
	it('offers the four accent themes as radios with swatch, name and description', () => {
		getAccentStore().choose('smaragd');
		render(Page);

		expect(accentRadios().map((radio) => [radio.value, radio.checked])).toEqual([
			['petrol', false],
			['rubin', false],
			['smaragd', true],
			['kupfer', false]
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
		expect(screen.getByRole('radio', { name: 'Kupfer' }).getAttribute('value')).toBe('kupfer');
		expect(screen.queryByRole('radio', { name: 'Purpur' })).toBeNull();
		expect(screen.queryByRole('radio', { name: 'Honig' })).toBeNull();
	});

	it('applies and stores a color at once and keeps the mode', async () => {
		getThemeStore().choose('dark');
		render(Page);

		await fireEvent.click(screen.getByRole('radio', { name: 'Kupfer' }));

		expect(document.documentElement.getAttribute('data-accent')).toBe('kupfer');
		expect(localStorage.getItem('byl-accent')).toBe('kupfer');
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

describe('appearance page: transparency (ADR-0029 section 7)', () => {
	function glassSwitch(): HTMLInputElement {
		const group = screen.getByRole('group', { name: 'Transparenz' });
		return within(group).getByRole('switch', { name: 'Glas-Effekt' }) as HTMLInputElement;
	}

	/** matchMedia that reports the system setting "reduce transparency". */
	function systemReduces(matches: boolean) {
		vi.stubGlobal(
			'matchMedia',
			vi.fn((media: string) => ({
				matches: media === REDUCED_TRANSPARENCY_QUERY && matches,
				media,
				addEventListener: () => undefined,
				removeEventListener: () => undefined
			}))
		);
	}

	it('offers a switch that is on by default and says what it does', () => {
		render(Page);
		const control = glassSwitch();

		expect(control.type).toBe('checkbox');
		expect(control.checked).toBe(true);
		const note = document.getElementById(control.getAttribute('aria-describedby') ?? '');
		expect(note?.textContent).toContain('Transparenz reduzieren');
		expect(screen.queryByText(/reduziert die Transparenz bereits/)).toBeNull();
	});

	it('turns the glass off and on at once and stores only "off"', async () => {
		render(Page);

		await fireEvent.click(glassSwitch());
		expect(glassSwitch().checked).toBe(false);
		expect(document.documentElement.getAttribute('data-transparency')).toBe('off');
		expect(localStorage.getItem('byl-transparency')).toBe('off');

		await fireEvent.click(glassSwitch());
		expect(glassSwitch().checked).toBe(true);
		expect(document.documentElement.hasAttribute('data-transparency')).toBe(false);
		expect(localStorage.getItem('byl-transparency')).toBeNull();
	});

	it('shows the stored choice', () => {
		getTransparencyStore().choose('off');
		render(Page);
		expect(glassSwitch().checked).toBe(false);
	});

	it('follows a choice made in another tab, also through the menu in the header', async () => {
		render(ThemeMenu);
		render(Page);
		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-transparency', newValue: 'off' }));
		await tick();
		expect(glassSwitch().checked).toBe(false);
		expect(document.documentElement.getAttribute('data-transparency')).toBe('off');
	});

	it('says so when the system setting already reduces transparency', async () => {
		systemReduces(true);
		render(Page);
		await tick();

		const hint = screen.getByText(/Die Systemeinstellung reduziert die Transparenz bereits/);
		expect(hint.closest('[data-tone]')?.getAttribute('data-tone')).toBe('info');
		// The switch stays usable: the choice counts again once the system setting is off.
		expect(glassSwitch().disabled).toBe(false);
	});
});

describe('appearance page: Windows notification (ADR-0035, SF-6)', () => {
	function notifySwitch(): HTMLInputElement {
		const group = screen.getByRole('group', { name: 'Hinweise' });
		return within(group).getByRole('switch', {
			name: 'Windows-Benachrichtigung'
		}) as HTMLInputElement;
	}

	/** Notification API whose request answers `answer`. */
	function browserAnswers(answer: NotificationPermission) {
		const request = vi.fn(async () => {
			FakeNotification.permission = answer;
			return answer;
		});
		class FakeNotification {
			static permission: NotificationPermission = 'default';
			static requestPermission = request;
		}
		vi.stubGlobal('Notification', FakeNotification);
		return request;
	}

	afterEach(() => {
		getNotifyStore().disable();
	});

	it('is off by default, says what it does and asks for the permission only on a click', async () => {
		const request = browserAnswers('granted');
		render(Page);
		const control = notifySwitch();

		expect(control.checked).toBe(false);
		expect(request).not.toHaveBeenCalled();
		const note = document.getElementById(control.getAttribute('aria-describedby') ?? '');
		expect(note?.textContent).toMatch(/Ein Klick darauf holt den Tab nach vorn/);

		await fireEvent.click(control);
		await vi.waitFor(() => expect(notifySwitch().checked).toBe(true));
		expect(request).toHaveBeenCalledOnce();
		expect(localStorage.getItem('byl-attention-notify')).toBe('on');

		await fireEvent.click(notifySwitch());
		expect(notifySwitch().checked).toBe(false);
		expect(localStorage.getItem('byl-attention-notify')).toBeNull();
	});

	it('stays off and says how to allow it when the browser blocks it', async () => {
		browserAnswers('denied');
		render(Page);

		await fireEvent.click(notifySwitch());
		await vi.waitFor(() =>
			expect(
				screen.getByText(/Benachrichtigungen sind für diese Seite im Browser blockiert/)
			).toBeTruthy()
		);
		expect(notifySwitch().checked).toBe(false);
		expect(localStorage.getItem('byl-attention-notify')).toBeNull();
	});

	it('is disabled in a browser without notifications', () => {
		vi.stubGlobal('Notification', undefined);
		render(Page);
		expect(notifySwitch().disabled).toBe(true);
		expect(screen.getByText(/Dieser Browser kann keine Benachrichtigungen zeigen/)).toBeTruthy();
	});
});
