// URLs of the ticket views (E2 plan, T-4 and T-5).

import { describe, expect, it } from 'vitest';
import { listHref, showDoneFrom, ticketHref, withShowDone } from './ticket-links';

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
});
