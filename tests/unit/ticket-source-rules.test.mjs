// Pure rules of tickets as sources (QT-1, ADR-0067): the circle check as a pure function over a
// graph of links (self, direct, over several steps, diamonds without a circle, a circle among the
// links that already exist), the follow-ups reachable from a ticket, the text with the chain, the
// title and the request of "Folge-Ticket anlegen …".

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('ticket-source-rules.js');

/** `sourcesOf` and `followUpsOf` of links [ticket, source] ("ticket stems from source"). */
function graph(links) {
	const sourcesOf = (id) => links.filter(([ticket]) => ticket === id).map(([, source]) => source);
	const followUpsOf = (id) => links.filter(([, source]) => source === id).map(([ticket]) => ticket);
	return { sourcesOf, followUpsOf };
}

describe('cyclePath', () => {
	it('refuses a ticket as its own source', () => {
		expect(rules.cyclePath(graph([]).sourcesOf, 'A', 'A')).toEqual(['A']);
	});

	it('refuses the direct way back: B stems from A, so A cannot stem from B', () => {
		const { sourcesOf } = graph([['B', 'A']]);
		// New link: A stems from B. B stems from A already.
		expect(rules.cyclePath(sourcesOf, 'A', 'B')).toEqual(['B', 'A']);
	});

	it('refuses a circle over several steps and names the shortest chain', () => {
		// C stems from B, B stems from A; a new link "A stems from C" closes A → B → C → A.
		const { sourcesOf } = graph([
			['B', 'A'],
			['C', 'B']
		]);
		expect(rules.cyclePath(sourcesOf, 'A', 'C')).toEqual(['C', 'B', 'A']);
		// A longer and a shorter way back: the chain is the shortest.
		const both = graph([
			['B', 'A'],
			['C', 'B'],
			['D', 'C'],
			['D', 'A']
		]);
		expect(rules.cyclePath(both.sourcesOf, 'A', 'D')).toEqual(['D', 'A']);
	});

	it('allows a diamond without a circle (A → B, A → C, B → D, C → D)', () => {
		const { sourcesOf } = graph([
			['B', 'A'],
			['C', 'A'],
			['D', 'B']
		]);
		// The last link of the diamond: D stems from C as well.
		expect(rules.cyclePath(sourcesOf, 'D', 'C')).toBeNull();
		// More links in the same direction stay allowed, also a second way to the same ticket.
		const diamond = graph([
			['B', 'A'],
			['C', 'A'],
			['D', 'B'],
			['D', 'C']
		]);
		expect(rules.cyclePath(diamond.sourcesOf, 'E', 'D')).toBeNull();
		expect(rules.cyclePath(diamond.sourcesOf, 'D', 'A')).toBeNull();
		// But the way back from the bottom to the top is a circle.
		expect(rules.cyclePath(diamond.sourcesOf, 'A', 'D')).toEqual(['D', 'B', 'A']);
	});

	it('visits every ticket once, even when the links that exist form a circle already', () => {
		const { sourcesOf } = graph([
			['B', 'A'],
			['A', 'B'],
			['C', 'B']
		]);
		expect(rules.cyclePath(sourcesOf, 'X', 'C')).toBeNull();
		expect(rules.cyclePath(sourcesOf, 'A', 'C')).toEqual(['C', 'B', 'A']);
	});

	it('treats a ticket without sources as an end', () => {
		expect(rules.cyclePath(() => undefined, 'A', 'B')).toBeNull();
	});
});

describe('reachable', () => {
	it('lists every follow-up over any number of steps, once each, without the start', () => {
		const { followUpsOf } = graph([
			['B', 'A'],
			['C', 'A'],
			['D', 'B'],
			['D', 'C'],
			['E', 'D'],
			['X', 'Y']
		]);
		expect(rules.reachable(followUpsOf, 'A')).toEqual(['B', 'C', 'D', 'E']);
		expect(rules.reachable(followUpsOf, 'D')).toEqual(['E']);
		expect(rules.reachable(followUpsOf, 'E')).toEqual([]);
	});

	it('is exactly the set of tickets that would close a circle as a source', () => {
		const links = [
			['B', 'A'],
			['C', 'B'],
			['D', 'A'],
			['F', 'E']
		];
		const { sourcesOf, followUpsOf } = graph(links);
		const all = ['A', 'B', 'C', 'D', 'E', 'F'];
		for (const ticket of all) {
			const blocked = new Set(rules.reachable(followUpsOf, ticket));
			for (const source of all) {
				if (source === ticket) continue;
				expect(rules.cyclePath(sourcesOf, ticket, source) !== null, `${ticket} ← ${source}`).toBe(
					blocked.has(source)
				);
			}
		}
	});
});

describe('texts', () => {
	it('names the chain of a circle with its keys', () => {
		expect(rules.cycleMessage(['HAUS-20', 'HAUS-3'])).toBe('HAUS-20 stammt bereits von HAUS-3 ab.');
		expect(rules.cycleMessage(['HAUS-20', 'HAUS-12', 'HAUS-3'])).toBe(
			'HAUS-20 stammt bereits (über HAUS-12) von HAUS-3 ab.'
		);
		expect(rules.cycleMessage(['HAUS-20', 'HAUS-12', 'HAUS-7', 'HAUS-3'])).toBe(
			'HAUS-20 stammt bereits (über HAUS-12 und HAUS-7) von HAUS-3 ab.'
		);
		expect(rules.cycleMessage(['A-1', 'A-2', 'A-3', 'A-4', 'A-5'])).toBe(
			'A-1 stammt bereits (über A-2, A-3 und A-4) von A-5 ab.'
		);
		expect(rules.cycleMessage(['HAUS-3'])).toBe(rules.MESSAGES.validation_ticket_source_self);
		expect(rules.cycleMessage([])).toBe(rules.MESSAGES.validation_ticket_source_self);
	});

	it('keeps the other ticket of a link in the history as ID and key', () => {
		expect(JSON.parse(rules.historyValue('abc', 'HAUS-3'))).toEqual({ ticket: 'abc', key: 'HAUS-3' });
		expect(JSON.parse(rules.historyValue(null, undefined))).toEqual({ ticket: '', key: '' });
	});
});

describe('requests', () => {
	it('takes one ticket ID as the source', () => {
		expect(rules.parseAdd({ source: 'abcdefghijklmno' })).toEqual({ source: 'abcdefghijklmno' });
		for (const body of [null, {}, { source: '' }, { source: 'ABC' }, { source: 12 }, 'x']) {
			expect(rules.parseAdd(body), JSON.stringify(body)).toEqual({ code: 'validation_ticket_source_format' });
		}
	});

	it('suggests "Folge: ‹Titel›" within 200 characters', () => {
		expect(rules.followUpTitle('  Keller aufräumen ')).toBe('Folge: Keller aufräumen');
		const long = rules.followUpTitle('x'.repeat(300));
		expect(long).toHaveLength(rules.TITLE_MAX);
		expect(long.startsWith('Folge: ')).toBe(true);
		expect(long.endsWith('…')).toBe(true);
		expect(rules.followUpTitle('y'.repeat(193))).toBe(`Folge: ${'y'.repeat(193)}`);
	});

	it('reads the follow-up with its title and what it takes over', () => {
		expect(rules.parseFollowUp({ title: ' Folge: A ', tags: true, charm: 'true', description: false })).toEqual({
			options: { title: 'Folge: A', tags: true, charm: true, description: false }
		});
		expect(rules.parseFollowUp({ title: 'A' })).toEqual({
			options: { title: 'A', tags: false, charm: false, description: false }
		});
		for (const title of ['', '   ', 'z'.repeat(201), undefined]) {
			expect(rules.parseFollowUp({ title }), String(title)).toEqual({
				field: 'title',
				code: 'validation_follow_up_title'
			});
		}
	});

	it('gives the follow-up the project of its source while that is active', () => {
		expect(rules.followUpProject('p1', false)).toBe('p1');
		expect(rules.followUpProject('p1', true)).toBe('');
		expect(rules.followUpProject('', false)).toBe('');
	});
});
