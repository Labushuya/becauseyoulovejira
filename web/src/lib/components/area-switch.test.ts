// Component tests for the area switch "Privat | <Haushalt>" (E7-3, ADR-0059 §1): only for an account
// in a household, the active area pressed and marked, a click changes the area at once and keeps the
// focus, the choice is remembered per device and account.

import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { AreaStore } from '$lib/stores/area.svelte';
import AreaSwitchHarness from '$lib/test/AreaSwitchHarness.svelte';
import AreaSwitch from './AreaSwitch.svelte';

const USER = 'user00000000001';
const HOUSE = { id: 'house0000000001', name: 'Haus Beispiel' };

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

function setup(household: typeof HOUSE | null) {
	const memory = storage();
	const apply = vi.fn<(scope: string | null) => void>();
	const changed = vi.fn();
	const store = new AreaStore(memory.source, apply, changed);
	store.begin(USER);
	store.followHousehold(household);
	render(AreaSwitchHarness, { props: { store } });
	return { store, apply, changed, memory };
}

const button = (name: string) => screen.getByRole('button', { name });

describe('area switch', () => {
	it('is not shown without a household, and not outside the layout', () => {
		setup(null);
		expect(screen.queryByRole('group', { name: 'Bereich' })).toBeNull();
		render(AreaSwitch);
		expect(screen.queryByRole('group', { name: 'Bereich' })).toBeNull();
	});

	it('is a group "Bereich" with "Privat" and the name of the household, "Privat" pressed first', () => {
		setup(HOUSE);
		const group = screen.getByRole('group', { name: 'Bereich' });
		expect(group.contains(button('Privat'))).toBe(true);
		expect(group.contains(button('Haus Beispiel'))).toBe(true);
		expect(button('Privat').getAttribute('aria-pressed')).toBe('true');
		expect(button('Haus Beispiel').getAttribute('aria-pressed')).toBe('false');
		expect(group.getAttribute('data-area')).toBe('private');
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
