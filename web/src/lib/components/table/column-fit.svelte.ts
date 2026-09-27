// State of the columns of one table (ADR-0030): the preferences of the device, the measured width
// of the frame and, while a grip is dragged, the live width of its column; from them fitColumns
// derives which columns are shown and how wide they are. One instance per table, shared by the
// table and the menu "Spalten" of its section bar.

import { SvelteSet } from 'svelte/reactivity';
import {
	fitColumns,
	type ColumnFit as Fit,
	type ColumnPrefs,
	type ColumnSpec
} from '$lib/domain/columns';
import type { ColumnPrefsStore } from '$lib/stores/column-prefs.svelte';
import { naturalWidth, observeWidth } from './measure';

export class ColumnFit {
	/** Content width of the frame; null while not measured (before layout, jsdom). */
	frameWidth = $state<number | null>(null);
	/** Column whose grip is dragged, with its live width. */
	dragging = $state<{ id: string; width: number } | null>(null);

	readonly store: ColumnPrefsStore;
	readonly #columns: () => readonly ColumnSpec[];

	/** `columns`: the columns of the table right now (e.g. without the selection of the inbox). */
	constructor(
		store: ColumnPrefsStore,
		columns: () => readonly ColumnSpec[] = () => store.table.columns
	) {
		this.store = store;
		this.#columns = columns;
	}

	readonly columns = $derived.by(() => this.#columns());

	readonly prefs = $derived.by((): ColumnPrefs => {
		const current = this.store.prefs;
		if (this.dragging === null) return current;
		return {
			...current,
			widths: { ...current.widths, [this.dragging.id]: this.dragging.width }
		};
	});

	readonly fit: Fit = $derived(fitColumns(this.frameWidth, this.columns, this.prefs));

	readonly shown: ReadonlySet<string> = $derived(new SvelteSet(this.fit.visible));

	/** Shown columns in the order of the table, for the colgroup. */
	readonly shownColumns: readonly ColumnSpec[] = $derived(
		this.columns.filter((column) => this.shown.has(column.id))
	);

	/** How far a column may grow: the room of the flexible column above its minimum. */
	readonly budget = $derived.by(() => {
		const flexMin = this.columns.find((column) => column.flexible)?.min ?? 0;
		const rest = this.fit.flexWidth;
		return rest === null ? Number.POSITIVE_INFINITY : Math.max(0, rest - flexMin);
	});

	/** Width of a shown fixed column (0 for the flexible one). */
	widthOf(id: string): number {
		return this.fit.widths[id] ?? 0;
	}

	/** Follows the width of the frame; returns the cleanup (for an $effect). */
	observe(frame: HTMLElement): () => void {
		return observeWidth(frame, (width) => (this.frameWidth = width));
	}

	resize(id: string, width: number): void {
		this.dragging = { id, width };
	}

	commit(id: string, width: number): void {
		this.dragging = null;
		this.store.setWidth(id, width);
	}

	cancel(): void {
		this.dragging = null;
	}

	/** Sets the width of a double click: `natural`, at most the current width plus the budget. */
	autofit(id: string, natural: number): void {
		const current = this.fit.widths[id] ?? this.store.widthOf(id);
		this.store.setWidth(id, Math.min(natural, current + this.budget));
	}

	/** Double click: the widest content of the header and the cells of the column in `frame`. */
	autofitCells(frame: HTMLElement, id: string): void {
		this.autofit(id, naturalWidth(cellsOf(frame, id)));
	}
}

/** Header and body cells of a column (`data-col`), not the `col` of the colgroup. */
export function cellsOf(frame: HTMLElement, id: string): Element[] {
	return [...frame.querySelectorAll(`th[data-col="${id}"], td[data-col="${id}"]`)];
}
