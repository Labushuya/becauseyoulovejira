<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { PRIORITY_LABELS, STATUS_LABELS } from '$lib/domain/labels';
	import { projectChoiceLabel, treeOrder } from '$lib/domain/project-tree';
	import {
		DUE_FILTERS,
		NO_PROJECT,
		SEARCH_MAX_LENGTH,
		SEARCH_MIN_LENGTH,
		hasFilters,
		parseListQuery,
		resetFilters,
		withFilter,
		type DueFilter,
		type FilterKey,
		type ListQuery
	} from '$lib/domain/list-query';
	import { SOURCE_FAMILY_CHIPS, SOURCE_FAMILY_LABELS, type SourceFamily } from '$lib/domain/source';
	import { PRIORITIES, STATUSES, type Priority, type Status } from '$lib/domain/status';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import { withListQuery } from '$lib/ticket-links';
	import ChipGroup from './ChipGroup.svelte';
	import ErrorIcon from './ErrorIcon.svelte';
	import FilterPopover from './FilterPopover.svelte';

	// Filter bar (E3 plan, T-6, T-15 and packages 10 and 11; ADR-0010 section 1): chip groups for
	// status, priority, due date and source (E4 package 9, ADR-0019 section 2), the search, the
	// choices "Projekt" and "Tag" as popovers of the overlay system (ADR-0025 section 5, package
	// UI-9, instead of native selects), and "Zurücksetzen".
	// The state lives only in the URL (ADR-0013 section 4): every change navigates with a history
	// entry, so reload, back and forward keep it; opening a ticket keeps it because links carry
	// the query. Typing in the search replaces the entry instead, so back does not go through
	// every letter; the list store applies the search after a pause.
	// Sub projects (ADR-0034, UP-5): the projects stand in tree order as "Haus › Garten (GART)"; a
	// project takes its sub projects in, and the checkbox "Unterprojekte einbeziehen" below the
	// choices switches that off (`unterprojekte=0`). It is locked without sub projects.
	let {
		catalog,
		searchBusy = false,
		searchError = null,
		onretrysearch = () => undefined
	}: {
		catalog: CatalogStore;
		/** A changed search waits for its pause or its answer. */
		searchBusy?: boolean;
		/** Failure of the search; the table then shows the tickets without search. */
		searchError?: string | null;
		onretrysearch?: () => void;
	} = $props();

	const uid = $props.id();
	const ids = {
		search: `${uid}-search`,
		searchHint: `${uid}-search-hint`,
		searchError: `${uid}-search-error`,
		resetHint: `${uid}-reset-hint`,
		subProjectsHint: `${uid}-sub-projects-hint`
	};

	const DUE_LABELS: Readonly<Record<DueFilter, string>> = {
		overdue: 'Überfällig',
		today: 'Heute',
		soon: 'Bald',
		none: 'Ohne Datum'
	};

	const statusOptions = STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }));
	// Urgent first, like the priority order of the table.
	const priorityOptions = [...PRIORITIES]
		.reverse()
		.map((value) => ({ value, label: PRIORITY_LABELS[value] }));
	const dueOptions = DUE_FILTERS.map((value) => ({ value, label: DUE_LABELS[value] }));
	const sourceOptions = SOURCE_FAMILY_CHIPS.map((value) => ({
		value,
		label: SOURCE_FAMILY_LABELS[value]
	}));

	const query = $derived(parseListQuery(page.url.searchParams));
	const filtered = $derived(hasFilters(query));
	/** A project or tag in the URL the catalog does not know (foreign, deleted or mistyped). */
	const unknownProject = $derived(
		query.project !== null && query.project !== NO_PROJECT && !catalog.projectById(query.project)
	);
	const unknownTag = $derived(query.tag !== null && !catalog.tagById(query.tag));
	const unknownLabel = $derived(catalog.state === 'ready' ? 'Unbekannt' : 'Wird geladen …');
	/**
	 * "Ohne Projekt", the active projects, then the archived ones under "Archiviert"; each part in
	 * tree order, sub projects with their path (ADR-0034).
	 */
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
	/** Sub projects of the chosen project; the checkbox is locked without them. */
	const subProjects = $derived(
		query.project === null || query.project === NO_PROJECT
			? []
			: catalog.subProjectsOf(query.project)
	);
	const tagOptions = $derived([
		...catalog.tags.map((tag) => ({ value: tag.id, label: tag.name })),
		...(unknownTag && query.tag !== null ? [{ value: query.tag, label: unknownLabel }] : [])
	]);

	async function navigate(next: ListQuery) {
		await goto(withListQuery(page.url, next), { keepFocus: true, noScroll: true });
	}

	function setFilter<K extends FilterKey>(key: K, value: ListQuery[K]) {
		void navigate(withFilter(query, key, value));
	}

	/** Another project takes its sub projects in again (the default of ADR-0034). */
	function setProject(value: string | null) {
		void navigate({ ...withFilter(query, 'project', value), subProjects: true });
	}

	/** "Unterprojekte einbeziehen"; locked (aria-disabled) while the project has none. */
	function toggleSubProjects(event: Event & { currentTarget: HTMLInputElement }) {
		if (subProjects.length === 0) {
			event.currentTarget.checked = query.subProjects;
			return;
		}
		void navigate({ ...query, subProjects: event.currentTarget.checked });
	}

	/** Text in the search field while it has the focus; else the field shows the URL. */
	let typed = $state<string | null>(null);
	const searchValue = $derived(typed ?? query.search ?? '');

	async function search(text: string) {
		typed = text;
		const current = parseListQuery(page.url.searchParams);
		await goto(withListQuery(page.url, withFilter(current, 'search', text)), {
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
		if (filtered) void navigate(resetFilters(query));
	}
</script>

<section class="filter-bar" aria-label="Filter" data-tour="filter-bar">
	<ChipGroup
		legend="Status"
		name={`${uid}-status`}
		options={statusOptions}
		value={query.status}
		onchange={(value: Status | null) => setFilter('status', value)}
	/>
	<ChipGroup
		legend="Priorität"
		name={`${uid}-priority`}
		options={priorityOptions}
		value={query.priority}
		onchange={(value: Priority | null) => setFilter('priority', value)}
	/>
	<ChipGroup
		legend="Fällig"
		name={`${uid}-due`}
		options={dueOptions}
		value={query.due}
		onchange={(value: DueFilter | null) => setFilter('due', value)}
	/>
	<ChipGroup
		legend="Quelle"
		name={`${uid}-source`}
		options={sourceOptions}
		value={query.source}
		onchange={(value: SourceFamily | null) => setFilter('source', value)}
	/>

	<div class="selects">
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
				aria-describedby={searchError === null
					? ids.searchHint
					: `${ids.searchError} ${ids.searchHint}`}
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
			onchange={(value) => setFilter('tag', value)}
		/>

		<button
			class="reset"
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
	</div>

	{#if searchError !== null}
		<div class="alert-error search-error" id={ids.searchError} role="alert">
			<ErrorIcon />
			<span class="search-error-text">
				Die Suche ist fehlgeschlagen. {searchError} Die Tabelle zeigt die Tickets ohne Suche.
			</span>
			<button class="retry" type="button" onclick={onretrysearch}>Erneut versuchen</button>
		</div>
	{/if}
</section>

<style>
	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.625rem 1.25rem;
		align-items: center;
		margin-bottom: 1.25rem;
		padding: 0.625rem 0.75rem;
		background: var(--color-surface);
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
	}

	.selects {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: center;
	}

	/* The search field of base.css (ADR-0029 section 9); here only its width and the busy pointer. */
	.search-field input[type='search'] {
		width: 16rem;
		max-width: 100%;
	}

	.search-field input[aria-busy='true'] {
		cursor: progress;
	}

	.search-error {
		flex-basis: 100%;
		align-items: center;
	}

	.search-error-text {
		flex: 1;
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

	.retry {
		padding: 0.125rem 0.5rem;
		font-size: var(--font-size-control);
		background: none;
		border: 1px solid currentColor;
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.reset {
		display: inline-flex;
		gap: 0.25rem;
		align-items: center;
		padding: 0.1875rem 0.625rem;
		font-size: var(--font-size-control);
		color: var(--color-text);
		background: none;
		border: 1px solid var(--color-line);
		border-radius: var(--radius-control);
		cursor: pointer;
	}

	.reset[aria-disabled='true'] {
		color: var(--color-text-muted);
		cursor: not-allowed;
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
