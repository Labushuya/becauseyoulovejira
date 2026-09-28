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
		expect(liveExample(values, TODAY)).toBe(
			'Mit diesen Einstellungen: Das Ticket für Mo 05.10. erscheint am Fr 02.10. Das nächste ist ' +
				'Mo 12.10. fällig und erscheint am Fr 09.10., egal wann du das erste erledigst. Ist das ' +
				'erste dann noch offen, erscheint es erst, wenn du es erledigst.'
		);
		expect(liveExample({ ...values, eachOccurrence: true }, TODAY)).toMatch(
			/Es kommt auch, wenn das erste dann noch offen ist\.$/
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

	it('says nothing while the values are invalid', () => {
		expect(liveExample({ ...defaultFormValues(TODAY, TODAY), weekdays: [] }, TODAY)).toBeNull();
	});
});
