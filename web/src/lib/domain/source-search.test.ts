// The search over sources (QS-2, ADR-0031 addendum N): what an entry is found by, the words and
// the normalisation of the ticket picker, source tickets by key and title, the threshold of the
// section and its texts. Since EG-2 the search of the inbox: the ticket of a linked entry, the
// words that go to the server and the invariant that the server answers a superset.

import { describe, expect, it } from 'vitest';
import type { InboxItem, InboxItemSummary } from './inbox';
import {
	INBOX_PATTERN_BUDGET,
	hasSourceSearch,
	inboxClientOnlyTexts,
	inboxSearchText,
	inboxServerWords,
	matchesInboxWords,
	matchesSourceWords,
	noEntryMatchText,
	noSourceMatchText,
	searchHitsText,
	sourceSearchText
} from './source-search';
import { PICKER_SERVER_WORDS, loosePattern, matchesWords, searchWords } from './ticket-picker';

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
		expect(searchHitsText(3, 50, true)).toBe('3 von 50+');
		expect(noSourceMatchText('  Rechnung ')).toBe('Keine Quelle passt zu „Rechnung“');
		expect(noEntryMatchText('Mahnung  ')).toBe('Kein Eintrag passt zu „Mahnung“.');
	});
});

const TICKET = { id: 'ticket000000001', key: 'HAUS-12', title: 'Heizung prüfen', primary: false };

describe('inboxSearchText (EG-2)', () => {
	it('adds key and title of the ticket the row of a linked entry shows', () => {
		const linked = item({ ticket: TICKET });
		expect(inboxSearchText(linked, null)).toBe(
			`${sourceSearchText(linked, null)} haus-12 heizung prufen`
		);
		for (const text of ['haus-12', 'HAUS', 'heizung prüfen', 'prufen nachricht']) {
			expect(matchesInboxWords(linked, searchWords(text), null), text).toBe(true);
		}
	});

	it('leaves out a ticket the row does not show, the text of the entry and other details', () => {
		// Not converted, another ticket than the one the server named, or no ticket named at all.
		for (const entry of [
			item({ state: 'discarded', ticketId: null, ticket: TICKET }),
			item({ ticketId: 'ticket000000002', ticket: TICKET }),
			item({ ticket: null })
		]) {
			expect(matchesInboxWords(entry, searchWords('haus-12'), null)).toBe(false);
		}
		const loaded: InboxItem = {
			...item({
				sourceMeta: { keyword: 'einkauf', location: 'Marktplatz', to: 'anna@example.com' }
			}),
			body: 'Bitte bis Freitag zahlen'
		};
		for (const text of ['freitag', 'einkauf', 'marktplatz', 'anna@']) {
			expect(matchesInboxWords(loaded, searchWords(text), null), text).toBe(false);
		}
	});

	it('finds what the row shows: title, channel with connection, date, sender, every word somewhere', () => {
		const words = (text: string) => searchWords(text);
		expect(matchesInboxWords(MAIL, words('rechnung postfach'), null)).toBe(true);
		expect(matchesInboxWords(MAIL, words('gmail 24.09.2026 grüne'), 'Gmail Arbeit')).toBe(true);
		expect(matchesInboxWords(MAIL, words('gmail'), null)).toBe(false);
		expect(matchesInboxWords(MAIL, [], null)).toBe(true);
	});
});

describe('inboxClientOnlyTexts (EG-2)', () => {
	it('holds every channel label, alone and with every known connection, normalised', () => {
		const texts = inboxClientOnlyTexts(['Gmail Arbeit', 'Postfach']);
		expect(texts).toContain('postfach');
		expect(texts).toContain('postfach · gmail arbeit');
		expect(texts).toContain('google calendar · gmail arbeit');
		expect(texts).toContain('eigener eingang (api)');
		// A name like its channel adds nothing (withConnectionName).
		expect(texts.filter((text) => text.startsWith('postfach'))).toEqual([
			'postfach',
			'postfach · gmail arbeit'
		]);
		expect(new Set(texts).size).toBe(texts.length);
	});
});

describe('inboxServerWords (EG-2)', () => {
	const texts = inboxClientOnlyTexts(['Gmail Arbeit']);
	const server = (text: string) => inboxServerWords(searchWords(text), texts);

	it('sends the words of title, sender and address and keeps the order', () => {
		expect(server('Rechnung Müller strasse')).toEqual(['rechnung', 'muller', 'strasse']);
		expect(server('post@example.com https://example.com/a')).toEqual([
			'post@example.com',
			'https://example.com/a'
		]);
	});

	it('keeps words of channel labels and connection names in the client', () => {
		for (const text of ['Postfach', 'mail', 'kalender', 'gmail', 'Arbeit', 'WhatsApp', 'api)']) {
			expect(server(text), text).toEqual([]);
		}
		expect(server('Arbeit Rechnung')).toEqual(['rechnung']);
	});

	it('keeps words that may stand in a date, with digits or only dots and colons, in the client', () => {
		for (const text of ['24.09.2026', '2026', '10:30', 'HAUS-12', 'a1', '.', ':', '.:']) {
			expect(server(text), text).toEqual([]);
		}
		expect(server('a.b')).toEqual(['a.b']);
	});

	it('keeps words with characters outside ASCII in the client, after the normalisation', () => {
		// Umlauts, accents and ß normalise to ASCII; other letters do not.
		expect(server('Ärzte Crème Straße')).toEqual(['arzte', 'creme', 'strasse']);
		for (const text of ['Øl', 'Łódź', 'Ελλάδα', '→', 'Gmail·Arbeit']) {
			expect(server(text), text).toEqual([]);
		}
	});

	it('sends each word once, at most PICKER_SERVER_WORDS words and INBOX_PATTERN_BUDGET characters', () => {
		expect(server('rechnung rechnung')).toEqual(['rechnung']);
		expect(server('eins zwei drei vier fuenf sechs')).toHaveLength(PICKER_SERVER_WORDS);
		const long = 'q'.repeat(INBOX_PATTERN_BUDGET);
		// Too long for the budget: it stays in the client, a shorter word after it still goes.
		expect(server(`${long} rechnung`)).toEqual(['rechnung']);
		const fits = 'q'.repeat(INBOX_PATTERN_BUDGET - 2);
		expect(server(fits)).toEqual([fits]);
		// A quote takes two characters in the filter (`pb.filter` writes it as \').
		expect(server(`'${'q'.repeat(INBOX_PATTERN_BUDGET - 3)}`)).toEqual([]);
	});
});

/**
 * LIKE of SQLite with `\` as escape, as PocketBase runs `~` with a loose pattern: only ASCII letters
 * without case, `_` one character (one code point), `%` any run.
 */
function sqliteLike(pattern: string, text: string): boolean {
	const asciiLower = (value: string) => value.replace(/[A-Z]/g, (char) => char.toLowerCase());
	const escape = (char: string) => char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
	const chars = [...asciiLower(pattern)];
	let source = '';
	for (let index = 0; index < chars.length; index += 1) {
		const char = chars[index] ?? '';
		if (char === '\\') {
			index += 1;
			source += escape(chars[index] ?? '');
		} else if (char === '%') source += '[\\s\\S]*';
		else if (char === '_') source += '[\\s\\S]';
		else source += escape(char);
	}
	return new RegExp(`^${source}$`, 'u').test(asciiLower(text));
}

describe('the server answers a superset of what the client finds (EG-2 invariant)', () => {
	const NAMES = ['Gmail Arbeit', 'Familie Müller'];
	const entries: { entry: InboxItemSummary; name: string | null }[] = [
		{ entry: MAIL, name: 'Gmail Arbeit' },
		{
			entry: item({
				title: 'STRASSENFEST am Südplatz: 50% Rabatt_heute',
				sourceMeta: { sender: 'Jürgen O\'Brien "JB"', chat: 'Familie Müller' },
				connectionId: 'conn00000000002'
			}),
			name: 'Familie Müller'
		},
		{
			entry: item({
				channel: 'link',
				kind: 'link',
				title: 'Crème brûlée – Rezept',
				sourceUrl: 'https://Example.com/Rezepte?q=Cr%C3%A8me&x=a\\b',
				state: 'discarded',
				ticketId: null
			}),
			name: null
		},
		{
			entry: item({
				channel: 'ics',
				kind: 'event',
				title: 'Ärztin Dr. Weiß',
				sourceDate: '2026-10-03 00:00:00.000Z',
				sourceMeta: { all_day: true, location: 'Praxis am Markt' },
				ticket: { id: 'ticket000000001', key: 'GESUND-7', title: 'Vorsorge Zähne', primary: true }
			}),
			name: null
		},
		{
			entry: item({
				title: 'Kopie',
				sourceMeta: {
					copy_of: { key: 'HAUS-12', ticket: 'ticket000000012' },
					from: '<x@example.com>'
				}
			}),
			name: null
		}
	];

	/** The values the server compares with the patterns (data/inbox.ts, SEARCH_FIELDS). */
	function serverValues(entry: InboxItemSummary): string[] {
		const meta = entry.sourceMeta;
		const copy = meta.copy_of as { key?: unknown } | undefined;
		return [
			entry.title,
			entry.sourceUrl,
			...['from', 'sender', 'chat'].map((key) => (typeof meta[key] === 'string' ? meta[key] : '')),
			typeof copy?.key === 'string' ? copy.key : '',
			entry.ticket?.key ?? '',
			entry.ticket?.title ?? ''
		];
	}

	/** Every part of every word of the text the client compares, as a search of one word. */
	function wordsOf(text: string): string[] {
		const words = new Set<string>();
		for (const word of text.split(' ')) {
			for (let start = 0; start < word.length; start += 1) {
				for (let end = start + 1; end <= word.length; end += 1) words.add(word.slice(start, end));
			}
		}
		return [...words];
	}

	it('matches every server word against a stored field of every entry the client finds', () => {
		const texts = inboxClientOnlyTexts(NAMES);
		let checked = 0;
		for (const { entry, name } of entries) {
			const values = serverValues(entry);
			for (const word of wordsOf(inboxSearchText(entry, name))) {
				expect(matchesInboxWords(entry, [word], name)).toBe(true);
				for (const sent of inboxServerWords([word], texts)) {
					const found = values.some((value) => sqliteLike(loosePattern(sent), value));
					expect(found, `"${sent}" of ${entry.title}`).toBe(true);
					checked += 1;
				}
			}
		}
		// Most parts of words reach the server; the check is not empty.
		expect(checked).toBeGreaterThan(500);
	});

	it('keeps words found only through the channel, the connection or the date in the client', () => {
		const texts = inboxClientOnlyTexts(NAMES);
		const [mail] = entries;
		for (const text of ['postfach', 'gmail', 'arbeit', '24.09.2026', '10:30']) {
			expect(matchesInboxWords(mail!.entry, [text], mail!.name), text).toBe(true);
			expect(inboxServerWords([text], texts), text).toEqual([]);
		}
	});
});
