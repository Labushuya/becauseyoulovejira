// A mail from the mailbox as inbox draft (ADR-0017 section 2, ADR-0020): parsed with postal-mime and
// the limits of the SPA, turned into a draft by the same function as a dropped .eml file
// (web/src/lib/domain/inbox-mail.ts, channel "mail"), and matched with the same keyword module.
// So a mailbox and a file give the same entry and the same duplicate key.

import PostalMime from 'postal-mime';
import type { InboxDraft } from '../../../web/src/lib/domain/inbox';
import {
	MAIL_MAX_BYTES,
	MAIL_PARSER_OPTIONS,
	mailToDraft,
	type ParsedMail
} from '../../../web/src/lib/domain/inbox-mail';
import { mailKeywordTexts, matchKeyword } from '../../../web/src/lib/domain/keywords';

export { MAIL_MAX_BYTES };

export type Origin = 'auto' | 'selected';

/** Body of POST /api/byl/ingest/items (app/pb_hooks/lib/ingest-rules.js, parseDraft). */
export interface IngestDraft {
	connection: string;
	origin: Origin;
	title: string;
	body: string;
	source_ref: string;
	source_date: string;
	source_meta: Record<string, unknown>;
}

/** Parses the source of a mail into an inbox draft (channel "mail"); throws for unreadable mails. */
export async function parseMail(source: Uint8Array): Promise<InboxDraft> {
	const mail = await PostalMime.parse(source, MAIL_PARSER_OPTIONS);
	return mailToDraft(mail as ParsedMail, 'mail');
}

/** The first keyword that matches the subject (with `matchBody` also the start of the text), or ''. */
export function keywordOf(
	draft: Pick<InboxDraft, 'title' | 'body'>,
	keywords: readonly string[],
	matchBody: boolean
): string {
	return matchKeyword(keywords, mailKeywordTexts(draft.title, draft.body ?? '', matchBody));
}

/** The draft in the fields of the ingest route; the route sets channel, kind and the keyword. */
export function ingestDraft(draft: InboxDraft, connection: string, origin: Origin): IngestDraft {
	return {
		connection,
		origin,
		title: draft.title,
		body: draft.body ?? '',
		source_ref: draft.sourceRef ?? '',
		source_date: draft.sourceDate ?? '',
		source_meta: draft.sourceMeta ?? {}
	};
}
