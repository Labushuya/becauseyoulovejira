// Comments of a ticket (ADR-0044). Pure: the order of the list with the pinned comment on top,
// the rule of folding long comments, the remembered choices and the texts of the pinned comment,
// the latter shared with the hook.

/** Order of the comments below the pinned one (ADR-0044 section 1). */
export type CommentOrder = 'newest' | 'oldest';

/** The default: the newest comment directly below the input field, as in Jira. */
export const DEFAULT_COMMENT_ORDER: CommentOrder = 'newest';

/** localStorage key of the order on this device; only "oldest" is stored. */
export const COMMENT_ORDER_STORAGE_KEY = 'byl-comments-order';

/** Labels of the switch, in its order. */
export const COMMENT_ORDER_LABELS: Readonly<Record<CommentOrder, string>> = Object.freeze({
	newest: 'Neueste zuerst',
	oldest: 'Älteste zuerst'
});

export const COMMENT_ORDERS: readonly CommentOrder[] = Object.freeze(['newest', 'oldest']);

/** The stored value read strictly: only "oldest" counts, anything else is the default. */
export function parseCommentOrder(raw: string | null | undefined): CommentOrder {
	return raw === 'oldest' ? 'oldest' : DEFAULT_COMMENT_ORDER;
}

/** The value to store, or null to remove the key (default). */
export function serializeCommentOrder(order: CommentOrder): string | null {
	return order === 'oldest' ? 'oldest' : null;
}

/** What the live region says after a change of the order. */
export function commentOrderAnnouncement(order: CommentOrder): string {
	return order === 'oldest' ? 'Älteste Kommentare zuerst.' : 'Neueste Kommentare zuerst.';
}

/** The comments as the list shows them: the pinned one on top, the rest in the chosen order. */
export interface ArrangedComments<T> {
	pinned: T | null;
	rest: T[];
}

/**
 * Arranges `comments`, which come oldest first with equal times in the order of the server. The
 * pinned comment stands only on top; a pin whose comment is not (or no longer) loaded is ignored.
 * "Neueste zuerst" reverses the rest, equal times included.
 */
export function arrangeComments<T extends { id: string }>(
	comments: readonly T[],
	order: CommentOrder,
	pinnedId: string | null | undefined
): ArrangedComments<T> {
	const pinned = pinnedId ? (comments.find((comment) => comment.id === pinnedId) ?? null) : null;
	const rest = comments.filter((comment) => comment !== pinned);
	if (order === 'newest') rest.reverse();
	return { pinned, rest };
}

/** Lines a folded comment shows (ADR-0044 section 3). */
export const COMMENT_COLLAPSE_LINES = 12;

/** A comment folds only if at least this many lines more would be hidden than the button takes. */
export const COMMENT_COLLAPSE_SLACK_LINES = 2;

/**
 * Height of a folded comment in pixels, or null when it stays whole: a text higher than
 * COMMENT_COLLAPSE_LINES + COMMENT_COLLAPSE_SLACK_LINES lines of its font folds to
 * COMMENT_COLLAPSE_LINES lines. Measured on the rendered text, so images, lists and code count.
 * Unknown sizes (no layout) fold nothing.
 */
export function collapseLimit(contentHeight: number, lineHeight: number): number | null {
	if (!Number.isFinite(contentHeight) || !Number.isFinite(lineHeight)) return null;
	if (contentHeight <= 0 || lineHeight <= 0) return null;
	const limit = COMMENT_COLLAPSE_LINES * lineHeight;
	return contentHeight > limit + COMMENT_COLLAPSE_SLACK_LINES * lineHeight ? limit : null;
}

/** sessionStorage key of the comments unfolded in this tab (IDs only). */
export const EXPANDED_COMMENTS_STORAGE_KEY = 'byl-comments-expanded';

/** Unfolded comments remembered at most; the oldest choice goes first. */
export const EXPANDED_COMMENTS_MAX = 200;

/** Record IDs of PocketBase. */
const RECORD_ID = /^[a-z0-9]{15}$/;

/** The stored list read strictly: a JSON array of record IDs, each once, at most the maximum. */
export function parseExpandedComments(raw: string | null | undefined): string[] {
	if (raw === null || raw === undefined || raw === '') return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	const ids = [
		...new Set(parsed.filter((id): id is string => typeof id === 'string' && RECORD_ID.test(id)))
	];
	return ids.slice(-EXPANDED_COMMENTS_MAX);
}

/** The list after unfolding (`expanded`) or folding `id`; the newest choice stands last. */
export function withExpanded(ids: readonly string[], id: string, expanded: boolean): string[] {
	const others = ids.filter((known) => known !== id);
	if (!expanded) return others;
	return [...others, id].slice(-EXPANDED_COMMENTS_MAX);
}

/**
 * Texts of the codes of the pinned comment (ADR-0044 section 2), the same as in
 * app/pb_hooks/lib/ticket-rules.js (tests/unit/web-comments.test.mjs keeps them equal).
 */
export const PIN_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_pinned_comment_create: 'Ein neues Ticket hat noch keinen Kommentar zum Anpinnen.',
	validation_pinned_comment_missing: 'Der Kommentar wurde inzwischen gelöscht.',
	validation_pinned_comment_foreign: 'Anpinnen lässt sich nur ein Kommentar dieses Tickets.'
});

/** Flags around the pin (ADR-0044 section 2). */
export const PIN_FLAGS = Object.freeze({
	/** Info after pinning another comment than the pinned one; offers "Rückgängig". */
	replaced: 'Angepinnter Kommentar ersetzt.',
	/** "Rückgängig" found another pin than the one it would undo, and changed nothing. */
	changed: 'Der angepinnte Kommentar wurde inzwischen geändert. Nichts wurde überschrieben.',
	/** "Rückgängig" failed; the reason follows as description. */
	undoFailed: 'Rückgängig ging nicht.'
});

/**
 * What the comment list needs to pin (ADR-0044 section 2); the detail store of the ticket provides
 * it. `pinnedComment` is undefined while the server does not know pins (before the restart): the
 * list then offers no pinning.
 */
export interface CommentPinControl {
	readonly pinnedComment: string | null | undefined;
	/** Comment whose pin is being saved (its button waits), null otherwise. */
	readonly pinning: string | null;
	/** Why pinning or releasing this comment failed, null otherwise. */
	pinError(commentId: string): string | null;
	/** Pins the comment; another pinned one is replaced (with "Rückgängig" in a flag). */
	pin(commentId: string): Promise<boolean>;
	/** Releases the pin. */
	unpin(): Promise<boolean>;
}
