<script lang="ts">
	import type { Snippet } from 'svelte';
	import Popover from '../overlay/Popover.svelte';

	// A cell of the ticket table that edits its value in a small popover (plan BI-3, ADR-0036 §6;
	// ADR-0025 section 5): the value is the button, filling the cell, with a quiet hover and a
	// pencil that shows on hover and keyboard focus. Tab reaches it, Enter or Space opens the editor,
	// Escape closes it and the focus goes back to the cell (the Popover does both). The row ignores
	// clicks on the button and inside the popover, so they never open the ticket.
	let {
		kind,
		label,
		buttonLabel,
		busy = false,
		value,
		editor
	}: {
		/** A menu of choices (priority, status, project) or a panel with a form (due date, tags). */
		kind: 'menu' | 'panel';
		/** Name of the popover, e.g. "Priorität von TASK-3". */
		label: string;
		/** Name of the button: field, ticket and value, e.g. "Priorität von TASK-3: Hoch, ändern". */
		buttonLabel: string;
		/** A save of this ticket runs. */
		busy?: boolean;
		/** The value as the cell shows it. */
		value: Snippet;
		/** The editor; `close` hides it and returns the focus to the cell. */
		editor: Snippet<[{ close: () => void }]>;
	} = $props();

	/**
	 * The editor renders once the cell is pointed at or focused, before the popover opens (so it is
	 * placed with its real size): a table of hundreds of rows would otherwise carry every menu and
	 * form in its DOM.
	 */
	let opened = $state(false);
</script>

<!-- Pointer and focus only prepare the editor; the button inside does the opening. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
	class="editable-cell"
	onpointerenter={() => (opened = true)}
	onfocusin={() => (opened = true)}
>
	<Popover
		{kind}
		{label}
		{buttonLabel}
		buttonClass={busy ? 'cell-edit busy' : 'cell-edit'}
		buttonTitle={buttonLabel}
		onopen={() => (opened = true)}
	>
		{#snippet button()}
			<span class="value">{@render value()}</span>
			<svg
				class="edit-hint"
				viewBox="0 0 16 16"
				width="12"
				height="12"
				aria-hidden="true"
				focusable="false"
			>
				<path d="M10.5 2.5l3 3-7.5 7.5H3v-3z" />
			</svg>
		{/snippet}
		{#snippet children({ close })}
			{#if opened}
				{@render editor({ close })}
			{/if}
		{/snippet}
	</Popover>
</span>

<style>
	.editable-cell {
		display: contents;
	}

	/* The button fills the cell; the value keeps its look, the hover is a quiet fill. */
	:global(button.cell-edit) {
		display: flex;
		gap: 0.25rem;
		align-items: center;
		width: 100%;
		min-width: 0;
		min-height: 2.25rem;
		padding: 0.375rem 0.75rem;
		font: inherit;
		color: inherit;
		text-align: left;
		background: none;
		border: none;
		border-radius: var(--radius-item);
		cursor: pointer;
	}

	:global(button.cell-edit:hover) {
		background: var(--fill-control-hover);
	}

	:global(button.cell-edit.busy) {
		cursor: progress;
		opacity: 0.75;
	}

	.value {
		display: flex;
		flex: 0 1 auto;
		align-items: center;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.edit-hint {
		flex: none;
		margin-left: auto;
		color: var(--color-text-muted);
		opacity: 0;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linejoin: round;
	}

	:global(button.cell-edit:hover) .edit-hint,
	:global(button.cell-edit:focus-visible) .edit-hint,
	:global(button.cell-edit[aria-expanded='true']) .edit-hint {
		opacity: 1;
	}
</style>
