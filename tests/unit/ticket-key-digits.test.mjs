// Ticket numbers have no upper bound (KN-1, ADR-0030 Nachtrag 7): the counter counts on and
// formatKey writes the number as it is, so "HAUS-999" is followed by "HAUS-1000" and later by
// "HAUS-1000000". Statically: no regular expression of the server (hooks, migrations) or of the
// web app limits the digits of a key, e.g. "[A-Z]+-\d{1,4}", "[A-Z]{2,6}-[0-9]{3}" or "\d\d\d",
// neither as a literal nor as a string for RegExp or a `pattern`. A key pattern takes its number
// with `\d+` (or `[0-9]+`), like KEY_PATTERN of web/src/lib/domain/ordering.ts.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Folders of the server and the web app with the files that may hold a pattern of a key. */
const SOURCES = [
	['app/pb_hooks', /\.js$/],
	['app/pb_migrations', /\.js$/],
	['web/src', /\.(?:ts|js|svelte)$/]
];

/**
 * The letters of a code (a class starting with A-Z, with or without a quantifier, maybe closing a
 * group), a hyphen (maybe escaped, also inside a string) and maybe the start of a group. DIGITS
 * then reads the class of the digits with its quantifier and a second class right after it.
 * Written for literals (`\d`) and strings (`\\d`).
 */
const KEY_PATTERN = /\[A-Z[^\]\n]*\](?:[+*]|\{\d+(?:,\d*)?\})?\)?\\{0,2}-(?:\((?:\?:)?)?/g;
const DIGITS = /^(?:\\{1,2}d|\[0-9\])(?:[+*?]|\{\d*(?:,\d*)?\})?(?:\\{1,2}d|\[0-9\])?/;
/** Digits without an upper bound: one or more, or any number. */
const UNBOUNDED = /^(?:\\{1,2}d|\[0-9\])[+*]$/;

/**
 * The patterns of keys in `source` as `{ pattern, digits }`: what stands for the code and the
 * hyphen, and the part for the number (empty when no digit class follows the hyphen).
 */
function keyPatterns(source) {
	const found = [];
	for (const match of source.matchAll(KEY_PATTERN)) {
		const after = source.slice((match.index ?? 0) + match[0].length);
		const digits = DIGITS.exec(after)?.[0] ?? '';
		if (digits !== '') found.push({ pattern: match[0] + digits, digits });
	}
	return found;
}

/** Whether the number of a key pattern has a fixed or a highest count of digits. */
function limitsDigits({ digits }) {
	return !UNBOUNDED.test(digits);
}

function files(dir, pattern) {
	const result = [];
	for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) result.push(...files(path, pattern));
		else if (pattern.test(entry.name)) result.push(path);
	}
	return result;
}

const ALL = SOURCES.flatMap(([dir, pattern]) => files(dir, pattern));

describe('digits of ticket keys (KN-1)', () => {
	it('recognises bounded and unbounded patterns of keys', () => {
		const bounded = [
			String.raw`/^[A-Z]+-\d{1,4}$/`,
			String.raw`/[A-Z]{2,6}-[0-9]{3}/`,
			String.raw`new RegExp('^[A-Z]+-\\d{1,3}$')`,
			String.raw`pattern: '^[A-Z]{2,6}-[0-9]{1,6}$'`,
			String.raw`/\b([A-Z]+)-(\d{2,})\b/`,
			String.raw`/[A-Z]+\-\d\d?\d?/`,
			String.raw`/[A-Z]{2,6}-(?:\d{1,5})/`,
			String.raw`/[A-Z0-9]+-\d{4}/`
		];
		for (const source of bounded) {
			const found = keyPatterns(source);
			expect(found, source).toHaveLength(1);
			expect(limitsDigits(found[0]), source).toBe(true);
		}
		const unbounded = [
			String.raw`/^([A-Z]+)-(\d+)$/`,
			String.raw`/\b[A-Z]{2,6}-[0-9]+\b/`,
			String.raw`new RegExp('^[A-Z]+-\\d+$')`,
			String.raw`/[A-Z]+-(?:\d*)/`
		];
		for (const source of unbounded) {
			const found = keyPatterns(source);
			expect(found, source).toHaveLength(1);
			expect(limitsDigits(found[0]), source).toBe(false);
		}
		// Patterns of other things are no keys: dates, codes alone, tokens.
		for (const source of [
			String.raw`/^(\d{4})-(\d{2})-(\d{2})$/`,
			String.raw`/^[A-Z]{2,6}$/`,
			String.raw`/[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/`,
			String.raw`/[A-Za-z0-9._%+\-]+@((?:[A-Za-z0-9\-]+\.)+[A-Za-z]{2,})/g`
		]) {
			expect(keyPatterns(source), source).toEqual([]);
		}
	});

	it('scans the hooks, the migrations and the web app', () => {
		const dirs = new Set(ALL.map((path) => relative(ROOT, path).split(/[\\/]/).slice(0, 2).join('/')));
		expect([...dirs].sort()).toEqual(['app/pb_hooks', 'app/pb_migrations', 'web/src']);
		// The sort of the table reads keys with a number of any length.
		const ordering = readFileSync(join(ROOT, 'web/src/lib/domain/ordering.ts'), 'utf8');
		expect(keyPatterns(ordering)).toEqual([{ pattern: String.raw`[A-Z]+)-(\d+`, digits: String.raw`\d+` }]);
	});

	it('finds no pattern of a key with a limited number of digits', () => {
		const offenders = [];
		for (const path of ALL) {
			for (const found of keyPatterns(readFileSync(join(ROOT, path), 'utf8'))) {
				if (limitsDigits(found)) offenders.push(`${relative(ROOT, path)}: ${found.pattern}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
