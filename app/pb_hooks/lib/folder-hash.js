// SHA-256 of files of the folder channel (ADR-0051 §4). Read only: files are opened for reading,
// never written. Two ways, chosen by size:
// - Up to `memoryHashBytes` the server hashes a file itself: it reads it through the root of its
//   folder (os.Root, no link leads out) with toString and passes the text straight on to
//   $security.sha256. The text stays the Go string of the bytes (Goja converts it only on use in
//   JavaScript), so the hash is the one of the file, also for binary files (verified in the spike
//   and by tests/integration/folder-channel.test.mjs against node:crypto). The memory needed is a
//   few times the size of the file for a moment.
// - Above it, up to `hashBytes`, a streaming helper of the system hashes in constant memory: under
//   Windows one Windows PowerShell per batch of files (script in folder-rules.js, paths as JSON on
//   standard input, files opened shared for reading, writing and deleting), under Linux sha256sum.
// A file that cannot be read gives ''. CommonJS module, ES5 only, Goja runtime only.
'use strict';

var rules = require(__hooks + '/lib/folder-rules.js');

// The output of the helper: one line of 64 characters per file.
var HELPER_OUTPUT_BYTES = 1024 * 1024;

function powershell() {
  var root = String($os.getenv('SystemRoot') || '');
  return (root === '' ? 'C:\\Windows' : root) + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
}

/** SHA-256 of a file below an open root, read in the server; '' when it cannot be read. */
function inMemory(root, rel, limit) {
  var file = null;
  try {
    file = root.open(rel);
    return String($security.sha256(toString(file, limit + 1)));
  } catch (err) {
    return '';
  } finally {
    if (file !== null) {
      try {
        file.close();
      } catch (err) {
        // Closing a file opened for reading cannot lose anything.
      }
    }
  }
}

/** SHA-256 of absolute paths by the helper of Windows; one value per path ('' when unreadable). */
function withPowerShell(paths) {
  try {
    var cmd = $os.cmd(powershell(), '-NoProfile', '-NonInteractive', '-EncodedCommand', rules.encodedCommand(rules.HASH_SCRIPT));
    var stdin = cmd.stdinPipe();
    var pipe = cmd.stdoutPipe();
    cmd.start();
    stdin.write(toBytes(rules.asciiJson(paths)));
    stdin.close();
    var output = toString(pipe, HELPER_OUTPUT_BYTES);
    try {
      cmd.wait();
    } catch (err) {
      // A file that could not be read is "-" in the output; the exit code adds nothing.
    }
    return rules.parseHashLines(output, paths.length);
  } catch (err) {
    return rules.parseHashLines('', paths.length);
  }
}

/** SHA-256 of one absolute path by sha256sum (Linux); '' when it cannot be read. */
function withSha256sum(path) {
  try {
    return rules.parseSha256sum(toString($os.cmd('sha256sum', '-b', '--', path).output()));
  } catch (err) {
    return '';
  }
}

/**
 * Hashes of files of one folder: `items` [{ rel, abs, size }] (each at most `limits.hashBytes`),
 * `root` the open root of the folder. Returns { rel: sha256 or '' }.
 */
function hashFiles(root, items, platform, limits) {
  var result = {};
  var large = [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].size <= limits.memoryHashBytes) {
      result[items[i].rel] = inMemory(root, items[i].rel, limits.memoryHashBytes);
    } else {
      large.push(items[i]);
    }
  }
  if (platform === 'windows') {
    var batch = Math.max(limits.helperBatch, 1);
    for (var start = 0; start < large.length; start += batch) {
      var part = large.slice(start, start + batch);
      var paths = [];
      for (var p = 0; p < part.length; p++) {
        paths.push(part[p].abs);
      }
      var shas = withPowerShell(paths);
      for (var s = 0; s < part.length; s++) {
        result[part[s].rel] = shas[s];
      }
    }
  } else {
    for (var l = 0; l < large.length; l++) {
      result[large[l].rel] = withSha256sum(large[l].abs);
    }
  }
  return result;
}

module.exports = {
  hashFiles: hashFiles
};
