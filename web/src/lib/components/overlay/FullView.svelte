<script lang="ts">
	import type { Snippet } from 'svelte';
	import Modal from './Modal.svelte';

	// Full view (ADR-0025 section 7; plan UI-Konsistenz, package UI-7): the modal of size XL
	// (1000 px, 92 vh, the whole screen below 48rem) with its own address, over the panel. Two
	// columns: the content on the left, a column of --full-view-sidebar with cards on the right;
	// below 64rem one column, the cards after the content, so the order on screen is the order of
	// the keyboard. No footer "Speichern & Schließen": every field saves on its own. ×, Escape and
	// the veil close; the owner goes back to the panel. The drafts live in the store and stay for
	// the panel, so closing loses nothing and does not ask.
	let {
		title,
		onclose,
		actions,
		main,
		side
	}: {
		/** Title of the dialog, e.g. "TASK-3 · Steuer abgeben". */
		title: string;
		onclose: () => void;
		/** Actions of the header before the ×, e.g. "Löschen …". */
		actions?: Snippet;
		/** Left column: title, description, comments and history. */
		main: Snippet;
		/** Right column: the cards (details, recurrence, source, dates). */
		side: Snippet;
	} = $props();
</script>

<Modal open size="xl" {title} headerActions={actions} onclose={() => onclose()}>
	<div class="full-view">
		<div class="main">
			{@render main()}
		</div>
		<div class="side">
			{@render side()}
		</div>
	</div>
</Modal>

<style>
	.full-view {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
		align-items: start;
	}

	.main,
	.side {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.25rem;
		align-content: start;
		min-width: 0;
	}

	@media (min-width: 64rem) {
		.full-view {
			grid-template-columns: minmax(0, 1fr) var(--full-view-sidebar);
		}
	}

	.side :global(.card) {
		display: grid;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	.side :global(.card h3),
	.side :global(.card-title) {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}
</style>
