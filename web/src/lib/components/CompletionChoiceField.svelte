<script lang="ts">
	import {
		COMPLETION_CHOICES,
		COMPLETION_LABELS,
		completionHint,
		type CompletionChoice
	} from '$lib/domain/subtasks';

	// Answer to "N Unteraufgaben sind noch offen – trotzdem erledigen?" (ADR-0033 section 2):
	// "Unteraufgaben mit erledigen" (chosen at first) or "Trotzdem erledigen", each with what it does.
	// Shared by the confirmation of the table and the inline question of panel and full view.
	let {
		choice = $bindable('complete_children'),
		keys,
		count,
		disabled = false
	}: {
		choice?: CompletionChoice;
		/** Keys of (some of) the open blocking sub-tasks. */
		keys: readonly string[];
		/** Number of open blocking sub-tasks. */
		count: number;
		disabled?: boolean;
	} = $props();

	const uid = $props.id();
</script>

<fieldset class="completion">
	<legend>Unteraufgaben</legend>
	{#each COMPLETION_CHOICES as value (value)}
		<label class="choice">
			<input
				type="radio"
				name={`${uid}-completion`}
				{value}
				checked={choice === value}
				{disabled}
				aria-describedby={`${uid}-${value}-hint`}
				onchange={() => (choice = value)}
			/>
			<span class="choice-text">
				<span>{COMPLETION_LABELS[value]}</span>
				<span class="hint" id={`${uid}-${value}-hint`}>{completionHint(value, keys, count)}</span>
			</span>
		</label>
	{/each}
</fieldset>

<style>
	.completion {
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
