// Sources of a ticket and the copy status (ADR-0031 sections 5 and 7).

import { describe, expect, it } from 'vitest';
import { INBOX_CHANNELS, type InboxItemSummary } from './inbox';
import {
	COPY_LABELS,
	canLeaveTicket,
	canSavePage,
	copyCompleteness,
	copyNote,
	deletedTicketNote,
	deletedWithSourcesText,
	isMainSource,
	linkSummary,
	orderSources,
	pageCopyText,
	sourceCountText,
	sourceOrderAnnouncement,
	sourceOrigin,
	sourceTime,
	sourceWhen
} from './sources';

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

describe('copyCompleteness', () => {
	it('names every channel', () => {
		const expected: Record<string, string> = {
			manual: 'complete',
			quick: 'complete',
			clipboard: 'complete',
			link: 'address',
			eml: 'text',
			mail: 'text',
			ics: 'text',
			calendar: 'text',
			whatsapp: 'text',
			telegram: 'text',
			notion: 'text',
			api: 'text',
			'whatsapp-web': 'text',
			github: 'text',
			folder: 'reference'
		};
		for (const channel of INBOX_CHANNELS) {
			expect(copyCompleteness(item({ channel })), channel).toBe(expected[channel]);
		}
	});

	it('is complete with the original file, for mails, events and saved pages', () => {
		for (const channel of ['eml', 'mail', 'ics', 'calendar', 'link'] as const) {
			expect(copyCompleteness(item({ channel, original: 'datei_abc.eml' })), channel).toBe(
				'complete'
			);
		}
	});

	it('knows a mail without its file because it was too large, whatever the limit was then', () => {
		const large = item({
			channel: 'mail',
			sourceMeta: { original_omitted: 'too_large', original_size: 13_000_000 }
		});
		expect(copyCompleteness(large)).toBe('too_large');
		expect(COPY_LABELS.too_large).toBe('Ohne Originaldatei (zu groß)');
		expect(copyNote(large)).toBe(
			'Die Mail war zu groß für die Originaldatei (12,4 MB). Gespeichert sind Absender, Betreff, Datum und der Anfang des Textes, die Originaldatei nicht.'
		);
		expect(
			copyNote(item({ channel: 'eml', sourceMeta: { original_omitted: 'too_large' } }))
		).toMatch(/^Die Mail war zu groß für die Originaldatei\. /);
		// Any other value is no mark.
		expect(
			copyCompleteness(item({ channel: 'mail', sourceMeta: { original_omitted: 'yes' } }))
		).toBe('text');
	});

	it('calls a file of GitHub complete with its copy, else points to GitHub (ADR-0050 §3)', () => {
		const file = item({ channel: 'github', kind: 'change', original: 'changelog_abc.md' });
		expect(copyCompleteness(file)).toBe('complete');
		expect(copyNote(file)).toBeNull();
		const pull = item({ channel: 'github', kind: 'pull_request' });
		expect(copyCompleteness(pull)).toBe('text');
		expect(copyNote(pull)).toBe(
			'Gespeichert ist der Text des Eintrags. Den vollständigen Stand zeigt der Link zu GitHub.'
		);
	});

	it('calls a file of a folder a reference, no copy, whatever it carries (ADR-0051 §1)', () => {
		const file = item({ channel: 'folder', kind: 'file', sourceRef: 'C:\\Daten\\a.pdf' });
		expect(copyCompleteness(file)).toBe('reference');
		expect(copyCompleteness({ ...file, original: 'x.pdf' })).toBe('reference');
		expect(COPY_LABELS.reference).toBe('Verweis');
		expect(copyNote(file)).toBe(
			'Verweis auf die Datei im Ordner, keine Kopie: „Ansehen“ öffnet ihre aktuelle Fassung. Gespeichert sind nur Name, Pfad, Größe, Zeit, Typ und Prüfsumme.'
		);
	});

	it('calls a Notion entry complete only with its whole content (ADR-0041 §5)', () => {
		const notion = (content: string, original = 'notion_abc.json') =>
			item({ channel: 'notion', original, sourceMeta: { notion: { content } } });
		expect(copyCompleteness(notion('complete'))).toBe('complete');
		expect(copyNote(notion('complete'))).toBeNull();
		expect(copyCompleteness(notion('properties'))).toBe('text');
		expect(copyNote(notion('properties'))).toBe(
			'Übernommen sind Titel, Datum und Eigenschaften der Zeile. Den Inhalt ihrer Seite zeigt der Link zu Notion.'
		);
		expect(copyCompleteness(notion('truncated'))).toBe('text');
		expect(copyNote(notion('truncated'))).toMatch(/^Der Inhalt ist nur bis zur Grenze je Seite/);
		const large = item({
			channel: 'notion',
			sourceMeta: {
				original_omitted: 'too_large',
				original_size: 30_000_000,
				notion: { content: 'complete' }
			}
		});
		expect(copyCompleteness(large)).toBe('too_large');
		expect(copyNote(large)).toMatch(
			/^Was Notion lieferte, war zu groß für die Originaldatei \(28,6 MB\)/
		);
	});

	it('gives a neutral note only for copies that are not complete', () => {
		expect(copyNote(item({ channel: 'manual' }))).toBeNull();
		expect(copyNote(item({ channel: 'link', sourceUrl: 'https://example.com/' }))).toMatch(
			/^Gespeichert sind nur Adresse, Titel und Auszug\./
		);
		expect(copyNote(item({ channel: 'whatsapp' }))).toMatch(/^Gespeichert ist nur der Text\./);
		expect(Object.values(COPY_LABELS)).toEqual([
			'Vollständig',
			'Nur Text',
			'Nur Adresse',
			'Ohne Originaldatei (zu groß)',
			'Verweis'
		]);
	});
});

describe('what an entry allows (panel, sources of a ticket and menu of the inbox row, AM-5)', () => {
	const ticket = (primary: boolean) => ({
		id: 'ticket000000001',
		key: 'HAUS-12',
		title: 'Steuer',
		primary
	});

	it('offers "Seiteninhalt sichern" only for a web link of which only the address is stored', () => {
		const link = {
			channel: 'link' as const,
			kind: 'link' as const,
			sourceUrl: 'https://x.example'
		};
		expect(canSavePage(item({ ...link, state: 'new', ticketId: null }))).toBe(true);
		expect(canSavePage(item({ ...link, state: 'discarded', ticketId: null }))).toBe(true);
		expect(canSavePage(item(link))).toBe(true);
		expect(canSavePage(item({ ...link, original: 'seite.html' }))).toBe(false);
		expect(canSavePage(item())).toBe(false);
		expect(canSavePage(item({ channel: 'manual', kind: 'todo' }))).toBe(false);
	});

	it('knows the main source from the ticket loaded with the entry, else not at all', () => {
		expect(isMainSource(item({ ticket: ticket(true) }))).toBe(true);
		expect(isMainSource(item({ ticket: ticket(false) }))).toBe(false);
		expect(isMainSource(item({ ticket: null }))).toBeNull();
		expect(isMainSource(item())).toBeNull();
		// A ticket of an older state (the entry moved since) says nothing about the new one.
		expect(isMainSource(item({ ticketId: 'ticket000000002', ticket: ticket(false) }))).toBeNull();
		expect(isMainSource(item({ state: 'new', ticketId: null, ticket: null }))).toBeNull();
	});

	it('lets only a linked entry that is surely no main source leave its ticket', () => {
		expect(canLeaveTicket(item(), false)).toBe(true);
		expect(canLeaveTicket(item(), true)).toBe(false);
		expect(canLeaveTicket(item(), null)).toBe(false);
		expect(canLeaveTicket(item({ state: 'new', ticketId: null }), false)).toBe(false);
		expect(canLeaveTicket(item({ state: 'discarded', ticketId: null }), false)).toBe(false);
		// Converted without a ticket (its ticket is gone): nothing to leave.
		expect(canLeaveTicket(item({ ticketId: null }), false)).toBe(false);
	});
});

describe('sourceOrigin and sourceWhen', () => {
	it('names the sender, else the chat, else the address', () => {
		expect(sourceOrigin(item({ sourceMeta: { from: 'Anna <anna@example.com>', chat: 'x' } }))).toBe(
			'Anna <anna@example.com>'
		);
		expect(sourceOrigin(item({ sourceMeta: { sender: 'Ben', chat: 'Familie' } }))).toBe('Ben');
		expect(sourceOrigin(item({ sourceMeta: { chat: 'Familie' } }))).toBe('Familie');
		expect(sourceOrigin(item({ sourceUrl: 'https://example.com/a' }))).toBe(
			'https://example.com/a'
		);
		expect(sourceOrigin(item())).toBe('');
	});

	it('takes the date at the sender, else the arrival', () => {
		expect(sourceWhen(item({ sourceDate: '2026-09-24 08:30:00.000Z' }))).toBe('24.09.2026 10:30');
		expect(sourceWhen(item())).toBe('25.09.2026 10:00');
	});
});

describe('pageCopyText (ADR-0031 section 6)', () => {
	it('names when the page was saved and whether it was cut', () => {
		const page = (value: unknown) => item({ channel: 'link', sourceMeta: { page: value } });
		expect(pageCopyText(page({ fetched_at: '2026-09-27 19:30:00.000Z', truncated: false }))).toBe(
			'27.09.2026 21:30'
		);
		expect(pageCopyText(page({ fetched_at: '2026-01-05 07:00:00.000Z', truncated: true }))).toBe(
			'05.01.2026 08:00, auf 2 MB gekürzt'
		);
		for (const value of [undefined, null, 'x', [], {}, { fetched_at: 'gestern' }]) {
			expect(pageCopyText(page(value)), JSON.stringify(value)).toBe('');
		}
		expect(pageCopyText(item())).toBe('');
	});
});

describe('orderSources (QS-1, ADR-0031 addendum M)', () => {
	const ids = (list: readonly InboxItemSummary[]) => list.map((entry) => entry.id);
	/** An entry with a date at the sender (null for none), its arrival and its linking. */
	const source = (id: string, sourceDate: string | null, created: string, handledAt: string) =>
		item({ id, sourceDate, created, handledAt });

	it('orders by the time the list shows: an old mail linked late stands at its own date', () => {
		const main = source(
			'm',
			'2026-09-15 08:00:00.000Z',
			'2026-09-15 08:05:00.000Z',
			'2026-09-15 09:00:00.000Z'
		);
		// Sent on 1 September, in the inbox since then, linked only on 30 September.
		const late = source(
			'late',
			'2026-09-01 08:00:00.000Z',
			'2026-09-01 08:01:00.000Z',
			'2026-09-30 10:00:00.000Z'
		);
		const middle = source(
			'mid',
			'2026-09-10 08:00:00.000Z',
			'2026-09-10 08:01:00.000Z',
			'2026-09-16 10:00:00.000Z'
		);
		// Without a date at the sender: its arrival on 20 September counts.
		const typed = source('typed', null, '2026-09-20 08:00:00.000Z', '2026-09-21 10:00:00.000Z');
		const list = [typed, late, main, middle];
		expect(ids(orderSources(list, 'm', 'newest'))).toEqual(['m', 'typed', 'mid', 'late']);
		expect(ids(orderSources(list, 'm', 'oldest'))).toEqual(['m', 'late', 'mid', 'typed']);
	});

	it('keeps a moved entry at its own date, not at the time it was linked first', () => {
		// "Anderem Ticket zuordnen …" keeps handled_at: the moved entry still carries the linking to
		// its old ticket, long before the other one was linked here.
		const moved = source(
			'moved',
			'2026-09-15 08:00:00.000Z',
			'2026-09-15 08:01:00.000Z',
			'2026-08-01 10:00:00.000Z'
		);
		const here = source(
			'here',
			'2026-09-14 08:00:00.000Z',
			'2026-09-14 08:01:00.000Z',
			'2026-09-29 10:00:00.000Z'
		);
		expect(ids(orderSources([here, moved], null, 'newest'))).toEqual(['moved', 'here']);
		expect(ids(orderSources([moved, here], null, 'oldest'))).toEqual(['here', 'moved']);
	});

	it('orders entries linked in the same millisecond by their own times, then arrival, then ID', () => {
		// "Neues Ticket" with several sources links them at once: handled_at is the same.
		const at = '2026-09-25 10:00:00.000Z';
		const third = source('third', '2026-09-03 08:00:00.000Z', '2026-09-03 08:01:00.000Z', at);
		const first = source('first', '2026-09-01 08:00:00.000Z', '2026-09-01 08:01:00.000Z', at);
		const second = source('second', null, '2026-09-02 08:00:00.000Z', at);
		// Same date at the sender: the earlier arrival first; both equal: the ID decides.
		const laterArrival = source('arr2', '2026-09-04 08:00:00.000Z', '2026-09-05 08:00:00.000Z', at);
		const earlierArrival = source(
			'arr1',
			'2026-09-04 08:00:00.000Z',
			'2026-09-04 09:00:00.000Z',
			at
		);
		const twinB = source('twinb', '2026-09-06 08:00:00.000Z', '2026-09-06 08:00:00.000Z', at);
		const twinA = source('twina', '2026-09-06 08:00:00.000Z', '2026-09-06 08:00:00.000Z', at);
		const list = [twinB, third, laterArrival, first, twinA, second, earlierArrival];
		const oldest = ['first', 'second', 'third', 'arr1', 'arr2', 'twina', 'twinb'];
		expect(ids(orderSources(list, null, 'oldest'))).toEqual(oldest);
		expect(ids(orderSources(list, null, 'newest'))).toEqual([...oldest].reverse());
		// The same input in another order gives the same result.
		expect(ids(orderSources([...list].reverse(), null, 'oldest'))).toEqual(oldest);
	});

	it('takes the arrival for an entry without a date at the sender', () => {
		expect(sourceTime(item({ sourceDate: null, created: '2026-09-25 08:00:00.000Z' }))).toBe(
			'2026-09-25 08:00:00.000Z'
		);
		expect(
			sourceTime(
				item({ sourceDate: '2026-09-24 08:30:00.000Z', created: '2026-09-25 08:00:00.000Z' })
			)
		).toBe('2026-09-24 08:30:00.000Z');
		const withDate = source(
			'dated',
			'2026-09-24 12:00:00.000Z',
			'2026-09-26 08:00:00.000Z',
			'2026-09-26 09:00:00.000Z'
		);
		const without = source('plain', null, '2026-09-25 08:00:00.000Z', '2026-09-25 09:00:00.000Z');
		expect(ids(orderSources([without, withDate], null, 'oldest'))).toEqual(['dated', 'plain']);
	});

	it('puts the main source first in both orders, as the oldest and as the newest', () => {
		const a = source('a', null, '2026-09-20 08:00:00.000Z', '2026-09-20 09:00:00.000Z');
		const b = source('b', null, '2026-09-21 08:00:00.000Z', '2026-09-21 09:00:00.000Z');
		const oldMain = source('m', null, '2026-09-01 08:00:00.000Z', '2026-09-01 09:00:00.000Z');
		const newMain = source('m', null, '2026-09-30 08:00:00.000Z', '2026-09-30 09:00:00.000Z');
		for (const main of [oldMain, newMain]) {
			expect(ids(orderSources([a, main, b], 'm', 'newest')), main.created).toEqual(['m', 'b', 'a']);
			expect(ids(orderSources([a, main, b], 'm', 'oldest')), main.created).toEqual(['m', 'a', 'b']);
		}
		expect(ids(orderSources([a, oldMain, b], null, 'newest'))).toEqual(['b', 'a', 'm']);
	});

	it('compares points in time, not text', () => {
		// 08:30:00 written without milliseconds and with a T stands before 08:30:00.5.
		const iso = source(
			'iso',
			'2026-09-24T08:30:00Z',
			'2026-09-24 08:31:00.000Z',
			'2026-09-25 09:00:00.000Z'
		);
		const pocketBase = source(
			'pb',
			'2026-09-24 08:30:00.500Z',
			'2026-09-24 08:31:00.000Z',
			'2026-09-25 09:00:00.000Z'
		);
		expect(ids(orderSources([pocketBase, iso], null, 'oldest'))).toEqual(['iso', 'pb']);
	});

	it('shows and orders by the same time', () => {
		const list = [
			source('c', null, '2026-09-03 08:00:00.000Z', '2026-09-30 09:00:00.000Z'),
			source(
				'a',
				'2026-09-01 08:00:00.000Z',
				'2026-09-28 08:00:00.000Z',
				'2026-09-28 09:00:00.000Z'
			),
			// A whole day at the sender shows as a date and stands at the start of that day.
			item({
				id: 'b',
				sourceDate: '2026-09-01 22:00:00.000Z',
				sourceMeta: { all_day: true },
				created: '2026-09-29 08:00:00.000Z',
				handledAt: '2026-09-29 09:00:00.000Z'
			})
		];
		const oldest = orderSources(list, null, 'oldest');
		expect(oldest.map(sourceWhen)).toEqual(['01.09.2026 10:00', '02.09.2026', '03.09.2026 10:00']);
		// The shown date is the date of `sourceTime`, the time the order uses.
		for (const entry of oldest) {
			expect(sourceWhen(entry), entry.id).toBe(
				sourceWhen({ ...entry, sourceDate: sourceTime(entry) })
			);
		}
		expect(orderSources(list, null, 'newest').map(sourceWhen)).toEqual([
			'03.09.2026 10:00',
			'02.09.2026',
			'01.09.2026 10:00'
		]);
	});

	it('leaves the input alone', () => {
		const list = [item({ id: 'b' }), item({ id: 'a' })];
		orderSources(list, 'a', 'oldest');
		expect(ids(list)).toEqual(['b', 'a']);
	});

	it('says a change of the order', () => {
		expect(sourceOrderAnnouncement('newest')).toBe('Neueste Quellen zuerst.');
		expect(sourceOrderAnnouncement('oldest')).toBe('Älteste Quellen zuerst.');
	});
});

describe('linkSummary', () => {
	it('counts linked entries', () => {
		expect(linkSummary(1, 'TASK-4')).toBe('1 Eintrag mit TASK-4 verknüpft.');
		expect(linkSummary(3, 'HAUS-2')).toBe('3 Einträge mit HAUS-2 verknüpft.');
	});
});

describe('deleting a ticket with sources (ADR-0031, addendum B)', () => {
	it('counts the sources and names what happened to them', () => {
		expect(sourceCountText(1)).toBe('Zu diesem Ticket gehört 1 Quelle.');
		expect(sourceCountText(3)).toBe('Zu diesem Ticket gehören 3 Quellen.');
		// Into the trash (ADR-0037): discarded sources stay with the ticket.
		expect(deletedWithSourcesText('HAUS-12', 0, 'inbox')).toBe(
			'HAUS-12 in den Papierkorb verschoben.'
		);
		expect(deletedWithSourcesText('HAUS-12', 1, 'inbox')).toBe(
			'HAUS-12 in den Papierkorb verschoben. 1 Quelle ist wieder im Eingang.'
		);
		expect(deletedWithSourcesText('HAUS-12', 2, 'discard')).toBe(
			'HAUS-12 in den Papierkorb verschoben. 2 Quellen bleiben beim Ticket.'
		);
		expect(deletedWithSourcesText('HAUS-12', 1, 'discard')).toBe(
			'HAUS-12 in den Papierkorb verschoben. 1 Quelle bleibt beim Ticket.'
		);
		// Before the migration of the trash the server deletes for good, as in HK-6.
		expect(deletedWithSourcesText('HAUS-12', 0, 'inbox', false)).toBe('HAUS-12 wurde gelöscht.');
		expect(deletedWithSourcesText('HAUS-12', 1, 'inbox', false)).toBe(
			'HAUS-12 wurde gelöscht. 1 Quelle ist wieder im Eingang.'
		);
		expect(deletedWithSourcesText('HAUS-12', 2, 'discard', false)).toBe(
			'HAUS-12 wurde gelöscht. 2 Quellen sind verworfen.'
		);
	});

	it('tells an entry that its ticket was deleted, only while it belongs to none', () => {
		const note = { ticket_deleted: { key: 'HAUS-12', at: '2026-09-27 10:00:00.000Z' } };
		expect(deletedTicketNote(item({ state: 'new', sourceMeta: note }))).toBe(
			'Ticket HAUS-12 wurde gelöscht; dieser Eintrag war eine Quelle und ist wieder im Eingang.'
		);
		expect(deletedTicketNote(item({ state: 'discarded', sourceMeta: note }))).toBe(
			'Ticket HAUS-12 wurde gelöscht; dieser Eintrag war eine Quelle und wurde dabei verworfen.'
		);
		// The migration of old items does not know the key.
		expect(
			deletedTicketNote(item({ state: 'new', sourceMeta: { ticket_deleted: { key: '' } } }))
		).toBe('Das Ticket wurde gelöscht; dieser Eintrag war eine Quelle und ist wieder im Eingang.');
		expect(deletedTicketNote(item({ state: 'converted', sourceMeta: note }))).toBeNull();
		expect(deletedTicketNote(item({ state: 'new', sourceMeta: {} }))).toBeNull();
		expect(
			deletedTicketNote(item({ state: 'new', sourceMeta: { ticket_deleted: 'x' } }))
		).toBeNull();
	});
});
