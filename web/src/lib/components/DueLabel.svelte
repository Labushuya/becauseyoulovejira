<script lang="ts">
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { formatCalendarDate } from '$lib/domain/format';
	import { dueState } from '$lib/domain/ordering';

	// Due date of a row (E2 plan, T-14): date plus "überfällig", "heute" or "morgen" with an icon,
	// in text or brand color, never red (ADR-0009). Done tickets show the plain date.
	let {
		due,
		today,
		done = false
	}: { due: CalendarDate; today: CalendarDate; done?: boolean } = $props();

	const kind = $derived(done ? 'later' : dueState(due, today));
	const HINTS: Partial<Record<ReturnType<typeof dueState>, string>> = {
		overdue: 'überfällig',
		today: 'heute',
		tomorrow: 'morgen'
	};
	const hint = $derived(HINTS[kind]);
</script>

<span class="due" data-due={kind}>
	{#if hint}
		<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
			{#if kind === 'overdue'}
				<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5" />
				<path
					d="M8 4.75V8.5l2.25 1.5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				/>
			{:else}
				<rect
					x="2"
					y="3"
					width="12"
					height="11"
					rx="2"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
				/>
				<path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.5" />
			{/if}
		</svg>
	{/if}
	<time datetime={due}>{formatCalendarDate(due)}</time>
	{#if hint}<span class="hint">{hint}</span>{/if}
</span>

<style>
	.due {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	[data-due='overdue'] {
		font-weight: 600;
		color: var(--color-text);
	}

	[data-due='today'],
	[data-due='tomorrow'] {
		font-weight: 500;
		color: var(--color-brand-text);
	}
</style>
