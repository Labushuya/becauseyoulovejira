<script lang="ts">
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import { relativeDue } from '$lib/domain/due-label';
	import { dueState } from '$lib/domain/ordering';

	// Due date of a row (E3 plan, T-9 and package 6): relative label ("gestern", "seit 3 Tagen
	// überfällig", "heute", "morgen", "in 4 Tagen", otherwise the date) in a <time> element; the
	// full date is its title and, for screen readers, part of the text. Overdue is bold in text
	// colour with an icon, today and tomorrow are in the brand text colour; never red (ADR-0009).
	// Done tickets show the plain date. `today` comes from the list store, so the labels change at
	// the Berlin midnight without a reload.
	let {
		due,
		today,
		done = false
	}: { due: CalendarDate | null; today: CalendarDate; done?: boolean } = $props();

	const label = $derived(relativeDue(due, today));
	const kind = $derived(done ? 'plain' : dueState(due, today));
	const text = $derived(done ? (label.date ?? label.text) : label.text);
	/** Full date for screen readers when the visible text is a relative one. */
	const suffix = $derived(label.date !== null && text !== label.date ? `, ${label.date}` : '');
</script>

{#if label.datetime === null}
	<span class="due" data-due="none">
		<span aria-hidden="true">{label.text}</span>
		<span class="visually-hidden">{label.spoken}</span>
	</span>
{:else}
	<span class="due" data-due={kind}>
		{#if kind === 'overdue'}
			<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
				<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5" />
				<path
					d="M8 4.75V8.5l2.25 1.5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
				/>
			</svg>
		{:else if kind === 'today' || kind === 'tomorrow'}
			<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
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
			</svg>
		{/if}
		<time datetime={label.datetime} title={label.date}
			>{text}{#if suffix}<span class="visually-hidden">{suffix}</span>{/if}</time
		>
	</span>
{/if}

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
