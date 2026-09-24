<script lang="ts">
	import { PRIORITY_LABELS } from '$lib/domain/labels';
	import type { Priority } from '$lib/domain/status';

	// Priority icon (E2 plan, T-15): one to three bars for low, medium and high, an exclamation
	// mark for urgent, in currentColor and never red (ADR-0009). The text alternative is visually
	// hidden text; the title shows it on hover.
	let { priority }: { priority: Priority } = $props();

	const BARS: Record<Exclude<Priority, 'urgent'>, number> = { low: 1, medium: 2, high: 3 };
	const label = $derived(`Priorität: ${PRIORITY_LABELS[priority]}`);
</script>

<span class="priority" data-priority={priority} title={label}>
	<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
		{#if priority === 'urgent'}
			<rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="currentColor" />
			<path class="mark" d="M8 4.5v4.25" stroke-width="2" stroke-linecap="round" />
			<circle class="dot" cx="8" cy="11.5" r="1.1" />
		{:else}
			{#each [0, 1, 2] as index (index)}
				<rect
					class:off={index >= BARS[priority]}
					x={2 + index * 4.5}
					y={10 - index * 3.5}
					width="3"
					height={4 + index * 3.5}
					rx="1"
					fill="currentColor"
				/>
			{/each}
		{/if}
	</svg>
	<span class="visually-hidden">{label}</span>
</span>

<style>
	.priority {
		display: inline-flex;
		color: var(--color-text-muted);
	}

	[data-priority='high'],
	[data-priority='urgent'] {
		color: var(--color-text);
	}

	.off {
		fill: var(--color-line);
	}

	.mark {
		stroke: var(--color-surface);
	}

	.dot {
		fill: var(--color-surface);
	}
</style>
