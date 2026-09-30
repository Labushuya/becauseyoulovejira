// Page "Einstellungen → System" (ADR-0043), pure part: the answers of the routes are read
// strictly, the refusals get their reason, the texts of state, verdict and mail helper, the
// Berlin time of the control script, and the reasons of a restart in the same words as status.bat
// (byl-control.ps1).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	DENIAL_TEXTS,
	RESTART_REASONS,
	RESTART_REASON_LABELS,
	denialOf,
	formatPointInTime,
	mailText,
	otherServerText,
	parseDoctor,
	parseLogs,
	parseOverview,
	restartNeeded,
	sizeText,
	stateText,
	verdictText,
	type SystemOverview,
	type SystemStatus
} from './system';

const STATUS = {
	state: 'running',
	pid: 4321,
	port: 8090,
	configuredPort: 8090,
	url: 'http://127.0.0.1:8090/',
	startedUtc: '2026-09-30T07:15:42.2143696Z',
	verdict: 'current',
	restartReasons: [],
	reload: false,
	mailHelperPid: null,
	portOwner: null,
	otherServers: [],
	autostart: 'off'
};

function overview(
	status: Partial<SystemStatus> = {},
	mail: Partial<SystemOverview['mail']> = {}
): SystemOverview {
	const parsed = parseOverview({
		appDir: 'C:\\Apps\\becauseyoulovejira\\app',
		status: { ...STATUS, ...status },
		mail: { installed: true, running: false, blocker: '', ...mail }
	});
	if (parsed === null) throw new Error('not an overview');
	return parsed;
}

describe('parseOverview', () => {
	it('reads the answer of GET /api/byl/system', () => {
		expect(overview()).toEqual({
			appDir: 'C:\\Apps\\becauseyoulovejira\\app',
			status: {
				state: 'running',
				pid: 4321,
				port: 8090,
				configuredPort: 8090,
				url: 'http://127.0.0.1:8090/',
				startedUtc: '2026-09-30T07:15:42.2143696Z',
				verdict: 'current',
				restartReasons: [],
				reload: false,
				mailHelperPid: null,
				otherServers: [],
				autostart: 'off'
			},
			mail: { installed: true, running: false, blocker: '' }
		});
	});

	it('keeps only known reasons, servers and values', () => {
		const parsed = overview({
			restartReasons: ['hooks', 'mystery', 'migrations'] as SystemStatus['restartReasons'],
			otherServers: [
				{ pid: 7, path: 'D:\\Kopie\\app\\pocketbase.exe', port: 8091, sameFolder: false },
				'kein Server' as unknown as SystemStatus['otherServers'][number]
			],
			autostart: 'sometimes' as SystemStatus['autostart']
		});
		expect(parsed.status.restartReasons).toEqual(['hooks', 'migrations']);
		expect(parsed.status.otherServers).toEqual([
			{ pid: 7, path: 'D:\\Kopie\\app\\pocketbase.exe', port: 8091, sameFolder: false }
		]);
		expect(parsed.status.autostart).toBe('off');
	});

	it.each([
		['no object', null],
		['no mail', { appDir: '', status: STATUS }],
		['unknown state', { appDir: '', status: { ...STATUS, state: 'gone' }, mail: {} }],
		['unknown verdict', { appDir: '', status: { ...STATUS, verdict: 'maybe' }, mail: {} }],
		['no port', { appDir: '', status: { ...STATUS, port: 'x' }, mail: {} }]
	])('refuses %s', (_name, raw) => {
		expect(parseOverview(raw)).toBeNull();
	});
});

describe('parseDoctor and parseLogs', () => {
	it('reads the checks and drops unknown levels', () => {
		expect(
			parseDoctor({
				ok: false,
				checks: [
					{ name: 'web', level: 'ok', text: 'Oberfläche gebaut (pb_public)' },
					{ name: 'disk', level: 'error', text: '80 MB frei auf C:\\' },
					{ name: 'x', level: 'loud', text: 'nie' }
				]
			})
		).toEqual({
			ok: false,
			checks: [
				{ name: 'web', level: 'ok', text: 'Oberfläche gebaut (pb_public)' },
				{ name: 'disk', level: 'error', text: '80 MB frei auf C:\\' }
			]
		});
		expect(parseDoctor({ ok: true })).toBeNull();
	});

	it('reads the logs and drops unknown sets and lines that are no text', () => {
		expect(
			parseLogs({
				lines: 200,
				logs: [
					{
						name: 'mail',
						files: [
							{
								file: 'byl-mail.log',
								exists: true,
								sizeBytes: 42,
								modifiedUtc: '2026-09-30T08:00:00Z',
								lines: ['eins', 2, 'drei']
							}
						]
					},
					{ name: 'fremd', files: [] }
				]
			})
		).toEqual({
			lines: 200,
			logs: [
				{
					name: 'mail',
					files: [
						{
							file: 'byl-mail.log',
							exists: true,
							sizeBytes: 42,
							modifiedUtc: '2026-09-30T08:00:00Z',
							lines: ['eins', 'drei']
						}
					]
				}
			]
		});
		expect(parseLogs({ lines: 200 })).toBeNull();
	});
});

describe('denialOf', () => {
	it('takes the reason of the route', () => {
		for (const reason of [
			'platform',
			'loopback',
			'origin',
			'owner',
			'rate',
			'unavailable',
			'busy',
			'script',
			'unknown'
		]) {
			expect(denialOf(403, reason)).toBe(reason);
		}
	});

	it('names a missing route, an admin account and the other statuses without reason', () => {
		expect(denialOf(404, undefined)).toBe('missing');
		expect(denialOf(403, undefined)).toBe('forbidden');
		expect(denialOf(429, undefined)).toBe('rate');
		expect(denialOf(409, 'anything')).toBe('busy');
		expect(denialOf(503, undefined)).toBe('script');
	});

	it('has a text for every refusal but "missing" (the restart hint)', () => {
		for (const text of Object.values(DENIAL_TEXTS)) {
			expect(text.title).not.toBe('');
			expect(text.text).not.toBe('');
		}
	});
});

describe('texts', () => {
	it('says since when the server runs, in Berlin time', () => {
		expect(formatPointInTime('2026-09-30T07:15:42.2143696Z')).toBe('30.09.2026 09:15');
		expect(formatPointInTime('2026-12-01T07:15:00Z')).toBe('01.12.2026 08:15');
		expect(formatPointInTime('gestern')).toBe('');
		expect(formatPointInTime(null)).toBe('');
		expect(stateText(overview().status)).toBe('Läuft seit 30.09.2026 09:15');
		expect(stateText(overview({ startedUtc: null }).status)).toBe('Läuft');
		expect(stateText(overview({ state: 'starting' }).status)).toBe('Startet gerade');
		expect(stateText(overview({ state: 'unhealthy' }).status)).toBe('Läuft, antwortet aber nicht');
		expect(stateText(overview({ state: 'stopped' }).status)).toBe('Läuft nicht');
	});

	it('names the verdict of the start fingerprint', () => {
		expect(verdictText(overview().status)).toBe('Aktuell');
		expect(verdictText(overview({ verdict: 'reload', reload: true }).status)).toBe(
			'Oberfläche neu gebaut: F5 im offenen Tab genügt'
		);
		expect(
			verdictText(overview({ verdict: 'restart', restartReasons: ['migrations', 'hooks'] }).status)
		).toBe('Neustart nötig: neue oder geänderte Migration, geänderte Server-Logik (pb_hooks)');
		expect(restartNeeded(overview({ verdict: 'restart' }).status)).toBe(true);
		expect(restartNeeded(overview({ state: 'unhealthy' }).status)).toBe(true);
		expect(restartNeeded(overview({ verdict: 'reload' }).status)).toBe(false);
	});

	it('says why the mail helper does not run', () => {
		expect(mailText(overview({}, { running: true }))).toEqual({ label: 'Läuft', hint: '' });
		expect(mailText(overview({}, { installed: false, blocker: 'not-installed' })).label).toBe(
			'Nicht installiert'
		);
		expect(mailText(overview({}, { blocker: 'restart' })).hint).toMatch(/nach einem Neustart/);
		expect(mailText(overview({}, { blocker: 'no-mailbox' })).hint).toMatch(/Kein Postfach/);
		expect(mailText(overview({}, { blocker: '' })).hint).toMatch(/Mail-Helfer neu starten/);
	});

	it('names other copies and sizes', () => {
		expect(
			otherServerText({
				pid: 7,
				path: 'D:\\Kopie\\app\\pocketbase.exe',
				port: 8091,
				sameFolder: false
			})
		).toBe('Andere Kopie auf Port 8091 · D:\\Kopie\\app\\pocketbase.exe');
		expect(otherServerText({ pid: 7, path: '', port: null, sameFolder: true })).toBe(
			'Testinstanz dieses Ordners auf andere Adresse'
		);
		expect(sizeText(0)).toBe('0 KB');
		expect(sizeText(1)).toBe('1 KB');
		expect(sizeText(2048)).toBe('2 KB');
		expect(sizeText(3 * 1024 * 1024)).toBe('3,0 MB');
	});

	it('names every reason of a restart in the words of status.bat (byl-control.ps1)', () => {
		const script = readFileSync(
			resolve(import.meta.dirname, '../../../../app/byl-control.ps1'),
			'utf8'
		);
		const block = /\$RestartReasonText = @\{([\s\S]*?)\r?\n\}/.exec(script)?.[1] ?? '';
		const labels = Object.fromEntries(
			[...block.matchAll(/^\s*(\w+)\s*=\s*['"](.*)['"]\s*$/gm)].map((match) => [
				match[1],
				(match[2] ?? '').replace('$BylConfigName', 'byl-config.json')
			])
		);
		expect(Object.keys(labels).sort()).toEqual([...RESTART_REASONS].sort());
		expect(labels).toEqual(RESTART_REASON_LABELS);
	});
});
