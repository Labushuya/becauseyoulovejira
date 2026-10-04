// Projects (E3 plan, T-11). Pure. The code rule mirrors app/pb_hooks/lib/ticket-key.js
// (tests/unit/web-project-code.test.mjs keeps both equal); the hooks stay authoritative.

import type { ProjectColor } from './colors';
import type { ProjectRef, TicketSummary } from './ticket';

/** Project of the catalog: the reference plus `updated`, so older events can be ignored. */
export interface Project extends ProjectRef {
	/** UTC timestamp of PocketBase; sorts as text. */
	updated: string;
	/**
	 * Stored parent project (ADR-0034), null for a top-level project. The data layer always sets
	 * it; objects built by hand (tests) may leave it out.
	 */
	parentId?: string | null;
	/**
	 * The server does not know `projects.parent` yet: the app runs the new hooks, but the migration
	 * waits for the next start (ADR-0034 section 5). Only the data layer sets it.
	 */
	withoutParentField?: boolean;
	/**
	 * The server does not know `projects.color` yet (ADR-0052, before the restart after the
	 * migration): the choice of the color is not offered. Only the data layer sets it.
	 */
	withoutColorField?: boolean;
	/** The account that created the project (`owner`); the data layer sets it (ADR-0061 §4). */
	owner?: string;
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
	/**
	 * Parent project (ADR-0034): an ID, null for none, absent to leave it as it is (and to send
	 * nothing before the migration).
	 */
	parentId?: string | null;
	/**
	 * Color of the project (ADR-0052): a key of the palette, null for none, absent to leave it as it
	 * is (and to send nothing before the migration).
	 */
	color?: ProjectColor | null;
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

/** Code as typed: trimmed and in capitals, so "haus" becomes "HAUS" (T-11). */
export function normalizeProjectCode(code: string): string {
	return code.trim().toUpperCase();
}

/** Why a name cannot name a project, or null if it can. */
export function projectNameProblem(name: string): string | null {
	const normalized = name.trim();
	if (normalized === '') return 'Der Name darf nicht leer sein.';
	if (normalized.length > PROJECT_NAME_MAX_LENGTH) {
		return `Höchstens ${PROJECT_NAME_MAX_LENGTH} Zeichen.`;
	}
	return null;
}

/** Why a (normalized) code is not allowed, or null if it is; the hooks stay authoritative. */
export function projectCodeProblem(code: string): string | null {
	if (code === '') return 'Bitte einen Code eingeben.';
	if (code === RESERVED_CODE) return `Der Code ${RESERVED_CODE} ist reserviert.`;
	return PROJECT_CODE_PATTERN.test(code) ? null : 'Nur 2 bis 6 Großbuchstaben (A–Z).';
}

/**
 * Tickets that are not done per project ID (OF-E3-1: "aktiv" on a project tile). A just
 * checked row that still stands with "Rückgängig" is done and does not count.
 */
export function countActiveByProject(
	tickets: Iterable<Pick<TicketSummary, 'projectId' | 'status'>>
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const ticket of tickets) {
		if (ticket.projectId === null || ticket.status === 'done') continue;
		counts.set(ticket.projectId, (counts.get(ticket.projectId) ?? 0) + 1);
	}
	return counts;
}
