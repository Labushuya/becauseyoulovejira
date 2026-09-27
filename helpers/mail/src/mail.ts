// A mail from the mailbox as inbox draft (ADR-0017 section 2, ADR-0020): parsed with postal-mime and
// the limits of the SPA, turned into a draft by the same function as a dropped .eml file
// (web/src/lib/domain/inbox-mail.ts, channel "mail"), and matched with the same keyword module.
// So a mailbox and a file give the same entry and the same duplicate key.

import PostalMime, { decodeWords } from 'postal-mime';
import type { InboxDraft } from '../../../web/src/lib/domain/inbox';
import {
	MAIL_MAX_BYTES,
	MAIL_PARSER_OPTIONS,
	MAIL_PARTIAL_BYTES,
	mailMatchTexts,
	mailToDraft,
	type ParsedMail
} from '../../../web/src/lib/domain/inbox-mail';
import { mailKeywordTexts, matchKeyword } from '../../../web/src/lib/domain/keywords';

export { MAIL_MAX_BYTES, MAIL_PARTIAL_BYTES };

export type Origin = 'auto' | 'selected';

/**
 * A parsed mail: the inbox draft and the further texts keywords search with `match_body` (headers
 * To, Cc, Reply-To, Sender, List-Id, Organization and the HTML part as text; ADR-0020, addendum 2).
 */
export type MailDraft = InboxDraft & { matchTexts: string[] };

/** Body of POST /api/byl/ingest/items (app/pb_hooks/lib/ingest-rules.js, parseDraft). */
export interface IngestDraft {
	connection: string;
	origin: Origin;
	title: string;
	body: string;
	source_ref: string;
	source_date: string;
	source_meta: Record<string, unknown>;
	/** Only for the keyword check of the route; not stored. */
	match_texts: string[];
}

/**
 * Parses the source of a mail into an inbox draft (channel "mail"); throws for unreadable mails.
 * With `omittedSize` the source is only the beginning or the header of a mail over MAIL_MAX_BYTES,
 * which is stored without its file (ADR-0031 section 4).
 */
export async function parseMail(source: Uint8Array, omittedSize?: number): Promise<MailDraft> {
	const mail = (await PostalMime.parse(source, MAIL_PARSER_OPTIONS)) as ParsedMail;
	const draft = mailToDraft(mail, 'mail', omittedSize === undefined ? {} : { omittedSize });
	return { ...draft, matchTexts: mailMatchTexts(mail, decodeWords) };
}

/**
 * The draft of a mail over MAIL_MAX_BYTES without its file (ADR-0031 section 4): its first
 * MAIL_PARTIAL_BYTES parsed, or only its header when that beginning cannot be read. Null when the
 * mail is gone; throws when not even the header can be read.
 */
export async function largeMailDraft(
	session: {
		partialSource(uid: number, maxLength: number): Promise<Uint8Array | null>;
		header(uid: number): Promise<Uint8Array | null>;
	},
	uid: number,
	size: number
): Promise<MailDraft | null> {
	const beginning = await session.partialSource(uid, MAIL_PARTIAL_BYTES);
	if (beginning === null) return null;
	try {
		return await parseMail(beginning, size);
	} catch {
		const header = await session.header(uid);
		return header === null ? null : parseMail(header, size);
	}
}

/** The sender of a draft ("Name <address>" in source_meta.from), or ''. */
export function senderOf(draft: Pick<InboxDraft, 'sourceMeta'>): string {
	const from = draft.sourceMeta?.from;
	return typeof from === 'string' ? from : '';
}

/**
 * The first keyword that matches the subject or the sender (with `matchBody` also the headers, the
 * whole text and the HTML part), or ''.
 */
export function keywordOf(
	draft: Pick<InboxDraft, 'title' | 'body' | 'sourceMeta'> & { matchTexts?: readonly string[] },
	keywords: readonly string[],
	matchBody: boolean
): string {
	return matchKeyword(
		keywords,
		mailKeywordTexts(draft.title, draft.body ?? '', matchBody, senderOf(draft), draft.matchTexts ?? [])
	);
}

/** The draft in the fields of the ingest route; the route sets channel, kind and the keyword. */
export function ingestDraft(draft: MailDraft, connection: string, origin: Origin): IngestDraft {
	return {
		connection,
		origin,
		title: draft.title,
		body: draft.body ?? '',
		source_ref: draft.sourceRef ?? '',
		source_date: draft.sourceDate ?? '',
		source_meta: draft.sourceMeta ?? {},
		match_texts: draft.matchTexts
	};
}
