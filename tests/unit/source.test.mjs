// Value lists of app/pb_hooks/lib/source.js against the schema the migrations create
// (ADR-0014): the migrations write them out literally, tests/support/schema.mjs as well.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { CHANNELS, EXPECTED_COLLECTIONS, INBOX_KINDS, INBOX_STATES } from '../support/schema.mjs';
import {
	CHANNEL_LABELS,
	INBOX_CHANNELS,
	INBOX_KINDS as WEB_KINDS,
	INBOX_STATES as WEB_STATES,
	KIND_LABELS,
	STATE_LABELS
} from '../../web/src/lib/domain/inbox.ts';

const source = loadHookLib('source.js');

describe('source.js', () => {
	it('lists the channels, kinds and states of inbox_items', () => {
		expect([...source.CHANNELS]).toEqual(CHANNELS);
		expect([...source.KINDS]).toEqual(INBOX_KINDS);
		expect([...source.STATES]).toEqual(INBOX_STATES);
		const fields = EXPECTED_COLLECTIONS.inbox_items.fields;
		expect(fields.channel.values).toEqual(CHANNELS);
		expect(fields.kind.values).toEqual(INBOX_KINDS);
		expect(fields.state.values).toEqual(INBOX_STATES);
	});

	it('uses the channels as values of tickets.source', () => {
		expect(EXPECTED_COLLECTIONS.tickets.fields.source.values).toEqual([...source.CHANNELS]);
	});

	it('lets a client set only an empty source, manual or quick on a ticket', () => {
		expect(source.isClientTicketSource('')).toBe(true);
		expect(source.isClientTicketSource('manual')).toBe(true);
		expect(source.isClientTicketSource('quick')).toBe(true);
		for (const channel of source.CHANNELS.filter((value) => !['manual', 'quick'].includes(value))) {
			expect(source.isClientTicketSource(channel), channel).toBe(false);
		}
		expect(source.isClientTicketSource('other')).toBe(false);
	});

	it('recognises channels', () => {
		expect(source.isChannel('eml')).toBe(true);
		expect(source.isChannel('EML')).toBe(false);
		expect(source.isChannel('')).toBe(false);
	});
});

describe('web/src/lib/domain/inbox.ts', () => {
	it('mirrors the value lists of source.js with a German label each', () => {
		expect([...INBOX_CHANNELS]).toEqual([...source.CHANNELS]);
		expect([...WEB_KINDS]).toEqual([...source.KINDS]);
		expect([...WEB_STATES]).toEqual([...source.STATES]);
		expect(Object.keys(CHANNEL_LABELS)).toEqual([...source.CHANNELS]);
		expect(Object.keys(KIND_LABELS)).toEqual([...source.KINDS]);
		expect(Object.keys(STATE_LABELS)).toEqual([...source.STATES]);
	});
});
