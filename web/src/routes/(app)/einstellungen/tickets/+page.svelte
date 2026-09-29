<script lang="ts">
	import SectionMessage from '$lib/components/guidance/SectionMessage.svelte';
	import {
		RETENTION_LABELS,
		TRASH_RETENTIONS,
		retentionText,
		type TrashRetention
	} from '$lib/domain/trash';
	import { restartNeeded } from '$lib/guidance/texts';
	import { getTrashStore } from '$lib/stores/trash.svelte';
	import { trashHref } from '$lib/ticket-links';

	// Settings "Tickets" (ADR-0037 §8): how long deleted tickets stay in the trash before they are
	// deleted for good, 7, 30 (default) or 90 days or never. Stored with the account on the server
	// (users.trash_retention), because the daily run needs it without an open tab; a choice applies
	// at once, the flag confirms it. Before the migration of the trash the page says when it comes.
	const store = getTrashStore();
	const uid = $props.id();

	const DESCRIPTIONS: Record<TrashRetention, string> = {
		'7': 'Für wenig Platzbedarf; nach einer Woche ist ein Ticket endgültig weg.',
		'30': 'Standard: ein Monat Zeit zum Wiederherstellen.',
		'90': 'Für lange Pausen; der Papierkorb wird größer.',
		never: 'Nichts wird automatisch gelöscht; leere den Papierkorb dann selbst.'
	};

	function choose(value: TrashRetention) {
		if (value !== store.retention) void store.setRetention(value);
	}
</script>

<svelte:head>
	<title>Tickets · Einstellungen · becauseyoulovejira</title>
</svelte:head>

{#if store.state === 'unavailable'}
	<SectionMessage tone="info">{restartNeeded('Der Papierkorb ist')}</SectionMessage>
{:else}
	<fieldset
		class="retention"
		aria-describedby={`${uid}-note`}
		aria-busy={store.state === 'loading' ? 'true' : undefined}
	>
		<legend>Papierkorb</legend>
		<p class="note" id={`${uid}-note`}>
			Gelöschte Tickets liegen im <a href={trashHref()}>Papierkorb</a> und lassen sich dort
			wiederherstellen.
			{retentionText(store.retention)} Die Frist zählt ab dem Tag des Löschens und gilt für dein Konto.
		</p>
		<div class="choices">
			{#each TRASH_RETENTIONS as value (value)}
				<label class="choice">
					<input
						type="radio"
						name={`${uid}-retention`}
						{value}
						checked={store.retention === value}
						disabled={store.state !== 'ready'}
						aria-labelledby={`${uid}-${value}-label`}
						aria-describedby={`${uid}-${value}`}
						onchange={() => choose(value)}
					/>
					<span class="text">
						<span class="label" id={`${uid}-${value}-label`}>{RETENTION_LABELS[value]}</span>
						<span class="description" id={`${uid}-${value}`}>{DESCRIPTIONS[value]}</span>
					</span>
				</label>
			{/each}
		</div>
	</fieldset>
{/if}

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
