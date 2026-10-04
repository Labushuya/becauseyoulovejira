// Access in the home network through the control script (plan docs/plan/heimnetz.md, ADR-0055
// addendum) against a disposable copy of the app folder: the routes of the page "Sicherheit" run the
// real byl-control.ps1 of the copy (lan-info, lan-configure, lan-firewall), byl-config.json and the
// fingerprint follow, status and doctor name the firewall rule and the network, and the console says
// the same. The network of the copy is a file of this test (BYL_TEST_NETWORK_FILE), and a copy never
// changes the firewall: lan-firewall writes its request into BYL_TEST_FIREWALL_FILE of the test and
// asks nobody for administrator rights, without the file it refuses; what Windows would answer is
// the field elevation of the network file, the rule read again afterwards its firewall. Everything
// happens ONLY in a
// copy under .tmp\byl-lan-* of the repo, with a superuser created beforehand (CLAUDE.md §11.2), a
// random port and a clean environment with BYL_TEST_ISOLATED=1. Only in the CI does the copy also
// start on 0.0.0.0 (on a developer machine Windows would show its firewall alert); app\ and the
// instance of the user are never started, stopped or asked.

import { randomBytes } from 'node:crypto';
import {
	closeSync,
	copyFileSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSyncClean } from '../support/clean-env.mjs';
import { POCKETBASE_EXE } from '../support/pocketbase-harness.mjs';
import { POWERSHELL_EXE, runPowerShellJson } from '../support/powershell.mjs';
import { scaled } from '../support/timing.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP_DIR = join(ROOT_DIR, 'app');
const TEMP_ROOT = join(ROOT_DIR, '.tmp');
// 8090 and 8091: app and mail helper of the user; 8099: spikes.
const RESERVED_PORTS = new Set([8090, 8091, 8099]);
const COMMAND_TIMEOUT_MS = scaled(60_000);
const ADDRESS = '192.168.178.20';
const NAME = 'testrechner.fritz.box';

let base;
let copy;
let owner;
let other;
let superuserToken;
let CONTROL_ENV;
let networkFile;
let firewallFile;

async function freePort() {
	for (;;) {
		const probe = createServer();
		await new Promise((done) => probe.listen(0, '127.0.0.1', done));
		const { port } = probe.address();
		await new Promise((done) => probe.close(done));
		if (!RESERVED_PORTS.has(port)) return port;
	}
}

/** One HTTP request to the copy on 127.0.0.1; the body parsed as JSON when it is JSON. */
function call(method, path, { token, body } = {}) {
	return new Promise((done, fail) => {
		const data = body === undefined ? undefined : JSON.stringify(body);
		const req = request(
			{
				host: '127.0.0.1',
				port: copy.port,
				path,
				method,
				agent: false,
				timeout: scaled(90_000),
				headers: {
					...(token ? { Authorization: token } : {}),
					...(method === 'POST' ? { Origin: `http://127.0.0.1:${copy.port}` } : {}),
					...(data ? { 'Content-Type': 'application/json' } : {})
				}
			},
			(response) => {
				let text = '';
				response.setEncoding('utf8');
				response.on('data', (chunk) => (text += chunk));
				response.on('end', () => {
					let parsed = text;
					try {
						parsed = JSON.parse(text);
					} catch {
						// not JSON
					}
					done({ status: response.statusCode, body: parsed });
				});
			}
		);
		req.once('timeout', () => req.destroy(new Error(`timeout ${method} ${path}`)));
		req.once('error', fail);
		if (data) req.write(data);
		req.end();
	});
}

const app = (method, path, options = {}) => call(method, path, { token: owner.token, ...options });

let outputs = 0;

/** byl-control.ps1 of the copy, never without -NoBrowser, with a clean environment. */
function control(args, env = CONTROL_ENV) {
	outputs += 1;
	const file = join(base, `output-${outputs}.txt`);
	const fd = openSync(file, 'w');
	let result;
	try {
		result = spawnSyncClean(
			POWERSHELL_EXE,
			['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(copy.dir, 'byl-control.ps1'), ...args, '-NoBrowser'],
			{ windowsHide: true, timeout: COMMAND_TIMEOUT_MS, stdio: ['ignore', fd, fd], env }
		);
	} finally {
		closeSync(fd);
	}
	if (result.error) throw result.error;
	return { code: result.status, output: readFileSync(file, 'latin1') };
}

/** Processes whose program lies below the temp base of this file. */
function servers() {
	return runPowerShellJson(
		String.raw`
$base = $env:BYL_TEST_INPUT | ConvertFrom-Json
$found = @(Get-CimInstance -ClassName Win32_Process |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase) -and $_.Name -eq 'pocketbase.exe' } |
    ForEach-Object { @{ pid = [int]$_.ProcessId; commandLine = $_.CommandLine } })
ConvertTo-Json -InputObject $found -Compress`,
		base
	);
}

/**
 * The network of the copy (BYL_TEST_NETWORK_FILE): one adapter in a public network, a FRITZ!Box name,
 * the rules of the firewall (`unreadable`: Windows does not tell them) and what Windows answers a
 * change of the rule (`elevation`, 'done' without it).
 */
function writeNetwork(rules = [], { elevation, unreadable = false } = {}) {
	writeFileSync(
		networkFile,
		JSON.stringify({
			addresses: [
				{ IPAddress: '127.0.0.1', InterfaceIndex: 1, InterfaceAlias: 'Loopback Pseudo-Interface 1', AddressState: 'Preferred' },
				{ IPAddress: ADDRESS, InterfaceIndex: 8, InterfaceAlias: 'Ethernet', AddressState: 'Preferred' }
			],
			profiles: [{ InterfaceIndex: 8, NetworkCategory: 'Public' }],
			suffixes: [{ InterfaceIndex: 8, ConnectionSpecificSuffix: 'fritz.box' }],
			hostName: 'Testrechner',
			firewall: unreadable ? null : { rules, blocks: [] },
			...(elevation === undefined ? {} : { elevation })
		})
	);
}

/** The rule of the button as the firewall of the copy names it. */
const ownRule = () => ({
	Enabled: 'True',
	Direction: 'Inbound',
	Action: 'Allow',
	Profile: 'Private',
	Program: copy.program,
	Protocol: 'TCP',
	LocalPort: [String(copy.port)]
});

async function authToken(collection, email, password) {
	const answer = await call('POST', `/api/collections/${collection}/auth-with-password`, { body: { identity: email, password } });
	if (answer.status !== 200) throw new Error(`sign-in failed (${answer.status})`);
	return answer.body.token;
}

async function createUser() {
	const email = `lan-${randomBytes(6).toString('hex')}@example.com`;
	const password = randomBytes(18).toString('base64url');
	const created = await call('POST', '/api/collections/users/records', {
		token: superuserToken,
		body: { email, password, passwordConfirm: password }
	});
	if (created.status !== 200) throw new Error(`user not created (${created.status})`);
	return { id: created.body.id, token: await authToken('users', email, password) };
}

const config = () => JSON.parse(readFileSync(join(copy.dir, 'byl-config.json'), 'utf8'));

beforeAll(async () => {
	// Not in %TEMP%: PocketBase takes a program there for "go run" and switches to its dev mode.
	mkdirSync(TEMP_ROOT, { recursive: true });
	base = realpathSync.native(mkdtempSync(join(TEMP_ROOT, 'byl-lan-')));
	// Guard: everything happens below .tmp of this worktree, never in app\ of this or another folder.
	expect(base.toLowerCase().startsWith(`${realpathSync.native(TEMP_ROOT).toLowerCase()}\\byl-lan-`)).toBe(true);
	expect(base.toLowerCase().startsWith(APP_DIR.toLowerCase())).toBe(false);
	const dir = join(base, "Kopie O'Heim", 'app');
	mkdirSync(join(dir, 'pb_public'), { recursive: true });
	for (const file of ['byl-control.ps1', 'byl-functions.ps1', 'byl-problems.ps1']) copyFileSync(join(APP_DIR, file), join(dir, file));
	copyFileSync(POCKETBASE_EXE, join(dir, 'pocketbase.exe'));
	cpSync(join(APP_DIR, 'pb_hooks'), join(dir, 'pb_hooks'), { recursive: true });
	cpSync(join(APP_DIR, 'pb_migrations'), join(dir, 'pb_migrations'), { recursive: true });
	writeFileSync(join(dir, 'pb_public', 'index.html'), '<!doctype html><title>test</title>');
	const port = await freePort();
	writeFileSync(join(dir, 'byl-config.json'), JSON.stringify({ port }));
	networkFile = join(base, 'netzwerk.json');
	firewallFile = join(base, 'firewall-anfrage.json');
	writeNetwork();
	CONTROL_ENV = {
		BYL_TEST_ISOLATED: '1',
		BYL_TEST_STARTUP_DIR: join(base, 'startup'),
		BYL_TEST_NETWORK_FILE: networkFile,
		BYL_TEST_FIREWALL_FILE: firewallFile
	};
	mkdirSync(CONTROL_ENV.BYL_TEST_STARTUP_DIR);
	const email = `lan-${randomBytes(6).toString('hex')}@example.com`;
	const password = randomBytes(18).toString('base64');
	const upsert = spawnSyncClean(
		join(dir, 'pocketbase.exe'),
		['superuser', 'upsert', `--dir=${join(dir, 'pb_data')}`, `--hooksDir=${join(dir, 'pb_hooks')}`, `--migrationsDir=${join(dir, 'pb_migrations')}`, '--automigrate=false', email, password],
		{ encoding: 'utf8', windowsHide: true, timeout: scaled(60_000) }
	);
	if (upsert.status !== 0) throw new Error(`superuser upsert failed (exit code ${upsert.status})`);
	copy = { dir, port, program: join(dir, 'pocketbase.exe') };
	const started = control(['start']);
	if (started.code !== 0) throw new Error(`start failed: ${started.output}`);
	superuserToken = await authToken('_superusers', email, password);
	// The account created first owns the instance (ADR-0043 §3).
	owner = await createUser();
	other = await createUser();
});

afterAll(() => {
	if (copy) control(['stop']);
	for (const left of base ? servers() : []) {
		try {
			process.kill(left.pid);
		} catch {
			// gone already
		}
	}
	if (base) rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
});

// The cases build on each other and run in this order.
const CASE_TIMEOUT = { timeout: scaled(120_000) };

describe('home network on a disposable copy (plan heimnetz)', CASE_TIMEOUT, () => {
	it('names the addresses of the computer, the network and the missing rule with the commands by hand', async () => {
		const answer = await app('GET', '/api/byl/security/lan');
		expect(answer.status, JSON.stringify(answer.body)).toBe(200);
		expect(answer.body.lan).toEqual({
			port: copy.port,
			enabled: false,
			addresses: [],
			max: 5,
			network: true,
			candidates: [
				{ address: ADDRESS, kind: 'ip', adapter: 'Ethernet', category: 'public' },
				{ address: NAME, kind: 'name', adapter: 'Ethernet', category: 'public' }
			],
			states: [],
			firewall: {
				state: 'missing',
				blocked: false,
				rule: 'becauseyoulovejira (Heimnetz)',
				program: copy.program,
				add: `netsh advfirewall firewall add rule name="becauseyoulovejira (Heimnetz)" dir=in action=allow protocol=TCP localport=${copy.port} program="${copy.program}" profile=private`,
				remove: `netsh advfirewall firewall delete rule name="becauseyoulovejira (Heimnetz)" program="${copy.program}"`
			}
		});
		// Only the administrator of the app (ADR-0056); the reason keeps its name "owner".
		expect((await call('GET', '/api/byl/security/lan', { token: other.token })).body.reason).toBe('owner');
	});

	it('switches it on in byl-config.json; status names the restart, the rule and the public network', async () => {
		const refused = await app('POST', '/api/byl/security/lan', { body: { enabled: true, addresses: ['8.8.8.8'] } });
		expect([refused.status, refused.body.problem, refused.body.invalid]).toEqual([400, 'invalid', ['8.8.8.8']]);
		const saved = await app('POST', '/api/byl/security/lan', { body: { enabled: true, addresses: [ADDRESS, NAME] } });
		expect(saved.status, JSON.stringify(saved.body)).toBe(200);
		expect(saved.body.lan).toMatchObject({ enabled: true, addresses: [ADDRESS, NAME] });
		expect(saved.body.lan.states).toEqual([
			{ address: ADDRESS, present: true, adapter: 'Ethernet', category: 'public' },
			{ address: NAME, present: null, adapter: '', category: 'unknown' }
		]);
		expect(config()).toEqual({ port: copy.port, network: { lan: { enabled: true, addresses: [ADDRESS, NAME] } } });
		const status = await app('GET', '/api/byl/system');
		expect(status.body.status).toMatchObject({ verdict: 'restart', restartReasons: ['lan'] });
		expect(status.body.status.lan).toEqual({
			enabled: true,
			addresses: [ADDRESS, NAME],
			bound: false,
			hosts: [],
			urls: [],
			firewall: 'missing',
			blocked: false,
			networks: [
				{ address: ADDRESS, present: true, adapter: 'Ethernet', category: 'public' },
				{ address: NAME, present: null, adapter: '', category: 'unknown' }
			]
		});
		// status.bat says the same in words, the public network as a warning.
		const words = control(['status']);
		expect(words.code).toBe(6);
		expect(words.output).toMatch(/Heimnetz: +an \(gilt nach einem Neustart\)/);
		expect(words.output).toContain(`http://${ADDRESS}:${copy.port}/`);
		expect(words.output).toMatch(/Firewall: +Regel fehlt/);
		expect(words.output).toMatch(/Netzwerk: +Ethernet \(192\.168\.178\.20\): /);
		expect(words.output).toContain('Achtung: Das Netzwerk ist in Windows nicht als');
		expect(words.output).toContain('lan-firewall add');
		const doctor = await app('GET', '/api/byl/system/doctor');
		const lanChecks = doctor.body.checks.filter((check) => check.name.startsWith('lan'));
		expect(lanChecks.map((check) => [check.name, check.level, check.report?.code ?? null])).toEqual([
			['lan', 'info', null],
			['lan-firewall', 'warning', 'lan-firewall-missing'],
			['lan-network', 'warning', 'lan-profile']
		]);
		const profile = lanChecks.find((check) => check.name === 'lan-network').report;
		expect(profile.problem).toContain('ist in Windows als „Öffentlich“ eingestuft');
		expect(profile.remedy.command).toBe('powershell -NoProfile -Command "Set-NetConnectionProfile -InterfaceIndex 8 -NetworkCategory Private"');
		const firewall = lanChecks.find((check) => check.name === 'lan-firewall').report;
		expect(firewall.remedy.command).toBe(saved.body.lan.firewall.add);
	});

	it('creates the rule only as a request to the test and reports it only once the rule is read back (regression)', async () => {
		// Windows reports success, but the firewall names no rule afterwards: no success on the page.
		writeNetwork([]);
		const unconfirmed = await app('POST', '/api/byl/security/lan/firewall', { body: { action: 'add' } });
		expect(unconfirmed.status, JSON.stringify(unconfirmed.body)).toBe(200);
		expect(unconfirmed.body.result).toMatchObject({ ok: false, action: 'add', outcome: 'unconfirmed' });
		expect(unconfirmed.body.result.report).toMatchObject({ code: 'lan-firewall-unconfirmed', level: 'error' });
		expect(unconfirmed.body.result.report.problem).toBe(
			'Die Firewall-Regel „becauseyoulovejira (Heimnetz)“ ist nicht angelegt, obwohl Windows die Änderung gemeldet hat: die Firewall nennt keine passende Regel.'
		);
		const add = `netsh advfirewall firewall add rule name="becauseyoulovejira (Heimnetz)" dir=in action=allow protocol=TCP localport=${copy.port} program="${copy.program}" profile=private`;
		expect(unconfirmed.body.result.report.remedy.command).toBe(add);
		expect(unconfirmed.body.lan.firewall).toMatchObject({ state: 'missing', add });
		const asked = JSON.parse(readFileSync(firewallFile, 'utf8'));
		expect(asked).toMatchObject({ action: 'add', port: copy.port, program: copy.program });
		const encoded = /-EncodedCommand ([A-Za-z0-9+/=]+)$/.exec(asked.arguments)[1];
		const script = Buffer.from(encoded, 'base64').toString('utf16le');
		expect(script).toContain(`$program = '${copy.program.replace(/'/g, "''")}'`);
		expect(script).toContain(`dir=in action=allow protocol=TCP localport=${copy.port} "program=$program" profile=private`);

		// The rule is there afterwards: done, and the page shows it present.
		writeNetwork([ownRule()]);
		const done = await app('POST', '/api/byl/security/lan/firewall', { body: { action: 'add' } });
		expect(done.body.result).toEqual({ ok: true, action: 'add', outcome: 'done', report: null });
		expect(done.body.lan.firewall.state).toBe('present');
		expect((await app('POST', '/api/byl/security/lan/firewall', { body: { action: 'öffnen' } })).body.problem).toBe('action');

		// Without the file of the test the copy refuses, from the console as from the page.
		const env = { ...CONTROL_ENV };
		delete env.BYL_TEST_FIREWALL_FILE;
		const refused = control(['lan-firewall', 'add'], env);
		expect(refused.code).toBe(1);
		expect(refused.output).toContain('Diese Testkopie');
	});

	it('tells declined, no answer, not possible and an error of netsh apart, each with the command by hand and the state read again', async () => {
		const add = `netsh advfirewall firewall add rule name="becauseyoulovejira (Heimnetz)" dir=in action=allow protocol=TCP localport=${copy.port} program="${copy.program}" profile=private`;
		const problems = {
			cancelled: 'wurde nicht angelegt: Die Anfrage nach Administratorrechten wurde abgelehnt oder abgebrochen.',
			timeout: 'wurde nicht angelegt: Windows hat binnen 120 s nicht geantwortet.',
			unavailable: 'wurde nicht angelegt: Windows kann hier nicht nach Administratorrechten fragen (Testkopie).',
			failed: 'wurde nicht angelegt: netsh hat einen Fehler gemeldet (Code 1).'
		};
		const answers = {};
		for (const [elevation, problem] of Object.entries(problems)) {
			writeNetwork([], { elevation });
			const answer = await app('POST', '/api/byl/security/lan/firewall', { body: { action: 'add' } });
			expect(answer.status, elevation).toBe(200);
			expect(answer.body.result, elevation).toMatchObject({ ok: false, action: 'add', outcome: elevation });
			expect(answer.body.result.report.code, elevation).toBe(`lan-firewall-${elevation}`);
			expect(answer.body.result.report.problem, elevation).toContain(problem);
			expect(answer.body.result.report.remedy.command, elevation).toBe(add);
			expect(answer.body.lan.firewall.state, elevation).toBe('missing');
			answers[elevation] = answer.body.result.report;
		}
		// Not possible: the steps name the prompt "as administrator", Enter and checking again.
		expect(answers.unavailable.remedy.steps.join(' ')).toMatch(/Als Administrator ausführen.*mit Enter bestätigen.*Zustand neu prüfen/);

		// Remove (in the console: the route allows ten changes a minute): done only when the rule is
		// gone afterwards; a firewall that cannot be read is no success. Console text without umlauts:
		// it comes in the code page of the console.
		const remove = `netsh advfirewall firewall delete rule name="becauseyoulovejira (Heimnetz)" program="${copy.program}"`;
		writeNetwork([ownRule()]);
		const kept = control(['lan-firewall', 'remove']);
		expect(kept.code).toBe(1);
		expect(kept.output.replace(/\s+/g, ' ')).toContain('ist nicht entfernt, obwohl Windows die');
		expect(kept.output.replace(/\s+/g, ' ')).toContain('die Regel besteht weiter.');
		expect(kept.output).toContain(remove);
		writeNetwork([], { unreadable: true });
		const blind = control(['lan-firewall', 'remove']);
		expect(blind.code).toBe(1);
		expect(blind.output.replace(/\s+/g, ' ')).toContain('sich nicht lesen');
		writeNetwork([]);
		const removed = control(['lan-firewall', 'remove']);
		expect(removed.code, removed.output).toBe(0);
		expect(removed.output).toContain('entfernt.');

		// Add in the console says the same: the entry with the command, exit code 1; done only when it is so.
		writeNetwork([], { elevation: 'cancelled' });
		const declined = control(['lan-firewall', 'add']);
		expect(declined.code).toBe(1);
		// The problem wraps in the console; the command never does.
		expect(declined.output.replace(/\s+/g, ' ')).toContain(
			'wurde nicht angelegt: Die Anfrage nach Administratorrechten wurde abgelehnt oder abgebrochen.'
		);
		expect(declined.output).toContain(add);
		writeNetwork([ownRule()]);
		const created = control(['lan-firewall', 'add']);
		expect(created.code, created.output).toBe(0);
		expect(created.output).toContain('angelegt: nur pocketbase.exe dieses Ordners');
		writeNetwork([]);
	});

	it('reads a rule that is there, and says so in status and doctor', async () => {
		writeNetwork([
			{ Enabled: 'True', Direction: 'Inbound', Action: 'Allow', Profile: 'Private', Program: copy.program, Protocol: 'TCP', LocalPort: [String(copy.port)] }
		]);
		const status = await app('GET', '/api/byl/system');
		expect(status.body.status.lan.firewall).toBe('present');
		const doctor = await app('GET', '/api/byl/system/doctor');
		expect(doctor.body.checks).toContainEqual({
			name: 'lan-firewall',
			level: 'ok',
			text: 'Firewall-Regel „becauseyoulovejira (Heimnetz)“ vorhanden',
			report: null
		});
	});

	it('changes nothing for a wrong address in the console, switches off with the addresses kept', () => {
		const wrong = control(['lan-configure', '8.8.8.8']);
		expect(wrong.code).toBe(1);
		expect(wrong.output).toContain('ist ung');
		expect(config().network.lan.enabled).toBe(true);
		const info = control(['lan-info']);
		expect(info.code).toBe(0);
		expect(info.output).toContain('Zugriff im Heimnetz');
		expect(info.output).toContain(`http://${ADDRESS}:${copy.port}/`);
		const off = control(['lan-configure', 'off']);
		expect(off.code, off.output).toBe(0);
		expect(config().network).toEqual({ lan: { enabled: false, addresses: [ADDRESS, NAME] } });
		const log = readFileSync(join(copy.dir, 'logs', 'byl-control.log'), 'utf8');
		expect(log).toMatch(/ lan-configure exit=0 lan=on addresses=2\r$/m);
		// Switched off while the rule is still there: the hint of the catalog that it is left over.
		expect(log).toMatch(/ lan-configure exit=0 lan=off problem=lan-firewall-leftover\r$/m);
		expect(off.output).toContain('besteht aber noch');
		// Every change names what Windows said, the state read again and the outcome, never a value.
		expect(log).toMatch(/ lan-firewall exit=0 firewall=add elevation=done state=present outcome=done\r$/m);
		expect(log).toMatch(/ lan-firewall exit=1 firewall=add elevation=done state=missing outcome=unconfirmed problem=lan-firewall-unconfirmed\r$/m);
		expect(log).toMatch(/ lan-firewall exit=1 firewall=add elevation=cancelled state=missing outcome=cancelled problem=lan-firewall-cancelled\r$/m);
		expect(log).toMatch(/ lan-firewall exit=1 firewall=remove elevation=done state=unknown outcome=unconfirmed problem=lan-firewall-unconfirmed\r$/m);
	});

	it.skipIf(process.env.CI !== 'true')('starts on 0.0.0.0 with the home network, is its own instance there and stops (CI only)', async () => {
		writeNetwork();
		expect(control(['lan-configure', ADDRESS]).code).toBe(0);
		const restarted = control(['restart']);
		expect(restarted.code, restarted.output).toBe(0);
		try {
			const [server] = servers();
			expect(server.commandLine).toContain(`--http=0.0.0.0:${copy.port}`);
			expect(server.commandLine).toContain(`http://${ADDRESS}:${copy.port}`);
			const status = await app('GET', '/api/byl/system');
			expect(status.body.status).toMatchObject({ state: 'running', pid: server.pid, verdict: 'current' });
			expect(status.body.status.lan).toMatchObject({ enabled: true, bound: true, urls: [`http://${ADDRESS}:${copy.port}/`] });
		} finally {
			expect(control(['lan-configure', 'off']).code).toBe(0);
			const back = control(['restart']);
			expect(back.code, back.output).toBe(0);
		}
		const [server] = servers();
		expect(server.commandLine).toContain(`--http=127.0.0.1:${copy.port}`);
	});
});
