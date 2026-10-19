// The search over sources (QS-2, ADR-0031 addendum N): what an entry is found by, the words and
// the normalisation of the ticket picker, source tickets by key and title, the threshold of the
// section and its texts.

import { describe, expect, it } from 'vitest';
import type { InboxItem, InboxItemSummary } from './inbox';
import {
	hasSourceSearch,
	matchesSourceWords,
	noEntryMatchText,
	noSourceMatchText,
	searchHitsText,
	sourceSearchText
} from './source-search';
import { matchesWords, searchWords } from './ticket-picker';

function item(overrides: Partial<InboxItemSummary> = {}): InboxItemSummary {
	return {
		id: 'item00000000001',
		channel: 'telegram',
		kind: 'message',
		title: 'Nachricht',
		sourceUrl: '',
		sourceRef: '42:7',
		sourceDate: null,
		sourceMeta: {},
		original: '',
		state: 'converted',
		ticketId: 'ticket000000001',
		handledAt: '2026-09-25 09:00:00.000Z',
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 09:00:00.000Z',
		...overrides
	};
}

const MAIL = item({
	channel: 'mail',
	kind: 'mail',
	title: 'Rechnung März',
	sourceDate: '2026-09-24 08:30:00.000Z',
	sourceMeta: { from: 'Grüne Straße GmbH <post@example.com>' }
});

/** Whether the search text `text` finds `entry`. */
function finds(entry: InboxItemSummary, text: string, connection: string | null = null): boolean {
	return matchesSourceWords(entry, searchWords(text), connection);
}

describe('sourceSearchText (QS-2)', () => {
	it('holds title, channel, date and sender, normalised like the ticket picker', () => {
		expect(sourceSearchText(MAIL, null)).toBe(
			'rechnung marz postfach 24.09.2026 10:30 grune strasse gmbh <post@example.com>'
		);
	});

	it('names the connection with the channel, as the row does', () => {
		expect(sourceSearchText(MAIL, 'Gmail Arbeit')).toContain('postfach · gmail arbeit');
	});

	it('holds sender, chat and address together, although the row shows only the first', () => {
		const chat = item({
			sourceMeta: { sender: 'Ben', chat: 'Familie' },
			sourceUrl: 'https://example.com/a'
		});
		const text = sourceSearchText(chat, null);
		for (const part of ['ben', 'familie', 'https://example.com/a', 'telegram']) {
			expect(text).toContain(part);
		}
	});

	it('holds the key of the ticket a copy came from', () => {
		const copy = item({ sourceMeta: { copy_of: { key: 'HAUS-12', ticket: 'ticket000000012' } } });
		expect(sourceSearchText(copy, null)).toContain('haus-12');
	});

	it('takes the arrival without a date at the sender, and an all-day date as a date only', () => {
		expect(sourceSearchText(item(), null)).toContain('25.09.2026 10:00');
		const allDay = item({
			channel: 'ics',
			kind: 'event',
			sourceDate: '2026-10-03 00:00:00.000Z',
			sourceMeta: { all_day: true }
		});
		expect(sourceSearchText(allDay, null)).toContain('03.10.2026');
		expect(sourceSearchText(allDay, null)).not.toContain('03.10.2026 ');
	});

	it('leaves out the text of an entry, other details and the ticket of the entry', () => {
		const loaded: InboxItem = {
			...item({
				sourceMeta: { keyword: 'einkauf', location: 'Marktplatz', to: 'anna@example.com' },
				ticket: { id: 'ticket000000001', key: 'TASK-4', title: 'Dieses Ticket', primary: false }
			}),
			body: 'Bitte bis Freitag zahlen'
		};
		for (const text of ['freitag', 'einkauf', 'marktplatz', 'anna@', 'task-4']) {
			expect(finds(loaded, text), text).toBe(false);
		}
	});
});

describe('matchesSourceWords (QS-2)', () => {
	it('finds every entry without words, also for a text of blanks', () => {
		expect(finds(MAIL, '')).toBe(true);
		expect(finds(MAIL, '   ')).toBe(true);
	});

	it('wants every word, each in any field and in any order', () => {
		expect(finds(MAIL, 'rechnung')).toBe(true);
		expect(finds(MAIL, 'gmbh rechnung')).toBe(true);
		expect(finds(MAIL, 'postfach 24.09.2026')).toBe(true);
		expect(finds(MAIL, 'rechnung mahnung')).toBe(false);
		// Not a phrase any more: the words need not stand together.
		expect(finds(MAIL, 'märz rechnung')).toBe(true);
	});

	it('ignores case, accents, umlaut dots and ß', () => {
		for (const text of ['RECHNUNG', 'marz', 'MÄRZ', 'grune strasse', 'Grüne Straße', 'straße']) {
			expect(finds(MAIL, text), text).toBe(true);
		}
		const cafe = item({ title: 'Café am Markt' });
		expect(finds(cafe, 'cafe')).toBe(true);
		expect(finds(cafe, 'CAFÉ')).toBe(true);
	});

	it('finds parts of words, addresses and the name of the connection', () => {
		expect(finds(MAIL, 'rech')).toBe(true);
		expect(finds(MAIL, 'post@example')).toBe(true);
		expect(finds(MAIL, 'gmail')).toBe(false);
		expect(finds(MAIL, 'gmail arbeit', 'Gmail Arbeit')).toBe(true);
	});
});

describe('source tickets by key and title (QS-2, matchesWords of the ticket picker)', () => {
	const ticket = { key: 'HAUS-12', title: 'Heizung prüfen' };

	it('finds a source ticket by its key, its title or both, with the same normalisation', () => {
		for (const text of ['haus-12', 'HAUS', 'heizung', 'prufen', 'Prüfen haus-12']) {
			expect(matchesWords(ticket, searchWords(text)), text).toBe(true);
		}
		expect(matchesWords(ticket, searchWords('haus-13'))).toBe(false);
		expect(matchesWords(ticket, searchWords('heizung wasser'))).toBe(false);
	});
});

describe('threshold and texts of the search (QS-2)', () => {
	it('offers the search of the section only from more than one page of five', () => {
		expect(hasSourceSearch(0)).toBe(false);
		expect(hasSourceSearch(5)).toBe(false);
		expect(hasSourceSearch(6)).toBe(true);
		expect(hasSourceSearch(200)).toBe(true);
	});

	it('names hits and the empty result with the text as typed, trimmed', () => {
		expect(searchHitsText(3, 12)).toBe('3 von 12');
		expect(searchHitsText(1, 6)).toBe('1 von 6');
		expect(noSourceMatchText('  Rechnung ')).toBe('Keine Quelle passt zu „Rechnung“');
		expect(noEntryMatchText('Mahnung  ')).toBe('Kein Eintrag passt zu „Mahnung“.');
	});
});
