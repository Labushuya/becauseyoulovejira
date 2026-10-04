/// <reference path="../pb_data/types.d.ts" />
// Test-only route of tests/integration/control-script.test.mjs (ST-1). Only that file copies it
// into its disposable copies of the app folder; the harness never loads it (it is not in
// tests/fixtures/pb_hooks), and it is never part of the portable app folder. Superusers only.
//
// Starts a child process of this server the way the hooks of the app do ($os.cmd, e.g.
// byl-control.ps1 backup-verify of the cron job byl-backup): Windows PowerShell, which shares the
// hidden console of the server until it ends. It sleeps `seconds` (1 to 60) and then writes the
// file `<name>.done` into the folder of the copy (next to pb_hooks), so the test sees that it ran
// to its end. The answer is the process ID of the child.
routerAdd(
  'POST',
  '/api/byl-test/console-child',
  function (e) {
    var query = e.request.url.query();
    var seconds = parseInt(String(query.get('seconds') || ''), 10);
    var name = String(query.get('name') || '');
    if (!(seconds >= 1 && seconds <= 60) || !/^[a-z0-9-]{1,40}$/.test(name)) {
      return e.json(400, { message: 'seconds 1 to 60 and a name of a-z, 0-9 and -' });
    }
    var rules = require(`${__hooks}/lib/folder-rules.js`);
    var marker = $filepath.join($filepath.dir(__hooks), name + '.done');
    var script =
      'Start-Sleep -Seconds ' + seconds + "; [System.IO.File]::WriteAllText('" + marker.replace(/'/g, "''") + "', 'done')";
    var root = String($os.getenv('SystemRoot') || '');
    var powershell = (root === '' ? 'C:\\Windows' : root) + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    var cmd = $os.cmd(powershell, '-NoProfile', '-NonInteractive', '-EncodedCommand', rules.encodedCommand(script));
    cmd.start();
    return e.json(200, { pid: cmd.process.pid });
  },
  $apis.requireSuperuserAuth()
);
