// Theme preference (ADR-0025 section 10; plan UI-Konsistenz, package UI-2): reading with
// validation, writing, applying to the root element, and following other tabs.

import { afterEach, describe, expect, it } from 'vitest';
import {
	applyPreference,
	parsePreference,
	readPreference,
	THEME_STORAGE_KEY,
	ThemeStore,
	writePreference
} from './theme.svelte';

afterEach(() => {
	localStorage.clear();
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

describe('theme preference', () => {
	it.each([
		['light', 'light'],
		['dark', 'dark'],
		[null, 'system'],
		['system', 'system'],
		['Dark', 'system'],
		['"><script>', 'system']
	])('reads %s as %s', (stored, expected) => {
		expect(parsePreference(stored)).toBe(expected);
	});

	it('uses the key byl-theme and falls back to the system setting without storage', () => {
		expect(THEME_STORAGE_KEY).toBe('byl-theme');
		localStorage.setItem('byl-theme', 'dark');
		expect(readPreference(localStorage)).toBe('dark');
		expect(readPreference(null)).toBe('system');
		expect(readPreference(throwing)).toBe('system');
	});

	it('stores light and dark and removes the key for the system setting', () => {
		expect(writePreference(localStorage, 'light')).toBe(true);
		expect(localStorage.getItem('byl-theme')).toBe('light');
		expect(writePreference(localStorage, 'system')).toBe(true);
		expect(localStorage.getItem('byl-theme')).toBeNull();
		expect(writePreference(throwing, 'dark')).toBe(false);
		expect(writePreference(null, 'dark')).toBe(false);
	});

	it('sets data-theme only for a forced mode', () => {
		const root = document.documentElement;
		applyPreference(root, 'dark');
		expect(root.getAttribute('data-theme')).toBe('dark');
		applyPreference(root, 'system');
		expect(root.hasAttribute('data-theme')).toBe(false);
	});
});

describe('ThemeStore', () => {
	it('starts with the stored choice and switches at once', () => {
		localStorage.setItem('byl-theme', 'light');
		const store = new ThemeStore(window);
		expect(store.preference).toBe('light');

		store.choose('dark');

		expect(store.preference).toBe('dark');
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		expect(localStorage.getItem('byl-theme')).toBe('dark');
	});

	it('follows a choice made in another tab and ignores other keys', () => {
		const store = new ThemeStore(window);
		const stop = store.connect();

		window.dispatchEvent(new StorageEvent('storage', { key: 'andere', newValue: 'dark' }));
		expect(store.preference).toBe('system');

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-theme', newValue: 'dark' }));
		expect(store.preference).toBe('dark');
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

		window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }));
		expect(store.preference).toBe('system');
		expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

		stop();
		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-theme', newValue: 'light' }));
		expect(store.preference).toBe('system');
	});
});
