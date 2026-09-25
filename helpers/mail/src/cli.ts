// Process entry of byl-mail.exe (bundled by scripts/build-mail-helper.ps1). In a single executable
// application process.argv is [exe, exe, ...args], under Node [node, script, ...args]; both carry
// the arguments from index 2.

import { main } from './main';

main(process.argv.slice(2)).then(
	(code) => {
		process.exitCode = code;
	},
	(error: unknown) => {
		process.stderr.write(`byl-mail: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
);
