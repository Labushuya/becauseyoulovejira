// Rules for a new build while a tab is open (ADR-0040): which errors mean a module could not be
// loaded, the loop guard of the automatic load, and when a navigation becomes a full page load.

import { describe, expect, it } from 'vitest';
import {
	MODULE_LOAD_MESSAGE,
	RELOAD_ATTEMPT_KEY,
	RELOAD_GUARD_MS,
	UNEXPECTED_MESSAGE,
	claimReload,
	describeClientError,
	isModuleLoadError,
	sessionStorageOf,
	shouldReloadOnNavigate
} from './app-update';

function memoryStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
		values
	};
}

describe('isModuleLoadError', () => {
	it.each([
		'Failed to fetch dynamically imported module: http://127.0.0.1:8090/_app/immutable/nodes/9.abc.js',
		'error loading dynamically imported module: http://127.0.0.1:8090/_app/immutable/nodes/9.abc.js',
		'Importing a module script failed.',
		'Unable to preload CSS for http://127.0.0.1:8090/_app/immutable/assets/9.abc.css'
	])('knows "%s"', (message) => {
		expect(isModuleLoadError(new TypeError(message))).toBe(true);
	});

	it('ignores other errors and values that are no errors', () => {
		expect(isModuleLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
		expect(isModuleLoadError('Failed to fetch dynamically imported module')).toBe(false);
		expect(isModuleLoadError(null)).toBe(false);
	});
});

describe('describeClientError', () => {
	it('marks a module that could not be loaded and keeps technical text out', () => {
		expect(
			describeClientError(new TypeError('Failed to fetch dynamically imported module: x'))
		).toEqual({
			message: MODULE_LOAD_MESSAGE,
			kind: 'module-load'
		});
		expect(describeClientError(new Error('boom'))).toEqual({ message: UNEXPECTED_MESSAGE });
	});
});

describe('claimReload', () => {
	const href = 'http://127.0.0.1:8090/projekte';

	it('allows one automatic load per address and notes it', () => {
		const storage = memoryStorage();
		expect(claimReload(storage, href, 1_000)).toBe(true);
		expect(JSON.parse(storage.values.get(RELOAD_ATTEMPT_KEY) ?? '')).toEqual({ href, at: 1_000 });
		expect(claimReload(storage, href, 1_000 + RELOAD_GUARD_MS - 1)).toBe(false);
	});

	it('allows it again for another address or after the guard time', () => {
		const storage = memoryStorage();
		claimReload(storage, href, 1_000);
		expect(claimReload(storage, 'http://127.0.0.1:8090/eingang', 2_000)).toBe(true);
		expect(claimReload(storage, href, 2_000 + RELOAD_GUARD_MS)).toBe(true);
	});

	it('never loads by itself without storage or with a broken entry it cannot write over', () => {
		expect(claimReload(null, href, 1_000)).toBe(false);
		const broken = {
			getItem: () => '{',
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		};
		expect(claimReload(broken, href, 1_000)).toBe(false);
	});

	it('treats an entry with a time in the future or of another shape as no attempt', () => {
		expect(
			claimReload(
				memoryStorage({ [RELOAD_ATTEMPT_KEY]: JSON.stringify({ href, at: 5_000 }) }),
				href,
				1_000
			)
		).toBe(true);
		expect(claimReload(memoryStorage({ [RELOAD_ATTEMPT_KEY]: '"text"' }), href, 1_000)).toBe(true);
	});
});

describe('sessionStorageOf', () => {
	it('returns null when the browser blocks the storage', () => {
		const blocked = {
			get sessionStorage(): Storage {
				throw new Error('SecurityError');
			}
		} as unknown as Window;
		expect(sessionStorageOf(blocked)).toBeNull();
		expect(sessionStorageOf(window)).toBe(window.sessionStorage);
	});
});

describe('shouldReloadOnNavigate', () => {
	const calm = { updated: true, type: 'link', willUnload: false, busy: false };

	it('turns the next click on a link after an update into a full page load', () => {
		expect(shouldReloadOnNavigate(calm)).toBe(true);
	});

	it('stays a normal navigation without update, for other kinds, when leaving anyway or while busy', () => {
		expect(shouldReloadOnNavigate({ ...calm, updated: false })).toBe(false);
		for (const type of ['goto', 'popstate', 'form', 'enter', 'leave']) {
			expect(shouldReloadOnNavigate({ ...calm, type }), type).toBe(false);
		}
		expect(shouldReloadOnNavigate({ ...calm, willUnload: true })).toBe(false);
		expect(shouldReloadOnNavigate({ ...calm, busy: true })).toBe(false);
	});
});
