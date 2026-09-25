// The connections of the web app (web/src/lib/domain/connections.ts) against the hook modules:
// the same name pattern for variables and only kinds a user may create (E4 plan, package 10).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { CONNECTION_TYPES, SECRET_NAME_PATTERN, isSecretName } from '../../web/src/lib/domain/connections.ts';

const secrets = loadHookLib('secrets.js');
const rules = loadHookLib('connection-rules.js');

describe('web connections against the hooks', () => {
	it('uses the name pattern of secrets.js', () => {
		expect(SECRET_NAME_PATTERN.source).toBe(secrets.NAME.source);
		for (const name of ['BYL_X', 'PATH', 'byl_x', `BYL_${'A'.repeat(61)}`, 'BYL_A-B']) {
			expect(isSecretName(name), name).toBe(secrets.isValidName(name));
		}
	});

	it('offers exactly the kinds the hook accepts', () => {
		expect([...CONNECTION_TYPES]).toEqual([...rules.CREATABLE_TYPES]);
	});
});
