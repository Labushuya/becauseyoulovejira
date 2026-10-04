// The household store of the (app) layout (ADR-0058, E7-2): it loads once and again on every report
// of the server (byl/household) and after a reconnection; it asks the layout to load the page anew
// only when the membership of the tab begins or ends (not for founding, renaming or new rights),
// with what to say; it keeps a code only until it was handed on; and the notice survives the reload
// in the session storage of the tab, once.

import { describe, expect, it, vi } from 'vitest';
import type { HouseholdState } from '$lib/domain/household';
import {
	HOUSEHOLD_NOTICE_KEY,
	HouseholdStore,
	rememberHouseholdNotice,
	takeHouseholdNotice,
	type HouseholdData,
	type HouseholdLive,
	type HouseholdNotice
} from './household.svelte';

function state(id: string, name = 'Haus Beispiel'): HouseholdState {
	return {
		household: { id, name, created: '' },
		me: { member: 'member00000001', role: 'owner', rights: ['invite'] },
		members: [],
		invites: []
	};
}

function setup(answers: (HouseholdState | null)[], overrides: Partial<HouseholdData> = {}) {
	const queue = [...answers];
	const ok = <T>(value: T) => ({ kind: 'ok' as const, value });
	const data = {
		fetch: vi.fn(async () => ok(queue.length > 1 ? (queue.shift() ?? null) : (queue[0] ?? null))),
		found: vi.fn(async (name: string) => ok(state('house000000002', name))),
		rename: vi.fn(async (name: string) => ok(state('house000000001', name))),
		invite: vi.fn(async () =>
			ok({ code: 'ABCD-EFGH', invite: 'invite00000001', state: state('house000000001') })
		),
		revoke: vi.fn(async () => ok(state('house000000001'))),
		join: vi.fn(async () => ok(state('house000000001'))),
		setRights: vi.fn(async () => ok(state('house000000001'))),
		remove: vi.fn(async () => ok(state('house000000001'))),
		transfer: vi.fn(async () => ok(state('house000000001'))),
		leave: vi.fn(async () => ok(null)),
		...overrides
	} satisfies HouseholdData;
	const notices: HouseholdNotice[] = [];
	const logout = vi.fn();
	const store = new HouseholdStore(data, { ensureValid: () => true, logout }, undefined, (notice) =>
		notices.push(notice)
	);
	return { store, data, notices, logout };
}

describe('HouseholdStore', () => {
	it('loads without a notice, and asks for a reload when the membership ends elsewhere', async () => {
		const { store, notices } = setup([
			state('house000000001'),
			state('house000000001', 'Neu'),
			null
		]);
		await store.load();
		expect(store.state).toBe('ready');
		expect(notices).toEqual([]);
		// Renamed by another member: same household, no reload.
		await store.load();
		expect(store.household?.household.name).toBe('Neu');
		expect(notices).toEqual([]);
		// Removed by another member.
		await store.load();
		expect(store.household).toBeNull();
		expect(notices).toEqual([{ title: 'Du bist nicht mehr Mitglied im Haushalt „Neu“.' }]);
	});

	it('asks for a reload when another tab joins a household, with the general text', async () => {
		const { store, notices } = setup([null, state('house000000001')]);
		await store.load();
		await store.load();
		expect(notices).toEqual([{ title: 'Deine Mitgliedschaft im Haushalt hat sich geändert.' }]);
	});

	it('founds without a reload, but joins and leaves with one', async () => {
		const first = setup([null]);
		await first.store.load();
		expect(await first.store.found('  Haus  ')).toEqual({ ok: true });
		expect(first.data.found).toHaveBeenCalledWith('Haus', expect.anything());
		expect(first.notices).toEqual([]);

		const second = setup([null]);
		await second.store.load();
		expect(await second.store.join('abcd-efgh')).toEqual({ ok: true });
		expect(second.notices).toEqual([
			{ title: 'Du bist dem Haushalt „Haus Beispiel“ beigetreten.' }
		]);

		const third = setup([state('house000000001')]);
		await third.store.load();
		expect(await third.store.leave()).toBe(true);
		expect(third.notices).toEqual([
			{
				title: 'Du bist aus dem Haushalt „Haus Beispiel“ ausgetreten.',
				text: 'Deine Einträge im Haushalt bleiben dort.'
			}
		]);
	});

	it('checks names before sending and names refusals, the rate limit and the restart', async () => {
		const { store, data } = setup([null], {
			join: vi
				.fn()
				.mockResolvedValueOnce({ kind: 'invalid', problem: 'code' })
				.mockResolvedValueOnce({ kind: 'rate' })
				.mockResolvedValueOnce({ kind: 'missing' })
		});
		await store.load();
		expect(await store.found('   ')).toEqual({ ok: false, message: 'Bitte einen Namen eingeben.' });
		expect(data.found).not.toHaveBeenCalled();
		expect(await store.join('')).toEqual({ ok: false, message: 'Code ungültig oder abgelaufen.' });
		expect(data.join).not.toHaveBeenCalled();
		expect(await store.join('x')).toEqual({ ok: false, message: 'Code ungültig oder abgelaufen.' });
		expect((await store.join('x')).ok).toBe(false);
		const restart = await store.join('x');
		expect(restart.ok === false && restart.message).toMatch(
			/Der Haushalt ist nach dem nächsten Neustart verfügbar/
		);
	});

	it('keeps a new code until it is dismissed, and reads the household again after a refusal', async () => {
		const { store, data } = setup([state('house000000001')], {
			revoke: vi.fn(async () => ({ kind: 'invalid' as const, problem: 'right' }))
		});
		await store.load();
		expect(await store.createInvite()).toBe(true);
		expect(store.shownCode?.code).toBe('ABCD-EFGH');
		store.dismissCode();
		expect(store.shownCode).toBeNull();
		const invite = {
			id: 'invite00000001',
			status: 'open' as const,
			created: '',
			expires: '',
			ended: '',
			createdBy: '',
			usedBy: ''
		};
		expect(await store.revoke(invite)).toBe(false);
		expect(store.message).toEqual({
			title: 'Nicht möglich',
			text: 'Dafür fehlt dir das Recht im Haushalt.'
		});
		await vi.waitFor(() => expect(data.fetch).toHaveBeenCalledTimes(2));
	});

	it('reads again on byl/household and after a reconnection, and stops with the cleanup', async () => {
		const { store, data } = setup([null]);
		const callbacks: Record<string, () => void> = {};
		const stops: string[] = [];
		const live: HouseholdLive = {
			changes: async (onChange) => {
				callbacks.changes = onChange;
				return async () => void stops.push('changes');
			},
			reconnected: async (callback) => {
				callbacks.reconnected = callback;
				return async () => void stops.push('reconnected');
			}
		};
		const stop = store.connect(live);
		await vi.waitFor(() => expect(callbacks.changes).toBeDefined());
		callbacks.changes?.();
		await vi.waitFor(() => expect(data.fetch).toHaveBeenCalledTimes(1));
		callbacks.reconnected?.();
		await vi.waitFor(() => expect(data.fetch).toHaveBeenCalledTimes(2));
		stop();
		await vi.waitFor(() => expect(stops.sort()).toEqual(['changes', 'reconnected']));
	});
});

describe('notice after loading anew', () => {
	it('survives once in the session storage and ignores anything else', () => {
		const storage = new Map<string, string>();
		const fake = {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => void storage.set(key, value),
			removeItem: (key: string) => void storage.delete(key)
		};
		rememberHouseholdNotice(fake, { title: 'Weg', text: 'Mehr' });
		expect(takeHouseholdNotice(fake)).toEqual({ title: 'Weg', text: 'Mehr' });
		expect(takeHouseholdNotice(fake)).toBeNull();
		for (const raw of ['kaputt', '{"title":5}', '{"title":""}', 'null']) {
			storage.set(HOUSEHOLD_NOTICE_KEY, raw);
			expect(takeHouseholdNotice(fake), raw).toBeNull();
			expect(storage.has(HOUSEHOLD_NOTICE_KEY)).toBe(false);
		}
		expect(takeHouseholdNotice(null)).toBeNull();
		rememberHouseholdNotice(null, { title: 'x' });
	});
});
