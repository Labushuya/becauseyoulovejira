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

/** Due dates of the preview rows (plan "Wiederholungen verständlich machen"). */
const dues = () =>
	[...document.querySelectorAll<HTMLElement>('.preview li')].map((row) => row.dataset.due);
/** The rows as read: "erscheint Fr 02.10. → fällig Mo 05.10.". */
const rows = () =>
	[...document.querySelectorAll<HTMLElement>('.preview li')].map((row) =>
		(row.textContent ?? '').replace(/\s+/g, ' ').trim()
	);
const previewTitle = () => document.querySelector('.preview-title')?.textContent?.trim();

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
		// Each date with the day its ticket appears (lead time 3; today is Friday 25.09.).
		expect(previewTitle()).toBe('Nächste Termine');
		expect(rows()).toEqual([
			'erscheint heute → fällig Mo 28.09.',
			'erscheint Fr 02.10. → fällig Mo 05.10.',
			'erscheint Fr 09.10. → fällig Mo 12.10.'
		]);
		expect(screen.queryByLabelText('Tag im Monat')).toBeNull();
	});

	it('says "sofort" when the lead time reaches back before today', () => {
		render(RecurrenceForm, { props: { values: values({ leadDays: '7' }), today: TODAY } });
		expect(rows()[0]).toBe('erscheint sofort → fällig Mo 28.09.');
		expect(rows()[1]).toBe('erscheint Mo 28.09. → fällig Mo 05.10.');
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
		expect(dues()).toEqual(['2026-09-30', '2026-10-31', '2026-11-30']);
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
		expect(previewTitle()).toBe('Wird das Ticket heute erledigt');
		expect(rows()).toEqual(['erscheint heute → fällig Mo 28.09.']);
	});

	// Plan "Wiederholungen verständlich machen", part A: short hints and "So funktioniert’s".
	it('explains the kind at the field and in "So funktioniert’s" with the dates of these settings', async () => {
		render(RecurrenceFormHarness, {
			props: { initial: values({ anchor: '2026-10-05', weekdays: ['MO'] }), today: TODAY }
		});
		const kind = screen.getByRole('group', { name: 'Art der Wiederholung' });
		const hint = () =>
			document.getElementById(kind.getAttribute('aria-describedby') ?? '')?.textContent?.trim();
		expect(hint()).toBe(
			'Feste Kalendertage: Früher oder später erledigen ändert die Termine nicht.'
		);

		const details = document.querySelector<HTMLDetailsElement>('details.how');
		expect(details?.open).toBe(false);
		expect(details?.querySelector('summary')?.textContent?.trim()).toBe('So funktioniert’s');
		const how = () => (details?.textContent ?? '').replace(/\s+/g, ' ');
		expect(how()).toContain('Fester Rhythmus heißt: An festen Kalendertagen ist es dran.');
		expect(how()).toContain('Solange ein Ticket der Serie offen ist, entsteht kein weiteres.');
		expect(how()).toContain(
			'Mit diesen Einstellungen: Das Ticket für Mo 05.10. erscheint am Fr 02.10. Das nächste ist Mo 12.10. fällig'
		);
		const more = within(details as HTMLElement).getByRole('link', {
			name: 'Mehr Beispiele in der Hilfe (neuer Tab)'
		});
		expect(more.getAttribute('href')).toBe('/einstellungen/hilfe#wiederholungen');
		expect(more.getAttribute('target')).toBe('_blank');

		await fireEvent.click(screen.getByRole('radio', { name: 'Nach Erledigung' }));
		expect(hint()).toBe(
			'Abstand ab dem Erledigen: Früher oder später erledigen verschiebt den nächsten Termin mit.'
		);
		expect(how()).toContain('Nach Erledigung heißt: Der nächste Termin zählt ab dem Tag');
		expect(how()).toContain('Erledigst du es heute (Fr 25.09.)');
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
		expect(screen.queryByText(/schon überfällig/)).toBeNull();
	});
});

// WH-2 (ADR-0022 addendum 14): a series whose first date lies in the past asks where it begins, the
// same on every way (the form is in "Wiederholen…", "Neues Ticket" and the rule panel). Today is
// Friday 25.09.2026.
describe('RecurrenceForm: a start in the past (WH-2)', () => {
	const startGroup = () =>
		screen.queryByRole('group', { name: /liegt in der Vergangenheit/ }) as HTMLElement | null;
	const choice = (name: string) => screen.getByRole<HTMLInputElement>('radio', { name });
	const noteOf = (radio: HTMLElement) =>
		document.getElementById(radio.getAttribute('aria-describedby') ?? '')?.textContent?.trim();

	it('asks for a ticket overdue since long ago, "Serie ab heute beginnen" chosen, with the first date', async () => {
		// Imported from Notion: due Tuesday 12.03.2024; "Wiederholen…" starts weekly on Tuesday.
		const { component } = render(RecurrenceFormHarness, {
			props: {
				initial: defaultFormValues('2024-03-12', TODAY),
				today: TODAY,
				context: { kind: 'ticket', due: '2024-03-12' }
			}
		});
		const group = startGroup();
		expect(group).not.toBeNull();
		expect(group?.querySelector('legend')?.textContent).toBe(
			'Die Fälligkeit liegt in der Vergangenheit (12.03.2024).'
		);
		// A warning without red, like the question about a backlog.
		expect(group?.closest('.section-message')?.getAttribute('data-tone')).toBe('warning');
		expect(group?.closest('.alert-error')).toBeNull();
		const today = choice('Serie ab heute beginnen');
		const keep = choice('Ursprüngliches Datum behalten');
		expect(today.checked).toBe(true);
		expect(keep.checked).toBe(false);
		// The first Tuesday from Friday 25.09. on.
		expect(noteOf(today)).toBe('Erstes Vorkommen: Di 29.09.');
		expect(noteOf(keep)).toBe('Das Ticket bleibt „überfällig seit 12.03.2024“.');
		expect(component.current().start).toBeUndefined();

		await fireEvent.click(keep);
		expect(component.current().start).toBe('keep');
		expect(keep.checked).toBe(true);
		await fireEvent.click(today);
		expect(component.current().start).toBe('today');

		// The first date follows the rhythm: every Monday is Monday 28.09.
		const days = screen.getByRole('group', { name: 'Wochentage' });
		await fireEvent.click(within(days).getByRole('checkbox', { name: 'Montag' }));
		await fireEvent.click(within(days).getByRole('checkbox', { name: 'Dienstag' }));
		expect(noteOf(choice('Serie ab heute beginnen'))).toBe('Erstes Vorkommen: Mo 28.09.');
	});

	it('names today for a daily rhythm, the end of the month and the day after completion', () => {
		const cases: [Partial<RecurrenceFormValues>, string][] = [
			[{ freq: 'daily' }, 'Erstes Vorkommen: Fr 25.09. (heute)'],
			// The 31st in September: clamped to Wednesday 30.09.
			[{ freq: 'monthly', monthDay: '31' }, 'Erstes Vorkommen: Mi 30.09.'],
			[{ freq: 'monthly', lastDay: true }, 'Erstes Vorkommen: Mi 30.09.'],
			// Every two weeks from the week of 12.03.2024: the week of 05.10. is in the rhythm.
			[{ interval: '2' }, 'Erstes Vorkommen: Di 06.10.'],
			// After completion the series begins today.
			[{ mode: 'after_completion', freq: 'weekly' }, 'Erstes Vorkommen: Fr 25.09. (heute)']
		];
		for (const [overrides, first] of cases) {
			const { unmount } = render(RecurrenceForm, {
				props: {
					values: { ...defaultFormValues('2024-03-12', TODAY), ...overrides },
					today: TODAY,
					context: { kind: 'ticket', due: '2024-03-12' }
				}
			});
			expect(noteOf(choice('Serie ab heute beginnen')), JSON.stringify(overrides)).toBe(first);
			unmount();
		}
	});

	it('asks for a ticket without due date whose first date lies in the past ("Beginnt am")', () => {
		render(RecurrenceForm, {
			props: { values: defaultFormValues('2026-09-07', TODAY), today: TODAY, withoutDue: true }
		});
		expect(startGroup()?.querySelector('legend')?.textContent).toBe(
			'Der erste Termin liegt in der Vergangenheit (07.09.2026).'
		);
		expect(noteOf(choice('Serie ab heute beginnen'))).toBe('Erstes Vorkommen: Mo 28.09.');
		expect(noteOf(choice('Ursprüngliches Datum behalten'))).toBe(
			'Das Ticket bleibt „überfällig seit 07.09.“.'
		);
		// The note about a first date in the future gives way to the question.
		expect(screen.queryByText(/bekommt den ersten Termin: /)).toBeNull();
	});

	it('only says so for a new rule, which begins from today anyway', () => {
		render(RecurrenceForm, {
			props: { values: defaultFormValues('2026-09-01', TODAY), today: TODAY }
		});
		expect(startGroup()).toBeNull();
		expect(screen.queryByRole('radio', { name: 'Serie ab heute beginnen' })).toBeNull();
		const hint = screen.getByText(/„Beginnt am“ liegt in der Vergangenheit \(01\.09\.2026\)\./);
		expect(hint.textContent?.replace(/\s+/g, ' ').trim()).toContain(
			'Die Serie beginnt ab heute. Erstes Vorkommen: Di 29.09.'
		);
		expect(hint.closest('.section-message')?.getAttribute('data-tone')).toBe('info');
	});

	it('asks nothing for a date from today on, while a rule is edited or the values are invalid', () => {
		const ticket = (due: string | null) => ({ kind: 'ticket' as const, due });
		const variants = [
			{ values: defaultFormValues(TODAY, TODAY), context: ticket(TODAY) },
			{ values: defaultFormValues('2026-10-12', TODAY), context: ticket('2026-10-12') },
			{
				values: defaultFormValues('2024-03-12', TODAY),
				context: { kind: 'rule' as const, nextDue: '2026-09-29', each: false }
			},
			{
				values: { ...defaultFormValues('2024-03-12', TODAY), interval: '0' },
				context: ticket('2024-03-12')
			},
			// After completion a ticket without due date keeps none: nothing lies in the past.
			{
				values: { ...defaultFormValues('2024-03-12', TODAY), mode: 'after_completion' as const },
				context: ticket(null)
			}
		];
		for (const props of variants) {
			const { unmount } = render(RecurrenceForm, { props: { ...props, today: TODAY } });
			expect(screen.queryByText(/liegt in der Vergangenheit/)).toBeNull();
			unmount();
		}
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
		expect(dues()).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
		const days = screen.getByRole('group', { name: 'Wochentage' });

		await fireEvent.click(within(days).getByRole('checkbox', { name: 'Freitag' }));
		await fireEvent.click(within(days).getByRole('checkbox', { name: 'Mittwoch' }));
		expect(dues()).toEqual(['2026-09-28', '2026-09-30', '2026-10-02']);
		// The days stay in week order, whatever the order of the clicks.
		expect(component.current().weekdays).toEqual(['MO', 'WE', 'FR']);

		await fireEvent.click(within(days).getByRole('checkbox', { name: 'Montag' }));
		expect(dues()).toEqual(['2026-09-30', '2026-10-02', '2026-10-07']);
		expect(preview()).toBe(document.querySelector('[aria-live="polite"]')?.textContent?.trim());
	});

	it('skips the odd week with an interval of 2 and three days', async () => {
		start({ anchor: '2026-09-23', weekdays: ['MO', 'WE', 'FR'] });
		// From today (Friday 25.09.): the anchor week has Wednesday and Friday, the next week none.
		expect(dues()).toEqual(['2026-09-25', '2026-09-28', '2026-09-30']);
		await fireEvent.input(screen.getByLabelText('Alle'), { target: { value: '2' } });
		expect(dues()).toEqual(['2026-09-25', '2026-10-05', '2026-10-07']);
	});

	it('starts with the first chosen day after an anchor in the middle of the week', async () => {
		start({ anchor: '2026-10-01', weekdays: ['MO', 'WE', 'FR'] });
		// Thursday 01.10.: the Wednesday before does not count, Friday is first.
		expect(dues()).toEqual(['2026-10-02', '2026-10-05', '2026-10-07']);
	});

	it('runs across the turn of the year', async () => {
		start({ anchor: '2026-12-30', weekdays: ['MO', 'WE', 'FR'] });
		expect(dues()).toEqual(['2026-12-30', '2027-01-01', '2027-01-04']);
		expect(rows()[1]).toBe('erscheint Di 29.12. → fällig Fr 01.01.2027');
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
		expect(previewTitle()).toBe('Wird das Ticket heute erledigt');
		expect(dues()).toEqual(['2026-10-02']);
	});
});

// The switch "Jeden Termin einzeln anlegen" (plan OR-5), since WH-1 named "Verpasste Termine
// nachholen": only with a fixed rhythm and once the server knows it; off by default, with a hint on
// what each state means.
describe('RecurrenceForm: "Jeden Termin einzeln anlegen" (OR-5)', () => {
	const toggle = () =>
		screen.queryByRole<HTMLInputElement>('switch', { name: 'Verpasste Termine nachholen' });

	it('is named "Verpasste Termine nachholen" and says what off means (WH-1)', () => {
		render(RecurrenceFormHarness, {
			props: { initial: values(), today: TODAY, eachAvailable: true }
		});
		expect(screen.queryByRole('switch', { name: 'Jeden Termin einzeln anlegen' })).toBeNull();
		const control = toggle();
		const hint =
			document.getElementById(String(control?.getAttribute('aria-describedby')))?.textContent ?? '';
		expect(hint.replace(/\s+/g, ' ').trim()).toBe(
			'Nur das aktuelle Ticket zählt: Bleibt es liegen, zeigt es „überfällig seit …“, und das ' +
				'nächste entsteht erst beim Erledigen, für den nächsten Termin danach. Verpasste Termine ' +
				'gelten als übersprungen.'
		);
	});

	it('is not offered before the server knows it', () => {
		render(RecurrenceFormHarness, { props: { initial: values(), today: TODAY } });
		expect(toggle()).toBeNull();
	});

	it('is a switch, off by default, whose hint follows the state and whose value goes along', async () => {
		const { component } = render(RecurrenceFormHarness, {
			props: { initial: values(), today: TODAY, eachAvailable: true }
		});
		const control = toggle();
		expect(control?.type).toBe('checkbox');
		expect(control?.checked).toBe(false);
		const hint = () =>
			document.getElementById(String(control?.getAttribute('aria-describedby')))?.textContent ?? '';
		expect(hint()).toMatch(/Nur das aktuelle Ticket zählt/);

		await fireEvent.click(control as HTMLInputElement);
		expect(component.current().eachOccurrence).toBe(true);
		expect(hint()).toMatch(
			/Jeder Termin bekommt ein eigenes Ticket, auch wenn frühere noch offen sind/
		);
		expect(hint().replace(/\s+/g, ' ')).toMatch(
			/Fehlen mehr als 20 Termine .* fragt die Regel vorher, ob sie alle nachholt/
		);
	});

	// Plan "Wiederholungen verständlich machen", recommendations 5 and 6 (ADR-0022 addendum 5).
	it('asks inline about a backlog of more than 20 dates when it goes on, and sends the answer', async () => {
		const past = values({ freq: 'daily', weekdays: [], anchor: '2026-08-01' });
		const { component } = render(RecurrenceFormHarness, {
			props: {
				initial: past,
				today: TODAY,
				eachAvailable: true,
				context: { kind: 'ticket', due: null }
			}
		});
		expect(screen.queryByRole('group', { name: /liegen vor heute/ })).toBeNull();
		await fireEvent.click(toggle() as HTMLInputElement);
		// "Serie ab heute beginnen" (chosen in advance, WH-2) misses no date: nothing to ask.
		expect(screen.queryByRole('group', { name: /liegen vor heute/ })).toBeNull();
		await fireEvent.click(screen.getByRole('radio', { name: 'Ursprüngliches Datum behalten' }));

		// The ticket gets 01.08., the series goes on from 02.08.: 54 dates before 25.09.
		const question = screen.getByRole('group', {
			name: '54 Termine (02.08. bis 24.09.) liegen vor heute'
		});
		expect(question.closest('.section-message')?.getAttribute('data-tone')).toBe('warning');
		expect(within(question).getByText(/Ohne Wahl wartet die Regel in der Übersicht/)).toBeTruthy();
		const all = within(question).getByRole<HTMLInputElement>('radio', {
			name: 'Alle 54 nachholen (höchstens 20 je Stunde)'
		});
		const today = within(question).getByRole<HTMLInputElement>('radio', { name: 'Nur ab heute' });
		expect(all.checked || today.checked).toBe(false);
		await fireEvent.click(today);
		expect(component.current().backlog).toBe('today');

		// Without a backlog (a rule of its own, nothing missed) there is no question.
		await fireEvent.input(screen.getByLabelText('Beginnt am'), { target: { value: TODAY } });
		expect(screen.queryByRole('group', { name: /liegen vor heute/ })).toBeNull();
	});

	it('says that the series waits for all open tickets when it goes off', async () => {
		render(RecurrenceFormHarness, {
			props: {
				initial: values({ eachOccurrence: true }),
				today: TODAY,
				eachAvailable: true,
				context: { kind: 'rule', nextDue: '2026-10-05', each: true },
				openKeys: ['TASK-7', 'TASK-8', 'TASK-9']
			}
		});
		const text =
			'Die Serie geht weiter, sobald alle 3 offenen Tickets erledigt sind (TASK-7, TASK-8, TASK-9).';
		expect(screen.queryByText(text)).toBeNull();
		await fireEvent.click(toggle() as HTMLInputElement);
		expect(screen.getByText(text)).toBeTruthy();
	});

	it('leaves the switch out after completion', async () => {
		render(RecurrenceFormHarness, {
			props: { initial: values({ eachOccurrence: true }), today: TODAY, eachAvailable: true }
		});
		expect(toggle()?.checked).toBe(true);
		await fireEvent.click(screen.getByRole('radio', { name: 'Nach Erledigung' }));
		expect(toggle()).toBeNull();
	});

	it('shows a refusal of the server at the switch', () => {
		render(RecurrenceForm, {
			props: {
				values: values({ eachOccurrence: true }),
				today: TODAY,
				eachAvailable: true,
				errors: {
					eachOccurrence: '„Verpasste Termine nachholen“ gibt es nur bei einem festen Rhythmus.'
				}
			}
		});
		const control = toggle();
		expect(control?.getAttribute('aria-invalid')).toBe('true');
		expect(control?.getAttribute('aria-describedby')).toMatch(/error/);
		expect(screen.getByText(/gibt es nur bei einem festen Rhythmus/)).toBeTruthy();
	});
});
