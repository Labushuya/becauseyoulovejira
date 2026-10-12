// Section "Unteraufgaben" (ADR-0033 section 4) on a real list store with a fake data layer:
// list, progress, check mark, adding one after another with Enter, Escape and failures; since UT-1
// the status menu of each sub-task (the one of the table, "Erledigt" with "Rückgängig") and the
// form with status and due date taken from the ticket in advance.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { DataError } from '$lib/data/errors';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import type { TicketDraft, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import { FlagStore } from '$lib/stores/flags.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import TicketSubtasks from './TicketSubtasks.svelte';

useOverlayStubs();

const PARENT_ID = 'parent000000001';
let sequence = 0;

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `TASK-${sequence}`,
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

async function setup(subtasks: TicketSummary[] = [], parentOverrides: Partial<TicketSummary> = {}) {
	const parent = ticket({ id: PARENT_ID, key: 'HAUS-12', title: 'Umzug', ...parentOverrides });
	const data = {
		listOpen: vi.fn(async () => [parent, ...subtasks.filter((entry) => entry.status !== 'done')]),
		listSubtasks: vi.fn(async () => subtasks),
		searchOpen: vi.fn(async () => []),
		setDone: vi.fn(async (id: string, isDone: boolean) => ({
			...(subtasks.find((entry) => entry.id === id) ?? parent),
			status: isDone ? ('done' as const) : ('open' as const),
			updated: '2026-09-24 10:00:00.000Z'
		})),
		update: vi.fn(async (id: string, patch: TicketPatch): Promise<TicketSummary> => ({
			...(subtasks.find((entry) => entry.id === id) ?? parent),
			...(patch.status !== undefined && { status: patch.status }),
			updated: '2026-09-25 10:00:00.000Z'
		})),
		create: vi.fn(async (draft: TicketDraft) =>
			ticket({
				title: draft.title,
				parentId: draft.parent ?? null,
				status: draft.status,
				due: draft.due
			})
		)
	} satisfies TicketListData;
	const flags = new FlagStore();
	const store = new TicketListStore(data, { ensureValid: () => true, logout: vi.fn() }, { flags });
	store.activate(EMPTY_LIST_QUERY);
	await vi.waitFor(() => expect(store.openState).toBe('ready'));
	render(TicketSubtasks, {
		props: {
			ticket: parent,
			list: store,
			hrefOf: (id: string) => `/tickets/${id}?erledigte=1` as ResolvedPathname
		}
	});
	return { store, data, parent, flags };
}

/** Opens the status menu of a sub-task like a click would. */
async function openStatus(key: string) {
	const button = screen.getByRole('button', { name: new RegExp(`^Status von ${key}: `) });
	await fireEvent.pointerEnter(button);
	await fireEvent.click(button);
	await tick();
	return button;
}

/** Opens the form "Unteraufgabe hinzufügen". */
async function openForm() {
	await fireEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
	return {
		title: screen.getByRole('textbox', { name: 'Titel der Unteraufgabe' }) as HTMLInputElement,
		status: screen.getByRole('combobox', { name: 'Status' }) as HTMLSelectElement,
		due: screen.getByLabelText<HTMLInputElement>('Fälligkeit', { selector: 'input' })
	};
}

const section = () => screen.getByRole('region', { name: 'Unteraufgaben' });

describe('section "Unteraufgaben"', () => {
	it('lists the sub-tasks with check mark, key, title and status, open ones first, and the progress', async () => {
		const done = ticket({ parentId: PARENT_ID, status: 'done', title: 'Kartons kaufen' });
		const open = ticket({ parentId: PARENT_ID, title: 'Küche packen' });
		const waiting = ticket({ parentId: PARENT_ID, status: 'waiting', title: 'Umzugsfirma' });
		await setup([done, open, waiting]);

		const items = within(section()).getAllByRole('listitem');
		expect(items.map((item) => within(item).getByRole('link').textContent)).toEqual([
			'Küche packen',
			'Umzugsfirma',
			'Kartons kaufen'
		]);
		expect(
			within(items[0] as HTMLElement)
				.getByRole('link')
				.getAttribute('href')
		).toBe(`/tickets/${open.id}?erledigte=1`);
		expect(within(items[0] as HTMLElement).getByText(open.key)).toBeTruthy();
		expect(within(items[1] as HTMLElement).getByText('Wartet')).toBeTruthy();
		const check = within(items[2] as HTMLElement).getByRole('checkbox', {
			name: `${done.key} erledigt`
		}) as HTMLInputElement;
		expect(check.checked).toBe(true);
		expect(within(section()).getByText('1 von 3 Unteraufgaben erledigt')).toBeTruthy();
		expect(within(section()).getByText('1/3 erledigt').getAttribute('aria-hidden')).toBe('true');
	});

	it('says when there are none', async () => {
		await setup();

		expect(within(section()).getByText('Keine Unteraufgaben.')).toBeTruthy();
		expect(within(section()).queryByRole('list')).toBeNull();
	});

	it('checks a sub-task through the list', async () => {
		const open = ticket({ parentId: PARENT_ID });
		const { data } = await setup([open]);

		await fireEvent.click(screen.getByRole('checkbox', { name: `${open.key} erledigt` }));

		expect(data.setDone).toHaveBeenCalledWith(open.id, true);
		await vi.waitFor(() =>
			expect(within(section()).getByText('1 von 1 Unteraufgabe erledigt')).toBeTruthy()
		);
	});

	it('adds sub-tasks one after another with Enter and keeps the field open', async () => {
		const { data } = await setup();

		await fireEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		const input = screen.getByRole('textbox', {
			name: 'Titel der Unteraufgabe'
		}) as HTMLInputElement;
		expect(document.activeElement).toBe(input);
		expect(input.getAttribute('aria-describedby')).toBeTruthy();

		await fireEvent.input(input, { target: { value: 'Kartons packen' } });
		await fireEvent.submit(input.form as HTMLFormElement);
		await vi.waitFor(() => expect(input.value).toBe(''));
		expect(data.create).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'Kartons packen', parent: PARENT_ID })
		);
		expect(document.activeElement).toBe(input);
		expect(within(section()).getByRole('link', { name: 'Kartons packen' })).toBeTruthy();
		expect(screen.getByText(/angelegt\.$/)).toBeTruthy();

		await fireEvent.input(input, { target: { value: 'Küche' } });
		await fireEvent.submit(input.form as HTMLFormElement);
		await vi.waitFor(() => expect(data.create).toHaveBeenCalledTimes(2));
		expect(within(section()).getByText('0 von 2 Unteraufgaben erledigt')).toBeTruthy();
	});

	it('sends nothing for an empty title', async () => {
		const { data } = await setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }));

		await fireEvent.submit(screen.getByRole('textbox').closest('form') as HTMLFormElement);

		expect(data.create).not.toHaveBeenCalled();
	});

	it('closes the field with Escape, consumes it and returns the focus', async () => {
		await setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		const input = screen.getByRole('textbox');
		await fireEvent.input(input, { target: { value: 'halb getippt' } });
		const outer = vi.fn();
		document.addEventListener('keydown', outer);

		const passedOn = await fireEvent.keyDown(input, { key: 'Escape' });
		await tick();

		document.removeEventListener('keydown', outer);
		expect(passedOn).toBe(false);
		expect(outer).not.toHaveBeenCalled();
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' })
		);
	});

	it('shows why a sub-task could not be added and keeps the text', async () => {
		const { data } = await setup();
		data.create.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					project: { code: 'validation_project_archived', message: 'Das Projekt ist archiviert.' }
				}
			})
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		const input = screen.getByRole('textbox') as HTMLInputElement;

		await fireEvent.input(input, { target: { value: 'Kartons' } });
		await fireEvent.submit(input.form as HTMLFormElement);

		await vi.waitFor(() => expect(screen.getByText('Das Projekt ist archiviert.')).toBeTruthy());
		expect(input.value).toBe('Kartons');
		expect(input.getAttribute('aria-invalid')).toBe('true');
	});
});

describe('the status of a sub-task in the section (UT-1)', () => {
	it('is the menu of the table: every status, the current one checked, a choice saves at once', async () => {
		const child = ticket({ parentId: PARENT_ID, title: 'Küche packen' });
		const { data, store } = await setup([child]);

		// The pill stays visible as the value of the button; the check mark stays beside it.
		const button = await openStatus(child.key);
		expect(button.getAttribute('aria-label')).toBe(`Status von ${child.key}: Offen, ändern`);
		expect(within(button).getByText('Offen')).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: `${child.key} erledigt` })).toBeTruthy();
		const choices = screen.getAllByRole('menuitemradio', { hidden: true });
		expect(choices.map((choice) => choice.textContent?.replace('✓', '').trim())).toEqual([
			'Backlog',
			'Offen',
			'In Arbeit',
			'Wartet',
			'Erledigt'
		]);
		expect(choices.map((choice) => choice.getAttribute('aria-checked'))).toEqual([
			'false',
			'true',
			'false',
			'false',
			'false'
		]);

		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: /Wartet/ }));

		await vi.waitFor(() => expect(store.find(child.id)?.status).toBe('waiting'));
		expect(data.update).toHaveBeenCalledExactlyOnceWith(child.id, { status: 'waiting' });
		expect(document.activeElement).toBe(button);
		expect(
			screen.getByRole('button', { name: `Status von ${child.key}: Wartet, ändern` })
		).toBeTruthy();
	});

	it('completes through the check mark path with "Rückgängig", and choosing the same saves nothing', async () => {
		const child = ticket({ parentId: PARENT_ID, status: 'in_progress', title: 'Bad' });
		const { data, flags } = await setup([child]);

		await openStatus(child.key);
		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: /In Arbeit/ }));
		await tick();
		expect(data.update).not.toHaveBeenCalled();

		await openStatus(child.key);
		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: /Erledigt/ }));

		await vi.waitFor(() => expect(data.setDone).toHaveBeenCalledWith(child.id, true));
		const flag = await vi.waitFor(() => {
			const shown = flags.flags.find((entry) => entry.title === `${child.key} erledigt.`);
			expect(shown?.action?.label).toBe('Rückgängig');
			return shown;
		});
		flags.act(flag?.id ?? '');
		// "Rückgängig" restores the status before, not just "Offen".
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(child.id, { status: 'in_progress' })
		);
	});

	it('shows a done sub-task in the menu as "Erledigt" and reopens it with another status', async () => {
		const child = ticket({ parentId: PARENT_ID, status: 'done', title: 'Kartons' });
		const { data } = await setup([child]);

		await openStatus(child.key);
		const done = screen.getByRole('menuitemradio', { hidden: true, name: /Erledigt/ });
		expect(done.getAttribute('aria-checked')).toBe('true');
		await fireEvent.click(screen.getByRole('menuitemradio', { hidden: true, name: /Backlog/ }));

		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledExactlyOnceWith(child.id, { status: 'backlog' })
		);
	});
});

describe('adding a sub-task with status and due date (UT-1)', () => {
	it('offers every status but "Erledigt", the one of the ticket in advance, and its due date', async () => {
		await setup([], { status: 'waiting', due: '2026-10-20' });

		const form = await openForm();
		expect([...form.status.options].map((option) => option.textContent)).toEqual([
			'Backlog',
			'Offen',
			'In Arbeit',
			'Wartet'
		]);
		expect(form.status.value).toBe('waiting');
		expect(form.due.value).toBe('2026-10-20');
		expect(screen.getByText(/Status und Fälligkeit sind nach dem Ticket vorbelegt/)).toBeTruthy();
	});

	it('starts with "Offen" under a done ticket and without a due date when the ticket has none', async () => {
		await setup([], { status: 'done', due: null });

		const form = await openForm();
		expect(form.status.value).toBe('open');
		expect(form.due.value).toBe('');
	});

	it('creates with the chosen status and due date, a cleared date as none, and keeps the choices', async () => {
		const { data } = await setup([], { status: 'in_progress', due: '2026-10-20' });
		const form = await openForm();

		await fireEvent.input(form.title, { target: { value: 'Bad putzen' } });
		await fireEvent.submit(form.title.form as HTMLFormElement);
		await vi.waitFor(() => expect(data.create).toHaveBeenCalledTimes(1));
		expect(data.create).toHaveBeenLastCalledWith(
			expect.objectContaining({ title: 'Bad putzen', status: 'in_progress', due: '2026-10-20' })
		);

		await fireEvent.change(form.status, { target: { value: 'backlog' } });
		await fireEvent.input(form.due, { target: { value: '' } });
		await fireEvent.input(form.title, { target: { value: 'Keller' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
		await vi.waitFor(() => expect(data.create).toHaveBeenCalledTimes(2));
		expect(data.create).toHaveBeenLastCalledWith(
			expect.objectContaining({ title: 'Keller', status: 'backlog', due: null })
		);
		// The form stays for the next one, with the choices made.
		expect(form.status.value).toBe('backlog');
		expect(form.due.value).toBe('');
	});

	it('takes the kind and the assignee of the ticket without asking, and says so', async () => {
		const { data } = await setup([], { kind: 'ongoing', assignee: 'user00000000002' });
		const form = await openForm();
		expect(
			screen.getByText(/Projekt, Tags, Art und Zuständigkeit übernimmt sie vom Ticket/)
		).toBeTruthy();

		await fireEvent.input(form.title, { target: { value: 'Teil' } });
		await fireEvent.submit(form.title.form as HTMLFormElement);

		await vi.waitFor(() =>
			expect(data.create).toHaveBeenCalledWith(
				expect.objectContaining({ kind: 'ongoing', assignee: 'user00000000002' })
			)
		);
	});

	it('closes with Escape from the status and the date as well, and with "Schließen"', async () => {
		await setup();
		let form = await openForm();
		await fireEvent.keyDown(form.status, { key: 'Escape' });
		await tick();
		expect(screen.queryByRole('textbox')).toBeNull();

		form = await openForm();
		await fireEvent.keyDown(form.due, { key: 'Escape' });
		await tick();
		expect(screen.queryByRole('textbox')).toBeNull();

		await openForm();
		await fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
		await tick();
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Unteraufgabe hinzufügen' })
		);
	});
});
