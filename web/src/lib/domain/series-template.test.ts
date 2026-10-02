import { describe, expect, it } from 'vitest';
import type { RecurrenceRule } from './recurrence-rule';
import {
	DEFAULT_TEMPLATE_STATUS,
	ONE_TICKET_CHANGED,
	TEMPLATE_STATUSES,
	TEMPLATE_SUBTASKS_MAX,
	appliedTitle,
	changedTemplateFields,
	initialStatusOptions,
	moveSubtask,
	offerDescription,
	offerTitle,
	sameSubtasks,
	subtaskCountText,
	subtaskOffer,
	subtaskOfferDescription,
	subtasksOfTicket,
	subtasksWithoutTitle,
	takeSubtasks,
	takenText,
	templateBody,
	templateChanges,
	templateOf,
	templateOffers,
	templateStatusOf,
	templateSubtasksOf,
	templateSummary,
	ticketTemplate,
	trimmedSubtasks,
	type SeriesChange,
	type SeriesTicket
} from './series-template';

// The template of a rule (plan WV): what the next tickets get, a ticket as the template of a new
// rule, the line "Künftige Tickets: …" and the offer "Auch für künftige Tickets übernehmen".

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
	return {
		id: 'rule00000000001',
		title: 'Müll',
		description: 'Gelbe Tonne',
		projectId: null,
		tagIds: ['tag000000000001'],
		priority: 'medium',
		mode: 'calendar',
		freq: 'weekly',
		interval: 1,
		weekdays: ['MO'],
		monthDay: null,
		anchor: '2026-09-07',
		leadDays: 3,
		nextDue: '2026-09-28',
		lastGeneratedAt: null,
		active: true,
		lastHint: '',
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

function seriesTicket(overrides: Partial<SeriesTicket> = {}): SeriesTicket {
	return {
		id: 'ticket000000001',
		key: 'TASK-3',
		status: 'open',
		title: 'Müll',
		description: 'Gelbe Tonne',
		priority: 'medium',
		projectId: null,
		tagIds: ['tag000000000001'],
		recurrenceId: 'rule00000000001',
		...overrides
	};
}

function change(before: Partial<SeriesTicket>, after: Partial<SeriesTicket>): SeriesChange {
	return { before: seriesTicket(before), after: seriesTicket({ ...before, ...after }) };
}

const NAMES = {
	project: (id: string) => (id === 'proj00000000001' ? 'Haus' : null),
	tag: (id: string) => ({ tag000000000001: 'Garten', tag000000000002: 'Müll' })[id] ?? null
};

describe('the status of a template', () => {
	it('allows every status but "Erledigt", "Offen" by default', () => {
		expect(TEMPLATE_STATUSES).toEqual(['backlog', 'open', 'in_progress', 'waiting']);
		expect(DEFAULT_TEMPLATE_STATUS).toBe('open');
		expect(templateStatusOf('waiting')).toBe('waiting');
		for (const value of ['done', '', undefined, null, 'offen']) {
			expect(templateStatusOf(value), String(value)).toBe('open');
		}
	});
});

describe('templates of rules and tickets', () => {
	it('reads a rule as its next tickets get it: no priority is "Mittel", no status "Offen"', () => {
		expect(templateOf(rule({ priority: null }))).toEqual({
			title: 'Müll',
			description: 'Gelbe Tonne',
			projectId: null,
			tagIds: ['tag000000000001'],
			priority: 'medium',
			initialStatus: 'open',
			subtasks: [],
			color: null
		});
		expect(templateOf(rule({ initialStatus: 'backlog' })).initialStatus).toBe('backlog');
		// Plan WV-3: the sub-tasks of the template, as copies.
		const subtasks = [{ title: 'Filter wechseln', priority: 'high' as const }];
		const template = templateOf(rule({ templateSubtasks: subtasks }));
		expect(template.subtasks).toEqual(subtasks);
		expect(template.subtasks[0]).not.toBe(subtasks[0]);
		// ADR-0052: the color of the next tickets.
		expect(templateOf(rule({ color: 'gruen' })).color).toBe('gruen');
	});

	it('takes every value of a ticket into a new template, the status as the user chose it', () => {
		const ticket = {
			title: 'Steuer',
			description: 'Belege',
			projectId: 'proj00000000001',
			tagIds: ['tag000000000002'],
			priority: 'high' as const,
			status: 'in_progress' as const
		};
		// ADR-0022 addendum 9: the status comes from the answer, not silently from the ticket.
		const template = ticketTemplate(ticket, 'waiting');
		expect(template).toEqual({
			title: 'Steuer',
			description: 'Belege',
			projectId: 'proj00000000001',
			tagIds: ['tag000000000002'],
			priority: 'high',
			initialStatus: 'waiting',
			// Plan WV-3: the sub-tasks of the ticket never come along on their own.
			subtasks: [],
			color: null
		});
		// Without sub-tasks and color the body leaves the fields out (a server before the
		// migrations ignores them).
		expect(templateBody(template)).toEqual({
			title: 'Steuer',
			description: 'Belege',
			project: 'proj00000000001',
			tags: ['tag000000000002'],
			priority: 'high',
			initial_status: 'waiting'
		});
		expect(
			templateBody({ ...template, subtasks: [{ title: 'Belege sortieren', priority: 'low' }] })
				.template_subtasks
		).toEqual([{ title: 'Belege sortieren', priority: 'low' }]);
		expect(ticketTemplate(ticket, 'in_progress').initialStatus).toBe('in_progress');
		// ADR-0052: the own color of the ticket comes along and goes in the body.
		const colored = ticketTemplate({ ...ticket, color: 'senf' }, 'open');
		expect(colored.color).toBe('senf');
		expect(templateBody(colored).color).toBe('senf');
	});

	it('offers "Offen" and the status of the ticket first, the other statuses below, "Erledigt" never', () => {
		const answers = (status: string | null) =>
			initialStatusOptions(status).map(({ value, label, first }) => [value, label, first]);
		expect(answers('in_progress')).toEqual([
			['open', 'Offen', true],
			['in_progress', 'Wie dieses Ticket: In Arbeit', true],
			['backlog', 'Backlog', false],
			['waiting', 'Wartet', false]
		]);
		expect(answers('open')).toEqual([
			['open', 'Offen (wie dieses Ticket)', true],
			['backlog', 'Backlog', false],
			['in_progress', 'In Arbeit', false],
			['waiting', 'Wartet', false]
		]);
		expect(answers('backlog').slice(0, 2)).toEqual([
			['open', 'Offen', true],
			['backlog', 'Wie dieses Ticket: Backlog', true]
		]);
		// "Neue Regel" has no ticket; a done ticket never starts a series.
		for (const status of [null, 'done']) {
			expect(answers(status), String(status)).toEqual([
				['open', 'Offen', true],
				['backlog', 'Backlog', false],
				['in_progress', 'In Arbeit', false],
				['waiting', 'Wartet', false]
			]);
		}
	});

	it('names only the changed fields of a template', () => {
		const before = templateOf(rule());
		expect(templateChanges(before, before)).toEqual({});
		expect(
			templateChanges(before, {
				...before,
				projectId: 'proj00000000001',
				tagIds: [],
				initialStatus: 'waiting'
			})
		).toEqual({ project: 'proj00000000001', tags: [], initial_status: 'waiting' });
		// The whole list of sub-tasks once it differs, also by order or priority (plan WV-3).
		const list = [
			{ title: 'A', priority: 'low' as const },
			{ title: 'B', priority: 'high' as const }
		];
		const withList = { ...before, subtasks: list };
		expect(templateChanges(before, withList)).toEqual({ template_subtasks: list });
		expect(templateChanges(withList, { ...before, subtasks: [...list] })).toEqual({});
		expect(templateChanges(withList, { ...before, subtasks: [list[1]!, list[0]!] })).toEqual({
			template_subtasks: [list[1], list[0]]
		});
		expect(
			templateChanges(withList, {
				...before,
				subtasks: [list[0]!, { title: 'B', priority: 'urgent' }]
			})
		).toEqual({
			template_subtasks: [list[0], { title: 'B', priority: 'urgent' }]
		});
		// ADR-0052: a new color, and back to "wie Projekt" as null.
		expect(templateChanges(before, { ...before, color: 'tuerkis' })).toEqual({ color: 'tuerkis' });
		expect(templateChanges({ ...before, color: 'tuerkis' }, before)).toEqual({ color: null });
	});

	it('says what the next tickets get in one line', () => {
		expect(templateSummary(templateOf(rule({ priority: 'high' })), NAMES, true)).toBe(
			'Priorität Hoch · ohne Projekt · Tags Garten · Status beim Anlegen Offen'
		);
		expect(
			templateSummary(
				templateOf(
					rule({
						projectId: 'proj00000000001',
						tagIds: ['tag000000000002', 'gone00000000001', 'tag000000000001']
					})
				),
				NAMES,
				false
			)
		).toBe('Priorität Mittel · Projekt Haus · Tags Müll, Garten');
		expect(
			templateSummary(templateOf(rule({ projectId: 'gone00000000001', tagIds: [] })), NAMES, false)
		).toBe('Priorität Mittel · Projekt unbekannt · ohne Tags');
		// Plan WV-3: the number of sub-tasks, only when there are some.
		const one = [{ title: 'A', priority: 'low' as const }];
		expect(templateSummary(templateOf(rule({ templateSubtasks: one })), NAMES, true)).toBe(
			'Priorität Mittel · ohne Projekt · Tags Garten · Status beim Anlegen Offen · 1 Unteraufgabe'
		);
		expect(
			templateSummary(
				templateOf(rule({ templateSubtasks: [...one, ...one, ...one] })),
				NAMES,
				false
			)
		).toBe('Priorität Mittel · ohne Projekt · Tags Garten · 3 Unteraufgaben');
		// ADR-0052: the color, only when the template has one.
		expect(templateSummary(templateOf(rule({ color: 'braun' })), NAMES, false)).toBe(
			'Priorität Mittel · ohne Projekt · Tags Garten · Farbe Braun'
		);
	});
});

// Plan WV-3 (ADR-0022 addendum 10): the list "Unteraufgaben" of the template.
describe('the sub-tasks of a template', () => {
	const entry = (title: string, priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium') => ({
		title,
		priority
	});

	it('reads the stored list: entries with a title, "Mittel" without a priority, nothing else', () => {
		expect(TEMPLATE_SUBTASKS_MAX).toBe(20);
		expect(
			templateSubtasksOf([
				{ title: 'A', priority: 'high' },
				{ title: 'B' },
				{ title: 'C', priority: 'sofort' },
				{ title: '  ' },
				{ priority: 'low' },
				'D',
				null
			])
		).toEqual([entry('A', 'high'), entry('B'), entry('C')]);
		for (const value of [null, undefined, '', {}, 'x']) {
			expect(templateSubtasksOf(value), String(value)).toEqual([]);
		}
	});

	it('moves, trims and finds rows without a title', () => {
		const list = [entry('A'), entry('B'), entry('C')];
		expect(moveSubtask(list, 0, 2).map((item) => item.title)).toEqual(['B', 'C', 'A']);
		expect(moveSubtask(list, 2, 1).map((item) => item.title)).toEqual(['A', 'C', 'B']);
		// Out of range: unchanged (and a copy).
		expect(moveSubtask(list, 0, -1)).toEqual(list);
		expect(moveSubtask(list, 0, 3)).not.toBe(list);
		expect(trimmedSubtasks([entry('  A  ', 'high')])).toEqual([entry('A', 'high')]);
		expect(subtasksWithoutTitle([entry('A'), entry(' '), entry(''), entry('B')])).toEqual([1, 2]);
		expect(sameSubtasks([entry('A')], [entry('A')])).toBe(true);
		expect(sameSubtasks([entry('A')], [entry('A', 'low')])).toBe(false);
	});

	it('takes the sub-tasks of a ticket in the order they were made, open and done ones', () => {
		const children = [
			{ id: 'b', title: 'Zweite', priority: 'low' as const, created: '2026-09-02 10:00:00.000Z' },
			{ id: 'a', title: 'Erste', priority: 'high' as const, created: '2026-09-01 10:00:00.000Z' },
			{ id: 'c', title: 'Dritte', priority: 'medium' as const, created: '2026-09-02 10:00:00.000Z' }
		];
		expect(subtasksOfTicket(children)).toEqual([
			entry('Erste', 'high'),
			entry('Zweite', 'low'),
			entry('Dritte')
		]);
	});

	it('adds them after the list without the known titles, or replaces it, never more than 20', () => {
		const current = [entry('Filter wechseln'), entry('Deckel putzen')];
		const incoming = [entry(' filter WECHSELN', 'high'), entry('Entkalken', 'urgent')];
		const added = takeSubtasks(current, incoming, false);
		expect(added).toEqual({
			subtasks: [...current, entry('Entkalken', 'urgent')],
			added: 1,
			known: 1,
			cut: 0
		});
		expect(takenText(added)).toBe('1 Unteraufgabe übernommen. 1 stand schon in der Liste.');
		const replaced = takeSubtasks(current, incoming, true);
		expect(replaced).toEqual({ subtasks: incoming, added: 2, known: 0, cut: 0 });
		expect(takenText(replaced)).toBe('2 Unteraufgaben übernommen.');

		const many = Array.from({ length: 25 }, (_value, index) => entry(`Schritt ${index + 1}`));
		const full = takeSubtasks(current, many, false);
		expect(full.subtasks).toHaveLength(20);
		expect(full).toMatchObject({ added: 18, known: 0, cut: 7 });
		expect(takenText(full)).toBe(
			'18 Unteraufgaben übernommen. 7 passten nicht mehr (höchstens 20).'
		);
		expect(takeSubtasks([], many, true)).toMatchObject({ added: 20, cut: 5 });
		expect(takenText({ subtasks: [], added: 0, known: 2, cut: 1 })).toBe(
			'0 Unteraufgaben übernommen. 2 standen schon in der Liste. 1 passte nicht mehr (höchstens 20).'
		);
	});

	it('offers a sub-task added to an open ticket of a series for the template, if it is new and fits', () => {
		const parent = { key: 'TASK-3', status: 'open' as const, recurrenceId: 'rule00000000001' };
		const withList = rule({ templateSubtasks: [entry('Filter wechseln')] });
		const offer = subtaskOffer(parent, [entry('Deckel putzen', 'high')], () => withList);
		expect(offer).toEqual({
			ruleId: 'rule00000000001',
			title: 'Müll',
			subtasks: [entry('Deckel putzen', 'high')],
			patch: { template_subtasks: [entry('Filter wechseln'), entry('Deckel putzen', 'high')] }
		});
		expect(subtaskOfferDescription(offer!)).toBe(
			'Künftige Tickets von „Müll“ bekommen die Unteraufgabe „Deckel putzen“ nicht.'
		);
		const two = subtaskOffer(parent, [entry('A'), entry('B')], () => withList);
		expect(subtaskOfferDescription(two!)).toBe(
			'Künftige Tickets von „Müll“ bekommen die Unteraufgaben „A“ und „B“ nicht.'
		);
		// Nothing to offer: the template has the title, it is full, the ticket is done or in no
		// series, or the rule is unknown.
		expect(subtaskOffer(parent, [entry('filter wechseln')], () => withList)).toBeNull();
		const full = rule({
			templateSubtasks: Array.from({ length: 20 }, (_value, index) => entry(`S${index}`))
		});
		expect(subtaskOffer(parent, [entry('Neu')], () => full)).toBeNull();
		expect(subtaskOffer({ ...parent, status: 'done' }, [entry('Neu')], () => withList)).toBeNull();
		expect(
			subtaskOffer({ ...parent, recurrenceId: null }, [entry('Neu')], () => withList)
		).toBeNull();
		expect(subtaskOffer(parent, [entry('Neu')], () => null)).toBeNull();
		expect(subtaskCountText(1)).toBe('1 Unteraufgabe');
		expect(ONE_TICKET_CHANGED).toBe('Nur dieses Ticket geändert.');
	});
});

describe('changes of an open ticket of a series', () => {
	it('names the changed fields of the template, never status or due date', () => {
		expect(
			changedTemplateFields(
				change(
					{},
					{
						title: 'Papiermüll',
						description: 'Blaue Tonne',
						priority: 'high',
						projectId: 'proj00000000001',
						tagIds: []
					}
				)
			)
		).toEqual(['title', 'description', 'priority', 'project', 'tags']);
		expect(changedTemplateFields(change({}, { status: 'in_progress' }))).toEqual([]);
	});

	it('leaves out a done ticket, a ticket without or leaving a series, and a missing description', () => {
		expect(changedTemplateFields(change({}, { priority: 'high', status: 'done' }))).toEqual([]);
		expect(changedTemplateFields(change({ recurrenceId: null }, { priority: 'high' }))).toEqual([]);
		expect(changedTemplateFields(change({}, { priority: 'high', recurrenceId: null }))).toEqual([]);
		// A ticket of the list has no description; the other fields still count.
		const { description, ...summary } = seriesTicket();
		expect(description).toBe('Gelbe Tonne');
		expect(
			changedTemplateFields({
				before: summary,
				after: { ...summary, priority: 'high', description: 'Neu' }
			})
		).toEqual(['priority']);
	});

	it('offers exactly the changed fields where the template differs', () => {
		const offers = templateOffers(
			[change({ priority: 'low' }, { priority: 'high', title: 'Müll' })],
			() => rule()
		);
		expect(offers).toEqual([
			{
				ruleId: 'rule00000000001',
				title: 'Müll',
				fields: ['priority'],
				patch: { priority: 'high' },
				keys: ['TASK-3']
			}
		]);
		// The template has the value already: nothing to offer.
		expect(
			templateOffers([change({ priority: 'low' }, { priority: 'medium' })], () => rule())
		).toEqual([]);
		// An unknown rule is left out.
		expect(templateOffers([change({}, { priority: 'high' })], () => null)).toEqual([]);
	});

	it('offers a new own color for the template, never one the server does not know (ADR-0052)', () => {
		expect(changedTemplateFields(change({ color: null }, { color: 'violett' }))).toEqual(['color']);
		// Before the restart the field is unknown on both sides: nothing changed.
		expect(changedTemplateFields(change({}, { priority: 'high' }))).toEqual(['priority']);
		const offers = templateOffers([change({ color: null }, { color: 'violett' })], () => rule());
		expect(offers[0]).toMatchObject({ fields: ['color'], patch: { color: 'violett' } });
		expect(offerDescription(offers)).toBe(
			'Künftige Tickets von „Müll“ kommen weiter mit der bisherigen Vorlage (Farbe).'
		);
		// The template has the color already: nothing to offer.
		expect(
			templateOffers([change({ color: null }, { color: 'violett' })], () =>
				rule({ color: 'violett' })
			)
		).toEqual([]);
	});

	it('takes tags over as their change, once per rule, in the order of the template', () => {
		const flowers = { id: 'ticket000000002', key: 'TASK-4' };
		const offers = templateOffers(
			[
				change({ tagIds: ['tag000000000001'] }, { tagIds: ['tag000000000002'] }),
				change(
					{ ...flowers, tagIds: [] },
					{ ...flowers, tagIds: ['tag000000000002', 'tag000000000003'] }
				)
			],
			() => rule({ tagIds: ['tag000000000009', 'tag000000000001'] })
		);
		expect(offers[0]?.patch).toEqual({
			tags: ['tag000000000009', 'tag000000000002', 'tag000000000003']
		});
		expect(offers[0]?.keys).toEqual(['TASK-3', 'TASK-4']);
	});

	it('writes the texts of the flags', () => {
		const one = templateOffers([change({}, { priority: 'high', title: 'Abfall' })], () => rule());
		expect(offerTitle(one)).toBe('Nur dieses Ticket geändert.');
		expect(offerDescription(one)).toBe(
			'Künftige Tickets von „Müll“ kommen weiter mit der bisherigen Vorlage (Titel, Priorität).'
		);
		expect(appliedTitle(one)).toBe('Vorlage von „Müll“ übernommen.');
		const [first] = one;
		if (first === undefined) throw new Error('No offer.');
		const two = [
			first,
			{ ...first, ruleId: 'rule00000000002', title: 'Blumen', fields: ['tags' as const] }
		];
		expect(offerTitle(two)).toBe('Nur diese 2 Tickets geändert.');
		expect(offerDescription(two)).toBe(
			'Künftige Tickets von 2 Serien kommen weiter mit der bisherigen Vorlage (Titel, Priorität, Tags).'
		);
		expect(appliedTitle(two)).toBe('Vorlagen von 2 Serien übernommen.');
	});
});
