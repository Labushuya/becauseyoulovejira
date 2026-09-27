// URLs of the ticket views (E2 plan, T-4 and T-5; E3 plan, T-2).

import { describe, expect, it } from 'vitest';
import { EMPTY_LIST_QUERY } from './domain/list-query';
import {
	FULL_VIEW_LINK,
	appHref,
	captureHref,
	channelSetupHref,
	convertFrom,
	convertHref,
	fullViewHref,
	inboxHref,
	inboxItemHref,
	listHref,
	newProjectHref,
	newTicketHref,
	projectHref,
	projectsHref,
	projectsViewHref,
	projectTicketsHref,
	showArchivedFrom,
	showDoneFrom,
	ticketHref,
	ticketPath,
	withInboxQuery,
	withListQuery,
	withShowArchived,
	withShowDone,
	withTemplate,
	withoutConvert
} from './ticket-links';

const at = (path: string) => new URL(path, 'http://localhost:3000');

describe('ticket links', () => {
	it('keeps path, query and hash of a held-up navigation target (ADR-0025 section 4)', () => {
		expect(appHref(at('/tickets/abc123def456ghi?status=open#kommentare'))).toBe(
			'/tickets/abc123def456ghi?status=open#kommentare'
		);
		expect(appHref(at('/'))).toBe('/');
	});

	it('reads the switch "Erledigte anzeigen" from the query', () => {
		expect(showDoneFrom(at('/?erledigte=1'))).toBe(true);
		expect(showDoneFrom(at('/'))).toBe(false);
		expect(showDoneFrom(at('/?erledigte=0'))).toBe(false);
	});

	it('addresses tickets by record ID and keeps the current query', () => {
		expect(ticketHref('abc123def456ghi', at('/?erledigte=1'))).toBe(
			'/tickets/abc123def456ghi?erledigte=1'
		);
		expect(ticketHref('abc123def456ghi', at('/tickets/other'))).toBe('/tickets/abc123def456ghi');
	});

	it('addresses the full view of a ticket with the current query (ADR-0025 section 7)', () => {
		expect(fullViewHref('abc123def456ghi', at('/tickets/abc123def456ghi?erledigte=1'))).toBe(
			'/tickets/abc123def456ghi/voll?erledigte=1'
		);
		expect(fullViewHref('abc123def456ghi', at('/'))).toBe('/tickets/abc123def456ghi/voll');
		expect(FULL_VIEW_LINK).toBe('[data-full-view-link]');
	});

	it('opens the form "Neues Ticket" with the current query', () => {
		expect(newTicketHref(at('/?erledigte=1'))).toBe('/tickets/neu?erledigte=1');
		expect(newTicketHref(at('/tickets/abc'))).toBe('/tickets/neu');
	});

	it('leads back to the list with the current query', () => {
		expect(listHref(at('/tickets/abc?erledigte=1'))).toBe('/?erledigte=1');
		expect(listHref(at('/tickets/abc'))).toBe('/');
	});

	it('sets and removes the switch and keeps other parameters', () => {
		expect(withShowDone(at('/'), true)).toBe('/?erledigte=1');
		expect(withShowDone(at('/?erledigte=1'), false)).toBe('/');
		expect(withShowDone(at('/tickets/abc?x=2'), true)).toBe('/tickets/abc?x=2&erledigte=1');
		expect(withShowDone(at('/tickets/abc?erledigte=1&x=2'), false)).toBe('/tickets/abc?x=2');
	});

	it('keeps filters, sort and grouping in every link', () => {
		const url = at('/?status=open&sort=-prio&gruppe=projekt&erledigte=1');
		expect(ticketHref('abc123def456ghi', url)).toBe(
			'/tickets/abc123def456ghi?status=open&sort=-prio&gruppe=projekt&erledigte=1'
		);
		expect(listHref(at('/tickets/abc?faellig=heute&q=Auto'))).toBe('/?faellig=heute&q=Auto');
		expect(withShowDone(url, false)).toBe('/?status=open&sort=-prio&gruppe=projekt');
	});

	it('writes the list state in the fixed order and drops invalid list parameters', () => {
		expect(withShowDone(at('/?erledigte=1&status=foo&prio=high#x'), true)).toBe(
			'/?prio=high&erledigte=1#x'
		);
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
		expect(withoutConvert(at('/tickets/neu?erledigte=1&aus=item00000000001')).search).toBe(
			'?erledigte=1'
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
