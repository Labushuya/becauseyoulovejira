// The mark of the open setups at "Kanäle" (KE-1, ADR-0076 §2): in the navigation of the settings
// and in the sheet "Mehr" of the phone frame, the number visible and its meaning in the name of the
// link, nothing while nothing is open or the state is unknown.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSetupsOf } from '$lib/domain/open-setups';
import { visibleSettingsSections } from '$lib/settings-sections';
import { OpenSetupsStore } from '$lib/stores/open-setups.svelte';
import { connectionOf } from '$lib/test/connections-fake';
import OpenSetupsContextHarness from '$lib/test/OpenSetupsContextHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import SettingsNav from './SettingsNav.svelte';

const mocks = vi.hoisted(() => ({
	page: {
		url: new URL('http://localhost:3000/tagesplan'),
		route: { id: '/(app)/tagesplan' as string | null }
	},
	goto: vi.fn(async () => undefined),
	auth: { email: 'anna@example.com', logout: vi.fn() }
}));

vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/auth.svelte', () => ({ auth: mocks.auth }));

useOverlayStubs();

afterEach(() => {
	document.body.innerHTML = '';
});

function storeWith(count: number): OpenSetupsStore {
	const store = new OpenSetupsStore(
		{
			list: vi.fn(),
			secretStatus: vi.fn(),
			inboxKeys: vi.fn(),
			extensionBuilt: vi.fn()
		},
		{ ensureValid: () => true, logout: vi.fn() }
	);
	const connections = Array.from({ length: count }, (_, index) =>
		connectionOf({ id: `conn0000000004${index}`, label: `Kalender ${index}` })
	);
	store.adopt(
		openSetupsOf({
			connections,
			status: () => ({ secret: true, allowlist: null }),
			keys: null,
			extensionBuilt: null
		})
	);
	return store;
}

describe('mark at "Kanäle" in the navigation of the settings', () => {
	const sections = visibleSettingsSections('windows', 'full');

	it('shows the number and says it to screen readers in the name of the link', () => {
		render(SettingsNav, {
			props: {
				sections,
				current: null,
				backHref: '/',
				backLabel: 'Zurück zu Aufgaben',
				marks: { kanaele: { count: 2, text: '2 Einrichtungen offen' } }
			}
		});
		const link = screen.getByRole('link', { name: 'Kanäle (2 Einrichtungen offen)' });
		expect(link.getAttribute('href')).toBe('/einstellungen/kanaele');
		expect(link.querySelector('[aria-hidden="true"]')?.textContent).toBe('2');
		// Only "Kanäle" carries it.
		expect(screen.getByRole('link', { name: 'Tags' })).toBeTruthy();
	});

	it('has no mark without open setups', () => {
		render(SettingsNav, {
			props: { sections, current: 'kanaele', backHref: '/', backLabel: 'Zurück zu Aufgaben' }
		});
		expect(screen.getByRole('link', { name: 'Kanäle' }).getAttribute('aria-current')).toBe('page');
		expect(document.querySelector('.mark-count')).toBeNull();
	});
});

describe('mark at "Kanäle" in the sheet "Mehr" of the phone frame', () => {
	async function openMore(store: OpenSetupsStore) {
		render(OpenSetupsContextHarness, { props: { store } });
		const nav = screen.getByRole('navigation', { name: 'Hauptnavigation' });
		await fireEvent.click(within(nav).getByRole('button', { name: /^Mehr/ }));
		await tick();
		return within(screen.getByRole('dialog', { name: 'Mehr' }));
	}

	it('names the open setups at "Kanäle"', async () => {
		const sheet = await openMore(storeWith(1));
		const link = sheet.getByRole('link', { name: /^Kanäle/ });
		expect(link.textContent?.replace(/\s+/g, ' ').trim()).toBe('Kanäle 1(1 Einrichtung offen)');
		expect(link.getAttribute('href')).toBe('/einstellungen/kanaele');
	});

	it('shows no number while nothing is open', async () => {
		const sheet = await openMore(storeWith(0));
		expect(sheet.getByRole('link', { name: /^Kanäle/ }).textContent?.trim()).toBe('Kanäle');
	});
});
