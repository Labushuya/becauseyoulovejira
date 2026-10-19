// "Übertragen …" after a change of a parent (UE-2, ADR-0070 addendum UE-2), the store of the (app)
// layout on fakes: the flag for a parent with an open sub-task (one per parent, updated by further
// changes, gone once nothing differs), the offer of the series for everything else as before, a
// standing offer of the same ticket taken over, the status left out after the question about open
// sub-tasks, before the restart the offer of the series, the way of the action to the section of the
// parent; and which changes the ticket stores report at all: realtime, bulk actions and the dialog
// never do.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import type { TemplateApplyResult } from '$lib/domain/series-template';
import type { TicketChange, TicketChangeSink } from '$lib/domain/subtask-transfer-change';
import type { Ticket, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { BulkEditStore, type BulkEditData } from './bulk-edit.svelte';
import type { FlagInput } from './flags.svelte';
import { TransferOfferStore, type TransferSeries } from './subtask-transfer-offer.svelte';
import type { TransferSupport } from './subtask-transfer.svelte';
import { TicketDetailStore, type TicketDetailData } from './ticket-detail.svelte';
import { TicketListStore, type TicketListData } from './ticket-list.svelte';

const PARENT_ID = 'parent000000001';
const RULE_ID = 'rule00000000001';
const QUESTION = 'Auch für die Unteraufgaben?';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: PARENT_ID,
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		description: '',
		sourceItem: null,
		status: 'open',
		priority: 'medium',
		due: '2026-10-12',
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		recurrenceId: null,
		parentId: null,
		blocksParent: true,
		source: null,
		completedAt: null,
		created: '2026-10-01 10:00:00.000Z',
		updated: '2026-10-01 10:00:00.000Z',
		...overrides
	};
}

const child = (overrides: Partial<Ticket> = {}) =>
	ticket({ id: 'child0000000001', key: 'HAUS-13', parentId: PARENT_ID, ...overrides });

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
	return {
		id: RULE_ID,
		title: 'Müll',
		description: '',
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
		nextDue: '2026-10-19',
		lastGeneratedAt: null,
		active: true,
		lastHint: '',
		initialStatus: 'open',
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

interface Shown extends FlagInput {
	id: string;
}

function setup({
	subtasks = [child()] as TicketSummary[],
	support = 'ready' as TransferSupport,
	rules = [] as RecurrenceRule[]
} = {}) {
	const shown: Shown[] = [];
	let count = 0;
	const flags = {
		show: vi.fn((input: FlagInput) => {
			count += 1;
			const id = `flag-${count}`;
			shown.push({ ...input, id });
			return id;
		}),
		dismiss: vi.fn((id: string) => {
			const index = shown.findIndex((flag) => flag.id === id);
			if (index === -1) return;
			const [flag] = shown.splice(index, 1);
			flag?.onclose?.();
		})
	};
	let seriesFlag: string | null = null;
	const series = {
		offerTemplate: vi.fn<TransferSeries['offerTemplate']>(() => null),
		withdrawTemplateOffer: vi.fn((id: string) => {
			if (id === seriesFlag) seriesFlag = null;
		}),
		isTemplateOffer: vi.fn((id: string) => id === seriesFlag),
		ruleById: vi.fn(
			(id: string | null | undefined) => rules.find((entry) => entry.id === id) ?? null
		),
		applyTemplateOffers: vi.fn(async (): Promise<TemplateApplyResult> => ({
			applied: 1,
			refused: [],
			ended: false
		}))
	} satisfies TransferSeries;
	const reveal = vi.fn(async () => undefined);
	const store = new TransferOfferStore({
		flags,
		subtasksOf: (id) => (id === PARENT_ID ? subtasks : []),
		series,
		support: () => support,
		reveal
	});
	/** The offer of the series of the rules stands with this ID (as the RecurrenceStore keeps one). */
	const standingSeries = (id: string) => {
		seriesFlag = id;
		series.offerTemplate.mockReturnValueOnce(id);
	};
	return { store, flags, shown, series, reveal, standingSeries };
}

const titles = (shown: readonly Shown[]) => shown.map((flag) => flag.title);

describe('the flag "Übertragen …" after a change', () => {
	it('shows for a parent with an open sub-task instead of the offer of the series', () => {
		const { store, shown, series } = setup();
		const before = ticket();
		store.changed({ before, after: { ...before, priority: 'high', due: '2026-10-15' } });

		expect(titles(shown)).toEqual([`Fälligkeit und Priorität von HAUS-12 geändert. ${QUESTION}`]);
		const [flag] = shown;
		// Exactly one action besides closing; it does not leave by itself, like the offer of a series.
		expect(flag?.action?.label).toBe('Übertragen …');
		expect(flag?.tone).toBe('info');
		expect(flag?.duration).toBeNull();
		expect(flag?.description).toBeUndefined();
		expect(series.offerTemplate).not.toHaveBeenCalled();
	});

	it('is one flag per parent: further changes add fields, the old value stays', () => {
		const { store, shown } = setup();
		const before = ticket();
		const first = { ...before, priority: 'high' as const };
		store.changed({ before, after: first });
		const second = { ...first, due: '2026-10-15', updated: '2026-10-02 10:00:00.000Z' };
		store.changed({ before: first, after: second });

		expect(titles(shown)).toEqual([`Fälligkeit und Priorität von HAUS-12 geändert. ${QUESTION}`]);
		// Another priority again names the same fields: the flag stays as it is.
		store.changed({ before: second, after: { ...second, priority: 'urgent' } });
		expect(shown).toHaveLength(1);
		expect(shown[0]?.id).toBe('flag-2');

		shown[0]?.action?.run();
		const change = store.requestFor(PARENT_ID);
		expect(change?.before).toBe(before);
		expect(change?.after.priority).toBe('urgent');
		expect(change?.touched).toEqual(['due', 'priority']);
	});

	it('names fewer fields after one changed back and goes once none differs', () => {
		const { store, shown, flags } = setup();
		const before = ticket();
		const first = { ...before, priority: 'high' as const, due: '2026-10-15' };
		store.changed({ before, after: first });
		const back = { ...first, priority: 'medium' as const };
		store.changed({ before: first, after: back });
		expect(titles(shown)).toEqual([`Fälligkeit von HAUS-12 geändert. ${QUESTION}`]);

		store.changed({ before: back, after: { ...back, due: '2026-10-12' } });
		expect(shown).toEqual([]);
		expect(flags.dismiss).toHaveBeenCalledTimes(2);
	});

	it('leaves a changed title to the offer of the series once no field of the dialog differs', () => {
		const { store, shown, series } = setup({ rules: [rule()] });
		const before = ticket({ recurring: true, recurrenceId: RULE_ID });
		const first = { ...before, priority: 'high' as const };
		store.changed({ before, after: first });
		const titled = { ...first, title: 'Restmüll rausbringen' };
		store.changed({ before: first, after: titled });
		expect(series.offerTemplate).not.toHaveBeenCalled();

		store.changed({ before: titled, after: { ...titled, priority: 'medium' } });
		expect(shown).toEqual([]);
		// The whole change since the flag appeared, so the title is not lost.
		expect(series.offerTemplate).toHaveBeenCalledExactlyOnceWith([
			{ before, after: { ...titled, priority: 'medium' } }
		]);
	});

	it('takes a mixed change alone; the series checkbox of the dialog holds the title as well', () => {
		const { store, shown, series } = setup({ rules: [rule()] });
		const before = ticket({ recurring: true, recurrenceId: RULE_ID });
		const after = { ...before, title: 'Restmüll', priority: 'high' as const };
		store.changed({ before, after });

		expect(titles(shown)).toEqual([`Priorität von HAUS-12 geändert. ${QUESTION}`]);
		expect(shown[0]?.description).toBe(
			'Im Dialog lässt sich die Änderung auch für künftige Tickets von „Müll“ übernehmen.'
		);
		expect(series.offerTemplate).not.toHaveBeenCalled();
		expect(store.seriesOffer({ before, after })).toMatchObject({
			ruleId: RULE_ID,
			fields: ['title', 'priority'],
			patch: { title: 'Restmüll', priority: 'high' }
		});
	});

	it('takes over a standing offer of the series of the same ticket instead of a second flag', () => {
		const { store, shown, series, standingSeries } = setup({ rules: [rule()] });
		const before = ticket({ recurring: true, recurrenceId: RULE_ID });
		const titled = { ...before, title: 'Restmüll' };
		standingSeries('series-flag');
		store.changed({ before, after: titled });
		expect(series.offerTemplate).toHaveBeenCalledOnce();

		store.changed({ before: titled, after: { ...titled, due: '2026-10-13' } });
		expect(series.withdrawTemplateOffer).toHaveBeenCalledExactlyOnceWith('series-flag');
		expect(titles(shown)).toEqual([`Fälligkeit von HAUS-12 geändert. ${QUESTION}`]);
		shown[0]?.action?.run();
		const change = store.requestFor(PARENT_ID);
		expect(change?.before).toBe(before);
		expect(store.seriesOffer(change as NonNullable<typeof change>)?.fields).toEqual(['title']);
	});
});

describe('every other change goes to the offer of the series as before', () => {
	it('without an open sub-task', () => {
		const { store, shown, series } = setup({ subtasks: [child({ status: 'done' })] });
		const before = ticket();
		store.changed({ before, after: { ...before, priority: 'high' } });
		expect(shown).toEqual([]);
		expect(series.offerTemplate).toHaveBeenCalledExactlyOnceWith([
			{ before, after: { ...before, priority: 'high' } }
		]);
	});

	it('with only other fields changed (title, description), and for a sub-task itself', () => {
		const { store, shown, series } = setup();
		const before = ticket();
		store.changed({ before, after: { ...before, title: 'Neu', description: 'Text' } });
		const sub = child();
		store.changed({ before: sub, after: { ...sub, priority: 'high' } });
		expect(shown).toEqual([]);
		expect(series.offerTemplate).toHaveBeenCalledTimes(2);
	});

	it('before the restart, while the server lacks the route; unknown still shows the flag', () => {
		const missing = setup({ support: 'missing' });
		const before = ticket();
		missing.store.changed({ before, after: { ...before, priority: 'high' } });
		expect(missing.shown).toEqual([]);
		expect(missing.series.offerTemplate).toHaveBeenCalledOnce();

		const pending = setup({ support: 'pending' });
		pending.store.changed({ before, after: { ...before, priority: 'high' } });
		expect(titles(pending.shown)).toEqual([`Priorität von HAUS-12 geändert. ${QUESTION}`]);
	});
});

describe('the questions about the status', () => {
	it('leave the status out once "N Unteraufgaben sind noch offen" settled it', () => {
		const { store, shown } = setup();
		const before = ticket();
		store.changed({
			before,
			after: { ...before, status: 'done' },
			answered: ['status']
		});
		expect(shown).toEqual([]);

		const working = { ...before, status: 'in_progress' as const };
		store.changed({ before, after: working });
		expect(titles(shown)).toEqual([`Status von HAUS-12 geändert. ${QUESTION}`]);
		store.changed({ before: working, after: { ...working, status: 'done' }, answered: ['status'] });
		expect(shown).toEqual([]);
	});

	it('keep the status after "Vorhaben abschließen?", which is about the ticket itself', () => {
		const { store, shown } = setup();
		const before = ticket({ kind: 'ongoing' });
		store.changed({ before, after: { ...before, status: 'done' } });
		expect(titles(shown)).toEqual([`Status von HAUS-12 geändert. ${QUESTION}`]);
	});

	it('"Rückgängig" updates a shown flag but never starts one', () => {
		const { store, shown, series } = setup();
		const before = ticket();
		const doneTicket = { ...before, status: 'done' as const };
		store.changed({ before: doneTicket, after: before, undo: true });
		expect(shown).toEqual([]);
		expect(series.offerTemplate).not.toHaveBeenCalled();

		store.changed({ before, after: doneTicket });
		expect(shown).toHaveLength(1);
		store.changed({ before: doneTicket, after: before, undo: true });
		expect(shown).toEqual([]);
	});
});

describe('the way of "Übertragen …"', () => {
	it('opens the ticket and waits for its section, which takes it once', async () => {
		const { store, shown, reveal } = setup();
		const before = ticket();
		store.changed({ before, after: { ...before, priority: 'high' } });
		const flag = shown[0];
		flag?.action?.run();
		expect(reveal).toHaveBeenCalledExactlyOnceWith(PARENT_ID);
		expect(store.requestFor('other0000000001')).toBeNull();
		// A navigation on the way to the ticket keeps the request.
		store.navigated();
		expect(store.requestFor(PARENT_ID)?.touched).toEqual(['priority']);
		const taken = store.take(PARENT_ID);
		expect(taken?.after.priority).toBe('high');
		expect(store.requestFor(PARENT_ID)).toBeNull();
		expect(store.take(PARENT_ID)).toBeNull();
	});

	it('drops a request no section took with the next navigation (a cancelled way)', async () => {
		const { store, shown } = setup();
		const before = ticket();
		store.changed({ before, after: { ...before, priority: 'high' } });
		shown[0]?.action?.run();
		await Promise.resolve();
		await Promise.resolve();
		store.navigated();
		expect(store.requestFor(PARENT_ID)).toBeNull();
	});

	it('another area drops the flags, not a request on its way', () => {
		const { store, shown, flags } = setup();
		const before = ticket();
		store.changed({ before, after: { ...before, priority: 'high' } });
		store.changed({
			before: ticket({ id: 'other0000000001', key: 'HAUS-20' }),
			after: ticket({ id: 'other0000000001', key: 'HAUS-20', priority: 'high' })
		});
		shown[0]?.action?.run();
		store.reset();
		expect(flags.dismiss).toHaveBeenCalled();
		expect(shown).toEqual([]);
		expect(store.requestFor(PARENT_ID)).not.toBeNull();
	});

	it('applies the series the same way as its flag', async () => {
		const { store, series } = setup({ rules: [rule()] });
		const before = ticket({ recurring: true, recurrenceId: RULE_ID });
		const offer = store.seriesOffer({ before, after: { ...before, priority: 'high' } });
		expect(offer).not.toBeNull();
		await store.applySeries(offer as NonNullable<typeof offer>);
		expect(series.applyTemplateOffers).toHaveBeenCalledExactlyOnceWith([offer]);
	});
});

describe('what the ticket stores report', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
		vi.setSystemTime(Date.UTC(2026, 9, 10, 10));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const SESSION = { ensureValid: () => true, logout: vi.fn() };

	function spySink() {
		const changes: TicketChange[] = [];
		const sink: TicketChangeSink = { changed: (change) => void changes.push(change) };
		return { sink, changes };
	}

	async function listWith(
		sink: TicketChangeSink,
		open: TicketSummary[],
		subtasks: TicketSummary[]
	) {
		let tick = 0;
		const answer = (current: TicketSummary, patch: Partial<TicketSummary>): TicketSummary => {
			tick += 1;
			return { ...current, ...patch, updated: `2026-10-10 10:00:0${tick}.000Z` };
		};
		const data = {
			listOpen: vi.fn(async () => open),
			listSubtasks: vi.fn(async () => subtasks),
			searchOpen: vi.fn(async (): Promise<string[]> => []),
			setDone: vi.fn(async (id: string, done: boolean): Promise<TicketSummary> =>
				answer(store.find(id) as TicketSummary, { status: done ? 'done' : 'open' })
			),
			// Priority, status and due date are all these tests change.
			update: vi.fn(async (id: string, patch: TicketPatch): Promise<TicketSummary> =>
				answer(store.find(id) as TicketSummary, {
					...(patch.priority !== undefined && { priority: patch.priority }),
					...(patch.status !== undefined && { status: patch.status }),
					...(patch.due !== undefined && { due: patch.due })
				})
			)
		} satisfies TicketListData;
		const store: TicketListStore = new TicketListStore(data, SESSION, { changes: sink });
		store.activate(EMPTY_LIST_QUERY);
		await vi.advanceTimersByTimeAsync(0);
		return { store, data };
	}

	it('the list: a cell, the check mark, the calendar and their "Rückgängig"; never realtime', async () => {
		const { sink, changes } = spySink();
		const parent = ticket();
		const { store } = await listWith(sink, [parent], [child({ blocksParent: false })]);

		// Realtime (another tab, the server, the dialog changing the sub-tasks) goes through upsert.
		store.upsert({ ...parent, priority: 'urgent', updated: '2026-10-10 09:00:00.000Z' });
		store.upsert({
			...child({ blocksParent: false }),
			priority: 'urgent',
			updated: '2026-10-10 09:00:00.000Z'
		});
		expect(changes).toEqual([]);

		await store.changeField(PARENT_ID, { priority: 'high' });
		expect(changes.at(-1)).toMatchObject({
			before: { priority: 'urgent' },
			after: { priority: 'high' }
		});
		await store.moveDue(PARENT_ID, '2026-10-20');
		expect(changes.at(-1)).toMatchObject({ after: { due: '2026-10-20' } });
		expect(changes.at(-1)?.undo).toBeUndefined();

		await store.setDone(PARENT_ID, true);
		expect(changes.at(-1)).toMatchObject({ before: { status: 'open' }, after: { status: 'done' } });
		await store.undo(PARENT_ID);
		expect(changes.at(-1)).toMatchObject({ after: { status: 'open' }, undo: true });
	});

	it('the list: the answer to the question about open sub-tasks settles the status', async () => {
		const { sink, changes } = spySink();
		const parent = ticket();
		const { store } = await listWith(sink, [parent], [child()]);
		await store.setDone(PARENT_ID, true);
		expect(store.completion).not.toBeNull();
		expect(changes).toEqual([]);
		await store.confirmCompletion('force');
		expect(changes).toEqual([
			expect.objectContaining({
				after: expect.objectContaining({ status: 'done' }),
				answered: ['status']
			})
		]);
	});

	it('bulk actions report nothing: they go to the offer of the series alone', async () => {
		const { sink, changes } = spySink();
		const parent = ticket();
		const { store } = await listWith(sink, [parent], [child()]);
		const series = {
			offerTemplate: vi.fn(() => null),
			offerSubtask: vi.fn(() => null),
			withdrawTemplateOffer: vi.fn()
		};
		const data: BulkEditData = {
			update: vi.fn(async (id: string, patch: TicketPatch) => ({
				...(store.find(id) as TicketSummary),
				priority: patch.priority ?? 'medium',
				updated: '2026-10-10 11:00:00.000Z'
			})),
			delete: vi.fn(async () => null),
			restore: vi.fn(async () => undefined),
			sourceDates: vi.fn(async () => new Map()),
			sourceCount: vi.fn(async () => 0)
		};
		const bulk = new BulkEditStore(data, SESSION, store, undefined, series);
		await bulk.run({ kind: 'priority', value: 'high' }, [PARENT_ID]);
		expect(data.update).toHaveBeenCalledOnce();
		expect(series.offerTemplate).toHaveBeenCalledOnce();
		expect(changes).toEqual([]);
	});

	it('the detail (panel and full view): a saved field and the answered question; never realtime', async () => {
		const { sink, changes } = spySink();
		let current = ticket();
		const data: TicketDetailData = {
			get: vi.fn(async () => current),
			update: vi.fn(async (_id: string, patch: TicketPatch) => {
				current = {
					...current,
					...(patch as Partial<Ticket>),
					updated: `2026-10-10 10:00:0${changes.length + 1}.000Z`
				};
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
			announce: vi.fn(),
			subtasksOf: () => [child()]
		};
		const detail = new TicketDetailStore(data, SESSION, list, null, undefined, undefined, sink);
		detail.open(PARENT_ID);
		await vi.advanceTimersByTimeAsync(0);

		detail.upsert({ ...current, priority: 'low', updated: '2026-10-10 09:00:00.000Z' });
		expect(changes).toEqual([]);

		await detail.choose('priority', 'high');
		expect(changes.at(-1)).toMatchObject({ after: { priority: 'high' } });

		await detail.choose('status', 'done');
		expect(detail.completionQuestion).not.toBeNull();
		expect(changes).toHaveLength(1);
		await detail.confirmCompletion('complete_children');
		expect(changes.at(-1)).toMatchObject({ after: { status: 'done' }, answered: ['status'] });
	});
});
