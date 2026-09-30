// Long lists of chips (ADR-0026, addendum KL): folding, filtering and the status, pure.

import { describe, expect, it } from 'vitest';
import {
	CHIP_LIST_FILTER_ABOVE,
	CHIP_LIST_FOLD_ABOVE,
	CHIP_LIST_SHOWN,
	chipListStatus,
	chipListView,
	moreLabel
} from './chip-list';

const list = (count: number) => Array.from({ length: count }, (_, index) => `wort${index + 1}`);
const closed = { expanded: false, query: '' };

describe('chipListView', () => {
	it('shows a list of up to 10 entries whole, without button and filter', () => {
		expect(CHIP_LIST_SHOWN).toBe(8);
		expect(CHIP_LIST_FOLD_ABOVE).toBe(10);
		for (const count of [0, 1, 8, 9, 10]) {
			const view = chipListView(list(count), closed);
			expect(view.shown, String(count)).toEqual(list(count));
			expect(view).toMatchObject({ hidden: 0, foldable: false, filterable: false });
		}
	});

	it('folds a longer list to the first 8 and unfolds it', () => {
		const items = list(11);
		expect(chipListView(items, closed)).toMatchObject({
			shown: items.slice(0, 8),
			hidden: 3,
			foldable: true,
			filterable: false
		});
		expect(chipListView(items, { expanded: true, query: '' })).toMatchObject({
			shown: items,
			hidden: 0,
			foldable: true
		});
	});

	it('offers a filter above 20 entries and ignores a filter text below', () => {
		expect(CHIP_LIST_FILTER_ABOVE).toBe(20);
		expect(chipListView(list(20), { expanded: false, query: 'wort1' })).toMatchObject({
			filterable: false,
			filtering: false,
			hidden: 12
		});
		expect(chipListView(list(21), closed).filterable).toBe(true);
	});

	it('filters without case, accents and umlaut dots, all words, and shows every hit', () => {
		const items = [
			...list(20),
			'Rechnung',
			'Müller GmbH',
			'Straße',
			'Café Zentral',
			'#BYL',
			'Mueller'
		];
		const hits = (query: string) => chipListView(items, { expanded: false, query }).shown;
		expect(hits('müller')).toEqual(['Müller GmbH']);
		expect(hits('MULLER')).toEqual(['Müller GmbH']);
		expect(hits('strasse')).toEqual(['Straße']);
		expect(hits('cafe zent')).toEqual(['Café Zentral']);
		expect(hits('#byl')).toEqual(['#BYL']);
		expect(hits('wort1')).toHaveLength(11);
		expect(hits('  ')).toHaveLength(8);
		const view = chipListView(items, { expanded: false, query: 'wort' });
		expect(view).toMatchObject({ hidden: 0, foldable: false, filtering: true });
		expect(view.shown).toHaveLength(20);
	});
});

describe('texts', () => {
	it('names the folded entries and the hits of the filter', () => {
		expect(moreLabel(5)).toBe('+ 5 weitere');
		const items = list(24);
		expect(chipListStatus(chipListView(items, closed), 24)).toBe('');
		expect(chipListStatus(chipListView(items, { expanded: false, query: 'wort2' }), 24)).toBe(
			'6 von 24'
		);
		expect(chipListStatus(chipListView(items, { expanded: false, query: 'xyz' }), 24)).toBe(
			'Keine Treffer'
		);
	});
});
