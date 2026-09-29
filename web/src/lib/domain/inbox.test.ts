// Domain of the inbox (E4 plan, package 2; ADR-0014 section 3): soft duplicates, order and the
// texts of duplicates.

import { describe, expect, it } from 'vitest';
import {
	compareHandled,
	compareNewest,
	duplicateMessage,
	eventDueDate,
	findSoftDuplicates,
	isInboxChannel,
	isInboxKind,
	isInboxState,
	httpUrlOf,
	normalizeTitle,
	presetMeta,
	presetOf,
	sourceDateText,
	stateLabel,
	ticketPrefill,
	VIEW_LABELS,
	type InboxItem,
	type InboxItemSummary
} from './inbox';
import type { TicketSummary } from './ticket';

describe('stateLabel and VIEW_LABELS (ADR-0031, addendum C)', () => {
	it('names the main source "Umgewandelt" and every other source "Verknüpft"', () => {
		const ticket = { id: 't', key: 'HAUS-12', title: 'Steuer', primary: true };
		expect(stateLabel({ state: 'converted', ticket })).toBe('Umgewandelt');
		expect(stateLabel({ state: 'converted', ticket: { ...ticket, primary: false } })).toBe(
			'Verknüpft'
		);
		expect(stateLabel({ state: 'converted' })).toBe('Verknüpft');
		expect(stateLabel({ state: 'new' })).toBe('Neu');
		expect(stateLabel({ state: 'discarded' })).toBe('Verworfen');
		expect(VIEW_LABELS).toEqual({
			new: 'Neu',
			converted: 'Verknüpft',
			discarded: 'Verworfen',
			all: 'Alle'
		});
	});
});

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

describe('ticketPrefill (E4 plan, T-5)', () => {
	function full(overrides: Partial<InboxItem> = {}): InboxItem {
		return { ...item(), body: 'Text', ...overrides };
	}

	it('takes title and text and adds the header of a mail', () => {
		const prefill = ticketPrefill(
			full({
				kind: 'mail',
				channel: 'mail',
				sourceDate: '2026-09-25 08:15:00.000Z',
				sourceMeta: { from: 'Anna *A.* <anna@example.com>' }
			})
		);
		expect(prefill.title).toBe('Milch kaufen');
		expect(prefill.description).toBe(
			'- **Von:** Anna \\*A\\.\\* \\<anna@example\\.com\\>\n- **Datum:** 25.09.2026 10:15\n\nText'
		);
		expect(prefill.sourceDate).toBe('2026-09-25 08:15:00.000Z');
	});

	it('adds begin and place of an event and sender, chat and time of a message', () => {
		expect(
			ticketPrefill(
				full({
					kind: 'event',
					sourceDate: '2026-12-24 17:00:00.000Z',
					sourceMeta: { location: 'Kirche' },
					body: ''
				})
			).description
		).toBe('- **Beginn:** 24.12.2026 18:00\n- **Ort:** Kirche');
		expect(
			ticketPrefill(
				full({ kind: 'message', sourceMeta: { sender: 'Ben', chat: 'Familie', extra: 3 } })
			).description
		).toBe('- **Von:** Ben\n- **Chat:** Familie\n\nText');
	});

	it('links the source and leaves out empty parts', () => {
		expect(
			ticketPrefill(full({ kind: 'link', sourceUrl: 'https://example.com/a', body: '  ' }))
				.description
		).toBe('- **Link:** <https://example.com/a>');
		expect(ticketPrefill(full({ kind: 'todo', body: '' })).description).toBe('');
	});

	it('cuts to the limits of the ticket', () => {
		const prefill = ticketPrefill(full({ title: 'x'.repeat(250), body: 'y'.repeat(100_010) }));
		expect(prefill.title).toHaveLength(200);
		expect(prefill.description).toHaveLength(100_000);
	});

	it('adds date and link of a Notion entry (ADR-0041)', () => {
		expect(
			ticketPrefill(
				full({
					channel: 'notion',
					kind: 'task',
					sourceDate: '2026-10-04 22:00:00.000Z',
					sourceMeta: { all_day: true },
					sourceUrl: 'https://www.notion.so/Zeile-1',
					body: '- **Status:** Offen'
				})
			).description
		).toBe(
			'- **Datum:** 05.10.2026\n- **Link:** <https://www.notion.so/Zeile-1>\n\n- **Status:** Offen'
		);
	});
});

describe('eventDueDate (ADR-0036 §5, ADR-0041 §8)', () => {
	it('takes the Berlin date of events and of Notion entries, never of messages', () => {
		const date = '2026-10-04 22:00:00.000Z';
		expect(eventDueDate({ kind: 'event', channel: 'calendar', sourceDate: date })).toBe(
			'2026-10-05'
		);
		expect(eventDueDate({ kind: 'task', channel: 'notion', sourceDate: date })).toBe('2026-10-05');
		expect(eventDueDate({ kind: 'todo', channel: 'notion', sourceDate: null })).toBeNull();
		expect(eventDueDate({ kind: 'message', channel: 'telegram', sourceDate: date })).toBeNull();
		expect(eventDueDate({ kind: 'mail', channel: 'mail', sourceDate: date })).toBeNull();
	});
});

describe('preset of typed-in entries (E4 plan, package 5)', () => {
	const preset = {
		project: 'proj00000000001',
		tags: ['tag000000000001', 'tag000000000002', 'tag000000000001', 'Einkauf'],
		priority: 'high',
		due: '2026-10-01'
	};

	it('reads project, tags, priority and due date of manual and quick entries', () => {
		for (const channel of ['manual', 'quick'] as const) {
			expect(presetOf(item({ channel, sourceMeta: { preset } }))).toEqual({
				project: 'proj00000000001',
				tagIds: ['tag000000000001', 'tag000000000002'],
				priority: 'high',
				due: '2026-10-01'
			});
		}
	});

	it('ignores presets of other channels and invalid values', () => {
		const empty = { project: null, tagIds: [], priority: null, due: null };
		expect(presetOf(item({ channel: 'eml', sourceMeta: { preset } }))).toEqual(empty);
		expect(presetOf(item({ sourceMeta: { preset: 'x' } }))).toEqual(empty);
		expect(
			presetOf(
				item({
					sourceMeta: {
						preset: { project: '../x', tags: 'a', priority: 'very', due: '2026-02-30' }
					}
				})
			)
		).toEqual(empty);
	});

	it('writes only the chosen parts', () => {
		expect(presetMeta({ project: null, tagIds: [], priority: null, due: null })).toEqual({});
		expect(
			presetMeta({ project: 'proj00000000001', tagIds: ['t'], priority: 'low', due: '2026-01-02' })
		).toEqual({ project: 'proj00000000001', tags: ['t'], priority: 'low', due: '2026-01-02' });
	});

	it('hands the preset to the prefill', () => {
		const prefill = ticketPrefill({ ...item({ sourceMeta: { preset } }), body: '' });
		expect(prefill.preset.project).toBe('proj00000000001');
		expect(ticketPrefill({ ...item(), body: '' }).preset).toEqual({
			project: null,
			tagIds: [],
			priority: null,
			due: null
		});
	});
});

describe('httpUrlOf', () => {
	it('takes http and https addresses with a host, trimmed', () => {
		expect(httpUrlOf(' https://example.com/a?b#c ')).toBe('https://example.com/a?b#c');
		expect(httpUrlOf('HTTP://EXAMPLE.COM')).toBe('HTTP://EXAMPLE.COM');
	});

	it('refuses other schemes, whitespace, missing hosts and over-long addresses', () => {
		for (const value of [
			'javascript:alert(1)',
			'data:text/plain,x',
			'file:///C:/x',
			'mailto:a@b.de',
			'https://exa mple.com',
			'http://',
			'/pfad',
			''
		]) {
			expect(httpUrlOf(value), value).toBeNull();
		}
		expect(httpUrlOf(`https://example.com/${'x'.repeat(2000)}`)).toBeNull();
	});
});

describe('sourceDateText (E4 plan, package 14)', () => {
	it('shows an all-day date without a time and other dates in Berlin time', () => {
		expect(
			sourceDateText({ sourceDate: '2026-12-23 23:00:00.000Z', sourceMeta: { all_day: true } })
		).toBe('24.12.2026');
		expect(sourceDateText({ sourceDate: '2026-03-29 08:00:00.000Z', sourceMeta: {} })).toBe(
			'29.03.2026 10:00'
		);
		expect(sourceDateText({ sourceDate: null, sourceMeta: { all_day: true } })).toBe('');
	});
});
