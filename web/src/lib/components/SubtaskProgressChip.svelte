<script lang="ts">
	import { progressLabel, type SubtaskProgress } from '$lib/domain/subtasks';

	// The progress of the sub-tasks of a parent (ADR-0033 section 5): "2/5" in a small pill, its name
	// "2 von 5 Unteraufgaben erledigt" as tooltip and for screen readers. At the title in the table
	// "Aufgaben" and, since TP-3, in plan, pool and suggestions of the day plan, each with the
	// progress of the list store (`progressOf`). Nothing for a ticket without sub-tasks. The place
	// around it is the caller's.
	let { progress }: { progress: SubtaskProgress | null } = $props();
</script>

{#if progress && progress.total > 0}
	<span class="progress-chip" title={progressLabel(progress)}>
		<span aria-hidden="true">{progress.done}/{progress.total}</span>
		<span class="visually-hidden">, {progressLabel(progress)}</span>
	</span>
{/if}

<style>
	.progress-chip {
		display: inline-block;
		flex: none;
		padding: 0 0.375rem;
		font-size: var(--font-size-small);
		line-height: 1.125rem;
		font-variant-numeric: tabular-nums;
		vertical-align: middle;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}
</style>
