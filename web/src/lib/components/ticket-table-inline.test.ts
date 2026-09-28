// Editing cells of the ticket table in place (plan BI-3, ADR-0036 §6): priority, status, project,
// tags and due date open a small popover from their cell; a click there never opens the ticket,
// Escape closes and returns the focus to the cell, a choice saves through the list store with the
// same Record API as the panel, and a refusal comes as an error flag while the cell keeps its value.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { parseListQuery } from '$lib/domain/list-query';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import FlagGroup from './overlay/FlagGroup.svelte';
import TicketTable from './TicketTable.svelte';

useOverlayStubs();

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haushalt',
	code: 'HAUS',
	archived: false,
	updated: '2026-09-01 10:00:00.000Z'
};
const GARDEN: Tag = { id: 'tag000000000001', name: 'Garten', updated: '2026-09-01 10:00:00.000Z' };
const ID = 't00000000000001';

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: ID,
		key: 'TASK-1',
		title: 'Fenster putzen',
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		parentId: null,
		blocksParent: true,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

async function showTable(open: TicketSummary[], update?: TicketListData['update']) {
	mocks.page.url = new URL('/', 'http://localhost:3000');
	const saved = vi.fn(
		update ??
			(async (id: string, patch: TicketPatch): Promise<TicketSummary> => {
				const current = store.find(id) as TicketSummary;
				const { project, tags, ...fields } = patch;
				return {
					...current,
					...fields,
					...(project !== undefined
						? { projectId: project, key: project === null ? 'TASK-9' : 'HAUS-1' }
						: {}),
					...(tags !== undefined ? { tagIds: tags } : {}),
					updated: '2026-09-02 10:00:00.000Z'
				} as TicketSummary;
			})
	);
	const data: TicketListData = {
		listOpen: vi.fn(async () => open),
		listSubtasks: vi.fn(async () => open.filter((entry) => entry.parentId)),
		listDone: vi.fn(async (page: number) => ({ items: [], page, hasMore: false })),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(async (id: string, done: boolean) => ({
			...(store.find(id) as TicketSummary),
			status: done ? ('done' as const) : ('open' as const),
			updated: '2026-09-02 10:00:00.000Z'
		})),
		update: saved
	};
	const flags = new FlagStore();
	const store = new TicketListStore(data, SESSION, { flags });
	const catalog = new CatalogStore(
		{
			listProjects: vi.fn(async () => [HOUSE]),
			listTags: vi.fn(async () => [GARDEN]),
			createTag: vi.fn()
		},
		SESSION
	);
	await catalog.load();
	store.activate(parseListQuery(mocks.page.url.searchParams));
	render(TicketTable, { props: { store, catalog } });
	render(FlagGroup, { props: { store: flags } });
	await vi.advanceTimersByTimeAsync(0);
	return { store, data, update: saved };
}

const cellButton = (name: RegExp) => screen.getByRole('button', { name });

/** The popover a cell button controls. */
function popoverOf(button: HTMLElement): HTMLElement {
	return document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
}

/** Opens the popover of a cell like a click would, and waits for the focus inside. */
async function openCell(name: RegExp) {
	const button = cellButton(name);
	await fireEvent.pointerEnter(button);
	await fireEvent.click(button);
	await vi.advanceTimersByTimeAsync(0);
	await tick();
	return button;
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 8, 24, 10));
	mocks.goto.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('editing cells in place (plan BI-3)', () => {
	it('makes priority, status, project, tags and due date reachable buttons named with their value', async () => {
		await showTable([ticket({ priority: 'high', due: '2026-10-01' })]);
		for (const name of [
			/^Priorität von TASK-1: Hoch, ändern$/,
			/^Status von TASK-1: Offen, ändern$/,
			/^Projekt von TASK-1: kein Projekt, ändern$/,
			/^Tags von TASK-1: keine, ändern$/,
			/^Fälligkeit von TASK-1: 01\.10\.2026, ändern$/
		]) {
			const button = cellButton(name);
			expect(button.getAttribute('aria-haspopup'), String(name)).toBeTruthy();
			expect(button.tabIndex).toBe(0);
		}
	});

	it('opens the editor from the cell without opening the ticket, also for clicks inside it', async () => {
		await showTable([ticket()]);
		const button = await openCell(/^Priorität von TASK-1/);
		const menu = popoverOf(button);
		await fireEvent.click(menu);
		expect(mocks.goto).not.toHaveBeenCalled();

		// Outside the editable cells the row still opens the ticket.
		await fireEvent.click(document.querySelector('tr[data-ticket-id] .key') as HTMLElement);
		expect(mocks.goto).toHaveBeenCalledOnce();
	});

	it('saves a chosen priority and returns the focus to the cell', async () => {
		const { update, store } = await showTable([ticket()]);
		const button = await openCell(/^Priorität von TASK-1/);
		const current = screen.getByRole('menuitemradio', { hidden: true, name: /Mittel/ });
		expect(current.getAttribute('aria-checked')).toBe('true');

		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: /Dringend/ }));
		await vi.advanceTimersByTimeAsync(0);

		expect(update).toHaveBeenCalledExactlyOnceWith(ID, { priority: 'urgent' });
		expect(store.find(ID)?.priority).toBe('urgent');
		expect(document.activeElement).toBe(button);
		expect(cellButton(/^Priorität von TASK-1: Dringend/)).toBeTruthy();
	});

	it('closes with Escape without saving and returns the focus to the cell', async () => {
		const { update } = await showTable([ticket()]);
		const button = await openCell(/^Status von TASK-1/);
		const menu = popoverOf(button);

		await fireEvent.keyDown(menu, { key: 'Escape' });

		expect(update).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(button);
		expect(button.getAttribute('aria-expanded')).toBe('false');
	});

	it('completes through the check mark path, with the question about open sub-tasks', async () => {
		const { data } = await showTable([
			ticket(),
			ticket({ id: 't00000000000002', key: 'TASK-2', parentId: ID })
		]);
		await openCell(/^Status von TASK-1/);
		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: /Erledigt/ }));
		await vi.advanceTimersByTimeAsync(0);

		expect(screen.getByRole('dialog', { name: 'TASK-1 erledigen?' })).toBeTruthy();
		expect(data.setDone).not.toHaveBeenCalled();
		expect(data.update).not.toHaveBeenCalled();
	});

	it('changes the project, and the row shows the new key of the server', async () => {
		const { update } = await showTable([ticket()]);
		await openCell(/^Projekt von TASK-1/);
		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: /Haushalt/ }));
		await vi.advanceTimersByTimeAsync(0);

		expect(update).toHaveBeenCalledExactlyOnceWith(ID, { project: HOUSE.id });
		expect(cellButton(/^Projekt von HAUS-1: Haushalt \(HAUS\), ändern$/)).toBeTruthy();
	});

	it('sets and clears the due date in its form', async () => {
		const { update } = await showTable([ticket({ due: '2026-10-01' })]);
		await openCell(/^Fälligkeit von TASK-1/);
		const field = screen.getByLabelText<HTMLInputElement>('Fälligkeit von TASK-1', {
			selector: 'input'
		});
		expect(field.value).toBe('2026-10-01');

		await fireEvent.input(field, { target: { value: '2026-10-15' } });
		await fireEvent.submit(field.closest('form') as HTMLFormElement);
		await vi.advanceTimersByTimeAsync(0);
		expect(update).toHaveBeenLastCalledWith(ID, { due: '2026-10-15' });

		await openCell(/^Fälligkeit von TASK-1/);
		await fireEvent.click(screen.getByRole('button', { hidden: true, name: 'Leeren' }));
		await vi.advanceTimersByTimeAsync(0);
		expect(update).toHaveBeenLastCalledWith(ID, { due: null });
	});

	it('adds a tag with the tag input of the ticket', async () => {
		const { update } = await showTable([ticket()]);
		await openCell(/^Tags von TASK-1/);
		const input = screen.getByLabelText('Tags von TASK-1', { selector: 'input' });

		await fireEvent.input(input, { target: { value: 'Garten,' } });
		await vi.advanceTimersByTimeAsync(0);

		expect(update).toHaveBeenCalledWith(ID, { tags: [GARDEN.id] });
	});

	it('shows a refusal as an error flag and keeps the value of the cell', async () => {
		await showTable([ticket()], async () => {
			throw new DataError('validation', {
				status: 400,
				fields: {
					project: { code: 'validation_project_archived', message: 'Das Projekt ist archiviert.' }
				}
			});
		});
		await openCell(/^Projekt von TASK-1/);
		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: /Haushalt/ }));
		await vi.advanceTimersByTimeAsync(0);

		const [flag] = screen.getAllByText(
			/TASK-1 konnte nicht geändert werden\. Das Projekt ist archiviert\./
		);
		expect(flag).toBeTruthy();
		expect(cellButton(/^Projekt von TASK-1: kein Projekt/)).toBeTruthy();
		expect(within(document.body).queryByText(/HAUS-1/)).toBeNull();
	});
});
