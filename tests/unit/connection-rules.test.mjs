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

	it('refuses kinds of later packages, server fields and invalid names', () => {
		expect(rules.createViolation({ ...base, ...empty, type: 'mail' }, secrets, keywords)).toMatchObject({
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

	it('reads keywords and the answer switch, tolerant of missing values', () => {
		expect(rules.keywordsOf({ keywords: [' todo ', 1] }, keywords)).toEqual(['todo']);
		expect(rules.keywordsOf(null, keywords)).toEqual([]);
		expect(rules.keywordsOf({}, keywords)).toEqual([]);
		expect(rules.repliesWithoutMatch(null)).toBe(true);
		expect(rules.repliesWithoutMatch({ reply_no_match: true })).toBe(true);
		expect(rules.repliesWithoutMatch({ reply_no_match: false })).toBe(false);
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
