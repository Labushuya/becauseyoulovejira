<script lang="ts">
	import { projectChoiceLabel, projectPath } from '$lib/domain/project-tree';
	import type { ProjectRef } from '$lib/domain/ticket';

	// Project of a ticket (E3 plan, T-13): "Kein Projekt" and the active projects as
	// "Name (CODE)". A project that is archived but already assigned stays visible as
	// "Name (CODE, archiviert)", so the select shows the true value; archived projects cannot be
	// chosen otherwise (T-11). The hint says that a change gives the ticket a new key.
	// Sub projects (ADR-0034, UP-5): the options come in tree order (the catalog delivers them so),
	// a sub project as "Haus › Garten (GART)", which every reader understands without indentation.
	let {
		id,
		value,
		projects,
		current = null,
		busy = false,
		disabled = false,
		error = null,
		errorId,
		hintId,
		onchoose
	}: {
		id: string;
		/** Chosen project ID, '' for none. */
		value: string;
		/** Projects that can be chosen (the active ones, in tree order). */
		projects: readonly ProjectRef[];
		/** Project the ticket has now; shown even if it is archived or not among `projects`. */
		current?: ProjectRef | null;
		/** A save is running; the select stays usable, so the keyboard focus stays on it. */
		busy?: boolean;
		disabled?: boolean;
		error?: string | null;
		errorId: string;
		hintId: string;
		onchoose: (value: string) => void;
	} = $props();

	/** The current project if the list of choosable projects lacks it. */
	const extra = $derived(
		current !== null && !projects.some((project) => project.id === current.id) ? current : null
	);
	const describedBy = $derived(error ? `${hintId} ${errorId}` : hintId);
</script>

<select
	{id}
	aria-busy={busy ? 'true' : undefined}
	aria-invalid={error ? 'true' : undefined}
	aria-describedby={describedBy}
	{disabled}
	onchange={(event) => onchoose(event.currentTarget.value)}
>
	<option value="" selected={value === ''}>Kein Projekt</option>
	{#each projects as project (project.id)}
		<option value={project.id} selected={value === project.id}>
			{projectChoiceLabel(project)}
		</option>
	{/each}
	{#if extra}
		<option value={extra.id} selected={value === extra.id}>
			{projectPath(extra)} ({extra.code}{extra.archived ? ', archiviert' : ''})
		</option>
	{/if}
</select>
<p class="hint" id={hintId}>Beim Wechsel bekommt das Ticket einen neuen Key.</p>

<style>
	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
