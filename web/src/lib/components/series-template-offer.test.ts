// "Auch für künftige Tickets übernehmen" (plan WV, ADR-0023 addendum 6): after the user changed an
// open ticket of a series in the panel, in a cell of the table or with a bulk action, an info flag
// says "Nur dieses Ticket geändert." and its action writes exactly the changed fields into the
// template of the rule. Status and due date never offer it; "Rückgängig" of a bulk action
// withdraws it. Since WV-3 a sub-task added to the ticket is offered the same way. The stores run
// for real on fake data layers, the flags in FlagGroup.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { parseListQuery } from '$lib/domain/list-query';
import type { Project } from '$lib/domain/project';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import type { Tag } from '$lib/domain/tag';
import type { Ticket, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { BulkEditStore, type BulkEditData } from '$lib/stores/bulk-edit.svelte';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { RecurrenceStore, type RecurrenceData } from '$lib/stores/recurrence.svelte';
import { TicketDetailStore, type TicketDetailData } from '$lib/stores/ticket-detail.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import FlagGroup from './overlay/FlagGroup.svelte';
import TicketPanel from './TicketPanel.svelte';
import TicketSubtasks from './TicketSubtasks.svelte';
import TicketTable from './TicketTable.svelte';

useOverlayStubs();

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/') }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto, beforeNavigate: vi.fn() }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const RULE_ID = 'rule00000000001';
const ID = 't00000000000001';
const HOUSE: Project = {
	id: 'proj00000000001',
	name: 'Haushalt',
	code: 'HAUS',
	archived: false,
	updated: '2026-09-01 10:00:00.000Z'
};
const GARDEN: Tag = { id: 'tag000000000001', name: 'Garten', updated: '2026-09-01 10:00:00.000Z' };
const OFFER = 'Auch für künftige Tickets übernehmen';

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
	return {
		id: RULE_ID,
		title: 'Fenster putzen',
		description: 'Innen und außen',
		projectId: null,
		tagIds: [],
		priority: 'medium',
		mode: 'calendar',
		freq: 'weekly',
		interval: 1,
		weekdays: ['MO'],
		monthDay: null,
		anchor: '2026-09-07',
		leadDays: 3,
		nextDue: '2026-10-05',
		lastGeneratedAt: null,
		active: true,
		lastHint: '',
		initialStatus: 'open',
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: ID,
		key: 'TASK-1',
		title: 'Fenster putzen',
		description: 'Innen und außen',
		sourceItem: null,
		status: 'open',
		priority: 'medium',
		due: '2026-09-28',
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: true,
		recurrenceId: RULE_ID,
		parentId: null,
		blocksParent: true,
		source: null,
		completedAt: null,
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

/** Applies a patch like the server; every answer is newer than the last. */
let clock = 0;
function applied(current: Ticket, { project, tags, ...fields }: TicketPatch): Ticket {
	clock += 1;
	return {
		...current,
		...fields,
		...(project !== undefined
			? { projectId: project, key: project === null ? 'TASK-9' : 'HAUS-1' }
			: {}),
		...(tags !== undefined ? { tagIds: [...tags] } : {}),
		updated: `2026-09-02 10:00:${String(clock % 60).padStart(2, '0')}.${String(clock).padStart(3, '0')}Z`
	} as Ticket;
}

/** Rules with a real store over a fake data layer; the flags go to a real FlagStore. */
async function rulesWith(rules: RecurrenceRule[], extra: Partial<RecurrenceData> = {}) {
	const flags = new FlagStore();
	const data: RecurrenceData = {
		listRules: vi.fn(async () => rules),
		createRule: vi.fn(),
		updateRule: vi.fn(async (id: string) => ({
			...(rules.find((entry) => entry.id === id) ?? rule({ id })),
			updated: '2026-09-03 10:00:00.000Z'
		})),
		setActive: vi.fn(),
		deleteRule: vi.fn(),
		detachTicket: vi.fn(),
		...extra
	};
	const store = new RecurrenceStore(data, SESSION, flags);
	await store.load();
	render(FlagGroup, { props: { store: flags } });
	return { store, data, flags };
}

function catalog(): CatalogStore {
	const store = new CatalogStore(
		{
			listProjects: vi.fn(async () => [HOUSE]),
			listTags: vi.fn(async () => [GARDEN]),
			createTag: vi.fn()
		},
		SESSION
	);
	void store.load();
	return store;
}

/** The flag with the offer, or null. */
const offerFlag = () => screen.queryByRole('button', { name: OFFER })?.closest('li') ?? null;

/** Titles of the shown flags (the live regions repeat them, so they are read from the list). */
const shownTitles = () =>
	[...document.querySelectorAll('.flags li .title')].map((title) => title.textContent?.trim());

afterEach(() => {
	document.body.innerHTML = '';
});

describe('the offer after a change in the panel (and the full view, same store)', () => {
	async function showPanel(initial: Ticket = ticket()) {
		const rules = await rulesWith([rule()]);
		let current = initial;
		const data: TicketDetailData = {
			get: vi.fn(async () => current),
			update: vi.fn(async (_id: string, patch: TicketPatch) => {
				current = applied(current, patch);
				return current;
			}),
			create: vi.fn(),
			delete: vi.fn()
		};
		const list = {
			find: () => null,
			upsert: vi.fn(),
			completed: vi.fn(),
			remove: vi.fn(),
			announce: vi.fn()
		};
		const store = new TicketDetailStore(data, SESSION, list, null, rules.store);
		store.open(ID);
		render(TicketPanel, {
			props: {
				store,
				catalog: catalog(),
				listHref: '/' as ResolvedPathname,
				onclose: vi.fn(),
				ondeleted: vi.fn()
			}
		});
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		await tick();
		return { ...rules, detail: data };
	}

	it('offers the changed priority for the next tickets and writes exactly it', async () => {
		const { data } = await showPanel();
		await fireEvent.change(screen.getByLabelText('Priorität'), { target: { value: 'urgent' } });
		await vi.waitFor(() => expect(offerFlag()).not.toBeNull());
		const flag = offerFlag() as HTMLElement;
		expect(within(flag).getByText('Nur dieses Ticket geändert.')).toBeTruthy();
		expect(
			within(flag).getByText(
				'Künftige Tickets von „Fenster putzen“ kommen weiter mit der bisherigen Vorlage (Priorität).'
			)
		).toBeTruthy();
		// Not blocking: the panel stays usable, nothing was asked before saving.
		expect(screen.queryByRole('dialog')).toBeNull();

		await fireEvent.click(within(flag).getByRole('button', { name: OFFER }));
		await vi.waitFor(() =>
			expect(data.updateRule).toHaveBeenCalledExactlyOnceWith(RULE_ID, { priority: 'urgent' })
		);
		await vi.waitFor(() =>
			expect(shownTitles()).toContain('Vorlage von „Fenster putzen“ übernommen.')
		);
		expect(offerFlag()).toBeNull();
	});

	it('offers the title and the project, not the status or the due date', async () => {
		const { data, detail } = await showPanel();
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'waiting' } });
		await vi.waitFor(() => expect(detail.update).toHaveBeenCalledTimes(1));
		await tick();
		expect(offerFlag()).toBeNull();

		await fireEvent.change(screen.getByLabelText('Projekt'), { target: { value: HOUSE.id } });
		await vi.waitFor(() => expect(offerFlag()).not.toBeNull());
		await fireEvent.click(screen.getByRole('button', { name: OFFER }));
		await vi.waitFor(() =>
			expect(data.updateRule).toHaveBeenCalledExactlyOnceWith(RULE_ID, { project: HOUSE.id })
		);
	});

	it('offers nothing for a done ticket of the series', async () => {
		const { detail } = await showPanel(
			ticket({ status: 'done', completedAt: '2026-09-02 10:00:00.000Z' })
		);
		await fireEvent.change(screen.getByLabelText('Priorität'), { target: { value: 'urgent' } });
		await vi.waitFor(() => expect(detail.update).toHaveBeenCalledTimes(1));
		await tick();
		expect(offerFlag()).toBeNull();
	});

	it('offers nothing for a ticket without a series', async () => {
		const { detail } = await showPanel(ticket({ recurring: false, recurrenceId: null }));
		await fireEvent.change(screen.getByLabelText('Priorität'), { target: { value: 'urgent' } });
		await vi.waitFor(() => expect(detail.update).toHaveBeenCalledTimes(1));
		await tick();
		expect(offerFlag()).toBeNull();
	});
});

describe('the offer after a change in a cell of the table', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
		vi.setSystemTime(Date.UTC(2026, 8, 24, 10));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function showTable(open: TicketSummary[]) {
		const rules = await rulesWith([rule()]);
		const update = vi.fn(async (id: string, patch: TicketPatch): Promise<TicketSummary> =>
			applied(store.find(id) as Ticket, patch)
		);
		const data: TicketListData = {
			listOpen: vi.fn(async () => open),
			listSubtasks: vi.fn(async () => []),
			searchOpen: vi.fn(async (): Promise<string[]> => []),
			setDone: vi.fn(),
			update
		};
		const store = new TicketListStore(data, SESSION, {
			flags: new FlagStore(),
			series: rules.store
		});
		const list = catalog();
		await list.load();
		store.activate(parseListQuery(mocks.page.url.searchParams));
		render(TicketTable, { props: { store, catalog: list } });
		await vi.advanceTimersByTimeAsync(0);
		return { ...rules, update };
	}

	async function choose(cell: RegExp, value: RegExp) {
		const button = screen.getByRole('button', { name: cell });
		await fireEvent.pointerEnter(button);
		await fireEvent.click(button);
		await vi.advanceTimersByTimeAsync(0);
		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: value }));
		await vi.advanceTimersByTimeAsync(0);
	}

	it('offers a priority chosen in the cell, like the panel', async () => {
		const { data } = await showTable([ticket()]);
		await choose(/^Priorität von TASK-1/, /Hoch/);
		const flag = offerFlag();
		expect(flag).not.toBeNull();
		expect(within(flag as HTMLElement).getByText('Nur dieses Ticket geändert.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: OFFER }));
		await vi.advanceTimersByTimeAsync(0);
		expect(data.updateRule).toHaveBeenCalledExactlyOnceWith(RULE_ID, { priority: 'high' });
	});

	it('offers nothing after the status cell', async () => {
		const { update } = await showTable([ticket()]);
		await choose(/^Status von TASK-1/, /In Arbeit/);
		expect(update).toHaveBeenCalledExactlyOnceWith(ID, { status: 'in_progress' });
		expect(offerFlag()).toBeNull();
	});
});

describe('the offer after a bulk action', () => {
	async function setup() {
		const rules = await rulesWith([
			rule(),
			rule({ id: 'rule00000000002', title: 'Blumen gießen', tagIds: ['tag000000000009'] })
		]);
		const tickets = new Map<string, TicketSummary>([
			[ID, ticket()],
			['t00000000000002', ticket({ id: 't00000000000002', key: 'TASK-2', title: 'Blumen' })],
			[
				't00000000000003',
				ticket({ id: 't00000000000003', key: 'TASK-3', recurrenceId: 'rule00000000002' })
			],
			[
				't00000000000004',
				ticket({ id: 't00000000000004', key: 'TASK-4', recurring: false, recurrenceId: null })
			]
		]);
		const data: BulkEditData = {
			update: vi.fn(async (id: string, patch: TicketPatch) =>
				applied(tickets.get(id) as Ticket, patch)
			),
			delete: vi.fn(),
			restore: vi.fn(),
			sourceDates: vi.fn(async () => new Map()),
			sourceCount: vi.fn(async () => 0)
		};
		const list = {
			find: (id: string) => tickets.get(id) ?? null,
			upsert: (entry: TicketSummary) => void tickets.set(entry.id, entry),
			remove: (id: string) => void tickets.delete(id),
			openBlockingOf: () => []
		};
		const bulk = new BulkEditStore(data, SESSION, list, rules.flags, rules.store);
		return { ...rules, bulk, bulkData: data, ids: [...tickets.keys()] };
	}

	it('shows one offer for all rules of the changed tickets, after the result', async () => {
		const { bulk, data, ids } = await setup();
		await bulk.run({ kind: 'tags', mode: 'add', tagIds: [GARDEN.id] }, ids);
		await vi.waitFor(() => expect(offerFlag()).not.toBeNull());
		// The result of the action first, the offer as the newest flag above it.
		expect(shownTitles()).toEqual(['Nur diese 3 Tickets geändert.', '4 Tickets geändert.']);
		expect(
			within(offerFlag() as HTMLElement).getByText(
				'Künftige Tickets von 2 Serien kommen weiter mit der bisherigen Vorlage (Tags).'
			)
		).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: OFFER }));
		await vi.waitFor(() => expect(data.updateRule).toHaveBeenCalledTimes(2));
		expect(data.updateRule).toHaveBeenCalledWith(RULE_ID, { tags: [GARDEN.id] });
		expect(data.updateRule).toHaveBeenCalledWith('rule00000000002', {
			tags: ['tag000000000009', GARDEN.id]
		});
		await vi.waitFor(() => expect(shownTitles()).toContain('Vorlagen von 2 Serien übernommen.'));
	});

	it('withdraws the offer with "Rückgängig" and offers nothing for the status', async () => {
		const { bulk, data, ids } = await setup();
		await bulk.run({ kind: 'priority', value: 'urgent' }, ids);
		await vi.waitFor(() => expect(offerFlag()).not.toBeNull());
		await bulk.undo();
		await tick();
		expect(offerFlag()).toBeNull();

		await bulk.run({ kind: 'status', value: 'waiting' }, ids);
		await tick();
		expect(shownTitles()).toContain('4 Tickets geändert.');
		expect(offerFlag()).toBeNull();
		expect(data.updateRule).not.toHaveBeenCalled();
	});
});

// Plan WV-3 (ADR-0022 addendum 10): "Unteraufgabe hinzufügen" at an open ticket of a series offers
// the sub-task for the template in the same flag; only adding, never removing or renaming.
describe('the offer after a sub-task was added (plan WV-3)', () => {
	async function showSubtasks(parent: Ticket = ticket(), ready = true) {
		const rules = await rulesWith(
			[rule({ templateSubtasks: [{ title: 'Rahmen', priority: 'medium' }] })],
			{
				templateSubtasksReady: vi.fn(async () => ready)
			}
		);
		let sequence = 0;
		const data: TicketListData = {
			listOpen: vi.fn(async () => [parent]),
			listSubtasks: vi.fn(async () => []),
			searchOpen: vi.fn(async (): Promise<string[]> => []),
			setDone: vi.fn(),
			update: vi.fn(),
			create: vi.fn(async (draft) => {
				sequence += 1;
				return ticket({
					id: `t0000000000010${sequence}`,
					key: `TASK-${10 + sequence}`,
					title: draft.title,
					priority: draft.priority,
					parentId: draft.parent ?? null,
					recurring: false,
					recurrenceId: null
				});
			})
		};
		const list = new TicketListStore(data, SESSION, { flags: rules.flags, series: rules.store });
		list.activate(parseListQuery(mocks.page.url.searchParams));
		await vi.waitFor(() => expect(list.openState).toBe('ready'));
		render(TicketSubtasks, {
			props: { ticket: parent, list, hrefOf: (id: string) => `/tickets/${id}` as ResolvedPathname }
		});
		return rules;
	}

	async function addSubtask(title: string) {
		const section = screen.getByRole('region', { name: 'Unteraufgaben' });
		const open = within(section).queryByRole('button', { name: 'Unteraufgabe hinzufügen' });
		if (open !== null) await fireEvent.click(open);
		const field = within(section).getByLabelText('Titel der Unteraufgabe');
		await fireEvent.input(field, { target: { value: title } });
		await fireEvent.submit(field.closest('form') as HTMLFormElement);
	}

	it('offers the added sub-task, joins the next one and adds both to the template', async () => {
		const { data } = await showSubtasks();
		await addSubtask('Scheiben');
		await vi.waitFor(() => expect(offerFlag()).not.toBeNull());
		expect(
			within(offerFlag() as HTMLElement).getByText('Nur dieses Ticket geändert.')
		).toBeTruthy();
		expect(
			within(offerFlag() as HTMLElement).getByText(
				'Künftige Tickets von „Fenster putzen“ bekommen die Unteraufgabe „Scheiben“ nicht.'
			)
		).toBeTruthy();
		// Not blocking: no question before, the field stays open for the next one.
		expect(screen.queryByRole('dialog')).toBeNull();

		await addSubtask('Rahmen');
		await addSubtask('Fensterbank');
		await vi.waitFor(() =>
			expect(
				within(offerFlag() as HTMLElement).getByText(
					'Künftige Tickets von „Fenster putzen“ bekommen die Unteraufgaben „Scheiben“ und „Fensterbank“ nicht.'
				)
			).toBeTruthy()
		);
		// One offer at a time.
		expect(screen.getAllByRole('button', { name: OFFER })).toHaveLength(1);

		await fireEvent.click(screen.getByRole('button', { name: OFFER }));
		await vi.waitFor(() =>
			expect(data.updateRule).toHaveBeenCalledExactlyOnceWith(RULE_ID, {
				template_subtasks: [
					{ title: 'Rahmen', priority: 'medium' },
					{ title: 'Scheiben', priority: 'medium' },
					{ title: 'Fensterbank', priority: 'medium' }
				]
			})
		);
		await vi.waitFor(() =>
			expect(shownTitles()).toContain('Vorlage von „Fenster putzen“ übernommen.')
		);
	});

	it('offers nothing for a done ticket, a ticket without a series or before the migration', async () => {
		for (const [parent, ready] of [
			[ticket({ status: 'done', completedAt: '2026-09-02 10:00:00.000Z' }), true],
			[ticket({ recurring: false, recurrenceId: null }), true],
			[ticket(), false]
		] as const) {
			await showSubtasks(parent, ready);
			await addSubtask('Scheiben');
			await vi.waitFor(() => expect(screen.getByText(/TASK-\d+ angelegt\./)).toBeTruthy());
			expect(offerFlag()).toBeNull();
			document.body.innerHTML = '';
		}
	});
});
