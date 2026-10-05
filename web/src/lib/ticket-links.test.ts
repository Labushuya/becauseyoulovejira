// URLs of the ticket views (E2 plan, T-4 and T-5; E3 plan, T-2).

import { describe, expect, it } from 'vitest';
import { EMPTY_LIST_QUERY } from './domain/list-query';
import {
	FULL_VIEW_LINK,
	appHref,
	calendarFullViewHref,
	calendarHref,
	calendarTicketHref,
	captureHref,
	channelSetupHref,
	convertFrom,
	convertHref,
	doneFullViewHref,
	doneHref,
	doneOfListHref,
	doneTicketHref,
	doneViewHref,
	fullViewHref,
	inboxHref,
	inboxItemHref,
	legacyDoneHref,
	listHref,
	newProjectHref,
	newSubProjectHref,
	newTicketHref,
	parentFrom,
	projectHref,
	projectsHref,
	projectsViewHref,
	projectTicketsHref,
	showArchivedFrom,
	ticketHref,
	ticketPath,
	withCalendarQuery,
	withDoneQuery,
	withInboxQuery,
	withListQuery,
	withShowArchived,
	withTemplate,
	withoutConvert
} from './ticket-links';

const at = (path: string) => new URL(path, 'http://localhost:3000');

const PROJECT = 'proj00000000001';
const TAG = 'tag000000000001';

describe('ticket links', () => {
	it('keeps path, query and hash of a held-up navigation target (ADR-0025 section 4)', () => {
		expect(appHref(at('/tickets/abc123def456ghi?status=open#kommentare'))).toBe(
			'/tickets/abc123def456ghi?status=open#kommentare'
		);
		expect(appHref(at('/'))).toBe('/');
	});

	it('addresses tickets by record ID and keeps the current query', () => {
		expect(ticketHref('abc123def456ghi', at('/?gruppe=prio'))).toBe(
			'/tickets/abc123def456ghi?gruppe=prio'
		);
		expect(ticketHref('abc123def456ghi', at('/tickets/other'))).toBe('/tickets/abc123def456ghi');
	});

	it('addresses the full view of a ticket with the current query (ADR-0025 section 7)', () => {
		expect(fullViewHref('abc123def456ghi', at('/tickets/abc123def456ghi?gruppe=prio'))).toBe(
			'/tickets/abc123def456ghi/voll?gruppe=prio'
		);
		expect(fullViewHref('abc123def456ghi', at('/'))).toBe('/tickets/abc123def456ghi/voll');
		expect(FULL_VIEW_LINK).toBe('[data-full-view-link]');
	});

	it('opens the form "Neues Ticket" with the current query', () => {
		expect(newTicketHref(at('/?gruppe=prio'))).toBe('/tickets/neu?gruppe=prio');
		expect(newTicketHref(at('/tickets/abc'))).toBe('/tickets/neu');
	});

	it('leads back to the list with the current query', () => {
		expect(listHref(at('/tickets/abc?gruppe=prio'))).toBe('/?gruppe=prio');
		expect(listHref(at('/tickets/abc'))).toBe('/');
	});

	it('keeps filters, sort and grouping in every link', () => {
		const url = at('/?status=open&sort=-prio&gruppe=projekt');
		expect(ticketHref('abc123def456ghi', url)).toBe(
			'/tickets/abc123def456ghi?status=open&sort=-prio&gruppe=projekt'
		);
		expect(listHref(at('/tickets/abc?faellig=heute&q=Auto'))).toBe('/?faellig=heute&q=Auto');
	});

	it('writes the list state in the fixed order and drops invalid list parameters', () => {
		expect(
			withListQuery(at('/?status=foo&prio=high#x'), {
				...EMPTY_LIST_QUERY,
				priority: 'high'
			})
		).toBe('/?prio=high#x');
		expect(
			withListQuery(at('/tickets/abc?x=1&status=open'), {
				...EMPTY_LIST_QUERY,
				priority: 'low',
				grouping: 'due'
			})
		).toBe('/tickets/abc?x=1&prio=low&gruppe=faellig');
		expect(withListQuery(at('/?status=open'), EMPTY_LIST_QUERY)).toBe('/');
	});

	it('opens the tickets of a project with only the project filter set (package 14)', () => {
		expect(projectTicketsHref('proj00000000001')).toBe('/?projekt=proj00000000001');
		expect(projectsHref()).toBe('/projekte');
	});

	it('reads, sets and removes the switch "Archivierte anzeigen" and keeps other parameters', () => {
		expect(showArchivedFrom(at('/projekte?archiviert=1'))).toBe(true);
		expect(showArchivedFrom(at('/projekte'))).toBe(false);
		expect(showArchivedFrom(at('/projekte?archiviert=0'))).toBe(false);
		expect(showArchivedFrom(at('/projekte?archiviert=1&archiviert=1'))).toBe(false);
		expect(withShowArchived(at('/projekte?x=1'), true)).toBe('/projekte?x=1&archiviert=1');
		expect(withShowArchived(at('/projekte?archiviert=1&x=1'), false)).toBe('/projekte?x=1');
		expect(withShowArchived(at('/projekte?archiviert=1'), false)).toBe('/projekte');
	});

	it('addresses the project panel and keeps only the switch "Archivierte anzeigen" (UI-8)', () => {
		expect(projectHref('proj00000000001', at('/projekte'))).toBe('/projekte/proj00000000001');
		expect(projectHref('proj00000000001', at('/projekte/neu?archiviert=1&x=1'))).toBe(
			'/projekte/proj00000000001?archiviert=1'
		);
		expect(newProjectHref(at('/projekte?archiviert=1'))).toBe('/projekte/neu?archiviert=1');
		expect(newProjectHref(at('/projekte?archiviert=0'))).toBe('/projekte/neu');
		expect(projectsViewHref(at('/projekte/proj00000000001?archiviert=1'))).toBe(
			'/projekte?archiviert=1'
		);
		expect(projectsViewHref(at('/projekte/neu'))).toBe('/projekte');
	});

	it('opens "Neues Projekt" with the parent for "Unterprojekt anlegen" (ADR-0034)', () => {
		expect(newSubProjectHref('proj00000000001', at('/projekte/proj00000000001?archiviert=1'))).toBe(
			'/projekte/neu?archiviert=1&oberprojekt=proj00000000001'
		);
		expect(newSubProjectHref('proj00000000001', at('/projekte'))).toBe(
			'/projekte/neu?oberprojekt=proj00000000001'
		);
		expect(parentFrom(at('/projekte/neu?oberprojekt=proj00000000001'))).toBe('proj00000000001');
		expect(parentFrom(at('/projekte/neu'))).toBeNull();
		expect(parentFrom(at('/projekte/neu?oberprojekt=kurz'))).toBeNull();
		expect(
			parentFrom(at('/projekte/neu?oberprojekt=proj00000000001&oberprojekt=proj00000000002'))
		).toBeNull();
		// The panel of the new project keeps only the state of the view.
		expect(projectsViewHref(at('/projekte/neu?oberprojekt=proj00000000001&q=au'))).toBe(
			'/projekte?q=au'
		);
	});
});

describe('links of the view "Erledigte" (ER-1, ADR-0066)', () => {
	it('addresses the view, a ticket next to it and its full view with the filters', () => {
		expect(doneHref()).toBe('/erledigt');
		const url = at(`/erledigt?projekt=${PROJECT}&q=Miete&charm=geburtstag&prio=high`);
		expect(doneViewHref(url)).toBe(`/erledigt?projekt=${PROJECT}&q=Miete&charm=geburtstag`);
		expect(doneTicketHref('abc123def456ghi', url)).toBe(
			`/erledigt/tickets/abc123def456ghi?projekt=${PROJECT}&q=Miete&charm=geburtstag`
		);
		expect(doneFullViewHref('abc123def456ghi', at('/erledigt?tag=' + TAG))).toBe(
			`/erledigt/tickets/abc123def456ghi/voll?tag=${TAG}`
		);
		expect(
			withDoneQuery(at('/erledigt/tickets/abc123def456ghi?q=alt'), {
				search: null,
				project: PROJECT,
				subProjects: false,
				tag: null,
				charm: null
			})
		).toBe(`/erledigt/tickets/abc123def456ghi?projekt=${PROJECT}&unterprojekte=0`);
	});

	it('links "Aufgaben" to "Erledigte" with the filters both views know', () => {
		expect(doneOfListHref(at('/'))).toBe('/erledigt');
		expect(
			doneOfListHref(
				at(
					`/tickets/abc?karte=dringend&status=open&prio=high&projekt=${PROJECT}&unterprojekte=0&tag=${TAG}&q=Auto&sort=titel&gruppe=prio`
				)
			)
		).toBe(`/erledigt?projekt=${PROJECT}&unterprojekte=0&tag=${TAG}&q=Auto`);
	});

	it('leads old addresses of "Aufgaben" that asked for done tickets to "Erledigte"', () => {
		// The switch "Erledigte anzeigen" without a status, and the status filter "Erledigt".
		expect(legacyDoneHref(at(`/?erledigte=1&projekt=${PROJECT}&prio=high&sort=titel`))).toBe(
			`/erledigt?projekt=${PROJECT}`
		);
		expect(legacyDoneHref(at(`/?status=done&tag=${TAG}&q=Miete`))).toBe(
			`/erledigt?tag=${TAG}&q=Miete`
		);
		// A ticket and its full view stay open next to "Erledigte".
		expect(legacyDoneHref(at('/tickets/abc123def456ghi?erledigte=1&q=Auto'))).toBe(
			'/erledigt/tickets/abc123def456ghi?q=Auto'
		);
		expect(legacyDoneHref(at('/tickets/abc123def456ghi/voll?status=done'))).toBe(
			'/erledigt/tickets/abc123def456ghi/voll'
		);
	});

	it('only drops the old parameters where they asked for nothing done', () => {
		// The switch next to another status hid the done tickets anyway.
		expect(legacyDoneHref(at('/?status=open&erledigte=1&gruppe=prio'))).toBe(
			'/?status=open&gruppe=prio'
		);
		expect(legacyDoneHref(at('/?erledigte=0'))).toBe('/');
		// "Neues Ticket" stays over "Aufgaben".
		expect(legacyDoneHref(at('/tickets/neu?erledigte=1&aus=item00000000001'))).toBe(
			'/tickets/neu?aus=item00000000001'
		);
		expect(legacyDoneHref(at('/tickets/neu?status=done'))).toBe('/tickets/neu');
		// Every other address stays as it is.
		expect(legacyDoneHref(at('/?status=open&gruppe=prio'))).toBeNull();
		expect(legacyDoneHref(at('/tickets/abc123def456ghi'))).toBeNull();
	});
});

describe('inbox links (E4 plan, package 3)', () => {
	it('keeps only the chips of the inbox', () => {
		expect(inboxHref()).toBe('/eingang');
		expect(inboxHref(at('/eingang/abc?zustand=verworfen&quelle=mail&status=open'))).toBe(
			'/eingang?quelle=mail&zustand=verworfen'
		);
		expect(inboxItemHref('item00000000001', at('/eingang?quelle=chat'))).toBe(
			'/eingang/item00000000001?quelle=chat'
		);
		expect(inboxItemHref('item00000000001')).toBe('/eingang/item00000000001');
		expect(withInboxQuery(at('/eingang/x?y=1#a'), { source: 'link', state: 'converted' })).toBe(
			'/eingang/x?y=1&quelle=link&zustand=verknuepft#a'
		);
	});

	it('opens "Neues Ticket" for an entry and reads it back only as record ID', () => {
		expect(convertHref('item00000000001')).toBe('/tickets/neu?aus=item00000000001');
		expect(convertFrom(at('/tickets/neu?aus=item00000000001'))).toBe('item00000000001');
		expect(convertFrom(at('/tickets/neu?aus=../x'))).toBeNull();
		expect(convertFrom(at('/tickets/neu?aus=a&aus=b'))).toBeNull();
		expect(convertFrom(at('/tickets/neu'))).toBeNull();
		expect(withoutConvert(at('/tickets/neu?gruppe=prio&aus=item00000000001')).search).toBe(
			'?gruppe=prio'
		);
		expect(ticketPath('tick00000000001')).toBe('/tickets/tick00000000001');
	});
});

describe('capture links (E4 plan, package 5)', () => {
	it('opens the capture with the chips of the inbox and keeps the template in the URL', () => {
		expect(captureHref()).toBe('/eingang/neu');
		expect(captureHref(at('/eingang?quelle=mail&status=open'))).toBe('/eingang/neu?quelle=mail');
		expect(withTemplate(at('/eingang/neu?quelle=mail'), 'call')).toBe(
			'/eingang/neu?quelle=mail&vorlage=anruf'
		);
		expect(withTemplate(at('/eingang/neu?vorlage=anruf#x'), 'event')).toBe(
			'/eingang/neu?vorlage=termin#x'
		);
	});
});

describe('setup links (plan EH-5)', () => {
	it('opens the assistant of a kind, with the connection once it exists', () => {
		expect(channelSetupHref({ kind: 'kalender', connectionId: null })).toBe(
			'/einstellungen/kanaele?einrichten=kalender'
		);
		expect(channelSetupHref({ kind: 'kalender', connectionId: 'conn00000000001' })).toBe(
			'/einstellungen/kanaele?einrichten=kalender&verbindung=conn00000000001'
		);
		expect(channelSetupHref(null)).toBe('/einstellungen/kanaele');
	});
});

describe('calendar links (ADR-0053)', () => {
	it('keeps view, day and filters into the panel and back, and sets view and day alone', () => {
		const calendar = at('/kalender?prio=high&ansicht=woche&datum=2026-10-05');
		expect(calendarHref()).toBe('/kalender');
		expect(calendarHref(calendar)).toBe('/kalender?prio=high&ansicht=woche&datum=2026-10-05');
		expect(calendarTicketHref('abc123def456ghi', calendar)).toBe(
			'/kalender/tickets/abc123def456ghi?prio=high&ansicht=woche&datum=2026-10-05'
		);
		expect(calendarFullViewHref('abc123def456ghi', calendar)).toBe(
			'/kalender/tickets/abc123def456ghi/voll?prio=high&ansicht=woche&datum=2026-10-05'
		);
		expect(withCalendarQuery(calendar, { view: 'agenda', date: null })).toBe(
			'/kalender?prio=high&ansicht=agenda'
		);
	});
});
