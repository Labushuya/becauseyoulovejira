<script lang="ts">
	import Popover from './overlay/Popover.svelte';

	// Choice of the filter bar for "Projekt" and "Tag" (ADR-0025 section 5; plan UI-Konsistenz,
	// package UI-9): a panel of the popover building block instead of a native select, chosen like
	// "Gruppieren". A fieldset with radios: "Alle" first, then the options, some of them in a
	// section of their own (e.g. "Archiviert"). One value per group; the choice goes to the owner,
	// which writes it to the URL. A pointer click or Enter closes the popover; the arrow keys apply a
	// choice at once and leave it open. From SEARCH_FROM options a search field on top narrows the
	// list; it gets the focus on opening, Enter there takes the first match, ArrowDown moves to the
	// radios. The button names the group and the chosen value; a chosen value looks active.
	let {
		legend,
		name,
		options,
		value,
		allLabel = 'Alle',
		onchange
	}: {
		/** Name of the group, e.g. "Projekt". */
		legend: string;
		/** Name of the radio inputs; unique on the page. */
		name: string;
		/** Options without "Alle"; `section` puts an option below a heading of its own. */
		options: readonly { value: string; label: string; section?: string }[];
		/** Chosen value, null for "Alle". */
		value: string | null;
		allLabel?: string;
		onchange: (value: string | null) => void;
	} = $props();

	/** From this number of options the popover offers a search field (plan UI-9). */
	const SEARCH_FROM = 10;
	/** Value of the radio "Alle"; the real values are never empty. */
	const ALL = '';

	const uid = $props.id();
	const legendId = `${uid}-legend`;

	let query = $state('');
	let search = $state<HTMLInputElement>();

	const searchable = $derived(options.length >= SEARCH_FROM);
	const needle = $derived(query.trim().toLocaleLowerCase('de'));
	const shown = $derived(
		needle === ''
			? options
			: options.filter((option) => option.label.toLocaleLowerCase('de').includes(needle))
	);
	const plain = $derived(shown.filter((option) => option.section === undefined));
	const sections = $derived.by(() => {
		const titles = [
			...new Set(shown.flatMap((option) => (option.section === undefined ? [] : [option.section])))
		];
		return titles.map((title) => ({
			title,
			options: shown.filter((option) => option.section === title)
		}));
	});
	const chosenLabel = $derived(
		value === null
			? allLabel
			: (options.find((option) => option.value === value)?.label ?? allLabel)
	);

	function choose(event: Event & { currentTarget: HTMLInputElement }) {
		const chosen = event.currentTarget.value;
		const next = chosen === ALL ? null : chosen;
		if (next !== value) onchange(next);
	}

	function radios(popover: HTMLElement): HTMLInputElement[] {
		return [...popover.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
	}

	function onsearchkeydown(
		event: KeyboardEvent & { currentTarget: HTMLInputElement },
		close: () => void
	) {
		const popover = event.currentTarget.closest<HTMLElement>('[popover]');
		if (popover === null) return;
		if (event.key === 'Enter') {
			event.preventDefault();
			const first = shown[0];
			if (first === undefined) return;
			if (first.value !== value) onchange(first.value);
			close();
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			const list = radios(popover);
			(list.find((radio) => radio.checked) ?? list[0])?.focus();
		}
	}
</script>

<div class="filter-popover">
	<Popover
		kind="panel"
		labelledby={legendId}
		buttonClass={value === null ? 'toggle' : 'toggle active'}
		initialFocus={() => search ?? null}
	>
		{#snippet button()}
			<span class="toggle-legend">{legend}:</span>
			<span class="toggle-value">{chosenLabel}</span>
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path d="M4 6l4 4 4-4" />
			</svg>
		{/snippet}
		{#snippet children({ close })}
			{#snippet choice(option: { value: string; label: string }, index: number)}
				{@const checked = (value ?? ALL) === option.value}
				<label class="choice" class:checked class:after-all={index === 1}>
					<input
						type="radio"
						{name}
						value={option.value}
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
					<span>{option.label}</span>
				</label>
			{/snippet}
			<fieldset>
				<legend id={legendId}>{legend}</legend>
				{#if searchable}
					<input
						class="search"
						type="search"
						autocomplete="off"
						spellcheck="false"
						aria-label={`${legend} suchen`}
						placeholder="Suchen"
						bind:this={search}
						bind:value={query}
						onkeydown={(event) => onsearchkeydown(event, close)}
					/>
				{/if}
				{@render choice({ value: ALL, label: allLabel }, 0)}
				{#each plain as option, index (option.value)}
					{@render choice(option, index + 1)}
				{/each}
				{#each sections as section (section.title)}
					<fieldset class="section">
						<legend>{section.title}</legend>
						{#each section.options as option (option.value)}
							{@render choice(option, -1)}
						{/each}
					</fieldset>
				{/each}
				{#if shown.length === 0}
					<p class="none">Keine Treffer.</p>
				{/if}
			</fieldset>
		{/snippet}
	</Popover>
</div>

<style>
	.filter-popover {
		display: inline-flex;
	}

	.filter-popover :global(.toggle) {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		max-width: 16rem;
		padding: 0.1875rem 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.filter-popover :global(.toggle:hover) {
		border-color: var(--color-text-muted);
	}

	.filter-popover :global(.toggle.active) {
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	/* A chosen value: colour, weight and the value in the text, never colour alone. */
	.filter-popover :global(.toggle.active .toggle-value) {
		font-weight: 600;
	}

	.toggle-legend {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.toggle-value {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	svg {
		flex: none;
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	fieldset {
		display: grid;
		gap: 0.125rem;
		min-width: 12rem;
		max-width: 20rem;
		border: none;
	}

	legend {
		padding: 0 0.375rem 0.25rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.section {
		min-width: 0;
		margin-top: 0.25rem;
		padding-top: 0.375rem;
		border-top: 1px solid var(--color-line);
	}

	.search {
		margin: 0 0 0.375rem;
		padding: 0.25rem 0.5rem;
		font-size: 0.8125rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
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

	.choice span {
		overflow-wrap: anywhere;
	}

	/* Line after "Alle", as in "Gruppieren". */
	.choice.after-all {
		margin-top: 0.25rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-line);
		border-radius: 0;
	}

	.choice:hover {
		background: var(--color-bg);
	}

	/* The chosen value: the radio and the weight, never colour alone (WCAG 1.4.1). */
	.choice.checked {
		font-weight: 600;
	}

	.choice input {
		accent-color: var(--color-brand);
	}

	.none {
		padding: 0.25rem 0.375rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
	}
</style>
