// "Zuständigkeit" in the dialog of a rule (E7-5, ADR-0068 §5): "Keine", "Fest" (one person) or
// "Abwechselnd" (an ordered list, added, moved and removed with named buttons), the preview of the
// next two occurrences, the check before sending and the values the dialog hands on. Only in a
// household and only when the server knows the fields.

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formAssignmentOf } from '$lib/domain/assignee';
import { defaultFormValues, type RecurrenceFormValues } from '$lib/domain/recurrence-rule';
import { fixedAssignees } from '$lib/stores/assignees.svelte';
import type { EditResult } from '$lib/stores/catalog-editor';
import AssigneeContextHarness from '$lib/test/AssigneeContextHarness.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';
import RecurrenceDialog from './RecurrenceDialog.svelte';

const TODAY = '2026-10-05';
const SELF = 'anna00000000001';
const BERT = 'bert00000000002';
const MEMBERS = [
	{ id: SELF, name: 'Anna Beispiel', self: true },
	{ id: BERT, name: 'Bert Beispiel', self: false }
];

useOverlayStubs();

afterEach(() => {
	document.body.innerHTML = '';
});

function renderDialog({
	initial = defaultFormValues('2026-10-07', TODAY),
	available = true,
	active = true
}: { initial?: RecurrenceFormValues; available?: boolean; active?: boolean } = {}) {
	const onsave = vi.fn<(values: RecurrenceFormValues) => Promise<EditResult<unknown>>>(
		async () => ({ ok: true, value: null })
	);
	const onclose = vi.fn();
	render(AssigneeContextHarness, {
		props: {
			assignees: fixedAssignees(MEMBERS, SELF, active),
			component: RecurrenceDialog as never,
			props: {
				heading: 'Wiederholen…',
				initial,
				today: TODAY,
				submitLabel: 'Wiederholung anlegen',
				assignmentAvailable: available,
				onsave,
				onclose
			}
		}
	});
	return { onsave, onclose };
}

function section() {
	return screen.getByRole('group', { name: 'Zuständigkeit' });
}

function preview() {
	return section().querySelector('.preview')?.textContent ?? '';
}

async function add(name: string) {
	const select = within(section()).getByLabelText<HTMLSelectElement>('Person hinzufügen');
	const option = within(select)
		.getAllByRole<HTMLOptionElement>('option')
		.find((entry) => entry.textContent?.startsWith(name));
	await fireEvent.change(select, { target: { value: option?.value } });
	await fireEvent.click(within(section()).getByRole('button', { name: 'Hinzufügen' }));
	await tick();
}

describe('"Zuständigkeit" of a rule (ADR-0068 §5)', () => {
	it('starts with "Keine" and offers "Fest" and "Abwechselnd"', () => {
		renderDialog();
		const modes = within(section()).getAllByRole<HTMLInputElement>('radio');
		expect(modes.map((radio) => radio.closest('label')?.textContent?.trim())).toEqual([
			'Keine',
			'Fest',
			'Abwechselnd'
		]);
		expect(modes[0]?.checked).toBe(true);
		expect(preview()).toBe('');
	});

	it('builds a rotation, previews the next two occurrences and hands the order on', async () => {
		const { onsave } = renderDialog();
		await fireEvent.click(within(section()).getByRole('radio', { name: 'Abwechselnd' }));
		expect(within(section()).getByText('Noch niemand in der Reihenfolge.')).toBeTruthy();

		await add('Bert');
		await add('Anna');
		expect(preview()).toBe('Nächstes Vorkommen: Bert Beispiel, danach: Anna Beispiel');
		const list = within(section()).getByRole('list', { name: 'Zuständigkeit' });
		expect(
			within(list)
				.getAllByRole('listitem')
				.map((row) => row.textContent?.trim())
		).toEqual(['1. Bert Beispiel', '2. Anna Beispiel']);

		await fireEvent.click(
			within(section()).getByRole('button', { name: 'Anna Beispiel nach oben verschieben' })
		);
		await tick();
		expect(preview()).toBe('Nächstes Vorkommen: Anna Beispiel, danach: Bert Beispiel');
		expect(section().querySelector('[aria-live="polite"]')?.textContent).toBe(
			'Anna Beispiel an Position 1 von 2 verschoben.'
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholung anlegen' }));
		await vi.waitFor(() => expect(onsave).toHaveBeenCalledTimes(1));
		expect(onsave.mock.calls[0]?.[0].assignment).toEqual({
			mode: 'rotate',
			assignees: [SELF, BERT]
		});
	});

	it('takes one person for "Fest", the own account first', async () => {
		const { onsave } = renderDialog();
		await fireEvent.click(within(section()).getByRole('radio', { name: 'Fest' }));
		const person = within(section()).getByLabelText<HTMLSelectElement>('Person');
		expect(person.value).toBe(SELF);
		expect(preview()).toBe('Jedes Vorkommen: Anna Beispiel');

		await fireEvent.change(person, { target: { value: BERT } });
		expect(preview()).toBe('Jedes Vorkommen: Bert Beispiel');
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholung anlegen' }));
		await vi.waitFor(() => expect(onsave).toHaveBeenCalledTimes(1));
		expect(onsave.mock.calls[0]?.[0].assignment).toMatchObject({ mode: 'fixed' });
		expect(onsave.mock.calls[0]?.[0].assignment?.assignees[0]).toBe(BERT);
	});

	it('refuses "Abwechselnd" without anyone before sending', async () => {
		const { onsave } = renderDialog();
		await fireEvent.click(within(section()).getByRole('radio', { name: 'Abwechselnd' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholung anlegen' }));
		await tick();

		expect(onsave).not.toHaveBeenCalled();
		expect(within(section()).getByText('Bitte mindestens eine Person wählen.')).toBeTruthy();
	});

	it('removes a person with a named button', async () => {
		renderDialog();
		await fireEvent.click(within(section()).getByRole('radio', { name: 'Abwechselnd' }));
		await add('Anna');
		await add('Bert');

		await fireEvent.click(
			within(section()).getByRole('button', { name: 'Anna Beispiel entfernen' })
		);
		await tick();

		expect(preview()).toBe('Jedes Vorkommen: Bert Beispiel');
		expect(section().querySelector('[aria-live="polite"]')?.textContent).toBe(
			'Anna Beispiel entfernt.'
		);
	});

	it('shows a stored rotation from the person of the next occurrence', () => {
		// Bert is next (pointer 1), so the dialog shows him first.
		const initial: RecurrenceFormValues = {
			...defaultFormValues('2026-10-07', TODAY),
			assignment: formAssignmentOf({ mode: 'rotate', assignees: [SELF, BERT], next: 1 })
		};
		renderDialog({ initial });

		expect(
			within(section()).getByRole<HTMLInputElement>('radio', { name: 'Abwechselnd' }).checked
		).toBe(true);
		expect(preview()).toBe('Nächstes Vorkommen: Bert Beispiel, danach: Anna Beispiel');
	});

	it.each([
		['before the migration', { available: false }],
		['in the private area', { active: false }]
	])('is not offered %s', (_case, options) => {
		renderDialog(options);
		expect(screen.queryByRole('group', { name: 'Zuständigkeit' })).toBeNull();
	});
});
