// What the project view (/projekte, its +layout.svelte) hands to the panels below it
// (/projekte/neu and /projekte/<id>, ADR-0025 section 10, plan UI-Konsistenz, package UI-8): the
// editor of the catalog, the numbers of a project and the flags for results. The numbers of a
// parent include its sub projects (ADR-0034 section 6); `directOf` gives its own ones. Archiving,
// "Mit Oberprojekt zurückholen" and deleting with their flags serve the panel and the menu "•••"
// of a row of the list alike (plan aktionsmenues, AM-4).

import { createContext } from 'svelte';
import type { Project } from './domain/project';
import type { ProjectCounts } from './domain/project-tree';
import type { CatalogEditor, EditResult } from './stores/catalog-editor';

export interface ProjectRoute {
	editor: CatalogEditor;
	/** Tickets of the project that are not done, with its sub projects; null while not loaded. */
	activeOf(project: Project): number | null;
	/** Active plus done tickets, with its sub projects; null while not counted. */
	totalOf(project: Project): number | null;
	/** New tickets of the project for the signed-in user, with its sub projects. */
	newOf(project: Project): number;
	/** The numbers of the project alone ("davon direkt"); null for a project without sub projects. */
	directOf(project: Project): ProjectCounts | null;
	/** Success flag of an action (ADR-0025 section 8). */
	notify(title: string): void;
	/** Error flag of an action without a place of its own (the menu of a row), with the reason. */
	fail(title: string, reason: string | null): void;
	/** "Archivieren" or "Aus dem Archiv holen", with the success flag. */
	archive(project: Project, archived: boolean): Promise<EditResult<Project>>;
	/** "Mit Oberprojekt zurückholen": the archived parent first, the hook keeps the child below it. */
	restoreWithParent(project: Project, parent: Project): Promise<EditResult<Project>>;
	/** Deletes a project without tickets, with the success flag. */
	remove(project: Project): Promise<EditResult<void>>;
}

/** What the menu "•••" of a row of the list runs besides its links (plan aktionsmenues, AM-4). */
export type ProjectActions = Pick<
	ProjectRoute,
	'archive' | 'restoreWithParent' | 'remove' | 'fail'
>;

const [getProjectRoute, setProjectRoute] = createContext<ProjectRoute>();

export { getProjectRoute, setProjectRoute };
