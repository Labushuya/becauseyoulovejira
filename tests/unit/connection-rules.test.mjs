// Pure rules of the connections (ADR-0016 section 2, ADR-0018, ADR-0020; E4 plan packages 10 and 20).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('connection-rules.js');
const secrets = loadHookLib('secrets.js');
const keywords = loadHookLib('keywords.js');

const base = { type: 'calendar', secret_env: 'BYL_CAL', settings: null };
const empty = Object.fromEntries(rules.SERVER_FIELDS.map((field) => [field, '']));

describe('connection-rules.js', () => {
	it('allows calendar and Telegram with valid variable names', () => {
		expect(rules.createViolation({ ...base, ...empty }, secrets, keywords)).toBe('');
		expect(
			rules.createViolation(
				{ ...empty, type: 'telegram', secret_env: 'BYL_BOT', settings: { allowed_env: 'BYL_IDS' } },
				secrets,
				keywords
			)
		).toBe('');
	});

	it('allows Notion without settings (ADR-0041): no keywords, nothing but the variable', () => {
		const notion = { ...empty, type: 'notion', secret_env: 'BYL_NOTION_TOKEN' };
		expect(rules.CREATABLE_TYPES).toContain('notion');
		expect(rules.createViolation({ ...notion, settings: null }, secrets, keywords)).toBe('');
		expect(rules.createViolation({ ...notion, settings: {} }, secrets, keywords)).toBe('');
		for (const settings of [{ keywords: ['todo'] }, { token: 'x' }, { match_body: true }]) {
			expect(rules.createViolation({ ...notion, settings }, secrets, keywords), JSON.stringify(settings)).toMatchObject({
				field: 'settings',
				code: 'validation_connection_settings'
			});
		}
		expect(rules.sourceIdentity('notion', 'BYL_NOTION_TOKEN', {})).toBe('BYL_NOTION_TOKEN\n');
	});

	it('refuses unknown kinds, server fields and invalid names', () => {
		expect(rules.createViolation({ ...base, ...empty, type: 'slack' }, secrets, keywords)).toMatchObject({
			field: 'type',
			code: 'validation_connection_type'
		});
		for (const field of rules.SERVER_FIELDS) {
			expect(rules.createViolation({ ...base, ...empty, [field]: 'x' }, secrets, keywords)).toMatchObject({
				field,
				code: 'validation_connection_server_field'
			});
		}
		expect(rules.createViolation({ ...base, ...empty, secret_env: 'PATH' }, secrets, keywords)).toMatchObject({
			field: 'secret_env',
			code: 'validation_secret_name'
		});
	});

	it('checks the settings per kind', () => {
		expect(rules.settingsViolation('calendar', {}, secrets, keywords)).toBe('');
		expect(rules.settingsViolation('calendar', '', secrets, keywords)).toBe('');
		expect(rules.settingsViolation('calendar', { days: 30 }, secrets, keywords)).toMatchObject({
			code: 'validation_connection_settings'
		});
		expect(rules.settingsViolation('calendar', ['x'], secrets, keywords)).toMatchObject({
			code: 'validation_connection_settings'
		});
		expect(rules.settingsViolation('telegram', { allowed_env: 'byl_ids' }, secrets, keywords)).toMatchObject({
			code: 'validation_secret_name'
		});
		expect(
			rules.settingsViolation('telegram', { allowed_env: 'BYL_IDS', token: 'x' }, secrets, keywords)
		).toMatchObject({ code: 'validation_connection_settings' });
	});

	it('accepts keyword lists and the answer switch, and refuses bad ones (ADR-0020)', () => {
		expect(rules.settingsViolation('calendar', { keywords: ['todo', '#byl'] }, secrets, keywords)).toBe('');
		expect(
			rules.settingsViolation(
				'telegram',
				{ allowed_env: 'BYL_IDS', keywords: [], reply_no_match: false },
				secrets,
				keywords
			)
		).toBe('');
		for (const list of ['todo', [''], ['x'.repeat(101)], Array.from({ length: 51 }, (_, i) => `k${i}`)]) {
			expect(rules.settingsViolation('calendar', { keywords: list }, secrets, keywords)).toEqual({
				field: 'settings',
				code: 'validation_keywords',
				message: keywords.MESSAGE
			});
		}
		expect(
			rules.settingsViolation('telegram', { allowed_env: 'BYL_IDS', reply_no_match: 'nein' }, secrets, keywords)
		).toMatchObject({ code: 'validation_connection_settings' });
		expect(rules.settingsViolation('calendar', { reply_no_match: true }, secrets, keywords)).toMatchObject({
			code: 'validation_connection_settings'
		});
	});

	it('accepts the switch of the confirmation for Telegram only, as true or false (ADR-0016, addendum of 2026-10-01)', () => {
		for (const value of [true, false]) {
			expect(
				rules.settingsViolation('telegram', { allowed_env: 'BYL_IDS', reply_saved: value, reply_no_match: value }, secrets, keywords),
				String(value)
			).toBe('');
		}
		for (const value of ['nein', 0, 1, null, {}]) {
			expect(
				rules.settingsViolation('telegram', { allowed_env: 'BYL_IDS', reply_saved: value }, secrets, keywords),
				JSON.stringify(value)
			).toEqual({ field: 'settings', code: 'validation_connection_settings', message: 'Unbekannte Einstellung.' });
		}
		for (const type of ['calendar', 'mail', 'notion']) {
			const base = type === 'mail' ? { provider: 'webde', user: 'anna@web.de' } : {};
			expect(rules.settingsViolation(type, { ...base, reply_saved: true }, secrets, keywords), type).toMatchObject({
				code: 'validation_connection_settings'
			});
		}
	});

	it('reads keywords and the answer switches, tolerant of missing values', () => {
		expect(rules.keywordsOf({ keywords: [' todo ', 1] }, keywords)).toEqual(['todo']);
		expect(rules.keywordsOf(null, keywords)).toEqual([]);
		expect(rules.keywordsOf({}, keywords)).toEqual([]);
		expect(rules.repliesWithoutMatch(null)).toBe(true);
		expect(rules.repliesWithoutMatch({ reply_no_match: true })).toBe(true);
		expect(rules.repliesWithoutMatch({ reply_no_match: false })).toBe(false);
		// Both default to on; a connection from before the switch has no value (data of before).
		for (const settings of [null, '', [], {}, { allowed_env: 'BYL_IDS', keywords: ['todo'] }, { reply_saved: 'x' }]) {
			expect(rules.repliesOnSave(settings), JSON.stringify(settings)).toBe(true);
			expect(rules.repliesWithoutMatch(settings), JSON.stringify(settings)).toBe(true);
		}
		expect(rules.repliesOnSave({ reply_saved: true })).toBe(true);
		expect(rules.repliesOnSave({ reply_saved: false })).toBe(false);
		expect(rules.repliesOnSave({ reply_saved: false, reply_no_match: true })).toBe(false);
		expect(rules.repliesWithoutMatch({ reply_saved: false, reply_no_match: true })).toBe(true);
	});

	it('keeps kind and server fields on update', () => {
		const before = { ...base, ...empty, cursor: '5' };
		expect(rules.updateViolation(before, { ...before, secret_env: 'BYL_OTHER' }, secrets, keywords)).toBe('');
		expect(rules.updateViolation(before, { ...before, type: 'telegram' }, secrets, keywords)).toMatchObject({
			code: 'validation_connection_immutable'
		});
		expect(rules.updateViolation(before, { ...before, cursor: '6' }, secrets, keywords)).toMatchObject({
			field: 'cursor',
			code: 'validation_connection_server_field'
		});
	});

	it('reports only whether the variables are set', () => {
		const env = { BYL_BOT: 'token-value', BYL_IDS: '1,2' };
		const getenv = (name) => env[name] ?? '';
		expect(rules.secretStatus('telegram', 'BYL_BOT', { allowed_env: 'BYL_IDS' }, secrets, getenv)).toEqual({
			secret: true,
			allowlist: true
		});
		expect(rules.secretStatus('telegram', 'BYL_BOT', { allowed_env: 'BYL_NONE' }, secrets, getenv)).toEqual({
			secret: true,
			allowlist: false
		});
		expect(rules.secretStatus('calendar', 'BYL_NONE', null, secrets, getenv)).toEqual({
			secret: false,
			allowlist: null
		});
		expect(rules.variableNames('telegram', 'BYL_BOT', { allowed_env: 'BYL_IDS' })).toEqual({
			secret: 'BYL_BOT',
			allowlist: 'BYL_IDS'
		});
	});
});

describe('mail connections (E4 plan, package 22)', () => {
	const mail = { ...empty, type: 'mail', secret_env: 'BYL_WEBDE_PASSWORD' };
	const settings = { provider: 'webde', user: 'anna@web.de' };

	it('can be created with provider and user name', () => {
		expect(rules.CREATABLE_TYPES).toContain('mail');
		expect(rules.MAIL_PROVIDERS).toEqual(['webde', 'gmail']);
		expect(rules.createViolation({ ...mail, settings }, secrets, keywords)).toBe('');
		expect(
			rules.createViolation(
				{ ...mail, settings: { ...settings, keywords: ['todo'], match_body: true } },
				secrets,
				keywords
			)
		).toBe('');
	});

	it('accepts Gmail as provider (E4 plan, package 13)', () => {
		const gmail = { provider: 'gmail', user: 'anna@gmail.com', keywords: ['todo'] };
		expect(rules.createViolation({ ...mail, secret_env: 'BYL_GMAIL_PASSWORD', settings: gmail }, secrets, keywords)).toBe('');
		expect(rules.mailSettingsOf(gmail)).toEqual({ provider: 'gmail', user: 'anna@gmail.com', matchBody: false });
		expect(rules.sourceIdentity('mail', 'BYL_A', gmail)).not.toBe(rules.sourceIdentity('mail', 'BYL_A', { ...gmail, provider: 'webde' }));
	});

	it.each([
		['no provider', { user: 'anna@web.de' }, 'validation_mail_provider'],
		['an unknown provider', { ...settings, provider: 'proton' }, 'validation_mail_provider'],
		['no user', { provider: 'webde' }, 'validation_mail_user'],
		['a user with a space', { ...settings, user: 'anna @web.de' }, 'validation_mail_user'],
		['a user with a line break', { ...settings, user: 'anna@web.de\n' }, 'validation_mail_user'],
		['a user that is too long', { ...settings, user: `${'a'.repeat(250)}@x.de` }, 'validation_mail_user'],
		['a number as user', { ...settings, user: 3 }, 'validation_mail_user'],
		['match_body as text', { ...settings, match_body: 'ja' }, 'validation_connection_settings'],
		['a host', { ...settings, host: 'imap.example.com' }, 'validation_connection_settings'],
		['a password', { ...settings, password: 'x' }, 'validation_connection_settings']
	])('refuses %s', (name, value, code) => {
		expect(rules.settingsViolation('mail', value, secrets, keywords)).toMatchObject({ field: 'settings', code });
	});

	it('reads the mail settings tolerant of missing values', () => {
		expect(rules.mailSettingsOf({ ...settings, match_body: true })).toEqual({
			provider: 'webde',
			user: 'anna@web.de',
			matchBody: true
		});
		expect(rules.mailSettingsOf(null)).toEqual({ provider: '', user: '', matchBody: false });
		expect(rules.variableNames('mail', 'BYL_WEBDE_PASSWORD', settings)).toEqual({
			secret: 'BYL_WEBDE_PASSWORD',
			allowlist: ''
		});
	});

	it('starts over when the mailbox or a variable changes, not for keywords', () => {
		const identity = (secret, value) => rules.sourceIdentity('mail', secret, value);
		const before = identity('BYL_A', settings);
		expect(identity('BYL_A', { ...settings, keywords: ['todo'], match_body: true })).toBe(before);
		expect(identity('BYL_A', { ...settings, user: 'ANNA@web.de' })).toBe(before);
		expect(identity('BYL_A', { ...settings, user: 'bert@web.de' })).not.toBe(before);
		expect(identity('BYL_B', settings)).not.toBe(before);
		expect(rules.sourceIdentity('telegram', 'BYL_BOT', { allowed_env: 'BYL_IDS' })).not.toBe(
			rules.sourceIdentity('telegram', 'BYL_BOT', { allowed_env: 'BYL_OTHER' })
		);
	});
});
