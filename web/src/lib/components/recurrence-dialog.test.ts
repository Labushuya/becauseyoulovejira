import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { defaultFormValues, type RecurrenceFormValues } from '$lib/domain/recurrence-rule';
import type { EditResult } from '$lib/stores/catalog-editor';
import RecurrenceDialog from './RecurrenceDialog.svelte';
import { useOverlayStubs } from '$lib/test/overlay-stubs';

// "Wiederholen…" as a modal dialog (E5 plan, package 4): focus, preview that follows every
// change, checks before sending, field errors of the server at their field, other refusals as a
// message, Escape. jsdom has no showModal()/close(); the test adds a minimal stand-in.

const TODAY = '2026-09-25';

useOverlayStubs();

function renderDialog(
	onsave: (values: RecurrenceFormValues) => Promise<EditResult<unknown>> = async () => ({
		ok: true,
		value: null
	}),
	initial = defaultFormValues('2026-09-28', TODAY)
) {
	const onclose = vi.fn();
	const save = vi.fn(onsave);
	render(RecurrenceDialog, {
		props: {
			heading: 'Wiederholen…',
			initial,
			today: TODAY,
			submitLabel: 'Wiederholung anlegen',
			onsave: save,
			onclose
		}
	});
	return { onclose, save, dialog: screen.getByRole('dialog', { name: 'Wiederholen…' }) };
}

describe('RecurrenceDialog', () => {
	it('opens with the focus on the kind and follows every change in the preview', async () => {
		renderDialog();
		await tick();
		expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Fester Rhythmus' }));
		const dues = () =>
			[...document.querySelectorAll<HTMLElement>('.preview li')].map((row) => row.dataset.due);
		expect(dues()).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);

		await fireEvent.click(screen.getByRole('checkbox', { name: 'Donnerstag' }));
		expect(dues()).toEqual(['2026-09-28', '2026-10-01', '2026-10-05']);

		await fireEvent.input(screen.getByLabelText('Alle'), { target: { value: '2' } });
		expect(dues()).toEqual(['2026-09-28', '2026-10-01', '2026-10-12']);

		await fireEvent.change(screen.getByLabelText('Einheit'), { target: { value: 'monthly' } });
		expect(screen.queryByRole('group', { name: 'Wochentage' })).toBeNull();
		expect(screen.getByLabelText<HTMLInputElement>('Tag im Monat').value).toBe('28');
	});

	it('checks the input before sending and moves the focus to the first error', async () => {
		const { save } = renderDialog();
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Montag' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholung anlegen' }));
		await tick();

		expect(save).not.toHaveBeenCalled();
		expect(screen.getByText('Bitte mindestens einen Wochentag wählen.')).toBeTruthy();
		expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
	});

	it('sends the values and closes after saving', async () => {
		const { save, onclose } = renderDialog();
		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholung anlegen' }));
		await vi.waitFor(() => expect(onclose).toHaveBeenCalledTimes(1));
		expect(save.mock.calls[0]?.[0]).toMatchObject({
			mode: 'calendar',
			freq: 'weekly',
			weekdays: ['MO']
		});
	});

	it('shows field errors of the server at their field and other refusals as a message', async () => {
		const results: EditResult<unknown>[] = [
			{
				ok: false,
				message: null,
				fields: { lead_days: 'Der Vorlauf muss zwischen 0 und 30 Tagen liegen.' }
			},
			{ ok: false, message: null, fields: { ticket: 'Das Ticket gehört schon zu einer Serie.' } }
		];
		const { onclose, dialog } = renderDialog(
			async () => results.shift() ?? { ok: true, value: null }
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholung anlegen' }));
		await vi.waitFor(() =>
			expect(screen.getByLabelText('Vorlauf (Tage)').getAttribute('aria-invalid')).toBe('true')
		);
		expect(screen.getByText('Der Vorlauf muss zwischen 0 und 30 Tagen liegen.')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Wiederholung anlegen' }));
		const alert = await within(dialog).findByRole('alert');
		expect(alert.textContent).toContain('Das Ticket gehört schon zu einer Serie.');
		expect(onclose).not.toHaveBeenCalled();
	});

	it('closes with Escape and "Abbrechen" without saving', async () => {
		const { save, onclose, dialog } = renderDialog();
		await fireEvent(dialog, new Event('cancel', { cancelable: true }));
		await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
		expect(onclose).toHaveBeenCalledTimes(2);
		expect(save).not.toHaveBeenCalled();
	});
});
