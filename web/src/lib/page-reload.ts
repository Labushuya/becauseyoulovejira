// Full page loads (ADR-0040), in one place so components and tests can replace them.

/** Loads `href` as a new document; the running version of the app is left. */
export function loadFully(href: string): void {
	window.location.assign(href);
}

/** Loads the current page again. */
export function reloadPage(): void {
	window.location.reload();
}
