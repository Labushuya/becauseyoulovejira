// Folder channel (ADR-0051 §6 and §7; ADR-0006 sections 1 to 5): the routes of
// app/pb_hooks/folders.pb.js. Stateless functions with the PocketBase instance as first parameter.
// The details and the files of before come from what the runs of the server stored; nothing here
// reads a file. "Ansehen" asks the server whether the file of an entry can be shown and gets its
// address with a short file token; a refusal (gone, outside the folders, a link, not the owner, not
// this machine) comes as an outcome with the German text, not as an exception.

import type PocketBase from 'pocketbase';
import {
	adoptResultOf,
	existingFilesOf,
	fileRefusalText,
	fileViewOf,
	folderDetailsOf,
	type AdoptResult,
	type ExistingFiles,
	type FileView,
	type FolderDetails
} from '../domain/folders';
import { DATA_ERROR_MESSAGES, toDataError, withDataErrors } from './errors';
import type { RequestOptions } from './options';

function routeOf(id: string, name: string): string {
	const base = `/api/byl/connections/${encodeURIComponent(id)}/folders`;
	return name === '' ? base : `${base}/${name}`;
}

/** The details of the card: per folder its state (no folder is read). */
export function getFolderDetails(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<FolderDetails> {
	return withDataErrors(signal, async () => {
		const result = await pb.send<unknown>(routeOf(id, ''), { method: 'GET', signal });
		return folderDetailsOf(result);
	});
}

/** The files of the base of one folder (`folder` its ID of the details) for "Vorhandene Dateien übernehmen". */
export function listExistingFiles(
	pb: PocketBase,
	id: string,
	folder: string,
	{ signal }: RequestOptions = {}
): Promise<ExistingFiles> {
	return withDataErrors(signal, async () => {
		const result = await pb.send<unknown>(routeOf(id, 'existing'), {
			method: 'GET',
			query: { folder },
			signal
		});
		return existingFilesOf(result);
	});
}

/** Takes the chosen files of one folder into the inbox (at most FOLDER_LIMITS.adoptBatch). */
export function adoptFiles(
	pb: PocketBase,
	id: string,
	folder: string,
	paths: readonly string[],
	{ signal }: RequestOptions = {}
): Promise<AdoptResult> {
	return withDataErrors(signal, async () => {
		const result = await pb.send<unknown>(routeOf(id, 'adopt'), {
			method: 'POST',
			body: { folder, paths: [...paths] },
			signal
		});
		return adoptResultOf(result);
	});
}

/** "Ansehen": the file can be shown (with its address) or why not. */
export type FileViewOutcome =
	{ kind: 'ok'; view: FileView } | { kind: 'refused'; reason: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Asks whether the file of an entry can be shown now and for its address. A refusal of the route
 * (4xx with a reason) is an outcome; a lost session or no server is a DataError.
 */
export async function viewFolderFile(
	pb: PocketBase,
	itemId: string,
	{ signal }: RequestOptions = {}
): Promise<FileViewOutcome> {
	try {
		const result = await pb.send<unknown>(`/api/byl/folders/items/${encodeURIComponent(itemId)}`, {
			method: 'GET',
			signal
		});
		const view = fileViewOf(result);
		if (view === null) {
			return { kind: 'refused', reason: 'unknown', message: DATA_ERROR_MESSAGES.server };
		}
		// The address of the server is relative; the SDK knows where the server is.
		return { kind: 'ok', view: { ...view, url: pb.buildURL(view.url) } };
	} catch (error) {
		const status = isRecord(error) && typeof error.status === 'number' ? error.status : 0;
		const response = isRecord(error) && isRecord(error.response) ? error.response : {};
		const reason = typeof response.reason === 'string' ? response.reason : '';
		if (!signal?.aborted && reason !== '' && reason !== 'auth' && status >= 400 && status < 500) {
			const message = typeof response.message === 'string' ? response.message : '';
			return { kind: 'refused', reason, message: fileRefusalText(reason, message) };
		}
		throw toDataError(error, signal);
	}
}
