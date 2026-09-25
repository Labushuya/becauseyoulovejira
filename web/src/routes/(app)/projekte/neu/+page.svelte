<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ProjectPanel from '$lib/components/ProjectPanel.svelte';
	import type { ProjectDraft } from '$lib/domain/project';
	import { getProjectRoute } from '$lib/project-route';
	import { projectHref, projectsViewHref } from '$lib/ticket-links';

	// "Neues Projekt" (E3 plan, T-11; package UI-8) in the panel next to the tiles. After creating,
	// the panel switches to the new project in place (replaceState), so "back" leads to the tiles
	// and not to an empty form.
	const route = getProjectRoute();

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
	onsave={save}
	onsaved={(project) => goto(projectHref(project.id, page.url), { replaceState: true })}
	onclose={() => goto(projectsViewHref(page.url))}
/>
