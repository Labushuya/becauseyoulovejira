// Short syntax of the quick entry (CLAUDE.md section 7; E4 plan, T-10 and package 6): one line
// `Titel @CODE !hoch #tag`. Pure: projects and tags come from the catalog as parameters.
// Recognised tokens leave the title; unknown ones stay part of it. Per kind the first token wins,
// further ones stay in the title, so nothing typed gets lost silently. `@CODE` sets only active
// projects; an archived one gives a hint instead of an error.

import { PRIORITY_LABELS } from './labels';
import { projectChoiceLabel } from './project-tree';
import type { Priority } from './status';
import { TAG_NAME_MAX_LENGTH, findTagByName, normalizeTagName, tagNameKey } from './tag';
import { fitTitle } from './templates';
import type { ProjectRef, TagRef } from './ticket';

/** `!niedrig`, `!mittel`, `!hoch`, `!dringend` (any case). */
export const PRIORITY_WORDS: Readonly<Record<string, Priority>> = Object.freeze({
	niedrig: 'low',
	mittel: 'medium',
	hoch: 'high',
	dringend: 'urgent'
});

/** `!1` to `!4` in the order of the words: `!1` niedrig up to `!4` dringend. */
export const PRIORITY_NUMBERS: Readonly<Record<string, Priority>> = Object.freeze({
	'1': 'low',
	'2': 'medium',
	'3': 'high',
	'4': 'urgent'
});

/** A tag of the entry: the existing one of the catalog, or a name to create. */
export interface QuickTag {
	name: string;
	existing: TagRef | null;
}

export interface QuickEntry {
	/** The text without the recognised tokens, whitespace collapsed, at most 200 characters. */
	title: string;
	project: ProjectRef | null;
	priority: Priority | null;
	tags: QuickTag[];
	/** Hints on tokens that were not applied (archived project). */
	hints: string[];
}

const PROJECT_TOKEN = /^@([A-Za-z]{2,6})$/;
const PRIORITY_TOKEN = /^!(\S+)$/;
const TAG_TOKEN = /^#(\S+)$/;

function priorityOf(value: string): Priority | null {
	const key = value.toLowerCase();
	return PRIORITY_WORDS[key] ?? PRIORITY_NUMBERS[key] ?? null;
}

/**
 * Reads a line of the quick entry. `projects` are all projects of the catalog (archived ones
 * included, for the hint), `tags` all tags; a `#name` without a tag of that name (any case) is
 * a new tag.
 */
export function parseQuickEntry(
	text: string,
	projects: readonly ProjectRef[],
	tags: readonly TagRef[]
): QuickEntry {
	const rest: string[] = [];
	const entry: QuickEntry = { title: '', project: null, priority: null, tags: [], hints: [] };
	for (const token of text.split(/\s+/).filter((part) => part !== '')) {
		const code = PROJECT_TOKEN.exec(token)?.[1]?.toUpperCase();
		if (code !== undefined) {
			const project = projects.find((candidate) => candidate.code === code);
			if (project !== undefined && entry.project === null) {
				if (!project.archived) {
					entry.project = project;
					continue;
				}
				entry.hints.push(`Das Projekt ${code} ist archiviert und wird nicht gesetzt.`);
			}
		}
		const word = PRIORITY_TOKEN.exec(token)?.[1];
		if (word !== undefined && entry.priority === null) {
			const priority = priorityOf(word);
			if (priority !== null) {
				entry.priority = priority;
				continue;
			}
		}
		const name = TAG_TOKEN.exec(token)?.[1];
		if (name !== undefined && normalizeTagName(name).length <= TAG_NAME_MAX_LENGTH) {
			if (!entry.tags.some((tag) => tagNameKey(tag.name) === tagNameKey(name))) {
				const existing = findTagByName(tags, name);
				entry.tags.push({ name: existing?.name ?? name, existing });
			}
			continue;
		}
		rest.push(token);
	}
	entry.title = fitTitle(rest.join(' '));
	return entry;
}

/**
 * The line with the project chosen from the list (ADR-0042 section 3): the token that set the
 * project so far goes, `@CODE` of the chosen one comes at the end; null only removes the token.
 * The line stays the one source of the entry, and the user sees the short syntax at work.
 */
export function withProjectToken(
	text: string,
	code: string | null,
	projects: readonly ProjectRef[]
): string {
	let rest = text;
	for (const match of text.matchAll(/\S+/g)) {
		const found = PROJECT_TOKEN.exec(match[0])?.[1]?.toUpperCase();
		const project = projects.find((candidate) => candidate.code === found);
		if (project === undefined || project.archived) continue;
		const before = text.slice(0, match.index).trimEnd();
		const after = text.slice(match.index + match[0].length).trimStart();
		rest = before === '' || after === '' ? `${before}${after}` : `${before} ${after}`;
		break;
	}
	if (code === null) return rest;
	return rest.trim() === '' ? `@${code}` : `${rest.trimEnd()} @${code}`;
}

/** What the preview under the field names: project, priority and tags that were recognised. */
export function describeQuickEntry(entry: QuickEntry): string[] {
	const parts: string[] = [];
	// A sub project with its path, "Haus › Garten (GART)" (ADR-0034).
	if (entry.project !== null) parts.push(`Projekt: ${projectChoiceLabel(entry.project)}`);
	if (entry.priority !== null) parts.push(`Priorität: ${PRIORITY_LABELS[entry.priority]}`);
	if (entry.tags.length > 0) {
		const names = entry.tags.map((tag) => (tag.existing === null ? `${tag.name} (neu)` : tag.name));
		parts.push(`Tags: ${names.join(', ')}`);
	}
	return parts;
}
