// Guard of the ticket hooks for archived projects (E3 plan, T-11 and package 3): a ticket must
// not newly join an archived project, neither on create nor by a project change. Tickets that
// already are in it stay editable.

import { beforeAll, describe, expect, it } from 'vitest';
import { rejectionOf, superuserClient } from '../support/api.mjs';
import { createOwner, uniqueCode } from '../support/scenario.mjs';

const ARCHIVED = { status: 400, codes: { project: 'validation_project_archived' } };

/** Status, field codes and the German field message of a rejected call. */
async function archivedRejection(promise) {
	try {
		await promise;
	} catch (error) {
		return {
			...(await rejectionOf(Promise.reject(error))),
			message: error.response?.data?.project?.message
		};
	}
	throw new Error('Expected the request to be rejected, but it succeeded.');
}

describe('archived projects (T-11)', () => {
	let superuser;
	let owner;
	let tickets;

	beforeAll(async () => {
		superuser = await superuserClient();
		owner = await createOwner(superuser);
		tickets = owner.client.collection('tickets');
	});

	async function archivedProject() {
		const code = uniqueCode();
		const project = await owner.project(code);
		await owner.client.collection('projects').update(project.id, { archived: true });
		return { ...project, code };
	}

	it('rejects a new ticket in an archived project with a German field error', async () => {
		const project = await archivedProject();

		expect(await archivedRejection(owner.ticket({ project: project.id }))).toEqual({
			...ARCHIVED,
			message: 'Das Projekt ist archiviert.'
		});
		const count = await tickets.getList(1, 1, {
			filter: owner.client.filter('project = {:project}', { project: project.id })
		});
		expect(count.totalItems).toBe(0);
	});

	it('rejects moving a ticket into an archived project, from another project or from none', async () => {
		const project = await archivedProject();
		const active = await owner.project(uniqueCode());
		const loose = await owner.ticket();
		const inActive = await owner.ticket({ project: active.id });

		expect(await rejectionOf(tickets.update(loose.id, { project: project.id }))).toEqual(ARCHIVED);
		expect(await rejectionOf(tickets.update(inActive.id, { project: project.id }))).toEqual(ARCHIVED);
		expect((await tickets.getOne(loose.id)).project).toBe('');
		expect((await tickets.getOne(inActive.id)).key).toBe(inActive.key);
	});

	it('keeps tickets in a project that gets archived editable, and lets them leave', async () => {
		const code = uniqueCode();
		const project = await owner.project(code);
		const ticket = await owner.ticket({ project: project.id });
		await owner.client.collection('projects').update(project.id, { archived: true });

		const edited = await tickets.update(ticket.id, { title: 'Weiter bearbeitbar', status: 'waiting' });
		expect(edited).toMatchObject({
			project: project.id,
			key: `${code}-1`,
			title: 'Weiter bearbeitbar',
			status: 'waiting'
		});
		const done = await tickets.update(ticket.id, { status: 'done', project: project.id });
		expect(done).toMatchObject({ status: 'done', key: `${code}-1` });

		const left = await tickets.update(ticket.id, { project: '' });
		expect(left.key).toMatch(/^TASK-\d+$/);
		expect(await rejectionOf(tickets.update(ticket.id, { project: project.id }))).toEqual(ARCHIVED);
	});

	it('draws no number for a rejected ticket and allows the project again after restoring it', async () => {
		const project = await archivedProject();
		await rejectionOf(owner.ticket({ project: project.id }));

		await owner.client.collection('projects').update(project.id, { archived: false });

		expect((await owner.ticket({ project: project.id })).key).toBe(`${project.code}-1`);
	});

	it('reports a foreign archived project as scope mismatch, not as archived', async () => {
		const other = await createOwner(superuser);
		const foreign = await other.project(uniqueCode());
		await other.client.collection('projects').update(foreign.id, { archived: true });

		expect(await rejectionOf(owner.ticket({ project: foreign.id }))).toEqual({
			status: 400,
			codes: { project: 'validation_scope_mismatch' }
		});
	});
});
