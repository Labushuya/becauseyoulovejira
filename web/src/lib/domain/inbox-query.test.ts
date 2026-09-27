// Inbox view state in the URL (E4 plan, T-4; ADR-0019 section 6) and the source families
// (ADR-0019 section 1).

import { describe, expect, it } from 'vitest';
import { INBOX_CHANNELS } from './inbox';
import { DEFAULT_INBOX_QUERY, parseInboxQuery, serializeInboxQuery } from './inbox-query';
import { SOURCE_FAMILIES, SOURCE_FAMILY_CHIPS, channelsOf, sourceFamily } from './source';

const parse = (search: string) => parseInboxQuery(new URLSearchParams(search));

describe('parseInboxQuery', () => {
	it('reads source family and state', () => {
		expect(parse('')).toEqual(DEFAULT_INBOX_QUERY);
		expect(parse('quelle=mail&zustand=verworfen')).toEqual({ source: 'mail', state: 'discarded' });
		expect(parse('quelle=kalender&zustand=verknuepft')).toEqual({
			source: 'calendar',
			state: 'converted'
		});
		expect(parse('quelle=manuell&zustand=neu')).toEqual({ source: 'manual', state: 'new' });
		expect(parse('zustand=alle')).toEqual({ source: null, state: 'all' });
	});

	it('still reads the value "umgewandelt" of addresses before HK-7', () => {
		expect(parse('zustand=umgewandelt')).toEqual({ source: null, state: 'converted' });
	});

	it('ignores unknown, empty and repeated values', () => {
		expect(parse('quelle=fax&zustand=alt')).toEqual(DEFAULT_INBOX_QUERY);
		expect(parse('zustand=constructor')).toEqual(DEFAULT_INBOX_QUERY);
		expect(parse('quelle=&zustand=')).toEqual(DEFAULT_INBOX_QUERY);
		expect(parse('quelle=mail&quelle=mail&zustand=verworfen&zustand=neu')).toEqual(
			DEFAULT_INBOX_QUERY
		);
		expect(parse('quelle=Mail')).toEqual(DEFAULT_INBOX_QUERY);
	});
});

describe('serializeInboxQuery', () => {
	it('writes the parameters in a fixed order and leaves out the default state', () => {
		expect(serializeInboxQuery(DEFAULT_INBOX_QUERY)).toBe('');
		expect(serializeInboxQuery({ source: 'chat', state: 'new' })).toBe('?quelle=chat');
		expect(serializeInboxQuery({ source: 'link', state: 'converted' })).toBe(
			'?quelle=link&zustand=verknuepft'
		);
		expect(serializeInboxQuery({ source: null, state: 'all' })).toBe('?zustand=alle');
	});

	it('keeps unknown parameters in front and replaces its own ones', () => {
		const base = new URLSearchParams('zustand=neu&x=1&quelle=mail&y=2');
		expect(serializeInboxQuery({ source: null, state: 'discarded' }, base)).toBe(
			'?x=1&y=2&zustand=verworfen'
		);
	});

	it('round-trips every combination', () => {
		for (const source of [null, ...SOURCE_FAMILIES]) {
			for (const state of ['new', 'discarded', 'converted', 'all'] as const) {
				const query = { source, state };
				expect(parse(serializeInboxQuery(query).slice(1))).toEqual(query);
			}
		}
	});
});

describe('source families', () => {
	it('puts every channel into one family; no source counts as manual', () => {
		expect(INBOX_CHANNELS.map((channel) => sourceFamily(channel))).toEqual([
			'manual',
			'manual',
			'manual',
			'link',
			'mail',
			'mail',
			'calendar',
			'calendar',
			'chat',
			'chat',
			'notion'
		]);
		expect(sourceFamily(null)).toBe('manual');
	});

	it('lists the channels of a family, at most three for the server filter', () => {
		expect(channelsOf('manual')).toEqual(['manual', 'quick', 'clipboard']);
		expect(channelsOf('mail')).toEqual(['eml', 'mail']);
		for (const family of SOURCE_FAMILIES) {
			expect(channelsOf(family).length).toBeGreaterThan(0);
			expect(channelsOf(family).length).toBeLessThanOrEqual(3);
		}
	});

	it('offers Notion as chip only once its channel exists', () => {
		expect(SOURCE_FAMILY_CHIPS).not.toContain('notion');
		expect(SOURCE_FAMILY_CHIPS).toEqual(['manual', 'link', 'mail', 'calendar', 'chat']);
	});
});
