// Keywords per channel (ADR-0020; E4 plan package 20). Pure: which text of a channel counts as a
// match, and the checks of a keyword list. Mirrors app/pb_hooks/lib/keywords.js character by
// character in its matching (tests/unit/web-keywords.test.mjs compares both); the mail helper
// bundles this module later.
//
// Matching ignores case and umlauts and looks for the start of a word:
// - lower case with toLowerCase (no locale function), umlauts and accents through a fixed table
//   (no String.prototype.normalize and no Intl, like the hook), white space collapsed;
// - two foldings: "ä" as "a" and as "ae" (both "ß" as "ss"); a keyword matches if it matches in
//   one of them, so "prüfen", "pruefen" and "prufen" find each other;
// - a keyword matches where the text starts with it and the character before is the start of the
//   text or no word character; nothing is required after it. Keywords may have several words.

export const KEYWORDS_MAX = 50;
export const KEYWORD_MAX_LENGTH = 100;
/** Characters of the text of a mail that are searched besides the subject (`match_body`). */
export const MAIL_BODY_CHARS = 500;
/** Offered with "Vorschläge übernehmen", never set without asking. */
export const KEYWORD_SUGGESTIONS: readonly string[] = Object.freeze([
	'todo',
	'aufgabe',
	'erledigen',
	'ticket',
	'#byl'
]);

type Folding = 'a' | 'ae';

const UMLAUTS: Readonly<Record<string, readonly [string, string]>> = {
	ä: ['a', 'ae'],
	ö: ['o', 'oe'],
	ü: ['u', 'ue']
};
// The same in both foldings. The final sigma becomes sigma: JavaScript lowers a word-final
// capital sigma to "ς", Go (Goja) to "σ".
const LETTERS: Readonly<Record<string, string>> = {
	à: 'a',
	á: 'a',
	â: 'a',
	ã: 'a',
	å: 'a',
	ā: 'a',
	ă: 'a',
	ą: 'a',
	æ: 'ae',
	ç: 'c',
	ć: 'c',
	č: 'c',
	ď: 'd',
	đ: 'd',
	è: 'e',
	é: 'e',
	ê: 'e',
	ë: 'e',
	ē: 'e',
	ė: 'e',
	ę: 'e',
	ě: 'e',
	ì: 'i',
	í: 'i',
	î: 'i',
	ï: 'i',
	ī: 'i',
	į: 'i',
	ı: 'i',
	ł: 'l',
	ñ: 'n',
	ń: 'n',
	ň: 'n',
	ò: 'o',
	ó: 'o',
	ô: 'o',
	õ: 'o',
	ø: 'o',
	ō: 'o',
	ő: 'o',
	œ: 'oe',
	ř: 'r',
	ß: 'ss',
	ẞ: 'ss',
	ś: 's',
	š: 's',
	ş: 's',
	ť: 't',
	ţ: 't',
	ù: 'u',
	ú: 'u',
	û: 'u',
	ů: 'u',
	ū: 'u',
	ű: 'u',
	ų: 'u',
	ý: 'y',
	ÿ: 'y',
	ź: 'z',
	ż: 'z',
	ž: 'z',
	ς: 'σ'
};
const DIAERESIS = 0x0308;
const SPACE = /[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;

function isCombining(code: number): boolean {
	return code >= 0x0300 && code <= 0x036f;
}

/** The text in one folding: lower case, umlauts and accents replaced, white space collapsed. */
export function foldKeywordText(value: string, variant: Folding): string {
	const source = value.toLowerCase();
	let out = '';
	for (let i = 0; i < source.length; i++) {
		const ch = source.charAt(i);
		const code = source.charCodeAt(i);
		if (isCombining(code)) continue;
		const umlaut = UMLAUTS[ch];
		if (umlaut !== undefined) {
			out += variant === 'ae' ? umlaut[1] : umlaut[0];
			continue;
		}
		if (Object.prototype.hasOwnProperty.call(LETTERS, ch)) {
			out += LETTERS[ch];
			continue;
		}
		if ((ch === 'a' || ch === 'o' || ch === 'u') && source.charCodeAt(i + 1) === DIAERESIS) {
			out += variant === 'ae' ? `${ch}e` : ch;
			i++;
			continue;
		}
		out += ch;
	}
	return out.replace(SPACE, ' ').replace(/^ | $/g, '');
}

/** Whether a character (one UTF-16 unit) belongs to a word; see ADR-0020 §2. */
export function isWordChar(ch: string): boolean {
	const code = ch.charCodeAt(0);
	if ((code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39)) return true;
	if (code < 0xc0 || code === 0xd7 || code === 0xf7) return false;
	if ((code >= 0x2000 && code <= 0x2bff) || (code >= 0x3000 && code <= 0x303f)) return false;
	if ((code >= 0xd800 && code <= 0xdfff) || (code >= 0xfe00 && code <= 0xfe0f)) return false;
	return true;
}

function startsWordAt(haystack: string, needle: string): boolean {
	if (needle === '') return false;
	let from = 0;
	while (from <= haystack.length - needle.length) {
		const index = haystack.indexOf(needle, from);
		if (index === -1) return false;
		if (index === 0 || !isWordChar(haystack.charAt(index - 1))) return true;
		from = index + 1;
	}
	return false;
}

/**
 * The first keyword of `keywords` (trimmed) that matches one of `texts`, or ''. The texts are
 * searched one by one: a keyword across two parts does not match.
 */
export function matchKeyword(keywords: readonly string[], texts: readonly string[]): string {
	const parts = texts
		.filter((value) => value !== '')
		.map((value) => [foldKeywordText(value, 'a'), foldKeywordText(value, 'ae')] as const);
	for (const raw of keywords) {
		const keyword = raw.trim();
		const shortForm = foldKeywordText(keyword, 'a');
		const longForm = foldKeywordText(keyword, 'ae');
		for (const [short, long] of parts) {
			if (startsWordAt(short, shortForm) || startsWordAt(long, longForm)) return keyword;
		}
	}
	return '';
}

/** Key of a keyword for duplicates: both foldings. */
export function keywordKey(keyword: string): string {
	return `${foldKeywordText(keyword, 'a')}\n${foldKeywordText(keyword, 'ae')}`;
}

/** The usable keywords of a stored value (JSON): invalid entries are left out. */
export function keywordListOf(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const list: string[] = [];
	for (const entry of value) {
		if (list.length >= KEYWORDS_MAX) break;
		if (typeof entry !== 'string') continue;
		const keyword = entry.trim();
		if (
			keyword !== '' &&
			keyword.length <= KEYWORD_MAX_LENGTH &&
			foldKeywordText(keyword, 'a') !== ''
		)
			list.push(keyword);
	}
	return list;
}

/** Why `input` cannot be added to `list`, or null. */
export function keywordInputError(list: readonly string[], input: string): string | null {
	const keyword = input.trim();
	if (keyword === '') return 'Bitte ein Stichwort eingeben.';
	if (keyword.length > KEYWORD_MAX_LENGTH) return 'Höchstens 100 Zeichen.';
	if (/[\r\n]/.test(keyword)) return 'Ein Stichwort steht in einer Zeile.';
	if (foldKeywordText(keyword, 'a') === '') return 'Das Stichwort ist leer.';
	const key = keywordKey(keyword);
	const same = list.find((entry) => keywordKey(entry) === key);
	if (same !== undefined) return `Das Stichwort „${same}“ gibt es schon.`;
	if (list.length >= KEYWORDS_MAX) return 'Höchstens 50 Stichwörter.';
	return null;
}

/** The list with the suggestions that are missing, up to the limit. */
export function withSuggestions(list: readonly string[]): string[] {
	const result = [...list];
	for (const suggestion of KEYWORD_SUGGESTIONS) {
		if (keywordInputError(result, suggestion) === null) result.push(suggestion);
	}
	return result;
}
