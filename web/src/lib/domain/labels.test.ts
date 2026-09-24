// German labels (CLAUDE.md sections 7 and 8).

import { describe, expect, it } from 'vitest';
import {
	historyFieldLabel,
	PRIORITY_LABELS,
	SORT_COLUMN_LABELS,
	STATUS_LABELS,
	sortLabel
} from './labels';
import { SORT_KEYS } from './ordering';
import { PRIORITIES, STATUSES } from './status';

describe('labels', () => {
	it('names every status as in CLAUDE.md section 8', () => {
		expect(Object.keys(STATUS_LABELS)).toEqual([...STATUSES]);
		expect(STATUS_LABELS).toEqual({
			backlog: 'Backlog',
			open: 'Offen',
			in_progress: 'In Arbeit',
			waiting: 'Wartet',
			done: 'Erledigt'
		});
	});

	it('names every priority', () => {
		expect(Object.keys(PRIORITY_LABELS)).toEqual([...PRIORITIES]);
		expect(PRIORITY_LABELS).toEqual({
			low: 'Niedrig',
			medium: 'Mittel',
			high: 'Hoch',
			urgent: 'Dringend'
		});
	});

	it.each([
		['created', 'Angelegt'],
		['status', 'Status'],
		['priority', 'Priorität'],
		['due', 'Fälligkeit'],
		['description', 'Beschreibung'],
		['household', 'Haushalt']
	])('names the history field %s "%s"', (field, label) => {
		expect(historyFieldLabel(field)).toBe(label);
	});

	it('shows unknown history fields by their technical name', () => {
		expect(historyFieldLabel('something_new')).toBe('something_new');
		expect(historyFieldLabel('toString')).toBe('toString');
		expect(historyFieldLabel('__proto__')).toBe('__proto__');
	});

	it('freezes the label tables', () => {
		expect(Object.isFrozen(STATUS_LABELS)).toBe(true);
		expect(Object.isFrozen(PRIORITY_LABELS)).toBe(true);
	});
});

describe('sort labels (E3 plan, T-5)', () => {
	it('names every sortable column', () => {
		expect(Object.keys(SORT_COLUMN_LABELS)).toEqual([...SORT_KEYS]);
		expect(Object.isFrozen(SORT_COLUMN_LABELS)).toBe(true);
	});

	it.each([
		['priority', false, 'Priorität, Dringend zuerst'],
		['priority', true, 'Priorität, Niedrig zuerst'],
		['due', false, 'Fälligkeit, früheste zuerst'],
		['created', false, 'Erstellt, neueste zuerst'],
		['created', true, 'Erstellt, älteste zuerst'],
		['title', true, 'Titel, Z bis A'],
		['key', false, 'Key, aufsteigend']
	] as const)('describes %s (reversed %s) as "%s"', (key, reversed, label) => {
		expect(sortLabel({ key, reversed })).toBe(label);
	});

	it('describes every column in both directions', () => {
		for (const key of SORT_KEYS) {
			expect(sortLabel({ key, reversed: false })).not.toBe(sortLabel({ key, reversed: true }));
		}
	});
});
