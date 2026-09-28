// Rules of the automatic mode (ADR-0038 §3): only when switched on, only listed chats, only new
// messages.

import { describe, expect, it } from 'vitest';
import { autoAllowed, autoThreshold, isNewMessage } from './auto';

const ON = { auto: true, autoSince: 1_000_000, chats: [], lastSeen: {} };

describe('automatic mode', () => {
	it('runs only when switched on and, with a list, only in listed chats', () => {
		expect(autoAllowed({ ...ON, auto: false, autoSince: 0 }, 'Familie')).toBe(false);
		expect(autoAllowed({ ...ON, autoSince: 0 }, 'Familie')).toBe(false);
		expect(autoAllowed(ON, 'Familie')).toBe(true);
		expect(autoAllowed(ON, '')).toBe(true);
		const listed = { ...ON, chats: ['Familie  Beispiel'] };
		expect(autoAllowed(listed, ' familie beispiel')).toBe(true);
		expect(autoAllowed(listed, 'Verein')).toBe(false);
		expect(autoAllowed(listed, '')).toBe(false);
	});

	it('starts at the minute of the switch or of the last message seen, whichever is later', () => {
		const since = Date.UTC(2026, 8, 28, 12, 32, 40);
		expect(autoThreshold(since, undefined)).toBe(Date.UTC(2026, 8, 28, 12, 32));
		expect(autoThreshold(since, Date.UTC(2026, 8, 28, 12, 50))).toBe(Date.UTC(2026, 8, 28, 12, 50));
		expect(autoThreshold(since, Date.UTC(2026, 8, 27))).toBe(Date.UTC(2026, 8, 28, 12, 32));
	});

	it('counts only messages from the threshold on, never one without time', () => {
		const threshold = Date.UTC(2026, 8, 28, 12, 32);
		expect(isNewMessage(threshold, threshold)).toBe(true);
		expect(isNewMessage(threshold + 60_000, threshold)).toBe(true);
		expect(isNewMessage(threshold - 60_000, threshold)).toBe(false);
		expect(isNewMessage(null, threshold)).toBe(false);
	});
});
