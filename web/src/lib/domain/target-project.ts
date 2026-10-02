// Target project of the ways into the inbox (ADR-0049, package 1 "Standardprojekt je Verbindung").
// Pure. Every way into the inbox (a connection, the own inbox, WhatsApp Web, the files) may have a
// target project; an entry keeps the target it got when it came in (`inbox_items.target_project`,
// set by the server only), and converting it chooses that project in advance unless it is archived
// or deleted. The names of the cards and the texts of the hook mirror
// app/pb_hooks/lib/target-project-rules.js (tests/unit/web-target-project.test.mjs).

import type { InboxChannel, InboxItemSummary } from './inbox';
import { projectChoiceLabel, projectFamily, treeOrder, type TreeProject } from './project-tree';
import type { ProjectRef } from './ticket';

/** Name of the setting, at the cards, in the panel, the filter and the column. */
export const TARGET_LABEL = 'Zielprojekt';

/** Cards without a connection record whose target the user keeps (users.inbox_targets). */
export const TARGET_CARDS = ['api', 'whatsapp-web', 'files'] as const;
export type TargetCard = (typeof TARGET_CARDS)[number];

/** Channels of the entries of each card (CARD_CHANNELS of the hook). */
export const CARD_CHANNELS: Readonly<Record<TargetCard, readonly InboxChannel[]>> = Object.freeze({
	api: ['api'],
	'whatsapp-web': ['whatsapp-web'],
	files: ['eml', 'ics', 'whatsapp']
});

/** Targets of the cards without a connection: a project ID or '' each. */
export type InboxTargets = Readonly<Record<TargetCard, string>>;

export const EMPTY_TARGETS: InboxTargets = Object.freeze({
	api: '',
	'whatsapp-web': '',
	files: ''
});

/** Note of the server in source_meta: the target project of the entry was deleted. */
export const TARGET_GONE_KEY = 'target_gone';

/**
 * Texts of the codes of the hooks (MESSAGES of target-project-rules.js), the same words in the
 * interface.
 */
export const TARGET_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_target_project_missing:
		'Dieses Projekt gibt es nicht oder es liegt in einem anderen Bereich.',
	validation_target_project_archived:
		'Ein archiviertes Projekt lässt sich nicht als Zielprojekt wählen.',
	validation_inbox_targets:
		'Zielprojekte nur für „api“, „whatsapp-web“ und „files“, je mit der ID eines Projekts oder leer.'
});

const RECORD_ID = /^[a-z0-9]{15}$/;

function isRecordId(value: unknown): value is string {
	return typeof value === 'string' && RECORD_ID.test(value);
}

/** The stored targets of a user; anything that is no record ID reads as none. */
export function inboxTargetsOf(value: unknown): InboxTargets {
	const stored =
		typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	const entry = (card: TargetCard) => (isRecordId(stored[card]) ? (stored[card] as string) : '');
	return { api: entry('api'), 'whatsapp-web': entry('whatsapp-web'), files: entry('files') };
}

/**
 * State of a target: none, an active or archived project of the catalog, or deleted (the server
 * noted it at the entry, or a stored ID is no longer in the catalog).
 */
export type TargetState =
	| { kind: 'none' }
	| { kind: 'active'; project: ProjectRef }
	| { kind: 'archived'; project: ProjectRef }
	| { kind: 'deleted' };

/** State of a stored target ID ('' or null for none) with the projects of the catalog. */
export function targetState(
	id: string | null | undefined,
	projects: readonly ProjectRef[],
	gone = false
): TargetState {
	if (id === null || id === undefined || id === '')
		return gone ? { kind: 'deleted' } : { kind: 'none' };
	const project = projects.find((entry) => entry.id === id);
	if (project === undefined) return { kind: 'deleted' };
	return project.archived ? { kind: 'archived', project } : { kind: 'active', project };
}

/**
 * State of the target of an entry: its target project, or the note that it was deleted. The server
 * empties the target of an entry when its project is deleted, so a target the catalog does not know
 * (not loaded yet) counts as none, not as deleted.
 */
export function targetOfItem(
	item: Pick<InboxItemSummary, 'targetProjectId' | 'sourceMeta'>,
	projects: readonly ProjectRef[]
): TargetState {
	const id = item.targetProjectId ?? null;
	if (id !== null && !projects.some((project) => project.id === id)) return { kind: 'none' };
	return targetState(id, projects, item.sourceMeta[TARGET_GONE_KEY] === true);
}

/**
 * The target as text in the panel and the column: "Haus › Garten (GART)", "… (archiviert)",
 * "gelöscht", or '' without one.
 */
export function targetText(state: TargetState): string {
	switch (state.kind) {
		case 'active':
			return projectChoiceLabel(state.project);
		case 'archived':
			return `${projectChoiceLabel(state.project)}, archiviert`;
		case 'deleted':
			return 'gelöscht';
		default:
			return '';
	}
}

/** Choice of a project when an entry is converted: the project, and the hint at the field. */
export interface TargetPrefill {
	/** Project chosen in advance, null for none. */
	project: string | null;
	/** Why the project is (not) chosen in advance; null without a target. */
	hint: string | null;
}

/**
 * What converting an entry chooses in advance (ADR-0049 §4): an active target project, never an
 * archived or deleted one; the hint says which and why. The user can change it in the form.
 */
export function targetPrefill(state: TargetState): TargetPrefill {
	switch (state.kind) {
		case 'active':
			return {
				project: state.project.id,
				hint: `Vorbelegt mit dem Zielprojekt „${projectChoiceLabel(state.project)}“ des Eingangswegs; du kannst es ändern.`
			};
		case 'archived':
			return {
				project: null,
				hint: `Das Zielprojekt „${projectChoiceLabel(state.project)}“ ist archiviert und wird nicht vorbelegt.`
			};
		case 'deleted':
			return {
				project: null,
				hint: 'Das Zielprojekt dieses Eintrags wurde gelöscht und wird nicht vorbelegt.'
			};
		default:
			return { project: null, hint: null };
	}
}

/** Projects of the entries for "Gesammelt umwandeln" (ADR-0049 §4). */
export interface BulkTargets {
	/** Entry ID to the active target project. */
	targets: Readonly<Record<string, string>>;
	/** Entries with an active target project. */
	active: number;
	/** Entries whose target project is archived or deleted: they get the project of the dialog. */
	unusable: number;
}

export function bulkTargets(
	items: readonly Pick<InboxItemSummary, 'id' | 'targetProjectId' | 'sourceMeta'>[],
	projects: readonly ProjectRef[]
): BulkTargets {
	const targets: Record<string, string> = {};
	let unusable = 0;
	for (const item of items) {
		const state = targetOfItem(item, projects);
		if (state.kind === 'active') targets[item.id] = state.project.id;
		else if (state.kind !== 'none') unusable += 1;
	}
	return { targets, active: Object.keys(targets).length, unusable };
}

/** Value of the filter "Zielprojekt" for entries without one (URL `zielprojekt=ohne`). */
export const NO_TARGET = 'ohne';

/**
 * Whether an entry passes the filter "Zielprojekt": `filter` is a project ID or NO_TARGET, null for
 * every entry. A project takes its sub projects in (ADR-0034 §6), the same set as the server
 * expression `target_project = p || target_project.parent = p`.
 */
export function matchesTarget(
	item: Pick<InboxItemSummary, 'targetProjectId'>,
	filter: string | null,
	projects: readonly TreeProject[]
): boolean {
	if (filter === null) return true;
	const id = item.targetProjectId ?? null;
	if (filter === NO_TARGET) return id === null;
	return id !== null && projectFamily(projects, filter, true).includes(id);
}

/** A group of the inbox by target project. */
export interface TargetGroup<T> {
	/** Project ID, '' for the group without a target. */
	key: string;
	/** Heading: "Haus › Garten (GART)", "… (archiviert)", "Ohne Zielprojekt". */
	label: string;
	items: T[];
}

/**
 * The entries grouped by their target project (ADR-0049 §5), in the order of the tree of the
 * catalog, the archived and unknown projects after the active ones, and "Ohne Zielprojekt" last.
 * The entries keep their order within a group; empty groups do not exist.
 */
export function groupByTarget<T extends Pick<InboxItemSummary, 'targetProjectId'>>(
	items: readonly T[],
	projects: readonly (TreeProject & ProjectRef)[]
): TargetGroup<T>[] {
	const byKey = new Map<string, T[]>();
	for (const item of items) {
		const key = item.targetProjectId ?? '';
		const list = byKey.get(key);
		if (list === undefined) byKey.set(key, [item]);
		else list.push(item);
	}
	const ordered = treeOrder(projects);
	const keys = [
		...ordered.filter((project) => !project.archived).map((project) => project.id),
		...ordered.filter((project) => project.archived).map((project) => project.id)
	];
	const groups: TargetGroup<T>[] = [];
	for (const key of keys) {
		const list = byKey.get(key);
		if (list === undefined) continue;
		byKey.delete(key);
		groups.push({ key, label: targetText(targetState(key, projects)), items: list });
	}
	const without = byKey.get('') ?? [];
	byKey.delete('');
	// Projects the catalog does not know (not loaded yet, another area): by ID, before "Ohne".
	for (const [key, list] of [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
		groups.push({ key, label: 'Unbekanntes Projekt', items: list });
	}
	if (without.length > 0) groups.push({ key: '', label: 'Ohne Zielprojekt', items: without });
	return groups;
}

/** Text at the setting of a card: what the target does, or why it does nothing now. */
export function cardTargetHint(state: TargetState, entries: string): string {
	switch (state.kind) {
		case 'archived':
			return `Das Zielprojekt ist archiviert. ${entries} bekommen es weiter, beim Umwandeln wird es aber nicht vorbelegt.`;
		case 'deleted':
			return `Das gewählte Zielprojekt gibt es nicht mehr. ${entries} kommen ohne Zielprojekt.`;
		default:
			return `${entries} bekommen dieses Projekt; beim Umwandeln ist es vorbelegt. Gilt nur für neue Einträge.`;
	}
}

/** Flag after saving a target: "Neue Einträge von „Gmail“ kommen jetzt nach „Haus (HAUS)“." */
export function targetSavedText(name: string, project: ProjectRef | null): string {
	return project === null
		? `Neue Einträge von „${name}“ kommen jetzt ohne Zielprojekt.`
		: `Neue Einträge von „${name}“ bekommen jetzt das Zielprojekt „${projectChoiceLabel(project)}“.`;
}
