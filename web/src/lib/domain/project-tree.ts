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
export type TreeProject = Pick<ProjectRef, 'id' | 'name' | 'code' | 'archived'> & {
	/** Stored parent ID; null or absent for a top-level project. */
	parentId?: string | null;
};

/**
 * The projects with their parent resolved (`parent`), in the given order. The parent must be in
 * the list; otherwise the project counts as top-level. A top-level project is returned as it is
 * (same object, no `parent`), a sub project as a copy with `parent`.
 */
export function resolveParents<T extends TreeProject>(
	projects: readonly T[]
): (T & { parent?: ProjectParentRef | null })[] {
	const byId = new Map(projects.map((project) => [project.id, project]));
	return projects.map((project) => {
		const parent = project.parentId ? byId.get(project.parentId) : undefined;
		if (parent === undefined || parent.id === project.id) return project;
		return { ...project, parent: { id: parent.id, name: parent.name, code: parent.code } };
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
