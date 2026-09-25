<script lang="ts">
	import ProjectsLayout from '../../routes/(app)/projekte/+layout.svelte';
	import ProjectPage from '../../routes/(app)/projekte/[id]/+page.svelte';
	import NewProjectPage from '../../routes/(app)/projekte/neu/+page.svelte';

	// Test harness of /projekte, /projekte/neu and /projekte/<id> (projects-layout.test.ts, UI-8): the
	// layout with the tiles and, as its child page, the panel of a project or "Neues Projekt", as
	// SvelteKit renders it.
	let { child = null }: { child?: 'neu' | 'project' | null } = $props();
</script>

<ProjectsLayout>
	{#if child === 'neu'}
		<NewProjectPage />
	{:else if child === 'project'}
		<ProjectPage />
	{/if}
</ProjectsLayout>
