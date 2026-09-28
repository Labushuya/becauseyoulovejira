// Launches of the installed web app (ADR-0035 section 8; plan start-fenster, SF-5): the manifest
// asks for "focus-existing", so a new launch (start menu, start.bat, the bookmarklet) focuses the
// open window instead of opening another one, and the browser hands the address of the launch to
// window.launchQueue. A launch of the start page only focuses; another page of the app (such as
// /eingang/neu?… of the bookmarklet) is opened in the focused window. Unsaved input asks first,
// through the beforeNavigate question of the page (CLAUDE.md section 7).

import type { ResolvedPathname } from '$app/types';

/** The start_url of the manifest: launching it only focuses the window. */
export const START_PATH = '/';

/** Path to open for a launch, or null (other origin, the start page, the page already shown). */
export function launchTarget(targetURL: unknown, current: URL): ResolvedPathname | null {
	if (typeof targetURL !== 'string') return null;
	let url: URL;
	try {
		url = new URL(targetURL);
	} catch {
		return null;
	}
	if (url.origin !== current.origin) return null;
	const path = `${url.pathname}${url.search}${url.hash}`;
	if (path === START_PATH || path === `${current.pathname}${current.search}${current.hash}`) {
		return null;
	}
	// A path of the own origin; the router of the app checks it like any typed address.
	return path as ResolvedPathname;
}

interface LaunchQueue {
	setConsumer(consumer: (params: { targetURL?: unknown }) => void): void;
}

/** Hands launches to `navigate`; without the Launch Handler API (Firefox, a tab) nothing happens. */
export function consumeLaunches(
	win: Window,
	navigate: (path: ResolvedPathname) => void,
	current: () => URL
): void {
	const queue = (win as Window & { launchQueue?: LaunchQueue }).launchQueue;
	if (queue === undefined || typeof queue.setConsumer !== 'function') return;
	queue.setConsumer((params) => {
		const target = launchTarget(params?.targetURL, current());
		if (target !== null) navigate(target);
	});
}
