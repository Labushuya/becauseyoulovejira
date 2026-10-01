// The connections of the web app (web/src/lib/domain/connections.ts) against the hook modules:
// the same name pattern for variables, only kinds a user may create (E4 plan, package 10) and the
// same check of mailboxes (package 22), the suggestions per mail provider (package 13), the
// texts of the Telegram bot (ADR-0016, addendum of 2026-10-01), the check of a new name with
// its texts (ADR-0026, addendum KK-3) and the variable suggested for a further connection
// (ADR-0041, addendum of 2026-10-01).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	CONNECTION_LABEL_MESSAGES,
	CONNECTION_TYPES,
	LABEL_MAX_LENGTH,
	MAIL_PROVIDERS,
	MAIL_PROVIDER_SECRET_NAMES,
	MAIL_USER_MAX_LENGTH,
	SECRET_NAME_PATTERN,
	TELEGRAM_CONFIRMATION,
	TELEGRAM_NO_MATCH,
	emptyConnectionDraft,
	freeVariableName,
	isMailUser,
	isSecretName,
	labelError,
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

	it('checks a new name like the hook and says it with its texts (ADR-0026, addendum KK-3)', () => {
		expect(LABEL_MAX_LENGTH).toBe(rules.LABEL_MAX_LENGTH);
		for (const [code, message] of Object.entries(CONNECTION_LABEL_MESSAGES)) {
			expect(message, code).toBe(rules.MESSAGES[code]);
		}
		for (const label of ['Gmail', '', '  ', 'x'.repeat(100), ` ${'x'.repeat(100)} `, 'x'.repeat(101)]) {
			const hook = rules.labelViolation(label);
			expect(labelError(label), JSON.stringify(label)).toBe(hook === '' ? null : hook.message);
		}
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

describe('variable of a further connection (ADR-0041, addendum of 2026-10-01)', () => {
	it('suggests a name no connection uses yet, valid for secrets.js', () => {
		expect(freeVariableName('BYL_NOTION_TOKEN', [])).toBe('BYL_NOTION_TOKEN');
		expect(freeVariableName('BYL_NOTION_TOKEN', ['BYL_TELEGRAM_TOKEN'])).toBe('BYL_NOTION_TOKEN');
		expect(freeVariableName('BYL_NOTION_TOKEN', ['BYL_NOTION_TOKEN'])).toBe('BYL_NOTION_TOKEN_2');
		expect(freeVariableName('BYL_NOTION_TOKEN', ['BYL_NOTION_TOKEN', 'BYL_NOTION_TOKEN_2', 'BYL_NOTION_TOKEN_4'])).toBe(
			'BYL_NOTION_TOKEN_3'
		);
		// A gap at the start counts as free.
		expect(freeVariableName('BYL_NOTION_TOKEN', ['BYL_NOTION_TOKEN_2'])).toBe('BYL_NOTION_TOKEN');
		expect(secrets.isValidName(freeVariableName('BYL_GOOGLE_CALENDAR_URL', ['BYL_GOOGLE_CALENDAR_URL']))).toBe(true);
	});
});
