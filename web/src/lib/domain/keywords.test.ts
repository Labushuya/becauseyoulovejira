import { describe, expect, it } from 'vitest';
import {
	EMPTY_IMPORT_KEYWORDS,
	KEYWORD_SUGGESTIONS,
	importKeywordsOf,
	importKeywordsValue,
	mailKeywordTexts,
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

describe('keywords of the file imports (package 21)', () => {
	it('reads stored settings tolerantly and writes them back', () => {
		expect(importKeywordsOf(null)).toEqual(EMPTY_IMPORT_KEYWORDS);
		const settings = importKeywordsOf({
			eml: { keywords: ['rechnung', 3], match_body: true },
			ics: { keywords: 'todo', match_body: true },
			other: {}
		});
		expect(settings).toEqual({
			eml: { keywords: ['rechnung'], matchBody: true },
			ics: { keywords: [], matchBody: false },
			whatsapp: { keywords: [], matchBody: false }
		});
		expect(importKeywordsValue(settings)).toEqual({
			eml: { keywords: ['rechnung'], match_body: true },
			ics: { keywords: [] },
			whatsapp: { keywords: [] }
		});
	});

	it('searches the start of a mail text only on request', () => {
		const body = `${'x '.repeat(260)}todo`;
		expect(mailKeywordTexts('Betreff', body, false, '')).toEqual(['Betreff']);
		const texts = mailKeywordTexts('Betreff', body, true, '');
		expect(texts[1]).toHaveLength(500);
		expect(matchKeyword(['todo'], texts)).toBe('');
		expect(matchKeyword(['todo'], mailKeywordTexts('Betreff', 'todo: zahlen', true, ''))).toBe(
			'todo'
		);
	});

	it('searches the sender of a mail, name and address (package A)', () => {
		const from = 'Europa-Go Reisen <info@europa-go.de>';
		expect(mailKeywordTexts('Betreff', 'Text', false, from)).toEqual(['Betreff', from]);
		expect(matchKeyword(['europa-go'], mailKeywordTexts('Angebot', '', false, from))).toBe(
			'europa-go'
		);
		expect(matchKeyword(['reisen'], mailKeywordTexts('Angebot', '', false, from))).toBe('reisen');
		expect(matchKeyword(['europa-go'], mailKeywordTexts('Angebot', '', false, ''))).toBe('');
	});

	it('ignores case in keyword and text, also with hyphens and domains (package A)', () => {
		for (const keyword of ['europa-go', 'Europa-Go', 'EUROPA-GO']) {
			for (const text of ['europa-go', 'Europa-Go', 'EUROPA-GO.DE', 'info@Europa-Go.de']) {
				expect(matchKeyword([keyword], [text]), `${keyword} in ${text}`).toBe(keyword);
			}
		}
		for (const keyword of ['Todo', 'TODO', 'todo']) {
			expect(matchKeyword([keyword], ['tOdO: Steuer'])).toBe(keyword);
		}
	});
});
