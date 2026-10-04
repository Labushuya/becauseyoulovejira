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

	it('checks GitHub settings through github-rules.js and runs GitHub without its token (ADR-0050)', () => {
		const github = loadHookLib('github-rules.js');
		const before = { ...empty, type: 'github', secret_env: 'BYL_GITHUB_TOKEN', settings: null };
		const after = { ...before, settings: { interval: 30, repos: [{ repo: 'octo/roadmap', paths: ['CHANGELOG*'] }] } };
		expect(rules.updateViolation(before, after, secrets, keywords, github)).toBe('');
		expect(rules.updateViolation(before, { ...after, settings: { keywords: ['todo'] } }, secrets, keywords, github)).toMatchObject({
			field: 'settings',
			code: 'validation_github_settings'
		});
		expect(rules.updateViolation(before, { ...after, settings: { repos: [{ repo: 'octo' }] } }, secrets, keywords, github)).toMatchObject({
			code: 'validation_github_repo'
		});
		// Without the rules of GitHub a GitHub connection takes no settings at all.
		expect(rules.settingsViolation('github', {}, secrets, keywords)).toMatchObject({ code: 'validation_connection_settings' });
		// A user creates one since the interface offers it (plan beobachtete-quellen, GH-2), with its
		// first repository.
		expect(rules.CREATABLE_TYPES).toContain('github');
		expect(rules.createViolation({ ...after, label: 'GitHub' }, secrets, keywords, github)).toBe('');
		expect(rules.requiresSecret('github')).toBe(false);
		for (const type of rules.CREATABLE_TYPES.filter((type) => !rules.SECRET_OPTIONAL_TYPES.includes(type))) {
			expect(rules.requiresSecret(type), type).toBe(true);
		}
		expect(rules.SECRET_OPTIONAL_TYPES).toEqual(['github', 'folder']);
		// The state of the channel is a field of the server: a client never writes it.
		expect(rules.SERVER_FIELDS).toContain('watch');
		expect(rules.updateViolation(before, { ...before, watch: '{"repos":{}}' }, secrets, keywords, github)).toMatchObject({
			field: 'watch',
			code: 'validation_connection_server_field'
		});
	});

	it('checks folder settings through the rules of the folders and takes no access data for folders (ADR-0051)', () => {
		const folderRules = loadHookLib('folder-rules.js');
		const folder = { settingsViolation: (value) => folderRules.settingsViolation(value, 'windows') };
		const before = { ...empty, type: 'folder', secret_env: '', settings: null };
		const after = { ...before, settings: { interval: 10, folders: [{ path: 'C:\\Daten\\Projekte', types: ['pdf'] }] } };
		expect(rules.updateViolation(before, after, secrets, keywords, null, folder)).toBe('');
		expect(rules.updateViolation(before, { ...after, settings: { keywords: ['todo'] } }, secrets, keywords, null, folder)).toMatchObject({
			field: 'settings',
			code: 'validation_folder_settings'
		});
		expect(rules.updateViolation(before, { ...after, settings: { folders: [{ path: 'Daten' }] } }, secrets, keywords, null, folder)).toMatchObject({
			code: 'validation_folder_path'
		});
		// Without the rules of the folders a folder connection takes no settings at all.
		expect(rules.settingsViolation('folder', {}, secrets, keywords)).toMatchObject({ code: 'validation_connection_settings' });
		// No variable: an empty name, never one of BYL_.
		expect(rules.updateViolation(before, { ...after, secret_env: 'BYL_ORDNER' }, secrets, keywords, null, folder)).toMatchObject({
			field: 'secret_env',
			code: 'validation_connection_secret_none'
		});
		expect(rules.secretViolation('calendar', '', secrets)).toMatchObject({ code: 'validation_secret_name' });
		expect(rules.SECRETLESS_TYPES).toEqual(['folder']);
		expect(rules.requiresSecret('folder')).toBe(false);
		// Users create one since the interface offers it (OD-2), with its first folder and no variable.
		expect(rules.CREATABLE_TYPES).toContain('folder');
		expect(rules.createViolation({ ...after, label: 'Ordner' }, secrets, keywords, null, folder)).toBe('');
		expect(rules.createViolation({ ...after, label: 'Ordner', secret_env: 'BYL_ORDNER' }, secrets, keywords, null, folder)).toMatchObject({
			field: 'secret_env',
			code: 'validation_connection_secret_none'
		});
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

	it('checks the name: not empty after trimming, at most 100 characters (KK-3)', () => {
		expect(rules.LABEL_MAX_LENGTH).toBe(100);
		expect(rules.labelViolation('Gmail Arbeit')).toBe('');
		expect(rules.labelViolation(`  ${'a'.repeat(100)}  `)).toBe('');
		for (const label of ['', '   ', '\t\n', undefined, null]) {
			expect(rules.labelViolation(label), JSON.stringify(label)).toEqual({
				field: 'label',
				code: 'validation_connection_label',
				message: 'Bitte einen Namen eingeben.'
			});
		}
		expect(rules.labelViolation('a'.repeat(101))).toEqual({
			field: 'label',
			code: 'validation_connection_label_max',
			message: 'Höchstens 100 Zeichen.'
		});
		expect(rules.normalizeLabel('  Gmail  Arbeit \n')).toBe('Gmail  Arbeit');
	});

	it('lets a new name come only alone: nothing else changes with it (KK-3)', () => {
		const before = {
			...base,
			...empty,
			label: 'Kalender',
			enabled: 'true',
			owner: 'u1',
			household: '',
			settings_json: '{"keywords":["todo"]}',
			cursor: '41'
		};
		expect(rules.renameViolation(before, { ...before, label: 'Familie' })).toBe('');
		// Without a new name the rule does not apply (switches, keywords, variables alone).
		expect(rules.renameViolation(before, { ...before, enabled: 'false' })).toBe('');
		const changes = {
			type: 'telegram',
			enabled: 'false',
			secret_env: 'BYL_OTHER',
			settings_json: '{"keywords":[]}',
			owner: 'u2',
			household: 'h1',
			cursor: '0',
			// The target project stays out of a rename as well (ADR-0049).
			target_project: 'abcdefghijklmno'
		};
		for (const [field, value] of Object.entries(changes)) {
			expect(rules.renameViolation(before, { ...before, label: 'Familie', [field]: value }), field).toEqual({
				field: field === 'settings_json' ? 'settings' : field,
				code: 'validation_connection_rename_only',
				message: rules.MESSAGES.validation_connection_rename_only
			});
		}
		for (const field of rules.SERVER_FIELDS) {
			expect(rules.renameViolation(before, { ...before, label: 'Familie', [field]: 'x' })).toMatchObject({
				field,
				code: 'validation_connection_rename_only'
			});
		}
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

describe('channels with access data and folders only for the administrator (ADR-0056 §5)', () => {
	it('knows what reaches into the server machine', () => {
		expect(rules.usesServerAccess({ type: 'calendar', secret_env: 'BYL_CAL' })).toBe(true);
		expect(rules.usesServerAccess({ type: 'github', secret_env: 'BYL_GITHUB' })).toBe(true);
		expect(rules.usesServerAccess({ type: 'folder', secret_env: '' })).toBe(true);
		expect(rules.usesServerAccess({ type: 'telegram', secret_env: '', settings: { allowed_env: 'BYL_IDS' } })).toBe(true);
		expect(rules.usesServerAccess({ type: 'notion', secret_env: '' })).toBe(false);
	});

	it('refuses an account without the right, also for a connection that had access before', () => {
		const calendar = { type: 'calendar', secret_env: 'BYL_CAL' };
		expect(rules.adminViolation(true, null, calendar)).toBe('');
		expect(rules.adminViolation(false, null, calendar)).toEqual({
			field: 'type',
			code: 'validation_connection_admin_only',
			message: 'Kanäle mit Zugangsdaten und Ordner richtet nur der Verwalter der App ein.'
		});
		expect(rules.adminViolation(false, calendar, { type: 'calendar', secret_env: '' })).toMatchObject({
			code: 'validation_connection_admin_only'
		});
		expect(rules.adminViolation(false, null, { type: 'notion', secret_env: '' })).toBe('');
	});

	it('keeps every connection private: none is created in a household (E7-3, ADR-0059 §5)', () => {
		for (const type of rules.CREATABLE_TYPES) {
			expect(rules.areaViolation({ type, household: 'h00000000000001' }), type).toEqual({
				field: 'household',
				code: 'validation_connection_private_only',
				message: 'Verbindungen gibt es nur im privaten Bereich.'
			});
			expect(rules.areaViolation({ type, household: '' }), type).toBe('');
		}
		expect(rules.areaViolation({ type: 'calendar' })).toBe('');
	});
});
