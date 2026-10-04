<script lang="ts">
	import {
		GITHUB_DOCS_PATH,
		GITHUB_EVENT_LABELS,
		GITHUB_EVENTS,
		type GitHubRepoDraft,
		type RepoDraftField
	} from '$lib/domain/github';
	import type { ProjectRef } from '$lib/domain/ticket';
	import ErrorIcon from '../ErrorIcon.svelte';
	import ProjectSelect from '../ProjectSelect.svelte';

	// The fields of one watched repository of GitHub (ADR-0050 §2): its name or address, the events,
	// the watched paths as patterns (one per line, the Markdown files below docs as a switch, off by
	// default) and, where the owner passes the projects, its own target project ("Wie die
	// Verbindung" keeps the one of the connection). Used by the step "Repositorys" of the assistant
	// and by the dialog "Repository hinzufügen …"/"Einstellungen …" of the card; the owner checks the
	// draft (repoDraftErrors) and passes the errors, which stand at their field. A repository that is
	// there already keeps its name (`fixedName`): a new name would be a new repository.
	let {
		draft = $bindable(),
		errors = {},
		fixedName = false,
		nameOptional = false,
		projects = null
	}: {
		draft: GitHubRepoDraft;
		errors?: Partial<Record<RepoDraftField, string>>;
		fixedName?: boolean;
		/**
		 * The name is one way among others (a list to choose from, "Alle meine Repositorys"): the
		 * field is optional and says so (ADR-0050, addendum of 2026-10-02).
		 */
		nameOptional?: boolean;
		/** Every project of the catalog for the own target project; null leaves the field out. */
		projects?: readonly ProjectRef[] | null;
	} = $props();

	const uid = $props.id();
	const ids = {
		repo: `${uid}-repo`,
		repoHint: `${uid}-repo-hint`,
		repoError: `${uid}-repo-error`,
		events: `${uid}-events`,
		eventsError: `${uid}-events-error`,
		paths: `${uid}-paths`,
		pathsHint: `${uid}-paths-hint`,
		pathsError: `${uid}-paths-error`,
		target: `${uid}-target`,
		targetHint: `${uid}-target-hint`,
		targetError: `${uid}-target-error`
	};

	const active = $derived((projects ?? []).filter((project) => !project.archived));
	/** A target of before that is archived now stays visible as such. */
	const current = $derived(
		draft.target === null
			? null
			: ((projects ?? []).find((project) => project.id === draft.target && project.archived) ??
					null)
	);

	function describedBy(...parts: (string | false)[]): string | undefined {
		const list = parts.filter((part): part is string => part !== false);
		return list.length === 0 ? undefined : list.join(' ');
	}
</script>

<div class="repo-fields">
	{#if fixedName}
		<p class="name">Repository: <strong>{draft.input}</strong></p>
	{:else}
		<div class="field">
			<label for={ids.repo}>
				{nameOptional ? 'Oder ein Repository eintippen' : 'Repository (Pflichtfeld)'}
			</label>
			<input
				id={ids.repo}
				type="text"
				maxlength="300"
				spellcheck="false"
				autocomplete="off"
				aria-required={nameOptional ? undefined : 'true'}
				aria-invalid={errors.repo ? 'true' : undefined}
				aria-describedby={describedBy(ids.repoHint, errors.repo !== undefined && ids.repoError)}
				bind:value={draft.input}
			/>
			<p class="hint" id={ids.repoHint}>
				{nameOptional
					? '„Besitzer/Name“ oder die Adresse auf github.com, auch fremde öffentliche Repositorys.'
					: '„Besitzer/Name“ oder die Adresse auf github.com, etwa octo-org/roadmap.'}
			</p>
			{#if errors.repo}
				<p class="field-error" id={ids.repoError}><ErrorIcon /><span>{errors.repo}</span></p>
			{/if}
		</div>
	{/if}

	<fieldset
		class="group"
		aria-describedby={errors.events !== undefined ? ids.eventsError : undefined}
	>
		<legend id={ids.events}>Ereignisse</legend>
		{#each GITHUB_EVENTS as event (event)}
			<label class="check">
				<input type="checkbox" bind:checked={draft.events[event]} />
				{GITHUB_EVENT_LABELS[event]}
			</label>
		{/each}
		{#if errors.events}
			<p class="field-error" id={ids.eventsError}><ErrorIcon /><span>{errors.events}</span></p>
		{/if}
	</fieldset>

	<div class="field">
		<label for={ids.paths}>Beobachtete Pfade, ein Muster je Zeile</label>
		<textarea
			id={ids.paths}
			class="input-mono"
			rows="5"
			spellcheck="false"
			autocomplete="off"
			aria-invalid={errors.paths ? 'true' : undefined}
			aria-describedby={describedBy(ids.pathsHint, errors.paths !== undefined && ids.pathsError)}
			bind:value={draft.pathsText}></textarea>
		<p class="hint" id={ids.pathsHint}>
			Gilt für Dateiänderungen. Muster beginnen im Hauptordner: * steht für beliebige Zeichen eines
			Namens, ** für beliebig viele Ordner (docs/**/roadmap*). Groß- und Kleinschreibung zählt
			nicht.
		</p>
		<label class="check">
			<input type="checkbox" bind:checked={draft.docs} />
			Alle Markdown-Dateien unter docs ({GITHUB_DOCS_PATH})
		</label>
		{#if errors.paths}
			<p class="field-error" id={ids.pathsError}><ErrorIcon /><span>{errors.paths}</span></p>
		{/if}
	</div>

	{#if projects !== null}
		<div class="field">
			<label for={ids.target}>Zielprojekt dieses Repositorys</label>
			<ProjectSelect
				id={ids.target}
				value={draft.target ?? ''}
				projects={active}
				{current}
				errorId={ids.targetError}
				hintId={ids.targetHint}
				noneLabel="Wie die Verbindung"
				hint="Neue Einträge aus diesem Repository bekommen dieses Projekt; „Wie die Verbindung“ nimmt das Zielprojekt der Verbindung."
				onchoose={(value) => (draft.target = value === '' ? null : value)}
			/>
		</div>
	{/if}
</div>

<style>
	.repo-fields {
		display: grid;
		gap: 0.875rem;
		min-width: 0;
	}

	.field,
	.group {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.group {
		margin: 0;
		padding: 0;
		border: 0;
	}

	label:not(.check),
	legend {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
	}

	legend {
		padding: 0;
		margin-bottom: 0.25rem;
	}

	.check {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: var(--font-size-body);
	}

	input[type='text'],
	textarea {
		width: 100%;
	}

	.name {
		font-size: var(--font-size-body);
		overflow-wrap: anywhere;
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.field :global(select) {
		width: 100%;
	}
</style>
