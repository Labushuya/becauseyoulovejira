<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { CalendarDate } from '$lib/domain/berlin-date';
	import {
		entryCountText,
		fullDateLabel,
		type CalendarEntry,
		type CalendarPeriod
	} from '$lib/domain/calendar';
	import { rowMenus } from '$lib/overlay/context-menu';
	import EmptyState from '../guidance/EmptyState.svelte';

	// Agenda (ADR-0053 §3): the days of the period with entries as a list, from its first day on
	// (today by default), each under its full date; above them, while the period holds today, the
	// group "Überfällig" with the open tickets due before it, oldest first, each with its due date.
	// A list, no grid: Tab goes from entry to entry, and every ticket has its menu "•••" with the
	// right click and Shift+F10 of the rows (rowMenus).
	let {
		period,
		today,
		days,
		overdue,
		titleId,
		entry
	}: {
		period: CalendarPeriod;
		today: CalendarDate;
		days: ReadonlyMap<CalendarDate, readonly CalendarEntry[]>;
		/** The group "Überfällig"; empty without it. */
		overdue: readonly CalendarEntry[];
		titleId: string;
		entry: Snippet<[CalendarEntry, 'dot' | 'line' | 'block' | 'row', boolean, boolean]>;
	} = $props();

	const uid = $props.id();
	/** The days of the period that have entries, in their order. */
	const shown = $derived(
		[...days.entries()]
			.filter(([date]) => date >= period.from && date <= period.to)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
	);
</script>

<section class="agenda" aria-labelledby={titleId} {@attach rowMenus}>
	{#if overdue.length > 0}
		<section class="group overdue" aria-labelledby={`${uid}-overdue`}>
			<h4 id={`${uid}-overdue`}>
				Überfällig <span class="count">({entryCountText(overdue.length)})</span>
			</h4>
			<ul class="entries">
				{#each overdue as item (item.key)}
					{@render entry(item, 'row', true, true)}
				{/each}
			</ul>
		</section>
	{/if}
	{#each shown as [date, list] (date)}
		<section class="group" aria-labelledby={`${uid}-${date}`}>
			<h4 id={`${uid}-${date}`} class:today={date === today}>
				{fullDateLabel(date)}{date === today ? ' · heute' : ''}
			</h4>
			<ul class="entries">
				{#each list as item (item.key)}
					{@render entry(item, 'row', true, false)}
				{/each}
			</ul>
		</section>
	{:else}
		{#if overdue.length === 0}
			<EmptyState
				size="compact"
				headingLevel={4}
				title="Keine Einträge in diesen vier Wochen"
				description="Mit „Nächste 4 Wochen“ geht es weiter; Filter und Ebenen bestimmen, was erscheint."
			/>
		{/if}
	{/each}
</section>

<style>
	.agenda {
		display: grid;
		gap: 1rem;
	}

	.group {
		padding: 0.5rem 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-surface);
	}

	h4 {
		margin-bottom: 0.25rem;
		font-size: var(--font-size-body);
		font-weight: 600;
	}

	h4.today {
		color: var(--color-brand-text);
	}

	.count {
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.entries {
		display: grid;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.entries > :global(li:first-child) {
		border-top: none;
	}
</style>
