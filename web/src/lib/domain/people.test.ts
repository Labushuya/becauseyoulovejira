import { describe, expect, it } from 'vitest';
import { OTHER_LABEL, SELF_LABEL, SYSTEM_LABEL, personLabel, type PersonNames } from './people';

const KNOWN: Readonly<Record<string, string>> = {
	user0000000002: 'Anna Beispiel',
	user0000000003: '   '
};
const NAMES: PersonNames = { nameOf: (id) => KNOWN[id] ?? null };

describe('personLabel', () => {
	it.each([
		['user0000000001', 'user0000000001', SELF_LABEL],
		['', 'user0000000001', SYSTEM_LABEL],
		['', null, SYSTEM_LABEL],
		['user0000000002', 'user0000000001', OTHER_LABEL],
		['user0000000002', null, OTHER_LABEL]
	])('labels %j for the signed-in user %j as %j', (userId, selfId, label) => {
		expect(personLabel(userId, selfId)).toBe(label);
	});

	it('uses the German labels of T-9', () => {
		expect([SELF_LABEL, SYSTEM_LABEL, OTHER_LABEL]).toEqual(['Du', 'System', 'Anderes Konto']);
	});

	it('names another account once its name is visible (E7-1, ADR-0056 §4)', () => {
		expect(personLabel('user0000000002', 'user0000000001', NAMES)).toBe('Anna Beispiel');
		// Not visible (another household) or without a name: the fallback stays.
		expect(personLabel('user0000000009', 'user0000000001', NAMES)).toBe(OTHER_LABEL);
		expect(personLabel('user0000000003', 'user0000000001', NAMES)).toBe(OTHER_LABEL);
		// The own account and the system keep their words.
		expect(personLabel('user0000000002', 'user0000000002', NAMES)).toBe(SELF_LABEL);
		expect(personLabel('', 'user0000000001', NAMES)).toBe(SYSTEM_LABEL);
	});
});
