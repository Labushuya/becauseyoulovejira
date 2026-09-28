/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Minimal service worker of the installable web app (ADR-0035 section 8; plan start-fenster, SF-5).
// SvelteKit builds and registers it. It keeps only the hint page "becauseyoulovejira läuft nicht"
// (per build version) and shows it when a navigation of the app finds no server; the rules live in
// $lib/sw/offline.ts. No module, no API answer and no data of the app is ever cached.

import { version } from '$service-worker';
import {
	OFFLINE_PAGE,
	isOwnOfflineCache,
	offlineCacheName,
	shouldServeOffline
} from '$lib/sw/offline';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = offlineCacheName(version);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.add(new Request(OFFLINE_PAGE, { cache: 'reload' })))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) =>
				Promise.all(
					names
						.filter((name) => isOwnOfflineCache(name) && name !== CACHE)
						.map((name) => caches.delete(name))
				)
			)
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	if (!shouldServeOffline(event.request, sw.location.origin)) return;
	event.respondWith(
		fetch(event.request).catch(async () => {
			const page = await caches.match(OFFLINE_PAGE, { cacheName: CACHE });
			return page ?? Response.error();
		})
	);
});
