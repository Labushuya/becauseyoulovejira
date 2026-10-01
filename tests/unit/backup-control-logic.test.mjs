// Pure functions of byl-control.ps1 for the backups (ADR-0046): the checks of a target folder, the
// backup section of byl-config.json (the same as lib/backup-rules.js reads it), the merge with the
// port, the passphrase, the access data a backup takes along and the file of the passphrase, and
// for a restore the access data it writes back, the confirmation word, the names of the folders and
// the command line of the detached run. Only app/byl-functions.ps1 runs here, never a script or a
// server.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { runPowerShellJson } from '../support/powershell.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FUNCTIONS_FILE = join(ROOT_DIR, 'app', 'byl-functions.ps1');
const rules = loadHookLib('backup-rules.js');

const APP = 'C:\\Apps\\byl #1\\app';
const TARGETS = {
	drive: 'E:\\Sicherung',
	driveRoot: 'E:\\',
	share: '\\\\nas\\daten\\Sicherung',
	shareRoot: '\\\\nas\\daten',
	spaces: 'D:\\Meine Sicherungen\\byl 2026',
	umlauts: 'D:\\Datensicherung\\Größe',
	relative: 'Sicherung',
	rooted: '\\Sicherung',
	driveRelative: 'E:Sicherung',
	slashes: 'E:/Sicherung',
	parent: 'E:\\Sicherung\\..\\Windows',
	dot: 'E:\\.\\Sicherung',
	wildcard: 'E:\\Sich*',
	colon: 'E:\\a:b',
	control: 'E:\\a\u0001b',
	shareOnly: '\\\\nas',
	empty: '   ',
	tooLong: `E:\\${'x'.repeat(240)}`,
	app: APP,
	insideApp: `${APP}\\pb_data\\backups`,
	insideAppCase: 'c:\\apps\\BYL #1\\APP\\Sicherung',
	besideApp: 'C:\\Apps\\byl #1\\app-sicherung',
	parentOfApp: 'C:\\Apps\\byl #1'
};
const CONFIGS = {
	empty: '',
	broken: '{',
	portOnly: '{ "port": 8091 }',
	full: JSON.stringify({ port: 8091, backup: { target: ' E:\\Sicherung ', daily: 3, weekly: 0, monthly: 24, credentials: false } }),
	outside: JSON.stringify({ backup: { target: '', daily: 0, weekly: 13, monthly: 2.5, credentials: 'nein' } }),
	nullBackup: '{ "backup": null }'
};

const SCRIPT = String.raw`
. $env:BYL_FUNCTIONS
Set-StrictMode -Version 2.0
$in = $env:BYL_TEST_INPUT | ConvertFrom-Json
$result = @{}
$result.targets = @{}
foreach ($case in $in.targets.PSObject.Properties) {
    $problem = Test-BylBackupTarget -Path $case.Value -AppDir $in.app
    $result.targets[$case.Name] = if ($null -eq $problem) { 'ok' } else { $problem }
}
$result.configs = @{}
foreach ($case in $in.configs.PSObject.Properties) {
    $parsed = ConvertFrom-BylBackupConfig -Text $case.Value
    $result.configs[$case.Name] = [ordered]@{ target = $parsed.Target; daily = $parsed.Daily; weekly = $parsed.Weekly; monthly = $parsed.Monthly; credentials = $parsed.Credentials; present = $parsed.Present }
}
$backup = ConvertFrom-BylBackupConfig -Text $in.configs.full
$result.merge = @{
    portKeepsBackup = Merge-BylConfigText -Text $in.configs.full -Port 8095
    backupKeepsPort = Merge-BylConfigText -Text $in.configs.portOnly -Backup $backup
    fresh = Merge-BylConfigText -Text '' -Port 8090
    brokenRepaired = Merge-BylConfigText -Text '{' -Port 8090
    nothing = Merge-BylConfigText -Text ''
}
$backup.Target = $null
$result.merge.noTarget = Merge-BylConfigText -Text $in.configs.portOnly -Backup $backup
$backup.Target = 'D:\Daten "x"\Sicherung'
$result.merge.quoted = Merge-BylConfigText -Text '' -Backup $backup
$result.mergeRoundTrip = (ConvertFrom-BylBackupConfig -Text $result.merge.quoted).Target
$result.mergePort = (ConvertFrom-BylConfig -Text $result.merge.portKeepsBackup).Port
$result.passphrases = @{
    ok = Test-BylPassphrase -Passphrase 'zwölf Zeichen' -Confirmation 'zwölf Zeichen'
    mismatch = Test-BylPassphrase -Passphrase 'zwölf Zeichen' -Confirmation 'zwölf zeichen'
    short = Test-BylPassphrase -Passphrase 'kurz' -Confirmation 'kurz'
    empty = Test-BylPassphrase -Passphrase '' -Confirmation ''
    long = Test-BylPassphrase -Passphrase ('ä' * 600) -Confirmation ('ä' * 600)
    control = Test-BylPassphrase -Passphrase ('zwölf Zeichen' + [char]9 + '!') -Confirmation ('zwölf Zeichen' + [char]9 + '!')
}
$variables = @{ BYL_B = 'b'; BYL_A = 'a'; BYL_LEER = ''; BYL_TEST_ISOLATED = '1'; BYL_lower = 'x'; PATH = 'C:\Windows'; BYL_INGEST_TOKEN = 't' }
$selected = Select-BylSecretVariable -Variables $variables
$result.secretNames = @($selected.Keys)
$result.secretValue = $selected['BYL_A']
$result.noSecrets = @((Select-BylSecretVariable -Variables $null).Keys).Count
$result.passphrasePath = Get-BylPassphrasePath -AppDir 'C:\Apps\byl #1\app' -BaseDir 'C:\Users\anna\AppData\Local\becauseyoulovejira'
$result.passphrasePathCase = Get-BylPassphrasePath -AppDir 'c:\apps\BYL #1\APP\' -BaseDir 'C:\Users\anna\AppData\Local\becauseyoulovejira'
$result.passphrasePathOther = Get-BylPassphrasePath -AppDir 'D:\byl\app' -BaseDir 'C:\Users\anna\AppData\Local\becauseyoulovejira'
$result.sealed = Get-BylSealedName -LocalName 'byl-20261001-080509.zip'
try { [void](Get-BylSealedName -LocalName '@auto_pb_backup_x.zip'); $result.sealedOther = 'accepted' } catch { $result.sealedOther = 'rejected' }
$result.space = @(
    (Get-BylBackupSpaceVerdict -FreeBytes (300MB) -NeededBytes (50MB)),
    (Get-BylBackupSpaceVerdict -FreeBytes (240MB) -NeededBytes (50MB)),
    (Get-BylBackupSpaceVerdict -FreeBytes (199MB))
)
$result.keep = @{}
foreach ($name in @($BylBackupKeep.Keys)) { $result.keep[$name] = @($BylBackupKeep[$name].Default, $BylBackupKeep[$name].Min, $BylBackupKeep[$name].Max) }
$backupSecrets = [ordered]@{ BYL_B = 'neu-b'; BYL_A = 'neu-a'; BYL_TEST_X = '1'; BYL_lower = 'x'; BYL_LEER = ''; BYL_NUL = "a$([char]0)b" }
$account = @{ BYL_A = 'alt-a'; BYL_C = 'c'; BYL_LEER = '' }
$result.restore = @{}
foreach ($mode in @('missing', 'all', 'none')) {
    $selection = Select-BylRestoreVariable -Secrets $backupSecrets -Current $account -Mode $mode
    $result.restore[$mode] = @{ write = $selection.Write; skipped = @($selection.Skipped) }
}
$result.restoreEmpty = @((Select-BylRestoreVariable -Secrets $null -Current $null -Mode all).Write.Keys).Count
$result.confirm = @(
    (Test-BylRestoreConfirmation -Text 'WIEDERHERSTELLEN'),
    (Test-BylRestoreConfirmation -Text ' WIEDERHERSTELLEN '),
    (Test-BylRestoreConfirmation -Text 'wiederherstellen'),
    (Test-BylRestoreConfirmation -Text 'WIEDERHERSTELLE'),
    (Test-BylRestoreConfirmation -Text ''),
    (Test-BylRestoreConfirmation -Text $null)
)
$result.safetyName = Get-BylFolderStamp -Prefix $BylSafetyCopyPrefix -TimeUtc ([DateTime]::new(2026, 10, 1, 8, 5, 9, [DateTimeKind]::Utc))
$result.stagingName = Get-BylFolderStamp -Prefix $BylStagingPrefix -TimeUtc ([DateTime]::new(2026, 10, 1, 10, 5, 9, [DateTimeKind]::Local))
$result.restoreWord = $BylRestoreConfirmWord
$result.safetyDays = $BylSafetyKeepDays
$result.detachedRestore = Get-DetachedRestoreArgumentString -ScriptPath 'C:\Apps\byl #1\app\byl-control.ps1' -WaitForProcess 4242
ConvertTo-Json -InputObject $result -Depth 6 -Compress`;

let result;

beforeAll(() => {
	result = runPowerShellJson(SCRIPT, { app: APP, targets: TARGETS, configs: CONFIGS }, { BYL_FUNCTIONS: FUNCTIONS_FILE });
}, 60_000);

describe('target folder (Test-BylBackupTarget)', () => {
	it('accepts full paths of drives and shares, with spaces and umlauts', () => {
		for (const name of ['drive', 'driveRoot', 'share', 'shareRoot', 'spaces', 'umlauts', 'besideApp', 'parentOfApp']) {
			expect(result.targets[name], name).toBe('ok');
		}
	});

	it('refuses relative paths, ".." and characters Windows does not allow', () => {
		for (const name of ['relative', 'rooted', 'driveRelative', 'slashes', 'parent', 'dot', 'wildcard', 'colon', 'control', 'shareOnly', 'empty']) {
			expect(result.targets[name], name).toBe('Format');
		}
		expect(result.targets.tooLong).toBe('TooLong');
	});

	it('refuses the app folder and everything inside it, in any case', () => {
		for (const name of ['app', 'insideApp', 'insideAppCase']) {
			expect(result.targets[name], name).toBe('InsideApp');
		}
	});
});

describe('backup section of byl-config.json', () => {
	it('reads it like lib/backup-rules.js (parity)', () => {
		for (const [name, text] of Object.entries(CONFIGS)) {
			const { present, ...settings } = result.configs[name];
			expect(settings, name).toEqual(rules.settingsOf(text));
			expect(present, name).toBe(['full', 'outside'].includes(name));
		}
	});

	it('uses the same generations, defaults and limits as the app', () => {
		for (const [name, limit] of Object.entries(rules.KEEP)) {
			expect(result.keep[name], name).toEqual([limit.fallback, limit.min, limit.max]);
		}
	});

	it('keeps the backup when the port changes and the port when the backup changes', () => {
		expect(result.merge.portKeepsBackup).toBe(
			'{\r\n  "port": 8095,\r\n  "backup": {\r\n    "target": "E:\\\\Sicherung",\r\n    "daily": 3,\r\n    "weekly": 0,\r\n    "monthly": 24,\r\n    "credentials": false\r\n  }\r\n}\r\n'
		);
		expect(result.mergePort).toBe(8095);
		expect(JSON.parse(result.merge.backupKeepsPort)).toEqual({
			port: 8091,
			backup: { target: 'E:\\Sicherung', daily: 3, weekly: 0, monthly: 24, credentials: false }
		});
		expect(JSON.parse(result.merge.noTarget).backup.target).toBeNull();
		expect(result.merge.fresh).toBe('{\r\n  "port": 8090\r\n}\r\n');
		expect(result.merge.brokenRepaired).toBe('{\r\n  "port": 8090\r\n}\r\n');
		expect(result.merge.nothing).toBe('{\r\n}\r\n');
		expect(result.mergeRoundTrip).toBe('D:\\Daten "x"\\Sicherung');
	});
});

describe('passphrase and access data', () => {
	it('wants the passphrase twice, at least 12 characters, at most 1024 bytes, without control characters', () => {
		expect(result.passphrases).toEqual({ ok: null, mismatch: 'Mismatch', short: 'TooShort', empty: 'TooShort', long: 'TooLong', control: 'Character' });
	});

	it('takes along valid BYL_* variables with a value, sorted, without the switches of the tests', () => {
		expect(result.secretNames).toEqual(['BYL_A', 'BYL_B', 'BYL_INGEST_TOKEN']);
		expect(result.secretValue).toBe('a');
		expect(result.noSecrets).toBe(0);
	});

	it('keeps the passphrase per app folder outside of it, whatever the case of the path', () => {
		expect(result.passphrasePath).toMatch(/^C:\\Users\\anna\\AppData\\Local\\becauseyoulovejira\\sicherung-[0-9a-f]{16}\.passphrase$/);
		expect(result.passphrasePathCase).toBe(result.passphrasePath);
		expect(result.passphrasePathOther).not.toBe(result.passphrasePath);
	});

	it('names the sealed copy like the local backup and wants space for it', () => {
		expect(result.sealed).toBe('byl-20261001-080509.tar.age');
		expect(result.sealedOther).toBe('rejected');
		expect(result.space).toEqual(['Ok', 'Low', 'Low']);
	});
});

describe('restore (BK-3)', () => {
	it('writes back missing, all or no access data, only valid names with a value an environment variable can hold', () => {
		expect(result.restore.missing).toEqual({ write: { BYL_B: 'neu-b' }, skipped: ['BYL_A', 'BYL_NUL'] });
		expect(result.restore.all).toEqual({ write: { BYL_A: 'neu-a', BYL_B: 'neu-b' }, skipped: ['BYL_NUL'] });
		expect(result.restore.none).toEqual({ write: {}, skipped: ['BYL_A', 'BYL_B', 'BYL_NUL'] });
		expect(result.restoreEmpty).toBe(0);
	});

	it('wants exactly the word WIEDERHERSTELLEN, the same as the app', () => {
		expect(result.confirm).toEqual([true, true, false, false, false, false]);
		expect(result.restoreWord).toBe(rules.RESTORE_CONFIRM);
	});

	it('names the safety copy with the UTC time stamp the cron of the app reads, kept seven days', () => {
		expect(result.safetyName).toBe('pb_data.vor-wiederherstellung-20261001-080509');
		expect(rules.safetyTime(result.safetyName)).toBe(Date.UTC(2026, 9, 1, 8, 5, 9));
		expect(result.stagingName).toMatch(/^pb_data\.neu-20261001-\d{6}$/);
		expect(result.safetyDays * 24 * 60 * 60 * 1000).toBe(rules.SAFETY_KEEP_MS);
	});

	it('starts the detached restore with the script, the command and the caller only', () => {
		expect(result.detachedRestore).toBe(
			'-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\\Apps\\byl #1\\app\\byl-control.ps1" restore -NoBrowser -Quiet -WaitForProcess 4242'
		);
	});
});
