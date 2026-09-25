// Mail files for the inbox (E4 plan, package 8; ADR-0017 section 2): check type and size, parse
// with postal-mime and turn the mail into a draft with the file as protected original. The
// parser only decodes; nothing of the mail is rendered or loaded (no images, no links). The
// parser is loaded on first use, so the inbox view does not carry it before a file comes in.

import { mailToDraft } from './domain/inbox-mail';
import type { InboxDraft } from './domain/inbox';

/** Largest .eml file taken into the inbox (ADR-0017 section 2; schema of `original`). */
export const EML_MAX_BYTES = 10 * 1024 * 1024;

/** Limits of the parser against crafted mails (postal-mime options). */
const PARSER_OPTIONS = Object.freeze({
	maxNestingDepth: 50,
	maxHeadersSize: 512 * 1024,
	maxRfc822NestingDepth: 3,
	attachmentEncoding: 'arraybuffer' as const
});

export const NOT_EML_MESSAGE = 'Keine Mail-Datei (.eml).';
export const TOO_LARGE_MESSAGE = 'Größer als 10 MB, deshalb nicht übernommen.';
export const UNREADABLE_MESSAGE = 'Die Datei ließ sich nicht als Mail lesen.';

export type MailFileResult = { ok: true; draft: InboxDraft } | { ok: false; message: string };

/** True for a file that is meant to be a mail: `.eml` or the type `message/rfc822`. */
export function isMailFile(file: Pick<File, 'name' | 'type'>): boolean {
	return /\.eml$/i.test(file.name) || file.type.toLowerCase() === 'message/rfc822';
}

/**
 * Reads one mail file into an inbox draft (channel "eml") with the file as original. Other files,
 * files over 10 MB and files the parser refuses give a reason instead.
 */
export async function readMailFile(file: File): Promise<MailFileResult> {
	if (!isMailFile(file)) return { ok: false, message: NOT_EML_MESSAGE };
	if (file.size > EML_MAX_BYTES) return { ok: false, message: TOO_LARGE_MESSAGE };
	try {
		const { default: PostalMime } = await import('postal-mime');
		const email = await PostalMime.parse(await file.arrayBuffer(), PARSER_OPTIONS);
		return { ok: true, draft: { ...mailToDraft(email, 'eml'), original: file } };
	} catch {
		return { ok: false, message: UNREADABLE_MESSAGE };
	}
}
