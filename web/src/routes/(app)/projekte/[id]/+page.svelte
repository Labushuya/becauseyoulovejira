<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ErrorIcon from '$lib/components/ErrorIcon.svelte';
	import ProjectPanel from '$lib/components/ProjectPanel.svelte';
	import Drawer from '$lib/components/overlay/Drawer.svelte';
	import type { Project, ProjectDraft } from '$lib/domain/project';
	import { getProjectRoute } from '$lib/project-route';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { projectTicketsHref, projectsViewHref } from '$lib/ticket-links';

	// Panel of one project (/projekte/<record id>, package UI-8); a reload opens the same panel. The
	// project comes from the catalog, so live changes show at once. While it is being deleted the
	// panel keeps the last known project, so it does not turn into "nicht gefunden" before the
	// navigation back to the tiles.
	const route = getProjectRoute();
	const catalog = getCatalogStore();
	const id = $derived(page.params.id ?? '');
	const back = $derived(projectsViewHref(page.url));

	/** The project being deleted, until the navigation back to the tiles. */
	let removing = $state<Project | null>(null);
	const project = $derived(catalog.projectById(id) ?? (removing?.id === id ? removing : null));

	async function save(current: Project, draft: ProjectDraft) {
		const result = await route.editor.updateProject(current, draft);
		if (result.ok && result.value !== current) {
			route.notify(`Projekt „${result.value.name}“ gespeichert.`);
		}
		return result;
	}

	async function archive(current: Project, archived: boolean) {
		const result = await route.editor.setProjectArchived(current, archived);
		if (result.ok) {
			route.notify(
				archived
					? `Projekt „${current.name}“ archiviert.`
					: `Projekt „${current.name}“ aus dem Archiv geholt.`
			);
		}
		return result;
	}

	async function remove(current: Project) {
		removing = current;
		const result = await route.editor.deleteProject(current);
		if (result.ok) route.notify(`Projekt „${current.name}“ gelöscht.`);
		else removing = null;
		return result;
	}
</script>

<svelte:head>
	<title>{project ? `${project.name} · ` : ''}Projekte · becauseyoulovejira</title>
</svelte:head>

{#if project}
	{@const current = project}
	{#key id}
		<ProjectPanel
			project={current}
			active={route.activeOf(current)}
			total={route.totalOf(current)}
			fresh={route.newOf(current)}
			ticketsHref={projectTicketsHref(current.id)}
			onsave={(draft) => save(current, draft)}
			onarchive={(archived) => archive(current, archived)}
			ondelete={() => remove(current)}
			ondeleted={() => goto(back)}
			onclose={() => goto(back)}
		/>
	{/key}
{:else}
	<Drawer labelledby="project-missing" onclose={() => goto(back)}>
		{#snippet context()}Projekte{/snippet}
		{#if catalog.state === 'error' && catalog.error}
			<h2 id="project-missing" tabindex="-1">Projekt</h2>
			<p class="alert-error"><ErrorIcon /><span>{catalog.error}</span></p>
		{:else if catalog.state !== 'ready'}
			<h2 id="project-missing" class="visually-hidden" tabindex="-1">Projekt</h2>
			<p class="loading" role="status">Projekt wird geladen …</p>
		{:else}
			<h2 id="project-missing" tabindex="-1">Projekt nicht gefunden</h2>
			<p>Das Projekt wurde gelöscht oder ist nicht sichtbar.</p>
		{/if}
	</Drawer>
{/if}

<style>
	h2 {
		font-size: 1.125rem;
		font-weight: 600;
	}

	p {
		font-size: 0.875rem;
	}

	.loading {
		color: var(--color-text-muted);
	}
</style>
