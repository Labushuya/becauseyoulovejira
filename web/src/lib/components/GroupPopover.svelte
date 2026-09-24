<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { GROUPINGS, GROUPING_LABELS, type Grouping } from '$lib/domain/grouping';
	import { parseListQuery } from '$lib/domain/list-query';
	import { withListQuery } from '$lib/ticket-links';

	// Popover "Gruppieren" in the section bar (E3 plan, T-7, T-8 and package 13; ADR-0010 section
	// 5): the native popover API (popover="auto" on the field, popovertarget on the button), so
	// Escape, a click outside, the focus return and the expanded state come from the browser. The
	// content is a fieldset with radio inputs; a choice is a navigation with a history entry
	// (URL parameter `gruppe`). A pointer click or Enter closes the popover; the arrow keys apply
	// the grouping at once and leave it open, so the keyboard can move through the choices.
	const uid = $props.id();
	const ids = { popover: `${uid}-popover`, legend: `${uid}-legend` };

	const NONE = '';
	const choices: readonly { value: Grouping | typeof NONE; label: string }[] = [
		{ value: NONE, label: 'Keine' },
		...GROUPINGS.map((value) => ({ value, label: `Nach ${GROUPING_LABELS[value]}` }))
	];

	const grouping = $derived(parseListQuery(page.url.searchParams).grouping);
	const buttonLabel = $derived(
		grouping === null ? 'Gruppieren' : `Gruppiert: ${GROUPING_LABELS[grouping]}`
	);

	let button = $state<HTMLButtonElement>();
	let popover = $state<HTMLElement>();

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

	/** Closes the popover and returns the focus to its button (jsdom has no popover API). */
	function close() {
		if (typeof popover?.hidePopover === 'function' && popover.matches(':popover-open')) {
			popover.hidePopover();
		}
		button?.focus();
	}

	/** A pointer click (detail > 0) closes; a click the arrow keys cause does not. */
	function onclick(event: MouseEvent) {
		if (event.detail > 0) close();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			close();
		}
	}
</script>

<div class="group-popover">
	<button
		class="toggle"
		class:active={grouping !== null}
		type="button"
		popovertarget={ids.popover}
		aria-controls={ids.popover}
		bind:this={button}
	>
		<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
			<path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11M5 3.5v9" />
		</svg>
		{buttonLabel}
	</button>
	<div class="panel" id={ids.popover} popover="auto" bind:this={popover}>
		<fieldset>
			<legend id={ids.legend}>Gruppieren</legend>
			{#each choices as choice (choice.value)}
				{@const checked = (grouping ?? NONE) === choice.value}
				<label class="choice" class:checked>
					<input
						type="radio"
						name={`${uid}-grouping`}
						value={choice.value}
						{checked}
						onchange={choose}
						{onclick}
						{onkeydown}
					/>
					{choice.label}
				</label>
			{/each}
		</fieldset>
	</div>
</div>

<style>
	.group-popover {
		position: relative;
		display: inline-flex;
	}

	.toggle {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		padding: 0.25rem 0.625rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
		cursor: pointer;
		anchor-name: --group-popover;
	}

	.toggle:hover {
		color: var(--color-text);
	}

	.toggle.active {
		font-weight: 600;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	.toggle svg {
		width: 0.875rem;
		height: 0.875rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	.panel {
		padding: 0.5rem;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 0.375rem;
	}

	/* Below the button where anchor positioning exists; otherwise the browser centres it. */
	@supports (position-anchor: --group-popover) {
		.panel {
			position-anchor: --group-popover;
			inset: auto;
			top: anchor(bottom);
			right: anchor(right);
			margin: 0.25rem 0 0;
		}
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
		border-radius: 0.25rem;
		cursor: pointer;
	}

	.choice:hover {
		background: var(--color-bg);
	}

	.choice.checked {
		font-weight: 600;
	}

	.choice input {
		accent-color: var(--color-brand);
	}
</style>
