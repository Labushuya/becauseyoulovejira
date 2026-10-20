// Modules of the views that work without a connection (OF-2, concept OF-0 §3.11): SvelteKit loads
// the code of a route only when it is opened, and without a connection that fails, and the error
// page would reload the tab onto the offline page of Chrome. Once the outbox works and the server
// answers, the app loads them ahead: "Aufgaben", the day plan, the inbox and the ticket in each of
// them (panel and full view). The editor stays on demand; offline the comment falls back to the
// text field.

import { preloadCode } from '$app/navigation';

/** Paths that match the routes of the views of the outbox (`*` stands for any ID). */
export const OFFLINE_VIEW_PATHS = Object.freeze([
	'/',
	'/tickets/*',
	'/tickets/*/voll',
	'/tagesplan',
	'/tagesplan/tickets/*',
	'/tagesplan/tickets/*/voll',
	'/eingang',
	'/eingang/*',
	'/eingang/tickets/*',
	'/eingang/tickets/*/voll'
]);

/** Loads the modules of those views; a failure stays quiet (the next navigation loads them). */
export function preloadOfflineViews(load: (path: string) => Promise<void> = preloadCode): void {
	for (const path of OFFLINE_VIEW_PATHS) void load(path).catch(() => undefined);
}
