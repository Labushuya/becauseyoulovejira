// URLs of the ticket views (E2 plan, T-4 and T-5; E3 plan, T-2).

import { describe, expect, it } from 'vitest';
import { EMPTY_LIST_QUERY } from './domain/list-query';
import {
	listHref,
	newTicketHref,
	showDoneFrom,
	ticketHref,
	withListQuery,
	withShowDone
} from './ticket-links';

const at = (path: string) => new URL(path, 'http://localhost:3000');

describe('ticket links', () => {
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
});
