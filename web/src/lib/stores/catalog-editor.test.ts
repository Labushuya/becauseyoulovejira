// Managing projects and tags with a fake data layer (E3 plan, T-11, T-14 and package 14): checks
// before sending, only changed fields, answers go into the catalog at once, field errors of the
// server per field, other errors as message, session end.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import { CatalogStore, type CatalogData } from './catalog.svelte';
import { CatalogEditor, type CatalogEditorData } from './catalog-editor';

const T0 = '2026-09-24 08:00:00.000Z';
const T1 = '2026-09-24 09:00:00.000Z';

const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haus',
	code: 'HAUS',
	archived: false,
	updated: T0
};
const GARDEN: Tag = { id: 'tag000000000001', name: 'Garten', updated: T0 };
const CALL: Tag = { id: 'tag000000000002', name: 'anrufen', updated: T0 };

async function setup() {
	const catalogData = {
		listProjects: vi.fn<CatalogData['listProjects']>(async () => [HOUSE]),
		listTags: vi.fn<CatalogData['listTags']>(async () => [GARDEN, CALL]),
		createTag: vi.fn<CatalogData['createTag']>()
	} satisfies CatalogData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const catalog = new CatalogStore(catalogData, session);
	await catalog.load();
	const data = {
		createProject: vi.fn<CatalogEditorData['createProject']>(async (draft) => ({
			id: 'proj00000000009',
			...draft,
			archived: false,
			updated: T1
		})),
		updateProject: vi.fn<CatalogEditorData['updateProject']>(async (id, patch) => ({
			...HOUSE,
			...patch,
			id,
			updated: T1
		})),
		setProjectArchived: vi.fn<CatalogEditorData['setProjectArchived']>(async (id, archived) => ({
			...HOUSE,
			id,
			archived,
			updated: T1
		})),
		deleteProject: vi.fn<CatalogEditorData['deleteProject']>(async () => undefined),
		renameTag: vi.fn<CatalogEditorData['renameTag']>(async (id, name) => ({
			id,
			name,
			updated: T1
		})),
		deleteTag: vi.fn<CatalogEditorData['deleteTag']>(async () => undefined),
		countTicketsWithTag: vi.fn<CatalogEditorData['countTicketsWithTag']>(async () => 4)
	} satisfies CatalogEditorData;
	const editor = new CatalogEditor(data, session, catalog);
	return { editor, data, catalog, session };
}

function validation(fields: Record<string, { code: string; message: string }>) {
	return new DataError('validation', { status: 400, fields });
}

describe('CatalogEditor: projects', () => {
	it('creates a project with trimmed name and code in capitals and adds it to the catalog', async () => {
		const { editor, data, catalog } = await setup();

		const result = await editor.createProject({ name: '  Garten  ', code: ' gart ' });

		expect(data.createProject).toHaveBeenCalledExactlyOnceWith({ name: 'Garten', code: 'GART' });
		expect(result).toEqual({ ok: true, value: expect.objectContaining({ code: 'GART' }) });
		expect(catalog.projectById('proj00000000009')?.name).toBe('Garten');
	});

	it.each([
		[{ name: ' ', code: 'HAUS' }, { name: 'Der Name darf nicht leer sein.' }],
		[{ name: 'Haus', code: 'TASK' }, { code: 'Der Code TASK ist reserviert.' }],
		[{ name: 'Haus', code: 'H1' }, { code: 'Nur 2 bis 6 Großbuchstaben (A–Z).' }],
		[
			{ name: '', code: '' },
			{ name: 'Der Name darf nicht leer sein.', code: 'Bitte einen Code eingeben.' }
		]
	])('checks %j before sending', async (draft, fields) => {
		const { editor, data } = await setup();

		expect(await editor.createProject(draft)).toEqual({ ok: false, message: null, fields });
		expect(data.createProject).not.toHaveBeenCalled();
	});

	it('shows field errors of the server at the field (duplicate code, code in use)', async () => {
		const { editor, data } = await setup();
		data.createProject.mockRejectedValueOnce(
			validation({
				code: { code: 'validation_not_unique', message: 'Schon vergeben.' },
				scope: { code: 'validation_not_unique', message: 'Schon vergeben.' }
			})
		);

		expect(await editor.createProject({ name: 'Haus 2', code: 'HAUS' })).toEqual({
			ok: false,
			message: null,
			fields: { code: 'Schon vergeben.' }
		});
	});

	it('sends only changed fields and nothing without a change', async () => {
		const { editor, data, catalog } = await setup();

		expect(await editor.updateProject(HOUSE, { name: 'Haus ', code: 'haus' })).toEqual({
			ok: true,
			value: HOUSE
		});
		expect(data.updateProject).not.toHaveBeenCalled();

		await editor.updateProject(HOUSE, { name: 'Wohnung', code: 'HAUS' });
		expect(data.updateProject).toHaveBeenCalledExactlyOnceWith(HOUSE.id, { name: 'Wohnung' });
		expect(catalog.projectById(HOUSE.id)?.name).toBe('Wohnung');
	});

	it('archives, restores and deletes through the catalog', async () => {
		const { editor, data, catalog } = await setup();

		await editor.setProjectArchived(HOUSE, true);
		expect(data.setProjectArchived).toHaveBeenCalledWith(HOUSE.id, true);
		expect(catalog.activeProjects).toEqual([]);

		await editor.deleteProject(HOUSE);
		expect(data.deleteProject).toHaveBeenCalledWith(HOUSE.id);
		expect(catalog.projects).toEqual([]);
	});

	it('reports the refusal to delete a project with tickets as message', async () => {
		const { editor, data, catalog } = await setup();
		data.deleteProject.mockRejectedValueOnce(
			validation({
				id: {
					code: 'validation_project_in_use',
					message: 'Ein Projekt mit Tickets lässt sich nicht löschen. Bitte archivieren.'
				}
			})
		);

		expect(await editor.deleteProject(HOUSE)).toEqual({
			ok: false,
			message: 'Ein Projekt mit Tickets lässt sich nicht löschen. Bitte archivieren.',
			fields: {}
		});
		expect(catalog.projectById(HOUSE.id)).not.toBeNull();
	});

	it('shows network errors as message and ends the session on 401 without one', async () => {
		const { editor, data, session } = await setup();
		data.setProjectArchived.mockRejectedValueOnce(new DataError('network'));
		const failed = await editor.setProjectArchived(HOUSE, true);
		expect(failed.ok).toBe(false);
		expect(!failed.ok && failed.message).toMatch(/Server nicht erreichbar/);

		data.setProjectArchived.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		expect(await editor.setProjectArchived(HOUSE, true)).toEqual({
			ok: false,
			message: null,
			fields: {}
		});
		expect(session.logout).toHaveBeenCalledOnce();

		session.ensureValid.mockReturnValue(false);
		await editor.deleteProject(HOUSE);
		expect(data.deleteProject).not.toHaveBeenCalled();
	});
});

describe('CatalogEditor: colors (ADR-0052)', () => {
	it('sends the color only when it is set or changes, null to remove it, a refusal at the field', async () => {
		const { editor, data } = await setup();
		await editor.createProject({ name: 'Garten', code: 'GART', color: 'gruen' });
		expect(data.createProject).toHaveBeenLastCalledWith({
			name: 'Garten',
			code: 'GART',
			color: 'gruen'
		});
		await editor.createProject({ name: 'Keller', code: 'KELL', color: null });
		expect(data.createProject).toHaveBeenLastCalledWith({ name: 'Keller', code: 'KELL' });

		const colored: Project = { ...HOUSE, color: 'blau' };
		await editor.updateProject(colored, { name: 'Haus', code: 'HAUS', color: 'blau' });
		await editor.updateProject(colored, { name: 'Haus', code: 'HAUS' });
		expect(data.updateProject).not.toHaveBeenCalled();
		await editor.updateProject(colored, { name: 'Haus', code: 'HAUS', color: null });
		expect(data.updateProject).toHaveBeenLastCalledWith(HOUSE.id, { color: null });

		data.updateProject.mockRejectedValueOnce(
			validation({ color: { code: 'validation_invalid_value', message: 'Ungültiger Wert.' } })
		);
		expect(
			await editor.updateProject(colored, { name: 'Haus', code: 'HAUS', color: 'senf' })
		).toEqual({
			ok: false,
			message: null,
			fields: { color: 'Ungültiger Wert.' }
		});
	});
});

describe('CatalogEditor: sub projects (ADR-0034)', () => {
	it('creates a sub project with its parent and sends no parent without one', async () => {
		const { editor, data } = await setup();

		await editor.createProject({ name: 'Garten', code: 'GART', parentId: HOUSE.id });
		expect(data.createProject).toHaveBeenLastCalledWith({
			name: 'Garten',
			code: 'GART',
			parentId: HOUSE.id
		});
		await editor.createProject({ name: 'Keller', code: 'KELL', parentId: null });
		expect(data.createProject).toHaveBeenLastCalledWith({ name: 'Keller', code: 'KELL' });
	});

	it('sends the parent only when it changes, null to release', async () => {
		const { editor, data } = await setup();
		const garden: Project = {
			id: 'proj00000000011',
			name: 'Garten',
			code: 'GART',
			archived: false,
			updated: T0,
			parentId: HOUSE.id
		};

		await editor.updateProject(garden, { name: 'Garten', code: 'GART', parentId: HOUSE.id });
		await editor.updateProject(garden, { name: 'Garten', code: 'GART' });
		expect(data.updateProject).not.toHaveBeenCalled();

		await editor.updateProject(garden, { name: 'Garten', code: 'GART', parentId: null });
		expect(data.updateProject).toHaveBeenLastCalledWith(garden.id, { parentId: null });
		await editor.updateProject(HOUSE, { name: 'Haus', code: 'HAUS', parentId: garden.id });
		expect(data.updateProject).toHaveBeenLastCalledWith(HOUSE.id, { parentId: garden.id });
	});

	it('shows a refusal of the hook at the field "Oberprojekt"', async () => {
		const { editor, data } = await setup();
		data.updateProject.mockRejectedValueOnce(
			validation({
				parent: {
					code: 'validation_project_parent_nested',
					message: 'Das gewählte Projekt ist selbst ein Unterprojekt. Es gibt nur eine Ebene.'
				}
			})
		);

		expect(
			await editor.updateProject(HOUSE, { name: 'Haus', code: 'HAUS', parentId: 'proj00000000011' })
		).toEqual({
			ok: false,
			message: null,
			fields: {
				parent: 'Das gewählte Projekt ist selbst ein Unterprojekt. Es gibt nur eine Ebene.'
			}
		});
	});
});

describe('CatalogEditor: tags', () => {
	it('renames a tag trimmed and puts it into the catalog', async () => {
		const { editor, data, catalog } = await setup();

		const result = await editor.renameTag(GARDEN, '  Garten & Hof ');

		expect(data.renameTag).toHaveBeenCalledExactlyOnceWith(GARDEN.id, 'Garten & Hof');
		expect(result.ok).toBe(true);
		expect(catalog.tagById(GARDEN.id)?.name).toBe('Garten & Hof');
	});

	it('sends nothing for the same name but allows another spelling of it', async () => {
		const { editor, data } = await setup();

		expect(await editor.renameTag(GARDEN, ' Garten ')).toEqual({ ok: true, value: GARDEN });
		expect(data.renameTag).not.toHaveBeenCalled();

		await editor.renameTag(GARDEN, 'GARTEN');
		expect(data.renameTag).toHaveBeenCalledWith(GARDEN.id, 'GARTEN');
	});

	it('refuses a name another tag has in any spelling, an empty one and a too long one', async () => {
		const { editor, data } = await setup();

		expect(await editor.renameTag(GARDEN, 'ANRUFEN')).toEqual({
			ok: false,
			message: null,
			fields: { name: 'Diesen Namen hat schon ein anderer Tag.' }
		});
		expect(await editor.renameTag(GARDEN, '  ')).toEqual({
			ok: false,
			message: null,
			fields: { name: 'Der Name darf nicht leer sein.' }
		});
		expect(await editor.renameTag(GARDEN, 'x'.repeat(51))).toEqual({
			ok: false,
			message: null,
			fields: { name: 'Höchstens 50 Zeichen.' }
		});
		expect(data.renameTag).not.toHaveBeenCalled();
	});

	it('shows the conflict of the server at the name (tag from another tab)', async () => {
		const { editor, data } = await setup();
		data.renameTag.mockRejectedValueOnce(
			validation({ name: { code: 'validation_not_unique', message: 'Schon vergeben.' } })
		);

		expect(await editor.renameTag(GARDEN, 'Hof')).toEqual({
			ok: false,
			message: null,
			fields: { name: 'Schon vergeben.' }
		});
	});

	it('deletes a tag from the catalog and counts its tickets', async () => {
		const { editor, data, catalog } = await setup();
		const controller = new AbortController();

		expect(await editor.countTicketsWithTag(CALL, { signal: controller.signal })).toEqual({
			ok: true,
			value: 4
		});
		expect(data.countTicketsWithTag).toHaveBeenCalledWith(CALL.id, { signal: controller.signal });

		await editor.deleteTag(CALL);
		expect(data.deleteTag).toHaveBeenCalledWith(CALL.id);
		expect(catalog.tagById(CALL.id)).toBeNull();
	});
});
