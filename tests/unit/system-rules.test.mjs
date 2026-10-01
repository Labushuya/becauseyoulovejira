// Pure rules of the page "Einstellungen → System" (ADR-0043): the whitelist of commands with fixed
// arguments, the checks of this machine, of Host and Origin (CSRF, DNS rebinding) and of the own
// instance of the app folder, the rate limit, the shape of the answers and the cleaning of log lines.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('system-rules.js');

const APP = 'C:\\Apps\\byl #1\\app';
const OWN_ARGS = [
	`${APP}\\pocketbase.exe`,
	'serve',
	'--http=127.0.0.1:8095',
	`--dir=${APP}\\pb_data`,
	`--hooksDir=${APP}\\pb_hooks`,
	'--automigrate=false'
];

describe('whitelist', () => {
	it('knows exactly seven actions of the page and the commands of the backup, each with fixed arguments', () => {
		expect(Object.keys(rules.ACTIONS).sort()).toEqual([
			'autostart-off',
			'autostart-on',
			'backup-configure',
			'backup-export',
			'backup-info',
			'backup-passphrase',
			'backup-restore',
			'backup-verify',
			'doctor',
			'logs',
			'mail-restart',
			'restart',
			'status'
		]);
		expect(rules.ACTIONS.status).toEqual({ method: 'GET', args: ['status', '-Json'], output: true, changes: false });
		expect(rules.ACTIONS.restart).toEqual({ method: 'POST', args: ['restart', '-Detach', '-Quiet'], output: false, changes: true });
		expect(rules.ACTIONS.logs.args).toEqual(['logs', '-Json', '-Lines', '200']);
		// ADR-0046: the commands of the backup take their parameters on standard input only.
		expect(rules.ACTIONS['backup-export']).toEqual({
			method: 'POST',
			args: ['backup-export', '-Json'],
			output: true,
			changes: true,
			input: true,
			backup: true
		});
		// BK-3: the restore starts a process of its own like the restart; its answer is a state file.
		expect(rules.ACTIONS['backup-restore']).toEqual({
			method: 'POST',
			args: ['restore', '-Detach', '-Quiet'],
			output: false,
			changes: true,
			input: true,
			backup: true
		});
		for (const [name, spec] of Object.entries(rules.ACTIONS)) {
			// Commands that start processes never have their output read (the pipe would be inherited).
			if (['restart', 'mail-restart', 'backup-restore'].includes(name)) expect(spec.output, name).toBe(false);
			expect(spec.method, name).toBe(spec.changes ? 'POST' : 'GET');
			expect(spec.backup === true, name).toBe(name.startsWith('backup-'));
			expect(spec.args.every((arg) => /^-?[A-Za-z]+(-[a-z]+)?$|^\d+$/.test(arg)), name).toBe(true);
		}
	});

	it.each(['stop', 'start', 'reset-admin', 'port', 'reload', 'constructor', '__proto__', 'toString', '', null, 42])(
		'runs nothing for %j',
		(name) => {
			expect(rules.action(name)).toBeNull();
			expect(rules.commandLine(APP, name, 'C:\\Windows')).toBeNull();
		}
	);

	it('builds the command line of Windows PowerShell below the system folder, one argument each', () => {
		expect(rules.commandLine(APP, 'status', 'C:\\Windows')).toEqual({
			program: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
			args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `${APP}\\byl-control.ps1`, 'status', '-Json']
		});
		expect(rules.commandLine(APP, 'restart', 'D:\\WINNT\\').program).toBe('D:\\WINNT\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
		for (const root of ['', 'powershell', '..\\x', undefined]) {
			expect(rules.commandLine(APP, 'status', root).program).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
		}
	});
});

describe('refusals', () => {
	it.each([
		['unknown', 404],
		['platform', 404],
		['loopback', 403],
		['origin', 403],
		['owner', 403],
		['rate', 429],
		['unavailable', 503],
		['busy', 409],
		['script', 502]
	])('%s answers %d with message and reason', (reason, status) => {
		const answer = rules.refusal(reason);
		expect(answer.status).toBe(status);
		expect(answer.body).toEqual({ status, message: expect.any(String), reason });
		expect(answer.body.message).not.toBe('');
	});
});

describe('this machine', () => {
	it('needs a loopback peer, a loopback client address and no proxy header', () => {
		expect(rules.isLocal(true, true, ['', '', '', ''])).toBe(true);
		expect(rules.isLocal(false, true, [])).toBe(false);
		expect(rules.isLocal(true, false, [])).toBe(false);
		expect(rules.isLocal(true, true, ['', '203.0.113.5', '', ''])).toBe(false);
		expect(rules.isLocal(true, true, ['for=127.0.0.1'])).toBe(false);
		expect(rules.isLocal('yes', true, [])).toBe(false);
		expect(rules.PROXY_HEADERS).toEqual(['Forwarded', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Real-IP']);
	});
});

describe('address of the app (Host, Origin)', () => {
	it('reads the port of the server from --http', () => {
		expect(rules.listenPort(OWN_ARGS)).toBe(8095);
		expect(rules.listenPort(['pocketbase.exe', 'serve'])).toBe(8090);
		expect(rules.listenPort(['x', '--http=127.0.0.1:1', '--http=127.0.0.1:9000'])).toBe(9000);
		expect(rules.listenPort(['x', '--http=127.0.0.1:99999'])).toBe(8090);
	});

	it('accepts only this machine with the port of the server as Host (no DNS rebinding)', () => {
		for (const host of ['127.0.0.1:8095', 'localhost:8095', 'LOCALHOST:8095', '[::1]:8095']) {
			expect(rules.isOwnHost(host, 8095), host).toBe(true);
		}
		for (const host of ['127.0.0.1:8090', 'evil.example:8095', '127.0.0.1', '127.0.0.2:8095', '127.0.0.1:8095.evil.example', '']) {
			expect(rules.isOwnHost(host, 8095), host).toBe(false);
		}
	});

	it('lets a POST through only with the Origin of the app itself (CSRF)', () => {
		const host = '127.0.0.1:8095';
		expect(rules.isSameOrigin('POST', host, 'http://127.0.0.1:8095', 'same-origin')).toBe(true);
		expect(rules.isSameOrigin('POST', host, 'http://127.0.0.1:8095', '')).toBe(true);
		expect(rules.isSameOrigin('POST', host, '', '')).toBe(false);
		expect(rules.isSameOrigin('POST', host, 'null', '')).toBe(false);
		expect(rules.isSameOrigin('POST', host, 'https://evil.example', 'cross-site')).toBe(false);
		expect(rules.isSameOrigin('POST', host, 'http://localhost:8095', 'same-site')).toBe(false);
		expect(rules.isSameOrigin('POST', host, 'http://127.0.0.1:8096', '')).toBe(false);
		expect(rules.isSameOrigin('POST', host, 'http://127.0.0.1:8095', 'cross-site')).toBe(false);
		expect(rules.isSameOrigin('POST', 'localhost:8095', 'http://localhost:8095', 'same-origin')).toBe(true);
	});

	it('lets a GET through without Origin, but not from another site', () => {
		const host = '127.0.0.1:8095';
		expect(rules.isSameOrigin('GET', host, '', '')).toBe(true);
		expect(rules.isSameOrigin('GET', host, '', 'same-origin')).toBe(true);
		expect(rules.isSameOrigin('GET', host, '', 'cross-site')).toBe(false);
		expect(rules.isSameOrigin('GET', host, '', 'none')).toBe(false);
		expect(rules.isSameOrigin('GET', host, 'https://evil.example', '')).toBe(false);
	});
});

describe('own instance of the app folder', () => {
	it('finds the app folder of the hooks folder', () => {
		expect(rules.appDirOf(`${APP}\\pb_hooks`)).toBe(APP);
		expect(rules.appDirOf(`${APP}\\pb_hooks\\`)).toBe(APP);
		expect(rules.appDirOf('C:/Apps/app/pb_hooks')).toBe('C:\\Apps\\app');
		expect(rules.appDirOf('\\\\server\\share\\app\\pb_hooks')).toBe('\\\\server\\share\\app');
		for (const dir of ['C:\\Temp\\hooks', 'pb_hooks', 'app\\pb_hooks', 'C:\\pb_hooks', '', 'C:\\a\\..\\app\\pb_hooks']) {
			expect(rules.appDirOf(dir), dir).toBe('');
		}
	});

	it('accepts the server only as the own instance of the folder, like Select-AppProcess', () => {
		expect(rules.isOwnInstance(OWN_ARGS, APP)).toBe(true);
		// Windows paths in another case and with slashes name the same folder.
		const otherSpelling = ['c:/apps/BYL #1/app/POCKETBASE.EXE', 'serve', '--http=127.0.0.1:8095', '--dir=C:/Apps/byl #1/app/pb_data/'];
		expect(rules.isOwnInstance(otherSpelling, APP)).toBe(true);
		const variants = {
			'other program': ['C:\\Temp\\pocketbase.exe', ...OWN_ARGS.slice(1)],
			'test harness (temp data)': [OWN_ARGS[0], 'serve', '--http=127.0.0.1:8095', '--dir=C:\\Temp\\byl-test-1\\pb_data'],
			'no serve': [OWN_ARGS[0], 'superuser', 'upsert', `--dir=${APP}\\pb_data`, '--http=127.0.0.1:8095'],
			'all addresses': [OWN_ARGS[0], 'serve', '--http=0.0.0.0:8095', `--dir=${APP}\\pb_data`],
			'no data folder': [OWN_ARGS[0], 'serve', '--http=127.0.0.1:8095'],
			'relative program': ['pocketbase.exe', ...OWN_ARGS.slice(1)],
			'nothing': []
		};
		for (const [name, args] of Object.entries(variants)) {
			expect(rules.isOwnInstance(args, APP), name).toBe(false);
		}
		expect(rules.isOwnInstance(OWN_ARGS, '')).toBe(false);
		expect(rules.isOwnInstance(OWN_ARGS, 'C:\\Apps\\anderer\\app')).toBe(false);
	});
});

describe('rate limit', () => {
	const rule = { limit: 3, windowMs: 60_000 };

	it('lets `limit` requests pass per window, then says when to try again', () => {
		let entry;
		const now = 1_790_000_000_000;
		for (let i = 0; i < 3; i++) {
			const step = rules.rateStep(entry, now + i, rule);
			expect(step.allowed).toBe(true);
			entry = step.entry;
		}
		const refused = rules.rateStep(entry, now + 30_000, rule);
		expect(refused).toMatchObject({ allowed: false, retryAfterSeconds: 30 });
		expect(rules.rateStep(refused.entry, now + 60_000, rule).allowed).toBe(true);
	});

	it('starts again after a broken entry or a clock that went back', () => {
		expect(rules.rateStep('kaputt', 1000, rule).allowed).toBe(true);
		const full = JSON.stringify({ start: 5000, count: 3 });
		expect(rules.rateStep(full, 4000, rule).allowed).toBe(true);
	});

	it('limits reading and actions per user and minute', () => {
		expect(rules.RATE_LIMITS).toEqual({ read: { limit: 30, windowMs: 60_000 }, change: { limit: 10, windowMs: 60_000 } });
	});

	it('refuses a second restart while one runs', () => {
		expect(rules.restartPending(1000, 1000 + rules.RESTART_PENDING_MS - 1)).toBe(true);
		expect(rules.restartPending(1000, 1000 + rules.RESTART_PENDING_MS)).toBe(false);
		expect(rules.restartPending(undefined, 1000)).toBe(false);
		expect(rules.restartPending(5000, 1000)).toBe(false);
	});
});

describe('answers', () => {
	const STATUS = {
		state: 'running',
		pid: 4321,
		port: 8095,
		configuredPort: 8095,
		url: 'http://127.0.0.1:8095/',
		startedUtc: '2026-09-30T07:15:42.2143696Z',
		verdict: 'restart',
		restartReasons: ['hooks', 'geheimnis'],
		reloadReasons: ['web'],
		mailHelperPid: null,
		portOwner: null,
		otherServers: [{ pid: 9, path: 'D:\\Kopie\\app\\pocketbase.exe', port: 8090, sameFolder: false }, 'x'],
		autostart: 'other',
		exitCode: 6,
		extra: 'weg'
	};

	it('passes the known fields of status -Json on', () => {
		expect(rules.statusView(STATUS)).toEqual({
			state: 'running',
			pid: 4321,
			port: 8095,
			configuredPort: 8095,
			url: 'http://127.0.0.1:8095/',
			startedUtc: '2026-09-30T07:15:42.2143696Z',
			verdict: 'restart',
			restartReasons: ['hooks'],
			reload: true,
			mailHelperPid: null,
			portOwner: null,
			otherServers: [{ pid: 9, path: 'D:\\Kopie\\app\\pocketbase.exe', port: 8090, sameFolder: false }],
			autostart: 'other'
		});
		expect(rules.statusView({ ...STATUS, state: 'weg' })).toBeNull();
		expect(rules.statusView(null)).toBeNull();
		expect(rules.statusView([])).toBeNull();
	});

	it('passes the checks of doctor -Json on', () => {
		expect(
			rules.doctorView({
				appDir: APP,
				ok: true,
				checks: [
					{ name: 'web', level: 'ok', text: 'Oberfläche gebaut (pb_public)' },
					{ name: 'x', level: 'laut', text: 'nie' },
					'kaputt'
				]
			})
		).toEqual({ ok: true, checks: [{ name: 'web', level: 'ok', text: 'Oberfläche gebaut (pb_public)' }] });
		expect(rules.doctorView({ ok: true })).toBeNull();
	});

	it('passes the logs on and cleans every line', () => {
		const view = rules.logsView(
			{
				lines: 5,
				logs: [
					{ name: 'mail', files: [{ file: 'byl-mail.log', exists: true, sizeBytes: 12, modifiedUtc: '2026-09-30T08:00:00Z', lines: ['eins', 2, 'zwei'] }] },
					{ name: 'fremd', files: [] }
				]
			},
			(line) => line.toUpperCase()
		);
		expect(view).toEqual({
			lines: 200,
			logs: [{ name: 'mail', files: [{ file: 'byl-mail.log', exists: true, sizeBytes: 12, modifiedUtc: '2026-09-30T08:00:00Z', lines: ['EINS', 'ZWEI'] }] }]
		});
		expect(rules.logsView({}, (line) => line)).toBeNull();
	});

	it('masks e-mail addresses, Bearer values, access keys and tokens in log lines', () => {
		const key = `byl_${'A1b2C3d4E5'.repeat(4)}`;
		expect(rules.maskLogLine('Absender anna.beispiel+test@mail.example.com und bob@example.org')).toBe(
			'Absender ***@mail.example.com und ***@example.org'
		);
		expect(rules.maskLogLine('Authorization: Bearer abc.DEF-123_=')).toBe('Authorization: Bearer ***');
		expect(rules.maskLogLine(`Schlüssel ${key} benutzt`)).toBe('Schlüssel *** benutzt');
		expect(rules.maskLogLine('Token eyJhbGciOiJIUzI1.eyJ0eXBlIjoiYXV0aCJ9.c2lnbmF0dXJlLXRlc3Q ende')).toBe('Token *** ende');
		expect(rules.maskLogLine('nichts zu verbergen, byl_kurz')).toBe('nichts zu verbergen, byl_kurz');
	});

	it('says why the mail helper does not run', () => {
		expect(rules.mailBlocker({ installed: false, tokenSet: true, mailboxes: 2 })).toBe('not-installed');
		expect(rules.mailBlocker({ installed: true, tokenSet: false, mailboxes: 2 })).toBe('restart');
		expect(rules.mailBlocker({ installed: true, tokenSet: true, mailboxes: 0 })).toBe('no-mailbox');
		expect(rules.mailBlocker({ installed: true, tokenSet: true, mailboxes: 1 })).toBe('');
		expect(rules.mailBlocker(null)).toBe('not-installed');
	});
});
