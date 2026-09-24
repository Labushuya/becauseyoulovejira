// Search values for `~` (E3 plan, package 11): "\", "%" and "_" are escaped, so PocketBase
// searches for exactly the typed text (finding in tests/integration/web-search.test.mjs).

import { describe, expect, it } from 'vitest';
import { likeText } from './like';

const BS = '\\';

describe('likeText', () => {
	it.each([
		['Miete', 'Miete'],
		['50%', `50${BS}%`],
		['a_b', `a${BS}_b`],
		[BS, `${BS}${BS}`],
		[`${BS}%`, `${BS}${BS}${BS}%`],
		['Äpfel & "Birnen"', 'Äpfel & "Birnen"'],
		['', '']
	])('%j becomes %j', (text, expected) => {
		expect(likeText(text)).toBe(expected);
	});
});
