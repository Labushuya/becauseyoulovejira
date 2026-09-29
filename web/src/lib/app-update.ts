// Rules for a new build while a tab is open (ADR-0040). Every build replaces the content-hashed
// modules under /_app/immutable; a tab of the previous version keeps working because the files of
// older builds stay, notices the new version through /_app/version.json and switches with a full
// page load at a calm moment. A module that still fails to load is loaded once more as a new
// document, guarded against loops. Pure module without runes; the effects live in the components.

/** Message of an error whose cause is a module that could not be loaded. */
export const MODULE_LOAD_MESSAGE = 'Ein Teil der App konnte nicht geladen werden.';
/** Message of every other error of the client. */
export const UNEXPECTED_MESSAGE = 'Ein unerwarteter Fehler ist aufgetreten.';

/** Key in sessionStorage: the address the error page loaded again, and when. */
export const RELOAD_ATTEMPT_KEY = 'byl-reload-attempt';
/** Within this time the same address is not loaded again by itself (loop guard). */
export const RELOAD_GUARD_MS = 60_000;

// Messages of Chromium, Firefox and Safari for a failed dynamic import, and of the preload helper
// of Vite for the style sheet of a module.
const MODULE_LOAD_PATTERNS = [
	/Failed to fetch dynamically imported module/i,
	/error loading dynamically imported module/i,
	/Importing a module script failed/i,
	/Unable to preload CSS/i
];

/** Whether `error` says that a module of the app could not be loaded. */
export function isModuleLoadError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return MODULE_LOAD_PATTERNS.some((pattern) => pattern.test(error.message));
}

/** What the error page and the static error page get for an error of the client. */
export function describeClientError(error: unknown): App.Error {
	return isModuleLoadError(error)
		? { message: MODULE_LOAD_MESSAGE, kind: 'module-load' }
		: { message: UNEXPECTED_MESSAGE };
}

type AttemptStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Whether the error page may load `href` once more by itself. It may, unless it did so for the
 * same address within RELOAD_GUARD_MS; the attempt is noted. Without storage there is no guard,
 * so the page never loads again by itself.
 */
export function claimReload(storage: AttemptStorage | null, href: string, now: number): boolean {
	if (storage === null) return false;
	try {
		const last: unknown = JSON.parse(storage.getItem(RELOAD_ATTEMPT_KEY) ?? 'null');
		if (
			typeof last === 'object' &&
			last !== null &&
			'href' in last &&
			'at' in last &&
			last.href === href &&
			typeof last.at === 'number' &&
			now - last.at >= 0 &&
			now - last.at < RELOAD_GUARD_MS
		) {
			return false;
		}
		storage.setItem(RELOAD_ATTEMPT_KEY, JSON.stringify({ href, at: now }));
		return true;
	} catch {
		// Storage blocked or full: no guard, no automatic load.
		return false;
	}
}

/** sessionStorage of `win`, or null where the browser blocks it. */
export function sessionStorageOf(win: Window): Storage | null {
	try {
		return win.sessionStorage;
	} catch {
		return null;
	}
}

export interface NavigationCheck {
	/** A new build was published since this tab loaded (`updated.current`). */
	updated: boolean;
	/** Type of the SvelteKit navigation. */
	type: string;
	/** The navigation leaves the document anyway. */
	willUnload: boolean;
	/** Typed text, a running bulk action or an offered "Rückgängig" would be lost. */
	busy: boolean;
}

/**
 * Whether a navigation becomes a full page load of its target, so the tab switches to the new
 * version: only a click on a link after an update, and not while something would be lost. The
 * question "Änderungen verwerfen?" has already let the navigation pass at this point.
 */
export function shouldReloadOnNavigate(check: NavigationCheck): boolean {
	return check.updated && check.type === 'link' && !check.willUnload && !check.busy;
}
