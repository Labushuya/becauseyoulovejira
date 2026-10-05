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
	appearsText,
	nextTicketNote,
	nextTicketOf,
	backlogOf,
	backlogText,
	CATCH_UP_ASK_HINT,
	catchUpAllLabel,
	formBacklog,
	isWaiting,
	openBlockText,
	openInstancesOf,
	parseSkipped,
	REOPEN_DETACHED_LABEL,
	REOPEN_REFUSALS,
	reopenOlderMessage,
	ruleDeleteText,
	ruleParams,
	ruleStateLabel,
	ruleText,
	sameRhythm,
	skippedText,
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

	// Recommendation 2 of the plan "Wiederholungen verständlich machen".
	it('names due date and appearance of the next ticket, what it waits for, or the pause', () => {
		// Lead time 5: the ticket for 30.09. appears today.
		expect(nextTicketText(rule(), TODAY)).toBe('Nächstes Ticket fällig 30.09., erscheint in Kürze');
		expect(nextTicketText(rule({ nextDue: '2026-10-31' }), TODAY)).toBe(
			'Nächstes Ticket fällig 31.10., erscheint am 26.10.'
		);
		expect(nextTicketText(rule({ nextDue: '2027-01-31' }), TODAY)).toBe(
			'Nächstes Ticket fällig 31.01.2027, erscheint am 26.01.2027'
		);
		// Without the switch an open ticket holds it back.
		expect(nextTicketText(rule({ nextDue: '2026-10-31' }), TODAY, ['HAUS-12'])).toBe(
			'Nächstes Ticket fällig 31.10., erscheint am 26.10. (sobald HAUS-12 erledigt ist)'
		);
		expect(nextTicketText(rule(), TODAY, ['HAUS-12', 'HAUS-14'])).toBe(
			'Nächstes Ticket fällig 30.09., erscheint, sobald HAUS-12 und HAUS-14 erledigt sind'
		);
		// With it, open tickets do not matter.
		expect(
			nextTicketText(rule({ nextDue: '2026-10-31', eachOccurrence: true }), TODAY, ['HAUS-12'])
		).toBe('Nächstes Ticket fällig 31.10., erscheint am 26.10.');
		// Missed dates without an open ticket (the app was off): the ticket made today gets the
		// latest of them (ADR-0022 section 3).
		expect(nextTicketText(rule({ nextDue: '2026-07-31' }), TODAY)).toBe(
			'Nächstes Ticket fällig 31.08., erscheint in Kürze'
		);
		// Held back by an open ticket (WH-1): completed today at the earliest, so the first date
		// after today, never one in the past.
		expect(nextTicketText(rule({ nextDue: '2026-07-31' }), TODAY, ['HAUS-12'])).toBe(
			'Nächstes Ticket fällig 30.09., erscheint, sobald HAUS-12 erledigt ist'
		);
		expect(nextTicketOf(rule({ nextDue: '2026-08-31' }), '2026-09-30', ['HAUS-12'])).toMatchObject({
			due: '2026-10-31'
		});
		expect(
			nextTicketText(
				rule({ mode: 'after_completion', freq: 'daily', monthDay: null, nextDue: null }),
				TODAY,
				['HAUS-12']
			)
		).toBe('Nächstes Ticket nach dem Erledigen von HAUS-12');
		expect(nextTicketText(rule({ mode: 'after_completion', nextDue: null }), TODAY)).toBe(
			'Nächstes Ticket nach dem Erledigen'
		);
		expect(nextTicketText(rule({ active: false }), TODAY)).toBe('Pausiert');
		expect(nextTicketText(rule({ eachOccurrence: true, lastHint: CATCH_UP_ASK_HINT }), TODAY)).toBe(
			'Nächstes Ticket wartet auf deine Entscheidung'
		);
		expect(nextTicketOf(rule({ nextDue: '2026-10-31' }), TODAY, ['HAUS-12'])).toEqual({
			state: 'scheduled',
			due: '2026-10-31',
			appears: '2026-10-26',
			blockedBy: ['HAUS-12']
		});
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
			lead_days: 3,
			each_occurrence: false
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

	it('sends "Jeden Termin einzeln anlegen" only with a fixed rhythm (plan OR-5)', () => {
		const weekly = { ...defaultFormValues('2026-09-28', TODAY), eachOccurrence: true };
		expect(formParams(weekly).each_occurrence).toBe(true);
		expect(formParams({ ...weekly, mode: 'after_completion' }).each_occurrence).toBe(false);
		expect(formParams(defaultFormValues('2026-09-28', TODAY)).each_occurrence).toBe(false);
		// The rule panel sends the rhythm again when only the switch changed.
		expect(sameRhythm(weekly, { ...weekly, eachOccurrence: false })).toBe(false);
		expect(sameRhythm(weekly, { ...weekly })).toBe(true);
		expect(formValuesOf(rule({ eachOccurrence: true }), TODAY).eachOccurrence).toBe(true);
		expect(formValuesOf(rule(), TODAY).eachOccurrence).toBe(false);
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
			rows: [
				{ due: '2026-09-28', appears: '2026-09-25' },
				{ due: '2026-10-05', appears: '2026-10-02' },
				{ due: '2026-10-12', appears: '2026-10-09' }
			],
			firstDue: null
		});
		// A start in the past: the dates from today on.
		expect(formPreview({ ...values, anchor: '2026-01-05' }, TODAY).dates[0]).toBe('2026-09-28');
		expect(
			formPreview({ ...values, mode: 'after_completion', freq: 'daily', interval: '3' }, TODAY)
		).toEqual({
			dates: ['2026-09-28'],
			rows: [{ due: '2026-09-28', appears: '2026-09-25' }],
			firstDue: null
		});
		expect(formPreview(defaultFormValues(null, TODAY), TODAY, true).firstDue).toBe(TODAY);
		expect(formPreview({ ...values, weekdays: [] }, TODAY)).toEqual({
			dates: [],
			rows: [],
			firstDue: null
		});
		expect(appearsText('2026-09-24', TODAY)).toBe('erscheint sofort');
		expect(appearsText(TODAY, TODAY)).toBe('erscheint heute');
		expect(appearsText('2026-10-02', TODAY)).toBe('erscheint Fr 02.10.');
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
		// The second line: when it appears, or what it waits for (recommendation 2).
		expect(nextTicketNote(rule({ nextDue: '2026-10-31' }), TODAY)).toBe('erscheint 26.10.');
		expect(nextTicketNote(rule(), TODAY)).toBe('erscheint in Kürze');
		expect(nextTicketNote(rule(), TODAY, ['HAUS-12', 'HAUS-14'])).toBe('nach HAUS-12 …');
		expect(
			nextTicketNote(rule({ mode: 'after_completion', nextDue: null }), TODAY, ['HAUS-12'])
		).toBe('von HAUS-12');
		expect(nextTicketNote(rule({ active: false }), TODAY)).toBe('');
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

describe('missed dates made into one ticket (ADR-0022 addendum 4)', () => {
	it('reads only a well-formed note', () => {
		expect(parseSkipped('{"count":2,"dates":["2026-10-12","2026-10-19"],"more":false}')).toEqual({
			count: 2,
			dates: ['2026-10-12', '2026-10-19'],
			more: false
		});
		for (const value of [
			'',
			'x',
			'[]',
			'{"count":0,"dates":[]}',
			'{"count":2,"dates":["12.10."]}'
		]) {
			expect(parseSkipped(value), value).toBeNull();
		}
	});

	it('names count and dates, with "…" for more than listed', () => {
		const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
		expect(skippedText({ count: 1, dates: ['2026-10-12'], more: false }, TODAY)).toBe(
			'1 Termin übersprungen (12.10.)'
		);
		expect(skippedText({ count: 7, dates, more: false }, TODAY)).toBe(
			'7 Termine übersprungen (01.10., 02.10., 03.10., 04.10., 05.10. …)'
		);
		expect(skippedText({ count: 1000, dates, more: true }, TODAY)).toBe(
			'Mehr als 1000 Termine übersprungen (01.10., 02.10., 03.10., 04.10., 05.10. …)'
		);
		expect(skippedText({ count: 2, dates: ['2025-12-29', '2026-01-05'], more: false })).toBe(
			'2 Termine übersprungen (29.12.2025, 05.01.2026)'
		);
	});
});

describe('refused reopening (ADR-0023 addendum 4)', () => {
	it('names the open ticket and the way out', () => {
		expect(reopenOlderMessage('HAUS-12')).toBe(
			'Von dieser Serie ist schon HAUS-12 offen, und dieses Ticket ist nicht das zuletzt erledigte. Du kannst es als normales Ticket wieder öffnen (aus der Serie lösen).'
		);
		expect(REOPEN_REFUSALS).toEqual([
			'validation_recurrence_open_instance',
			'validation_recurrence_reopen_older'
		]);
		expect(REOPEN_DETACHED_LABEL).toBe('Als normales Ticket wieder öffnen (aus der Serie lösen)');
	});
});

describe('a large backlog (ADR-0022 addendum 5)', () => {
	const daily = rule({ freq: 'daily', monthDay: null, anchor: '2026-08-01' });

	it('counts the missed dates of a fixed rhythm before today', () => {
		expect(backlogOf(ruleParams(daily), '2026-09-01', TODAY)).toEqual({
			count: 24,
			first: '2026-09-01',
			last: '2026-09-24',
			more: false
		});
		expect(backlogOf(ruleParams(daily), TODAY, TODAY)).toBeNull();
		expect(backlogOf(ruleParams(daily), null, TODAY)).toBeNull();
		// Every Monday: 07.09., 14.09. and 21.09. before Friday 25.09.
		const monday = rule({ freq: 'weekly', weekdays: ['MO'], monthDay: null, anchor: '2026-09-07' });
		expect(backlogOf(ruleParams(monday), '2026-09-03', TODAY)).toEqual({
			count: 3,
			first: '2026-09-07',
			last: '2026-09-21',
			more: false
		});
		expect(
			backlogOf(
				ruleParams(rule({ mode: 'after_completion', freq: 'daily', monthDay: null })),
				'2026-09-01',
				TODAY
			)
		).toBeNull();
		const years = backlogOf(
			ruleParams(rule({ freq: 'daily', monthDay: null, anchor: '1990-01-01' })),
			'1990-01-01',
			TODAY
		);
		expect(years).toMatchObject({ count: 10000, more: true });
		expect(catchUpAllLabel(years!)).toBe('Alle nachholen');
	});

	it('names the backlog and the buttons', () => {
		const backlog = backlogOf(ruleParams(daily), '2026-09-01', TODAY)!;
		expect(backlogText(backlog, TODAY)).toBe('24 Termine (01.09. bis 24.09.)');
		expect(
			backlogText({ count: 1, first: '2026-09-21', last: '2026-09-21', more: false }, TODAY)
		).toBe('1 Termin (21.09.)');
		expect(catchUpAllLabel(backlog)).toBe('Alle 24 nachholen');
	});

	it('knows a rule that waits, only with the switch and while active', () => {
		const waiting = rule({ eachOccurrence: true, lastHint: CATCH_UP_ASK_HINT });
		expect(isWaiting(waiting)).toBe(true);
		expect(ruleStateLabel(waiting)).toBe('Wartet');
		expect(isWaiting({ ...waiting, eachOccurrence: false })).toBe(false);
		expect(isWaiting({ ...waiting, active: false })).toBe(false);
		expect(ruleStateLabel({ ...waiting, active: false })).toBe('Pausiert');
		expect(isWaiting({ ...waiting, lastHint: 'Anderes' })).toBe(false);
	});

	it('asks in the form only when the switch goes on with more than 20 missed dates', () => {
		const values = {
			...defaultFormValues('2026-08-01', TODAY),
			freq: 'daily' as const,
			eachOccurrence: true
		};
		// A ticket without due date gets 01.08.; the series goes on on 02.08.: 54 dates.
		expect(formBacklog(values, TODAY, { kind: 'ticket', due: null })).toMatchObject({
			count: 54,
			first: '2026-08-02'
		});
		// With a due date, after it: from 05.09. on, 20 dates, not more than the limit.
		expect(formBacklog(values, TODAY, { kind: 'ticket', due: '2026-09-04' })).toBeNull();
		expect(formBacklog(values, TODAY, { kind: 'ticket', due: '2026-09-03' })).toMatchObject({
			count: 21
		});
		expect(formBacklog(values, TODAY, { kind: 'ticket', due: 'kaputt' })).toBeNull();
		// A rule: from its next ticket, only when the switch goes on.
		expect(
			formBacklog(values, TODAY, { kind: 'rule', nextDue: '2026-08-15', each: false })
		).toMatchObject({ count: 41 });
		expect(
			formBacklog(values, TODAY, { kind: 'rule', nextDue: '2026-08-15', each: true })
		).toBeNull();
		expect(
			formBacklog({ ...values, eachOccurrence: false }, TODAY, { kind: 'ticket', due: null })
		).toBeNull();
		expect(formBacklog(values, TODAY, undefined)).toBeNull();
		// The answer goes along only with the switch.
		expect(formParams({ ...values, backlog: 'today' }).backlog).toBe('today');
		expect(formParams({ ...values, eachOccurrence: false, backlog: 'today' })).not.toHaveProperty(
			'backlog'
		);
	});
});

describe('open tickets of a rule (recommendations 6 and 7)', () => {
	it('lists all of them, oldest first, and says the series waits for them', () => {
		const open = [
			{
				id: 't3',
				key: 'TASK-3',
				title: 'C',
				recurrenceId: 'r1',
				created: '2026-09-03 10:00:00.000Z'
			},
			{
				id: 't1',
				key: 'TASK-1',
				title: 'A',
				recurrenceId: 'r1',
				created: '2026-09-01 10:00:00.000Z'
			},
			{
				id: 't9',
				key: 'TASK-9',
				title: 'X',
				recurrenceId: 'r2',
				created: '2026-09-02 10:00:00.000Z'
			},
			{
				id: 't5',
				key: 'TASK-5',
				title: 'E',
				recurrenceId: null,
				created: '2026-09-02 10:00:00.000Z'
			}
		];
		expect(openInstancesOf(open, 'r1')).toEqual([
			{ id: 't1', key: 'TASK-1', title: 'A' },
			{ id: 't3', key: 'TASK-3', title: 'C' }
		]);
		expect(openBlockText(['TASK-1', 'TASK-3'])).toBe(
			'Die Serie geht weiter, sobald alle 2 offenen Tickets erledigt sind (TASK-1, TASK-3).'
		);
	});

	// The question of the panel and of the menu of a row (plan aktionsmenues, AM-4).
	it('says which open tickets stay when a rule is deleted', () => {
		const start = 'Bestehende Tickets bleiben erhalten. „Müll“ erzeugt danach keine Tickets mehr';
		expect(ruleDeleteText('Müll', [])).toBe(`${start}.`);
		expect(ruleDeleteText('Müll', ['TASK-7'])).toBe(
			`${start}; TASK-7 bleibt als normales Ticket offen.`
		);
		expect(ruleDeleteText('Müll', ['TASK-7', 'TASK-8'])).toBe(
			`${start}; TASK-7, TASK-8 bleiben als normale Tickets offen.`
		);
	});
});
