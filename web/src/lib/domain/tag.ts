// Tags (E3 plan, T-14). Pure.

import type { TagRef } from './ticket';

/** Length limit of tags.name (tests/unit/web-limits.test.mjs keeps it equal to the schema). */
export const TAG_NAME_MAX_LENGTH = 50;

/** Tag of the catalog: the reference plus `updated`, so older events can be ignored. */
export interface Tag extends TagRef {
	/** UTC timestamp of PocketBase; sorts as text. */
	updated: string;
}

/** Name as it is stored: trimmed, inner spaces kept. */
export function normalizeTagName(name: string): string {
	return name.trim();
}

/** Key for comparing names regardless of case ("Garten" = "garten" = " GARTEN "). */
export function tagNameKey(name: string): string {
	return normalizeTagName(name).toLowerCase();
}

/**
 * Existing tag with the same name regardless of case (T-14). The server index folds ASCII only;
 * folding every letter here reuses at least what the server would refuse.
 */
export function findTagByName<T extends TagRef>(tags: readonly T[], name: string): T | null {
	const key = tagNameKey(name);
	return tags.find((tag) => tagNameKey(tag.name) === key) ?? null;
}

/** Why a name cannot become a tag, or null if it can. */
export function tagNameProblem(name: string): string | null {
	const normalized = normalizeTagName(name);
	if (normalized === '') return 'Der Name darf nicht leer sein.';
	if (normalized.length > TAG_NAME_MAX_LENGTH) {
		return `Höchstens ${TAG_NAME_MAX_LENGTH} Zeichen.`;
	}
	return null;
}

/**
 * Suggestions of the tag picker (T-14): tags not yet chosen whose name contains the input,
 * regardless of case, those starting with it first, then by the given order.
 */
export function tagSuggestions<T extends TagRef>(
	tags: readonly T[],
	chosen: readonly string[],
	input: string
): T[] {
	const key = tagNameKey(input);
	const open = tags.filter((tag) => !chosen.includes(tag.id));
	if (key === '') return open;
	const starts = open.filter((tag) => tagNameKey(tag.name).startsWith(key));
	const contains = open.filter(
		(tag) => !tagNameKey(tag.name).startsWith(key) && tagNameKey(tag.name).includes(key)
	);
	return [...starts, ...contains];
}
