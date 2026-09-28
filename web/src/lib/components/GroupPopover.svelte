<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { GROUPINGS, GROUPING_LABELS, type Grouping } from '$lib/domain/grouping';
	import { parseListQuery, type ListQuery } from '$lib/domain/list-query';
	import { withListQuery } from '$lib/ticket-links';
	import Popover from './overlay/Popover.svelte';

	// Popover "Gruppieren" in the section bar (E3 plan, T-7, T-8 and package 13; ADR-0025
	// section 5): a panel of the popover building block, right-aligned below the button. The
	// content is a fieldset with radio inputs; a choice is a navigation with a history entry (URL
	// parameter `gruppe`). A pointer click or Enter closes the popover; the arrow keys apply the
	// grouping at once and leave it open, so the keyboard can move through the choices. On opening
	// the focus goes to the chosen grouping.
	// Two levels (plan OR-3, ADR-0013 addendum B): a second fieldset "Danach gruppieren" below the
	// first (`untergruppe`), with "Keine" and every grouping except the first level. It is locked
	// (disabled) with a hint while there is no first level; choosing the second level as first
	// clears the second.
	const uid = $props.id();
	const legendId = `${uid}-legend`;
	const secondHintId = `${uid}-second-hint`;

	const NONE = '';
	type Choice = { value: Grouping | typeof NONE; label: string };
	const choices: readonly Choice[] = [
		{ value: NONE, label: 'Keine' },
		...GROUPINGS.map((value) => ({ value, label: `Nach ${GROUPING_LABELS[value]}` }))
	];

	const query = $derived(parseListQuery(page.url.searchParams));
	const grouping = $derived(query.grouping);
	const subGrouping = $derived(query.subGrouping);
	/** The second level offers every grouping except the first. */
	const secondChoices = $derived(choices.filter((choice) => choice.value !== grouping));
	const buttonLabel = $derived(
		grouping === null
			? 'Gruppieren'
			: `Gruppiert: ${GROUPING_LABELS[grouping]}${
					subGrouping === null ? '' : ` › ${GROUPING_LABELS[subGrouping]}`
				}`
	);

	function valueOf(event: Event & { currentTarget: HTMLInputElement }): Grouping | null {
		const value = event.currentTarget.value;
		return value === NONE ? null : (value as Grouping);
	}

	async function navigate(next: ListQuery) {
		await goto(withListQuery(page.url, next), { keepFocus: true, noScroll: true });
	}

	async function chooseFirst(event: Event & { currentTarget: HTMLInputElement }) {
		const next = valueOf(event);
		const current = parseListQuery(page.url.searchParams);
		if (current.grouping === next) return;
		// The second level stays unless it is the new first one (or there is none).
		const second = next === null || current.subGrouping === next ? null : current.subGrouping;
		await navigate({ ...current, grouping: next, subGrouping: second });
	}

	async function chooseSecond(event: Event & { currentTarget: HTMLInputElement }) {
		const next = valueOf(event);
		const current = parseListQuery(page.url.searchParams);
		if (current.grouping === null || current.subGrouping === next) return;
		await navigate({ ...current, subGrouping: next });
	}

	/** A pointer click (detail > 0) closes; a click the arrow keys cause does not. */
	function closeOnClick(event: MouseEvent, close: () => void) {
		if (event.detail > 0) close();
	}

	function closeOnEnter(event: KeyboardEvent, close: () => void) {
		if (event.key === 'Enter') {
			event.preventDefault();
			close();
		}
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
							onchange={chooseFirst}
							onclick={(event) => closeOnClick(event, close)}
							onkeydown={(event) => closeOnEnter(event, close)}
						/>
						{choice.label}
					</label>
				{/each}
			</fieldset>
			<fieldset
				class="second"
				disabled={grouping === null}
				aria-describedby={grouping === null ? secondHintId : undefined}
			>
				<legend>Danach gruppieren</legend>
				{#each secondChoices as choice, index (choice.value)}
					{@const checked = (subGrouping ?? NONE) === choice.value}
					<label class="choice" class:checked class:after-none={index === 1}>
						<input
							type="radio"
							name={`${uid}-sub-grouping`}
							value={choice.value}
							{checked}
							onchange={chooseSecond}
							onclick={(event) => closeOnClick(event, close)}
							onkeydown={(event) => closeOnEnter(event, close)}
						/>
						{choice.label}
					</label>
				{/each}
				{#if grouping === null}
					<p class="hint" id={secondHintId}>Erst eine erste Ebene wählen.</p>
				{/if}
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
		font-size: var(--font-size-control);
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

	.second {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-line);
	}

	.second:disabled .choice {
		color: var(--color-text-muted);
		cursor: not-allowed;
	}

	legend {
		padding: 0 0.375rem 0.25rem;
		font-size: var(--font-size-small);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.choice {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		padding: 0.25rem 0.375rem;
		font-size: var(--font-size-body);
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

	.hint {
		padding: 0.25rem 0.375rem 0;
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
