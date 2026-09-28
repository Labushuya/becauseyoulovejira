// Column preferences of the tables (ADR-0030): width and visibility per table, stored on this
// device in localStorage under `byl-columns-<table>` (like theme and accent, not per user until
// E7). One store per table; the registry in the (app) layout holds them and follows changes of
// other tabs through the storage event (like AccentStore). A storage that throws (blocked,
// private mode) keeps the choice for this page.

import { getContext, setContext } from 'svelte';
import {
	TABLES,
	changedOptions,
	clampWidth,
	columnWidth,
	optionValue,
	defaultColumnPrefs,
	isDefaultColumnPrefs,
	isResizable,
	parseColumnPrefs,
	serializeColumnPrefs,
	type ColumnPrefs,
	type ColumnSpec,
	type TableId,
	type TableSpec
} from '$lib/domain/columns';
import { SILENT_FLAGS, type FlagSink } from './flags.svelte';

/** What the stores need of localStorage. */
export type ColumnStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Title of the info flag after "Standard wiederherstellen". */
export const COLUMNS_RESET_FLAG = 'Spalten zurückgesetzt';

function read(storage: ColumnStorage | null, table: TableSpec): ColumnPrefs {
	try {
		return parseColumnPrefs(storage?.getItem(table.storageKey), table.columns, table.options);
	} catch {
		return defaultColumnPrefs(table.columns);
	}
}

/** The preferences of one table. */
export class ColumnPrefsStore {
	prefs = $state<ColumnPrefs>({ widths: {}, hidden: [] });

	readonly table: TableSpec;
	readonly #storage: ColumnStorage | null;
	readonly #flags: FlagSink;

	constructor(table: TableSpec, storage: ColumnStorage | null, flags: FlagSink = SILENT_FLAGS) {
		this.table = table;
		this.#storage = storage;
		this.#flags = flags;
		this.prefs = read(storage, table);
	}

	#spec(id: string): ColumnSpec | undefined {
		return this.table.columns.find((entry) => entry.id === id);
	}

	/** Current width of a column (the chosen one or its default). */
	widthOf(id: string): number {
		const spec = this.#spec(id);
		return spec === undefined ? 0 : columnWidth(spec, this.prefs);
	}

	/** Whether the user switched the column off. */
	isHidden(id: string): boolean {
		return this.prefs.hidden.includes(id);
	}

	/** Sets the width of a resizable column (clamped) and stores it; returns the width set. */
	setWidth(id: string, px: number): number {
		const spec = this.#spec(id);
		if (spec === undefined || !isResizable(spec)) return 0;
		const width = clampWidth(spec, px);
		if (this.prefs.widths[id] !== width) {
			this.#save({ ...this.prefs, widths: { ...this.prefs.widths, [id]: width } });
		}
		return width;
	}

	/** Shows or hides an optional column; required ones stay. */
	setVisible(id: string, visible: boolean): void {
		const spec = this.#spec(id);
		if (spec === undefined || spec.required || this.isHidden(id) === !visible) return;
		const hidden = visible
			? this.prefs.hidden.filter((entry) => entry !== id)
			: this.table.columns
					.filter((entry) => entry.id === id || this.prefs.hidden.includes(entry.id))
					.map((entry) => entry.id);
		this.#save({ ...this.prefs, hidden });
	}

	/** Value of a switch of the table, e.g. "Unteraufgaben einrücken" (ADR-0033 section 5). */
	option(id: string): boolean {
		const option = this.table.options.find((entry) => entry.id === id);
		return option === undefined ? false : optionValue(this.prefs, option);
	}

	/** Sets a switch of the table; its default is not stored. */
	setOption(id: string, value: boolean): void {
		if (!this.table.options.some((entry) => entry.id === id) || this.option(id) === value) return;
		const options = changedOptions({ ...this.prefs.options, [id]: value }, this.table.options);
		const { widths, hidden } = this.prefs;
		this.#save(options === undefined ? { widths, hidden } : { widths, hidden, options });
	}

	/**
	 * "Standard wiederherstellen": widths, visibility and switches of this table, with an info
	 * flag.
	 */
	reset(): void {
		this.#save(defaultColumnPrefs(this.table.columns));
		this.#flags.show({ tone: 'info', title: COLUMNS_RESET_FLAG });
	}

	/** Takes a value written by another tab (null: the key was removed). */
	sync(raw: string | null): void {
		this.prefs = parseColumnPrefs(raw, this.table.columns, this.table.options);
	}

	#save(prefs: ColumnPrefs): void {
		this.prefs = prefs;
		if (this.#storage === null) return;
		try {
			const key = this.table.storageKey;
			if (isDefaultColumnPrefs(prefs, this.table.columns)) this.#storage.removeItem(key);
			else this.#storage.setItem(key, serializeColumnPrefs(prefs, this.table.columns));
		} catch {
			// The choice lasts for this page.
		}
	}
}

function storageOf(win: Window | null): ColumnStorage | null {
	try {
		return win?.localStorage ?? null;
	} catch {
		return null;
	}
}

/** One store per table, created on first use, and the listener for other tabs. */
export class ColumnPrefsRegistry {
	readonly #win: Window | null;
	readonly #flags: FlagSink;
	/** Not reactive itself: the stores inside hold the state. */
	readonly #stores: Partial<Record<TableId, ColumnPrefsStore>> = {};

	constructor(win: Window | null, flags: FlagSink = SILENT_FLAGS) {
		this.#win = win;
		this.#flags = flags;
	}

	get(id: TableId): ColumnPrefsStore {
		const store =
			this.#stores[id] ?? new ColumnPrefsStore(TABLES[id], storageOf(this.#win), this.#flags);
		this.#stores[id] = store;
		return store;
	}

	/** Follows changes of the keys in other tabs (storage event); returns the unsubscribe. */
	connect(): () => void {
		const win = this.#win;
		if (win === null) return () => undefined;
		const onstorage = (event: StorageEvent) => {
			for (const store of Object.values(this.#stores)) {
				// key null: the other tab cleared the whole storage.
				if (event.key === null) store.sync(null);
				else if (event.key === store.table.storageKey) store.sync(event.newValue);
			}
		};
		win.addEventListener('storage', onstorage);
		return () => win.removeEventListener('storage', onstorage);
	}
}

/** Context key; exported for component tests that render a table with a registry. */
export const COLUMN_PREFS_CONTEXT = Symbol('byl-column-prefs');
const KEY = COLUMN_PREFS_CONTEXT;

/** Puts the registry of the (app) layout into the context. */
export function setColumnPrefsRegistry(registry: ColumnPrefsRegistry): ColumnPrefsRegistry {
	return setContext(KEY, registry);
}

/**
 * The preferences of a table from the registry of the (app) layout. Outside it (component tests)
 * the table gets a store of its own on the localStorage of the window, without flags and without
 * following other tabs.
 */
export function getColumnPrefs(id: TableId): ColumnPrefsStore {
	const registry = getContext<ColumnPrefsRegistry | undefined>(KEY);
	if (registry !== undefined) return registry.get(id);
	return new ColumnPrefsStore(TABLES[id], storageOf(typeof window === 'undefined' ? null : window));
}
