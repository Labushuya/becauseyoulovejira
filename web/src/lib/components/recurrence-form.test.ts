import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { defaultFormValues, type RecurrenceFormValues } from '$lib/domain/recurrence-rule';
import RecurrenceFormHarness from '$lib/test/RecurrenceFormHarness.svelte';
import RecurrenceForm from './RecurrenceForm.svelte';

// Fields of a rhythm (E5 plan, package 4): groups and labels, the fields per kind and rhythm,
// field errors with aria-invalid and aria-describedby, and the preview. Typing and saving are
// covered with the dialog (recurrence-dialog.test.ts), which owns the values.

const TODAY = '2026-09-25';

function values(overrides: Partial<RecurrenceFormValues> = {}): RecurrenceFormValues {
	return { ...defaultFormValues('2026-09-28', TODAY), ...overrides };
}

describe('RecurrenceForm', () => {
	it('offers a weekly rhythm on the weekday of the due date with the next three dates', () => {
		render(RecurrenceForm, { props: { values: values(), today: TODAY } });

		const kind = screen.getByRole('group', { name: 'Art der Wiederholung' });
		expect(
			within(kind).getByRole<HTMLInputElement>('radio', { name: 'Fester Rhythmus' }).checked
		).toBe(true);
		expect(
			within(kind).getByRole<HTMLInputElement>('radio', { name: 'Nach Erledigung' }).checked
		).toBe(false);
		expect(screen.getByLabelText<HTMLInputElement>('Alle').value).toBe('1');
		expect(screen.getByLabelText<HTMLSelectElement>('Einheit').value).toBe('weekly');
		const days = screen.getByRole('group', { name: 'Wochentage' });
		const boxes = within(days).getAllByRole<HTMLInputElement>('checkbox');
		expect(boxes).toHaveLength(7);
		expect(within(days).getByRole<HTMLInputElement>('checkbox', { name: 'Montag' }).checked).toBe(
			true
		);
		expect(within(days).getByRole<HTMLInputElement>('checkbox', { name: 'Dienstag' }).checked).toBe(
			false
		);
		expect(screen.getByLabelText<HTMLInputElement>('Beginnt am').value).toBe('2026-09-28');
		const lead = screen.getByLabelText<HTMLInputElement>('Vorlauf (Tage)');
		expect(lead.value).toBe('3');
		expect(lead.getAttribute('aria-describedby')).toBeTruthy();
		expect(screen.getByText('Nächste Termine: 28.09.2026, 05.10.2026, 12.10.2026')).toBeTruthy();
		expect(screen.queryByLabelText('Tag im Monat')).toBeNull();
	});

	it('shows the day of the month with "Letzter Tag" and the note about short months', () => {
		render(RecurrenceForm, {
			props: { values: values({ freq: 'monthly', monthDay: '31' }), today: TODAY }
		});

		expect(screen.getByLabelText<HTMLInputElement>('Tag im Monat').value).toBe('31');
		expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Letzter Tag' }).checked).toBe(
			false
		);
		expect(screen.getByText('In kürzeren Monaten am letzten Tag.')).toBeTruthy();
		expect(screen.queryByRole('group', { name: 'Wochentage' })).toBeNull();
		expect(screen.getByText('Nächste Termine: 30.09.2026, 31.10.2026, 30.11.2026')).toBeTruthy();
	});

	it('locks the day when "Letzter Tag" is chosen', () => {
		render(RecurrenceForm, {
			props: { values: values({ freq: 'monthly', lastDay: true }), today: TODAY }
		});
		expect(screen.getByLabelText<HTMLInputElement>('Tag im Monat').disabled).toBe(true);
		expect(screen.queryByText('In kürzeren Monaten am letzten Tag.')).toBeNull();
	});

	it('shows the distance after completion without weekdays and its date', () => {
		render(RecurrenceForm, {
			props: {
				values: values({ mode: 'after_completion', freq: 'daily', interval: '3' }),
				today: TODAY
			}
		});
		expect(screen.getByLabelText<HTMLInputElement>('Abstand nach Erledigung').value).toBe('3');
		expect(screen.queryByRole('group', { name: 'Wochentage' })).toBeNull();
		expect(
			screen.getByText('Wird das Ticket heute erledigt, ist das nächste am 28.09.2026 fällig.')
		).toBeTruthy();
	});

	it('marks fields with an error and names it', () => {
		render(RecurrenceForm, {
			props: {
				values: values({ interval: '0' }),
				today: TODAY,
				errors: { interval: 'Das Intervall muss eine ganze Zahl von 1 bis 365 sein.' }
			}
		});
		const interval = screen.getByLabelText<HTMLInputElement>('Alle');
		expect(interval.getAttribute('aria-invalid')).toBe('true');
		const describedBy = interval.getAttribute('aria-describedby') ?? '';
		expect(document.getElementById(describedBy)?.textContent).toContain('Das Intervall muss');
		expect(
			screen.getByText('Nächste Termine erscheinen, sobald alle Angaben stimmen.')
		).toBeTruthy();
	});

	it('names the first date a ticket without due date gets', () => {
		render(RecurrenceForm, {
			props: { values: defaultFormValues(null, TODAY), today: TODAY, withoutDue: true }
		});
		expect(
			screen.getByText(
				'Das Ticket hat noch keine Fälligkeit und bekommt den ersten Termin: 25.09.2026.'
			)
		).toBeTruthy();
	});
});

// Preview "Nächste Termine" with several weekdays (plan OR-1): the form owns no values, so the
// harness binds them like the dialog and the panels, and every click changes the preview at once.
describe('RecurrenceForm: preview with several weekdays (OR-1)', () => {
	const preview = () => document.querySelector('.preview')?.textContent?.trim();

	function start(overrides: Partial<RecurrenceFormValues> = {}) {
		return render(RecurrenceFormHarness, { props: { initial: values(overrides), today: TODAY } });
	}

	it('follows each weekday that is checked or unchecked, across the turn of the month', async () => {
		const { component } = start();
		expect(preview()).toBe('Nächste Termine: 28.09.2026, 05.10.2026, 12.10.2026');
		const days = screen.getByRole('group', { name: 'Wochentage' });

		await fireEvent.click(within(days).getByRole('checkbox', { name: 'Freitag' }));
		await fireEvent.click(within(days).getByRole('checkbox', { name: 'Mittwoch' }));
		expect(preview()).toBe('Nächste Termine: 28.09.2026, 30.09.2026, 02.10.2026');
		// The days stay in week order, whatever the order of the clicks.
		expect(component.current().weekdays).toEqual(['MO', 'WE', 'FR']);

		await fireEvent.click(within(days).getByRole('checkbox', { name: 'Montag' }));
		expect(preview()).toBe('Nächste Termine: 30.09.2026, 02.10.2026, 07.10.2026');
		expect(preview()).toBe(document.querySelector('[aria-live="polite"]')?.textContent?.trim());
	});

	it('skips the odd week with an interval of 2 and three days', async () => {
		start({ anchor: '2026-09-23', weekdays: ['MO', 'WE', 'FR'] });
		// From today (Friday 25.09.): the anchor week has Wednesday and Friday, the next week none.
		expect(preview()).toBe('Nächste Termine: 25.09.2026, 28.09.2026, 30.09.2026');
		await fireEvent.input(screen.getByLabelText('Alle'), { target: { value: '2' } });
		expect(preview()).toBe('Nächste Termine: 25.09.2026, 05.10.2026, 07.10.2026');
	});

	it('starts with the first chosen day after an anchor in the middle of the week', async () => {
		start({ anchor: '2026-10-01', weekdays: ['MO', 'WE', 'FR'] });
		// Thursday 01.10.: the Wednesday before does not count, Friday is first.
		expect(preview()).toBe('Nächste Termine: 02.10.2026, 05.10.2026, 07.10.2026');
	});

	it('runs across the turn of the year', async () => {
		start({ anchor: '2026-12-30', weekdays: ['MO', 'WE', 'FR'] });
		expect(preview()).toBe('Nächste Termine: 30.12.2026, 01.01.2027, 04.01.2027');
	});

	it('asks for a weekday when the last one is unchecked', async () => {
		start({ weekdays: ['WE'] });
		await fireEvent.click(screen.getByRole('checkbox', { name: 'Mittwoch' }));
		expect(preview()).toBe('Nächste Termine erscheinen, sobald alle Angaben stimmen.');
	});

	it('ignores the weekdays after completion', async () => {
		start({ weekdays: ['MO', 'WE', 'FR'] });
		await fireEvent.click(screen.getByRole('radio', { name: 'Nach Erledigung' }));
		expect(screen.queryByRole('group', { name: 'Wochentage' })).toBeNull();
		expect(preview()).toBe('Wird das Ticket heute erledigt, ist das nächste am 02.10.2026 fällig.');
	});
});
