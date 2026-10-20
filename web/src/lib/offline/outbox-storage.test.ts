// The storage of the outbox (OF-2, concept OF-0 §3.2, §3.9): the lease of the tabs and the running
// number of the device; the database of the browser is checked without creating it. IndexedDB itself
// runs in the browser of the smoke test (tests/mobile), jsdom has none.

import { describe, expect, it } from 'vitest';
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
