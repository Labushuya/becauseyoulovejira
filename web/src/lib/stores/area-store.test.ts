// The area of the tab (E7-3, ADR-0059 §1, §2, §7 and §8): the remembered choice applies at once and
// gives way to "Privat" when the account is not (any more) a member; the switch and a link into the
// other area change it and tell the layout why; without a household nothing changes against before.

import { describe, expect, it, vi } from 'vitest';
import { AreaStore } from './area.svelte';

const USER = 'user00000000001';
const HOUSE = { id: 'house0000000001', name: 'Haus Beispiel' };

function setup(remembered: string | null = null, { blocked = false } = {}) {
	const values = new Map<string, string>();
	if (remembered !== null) values.set(`byl-area:${USER}`, remembered);
	const source = () => {
		if (blocked) throw new Error('blocked');
		return {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => void values.set(key, value)
		};
	};
	const apply = vi.fn<(scope: string | null) => void>();
	const changed = vi.fn();
	const store = new AreaStore(source, apply, changed);
	return { store, apply, changed, values };
}

describe('AreaStore', () => {
	it('starts in "Privat" without a remembered choice, also for an account without household', () => {
		const { store, apply, changed } = setup();
		store.begin(USER);
		expect(store.key).toBe(`u:${USER}`);
		expect(apply).toHaveBeenCalledWith(`u:${USER}`);
		expect(store.followHousehold(null)).toBe(false);
		expect(store.visible).toBe(false);
		expect(store.select('household')).toBe(false);
		expect(changed).not.toHaveBeenCalled();
	});

	it('knows whether there is a household only once the household store answered (the "+")', () => {
		const { store } = setup();
		store.begin(USER);
		expect(store.known).toBe(false);
		store.followHousehold(HOUSE);
		expect(store.known).toBe(true);
		store.followHousehold(null);
		expect(store.known).toBe(true);
		expect(store.visible).toBe(false);
	});

	it('takes the remembered household at once and keeps it while the account is a member', () => {
		const { store, apply, changed } = setup(`household:${HOUSE.id}`);
		store.begin(USER);
		expect(apply).toHaveBeenLastCalledWith(`h:${HOUSE.id}`);
		expect(store.active).toBe('household');
		expect(store.followHousehold(HOUSE)).toBe(false);
		expect(store.name).toBe('Haus Beispiel');
		expect(store.visible).toBe(true);
		// Renamed by another member: only the name follows.
		expect(store.followHousehold({ ...HOUSE, name: 'Neu' })).toBe(false);
		expect(store.name).toBe('Neu');
		expect(changed).not.toHaveBeenCalled();
	});

	it('lands in "Privat" when the household is gone, remembers that and says why', () => {
		const { store, apply, changed, values } = setup(`household:${HOUSE.id}`);
		store.begin(USER);
		store.followHousehold(HOUSE);
		expect(store.followHousehold(null)).toBe(true);
		expect(store.key).toBe(`u:${USER}`);
		expect(apply).toHaveBeenLastCalledWith(`u:${USER}`);
		expect(changed).toHaveBeenCalledWith('household');
		expect(values.get(`byl-area:${USER}`)).toBe('private');
		expect(store.visible).toBe(false);
	});

	it('gives way to "Privat" for a remembered household the account is not a member of', () => {
		const { store, changed } = setup('household:house0000000009');
		store.begin(USER);
		expect(store.followHousehold(HOUSE)).toBe(true);
		expect(store.active).toBe('private');
		expect(changed).toHaveBeenCalledWith('household');
	});

	it('stays in "Privat" when the account joins a household', () => {
		const { store, changed } = setup();
		store.begin(USER);
		store.followHousehold(null);
		expect(store.followHousehold(HOUSE)).toBe(false);
		expect(store.active).toBe('private');
		expect(store.visible).toBe(true);
		expect(changed).not.toHaveBeenCalled();
	});

	it('follows a link into the other area of the account, never into a foreign one', () => {
		const { store, changed } = setup();
		store.begin(USER);
		store.followHousehold(HOUSE);
		expect(store.showScope(`u:${USER}`)).toBe(false);
		expect(store.showScope('h:house0000000009')).toBe(false);
		expect(store.showScope('u:user00000000009')).toBe(false);
		expect(store.showScope(`h:${HOUSE.id}`)).toBe(true);
		expect(changed).toHaveBeenLastCalledWith('link');
		expect(store.key).toBe(`h:${HOUSE.id}`);
		expect(store.showScope(`u:${USER}`)).toBe(true);
		expect(store.key).toBe(`u:${USER}`);
	});

	it('works without storage and without an account', () => {
		const blocked = setup(null, { blocked: true });
		blocked.store.begin(USER);
		blocked.store.followHousehold(HOUSE);
		expect(blocked.store.select('household')).toBe(true);
		expect(blocked.store.key).toBe(`h:${HOUSE.id}`);

		const none = setup();
		none.store.begin(null);
		expect(none.store.key).toBe('');
		expect(none.apply).toHaveBeenCalledWith(null);
		expect(none.store.showScope(`h:${HOUSE.id}`)).toBe(false);
	});

	it('keeps the remembered choice of another account apart', () => {
		const { store, values } = setup();
		values.set('byl-area:user00000000002', `household:${HOUSE.id}`);
		store.begin(USER);
		expect(store.active).toBe('private');
	});
});
