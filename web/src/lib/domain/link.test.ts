// Addresses of links in the editor (plan editor RT-4): only http, https and mailto, and since AL-2
// links to a ticket of the app as `/tickets/<id>` (ADR-0042 section 5).

import { describe, expect, it } from 'vitest';
import {
	LINK_EMPTY,
	LINK_INVALID,
	LINK_NOT_ALLOWED,
	TICKET_LINK,
	checkLink,
	ticketLinkHref
} from './link';

describe('checkLink', () => {
	it.each([
		['https://example.com/a?b=1#c', 'https://example.com/a?b=1#c'],
		['  http://example.com  ', 'http://example.com'],
		['HTTPS://EXAMPLE.COM', 'HTTPS://EXAMPLE.COM'],
		['mailto:anna@example.com', 'mailto:anna@example.com'],
		['www.example.com', 'https://www.example.com'],
		['example.com/pfad?x=1', 'https://example.com/pfad?x=1'],
		['anna@example.com', 'mailto:anna@example.com'],
		['/tickets/abc123def456ghi', '/tickets/abc123def456ghi']
	])('takes %s as %s', (input, href) => {
		expect(checkLink(input)).toEqual({ href });
	});

	it.each([
		['', LINK_EMPTY],
		['   ', LINK_EMPTY],
		['javascript:alert(1)', LINK_NOT_ALLOWED],
		['data:text/html,x', LINK_NOT_ALLOWED],
		['ftp://example.com', LINK_NOT_ALLOWED],
		['file:///C:/x', LINK_NOT_ALLOWED],
		['https://', LINK_INVALID],
		['mailto:', LINK_INVALID],
		['https://exa mple.com', LINK_INVALID],
		['nur Text', LINK_INVALID],
		['wort', LINK_INVALID],
		['/tickets/abc', LINK_INVALID],
		['/tickets/abc123def456ghi/voll', LINK_INVALID],
		['/einstellungen', LINK_INVALID],
		['//example.com/tickets/abc123def456ghi', LINK_INVALID]
	])('refuses "%s"', (input, error) => {
		expect(checkLink(input)).toEqual({ error });
	});
});

describe('links to tickets', () => {
	it('points at the panel of the ticket by its record ID', () => {
		expect(ticketLinkHref('abc123def456ghi')).toBe('/tickets/abc123def456ghi');
		expect(TICKET_LINK.test(ticketLinkHref('abc123def456ghi'))).toBe(true);
		expect(TICKET_LINK.test('/tickets/ABC123DEF456GHI')).toBe(false);
		expect(TICKET_LINK.test('/tickets/abc123def456ghi?x=1')).toBe(false);
	});
});
