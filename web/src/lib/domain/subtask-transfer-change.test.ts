// "Übertragen …" after a change of a parent (UE-2, ADR-0070 addendum UE-2), the pure part: which fields
// a change touched, how changes of one parent add up (the old value is the one before the first
// change, a field changed back leaves, a question about the status takes the status out), the distance
// of the due date, the tags added and removed, the choice between the flag and the offer of the
// series, the texts of the flag, and what the dialog checks in advance and sends after a change.

import { describe, expect, it, vi } from 'vitest';
import type { TemplateOffer } from './series-template';
import { NO_TRANSFER_FIELDS, type TransferNames } from './subtask-transfer';
import {
	CHANGE_TEXTS,
	changeFieldOffers,
	changeFieldsOf,
	changeInitialFields,
	changedDescription,
	changedFields,
	changedTitle,
	dueShiftOf,
	nextParentChange,
	offerChoice,
	pendingFields,
	seriesChanges,
	seriesHint,
	shiftLabel,
	shiftText,
	startParentChange,
	tagChangeOf,
	tagChangeText,
	withoutDueCount,
	withoutDueText,
	type ChangedTicket
} from './subtask-transfer-change';

const GARDEN = 'tag000000000001';
const WASTE = 'tag000000000002';
const KITCHEN = 'tag000000000003';

function parent(overrides: Partial<ChangedTicket> = {}): ChangedTicket {
	return {
		id: 'parent000000001',
		key: 'HAUS-12',
		title: 'Umzug',
		status: 'open',
		priority: 'medium',
		due: '2026-10-12',
		projectId: null,
		tagIds: [WASTE],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-10-01 10:00:00.000Z',
		updated: '2026-10-01 10:00:00.000Z',
		...overrides
	};
}

const NAMES: TransferNames = { project: null, tags: ['Garten'], assignee: null };

describe('the fields of a change', () => {
	it('are the fields of the dialog whose values differ, in its order; tags as a set', () => {
		const before = parent({ assignee: null });
		const renamed = parent({ assignee: null, title: 'Umzug 2', description: 'Kisten' });
		expect(changedFields(before, renamed)).toEqual([]);
		expect(
			changedFields(before, {
				...before,
				projectId: 'proj00000000001',
				priority: 'high',
				due: '2026-10-15',
				status: 'waiting',
				assignee: 'user00000000002',
				tagIds: [WASTE, GARDEN]
			})
		).toEqual(['due', 'priority', 'status', 'assignee', 'tags', 'project']);
		// The order of the tags is no change; nobody stays nobody before the migration as well.
		const two = parent({ tagIds: [GARDEN, WASTE] });
		expect(changedFields(two, { ...two, tagIds: [WASTE, GARDEN] })).toEqual([]);
		expect(changedFields({ ...before, assignee: undefined }, before)).toEqual([]);
	});
});

describe('several changes of one parent', () => {
	const before = parent();

	it('keeps the value before the first change as the old one and collects the fields', () => {
		const first = startParentChange({ before, after: { ...before, priority: 'high' } });
		expect(first.touched).toEqual(['priority']);
		const second = nextParentChange(first, {
			before: first.after,
			after: { ...first.after, due: '2026-10-15', priority: 'urgent' }
		});
		expect(second.before).toBe(before);
		expect(second.after.priority).toBe('urgent');
		expect(second.touched).toEqual(['due', 'priority']);
		expect(pendingFields(second)).toEqual(['due', 'priority']);
		expect(dueShiftOf(second)).toBe(3);
	});

	it('drops a field that is back at its old value, and has none left when all are', () => {
		const first = startParentChange({ before, after: { ...before, priority: 'high' } });
		const due = nextParentChange(first, {
			before: first.after,
			after: { ...first.after, due: '2026-10-20' }
		});
		const back = nextParentChange(due, {
			before: due.after,
			after: { ...due.after, priority: 'medium' }
		});
		expect(pendingFields(back)).toEqual(['due']);
		const none = nextParentChange(back, {
			before: back.after,
			after: { ...back.after, due: '2026-10-12' },
			undo: true
		});
		expect(pendingFields(none)).toEqual([]);
	});

	it('counts only fields the user changed, not those another person changed in between', () => {
		const first = startParentChange({ before, after: { ...before, priority: 'high' } });
		// Realtime brought another due date; the next own change carries it along.
		const elsewhere = { ...first.after, due: '2026-11-01' };
		const next = nextParentChange(first, {
			before: elsewhere,
			after: { ...elsewhere, status: 'in_progress' }
		});
		expect(pendingFields(next)).toEqual(['priority', 'status']);
	});

	it('leaves the status out once the question about open sub-tasks settled it', () => {
		const started = startParentChange({
			before,
			after: { ...before, status: 'done' },
			answered: ['status']
		});
		expect(pendingFields(started)).toEqual([]);
		const earlier = startParentChange({ before, after: { ...before, status: 'in_progress' } });
		expect(pendingFields(earlier)).toEqual(['status']);
		const answered = nextParentChange(earlier, {
			before: earlier.after,
			after: { ...earlier.after, status: 'done' },
			answered: ['status']
		});
		expect(pendingFields(answered)).toEqual([]);
	});

	it('takes an earlier change whose offer of the series still stands', () => {
		const earlier = {
			before,
			after: { ...before, title: 'Umzug planen', priority: 'low' as const }
		};
		const started = startParentChange(
			{ before: earlier.after, after: { ...earlier.after, due: '2026-10-13' } },
			earlier
		);
		expect(started.before).toBe(before);
		expect(started.touched).toEqual(['due', 'priority']);
		expect(started.after.title).toBe('Umzug planen');
	});
});

describe('the distance of the due date', () => {
	it('is new minus old in days, either way', () => {
		const change = (from: string | null, to: string | null) => ({
			before: parent({ due: from }),
			after: parent({ due: to })
		});
		expect(dueShiftOf(change('2026-10-12', '2026-10-15'))).toBe(3);
		expect(dueShiftOf(change('2026-10-12', '2026-10-10'))).toBe(-2);
		// Over the change of the clocks (25 October) and the turn of the year.
		expect(dueShiftOf(change('2026-10-24', '2026-10-26'))).toBe(2);
		expect(dueShiftOf(change('2026-12-30', '2027-01-02'))).toBe(3);
	});

	it('is null without an old or a new due date, without distance or beyond 3650 days', () => {
		const change = (from: string | null, to: string | null) => ({
			before: parent({ due: from }),
			after: parent({ due: to })
		});
		expect(dueShiftOf(change(null, '2026-10-15'))).toBeNull();
		expect(dueShiftOf(change('2026-10-12', null))).toBeNull();
		expect(dueShiftOf(change('2026-10-12', '2026-10-12'))).toBeNull();
		expect(dueShiftOf(change('2026-10-12', '2036-10-12'))).toBeNull();
	});

	it('reads as "+3 Tage", "−1 Tag"', () => {
		expect(shiftText(3)).toBe('+3 Tage');
		expect(shiftText(-1)).toBe('−1 Tag');
		expect(shiftLabel(3)).toBe('Um denselben Abstand verschieben (+3 Tage)');
	});
});

describe('the tags of a change', () => {
	it('are the added and the removed ones, not all tags of the parent', () => {
		const change = {
			before: parent({ tagIds: [WASTE, KITCHEN] }),
			after: parent({ tagIds: [KITCHEN, GARDEN] })
		};
		expect(tagChangeOf(change)).toEqual({ add: [GARDEN], remove: [WASTE] });
		expect(tagChangeOf({ before: change.after, after: change.after })).toBeNull();
	});

	it('only as far as the parent still fits them (the route checks against it)', () => {
		const change = { before: parent({ tagIds: [WASTE] }), after: parent({ tagIds: [GARDEN] }) };
		// Meanwhile the parent lost Garten and got Müll back.
		expect(tagChangeOf(change, { tagIds: [WASTE] })).toBeNull();
		expect(tagChangeOf(change, { tagIds: [GARDEN, WASTE] })).toEqual({ add: [GARDEN], remove: [] });
	});

	it('read as "Garten hinzufügen, Müll entfernen"', () => {
		expect(tagChangeText({ added: ['Garten'], removed: ['Müll'] })).toBe(
			'Garten hinzufügen, Müll entfernen'
		);
		expect(tagChangeText({ added: [], removed: ['Müll', 'Küche'] })).toBe(
			'Müll und Küche entfernen'
		);
	});
});

describe('the flag or the offer of the series', () => {
	it('is the flag with an open sub-task and a changed field of the dialog', () => {
		expect(offerChoice(['due'], 1, false)).toBe('transfer');
	});

	it('is the offer of the series without an open sub-task, without such a field or a route', () => {
		expect(offerChoice(['due'], 0, false)).toBe('series');
		expect(offerChoice([], 3, false)).toBe('series');
		expect(offerChoice(['priority'], 3, true)).toBe('series');
	});

	it('names the fields and asks about the sub-tasks; the dialog may offer the series', () => {
		expect(changedTitle(['priority', 'due'], 'HAUS-12')).toBe(
			'Fälligkeit und Priorität von HAUS-12 geändert. Auch für die Unteraufgaben?'
		);
		expect(changedTitle(['tags'], 'HAUS-3')).toBe(
			'Tags von HAUS-3 geändert. Auch für die Unteraufgaben?'
		);
		expect(changedDescription(null)).toBe('');
		expect(changedDescription('Müll')).toBe(
			'Im Dialog lässt sich die Änderung auch für künftige Tickets von „Müll“ übernehmen.'
		);
		expect(CHANGE_TEXTS.action).toBe('Übertragen …');
	});

	it('goes to the offer of the series as before without the flag; "Rückgängig" offers nothing', () => {
		const series = { offerTemplate: vi.fn(() => null) };
		const sink = seriesChanges(series);
		const before = parent();
		sink.changed({ before, after: { ...before, priority: 'high' } });
		expect(series.offerTemplate).toHaveBeenCalledExactlyOnceWith([
			{ before, after: { ...before, priority: 'high' } }
		]);
		sink.changed({ before, after: before, undo: true });
		expect(series.offerTemplate).toHaveBeenCalledOnce();
	});
});

describe('the dialog after a change', () => {
	const before = parent({ priority: 'medium', projectId: null, tagIds: [WASTE] });
	const after = parent({
		priority: 'high',
		due: '2026-10-15',
		projectId: 'proj00000000001',
		tagIds: [GARDEN]
	});
	const change = startParentChange({ before, after });
	const tagNames = { added: ['Garten'], removed: ['Müll'] };

	it('checks exactly the changed fields, the project included, not the remembered ones', () => {
		const offers = changeFieldOffers(after, NAMES, change, tagNames);
		expect([...changeInitialFields(offers, change)]).toEqual([
			'due',
			'priority',
			'tags',
			'project'
		]);
		const onlyStatus = startParentChange({ before, after: { ...before, status: 'waiting' } });
		expect([
			...changeInitialFields(
				changeFieldOffers(onlyStatus.after, NAMES, onlyStatus, tagNames),
				onlyStatus
			)
		]).toEqual(['status']);
	});

	it('names a moved due date by itself and the tags as the change', () => {
		const offers = changeFieldOffers(after, NAMES, change, tagNames);
		expect(offers.find((offer) => offer.field === 'due')).toMatchObject({
			label: 'Fälligkeit',
			value: '15.10.2026',
			hint: null
		});
		expect(offers.find((offer) => offer.field === 'tags')).toMatchObject({
			label: 'Tags',
			value: 'Garten hinzufügen, Müll entfernen',
			hint: 'Andere Tags der Unteraufgaben bleiben.',
			locked: null
		});
		// Without an old due date there is nothing to move by: the offer of UE-1.
		const fresh = startParentChange({ before: parent({ due: null }), after });
		expect(changeFieldOffers(after, NAMES, fresh, tagNames)[0]).toMatchObject({
			label: 'Gleiche Fälligkeit wie das Hauptticket'
		});
	});

	it('sends the same date or the distance, the tags as the change, the others as booleans', () => {
		const chosen = new Set(['due', 'priority', 'tags', 'project'] as const);
		expect(changeFieldsOf(chosen, after, change, 'same')).toEqual({
			...NO_TRANSFER_FIELDS,
			due: { mode: 'same' },
			priority: true,
			project: true,
			tags: { add: [GARDEN], remove: [WASTE] }
		});
		expect(changeFieldsOf(chosen, after, change, 'shift').due).toEqual({ mode: 'shift', days: 3 });
		// A due date that did not change goes the same, whatever the choice.
		const noDue = startParentChange({ before, after: { ...before, priority: 'high' } });
		expect(changeFieldsOf(new Set(['due'] as const), before, noDue, 'shift').due).toEqual({
			mode: 'same'
		});
		// Tags that did not change go like UE-1: the tags of the parent to add.
		expect(changeFieldsOf(new Set(['tags'] as const), before, noDue, 'same').tags).toEqual({
			add: [WASTE],
			remove: []
		});
	});

	it('says which sub-tasks keep no due date when it moves', () => {
		const targets = [{ due: null }, { due: '2026-10-01' }, { due: null }];
		expect(withoutDueCount(targets, { due: { mode: 'shift', days: 3 } })).toBe(2);
		expect(withoutDueCount(targets, { due: { mode: 'same' } })).toBe(0);
		expect(withoutDueText(2)).toBe('2 Unteraufgaben ohne Fälligkeit bleiben ohne.');
		expect(withoutDueText(1)).toBe('1 Unteraufgabe ohne Fälligkeit bleibt ohne.');
		expect(withoutDueText(0)).toBe('');
	});

	it('names what the template of the series gets', () => {
		const offer: Pick<TemplateOffer, 'title' | 'fields'> = {
			title: 'Müll',
			fields: ['priority', 'tags']
		};
		expect(seriesHint(offer)).toBe(
			'Die Vorlage von „Müll“ bekommt Priorität und Tags; dieses Ticket und seine Unteraufgaben ändert das nicht.'
		);
	});
});
