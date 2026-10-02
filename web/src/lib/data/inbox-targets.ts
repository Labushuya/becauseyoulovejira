// Target projects of the cards without a connection (ADR-0049): the own inbox, WhatsApp Web and
// the files, per user like their keywords. The JSON field users.inbox_targets, checked by
// app/pb_hooks/users.pb.js (lib/target-project-service.js). Before the migration 1790203100 the
// field does not exist; reading then answers null.

import type PocketBase from 'pocketbase';
import { inboxTargetsOf, type InboxTargets } from '../domain/target-project';
import { DataError, withDataErrors } from './errors';
import { currentUserId, type RequestOptions } from './options';

const FIELDS = 'id,inbox_targets';

function userId(pb: PocketBase): string {
	const id = currentUserId(pb.authStore.record);
	if (id === null) throw new DataError('session');
	return id;
}

/** The targets of the user, or null while the server does not know the field yet. */
export function getInboxTargets(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<InboxTargets | null> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection('users')
			.getOne<Record<string, unknown>>(userId(pb), { fields: FIELDS, signal });
		if (!Object.prototype.hasOwnProperty.call(record, 'inbox_targets')) return null;
		return inboxTargetsOf(record.inbox_targets);
	});
}

/** Saves all targets and answers with what the server stored. */
export function saveInboxTargets(
	pb: PocketBase,
	targets: InboxTargets,
	{ signal }: RequestOptions = {}
): Promise<InboxTargets> {
	return withDataErrors(signal, async () => {
		const record = await pb
			.collection('users')
			.update<Record<string, unknown>>(
				userId(pb),
				{ inbox_targets: { ...targets } },
				{ fields: FIELDS, signal }
			);
		return inboxTargetsOf(record.inbox_targets);
	});
}
