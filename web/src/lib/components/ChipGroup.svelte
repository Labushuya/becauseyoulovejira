<script lang="ts" generics="T extends string">
	// Chip group of the filter bar (E3 plan, T-6; ADR-0010 section 5): a fieldset with legend and
	// native radio inputs shown as chips, so Tab enters the group and the arrow keys move within
	// it without own code. Exactly one value is chosen; "Alle" (null) is the start value. The
	// chosen chip has a check mark and a heavier weight besides its colour (ADR-0010 section 3).
	let {
		legend,
		name,
		options,
		value,
		all = 'Alle',
		onchange
	}: {
		legend: string;
		/** Name of the radio inputs; unique on the page. */
		name: string;
		options: readonly { value: T; label: string }[];
		/** Chosen value, null for "Alle". */
		value: T | null;
		/** Label of the chip for no value; null leaves it out (a group that always has a value). */
		all?: string | null;
		onchange: (value: T | null) => void;
	} = $props();

	/** Value of the radio "Alle"; the real values are never empty. */
	const ALL = '';

	const choices = $derived(all === null ? [...options] : [{ value: ALL, label: all }, ...options]);

	function choose(event: Event & { currentTarget: HTMLInputElement }) {
		const chosen = event.currentTarget.value;
		onchange(chosen === ALL ? null : (chosen as T));
	}
</script>

<fieldset class="chip-group">
	<legend>{legend}</legend>
	<div class="chips">
		{#each choices as choice (choice.value)}
			{@const checked = (value ?? ALL) === choice.value}
			<label class="chip" class:checked>
				<input type="radio" {name} value={choice.value} {checked} onchange={choose} />
				{#if checked}
					<svg class="check" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<path d="M3.5 8.5l3 3 6-7" />
					</svg>
				{/if}
				{choice.label}
			</label>
		{/each}
	</div>
</fieldset>

<style>
	.chip-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		align-items: center;
		min-width: 0;
		border: none;
	}

	legend {
		float: left;
		margin-right: 0.375rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.chip {
		position: relative;
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		padding: 0.1875rem 0.625rem;
		font-size: 0.8125rem;
		line-height: 1.25rem;
		color: var(--color-text-muted);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: 999px;
		cursor: pointer;
	}

	.chip:hover {
		color: var(--color-text);
	}

	.chip.checked {
		font-weight: 600;
		color: var(--color-brand-soft-text);
		background: var(--color-brand-soft-bg);
		border-color: var(--color-brand);
	}

	/* The radio stays in the accessibility tree and takes the focus; the chip shows it. */
	input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	.chip:has(input:focus-visible) {
		outline: 2px solid var(--color-brand);
		outline-offset: 2px;
	}

	.check {
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
