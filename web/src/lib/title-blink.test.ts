// Blinking title of a hidden tab (ADR-0035 section 5; plan start-fenster, SF-3): only while hidden,
// every second, at most 30 s, the title comes back when the tab becomes visible, on pagehide and
// on stop, and a title the app set in between is the one restored.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTENTION_TITLE } from './guidance/texts';
import { BLINK_MAX_MS, TitleBlinker } from './title-blink';

function setVisibility(value: 'visible' | 'hidden') {
	Object.defineProperty(document, 'visibilityState', { value, configurable: true });
}

let blinker: TitleBlinker;

beforeEach(() => {
	vi.useFakeTimers();
	document.title = 'Aufgaben · becauseyoulovejira';
	blinker = new TitleBlinker(document, window);
});

afterEach(() => {
	blinker.stop();
	vi.useRealTimers();
	setVisibility('visible');
});

describe('TitleBlinker', () => {
	it('does nothing in a visible tab', () => {
		blinker.start();
		expect(blinker.running).toBe(false);
		expect(document.title).toBe('Aufgaben · becauseyoulovejira');
	});

	it('alternates every second while hidden', () => {
		setVisibility('hidden');
		blinker.start();
		expect(document.title).toBe(ATTENTION_TITLE);
		vi.advanceTimersByTime(1000);
		expect(document.title).toBe('Aufgaben · becauseyoulovejira');
		vi.advanceTimersByTime(1000);
		expect(document.title).toBe(ATTENTION_TITLE);
	});

	it('stops after 30 s with the normal title', () => {
		setVisibility('hidden');
		blinker.start();
		vi.advanceTimersByTime(BLINK_MAX_MS);
		expect(BLINK_MAX_MS).toBe(30_000);
		expect(blinker.running).toBe(false);
		expect(document.title).toBe('Aufgaben · becauseyoulovejira');
		vi.advanceTimersByTime(5000);
		expect(document.title).toBe('Aufgaben · becauseyoulovejira');
	});

	it('starts the 30 s again on a new message', () => {
		setVisibility('hidden');
		blinker.start();
		vi.advanceTimersByTime(20_000);
		blinker.start();
		vi.advanceTimersByTime(20_000);
		expect(blinker.running).toBe(true);
	});

	it('restores the title when the tab becomes visible', () => {
		setVisibility('hidden');
		blinker.start();
		setVisibility('visible');
		document.dispatchEvent(new Event('visibilitychange'));
		expect(blinker.running).toBe(false);
		expect(document.title).toBe('Aufgaben · becauseyoulovejira');
	});

	it('restores the title when the page goes away', () => {
		setVisibility('hidden');
		blinker.start();
		window.dispatchEvent(new Event('pagehide'));
		expect(blinker.running).toBe(false);
		expect(document.title).toBe('Aufgaben · becauseyoulovejira');
	});

	it('restores a title the app set in between', () => {
		setVisibility('hidden');
		blinker.start();
		vi.advanceTimersByTime(1000);
		document.title = 'Eingang · becauseyoulovejira';
		vi.advanceTimersByTime(1000);
		expect(document.title).toBe(ATTENTION_TITLE);
		blinker.stop();
		expect(document.title).toBe('Eingang · becauseyoulovejira');
	});
});
