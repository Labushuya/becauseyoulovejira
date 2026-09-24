// Projects (E3 plan, T-11). Pure. The code rule mirrors app/pb_hooks/lib/ticket-key.js
// (tests/unit/web-project-code.test.mjs keeps both equal); the hooks stay authoritative.

import type { ProjectRef } from './ticket';

/** Project of the catalog: the reference plus `updated`, so older events can be ignored. */
export interface Project extends ProjectRef {
	/** UTC timestamp of PocketBase; sorts as text. */
	updated: string;
}

/** Key prefix of tickets without a project; not allowed as project code (E1 plan, OF-14). */
export const RESERVED_CODE = 'TASK';

/** 2 to 6 uppercase letters A–Z, like the schema pattern of projects.code. */
export const PROJECT_CODE_PATTERN = /^[A-Z]{2,6}$/;
export const PROJECT_CODE_MAX_LENGTH = 6;

/** Length limit of projects.name (tests/unit/web-limits.test.mjs keeps it equal to the schema). */
export const PROJECT_NAME_MAX_LENGTH = 100;

/** Letters a single-word name contributes to a suggested code ("Haushalt" → "HAUS"). */
const SINGLE_WORD_CODE_LENGTH = 4;

/** Fields a user sets on a project; owner, scope and household come from the data layer. */
export interface ProjectDraft {
	name: string;
	code: string;
}

export type ProjectPatch = Partial<ProjectDraft>;

export function isValidProjectCode(code: string): boolean {
	return PROJECT_CODE_PATTERN.test(code) && code !== RESERVED_CODE;
}

/** Uppercase A–Z words of a name: umlauts as AE/OE/UE, ß as SS, other accents dropped. */
function codeWords(name: string): string[] {
	const transliterated = name
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/Ä/g, 'AE')
		.replace(/Ö/g, 'OE')
		.replace(/Ü/g, 'UE')
		.replace(/ß/g, 'ss')
		.replace(/ẞ/g, 'SS')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toUpperCase();
	return transliterated.split(/[^A-Z]+/).filter((word) => word !== '');
}

/**
 * Code suggested for a project name (T-11), editable by the user: the initials of up to six
 * words ("Garten und Haus" → "GUH"), for a single word its first four letters ("Büro" →
 * "BUER"). Returns '' if no valid code comes out (too few letters, or the reserved TASK).
 */
export function suggestProjectCode(name: string): string {
	const words = codeWords(name);
	const code =
		words.length > 1
			? words
					.slice(0, PROJECT_CODE_MAX_LENGTH)
					.map((word) => word[0])
					.join('')
			: (words[0] ?? '').slice(0, SINGLE_WORD_CODE_LENGTH);
	return isValidProjectCode(code) ? code : '';
}
