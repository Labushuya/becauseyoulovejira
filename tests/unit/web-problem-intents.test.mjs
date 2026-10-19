// Catalog of intents (FP-1, ADR-0071 §3): every route of app/pb_hooks under /api/byl/ has an
// intent in web/src/lib/domain/problem-intents.ts, and every entry there belongs to a route (or to
// an action of the whitelist of a route with `{action}`), so the details of a failed request never
// say "Unbekannte Aktion" for a route of the app. The routes are read statically from the hook
// files, like the other parity tests. Also every collection the SPA reaches through the record API
// has its intents, and the catalog names no collection the schema does not know.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { BYL_ROUTE_INTENTS, COLLECTION_INTENTS, routeKey } from '../../web/src/lib/domain/problem-intents.ts';
import { SYSTEM_ACTIONS } from '../../web/src/lib/domain/system.ts';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const HOOKS = join(ROOT, 'app', 'pb_hooks');
const MIGRATIONS = join(ROOT, 'app', 'pb_migrations');
const WEB_LIB = join(ROOT, 'web', 'src', 'lib');

/** Source without comments, so a commented-out example never counts as a route. */
function code(path) {
	return readFileSync(path, 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every routerAdd(method, path, …) of the hook files, with the number of calls per file. */
function hookRoutes() {
	const routes = [];
	let calls = 0;
	for (const name of readdirSync(HOOKS).filter((file) => file.endsWith('.pb.js'))) {
		const source = code(join(HOOKS, name));
		calls += (source.match(/\brouterAdd\s*\(/g) ?? []).length;
		for (const match of source.matchAll(/\brouterAdd\s*\(\s*['"`]([A-Za-z]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]/g)) {
			routes.push({ file: name, method: match[1].toUpperCase(), path: match[2] });
		}
	}
	return { routes, calls };
}

/** Files of the SPA below web/src/lib, without tests. */
function webFiles(dir = WEB_LIB) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return webFiles(path);
		return /\.(ts|svelte)$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
	});
}

/**
 * Collections the SPA names in `collection(…)`: a literal, or a constant of the same file
 * (`const TICKETS = 'tickets'`), or the values of a map of collections (`RECORD_COLLECTIONS`).
 */
function spaCollections() {
	const found = new Set();
	for (const path of webFiles()) {
		const source = code(path);
		const constants = new Map(
			[...source.matchAll(/\bconst\s+([A-Z][A-Z_]*)\s*=\s*'([a-z_]+)'/g)].map((match) => [match[1], match[2]])
		);
		for (const match of source.matchAll(/\.collection\(\s*(?:'([a-z_]+)'|([A-Z][A-Z_]*)\b)/g)) {
			const name = match[1] ?? constants.get(match[2]);
			if (name !== undefined) found.add(name);
			else if (match[2] !== undefined) {
				const map = new RegExp(`\\bconst\\s+${match[2]}\\b[^=]*=\\s*\\{([^}]*)\\}`).exec(source);
				for (const value of map?.[1].matchAll(/:\s*'([a-z_]+)'/g) ?? []) found.add(value[1]);
			}
		}
	}
	return found;
}

/** Collections of the schema: created by a migration, plus the users of PocketBase. */
function schemaCollections() {
	const names = new Set(['users']);
	for (const name of readdirSync(MIGRATIONS).filter((file) => file.endsWith('.js'))) {
		const source = readFileSync(join(MIGRATIONS, name), 'utf8');
		for (const match of source.matchAll(/new Collection\(\{[\s\S]*?\bname:\s*'([a-z_]+)'/g)) names.add(match[1]);
	}
	return names;
}

describe('catalog of intents and the routes of app/pb_hooks', () => {
	const { routes, calls } = hookRoutes();
	const byl = routes.filter((route) => route.path.startsWith('/api/byl/'));

	it('reads every route of the hook files', () => {
		expect(routes).toHaveLength(calls);
		expect(byl.length).toBeGreaterThan(100);
		expect(byl).toContainEqual({
			file: 'tickets.pb.js',
			method: 'POST',
			path: '/api/byl/tickets/{id}/subtasks/transfer'
		});
	});

	it('has an intent for every route under /api/byl/', () => {
		const missing = byl.map((route) => routeKey(route.method, route.path)).filter((key) => !Object.hasOwn(BYL_ROUTE_INTENTS, key));
		expect(missing).toEqual([]);
	});

	it('names no route that is gone; a single action belongs to the whitelist of its route', () => {
		const keys = new Set(byl.map((route) => routeKey(route.method, route.path)));
		const storageActions = loadHookLib('storage-rules.js').ACTIONS;
		const actions = {
			'POST /api/byl/system/actions/*': [...SYSTEM_ACTIONS],
			'POST /api/byl/storage/actions/*': [...storageActions]
		};
		const stale = Object.keys(BYL_ROUTE_INTENTS).filter((key) => {
			if (keys.has(key)) return false;
			const parent = key.replace(/\/[^/]+$/, '/*');
			const action = key.slice(key.lastIndexOf('/') + 1);
			return !keys.has(parent) || !(actions[parent] ?? []).includes(action);
		});
		expect(stale).toEqual([]);
	});
});

describe('catalog of intents and the collections of the SPA', () => {
	it('has the intents of the record API for every collection the SPA reaches', () => {
		const used = spaCollections();
		expect([...used]).toEqual(expect.arrayContaining(['tickets', 'connections', 'inbox_items', 'users']));
		expect([...used].filter((name) => !Object.hasOwn(COLLECTION_INTENTS, name))).toEqual([]);
	});

	it('names only collections of the schema', () => {
		const schema = schemaCollections();
		expect(schema.has('tickets')).toBe(true);
		expect(Object.keys(COLLECTION_INTENTS).filter((name) => !schema.has(name))).toEqual([]);
	});
});
