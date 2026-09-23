// Loads a CommonJS module from app/pb_hooks/lib the way the Goja runtime does: plain
// script with `module` and `exports`, without Node's `require`. A direct Node require is not
// possible because the root package.json declares "type": "module".

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInThisContext } from 'node:vm';

const LIB_DIR = resolve(fileURLToPath(new URL('../../app/pb_hooks/lib', import.meta.url)));

/** @param {string} name file name inside app/pb_hooks/lib, e.g. "status.js" */
export function loadHookLib(name) {
	const filename = join(LIB_DIR, name);
	const source = readFileSync(filename, 'utf8');
	const factory = runInThisContext(`(function (module, exports) {${source}\n})`, { filename });
	const module = { exports: {} };
	factory(module, module.exports);
	return module.exports;
}
