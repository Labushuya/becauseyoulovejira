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
/**
 * Characters searched per text part of a mail with `match_body` (the text, the HTML part as text,
 * each header): as many as the text of an inbox entry holds. Before the decision of 2026-09-27
 * (ADR-0020, addendum 2) only the first 500 characters of the text.
 */
export const MAIL_TEXT_MAX_CHARS = 100_000;
/** Most further text parts of a mail besides subject, sender and text (headers, HTML part). */
export const MAIL_EXTRA_TEXTS_MAX = 12;
/** Label of the switch `match_body` at mailboxes and mail files (user decision of 2026-09-27). */
export const MAIL_MATCH_BODY_LABEL = 'Betreff, Absender, Kopfzeilen und Text durchsuchen';
/**
 * Whether the sender of a mail (name and address) is searched as well (user feedback, package A;
 * ADR-0020 addendum): mailbox, mailbox selection and .eml files.
 */
export const MAIL_MATCH_FROM = true;
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

/**
 * Which of `candidates` can be added to `list`, one after the other (a duplicate within the
 * candidates counts too): the accepted ones in order and the refused ones with their reason.
 */
export function planKeywordAdditions(
	list: readonly string[],
	candidates: readonly string[]
): { accepted: string[]; refused: { keyword: string; error: string }[] } {
	const next = [...list];
	const accepted: string[] = [];
	const refused: { keyword: string; error: string }[] = [];
	for (const candidate of candidates) {
		const error = keywordInputError(next, candidate);
		if (error === null) {
			const keyword = candidate.trim();
			next.push(keyword);
			accepted.push(keyword);
		} else {
			refused.push({ keyword: candidate.trim(), error });
		}
	}
	return { accepted, refused };
}

/** Kinds of file imports with their own list (users.import_keywords, ADR-0020 section 3). */
export const IMPORT_KINDS = ['eml', 'ics', 'whatsapp'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_KIND_LABELS: Readonly<Record<ImportKind, string>> = Object.freeze({
	eml: 'Mail-Dateien (.eml)',
	ics: 'Kalenderdateien (.ics)',
	whatsapp: 'WhatsApp-Export'
});

/** Where the keywords of a kind of file are searched (ADR-0020 section 1). */
export const IMPORT_SEARCH_TEXT: Readonly<Record<ImportKind, string>> = Object.freeze({
	eml: 'Gesucht wird in Betreff und Absender (Name und Adresse), auf Wunsch auch in den Kopfzeilen (An, Cc, Antwort an, Liste, Organisation) und im ganzen Text.',
	ics: 'Gesucht wird in Titel und Beschreibung der Termine.',
	whatsapp: 'Gesucht wird im Text der Nachricht.'
});

/**
 * Channels of the own inbox (ADR-0038) with their own list in the same field: an entry of the mode
 * "auto" is taken only with one of their keywords.
 */
export const CHANNEL_KINDS = ['api', 'whatsapp-web'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** Every list of users.import_keywords: the file imports and the channels of the own inbox. */
export const KEYWORD_LIST_KINDS = [...IMPORT_KINDS, ...CHANNEL_KINDS] as const;
export type KeywordListKind = (typeof KEYWORD_LIST_KINDS)[number];

export const CHANNEL_KIND_LABELS: Readonly<Record<ChannelKind, string>> = Object.freeze({
	api: 'Eigener Eingang (API)',
	'whatsapp-web': 'WhatsApp Web'
});

/** Where the keywords of a channel of the own inbox are searched. */
export const CHANNEL_SEARCH_TEXT: Readonly<Record<ChannelKind, string>> = Object.freeze({
	api: 'Gesucht wird in Titel und Text eines Eintrags mit „mode: auto“. Einträge mit „mode: manual“ kommen immer an.',
	'whatsapp-web':
		'Gesucht wird im Text der Nachricht, wenn die Erweiterung automatisch sendet. „In den Eingang“ kommt immer an.'
});

/** Keywords of one kind of file import; only mail files search the start of the text. */
export interface ImportKeywordList {
	keywords: string[];
	matchBody: boolean;
}

export type ImportKeywords = Readonly<Record<KeywordListKind, ImportKeywordList>>;

export const EMPTY_IMPORT_KEYWORDS: ImportKeywords = Object.freeze({
	eml: { keywords: [], matchBody: false },
	ics: { keywords: [], matchBody: false },
	whatsapp: { keywords: [], matchBody: false },
	api: { keywords: [], matchBody: false },
	'whatsapp-web': { keywords: [], matchBody: false }
});

function objectOf(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** The stored value of users.import_keywords as settings; missing or bad parts count as empty. */
export function importKeywordsOf(value: unknown): ImportKeywords {
	const stored = objectOf(value);
	const entry = (kind: KeywordListKind): ImportKeywordList => {
		const part = objectOf(stored[kind]);
		return {
			keywords: keywordListOf(part.keywords),
			matchBody: kind === 'eml' && part.match_body === true
		};
	};
	return {
		eml: entry('eml'),
		ics: entry('ics'),
		whatsapp: entry('whatsapp'),
		api: entry('api'),
		'whatsapp-web': entry('whatsapp-web')
	};
}

/** The settings as the server stores them (the shape keywords.js checks). */
export function importKeywordsValue(settings: ImportKeywords): Record<string, unknown> {
	return {
		eml: { keywords: settings.eml.keywords, match_body: settings.eml.matchBody },
		ics: { keywords: settings.ics.keywords },
		whatsapp: { keywords: settings.whatsapp.keywords },
		api: { keywords: settings.api.keywords },
		'whatsapp-web': { keywords: settings['whatsapp-web'].keywords }
	};
}

/**
 * Texts of a mail that are searched, each its own part: the subject, the sender ("Name <address>",
 * with MAIL_MATCH_FROM) and, with `matchBody`, the text and the `extra` parts (the headers To, Cc,
 * Reply-To, Sender, List-Id and Organization and the HTML part as text; at most
 * MAIL_EXTRA_TEXTS_MAX), each up to MAIL_TEXT_MAX_CHARS characters. Mirrors mailTexts of
 * app/pb_hooks/lib/keywords.js.
 */
export function mailKeywordTexts(
	title: string,
	body: string,
	matchBody: boolean,
	from: string,
	extra: readonly string[] = []
): string[] {
	const texts = [title];
	if (MAIL_MATCH_FROM && from !== '') texts.push(from);
	if (matchBody) {
		texts.push(body.slice(0, MAIL_TEXT_MAX_CHARS));
		for (const part of extra.slice(0, MAIL_EXTRA_TEXTS_MAX)) {
			if (part !== '') texts.push(part.slice(0, MAIL_TEXT_MAX_CHARS));
		}
	}
	return texts;
}
