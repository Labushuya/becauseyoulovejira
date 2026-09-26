// External links of the guides (ADR-0026 section 6): only fixed https addresses of the providers,
// never built from user data. Pure module.

/** Whether `href` is an absolute https address. */
export function isHttpsUrl(href: string): boolean {
	try {
		return new URL(href).protocol === 'https:';
	} catch {
		return false;
	}
}
