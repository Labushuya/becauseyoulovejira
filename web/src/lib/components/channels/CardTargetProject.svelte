<script lang="ts">
	import { cardTargetHint, TARGET_LABEL, targetState } from '$lib/domain/target-project';
	import type { ProjectRef } from '$lib/domain/ticket';
	import { restartNeeded } from '$lib/guidance/texts';
	import ErrorIcon from '../ErrorIcon.svelte';
	import ProjectSelect from '../ProjectSelect.svelte';

	// The setting "Zielprojekt" in the details of a card (ADR-0049, package 1): new entries of this
	// way into the inbox get the project, and converting them chooses it in advance. A choice saves
	// at once like the fields of a ticket (ADR-0026, addendum KK-2: actions of an entry of the
	// details stand at that entry); the menu "•••" of the card opens the details and puts the focus
	// here (`ChannelCard.showDetails`). Only active projects can be chosen; an archived target stays
	// visible as such, a deleted one is named. A failure stays at the field (ADR-0009), success is a
	// flag of the store. Before the migration the row names the restart instead.
	let {
		id,
		name,
		entries,
		value,
		projects,
		ready = true,
		onsave
	}: {
		/** ID of the select; the menu of the card focuses it. */
		id: string;
		/** Name of the card, for the name of the select. */
		name: string;
		/** Who gets the project, e.g. "Neue Einträge dieser Verbindung". */
		entries: string;
		/** Stored target project, null without one. */
		value: string | null;
		/** Every project of the catalog, archived ones included. */
		projects: readonly ProjectRef[];
		/** The server knows the setting (its migration has run). */
		ready?: boolean;
		/** Saves the choice; resolves to the error text for the field, or null once it is saved. */
		onsave: (project: ProjectRef | null) => Promise<string | null>;
	} = $props();

	const errorId = $derived(`${id}-error`);
	const hintId = $derived(`${id}-hint`);

	let saving = $state(false);
	let error = $state<string | null>(null);
	/** The choice that waits while a save runs; the last one wins. */
	let waiting: string | null = null;

	const active = $derived(projects.filter((project) => !project.archived));
	const target = $derived(targetState(value, projects));
	const current = $derived(target.kind === 'archived' ? target.project : null);
	const hint = $derived(cardTargetHint(target, entries));

	async function choose(next: string) {
		error = null;
		if (saving) {
			waiting = next;
			return;
		}
		saving = true;
		try {
			let wanted: string | null = next;
			while (wanted !== null) {
				const choice: string = wanted;
				waiting = null;
				const project =
					choice === '' ? null : (projects.find((entry) => entry.id === choice) ?? null);
				error = await onsave(project);
				wanted = error === null ? waiting : null;
			}
		} finally {
			saving = false;
			waiting = null;
		}
	}
</script>

<dl class="target">
	<div>
		<dt>
			{#if ready}
				<label for={id}>{TARGET_LABEL} <span class="visually-hidden">von „{name}“</span></label>
			{:else}
				{TARGET_LABEL}
			{/if}
		</dt>
		<dd>
			{#if ready}
				<ProjectSelect
					{id}
					value={value ?? ''}
					projects={active}
					{current}
					busy={saving}
					{error}
					{errorId}
					{hintId}
					{hint}
					onchoose={(next) => void choose(next)}
				/>
				{#if error !== null}
					<p class="field-error" id={errorId}><ErrorIcon /><span>{error}</span></p>
				{/if}
			{:else}
				{restartNeeded(`Das ${TARGET_LABEL} ist`)}
			{/if}
		</dd>
	</div>
</dl>

<style>
	.target dd {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.target :global(select) {
		width: 100%;
		padding: 0.25rem 0.375rem;
		background: var(--color-surface);
		border: 1px solid var(--color-text-muted);
		border-radius: var(--radius-control);
	}
</style>
