// Search values for the operator `~` of PocketBase filters (E3 plan, package 11; ADR-0013
// section 2). Pure; no SDK call.

/**
 * Search text for the operator `~` (SQLite LIKE) of PocketBase 0.40.4, taken literally (E3 plan,
 * package 11). Finding of tests/integration/web-search.test.mjs: a value without "%" is wrapped
 * in "%…%" with "_" and "\" escaped, but a value with "%" goes to LIKE unchanged, so "50%" would
 * mean "starts with 50" and "_" would match any character. Escaping "\", "%" and "_" with a
 * backslash always gives a contains search for exactly the typed text.
 */
export function likeText(text: string): string {
	return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
