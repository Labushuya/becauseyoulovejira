// Pure rules of the inbox hook (ADR-0014 section 1): cleaning, links, state changes.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('inbox-rules.js');

describe('normalizeTitle and truncate', () => {
	it('collapses whitespace and line breaks', () => {
		expect(rules.normalizeTitle('  Re:\r\n  Termin\tmorgen  ')).toBe('Re: Termin morgen');
	});

	it('cuts long titles to 200 characters ending in "…"', () => {
		const title = rules.normalizeTitle('x'.repeat(250));
		expect(title).toHaveLength(200);
		expect(title.endsWith('…')).toBe(true);
		expect(rules.normalizeTitle('y'.repeat(200))).toBe('y'.repeat(200));
	});

	it('never splits a surrogate pair', () => {
		const value = `${'a'.repeat(198)}\u{1F600}b`;
		const cut = rules.truncate(value, 200);
		expect(cut).toBe(`${'a'.repeat(198)}…`);
		expect([...cut].length).toBeLessThanOrEqual(200);
	});

	it('cuts the body to 100 000 characters', () => {
		expect(rules.normalizeBody('z'.repeat(100_001))).toHaveLength(100_000);
		expect(rules.normalizeBody('kurz')).toBe('kurz');
	});
});

describe('isAllowedSourceUrl', () => {
	it('accepts empty, http and https', () => {
		for (const url of ['', 'http://example.com', 'HTTPS://example.com/a?b#c']) {
			expect(rules.isAllowedSourceUrl(url), url).toBe(true);
		}
	});

	it('rejects other schemes and broken values', () => {
		for (const url of [
			'javascript:alert(1)',
			'data:text/html,x',
			'mailto:a@b',
			'ftp://x',
			'https://',
			'https://a b'
		]) {
			expect(rules.isAllowedSourceUrl(url), url).toBe(false);
		}
	});
});

describe('transitionViolation', () => {
	const at = (state, ticket = '') => ({ state, ticket });

	it('allows new <-> discarded without a ticket', () => {
		expect(rules.transitionViolation(at('new'), at('discarded'))).toBe('');
		expect(rules.transitionViolation(at('discarded'), at('new'))).toBe('');
		expect(rules.transitionViolation(at('new'), at('new'))).toBe('');
	});

	it('allows new -> converted only together with a ticket', () => {
		expect(rules.transitionViolation(at('new'), at('converted', 't1'))).toBe('');
		expect(rules.transitionViolation(at('new'), at('converted'))).toEqual({
			field: 'ticket',
			code: 'validation_inbox_ticket_required'
		});
		expect(rules.transitionViolation(at('discarded'), at('converted', 't1'))).toEqual({
			field: 'state',
			code: 'validation_inbox_transition'
		});
	});

	it('keeps converted items on a ticket, except for releasing and moving them (ADR-0031)', () => {
		const handled = { field: 'state', code: 'validation_inbox_item_handled' };
		expect(rules.transitionViolation(at('converted', 't1'), at('new', 't1'))).toEqual(handled);
		expect(rules.transitionViolation(at('converted', 't1'), at('discarded', 't1'))).toEqual(handled);
		expect(rules.transitionViolation(at('converted', 't1'), at('discarded', ''))).toEqual(handled);
		// Releasing: back to new with an empty ticket (the main source is checked by the service).
		expect(rules.transitionViolation(at('converted', 't1'), at('new', ''))).toBe('');
		expect(rules.transitionViolation(at('converted', ''), at('new', ''))).toBe('');
		// Moving to another ticket (addendum; main source and scope are checked by the service).
		expect(rules.transitionViolation(at('converted', 't1'), at('converted', 't2'))).toBe('');
		expect(rules.transitionViolation(at('converted', ''), at('converted', 't2'))).toBe('');
		expect(rules.transitionViolation(at('converted', 't1'), at('converted', ''))).toEqual(handled);
		expect(rules.transitionViolation(at('converted', 't1'), at('converted', 't1'))).toBe('');
		// A converted item whose ticket was deleted keeps its empty ticket.
		expect(rules.transitionViolation(at('converted', ''), at('converted', ''))).toBe('');
	});

	it('sets no ticket without converting', () => {
		const transition = { field: 'ticket', code: 'validation_inbox_transition' };
		expect(rules.transitionViolation(at('new'), at('new', 't1'))).toEqual(transition);
		expect(rules.transitionViolation(at('new'), at('discarded', 't1'))).toEqual(transition);
	});
});

describe('linkChange and sourceLinkValue (ADR-0031 section 2)', () => {
	const at = (state, ticket = '') => ({ state, ticket });

	it('names linking, releasing and moving, nothing else', () => {
		expect(rules.linkChange(at('new'), at('converted', 't1'))).toBe('link');
		expect(rules.linkChange(at('converted', 't1'), at('new'))).toBe('release');
		expect(rules.linkChange(at('converted', 't1'), at('converted', 't2'))).toBe('move');
		// A converted item whose ticket was deleted gets a ticket again: that is linking.
		expect(rules.linkChange(at('converted'), at('converted', 't2'))).toBe('link');
		for (const [from, to] of [
			[at('new'), at('new')],
			[at('new'), at('discarded')],
			[at('discarded'), at('new')],
			[at('converted', 't1'), at('converted', 't1')],
			[at('converted', 't1'), at('converted')],
			[at('discarded'), at('converted', 't1')],
			[at(''), at('')]
		]) {
			expect(rules.linkChange(from, to), `${JSON.stringify(from)} -> ${JSON.stringify(to)}`).toBe('');
		}
	});

	it('keeps id, channel and title of the item as JSON', () => {
		const value = rules.sourceLinkValue({ id: 'abc', channel: 'mail', title: 'Rechnung „März“ | 2' });
		expect(JSON.parse(value)).toEqual({ item: 'abc', channel: 'mail', title: 'Rechnung „März“ | 2' });
		expect(JSON.parse(rules.sourceLinkValue({}))).toEqual({ item: '', channel: '', title: '' });
	});

	it('names the other ticket of a move', () => {
		const item = { id: 'abc', channel: 'mail', title: 'Rechnung' };
		expect(JSON.parse(rules.sourceLinkValue(item, { direction: 'to', ticket: 't2', key: 'HAUS-13' }))).toEqual({
			item: 'abc',
			channel: 'mail',
			title: 'Rechnung',
			moved_to: { ticket: 't2', key: 'HAUS-13' }
		});
		expect(JSON.parse(rules.sourceLinkValue(item, { direction: 'from', ticket: 't1' }))).toEqual({
			item: 'abc',
			channel: 'mail',
			title: 'Rechnung',
			moved_from: { ticket: 't1', key: '' }
		});
		expect(JSON.parse(rules.sourceLinkValue(item, { direction: 'sideways' }))).toEqual({
			item: 'abc',
			channel: 'mail',
			title: 'Rechnung'
		});
	});
});

describe('handledAtAction and duplicateMessage', () => {
	it('follows the state', () => {
		expect(rules.handledAtAction('new', 'converted')).toBe('set');
		expect(rules.handledAtAction('new', 'discarded')).toBe('set');
		expect(rules.handledAtAction('discarded', 'new')).toBe('clear');
		expect(rules.handledAtAction('converted', 'converted')).toBe('keep');
		expect(rules.handledAtAction('new', 'new')).toBe('keep');
	});

	it('names the state of the existing entry', () => {
		expect(rules.duplicateMessage('new', '')).toBe('Schon im Eingang.');
		expect(rules.duplicateMessage('discarded', '')).toBe('Schon verworfen.');
		expect(rules.duplicateMessage('converted', 'HAUS-12')).toBe('Schon Ticket HAUS-12.');
		expect(rules.duplicateMessage('converted', '')).toBe('Schon umgewandelt.');
	});
});
