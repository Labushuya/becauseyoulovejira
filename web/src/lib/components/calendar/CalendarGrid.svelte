<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import {
		CALENDAR_MOVE_KEY,
		DRAG_THRESHOLD_PX,
		MONTH_DAY_LIMIT,
		WEEK_DAY_LIMIT,
		dayCellLabel,
		gridMove,
		inPeriod,
		isMovable,
		moveInstructions,
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
	import type { EntryLook, EntryPlace } from './CalendarEntry.svelte';
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
	//
	// Moving a due date (K-2, ADR-0053 §12), only for open tickets and only with `onmove`: the mouse
	// drags an entry onto another day of the period (from DRAG_THRESHOLD_PX on, Escape cancels; less
	// stays a click). Touch and pen do not drag, they scroll; they use the menu. The key "m" on an
	// entry or "Fälligkeit verschieben …" in its menu start moving without a mouse: the focus goes to
	// the day of the ticket, the keys of the grid choose the new one (into other periods as well),
	// Enter or a click on a day sets it, Escape or "Abbrechen" cancel. The status line below says how
	// and notes that a ticket of a series moves alone. `onmove` saves; afterwards the focus is on the
	// entry at its new day (keyboard), or where it was (mouse).
	let {
		view,
		period,
		today,
		days,
		titleId,
		entry,
		onoutside,
		onmove = null
	}: {
		view: GridView;
		period: CalendarPeriod;
		today: CalendarDate;
		days: ReadonlyMap<CalendarDate, readonly CalendarEntry[]>;
		/** The heading of the period, which names the grid. */
		titleId: string;
		/** One entry at its place: look, stop of Tab, how it moves. */
		entry: Snippet<[CalendarEntry, EntryPlace]>;
		/** The keyboard left the period: show the period around this day. */
		onoutside: (date: CalendarDate) => void;
		/** Saves the new due date of a ticket, true when saved; null: nothing moves. */
		onmove?: ((ticketId: string, date: CalendarDate) => Promise<boolean>) | null;
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
	const look = $derived<EntryLook>(view === 'week' ? 'block' : compact ? 'dot' : 'line');

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

	/** A due date that moves: the ticket, its day, and whether the mouse drags it. */
	interface Move {
		id: string;
		key: string;
		from: CalendarDate;
		recurring: boolean;
		pointer: boolean;
	}

	let moving = $state<Move | null>(null);
	/** The day under the dragging mouse; null outside the days. */
	let dropDay = $state<CalendarDate | null>(null);
	/** The day a move would set: under the mouse, else the day with the focus. */
	const target = $derived(moving === null ? null : moving.pointer ? dropDay : current);

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

	/** The day of the cell around `target` in this grid, null elsewhere. */
	function dayAt(target: EventTarget | null): CalendarDate | null {
		if (!(target instanceof Element)) return null;
		const cell = target.closest<HTMLElement>('[role="gridcell"]');
		return cell !== null && grid?.contains(cell) ? (cell.dataset.date ?? null) : null;
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

	/** The link of a ticket in the cell of a day, else the cell, else the cell with the focus. */
	function focusEntry(ticketId: string, date: CalendarDate) {
		const cell = cellOf(date);
		const link = cell?.querySelector<HTMLElement>(
			`:scope > .entries > li > a[data-calendar-ticket="${ticketId}"]`
		);
		(link ?? cell ?? cellOf(current))?.focus();
	}

	/** Where an entry stands and how it moves (only an open ticket, only with `onmove`). */
	function placeOf(
		item: CalendarEntry,
		date: CalendarDate,
		itemLook: EntryLook,
		tabbable: boolean
	): EntryPlace {
		const ticketId = item.kind === 'ticket' ? item.ticket.id : null;
		const movable = onmove !== null && ticketId !== null && isMovable(item);
		return {
			look: itemLook,
			tabbable,
			move: movable ? () => startMove(ticketId, date) : null,
			moving: ticketId !== null && moving?.id === ticketId
		};
	}

	/** The move of a ticket on a day, null if it is not there or cannot move. */
	function moveOf(ticketId: string, from: CalendarDate, pointer: boolean): Move | null {
		const found = days
			.get(from)
			?.find((item) => item.kind === 'ticket' && item.ticket.id === ticketId);
		if (found?.kind !== 'ticket' || !isMovable(found)) return null;
		const { key, recurring } = found.ticket;
		return { id: ticketId, key, from, recurring, pointer };
	}

	/** Keyboard or menu: the day of the ticket gets the focus, the keys of the grid choose another. */
	function startMove(ticketId: string, from: CalendarDate) {
		if (onmove === null) return;
		const move = moveOf(ticketId, from, false);
		if (move === null) return;
		moving = move;
		focused = from;
		void tick().then(() => cellOf(from)?.focus());
	}

	/**
	 * Ends moving: saves the day unless it is none or the same; with the keyboard the focus then goes
	 * to the entry at its day (the new one when saved).
	 */
	async function finishMove(date: CalendarDate | null) {
		const move = moving;
		moving = null;
		dropDay = null;
		if (move === null) return;
		let saved = false;
		if (date !== null && date !== move.from && onmove !== null) {
			saved = await onmove(move.id, date);
		}
		if (move.pointer) return;
		const day = saved && date !== null ? date : move.from;
		focused = day;
		await tick();
		focusEntry(move.id, day);
	}

	function moveFocus(next: CalendarDate) {
		focused = next;
		if (inPeriod(period, next)) {
			void tick().then(() => cellOf(next)?.focus());
			return;
		}
		refocus = true;
		onoutside(next);
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
		if (moving !== null) {
			if (!moving.pointer) onMoveKey(event, cell);
			return;
		}
		if (
			event.key.toLowerCase() === CALENDAR_MOVE_KEY &&
			!event.ctrlKey &&
			target.matches('a[data-movable]')
		) {
			const ticketId = target.dataset.calendarTicket;
			const from = cell.dataset.date;
			if (ticketId === undefined || from === undefined) return;
			event.preventDefault();
			startMove(ticketId, from);
			return;
		}
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
		moveFocus(next);
	}

	/** While moving with the keyboard: the keys of the grid choose the day, Enter sets it. */
	function onMoveKey(event: KeyboardEvent, cell: HTMLElement) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			void finishMove(null);
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			void finishMove(cell.dataset.date ?? null);
			return;
		}
		if (event.shiftKey) return;
		const next = gridMove(view, cell.dataset.date ?? current, event.key, event.ctrlKey);
		if (next === null) return;
		event.preventDefault();
		moveFocus(next);
	}

	/** A pressed mouse on a movable entry, before and while it drags. */
	interface Press {
		ticketId: string;
		from: CalendarDate;
		x: number;
		y: number;
		pointerId: number;
		/** Escape ended the drag; the release must not open the entry. */
		cancelled: boolean;
	}

	let press: Press | null = null;
	/** The click after a drag opens nothing (a drop on the own entry would open the ticket). */
	let swallowClick = false;
	const CAPTURE = { capture: true } as const;

	function endPress() {
		if (press === null) return;
		press = null;
		window.removeEventListener('pointermove', onpointermove, CAPTURE);
		window.removeEventListener('pointerup', onpointerup, CAPTURE);
		window.removeEventListener('pointercancel', onpointercancel, CAPTURE);
		window.removeEventListener('keydown', ondragkey, CAPTURE);
	}

	// The grid leaves while the mouse is pressed: no listener stays behind.
	$effect(() => () => endPress());

	function onpointerdown(event: PointerEvent) {
		if (onmove === null || moving !== null || press !== null) return;
		// Only the mouse drags: touch and pen scroll the page (ADR-0053 §12).
		if (event.pointerType !== 'mouse' || event.button !== 0) return;
		if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
		const link =
			event.target instanceof Element ? event.target.closest<HTMLElement>('a[data-movable]') : null;
		// Not from the list of a day: its popover lies over the days.
		if (link === null || link.closest('[popover]') !== null) return;
		const ticketId = link.dataset.calendarTicket;
		const from = dayAt(link);
		if (ticketId === undefined || from === null) return;
		const { clientX: x, clientY: y, pointerId } = event;
		press = { ticketId, from, x, y, pointerId, cancelled: false };
		window.addEventListener('pointermove', onpointermove, CAPTURE);
		window.addEventListener('pointerup', onpointerup, CAPTURE);
		window.addEventListener('pointercancel', onpointercancel, CAPTURE);
		window.addEventListener('keydown', ondragkey, CAPTURE);
	}

	function onpointermove(event: PointerEvent) {
		const held = press;
		if (held === null || held.cancelled || event.pointerId !== held.pointerId) return;
		if (moving === null) {
			if (Math.hypot(event.clientX - held.x, event.clientY - held.y) < DRAG_THRESHOLD_PX) return;
			const move = moveOf(held.ticketId, held.from, true);
			if (move === null) {
				endPress();
				return;
			}
			moving = move;
			window.getSelection()?.removeAllRanges();
		}
		dropDay = dayAt(event.target);
	}

	function onpointerup(event: PointerEvent) {
		const held = press;
		if (held === null || event.pointerId !== held.pointerId) return;
		const dragged = moving?.pointer === true;
		endPress();
		if (!dragged && !held.cancelled) return;
		swallowClick = true;
		setTimeout(() => (swallowClick = false), 0);
		if (dragged) void finishMove(dayAt(event.target));
	}

	function onpointercancel(event: PointerEvent) {
		const held = press;
		if (held === null || event.pointerId !== held.pointerId) return;
		const dragged = moving?.pointer === true;
		endPress();
		if (dragged) void finishMove(null);
	}

	/** Escape while the mouse drags: back to where it was. */
	function ondragkey(event: KeyboardEvent) {
		if (event.key !== 'Escape' || press === null || moving?.pointer !== true) return;
		event.preventDefault();
		event.stopPropagation();
		press.cancelled = true;
		void finishMove(null);
	}

	/** After a drag no click; while moving with the keyboard a click on a day sets it. */
	function onclickcapture(event: MouseEvent) {
		if (swallowClick) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (moving === null || moving.pointer) return;
		if (event.target instanceof Element && event.target.closest('[popover]') !== null) return;
		const day = dayAt(event.target);
		if (day === null) return;
		event.preventDefault();
		event.stopPropagation();
		void finishMove(day);
	}
</script>

<div
	class="grid {view}"
	class:compact
	class:dragging={moving?.pointer === true}
	role="grid"
	aria-labelledby={titleId}
	tabindex="-1"
	bind:this={grid}
	{onkeydown}
	{onfocusin}
	{onpointerdown}
	{onclickcapture}
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
					class:target={target === date}
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
								{@render entry(item, placeOf(item, date, look, false))}
							{/each}
						</ul>
					{/if}
					{#if slice.more > 0}
						<CalendarMore {date} more={slice.more} total={list.length}>
							{#snippet entries()}
								{#each list as item (item.key)}
									{@render entry(item, placeOf(item, date, 'row', true))}
								{/each}
							{/snippet}
						</CalendarMore>
					{/if}
				</div>
			{/each}
		</div>
	{/each}
</div>

<div class="move-line" class:shown={moving !== null}>
	<p class="move-text" role="status">
		{moving === null
			? ''
			: moveInstructions(moving.key, moving.pointer ? 'pointer' : 'keyboard', moving.recurring)}
	</p>
	{#if moving !== null && !moving.pointer}
		<button class="button-secondary" type="button" onclick={() => void finishMove(null)}>
			Abbrechen
		</button>
	{/if}
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

	/* The day a move would set: dashed frame on the accent surface (not color alone). */
	.day.target {
		background: var(--color-brand-soft-bg);
		outline: 2px dashed var(--color-brand-text);
		outline-offset: -2px;
	}

	.day.target:focus-visible {
		outline-style: solid;
	}

	/* The mouse drags: no text selection, the hand closed. */
	.dragging,
	.dragging :global(*) {
		cursor: grabbing;
		user-select: none;
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

	/*
	 * How a due date moves, at the bottom of the window while the grid is in view. Without a move the
	 * line is only its empty status (no height), so the announcement of the next move is heard.
	 */
	.move-line.shown {
		position: sticky;
		bottom: 0.75rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		margin-top: 0.75rem;
		padding: 0.5rem 0.75rem;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border: 1px solid var(--color-brand);
		border-radius: var(--radius-surface);
	}

	.move-text {
		flex: 1 1 16rem;
		margin: 0;
		font-size: var(--font-size-control);
	}
</style>
