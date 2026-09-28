// Assistant "WhatsApp Web einrichten" (ADR-0038 §4): short labels, the key it watches, when the
// extension counts as connected and the states of the stepper.

import { describe, expect, it } from 'vitest';
import type { InboxKey } from './inbox-keys';
import {
	BROWSERS,
	LOAD_STEPS,
	WHATSAPP_WEB_STEPS,
	firstOpenStep,
	keyUsedSince,
	watchedKey,
	whatsappStepStates
} from './whatsapp-web';

const key = (id: string, created: string, lastUsedAt: string | null = null): InboxKey => ({
	id,
	name: id,
	tokenHint: 'byl_Ab12',
	created,
	lastUsedAt
});

const OPENED = Date.parse('2026-09-28T12:00:00.000Z');

describe('steps', () => {
	it('have labels of at most two words and ways for Edge and Chrome', () => {
		expect(WHATSAPP_WEB_STEPS.map((step) => step.id)).toEqual([
			'key',
			'load',
			'enter',
			'test',
			'keywords'
		]);
		for (const step of WHATSAPP_WEB_STEPS) {
			expect(step.label.split(' ').length, step.label).toBeLessThanOrEqual(2);
		}
		expect(BROWSERS).toEqual(['edge', 'chrome']);
		expect(LOAD_STEPS.edge[0]).toContain('edge://extensions');
		expect(LOAD_STEPS.chrome[0]).toContain('chrome://extensions');
		for (const browser of BROWSERS) {
			expect(LOAD_STEPS[browser].join(' ')).toContain('Entwicklermodus');
		}
	});
});

describe('the watched key', () => {
	it('is the key created in the assistant, else the newest', () => {
		const keys = [
			key('alt', '2026-09-01 10:00:00.000Z'),
			key('neu', '2026-09-20 10:00:00.000Z'),
			key('mitte', '2026-09-10 10:00:00.000Z')
		];
		expect(watchedKey(keys, 'alt')?.id).toBe('alt');
		expect(watchedKey(keys, null)?.id).toBe('neu');
		expect(watchedKey(keys, 'weg')?.id).toBe('neu');
		expect(watchedKey([], null)).toBeNull();
	});

	it('counts as used when it was used since the assistant opened, with a minute of slack', () => {
		expect(keyUsedSince(null, OPENED)).toBe(false);
		expect(keyUsedSince(key('k', '2026-09-28 11:00:00.000Z'), OPENED)).toBe(false);
		expect(keyUsedSince(key('k', '', '2026-09-28 12:00:30.000Z'), OPENED)).toBe(true);
		expect(keyUsedSince(key('k', '', '2026-09-28 11:59:10.000Z'), OPENED)).toBe(true);
		expect(keyUsedSince(key('k', '', '2026-09-28 11:58:00.000Z'), OPENED)).toBe(false);
	});
});

describe('progress', () => {
	it('opens at the first step the app does not see as done', () => {
		expect(firstOpenStep({ keys: 0, used: false, keywords: 0 })).toBe(0);
		expect(firstOpenStep({ keys: 1, used: false, keywords: 0 })).toBe(1);
		expect(firstOpenStep({ keys: 1, used: true, keywords: 0 })).toBe(4);
		expect(firstOpenStep({ keys: 1, used: true, keywords: 2 })).toBe(4);
	});

	it('marks done steps, and the keywords as open question once the extension is connected', () => {
		expect(whatsappStepStates({ keys: 0, used: false, keywords: 0 }, 0)).toEqual([
			'current',
			'open',
			'open',
			'open',
			'open'
		]);
		expect(whatsappStepStates({ keys: 1, used: true, keywords: 0 }, 3)).toEqual([
			'done',
			'done',
			'done',
			'current',
			'warning'
		]);
		expect(whatsappStepStates({ keys: 1, used: true, keywords: 3 }, 0)).toEqual([
			'current',
			'done',
			'done',
			'done',
			'done'
		]);
	});
});
