// FOUC protection (ADR-0025 section 10, ADR-0027 section 6; plan UI-Konsistenz, package UI-2): runs
// the inline script of app.html in jsdom with a prepared storage. It applies only valid values for
// the mode and the accent theme, moves td-theme to byl-theme once and survives a storage that
// throws. The keys and the allowlist must match theme.svelte.ts and accent.svelte.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCENT_STORAGE_KEY, LEGACY_ACCENTS, STORED_ACCENTS } from './accent.svelte';
import { LEGACY_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from './theme.svelte';

const APP_HTML = readFileSync(join(import.meta.dirname, '..', 'app.html'), 'utf8');

/** The inline script that mentions the theme key. */
function bootScript(): string {
	const scripts = [...APP_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
	const script = scripts.find((text) => text?.includes(THEME_STORAGE_KEY));
	if (script === undefined) throw new Error('app.html has no theme script');
	return script;
}

type FakeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storageWith(entries: Record<string, string>): FakeStorage & { data: Map<string, string> } {
	const data = new Map(Object.entries(entries));
	return {
		data,
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => void data.set(key, String(value)),
		removeItem: (key) => void data.delete(key)
	};
}

/** Runs the script with its own localStorage and the document of jsdom. */
function boot(storage: FakeStorage) {
	new Function('localStorage', 'document', bootScript())(storage, document);
	return document.documentElement.getAttribute('data-theme');
}

/** Runs the script and returns the accent it set. */
function bootAccent(storage: FakeStorage) {
	boot(storage);
	return document.documentElement.getAttribute('data-accent');
}

afterEach(() => {
	document.documentElement.removeAttribute('data-theme');
	document.documentElement.removeAttribute('data-accent');
});

describe('theme boot script in app.html', () => {
	it('uses the keys of theme.svelte.ts', () => {
		expect(bootScript()).toContain(`'${THEME_STORAGE_KEY}'`);
		expect(bootScript()).toContain(`'${LEGACY_THEME_STORAGE_KEY}'`);
	});

	it('stands before the head of SvelteKit, so it runs before the styles load', () => {
		expect(APP_HTML.indexOf(THEME_STORAGE_KEY)).toBeLessThan(APP_HTML.indexOf('%sveltekit.head%'));
	});

	it.each([
		['light', 'light'],
		['dark', 'dark']
	])('applies the stored choice %s', (value, expected) => {
		expect(boot(storageWith({ 'byl-theme': value }))).toBe(expected);
	});

	it.each(['system', 'Dark', 'x" onload="', ''])('ignores the invalid value %j', (value) => {
		expect(boot(storageWith({ 'byl-theme': value }))).toBeNull();
	});

	it('sets nothing without a stored choice (system setting)', () => {
		expect(boot(storageWith({}))).toBeNull();
	});

	it('moves a valid td-theme to byl-theme once and removes it', () => {
		const storage = storageWith({ 'td-theme': 'dark' });

		expect(boot(storage)).toBe('dark');
		expect(storage.data.get('byl-theme')).toBe('dark');
		expect(storage.data.has('td-theme')).toBe(false);
	});

	it('drops an invalid td-theme without taking it over', () => {
		const storage = storageWith({ 'td-theme': 'purple' });

		expect(boot(storage)).toBeNull();
		expect(storage.data.has('byl-theme')).toBe(false);
		expect(storage.data.has('td-theme')).toBe(false);
	});

	it('keeps byl-theme when both keys exist', () => {
		const storage = storageWith({ 'byl-theme': 'light', 'td-theme': 'dark' });

		expect(boot(storage)).toBe('light');
		expect(storage.data.get('byl-theme')).toBe('light');
	});

	it('does not break when the storage throws', () => {
		const blocked = {
			getItem: () => {
				throw new Error('SecurityError');
			},
			setItem: () => undefined,
			removeItem: () => undefined
		};

		expect(() => boot(blocked)).not.toThrow();
		expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
		expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
	});
});

describe('accent boot script in app.html (ADR-0027)', () => {
	it('uses the key and exactly the allowlist of accent.svelte.ts', () => {
		const script = bootScript();
		expect(script).toContain(`'${ACCENT_STORAGE_KEY}'`);
		const list = /var accents = \[([^\]]*)\]/.exec(script)?.[1];
		expect(list?.split(',').map((entry) => entry.trim().replace(/'/g, ''))).toEqual([
			...STORED_ACCENTS
		]);
	});

	it.each(STORED_ACCENTS)('applies the stored accent %s before the first paint', (accent) => {
		expect(bootAccent(storageWith({ 'byl-accent': accent }))).toBe(accent);
	});

	it.each(['petrol', 'Rubin', 'lila', "rubin' onload='x", '', 'dark'])(
		'ignores the value %j (Petrol stays)',
		(value) => {
			expect(bootAccent(storageWith({ 'byl-accent': value }))).toBeNull();
		}
	);

	it('sets nothing without a stored accent', () => {
		expect(bootAccent(storageWith({}))).toBeNull();
	});

	it('sets mode and accent independently', () => {
		const storage = storageWith({ 'byl-theme': 'dark', 'byl-accent': 'kupfer' });

		expect(boot(storage)).toBe('dark');
		expect(document.documentElement.getAttribute('data-accent')).toBe('kupfer');
	});

	it('turns a stored "honig" into "kupfer" once, like accent.svelte.ts (addendum 2026-09-27)', () => {
		const storage = storageWith({ 'byl-accent': 'honig' });

		expect(bootAccent(storage)).toBe('kupfer');
		expect(storage.data.get('byl-accent')).toBe('kupfer');
		expect(LEGACY_ACCENTS.honig).toBe('kupfer');
	});

	it('turns a stored "purpur" into Petrol and removes the key', () => {
		const storage = storageWith({ 'byl-accent': 'purpur' });

		expect(bootAccent(storage)).toBeNull();
		expect(storage.data.has('byl-accent')).toBe(false);
		expect(LEGACY_ACCENTS.purpur).toBe('petrol');
	});

	it('shows Kupfer for a stored "honig" even when the storage refuses the rewrite', () => {
		const storage = storageWith({ 'byl-accent': 'honig' });
		storage.setItem = () => {
			throw new Error('QuotaExceededError');
		};

		expect(bootAccent(storage)).toBe('kupfer');
	});

	it('knows exactly the old values of accent.svelte.ts', () => {
		const script = bootScript();
		for (const legacy of Object.keys(LEGACY_ACCENTS)) {
			expect(script).toContain(`accent === '${legacy}'`);
		}
		expect(script.match(/accent === '[a-z]+'/g)).toHaveLength(Object.keys(LEGACY_ACCENTS).length);
	});

	it('applies the accent even when moving td-theme fails', () => {
		const storage = storageWith({ 'td-theme': 'dark', 'byl-accent': 'smaragd' });
		storage.setItem = () => {
			throw new Error('QuotaExceededError');
		};

		expect(bootAccent(storage)).toBe('smaragd');
	});
});
