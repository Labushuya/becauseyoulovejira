// "Übertragen …" after a change of a parent (UE-2, ADR-0070 addendum UE-2): the flag in FlagGroup with
// its one action, which opens the dialog of UE-1 in its mode "nach Änderung" in the section
// "Unteraufgaben" (a modal M in the side panel, inline in the full view, waiting while another dialog
// stands in front); the dialog checks exactly the changed fields, offers to move by the distance of
// the due date, sends the tags of the change, offers "Keine" and "Auch für künftige Tickets
// übernehmen" only where the offer of the series would have come, and shows what worked and what did
// not with "Erneut versuchen" for the failed part; 409 and the hint before the restart as in UE-1.
// The stores run for real on fake data layers.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { DataError } from '$lib/data/errors';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import type { RecurrenceRule } from '$lib/domain/recurrence-rule';
import type { TemplateApplyResult, TemplateOffer } from '$lib/domain/series-template';
import {
	SUBTASK_TRANSFER_STORAGE_KEY,
	type TransferOutcome,
	type TransferRequest
} from '$lib/domain/subtask-transfer';
import {
	startParentChange,
	type ChangedTicket,
	type ParentChange,
	type TagChangeNames
} from '$lib/domain/subtask-transfer-change';
import type { TicketSummary } from '$lib/domain/ticket';
import type { CreateSupport } from '$lib/domain/ticket-create';
import { flagOutlets } from '$lib/overlay/flag-outlets.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import { TransferOfferStore, type TransferSeries } from '$lib/stores/subtask-transfer-offer.svelte';
import {
	SubtaskTransferStore,
	type TransferSupportSource
} from '$lib/stores/subtask-transfer.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import InModalHarness from '$lib/test/InModalHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import FlagGroup from './overlay/FlagGroup.svelte';
import SubtaskTransferDialog from './SubtaskTransferDialog.svelte';
import TicketSubtasks from './TicketSubtasks.svelte';

useOverlayStubs();

const PARENT_ID = 'parent000000001';
const RULE_ID = 'rule00000000001';
const GARDEN = 'tag000000000001';
const WASTE = 'tag000000000002';
const SERIES_BOX = 'Auch für künftige Tickets übernehmen';
let sequence = 0;

function ticket(overrides: Partial<ChangedTicket> = {}): ChangedTicket {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `HAUS-${sequence}`,
		title: `Ticket ${sequence}`,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: `2026-09-0${Math.min(sequence % 9, 9) || 1} 10:00:00.000Z`,
		updated: '2026-09-10 10:00:00.000Z',
		...overrides
	};
}

/** The parent before the change: due 12.10., medium, the tag Müll, in a series. */
const BEFORE = (overrides: Partial<ChangedTicket> = {}) =>
	ticket({
		id: PARENT_ID,
		key: 'HAUS-12',
		title: 'Müll rausbringen',
		due: '2026-10-12',
		tagIds: [WASTE],
		tags: [{ id: WASTE, name: 'Müll' }],
		recurring: true,
		recurrenceId: RULE_ID,
		updated: '2026-10-02 08:00:00.000Z',
		...overrides
	});

/** After it: due 15.10. (+3 days), high, Garten instead of Müll. */
const AFTER = (overrides: Partial<ChangedTicket> = {}) =>
	BEFORE({
		due: '2026-10-15',
		priority: 'high',
		tagIds: [GARDEN],
		tags: [{ id: GARDEN, name: 'Garten' }],
		updated: '2026-10-02 08:05:00.000Z',
		...overrides
	});

const OUTCOME: TransferOutcome = {
	parent: { id: PARENT_ID, key: 'HAUS-12' },
	changed: 1,
	unchanged: 0,
	tickets: []
};

const SUPPORT: CreateSupport = {
	recurrence: true,
	pin: true,
	dayPlan: true,
	ticketSources: true,
	kind: true,
	color: true,
	charm: true,
	assignee: true,
	subtaskStatus: true,
	duplicateSubtaskStatus: true,
	subtaskTransfer: true
};

const OFFER: TemplateOffer = {
	ruleId: RULE_ID,
	title: 'Müll',
	fields: ['priority', 'tags'],
	patch: { priority: 'high', tags: [GARDEN] },
	keys: ['HAUS-12']
};

const APPLIED: TemplateApplyResult = { applied: 1, refused: [], ended: false };

function memoryWindow(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const localStorage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value)
	};
	return { win: { localStorage } as unknown as Window, values };
}

function storeOf({
	answer = async () => OUTCOME,
	support = null,
	win = null
}: {
	answer?: (request: TransferRequest) => Promise<TransferOutcome | null>;
	support?: TransferSupportSource | null;
	win?: Window | null;
} = {}) {
	const data = {
		transfer: vi.fn((_id: string, request: TransferRequest) => answer(request))
	};
	const store = new SubtaskTransferStore(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		{ show: () => 'flag', dismiss: vi.fn() },
		support,
		win
	);
	return { store, data };
}

interface DialogSetup {
	change?: ParentChange;
	series?: TemplateOffer | null;
	apply?: () => Promise<TemplateApplyResult>;
	answer?: (request: TransferRequest) => Promise<TransferOutcome | null>;
	support?: TransferSupportSource | null;
	win?: Window | null;
	subtasks?: TicketSummary[];
	inModal?: boolean;
	tagNames?: TagChangeNames;
}

/** The dialog after a change, alone. */
function renderDialog(setup: DialogSetup = {}) {
	const { store, data } = storeOf(setup);
	const change = setup.change ?? startParentChange({ before: BEFORE(), after: AFTER() });
	const applySeries = vi.fn(setup.apply ?? (async () => APPLIED));
	const onclose = vi.fn();
	const props = {
		parent: change.after,
		subtasks: setup.subtasks ?? [
			ticket({ parentId: PARENT_ID, title: 'Tonne rausstellen', due: '2026-10-11' }),
			ticket({ parentId: PARENT_ID, title: 'Sack kaufen' }),
			ticket({ parentId: PARENT_ID, title: 'Gelber Sack', status: 'done' })
		],
		store,
		names: { project: null, tags: ['Garten'], assignee: null },
		afterChange: {
			change,
			series: setup.series === undefined ? OFFER : setup.series,
			tagNames: setup.tagNames ?? { added: ['Garten'], removed: ['Müll'] }
		},
		applySeries,
		onclose
	};
	if (setup.inModal) {
		render(InModalHarness, { props: { component: SubtaskTransferDialog, props } });
	} else render(SubtaskTransferDialog, { props });
	return { store, data, applySeries, onclose };
}

const fieldsGroup = () => screen.getByRole('group', { name: 'Felder' });
const targetGroup = () => screen.getByRole('group', { name: 'Ziel' });
const box = (name: RegExp | string) =>
	within(fieldsGroup()).getByRole<HTMLInputElement>('checkbox', { name });
const seriesBox = () => screen.getByRole<HTMLInputElement>('checkbox', { name: SERIES_BOX });
const summary = () => document.querySelector('.summary')?.textContent ?? '';
const submit = (name = 'Übertragen') => screen.getByRole('button', { name });

afterEach(() => {
	document.body.innerHTML = '';
});

describe('the dialog after a change', () => {
	it('checks exactly the changed fields; the remembered choice neither counts nor changes', async () => {
		const memory = memoryWindow({ [SUBTASK_TRANSFER_STORAGE_KEY]: '["status"]' });
		const { data, onclose } = renderDialog({ win: memory.win, series: null });
		const checked = within(fieldsGroup())
			.getAllByRole<HTMLInputElement>('checkbox')
			.filter((element) => element.checked)
			.map((element) => element.value);
		expect(checked).toEqual(['due', 'priority', 'tags']);
		expect(box(/^Status/).checked).toBe(false);

		await fireEvent.click(submit());
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
		expect(data.transfer).toHaveBeenCalledOnce();
		expect(memory.values.get(SUBTASK_TRANSFER_STORAGE_KEY)).toBe('["status"]');
	});

	it('offers the same date or the same distance and says what happens without a due date', async () => {
		const { data, onclose } = renderDialog({ series: null });
		const due = screen.getByRole('group', { name: 'Fälligkeit der Unteraufgaben' });
		const same = within(due).getByRole<HTMLInputElement>('radio', {
			name: 'Gleiches Datum wie das Hauptticket'
		});
		const moved = within(due).getByRole<HTMLInputElement>('radio', {
			name: 'Um denselben Abstand verschieben (+3 Tage)'
		});
		expect(same.checked).toBe(true);
		expect(
			box(/^Fälligkeit/)
				.closest('label')
				?.textContent?.replace(/\s+/g, ' ')
				.trim()
		).toBe('Fälligkeit: 15.10.2026');
		expect(moved.getAttribute('aria-describedby')).toBeTruthy();
		expect(document.getElementById(moved.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
			'Unteraufgaben ohne Fälligkeit bleiben ohne.'
		);

		await fireEvent.click(moved);
		expect(summary()).toBe(
			'Ändert 2 von 2 Unteraufgaben. 1 Unteraufgabe ohne Fälligkeit bleibt ohne.'
		);
		await fireEvent.click(submit());
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
		expect(data.transfer.mock.calls[0]?.[1]).toEqual({
			expectedUpdated: '2026-10-02 08:05:00.000Z',
			fields: {
				due: { mode: 'shift', days: 3 },
				priority: true,
				status: false,
				assignee: false,
				project: false,
				tags: { add: [GARDEN], remove: [WASTE] }
			},
			targets: 'open'
		});
	});

	it('locks the choice of the date while the due date is not checked, and has none without an old date', async () => {
		renderDialog({ series: null });
		await fireEvent.click(box(/^Fälligkeit/));
		const due = screen.getByRole('group', { name: 'Fälligkeit der Unteraufgaben' });
		expect(
			within(due)
				.getByRole('radio', { name: /verschieben/ })
				.matches(':disabled')
		).toBe(true);
		document.body.innerHTML = '';

		renderDialog({
			series: null,
			change: startParentChange({ before: BEFORE({ due: null }), after: AFTER() })
		});
		expect(screen.queryByRole('group', { name: 'Fälligkeit der Unteraufgaben' })).toBeNull();
		expect(box(/^Gleiche Fälligkeit wie das Hauptticket: 15\.10\.2026/).checked).toBe(true);
	});

	it('names the tags of the change, not all tags of the parent', () => {
		renderDialog({ series: null });
		const tags = box(/^Tags/);
		expect(tags.closest('label')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Tags: Garten hinzufügen, Müll entfernen'
		);
		expect(document.getElementById(tags.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
			'Andere Tags der Unteraufgaben bleiben.'
		);
	});

	it('offers "Keine" and the series only where the offer of the series would have come', () => {
		renderDialog({ series: null });
		expect(within(targetGroup()).queryByRole('radio', { name: 'Keine' })).toBeNull();
		expect(screen.queryByRole('checkbox', { name: SERIES_BOX })).toBeNull();
		document.body.innerHTML = '';

		renderDialog();
		expect(
			within(targetGroup())
				.getAllByRole('radio')
				.map((radio) => radio.closest('label')?.textContent?.trim())
		).toEqual(['Alle offenen Unteraufgaben (2)', 'Keine', 'Auswählen …']);
		const series = seriesBox();
		expect(series.checked).toBe(false);
		expect(
			document.getElementById(series.getAttribute('aria-describedby') ?? '')?.textContent
		).toBe(
			'Die Vorlage von „Müll“ bekommt Priorität und Tags; dieses Ticket und seine Unteraufgaben ändert das nicht.'
		);
	});

	it('takes over only for the next tickets with "Keine" and the series checked', async () => {
		const { data, applySeries, onclose } = renderDialog();
		await fireEvent.click(within(targetGroup()).getByRole('radio', { name: 'Keine' }));
		expect(summary()).toBe('Die Unteraufgaben bleiben, wie sie sind.');
		const only = submit('Für künftige Tickets übernehmen');
		expect(only.getAttribute('aria-disabled')).toBe('true');
		// The fields do not apply to "Keine".
		expect(box(/^Priorität/).matches(':disabled')).toBe(true);

		await fireEvent.click(seriesBox());
		expect(only.getAttribute('aria-disabled')).toBeNull();
		await fireEvent.click(only);
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
		expect(applySeries).toHaveBeenCalledExactlyOnceWith(OFFER);
		expect(data.transfer).not.toHaveBeenCalled();
	});

	it('runs both parts one after the other and closes when both worked', async () => {
		const { data, applySeries, onclose } = renderDialog();
		await fireEvent.click(seriesBox());
		await fireEvent.click(submit());
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
		expect(data.transfer).toHaveBeenCalledOnce();
		expect(applySeries).toHaveBeenCalledOnce();
	});

	it('says what worked when the series refused, and repeats only the series', async () => {
		const apply = vi
			.fn<() => Promise<TemplateApplyResult>>()
			.mockResolvedValueOnce({
				applied: 0,
				refused: [{ ruleId: RULE_ID, title: 'Müll', reason: 'Das Projekt ist archiviert.' }],
				ended: false
			})
			.mockResolvedValueOnce(APPLIED);
		const { data, applySeries, onclose } = renderDialog({ apply });
		await fireEvent.click(seriesBox());
		await fireEvent.click(submit());

		const again = await screen.findByRole('button', { name: 'Erneut versuchen' });
		const alert = again.closest('[role="alert"]') as HTMLElement;
		expect(alert.textContent).toContain(
			'Die Vorlage von „Müll“ wurde nicht geändert. Das Projekt ist archiviert.'
		);
		expect(screen.getByText('Auf 1 Unteraufgabe übertragen.')).toBeTruthy();
		expect(onclose).not.toHaveBeenCalled();
		// What was sent stays: the choices are locked, "Schließen" instead of "Abbrechen".
		expect(fieldsGroup().hasAttribute('disabled')).toBe(true);
		expect(seriesBox().disabled).toBe(true);
		expect(screen.queryByRole('button', { name: 'Übertragen' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Abbrechen' })).toBeNull();
		expect(screen.getByText('Schließen', { selector: 'button' })).toBeTruthy();

		await fireEvent.click(again);
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
		expect(applySeries).toHaveBeenCalledTimes(2);
		expect(data.transfer).toHaveBeenCalledOnce();
	});

	it('repeats only the sub-tasks when they failed and the series worked', async () => {
		let first = true;
		const { data, applySeries, onclose } = renderDialog({
			answer: async () => {
				if (!first) return OUTCOME;
				first = false;
				throw new DataError('server', { status: 500 });
			}
		});
		await fireEvent.click(seriesBox());
		await fireEvent.click(submit());
		const again = await screen.findByRole('button', { name: 'Erneut versuchen' });
		expect(again.closest('[role="alert"]')?.textContent).toContain(
			'Der Server hat mit einem Fehler geantwortet.'
		);
		expect(screen.getByText('Vorlage von „Müll“ übernommen.')).toBeTruthy();
		await fireEvent.click(again);
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
		expect(data.transfer).toHaveBeenCalledTimes(2);
		expect(applySeries).toHaveBeenCalledOnce();
	});

	it('says to open it anew on 409, without "Erneut versuchen"', async () => {
		renderDialog({
			answer: async () => Promise.reject(new DataError('server', { status: 409 }))
		});
		await fireEvent.click(seriesBox());
		await fireEvent.click(submit());
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain(
			'Das Hauptticket wurde inzwischen geändert. Bitte erneut öffnen.'
		);
		expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull();
	});

	it('shows the hint before the restart and keeps the series', async () => {
		const { data, applySeries, onclose } = renderDialog({
			support: {
				createSupport: { ...SUPPORT, subtaskTransfer: false },
				createSupportProblem: null,
				createSupportLoading: false,
				loadCreateSupport: vi.fn(async () => undefined)
			}
		});
		expect(
			screen.getByText(
				'Diese Funktion ist nach einem Neustart verfügbar: Einstellungen → System → „Jetzt neu starten“.'
			)
		).toBeTruthy();
		expect(screen.queryByRole('group', { name: 'Felder' })).toBeNull();
		await fireEvent.click(seriesBox());
		await fireEvent.click(submit('Für künftige Tickets übernehmen'));
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
		expect(applySeries).toHaveBeenCalledOnce();
		expect(data.transfer).not.toHaveBeenCalled();
	});

	it('keeps it open with the hint when the route turns out unknown (404) after the series worked', async () => {
		const { applySeries, onclose } = renderDialog({ answer: async () => null });
		await fireEvent.click(seriesBox());
		await fireEvent.click(submit());
		await screen.findByText(
			'Diese Funktion ist nach einem Neustart verfügbar: Einstellungen → System → „Jetzt neu starten“.'
		);
		expect(applySeries).toHaveBeenCalledOnce();
		expect(screen.getByText('Vorlage von „Müll“ übernommen.')).toBeTruthy();
		expect(onclose).not.toHaveBeenCalled();
	});

	it('stands inline in the full view with named groups, and the focus on the first box', async () => {
		const { onclose } = renderDialog({ inModal: true });
		expect(screen.getAllByRole('dialog')).toHaveLength(1);
		const area = screen.getByRole('region', { name: 'Auf Unteraufgaben übertragen' });
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				within(area).getByRole('checkbox', { name: /^Fälligkeit/ })
			)
		);
		expect(within(area).getByRole('group', { name: 'Felder' })).toBeTruthy();
		expect(within(area).getByRole('group', { name: 'Ziel' })).toBeTruthy();
		expect(within(area).getByRole('group', { name: 'Fälligkeit der Unteraufgaben' })).toBeTruthy();
		expect(
			within(area).getByText(
				'Was du an HAUS-12 geändert hast, ist vorausgewählt. Titel, Beschreibung, Wiederholung und Art bleiben.'
			)
		).toBeTruthy();
		await fireEvent.click(within(area).getByRole('button', { name: 'Abbrechen' }));
		expect(onclose).toHaveBeenCalledOnce();
	});
});

// --- From the flag to the dialog --------------------------------------------------------------------

function rule(): RecurrenceRule {
	return {
		id: RULE_ID,
		title: 'Müll',
		description: '',
		projectId: null,
		tagIds: [WASTE],
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
		updated: '2026-09-01 10:00:00.000Z'
	};
}

async function renderFlow({ inModal = false } = {}) {
	const parent = AFTER();
	const subtasks = [
		ticket({ parentId: PARENT_ID, title: 'Tonne rausstellen' }),
		ticket({ parentId: PARENT_ID, title: 'Gelber Sack', status: 'done' })
	];
	const data = {
		listOpen: vi.fn(async () => [parent, ...subtasks.filter((entry) => entry.status !== 'done')]),
		listSubtasks: vi.fn(async () => subtasks),
		searchOpen: vi.fn(async () => []),
		setDone: vi.fn(async () => parent),
		update: vi.fn(async () => parent)
	} satisfies TicketListData;
	const list = new TicketListStore(data, { ensureValid: () => true, logout: vi.fn() });
	list.activate(EMPTY_LIST_QUERY);
	await vi.waitFor(() => expect(list.openState).toBe('ready'));
	const flags = new FlagStore();
	const series = {
		offerTemplate: vi.fn(() => null),
		withdrawTemplateOffer: vi.fn(),
		isTemplateOffer: vi.fn(() => false),
		ruleById: vi.fn(() => rule()),
		applyTemplateOffers: vi.fn(async () => APPLIED)
	} satisfies TransferSeries;
	const reveal = vi.fn(async () => undefined);
	const offers = new TransferOfferStore({
		flags,
		subtasksOf: (id) => list.subtasksOf(id),
		series,
		support: () => 'ready',
		reveal
	});
	const { store: transfer, data: transferData } = storeOf();
	render(FlagGroup, { props: { store: flags } });
	const props = {
		ticket: parent,
		list,
		hrefOf: (id: string) => `/tickets/${id}` as ResolvedPathname,
		transfer,
		offers,
		flags
	};
	if (inModal) render(InModalHarness, { props: { component: TicketSubtasks, props } });
	else render(TicketSubtasks, { props });
	return { list, offers, flags, series, reveal, transferData, parent };
}

const flagItem = () =>
	screen.queryByRole('button', { name: 'Übertragen …' })?.closest('li') ?? null;

describe('the flag "Übertragen …"', () => {
	it('has one action besides closing and opens the dialog in the side panel', async () => {
		const { offers, reveal } = await renderFlow();
		offers.changed({ before: BEFORE(), after: AFTER() });
		await tick();
		const flag = flagItem() as HTMLElement;
		expect(
			within(flag).getByText(
				'Fälligkeit, Priorität und Tags von HAUS-12 geändert. Auch für die Unteraufgaben?'
			)
		).toBeTruthy();
		const buttons = within(flag)
			.getAllByRole('button')
			.map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim());
		expect(buttons).toHaveLength(2);
		expect(buttons).toContain('Übertragen …');

		await fireEvent.click(within(flag).getByRole('button', { name: 'Übertragen …' }));
		await tick();
		expect(reveal).toHaveBeenCalledExactlyOnceWith(PARENT_ID);
		const dialog = await screen.findByRole('dialog', { name: 'Auf Unteraufgaben übertragen' });
		expect(
			within(dialog).getByRole<HTMLInputElement>('checkbox', { name: /^Fälligkeit/ }).checked
		).toBe(true);
		expect(within(dialog).getByRole('checkbox', { name: SERIES_BOX })).toBeTruthy();
		expect(flagItem()).toBeNull();

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		await tick();
		await tick();
		// The focus is back on the entry of the section, the flag is gone.
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Auf Unteraufgaben übertragen …' })
		);
	});

	it('waits while another dialog stands in front of the side panel', async () => {
		const { offers, flags } = await renderFlow();
		offers.changed({ before: BEFORE(), after: AFTER() });
		await tick();
		const token = Symbol('other dialog');
		flagOutlets.enter(token, flags);
		try {
			flags.act(flags.flags[0]?.id ?? '');
			await tick();
			expect(screen.queryByRole('dialog', { name: 'Auf Unteraufgaben übertragen' })).toBeNull();
		} finally {
			flagOutlets.leave(token);
		}
		expect(
			await screen.findByRole('dialog', { name: 'Auf Unteraufgaben übertragen' })
		).toBeTruthy();
	});

	it('opens it inline in the full view', async () => {
		const { offers, flags } = await renderFlow({ inModal: true });
		offers.changed({ before: BEFORE(), after: AFTER() });
		await tick();
		flags.act(flags.flags[0]?.id ?? '');
		const area = await screen.findByRole('region', { name: 'Auf Unteraufgaben übertragen' });
		expect(screen.getAllByRole('dialog')).toHaveLength(1);
		expect(within(area).getByRole('group', { name: 'Fälligkeit der Unteraufgaben' })).toBeTruthy();
	});

	it('brings no new flag when the transferred sub-tasks arrive by realtime', async () => {
		const { offers, flags, list, transferData } = await renderFlow();
		offers.changed({ before: BEFORE(), after: AFTER() });
		await tick();
		flags.act(flags.flags[0]?.id ?? '');
		const dialog = await screen.findByRole('dialog', { name: 'Auf Unteraufgaben übertragen' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Übertragen' }));
		await vi.waitFor(() => expect(transferData.transfer).toHaveBeenCalledOnce());
		for (const child of list.subtasksOf(PARENT_ID)) {
			list.upsert({ ...child, priority: 'high', updated: '2026-10-02 09:00:00.000Z' });
		}
		await tick();
		expect(flagItem()).toBeNull();
		expect(flags.flags).toEqual([]);
	});
});
