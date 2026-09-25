// Keywords of the file imports of the signed-in user (ADR-0020 section 3; E4 plan package 21):
// the JSON field users.import_keywords, checked by app/pb_hooks/users.pb.js. Before the migration
// 1790201500 the field does not exist; reading then answers null.

import type PocketBase from 'pocketbase';
import { importKeywordsOf, importKeywordsValue, type ImportKeywords } from '../domain/keywords';
import { DataError, withDataErrors } from './errors';
import { currentUserId, type RequestOptions } from './options';

const FIELDS = 'id,import_keywords';

function userId(pb: PocketBase): string {
	const id = currentUserId(pb.authStore.record);
	if (id === null) throw new DataError('session');
	return id;
}

/** The settings of the user, or null while the server does not know the field yet. */
export function getImportKeywords(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<ImportKeywords | null> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection('users')
			.getOne<Record<string, unknown>>(userId(pb), { fields: FIELDS, signal });
		if (!Object.prototype.hasOwnProperty.call(record, 'import_keywords')) return null;
		return importKeywordsOf(record.import_keywords);
	});
}

/** Saves all settings of the file imports and answers with what the server stored. */
export function saveImportKeywords(
	pb: PocketBase,
	settings: ImportKeywords,
	{ signal }: RequestOptions = {}
): Promise<ImportKeywords> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection('users')
			.update<Record<string, unknown>>(
				userId(pb),
				{ import_keywords: importKeywordsValue(settings) },
				{ fields: FIELDS, signal }
			);
		return importKeywordsOf(record.import_keywords);
	});
}
