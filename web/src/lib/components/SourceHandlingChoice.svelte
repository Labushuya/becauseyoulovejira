<script lang="ts">
	import {
		SOURCE_HANDLINGS,
		SOURCE_HANDLING_HINTS,
		SOURCE_HANDLING_LABELS,
		type SourceHandling
	} from '$lib/domain/sources';

	// What happens to the sources of a ticket that is deleted (ADR-0031, addendum B): back to the
	// inbox (chosen at first) or discarded. Shared by the confirmation of the side panel and the
	// inline question of the full view (ADR-0033 section 4).
	let {
		handling = $bindable('inbox'),
		disabled = false
	}: {
		handling?: SourceHandling;
		disabled?: boolean;
	} = $props();

	const uid = $props.id();
</script>

<fieldset class="handling">
	<legend>Quellen</legend>
	{#each SOURCE_HANDLINGS as value (value)}
		<label class="choice">
			<input
				type="radio"
				name={`${uid}-sources`}
				{value}
				checked={handling === value}
				{disabled}
				aria-describedby={`${uid}-${value}-hint`}
				onchange={() => (handling = value)}
			/>
			<span class="choice-text">
				<span>{SOURCE_HANDLING_LABELS[value]}</span>
				<span class="hint" id={`${uid}-${value}-hint`}>{SOURCE_HANDLING_HINTS[value]}</span>
			</span>
		</label>
	{/each}
</fieldset>

<style>
	.handling {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: 0.25rem;
		font-weight: 600;
	}

	.choice {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.5rem;
		align-items: start;
		cursor: pointer;
	}

	.choice input {
		margin-top: 0.125rem;
	}

	.choice-text {
		display: grid;
		gap: 0.125rem;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
