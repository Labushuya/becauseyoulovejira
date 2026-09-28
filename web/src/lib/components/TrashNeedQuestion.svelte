<script lang="ts">
	import { needText, type RestoreNeed, type RestoreOptions } from '$lib/domain/trash';
	import type { ProjectRef } from '$lib/domain/ticket';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import ProjectSelect from './ProjectSelect.svelte';

	// What a restore needs before it can run (ADR-0037 §5 and §7), inline in the row of the trash
	// and in its preview, never in a dialog: the project is gone or has another code, so a target is
	// chosen (the ticket gets a new key there); or the series has an open ticket, so it comes back
	// as a normal ticket, never doubled. A warning without red (ADR-0009); "Abbrechen" drops it.
	let {
		key,
		need,
		projects,
		busy = false,
		onrestore,
		oncancel
	}: {
		/** Key of the ticket, for the names of the controls. */
		key: string;
		need: RestoreNeed;
		/** Active projects of the scope, in tree order. */
		projects: readonly ProjectRef[];
		busy?: boolean;
		onrestore: (options: RestoreOptions) => void;
		oncancel: () => void;
	} = $props();

	const uid = $props.id();
	let target = $state('');
</script>

<SectionMessage tone="warning" compact>
	<p>{needText(need)}</p>
	{#if need.kind === 'project'}
		<div class="field">
			<label for={`${uid}-project`}>Zielprojekt für {key}</label>
			<ProjectSelect
				id={`${uid}-project`}
				value={target}
				{projects}
				{busy}
				errorId={`${uid}-project-error`}
				hintId={`${uid}-project-hint`}
				hint="Der alte Key bleibt im Verlauf."
				onchoose={(value) => (target = value)}
			/>
		</div>
	{/if}
	{#snippet actions()}
		{#if need.kind === 'project'}
			<button
				class="button-primary"
				type="button"
				aria-disabled={busy ? 'true' : undefined}
				onclick={() => {
					if (!busy) onrestore({ project: target });
				}}
			>
				Wiederherstellen
			</button>
		{:else}
			<button
				class="button-primary"
				type="button"
				aria-disabled={busy ? 'true' : undefined}
				onclick={() => {
					if (!busy) onrestore({ detachSeries: true });
				}}
			>
				Als normales Ticket wiederherstellen (aus Serie lösen)
			</button>
		{/if}
		<button class="button-secondary" type="button" onclick={oncancel}>Abbrechen</button>
	{/snippet}
</SectionMessage>

<style>
	.field {
		display: grid;
		gap: 0.25rem;
		margin-top: 0.5rem;
	}

	.field label {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}
</style>
