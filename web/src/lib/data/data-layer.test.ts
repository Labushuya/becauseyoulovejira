// Static rules of the data layer (ADR-0006 section 1, E2 plan package 4): no SvelteKit or app
// imports (the root integration tests load the modules directly), filters only through
// pb.filter(), no `any`, and every exported access function takes the PocketBase instance first
// and accepts a signal.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DATA_DIR = import.meta.dirname;
const modules = readdirSync(DATA_DIR).filter(
	(name) => name.endsWith('.ts') && !name.endsWith('.test.ts')
);

function read(name: string): string {
	return readFileSync(join(DATA_DIR, name), 'utf8');
}

describe('web/src/lib/data', () => {
	it('contains the E2 and E3 modules', () => {
		expect(modules).toEqual(
			expect.arrayContaining([
				'comments.ts',
				'errors.ts',
				'history.ts',
				'projects.ts',
				'tags.ts',
				'tickets.ts'
			])
		);
	});

	it.each(modules)('%s imports only the SDK types, domain and data modules', (name) => {
		for (const [, specifier] of read(name).matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
			expect(specifier, `${name} imports ${specifier}`).toMatch(
				/^(?:pocketbase|\.\/[\w-]+|\.\.\/domain\/[\w-]+)$/
			);
		}
		expect(read(name)).not.toMatch(/\$lib|\$app/);
	});

	it.each(modules)('%s imports the SDK for types only', (name) => {
		for (const [statement] of read(name).matchAll(/^import[^;]*from\s+'pocketbase';/gm)) {
			expect(statement).toMatch(/^import type /);
		}
	});

	it.each(modules)('%s builds every filter with pb.filter()', (name) => {
		for (const [, value] of read(name).matchAll(/\bfilter:\s*([^\n]+)/g)) {
			expect(value, `${name}: filter ${value}`).toMatch(
				/^pb\.filter\(('[^'`$+]*'|[A-Z_]+|[a-z]\w*Expression\(\w+\)),/
			);
		}
	});

	it.each(modules)('%s chooses filter expressions only among constants', (name) => {
		// A function *Expression (E4 package 9: the source clause joins only when a source is
		// chosen) may only pick and join constants, so every value still reaches the server as a
		// parameter of pb.filter().
		const code = read(name);
		for (const [, fn = ''] of code.matchAll(/\bfilter:\s*pb\.filter\(([a-z]\w*Expression)\(/g)) {
			const body = new RegExp(
				`^function ${fn}\\([^)]*\\): string \\{\\n([\\s\\S]*?)\\n\\}$`,
				'm'
			).exec(code)?.[1];
			expect(body, `${name}: definition of ${fn}`).toBeDefined();
			const shape = (body ?? '').replace(/\$\{[A-Z_]+\}/g, 'C').replace(/\b[A-Z_]{2,}\b/g, 'C');
			expect(shape.trim(), `${name}: ${fn}`).toMatch(
				/^return query\.\w+ === null \? C : `C( && C)*`;$/
			);
			for (const [, constant = ''] of (body ?? '').matchAll(/\b([A-Z_]{2,})\b/g)) {
				const definition = new RegExp(
					`^const ${constant} = \\[\\n([\\s\\S]*?)\\n\\]\\.join\\(' && '\\);$`,
					'm'
				).exec(code);
				expect(definition, `${name}: definition of ${constant}`).not.toBeNull();
				for (const line of definition?.[1]?.split('\n') ?? []) {
					expect(line, `${name}: ${constant}`).toMatch(/^\t'[^'`$+]*',?$/);
				}
			}
		}
	});

	it.each(modules)('%s builds filter constants only from plain text literals', (name) => {
		const code = read(name);
		for (const [, constant] of code.matchAll(/\bfilter:\s*pb\.filter\(([A-Z_]+),/g)) {
			const definition = new RegExp(
				`^const ${constant} = \\[\\n([\\s\\S]*?)\\n\\]\\.join\\(' && '\\);$`,
				'm'
			).exec(code);
			expect(definition, `${name}: definition of ${constant}`).not.toBeNull();
			for (const line of definition?.[1]?.split('\n') ?? []) {
				expect(line, `${name}: ${constant}`).toMatch(/^\t'[^'`$+]*',?$/);
			}
		}
	});

	it.each(modules)('%s has no any', (name) => {
		const code = read(name)
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/\/\/.*$/gm, '');
		expect(code).not.toMatch(/\bany\b/);
	});

	it.each(['tickets.ts', 'comments.ts', 'history.ts', 'projects.ts', 'tags.ts', 'inbox.ts'])(
		'%s: exported access functions take pb first and accept a signal',
		(name) => {
			const source = read(name);
			const signatures = [...source.matchAll(/^export function (\w+)\(([\s\S]*?)\)(?::|\s*\{)/gm)]
				.map(([, fn = '', params = '']) => ({ fn, params }))
				.filter(({ fn }) => !/^to[A-Z]/.test(fn));
			expect(signatures.length).toBeGreaterThan(0);
			for (const { fn, params } of signatures) {
				expect(params.trim(), fn).toMatch(/^pb: PocketBase/);
				expect(params, fn).toMatch(/RequestOptions/);
			}
		}
	);
});
