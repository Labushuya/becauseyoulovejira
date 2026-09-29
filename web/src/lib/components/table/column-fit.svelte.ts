// State of the columns of one table (ADR-0030): the preferences of the device, the measured width
// of the frame and, while a grip is dragged, the live preferences of that drag; from them
// fitColumns derives which columns are shown and how wide they are. One instance per table,
// shared by the table and the menu "Spalten" of its section bar. Every change of a width goes
// through `resizeColumn`, so the title (Nachtrag 3) and the other columns follow the same rules
// by grip, menu and double click.

import { SvelteSet } from 'svelte/reactivity';
import {
	WIDTH_STEP,
	fitColumns,
	flexibleBounds,
	flexibleTarget,
	resizeColumn,
	type ColumnFit as Fit,
	type ColumnPrefs,
	type ColumnSpec
} from '$lib/domain/columns';
import type { ColumnPrefsStore } from '$lib/stores/column-prefs.svelte';
import { naturalWidth, observeWidth } from './measure';

export class ColumnFit {
	/** Content width of the frame; null while not measured (before layout, jsdom). */
	frameWidth = $state<number | null>(null);
	/** Preferences while a grip is dragged; null otherwise. */
	live = $state<ColumnPrefs | null>(null);

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

	readonly prefs = $derived.by((): ColumnPrefs => this.live ?? this.store.prefs);

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

	#spec(id: string): ColumnSpec | undefined {
		return this.columns.find((column) => column.id === id);
	}

	/** Shown width of a column; for the flexible one its rest (its own width while not measured). */
	widthOf(id: string): number {
		if (this.#spec(id)?.flexible) return this.fit.flexWidth ?? this.store.widthOf(id);
		return this.fit.widths[id] ?? 0;
	}

	/**
	 * Width the menu "Spalten" names and steps from: the stored one, as before, except where the
	 * shown width counts (the title, and every shown column while the title has a width of its
	 * own, because then the shown widths are what a step starts from, see `resizeColumn`).
	 */
	menuWidth(id: string): number {
		const spec = this.#spec(id);
		if (spec === undefined || this.frameWidth === null || !this.shown.has(id)) {
			return this.store.widthOf(id);
		}
		if (spec.flexible) return this.fit.flexWidth ?? this.store.widthOf(id);
		if (flexibleTarget(this.columns, this.prefs) === null) return this.store.widthOf(id);
		return this.fit.widths[id] ?? this.store.widthOf(id);
	}

	/** Bounds of a step in the menu: for the title `flexibleBounds`, else those of the column. */
	menuBounds(id: string): { min: number; max: number } {
		const spec = this.#spec(id);
		if (spec === undefined) return { min: 0, max: 0 };
		if (spec.flexible) return flexibleBounds(this.frameWidth, this.columns, this.store.prefs);
		return { min: spec.min, max: spec.max };
	}

	/**
	 * How narrow and wide a grip may drag the column right now: for the other columns their bounds
	 * and at most the room of the title above its minimum, for the title `flexibleBounds`.
	 */
	dragBounds(id: string): { min: number; max: number } {
		const spec = this.#spec(id);
		if (spec === undefined || spec.flexible) return this.menuBounds(id);
		const width = this.widthOf(id);
		return {
			min: spec.min,
			max: Math.max(spec.min, Math.min(spec.max, width + Math.max(0, this.budget)))
		};
	}

	/** Follows the width of the frame; returns the cleanup (for an $effect). */
	observe(frame: HTMLElement): () => void {
		return observeWidth(frame, (width) => (this.frameWidth = width));
	}

	#resized(id: string, width: number): ColumnPrefs {
		return resizeColumn(this.frameWidth, this.columns, this.store.prefs, id, width);
	}

	/** Live width while a grip is dragged; nothing is stored. */
	resize(id: string, width: number): void {
		this.live = this.#resized(id, width);
	}

	/** Stores a width (end of a drag, menu, double click). */
	commit(id: string, width: number): void {
		const next = this.#resized(id, width);
		this.live = null;
		this.store.setWidths(next.widths);
	}

	cancel(): void {
		this.live = null;
	}

	/**
	 * "schmaler" (-1) or "breiter" (1) in the menu "Spalten": one step of 1rem from `menuWidth`
	 * within `menuBounds`. Returns the new width, or null when the column is at its bound.
	 */
	step(id: string, direction: -1 | 1): number | null {
		const { min, max } = this.menuBounds(id);
		const before = this.menuWidth(id);
		if (max <= min || (direction < 0 ? before <= min : before >= max)) return null;
		this.commit(id, Math.min(Math.max(before + direction * WIDTH_STEP, min), max));
		return this.menuWidth(id);
	}

	/** Sets the width of a double click: `natural`, at most the current width plus the budget. */
	autofit(id: string, natural: number): void {
		const current = this.fit.widths[id] ?? this.store.widthOf(id);
		this.commit(id, Math.min(natural, current + this.budget));
	}

	/**
	 * Double click: the widest content of the header and the cells of the column in `frame`; on
	 * the title (its lines wrap, it has no natural width) back to the rest of the table.
	 */
	autofitCells(frame: HTMLElement, id: string): void {
		if (this.#spec(id)?.flexible) this.store.clearWidth(id);
		else this.autofit(id, naturalWidth(cellsOf(frame, id)));
	}
}

/** Header and body cells of a column (`data-col`), not the `col` of the colgroup. */
export function cellsOf(frame: HTMLElement, id: string): Element[] {
	return [...frame.querySelectorAll(`th[data-col="${id}"], td[data-col="${id}"]`)];
}
