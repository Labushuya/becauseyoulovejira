import { describe, expect, it } from 'vitest';
import {
	defaultFormValues,
	formErrors,
	formParams,
	formPreview,
	formValuesOf,
	nextTicketDate,
	nextTicketText,
	openInstanceMessage,
	ruleParams,
	ruleStateLabel,
	ruleText,
	sameRhythm,
	type RecurrenceRule
} from './recurrence-rule';

// Rules and the form "Wiederholen…" in the SPA (E5 plan, package 4).

const TODAY = '2026-09-25';

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
	return {
		id: 'rule00000000001',
		title: 'Miete',
		description: '',
		projectId: null,
		tagIds: [],
		priority: null,
		mode: 'calendar',
		freq: 'monthly',
		interval: 1,
		weekdays: [],
		monthDay: -1,
		anchor: '2026-01-31',
		leadDays: 5,
		nextDue: '2026-09-30',
		lastGeneratedAt: null,
		active: true,
		lastHint: '',
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

describe('rules', () => {
	it('gives the parameters and the rhythm in words', () => {
		expect(ruleParams(rule())).toEqual({
			mode: 'calendar',
			freq: 'monthly',
			interval: 1,
			weekdays: [],
			month_day: -1,
			anchor: '2026-01-31',
			lead_days: 5
		});
		expect(ruleText(rule())).toBe('monatlich am letzten Tag');
		expect(ruleText(rule({ mode: '', freq: '' }))).toBe('');
	});

	it('names the next ticket, the wait for the completion or the pause', () => {
		expect(nextTicketText(rule(), TODAY)).toBe('Nächstes Ticket am 30.09.');
		expect(nextTicketText(rule({ nextDue: '2027-01-31' }), TODAY)).toBe(
			'Nächstes Ticket am 31.01.2027'
		);
		expect(nextTicketText(rule({ mode: 'after_completion', nextDue: null }), TODAY)).toBe(
			'Nächstes Ticket nach dem Erledigen'
		);
		expect(nextTicketText(rule({ active: false }), TODAY)).toBe('Pausiert');
	});

	it('names the open ticket when reopening is refused', () => {
		expect(openInstanceMessage('HAUS-12')).toBe(
			'Von dieser Serie ist schon HAUS-12 offen. Erledige es zuerst oder löse ein Ticket aus der Serie.'
		);
	});
});

describe('the form', () => {
	it('starts weekly on the weekday of the due date, or of today, with lead time 3', () => {
		expect(defaultFormValues('2026-09-28', TODAY)).toEqual({
			mode: 'calendar',
			freq: 'weekly',
			interval: '1',
			weekdays: ['MO'],
			monthDay: '28',
			lastDay: false,
			anchor: '2026-09-28',
			leadDays: '3'
		});
		expect(defaultFormValues(null, TODAY)).toMatchObject({ weekdays: ['FR'], anchor: TODAY });
	});

	it('takes the values of a rule for "Regel bearbeiten"', () => {
		expect(formValuesOf(rule(), TODAY)).toMatchObject({
			freq: 'monthly',
			monthDay: '31',
			lastDay: true,
			anchor: '2026-01-31',
			leadDays: '5'
		});
		// A rule from before E5 without a rhythm gets the defaults of the form.
		expect(
			formValuesOf(rule({ mode: '', freq: '', anchor: null, monthDay: null }), TODAY)
		).toMatchObject({
			mode: 'calendar',
			freq: 'weekly',
			weekdays: ['FR'],
			anchor: TODAY
		});
	});

	it('sends weekdays and the day of the month only where they belong', () => {
		const weekly = { ...defaultFormValues('2026-09-28', TODAY), monthDay: '28' };
		expect(formParams(weekly)).toEqual({
			mode: 'calendar',
			freq: 'weekly',
			interval: 1,
			weekdays: ['MO'],
			month_day: 0,
			anchor: '2026-09-28',
			lead_days: 3
		});
		expect(formParams({ ...weekly, freq: 'monthly', lastDay: true })).toMatchObject({
			weekdays: [],
			month_day: -1
		});
		expect(formParams({ ...weekly, mode: 'after_completion' })).toMatchObject({
			weekdays: [],
			month_day: 0
		});
	});

	it('checks with the rules of the hook and its texts', () => {
		const values = defaultFormValues('2026-09-28', TODAY);
		expect(formErrors(values)).toEqual({});
		expect(
			formErrors({ ...values, interval: '0', weekdays: [], anchor: '', leadDays: '31' })
		).toEqual({
			interval: 'Das Intervall muss eine ganze Zahl von 1 bis 365 sein.',
			weekdays: 'Bitte mindestens einen Wochentag wählen.',
			anchor: 'Bitte ein gültiges Datum für „Beginnt am“ wählen.',
			leadDays: 'Der Vorlauf muss zwischen 0 und 30 Tagen liegen.'
		});
		expect(formErrors({ ...values, interval: '2.5' }).interval).toBeDefined();
		expect(formErrors({ ...values, freq: 'monthly', monthDay: '' }).monthDay).toBe(
			'Der Tag im Monat muss zwischen 1 und 31 liegen oder „Letzter Tag“ sein.'
		);
		expect(formErrors({ ...values, freq: 'monthly', monthDay: '', lastDay: true })).toEqual({});
	});

	it('previews the next three dates, the date after completion and the first due date', () => {
		const values = defaultFormValues('2026-09-28', TODAY);
		expect(formPreview(values, TODAY)).toEqual({
			dates: ['2026-09-28', '2026-10-05', '2026-10-12'],
			firstDue: null
		});
		// A start in the past: the dates from today on.
		expect(formPreview({ ...values, anchor: '2026-01-05' }, TODAY).dates[0]).toBe('2026-09-28');
		expect(
			formPreview({ ...values, mode: 'after_completion', freq: 'daily', interval: '3' }, TODAY)
		).toEqual({
			dates: ['2026-09-28'],
			firstDue: null
		});
		expect(formPreview(defaultFormValues(null, TODAY), TODAY, true).firstDue).toBe(TODAY);
		expect(formPreview({ ...values, weekdays: [] }, TODAY)).toEqual({ dates: [], firstDue: null });
	});
});

describe('overview and rule panel (package 5)', () => {
	it('names the next ticket as a short date or "nach dem Erledigen"', () => {
		expect(nextTicketDate(rule({ nextDue: '2026-10-01' }), TODAY)).toBe('01.10.');
		expect(nextTicketDate(rule({ nextDue: '2027-01-01' }), TODAY)).toBe('01.01.2027');
		expect(nextTicketDate(rule({ mode: 'after_completion', nextDue: null }), TODAY)).toBe(
			'nach dem Erledigen'
		);
		// A paused rule keeps its date for display (ADR-0023 section 4).
		expect(nextTicketDate(rule({ active: false, nextDue: '2026-10-01' }), TODAY)).toBe('01.10.');
	});

	it('names the state as text', () => {
		expect(ruleStateLabel({ active: true })).toBe('Aktiv');
		expect(ruleStateLabel({ active: false })).toBe('Pausiert');
	});

	it('compares the rhythm as it is sent, not as it is typed', () => {
		const weekly = defaultFormValues('2026-09-28', TODAY);
		expect(sameRhythm(weekly, { ...weekly, weekdays: [...weekly.weekdays] })).toBe(true);
		// The day of the month is not sent for a weekly rhythm.
		expect(sameRhythm(weekly, { ...weekly, monthDay: '15' })).toBe(true);
		expect(sameRhythm(weekly, { ...weekly, interval: '01' })).toBe(true);
		expect(sameRhythm(weekly, { ...weekly, weekdays: ['MO', 'TH'] })).toBe(false);
		expect(sameRhythm(weekly, { ...weekly, anchor: '2026-10-05' })).toBe(false);
		expect(sameRhythm(weekly, { ...weekly, leadDays: '0' })).toBe(false);
		expect(sameRhythm(weekly, { ...weekly, mode: 'after_completion' })).toBe(false);
		expect(sameRhythm(weekly, { ...weekly, interval: 'x' })).toBe(false);
		expect(sameRhythm({ ...weekly, interval: 'x' }, { ...weekly, interval: 'y' })).toBe(true);
	});
});
