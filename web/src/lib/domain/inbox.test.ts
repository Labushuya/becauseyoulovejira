// Domain of the inbox (E4 plan, package 2; ADR-0014 section 3): soft duplicates, order and the
// texts of duplicates.

import { describe, expect, it } from 'vitest';
import {
	compareHandled,
	compareNewest,
	duplicateMessage,
	findSoftDuplicates,
	isInboxChannel,
	isInboxKind,
	isInboxState,
	normalizeTitle,
	type InboxItemSummary
} from './inbox';
import type { TicketSummary } from './ticket';

function item(overrides: Partial<InboxItemSummary> = {}): InboxItemSummary {
	return {
		id: 'item00000000001',
		channel: 'manual',
		kind: 'todo',
		title: 'Milch kaufen',
		sourceUrl: '',
		sourceRef: '',
		sourceDate: null,
		sourceMeta: {},
		original: '',
		state: 'new',
		ticketId: null,
		handledAt: null,
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 08:00:00.000Z',
		...overrides
	};
}

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: 'tick00000000001',
		key: 'TASK-1',
		title: 'Milch kaufen',
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-09-24 08:00:00.000Z',
		updated: '2026-09-24 08:00:00.000Z',
		...overrides
	};
}

describe('normalizeTitle', () => {
	it('trims, lower-cases and collapses whitespace', () => {
		expect(normalizeTitle('  Milch\tKAUFEN \n morgen ')).toBe('milch kaufen morgen');
	});

	it('keeps umlauts apart from their base letters', () => {
		expect(normalizeTitle('Äpfel')).toBe('äpfel');
		expect(normalizeTitle('Äpfel')).not.toBe(normalizeTitle('Apfel'));
		expect(normalizeTitle('Straße')).not.toBe(normalizeTitle('Strasse'));
	});
});

describe('findSoftDuplicates', () => {
	it('finds open tickets and other new entries with the same title', () => {
		const entry = item();
		const same = ticket({ title: '  milch   KAUFEN' });
		const other = ticket({ id: 'tick00000000002', title: 'Brot kaufen' });
		const sibling = item({ id: 'item00000000002', title: 'MILCH kaufen' });
		const result = findSoftDuplicates(entry, [same, other], [entry, sibling]);
		expect(result.tickets).toEqual([same]);
		expect(result.items).toEqual([sibling]);
	});

	it('ignores done tickets, handled entries, the entry itself and umlaut variants', () => {
		const entry = item({ title: 'Äpfel kaufen' });
		const result = findSoftDuplicates(
			entry,
			[ticket({ title: 'Äpfel kaufen', status: 'done' }), ticket({ title: 'Apfel kaufen' })],
			[entry, item({ id: 'item00000000002', title: 'äpfel kaufen', state: 'discarded' })]
		);
		expect(result).toEqual({ tickets: [], items: [] });
	});

	it('matches nothing for an empty title', () => {
		expect(findSoftDuplicates(item({ title: ' ' }), [ticket({ title: '' })], [])).toEqual({
			tickets: [],
			items: []
		});
	});
});

describe('order', () => {
	it('puts the newest entries first, then by ID', () => {
		const older = item({ id: 'a00000000000001', created: '2026-09-24 08:00:00.000Z' });
		const newer = item({ id: 'a00000000000002', created: '2026-09-25 08:00:00.000Z' });
		const twin = item({ id: 'a00000000000003', created: '2026-09-25 08:00:00.000Z' });
		expect([older, newer, twin].sort(compareNewest).map((entry) => entry.id)).toEqual([
			twin.id,
			newer.id,
			older.id
		]);
	});

	it('puts the most recently handled entries first', () => {
		const first = item({ id: 'a00000000000001', handledAt: '2026-09-25 09:00:00.000Z' });
		const second = item({ id: 'a00000000000002', handledAt: '2026-09-25 10:00:00.000Z' });
		expect([first, second].sort(compareHandled).map((entry) => entry.id)).toEqual([
			second.id,
			first.id
		]);
	});
});

describe('value lists and texts', () => {
	it('recognises channels, kinds and states', () => {
		expect(isInboxChannel('eml')).toBe(true);
		expect(isInboxChannel('fax')).toBe(false);
		expect(isInboxKind('event')).toBe(true);
		expect(isInboxKind('epic')).toBe(false);
		expect(isInboxState('discarded')).toBe(true);
		expect(isInboxState(undefined)).toBe(false);
	});

	it('names the state of a duplicate like the hook', () => {
		expect(duplicateMessage('new', '')).toBe('Schon im Eingang.');
		expect(duplicateMessage('discarded', '')).toBe('Schon verworfen.');
		expect(duplicateMessage('converted', 'HAUS-12')).toBe('Schon Ticket HAUS-12.');
		expect(duplicateMessage('converted', '')).toBe('Schon umgewandelt.');
	});
});
