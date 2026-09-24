// Route guard rules (E1 plan, package 7). Pure functions; the root layout applies them.

export const LOGIN_PATH = '/login';
const HOME_PATH = '/';

function isInternalPath(path: string): boolean {
	return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

function hasControlCharacter(text: string): boolean {
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code < 0x20 || code === 0x7f) return true;
	}
	return false;
}

/**
 * Internal path to continue with after the login, "/" for anything else (no open redirect).
 * Accepted: "/..." on the given origin, not "//..." or "/\...", no scheme. Control characters
 * are rejected because the URL parser drops tabs and line breaks ("/\t/evil" becomes
 * "//evil"), and the normalized path is checked again ("/..//evil" becomes "//evil").
 */
export function safeRedirect(target: string | null | undefined, origin: string): string {
	if (!target || !isInternalPath(target) || hasControlCharacter(target)) return HOME_PATH;
	let url: URL;
	try {
		url = new URL(target, origin);
	} catch {
		return HOME_PATH;
	}
	const path = url.pathname + url.search + url.hash;
	return url.origin === origin && isInternalPath(path) ? path : HOME_PATH;
}

/** Login URL that leads back to `url` after the login; "/" needs no redirect parameter. */
export function loginUrlFor(url: URL): string {
	const target = url.pathname + url.search + url.hash;
	if (target === HOME_PATH) return LOGIN_PATH;
	return `${LOGIN_PATH}?${new URLSearchParams({ redirect: target })}`;
}

/**
 * Where the guard sends the current URL, or null if the page may be shown. Without a session
 * only the login page is reachable; with a session the login page forwards to the validated
 * redirect target (the same target the login page navigates to after a successful login).
 */
export function guardTarget(url: URL, loggedIn: boolean): string | null {
	const onLoginPage = url.pathname === LOGIN_PATH;
	if (loggedIn) {
		return onLoginPage ? safeRedirect(url.searchParams.get('redirect'), url.origin) : null;
	}
	return onLoginPage ? null : loginUrlFor(url);
}
