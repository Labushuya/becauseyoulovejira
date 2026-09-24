// Project access of the web app against the disposable instance (E3 plan, package 3). The
// TypeScript modules from web/src/lib/data are imported directly (E2 plan, package 4).

import { beforeAll, describe, expect, it } from 'vitest';
import { superuserClient } from '../support/api.mjs';
import { createOwner, uniqueCode } from '../support/scenario.mjs';
import { DataError } from '../../web/src/lib/data/errors.ts';
import {
	countDoneTickets,
	createProject,
	deleteProject,
	listProjects,
	setProjectArchived,
	updateProject
} from '../../web/src/lib/data/projects.ts';
import { createTicket, setTicketDone } from '../../web/src/lib/data/tickets.ts';

/** The DataError a call fails with; fails the test if the call succeeds. */
async function dataErrorOf(promise) {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(DataError);
		return error;
	}
	throw new Error('Expected the call to fail, but it succeeded.');
}

function ticketDraft(overrides = {}) {
	return {
		title: 'Ticket',
		description: '',
		status: 'open',
		priority: 'medium',
		due: null,
		...overrides
	};
}

describe('web data layer: projects', () => {
	let superuser;
	let a;
	let b;

	beforeAll(async () => {
		superuser = await superuserClient();
		[a, b] = await Promise.all([createOwner(superuser), createOwner(superuser)]);
	});

	it('creates, renames, archives and restores a project that only its owner sees', async () => {
		const owner = await createOwner(superuser);
		const other = await createOwner(superuser);
		const code = uniqueCode();

		const created = await createProject(owner.client, { name: 'Haushalt', code });
		expect(created).toMatchObject({ name: 'Haushalt', code, archived: false });
		expect(created.id).toMatch(/^[a-z0-9]{15}$/);
		expect(created.updated).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		const stored = await superuser.collection('projects').getOne(created.id);
		expect(stored).toMatchObject({ owner: owner.id, household: '', scope: `u:${owner.id}` });

		const renamed = await updateProject(owner.client, created.id, { name: 'Wohnung' });
		expect(renamed).toMatchObject({ id: created.id, name: 'Wohnung', code });
		const archived = await setProjectArchived(owner.client, created.id, true);
		expect(archived.archived).toBe(true);
		expect((await listProjects(owner.client)).find((p) => p.id === created.id)).toEqual(archived);
		const restored = await setProjectArchived(owner.client, created.id, false);
		expect(restored.archived).toBe(false);
		expect(restored.updated >= archived.updated).toBe(true);

		expect(await listProjects(other.client)).toEqual([]);
		const foreign = [
			() => updateProject(other.client, created.id, { name: 'fremd' }),
			() => setProjectArchived(other.client, created.id, true),
			() => deleteProject(other.client, created.id)
		];
		for (const call of foreign) {
			expect((await dataErrorOf(call())).kind).toBe('not_found');
		}
	});

	it('rejects a duplicate code in the same scope at the field code', async () => {
		const code = uniqueCode();
		const first = await createProject(a.client, { name: 'Erstes', code });

		const duplicate = await dataErrorOf(createProject(a.client, { name: 'Zweites', code }));
		expect(duplicate.kind).toBe('validation');
		expect(duplicate.fields.code).toEqual({ code: 'validation_not_unique', message: 'Schon vergeben.' });

		const second = await createProject(a.client, { name: 'Zweites', code: uniqueCode() });
		const renamed = await dataErrorOf(updateProject(a.client, second.id, { code }));
		expect(renamed.fields.code?.code).toBe('validation_not_unique');

		// Another scope may use the same code.
		expect((await createProject(b.client, { name: 'Anderswo', code })).code).toBe(code);
		expect((await listProjects(a.client)).filter((p) => p.code === code)).toEqual([first]);
	});

	it('rejects the reserved code TASK and codes outside the pattern at the field code', async () => {
		const reserved = await dataErrorOf(createProject(a.client, { name: 'Aufgaben', code: 'TASK' }));
		expect(reserved.kind).toBe('validation');
		expect(reserved.fields.code).toEqual({
			code: 'validation_reserved_code',
			message: 'Der Code TASK ist reserviert.'
		});

		const project = await createProject(a.client, { name: 'Muster', code: uniqueCode() });
		expect((await dataErrorOf(updateProject(a.client, project.id, { code: 'TASK' }))).fields.code?.code).toBe(
			'validation_reserved_code'
		);
		for (const code of ['ab', 'A', 'ABCDEFG', 'A1']) {
			const invalid = await dataErrorOf(createProject(a.client, { name: 'Muster', code }));
			expect(invalid.kind, code).toBe('validation');
			expect(invalid.fields.code?.message, code).toMatch(/\S/);
		}
	});

	it('keeps code and existence of a project with tickets, both allowed without tickets', async () => {
		const owner = await createOwner(superuser);
		const used = await createProject(owner.client, { name: 'Genutzt', code: uniqueCode() });
		await owner.ticket({ project: used.id });

		const codeChange = await dataErrorOf(updateProject(owner.client, used.id, { code: uniqueCode() }));
		expect(codeChange.fields.code).toEqual({
			code: 'validation_project_in_use',
			message: 'Der Code bleibt fest, weil Tickets das Projekt verwenden.'
		});
		const removal = await dataErrorOf(deleteProject(owner.client, used.id));
		expect(removal.kind).toBe('validation');
		expect(removal.fields.id).toEqual({
			code: 'validation_project_in_use',
			message: 'Ein Projekt mit Tickets lässt sich nicht löschen. Bitte archivieren.'
		});
		expect((await updateProject(owner.client, used.id, { name: 'Neu benannt' })).name).toBe('Neu benannt');
		expect((await setProjectArchived(owner.client, used.id, true)).archived).toBe(true);

		const free = await createProject(owner.client, { name: 'Frei', code: uniqueCode() });
		const newCode = uniqueCode();
		expect((await updateProject(owner.client, free.id, { code: newCode })).code).toBe(newCode);
		await deleteProject(owner.client, free.id);
		expect((await listProjects(owner.client)).map((p) => p.id)).toEqual([used.id]);
	});

	it('counts only the done tickets of the project', async () => {
		const owner = await createOwner(superuser);
		const project = await createProject(owner.client, { name: 'Zählen', code: uniqueCode() });
		const other = await createProject(owner.client, { name: 'Anderes', code: uniqueCode() });
		expect(await countDoneTickets(owner.client, project.id)).toBe(0);

		const done = [];
		for (let index = 0; index < 3; index += 1) {
			done.push(await owner.ticket({ project: project.id }));
		}
		await owner.ticket({ project: project.id, status: 'in_progress' });
		const elsewhere = await owner.ticket({ project: other.id });
		const withoutProject = await createTicket(owner.client, ticketDraft());
		for (const ticket of [...done, elsewhere, withoutProject]) {
			await setTicketDone(owner.client, ticket.id, true);
		}

		expect(await countDoneTickets(owner.client, project.id)).toBe(3);
		expect(await countDoneTickets(owner.client, other.id)).toBe(1);
		// Another user counts nothing: the list rule hides the tickets.
		expect(await countDoneTickets(b.client, project.id)).toBe(0);
	});
});
