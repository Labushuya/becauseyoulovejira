import { describe, expect, it } from 'vitest';
import type { RecurrenceRule } from './recurrence-rule';
import {
	DEFAULT_TEMPLATE_STATUS,
	TEMPLATE_STATUSES,
	appliedTitle,
	changedTemplateFields,
	offerDescription,
	offerTitle,
	templateBody,
	templateChanges,
	templateOf,
	templateOffers,
	templateStatusOf,
	templateSummary,
	ticketTemplate,
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
			initialStatus: 'open'
		});
		expect(templateOf(rule({ initialStatus: 'backlog' })).initialStatus).toBe('backlog');
	});

	it('takes every value of a ticket into a new template, its status included', () => {
		const template = ticketTemplate({
			title: 'Steuer',
			description: 'Belege',
			projectId: 'proj00000000001',
			tagIds: ['tag000000000002'],
			priority: 'high',
			status: 'in_progress'
		});
		expect(template).toEqual({
			title: 'Steuer',
			description: 'Belege',
			projectId: 'proj00000000001',
			tagIds: ['tag000000000002'],
			priority: 'high',
			initialStatus: 'in_progress'
		});
		expect(templateBody(template)).toEqual({
			title: 'Steuer',
			description: 'Belege',
			project: 'proj00000000001',
			tags: ['tag000000000002'],
			priority: 'high',
			initial_status: 'in_progress'
		});
		expect(ticketTemplate({ ...template, status: 'done' }).initialStatus).toBe('open');
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
