// Row "Übergeordnet" (ADR-0033 section 4) on a real detail store with a fake data layer: the
// parent with "Ändern", "Lösen" and the switch "Blockiert das übergeordnete Ticket", choosing a
// parent inline with only allowed tickets, Escape, and the refusals of the hook.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { DataError } from '$lib/data/errors';
import type { TicketChoice } from '$lib/data/tickets';
import type { ParentRef, Ticket, TicketPatch, TicketSummary } from '$lib/domain/ticket';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from '$lib/stores/ticket-detail.svelte';
import TicketParentField from './TicketParentField.svelte';

const ID = 'abc123def456ghi';
const PARENT: ParentRef = { id: 'parent000000001', key: 'HAUS-12', title: 'Umzug' };

function ticket(overrides: Partial<Ticket> = {}): Ticket {
	return {
		id: ID,
		key: 'TASK-3',
		title: 'Kartons packen',
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
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

const CHOICES: TicketChoice[] = [
	{ id: ID, key: 'TASK-3', title: 'Kartons packen', status: 'open', parentId: null },
	{ id: 'parent000000001', key: 'HAUS-12', title: 'Umzug', status: 'open', parentId: null },
	{ id: 'other0000000001', key: 'HAUS-13', title: 'Umzug Keller', status: 'done', parentId: null },
	{ id: 'child0000000001', key: 'HAUS-14', title: 'Umzug Küche', status: 'open', parentId: 'x' }
];

async function setup(initial: Ticket, props: Record<string, unknown> = {}) {
	let current = initial;
	const data = {
		get: vi.fn(async () => current),
		update: vi.fn(async (_id: string, patch: TicketPatch): Promise<Ticket> => {
			current = {
				...current,
				...(patch.parent !== undefined && { parentId: patch.parent }),
				...(patch.blocksParent !== undefined && { blocksParent: patch.blocksParent }),
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
		completed: vi.fn(),
		remove: vi.fn(),
		announce: vi.fn()
	} satisfies TicketListSync;
	const store = new TicketDetailStore(data, { ensureValid: () => true, logout: vi.fn() }, list);
	store.open(ID);
	await vi.waitFor(() => expect(store.state).toBe('ready'));
	const search = vi.fn(async () => CHOICES);
	const result = render(TicketParentField, {
		props: {
			store,
			get ticket() {
				return store.ticket as Ticket;
			},
			parent: initial.parentId ? PARENT : null,
			parentHref: `/tickets/${PARENT.id}` as ResolvedPathname,
			search,
			...props
		}
	});
	return { ...result, store, data, list, search };
}

async function chooseParent(text: string) {
	const input = screen.getByRole('combobox');
	await fireEvent.input(input, { target: { value: text } });
	await vi.waitFor(() => expect(screen.getByRole('listbox').hidden).toBe(false));
	return input;
}

describe('row "Übergeordnet"', () => {
	it('names the parent with a link, "Ändern", "Lösen" and the switch', async () => {
		await setup(ticket({ parentId: PARENT.id, blocksParent: true }));

		const group = screen.getByRole('group', { name: 'Übergeordnet' });
		expect(within(group).getByRole('link', { name: 'HAUS-12' }).getAttribute('href')).toBe(
			`/tickets/${PARENT.id}`
		);
		expect(within(group).getByText('Umzug')).toBeTruthy();
		expect(
			within(group).getByRole('button', { name: 'Übergeordnetes Ticket ändern' })
		).toBeTruthy();
		expect(
			within(group).getByRole('button', { name: 'Aus übergeordnetem Ticket lösen' })
		).toBeTruthy();
		const toggle = within(group).getByRole('switch', {
			name: 'Blockiert das übergeordnete Ticket'
		}) as HTMLInputElement;
		expect(toggle.checked).toBe(true);
		expect(
			document.getElementById(toggle.getAttribute('aria-describedby') ?? '')?.textContent
		).toContain('fragt das Erledigen von HAUS-12 nach');
	});

	it('releases the sub-task and announces it', async () => {
		const { data, list } = await setup(ticket({ parentId: PARENT.id }));

		await fireEvent.click(screen.getByRole('button', { name: 'Aus übergeordnetem Ticket lösen' }));

		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(ID, { parent: null }));
		expect(list.announce).toHaveBeenCalledWith('TASK-3 ist keine Unteraufgabe mehr.');
	});

	it('saves the switch and puts it back when saving fails', async () => {
		const { data } = await setup(ticket({ parentId: PARENT.id, blocksParent: true }));
		const toggle = screen.getByRole('switch') as HTMLInputElement;

		await fireEvent.click(toggle);
		await vi.waitFor(() => expect(data.update).toHaveBeenCalledWith(ID, { blocksParent: false }));
		await tick();
		expect(toggle.checked).toBe(false);
		expect(
			document.getElementById(toggle.getAttribute('aria-describedby') ?? '')?.textContent
		).toContain('lässt sich erledigen');

		data.update.mockRejectedValueOnce(new DataError('network'));
		await fireEvent.click(toggle);
		await vi.waitFor(() => expect(screen.getByText(/Server nicht erreichbar/)).toBeTruthy());
		expect(toggle.checked).toBe(false);
		expect(toggle.getAttribute('aria-invalid')).toBe('true');
	});

	it('chooses a parent inline among tickets without a parent of their own', async () => {
		const { data, list, search } = await setup(ticket());

		await fireEvent.click(screen.getByRole('button', { name: 'Festlegen …' }));
		expect(document.activeElement).toBe(
			screen.getByRole('combobox', { name: 'Übergeordnetes Ticket' })
		);
		await chooseParent('Umzug');

		expect(search).toHaveBeenCalledWith('Umzug', expect.anything());
		const options = screen.getAllByRole('option').map((option) => option.textContent ?? '');
		expect(options.some((text) => text.includes('HAUS-12'))).toBe(true);
		expect(options.some((text) => text.includes('HAUS-13'))).toBe(true);
		expect(options.some((text) => text.includes('HAUS-14'))).toBe(false);
		expect(options.some((text) => text.includes('TASK-3'))).toBe(false);

		await fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
		await fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(ID, { parent: 'parent000000001' })
		);
		expect(list.announce).toHaveBeenCalledWith('TASK-3 ist jetzt eine Unteraufgabe von HAUS-12.');
		await vi.waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
	});

	it('asks for a choice before taking one', async () => {
		const { data } = await setup(ticket());
		await fireEvent.click(screen.getByRole('button', { name: 'Festlegen …' }));

		await fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

		expect(screen.getByText('Bitte ein Ticket wählen.')).toBeTruthy();
		expect(data.update).not.toHaveBeenCalled();
	});

	it('shows the refusal of the hook at the field', async () => {
		const { data } = await setup(ticket());
		data.update.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					parent: {
						code: 'validation_parent_nested',
						message: 'Das gewählte Ticket ist selbst eine Unteraufgabe (nur eine Ebene).'
					}
				}
			})
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Festlegen …' }));
		await chooseParent('Umzug');
		await fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

		await fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

		await vi.waitFor(() =>
			expect(
				screen.getByText('Das gewählte Ticket ist selbst eine Unteraufgabe (nur eine Ebene).')
			).toBeTruthy()
		);
		expect(screen.getByRole('combobox')).toBeTruthy();
	});

	it('ends choosing with Escape, consumes it and returns the focus', async () => {
		await setup(ticket());
		await fireEvent.click(screen.getByRole('button', { name: 'Festlegen …' }));

		const passedOn = await fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
		await tick();

		expect(passedOn).toBe(false);
		expect(screen.queryByRole('combobox')).toBeNull();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Festlegen …' }));
	});

	it('offers nothing to a ticket that has sub-tasks itself', async () => {
		await setup(ticket(), { subtaskCount: 2 });

		expect(screen.getByText('Keins – hat selbst Unteraufgaben')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Festlegen …' })).toBeNull();
	});
});
