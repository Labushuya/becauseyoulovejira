// The sort of the day plan as a preference of this device (TP-5, ADR-0065 addendum TP-5, S5): in
// localStorage like the order of the comments (ADR-0044) and the view of the calendar (ADR-0053),
// for every day and both areas, never on the server. In a household every member sees his own view;
// the shared order changes only through "Als manuelle Reihenfolge übernehmen". Blocked or full
// storage never breaks the plan, a choice then lasts for this page; other tabs follow through the
// storage event.

import {
	DAY_PLAN_SORT_STORAGE_KEY,
	MANUAL_SORT,
	parseDayPlanSort,
	sameSort,
	serializeDayPlanSort,
	type DayPlanSort
} from '$lib/domain/day-plan-sort';

/** What the store of the plan needs of the preference: the chosen sort and the way to change it. */
export interface DayPlanSorting {
	readonly sort: DayPlanSort;
	choose(sort: DayPlanSort): void;
}

type PrefStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storageOf(win: Window | null): PrefStorage | null {
	try {
		return win?.localStorage ?? null;
	} catch {
		return null;
	}
}

export class DayPlanSortStore implements DayPlanSorting {
	readonly #win: Window | null;
	#sort = $state.raw<DayPlanSort>(MANUAL_SORT);

	/** Without a window (tests of the plan) the choice lasts for the store. */
	constructor(win: Window | null = null) {
		this.#win = win;
		try {
			this.#sort = parseDayPlanSort(storageOf(win)?.getItem(DAY_PLAN_SORT_STORAGE_KEY));
		} catch {
			this.#sort = MANUAL_SORT;
		}
	}

	get sort(): DayPlanSort {
		return this.#sort;
	}

	/** Remembers the sort on this device; "Manuell" removes the key. */
	choose(sort: DayPlanSort): void {
		if (sameSort(sort, this.#sort)) return;
		this.#sort = sort;
		try {
			const storage = storageOf(this.#win);
			const value = serializeDayPlanSort(sort);
			if (value === null) storage?.removeItem(DAY_PLAN_SORT_STORAGE_KEY);
			else storage?.setItem(DAY_PLAN_SORT_STORAGE_KEY, value);
		} catch {
			// Blocked or full storage: the choice lasts for this page.
		}
	}

	/** Follows the sort chosen in other tabs; returns the cleanup. */
	connect(): () => void {
		const win = this.#win;
		if (win === null) return () => undefined;
		const onstorage = (event: StorageEvent) => {
			// key null: the other tab cleared the whole storage.
			if (event.key === null) this.#sort = MANUAL_SORT;
			else if (event.key === DAY_PLAN_SORT_STORAGE_KEY) {
				this.#sort = parseDayPlanSort(event.newValue);
			}
		};
		win.addEventListener('storage', onstorage);
		return () => win.removeEventListener('storage', onstorage);
	}
}
