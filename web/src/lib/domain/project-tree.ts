// Sub projects (ADR-0034): the tree of the catalog, one level deep. Pure. The catalog holds every
// visible project with `parentId`; this module resolves the parents, orders the tree, names the
// path "Haus › Garten" and says which projects a filter on a parent takes in. A sub project whose
// parent is not visible (deleted, not loaded yet) stands like a top-level project. The hook stays
// authoritative for every rule (app/pb_hooks/lib/catalog-rules.js).

import type { ProjectParentRef, ProjectRef } from './ticket';

/**
 * Texts of the codes of the project hook, worded like the interface. Kept equal to
 * PROJECT_PARENT_MESSAGES of app/pb_hooks/lib/catalog-rules.js (tests/unit/web-project-tree.test.mjs).
 */
export const PROJECT_PARENT_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_project_parent_self: 'Ein Projekt kann nicht sein eigenes Oberprojekt sein.',
	validation_project_parent_missing: 'Das Oberprojekt wurde nicht gefunden.',
	validation_project_parent_nested:
		'Das gewählte Projekt ist selbst ein Unterprojekt. Es gibt nur eine Ebene.',
	validation_project_parent_has_children:
		'Ein Projekt mit Unterprojekten kann kein Unterprojekt werden.',
	validation_project_parent_archived:
		'Das Oberprojekt ist archiviert. Bitte zuerst das Oberprojekt zurückholen.',
	validation_project_has_children:
		'Ein Projekt mit Unterprojekten kann nicht gelöscht werden. Erst die Unterprojekte löschen oder einem anderen Projekt zuordnen.',
	validation_project_scope_children:
		'Der Bereich eines Projekts mit Unterprojekten lässt sich nicht ändern. Erst die Unterprojekte verschieben oder lösen.'
});

/** Separator of the path, as in the breadcrumbs ("Haus › Garten"). */
export const PATH_SEPARATOR = ' › ';

/** What the tree needs of a project: the reference and the stored parent ID. */
export type TreeProject = Pick<ProjectRef, 'id' | 'name' | 'code' | 'archived' | 'color'> & {
	/** Stored parent ID; null or absent for a top-level project. */
	parentId?: string | null;
};

/**
 * The projects with their parent resolved (`parent`), in the given order. The parent must be in
 * the list; otherwise the project counts as top-level. A top-level project is returned as it is
 * (same object, no `parent`), a sub project as a copy with `parent`, which carries the color of the
 * parent as well (ADR-0052: a sub project without its own shows it).
 */
export function resolveParents<T extends TreeProject>(
	projects: readonly T[]
): (T & { parent?: ProjectParentRef | null })[] {
	const byId = new Map(projects.map((project) => [project.id, project]));
	return projects.map((project) => {
		const parent = project.parentId ? byId.get(project.parentId) : undefined;
		if (parent === undefined || parent.id === project.id) return project;
		const ref: ProjectParentRef = { id: parent.id, name: parent.name, code: parent.code };
		if (parent.color !== undefined) ref.color = parent.color;
		return { ...project, parent: ref };
	});
}

/** The parent a project shows under; null for a top-level project and for an unknown parent. */
function parentIdIn(project: TreeProject, ids: ReadonlySet<string>): string | null {
	const parentId = project.parentId ?? null;
	return parentId !== null && parentId !== project.id && ids.has(parentId) ? parentId : null;
}

/**
 * The projects in tree order: each top-level project in the given order, directly followed by its
 * sub projects in the given order. A sub project whose parent is not in the list keeps its place
 * like a top-level project.
 */
export function treeOrder<T extends TreeProject>(projects: readonly T[]): T[] {
	const ids = new Set(projects.map((project) => project.id));
	const children = new Map<string, T[]>();
	const roots: T[] = [];
	for (const project of projects) {
		const parentId = parentIdIn(project, ids);
		if (parentId === null) {
			roots.push(project);
			continue;
		}
		const list = children.get(parentId);
		if (list === undefined) children.set(parentId, [project]);
		else list.push(project);
	}
	return roots.flatMap((root) => [root, ...(children.get(root.id) ?? [])]);
}

/** Sub projects of a project in the given order (archived ones included). */
export function subProjectsOf<T extends TreeProject>(projects: readonly T[], id: string): T[] {
	return projects.filter((project) => project.id !== id && (project.parentId ?? null) === id);
}

/** Path of a project as text: "Haus › Garten", or the name of a top-level project. */
export function projectPath(project: Pick<ProjectRef, 'name' | 'parent'>): string {
	return project.parent ? `${project.parent.name}${PATH_SEPARATOR}${project.name}` : project.name;
}

/** Label of a project in a choice: "Haus › Garten (GART)", or "Haus (HAUS)". */
export function projectChoiceLabel(project: Pick<ProjectRef, 'name' | 'code' | 'parent'>): string {
	return `${projectPath(project)} (${project.code})`;
}

// The order along the tree lives with the other orders in ordering.ts (column sort "Projekt").
export { compareProjectPaths } from './ordering';

/**
 * Projects a project may get as parent in the panel (ADR-0034 section 1): active top-level
 * projects other than itself. A project that has sub projects gets none (the list is empty).
 */
export function parentChoices<T extends TreeProject>(
	projects: readonly T[],
	self: Pick<TreeProject, 'id'> | null
): T[] {
	if (self !== null && projects.some((project) => (project.parentId ?? null) === self.id)) {
		return [];
	}
	return projects.filter(
		(project) => !project.archived && !project.parentId && (self === null || project.id !== self.id)
	);
}

/** Numbers of a project tile or row: not done, all (done included) and new for the user. */
export interface ProjectCounts {
	/** Null while the open tickets are not loaded. */
	active: number | null;
	/** Null while the done tickets are not counted. */
	total: number | null;
	fresh: number;
}

/**
 * Numbers of a parent with its sub projects (ADR-0034 section 6): the sums of its own numbers and
 * those of every sub project (archived ones included, their tickets belong to the parent too). A
 * number stays unknown (null) while one of the parts is unknown, so nothing shows too little.
 */
export function aggregateCounts(
	own: ProjectCounts,
	subProjects: readonly ProjectCounts[]
): ProjectCounts {
	const sum = (pick: (counts: ProjectCounts) => number | null): number | null => {
		let total = 0;
		for (const counts of [own, ...subProjects]) {
			const value = pick(counts);
			if (value === null) return null;
			total += value;
		}
		return total;
	};
	return {
		active: sum((counts) => counts.active),
		total: sum((counts) => counts.total),
		fresh: [own, ...subProjects].reduce((total, counts) => total + counts.fresh, 0)
	};
}

/**
 * Whether a project may be deleted: the hook refuses it while tickets use it (archiving is the way
 * then) or while it has sub projects (ADR-0034 section 3). `total` counts its tickets with those of
 * its sub projects; unknown (null) is no. The panel and the menu "•••" of a row (plan
 * aktionsmenues, AM-4) ask the same.
 */
export function canDeleteProject(total: number | null, subProjects: readonly unknown[]): boolean {
	return total === 0 && subProjects.length === 0;
}

/** Names for a sentence: "Haus", "Haus und Garten", "Haus, Garten und Keller". */
export function projectNames(projects: readonly Pick<ProjectRef, 'name'>[]): string {
	const list = projects.map((project) => project.name);
	if (list.length <= 1) return list.join('');
	return `${list.slice(0, -1).join(', ')} und ${list.at(-1)}`;
}

/** The question before archiving a project whose active sub projects go with it (ADR-0034). */
export function archiveWithSubProjectsText(active: readonly Pick<ProjectRef, 'name'>[]): string {
	const count =
		active.length === 1
			? 'Archiviert auch 1 Unterprojekt:'
			: `Archiviert auch ${active.length} Unterprojekte:`;
	return `${count} ${projectNames(active)}. Zurückholen geht später für jedes einzeln.`;
}

/** The question before deleting a project, which only goes without tickets. */
export function deleteProjectText(project: Pick<ProjectRef, 'name' | 'code'>): string {
	return `„${project.name}“ (${project.code}) hat keine Tickets. Das Projekt wird endgültig gelöscht; das lässt sich nicht rückgängig machen.`;
}

/**
 * IDs a project filter takes in (ADR-0034 section 6): the project and, unless `withSubProjects`
 * is off, its sub projects. The same set as the server expression
 * `project = p || project.parent = p` of the done tickets.
 */
export function projectFamily<T extends TreeProject>(
	projects: readonly T[],
	id: string,
	withSubProjects: boolean
): string[] {
	return withSubProjects ? [id, ...subProjectsOf(projects, id).map((project) => project.id)] : [id];
}
