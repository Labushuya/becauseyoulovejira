// Tickets as sources (QT-1, ADR-0067): the SPA names the codes of the routes with the same texts as
// the hook, words a refused circle with the same chain, suggests the same title of a follow-up, and
// sends a request of "Folge-Ticket anlegen …" the hook reads as the same choice.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	FOLLOW_UP_PREFIX,
	FOLLOW_UP_TITLE_MAX,
	HISTORY_FOLLOW_UP,
	HISTORY_SOURCE,
	TICKET_SOURCE_MESSAGES,
	cycleMessage,
	followUpRequestBody,
	followUpTitle,
	keyList
} from '../../web/src/lib/domain/ticket-origins.ts';

const rules = loadHookLib('ticket-source-rules.js');

describe('web/src/lib/domain/ticket-origins.ts and lib/ticket-source-rules.js', () => {
	it('name the codes with the same texts', () => {
		expect({ ...TICKET_SOURCE_MESSAGES }).toEqual({ ...rules.MESSAGES });
	});

	it('word a circle with the same chain', () => {
		const chains = [[], ['A-1'], ['A-1', 'A-2'], ['A-1', 'A-2', 'A-3'], ['A-1', 'A-2', 'A-3', 'A-4', 'A-5']];
		for (const chain of chains) {
			expect(cycleMessage(chain), chain.join(',')).toBe(rules.cycleMessage(chain));
			expect(keyList(chain)).toBe(rules.keyList(chain));
		}
	});

	it('suggest the same title of a follow-up and know the same fields of the history', () => {
		expect(FOLLOW_UP_PREFIX).toBe(rules.FOLLOW_UP_PREFIX);
		expect(FOLLOW_UP_TITLE_MAX).toBe(rules.TITLE_MAX);
		for (const title of ['Keller', '  Rasen  ', 'x'.repeat(193), 'y'.repeat(194), 'z'.repeat(400)]) {
			expect(followUpTitle(title)).toBe(rules.followUpTitle(title));
		}
		expect([HISTORY_SOURCE, HISTORY_FOLLOW_UP]).toEqual([rules.HISTORY_SOURCE, rules.HISTORY_FOLLOW_UP]);
	});

	it('send a request the hook reads as the same choice', () => {
		const take = { tags: true, charm: false, description: true };
		expect(rules.parseFollowUp(followUpRequestBody({ title: ' Folge: A ', take }))).toEqual({
			options: { title: 'Folge: A', ...take }
		});
	});
});
