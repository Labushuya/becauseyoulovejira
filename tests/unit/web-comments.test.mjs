// The SPA and the hook name the codes of the pinned comment with the same texts (ADR-0044).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { PIN_MESSAGES } from '../../web/src/lib/domain/comments.ts';

const rules = loadHookLib('ticket-rules.js');

describe('texts of the codes of the pinned comment (web/src/lib/domain/comments.ts)', () => {
	it('equal those of ticket-rules.js', () => {
		expect({ ...PIN_MESSAGES }).toEqual({ ...rules.PIN_MESSAGES });
	});
});
