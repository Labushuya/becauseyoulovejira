// The catalog of the problems of the scripts (ADR-0048, plan robuste-skripte RS-1): every way a
// script fails is an entry of app/byl-problems.ps1 with cause, steps and, where one exists, a command
// with the real paths of the machine; the scripts report only through it; the .bat files and
// start-hidden.vbs say the same in ASCII. The static parts run everywhere, the functions of
// byl-problems.ps1 in Windows PowerShell only. The scripts themselves run against disposable copies
// in tests/integration/control-script.test.mjs.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { SCRIPT_PROBLEMS, commandTemplate, fillText, helpValues } from '../../web/src/lib/domain/script-problems.ts';
import { runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP_DIR = join(ROOT_DIR, 'app');
const SCRIPTS_DIR = join(ROOT_DIR, 'scripts');
const read = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '');

const CATALOG_FILE = join(APP_DIR, 'byl-problems.ps1');
const CONTROL = read(join(APP_DIR, 'byl-control.ps1'));
const BUILD_SCRIPTS = Object.fromEntries(
	readdirSync(SCRIPTS_DIR)
		.filter((name) => name.endsWith('.ps1'))
		.map((name) => [name, read(join(SCRIPTS_DIR, name))])
);
const WRAPPERS = readdirSync(APP_DIR).filter((name) => name.endsWith('.bat') && name !== 'byl-pruefen.bat');

const STRING = "'((?:[^']|'')*)'";
const unquote = (text) => text.replaceAll("''", "'");

/** The entries of the catalog: code -> { exit, level, faq, problem, cause, steps, command, offer }. */
function parseCatalog(source) {
	const entries = {};
	for (const [, code, body] of source.matchAll(/^ {4}'([a-z0-9-]+)'\s*=\s*@\{\r?\n([\s\S]*?)\r?\n {4}\}/gm)) {
		const text = (name) => {
			const match = new RegExp(`^ {8}${name}\\s*=\\s*${STRING}\\r?$`, 'm').exec(body);
			return match === null ? undefined : unquote(match[1]);
		};
		const steps = /^ {8}Steps\s*=\s*@\(\r?\n([\s\S]*?)\r?\n {8}\)/m.exec(body);
		entries[code] = {
			exit: Number(/^ {8}Exit\s*=\s*(\d+)\r?$/m.exec(body)?.[1]),
			level: text('Level'),
			faq: text('Faq'),
			problem: text('Problem'),
			cause: text('Cause'),
			steps: steps === null ? [] : [...steps[1].matchAll(new RegExp(STRING, 'g'))].map((match) => unquote(match[1])),
			command: text('Command'),
			offer: text('Offer')
		};
	}
	return entries;
}

/** The PowerShell statement from `start`: up to the line break outside brackets without a backtick. */
function statementAt(source, start) {
	let depth = 0;
	for (let index = start; index < source.length; index += 1) {
		const char = source[index];
		if ('([{'.includes(char)) depth += 1;
		if (')]}'.includes(char)) depth -= 1;
		if (char === '\n' && depth <= 0 && !/`\r?$/.test(source.slice(start, index))) return source.slice(start, index).trim();
	}
	return source.slice(start).trim();
}

const CATALOG = parseCatalog(read(CATALOG_FILE));
const CODES = Object.keys(CATALOG);

// Placeholders every command may use (Get-BylProblemValues), and those a call fills.
const GLOBAL_VALUES = ['app', 'appq', 'control', 'log', 'tail', 'root', 'build', 'fetch'];
const CALL_VALUES = ['port', 'next', 'command', 'folder', 'nodeDir', 'rerun'];

describe('the catalog (app/byl-problems.ps1)', () => {
	it('has every entry complete: exit code, level, problem, cause and at least one step', () => {
		expect(CODES.length).toBeGreaterThan(90);
		for (const [code, entry] of Object.entries(CATALOG)) {
			expect([0, 1, 2, 3, 4, 5, 6], code).toContain(entry.exit);
			expect(['error', 'warning'], code).toContain(entry.level);
			for (const field of ['faq', 'problem', 'cause', 'command', 'offer']) expect(typeof entry[field], `${code}.${field}`).toBe('string');
			expect(entry.problem, code).not.toBe('');
			expect(entry.cause, code).not.toBe('');
			expect(entry.steps.length, code).toBeGreaterThan(0);
			// A hint lets the command go on; an error ends it with a code other than 0.
			if (entry.exit === 0) expect(entry.level, code).toBe('warning');
			if (entry.level === 'error') expect(entry.exit, code).not.toBe(0);
		}
	});

	it('keeps the exit codes of ADR-0039: 3 not running, 4 port busy, 5 no answer, 1 for every other error', () => {
		const special = { 'not-running': 3, 'mail-not-running': 3, 'port-busy': 4, 'health-timeout': 5, 'app-unhealthy': 5 };
		for (const [code, entry] of Object.entries(CATALOG)) {
			// "Abgebrochen" is no error, but the restore did not happen (1, as before).
			const expected = special[code] ?? (entry.level === 'warning' && code !== 'restore-cancel' ? 0 : 1);
			expect(entry.exit, code).toBe(expected);
		}
	});

	it('offers to solve a problem only with a command next to it and as a question for J or N', () => {
		const offers = Object.entries(CATALOG).filter(([, entry]) => entry.offer !== '');
		expect(offers.map(([code]) => code).sort()).toEqual(['app-unhealthy', 'config-json', 'config-port', 'mail-not-running', 'not-running', 'port-busy']);
		for (const [code, entry] of offers) {
			expect(entry.command, code).not.toBe('');
			expect(entry.offer, code).toMatch(/^Soll ich .+\? \(J\/N\)$/);
		}
	});

	it('builds commands only from known placeholders and names no path of a machine', () => {
		for (const [code, entry] of Object.entries(CATALOG)) {
			for (const [, name] of entry.command.matchAll(/\{([a-z][A-Za-z0-9]*)\}/g)) {
				expect([...GLOBAL_VALUES, ...CALL_VALUES], `${code}: {${name}}`).toContain(name);
			}
			for (const text of [entry.problem, entry.cause, ...entry.steps, entry.command, entry.offer, entry.faq]) {
				expect(text, code).not.toMatch(/\b[A-Za-z]:[\\/]/);
			}
		}
	});

	it('is used: every entry by a script, every code of a script from the catalog', () => {
		const sources = [CONTROL, ...Object.values(BUILD_SCRIPTS), read(join(APP_DIR, 'byl-pruefen.bat')), read(join(APP_DIR, 'start-hidden.vbs'))].join('\n');
		// The entries of the passphrase are passphrase-<code of the app> ($PassphraseProblemCode).
		const passphrase = /\$PassphraseProblemCode = @\{([^}]*)\}/.exec(CONTROL)[1];
		const used = new Set([
			...[...sources.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((match) => match[1]),
			...[...passphrase.matchAll(/'([a-z-]+)'/g)].map((match) => `passphrase-${match[1]}`),
			...[...sources.matchAll(/\b(script-blocked(?:-hidden)?)\b/g)].map((match) => match[1])
		]);
		for (const code of CODES) expect(used.has(code), `${code} is used nowhere`).toBe(true);
		for (const [, code] of sources.matchAll(/-Code '([a-z0-9-]+)'/g)) expect(CODES, code).toContain(code);
	});
});

describe('the help page "Betrieb" (web/src/lib/domain/script-problems.ts)', () => {
	it('shows every entry with a question, word for word and in the order of the catalog', () => {
		const expected = Object.entries(CATALOG)
			.filter(([, entry]) => entry.faq !== '')
			.map(([code, entry]) => ({ code, question: entry.faq, level: entry.level, problem: entry.problem, cause: entry.cause, steps: entry.steps, command: entry.command }));
		expect(expected.length).toBeGreaterThan(15);
		expect(SCRIPT_PROBLEMS).toEqual(expected);
	});

	it('names the frequent problems of the order: blocked script, port, start, stop, DPAPI, disk, autostart, backup', () => {
		const codes = SCRIPT_PROBLEMS.map((problem) => problem.code);
		for (const code of ['script-blocked', 'port-busy', 'health-timeout', 'pocketbase-missing', 'stop-failed', 'dpapi-start', 'disk-low', 'autostart-write', 'backup-target-unreachable', 'backup-passphrase', 'backup-damaged', 'unexpected']) {
			expect(codes).toContain(code);
		}
	});

	it('fills what the page knows and leaves a placeholder of the machine to the reader', () => {
		const values = helpValues('http://127.0.0.1:8095', '8095');
		const busy = SCRIPT_PROBLEMS.find((problem) => problem.code === 'port-busy');
		expect(fillText(busy.problem, values)).toBe('Port 8095 auf 127.0.0.1 ist belegt; becauseyoulovejira startet dort nicht.');
		expect(commandTemplate(busy.command, values)).toBe('powershell -NoProfile -ExecutionPolicy Bypass -File .\\byl-control.ps1 port {{next}}');
		expect(fillText('{gibt-es-nicht} {next}', values)).toBe('{gibt-es-nicht} …');
		// Every command of the page is complete, but for the placeholders the reader fills in.
		for (const problem of SCRIPT_PROBLEMS) {
			expect(commandTemplate(problem.command, values), problem.code).not.toMatch(/\{\{(?!next\}\})/);
		}
	});
});

describe('the scripts report problems only through the catalog', () => {
	const files = { 'byl-control.ps1': CONTROL, ...BUILD_SCRIPTS };

	it('have no red line of their own, no Show-Message with an error and no throw with a text', () => {
		for (const [name, source] of Object.entries(files)) {
			expect(source, name).not.toMatch(/-ForegroundColor Red\b/);
			expect(source, name).not.toMatch(/Show-Message -Kind/);
			for (const [line] of source.matchAll(/^.*\bthrow\b.*$/gm)) {
				if (/^\s*#/.test(line)) continue;
				// A problem of the catalog, or the error of the catch it stands in again.
				expect(line, `${name}: ${line.trim()}`).toMatch(/\bthrow \(New-BylProblemError -Code '|\bthrow \}/);
			}
		}
	});

	it('end the build scripts only with 0, a code that is no problem, or the exit code of an entry', () => {
		for (const [name, source] of Object.entries(BUILD_SCRIPTS)) {
			for (const [line, argument] of source.matchAll(/^.*\bexit (.+)$/gm)) {
				if (/^\s*#/.test(line)) continue;
				expect(['0', '$node', '(Write-BylBuildProblem', '(Write-BylBuildError'].some((start) => argument.startsWith(start)), `${name}: ${line.trim()}`).toBe(true);
			}
		}
		expect([...CONTROL.matchAll(/^\s*exit\b.*$/gm)].map((match) => match[0].trim())).toEqual(['exit $exitCode']);
	});

	it('answer every failed backup command with an entry of the catalog', () => {
		const calls = [...CONTROL.matchAll(/Write-BackupAnswer -Answer /g)].map(({ index }) => statementAt(CONTROL, index));
		expect(calls.length).toBeGreaterThan(15);
		for (const call of calls) {
			// A text is the answer of a command that was done; everything else names its entry.
			if (/ -Text /.test(call)) expect(call, call).not.toMatch(/ok = \$false/);
			else expect(call, call).toMatch(/ -Code /);
		}
		expect(CONTROL).not.toMatch(/\$(Export|Verify|Restore)ReasonText|\$(Target|Passphrase)ProblemText|Get-ConfigProblemText|Get-PortBusyText/);
	});

	it('ask only a person in a console window, and keep an error of a run without window', () => {
		const ask = /function Test-ConsoleQuestion \{[\s\S]*?\n\}/.exec(CONTROL)[0];
		expect(ask).toContain('Test-BylCanAsk -Hidden $Hidden.IsPresent -Quiet $Quiet.IsPresent -Json $Json.IsPresent -Background ($WaitForProcess -gt 0)');
		expect(ask).toContain('-InputRedirected ([Console]::IsInputRedirected) -OutputRedirected ([Console]::IsOutputRedirected)');
		const write = /function Write-BylProblem \{[\s\S]*?\n\}/.exec(CONTROL)[0];
		expect(write).toContain("if ($null -ne $Fix -and $problemReport.Offer -ne '' -and (Test-ConsoleQuestion)) {");
		expect(write).toContain('if ($problemIsError -and ($Hidden -or $WaitForProcess -gt 0)) { Save-BackgroundProblem -Report $problemReport }');
		expect(CONTROL.match(/Read-Host -Prompt \$problemReport\.Offer/g)).toHaveLength(1);
		// The app runs the script with -NonInteractive: it never gets a question.
		expect(read(join(APP_DIR, 'pb_hooks', 'lib', 'system-rules.js'))).toContain("var POWERSHELL_OPTIONS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];");
	});

	it.each(WRAPPERS)('%s checks with byl-pruefen.bat whether PowerShell could run the script at all', (name) => {
		const lines = read(join(APP_DIR, name)).split('\r\n');
		const set = lines.indexOf('set "BYL_EXIT=%ERRORLEVEL%"');
		expect(set).toBeGreaterThan(0);
		expect(lines[set + 1]).toBe('if not "%BYL_EXIT%"=="0" call "%~dp0byl-pruefen.bat" %BYL_EXIT%');
	});

	it('byl-pruefen.bat leaves the codes of the script alone and asks "help" otherwise', () => {
		const source = read(join(APP_DIR, 'byl-pruefen.bat'));
		expect(source).toContain('for %%c in (2 3 4 5 6) do if "%BYL_CODE%"=="%%c" exit /b 0');
		const lines = source.split(/\r?\n/);
		const probe = lines.indexOf(
			'"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" help >nul 2>&1'
		);
		expect(probe).toBeGreaterThan(0);
		expect(lines[probe + 1]).toBe('if "%ERRORLEVEL%"=="0" goto laeuft');
		// No character outside quotes that cmd would take as a command (the pipe stands in quotes).
		for (const line of lines.filter((text) => text.startsWith('echo '))) {
			expect(line.replace(/"[^"]*"/g, ''), line).not.toMatch(/[|&<>^]/);
		}
	});
});

// The parser of Windows PowerShell 5.1 is the reference; other systems skip it (plan plattformen S0).
describe.skipIf(process.platform !== 'win32')('the functions of byl-problems.ps1 in Windows PowerShell', () => {
	const APP = 'C:\\Users\\Max Mustermann\\Meine Apps\\becauseyoulovejira\\app';
	const LOG = `${APP}\\logs\\byl-control.log`;
	const FACT = 'Belegt durch pocketbase.exe (PID 4711): C:\\Users\\Max Mustermann\\eine andere Kopie mit einem langen Namen\\app\\pocketbase.exe';
	let out;

	beforeAll(() => {
		out = runPowerShellJson(
			String.raw`
. $env:BYL_PROBLEMS
. $env:BYL_FUNCTIONS
Set-StrictMode -Version 2.0
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
$result = [ordered]@{}
$values = Get-BylProblemValues -AppDir $in.app -Log $in.log -RepositoryRoot $in.root
$result.values = $values
$result.bare = Get-BylProblemValues -AppDir $in.app -Log '' -RepositoryRoot ''
$values['port'] = 8090
$values['next'] = 8091
$busy = Get-BylProblemReport -Code 'port-busy' -Values $values -Facts @($in.fact) -Log $in.log
$result.busy = @(Format-BylProblem -Report $busy)
$result.busyAscii = @(Format-BylProblem -Report $busy -Ascii)
$result.busyData = ConvertTo-BylProblemData -Report $busy
$result.busyOffer = $busy.Offer
$saved = (ConvertTo-Json -InputObject (ConvertTo-BylProblemData -Report $busy) -Depth 4) | ConvertFrom-Json
$result.roundTrip = @(Format-BylProblem -Report (ConvertFrom-BylProblemData -Data $saved))
$result.notData = $null -eq (ConvertFrom-BylProblemData -Data ('{"code":"x"}' | ConvertFrom-Json))
$missing = Get-BylProblemReport -Code 'pocketbase-missing' -Values $values -Log $in.log
$result.missing = @(Format-BylProblem -Report $missing)
$withoutNext = Get-BylProblemReport -Code 'port-busy' -Values @{ port = 8090; control = $values.control }
$result.withoutNext = [ordered]@{ command = $withoutNext.Command; steps = @(Format-BylProblem -Report $withoutNext) }
$unknown = Get-BylProblemReport -Code 'gibt-es-nicht'
$result.unknown = [ordered]@{ code = $unknown.Code; lines = @(Format-BylProblem -Report $unknown) }
$thrown = New-BylProblemError -Code 'port-invalid' -Values @{ value = 'abc' }
$result.thrown = [ordered]@{
    message = $thrown.Message
    code = (Get-BylProblemOfError -ErrorRecord $thrown).Code
    value = (Get-BylProblemOfError -ErrorRecord $thrown).Values.value
    inner = (Get-BylProblemOfError -ErrorRecord (New-Object System.Exception('outer', $thrown))).Code
    other = $null -eq (Get-BylProblemOfError -ErrorRecord (New-Object System.Exception('x')))
}
try { throw $thrown } catch { $result.thrown.record = (Get-BylProblemOfError -ErrorRecord $_).Code }
$result.ask = [ordered]@{
    console = Test-BylCanAsk -UserInteractive $true
    hidden = Test-BylCanAsk -UserInteractive $true -Hidden $true
    quiet = Test-BylCanAsk -UserInteractive $true -Quiet $true
    json = Test-BylCanAsk -UserInteractive $true -Json $true
    background = Test-BylCanAsk -UserInteractive $true -Background $true
    nonInteractive = Test-BylCanAsk -UserInteractive $true -NonInteractive $true
    noUser = Test-BylCanAsk -UserInteractive $false
    input = Test-BylCanAsk -UserInteractive $true -InputRedirected $true
    output = Test-BylCanAsk -UserInteractive $true -OutputRedirected $true
}
$result.yes = @(foreach ($answer in @('j', 'J', ' ja ', 'Y', 'yes', 'n', '', 'nein', 'jj')) { Test-BylYes -Answer $answer })
$result.ascii = ConvertTo-BylAscii -Text ([string][char]0x00D7 + ' Gr' + [char]0x00F6 + [char]0x00DF + 'e ' + [char]0x201E + 'x' + [char]0x201C + ' ' + [char]0x2013 + ' ' + [char]0x2026 + ' ' + [char]0x2192 + ' ' + [char]0x2603)
$result.errorLine = Format-ControlErrorLine -TimeUtc ([DateTime]::new(2026, 10, 2, 1, 2, 3, [DateTimeKind]::Utc)) -Command 'start' -ErrorType 'System.IO.IOException' -Position 'byl-control.ps1:12' -Message ("Zeile 1" + [char]13 + [char]10 + "Wert-sehr-geheim an max@example.com " + ('x' * 400)) -Secrets @('Wert-sehr-geheim')
$result.bat = @(Format-BylProblem -Report (Get-BylProblemReport -Code 'script-blocked' -Values @{ appq = '!BYL_DIRQ!' } -Facts @('Ordner: !BYL_DIR!')) -Ascii)
$result.vbs = @(Format-BylProblem -Report (Get-BylProblemReport -Code 'script-blocked-hidden' -Values @{ app = '{app}' }) -Ascii)
# ASCII only on standard output, whatever the code page of the console.
[regex]::Replace((ConvertTo-Json -InputObject $result -Depth 6 -Compress), '[^\x00-\x7F]', { param($match) '\u{0:x4}' -f [int][char]$match.Value })`,
			{ app: APP, log: LOG, root: 'C:\\repo mit Leerzeichen', fact: FACT },
			{ BYL_PROBLEMS: CATALOG_FILE, BYL_FUNCTIONS: join(APP_DIR, 'byl-functions.ps1') }
		);
	}, 60_000);

	it('fills in the real paths: the control script, the log, its last 50 lines, the scripts of the repository', () => {
		expect(out.values).toMatchObject({
			app: APP,
			appq: APP,
			control: `powershell -NoProfile -ExecutionPolicy Bypass -File "${APP}\\byl-control.ps1"`,
			log: LOG,
			tail: `powershell -NoProfile -Command "Get-Content -LiteralPath '${LOG}' -Tail 50 | Set-Clipboard"`,
			build: 'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\\repo mit Leerzeichen\\scripts\\build.ps1"',
			fetch: 'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\\repo mit Leerzeichen\\scripts\\fetch-pocketbase.ps1"'
		});
		// Without a log and outside a repository there are no such commands.
		expect(Object.keys(out.bare).sort()).toEqual(['app', 'appq', 'control']);
	});

	it('prints problem, facts, cause, numbered steps, the command to copy and the log, wrapped at 100 columns', () => {
		const lines = out.busy;
		expect(lines[0]).toBe('\u00d7 Problem:   Port 8090 auf 127.0.0.1 ist belegt; becauseyoulovejira startet dort nicht.');
		expect(lines[1]).toBe(`             ${FACT}`);
		expect(lines[2]).toMatch(/^ {2}Ursache: {3}Ein anderes Programm nutzt die Adresse der App/);
		expect(lines).toContain("  So geht's: 1. Das andere Programm beenden (eine andere Kopie der App mit ihrem stop.bat) und");
		expect(lines.some((line) => line.startsWith('             2. Oder becauseyoulovejira auf den freien Port 8091 umstellen'))).toBe(true);
		const command = lines.indexOf('             Befehl zum Kopieren:');
		expect(lines[command + 1]).toBe(`               powershell -NoProfile -ExecutionPolicy Bypass -File "${APP}\\byl-control.ps1" port 8091`);
		expect(lines.at(-1)).toBe(`  Details:   ${LOG}`);
		// Only the fact, the command and the log are longer: they are never broken.
		for (const line of lines.filter((text, index) => index !== 1 && index !== command + 1 && index !== lines.length - 1)) {
			expect(line.length, line).toBeLessThanOrEqual(100);
		}
		expect(out.busyOffer).toBe('Soll ich becauseyoulovejira auf Port 8091 umstellen und starten? (J/N)');
	});

	it('never breaks a value with spaces across two lines', () => {
		expect(out.missing[0]).toBe('\u00d7 Problem:   pocketbase.exe fehlt im Ordner');
		expect(out.missing[1]).toBe(`             ${APP}.`);
		expect(out.missing.join('\n')).not.toContain('\u00a0');
	});

	it('leaves out a command whose value is missing and shows an ellipsis in the text', () => {
		expect(out.withoutNext.command).toBe('');
		expect(out.withoutNext.steps.join('\n')).toContain('auf den freien Port \u2026 umstellen');
		expect(out.withoutNext.steps.join('\n')).not.toContain('Befehl zum Kopieren');
	});

	it('reports an unknown code as an unexpected error that names it', () => {
		expect(out.unknown.code).toBe('unexpected');
		expect(out.unknown.lines[0]).toBe('\u00d7 Problem:   Unerwarteter Fehler: unbekannter Code des Fehlerkatalogs: gibt-es-nicht');
	});

	it('keeps the same words in JSON, with code and remedy, and reads them back', () => {
		expect(Object.keys(out.busyData)).toEqual(['code', 'level', 'exitCode', 'problem', 'facts', 'cause', 'remedy', 'log']);
		expect(out.busyData).toMatchObject({
			code: 'port-busy',
			level: 'error',
			exitCode: 4,
			problem: 'Port 8090 auf 127.0.0.1 ist belegt; becauseyoulovejira startet dort nicht.',
			facts: [FACT],
			remedy: { command: `powershell -NoProfile -ExecutionPolicy Bypass -File "${APP}\\byl-control.ps1" port 8091` },
			log: LOG
		});
		expect(JSON.stringify(out.busyData)).not.toContain('\u00a0');
		expect(Object.keys(out.busyData.remedy)).toEqual(['steps', 'command']);
		expect(out.busyData.remedy.steps).toHaveLength(2);
		expect(out.roundTrip).toEqual(out.busy);
		expect(out.notData).toBe(true);
	});

	it('carries an entry in an exception, also as inner exception, and says the problem as message', () => {
		expect(out.thrown).toEqual({
			message: '\u201eabc\u201c ist kein g\u00fcltiger Port.',
			code: 'port-invalid',
			value: 'abc',
			inner: 'port-invalid',
			other: true,
			record: 'port-invalid'
		});
	});

	it('asks only a person in a console window', () => {
		expect(out.ask).toEqual({
			console: true,
			hidden: false,
			quiet: false,
			json: false,
			background: false,
			nonInteractive: false,
			noUser: false,
			input: false,
			output: false
		});
		expect(out.yes).toEqual([true, true, true, true, true, false, false, false, false]);
	});

	it('writes ASCII for the .bat files and start-hidden.vbs', () => {
		expect(out.ascii).toBe('x Groesse "x" - ... -> ?');
		expect(out.busyAscii[0]).toBe('X Problem:   Port 8090 auf 127.0.0.1 ist belegt; becauseyoulovejira startet dort nicht.');
		for (const line of out.busyAscii) expect(line).toMatch(/^[\x20-\x7e]*$/);
	});

	it('logs an unexpected error on one line, without values and e-mail addresses, cut short', () => {
		expect(out.errorLine).toMatch(/^2026-10-02T01:02:03Z start error type=System\.IO\.IOException at=byl-control\.ps1:12 message="Zeile 1 \*\*\* an \*\*\* x+\.\.\."$/);
		expect(out.errorLine).not.toMatch(/geheim|example\.com|[\r\n]/);
		expect(/message="(.*)"$/.exec(out.errorLine)[1]).toHaveLength(300);
	});

	it('byl-pruefen.bat shows the entry script-blocked word for word', () => {
		const lines = read(join(APP_DIR, 'byl-pruefen.bat')).split(/\r?\n/);
		const echoed = lines.slice(lines.indexOf('echo.') + 1, lines.indexOf('if "%BYL_CODE%"=="" pause')).map((line) => line.replace(/^echo /, ''));
		expect(echoed).toEqual(out.bat);
	});

	it('start-hidden.vbs shows the entry script-blocked-hidden word for word', () => {
		const source = read(join(APP_DIR, 'start-hidden.vbs'));
		const block = /problem = Array\( _\r?\n([\s\S]*?)\)\r?\n/.exec(source)[1];
		const lines = [...block.matchAll(/"((?:[^"]|"")*)"/g)].map((match) => match[1].replaceAll('""', '"'));
		expect(lines).toEqual(out.vbs);
		expect(source).toContain('MsgBox Replace(Join(problem, vbCrLf), "{app}", appDir), vbCritical, "becauseyoulovejira"');
	});
});
