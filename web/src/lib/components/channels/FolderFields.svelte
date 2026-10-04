<script lang="ts">
	import {
		FOLDER_LIMITS,
		type FolderDraft,
		type FolderDraftField,
		type FolderPlatform
	} from '$lib/domain/folders';
	import type { ProjectRef } from '$lib/domain/ticket';
	import ErrorIcon from '../ErrorIcon.svelte';
	import ProjectSelect from '../ProjectSelect.svelte';

	// The fields of one watched folder (ADR-0051 §2): its full path (with an example of the system of
	// the server), subfolders, the types as extensions, the exclusions as patterns (one per line, the
	// defaults preset), "Änderungen melden" and, where the owner passes the projects, its own target
	// project ("Wie die Verbindung" keeps the one of the connection). Used by the first step of the
	// assistant and by the dialog "Ordner hinzufügen …"/"Einstellungen …" of the card; the owner
	// checks the draft (folderDraftErrors) and passes the errors, which stand at their field. A folder
	// that is there already keeps its path (`fixedPath`): another path would be another folder.
	let {
		draft = $bindable(),
		errors = {},
		platform,
		fixedPath = false,
		projects = null
	}: {
		draft: FolderDraft;
		errors?: Partial<Record<FolderDraftField, string>>;
		/** System of the paths of the server, for the example of the path. */
		platform: FolderPlatform;
		fixedPath?: boolean;
		/** Every project of the catalog for the own target project; null leaves the field out. */
		projects?: readonly ProjectRef[] | null;
	} = $props();

	const uid = $props.id();
	const ids = {
		path: `${uid}-path`,
		pathHint: `${uid}-path-hint`,
		pathError: `${uid}-path-error`,
		types: `${uid}-types`,
		typesHint: `${uid}-types-hint`,
		typesError: `${uid}-types-error`,
		exclude: `${uid}-exclude`,
		excludeHint: `${uid}-exclude-hint`,
		excludeError: `${uid}-exclude-error`,
		changesHint: `${uid}-changes-hint`,
		target: `${uid}-target`,
		targetHint: `${uid}-target-hint`,
		targetError: `${uid}-target-error`
	};

	const pathExample = $derived(
		platform === 'windows'
			? 'Der vollständige Pfad, wie ihn der Explorer in der Adressleiste zeigt, etwa C:\\Daten\\Projekte oder eine Freigabe wie \\\\NAS\\Projekte.'
			: 'Der vollständige Pfad auf dem Server, etwa /home/anna/Projekte oder ein eingebundener Ordner wie /mnt/nas/Projekte.'
	);
	const caseText = $derived(
		platform === 'windows' ? ' Groß- und Kleinschreibung zählt nicht.' : ''
	);

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

<div class="folder-fields">
	{#if fixedPath}
		<p class="path">Ordner: <strong>{draft.path}</strong></p>
	{:else}
		<div class="field">
			<label for={ids.path}>Pfad des Ordners (Pflichtfeld)</label>
			<input
				id={ids.path}
				type="text"
				maxlength={FOLDER_LIMITS.pathLength}
				spellcheck="false"
				autocomplete="off"
				aria-required="true"
				aria-invalid={errors.path ? 'true' : undefined}
				aria-describedby={describedBy(ids.pathHint, errors.path !== undefined && ids.pathError)}
				bind:value={draft.path}
			/>
			<p class="hint" id={ids.pathHint}>{pathExample}</p>
			{#if errors.path}
				<p class="field-error" id={ids.pathError}><ErrorIcon /><span>{errors.path}</span></p>
			{/if}
		</div>
	{/if}

	<label class="check">
		<input type="checkbox" bind:checked={draft.subfolders} />
		Unterordner einbeziehen
	</label>

	<div class="field">
		<label for={ids.types}>Dateitypen</label>
		<input
			id={ids.types}
			type="text"
			spellcheck="false"
			autocomplete="off"
			aria-invalid={errors.types ? 'true' : undefined}
			aria-describedby={describedBy(ids.typesHint, errors.types !== undefined && ids.typesError)}
			bind:value={draft.typesText}
		/>
		<p class="hint" id={ids.typesHint}>
			Endungen, durch Komma getrennt, etwa pdf, docx, xlsx. Leer lassen für alle Dateitypen.
		</p>
		{#if errors.types}
			<p class="field-error" id={ids.typesError}><ErrorIcon /><span>{errors.types}</span></p>
		{/if}
	</div>

	<div class="field">
		<label for={ids.exclude}>Ausschlüsse, ein Muster je Zeile</label>
		<textarea
			id={ids.exclude}
			class="input-mono"
			rows="6"
			spellcheck="false"
			autocomplete="off"
			aria-invalid={errors.exclude ? 'true' : undefined}
			aria-describedby={describedBy(
				ids.excludeHint,
				errors.exclude !== undefined && ids.excludeError
			)}
			bind:value={draft.excludeText}></textarea>
		<p class="hint" id={ids.excludeHint}>
			* steht für beliebige Zeichen eines Namens, ** für beliebig viele Ordner; ein Muster gilt in
			jedem Unterordner, mit / am Anfang nur ab diesem Ordner (/Archiv/**).{caseText}
		</p>
		{#if errors.exclude}
			<p class="field-error" id={ids.excludeError}><ErrorIcon /><span>{errors.exclude}</span></p>
		{/if}
	</div>

	<div class="field">
		<label class="check">
			<input
				type="checkbox"
				aria-describedby={ids.changesHint}
				bind:checked={draft.reportChanges}
			/>
			Änderungen melden
		</label>
		<p class="hint" id={ids.changesHint}>
			Ändert sich eine Datei im Ordner, kommt ein Eintrag „Datei geändert“. Aus: Die Statusanzeige
			früherer Einträge der Datei sagt es trotzdem.
		</p>
	</div>

	{#if projects !== null}
		<div class="field">
			<label for={ids.target}>Zielprojekt dieses Ordners</label>
			<ProjectSelect
				id={ids.target}
				value={draft.target ?? ''}
				projects={active}
				{current}
				errorId={ids.targetError}
				hintId={ids.targetHint}
				noneLabel="Wie die Verbindung"
				hint="Neue Einträge aus diesem Ordner bekommen dieses Projekt; „Wie die Verbindung“ nimmt das Zielprojekt der Verbindung."
				onchoose={(value) => (draft.target = value === '' ? null : value)}
			/>
		</div>
	{/if}
</div>

<style>
	.folder-fields {
		display: grid;
		gap: 0.875rem;
		min-width: 0;
	}

	.field {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	label:not(.check) {
		font-size: var(--font-size-control);
		font-weight: 500;
		color: var(--color-text-muted);
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

	.path {
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
