<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { CHARMS, CHARM_GROUP_LABELS } from '$lib/domain/charms';
	import {
		hasDoneFilters,
		parseDoneQuery,
		resetDoneFilters,
		type DoneQuery
	} from '$lib/domain/done-view';
	import { NO_PROJECT, SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from '$lib/domain/list-query';
	import { projectChoiceLabel, treeOrder } from '$lib/domain/project-tree';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import { withDoneQuery } from '$lib/ticket-links';
	import FilterPopover from '../FilterPopover.svelte';

	// Filters of the view "Erledigte" (ER-1, ADR-0066 §3): the search (title, description or key, from
	// two characters, as in "Aufgaben"), the choices "Projekt" (with "Unterprojekte einbeziehen",
	// ADR-0034), "Tag" and "Charm" (ADR-0062, by group) as popovers of the overlay system like in the
	// filter bar of "Aufgaben", and "Zurücksetzen". The state lives only in the address: every choice
	// navigates with a history entry, typing replaces the entry, so back does not go through every
	// letter; the store applies the search after a pause. Project, tag and search keep their names of
	// "Aufgaben", so the link from there takes them along.
	let {
		catalog,
		searchBusy = false
	}: {
		catalog: CatalogStore;
		/** The list loads for a changed search (aria-busy of the field). */
		searchBusy?: boolean;
	} = $props();

	const uid = $props.id();
	const ids = {
		search: `${uid}-search`,
		searchHint: `${uid}-search-hint`,
		resetHint: `${uid}-reset-hint`,
		subProjectsHint: `${uid}-sub-projects-hint`
	};

	const query = $derived(parseDoneQuery(page.url.searchParams));
	const filtered = $derived(hasDoneFilters(query));
	const unknownProject = $derived(
		query.project !== null && query.project !== NO_PROJECT && !catalog.projectById(query.project)
	);
	const unknownTag = $derived(query.tag !== null && !catalog.tagById(query.tag));
	const unknownLabel = $derived(catalog.state === 'ready' ? 'Unbekannt' : 'Wird geladen …');
	/** "Ohne Projekt", the active projects, then the archived ones, each in tree order (ADR-0034). */
	const projectOptions = $derived([
		{ value: NO_PROJECT, label: 'Ohne Projekt' },
		...treeOrder(catalog.projects.filter((project) => !project.archived)).map((project) => ({
			value: project.id,
			label: projectChoiceLabel(project)
		})),
		...treeOrder(catalog.projects.filter((project) => project.archived)).map((project) => ({
			value: project.id,
			label: projectChoiceLabel(project),
			section: 'Archiviert'
		})),
		...(unknownProject && query.project !== null
			? [{ value: query.project, label: unknownLabel }]
			: [])
	]);
	const subProjects = $derived(
		query.project === null || query.project === NO_PROJECT
			? []
			: catalog.subProjectsOf(query.project)
	);
	const tagOptions = $derived([
		...catalog.tags.map((tag) => ({ value: tag.id, label: tag.name })),
		...(unknownTag && query.tag !== null ? [{ value: query.tag, label: unknownLabel }] : [])
	]);
	/** The catalog of charms by group, in the order of the dialog (ADR-0062). */
	const charmOptions = CHARMS.map((charm) => ({
		value: charm.key,
		label: charm.name,
		section: CHARM_GROUP_LABELS[charm.group]
	}));

	async function navigate(next: DoneQuery) {
		await goto(withDoneQuery(page.url, next), { keepFocus: true, noScroll: true });
	}

	/** Another project takes its sub projects in again (the default of ADR-0034). */
	function setProject(value: string | null) {
		void navigate({ ...query, project: value, subProjects: true });
	}

	/** "Unterprojekte einbeziehen"; locked (aria-disabled) while the project has none. */
	function toggleSubProjects(event: Event & { currentTarget: HTMLInputElement }) {
		if (subProjects.length === 0) {
			event.currentTarget.checked = query.subProjects;
			return;
		}
		void navigate({ ...query, subProjects: event.currentTarget.checked });
	}

	/** Text in the search field while it has the focus; else the field shows the address. */
	let typed = $state<string | null>(null);
	const searchValue = $derived(typed ?? query.search ?? '');

	async function search(text: string) {
		typed = text;
		// The address keeps the trimmed text; an empty or too long one is left out.
		const current = parseDoneQuery(page.url.searchParams);
		await goto(withDoneQuery(page.url, { ...current, search: text }), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	/** Escape empties a field that is not empty; an empty one leaves Escape to the page. */
	function onSearchKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		if (event.key !== 'Escape' || event.currentTarget.value === '') return;
		event.preventDefault();
		event.stopPropagation();
		void search('');
	}

	function reset() {
		if (filtered) void navigate(resetDoneFilters());
	}
</script>

<section class="done-filters" aria-label="Filter">
	<div class="search-field">
		<label for={ids.search}>
			<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<circle cx="7" cy="7" r="4.25" />
				<path d="M10.25 10.25L13.5 13.5" />
			</svg>
			<span class="visually-hidden">Suche</span>
		</label>
		<input
			id={ids.search}
			type="search"
			autocomplete="off"
			spellcheck="false"
			placeholder="Titel, Beschreibung oder Key"
			maxlength={SEARCH_MAX_LENGTH}
			value={searchValue}
			aria-busy={searchBusy}
			aria-describedby={ids.searchHint}
			oninput={(event) => void search(event.currentTarget.value)}
			onkeydown={onSearchKeydown}
			onblur={() => (typed = null)}
		/>
		<span class="visually-hidden" id={ids.searchHint}>
			Die Suche beginnt ab {SEARCH_MIN_LENGTH} Zeichen.
		</span>
	</div>

	<FilterPopover
		legend="Projekt"
		name={`${uid}-project`}
		options={projectOptions}
		value={query.project}
		valueNote={subProjects.length > 0 && !query.subProjects ? 'ohne Unterprojekte' : null}
		onchange={setProject}
	>
		{#snippet footer()}
			<label class="sub-projects">
				<input
					type="checkbox"
					checked={query.subProjects}
					aria-disabled={subProjects.length === 0 ? 'true' : undefined}
					aria-describedby={ids.subProjectsHint}
					onchange={toggleSubProjects}
				/>
				Unterprojekte einbeziehen
			</label>
			<span class="sub-projects-hint" id={ids.subProjectsHint}>
				{#if subProjects.length === 0}
					{query.project === null || query.project === NO_PROJECT
						? 'Gilt, sobald ein Projekt mit Unterprojekten gewählt ist.'
						: 'Das gewählte Projekt hat keine Unterprojekte.'}
				{:else}
					{subProjects.length === 1
						? '1 Unterprojekt: '
						: `${subProjects.length} Unterprojekte: `}{subProjects
						.map((project) => project.name)
						.join(', ')}
				{/if}
			</span>
		{/snippet}
	</FilterPopover>

	<FilterPopover
		legend="Tag"
		name={`${uid}-tag`}
		options={tagOptions}
		value={query.tag}
		onchange={(value) => void navigate({ ...query, tag: value })}
	/>

	<FilterPopover
		legend="Charm"
		name={`${uid}-charm`}
		options={charmOptions}
		value={query.charm}
		onchange={(value) => void navigate({ ...query, charm: value })}
	/>

	<button
		class="button-secondary button-small reset"
		type="button"
		aria-disabled={filtered ? undefined : 'true'}
		aria-describedby={filtered ? undefined : ids.resetHint}
		onclick={reset}
	>
		<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
			<path d="M4 4l8 8M12 4l-8 8" />
		</svg>
		Zurücksetzen
	</button>
	{#if !filtered}
		<span class="visually-hidden" id={ids.resetHint}>Kein Filter gesetzt.</span>
	{/if}
</section>

<style>
	/* The frame of the filter bar of "Aufgaben", so both views look alike. */
	.done-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
		margin-bottom: 1.25rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	/* The search field of base.css (ADR-0029 section 9); here only its width. */
	.search-field input[type='search'] {
		width: 16rem;
		max-width: 100%;
	}

	.sub-projects {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: var(--font-size-body);
		cursor: pointer;
	}

	.sub-projects-hint {
		font-size: var(--font-size-small);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.reset svg {
		width: 0.75rem;
		height: 0.75rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}
</style>
