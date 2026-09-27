// Mail files for the inbox (E4 plan, package 8; ADR-0017 section 2): check type and size, parse
// with postal-mime and turn the mail into a draft with the file as protected original. The
// parser only decodes; nothing of the mail is rendered or loaded (no images, no links). The
// parser is loaded on first use, so the inbox view does not carry it before a file comes in.
// A file over 10 MB is read only from its beginning and saved without the file (ADR-0031
// section 4).

import {
	MAIL_MAX_BYTES,
	MAIL_PARSER_OPTIONS,
	MAIL_PARTIAL_BYTES,
	mailMatchTexts,
	mailToDraft
} from './domain/inbox-mail';
import type { InboxDraft } from './domain/inbox';

/** Largest .eml file taken into the inbox with its file (ADR-0017 section 2; schema of `original`). */
export const EML_MAX_BYTES = MAIL_MAX_BYTES;

export const NOT_EML_MESSAGE = 'Keine Mail-Datei (.eml).';
export const UNREADABLE_MESSAGE = 'Die Datei ließ sich nicht als Mail lesen.';

/**
 * A read mail file: the draft and the further texts keywords search with `match_body` (headers,
 * HTML part; mailMatchTexts), which are not stored.
 */
export type MailFileResult =
	{ ok: true; draft: InboxDraft; matchTexts?: string[] } | { ok: false; message: string };

/** True for a file that is meant to be a mail: `.eml` or the type `message/rfc822`. */
export function isMailFile(file: Pick<File, 'name' | 'type'>): boolean {
	return /\.eml$/i.test(file.name) || file.type.toLowerCase() === 'message/rfc822';
}

/**
 * Reads one mail file into an inbox draft (channel "eml") with the file as original. A file over
 * 10 MB gives a draft of its first MAIL_PARTIAL_BYTES without the file (sender, subject, date and
 * the beginning of the text). Other files and files the parser refuses give a reason instead.
 */
export async function readMailFile(file: File): Promise<MailFileResult> {
	if (!isMailFile(file)) return { ok: false, message: NOT_EML_MESSAGE };
	const large = file.size > EML_MAX_BYTES;
	try {
		const { default: PostalMime, decodeWords } = await import('postal-mime');
		const bytes = await (large ? file.slice(0, MAIL_PARTIAL_BYTES) : file).arrayBuffer();
		const email = await PostalMime.parse(bytes, MAIL_PARSER_OPTIONS);
		const draft = large
			? mailToDraft(email, 'eml', { omittedSize: file.size })
			: { ...mailToDraft(email, 'eml'), original: file };
		return { ok: true, draft, matchTexts: mailMatchTexts(email, decodeWords) };
	} catch {
		return { ok: false, message: UNREADABLE_MESSAGE };
	}
}
