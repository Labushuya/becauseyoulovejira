<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Project } from '$lib/domain/project';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import type { CatalogEditor } from '$lib/stores/catalog-editor';
	import type { FlagSink } from '$lib/stores/flags.svelte';
	import type { ProjectStatsStore } from '$lib/stores/project-stats.svelte';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';
	import {
		NEW_PROJECT_LINK_ID,
		newProjectHref,
		projectHref,
		showArchivedFrom,
		withShowArchived
	} from '$lib/ticket-links';
	import ErrorIcon from './ErrorIcon.svelte';
	import ProjectTiles from './ProjectTiles.svelte';
	import SectionBar from './SectionBar.svelte';
	import TagManager from './TagManager.svelte';
	import ViewSwitch from './ViewSwitch.svelte';

	// Project view (E3 plan, T-3, T-11, T-12, T-14 and package 14; ADR-0010 section 1; ADR-0025
	// section 10, package UI-8): the section bar with the switch "Aufgaben | Projekte | Eingang" at
	// the same place as in the other views, "Archivierte anzeigen" (?archiviert=1) and "Neues
	// Projekt", the project tiles and below them the section "Tags". A tile opens the project panel
	// (/projekte/<id>) next to the view, "Neues Projekt" the panel /projekte/neu. Closing a panel
	// returns the focus to the tile of its project, or to the heading if the tile is gone, like a
	// row of the tables; closing "Neues Projekt" without a project returns it to "Neues Projekt".
	// "aktiv" comes from the list store, "gesamt" adds the done tickets the server counts.
	let {
		catalog,
		tickets,
		stats,
		editor,
		flags,
		activeOf,
		totalOf,
		activeId = null,
		creating = false,
		inboxCount = null
	}: {
		catalog: CatalogStore;
		tickets: TicketListStore;
		stats: ProjectStatsStore;
		editor: CatalogEditor;
		flags: FlagSink;
		/** Tickets of a project that are not done; null while not loaded. */
		activeOf: (project: Project) => number | null;
		/** Active plus done tickets; null while not counted. */
		totalOf: (project: Project) => number | null;
		/** Project shown in the panel; its tile is marked as current. */
		activeId?: string | null;
		/** The panel "Neues Projekt" is open. */
		creating?: boolean;
		/** New inbox entries for the switch (E4 plan, package 3). */
		inboxCount?: number | null;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;

	const showArchived = $derived(showArchivedFrom(page.url));
	const shown = $derived(showArchived ? catalog.projects : catalog.activeProjects);
	const countLabel = $derived(shown.length === 1 ? '1 Projekt' : `${shown.length} Projekte`);

	let root = $state<HTMLElement>();
	let heading = $state<HTMLElement>();

	// Counts the done tickets of the shown projects and of the one in the panel (again when the
	// set changes).
	$effect(() => {
		const ids = shown.map((project) => project.id);
		if (activeId !== null && !ids.includes(activeId)) ids.push(activeId);
		untrack(() => stats.track(ids));
	});

	async function toggleArchived(event: Event & { currentTarget: HTMLInputElement }) {
		await goto(withShowArchived(page.url, event.currentTarget.checked), {
			keepFocus: true,
			noScroll: true
		});
	}

	function focusLost(): boolean {
		const active = document.activeElement;
		return active === null || active === document.body;
	}

	function tileOf(id: string): HTMLElement | undefined {
		return [...(root?.querySelectorAll<HTMLElement>('a[data-project-id]') ?? [])].find(
			(link) => link.dataset.projectId === id
		);
	}

	/** Project whose panel was shown last. */
	let shownId: string | null = null;

	// Closing the panel (×, Escape, blanket, browser back) returns the focus to the tile of its
	// project, or to the heading if the tile is gone (archived, deleted).
	$effect(() => {
		const previous = shownId;
		shownId = activeId;
		if (previous === null || previous === activeId) return;
		void tick().then(() => {
			if (!focusLost()) return;
			(tileOf(previous) ?? heading)?.focus();
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

<section class="projects-view" aria-labelledby={headingId} bind:this={root}>
	<SectionBar
		title="Projekte"
		{headingId}
		count={catalog.state === 'ready' ? shown.length : null}
		{countLabel}
		bind:heading
	>
		{#snippet start()}
			<ViewSwitch current="projects" {inboxCount} projectsNewCount={tickets.newInProjects} />
		{/snippet}
		{#snippet end()}
			<label class="switch">
				<input type="checkbox" checked={showArchived} onchange={toggleArchived} />
				Archivierte anzeigen
			</label>
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
			<ProjectTiles
				projects={shown}
				{activeOf}
				{totalOf}
				{activeId}
				newOf={(project) => tickets.newInProject(project.id)}
				hrefOf={(project) => projectHref(project.id, page.url)}
			/>
		{:else if catalog.projects.length === 0}
			<div class="empty">
				<p>Noch keine Projekte.</p>
				{@render newProjectLink()}
			</div>
		{:else}
			<p class="empty">Alle Projekte sind archiviert. „Archivierte anzeigen“ zeigt sie.</p>
		{/if}

		<div class="tags">
			<TagManager
				tags={catalog.tags}
				{editor}
				onannounce={(title) => flags.show({ tone: 'success', title })}
			/>
		</div>
	{/if}
</section>

<style>
	/* Spacing as in the other views: the section bar keeps its own margin (no override). */
	.tags {
		margin-top: 1.5rem;
	}

	.switch {
		display: inline-flex;
		gap: 0.375rem;
		align-items: center;
		font-size: 0.875rem;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.switch input {
		accent-color: var(--color-brand);
	}

	.new {
		padding: 0.375rem 0.875rem;
		font-size: 0.875rem;
		text-decoration: none;
	}

	.empty,
	.loading {
		color: var(--color-text-muted);
	}

	.empty {
		display: grid;
		gap: 0.75rem;
		justify-items: start;
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
		border-radius: 0.375rem;
		cursor: pointer;
	}
</style>
