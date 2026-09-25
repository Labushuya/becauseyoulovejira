// The connections of the web app (web/src/lib/domain/connections.ts) against the hook modules:
// the same name pattern for variables, only kinds a user may create (E4 plan, package 10) and the
// same check of mailboxes (package 22).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	CONNECTION_TYPES,
	MAIL_PROVIDERS,
	MAIL_USER_MAX_LENGTH,
	SECRET_NAME_PATTERN,
	isMailUser,
	isSecretName
} from '../../web/src/lib/domain/connections.ts';

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

	it('knows the same mail providers and user names', () => {
		expect([...MAIL_PROVIDERS]).toEqual([...rules.MAIL_PROVIDERS]);
		expect(MAIL_USER_MAX_LENGTH).toBe(rules.MAIL_USER_MAX_LENGTH);
		const names = ['anna@web.de', 'anna', '', ' ', 'a b', 'a\tb', 'a\u0000', 'a\u007f', 'x'.repeat(254), 'x'.repeat(255), 'ä@ü.de'];
		for (const name of names) expect(isMailUser(name), JSON.stringify(name)).toBe(rules.isMailUser(name));
	});
});
