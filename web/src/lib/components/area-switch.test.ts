// Component tests for the area switch "Privat | <Haushalt>" (E7-3, ADR-0059 §1): for an account in a
// household the active area pressed and marked, a click changes the area at once and keeps the
// focus, the choice is remembered per device and account. Without a household (addendum "+") only
// "Privat" as the current area and a "+" to Einstellungen → Haushalt, the "+" not while the
// household loads, and it comes and goes with the membership without a reload.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { AreaStore } from '$lib/stores/area.svelte';
import AreaSwitchHarness from '$lib/test/AreaSwitchHarness.svelte';
import AreaSwitch from './AreaSwitch.svelte';

const USER = 'user00000000001';
const HOUSE = { id: 'house0000000001', name: 'Haus Beispiel' };
const ADD = 'Haushalt gründen oder beitreten';

function storage() {
	const values = new Map<string, string>();
	return {
		values,
		source: () => ({
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => void values.set(key, value)
		})
	};
}

/** `loading`: the household store did not answer yet. */
function setup(household: typeof HOUSE | null | 'loading', remembered: string | null = null) {
	const memory = storage();
	if (remembered !== null) memory.values.set(`byl-area:${USER}`, remembered);
	const apply = vi.fn<(scope: string | null) => void>();
	const changed = vi.fn();
	const store = new AreaStore(memory.source, apply, changed);
	store.begin(USER);
	if (household !== 'loading') store.followHousehold(household);
	render(AreaSwitchHarness, { props: { store } });
	return { store, apply, changed, memory };
}

const button = (name: string) => screen.getByRole('button', { name });
const group = () => screen.getByRole('group', { name: 'Bereich' });
const addLink = () => screen.queryByRole('link', { name: ADD });

/** "Privat" alone: the current area, no button. */
function expectPrivateOnly() {
	const current = group().querySelector('[aria-current="true"]');
	expect(current?.textContent?.trim()).toBe('Privat');
	expect(group().getAttribute('data-area')).toBe('private');
	expect(screen.queryByRole('button')).toBeNull();
}

describe('area switch', () => {
	it('is not shown outside the layout', () => {
		render(AreaSwitch);
		expect(screen.queryByRole('group', { name: 'Bereich' })).toBeNull();
		expect(addLink()).toBeNull();
	});

	it('shows "Privat" and a "+" to Einstellungen → Haushalt without a household', () => {
		setup(null);
		expectPrivateOnly();
		const add = addLink();
		expect(add?.getAttribute('href')).toBe('/einstellungen/haushalt');
		expect(add?.getAttribute('aria-label')).toBe(ADD);
		expect(add?.getAttribute('title')).toBe(ADD);
		expect(add?.classList.contains('button-icon')).toBe(true);
		expect(group().contains(add)).toBe(false);
	});

	it('shows only "Privat", without "+", while the household is not known yet', () => {
		setup('loading');
		expectPrivateOnly();
		expect(addLink()).toBeNull();
	});

	it('shows nothing while a remembered household loads, never "Privat" for the household', () => {
		const { store } = setup('loading', `household:${HOUSE.id}`);
		expect(store.active).toBe('household');
		expect(screen.queryByRole('group', { name: 'Bereich' })).toBeNull();
		expect(addLink()).toBeNull();
	});

	it('is a group "Bereich" with "Privat" and the name of the household, "Privat" pressed first', () => {
		setup(HOUSE);
		expect(group().contains(button('Privat'))).toBe(true);
		expect(group().contains(button('Haus Beispiel'))).toBe(true);
		expect(button('Privat').getAttribute('aria-pressed')).toBe('true');
		expect(button('Haus Beispiel').getAttribute('aria-pressed')).toBe('false');
		expect(group().getAttribute('data-area')).toBe('private');
		// A member has a choice and no "+".
		expect(addLink()).toBeNull();
	});

	it('drops the "+" when the account joins a household and shows it again when it is gone, without a reload', async () => {
		const { store, changed } = setup(null);
		expect(addLink()).not.toBeNull();

		// Founded or joined: the switch as for every member, still in "Privat".
		store.followHousehold(HOUSE);
		await tick();
		expect(addLink()).toBeNull();
		expect(button('Privat').getAttribute('aria-pressed')).toBe('true');
		expect(button('Haus Beispiel').getAttribute('aria-pressed')).toBe('false');
		expect(changed).not.toHaveBeenCalled();

		// Left, removed or dissolved while in the household: back to "Privat" with the "+".
		await fireEvent.click(button('Haus Beispiel'));
		store.followHousehold(null);
		await tick();
		expectPrivateOnly();
		expect(addLink()?.getAttribute('href')).toBe('/einstellungen/haushalt');
		expect(store.active).toBe('private');
		expect(changed).toHaveBeenLastCalledWith('household');
	});

	it('changes the area at once, keeps the focus and remembers it for this account', async () => {
		const { store, apply, changed, memory } = setup(HOUSE);
		apply.mockClear();
		const target = button('Haus Beispiel');
		target.focus();
		await fireEvent.click(target);

		expect(store.active).toBe('household');
		expect(store.key).toBe(`h:${HOUSE.id}`);
		expect(apply).toHaveBeenCalledWith(`h:${HOUSE.id}`);
		expect(changed).toHaveBeenCalledWith('switch');
		expect(memory.values.get(`byl-area:${USER}`)).toBe(`household:${HOUSE.id}`);
		expect(button('Haus Beispiel').getAttribute('aria-pressed')).toBe('true');
		expect(button('Privat').getAttribute('aria-pressed')).toBe('false');
		expect(document.activeElement).toBe(button('Haus Beispiel'));

		await fireEvent.click(button('Privat'));
		expect(store.key).toBe(`u:${USER}`);
		expect(memory.values.get(`byl-area:${USER}`)).toBe('private');
	});

	it('does nothing when the active area is chosen again', async () => {
		const { changed } = setup(HOUSE);
		await fireEvent.click(button('Privat'));
		expect(changed).not.toHaveBeenCalled();
	});

	it('shows a long name of the household in full as its title', () => {
		setup({ id: HOUSE.id, name: 'Haushalt mit einem sehr langen Namen, der nicht ganz passt' });
		const target = button('Haushalt mit einem sehr langen Namen, der nicht ganz passt');
		expect(target.getAttribute('title')).toBe(
			'Haushalt mit einem sehr langen Namen, der nicht ganz passt'
		);
	});
});
