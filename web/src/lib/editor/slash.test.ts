// Entries of the "/" menu and their filter (plan editor RT-4).

import { describe, expect, it } from 'vitest';
import { SLASH_ITEMS, filterSlashItems } from './slash';

const labels = (query: string) => filterSlashItems(query).map((item) => item.label);

describe('the "/" menu', () => {
	it('offers the blocks of the plan and the link, without "Unteraufgabe"', () => {
		expect(SLASH_ITEMS.map((item) => item.label)).toEqual([
			'Überschrift 1',
			'Überschrift 2',
			'Überschrift 3',
			'Aufzählung',
			'Nummerierte Liste',
			'Checkliste',
			'Zitat',
			'Codeblock',
			'Trennlinie',
			'Link'
		]);
		expect(labels('')).toHaveLength(SLASH_ITEMS.length);
	});

	it.each([
		['über', ['Überschrift 1', 'Überschrift 2', 'Überschrift 3']],
		['ÜBER', ['Überschrift 1', 'Überschrift 2', 'Überschrift 3']],
		['h2', ['Überschrift 2']],
		['liste', ['Aufzählung', 'Nummerierte Liste']],
		['todo', ['Checkliste']],
		['url', ['Link']],
		['code', ['Codeblock']],
		['xyz', []]
	])('finds "%s" by the words of the name and the keywords', (query, expected) => {
		expect(labels(query)).toEqual(expected);
	});
});
