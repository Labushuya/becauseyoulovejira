// The search over sources (QS-2, ADR-0031 addendum N): what an entry is found by, the words and
// the normalisation of the ticket picker, source tickets by key and title, the threshold of the
// section and its texts. Since EG-2 the search of the inbox: the ticket of a linked entry, the date
// of the row, the words that go to the server and the invariant that the server answers a superset.

import { describe, expect, it } from 'vitest';
import { SEARCH_FIELDS } from '../data/inbox';
import { INBOX_VIEWS, type InboxItem, type InboxItemSummary } from './inbox';
import {
	INBOX_PATTERN_BUDGET,
	hasSourceSearch,
	inboxClientOnlyTexts,
	inboxSearchText,
	inboxServerWords,
	matchesInboxWords,
	matchesSourceWords,
	noEntryMatchText,
	noLoadedEntryMatchText,
	noLoadedEntryMatchTitle,
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
		// A paged view with further pages speaks of the loaded entries only (EG-2 review).
		expect(noLoadedEntryMatchTitle(' Mahnung')).toBe(
			'Von den bisher geladenen Einträgen passt keiner zu „Mahnung“'
		);
		expect(noLoadedEntryMatchText('Mahnung')).toBe(
			'Von den bisher geladenen Einträgen passt keiner zu „Mahnung“.'
		);
	});
});

const TICKET = { id: 'ticket000000001', key: 'HAUS-12', title: 'Heizung prüfen', primary: false };

describe('inboxSearchText (EG-2)', () => {
	it('adds key and title of the ticket the row of a linked entry shows', () => {
		const linked = item({ ticket: TICKET });
		// The row of "Verknüpft" shows the handling, 09:00 UTC is 11:00 in Berlin (EG-2 review).
		expect(inboxSearchText(linked, null, 'converted')).toBe(
			`${sourceSearchText(linked, null)} 25.09.2026 11:00 haus-12 heizung prufen`
		);
		for (const text of ['haus-12', 'HAUS', 'heizung prüfen', 'prufen nachricht']) {
			expect(matchesInboxWords(linked, searchWords(text), null, 'converted'), text).toBe(true);
		}
	});

	it('finds every date the row shows in its view: the arrival or the handling, and the date at the sender (EG-2 review)', () => {
		const entry = item({
			state: 'discarded',
			ticketId: null,
			sourceDate: '2026-09-20 06:00:00.000Z',
			created: '2026-09-22 08:00:00.000Z',
			handledAt: '2026-09-24 09:00:00.000Z'
		});
		const finds = (text: string, view: (typeof INBOX_VIEWS)[number]) =>
			matchesInboxWords(entry, searchWords(text), null, view);
		// The date at the sender in every view, as before.
		for (const view of INBOX_VIEWS) expect(finds('20.09.2026', view), view).toBe(true);
		// "Verworfen" shows the handling, "Alle" and "Neu" the arrival.
		expect(finds('24.09.2026 11:00', 'discarded')).toBe(true);
		expect(finds('24.09.2026', 'all')).toBe(false);
		expect(finds('22.09.2026 10:00', 'all')).toBe(true);
		expect(finds('22.09.2026', 'discarded')).toBe(false);
		// Without a handling the row shows the arrival.
		const linked = item({ handledAt: null, created: '2026-09-23 08:00:00.000Z' });
		expect(matchesInboxWords(linked, ['23.09.2026'], null, 'converted')).toBe(true);
		// Without a date at the sender the arrival stands once in the text.
		const plain = item({ state: 'new', ticketId: null, handledAt: null });
		expect(inboxSearchText(plain, null, 'new')).toBe(sourceSearchText(plain, null));
	});

	it('builds the text of an entry once, and anew for another name of its connection or another view (EG-2 review)', () => {
		const mail = { ...MAIL, connectionId: 'conn00000000001' };
		expect(matchesInboxWords(mail, ['gmail'], 'Gmail Arbeit', 'converted')).toBe(true);
		expect(inboxSearchText(mail, 'Gmail Arbeit', 'converted')).toBe(
			inboxSearchText(mail, 'Gmail Arbeit', 'converted')
		);
		// The connection was renamed: the cached text must not find the old name.
		expect(matchesInboxWords(mail, ['gmail'], 'Privat', 'converted')).toBe(false);
		expect(matchesInboxWords(mail, ['privat'], 'Privat', 'converted')).toBe(true);
		expect(matchesInboxWords(mail, ['gmail'], 'Gmail Arbeit', 'converted')).toBe(true);
		// Another view shows another date of the same object.
		expect(matchesInboxWords(mail, ['25.09.2026'], null, 'converted')).toBe(true);
		expect(matchesInboxWords(mail, ['11:00'], null, 'all')).toBe(false);
		expect(matchesInboxWords(mail, ['11:00'], null, 'converted')).toBe(true);
	});

	it('leaves out a ticket the row does not show, the text of the entry and other details', () => {
		// Not converted, another ticket than the one the server named, or no ticket named at all.
		for (const entry of [
			item({ state: 'discarded', ticketId: null, ticket: TICKET }),
			item({ ticketId: 'ticket000000002', ticket: TICKET }),
			item({ ticket: null })
		]) {
			expect(matchesInboxWords(entry, searchWords('haus-12'), null, 'all')).toBe(false);
		}
		const loaded: InboxItem = {
			...item({
				sourceMeta: { keyword: 'einkauf', location: 'Marktplatz', to: 'anna@example.com' }
			}),
			body: 'Bitte bis Freitag zahlen'
		};
		for (const text of ['freitag', 'einkauf', 'marktplatz', 'anna@']) {
			expect(matchesInboxWords(loaded, searchWords(text), null, 'converted'), text).toBe(false);
		}
	});

	it('finds what the row shows: title, channel with connection, date, sender, every word somewhere', () => {
		const words = (text: string) => searchWords(text);
		expect(matchesInboxWords(MAIL, words('rechnung postfach'), null, 'converted')).toBe(true);
		expect(
			matchesInboxWords(MAIL, words('gmail 24.09.2026 grüne'), 'Gmail Arbeit', 'converted')
		).toBe(true);
		expect(matchesInboxWords(MAIL, words('gmail'), null, 'converted')).toBe(false);
		expect(matchesInboxWords(MAIL, [], null, 'converted')).toBe(true);
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

	it('keeps words that may stand in a date, of digits, dots and colons only, in the client', () => {
		for (const text of ['24.09.2026', '2026', '10:30', '09.2026 10', '4.0', '.', ':', '.:']) {
			expect(server(text), text).toEqual([]);
		}
		expect(server('a.b')).toEqual(['a.b']);
		// No date holds a letter or another sign: keys and numbers with them narrow on the server.
		expect(server('HAUS-12 a1 50% 3,5')).toEqual(['haus-12', 'a1', '50%', '3,5']);
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
		// `pb.filter` writes a JSON string (EG-2 review): `"` and `\` take two characters in the filter,
		// `'` one; a `\` of the word is `\\` in the pattern already.
		const quote = `'${'q'.repeat(INBOX_PATTERN_BUDGET - 3)}`;
		expect(server(quote)).toEqual([quote]);
		expect(server(`"${'q'.repeat(INBOX_PATTERN_BUDGET - 3)}`)).toEqual([]);
		expect(server(`\\${'q'.repeat(INBOX_PATTERN_BUDGET - 5)}`)).toEqual([]);
		const backslash = `\\${'q'.repeat(INBOX_PATTERN_BUDGET - 6)}`;
		expect(server(backslash)).toEqual([backslash]);
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
		},
		// Accented forms of d, g, l, r and t (EG-2 review, R-A1).
		{
			entry: item({
				channel: 'mail',
				kind: 'mail',
				title: 'Termin bei Doğan',
				sourceMeta: { from: 'Antonín Dvořák <ad@example.com>' },
				handledAt: '2026-10-05 16:45:00.000Z'
			}),
			name: null
		},
		{
			entry: item({
				title: 'Țară, Ľubo und Ďakovo',
				state: 'discarded',
				ticketId: null,
				handledAt: null
			}),
			name: null
		}
	];

	/**
	 * The value of a field of SEARCH_FIELDS (data/inbox.ts) as the server compares it: the column, a
	 * JSON path of `source_meta` (text only, as the row), or a field of the ticket. A new field fails
	 * here until the test knows it.
	 */
	function serverValue(entry: InboxItemSummary, field: string): string {
		const [head = '', ...path] = field.split('.');
		let value: unknown;
		if (field === 'title') value = entry.title;
		else if (field === 'source_url') value = entry.sourceUrl;
		else if (head === 'source_meta') {
			value = path.reduce<unknown>(
				(at, key) =>
					typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[key] : undefined,
				entry.sourceMeta
			);
		} else if (field === 'ticket.key') value = entry.ticket?.key;
		else if (field === 'ticket.title') value = entry.ticket?.title;
		else throw new Error(`Unknown field of the search: ${field}`);
		return typeof value === 'string' ? value : '';
	}

	/** The values the server compares with the patterns, one per field of SEARCH_FIELDS. */
	function serverValues(entry: InboxItemSummary): string[] {
		return SEARCH_FIELDS.map((field) => serverValue(entry, field));
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
			// Every view: the row shows the arrival or the handling (EG-2 review).
			for (const view of INBOX_VIEWS) {
				for (const word of wordsOf(inboxSearchText(entry, name, view))) {
					expect(matchesInboxWords(entry, [word], name, view)).toBe(true);
					for (const sent of inboxServerWords([word], texts)) {
						const found = values.some((value) => sqliteLike(loosePattern(sent), value));
						expect(found, `"${sent}" of ${entry.title} in ${view}`).toBe(true);
						checked += 1;
					}
				}
			}
		}
		// Most parts of words reach the server; the check is not empty.
		expect(checked).toBeGreaterThan(2000);
	});

	it('finds "dogan", "dvorak" and "tara lubo dakovo" on the server as well (EG-2 review)', () => {
		const texts = inboxClientOnlyTexts(NAMES);
		for (const [text, title] of [
			['dogan', 'Termin bei Doğan'],
			['dvorak', 'Termin bei Doğan'],
			['tara lubo dakovo', 'Țară, Ľubo und Ďakovo']
		] as const) {
			const { entry, name } = entries.find((candidate) => candidate.entry.title === title)!;
			const words = searchWords(text);
			expect(matchesInboxWords(entry, words, name, 'all'), text).toBe(true);
			const sent = inboxServerWords(words, texts);
			expect(sent, text).toEqual(words);
			for (const word of sent) {
				const values = serverValues(entry);
				expect(
					values.some((value) => sqliteLike(loosePattern(word), value)),
					word
				).toBe(true);
			}
		}
	});

	it('keeps words found only through the channel, the connection or the date in the client', () => {
		const texts = inboxClientOnlyTexts(NAMES);
		const [mail] = entries;
		for (const text of ['postfach', 'gmail', 'arbeit', '24.09.2026', '10:30', '11:00']) {
			expect(matchesInboxWords(mail!.entry, [text], mail!.name, 'converted'), text).toBe(true);
			expect(inboxServerWords([text], texts), text).toEqual([]);
		}
	});
});
