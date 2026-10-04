// Sub projects (ADR-0034, package UP-1): one level, same scope, own code and number range, archive
// cascade in the transaction of the parent, no delete while sub projects exist. The project hook
// checks everything; API rules are unchanged.

import { beforeAll, describe, expect, it } from 'vitest';
import { rejectionOf, superuserClient } from '../support/api.mjs';
import {
	FAIL_PROJECT_ARCHIVE,
	counterValue,
	createOwner,
	createScenario,
	uniqueCode
} from '../support/scenario.mjs';

const rejected = (field, code) => ({ status: 400, codes: { [field]: code } });

describe('sub projects (ADR-0034)', () => {
	let superuser;
	let owner;
	let projects;

	beforeAll(async () => {
		superuser = await superuserClient();
		owner = await createOwner(superuser);
		projects = owner.client.collection('projects');
	});

	/** A top-level project "Haus" and a sub project "Garten" with their own codes. */
	async function house() {
		const parent = await owner.project(uniqueCode(), { name: 'Haus' });
		const child = await owner.project(uniqueCode(), { name: 'Garten', parent: parent.id });
		return { parent, child };
	}

	describe('creating and moving', () => {
		it('gives a sub project its own code and number range, and keeps the keys when it moves', async () => {
			const { parent, child } = await house();
			expect(child.parent).toBe(parent.id);
			expect(child.scope).toBe(`u:${owner.id}`);

			const inChild = await owner.ticket({ project: child.id });
			const inParent = await owner.ticket({ project: parent.id });
			expect(inChild.key).toBe(`${child.code}-1`);
			expect(inParent.key).toBe(`${parent.code}-1`);

			// Release and attach to another parent: no key and no counter changes.
			const other = await owner.project(uniqueCode(), { name: 'Keller' });
			await projects.update(child.id, { parent: '' });
			await projects.update(child.id, { parent: other.id });
			expect((await owner.client.collection('tickets').getOne(inChild.id)).key).toBe(inChild.key);
			expect(await counterValue(superuser, `u:${owner.id}:${child.id}`)).toBe(1);
			expect((await owner.ticket({ project: child.id })).key).toBe(`${child.code}-2`);
		});

		it('allows tickets directly in a parent project', async () => {
			const { parent } = await house();
			expect((await owner.ticket({ project: parent.id })).key).toBe(`${parent.code}-1`);
		});

		it('refuses the project itself as parent', async () => {
			const { parent } = await house();
			expect(await rejectionOf(projects.update(parent.id, { parent: parent.id }))).toEqual(
				rejected('parent', 'validation_project_parent_self')
			);
		});

		it('allows one level only', async () => {
			const { parent, child } = await house();
			// Below a sub project.
			expect(
				await rejectionOf(owner.project(uniqueCode(), { name: 'Beet', parent: child.id }))
			).toEqual(rejected('parent', 'validation_project_parent_nested'));
			// A project with sub projects does not become one.
			const top = await owner.project(uniqueCode(), { name: 'Grundstück' });
			expect(await rejectionOf(projects.update(parent.id, { parent: top.id }))).toEqual(
				rejected('parent', 'validation_project_parent_has_children')
			);
			expect((await projects.getOne(parent.id)).parent).toBe('');
		});

		it('names a foreign parent like a missing one', async () => {
			const stranger = await createOwner(superuser);
			const foreign = await stranger.project(uniqueCode());
			const missing = rejected('parent', 'validation_project_parent_missing');
			const viaForeign = await projects
				.create({ owner: owner.id, name: 'Fremd', code: uniqueCode(), parent: foreign.id })
				.catch((error) => error);
			const viaMissing = await projects
				.create({ owner: owner.id, name: 'Fehlt', code: uniqueCode(), parent: 'abcdefghijklmno' })
				.catch((error) => error);
			expect(await rejectionOf(Promise.reject(viaForeign))).toEqual(missing);
			expect(await rejectionOf(Promise.reject(viaMissing))).toEqual(missing);
			expect(viaForeign.response.data.parent.message).toBe(viaMissing.response.data.parent.message);
			expect(viaForeign.response.data.parent.message).toBe('Das Oberprojekt wurde nicht gefunden.');
		});
	});

	describe('scopes', () => {
		let s;

		beforeAll(async () => {
			s = await createScenario();
		});

		it('keeps parent and sub project in one scope', async () => {
			const projectsOfA = s.a.collection('projects');
			const privateParent = await projectsOfA.create({
				owner: s.ids.a,
				name: 'Privat',
				code: uniqueCode()
			});
			// A household project below a private one: the parent is not in its scope.
			expect(
				await rejectionOf(
					projectsOfA.create({
						owner: s.ids.a,
						household: s.h1.id,
						name: 'Haushalt',
						code: uniqueCode(),
						parent: privateParent.id
					})
				)
			).toEqual(rejected('parent', 'validation_project_parent_missing'));

			// A household member sees the parent and may use it.
			const householdParent = await projectsOfA.create({
				owner: s.ids.a,
				household: s.h1.id,
				name: 'Haus',
				code: uniqueCode()
			});
			const ofB = await s.b.collection('projects').create({
				owner: s.ids.b,
				household: s.h1.id,
				name: 'Garten',
				code: uniqueCode(),
				parent: householdParent.id
			});
			expect(ofB.parent).toBe(householdParent.id);

			// The parent keeps its scope while it has sub projects; the sub project cannot leave. A client
			// changes no area through the Record API (scope-guard.pb.js, ADR-0058), so the superuser
			// tries it.
			const moves = s.superuser.collection('projects');
			expect(await rejectionOf(moves.update(householdParent.id, { household: '' }))).toEqual(
				rejected('household', 'validation_project_scope_children')
			);
			expect(await rejectionOf(moves.update(ofB.id, { household: '' }))).toEqual(
				rejected('parent', 'validation_project_parent_missing')
			);
		});
	});

	describe('archiving (cascade)', () => {
		it('archives the sub projects with the parent and restores only the parent', async () => {
			const { parent, child } = await house();
			const second = await owner.project(uniqueCode(), { name: 'Dach', parent: parent.id });
			const archivedBefore = await owner.project(uniqueCode(), {
				name: 'Schuppen',
				parent: parent.id,
				archived: true
			});

			const saved = await projects.update(parent.id, { archived: true });
			expect(saved.archived).toBe(true);
			for (const id of [child.id, second.id, archivedBefore.id]) {
				expect((await projects.getOne(id)).archived, id).toBe(true);
			}

			await projects.update(parent.id, { archived: false });
			expect((await projects.getOne(child.id)).archived).toBe(true);
			// Now the sub project may come back on its own.
			expect((await projects.update(child.id, { archived: false })).archived).toBe(false);
		});

		it('refuses an active sub project under an archived parent', async () => {
			const { parent, child } = await house();
			await projects.update(parent.id, { archived: true });
			const archivedParent = rejected('parent', 'validation_project_parent_archived');

			expect(await rejectionOf(projects.update(child.id, { archived: false }))).toEqual(
				archivedParent
			);
			expect(
				await rejectionOf(owner.project(uniqueCode(), { name: 'Neu', parent: parent.id }))
			).toEqual(archivedParent);
			const loose = await owner.project(uniqueCode(), { name: 'Lose' });
			expect(await rejectionOf(projects.update(loose.id, { parent: parent.id }))).toEqual(
				archivedParent
			);
			// Archived, it may move below the archived parent.
			const archivedLoose = await owner.project(uniqueCode(), { name: 'Alt', archived: true });
			expect((await projects.update(archivedLoose.id, { parent: parent.id })).parent).toBe(
				parent.id
			);
		});

		it('keeps everything active when one sub project fails', async () => {
			const { parent, child } = await house();
			const failing = await owner.project(uniqueCode(), {
				name: FAIL_PROJECT_ARCHIVE,
				parent: parent.id
			});
			const result = await rejectionOf(projects.update(parent.id, { archived: true }));
			expect(result.status).toBe(400);
			for (const id of [parent.id, child.id, failing.id]) {
				expect((await projects.getOne(id)).archived, id).toBe(false);
			}
		});

		it('keeps tickets of an archived sub project editable and refuses new ones', async () => {
			const { parent, child } = await house();
			const ticket = await owner.ticket({ project: child.id });
			await projects.update(parent.id, { archived: true });
			const edited = await owner.client
				.collection('tickets')
				.update(ticket.id, { title: 'Weiter bearbeitbar' });
			expect(edited.key).toBe(ticket.key);
			expect(await rejectionOf(owner.ticket({ project: child.id }))).toEqual(
				rejected('project', 'validation_project_archived')
			);
		});
	});

	describe('deleting', () => {
		it('refuses to delete a project with sub projects and names the way', async () => {
			const { parent, child } = await house();
			const error = await projects.delete(parent.id).catch((failure) => failure);
			expect(await rejectionOf(Promise.reject(error))).toEqual(
				rejected('id', 'validation_project_has_children')
			);
			expect(error.response.data.id.message).toBe(
				'Ein Projekt mit Unterprojekten kann nicht gelöscht werden. Erst die Unterprojekte löschen oder einem anderen Projekt zuordnen.'
			);
			expect((await projects.getOne(child.id)).parent).toBe(parent.id);

			await projects.delete(child.id);
			await projects.delete(parent.id);
			await expect(projects.getOne(parent.id)).rejects.toMatchObject({ status: 404 });
		});

		it('still refuses to delete a sub project with tickets', async () => {
			const { child } = await house();
			await owner.ticket({ project: child.id });
			expect(await rejectionOf(projects.delete(child.id))).toEqual(
				rejected('id', 'validation_project_in_use')
			);
		});
	});
});
