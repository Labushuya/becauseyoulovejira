import { describe, expect, it } from 'vitest';
import { liveExample } from './recurrence-examples';
import { defaultFormValues } from './recurrence-rule';

// The sentence of "So funktioniert’s" in the form (plan "Wiederholungen verständlich machen",
// part A): it takes the dates of the current values from the same functions as the preview. The
// examples of the help are checked against the hook in tests/unit/recurrence-examples.test.mjs.

// A Friday.
const TODAY = '2026-09-25';

describe('liveExample', () => {
	it('names when the ticket and the next one appear with a fixed rhythm', () => {
		const values = defaultFormValues('2026-10-05', TODAY);
		// Without "Verpasste Termine nachholen" (WH-1): the next one waits for the first.
		expect(liveExample(values, TODAY)).toBe(
			'Mit diesen Einstellungen: Das Ticket für Mo 05.10. erscheint am Fr 02.10. Das nächste ist ' +
				'Mo 12.10. fällig und erscheint am Fr 09.10., wenn das erste bis dahin erledigt ist. ' +
				'Bleibt es länger offen, kommt das nächste erst mit dem Erledigen, für den ersten Termin ' +
				'danach; verpasste Termine gelten als übersprungen.'
		);
		expect(liveExample({ ...values, eachOccurrence: true }, TODAY)).toBe(
			'Mit diesen Einstellungen: Das Ticket für Mo 05.10. erscheint am Fr 02.10. Das nächste ist ' +
				'Mo 12.10. fällig und erscheint am Fr 09.10., egal wann du das erste erledigst. Es kommt ' +
				'auch, wenn das erste dann noch offen ist.'
		);
		expect(liveExample({ ...values, leadDays: '0' }, TODAY)).toMatch(
			/^Mit diesen Einstellungen: Das Ticket für Mo 05\.10\. erscheint am Mo 05\.10\. /
		);
	});

	it('says how a later completion moves the next date after completion', () => {
		const values = {
			...defaultFormValues(TODAY, TODAY),
			mode: 'after_completion' as const,
			freq: 'weekly' as const,
			interval: '2'
		};
		expect(liveExample(values, TODAY)).toBe(
			'Mit diesen Einstellungen: Erledigst du es heute (Fr 25.09.), ist das nächste Fr 09.10. ' +
				'fällig und erscheint am Di 06.10. Erledigst du es 3 Tage später (Mo 28.09.), verschiebt ' +
				'sich das nächste auf Mo 12.10.'
		);
		// Every 2 days with lead time 3: at once with the completion.
		expect(liveExample({ ...values, freq: 'daily', interval: '2' }, TODAY)).toMatch(
			/fällig und erscheint sofort beim Erledigen\. /
		);
	});

	// RV-1 (ADR-0022 addendum 18): from the current due date of the ticket when it lies ahead.
	it('counts after completion from the due date of the ticket, else from today', () => {
		const values = {
			...defaultFormValues('2026-10-03', TODAY),
			mode: 'after_completion' as const,
			freq: 'weekly' as const,
			interval: '2'
		};
		const ticket = (due: string | null) => ({ kind: 'ticket' as const, due });
		expect(liveExample(values, TODAY, ticket('2026-10-03'))).toBe(
			'Mit diesen Einstellungen: Erledigst du es am Fälligkeitstag (Sa 03.10.), ist das nächste ' +
				'Sa 17.10. fällig und erscheint am Mi 14.10. Erledigst du es 3 Tage später (Di 06.10.), ' +
				'verschiebt sich das nächste auf Di 20.10.'
		);
		// Due today, without a due date and without a ticket: from today, as before.
		const fromToday =
			'Mit diesen Einstellungen: Erledigst du es heute (Fr 25.09.), ist das nächste Fr 09.10. ' +
			'fällig und erscheint am Di 06.10. Erledigst du es 3 Tage später (Mo 28.09.), verschiebt ' +
			'sich das nächste auf Mo 12.10.';
		expect(liveExample(values, TODAY, ticket(TODAY))).toBe(fromToday);
		expect(liveExample(values, TODAY, ticket(null))).toBe(fromToday);
		expect(liveExample(values, TODAY)).toBe(fromToday);
		// Every 2 days with lead time 3: at once with the completion on the due date.
		expect(
			liveExample({ ...values, freq: 'daily', interval: '2' }, TODAY, ticket('2026-10-03'))
		).toMatch(
			/^Mit diesen Einstellungen: Erledigst du es am Fälligkeitstag \(Sa 03\.10\.\), ist das nächste Mo 05\.10\. fällig und erscheint sofort beim Erledigen\. /
		);
		// A fixed rhythm keeps its sentence from the start.
		expect(
			liveExample(defaultFormValues('2026-10-05', TODAY), TODAY, ticket('2026-10-07'))
		).toMatch(/^Mit diesen Einstellungen: Das Ticket für Mo 05\.10\. erscheint am Fr 02\.10\. /);
	});

	it('says nothing while the values are invalid', () => {
		expect(liveExample({ ...defaultFormValues(TODAY, TODAY), weekdays: [] }, TODAY)).toBeNull();
	});
});
