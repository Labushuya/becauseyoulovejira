// Access keys of the own inbox (ADR-0038; plan eigener-eingang-whatsapp-web, EI-1): list and
// revoke through the Record API of inbox_keys (only the own keys, never the hash), create through
// the route, which answers with the key once. Before the migration 1790202400 the collection does
// not exist; listing then answers null.

import type PocketBase from 'pocketbase';
import { INBOX_KEYS_ROUTE, type CreatedInboxKey, type InboxKey } from '../domain/inbox-keys';
import { DataError, toDataError, withDataErrors } from './errors';
import type { RequestOptions } from './options';

const COLLECTION = 'inbox_keys';
const FIELDS = 'id,name,token_hint,created,last_used_at';

function text(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

/** A key of the list, or null when the record does not have the expected shape. */
export function toInboxKey(value: unknown): InboxKey | null {
	if (typeof value !== 'object' || value === null) return null;
	const record = value as Record<string, unknown>;
	const id = text(record.id);
	const name = text(record.name);
	const tokenHint = text(record.token_hint);
	const created = text(record.created);
	const lastUsedAt = text(record.last_used_at);
	if (id === null || name === null || tokenHint === null || created === null) return null;
	return { id, name, tokenHint, created, lastUsedAt: lastUsedAt === '' ? null : lastUsedAt };
}

/** The keys of the signed-in user, newest first; null while the server does not know them yet. */
export async function listInboxKeys(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<InboxKey[] | null> {
	try {
		const records = await pb
			.collection(COLLECTION)
			.getFullList<Record<string, unknown>>({ sort: '-created', fields: FIELDS, signal });
		return records.map(toInboxKey).filter((key): key is InboxKey => key !== null);
	} catch (error) {
		const failure = toDataError(error, signal);
		if (failure.kind === 'not_found') return null;
		throw failure;
	}
}

/** Creates a key named `name`; the answer holds the key in plain text, once. */
export function createInboxKey(pb: PocketBase, name: string): Promise<CreatedInboxKey> {
	return withDataErrors(undefined, async () => {
		const result = await pb.send<Record<string, unknown>>(INBOX_KEYS_ROUTE, {
			method: 'POST',
			body: { name }
		});
		const key = toInboxKey(result);
		const token = text(result.token);
		if (key === null || token === null) throw new DataError('server');
		return { ...key, token };
	});
}

/** Revokes a key: it is deleted, every request with it is refused from now on. */
export function revokeInboxKey(pb: PocketBase, id: string): Promise<void> {
	return withDataErrors(undefined, async () => {
		await pb.collection(COLLECTION).delete(id);
	});
}
