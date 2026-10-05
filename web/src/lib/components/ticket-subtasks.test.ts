// Section "Unteraufgaben" (ADR-0033 section 4) on a real list store with a fake data layer:
// list, progress, check mark, adding one after another with Enter, Escape and failures.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { DataError } from '$lib/data/errors';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import type { TicketDraft, TicketSummary } from '$lib/domain/ticket';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import TicketSubtasks from './TicketSubtasks.svelte';

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

async function setup(subtasks: TicketSummary[] = []) {
	const parent = ticket({ id: PARENT_ID, key: 'HAUS-12', title: 'Umzug' });
	const data = {
		listOpen: vi.fn(async () => [parent, ...subtasks.filter((entry) => entry.status !== 'done')]),
		listSubtasks: vi.fn(async () => subtasks),
		searchOpen: vi.fn(async () => []),
		setDone: vi.fn(async (id: string, isDone: boolean) => ({
			...(subtasks.find((entry) => entry.id === id) ?? parent),
			status: isDone ? ('done' as const) : ('open' as const),
			updated: '2026-09-24 10:00:00.000Z'
		})),
		update: vi.fn(async () => parent),
		create: vi.fn(async (draft: TicketDraft) =>
			ticket({ title: draft.title, parentId: draft.parent ?? null })
		)
	} satisfies TicketListData;
	const store = new TicketListStore(data, { ensureValid: () => true, logout: vi.fn() });
	store.activate(EMPTY_LIST_QUERY);
	await vi.waitFor(() => expect(store.openState).toBe('ready'));
	render(TicketSubtasks, {
		props: {
			ticket: parent,
			list: store,
			hrefOf: (id: string) => `/tickets/${id}?erledigte=1` as ResolvedPathname
		}
	});
	return { store, data, parent };
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
