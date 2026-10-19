// "Auf Unteraufgaben übertragen …" (UE-1, ADR-0070): the entry in the section "Unteraufgaben" (only
// with a sub-task and a store of the layout) and the dialog as a modal M in the side panel and inline
// inside a modal (the full view): "Felder" and "Ziel" as fieldsets with legends, the values of the
// ticket, what is checked in advance, locked boxes with their reason, the list of "Auswählen …", the
// count, "Übertragen" locked without a field or a target, a refusal as a section message in the
// dialog, the hint before the restart, and the focus on opening and closing. The store runs for real
// on a fake data layer; the list of the section is a real TicketListStore.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { ClientResponseError } from 'pocketbase';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { DataError, noteRequest } from '$lib/data/errors';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import {
	SUBTASK_TRANSFER_STORAGE_KEY,
	type TransferNames,
	type TransferOutcome,
	type TransferRequest
} from '$lib/domain/subtask-transfer';
import type { ProjectRef, TicketSummary } from '$lib/domain/ticket';
import type { CreateSupport } from '$lib/domain/ticket-create';
import type { FlagInput } from '$lib/stores/flags.svelte';
import { problemLog } from '$lib/stores/problem-log.svelte';
import {
	SubtaskTransferStore,
	type TransferSupportSource
} from '$lib/stores/subtask-transfer.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import InModalHarness from '$lib/test/InModalHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import SubtaskTransferDialog from './SubtaskTransferDialog.svelte';
import TicketSubtasks from './TicketSubtasks.svelte';

useOverlayStubs();

const PARENT_ID = 'parent000000001';
const HOUSE: ProjectRef = { id: 'proj00000000001', name: 'Haus', code: 'HAUS', archived: false };
let sequence = 0;

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
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
		created: `2026-09-0${Math.min(sequence, 9)} 10:00:00.000Z`,
		updated: '2026-09-10 10:00:00.000Z',
		...overrides
	};
}

const parentTicket = (overrides: Partial<TicketSummary> = {}) =>
	ticket({
		id: PARENT_ID,
		key: 'HAUS-12',
		title: 'Umzug',
		due: '2026-10-12',
		priority: 'high',
		status: 'in_progress',
		updated: '2026-10-02 08:00:00.000Z',
		...overrides
	});

const OUTCOME: TransferOutcome = {
	parent: { id: PARENT_ID, key: 'HAUS-12' },
	changed: 2,
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

function memoryWindow(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const localStorage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value)
	};
	return { win: { localStorage } as unknown as Window, values };
}

interface StoreSetup {
	answer?: (request: TransferRequest) => Promise<TransferOutcome | null>;
	support?: TransferSupportSource | null;
	win?: Window | null;
}

function storeOf(setup: StoreSetup = {}) {
	const flags: FlagInput[] = [];
	const data = {
		transfer: vi.fn((_id: string, request: TransferRequest) =>
			(setup.answer ?? (async () => OUTCOME))(request)
		)
	};
	const store = new SubtaskTransferStore(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		{ show: (input) => (flags.push(input), 'flag'), dismiss: vi.fn() },
		setup.support ?? null,
		setup.win ?? null
	);
	return { store, data, flags };
}

interface DialogSetup extends StoreSetup {
	parent?: TicketSummary;
	subtasks?: TicketSummary[];
	names?: Partial<TransferNames>;
	inModal?: boolean;
}

/** The dialog alone: in the side panel a modal, inside a modal (the full view) inline. */
function renderDialog(setup: DialogSetup = {}) {
	const { store, data, flags } = storeOf(setup);
	const onclose = vi.fn();
	const parent = setup.parent ?? parentTicket();
	const subtasks = setup.subtasks ?? [
		ticket({ parentId: PARENT_ID, title: 'Küche packen' }),
		ticket({ parentId: PARENT_ID, title: 'Keller räumen', status: 'waiting' }),
		ticket({ parentId: PARENT_ID, title: 'Kartons kaufen', status: 'done' })
	];
	const props = {
		parent,
		subtasks,
		store,
		names: { project: null, tags: [], assignee: null, ...setup.names },
		onclose
	};
	if (setup.inModal) {
		render(InModalHarness, { props: { component: SubtaskTransferDialog, props } });
	} else render(SubtaskTransferDialog, { props });
	return { store, data, flags, onclose, subtasks, parent };
}

const fieldsGroup = () => screen.getByRole('group', { name: 'Felder' });
const targetGroup = () => screen.getByRole('group', { name: 'Ziel' });
const box = (name: RegExp | string) =>
	within(fieldsGroup()).getByRole<HTMLInputElement>('checkbox', { name });
const submitButton = () => screen.getByRole('button', { name: 'Übertragen' });
const summary = () => document.querySelector('.summary')?.textContent ?? '';

describe('the dialog', () => {
	it('groups "Felder" and "Ziel" as fieldsets with the values of the ticket', () => {
		renderDialog({ names: { project: HOUSE, tags: ['Garten'], assignee: 'Anna Beispiel' } });
		const names = within(fieldsGroup())
			.getAllByRole('checkbox')
			.map((element) => element.closest('label')?.textContent?.replace(/\s+/g, ' ').trim());
		expect(names).toEqual([
			'Gleiche Fälligkeit wie das Hauptticket: 12.10.2026',
			'Priorität: Hoch',
			'Status: In Arbeit',
			'Zuständigkeit: Anna Beispiel',
			'Tags hinzufügen: Garten',
			'Projekt: Haus'
		]);
		expect(
			within(targetGroup()).getByRole('radio', { name: 'Alle offenen Unteraufgaben (2)' })
		).toBeTruthy();
		expect(within(targetGroup()).getByRole('radio', { name: 'Auswählen …' })).toBeTruthy();
		// Title, description, series and kind are no fields of the dialog.
		expect(
			screen.queryByRole('checkbox', { name: /Titel|Beschreibung|Wiederholung|Art/ })
		).toBeNull();
	});

	it('checks due date and priority in advance, never the project, and says what a project does', () => {
		renderDialog({ names: { project: HOUSE } });
		expect(box(/^Gleiche Fälligkeit/).checked).toBe(true);
		expect(box(/^Priorität/).checked).toBe(true);
		expect(box(/^Status/).checked).toBe(false);
		const project = box(/^Projekt/);
		expect(project.checked).toBe(false);
		expect(
			document.getElementById(project.getAttribute('aria-describedby') ?? '')?.textContent
		).toBe('Die Unteraufgaben erhalten neue Schlüssel.');
	});

	it('offers a ticket without a due date, unchecked, with what it means', () => {
		renderDialog({ parent: parentTicket({ due: null }) });
		const due = box(/^Gleiche Fälligkeit wie das Hauptticket: keine/);
		expect(due.checked).toBe(false);
		expect(due.disabled).toBe(false);
		expect(document.getElementById(due.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
			'Die Unteraufgaben verlieren ihre Fälligkeit.'
		);
	});

	it('locks tags without any and an archived project, naming the reason', () => {
		renderDialog({ names: { project: { ...HOUSE, archived: true }, tags: [] } });
		for (const [name, reason] of [
			[/^Tags hinzufügen/, 'Das Hauptticket hat keine Tags.'],
			[/^Projekt/, 'Das Projekt des Haupttickets ist archiviert.']
		] as const) {
			const element = box(name);
			expect(element.disabled).toBe(true);
			expect(
				document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent
			).toBe(reason);
		}
	});

	it('takes the last confirmed choice of this device in advance', () => {
		const { win } = memoryWindow({ [SUBTASK_TRANSFER_STORAGE_KEY]: '["status"]' });
		renderDialog({ win });
		expect(box(/^Status/).checked).toBe(true);
		expect(box(/^Priorität/).checked).toBe(false);
	});

	it('counts what changes and locks "Übertragen" without a field or a target', async () => {
		renderDialog();
		expect(summary()).toBe('Ändert 2 von 2 Unteraufgaben.');
		expect(submitButton().getAttribute('aria-disabled')).toBeNull();
		await fireEvent.click(box(/^Gleiche Fälligkeit/));
		await fireEvent.click(box(/^Priorität/));
		expect(submitButton().getAttribute('aria-disabled')).toBe('true');
		await fireEvent.click(box(/^Status/));
		expect(submitButton().getAttribute('aria-disabled')).toBeNull();
		// "Auswählen …" without any sub-task chosen.
		await fireEvent.click(within(targetGroup()).getByRole('radio', { name: 'Auswählen …' }));
		for (const element of within(targetGroup()).getAllByRole<HTMLInputElement>('checkbox')) {
			if (element.checked) await fireEvent.click(element);
		}
		expect(summary()).toBe('Keine Unteraufgabe gewählt.');
		expect(submitButton().getAttribute('aria-disabled')).toBe('true');
	});

	it('lists every sub-task for "Auswählen …", the done ones marked and not chosen in advance', async () => {
		const { data, subtasks } = renderDialog();
		await fireEvent.click(within(targetGroup()).getByRole('radio', { name: 'Auswählen …' }));
		const list = within(targetGroup()).getByRole('group', { name: 'Unteraufgaben' });
		const boxes = within(list).getAllByRole<HTMLInputElement>('checkbox');
		expect(
			boxes.map((element) => [
				element.closest('label')?.textContent?.replace(/\s+/g, ' ').trim(),
				element.checked
			])
		).toEqual([
			[`${subtasks[0]?.key} Küche packen`, true],
			[`${subtasks[1]?.key} Keller räumen`, true],
			[`${subtasks[2]?.key} Kartons kaufen Erledigt`, false]
		]);
		await fireEvent.click(boxes[2] as HTMLInputElement);
		await fireEvent.click(boxes[0] as HTMLInputElement);
		expect(summary()).toBe('Ändert 2 von 2 Unteraufgaben.');
		await fireEvent.click(submitButton());
		await vi.waitFor(() => expect(data.transfer).toHaveBeenCalledOnce());
		expect(data.transfer.mock.calls[0]?.[1].targets).toEqual([subtasks[1]?.id, subtasks[2]?.id]);
	});

	it('sends the choice with the known state of the ticket, shows the flag and closes', async () => {
		const { data, flags, onclose, win } = (() => {
			const memory = memoryWindow();
			return { ...renderDialog({ win: memory.win }), win: memory };
		})();
		await fireEvent.click(box(/^Status/));
		await fireEvent.click(submitButton());
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce());
		expect(data.transfer).toHaveBeenCalledExactlyOnceWith(PARENT_ID, {
			expectedUpdated: '2026-10-02 08:00:00.000Z',
			fields: {
				due: { mode: 'same' },
				priority: true,
				status: true,
				assignee: false,
				project: false,
				tags: null
			},
			targets: 'open'
		});
		expect(flags).toEqual([{ tone: 'success', title: 'Auf 2 Unteraufgaben übertragen.' }]);
		expect(win.values.get(SUBTASK_TRANSFER_STORAGE_KEY)).toBe('["due","priority","status"]');
	});

	it('shows a refusal as a section message in the dialog and stays open', async () => {
		const { onclose } = renderDialog({
			answer: async () =>
				Promise.reject(
					Object.assign(new Error('400'), {
						status: 400,
						isAbort: false,
						response: {
							data: {
								targets: {
									code: 'validation_project_archived',
									message: 'x',
									params: { key: 'HAUS-14', id: 'child', field: 'project' }
								}
							}
						}
					})
				)
		});
		await fireEvent.click(submitButton());
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toContain('HAUS-14: Das Projekt ist archiviert.');
		expect(alert.closest('.section-message')?.getAttribute('data-tone')).toBe('error');
		expect(onclose).not.toHaveBeenCalled();
	});

	it('says that the ticket changed meanwhile (409)', async () => {
		renderDialog({
			answer: async () => Promise.reject(new DataError('server', { status: 409 }))
		});
		await fireEvent.click(submitButton());
		expect((await screen.findByRole('alert')).textContent).toContain(
			'Das Hauptticket wurde inzwischen geändert. Bitte erneut öffnen.'
		);
	});

	it('shows the details of the failed transfer and takes it into the list of the session (FP-1)', async () => {
		problemLog.clear();
		const path = `/api/byl/tickets/${PARENT_ID}/subtasks/transfer`;
		// As the client of the app hands on a refusal of the route: the error of the SDK with its request.
		const refusal = new ClientResponseError({
			url: `http://127.0.0.1:8090${path}`,
			status: 409,
			response: { status: 409, message: 'Das Hauptticket wurde inzwischen geändert.', data: {} }
		});
		noteRequest(refusal, 'POST', path);
		renderDialog({ answer: async () => Promise.reject(refusal) });
		await fireEvent.click(submitButton());
		const alert = await screen.findByRole('alert');

		const details = within(alert).getByRole('button', {
			name: 'Details: Unteraufgaben übertragen'
		});
		await fireEvent.click(details);
		const facts = (
			document.getElementById(details.getAttribute('aria-controls') ?? '')?.textContent ?? ''
		).replace(/\s+/g, ' ');
		expect(facts).toContain('Ergebnis HTTP 409 (Konflikt)');
		expect(facts).toContain('Servermeldung Das Hauptticket wurde inzwischen geändert.');
		expect(facts).toContain(`Anfrage POST ${path}`);
		expect(problemLog.entries[0]).toMatchObject({
			intent: 'Unteraufgaben übertragen',
			outcome: { status: 409 },
			request: { method: 'POST', path }
		});
		// Inside the side panel the dialog is a modal: the list unfolds in place.
		const all = within(alert).getByRole('button', { name: 'Alle Fehler dieser Sitzung (1)' });
		expect(all.getAttribute('aria-expanded')).toBe('false');
	});

	it('shows the hint to restart instead of an error when the server does not know the route', async () => {
		const { onclose } = renderDialog({ answer: async () => null });
		await fireEvent.click(submitButton());
		const hint = await screen.findByText(
			'Diese Funktion ist nach einem Neustart verfügbar: Einstellungen → System → „Jetzt neu starten“.'
		);
		expect(hint.closest('.section-message')?.getAttribute('data-tone')).toBe('info');
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Übertragen' })).toBeNull();
		expect(onclose).not.toHaveBeenCalled();
	});

	it('shows the hint already when GET /api/byl/tickets/create does not name the route', () => {
		const { data } = renderDialog({
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
		expect(data.transfer).not.toHaveBeenCalled();
	});

	it('puts the focus on the first box when it opens', async () => {
		renderDialog();
		await vi.waitFor(() => expect(document.activeElement).toBe(box(/^Gleiche Fälligkeit/)));
	});

	it('stands inline inside a modal (the full view): one dialog, Escape closes only the area', async () => {
		const { onclose } = renderDialog({ inModal: true });
		expect(screen.getAllByRole('dialog')).toHaveLength(1);
		const area = screen.getByRole('region', { name: 'Auf Unteraufgaben übertragen' });
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				within(area).getByRole('checkbox', { name: /^Gleiche Fälligkeit/ })
			)
		);
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		document.activeElement?.dispatchEvent(escape);
		expect(escape.defaultPrevented).toBe(true);
		expect(onclose).toHaveBeenCalledOnce();
	});
});

// --- The entry in the section "Unteraufgaben" ---------------------------------------------------

async function renderSection(
	subtasks: TicketSummary[],
	{ transfer = storeOf().store as SubtaskTransferStore | null, inModal = false } = {}
) {
	const parent = parentTicket();
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
	const props = {
		ticket: parent,
		list,
		hrefOf: (id: string) => `/tickets/${id}` as ResolvedPathname,
		transfer
	};
	if (inModal) render(InModalHarness, { props: { component: TicketSubtasks, props } });
	else render(TicketSubtasks, { props });
	return { list, parent };
}

const entry = () => screen.queryByRole('button', { name: 'Auf Unteraufgaben übertragen …' });

describe('the entry "Auf Unteraufgaben übertragen …"', () => {
	it('shows only with a sub-task, next to "Unteraufgabe hinzufügen"', async () => {
		await renderSection([]);
		expect(entry()).toBeNull();
		expect(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' })).toBeTruthy();
	});

	it('shows nothing outside the (app) layout (no store)', async () => {
		await renderSection([ticket({ parentId: PARENT_ID })], { transfer: null });
		expect(entry()).toBeNull();
	});

	it('opens the dialog as a modal and gives the focus back on "Abbrechen"', async () => {
		await renderSection([
			ticket({ parentId: PARENT_ID }),
			ticket({ parentId: PARENT_ID, status: 'done' })
		]);
		const button = entry() as HTMLButtonElement;
		expect(button.getAttribute('aria-haspopup')).toBe('dialog');
		button.focus();
		await fireEvent.click(button);
		await tick();
		const dialog = screen.getByRole('dialog', { name: 'Auf Unteraufgaben übertragen' });
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				within(dialog).getByRole('checkbox', { name: /^Gleiche Fälligkeit/ })
			)
		);
		expect(
			within(dialog).getByRole('radio', { name: 'Alle offenen Unteraufgaben (1)' })
		).toBeTruthy();
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
		await tick();
		await tick();
		expect(screen.queryByRole('dialog', { name: 'Auf Unteraufgaben übertragen' })).toBeNull();
		expect(document.activeElement).toBe(entry());
	});

	it('unfolds the dialog inline in the full view and gives the focus back on closing', async () => {
		await renderSection([ticket({ parentId: PARENT_ID })], { inModal: true });
		const button = entry() as HTMLButtonElement;
		expect(button.getAttribute('aria-expanded')).toBe('false');
		button.focus();
		await fireEvent.click(button);
		await tick();
		expect(button.getAttribute('aria-expanded')).toBe('true');
		const area = screen.getByRole('region', { name: 'Auf Unteraufgaben übertragen' });
		await fireEvent.click(within(area).getByRole('button', { name: 'Abbrechen' }));
		await tick();
		await tick();
		expect(screen.queryByRole('region', { name: 'Auf Unteraufgaben übertragen' })).toBeNull();
		expect(document.activeElement).toBe(entry());
	});
});
