// The storage of the outbox (OF-2, concept OF-0 §3.2, §3.9): the lease of the tabs, the running
// number of the device and, since OF-2b, the compare-and-swap of one entry, since OF-3c the notices
// per account and the deletion that writes its notice in the same step; the database of the browser
// is checked without creating it. IndexedDB itself runs in the browser of the smoke test
// (tests/mobile), jsdom has none.

import { describe, expect, it } from 'vitest';
import type { OutboxAction } from '$lib/domain/offline';
import {
	MemoryOutboxStorage,
	OUTBOX_DATABASE,
	hasOutboxDatabase,
	mayLease
} from './outbox-storage';

describe('lease of the tabs', () => {
	it('is taken when free, ran out or the own one, and refused while another tab holds it', async () => {
		expect(mayLease(null, 'a', 0)).toBe(true);
		expect(mayLease({ tab: 'b', until: 100 }, 'a', 99)).toBe(false);
		expect(mayLease({ tab: 'b', until: 100 }, 'a', 100)).toBe(true);
		expect(mayLease({ tab: 'a', until: 100 }, 'a', 50)).toBe(true);

		const storage = new MemoryOutboxStorage();
		expect(await storage.lease('a', 0, 8000)).toBe(true);
		expect(await storage.lease('b', 7999, 8000)).toBe(false);
		expect(await storage.lease('b', 8000, 8000)).toBe(true);
		expect(storage.holder).toBe('b');
		await storage.release('a');
		expect(storage.holder).toBe('b');
		await storage.release('b');
		expect(storage.holder).toBeNull();
	});

	it('counts the order of the device on', async () => {
		const storage = new MemoryOutboxStorage();
		expect([await storage.nextSeq(), await storage.nextSeq()]).toEqual([1, 2]);
	});
});

describe('compare-and-swap of an entry (OF-2b)', () => {
	const entry = (state: OutboxAction['state']): OutboxAction => ({
		v: 1,
		op: 'zzzzzzzzzzzzzzzzzzz1',
		seq: 1,
		user: 'user00000000001',
		scope: '',
		kind: 'ticket.update',
		target: 'tick00000000001',
		dependsOn: [],
		payload: { status: 'done' },
		expected: { status: 'open' },
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		createdAt: 0,
		state,
		attempts: 0,
		nextAttemptAt: 0
	});

	const stateOf = (current: unknown) => (current as OutboxAction | undefined)?.state;

	it('writes or deletes only while the stored entry is the expected one', async () => {
		const storage = new MemoryOutboxStorage();
		const op = entry('queued').op;
		await storage.put(entry('queued'));
		const queued = (current: unknown) => stateOf(current) === 'queued';
		const sending = (current: unknown) => stateOf(current) === 'sending';
		const missing = (current: unknown) => current === undefined;
		expect(await storage.swap(op, queued, entry('sending'))).toBe(true);
		expect(storage.entries.get(op)).toMatchObject({ state: 'sending' });
		expect(await storage.swap(op, queued, null)).toBe(false);
		expect(storage.entries.size).toBe(1);
		expect(await storage.swap(op, sending, null)).toBe(true);
		expect(storage.entries.size).toBe(0);
		expect(await storage.swap(op, missing, null)).toBe(true);
	});

	it('deletes an entry and writes the notices of its account in one step, or neither (OF-3c)', async () => {
		const storage = new MemoryOutboxStorage();
		const op = entry('queued').op;
		await storage.put(entry('queued'));
		const user = 'user00000000001';
		const note = (current: unknown) => [...((current as unknown[] | undefined) ?? []), 'gelöscht'];
		const sending = (current: unknown) => stateOf(current) === 'sending';
		expect(await storage.swapNoting(op, sending, null, user, note)).toBe(false);
		expect(storage.entries.size).toBe(1);
		expect(await storage.notices(user)).toBeUndefined();
		const queued = (current: unknown) => stateOf(current) === 'queued';
		expect(await storage.swapNoting(op, queued, null, user, note)).toBe(true);
		expect(storage.entries.size).toBe(0);
		expect(await storage.notices(user)).toEqual(['gelöscht']);
	});
});

describe('the notices of an account (OF-3c)', () => {
	it('change in one step per account, stay as they are on null and go on an empty list', async () => {
		const storage = new MemoryOutboxStorage();
		const mine = 'user00000000001';
		const other = 'user00000000002';
		expect(await storage.notices(mine, () => ['a'])).toEqual(['a']);
		expect(await storage.notices(other, () => ['b'])).toEqual(['b']);
		expect(await storage.notices(mine, () => null)).toEqual(['a']);
		expect(await storage.notices(mine, (current) => [...(current as string[]), 'c'])).toEqual([
			'a',
			'c'
		]);
		expect(await storage.notices(mine, () => [])).toBeUndefined();
		expect(await storage.notices(other)).toEqual(['b']);
	});
});

/** A browser that names these databases. */
function browserWith(names: string[]): IDBFactory {
	const databases = async () => names.map((name) => ({ name, version: 1 }));
	return { databases } as unknown as IDBFactory;
}

describe('the database of the browser', () => {
	it('is found by its name without opening it, and missing where the browser cannot tell', async () => {
		expect(await hasOutboxDatabase(browserWith([OUTBOX_DATABASE]))).toBe(true);
		expect(await hasOutboxDatabase(browserWith(['other']))).toBe(false);
		expect(await hasOutboxDatabase({} as IDBFactory)).toBe(false);
		expect(await hasOutboxDatabase(undefined)).toBe(false);
	});
});
