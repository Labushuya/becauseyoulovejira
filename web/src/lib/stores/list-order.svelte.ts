// The order of a list by time ("Neueste zuerst" | "Älteste zuerst") as a preference of this device
// in localStorage under one key: the comments of a ticket (`byl-comments-order`, ADR-0044 §1, inside
// the CommentViewStore) and its sources with source tickets and follow-ups (`byl-sources-order`,
// QS-1, ADR-0031 addendum M). Only "oldest" is stored, the default removes the key. Storage that is
// blocked or full never breaks the list; the choice then lasts for this page. Other tabs follow
// through the storage event.

import { createContext } from 'svelte';
import {
	DEFAULT_LIST_ORDER,
	parseListOrder,
	serializeListOrder,
	type ListOrder
} from '$lib/domain/list-order';
import { SOURCE_ORDER_STORAGE_KEY } from '$lib/domain/sources';

function localStorageOf(
	win: Window | null
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
	try {
		return win?.localStorage ?? null;
	} catch {
		return null;
	}
}

export class ListOrderStore {
	readonly #win: Window | null;
	readonly #key: string;
	#order = $state<ListOrder>(DEFAULT_LIST_ORDER);

	constructor(win: Window | null, key: string) {
		this.#win = win;
		this.#key = key;
		try {
			this.#order = parseListOrder(localStorageOf(win)?.getItem(key));
		} catch {
			this.#order = DEFAULT_LIST_ORDER;
		}
	}

	/** The chosen order. */
	get order(): ListOrder {
		return this.#order;
	}

	/** Remembers the order on this device. */
	setOrder(order: ListOrder): void {
		if (order === this.#order) return;
		this.#order = order;
		try {
			const storage = localStorageOf(this.#win);
			const value = serializeListOrder(order);
			if (value === null) storage?.removeItem(this.#key);
			else storage?.setItem(this.#key, value);
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
			if (event.key === null) this.#order = DEFAULT_LIST_ORDER;
			else if (event.key === this.#key) this.#order = parseListOrder(event.newValue);
		};
		win.addEventListener('storage', onstorage);
		return () => win.removeEventListener('storage', onstorage);
	}
}

/** The order of the sources, source tickets and follow-ups of a ticket on this device (QS-1). */
export function sourceOrderStore(win: Window | null): ListOrderStore {
	return new ListOrderStore(win, SOURCE_ORDER_STORAGE_KEY);
}

const [getSourceOrder, setSourceOrder, hasSourceOrder] = createContext<ListOrderStore>();

/** The order of the sources of the (app) layout, or null outside it (tests of single components). */
export function findSourceOrder(): ListOrderStore | null {
	return hasSourceOrder() ? getSourceOrder() : null;
}

export { setSourceOrder };
