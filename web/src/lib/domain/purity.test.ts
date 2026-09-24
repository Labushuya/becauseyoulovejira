// The domain modules stay pure (ADR-0006 section 1, E2 plan package 3): no SvelteKit, no app
// modules, no SDK, only relative imports among themselves. Calendar logic runs without the time
// zone data of the runtime (ADR-0005), as in app/pb_hooks/lib.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOMAIN_DIR = import.meta.dirname;
const modules = readdirSync(DOMAIN_DIR).filter(
	(name) => name.endsWith('.ts') && !name.endsWith('.test.ts')
);

const FORBIDDEN_TIME_ZONE_APIS = [
	/\bIntl\b/,
	/\bgetTimezoneOffset\b/,
	/\btoLocale\w*\s*\(/,
	// Local-time Date methods; the UTC variants (getUTCFullYear ...) stay allowed.
	/\.get(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\s*\(/,
	/\.set(?:FullYear|Month|Date|Hours|Minutes|Seconds|Milliseconds)\s*\(/
];

function importSpecifiers(source: string): string[] {
	const specifiers = [
		...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
		...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
		...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)
	];
	return specifiers.map((match) => match[1] ?? '');
}

describe('web/src/lib/domain', () => {
	it('contains the E2 modules', () => {
		expect(modules).toEqual(
			expect.arrayContaining([
				'berlin-date.ts',
				'labels.ts',
				'ordering.ts',
				'status.ts',
				'ticket.ts'
			])
		);
	});

	it.each(modules)('%s imports only sibling domain modules', (name) => {
		const specifiers = importSpecifiers(readFileSync(join(DOMAIN_DIR, name), 'utf8'));
		for (const specifier of specifiers) {
			expect(specifier, `${name} imports ${specifier}`).toMatch(/^\.\/[\w-]+$/);
		}
	});

	it.each(modules)('%s uses no runtime time zone functions', (name) => {
		const source = readFileSync(join(DOMAIN_DIR, name), 'utf8').replace(/^\s*\/\/.*$/gm, '');
		for (const pattern of FORBIDDEN_TIME_ZONE_APIS) {
			expect(source, `${name} matches ${pattern}`).not.toMatch(pattern);
		}
	});
});
