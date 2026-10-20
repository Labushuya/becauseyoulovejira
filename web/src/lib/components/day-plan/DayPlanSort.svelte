<script lang="ts">
	import { tick } from 'svelte';
	import {
		DAY_PLAN_SORT_LABELS,
		SORTED_MOVE_HINT,
		SORT_DIRECTIONS,
		SORT_DIRECTION_LABELS,
		directionHint,
		sortBy,
		sortButtonText,
		sortKeysFor,
		sortedText,
		type DayPlanSortKey,
		type SortDirection
	} from '$lib/domain/day-plan-sort';
	import type { DayPlanStore } from '$lib/stores/day-plan.svelte';
	import Popover from '../overlay/Popover.svelte';
	import MenuChoice from '../table/MenuChoice.svelte';

	// "Sortierung" in the head of the plan (TP-5, ADR-0065 addendum TP-5): a view of this device, never
	// a rewrite. A menu of the popover building block (menuitemradio, like the cell menus of
	// "Aufgaben") offers "Manuell" and the criteria, "Zuständigkeit" only in a household; a criterion
	// starts with the direction of its first click in "Aufgaben". Sorted, a segmented pair
	// "Aufsteigend | Absteigend" (aria-pressed, like the order of the comments) turns the direction,
	// each with what it means as a tooltip; "Manuell" has no direction. Below, a hint says what the
	// sort does and, in a plan that can change, that moving needs "Manuell"; with the route of the
	// order "Als manuelle Reihenfolge übernehmen" makes the order shown the stored one. After that the
	// button is gone, so the focus goes to "Sortierung". Changes are announced by the status region of
	// the view (store.announcement).
	let {
		store,
		household = false,
		hintId
	}: {
		store: DayPlanStore;
		/** The plan of a household: "Zuständigkeit" is a choice. */
		household?: boolean;
		/** ID of the hint, which names the list of the plan as its description. */
		hintId: string;
	} = $props();

	let trigger = $state<HTMLButtonElement>();

	const sort = $derived(store.sort);
	const sorted = $derived(store.sorted);
	const keys = $derived(sortKeysFor(household));

	function choose(key: DayPlanSortKey, close: () => void) {
		close();
		if (key !== sort.key) store.setSort(sortBy(key));
	}

	function turn(direction: SortDirection) {
		if (direction !== sort.direction) store.setSort({ key: sort.key, direction });
	}

	async function adopt() {
		if (!(await store.adoptOrder())) return;
		await tick();
		trigger?.focus();
	}
</script>

<div class="sort-controls">
	<div class="sort-menu">
		<Popover
			kind="menu"
			label="Sortierung"
			placement="bottom-start"
			buttonClass={sorted ? 'toggle active' : 'toggle'}
			bind:trigger
		>
			{#snippet button()}
				<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<path d="M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5" />
				</svg>
				{sortButtonText(sort)}
			{/snippet}
			{#snippet children({ close })}
				{#each keys as key (key)}
					<MenuChoice
						checked={sort.key === key}
						text={DAY_PLAN_SORT_LABELS[key]}
						onchoose={() => choose(key, close)}
					/>
				{/each}
			{/snippet}
		</Popover>
	</div>
	{#if sorted}
		<div class="segmented direction" role="group" aria-label="Richtung">
			{#each SORT_DIRECTIONS as direction (direction)}
				<button
					type="button"
					aria-pressed={sort.direction === direction}
					title={directionHint(sort.key, direction)}
					onclick={() => turn(direction)}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<path d={direction === 'ascending' ? 'M8 13V3M4 7l4-4 4 4' : 'M8 3v10M4 9l4 4 4-4'} />
					</svg>
					{SORT_DIRECTION_LABELS[direction]}
				</button>
			{/each}
		</div>
	{/if}
</div>
{#if sorted}
	<div class="sorted">
		<p class="hint" id={hintId}>
			{sortedText(sort)}{store.editable ? ` ${SORTED_MOVE_HINT}` : ''}
		</p>
		{#if store.canAdoptOrder}
			<button
				class="button-secondary button-small"
				type="button"
				aria-busy={store.adopting ? 'true' : undefined}
				aria-disabled={store.adopting ? 'true' : undefined}
				onclick={() => void adopt()}>Als manuelle Reihenfolge übernehmen</button
			>
		{/if}
	</div>
{/if}

<style>
	.sort-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		min-width: 0;
	}

	.sort-menu {
		display: inline-flex;
	}

	/* The look of "Gruppieren" in "Aufgaben": a quiet button, marked while a criterion sorts. */
	.sort-menu :global(.toggle) {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		padding: 0.25rem 0.625rem;
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.sort-menu :global(.toggle:hover) {
		color: var(--color-text);
	}

	.sort-menu :global(.toggle.active) {
		font-weight: 600;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	svg {
		width: 0.875rem;
		height: 0.875rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* Its own row below the heading and the controls. */
	.sorted {
		display: flex;
		flex: 1 0 100%;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		align-items: center;
		min-width: 0;
	}

	.hint {
		flex: 1 1 16rem;
		min-width: 0;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	/* On a touch screen every target is 44 px (ADR-0060 §2). */
	@media (pointer: coarse) {
		.sort-menu :global(.toggle),
		.direction > button,
		.sorted .button-small {
			min-height: var(--control-height-touch);
		}
	}

	/*
	 * Phone frame (MO-2, ADR-0073 addendum MO-2): "Sortierung" is a target of 44 px, its menu a sheet
	 * (MO-1b); the direction and "Als manuelle Reihenfolge übernehmen" have their 44 px from base.css.
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .sort-menu :global(.toggle) {
			min-height: var(--control-height-touch);
		}
	}
</style>
