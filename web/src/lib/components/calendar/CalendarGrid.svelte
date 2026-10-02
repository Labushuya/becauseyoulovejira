<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import {
		MONTH_DAY_LIMIT,
		WEEK_DAY_LIMIT,
		dayCellLabel,
		gridMove,
		inPeriod,
		sliceDay,
		weekLabel,
		type CalendarEntry,
		type CalendarPeriod,
		type GridView
	} from '$lib/domain/calendar';
	import { WEEKDAYS } from '$lib/domain/recurrence';
	import { WEEKDAY_NAMES, WEEKDAY_SHORT } from '$lib/domain/recurrence-text';
	import { rowMenus } from '$lib/overlay/context-menu';
	import { remPx } from '../table/chip-measure';
	import CalendarMore from './CalendarMore.svelte';

	// Month and week as a grid (ADR-0053 §3 and §8; APG grid and date picker): a row per ISO week
	// with its number as row header, a cell per day named by its full date, "heute" and the number of
	// its entries. One cell is a stop of Tab (roving tabindex): today, else the day of the period;
	// the arrow keys move by a day or a week, Home and End to the ends of the week, with Ctrl to the
	// ends of the month, Page Up and Page Down by a period. A day outside the period shows the period
	// around it (`onoutside`), and the focus follows. Enter or F2 move into the cell, the arrow keys
	// up and down through its entries, Escape back to the cell. A day shows MONTH_DAY_LIMIT (week:
	// WEEK_DAY_LIMIT) entries at most, the rest behind "+N weitere". Below 6rem per day a month shows
	// marks instead of titles (each still a link with its full name). Only the period is rendered;
	// the grid never scrolls sideways (ADR-0030): its columns share the width.
	let {
		view,
		period,
		today,
		days,
		titleId,
		entry,
		onoutside
	}: {
		view: GridView;
		period: CalendarPeriod;
		today: CalendarDate;
		days: ReadonlyMap<CalendarDate, readonly CalendarEntry[]>;
		/** The heading of the period, which names the grid. */
		titleId: string;
		/** One entry: its look, a stop of Tab (not in a cell, in the list of a day), with due date. */
		entry: Snippet<[CalendarEntry, 'dot' | 'line' | 'block' | 'row', boolean, boolean]>;
		/** The keyboard left the period: show the period around this day. */
		onoutside: (date: CalendarDate) => void;
	} = $props();

	/** Narrower days than this show marks instead of titles (a narrow month, ADR-0053 §7). */
	const COMPACT_DAY_REM = 6;
	/** Width of the column of the week numbers, as in the styles below. */
	const WEEK_COLUMN_REM = 2;

	let grid = $state<HTMLElement>();
	let width = $state<number | null>(null);
	const compact = $derived(
		view === 'month' &&
			width !== null &&
			(width - WEEK_COLUMN_REM * remPx()) / 7 < COMPACT_DAY_REM * remPx()
	);
	const limit = $derived(view === 'month' ? MONTH_DAY_LIMIT : WEEK_DAY_LIMIT);
	const look = $derived(view === 'week' ? 'block' : compact ? 'dot' : 'line');

	$effect(() => {
		const element = grid;
		if (element === undefined || typeof ResizeObserver !== 'function') return;
		const observer = new ResizeObserver((entries) => {
			const rect = entries[0]?.contentRect;
			if (rect !== undefined) width = rect.width;
		});
		observer.observe(element);
		return () => observer.disconnect();
	});

	/** The day with the focus of the grid; outside the period the default below applies. */
	let focused = $state<CalendarDate | null>(null);

	/** Today if shown (in its month), else the day the period is built around. */
	function defaultDay(): CalendarDate {
		const shown = (date: CalendarDate) =>
			inPeriod(period, date) && (period.month === null || date.startsWith(period.month));
		return shown(today) ? today : period.anchor;
	}

	const current = $derived(focused !== null && inPeriod(period, focused) ? focused : defaultDay());

	/** Set when the keyboard asked for another period: its day gets the focus once it is shown. */
	let refocus = false;

	$effect(() => {
		void period;
		if (!refocus) return;
		refocus = false;
		void tick().then(() => cellOf(current)?.focus());
	});

	function cellOf(date: CalendarDate): HTMLElement | null {
		return grid?.querySelector<HTMLElement>(`[role="gridcell"][data-date="${date}"]`) ?? null;
	}

	/**
	 * The things to reach inside a cell: the links of its entries and "+N weitere", in their order;
	 * not the entries in the popover of the day, which has its own order of Tab.
	 */
	function itemsOf(cell: Element): HTMLElement[] {
		return [
			...cell.querySelectorAll<HTMLElement>(
				':scope > .entries > li > a[href], :scope > button.calendar-more'
			)
		];
	}

	function onfocusin(event: FocusEvent) {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const cell = target.closest<HTMLElement>('[role="gridcell"]');
		const date = cell?.dataset.date;
		if (date !== undefined && grid?.contains(cell)) focused = date;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.defaultPrevented || event.altKey || event.metaKey) return;
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const cell = target.closest<HTMLElement>('[role="gridcell"]');
		if (cell === null || !grid?.contains(cell)) return;
		if (target === cell) {
			onCellKey(event, cell);
			return;
		}
		// Inside a cell: up and down through its entries, Escape back to the cell.
		const items = itemsOf(cell);
		const index = items.indexOf(target);
		if (index === -1) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			cell.focus();
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
			items[(next + items.length) % items.length]?.focus();
		}
	}

	function onCellKey(event: KeyboardEvent, cell: HTMLElement) {
		if (event.key === 'Enter' || event.key === 'F2') {
			const first = itemsOf(cell)[0];
			if (first === undefined) return;
			event.preventDefault();
			first.focus();
			return;
		}
		if (event.shiftKey) return;
		const next = gridMove(view, cell.dataset.date ?? current, event.key, event.ctrlKey);
		if (next === null) return;
		event.preventDefault();
		focused = next;
		if (inPeriod(period, next)) {
			void tick().then(() => cellOf(next)?.focus());
			return;
		}
		refocus = true;
		onoutside(next);
	}
</script>

<div
	class="grid {view}"
	class:compact
	role="grid"
	aria-labelledby={titleId}
	tabindex="-1"
	bind:this={grid}
	{onkeydown}
	{onfocusin}
	{@attach rowMenus}
>
	<div class="row head" role="row">
		<span class="week-head" role="columnheader"><abbr title="Kalenderwoche">KW</abbr></span>
		{#each WEEKDAYS as weekday (weekday)}
			<span class="weekday" role="columnheader"
				><abbr title={WEEKDAY_NAMES[weekday]}>{WEEKDAY_SHORT[weekday]}</abbr></span
			>
		{/each}
	</div>
	{#each period.weeks as week (week.days[0])}
		<div class="row" role="row">
			<span class="week-number" role="rowheader" title={weekLabel(week)}
				><span aria-hidden="true">{week.week}</span><span class="visually-hidden"
					>{weekLabel(week)}</span
				></span
			>
			{#each week.days as date (date)}
				{@const list = days.get(date) ?? []}
				{@const slice = sliceDay(list, limit)}
				<div
					class="day"
					class:outside={period.month !== null && !date.startsWith(period.month)}
					class:today={date === today}
					role="gridcell"
					tabindex={date === current ? 0 : -1}
					aria-label={dayCellLabel(date, today, list.length)}
					aria-current={date === today ? 'date' : undefined}
					data-date={date}
				>
					<span class="number" aria-hidden="true">{Number(date.slice(8, 10))}</span>
					{#if slice.shown.length > 0}
						<ul class="entries">
							{#each slice.shown as item (item.key)}
								{@render entry(item, look, false, false)}
							{/each}
						</ul>
					{/if}
					{#if slice.more > 0}
						<CalendarMore {date} more={slice.more} total={list.length}>
							{#snippet entries()}
								{#each list as item (item.key)}
									{@render entry(item, 'row', true, false)}
								{/each}
							{/snippet}
						</CalendarMore>
					{/if}
				</div>
			{/each}
		</div>
	{/each}
</div>

<style>
	.grid {
		display: grid;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	/* Week numbers, then seven days sharing the width: the grid never scrolls sideways. */
	.row {
		display: grid;
		grid-template-columns: 2rem repeat(7, minmax(0, 1fr));
	}

	.row + .row {
		border-top: 1px solid var(--color-line);
	}

	.head {
		font-size: var(--font-size-small);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.head abbr {
		text-decoration: none;
	}

	.weekday,
	.week-head {
		padding: 0.375rem 0.5rem;
	}

	.week-number {
		padding: 0.375rem 0.25rem;
		font-size: var(--font-size-caption);
		color: var(--color-text-muted);
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.day {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
		min-height: 6.5rem;
		padding: 0.25rem;
		border-left: 1px solid var(--color-line);
	}

	.week .day {
		min-height: 14rem;
	}

	.day:focus-visible {
		outline: 2px solid var(--color-brand-text);
		outline-offset: -2px;
	}

	.number {
		align-self: flex-start;
		min-width: 1.5rem;
		padding: 0 0.25rem;
		font-size: var(--font-size-small);
		font-weight: 600;
		line-height: 1.5rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		border: 1px solid transparent;
		border-radius: var(--radius-pill);
	}

	.outside .number {
		font-weight: 400;
		color: var(--color-text-muted);
	}

	/* Today: the number on the accent surface with a frame (never color alone, aria-current). */
	.today .number {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	.entries {
		display: grid;
		gap: 0.125rem;
		min-width: 0;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* A narrow month: the marks of a day side by side. */
	.compact .entries {
		display: flex;
		flex-wrap: wrap;
		gap: 0.125rem;
	}

	.compact .day {
		min-height: 4rem;
		padding: 0.125rem;
	}

	.compact .row {
		grid-template-columns: 1.5rem repeat(7, minmax(0, 1fr));
	}
</style>
