import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import type { TemplateStatus, TemplateSubtask, TicketSubtask } from '$lib/domain/series-template';
import TemplateSubtaskListHarness from '$lib/test/TemplateSubtaskListHarness.svelte';

// The list "Unteraufgaben" of the template (plan WV-3, ADR-0022 addendum 10): rows with title and
// priority, added, removed and moved with named buttons (keyboard and screen reader, no dragging),
// a polite status of each step, at most 20 rows, and "Unteraufgaben dieses Tickets übernehmen"
// with the inline question "Ergänzen" or "Ersetzen". Since UT-1 a status per row once the server
// takes it, without an own choice the default ("Status beim Anlegen" or the status of the ticket).

const entry = (
	title: string,
	priority: TemplateSubtask['priority'] = 'medium'
): TemplateSubtask => ({
	title,
	priority
});

function setup(
	initial: TemplateSubtask[],
	props: {
		ticketSubtasks?: TicketSubtask[];
		invalidRows?: number[];
		error?: string | null;
		statusAvailable?: boolean;
		defaultStatus?: TemplateStatus;
		hint?: string;
	} = {}
) {
	render(TemplateSubtaskListHarness, { props: { initial, ...props } });
	const group = screen.getByRole('group', { name: 'Unteraufgaben' });
	const value = () =>
		JSON.parse(screen.getByTestId('value').textContent ?? '[]') as TemplateSubtask[];
	const titles = () => value().map((item) => item.title);
	const status = () => group.querySelector('[aria-live="polite"]')?.textContent ?? '';
	return { group, value, titles, status };
}

const child = (
	id: string,
	title: string,
	priority: TicketSubtask['priority'],
	created: string
) => ({
	id,
	title,
	priority,
	created
});

describe('TemplateSubtaskList', () => {
	it('adds a row with the focus on its title, edits title and priority and removes it', async () => {
		const { group, value, status } = setup([]);
		expect(within(group).getByText('Keine Unteraufgaben.')).toBeTruthy();
		expect(group.getAttribute('aria-describedby')).toBeTruthy();

		await fireEvent.click(within(group).getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		const title = within(group).getByLabelText<HTMLInputElement>('Titel der Unteraufgabe 1');
		await vi.waitFor(() => expect(document.activeElement).toBe(title));
		expect(title.required).toBe(true);
		expect(title.maxLength).toBe(200);
		await fireEvent.input(title, { target: { value: 'Entkalken' } });
		const priority = within(group).getByLabelText<HTMLSelectElement>(
			'Priorität der Unteraufgabe 1'
		);
		expect(priority.value).toBe('medium');
		await fireEvent.change(priority, { target: { value: 'high' } });
		expect(value()).toEqual([entry('Entkalken', 'high')]);

		await fireEvent.click(within(group).getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		await fireEvent.input(within(group).getByLabelText('Titel der Unteraufgabe 2'), {
			target: { value: 'Filter wechseln' }
		});
		const remove = within(group).getByRole('button', { name: '„Entkalken“ entfernen' });
		expect(remove.getAttribute('title')).toBe('Unteraufgabe entfernen');
		await fireEvent.click(remove);
		expect(value()).toEqual([entry('Filter wechseln')]);
		expect(status()).toBe('„Entkalken“ entfernt.');
		// The focus goes to the row that took its place, and to "hinzufügen" when none is left.
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(within(group).getByLabelText('Titel der Unteraufgabe 1'))
		);
		await fireEvent.click(
			within(group).getByRole('button', { name: '„Filter wechseln“ entfernen' })
		);
		expect(value()).toEqual([]);
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(
				within(group).getByRole('button', { name: 'Unteraufgabe hinzufügen' })
			)
		);
	});

	it('moves rows with named buttons, keeps the focus with the moved row and says where it went', async () => {
		const { group, titles, status } = setup([entry('A'), entry('B'), entry('C')]);
		const up = (name: string) =>
			within(group).getByRole('button', { name: `„${name}“ nach oben verschieben` });
		const down = (name: string) =>
			within(group).getByRole('button', { name: `„${name}“ nach unten verschieben` });
		// The first row cannot go up, the last not down; both stay reachable by keyboard.
		expect(up('A').getAttribute('aria-disabled')).toBe('true');
		expect(down('C').getAttribute('aria-disabled')).toBe('true');
		expect(up('A').getAttribute('title')).toBe('Nach oben verschieben');

		await fireEvent.click(down('A'));
		expect(titles()).toEqual(['B', 'A', 'C']);
		expect(status()).toBe('„A“ an Position 2 von 3 verschoben.');
		await vi.waitFor(() => expect(document.activeElement).toBe(down('A')));

		await fireEvent.click(down('A'));
		expect(titles()).toEqual(['B', 'C', 'A']);
		// At the end it cannot go further down: the focus moves to "nach oben" of the same row.
		await vi.waitFor(() => expect(document.activeElement).toBe(up('A')));

		await fireEvent.click(up('A'));
		await fireEvent.click(up('A'));
		expect(titles()).toEqual(['A', 'B', 'C']);
		expect(status()).toBe('„A“ an Position 1 von 3 verschoben.');
		await vi.waitFor(() => expect(document.activeElement).toBe(down('A')));
		// A locked button does nothing.
		await fireEvent.click(up('A'));
		expect(titles()).toEqual(['A', 'B', 'C']);
	});

	it('names a row without a title by its position', () => {
		const { group } = setup([entry('')]);
		expect(within(group).getByRole('button', { name: 'Unteraufgabe 1 entfernen' })).toBeTruthy();
	});

	it('allows at most 20 rows', async () => {
		const many = Array.from({ length: 19 }, (_value, index) => entry(`S${index + 1}`));
		const { group, value } = setup(many);
		const add = within(group).getByRole('button', { name: 'Unteraufgabe hinzufügen' });
		await fireEvent.click(add);
		expect(value()).toHaveLength(20);
		expect(add.getAttribute('aria-disabled')).toBe('true');
		expect(
			within(group).getByText(/Die Liste ist voll: höchstens 20 Unteraufgaben\./)
		).toBeTruthy();
		await fireEvent.click(add);
		expect(value()).toHaveLength(20);
	});

	it('marks a refused row until it has a title, and shows a refusal of the server', async () => {
		const { group } = setup([entry('A'), entry(' ')], {
			invalidRows: [1],
			error: 'Die Vorlage hat höchstens 20 Unteraufgaben.'
		});
		const second = within(group).getByLabelText('Titel der Unteraufgabe 2');
		expect(second.getAttribute('aria-invalid')).toBe('true');
		const describedBy = second.getAttribute('aria-describedby') ?? '';
		expect(document.getElementById(describedBy)?.textContent).toContain(
			'Bitte einen Titel eingeben.'
		);
		expect(
			within(group).getByLabelText('Titel der Unteraufgabe 1').getAttribute('aria-invalid')
		).toBeNull();
		expect(within(group).getByText('Die Vorlage hat höchstens 20 Unteraufgaben.')).toBeTruthy();
		await fireEvent.input(second, { target: { value: 'B' } });
		expect(second.getAttribute('aria-invalid')).toBeNull();
	});

	it('takes the sub-tasks of the ticket into an empty list at once, in the order they were made', async () => {
		const ticketSubtasks = [
			child('ticket000000012', 'Filter wechseln', 'medium', '2026-09-02 10:00:00.000Z'),
			child('ticket000000011', 'Entkalken', 'high', '2026-09-01 10:00:00.000Z')
		];
		const { group, value, status } = setup([], { ticketSubtasks });
		const take = within(group).getByRole('button', {
			name: 'Unteraufgaben dieses Tickets übernehmen'
		});
		// Nothing to lose: no question, so the button unfolds nothing.
		expect(take.getAttribute('aria-expanded')).toBeNull();
		await fireEvent.click(take);
		expect(value()).toEqual([entry('Entkalken', 'high'), entry('Filter wechseln')]);
		expect(status()).toBe('2 Unteraufgaben übernommen.');
	});

	it('asks inline whether to add or replace when the list has rows; Escape closes only the question', async () => {
		const ticketSubtasks = [
			child('ticket000000011', 'Entkalken', 'high', '2026-09-01 10:00:00.000Z'),
			child('ticket000000012', 'filter wechseln', 'low', '2026-09-02 10:00:00.000Z')
		];
		const { group, value, titles, status } = setup([entry('Filter wechseln')], { ticketSubtasks });
		const take = within(group).getByRole('button', {
			name: 'Unteraufgaben dieses Tickets übernehmen'
		});
		expect(take.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(take);
		expect(take.getAttribute('aria-expanded')).toBe('true');
		// No dialog: a group in the list with the question and its buttons.
		expect(screen.queryByRole('dialog')).toBeNull();
		const question = within(group).getByRole('group', {
			name: 'Die Vorlage hat schon 1 Unteraufgabe. Sollen die 2 Unteraufgaben dieses Tickets dazukommen oder sie ersetzen?'
		});
		expect(take.getAttribute('aria-controls')).toBe(question.id);
		const append = within(question).getByRole('button', { name: 'Ergänzen' });
		await vi.waitFor(() => expect(document.activeElement).toBe(append));

		// Escape closes the question and is used up (the editor around it stays open).
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		append.dispatchEvent(escape);
		await tick();
		expect(escape.defaultPrevented).toBe(true);
		expect(within(group).queryByRole('group', { name: /Die Vorlage hat schon/ })).toBeNull();
		await vi.waitFor(() => expect(document.activeElement).toBe(take));
		expect(titles()).toEqual(['Filter wechseln']);

		// "Ergänzen": only what the list does not have yet (same title).
		await fireEvent.click(take);
		await fireEvent.click(within(group).getByRole('button', { name: 'Ergänzen' }));
		expect(value()).toEqual([entry('Filter wechseln'), entry('Entkalken', 'high')]);
		expect(status()).toBe('1 Unteraufgabe übernommen. 1 stand schon in der Liste.');
		await vi.waitFor(() => expect(document.activeElement).toBe(take));

		// "Ersetzen": the sub-tasks of the ticket instead of the list.
		await fireEvent.click(take);
		await fireEvent.click(within(group).getByRole('button', { name: 'Ersetzen' }));
		expect(value()).toEqual([entry('Entkalken', 'high'), entry('filter wechseln', 'low')]);
		// "Abbrechen" changes nothing.
		await fireEvent.click(take);
		await fireEvent.click(within(group).getByRole('button', { name: 'Abbrechen' }));
		expect(titles()).toEqual(['Entkalken', 'filter wechseln']);
	});

	it('offers no take-over without sub-tasks of a ticket (rule panel)', () => {
		const { group } = setup([entry('A')]);
		expect(
			within(group).queryByRole('button', { name: 'Unteraufgaben dieses Tickets übernehmen' })
		).toBeNull();
	});
});

describe('the status of each row (UT-1)', () => {
	const statusOf = (group: HTMLElement, row: number) =>
		within(group).getByLabelText<HTMLSelectElement>(`Status der Unteraufgabe ${row}`);

	it('offers no status before the server takes it, and says what the old hooks do', () => {
		const { group } = setup([entry('A')]);
		expect(within(group).queryByLabelText('Status der Unteraufgabe 1')).toBeNull();
		expect(
			within(group).getByText(
				'Jedes neue Ticket der Serie bekommt sie als offene Unteraufgaben ohne Fälligkeit, höchstens 20.'
			)
		).toBeTruthy();
	});

	it('shows the default for a row without an own status and keeps a chosen one', async () => {
		const { group, value } = setup([entry('A'), { ...entry('B'), status: 'backlog' }], {
			statusAvailable: true,
			defaultStatus: 'waiting'
		});
		expect(
			within(group).getByText(
				'Jedes neue Ticket der Serie bekommt sie als Unteraufgaben mit seiner Fälligkeit, Art und Zuständigkeit, höchstens 20. Ohne eigene Wahl starten sie mit dem „Status beim Anlegen“.'
			)
		).toBeTruthy();
		expect(statusOf(group, 1).value).toBe('waiting');
		expect(statusOf(group, 2).value).toBe('backlog');
		// Every status but "Erledigt".
		expect([...statusOf(group, 1).options].map((option) => option.value)).toEqual([
			'backlog',
			'open',
			'in_progress',
			'waiting'
		]);

		await fireEvent.change(statusOf(group, 1), { target: { value: 'in_progress' } });
		expect(value()).toEqual([
			{ ...entry('A'), status: 'in_progress' },
			{ ...entry('B'), status: 'backlog' }
		]);
		// The default again means "follow it": the row has no own status any more.
		await fireEvent.change(statusOf(group, 2), { target: { value: 'waiting' } });
		expect(value()).toEqual([{ ...entry('A'), status: 'in_progress' }, entry('B')]);
	});

	it('gives a new row no own status and keeps the status when moving and editing the title', async () => {
		const { group, value } = setup([{ ...entry('A'), status: 'backlog' }, entry('B')], {
			statusAvailable: true
		});
		await fireEvent.click(within(group).getByRole('button', { name: 'Unteraufgabe hinzufügen' }));
		expect(value()[2]).toEqual({ title: '', priority: 'medium' });
		expect(statusOf(group, 3).value).toBe('open');

		await fireEvent.click(
			within(group).getByRole('button', { name: '„A“ nach unten verschieben' })
		);
		await tick();
		expect(value().map((item) => item.status)).toEqual([undefined, 'backlog', undefined]);
		await fireEvent.input(within(group).getByLabelText('Titel der Unteraufgabe 2'), {
			target: { value: 'A neu' }
		});
		expect(value()[1]).toEqual({ ...entry('A neu'), status: 'backlog' });
	});
});
