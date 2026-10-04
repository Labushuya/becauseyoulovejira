<script lang="ts">
	import type { Snippet } from 'svelte';
	import { RETENTION_LABELS, TRASH_RETENTIONS, type TrashRetention } from '$lib/domain/trash';

	// The retention of a trash as a radio group (ADR-0037 §8): 7, 30 (default) or 90 days or never,
	// each with what it means. A choice applies at once; the owner saves it and confirms with a flag.
	// "Einstellungen → Tickets" shows it for the private trash of the account, the page "Haushalt"
	// for the trash of the household (E7-3, ADR-0059 §6).
	let {
		legend,
		value,
		disabled = false,
		busy = false,
		onchoose,
		note
	}: {
		legend: string;
		value: TrashRetention;
		disabled?: boolean;
		busy?: boolean;
		onchoose: (value: TrashRetention) => void;
		/** What the choice is about, below the legend. */
		note: Snippet;
	} = $props();

	const uid = $props.id();

	const DESCRIPTIONS: Record<TrashRetention, string> = {
		'7': 'Für wenig Platzbedarf; nach einer Woche ist ein Ticket endgültig weg.',
		'30': 'Standard: ein Monat Zeit zum Wiederherstellen.',
		'90': 'Für lange Pausen; der Papierkorb wird größer.',
		never: 'Nichts wird automatisch gelöscht; leere den Papierkorb dann selbst.'
	};

	function choose(next: TrashRetention) {
		if (next !== value) onchoose(next);
	}
</script>

<fieldset class="retention" aria-describedby={`${uid}-note`} aria-busy={busy ? 'true' : undefined}>
	<legend>{legend}</legend>
	<p class="note" id={`${uid}-note`}>{@render note()}</p>
	<div class="choices">
		{#each TRASH_RETENTIONS as option (option)}
			<label class="choice">
				<input
					type="radio"
					name={`${uid}-retention`}
					value={option}
					checked={value === option}
					{disabled}
					aria-labelledby={`${uid}-${option}-label`}
					aria-describedby={`${uid}-${option}`}
					onchange={() => choose(option)}
				/>
				<span class="text">
					<span class="label" id={`${uid}-${option}-label`}>{RETENTION_LABELS[option]}</span>
					<span class="description" id={`${uid}-${option}`}>{DESCRIPTIONS[option]}</span>
				</span>
			</label>
		{/each}
	</div>
</fieldset>

<style>
	.retention {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: 0.25rem;
		font-size: var(--font-size-title);
		font-weight: 600;
	}

	.note {
		font-size: var(--font-size-body);
		color: var(--color-text-muted);
	}

	.choices {
		display: grid;
		gap: 0.5rem;
	}

	.choice {
		display: flex;
		gap: 0.625rem;
		align-items: flex-start;
		cursor: pointer;
	}

	.text {
		display: grid;
		gap: 0.125rem;
	}

	.label {
		font-size: var(--font-size-body);
		font-weight: 500;
	}

	.description {
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}
</style>
