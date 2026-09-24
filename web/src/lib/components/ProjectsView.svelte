<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { countActiveByProject, type Project, type ProjectDraft } from '$lib/domain/project';
	import type { CatalogStore } from '$lib/stores/catalog.svelte';
	import type { CatalogEditor } from '$lib/stores/catalog-editor';
	import type { ProjectStatsStore } from '$lib/stores/project-stats.svelte';
	import type { TicketListStore } from '$lib/stores/ticket-list.svelte';
	import { showArchivedFrom, withShowArchived } from '$lib/ticket-links';
	import ErrorIcon from './ErrorIcon.svelte';
	import ProjectDialog from './ProjectDialog.svelte';
	import ProjectTiles from './ProjectTiles.svelte';
	import SectionBar from './SectionBar.svelte';
	import TagManager from './TagManager.svelte';
	import ViewSwitch from './ViewSwitch.svelte';

	// Project view (E3 plan, T-3, T-11, T-12, T-14 and package 14; ADR-0010 section 1): instead of
	// KPI tiles, filter bar and table, the section bar with the switch "Aufgaben | Projekte",
	// "Archivierte anzeigen" (?archiviert=1) and "Neues Projekt", the project tiles and below them
	// the section "Tags". "aktiv" comes from the list store, "gesamt" adds the done tickets the
	// server counts (ProjectStatsStore).
	let {
		catalog,
		tickets,
		stats,
		editor
	}: {
		catalog: CatalogStore;
		tickets: TicketListStore;
		stats: ProjectStatsStore;
		editor: CatalogEditor;
	} = $props();

	const uid = $props.id();
	const headingId = `${uid}-heading`;

	const showArchived = $derived(showArchivedFrom(page.url));
	const shown = $derived(showArchived ? catalog.projects : catalog.activeProjects);
	const activeCounts = $derived(
		tickets.openState === 'ready' ? countActiveByProject(tickets.open) : null
	);
	const countLabel = $derived(shown.length === 1 ? '1 Projekt' : `${shown.length} Projekte`);

	let heading = $state<HTMLElement>();
	let announcement = $state('');
	/** Open dialog: `project` null creates; the trigger gets the focus back. */
	let dialog = $state<{ project: Project | null; trigger: HTMLElement | null } | null>(null);

	function activeOf(project: Project): number | null {
		return activeCounts === null ? null : (activeCounts.get(project.id) ?? 0);
	}

	function totalOf(project: Project): number | null {
		const active = activeOf(project);
		return active === null ? null : stats.total(project.id, active);
	}

	// Counts the done tickets of the shown projects (again when the set changes).
	$effect(() => {
		const ids = shown.map((project) => project.id);
		untrack(() => stats.track(ids));
	});

	async function toggleArchived(event: Event & { currentTarget: HTMLInputElement }) {
		await goto(withShowArchived(page.url, event.currentTarget.checked), {
			keepFocus: true,
			noScroll: true
		});
	}

	function openDialog(project: Project | null, trigger: HTMLElement | null) {
		dialog = { project, trigger };
	}

	/** Closes the dialog; the focus returns to its button, or to the heading if that is gone. */
	async function closeDialog() {
		const trigger = dialog?.trigger ?? null;
		dialog = null;
		await tick();
		(trigger?.isConnected ? trigger : heading)?.focus();
	}

	async function save(project: Project | null, draft: ProjectDraft) {
		if (project === null) {
			const result = await editor.createProject(draft);
			if (result.ok) {
				announcement = `Projekt „${result.value.name}“ (${result.value.code}) angelegt.`;
			}
			return result;
		}
		const result = await editor.updateProject(project, draft);
		if (result.ok) announcement = `Projekt „${result.value.name}“ gespeichert.`;
		return result;
	}

	async function archive(project: Project, archived: boolean) {
		const result = await editor.setProjectArchived(project, archived);
		if (result.ok) {
			announcement = archived
				? `Projekt „${project.name}“ archiviert.`
				: `Projekt „${project.name}“ aus dem Archiv geholt.`;
		}
		return result;
	}

	async function remove(project: Project) {
		const result = await editor.deleteProject(project);
		if (result.ok) announcement = `Projekt „${project.name}“ gelöscht.`;
		return result;
	}
</script>

{#snippet newProjectButton()}
	<button
		class="button-primary new"
		type="button"
		onclick={(event) => openDialog(null, event.currentTarget)}
	>
		<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
			<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
		</svg>
		Neues Projekt
	</button>
{/snippet}

{#snippet failure(message: string, onretry: () => void)}
	<div class="alert-error failure">
		<ErrorIcon />
		<span class="failure-text">{message}</span>
		<button class="text-button" type="button" onclick={onretry}>Erneut versuchen</button>
	</div>
{/snippet}

<section class="projects-view" aria-labelledby={headingId}>
	<SectionBar
		title="Projekte"
		{headingId}
		count={catalog.state === 'ready' ? shown.length : null}
		{countLabel}
		bind:heading
	>
		{#snippet start()}
			<ViewSwitch current="projects" />
		{/snippet}
		{#snippet end()}
			<label class="switch">
				<input type="checkbox" checked={showArchived} onchange={toggleArchived} />
				Archivierte anzeigen
			</label>
			{@render newProjectButton()}
		{/snippet}
	</SectionBar>

	<p class="visually-hidden" aria-live="polite">{announcement}</p>

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
				onedit={(project, trigger) => openDialog(project, trigger)}
			/>
		{:else if catalog.projects.length === 0}
			<div class="empty">
				<p>Noch keine Projekte.</p>
				{@render newProjectButton()}
			</div>
		{:else}
			<p class="empty">Alle Projekte sind archiviert. „Archivierte anzeigen“ zeigt sie.</p>
		{/if}

		<TagManager tags={catalog.tags} {editor} onannounce={(message) => (announcement = message)} />
	{/if}
</section>

{#if dialog !== null}
	{@const project = dialog.project && (catalog.projectById(dialog.project.id) ?? dialog.project)}
	<ProjectDialog
		{project}
		total={project === null ? null : totalOf(project)}
		onsave={(draft) => save(project, draft)}
		onarchive={(archived) => archive(project as Project, archived)}
		ondelete={() => remove(project as Project)}
		onclose={() => void closeDialog()}
	/>
{/if}

<style>
	.projects-view {
		display: grid;
		gap: 1.5rem;
	}

	.projects-view :global(.section-bar) {
		margin-bottom: 0;
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
