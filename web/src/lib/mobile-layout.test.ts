// Switch "Handy-Ansicht (Vorschau)" (MO-1a, ADR-0073): off by default, only "on" stored, the root
// attribute for the CSS, the decision of the switch and the width, following other tabs and the
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
	it('is off by default and with a blocked storage', () => {
		expect(readMobileLayout(localStorage)).toBe(false);
		expect(readMobileLayout(null)).toBe(false);
		expect(readMobileLayout(throwing)).toBe(false);
		localStorage.setItem('byl-mobile-layout', 'yes');
		expect(readMobileLayout(localStorage)).toBe(false);
	});

	it('stores only "on" and removes the key for "off"', () => {
		expect(writeMobileLayout(localStorage, true)).toBe(true);
		expect(localStorage.getItem('byl-mobile-layout')).toBe('on');
		expect(readMobileLayout(localStorage)).toBe(true);
		expect(writeMobileLayout(localStorage, false)).toBe(true);
		expect(localStorage.getItem('byl-mobile-layout')).toBeNull();
		expect(writeMobileLayout(throwing, true)).toBe(false);
		expect(writeMobileLayout(null, true)).toBe(false);
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
		localStorage.setItem('byl-mobile-layout', 'on');
		const store = new MobileLayoutStore(window);
		expect(store.enabled).toBe(true);
		expect(store.narrow).toBe(false);
		expect(store.active).toBe(false);
		expect(document.documentElement.getAttribute('data-mobile-layout')).toBe('on');
	});

	it('applies the frame only with the switch on and a narrow window', () => {
		const query = fakeQuery(true);
		query.stub();
		const store = new MobileLayoutStore(window);
		expect(store.narrow).toBe(true);
		expect(store.active).toBe(false);
		store.choose(true);
		expect(store.active).toBe(true);
		expect(localStorage.getItem('byl-mobile-layout')).toBe('on');
		expect(document.documentElement.getAttribute('data-mobile-layout')).toBe('on');
		store.choose(false);
		expect(store.active).toBe(false);
		expect(localStorage.getItem('byl-mobile-layout')).toBeNull();
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

	it('follows the switch of another tab', () => {
		const query = fakeQuery(true);
		query.stub();
		const store = new MobileLayoutStore(window);
		const stop = store.connect();

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-mobile-layout', newValue: 'on' }));
		expect(store.active).toBe(true);
		expect(document.documentElement.getAttribute('data-mobile-layout')).toBe('on');
		expect(viewport().content).toBe(VIEWPORT_PHONE);

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-theme', newValue: 'dark' }));
		expect(store.enabled).toBe(true);

		// The other tab cleared the whole storage.
		window.dispatchEvent(new StorageEvent('storage', { key: null }));
		expect(store.enabled).toBe(false);
		expect(document.documentElement.hasAttribute('data-mobile-layout')).toBe(false);
		expect(viewport().content).toBe(VIEWPORT_BASE);
		stop();
	});
});
