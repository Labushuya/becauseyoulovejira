// The answer of this device to "Änderungen ohne Verbindung auf diesem Gerät merken?" (package
// "Einschalten", ADR-0074 addendum "Zustimmung je Gerät"): stored only on this device, the old switch
// value "on" migrated to "yes" once, Escape without an answer only for this document, other tabs
// follow.

import { afterEach, describe, expect, it } from 'vitest';
import {
	OfflineConsentStore,
	readOfflineConsent,
	writeOfflineConsent
} from './offline-consent.svelte';

const throwing = {
	getItem: () => {
		throw new Error('blocked');
	},
	setItem: () => {
		throw new Error('blocked');
	}
};

afterEach(() => {
	localStorage.clear();
});

describe('offline consent: storage', () => {
	it('has no answer by default and with a blocked storage', () => {
		expect(readOfflineConsent(localStorage)).toBeNull();
		expect(readOfflineConsent(null)).toBeNull();
		expect(readOfflineConsent(throwing)).toBeNull();
	});

	it('stores "yes" and "no" under its own key', () => {
		expect(writeOfflineConsent(localStorage, 'yes')).toBe(true);
		expect(localStorage.getItem('byl-offline-consent')).toBe('yes');
		expect(readOfflineConsent(localStorage)).toBe('yes');
		expect(writeOfflineConsent(localStorage, 'no')).toBe(true);
		expect(localStorage.getItem('byl-offline-consent')).toBe('no');
		expect(writeOfflineConsent(throwing, 'yes')).toBe(false);
		expect(writeOfflineConsent(null, 'yes')).toBe(false);
	});
});

describe('offline consent: store', () => {
	it('asks a device without an answer and without the old switch', () => {
		const store = new OfflineConsentStore(window);
		expect(store.consent).toBeNull();
		expect(store.dismissed).toBe(false);
		expect(localStorage.getItem('byl-offline-consent')).toBeNull();
	});

	it('takes a device that had the old switch "on" as "yes" and stores it, so no question comes', () => {
		localStorage.setItem('byl-mobile-layout', 'on');
		const store = new OfflineConsentStore(window);
		expect(store.consent).toBe('yes');
		expect(localStorage.getItem('byl-offline-consent')).toBe('yes');
		// The answer stays when the phone view is turned off and back to "Automatisch" later.
		localStorage.removeItem('byl-mobile-layout');
		expect(new OfflineConsentStore(window).consent).toBe('yes');
	});

	it('keeps an answer over the old switch', () => {
		localStorage.setItem('byl-mobile-layout', 'on');
		localStorage.setItem('byl-offline-consent', 'no');
		expect(new OfflineConsentStore(window).consent).toBe('no');
		expect(localStorage.getItem('byl-offline-consent')).toBe('no');
	});

	it('stores "Ja, merken" and "Nein"', () => {
		const store = new OfflineConsentStore(window);
		store.choose('yes');
		expect(store.consent).toBe('yes');
		expect(localStorage.getItem('byl-offline-consent')).toBe('yes');
		store.choose('no');
		expect(store.consent).toBe('no');
		expect(localStorage.getItem('byl-offline-consent')).toBe('no');
	});

	it('keeps Escape without an answer only for this document: the next start asks again', () => {
		const store = new OfflineConsentStore(window);
		store.dismiss();
		expect(store.dismissed).toBe(true);
		expect(store.consent).toBeNull();
		expect(localStorage.getItem('byl-offline-consent')).toBeNull();
		const next = new OfflineConsentStore(window);
		expect(next.dismissed).toBe(false);
		expect(next.consent).toBeNull();
	});

	it('follows the answer of another tab', () => {
		const store = new OfflineConsentStore(window);
		const stop = store.connect();
		window.dispatchEvent(
			new StorageEvent('storage', { key: 'byl-offline-consent', newValue: 'yes' })
		);
		expect(store.consent).toBe('yes');
		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-theme', newValue: 'dark' }));
		expect(store.consent).toBe('yes');
		window.dispatchEvent(
			new StorageEvent('storage', { key: 'byl-offline-consent', newValue: 'no' })
		);
		expect(store.consent).toBe('no');
		// The other tab cleared the whole storage.
		window.dispatchEvent(new StorageEvent('storage', { key: null }));
		expect(store.consent).toBeNull();
		stop();
		window.dispatchEvent(
			new StorageEvent('storage', { key: 'byl-offline-consent', newValue: 'yes' })
		);
		expect(store.consent).toBeNull();
	});

	it('keeps the answer for this page where the storage refuses it', () => {
		const store = new OfflineConsentStore({
			localStorage: throwing,
			addEventListener: () => undefined,
			removeEventListener: () => undefined
		} as unknown as Window);
		expect(store.consent).toBeNull();
		store.choose('yes');
		expect(store.consent).toBe('yes');
	});
});
