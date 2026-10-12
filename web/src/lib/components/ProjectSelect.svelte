<script lang="ts" module>
	/** The hint of the project of a ticket: a change gives it a new key. */
	export const PROJECT_KEY_HINT = 'Beim Wechsel bekommt das Ticket einen neuen Key.';
</script>

<script lang="ts">
	import { projectChoiceLabel, projectPath } from '$lib/domain/project-tree';
	import type { ProjectRef } from '$lib/domain/ticket';
	import type { FieldControl } from './form/Field.svelte';

	// Project of a ticket (E3 plan, T-13): "Kein Projekt" and the active projects as
	// "Name (CODE)". A project that is archived but already assigned stays visible as
	// "Name (CODE, archiviert)", so the select shows the true value; archived projects cannot be
	// chosen otherwise (T-11). The hint says that a change gives the ticket a new key; a caller with
	// other words passes them as `hint` instead of a hint of its own, so the page holds one element
	// with `hintId` and `aria-describedby` points at exactly that one.
	// Sub projects (ADR-0034, UP-5): the options come in tree order (the catalog delivers them so),
	// a sub project as "Haus › Garten (GART)", which every reader understands without indentation.
	// The select never grows beyond its container (base.css): a long label ends in an ellipsis, and
	// the title shows the whole label of the chosen project (docs/plan/layout-ueberlauf.md).
	// In a form the select stands in a Field (ADR-0060, RG-1): `field` gives its ID, description and
	// invalid state, and the field shows label, error and its hint (PROJECT_KEY_HINT or its own).
	let {
		id,
		field,
		value,
		projects,
		current = null,
		busy = false,
		disabled = false,
		error = null,
		errorId,
		hintId,
		hint = PROJECT_KEY_HINT,
		noneLabel = 'Kein Projekt',
		onchoose
	}: {
		/** Chosen project ID, '' for none. */
		value: string;
		/** Projects that can be chosen (the active ones, in tree order). */
		projects: readonly ProjectRef[];
		/** Project the ticket has now; shown even if it is archived or not among `projects`. */
		current?: ProjectRef | null;
		/** A save is running; the select stays usable, so the keyboard focus stays on it. */
		busy?: boolean;
		disabled?: boolean;
		/** Text of the empty choice, e.g. "Wie die Verbindung" for a repository of GitHub. */
		noneLabel?: string;
		onchoose: (value: string) => void;
	} & (
		| {
				/** In a Field: ID, description and invalid state come from the field, so does the hint. */
				field: FieldControl;
				id?: undefined;
				error?: undefined;
				errorId?: undefined;
				hintId?: undefined;
				hint?: undefined;
		  }
		| {
				field?: undefined;
				id: string;
				error?: string | null;
				errorId: string;
				hintId: string;
				/** Text of the hint below the select, rendered here with `hintId`. */
				hint?: string;
		  }
	) = $props();

	/** The current project if the list of choosable projects lacks it. */
	const extra = $derived(
		current !== null && !projects.some((project) => project.id === current.id) ? current : null
	);

	/** ID, description and invalid state: of the field, or from the own props with the own hint. */
	const attributes: FieldControl = $derived(
		field ?? {
			id: id ?? '',
			'aria-describedby': error ? `${hintId} ${errorId}` : hintId,
			'aria-invalid': error ? 'true' : undefined
		}
	);

	function extraLabel(project: ProjectRef): string {
		return `${projectPath(project)} (${project.code}${project.archived ? ', archiviert' : ''})`;
	}

	/** Whole label of the chosen project, as title of the select; none for "Kein Projekt". */
	const chosenLabel = $derived.by(() => {
		if (extra !== null && extra.id === value) return extraLabel(extra);
		const chosen = projects.find((project) => project.id === value);
		return chosen ? projectChoiceLabel(chosen) : undefined;
	});
</script>

<select
	{...attributes}
	title={chosenLabel}
	aria-busy={busy ? 'true' : undefined}
	{disabled}
	onchange={(event) => onchoose(event.currentTarget.value)}
>
	<option value="" selected={value === ''}>{noneLabel}</option>
	{#each projects as project (project.id)}
		<option value={project.id} selected={value === project.id}>
			{projectChoiceLabel(project)}
		</option>
	{/each}
	{#if extra}
		<option value={extra.id} selected={value === extra.id}>
			{extraLabel(extra)}
		</option>
	{/if}
</select>
{#if field === undefined}
	<p class="hint" id={hintId}>{hint}</p>
{/if}

<style>
	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}
</style>
