// How the comments of a ticket are shown (ADR-0044 sections 1 and 3), for panel and full view:
// the order ("Neueste zuerst" or "Älteste zuerst") as a preference of this device in
// localStorage, the comments unfolded in this tab in sessionStorage. Storage that is blocked or
// full never breaks the list; the choice then lasts for this page. Other tabs follow the order
// through the storage event.

import { createContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import {
	COMMENT_ORDER_STORAGE_KEY,
	DEFAULT_COMMENT_ORDER,
	EXPANDED_COMMENTS_STORAGE_KEY,
	parseCommentOrder,
	parseExpandedComments,
	serializeCommentOrder,
	withExpanded,
	type CommentOrder
} from '$lib/domain/comments';

type PrefStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storageOf(
	win: Window | null,
	kind: 'localStorage' | 'sessionStorage'
): PrefStorage | null {
	try {
		return win?.[kind] ?? null;
	} catch {
		return null;
	}
}

export class CommentViewStore {
	readonly #win: Window | null;
	#order = $state<CommentOrder>(DEFAULT_COMMENT_ORDER);
	/** Unfolded comments in the order of the choice, the newest last. */
	#expanded: string[] = [];
	readonly #expandedSet = new SvelteSet<string>();

	constructor(win: Window | null) {
		this.#win = win;
		try {
			this.#order = parseCommentOrder(
				storageOf(win, 'localStorage')?.getItem(COMMENT_ORDER_STORAGE_KEY)
			);
		} catch {
			this.#order = DEFAULT_COMMENT_ORDER;
		}
		try {
			this.#expanded = parseExpandedComments(
				storageOf(win, 'sessionStorage')?.getItem(EXPANDED_COMMENTS_STORAGE_KEY)
			);
		} catch {
			this.#expanded = [];
		}
		for (const id of this.#expanded) this.#expandedSet.add(id);
	}

	/** Order of the comments below the pinned one. */
	get order(): CommentOrder {
		return this.#order;
	}

	/** Remembers the order on this device. */
	setOrder(order: CommentOrder): void {
		if (order === this.#order) return;
		this.#order = order;
		try {
			const storage = storageOf(this.#win, 'localStorage');
			const value = serializeCommentOrder(order);
			if (value === null) storage?.removeItem(COMMENT_ORDER_STORAGE_KEY);
			else storage?.setItem(COMMENT_ORDER_STORAGE_KEY, value);
		} catch {
			// Blocked or full storage: the choice lasts for this page.
		}
	}

	/** Whether a long comment is unfolded in this tab. */
	isExpanded(id: string): boolean {
		return this.#expandedSet.has(id);
	}

	/** Unfolds or folds a long comment for this tab. */
	setExpanded(id: string, expanded: boolean): void {
		if (expanded === this.#expandedSet.has(id)) return;
		const next = withExpanded(this.#expanded, id, expanded);
		this.#expanded = next;
		this.#expandedSet.clear();
		for (const known of next) this.#expandedSet.add(known);
		try {
			storageOf(this.#win, 'sessionStorage')?.setItem(
				EXPANDED_COMMENTS_STORAGE_KEY,
				JSON.stringify(next)
			);
		} catch {
			// Blocked or full storage: the choice lasts for this page.
		}
	}

	/** Follows the order chosen in other tabs; returns the cleanup. */
	connect(): () => void {
		const win = this.#win;
		if (win === null) return () => undefined;
		const onstorage = (event: StorageEvent) => {
			// key null: the other tab cleared the whole storage.
			if (event.key === null) this.#order = DEFAULT_COMMENT_ORDER;
			else if (event.key === COMMENT_ORDER_STORAGE_KEY) {
				this.#order = parseCommentOrder(event.newValue);
			}
		};
		win.addEventListener('storage', onstorage);
		return () => win.removeEventListener('storage', onstorage);
	}
}

const [getCommentView, setCommentView, hasCommentView] = createContext<CommentViewStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findCommentView(): CommentViewStore | null {
	return hasCommentView() ? getCommentView() : null;
}

export { getCommentView, setCommentView };
