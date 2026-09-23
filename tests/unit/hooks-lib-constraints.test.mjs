// Guards the runtime constraints of app/pb_hooks/lib (CLAUDE.md section 3, ADR-0005):
// ES5 script syntax for the Goja runtime and no runtime time zone functions.
// espree is reused from the web toolchain (dependency of eslint) instead of a new package.

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const LIB_DIR = join(ROOT_DIR, 'app', 'pb_hooks', 'lib');
const espree = createRequire(join(ROOT_DIR, 'web', 'package.json'))('espree');

const libFiles = readdirSync(LIB_DIR).filter((name) => name.endsWith('.js'));

const FORBIDDEN_TIME_ZONE_APIS = [
	/\bTimezone\s*\(/,
	/\bDateTime\s*\(/,
	/\bIntl\b/,
	/\bgetTimezoneOffset\b/,
	/\btoLocale\w*\s*\(/,
	// Local-time Date methods; the UTC variants (getUTCFullYear ...) stay allowed.
	/\.get(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\s*\(/,
	/\.set(?:FullYear|Month|Date|Hours|Minutes|Seconds|Milliseconds)\s*\(/
];

describe('app/pb_hooks/lib', () => {
	it('contains modules', () => {
		expect(libFiles.length).toBeGreaterThan(0);
	});

	it.each(libFiles)('%s parses as ES5 script', (name) => {
		const source = readFileSync(join(LIB_DIR, name), 'utf8');
		expect(() => espree.parse(source, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
	});

	it.each(libFiles)('%s uses CommonJS exports and no runtime time zone functions', (name) => {
		const source = readFileSync(join(LIB_DIR, name), 'utf8');
		expect(source).toMatch(/\bmodule\.exports\s*=/);
		for (const pattern of FORBIDDEN_TIME_ZONE_APIS) {
			expect(source, `${name} matches ${pattern}`).not.toMatch(pattern);
		}
	});
});
