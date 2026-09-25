// What the project view (/projekte, its +layout.svelte) hands to the panels below it
// (/projekte/neu and /projekte/<id>, ADR-0025 section 10, plan UI-Konsistenz, package UI-8): the
// editor of the catalog, the numbers of a project and the flags for results.

import { createContext } from 'svelte';
import type { Project } from './domain/project';
import type { CatalogEditor } from './stores/catalog-editor';

export interface ProjectRoute {
	editor: CatalogEditor;
	/** Tickets of the project that are not done; null while not loaded. */
	activeOf(project: Project): number | null;
	/** Active plus done tickets; null while not counted. */
	totalOf(project: Project): number | null;
	/** New tickets of the project for the signed-in user. */
	newOf(project: Project): number;
	/** Success flag of an action (ADR-0025 section 8). */
	notify(title: string): void;
}

const [getProjectRoute, setProjectRoute] = createContext<ProjectRoute>();

export { getProjectRoute, setProjectRoute };
