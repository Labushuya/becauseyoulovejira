// Names of the connections for the inbox and the sources of a ticket (ADR-0026, addendum KK-3):
// loaded once, followed through realtime (renamed, new, deleted), loaded again after a
// reconnection; a lost session logs out, other failures leave the names as they were.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RecordChange } from '$lib/data/realtime';
import type { ConnectionName } from '$lib/domain/connections';
import { ConnectionNamesStore, type ConnectionNamesData } from './connection-names.svelte';
import { LiveHealth } from './live-health.svelte';

function fake(names: ConnectionName[] = [{ id: 'conn1', label: 'Gmail' }]) {
	let onChange: ((change: RecordChange<ConnectionName>) => void) | null = null;
	let onReconnect: (() => void) | null = null;
	const data = {
		list: vi.fn<ConnectionNamesData['list']>(async () => names),
		subscribe: vi.fn<ConnectionNamesData['subscribe']>(async (callback) => {
			onChange = callback;
			return async () => undefined;
		}),
		reconnected: vi.fn<ConnectionNamesData['reconnected']>(async (callback) => {
			onReconnect = callback;
			return async () => undefined;
		})
	} satisfies ConnectionNamesData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const store = new ConnectionNamesStore(data, session, { health: new LiveHealth() });
	return {
		data,
		session,
		store,
		emit: (change: RecordChange<ConnectionName>) => onChange?.(change),
		reconnect: () => onReconnect?.()
	};
}

describe('ConnectionNamesStore', () => {
	it('names a connection once loaded, and nothing without one', async () => {
		const { store } = fake();
		expect(store.nameOf('conn1')).toBeNull();
		await store.load();
		expect(store.nameOf('conn1')).toBe('Gmail');
		for (const id of [undefined, null, '', 'conn9']) expect(store.nameOf(id)).toBeNull();
	});

	it('follows renames, new and deleted connections through realtime', async () => {
		const { store, emit, data } = fake();
		const stop = store.start();
		await vi.waitFor(() => expect(store.nameOf('conn1')).toBe('Gmail'));
		await vi.waitFor(() => expect(data.subscribe).toHaveBeenCalledOnce());
		emit({ action: 'update', record: { id: 'conn1', label: 'Gmail Arbeit' } });
		expect(store.nameOf('conn1')).toBe('Gmail Arbeit');
		emit({ action: 'create', record: { id: 'conn2', label: 'Familienchat' } });
		expect(store.nameOf('conn2')).toBe('Familienchat');
		emit({ action: 'delete', id: 'conn1' });
		expect(store.nameOf('conn1')).toBeNull();
		stop();
		// The cleanup empties the store (a logout leaves no names behind).
		expect(store.nameOf('conn2')).toBeNull();
	});

	it('loads again after a reconnection, so missed renames arrive', async () => {
		const { store, data, reconnect } = fake();
		const stop = store.start();
		await vi.waitFor(() => expect(data.reconnected).toHaveBeenCalledOnce());
		data.list.mockResolvedValueOnce([{ id: 'conn1', label: 'Neu' }]);
		reconnect();
		await vi.waitFor(() => expect(store.nameOf('conn1')).toBe('Neu'));
		expect(data.list).toHaveBeenCalledTimes(2);
		stop();
	});

	it('logs out on a lost session and keeps the names on other failures', async () => {
		const { store, data, session } = fake();
		await store.load();
		data.list.mockRejectedValueOnce(new DataError('network'));
		await store.load();
		expect(store.nameOf('conn1')).toBe('Gmail');
		expect(session.logout).not.toHaveBeenCalled();
		data.list.mockRejectedValueOnce(new DataError('session'));
		await store.load();
		expect(session.logout).toHaveBeenCalledOnce();
	});
});
