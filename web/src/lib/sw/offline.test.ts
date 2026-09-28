// Service worker of the installable web app (ADR-0035 section 8; plan start-fenster, SF-5): it
// handles only GET navigations to pages of the app, never /api/ or the admin UI /_/, keeps only
// the offline page in a cache per build and removes only its own old caches. The worker itself
// is checked statically: no other file is ever put into a cache.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFLINE_PAGE, isOwnOfflineCache, offlineCacheName, shouldServeOffline } from './offline';

const ORIGIN = 'http://127.0.0.1:8090';
const WORKER = readFileSync(join(import.meta.dirname, '..', '..', 'service-worker.ts'), 'utf8');
const navigate = (path: string, extra: Partial<{ mode: string; method: string }> = {}) => ({
	mode: 'navigate',
	method: 'GET',
	url: path.startsWith('http') ? path : `${ORIGIN}${path}`,
	...extra
});

describe('shouldServeOffline', () => {
	it.each(['/', '/tickets/abc123', '/eingang/neu?titel=x', '/einstellungen/darstellung', '/apix'])(
		'handles the navigation to %s',
		(path) => {
			expect(shouldServeOffline(navigate(path), ORIGIN)).toBe(true);
		}
	);

	it.each(['/api', '/api/health', '/api/collections/tickets/records', '/_', '/_/', '/_/#/login'])(
		'leaves %s to the network',
		(path) => {
			expect(shouldServeOffline(navigate(path), ORIGIN)).toBe(false);
		}
	);

	it('leaves requests that are no GET navigation of the own origin alone', () => {
		expect(shouldServeOffline(navigate('/', { mode: 'cors' }), ORIGIN)).toBe(false);
		expect(shouldServeOffline(navigate('/', { mode: 'no-cors' }), ORIGIN)).toBe(false);
		expect(shouldServeOffline(navigate('/', { method: 'POST' }), ORIGIN)).toBe(false);
		expect(shouldServeOffline(navigate('https://example.com/'), ORIGIN)).toBe(false);
		expect(shouldServeOffline(navigate('http://localhost:8090/'), ORIGIN)).toBe(false);
		expect(shouldServeOffline({ mode: 'navigate', method: 'GET', url: 'kein url' }, ORIGIN)).toBe(
			false
		);
	});
});

describe('caches', () => {
	it('names one cache per build and knows only its own', () => {
		expect(OFFLINE_PAGE).toBe('/offline.html');
		expect(offlineCacheName('1790000000000')).toBe('byl-offline-1790000000000');
		expect(isOwnOfflineCache('byl-offline-1')).toBe(true);
		expect(isOwnOfflineCache('workbox-precache')).toBe(false);
	});
});

describe('service-worker.ts', () => {
	it('puts only the offline page into its cache', () => {
		expect(WORKER.match(/cache\.add\(/g)).toHaveLength(1);
		expect(WORKER).toContain('cache.add(new Request(OFFLINE_PAGE');
		expect(WORKER).not.toMatch(/addAll|cache\.put|\.put\(/);
		// Only the version of $service-worker, not the lists of built or static files to cache.
		expect(WORKER).toContain("import { version } from '$service-worker';");
	});

	it('answers only what shouldServeOffline allows, and only when the network fails', () => {
		const fetchHandler = WORKER.slice(WORKER.indexOf("addEventListener('fetch'"));
		expect(fetchHandler).toMatch(
			/if \(!shouldServeOffline\(event\.request, sw\.location\.origin\)\) return;\s*event\.respondWith\(\s*fetch\(event\.request\)\.catch\(/
		);
	});

	it('removes only its own old caches', () => {
		expect(WORKER).toContain('isOwnOfflineCache(name) && name !== CACHE');
	});
});
