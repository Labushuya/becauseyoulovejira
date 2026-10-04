// Charms (ADR-0062): the hook knows exactly the keys of the catalog of the SPA, in the same order,
// with the same texts of its codes; its check takes empty, a key of the catalog and the stored
// value, and refuses anything else.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { CHARM_KEYS, CHARM_MESSAGES } from '../../web/src/lib/domain/charms.ts';

const charms = loadHookLib('charms.js');

describe('keys of the charms (web/src/lib/domain/charms.ts)', () => {
	it('equal the allowlist of charms.js, in the same order', () => {
		expect([...charms.CHARM_KEYS]).toEqual([...CHARM_KEYS]);
		expect(Object.isFrozen(charms.CHARM_KEYS)).toBe(true);
	});

	it('name their codes with the texts of charms.js', () => {
		expect({ ...CHARM_MESSAGES }).toEqual({ ...charms.MESSAGES });
	});
});

describe('charmViolation', () => {
	it('takes empty and every key of the catalog', () => {
		expect(charms.charmViolation('', '')).toBe('');
		expect(charms.charmViolation(null, '')).toBe('');
		expect(charms.charmViolation(undefined, '')).toBe('');
		for (const key of CHARM_KEYS) expect(charms.charmViolation(key, ''), key).toBe('');
	});

	it('refuses an unknown key, another spelling and a name', () => {
		for (const value of ['einhorn', 'Geburtstag', 'GEBURTSTAG', ' geburtstag', 'geburtstag ', '🎂', 'muell,zug']) {
			expect(charms.charmViolation(value, ''), value).toBe('validation_charm_unknown');
		}
	});

	it('does not check a value again that is stored already', () => {
		expect(charms.charmViolation('alt', 'alt')).toBe('');
		expect(charms.charmViolation('alt', 'zug')).toBe('validation_charm_unknown');
	});

	it('knows a key of the catalog', () => {
		expect(charms.isCharmKey('flugzeug')).toBe(true);
		expect(charms.isCharmKey('')).toBe(false);
		expect(charms.isCharmKey(1)).toBe(false);
	});
});
