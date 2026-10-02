// Source families (E4 plan, package 9; ADR-0019 section 1): every channel in exactly one family,
// tickets without source as "Manuell", labels, URL values, symbol texts and the chips.

import { describe, expect, it } from 'vitest';
import { INBOX_CHANNELS } from './inbox';
import {
	SOURCE_FAMILIES,
	SOURCE_FAMILY_CHIPS,
	SOURCE_FAMILY_LABELS,
	SOURCE_FAMILY_SYMBOL_TEXT,
	SOURCE_FAMILY_VALUES,
	channelsOf,
	sourceFamily
} from './source';

describe('source families', () => {
	it('puts the channels into the families of ADR-0019', () => {
		expect(
			Object.fromEntries(SOURCE_FAMILIES.map((family) => [family, channelsOf(family)]))
		).toEqual({
			manual: ['manual', 'quick', 'clipboard', 'api'],
			link: ['link'],
			mail: ['eml', 'mail'],
			calendar: ['ics', 'calendar'],
			chat: ['whatsapp', 'telegram', 'whatsapp-web'],
			notion: ['notion'],
			github: ['github']
		});
		expect(SOURCE_FAMILIES.flatMap(channelsOf).sort()).toEqual([...INBOX_CHANNELS].sort());
	});

	it('counts tickets without source as manual', () => {
		expect(sourceFamily(null)).toBe('manual');
		for (const channel of INBOX_CHANNELS) {
			expect(channelsOf(sourceFamily(channel))).toContain(channel);
		}
	});

	it('names every family and has unique URL values', () => {
		expect(SOURCE_FAMILY_LABELS).toEqual({
			manual: 'Manuell',
			link: 'Web-Link',
			mail: 'Mail',
			calendar: 'Kalender',
			chat: 'Chat',
			notion: 'Notion',
			github: 'GitHub'
		});
		const values = Object.values(SOURCE_FAMILY_VALUES);
		expect(new Set(values).size).toBe(values.length);
		expect(SOURCE_FAMILY_SYMBOL_TEXT.mail).toBe('aus Mail');
		expect(SOURCE_FAMILY_SYMBOL_TEXT.github).toBe('aus GitHub');
		expect(SOURCE_FAMILY_CHIPS).toEqual([
			'manual',
			'link',
			'mail',
			'calendar',
			'chat',
			'notion',
			'github'
		]);
	});
});
