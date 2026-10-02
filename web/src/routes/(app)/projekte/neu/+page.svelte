<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ProjectPanel from '$lib/components/ProjectPanel.svelte';
	import type { ProjectDraft } from '$lib/domain/project';
	import { parentChoices } from '$lib/domain/project-tree';
	import { getProjectRoute } from '$lib/project-route';
	import { getCatalogStore } from '$lib/stores/catalog.svelte';
	import { parentFrom, projectHref, projectsViewHref } from '$lib/ticket-links';

	// "Neues Projekt" (E3 plan, T-11; package UI-8) in the panel next to the tiles. After creating,
	// the panel switches to the new project in place (replaceState), so "back" leads to the tiles
	// and not to an empty form. "Unterprojekt anlegen" (ADR-0034, UP-4) opens it with
	// ?oberprojekt=<id>; the parent counts only if the field "Oberprojekt" offers it.
	const route = getProjectRoute();
	const catalog = getCatalogStore();
	const choices = $derived(parentChoices(catalog.projects, null));
	const wanted = $derived(parentFrom(page.url));
	const initialParentId = $derived(
		wanted !== null && choices.some((choice) => choice.id === wanted) ? wanted : null
	);

	async function save(draft: ProjectDraft) {
		const result = await route.editor.createProject(draft);
		if (result.ok) route.notify(`Projekt „${result.value.name}“ (${result.value.code}) angelegt.`);
		return result;
	}
</script>

<svelte:head>
	<title>Neues Projekt · Projekte · becauseyoulovejira</title>
</svelte:head>

<ProjectPanel
	parentChoices={choices}
	{initialParentId}
	hierarchyReady={catalog.hierarchyReady}
	colorsReady={catalog.colorsReady}
	onsave={save}
	onsaved={(project) => goto(projectHref(project.id, page.url), { replaceState: true })}
	onclose={() => goto(projectsViewHref(page.url))}
/>
