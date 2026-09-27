// Keyword matching of the web app (web/src/lib/domain/keywords.ts) against the hook module
// (app/pb_hooks/lib/keywords.js): the same result for the common cases and for random texts
// (ADR-0020 §2; E4 plan, package 20).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import * as web from '../../web/src/lib/domain/keywords.ts';

const hook = loadHookLib('keywords.js');
const { cases } = JSON.parse(readFileSync(new URL('../fixtures/keywords/cases.json', import.meta.url), 'utf8'));

// Characters that exercise every branch: letters, umlauts (also decomposed), accents, digits,
// word boundaries, spaces of several kinds, emoji halves and other scripts.
const ALPHABET = [
	'a', 'o', 'u', 'e', 't', 'd', 'Ä', 'ä', 'ö', 'Ü', 'ß', 'ẞ', 'é', 'ç', '\u0308', '\u0301', '1', '#',
	'-', ' ', '  ', '\n', '\u00a0', '\u2003', '„', '×', 'ж', 'Σ', 'ς', '\ud83d\udcdd', '\ufe0f', 'I', 'İ'
];

function random(seed) {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		return state / 0x7fffffff;
	};
}

function sample(next, length) {
	let text = '';
	for (let i = 0; i < length; i++) text += ALPHABET[Math.floor(next() * ALPHABET.length)];
	return text;
}

describe('keywords: web app against the hooks', () => {
	it.each(cases)('$name', ({ keywords, texts, expect: expected }) => {
		expect(web.matchKeyword(keywords, texts)).toBe(expected);
		expect(hook.matchKeyword(keywords, texts)).toBe(expected);
	});

	it('folds and matches random texts the same way', () => {
		const next = random(20260925);
		for (let round = 0; round < 3000; round++) {
			const text = sample(next, 1 + Math.floor(next() * 12));
			const keyword = sample(next, 1 + Math.floor(next() * 3));
			for (const variant of ['a', 'ae']) {
				expect(web.foldKeywordText(text, variant), JSON.stringify(text)).toBe(hook.fold(text, variant));
			}
			expect(web.matchKeyword([keyword], [text]), JSON.stringify([keyword, text])).toBe(
				hook.matchKeyword([keyword], [text])
			);
		}
	});

	it('shares limits, suggestions and the reading of stored lists', () => {
		expect(web.KEYWORDS_MAX).toBe(hook.MAX_KEYWORDS);
		expect(web.KEYWORD_MAX_LENGTH).toBe(hook.MAX_LENGTH);
		expect(web.MAIL_TEXT_MAX_CHARS).toBe(hook.MAIL_TEXT_MAX_CHARS);
		expect(web.MAIL_EXTRA_TEXTS_MAX).toBe(hook.MAIL_EXTRA_TEXTS_MAX);
		expect(web.MAIL_MATCH_FROM).toBe(hook.MAIL_MATCH_FROM);
		expect(web.MAIL_MATCH_FROM).toBe(true);
		expect([...web.KEYWORD_SUGGESTIONS]).toEqual(hook.SUGGESTIONS);
		for (const value of [null, 'todo', [' todo ', 3, '', 'x'.repeat(101), '#byl', '\u0301']]) {
			expect(web.keywordListOf(value)).toEqual(hook.listOf(value));
		}
		for (const keyword of ['Prüfen', 'pruefen', '#BYL']) expect(web.keywordKey(keyword)).toBe(hook.keyOf(keyword));
	});

	it('searches the same texts of a mail (subject, sender, optionally headers and the whole text)', () => {
		const body = `${'ä'.repeat(99_999)}😀 und noch mehr Text`;
		const from = 'Europa-Go Reisen <info@europa-go.de>';
		const extra = ['anna@example.com', '', 'Liste <liste.example.com>', 'y'.repeat(100_001)];
		for (const matchBody of [false, true]) {
			for (const sender of ['', from]) {
				for (const more of [undefined, [], extra, Array.from({ length: 20 }, (_, i) => `teil ${i}`)]) {
					expect(hook.mailTexts('Betreff', body, matchBody, sender, more)).toEqual(
						web.mailKeywordTexts('Betreff', body, matchBody, sender, more)
					);
				}
			}
		}
		const texts = hook.mailTexts('Betreff', body, true, '', extra);
		expect(texts[1]).toHaveLength(hook.MAIL_TEXT_MAX_CHARS);
		expect(texts.slice(2, 4)).toEqual(['anna@example.com', 'Liste <liste.example.com>']);
		expect(texts[4]).toHaveLength(100_000);
		expect(hook.mailTexts('Betreff', '', true, '', Array.from({ length: 20 }, (_, i) => `teil ${i}`))).toHaveLength(
			2 + hook.MAIL_EXTRA_TEXTS_MAX
		);
		expect(web.mailKeywordTexts('Betreff', body, false, from, extra)).toEqual(['Betreff', from]);
		expect(web.mailKeywordTexts('Betreff', 'Text', true, from)).toEqual(['Betreff', from, 'Text']);
		expect(hook.mailTexts('Betreff', body, false, undefined)).toEqual(['Betreff']);
		expect(hook.mailTexts('Betreff', 'Text', true, '', 'kein Array')).toEqual(['Betreff', 'Text']);
		// Subject, sender and text stay separate parts: a phrase across them does not match.
		expect(web.matchKeyword(['betreff europa'], web.mailKeywordTexts('Betreff', '', false, 'Europa'))).toBe('');
	});

	it('finds a keyword only in the sender, in the text or in the subject (package A, "europa-go")', () => {
		const keywords = ['europa-go'];
		const cases = [
			['Angebot', 'Hallo', false, 'Europa-Go Reisen <info@europa-go.de>', 'europa-go'],
			['Angebot', 'Hallo', false, 'info@europa-go.de', 'europa-go'],
			['Angebot', 'Buchen bei Europa-Go.de', true, 'Anna <anna@example.com>', 'europa-go'],
			['Angebot', 'Buchen bei Europa-Go.de', false, 'Anna <anna@example.com>', ''],
			['Neu: EUROPA-GO', '', false, '', 'europa-go'],
			['Angebot', 'Hallo', false, 'Anna <anna@example.com>', '']
		];
		for (const [title, body, matchBody, from, expected] of cases) {
			expect(web.matchKeyword(keywords, web.mailKeywordTexts(title, body, matchBody, from))).toBe(expected);
			expect(hook.matchKeyword(keywords, hook.mailTexts(title, body, matchBody, from))).toBe(expected);
		}
	});

	it('finds a keyword deep in the text, only in To or Cc, or only in the HTML part (full inbox)', () => {
		const deep = `${'Newsletter-Text ohne Treffer. '.repeat(200)}Abmelden bei Europa-Go`;
		expect(deep.indexOf('Europa-Go')).toBeGreaterThan(5000);
		const cases = [
			[['europa-go'], deep, [], true, 'europa-go'],
			[['europa-go'], deep, [], false, ''],
			[['projekt-x'], 'Hallo', ['Team Projekt-X <team@example.com>'], true, 'projekt-x'],
			[['projekt-x'], 'Hallo', ['Team Projekt-X <team@example.com>'], false, ''],
			[['prüfen'], 'Hallo', ['Anna <anna@example.com>', 'Bitte bis Freitag pruefen.'], true, 'prüfen'],
			[['to-do'], 'Hallo', ['<to-do.liste.example.com>'], true, 'to-do'],
			[['todo'], 'Hallo', ['Fotodoku <foto@example.com>'], true, '']
		];
		for (const [keywords, body, extra, matchBody, expected] of cases) {
			expect(web.matchKeyword(keywords, web.mailKeywordTexts('Betreff', body, matchBody, '', extra))).toBe(expected);
			expect(hook.matchKeyword(keywords, hook.mailTexts('Betreff', body, matchBody, '', extra))).toBe(expected);
		}
	});

	it('stores the lists of the file imports in the shape the hook accepts (package 21)', () => {
		expect([...web.IMPORT_KINDS]).toEqual(hook.IMPORT_KINDS);
		const settings = {
			eml: { keywords: ['rechnung'], matchBody: true },
			ics: { keywords: ['todo', '#byl'], matchBody: false },
			whatsapp: { keywords: [], matchBody: false }
		};
		const value = web.importKeywordsValue(settings);
		expect(hook.importSettingsViolation(value)).toBe('');
		expect(web.importKeywordsOf(value)).toEqual(settings);
		for (const kind of web.IMPORT_KINDS) {
			expect(hook.importSettingsOf(value, kind)).toEqual(web.importKeywordsOf(value)[kind]);
		}
	});

	it('accepts in the hook every list the web app can build', () => {
		let list = [];
		for (const input of ['todo', ' Zu erledigen ', 'x'.repeat(100), ...web.KEYWORD_SUGGESTIONS]) {
			if (web.keywordInputError(list, input) === null) list = [...list, input.trim()];
		}
		list = web.withSuggestions(list);
		expect(hook.listViolation(list)).toBe('');
	});
});
