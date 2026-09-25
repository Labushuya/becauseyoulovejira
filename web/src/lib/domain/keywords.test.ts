import { describe, expect, it } from 'vitest';
import {
	KEYWORD_SUGGESTIONS,
	foldKeywordText,
	keywordInputError,
	keywordListOf,
	matchKeyword,
	withSuggestions
} from './keywords';

// Keywords per channel (ADR-0020; E4 plan package 20). The common cases with the hook module are
// in tests/unit/web-keywords.test.mjs; here the checks of the editor.

describe('matchKeyword', () => {
	it('finds keywords at word starts, ignoring case and umlauts', () => {
		expect(matchKeyword(['todo'], ['Todo-Liste'])).toBe('todo');
		expect(matchKeyword(['prüfen'], ['Bitte pruefen'])).toBe('prüfen');
		expect(matchKeyword(['todo'], ['Fotodoku'])).toBe('');
		expect(matchKeyword([], ['todo'])).toBe('');
	});

	it('folds for display-independent comparison', () => {
		expect(foldKeywordText('Zu  Erledigen', 'a')).toBe('zu erledigen');
	});
});

describe('keywordInputError', () => {
	it('accepts a new keyword', () => {
		expect(keywordInputError(['todo'], 'aufgabe')).toBeNull();
		expect(keywordInputError([], 'x'.repeat(100))).toBeNull();
	});

	it('refuses empty, long, duplicate keywords and a full list', () => {
		expect(keywordInputError([], '   ')).toBe('Bitte ein Stichwort eingeben.');
		expect(keywordInputError([], 'x'.repeat(101))).toBe('Höchstens 100 Zeichen.');
		expect(keywordInputError([], '\u0301')).toBe('Das Stichwort ist leer.');
		expect(keywordInputError(['Prüfen'], 'PRÜFEN')).toBe('Das Stichwort „Prüfen“ gibt es schon.');
		expect(keywordInputError(['todo'], ' TODO ')).toBe('Das Stichwort „todo“ gibt es schon.');
		const full = Array.from({ length: 50 }, (_, i) => `k${i}`);
		expect(keywordInputError(full, 'neu')).toBe('Höchstens 50 Stichwörter.');
	});
});

describe('withSuggestions and keywordListOf', () => {
	it('adds only the missing suggestions', () => {
		expect(withSuggestions([])).toEqual([...KEYWORD_SUGGESTIONS]);
		expect(withSuggestions(['TODO', 'Einkauf'])).toEqual([
			'TODO',
			'Einkauf',
			'aufgabe',
			'erledigen',
			'ticket',
			'#byl'
		]);
	});

	it('reads stored lists and leaves out bad entries', () => {
		expect(keywordListOf(undefined)).toEqual([]);
		expect(keywordListOf([' todo ', 1, ''])).toEqual(['todo']);
	});
});
