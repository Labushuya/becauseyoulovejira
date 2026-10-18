// How the comments of a ticket are shown (ADR-0044 sections 1 and 3), for panel and full view:
// the order ("Neueste zuerst" or "Älteste zuerst") as a preference of this device in localStorage
// (a ListOrderStore, the same as for the sources since QS-1), the comments unfolded in this tab in
// sessionStorage. Storage that is blocked or full never breaks the list; the choice then lasts for
// this page. Other tabs follow the order through the storage event.

import { createContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import {
	COMMENT_ORDER_STORAGE_KEY,
	EXPANDED_COMMENTS_STORAGE_KEY,
	parseExpandedComments,
	withExpanded,
	type CommentOrder
} from '$lib/domain/comments';
import { ListOrderStore } from './list-order.svelte';

function sessionStorageOf(win: Window | null): Pick<Storage, 'getItem' | 'setItem'> | null {
	try {
		return win?.sessionStorage ?? null;
	} catch {
		return null;
	}
}

export class CommentViewStore {
	readonly #win: Window | null;
	readonly #order: ListOrderStore;
	/** Unfolded comments in the order of the choice, the newest last. */
	#expanded: string[] = [];
	readonly #expandedSet = new SvelteSet<string>();

	constructor(win: Window | null) {
		this.#win = win;
		this.#order = new ListOrderStore(win, COMMENT_ORDER_STORAGE_KEY);
		try {
			this.#expanded = parseExpandedComments(
				sessionStorageOf(win)?.getItem(EXPANDED_COMMENTS_STORAGE_KEY)
			);
		} catch {
			this.#expanded = [];
		}
		for (const id of this.#expanded) this.#expandedSet.add(id);
	}

	/** Order of the comments below the pinned one. */
	get order(): CommentOrder {
		return this.#order.order;
	}

	/** Remembers the order on this device. */
	setOrder(order: CommentOrder): void {
		this.#order.setOrder(order);
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
			sessionStorageOf(this.#win)?.setItem(EXPANDED_COMMENTS_STORAGE_KEY, JSON.stringify(next));
		} catch {
			// Blocked or full storage: the choice lasts for this page.
		}
	}

	/** Follows the order chosen in other tabs; returns the cleanup. */
	connect(): () => void {
		return this.#order.connect();
	}
}

const [getCommentView, setCommentView, hasCommentView] = createContext<CommentViewStore>();

/** The store of the (app) layout, or null outside it (tests of single components). */
export function findCommentView(): CommentViewStore | null {
	return hasCommentView() ? getCommentView() : null;
}

export { getCommentView, setCommentView };
