<script lang="ts">
	import type { Snippet } from 'svelte';
	import { isResizable, type ColumnSpec } from '$lib/domain/columns';

	// Column header with a grip on its right edge (ADR-0030 section 3). The grip is for pointers
	// only (mouse, pen, touch): aria-hidden and not focusable; the keyboard changes widths in the
	// menu "Spalten". Dragging reports the width live (clamped to the bounds of the column and to
	// `budget`, so the title keeps its minimum), releasing commits it, Escape during the drag puts
	// the old width back and is consumed (ADR-0025 section 1). A double click fits the width to the
	// content. Neither sorts: the grip is not part of the sort button.
	let {
		column,
		width,
		budget,
		className = '',
		ariaSort,
		onresize,
		oncommit,
		oncancel,
		onautofit,
		children
	}: {
		column: ColumnSpec;
		/** Current width in CSS pixels. */
		width: number;
		/** How many pixels the column may grow at most (the room of the title above its minimum). */
		budget: number;
		className?: string;
		ariaSort?: 'ascending' | 'descending';
		/** Live width while dragging. */
		onresize: (width: number) => void;
		/** Width at the end of the drag. */
		oncommit: (width: number) => void;
		/** Escape or a cancelled pointer: back to the width before the drag. */
		oncancel: () => void;
		/** Double click on the grip. */
		onautofit: () => void;
		/** Content of the header (sort button or text). */
		children: Snippet;
	} = $props();

	const resizable = $derived(isResizable(column));

	let grip = $state<HTMLElement>();
	let drag = $state<{ pointerId: number; startX: number; startWidth: number; max: number } | null>(
		null
	);

	function clamp(px: number, max: number): number {
		return Math.round(Math.min(Math.max(px, column.min), max));
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
		oncancel();
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
		const max = Math.max(column.min, Math.min(column.max, width + Math.max(0, budget)));
		drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, max };
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
		onresize(clamp(drag.startWidth + event.clientX - drag.startX, drag.max));
	}

	function onpointerup(event: PointerEvent) {
		if (drag === null || event.pointerId !== drag.pointerId) return;
		const next = clamp(drag.startWidth + event.clientX - drag.startX, drag.max);
		release();
		oncommit(next);
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
			title="Breite ziehen, Doppelklick passt an"
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
				onautofit();
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
