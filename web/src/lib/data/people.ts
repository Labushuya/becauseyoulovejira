// Names of the accounts the signed-in account may see (ADR-0056 §4): itself, the members of its
// households and, for the administrator, every account. Only ID and name: the e-mail address of
// another account never comes (emailVisibility), and this layer does not ask for it. Before the
// migration of E7-1 only the own record is visible, so other accounts stay "Anderes Konto".

import type PocketBase from 'pocketbase';
import type { PersonName } from '../domain/people';
import { withDataErrors } from './errors';
import type { RequestOptions } from './options';
import type { RecordChange, Unsubscribe } from './realtime';

const USERS = 'users';
const FIELDS = 'id,name';

interface PersonRecord {
	id: string;
	name?: unknown;
}

function toPerson(record: PersonRecord): PersonName {
	return { id: record.id, name: typeof record.name === 'string' ? record.name.trim() : '' };
}

/** The names of every visible account. */
export function listPersonNames(
	pb: PocketBase,
	{ signal }: RequestOptions = {}
): Promise<PersonName[]> {
	return withDataErrors(signal, async () => {
		const records = await pb
			.collection(USERS)
			.getFullList<PersonRecord>({ fields: FIELDS, sort: 'created,id', requestKey: null, signal });
		return records.map(toPerson);
	});
}

/** Realtime: names of visible accounts as they change. */
export function subscribePersonNames(
	pb: PocketBase,
	onChange: (change: RecordChange<PersonName>) => void
): Promise<Unsubscribe> {
	return pb.collection(USERS).subscribe<PersonRecord>(
		'*',
		(event) => {
			if (event.action === 'delete') {
				onChange({ action: 'delete', id: event.record.id });
				return;
			}
			if (event.action !== 'create' && event.action !== 'update') return;
			onChange({ action: event.action, record: toPerson(event.record) });
		},
		{ fields: FIELDS }
	);
}
