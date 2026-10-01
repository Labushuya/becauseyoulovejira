// Data layer of the trash in the SPA (ADR-0037, plan PB-2) against PocketBase: the move answered
// by the delete route, the list and the preview, restoring with and without expected_updated,
// the refusal that asks for a target project, deleting for good, emptying, the retention of the
// account and the realtime hint byl/trash; since ADR-0047 the dependencies, the decisions of the
// decision help and a sub-task restored on its own. Node 24 provides EventSource only with
// --experimental-eventsource, which vitest.config.mjs passes to the integration workers.

import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, uniqueCode } from '../support/scenario.mjs';
import { deleteTicket } from '../../web/src/lib/data/tickets.ts';
import {
	emptyTrash,
	getTrashPreview,
	listTrash,
	purgeFromTrash,
	resolveTrash,
	restoreFromTrash,
	saveTrashRetention,
	subscribeTrash
} from '../../web/src/lib/data/trash.ts';

let superuser;

beforeAll(async () => {
	superuser = await superuserClient();
});

async function kindOf(promise) {
	try {
		await promise;
		return 'ok';
	} catch (error) {
		return error.kind;
	}
}

describe('web data layer: trash', () => {
	it('moves a ticket, lists and previews it, and restores it with its key', async () => {
		const owner = await createOwner(superuser);
		const parent = await owner.ticket({ description: 'Text **fett**' });
		const child = await owner.ticket({ parent: parent.id });

		const move = await deleteTicket(owner.client, parent.id, { sources: 'inbox' });
		expect(move.id).toBe(parent.id);
		expect(move.tickets.map((ticket) => ticket.id).sort()).toEqual([parent.id, child.id].sort());

		const { items, retention } = await listTrash(owner.client);
		expect(retention).toBe('30');
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ id: parent.id, key: parent.key, children: 1, daysLeft: 30, deletedBy: owner.id });

		const preview = await getTrashPreview(owner.client, parent.id);
		expect(preview).toMatchObject({ description: 'Text **fett**', group: '', sources: { handling: 'inbox', count: 0 } });
		expect(preview.subtasks.map((entry) => entry.id)).toEqual([child.id]);
		expect((await getTrashPreview(owner.client, child.id)).group).toBe(parent.id);

		const stale = await kindOf(restoreFromTrash(owner.client, parent.id, { expectedUpdated: '2020-01-01 00:00:00.000Z' }));
		expect(stale).toBe('validation');
		const result = await restoreFromTrash(owner.client, parent.id, { expectedUpdated: move.updated });
		expect(result).toMatchObject({ id: parent.id, key: parent.key, parentDetached: false, newKeys: [] });
		expect((await listTrash(owner.client)).items).toEqual([]);
		expect(await kindOf(getTrashPreview(owner.client, parent.id))).toBe('not_found');
	});

	it('asks for a target project when the project is gone and restores there with a new key', async () => {
		const owner = await createOwner(superuser);
		const project = await owner.project(uniqueCode());
		const ticket = await owner.ticket({ project: project.id });
		await deleteTicket(owner.client, ticket.id, { sources: 'inbox' });
		await owner.client.collection('projects').delete(project.id);

		const refused = await restoreFromTrash(owner.client, ticket.id).catch((error) => error);
		expect(refused.kind).toBe('validation');
		expect(refused.fields.project).toMatchObject({
			code: 'validation_trash_project_required',
			params: { code: project.code, reason: 'missing' }
		});
		const result = await restoreFromTrash(owner.client, ticket.id, { project: '' });
		expect(result.newKeys).toEqual([{ id: ticket.id, key: result.key, previous: ticket.key }]);
		expect(result.key.startsWith('TASK-')).toBe(true);
	});

	it('deletes for good, empties, and saves the retention of the account', async () => {
		const owner = await createOwner(superuser);
		const first = await owner.ticket({ status: 'done' });
		const second = await owner.ticket({ status: 'done' });
		await deleteTicket(owner.client, first.id, { sources: 'inbox' });
		await deleteTicket(owner.client, second.id, { sources: 'discard' });

		await purgeFromTrash(owner.client, first.id);
		expect((await listTrash(owner.client)).items.map((item) => item.id)).toEqual([second.id]);
		expect(await emptyTrash(owner.client)).toEqual({ purged: 1, blocked: [] });
		expect((await listTrash(owner.client)).items).toEqual([]);

		expect(await saveTrashRetention(owner.client, owner.id, 'never')).toBe('never');
		expect((await listTrash(owner.client)).retention).toBe('never');
		expect(await kindOf(saveTrashRetention(owner.client, owner.id, '14'))).toBe('validation');
	});

	it('reads the dependencies, resolves them and restores a sub-task on its own (ADR-0047)', async () => {
		const owner = await createOwner(superuser);
		const parent = await owner.ticket();
		const child = await owner.ticket({ parent: parent.id });
		const other = await owner.ticket({ parent: parent.id });
		await deleteTicket(owner.client, parent.id, { sources: 'inbox' });

		expect((await listTrash(owner.client)).items[0]).toMatchObject({ id: parent.id, dependencies: 3 });
		const preview = await getTrashPreview(owner.client, parent.id);
		expect(preview.dependencyList.map((entry) => [entry.kind, entry.ticket, entry.options])).toEqual([
			['ticket', parent.id, ['complete_children', 'restore']],
			['ticket', child.id, ['complete', 'restore', 'detach']],
			['ticket', other.id, ['complete', 'restore', 'detach']]
		]);
		const refused = await purgeFromTrash(owner.client, parent.id).catch((error) => error);
		expect(refused.fields.id).toMatchObject({ code: 'validation_trash_blocked', params: { count: 3 } });
		expect(await emptyTrash(owner.client)).toEqual({ purged: 0, blocked: [{ id: parent.id, key: parent.key, count: 3 }] });

		const restored = await restoreFromTrash(owner.client, other.id, { detachParent: true });
		expect(restored).toMatchObject({ id: other.id, parentDetached: true });
		const after = await resolveTrash(owner.client, parent.id, [
			{ action: 'complete', ticket: child.id },
			{ action: 'complete', ticket: parent.id }
		]);
		expect(after).toMatchObject({ id: parent.id, status: 'done', dependencies: 0, dependencyList: [] });
		await purgeFromTrash(owner.client, parent.id);
		expect((await listTrash(owner.client)).items).toEqual([]);
	});

	it('hears byl/trash when the own trash changes', async () => {
		const owner = await createOwner(superuser);
		let heard = 0;
		const stop = await subscribeTrash(owner.client, () => (heard += 1));
		try {
			const ticket = await owner.ticket();
			await deleteTicket(owner.client, ticket.id, { sources: 'inbox' });
			await expect.poll(() => heard, { timeout: 5_000 }).toBeGreaterThan(0);
		} finally {
			await stop();
		}
	});
});
