// Component tests for the history (E2 plan, package 10) and the tabs "Kommentare" / "Verlauf"
// (T-11): readable entries with time, actor and text, the collapsible description as plain text,
// "System" for an empty actor, "(gelöscht)" for unknown IDs, keyboard use of the tabs.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import type { HistoryEntry } from '$lib/domain/ticket';
import { CatalogStore, type CatalogData } from '$lib/stores/catalog.svelte';
import { TicketActivityStore, type TicketActivityData } from '$lib/stores/ticket-activity.svelte';
import { useProseMirrorStubs } from '$lib/test/prosemirror-stubs';
import TicketActivity from './TicketActivity.svelte';

useProseMirrorStubs();

const TICKET = 'ticket000000001';
const ME = 'user0000000001';

function entry(overrides: Partial<HistoryEntry>): HistoryEntry {
	return {
		id: 'hist00000000001',
		ticket: TICKET,
		field: 'created',
		oldValue: '',
		newValue: 'TASK-3',
		user: ME,
		created: '2026-09-24 09:00:00.000Z',
		...overrides
	};
}

const HISTORY: HistoryEntry[] = [
	entry({
		id: 'h4',
		field: 'description',
		oldValue: '**alt**',
		newValue: '<script>neu</script>',
		created: '2026-09-24 12:00:00.000Z'
	}),
	entry({
		id: 'h3',
		field: 'project',
		oldValue: '',
		newValue: 'proj00000000009',
		user: '',
		created: '2026-09-24 11:00:00.000Z'
	}),
	entry({
		id: 'h2',
		field: 'status',
		oldValue: 'open',
		newValue: 'in_progress',
		created: '2026-09-24 10:00:00.000Z'
	}),
	entry({ id: 'h1' })
];

/** Loaded catalog (E3 plan, T-16) with the given projects and tags. */
async function loadedCatalog(projects: Project[] = [], tags: Tag[] = []) {
	const data = {
		listProjects: vi.fn<CatalogData['listProjects']>(async () => projects),
		listTags: vi.fn<CatalogData['listTags']>(async () => tags),
		createTag: vi.fn<CatalogData['createTag']>()
	} satisfies CatalogData;
	const catalog = new CatalogStore(data, { ensureValid: () => true, logout: vi.fn() });
	await catalog.load();
	return { catalog, data };
}

async function renderActivity(history: HistoryEntry[] = HISTORY, catalog?: CatalogStore) {
	const data = {
		listComments: vi.fn(async () => []),
		createComment: vi.fn(),
		updateComment: vi.fn(),
		deleteComment: vi.fn(),
		listHistory: vi.fn<TicketActivityData['listHistory']>(async () => history)
	} satisfies TicketActivityData;
	const store = new TicketActivityStore(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		() => ME
	);
	store.open(TICKET);
	const shown = catalog ?? (await loadedCatalog()).catalog;
	const result = render(TicketActivity, { props: { store, catalog: shown } });
	await vi.waitFor(() => expect(store.historyState).not.toBe('loading'));
	await tick();
	return { ...result, store, data, catalog: shown };
}

function tab(name: string) {
	return screen.getByRole('tab', { name: new RegExp(`^${name}`) });
}

describe('activity tabs', () => {
	it('selects "Kommentare" first and shows only its panel', async () => {
		await renderActivity();

		expect(screen.getByRole('tablist', { name: 'Aktivität' })).toBeTruthy();
		expect(tab('Kommentare').getAttribute('aria-selected')).toBe('true');
		expect(tab('Verlauf').getAttribute('aria-selected')).toBe('false');
		expect(tab('Kommentare').tabIndex).toBe(0);
		expect(tab('Verlauf').tabIndex).toBe(-1);
		expect(screen.getByRole('tabpanel', { name: /^Kommentare/ })).toBeTruthy();
		expect(screen.queryByRole('tabpanel', { name: 'Verlauf' })).toBeNull();
	});

	it('switches with the mouse and with the arrow keys, Home and End', async () => {
		await renderActivity();

		await fireEvent.click(tab('Verlauf'));
		expect(tab('Verlauf').getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('tabpanel', { name: 'Verlauf' })).toBeTruthy();

		await fireEvent.keyDown(tab('Verlauf'), { key: 'ArrowRight' });
		expect(document.activeElement).toBe(tab('Kommentare'));
		expect(tab('Kommentare').getAttribute('aria-selected')).toBe('true');

		await fireEvent.keyDown(tab('Kommentare'), { key: 'ArrowLeft' });
		expect(tab('Verlauf').getAttribute('aria-selected')).toBe('true');

		await fireEvent.keyDown(tab('Verlauf'), { key: 'Home' });
		expect(tab('Kommentare').getAttribute('aria-selected')).toBe('true');

		await fireEvent.keyDown(tab('Kommentare'), { key: 'End' });
		expect(tab('Verlauf').getAttribute('aria-selected')).toBe('true');
	});

	it('keeps a comment being written when switching tabs', async () => {
		await renderActivity();
		await fireEvent.click(screen.getByRole('button', { name: 'Kommentar hinzufügen …' }));
		await screen.findByRole('textbox', { name: 'Neuer Kommentar' }, { timeout: 5000 });
		await fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));
		const field = await screen.findByLabelText<HTMLTextAreaElement>('Neuer Kommentar (Markdown)');
		await fireEvent.input(field, { target: { value: 'Entwurf' } });

		await fireEvent.click(tab('Verlauf'));
		await fireEvent.click(tab('Kommentare'));

		expect(screen.getByLabelText<HTMLTextAreaElement>('Neuer Kommentar (Markdown)').value).toBe(
			'Entwurf'
		);
	});
});

describe('history list', () => {
	it('shows each entry newest first with actor, time and readable text', async () => {
		await renderActivity();
		await fireEvent.click(tab('Verlauf'));
		const panel = screen.getByRole('tabpanel', { name: 'Verlauf' });

		const items = within(panel).getAllByRole('listitem');
		expect(items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
			'Du 24.09.2026 14:00 Beschreibung geändert Vorher **alt** Nachher <script>neu</script>',
			'System 24.09.2026 13:00 Projekt: – → (gelöscht)',
			'Du 24.09.2026 12:00 Status: Offen → In Arbeit',
			'Du 24.09.2026 11:00 hat das Ticket angelegt (TASK-3)'
		]);
	});

	it('opens the old and new description as plain text', async () => {
		await renderActivity();
		await fireEvent.click(tab('Verlauf'));
		const details = screen.getByText('Beschreibung geändert').closest('details');

		expect(details?.open).toBe(false);
		await fireEvent.click(screen.getByText('Beschreibung geändert'));
		expect(details?.querySelector('script, strong')).toBeNull();
		expect(within(details as HTMLElement).getByText('<script>neu</script>').tagName).toBe('PRE');
	});

	it('shows the empty state', async () => {
		await renderActivity([]);
		await fireEvent.click(tab('Verlauf'));

		// Compact empty state since EH-11: a heading without full stop.
		expect(screen.getByRole('heading', { name: 'Noch kein Verlauf' })).toBeTruthy();
	});

	it('shows a loading error with "Erneut versuchen"', async () => {
		const data = {
			listComments: vi.fn(async () => []),
			createComment: vi.fn(),
			updateComment: vi.fn(),
			deleteComment: vi.fn(),
			listHistory: vi
				.fn<TicketActivityData['listHistory']>()
				.mockRejectedValueOnce(new DataError('server', { status: 500 }))
				.mockResolvedValueOnce([entry({})])
		} satisfies TicketActivityData;
		const store = new TicketActivityStore(
			data,
			{ ensureValid: () => true, logout: vi.fn() },
			() => ME
		);
		store.open(TICKET);
		render(TicketActivity, { props: { store, catalog: (await loadedCatalog()).catalog } });
		await vi.waitFor(() => expect(store.historyState).toBe('error'));
		await fireEvent.click(tab('Verlauf'));

		const alert = screen.getByText(/Der Server hat mit einem Fehler geantwortet/);
		expect(alert.closest('.alert-error')).not.toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
		await vi.waitFor(() =>
			expect(screen.getByText('hat das Ticket angelegt (TASK-3)')).toBeTruthy()
		);
	});
});

describe('history names from the catalog (E3 plan, T-16)', () => {
	const UPDATED = '2026-09-24 08:00:00.000Z';
	const HOUSE: Project = {
		id: 'proj00000000001',
		name: 'Haus',
		code: 'HAUS',
		archived: false,
		updated: UPDATED
	};
	const OLD: Project = {
		id: 'proj00000000002',
		name: 'Altbau',
		code: 'ALT',
		archived: true,
		updated: UPDATED
	};
	const GARDEN: Tag = { id: 'tag000000000001', name: 'Garten', updated: UPDATED };
	const NAMED: HistoryEntry[] = [
		entry({
			id: 'h3',
			field: 'tags',
			oldValue: '',
			newValue: JSON.stringify([GARDEN.id, 'tag000000000009']),
			created: '2026-09-24 11:00:00.000Z'
		}),
		entry({
			id: 'h2',
			field: 'project',
			oldValue: OLD.id,
			newValue: HOUSE.id,
			created: '2026-09-24 10:00:00.000Z'
		})
	];

	function texts() {
		const panel = screen.getByRole('tabpanel', { name: 'Verlauf' });
		return within(panel)
			.getAllByRole('listitem')
			.map((item) => item.querySelector('.text-line')?.textContent?.trim());
	}

	it('resolves active and archived projects and tags, unknown ones as "(gelöscht)"', async () => {
		const { catalog } = await loadedCatalog([HOUSE, OLD], [GARDEN]);
		await renderActivity(NAMED, catalog);
		await fireEvent.click(tab('Verlauf'));

		expect(texts()).toEqual([
			'Tags hinzugefügt: Garten, (gelöscht)',
			'Projekt: Altbau (ALT) → Haus (HAUS)'
		]);
	});

	it('follows renames and deletions in the catalog without loading the history again', async () => {
		const { catalog } = await loadedCatalog([HOUSE, OLD], [GARDEN]);
		const { data } = await renderActivity(NAMED, catalog);
		await fireEvent.click(tab('Verlauf'));

		catalog.upsertProject({ ...HOUSE, name: 'Wohnung', updated: '2026-09-24 09:00:00.000Z' });
		catalog.removeTag(GARDEN.id);
		await tick();

		expect(texts()).toEqual([
			'Tags hinzugefügt: (gelöscht), (gelöscht)',
			'Projekt: Altbau (ALT) → Wohnung (HAUS)'
		]);
		expect(data.listHistory).toHaveBeenCalledTimes(1);
	});

	it('waits for the catalog instead of showing names as deleted', async () => {
		let finish: (projects: Project[]) => void = () => undefined;
		const catalogData = {
			listProjects: vi.fn<CatalogData['listProjects']>(
				() => new Promise((resolve) => (finish = resolve))
			),
			listTags: vi.fn<CatalogData['listTags']>(async () => [GARDEN]),
			createTag: vi.fn<CatalogData['createTag']>()
		} satisfies CatalogData;
		const catalog = new CatalogStore(catalogData, { ensureValid: () => true, logout: vi.fn() });
		void catalog.load();
		await renderActivity(NAMED, catalog);
		await fireEvent.click(tab('Verlauf'));

		expect(screen.getByRole('status').textContent).toContain('Verlauf wird geladen');
		expect(screen.queryByText(/gelöscht/)).toBeNull();

		finish([HOUSE, OLD]);
		await vi.waitFor(() => expect(texts()[1]).toBe('Projekt: Altbau (ALT) → Haus (HAUS)'));
	});

	it('shows a failed catalog as error and loads it again with "Erneut versuchen"', async () => {
		const catalogData = {
			listProjects: vi
				.fn<CatalogData['listProjects']>()
				.mockRejectedValueOnce(new DataError('network'))
				.mockResolvedValueOnce([HOUSE, OLD]),
			listTags: vi.fn<CatalogData['listTags']>(async () => [GARDEN]),
			createTag: vi.fn<CatalogData['createTag']>()
		} satisfies CatalogData;
		const catalog = new CatalogStore(catalogData, { ensureValid: () => true, logout: vi.fn() });
		await catalog.load();
		const { data } = await renderActivity(NAMED, catalog);
		await fireEvent.click(tab('Verlauf'));

		expect(screen.getByText(/Server nicht erreichbar/).closest('.alert-error')).not.toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

		await vi.waitFor(() => expect(texts()[1]).toBe('Projekt: Altbau (ALT) → Haus (HAUS)'));
		expect(catalogData.listProjects).toHaveBeenCalledTimes(2);
		expect(data.listHistory).toHaveBeenCalledTimes(1);
	});
});
