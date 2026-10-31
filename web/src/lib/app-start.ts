// The address the app opened (MO-7c2, ADR-0073 addendum MO-7c2): held once when the app starts
// (hooks.client.ts `init`), before the root layout checks the stored session, and taken once by the
// app layout when it shows. With a stored session the root layout renders the app only after that
// check, so the first navigation is over by then; the start view of the phone frame is decided from
// this address instead of from that navigation. Taken, it is gone: a second sign-in in the same tab
// and every later navigation keep their page.

import type { StartAddress } from '$lib/domain/phone-layout';

let held: StartAddress | null = null;

/** How the document came (PerformanceNavigationTiming.type); '' where the browser does not say. */
function navigationOf(win: Window): string {
	try {
		const type = (
			win.performance.getEntriesByType('navigation')[0] as { type?: unknown } | undefined
		)?.type;
		return typeof type === 'string' ? type : '';
	} catch {
		return '';
	}
}

/** Holds the address of the document as it opened; the app calls it once, when it starts. */
export function holdStart(win: Window): void {
	const { pathname, search, hash, origin } = win.location;
	held = {
		pathname,
		search,
		hash,
		referrer: win.document.referrer,
		origin,
		navigation: navigationOf(win)
	};
}

/** The held address, once; null afterwards and when none was held. */
export function takeStart(): StartAddress | null {
	const start = held;
	held = null;
	return start;
}
