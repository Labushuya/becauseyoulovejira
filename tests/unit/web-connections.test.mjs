// The connections of the web app (web/src/lib/domain/connections.ts) against the hook modules:
// the same name pattern for variables, only kinds a user may create (E4 plan, package 10) and the
// same check of mailboxes (package 22), the suggestions per mail provider (package 13) and the
// texts of the Telegram bot (ADR-0016, addendum of 2026-10-01).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	CONNECTION_TYPES,
	MAIL_PROVIDERS,
	MAIL_PROVIDER_SECRET_NAMES,
	MAIL_USER_MAX_LENGTH,
	SECRET_NAME_PATTERN,
	TELEGRAM_CONFIRMATION,
	TELEGRAM_NO_MATCH,
	emptyConnectionDraft,
	isMailUser,
	isSecretName,
	withMailProvider
} from '../../web/src/lib/domain/connections.ts';

const secrets = loadHookLib('secrets.js');
const rules = loadHookLib('connection-rules.js');
const telegram = loadHookLib('channel-telegram.js');

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

	it('names the answers of the Telegram bot with the texts it sends (ADR-0016, addendum of 2026-10-01)', () => {
		expect(TELEGRAM_CONFIRMATION).toBe(telegram.CONFIRMATION);
		expect(TELEGRAM_NO_MATCH).toBe(telegram.NO_MATCH);
	});
});

describe('mail provider in the form (E4 plan, package 13)', () => {
	it('suggests a valid variable per provider', () => {
		expect(MAIL_PROVIDER_SECRET_NAMES).toEqual({ webde: 'BYL_WEBDE_PASSWORD', gmail: 'BYL_GMAIL_PASSWORD' });
		for (const name of Object.values(MAIL_PROVIDER_SECRET_NAMES)) expect(secrets.isValidName(name), name).toBe(true);
	});

	it('moves variable and label along with the provider while they are the suggestion', () => {
		const draft = emptyConnectionDraft('mail');
		const gmail = withMailProvider(draft, 'gmail');
		expect(gmail).toMatchObject({ mailProvider: 'gmail', secretEnv: 'BYL_GMAIL_PASSWORD', label: 'Gmail' });
		expect(withMailProvider(gmail, 'webde')).toMatchObject({ secretEnv: 'BYL_WEBDE_PASSWORD', label: 'Web.de' });
		expect(withMailProvider({ ...draft, secretEnv: '', label: ' ' }, 'gmail')).toMatchObject({
			secretEnv: 'BYL_GMAIL_PASSWORD',
			label: 'Gmail'
		});
	});

	it('keeps what the user typed', () => {
		const typed = { ...emptyConnectionDraft('mail'), secretEnv: 'BYL_PRIVAT', label: 'Privat', mailUser: 'anna@gmail.com' };
		expect(withMailProvider(typed, 'gmail')).toEqual({ ...typed, mailProvider: 'gmail' });
	});
});
