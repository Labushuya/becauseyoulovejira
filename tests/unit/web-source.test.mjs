// The source families of the web app (web/src/lib/domain/source.ts, ADR-0019 section 1) against
// the value list of the hooks (app/pb_hooks/lib/source.js): every channel the server knows has
// exactly one family, and every family fits the filter of the done tickets (at most three
// channels, web/src/lib/data/tickets.ts).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	SOURCE_FAMILIES,
	channelsOf,
	sourceFamily
} from '../../web/src/lib/domain/source.ts';

const source = loadHookLib('source.js');

describe('web source families and lib/source.js', () => {
	it('give every channel of the hooks exactly one family', () => {
		for (const channel of source.CHANNELS) {
			const families = SOURCE_FAMILIES.filter((family) => channelsOf(family).includes(channel));
			expect(families, channel).toEqual([sourceFamily(channel)]);
		}
		expect(SOURCE_FAMILIES.flatMap(channelsOf).sort()).toEqual([...source.CHANNELS].sort());
	});

	it('keep the sources a client may set in the family "manual"', () => {
		for (const value of source.CLIENT_TICKET_SOURCES) {
			expect(sourceFamily(value), value).toBe('manual');
		}
		expect(sourceFamily(null)).toBe('manual');
	});

	it('fit the filter of the done tickets with at most three channels per family', () => {
		for (const family of SOURCE_FAMILIES) {
			expect(channelsOf(family).length, family).toBeGreaterThan(0);
			expect(channelsOf(family).length, family).toBeLessThanOrEqual(3);
		}
	});
});
