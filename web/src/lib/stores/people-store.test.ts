// Names of the visible accounts for comments, history and the trash (ADR-0056 §4): loaded once,
// followed through realtime (renamed, new, deleted), loaded again after a reconnection; a lost
// session logs out, other failures leave the names as they were; an account without a name stays
// "Anderes Konto" in personLabel.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RecordChange } from '$lib/data/realtime';
import { OTHER_LABEL, personLabel, type PersonName } from '$lib/domain/people';
import { LiveHealth } from './live-health.svelte';
import { PeopleStore, type PeopleData } from './people.svelte';

function fake(names: PersonName[] = [{ id: 'user2', name: 'Anna Beispiel' }]) {
	let onChange: ((change: RecordChange<PersonName>) => void) | null = null;
	let onReconnect: (() => void) | null = null;
	const data = {
		list: vi.fn<PeopleData['list']>(async () => names),
		subscribe: vi.fn<PeopleData['subscribe']>(async (callback) => {
			onChange = callback;
			return async () => undefined;
		}),
		reconnected: vi.fn<PeopleData['reconnected']>(async (callback) => {
			onReconnect = callback;
			return async () => undefined;
		})
	} satisfies PeopleData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const store = new PeopleStore(data, session, { health: new LiveHealth() });
	return {
		data,
		session,
		store,
		emit: (change: RecordChange<PersonName>) => onChange?.(change),
		reconnect: () => onReconnect?.()
	};
}

describe('PeopleStore', () => {
	it('names a visible account once loaded, and nothing for one without a name', async () => {
		const { store } = fake([
			{ id: 'user2', name: 'Anna Beispiel' },
			{ id: 'user3', name: '' }
		]);
		expect(store.nameOf('user2')).toBeNull();
		await store.load();
		expect(store.nameOf('user2')).toBe('Anna Beispiel');
		expect(store.nameOf('user3')).toBeNull();
		expect(store.nameOf('user9')).toBeNull();
		expect(personLabel('user2', 'user1', store)).toBe('Anna Beispiel');
		expect(personLabel('user3', 'user1', store)).toBe(OTHER_LABEL);
	});

	it('follows new names through realtime and empties itself on cleanup', async () => {
		const { store, emit, data } = fake();
		const stop = store.start();
		await vi.waitFor(() => expect(store.nameOf('user2')).toBe('Anna Beispiel'));
		await vi.waitFor(() => expect(data.subscribe).toHaveBeenCalledOnce());
		emit({ action: 'update', record: { id: 'user2', name: 'Anna B.' } });
		expect(store.nameOf('user2')).toBe('Anna B.');
		emit({ action: 'create', record: { id: 'user4', name: 'Bert Beispiel' } });
		expect(store.nameOf('user4')).toBe('Bert Beispiel');
		emit({ action: 'delete', id: 'user2' });
		expect(store.nameOf('user2')).toBeNull();
		stop();
		expect(store.nameOf('user4')).toBeNull();
	});

	it('loads again after a reconnection', async () => {
		const { store, data, reconnect } = fake();
		const stop = store.start();
		await vi.waitFor(() => expect(data.reconnected).toHaveBeenCalledOnce());
		data.list.mockResolvedValueOnce([{ id: 'user2', name: 'Neu' }]);
		reconnect();
		await vi.waitFor(() => expect(store.nameOf('user2')).toBe('Neu'));
		stop();
	});

	it('logs out on a lost session and keeps the names on other failures', async () => {
		const { store, data, session } = fake();
		await store.load();
		data.list.mockRejectedValueOnce(new DataError('network'));
		await store.load();
		expect(store.nameOf('user2')).toBe('Anna Beispiel');
		expect(session.logout).not.toHaveBeenCalled();
		data.list.mockRejectedValueOnce(new DataError('session'));
		await store.load();
		expect(session.logout).toHaveBeenCalledOnce();
	});
});
