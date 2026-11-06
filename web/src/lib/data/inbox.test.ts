// The filter of the paged views of the inbox with a search (EG-2 review, ADR-0014 addendum EG-2):
// the clauses written out agree with SEARCH_FIELDS, the longest filter stays below the limit of
// PocketBase, and no parameter of pb.filter reaches into the value of another one, also if the SDK
// replaced them one after the other with replaceAll, as older versions did.

import PocketBase from 'pocketbase';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	inboxClientOnlyTexts,
	inboxServerWords,
	INBOX_PATTERN_BUDGET
} from '../domain/source-search';
import { PICKER_SERVER_WORDS, loosePattern, searchWords } from '../domain/ticket-picker';
import { setClientArea } from './area';
import { SEARCH_CLAUSES, SEARCH_FIELDS, listHandledItems, searchClause } from './inbox';

/** PocketBase refuses a longer filter (ADR-0014 addendum EG-2). */
const FILTER_LIMIT = 3500;

const HOUSE = 'house0000000001';
const PROJECT = 'proj00000000001';

/** A client whose list answers with an empty page; `pb.filter` stays the one of the SDK. */
function listing() {
	const pb = new PocketBase('http://127.0.0.1:8090');
	setClientArea(pb, `h:${HOUSE}`);
	const getList = vi.fn(async () => ({
		items: [],
		page: 1,
		perPage: 50,
		totalItems: 0,
		totalPages: 0
	}));
	vi.spyOn(pb, 'collection').mockReturnValue({ getList } as unknown as ReturnType<
		PocketBase['collection']
	>);
	const filter = vi.spyOn(pb, 'filter');
	return { pb, filter };
}

/** The patterns the store sends for a search text, without names of connections. */
function patternsOf(words: readonly string[]): string[] {
	return inboxServerWords(words, inboxClientOnlyTexts([])).map(loosePattern);
}

/** Characters a pattern takes in the filter without its quotes, as the SDK writes it. */
function budgetOf(pb: PocketBase, pattern: string): number {
	return pb.filter('{:p}', { p: pattern }).length - 2;
}

/** Each placeholder replaced once, all at the same time: what the filter is meant to be. */
function singlePass(pb: PocketBase, raw: string, params: Record<string, unknown>): string {
	return raw.replace(/\{:(\w+)\}/g, (whole, name: string) =>
		Object.hasOwn(params, name) ? pb.filter(whole, { [name]: params[name] }) : whole
	);
}

/** `pb.filter` as older SDKs ran it: one parameter after the other, each with replaceAll. */
function stepwise(pb: PocketBase, raw: string, params: Record<string, unknown>): string {
	let filter = raw;
	for (const [name, value] of Object.entries(params)) {
		filter = filter.replaceAll(`{:${name}}`, pb.filter(`{:${name}}`, { [name]: value }));
	}
	return filter;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('clauses of the search (EG-2)', () => {
	it('writes out searchClause(n) of SEARCH_FIELDS for every word up to PICKER_SERVER_WORDS', () => {
		expect(SEARCH_CLAUSES).toHaveLength(PICKER_SERVER_WORDS);
		SEARCH_CLAUSES.forEach((clause, index) => {
			expect(clause).toBe(searchClause(index + 1));
			for (const field of SEARCH_FIELDS) expect(clause).toContain(`${field} ~ {:w${index + 1}}`);
		});
		expect(SEARCH_FIELDS).toEqual([
			'title',
			'source_url',
			'source_meta.from',
			'source_meta.sender',
			'source_meta.chat',
			'source_meta.copy_of.key',
			'ticket.key',
			'ticket.title'
		]);
		for (const n of [0, PICKER_SERVER_WORDS + 1, 1.5]) {
			expect(() => searchClause(n), String(n)).toThrow(RangeError);
		}
	});

	it('joins one clause per pattern only, and none without a search', async () => {
		const { pb, filter } = listing();
		await listHandledItems(pb, 'discarded', 1);
		expect(filter.mock.calls.at(-1)?.[0]).not.toContain('{:w1}');
		await listHandledItems(pb, 'discarded', 1, { patterns: patternsOf(['rechnung', 'strom']) });
		const raw = filter.mock.calls.at(-1)?.[0] ?? '';
		expect(raw).toContain(searchClause(1));
		expect(raw).toContain(searchClause(2));
		expect(raw).not.toContain('{:w3}');
	});
});

describe('length of the filter (EG-2 review, R-A10)', () => {
	it('stays below 3500 characters with five words of the full budget, quotes and backslashes, three channels, a target and the area', async () => {
		// In the filter `'` takes 1 character, `"` 2 and `\` 4 (`\\` in the pattern, each escaped in
		// the JSON string): four words of 38 characters and one of 48, exactly INBOX_PATTERN_BUDGET.
		const unit = `'"\\`;
		const words = [...'khjw'].map((letter) => `${unit.repeat(5)}${letter}`);
		words.push(`${unit.repeat(6)}\\`);
		const patterns = patternsOf(words);
		expect(patterns).toHaveLength(PICKER_SERVER_WORDS);

		const { pb, filter } = listing();
		expect(patterns.reduce((sum, pattern) => sum + budgetOf(pb, pattern), 0)).toBe(
			INBOX_PATTERN_BUDGET
		);
		await listHandledItems(pb, 'discarded', 1, {
			channels: ['whatsapp-web', 'whatsapp', 'telegram'],
			target: { project: PROJECT },
			patterns
		});
		expect(filter.mock.calls.at(-1)?.[0]).toContain(searchClause(PICKER_SERVER_WORDS));
		const sent = filter.mock.results.at(-1)?.value as string;
		expect(sent).toContain(`scope = "h:${HOUSE}"`);
		expect(sent).toContain(`target_project.parent = "${PROJECT}"`);
		expect(sent).toContain('channel = "telegram"');
		expect(sent.length).toBeLessThan(FILTER_LIMIT);
	});
});

describe('parameters of pb.filter (EG-2 review)', () => {
	it('never lets a word of the search reach into another parameter', async () => {
		// SDK 0.28 replaces every `{:name}` at once; older versions replaced one parameter after the
		// other, and a value that held `{:w2}` or `{:bylArea}` would then take in the value of that
		// parameter, quotes and all. The filter must come out the same either way.
		const words = searchWords('{:w2} a{:bylArea} {:c1}x {:target}y zz');
		const patterns = patternsOf(words);
		expect(patterns).toHaveLength(PICKER_SERVER_WORDS);
		for (const pattern of patterns) expect(pattern).not.toContain('{');

		const { pb, filter } = listing();
		await listHandledItems(pb, 'all', 1, {
			channels: ['mail'],
			target: { project: PROJECT },
			patterns
		});
		const [raw, params = {}] = filter.mock.calls.at(-1) ?? [''];
		const sent = filter.mock.results.at(-1)?.value as string;
		expect(sent).toBe(singlePass(pb, raw, params));
		expect(stepwise(pb, raw, params)).toBe(sent);
		// No name of a parameter is the start of another one, and no value holds the start `{:` of one.
		const names = Object.keys(params);
		expect(names).toEqual(expect.arrayContaining(['w1', 'w5', 'c1', 'target', 'bylArea']));
		for (const name of names) {
			expect(
				names.filter((other) => other !== name && other.startsWith(name)),
				name
			).toEqual([]);
		}
		for (const value of Object.values(params)) expect(String(value)).not.toContain('{:');
		// The check itself sees the difference: replaced one after the other, an unsafe value takes in
		// the next parameter.
		const unsafe = { ...params, w1: '%{:w2}%' };
		expect(stepwise(pb, raw, unsafe)).not.toBe(singlePass(pb, raw, unsafe));
	});
});
