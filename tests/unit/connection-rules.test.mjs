// Pure rules of the connections (ADR-0016 section 2, ADR-0018; E4 plan package 10).

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('connection-rules.js');
const secrets = loadHookLib('secrets.js');

const base = { type: 'calendar', secret_env: 'BYL_CAL', settings: null };
const empty = Object.fromEntries(rules.SERVER_FIELDS.map((field) => [field, '']));

describe('connection-rules.js', () => {
	it('allows calendar and Telegram with valid variable names', () => {
		expect(rules.createViolation({ ...base, ...empty }, secrets)).toBe('');
		expect(
			rules.createViolation(
				{ ...empty, type: 'telegram', secret_env: 'BYL_BOT', settings: { allowed_env: 'BYL_IDS' } },
				secrets
			)
		).toBe('');
	});

	it('refuses kinds of later packages, server fields and invalid names', () => {
		expect(rules.createViolation({ ...base, ...empty, type: 'mail' }, secrets)).toMatchObject({
			field: 'type',
			code: 'validation_connection_type'
		});
		for (const field of rules.SERVER_FIELDS) {
			expect(rules.createViolation({ ...base, ...empty, [field]: 'x' }, secrets)).toMatchObject({
				field,
				code: 'validation_connection_server_field'
			});
		}
		expect(rules.createViolation({ ...base, ...empty, secret_env: 'PATH' }, secrets)).toMatchObject({
			field: 'secret_env',
			code: 'validation_secret_name'
		});
	});

	it('checks the settings per kind', () => {
		expect(rules.settingsViolation('calendar', {}, secrets)).toBe('');
		expect(rules.settingsViolation('calendar', '', secrets)).toBe('');
		expect(rules.settingsViolation('calendar', { days: 30 }, secrets)).toMatchObject({
			code: 'validation_connection_settings'
		});
		expect(rules.settingsViolation('calendar', ['x'], secrets)).toMatchObject({
			code: 'validation_connection_settings'
		});
		expect(rules.settingsViolation('telegram', { allowed_env: 'byl_ids' }, secrets)).toMatchObject({
			code: 'validation_secret_name'
		});
		expect(
			rules.settingsViolation('telegram', { allowed_env: 'BYL_IDS', token: 'x' }, secrets)
		).toMatchObject({ code: 'validation_connection_settings' });
	});

	it('keeps kind and server fields on update', () => {
		const before = { ...base, ...empty, cursor: '5' };
		expect(rules.updateViolation(before, { ...before, secret_env: 'BYL_OTHER' }, secrets)).toBe('');
		expect(rules.updateViolation(before, { ...before, type: 'telegram' }, secrets)).toMatchObject({
			code: 'validation_connection_immutable'
		});
		expect(rules.updateViolation(before, { ...before, cursor: '6' }, secrets)).toMatchObject({
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
