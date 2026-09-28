// Helpers of the tests (ADR-0038): storage areas in memory and the hand-built pages of
// src/fixtures. Not part of the build (no entry point imports it).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** chrome.storage area in memory with the calls the extension uses. */
export class MemoryStorage implements chrome.storage.StorageArea {
	readonly values = new Map<string, unknown>();

	constructor(initial: Record<string, unknown> = {}) {
		for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
	}

	async get(keys: string | string[]): Promise<Record<string, unknown>> {
		const list = typeof keys === 'string' ? [keys] : keys;
		const result: Record<string, unknown> = {};
		for (const key of list) {
			if (this.values.has(key)) result[key] = structuredClone(this.values.get(key));
		}
		return result;
	}

	async set(items: Record<string, unknown>): Promise<void> {
		for (const [key, value] of Object.entries(items)) this.values.set(key, structuredClone(value));
	}

	async remove(keys: string | string[]): Promise<void> {
		for (const key of typeof keys === 'string' ? [keys] : keys) this.values.delete(key);
	}
}

/** Markup of a hand-built page in src/fixtures. */
export function fixture(name: string): string {
	return readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');
}

/** Replaces the body of the test document with a hand-built page. */
export function showFixture(name: string): void {
	document.body.innerHTML = fixture(name);
}
