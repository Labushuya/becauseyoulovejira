// Own projects and tags for display (E2 plan T-10: resolving IDs in the history). Editing
// follows in E3.

import type PocketBase from 'pocketbase';
import type { ProjectRef, TagRef } from '../domain/ticket';
import { withDataErrors } from './errors';
import type { RequestOptions } from './options';

export interface ProjectRecord {
	id: string;
	name: string;
	code: string;
	archived: boolean;
}

export interface TagRecord {
	id: string;
	name: string;
}

export const PROJECT_FIELDS = 'id,name,code,archived';
export const TAG_FIELDS = 'id,name';

export function toProjectRef(record: ProjectRecord): ProjectRef {
	return { id: record.id, name: record.name, code: record.code, archived: record.archived };
}

export function toTagRef(record: TagRecord): TagRef {
	return { id: record.id, name: record.name };
}

/** Projects visible to the signed-in user, archived ones included, sorted by code. */
export function listProjects(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<ProjectRef[]> {
	return withDataErrors(signal, async () => {
		const records = await pb
			.collection('projects')
			.getFullList<ProjectRecord>({ batch: 500, sort: 'code,id', fields: PROJECT_FIELDS, signal });
		return records.map(toProjectRef);
	});
}

/** Tags visible to the signed-in user, sorted by name. */
export function listTags(pb: PocketBase, { signal }: RequestOptions = {}): Promise<TagRef[]> {
	return withDataErrors(signal, async () => {
		const records = await pb
			.collection('tags')
			.getFullList<TagRecord>({ batch: 500, sort: 'name,id', fields: TAG_FIELDS, signal });
		return records.map(toTagRef);
	});
}
