<script lang="ts">
	// The button "Filter" in the row of a view in the phone frame (MO-3, ADR-0073 addendum MO-3; since
	// MO-6 shared by "Aufgaben" and "Eingang"): it opens the filter sheet of the view and names how
	// many filters are set, in its name ("Filter, 2 aktiv") and with the accent surface and the number,
	// never with colour alone (WCAG 1.4.1). A target of 44 px from base.css (button-secondary).
	let {
		count,
		onclick
	}: {
		/** Filters set in the view; 0 shows the plain button. */
		count: number;
		onclick: () => void;
	} = $props();
</script>

<button
	class="button-secondary filter-open"
	class:active={count > 0}
	type="button"
	aria-haspopup="dialog"
	aria-label={count > 0 ? `Filter, ${count} aktiv` : 'Filter'}
	{onclick}
>
	<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
		<path d="M2.5 3.5h11l-4.25 5v4l-2.5 1.25V8.5z" />
	</svg>
	Filter
	{#if count > 0}<span class="filter-count" aria-hidden="true">{count}</span>{/if}
</button>

<style>
	/* Only in the phone frame, where the button stands (MO-3). */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .filter-open {
			flex: none;
			gap: 0.375rem;
		}

		:global(:root[data-mobile-layout='on']) .filter-open svg {
			width: 0.875rem;
			height: 0.875rem;
			fill: none;
			stroke: currentColor;
			stroke-width: 1.5;
			stroke-linejoin: round;
		}

		/* Set filters: the accent surface and the number, never colour alone (WCAG 1.4.1). */
		:global(:root[data-mobile-layout='on']) .filter-open.active {
			font-weight: 600;
			color: var(--color-brand-soft-text);
			background: var(--color-brand-soft-bg);
			border-color: var(--color-brand);
		}

		:global(:root[data-mobile-layout='on']) .filter-count {
			min-width: 1.25rem;
			padding: 0 0.3125rem;
			font-size: var(--font-size-small);
			line-height: 1.125rem;
			text-align: center;
			font-variant-numeric: tabular-nums;
			border: 1px solid var(--color-brand);
			border-radius: var(--radius-pill);
		}
	}
</style>
