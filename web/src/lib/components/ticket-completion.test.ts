// Completing a ticket with open blocking sub-tasks (ADR-0033 section 2) in the table and in the
// fields of panel and full view: the check mark asks with the confirmation (radios "Unteraufgaben
// mit erledigen" and "Trotzdem erledigen"), the status select asks inline below the status, in a
// row of its own over both columns of the fields (QB-1). Stores run for real on fake data layers.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { Ticket, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import InModalHarness from '$lib/test/InModalHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { expectNoStatusQuestions, expectRowBelowStatus } from '$lib/test/status-questions';
import TicketFields from './TicketFields.svelte';
import fieldsSource from './TicketFields.svelte?raw';
import TicketTable from './TicketTable.svelte';

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));

useOverlayStubs();

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const PARENT_ID = 'parent000000001';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: PARENT_ID,
		key: 'HAUS-12',
		title: 'Umzug',
		description: '',
		sourceItem: null,
		status: 'in_progress',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

const CHILDREN = [
	ticket({ id: 'child0000000001', key: 'HAUS-13', title: 'Kartons', parentId: PARENT_ID }),
	ticket({ id: 'child0000000002', key: 'HAUS-14', title: 'Küche', parentId: PARENT_ID })
];

function catalog() {
	const store = new CatalogStore(
		{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
		SESSION
	);
	void store.load();
	return store;
}

describe('check mark of a ticket with open blocking sub-tasks', () => {
	async function showTable() {
		const parent = ticket();
		const data = {
			listOpen: vi.fn(async () => [parent, ...CHILDREN]),
			listSubtasks: vi.fn(async () => CHILDREN),
			searchOpen: vi.fn(async () => []),
			setDone: vi.fn(async (id: string, done: boolean) => ({
				...([parent, ...CHILDREN].find((entry) => entry.id === id) ?? parent),
				status: done ? ('done' as const) : ('open' as const),
				updated: '2026-09-24 10:00:00.000Z'
			})),
			update: vi.fn(
				async (id: string, patch: TicketPatch) =>
					({ ...parent, id, ...patch, updated: '2026-09-24 10:00:01.000Z' }) as TicketSummary
			)
		} satisfies TicketListData;
		const store = new TicketListStore(data, SESSION);
		store.activate({ ...(await import('$lib/domain/list-query')).EMPTY_LIST_QUERY });
		render(TicketTable, { props: { store, catalog: catalog() } });
		await vi.waitFor(() => expect(store.openState).toBe('ready'));
		await tick();
		return { store, data };
	}

	it('asks with the confirmation and keeps the check mark until the answer', async () => {
		const { data } = await showTable();
		const check = screen.getByRole('checkbox', { name: 'HAUS-12 erledigt' }) as HTMLInputElement;

		await fireEvent.click(check);
		await tick();

		const dialog = screen.getByRole('dialog', { name: 'HAUS-12 erledigen?' });
		expect(
			within(dialog).getByText('2 Unteraufgaben sind noch offen – trotzdem erledigen?')
		).toBeTruthy();
		const withChildren = within(dialog).getByRole('radio', {
			name: /Unteraufgaben mit erledigen/
		}) as HTMLInputElement;
		expect(withChildren.checked).toBe(true);
		expect(
			document.getElementById(withChildren.getAttribute('aria-describedby') ?? '')?.textContent
		).toBe('HAUS-13 und HAUS-14 werden ebenfalls erledigt.');
		expect(within(dialog).getByRole('radio', { name: /Trotzdem erledigen/ })).toBeTruthy();
		expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		expect(check.checked).toBe(false);
		expect(data.setDone).not.toHaveBeenCalled();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Erledigen' }));

		await vi.waitFor(() =>
			expect(data.setDone).toHaveBeenCalledWith(PARENT_ID, true, 'complete_children')
		);
		await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});

	it('completes it anyway with "Trotzdem erledigen" and keeps it open with "Abbrechen"', async () => {
		const { data } = await showTable();

		await fireEvent.click(screen.getByRole('checkbox', { name: 'HAUS-12 erledigt' }));
		await tick();
		let dialog = screen.getByRole('dialog', { name: 'HAUS-12 erledigen?' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		await tick();
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(data.setDone).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('checkbox', { name: 'HAUS-12 erledigt' }));
		await tick();
		dialog = screen.getByRole('dialog', { name: 'HAUS-12 erledigen?' });
		await fireEvent.click(within(dialog).getByRole('radio', { name: /Trotzdem erledigen/ }));
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Erledigen' }));

		await vi.waitFor(() => expect(data.setDone).toHaveBeenCalledWith(PARENT_ID, true, 'force'));
	});
});

describe('status "Erledigt" of a ticket with open blocking sub-tasks', () => {
	const REOPEN_MESSAGE =
		'Von dieser Serie ist schon HAUS-20 offen, und dieses Ticket ist nicht das zuletzt erledigte. Du kannst es als normales Ticket wieder öffnen (aus der Serie lösen).';

	/** The refusal of the hook when an older ticket of a series comes back (ADR-0023 addendum 4). */
	function reopenRefusal() {
		return new DataError('validation', {
			status: 400,
			fields: {
				status: {
					code: 'validation_recurrence_reopen_older',
					message: REOPEN_MESSAGE,
					params: { key: 'HAUS-20' }
				}
			}
		});
	}

	/** The fields in the panel, or with `inModal` inside a modal as in the full view. */
	async function showFields({
		inModal = false,
		children = CHILDREN
	}: { inModal?: boolean; children?: readonly TicketSummary[] } = {}) {
		let current = ticket();
		const data = {
			get: vi.fn(async () => current),
			update: vi.fn(async (_id: string, patch: TicketPatch): Promise<Ticket> => {
				current = {
					...current,
					...(patch.status && { status: patch.status }),
					updated: '2026-09-24 10:00:00.000Z'
				};
				return current;
			}),
			create: vi.fn(),
			delete: vi.fn()
		} satisfies TicketDetailData;
		const listTickets = new SvelteMap<string, TicketSummary>();
		const list = {
			find: (id: string) => listTickets.get(id) ?? null,
			upsert: vi.fn((summary: TicketSummary) => listTickets.set(summary.id, summary)),
			completed: vi.fn((summary: TicketSummary) => listTickets.set(summary.id, summary)),
			remove: vi.fn(),
			announce: vi.fn(),
			subtasksOf: () => children
		} satisfies TicketListSync;
		const store = new TicketDetailStore(data, SESSION, list);
		store.open(PARENT_ID);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		const props = {
			store,
			catalog: catalog(),
			get ticket() {
				return store.ticket as Ticket;
			}
		};
		if (inModal) render(InModalHarness, { props: { component: TicketFields, props } });
		else render(TicketFields, { props });
		await tick();
		return { store, data, list };
	}

	it('asks inline below the status, without a dialog, and answers with the choice', async () => {
		const { data, list } = await showFields();
		const select = screen.getByLabelText('Status') as HTMLSelectElement;

		await fireEvent.change(select, { target: { value: 'done' } });
		await tick();

		expect(screen.queryByRole('dialog')).toBeNull();
		const heading = screen.getByRole('heading', {
			name: /2 Unteraufgaben sind noch offen – trotzdem erledigen\?/
		});
		expectRowBelowStatus(heading);
		expect(select.value).toBe('in_progress');
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' }));
		expect(data.update).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'Erledigen' }));

		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(
				PARENT_ID,
				{ status: 'done' },
				{ completion: 'complete_children' }
			)
		);
		expect(list.completed).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'done' }),
			'in_progress',
			[
				{ id: 'child0000000001', key: 'HAUS-13', previousStatus: 'in_progress' },
				{ id: 'child0000000002', key: 'HAUS-14', previousStatus: 'in_progress' }
			]
		);
		await vi.waitFor(() => expect(document.activeElement).toBe(select));
		expect(screen.queryByRole('button', { name: 'Erledigen' })).toBeNull();
	});

	it('explains a refused reopening of a series inline and reopens it as a normal ticket (ADR-0023 addendum 4)', async () => {
		const { store, data } = await showFields();
		data.update.mockRejectedValueOnce(reopenRefusal());
		const select = screen.getByLabelText('Status') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'open' } });
		await tick();

		expect(screen.queryByRole('dialog')).toBeNull();
		expectRowBelowStatus(screen.getByRole('heading', { name: /Nicht wieder in die Serie/ }));
		expect(screen.getByText(REOPEN_MESSAGE)).toBeTruthy();
		expect(select.value).toBe('in_progress');
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' }));

		await fireEvent.click(
			screen.getByRole('button', {
				name: 'Als normales Ticket wieder öffnen (aus der Serie lösen)'
			})
		);
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenLastCalledWith(PARENT_ID, {
				status: 'open',
				detachSeries: true
			})
		);
		await vi.waitFor(() => expect(store.reopenQuestion).toBeNull());
		await vi.waitFor(() => expect(document.activeElement).toBe(select));
	});

	it('cancels with Escape, consumes it and returns the focus to the status', async () => {
		const { data } = await showFields();
		const select = screen.getByLabelText('Status') as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: 'done' } });
		await tick();

		const passedOn = await fireEvent.keyDown(screen.getByRole('button', { name: 'Abbrechen' }), {
			key: 'Escape'
		});
		await tick();

		expect(passedOn).toBe(false);
		expect(screen.queryByRole('button', { name: 'Erledigen' })).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(select));
		expect(data.update).not.toHaveBeenCalled();
	});

	it.each([
		['the panel', false],
		['the full view', true]
	])(
		'asks in a row of its own over both columns in %s, with the focus on "Abbrechen" and back (QB-1)',
		async (_place, inModal) => {
			const { data } = await showFields({ inModal });
			const select = screen.getByLabelText<HTMLSelectElement>('Status');

			await fireEvent.change(select, { target: { value: 'done' } });
			await tick();

			expect(screen.queryByRole('dialog', { name: /Unteraufgaben|erledigen/ })).toBeNull();
			const row = within(
				expectRowBelowStatus(
					screen.getByRole('heading', { name: /2 Unteraufgaben sind noch offen/ })
				)
			);
			expect(
				row.getByRole<HTMLInputElement>('radio', { name: /Unteraufgaben mit erledigen/ }).checked
			).toBe(true);
			const cancel = row.getByRole('button', { name: 'Abbrechen' });
			expect(document.activeElement).toBe(cancel);

			await fireEvent.click(cancel);

			await vi.waitFor(() => expect(document.activeElement).toBe(select));
			expectNoStatusQuestions();
			expect(select.value).toBe('in_progress');
			expect(data.update).not.toHaveBeenCalled();
		}
	);

	it('keeps the order of the DOM and of Tab: status, the question, then "Priorität" (QB-1)', async () => {
		await showFields({ inModal: true });
		const select = screen.getByLabelText<HTMLSelectElement>('Status');
		await fireEvent.change(select, { target: { value: 'done' } });
		await tick();

		const fields = select.closest<HTMLElement>('.fields') as HTMLElement;
		const row = within(fields.querySelector<HTMLElement>('[data-status-questions]') as HTMLElement);
		const expected = [
			select,
			...row.getAllByRole('radio'),
			row.getByRole('button', { name: 'Abbrechen' }),
			row.getByRole('button', { name: 'Erledigen' }),
			screen.getByLabelText('Priorität')
		];
		const focusable = [
			...fields.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea')
		];
		expected.forEach((element, index) =>
			expect(focusable[index], `position ${index}`).toBe(element)
		);
		const ordered = [...fields.querySelectorAll('[tabindex]')].filter(
			(element) => Number(element.getAttribute('tabindex')) > 0
		);
		expect(ordered).toEqual([]);
	});

	it('explains a refused reopening in the same row in the full view, the focus back to the status (QB-1)', async () => {
		const { data, store } = await showFields({ inModal: true });
		data.update.mockRejectedValueOnce(reopenRefusal());
		const select = screen.getByLabelText<HTMLSelectElement>('Status');
		await fireEvent.change(select, { target: { value: 'open' } });
		await tick();

		const row = within(
			expectRowBelowStatus(screen.getByRole('heading', { name: /Nicht wieder in die Serie/ }))
		);
		expect(row.getByText(REOPEN_MESSAGE)).toBeTruthy();
		const cancel = row.getByRole('button', { name: 'Abbrechen' });
		expect(document.activeElement).toBe(cancel);

		await fireEvent.click(cancel);

		await vi.waitFor(() => expect(store.reopenQuestion).toBeNull());
		await vi.waitFor(() => expect(document.activeElement).toBe(select));
		expectNoStatusQuestions();
		expect(select.value).toBe('in_progress');
	});

	it('completes a ticket without open sub-tasks at once, without a question or a row (QB-1)', async () => {
		const { data } = await showFields({ inModal: true, children: [] });

		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } });

		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(PARENT_ID, { status: 'done' }));
		expectNoStatusQuestions();
		expect(screen.queryByRole('heading', { name: /Unteraufgaben/ })).toBeNull();
	});

	it('gives the row both columns of the grid and lets it shrink (QB-1)', () => {
		const rule = /\.questions\s*\{([^}]*)\}/.exec(fieldsSource)?.[1] ?? '';
		expect(rule).toMatch(/grid-column:\s*1\s*\/\s*-1;/);
		expect(rule).toMatch(/min-width:\s*0;/);
		// The status keeps only its select and its error in the value column.
		const status = /<div class="control" data-ticket-option="status">([\s\S]*?)<\/div>/.exec(
			fieldsSource
		)?.[1];
		expect(status).toBeDefined();
		expect(status).not.toMatch(/Question|OngoingFinish/);
	});
});
