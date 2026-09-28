// The SPA and the hook name the codes of sub-tickets with the same texts (ADR-0033).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { SUBTASK_MESSAGES } from '../../web/src/lib/domain/subtasks.ts';

const rules = loadHookLib('ticket-rules.js');

describe('texts of the sub-ticket codes (web/src/lib/domain/subtasks.ts)', () => {
	it('equal those of ticket-rules.js', () => {
		expect({ ...SUBTASK_MESSAGES }).toEqual({ ...rules.SUBTASK_MESSAGES });
	});
});
