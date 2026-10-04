// Settings "Haushalt" (ADR-0058, E7-2): the page takes the household store of the (app) layout,
// reads the household once more when it opens and shows it for every account, also for another
// account on another device (nothing of it acts on the machine of the app). The view itself is
// tested in lib/components/household/household-view.test.ts.

import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HouseholdState } from '$lib/domain/household';
import { HouseholdStore, type HouseholdData } from '$lib/stores/household.svelte';
import { MEMBER_CONTEXT, useContext } from '$lib/test/context';
import Page from './+page.svelte';

const STATE: HouseholdState = {
	household: { id: 'house000000001', name: 'Haus Beispiel', created: '', trashRetention: '30' },
	me: { member: 'member00000002', role: 'member', rights: [] },
	members: [
		{
			id: 'member00000001',
			user: 'user0000000001',
			name: 'Chris Beispiel',
			role: 'owner',
			rights: [],
			self: false
		},
		{
			id: 'member00000002',
			user: 'user0000000002',
			name: 'Anna Beispiel',
			role: 'member',
			rights: [],
			self: true
		}
	],
	invites: null
};

const mocks = vi.hoisted(() => ({ store: null as unknown }));

vi.mock('$lib/stores/household.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getHouseholdStore: () => mocks.store
}));

function storeWith(fetch: HouseholdData['fetch']): HouseholdStore {
	const refuse = async () => ({ kind: 'missing' as const });
	return new HouseholdStore(
		{
			fetch,
			found: refuse,
			rename: refuse,
			invite: refuse,
			revoke: refuse,
			join: refuse,
			setRights: refuse,
			remove: refuse,
			transfer: refuse,
			leave: refuse
		},
		{ ensureValid: () => true, logout: () => undefined }
	);
}

beforeEach(async () => {
	await useContext(MEMBER_CONTEXT);
});

describe('household page (E7-2)', () => {
	it('reads the household when it opens and shows it to another account', async () => {
		const fetch = vi.fn(async () => ({ kind: 'ok' as const, value: STATE }));
		mocks.store = storeWith(fetch);
		render(Page);
		await vi.waitFor(() =>
			expect(screen.getByRole('heading', { name: 'Haus Beispiel' })).toBeTruthy()
		);
		expect(fetch).toHaveBeenCalledOnce();
		expect(screen.getByRole('button', { name: 'Austreten …' })).toBeTruthy();
		expect(screen.queryByText(/nur am PC|Nur direkt am PC/)).toBeNull();
		expect(document.title).toBe('Haushalt · Einstellungen · becauseyoulovejira');
	});

	it('offers founding and joining without a household', async () => {
		mocks.store = storeWith(async () => ({ kind: 'ok' as const, value: null }));
		render(Page);
		await vi.waitFor(() =>
			expect(screen.getByRole('button', { name: 'Haushalt gründen' })).toBeTruthy()
		);
		expect(screen.getByRole('button', { name: 'Beitreten' })).toBeTruthy();
	});
});
