// Mail to inbox draft (ADR-0017 section 2; E4 plan, T-8 and package 8). Pure and without
// dependencies: the SPA (mail-file.ts) and later the mail helper hand in what postal-mime parsed,
// so both ways give the same entry and the same duplicate key. HTML becomes plain text with an
// own function instead of DOMParser, which the helper process does not have; no external content
// is ever loaded, because nothing is rendered as HTML.

import { toPocketBaseTimestamp } from './format';
import { INBOX_BODY_MAX_LENGTH, type InboxDraft } from './inbox';
import { MAIL_EXTRA_TEXTS_MAX } from './keywords';
import { fitTitle } from './templates';

/** A mailbox or group as postal-mime gives it (structural copy, the domain imports no package). */
export interface MailAddress {
	name: string;
	address?: string;
	group?: MailAddress[];
}

/** The parts of a parsed mail that the inbox uses (postal-mime `Email`). */
export interface ParsedMail {
	from?: MailAddress;
	to?: MailAddress[];
	cc?: MailAddress[];
	replyTo?: MailAddress[];
	sender?: MailAddress;
	/** Every header with its lower-case name and the raw value (encoded words not decoded). */
	headers?: readonly { key: string; value: string }[];
	subject?: string;
	messageId?: string;
	/** ISO 8601, or the original text if it could not be read. */
	date?: string;
	text?: string;
	html?: string;
	attachments: readonly unknown[];
}

export const NO_SUBJECT = '(ohne Betreff)';

/**
 * Largest mail taken into the inbox with its original file, as file or from the mailbox (ADR-0017
 * section 2; schema of `original`). A larger mail comes without its file (ADR-0031 section 4).
 */
export const MAIL_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Beginning of a mail over MAIL_MAX_BYTES that is read and parsed (ADR-0031 section 4): the text
 * of a mail comes before its attachments, so it is usually in there.
 */
export const MAIL_PARTIAL_BYTES = 2 * 1024 * 1024;

/** Note at the end of the text of a mail stored without its file (ADR-0031 section 4). */
export const ORIGINAL_OMITTED_NOTE = '_Originaldatei nicht gespeichert: größer als 10 MB._';

/**
 * Limits of the parser (postal-mime options) against crafted mails. Shared by the SPA (mail files)
 * and the mail helper (mailboxes), so both ways have the same limits.
 */
export const MAIL_PARSER_OPTIONS = Object.freeze({
	maxNestingDepth: 50,
	maxHeadersSize: 512 * 1024,
	maxRfc822NestingDepth: 3,
	attachmentEncoding: 'arraybuffer' as const
});

/** Limits of the stable ID and of address lists in `source_meta` (schema: 500, 20 000 bytes). */
export const SOURCE_REF_MAX_LENGTH = 500;
const ADDRESS_LIST_MAX_LENGTH = 2000;

function oneLine(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

/** "Name <address>", the address alone, or the members of a group. */
export function formatAddress(entry: MailAddress): string {
	if (entry.group !== undefined) {
		const members = entry.group.map(formatAddress).filter((part) => part !== '');
		return oneLine(`${entry.name}: ${members.join(', ')}`);
	}
	const name = oneLine(entry.name ?? '');
	const address = oneLine(entry.address ?? '');
	if (address === '') return name;
	return name === '' || name === address ? address : `${name} <${address}>`;
}

function formatAddresses(list: readonly MailAddress[] | undefined): string {
	const text = (list ?? [])
		.map(formatAddress)
		.filter((part) => part !== '')
		.join(', ');
	return text.length <= ADDRESS_LIST_MAX_LENGTH
		? text
		: `${text.slice(0, ADDRESS_LIST_MAX_LENGTH - 1)}…`;
}

/** Date of the mail as PocketBase timestamp, null if missing or unreadable. */
export function mailDate(date: string | undefined): string | null {
	if (date === undefined || date.trim() === '') return null;
	const ms = Date.parse(date);
	return Number.isFinite(ms) ? toPocketBaseTimestamp(ms) : null;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	auml: 'ä',
	ouml: 'ö',
	uuml: 'ü',
	Auml: 'Ä',
	Ouml: 'Ö',
	Uuml: 'Ü',
	szlig: 'ß',
	euro: '€',
	copy: '©',
	reg: '®',
	trade: '™',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	laquo: '«',
	raquo: '»',
	bdquo: '„',
	ldquo: '“',
	rdquo: '”',
	sbquo: '‚',
	lsquo: '‘',
	rsquo: '’',
	middot: '·',
	bull: '•',
	shy: '',
	zwnj: '',
	zwj: ''
});

/** Decodes named and numeric character references; unknown ones stay as written. */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
		if (name.startsWith('#')) {
			const hex = name[1] === 'x' || name[1] === 'X';
			const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
			const valid = Number.isInteger(code) && code > 0 && code <= 0x10ffff;
			return valid && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : whole;
		}
		return Object.hasOwn(NAMED_ENTITIES, name) ? (NAMED_ENTITIES[name] ?? whole) : whole;
	});
}

/** Value of an attribute in the text of a start tag, entities decoded; '' without one. */
function attribute(tag: string, name: string): string {
	const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
	return decodeEntities(match?.[2] ?? match?.[3] ?? match?.[4] ?? '').trim();
}

const BLOCK_TAGS =
	/<\/?(p|div|section|article|header|footer|h[1-6]|ul|ol|table|thead|tbody|tfoot|blockquote|pre|hr|center|address|form|fieldset|dl|dt|dd)\b[^>]*>/gi;

/**
 * Plain text of an HTML mail (ADR-0017 section 2): scripts, styles, the head, comments and images
 * are removed; block elements and `br` become line breaks, list items "- ", table cells are
 * separated by " | "; links keep their text with an http(s) or mailto address in brackets;
 * entities are decoded; runs of spaces and more than one empty line are collapsed.
 */
export function htmlToText(html: string): string {
	let text = html
		.replace(/<!--[\s\S]*?(-->|$)/g, '')
		.replace(
			/<(script|style|head|title|template|noscript|svg|object|iframe)\b[\s\S]*?(<\/\1\s*>|$)/gi,
			''
		)
		.replace(/<img\b[^>]*>/gi, '');
	// Entities are decoded once at the end; the label stays encoded here, the address is encoded
	// again, so nothing is decoded twice.
	text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_whole, attributes: string, inner) => {
		const label = oneLine(String(inner).replace(/<[^>]*>/g, ''));
		const plainLabel = decodeEntities(label);
		const href = attribute(` ${attributes}`, 'href');
		const linkable = /^(https?:\/\/|mailto:)/i.test(href) && !/\s/.test(href);
		if (!linkable) return label;
		const encodedHref = href.replace(/&/g, '&amp;');
		if (label === '') return encodedHref;
		if (plainLabel === href || plainLabel === href.replace(/^mailto:/i, '')) return label;
		return `${label} (${encodedHref})`;
	});
	text = text
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<li\b[^>]*>/gi, '\n- ')
		.replace(/<\/li\s*>/gi, '')
		.replace(/<\/t[dh]\s*>\s*(?=<t[dh]\b)/gi, ' | ')
		.replace(/<tr\b[^>]*>/gi, '\n')
		.replace(/<\/tr\s*>/gi, '')
		.replace(BLOCK_TAGS, '\n')
		.replace(/<[^>]*>/g, '');
	return decodeEntities(text)
		.replace(/\r\n?/g, '\n')
		.split('\n')
		.map((line) => line.replace(/[ \t\f\v\u00a0]+/g, ' ').trim())
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Text of a mail: the plain part, else the HTML part as text. */
export function mailText(mail: Pick<ParsedMail, 'text' | 'html'>): string {
	const plain = (mail.text ?? '').replace(/\r\n?/g, '\n').trim();
	if (plain !== '') return plain;
	return mail.html === undefined ? '' : htmlToText(mail.html);
}

/** Headers searched by name besides the address headers (user decision of 2026-09-27). */
export const MAIL_MATCH_HEADERS: readonly string[] = Object.freeze(['list-id', 'organization']);

/**
 * Further texts of a mail that keywords search with `match_body` (ADR-0020, addendum 2), each its
 * own part: To, Cc, Reply-To and Sender as "Name <address>", List-Id and Organization (encoded
 * words decoded with `decode`, the decodeWords of postal-mime), and the HTML part as text when
 * the mail has a plain part too (else the HTML text is the text of the draft already). The
 * preheader of a newsletter is part of the HTML text. Empty parts are left out.
 */
export function mailMatchTexts(
	mail: Pick<ParsedMail, 'to' | 'cc' | 'replyTo' | 'sender' | 'headers' | 'text' | 'html'>,
	decode: (value: string) => string = (value) => value
): string[] {
	const texts = [
		formatAddresses(mail.to),
		formatAddresses(mail.cc),
		formatAddresses(mail.replyTo),
		mail.sender === undefined ? '' : formatAddress(mail.sender)
	];
	// The HTML text before the named headers: repeated headers must not push it past the limit.
	if ((mail.text ?? '').trim() !== '' && (mail.html ?? '') !== '')
		texts.push(htmlToText(mail.html ?? ''));
	for (const header of mail.headers ?? []) {
		if (MAIL_MATCH_HEADERS.includes(header.key)) texts.push(oneLine(decode(header.value)));
	}
	return texts.filter((text) => text !== '').slice(0, MAIL_EXTRA_TEXTS_MAX);
}

/**
 * Inbox draft of a parsed mail (channel "eml" for a file, "mail" for the mailbox; kind "mail"):
 * the subject as title ("(ohne Betreff)" without one), the text (HTML as plain text) with a note
 * on attachments, the Message-ID as stable ID, the date at the sender, and sender, recipients and
 * the number of attachments in `source_meta`. "Von" and "Datum" are shown from these fields by
 * the panel and the prefill of the ticket, so the text does not repeat them.
 *
 * With `omittedSize` the mail was larger than MAIL_MAX_BYTES and only its beginning (or only its
 * header) was parsed (ADR-0031 section 4): the draft comes without the file, marks it in
 * `source_meta` (`original_omitted`, `original_size`) and ends with ORIGINAL_OMITTED_NOTE instead
 * of counting attachments, which the cut-off mail cannot tell.
 */
export function mailToDraft(
	mail: ParsedMail,
	channel: 'eml' | 'mail' = 'eml',
	{ omittedSize }: { omittedSize?: number } = {}
): InboxDraft {
	const subject = oneLine(mail.subject ?? '');
	const omitted = omittedSize !== undefined;
	const attachments = omitted ? 0 : mail.attachments.length;
	const text = mailText(mail);
	const note = omitted
		? ORIGINAL_OMITTED_NOTE
		: attachments === 0
			? ''
			: attachments === 1
				? '_1 Anhang, nur in der Originaldatei._'
				: `_${attachments} Anhänge, nur in der Originaldatei._`;
	const room = INBOX_BODY_MAX_LENGTH - (note === '' ? 0 : note.length + 2);
	const body = [text.slice(0, room), note].filter((part) => part !== '').join('\n\n');
	const from = mail.from === undefined ? '' : formatAddress(mail.from);
	const to = formatAddresses(mail.to);
	const cc = formatAddresses(mail.cc);
	const meta: Record<string, unknown> = {};
	if (from !== '') meta.from = from;
	if (to !== '') meta.to = to;
	if (cc !== '') meta.cc = cc;
	if (attachments > 0) meta.attachments = attachments;
	if (oneLine(mail.text ?? '') === '' && (mail.html ?? '') !== '') meta.html_only = true;
	if (omitted) {
		meta.original_omitted = 'too_large';
		meta.original_size = Math.max(0, Math.trunc(omittedSize));
	}
	return {
		channel,
		kind: 'mail',
		title: fitTitle(subject === '' ? NO_SUBJECT : subject),
		body: body.slice(0, INBOX_BODY_MAX_LENGTH),
		sourceRef: oneLine(mail.messageId ?? '').slice(0, SOURCE_REF_MAX_LENGTH),
		sourceDate: mailDate(mail.date),
		sourceMeta: meta
	};
}
