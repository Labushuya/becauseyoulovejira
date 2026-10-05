// Pure decisions of the pinned tickets (PIN-1, ADR-0064): completing releases every pin, a done
// ticket is never pinned, who still sees a ticket after a move or a change of membership; the SPA
// names the refusal with the same text as the hook.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { TICKET_PIN_MESSAGES } from '../../web/src/lib/domain/pins.ts';

const rules = loadHookLib('pin-rules.js');

describe('lib/pin-rules.js', () => {
	it('releases the pins only when a ticket becomes done, never when it is reopened', () => {
		for (const before of ['backlog', 'open', 'in_progress', 'waiting']) {
			expect(rules.releasesPins(before, 'done'), before).toBe(true);
			expect(rules.releasesPins(before, 'open'), before).toBe(false);
		}
		expect(rules.releasesPins('done', 'done')).toBe(false);
		expect(rules.releasesPins('done', 'open')).toBe(false);
	});

	it('refuses a pin on a done ticket only', () => {
		expect(rules.pinViolation('done')).toBe('validation_pin_done');
		for (const status of ['backlog', 'open', 'in_progress', 'waiting']) {
			expect(rules.pinViolation(status), status).toBe('');
		}
		expect(rules.MESSAGES.validation_pin_done).toBe('Erledigte Tickets lassen sich nicht anheften.');
	});

	it('lets the owner see a private ticket and the members see a household ticket', () => {
		expect(rules.seesTicket('a', 'a', '', [])).toBe(true);
		expect(rules.seesTicket('b', 'a', '', ['a', 'b'])).toBe(false);
		expect(rules.seesTicket('', '', '', [])).toBe(false);
		expect(rules.seesTicket('b', 'a', 'h1', ['a', 'b'])).toBe(true);
		// The owner who left the household no longer sees its tickets (ADR-0058 §5).
		expect(rules.seesTicket('a', 'a', 'h1', ['b'])).toBe(false);
		expect(rules.seesTicket('c', 'a', 'h1', ['a', 'b'])).toBe(false);
	});

	it('words the refusal like the SPA (web/src/lib/domain/pins.ts)', () => {
		expect({ ...TICKET_PIN_MESSAGES }).toEqual({ ...rules.MESSAGES });
	});
});
