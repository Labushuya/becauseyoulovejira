import { describe, expect, it } from 'vitest';
import { OTHER_LABEL, SELF_LABEL, SYSTEM_LABEL, personLabel } from './people';

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
});
