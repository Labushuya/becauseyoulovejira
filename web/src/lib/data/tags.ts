// Tag access (E3 plan, T-14 and package 3; ADR-0006 sections 1 to 5). Stateless functions with
// the PocketBase instance as first parameter; filters always through pb.filter(). The unique
// index tags(scope, name COLLATE NOCASE) rejects a name that exists in another spelling.

import type PocketBase from 'pocketbase';
import type { Tag } from '../domain/tag';
import type { TagRef } from '../domain/ticket';
import { areaOptions, clientHousehold } from './area';
import { DataError, withDataErrors } from './errors';
import { currentUserId, type RequestOptions } from './options';

const TAGS = 'tags';

export interface TagRecord {
	id: string;
	name: string;
	updated?: string;
}

/** Fields of the catalog (T-16), with `updated` for the order of events. */
export const TAG_FIELDS = 'id,name,updated';

/** Tag as referenced by a ticket (expanded relation). */
export function toTagRef(record: TagRecord): TagRef {
	return { id: record.id, name: record.name };
}

/** Tag of the catalog; throws without `updated` (then the fields were wrong). */
export function toTag(record: TagRecord): Tag {
	if (typeof record.updated !== 'string') throw new RangeError('Tag without updated');
	return { ...toTagRef(record), updated: record.updated };
}

/** Tags visible to the signed-in user in the area of the client (E7-3), sorted by name. */
export function listTags(pb: PocketBase, { signal }: RequestOptions = {}): Promise<Tag[]> {
	return withDataErrors(signal, async () => {
		const records = await pb.collection(TAGS).getFullList<TagRecord>({
			batch: 500,
			sort: 'name,id',
			fields: TAG_FIELDS,
			...areaOptions(pb),
			signal
		});
		return records.map(toTag);
	});
}

/** Creates a tag of the signed-in user in the area of the client (E7-3); the name is sent as given. */
export function createTag(
	pb: PocketBase,
	name: string,
	{ signal }: RequestOptions = {}
): Promise<Tag> {
	return withDataErrors(signal, async () => {
		const owner = currentUserId(pb.authStore.record);
		if (owner === null) throw new DataError('session');
		const household = clientHousehold(pb);
		const record = await pb
			.collection(TAGS)
			.create<TagRecord>(
				{ owner, ...(household !== '' ? { household } : {}), name },
				{ fields: TAG_FIELDS, signal }
			);
		return toTag(record);
	});
}

export function renameTag(
	pb: PocketBase,
	id: string,
	name: string,
	{ signal }: RequestOptions = {}
): Promise<Tag> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection(TAGS)
			.update<TagRecord>(id, { name }, { fields: TAG_FIELDS, signal });
		return toTag(record);
	});
}

/**
 * Deletes a tag. PocketBase removes its ID from every ticket, and the history hook records that
 * as a change without a user ("System"; E1 plan, OF-6).
 */
export function deleteTag(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<void> {
	return withDataErrors(signal, async () => {
		await pb.collection(TAGS).delete(id, { signal });
	});
}

/** Number of tickets (done ones included) that carry the tag, for the question before deleting. */
export function countTicketsWithTag(
	pb: PocketBase,
	tagId: string,
	{ signal }: RequestOptions = {}
): Promise<number> {
	return withDataErrors(signal, async () => {
		const result = await pb.collection('tickets').getList(1, 1, {
			filter: pb.filter('tags.id ?= {:tag}', { tag: tagId }),
			fields: 'id',
			signal
		});
		return result.totalItems;
	});
}
