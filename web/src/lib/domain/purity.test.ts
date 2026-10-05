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
	// Intl.Collator sorts text (E3 plan, T-5) and knows no time zone; every other Intl API is out.
	/\bIntl\b(?!\.Collator\b)/,
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
	it('contains the E2 and E3 modules', () => {
		expect(modules).toEqual(
			expect.arrayContaining([
				'berlin-date.ts',
				'due-label.ts',
				'filter.ts',
				// Since FI-1 the counting of kpis.ts is part of the filter cards.
				'filter-cards.ts',
				'grouping.ts',
				'labels.ts',
				'list-query.ts',
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

	it('allows Intl.Collator but no other Intl API', () => {
		const [intl] = FORBIDDEN_TIME_ZONE_APIS;
		expect("new Intl.Collator('de')").not.toMatch(intl!);
		expect("new Intl.DateTimeFormat('de')").toMatch(intl!);
		expect('Intl.RelativeTimeFormat').toMatch(intl!);
		expect('const { Collator } = Intl;').toMatch(intl!);
	});

	it.each(modules)('%s uses no runtime time zone functions', (name) => {
		const source = readFileSync(join(DOMAIN_DIR, name), 'utf8').replace(/^\s*\/\/.*$/gm, '');
		for (const pattern of FORBIDDEN_TIME_ZONE_APIS) {
			expect(source, `${name} matches ${pattern}`).not.toMatch(pattern);
		}
	});

	it.each(modules)('%s has no any', (name) => {
		const code = readFileSync(join(DOMAIN_DIR, name), 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/\/\/.*$/gm, '');
		expect(code).not.toMatch(/\bany\b/);
	});
});
