// Rules of the service worker (ADR-0035 section 8; plan start-fenster, SF-5): it exists for the
// installability of the web app and for one hint page. It keeps only that page and answers with it
// only when a navigation of the app itself finds no server. Everything else, above all /api/ and
// the admin UI /_/, goes to the network untouched; no data of the app is ever cached (CLAUDE.md
// section 10: no offline mode).

/** The hint page in web/static, kept by the service worker. */
export const OFFLINE_PAGE = '/offline.html';

const CACHE_PREFIX = 'byl-offline-';

/** Name of the cache of one build; a new build gets a new cache and removes the old ones. */
export function offlineCacheName(version: string): string {
	return `${CACHE_PREFIX}${version}`;
}

/** Whether a cache belongs to this service worker (other caches of the origin stay alone). */
export function isOwnOfflineCache(name: string): boolean {
	return name.startsWith(CACHE_PREFIX);
}

/** What the rule needs of a request. */
export interface RequestFacts {
	mode: string;
	method: string;
	url: string;
}

/**
 * Whether the service worker handles a request at all: only GET navigations of its own origin to
 * pages of the app. The API, the admin UI and every other request stay with the browser.
 */
export function shouldServeOffline(request: RequestFacts, origin: string): boolean {
	if (request.mode !== 'navigate' || request.method !== 'GET') return false;
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return false;
	}
	if (url.origin !== origin) return false;
	const path = url.pathname;
	return !(path === '/api' || path.startsWith('/api/') || path === '/_' || path.startsWith('/_/'));
}
