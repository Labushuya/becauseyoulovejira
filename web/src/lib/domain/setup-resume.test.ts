// Unit tests of the return to the step of a setup assistant (BW-1, ADR-0072): the keys, writing and
// reading back, the expiry after two hours, broken entries, the form before BW-1, and that no
// secret ever reaches an entry: the names of variables only in their own form, token-like texts in
// any field left out, unknown fields not written.

import { describe, expect, it } from 'vitest';
import { setupStepKey } from './channel-setup';
import { emptyFolderDraft } from './folders';
import { emptyRepoDraft } from './github';
import {
	SETUP_RESUME_PREFIX,
	SETUP_RESUME_TTL_MS,
	begunSetups,
	connectInputsOf,
	isStaleSetupResume,
	looksLikeSecret,
	parseSetupResume,
	serializeSetupResume,
	setupResumeKey,
	type SetupConnectInputs,
	type SetupResume
} from './setup-resume';

const ID = 'conn00000000001';
const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const TOKENS = [
	'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
	'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
	'ntn_0123456789abcdefghijklmnopqrstuvwxyzAB',
	'123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
	`byl_${'a1B2c3D4e5'.repeat(4)}`,
	'https://calendar.google.com/calendar/ical/anna%40example.com/private-0123456789abcdef/basic.ics',
	'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLXdlcnQ',
	'Xk9vQ2pLm7Rt5Wz1Yb3Nc8Hd4Fg6Js0Pa2Ue'
];

function inputs(overrides: Partial<SetupConnectInputs> = {}): SetupConnectInputs {
	return {
		label: 'GitHub',
		mailUser: '',
		secretEnv: 'BYL_GITHUB_TOKEN',
		allowlistEnv: '',
		githubAuto: true,
		repo: { ...emptyRepoDraft(), input: 'beispiel/roadmap' },
		folder: null,
		...overrides
	};
}

function entry(overrides: Partial<SetupResume> = {}): SetupResume {
	return { step: 3, savedAt: NOW, restart: false, connect: null, ...overrides };
}

describe('keys of the assistants', () => {
	it('keeps the existing key of a connection and names a new setup by its kind', () => {
		expect(setupResumeKey('telegram', ID)).toBe(setupStepKey(ID));
		expect(setupResumeKey('telegram', ID)).toBe(`byl-setup:${ID}`);
		expect(setupResumeKey('github', null)).toBe('byl-setup:neu:github');
		expect(setupResumeKey('kalender', null).startsWith(SETUP_RESUME_PREFIX)).toBe(true);
	});
});

describe('writing and reading back', () => {
	it('reads back step, time, the mark of a restart and the inputs', () => {
		const stored = entry({ step: 2, restart: true, connect: inputs() });
		expect(parseSetupResume(serializeSetupResume(stored), NOW + 1000)).toEqual(stored);
	});

	it('writes the mark of a restart only when it is set, and no inputs without some', () => {
		const plain = JSON.parse(serializeSetupResume(entry())) as Record<string, unknown>;
		expect(Object.keys(plain).sort()).toEqual(['savedAt', 'step', 'v']);
		expect(plain.v).toBe(1);
	});

	it('takes the form before BW-1, only the number, as that step without inputs', () => {
		expect(parseSetupResume('4', NOW)).toEqual({
			step: 4,
			savedAt: NOW,
			restart: false,
			connect: null
		});
		// It carries no time, so tidying up keeps it until its assistant writes it anew.
		expect(isStaleSetupResume('4', NOW)).toBe(false);
	});
});

describe('expiry', () => {
	it('counts an entry for two hours after it was written', () => {
		const stored = serializeSetupResume(entry());
		expect(SETUP_RESUME_TTL_MS).toBe(2 * 60 * 60 * 1000);
		expect(parseSetupResume(stored, NOW + SETUP_RESUME_TTL_MS)?.step).toBe(3);
		expect(parseSetupResume(stored, NOW + SETUP_RESUME_TTL_MS + 1)).toBeNull();
		expect(isStaleSetupResume(stored, NOW + SETUP_RESUME_TTL_MS + 1)).toBe(true);
	});

	it('takes an entry from the future (beyond a minute of skew) for broken', () => {
		const stored = serializeSetupResume(entry({ savedAt: NOW + 61_000 }));
		expect(parseSetupResume(stored, NOW)).toBeNull();
		expect(
			parseSetupResume(serializeSetupResume(entry({ savedAt: NOW + 30_000 })), NOW)
		).not.toBeNull();
	});
});

describe('broken entries', () => {
	it.each([
		['no JSON', '{"v":1,"step":'],
		['text', '"Schritt 3"'],
		['a list', '[3]'],
		['another version', JSON.stringify({ v: 2, step: 3, savedAt: NOW })],
		['a step out of range', JSON.stringify({ v: 1, step: 99, savedAt: NOW })],
		['a negative step', JSON.stringify({ v: 1, step: -1, savedAt: NOW })],
		['a broken step', JSON.stringify({ v: 1, step: 2.5, savedAt: NOW })],
		['no time', JSON.stringify({ v: 1, step: 3 })],
		['a mark that is not true', JSON.stringify({ v: 1, step: 3, savedAt: NOW, restart: 'ja' })],
		['inputs of another form', JSON.stringify({ v: 1, step: 3, savedAt: NOW, connect: 'x' })],
		[
			'a variable that is no name',
			JSON.stringify({ v: 1, step: 0, savedAt: NOW, connect: { ...inputs(), secretEnv: 'geheim' } })
		],
		[
			'a token in a field',
			JSON.stringify({
				v: 1,
				step: 0,
				savedAt: NOW,
				connect: { ...inputs(), label: TOKENS[0] }
			})
		],
		[
			'a repository of another form',
			JSON.stringify({ v: 1, step: 0, savedAt: NOW, connect: { ...inputs(), repo: { input: 1 } } })
		]
	])('drops %s without throwing', (_name, stored) => {
		expect(parseSetupResume(stored, NOW)).toBeNull();
		expect(isStaleSetupResume(stored, NOW)).toBe(true);
	});

	it('has nothing to drop without an entry', () => {
		expect(parseSetupResume(null, NOW)).toBeNull();
		expect(isStaleSetupResume(null, NOW)).toBe(false);
	});
});

describe('no secret in an entry', () => {
	it.each(TOKENS)('takes %s for a token', (token) => {
		expect(looksLikeSecret(token)).toBe(true);
		expect(looksLikeSecret(` ${token} `)).toBe(true);
	});

	it.each([
		'Google Calendar',
		'anna.beispiel@example.com',
		'BYL_GOOGLE_CALENDAR_URL',
		'beispiel/roadmap',
		'C:\\Daten\\Projekte',
		'ROADMAP*\nCHANGELOG*\nREADME*\ndocs/**/roadmap*',
		'*.tmp\n~$*\n.git/**\nnode_modules/**\nThumbs.db\ndesktop.ini'
	])('keeps %s', (text) => {
		expect(looksLikeSecret(text)).toBe(false);
	});

	it('leaves out every token-like text and every value in a field for a name', () => {
		const typed = inputs({
			label: TOKENS[0] as string,
			mailUser: TOKENS[3] as string,
			secretEnv: TOKENS[1] as string,
			allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS',
			repo: { ...emptyRepoDraft(), input: TOKENS[2] as string, pathsText: TOKENS[4] as string },
			folder: { ...emptyFolderDraft(), path: TOKENS[5] as string, typesText: TOKENS[6] as string }
		});
		const stored = serializeSetupResume(entry({ connect: typed }));
		for (const token of TOKENS.slice(0, 7)) expect(stored).not.toContain(token);
		expect(parseSetupResume(stored, NOW)?.connect).toMatchObject({
			label: '',
			mailUser: '',
			secretEnv: '',
			allowlistEnv: 'BYL_TELEGRAM_ALLOWED_IDS'
		});
	});

	it('writes no field it does not know, such as a password', () => {
		const sneaky = {
			...entry({ connect: { ...inputs(), password: 'Geheim-4711' } as SetupConnectInputs }),
			token: 'Geheim-4712'
		} as SetupResume;
		const stored = serializeSetupResume(sneaky);
		expect(stored).not.toContain('Geheim-4711');
		expect(stored).not.toContain('Geheim-4712');
	});

	it('keeps the first repository only for GitHub and the first folder only for folders', () => {
		const draft = { label: 'X', mailUser: '', secretEnv: 'BYL_X', allowlistEnv: '' };
		const repo = { ...emptyRepoDraft(), input: 'a/b' };
		const folder = { ...emptyFolderDraft(), path: 'C:\\Daten' };
		expect(connectInputsOf('github', draft, true, repo, folder)).toMatchObject({
			githubAuto: true,
			repo: { input: 'a/b' },
			folder: null
		});
		expect(connectInputsOf('folder', draft, true, repo, folder)).toMatchObject({
			githubAuto: false,
			repo: null,
			folder: { path: 'C:\\Daten' }
		});
		expect(connectInputsOf('calendar', draft, true, repo, folder)).toMatchObject({
			githubAuto: false,
			repo: null,
			folder: null
		});
	});
});

describe('setups begun before their connection (KE-1, ADR-0076 §5)', () => {
	const entry = (step: number, savedAt: number) =>
		serializeSetupResume({ step, savedAt, restart: false, connect: null });

	it('names the kinds with a valid entry and the keys of broken or expired entries', () => {
		const result = begunSetups(
			[
				[setupResumeKey('telegram', null), entry(1, NOW)],
				[setupResumeKey('kalender', null), entry(0, NOW - 60_000)],
				[setupResumeKey('gmail', null), '{kaputt'],
				[setupResumeKey('webde', null), entry(2, NOW - SETUP_RESUME_TTL_MS - 1)],
				[setupResumeKey('kalender', ID), entry(4, NOW)],
				[`${SETUP_RESUME_PREFIX}neu:unbekannt`, entry(0, NOW)],
				['byl-first-steps', '{kaputt']
			],
			NOW
		);
		// In the order of the catalog; an entry of a connection is no setup before its connection.
		expect(result.kinds).toEqual(['kalender', 'telegram']);
		expect(result.stale.sort()).toEqual(
			[setupResumeKey('gmail', null), setupResumeKey('webde', null)].sort()
		);
	});

	it('leaves the form before BW-1 and the guides without steps out', () => {
		expect(
			begunSetups(
				[
					[setupResumeKey('notion', null), '3'],
					[setupResumeKey('proton', null), entry(0, NOW)],
					[setupResumeKey('whatsapp-web', null), entry(0, NOW)]
				],
				NOW
			)
		).toEqual({ kinds: ['notion'], stale: [] });
	});
});
