<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { getMobileLayoutStore } from '$lib/mobile-layout.svelte';
	import { findFlagStore } from '$lib/stores/flags.svelte';

	// Bar of the chosen rows of a table (plan BI-2, ADR-0036 §3; since the trash, ADR-0037, shared
	// by "Aufgaben" and "Papierkorb"): it names the number of chosen rows, offers the actions of its
	// owner and "Auswahl aufheben". Control layer, so glass (ADR-0029 section 1): it stands sticky
	// above the table while the list scrolls. While an action runs, a progress bar replaces the
	// buttons and the bar is aria-busy; the result of the last action stands below them.
	// Phone frame (MO-7b, ADR-0073 addendum MO-7b): the one bar of "Auswählen" for "Aufgaben",
	// "Eingang" and "Papierkorb", fixed at the bottom above the bottom bar (and above the keyboard while
	// the bottom bar gives way), also below a short list; the owner puts it after its cards, where it
	// keeps the room of its row, so the last card scrolls above it. Flat, one row of 44 px: the number,
	// "Aktionen" and "Fertig" (`onclear`: the owner leaves "Auswählen"). "Aktionen" opens the same
	// buttons as on the PC above the row, one level deeper, and puts the focus on the first; while
	// nothing is chosen it stays, locked, and says why (`hint`): to a screen reader, and in a flag on a
	// tap or Enter (the rule of OF-4b). The actions close after an action and whenever they cannot be
	// shown. Outside of "Auswählen" (`selecting` false) the bar only stands for a running action or a
	// result: the row holds the number alone, without "Aktionen" and "Fertig", like the bar of the PC
	// without a selection, and "Ergebnis schließen" of the result closes it (round 2 of MO-7b). The
	// flags stand at the top meanwhile (FlagGroup).
	let {
		countText,
		progress = null,
		progressId,
		label = 'Sammelaktionen',
		hint = '',
		onclear,
		bar = $bindable(),
		actions,
		actionsShown = true,
		selecting = true,
		result
	}: {
		/** "3 Tickets ausgewählt". */
		countText: string;
		/** The running action, null while none runs. */
		progress?: { total: number; done: number; text: string } | null;
		/**
		 * ID of the text of the progress, for actions of the owner outside the bar that the run locks
		 * (their `aria-describedby`, EG-1 round 2); without it the bar makes its own.
		 */
		progressId?: string;
		/** Name of the group of buttons. */
		label?: string;
		/** Why "Aktionen" is locked in the phone frame while nothing is chosen, e.g. "Erst Tickets auswählen.". */
		hint?: string;
		/** "Auswahl aufheben"; in the phone frame "Fertig". */
		onclear: () => void;
		/** The bar, e.g. to keep the focus inside after an action. */
		bar?: HTMLElement;
		/** The buttons; shown while no action runs and something is chosen. */
		actions: Snippet;
		/** False: nothing is chosen (the bar only shows a result); no buttons. */
		actionsShown?: boolean;
		/**
		 * Phone frame: the owner is in "Auswählen". False: the bar stands only for a running action or
		 * a result; no "Aktionen" and no "Fertig". The PC does not use it.
		 */
		selecting?: boolean;
		/** Result of the last action (failures, notes); shown below, pass it only with content. */
		result?: Snippet;
	} = $props();

	const uid = $props.id();
	const ids = { actions: `${uid}-actions`, hint: `${uid}-hint` };
	const progressTextId = $derived(progressId ?? `${uid}-progress`);
	const mobileLayout = getMobileLayoutStore();
	const phone = $derived(mobileLayout.active);
	const flags = findFlagStore();

	/** The actions of the phone frame can be shown: choosing, something chosen, no action running. */
	const openable = $derived(selecting && actionsShown && progress === null);
	/**
	 * The actions of the phone frame are open above the row. "Aktionen" toggles it (a writable
	 * $derived); whenever they cannot be shown it derives anew, so after an action, after the
	 * selection emptied and after "Auswählen" they start closed.
	 */
	let opened = $derived.by(() => {
		void openable;
		return false;
	});
	const actionsOpen = $derived(opened && openable);
	let actionsGroup = $state<HTMLElement>();

	/** "Aktionen": opens or closes the actions; locked, it names why in a flag. */
	async function toggleActions() {
		if (!actionsShown) {
			if (hint !== '') flags?.show({ tone: 'info', title: hint });
			return;
		}
		opened = !opened;
		if (!opened) return;
		await tick();
		actionsGroup
			?.querySelector<HTMLElement>(
				'button:not([disabled]):not([tabindex="-1"]), a[href]:not([tabindex="-1"])'
			)
			?.focus();
	}
</script>

{#snippet progressBar(running: { total: number; done: number; text: string })}
	<div class="progress" role="status">
		<progress max={running.total} value={running.done} aria-labelledby={progressTextId}></progress>
		<span id={progressTextId}>{running.text}</span>
	</div>
{/snippet}

{#if phone}
	<!-- The room of the row of the fixed bar after the cards: the last card scrolls above it. -->
	<div class="selection-room" aria-hidden="true"></div>
{/if}
<section
	class="bulk-bar"
	class:phone
	aria-labelledby={`${uid}-count`}
	aria-busy={progress ? 'true' : undefined}
	data-selection-bar={phone ? '' : undefined}
	bind:this={bar}
>
	{#if phone}
		{#if result}
			<div class="result">{@render result()}</div>
		{/if}
		{#if actionsOpen}
			<div
				class="actions"
				id={ids.actions}
				role="group"
				aria-label={label}
				bind:this={actionsGroup}
			>
				{@render actions()}
			</div>
		{/if}
		<div class="phone-row">
			<p class="count" id={`${uid}-count`} aria-live="polite">{countText}</p>
			{#if progress}
				{@render progressBar(progress)}
			{:else if selecting}
				<button
					class="button-secondary"
					type="button"
					aria-expanded={actionsOpen}
					aria-controls={actionsOpen ? ids.actions : undefined}
					aria-disabled={actionsShown ? undefined : 'true'}
					aria-describedby={!actionsShown && hint !== '' ? ids.hint : undefined}
					title={!actionsShown && hint !== '' ? hint : undefined}
					onclick={() => void toggleActions()}
				>
					Aktionen
				</button>
				{#if !actionsShown && hint !== ''}
					<span class="visually-hidden" id={ids.hint}>{hint}</span>
				{/if}
				<button class="button-secondary" type="button" onclick={onclear}>Fertig</button>
			{/if}
		</div>
	{:else}
		<p class="count" id={`${uid}-count`} aria-live="polite">{countText}</p>
		{#if progress}
			{@render progressBar(progress)}
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

	/*
	 * Phone frame (MO-7b, ADR-0073 addendum MO-7b): fixed at the bottom between the margins of the
	 * page, above the bottom bar and its safe area, also below a short list; its room after the cards
	 * keeps the last card above it. While a field opens the keyboard the window ends above it and the
	 * bar with it; the bar keeps its place where the bottom bar gives way, so it does not jump below
	 * the finger when the keyboard closes on a tap on "Fertig". One row of 44 px (the number may wrap,
	 * the buttons keep their words); the actions and a result above it, the actions in a grid of two
	 * columns. A bar higher than the room below the top bar scrolls its actions and its result, never
	 * its row.
	 */
	@media (max-width: 39.99rem) {
		:global(:root[data-mobile-layout='on']) .selection-room {
			height: calc(var(--control-height-touch) + 2.5rem);
		}

		:global(:root[data-mobile-layout='on']) .bulk-bar {
			position: fixed;
			top: auto;
			right: var(--page-inline);
			bottom: calc(var(--bottom-bar-height) + var(--safe-bottom) + 0.5rem);
			left: var(--page-inline);
			z-index: 4;
			flex-direction: column;
			flex-wrap: nowrap;
			align-items: stretch;
			max-height: calc(
				100dvh - var(--top-bar-height) - var(--safe-top) - var(--bottom-bar-height) -
					var(--safe-bottom) - 1rem
			);
			margin: 0;
		}

		:global(:root[data-mobile-layout='on']) .bulk-bar.phone :is(.actions, .result) {
			flex: 0 1 auto;
			min-height: 0;
			overflow-y: auto;
		}

		:global(:root[data-mobile-layout='on']) .bulk-bar.phone .phone-row {
			flex: none;
		}

		:global(:root[data-mobile-layout='on']) .phone-row {
			display: flex;
			gap: 0.5rem;
			align-items: center;
			min-width: 0;
		}

		:global(:root[data-mobile-layout='on']) .phone-row .count {
			flex: 1 1 auto;
			min-width: 0;
			white-space: normal;
			overflow-wrap: anywhere;
		}

		:global(:root[data-mobile-layout='on']) .phone-row .button-secondary {
			flex: none;
		}

		:global(:root[data-mobile-layout='on']) .bulk-bar.phone .actions {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 0.5rem;
		}

		:global(:root[data-mobile-layout='on']) .bulk-bar.phone .actions :global(:is(button, a)) {
			width: 100%;
			min-height: var(--control-height-touch);
			white-space: normal;
		}
	}
</style>
