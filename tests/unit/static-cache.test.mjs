// Cache rule for the web build (ADR-0040, app/pb_hooks/lib/static-cache.js): pages and files of
// pb_public are revalidated on every load; API and admin UI keep the headers of PocketBase.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const { STATIC_CACHE_CONTROL, staticCacheControl } = loadHookLib('static-cache.js');

describe('static-cache.js', () => {
	it('asks the server again for pages, chunks and the version of the web build', () => {
		expect(STATIC_CACHE_CONTROL).toBe('no-cache');
		for (const path of [
			'/',
			'/tickets/abc',
			'/index.html',
			'/_app/version.json',
			'/_app/immutable/nodes/0.abc.js',
			'/service-worker.js',
			'/apis',
			'/_app'
		]) {
			expect(staticCacheControl('GET', path), path).toBe('no-cache');
			expect(staticCacheControl('HEAD', path), path).toBe('no-cache');
		}
	});

	it('leaves the API, the admin UI and other methods alone', () => {
		for (const path of ['/api', '/api/health', '/api/realtime', '/_', '/_/', '/_/#/collections']) {
			expect(staticCacheControl('GET', path), path).toBeNull();
		}
		expect(staticCacheControl('POST', '/')).toBeNull();
		expect(staticCacheControl('OPTIONS', '/tickets/abc')).toBeNull();
	});
});
