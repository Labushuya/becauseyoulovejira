// Selection and bulk actions of the ticket table (plan BI-2, ADR-0036 §2 and §3): a checkbox per
// row apart from the check mark, Shift ranges, the head checkbox with its indeterminate state,
// filter changes, Escape, a click in the cell that never opens the ticket, and the bar with its
// menus and questions.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { parseListQuery } from '$lib/domain/list-query';
import type { TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { BulkEditStore, type BulkEditData } from '$lib/stores/bulk-edit.svelte';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { danglingReferences, duplicateIds } from '$lib/test/aria-ids';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TicketTable from './TicketTable.svelte';

useOverlayStubs();

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const SESSION = { ensureValid: () => true, logout: vi.fn() };

function ticket(n: number, overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: `t${String(n).padStart(14, '0')}`,
		key: `TASK-${n}`,
		title: `Ticket ${n}`,
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
		created: `2026-09-${String(n).padStart(2, '0')} 10:00:00.000Z`,
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

async function showTable(open: TicketSummary[], bulkData: Partial<BulkEditData> = {}) {
	mocks.page.url = new URL('/', 'http://localhost:3000');
	const data: TicketListData = {
		listOpen: vi.fn(async () => open),
		listSubtasks: vi.fn(async () => open.filter((entry) => entry.parentId)),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(),
		update: vi.fn()
	};
	const store = new TicketListStore(data, SESSION);
	const catalog = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		SESSION
	);
	void catalog.load();
	store.activate(parseListQuery(mocks.page.url.searchParams));
	const update = vi.fn(
		async (id: string, patch: TicketPatch): Promise<TicketSummary> =>
			({
				...(store.find(id) as TicketSummary),
				...patch,
				updated: '2026-09-02 10:00:00.000Z'
			}) as TicketSummary
	);
	const bulkDataFull: BulkEditData = {
		update,
		delete: vi.fn(async () => null),
		restore: vi.fn(async () => undefined),
		sourceDates: vi.fn(async () => new Map()),
		sourceCount: vi.fn(async () => 0),
		...bulkData
	};
	const bulk = new BulkEditStore(bulkDataFull, SESSION, store);
	const run = vi.spyOn(bulk, 'run');
	render(TicketTable, { props: { store, catalog, bulk } });
	await vi.advanceTimersByTimeAsync(0);
	return { store, bulk, run, bulkData: bulkDataFull };
}

const box = (key: string) =>
	screen.getByRole<HTMLInputElement>('checkbox', { name: `${key} auswählen` });
const headBox = () =>
	screen.getByRole<HTMLInputElement>('checkbox', { name: 'Alle angezeigten Tickets auswählen' });
const bar = () => screen.queryByRole('region', { name: /ausgewählt/ });

/** A click on the checkbox of a row; with `shift` the pointer press holds Shift. */
async function choose(key: string, shift = false) {
	const input = box(key);
	await fireEvent.pointerDown(input.closest('td') as HTMLElement, { shiftKey: shift });
	await fireEvent.click(input);
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

describe('selection column (plan BI-2)', () => {
	it('has a checkbox per row apart from the check mark, and none chosen at first', async () => {
		await showTable([ticket(1), ticket(2)]);
		const row = box('TASK-1').closest('tr') as HTMLElement;
		expect(row.firstElementChild?.getAttribute('data-col')).toBe('select');
		expect(within(row).getByRole('checkbox', { name: 'TASK-1 erledigt' })).toBeTruthy();
		expect(box('TASK-1').checked).toBe(false);
		expect(headBox().checked).toBe(false);
		expect(bar()).toBeNull();
	});

	it('chooses a row without opening it, also from a click beside the box', async () => {
		await showTable([ticket(1), ticket(2)]);
		const cell = box('TASK-1').closest('td') as HTMLElement;

		await fireEvent.click(cell.querySelector('label') as HTMLElement);
		await fireEvent.click(cell);

		expect(mocks.goto).not.toHaveBeenCalled();
		await choose('TASK-2');
		expect(box('TASK-2').checked).toBe(true);
		expect(box('TASK-2').closest('tr')?.classList.contains('selected')).toBe(true);
		expect(mocks.goto).not.toHaveBeenCalled();
		expect(within(bar() as HTMLElement).getByText(/Tickets? ausgewählt/)).toBeTruthy();
	});

	it('chooses a range with Shift and clears one with Shift again', async () => {
		await showTable([ticket(1), ticket(2), ticket(3), ticket(4)]);
		const keys = () => ['TASK-4', 'TASK-3', 'TASK-2', 'TASK-1'].filter((key) => box(key).checked);

		// Default order: newest first, so the rows are 4, 3, 2, 1.
		await choose('TASK-4');
		await choose('TASK-2', true);
		expect(keys()).toEqual(['TASK-4', 'TASK-3', 'TASK-2']);
		expect(screen.getByText('3 Tickets ausgewählt')).toBeTruthy();

		await choose('TASK-3', true);
		expect(keys()).toEqual(['TASK-2']);
	});

	it('shows some chosen as indeterminate and chooses all shown rows from the head', async () => {
		await showTable([ticket(1), ticket(2), ticket(3)]);
		await choose('TASK-2');
		await tick();
		expect(headBox().indeterminate).toBe(true);
		expect(headBox().checked).toBe(false);

		await fireEvent.click(headBox());
		expect(['TASK-1', 'TASK-2', 'TASK-3'].every((key) => box(key).checked)).toBe(true);
		expect(headBox().indeterminate).toBe(false);
		expect(headBox().checked).toBe(true);

		await fireEvent.click(headBox());
		expect(['TASK-1', 'TASK-2', 'TASK-3'].some((key) => box(key).checked)).toBe(false);
		expect(bar()).toBeNull();
	});

	it('keeps only rows that are still shown after a filter change', async () => {
		const { store } = await showTable([ticket(1, { priority: 'high' }), ticket(2)]);
		await fireEvent.click(headBox());
		expect(screen.getByText('2 Tickets ausgewählt')).toBeTruthy();

		store.activate({ ...parseListQuery(new URLSearchParams()), priority: 'high' });
		await vi.advanceTimersByTimeAsync(0);
		expect(screen.getByText('1 Ticket ausgewählt')).toBeTruthy();

		// Back to all rows: the one that left does not come back chosen.
		store.activate(parseListQuery(new URLSearchParams()));
		await vi.advanceTimersByTimeAsync(0);
		expect(box('TASK-2').checked).toBe(false);
		expect(box('TASK-1').checked).toBe(true);
	});

	it('clears the selection with Escape and with "Auswahl aufheben"', async () => {
		await showTable([ticket(1), ticket(2)]);
		await choose('TASK-1');
		await fireEvent.keyDown(box('TASK-1'), { key: 'Escape' });
		expect(box('TASK-1').checked).toBe(false);
		expect(bar()).toBeNull();

		await choose('TASK-2');
		await fireEvent.click(screen.getByRole('button', { name: 'Auswahl aufheben' }));
		expect(box('TASK-2').checked).toBe(false);
	});
});

describe('bar of the bulk actions (plan BI-2)', () => {
	it('sets the priority of the chosen rows from its menu', async () => {
		const { run } = await showTable([ticket(1), ticket(2), ticket(3)]);
		await choose('TASK-1');
		await choose('TASK-3');

		await fireEvent.click(screen.getByRole('button', { name: 'Priorität' }));
		await fireEvent.click(screen.getByRole('menuitem', { hidden: true, name: 'Dringend' }));

		expect(run).toHaveBeenCalledWith({ kind: 'priority', value: 'urgent' }, [
			't00000000000001',
			't00000000000003'
		]);
	});

	it('sets or removes the own color of the chosen rows from the menu "Farbe" (ADR-0052)', async () => {
		const { run } = await showTable([ticket(1), ticket(2)]);
		await choose('TASK-2');

		const colorMenu = () => {
			const button = screen.getByRole('button', { name: 'Farbe' });
			return {
				button,
				menu: within(document.getElementById(button.getAttribute('aria-controls') ?? '')!)
			};
		};
		const { button, menu } = colorMenu();
		await fireEvent.click(button);
		const entries = menu
			.getAllByRole('menuitem', { hidden: true })
			.map((entry) => entry.textContent?.trim());
		expect(entries).toEqual([
			'Wie Projekt',
			'Violett',
			'Indigo',
			'Blau',
			'Himmelblau',
			'Türkis',
			'Grün',
			'Oliv',
			'Senf',
			'Braun',
			'Grau'
		]);
		await fireEvent.click(menu.getByRole('menuitem', { hidden: true, name: 'Türkis' }));
		expect(run).toHaveBeenLastCalledWith({ kind: 'color', value: 'tuerkis' }, ['t00000000000002']);

		// After the run the bar offers its actions again; "Wie Projekt" removes the own color.
		await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Farbe' })).toBeTruthy());
		const again = colorMenu();
		await fireEvent.click(again.button);
		await fireEvent.click(again.menu.getByRole('menuitem', { hidden: true, name: 'Wie Projekt' }));
		expect(run).toHaveBeenLastCalledWith({ kind: 'color', value: null }, ['t00000000000002']);
	});

	it('asks for a date in "Fälligkeit …" and keeps a wrong number at its field', async () => {
		const { run } = await showTable([ticket(1)]);
		await choose('TASK-1');
		await fireEvent.click(screen.getByRole('button', { name: 'Fälligkeit …' }));
		const dialog = screen.getByRole('dialog', { name: 'Fälligkeit für 1 Ticket' });

		await fireEvent.click(within(dialog).getByRole('radio', { name: 'Verschieben um' }));
		await fireEvent.input(within(dialog).getByLabelText('Anzahl'), { target: { value: '0' } });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
		expect(within(dialog).getByText(/Eine ganze Zahl ungleich 0/)).toBeTruthy();
		expect(run).not.toHaveBeenCalled();

		await fireEvent.input(within(dialog).getByLabelText('Anzahl'), { target: { value: '-2' } });
		await fireEvent.change(within(dialog).getByLabelText('Einheit'), {
			target: { value: 'weeks' }
		});
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
		expect(run).toHaveBeenCalledWith({ kind: 'due', mode: 'shift', amount: -2, unit: 'weeks' }, [
			't00000000000001'
		]);
	});

	it('names which tickets "Datum der Quelle übernehmen" applies to', async () => {
		await showTable([ticket(1)]);
		await choose('TASK-1');
		await fireEvent.click(screen.getByRole('button', { name: 'Fälligkeit …' }));
		const radio = screen.getByRole('radio', { name: 'Datum der Quelle übernehmen' });
		expect(radio.getAttribute('aria-describedby')).toBeTruthy();
		expect(
			screen.getByText(
				/Nur für Tickets aus einem Kalendertermin .* oder aus einem Notion-Eintrag mit Datum/
			)
		).toBeTruthy();
	});

	it('asks before completing tickets with open sub-tasks, with them taken along at first', async () => {
		const { run } = await showTable([ticket(1), ticket(2, { parentId: 't00000000000001' })]);
		await choose('TASK-1');
		await fireEvent.click(screen.getByRole('button', { name: 'Erledigen' }));

		const dialog = screen.getByRole('dialog', { name: '1 Ticket erledigen?' });
		expect(within(dialog).getByText(/TASK-1 hat noch offene Unteraufgaben/)).toBeTruthy();
		const along = within(dialog).getByRole<HTMLInputElement>('checkbox', {
			name: 'Unteraufgaben mit erledigen'
		});
		expect(along.checked).toBe(true);
		await fireEvent.click(along);
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Erledigen' }));

		expect(run).toHaveBeenCalledWith({ kind: 'complete', withChildren: false }, [
			't00000000000001'
		]);
	});

	it('completes at once when no chosen ticket is blocked', async () => {
		const { run } = await showTable([ticket(1), ticket(2, { parentId: 't00000000000001' })]);
		await choose('TASK-1');
		await choose('TASK-2');
		await fireEvent.click(screen.getByRole('button', { name: 'Erledigen' }));
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(run).toHaveBeenCalledWith({ kind: 'complete', withChildren: true }, [
			't00000000000001',
			't00000000000002'
		]);
	});

	// The select renders the hint of "Projekt …" itself; a second hint of the bar with the same ID
	// doubled it, and aria-describedby named only one of the two.
	it('asks for the project in "Projekt …" with one hint and unique IDs', async () => {
		await showTable([ticket(1), ticket(2)]);
		await fireEvent.click(headBox());
		await fireEvent.click(screen.getByRole('button', { name: 'Projekt …' }));

		const dialog = screen.getByRole('dialog', { name: /^Projekt für/ });
		const select = within(dialog).getByRole<HTMLSelectElement>('combobox', { name: 'Projekt' });
		const hint = document.getElementById(select.getAttribute('aria-describedby') ?? '');
		expect(hint?.textContent).toBe(
			'Ein anderes Projekt gibt jedem Ticket einen neuen Key; der alte steht im Verlauf.'
		);
		expect(within(dialog).queryByText(/Beim Wechsel bekommt/)).toBeNull();
		expect(duplicateIds()).toEqual([]);
		expect(danglingReferences(dialog)).toEqual([]);
	});

	it('moves to the trash after a question naming it, with the choice for the sources (ADR-0037)', async () => {
		const { run } = await showTable([ticket(1), ticket(2)], { sourceCount: vi.fn(async () => 2) });
		await fireEvent.click(headBox());
		// Named like the menu "•••" and the question since AM-3 (before: "Löschen …").
		expect(screen.queryByRole('button', { name: 'Löschen …' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'In den Papierkorb …' }));

		const dialog = screen.getByRole('dialog', { name: '2 Tickets in den Papierkorb verschieben?' });
		expect(
			within(dialog).getByText(/in den Papierkorb und lassen sich dort wiederherstellen/)
		).toBeTruthy();
		expect(within(dialog).queryByText(/nicht rückgängig/)).toBeNull();
		await vi.waitFor(() => expect(within(dialog).getByText(/gehören 2 Quellen/)).toBeTruthy());
		await fireEvent.click(within(dialog).getByRole('radio', { name: /Quellen verwerfen/ }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'In den Papierkorb' }));

		expect(run).toHaveBeenCalledWith({ kind: 'delete', sources: 'discard' }, expect.any(Array));
	});

	it('lists refused tickets as errors and skipped ones neutrally', async () => {
		await showTable([ticket(1, { due: '2026-10-01' }), ticket(2)], {
			update: vi.fn(async () => {
				throw new DataError('validation', {
					status: 400,
					fields: { due: { code: 'validation_calendar_date', message: 'Ungültiges Datum.' } }
				});
			})
		});
		await fireEvent.click(headBox());
		await fireEvent.click(screen.getByRole('button', { name: 'Fälligkeit …' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'Verschieben um' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
		await vi.advanceTimersByTimeAsync(0);

		const alert = await screen.findByRole('alert');
		expect(within(alert).getByText('1 Ticket wurde nicht geändert:')).toBeTruthy();
		expect(alert.textContent).toContain('TASK-1');
		expect(alert.textContent).toContain('Ungültiges Datum.');
		expect(screen.getByText(/1 Ticket übersprungen/)).toBeTruthy();
		expect(screen.getByText(/Hat keine Fälligkeit zum Verschieben/)).toBeTruthy();
	});
});
