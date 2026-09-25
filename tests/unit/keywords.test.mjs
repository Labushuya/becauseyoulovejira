// Keywords per channel, hook module (ADR-0020; E4 plan package 20): the common cases, the
// foldings, word characters and the checks of a stored list.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const keywords = loadHookLib('keywords.js');
const { cases } = JSON.parse(readFileSync(new URL('../fixtures/keywords/cases.json', import.meta.url), 'utf8'));

describe('keywords.js: matching', () => {
	it.each(cases)('$name', ({ keywords: list, texts, expect: expected }) => {
		expect(keywords.matchKeyword(list, texts)).toBe(expected);
	});

	it('folds umlauts both ways and collapses white space', () => {
		expect(keywords.fold('  Äpfel  und\tÖl ', 'a')).toBe('apfel und ol');
		expect(keywords.fold('  Äpfel  und\tÖl ', 'ae')).toBe('aepfel und oel');
		expect(keywords.fold('Straße', 'a')).toBe('strasse');
		expect(keywords.fold('a\u0308', 'ae')).toBe('ae');
		expect(keywords.fold('e\u0301', 'a')).toBe('e');
	});

	it('treats letters and digits as word characters, punctuation and emoji not', () => {
		for (const ch of ['a', 'z', '0', '9', 'þ', 'ж', '中']) expect(keywords.isWordChar(ch), ch).toBe(true);
		for (const ch of [' ', '-', '#', '(', '„', '×', '÷', '\u00a0', '\ud83d', '\ufe0f', '、']) {
			expect(keywords.isWordChar(ch), ch).toBe(false);
		}
	});

	it('tolerates missing values', () => {
		expect(keywords.matchKeyword(null, ['todo'])).toBe('');
		expect(keywords.matchKeyword(['todo'], null)).toBe('');
		expect(keywords.matchKeyword(['todo'], [null, undefined, 'todo'])).toBe('todo');
	});
});

describe('keywords.js: stored lists', () => {
	it('accepts empty and valid lists', () => {
		expect(keywords.listViolation(undefined)).toBe('');
		expect(keywords.listViolation(null)).toBe('');
		expect(keywords.listViolation([])).toBe('');
		expect(keywords.listViolation(['todo', '#byl', 'zu erledigen', 'x'.repeat(100)])).toBe('');
		expect(keywords.listViolation(Array.from({ length: 50 }, (_, i) => `k${i}`))).toBe('');
	});

	it('refuses other types, empty, long, multi-line entries and more than 50', () => {
		for (const value of [
			'todo',
			{ todo: true },
			[1],
			[''],
			['   '],
			['\u0301'],
			['x'.repeat(101)],
			['zu\nerledigen'],
			Array.from({ length: 51 }, (_, i) => `k${i}`)
		]) {
			expect(keywords.listViolation(value), JSON.stringify(value)).toBe(keywords.MESSAGE);
		}
	});

	it('reads a stored list without failing on bad entries', () => {
		expect(keywords.listOf(null)).toEqual([]);
		expect(keywords.listOf('todo')).toEqual([]);
		expect(keywords.listOf([' todo ', 3, '', 'x'.repeat(101), '#byl'])).toEqual(['todo', '#byl']);
		expect(keywords.listOf(Array.from({ length: 60 }, (_, i) => `k${i}`))).toHaveLength(50);
	});

	it('offers the suggestions of ADR-0020', () => {
		expect(keywords.SUGGESTIONS).toEqual(['todo', 'aufgabe', 'erledigen', 'ticket', '#byl']);
		expect(keywords.MAIL_BODY_CHARS).toBe(500);
	});
});

describe('keywords.js: lists of the file imports (package 21)', () => {
	it('accepts the shape of users.import_keywords', () => {
		for (const value of [
			null,
			undefined,
			'',
			{},
			{ eml: { keywords: ['rechnung'], match_body: true } },
			{ ics: { keywords: [] }, whatsapp: { keywords: ['milch'] } }
		]) {
			expect(keywords.importSettingsViolation(value), JSON.stringify(value)).toBe('');
		}
	});

	it('refuses other kinds, keys, types and bad lists', () => {
		for (const value of [
			'todo',
			[],
			{ mail: { keywords: [] } },
			{ eml: [] },
			{ ics: { keywords: [], match_body: true } },
			{ eml: { keywords: [], match_body: 'ja' } },
			{ whatsapp: { keywords: [], extra: 1 } }
		]) {
			expect(keywords.importSettingsViolation(value), JSON.stringify(value)).toBe(keywords.IMPORT_MESSAGE);
		}
		expect(keywords.importSettingsViolation({ eml: { keywords: [''] } })).toBe(keywords.MESSAGE);
	});

	it('reads one kind tolerantly', () => {
		expect(keywords.importSettingsOf({ eml: { keywords: [' a ', 1], match_body: true } }, 'eml')).toEqual({
			keywords: ['a'],
			matchBody: true
		});
		expect(keywords.importSettingsOf({ ics: { keywords: ['x'], match_body: true } }, 'ics')).toEqual({
			keywords: ['x'],
			matchBody: false
		});
		expect(keywords.importSettingsOf(null, 'whatsapp')).toEqual({ keywords: [], matchBody: false });
		expect(keywords.IMPORT_KINDS).toEqual(['eml', 'ics', 'whatsapp']);
	});
});
