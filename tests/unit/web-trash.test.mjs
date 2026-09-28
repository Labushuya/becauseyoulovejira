// The trash speaks with one voice (ADR-0037): the texts of the validation codes and the values of
// the retention are the same in the hook (app/pb_hooks/lib/trash-rules.js) and in the SPA
// (web/src/lib/domain/trash.ts), and the data layer reads every code the hook sends.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { TRASH_CODES, TRASH_MESSAGES, TRASH_RETENTIONS, parseRetention } from '../../web/src/lib/domain/trash.ts';

const rules = loadHookLib('trash-rules.js');

describe('trash in hook and SPA', () => {
	it('has the same texts for every code', () => {
		expect(TRASH_MESSAGES).toEqual(rules.MESSAGES);
		for (const code of Object.values(TRASH_CODES)) {
			expect(rules.MESSAGES[code], code).toBeDefined();
		}
	});

	it('knows the same retention values with the same default', () => {
		expect([...TRASH_RETENTIONS]).toEqual(rules.RETENTION_VALUES);
		for (const value of ['', 'x', null]) {
			expect(rules.retentionDays(value)).toBe(Number(parseRetention(value)));
		}
		for (const value of TRASH_RETENTIONS) {
			const days = rules.retentionDays(value);
			expect(days === null ? 'never' : String(days)).toBe(value);
		}
	});
});
