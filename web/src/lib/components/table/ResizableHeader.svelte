<script lang="ts">
	import type { Snippet } from 'svelte';
	import { isResizable, type ColumnSpec } from '$lib/domain/columns';
	import type { ColumnFit } from './column-fit.svelte';

	// Column header with a grip on its right edge (ADR-0030 section 3). The grip is for pointers
	// only (mouse, pen, touch): aria-hidden and not focusable; the keyboard changes widths in the
	// menu "Spalten". Dragging reports the width live (clamped to the bounds of the column and to
	// the budget of the table, so the title keeps its minimum; the title itself to the room the
	// others leave, Nachtrag 3), releasing commits it, Escape during the drag puts the old width
	// back and is consumed (ADR-0025 section 1). A double click fits the width to the content, on
	// the title it gives the title the rest again. Neither sorts: the grip is not part of the sort
	// button.
	let {
		column,
		fit,
		className = '',
		ariaSort,
		onautofit,
		children
	}: {
		column: ColumnSpec;
		/** Column state of the table: width, budget, live resize, commit and cancel. */
		fit: ColumnFit;
		className?: string;
		ariaSort?: 'ascending' | 'descending';
		/** Double click on the grip; without it the widest content of the column in its frame. */
		onautofit?: () => void;
		/** Content of the header (sort button or text). */
		children: Snippet;
	} = $props();

	const resizable = $derived(isResizable(column));
	const width = $derived(fit.widthOf(column.id));

	function autofit() {
		if (onautofit) onautofit();
		else {
			const frame = grip?.closest<HTMLElement>('table')?.parentElement;
			if (frame) fit.autofitCells(frame, column.id);
		}
	}

	let grip = $state<HTMLElement>();
	let drag = $state<{
		pointerId: number;
		startX: number;
		startWidth: number;
		min: number;
		max: number;
	} | null>(null);

	/** Width at the pointer, within the bounds taken when the drag began. */
	function widthAt(clientX: number): number {
		if (drag === null) return width;
		const px = drag.startWidth + clientX - drag.startX;
		return Math.round(Math.min(Math.max(px, drag.min), drag.max));
	}

	function release() {
		if (drag !== null && grip && typeof grip.releasePointerCapture === 'function') {
			try {
				grip.releasePointerCapture(drag.pointerId);
			} catch {
				// The capture ended already.
			}
		}
		window.removeEventListener('keydown', onkeydown, true);
		drag = null;
	}

	function cancel() {
		release();
		fit.cancel();
	}

	/** Escape during the drag: the innermost action wins, nothing behind reacts. */
	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || drag === null) return;
		event.preventDefault();
		event.stopPropagation();
		cancel();
	}

	function onpointerdown(event: PointerEvent) {
		if (event.button !== 0 || drag !== null) return;
		event.preventDefault();
		event.stopPropagation();
		const { min, max } = fit.dragBounds(column.id);
		drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, min, max };
		if (grip && typeof grip.setPointerCapture === 'function') {
			try {
				grip.setPointerCapture(event.pointerId);
			} catch {
				// Without capture the drag still follows the grip.
			}
		}
		window.addEventListener('keydown', onkeydown, true);
	}

	function onpointermove(event: PointerEvent) {
		if (drag === null || event.pointerId !== drag.pointerId) return;
		fit.resize(column.id, widthAt(event.clientX));
	}

	function onpointerup(event: PointerEvent) {
		if (drag === null || event.pointerId !== drag.pointerId) return;
		const next = widthAt(event.clientX);
		release();
		fit.commit(column.id, next);
	}

	function onpointercancel(event: PointerEvent) {
		if (drag !== null && event.pointerId === drag.pointerId) cancel();
	}

	// A header that goes away during a drag (the column was hidden) leaves no listener behind.
	$effect(() => () => window.removeEventListener('keydown', onkeydown, true));
</script>

<th scope="col" class={className} aria-sort={ariaSort} data-col={column.id}>
	<span class="label" data-column-label>{@render children()}</span>
	{#if resizable}
		<!-- Pointer only; the keyboard uses the menu "Spalten" (ADR-0030 section 3). -->
		<span
			class="grip"
			class:active={drag !== null}
			aria-hidden="true"
			title={column.flexible
				? 'Breite ziehen, Doppelklick gibt den Rest der Tabelle'
				: 'Breite ziehen, Doppelklick passt an'}
			data-column-grip={column.id}
			bind:this={grip}
			{onpointerdown}
			{onpointermove}
			{onpointerup}
			{onpointercancel}
			onclick={(event) => event.stopPropagation()}
			ondblclick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				autofit();
			}}
		></span>
	{/if}
</th>

<style>
	th {
		position: relative;
	}

	.label {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* 6 px wide at the right edge; the line shows on hover of the header and while dragging. */
	.grip {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		width: 6px;
		cursor: col-resize;
		touch-action: none;
		user-select: none;
	}

	.grip::after {
		content: '';
		position: absolute;
		top: 25%;
		right: 2px;
		bottom: 25%;
		border-right: 2px solid var(--color-line);
		opacity: 0;
	}

	th:hover .grip::after {
		opacity: 1;
	}

	.grip:hover::after,
	.grip.active::after {
		border-right-color: var(--color-brand);
		opacity: 1;
	}

	/* Forced colors draw the line in the system text color; it stays visible there. */
	@media (forced-colors: active) {
		.grip::after {
			opacity: 1;
		}
	}
</style>
