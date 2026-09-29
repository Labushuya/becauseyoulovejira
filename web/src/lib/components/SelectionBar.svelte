<script lang="ts">
	import type { Snippet } from 'svelte';

	// Bar of the chosen rows of a table (plan BI-2, ADR-0036 §3; since the trash, ADR-0037, shared
	// by "Aufgaben" and "Papierkorb"): it names the number of chosen rows, offers the actions of its
	// owner and "Auswahl aufheben". Control layer, so glass (ADR-0029 section 1): it stands sticky
	// above the table while the list scrolls. While an action runs, a progress bar replaces the
	// buttons and the bar is aria-busy; the result of the last action stands below them.
	let {
		countText,
		progress = null,
		label = 'Sammelaktionen',
		onclear,
		bar = $bindable(),
		actions,
		actionsShown = true,
		result
	}: {
		/** "3 Tickets ausgewählt". */
		countText: string;
		/** The running action, null while none runs. */
		progress?: { total: number; done: number; text: string } | null;
		/** Name of the group of buttons. */
		label?: string;
		/** "Auswahl aufheben". */
		onclear: () => void;
		/** The bar, e.g. to keep the focus inside after an action. */
		bar?: HTMLElement;
		/** The buttons; shown while no action runs and something is chosen. */
		actions: Snippet;
		/** False: nothing is chosen (the bar only shows a result); no buttons. */
		actionsShown?: boolean;
		/** Result of the last action (failures, notes); shown below, pass it only with content. */
		result?: Snippet;
	} = $props();

	const uid = $props.id();
</script>

<section
	class="bulk-bar"
	aria-labelledby={`${uid}-count`}
	aria-busy={progress ? 'true' : undefined}
	bind:this={bar}
>
	<p class="count" id={`${uid}-count`} aria-live="polite">{countText}</p>
	{#if progress}
		<div class="progress" role="status">
			<progress max={progress.total} value={progress.done} aria-labelledby={`${uid}-progress`}
			></progress>
			<span id={`${uid}-progress`}>{progress.text}</span>
		</div>
	{:else if actionsShown}
		<div class="actions" role="group" aria-label={label}>
			{@render actions()}
		</div>
		<button
			class="button-icon clear"
			type="button"
			aria-label="Auswahl aufheben"
			title="Auswahl aufheben (Esc)"
			onclick={onclear}
		>
			<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
				<path d="M4 4l8 8M12 4l-8 8" />
			</svg>
		</button>
	{/if}
	{#if result}
		<div class="result">{@render result()}</div>
	{/if}
</section>

<style>
	/*
	 * Control layer on glass (ADR-0029 section 1): thick material, because the table scrolls below
	 * it; line in --color-separator and the popover shadow, always with the line. Sticky above the
	 * table, below the header from 64rem, where the header stands.
	 */
	.bulk-bar {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 0.75rem;
		align-items: center;
		margin-bottom: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--material-thick);
		backdrop-filter: var(--glass-filter-thick);
		border: 1px solid var(--color-separator);
		border-radius: var(--radius-overlay);
		box-shadow: var(--shadow-popover);
	}

	@media (min-width: 64rem) {
		.bulk-bar {
			top: calc(var(--app-header-height, 0px) + 0.5rem);
		}
	}

	.count {
		font-size: var(--font-size-body);
		font-weight: 600;
		white-space: nowrap;
	}

	.actions {
		display: flex;
		flex: 1 1 auto;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.clear {
		margin-left: auto;
	}

	.clear svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	.progress {
		display: flex;
		flex: 1 1 auto;
		gap: 0.75rem;
		align-items: center;
		font-size: var(--font-size-control);
	}

	progress {
		flex: 1 1 10rem;
		max-width: 20rem;
		accent-color: var(--color-brand);
	}

	.result {
		display: grid;
		flex: 1 1 100%;
		gap: 0.5rem;
		justify-items: start;
		font-size: var(--font-size-control);
	}
</style>
