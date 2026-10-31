// Parity of the access data set from the browser (BW-3, ADR-0075): the SPA checks a value before
// it is sent exactly as the server does (app/pb_hooks/lib/credential-rules.js) and shows the same
// words for every problem of a request, so the field and the route never disagree.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	CREDENTIAL_MESSAGES,
	CREDENTIAL_PROBLEMS,
	CREDENTIAL_VALUE_MAX,
	credentialValueProblem
} from '../../web/src/lib/domain/credentials.ts';

const rules = loadHookLib('credential-rules.js');

describe('web/src/lib/domain/credentials.ts mirrors app/pb_hooks/lib/credential-rules.js', () => {
	it('names the same problems with the same words and the same limit', () => {
		expect([...CREDENTIAL_PROBLEMS]).toEqual(rules.PROBLEMS);
		expect(CREDENTIAL_MESSAGES).toEqual(rules.MESSAGES);
		expect(CREDENTIAL_VALUE_MAX).toBe(rules.MAX_VALUE_LENGTH);
	});

	it('refuses the same values', () => {
		const samples = ['x', ' x ', '', '   ', '\t', 'a\u0000b', 'a\nb', 'a\u007f', 'a\u0085', 'a b', 'ä€🔑', 'a'.repeat(4096), 'a'.repeat(4097)];
		for (const value of samples) {
			expect(credentialValueProblem(value) ?? '', JSON.stringify(value).slice(0, 20)).toBe(rules.valueProblem(value));
		}
	});
});
