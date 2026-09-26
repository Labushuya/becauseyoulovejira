// Page test of the settings page "Tags" (user request after EH-4): the tag list of the catalog with
// "Umbenennen" and "Löschen …", results as flags, a failed load as an error message with "Erneut
// versuchen", and loading. The catalog, the flags and the data layer of the editor are fakes; the
// editor itself is real.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tag } from '$lib/domain/tag';
import { CatalogStore, type CatalogData } from '$lib/stores/catalog.svelte';
import type { CatalogEditorData } from '$lib/stores/catalog-editor';
import { FlagStore } from '$lib/stores/flags.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TagsPage from './+page.svelte';

const T0 = '2026-09-24 08:00:00.000Z';
const GARDEN: Tag = { id: 'tag000000000001', name: 'Garten', updated: T0 };
const CALL: Tag = { id: 'tag000000000002', name: 'anrufen', updated: T0 };

const mocks = vi.hoisted(() => ({
	catalog: null as unknown,
	flags: null as unknown,
	editorData: null as unknown
}));

vi.mock('$lib/auth.svelte', () => ({ auth: { ensureValid: () => true, logout: vi.fn() } }));
vi.mock('$lib/stores/catalog.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getCatalogStore: () => mocks.catalog
}));
vi.mock('$lib/stores/flags.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getFlagStore: () => mocks.flags
}));
vi.mock('$lib/stores/catalog-editor', async (importOriginal) => ({
	...(await importOriginal<object>()),
	catalogEditorData: () => mocks.editorData
}));

useOverlayStubs();

async function show(listTags: CatalogData['listTags'] = async () => [CALL, GARDEN]) {
	const session = { ensureValid: () => true, logout: vi.fn() };
	const catalog = new CatalogStore(
		{ listProjects: async () => [], listTags, createTag: vi.fn() },
		session
	);
	const flags = new FlagStore();
	const editorData = {
		createProject: vi.fn<CatalogEditorData['createProject']>(),
		updateProject: vi.fn<CatalogEditorData['updateProject']>(),
		setProjectArchived: vi.fn<CatalogEditorData['setProjectArchived']>(),
		deleteProject: vi.fn<CatalogEditorData['deleteProject']>(),
		renameTag: vi.fn<CatalogEditorData['renameTag']>(async (id, name) => ({
			id,
			name,
			updated: '2026-09-24 09:00:00.000Z'
		})),
		deleteTag: vi.fn<CatalogEditorData['deleteTag']>(async () => undefined),
		countTicketsWithTag: vi.fn<CatalogEditorData['countTicketsWithTag']>(async () => 0)
	} satisfies CatalogEditorData;
	mocks.catalog = catalog;
	mocks.flags = flags;
	mocks.editorData = editorData;
	const load = catalog.load();
	const view = render(TagsPage);
	await load;
	await tick();
	return { catalog, flags, editorData, view };
}

beforeEach(() => {
	document.body.innerHTML = '';
});

describe('settings page "Tags"', () => {
	it('lists the tags of the catalog below a short explanation', async () => {
		await show();

		expect(screen.getByText(/Tags entstehen im Detail eines Tickets/)).toBeTruthy();
		const section = screen.getByRole('region', { name: 'Deine Tags' });
		expect(
			within(section)
				.getAllByRole('listitem')
				.map((item) => item.querySelector('.name')?.textContent)
		).toEqual(['anrufen', 'Garten']);
		expect(document.title).toBe('Tags · Einstellungen · becauseyoulovejira');
	});

	it('renames a tag in the catalog and reports it as a flag', async () => {
		const { catalog, flags, editorData } = await show();

		await fireEvent.click(screen.getByRole('button', { name: 'Tag „Garten“ umbenennen' }));
		const field = screen.getByRole('textbox', { name: /Neuer Name für den Tag „Garten“/ });
		await fireEvent.input(field, { target: { value: 'Beet' } });
		await fireEvent.submit(field.closest('form') as HTMLFormElement);

		await vi.waitFor(() =>
			expect(flags.flags.map((flag) => flag.title)).toEqual(['Tag heißt jetzt „Beet“.'])
		);
		expect(editorData.renameTag).toHaveBeenCalledWith(GARDEN.id, 'Beet');
		expect(catalog.tags.map((tag) => tag.name)).toContain('Beet');
	});

	it('shows a failed load as an error message with "Erneut versuchen"', async () => {
		const listTags = vi
			.fn<CatalogData['listTags']>()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValue([GARDEN]);
		const { catalog } = await show(listTags);

		await vi.waitFor(() => expect(catalog.state).toBe('error'));
		const retry = await screen.findByRole('button', { name: 'Erneut versuchen' });
		await fireEvent.click(retry);
		await vi.waitFor(() => expect(screen.getByRole('region', { name: 'Deine Tags' })).toBeTruthy());
	});
});
