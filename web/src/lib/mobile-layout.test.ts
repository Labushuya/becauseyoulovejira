// Choice "Handy-Ansicht: Automatisch / Aus" (MO-1a, ADR-0073; since the package "Einschalten"
// "Automatisch" by default): only "off" stored, the old value "on" and no key mean "Automatisch", the
// root attribute for the CSS, the decision of the choice and the width, following other tabs and the
// width, and the meta viewport of the frame only while it applies and the app layout is connected.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHONE_QUERY, VIEWPORT_BASE, VIEWPORT_PHONE } from '$lib/domain/phone-layout';
import {
	MobileLayoutStore,
	applyMobileLayout,
	applyViewport,
	readMobileLayout,
	writeMobileLayout
} from './mobile-layout.svelte';

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

/** A media query list of the phone width whose state the test controls. */
function fakeQuery(matches: boolean) {
	const listeners = new Set<(event: MediaQueryListEvent) => void>();
	const list = {
		matches,
		media: PHONE_QUERY,
		addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
			listeners.add(listener),
		removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
			listeners.delete(listener)
	};
	return {
		listeners,
		change(next: boolean) {
			list.matches = next;
			for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
		},
		stub() {
			vi.stubGlobal(
				'matchMedia',
				vi.fn((media: string) => {
					expect(media).toBe(PHONE_QUERY);
					return list as unknown as MediaQueryList;
				})
			);
		}
	};
}

function viewport(): HTMLMetaElement {
	return document.querySelector('meta[name="viewport"]') as HTMLMetaElement;
}

beforeEach(() => {
	const meta = document.createElement('meta');
	meta.name = 'viewport';
	meta.content = VIEWPORT_BASE;
	document.head.append(meta);
});

afterEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute('data-mobile-layout');
	document.head.querySelectorAll('meta[name="viewport"]').forEach((meta) => meta.remove());
	vi.unstubAllGlobals();
});

describe('mobile layout: storage', () => {
	// Changed with the package "Einschalten": the default is "Automatisch" (decision of the user 1).
	it('is "Automatisch" by default, with the old value "on" and with a blocked storage; only "off" turns it off', () => {
		expect(readMobileLayout(localStorage)).toBe(true);
		expect(readMobileLayout(null)).toBe(true);
		expect(readMobileLayout(throwing)).toBe(true);
		localStorage.setItem('byl-mobile-layout', 'on');
		expect(readMobileLayout(localStorage)).toBe(true);
		localStorage.setItem('byl-mobile-layout', 'yes');
		expect(readMobileLayout(localStorage)).toBe(true);
		localStorage.setItem('byl-mobile-layout', 'off');
		expect(readMobileLayout(localStorage)).toBe(false);
	});

	// Changed with the package "Einschalten": "Aus" is stored now, "Automatisch" removes the key.
	it('stores only "off" and removes the key for "Automatisch"', () => {
		expect(writeMobileLayout(localStorage, false)).toBe(true);
		expect(localStorage.getItem('byl-mobile-layout')).toBe('off');
		expect(readMobileLayout(localStorage)).toBe(false);
		expect(writeMobileLayout(localStorage, true)).toBe(true);
		expect(localStorage.getItem('byl-mobile-layout')).toBeNull();
		expect(readMobileLayout(localStorage)).toBe(true);
		expect(writeMobileLayout(throwing, false)).toBe(false);
		expect(writeMobileLayout(null, false)).toBe(false);
	});

	it('marks the root element only while the switch is on', () => {
		const root = document.documentElement;
		applyMobileLayout(root, true);
		expect(root.getAttribute('data-mobile-layout')).toBe('on');
		applyMobileLayout(root, false);
		expect(root.hasAttribute('data-mobile-layout')).toBe(false);
	});

	it('gives the meta viewport the content of the frame and back', () => {
		applyViewport(document, true);
		expect(viewport().content).toBe(VIEWPORT_PHONE);
		applyViewport(document, false);
		expect(viewport().content).toBe(VIEWPORT_BASE);
	});
});

describe('mobile layout: store', () => {
	it('counts as wide without matchMedia, so every component test stays a desktop test', () => {
		const store = new MobileLayoutStore(window);
		expect(store.enabled).toBe(true);
		expect(store.narrow).toBe(false);
		expect(store.active).toBe(false);
		expect(document.documentElement.getAttribute('data-mobile-layout')).toBe('on');
	});

	// Package "Einschalten": a phone without a stored choice shows the frame at once; "Aus" stays.
	it('applies the frame by default on a narrow window, also with the old value "on", and never with "off"', () => {
		const query = fakeQuery(true);
		query.stub();
		expect(new MobileLayoutStore(window).active).toBe(true);
		localStorage.setItem('byl-mobile-layout', 'on');
		expect(new MobileLayoutStore(window).active).toBe(true);
		localStorage.setItem('byl-mobile-layout', 'off');
		const off = new MobileLayoutStore(window);
		expect(off.enabled).toBe(false);
		expect(off.active).toBe(false);
		expect(document.documentElement.hasAttribute('data-mobile-layout')).toBe(false);
	});

	// Changed with the package "Einschalten": it starts from a stored "off"; "Automatisch" removes the
	// key instead of storing "on", "Aus" stores "off".
	it('applies the frame only with "Automatisch" and a narrow window', () => {
		localStorage.setItem('byl-mobile-layout', 'off');
		const query = fakeQuery(true);
		query.stub();
		const store = new MobileLayoutStore(window);
		expect(store.narrow).toBe(true);
		expect(store.active).toBe(false);
		store.choose(true);
		expect(store.active).toBe(true);
		expect(localStorage.getItem('byl-mobile-layout')).toBeNull();
		expect(document.documentElement.getAttribute('data-mobile-layout')).toBe('on');
		store.choose(false);
		expect(store.active).toBe(false);
		expect(localStorage.getItem('byl-mobile-layout')).toBe('off');
		expect(document.documentElement.hasAttribute('data-mobile-layout')).toBe(false);
	});

	it('follows the width and keeps the meta viewport in line while connected', () => {
		localStorage.setItem('byl-mobile-layout', 'on');
		const query = fakeQuery(false);
		query.stub();
		const store = new MobileLayoutStore(window);
		// Not connected yet: the viewport stays as app.html has it.
		store.choose(true);
		expect(viewport().content).toBe(VIEWPORT_BASE);

		const stop = store.connect();
		expect(viewport().content).toBe(VIEWPORT_BASE);
		query.change(true);
		expect(store.active).toBe(true);
		expect(viewport().content).toBe(VIEWPORT_PHONE);
		// Turned to landscape, wider than 40rem: the frame and its viewport go.
		query.change(false);
		expect(store.active).toBe(false);
		expect(viewport().content).toBe(VIEWPORT_BASE);
		query.change(true);
		store.choose(false);
		expect(viewport().content).toBe(VIEWPORT_BASE);
		store.choose(true);
		expect(viewport().content).toBe(VIEWPORT_PHONE);

		stop();
		expect(query.listeners.size).toBe(0);
		expect(viewport().content).toBe(VIEWPORT_BASE);
	});

	// Changed with the package "Einschalten": the other tab removes the key for "Automatisch" and
	// stores "off" for "Aus"; a cleared storage means "Automatisch".
	it('follows the choice of another tab', () => {
		localStorage.setItem('byl-mobile-layout', 'off');
		const query = fakeQuery(true);
		query.stub();
		const store = new MobileLayoutStore(window);
		const stop = store.connect();
		expect(store.active).toBe(false);

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-mobile-layout', newValue: null }));
		expect(store.active).toBe(true);
		expect(document.documentElement.getAttribute('data-mobile-layout')).toBe('on');
		expect(viewport().content).toBe(VIEWPORT_PHONE);

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-theme', newValue: 'dark' }));
		expect(store.enabled).toBe(true);

		window.dispatchEvent(
			new StorageEvent('storage', { key: 'byl-mobile-layout', newValue: 'off' })
		);
		expect(store.enabled).toBe(false);
		expect(document.documentElement.hasAttribute('data-mobile-layout')).toBe(false);
		expect(viewport().content).toBe(VIEWPORT_BASE);

		// The other tab cleared the whole storage.
		window.dispatchEvent(new StorageEvent('storage', { key: null }));
		expect(store.enabled).toBe(true);
		expect(document.documentElement.getAttribute('data-mobile-layout')).toBe('on');
		expect(viewport().content).toBe(VIEWPORT_PHONE);
		stop();
	});

	it('keeps the focus in the field on a press of a button that saves, only in the frame (MO-5, MO-6)', () => {
		// Package "Einschalten": from a stored "Aus", since "Automatisch" is the default.
		localStorage.setItem('byl-mobile-layout', 'off');
		const query = fakeQuery(true);
		query.stub();
		const store = new MobileLayoutStore(window);
		const press = () => new MouseEvent('mousedown', { cancelable: true });
		const off = press();
		store.keepFocus(off);
		expect(off.defaultPrevented).toBe(false);
		store.choose(true);
		const on = press();
		store.keepFocus(on);
		expect(on.defaultPrevented).toBe(true);
		// A wider window (turned to landscape): the button takes the focus again.
		store.narrow = false;
		const wide = press();
		store.keepFocus(wide);
		expect(wide.defaultPrevented).toBe(false);
	});
});
