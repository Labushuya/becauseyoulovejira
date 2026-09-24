// Managing projects and tags from the project view (E3 plan, T-11, T-12, T-14 and package 14).
// The editor checks the input with the domain rules before sending, writes through the data
// layer and puts every answer into the catalog at once, so tiles, filter bar, panel and table
// rows follow without waiting for the realtime event (which arrives later and is ignored as not
// newer). The hooks stay authoritative; their field errors come back per field.

import type PocketBase from 'pocketbase';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import {
	createProject,
	deleteProject,
	setProjectArchived,
	updateProject
} from '$lib/data/projects';
import { countTicketsWithTag, deleteTag, renameTag } from '$lib/data/tags';
import {
	normalizeProjectCode,
	projectCodeProblem,
	projectNameProblem,
	type Project,
	type ProjectDraft,
	type ProjectPatch
} from '$lib/domain/project';
import { findTagByName, normalizeTagName, tagNameProblem, type Tag } from '$lib/domain/tag';
import type { CatalogStore } from './catalog.svelte';
import type { SessionGuard } from './ticket-list.svelte';

/** Data access of the editor; tests pass a fake, the app binds the data layer to its client. */
export interface CatalogEditorData {
	createProject(draft: ProjectDraft): Promise<Project>;
	updateProject(id: string, patch: ProjectPatch): Promise<Project>;
	setProjectArchived(id: string, archived: boolean): Promise<Project>;
	deleteProject(id: string): Promise<void>;
	renameTag(id: string, name: string): Promise<Tag>;
	deleteTag(id: string): Promise<void>;
	countTicketsWithTag(id: string, options: RequestOptions): Promise<number>;
}

export function catalogEditorData(pb: PocketBase): CatalogEditorData {
	return {
		createProject: (draft) => createProject(pb, draft),
		updateProject: (id, patch) => updateProject(pb, id, patch),
		setProjectArchived: (id, archived) => setProjectArchived(pb, id, archived),
		deleteProject: (id) => deleteProject(pb, id),
		renameTag: (id, name) => renameTag(pb, id, name),
		deleteTag: (id) => deleteTag(pb, id),
		countTicketsWithTag: (id, options) => countTicketsWithTag(pb, id, options)
	};
}

/**
 * Outcome of an action. A failure carries German texts per form field (`fields`) and a message
 * for everything else; `message` is null if there is nothing more to show (field errors only,
 * an aborted request, or an ended session that leads to the login).
 */
export type EditResult<T> =
	| { ok: true; value: T }
	| { ok: false; message: string | null; fields: Readonly<Record<string, string>> };

/** Form fields of the project dialog and of renaming a tag. */
const PROJECT_FIELDS = ['name', 'code'] as const;
const TAG_FIELDS = ['name'] as const;

function invalid<T>(fields: Record<string, string>): EditResult<T> {
	return { ok: false, message: null, fields };
}

/** Client-side problems of a project draft per field; empty if it may be sent. */
function draftProblems(draft: ProjectDraft): Record<string, string> {
	const problems: Record<string, string> = {};
	const name = projectNameProblem(draft.name);
	const code = projectCodeProblem(draft.code);
	if (name !== null) problems.name = name;
	if (code !== null) problems.code = code;
	return problems;
}

type CatalogTarget = Pick<
	CatalogStore,
	'tags' | 'upsertProject' | 'removeProject' | 'upsertTag' | 'removeTag'
>;

export class CatalogEditor {
	readonly #data: CatalogEditorData;
	readonly #session: SessionGuard;
	readonly #catalog: CatalogTarget;

	constructor(data: CatalogEditorData, session: SessionGuard, catalog: CatalogTarget) {
		this.#data = data;
		this.#session = session;
		this.#catalog = catalog;
	}

	/** "Neues Projekt": name trimmed, code in capitals (T-11). */
	async createProject(draft: ProjectDraft): Promise<EditResult<Project>> {
		const normalized = { name: draft.name.trim(), code: normalizeProjectCode(draft.code) };
		const problems = draftProblems(normalized);
		if (Object.keys(problems).length > 0) return invalid(problems);
		return this.#run(PROJECT_FIELDS, async () => {
			const project = await this.#data.createProject(normalized);
			this.#catalog.upsertProject(project);
			return project;
		});
	}

	/** Saves name and code of a project; sends only what changed, nothing if nothing did. */
	async updateProject(project: Project, draft: ProjectDraft): Promise<EditResult<Project>> {
		const normalized = { name: draft.name.trim(), code: normalizeProjectCode(draft.code) };
		const problems = draftProblems(normalized);
		if (Object.keys(problems).length > 0) return invalid(problems);
		const patch: ProjectPatch = {};
		if (normalized.name !== project.name) patch.name = normalized.name;
		if (normalized.code !== project.code) patch.code = normalized.code;
		if (Object.keys(patch).length === 0) return { ok: true, value: project };
		return this.#run(PROJECT_FIELDS, async () => {
			const saved = await this.#data.updateProject(project.id, patch);
			this.#catalog.upsertProject(saved);
			return saved;
		});
	}

	/** "Archivieren" and "Aus dem Archiv holen" (T-11). */
	setProjectArchived(project: Project, archived: boolean): Promise<EditResult<Project>> {
		return this.#run([], async () => {
			const saved = await this.#data.setProjectArchived(project.id, archived);
			this.#catalog.upsertProject(saved);
			return saved;
		});
	}

	/** Deletes a project; the hook refuses it while tickets use it (then: archive). */
	deleteProject(project: Project): Promise<EditResult<void>> {
		return this.#run([], async () => {
			await this.#data.deleteProject(project.id);
			this.#catalog.removeProject(project.id);
		});
	}

	/**
	 * Renames a tag (T-14): trimmed, at most 50 characters, and no name another tag has in any
	 * spelling. The same name (also in another spelling of the tag itself) is sent as typed.
	 */
	async renameTag(tag: Tag, name: string): Promise<EditResult<Tag>> {
		const problem = tagNameProblem(name);
		if (problem !== null) return invalid({ name: problem });
		const normalized = normalizeTagName(name);
		if (normalized === tag.name) return { ok: true, value: tag };
		const others = this.#catalog.tags.filter((other) => other.id !== tag.id);
		if (findTagByName(others, normalized) !== null) {
			return invalid({ name: 'Diesen Namen hat schon ein anderer Tag.' });
		}
		return this.#run(TAG_FIELDS, async () => {
			const saved = await this.#data.renameTag(tag.id, normalized);
			this.#catalog.upsertTag(saved);
			return saved;
		});
	}

	/** Deletes a tag; PocketBase removes it from every ticket, the history says "System". */
	deleteTag(tag: Tag): Promise<EditResult<void>> {
		return this.#run([], async () => {
			await this.#data.deleteTag(tag.id);
			this.#catalog.removeTag(tag.id);
		});
	}

	/** Number of tickets (done ones included) with the tag, for the question before deleting. */
	countTicketsWithTag(tag: Tag, { signal }: RequestOptions = {}): Promise<EditResult<number>> {
		return this.#run([], () => this.#data.countTicketsWithTag(tag.id, { signal }));
	}

	async #run<T>(shown: readonly string[], action: () => Promise<T>): Promise<EditResult<T>> {
		if (!this.#session.ensureValid()) return { ok: false, message: null, fields: {} };
		try {
			return { ok: true, value: await action() };
		} catch (error) {
			return this.#failure(error, shown);
		}
	}

	/**
	 * Field errors of the shown fields go to their field. Any other field error (such as
	 * `validation_project_in_use` at `id`, or the second `validation_not_unique` at `scope`) only
	 * becomes the message if no shown field carries an error.
	 */
	#failure<T>(error: unknown, shown: readonly string[]): EditResult<T> {
		const failure = toDataError(error);
		if (failure.kind === 'aborted') return { ok: false, message: null, fields: {} };
		if (failure.kind === 'session') {
			this.#session.logout();
			return { ok: false, message: null, fields: {} };
		}
		const fields: Record<string, string> = {};
		for (const name of shown) {
			const field = failure.fields[name];
			if (field !== undefined) fields[name] = field.message;
		}
		if (Object.keys(fields).length > 0) return invalid(fields);
		const other = Object.values(failure.fields)[0]?.message;
		return { ok: false, message: other ?? failure.message, fields: {} };
	}
}
