<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Project } from '$lib/domain/project';
	import {
		PROJECT_SEARCH_MAX_LENGTH,
		effectiveProjectLayout,
		filterProjects,
		nextProjectSort,
		parseProjectViewQuery,
		readStoredProjectLayout,
		sortProjects,
		writeStoredProjectLayout,
		type ProjectLayout,
		type ProjectSortKey,
		type ProjectViewQuery
	} from '$lib/domain/project-view';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import type { ProjectStatsStore } from '$lib/stores/project-stats.svelte';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';
	import {
		NEW_PROJECT_LINK_ID,
		newProjectHref,
		projectHref,
		withProjectViewQuery,
		withShowArchived
	} from '$lib/ticket-links';
	import ErrorIcon from './ErrorIcon.svelte';
	import EmptyState from './guidance/EmptyState.svelte';
	import ProjectTable from './ProjectTable.svelte';
	import ProjectTiles from './ProjectTiles.svelte';
	import SectionBar from './SectionBar.svelte';
	import ViewSwitch from './ViewSwitch.svelte';

	// Project view (E3 plan, T-3, T-11, T-12 and package 14; ADR-0010 section 1; ADR-0025 section
	// 10, package UI-8; user request after EH-4): the section bar with the switch "Aufgaben |
	// Projekte | Eingang" at the same place as in the other views, the search by name or code,
	// "Archivierte anzeigen", the pair of layout buttons "Liste | Kacheln" and "Neues Projekt"; below
	// it the projects as a list (default, ProjectTable with sortable columns) or as tiles, in the
	// same frame and width. Search, sort, the switch and the layout live in the URL; the layout is
	// also remembered in localStorage for the next visit. A row or tile opens the project panel
	// (/projekte/<id>) next to the view, "Neues Projekt" the panel /projekte/neu. Closing a panel
	// returns the focus to the link of its project, or to the heading if it is gone; closing "Neues
	// Projekt" without a project returns it to "Neues Projekt". The tags live in the settings
	// (/einstellungen/tags). "aktiv" comes from the list store, "gesamt" adds the done tickets the
	// server counts.
	let {
		catalog,
		tickets,
		stats,
		activeOf,
		totalOf,
		activeId = null,
		creating = false,
		inboxCount = null
	}: {
		catalog: CatalogStore;
		tickets: TicketListStore;
		stats: ProjectStatsStore;
		/** Tickets of a project that are not done; null while not loaded. */
		activeOf: (project: Project) => number | null;
		/** Active plus done tickets; null while not counted. */
		totalOf: (project: Project) => number | null;
		/** Project shown in the panel; its row or tile is marked as current. */
		activeId?: string | null;
		/** The panel "Neues Projekt" is open. */
		creating?: boolean;
		/** New inbox entries for the switch (E4 plan, package 3). */
		inboxCount?: number | null;
	} = $props();

	const uid = $props.id();
	const ids = { heading: `${uid}-heading`, search: `${uid}-search` };

	function storage(): Storage | null {
		try {
			return window.localStorage;
		} catch {
			return null;
		}
	}

	/** Layout remembered on this device; it applies when the URL names none. */
	let stored = $state<ProjectLayout | null>(readStoredProjectLayout(storage()));

	const query = $derived(parseProjectViewQuery(page.url.searchParams));
	const layout = $derived(effectiveProjectLayout(query, stored));
	/** Projects of the switch "Archivierte anzeigen", before the search. */
	const available = $derived(query.showArchived ? catalog.projects : catalog.activeProjects);
	const newOf = (project: Project) => tickets.newInProject(project.id);
	const shown = $derived(
		sortProjects(filterProjects(available, query.search), query.sort, {
			active: activeOf,
			total: totalOf,
			fresh: newOf
		})
	);
	const countLabel = $derived(shown.length === 1 ? '1 Projekt' : `${shown.length} Projekte`);

	let root = $state<HTMLElement>();
	let heading = $state<HTMLElement>();

	// Counts the done tickets of the available projects and of the one in the panel (again when the
	// set changes); a search does not change the set, so clearing it shows the numbers at once.
	$effect(() => {
		const projectIds = available.map((project) => project.id);
		if (activeId !== null && !projectIds.includes(activeId)) projectIds.push(activeId);
		untrack(() => stats.track(projectIds));
	});

	async function navigate(next: ProjectViewQuery, replaceState = false) {
		await goto(withProjectViewQuery(page.url, next), {
			keepFocus: true,
			noScroll: true,
			replaceState
		});
	}

	async function toggleArchived(event: Event & { currentTarget: HTMLInputElement }) {
		await showArchived(event.currentTarget.checked);
	}

	async function showArchived(on: boolean) {
		await goto(withShowArchived(page.url, on), { keepFocus: true, noScroll: true });
	}

	/**
	 * "Archivierte anzeigen" of the empty state (plan EH-12): the button disappears with the state,
	 * so the focus goes to the heading "Projekte", like after "Suche zurücksetzen".
	 */
	async function showAllArchived() {
		await showArchived(true);
		heading?.focus();
	}

	/**
	 * The layout buttons: the choice is remembered and written to the URL. "Liste" is the default,
	 * so it leaves the parameter out; the remembered choice then says the same.
	 */
	async function chooseLayout(next: ProjectLayout) {
		stored = next;
		writeStoredProjectLayout(storage(), next);
		const current = parseProjectViewQuery(page.url.searchParams);
		await navigate({ ...current, layout: next === 'liste' ? null : next });
	}

	/** Column header of the list: natural direction, reversed, by name; back restores it. */
	async function sortBy(key: ProjectSortKey) {
		const current = parseProjectViewQuery(page.url.searchParams);
		await navigate({ ...current, sort: nextProjectSort(current.sort, key) });
	}

	/** Text in the search field while it has the focus; else the field shows the URL. */
	let typed = $state<string | null>(null);
	const searchValue = $derived(typed ?? query.search ?? '');

	/** Typing replaces the history entry, so back does not go through every letter. */
	async function search(text: string) {
		typed = text;
		const current = parseProjectViewQuery(page.url.searchParams);
		await navigate({ ...current, search: text.trim() === '' ? null : text }, true);
	}

	/** Escape empties a field that is not empty; an empty one leaves Escape to the page. */
	function onSearchKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		if (event.key !== 'Escape' || event.currentTarget.value === '') return;
		event.preventDefault();
		event.stopPropagation();
		void search('');
	}

	/** "Suche zurücksetzen" of the empty result; the focus goes to the heading. */
	async function clearSearch() {
		typed = null;
		await navigate({ ...query, search: null });
		heading?.focus();
	}

	function focusLost(): boolean {
		const active = document.activeElement;
		return active === null || active === document.body;
	}

	function linkOf(id: string): HTMLElement | undefined {
		return [...(root?.querySelectorAll<HTMLElement>('a[data-project-id]') ?? [])].find(
			(link) => link.dataset.projectId === id
		);
	}

	/** Project whose panel was shown last. */
	let shownId: string | null = null;

	// Closing the panel (×, Escape, blanket, browser back) returns the focus to the row or tile of
	// its project, or to the heading if it is gone (archived, deleted, outside the search).
	$effect(() => {
		const previous = shownId;
		shownId = activeId;
		if (previous === null || previous === activeId) return;
		void tick().then(() => {
			if (!focusLost()) return;
			(linkOf(previous) ?? heading)?.focus();
		});
	});

	/** Whether the panel "Neues Projekt" was open. */
	let wasCreating = false;

	// Leaving "Neues Projekt" without a project returns the focus to "Neues Projekt".
	$effect(() => {
		const before = wasCreating;
		wasCreating = creating;
		if (!before || creating) return;
		void tick().then(() => {
			if (focusLost()) (document.getElementById(NEW_PROJECT_LINK_ID) ?? heading)?.focus();
		});
	});
</script>

{#snippet newProjectLink(id?: string)}
	<a class="button-primary new" {id} href={newProjectHref(page.url)}>
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
			<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
		</svg>
		Neues Projekt
	</a>
{/snippet}

{#snippet failure(message: string, onretry: () => void)}
	<div class="alert-error failure">
		<ErrorIcon />
		<span class="failure-text">{message}</span>
		<button class="text-button" type="button" onclick={onretry}>Erneut versuchen</button>
	</div>
{/snippet}

<section class="projects-view" aria-labelledby={ids.heading} bind:this={root}>
	<SectionBar
		title="Projekte"
		headingId={ids.heading}
		count={catalog.state === 'ready' ? shown.length : null}
		{countLabel}
		bind:heading
	>
		{#snippet start()}
			<ViewSwitch current="projects" {inboxCount} projectsNewCount={tickets.newInProjects} />
		{/snippet}
		{#snippet end()}
			<div class="search-field">
				<label for={ids.search}>
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<circle cx="7" cy="7" r="4.25" />
						<path d="M10.25 10.25L13.5 13.5" />
					</svg>
					<span class="visually-hidden">Projekte suchen</span>
				</label>
				<input
					id={ids.search}
					type="search"
					autocomplete="off"
					spellcheck="false"
					placeholder="Name oder Code"
					maxlength={PROJECT_SEARCH_MAX_LENGTH}
					value={searchValue}
					oninput={(event) => void search(event.currentTarget.value)}
					onkeydown={onSearchKeydown}
					onblur={() => (typed = null)}
				/>
			</div>
			<label class="switch">
				<input
					type="checkbox"
					role="switch"
					checked={query.showArchived}
					onchange={toggleArchived}
				/>
				Archivierte anzeigen
			</label>
			<div
				class="layout-switch segmented"
				role="group"
				aria-label="Darstellung der Projekte"
				data-tour="project-layout"
			>
				<button
					type="button"
					aria-label="Liste"
					title="Liste"
					aria-pressed={layout === 'liste'}
					onclick={() => void chooseLayout('liste')}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
						<path class="dot" d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
					</svg>
				</button>
				<button
					type="button"
					aria-label="Kacheln"
					title="Kacheln"
					aria-pressed={layout === 'kacheln'}
					onclick={() => void chooseLayout('kacheln')}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
						<rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
						<rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
						<rect x="9" y="9" width="4.5" height="4.5" rx="1" />
					</svg>
				</button>
			</div>
			{@render newProjectLink(NEW_PROJECT_LINK_ID)}
		{/snippet}
	</SectionBar>

	{#if catalog.state === 'error' && catalog.error}
		{@render failure(catalog.error, () => catalog.reload())}
	{:else if catalog.state !== 'ready'}
		<p class="loading" role="status">Projekte werden geladen …</p>
	{:else}
		{#if tickets.openState === 'error' && tickets.openError}
			{@render failure(tickets.openError, () => tickets.reload())}
		{/if}
		{#if stats.error}
			{@render failure(stats.error, () => stats.reload())}
		{/if}

		{#if shown.length > 0}
			{#if layout === 'liste'}
				<ProjectTable
					projects={shown}
					{activeOf}
					{totalOf}
					{newOf}
					{activeId}
					sort={query.sort}
					searching={query.search !== null}
					hrefOf={(project) => projectHref(project.id, page.url)}
					onsort={(key) => void sortBy(key)}
				/>
			{:else}
				<ProjectTiles
					projects={shown}
					{activeOf}
					{totalOf}
					{activeId}
					{newOf}
					hrefOf={(project) => projectHref(project.id, page.url)}
				/>
			{/if}
		{:else if catalog.projects.length === 0}
			<EmptyState
				title="Noch keine Projekte"
				description="Ein Projekt fasst Tickets unter einem Code zusammen, etwa HAUS-12."
				icon="projects"
			>
				{#snippet primary()}
					<a class="button-primary" href={newProjectHref(page.url)}>Projekt anlegen</a>
				{/snippet}
			</EmptyState>
		{:else if query.search !== null && available.length > 0}
			<EmptyState
				title="Keine Projekte gefunden"
				description={`Kein Projekt heißt „${query.search}“ oder hat diesen Code.`}
				size="narrow"
				icon="search"
			>
				{#snippet secondary()}
					<button class="button-secondary" type="button" onclick={() => void clearSearch()}>
						Suche zurücksetzen
					</button>
				{/snippet}
			</EmptyState>
		{:else}
			<EmptyState
				title="Alle Projekte sind archiviert"
				description="Archivierte Projekte bleiben mit ihren Tickets erhalten und lassen sich einblenden."
				size="narrow"
				icon="projects"
			>
				{#snippet secondary()}
					<button class="button-secondary" type="button" onclick={() => void showAllArchived()}>
						Archivierte anzeigen
					</button>
				{/snippet}
			</EmptyState>
		{/if}
	{/if}
</section>

<style>
	.projects-view {
		min-width: 0;
	}

	.switch {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	/* The search field of base.css, like in the filter bar of "Aufgaben"; here only its width. */
	.search-field input[type='search'] {
		width: 12rem;
		max-width: 100%;
	}

	/* Track, thumb and hover come from .segmented in base.css; here only the icons. */
	.layout-switch svg {
		width: 1rem;
		height: 1rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.layout-switch .dot {
		stroke-width: 2.25;
	}

	.new {
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
		text-decoration: none;
	}

	.loading {
		color: var(--color-text-muted);
	}

	/* Only shown if loading takes noticeably long: no flash on a fast local server. */
	.loading {
		animation: reveal 0s 0.4s both;
	}

	@keyframes reveal {
		from {
			visibility: hidden;
		}

		to {
			visibility: visible;
		}
	}

	.failure {
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.failure-text {
		flex: 1;
	}

	.text-button {
		padding: 0.125rem 0.5rem;
		font-size: 0.8125rem;
		background: none;
		border: 1px solid currentColor;
		border-radius: var(--radius-control);
		cursor: pointer;
	}
</style>
