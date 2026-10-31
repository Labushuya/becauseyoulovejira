// Pure rules of the access data set from the browser (BW-3, ADR-0075): which names may be set
// (connections of the instance and the suggestions of a setup, never a name of the system or a
// switch of the tests, always the pattern of ADR-0018), the checks of a value, the requests and the
// answers. No answer carries a value. The lists are the same in app/byl-functions.ps1, and every
// BYL_* name the code of the app and of its helpers uses is a suggestion or blocked.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	DEFAULT_ALLOWLIST_NAME,
	DEFAULT_SECRET_NAMES,
	MAIL_PROVIDER_SECRET_NAMES
} from '../../web/src/lib/domain/connections.ts';

const rules = loadHookLib('credential-rules.js');
const secrets = loadHookLib('secrets.js');
const connectionRules = loadHookLib('connection-rules.js');

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const read = (path) => readFileSync(path, 'utf8').replace(/^﻿/, '');
const MARKER = 'Marker-7f3a1c9e-Wert';

/** The quoted names of a PowerShell array assignment `$Name = @(...)`. */
function powerShellList(source, variable) {
	const block = new RegExp(`^\\$${variable} = @\\(([\\s\\S]*?)\\)\\r?$`, 'm').exec(source);
	expect(block, variable).not.toBeNull();
	return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/**
 * The files of `dir` that `keep` accepts, with their text; below it only with `deep` (never the
 * data, logs or builds of the folder app: only its own files and pb_hooks are read).
 */
function files(dir, keep, deep = true) {
	return readdirSync(join(ROOT_DIR, dir), { recursive: deep, withFileTypes: false })
		.map((entry) => String(entry).replaceAll('\\', '/'))
		.filter(keep)
		.map((name) => ({ name: `${dir}/${name}`, text: read(join(ROOT_DIR, dir, name)) }));
}

describe('names that may be set (decision 1)', () => {
	const referenced = ['BYL_PRIVATE_CALENDAR', 'BYL_BOT', 'BYL_IDS'];

	it('takes a name a connection of the instance reads', () => {
		for (const name of referenced) expect(rules.nameProblem(name, referenced, secrets), name).toBe('');
	});

	it('takes the suggestions of a setup, also with the suffix of a further connection', () => {
		for (const name of ['BYL_GOOGLE_CALENDAR_URL', 'BYL_TELEGRAM_TOKEN_2', 'BYL_WEBDE_PASSWORD_17', 'BYL_GITHUB_TOKEN_999']) {
			expect(rules.nameProblem(name, [], secrets), name).toBe('');
		}
		for (const name of ['BYL_TELEGRAM_TOKEN_1', 'BYL_TELEGRAM_TOKEN_02', 'BYL_TELEGRAM_TOKEN_1000', 'BYL_TELEGRAM_TOKEN_X', 'BYL_TELEGRAM_TOKENS']) {
			expect(rules.nameProblem(name, [], secrets), name).toBe('unknown');
		}
	});

	it('refuses a foreign name that no connection reads and no setup suggests', () => {
		for (const name of ['BYL_FOREIGN', 'BYL_PRIVATE_CALENDAR_2', 'BYL_SOMETHING_ELSE']) {
			expect(rules.nameProblem(name, referenced, secrets), name).toBe('unknown');
		}
	});

	it('refuses every name outside the pattern of ADR-0018', () => {
		for (const name of ['PATH', 'byl_bot', 'BYL_', 'BYL_bot', 'BYL-BOT', ` BYL_BOT`, 'BYL_BOT\n', `BYL_${'A'.repeat(61)}`, '', null, 7, {}]) {
			expect(rules.nameProblem(name, [name], secrets), JSON.stringify(name)).toBe('name');
		}
		expect(rules.nameProblem(`BYL_${'A'.repeat(60)}`, [`BYL_${'A'.repeat(60)}`], secrets)).toBe('');
	});

	it('refuses the names of the system and the switches of the tests, even when a connection names one', () => {
		const system = [...rules.BLOCKED, 'BYL_TEST_ISOLATED', 'BYL_TEST_ACCOUNT_FILE', 'BYL_TEST_MAIL_PASSWORD', 'BYL_TEST_X'];
		for (const name of system) {
			expect(rules.isBlocked(name), name).toBe(true);
			expect(rules.nameProblem(name, system, secrets), name).toBe('blocked');
		}
		expect(rules.BLOCKED).toEqual(expect.arrayContaining(['BYL_INGEST_TOKEN', 'BYL_TELEGRAM_API_BASE', 'BYL_HOST_PLATFORM', 'BYL_MAIL_HELPER_PORT']));
		expect(rules.BLOCKED_PREFIXES).toEqual(['BYL_TEST_']);
	});

	it('keeps the suggestions of the setup word for word (web/src/lib/domain/connections.ts)', () => {
		const web = [...Object.values(DEFAULT_SECRET_NAMES), ...Object.values(MAIL_PROVIDER_SECRET_NAMES), DEFAULT_ALLOWLIST_NAME].filter((name) => name !== '');
		expect([...rules.SUGGESTED].sort()).toEqual([...new Set(web)].sort());
		for (const name of rules.SUGGESTED) expect(rules.isBlocked(name), name).toBe(false);
	});

	it('blocks the same names as byl-control.ps1 (Test-BylCredentialName in app/byl-functions.ps1)', () => {
		const functions = read(join(ROOT_DIR, 'app', 'byl-functions.ps1'));
		expect(powerShellList(functions, 'BylBlockedCredentialNames')).toEqual(rules.BLOCKED);
		expect(/^\$BylBlockedCredentialPrefixes = @\(([^)]*)\)/m.exec(functions)[1]).toBe(`'${rules.BLOCKED_PREFIXES[0]}'`);
		expect(/^\$BylCredentialValueMax = (\d+)/m.exec(functions)[1]).toBe(String(rules.MAX_VALUE_LENGTH));
	});

	it('blocks every BYL_* name the app and its helpers use that is no access data of a channel', () => {
		// The key of the self-test of byl-backup.exe names no variable.
		const NO_VARIABLE = ['BYL_SELBSTTEST'];
		const sources = [
			...files('app', (name) => /\.(ps1|bat|vbs|html)$/.test(name), false),
			...files('app/pb_hooks', (name) => name.endsWith('.js')),
			...files('helpers/mail/src', (name) => name.endsWith('.ts') && !name.includes('.test.')),
			...files('helpers/backup/src', (name) => name.endsWith('.ts') && !name.includes('.test.'))
		];
		const found = new Set();
		for (const { text } of sources) for (const [name] of text.matchAll(/\bBYL_[A-Z0-9_]+/g)) found.add(name);
		expect(found.size).toBeGreaterThan(10);
		for (const name of found) {
			const known = rules.isBlocked(name) || rules.isSuggested(name) || NO_VARIABLE.includes(name) || 'BYL_TEST_'.startsWith(name);
			expect(known, `${name} is neither blocked nor a suggestion`).toBe(true);
		}
	});
});

describe('the value (S8)', () => {
	it('takes any text without control characters up to 4096 characters, never trimmed', () => {
		for (const value of ['x', ' geheim ', 'äöü € 🔑', 'a'.repeat(4096), 'https://calendar.google.com/calendar/ical/x/basic.ics']) {
			expect(rules.valueProblem(value), value.slice(0, 20)).toBe('');
		}
		const input = rules.setInput({ name: 'BYL_TELEGRAM_TOKEN', value: '  mit Leerzeichen  ' }, [], secrets);
		expect(input).toEqual({ name: 'BYL_TELEGRAM_TOKEN', value: '  mit Leerzeichen  ' });
	});

	it('refuses an empty value (removing is "Entfernen"), control characters and more than 4096 characters', () => {
		expect(rules.valueProblem('')).toBe('empty');
		expect(rules.valueProblem('   ')).toBe('empty');
		for (const value of ['a\u0000b', 'a\nb', 'a\r\nb', '\tx', 'x\u007f', 'x\u0085', 'x\u009f', 'x\u001b[0m']) {
			expect(rules.valueProblem(value), JSON.stringify(value)).toBe('control');
		}
		expect(rules.valueProblem('a'.repeat(4097))).toBe('long');
		for (const value of [undefined, null, 42, ['x'], { value: 'x' }]) expect(rules.valueProblem(value)).toBe('invalid');
	});
});

describe('requests and answers carry no value (S1)', () => {
	it('names the problem of a request and at most the variable', () => {
		const cases = [
			[{ name: 'BYL_FOREIGN', value: MARKER }, 'unknown', 'BYL_FOREIGN'],
			[{ name: 'BYL_INGEST_TOKEN', value: MARKER }, 'blocked', 'BYL_INGEST_TOKEN'],
			[{ name: 'BYL_TEST_ISOLATED', value: MARKER }, 'blocked', 'BYL_TEST_ISOLATED'],
			[{ name: MARKER, value: MARKER }, 'name', ''],
			[{ name: 'BYL_TELEGRAM_TOKEN', value: `${MARKER}\n` }, 'control', 'BYL_TELEGRAM_TOKEN'],
			[{ name: 'BYL_TELEGRAM_TOKEN', value: MARKER.repeat(500) }, 'long', 'BYL_TELEGRAM_TOKEN'],
			[{ name: 'BYL_TELEGRAM_TOKEN' }, 'invalid', 'BYL_TELEGRAM_TOKEN'],
			[{ value: MARKER }, 'invalid', undefined],
			[MARKER, 'invalid', undefined],
			[null, 'invalid', undefined]
		];
		for (const [body, problem, name] of cases) {
			const input = rules.setInput(body, [], secrets);
			expect(input.problem, JSON.stringify(body).slice(0, 60)).toBe(problem);
			const answer = rules.problemView(input.problem, input.name);
			expect(answer).toEqual({ status: 400, message: rules.MESSAGES[problem], problem, ...(name ? { name } : {}) });
			expect(JSON.stringify([input, answer])).not.toContain(MARKER);
		}
		expect(rules.removeInput({ name: 'BYL_TELEGRAM_TOKEN', value: MARKER }, [], secrets)).toEqual({ name: 'BYL_TELEGRAM_TOKEN' });
		expect(rules.removeInput({ name: 'BYL_DIR' }, [], secrets)).toEqual({ problem: 'blocked', name: 'BYL_DIR' });
		for (const text of Object.values(rules.MESSAGES)) expect(text).not.toMatch(/\{|\$/);
	});

	it('reads only yes or no from the control script and names the connections of a variable', () => {
		const names = rules.statusNames('BYL_TELEGRAM_TOKEN_2,BYL_FOREIGN,BYL_INGEST_TOKEN,PATH,BYL_BOT', ['BYL_IDS', 'BYL_BOT', 'BYL_INGEST_TOKEN'], secrets);
		expect(names).toEqual(['BYL_BOT', 'BYL_IDS', 'BYL_INGEST_TOKEN', 'BYL_TELEGRAM_TOKEN_2']);
		const raw = {
			ok: true,
			variables: [
				{ name: 'BYL_BOT', set: true, value: MARKER },
				{ name: 'BYL_IDS', set: false, length: 12 },
				{ name: 'BYL_OTHER', set: true }
			]
		};
		const states = rules.statusOf(raw, ['BYL_BOT', 'BYL_IDS', 'BYL_TELEGRAM_TOKEN_2']);
		expect(states).toEqual({ BYL_BOT: true, BYL_IDS: false, BYL_TELEGRAM_TOKEN_2: null });
		const view = rules.statusView(names, states, { BYL_BOT: ['Telegram B', 'Telegram A'], BYL_INGEST_TOKEN: ['Postfach'] }, rules.isBlocked, true);
		expect(view).toEqual({
			variables: [
				{ name: 'BYL_BOT', set: true, blocked: false, channels: ['Telegram A', 'Telegram B'] },
				{ name: 'BYL_IDS', set: false, blocked: false, channels: [] },
				{ name: 'BYL_INGEST_TOKEN', set: null, blocked: true, channels: ['Postfach'] },
				{ name: 'BYL_TELEGRAM_TOKEN_2', set: null, blocked: false, channels: [] }
			],
			restartNeeded: true
		});
		expect(JSON.stringify(view)).not.toContain(MARKER);
		for (const broken of [null, {}, { ok: false, variables: [] }, { ok: true }, 'x']) expect(rules.statusOf(broken, ['BYL_BOT'])).toBeNull();
		expect(rules.statusNames(Array.from({ length: 30 }, (_, i) => `BYL_TELEGRAM_TOKEN_${i + 2}`).join(','), [], secrets)).toHaveLength(rules.MAX_EXTRA_NAMES);
	});

	it('takes from the answer of credential-set and credential-remove only ok and the problem', () => {
		expect(rules.scriptAnswer({ ok: true, name: 'BYL_BOT' })).toEqual({ ok: true });
		expect(rules.scriptAnswer({ ok: false, problem: 'control', report: { problem: MARKER } })).toEqual({ ok: false, problem: 'control' });
		expect(rules.scriptAnswer({ ok: false, problem: 'gibt-es-nicht' })).toEqual({ ok: false, problem: 'write' });
		for (const broken of [null, 'x', {}, { ok: 'yes' }]) expect(rules.scriptAnswer(broken)).toBeNull();
	});

	it('knows the mark of a change only as a time', () => {
		expect(rules.restartNeeded(Date.now())).toBe(true);
		for (const stored of [undefined, null, 0, -1, 'yes', true, Number.NaN]) expect(rules.restartNeeded(stored)).toBe(false);
	});
});

describe('names of a connection (V7, connection-rules.validVariableNames)', () => {
	it('names the secret and the allowlist of Telegram, each valid name once', () => {
		expect(connectionRules.validVariableNames('telegram', 'BYL_BOT', { allowed_env: 'BYL_IDS' }, secrets)).toEqual(['BYL_BOT', 'BYL_IDS']);
		expect(connectionRules.validVariableNames('telegram', 'BYL_BOT', { allowed_env: 'BYL_BOT' }, secrets)).toEqual(['BYL_BOT']);
		expect(connectionRules.validVariableNames('telegram', 'BYL_BOT', { allowed_env: 'path' }, secrets)).toEqual(['BYL_BOT']);
		expect(connectionRules.validVariableNames('calendar', 'BYL_CAL', { allowed_env: 'BYL_IDS' }, secrets)).toEqual(['BYL_CAL']);
		expect(connectionRules.validVariableNames('folder', '', null, secrets)).toEqual([]);
	});
});
