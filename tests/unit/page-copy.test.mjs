// Pure rules of the page copy (ADR-0031 section 6): accepted answers, character sets, bytes to
// text, the 2 MB cut and the new text and source_meta of the item.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('page-copy.js');
const inboxRules = loadHookLib('inbox-rules.js');

describe('answers', () => {
	it('takes 200 and 206 with HTML only', () => {
		expect([200, 206].map(rules.isAcceptedStatus)).toEqual([true, true]);
		expect([204, 301, 404, 500].map(rules.isAcceptedStatus)).toEqual([false, false, false, false]);
		expect(rules.isHtmlType('text/html')).toBe(true);
		expect(rules.isHtmlType('text/html; charset=utf-8')).toBe(true);
		expect(rules.isHtmlType('Application/XHTML+XML')).toBe(true);
		for (const type of ['', 'text/plain', 'application/pdf', 'text/htmlx', 'image/svg+xml', undefined]) {
			expect(rules.isHtmlType(type), String(type)).toBe(false);
		}
	});
});

describe('character sets', () => {
	it('reads the header first, then a meta tag, else utf-8', () => {
		expect(rules.charsetOf('text/html; charset=ISO-8859-1', '<meta charset="utf-8">')).toBe('iso-8859-1');
		expect(rules.charsetOf('text/html; charset="Windows-1252"', '')).toBe('windows-1252');
		expect(rules.charsetOf('text/html', '<meta charset="windows-1252">')).toBe('windows-1252');
		expect(rules.charsetOf('text/html', '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-15">')).toBe(
			'iso-8859-15'
		);
		expect(rules.charsetOf('text/html', `${' '.repeat(5000)}<meta charset="latin1">`)).toBe('utf-8');
		expect(rules.charsetOf('', '')).toBe('utf-8');
		expect(rules.isSingleByte('ISO-8859-1')).toBe(true);
		expect(rules.isSingleByte('utf-8')).toBe(false);
	});

	it('decodes Windows-1252 bytes, the range 0x80 to 0x9F included', () => {
		const bytes = [0x48, 0xe4, 0x80, 0x96, 0x9f, 0x81, 0xff];
		expect(rules.decodeWindows1252(bytes, bytes.length)).toBe('Hä€–Ÿ\u0081ÿ');
		expect(rules.decodeWindows1252(bytes, 2)).toBe('Hä');
		const many = new Array(10_000).fill(0x41);
		expect(rules.decodeWindows1252(many, many.length)).toBe('A'.repeat(10_000));
	});
});

describe('the 2 MB cut', () => {
	it('counts UTF-8 bytes and never cuts a character in half', () => {
		expect(rules.utf8Length('aä€😀')).toBe(1 + 2 + 3 + 4);
		expect(rules.utf8Prefix('aä€😀', 6)).toBe('aä€');
		expect(rules.utf8Prefix('aä€😀', 9)).toBe('aä€');
		expect(rules.utf8Prefix('aä€😀', 10)).toBe('aä€😀');
		expect(rules.utf8Prefix('ää', 3)).toBe('ä');
		expect(rules.MAX_PAGE_BYTES).toBe(2 * 1024 * 1024);
	});
});

describe('text and source_meta of the item', () => {
	it('puts the page below the excerpt, notes an empty page and cuts at 100 000 characters', () => {
		const compose = (excerpt, text) => rules.composeBody(excerpt, text, inboxRules.BODY_MAX_LENGTH, inboxRules.truncate);
		expect(compose('> Auszug', 'Seite')).toBe('> Auszug\n\n---\n\nSeite');
		expect(compose('  ', ' Seite ')).toBe('Seite');
		expect(compose('> Auszug', '  ')).toBe(`> Auszug\n\n---\n\n${rules.EMPTY_PAGE_TEXT}`);
		const long = compose('', 'x'.repeat(200_000));
		expect(long).toHaveLength(100_000);
		expect(long.endsWith('…')).toBe(true);
	});

	it('keeps the other keys of source_meta and adds the page', () => {
		const meta = rules.pageMeta(
			{ keyword: 'rezept', preset: { priority: 'high' } },
			{ fetchedAt: '2026-09-27T20:00:00.000Z', size: 1234, truncated: false, charset: 'utf-8', title: 't'.repeat(400) }
		);
		expect(meta).toEqual({
			keyword: 'rezept',
			preset: { priority: 'high' },
			page: { fetched_at: '2026-09-27T20:00:00.000Z', size: 1234, truncated: false, charset: 'utf-8', title: 't'.repeat(300) }
		});
	});
});
