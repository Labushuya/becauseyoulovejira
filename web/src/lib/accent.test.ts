// Accent themes (ADR-0027 section 6): reading with validation, writing, applying to the root element
// and following other tabs. The mode (theme.svelte.ts) stays untouched.

import { afterEach, describe, expect, it } from 'vitest';
import {
	ACCENT_DESCRIPTIONS,
	ACCENT_LABELS,
	ACCENT_STORAGE_KEY,
	ACCENT_THEMES,
	AccentStore,
	applyAccent,
	LEGACY_ACCENTS,
	parseAccent,
	readAccent,
	STORED_ACCENTS,
	writeAccent
} from './accent.svelte';

afterEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute('data-accent');
	document.documentElement.removeAttribute('data-theme');
});

const throwing = {
	getItem: () => {
		throw new Error('blocked');
	},
	setItem: () => {
		throw new Error('blocked');
	},
	removeItem: () => {
		throw new Error('blocked');
	}
};

describe('accent themes', () => {
	it('offers Petrol first and three more themes with German names (addendum 2026-09-27)', () => {
		expect(ACCENT_THEMES).toEqual(['petrol', 'rubin', 'smaragd', 'kupfer']);
		expect(STORED_ACCENTS).toEqual(ACCENT_THEMES.slice(1));
		expect(ACCENT_THEMES.map((accent) => ACCENT_LABELS[accent])).toEqual([
			'Petrol',
			'Rubin',
			'Smaragd',
			'Kupfer'
		]);
		expect(ACCENT_DESCRIPTIONS.kupfer).toMatch(/Macchiato.*Espresso/);
	});

	it('maps the old values: Honig to Kupfer, Purpur to Petrol', () => {
		expect(LEGACY_ACCENTS).toEqual({ honig: 'kupfer', purpur: 'petrol' });
		localStorage.setItem('byl-accent', 'honig');
		expect(readAccent(localStorage)).toBe('kupfer');
		localStorage.setItem('byl-accent', 'purpur');
		expect(readAccent(localStorage)).toBe('petrol');
		expect(parseAccent('toString')).toBe('petrol');
		expect(parseAccent('constructor')).toBe('petrol');
	});

	it.each([
		['rubin', 'rubin'],
		['smaragd', 'smaragd'],
		['kupfer', 'kupfer'],
		['honig', 'kupfer'],
		['purpur', 'petrol'],
		['petrol', 'petrol'],
		[null, 'petrol'],
		['Rubin', 'petrol'],
		['dark', 'petrol'],
		['"><script>', 'petrol'],
		['', 'petrol']
	])('reads %s as %s', (stored, expected) => {
		expect(parseAccent(stored)).toBe(expected);
	});

	it('uses the key byl-accent and falls back to Petrol without storage', () => {
		expect(ACCENT_STORAGE_KEY).toBe('byl-accent');
		localStorage.setItem('byl-accent', 'smaragd');
		expect(readAccent(localStorage)).toBe('smaragd');
		expect(readAccent(null)).toBe('petrol');
		expect(readAccent(throwing)).toBe('petrol');
	});

	it('stores a theme and removes the key for Petrol', () => {
		expect(writeAccent(localStorage, 'kupfer')).toBe(true);
		expect(localStorage.getItem('byl-accent')).toBe('kupfer');
		expect(writeAccent(localStorage, 'petrol')).toBe(true);
		expect(localStorage.getItem('byl-accent')).toBeNull();
		expect(writeAccent(throwing, 'rubin')).toBe(false);
		expect(writeAccent(null, 'rubin')).toBe(false);
	});

	it('sets data-accent only for a theme other than Petrol and leaves data-theme alone', () => {
		const root = document.documentElement;
		root.setAttribute('data-theme', 'dark');
		applyAccent(root, 'kupfer');
		expect(root.getAttribute('data-accent')).toBe('kupfer');
		applyAccent(root, 'petrol');
		expect(root.hasAttribute('data-accent')).toBe(false);
		expect(root.getAttribute('data-theme')).toBe('dark');
	});
});

describe('AccentStore', () => {
	it('starts with the stored choice and switches at once', () => {
		localStorage.setItem('byl-accent', 'rubin');
		const store = new AccentStore(window);
		expect(store.accent).toBe('rubin');

		store.choose('smaragd');

		expect(store.accent).toBe('smaragd');
		expect(document.documentElement.getAttribute('data-accent')).toBe('smaragd');
		expect(localStorage.getItem('byl-accent')).toBe('smaragd');

		store.choose('petrol');

		expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
		expect(localStorage.getItem('byl-accent')).toBeNull();
	});

	it('keeps the choice for this page when the storage refuses it', () => {
		const blocked = {
			document,
			get localStorage(): Storage {
				throw new Error('SecurityError');
			}
		} as unknown as Window;
		const store = new AccentStore(blocked);
		expect(store.accent).toBe('petrol');

		store.choose('kupfer');

		expect(store.accent).toBe('kupfer');
		expect(document.documentElement.getAttribute('data-accent')).toBe('kupfer');
	});

	it('follows a choice made in another tab and ignores other keys and invalid values', () => {
		const store = new AccentStore(window);
		const stop = store.connect();

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-theme', newValue: 'dark' }));
		expect(store.accent).toBe('petrol');

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-accent', newValue: 'smaragd' }));
		expect(store.accent).toBe('smaragd');
		expect(document.documentElement.getAttribute('data-accent')).toBe('smaragd');

		// A tab with the old app writes "honig": this tab shows its successor Kupfer.
		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-accent', newValue: 'honig' }));
		expect(store.accent).toBe('kupfer');
		expect(document.documentElement.getAttribute('data-accent')).toBe('kupfer');

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-accent', newValue: 'lila' }));
		expect(store.accent).toBe('petrol');
		expect(document.documentElement.hasAttribute('data-accent')).toBe(false);

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-accent', newValue: 'honig' }));
		window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
		expect(store.accent).toBe('petrol');
		expect(document.documentElement.hasAttribute('data-accent')).toBe(false);

		stop();
		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-accent', newValue: 'rubin' }));
		expect(store.accent).toBe('petrol');
	});
});
