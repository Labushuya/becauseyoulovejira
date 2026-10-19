// Guard of the risk assessment docs/security/bewertungen/GHSA-pxg6-pf52-xh8x.md (cookie < 0.7.0,
// Dependabot alert #1, VEX not_affected; SEC-2): the assumptions A1 to A4 and A6 of its section 5
// are checked statically, so a change that tips one of them fails with a pointer to the assessment
// instead of going unnoticed. A5 (no server cookie code of SvelteKit in app/pb_public) needs a
// build and stays a manual check of the assessment. web/svelte.config.js is loaded as SvelteKit
// loads it, so web/node_modules must be installed (like for the web build).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import svelteConfig from '../../web/svelte.config.js';
import { scaled } from '../support/timing.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const WEB = join(ROOT, 'web');
const WEB_SRC = join(WEB, 'src');
const ROUTES = join(WEB_SRC, 'routes');
const ROOT_LAYOUT = join(ROUTES, '+layout.ts');
const HOOKS = join(ROOT, 'app', 'pb_hooks');
const ASSESSMENT = 'docs/security/bewertungen/GHSA-pxg6-pf52-xh8x.md';

/** Message of a failed check: names the assumption and the assessment to redo. */
const violated = (assumption) => `Annahme ${assumption} der Bewertung GHSA-pxg6-pf52-xh8x verletzt – neu bewerten: ${ASSESSMENT}`;

/** Path relative to the root with forward slashes, for the messages. */
const shown = (path) => relative(ROOT, path).replaceAll('\\', '/');

/** Every file and folder below dir. */
function entries(dir) {
	return readdirSync(dir, { recursive: true, withFileTypes: true }).map((entry) => ({
		path: join(entry.parentPath, entry.name),
		name: entry.name,
		file: entry.isFile()
	}));
}

/** Source without comments, so a commented-out line never counts. */
function code(path) {
	return readFileSync(path, 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Names SvelteKit runs on the server: endpoints, server loads, server hooks (a file or a folder
// with an index) and remote functions.
const SERVER_CODE = [/^\+server\./, /^\+page\.server\./, /^\+layout\.server\./, /^hooks\.server(\.|$)/, /\.remote\./];

/** Values a file gives its export `ssr`, as written ("false", "true", "!dev" …). */
function ssrExports(path) {
	const source = code(path);
	const values = [...source.matchAll(/\bexport\s+(?:const|let|var)\s+ssr\s*=\s*([^;\r\n]+)/g)].map((match) => match[1].trim());
	// An export list or a re-export cannot be read here, so it counts like a value other than false.
	if (/\bexport\s*\{[^}]*\bssr\b/.test(source)) values.push('export { … }');
	return values;
}

/** package-lock.json of the root, of web and of every folder below helpers and extensions. */
function lockfiles() {
	const below = (dir) =>
		readdirSync(join(ROOT, dir), { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => `${dir}/${entry.name}/package-lock.json`);
	return ['package-lock.json', 'web/package-lock.json', ...below('helpers'), ...below('extensions')].filter((file) => existsSync(join(ROOT, file)));
}

/** Name of a package from its key in "packages" of a lockfile ("" is the project itself). */
const packageName = (key) => (key === '' ? '(Projekt)' : key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length));

// The checks read about 1200 files (10 MB); on a cold disk cache (a fresh worktree beside a virus
// scanner) A4 alone once took longer than the 5 s of Vitest.
describe('assumptions of the assessment GHSA-pxg6-pf52-xh8x (cookie < 0.7.0)', { timeout: scaled(30_000) }, () => {
	it('A1: web/src holds no server code of SvelteKit (+server, +page.server, +layout.server, hooks.server, *.remote)', () => {
		const all = entries(WEB_SRC);
		expect(all.filter((entry) => entry.file).length, 'files below web/src').toBeGreaterThan(100);
		const found = all.filter((entry) => SERVER_CODE.some((pattern) => pattern.test(entry.name))).map((entry) => shown(entry.path));
		expect(found, violated('A1')).toEqual([]);
		// SvelteKit looks for routes and hooks at its default places below web/src only.
		expect(svelteConfig.kit.files, violated('A1')).toBeUndefined();
	});

	it('A2: web/svelte.config.js builds with adapter-static and sets no experimental option (Remote Functions)', () => {
		const source = code(join(WEB, 'svelte.config.js'));
		const imported = /^import\s+(\w+)\s+from\s+['"]@sveltejs\/adapter-static['"];?$/m.exec(source);
		expect(imported, violated('A2')).not.toBeNull();
		expect(source, violated('A2')).toMatch(new RegExp(`\\badapter:\\s*${imported[1]}\\(`));
		const adapters = [...source.matchAll(/from\s+['"]([^'"]*adapter[^'"]*)['"]/g)].map((match) => match[1]);
		expect(adapters, violated('A2')).toEqual(['@sveltejs/adapter-static']);
		expect(svelteConfig.kit.adapter?.name, violated('A2')).toBe('@sveltejs/adapter-static');
		// Remote Functions need kit.experimental.remoteFunctions; the assessment found no key experimental at all.
		expect(source, violated('A2')).not.toMatch(/\b(?:experimental|remoteFunctions)\b/);
		expect(svelteConfig.kit.experimental, violated('A2')).toBeUndefined();
	});

	it('A3: the root layout turns SSR off and no other layout or page turns it on', () => {
		expect(existsSync(ROOT_LAYOUT), violated('A3')).toBe(true);
		expect(ssrExports(ROOT_LAYOUT), violated('A3')).toEqual(['false']);
		const others = entries(ROUTES).filter((entry) => entry.file && /^\+(?:layout|page)\./.test(entry.name) && entry.path !== ROOT_LAYOUT);
		expect(others.length, 'layouts and pages below web/src/routes').toBeGreaterThan(0);
		const turnedOn = others.flatMap((entry) =>
			ssrExports(entry.path)
				.filter((value) => value !== 'false')
				.map((value) => `${shown(entry.path)}: ssr = ${value}`)
		);
		expect(turnedOn, violated('A3')).toEqual([]);
	});

	it('A4: neither web/src nor app/pb_hooks uses exportToCookie or loadFromCookie of the PocketBase SDK', () => {
		const files = [WEB_SRC, HOOKS].flatMap((dir) => entries(dir).filter((entry) => entry.file));
		expect(files.length, 'files below web/src and app/pb_hooks').toBeGreaterThan(100);
		// The name alone, so a call through brackets or a destructured method counts as well.
		const found = files.filter((entry) => /\b(?:exportToCookie|loadFromCookie)\b/.test(readFileSync(entry.path, 'utf8'))).map((entry) => shown(entry.path));
		expect(found, violated('A4')).toEqual([]);
	});

	it('A6: only @sveltejs/kit asks for cookie, and only in web/package-lock.json', () => {
		const files = lockfiles();
		expect(files).toEqual(expect.arrayContaining(['package-lock.json', 'web/package-lock.json']));
		const requests = [];
		const installed = [];
		for (const file of files) {
			const lock = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
			// Lockfile versions 2 and 3 list every installed package under "packages" with what it asks for.
			expect(lock.packages, `${file} has no "packages" (lockfile version 2 or 3), so A6 cannot be checked`).toBeTypeOf('object');
			for (const [key, entry] of Object.entries(lock.packages)) {
				if (/(?:^|\/)node_modules\/cookie$/.test(key)) installed.push(`${file}: ${key}`);
				for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
					if (entry[field]?.cookie !== undefined) requests.push({ file, name: packageName(key), field });
				}
			}
		}
		const foreign = requests
			.filter((request) => request.file !== 'web/package-lock.json' || request.name !== '@sveltejs/kit')
			.map((request) => `${request.file}: ${request.name} (${request.field})`);
		expect(foreign, violated('A6')).toEqual([]);
		expect(installed.filter((entry) => !entry.startsWith('web/package-lock.json: ')), violated('A6')).toEqual([]);
	});
});
