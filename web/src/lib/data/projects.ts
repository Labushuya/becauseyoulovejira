// Project access (E3 plan, T-11, T-12 and package 3; ADR-0006 sections 1 to 5). Stateless
// functions with the PocketBase instance as first parameter; filters always through pb.filter().
// The hooks set the scope and guard code, scope and deletion (E1 plan, OF-6 and OF-14).

import type PocketBase from 'pocketbase';
import type { Project, ProjectDraft, ProjectPatch } from '../domain/project';
import type { Status } from '../domain/status';
import type { ProjectRef } from '../domain/ticket';
import { DataError, withDataErrors } from './errors';
import { currentUserId, type RequestOptions } from './options';

const PROJECTS = 'projects';

export interface ProjectRecord {
	id: string;
	name: string;
	code: string;
	archived: boolean;
	/** Parent project (ADR-0034); absent while the server lacks the field (before the restart). */
	parent?: string;
	updated?: string;
}

/**
 * Fields of the catalog (T-16), with `updated` for the order of events and `parent` (ADR-0034).
 * A server without `parent` simply leaves it out of the answer.
 */
export const PROJECT_FIELDS = 'id,name,code,archived,parent,updated';

/** Project as referenced by a ticket (expanded relation). */
export function toProjectRef(record: ProjectRecord): ProjectRef {
	return { id: record.id, name: record.name, code: record.code, archived: record.archived };
}

/**
 * Project of the catalog; throws without `updated` (then the fields were wrong). Without the
 * field `parent` the server has not run the migration of ADR-0034 yet (`withoutParentField`).
 */
export function toProject(record: ProjectRecord): Project {
	if (typeof record.updated !== 'string') throw new RangeError('Project without updated');
	const project: Project = {
		...toProjectRef(record),
		updated: record.updated,
		parentId: record.parent ? record.parent : null
	};
	if (record.parent === undefined) project.withoutParentField = true;
	return project;
}

/** Body field of the parent: '' for none; nothing when the draft leaves the parent as it is. */
function parentBody(parentId: string | null | undefined): { parent?: string } {
	return parentId === undefined ? {} : { parent: parentId ?? '' };
}

/** Projects visible to the signed-in user, archived ones included, sorted by code. */
export function listProjects(pb: PocketBase, { signal }: RequestOptions = {}): Promise<Project[]> {
	return withDataErrors(signal, async () => {
		const records = await pb
			.collection(PROJECTS)
			.getFullList<ProjectRecord>({ batch: 500, sort: 'code,id', fields: PROJECT_FIELDS, signal });
		return records.map(toProject);
	});
}

/**
 * Creates a private project of the signed-in user; `household` stays empty (E7). With `parentId`
 * it becomes a sub project (ADR-0034); the hook checks the parent.
 */
export function createProject(
	pb: PocketBase,
	draft: ProjectDraft,
	{ signal }: RequestOptions = {}
): Promise<Project> {
	return withDataErrors(signal, async () => {
		const owner = currentUserId(pb.authStore.record);
		if (owner === null) throw new DataError('session');
		const record = await pb
			.collection(PROJECTS)
			.create<ProjectRecord>(
				{ owner, name: draft.name, code: draft.code, ...parentBody(draft.parentId) },
				{ fields: PROJECT_FIELDS, signal }
			);
		return toProject(record);
	});
}

/**
 * Sends only the given fields (name, code, parent); the hook keeps the code of a project in use
 * and checks the parent (ADR-0034). `parentId: null` releases a sub project.
 */
export function updateProject(
	pb: PocketBase,
	id: string,
	patch: ProjectPatch,
	{ signal }: RequestOptions = {}
): Promise<Project> {
	return withDataErrors(signal, async () => {
		const body: Record<string, string> = { ...parentBody(patch.parentId) };
		if (patch.name !== undefined) body.name = patch.name;
		if (patch.code !== undefined) body.code = patch.code;
		const record = await pb
			.collection(PROJECTS)
			.update<ProjectRecord>(id, body, { fields: PROJECT_FIELDS, signal });
		return toProject(record);
	});
}

/** Archives a project or takes it out of the archive (T-11). */
export function setProjectArchived(
	pb: PocketBase,
	id: string,
	archived: boolean,
	{ signal }: RequestOptions = {}
): Promise<Project> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection(PROJECTS)
			.update<ProjectRecord>(id, { archived }, { fields: PROJECT_FIELDS, signal });
		return toProject(record);
	});
}

/** Deletes a project; the hook rejects it while tickets use it (`validation_project_in_use`). */
export function deleteProject(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<void> {
	return withDataErrors(signal, async () => {
		await pb.collection(PROJECTS).delete(id, { signal });
	});
}

/**
 * Number of done tickets of a project, counted by the server (ADR-0013 section 5); the tile
 * adds the open tickets from the list store.
 */
export function countDoneTickets(
	pb: PocketBase,
	projectId: string,
	{ signal }: RequestOptions = {}
): Promise<number> {
	return withDataErrors(signal, async () => {
		const result = await pb.collection('tickets').getList(1, 1, {
			filter: pb.filter('project = {:project} && status = {:done}', {
				project: projectId,
				done: 'done' satisfies Status
			}),
			fields: 'id',
			signal
		});
		return result.totalItems;
	});
}
