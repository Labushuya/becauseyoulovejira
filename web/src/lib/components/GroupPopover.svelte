<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { GROUPINGS, GROUPING_LABELS, type Grouping } from '$lib/domain/grouping';
	import { parseListQuery } from '$lib/domain/list-query';
	import { withListQuery } from '$lib/ticket-links';
	import Popover from './overlay/Popover.svelte';

	// Popover "Gruppieren" in the section bar (E3 plan, T-7, T-8 and package 13; ADR-0025
	// section 5): a panel of the popover building block, right-aligned below the button. The
	// content is a fieldset with radio inputs; a choice is a navigation with a history entry (URL
	// parameter `gruppe`). A pointer click or Enter closes the popover; the arrow keys apply the
	// grouping at once and leave it open, so the keyboard can move through the choices. On opening
	// the focus goes to the chosen grouping.
	const uid = $props.id();
	const legendId = `${uid}-legend`;

	const NONE = '';
	const choices: readonly { value: Grouping | typeof NONE; label: string }[] = [
		{ value: NONE, label: 'Keine' },
		...GROUPINGS.map((value) => ({ value, label: `Nach ${GROUPING_LABELS[value]}` }))
	];

	const grouping = $derived(parseListQuery(page.url.searchParams).grouping);
	const buttonLabel = $derived(
		grouping === null ? 'Gruppieren' : `Gruppiert: ${GROUPING_LABELS[grouping]}`
	);

	async function choose(event: Event & { currentTarget: HTMLInputElement }) {
		const value = event.currentTarget.value;
		const next = value === NONE ? null : (value as Grouping);
		const current = parseListQuery(page.url.searchParams);
		if (current.grouping === next) return;
		await goto(withListQuery(page.url, { ...current, grouping: next }), {
			keepFocus: true,
			noScroll: true
		});
	}
</script>

<div class="group-popover">
	<Popover
		kind="panel"
		labelledby={legendId}
		placement="bottom-end"
		buttonClass={grouping === null ? 'toggle' : 'toggle active'}
	>
		{#snippet button()}
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11M5 3.5v9" />
			</svg>
			{buttonLabel}
		{/snippet}
		{#snippet children({ close })}
			<fieldset>
				<legend id={legendId}>Gruppieren</legend>
				{#each choices as choice, index (choice.value)}
					{@const checked = (grouping ?? NONE) === choice.value}
					<label class="choice" class:checked class:after-none={index === 1}>
						<input
							type="radio"
							name={`${uid}-grouping`}
							value={choice.value}
							{checked}
							onchange={choose}
							onclick={(event) => {
								// A pointer click (detail > 0) closes; a click the arrow keys cause does not.
								if (event.detail > 0) close();
							}}
							onkeydown={(event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									close();
								}
							}}
						/>
						{choice.label}
					</label>
				{/each}
			</fieldset>
		{/snippet}
	</Popover>
</div>

<style>
	.group-popover {
		display: inline-flex;
	}

	.group-popover :global(.toggle) {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		padding: 0.25rem 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.group-popover :global(.toggle:hover) {
		color: var(--color-text);
	}

	.group-popover :global(.toggle.active) {
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

	fieldset {
		display: grid;
		gap: 0.125rem;
		min-width: 11rem;
		border: none;
	}

	legend {
		padding: 0 0.375rem 0.25rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.choice {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		padding: 0.25rem 0.375rem;
		font-size: 0.875rem;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	/* Line after "Keine", as in the reference layout. */
	.choice.after-none {
		margin-top: 0.25rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-line);
		border-radius: 0;
	}

	.choice:hover {
		background: var(--color-bg);
	}

	/* The chosen grouping: the radio and the weight, never color alone (WCAG 1.4.1). */
	.choice.checked {
		font-weight: 600;
	}
</style>
