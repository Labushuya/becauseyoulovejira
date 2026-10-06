// "Neues Ticket" with everything at once (NT-1, ADR-0069): the main fields on top, the area "Weitere
// Optionen" below them in the order of the detail, remembered per device and counting what is set,
// the fields per area, refusals of the server at their field (the area opens for them), the keyboard
// (title and Enter, the disclosure), the phone (44 px) and the route that sends one request, also when
// converting an entry of the inbox in the same form. Before the restart of the server after NT-1 the
// area says when the rest comes.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxItem, InboxItemSummary } from '$lib/domain/inbox';
import type { Ticket, TicketDraft } from '$lib/domain/ticket';
import { MORE_OPTIONS_KEY, NO_EXTRAS, type TicketExtras } from '$lib/domain/ticket-create';
import { createKeys } from '$lib/domain/ticket-options';
import type { RepeatRequest } from '$lib/domain/recurrence-rule';
import { fixedAssignees } from '$lib/stores/assignees.svelte';
import { CatalogStore } from '$lib/stores/catalog.svelte';
import type { CreateResult } from '$lib/stores/ticket-detail.svelte';
import { fakePickerSource, pickerTicket } from '$lib/test/ticket-picker-fake';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import { useProseMirrorStubs } from '$lib/test/prosemirror-stubs';
import NewTicketForm from './NewTicketForm.svelte';
import formSource from './NewTicketForm.svelte?raw';
import NewTicketPage from '../../routes/(app)/(tickets)/tickets/neu/+page.svelte';

useOverlayStubs();
useProseMirrorStubs();

const SUPPORT = {
	recurrence: true,
	pin: true,
	dayPlan: true,
	ticketSources: true,
	kind: true,
	color: true,
	charm: true,
	assignee: true
};

const mocks = vi.hoisted(() => ({
	goto: vi.fn(async () => undefined),
	page: { url: new URL('http://localhost:3000/tickets/neu') },
	detail: {
		create: vi.fn(),
		upsert: vi.fn(),
		createWithOptions: vi.fn(),
		createSupport: null as unknown,
		loadCreateSupport: vi.fn(async () => undefined)
	},
	catalog: null as unknown,
	inbox: { fetch: vi.fn(), markConverted: vi.fn(), newItems: [] as unknown[] },
	tickets: {
		today: '2026-09-25',
		announce: vi.fn(),
		markRead: vi.fn(async () => undefined),
		upsert: vi.fn()
	},
	rules: {
		state: 'ready',
		statusReady: true,
		subtasksReady: true,
		eachReady: false,
		charmsReady: false,
		assigneesReady: false,
		repeatCreated: vi.fn(),
		upsert: vi.fn(),
		ruleParams: vi.fn()
	}
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/stores/ticket-detail.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketDetailStore: () => mocks.detail
}));
vi.mock('$lib/stores/catalog.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getCatalogStore: () => mocks.catalog
}));
vi.mock('$lib/stores/inbox.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getInboxStore: () => mocks.inbox
}));
vi.mock('$lib/stores/ticket-list.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getTicketListStore: () => mocks.tickets
}));
vi.mock('$lib/stores/recurrence.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getRecurrenceStore: () => mocks.rules
}));
// The pins of the account are loaded and the day plan is there, as in the (app) layout.
vi.mock('$lib/stores/pins.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	findPinStore: () => ({ available: true })
}));
vi.mock('$lib/stores/day-plan.svelte', async (importOriginal) => ({
	...(await importOriginal<object>()),
	findDayPlanEntryStore: () => ({})
}));

const SCOPE = 'u:owner0000000001';

const CREATED: Ticket = {
	id: 'new000000000000',
	key: 'TASK-9',
	title: 'Neu',
	description: '',
	sourceItem: null,
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
	created: '2026-09-24 10:00:00.000Z',
	updated: '2026-09-24 10:00:00.000Z'
};

function entry(id: string, title: string): InboxItemSummary {
	return {
		id,
		channel: 'manual',
		kind: 'todo',
		title,
		sourceUrl: '',
		sourceRef: '',
		sourceDate: null,
		sourceMeta: {},
		original: '',
		state: 'new',
		ticketId: null,
		handledAt: null,
		scope: SCOPE,
		created: '2026-09-24 08:00:00.000Z',
		updated: '2026-09-24 08:00:00.000Z'
	};
}

const MAIL = entry('item00000000001', 'Mail vom Vermieter');
const NOTE = entry('item00000000002', 'Zettel am Kühlschrank');
const MOVE = pickerTicket({ key: 'TASK-20', title: 'Umzug planen', scope: SCOPE });
const ORIGIN = pickerTicket({ key: 'TASK-21', title: 'Heizung prüfen', scope: SCOPE });

/** Every option available, in the private area; `props` override. */
function everything(props: Record<string, unknown> = {}) {
	return {
		repeat: true,
		statusAvailable: true,
		subtasksAvailable: true,
		colorsAvailable: true,
		charmsAvailable: true,
		extrasAvailable: true,
		kindAvailable: true,
		pinAvailable: true,
		dayPlanAvailable: true,
		ticketSourcesAvailable: true,
		candidates: [MAIL, NOTE],
		picker: fakePickerSource({ open: [MOVE, ORIGIN] }).source,
		scope: SCOPE,
		today: '2026-09-25',
		...props
	};
}

type Create = (
	draft: TicketDraft,
	recurrence: RepeatRequest | null,
	extras: TicketExtras
) => Promise<CreateResult>;

function renderForm(props: Record<string, unknown> = {}, create?: Create) {
	const oncreate = vi.fn<Create>(create ?? (async () => ({ ok: true, ticket: CREATED })));
	const oncreated = vi.fn();
	const oncancel = vi.fn();
	const result = render(NewTicketForm, {
		props: { oncreate, oncreated, oncancel, ...everything(props) }
	});
	return { ...result, oncreate, oncreated, oncancel };
}

const titleField = () => screen.getByLabelText<HTMLInputElement>('Titel');
const createButton = () => screen.getByRole('button', { name: /^(Anlegen|Wird angelegt …)$/ });
const moreToggle = () => screen.getByRole('button', { name: /^Weitere Optionen/ });
const moreBody = () =>
	document.getElementById(moreToggle().getAttribute('aria-controls') ?? '') as HTMLElement;
const optionKeys = (root: ParentNode) =>
	[...root.querySelectorAll<HTMLElement>('[data-ticket-option]')].map(
		(element) => element.dataset.ticketOption
	);

async function openMore() {
	if (moreToggle().getAttribute('aria-expanded') !== 'true') await fireEvent.click(moreToggle());
}

beforeEach(() => {
	localStorage.removeItem(MORE_OPTIONS_KEY);
	mocks.goto.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
	localStorage.removeItem(MORE_OPTIONS_KEY);
});

describe('main fields and "Weitere Optionen" (NT-1)', () => {
	it('shows the main fields of before on top and every other option below, in the order of the detail', async () => {
		renderForm();
		const main = optionKeys(document.body).filter(
			(key) => !moreBody().querySelector(`[data-ticket-option="${key}"]`)
		);
		expect(main).toEqual([
			'title',
			'status',
			'priority',
			'due',
			'project',
			'charm',
			'tags',
			'description'
		]);
		// Folded at first: the main fields are all a quick ticket needs.
		expect(moreToggle().getAttribute('aria-expanded')).toBe('false');
		expect(moreBody().hidden).toBe(true);
		expect(moreToggle().textContent?.trim()).toBe('Weitere Optionen');

		await openMore();
		expect(moreBody().hidden).toBe(false);
		expect(optionKeys(moreBody())).toEqual(createKeys('more'));
		expect(screen.getByRole('switch', { name: 'Anheften' })).toBeTruthy();
		expect(screen.getByRole('switch', { name: 'Zum Tagesplan von heute' })).toBeTruthy();
		expect(screen.getByRole('radiogroup', { name: 'Farbe' })).toBeTruthy();
		expect(screen.getByRole('switch', { name: 'Laufendes Vorhaben' })).toBeTruthy();
		expect(screen.getByRole('combobox', { name: 'Unter ein Ticket einordnen' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Wiederholen' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' })).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: /Mail vom Vermieter/ })).toBeTruthy();
		expect(screen.getByRole('combobox', { name: 'Ticket als Quelle' })).toBeTruthy();
	});

	it('remembers per device whether the area is open', async () => {
		const first = renderForm();
		await fireEvent.click(moreToggle());
		expect(localStorage.getItem(MORE_OPTIONS_KEY)).toBe('1');
		first.unmount();

		const second = renderForm();
		expect(moreToggle().getAttribute('aria-expanded')).toBe('true');
		await fireEvent.click(moreToggle());
		expect(localStorage.getItem(MORE_OPTIONS_KEY)).toBeNull();
		second.unmount();

		renderForm();
		expect(moreToggle().getAttribute('aria-expanded')).toBe('false');
	});

	it('counts in its heading what differs from a new ticket, also while folded', async () => {
		renderForm();
		await openMore();
		await fireEvent.click(screen.getByRole('switch', { name: 'Anheften' }));
		expect(moreToggle().textContent?.trim()).toBe('Weitere Optionen (1 gesetzt)');
		await fireEvent.click(screen.getByRole('radio', { name: 'Blau' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: /Mail vom Vermieter/ }));
		expect(moreToggle().textContent?.trim()).toBe('Weitere Optionen (4 gesetzt)');
		await fireEvent.click(moreToggle());
		expect(moreToggle().textContent?.trim()).toBe('Weitere Optionen (4 gesetzt)');
	});

	it('asks before discarding an option set under "Weitere Optionen"', async () => {
		const { oncancel } = renderForm();
		await openMore();
		await fireEvent.click(screen.getByRole('switch', { name: 'Laufendes Vorhaben' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		await tick();
		expect(screen.getByRole('dialog', { name: 'Neues Ticket verwerfen?' })).toBeTruthy();
		expect(oncancel).not.toHaveBeenCalled();
	});

	it('creates with every option at once', async () => {
		const { oncreate, oncreated } = renderForm();
		await fireEvent.input(titleField(), { target: { value: 'Heizung warten' } });
		await openMore();
		await fireEvent.click(screen.getByRole('switch', { name: 'Anheften' }));
		await fireEvent.click(screen.getByRole('switch', { name: 'Zum Tagesplan von heute' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'Blau' }));
		await fireEvent.click(screen.getByRole('switch', { name: 'Laufendes Vorhaben' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		await fireEvent.input(screen.getByLabelText('Titel der Unteraufgabe 1'), {
			target: { value: ' Termin machen ' }
		});
		await fireEvent.click(screen.getByRole('checkbox', { name: /Zettel am Kühlschrank/ }));
		const sourcePicker = screen.getByRole('combobox', { name: 'Ticket als Quelle' });
		await fireEvent.input(sourcePicker, { target: { value: 'Heizung' } });
		await vi.waitFor(() => expect(sourcePicker.getAttribute('aria-expanded')).toBe('true'));
		await fireEvent.keyDown(sourcePicker, { key: 'Enter' });
		await vi.waitFor(() =>
			expect(screen.getByRole('list', { name: 'Gewählte Quell-Tickets' }).textContent).toContain(
				'TASK-21'
			)
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholen' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'Offen (wie dieses Ticket)' }));
		await fireEvent.click(
			screen.getByRole('checkbox', {
				name: 'Unteraufgaben auch jedem künftigen Ticket der Serie geben'
			})
		);
		await fireEvent.click(createButton());

		expect(oncreate).toHaveBeenCalledOnce();
		const [draft, recurrence, extras] = oncreate.mock.calls[0] ?? [];
		expect(draft).toMatchObject({ title: 'Heizung warten', color: 'blau', kind: 'ongoing' });
		expect(draft).not.toHaveProperty('parent');
		expect(recurrence).toMatchObject({
			initialStatus: 'open',
			values: expect.objectContaining({ freq: 'weekly' })
		});
		expect(extras).toEqual({
			subtasks: [{ title: 'Termin machen', priority: 'medium' }],
			ticketSources: [ORIGIN.id],
			sources: [NOTE.id],
			pin: true,
			dayPlan: true,
			templateSubtasks: true
		});
		await vi.waitFor(() => expect(oncreated).toHaveBeenCalledWith(CREATED.id));
	});

	it('creates a sub-task under a parent and lets it not block the parent', async () => {
		const { oncreate } = renderForm();
		await fireEvent.input(titleField(), { target: { value: 'Kartons' } });
		await openMore();
		const parentPicker = screen.getByRole('combobox', { name: 'Unter ein Ticket einordnen' });
		await fireEvent.input(parentPicker, { target: { value: 'Umzug' } });
		await vi.waitFor(() => expect(parentPicker.getAttribute('aria-expanded')).toBe('true'));
		await fireEvent.keyDown(parentPicker, { key: 'Enter' });
		const blocks = await screen.findByRole('switch', {
			name: 'Blockiert das übergeordnete Ticket'
		});
		expect(
			document.getElementById(blocks.getAttribute('aria-describedby') ?? '')?.textContent
		).toContain('TASK-20');
		// One level: a sub-task gets no sub-tasks of its own.
		expect(screen.queryByRole('button', { name: 'Unteraufgabe hinzufügen' })).toBeNull();
		expect(screen.getByText(/eine Unteraufgabe hat keine eigenen Unteraufgaben/)).toBeTruthy();
		await fireEvent.click(blocks);
		await fireEvent.click(createButton());
		expect(oncreate.mock.calls[0]?.[0]).toMatchObject({ parent: MOVE.id, blocksParent: false });
		expect(oncreate.mock.calls[0]?.[2]).toEqual(NO_EXTRAS);
	});

	it('offers no parent once the ticket gets sub-tasks', async () => {
		renderForm();
		await openMore();
		await fireEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		expect(screen.queryByRole('combobox', { name: 'Unter ein Ticket einordnen' })).toBeNull();
		expect(screen.getByText(/das Ticket bekommt selbst Unteraufgaben/)).toBeTruthy();
	});

	it('pins and plans no done ticket', async () => {
		const { oncreate } = renderForm();
		await fireEvent.input(titleField(), { target: { value: 'Schon erledigt' } });
		await openMore();
		await fireEvent.click(screen.getByRole('switch', { name: 'Anheften' }));
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } });
		const pin = screen.getByRole<HTMLInputElement>('switch', { name: 'Anheften' });
		expect(pin.disabled).toBe(true);
		expect(pin.checked).toBe(false);
		expect(screen.getByText('Erledigte Tickets lassen sich nicht anheften.')).toBeTruthy();
		expect(
			screen.getByRole<HTMLInputElement>('switch', { name: 'Zum Tagesplan von heute' }).disabled
		).toBe(true);
		await fireEvent.click(createButton());
		expect(oncreate.mock.calls[0]?.[2]).toMatchObject({ pin: false, dayPlan: false });
	});

	it('refuses an empty sub-task before sending and marks its row', async () => {
		const { oncreate } = renderForm();
		await fireEvent.input(titleField(), { target: { value: 'T' } });
		await openMore();
		await fireEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		await fireEvent.click(moreToggle());
		await fireEvent.click(createButton());
		expect(oncreate).not.toHaveBeenCalled();
		// The area opens again for the row.
		expect(moreBody().hidden).toBe(false);
		const row = screen.getByLabelText('Titel der Unteraufgabe 1');
		await vi.waitFor(() => expect(document.activeElement).toBe(row));
		expect(row.getAttribute('aria-invalid')).toBe('true');
	});
});

describe('fields per area', () => {
	const ME = 'user00000000001';
	const MEMBERS = [
		{ id: ME, name: 'Anna Beispiel', self: true },
		{ id: 'user00000000002', name: 'Bert Beispiel', self: false }
	];

	it('offers "Zuständig" only in the household, every other option in both areas', async () => {
		renderForm({ assignmentAvailable: true, assignees: fixedAssignees(MEMBERS, ME) });
		await openMore();
		const household = optionKeys(document.body);
		expect(household).toContain('assignee');
		document.body.innerHTML = '';

		renderForm({ assignmentAvailable: true, assignees: fixedAssignees(MEMBERS, ME, false) });
		await openMore();
		const own = optionKeys(document.body);
		expect(own).not.toContain('assignee');
		expect(household.filter((key) => key !== 'assignee')).toEqual(own);
	});

	it('offers the parent and the source tickets of the own area only', async () => {
		const other = pickerTicket({
			key: 'HAUS-3',
			title: 'Haushalt Umzug',
			scope: 'h:house0000000001'
		});
		renderForm({ picker: fakePickerSource({ open: [MOVE, other] }).source });
		await openMore();
		const parentPicker = screen.getByRole('combobox', { name: 'Unter ein Ticket einordnen' });
		await fireEvent.input(parentPicker, { target: { value: 'Umzug' } });
		await vi.waitFor(() => expect(parentPicker.getAttribute('aria-expanded')).toBe('true'));
		const options = screen.queryAllByRole('option', { hidden: true });
		const foreign = options.find((option) => option.textContent?.includes('HAUS-3'));
		expect(foreign?.getAttribute('aria-disabled')).toBe('true');
		expect(foreign?.textContent).toContain('Liegt in einem anderen Bereich.');
	});
});

describe('refusals of the server at their field', () => {
	it.each<[string, CreateResult, () => HTMLElement]>([
		[
			'a sub-task row',
			{
				ok: false,
				message: null,
				fields: { subtasks: 'Jede Unteraufgabe braucht einen Titel.' },
				index: { subtasks: 0 }
			},
			() => screen.getByLabelText('Titel der Unteraufgabe 1')
		],
		[
			'"Zum Tagesplan"',
			{
				ok: false,
				message: null,
				fields: { dayPlan: 'Erledigte Tickets kommen nicht in den Tagesplan.' }
			},
			() => screen.getByRole('switch', { name: 'Zum Tagesplan von heute' })
		],
		[
			'"Laufendes Vorhaben"',
			{ ok: false, message: null, fields: { kind: 'Dieser Wert ist ungültig.' } },
			() => screen.getByRole('switch', { name: 'Laufendes Vorhaben' })
		]
	])(
		'opens "Weitere Optionen" for %s and shows the refusal there',
		async (_name, answer, field) => {
			renderForm({}, async () => answer);
			await fireEvent.input(titleField(), { target: { value: 'T' } });
			await openMore();
			await fireEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
			await fireEvent.input(screen.getByLabelText('Titel der Unteraufgabe 1'), {
				target: { value: 'x' }
			});
			await fireEvent.click(screen.getByRole('switch', { name: 'Zum Tagesplan von heute' }));
			await fireEvent.click(moreToggle());
			await fireEvent.click(createButton());
			await vi.waitFor(() => expect(moreBody().hidden).toBe(false));
			const message = Object.values(answer.ok ? {} : answer.fields)[0] ?? '';
			await vi.waitFor(() => expect(field().getAttribute('aria-invalid')).toBe('true'));
			expect(moreBody().textContent).toContain(message);
			// Opened for the error only: the device keeps its choice.
			expect(localStorage.getItem(MORE_OPTIONS_KEY)).toBeNull();
		}
	);

	it('shows a refusal of the rhythm in the section "Wiederholen"', async () => {
		renderForm({}, async () => ({
			ok: false,
			message: null,
			fields: { interval: 'Höchstens 365.' }
		}));
		await fireEvent.input(titleField(), { target: { value: 'T' } });
		await openMore();
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholen' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'Offen (wie dieses Ticket)' }));
		await fireEvent.click(createButton());
		const section = screen.getByRole('region', { name: 'Wiederholen' });
		await vi.waitFor(() => expect(within(section).getByText('Höchstens 365.')).toBeTruthy());
	});

	it('shows a refusal without a field as the message of the form', async () => {
		renderForm({}, async () => ({
			ok: false,
			message: 'Dieser Eintrag wurde schon bearbeitet.',
			fields: {}
		}));
		await fireEvent.input(titleField(), { target: { value: 'T' } });
		await fireEvent.click(createButton());
		expect(await screen.findByText('Dieser Eintrag wurde schon bearbeitet.')).toBeTruthy();
	});
});

describe('keyboard', () => {
	it('creates with the title alone and Enter: the implicit submission of its form', async () => {
		const { oncreate } = renderForm();
		await fireEvent.input(titleField(), { target: { value: 'Schnell' } });
		const form = titleField().form;
		expect(form).not.toBeNull();
		// The submit button "Anlegen" belongs to the form, so Enter in the title submits it.
		expect(createButton().getAttribute('form')).toBe(form?.id);
		form?.requestSubmit();
		await tick();
		expect(oncreate).toHaveBeenCalledOnce();
		expect(oncreate.mock.calls[0]?.[0]).toMatchObject({ title: 'Schnell', status: 'open' });
		expect(oncreate.mock.calls[0]?.[1]).toBeNull();
		expect(oncreate.mock.calls[0]?.[2]).toEqual(NO_EXTRAS);
	});

	it('opens "Weitere Optionen" with a button that names what it controls', async () => {
		renderForm();
		const toggle = moreToggle();
		expect(toggle.tagName).toBe('BUTTON');
		expect(toggle.getAttribute('type')).toBe('button');
		expect(toggle.closest('h3')).not.toBeNull();
		expect(moreBody().id).toBe(toggle.getAttribute('aria-controls'));
		toggle.focus();
		await fireEvent.click(toggle);
		expect(document.activeElement).toBe(toggle);
		expect(screen.getByRole('region', { name: /^Weitere Optionen/ })).toBeTruthy();
	});

	it('creates with Ctrl+Enter from a field under "Weitere Optionen"', async () => {
		const { oncreate } = renderForm();
		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await openMore();
		await fireEvent.keyDown(screen.getByRole('switch', { name: 'Anheften' }), {
			key: 'Enter',
			ctrlKey: true
		});
		expect(oncreate).toHaveBeenCalledOnce();
	});
});

describe('on the phone', () => {
	it('gives the disclosure buttons 44 px on touch screens; the switches take theirs from base.css', () => {
		expect(formSource).toMatch(
			/@media \(pointer: coarse\)\s*\{[\s\S]*?\.disclosure\s*\{[^}]*min-height:\s*var\(--control-height-touch\)/
		);
		renderForm();
		// base.css gives `label:has(> input[type=checkbox])` 44 px: every switch sits directly in its label.
		for (const control of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
			expect(control.parentElement?.tagName, control.outerHTML).toBe('LABEL');
		}
	});
});

describe('before the restart of the server after NT-1', () => {
	it('offers color and "Wiederholen" as before and says when the rest comes', async () => {
		renderForm({ extrasAvailable: false });
		await openMore();
		expect(optionKeys(moreBody())).toEqual(['color', 'recurrence']);
		expect(moreBody().textContent).toContain('nach dem nächsten Neustart verfügbar');
	});
});

describe('the route: one request for everything', () => {
	const RULE = { id: 'rule00000000012' };

	function catalog() {
		const store = new CatalogStore(
			{ listProjects: vi.fn(async () => []), listTags: vi.fn(async () => []), createTag: vi.fn() },
			{ ensureValid: () => true, logout: vi.fn() }
		);
		void store.load();
		mocks.catalog = store;
	}

	beforeEach(() => {
		catalog();
		mocks.page.url = new URL('http://localhost:3000/tickets/neu');
		mocks.detail.createSupport = SUPPORT;
		mocks.detail.create.mockReset();
		mocks.detail.createWithOptions.mockReset();
		mocks.detail.createWithOptions.mockResolvedValue({ ok: true, ticket: CREATED, rule: RULE });
		mocks.rules.ruleParams.mockReset();
		mocks.rules.ruleParams.mockReturnValue({ freq: 'weekly', initial_status: 'open' });
		mocks.rules.upsert.mockReset();
		mocks.rules.repeatCreated.mockReset();
		mocks.inbox.newItems = [MAIL, NOTE];
		mocks.inbox.markConverted.mockReset();
		mocks.tickets.markRead.mockClear();
	});

	afterEach(() => {
		mocks.detail.createSupport = null;
	});

	it('asks the server what it knows and sends the ticket, the series and the extras in one request', async () => {
		render(NewTicketPage);
		expect(mocks.detail.loadCreateSupport).toHaveBeenCalled();
		await fireEvent.input(titleField(), { target: { value: 'Müll rausbringen' } });
		await openMore();
		await fireEvent.click(screen.getByRole('switch', { name: 'Anheften' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: /Mail vom Vermieter/ }));
		await fireEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		await fireEvent.input(screen.getByLabelText('Titel der Unteraufgabe 1'), {
			target: { value: 'Tonne' }
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholen' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'Offen (wie dieses Ticket)' }));
		await fireEvent.click(createButton());

		await vi.waitFor(() => expect(mocks.detail.createWithOptions).toHaveBeenCalledOnce());
		expect(mocks.detail.create).not.toHaveBeenCalled();
		expect(mocks.rules.repeatCreated).not.toHaveBeenCalled();
		// The sub-tasks go into the template only with the switch.
		expect(mocks.rules.ruleParams).toHaveBeenCalledWith(
			expect.objectContaining({ initialStatus: 'open' }),
			[]
		);
		expect(mocks.detail.createWithOptions).toHaveBeenCalledWith({
			draft: expect.objectContaining({ title: 'Müll rausbringen' }),
			sourceItem: null,
			recurrence: { freq: 'weekly', initial_status: 'open' },
			extras: {
				subtasks: [{ title: 'Tonne', priority: 'medium' }],
				ticketSources: [],
				sources: [MAIL.id],
				pin: true,
				dayPlan: false
			}
		});
		await vi.waitFor(() =>
			expect(mocks.goto).toHaveBeenCalledWith('/tickets/new000000000000', { replaceState: true })
		);
		expect(mocks.rules.upsert).toHaveBeenCalledWith(RULE);
		expect(mocks.tickets.markRead).toHaveBeenCalledWith(CREATED);
	});

	it('converts an entry of the inbox in the same form, with every option', async () => {
		const item: InboxItem = { ...MAIL, body: 'Bitte melden.' };
		mocks.page.url = new URL(`http://localhost:3000/tickets/neu?aus=${MAIL.id}`);
		mocks.inbox.fetch.mockReset();
		mocks.inbox.fetch.mockResolvedValue(item);
		render(NewTicketPage);
		await vi.waitFor(() => expect(titleField().value).toBe('Mail vom Vermieter'));
		await openMore();
		// The entry converted here is the main source, not one more.
		expect(screen.queryByRole('checkbox', { name: /Mail vom Vermieter/ })).toBeNull();
		await fireEvent.click(screen.getByRole('checkbox', { name: /Zettel am Kühlschrank/ }));
		await fireEvent.click(screen.getByRole('switch', { name: 'Zum Tagesplan von heute' }));
		await fireEvent.click(createButton());
		await vi.waitFor(() => expect(mocks.detail.createWithOptions).toHaveBeenCalledOnce());
		expect(mocks.detail.createWithOptions).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceItem: MAIL.id,
				recurrence: null,
				extras: expect.objectContaining({ sources: [NOTE.id], dayPlan: true })
			})
		);
		await vi.waitFor(() =>
			expect(mocks.inbox.markConverted).toHaveBeenCalledWith(MAIL.id, CREATED.id, CREATED.created)
		);
	});

	it('keeps the form with the refusal when the request fails, so nothing half is created', async () => {
		mocks.detail.createWithOptions.mockResolvedValueOnce({
			ok: false,
			message: null,
			fields: { pin: 'Erledigte Tickets lassen sich nicht anheften.' }
		});
		render(NewTicketPage);
		await fireEvent.input(titleField(), { target: { value: 'Neu' } });
		await openMore();
		await fireEvent.click(screen.getByRole('switch', { name: 'Anheften' }));
		await fireEvent.click(createButton());
		await vi.waitFor(() =>
			expect(screen.getByRole('switch', { name: 'Anheften' }).getAttribute('aria-invalid')).toBe(
				'true'
			)
		);
		expect(mocks.goto).not.toHaveBeenCalled();
		expect(mocks.rules.upsert).not.toHaveBeenCalled();
	});
});
