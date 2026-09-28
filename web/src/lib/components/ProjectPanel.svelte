<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import {
		PROJECT_CODE_MAX_LENGTH,
		PROJECT_NAME_MAX_LENGTH,
		RESERVED_CODE,
		suggestProjectCode,
		type Project,
		type ProjectDraft
	} from '$lib/domain/project';
	import {
		PROJECT_PARENT_MESSAGES,
		projectChoiceLabel,
		type ProjectCounts
	} from '$lib/domain/project-tree';
	import { restartNeeded } from '$lib/guidance/texts';
	import type { EditResult } from '$lib/stores/catalog-editor';
	import Breadcrumbs from './Breadcrumbs.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import SectionMessage from './guidance/SectionMessage.svelte';
	import ConfirmDialog from './overlay/ConfirmDialog.svelte';
	import Drawer from './overlay/Drawer.svelte';

	// Project panel (ADR-0025 section 10, decision 4 of the user; plan UI-Konsistenz, package UI-8)
	// on the side panel building block, instead of the project dialog: "Neues Projekt" under
	// /projekte/neu and a project under /projekte/<id>, next to the tiles like a ticket next to the
	// table. Name and code in a form (when creating, the code follows the name as a suggestion until
	// the user types one; it stays fixed while tickets use the project); a project also shows its
	// numbers, "Tickets anzeigen" and "Archivieren" / "Aus dem Archiv holen". "Löschen …" in the
	// header only without tickets, with the confirmation (like TicketDelete); Escape and × ask
	// before unsaved input is lost. Problems of the input and field errors of the server stand at
	// their field. The owner navigates and shows the flags.
	// Sub projects (ADR-0034, UP-4): the field "Oberprojekt" (native select, "Keins" and the active
	// top-level projects; locked for a project with sub projects; the restart hint before the
	// migration), the section "Unterprojekte" of a top-level project with "Unterprojekt anlegen",
	// the breadcrumbs "Projekte › Haus › Garten" of a sub project, the question before archiving a
	// project with active sub projects (they go with it) and "Mit Oberprojekt zurückholen" for a
	// sub project below an archived parent. A project with sub projects cannot be deleted.
	let {
		project = null,
		active = null,
		total = null,
		fresh = 0,
		ticketsHref = null,
		direct = null,
		parent = null,
		parentChoices = [],
		subProjects = [],
		hierarchyReady = true,
		initialParentId = null,
		projectsHref = null,
		projectHrefOf = null,
		newSubProjectHref = null,
		onsave,
		onarchive,
		onrestorewithparent,
		ondelete,
		onsaved,
		ondeleted,
		onclose
	}: {
		/** Project of the panel; null for "Neues Projekt". */
		project?: Project | null;
		/** Tickets of the project that are not done; null while not loaded. */
		active?: number | null;
		/** Tickets of the project, done ones included; null while not counted. */
		total?: number | null;
		/** New tickets of the project for the signed-in user. */
		fresh?: number;
		/** "Tickets anzeigen": the list filtered by the project. */
		ticketsHref?: ResolvedPathname | null;
		/**
		 * The numbers of the project alone when `active`, `total` and `fresh` include its sub
		 * projects (ADR-0034, UP-6): "davon direkt in Haus"; null for a project without them.
		 */
		direct?: ProjectCounts | null;
		/** Parent project of a sub project (from the catalog), null otherwise. */
		parent?: Project | null;
		/** Projects the field "Oberprojekt" offers (active top-level ones, not this one). */
		parentChoices?: readonly Project[];
		/** Sub projects of this project, archived ones included. */
		subProjects?: readonly Project[];
		/** False while the server lacks projects.parent (before the restart, ADR-0034 section 5). */
		hierarchyReady?: boolean;
		/** "Unterprojekt anlegen": the parent chosen in advance for a new project. */
		initialParentId?: string | null;
		/** First step of the breadcrumbs ("Projekte"). */
		projectsHref?: ResolvedPathname | null;
		/** Panel of another project (parent, sub projects). */
		projectHrefOf?: ((project: Project) => ResolvedPathname) | null;
		/** "Unterprojekt anlegen" with this project as parent. */
		newSubProjectHref?: ResolvedPathname | null;
		onsave: (draft: ProjectDraft) => Promise<EditResult<Project>>;
		/** "Archivieren" and "Aus dem Archiv holen" of a project. */
		onarchive?: (archived: boolean) => Promise<EditResult<Project>>;
		/** "Mit Oberprojekt zurückholen": the archived parent first, then this sub project. */
		onrestorewithparent?: () => Promise<EditResult<Project>>;
		/** "Löschen …" of a project without tickets. */
		ondelete?: () => Promise<EditResult<void>>;
		/** After saving: the saved project (a new one gets its own panel). */
		onsaved?: (project: Project) => void;
		/** After deleting: back to the tiles. */
		ondeleted?: () => void;
		/** × and Escape (after the question about unsaved input). */
		onclose: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		heading: `${uid}-title`,
		form: `${uid}-form`,
		name: `${uid}-name`,
		nameError: `${uid}-name-error`,
		code: `${uid}-code`,
		codeHint: `${uid}-code-hint`,
		codeError: `${uid}-code-error`,
		parent: `${uid}-parent`,
		parentHint: `${uid}-parent-hint`,
		parentError: `${uid}-parent-error`,
		subProjects: `${uid}-sub-projects`,
		archive: `${uid}-archive`
	};

	/** Typed name; null until the user types, so the name of the project shows. */
	let typedName = $state<string | null>(null);
	/** Typed code; null until the user types, so the suggestion or the code of the project shows. */
	let typedCode = $state<string | null>(null);
	/** Chosen parent ('' for none); null until the user chooses, so the stored one shows. */
	let chosenParent = $state<string | null>(null);
	let fieldErrors = $state<{ name?: string; code?: string; parent?: string }>({});
	let message = $state<string | null>(null);
	let busy = $state(false);
	let confirmingDelete = $state(false);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	let confirmingDiscard = $state(false);
	let confirmingArchive = $state(false);
	let archiveError = $state<string | null>(null);

	const creating = $derived(project === null);
	const name = $derived(typedName ?? project?.name ?? '');
	const code = $derived(typedCode ?? project?.code ?? suggestProjectCode(name));
	/** The stored parent ('' for none), or the one "Unterprojekt anlegen" chose. */
	const storedParent = $derived(
		project === null ? (initialParentId ?? '') : (project.parentId ?? '')
	);
	const parentValue = $derived(chosenParent ?? storedParent);
	/** A project with sub projects cannot become one (one level, ADR-0034 section 1). */
	const parentLocked = $derived(subProjects.length > 0);
	/** The stored parent if the choices lack it (archived or not loaded), so the select is true. */
	const extraParent = $derived(
		parent !== null && parentValue === parent.id && !parentChoices.some((p) => p.id === parent.id)
			? parent
			: null
	);
	/** Whole label of the chosen parent as title; the select may end it in an ellipsis. */
	const parentLabel = $derived.by(() => {
		if (extraParent !== null) {
			return `${extraParent.name} (${extraParent.code}${extraParent.archived ? ', archiviert' : ''})`;
		}
		const chosen = parentChoices.find((choice) => choice.id === parentValue);
		return chosen ? projectChoiceLabel(chosen) : undefined;
	});
	const activeSubProjects = $derived(subProjects.filter((sub) => !sub.archived));
	/** A sub project below an archived parent comes back only together with it. */
	const restoreNeedsParent = $derived(project?.archived === true && parent?.archived === true);
	/** Tickets of the project itself; `total` of a parent includes its sub projects (UP-6). */
	const ownTotal = $derived(direct === null ? total : direct.total);
	/** The hooks keep the code while tickets use the project (E1 plan, OF-14). */
	const codeFixed = $derived(!creating && ownTotal !== null && ownTotal > 0);
	/**
	 * The hook refuses to delete a project that tickets use (archiving is the way then) or that has
	 * sub projects (ADR-0034 section 3).
	 */
	const canDelete = $derived(
		!creating && total === 0 && subProjects.length === 0 && ondelete !== undefined
	);
	const dirty = $derived(
		(typedName !== null && typedName.trim() !== (project?.name ?? '')) ||
			(typedCode !== null && typedCode !== (project?.code ?? '')) ||
			(chosenParent !== null && chosenParent !== storedParent)
	);

	let heading = $state<HTMLElement>();
	let nameInput = $state<HTMLInputElement>();
	let codeInput = $state<HTMLInputElement>();
	let parentSelect = $state<HTMLSelectElement>();

	// Focus when the panel opens: the name for "Neues Projekt", else the title (ADR-0025 section 6).
	$effect(() => {
		const target = creating ? nameInput : heading;
		if (target) untrack(() => target.focus());
	});

	function number(value: number | null): string {
		return value === null ? '–' : String(value);
	}

	function close() {
		if (busy) return;
		if (dirty) confirmingDiscard = true;
		else onclose();
	}

	async function run<T>(action: () => Promise<EditResult<T>>): Promise<EditResult<T> | null> {
		if (busy) return null;
		busy = true;
		message = null;
		try {
			const result = await action();
			if (!result.ok) {
				fieldErrors = result.fields;
				message = result.message;
			}
			return result;
		} finally {
			busy = false;
		}
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		fieldErrors = {};
		const draft: ProjectDraft = { name, code };
		// The parent goes along only when it is set or changed; before the restart never.
		if (hierarchyReady && parentValue !== storedParent) {
			draft.parentId = parentValue === '' ? null : parentValue;
		} else if (hierarchyReady && creating && parentValue !== '') {
			draft.parentId = parentValue;
		}
		const result = await run(() => onsave(draft));
		if (result === null) return;
		if (result.ok) {
			typedName = null;
			typedCode = null;
			chosenParent = null;
			onsaved?.(result.value);
			return;
		}
		await tick();
		if (fieldErrors.name) nameInput?.focus();
		else if (fieldErrors.code) codeInput?.focus();
		else if (fieldErrors.parent) parentSelect?.focus();
	}

	async function archive(
		change: (archived: boolean) => Promise<EditResult<Project>>,
		archived: boolean
	) {
		fieldErrors = {};
		await run(() => change(archived));
	}

	/** "Archivieren": with active sub projects first the question, which names them. */
	function askArchive(change: (archived: boolean) => Promise<EditResult<Project>>) {
		if (busy) return;
		if (activeSubProjects.length === 0) {
			void archive(change, true);
			return;
		}
		archiveError = null;
		confirmingArchive = true;
	}

	async function confirmArchive() {
		if (onarchive === undefined || busy) return;
		archiveError = null;
		const result = await run(() => onarchive(true));
		if (result === null) return;
		if (result.ok) {
			confirmingArchive = false;
			return;
		}
		// The message stays in the question, not below the form.
		archiveError = result.message ?? Object.values(result.fields)[0] ?? null;
		message = null;
		if (archiveError === null) confirmingArchive = false;
	}

	async function restoreWithParent() {
		if (onrestorewithparent === undefined) return;
		fieldErrors = {};
		await run(onrestorewithparent);
	}

	function askDelete() {
		deleteError = null;
		confirmingDelete = true;
	}

	async function remove() {
		if (deleting || ondelete === undefined) return;
		deleting = true;
		deleteError = null;
		const result = await ondelete();
		deleting = false;
		if (result.ok) {
			confirmingDelete = false;
			ondeleted?.();
		} else if (result.message !== null) {
			deleteError = result.message;
		} else {
			confirmingDelete = false;
		}
	}

	function names(projects: readonly Project[]): string {
		const list = projects.map((entry) => entry.name);
		if (list.length <= 1) return list.join('');
		return `${list.slice(0, -1).join(', ')} und ${list.at(-1)}`;
	}
</script>

<Drawer labelledby={ids.heading} closeFromFields onclose={close}>
	{#snippet context()}
		{#if project && parent}
			<Breadcrumbs
				label="Pfad"
				items={[
					{ label: 'Projekte', href: projectsHref ?? undefined },
					{ label: parent.name, href: projectHrefOf?.(parent) },
					{ label: project.name }
				]}
			/>
		{:else if project}
			<span class="context-code">{project.code}</span> · Projekt
		{:else}
			Projekte
		{/if}
	{/snippet}
	{#snippet actions()}
		{#if canDelete}
			<button class="button-subtle" type="button" aria-haspopup="dialog" onclick={askDelete}>
				Löschen …
			</button>
		{/if}
	{/snippet}
	{#snippet footer()}
		{#if creating}
			<button class="button-secondary" type="button" onclick={close}>Abbrechen</button>
		{/if}
		<button class="button-primary" type="submit" form={ids.form} aria-disabled={busy}>
			{busy ? 'Wird gespeichert …' : creating ? 'Anlegen' : 'Speichern'}
		</button>
	{/snippet}

	<h2 id={ids.heading} tabindex="-1" bind:this={heading}>
		{project ? project.name : 'Neues Projekt'}
	</h2>

	{#if project}
		<div class="summary">
			{#if project.archived}
				<span class="badge">Archiviert</span>
			{/if}
			<p class="stats" title={direct ? 'inkl. Unterprojekte' : undefined}>
				<span><strong>{number(active)}</strong> aktiv</span>
				<span aria-hidden="true">·</span>
				<span><strong>{number(total)}</strong> gesamt</span>
				{#if fresh > 0}
					<span aria-hidden="true">·</span>
					<span class="new"><strong>{fresh}</strong> neu</span>
				{/if}
				{#if direct}
					<span class="visually-hidden">, inkl. Unterprojekte</span>
				{/if}
			</p>
			{#if direct}
				<p class="stats direct">
					davon direkt in {project.name}:
					<span><strong>{number(direct.active)}</strong> aktiv</span>
					<span aria-hidden="true">·</span>
					<span><strong>{number(direct.total)}</strong> gesamt</span>
					{#if direct.fresh > 0}
						<span aria-hidden="true">·</span>
						<span class="new"><strong>{direct.fresh}</strong> neu</span>
					{/if}
				</p>
			{/if}
			{#if ticketsHref}
				<a class="tickets" href={ticketsHref}>Tickets anzeigen</a>
			{/if}
		</div>
	{/if}

	<form id={ids.form} class="form" novalidate onsubmit={save}>
		<div class="field">
			<label for={ids.name}>Name</label>
			<input
				id={ids.name}
				type="text"
				autocomplete="off"
				maxlength={PROJECT_NAME_MAX_LENGTH}
				value={name}
				bind:this={nameInput}
				aria-invalid={fieldErrors.name ? 'true' : undefined}
				aria-describedby={fieldErrors.name ? ids.nameError : undefined}
				oninput={(event) => (typedName = event.currentTarget.value)}
			/>
			{#if fieldErrors.name}
				<p class="field-error" id={ids.nameError}><ErrorIcon /><span>{fieldErrors.name}</span></p>
			{/if}
		</div>

		<div class="field">
			<label for={ids.code}>Code</label>
			<input
				id={ids.code}
				class="code"
				type="text"
				autocomplete="off"
				spellcheck="false"
				maxlength={PROJECT_CODE_MAX_LENGTH}
				value={code}
				readonly={codeFixed}
				bind:this={codeInput}
				aria-invalid={fieldErrors.code ? 'true' : undefined}
				aria-describedby={fieldErrors.code ? `${ids.codeError} ${ids.codeHint}` : ids.codeHint}
				oninput={(event) => {
					const upper = event.currentTarget.value.toUpperCase();
					event.currentTarget.value = upper;
					typedCode = upper;
				}}
			/>
			{#if fieldErrors.code}
				<p class="field-error" id={ids.codeError}><ErrorIcon /><span>{fieldErrors.code}</span></p>
			{/if}
			<p class="hint" id={ids.codeHint}>
				{#if codeFixed}
					Der Code bleibt fest, weil Tickets das Projekt verwenden.
				{:else}
					2 bis 6 Großbuchstaben (A–Z), nicht {RESERVED_CODE}. Tickets des Projekts heißen
					{code === '' ? 'CODE' : code}-1, {code === '' ? 'CODE' : code}-2 …
					{#if creating}Der Vorschlag folgt dem Namen und lässt sich ändern.{/if}
				{/if}
			</p>
		</div>

		{#if hierarchyReady}
			<div class="field">
				<label for={ids.parent}>Oberprojekt</label>
				<select
					id={ids.parent}
					title={parentLabel}
					bind:this={parentSelect}
					disabled={parentLocked}
					aria-invalid={fieldErrors.parent ? 'true' : undefined}
					aria-describedby={fieldErrors.parent
						? `${ids.parentError} ${ids.parentHint}`
						: ids.parentHint}
					onchange={(event) => (chosenParent = event.currentTarget.value)}
				>
					<option value="" selected={parentValue === ''}>Keins</option>
					{#each parentChoices as choice (choice.id)}
						<option value={choice.id} selected={parentValue === choice.id}>
							{projectChoiceLabel(choice)}
						</option>
					{/each}
					{#if extraParent}
						<option value={extraParent.id} selected>{parentLabel}</option>
					{/if}
				</select>
				{#if fieldErrors.parent}
					<p class="field-error" id={ids.parentError}>
						<ErrorIcon /><span>{fieldErrors.parent}</span>
					</p>
				{/if}
				<p class="hint" id={ids.parentHint}>
					{#if parentLocked}
						{PROJECT_PARENT_MESSAGES.validation_project_parent_has_children}
					{:else}
						Ein Unterprojekt hat einen eigenen Code und eigene Tickets. Ein anderes Oberprojekt oder
						„Keins“ ändert keinen Key.
					{/if}
				</p>
			</div>
		{/if}
	</form>

	{#if !hierarchyReady}
		<SectionMessage tone="info" compact>{restartNeeded('Unterprojekte sind')}</SectionMessage>
	{/if}

	<div aria-live="assertive">
		{#if message}
			<div class="alert-error"><ErrorIcon /><span>{message}</span></div>
		{/if}
	</div>

	{#if project !== null && hierarchyReady && !project.parentId}
		<section class="manage" aria-labelledby={ids.subProjects}>
			<h3 id={ids.subProjects}>Unterprojekte</h3>
			{#if subProjects.length > 0}
				<ul class="sub-projects">
					{#each subProjects as sub (sub.id)}
						<li>
							{#if projectHrefOf}
								<a href={projectHrefOf(sub)}>{sub.name}</a>
							{:else}
								{sub.name}
							{/if}
							<span class="context-code">{sub.code}</span>
							{#if sub.archived}<span class="badge">Archiviert</span>{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="hint">Keine Unterprojekte.</p>
			{/if}
			{#if project.archived}
				<p class="hint">Ein archiviertes Projekt bekommt keine neuen Unterprojekte.</p>
			{:else if newSubProjectHref}
				<a class="button-secondary add" href={newSubProjectHref}>Unterprojekt anlegen</a>
			{/if}
		</section>
	{/if}

	{#if project !== null && onarchive}
		{@const current = project}
		{@const change = onarchive}
		<section class="manage" aria-labelledby={ids.archive}>
			<h3 id={ids.archive}>Archiv</h3>
			{#if restoreNeedsParent && parent !== null}
				<button
					class="button-secondary"
					type="button"
					aria-disabled={busy || onrestorewithparent === undefined}
					onclick={() => {
						if (!busy) void restoreWithParent();
					}}
				>
					Mit Oberprojekt zurückholen
				</button>
				<p class="hint">
					Das Oberprojekt „{parent.name}“ ist archiviert. Es kommt mit zurück; seine übrigen
					Unterprojekte bleiben archiviert.
				</p>
			{:else}
				<button
					class="button-secondary"
					type="button"
					aria-disabled={busy}
					aria-haspopup={!current.archived && activeSubProjects.length > 0 ? 'dialog' : undefined}
					onclick={() => {
						if (busy) return;
						if (current.archived) void archive(change, false);
						else askArchive(change);
					}}
				>
					{current.archived ? 'Aus dem Archiv holen' : 'Archivieren'}
				</button>
				{#if current.archived && subProjects.some((sub) => sub.archived)}
					<p class="hint">
						Die Unterprojekte bleiben archiviert; sie lassen sich einzeln zurückholen.
					</p>
				{/if}
			{/if}
			{#if !canDelete}
				<p class="hint">
					{#if subProjects.length > 0}
						{PROJECT_PARENT_MESSAGES.validation_project_has_children}
					{:else if total === null}
						Löschen ist möglich, sobald feststeht, dass kein Ticket das Projekt verwendet.
					{:else}
						Ein Projekt mit Tickets ({total}) lässt sich nicht löschen, nur archivieren.
					{/if}
				</p>
			{/if}
		</section>
	{/if}
</Drawer>

{#if project !== null}
	<ConfirmDialog
		open={confirmingDelete}
		title={`Projekt „${project.name}“ löschen?`}
		confirmLabel="Endgültig löschen"
		busy={deleting}
		error={deleteError}
		onconfirm={remove}
		oncancel={() => {
			confirmingDelete = false;
			deleteError = null;
		}}
	>
		<p>
			„{project.name}“ ({project.code}) hat keine Tickets. Das Projekt wird endgültig gelöscht; das
			lässt sich nicht rückgängig machen.
		</p>
	</ConfirmDialog>

	<ConfirmDialog
		open={confirmingArchive}
		title={`Projekt „${project.name}“ archivieren?`}
		confirmLabel="Archivieren"
		{busy}
		error={archiveError}
		onconfirm={confirmArchive}
		oncancel={() => {
			confirmingArchive = false;
			archiveError = null;
		}}
	>
		<p>
			{activeSubProjects.length === 1
				? 'Archiviert auch 1 Unterprojekt:'
				: `Archiviert auch ${activeSubProjects.length} Unterprojekte:`}
			{names(activeSubProjects)}. Zurückholen geht später für jedes einzeln.
		</p>
	</ConfirmDialog>
{/if}

<ConfirmDialog
	open={confirmingDiscard}
	title={creating ? 'Neues Projekt verwerfen?' : 'Änderungen verwerfen?'}
	confirmLabel="Verwerfen"
	cancelLabel="Weiter bearbeiten"
	onconfirm={() => {
		confirmingDiscard = false;
		onclose();
	}}
	oncancel={() => (confirmingDiscard = false)}
>
	<p>Die Eingaben gehen verloren.</p>
</ConfirmDialog>

<style>
	h2 {
		font-size: var(--font-size-title);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	h3 {
		font-size: var(--font-size-control);
		font-weight: 600;
		color: var(--color-text-muted);
	}

	p {
		font-size: var(--font-size-body);
		line-height: 1.5;
	}

	.context-code {
		font-family: var(--font-mono);
		color: var(--color-brand-text);
	}

	.summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
	}

	.badge {
		padding: 0 0.5rem;
		font-size: var(--font-size-small);
		line-height: 1.25rem;
		color: var(--color-text-muted);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-pill);
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		font-size: var(--font-size-control);
		color: var(--color-text-muted);
	}

	.stats strong {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--color-text);
	}

	.stats .new,
	.stats .new strong {
		color: var(--color-brand-text);
	}

	/* "davon direkt" on its own line below the numbers with the sub projects. */
	.stats.direct {
		flex-basis: 100%;
	}

	.tickets {
		font-size: var(--font-size-body);
		color: var(--color-brand-text);
	}

	.form {
		display: grid;
		gap: 0.875rem;
	}

	.field {
		display: grid;
		gap: 0.25rem;
	}

	label {
		font-size: var(--font-size-control);
		font-weight: 600;
	}

	input,
	select {
		max-width: 100%;
		padding: 0.375rem 0.5rem;
		font-size: var(--font-size-body);
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	input.code {
		width: 8rem;
		font-family: var(--font-mono);
		text-transform: uppercase;
	}

	input[readonly],
	select:disabled {
		color: var(--color-text-muted);
		background: var(--color-bg);
	}

	.hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
	}

	.manage {
		display: grid;
		gap: 0.5rem;
		justify-items: start;
		padding-top: 1rem;
		border-top: 1px solid var(--color-line);
	}

	.sub-projects {
		display: grid;
		gap: 0.25rem;
		font-size: var(--font-size-body);
		list-style: none;
	}

	.sub-projects li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.5rem;
		align-items: baseline;
	}

	.sub-projects a {
		color: var(--color-brand-text);
	}

	.sub-projects .context-code {
		font-size: var(--font-size-control);
	}

	.add {
		text-decoration: none;
	}
</style>
