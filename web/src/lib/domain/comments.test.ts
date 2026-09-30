// Order, folding and remembered choices of the comments (ADR-0044), pure.

import { describe, expect, it } from 'vitest';
import {
	COMMENT_COLLAPSE_LINES,
	COMMENT_ORDER_LABELS,
	EXPANDED_COMMENTS_MAX,
	arrangeComments,
	collapseLimit,
	commentOrderAnnouncement,
	parseCommentOrder,
	parseExpandedComments,
	serializeCommentOrder,
	withExpanded
} from './comments';

const comments = [
	{ id: 'a', created: '2026-09-24 10:00:00.000Z' },
	{ id: 'b', created: '2026-09-24 11:00:00.000Z' },
	// Same time as b: the server order (created, rowid) puts c after b.
	{ id: 'c', created: '2026-09-24 11:00:00.000Z' },
	{ id: 'd', created: '2026-09-24 12:00:00.000Z' }
];
const ids = (list: readonly { id: string }[]) => list.map((comment) => comment.id);

describe('arrangeComments (ADR-0044 sections 1 and 2)', () => {
	it('puts the newest first by default and keeps the oldest first on request', () => {
		expect(ids(arrangeComments(comments, 'newest', null).rest)).toEqual(['d', 'c', 'b', 'a']);
		expect(ids(arrangeComments(comments, 'oldest', null).rest)).toEqual(['a', 'b', 'c', 'd']);
	});

	it('puts the pinned comment on top, in either order, and shows it only there', () => {
		for (const order of ['newest', 'oldest'] as const) {
			const arranged = arrangeComments(comments, order, 'b');
			expect(arranged.pinned?.id, order).toBe('b');
			expect(ids(arranged.rest), order).not.toContain('b');
			expect(arranged.rest, order).toHaveLength(3);
		}
		expect(ids(arrangeComments(comments, 'newest', 'b').rest)).toEqual(['d', 'c', 'a']);
	});

	it('ignores a pin whose comment is not loaded and a missing pin', () => {
		expect(arrangeComments(comments, 'oldest', 'x').pinned).toBeNull();
		expect(arrangeComments(comments, 'oldest', undefined).pinned).toBeNull();
		expect(ids(arrangeComments(comments, 'oldest', 'x').rest)).toEqual(['a', 'b', 'c', 'd']);
	});

	it('leaves the input alone', () => {
		const input = [...comments];
		arrangeComments(input, 'newest', 'a');
		expect(input).toEqual(comments);
	});
});

describe('stored order', () => {
	it('reads only "oldest"; everything else is the default', () => {
		expect(parseCommentOrder('oldest')).toBe('oldest');
		for (const raw of [null, undefined, '', 'newest', 'OLDEST', 'x']) {
			expect(parseCommentOrder(raw), String(raw)).toBe('newest');
		}
	});

	it('stores only "oldest" and removes the key for the default', () => {
		expect(serializeCommentOrder('oldest')).toBe('oldest');
		expect(serializeCommentOrder('newest')).toBeNull();
	});

	it('names both orders and announces a change', () => {
		expect(COMMENT_ORDER_LABELS).toEqual({ newest: 'Neueste zuerst', oldest: 'Älteste zuerst' });
		expect(commentOrderAnnouncement('newest')).toBe('Neueste Kommentare zuerst.');
		expect(commentOrderAnnouncement('oldest')).toBe('Älteste Kommentare zuerst.');
	});
});

describe('collapseLimit (ADR-0044 section 3)', () => {
	const line = 20;

	it('folds a comment higher than 14 lines to 12 lines', () => {
		expect(COMMENT_COLLAPSE_LINES).toBe(12);
		expect(collapseLimit(14 * line + 1, line)).toBe(12 * line);
		expect(collapseLimit(40 * line, line)).toBe(12 * line);
	});

	it('keeps a comment of up to 14 lines whole: the button would take the saved line', () => {
		expect(collapseLimit(3 * line, line)).toBeNull();
		expect(collapseLimit(12 * line, line)).toBeNull();
		expect(collapseLimit(14 * line, line)).toBeNull();
	});

	it('folds nothing without a layout', () => {
		expect(collapseLimit(0, line)).toBeNull();
		expect(collapseLimit(500, 0)).toBeNull();
		expect(collapseLimit(Number.NaN, line)).toBeNull();
		expect(collapseLimit(500, Number.NaN)).toBeNull();
	});
});

describe('unfolded comments of the tab', () => {
	const id = (n: number) => `comment${String(n).padStart(8, '0')}`;

	it('reads a JSON list of record IDs, each once, and ignores anything else', () => {
		expect(parseExpandedComments(JSON.stringify([id(1), id(2), id(1)]))).toEqual([id(1), id(2)]);
		expect(parseExpandedComments(JSON.stringify([id(1), 'x', 3, null]))).toEqual([id(1)]);
		for (const raw of [null, undefined, '', '{', '{"a":1}', '"x"']) {
			expect(parseExpandedComments(raw), String(raw)).toEqual([]);
		}
	});

	it('adds a choice last, removes it on folding, and keeps at most the maximum', () => {
		expect(withExpanded([id(1), id(2)], id(1), true)).toEqual([id(2), id(1)]);
		expect(withExpanded([id(1), id(2)], id(1), false)).toEqual([id(2)]);
		const full = Array.from({ length: EXPANDED_COMMENTS_MAX }, (_, n) => id(n));
		const next = withExpanded(full, id(9999), true);
		expect(next).toHaveLength(EXPANDED_COMMENTS_MAX);
		expect(next[0]).toBe(id(1));
		expect(next.at(-1)).toBe(id(9999));
		expect(parseExpandedComments(JSON.stringify([...full, id(9999)]))).toEqual(next);
	});
});
